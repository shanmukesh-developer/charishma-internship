const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/backend/server.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('/auth-helper')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
