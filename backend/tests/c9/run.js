// npm run test:c9 -> every tests/c9/*.test.js through node:test (C9 partner apps: rider / auto-driver in-app account
// deletion (re-auth, blockers, anonymisation, audit, revoked sessions), persisted order chat (access control,
// retention), report_issue -> support ticket, legal delete-account page; the socket file runs the real server.js).
//   npm run test:c9 -- chat   (only files whose name contains "chat")
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
