const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const vaultIndex = content.indexOf('ZenvyVault');
if (vaultIndex !== -1) {
  console.log('Found ZenvyVault. Printing next 3000 characters:');
  console.log(content.slice(vaultIndex, vaultIndex + 3000));
} else {
  console.log('ZenvyVault not found.');
}
