/**
 * CampusBites — Seed Local Vendor Stalls
 * Run: node backend/scripts/seed_local_vendors.js
 * Creates demo local vendor stalls with menus for SRM & VIT campuses
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function seedLocalVendors() {
  const { connectDB, getSequelize } = require('../config/db');
  await connectDB();
  const sequelize = getSequelize();
  const Restaurant = sequelize.models.Restaurant;
  const MenuItem = sequelize.models.MenuItem;

  if (!Restaurant || !MenuItem) {
    console.error('❌ Models not initialized. Aborting.');
    process.exit(1);
  }

  const vendors = [
    {
      name: 'Raju Dosa Corner',
      location: 'Gate 2, SRM AP Campus Road',
      campus: 'SRM',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1630383249896-424e482df921?q=80&w=400&auto=format&fit=crop',
      rating: 4.5,
      whatsappNumber: '919876543210',
      subscriptionTier: 'premium',
      stallDescription: 'Famous late-night dosa stall serving crispy masala dosas since 2018.',
      promoOffer: '🔥 Buy 2 Dosas, Get Chutney Free!',
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '18:00', end: '02:00' },
      lat: 16.4673,
      lon: 80.5002,
      tags: ['local', 'street-food', 'dosa', 'south-indian'],
      menu: [
        { name: 'Masala Dosa', price: 50, description: 'Crispy golden dosa stuffed with spiced potato filling.', image: 'https://images.unsplash.com/photo-1630383249896-424e482df921?q=80&w=400', category: 'Dosa', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Onion Uttapam', price: 60, description: 'Thick pancake topped with fresh onions and green chillies.', image: 'https://images.unsplash.com/photo-1567337710282-00832b415979?q=80&w=400', category: 'Dosa', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Egg Dosa', price: 45, description: 'Crispy dosa with a fried egg layer.', image: 'https://images.unsplash.com/photo-1645696996148-44c7c45f52b4?q=80&w=400', category: 'Dosa', isVegetarian: false, tags: ['egg', 'local'] },
        { name: 'Podi Dosa', price: 40, description: 'Thin crispy dosa with gunpowder spice mix.', image: 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?q=80&w=400', category: 'Dosa', isVegetarian: true, tags: ['veg', 'local', 'spicy'] },
      ]
    },
    {
      name: 'Bhai Chai Point',
      location: 'Near Boys Hostel, SRM AP',
      campus: 'SRM',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?q=80&w=400&auto=format&fit=crop',
      rating: 4.2,
      whatsappNumber: '919988776655',
      subscriptionTier: 'free',
      stallDescription: 'Your late-night chai companion. Strong cutting chai and Maggi since 2020.',
      promoOffer: null,
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '17:00', end: '01:00' },
      lat: 16.4618,
      lon: 80.5068,
      tags: ['local', 'chai', 'snacks'],
      menu: [
        { name: 'Cutting Chai', price: 15, description: 'Strong half-glass tea with ginger.', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?q=80&w=400', category: 'Beverages', isVegetarian: true, tags: ['veg', 'local', 'drinks'] },
        { name: 'Maggi Special', price: 40, description: 'Extra masala Maggi with veggies and butter.', image: 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?q=80&w=400', category: 'Snacks', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Bread Omelette', price: 35, description: 'Fluffy omelette sandwiched in buttered bread.', image: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?q=80&w=400', category: 'Snacks', isVegetarian: false, tags: ['egg', 'local'] },
      ]
    },
    {
      name: 'Momo Junction',
      location: 'Main Road, Neerukonda',
      campus: 'SRM',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?q=80&w=400&auto=format&fit=crop',
      rating: 4.6,
      whatsappNumber: '919123456789',
      subscriptionTier: 'premium',
      stallDescription: 'Authentic Tibetan momos with spicy red chutney. Student favourite!',
      promoOffer: '🎉 10% off on orders above ₹100',
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '16:00', end: '23:00' },
      lat: 16.4715,
      lon: 80.5055,
      tags: ['local', 'momos', 'chinese'],
      menu: [
        { name: 'Steamed Veg Momos (8pc)', price: 60, description: 'Soft steamed momos with mixed vegetables.', image: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?q=80&w=400', category: 'Momos', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Fried Chicken Momos (8pc)', price: 80, description: 'Crispy fried momos with juicy chicken filling.', image: 'https://images.unsplash.com/photo-1625220194771-7ebdea0b70b9?q=80&w=400', category: 'Momos', isVegetarian: false, tags: ['non-veg', 'local'] },
        { name: 'Tandoori Momos (6pc)', price: 90, description: 'Chargrilled momos with tandoori spices.', image: 'https://images.unsplash.com/photo-1626776876729-bab4369a5a5a?q=80&w=400', category: 'Momos', isVegetarian: false, tags: ['non-veg', 'local', 'spicy'] },
        { name: 'Momos Gravy (8pc)', price: 100, description: 'Steamed momos in spicy red gravy.', image: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?q=80&w=400', category: 'Momos', isVegetarian: false, tags: ['non-veg', 'local'] },
      ]
    },
    {
      name: 'Fresh Juice Bar',
      location: 'Gate 1, SRM AP',
      campus: 'SRM',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1622597467836-f3285f2131b8?q=80&w=400&auto=format&fit=crop',
      rating: 4.3,
      whatsappNumber: '919555444333',
      subscriptionTier: 'free',
      stallDescription: 'Fresh fruit juices and milkshakes. No artificial colors or preservatives.',
      promoOffer: '🥤 Free extra topping on milkshakes!',
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '08:00', end: '22:00' },
      lat: 16.4650,
      lon: 80.5030,
      tags: ['local', 'juice', 'healthy'],
      menu: [
        { name: 'Watermelon Juice', price: 30, description: 'Fresh chilled watermelon juice with ice.', image: 'https://images.unsplash.com/photo-1622597467836-f3285f2131b8?q=80&w=400', category: 'Juices', isVegetarian: true, tags: ['veg', 'local', 'fruits'] },
        { name: 'Mango Milkshake', price: 50, description: 'Thick mango milkshake with real mango pulp.', image: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?q=80&w=400', category: 'Milkshakes', isVegetarian: true, tags: ['veg', 'local', 'drinks'] },
        { name: 'Sugarcane Juice', price: 25, description: 'Freshly crushed sugarcane with lemon and ginger.', image: 'https://images.unsplash.com/photo-1609951651556-5334e2706168?q=80&w=400', category: 'Juices', isVegetarian: true, tags: ['veg', 'local', 'fruits'] },
      ]
    },
    {
      name: 'Amma Biryani Cart',
      location: 'Near VIT Main Gate, Vellore',
      campus: 'VIT',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=400&auto=format&fit=crop',
      rating: 4.7,
      whatsappNumber: '919222333444',
      subscriptionTier: 'premium',
      stallDescription: 'Authentic Hyderabadi dum biryani cooked on charcoal. Night special!',
      promoOffer: '🍗 Extra leg piece on Full Biryani orders',
      isOpenNow: false,
      isActive: true,
      operatingHours: { start: '19:00', end: '00:00' },
      lat: 12.9692,
      lon: 79.1559,
      tags: ['local', 'biryani', 'non-veg'],
      menu: [
        { name: 'Chicken Dum Biryani', price: 120, description: 'Slow-cooked authentic Hyderabadi biryani with tender chicken.', image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=400', category: 'Biryani', isVegetarian: false, tags: ['non-veg', 'local'] },
        { name: 'Egg Biryani', price: 80, description: 'Fragrant rice with boiled eggs in rich masala.', image: 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?q=80&w=400', category: 'Biryani', isVegetarian: false, tags: ['egg', 'local'] },
        { name: 'Veg Biryani', price: 70, description: 'Mixed vegetables cooked in spiced basmati rice.', image: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?q=80&w=400', category: 'Biryani', isVegetarian: true, tags: ['veg', 'local'] },
      ]
    },
    {
      name: 'Shawarma Station',
      location: 'Near Mens Hostel, VIT Vellore',
      campus: 'VIT',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1561651823-34feb02250e4?q=80&w=400&auto=format&fit=crop',
      rating: 4.4,
      whatsappNumber: '919111222333',
      subscriptionTier: 'free',
      stallDescription: 'Best chicken shawarma near campus. Fresh pita with secret garlic sauce.',
      promoOffer: null,
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '17:00', end: '01:00' },
      lat: 12.9710,
      lon: 79.1580,
      tags: ['local', 'shawarma', 'non-veg'],
      menu: [
        { name: 'Chicken Shawarma Roll', price: 70, description: 'Juicy chicken strips in fresh pita with garlic sauce.', image: 'https://images.unsplash.com/photo-1561651823-34feb02250e4?q=80&w=400', category: 'Shawarma', isVegetarian: false, tags: ['non-veg', 'local'] },
        { name: 'Paneer Shawarma Roll', price: 60, description: 'Grilled paneer strips with hummus in warm pita.', image: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?q=80&w=400', category: 'Shawarma', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Loaded Fries', price: 80, description: 'Crispy fries topped with cheese sauce and jalapenos.', image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?q=80&w=400', category: 'Sides', isVegetarian: true, tags: ['veg', 'local'] },
      ]
    }
  ];

  let vendorCount = 0;
  let itemCount = 0;

  for (const vendor of vendors) {
    const { menu, ...vendorData } = vendor;
    try {
      const [rest, created] = await Restaurant.findOrCreate({
        where: { name: vendorData.name, vendorType: 'LOCAL_VENDOR' },
        defaults: vendorData
      });

      if (created) {
        vendorCount++;
        console.log(`✅ Created vendor: ${rest.name} (${rest.campus})`);
      } else {
        // Update existing vendor with new data
        await rest.update(vendorData);
        console.log(`🔄 Updated vendor: ${rest.name}`);
      }

      // Seed menu items
      for (const item of menu) {
        const [, itemCreated] = await MenuItem.findOrCreate({
          where: { name: item.name, restaurantId: rest.id },
          defaults: { ...item, restaurantId: rest.id, isAvailable: true }
        });
        if (itemCreated) itemCount++;
      }
    } catch (err) {
      console.error(`❌ Error seeding ${vendorData.name}:`, err.message);
    }
  }

  console.log(`\n🏪 CampusBites Seed Complete: ${vendorCount} new vendors, ${itemCount} new menu items`);
  process.exit(0);
}

seedLocalVendors().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
