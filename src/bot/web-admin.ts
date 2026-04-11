import express from 'express';
import basicAuth from 'basic-auth';
import { getConfig, saveConfig, backupConfig, getLastModified, getBackupCount } from './config-loader';
import { processMessage } from './rule-engine';
import { isSheetsReady } from './sheets-service';
import bodyParser from 'body-parser';

import path from 'path';

const app = express();
app.use(bodyParser.json());

// 提供前端静态文件服务 (统一部署)
app.use('/admin', express.static(path.join(__dirname, '../../public')));

const startTimestamp = Date.now();

// Basic Authentication Middleware
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  
  if (!username || !password) return next();

  const user = basicAuth(req);
  if (!user || user.name !== username || user.pass !== password) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required.');
  }
  next();
};

app.use('/admin', authMiddleware);
app.use('/api', authMiddleware);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// All old HTML routes are now handled by the unified React SPA served at /admin
app.get(['/admin/config', '/admin/status', '/admin/guide', '/admin/customize', '/admin/config-visual'], (req, res) => {
  res.redirect('/admin/');
});

// APIs
app.get('/api/config', (req, res) => res.json(getConfig()));

app.post('/api/config', (req, res) => {
  const success = saveConfig(req.body);
  res.json({ success });
});

app.post('/api/config/backup', (req, res) => {
  const result = backupConfig();
  res.json(result);
});

app.get('/api/status', (req, res) => {
  const config = getConfig();
  const rawIds = (process.env.INTERNAL_CHAT_IDS || '').split(',');
  const maskedIds = rawIds.map(id => id.length > 4 ? id.substring(0, id.length - 4) + '****' : '****');

  res.json({
    online: true,
    uptime_seconds: Math.floor((Date.now() - startTimestamp) / 1000),
    customers_count: config.customers.length,
    internal_groups: maskedIds,
    last_modified: getLastModified(),
    backups_count: getBackupCount(),
    google_sheets_ready: isSheetsReady()
  });
});

app.post('/api/test', (req, res) => {
  try {
    const { text, config } = req.body;
    if (!text || !config) {
      return res.status(400).json({ success: false, error: 'Missing text or config in request body' });
    }
    
    // Call the rule engine with the provided text and config
    const data = processMessage(text, config);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export const startWebServer = (port: number) => {
  return new Promise((resolve, reject) => {
    app.listen(port, () => {
      console.log(`[Web Admin] Server started on port ${port}`);
      resolve(true);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Web Admin] Port ${port} is already in use. Exiting...`);
        process.exit(1);
      }
      reject(err);
    });
  });
};
