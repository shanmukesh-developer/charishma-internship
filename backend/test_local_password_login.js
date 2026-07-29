const url = 'http://localhost:5005';

async function run() {
  console.log('Sending POST to local password login...');
  const res = await fetch(`${url}/api/users/login`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ phone: '9999999999', password: 'admin123' })
  });
  
  console.log('Status Code:', res.status);
  const data = await res.json();
  console.log('Response body:', data);
}

run().catch(console.error);
