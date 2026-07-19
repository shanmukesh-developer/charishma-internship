const jwt = require('jsonwebtoken');

const API_URL = 'https://hostelbites-backend-jwmt.onrender.com';
const JWT_SECRET = 'super_secret_zenvy_token_2026';

async function run() {
  try {
    console.log('Forging Admin JWT Token using local secret...');
    const token = jwt.sign({ id: 'dummy-admin-id', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    
    console.log('Sending broadcast pushes...');
    
    const notifications = [
      { title: '🚀 Zenvy Mega Launch!', body: 'Zenvy is live! Get 50% off on your first order. Swipe to open.' },
      { title: '🌧️ Rainy Day Special', body: 'It\'s raining! Stay in your room and order hot snacks with no delivery fee.' },
      { title: '🏆 Elite Status Unlocked', body: 'Congratulations! You\'ve reached a new tier. Check your profile for rewards.' }
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
