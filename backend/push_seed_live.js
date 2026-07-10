const fs = require('fs');

async function seedLive() {
  const url = 'https://hostelbites-backend-jwmt.onrender.com';
  
  // 1. Login as Admin
  console.log('Logging in as admin...');
  let loginRes = await fetch(`${url}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999999999', password: 'admin123' })
  });
  
  if (!loginRes.ok) {
    console.log('Login failed, creating admin...');
    // Maybe the admin is not seeded in live either? Let's try to register the admin.
    let regRes = await fetch(`${url}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'System Admin', phone: '9999999999', password: 'admin123' })
    });
    console.log('Register status:', regRes.status);
    
    // Attempt login again
    loginRes = await fetch(`${url}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9999999999', password: 'admin123' })
    });
  }

  if (!loginRes.ok) {
      console.error('Failed to get auth token', await loginRes.text());
      return;
  }
  
  const authData = await loginRes.json();
  const token = authData.token;
  console.log('Got token:', token.substring(0, 10) + '...');
  
  // However, is the newly registered user an admin?
  // If not, we might fail the admin check. But if they just seeded the DB previously, they might have the 9999999999 admin user from unified_seed.
  
  // 2. Load payload
  let payloadStr = fs.readFileSync('extracted_restaurants.json', 'utf-8');
  // It's a JS object array, not strict JSON. Let's evaluate it safely.
  const payloadArr = eval(payloadStr);
  
  console.log(`Sending ${payloadArr.length} restaurants to live API...`);
  
  const seedRes = await fetch(`${url}/api/admin/seed`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ restaurants: payloadArr })
  });
  
  if (!seedRes.ok) {
    console.error('Seed failed:', await seedRes.text());
  } else {
    console.log('Seed success:', await seedRes.json());
  }
}

seedLive().catch(console.error);
