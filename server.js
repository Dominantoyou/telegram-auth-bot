const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

// Load environment variables
const envFile = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const tokenMatch = envFile.match(/TELEGRAM_BOT_TOKEN=(.+)/);
const secretMatch = envFile.match(/YOOMONEY_SECRET=(.+)/);

const BOT_TOKEN = tokenMatch ? tokenMatch[1].trim() : '8676730312:AAGs7cZW7dXzJLVLag47CuiJbs9OTqQReGA';
const YOOMONEY_SECRET = secretMatch ? secretMatch[1].trim() : 'k3BWClNXgbUoA7Q7ZJt5NBxD';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB Limit

const server = http.createServer((req, res) => {
  // CORS Headers
  const origin = req.headers.origin;
  const allowedOrigins = ['http://localhost:3001', 'http://127.0.0.1:8000', 'http://127.0.0.1:8080', 'https://nova-ecosystem.loca.lt'];

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  function readBody(req, callback) {
    let body = '';
    let bytesReceived = 0;

    req.on('data', chunk => {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Payload Too Large' }));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (bytesReceived <= MAX_BODY_BYTES) {
        callback(body);
      }
    });
  }

  // Yoomoney HTTP Notification Webhook Endpoint
  if (req.url === '/api/payments/yoomoney' && req.method === 'POST') {
    readBody(req, (body) => {
      try {
        const params = new URLSearchParams(body);
        const notification = {};
        for (const [key, value] of params.entries()) {
          notification[key] = value;
        }

        const checkString = [
          notification.notification_type || '',
          notification.operation_id || '',
          notification.amount || '',
          notification.currency || '',
          notification.datetime || '',
          notification.sender || '',
          notification.codepro || '',
          YOOMONEY_SECRET,
          notification.label || ''
        ].join('&');

        const computedSha1 = crypto.createHash('sha1').update(checkString).digest('hex');

        if (notification.sha1_hash === computedSha1) {
          console.log(`[PAYMENT SUCCESS] Received ${notification.amount} RUB for label: ${notification.label}`);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
        } else {
          console.error('[PAYMENT ERROR] Invalid SHA-1 hash from Yoomoney notification');
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('INVALID_HASH');
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('ERROR');
      }
    });
    return;
  }

  // Telegram OAuth Authentication Endpoint
  if (req.url === '/api/auth/telegram' && req.method === 'POST') {
    readBody(req, (body) => {
      try {
        const authData = JSON.parse(body);
        const hash = authData.hash;
        delete authData.hash;

        const now = Math.floor(Date.now() / 1000);
        const authDate = parseInt(authData.auth_date, 10);
        if (!authDate || (now - authDate) > 86400) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Auth token expired' }));
          return;
        }

        const dataCheckString = Object.keys(authData)
          .sort()
          .map(key => `${key}=${authData[key]}`)
          .join('\n');

        const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
        const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computedHash))) {
          db.addUser(authData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, user: authData }));
        } else {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid Telegram signature' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed JSON' }));
      }
    });
    return;
  }

  // Dashboard API
  if (req.url === '/api/dashboard') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      botUsername: '@nova_authorization_bot',
      yoomoneyConfigured: true,
      dbStats: db.getStats()
    }));
    return;
  }

  // UI Dashboard Page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  const stats = db.getStats();
  res.end(`
    <!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <title>Nova AI Agent & System Dashboard</title>
        <style>
          body { background: #0f172a; color: #f8fafc; font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 40px; }
          .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; max-width: 800px; margin: 0 auto 20px auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          h1 { color: #38bdf8; font-weight: 600; margin-top: 0; }
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
          .stat-box { background: #1e293b; border-radius: 12px; padding: 16px; text-align: center; border: 1px solid #334155; }
          .stat-val { font-size: 32px; font-weight: bold; color: #38bdf8; }
          .stat-lbl { color: #94a3b8; font-size: 14px; margin-top: 4px; }
          .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 12px; border-radius: 20px; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🤖 Nova AI Agent & Payment Dashboard</h1>
          <p><span class="badge">Платежный шлюз ЮMoney Подключен</span> &nbsp; Бот: <strong>@nova_authorization_bot</strong></p>
          
          <div class="grid">
            <div class="stat-box">
              <div class="stat-val">${stats.usersCount}</div>
              <div class="stat-lbl">Пользователей</div>
            </div>
            <div class="stat-box">
              <div class="stat-val">${stats.leadsCount}</div>
              <div class="stat-lbl">Лидов в БД</div>
            </div>
            <div class="stat-box">
              <div class="stat-val">100%</div>
              <div class="stat-lbl">ЮMoney SHA-1</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Nova Server running with Yoomoney Payments on port ${PORT}`);
});
