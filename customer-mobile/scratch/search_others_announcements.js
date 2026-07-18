const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/customer-mobile/app/(tabs)/others.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.toLowerCase().includes('announcement')) {
    console.log(`${index + 1}: ${line.trim().substring(0, 150)}`);
  }
});
