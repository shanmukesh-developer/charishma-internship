const url = 'http://localhost:5005';

async function run() {
  console.log('Sending POST to local login...');
  const res = await fetch(`${url}/api/users/login`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ phone: '9391955674', firebaseToken: 'E2E_MOCK_TOKEN' })
  });
  
  console.log('Status Code:', res.status);
  const data = await res.json();
  console.log('Response body:', data);
}

run().catch(console.error);
