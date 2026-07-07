const http = require('http');

http.get('http://localhost:3000/', (res) => {
  console.log('Status code:', res.statusCode);
  console.log('Headers:', res.headers);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Body length:', data.length);
    console.log('Body snippet:', data.slice(0, 500));
  });
}).on('error', (err) => {
  console.error('Error fetching localhost:3000:', err.message);
});
