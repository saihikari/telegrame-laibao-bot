import express from 'express';
import basicAuth from 'basic-auth';
import { getConfig, saveConfig, backupConfig, getLastModified, getBackupCount } from './config-loader';
import { isSheetsReady } from './sheets-service';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

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

app.get('/admin/config', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Config Management</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background-color: #f9f9f9; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          textarea { width: 100%; height: 400px; font-family: monospace; padding: 10px; margin-top: 10px; }
          button { padding: 10px 15px; margin-top: 10px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px; }
          .footer { margin-top: 30px; text-align: center; color: #777; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Config Management</h2>
          <button onclick="backupConfig()">Backup Config</button>
          <textarea id="configText"></textarea>
          <br>
          <button onclick="saveConfig()">Save & Reload Config</button>
          <div class="footer">机器人系统由RuntoAds技术团队提供支持</div>
        </div>
        <script>
          fetch('/api/config').then(res => res.json()).then(data => {
            document.getElementById('configText').value = JSON.stringify(data, null, 2);
          });

          function saveConfig() {
            try {
              const config = JSON.parse(document.getElementById('configText').value);
              fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
              }).then(res => res.json()).then(res => {
                if (res.success) alert('Saved and reloaded successfully');
                else alert('Failed to save config');
              });
            } catch (e) {
              alert('Invalid JSON format!');
            }
          }

          function backupConfig() {
            fetch('/api/config/backup', { method: 'POST' }).then(res => res.json()).then(res => {
              if (res.success) alert('Backed up to ' + res.filename);
              else alert('Backup failed');
            });
          }
        </script>
      </body>
    </html>
  `);
});

app.get('/admin/status', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Status & Help</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background-color: #f4f7f6; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          pre { background: #f0f0f0; padding: 10px; border-radius: 4px; }
          .footer { margin-top: 30px; text-align: center; color: #777; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Bot Status</h2>
          <pre id="status"></pre>
          <h2>Help & FAQ</h2>
          <ul>
            <li><strong>/id</strong> - 获取当前群Chat ID</li>
            <li><strong>/test</strong> - 测试内部群连通性</li>
            <li><strong>/help</strong> - 查看帮助</li>
            <li><strong>/status</strong> - 获取状态页URL</li>
            <li><strong>/customer</strong> - 列出所有客户名称</li>
          </ul>
          <div class="footer">机器人系统由RuntoAds技术团队提供支持</div>
        </div>
        <script>
          function fetchStatus() {
            fetch('/api/status').then(res => res.json()).then(data => {
              document.getElementById('status').innerText = JSON.stringify(data, null, 2);
            });
          }
          fetchStatus();
          setInterval(fetchStatus, 30000); // 30s refresh
        </script>
      </body>
    </html>
  `);
});

app.get('/admin/guide', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>User Guide</title>
        <style>
          body { font-family: 'Comic Sans MS', cursive, sans-serif; background-color: #e0f7fa; color: #006064; padding: 20px; }
          .card { background: white; border-radius: 16px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
          h2 { color: #00838f; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🌸 欢迎语</h2>
          <p>你好呀！我是你的小助手 🤖。我能帮你自动抓取群里的特定消息并录入到系统里哦！</p>
        </div>
        <div class="card">
          <h2>📋 怎么触发我</h2>
          <p>当你的消息包含“名称”+“链接”，或者“链接”+“命名”，且包含你设置的关键词时，我就会出现啦！</p>
        </div>
        <div class="card">
          <h2>🤔 FAQ</h2>
          <p><strong>Q: 为什么机器人不回复？</strong><br>A: 请检查消息是否包含触发词，且没有包含排除词哦！</p>
          <p><strong>Q: 忘记关键词了怎么办？</strong><br>A: 在群里发送 /customer 就可以查看啦！</p>
        </div>
        <div style="text-align: center;">
          <button onclick="window.location.href='/admin/status'" style="padding: 10px 20px; border-radius: 20px; background: #00bcd4; color: white; border: none; cursor: pointer;">返回状态页</button>
        </div>
      </body>
    </html>
  `);
});

app.get('/admin/customize', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Custom Bot Services</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f2f5; margin: 0; padding: 0; }
          .header { background: #1a237e; color: white; padding: 40px 20px; text-align: center; }
          .container { max-width: 900px; margin: 20px auto; padding: 20px; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
          .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); text-align: center; }
          .footer { text-align: center; margin-top: 40px; padding: 20px; background: #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🤖 RuntoAds 定制机器人服务</h1>
          <p>为您提供专业的自动化解决方案</p>
        </div>
        <div class="container">
          <h2>我们的服务类型</h2>
          <div class="grid">
            <div class="card"><h3>📦 电商订单</h3><p>自动处理与提醒</p></div>
            <div class="card"><h3>📊 数据采集</h3><p>精准抓取与分析</p></div>
            <div class="card"><h3>👥 社群管理</h3><p>智能问答与维护</p></div>
            <div class="card"><h3>📝 表单录入</h3><p>无缝对接Google Sheets</p></div>
          </div>
          <h2>为什么选择我们？</h2>
          <ul>
            <li>7x24小时稳定运行</li>
            <li>私有化部署，数据安全</li>
            <li>可配置的Web管理后台</li>
            <li>完整源码交付</li>
          </ul>
        </div>
        <div class="footer">
          <p>联系我们: contact@runtoads.top | https://www.runtoads.top | TG: @runtoads_support</p>
          <a href="/admin/status">返回首页</a>
        </div>
      </body>
    </html>
  `);
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
