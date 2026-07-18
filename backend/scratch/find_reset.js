const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/backend/controllers/userController.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('reset') || line.includes('Reset') || line.includes('newPassword')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
