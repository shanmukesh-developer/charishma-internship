const fs = require('fs');
const https = require('https');

const content = fs.readFileSync('app/(tabs)/others.tsx', 'utf8');
const regex = /https:\/\/images\.unsplash\.com\/photo-[a-zA-Z0-9-?=&%]+/g;
const urls = [...new Set(content.match(regex))];

console.log(`Found ${urls.length} unique Unsplash URLs. Checking them...`);

function checkUrl(url) {
  return new Promise((resolve) => {
    https.request(url, { method: 'HEAD' }, (res) => {
      resolve({ url, statusCode: res.statusCode });
    }).on('error', (err) => {
      resolve({ url, statusCode: 0, error: err.message });
    }).end();
  });
}

Promise.all(urls.map(checkUrl)).then((results) => {
  console.log('\n--- Results ---');
  results.forEach(({ url, statusCode, error }) => {
    if (statusCode !== 200) {
      console.log(`❌ FAILED: ${url} (Status: ${statusCode}) ${error || ''}`);
    } else {
      console.log(`✅ OK: ${url}`);
    }
  });
});
