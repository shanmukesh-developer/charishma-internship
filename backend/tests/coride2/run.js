// node tests/coride2/run.js -> every tests/coride2/*.test.js through node:test. Co-Ride 2 batch: regular-ride
// templates (endpoints + the 5-minute publish job), women-only rides, the profile gender update,
// autoAcceptKnown and passenger SOS. Temp SQLite, stubbed Firebase / pushes; no real database or network.
//   node tests/coride2/run.js sos   (only files whose name contains "sos")
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
