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

let foundAny = false;

for (const historyDir of historyDirs) {
  if (!fs.existsSync(historyDir)) continue;
  console.log(`Searching history in: ${historyDir}`);
  try {
    const subfolders = fs.readdirSync(historyDir);
    for (const folder of subfolders) {
      const folderPath = path.join(historyDir, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;
      
      const entriesPath = path.join(folderPath, 'entries.json');
      if (fs.existsSync(entriesPath)) {
        const content = fs.readFileSync(entriesPath, 'utf8');
        let data;
        try {
          data = JSON.parse(content);
        } catch (e) {
          continue;
        }
        
        const resource = data.resource || '';
        if (resource.endsWith('page.tsx') && resource.includes('hostel-bite')) {
          console.log(`Found matching folder: ${folderPath} for resource: ${resource}`);
          
          // List files in this folder
          const files = fs.readdirSync(folderPath);
          console.log(`Files in history folder:`, files);
          
          for (const file of files) {
            if (file === 'entries.json') continue;
            const filePath = path.join(folderPath, file);
            const fileContent = fs.readFileSync(filePath, 'utf8');
            
            // Print some stats about this version
            const hasCentralCommand = fileContent.includes('Central Command');
            console.log(`  File: ${file}, Size: ${fileContent.length} bytes, has 'Central Command': ${hasCentralCommand}`);
            
            // Let's copy it to a backup directory in the project
            const backupDir = path.join(__dirname, 'recovered_pages');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
            
            const destPath = path.join(backupDir, `${file}_${hasCentralCommand ? 'redesigned' : 'original'}.tsx`);
            fs.writeFileSync(destPath, fileContent);
            console.log(`  Copied to: ${destPath}`);
            foundAny = true;
          }
        }
      }
    }
  } catch (err) {
    console.error(`Error searching ${historyDir}:`, err.message);
  }
}

if (!foundAny) {
  console.log('No history matches found.');
}
