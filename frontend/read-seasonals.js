const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const seasonalIdx = content.indexOf('SEASON SPECIALS');
if (seasonalIdx !== -1) {
  console.log('Found SEASON SPECIALS. Printing next 3000 characters:');
  console.log(content.slice(seasonalIdx - 1000, seasonalIdx + 2000));
} else {
  console.log('SEASON SPECIALS not found.');
}
