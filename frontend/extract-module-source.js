const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '.next', 'static', 'webpack', 'app', 'page.6ab8760245be4b53.hot-update.js');
if (!fs.existsSync(filePath)) {
  console.log('File does not exist:', filePath);
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');
console.log('File size:', content.length);

// Let's search for some markers or write the whole file to a readable text file
fs.writeFileSync(path.join(__dirname, 'recovered_page_compiled.js'), content);
console.log('Saved compiled code to: recovered_page_compiled.js');

// Let's print some occurrences of 'CampusBitesSection'
let index = 0;
while ((index = content.indexOf('CampusBitesSection', index)) !== -1) {
  console.log(`Found 'CampusBitesSection' at index: ${index}`);
  console.log(content.slice(Math.max(0, index - 200), index + 200));
  console.log('---');
  index += 'CampusBitesSection'.length;
}
