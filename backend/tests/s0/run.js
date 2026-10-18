// npm run test:s0 -> every tests/s0/*.test.js through node:test (S0 security batch: privacy + abuse P1s:
// legacy chat masking, After Dark kicks, friend-message groups, student-only social routes, contact search
// budget, public config allow-list, private chat / order media, campus-only spots, shared-cart limits,
// auth cache / store visibility / community feed quick wins).
//   npm run test:s0 -- media   (only files whose name contains "media")
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
