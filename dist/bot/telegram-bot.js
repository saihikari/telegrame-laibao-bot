"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBot = void 0;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const config_loader_1 = require("./config-loader");
const rule_engine_1 = require("./rule-engine");
const sheets_service_1 = require("./sheets-service");
const env_editor_1 = require("../utils/env-editor");
const token = process.env.BOT_TOKEN || '';
const internalChatIds = (process.env.INTERNAL_CHAT_IDS || '').split(',').map(id => id.trim());
const adminPort = process.env.ADMIN_PORT || '8070';
const webDomain = process.env.WEB_DOMAIN || 'http://www.runtoads.top';
const baseUrl = `${webDomain}:${adminPort}`;
let bot;
// Store parsed data temporarily for interactive recording
// Key: <chatId>_<messageId>, Value: ParsedData[]
const pendingRecords = new Map();
const startBot = () => {
    if (!token) {
        console.error('[Bot] BOT_TOKEN not found in environment variables.');
        process.exit(1);
    }
    bot = new node_telegram_bot_api_1.default(token, {
        polling: true,
        request: {
            agentOptions: {
                keepAlive: true,
                family: 4
            }
        } // Bypass strict TS check for request options
    });
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
            }
            catch (err) {
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
  /help - 查看帮助和FAQ
  /status - 获取状态页URL
  /customer - 列出所有客户名称
  /addmng <ID> - 添加管理员
  /delemng <ID> - 删除管理员
- 常见问题：
  若机器人未回复，请检查是否包含必填关键词（如名称、链接等）。
- 综合管理后台：${baseUrl}/admin/
    `;
        bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
    });
    bot.onText(/^\/status$/, (msg) => {
        // 使用真实的域名
        bot.sendMessage(msg.chat.id, `综合管理后台：${baseUrl}/admin/`);
    });
    bot.onText(/^\/customer$/, (msg) => {
        // 强制重新加载最新配置
        const config = (0, config_loader_1.getConfig)();
        let text = '当前已配置的客户：\n';
        config.customers.forEach(c => {
            text += `- ${c.name}\n`;
        });
        bot.sendMessage(msg.chat.id, text);
    });
    bot.onText(/^\/addmng(?:\s+(\d+))?$/, (msg, match) => {
        const adminIds = (0, env_editor_1.getAdminTgIds)();
        if (!adminIds.includes(msg.from?.id.toString() || '')) {
            return bot.sendMessage(msg.chat.id, '❌ 权限不足：只有现有管理员才能添加新管理员。');
        }
        const targetId = match?.[1];
        if (!targetId) {
            return bot.sendMessage(msg.chat.id, '❌ 格式错误。正确用法: `/addmng <数字ID>`', { parse_mode: 'Markdown' });
        }
        if ((0, env_editor_1.addAdminTgId)(targetId)) {
            bot.sendMessage(msg.chat.id, `✅ 成功添加管理员: \`${targetId}\``, { parse_mode: 'Markdown' });
        }
        else {
            bot.sendMessage(msg.chat.id, `⚠️ 该用户已经是管理员: \`${targetId}\``, { parse_mode: 'Markdown' });
        }
    });
    bot.onText(/^\/delemng(?:\s+(\d+))?$/, (msg, match) => {
        const adminIds = (0, env_editor_1.getAdminTgIds)();
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
        if ((0, env_editor_1.removeAdminTgId)(targetId)) {
            bot.sendMessage(msg.chat.id, `✅ 成功移除管理员: \`${targetId}\``, { parse_mode: 'Markdown' });
        }
        else {
            bot.sendMessage(msg.chat.id, `⚠️ 找不到该管理员: \`${targetId}\``, { parse_mode: 'Markdown' });
        }
    });
    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/'))
            return;
        const config = (0, config_loader_1.getConfig)();
        const results = (0, rule_engine_1.processMessage)(msg.text, config);
        if (results.length > 0) {
            // Send initial cleaning notification to the same chat where the message was received
            try {
                await bot.sendMessage(msg.chat.id, '⚠️ 来包信息清洗中', { reply_to_message_id: msg.message_id });
            }
            catch (err) {
                console.error(`[Bot] Failed to send cleaning message to ${msg.chat.id}:`, err);
            }
            // 5.2 Format summary
            let summaryText = `✔️ 来包信息清洗完毕。共计 ${results.length} 条来包信息如下：\n\n`;
            results.forEach((res, idx) => {
                summaryText += `客户：${res.customerName}\n`;
                for (const [key, val] of Object.entries(res.data)) {
                    summaryText += `${key}：${val}\n`;
                }
                if (idx < results.length - 1)
                    summaryText += '\n';
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
            }
            catch (err) {
                console.error(`[Bot] Failed to send summary to ${msg.chat.id}:`, err);
            }
        }
    });
    bot.on('callback_query', async (query) => {
        const data = query.data;
        const msg = query.message;
        if (!msg)
            return;
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
        }
        else if (data === 'record_yes') {
            // Use the summaryText we explicitly saved, instead of msg.text which might be the original uncleaned user message
            await bot.editMessageText(summaryText + '\n\n⏳ 正在录入，请稍候...', {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            });
            bot.answerCallbackQuery(query.id);
            let successCount = 0;
            let failCount = 0;
            const successDetails = [];
            const failDetails = [];
            for (const res of results) {
                let formattedString = `客户：${res.customerName}\n`;
                for (const [k, v] of Object.entries(res.data)) {
                    formattedString += `${k}：${v}\n`;
                }
                try {
                    const rowInfo = await (0, sheets_service_1.appendRecord)(res.customerName, formattedString.trim());
                    successCount++;
                    successDetails.push(`[${res.customerName}] 录入至 ${rowInfo}`);
                }
                catch (error) {
                    failCount++;
                    failDetails.push(`[${res.customerName}] ${error.message}`);
                }
            }
            let finalText = summaryText + `\n\n✅ 录入处理完成！成功 ${successCount} 条，失败 ${failCount} 条。\n`;
            if (successCount > 0) {
                finalText += `\n📈 成功详情：\n${successDetails.join('\n')}`;
            }
            if (failCount > 0) {
                finalText += `\n\n⚠️ 失败详情：\n${failDetails.join('\n')}`;
            }
            await bot.editMessageText(finalText, {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            });
            pendingRecords.delete(key);
        }
    });
};
exports.startBot = startBot;
