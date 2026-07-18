const fs = require('fs');
const path = require('path');

function searchMaps(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        searchMaps(fullPath);
      }
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('map') || content.includes('Map') || content.includes('google.com/maps')) {
          console.log(`FOUND in ${fullPath.substring(0, 100)}`);
        }
      }
    }
  });
}

searchMaps('c:/hostel-bite/customer-mobile');
searchMaps('c:/hostel-bite/frontend');
searchMaps('c:/hostel-bite/admin-dashboard');
