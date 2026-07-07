const fs = require('fs');
const content = fs.readFileSync('src/app/page.tsx', 'utf8');

const keywords = ['Special Mutton Fry', 'Biryani', 'favoriteItems', 'liveRestaurants', 'menu.map'];
for (const kw of keywords) {
  let idx = 0;
  while ((idx = content.indexOf(kw, idx)) !== -1) {
    console.log(`Match for "${kw}" at index ${idx}:`);
    console.log(content.slice(idx - 100, idx + 100));
    console.log('---');
    idx += kw.length;
  }
}
