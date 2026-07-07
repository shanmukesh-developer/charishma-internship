const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const nearMeIdx = content.indexOf('Near Me');
if (nearMeIdx !== -1) {
  const slice = content.slice(nearMeIdx + 1500, nearMeIdx + 7000);
  fs.writeFileSync(path.join(__dirname, 'extracted-filter-detail.js'), slice);
  console.log('Saved to extracted-filter-detail.js');
}
