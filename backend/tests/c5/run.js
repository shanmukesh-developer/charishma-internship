// npm run test:c5 -> every tests/c5/*.test.js through node:test (C5 wallet ledger: ledger unit +
// concurrency, every money path, admin adjust, opening balances, reconciliation, history endpoints).
//   npm run test:c5 -- paths   (only files whose name contains "paths")
// node-sqlite3 runs statements on the libuv pool: 20 parallel transactions need more than 4 threads.
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
