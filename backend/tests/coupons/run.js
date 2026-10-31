// npm run test:coupons -> every tests/coupons/*.test.js through node:test (owner, 31 Oct 2026: "coupons are the main
// thing: we run events, and if the coupon system fails we lose money"). Checkout rules, parallel use, cancel / refund
// restore, and every place a coupon comes from (admin, Lucky Spin, Vault deals, Wall contest winners).
//   npm run test:coupons -- sources   (only files whose name contains "sources")
// node-sqlite3 runs statements on the libuv pool: parallel orders need more than 4 threads.
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
