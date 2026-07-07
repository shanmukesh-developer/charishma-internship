const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const idx = content.indexOf("on your mind");
if (idx !== -1) {
  const slice = content.slice(idx + 4200, idx + 8000);
  fs.writeFileSync(path.join(__dirname, 'extracted-category-circles.js'), slice);
  console.log('Saved to extracted-category-circles.js');
} else {
  console.log('Not found.');
}
