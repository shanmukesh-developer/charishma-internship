const fs = require('fs');
const content = fs.readFileSync('C:/Users/Shanmukh/.gemini/antigravity/brain/6b5ab2ce-305b-48af-8fbe-18e9ec079c75/.system_generated/logs/overview.txt', 'utf8');
const lines = content.split('\n');
const startIndex = Math.max(0, lines.length - 120);
for (let i = startIndex; i < lines.length; i++) {
  if (lines[i] && (lines[i].includes('USER_REQUEST') || lines[i].includes('MODEL') || lines[i].includes('google') || lines[i].includes('otp'))) {
    console.log(`${i + 1}: ${lines[i].substring(0, 150)}`);
  }
}
