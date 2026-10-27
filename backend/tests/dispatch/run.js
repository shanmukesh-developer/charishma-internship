// npm-free runner: node tests/dispatch/run.js [name-filter] -> every tests/dispatch/*.test.js through node:test.
// Rider jobs (27 Oct 2026, utils/riderJobs): service pickups and shopping lists reach on-duty riders (live event +
// push), the claim / release / stage flow, and the customer + rider notices for every step.
// Uses the c5 / slots harness (real routes on a temp SQLite file, stubbed Firebase); never touches a real database.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const only = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).filter((f) => !only.length || only.some((o) => f.includes(o))).sort().map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', UV_THREADPOOL_SIZE: '64', DELIVERY_SLOTS: 'on' },
});
process.exit(r.status === null ? 1 : r.status);
