const fs = require('fs');
const path = require('path');
const os = require('os');

const appData = path.join(os.homedir(), 'AppData', 'Roaming');
const historyDirs = [
  path.join(appData, 'Antigravity', 'User', 'History'),
  path.join(appData, 'Windsurf', 'User', 'History'),
  path.join(appData, 'Code', 'User', 'History'),
  path.join(appData, 'Cursor', 'User', 'History')
];

for (const historyDir of historyDirs) {
  if (!fs.existsSync(historyDir)) continue;
  console.log(`\nListing in: ${historyDir}`);
  try {
    const subfolders = fs.readdirSync(historyDir);
    for (const folder of subfolders) {
      const folderPath = path.join(historyDir, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;
      
      const entriesPath = path.join(folderPath, 'entries.json');
      if (fs.existsSync(entriesPath)) {
        try {
          const content = fs.readFileSync(entriesPath, 'utf8');
          const data = JSON.parse(content);
          const resource = data.resource || '';
          if (resource.includes('hostel-bite')) {
            console.log(`Folder: ${folder}, Resource: ${resource}`);
          }
        } catch (e) {
          // ignore
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
}
