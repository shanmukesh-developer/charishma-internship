const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const eliteIdx = content.indexOf('elite-card');
if (eliteIdx !== -1) {
  console.log('Found elite-card. Printing next 3000 characters:');
  console.log(content.slice(eliteIdx - 500, eliteIdx + 2500));
} else {
  console.log('elite-card not found.');
}
