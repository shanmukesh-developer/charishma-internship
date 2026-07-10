/**
 * fix_brands_live.js — Push corrected images + brandTheme to live production DB
 */
async function fixBrands() {
  const API = 'https://hostelbites-backend-jwmt.onrender.com';

  // 1. Login as admin
  console.log('🔐 Logging in as admin...');
  const loginRes = await fetch(`${API}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999999999', password: 'admin123' })
  });
  if (!loginRes.ok) { console.error('Login failed:', await loginRes.text()); return; }
  const { token } = await loginRes.json();
  console.log('✅ Token acquired');

  // 2. The three flagship brands with corrected imageUrl and brandTheme
  const restaurants = [
    {
      name: "KFC Premium",
      location: "Nexus Gate 1",
      vendorType: "RESTAURANT",
      imageUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?q=80&w=800&auto=format&fit=crop",
      tags: ["restaurant", "food", "burgers", "chicken", "premium"],
      brandTheme: {
        primaryColor: "#E4002B",
        secondaryColor: "#111111",
        accentColor: "#FFC72C",
        gradient: "linear-gradient(135deg, #E4002B 0%, #111111 100%)",
        fontColor: "#FFFFFF",
        logoAnimationType: "kfc-bucket-drop",
        logoUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?q=80&w=200&auto=format&fit=crop"
      },
      menu: [
        { name: "KFC Zinger Burger", price: 199, description: "Signature crispy chicken zinger burger, freshly prepared.", imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=600&auto=format&fit=crop", category: "Burgers", tags: ["burgers", "non-veg"], isVegetarian: false },
        { name: "KFC 8pc Hot & Crispy Bucket", price: 649, description: "8 pieces of signature hot & crispy chicken, perfect for sharing.", imageUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?q=80&w=600&auto=format&fit=crop", category: "Fried Chicken", tags: ["chicken", "non-veg"], isVegetarian: false },
        { name: "KFC Popcorn Chicken Large", price: 229, description: "Crispy, bite-sized chicken popcorn seasoned perfectly.", imageUrl: "https://images.unsplash.com/photo-1562967914-608f82629710?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["chicken", "non-veg"], isVegetarian: false }
      ]
    },
    {
      name: "Domino's Pizza",
      location: "Nexus Central",
      vendorType: "RESTAURANT",
      imageUrl: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=800&auto=format&fit=crop",
      tags: ["restaurant", "food", "pizza", "premium"],
      brandTheme: {
        primaryColor: "#006491",
        secondaryColor: "#E31B23",
        accentColor: "#006491",
        gradient: "linear-gradient(135deg, #006491 0%, #E31B23 100%)",
        fontColor: "#FFFFFF",
        logoAnimationType: "dominos-flip",
        logoUrl: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=200&auto=format&fit=crop"
      },
      menu: [
        { name: "Domino's Cheese Burst Margherita", price: 299, description: "Classic cheese burst pizza with rich tomato herb sauce.", imageUrl: "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?q=80&w=600&auto=format&fit=crop", category: "Pizza", tags: ["pizza", "veg"], isVegetarian: true },
        { name: "Domino's Garlic Breadsticks", price: 129, description: "Freshly baked garlic breadsticks served with cheesy dip.", imageUrl: "https://images.unsplash.com/photo-1544982503-9f984c14501a?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["pizza", "veg"], isVegetarian: true },
        { name: "Domino's Choco Lava Cake", price: 109, description: "Delicious hot chocolate lava cake with molten core.", imageUrl: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=600&auto=format&fit=crop", category: "Desserts", tags: ["dessert", "veg"], isVegetarian: true }
      ]
    },
    {
      name: "McDonald's Premium",
      location: "Nexus East",
      vendorType: "RESTAURANT",
      imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=800&auto=format&fit=crop",
      tags: ["restaurant", "food", "burgers", "premium"],
      brandTheme: {
        primaryColor: "#FFC72C",
        secondaryColor: "#DA291C",
        accentColor: "#FFC72C",
        gradient: "linear-gradient(135deg, #DA291C 0%, #FFC72C 100%)",
        fontColor: "#FFFFFF",
        logoAnimationType: "mcd-glow",
        logoUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=200&auto=format&fit=crop"
      },
      menu: [
        { name: "McDonald's Big Mac", price: 249, description: "Double layer flame-grilled chicken patties, special sauce, cheese, pickles.", imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=600&auto=format&fit=crop", category: "Burgers", tags: ["burgers", "non-veg"], isVegetarian: false },
        { name: "McDonald's French Fries L", price: 149, description: "World famous crispy golden fries salted perfectly.", imageUrl: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["fries", "veg"], isVegetarian: true },
        { name: "McDonald's McFlurry Oreo", price: 129, description: "Creamy vanilla soft serve with crunchy Oreo cookie crumbs.", imageUrl: "https://images.unsplash.com/photo-1579954115545-a95591f28bfc?q=80&w=600&auto=format&fit=crop", category: "Desserts", tags: ["dessert", "veg"], isVegetarian: true }
      ]
    }
  ];

  // 3. Push via seed endpoint
  console.log('📡 Pushing 3 flagship brands with images + brandTheme...');
  const seedRes = await fetch(`${API}/api/admin/seed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ restaurants })
  });

  if (!seedRes.ok) {
    console.error('❌ Seed failed:', await seedRes.text());
  } else {
    const result = await seedRes.json();
    console.log('✅ Seed result:', result);
  }

  // 4. Verify
  console.log('\n🔍 Verifying...');
  const verifyRes = await fetch(`${API}/api/users/restaurants`);
  const allData = await verifyRes.json();
  for (const brand of ['KFC Premium', "Domino's Pizza", "McDonald's Premium"]) {
    const found = allData.find(r => r.name === brand);
    if (found) {
      console.log(`✅ ${brand}: imageUrl=${found.imageUrl?.substring(0, 60)}... | brandTheme=${found.brandTheme ? 'SET' : 'NULL'}`);
    } else {
      console.log(`❌ ${brand}: NOT FOUND`);
    }
  }
}

fixBrands().catch(console.error);
