const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const vaultIndex = 71017;
const feedIndex = 341942;

if (vaultIndex !== -1 && feedIndex !== -1) {
  const middle = content.slice(vaultIndex, feedIndex);
  console.log(`Middle section length: ${middle.length}`);
  
  // Let's find any occurrences of WEBPACK_IMPORTED_MODULE
  const matches = [...middle.matchAll(/__WEBPACK_IMPORTED_MODULE_\d+__/g)];
  console.log('Webpack imported components in the middle range:');
  const seen = new Set();
  matches.forEach(m => {
    const idx = m.index;
    const start = Math.max(0, idx - 120);
    const end = Math.min(middle.length, idx + 120);
    const snippet = middle.slice(start, end).replace(/\n/g, ' ');
    // Extract component name
    const compMatch = snippet.match(/_components_([A-Za-z0-9_]+)__WEBPACK/);
    if (compMatch) {
      seen.add(compMatch[1]);
    } else {
      // maybe check next_link or framer_motion
      seen.add(snippet.slice(50, 150));
    }
  });
  console.log(Array.from(seen));
}
