"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendRecord = exports.isSheetsReady = exports.initSheetsClient = void 0;
const googleapis_1 = require("googleapis");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
let sheetsAPI = null;
let spreadsheetId = process.env.GOOGLE_SHEET_ID;
let isReady = false;
const initSheetsClient = async () => {
    try {
        const credPath = process.env.GOOGLE_CREDENTIALS_PATH
            ? path_1.default.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH)
            : path_1.default.resolve(__dirname, '../../config/google-credentials.json');
        if (!fs_1.default.existsSync(credPath)) {
            console.warn(`[Sheets] Credentials not found at ${credPath}. Google Sheets integration is disabled.`);
            return;
        }
        if (!spreadsheetId) {
            console.warn('[Sheets] GOOGLE_SHEET_ID not provided in environment variables.');
            return;
        }
        const auth = new googleapis_1.google.auth.GoogleAuth({
            keyFile: credPath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const client = await auth.getClient();
        sheetsAPI = googleapis_1.google.sheets({ version: 'v4', auth: client });
        await sheetsAPI.spreadsheets.get({ spreadsheetId });
        isReady = true;
        console.log(`[Sheets] Google Sheets API initialized successfully. Connected to spreadsheet: ${spreadsheetId}`);
    }
    catch (error) {
        console.error('[Sheets] Initialization failed:', error.message || error);
        isReady = false;
    }
};
exports.initSheetsClient = initSheetsClient;
const isSheetsReady = () => isReady;
exports.isSheetsReady = isSheetsReady;
// 指数退避重试包装器，增强 Google Sheets API 的容错性
const withRetry = async (fn, retries = 3, baseDelay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        }
        catch (error) {
            if (i === retries - 1)
                throw error; // 最后一次失败则抛出
            // 检查是否是 429 速率限制或 50x 网络错误
            const status = error?.response?.status;
            if (status && status !== 429 && status < 500) {
                throw error; // 如果是客户端错误 (400-404且不是429)，直接抛出，无需重试
            }
            const delay = baseDelay * Math.pow(2, i) + Math.random() * 500; // 指数退避 + 抖动
            console.warn(`[Sheets] API error (${status || 'Network'}). Retrying in ${Math.round(delay)}ms... (${i + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            // 尝试重新初始化连接
            if (!isReady && sheetsAPI === null) {
                await (0, exports.initSheetsClient)();
            }
        }
    }
    throw new Error('Unreachable');
};
const appendRecord = async (customerName, formattedString) => {
    return withRetry(async () => {
        if (!isReady || !sheetsAPI || !spreadsheetId) {
            // 尝试重新连接
            console.log('[Sheets] API not ready, attempting to reconnect...');
            await (0, exports.initSheetsClient)();
            if (!isReady || !sheetsAPI || !spreadsheetId) {
                throw new Error('Sheets API not ready. 请检查服务器日志。');
            }
        }
        const res = await sheetsAPI.spreadsheets.get({ spreadsheetId });
        const sheets = res.data.sheets || [];
        let targetSheet = sheets.find(s => s.properties?.title === customerName);
        if (!targetSheet) {
            const templateSheet = sheets.find(s => s.properties?.title === '模板');
            if (!templateSheet)
                throw new Error('未找到名为"模板"的工作表，无法创建新客户表');
            const copyRes = await sheetsAPI.spreadsheets.sheets.copyTo({
                spreadsheetId,
                sheetId: templateSheet.properties.sheetId,
                requestBody: { destinationSpreadsheetId: spreadsheetId }
            });
            const newSheetId = copyRes.data.sheetId;
            await sheetsAPI.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                            updateSheetProperties: {
                                properties: { sheetId: newSheetId, title: customerName },
                                fields: 'title'
                            }
                        }]
                }
            });
            // 刷新 targetSheet 状态
            targetSheet = { properties: { title: customerName } };
        }
        // 查找 A 列第一个空单元格的行号
        const getRes = await sheetsAPI.spreadsheets.values.get({
            spreadsheetId,
            range: `${customerName}!A:A`,
        });
        const values = getRes.data.values || [];
        // 确保至少有 5 行，如果不够，补充空行
        while (values.length < 5) {
            values.push([]);
        }
        let insertRowIndex = values.length + 1;
        // 从第 6 行（索引 5）开始往下找空白行
        for (let i = 5; i < values.length; i++) {
            const row = values[i];
            if (!row || row.length === 0 || row[0] === null || row[0] === undefined || row[0].toString().trim() === '') {
                insertRowIndex = i + 1;
                break;
            }
        }
        const updateRange = `${customerName}!A${insertRowIndex}`;
        const updateRes = await sheetsAPI.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[formattedString]]
            }
        });
        return `成功写入 ${customerName} 表格，位于第 ${insertRowIndex} 行。`;
    });
};
exports.appendRecord = appendRecord;
