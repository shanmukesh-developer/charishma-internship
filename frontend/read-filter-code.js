const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const vegIdx = content.indexOf("filter === 'veg'");
if (vegIdx !== -1) {
  const slice = content.slice(vegIdx, vegIdx + 8000);
  fs.writeFileSync(path.join(__dirname, 'extracted-filter-code.js'), slice);
  console.log('Saved to extracted-filter-code.js');
} else {
  console.log('No filters found.');
}
