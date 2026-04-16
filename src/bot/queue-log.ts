import fs from 'fs';
import path from 'path';

export interface QueueItem {
    id: string;
    customerName: string;
    recordData: any;      // The original parsed record
    errorMsg: string;
    attempts: number;
    createdAt: string;
    lastAttemptAt: string;
}

const QUEUE_FILE = process.env.QUEUE_LOG_PATH || path.join(__dirname, '../../../data/queue-log.jsonl');

function ensureDir() {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

export function readQueue(): QueueItem[] {
    try {
        if (!fs.existsSync(QUEUE_FILE)) return [];
        const content = fs.readFileSync(QUEUE_FILE, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        return lines.map(line => JSON.parse(line)).reverse();
    } catch (e) {
        console.error('Failed to read queue log:', e);
        return [];
    }
}

export function addToQueue(item: Omit<QueueItem, 'id' | 'createdAt' | 'attempts' | 'lastAttemptAt'>) {
    ensureDir();
    const queueItem: QueueItem = {
        id: Date.now().toString() + Math.floor(Math.random() * 1000).toString(),
        createdAt: new Date().toISOString(),
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
        ...item
    };
    fs.appendFileSync(QUEUE_FILE, JSON.stringify(queueItem) + '\n', 'utf8');
}

export function removeFromQueue(id: string) {
    const items = readQueue().reverse(); // reverse back to original order
    const filtered = items.filter(item => item.id !== id);
    ensureDir();
    fs.writeFileSync(QUEUE_FILE, filtered.map(item => JSON.stringify(item)).join('\n') + (filtered.length ? '\n' : ''), 'utf8');
}

export function updateQueueItem(id: string, errorMsg: string) {
    const items = readQueue().reverse();
    const updated = items.map(item => {
        if (item.id === id) {
            return {
                ...item,
                errorMsg,
                attempts: item.attempts + 1,
                lastAttemptAt: new Date().toISOString()
            };
        }
        return item;
    });
    ensureDir();
    fs.writeFileSync(QUEUE_FILE, updated.map(item => JSON.stringify(item)).join('\n') + (updated.length ? '\n' : ''), 'utf8');
}
