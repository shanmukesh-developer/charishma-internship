const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('c:/hostel-bite/frontend/src');

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  // Match full button opening tags, handling attributes that might span multiple lines
  const regex = /<button(?:\s+[^>]+?)?>/gs;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const buttonTag = match[0];
    if (!buttonTag.includes('onClick') && !buttonTag.includes('type="submit"') && !buttonTag.includes('form=')) {
      // Find line number
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;
      console.log(`Dead button found at ${file}:${lineNumber}`);
      console.log(`Tag: ${buttonTag.replace(/\n/g, ' ').slice(0, 150)}...\n`);
    }
  }
});
