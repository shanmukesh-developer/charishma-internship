const fs = require('fs');
const content = fs.readFileSync('delivery-boy-app/App.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('showConfig') || line.includes('apiHost') || line.includes('Server URL') || line.includes('Config')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
