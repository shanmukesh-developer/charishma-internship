const IMG = 'https://images.unsplash.com/photo-';
const W = '?w=600&h=400&fit=crop';

const RESTS = [
  { name:'Spice Garden', location:'Near Gate 2, Amaravathi', lat:16.515, lon:80.5164, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.5, deliveryTime:25, commissionRate:12, tags:['South Indian','Biryani'], imageUrl:IMG+'1517248135467-4c7edcad34c4'+W, password:'spice123' },
  { name:'Urban Bites', location:'Food Court, Block A', lat:16.5175, lon:80.519, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.7, deliveryTime:20, commissionRate:10, tags:['Burgers','Pizza'], imageUrl:IMG+'1552566626-98f62a5dd1b5'+W, password:'urban123' },
  { name:'Dragon Wok', location:'Main Road, Amaravathi', lat:16.513, lon:80.521, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.3, deliveryTime:30, commissionRate:15, tags:['Chinese','Noodles'], imageUrl:IMG+'1526234362653-3b75a0c07438'+W, password:'dragon123' },
  { name:'Chai & Chill', location:'Library Corner, Block C', lat:16.516, lon:80.518, zone:'Amaravathi_Central', vendorType:'CAFE', rating:4.8, deliveryTime:10, commissionRate:8, tags:['Tea','Coffee'], imageUrl:IMG+'1445116572660-236099ec97a0'+W, password:'chai123' },
  { name:'Tandoori Nights', location:'Hostel Road, Gate 1', lat:16.514, lon:80.5155, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.6, deliveryTime:35, commissionRate:12, tags:['Tandoori','Mughlai'], imageUrl:IMG+'1555396273-367ea4eb4db5'+W, password:'tandoori123' },
  { name:'Green Bowl', location:'Sports Complex, Block D', lat:16.5185, lon:80.52, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.4, deliveryTime:15, commissionRate:10, tags:['Healthy','Bowls'], imageUrl:IMG+'1512621776951-a57141f2eefd'+W, password:'green123' },
  { name:'Bombay Street', location:'Market Area, Amaravathi', lat:16.512, lon:80.517, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.2, deliveryTime:20, commissionRate:11, tags:['Street Food','Chaat'], imageUrl:IMG+'1601050690597-df0568f70950'+W, password:'bombay123' },
  { name:'Frozen Bliss', location:'Near Auditorium, Block B', lat:16.517, lon:80.5195, zone:'Amaravathi_Central', vendorType:'DESSERT', rating:4.9, deliveryTime:10, commissionRate:8, tags:['Ice Cream','Desserts'], imageUrl:IMG+'1501443762994-82bd5dace89a'+W, password:'frozen123' },
  { name:'Campus Pharmacy', location:'Admin Block, SRM AP', lat:16.516, lon:80.516, zone:'Amaravathi_Central', vendorType:'PHARMACY', rating:4.6, deliveryTime:8, commissionRate:5, tags:['pharmacy','medicine'], imageUrl:IMG+'1584308666744-24d55c2168ef'+W, password:'pharma123' },
  { name:'Fresh Mart', location:'Hostel Gate, Block E', lat:16.518, lon:80.517, zone:'Amaravathi_Central', vendorType:'GROCERY', rating:4.3, deliveryTime:12, commissionRate:6, tags:['fruits','grocery'], imageUrl:IMG+'1542838132-92c53300491e'+W, password:'fresh123' },
  { name:'SpinClean Laundry', location:'Block F Service Area', lat:16.515, lon:80.519, zone:'Amaravathi_Central', vendorType:'LAUNDRY', rating:4.5, deliveryTime:60, commissionRate:7, tags:['laundry','dry-wash'], imageUrl:IMG+'1582735689351-37b08f4c5f9c'+W, password:'spin123' },
  { name:'Campus Stationery Hub', location:'Near Library, Block A', lat:16.517, lon:80.515, zone:'Amaravathi_Central', vendorType:'STATIONARY', rating:4.4, deliveryTime:15, commissionRate:6, tags:['stationary','books','print'], imageUrl:IMG+'1497633762265-9d0213b5ec04'+W, password:'stat123' },
  { name:'Campus Rentals', location:'Parking Lot, Block B', lat:16.516, lon:80.518, zone:'Amaravathi_Central', vendorType:'RENTAL', rating:4.5, deliveryTime:20, commissionRate:8, tags:['rental'], imageUrl:IMG+'1558618666-fcd25c85cd64'+W, password:'rental123' },
];

// [name, price, description, category, isVeg, unsplashId, tags[]]
const MENUS = [
  // 🍛 BIRYANI (→ Spice Garden 0)
  ['Hyderabadi Chicken Biryani',249,'Fragrant basmati rice with tender chicken and saffron','Biryani',false,'1563379926898-05f4575a45d8',['Biryani','seasonal']],
  ['Paneer Tikka Biryani',219,'Basmati rice with grilled paneer and aromatic spices','Biryani',true,'1633945274405-b6c8069047b0',['Biryani']],
  ['Veg Dum Biryani',189,'Slow-cooked rice with seasonal vegetables','Biryani',true,'1544025162-d76694265947',['Biryani']],
  ['Kolkata Chicken Biryani',269,'Fragrant biryani with potato, egg and tender chicken','Biryani',false,'1626777552726-4a6b54c97e46',['Biryani']],

  // 🍕 PIZZA (→ Urban Bites 1)
  ['Margherita Pizza',249,'Wood-fired pizza with fresh mozzarella and basil','Pizza',true,'1574071318508-1cdbab80d002',['Pizza']],
  ['Peppy Paneer Pizza',279,'Paneer cubes with capsicum and paprika','Pizza',true,'1513104890138-7c749659a591',['Pizza']],
  ['Double Cheese Margherita',269,'Extra mozzarella on authentic marinara base','Pizza',true,'1604382354936-07c5d9983bd3',['Pizza','seasonal']],
  ['Spicy Chicken Pizza',299,'Grilled chicken with jalapenos and mozzarella','Pizza',false,'1590947132387-155cc02f3212',['Pizza']],

  // 🥗 SOUTH INDIAN (→ Spice Garden 0)
  ['Masala Dosa',89,'Crispy crepe with spiced potato filling and chutneys','South Indian',true,'1630383249896-424e482df921',['South Indian']],
  ['Idli Sambar (4pc)',79,'Steamed rice cakes with lentil sambar and chutney','South Indian',true,'1589301760014-d929f3979dbc',['South Indian']],
  ['Onion Uttapam',99,'Thick rice pancake with fresh onions and coriander','South Indian',true,'1668236543090-82eba5ee5976',['South Indian']],
  ['Medu Vada (3pc)',89,'Crispy lentil donuts with coconut chutney','South Indian',true,'1601050690117-94f5f6fa8bd7',['South Indian']],

  // 🍔 BURGERS (→ Urban Bites 1)
  ['Classic Smash Burger',199,'Double beef patty with cheddar and secret sauce','Burgers',false,'1568901346375-23c9450c58cd',['Burgers']],
  ['Paneer Tikka Burger',169,'Spiced paneer patty with mint mayo','Burgers',true,'1550547660-d9450f859349',['Burgers']],
  ['Crispy Chicken Burger',189,'Hand-breaded chicken breast with lettuce and mayo','Burgers',false,'1586816001966-5f0a0b0b5c6e',['Burgers']],
  ['Veg Whopper',159,'Plant-based patty with pickles and tomatoes','Burgers',true,'1562967560249-be0a4f07f9cf',['Burgers']],

  // 🥤 DRINKS (→ Chai & Chill 3 / Frozen Bliss 7)
  ['Filter Coffee',49,'Traditional South Indian filter coffee, hot and frothy','Drinks',true,'1509042239860-f550ce710b93',['drinks','Drinks']],
  ['Masala Chai',39,'Assam tea with cardamom, ginger and cinnamon','Drinks',true,'1556679343-c7306c1976bc',['drinks','Drinks']],
  ['Cold Coffee',89,'Chilled coffee blended with ice cream','Drinks',true,'1461023058943-07fcbe16d735',['drinks','Drinks']],
  ['Oreo Milkshake',129,'Thick shake with Oreo cookies and vanilla ice cream','Drinks',true,'1572490284235-7e7484d68b44',['drinks','Drinks']],
  ['Mango Lassi Special',89,'Alphonso mango blended into thick chilled lassi','Drinks',true,'1488477181946-4d72e913d553',['drinks','Drinks','seasonal']],
  ['Watermelon Cooler',59,'Fresh watermelon juice with mint and black salt','Drinks',true,'1535041919-4e427f31b612',['drinks','Drinks','seasonal']],
  ['Protein Shake',149,'Whey protein with banana, oats and almond milk','Drinks',true,'1553530666-ba11a7da3888',['drinks','Drinks','gym','high-protein']],
  ['Masala Soda',39,'Fizzy soda with lemon, spices and black salt','Drinks',true,'1554631879-9a0b3a7e0a65',['drinks','Drinks']],

  // 🍜 CHINESE (→ Dragon Wok 2)
  ['Hakka Noodles',159,'Stir-fried noodles with crunchy vegetables','Chinese',true,'1569718212165-3a8922ada9f3',['Chinese']],
  ['Chicken Manchurian',189,'Crispy chicken balls in tangy Manchurian sauce','Chinese',false,'1525755662160-7547c42c0c24',['Chinese']],
  ['Szechuan Paneer',169,'Crispy paneer in fiery Szechuan pepper sauce','Chinese',true,'1534422298391-e4f8c172dddb',['Chinese']],
  ['Veg Spring Rolls (6pc)',129,'Crispy rolls stuffed with cabbage and glass noodles','Chinese',true,'1515669097368-22e68427d265',['Chinese']],
  ['Dragon Fire Rice',179,'Spicy fried rice with chili oil and vegetables','Chinese',false,'1603133872878-684f208fb84b',['Chinese']],
  ['Hot & Sour Soup',99,'Chinese soup with mushrooms, tofu and chili vinegar','Chinese',true,'1547592166-23ac45744aec',['Chinese']],

  // 💪 GYM & PROTEIN (→ Green Bowl 5)
  ['Grilled Chicken Bowl',219,'Grilled chicken with brown rice and broccoli','Bowls',false,'1490645935335-4b67fc5c0de5',['gym','high-protein','Bowls']],
  ['Egg White Omelette',99,'4-egg white omelette with spinach and mushrooms','Breakfast',false,'1525351484163-7529414344d8',['gym','high-protein','Breakfast']],
  ['Tofu Stir Fry',169,'Pan-seared tofu with colorful veggies in soy glaze','Bowls',true,'1546069901-ba9af5f8ca40',['gym','high-protein','Bowls']],
  ['Quinoa Power Bowl',219,'Quinoa with roasted chickpeas, avocado and tahini','Bowls',true,'1512621776951-a57141f2eefd',['gym','high-protein','Bowls']],
  ['Peanut Butter Toast',89,'Whole wheat toast with peanut butter and banana slices','Breakfast',true,'1541519227354-08fa5d50c44d',['gym','high-protein','Breakfast']],

  // 🍰 SWEETS & DESSERTS (→ Frozen Bliss 7)
  ['Gulab Jamun (4pc)',99,'Soft milk dumplings in rose sugar syrup','Desserts',true,'1666190199099-db67a1a1e212',['sweets','Desserts']],
  ['Rasgulla (4pc)',89,'Spongy cottage cheese balls in sugar syrup','Desserts',true,'1587314984468-5c4f9a678a3e',['sweets','Desserts']],
  ['Kaju Katli (6pc)',149,'Premium cashew fudge with silver vark','Desserts',true,'1578985545062-9e0a92a10261',['sweets','Desserts']],
  ['Brownie Sundae',179,'Warm brownie with vanilla ice cream and chocolate','Desserts',true,'1564355808539-8abb72f7e3e5',['sweets','Desserts']],
  ['Strawberry Cheesecake',149,'Creamy cheesecake with strawberry compote','Desserts',true,'1565958011703-44f9829ba187',['sweets','Desserts']],
  ['Belgian Chocolate Scoop',99,'Rich Belgian dark chocolate ice cream','Ice Cream',true,'1488477304673-b2ec9e64591b',['sweets','Desserts']],
  ['Mango Sorbet',89,'Fresh Alphonso mango sorbet, dairy free','Ice Cream',true,'1501443762994-82bd5dace89a',['sweets','Desserts']],
  ['Fruit Waffle',139,'Belgian waffle with fresh fruits and maple syrup','Waffles',true,'1562376552-0d160a2f238d',['sweets','Desserts']],

  // 🌟 SEASON SPECIALS (→ various)
  ['Monsoon Kadhi Pakora',129,'Crispy pakoras in tangy gram flour kadhi','Seasonal',true,'1585937421612-70a008356fbe',['seasonal']],
  ['Winter Gajar Halwa',119,'Slow-cooked carrot pudding with ghee and dry fruits','Seasonal',true,'1504674900247-0877df9cc836',['seasonal','sweets']],
  ['Summer Aam Panna',49,'Raw mango cooler with cumin and mint','Seasonal',true,'1546173072-4e7b3da3e6d2',['seasonal','drinks']],
  ['Corn Bhel Special',79,'Monsoon special boiled corn chaat with spices','Seasonal',true,'1601050690117-94f5f6fa8bd7',['seasonal']],

  // 🍎 FRESH FRUITS (→ Fresh Mart 9)
  ['Mixed Fruit Bowl',89,'Seasonal mixed fruits: watermelon, grapes, papaya','Fruits',true,'1490474418585-ba9bad8fd0ea',['fruits']],
  ['Banana Bunch (6pc)',39,'Fresh ripe Cavendish bananas from local farms','Fruits',true,'1571771135-dbfb3761c08f',['fruits']],
  ['Watermelon Slice',49,'Chilled seedless watermelon cut and ready to eat','Fruits',true,'1587049352846-b452fe862888',['fruits']],
  ['Papaya Bowl',59,'Fresh papaya cubes with lime and chaat masala','Fruits',true,'1519996409144-56c88f33e667',['fruits']],
  ['Apple Box (4pc)',79,'Fresh Red Delicious apples from Himachal Pradesh','Fruits',true,'1568702846914-96b305d2aaeb',['fruits']],

  // 💊 PHARMACY (→ Campus Pharmacy 8)
  ['Paracetamol 500mg (10pc)',29,'Fast-relief fever and pain tablets','Medicine',true,'1584308666744-24d55c2168ef',['pharmacy','medicine']],
  ['Vitamin C Effervescent (10pc)',89,'Orange flavour Vitamin C 1000mg tablets','Supplement',true,'1471864190785-f26b28d47035',['pharmacy','medicine']],
  ['ORS Electrolyte Sachets (5pc)',49,'Oral rehydration salts for hydration and recovery','Medicine',true,'1559839734-2b71ea197ec2',['pharmacy','medicine']],
  ['Antiseptic Cream 30g',59,'Dettol antiseptic cream for cuts and wounds','Medicine',true,'1583947215259-0af27cab22c0',['pharmacy','medicine']],
  ['Digestion Relief Syrup 100ml',79,'Ayurvedic syrup for acidity and indigestion','Medicine',true,'1571019613454-1cb2f99b2d8b',['pharmacy','medicine']],

  // 🧺 LAUNDRY (→ SpinClean 10)
  ['Express Wash (1kg)',49,'Clothes washed and dried within 4 hours','Laundry',true,'1582735689351-37b08f4c5f9c',['laundry','dry-wash']],
  ['Dry Cleaning (per piece)',79,'Professional dry cleaning for delicate garments','Laundry',true,'1558618666-fcd25c85cd64',['laundry','dry-wash']],
  ['Iron & Fold (5 items)',59,'Clothes ironed and neatly folded same day','Laundry',true,'1523381210434-4ac3e85f1c31',['laundry','dry-wash']],
  ['Bulk Wash (3kg)',119,'Economy bulk wash for everyday campus clothes','Laundry',true,'1545173168-9f1cba56e78b',['laundry','dry-wash']],
  ['Shoe Cleaning (pair)',89,'Deep clean and polish for sneakers and formals','Laundry',true,'1542838132-92c53300491e',['laundry','dry-wash']],

  // 📚 STATIONARY (→ Campus Stationery Hub 11)
  ['A4 Print (per page)',2,'Black & white laser print on 80gsm A4 paper','Print',true,'1524578271613-d3b8b5e26fb4',['stationary','print']],
  ['Colour Print (per page)',8,'Vibrant colour print on premium gloss paper','Print',true,'1541961017774-22349e4a1262',['stationary','print']],
  ['Spiral Notebook 200pg',79,'Premium spiral binding notebook for campus notes','Stationary',true,'1455390582262-e6bf2f4b3d6c',['stationary','books']],
  ['Blue Pen Set (5pc)',39,'Smooth-flow ballpoint pens — exam essential kit','Stationary',true,'1471107191634-c93efea7bbba',['stationary']],
  ['Geometry Box',99,'Complete geometry set with compass and protractor','Stationary',true,'1596495578065-6e0763fa1178',['stationary']],
  ['Highlighter Pack (4 colours)',59,'Pastel highlighters for notes and revision','Stationary',true,'1585776583-0792eb2e2b37',['stationary']],

  // 🚲 CAMPUS RENTALS (→ Campus Rentals 12)
  ['Bicycle Rental (per day)',99,'Atlas 21-speed bicycle for campus commute','Rental',true,'1485965120184-e220f721d03e',['rental']],
  ['Electric Scooter (per hour)',149,'Zero-emission scooter for quick campus trips','Rental',true,'1569062019973-bc97e596bbce',['rental']],
  ['Umbrella Rental (per day)',19,'Heavy-duty monsoon umbrella rental','Rental',true,'1523362628745-0c100150b504',['rental']],
  ['Laptop Charger Rental (per day)',49,'Universal laptop charger compatible with all brands','Rental',true,'1496181133206-80ce9b88a853',['rental']],
  ['Power Bank Rental (per day)',39,'20000mAh fast-charge power bank rental','Rental',true,'1558618666-fcd25c85cd64',['rental']],
];

// Maps each item to a restaurant index
const MENU_MAP = [
  0,0,0,0,      // Biryani -> Spice Garden
  1,1,1,1,      // Pizza -> Urban Bites
  0,0,0,0,      // South Indian -> Spice Garden
  1,1,1,1,      // Burgers -> Urban Bites
  3,3,3,7,3,3,5,6, // Drinks -> Chai&Chill/Frozen Bliss/Green Bowl
  2,2,2,2,2,2,  // Chinese -> Dragon Wok
  5,5,5,5,5,    // Gym -> Green Bowl
  7,7,7,7,7,7,7,7, // Sweets -> Frozen Bliss
  6,7,3,6,      // Seasonal -> various
  9,9,9,9,9,    // Fruits -> Fresh Mart
  8,8,8,8,8,    // Pharmacy -> Campus Pharmacy
  10,10,10,10,10, // Laundry -> SpinClean
  11,11,11,11,11,11, // Stationary -> Campus Stationery
  12,12,12,12,12, // Rentals -> Campus Rentals
];

const USERS = [
  { name:'Arjun Reddy', phone:'9876543210', password:'student123', email:'arjun@srmap.edu.in', hostelBlock:'Block A', roomNumber:'204', walletBalance:350, streakCount:5, totalOrders:12, completedOrders:11, role:'student', zenPoints:240, isElite:true, address:'Block A, Room 204, SRM AP', city:'Amaravathi', dietaryPreference:'None', badges:['First Order','Streak Master'] },
  { name:'Priya Sharma', phone:'9876543211', password:'student123', email:'priya@srmap.edu.in', hostelBlock:'Block C', roomNumber:'112', walletBalance:150, streakCount:3, totalOrders:7, completedOrders:7, role:'student', zenPoints:140, isElite:false, address:'Block C, Room 112, SRM AP', city:'Amaravathi', dietaryPreference:'Veg', badges:['First Order','Veggie Lover'] },
  { name:'Rahul Kumar', phone:'9876543212', password:'student123', email:'rahul@srmap.edu.in', hostelBlock:'Block B', roomNumber:'308', walletBalance:500, streakCount:8, totalOrders:20, completedOrders:19, role:'student', zenPoints:400, isElite:true, address:'Block B, Room 308, SRM AP', city:'Amaravathi', dietaryPreference:'None', badges:['First Order','Elite Member'] },
  { name:'Admin Zenvy', phone:'9999999999', password:'admin123', email:'admin@zenvy.app', hostelBlock:null, roomNumber:null, walletBalance:0, streakCount:0, totalOrders:0, completedOrders:0, role:'admin', zenPoints:0, isElite:false, address:'Admin Office', city:'Amaravathi', dietaryPreference:'None', badges:[] },
];

const RIDERS = [
  { name:'Vikram Singh', phone:'8765432100', password:'rider123', vehicleType:'Bike', vehicleNumber:'AP-07-AB-1234', bio:'Fast and reliable. 2 years experience.', emergencyContact:'8765432199', isOnline:true, totalEarnings:15400, zenPoints:310, averageRating:4.8, totalRatings:45, isApproved:true, photoUrl:'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop' },
  { name:'Ravi Teja', phone:'8765432101', password:'rider123', vehicleType:'Scooter', vehicleNumber:'AP-07-CD-5678', bio:'Friendly rider, always on time!', emergencyContact:'8765432198', isOnline:true, totalEarnings:8200, zenPoints:180, averageRating:4.6, totalRatings:28, isApproved:true, photoUrl:'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&h=300&fit=crop' },
];

const VAULT = [
  { name:'Free Delivery Pass (3 Orders)', price:0, originalPrice:90, remainingCount:50, isActive:true, streakRequirement:3, imageUrl:IMG+'1556742049-0cfed4f6a45d'+W },
  { name:'₹50 Off Next Order', price:20, originalPrice:50, remainingCount:30, isActive:true, streakRequirement:5, imageUrl:IMG+'1556742111-a301076d9d18'+W },
  { name:'Exclusive Brownie Box', price:99, originalPrice:249, remainingCount:10, isActive:true, streakRequirement:7, imageUrl:IMG+'1551024506-0bccd828d307'+W },
];

const CONFIGS = [
  { key:'delivery_fee', value:30, description:'Global delivery fee in INR' },
  { key:'surge_multiplier', value:1.0, description:'Surge pricing multiplier' },
  { key:'min_order_value', value:49, description:'Minimum order value in INR' },
  { key:'campus_open', value:true, description:'Master campus delivery switch' },
  { key:'maintenance_mode', value:false, description:'Freeze all orders when true' },
];

const PG_HOSTELS = [
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
    rooms: [
      { roomNumber: '401', sharingType: 1, pricePerBed: 15000, totalBeds: 1, availableBeds: 1 },
      { roomNumber: '402', sharingType: 2, pricePerBed: 11000, totalBeds: 2, availableBeds: 2 }
    ]
  }
];

async function seedProduction(sequelize) {
  const { Restaurant, MenuItem, User, DeliveryPartner, VaultItem, GlobalConfig, Coupon, CommunityPost, PGHostel, PGRoom } = sequelize.models;

  console.log('🌱 [SEED] Non-destructive production seed starting...');
  // NO MORE destroy() calls — we use findOrCreate to preserve existing data

  const rests = [];
  for (const r of RESTS) {
    const [inst] = await Restaurant.findOrCreate({ where: { name: r.name }, defaults: r });
    rests.push(inst);
  }

  for (let i = 0; i < MENUS.length; i++) {
    const [n,p,d,cat,veg,img,tags] = MENUS[i];
    const ri = Math.min(MENU_MAP[i] ?? 0, rests.length - 1);
    await MenuItem.findOrCreate({
      where: { name: n, restaurantId: rests[ri].id },
      defaults: {
        restaurantId: rests[ri].id, name:n, price:p, description:d,
        category:cat, isVegetarian:veg, isAvailable:true,
        imageUrl: IMG+img+W, tags: tags||[cat], specs:{}
      }
    });
  }

  const users = [];
  for (const u of USERS) {
    const [inst] = await User.findOrCreate({ where:{ phone:u.phone }, defaults:u });
    users.push(inst);
  }
  for (const r of RIDERS) await DeliveryPartner.findOrCreate({ where:{ phone:r.phone }, defaults:r });
  for (const v of VAULT) await VaultItem.findOrCreate({ where: { name: v.name }, defaults: v });
  for (const c of CONFIGS) await GlobalConfig.findOrCreate({ where:{ key:c.key }, defaults:c });

  if (users.length >= 2) {
    await CommunityPost.findOrCreate({ where: { content: 'Brownie Sundae from Frozen Bliss is 🔥 must try!' }, defaults: { userId:users[0].id, userName:users[0].name, content:'Brownie Sundae from Frozen Bliss is 🔥 must try!', likes:14, expiresAt:new Date(Date.now()+48*3600000) }});
    await CommunityPost.findOrCreate({ where: { content: 'Green Bowl quinoa bowl = best healthy option on campus 💪' }, defaults: { userId:users[1].id, userName:users[1].name, content:'Green Bowl quinoa bowl = best healthy option on campus 💪', likes:9, expiresAt:new Date(Date.now()+48*3600000) }});
  }

  // ── Seed PG Hostels & Rooms ────────────────────────────────────
  if (PGHostel && PGRoom) {
    const adminUser = users.find(u => u.role === 'admin') || users[0];
    const ownerId = adminUser ? adminUser.id : null;

    for (const pgData of PG_HOSTELS) {
      const { rooms, ...hostelFields } = pgData;
      const [hostel] = await PGHostel.findOrCreate({
        where: { name: pgData.name },
        defaults: { ...hostelFields, ownerId }
      });
      for (const room of rooms) {
        await PGRoom.findOrCreate({
          where: { hostelId: hostel.id, roomNumber: room.roomNumber },
          defaults: { ...room, hostelId: hostel.id }
        });
      }
    }
    console.log(`🏠 [SEED] Seeded ${PG_HOSTELS.length} PG Hostels with rooms.`);
  }

  console.log(`✅ [SEED] Done! ${MENUS.length} items across ${RESTS.length} restaurants + ${PG_HOSTELS.length} PGs (non-destructive).`);
}

module.exports = { seedProduction };
