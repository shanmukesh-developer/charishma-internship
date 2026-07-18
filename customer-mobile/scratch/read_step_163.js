const fs = require('fs');
const content = fs.readFileSync('C:/Users/Shanmukh/.gemini/antigravity/brain/6b5ab2ce-305b-48af-8fbe-18e9ec079c75/.system_generated/logs/overview.txt', 'utf8');
const lines = content.split('\n');
for (let i = 160; i < 175; i++) {
  if (lines[i]) console.log(`${i + 1}: ${lines[i]}`);
}
