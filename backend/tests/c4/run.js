// npm run test:c4 -> every tests/c4/*.test.js through node:test (C4 legal: pages, settings, consent,
// admin endpoints + audit).
//   npm run test:c4 -- pages   (only files whose name contains "pages")
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
