const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const idx = content.indexOf('bg-[#C9A84C]/5 light:bg-[#EF4F5F]/5');
if (idx !== -1) {
  const slice = content.slice(idx - 500, idx + 1500);
  fs.writeFileSync(path.join(__dirname, 'extracted-occurrence-26.js'), slice);
  console.log('Saved occurrence 26');
} else {
  console.log('Not found');
}
