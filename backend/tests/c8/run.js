// npm run test:c8 -> every tests/c8/*.test.js through node:test (C8 store compliance: FSSAI / GSTIN / PAN /
// payout validation, audited admin edits, FSSAI verification, listing filter; order receipts: numbering,
// immutability, totals, access control, signed links, tax display settings).
//   npm run test:c8 -- receipts   (only files whose name contains "receipts")
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
