const fs = require('fs');
const path = require('path');

function searchConfigs(dir, prefix = '') {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.next' && file !== 'dist') {
        searchConfigs(fullPath, path.join(prefix, file));
      }
    } else {
      if (file === 'package.json' || file.includes('api') || file.includes('config') || file === '.env' || file === '.env.local') {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (line.includes('http://') || line.includes('https://') || line.includes('5005') || line.includes('PORT')) {
              console.log(`${path.join(prefix, file)} [L${idx + 1}]: ${line.trim()}`);
            }
          });
        } catch (e) {}
      }
    }
  });
}

console.log('=== ADMIN DASHBOARD ===');
searchConfigs('c:/hostel-bite/admin-dashboard');
console.log('\n=== RESTAURANT PORTAL ===');
searchConfigs('c:/hostel-bite/restaurant-portal');
console.log('\n=== DELIVERY APP ===');
searchConfigs('c:/hostel-bite/delivery-app');
