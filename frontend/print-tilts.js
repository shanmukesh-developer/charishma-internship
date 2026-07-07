const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

// Find all matches of _components_Tilt__WEBPACK_IMPORTED_MODULE
let idx = 0;
const word = 'Tilt';
while ((idx = content.indexOf(word, idx)) !== -1) {
  console.log(`\nTilt found at index ${idx}`);
  console.log(content.slice(Math.max(0, idx - 100), idx + 400));
  idx += word.length;
}
