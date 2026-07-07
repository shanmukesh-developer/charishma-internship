const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const portalIdx = content.indexOf('ZenvySuperPortal');
if (portalIdx !== -1) {
  console.log('Found ZenvySuperPortal. Printing context:');
  console.log(content.slice(Math.max(0, portalIdx - 500), portalIdx + 1500));
} else {
  console.log('ZenvySuperPortal not found.');
}
