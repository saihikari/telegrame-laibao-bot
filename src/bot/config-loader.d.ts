import { Config } from '../types/config.types';
export declare const loadConfig: () => Config;
export declare const saveConfig: (newConfig: Config) => boolean;
export declare const backupConfig: () => {
    success: boolean;
    filename?: string;
};
export declare const getConfig: () => Config;
export declare const getLastModified: () => Date;
export declare const getBackupCount: () => number;
//# sourceMappingURL=config-loader.d.ts.map