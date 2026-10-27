// node tests/pt/run.js -> every tests/pt/*.test.js through node:test (partner-app test logins: the startup seed
// scripts/partner_test_accounts_seed.js against a temp SQLite file, then each account through its app's real
// auth route; the committed data file never holds a plaintext password).
//   node tests/pt/run.js logins   (only files whose name contains "logins")
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const only = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).filter((f) => !only.length || only.some((o) => f.includes(o))).sort().map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', UV_THREADPOOL_SIZE: '64' },
});
process.exit(r.status === null ? 1 : r.status);
