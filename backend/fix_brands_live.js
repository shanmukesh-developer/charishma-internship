/**
 * fix_brands_live.js — Push rich menu data + brandTheme to live production DB
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

  // 2. The three flagship brands with corrected imageUrl, brandTheme, and rich menu item lists
  const restaurants = [
    {
      name: "KFC Premium",
      location: "Nexus Gate 1",
      vendorType: "RESTAURANT",
      imageUrl: "https://images.unsplash.com/photo-1513639776629-7b61b0ac23c3?q=80&w=800&auto=format&fit=crop",
      tags: ["restaurant", "food", "burgers", "chicken", "premium"],
      brandTheme: {
        primaryColor: "#E4002B",
        secondaryColor: "#111111",
        accentColor: "#FFC72C",
        gradient: "linear-gradient(135deg, #E4002B 0%, #111111 100%)",
        fontColor: "#FFFFFF",
        logoAnimationType: "kfc-bucket-drop",
        logoUrl: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Kentucky_Fried_Chicken_201x_logo.svg"
      },
      menu: [
        { name: "KFC Zinger Burger", price: 199, description: "Signature crispy chicken zinger burger, freshly prepared with lettuce and mayo.", imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=600&auto=format&fit=crop", category: "Burgers", tags: ["burgers", "non-veg"], isVegetarian: false },
        { name: "KFC 8pc Hot & Crispy Bucket", price: 649, description: "8 pieces of signature hot & crispy chicken, perfect for sharing.", imageUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?q=80&w=600&auto=format&fit=crop", category: "Fried Chicken", tags: ["chicken", "non-veg"], isVegetarian: false },
        { name: "KFC Popcorn Chicken Large", price: 229, description: "Crispy, bite-sized chicken popcorn seasoned perfectly with spices.", imageUrl: "https://images.unsplash.com/photo-1562967914-608f82629710?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["chicken", "non-veg"], isVegetarian: false },
        { name: "Crispy Chicken Strips 5pc", price: 179, description: "Tender boneless chicken strips, double-breaded for extra crunch.", imageUrl: "https://images.unsplash.com/photo-1606755962773-d324e0a13086?q=80&w=600&auto=format&fit=crop", category: "Fried Chicken", tags: ["chicken", "non-veg"], isVegetarian: false },
        { name: "Smoky Red Grilled Chicken 2pc", price: 199, description: "Juicy chicken pieces marinated in smoky red spices and grilled.", imageUrl: "https://images.unsplash.com/photo-1598515214211-89d3e73ae83b?q=80&w=600&auto=format&fit=crop", category: "Fried Chicken", tags: ["chicken", "non-veg"], isVegetarian: false },
        { name: "Double Patty Zinger Pro Max", price: 289, description: "Two crispy chicken patties loaded with melted cheese, lettuce, and secret sauce.", imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=600&auto=format&fit=crop", category: "Burgers", tags: ["burgers", "non-veg"], isVegetarian: false },
        { name: "Krushers Choco Crunch", price: 139, description: "Chilled creamy milkshake blended with crunchy chocolate cookies.", imageUrl: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?q=80&w=600&auto=format&fit=crop", category: "Drinks", tags: ["drinks", "veg"], isVegetarian: true },
        { name: "Ultimate Savings Bucket", price: 849, description: "Mega savings combo of 4pc hot & crispy, 4pc chicken strips, and a large popcorn chicken.", imageUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?q=80&w=600&auto=format&fit=crop", category: "Fried Chicken", tags: ["chicken", "non-veg"], isVegetarian: false }
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
        logoUrl: "https://upload.wikimedia.org/wikipedia/commons/3/3e/Domino%27s_pizza_logo.svg"
      },
      menu: [
        { name: "Domino's Cheese Burst Margherita", price: 299, description: "Classic cheese burst pizza with rich tomato herb sauce and liquid cheese.", imageUrl: "https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?q=80&w=600&auto=format&fit=crop", category: "Pizza", tags: ["pizza", "veg"], isVegetarian: true },
        { name: "Domino's Garlic Breadsticks", price: 129, description: "Freshly baked garlic breadsticks served with creamy jalapeno cheesy dip.", imageUrl: "https://images.unsplash.com/photo-1544982503-9f984c14501a?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["pizza", "veg"], isVegetarian: true },
        { name: "Domino's Choco Lava Cake", price: 109, description: "Delicious hot chocolate lava cake with warm molten chocolate core.", imageUrl: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=600&auto=format&fit=crop", category: "Desserts", tags: ["dessert", "veg"], isVegetarian: true },
        { name: "Peppy Paneer Pizza", price: 349, description: "Flavorful paneer, crisp capsicum, and spicy red paprika over a cheese burst crust.", imageUrl: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=600&auto=format&fit=crop", category: "Pizza", tags: ["pizza", "veg"], isVegetarian: true },
        { name: "Chicken Golden Delight", price: 399, description: "Delectable toppings of double barbecue chicken, golden corn, and extra mozzarella.", imageUrl: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?q=80&w=600&auto=format&fit=crop", category: "Pizza", tags: ["pizza", "non-veg"], isVegetarian: false },
        { name: "Veg Extravaganza Pizza", price: 449, description: "Black olives, green capsicum, red onion, tomato, jalapenos, and baby corn loaded with extra cheese.", imageUrl: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=600&auto=format&fit=crop", category: "Pizza", tags: ["pizza", "veg"], isVegetarian: true },
        { name: "Paneer Zingy Parcel", price: 89, description: "Savory puff pastry filled with creamy paneer blocks and spicy seasoning.", imageUrl: "https://images.unsplash.com/photo-1544982503-9f984c14501a?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["sides", "veg"], isVegetarian: true },
        { name: "Taco Mexicana Veg", price: 119, description: "Crispy taco shell folded with a spicy vegetable patty and creamy southwestern sauce.", imageUrl: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["sides", "veg"], isVegetarian: true }
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
        logoUrl: "https://upload.wikimedia.org/wikipedia/commons/3/36/McDonald%27s_Golden_Arches.svg"
      },
      menu: [
        { name: "McDonald's Big Mac", price: 249, description: "Double layer flame-grilled chicken patties, special sauce, cheese, pickles, and lettuce.", imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=600&auto=format&fit=crop", category: "Burgers", tags: ["burgers", "non-veg"], isVegetarian: false },
        { name: "McDonald's French Fries L", price: 149, description: "World famous crispy golden fries salted perfectly.", imageUrl: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["fries", "veg"], isVegetarian: true },
        { name: "McDonald's McFlurry Oreo", price: 129, description: "Creamy vanilla soft serve with crunchy Oreo cookie crumbs.", imageUrl: "https://images.unsplash.com/photo-1579954115545-a95591f28bfc?q=80&w=600&auto=format&fit=crop", category: "Desserts", tags: ["dessert", "veg"], isVegetarian: true },
        { name: "McSpicy Chicken Burger", price: 189, description: "Tender chicken patty breaded in hot spices, topped with creamy sauce and lettuce.", imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=600&auto=format&fit=crop", category: "Burgers", tags: ["burgers", "non-veg"], isVegetarian: false },
        { name: "Chicken McNuggets 9pc", price: 199, description: "9 pieces of crispy tender chicken nuggets served with barbecue dip.", imageUrl: "https://images.unsplash.com/photo-1562967914-608f82629710?q=80&w=600&auto=format&fit=crop", category: "Sides", tags: ["chicken", "non-veg"], isVegetarian: false },
        { name: "Egg McMuffin Combo", price: 159, description: "Toasted English muffin with a fresh egg, melted cheddar cheese, and signature sauce.", imageUrl: "https://images.unsplash.com/photo-1525351484163-7529414344d8?q=80&w=600&auto=format&fit=crop", category: "Burgers", tags: ["burgers", "egg"], isVegetarian: false },
        { name: "McCafé Iced Americano", price: 119, description: "Rich, full-bodied espresso shot poured over ice and chilled water.", imageUrl: "https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=600&auto=format&fit=crop", category: "Drinks", tags: ["drinks", "coffee"], isVegetarian: true }
      ]
    }
  ];

  // 3. Push via seed endpoint
  console.log('📡 Pushing 3 flagship brands with rich images + brandTheme to production...');
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
      console.log(`✅ ${brand}: menuItemsCount=${found.menu?.length} | logoUrl=${found.brandTheme?.logoUrl}`);
    } else {
      console.log(`❌ ${brand}: NOT FOUND`);
    }
  }
}

fixBrands().catch(console.error);
