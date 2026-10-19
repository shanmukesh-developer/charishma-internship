// npm run test:pg -> every tests/pg/*.test.js through node:test (PG listing content: photo gallery limits /
// categories / order / cover, YouTube link parsing, admin-only videos, mess timetable + timings validation,
// public read shapes without private fields; v2: sections, hidden-when-empty contract, reviews, promotions,
// GET /api/pg/home).
//   npm run test:pg -- content   (only files whose name contains "content")
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
