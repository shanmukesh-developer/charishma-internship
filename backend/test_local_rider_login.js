const url = 'http://localhost:5005';

async function run() {
  console.log('Sending POST to local delivery login...');
  const res = await fetch(`${url}/api/delivery/login`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ phone: 'driver1', password: 'password123' })
  });
  
  console.log('Status Code:', res.status);
  const data = await res.json();
  console.log('Response body:', data);
}

run().catch(console.error);
