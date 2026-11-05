// npm run test:promo -> every tests/promo/*.test.js through node:test (owner, 5 Nov 2026: "Have a promo link. If
// they have more downloads from that link, then they will get paid. Rs 100 for every 200 downloads." + typed
// promoter codes at sign-up). Install referrer reports, link / code credit for NEW accounts only, once per
// device / account / number, earnings + payouts, admin-only access, the /p/<CODE> short link.
//   npm run test:promo -- payouts   (only files whose name contains "payouts")
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const only = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).filter((f) => !only.length || only.some((o) => f.includes(o))).sort().map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test' },
});
process.exit(r.status === null ? 1 : r.status);
