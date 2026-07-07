const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const slice = content.slice(341942, 341942 + 8000);
fs.writeFileSync(path.join(__dirname, 'extracted-feed-2.js'), slice);
console.log('Saved to extracted-feed-2.js');
