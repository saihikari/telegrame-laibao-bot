"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWebServer = void 0;
const express_1 = __importDefault(require("express"));
const config_loader_1 = require("./config-loader");
const rule_engine_1 = require("./rule-engine");
const sheets_service_1 = require("./sheets-service");
const body_parser_1 = __importDefault(require("body-parser"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const app = (0, express_1.default)();
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: false }));
// 提供前端静态文件服务 (统一部署)，放在 Auth 之后
// ...
const startTimestamp = Date.now();
const COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const getSessionSecret = () => process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const parseCookies = (cookieHeader) => {
    const result = {};
    if (!cookieHeader)
        return result;
    const parts = cookieHeader.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1)
            continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (!key)
            continue;
        result[key] = decodeURIComponent(value);
    }
    return result;
};
const base64UrlEncode = (input) => Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const base64UrlDecode = (input) => {
    const pad = input.length % 4;
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + (pad ? '='.repeat(4 - pad) : '');
    return Buffer.from(normalized, 'base64').toString('utf8');
};
const sign = (payloadB64) => {
    const secret = getSessionSecret();
    return crypto_1.default.createHmac('sha256', secret).update(payloadB64).digest('hex');
};
const createSessionToken = (username) => {
    const payload = JSON.stringify({
        u: username,
        i: Date.now(),
        r: crypto_1.default.randomBytes(16).toString('hex')
    });
    const payloadB64 = base64UrlEncode(payload);
    const sig = sign(payloadB64);
    return `${payloadB64}.${sig}`;
};
const verifySessionToken = (token, expectedUsername) => {
    if (!token)
        return false;
    const secret = getSessionSecret();
    if (!secret)
        return false;
    const parts = token.split('.');
    if (parts.length !== 2)
        return false;
    const [payloadB64, sig] = parts;
    const expectedSig = sign(payloadB64);
    try {
        const sigBuf = Buffer.from(sig, 'hex');
        const expectedBuf = Buffer.from(expectedSig, 'hex');
        if (sigBuf.length !== expectedBuf.length)
            return false;
        if (!crypto_1.default.timingSafeEqual(sigBuf, expectedBuf))
            return false;
    }
    catch {
        return false;
    }
    try {
        const payloadRaw = base64UrlDecode(payloadB64);
        const payload = JSON.parse(payloadRaw);
        if (!payload?.u || !payload?.i)
            return false;
        if (payload.u !== expectedUsername)
            return false;
        if (Date.now() - payload.i > SESSION_MAX_AGE_SECONDS * 1000)
            return false;
        return true;
    }
    catch {
        return false;
    }
};
const setSessionCookie = (res, token) => {
    const secure = process.env.ADMIN_COOKIE_SECURE === 'true';
    const parts = [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`
    ];
    if (secure)
        parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
};
const clearSessionCookie = (res) => {
    const secure = process.env.ADMIN_COOKIE_SECURE === 'true';
    const parts = [
        `${COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0'
    ];
    if (secure)
        parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
};
const requireAuth = (req, res, next) => {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password)
        return next();
    const cookies = parseCookies(req.headers.cookie);
    if (verifySessionToken(cookies[COOKIE_NAME], username))
        return next();
    const accept = req.headers.accept || '';
    if (req.method === 'GET' && accept.includes('text/html')) {
        return res.redirect('/admin/login');
    }
    return res.status(401).json({ success: false, error: 'Unauthorized' });
};
app.get('/admin/login', (req, res) => {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password)
        return res.redirect('/admin/');
    const cookies = parseCookies(req.headers.cookie);
    if (verifySessionToken(cookies[COOKIE_NAME], username))
        return res.redirect('/admin/');
    const error = req.query.error ? '用户名或密码错误' : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>登录 - 规则引擎综合管理后台</title>
  <style>
    body{margin:0;font-family:Inter,Roboto,system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:#F8FAFC;color:#0f172a}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{width:100%;max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 16px rgba(2,6,23,.06);padding:22px}
    h1{margin:0 0 6px 0;font-size:20px}
    p{margin:0 0 18px 0;color:#64748b;font-size:13px;line-height:1.4}
    label{display:block;font-size:12px;color:#334155;margin:12px 0 6px}
    input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font-size:14px;outline:none}
    input:focus{border-color:#06b6d4;box-shadow:0 0 0 3px rgba(6,182,212,.15)}
    .btn{margin-top:16px;width:100%;border:0;border-radius:10px;padding:10px 12px;background:#1E3A8A;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
    .btn:hover{opacity:.95}
    .err{margin-top:12px;color:#dc2626;font-size:13px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>登录</h1>
      <p>请输入管理后台用户名与密码</p>
      <form method="post" action="/api/login">
        <label>用户名</label>
        <input name="username" autocomplete="username" required />
        <label>密码</label>
        <input name="password" type="password" autocomplete="current-password" required />
        <input type="hidden" name="redirect" value="/admin/" />
        <button class="btn" type="submit">登录并进入后台</button>
        ${error ? `<div class="err">${error}</div>` : ''}
      </form>
    </div>
  </div>
</body>
</html>`);
});
app.post('/api/login', (req, res) => {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password)
        return res.redirect('/admin/');
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
const noCacheMiddleware = (req, res, next) => {
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
};
// MUST use strict path mapping for the SPA base path
// to ensure /admin serves index.html and /admin/ works too
const publicPath = path_1.default.join(__dirname, '../../public');
app.use('/admin', noCacheMiddleware, express_1.default.static(publicPath));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
// Fallback to index.html for React Router / SPA navigation
app.get(['/admin', '/admin/config', '/admin/status', '/admin/guide', '/admin/customize', '/admin/test', '/admin/json'], noCacheMiddleware, (req, res) => {
    res.sendFile(path_1.default.join(publicPath, 'index.html'));
});
// APIs
app.get('/api/config', (req, res) => res.json((0, config_loader_1.getConfig)()));
app.post('/api/config', (req, res) => {
    const success = (0, config_loader_1.saveConfig)(req.body);
    res.json({ success });
});
app.post('/api/config/backup', (req, res) => {
    const result = (0, config_loader_1.backupConfig)();
    res.json(result);
});
app.get('/api/config/backups', (req, res) => {
    const list = (0, config_loader_1.listBackups)();
    res.json({ success: true, backups: list });
});
app.post('/api/config/restore', (req, res) => {
    const { filename } = req.body;
    if (!filename)
        return res.status(400).json({ success: false, error: 'Missing filename' });
    const result = (0, config_loader_1.restoreBackup)(filename);
    res.json(result);
});
app.get('/api/status', (req, res) => {
    const config = (0, config_loader_1.getConfig)();
    const rawIds = (process.env.INTERNAL_CHAT_IDS || '').split(',');
    const maskedIds = rawIds.map(id => id.length > 4 ? id.substring(0, id.length - 4) + '****' : '****');
    res.json({
        online: true,
        uptime_seconds: Math.floor((Date.now() - startTimestamp) / 1000),
        customers_count: config.customers.length,
        internal_groups: maskedIds,
        last_modified: (0, config_loader_1.getLastModified)(),
        backups_count: (0, config_loader_1.getBackupCount)(),
        google_sheets_ready: (0, sheets_service_1.isSheetsReady)()
    });
});
app.post('/api/test', (req, res) => {
    try {
        const { text, config } = req.body;
        if (!text || !config) {
            return res.status(400).json({ success: false, error: 'Missing text or config in request body' });
        }
        // Call the rule engine with the provided text and config
        const data = (0, rule_engine_1.processMessage)(text, config);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
const startWebServer = (port) => {
    return new Promise((resolve, reject) => {
        app.listen(port, () => {
            console.log(`[Web Admin] Server started on port ${port}`);
            resolve(true);
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`[Web Admin] Port ${port} is already in use. Exiting...`);
                process.exit(1);
            }
            reject(err);
        });
    });
};
exports.startWebServer = startWebServer;
