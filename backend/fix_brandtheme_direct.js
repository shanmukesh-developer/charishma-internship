/**
 * fix_brandtheme_direct.js — Directly update brandTheme for flagship restaurants via admin update endpoint
 */
async function fixBrandThemes() {
  const API = 'https://hostelbites-backend-jwmt.onrender.com';

  // 1. Login
  const loginRes = await fetch(`${API}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999999999', password: 'admin123' })
  });
  const { token } = await loginRes.json();
  console.log('✅ Token acquired');

  // 2. Get all restaurants to find IDs
  const allRes = await fetch(`${API}/api/users/restaurants`);
  const allData = await allRes.json();

  const brands = {
    'KFC Premium': {
      primaryColor: "#E4002B",
      secondaryColor: "#111111",
      accentColor: "#FFC72C",
      gradient: "linear-gradient(135deg, #E4002B 0%, #111111 100%)",
      fontColor: "#FFFFFF",
      logoAnimationType: "kfc-bucket-drop",
      logoUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?q=80&w=200&auto=format&fit=crop"
    },
    "Domino's Pizza": {
      primaryColor: "#006491",
      secondaryColor: "#E31B23",
      accentColor: "#006491",
      gradient: "linear-gradient(135deg, #006491 0%, #E31B23 100%)",
      fontColor: "#FFFFFF",
      logoAnimationType: "dominos-flip",
      logoUrl: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=200&auto=format&fit=crop"
    },
    "McDonald's Premium": {
      primaryColor: "#FFC72C",
      secondaryColor: "#DA291C",
      accentColor: "#FFC72C",
      gradient: "linear-gradient(135deg, #DA291C 0%, #FFC72C 100%)",
      fontColor: "#FFFFFF",
      logoAnimationType: "mcd-glow",
      logoUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=200&auto=format&fit=crop"
    }
  };

  for (const [name, theme] of Object.entries(brands)) {
    const restaurant = allData.find(r => r.name === name);
    if (!restaurant) { console.log(`❌ ${name} not found`); continue; }

    console.log(`🔄 Updating ${name} (${restaurant.id}) with brandTheme...`);
    
    // Use the admin restaurant update endpoint
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
      const result = await updateRes.json();
      console.log(`✅ ${name} updated — brandTheme: ${result.brandTheme ? 'SET' : 'still null'}`);
    }
  }

  // 3. Final verification
  console.log('\n🔍 Final verification...');
  // Clear cache by touching any restaurant
  const verifyRes = await fetch(`${API}/api/users/restaurants`);
  const verifyData = await verifyRes.json();
  for (const name of Object.keys(brands)) {
    const r = verifyData.find(x => x.name === name);
    console.log(`  ${name}: brandTheme=${r?.brandTheme ? 'SET ✅' : 'NULL ❌'} | image=${r?.imageUrl?.substring(0,50)}...`);
  }
}

fixBrandThemes().catch(console.error);
