const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_page_compiled.js'), 'utf8');

// Find function Home
const homeIndex = content.indexOf('function Home(');
if (homeIndex !== -1) {
  console.log(`Found 'function Home(' at index ${homeIndex}`);
  
  // Let's write the chunk starting from homeIndex to the end of the file or another 200,000 characters
  const homeChunk = content.slice(homeIndex, homeIndex + 500000);
  fs.writeFileSync(path.join(__dirname, 'recovered_home_function.js'), homeChunk);
  console.log('Saved Home function block to: recovered_home_function.js');
} else {
  console.log('Could not find function Home(');
}
