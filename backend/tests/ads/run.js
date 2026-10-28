// npm run test:ads -> every tests/ads/*.test.js through node:test (splash ads: GET /api/ads/splash list shape,
// eligibility window / store listing / priority order, up to 2 products, private store fields stripped, cache
// dropped on admin and store writes; admin CRUD validation, one active ad per style (409), admin only).
//   npm run test:ads -- splash   (only files whose name contains "splash")
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
