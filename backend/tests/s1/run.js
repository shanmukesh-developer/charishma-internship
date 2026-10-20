// npm run test:s1 -> every tests/s1/*.test.js through node:test (S1-lite security batch: Firebase App Check
// modes, admin 2-step sign-in (TOTP), and the quick P2 fixes: Campus Events live-slot review + price cap,
// prototype-safe lookups, Auto-Ride unsuspend / customer gate / no-show grace, organizer gate rights,
// check-in code scope, CSP frame-ancestors, CORS localhost, /uploads mount, click dedupe, driverDetails
// shape, rider vehicle number), and the demo-store menu fill (idempotent, ledger-keyed).
//   npm run test:s1 -- totp   (only files whose name contains "totp")
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
