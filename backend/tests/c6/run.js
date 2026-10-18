// npm run test:c6 -> every tests/c6/*.test.js through node:test (C6 rider COD cash ledger, cash limit,
// deposits, one earnings rule, commission snapshot, payout statements, reconciliation).
//   npm run test:c6 -- payouts   (only files whose name contains "payouts")
// node-sqlite3 runs statements on the libuv pool: parallel transactions need more than 4 threads.
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
