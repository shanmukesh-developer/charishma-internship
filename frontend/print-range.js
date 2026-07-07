const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

// Print from index 340000 to 415000 in readable chunk sizes
const start = 340000;
const end = 415000;
console.log(`Writing index ${start} to ${end} to: recovered_range_jsx.js`);
fs.writeFileSync(path.join(__dirname, 'recovered_range_jsx.js'), content.slice(start, end));
