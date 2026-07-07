const fs = require('fs');
const c = fs.readFileSync('recovered_return_jsx.js', 'utf8');

const targetStr = 'Central Command';
const idx = c.indexOf(targetStr);

if (idx !== -1) {
  // Go back enough to capture the whole section wrapper
  const start = idx - 1500;
  // Get a large chunk and format it
  const slice = c.substring(Math.max(0, start), idx + 2000).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  fs.writeFileSync('extracted-hero-full-2.txt', slice);
  console.log('Saved to extracted-hero-full-2.txt');
} else {
  console.log('Target string not found');
}
