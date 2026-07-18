const fs = require('fs');
const content = fs.readFileSync('c:/hostel-bite/frontend/src/app/login/page.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('signInWith') || line.includes('Google') || line.includes('Recaptcha') || line.includes('Phone') || line.includes('otp') || line.includes('OTP')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
