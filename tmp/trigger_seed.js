async function main() {
  const url = 'https://hostelbites-backend-jwmt.onrender.com/api/seed';
  const payload = { key: 'super_secret_zenvy_token_2026' };
  
  console.log('Sending seed request to Render...');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('Response Status:', res.status);
    const data = await res.json();
    console.log('Response Data:', data);
  } catch (err) {
    console.error('Error seeding:', err.message);
  }
}
main();
