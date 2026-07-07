const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

function findOccurrences(word) {
  console.log(`\nOccurrences of "${word}":`);
  let idx = 0;
  while ((idx = content.indexOf(word, idx)) !== -1) {
    console.log(`- Index: ${idx}`);
    console.log(content.slice(Math.max(0, idx - 100), idx + 200));
    idx += word.length;
  }
}

findOccurrences('ZenvyVault');
findOccurrences('restaurant-feed');
findOccurrences('CampusBitesSection');
