const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

let pos = 0;
let occurrences = [];
while (true) {
  const idx = content.indexOf('light:bg-', pos);
  if (idx === -1) break;
  occurrences.push(idx);
  pos = idx + 1;
}

console.log('Occurrences count:', occurrences.length);
for (let i = 0; i < Math.min(occurrences.length, 3); i++) {
  const idx = occurrences[i];
  console.log(`--- Occurrence ${i} ---`);
  const slice = content.slice(Math.max(0, idx - 150), idx + 250);
  console.log(slice);
}
