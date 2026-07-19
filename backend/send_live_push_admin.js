const API_URL = 'https://hostelbites-backend-jwmt.onrender.com';

async function run() {
  try {
    console.log('Logging into Live Backend as Admin...');
    const loginRes = await fetch(`${API_URL}/api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9999999999', password: 'admin123' })
    });
    
    if (!loginRes.ok) {
      console.log('Login failed:', await loginRes.text());
      return;
    }
    
    const loginData = await loginRes.json();
    const token = loginData.token;
    
    console.log('Successfully logged in! Token acquired.');
    console.log('Sending broadcast pushes...');
    
    const notifications = [
      { title: '🚀 Zenvy Live Hit!', body: 'This notification comes from the live server via the Admin Portal!' }
    ];
    
    for (const notif of notifications) {
      console.log(`Sending: ${notif.title}...`);
      const pushRes = await fetch(`${API_URL}/api/admin/broadcast-push`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(notif)
      });
      console.log('Result:', await pushRes.text());
      await new Promise(r => setTimeout(r, 2000));
    }
    
    console.log('All notifications sent successfully!');
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
