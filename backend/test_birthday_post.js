const API_URL = 'https://hostelbites-backend-jwmt.onrender.com';

async function run() {
  try {
    console.log('Logging into Live Backend to post a birthday wish...');
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
    
    console.log('Successfully logged in!');
    console.log('Posting birthday post to community...');
    
    const postRes = await fetch(`${API_URL}/api/community`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        content: 'Hey Zenvy family, wishing a very Happy Birthday to our amazing friend! 🎂🎉 (Live Test)',
        postType: 'post',
        authorName: 'Admin Celebrator'
      })
    });
    
    console.log('Post Result Status:', postRes.status);
    console.log('Post Result Text:', await postRes.text());
    
    console.log('Done! If the deployment is live, the user should receive a Birthday Alert push notification right now.');
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
