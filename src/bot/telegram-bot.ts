import TelegramBot from 'node-telegram-bot-api';
import { getConfig, saveConfig } from './config-loader';
import { processMessage } from './rule-engine';
import { ParsedData } from '../types/config.types';
import { processAndWriteToQL, ParsedRecord } from './ql-writer';
import { qlApi } from './ql-api';
import { getAdminTgIds, addAdminTgId, removeAdminTgId } from '../utils/env-editor';
import { recognizeChargeImage } from './ocr-service';
import { appendRecordLog } from './record-log';
import { generateOffersScreenshot } from './offer-screenshot';

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

interface AdActionState {
    actionType: '暂停' | '开启' | '下架';
    step: 'WAIT_STORE_SELECTION' | 'WAIT_STORE_NAME_MANUAL' | 'WAIT_PRODUCT_SELECTION';
    storeName?: string;
    storeId?: number;
    activeOffers?: any[];
    selectedOffers?: Set<number>;
}
const adActionSessions = new Map<string, AdActionState>();

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
  商户充值 - 唤起 OCR 充值截图录入面板
  昨日消耗 - 导出昨日 QL 系统消耗数据 (CSV)
  暂停广告 - 唤起商户列表，支持多选暂停处于开启状态的广告
  开启广告 - 唤起商户列表，支持多选开启处于暂停状态的广告
  下架广告 - 唤起商户列表，支持多选下架当前的广告
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

    bot.onText(/昨日消耗/, async (msg) => {
    const adminIds = getAdminTgIds();
    if (!adminIds.includes(msg.from?.id.toString() || '')) {
      await bot.sendMessage(msg.chat.id, '❌ 权限不足：只有管理员才能导出昨日消耗。', { reply_to_message_id: msg.message_id });
      return;
    }

    const processingMsg = await bot.sendMessage(msg.chat.id, '⏳ 正在拉取昨日消耗数据并生成 CSV，请稍候...', { reply_to_message_id: msg.message_id });

    const toYyyyMmDd = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const csvEscape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    try {
      const yesterday = new Date(Date.now() - 86400000);
      const dateStr = toYyyyMmDd(yesterday);

      const rowsRaw = await qlApi.listSumShowByDateRange({
        managerBId: 579,
        startStr: dateStr,
        endStr: dateStr,
        pageNum: 1,
        pageRow: 200,
        productType: 1
      });

      const rows = (rowsRaw || [])
        .filter((r: any) => r && r.storeName && r.productName && r.productName !== '合计')
        .map((r: any) => ({
          offerID: r.offerId || '', // 提取 offerId，兼容空值
          logDate: dateStr,
          storeName: r.storeName,
          productName: r.productName,
          consume: Number(r.consume ?? r.consumeShow ?? 0),
          showNum: Number(r.showNum ?? 0),
          clickNum: Number(r.clickNum ?? 0),
          registerNum: Number(r.registerNum ?? 0),
          firstChargeNum: Number(r.firstChargeNum ?? 0)
        }))
        .sort((a: any, b: any) => {
          const s = String(a.storeName).localeCompare(String(b.storeName), 'zh-Hans-CN');
          if (s !== 0) return s;
          
          // 如果 storeName 相同，则按 offerID 升序排序
          // 使用 numeric: true 防止 "10" 排在 "2" 前面
          return String(a.offerID).localeCompare(String(b.offerID), 'zh-Hans-CN', { numeric: true });
        });

      const header = [
        'offerID',
        'logDate日期',
        'storeName商户名称',
        'productName产品名称',
        'consume消耗',
        'showNum展示数',
        'clickNum点击数',
        'registerNum注册数',
        'firstChargeNum首充数'
      ];
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push([
          csvEscape(r.offerID),
          csvEscape(r.logDate),
          csvEscape(r.storeName),
          csvEscape(r.productName),
          csvEscape(r.consume),
          csvEscape(r.showNum),
          csvEscape(r.clickNum),
          csvEscape(r.registerNum),
          csvEscape(r.firstChargeNum)
        ].join(','));
      }

      const csv = lines.join('\n');
      const filename = '昨日消耗.CSV';

      await bot.sendDocument(
        msg.chat.id,
        Buffer.from(csv, 'utf8'),
        { caption: `昨日消耗 (${dateStr})，共 ${rows.length} 行` },
        { filename, contentType: 'text/csv' }
      );

      await bot.deleteMessage(msg.chat.id, processingMsg.message_id).catch(() => undefined);
    } catch (e: any) {
      await bot.editMessageText(`❌ 导出失败：${e.message}`, {
        chat_id: msg.chat.id,
        message_id: processingMsg.message_id
      }).catch(() => undefined);
    }
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

  
  const buildOfferKeyboard = (activeOffers: any[], selectedOffers: Set<number>, columns: number): any[][] => {
    const keyboard: any[][] = [];
    let currentRow: any[] = [];
    
    activeOffers.forEach(o => {
      const isSelected = selectedOffers.has(o.id);
      const text = `${isSelected ? '✅' : '⬜'} ${o.product || o.productName}`;
      // Shorten the name if it's too long? The user didn't ask for it, but let's keep the original text
      currentRow.push({ text, callback_data: `adaction_prod:${o.id}` });
      
      if (currentRow.length === columns) {
        keyboard.push(currentRow);
        currentRow = [];
      }
    });
    
    if (currentRow.length > 0) {
      keyboard.push(currentRow);
    }
    
    keyboard.push([{ text: '✅ 全选 / 🟩 全不选', callback_data: `adaction_prod:ALL` }]);
    keyboard.push([{ text: `▶️ 确定操作已选 (${selectedOffers.size})`, callback_data: `adaction_confirm` }]);
    keyboard.push([{ text: '暂不需要', callback_data: `adaction_cancel` }]);
    
    return keyboard;
  };

  const getStoreKeyboard = (callbackPrefix = 'charge_store'): any[][] => {
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

    const keyboard: any[][] = [];
    if (callbackPrefix === 'charge_store') {
      keyboard.push([{ text: '手动输入', callback_data: `charge_store:MANUAL` }]);
    }

    let currentRow: any[] = [];
    const columns = config.keyboardColumns || 3;
    for (const c of customers) {
      const shortName = c.length > 15 ? c.substring(0, 13) + '..' : c;
      currentRow.push({ text: shortName, callback_data: `${callbackPrefix}:${c}` });
      if (currentRow.length === columns) {
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

  const handleAdAction = (msg: TelegramBot.Message, actionType: '暂停' | '开启' | '下架') => {
    const sessionKey = `${msg.chat.id}_${msg.from?.id}`;
    adActionSessions.set(sessionKey, { actionType, step: 'WAIT_STORE_SELECTION' });

    const keyboard = getStoreKeyboard('adaction_store');
    keyboard.push([{ text: '暂不需要', callback_data: `adaction_cancel` }]);
    bot.sendMessage(msg.chat.id, `请选择需要${actionType}广告的商户：`, {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  };

  bot.onText(/暂停广告/, (msg) => handleAdAction(msg, '暂停'));
  bot.onText(/开启广告/, (msg) => handleAdAction(msg, '开启'));
  bot.onText(/下架广告/, (msg) => handleAdAction(msg, '下架'));

  // bot.onText(/消耗报告/, (msg) => {
  //   const keyboard = getStoreKeyboard('report_store');
  //   // Prepend the "Select All" button
  //   keyboard.unshift([{ text: '选择全部', callback_data: `report_store:ALL` }]);
  //   keyboard.push([{ text: '暂不需要', callback_data: `report_cancel` }]);
  //   bot.sendMessage(msg.chat.id, '请选择需要获取消耗报告的商户商户：', {
  //     reply_markup: {
  //       inline_keyboard: keyboard
  //     }
  //   });
  // });

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

    const pauseAdSession = adActionSessions.get(sessionKey);
    if (pauseAdSession && pauseAdSession.step === 'WAIT_STORE_NAME_MANUAL' && msg.text && !msg.text.startsWith('/')) {
      const storeName = msg.text.trim();
      pauseAdSession.storeName = storeName;
      
      const processingMsg = await bot.sendMessage(msg.chat.id, `正在查询商户【${storeName}】的广告列表...`, { reply_to_message_id: msg.message_id });
      
      try {
        const stores = await qlApi.listStoreToSelect();
        const targetStore = stores.find(s => s.storeName.includes(storeName));
        if (!targetStore) {
          throw new Error(`找不到包含 '${storeName}' 的商户`);
        }
        
        pauseAdSession.storeId = targetStore.storeId;
        const offers = await qlApi.listOffer(targetStore.storeId, 100);
        
        const actionType = pauseAdSession.actionType;
        const activeOffers = offers.filter(o => {
          if (actionType === '暂停') return o.pStatus === '开启' || o.status === 1;
          if (actionType === '开启') return o.pStatus === '暂停' || o.status === 2;
          if (actionType === '下架') return o.pStatus !== '下架' && o.status !== 3;
          return true;
        });
        pauseAdSession.activeOffers = activeOffers;
        pauseAdSession.selectedOffers = new Set<number>();
        pauseAdSession.step = 'WAIT_PRODUCT_SELECTION';
        adActionSessions.set(sessionKey, pauseAdSession);

        if (activeOffers.length === 0) {
          await bot.editMessageText(`商户【${targetStore.storeName}】下没有符合操作条件的广告。`, {
            chat_id: msg.chat.id,
            message_id: processingMsg.message_id
          });
          adActionSessions.delete(sessionKey);
          return;
        }

        const config = getConfig();
        const columns = config.keyboardColumns || 3;
        const keyboard = buildOfferKeyboard(activeOffers, pauseAdSession.selectedOffers!, columns);

        await bot.editMessageText(`你选择的商户是“${targetStore.storeName}”，请点击打勾选择需要操作广告的产品：`, {
          chat_id: msg.chat.id,
          message_id: processingMsg.message_id,
          reply_markup: { inline_keyboard: keyboard }
        });

      } catch (err: any) {
        await bot.editMessageText(`查询失败: ${err.message}`, {
          chat_id: msg.chat.id,
          message_id: processingMsg.message_id
        });
        adActionSessions.delete(sessionKey);
      }
      return;
    }

    // 首先拦截指令，不要把它们当作常规消息去清洗
    if (!msg.text || msg.text.startsWith('/')) return;
    if (msg.text.includes('昨日消耗')) return;
    if (msg.text.includes('商户充值')) return; // handled by onText
    // if (msg.text.includes('消耗报告')) return; // handled by onText

    const config = getConfig();
    const results = processMessage(msg.text, config);

    if (results.length > 0) {
      // Send initial cleaning notification to the same chat where the message was received
      let cleaningMsgId: number | undefined;
      try {
        const cleaningMsg = await bot.sendMessage(msg.chat.id, '⚠️ 来包信息清洗中', { reply_to_message_id: msg.message_id });
        cleaningMsgId = cleaningMsg.message_id;
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

      if (cleaningMsgId) {
        try {
          await bot.deleteMessage(msg.chat.id, cleaningMsgId);
        } catch (e) {
          console.error(`[Bot] Failed to delete cleaning message in ${msg.chat.id}:`, e);
        }
      }

      // Send the summary with inline keyboard back to the same chat
      try {
        const sentMsg = await bot.sendMessage(msg.chat.id, summaryText, {
          disable_web_page_preview: true,
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

    if (data === 'charge_cancel' || data === 'report_cancel' || data === 'adaction_cancel') {
      const sessionKey = `${msg.chat.id}_${query.from.id}`;
      chargeSessions.delete(sessionKey);
      adActionSessions.delete(sessionKey);
      const textMap: Record<string, string> = {
        'charge_cancel': '已取消商户充值。',
        'report_cancel': '已取消消耗报告获取。',
        'adaction_cancel': '已取消操作。'
      };
      bot.editMessageText(textMap[data as string] || '已取消。', {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      bot.answerCallbackQuery(query.id);
      return;
    }

    // if (data?.startsWith('report_store:')) {
    //   const storeName = data.split('report_store:')[1];
    //   bot.editMessageText(`正在获取【${storeName === 'ALL' ? '全部商户' : storeName}】的消耗数据，请稍候...`, {
    //     chat_id: msg.chat.id,
    //     message_id: msg.message_id
    //   });

    //   try {
    //     // Fetch report data
    //     const records = await qlApi.listSumShow(579, storeName === 'ALL' ? undefined : storeName);
        
    //     // Filter for yesterday's logDate
    //     const yesterday = new Date(Date.now() - 86400000);
    //     const yyyy = yesterday.getFullYear();
    //     const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
    //     const dd = String(yesterday.getDate()).padStart(2, '0');
    //     const targetDate = `${yyyy}-${mm}-${dd}`;
        
    //     let filteredRecords = records.filter((r: any) => {
    //       if (r.logDate && r.logDate.startsWith(targetDate)) return true;
    //       // If the API returns logDate without time, or different format, adjust here.
    //       // Sometimes it might just be the exact string.
    //       if (r.logDate === targetDate) return true;
    //       return false;
    //     });

    //     if (filteredRecords.length === 0) {
    //       bot.sendMessage(msg.chat.id, `【${storeName === 'ALL' ? '全部商户' : storeName}】在 ${targetDate} (昨日) 没有更新的消耗数据。`);
    //       bot.answerCallbackQuery(query.id);
    //       return;
    //     }

    //     // Sorting: Store Name (Ascending), Product Number (Ascending)
    //     filteredRecords.sort((a: any, b: any) => {
    //       const sNameA = a.storeName || '';
    //       const sNameB = b.storeName || '';
    //       if (sNameA !== sNameB) return sNameA.localeCompare(sNameB);
          
    //       const pNumA = a.bianHao || a.productNo || a.offerNo || a.id || '';
    //       const pNumB = b.bianHao || b.productNo || b.offerNo || b.id || '';
    //       return pNumA.toString().localeCompare(pNumB.toString());
    //     });

    //     // Grouping and formatting
    //     let resultText = "【商户名称】\t【产品编号】\t【产品名称】\t【消耗量（USD）】\t【点击量】\t【展示量】\n";
    //     let lastStoreName = "";

    //     for (const r of filteredRecords) {
    //       const currentStoreName = r.storeName || '';
    //       if (lastStoreName && currentStoreName !== lastStoreName) {
    //         resultText += "\n"; // Blank line between different stores
    //       }
    //       lastStoreName = currentStoreName;

    //       // Mapping fields (using common QL variable names based on previous APIs)
    //       const pName = r.productName || r.offerName || r.product || '';
    //       const pNum = r.bianHao || r.productNo || r.offerNo || r.id || '';
    //       const consume = r.consumeAmount || r.cost || r.consume || r.spend || '0';
    //       const clicks = r.clicks || r.clickCount || r.click || '0';
    //       const shows = r.shows || r.showCount || r.impressions || '0';

    //       resultText += `${currentStoreName}\t${pNum}\t${pName}\t${consume}\t${clicks}\t${shows}\n`;
    //     }

    //     bot.sendMessage(msg.chat.id, resultText);

    //   } catch (err: any) {
    //     console.error("[Report Error]", err);
    //     bot.sendMessage(msg.chat.id, `获取消耗报告失败: ${err.message}`);
    //   }
    //   bot.answerCallbackQuery(query.id);
    //   return;
    // }

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

    if (data?.startsWith('adaction_store:')) {
      const storeName = data.split('adaction_store:')[1];
      const sessionKey = `${msg.chat.id}_${query.from.id}`;
      const session = adActionSessions.get(sessionKey) || {} as AdActionState;

      if (storeName === 'MANUAL') {
        session.step = 'WAIT_STORE_NAME_MANUAL';
        adActionSessions.set(sessionKey, session);
        bot.editMessageText('请回复输入您要操作广告的商户名称（如：XX-XX）：', {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      } else {
        session.storeName = storeName;
        adActionSessions.set(sessionKey, session);
        
        bot.editMessageText(`正在查询商户【${storeName}】的广告列表...`, {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });

        qlApi.listStoreToSelect().then(stores => {
          const targetStore = stores.find(s => s.storeName.includes(storeName));
          if (!targetStore) throw new Error(`找不到包含 '${storeName}' 的商户`);
          session.storeId = targetStore.storeId;
          return qlApi.listOffer(targetStore.storeId, 100).then(offers => ({ targetStore, offers }));
        }).then(({ targetStore, offers }) => {
          const actionType = session.actionType;
          const activeOffers = offers.filter(o => {
            if (actionType === '暂停') return o.pStatus === '开启' || o.status === 1;
            if (actionType === '开启') return o.pStatus === '暂停' || o.status === 2;
            if (actionType === '下架') return o.pStatus !== '下架' && o.status !== 3;
            return true;
          });
          session.activeOffers = activeOffers;
          session.selectedOffers = new Set<number>();
          session.step = 'WAIT_PRODUCT_SELECTION';
          adActionSessions.set(sessionKey, session);

          if (activeOffers.length === 0) {
            bot.editMessageText(`商户【${targetStore.storeName}】下没有符合操作条件的广告。`, {
              chat_id: msg.chat.id,
              message_id: msg.message_id
            });
            adActionSessions.delete(sessionKey);
            return;
          }

          const config = getConfig();
          const columns = config.keyboardColumns || 3;
          const keyboard = buildOfferKeyboard(activeOffers, session.selectedOffers!, columns);

          bot.editMessageText(`你选择的商户是“${targetStore.storeName}”，请点击打勾选择需要操作广告的产品：`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            reply_markup: { inline_keyboard: keyboard }
          });
        }).catch(err => {
          bot.editMessageText(`查询失败: ${err.message}`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });
          adActionSessions.delete(sessionKey);
        });
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data?.startsWith('adaction_prod:')) {
      const offerIdStr = data.split('adaction_prod:')[1];
      const sessionKey = `${msg.chat.id}_${query.from.id}`;
      const session = adActionSessions.get(sessionKey);

      if (!session || session.step !== 'WAIT_PRODUCT_SELECTION' || !session.activeOffers || !session.selectedOffers) {
        bot.answerCallbackQuery(query.id, { text: '会话已过期' });
        return;
      }

      if (offerIdStr === 'ALL') {
        if (session.selectedOffers.size === session.activeOffers.length) {
          // If all are selected, deselect all
          session.selectedOffers.clear();
        } else {
          // Select all
          session.activeOffers.forEach(o => session.selectedOffers!.add(o.id));
        }
      } else {
        const offerId = parseInt(offerIdStr, 10);
        if (session.selectedOffers.has(offerId)) {
          session.selectedOffers.delete(offerId);
        } else {
          session.selectedOffers.add(offerId);
        }
      }

      // Re-render keyboard
      const config = getConfig();
      const columns = config.keyboardColumns || 3;
      const keyboard = buildOfferKeyboard(session.activeOffers, session.selectedOffers!, columns);

      bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'adaction_confirm') {
      const sessionKey = `${msg.chat.id}_${query.from.id}`;
      const session = adActionSessions.get(sessionKey);

      if (!session || session.step !== 'WAIT_PRODUCT_SELECTION' || !session.activeOffers || !session.selectedOffers) {
        bot.answerCallbackQuery(query.id, { text: '会话已过期' });
        return;
      }

      if (session.selectedOffers.size === 0) {
        bot.answerCallbackQuery(query.id, { text: '请至少选择一个产品！', show_alert: true });
        return;
      }

      bot.editMessageText(`⏳ 正在批量处理 ${session.selectedOffers.size} 个广告，请稍候...`, {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });

      const processPause = async () => {
        try {
          let successCount = 0;
          let failCount = 0;
          const pausedOffers: any[] = [];
          
          for (const offerId of Array.from(session.selectedOffers!)) {
            try {
              await qlApi.editPStatus(offerId, session.actionType);
              const offerObj = session.activeOffers!.find(o => o.id === offerId);
              if (offerObj) {
                offerObj.pStatus = session.actionType;
                pausedOffers.push(offerObj);
              }
              successCount++;
            } catch (e) {
              failCount++;
            }
          }
          
          await bot.editMessageText(`✅ 批量操作完成！\n\n🎯 成功：${successCount} 个\n❌ 失败：${failCount} 个`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });

          if (pausedOffers.length > 0) {
            const loadingMsg = await bot.sendMessage(msg.chat.id, `📸 正在生成网页截图证明，请稍候...`, {
              reply_to_message_id: msg.message_id
            });
            try {
              const imageBuffer = await generateOffersScreenshot(pausedOffers);
              await bot.sendPhoto(msg.chat.id, imageBuffer, {
                caption: `✅ 商户【${session.storeName}】广告操作已在系统中生效`,
                reply_to_message_id: msg.message_id
              });
              await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
            } catch (err: any) {
              console.error('Screenshot error:', err);
              await bot.editMessageText(`⚠️ 截图生成失败，但操作已成功。(${err.message})`, {
                chat_id: msg.chat.id,
                message_id: loadingMsg.message_id
              });
            }
          }
        } catch (err: any) {
          bot.editMessageText(`❌ 操作失败：${err.message}`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });
        } finally {
          adActionSessions.delete(sessionKey);
        }
      };

      processPause();
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
            let reportUrl = await qlApi.getReportLink(targetStore.storeId);
            if (reportUrl) {
              // Clean the URL just in case there are markdown backticks or quotes from the DB
              reportUrl = reportUrl.replace(/[`'"]/g, '').trim();
              if (!reportUrl.startsWith('http')) {
                reportUrl = 'https://' + reportUrl;
              }
              
              // Ensure it's a valid, clean HTTPS URL for Telegram
              try {
                const parsedUrl = new URL(reportUrl);
                reportUrl = parsedUrl.toString();
              } catch (e) {
                console.warn("[Report URL] Could not parse URL properly:", reportUrl);
              }

              try {
                await bot.sendMessage(msg.chat.id, '✅ 充值录入成功！是否需要顺便录入日报？', {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: '打开日报', url: reportUrl }
                      ],
                      [
                        { text: '暂不需要', callback_data: 'charge_cancel_report' }
                      ]
                    ]
                  }
                });
              } catch (sendErr: any) {
                console.error("[Telegram Send Error]", sendErr);
                bot.sendMessage(msg.chat.id, `⚠️ 找到了日报链接，但 Telegram 拒绝了发送（可能链接格式不被支持）：\n${reportUrl}`);
              }
            } else {
              bot.sendMessage(msg.chat.id, 'ℹ️ QL系统未配置该商户的日报链接。');
            }
          } catch (reportErr: any) {
            console.error("[Report Link Error]", reportErr);
            bot.sendMessage(msg.chat.id, `⚠️ 获取日报链接出错：${reportErr.message}`);
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
        message_id: msg.message_id,
        disable_web_page_preview: true
      });
      pendingRecords.delete(key);
      bot.answerCallbackQuery(query.id);
    } else if (data === 'record_yes') {
      // Use the summaryText we explicitly saved, instead of msg.text which might be the original uncleaned user message
      await bot.editMessageText(summaryText + '\n\n⏳ 正在录入，请稍候...', {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        disable_web_page_preview: true
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
        message_id: msg.message_id,
        disable_web_page_preview: true
      });

      pendingRecords.delete(key);
    }
  });
};
