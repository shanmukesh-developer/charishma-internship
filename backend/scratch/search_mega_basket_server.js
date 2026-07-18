const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/backend/server.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.toLowerCase().includes('megabasket') || line.toLowerCase().includes('mega-basket')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
