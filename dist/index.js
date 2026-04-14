"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Load .env first
dotenv_1.default.config();
const config_loader_1 = require("./bot/config-loader");
const sheets_service_1 = require("./bot/sheets-service");
const web_admin_1 = require("./bot/web-admin");
const telegram_bot_1 = require("./bot/telegram-bot");
const start = async () => {
    console.log('[System] Starting Telegram Group Bot...');
    // Ensure backups directory exists
    const backupDir = path_1.default.join(__dirname, '../config/backups');
    if (!fs_1.default.existsSync(backupDir)) {
        fs_1.default.mkdirSync(backupDir, { recursive: true });
    }
    // Load configuration
    (0, config_loader_1.loadConfig)();
    // Initialize Web Admin Server
    const adminPort = parseInt(process.env.ADMIN_PORT || '8070', 10);
    try {
        await (0, web_admin_1.startWebServer)(adminPort);
    }
    catch (error) {
        console.error('[System] Web Admin failed to start. Exiting.');
        process.exit(1);
    }
    // Initialize Google Sheets
    await (0, sheets_service_1.initSheetsClient)();
    // Start Telegram Bot
    (0, telegram_bot_1.startBot)();
    console.log('[System] All modules initialized successfully.');
};
start().catch(err => {
    console.error('[System] Fatal error during startup:', err);
    process.exit(1);
});
