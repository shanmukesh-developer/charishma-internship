const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const laundryIdx = content.indexOf('laundry');
const feedIdx = content.lastIndexOf('restaurant-feed');

console.log('laundry:', laundryIdx, 'feed:', feedIdx);
if (laundryIdx !== -1 && feedIdx !== -1) {
  const slice = content.slice(laundryIdx + 1000, feedIdx - 1000);
  fs.writeFileSync(path.join(__dirname, 'extracted-between.js'), slice);
  console.log('Saved to extracted-between.js');
}
