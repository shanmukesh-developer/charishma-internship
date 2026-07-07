const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const idx = content.indexOf('elite-card');
if (idx !== -1) {
  const slice = content.slice(idx - 200, idx + 2000);
  fs.writeFileSync(path.join(__dirname, 'extracted-elite-card.js'), slice);
  console.log('Saved elite-card');
} else {
  console.log('Not found');
}
