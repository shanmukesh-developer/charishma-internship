// npm run test:c7 -> every tests/c7/*.test.js through node:test (C7 rentals safety: Rent / Borrow wording,
// per-booking terms, pickup / return condition photos, extra-charges cap + accept / dispute / timeout /
// admin resolve, licence uniqueness / expiry, campus scoping).
//   npm run test:c7 -- charges   (only files whose name contains "charges")
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
