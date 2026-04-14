import fs from 'fs';
import path from 'path';
import { Config } from '../types/config.types';

const CONFIG_PATH = path.join(__dirname, '../../config/routes.json');
const BACKUP_DIR = path.join(__dirname, '../../config/backups');

let currentConfig: Config = { customers: [] };
let lastModified: Date = new Date();

export const loadConfig = (): Config => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.log('[Config] routes.json not found, using default config.');
      currentConfig = { customers: [] };
    } else {
      const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
      currentConfig = JSON.parse(fileContent) as Config;
      const stats = fs.statSync(CONFIG_PATH);
      lastModified = stats.mtime;
      console.log(`[Config] Loaded routes.json successfully. Customers count: ${currentConfig.customers.length}`);
    }
  } catch (error) {
    console.error('[Config] Failed to load config:', error);
  }
  return currentConfig;
};

export const saveConfig = (newConfig: Config): boolean => {
  try {
    const configString = JSON.stringify(newConfig, null, 2);
    fs.writeFileSync(CONFIG_PATH, configString, 'utf-8');
    currentConfig = newConfig;
    lastModified = new Date();
    console.log('[Config] Configuration saved and applied.');
    return true;
  } catch (error) {
    console.error('[Config] Failed to save config:', error);
    return false;
  }
};

export const backupConfig = (): { success: boolean; filename?: string } => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(CONFIG_PATH)) {
      return { success: false };
    }

    const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '').split('.')[0];
    const backupFilename = `routes_${timestamp}.json`;
    const backupPath = path.join(BACKUP_DIR, backupFilename);
    
    fs.copyFileSync(CONFIG_PATH, backupPath);
    console.log(`[Config] Config backed up to ${backupFilename}`);
    return { success: true, filename: backupFilename };
  } catch (error) {
    console.error('[Config] Failed to backup config:', error);
    return { success: false };
  }
};

export const getConfig = (): Config => {
  // 每次获取配置时，检查文件是否被修改，如果被修改过就重新加载
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const stats = fs.statSync(CONFIG_PATH);
      if (stats.mtime > lastModified) {
        console.log('[Config] Detected routes.json change, reloading...');
        loadConfig();
      }
    }
  } catch (err) {
    console.error('[Config] Error checking file stats:', err);
  }
  return currentConfig;
};
export const getLastModified = (): Date => lastModified;
export const getBackupCount = (): number => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return 0;
    return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
};

export const listBackups = (): string[] => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        // sort descending by modified time or simply by filename (which includes timestamp)
        return b.localeCompare(a);
      });
  } catch {
    return [];
  }
};

export const restoreBackup = (filename: string): { success: boolean; data?: Config } => {
  try {
    const backupPath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(backupPath)) {
      return { success: false };
    }
    const fileContent = fs.readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(fileContent) as Config;
    return { success: true, data: parsed };
  } catch (error) {
    console.error('[Config] Failed to restore backup:', error);
    return { success: false };
  }
};
