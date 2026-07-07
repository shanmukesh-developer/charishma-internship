const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('.');
for (const file of files) {
  if (file.startsWith('fix') && file.endsWith('.js')) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.toLowerCase().includes('central command') || content.toLowerCase().includes('craving') || content.toLowerCase().includes('identify')) {
      console.log(`Match in ${file}:`);
      console.log(content.slice(0, 500));
      console.log('---');
    }
  }
}
