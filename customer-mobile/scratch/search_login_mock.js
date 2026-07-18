const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/customer-mobile/app/login.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.toLowerCase().includes('mock')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
