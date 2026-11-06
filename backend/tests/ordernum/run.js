// npm run test:ordernum -> every tests/ordernum/*.test.js through node:test (human order IDs, owner 6 Nov 2026:
// "ZEN-<n>", one running count across the whole server). Numbering at creation (first is 1, sequential, unique
// under parallel checkouts and per-restaurant baskets, never client-set, never changed), the oldest-first boot
// backfill (idempotent, fresh database, shared with MegaBaskets / CampusBookings) and orderCode in the payloads.
//   npm run test:ordernum -- backfill   (only files whose name contains "backfill")
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
