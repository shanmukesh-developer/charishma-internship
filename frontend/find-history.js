const fs = require('fs');
const path = require('path');
const os = require('os');

const searchInDir = (baseDir) => {
  if (!fs.existsSync(baseDir)) return;
  console.log(`\n--- Searching in ${baseDir} ---`);
  const folders = fs.readdirSync(baseDir);
  console.log(`Total folders: ${folders.length}`);
  let count = 0;
  for (const folder of folders) {
    const folderPath = path.join(baseDir, folder);
    if (fs.statSync(folderPath).isDirectory()) {
      const entriesPath = path.join(folderPath, 'entries.json');
      if (fs.existsSync(entriesPath)) {
        try {
          const content = fs.readFileSync(entriesPath, 'utf8');
          const data = JSON.parse(content);
          if (data.resource && data.resource.toLowerCase().includes('hostel-bite')) {
            console.log(`Found hostel-bite resource: ${data.resource}`);
            console.log(`Entries:`, data.entries.slice(-3));
            count++;
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }
  console.log(`Total hostel-bite files found: ${count}`);
};

const appData = path.join(os.homedir(), 'AppData', 'Roaming');
searchInDir(path.join(appData, 'Antigravity', 'User', 'History'));
searchInDir(path.join(appData, 'Windsurf', 'User', 'History'));
searchInDir(path.join(appData, 'Code', 'User', 'History'));
searchInDir(path.join(appData, 'Cursor', 'User', 'History'));
