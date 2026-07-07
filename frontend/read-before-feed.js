const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const feedIndex = content.indexOf('restaurant-feed');
if (feedIndex !== -1) {
  console.log('Found restaurant-feed. Printing 4000 characters before it:');
  console.log(content.slice(Math.max(0, feedIndex - 4000), feedIndex));
} else {
  console.log('restaurant-feed not found.');
}
