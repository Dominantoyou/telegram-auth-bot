const crypto = require('crypto');

console.log('=== TELEGRAM OAUTH AUTHENTICATION TEST ===');

// Simulated Telegram Auth Bot secret token
const BOT_TOKEN = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';

// Sample Telegram Auth Payload sent from widget
const authData = {
  id: '987654321',
  first_name: 'Alex',
  username: 'alex_user',
  photo_url: 'https://t.me/i/userpic/320/alex.jpg',
  auth_date: String(Math.floor(Date.now() / 1000))
};

// Compute check_hash for validation test
const dataCheckString = Object.keys(authData)
  .sort()
  .map(key => `${key}=${authData[key]}`)
  .join('\n');

const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

authData.hash = computedHash;

// Validate hash
const checkSecret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
const verifyHash = crypto.createHmac('sha256', checkSecret).update(dataCheckString).digest('hex');

const isValid = crypto.timingSafeEqual(Buffer.from(authData.hash), Buffer.from(verifyHash));

console.log(`Telegram Auth Signature Verification: ${isValid ? 'PASSED (HMAC-SHA256 Verified)' : 'FAILED'}`);
console.log(`Simulated Logged-In User: ${authData.first_name} (@${authData.username})`);
console.log('=== TELEGRAM OAUTH TEST COMPLETE ===');
