import { google, sheets_v4 } from 'googleapis';
import path from 'path';
import fs from 'fs';

let sheetsAPI: sheets_v4.Sheets | null = null;
let spreadsheetId = process.env.GOOGLE_SHEET_ID;
let isReady = false;

export const initSheetsClient = async () => {
  try {
    const credPath = process.env.GOOGLE_CREDENTIALS_PATH 
      ? path.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH)
      : path.resolve(__dirname, '../../config/google-credentials.json');
      
    if (!fs.existsSync(credPath)) {
      console.warn(`[Sheets] Credentials not found at ${credPath}. Google Sheets integration is disabled.`);
      return;
    }
    
    if (!spreadsheetId) {
      console.warn('[Sheets] GOOGLE_SHEET_ID not provided in environment variables.');
      return;
    }
    
    const auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const client = await auth.getClient();
    sheetsAPI = google.sheets({ version: 'v4', auth: client as any });
    
    await sheetsAPI.spreadsheets.get({ spreadsheetId });
    isReady = true;
    console.log(`[Sheets] Google Sheets API initialized successfully. Connected to spreadsheet: ${spreadsheetId}`);
  } catch (error: any) {
    console.error('[Sheets] Initialization failed:', error.message || error);
    isReady = false;
  }
};

export const isSheetsReady = () => isReady;

export const appendRecord = async (customerName: string, formattedString: string): Promise<string> => {
  if (!isReady || !sheetsAPI || !spreadsheetId) throw new Error('Sheets API not ready. 请检查服务器日志。');

  const res = await sheetsAPI.spreadsheets.get({ spreadsheetId });
  const sheets = res.data.sheets || [];
  const targetSheet = sheets.find(s => s.properties?.title === customerName);

  if (!targetSheet) {
    const templateSheet = sheets.find(s => s.properties?.title === '模板');
    if (!templateSheet) throw new Error('未找到名为"模板"的工作表，无法创建新客户表');

    const copyRes = await sheetsAPI.spreadsheets.sheets.copyTo({
      spreadsheetId,
      sheetId: templateSheet.properties!.sheetId!,
      requestBody: { destinationSpreadsheetId: spreadsheetId }
    });

    const newSheetId = copyRes.data.sheetId!;

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

  return `第 ${insertRowIndex} 行`;
};
