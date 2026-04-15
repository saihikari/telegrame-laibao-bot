import express from 'express';
import { getConfig, saveConfig, backupConfig, getLastModified, getBackupCount, listBackups, restoreBackup } from './config-loader';
import { processMessage } from './rule-engine';
import { isSheetsReady } from './sheets-service';
import { getBotInstance } from './telegram-bot';
import bodyParser from 'body-parser';

import path from 'path';
import crypto from 'crypto';

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// 提供前端静态文件服务 (统一部署)，放在 Auth 之后
// ...
const startTimestamp = Date.now();

const COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const getSessionSecret = () => process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '';

const parseCookies = (cookieHeader: string | undefined) => {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    result[key] = decodeURIComponent(value);
  }
  return result;
};

const base64UrlEncode = (input: string) =>
  Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const base64UrlDecode = (input: string) => {
  const pad = input.length % 4;
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + (pad ? '='.repeat(4 - pad) : '');
  return Buffer.from(normalized, 'base64').toString('utf8');
};

const sign = (payloadB64: string) => {
  const secret = getSessionSecret();
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
};

const createSessionToken = (username: string) => {
  const payload = JSON.stringify({
    u: username,
    i: Date.now(),
    r: crypto.randomBytes(16).toString('hex')
  });
  const payloadB64 = base64UrlEncode(payload);
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
};

const verifySessionToken = (token: string | undefined, expectedUsername: string) => {
  if (!token) return false;
  const secret = getSessionSecret();
  if (!secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expectedSig = sign(payloadB64);
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  } catch {
    return false;
  }
  try {
    const payloadRaw = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadRaw) as { u: string; i: number };
    if (!payload?.u || !payload?.i) return false;
    if (payload.u !== expectedUsername) return false;
    if (Date.now() - payload.i > SESSION_MAX_AGE_SECONDS * 1000) return false;
    return true;
  } catch {
    return false;
  }
};

const setSessionCookie = (res: express.Response, token: string) => {
  const secure = process.env.WEB_DOMAIN?.startsWith('https') || process.env.ADMIN_COOKIE_SECURE === 'true';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${secure ? 'None' : 'Lax'}`,
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
};

const clearSessionCookie = (res: express.Response) => {
  const secure = process.env.WEB_DOMAIN?.startsWith('https') || process.env.ADMIN_COOKIE_SECURE === 'true';
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${secure ? 'None' : 'Lax'}`,
    'Max-Age=0'
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
};

const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return next();
  const cookies = parseCookies(req.headers.cookie);
  if (verifySessionToken(cookies[COOKIE_NAME], username)) return next();
  const accept = req.headers.accept || '';
  if (req.method === 'GET' && accept.includes('text/html')) {
    return res.redirect('/admin/login');
  }
  return res.status(401).json({ success: false, error: 'Unauthorized' });
};

app.get('/admin/login', (req, res) => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return res.redirect('/admin/');
  const cookies = parseCookies(req.headers.cookie);
  if (verifySessionToken(cookies[COOKIE_NAME], username)) return res.redirect('/admin/');
  const error = req.query.error ? '用户名或密码错误' : '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>登录 - 规则引擎综合管理后台</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    body{margin:0;font-family:Inter,Roboto,system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:var(--tg-theme-secondary-bg-color, #F8FAFC);color:var(--tg-theme-text-color, #0f172a)}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{width:100%;max-width:420px;background:var(--tg-theme-bg-color, #fff);border:1px solid rgba(0,0,0,0.1);border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,.06);padding:22px}
    h1{margin:0 0 6px 0;font-size:20px}
    p{margin:0 0 18px 0;color:var(--tg-theme-hint-color, #64748b);font-size:13px;line-height:1.4}
    label{display:block;font-size:12px;color:var(--tg-theme-text-color, #334155);margin:12px 0 6px}
    input{width:100%;box-sizing:border-box;border:1px solid var(--tg-theme-hint-color, #cbd5e1);border-radius:10px;padding:10px 12px;font-size:14px;outline:none;background:var(--tg-theme-bg-color, #fff);color:var(--tg-theme-text-color, #000)}
    input:focus{border-color:var(--tg-theme-button-color, #06b6d4);box-shadow:0 0 0 3px rgba(6,182,212,.15)}
    .btn{margin-top:16px;width:100%;border:0;border-radius:10px;padding:10px 12px;background:var(--tg-theme-button-color, #1E3A8A);color:var(--tg-theme-button-text-color, #fff);font-weight:600;font-size:14px;cursor:pointer}
    .btn:hover{opacity:.95}
    .btn-outline{background:transparent;border:1px solid var(--tg-theme-button-color, #1E3A8A);color:var(--tg-theme-button-color, #1E3A8A);margin-top:10px}
    .btn-outline:hover{background:rgba(30,58,138,0.05)}
    .err{margin-top:12px;color:#dc2626;font-size:13px}
    .hidden{display:none !important}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card" id="login-card">
      <h1>登录</h1>
      <p>请输入管理后台用户名与密码</p>
      <form method="post" action="/api/login" id="fallback-login">
        <label>用户名</label>
        <input name="username" autocomplete="username" required />
        <label>密码</label>
        <input name="password" type="password" autocomplete="current-password" required />
        <input type="hidden" name="redirect" value="/admin/" />
        <button class="btn" type="submit">登录并进入后台</button>
        ${error ? `<div class="err">${error}</div>` : ''}
        <div id="tg-err" class="err"></div>
      </form>
      
      <div id="tg-unauth-guide" class="hidden">
        <h1 style="color:var(--tg-theme-destructive-text-color, #ef4444)">无访问权限</h1>
        <p>您的 Telegram 账号未被授权访问此管理后台。<br>如果您需要权限或相关服务，请点击下方按钮联系我们：</p>
        
        <button class="btn" onclick="window.Telegram.WebApp.openTelegramLink('https://t.me/hikarillll?text=' + encodeURIComponent('本公司员工希望获取管理员权限，我的ID是: ') + window.tgUserId)">
          申请管理员权限 (本公司员工)
        </button>
        
        <button class="btn btn-outline" onclick="window.Telegram.WebApp.openTelegramLink('https://t.me/hikarillll?text=' + encodeURIComponent('非本公司员工，我对来包机器人感兴趣，希望定制开发服务。'))">
          咨询定制开发服务 (非员工)
        </button>
        
        <div style="margin-top:20px;text-align:center;font-size:12px;color:var(--tg-theme-hint-color, #64748b)">
          如需手动登录，请 <a href="#" onclick="document.getElementById('tg-unauth-guide').classList.add('hidden');document.getElementById('fallback-login').classList.remove('hidden');return false;" style="color:var(--tg-theme-link-color, #0ea5e9)">点击此处使用账号密码</a>。
        </div>
      </div>
    </div>
  </div>
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      const tg = window.Telegram?.WebApp;
      if (tg && tg.initData) {
        tg.expand();
        // Set Theme Colors based on TG
        document.body.style.backgroundColor = tg.themeParams.secondary_bg_color || 'var(--tg-theme-secondary-bg-color, #F8FAFC)';
        
        if (sessionStorage.getItem('tg_login_redirected')) {
          sessionStorage.removeItem('tg_login_redirected');
          document.getElementById('login-card').classList.remove('hidden');
          document.getElementById('fallback-login').classList.remove('hidden');
          document.getElementById('tg-err').innerText = '浏览器跨域策略拦截了凭证，请使用账号密码登录。';
          return;
        }

        // 隐性加载：在授权完成前，隐藏整个登录卡片，只展示与TG背景色一致的纯色背景
        document.getElementById('login-card').classList.add('hidden');
        
        fetch('/api/tg-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tg.initData })
        }).then(res => res.json()).then(data => {
          if (data.success) {
             sessionStorage.setItem('tg_login_redirected', '1');
             // 确权成功，直接跳转（全程保持卡片隐藏，无缝过渡）
             window.location.href = '/admin/';
          } else if (data.error === 'UNAUTHORIZED_TG_USER_CLOSE_APP') {
             // 确权失败，机器人已发送消息，瞬间关闭WebApp
             tg.close();
          } else if (data.error === 'UNAUTHORIZED_TG_USER') {
             window.tgUserId = data.userId;
             document.getElementById('login-card').classList.remove('hidden');
             document.querySelector('#login-card h1').classList.add('hidden');
             document.querySelector('#login-card p').classList.add('hidden');
             document.getElementById('tg-unauth-guide').classList.remove('hidden');
          } else {
             document.getElementById('login-card').classList.remove('hidden');
             document.querySelector('#login-card h1').innerText = '登录';
             document.querySelector('#login-card p').innerText = '请输入管理后台用户名与密码';
             document.getElementById('fallback-login').classList.remove('hidden');
             document.getElementById('tg-err').innerText = 'Telegram 授权失败：' + (data.error || '未知错误');
          }
        }).catch(e => {
           document.getElementById('login-card').classList.remove('hidden');
           document.getElementById('fallback-login').classList.remove('hidden');
           document.getElementById('tg-err').innerText = '网络错误，请使用账号密码登录';
        });
      }
    });
  </script>
</body>
</html>`);
});

function verifyTelegramWebAppData(telegramInitData: string): any {
  if (!process.env.BOT_TOKEN) return null;
  const initData = new URLSearchParams(telegramInitData);
  const hash = initData.get('hash');
  if (!hash) return null;

  initData.delete('hash');
  const keys = Array.from(initData.keys());
  keys.sort();
  const dataCheckString = keys.map(key => `${key}=${initData.get(key)}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const _hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (hash !== _hash) return null;

  const userStr = initData.get('user');
  if (userStr) {
    try {
      return JSON.parse(userStr);
    } catch (e) {
      return null;
    }
  }
  return null;
}

app.post('/api/tg-login', express.json(), (req, res) => {
  const initData = req.body?.initData;
  if (!initData) return res.status(400).json({ success: false, error: 'No initData provided' });

  const tgUser = verifyTelegramWebAppData(initData);
  if (!tgUser) return res.status(401).json({ success: false, error: 'Invalid Telegram data' });

  const allowedIdsStr = process.env.ADMIN_TG_IDS || '8413696128';
  const allowedIds = allowedIdsStr.split(',').map(id => id.trim()).filter(id => id);
  
  if (allowedIds.length === 0) {
    return res.status(403).json({ success: false, error: '服务器未配置 ADMIN_TG_IDS，无法使用 Telegram 登录。请在 .env 中配置。你的 ID 是: ' + tgUser.id });
  }

  if (!allowedIds.includes(tgUser.id.toString())) {
    const bot = getBotInstance();
    if (bot) {
      const msgText = `❌ *无访问权限*\n您的 Telegram 账号未被授权访问此管理后台。\n\n如果您需要权限或相关服务，请点击下方按钮联系我们：`;
      const opts = {
        parse_mode: 'Markdown' as const,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'RunToAds员工申请管理员权限',
                url: `https://t.me/hikarillll?text=${encodeURIComponent('本公司员工希望获取管理员权限，我的ID是: ' + tgUser.id)}`
              }
            ],
            [
              {
                text: '合作伙伴咨询定制开发服务',
                url: `https://t.me/hikarillll?text=${encodeURIComponent('非本公司员工，我对来包机器人感兴趣，希望定制开发服务。')}`
              }
            ]
          ]
        }
      };
      // 尝试向该用户发送消息
      bot.sendMessage(tgUser.id, msgText, opts).catch(e => {
        console.error('Failed to send unauthorized message to user', e);
      });
    }

    return res.status(403).json({ 
      success: false, 
      error: 'UNAUTHORIZED_TG_USER_CLOSE_APP',
      userId: tgUser.id
    });
  }

  const username = process.env.ADMIN_USERNAME || 'admin';
  const token = createSessionToken(username);
  setSessionCookie(res, token);
  return res.json({ success: true });
});

app.post('/api/login', (req, res) => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return res.redirect('/admin/');
  const inputUser = (req.body?.username || '').toString();
  const inputPass = (req.body?.password || '').toString();
  const redirectRaw = (req.body?.redirect || '/admin/').toString();
  const redirectTo = redirectRaw.startsWith('/') ? redirectRaw : '/admin/';
  if (inputUser === username && inputPass === password) {
    const token = createSessionToken(username);
    setSessionCookie(res, token);
    return res.redirect(redirectTo);
  }
  return res.redirect('/admin/login?error=1');
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/admin/login');
});

app.get('/admin/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/admin/login');
});

app.use('/admin', requireAuth);
app.use('/api', requireAuth);

// 添加全局无缓存中间件，强制浏览器不缓存 HTML 静态资源
const noCacheMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};

// MUST use strict path mapping for the SPA base path
// to ensure /admin serves index.html and /admin/ works too
const publicPath = path.join(__dirname, '../../public');
app.use('/admin', noCacheMiddleware, express.static(publicPath));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Fallback to index.html for React Router / SPA navigation
app.get(['/admin', '/admin/config', '/admin/status', '/admin/guide', '/admin/customize', '/admin/test', '/admin/json'], noCacheMiddleware, (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
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

app.get('/api/config/backups', (req, res) => {
  const list = listBackups();
  res.json({ success: true, backups: list });
});

app.post('/api/config/restore', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Missing filename' });
  const result = restoreBackup(filename);
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
