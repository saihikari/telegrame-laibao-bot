import TelegramBot from 'node-telegram-bot-api';
import { getConfig, saveConfig } from './config-loader';
import { processMessage } from './rule-engine';
import { ParsedData } from '../types/config.types';
import { processAndWriteToQL, ParsedRecord } from './ql-writer';
import { qlApi } from './ql-api';
import { getAdminTgIds, addAdminTgId, removeAdminTgId } from '../utils/env-editor';
import { recognizeChargeImage } from './ocr-service';
import { appendRecordLog } from './record-log';

const token = process.env.BOT_TOKEN || '';
const internalChatIds = (process.env.INTERNAL_CHAT_IDS || '').split(',').map(id => id.trim());
const adminPort = process.env.ADMIN_PORT || '8070';
const webDomain = process.env.WEB_DOMAIN || 'http://www.runtoads.top';
const baseUrl = `${webDomain}:${adminPort}`;

let bot: TelegramBot;

// Store parsed data temporarily for interactive recording
// Key: <chatId>_<messageId>, Value: { results: ParsedData[], summaryText: string }
const pendingRecords = new Map<string, { results: ParsedData[], summaryText: string }>();

// Store interactive charge flow state
// Key: <chatId>_<userId>
interface ChargeState {
    step: 'WAIT_STORE_NAME' | 'WAIT_PHOTO' | 'CONFIRM' | 'WAIT_STORE_SELECTION' | 'WAIT_STORE_NAME_MANUAL';
    storeName?: string;
    usdAmount?: string;
    payDay?: string;
    imgUrl?: string;
    photoId?: string;
}
const chargeSessions = new Map<string, ChargeState>();

export const getBotInstance = () => bot;

export const startBot = async () => {
  if (!token) {
    console.error('[Bot] BOT_TOKEN not found in environment variables.');
    process.exit(1);
  }

  bot = new TelegramBot(token, {
    polling: true,
    request: {
      agentOptions: {
        keepAlive: true,
        family: 4
      }
    } as any // Bypass strict TS check for request options
  });

  console.log('[Bot] Telegram Bot started in polling mode.');

  // Check if API is ready (or just proceed, maybe token is fetching)
  try {
    const stores = await qlApi.listStoreToSelect();
    console.log(`[QL API] Ready. Found ${stores.length} stores.`);
  } catch (e: any) {
    console.warn(`[QL API] Init warning: ${e.message}`);
  }

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
- 指令列表：
  /id - 获取当前群Chat ID
  /test - 测试内部群连通性
  /help - 查看帮助文档
  /status - 获取状态页URL
  /customer - 列出所有客户名称
  /addmng - 添加管理员
  /delemng - 删除管理员
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/status$/, (msg) => {
    // 使用真实的域名
    bot.sendMessage(msg.chat.id, `综合管理后台：${baseUrl}/admin/`);
  });

  bot.onText(/^\/customer$/, (msg) => {
    // 强制重新加载最新配置
    const config = getConfig();
    let text = '当前已配置的客户：\n';
    config.customers.forEach(c => {
      text += `- ${c.name}\n`;
    });
    bot.sendMessage(msg.chat.id, text);
  });

  bot.onText(/^\/addmng(?:\s+(\d+))?$/, (msg, match) => {
    const adminIds = getAdminTgIds();
    if (!adminIds.includes(msg.from?.id.toString() || '')) {
      return bot.sendMessage(msg.chat.id, '❌ 权限不足：只有现有管理员才能添加新管理员。');
    }
    
    const targetId = match?.[1];
    if (!targetId) {
      return bot.sendMessage(msg.chat.id, '❌ 格式错误。正确用法: `/addmng <数字ID>`', { parse_mode: 'Markdown' });
    }

    if (addAdminTgId(targetId)) {
      bot.sendMessage(msg.chat.id, `✅ 成功添加管理员: \`${targetId}\``, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `⚠️ 该用户已经是管理员: \`${targetId}\``, { parse_mode: 'Markdown' });
    }
  });

  bot.onText(/^\/delemng(?:\s+(\d+))?$/, (msg, match) => {
    const adminIds = getAdminTgIds();
    if (!adminIds.includes(msg.from?.id.toString() || '')) {
      return bot.sendMessage(msg.chat.id, '❌ 权限不足：只有现有管理员才能删除管理员。');
    }
    
    const targetId = match?.[1];
    if (!targetId) {
      return bot.sendMessage(msg.chat.id, '❌ 格式错误。正确用法: `/delemng <数字ID>`', { parse_mode: 'Markdown' });
    }

    if (targetId === '8413696128') {
      return bot.sendMessage(msg.chat.id, '❌ 无法删除超级默认管理员。');
    }

    if (targetId === msg.from?.id.toString()) {
      return bot.sendMessage(msg.chat.id, '❌ 不能删除自己。');
    }

    if (removeAdminTgId(targetId)) {
      bot.sendMessage(msg.chat.id, `✅ 成功移除管理员: \`${targetId}\``, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `⚠️ 找不到该管理员: \`${targetId}\``, { parse_mode: 'Markdown' });
    }
  });

  const getStoreKeyboard = (): any[][] => {
    const config = getConfig();
    const textCollator = new Intl.Collator('en', { sensitivity: 'base' });
    const naturalCompare = (a: string, b: string) => {
      const ax = (a || '').trim();
      const bx = (b || '').trim();
      const aParts = ax.match(/(\d+|[^\d]+)/g) || [];
      const bParts = bx.match(/(\d+|[^\d]+)/g) || [];

      const len = Math.min(aParts.length, bParts.length);
      for (let i = 0; i < len; i++) {
        const ap = aParts[i];
        const bp = bParts[i];
        const an = /^\d+$/.test(ap);
        const bn = /^\d+$/.test(bp);
        if (an && bn) {
          const av = parseInt(ap, 10);
          const bv = parseInt(bp, 10);
          if (av !== bv) return av - bv;
        } else if (!an && !bn) {
          const cmp = textCollator.compare(ap, bp);
          if (cmp !== 0) return cmp;
        } else {
          return an ? 1 : -1;
        }
      }
      return aParts.length - bParts.length;
    };
    const customers = config.customers
      .map(c => (c.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => {
        const aDigit = /^\d/.test(a);
        const bDigit = /^\d/.test(b);
        if (aDigit !== bDigit) return aDigit ? 1 : -1;
        return naturalCompare(a, b);
      });

    const keyboard: any[][] = [[{ text: '手动输入', callback_data: `charge_store:MANUAL` }]];

    let currentRow: any[] = [];
    for (const c of customers) {
      const shortName = c.length > 15 ? c.substring(0, 13) + '..' : c;
      currentRow.push({ text: shortName, callback_data: `charge_store:${c}` });
      if (currentRow.length === 2) {
        keyboard.push(currentRow);
        currentRow = [];
      }
    }
    if (currentRow.length > 0) {
      keyboard.push(currentRow);
    }
    return keyboard;
  };

  const runOcrProcess = async (chatId: number, userId: number, photoId: string, storeName: string, messageIdToEdit: number) => {
    const sessionKey = `${chatId}_${userId}`;
    const session = chargeSessions.get(sessionKey) || { step: 'CONFIRM' } as ChargeState;
    
    try {
      const fileLink = await bot.getFileLink(photoId);
      const fetch = require('node-fetch');
      const response = await fetch(fileLink);
      const buffer = await response.buffer();
      
      const ocrResult = await recognizeChargeImage(buffer);
      const imgUrl = await qlApi.uploadFile(buffer, `charge_${Date.now()}.png`);
      
      session.usdAmount = ocrResult.usdAmount;
      session.payDay = ocrResult.payDay;
      session.imgUrl = imgUrl;
      session.storeName = storeName;
      session.step = 'CONFIRM';
      chargeSessions.set(sessionKey, session);

      const summaryText = `识别结果：\n金额(USDT)：${session.usdAmount || '未识别'}\n日期：${session.payDay || '未识别'}`;
      
      await bot.editMessageText(summaryText + '\n\n请确认是否录入？', {
        chat_id: chatId,
        message_id: messageIdToEdit,
        reply_markup: {
          inline_keyboard: [[
            { text: '识别准确，录入', callback_data: `charge_confirm:yes` },
            { text: '识别有误，纠正', callback_data: `charge_confirm:no` }
          ]]
        }
      });
    } catch (err: any) {
      console.error("[Charge OCR Error]", err);
      bot.editMessageText('❌ 图片识别或上传失败: ' + err.message, {
        chat_id: chatId,
        message_id: messageIdToEdit
      });
      chargeSessions.delete(sessionKey);
    }
  };

  bot.onText(/商户充值/, (msg) => {
    const keyboard = getStoreKeyboard();
    keyboard.push([{ text: '暂不需要', callback_data: `charge_cancel` }]);
    bot.sendMessage(msg.chat.id, '请选择充值商户：', {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  });

  bot.on('message', async (msg) => {
    const sessionKey = `${msg.chat.id}_${msg.from?.id}`;
    const session = chargeSessions.get(sessionKey);

    // Handling charge photo upload
    if (msg.photo) {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      
      if (session && session.step === 'WAIT_PHOTO') {
        // Old flow: user selected store, then sent photo
        const processingMsg = await bot.sendMessage(msg.chat.id, '⏳ 正在识别图片...', { reply_to_message_id: msg.message_id });
        await runOcrProcess(msg.chat.id, msg.from!.id, photoId, session.storeName!, processingMsg.message_id);
      } else {
        // New flow: User sends photo directly, trigger auto charge prompt
        const keyboard = getStoreKeyboard();
        keyboard.push([{ text: '暂不需要', callback_data: `charge_cancel` }]);
        
        chargeSessions.set(sessionKey, {
          step: 'WAIT_STORE_SELECTION',
          photoId: photoId
        });
        
        bot.sendMessage(msg.chat.id, '检测到图片，是否进行“商户充值”？请选择商户：', {
          reply_to_message_id: msg.message_id,
          reply_markup: { inline_keyboard: keyboard }
        });
      }
      return;
    }

    // Handling charge manual correction
    if (session && session.step === 'CONFIRM' && msg.text && !msg.text.startsWith('/')) {
      // user corrects via: "金额=2020 日期=2026-04-15"
      const t = msg.text;
      const amtMatch = t.match(/金额\s*[=：:]\s*([\d.]+)/);
      const dateMatch = t.match(/日期\s*[=：:]\s*([\d-]+)/);
      
      if (amtMatch) session.usdAmount = amtMatch[1];
      if (dateMatch) session.payDay = dateMatch[1];

      chargeSessions.set(sessionKey, session);

      const summaryText = `手动纠正结果：\n金额(USDT)：${session.usdAmount || '未识别'}\n日期：${session.payDay || '未识别'}`;
        
      await bot.sendMessage(msg.chat.id, summaryText + '\n\n请确认是否录入？', {
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[
            { text: '准确，录入', callback_data: `charge_confirm:yes` },
            { text: '仍然有误', callback_data: `charge_confirm:no` }
          ]]
        }
      });
      return;
    }

    // Handling manual store name input
    if (session && (session.step === 'WAIT_STORE_NAME' || session.step === 'WAIT_STORE_NAME_MANUAL') && msg.text && !msg.text.startsWith('/')) {
      session.storeName = msg.text.trim();
      
      if (session.step === 'WAIT_STORE_NAME_MANUAL' && session.photoId) {
        // We already have the photo, run OCR immediately
        const processingMsg = await bot.sendMessage(msg.chat.id, `已输入【${session.storeName}】，⏳ 正在识别图片...`, { reply_to_message_id: msg.message_id });
        await runOcrProcess(msg.chat.id, msg.from!.id, session.photoId, session.storeName, processingMsg.message_id);
      } else {
        // Wait for photo
        session.step = 'WAIT_PHOTO';
        chargeSessions.set(sessionKey, session);
        bot.sendMessage(msg.chat.id, `即将录入【${session.storeName}】商户的充值，请在对话中粘贴图片。`);
      }
      return;
    }

    // 首先拦截指令，不要把它们当作常规消息去清洗
    if (!msg.text || msg.text.startsWith('/')) return;
    if (msg.text.includes('商户充值')) return; // handled by onText

    const config = getConfig();
    const results = processMessage(msg.text, config);

    if (results.length > 0) {
      // Send initial cleaning notification to the same chat where the message was received
      try {
        await bot.sendMessage(msg.chat.id, '⚠️ 来包信息清洗中', { reply_to_message_id: msg.message_id });
      } catch (err) {
        console.error(`[Bot] Failed to send cleaning message to ${msg.chat.id}:`, err);
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

      // Send the summary with inline keyboard back to the same chat
      try {
        const sentMsg = await bot.sendMessage(msg.chat.id, summaryText, {
          reply_markup: {
            inline_keyboard: [[
              { text: 'Y录入', callback_data: `record_yes` },
              { text: 'N不录', callback_data: `record_no` }
            ]]
          },
          reply_to_message_id: msg.message_id
        });
        
        // Store both results and the exact summary text we generated
        const key = `${msg.chat.id}_${sentMsg.message_id}`;
        pendingRecords.set(key, { results, summaryText });
        
      } catch (err) {
        console.error(`[Bot] Failed to send summary to ${msg.chat.id}:`, err);
      }
    }
  });

  bot.on('callback_query', async (query) => {
    const data = query.data;
    const msg = query.message;
    if (!msg) return;

    if (data === 'charge_cancel_report') {
      bot.editMessageText('✅ 好的，已结束本次充值录入。', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'charge_cancel') {
      const sessionKey = `${msg.chat.id}_${query.from.id}`;
      chargeSessions.delete(sessionKey);
      bot.editMessageText('已取消商户充值。', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      bot.answerCallbackQuery(query.id);
      return;
    }

    // Handle interactive charge flow callbacks
    if (data?.startsWith('charge_store:')) {
      const storeName = data.split('charge_store:')[1];
      const sessionKey = `${msg.chat.id}_${query.from.id}`;
      const session = chargeSessions.get(sessionKey) || {} as ChargeState;
      
      if (storeName === 'MANUAL') {
        session.step = session.photoId ? 'WAIT_STORE_NAME_MANUAL' : 'WAIT_STORE_NAME';
        chargeSessions.set(sessionKey, session);
        bot.editMessageText('请回复输入您要充值的商户名称（如：XX-XX）：', {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      } else {
        if (session.photoId) {
          // We have the photo, trigger OCR immediately
          bot.editMessageText(`已选择【${storeName}】，⏳ 正在识别图片...`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });
          await runOcrProcess(msg.chat.id, query.from.id, session.photoId, storeName, msg.message_id);
        } else {
          // Old flow: no photo yet
          session.step = 'WAIT_PHOTO';
          session.storeName = storeName;
          chargeSessions.set(sessionKey, session);
          bot.editMessageText(`即将录入【${storeName}】商户的充值，请在对话中发送/粘贴转账截图。`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });
        }
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data?.startsWith('charge_confirm:')) {
      const action = data.split('charge_confirm:')[1];
      const sessionKey = `${msg.chat.id}_${query.from.id}`;
      const session = chargeSessions.get(sessionKey);
      
      if (!session) {
        bot.answerCallbackQuery(query.id, { text: '会话已过期' });
        return;
      }

      if (action === 'no') {
        bot.editMessageText('⚠️ 请直接回复纠正信息（如：金额=2020 日期=2026-04-15），我会重新更新。', {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      } else if (action === 'yes') {
        if (!session.usdAmount || !session.payDay || !session.imgUrl || !session.storeName) {
          bot.editMessageText('❌ 信息不完整，请确保金额和日期均已识别或纠正。', {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });
          bot.answerCallbackQuery(query.id);
          return;
        }

        bot.editMessageText('⏳ 正在录入充值记录，请稍候...', {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });

        try {
          const stores = await qlApi.listStoreToSelect();
          const targetStore = stores.find(s => s.storeName.includes(session.storeName!));
          if (!targetStore) {
            throw new Error(`找不到商户名称包含 '${session.storeName}' 的记录`);
          }

          const rate = await qlApi.getRate();
          const usdNum = parseFloat(session.usdAmount);
          const amount = (usdNum * rate).toFixed(2);

          const chargeObj = {
            storeId: targetStore.storeId,
            storeName: targetStore.storeName,
            platform: targetStore.platform || null,
            pStoreId: targetStore.pStoreId || null,
            pStoreName: targetStore.pStoreName || null,
            platformId: targetStore.platformId || null,
            managerId: targetStore.managerId,
            managerName: targetStore.managerName,
            checkStatus: 1,
            storeType: targetStore.storeType,
            contactId: targetStore.contactId || null,
            currency: 'usd',
            rate: rate.toString(),
            usdAmount: session.usdAmount,
            amount: amount,
            payDay: session.payDay,
            imgUrl: session.imgUrl
          };

          await qlApi.saveCharge(chargeObj);

          bot.editMessageText(`✅ QL充值录入成功！\n商户：${targetStore.storeName}\n金额：${session.usdAmount} USDT\n换算金额：${amount} (汇率${rate})\n日期：${session.payDay}`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });

          // Record log
          appendRecordLog({
            sheetName: targetStore.storeName,
            content: `金额(USDT)：${session.usdAmount}\n汇率：${rate}\n日期：${session.payDay}\n类型：商户充值`,
            startAt: new Date(Date.now() - 500).toISOString(),
            endAt: new Date().toISOString(),
            elapsedMs: 500,
            savedSeconds: 15.0
          });
          
          chargeSessions.delete(sessionKey);

          // After charge is saved:
          // 1. Auto-add to config if missing
          const currentConfig = getConfig();
          const existingCustomer = currentConfig.customers.find(c => c.name === targetStore.storeName);
          if (!existingCustomer) {
            currentConfig.customers.push({
              name: targetStore.storeName,
              priority: currentConfig.customers.length + 1,
              match_keywords: [targetStore.storeName],
              exclude_keywords: [],
              rules: {}
            });
            saveConfig(currentConfig);
            bot.sendMessage(msg.chat.id, `ℹ️ 提示：商户【${targetStore.storeName}】已自动添加到路由配置中。`);
          }

          // 2. Fetch daily report link and ask to open
          try {
            const reportUrl = await qlApi.getReportLink(targetStore.storeId);
            if (reportUrl) {
              bot.sendMessage(msg.chat.id, '✅ 充值录入成功！是否需要顺便录入日报？', {
                reply_markup: {
                  inline_keyboard: [[
                    { text: '录入日报 (内置网页)', web_app: { url: reportUrl } },
                    { text: '暂不需要', callback_data: 'charge_cancel_report' }
                  ]]
                }
              });
            } else {
              bot.sendMessage(msg.chat.id, 'ℹ️ QL系统未配置该商户的日报链接。');
            }
          } catch (reportErr) {
            console.error("[Report Link Error]", reportErr);
          }

        } catch (err: any) {
          bot.editMessageText(`❌ QL充值录入失败！\n原因：${err.message}`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });
        }
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    const key = `${msg.chat.id}_${msg.message_id}`;
    const pendingData = pendingRecords.get(key);

    if (!pendingData) {
      bot.answerCallbackQuery(query.id, { text: '数据已过期或不存在' });
      return;
    }

    const { results, summaryText } = pendingData;

    if (data === 'record_no') {
      bot.editMessageText(summaryText + '\n\n❌ 已取消录入，本次来包信息不作记录。', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      pendingRecords.delete(key);
      bot.answerCallbackQuery(query.id);
    } else if (data === 'record_yes') {
      // Use the summaryText we explicitly saved, instead of msg.text which might be the original uncleaned user message
      await bot.editMessageText(summaryText + '\n\n⏳ 正在录入，请稍候...', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      bot.answerCallbackQuery(query.id);

      const startAtMs = Date.now();

      let successCount = 0;
      let failCount = 0;
      let errorMsg = '';

      try {
        const recordsToProcess = results.map((res: any) => {
          return {
            客户: res.customerName,
            ...res.data
          } as ParsedRecord;
        });

        const qlResult = await processAndWriteToQL(recordsToProcess, startAtMs);
        successCount = qlResult.successCount;
      } catch (e: any) {
        failCount = results.length - successCount;
        errorMsg = e.message;
      }

      let finalText = summaryText + `\n\n✅ QL 录入处理完成！成功 ${successCount} 条，失败 ${failCount} 条。\n`;

      if (failCount > 0) {
        finalText += `\n❌ 错误详情：\n${errorMsg}`;
      }

      await bot.editMessageText(finalText, {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });

      pendingRecords.delete(key);
    }
  });
};
