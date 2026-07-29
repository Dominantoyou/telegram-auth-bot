const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

// Load environment variables
const envFile = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const tokenMatch = envFile.match(/TELEGRAM_BOT_TOKEN=(.+)/);
const BOT_TOKEN = tokenMatch ? tokenMatch[1].trim() : '';

const stats = {
  requests: 0,
  leadsParsed: 0,
  authUsers: []
};

const server = http.createServer((req, res) => {
  stats.requests++;

  // Telegram OAuth verification endpoint
  if (req.url === '/api/auth/telegram' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const authData = JSON.parse(body);
        const hash = authData.hash;
        delete authData.hash;

        const dataCheckString = Object.keys(authData)
          .sort()
          .map(key => `${key}=${authData[key]}`)
          .join('\n');

        const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
        const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computedHash))) {
          stats.authUsers.push(authData);
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

  if (req.url === '/api/dashboard') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      botUsername: '@nova_authorization_bot',
      authenticatedUsersCount: stats.authUsers.length,
      requestsCount: stats.requests
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html>
      <head><title>Nova Agent Auth</title></head>
      <body style="font-family:sans-serif; text-align:center; padding:50px;">
        <h1>Авторизация в Nova Agent</h1>
        <script async src="https://telegram.org/js/telegram-widget.js?22" 
                data-telegram-login="nova_authorization_bot" 
                data-size="large" 
                data-auth-url="http://localhost:3001/api/auth/telegram" 
                data-request-access="write"></script>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Nova Agent Server running with Telegram Bot @nova_authorization_bot on port ${PORT}`);
});
