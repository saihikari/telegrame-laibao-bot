import fs from 'fs';
import path from 'path';

export type RecordLogEntry = {
  sheetName: string;
  content: string;
  startAt: string;
  endAt: string;
  elapsedMs: number;
  savedSeconds: number;
};

const getLogFilePath = () => {
  return process.env.RECORD_LOG_PATH || path.resolve(process.cwd(), 'data', 'record-log.jsonl');
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
};

export const appendRecordLog = async (entry: RecordLogEntry) => {
  const filePath = getLogFilePath();
  await ensureDir(filePath);
  await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
};

export const readRecordLogs = async (limit: number) => {
  const filePath = getLogFilePath();
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const slice = lines.slice(Math.max(0, lines.length - Math.max(limit * 5, 1000)));
    const entries = slice
      .map(line => {
        try {
          return JSON.parse(line) as RecordLogEntry;
        } catch {
          return null;
        }
      })
      .filter((v): v is RecordLogEntry => Boolean(v));

    entries.sort((a, b) => (a.endAt < b.endAt ? 1 : a.endAt > b.endAt ? -1 : 0));
    return entries.slice(0, limit);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    throw e;
  }
};

