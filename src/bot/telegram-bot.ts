import TelegramBot from 'node-telegram-bot-api';
import { getConfig } from './config-loader';
import { processMessage } from './rule-engine';
import { ParsedData } from '../types/config.types';
import { appendRecord } from './sheets-service';

const token = process.env.BOT_TOKEN || '';
const internalChatIds = (process.env.INTERNAL_CHAT_IDS || '').split(',').map(id => id.trim());
const adminPort = process.env.ADMIN_PORT || '8090';

let bot: TelegramBot;

// Store parsed data temporarily for interactive recording
// Key: <chatId>_<messageId>, Value: ParsedData[]
const pendingRecords = new Map<string, ParsedData[]>();

export const startBot = () => {
  if (!token) {
    console.error('[Bot] BOT_TOKEN not found in environment variables.');
    process.exit(1);
  }

  bot = new TelegramBot(token, { polling: true });

  console.log('[Bot] Telegram Bot started in polling mode.');

  bot.onText(/^\/id$/, (msg) => {
    bot.sendMessage(msg.chat.id, `Chat ID: \`${msg.chat.id}\``, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/^\/test$/, async (msg) => {
    let successCount = 0;
    for (const chatId of internalChatIds) {
      try {
        await bot.sendMessage(chatId, '✅ 测试消息：内部群连通性正常');
        successCount++;
      } catch (err: any) {
        bot.sendMessage(msg.chat.id, `❌ 测试失败: ${chatId} - ${err.message}`);
      }
    }
    if (successCount === internalChatIds.length) {
      bot.sendMessage(msg.chat.id, `✅ 测试完成，已成功发送至 ${successCount} 个内部群`);
    }
  });

  bot.onText(/^\/help$/, (msg) => {
    const helpText = `
*机器人帮助文档*
- 功能简介：自动解析客户发包消息并录入Google Sheets。
- 指令列表：
  /id - 获取当前群Chat ID
  /test - 测试内部群连通性
  /help - 查看帮助和FQA
  /status - 获取状态页URL
  /customer - 列出所有客户名称
- 常见问题：
  若机器人未回复，请检查是否包含必填关键词（如名称、链接等）。
- 管理界面：http://<服务器IP>:${adminPort}/admin/config
- 状态页：http://<服务器IP>:${adminPort}/admin/status
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/status$/, (msg) => {
    // Note: the IP address should be the real server IP. Using placeholder.
    bot.sendMessage(msg.chat.id, `机器人状态页面：http://<服务器IP>:${adminPort}/admin/status`);
  });

  bot.onText(/^\/customer$/, (msg) => {
    const config = getConfig();
    let text = '当前已配置的客户：\n';
    config.customers.forEach(c => {
      text += `- ${c.name}\n`;
    });
    bot.sendMessage(msg.chat.id, text);
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const config = getConfig();
    const results = processMessage(msg.text, config);

    if (results.length > 0) {
      // 5.1 Send to internal groups
      for (const chatId of internalChatIds) {
        try {
          await bot.sendMessage(chatId, '⚠️ 来包信息清洗中');
        } catch (err) {
          console.error(`[Bot] Failed to send cleaning message to ${chatId}:`, err);
        }
      }

      // 5.2 Format summary
      let summaryText = `✔️ 来包信息清洗完毕。共计 ${results.length} 条来包信息如下：\n\n`;
      results.forEach((res, idx) => {
        summaryText += `客户：${res.customerName}\n`;
        for (const [key, val] of Object.entries(res.data)) {
          summaryText += `${key}：${val}\n`;
        }
        if (idx < results.length - 1) summaryText += '\n';
      });

      // 5.3 Send inline keyboard to internal groups
      for (const chatId of internalChatIds) {
        try {
          const sentMsg = await bot.sendMessage(chatId, summaryText, {
            reply_markup: {
              inline_keyboard: [[
                { text: 'Y录入', callback_data: `record_yes` },
                { text: 'N不录', callback_data: `record_no` }
              ]]
            }
          });
          
          // Store results temporarily to process on callback
          const key = `${chatId}_${sentMsg.message_id}`;
          pendingRecords.set(key, results);
          
        } catch (err) {
          console.error(`[Bot] Failed to send summary to ${chatId}:`, err);
        }
      }
    }
  });

  bot.on('callback_query', async (query) => {
    const data = query.data;
    const msg = query.message;
    if (!msg) return;

    const key = `${msg.chat.id}_${msg.message_id}`;
    const results = pendingRecords.get(key);

    if (!results) {
      bot.answerCallbackQuery(query.id, { text: '数据已过期或不存在' });
      return;
    }

    if (data === 'record_no') {
      bot.editMessageText('已取消录入，本次来包信息不作记录。', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      pendingRecords.delete(key);
      bot.answerCallbackQuery(query.id);
    } else if (data === 'record_yes') {
      // 5.4 Edit to loading state
      await bot.editMessageText('⏳ 正在录入，请稍候...', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      bot.answerCallbackQuery(query.id);

      let successCount = 0;
      let failCount = 0;
      const failDetails: string[] = [];

      for (const res of results) {
        let formattedString = `客户：${res.customerName}\n`;
        for (const [k, v] of Object.entries(res.data)) {
          formattedString += `${k}：${v}\n`;
        }

        try {
          await appendRecord(res.customerName, formattedString.trim());
          successCount++;
        } catch (error: any) {
          failCount++;
          failDetails.push(`[${res.customerName}] ${error.message}`);
        }
      }

      let finalText = `✅ 录入完成！成功${successCount}条`;
      if (failCount > 0) {
        finalText += `，失败${failCount}条。\n失败详情：\n${failDetails.join('\n')}`;
      } else {
        finalText += '。';
      }

      await bot.editMessageText(finalText, {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });

      pendingRecords.delete(key);
    }
  });
};
