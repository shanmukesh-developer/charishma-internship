const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/customer-mobile/app/checkout.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.toLowerCase().includes('payment') || line.toLowerCase().includes('upi') || line.toLowerCase().includes('url') || line.toLowerCase().includes('pay')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
