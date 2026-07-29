const jwt = require('jsonwebtoken');

const JWT_SECRET = 'super_secret_zenvy_token_2026';
const userId = 'd1a1dde1-acf6-4dc1-988c-c64c5de3e8da'; // Shanmukesh Kunjam's ID on live PG

const token = jwt.sign({ id: userId, role: 'student' }, JWT_SECRET, { expiresIn: '30d' });

const url = 'https://hostelbites-backend-jwmt.onrender.com';

async function run() {
  const profileRes = await fetch(`${url}/api/users/profile`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const profile = await profileRes.json();
  console.log('All keys returned:', Object.keys(profile));
  console.log('statusText value:', profile.statusText);
  console.log('statusEmoji value:', profile.statusEmoji);
  console.log('has statusText property:', Object.prototype.hasOwnProperty.call(profile, 'statusText'));
}

run().catch(console.error);
