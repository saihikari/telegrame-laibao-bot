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
        const credPath = path_1.default.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH || 'config/google-credentials.json');
        if (!fs_1.default.existsSync(credPath)) {
            console.warn(`[Sheets] Credentials not found at ${credPath}. Google Sheets integration is disabled.`);
            return;
        }
        const auth = new googleapis_1.google.auth.GoogleAuth({
            keyFile: credPath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const client = await auth.getClient();
        sheetsAPI = googleapis_1.google.sheets({ version: 'v4', auth: client });
        // Test connection
        if (spreadsheetId) {
            await sheetsAPI.spreadsheets.get({ spreadsheetId });
            isReady = true;
            console.log('[Sheets] Google Sheets API initialized successfully.');
        }
        else {
            console.warn('[Sheets] GOOGLE_SHEET_ID not provided.');
        }
    }
    catch (error) {
        console.error('[Sheets] Initialization failed:', error);
    }
};
exports.initSheetsClient = initSheetsClient;
const isSheetsReady = () => isReady;
exports.isSheetsReady = isSheetsReady;
const appendRecord = async (customerName, formattedString) => {
    if (!isReady || !sheetsAPI || !spreadsheetId)
        throw new Error('Sheets API not ready');
    const res = await sheetsAPI.spreadsheets.get({ spreadsheetId });
    const sheets = res.data.sheets || [];
    const targetSheet = sheets.find(s => s.properties?.title === customerName);
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
    }
    await sheetsAPI.spreadsheets.values.append({
        spreadsheetId,
        range: `${customerName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[formattedString]]
        }
    });
};
exports.appendRecord = appendRecord;
