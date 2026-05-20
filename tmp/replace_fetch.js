const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    if (fs.statSync(file).isDirectory()) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts') || file.endsWith('.js')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk(path.resolve(__dirname, '../frontend/src'));
let filesModified = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // 1. Remove localStorage.setItem('token', ...)
  content = content.replace(/localStorage\.setItem\(['"`]token['"`],\s*.*?\);?/g, '');
  
  // 2. Replace localStorage.getItem('token') with a mock string to prevent TS ReferenceErrors
  content = content.replace(/localStorage\.getItem\(['"`]token['"`]\)/g, "'cookie-managed'");
  
  // 3. Remove localStorage.removeItem('token')
  content = content.replace(/localStorage\.removeItem\(['"`]token['"`]\);?/g, '');
  
  // 4. In fetch options, remove Authorization header
  content = content.replace(/['"`]?Authorization['"`]?\s*:\s*`Bearer \$\{?[a-zA-Z0-9_]*\}?`\s*,?/g, '');
  content = content.replace(/['"`]?Authorization['"`]?\s*:\s*['"`]Bearer ['"`]\s*\+\s*[a-zA-Z0-9_]*\s*,?/g, '');
  
  // Clean up empty headers object
  content = content.replace(/headers:\s*\{\s*\}[\s,]*\n?/g, '');
  
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    filesModified++;
  }
});

console.log(`Modified ${filesModified} files.`);
