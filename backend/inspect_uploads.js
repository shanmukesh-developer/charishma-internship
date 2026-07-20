const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dir)) {
  console.log('No uploads directory');
  process.exit();
}

const files = fs.readdirSync(dir);
console.log('Files:', files);

files.forEach(file => {
  const filePath = path.join(dir, file);
  const buffer = fs.readFileSync(filePath);
  
  // Read first few bytes to determine file type
  const hex = buffer.toString('hex', 0, 4);
  let type = 'unknown';
  if (hex.startsWith('89504e47')) {
    type = 'png';
  } else if (hex.startsWith('ffd8ffe0') || hex.startsWith('ffd8ffe1') || hex.startsWith('ffd8ffe2')) {
    type = 'jpg';
  } else if (hex.startsWith('47494638')) {
    type = 'gif';
  }
  
  console.log(`File: ${file}, Size: ${buffer.length} bytes, Hex: ${hex}, Detected Type: ${type}`);
});
