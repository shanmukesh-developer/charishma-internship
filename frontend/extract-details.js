const fs = require('fs');
const c = fs.readFileSync('recovered_return_jsx.js', 'utf8');

// Find all light: class occurrences (in concat or direct strings)
const lightRegex = /light:\S+/g;
let match;
const lightClasses = new Map();
while ((match = lightRegex.exec(c)) !== null) {
  const cls = match[0].replace(/['"\\,)]/g, '');
  lightClasses.set(cls, (lightClasses.get(cls) || 0) + 1);
}

console.log(`Found ${lightClasses.size} unique light: classes:\n`);
const sorted = [...lightClasses.entries()].sort((a,b) => b[1] - a[1]);
sorted.forEach(([cls, count]) => {
  console.log(`  ${count}x  ${cls}`);
});

// Check current page.tsx for which of these exist
const current = fs.readFileSync('src/app/page.tsx', 'utf8');
console.log('\n\n=== Missing from current page.tsx ===');
sorted.forEach(([cls]) => {
  if (!current.includes(cls)) {
    console.log(`  MISSING: ${cls}`);
  }
});

// Check for animate-text-gradient in CSS
const css = fs.readFileSync('src/app/globals.css', 'utf8');
console.log('\n\nanimate-text-gradient in CSS:', css.includes('animate-text-gradient') ? 'YES' : 'MISSING');
console.log('text-gradient in CSS:', css.includes('text-gradient') ? 'YES' : 'MISSING');

// Check hero gradient difference
console.log('\n\n=== Hero Gradient ===');
console.log('Current:', current.includes('from-primary-yellow to-white') ? 'from-primary-yellow to-white' : 'NOT FOUND');
console.log('Recovered should be: from-red-500 via-yellow-500 to-red-500 bg-[length:200%_auto] animate-text-gradient');
console.log('Current has recovered gradient:', current.includes('from-red-500 via-yellow-500 to-red-500') ? 'YES' : 'NO');
