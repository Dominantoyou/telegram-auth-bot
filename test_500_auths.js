const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
const tokenMatch = envFile.match(/TELEGRAM_BOT_TOKEN=(.+)/);
const BOT_TOKEN = tokenMatch ? tokenMatch[1].trim() : '';

const CONCURRENCY = 500;
console.log(`Starting Telegram OAuth Stress Test: ${CONCURRENCY} concurrent authorization requests...`);

let completed = 0;
let failed = 0;
let validSignatures = 0;
const startTime = Date.now();

function generateAuthPayload(index) {
  const authData = {
    id: String(100000000 + index),
    first_name: `User_${index}`,
    username: `user_${index}_test`,
    photo_url: `https://t.me/i/userpic/320/user_${index}.jpg`,
    auth_date: String(Math.floor(Date.now() / 1000))
  };

  const dataCheckString = Object.keys(authData)
    .sort()
    .map(key => `${key}=${authData[key]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  authData.hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return JSON.stringify(authData);
}

function sendAuthRequest(index) {
  const payload = generateAuthPayload(index);

  const req = http.request({
    hostname: 'localhost',
    port: 3001,
    path: '/api/auth/telegram',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        validSignatures++;
      } else {
        failed++;
      }
      completed++;
      checkDone();
    });
  });

  req.on('error', (err) => {
    failed++;
    completed++;
    checkDone();
  });

  req.write(payload);
  req.end();
}

function checkDone() {
  if (completed === CONCURRENCY) {
    const duration = (Date.now() - startTime) / 1000;
    const rps = (completed / duration).toFixed(2);

    console.log('=== 500 TELEGRAM AUTHS STRESS TEST RESULTS ===');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Total Requests: ${completed}`);
    console.log(`Successful HMAC Authorizations: ${validSignatures}`);
    console.log(`Failed Authorizations: ${failed}`);
    console.log(`Authorization RPS: ${rps} auths/sec`);
    process.exit(0);
  }
}

// Fire 500 concurrent authorizations
for (let i = 0; i < CONCURRENCY; i++) {
  sendAuthRequest(i);
}
