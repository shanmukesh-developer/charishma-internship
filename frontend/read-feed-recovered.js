const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const feedIdx = content.indexOf('restaurant-feed');
if (feedIdx !== -1) {
  const slice = content.slice(Math.max(0, feedIdx - 6000), feedIdx + 4000);
  fs.writeFileSync(path.join(__dirname, 'extracted-feed-code.js'), slice);
  console.log('Saved to extracted-feed-code.js');
} else {
  console.log('No restaurant-feed found.');
}
