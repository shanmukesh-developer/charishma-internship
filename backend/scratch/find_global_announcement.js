const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/backend/server.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('global_announcement')) {
    console.log(`LINE ${index + 1}:`);
    for (let i = Math.max(0, index - 5); i <= Math.min(lines.length - 1, index + 5); i++) {
      console.log(`  ${i + 1}: ${lines[i].trim()}`);
    }
  }
});
