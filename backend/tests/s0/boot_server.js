// S0 test launcher (child process): the real server.js on a fresh temp SQLite file, every external service
// blanked / stubbed (Firebase, pushes, WhatsApp, mail), Redis unset. Never touches a real database.
//   env: S0_SQLITE (required), PORT (required). Prints "S0_READY" once the API answers.
const path = require('path');
const BACK = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  DATABASE_URL: '', NODE_ENV: 'development', RENDER: '', REDIS_URL: '', REDIS_ENABLED: '',
  JWT_SECRET: 's0-socket-test-secret', OTP_SECRET: 's0-socket-test-otp',
  FIREBASE_PROJECT_ID: '', FIREBASE_CLIENT_EMAIL: '', FIREBASE_PRIVATE_KEY: '', FIREBASE_SERVICE_ACCOUNT_BASE64: '',
  FAST2SMS_API_KEY: '', BREVO_API_KEY: '', WHATSAPP_PROVIDER: 'CONSOLE', MONGO_URI: '',
  AFTER_DARK_ALWAYS_OPEN: 'true',
});
delete process.env.REDIS_URL;
delete process.env.REDIS_ENABLED;
const SQLITE = process.env.S0_SQLITE;
const origJoin = path.join;
path.join = function (...a) {
  const r = origJoin.apply(this, a);
  if (/local_dev\.sqlite$|local_prod\.sqlite$/.test(r)) return SQLITE;
  return r;
};
const stub = (rel, exports) => {
  const p = require.resolve(origJoin(BACK, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('config/firebase.js', { apps: [], getApps: () => [] });
stub('utils/push.js', { sendPushToTokens: async () => ({ successCount: 0, failureCount: 0, staleTokens: [] }), sendPushToTopic: async () => {} });
stub('utils/whatsappUtil.js', { sendWhatsAppMessage: async () => ({ success: true }), formatOrderMessage: () => '' });
stub('utils/mailer.js', { sendMail: async () => ({ ok: true }), sendVerificationCode: async () => ({ ok: true }), isMailerConfigured: () => false, parseSender: () => ({}) });
process.chdir(BACK);
require(origJoin(BACK, 'server.js'));

// Test-only control port on 127.0.0.1 (S0_CTRL_PORT): POST /eval runs an async function body in this
// process (models are loaded) so the test can seed rows without a second SQLite writer.
if (process.env.S0_CTRL_PORT) {
  const http = require('http');
  http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const fn = new Function('require', 'B', `return (async () => { ${body} })();`);
        const out = await fn(require, BACK);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, out }));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  }).listen(Number(process.env.S0_CTRL_PORT), '127.0.0.1');
}
