const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '.next');
if (!fs.existsSync(root)) {
  console.log('No .next folder found.');
  process.exit(1);
}

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.js')) {
        results.push({ file, mtime: stat.mtime });
      }
    }
  });
  return results;
}

const files = walk(root);
// Filter files containing 'Central Command'
const matches = [];
for (const item of files) {
  try {
    const content = fs.readFileSync(item.file, 'utf8');
    if (content.includes('Central Command') || content.includes('YOUR CRAVING')) {
      matches.push({ file: item.file, mtime: item.mtime, size: content.length });
    }
  } catch (e) {}
}

// Sort matches by mtime descending (most recent first)
matches.sort((a, b) => b.mtime - a.mtime);

console.log(`Found ${matches.length} matching compiled files:`);
for (const match of matches.slice(0, 10)) {
  console.log(`- File: ${match.file}`);
  console.log(`  Modified: ${match.mtime}`);
  console.log(`  Size: ${match.size} bytes`);
}

if (matches.length > 0) {
  const newestFile = matches[0].file;
  console.log(`\n--- Reading newest file: ${newestFile} ---`);
  const content = fs.readFileSync(newestFile, 'utf8');
  
  // Save content to a text file for us to analyze
  const outPath = path.join(__dirname, 'recovered_compiled_page.js');
  fs.writeFileSync(outPath, content);
  console.log(`Saved compiled code to: ${outPath}`);
}
