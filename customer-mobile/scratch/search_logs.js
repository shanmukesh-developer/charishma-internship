const fs = require('fs');
const logPath = 'C:/Users/Shanmukh/.gemini/antigravity/brain/6b5ab2ce-305b-48af-8fbe-18e9ec079c75/.system_generated/logs/overview.txt';
if (fs.existsSync(logPath)) {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (line.toLowerCase().includes('external') || line.toLowerCase().includes('work') || line.toLowerCase().includes(' 3 ')) {
      console.log(`${index + 1}: ${line.substring(0, 150)}`);
    }
  });
} else {
  console.log('Log file does not exist');
}
