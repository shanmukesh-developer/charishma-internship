const fs = require('fs');
const content = fs.readFileSync('backend/server.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('app.use(') || line.includes('routes')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
