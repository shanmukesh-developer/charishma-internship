const fs = require('fs');
const path = require('path');
const os = require('os');

const appData = path.join(os.homedir(), 'AppData', 'Roaming');
const backupDirs = [
  path.join(appData, 'Antigravity', 'User', 'Backups'),
  path.join(appData, 'Windsurf', 'User', 'Backups'),
  path.join(appData, 'Code', 'Backups'),
  path.join(appData, 'Cursor', 'Backups'),
  path.join(appData, 'Cursor', 'User', 'Backups'),
  path.join(appData, 'Code', 'User', 'Backups'),
];

for (const backupDir of backupDirs) {
  if (!fs.existsSync(backupDir)) continue;
  console.log(`\nSearching backups in: ${backupDir}`);
  try {
    // Backups folder usually has a structure: Backups/workspaces.json or subfolders
    const workspaceDirs = fs.readdirSync(backupDir);
    for (const ws of workspaceDirs) {
      const wsPath = path.join(backupDir, ws);
      if (fs.statSync(wsPath).isDirectory()) {
        const fileModes = fs.readdirSync(wsPath);
        for (const fm of fileModes) {
          const fmPath = path.join(wsPath, fm);
          if (fs.statSync(fmPath).isDirectory()) {
            const files = fs.readdirSync(fmPath);
            for (const file of files) {
              const filePath = path.join(fmPath, file);
              const stat = fs.statSync(filePath);
              if (stat.isFile()) {
                const content = fs.readFileSync(filePath, 'utf8');
                console.log(`Found backup file: ${filePath}`);
                if (content.includes('Central Command') || content.includes('page.tsx')) {
                  console.log(`  MATCH: ${filePath} contains keywords. Size: ${stat.size} bytes`);
                  console.log(content.slice(0, 400));
                  console.log('---');
                }
              }
            }
          } else if (fs.statSync(fmPath).isFile()) {
            const content = fs.readFileSync(fmPath, 'utf8');
            console.log(`Found backup file in subfolder: ${fmPath}`);
            if (content.includes('Central Command') || content.includes('page.tsx')) {
              console.log(`  MATCH: ${fmPath} contains keywords. Size: ${fs.statSync(fmPath).size} bytes`);
              console.log(content.slice(0, 400));
              console.log('---');
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
}
