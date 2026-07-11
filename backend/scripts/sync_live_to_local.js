const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { connectDB, getSequelize } = require('../config/db');
const { getRestaurantModel } = require('../models/Restaurant');
const { getMenuItemModel } = require('../models/MenuItem');
const { getPGHostelModel } = require('../models/PGHostel');
const { getPGRoomModel } = require('../models/PGRoom');

const LIVE_API = 'https://hostelbites-backend-jwmt.onrender.com';

async function sync() {
  console.log('🔄 Connecting to local SQLite database...');
  await connectDB();
  const sequelize = getSequelize();

  const Restaurant = getRestaurantModel();
  const MenuItem = getMenuItemModel();
  const PGHostel = getPGHostelModel();
  const PGRoom = getPGRoomModel();

  console.log(`📡 Fetching live data from ${LIVE_API}...`);

  // 1. Fetch Restaurants
  const restRes = await fetch(`${LIVE_API}/api/users/restaurants`);
  if (!restRes.ok) {
    throw new Error(`Failed to fetch live restaurants: ${await restRes.text()}`);
  }
  const liveRests = await restRes.json();
  console.log(`✅ Fetched ${liveRests.length} restaurants from live.`);

  // 2. Fetch Menu Items for each restaurant
  const allMenuItems = [];
  for (const r of liveRests) {
    console.log(`   └─ Fetching menu for: ${r.name}`);
    const menuRes = await fetch(`${LIVE_API}/api/restaurants/${r.id}/menu`);
    if (menuRes.ok) {
      const menu = await menuRes.json();
      menu.forEach(item => {
        allMenuItems.push({ ...item, restaurantId: r.id });
      });
    }
  }
  console.log(`✅ Fetched ${allMenuItems.length} menu items from live.`);

  // 3. Fetch PG Hostels
  const pgRes = await fetch(`${LIVE_API}/api/pg`);
  if (!pgRes.ok) {
    throw new Error(`Failed to fetch live PGs: ${await pgRes.text()}`);
  }
  const livePGsSummary = await pgRes.json();
  console.log(`✅ Fetched ${livePGsSummary.length} PGs from live. Fetching detailed rooms...`);

  // 4. Fetch details & rooms for each PG
  const detailedPGs = [];
  const allRooms = [];
  for (const pg of livePGsSummary) {
    console.log(`   └─ Fetching detailed rooms for: ${pg.name}`);
    const detailRes = await fetch(`${LIVE_API}/api/pg/${pg.id}`);
    if (detailRes.ok) {
      const detailedPg = await detailRes.json();
      detailedPGs.push(detailedPg);
      if (detailedPg.rooms && Array.isArray(detailedPg.rooms)) {
        detailedPg.rooms.forEach(r => {
          allRooms.push({ ...r, hostelId: detailedPg.id });
        });
      }
    }
  }
  console.log(`✅ Fetched details and ${allRooms.length} rooms for PG Hostels.`);

  // 5. Start Transaction / Sync to SQLite
  console.log('\n🧹 Clearing local SQLite database tables...');
  try {
    await sequelize.query('PRAGMA foreign_keys = OFF;');
  } catch (e) {}

  await MenuItem.destroy({ where: {} });
  await Restaurant.destroy({ where: {} });
  await PGRoom.destroy({ where: {} });
  await PGHostel.destroy({ where: {} });

  console.log('📥 Importing live data into local SQLite...');

  // Bulk create Restaurants
  for (const r of liveRests) {
    await Restaurant.create({
      id: r.id,
      name: r.name,
      location: r.location,
      imageUrl: r.imageUrl,
      vendorType: r.vendorType,
      commissionRate: r.commissionRate,
      commissionType: r.commissionType,
      operatingHours: r.operatingHours,
      isActive: r.isActive,
      tags: r.tags,
      brandTheme: r.brandTheme,
      rating: r.rating
    });
  }

  // Bulk create MenuItems
  for (const item of allMenuItems) {
    await MenuItem.create({
      id: item.id,
      restaurantId: item.restaurantId,
      name: item.name,
      price: item.price,
      description: item.description,
      category: item.category,
      isVegetarian: item.isVegetarian,
      isAvailable: item.isAvailable,
      imageUrl: item.imageUrl,
      tags: item.tags,
      specs: item.specs
    });
  }

  // Bulk create PG Hostels
  for (const pg of detailedPGs) {
    await PGHostel.create({
      id: pg.id,
      ownerId: pg.ownerId,
      name: pg.name,
      address: pg.address,
      distanceFromCollege: pg.distanceFromCollege,
      genderType: pg.genderType,
      baseRent: pg.baseRent,
      securityDeposit: pg.securityDeposit,
      description: pg.description,
      amenities: pg.amenities,
      images: pg.images,
      messMenu: pg.messMenu,
      foodTimetable: pg.foodTimetable,
      rules: pg.rules,
      contactInfo: pg.contactInfo,
      isActive: pg.isActive
    });
  }

  // Bulk create PGRooms
  for (const r of allRooms) {
    await PGRoom.create({
      id: r.id,
      hostelId: r.hostelId,
      roomNumber: r.roomNumber,
      sharingType: r.sharingType,
      pricePerBed: r.pricePerBed,
      totalBeds: r.totalBeds,
      availableBeds: r.availableBeds,
      floorNumber: r.floorNumber,
      hasAttachedBathroom: r.hasAttachedBathroom,
      hasAC: r.hasAC,
      hasBalcony: r.hasBalcony,
      furnishing: r.furnishing,
      isActive: r.isActive
    });
  }

  try {
    await sequelize.query('PRAGMA foreign_keys = ON;');
  } catch (e) {}

  console.log('\n🎉 Local database sync complete! Live data imported successfully.');
}

sync().catch(err => {
  console.error('❌ Sync failed:', err);
  process.exit(1);
});
