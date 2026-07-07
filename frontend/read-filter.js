const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const filterIdx = content.indexOf('setFilter');
if (filterIdx !== -1) {
  console.log('Printing code filter:');
  console.log(content.slice(filterIdx + 28000, filterIdx + 32000));
} else {
  console.log('setFilter not found.');
}
