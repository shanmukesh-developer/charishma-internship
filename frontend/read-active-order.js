const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

// Find activeOrder && !isLoading
let idx = 0;
while ((idx = content.indexOf('activeOrder', idx)) !== -1) {
  console.log(`\nactiveOrder found at index ${idx}`);
  console.log(content.slice(Math.max(0, idx - 200), idx + 1000));
  idx += 'activeOrder'.length;
}
