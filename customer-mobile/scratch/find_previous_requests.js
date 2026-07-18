const fs = require('fs');
const content = fs.readFileSync('C:/Users/Shanmukh/.gemini/antigravity/brain/6b5ab2ce-305b-48af-8fbe-18e9ec079c75/.system_generated/logs/overview.txt', 'utf8');
const lines = content.split('\n');
let count = 0;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('"source":"USER_EXPLICIT"')) {
    console.log(`LINE ${i + 1}: ${lines[i]}`);
    count++;
    if (count > 5) break;
  }
}
