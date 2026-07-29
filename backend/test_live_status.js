const jwt = require('jsonwebtoken');

const JWT_SECRET = 'super_secret_zenvy_token_2026';
const userId = 'd1a1dde1-acf6-4dc1-988c-c64c5de3e8da'; // Shanmukesh Kunjam's ID on live PG

const token = jwt.sign({ id: userId, role: 'student' }, JWT_SECRET, { expiresIn: '30d' });

const url = 'https://hostelbites-backend-jwmt.onrender.com';

async function run() {
  console.log('Sending PUT to update status...');
  const res = await fetch(`${url}/api/friends/status`, {
    method: 'PUT',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusText: 'Testing Live!', statusEmoji: '🚀' })
  });
  
  console.log('Status Code:', res.status);
  const data = await res.json();
  console.log('Response body:', data);
}

run().catch(console.error);
