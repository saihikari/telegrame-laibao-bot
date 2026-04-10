import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load .env first
dotenv.config();

import { loadConfig } from './bot/config-loader';
import { initSheetsClient } from './bot/sheets-service';
import { startWebServer } from './bot/web-admin';
import { startBot } from './bot/telegram-bot';

const start = async () => {
  console.log('[System] Starting Telegram Group Bot...');

  // Ensure backups directory exists
  const backupDir = path.join(__dirname, '../config/backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Load configuration
  loadConfig();

  // Initialize Web Admin Server
  const adminPort = parseInt(process.env.ADMIN_PORT || '8090', 10);
  try {
    await startWebServer(adminPort);
  } catch (error) {
    console.error('[System] Web Admin failed to start. Exiting.');
    process.exit(1);
  }

  // Initialize Google Sheets
  await initSheetsClient();

  // Start Telegram Bot
  startBot();

  console.log('[System] All modules initialized successfully.');
};

start().catch(err => {
  console.error('[System] Fatal error during startup:', err);
  process.exit(1);
});
