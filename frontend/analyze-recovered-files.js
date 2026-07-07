const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '.next');
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.js')) {
        results.push({ file, mtime: stat.mtime });
      }
    }
  });
  return results;
}

const files = walk(root);
const matches = [];
for (const item of files) {
  try {
    const content = fs.readFileSync(item.file, 'utf8');
    if (content.includes('Central Command') || content.includes('YOUR CRAVING')) {
      const hasChefsPicks = content.includes("Chef's Picks") || content.includes("Chef\\'s Picks");
      const hasRecentlyVisited = content.includes("Recently Visited") || content.includes("RecentlyVisited");
      const hasAIPicks = content.includes("Picked For You");
      const hasCampusBites = content.includes("CampusBites");
      
      matches.push({
        file: item.file,
        mtime: item.mtime,
        size: content.length,
        hasChefsPicks,
        hasRecentlyVisited,
        hasAIPicks,
        hasCampusBites
      });
    }
  } catch (e) {}
}

matches.sort((a, b) => b.mtime - a.mtime);

console.log('Analysis of matching compiled files:');
matches.slice(0, 15).forEach(m => {
  console.log(`\nFile: ${m.file}`);
  console.log(`  MTime: ${m.mtime}`);
  console.log(`  Size: ${m.size} bytes`);
  console.log(`  Has Chef's Picks: ${m.hasChefsPicks}`);
  console.log(`  Has Recently Visited: ${m.hasRecentlyVisited}`);
  console.log(`  Has AI Picks: ${m.hasAIPicks}`);
  console.log(`  Has CampusBites: ${m.hasCampusBites}`);
});
