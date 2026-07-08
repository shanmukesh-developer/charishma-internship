"use client";
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';
import Link from 'next/link';
import SafeImage from '@/components/SafeImage';
import { useCart } from '@/context/CartContext';
import WorldSwitcher from '@/components/WorldSwitcher';
import { playSensoryFeedback } from '@/utils/sensory';

export default function CategoryPage() {
  const params = useParams();
  const router = useRouter();
  const categoryId = params.id as string;
  const { addToCart } = useCart();
  
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    window.scrollTo(0, 0);
  }, []);

  const getCategoryName = (id: string) => {
    const map: Record<string, string> = {
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
    return map[id] || 'Category';
  };

  const getMockData = (id: string) => {
    const data: Record<string, any[]> = {
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
        { id: 'ren-1', name: 'City Bicycle (Daily)', price: 150, image: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?q=80&w=600&auto=format&fit=crop', desc: 'Comfortable geared cycle' },
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
    return data[id] || [];
  };

  const mockItems = getMockData(categoryId);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0c] light:bg-[#FAFAFA] text-white light:text-gray-900 font-sans pb-24 relative overflow-hidden">
      {/* Premium subtle background glow */}
      <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-radial from-[#C9A84C]/10 via-transparent to-transparent opacity-80 pointer-events-none" />
      
      <Navbar />

      <main className="pt-24 px-4 sm:px-6 max-w-7xl mx-auto relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 flex items-center justify-between"
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <button onClick={() => router.back()} className="w-10 h-10 rounded-full bg-white/5 light:bg-white border border-white/10 light:border-gray-200 flex items-center justify-center hover:border-[#C9A84C] light:hover:border-[#C9A84C] transition-colors shadow-sm">
              <svg className="w-5 h-5 text-white light:text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h2 className="text-[9px] sm:text-[10px] font-black text-[#C9A84C] uppercase tracking-[0.4em] mb-1">Zenvy Hub</h2>
              <p className="text-2xl sm:text-3xl font-black text-white light:text-gray-900 tracking-tight" style={{ fontFamily: "'Syne', sans-serif" }}>{getCategoryName(categoryId)}</p>
            </div>
          </div>
          <Link href="/others" className="text-[10px] sm:text-xs font-bold text-gray-400 light:text-gray-500 hover:text-[#C9A84C] light:hover:text-[#C9A84C] underline underline-offset-4 transition-colors">
            View All Categories
          </Link>
        </motion.div>

        {mockItems.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {mockItems.map((item, index) => (
              <motion.div 
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + (index * 0.05) }}
                className="group bg-[#141416]/80 light:bg-white backdrop-blur-xl rounded-2xl border border-white/5 light:border-gray-100 overflow-hidden shadow-lg light:shadow-sm hover:border-[#C9A84C]/50 light:hover:border-[#C9A84C] hover:shadow-[0_0_20px_rgba(201,168,76,0.15)] hover:-translate-y-1 transition-all duration-300 flex flex-col"
              >
                <div className="relative w-full h-32 sm:h-48 overflow-hidden bg-[#1a1a1c] light:bg-gray-50 shrink-0 border-b border-white/5 light:border-gray-50 group-hover:border-[#C9A84C]/30 transition-colors">
                  <SafeImage src={item.image} alt={item.name} fill style={{ objectFit: 'cover' }} className="group-hover:scale-110 transition-transform duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#141416] light:from-white/50 to-transparent opacity-80" />
                </div>
                <div className="p-3 sm:p-5 flex flex-col flex-1 relative z-10 -mt-4">
                  <h3 className="text-sm sm:text-lg font-black text-white light:text-gray-900 mb-1 leading-tight group-hover:text-[#C9A84C] transition-colors line-clamp-1">{item.name}</h3>
                  <p className="text-[10px] sm:text-xs text-gray-400 light:text-gray-500 mb-3 sm:mb-4 line-clamp-2 leading-snug flex-1">{item.desc}</p>
                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-sm sm:text-lg font-black text-[#C9A84C]">₹{item.price}</span>
                    <button 
                      onClick={(e) => {
                         e.preventDefault();
                         playSensoryFeedback();
                         addToCart({ ...item, quantity: 1, restaurantId: 'mock-vendor' });
                         alert(`Added ${item.name} to cart!`);
                      }}
                      className="px-3 py-1.5 sm:px-4 sm:py-2 bg-[#1a1a1c] text-[#C9A84C] border border-[#C9A84C] rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider hover:bg-[#C9A84C] hover:text-black transition-all shadow-[0_0_10px_rgba(201,168,76,0.3)] hover:shadow-[0_0_15px_rgba(201,168,76,0.5)] active:scale-95"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex flex-col items-center justify-center py-20 text-center bg-[#141416]/50 light:bg-gray-50 backdrop-blur-xl rounded-3xl border border-white/5 light:border-gray-100"
          >
            <div className="text-6xl mb-4">🚀</div>
            <h3 className="text-xl font-black text-white light:text-gray-900 mb-2">Coming Soon</h3>
            <p className="text-gray-400 light:text-gray-500 max-w-sm mb-6 text-sm">
              We are actively working with campus vendors to bring the best {getCategoryName(categoryId).toLowerCase()} directly to your fingertips.
            </p>
            <Link href="/others" className="px-6 py-3 bg-gradient-to-r from-[#C9A84C] to-[#d4b96a] text-black rounded-full font-black text-sm uppercase tracking-widest hover:scale-105 transition-transform shadow-[0_0_15px_rgba(201,168,76,0.4)]">
              Explore Other Services
            </Link>
          </motion.div>
        )}
      </main>

      <WorldSwitcher />
    </div>
  );
}
