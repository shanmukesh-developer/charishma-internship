const jwt = require('jsonwebtoken');

const JWT_SECRET = 'super_secret_zenvy_token_2026';
const userId = '22ed9faf-9ce8-4814-a2d4-8a30dfd60b46'; // Admin ID on live PG

const token = jwt.sign({ id: userId, role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });

const url = 'https://hostelbites-backend-jwmt.onrender.com';

async function run() {
  console.log('Sending PUT to update profile...');
  const res = await fetch(`${url}/api/users/profile`, {
    method: 'PUT',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Nexus Admin',
      phone: '9391955674',
      email: 'admin@zenvy.com',
      about: 'Admin of Zenvy!',
      address: 'Central Admin Office',
      city: 'Amaravathi'
    })
  });
  
  console.log('Status Code:', res.status);
  const data = await res.json();
  console.log('Returned keys:', Object.keys(data));
  console.log('email value:', data.email);
  console.log('about value:', data.about);
}

run().catch(console.error);
