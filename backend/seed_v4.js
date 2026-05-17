/* eslint-disable */
const { Sequelize, DataTypes } = require('sequelize');
const dotenv = require('dotenv');
dotenv.config();

const { connectDB, getSequelize } = require('./config/db');
const { getRestaurantModel } = require('./models/Restaurant');
const { getMenuItemModel } = require('./models/MenuItem');
const { getOrderModel } = require('./models/Order');
const { getUserModel } = require('./models/User');
const { getDeliveryPartnerModel } = require('./models/DeliveryPartner');

const mockVendors = [
  {
    name: "Cacao Culture",
    imageUrl: "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=800",
    vendorType: 'FOOD',
    tags: ["desserts", "sweets"],
    menu: [
      { name: "Belgian Chocolate Truffles", price: 450, category: "Desserts", tags: ["sweets", "seasonal"], image: "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=400" },
      { name: "Red Velvet Jar", price: 180, category: "Desserts", tags: ["sweets", "bakery"], image: "https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?w=400" }
    ]
  },
  {
    name: "Gym Rats Nutrition",
    imageUrl: "https://images.unsplash.com/photo-1583454110551-21f2fa2ec617?w=800",
    vendorType: 'GYM',
    tags: ["gym", "healthy", "supplements"],
    menu: [
      { name: "Whey Protein Isolate (1kg)", price: 2400, category: "Supplements", tags: ["gym", "high-protein"], image: "https://images.unsplash.com/photo-1593095191850-2a76a5da242?w=400" },
      { name: "Steel-Cut Rolled Oats", price: 350, category: "Breakfast", tags: ["gym", "healthy", "low-calorie"], image: "https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=400" }
    ]
  },
  {
    name: "Liquid Luxury",
    imageUrl: "https://images.unsplash.com/photo-1544145945-f904253d0c7b?w=800",
    vendorType: 'DRINKS',
    tags: ["drinks", "beverages"],
    menu: [
      { name: "Sparkling Blue Mocktail", price: 220, category: "Beverages", tags: ["drinks", "seasonal"], image: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=400" },
      { name: "Cold Brew Coffee", price: 180, category: "Beverages", tags: ["drinks", "energy"], image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=400" }
    ]
  },
  {
    name: "Nature's Basket",
    imageUrl: "https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=800",
    vendorType: 'GROCERY',
    tags: ["fruits", "fresh", "healthy"],
    menu: [
      { name: "Premium Apple Box", price: 450, category: "Fruits", tags: ["fruits", "healthy"], image: "https://images.unsplash.com/photo-1560806887-1e4cd0b6fac6?w=400" },
      { name: "Fresh Mangoes (1 Kg)", price: 300, category: "Fruits", tags: ["fruits", "seasonal"], image: "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=400" }
    ]
  },
  {
    name: "Apollo Campus Care",
    imageUrl: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=800",
    vendorType: 'PHARMACY',
    tags: ["pharmacy", "medicine", "health"],
    menu: [
      { name: "First Aid Kit Pro", price: 550, category: "Medical", tags: ["medicine", "emergency"], image: "https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=400" },
      { name: "Vitamin C Supplements", price: 250, category: "Supplements", tags: ["pharmacy", "health"], image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400" }
    ]
  },
  {
    name: "Spin Cycle Laundry",
    imageUrl: "https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?w=800",
    vendorType: 'LAUNDRY',
    tags: ["laundry", "dry-wash", "cleaning"],
    menu: [
      { name: "Premium Dry Wash", price: 200, category: "Services", tags: ["laundry", "dry-wash"], image: "https://images.unsplash.com/photo-1545173168-9f1947eebb7f?w=400" },
      { name: "Express Ironing", price: 100, category: "Services", tags: ["laundry", "ironing"], image: "https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?w=400" }
    ]
  },
  {
    name: "Campus Ride Rentals",
    imageUrl: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=800",
    vendorType: 'RENTAL',
    tags: ["rental", "bike", "transport"],
    menu: [
      { name: "Electric Scooter (Daily)", price: 400, category: "Vehicles", tags: ["rental", "scooter"], image: "https://images.unsplash.com/photo-1563298723-dcfebaa392e3?w=400" },
      { name: "Mountain Bike (Weekly)", price: 600, category: "Vehicles", tags: ["rental", "bicycle"], image: "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=400" }
    ]
  },
  {
    name: "Scholars Stationary & Print",
    imageUrl: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800",
    vendorType: 'STATIONARY',
    tags: ["stationary", "print", "books"],
    menu: [
      { name: "Premium Notebook Bundle", price: 250, category: "Supplies", tags: ["stationary", "books"], image: "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=400" },
      { name: "Engineering Drawing Kit", price: 800, category: "Supplies", tags: ["stationary", "tools"], image: "https://images.unsplash.com/photo-1518118014377-160bf0fd1bc0?w=400" }
    ]
  }
];

const seed = async () => {
  try {
    await connectDB();
    const Restaurant = getRestaurantModel();
    const MenuItem = getMenuItemModel();
    const Order = getOrderModel();
    const User = getUserModel();
    const DeliveryPartner = getDeliveryPartnerModel();
    
    // We use force: true locally to cleanly reset the SQLite database during seeding
    await getSequelize().sync({ force: true });

    await Order.destroy({ where: {} });
    await MenuItem.destroy({ where: {} });
    await Restaurant.destroy({ where: {} });
    await User.destroy({ where: {} });
    await DeliveryPartner.destroy({ where: {} });
    console.log('✅ Cleared existing database.');

    for (const vendorData of mockVendors) {
      const vendor = await Restaurant.create({
        name: vendorData.name,
        location: 'SRM AP Campus',
        imageUrl: vendorData.imageUrl,
        vendorType: vendorData.vendorType,
        commissionRate: 15,
        commissionType: 'percentage',
        operatingHours: { start: '08:00', end: '23:00' },
        isActive: true,
        tags: vendorData.tags || []
      });

      if (vendorData.menu && Array.isArray(vendorData.menu)) {
        const menuItems = vendorData.menu.map(item => ({
          restaurantId: vendor.id,
          name: item.name,
          price: item.price,
          description: `Premium ${item.name} for the Zenvy community.`,
          imageUrl: item.image,
          category: item.category,
          tags: item.tags || [],
          isVegetarian: item.tags.includes('veg') || item.tags.includes('fruits'),
          isAvailable: true,
          isEliteOnly: false
        }));
        await MenuItem.bulkCreate(menuItems);
      }
      console.log(`✅ Seeded Vendor: ${vendor.name}`);
    }

    // Create a demo user for bypass testing (Standard)
    await User.create({
      name: 'Tester',
      phone: '1234567890',
      password: 'password123',
      hostelBlock: 'VEDAVATHI',
      roomNumber: '101',
      isElite: true
    });

    // Create a demo user for error_discovery.js
    await User.create({
      name: 'E2E Tester',
      phone: '9999999999',
      password: 'password123',
      hostelBlock: 'BRAHMAPUTRA',
      roomNumber: '505',
      isElite: true
    });

    // Create a demo rider for bypass testing
    await DeliveryPartner.create({
      name: 'Rider Tester',
      phone: '1234567890',
      password: 'password123',
      isApproved: true,
      isOnline: true
    });

    // Create a demo rider for error_discovery.js
    await DeliveryPartner.create({
      name: 'E2E Rider',
      phone: '8888888888',
      password: 'password123',
      isApproved: true,
      isOnline: true
    });

    console.log('🎉 Seeding Complete. Zenvy Evolution is ready.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seed();
