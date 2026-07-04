require('dotenv').config();
const { connectDB, getSequelize } = require('./config/db');

async function seedPGs() {
  console.log('[SEED_PG] Starting seed process...');
  await connectDB();
  const sequelize = getSequelize();
  
  const User = sequelize.models.User;
  const PGHostel = sequelize.models.PGHostel;
  const PGRoom = sequelize.models.PGRoom;
  
  if (!PGHostel || !PGRoom) {
    console.error('PG models not initialized!');
    process.exit(1);
  }

  // Find or create an owner user
  let owner = await User.findOne({ where: { role: 'admin' } });
  if (!owner) {
    owner = await User.findOne();
  }
  if (!owner) {
    owner = await User.create({
      name: 'PG Admin',
      email: 'pgadmin@zenvy.com',
      phone: '9999999999',
      role: 'admin'
    });
  }

  console.log(`[SEED_PG] Using Owner ID: ${owner.id}`);

  // Clear existing PGs and recreate schema to avoid SQLite ALTER TABLE errors
  await PGRoom.drop();
  await PGHostel.drop();
  await PGHostel.sync({ force: true });
  await PGRoom.sync({ force: true });
  console.log('[SEED_PG] Cleared and recreated PG schema');

  const pgs = [
    {
      ownerId: owner.id,
      name: 'Zenvy Premium Boys Hostel',
      address: 'Near SRM University Gate 1, Amaravathi',
      distanceFromCollege: 0.5,
      genderType: 'Boys',
      baseRent: 7500,
      securityDeposit: 15000,
      totalRooms: 20,
      amenities: ['High-Speed WiFi', 'AC Rooms', 'Washing Machine', 'Daily Housekeeping', 'Power Backup'],
      images: [
        'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'
      ],
      messMenu: {
        Monday: { breakfast: 'Dosa & Chutney', lunch: 'Rice, Dal, Chicken Curry', dinner: 'Chapati, Paneer Masala' },
        Tuesday: { breakfast: 'Idli Vada', lunch: 'Rice, Sambar, Egg Curry', dinner: 'Puri, Aloo Kurma' },
      },
      foodTimetable: {
        breakfast: '07:30 AM - 09:00 AM',
        lunch: '12:30 PM - 02:00 PM',
        dinner: '07:30 PM - 09:30 PM'
      },
      rules: ['No loud music after 10 PM', 'Guests allowed till 8 PM only', 'No smoking/drinking inside premises'],
      contactInfo: { phone: '+91 9876543210', warden: 'Mr. Ramesh' },
      description: 'Luxury AC hostel specifically built for SRM students. Walkable distance from Gate 1 with top-notch security.'
    },
    {
      ownerId: owner.id,
      name: 'Starlight Girls Residence',
      address: 'VIT AP Campus Road, Inavolu',
      distanceFromCollege: 1.2,
      genderType: 'Girls',
      baseRent: 8500,
      securityDeposit: 10000,
      totalRooms: 15,
      amenities: ['24/7 Security CCTV', 'Biometric Entry', 'Gym', 'Attached Washroom', 'Hot Water'],
      images: [
        'https://images.unsplash.com/photo-1513694203232-719a280e022f?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1505691938895-1758d7feb511?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'
      ],
      messMenu: {
        Monday: { breakfast: 'Poha', lunch: 'Veg Biryani, Raita', dinner: 'Chapati, Mixed Veg' },
        Tuesday: { breakfast: 'Upma', lunch: 'Rice, Rasam, Fry', dinner: 'Fried Rice, Manchurian' },
      },
      foodTimetable: {
        breakfast: '07:00 AM - 09:00 AM',
        lunch: '01:00 PM - 02:30 PM',
        dinner: '07:00 PM - 09:00 PM'
      },
      rules: ['Gate closes strictly at 9 PM', 'Prior permission required for night outs', 'No male guests allowed in rooms'],
      contactInfo: { phone: '+91 8765432109', warden: 'Mrs. Kavitha' },
      description: 'Safe and secure residence exclusively for girls. Highly maintained with strict biometric access and healthy food.'
    },
    {
      ownerId: owner.id,
      name: 'The Nest Co-Living',
      address: 'Neerukonda Junction, Mangalagiri',
      distanceFromCollege: 2.5,
      genderType: 'Co-ed',
      baseRent: 6000,
      securityDeposit: 6000,
      totalRooms: 30,
      amenities: ['Common Lounge', 'Gaming Zone', 'Open Terrace', 'Vending Machine', 'Non-AC & AC options'],
      images: [
        'https://images.unsplash.com/photo-1502672260266-1c1c24240938?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1582582621959-48d27397dc69?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'
      ],
      messMenu: {
        Monday: { breakfast: 'Aloo Paratha', lunch: 'Rajma Chawal', dinner: 'Noodles, Soup' },
        Tuesday: { breakfast: 'Pancakes', lunch: 'Lemon Rice', dinner: 'Chapati, Chicken/Paneer Tikka' },
      },
      foodTimetable: {
        breakfast: '08:00 AM - 10:00 AM',
        lunch: '12:30 PM - 03:00 PM',
        dinner: '08:00 PM - 10:30 PM'
      },
      rules: ['Respect common areas', 'Clean up after using kitchen appliances'],
      contactInfo: { phone: '+91 7654321098', warden: 'Mr. John' },
      description: 'Modern co-living space designed for progressive students. Lots of community events, movie nights, and a vibrant culture.'
    },
    {
      ownerId: owner.id,
      name: 'Economy Stay (Budget PG)',
      address: 'Main Bazaar Road, Mangalagiri',
      distanceFromCollege: 5.0,
      genderType: 'Boys',
      baseRent: 4000,
      securityDeposit: 4000,
      totalRooms: 10,
      amenities: ['Basic Bed & Mattress', 'Shared Washrooms', 'Drinking Water', 'Ceiling Fan'],
      images: [
        'https://images.unsplash.com/photo-1497366216548-37526070297c?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'
      ],
      messMenu: {
        Monday: { breakfast: 'Bread Jam', lunch: 'Rice, Dal', dinner: 'Rice, Rasam' },
        Tuesday: { breakfast: 'Idli', lunch: 'Rice, Curry', dinner: 'Rice, Curd' },
      },
      foodTimetable: {
        breakfast: '07:30 AM - 08:30 AM',
        lunch: '01:00 PM - 02:00 PM',
        dinner: '07:30 PM - 08:30 PM'
      },
      rules: ['Rent to be paid by 5th of every month', 'Electricity bill split equally'],
      contactInfo: { phone: '+91 6543210987', warden: 'Mr. Siva' },
      description: 'Affordable budget stay for students looking to save money. Basic amenities covered.'
    }
  ];

  for (const pgData of pgs) {
    const pg = await PGHostel.create(pgData);
    console.log(`[SEED_PG] Created PG: ${pg.name}`);

    // Create 3 types of rooms for each PG
    await PGRoom.bulkCreate([
      {
        hostelId: pg.id,
        roomNumber: '101',
        sharingType: 1, // Single
        pricePerBed: pg.baseRent + 3000,
        totalBeds: 1,
        availableBeds: 1,
      },
      {
        hostelId: pg.id,
        roomNumber: '102',
        sharingType: 2, // Double
        pricePerBed: pg.baseRent + 1000,
        totalBeds: 2,
        availableBeds: 1, // 1 bed already booked
      },
      {
        hostelId: pg.id,
        roomNumber: '103',
        sharingType: 3, // Triple
        pricePerBed: pg.baseRent,
        totalBeds: 3,
        availableBeds: 3,
      }
    ]);
    console.log(`[SEED_PG] Added rooms for ${pg.name}`);
  }

  console.log('[SEED_PG] Completed Successfully! 🎉');
  process.exit(0);
}

seedPGs().catch(console.error);
