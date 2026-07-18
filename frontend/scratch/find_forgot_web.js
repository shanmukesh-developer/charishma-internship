const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/frontend/src/app/forgot-password/page.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('Recaptcha') || line.includes('signInWith') || line.includes('Phone') || line.includes('otp') || line.includes('OTP') || line.includes('confirm')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
