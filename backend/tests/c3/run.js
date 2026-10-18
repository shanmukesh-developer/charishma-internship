// npm run test:c3 -> every tests/c3/*.test.js through node:test (C3 force update: version policy, 426 gate,
// admin endpoints + audit, socket handshake, the apps' shared forceUpdate.ts).
//   npm run test:c3 -- gate   (only files whose name contains "gate")
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
