require('dotenv').config();
const { connectDB } = require('../config/db');
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { getUserModel } = require('../models/User');
const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { initVaultItemModel, getVaultItemModel } = require('../models/VaultItem');
const { getPGHostelModel } = require('../models/PGHostel');
const { getPGRoomModel } = require('../models/PGRoom');
const { getSequelize } = require('../config/db');

const unifiedSeed = async () => {
  await connectDB();
  const DeliveryPartner = getDeliveryPartnerModel();
  const User = getUserModel();
  const Restaurant = getRestaurantModel();
  const MenuItem = getMenuItemModel();
  const VaultItem = getVaultItemModel() || initVaultItemModel(getSequelize());

  console.log('--- Starting Unified Production Seed ---');

  // 1. Seed Riders
  const riders = [
    { name: 'Hostel Hub Rider', phone: '0000000000', password: 'password123', isApproved: true, isOnline: true },
    { name: 'E2E Test Rider', phone: 'driver1', password: 'password123', isApproved: true, isOnline: true }
  ];

  for (const r of riders) {
    const [rider, created] = await DeliveryPartner.findOrCreate({
      where: { phone: r.phone },
      defaults: r
    });
    if (!created) {
      await rider.update(r, { individualHooks: true });
      console.log(`✅ Rider Updated: ${r.phone}`);
    } else {
      console.log(`✅ Rider Created: ${r.phone}`);
    }
  }

  // 2. Seed Users
  const users = [
    { name: 'Sanya Gupta', phone: '9123456789', password: 'password123', role: 'student', isElite: true },
    { name: 'Nexus Admin', phone: '9391955674', password: 'zenvy_admin', role: 'admin' },
    { name: 'System Admin', phone: '9999999999', password: 'admin123', role: 'admin' }
  ];

  for (const u of users) {
    const [user, created] = await User.findOrCreate({
      where: { phone: u.phone },
      defaults: u
    });
    if (!created) {
      await user.update(u, { individualHooks: true });
      console.log(`✅ User Updated: ${u.phone}`);
    } else {
      console.log(`✅ User Created: ${u.phone}`);
    }
  }

  // Clear old tables to prevent duplicates and clean up legacy data
  // NOTE: We do NOT destroy Orders — those are user data
  console.log('🧹 Clearing restaurant catalog for fresh seed (orders preserved)...');
  const sequelize = getSequelize();
  try {
    await sequelize.query('PRAGMA foreign_keys = OFF;');
  } catch (e) {}
  const CommunityPost = sequelize.models.CommunityPost;
  if (CommunityPost) await CommunityPost.destroy({ where: {}, force: true });
  await MenuItem.destroy({ where: {} });
  await Restaurant.destroy({ where: {} });

  const mockData = [
    {
      id: "8467dbf0-1b1b-4ae5-88b6-0fccbfcb1cbb",
      name: "Biryani Hub",
      imageUrl: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=800",
      categories: ["Biryani", "Kebabs", "Main Course"],
      vendorType: "RESTAURANT",
      rating: 4.8,
      lat: 16.4632,
      lon: 80.5064,
      menu: [
        { name: "Special Mutton Fry", price: 280, description: "Tender goat cooked in traditional spices.", image: "https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=800", category: "Biryani", isVegetarian: false, tags: ["biryani", "non-veg"] },
        { name: "Royal Egg Biryani", price: 220, description: "Fragrant rice with double eggs.", image: "https://images.unsplash.com/photo-1589302168068-964664d93dc0?q=80&w=800", category: "Biryani", isVegetarian: true, tags: ["biryani", "veg"] },
        { name: "Chicken Tikka Kebab", price: 180, description: "Juicy grilled chicken skewers.", image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?q=80&w=800", category: "Kebabs", isVegetarian: false, tags: ["kebabs", "non-veg"] },
        { name: "Hyderabadi Dum Biryani", price: 250, description: "Classic slow-cooked chicken biryani.", image: "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?q=80&w=800", category: "Biryani", isVegetarian: false, tags: ["biryani", "non-veg"] },
        { name: "Paneer Tikka Kebab", price: 160, description: "Grilled cottage cheese with herbs.", image: "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=800", category: "Kebabs", isVegetarian: true, tags: ["kebabs", "veg"] },
        { name: "Tandoori Roti", price: 40, description: "Freshly baked clay oven bread.", image: "https://images.unsplash.com/photo-1585238342024-78d387f4a707?q=80&w=800", category: "Main Course", isVegetarian: true, tags: ["bread", "veg"] },
        { name: "Butter Chicken", price: 240, description: "Creamy tomato based chicken curry.", image: "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?q=80&w=800", category: "Main Course", isVegetarian: false, tags: ["curry", "non-veg"] },
        { name: "Dal Makhani", price: 190, description: "Rich black lentils cooked overnight.", image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=800", category: "Main Course", isVegetarian: true, tags: ["curry", "veg"] },
        { name: "Garlic Naan", price: 60, description: "Soft bread with toasted garlic.", image: "https://images.unsplash.com/photo-1601050690597-df056fb4ce78?q=80&w=800", category: "Main Course", isVegetarian: true, tags: ["bread", "veg"] },
        { name: "Gulab Jamun", price: 80, description: "Sweet milk dumplings in syrup.", image: "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=800", category: "Dessert", isVegetarian: true, tags: ["dessert", "sweets"] }
      ]
    },
    {
      id: "5beef15a-8b83-49cc-8514-6ef26db12345",
      name: "The Burger Club",
      imageUrl: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?q=80&w=800",
      categories: ["Burgers", "Sides", "Shakes"],
      vendorType: "RESTAURANT",
      rating: 4.6,
      lat: 16.4650,
      lon: 80.5080,
      menu: [
        { name: "Classic Cheeseburger", price: 150, description: "Juicy patty with melted cheddar.", image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=800", category: "Burgers", isVegetarian: false, tags: ["burgers", "non-veg"] },
        { name: "Bacon Blaze Burger", price: 220, description: "Crispy bacon with spicy aioli.", image: "https://images.unsplash.com/photo-1553979459-d2229ba7433b?q=80&w=800", category: "Burgers", isVegetarian: false, tags: ["burgers", "non-veg"] },
        { name: "Mushroom Swiss", price: 190, description: "Sautéed mushrooms and swiss cheese.", image: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?q=80&w=800", category: "Burgers", isVegetarian: true, tags: ["burgers", "veg"] },
        { name: "Peri Peri Chicken Burger", price: 180, description: "Flaming peri peri grilled chicken.", image: "https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?q=80&w=800", category: "Burgers", isVegetarian: false, tags: ["burgers", "non-veg"] },
        { name: "Veggie Delight", price: 140, description: "Crispy veg patty with fresh greens.", image: "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=800", category: "Burgers", isVegetarian: true, tags: ["burgers", "veg"] },
        { name: "Peri Peri Fries", price: 80, description: "Spicy seasoned crinkle cut fries.", image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?q=80&w=800", category: "Sides", isVegetarian: true, tags: ["sides", "veg"] },
        { name: "Onion Rings", price: 90, description: "Beer battered crispy onion rings.", image: "https://images.unsplash.com/photo-1639024471283-2bc7b3c6a267?q=80&w=800", category: "Sides", isVegetarian: true, tags: ["sides", "veg"] },
        { name: "Chocolate Shake", price: 120, description: "Thick belgian chocolate shake.", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?q=80&w=800", category: "Shakes", isVegetarian: true, tags: ["shakes", "veg"] },
        { name: "Strawberry Frost", price: 110, description: "Fresh strawberry creamy shake.", image: "https://images.unsplash.com/photo-1579954115545-a95591f28bfc?q=80&w=800", category: "Shakes", isVegetarian: true, tags: ["shakes", "veg"] },
        { name: "Chicken Nuggets", price: 130, description: "Crispy golden chicken bites.", image: "https://images.unsplash.com/photo-1562967914-608f82629710?q=80&w=800", category: "Sides", isVegetarian: false, tags: ["sides", "non-veg"] }
      ]
    },
    {
      id: "706822c4-2eb3-43b4-ad86-91a252ea9108",
      name: "Pizza Paradise",
      imageUrl: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=800",
      categories: ["Pizza", "Pasta", "Sides"],
      vendorType: "RESTAURANT",
      rating: 4.7,
      lat: 16.4610,
      lon: 80.5040,
      menu: [
        { name: "Margherita Classica", price: 280, description: "San Marzano tomatoes & fresh mozzarella.", image: "https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?q=80&w=800", category: "Pizza", isVegetarian: true, tags: ["pizza", "veg"] },
        { name: "Pepperoni Feast", price: 350, description: "Double pepperoni with herb blend.", image: "https://images.unsplash.com/photo-1628840042765-356cda07504e?q=80&w=800", category: "Pizza", isVegetarian: false, tags: ["pizza", "non-veg"] },
        { name: "Farmhouse Special", price: 320, description: "Bell peppers, mushrooms, corn & onion.", image: "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?q=80&w=800", category: "Pizza", isVegetarian: true, tags: ["pizza", "veg"] },
        { name: "Chicken Tikka Pizza", price: 340, description: "Indian fusion tikka with capsicum.", image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?q=80&w=800", category: "Pizza", isVegetarian: false, tags: ["pizza", "non-veg"] },
        { name: "Arrabiata Pasta", price: 240, description: "Spicy tomato sauce with penne.", image: "https://images.unsplash.com/photo-1608897013039-887f21d8c804?q=80&w=800", category: "Pasta", isVegetarian: true, tags: ["pasta", "veg"] },
        { name: "Creamy Alfredo", price: 260, description: "White sauce pasta with mushrooms.", image: "https://images.unsplash.com/photo-1645112411341-6c4fd023714a?q=80&w=800", category: "Pasta", isVegetarian: true, tags: ["pasta", "veg"] },
        { name: "Garlic Breadsticks", price: 90, description: "Baked fresh with garlic butter.", image: "https://images.unsplash.com/photo-1544982503-9f984c14501a?q=80&w=800", category: "Sides", isVegetarian: true, tags: ["sides", "veg"] },
        { name: "Stuffed Garlic Bread", price: 140, description: "Cheese & jalapeno stuffed bread.", image: "https://images.unsplash.com/photo-1607532941433-304659e8198a?q=80&w=800", category: "Sides", isVegetarian: true, tags: ["sides", "veg"] },
        { name: "Garden Salad", price: 120, description: "Fresh seasonal greens with dressing.", image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=800", category: "Sides", isVegetarian: true, tags: ["sides", "veg"] },
        { name: "Tiramisu Cup", price: 180, description: "Coffee-flavored Italian dessert.", image: "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?q=80&w=800", category: "Dessert", isVegetarian: true, tags: ["dessert", "sweets"] }
      ]
    },
    {
      id: "a5124e4d-1768-45d2-b062-8178cd901234",
      name: "Subway Fresh",
      imageUrl: "https://images.unsplash.com/photo-1509722747041-616f39b57569?q=80&w=800",
      categories: ["Subs", "Salads", "Cookies"],
      vendorType: "RESTAURANT",
      rating: 4.4,
      lat: 16.4660,
      lon: 80.5090,
      menu: [
        { name: "Roasted Chicken Sub", price: 190, description: "Succulent chicken with fresh veggies.", image: "https://images.unsplash.com/photo-1553909489-cd47e0907980?q=80&w=800", category: "Subs", isVegetarian: false, tags: ["subs", "non-veg"] },
        { name: "Paneer Tikka Sub", price: 170, description: "Spicy paneer in choice of bread.", image: "https://images.unsplash.com/photo-1626074353765-517a681e40be?q=80&w=800", category: "Subs", isVegetarian: true, tags: ["subs", "veg"] },
        { name: "Italian B.M.T.", price: 220, description: "Genoa salami, pepperoni & ham.", image: "https://images.unsplash.com/photo-1539252554453-80ab65ce3586?q=80&w=800", category: "Subs", isVegetarian: false, tags: ["subs", "non-veg"] },
        { name: "Vegi Delite", price: 140, description: "Loaded with fresh seasonal veggies.", image: "https://images.unsplash.com/photo-1540713434306-53f2c3d1a3be?q=80&w=800", category: "Subs", isVegetarian: true, tags: ["subs", "veg"] },
        { name: "Chicken Kofta Sub", price: 200, description: "Spicy chicken meatballs with sauce.", image: "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?q=80&w=800", category: "Subs", isVegetarian: false, tags: ["subs", "non-veg"] },
        { name: "Aloo Patty Wrap", price: 130, description: "Spiced potato patty in a soft wrap.", image: "https://images.unsplash.com/photo-1626700051175-6518c4793f0f?q=80&w=800", category: "Subs", isVegetarian: true, tags: ["subs", "veg"] },
        { name: "Corn & Peas Salad", price: 160, description: "Sweet corn and peas mix.", image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800", category: "Salads", isVegetarian: true, tags: ["salads", "veg"] },
        { name: "Dark Chocolate Cookie", price: 50, description: "Soft & chewy chocolate chip cookie.", image: "https://images.unsplash.com/photo-1499636136210-6f4ee915583e?q=80&w=800", category: "Cookies", isVegetarian: true, tags: ["cookies", "veg"] },
        { name: "Oatmeal Raisin Cookie", price: 50, description: "Healthy oats and raisin sweet.", image: "https://images.unsplash.com/photo-1558961309-db6f1a3068c3?q=80&w=800", category: "Cookies", isVegetarian: true, tags: ["cookies", "veg"] },
        { name: "Coke Zero", price: 40, description: "Chilled sugar-free refreshment.", image: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?q=80&w=800", category: "Drinks", isVegetarian: true, tags: ["drinks", "veg"] }
      ]
    },
    {
      id: "c6142c67-62f7-4148-963d-4952de123456",
      name: "La Pino'z",
      imageUrl: "https://images.unsplash.com/photo-1590947132387-155cc02f3212?q=80&w=800",
      categories: ["Pizza", "Sides", "Beverages"],
      vendorType: "RESTAURANT",
      rating: 4.5,
      lat: 16.4670,
      lon: 80.5100,
      menu: [
        { name: "7 Layer Pizza", price: 380, description: "Loaded with unique layers of toppings.", image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=800", category: "Pizza", isVegetarian: true, tags: ["pizza", "veg"] },
        { name: "Cheesy Macaroni", price: 180, description: "Hot & cheesy classic macaroni.", image: "https://images.unsplash.com/photo-1543339494-b4cd4f7ba686?q=80&w=800", category: "Sides", isVegetarian: true, tags: ["sides", "veg"] },
        { name: "Paneer Makhani Slice", price: 120, description: "Giant slice with makhani gravy.", image: "https://images.unsplash.com/photo-1628840042765-356cda07504e?q=80&w=800", category: "Pizza", isVegetarian: true, tags: ["pizza", "veg"] },
        { name: "Peri Peri Garlic Bread", price: 110, description: "Spicy twist on garlic bread.", image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?q=80&w=800", category: "Sides", isVegetarian: true, tags: ["sides", "veg"] },
        { name: "English Vinglish Pizza", price: 290, description: "Exotic vegetable pizza blend.", image: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?q=80&w=800", category: "Pizza", isVegetarian: true, tags: ["pizza", "veg"] },
        { name: "Chicken Tikka Tacos", price: 150, description: "Fusion tacos with tikka filling.", image: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?q=80&w=800", category: "Sides", isVegetarian: false, tags: ["sides", "non-veg"] },
        { name: "Fries Overloaded", price: 140, description: "Fries topped with cheese & jalapenos.", image: "https://images.unsplash.com/photo-1585109649139-366815a0d713?q=80&w=800", category: "Sides", isVegetarian: true, tags: ["sides", "veg"] },
        { name: "Choco Lava Cake", price: 90, description: "Molten chocolate center cake.", image: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=800", category: "Dessert", isVegetarian: true, tags: ["dessert", "veg"] },
        { name: "Cold Coffee", price: 100, description: "Creamy whipped cold coffee.", image: "https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=800", category: "Beverages", isVegetarian: true, tags: ["beverages", "veg"] },
        { name: "Mountain Dew", price: 40, description: "Chilled citrus refreshment.", image: "https://images.unsplash.com/photo-1534353436294-0dbd4bdac845?q=80&w=800", category: "Beverages", isVegetarian: true, tags: ["beverages", "veg"] }
      ]
    },
    {
      id: "0c5de1a2-cb3d-4007-aaef-6789db123456",
      name: "Iron Kitchen: Pro Meals",
      imageUrl: "https://images.unsplash.com/photo-1543353071-10c8ba85a904?q=80&w=800",
      categories: ["Protein Bowls", "Lean Salads", "Keto"],
      vendorType: "GYM",
      rating: 4.9,
      lat: 16.4632,
      lon: 80.5064,
      menu: [
        { name: "Whey Protein Bowl", price: 250, description: "30g protein, quinoa, avocado and chicken.", image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800", category: "Protein Bowls", isVegetarian: false, tags: ["gym", "high-protein", "healthy"] },
        { name: "Lean Muscle Salad", price: 220, description: "Grilled turkey with kale and almond flakes.", image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=800", category: "Lean Salads", isVegetarian: false, tags: ["gym", "healthy"] }
      ]
    },
    {
      id: "1d5de1b3-db4d-4008-bbfe-7890db123456",
      name: "Zenvy Fuel: Protein Shakes",
      imageUrl: "https://images.unsplash.com/photo-1579758629938-03607ccdbaba?q=80&w=800",
      categories: ["Whey", "Vegan", "Mass Gainer"],
      vendorType: "GYM",
      rating: 5.0,
      lat: 16.4632,
      lon: 80.5064,
      menu: [
        { name: "Dark Gold Whey (30g)", price: 180, description: "Elite recovery with 100% whey isolate.", image: "https://images.unsplash.com/photo-1593095948071-474c5cc2989d?q=80&w=800", category: "Whey", isVegetarian: true, tags: ["gym", "high-protein"] },
        { name: "Bulk Master Gainer", price: 210, description: "High calorie mass gainer for hard gainers.", image: "https://images.unsplash.com/photo-1579758629938-03607ccdbaba?q=80&w=800", category: "Mass Gainer", isVegetarian: true, tags: ["gym", "high-protein"] }
      ]
    },
    {
      id: "296ec3cf-4eee-44e7-9454-1d4e563e1687",
      name: "Fresh Harvest: Elite",
      imageUrl: "https://images.unsplash.com/photo-1610832958506-aa56368176cf?q=80&w=800",
      categories: ["Platters", "Bowls", "Juices"],
      vendorType: "GROCERY",
      rating: 4.9,
      lat: 16.4632,
      lon: 80.5064,
      menu: [
        { name: "Exotic Fruit Platter", price: 180, description: "Dragon fruit, Mango, Kiwi & Berries.", image: "https://images.unsplash.com/photo-1490474418585-ba9dd8fd36ea?q=80&w=800", category: "Platters", isVegetarian: true, tags: ["fruits", "healthy"] },
        { name: "Power Citrus Bowl", price: 140, description: "Orange, Grapefruit & Pomegranate.", image: "https://images.unsplash.com/photo-1525351484163-7529414344d8?q=80&w=800", category: "Bowls", isVegetarian: true, tags: ["fruits", "healthy"] }
      ]
    },
    {
      id: "2e5de1c4-ec5d-4009-ccff-8901db123456",
      name: "Zenvy Elite Gear",
      imageUrl: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=800",
      categories: ["Lifting Belts", "Straps", "Accessories"],
      vendorType: "GYM",
      rating: 5.0,
      lat: 16.4632,
      lon: 80.5064,
      menu: [
        { name: "Professional Lever Belt", price: 2500, description: "13mm thick genuine leather with steel lever.", image: "https://images.unsplash.com/photo-1620188467120-5042ed1eb5da?q=80&w=800", category: "Lifting Belts", isVegetarian: true, tags: ["gym", "rental"] },
        { name: "Gold-Grip Lifting Straps", price: 450, description: "Heavy-duty cotton with anti-slip gold grip.", image: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=800", category: "Straps", isVegetarian: true, tags: ["gym", "rental"] },
        { name: "Elite Matte Shaker", price: 800, description: "Stainless steel, 750ml with leak-proof lid.", image: "https://images.unsplash.com/photo-1579758629938-03607ccdbaba?q=80&w=800", category: "Accessories", isVegetarian: true, tags: ["gym", "rental"] }
      ]
    },
    {
      id: "e9eb9d54-3a51-422d-b070-e66975a6b68e",
      name: "Summer Oasis: Elite",
      imageUrl: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?q=80&w=800",
      categories: ["Coolants", "Traditional", "Ice Creams"],
      vendorType: "SEASONAL",
      rating: 5.0,
      lat: 16.4632,
      lon: 80.5064,
      menu: [
        { name: "Chilled Tender Coconut", price: 60, description: "Freshly cut natural coconut water with pulp.", image: "https://images.unsplash.com/photo-1526318896980-cf78c088247c?q=80&w=800", category: "Coolants", isVegetarian: true, tags: ["seasonal", "drinks"] },
        { name: "Golden Badam Palu", price: 90, description: "Authentic almond milk with saffron and nuts.", image: "https://images.unsplash.com/photo-1634832506443-4c570af4b680?q=80&w=800", category: "Traditional", isVegetarian: true, tags: ["seasonal", "drinks", "traditional"] },
        { name: "Zesty Masala Soda", price: 50, description: "Refreshing lime soda with a secret spice blend.", image: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?q=80&w=800", category: "Coolants", isVegetarian: true, tags: ["seasonal", "drinks"] },
        { name: "Traditional Sugandhi", price: 70, description: "Natural Sarsaparilla coolant with lemon.", image: "https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?q=80&w=800", category: "Traditional", isVegetarian: true, tags: ["seasonal", "drinks", "traditional"] },
        { name: "Artisanal Mango Gelato", price: 150, description: "House-made creamy mango ice cream.", image: "https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?q=80&w=800", category: "Ice Creams", isVegetarian: true, tags: ["seasonal", "sweets"] }
      ]
    },
    {
      id: "bef0fa4b-1c1d-4f22-ae74-d32df31e2d37",
      name: "Zenvy Bakery: Elite",
      imageUrl: "https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=800",
      categories: ["Pastries", "Sourdough", "Cookies"],
      vendorType: "SWEETS",
      rating: 5.0,
      lat: 16.4632,
      lon: 80.5064,
      menu: [
        { name: "Flaky Butter Croissant", price: 120, description: "Authentic French style, 24-layer buttery pastry.", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=800", category: "Pastries", isVegetarian: true, tags: ["sweets", "bakery"] },
        { name: "Dark Chocolate Cookie", price: 80, description: "Sea salt and 70% dark Belgian chocolate.", image: "https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?q=80&w=800", category: "Cookies", isVegetarian: true, tags: ["sweets", "bakery"] },
        { name: "Red Velvet Cupcake", price: 95, description: "Classic red velvet with cream cheese frosting.", image: "https://images.unsplash.com/photo-1576618148400-f54bed99fcfd?q=80&w=800", category: "Cupcakes", isVegetarian: true, tags: ["sweets", "bakery"] },
        { name: "Zenvy Signature Cake", price: 1200, description: "Luxurious tiered Belgian chocolate cake.", image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?q=80&w=800", category: "Cakes", isVegetarian: true, tags: ["sweets", "bakery"] }
      ]
    },
    {
      id: "ca3f99e1-8f1f-4f3e-a209-ed78ff638cf5",
      name: "Royal Sweet Boutique: Elite",
      imageUrl: "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=800",
      categories: ["Traditional", "Gourmet", "Festive"],
      vendorType: "SWEETS",
      rating: 5.0,
      lat: 16.4632,
      lon: 80.5064,
      menu: [
        { name: "Saffron Gulab Jamun", price: 110, description: "Soft milk dumplings in infused saffron syrup.", image: "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=800", category: "Traditional", isVegetarian: true, tags: ["sweets", "traditional"] },
        { name: "Pistachio Rasmalai", price: 130, description: "Kesar infused milk discs with crushed pistachios.", image: "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=800", category: "Traditional", isVegetarian: true, tags: ["sweets", "traditional"] },
        { name: "Kaju Katli (Elite Edition)", price: 250, description: "Premium cashews with pure silver vark.", image: "https://images.unsplash.com/photo-1601356616077-6957284f707c?q=80&w=800", category: "Gourmet", isVegetarian: true, tags: ["sweets", "gourmet"] }
      ]
    }
  ];

  // 3. Seed Standard Restaurants (Gourmets)
  for (const restData of mockData) {
    const restaurant = await Restaurant.create({
      id: restData.id,
      name: restData.name,
      location: 'SRM AP Main Campus',
      imageUrl: restData.imageUrl,
      vendorType: restData.vendorType || 'RESTAURANT',
      rating: restData.rating || 4.0,
      lat: restData.lat || 16.4632,
      lon: restData.lon || 80.5064,
      commissionRate: 15,
      password: 'password123',
      commissionType: 'percentage',
      operatingHours: { start: '09:00', end: '22:00' },
      isActive: true,
      tags: restData.categories || []
    });

    if (restData.menu && Array.isArray(restData.menu)) {
      const menuItems = restData.menu.map(item => ({
        restaurantId: restaurant.id,
        name: item.name,
        price: item.price,
        description: item.description,
        imageUrl: item.image || item.imageUrl,
        category: item.category,
        isVegetarian: item.isVegetarian !== undefined ? item.isVegetarian : true,
        isAvailable: true,
        isEliteOnly: false,
        tags: item.tags || []
      }));
      await MenuItem.bulkCreate(menuItems);
    }
    console.log(`✅ Seeded Restaurant & Menu: ${restaurant.name}`);
  }

  // 3b. Seed CampusBites Local Vendors
  console.log('🏪 Seeding CampusBites Local Vendors...');
  const localVendors = [
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
      isOpenNow: true,
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
    },
    {
      name: 'Kerala Parotta Hub',
      location: 'Near Main Gate, Amrita Coimbatore',
      campus: 'AMRITA',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?q=80&w=400&auto=format&fit=crop',
      rating: 4.6,
      whatsappNumber: '919444555666',
      subscriptionTier: 'premium',
      stallDescription: 'Authentic Kerala parottas with spicy beef and chicken curries since 2015.',
      promoOffer: '🔥 Free Chai with Parotta Combo!',
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '17:00', end: '23:30' },
      lat: 10.9035, lon: 76.9003,
      tags: ['local', 'kerala', 'parotta', 'non-veg'],
      menu: [
        { name: 'Kerala Parotta (2pc)', price: 30, description: 'Flaky layered parotta served hot.', image: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?q=80&w=400', category: 'Parotta', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Chicken Curry', price: 90, description: 'Rich spicy chicken curry with coconut.', image: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?q=80&w=400', category: 'Curry', isVegetarian: false, tags: ['non-veg', 'local'] },
        { name: 'Egg Curry', price: 50, description: 'Boiled eggs in tangy masala gravy.', image: 'https://images.unsplash.com/photo-1574653853027-5382a3d23a15?q=80&w=400', category: 'Curry', isVegetarian: false, tags: ['egg', 'local'] },
        { name: 'Fish Fry', price: 120, description: 'Crispy fried fish with Kerala spices.', image: 'https://images.unsplash.com/photo-1580476262798-bddd9f4b7369?q=80&w=400', category: 'Fry', isVegetarian: false, tags: ['non-veg', 'local'] },
        { name: 'Veg Kothu Parotta', price: 70, description: 'Shredded parotta tossed with veggies and spices.', image: 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d4a?q=80&w=400', category: 'Parotta', isVegetarian: true, tags: ['veg', 'local'] },
      ]
    },
    {
      name: 'Amrita Chai Adda',
      location: 'Boys Hostel Gate, Amrita',
      campus: 'AMRITA',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?q=80&w=400&auto=format&fit=crop',
      rating: 4.3,
      whatsappNumber: '919333444555',
      subscriptionTier: 'free',
      stallDescription: 'Campus favourite for strong filter coffee and crispy snacks.',
      promoOffer: null,
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '06:00', end: '23:00' },
      lat: 10.9040, lon: 76.9010,
      tags: ['local', 'chai', 'coffee', 'snacks'],
      menu: [
        { name: 'Filter Coffee', price: 20, description: 'Strong South Indian filter coffee.', image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefda?q=80&w=400', category: 'Beverages', isVegetarian: true, tags: ['veg', 'local', 'drinks'] },
        { name: 'Masala Chai', price: 15, description: 'Spiced tea with cardamom and ginger.', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?q=80&w=400', category: 'Beverages', isVegetarian: true, tags: ['veg', 'local', 'drinks'] },
        { name: 'Samosa (2pc)', price: 25, description: 'Crispy potato samosas with mint chutney.', image: 'https://images.unsplash.com/photo-1601050690597-df056fb4ce78?q=80&w=400', category: 'Snacks', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Vada Pav', price: 30, description: 'Mumbai-style spicy potato fritter in bun.', image: 'https://images.unsplash.com/photo-1606491956689-2ea866880049?q=80&w=400', category: 'Snacks', isVegetarian: true, tags: ['veg', 'local'] },
      ]
    },
    {
      name: 'Noodle Box Express',
      location: 'Library Road, Amrita Campus',
      campus: 'AMRITA',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?q=80&w=400&auto=format&fit=crop',
      rating: 4.4,
      whatsappNumber: '919666777888',
      subscriptionTier: 'premium',
      stallDescription: 'Quick Indo-Chinese noodles and fried rice. Spicy Schezwan is our speciality!',
      promoOffer: '🍜 Extra Manchurian free on combos!',
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '11:00', end: '22:00' },
      lat: 10.9050, lon: 76.9020,
      tags: ['local', 'chinese', 'noodles'],
      menu: [
        { name: 'Schezwan Noodles', price: 70, description: 'Spicy stir-fried noodles with Schezwan sauce.', image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?q=80&w=400', category: 'Noodles', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Chicken Fried Rice', price: 90, description: 'Wok-tossed rice with chicken and vegetables.', image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?q=80&w=400', category: 'Rice', isVegetarian: false, tags: ['non-veg', 'local'] },
        { name: 'Gobi Manchurian', price: 80, description: 'Crispy cauliflower in tangy Manchurian sauce.', image: 'https://images.unsplash.com/photo-1645696996148-44c7c45f52b4?q=80&w=400', category: 'Starters', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Egg Fried Rice', price: 60, description: 'Light fried rice with scrambled egg.', image: 'https://images.unsplash.com/photo-1596560548464-f010549b84d7?q=80&w=400', category: 'Rice', isVegetarian: false, tags: ['egg', 'local'] },
        { name: 'Spring Rolls (4pc)', price: 50, description: 'Crispy veggie spring rolls with sweet chilli dip.', image: 'https://images.unsplash.com/photo-1548507200-b4c0dbc6c7d0?q=80&w=400', category: 'Starters', isVegetarian: true, tags: ['veg', 'local'] },
      ]
    },
    {
      name: 'Sundari Idli Kadai',
      location: 'Amrita Back Gate',
      campus: 'AMRITA',
      vendorType: 'LOCAL_VENDOR',
      imageUrl: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=400&auto=format&fit=crop',
      rating: 4.8,
      whatsappNumber: '919777888999',
      subscriptionTier: 'premium',
      stallDescription: 'Softest idlis in town with 5 varieties of chutney. Morning favourite!',
      promoOffer: '🌅 Early Bird: Free coffee before 8 AM',
      isOpenNow: true,
      isActive: true,
      operatingHours: { start: '05:30', end: '11:00' },
      lat: 10.9025, lon: 76.8995,
      tags: ['local', 'south-indian', 'breakfast', 'idli'],
      menu: [
        { name: 'Soft Idli (4pc)', price: 30, description: 'Steamed rice cakes with sambar and chutneys.', image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=400', category: 'Breakfast', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Mini Tiffin Combo', price: 60, description: '2 Idli + 1 Vada + Sambar + Filter Coffee.', image: 'https://images.unsplash.com/photo-1567337710282-00832b415979?q=80&w=400', category: 'Combos', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Ghee Pongal', price: 50, description: 'Creamy rice and lentil dish tempered with ghee.', image: 'https://images.unsplash.com/photo-1630383249896-424e482df921?q=80&w=400', category: 'Breakfast', isVegetarian: true, tags: ['veg', 'local'] },
        { name: 'Medu Vada (2pc)', price: 25, description: 'Crispy lentil doughnuts with coconut chutney.', image: 'https://images.unsplash.com/photo-1601050690597-df056fb4ce78?q=80&w=400', category: 'Breakfast', isVegetarian: true, tags: ['veg', 'local'] },
      ]
    }
  ];

  for (const restData of localVendors) {
    const restaurant = await Restaurant.create({
      name: restData.name,
      location: restData.location,
      campus: restData.campus,
      imageUrl: restData.imageUrl,
      vendorType: 'LOCAL_VENDOR',
      rating: restData.rating || 4.0,
      whatsappNumber: restData.whatsappNumber,
      subscriptionTier: restData.subscriptionTier || 'free',
      stallDescription: restData.stallDescription,
      promoOffer: restData.promoOffer,
      isOpenNow: restData.isOpenNow !== undefined ? restData.isOpenNow : true,
      isActive: true,
      operatingHours: restData.operatingHours,
      lat: restData.lat || 16.4632,
      lon: restData.lon || 80.5064,
      commissionRate: 15,
      password: 'password123',
      commissionType: 'percentage',
      tags: restData.tags || []
    });

    if (restData.menu && Array.isArray(restData.menu)) {
      const menuItems = restData.menu.map(item => ({
        restaurantId: restaurant.id,
        name: item.name,
        price: item.price,
        description: item.description,
        imageUrl: item.image || item.imageUrl,
        category: item.category,
        isVegetarian: item.isVegetarian !== undefined ? item.isVegetarian : true,
        isAvailable: true,
        isEliteOnly: false,
        tags: item.tags || []
      }));
      await MenuItem.bulkCreate(menuItems);
    }
    console.log(`✅ Seeded Local Vendor & Menu: ${restaurant.name}`);
  }

  // 3c. Seed Nexus Rentals
  console.log('🚲 Seeding Nexus Rentals...');
  const rentalVendor = {
    name: 'Nexus Rentals',
    location: 'SRM AP Central Hub',
    imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800',
    vendorType: 'RENTAL',
    commissionRate: 10,
    commissionType: 'percentage',
    operatingHours: { start: '06:00', end: '22:00' },
    isActive: true,
    tags: ['rentals', 'mobility'],
    rating: 4.8,
    lat: 16.4632,
    lon: 80.5064,
    password: 'password123'
  };

  const rentalItems = [
    {
      name: "Electric Scooter S1",
      price: 49,
      description: "Premium electric scooter for campus mobility. High-speed, long-range.",
      imageUrl: "https://images.unsplash.com/photo-1597075254133-7e4468f2372f?w=400",
      category: "Rentals",
      tags: ["rental", "electric", "eco"],
      isVegetarian: false,
      isAvailable: true,
      isEliteOnly: false
    },
    {
      name: "Mountain Cycle XR",
      price: 25,
      description: "Rugged mountain cycle for all terrains. 21-speed gears.",
      imageUrl: "https://images.unsplash.com/photo-1532298229144-0ee0c9e9ad58?w=400",
      category: "Rentals",
      tags: ["rental", "fitness", "manual"],
      isVegetarian: false,
      isAvailable: true,
      isEliteOnly: false
    }
  ];

  try {
    const restaurant = await Restaurant.create(rentalVendor);
    const menuItems = rentalItems.map(item => ({
      ...item,
      restaurantId: restaurant.id
    }));
    await MenuItem.bulkCreate(menuItems);
    console.log(`✅ Seeded Rental Vendor & Menu: ${restaurant.name}`);
  } catch (err) {
    console.error('❌ Error seeding Nexus Rentals:', err.message);
  }

  // 4. Seed Vault Items
  console.log('💎 Synchronizing Vault Items...');
  const vaultItems = [
    {
      name: 'Silver Origin Coffee',
      price: 149,
      originalPrice: 499,
      remainingCount: 5,
      imageUrl: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?q=80&w=800&auto=format&fit=crop',
      isActive: true,
      streakRequirement: 3
    },
    {
      name: 'Elite Cyber Membership',
      price: 199,
      originalPrice: 999,
      remainingCount: 2,
      imageUrl: 'https://images.unsplash.com/photo-1614064641938-3bbee52942c7?q=80&w=800&auto=format&fit=crop',
      isActive: true,
      streakRequirement: 7
    },
    {
      name: 'Gourmet Gold Pass',
      price: 599,
      originalPrice: 2499,
      remainingCount: 1,
      imageUrl: 'https://images.unsplash.com/photo-1511733351807-bb8ca564d490?q=80&w=800&auto=format&fit=crop',
      isActive: true,
      streakRequirement: 14
    }
  ];

  for (const v of vaultItems) {
    const [item, created] = await VaultItem.findOrCreate({
      where: { name: v.name },
      defaults: v
    });
    if (!created) {
      await item.update(v);
      console.log(`✅ Vault Item Updated: ${v.name}`);
    } else {
      console.log(`✅ Vault Item Created: ${v.name}`);
    }
  }

  // 5. Seed 4 detailed PGs & Rooms
  console.log('🏠 Seeding Detailed PG Hostels...');
  const PGHostel = getPGHostelModel();
  const PGRoom = getPGRoomModel();
  
  if (PGHostel && PGRoom) {
    try {
      // Clear old PG records
      await PGRoom.destroy({ where: {} });
      await PGHostel.destroy({ where: {} });

      const adminUser = await User.findOne({ where: { role: 'admin' } });
      const ownerId = adminUser ? adminUser.id : 'NexusAdminPlaceholder';

      const pgsData = [
        {
          name: 'Stanza Living Rome',
          address: 'SRM AP Sector 3, Near Academic Block',
          distanceFromCollege: 0.8,
          genderType: 'Boys',
          baseRent: 8500,
          amenities: ['High-speed Wi-Fi', '24/7 Power Backup', 'Professional Housekeeping', '3-Course Meals', 'Gym Access'],
          images: [
            'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?q=80&w=800',
            'https://images.unsplash.com/photo-1598928506311-c55ded91a206?q=80&w=800'
          ],
          description: 'Premium student housing with fully loaded amenities including high-speed Wi-Fi, laundry, gym, and 3-course delicious meals.',
          ownerId,
          rooms: [
            { roomNumber: '101', sharingType: 2, pricePerBed: 9500, totalBeds: 2, availableBeds: 2 },
            { roomNumber: '102', sharingType: 3, pricePerBed: 8500, totalBeds: 3, availableBeds: 3 }
          ]
        },
        {
          name: 'Olive Premium PG',
          address: 'Neerukonda Bypass Road, Amaravathi',
          distanceFromCollege: 1.2,
          genderType: 'Girls',
          baseRent: 9000,
          amenities: ['Card Access Security', 'Biometric Entry', 'Study Lounge', 'Indoor Games', 'Laundry Service'],
          images: [
            'https://images.unsplash.com/photo-1505691938895-1758d7feb511?q=80&w=800',
            'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=800'
          ],
          description: 'Safe & secure luxury accommodation for girls. Features card-access security, indoor games, study lounge, and housekeeping.',
          ownerId,
          rooms: [
            { roomNumber: '201', sharingType: 1, pricePerBed: 12000, totalBeds: 1, availableBeds: 1 },
            { roomNumber: '202', sharingType: 2, pricePerBed: 9000, totalBeds: 2, availableBeds: 2 }
          ]
        },
        {
          name: 'Zolo Scholar House',
          address: 'Inavolu Road, Amaravathi',
          distanceFromCollege: 1.8,
          genderType: 'Co-ed',
          baseRent: 6500,
          amenities: ['Community Zone', 'Xbox Lounge', 'Self Cooking Kitchen', 'High-speed Wi-Fi', 'Bicycle Parking'],
          images: [
            'https://images.unsplash.com/photo-1554995207-c18c203602cb?q=80&w=800',
            'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=800'
          ],
          description: 'Managed co-living space for modern students. Social community events, gaming zone, and workspace.',
          ownerId,
          rooms: [
            { roomNumber: '301', sharingType: 2, pricePerBed: 7500, totalBeds: 2, availableBeds: 1 },
            { roomNumber: '302', sharingType: 4, pricePerBed: 6500, totalBeds: 4, availableBeds: 4 }
          ]
        },
        {
          name: 'Nexus Elite PG',
          address: 'SRM AP Main Gate Road, Neerukonda',
          distanceFromCollege: 0.5,
          genderType: 'Co-ed',
          baseRent: 11000,
          amenities: ['Central Air Conditioning', 'Personal Pantry', 'Swimming Pool', 'Premium Cafeteria', 'On-demand Shuttle'],
          images: [
            'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?q=80&w=800',
            'https://images.unsplash.com/photo-1502005229762-fc1b2b812ca5?q=80&w=800'
          ],
          description: 'Ultra-luxury co-living right next to the campus. AC rooms, personal pantry, laundry, swimming pool, and premium cafeteria.',
          ownerId,
          rooms: [
            { roomNumber: '401', sharingType: 1, pricePerBed: 15000, totalBeds: 1, availableBeds: 1 },
            { roomNumber: '402', sharingType: 2, pricePerBed: 11000, totalBeds: 2, availableBeds: 2 }
          ]
        }
      ];

      for (const pgData of pgsData) {
        const { rooms, ...hostelData } = pgData;
        const hostel = await PGHostel.create(hostelData);
        const roomsToCreate = rooms.map(r => ({ ...r, hostelId: hostel.id }));
        await PGRoom.bulkCreate(roomsToCreate);
        console.log(`✅ Seeded PG & Rooms: ${hostel.name}`);
      }
    } catch (err) {
      console.error('❌ Error seeding PG Hostels:', err.message);
    }
  }

  try {
    await sequelize.query('PRAGMA foreign_keys = ON;');
  } catch (e) {}

  console.log('--- Seeding Complete ---');
};

module.exports = { unifiedSeed };

if (require.main === module) {
  unifiedSeed().catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
}
