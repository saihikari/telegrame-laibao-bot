"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreBackup = exports.listBackups = exports.getBackupCount = exports.getLastModified = exports.getConfig = exports.backupConfig = exports.saveConfig = exports.loadConfig = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const CONFIG_PATH = path_1.default.join(__dirname, '../../config/routes.json');
const BACKUP_DIR = path_1.default.join(__dirname, '../../config/backups');
let currentConfig = { customers: [] };
let lastModified = new Date();
const loadConfig = () => {
    try {
        if (!fs_1.default.existsSync(CONFIG_PATH)) {
            console.log('[Config] routes.json not found, using default config.');
            currentConfig = { customers: [] };
        }
        else {
            const fileContent = fs_1.default.readFileSync(CONFIG_PATH, 'utf-8');
            currentConfig = JSON.parse(fileContent);
            // Ensure default delay values if missing
            if (typeof currentConfig.delayMinSeconds !== 'number') {
                currentConfig.delayMinSeconds = parseInt(process.env.DELAY_MIN_SECONDS || '6', 10);
            }
            if (typeof currentConfig.delayMaxSeconds !== 'number') {
                currentConfig.delayMaxSeconds = parseInt(process.env.DELAY_MAX_SECONDS || '12', 10);
            }
            const stats = fs_1.default.statSync(CONFIG_PATH);
            lastModified = stats.mtime;
            console.log(`[Config] Loaded routes.json successfully. Customers count: ${currentConfig.customers.length}`);
        }
    }
    catch (error) {
        console.error('[Config] Failed to load config:', error);
    }
    return currentConfig;
};
exports.loadConfig = loadConfig;
const saveConfig = (newConfig) => {
    try {
        const configString = JSON.stringify(newConfig, null, 2);
        fs_1.default.writeFileSync(CONFIG_PATH, configString, 'utf-8');
        currentConfig = newConfig;
        lastModified = new Date();
        console.log('[Config] Configuration saved and applied.');
        return true;
    }
    catch (error) {
        console.error('[Config] Failed to save config:', error);
        return false;
    }
};
exports.saveConfig = saveConfig;
const backupConfig = () => {
    try {
        if (!fs_1.default.existsSync(BACKUP_DIR)) {
            fs_1.default.mkdirSync(BACKUP_DIR, { recursive: true });
        }
        if (!fs_1.default.existsSync(CONFIG_PATH)) {
            return { success: false };
        }
        const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '').split('.')[0];
        const backupFilename = `routes_${timestamp}.json`;
        const backupPath = path_1.default.join(BACKUP_DIR, backupFilename);
        fs_1.default.copyFileSync(CONFIG_PATH, backupPath);
        console.log(`[Config] Config backed up to ${backupFilename}`);
        return { success: true, filename: backupFilename };
    }
    catch (error) {
        console.error('[Config] Failed to backup config:', error);
        return { success: false };
    }
};
exports.backupConfig = backupConfig;
const getConfig = () => {
    // 每次获取配置时，检查文件是否被修改，如果被修改过就重新加载
    try {
        if (fs_1.default.existsSync(CONFIG_PATH)) {
            const stats = fs_1.default.statSync(CONFIG_PATH);
            if (stats.mtime > lastModified) {
                console.log('[Config] Detected routes.json change, reloading...');
                (0, exports.loadConfig)();
            }
        }
    }
    catch (err) {
        console.error('[Config] Error checking file stats:', err);
    }
    return currentConfig;
};
exports.getConfig = getConfig;
const getLastModified = () => lastModified;
exports.getLastModified = getLastModified;
const getBackupCount = () => {
    try {
        if (!fs_1.default.existsSync(BACKUP_DIR))
            return 0;
        return fs_1.default.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).length;
    }
    catch {
        return 0;
    }
};
exports.getBackupCount = getBackupCount;
const listBackups = () => {
    try {
        if (!fs_1.default.existsSync(BACKUP_DIR))
            return [];
        return fs_1.default.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.json'))
            .sort((a, b) => {
            // sort descending by modified time or simply by filename (which includes timestamp)
            return b.localeCompare(a);
        });
    }
    catch {
        return [];
    }
};
exports.listBackups = listBackups;
const restoreBackup = (filename) => {
    try {
        const backupPath = path_1.default.join(BACKUP_DIR, filename);
        if (!fs_1.default.existsSync(backupPath)) {
            return { success: false };
        }
        const fileContent = fs_1.default.readFileSync(backupPath, 'utf-8');
        const parsed = JSON.parse(fileContent);
        return { success: true, data: parsed };
    }
    catch (error) {
        console.error('[Config] Failed to restore backup:', error);
        return { success: false };
    }
};
exports.restoreBackup = restoreBackup;
