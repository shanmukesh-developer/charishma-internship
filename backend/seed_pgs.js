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
      address: 'Near SRM University Gate 1, Amaravathi, AP',
      distanceFromCollege: 0.5,
      genderType: 'Boys',
      baseRent: 7500,
      securityDeposit: 15000,
      totalRooms: 20,
      amenities: ['High-Speed WiFi', 'AC Rooms', 'Washing Machine', 'Daily Housekeeping', 'Power Backup', 'Gym', 'Common Lounge', 'CCTV Security'],
      images: [
        '/pg-images/pg_boys_exterior.png',
        '/pg-images/pg_common_lounge.png',
        '/pg-images/pg_mess_hall.png'
      ],
      messMenu: {
        Monday: { breakfast: 'Dosa & Chutney', lunch: 'Rice, Dal, Chicken Curry', dinner: 'Chapati, Paneer Masala' },
        Tuesday: { breakfast: 'Idli Vada with Sambar', lunch: 'Rice, Sambar, Egg Curry', dinner: 'Puri, Aloo Kurma' },
        Wednesday: { breakfast: 'Puri Sabji', lunch: 'Veg Pulav, Raita, Dal', dinner: 'Chapati, Gobi Manchurian' },
        Thursday: { breakfast: 'Uttapam & Podi', lunch: 'Rice, Rasam, Fish Fry', dinner: 'Chapati, Chicken Masala' },
        Friday: { breakfast: 'Aloo Paratha with Curd', lunch: 'Rice, Dal Makhani, Paneer', dinner: 'Jeera Rice, Egg Masala' },
        Saturday: { breakfast: 'Bread Omlette', lunch: 'Veg Biryani, Mirchi ka Salan', dinner: 'Puri, Chana Masala' },
        Sunday: { breakfast: 'Special Masala Dosa', lunch: 'Special Chicken Biryani / Paneer Biryani', dinner: 'Chapati, Mixed Veg' }
      },
      foodTimetable: {
        breakfast: '07:30 AM - 09:00 AM',
        lunch: '12:30 PM - 02:00 PM',
        dinner: '07:30 PM - 09:30 PM'
      },
      rules: [
        'No loud music after 10:00 PM to respect co-residents.',
        'Guests allowed inside common areas till 8:00 PM only.',
        'Strictly no smoking, drinking or substance abuse inside premises.',
        'Mess timings must be strictly adhered to.',
        'Keep room keys safe; loss of keys will incur ₹500 replacement fee.'
      ],
      contactInfo: {
        phone: '+91 9876543210',
        email: 'boyshostel@zenvy.com',
        ownerName: 'Mr. Rajesh Kumar',
        wardenName: 'Mr. Ramesh Shastry',
        emergencyContact: '+91 9876543219',
        lat: 16.5062, // SRM AP approximate lat
        lng: 80.5048  // SRM AP approximate lng
      },
      description: 'Luxury AC hostel specifically built for SRM students. Walkable distance from Gate 1 with top-notch security, a premium mess hall, gym facilities, and a cozy common lounge. Managed by professional caretakers.'
    },
    {
      ownerId: owner.id,
      name: 'Starlight Girls Residence',
      address: 'VIT AP Campus Road, Inavolu, Amaravathi, AP',
      distanceFromCollege: 1.2,
      genderType: 'Girls',
      baseRent: 8500,
      securityDeposit: 10000,
      totalRooms: 15,
      amenities: ['24/7 Security CCTV', 'Biometric Entry', 'Gym', 'Attached Washroom', 'Hot Water', 'Study Room', 'In-house Nurse', 'Laundry Facility'],
      images: [
        '/pg-images/pg_girls_exterior.png',
        '/pg-images/pg_common_lounge.png',
        '/pg-images/pg_mess_hall.png'
      ],
      messMenu: {
        Monday: { breakfast: 'Poha & Jalebi', lunch: 'Veg Biryani, Onion Raita', dinner: 'Chapati, Mixed Veg Kadhai' },
        Tuesday: { breakfast: 'Upma & Coconut Chutney', lunch: 'Rice, Rasam, Potato Fry', dinner: 'Fried Rice, Veg Manchurian' },
        Wednesday: { breakfast: 'Dosa & Sambar', lunch: 'Rice, Dal, Ladyfinger Fry', dinner: 'Chapati, Aloo Matar' },
        Thursday: { breakfast: 'Idli & Peanut Chutney', lunch: 'Rice, Sambar, Cabbage Sabji', dinner: 'Chapati, Paneer Butter Masala' },
        Friday: { breakfast: 'Methi Paratha', lunch: 'Jeera Rice, Dal Fry, Bhindi', dinner: 'Puri, Chana Masala' },
        Saturday: { breakfast: 'Bread, Butter & Jam', lunch: 'Egg Biryani / Veg Biryani', dinner: 'Noodles, Spring Roll' },
        Sunday: { breakfast: 'Special Dosa & Vada', lunch: 'Paneer Biryani, Gulab Jamun', dinner: 'Chapati, Dal Tadka' }
      },
      foodTimetable: {
        breakfast: '07:00 AM - 09:00 AM',
        lunch: '01:00 PM - 02:30 PM',
        dinner: '07:00 PM - 09:00 PM'
      },
      rules: [
        'Main gate closes strictly at 9:00 PM daily.',
        'Prior written warden permission required for night outs.',
        'Strictly no male guests allowed in student rooms.',
        'Washing machines can be used only on scheduled days.',
        'Silence hours must be maintained from 10:30 PM to 6:00 AM.'
      ],
      contactInfo: {
        phone: '+91 8765432109',
        email: 'starlight@zenvy.com',
        ownerName: 'Mrs. Kavitha Murthy',
        wardenName: 'Mrs. Kavitha Murthy',
        emergencyContact: '+91 8765432100',
        lat: 16.4950, // VIT AP approximate lat
        lng: 80.4980  // VIT AP approximate lng
      },
      description: 'Safe and secure residence exclusively for girls. Highly maintained with strict biometric access, healthy food prepared by professional chefs, in-house study rooms, and round-the-clock emergency support.'
    },
    {
      ownerId: owner.id,
      name: 'The Nest Co-Living',
      address: 'Neerukonda Junction, Mangalagiri, AP',
      distanceFromCollege: 2.5,
      genderType: 'Co-ed',
      baseRent: 6000,
      securityDeposit: 6000,
      totalRooms: 30,
      amenities: ['Common Lounge', 'Gaming Zone', 'Open Terrace', 'Vending Machine', 'Non-AC & AC options', 'Co-working desks', 'Community Kitchen', 'Smart TV Lounge'],
      images: [
        '/pg-images/pg_coliving_exterior.png',
        '/pg-images/pg_common_lounge.png',
        '/pg-images/pg_mess_hall.png'
      ],
      messMenu: {
        Monday: { breakfast: 'Aloo Paratha', lunch: 'Rajma Chawal, Salad', dinner: 'Noodles, Sweet Corn Soup' },
        Tuesday: { breakfast: 'Pancakes with Maple Syrup', lunch: 'Lemon Rice & Curd Rice', dinner: 'Chapati, Chicken Tikka / Paneer Tikka' },
        Wednesday: { breakfast: 'Macaroni & Cheese', lunch: 'Veg Pulav, Curd', dinner: 'Chapati, Aloo Dum' },
        Thursday: { breakfast: 'Poha', lunch: 'Rice, Dal, Egg Bhurji', dinner: 'Veg Schezwan Fried Rice' },
        Friday: { breakfast: 'Chole Bhature', lunch: 'Kadhi Chawal', dinner: 'Pasta, Garlic Bread' },
        Saturday: { breakfast: 'Sandwich & Coffee', lunch: 'South Indian Thali', dinner: 'Pizza night!' },
        Sunday: { breakfast: 'Fluffy Pancakes / Waffles', lunch: 'Chicken Biryani / Veg Biryani', dinner: 'Tandoori Roti, Dal Makhani' }
      },
      foodTimetable: {
        breakfast: '08:00 AM - 10:00 AM',
        lunch: '12:30 PM - 03:00 PM',
        dinner: '08:00 PM - 10:30 PM'
      },
      rules: [
        'Respect common areas and clean up after using community kitchen.',
        'Loud music/parties allowed only on Friday & Saturday nights with prior permission.',
        'Pets are welcome in common areas but must be leash-trained.',
        'Waste segregation is mandatory.',
        'Ensure all electric appliances are turned off when leaving common rooms.'
      ],
      contactInfo: {
        phone: '+91 7654321098',
        email: 'thenest@zenvy.com',
        ownerName: 'Mr. John D Souza',
        wardenName: 'Mr. John D Souza',
        emergencyContact: '+91 7654321099',
        lat: 16.4420, // Neerukonda approximate lat
        lng: 80.5360  // Neerukonda approximate lng
      },
      description: 'Modern co-living space designed for progressive students. Lots of community events, movie nights, a fully loaded gaming zone, co-working spaces, and a vibrant community kitchen culture.'
    },
    {
      ownerId: owner.id,
      name: 'Economy Stay (Budget PG)',
      address: 'Main Bazaar Road, Mangalagiri, AP',
      distanceFromCollege: 5.0,
      genderType: 'Boys',
      baseRent: 4000,
      securityDeposit: 4000,
      totalRooms: 10,
      amenities: ['Basic Bed & Mattress', 'Shared Washrooms', 'Drinking Water', 'Ceiling Fan', 'Study Table', 'Bicycle Parking'],
      images: [
        '/pg-images/pg_budget_exterior.png',
        '/pg-images/pg_mess_hall.png'
      ],
      messMenu: {
        Monday: { breakfast: 'Bread Jam', lunch: 'Rice, Dal, Pickle', dinner: 'Rice, Rasam, Curd' },
        Tuesday: { breakfast: 'Idli', lunch: 'Rice, Veg Curry', dinner: 'Rice, Curd, Papad' },
        Wednesday: { breakfast: 'Poha', lunch: 'Rice, Dal', dinner: 'Chapati, Aloo Sabji' },
        Thursday: { breakfast: 'Upma', lunch: 'Rice, Rasam', dinner: 'Rice, Egg Curry / Dal' },
        Friday: { breakfast: 'Bread Jam', lunch: 'Rice, Sambar', dinner: 'Rice, Curd' },
        Saturday: { breakfast: 'Idli', lunch: 'Jeera Rice, Dal Makhani', dinner: 'Chapati, Mix Veg' },
        Sunday: { breakfast: 'Puri Sabji', lunch: 'Veg Pulav', dinner: 'Rice, Rasam' }
      },
      foodTimetable: {
        breakfast: '07:30 AM - 08:30 AM',
        lunch: '01:00 PM - 02:00 PM',
        dinner: '07:30 PM - 08:30 PM'
      },
      rules: [
        'Rent must be paid by the 5th of every month strictly.',
        'Electricity bill will be split equally among room sharing partners.',
        'No guest overnight stays without warden permission.',
        'Maintain hygiene in shared washrooms.'
      ],
      contactInfo: {
        phone: '+91 6543210987',
        email: 'economystay@zenvy.com',
        ownerName: 'Mr. Siva Prasad',
        wardenName: 'Mr. Siva Prasad',
        emergencyContact: '+91 6543210980',
        lat: 16.4350, // Mangalagiri Bazaar approximate lat
        lng: 80.5640  // Mangalagiri Bazaar approximate lng
      },
      description: 'Affordable budget stay for students looking to save money. Clean rooms, daily home-cooked style basic meals, and essential amenities covered. Highly reliable boarding.'
    }
  ];

  for (const pgData of pgs) {
    const pg = await PGHostel.create(pgData);
    console.log(`[SEED_PG] Created PG: ${pg.name}`);

    // Create 3 types of rooms for each PG with rich attributes
    await PGRoom.bulkCreate([
      {
        hostelId: pg.id,
        roomNumber: '101',
        sharingType: 1, // Single
        pricePerBed: pg.baseRent + 3000,
        totalBeds: 1,
        availableBeds: 1,
        floorNumber: 1,
        hasAttachedBathroom: true,
        hasAC: true,
        hasBalcony: true,
        furnishing: 'Fully Furnished',
        images: ['/pg-images/room_single_ac.png']
      },
      {
        hostelId: pg.id,
        roomNumber: '102',
        sharingType: 2, // Double
        pricePerBed: pg.baseRent + 1000,
        totalBeds: 2,
        availableBeds: 1,
        floorNumber: 1,
        hasAttachedBathroom: true,
        hasAC: pg.name !== 'Economy Stay (Budget PG)', // No AC for budget PG
        hasBalcony: false,
        furnishing: 'Fully Furnished',
        images: ['/pg-images/room_double_sharing.png']
      },
      {
        hostelId: pg.id,
        roomNumber: '103',
        sharingType: 3, // Triple
        pricePerBed: pg.baseRent,
        totalBeds: 3,
        availableBeds: 3,
        floorNumber: 2,
        hasAttachedBathroom: pg.name !== 'Economy Stay (Budget PG)', // Budget PG has shared washrooms
        hasAC: false,
        hasBalcony: true,
        furnishing: 'Semi Furnished',
        images: ['/pg-images/room_triple_sharing.png']
      }
    ]);
    console.log(`[SEED_PG] Added rich rooms for ${pg.name}`);
  }

  console.log('[SEED_PG] Completed Successfully! 🎉');
  process.exit(0);
}

seedPGs().catch(console.error);
