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

// Real-time SSE Live Event Stream clients
let sseClients = [];

function notifyClients(lead, stats) {
  const payload = `data: ${JSON.stringify({ lead, stats })}\n\n`;
  sseClients.forEach(c => c.write(payload));
}

function handleRequest(req, res) {
  // CORS Headers matching original GitHub repository
  const origin = req.headers.origin;
  const allowedOrigins = ['http://localhost:3001', 'http://127.0.0.1:8000', 'http://127.0.0.1:8080', 'https://nova-ecosystem.loca.lt'];

  res.setHeader('Access-Control-Allow-Origin', (origin && allowedOrigins.includes(origin)) ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Cache-Control', 'no-cache');

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

  // SSE Live Stream Endpoint
  if (req.url === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 2000\n\n');
    sseClients.push(res);
    req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
    return;
  }

  // Yoomoney Webhook Endpoint
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
          console.error('[PAYMENT ERROR] Invalid SHA-1 hash');
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

  // Save Lead (POST /api/leads)
  if (req.url === '/api/leads' && req.method === 'POST') {
    readBody(req, (body) => {
      try {
        const lead = JSON.parse(body);
        const saved = db.addLead(lead);
        notifyClients(saved, db.getStats());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, lead: saved }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed JSON' }));
      }
    });
    return;
  }

  // Get Leads (GET /api/leads)
  if (req.url.startsWith('/api/leads') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      stats: db.getStats(),
      leads: db.getLeads(200)
    }));
    return;
  }

  // Dashboard API Status
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

  // ORIGINAL DESIGN FROM 14 DAYS AGO (GITHUB REPO: Dominantoyou/telegram-auth-bot)
  if (req.url === '/' || req.url === '/dashboard' || req.url.startsWith('/dashboard')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const stats = db.getStats();
    const leads = db.getLeads(100);

    res.end(`
      <!DOCTYPE html>
      <html lang="ru">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Nova AI Agent & System Dashboard</title>
          <style>
            body { background: #0f172a; color: #f8fafc; font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 40px; }
            .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; max-width: 900px; margin: 0 auto 20px auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            h1 { color: #38bdf8; font-weight: 600; margin-top: 0; display: flex; justify-content: space-between; align-items: center; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
            .stat-box { background: #1e293b; border-radius: 12px; padding: 16px; text-align: center; border: 1px solid #334155; }
            .stat-val { font-size: 32px; font-weight: bold; color: #38bdf8; }
            .stat-lbl { color: #94a3b8; font-size: 14px; margin-top: 4px; }
            .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 12px; border-radius: 20px; font-size: 13px; }
            .live-badge { background: #059669; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
            .pulse { width: 8px; height: 8px; background: #34d399; border-radius: 50%; animation: p 1.5s infinite; }
            @keyframes p { 0% { opacity:0.3; } 50% { opacity:1; } 100% { opacity:0.3; } }
            
            .leads-section { margin-top: 24px; border-top: 1px solid #334155; padding-top: 20px; }
            .lead-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
            .lead-header { display: flex; justify-content: space-between; color: #38bdf8; font-weight: bold; margin-bottom: 8px; }
            .lead-text { color: #cbd5e1; font-size: 14px; line-height: 1.4; background: #0f172a; padding: 10px; border-radius: 8px; }
            .lead-meta { font-size: 12px; color: #94a3b8; margin-top: 8px; display: flex; justify-content: space-between; }
            .empty { text-align: center; color: #94a3b8; padding: 30px; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>
              <span>🤖 Nova AI Agent & Payment Dashboard</span>
              <span class="live-badge"><span class="pulse"></span> LIVE REALTME</span>
            </h1>
            <p><span class="badge">Платежный шлюз ЮMoney Подключен</span> &nbsp; Бот: <strong>@nova_authorization_bot</strong></p>
            
            <div class="grid">
              <div class="stat-box">
                <div class="stat-val" id="usersVal">${stats.usersCount}</div>
                <div class="stat-lbl">Пользователей</div>
              </div>
              <div class="stat-box">
                <div class="stat-val" id="leadsVal">${stats.leadsCount}</div>
                <div class="stat-lbl">Лидов в БД</div>
              </div>
              <div class="stat-box">
                <div class="stat-val">100%</div>
                <div class="stat-lbl">ЮMoney SHA-1</div>
              </div>
            </div>

            <div class="leads-section">
              <h2 style="font-size: 18px; color: #f8fafc; margin-bottom: 16px;">💬 Настоящие лиды из Telegram (Live Real-Time)</h2>
              <div id="leadsList"></div>
            </div>
          </div>

          <script>
            let currentLeads = ${JSON.stringify(leads)};

            function renderLeads() {
              const list = document.getElementById('leadsList');
              list.innerHTML = '';

              if (!currentLeads || currentLeads.length === 0) {
                list.innerHTML = '<div class="empty">🟢 Парсер 24/7 активен. Настоящих новых заявок пока нет. Как только человек напишет вопрос в Telegram — он появится здесь в режиме реального времени без перезагрузки.</div>';
                return;
              }

              currentLeads.forEach(lead => {
                const item = document.createElement('div');
                item.className = 'lead-card';
                const username = lead.username || 'Аноним';
                const tgUrl = username !== 'Аноним' ? 'https://t.me/' + username.replace('@','') : '#';

                item.innerHTML = \`
                  <div class="lead-header">
                    <a href="\${tgUrl}" target="_blank" style="color: #38bdf8; text-decoration: none;">👤 \${username}</a>
                    <span style="color: #f43f5e;">Оценка: \${lead.score || 7}/10</span>
                  </div>
                  <div class="lead-text">«\${lead.bio || ''}»</div>
                  <div class="lead-meta">
                    <span>📍 \${lead.sourceChannel || 'Telegram'}</span>
                    <a href="\${tgUrl}" target="_blank" style="color: #38bdf8;">Написать в Telegram ↗</a>
                  </div>
                \`;
                list.appendChild(item);
              });
            }

            // Real-time EventSource for instant push updates
            function initSSE() {
              const source = new EventSource('/api/stream');
              source.onmessage = function(e) {
                try {
                  const data = JSON.parse(e.data);
                  if (data && data.lead) {
                    currentLeads.unshift(data.lead);
                    if (data.stats) {
                      document.getElementById('usersVal').innerText = data.stats.usersCount;
                      document.getElementById('leadsVal').innerText = data.stats.leadsCount;
                    }
                    renderLeads();
                  }
                } catch(err) {}
              };
              source.onerror = function() {
                source.close();
                setTimeout(initSSE, 3000);
              };
            }

            // Live polling fallback every 2 seconds
            async function pollData() {
              try {
                const res = await fetch('/api/leads');
                const data = await res.json();
                if (data && data.leads) {
                  currentLeads = data.leads;
                  if (data.stats) {
                    document.getElementById('usersVal').innerText = data.stats.usersCount;
                    document.getElementById('leadsVal').innerText = data.stats.leadsCount;
                  }
                  renderLeads();
                }
              } catch(e) {}
            }

            initSSE();
            setInterval(pollData, 2000);
            renderLeads();
          </script>
        </body>
      </html>
    `);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

// Server on Port 8000
const server8000 = http.createServer(handleRequest);
server8000.listen(8000, '0.0.0.0', () => {
  console.log('Nova Original Server running on http://127.0.0.1:8000/dashboard');
});

// Mirror Server on Port 3001
const server3001 = http.createServer(handleRequest);
server3001.listen(3001, '0.0.0.0', () => {
  console.log('Nova Original Server running on http://localhost:3001');
});
