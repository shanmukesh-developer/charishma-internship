// Quick script to check production API data for debugging
const API = 'https://hostelbites-backend-jwmt.onrender.com';

async function check() {
  try {
    // 1. Check restaurants
    const res = await fetch(`${API}/api/users/restaurants`);
    const data = await res.json();
    console.log(`\n=== RESTAURANTS: ${data.length} ===`);
    
    // 2. Check each restaurant's menu item tags
    let totalItems = 0;
    const tagCounts = {};
    const vendorTypeCounts = {};
    
    for (const r of data) {
      const menu = r.menu || [];
      totalItems += menu.length;
      vendorTypeCounts[r.vendorType] = (vendorTypeCounts[r.vendorType] || 0) + 1;
      
      for (const item of menu) {
        const tags = Array.isArray(item.tags) ? item.tags : [];
        for (const tag of tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }
    
    console.log(`Total menu items: ${totalItems}`);
    console.log(`\nVendor types:`, vendorTypeCounts);
    console.log(`\nTag distribution:`, tagCounts);
    
    // 3. Simulate the frontend grouping logic
    const allProducts = data.flatMap(res => 
      (res.menu || []).map(item => ({
        ...item,
        restaurantName: res.name,
        vendorType: res.vendorType,
        tags: Array.isArray(item.tags) ? item.tags : []
      }))
    ).filter(p => p.isAvailable !== false && String(p.isAvailable) !== 'false');
    
    const collections = {
      fruits: [], rentals: [], sweets: [], seasonal: [], drinks: [],
      gym: [], laundry: [], pharmacy: [], stationary: []
    };
    
    allProducts.forEach(p => {
      const tags = p.tags || [];
      const vt = p.vendorType;
      if (tags.includes('fruits') || vt === 'GROCERY') collections.fruits.push(p.name);
      if (tags.includes('rental') || vt === 'RENTAL') collections.rentals.push(p.name);
      if (tags.includes('sweets') || vt === 'SWEETS') collections.sweets.push(p.name);
      if (tags.includes('seasonal') || vt === 'SEASONAL') collections.seasonal.push(p.name);
      if (tags.includes('drinks') || vt === 'DRINKS') collections.drinks.push(p.name);
      if (tags.includes('gym') || tags.includes('high-protein') || vt === 'GYM') collections.gym.push(p.name);
      if (tags.includes('laundry') || tags.includes('dry-wash') || vt === 'LAUNDRY') collections.laundry.push(p.name);
      if (tags.includes('medicine') || tags.includes('pharmacy') || vt === 'PHARMACY') collections.pharmacy.push(p.name);
      if (tags.includes('stationary') || tags.includes('books') || tags.includes('print') || vt === 'STATIONARY') collections.stationary.push(p.name);
    });
    
    console.log(`\n=== GROUPED COLLECTIONS (simulating frontend) ===`);
    for (const [key, items] of Object.entries(collections)) {
      console.log(`  ${key}: ${items.length} items → [${items.join(', ')}]`);
    }
    
    // 4. Check PG Hostels
    try {
      const pgRes = await fetch(`${API}/api/pg`);
      const pgData = await pgRes.json();
      console.log(`\n=== PG HOSTELS: ${Array.isArray(pgData) ? pgData.length : 'ERROR: ' + JSON.stringify(pgData)} ===`);
    } catch (e) {
      console.log(`\n=== PG HOSTELS: FETCH ERROR: ${e.message} ===`);
    }
    
  } catch (err) {
    console.error('ERROR:', err.message);
  }
}

check();
