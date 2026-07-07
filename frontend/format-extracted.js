const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'extracted-elite-card.js'), 'utf8');
const formatted = content.replace(/\\n/g, '\n').replace(/\\"/g, '"');
fs.writeFileSync(path.join(__dirname, 'extracted-elite-card-formatted.js'), formatted);
console.log('Done!');
