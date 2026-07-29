const https = require('https');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
const tokenMatch = envFile.match(/TELEGRAM_BOT_TOKEN=(.+)/);
const token = tokenMatch ? tokenMatch[1].trim() : '';

console.log('Testing connection to Telegram Bot API...');

https.get(`https://api.telegram.org/bot${token}/getMe`, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.ok) {
        console.log('=== LIVE TELEGRAM BOT CONNECTED ===');
        console.log(`Bot ID: ${response.result.id}`);
        console.log(`Bot Name: ${response.result.first_name}`);
        console.log(`Bot Username: @${response.result.username}`);
        console.log('=== CONNECTION TEST PASSED ===');
      } else {
        console.error('Telegram API Error:', response.description);
      }
    } catch (e) {
      console.error('Failed to parse response:', e.message);
    }
  });
}).on('error', (err) => {
  console.error('HTTP Request Error:', err.message);
});
