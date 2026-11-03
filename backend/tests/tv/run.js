// npm run test:tv -> every tests/tv/*.test.js through node:test (owner-only test data: utils/testView +
// scripts/test_data_v2_seed.js, owner 3 Nov 2026: test data on the live server that only the owner's accounts see).
//   node tests/tv/run.js removal   (only files whose name contains "removal")
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
