/**
 * update_brands_logos.js — Updates logoUrl in brandTheme to transparent SVG URLs on live production DB
 */
const API = 'https://hostelbites-backend-jwmt.onrender.com';

async function updateLogos() {
  // 1. Login as admin
  console.log('🔐 Logging in as admin...');
  const loginRes = await fetch(`${API}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999999999', password: 'admin123' })
  });
  if (!loginRes.ok) {
    console.error('❌ Login failed:', await loginRes.text());
    return;
  }
  const { token } = await loginRes.json();
  console.log('✅ Token acquired');

  // 2. Get all restaurants
  console.log('📡 Fetching restaurants...');
  const allRes = await fetch(`${API}/api/users/restaurants`);
  if (!allRes.ok) {
    console.error('❌ Failed to fetch restaurants:', await allRes.text());
    return;
  }
  const allData = await allRes.json();

  const brandUpdates = {
    'KFC Premium': {
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/bf/KFC_logo.svg',
      primaryColor: "#E4002B",
      secondaryColor: "#111111",
      accentColor: "#FFC72C",
      gradient: "linear-gradient(135deg, #E4002B 0%, #111111 100%)",
      fontColor: "#FFFFFF",
      logoAnimationType: "kfc-bucket-drop"
    },
    "Domino's Pizza": {
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Domino%27s_pizza_logo.svg',
      primaryColor: "#006491",
      secondaryColor: "#E31B23",
      accentColor: "#006491",
      gradient: "linear-gradient(135deg, #006491 0%, #E31B23 100%)",
      fontColor: "#FFFFFF",
      logoAnimationType: "dominos-flip"
    },
    "McDonald's Premium": {
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/36/McDonald%27s_Golden_Arches.svg',
      primaryColor: "#FFC72C",
      secondaryColor: "#DA291C",
      accentColor: "#FFC72C",
      gradient: "linear-gradient(135deg, #DA291C 0%, #FFC72C 100%)",
      fontColor: "#FFFFFF",
      logoAnimationType: "mcd-glow"
    }
  };

  // 3. Update each restaurant
  for (const [name, theme] of Object.entries(brandUpdates)) {
    const restaurant = allData.find(r => r.name === name);
    if (!restaurant) {
      console.log(`⚠️ Restaurant "${name}" not found in production database.`);
      continue;
    }

    console.log(`🔄 Updating ${name} (${restaurant.id}) brandTheme with transparent logo...`);
    const updateRes = await fetch(`${API}/api/admin/restaurants/${restaurant.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        brandTheme: theme,
        subscriptionTier: 'premium',
        rating: 4.5
      })
    });

    if (!updateRes.ok) {
      console.error(`❌ Update failed for ${name}:`, await updateRes.text());
    } else {
      console.log(`✅ ${name} updated successfully!`);
    }
  }

  // 4. Verification
  console.log('\n🔍 Verifying database updates...');
  const verifyRes = await fetch(`${API}/api/users/restaurants`);
  const verifyData = await verifyRes.json();
  for (const name of Object.keys(brandUpdates)) {
    const found = verifyData.find(r => r.name === name);
    if (found) {
      console.log(`  ${name}: logoUrl = "${found.brandTheme?.logoUrl}"`);
    } else {
      console.log(`  ${name}: NOT FOUND`);
    }
  }
}

updateLogos().catch(console.error);
