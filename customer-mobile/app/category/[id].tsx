import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Dimensions, Platform, Alert, FlatList, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { useCart } from '../../context/CartContext';
import { API_URL } from '../../constants/api';

const { width: SW } = Dimensions.get('window');

const MOCK_DATA: Record<string, any[]> = {
  stationary: [
    { id: 'stat-1', name: 'Premium Notebook Set', price: 150, image: 'https://images.unsplash.com/photo-1531346878377-a5447cb02621?q=80&w=600&auto=format&fit=crop', desc: 'Set of 3 spiral notebooks, 200 pages' },
    { id: 'stat-2', name: 'Color Pens Pack', price: 80, image: 'https://images.unsplash.com/photo-1585040316886-4f51e0417935?q=80&w=600&auto=format&fit=crop', desc: '12 vibrant colors for sketching' },
    { id: 'stat-3', name: 'A4 Print Service (B&W)', price: 2, image: 'https://images.unsplash.com/photo-1593640408182-31c70c8268f5?q=80&w=600&auto=format&fit=crop', desc: 'Per page high quality laser print' },
    { id: 'stat-4', name: 'Scientific Calculator', price: 850, image: 'https://images.unsplash.com/photo-1594980596870-8caa52a79d00?q=80&w=600&auto=format&fit=crop', desc: 'Casio fx-991EX for engineering' },
    { id: 'stat-5', name: 'Sticky Notes Bundle', price: 120, image: 'https://images.unsplash.com/photo-1586075010923-2dd4570fb338?q=80&w=600&auto=format&fit=crop', desc: '5 neon colors, 500 sheets total' },
    { id: 'stat-6', name: 'Desk Organizer', price: 350, image: 'https://images.unsplash.com/photo-1520970014086-2208d157c9e2?q=80&w=600&auto=format&fit=crop', desc: 'Wooden pen and phone holder' },
    { id: 'stat-7', name: 'Highlighter Pack', price: 90, image: 'https://images.unsplash.com/photo-1520121401995-928cd56d4c67?q=80&w=600&auto=format&fit=crop', desc: 'Set of 6 pastel highlighters' },
    { id: 'stat-8', name: 'Premium Gel Pens', price: 150, image: 'https://images.unsplash.com/photo-1581447109200-bf2769116351?q=80&w=600&auto=format&fit=crop', desc: 'Pack of 5 black 0.5mm gel pens' },
    { id: 'stat-9', name: 'A4 Chart Paper', price: 50, image: 'https://images.unsplash.com/photo-1544457070-4cd773b4d71e?q=80&w=600&auto=format&fit=crop', desc: '10 sheets of thick chart paper' },
    { id: 'stat-10', name: 'Geometry Box', price: 200, image: 'https://images.unsplash.com/photo-1628155930542-3c7a64e2c833?q=80&w=600&auto=format&fit=crop', desc: 'Complete mathematical drawing set' }
  ],
  sweets: [
    { id: 'sw-1', name: 'Red Velvet Cake', price: 450, image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?q=80&w=600&auto=format&fit=crop', desc: 'Rich slice of classic red velvet' },
    { id: 'sw-2', name: 'Fudge Brownies', price: 120, image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=600&auto=format&fit=crop', desc: 'Gooey double chocolate brownies' },
    { id: 'sw-3', name: 'Assorted Macarons', price: 300, image: 'https://images.unsplash.com/photo-1569864358642-9d1684040f43?q=80&w=600&auto=format&fit=crop', desc: 'Box of 6 authentic French macarons' },
    { id: 'sw-4', name: 'Choco Lava Cake', price: 150, image: 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?q=80&w=600&auto=format&fit=crop', desc: 'Molten chocolate center dessert' },
    { id: 'sw-5', name: 'Blueberry Cheesecake', price: 250, image: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?q=80&w=600&auto=format&fit=crop', desc: 'New York style with blueberry compote' },
    { id: 'sw-6', name: 'Tiramisu Cup', price: 180, image: 'https://images.unsplash.com/photo-1571115177098-24edf7fb6f62?q=80&w=600&auto=format&fit=crop', desc: 'Classic Italian coffee dessert' },
    { id: 'sw-7', name: 'Donut Box (Set of 4)', price: 320, image: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?q=80&w=600&auto=format&fit=crop', desc: 'Assorted glazed and filled donuts' },
    { id: 'sw-8', name: 'Chocolate Truffles', price: 200, image: 'https://images.unsplash.com/photo-1548842188-f132e01df222?q=80&w=600&auto=format&fit=crop', desc: 'Handcrafted dark chocolate truffles' },
    { id: 'sw-9', name: 'Fruit Tart', price: 160, image: 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?q=80&w=600&auto=format&fit=crop', desc: 'Crispy tart shell with custard & fresh fruit' },
    { id: 'sw-10', name: 'Gulab Jamun (2 pcs)', price: 80, image: 'https://images.unsplash.com/photo-1582576163090-09d3b6982b5c?q=80&w=600&auto=format&fit=crop', desc: 'Warm syrup-soaked traditional sweet' }
  ],
  drinks: [
    { id: 'dr-1', name: 'Iced Caramel Latte', price: 160, image: 'https://images.unsplash.com/photo-1461023058943-0708e58231cb?q=80&w=600&auto=format&fit=crop', desc: 'Chilled espresso with caramel swirl' },
    { id: 'dr-2', name: 'Mango Smoothie', price: 140, image: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?q=80&w=600&auto=format&fit=crop', desc: 'Fresh seasonal mango blended' },
    { id: 'dr-3', name: 'Mint Mojito Mocktail', price: 120, image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=600&auto=format&fit=crop', desc: 'Refreshing lime and mint cooler' },
    { id: 'dr-4', name: 'Cold Brew Coffee', price: 180, image: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?q=80&w=600&auto=format&fit=crop', desc: '12-hour steeped smooth coffee' },
    { id: 'dr-5', name: 'Strawberry Milkshake', price: 150, image: 'https://images.unsplash.com/photo-1572490122747-3968b75bb8ef?q=80&w=600&auto=format&fit=crop', desc: 'Thick shake with real strawberries' },
    { id: 'dr-6', name: 'Green Detox Juice', price: 130, image: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?q=80&w=600&auto=format&fit=crop', desc: 'Spinach, apple, celery, and ginger' },
    { id: 'dr-7', name: 'Boba Milk Tea', price: 170, image: 'https://images.unsplash.com/photo-1558857563-b37103fac9eb?q=80&w=600&auto=format&fit=crop', desc: 'Classic brown sugar bubble tea' },
    { id: 'dr-8', name: 'Watermelon Cooler', price: 110, image: 'https://images.unsplash.com/photo-1589733955941-5eeaf752f6dd?q=80&w=600&auto=format&fit=crop', desc: 'Fresh watermelon juice with ice' },
    { id: 'dr-9', name: 'Energy Drink (RedBull)', price: 125, image: 'https://images.unsplash.com/photo-1622543925917-763c34d1a86e?q=80&w=600&auto=format&fit=crop', desc: '250ml can for instant energy' },
    { id: 'dr-10', name: 'Hot Hot Chocolate', price: 140, image: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?q=80&w=600&auto=format&fit=crop', desc: 'Rich cocoa topped with marshmallows' }
  ],
  gym: [
    { id: 'gym-1', name: 'Whey Protein (1kg)', price: 2400, image: 'https://images.unsplash.com/photo-1579722820308-d74e571900a9?q=80&w=600&auto=format&fit=crop', desc: '100% Gold Standard Isolate' },
    { id: 'gym-2', name: 'Pre-Workout Rush', price: 1800, image: 'https://images.unsplash.com/photo-1594882645126-14020914d58d?q=80&w=600&auto=format&fit=crop', desc: 'Explosive energy and focus' },
    { id: 'gym-3', name: 'Steel Shaker Bottle', price: 450, image: 'https://images.unsplash.com/photo-1584735935682-2f2b69d4fa8e?q=80&w=600&auto=format&fit=crop', desc: '750ml leak-proof protein shaker' },
    { id: 'gym-4', name: 'Creatine Monohydrate', price: 1200, image: 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?q=80&w=600&auto=format&fit=crop', desc: 'Unflavored 300g pure creatine' },
    { id: 'gym-5', name: 'BCAA Powder', price: 1600, image: 'https://images.unsplash.com/photo-1593095948071-474c5cc2989d?q=80&w=600&auto=format&fit=crop', desc: 'Intra-workout recovery drink' },
    { id: 'gym-6', name: 'Peanut Butter (Crunchy)', price: 350, image: 'https://images.unsplash.com/photo-1596482181467-3329f626a575?q=80&w=600&auto=format&fit=crop', desc: '1kg unsweetened high protein' },
    { id: 'gym-7', name: 'Resistance Bands Set', price: 600, image: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=600&auto=format&fit=crop', desc: 'Pack of 5 levels with handles' },
    { id: 'gym-8', name: 'Gym Gloves', price: 400, image: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?q=80&w=600&auto=format&fit=crop', desc: 'Padded leather workout gloves' },
    { id: 'gym-9', name: 'Protein Bars (Box of 6)', price: 720, image: 'https://images.unsplash.com/photo-1622484211147-38012b186b88?q=80&w=600&auto=format&fit=crop', desc: '20g protein per chocolate bar' },
    { id: 'gym-10', name: 'Skipping Rope', price: 250, image: 'https://images.unsplash.com/photo-1517343985841-f6b280e07172?q=80&w=600&auto=format&fit=crop', desc: 'Adjustable speed jump rope' }
  ],
  rentals: [
    { id: 'ren-1', name: 'City Bicycle (Daily)', price: 150, image: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?q=80&w=600&auto=format&fit=crop', desc: 'Geared cycle for campus commuting' },
    { id: 'ren-2', name: 'Electric Scooter (Hourly)', price: 80, image: 'https://images.unsplash.com/photo-1595821927361-4238421d7baa?q=80&w=600&auto=format&fit=crop', desc: 'Fast EV scooter for campus' },
    { id: 'ren-3', name: 'Mountain Bike (Daily)', price: 250, image: 'https://images.unsplash.com/photo-1511994298241-608e28f14fde?q=80&w=600&auto=format&fit=crop', desc: 'Sturdy bike for rough terrain' },
    { id: 'ren-4', name: 'Premium E-Bike (Daily)', price: 400, image: 'https://images.unsplash.com/photo-1572621404173-89bd247e65aa?q=80&w=600&auto=format&fit=crop', desc: 'Long range electric bicycle' },
    { id: 'ren-5', name: 'Two-Wheeler Activa (Daily)', price: 500, image: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?q=80&w=600&auto=format&fit=crop', desc: 'Honda Activa 6G with helmet' },
    { id: 'ren-6', name: 'Royal Enfield (Daily)', price: 1200, image: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=600&auto=format&fit=crop', desc: 'Classic 350cc motorcycle rental' },
    { id: 'ren-7', name: 'Roller Skates (Hourly)', price: 50, image: 'https://images.unsplash.com/photo-1520113412543-39d91f24d9c7?q=80&w=600&auto=format&fit=crop', desc: 'Inline skates with safety pads' },
    { id: 'ren-8', name: 'Skateboard (Daily)', price: 100, image: 'https://images.unsplash.com/photo-1520045892732-304bc3ac5d8e?q=80&w=600&auto=format&fit=crop', desc: 'Classic wooden skateboard' },
    { id: 'ren-9', name: 'Car Rental - Hatchback (Daily)', price: 2000, image: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?q=80&w=600&auto=format&fit=crop', desc: 'Swift or i20 (Fuel extra)' },
    { id: 'ren-10', name: 'Bicycle Helmet (Daily)', price: 30, image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?q=80&w=600&auto=format&fit=crop', desc: 'Safety helmet rental addon' }
  ],
  fruits: [
    { id: 'fr-1', name: 'Fresh Apples (1kg)', price: 180, image: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6faa6?q=80&w=600&auto=format&fit=crop', desc: 'Crisp and sweet Washington apples' },
    { id: 'fr-2', name: 'Banana Bunch', price: 60, image: 'https://images.unsplash.com/photo-1603833665858-e61d17a86224?q=80&w=600&auto=format&fit=crop', desc: 'Premium robusta bananas' },
    { id: 'fr-3', name: 'Mixed Fruit Bowl', price: 120, image: 'https://images.unsplash.com/photo-1490474504059-cb14e08bfcd2?q=80&w=600&auto=format&fit=crop', desc: 'Freshly cut seasonal fruits' },
    { id: 'fr-4', name: 'Oranges (1kg)', price: 100, image: 'https://images.unsplash.com/photo-1547514701-427221017958?q=80&w=600&auto=format&fit=crop', desc: 'Juicy Nagpur oranges' },
    { id: 'fr-5', name: 'Pomegranate (1kg)', price: 220, image: 'https://images.unsplash.com/photo-1528821128474-27f963b062bf?q=80&w=600&auto=format&fit=crop', desc: 'Ruby red sweet pomegranates' },
    { id: 'fr-6', name: 'Watermelon (Medium)', price: 80, image: 'https://images.unsplash.com/photo-1587049352847-81a56d773c1c?q=80&w=600&auto=format&fit=crop', desc: 'Fresh sweet watermelon whole' },
    { id: 'fr-7', name: 'Grapes (500g)', price: 90, image: 'https://images.unsplash.com/photo-1537640538966-79f369143f8f?q=80&w=600&auto=format&fit=crop', desc: 'Seedless green grapes' },
    { id: 'fr-8', name: 'Pineapple (Whole)', price: 70, image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?q=80&w=600&auto=format&fit=crop', desc: 'Ripe and ready to cut' },
    { id: 'fr-9', name: 'Kiwi Pack (3 pcs)', price: 150, image: 'https://images.unsplash.com/photo-1585059895524-72359e06138a?q=80&w=600&auto=format&fit=crop', desc: 'Zespri green kiwifruits' },
    { id: 'fr-10', name: 'Papaya (Medium)', price: 50, image: 'https://images.unsplash.com/photo-1617112848504-2070fc78a2e1?q=80&w=600&auto=format&fit=crop', desc: 'Fresh ripe papaya whole' }
  ],
  pharmacy: [
    { id: 'phar-1', name: 'Paracetamol 500mg', price: 30, image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ad?q=80&w=600&auto=format&fit=crop', desc: 'Fever and pain relief (Strip of 10)' },
    { id: 'phar-2', name: 'Multivitamin Complex', price: 250, image: 'https://images.unsplash.com/photo-1550572017-edb730592fdb?q=80&w=600&auto=format&fit=crop', desc: 'Daily health supplement (30 tabs)' },
    { id: 'phar-3', name: 'First Aid Kit Basic', price: 350, image: 'https://images.unsplash.com/photo-1603398938378-e54eab446dde?q=80&w=600&auto=format&fit=crop', desc: 'Bandages, antiseptic, cotton' },
    { id: 'phar-4', name: 'Cough Syrup (100ml)', price: 120, image: 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?q=80&w=600&auto=format&fit=crop', desc: 'Relief from dry & wet cough' },
    { id: 'phar-5', name: 'Digene Gel (200ml)', price: 140, image: 'https://images.unsplash.com/photo-1628771065518-0d82f1938462?q=80&w=600&auto=format&fit=crop', desc: 'Antacid for acidity and gas' },
    { id: 'phar-6', name: 'Volini Spray', price: 160, image: 'https://images.unsplash.com/photo-1576602976047-174e57a47881?q=80&w=600&auto=format&fit=crop', desc: 'Pain relief spray for sprains' },
    { id: 'phar-7', name: 'Electral Powder Pack', price: 25, image: 'https://images.unsplash.com/photo-1614735241165-6756e1df61ab?q=80&w=600&auto=format&fit=crop', desc: 'ORS powder for hydration' },
    { id: 'phar-8', name: 'Vicks Vaporub', price: 85, image: 'https://images.unsplash.com/photo-1583324113626-70df0f4deaab?q=80&w=600&auto=format&fit=crop', desc: 'Cold and headache relief balm' },
    { id: 'phar-9', name: 'Hand Sanitizer (100ml)', price: 50, image: 'https://images.unsplash.com/photo-1584483766114-2cea6facdf57?q=80&w=600&auto=format&fit=crop', desc: '70% alcohol-based gel' },
    { id: 'phar-10', name: 'Thermometer Digital', price: 200, image: 'https://images.unsplash.com/photo-1584362917165-526a968579e8?q=80&w=600&auto=format&fit=crop', desc: 'Quick and accurate reading' }
  ],
  laundry: [
    { id: 'laun-1', name: 'Wash & Fold (Per kg)', price: 60, image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?q=80&w=600&auto=format&fit=crop', desc: 'Standard machine wash and fold' },
    { id: 'laun-2', name: 'Premium Dry Cleaning', price: 150, image: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?q=80&w=600&auto=format&fit=crop', desc: 'For blazers and delicate fabrics' },
    { id: 'laun-3', name: 'Steam Ironing (Per pc)', price: 15, image: 'https://images.unsplash.com/photo-1590393802821-396a84c8a209?q=80&w=600&auto=format&fit=crop', desc: 'Crisp finish steam pressing' },
    { id: 'laun-4', name: 'Shoe Cleaning', price: 200, image: 'https://images.unsplash.com/photo-1608231387042-66d1773070a5?q=80&w=600&auto=format&fit=crop', desc: 'Deep clean for sneakers' },
    { id: 'laun-5', name: 'Blanket/Quilt Wash', price: 300, image: 'https://images.unsplash.com/photo-1585058177114-f89a9f24ba22?q=80&w=600&auto=format&fit=crop', desc: 'Heavy winter wear cleaning' },
    { id: 'laun-6', name: 'Express Wash (Same Day)', price: 100, image: 'https://images.unsplash.com/photo-1610557892470-55d9e80c0bce?q=80&w=600&auto=format&fit=crop', desc: 'Fast turnaround per kg' },
    { id: 'laun-7', name: 'Saree Roll Press', price: 120, image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?q=80&w=600&auto=format&fit=crop', desc: 'Professional saree ironing' },
    { id: 'laun-8', name: 'Stain Removal Service', price: 80, image: 'https://images.unsplash.com/photo-1600862088899-7fb60293db27?q=80&w=600&auto=format&fit=crop', desc: 'Targeted spot cleaning' },
    { id: 'laun-9', name: 'Bag Spa (Backpack)', price: 250, image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=600&auto=format&fit=crop', desc: 'Thorough bag washing' },
    { id: 'laun-10', name: 'Wash & Iron (Per kg)', price: 90, image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?q=80&w=600&auto=format&fit=crop', desc: 'Complete laundry service' }
  ],
  seasonal: [
    { id: 'seas-1', name: 'Festive Sweet Box', price: 550, image: 'https://images.unsplash.com/photo-1605493725791-318e874959db?q=80&w=600&auto=format&fit=crop', desc: 'Assorted premium mithai' },
    { id: 'seas-2', name: 'Handmade Diyas (Set of 6)', price: 120, image: 'https://images.unsplash.com/photo-1603512392250-705a39626388?q=80&w=600&auto=format&fit=crop', desc: 'Decorative clay lamps' },
    { id: 'seas-3', name: 'Holi Colors Pack', price: 150, image: 'https://images.unsplash.com/photo-1583321500900-82807e458f3c?q=80&w=600&auto=format&fit=crop', desc: 'Organic gulal in 5 colors' },
    { id: 'seas-4', name: 'Christmas Plum Cake', price: 350, image: 'https://images.unsplash.com/photo-1512485694743-9c9538b4e6e0?q=80&w=600&auto=format&fit=crop', desc: 'Rich traditional fruit cake' },
    { id: 'seas-5', name: 'Rakhi Gift Set', price: 400, image: 'https://images.unsplash.com/photo-1596700684725-d72b2605b0d0?q=80&w=600&auto=format&fit=crop', desc: 'Thread, sweets and tikka' },
    { id: 'seas-6', name: 'Ganesh Idol (Eco-friendly)', price: 250, image: 'https://images.unsplash.com/photo-1599547071987-a006df261d76?q=80&w=600&auto=format&fit=crop', desc: 'Clay idol that dissolves in water' },
    { id: 'seas-7', name: 'New Year Party Poppers', price: 100, image: 'https://images.unsplash.com/photo-1543807535-eceef0bc6599?q=80&w=600&auto=format&fit=crop', desc: 'Confetti canons set of 2' },
    { id: 'seas-8', name: 'Navratri Dandiya Sticks', price: 180, image: 'https://images.unsplash.com/photo-1601662998345-03e1e24efd8c?q=80&w=600&auto=format&fit=crop', desc: 'Wooden decorated pair' },
    { id: 'seas-9', name: 'Halloween Candy Bag', price: 200, image: 'https://images.unsplash.com/photo-1509559864273-0d720a4b3706?q=80&w=600&auto=format&fit=crop', desc: 'Assorted chocolates and candies' },
    { id: 'seas-10', name: 'Pongal Pot Decoration', price: 150, image: 'https://images.unsplash.com/photo-1579730537021-420063777f98?q=80&w=600&auto=format&fit=crop', desc: 'Traditional painted clay pot' }
  ]
};

const CATEGORY_NAMES: Record<string, string> = {
  stationary: 'Stationary & Print',
  seasonal: 'Season Specials',
  sweets: 'Delicious Desserts',
  drinks: 'Drinks & Beverages',
  gym: 'Gym & Protein',
  rentals: 'Campus Rides',
  fruits: 'Fresh Fruits',
  pharmacy: 'Pharmacy',
  laundry: 'Dry Wash'
};

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const { addToCart } = useCart();

  const [items, setItems] = useState<any[]>(MOCK_DATA[id || ''] || []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const fetchCategoryItems = async () => {
      try {
        setLoading(true);
        const queryMap: Record<string, string> = {
          sweets: 'Dessert',
          drinks: 'Drinks',
          gym: 'gym',
          rentals: 'Rentals',
          fruits: 'fruits',
          stationary: 'stationary',
          pharmacy: 'pharmacy',
          laundry: 'laundry'
        };
        const searchTerm = queryMap[id] || id;
        const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(searchTerm)}`);
        if (res.ok) {
          const data = await res.json();
          let fetchedItems = data.items || [];
          if (fetchedItems.length > 0) {
            const formatted = fetchedItems.map((item: any) => ({
              id: item.id || item._id,
              name: item.name,
              price: item.price,
              image: item.imageUrl || item.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600',
              desc: item.description,
              restaurantId: item.restaurantId?._id || item.restaurantId || 'unknown-vendor',
              restaurantName: item.restaurantId?.name || 'Zenvy Merchant'
            }));
            setItems(formatted);
          }
        }
      } catch (err) {
        console.warn('Category items fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCategoryItems();
  }, [id]);

  const categoryName = CATEGORY_NAMES[id || ''] || 'Category Items';

  const txt = isDark ? '#FFF' : '#111';
  const txtSec = isDark ? '#AAA' : '#666';
  const bg = isDark ? '#0A0A0C' : '#FAFAFA';
  const cardBg = isDark ? '#141416' : '#FFF';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const handleAdd = (item: any) => {
    addToCart({
      id: item.id,
      name: item.name,
      price: item.price,
      image: item.image,
      quantity: 1,
      restaurantId: item.restaurantId || 'mega-basket-vendor',
      restaurantName: item.restaurantName || 'Mega Basket'
    });
    Alert.alert('Added to Cart', `${item.name} added to your mega basket.`);
  };

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity 
          style={s.backBtn} 
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }}
        >
          <Text style={[s.backIcon, { color: txt }]}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.subText}>ZENVY HUB</Text>
          <Text style={[s.title, { color: txt }]}>{categoryName}</Text>
        </View>
      </View>

      {/* Grid List */}
      {loading && items.length === 0 ? (
        <View style={s.emptyState}>
          <ActivityIndicator size="large" color={isDark ? COLORS.gold : COLORS.red} />
          <Text style={{ marginTop: 12, color: txtSec, fontSize: 11, fontWeight: '700' }}>Fetching live catalog...</Text>
        </View>
      ) : items.length > 0 ? (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={s.listContent}
          columnWrapperStyle={s.columnWrapper}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
              <Image source={{ uri: item.image }} style={s.cardImg} />
              <View style={s.cardInfo}>
                <Text style={[s.itemName, { color: txt }]} numberOfLines={1}>{item.name}</Text>
                <Text style={s.itemDesc} numberOfLines={2}>{item.desc}</Text>
                
                <View style={s.bottomRow}>
                  <Text style={s.itemPrice}>₹{item.price}</Text>
                  <TouchableOpacity style={s.addBtn} onPress={() => handleAdd(item)}>
                    <Text style={s.addBtnText}>ADD</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        />
      ) : (
        <View style={s.emptyState}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>🚀</Text>
          <Text style={[s.emptyTitle, { color: txt }]}>COMING SOON</Text>
          <Text style={s.emptySub}>We are working with vendors to bring these products to you.</Text>
          <TouchableOpacity 
            style={s.emptyBtn} 
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)' as any);
              }
            }}
          >
            <Text style={s.emptyBtnText}>GO BACK</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backIcon: { fontSize: 32, fontWeight: '300' },
  subText: { fontSize: 8, fontWeight: '900', color: COLORS.red, letterSpacing: 2 },
  title: { fontSize: 18, fontWeight: '900' },
  
  listContent: { padding: 12 },
  columnWrapper: { justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  
  card: { width: (SW - 36) / 2, borderRadius: 16, borderWidth: 1, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardImg: { width: '100%', height: 110, resizeMode: 'cover', backgroundColor: '#e1e1e1' },
  cardInfo: { padding: 10, flex: 1 },
  itemName: { fontSize: 11, fontWeight: '900', marginBottom: 2 },
  itemDesc: { fontSize: 8, fontWeight: '600', color: '#888', height: 24, lineHeight: 12, marginBottom: 8 },
  
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemPrice: { fontSize: 12, fontWeight: '900', color: COLORS.red },
  addBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: COLORS.red, borderRadius: 10 },
  addBtnText: { fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 2, marginBottom: 6 },
  emptySub: { fontSize: 9, fontWeight: '600', color: '#888', textAlign: 'center', marginBottom: 20 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 12, backgroundColor: COLORS.red, borderRadius: 24 },
  emptyBtnText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 1.5 }
});
