// npm run test:cb -> every tests/cb/*.test.js through node:test (In-Campus Booking, 27 Oct 2026): the status
// machine, student / stall / admin isolation, the 1.5 % commission, pickup codes, closed stalls, payment proof.
//   npm run test:cb -- machine   (only files whose name contains "machine")
// Uses the c5 harness (real routes on a temp SQLite file, stubbed Firebase); never touches a real database.
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
