require('dotenv').config();
const { connectDB, getSequelize } = require('../config/db');

const IMG = 'https://images.unsplash.com/photo-';
const W = '?w=600&h=400&fit=crop';

const RESTS = [
  { name:'Spice Garden', location:'Near Gate 2, Amaravathi', lat:16.5150, lon:80.5164, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.5, deliveryTime:25, commissionRate:12, tags:['South Indian','Thali','Biryani'], imageUrl:IMG+'1517248135467-4c7edcad34c4'+W, password:'spice123' },
  { name:'Urban Bites', location:'Food Court, Block A', lat:16.5175, lon:80.5190, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.7, deliveryTime:20, commissionRate:10, tags:['Burgers','Pizza','Fast Food'], imageUrl:IMG+'1552566626-98f62a5dd1b5'+W, password:'urban123' },
  { name:'Dragon Wok', location:'Main Road, Amaravathi', lat:16.5130, lon:80.5210, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.3, deliveryTime:30, commissionRate:15, tags:['Chinese','Noodles','Manchurian'], imageUrl:IMG+'1526234362653-3b75a0c07438'+W, password:'dragon123' },
  { name:'Chai & Chill', location:'Library Corner, Block C', lat:16.5160, lon:80.5180, zone:'Amaravathi_Central', vendorType:'CAFE', rating:4.8, deliveryTime:10, commissionRate:8, tags:['Tea','Coffee','Snacks'], imageUrl:IMG+'1445116572660-236099ec97a0'+W, password:'chai123' },
  { name:'Tandoori Nights', location:'Hostel Road, Gate 1', lat:16.5140, lon:80.5155, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.6, deliveryTime:35, commissionRate:12, tags:['Tandoori','Mughlai','Kebabs'], imageUrl:IMG+'1555396273-367ea4eb4db5'+W, password:'tandoori123' },
  { name:'Green Bowl', location:'Sports Complex, Block D', lat:16.5185, lon:80.5200, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.4, deliveryTime:15, commissionRate:10, tags:['Healthy','Salads','Bowls','Vegan'], imageUrl:IMG+'1512621776951-a57141f2eefd'+W, password:'green123' },
  { name:'Bombay Street', location:'Market Area, Amaravathi', lat:16.5120, lon:80.5170, zone:'Amaravathi_Central', vendorType:'RESTAURANT', rating:4.2, deliveryTime:20, commissionRate:11, tags:['Street Food','Chaat','Pav Bhaji'], imageUrl:IMG+'1601050690597-df0568f70950'+W, password:'bombay123' },
  { name:'Frozen Bliss', location:'Near Auditorium, Block B', lat:16.5170, lon:80.5195, zone:'Amaravathi_Central', vendorType:'DESSERT', rating:4.9, deliveryTime:10, commissionRate:8, tags:['Ice Cream','Desserts','Shakes'], imageUrl:IMG+'1501443762994-82bd5dace89a'+W, password:'frozen123' },
];

const MENUS = [
  // Spice Garden (0)
  ['Hyderabadi Chicken Biryani',249,'Fragrant basmati rice layered with tender chicken pieces and aromatic spices','Biryani',false,'1563379926898-05f4575a45d8'],
  ['Paneer Butter Masala',199,'Rich creamy tomato gravy with soft cottage cheese cubes','Main Course',true,'1631452180519-c014fe39b1be'],
  ['Masala Dosa',89,'Crispy golden crepe filled with spiced potato filling served with chutneys','South Indian',true,'1630383249896-424e482df921'],
  ['Chicken 65',179,'Spicy deep-fried chicken marinated in red chili and ginger','Starters',false,'1610057099431-d73a1c9d2f2b'],
  ['Curd Rice',79,'Cooling yogurt rice tempered with mustard seeds and curry leaves','Rice',true,'1585937421612-70a008356fbe'],
  ['Gulab Jamun (4pc)',99,'Soft milk dumplings soaked in rose-flavored sugar syrup','Desserts',true,'1666190199099-db67a1a1e212'],
  ['Filter Coffee',49,'Traditional South Indian filter coffee served hot and frothy','Beverages',true,'1509042239860-f550ce710b93'],
  // Urban Bites (1)
  ['Classic Smash Burger',199,'Double beef patty with cheddar, pickles, and secret sauce','Burgers',false,'1568901346375-23c9450c58cd'],
  ['Margherita Pizza',249,'Wood-fired pizza with fresh mozzarella, basil, and San Marzano sauce','Pizza',true,'1574071318508-1cdbab80d002'],
  ['Loaded Fries',149,'Crispy fries topped with cheese sauce, jalapenos, and sour cream','Sides',true,'1573080496219-bb080dd43f0c'],
  ['Grilled Chicken Wrap',179,'Tender grilled chicken with lettuce, tomato in a flour tortilla','Wraps',false,'1626700051175-6818013e1d4f'],
  ['Oreo Milkshake',129,'Thick creamy shake blended with Oreo cookies and vanilla ice cream','Shakes',true,'1572490284235-7e7484d68b44'],
  ['Paneer Tikka Burger',169,'Spiced paneer patty with mint mayo and fresh veggies','Burgers',true,'1550547660-d9450f859349'],
  // Dragon Wok (2)
  ['Hakka Noodles',159,'Stir-fried noodles with crunchy vegetables and soy sauce','Noodles',true,'1569718212165-3a8922ada9f3'],
  ['Chicken Manchurian',189,'Crispy chicken balls tossed in tangy Manchurian sauce','Chinese',false,'1525755662160-7547c42c0c24'],
  ['Veg Spring Rolls (6pc)',129,'Crispy rolls stuffed with cabbage, carrots, and glass noodles','Starters',true,'1515669097368-22e68427d265'],
  ['Dragon Fire Rice',179,'Spicy fried rice with chili oil, egg, and mixed vegetables','Rice',false,'1603133872878-684f208fb84b'],
  ['Szechuan Paneer',169,'Crispy paneer cubes in fiery Szechuan pepper sauce','Chinese',true,'1534422298391-e4f8c172dddb'],
  ['Hot & Sour Soup',99,'Classic Chinese soup with mushrooms, tofu, and chili vinegar','Soups',true,'1547592166-23ac45744aec'],
  // Chai & Chill (3)
  ['Masala Chai',39,'Strong Assam tea brewed with cardamom, ginger, and cinnamon','Hot Drinks',true,'1556679343-c7306c1976bc'],
  ['Cold Coffee',89,'Chilled coffee blended with milk, ice cream, and chocolate syrup','Cold Drinks',true,'1461023058943-07fcbe16d735'],
  ['Vada Pav',49,'Mumbai-style spicy potato fritter in a soft bun with chutneys','Snacks',true,'1606491956689-2ea866880049'],
  ['Samosa (2pc)',39,'Crispy fried pastry filled with spiced potatoes and peas','Snacks',true,'1601050690117-94f5f6fa8bd7'],
  ['Bread Omelette',69,'Fluffy egg omelette with onions and chilies served with toast','Snacks',false,'1525351484163-7529414344d8'],
  ['Maggi Noodles',59,'Classic Maggi with extra veggies and butter','Snacks',true,'1612929633738-8fe44f7ec841'],
  ['Bun Maska',49,'Soft Irani bun slathered with creamy butter','Snacks',true,'1509440159-a0042afbc601'],
  // Tandoori Nights (4)
  ['Butter Chicken',229,'Tender tandoori chicken in rich buttery tomato cream sauce','Main Course',false,'1603894584373-5ac82b2ae7d3'],
  ['Mutton Rogan Josh',279,'Slow-cooked lamb in aromatic Kashmiri spices','Main Course',false,'1574484284002-952d92456975'],
  ['Dal Makhani',159,'Creamy black lentils slow-cooked overnight with butter','Main Course',true,'1546833999-02c63c23cdcf'],
  ['Garlic Naan',49,'Soft tandoor-baked bread topped with garlic and butter','Breads',true,'1565557623262-b51c2513a641'],
  ['Tandoori Chicken Half',199,'Half chicken marinated in yogurt and spices, chargrilled','Tandoori',false,'1599487488170-d11ec9c172f0'],
  ['Paneer Tikka',179,'Cubes of paneer marinated and grilled in tandoor','Starters',true,'1567188040759-fb8a883dc6d8'],
  ['Lassi Sweet',69,'Chilled yogurt drink blended with sugar and cardamom','Beverages',true,'1488477181946-4d72e913d553'],
  // Green Bowl (5)
  ['Quinoa Power Bowl',219,'Quinoa with roasted chickpeas, avocado, and tahini dressing','Bowls',true,'1512621776951-a57141f2eefd'],
  ['Acai Smoothie Bowl',199,'Blended acai berries topped with granola, banana, and seeds','Bowls',true,'1590301157890-4810ed352733'],
  ['Grilled Veggie Wrap',159,'Roasted vegetables with hummus in a whole wheat wrap','Wraps',true,'1626700051175-6818013e1d4f'],
  ['Caesar Salad',179,'Romaine lettuce with parmesan, croutons, and Caesar dressing','Salads',true,'1550304943-4f24f54ddde9'],
  ['Protein Shake',149,'Whey protein blended with banana, oats, and almond milk','Drinks',true,'1553530666-ba11a7da3888'],
  ['Avocado Toast',139,'Sourdough toast with smashed avocado, cherry tomatoes, seeds','Breakfast',true,'1541519227354-08fa5d50c44d'],
  // Bombay Street (6)
  ['Pav Bhaji',99,'Spicy mashed vegetable curry with buttered soft pav','Street Food',true,'1606491956689-2ea866880049'],
  ['Pani Puri (8pc)',59,'Crispy hollow puris filled with spicy tangy water','Chaat',true,'1601050690117-94f5f6fa8bd7'],
  ['Vada Pav Special',69,'Double vada with garlic chutney and fried green chili','Street Food',true,'1606491956689-2ea866880049'],
  ['Bhel Puri',49,'Puffed rice mixed with chutneys, onions, and sev','Chaat',true,'1565557623262-b51c2513a641'],
  ['Misal Pav',89,'Spicy sprouted moth beans curry with crunchy farsan','Street Food',true,'1585937421612-70a008356fbe'],
  ['Ragda Pattice',79,'Crispy potato patties topped with white peas curry','Chaat',true,'1601050690597-df0568f70950'],
  ['Masala Soda',39,'Fizzy soda with lemon, spices, and black salt','Drinks',true,'1556679343-c7306c1976bc'],
  // Frozen Bliss (7)
  ['Belgian Chocolate Scoop',99,'Rich Belgian dark chocolate ice cream','Ice Cream',true,'1563805042-7684c019e1cb'],
  ['Mango Sorbet',89,'Fresh Alphonso mango sorbet, dairy free','Ice Cream',true,'1501443762994-82bd5dace89a'],
  ['Cookie Dough Shake',159,'Vanilla shake with cookie dough chunks and whipped cream','Shakes',true,'1572490284235-7e7484d68b44'],
  ['Brownie Sundae',179,'Warm fudge brownie with vanilla ice cream and hot chocolate','Desserts',true,'1551024506-0bccd828d307'],
  ['Strawberry Cheesecake',149,'Creamy baked cheesecake with strawberry compote','Desserts',true,'1565958011703-44f9829ba187'],
  ['Fruit Waffle',139,'Belgian waffle with fresh fruits, ice cream, and maple syrup','Waffles',true,'1562376552-0d160a2f238d'],
];

// Map menu items to restaurant index
const MENU_MAP = [0,0,0,0,0,0,0, 1,1,1,1,1,1, 2,2,2,2,2,2, 3,3,3,3,3,3,3, 4,4,4,4,4,4,4, 5,5,5,5,5,5, 6,6,6,6,6,6,6, 7,7,7,7,7,7];

const USERS = [
  { name:'Arjun Reddy', phone:'9876543210', password:'student123', email:'arjun@srmap.edu.in', hostelBlock:'Block A', roomNumber:'204', walletBalance:350, streakCount:5, totalOrders:12, completedOrders:11, role:'student', zenPoints:240, isElite:true, address:'Block A, Room 204, SRM AP', city:'Amaravathi', dietaryPreference:'None', badges:['First Order','Streak Master','Night Owl'] },
  { name:'Priya Sharma', phone:'9876543211', password:'student123', email:'priya@srmap.edu.in', hostelBlock:'Block C', roomNumber:'112', walletBalance:150, streakCount:3, totalOrders:7, completedOrders:7, role:'student', zenPoints:140, isElite:false, address:'Block C, Room 112, SRM AP', city:'Amaravathi', dietaryPreference:'Veg', badges:['First Order','Veggie Lover'] },
  { name:'Rahul Kumar', phone:'9876543212', password:'student123', email:'rahul@srmap.edu.in', hostelBlock:'Block B', roomNumber:'308', walletBalance:500, streakCount:8, totalOrders:20, completedOrders:19, role:'student', zenPoints:400, isElite:true, address:'Block B, Room 308, SRM AP', city:'Amaravathi', dietaryPreference:'None', badges:['First Order','Streak Master','Elite Member','Big Spender'] },
  { name:'Sneha Patel', phone:'9876543213', password:'student123', email:'sneha@srmap.edu.in', hostelBlock:'Block D', roomNumber:'415', walletBalance:75, streakCount:1, totalOrders:3, completedOrders:3, role:'student', zenPoints:60, isElite:false, address:'Block D, Room 415, SRM AP', city:'Amaravathi', dietaryPreference:'Jain', badges:['First Order'] },
  { name:'Admin Zenvy', phone:'9999999999', password:'admin123', email:'admin@zenvy.app', hostelBlock:null, roomNumber:null, walletBalance:0, streakCount:0, totalOrders:0, completedOrders:0, role:'admin', zenPoints:0, isElite:false, address:'Admin Office', city:'Amaravathi', dietaryPreference:'None', badges:[] },
];

const RIDERS = [
  { name:'Vikram Singh', phone:'8765432100', password:'rider123', vehicleType:'Bike', vehicleNumber:'AP-07-AB-1234', bio:'Fast and reliable delivery partner. 2 years experience.', emergencyContact:'8765432199', isOnline:true, totalEarnings:15400, zenPoints:310, averageRating:4.8, totalRatings:45, isApproved:true, photoUrl:IMG+'1507003211169-0a1dd7228f2d'+W },
  { name:'Ravi Teja', phone:'8765432101', password:'rider123', vehicleType:'Scooter', vehicleNumber:'AP-07-CD-5678', bio:'Friendly rider, always on time!', emergencyContact:'8765432198', isOnline:true, totalEarnings:8200, zenPoints:180, averageRating:4.6, totalRatings:28, isApproved:true, photoUrl:IMG+'1500648767791-00dcc994a43e'+W },
  { name:'Suresh Babu', phone:'8765432102', password:'rider123', vehicleType:'Bicycle', vehicleNumber:'N/A', bio:'Eco-friendly campus deliveries by cycle.', emergencyContact:'8765432197', isOnline:false, totalEarnings:3100, zenPoints:90, averageRating:4.4, totalRatings:12, isApproved:true, photoUrl:IMG+'1472099645785-5658abf4ff4e'+W },
];

const VAULT = [
  { name:'Free Delivery Pass (3 Orders)', price:0, originalPrice:90, remainingCount:50, isActive:true, streakRequirement:3, imageUrl:IMG+'1556742049-0cfed4f6a45d'+W },
  { name:'₹50 Off Next Order', price:20, originalPrice:50, remainingCount:30, isActive:true, streakRequirement:5, imageUrl:IMG+'1556742111-a301076d9d18'+W },
  { name:'Exclusive Brownie Box', price:99, originalPrice:249, remainingCount:10, isActive:true, streakRequirement:7, imageUrl:IMG+'1551024506-0bccd828d307'+W },
  { name:'Mystery Snack Box', price:49, originalPrice:199, remainingCount:20, isActive:true, streakRequirement:2, imageUrl:IMG+'1504674900247-0877df9cc836'+W },
];

const CONFIGS = [
  { key:'delivery_fee', value:30, description:'Global delivery fee in INR' },
  { key:'surge_multiplier', value:1.0, description:'Surge pricing multiplier' },
  { key:'min_order_value', value:49, description:'Minimum order value in INR' },
  { key:'delivery_shifts', value:['13:00','19:30'], description:'Active delivery slot timings' },
  { key:'pulse_enabled', value:true, description:'Enable community pulse notifications' },
  { key:'campus_open', value:true, description:'Master campus delivery switch' },
  { key:'maintenance_mode', value:false, description:'Freeze all orders when true' },
];

async function seed() {
  console.log('🌱 Starting full database seed...');
  await connectDB();
  const sq = getSequelize();
  const { Restaurant, MenuItem, User, DeliveryPartner, VaultItem, GlobalConfig, Coupon, CommunityPost } = sq.models;

  // Clear existing data
  console.log('🗑️  Clearing existing data...');
  await MenuItem.destroy({ where: {}, force: true });
  await Coupon.destroy({ where: {}, force: true });
  await CommunityPost.destroy({ where: {}, force: true });
  await VaultItem.destroy({ where: {}, force: true });
  await GlobalConfig.destroy({ where: {}, force: true });

  // Restaurants
  console.log('🏪 Seeding 8 restaurants...');
  const rests = [];
  for (const r of RESTS) {
    const [inst] = await Restaurant.findOrCreate({ where: { name: r.name }, defaults: r });
    rests.push(inst);
    console.log(`   ✅ ${inst.name}`);
  }

  // Menu Items (50+)
  console.log('🍽️  Seeding 50+ menu items...');
  let count = 0;
  for (let i = 0; i < MENUS.length; i++) {
    const [n,p,d,cat,veg,img] = MENUS[i];
    const ri = MENU_MAP[i];
    await MenuItem.findOrCreate({
      where: { name: n, restaurantId: rests[ri].id },
      defaults: {
        restaurantId: rests[ri].id, name:n, price:p, description:d,
        category:cat, isVegetarian:veg, isAvailable:true,
        imageUrl: IMG+img+W, tags:[cat], specs:{}
      }
    });
    count++;
  }
  console.log(`   ✅ ${count} menu items seeded`);

  // Users
  console.log('👥 Seeding 5 users...');
  const users = [];
  for (const u of USERS) {
    const [inst] = await User.findOrCreate({ where: { phone: u.phone }, defaults: u });
    users.push(inst);
    console.log(`   ✅ ${inst.name} (${inst.role})`);
  }

  // Delivery Partners
  console.log('🛵 Seeding 3 delivery riders...');
  for (const r of RIDERS) {
    const [inst] = await DeliveryPartner.findOrCreate({ where: { phone: r.phone }, defaults: r });
    console.log(`   ✅ ${inst.name} — ${inst.vehicleType}`);
  }

  // Vault Items
  console.log('🎁 Seeding vault rewards...');
  for (const v of VAULT) {
    await VaultItem.create(v);
    console.log(`   ✅ ${v.name}`);
  }

  // Global Config
  console.log('⚙️  Seeding global config...');
  for (const c of CONFIGS) {
    await GlobalConfig.findOrCreate({ where: { key: c.key }, defaults: c });
  }

  // Coupons
  console.log('🎟️  Seeding coupons...');
  const codes = ['ZENVY10','FREEDEL','NEWUSER','ELITEONLY','STREAK5'];
  for (let i = 0; i < codes.length; i++) {
    await Coupon.findOrCreate({
      where: { code: codes[i] },
      defaults: { code:codes[i], type: i%2===0?'DISCOUNT':'FREEDEL', value: i%2===0?10:0, userId: users[i % users.length].id, isUsed:false, expiryDate: new Date(Date.now() + 30*86400000) }
    });
  }

  // Community Posts
  console.log('💬 Seeding community posts...');
  const posts = [
    'Just tried the new Brownie Sundae from Frozen Bliss — absolutely divine! 🍫',
    'Anyone else craving Biryani at 2 AM? 😂 Spice Garden please open late night!',
    'Green Bowl quinoa power bowl is the best healthy option on campus 💪',
    'Pro tip: Order from Chai & Chill during 4-5 PM, zero wait time ☕',
    'The Tandoori Chicken from Tandoori Nights is unmatched. 10/10 recommend 🔥',
  ];
  for (let i = 0; i < posts.length; i++) {
    await CommunityPost.create({
      userId: users[i % users.length].id,
      userName: users[i % users.length].name,
      content: posts[i],
      likes: Math.floor(Math.random()*20),
      expiresAt: new Date(Date.now() + 48*3600000)
    });
  }

  console.log('\n🎉 SEED COMPLETE!');
  console.log(`   📊 ${rests.length} restaurants`);
  console.log(`   🍽️  ${count} menu items`);
  console.log(`   👥 ${users.length} users`);
  console.log(`   🛵 ${RIDERS.length} delivery riders`);
  console.log(`   🎁 ${VAULT.length} vault items`);
  console.log(`   ⚙️  ${CONFIGS.length} config entries`);
  console.log(`   🎟️  ${codes.length} coupons`);
  console.log(`   💬 ${posts.length} community posts`);
  console.log(`\n   TOTAL: ${rests.length + count + users.length + RIDERS.length + VAULT.length + CONFIGS.length + codes.length + posts.length}+ records\n`);
  process.exit(0);
}

seed().catch(err => { console.error('❌ Seed failed:', err); process.exit(1); });
