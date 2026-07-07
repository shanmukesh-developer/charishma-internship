const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

let idx = 0;
const word = 'light:';
while ((idx = content.indexOf(word, idx)) !== -1) {
  console.log(`\n'light:' found at index ${idx}`);
  console.log(content.slice(Math.max(0, idx - 80), idx + 200));
  idx += word.length;
}
