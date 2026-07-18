const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/customer-mobile/app/(tabs)/index.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('router.push')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
