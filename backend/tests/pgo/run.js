// npm run test:pgo (or node tests/pgo/run.js) -> every tests/pgo/*.test.js through node:test (ZCS PG Partner:
// owner scope, accept / reject / move-out + student notifications, availability -> customer counts,
// temporary password change, login rate limits, mess holidays, rent ledger, complaints).
//   node tests/pgo/run.js scope   (only files whose name contains "scope")
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
