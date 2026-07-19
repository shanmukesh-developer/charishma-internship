import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Dimensions, Platform, TextInput, ActivityIndicator, Alert, Modal, Linking, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/auth';
import { ENDPOINTS, API_URL } from '../../constants/api';
import { useCart } from '../../context/CartContext';
import PromoCarousel from '../../components/PromoCarousel';
import SearchOverlay from '../../components/SearchOverlay';
import AmbientBackground from '../../components/AmbientBackground';
import DopaminePressable, { CardPressable, ActionPressable } from '../../components/DopaminePressable';
import { StaggeredSection, FloatingPulse, BounceIn } from '../../components/AnimatedSection';

// ── Self-contained countdown timer to prevent re-rendering the entire screen ──
const FlashDealTimer = memo(() => {
  const [secs, setSecs] = useState(9912);
  useEffect(() => {
    const timer = setInterval(() => {
      setSecs(prev => (prev > 0 ? prev - 1 : 9912));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const display = `${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  return <Text style={{ fontWeight: '900', color: '#DC2626' }}>{display}</Text>;
});

const { width: SW } = Dimensions.get('window');
const DEPT_SIZE = (SW - 48 - 36) / 4;

const ScalePressable = ({ children, onPress, style, activeOpacity = 0.85 }: any) => {
  const scale = useRef(new Animated.Value(1)).current;
  
  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={activeOpacity}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      style={style}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
};

const DEPARTMENTS = [
  { id: 'mega-basket', name: 'Mega Basket', img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&q=80' },
  { id: 'stationary', name: 'Stationary', img: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=200&q=80' },
  { id: 'sweets', name: 'Desserts', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=200&q=80' },
  { id: 'drinks', name: 'Beverages', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=200&q=80' },
  { id: 'pharmacy', name: 'Pharmacy', img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=200&q=80' },
  { id: 'fruits', name: 'Fresh Fruits', img: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=200&q=80' },
  { id: 'gym', name: 'Gym & Protein', img: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=200&q=80' },
  { id: 'rentals', name: 'Campus Rides', img: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=200&q=80' },
  { id: 'laundry', name: 'Dry Wash', img: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=200&q=80' },
  { id: 'seasonal', name: 'Festive', img: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=200&q=80' },
];

const TABS = [
  { key: 'food', label: 'FOOD & BASKET' },
  { key: 'pg', label: 'PG HOMES' },
  { key: 'coride', label: 'CO-RIDE' },
  { key: 'promos', label: 'DEALS & SPINS' },
];

const WHEEL_SECTORS = [
  { label: '50% Off', emoji: '📝', color: '#EF4444', code: 'STATIONARY50' },
  { label: 'Free Del', emoji: '🛵', color: '#F59E0B', code: 'FREEDELIVERY' },
  { label: '₹50 Ride', emoji: '🚗', color: '#10B981', code: 'RIDE50' },
  { label: 'Free Oreo', emoji: '🍪', color: '#3B82F6', code: 'OREOFREE' },
  { label: 'BOGO Juice', emoji: '🥤', color: '#8B5CF6', code: 'JUICEBOGO' },
  { label: '2x Karma', emoji: '✨', color: '#EC4899', code: 'KARMA2X' },
  { label: '₹100 PG', emoji: '🏢', color: '#06B6D4', code: 'PG100' },
  { label: 'Try Again', emoji: '🔄', color: '#6B7280', code: 'TRYAGAIN' },
];

const PROMOS = [
  { id: '1', tagline: 'MEGA DEAL 🎁', title: 'STATIONARY', subtitle: 'BLOWOUT SALE', desc: 'UP TO 60% OFF ON NOTEBOOKS, PENS, AND BACKPACKS.', btn: 'SHOP NOW →', img: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=600' },
  { id: '2', tagline: 'FITNESS FIRST 💪', title: 'PROTEIN', subtitle: 'RESTOCK', desc: 'GET 100% AUTHENTIC WHEY. FREE SHAKER ON EVERY ORDER.', btn: 'BROWSE SUPPLEMENTS →', img: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600' },
  { id: '3', tagline: 'CAMPUS RIDES 🚲', title: 'YOUR RIDE', subtitle: 'AWAITS', desc: 'BIKE AND CYCLE RENTALS FROM ₹49/DAY.', btn: 'FIND A RIDE →', img: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=600' },
];

const TRENDING = [
  { id: '1', title: 'Essentials Mega Basket', desc: 'Build a custom grocery list & get delivery with live shop pricing', tag: 'NEW SERVICE', badge: '⚡ Zero Estimation Errors', img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400' },
  { id: '2', title: 'Midnight Cravings', desc: 'Up to 20% off on late night snacks', tag: 'HOT', badge: '🔥 45 ordered tonight', img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400' },
  { id: '3', title: 'Exam Season Prep', desc: 'Stationary & energy drinks combo', tag: 'NEW', badge: 'Ends in 2h', img: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=400' },
  { id: '4', title: 'Healthy Living', desc: 'Fresh fruits and whey supplements', tag: 'TRENDING', badge: 'Selling Fast', img: 'https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?w=400' },
];


const GROCERY_CATEGORIES = [
  {
    title: 'Daily Essentials',
    items: [
      { name: 'Atta & Flours', img: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80' },
      { name: 'Dals & Pulses', img: 'https://images.unsplash.com/photo-1599940824399-b87987ceb72a?w=400&q=80' },
      { name: 'Edible Oils & Ghee', img: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80' },
      { name: 'Rice & Grains', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&q=80' },
      { name: 'Masalas & Spices', img: 'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=400&q=80' },
      { name: 'Seeds & Dry Fruits', img: 'https://images.unsplash.com/photo-1606923829579-0ac9c49fb20a?w=400&q=80' },
      { name: 'Salt, Sugar & Jaggery', img: 'https://images.unsplash.com/photo-1610970881699-44a5587caaec?w=400&q=80' },
      { name: 'Organic Staples', img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&q=80' }
    ]
  },
  {
    title: 'Snacks & Drinks',
    items: [
      { name: 'Chips & Namkeens', img: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&q=80' },
      { name: 'Biscuits & Cakes', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80' },
      { name: 'Instant & Frozen Food', img: 'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=400&q=80' },
      { name: 'Breakfast Options', img: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=400&q=80' },
      { name: 'Drinks & Juices', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=400&q=80' },
      { name: 'Tea & Coffee', img: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&q=80' },
      { name: 'Sweet Indulgences', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80' },
      { name: 'Gourmet', img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&q=80' }
    ]
  },
  {
    title: 'Home Needs',
    items: [
      { name: 'Health & Hygiene', img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80' },
      { name: 'Detergents & Cleaning', img: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=400&q=80' },
      { name: 'Bath, Body & Hair', img: 'https://images.unsplash.com/photo-1526947425960-945c6e72858f?w=400&q=80' },
      { name: 'Beauty & Skincare', img: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&q=80' }
    ]
  }
];

const SEARCH_PLACEHOLDERS = ["Search for 'rice'", "Search for 'chips'", "Search for 'curd'", "Search for 'atta'", "Search for 'ghee'", "Search for 'toys'", "Search for 'seeds'"];

const TOY_ITEMS = [
  {
    id: 'toys-monster-truck',
    name: '4x4 Monster Truck For 3+ Years',
    brand: 'KRIIDDAANK',
    price: 49,
    originalPrice: 499,
    discount: '90% OFF',
    weight: '1 pc',
    image: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=300&q=80',
    isVeg: true
  },
  {
    id: 'toys-uno-card',
    name: 'Uno Original Card Game',
    brand: 'MATTEL GAMES',
    price: 119,
    originalPrice: 149,
    discount: '20% OFF',
    weight: 'Pack of 1 - (108 pcs)',
    image: 'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=300&q=80',
    isVeg: true
  },
  {
    id: 'toys-rubik-cube',
    name: 'Speed Cube 3 x 3 High Speed Sticker Less 3D Cube',
    brand: 'TOY CLOUD',
    price: 89,
    originalPrice: 299,
    discount: '70% OFF',
    weight: '1 pc - Box',
    image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=300',
    isVeg: true
  }
];

const SEED_ITEMS = [
  {
    id: 'seeds-tomato',
    name: 'Tomato Seeds',
    brand: 'BOMBAY SEEDS',
    price: 40.80,
    originalPrice: 80,
    discount: '49% OFF',
    weight: '10 g',
    image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=300&q=80',
    isVeg: true,
    flashSale: true
  },
  {
    id: 'seeds-cucumber',
    name: 'Cucumber Khira Seeds',
    brand: 'BOMBAY SEEDS',
    price: 59,
    originalPrice: 80,
    discount: '26% OFF',
    weight: '10 g',
    image: 'https://images.unsplash.com/photo-1604977042946-1eecc30f269e?w=300&q=80',
    isVeg: true
  },
  {
    id: 'seeds-chilli',
    name: 'Chilli Hot Pepper Seeds',
    brand: 'BOMBAY SEEDS',
    price: 59,
    originalPrice: 80,
    discount: '26% OFF',
    weight: '10 g',
    image: 'https://images.unsplash.com/photo-1583119022894-919a68a3d0e3?w=300&q=80',
    isVeg: true
  }
];

const TOY_MANIA_CATEGORIES = [
  {
    title: 'Vehicle toys',
    badge: 'STARTING @ RS. 49',
    image: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=200&q=80',
    bg: '#E0F2FE',
    badgeBg: '#0284C7'
  },
  {
    title: 'Learning & education',
    badge: 'UP TO 80% OFF',
    image: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=200&q=80',
    bg: '#ECFDF5',
    badgeBg: '#059669'
  },
  {
    title: 'Sports & games',
    badge: 'STARTING @ RS. 49',
    image: 'https://images.unsplash.com/photo-1531565637446-32307b194362?w=200&q=80',
    bg: '#FFF7ED',
    badgeBg: '#EA580C'
  },
  {
    title: 'Games & plushies',
    badge: 'STARTING @ RS. 49',
    image: 'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=200&q=80',
    bg: '#F3E8FF',
    badgeBg: '#7C3AED'
  },
  {
    title: 'Baby & toddler toys',
    badge: 'UP TO 80% OFF',
    image: 'https://images.unsplash.com/photo-1555448248-2571daf6344b?w=200&q=80',
    bg: '#FDF2F8',
    badgeBg: '#DB2777'
  },
  {
    title: 'Fitness ready',
    badge: 'STARTING @ RS. 99',
    image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=200&q=80',
    bg: '#FEF9C3',
    badgeBg: '#CA8A04'
  }
];

const CATEGORY_PRODUCTS: Record<string, Array<{ id: string; name: string; price: number; originalPrice: number; weight: string; image: string; isVeg: boolean; discount?: string }>> = {
  'Vehicle toys': [
    { id: 'toys-monster-truck', name: '4x4 Monster Truck For 3+ Years', price: 49, originalPrice: 499, weight: '1 pc', image: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=400&q=80', isVeg: true, discount: '90% OFF' }
  ],
  'Learning & education': [
    { id: 'toys-tablet', name: 'LCD Writing Tablet Board For Kids', price: 149, originalPrice: 699, weight: '1 pc', image: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=400&q=80', isVeg: true, discount: '78% OFF' }
  ],
  'Sports & games': [
    { id: 'toys-cricket', name: 'Kids Cricket Bat and Ball Set', price: 199, originalPrice: 499, weight: 'Pack of 1', image: 'https://images.unsplash.com/photo-1531565637446-32307b194362?w=400&q=80', isVeg: true, discount: '60% OFF' }
  ],
  'Games & plushies': [
    { id: 'toys-uno-card', name: 'Uno Original Card Game', price: 119, originalPrice: 149, weight: 'Pack of 1 - (108 pcs)', image: 'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=400&q=80', isVeg: true, discount: '20% OFF' }
  ],
  'Baby & toddler toys': [
    { id: 'toys-stack-rings', name: 'Multicolor Stacking Rings Toy', price: 99, originalPrice: 249, weight: '1 pc', image: 'https://images.unsplash.com/photo-1555448248-2571daf6344b?w=400&q=80', isVeg: true, discount: '60% OFF' }
  ],
  'Fitness ready': [
    { id: 'toys-rope', name: 'Premium Skipping Rope Adjustable', price: 99, originalPrice: 199, weight: '1 pc', image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=400&q=80', isVeg: true, discount: '50% OFF' }
  ],
  'Seeds': [
    { id: 'seeds-tomato', name: 'Tomato Seeds', price: 40.80, originalPrice: 80, weight: '10 g', image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&q=80', isVeg: true, discount: '49% OFF' },
    { id: 'seeds-cucumber', name: 'Cucumber Khira Seeds', price: 59, originalPrice: 80, weight: '10 g', image: 'https://images.unsplash.com/photo-1604977042946-1eecc30f269e?w=400&q=80', isVeg: true, discount: '26% OFF' },
    { id: 'seeds-chilli', name: 'Chilli Hot Pepper Seeds', price: 59, originalPrice: 80, weight: '10 g', image: 'https://images.unsplash.com/photo-1583119022894-919a68a3d0e3?w=400&q=80', isVeg: true, discount: '26% OFF' }
  ],
  'Fresh': [
    { id: 'fruit-1', name: 'Fresh Royal Gala Apple Selection', price: 180, originalPrice: 220, weight: '4 pcs', image: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=400&q=80', isVeg: true, discount: '18% OFF' },
    { id: 'bb-lemon', name: 'Fresh Lemon', price: 10, originalPrice: 27, weight: '3 pcs', image: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=400&q=80', isVeg: true, discount: '63% OFF' },
    { id: 'bb-carrot', name: 'Carrot - Local', price: 39, originalPrice: 56.16, weight: '500 g', image: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=400&q=80', isVeg: true, discount: '30% OFF' },
    { id: 'brand-guava', name: 'B Natural Guava Fruit Beverage', price: 88, originalPrice: 115, weight: '1 L', image: 'https://images.unsplash.com/photo-1534531173927-aeb928d54385?w=400&q=80', isVeg: true, discount: '23% OFF' }
  ],
  'Grocery': [
    { id: 'cat-atta-1', name: 'Aashirvaad Shudh Chakki Atta', price: 260, originalPrice: 290, weight: '5 kg', image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80', isVeg: true, discount: '10% OFF' },
    { id: 'cat-dal-1', name: 'Tata Sampann Toor Dal', price: 159, originalPrice: 180, weight: '1 kg', image: 'https://images.unsplash.com/photo-1545114197-2f5a05b38b1f?w=400&q=80', isVeg: true, discount: '11% OFF' },
    { id: 'cat-oil-2', name: 'Amul Pure Cow Ghee Tin', price: 680, originalPrice: 720, weight: '1 L', image: 'https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?w=400&q=80', isVeg: true, discount: '5% OFF' }
  ],
  'Organic': [
    { id: 'org-1', name: 'Organic Unpolished Chana Dal Split', price: 85, originalPrice: 99, weight: '500 g', image: 'https://images.unsplash.com/photo-1545114197-2f5a05b38b1f?w=400&q=80', isVeg: true, discount: '14% OFF' },
    { id: 'org-2', name: 'Organic Cold Pressed Mustard Oil', price: 230, originalPrice: 260, weight: '1 L', image: 'https://images.unsplash.com/photo-1620706857370-e1b9770e8bb1?w=400&q=80', isVeg: true, discount: '11% OFF' }
  ],
  'Health': [
    { id: 'hyg-1', name: 'Dettol Liquid Handwash Refill Pouch', price: 99, originalPrice: 110, weight: '175 ml', image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', isVeg: true, discount: '10% OFF' },
    { id: 'hyg-2', name: 'Savlon Antiseptic Disinfectant Liquid', price: 45, originalPrice: 50, weight: '100 ml', image: 'https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=400&q=80', isVeg: true, discount: '10% OFF' }
  ],
  'Electronics': [
    { id: 'elec-1', name: 'boAt Rockerz Bluetooth Headphones', price: 999, originalPrice: 1999, weight: '1 pc', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&q=80', isVeg: true, discount: '50% OFF' },
    { id: 'elec-2', name: 'Mi 10000mAh Power Bank 3i', price: 899, originalPrice: 1299, weight: '1 pc', image: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=400&q=80', isVeg: true, discount: '30% OFF' }
  ]
};

const getBrandProducts = (brandName: string) => {
  switch (brandName) {
    case 'Amul':
      return [
        { id: 'brand-amul-1', name: 'Amul Pure Cow Ghee Tin', price: 680, originalPrice: 720, weight: '1 L', image: 'https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?w=400&q=80', isVeg: true, discount: '5% OFF' },
        { id: 'brand-amul-2', name: 'Amul Dark Chocolate Fruit & Nut', price: 125, originalPrice: 140, weight: '150 g', image: 'https://images.unsplash.com/photo-1549007994-cb92ca813bec?w=400&q=80', isVeg: true, discount: '10% OFF' },
        { id: 'brand-amul-3', name: 'Amul Taaza Fresh Toned Milk', price: 54, originalPrice: 56, weight: '1 L', image: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400&q=80', isVeg: true }
      ];
    case 'Surf Excel':
      return [
        { id: 'brand-surf-1', name: 'Surf Excel Easy Wash Detergent Powder', price: 140, originalPrice: 160, weight: '1 kg', image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=400&q=80', isVeg: true, discount: '12% OFF' },
        { id: 'brand-surf-2', name: 'Surf Excel Matic Liquid Comfort', price: 210, originalPrice: 240, weight: '500 ml', image: 'https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=400&q=80', isVeg: true, discount: '12% OFF' }
      ];
    case 'Nescafe':
      return [
        { id: 'brand-nescafe-1', name: 'Nescafe Classic Instant Coffee Jar', price: 310, originalPrice: 340, weight: '100 g', image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&q=80', isVeg: true, discount: '8% OFF' },
        { id: 'brand-nescafe-2', name: 'Nescafe Sunrise Premium blend', price: 180, originalPrice: 200, weight: '100 g', image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&q=80', isVeg: true, discount: '10% OFF' }
      ];
    case 'Cadbury':
      return [
        { id: 'brand-cadbury-1', name: 'Cadbury Dairy Milk Silk Chocolate Bar', price: 100, originalPrice: 100, weight: '150 g', image: 'https://images.unsplash.com/photo-1549007994-cb92ca813bec?w=400&q=80', isVeg: true },
        { id: 'brand-cadbury-2', name: 'Cadbury Oreo Chocolate Cookies', price: 35, originalPrice: 40, weight: '120 g', image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', isVeg: true, discount: '12% OFF' },
        { id: 'brand-cadbury-3', name: 'Cadbury Bournvita Chocolate Health Drink', price: 230, originalPrice: 250, weight: '500 g', image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&q=80', isVeg: true, discount: '8% OFF' }
      ];
    case 'Lays':
      return [
        { id: 'chips-1', name: 'Lays Classic Salted Potato Chips', price: 20, originalPrice: 20, weight: '50 g', image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&q=80', isVeg: true },
        { id: 'brand-lays-2', name: 'Lays American Style Cream & Onion', price: 20, originalPrice: 20, weight: '50 g', image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&q=80', isVeg: true },
        { id: 'brand-lays-3', name: 'Lays Spanish Tomato Tangy Crisps', price: 20, originalPrice: 20, weight: '50 g', image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&q=80', isVeg: true }
      ];
    case 'Coca Cola':
      return [
        { id: 'drink-1', name: 'Coca Cola Diet Coke Can Carbonated', price: 40, originalPrice: 40, weight: '300 ml', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&q=80', isVeg: true },
        { id: 'brand-coke-2', name: 'Coca Cola Original Soft Drink Bottle', price: 60, originalPrice: 65, weight: '1.25 L', image: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=400&q=80', isVeg: true, discount: '8% OFF' },
        { id: 'brand-coke-3', name: 'Sprite Lemon Lime Clear Carbonated Drink', price: 40, originalPrice: 40, weight: '300 ml', image: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=400&q=80', isVeg: true }
      ];
    default:
      return [];
  }
};

const getCategoryProducts = (categoryName: string) => {
  const brandProds = getBrandProducts(categoryName);
  if (brandProds.length > 0) {
    return brandProds;
  }

  if (CATEGORY_PRODUCTS[categoryName]) {
    return CATEGORY_PRODUCTS[categoryName];
  }
  
  let items: Array<{ id: string; name: string; price: number; originalPrice: number; weight: string; image: string; isVeg: boolean; discount?: string }> = [];

  if (categoryName.includes('Chips') || categoryName.includes('Namkeens')) {
    items = [
      { id: 'chips-1', name: 'Lays Classic Salted Potato Chips', price: 20, originalPrice: 20, weight: '50 g', image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&q=80', isVeg: true },
      { id: 'chips-2', name: 'Haldirams Bhujia Sev Premium', price: 55, originalPrice: 65, weight: '150 g', image: 'https://images.unsplash.com/photo-1589476993333-f55b84301219?w=400&q=80', isVeg: true, discount: '15% OFF' },
      { id: 'chips-3', name: 'Kurkure Masala Munch Crisps', price: 30, originalPrice: 35, weight: '90 g', image: 'https://images.unsplash.com/photo-1613919113640-25732ec5e61f?w=400&q=80', isVeg: true, discount: '14% OFF' }
    ];
  } else if (categoryName.includes('Biscuits') || categoryName.includes('Cakes')) {
    items = [
      { id: 'bisc-1', name: 'Oreo Chocolate Sandwich Cookies', price: 35, originalPrice: 40, weight: '120 g', image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', isVeg: true, discount: '12% OFF' },
      { id: 'bisc-2', name: 'Britannia Good Day Cashew cookies', price: 25, originalPrice: 30, weight: '100 g', image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', isVeg: true, discount: '16% OFF' },
      { id: 'bisc-3', name: 'Sunfeast Dark Fantasy Choco Fills', price: 40, originalPrice: 40, weight: '75 g', image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80', isVeg: true }
    ];
  } else if (categoryName.includes('Frozen') || categoryName.includes('Instant')) {
    items = [
      { id: 'froz-1', name: 'Maggi 2-Minute Masala Noodles Pack', price: 14, originalPrice: 14, weight: '70 g', image: 'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=400&q=80', isVeg: true },
      { id: 'froz-2', name: 'Safal Frozen Green Peas Extra Sweet', price: 95, originalPrice: 110, weight: '500 g', image: 'https://images.unsplash.com/photo-1592417817098-8f3d6eb19675?w=400&q=80', isVeg: true, discount: '13% OFF' },
      { id: 'froz-3', name: 'Knorr Classic Tomato Soup Mix', price: 35, originalPrice: 40, weight: '50 g', image: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=400&q=80', isVeg: true, discount: '12% OFF' }
    ];
  } else if (categoryName.includes('Breakfast')) {
    items = [
      { id: 'break-1', name: 'Kelloggs Corn Flakes Golden Cereal', price: 145, originalPrice: 160, weight: '300 g', image: 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=400&q=80', isVeg: true, discount: '9% OFF' },
      { id: 'break-2', name: 'Quaker Whole Grain Rolled Oats', price: 180, originalPrice: 199, weight: '1 kg', image: 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=400&q=80', isVeg: true, discount: '10% OFF' },
      { id: 'break-3', name: 'Bagrrys Mixed Fruit Muesli Crunchy', price: 210, originalPrice: 240, weight: '400 g', image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80', isVeg: true, discount: '12% OFF' }
    ];
  } else if (categoryName.includes('Drinks') || categoryName.includes('Juices')) {
    items = [
      { id: 'drink-1', name: 'Coca Cola Diet Coke Can Carbonated', price: 40, originalPrice: 40, weight: '300 ml', image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&q=80', isVeg: true },
      { id: 'drink-2', name: 'Tropicana 100% Pure Orange Juice', price: 115, originalPrice: 130, weight: '1 L', image: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=400&q=80', isVeg: true, discount: '11% OFF' },
      { id: 'drink-3', name: 'Red Bull Energy Drink Carbonated', price: 125, originalPrice: 125, weight: '250 ml', image: 'https://images.unsplash.com/photo-1622543956221-1d9c99533a78?w=400&q=80', isVeg: true }
    ];
  } else if (categoryName.includes('Tea') || categoryName.includes('Coffee')) {
    items = [
      { id: 'tea-1', name: 'Nescafe Classic Instant Coffee Jar', price: 310, originalPrice: 340, weight: '100 g', image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&q=80', isVeg: true, discount: '8% OFF' },
      { id: 'tea-2', name: 'Tata Tea Premium Cardamom Flavor', price: 220, originalPrice: 245, weight: '500 g', image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&q=80', isVeg: true, discount: '10% OFF' },
      { id: 'tea-3', name: 'Brooke Bond Red Label Loose Tea', price: 140, originalPrice: 155, weight: '250 g', image: 'https://images.unsplash.com/photo-1594631252845-29fc4cc8cfa9?w=400&q=80', isVeg: true, discount: '9% OFF' }
    ];
  } else if (categoryName.includes('Sweet') || categoryName.includes('Dessert') || categoryName.includes('Indulgences')) {
    items = [
      { id: 'sweet-1', name: 'Cadbury Dairy Milk Silk Chocolate Bar', price: 100, originalPrice: 100, weight: '150 g', image: 'https://images.unsplash.com/photo-1549007994-cb92ca813bec?w=400&q=80', isVeg: true },
      { id: 'sweet-2', name: 'Amul Dark Chocolate Fruit & Nut', price: 125, originalPrice: 140, weight: '150 g', image: 'https://images.unsplash.com/photo-1511381939415-e44015463834?w=400&q=80', isVeg: true, discount: '10% OFF' },
      { id: 'sweet-3', name: 'Ferrero Rocher Hazelnut Pralines', price: 150, originalPrice: 180, weight: '4 pcs', image: 'https://images.unsplash.com/photo-1548907040-4d42b52125ea?w=400&q=80', isVeg: true, discount: '16% OFF' }
    ];
  } else if (categoryName.includes('Gourmet')) {
    items = [
      { id: 'gour-1', name: 'Barilla Penne Rigate Durum Semolina', price: 190, originalPrice: 220, weight: '500 g', image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=400&q=80', isVeg: true, discount: '13% OFF' },
      { id: 'gour-2', name: 'Epigamia Blueberries Greek Yogurt', price: 50, originalPrice: 50, weight: '90 g', image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&q=80', isVeg: true },
      { id: 'gour-3', name: 'Borges Extra Virgin Olive Oil bottle', price: 380, originalPrice: 420, weight: '250 ml', image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80', isVeg: true, discount: '9% OFF' }
    ];
  } else if (categoryName.includes('Hygiene') || categoryName.includes('Health')) {
    items = [
      { id: 'hyg-1', name: 'Dettol Liquid Handwash Refill Pouch', price: 99, originalPrice: 110, weight: '175 ml', image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', isVeg: true, discount: '10% OFF' },
      { id: 'hyg-2', name: 'Savlon Antiseptic Disinfectant Liquid', price: 45, originalPrice: 50, weight: '100 ml', image: 'https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=400&q=80', isVeg: true, discount: '10% OFF' },
      { id: 'hyg-3', name: 'Lifebuoy Total Germ Protection Soap', price: 32, originalPrice: 35, weight: '125 g', image: 'https://images.unsplash.com/photo-1607006342411-9a3363b63b2f?w=400&q=80', isVeg: true, discount: '8% OFF' }
    ];
  } else if (categoryName.includes('Detergents') || categoryName.includes('Cleaning')) {
    items = [
      { id: 'clean-1', name: 'Surf Excel Easy Wash Detergent Powder', price: 140, originalPrice: 160, weight: '1 kg', image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=400&q=80', isVeg: true, discount: '12% OFF' },
      { id: 'clean-2', name: 'Vim Dishwash Gel Lemon Squeeze', price: 55, originalPrice: 60, weight: '250 ml', image: 'https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=400&q=80', isVeg: true, discount: '8% OFF' },
      { id: 'clean-3', name: 'Harpic Disinfectant Toilet Cleaner Gel', price: 95, originalPrice: 105, weight: '500 ml', image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=400&q=80', isVeg: true, discount: '9% OFF' }
    ];
  } else if (categoryName.includes('Bath') || categoryName.includes('Body') || categoryName.includes('Hair')) {
    items = [
      { id: 'bath-1', name: 'Dove Cream Beauty Bath Soap Bar', price: 65, originalPrice: 75, weight: '100 g', image: 'https://images.unsplash.com/photo-1607006342411-9a3363b63b2f?w=400&q=80', isVeg: true, discount: '13% OFF' },
      { id: 'bath-2', name: 'Nivea Soft Light Moisturising Cream', price: 110, originalPrice: 125, weight: '100 ml', image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&q=80', isVeg: true, discount: '12% OFF' },
      { id: 'bath-3', name: 'Head & Shoulders Anti Dandruff Shampoo', price: 175, originalPrice: 195, weight: '180 ml', image: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=400&q=80', isVeg: true, discount: '10% OFF' }
    ];
  } else if (categoryName.includes('Beauty') || categoryName.includes('Skincare')) {
    items = [
      { id: 'beau-1', name: 'Lakme Peach Milk Face Soft Cream', price: 160, originalPrice: 180, weight: '120 g', image: 'https://images.unsplash.com/photo-1556229174-5e42a09e45af?w=400&q=80', isVeg: true, discount: '11% OFF' },
      { id: 'beau-2', name: 'Biotique Morning Nectar Face Wash', price: 140, originalPrice: 165, weight: '150 ml', image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&q=80', isVeg: true, discount: '15% OFF' },
      { id: 'beau-3', name: 'Vaseline Cocoa Glow Body Lotion', price: 99, originalPrice: 120, weight: '100 ml', image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&q=80', isVeg: true, discount: '17% OFF' }
    ];
  } else if (categoryName.includes('Seeds') || categoryName.includes('Dry Fruits')) {
    items = [
      { id: 'seed-1', name: 'Premium Almonds Badam Value Pack', price: 210, originalPrice: 250, weight: '200 g', image: 'https://images.unsplash.com/photo-1606923829579-0ac9c49fb20a?w=400&q=80', isVeg: true, discount: '16% OFF' },
      { id: 'seed-2', name: 'Premium Whole Cashews Kaju pouch', price: 240, originalPrice: 280, weight: '200 g', image: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&q=80', isVeg: true, discount: '14% OFF' },
      { id: 'seed-3', name: 'Organic Raw Salvia Chia Seeds', price: 120, originalPrice: 150, weight: '150 g', image: 'https://images.unsplash.com/photo-1593001874117-1f9dbd6f17bb?w=400&q=80', isVeg: true, discount: '20% OFF' }
    ];
  } else if (categoryName.includes('Salt') || categoryName.includes('Sugar') || categoryName.includes('Jaggery')) {
    items = [
      { id: 'salt-1', name: 'Tata Salt Iodized Table Salt', price: 28, originalPrice: 28, weight: '1 kg', image: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=400&q=80', isVeg: true },
      { id: 'salt-2', name: 'Madhur Sugar Pure Refined Crystals', price: 52, originalPrice: 60, weight: '1 kg', image: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?w=400&q=80', isVeg: true, discount: '13% OFF' },
      { id: 'salt-3', name: 'Organic Jaggery Powder Bellam', price: 65, originalPrice: 80, weight: '500 g', image: 'https://images.unsplash.com/photo-1610970881699-44a5587caaec?w=400&q=80', isVeg: true, discount: '18% OFF' }
    ];
  } else if (categoryName.includes('Organic') || categoryName.includes('Staples')) {
    items = [
      { id: 'org-1', name: 'Organic Unpolished Chana Dal Split', price: 85, originalPrice: 99, weight: '500 g', image: 'https://images.unsplash.com/photo-1545114197-2f5a05b38b1f?w=400&q=80', isVeg: true, discount: '14% OFF' },
      { id: 'org-2', name: 'Organic Cold Pressed Mustard Oil', price: 230, originalPrice: 260, weight: '1 L', image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80', isVeg: true, discount: '11% OFF' },
      { id: 'org-3', name: 'Organic Whole Wheat Atta Chakki', price: 140, originalPrice: 160, weight: '2 kg', image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80', isVeg: true, discount: '12% OFF' }
    ];
  } else if (categoryName.includes('Fruits') || categoryName.includes('Fresh')) {
    items = [
      { id: 'fruit-1', name: 'Fresh Royal Gala Apple Selection', price: 180, originalPrice: 220, weight: '4 pcs', image: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=400&q=80', isVeg: true, discount: '18% OFF' },
      { id: 'fruit-2', name: 'Fresh Banana Robusta Premium', price: 49, originalPrice: 65, weight: '1 kg', image: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&q=80', isVeg: true, discount: '24% OFF' },
      { id: 'fruit-3', name: 'Fresh Orange Kinnow Juicy', price: 89, originalPrice: 119, weight: '6 pcs', image: 'https://images.unsplash.com/photo-1611080626919-7cf5a9dbab5b?w=400&q=80', isVeg: true, discount: '25% OFF' }
    ];
  } else {
    items = [
      { id: `mock-${categoryName}-1`, name: `Organic ${categoryName} Premium Pack`, price: 120, originalPrice: 150, weight: '500 g', image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&q=80', isVeg: true, discount: '20% OFF' },
      { id: `mock-${categoryName}-2`, name: `Fresh ${categoryName} Value Selection`, price: 65, originalPrice: 80, weight: '1 unit', image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&q=80', isVeg: true, discount: '18% OFF' },
      { id: `mock-${categoryName}-3`, name: `Campus Choice ${categoryName}`, price: 45, originalPrice: 50, weight: '250 g', image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&q=80', isVeg: true }
    ];
  }
  return items;
};

const Confetti = () => {
  const particles = Array.from({ length: 12 }); // Reduced from 25 for better performance
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((_, i) => {
        const randomLeft = Math.random() * SW;
        const randomSize = Math.random() * 8 + 6;
        const colors = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#EC4899', '#A855F7'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        
        const yAnim = useRef(new Animated.Value(-20)).current;
        const rotAnim = useRef(new Animated.Value(0)).current;

        useEffect(() => {
          Animated.parallel([
            Animated.timing(yAnim, {
              toValue: 500,
              duration: Math.random() * 2000 + 1500,
              delay: Math.random() * 500,
              useNativeDriver: true,
            }),
            Animated.timing(rotAnim, {
              toValue: 360,
              duration: Math.random() * 2000 + 1500,
              useNativeDriver: true,
            })
          ]).start();
        }, []);

        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: randomLeft,
              width: randomSize,
              height: randomSize,
              backgroundColor: randomColor,
              borderRadius: randomSize / 2,
              transform: [
                { translateY: yAnim },
                { rotate: rotAnim.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) }
              ]
            }}
          />
        );
      })}
    </View>
  );
};

export default function OthersScreen() {
  const { isDark, toggleTheme } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab: string }>();
  const [activeTab, setActiveTab] = useState('food');
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeTab]);

  const { cart, addToCart, updateQuantity } = useCart();
  const [showPromoPopup, setShowPromoPopup] = useState(false);
  const promoShownRef = useRef(false);
  const [activeOilIdx, setActiveOilIdx] = useState(0);
  const [activeCategoryPill, setActiveCategoryPill] = useState('All');
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);

  const [isAdPlaying, setIsAdPlaying] = useState(true);
  const adAnimRotate = useRef(new Animated.Value(0)).current;

  // ── NEW SPIN WHEEL & OFFERS STATES & HANDLERS ──
  const spinAnim = useRef(new Animated.Value(0)).current;
  const [currentRotation, setCurrentRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [wheelResult, setWheelResult] = useState<any | null>(null);
  const [showWheelModal, setShowWheelModal] = useState(false);
  const [spinsLeft, setSpinsLeft] = useState(1);

  const scratchOpacity1 = useRef(new Animated.Value(1)).current;
  const scratchOpacity2 = useRef(new Animated.Value(1)).current;
  const scratchOpacity3 = useRef(new Animated.Value(1)).current;
  
  const [scratchCardsState, setScratchCardsState] = useState([
    { id: 1, title: 'SRM Special 🎁', reward: '₹49 Dry Wash!', code: 'LAUNDRY49', scratched: false, anim: scratchOpacity1 },
    { id: 2, title: 'Midnight Snack 🎁', reward: 'Free Lemon Juice!', code: 'FREEDRINK', scratched: false, anim: scratchOpacity2 },
    { id: 3, title: 'PG Discount 🏠', reward: '₹100 Off Deposit!', code: 'PGESCAPE', scratched: false, anim: scratchOpacity3 }
  ]);

  const [isAdWatching, setIsAdWatching] = useState(false);
  const [adProgress, setAdProgress] = useState(0);
  const [adCompleted, setAdCompleted] = useState(false);
  const [adWatchingTimeLeft, setAdWatchingTimeLeft] = useState(8);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // -- MICRO ANIMATIONS + STAGGERED ENTRANCE SYSTEM --
  const spinBtnScale = useRef(new Animated.Value(1)).current;
  const adPulseScale = useRef(new Animated.Value(1)).current;
  const coinFloatAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0.6)).current;
  const btnScaleAnim = useRef(new Animated.Value(1)).current;
  const [popBtnCode, setPopBtnCode] = useState<string | null>(null);

  // Staggered entrance values (5 major sections)
  const heroEnterO = useRef(new Animated.Value(0)).current;
  const heroEnterY = useRef(new Animated.Value(40)).current;
  const wheelEnterO = useRef(new Animated.Value(0)).current;
  const wheelEnterY = useRef(new Animated.Value(50)).current;
  const wheelScaleIn = useRef(new Animated.Value(0.7)).current;
  const scratchEnterO = useRef(new Animated.Value(0)).current;
  const scratchEnterY = useRef(new Animated.Value(40)).current;
  const adEnterO = useRef(new Animated.Value(0)).current;
  const adEnterY = useRef(new Animated.Value(40)).current;
  const couponsEnterO = useRef(new Animated.Value(0)).current;
  const couponsEnterY = useRef(new Animated.Value(40)).current;

  // Wheel ambient effects
  const rimGlowPulse = useRef(new Animated.Value(0.25)).current;
  const pointerBounce = useRef(new Animated.Value(0)).current;

  // Individual coupon card stagger
  const coupon0Y = useRef(new Animated.Value(30)).current;
  const coupon1Y = useRef(new Animated.Value(30)).current;
  const coupon2Y = useRef(new Animated.Value(30)).current;
  const coupon3Y = useRef(new Animated.Value(30)).current;
  const coupon0O = useRef(new Animated.Value(0)).current;
  const coupon1O = useRef(new Animated.Value(0)).current;
  const coupon2O = useRef(new Animated.Value(0)).current;
  const coupon3O = useRef(new Animated.Value(0)).current;
  const couponAnims = [
    { y: coupon0Y, o: coupon0O },
    { y: coupon1Y, o: coupon1O },
    { y: coupon2Y, o: coupon2O },
    { y: coupon3Y, o: coupon3O },
  ];

  // Fire staggered entrance when promos tab is selected
  useEffect(() => {
    if (activeTab === 'promos') {
      [heroEnterO, wheelEnterO, scratchEnterO, adEnterO, couponsEnterO,
       coupon0O, coupon1O, coupon2O, coupon3O].forEach(a => a.setValue(0));
      heroEnterY.setValue(40); wheelEnterY.setValue(50);
      scratchEnterY.setValue(40); adEnterY.setValue(40); couponsEnterY.setValue(40);
      [coupon0Y, coupon1Y, coupon2Y, coupon3Y].forEach(a => a.setValue(30));
      wheelScaleIn.setValue(0.7);

      const enter = (o: Animated.Value, y: Animated.Value, delay: number, extras: Animated.CompositeAnimation[] = []) =>
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.spring(o, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }),
            Animated.spring(y, { toValue: 0, friction: 7, tension: 50, useNativeDriver: true }),
            ...extras,
          ]),
        ]);

      Animated.stagger(0, [
        enter(heroEnterO, heroEnterY, 100),
        enter(wheelEnterO, wheelEnterY, 250, [
          Animated.spring(wheelScaleIn, { toValue: 1, friction: 6, tension: 35, useNativeDriver: true }),
        ]),
        enter(scratchEnterO, scratchEnterY, 450),
        enter(adEnterO, adEnterY, 600),
        enter(couponsEnterO, couponsEnterY, 750),
        ...couponAnims.map((ca, i) =>
          Animated.sequence([
            Animated.delay(850 + i * 100),
            Animated.parallel([
              Animated.spring(ca.o, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }),
              Animated.spring(ca.y, { toValue: 0, friction: 7, tension: 50, useNativeDriver: true }),
            ]),
          ])
        ),
      ]).start();
    }
  }, [activeTab]);

  // Persistent loop animations — only run when promos tab is active to save CPU
  useEffect(() => {
    if (activeTab !== 'promos') return;
    const loops = [
      Animated.loop(Animated.sequence([
        Animated.timing(spinBtnScale, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(spinBtnScale, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(adPulseScale, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(adPulseScale, { toValue: 1.0, duration: 900, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(coinFloatAnim, { toValue: -4, duration: 1200, useNativeDriver: true }),
        Animated.timing(coinFloatAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1.0, duration: 700, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0.6, duration: 700, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(rimGlowPulse, { toValue: 0.6, duration: 1500, useNativeDriver: true }),
        Animated.timing(rimGlowPulse, { toValue: 0.25, duration: 1500, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(pointerBounce, { toValue: 6, duration: 500, useNativeDriver: true }),
        Animated.timing(pointerBounce, { toValue: 0, duration: 500, useNativeDriver: true }),
      ])),
    ];
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [activeTab]);

  const handleCopyCode = (code: string) => {
    setCopiedCode(code);
    setPopBtnCode(code);
    btnScaleAnim.setValue(0.82);
    Animated.spring(btnScaleAnim, {
      toValue: 1.0,
      friction: 4,
      tension: 40,
      useNativeDriver: true
    }).start();
  };

  const handleSpin = () => {
    if (isSpinning || spinsLeft <= 0) return;

    setIsSpinning(true);
    const winnerIdx = Math.floor(Math.random() * WHEEL_SECTORS.length);
    const sectorAngle = 360 / WHEEL_SECTORS.length;
    const targetSectorAngle = 360 - (winnerIdx * sectorAngle);
    const additionalSpin = 1800; // 5 spins
    const targetRotation = currentRotation + additionalSpin + targetSectorAngle;

    Animated.timing(spinAnim, {
      toValue: targetRotation,
      duration: 4000,
      useNativeDriver: true,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    }).start(() => {
      setIsSpinning(false);
      setCurrentRotation(targetRotation);
      setSpinsLeft(prev => prev - 1);
      
      const winner = WHEEL_SECTORS[winnerIdx];
      setWheelResult(winner.label.includes('Try Again') ? null : winner);
      setShowWheelModal(true);
    });
  };

  const handleScratch = (cardId: number, animValue: Animated.Value) => {
    if (cardId === 3 && !adCompleted) {
      Alert.alert('Card Locked 🔒', 'Please watch the sponsored video ad below to unlock the premium PG Discount scratch card!');
      return;
    }
    setScratchCardsState(prev => prev.map(c => {
      if (c.id === cardId) {
        if (c.scratched) return c;
        Animated.timing(animValue, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true
        }).start(() => {
          setScratchCardsState(current => current.map(item => {
            if (item.id === cardId) {
              return { ...item, scratched: true };
            }
            return item;
          }));
        });
      }
      return c;
    }));
  };

  useEffect(() => {
    let adInterval: ReturnType<typeof setInterval> | null = null;
    if (isAdWatching) {
      adInterval = setInterval(() => {
        setAdProgress(prev => {
          if (prev >= 100) {
            clearInterval(adInterval!);
            setIsAdWatching(false);
            setAdCompleted(true);
            setAdWatchingTimeLeft(0);
            Alert.alert('Reward Claimed! 🎁', 'You earned +30 Zenvy Coins & Free Delivery Coupon code: ADBONUS.');
            return 100;
          }
          const nextProg = prev + (100 / 8);
          setAdWatchingTimeLeft(Math.max(0, Math.ceil(8 - (nextProg / 12.5))));
          return nextProg;
        });
      }, 1000);
    }
    return () => {
      if (adInterval) clearInterval(adInterval);
    };
  }, [isAdWatching]);



  // Countdown timer moved to FlashDealTimer component to prevent whole-screen re-renders

  useEffect(() => {
    let animLoop: Animated.CompositeAnimation | null = null;
    if (isAdPlaying) {
      adAnimRotate.setValue(0);
      animLoop = Animated.loop(
        Animated.timing(adAnimRotate, {
          toValue: 1,
          duration: 6000,
          useNativeDriver: true,
        })
      );
      animLoop.start();
    }
    return () => {
      if (animLoop) {
        animLoop.stop();
      }
    };
  }, [isAdPlaying]);

  const tabContentFade = useRef(new Animated.Value(0)).current;
  const tabContentTranslateY = useRef(new Animated.Value(20)).current;

  // 3D cooking oil animated values
  const oilScale0 = useRef(new Animated.Value(1.05)).current;
  const oilScale1 = useRef(new Animated.Value(0.88)).current;
  const oilScale2 = useRef(new Animated.Value(0.88)).current;

  const oilTrans0 = useRef(new Animated.Value(0)).current;
  const oilTrans1 = useRef(new Animated.Value(SW * 0.16)).current;
  const oilTrans2 = useRef(new Animated.Value(-SW * 0.16)).current;

  const oilRot0 = useRef(new Animated.Value(0)).current;
  const oilRot1 = useRef(new Animated.Value(8)).current;
  const oilRot2 = useRef(new Animated.Value(-8)).current;

  const oilOpacity0 = useRef(new Animated.Value(1)).current;
  const oilOpacity1 = useRef(new Animated.Value(0.8)).current;
  const oilOpacity2 = useRef(new Animated.Value(0.8)).current;

  // Backdrop & Sheet Animations
  const catalogBackdropAnim = useRef(new Animated.Value(0)).current;
  const catalogSheetAnim = useRef(new Animated.Value(600)).current;

  // Floating Cart Status Bar Animation
  const cartBarAnim = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    tabContentFade.setValue(0);
    tabContentTranslateY.setValue(20);
    Animated.parallel([
      Animated.timing(tabContentFade, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(tabContentTranslateY, {
        toValue: 0,
        friction: 8,
        tension: 45,
        useNativeDriver: true,
      })
    ]).start();
  }, [activeTab]);

  // 3D Oils stack animation trigger
  useEffect(() => {
    const anims = [
      { scale: oilScale0, trans: oilTrans0, rot: oilRot0, opacity: oilOpacity0 },
      { scale: oilScale1, trans: oilTrans1, rot: oilRot1, opacity: oilOpacity1 },
      { scale: oilScale2, trans: oilTrans2, rot: oilRot2, opacity: oilOpacity2 },
    ];

    anims.forEach((anim, idx) => {
      let targetScale = 0.88;
      let targetTrans = 0;
      let targetRot = 0;
      let targetOpacity = 0.8;

      if (idx === activeOilIdx) {
        targetScale = 1.05;
        targetTrans = 0;
        targetRot = 0;
        targetOpacity = 1;
      } else if (idx === (activeOilIdx - 1 + 3) % 3) {
        targetScale = 0.88;
        targetTrans = -SW * 0.16;
        targetRot = -8;
        targetOpacity = 0.8;
      } else {
        targetScale = 0.88;
        targetTrans = SW * 0.16;
        targetRot = 8;
        targetOpacity = 0.8;
      }

      Animated.parallel([
        Animated.spring(anim.scale, { toValue: targetScale, useNativeDriver: true, friction: 8, tension: 40 }),
        Animated.spring(anim.trans, { toValue: targetTrans, useNativeDriver: true, friction: 8, tension: 40 }),
        Animated.spring(anim.rot, { toValue: targetRot, useNativeDriver: true, friction: 8, tension: 40 }),
        Animated.spring(anim.opacity, { toValue: targetOpacity, useNativeDriver: true, friction: 8, tension: 40 }),
      ]).start();
    });
  }, [activeOilIdx]);

  // Bottom Sheet animation trigger
  useEffect(() => {
    if (selectedCategoryName !== null) {
      catalogBackdropAnim.setValue(0);
      catalogSheetAnim.setValue(600);
      Animated.parallel([
        Animated.timing(catalogBackdropAnim, {
          toValue: 0.65,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(catalogSheetAnim, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [selectedCategoryName]);

  const closeCatalogSheet = () => {
    Animated.parallel([
      Animated.timing(catalogBackdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(catalogSheetAnim, {
        toValue: 600,
        duration: 200,
        useNativeDriver: true,
      })
    ]).start(() => {
      setSelectedCategoryName(null);
    });
  };

  const hasGroceryItems = cart.some(item => item.restaurantId === 'mega-basket-vendor');
  const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Floating Cart Bar animation trigger
  useEffect(() => {
    if (hasGroceryItems && activeTab === 'food') {
      Animated.spring(cartBarAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(cartBarAnim, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [hasGroceryItems, activeTab, cartCount]);

  useEffect(() => {
    if (tab === 'pg' || tab === 'coride' || tab === 'food' || tab === 'promos') {
      setActiveTab(tab);
    }
  }, [tab]);

  const [promoIdx, setPromoIdx] = useState(0);
  const [searchPH, setSearchPH] = useState(SEARCH_PLACEHOLDERS[0]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Global search text
  const [searchQuery, setSearchQuery] = useState('');

  // ── PG States ──
  const [pgs, setPgs] = useState<any[]>([]);
  const [loadingPgs, setLoadingPgs] = useState(false);
  const [genderFilter, setGenderFilter] = useState('All'); // 'All', 'Boys', 'Girls', 'Co-ed'
  const [budgetFilter, setBudgetFilter] = useState('All'); // 'All', '5000', '8000', '10000', '15000'
  const [distanceFilter, setDistanceFilter] = useState('All'); // 'All', '1', '3', '5', '10'

  // ── Co-Ride States ──
  const [corideTab, setCorideTab] = useState<'browse' | 'my-rides'>('browse');
  const [rides, setRides] = useState<any[]>([]);
  const [myRides, setMyRides] = useState<any[]>([]);
  const [loadingRides, setLoadingRides] = useState(false);
  const [loadingMyRides, setLoadingMyRides] = useState(false);
  
  // Co-Ride Filter States
  const [vehicleFilter, setVehicleFilter] = useState<'All' | 'Bike' | 'Car' | 'Auto'>('All');
  const [vibeFilter, setVibeFilter] = useState<'Any' | 'Silent Ride 🤫' | 'Chatty 💬' | 'Music Lover 🎵'>('Any');

  // Co-Ride Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatorRole, setCreatorRole] = useState<'rider' | 'passenger'>('rider');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [vehicleType, setVehicleType] = useState('Bike');
  const [availableSeats, setAvailableSeats] = useState('1');
  const [rideVibe, setRideVibe] = useState('Any');
  const [estimatedFuelCost, setEstimatedFuelCost] = useState('0');
  const [notes, setNotes] = useState('');
  const [submittingRide, setSubmittingRide] = useState(false);

  // Auto-rotate Promos
  useEffect(() => {
    const iv = setInterval(() => setPromoIdx(p => (p + 1) % PROMOS.length), 3000);
    return () => clearInterval(iv);
  }, []);

  // Auto-rotate Search Placeholder
  useEffect(() => {
    let i = 0;
    const iv = setInterval(() => { i = (i + 1) % SEARCH_PLACEHOLDERS.length; setSearchPH(SEARCH_PLACEHOLDERS[i]); }, 2500);
    return () => clearInterval(iv);
  }, []);

  // Load PG lists
  const fetchPGs = useCallback(async () => {
    setLoadingPgs(true);
    try {
      const res = await apiFetch(ENDPOINTS.pgList);
      if (res.ok) {
        const data = await res.json();
        setPgs(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingPgs(false);
    }
  }, []);

  // Load Co-Ride lists
  const fetchRides = useCallback(async () => {
    setLoadingRides(true);
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolPosts);
      if (res.ok) {
        const data = await res.json();
        setRides(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingRides(false);
    }
  }, []);

  // Load User commutes
  const fetchMyRides = useCallback(async () => {
    setLoadingMyRides(true);
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolMyRides);
      if (res.ok) {
        const data = await res.json();
        setMyRides(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMyRides(false);
    }
  }, []);

  // Fetch when tab switches
  useEffect(() => {
    if (activeTab === 'pg') {
      fetchPGs();
    } else if (activeTab === 'coride') {
      fetchRides();
      fetchMyRides();
    }
  }, [activeTab, fetchPGs, fetchRides, fetchMyRides]);

  // PG Filters
  const filteredPGs = pgs.filter(item => {
    // Search query match
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesName = (item.name || '').toLowerCase().includes(q);
      const matchesAddr = (item.address || '').toLowerCase().includes(q);
      if (!matchesName && !matchesAddr) return false;
    }
    // Gender type match
    if (genderFilter !== 'All') {
      if (item.genderType !== genderFilter) return false;
    }
    // Budget limit match (baseRent <= budget)
    if (budgetFilter !== 'All') {
      const maxBudget = parseInt(budgetFilter, 10);
      if (item.baseRent > maxBudget) return false;
    }
    // Distance limit match (distanceFromCollege <= distance)
    if (distanceFilter !== 'All') {
      const maxDistance = parseFloat(distanceFilter);
      if (item.distanceFromCollege > maxDistance) return false;
    }
    return true;
  });

  // Co-Ride actions
  const handleJoinRide = async (rideId: string) => {
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolJoin(rideId), { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Joined Success', data.message || 'Joined successfully!');
        fetchRides();
        fetchMyRides();
      } else {
        Alert.alert('Failed', data.message || 'Unable to join ride.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network error joining ride.');
    }
  };

  const handleCompleteRide = async (rideId: string) => {
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolComplete(rideId), { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Ride Completed', data.message || 'Earned +50 Karma Points! split invoice processed.');
        fetchRides();
        fetchMyRides();
      } else {
        Alert.alert('Failed', data.message || 'Unable to complete ride.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network error completing ride.');
    }
  };

  const handleCancelRide = async (rideId: string) => {
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolCancel(rideId), { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Cancelled', data.message || 'Ride status updated.');
        fetchRides();
        fetchMyRides();
      } else {
        Alert.alert('Failed', data.message || 'Unable to cancel ride.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network error cancelling ride.');
    }
  };

  const handleCreateRide = async () => {
    if (!origin || !destination || !departureTime) {
      Alert.alert('Missing Fields', 'Please fill Origin, Destination, and Departure Time.');
      return;
    }

    setSubmittingRide(true);
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolPosts, {
        method: 'POST',
        body: JSON.stringify({
          creatorRole,
          origin,
          destination,
          departureTime: new Date(departureTime).toISOString(),
          vehicleType,
          availableSeats: parseInt(availableSeats, 10) || 1,
          rideVibe,
          estimatedFuelCost: parseFloat(estimatedFuelCost) || 0,
          notes,
          autoApprove: true
        })
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', 'Ride posted successfully!');
        setShowCreateModal(false);
        // Reset Form
        setOrigin('');
        setDestination('');
        setDepartureTime('');
        setEstimatedFuelCost('0');
        setNotes('');
        fetchRides();
        fetchMyRides();
      } else {
        Alert.alert('Failed', data.message || 'Unable to post ride.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network error creating ride.');
    } finally {
      setSubmittingRide(false);
    }
  };

  // Filter available ride posts
  const filteredRides = rides.filter(ride => {
    if (vehicleFilter !== 'All' && ride.vehicleType !== vehicleFilter) return false;
    if (vibeFilter !== 'Any' && ride.rideVibe !== vibeFilter) return false;
    return true;
  });

  const cardBg = isDark ? 'rgba(255, 255, 255, 0.08)' : COLORS.bgLightCard;
  const cardSurface = isDark ? '#1D1D20' : '#FFFFFF';
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? 'rgba(255, 255, 255, 0.18)' : '#E2E8F0';
  const bgColors: [string, string] = isDark ? ['#0B0B0D', '#161618'] : [COLORS.bgLight, '#EFEFEF'];

  const goldColor = isDark ? COLORS.gold : COLORS.red;
  const goldBorderColor = isDark ? COLORS.goldBorder : 'rgba(239, 79, 95, 0.4)';
  const goldMutedColor = isDark ? COLORS.goldMuted : 'rgba(239, 79, 95, 0.15)';
  const goldGlowShadow = isDark ? SHADOWS.goldGlow : SHADOWS.redGlow;
  const accentGradient: [string, string] = isDark ? ['#C9A84C', '#E4C875'] : ['#EF4F5F', '#D43F4F'];

  const carouselOffers = PROMOS.map(p => ({
    id: p.id,
    imageUrl: p.img,
    tagline: p.tagline,
    title1: p.title,
    title2: p.subtitle,
    description: p.desc,
    buttonText: p.btn.replace(' →', ''),
    redirectAction: () => {
      if (p.id === '1') {
        router.push('/category/stationary' as any);
      } else if (p.id === '2') {
        router.push('/category/gym' as any);
      } else if (p.id === '3') {
        router.push('/category/rentals' as any);
      }
    }
  }));

  return (
    <View style={s.container}>
      <AmbientBackground />
      {activeTab === 'food' ? (
        <View style={[s.bbHeader, { backgroundColor: isDark ? '#1C1917' : '#FEF9E7' }]}>
          {/* Top Row: Clock slot & Home location & profile bubble */}
          <View style={s.bbHeaderTop}>
            <View style={s.bbHeaderLeft}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 11 }}>⏰</Text>
                <Text style={{ fontSize: 9, color: txtSec, fontWeight: '700' }}>Next slot in</Text>
                <Text style={{ fontSize: 11, fontWeight: '900', color: txt }}> 11 hrs</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <Text style={{ fontSize: 11 }}>📍</Text>
                <Text style={{ fontSize: 11, fontWeight: '900', color: txt, maxWidth: SW * 0.65 }} numberOfLines={1}>
                  Home - SRM University ap, SRM Universit...
                </Text>
                <Text style={{ fontSize: 8, color: txtSec }}> ▼</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActionPressable style={[s.navBtn, { backgroundColor: cardBg, width: 34, height: 34 }]} onPress={toggleTheme}>
                <Text style={{ fontSize: 14 }}>{isDark ? '☀️' : '🌙'}</Text>
              </ActionPressable>
              <TouchableOpacity 
                style={s.bbProfileBtn}
                onPress={() => router.push('/(tabs)/profile')}
              >
                <Image 
                  source={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&q=80' }} 
                  style={s.bbProfileImg} 
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Second Row: Search bar + Separate Shortcuts Pill */}
          <View style={s.bbHeaderSearchRow}>
            <CardPressable 
              style={[s.bbSearchBar, { backgroundColor: cardSurface, borderColor: border }]} 
              onPress={() => setIsSearchOpen(true)}
              tilt={false}
            >
              <Text style={{ fontSize: 14, color: '#F97316' }}>🔍 </Text>
              <TextInput 
                style={[s.bbSearchInput, { color: txt }]} 
                placeholder={searchPH} 
                placeholderTextColor={txtSec} 
                editable={false} 
                pointerEvents="none"
              />
              <TouchableOpacity style={{ padding: 4 }}><Text style={{ fontSize: 14 }}>🎁</Text></TouchableOpacity>
            </CardPressable>

            <View style={[s.bbShortcutsPill, { backgroundColor: cardSurface, borderColor: border }]}>
              <TouchableOpacity style={s.bbShortcutBtn} onPress={() => Alert.alert('Wishlist', 'Your saved/favorite items will appear here.')}><Text style={{ fontSize: 14 }}>❤️</Text></TouchableOpacity>
              <View style={{ width: 1, height: 14, backgroundColor: border }} />
              <TouchableOpacity style={s.bbShortcutBtn} onPress={() => Alert.alert('Notifications', 'No new campus announcements.')}><Text style={{ fontSize: 14 }}>🔔</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <>
          {/* ── NAVBAR ── */}
          <View style={s.nav}>
            <View>
              <Text style={[s.loc, { color: txtSec }]}>📍 AMARAVATHI, AP</Text>
              <Text style={[s.greeting, { color: txt }]}>HEY, {(user?.name || 'SANYA').split(' ')[0].toUpperCase()} 👋</Text>
            </View>
            <View style={s.navRight}>
              <ActionPressable style={[s.navBtn, { backgroundColor: cardBg }]} onPress={toggleTheme}>
                <Text style={{ fontSize: 18 }}>{isDark ? '☀️' : '🌙'}</Text>
              </ActionPressable>
              <ActionPressable style={[s.navBtn, { backgroundColor: cardBg }]} onPress={() => router.push('/(tabs)/profile')}>
                <Text style={{ fontSize: 18 }}>🛍️</Text>
              </ActionPressable>
            </View>
          </View>

          {/* ── HERO HEADER ── */}
          <View style={s.heroHeader}>
            <View style={s.ecoBadgeWrapper}>
              <LinearGradient
                colors={accentGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.ecoBadgeGradient}
              >
                <Text style={s.ecoBadgeText}>ECOSYSTEM</Text>
              </LinearGradient>
            </View>
            <Text style={[s.heroTitle, { color: txt }]}>Explore More</Text>
            <View style={[s.underline, { backgroundColor: goldColor }]} />
          </View>
        </>
      )}

      {/* ── TAB SELECTOR ── */}
      <View style={[s.tabRow, { backgroundColor: cardBg, borderColor: border }]}>
        {TABS.map(t => {
          const isActive = activeTab === t.key;
          return (
            <DopaminePressable 
              key={t.key} 
              style={[s.tabBtn, isActive && s.tabBtnActive]} 
              onPress={() => setActiveTab(t.key)}
              sound="tabSwitch"
              activeScale={0.96}
            >
              {isActive ? (
                <LinearGradient
                  colors={accentGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.tabBtnActiveGradient}
                >
                  <Text style={[s.tabLabel, { color: '#000', fontWeight: '900' }]}>{t.label}</Text>
                </LinearGradient>
              ) : (
                <Text style={[s.tabLabel, { color: txtSec, paddingVertical: 12 }]}>{t.label}</Text>
              )}
            </DopaminePressable>
          );
        })}
      </View>

      <Animated.View style={{ opacity: tabContentFade, transform: [{ translateY: tabContentTranslateY }], flex: 1 }}>
        <ScrollView ref={scrollViewRef} showsVerticalScrollIndicator={false}>
          {/* ── HERO CAROUSEL CARD ── */}
          <View style={[s.heroCarouselCard, { borderColor: border }]}>
            <PromoCarousel offers={carouselOffers} containerStyle={s.heroCarousel} />
          </View>

        {/* ── FOOD / MEGA BASKET TAB ── */}
        {activeTab === 'food' && (
          <View>
            {/* ── LIMITED-TIME FLASH DEALS TICKER ── */}
            <View style={[s.flashDealContainer, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', marginTop: 12 }]}>
              <LinearGradient
                colors={['#EF4444', '#DC2626']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.flashBadge}
              >
                <Text style={s.flashBadgeText}>⚡ FLASH DEAL</Text>
              </LinearGradient>
              <View style={{ flex: 1, paddingLeft: 8 }}>
                <Text style={s.flashDealTitle} numberOfLines={1}>Cadbury Dairy Milk Silk at 50% OFF!</Text>
                <Text style={s.flashDealTimerLabel}>Ends in: <FlashDealTimer /></Text>
              </View>
              <TouchableOpacity 
                style={s.flashDealCta}
                onPress={() => setSelectedCategoryName('Cadbury')}
              >
                <Text style={s.flashDealCtaText}>GRAB NOW ➔</Text>
              </TouchableOpacity>
            </View>

            {/* Space spacer */}
            <View style={{ height: 4 }} />

            {/* ── CATEGORY PILLS HORIZONTAL SCROLL ── */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 16 }}>
              {[
                { label: 'All', icon: '🍽️' },
                { label: 'Fresh', icon: '🍎' },
                { label: 'Grocery', icon: '🛒' },
                { label: 'Electronics', icon: '🔌' },
                { label: 'Organic', icon: '🌱' },
                { label: 'Health', icon: '🥗' },
                { label: 'Deals', icon: '🏷️' },
                { label: 'Gifting', icon: '🎁' }
              ].map(pill => {
                const isActive = activeCategoryPill === pill.label;
                return (
                  <DopaminePressable
                    key={pill.label}
                    style={[s.pillBtn, isActive && s.pillBtnActive, { borderColor: border, backgroundColor: isActive ? '#DCFCE7' : cardBg }]}
                    onPress={() => {
                      setActiveCategoryPill(pill.label);
                      setSelectedCategoryName(pill.label === 'All' ? 'Grocery' : pill.label);
                    }}
                    activeScale={0.94}
                    sound="click"
                  >
                    <Text style={{ fontSize: 14, marginRight: 4 }}>{pill.icon}</Text>
                    <Text style={[s.pillText, { color: isActive ? '#15803D' : txt }]}>{pill.label}</Text>
                  </DopaminePressable>
                );
              })}
            </ScrollView>

            {/* ── BRAND SPOTLIGHT (SPONSORED BRANDS) ── */}
            <View style={{ marginBottom: 20 }}>
              <View style={{ paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={[s.sectionTitle, { color: txt, marginVertical: 0, paddingLeft: 0 }]}>BRAND SPOTLIGHT</Text>
                <Text style={{ fontSize: 8, fontWeight: '900', color: txtSec, letterSpacing: 1 }}>SPONSORED</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 14 }}
              >
                {[
                  {
                    name: 'Amul',
                    img: require('../../assets/amul_poster.png'),
                    border: '#B45309'
                  },
                  {
                    name: 'Surf Excel',
                    img: require('../../assets/surf_excel_poster.png'),
                    border: '#2563EB'
                  },
                  {
                    name: 'Nescafe',
                    img: require('../../assets/nescafe_poster.png'),
                    border: '#78350F'
                  },
                  {
                    name: 'Lays',
                    img: require('../../assets/lays_poster.png'),
                    border: '#374151'
                  }
                ].map((brand, idx) => (
                  <DopaminePressable
                    key={idx}
                    style={{
                      width: 154,
                      height: 254,
                      borderRadius: 22,
                      borderWidth: 1.5,
                      borderColor: brand.border,
                      overflow: 'hidden',
                      position: 'relative'
                    }}
                    onPress={() => setSelectedCategoryName(brand.name)}
                    activeScale={0.96}
                    sound="click"
                  >
                    <Image
                      source={brand.img}
                      style={{
                        width: '100%',
                        height: '100%',
                        resizeMode: 'cover'
                      }}
                    />
                  </DopaminePressable>
                ))}
              </ScrollView>
            </View>

            {/* ── MONSOON STORE PROMO HEADER BANNER ── */}
            <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
              <LinearGradient
                colors={['#115E59', '#134E4A']}
                style={s.monsoonStoreBanner}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.monsoonBannerSubtitle}>YOUR FIRST BASKET COMES WITH PERKS</Text>
                  <Text style={s.monsoonBannerTitle}>MONSOON STORE ⛈️</Text>
                  <Text style={s.monsoonBannerDesc}>Save extra 5% on every basket, pay with Tata Neu Credit Card</Text>
                </View>
                <View style={s.frogMascotContainer}>
                  <Text style={{ fontSize: 48 }}>🛍️</Text>
                </View>
              </LinearGradient>
            </View>

            {/* ── TOYS STARTING @ 49 ── */}
            <View style={{ marginTop: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
                <View>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: txt }}>Toys starting @ 49</Text>
                  <Text style={{ fontSize: 10, color: txtSec, marginTop: 1 }}>Shop now & save big</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedCategoryName('Vehicle toys')} style={s.wellnessSeeAll}>
                  <Text style={{ fontSize: 14, color: txtSec }}>›</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
                {TOY_ITEMS.map(product => {
                  const inCart = cart.find(i => i.id === product.id);
                  const quantity = inCart ? inCart.quantity : 0;
                  return (
                    <View key={product.id} style={[s.bbProductCard, { backgroundColor: cardSurface, borderColor: border }]}>
                      <View style={s.bbProductCardImgWrap}>
                        <TouchableOpacity style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} onPress={() => router.push(`/products/${product.id}` as any)}>
                          <Image source={{ uri: product.image }} style={s.bbProductCardImg} />
                        </TouchableOpacity>
                        
                        {product.discount && (
                          <View style={[s.bbDiscountTag, { position: 'absolute', top: 6, left: 6, backgroundColor: '#FCD34D' }]}>
                            <Text style={[s.bbDiscountTagText, { color: '#78350F' }]}>{product.discount}</Text>
                          </View>
                        )}
                        
                        <TouchableOpacity style={s.bbWishlistBtn}>
                          <Text style={{ fontSize: 13, color: '#999' }}>⭐</Text>
                        </TouchableOpacity>

                        <View style={s.bbAddBtnOverlapping}>
                          {quantity > 0 ? (
                            <View style={s.bbStepperOverlapping}>
                              <TouchableOpacity
                                style={s.bbStepperBtnMini}
                                onPress={() => {
                                  const cartKey = cart.find(i => i.id === product.id)?.cartKey || product.id;
                                  updateQuantity(cartKey, quantity - 1);
                                }}
                              >
                                <Text style={s.bbStepperBtnTextMini}>-</Text>
                              </TouchableOpacity>
                              <Text style={s.bbStepperQtyMini}>{quantity}</Text>
                              <TouchableOpacity
                                style={s.bbStepperBtnMini}
                                onPress={() => {
                                  addToCart({
                                    id: product.id,
                                    name: product.name,
                                    price: product.price,
                                    image: product.image,
                                    restaurantId: 'mega-basket-vendor',
                                    restaurantName: 'Mega Basket Grocery'
                                  });
                                }}
                              >
                                <Text style={s.bbStepperBtnTextMini}>+</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={s.bbAddBtnSquare}
                              onPress={() => {
                                addToCart({
                                  id: product.id,
                                  name: product.name,
                                  price: product.price,
                                  image: product.image,
                                  restaurantId: 'mega-basket-vendor',
                                  restaurantName: 'Mega Basket Grocery'
                                });
                              }}
                            >
                              <Text style={s.bbAddBtnPlus}>+</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      <TouchableOpacity onPress={() => router.push(`/products/${product.id}` as any)}>
                        <Text style={{ fontSize: 7.5, fontWeight: '900', color: txtSec, textTransform: 'uppercase', marginBottom: 2 }}>{product.brand}</Text>
                        <Text style={[s.bbProductCardName, { color: txt, height: 26 }]} numberOfLines={2}>
                          {product.name}
                        </Text>
                        
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                          <Text style={s.bbProductCardWeight}>{product.weight}</Text>
                          <Text style={{ fontSize: 8, color: '#999', marginLeft: 2 }}> ▽</Text>
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <Text style={[s.bbProductCardPrice, { color: txt }]}>₹{product.price}</Text>
                          {product.originalPrice > product.price && (
                            <Text style={s.bbProductCardOrigPrice}>₹{product.originalPrice}</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {/* ── TOYS & SPORTS MANIA GRID (PREMIUM) ── */}
            <View style={{ paddingHorizontal: 16, marginTop: 20, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <Text style={{ fontSize: 17, fontWeight: '900', color: txt, letterSpacing: 0.3 }}>Toys & Sports Mania</Text>
                <View style={{ marginLeft: 8, backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                  <Text style={{ fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 1 }}>HOT</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {TOY_MANIA_CATEGORIES.map((item, idx) => (
                  <ScalePressable
                    key={idx}
                    onPress={() => setSelectedCategoryName(item.title)}
                    style={{
                      width: (SW - 32 - 10) / 2,
                    }}
                  >
                    <View style={{
                      width: '100%',
                      height: 130,
                      borderRadius: 18,
                      overflow: 'hidden',
                      position: 'relative',
                    }}>
                      <Image
                        source={{ uri: item.image }}
                        style={{
                          width: '100%',
                          height: '100%',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                        }}
                        resizeMode="cover"
                      />
                      <LinearGradient
                        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.6)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={{
                          position: 'absolute',
                          top: 0, left: 0, right: 0, bottom: 0,
                          justifyContent: 'space-between',
                          padding: 12,
                        }}
                      >
                        <View>
                          <Text style={{
                            fontSize: 14,
                            fontWeight: '900',
                            color: '#fff',
                            textShadowColor: 'rgba(0,0,0,0.5)',
                            textShadowOffset: { width: 0, height: 1 },
                            textShadowRadius: 3,
                          }} numberOfLines={2}>
                            {item.title}
                          </Text>
                        </View>
                        <View style={{
                          backgroundColor: item.badgeBg,
                          alignSelf: 'flex-start',
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 10,
                          shadowColor: item.badgeBg,
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.5,
                          shadowRadius: 6,
                          elevation: 4,
                        }}>
                          <Text style={{
                            fontSize: 8,
                            fontWeight: '900',
                            color: '#fff',
                            letterSpacing: 0.8,
                          }}>
                            {item.badge}
                          </Text>
                        </View>
                      </LinearGradient>
                    </View>
                  </ScalePressable>
                ))}
              </View>
            </View>

            {/* ── BRING HOME FRESH GREENS ── */}
            <View style={{ marginTop: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
                <View>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: txt }}>Bring home fresh greens</Text>
                  <Text style={{ fontSize: 10, color: txtSec, marginTop: 1 }}>Grow your happy place</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedCategoryName('Seeds')} style={s.wellnessSeeAll}>
                  <Text style={{ fontSize: 14, color: txtSec }}>›</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
                {SEED_ITEMS.map(product => {
                  const inCart = cart.find(i => i.id === product.id);
                  const quantity = inCart ? inCart.quantity : 0;
                  return (
                    <View key={product.id} style={[s.bbProductCard, { backgroundColor: cardSurface, borderColor: border }]}>
                      <View style={s.bbProductCardImgWrap}>
                        <TouchableOpacity style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} onPress={() => router.push(`/products/${product.id}` as any)}>
                          <Image source={{ uri: product.image }} style={s.bbProductCardImg} />
                        </TouchableOpacity>
                        
                        {product.discount && (
                          <View style={[s.bbDiscountTag, { position: 'absolute', top: 6, left: 6, backgroundColor: '#FCD34D' }]}>
                            <Text style={[s.bbDiscountTagText, { color: '#78350F' }]}>{product.discount}</Text>
                          </View>
                        )}
                        
                        <TouchableOpacity style={s.bbWishlistBtn}>
                          <Text style={{ fontSize: 13, color: '#999' }}>⭐</Text>
                        </TouchableOpacity>

                        <View style={s.bbAddBtnOverlapping}>
                          {quantity > 0 ? (
                            <View style={s.bbStepperOverlapping}>
                              <TouchableOpacity
                                style={s.bbStepperBtnMini}
                                onPress={() => {
                                  const cartKey = cart.find(i => i.id === product.id)?.cartKey || product.id;
                                  updateQuantity(cartKey, quantity - 1);
                                }}
                              >
                                <Text style={s.bbStepperBtnTextMini}>-</Text>
                              </TouchableOpacity>
                              <Text style={s.bbStepperQtyMini}>{quantity}</Text>
                              <TouchableOpacity
                                style={s.bbStepperBtnMini}
                                onPress={() => {
                                  addToCart({
                                    id: product.id,
                                    name: product.name,
                                    price: product.price,
                                    image: product.image,
                                    restaurantId: 'mega-basket-vendor',
                                    restaurantName: 'Mega Basket Grocery'
                                  });
                                }}
                              >
                                <Text style={s.bbStepperBtnTextMini}>+</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={s.bbAddBtnSquare}
                              onPress={() => {
                                addToCart({
                                  id: product.id,
                                  name: product.name,
                                  price: product.price,
                                  image: product.image,
                                  restaurantId: 'mega-basket-vendor',
                                  restaurantName: 'Mega Basket Grocery'
                                });
                              }}
                            >
                              <Text style={s.bbAddBtnPlus}>+</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      <TouchableOpacity onPress={() => router.push(`/products/${product.id}` as any)}>
                        <Text style={{ fontSize: 7.5, fontWeight: '900', color: txtSec, textTransform: 'uppercase', marginBottom: 2 }}>{product.brand}</Text>
                        <Text style={[s.bbProductCardName, { color: txt, height: 26 }]} numberOfLines={2}>
                          {product.name}
                        </Text>
                        
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                          <Text style={s.bbProductCardWeight}>{product.weight}</Text>
                          <Text style={{ fontSize: 8, color: '#999', marginLeft: 2 }}> ▽</Text>
                        </View>

                        {/* Special Flash Sale tag in purple */}
                        {product.flashSale && (
                          <View style={{ backgroundColor: '#FAF5FF', borderColor: '#E9D5FF', borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, alignSelf: 'flex-start', marginTop: 2 }}>
                            <Text style={{ fontSize: 6.5, fontWeight: '900', color: '#6B21A8' }}>⚡ Flash Sale</Text>
                          </View>
                        )}

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <Text style={[s.bbProductCardPrice, { color: txt }]}>₹{product.price}</Text>
                          {product.originalPrice > product.price && (
                            <Text style={s.bbProductCardOrigPrice}>₹{product.originalPrice}</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {/* ── BEST DEALS DIVIDER ── */}
            <View style={{ marginHorizontal: 16, marginVertical: 16, height: 38, borderRadius: 10, backgroundColor: isDark ? '#27272A' : '#EFF6FF', borderStyle: 'dashed', borderWidth: 1, borderColor: isDark ? '#3F3F46' : '#BFDBFE', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14 }}>🏷️</Text>
              <Text style={{ fontSize: 10, fontWeight: '900', color: isDark ? '#93C5FD' : '#1D4ED8', letterSpacing: 1.5 }}>BEST DEALS</Text>
            </View>

            {/* ── COOKING OILS & GHEE (PREMIUM GRID) ── */}
            <View style={{ paddingHorizontal: 16, marginTop: 20, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 17, fontWeight: '900', color: txt, letterSpacing: 0.3 }}>Cooking Oils & Ghee</Text>
                  <View style={{ marginLeft: 8, backgroundColor: '#CA8A04', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ fontSize: 7, fontWeight: '900', color: '#fff', letterSpacing: 1 }}>PURE</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setSelectedCategoryName('Edible Oils & Ghee')}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#16A34A' }}>See all ›</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {[
                  { title: 'Blended Oils', img: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80' },
                  { title: 'Cold Pressed', img: 'https://images.unsplash.com/photo-1620706857370-e1b9770e8bb1?w=400&q=80' },
                  { title: 'Pure Cow Ghee', img: 'https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?w=400&q=80' },
                  { title: 'Organic Ghee', img: 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400&q=80' },
                ].map((item, idx) => (
                  <ScalePressable
                    key={idx}
                    onPress={() => setSelectedCategoryName('Edible Oils & Ghee')}
                    style={{ width: (SW - 32 - 10) / 2 }}
                  >
                    <View style={{
                      width: '100%',
                      height: 120,
                      borderRadius: 16,
                      overflow: 'hidden',
                      position: 'relative',
                    }}>
                      <Image
                        source={{ uri: item.img }}
                        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
                        resizeMode="cover"
                      />
                      <LinearGradient
                        colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.7)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={{
                          position: 'absolute',
                          top: 0, left: 0, right: 0, bottom: 0,
                          justifyContent: 'flex-end',
                          padding: 10,
                        }}
                      >
                        <Text style={{
                          fontSize: 13,
                          fontWeight: '900',
                          color: '#fff',
                          textShadowColor: 'rgba(0,0,0,0.6)',
                          textShadowOffset: { width: 0, height: 1 },
                          textShadowRadius: 4,
                        }}>
                          {item.title}
                        </Text>
                      </LinearGradient>
                    </View>
                  </ScalePressable>
                ))}
              </View>
            </View>

            {/* ── BETTER HEALTH STARTS HERE ── */}
            <Text style={[s.sectionTitle, { color: txt, marginTop: 24, paddingLeft: 16 }]}>Better health starts here</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12, marginBottom: 24 }}>
              {[
                { name: 'Fit & active', img: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=200&q=80' },
                { name: 'Low-sugar choices', img: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=200&q=80' },
                { name: 'Weight management', img: 'https://images.unsplash.com/photo-1550617931-e17a7b70dce2?w=200&q=80' },
                { name: 'Plant-based & vegan', img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&q=80' },
                { name: 'Ayurveda', img: 'https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=200&q=80' }
              ].map((h, idx) => (
                <TouchableOpacity 
                  key={idx} 
                  style={{ width: (SW - 32 - 24) / 3, alignItems: 'center', marginBottom: 12 }} 
                  onPress={() => setSelectedCategoryName(h.name)}
                >
                  <View style={{ width: '100%', height: 90, borderRadius: 16, backgroundColor: '#E6F4EA', overflow: 'hidden', justifyContent: 'flex-end', position: 'relative', borderWidth: 1, borderColor: border }}>
                    <View style={{ position: 'absolute', top: 20, left: 10, right: 10, bottom: 0, borderTopLeftRadius: 36, borderTopRightRadius: 36, backgroundColor: '#10B981', opacity: 0.7 }} />
                    <Image source={{ uri: h.img }} style={{ width: '75%', height: '80%', resizeMode: 'cover', alignSelf: 'center', borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }} />
                  </View>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: txt, textAlign: 'center', marginTop: 6 }} numberOfLines={2}>{h.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── MONSOON WELLNESS PICKS ── */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 16 }}>
              <Text style={[s.sectionTitle, { color: txt, flex: 1 }]}>Monsoon wellness picks</Text>
              <TouchableOpacity style={s.wellnessSeeAll} onPress={() => setSelectedCategoryName('Monsoon Wellness Picks')}>
                <Text style={{ fontSize: 16, color: txtSec }}>›</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, marginBottom: 32 }}>
              {[
                {
                  id: 'bb-honey',
                  name: '24 MANTRA ORGANIC Wild Honey',
                  price: 380,
                  originalPrice: 380,
                  weight: '500 g',
                  image: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=200&q=80',
                  isVeg: true
                },
                {
                  id: 'bb-lemon',
                  name: 'Fresh Lemon',
                  price: 10,
                  originalPrice: 27,
                  weight: '3 pcs',
                  image: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=200&q=80',
                  isVeg: true,
                  discount: '63% OFF'
                },
                {
                  id: 'bb-garlic',
                  name: 'Fresh Garlic/Velluli',
                  price: 65,
                  originalPrice: 114,
                  weight: '250 g',
                  image: 'https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=200&q=80',
                  isVeg: true,
                  discount: '43% OFF'
                },
                {
                  id: 'bb-ginger',
                  name: 'Fresh Ginger',
                  price: 35,
                  originalPrice: 50,
                  weight: '100 g',
                  image: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=200&q=80',
                  isVeg: true,
                  discount: '30% OFF'
                }
              ].map(product => {
                const inCart = cart.find(i => i.id === product.id);
                const quantity = inCart ? inCart.quantity : 0;
                return (
                  <View key={product.id} style={[s.bbProductCard, { backgroundColor: cardSurface, borderColor: border }]}>
                    {/* Image and overlapping controls */}
                    <View style={s.bbProductCardImgWrap}>
                      <TouchableOpacity style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} onPress={() => router.push(`/products/${product.id}` as any)}>
                        <Image source={{ uri: product.image }} style={s.bbProductCardImg} />
                      </TouchableOpacity>
                      
                      {/* Heart outline badge */}
                      <TouchableOpacity style={s.bbWishlistBtn}>
                        <Text style={{ fontSize: 13, color: '#999' }}>⭐</Text>
                      </TouchableOpacity>

                      {/* Overlapping green square + button */}
                      <View style={s.bbAddBtnOverlapping}>
                        {quantity > 0 ? (
                          <View style={s.bbStepperOverlapping}>
                            <TouchableOpacity
                              style={s.bbStepperBtnMini}
                              onPress={() => {
                                const cartKey = cart.find(i => i.id === product.id)?.cartKey || product.id;
                                updateQuantity(cartKey, quantity - 1);
                              }}
                            >
                              <Text style={s.bbStepperBtnTextMini}>-</Text>
                            </TouchableOpacity>
                            <Text style={s.bbStepperQtyMini}>{quantity}</Text>
                            <TouchableOpacity
                              style={s.bbStepperBtnMini}
                              onPress={() => {
                                addToCart({
                                  id: product.id,
                                  name: product.name,
                                  price: product.price,
                                  image: product.image,
                                  restaurantId: 'mega-basket-vendor',
                                  restaurantName: 'Mega Basket Grocery'
                                });
                              }}
                            >
                              <Text style={s.bbStepperBtnTextMini}>+</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={s.bbAddBtnSquare}
                            onPress={() => {
                              addToCart({
                                id: product.id,
                                name: product.name,
                                price: product.price,
                                image: product.image,
                                restaurantId: 'mega-basket-vendor',
                                restaurantName: 'Mega Basket Grocery'
                              });
                            }}
                          >
                            <Text style={s.bbAddBtnPlus}>+</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    {/* Details */}
                    <TouchableOpacity 
                      style={s.bbProductCardDetails}
                      onPress={() => router.push(`/products/${product.id}` as any)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[s.bbProductCardPrice, { color: txt }]}>₹{product.price}</Text>
                        {product.originalPrice > product.price && (
                          <Text style={s.bbProductCardOrigPrice}>₹{product.originalPrice}</Text>
                        )}
                      </View>
                      
                      {product.discount ? (
                        <View style={s.bbDiscountTag}>
                          <Text style={s.bbDiscountTagText}>{product.discount}</Text>
                        </View>
                      ) : (
                        <View style={{ height: 14 }} />
                      )}

                      <Text style={[s.bbProductCardName, { color: txt }]} numberOfLines={2}>
                        {product.name}
                      </Text>
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <Text style={s.bbProductCardWeight}>{product.weight}</Text>
                        <Text style={{ fontSize: 8, color: '#999', marginLeft: 2 }}> ▽</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

            {/* ── OFTEN BOUGHT TOGETHER SMART CROSS-PROMOTION SHELF ── */}
            <View style={{ marginBottom: 24 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 }}>
                <Text style={[s.sectionTitle, { color: txt, marginVertical: 0, paddingLeft: 0 }]}>Often Bought Together</Text>
                <Text style={{ fontSize: 8, fontWeight: '900', color: '#16A34A', letterSpacing: 0.5 }}>SMART PICKS</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
                {[
                  {
                    id: 'brand-amul-1',
                    name: 'Amul Pure Cow Ghee Tin',
                    price: 680,
                    originalPrice: 720,
                    weight: '1 L',
                    image: 'https://images.unsplash.com/photo-1547514701-42782101795e?w=200&q=80',
                    isVeg: true,
                    discount: '5% OFF'
                  },
                  {
                    id: 'brand-nescafe-1',
                    name: 'Nescafe Classic Instant Coffee',
                    price: 310,
                    originalPrice: 340,
                    weight: '100 g',
                    image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200&q=80',
                    isVeg: true,
                    discount: '8% OFF'
                  },
                  {
                    id: 'brand-cadbury-1',
                    name: 'Cadbury Dairy Milk Silk Bar',
                    price: 100,
                    originalPrice: 100,
                    weight: '150 g',
                    image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=200&q=80',
                    isVeg: true
                  }
                ].map(product => {
                  const inCart = cart.find(i => i.id === product.id);
                  const quantity = inCart ? inCart.quantity : 0;
                  return (
                    <View key={product.id} style={[s.crossPromoCard, { backgroundColor: cardSurface, borderColor: border }]}>
                      <Image source={{ uri: product.image }} style={s.crossPromoImg} />
                      <View style={{ flex: 1, paddingLeft: 8 }}>
                        <Text style={[s.crossPromoTitle, { color: txt }]} numberOfLines={1}>{product.name}</Text>
                        <Text style={s.crossPromoWeight}>{product.weight}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <Text style={[s.crossPromoPrice, { color: txt }]}>₹{product.price}</Text>
                          {quantity > 0 ? (
                            <View style={[s.stepperWrap, { height: 24 }]}>
                              <TouchableOpacity
                                style={[s.stepperBtn, { paddingHorizontal: 4 }]}
                                onPress={() => {
                                  const cartKey = cart.find(i => i.id === product.id)?.cartKey || product.id;
                                  updateQuantity(cartKey, quantity - 1);
                                }}
                              >
                                <Text style={[s.stepperBtnText, { fontSize: 8 }]}>-</Text>
                              </TouchableOpacity>
                              <Text style={[s.stepperQty, { fontSize: 8, minWidth: 10, paddingHorizontal: 2 }]}>{quantity}</Text>
                              <TouchableOpacity
                                style={[s.stepperBtn, { paddingHorizontal: 4 }]}
                                onPress={() => {
                                  addToCart({
                                    id: product.id,
                                    name: product.name,
                                    price: product.price,
                                    image: product.image,
                                    restaurantId: 'mega-basket-vendor',
                                    restaurantName: 'Mega Basket Grocery'
                                  });
                                }}
                              >
                                <Text style={[s.stepperBtnText, { fontSize: 8 }]}>+</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={[s.addBtnWellness, { paddingHorizontal: 6, paddingVertical: 2 }]}
                              onPress={() => {
                                addToCart({
                                  id: product.id,
                                  name: product.name,
                                  price: product.price,
                                  image: product.image,
                                  restaurantId: 'mega-basket-vendor',
                                  restaurantName: 'Mega Basket Grocery'
                                });
                              }}
                            >
                              <Text style={[s.addBtnWellnessText, { fontSize: 8 }]}>ADD +</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {/* ── DAILY ESSENTIALS, SNACKS, HOME NEEDS GRIDS (PREMIUM) ── */}
            {GROCERY_CATEGORIES.map((section, sectionIdx) => {
              const sectionBadges = ['ESSENTIALS', 'POPULAR', 'HOME'];
              const sectionColors = ['#059669', '#EA580C', '#7C3AED'];
              return (
              <View key={section.title} style={{ paddingHorizontal: 16, marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                  <Text style={{ fontSize: 17, fontWeight: '900', color: txt, letterSpacing: 0.3 }}>{section.title}</Text>
                  <View style={{ marginLeft: 8, backgroundColor: sectionColors[sectionIdx] || '#059669', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ fontSize: 7, fontWeight: '900', color: '#fff', letterSpacing: 1 }}>{sectionBadges[sectionIdx] || 'NEW'}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {section.items.map((item, idx) => (
                    <ScalePressable
                      key={idx}
                      onPress={() => setSelectedCategoryName(item.name)}
                      style={{ width: (SW - 32 - 10) / 2 }}
                    >
                      <View style={{
                        width: '100%',
                        height: 120,
                        borderRadius: 16,
                        overflow: 'hidden',
                        position: 'relative',
                      }}>
                        <Image
                          source={{ uri: item.img }}
                          style={{
                            width: '100%',
                            height: '100%',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                          }}
                          resizeMode="cover"
                        />
                        <LinearGradient
                          colors={['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.65)']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            justifyContent: 'flex-end',
                            padding: 10,
                          }}
                        >
                          <Text style={{
                            fontSize: 12,
                            fontWeight: '900',
                            color: '#fff',
                            textShadowColor: 'rgba(0,0,0,0.6)',
                            textShadowOffset: { width: 0, height: 1 },
                            textShadowRadius: 4,
                          }} numberOfLines={2}>
                            {item.name}
                          </Text>
                        </LinearGradient>
                      </View>
                    </ScalePressable>
                  ))}
                </View>
              </View>
              );
            })}
          </View>
        )}

        {/* ── PG & HOMES TAB ── */}
        {activeTab === 'pg' && (
          <View style={{ paddingHorizontal: 16 }}>
            {/* Search */}
            <View style={[s.searchWrap, { backgroundColor: cardBg, borderColor: border, marginHorizontal: 0 }]}>
              <Text style={{ fontSize: 16 }}>🔍 </Text>
              <TextInput style={[s.searchInput, { color: txt }]} placeholder="Search by PG Name or Location..." placeholderTextColor={txtSec} value={searchQuery} onChangeText={setSearchQuery} />
            </View>

            {/* Gender Filters */}
            <Text style={[s.filterLabel, { color: txt }]}>GENDER TYPE</Text>
            <View style={s.rowFilters}>
              {['All', 'Boys', 'Girls', 'Co-ed'].map(g => (
                <DopaminePressable key={g} style={[s.chip, genderFilter === g && s.chipActive, { borderColor: border }]} onPress={() => setGenderFilter(g)} sound="click" activeScale={0.93}>
                  <Text style={[s.chipText, genderFilter === g && s.chipTextActive]}>{g.toUpperCase()}</Text>
                </DopaminePressable>
              ))}
            </View>

            {/* Price Limits */}
            <Text style={[s.filterLabel, { color: txt }]}>MAX RENT BUDGET</Text>
            <View style={s.rowFilters}>
              {['All', '5000', '8000', '10000', '15000'].map(b => (
                <DopaminePressable key={b} style={[s.chip, budgetFilter === b && s.chipActive, { borderColor: border }]} onPress={() => setBudgetFilter(b)} sound="click" activeScale={0.93}>
                  <Text style={[s.chipText, budgetFilter === b && s.chipTextActive]}>{b === 'All' ? 'ANY' : `₹${b}`}</Text>
                </DopaminePressable>
              ))}
            </View>

            {/* Distance Limits */}
            <Text style={[s.filterLabel, { color: txt }]}>CAMPUS PROXIMITY</Text>
            <View style={s.rowFilters}>
              {['All', '1', '3', '5', '10'].map(d => (
                <DopaminePressable key={d} style={[s.chip, distanceFilter === d && s.chipActive, { borderColor: border }]} onPress={() => setDistanceFilter(d)} sound="click" activeScale={0.93}>
                  <Text style={[s.chipText, distanceFilter === d && s.chipTextActive]}>{d === 'All' ? 'ANY' : `< ${d} km`}</Text>
                </DopaminePressable>
              ))}
            </View>

            {/* List */}
            <View style={{ marginTop: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.red, letterSpacing: 2 }}>STUDENT ACCOMMODATIONS</Text>
                <Text style={{ fontSize: 10, fontWeight: '800', color: txtSec }}>{filteredPGs.length} FOUND</Text>
              </View>

              {loadingPgs ? (
                <ActivityIndicator size="large" color={COLORS.red} style={{ marginTop: 24 }} />
              ) : filteredPGs.length > 0 ? (
                filteredPGs.map((pg, idx) => {
                  const pgImg = pg.images && pg.images.length > 0 ? pg.images[0] : 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=400';
                  return (
                    <StaggeredSection key={pg.id} delay={50 + (idx % 6) * 50} direction="up">
                    <CardPressable style={[s.pgCard, { backgroundColor: cardBg, borderColor: border }]} onPress={() => router.push(`/pg/${pg.id}` as any)} sound="pgTransition" tilt={true}>
                      <Image source={{ uri: pgImg }} style={s.pgCardImg} />
                      <View style={s.pgCardOverlay} />
                      
                      <View style={s.pgCardVerified}>
                        <Text style={s.pgCardVerifiedText}>★ VERIFIED</Text>
                      </View>

                      <View style={s.pgCardContent}>
                        <View style={s.pgCardGenderRow}>
                          <Text style={[s.pgCardGender, { color: pg.genderType === 'Boys' ? '#60A5FA' : pg.genderType === 'Girls' ? '#F472B6' : '#A78BFA' }]}>
                            ● {pg.genderType.toUpperCase()} ONLY
                          </Text>
                          <Text style={s.pgCardDistance}>🏃 {pg.distanceFromCollege} KM FROM CAMPUS</Text>
                        </View>
                        <Text style={s.pgCardName}>{pg.name}</Text>
                        <Text style={s.pgCardAddr} numberOfLines={1}>📍 {pg.address}</Text>

                        <View style={s.pgCardPriceRow}>
                          <View>
                            <Text style={s.pgCardPriceLabel}>RENT STARTS FROM</Text>
                            <Text style={[s.pgCardPrice, { color: goldColor }]}>₹{pg.baseRent}<Text style={{ fontSize: 9, fontWeight: '600', color: '#ccc' }}>/mo</Text></Text>
                          </View>
                          <View style={s.pgCardBookBtn}>
                            <Text style={s.pgCardBookText}>VIEW DETAILS →</Text>
                          </View>
                        </View>
                      </View>
                    </CardPressable>
                    </StaggeredSection>
                  );
                })
              ) : (
                <View style={s.emptyState}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>🏢</Text>
                  <Text style={{ color: txtSec, fontSize: 11, fontWeight: '700' }}>No residences matching filters.</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── CO-RIDE (BIKEPOOL) TAB ── */}
        {activeTab === 'coride' && (
          <View style={{ paddingHorizontal: 16 }}>
            {/* Karma Trust Header */}
            <View style={[s.karmaBanner, { backgroundColor: goldMutedColor, borderColor: goldBorderColor }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>✨</Text>
                <View>
                  <Text style={[s.karmaLabel, { color: goldColor }]}>MY TRUST PROFILE SCORE</Text>
                  <Text style={[s.karmaVal, { color: goldColor }]}>{user?.karmaPoints || 0} PTS</Text>
                </View>
              </View>
              <View style={[s.karmaBadge, { borderColor: goldBorderColor }]}>
                <Text style={[s.karmaBadgeText, { color: goldColor }]}>ACTIVE RIDER</Text>
              </View>
            </View>

            {/* Commute Sub-Tabs */}
            <View style={s.corideSubTabs}>
              <DopaminePressable style={[s.corideSubTabBtn, corideTab === 'browse' && s.corideSubTabBtnActive, { flex: 1 }]} onPress={() => setCorideTab('browse')} sound="tabSwitch">
                <Text style={[s.corideSubTabLabel, corideTab === 'browse' && s.corideSubTabLabelActive]}>🚗 BROWSE COMMUTES</Text>
              </DopaminePressable>
              <DopaminePressable style={[s.corideSubTabBtn, corideTab === 'my-rides' && s.corideSubTabBtnActive, { flex: 1 }]} onPress={() => setCorideTab('my-rides')} sound="tabSwitch">
                <Text style={[s.corideSubTabLabel, corideTab === 'my-rides' && s.corideSubTabLabelActive]}>❤️ MY RIDES</Text>
              </DopaminePressable>
            </View>

            {/* BROWSE SUB-TAB */}
            {corideTab === 'browse' && (
              <View>
                {/* Filters */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.filterLabel, { color: txt, marginBottom: 4 }]}>VEHICLE</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.rowFilters}>
                      {['All', 'Bike', 'Car', 'Auto'].map(v => (
                        <DopaminePressable key={v} style={[s.chip, vehicleFilter === v && s.chipActive, { borderColor: border }]} onPress={() => setVehicleFilter(v as any)} sound="click">
                          <Text style={[s.chipText, vehicleFilter === v && s.chipTextActive]}>{v.toUpperCase()}</Text>
                        </DopaminePressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>

                {/* List available rides */}
                {loadingRides ? (
                  <ActivityIndicator size="large" color={COLORS.red} style={{ marginTop: 24 }} />
                ) : filteredRides.length > 0 ? (
                  filteredRides.map((ride, idx) => {
                    const isPassenger = ride.creatorRole === 'passenger';
                    const dateText = new Date(ride.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + new Date(ride.departureTime).toLocaleDateString([], { month: 'short', day: 'numeric' });
                    
                    return (
                      <StaggeredSection key={ride.id} delay={50 + (idx % 6) * 50} direction="up">
                      <CardPressable style={[s.rideCard, { backgroundColor: cardBg, borderColor: border }]} onPress={() => handleJoinRide(ride.id)} sound="rideTransition" tilt={true}>
                        <View style={s.rideCardHeader}>
                          <View style={s.rideCreatorRow}>
                            <View style={[s.rideAvatar, { backgroundColor: goldMutedColor, borderColor: goldBorderColor }]}>
                              <Text style={[s.rideAvatarText, { color: goldColor }]}>{(ride.creator?.name || 'U').substring(0, 1).toUpperCase()}</Text>
                            </View>
                            <View>
                              <Text style={[s.rideCreatorName, { color: txt }]}>{ride.creator?.name || 'Campus Peer'}</Text>
                              <Text style={{ fontSize: 8, color: txtSec }}>GENDER: {ride.creator?.gender || 'Any'}</Text>
                            </View>
                          </View>
                          <View style={[s.roleBadge, { backgroundColor: isPassenger ? 'rgba(239,79,95,0.1)' : 'rgba(16,185,129,0.1)' }]}>
                            <Text style={[s.roleBadgeText, { color: isPassenger ? COLORS.red : COLORS.emerald }]}>
                              {isPassenger ? 'PASSENGER REQUEST' : 'OFFERING RIDE'}
                            </Text>
                          </View>
                        </View>

                        <View style={s.ridePathRow}>
                          <View style={s.rideDotCol}>
                            <View style={[s.rideDot, { backgroundColor: COLORS.red }]} />
                            <View style={s.rideDashLine} />
                            <View style={[s.rideDot, { backgroundColor: COLORS.emerald }]} />
                          </View>
                          <View style={s.ridePathTextCol}>
                            <Text style={[s.ridePathText, { color: txt }]} numberOfLines={1}>FROM: {ride.origin}</Text>
                            <Text style={[s.ridePathText, { color: txt, marginTop: 10 }]} numberOfLines={1}>TO: {ride.destination}</Text>
                          </View>
                        </View>

                        <View style={s.rideMetaRow}>
                          <View>
                            <Text style={s.metaLabel}>DEPARTURE TIME</Text>
                            <Text style={[s.metaVal, { color: txt }]}>{dateText}</Text>
                          </View>
                          <View>
                            <Text style={s.metaLabel}>VEHICLE TYPE</Text>
                            <Text style={[s.metaVal, { color: txt }]}>{ride.vehicleType.toUpperCase()} ({ride.vehicleInfo || 'Active'})</Text>
                          </View>
                          <View>
                            <Text style={s.metaLabel}>SEATS LEFT</Text>
                            <Text style={[s.metaVal, { color: COLORS.red }]}>{ride.availableSeats} SEAT{(ride.availableSeats !== 1) ? 'S' : ''}</Text>
                          </View>
                        </View>

                        {ride.notes && (
                          <View style={[s.rideNotesBox, { backgroundColor: isDark ? '#141416' : '#F1F3F5' }]}>
                            <Text style={[s.rideNotesText, { color: txtSec }]}>💬 &quot;{ride.notes}&quot;</Text>
                          </View>
                        )}

                        <View style={[s.joinBtn, { marginTop: 12 }]}>
                          <Text style={s.joinBtnText}>REQUEST TO JOIN SPLIT 🚗</Text>
                        </View>
                      </CardPressable>
                      </StaggeredSection>
                    );
                  })
                ) : (
                  <View style={s.emptyState}>
                    <Text style={{ fontSize: 32, marginBottom: 8 }}>🚗</Text>
                    <Text style={{ color: txtSec, fontSize: 11, fontWeight: '700' }}>No commutes active. Post yours now!</Text>
                  </View>
                )}
              </View>
            )}

            {/* MY RIDES SUB-TAB */}
            {corideTab === 'my-rides' && (
              <View>
                {loadingMyRides ? (
                  <ActivityIndicator size="large" color={COLORS.red} style={{ marginTop: 24 }} />
                ) : myRides.length > 0 ? (
                  myRides.map(ride => {
                    const isCreator = ride.creatorId === user?.id;
                    const counterpart = isCreator ? ride.coRider : ride.creator;
                    const dateText = new Date(ride.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + new Date(ride.departureTime).toLocaleDateString([], { month: 'short', day: 'numeric' });
                    
                    return (
                      <View key={ride.id} style={[s.rideCard, { backgroundColor: cardBg, borderColor: border }]}>
                        <View style={s.rideCardHeader}>
                          <View>
                            <Text style={{ fontSize: 8, color: txtSec, fontWeight: '800' }}>COMMUTE ID: #{ride.id.slice(-6).toUpperCase()}</Text>
                            <Text style={[s.rideCreatorName, { color: txt, marginTop: 2 }]}>
                              {isCreator ? 'MY COMMUTE LISTING' : `WITH ${counterpart?.name || 'CAMPUS PEER'}`}
                            </Text>
                          </View>
                          <View style={[s.statusBadge, { backgroundColor: ride.status === 'Completed' ? 'rgba(16,185,129,0.1)' : ride.status === 'Matched' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)' }]}>
                            <Text style={{ fontSize: 8, fontWeight: '900', color: ride.status === 'Completed' ? COLORS.emerald : ride.status === 'Matched' ? COLORS.amber : '#EF4444' }}>
                              {ride.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>

                        <View style={s.ridePathRow}>
                          <View style={s.rideDotCol}>
                            <View style={[s.rideDot, { backgroundColor: COLORS.red }]} />
                            <View style={s.rideDashLine} />
                            <View style={[s.rideDot, { backgroundColor: COLORS.emerald }]} />
                          </View>
                          <View style={s.ridePathTextCol}>
                            <Text style={[s.ridePathText, { color: txt }]} numberOfLines={1}>FROM: {origin || ride.origin}</Text>
                            <Text style={[s.ridePathText, { color: txt, marginTop: 10 }]} numberOfLines={1}>TO: {destination || ride.destination}</Text>
                          </View>
                        </View>

                        <View style={s.rideMetaRow}>
                          <View>
                            <Text style={s.metaLabel}>DEPARTURE TIME</Text>
                            <Text style={[s.metaVal, { color: txt }]}>{dateText}</Text>
                          </View>
                          <View>
                            <Text style={s.metaLabel}>SPLIT FUEL COST</Text>
                            <Text style={[s.metaVal, { color: COLORS.red }]}>₹{ride.estimatedFuelCost || 0}</Text>
                          </View>
                          <View>
                            <Text style={s.metaLabel}>STATUS</Text>
                            <Text style={[s.metaVal, { color: txt }]}>{ride.status}</Text>
                          </View>
                        </View>

                        {/* Invoice split receipt details if Completed */}
                        {ride.status === 'Completed' && (
                          <View style={s.invoiceCard}>
                            <Text style={s.invoiceTitle}>SPLIT INVOICE RECEIPT 🧾</Text>
                            <View style={s.invoiceRow}>
                              <Text style={s.invoiceLabel}>TOTAL FUEL ESTIMATE</Text>
                              <Text style={s.invoiceVal}>₹{ride.estimatedFuelCost}</Text>
                            </View>
                            <View style={s.invoiceRow}>
                              <Text style={s.invoiceLabel}>SPLIT COST PER RIDER</Text>
                              <Text style={[s.invoiceVal, { color: COLORS.red }]}>₹{(ride.estimatedFuelCost / 2).toFixed(1)}</Text>
                            </View>
                            <View style={s.invoiceRow}>
                              <Text style={s.invoiceLabel}>PAYMENT STATUS</Text>
                              <Text style={[s.invoiceVal, { color: COLORS.emerald }]}>{ride.paymentStatus.toUpperCase()}</Text>
                            </View>
                          </View>
                        )}

                        {/* Actions for active Match */}
                        {ride.status === 'Matched' && (
                          <View>
                            {/* WhatsApp contact & SOS integration */}
                            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                              <ActionPressable 
                                style={[s.actionBtn, { flex: 1, backgroundColor: '#25D366' }]} 
                                onPress={() => {
                                  const ph = counterpart?.phone || '+91 9988776655';
                                  Linking.openURL(`https://wa.me/${ph.replace('+', '')}`);
                                }}
                                sound="click"
                              >
                                <Text style={s.actionBtnText}>WHATSAPP CHAT 💬</Text>
                              </ActionPressable>
                              <ActionPressable 
                                style={[s.actionBtn, { flex: 1, backgroundColor: '#EF4444' }]} 
                                onPress={() => {
                                  Alert.alert('SOS Triggered', 'Emergency alert message generated for security wardens.');
                                }}
                                sound="click"
                              >
                                <Text style={s.actionBtnText}>SOS SECURITY 🚨</Text>
                              </ActionPressable>
                            </View>

                            {/* Complete and Cancel ride */}
                            {isCreator && (
                              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                                <ActionPressable style={[s.completeBtn, { flex: 1 }]} onPress={() => handleCompleteRide(ride.id)} sound="success">
                                  <Text style={s.completeBtnText}>COMPLETE RIDE ✅</Text>
                                </ActionPressable>
                                <ActionPressable style={[s.cancelRideBtn, { width: 100 }]} onPress={() => handleCancelRide(ride.id)} sound="click">
                                  <Text style={s.cancelRideBtnText}>CANCEL</Text>
                                </ActionPressable>
                              </View>
                            )}
                          </View>
                        )}

                        {ride.status === 'Available' && isCreator && (
                          <ActionPressable style={[s.cancelRideBtn, { marginTop: 12, width: '100%' }]} onPress={() => handleCancelRide(ride.id)} sound="click">
                            <Text style={s.cancelRideBtnText}>REMOVE POST Listing ✕</Text>
                          </ActionPressable>
                        )}
                      </View>
                    );
                  })
                ) : (
                  <View style={s.emptyState}>
                    <Text style={{ fontSize: 32, marginBottom: 8 }}>🏢</Text>
                    <Text style={{ color: txtSec, fontSize: 11, fontWeight: '700' }}>No commute records found.</Text>
                  </View>
                )}
              </View>
            )}

            {/* Create Post floating trigger */}
            <ActionPressable style={s.floatingFab} onPress={() => setShowCreateModal(true)} sound="click">
              <Text style={s.floatingFabText}>POST A COMMUTE +</Text>
            </ActionPressable>
          </View>
        )}

        {/* ── DEALS & SPINS TAB ── */}
        {activeTab === 'promos' && (
          <View style={{ paddingHorizontal: 16 }}>
            {/* 1. Glassmorphic Hero Badge: Coin Balance */}
            <Animated.View style={{ opacity: heroEnterO, transform: [{ translateY: heroEnterY }] }}>
            <View style={{
              borderRadius: 24,
              overflow: 'hidden',
              marginBottom: 16,
              borderWidth: 1.5,
              borderColor: border,
            }}>
              <LinearGradient
                colors={isDark ? ['#1E1B4B', '#311042'] : ['#FDF4E3', '#FCE7C8']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: COLORS.gold, letterSpacing: 2 }}>ZENVY PREMIUM OFFERS</Text>
                  <Text style={{ fontSize: 24, fontWeight: '900', color: txt, marginTop: 4 }}>Your Rewards Hub</Text>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: txtSec, marginTop: 2 }}>Spin, scratch, & watch ads to claim coupons!</Text>
                </View>
                <View style={{ alignItems: 'flex-end', minWidth: 80 }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: txtSec }}>COIN BALANCE</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <Animated.View style={{ transform: [{ translateY: coinFloatAnim }] }}>
                      <Text style={{ fontSize: 20 }}>🪙</Text>
                    </Animated.View>
                    <Text style={{ fontSize: 20, fontWeight: '900', color: COLORS.gold }}>{user?.karmaPoints || 250}</Text>
                  </View>
                </View>
              </LinearGradient>
            </View>
            </Animated.View>

            {/* 2. Fortune Spin Wheel Section */}
            <Animated.View style={{ opacity: wheelEnterO, transform: [{ translateY: wheelEnterY }, { scale: wheelScaleIn }] }}>
            <View style={{
              borderRadius: 24,
              borderWidth: 1.5,
              borderColor: border,
              backgroundColor: cardBg,
              padding: 20,
              alignItems: 'center',
              marginBottom: 16,
              ...SHADOWS.card
            }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: txt, letterSpacing: 1.5 }}>FORTUNE SPIN WHEEL 🎡</Text>
              <Text style={{ fontSize: 9, fontWeight: '700', color: txtSec, marginTop: 2, marginBottom: 16 }}>Spin daily to win exclusive campus discounts!</Text>

              {/* Spin Wheel Visual Element */}
              <View style={{ width: 260, height: 260, justifyContent: 'center', alignItems: 'center', marginVertical: 12, position: 'relative' }}>
                {/* Pointer ▼ with bounce */}
                <Animated.Text style={{ fontSize: 26, color: '#C9A84C', position: 'absolute', top: -16, zIndex: 15, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4, transform: [{ translateY: pointerBounce }] }}>▼</Animated.Text>
                
                {/* Outer Rim */}
                <View style={{
                  width: 250,
                  height: 250,
                  borderRadius: 125,
                  borderWidth: 6,
                  borderColor: '#C9A84C',
                  backgroundColor: '#0B0B0D',
                  justifyContent: 'center',
                  alignItems: 'center',
                  shadowColor: '#C9A84C',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.25,
                  shadowRadius: 8,
                  elevation: 6
                }}>
                  {/* Rotating Inner Wheel */}
                  <Animated.View style={{
                    width: 238,
                    height: 238,
                    borderRadius: 119,
                    backgroundColor: '#111318',
                    overflow: 'hidden',
                    position: 'relative',
                    transform: [{
                      rotate: spinAnim.interpolate({
                        inputRange: [0, 360000],
                        outputRange: ['0deg', '360000deg']
                      })
                    }]
                  }}>
                    {/* Wedges Divider Lines */}
                    {Array(8).fill(0).map((_, idx) => (
                      <View
                        key={`line-${idx}`}
                        style={{
                          position: 'absolute',
                          width: 1.5,
                          height: 119,
                          backgroundColor: 'rgba(201, 168, 76, 0.25)',
                          top: 0,
                          left: 118,
                          transform: [
                            { rotate: `${idx * 45 + 22.5}deg` },
                            { translateY: 59.5 }
                          ]
                        }}
                      />
                    ))}

                    {/* Sector Items */}
                    {WHEEL_SECTORS.map((sector, idx) => (
                      <View
                        key={`sector-${idx}`}
                        style={{
                          position: 'absolute',
                          width: 86,
                          height: 86,
                          top: 76,
                          left: 76,
                          alignItems: 'center',
                          justifyContent: 'center',
                          transform: [
                            { rotate: `${idx * 45}deg` },
                            { translateY: -64 }
                          ]
                        }}
                      >
                        <View style={{
                          width: 38,
                          height: 38,
                          borderRadius: 19,
                          backgroundColor: sector.color,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 2,
                          borderColor: '#fff',
                          shadowColor: sector.color,
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.4,
                          shadowRadius: 3,
                        }}>
                          <Text style={{ fontSize: 15 }}>{sector.emoji}</Text>
                        </View>
                        <Text style={{
                          fontSize: 7,
                          fontWeight: '900',
                          color: '#fff',
                          textAlign: 'center',
                          marginTop: 3,
                          width: 70,
                        }}>
                          {sector.label}
                        </Text>
                      </View>
                    ))}
                  </Animated.View>
                </View>

                {/* Central SPIN Button */}
                <Animated.View style={{
                  position: 'absolute',
                  transform: [{ scale: spinBtnScale }],
                  zIndex: 10,
                }}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={isSpinning || spinsLeft <= 0}
                    onPress={handleSpin}
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 29,
                      backgroundColor: '#C9A84C',
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#C9A84C',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.6,
                      shadowRadius: 6,
                      elevation: 5,
                      borderWidth: 3,
                      borderColor: '#fff'
                    }}
                  >
                    <Text style={{ fontSize: 9.5, fontWeight: '900', color: '#000', letterSpacing: 0.5 }}>
                      {isSpinning ? 'SPINNING' : spinsLeft > 0 ? 'SPIN' : 'LOCKED'}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              </View>

              {/* Action Info */}
              <Text style={{ fontSize: 8.5, fontWeight: '800', color: spinsLeft > 0 ? COLORS.gold : txtSec, marginTop: 8 }}>
                {spinsLeft > 0 ? `🎉 YOU HAVE ${spinsLeft} SPIN LEFT TODAY` : '❌ DAILY SPIN EXHAUSTED (Watch an ad below to reset!)'}
              </Text>
            </View>
            </Animated.View>

            {/* 3. Interactive Scratch Cards */}
            <Animated.View style={{ opacity: scratchEnterO, transform: [{ translateY: scratchEnterY }] }}>
            <View style={{
              borderRadius: 24,
              borderWidth: 1.5,
              borderColor: border,
              backgroundColor: cardBg,
              padding: 16,
              marginBottom: 16,
              ...SHADOWS.card
            }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: txt, letterSpacing: 1.5, textAlign: 'center' }}>SCRATCH & WIN CARDS 🎁</Text>
              <Text style={{ fontSize: 9, fontWeight: '700', color: txtSec, marginTop: 2, marginBottom: 12, textAlign: 'center' }}>Tap to scratch and unlock secret campus coupon codes!</Text>

              {/* Cards Grid */}
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 8 }}>
                {scratchCardsState.map(card => (
                  <View
                    key={card.id}
                    style={{
                      width: (SW - 32 - 20 - 32) / 3,
                      height: 120,
                      borderRadius: 16,
                      backgroundColor: isDark ? '#1F2937' : '#F3F4F6',
                      borderWidth: 1.5,
                      borderColor: border,
                      position: 'relative',
                      overflow: 'hidden',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 6
                    }}
                  >
                    {/* Reward content */}
                    <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                      <Text style={{ fontSize: 18, marginBottom: 4 }}>🎁</Text>
                      <Text style={{ fontSize: 7, fontWeight: '900', color: txtSec, textAlign: 'center' }}>{card.title}</Text>
                      <Text style={{ fontSize: 8.5, fontWeight: '900', color: COLORS.greenRating, textAlign: 'center', marginTop: 4, height: 22 }}>{card.reward}</Text>
                      
                      <TouchableOpacity
                        onPress={() => {
                          if (card.scratched) {
                            setCopiedCode(card.code);
                            Alert.alert('Coupon Copied', `Code "${card.code}" has been copied!`);
                          }
                        }}
                        style={{
                          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB',
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 6,
                          marginTop: 6
                        }}
                      >
                        <Text style={{ fontSize: 7, fontWeight: '900', color: txt }}>
                          {card.scratched ? `COPY: ${card.code}` : (card.id === 3 && !adCompleted ? 'LOCKED' : 'SCRATCH')}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Gold scratch covering overlay */}
                    {!card.scratched && (
                      <Animated.View
                        style={[
                          StyleSheet.absoluteFill,
                          {
                            backgroundColor: '#D4AF7A',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: card.anim,
                            zIndex: 5
                          }
                        ]}
                      >
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => handleScratch(card.id, card.anim)}
                          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
                        >
                          <LinearGradient
                            colors={['#D4AF7A', '#AA7C11', '#FDF6E2', '#AA7C11']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 8 }]}
                          >
                            <Text style={{ fontSize: 20, marginBottom: 4 }}>
                              {card.id === 3 && !adCompleted ? '🔒' : '✨'}
                            </Text>
                            <Animated.Text style={{ fontSize: 7.5, fontWeight: '900', color: '#000', letterSpacing: 0.5, textAlign: 'center', opacity: shimmerAnim }}>
                              {card.id === 3 && !adCompleted ? 'LOCKED' : 'TAP TO REVEAL'}
                            </Animated.Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </Animated.View>
                    )}
                  </View>
                ))}
              </View>
            </View>
            </Animated.View>

            {/* 4. Rich Interactive Ad & Watch-to-Earn Mechanism */}
            <Animated.View style={{ opacity: adEnterO, transform: [{ translateY: adEnterY }] }}>
            <View style={{
              borderRadius: 24,
              borderWidth: 1.5,
              borderColor: border,
              backgroundColor: cardBg,
              padding: 16,
              marginBottom: 16,
              ...SHADOWS.card
            }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: txt, letterSpacing: 1.5, textAlign: 'center' }}>WATCH & EARN SPONSOR ZONE 📺</Text>
              <Text style={{ fontSize: 9, fontWeight: '700', color: txtSec, marginTop: 2, marginBottom: 14, textAlign: 'center' }}>Complete a short 8-second video to claim free coins & spin!</Text>

              <View style={{
                borderRadius: 20,
                padding: 16,
                backgroundColor: '#0F172A',
                borderWidth: 1,
                borderColor: '#1E293B',
                position: 'relative',
                overflow: 'hidden',
                minHeight: 120,
                justifyContent: 'center',
                alignItems: 'center'
              }}>
                {/* Simulated playback visual */}
                {!isAdWatching && !adCompleted ? (
                  <View style={{ alignItems: 'center' }}>
                    <Image
                      source={{ uri: 'https://images.unsplash.com/photo-1543007630-9710e4a00a20?w=400&q=80' }}
                      style={{ width: '100%', height: 70, borderRadius: 12, opacity: 0.4, position: 'absolute' }}
                    />
                    <Text style={{ fontSize: 22, color: '#fff', marginBottom: 4 }}>▶️</Text>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 1 }}>Unlock Extra Daily Spin & +30 Coins</Text>
                    <Animated.View style={{ transform: [{ scale: adPulseScale }] }}>
                      <TouchableOpacity
                        onPress={() => {
                          setIsAdWatching(true);
                          setAdProgress(0);
                          setAdWatchingTimeLeft(8);
                        }}
                        style={{
                          backgroundColor: COLORS.emerald,
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          borderRadius: 12,
                          marginTop: 10,
                          shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 8.5, fontWeight: '900', letterSpacing: 1.5 }}>START VIDEO AD</Text>
                      </TouchableOpacity>
                    </Animated.View>
                  </View>
                ) : isAdWatching ? (
                  <View style={{ width: '100%', alignItems: 'center' }}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#38BDF8', letterSpacing: 1 }}>WATCHING SPONSORED VIDEO... ⏳</Text>
                    <Text style={{ fontSize: 18, color: '#fff', marginVertical: 6 }}>{adWatchingTimeLeft}s Remaining</Text>
                    
                    {/* Progress Bar Container */}
                    <View style={{ width: '80%', height: 6, backgroundColor: '#334155', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                      <View style={{ width: `${adProgress}%`, height: '100%', backgroundColor: '#38BDF8' }} />
                    </View>
                  </View>
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 28, marginBottom: 4 }}>🎉</Text>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#34D399', letterSpacing: 1 }}>REWARD UNLOCKED SUCCESSFULLY!</Text>
                    <Text style={{ fontSize: 8, color: '#94A3B8', marginTop: 2 }}>Claim code "ADBONUS" at grocery checkout for FREE Delivery.</Text>
                    
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                      <TouchableOpacity
                        onPress={() => {
                          setCopiedCode('ADBONUS');
                          Alert.alert('Coupon Copied', 'ADBONUS copied!');
                        }}
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.15)',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 8
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>COPY: ADBONUS</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setAdCompleted(false);
                        setSpinsLeft(prev => prev + 1);
                        Alert.alert('Extra Spin Added', 'One bonus spin added to your Fortune Wheel!');
                      }}
                      style={{
                        backgroundColor: COLORS.gold,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8
                      }}
                    >
                      <Text style={{ color: '#000', fontSize: 8, fontWeight: '900' }}>CLAIM +1 WHEEL SPIN</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
          </Animated.View>
                 {/* 5. Copyable Coupons List */}
            <Animated.View style={{ opacity: couponsEnterO, transform: [{ translateY: couponsEnterY }] }}>
            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: txt, letterSpacing: 1.5, marginBottom: 12, textAlign: 'center' }}>AVAILABLE CAMPUS OFFERS 🎟️ </Text>
              
              {[
                { title: '50% Off Stationary Blowout', code: 'STATIONARY50', desc: 'Valid on notebooks, pens, and packs at Campus Store.', tag: 'STATIONARY' },
                { title: 'Free Delivery on Essentials', code: 'FREEDELIVERY', desc: 'Get zero-delivery-fee grocery on order above ₹299.', tag: 'ESSENTIALS' },
                { title: '₹50 Off Ride Commute Share', code: 'RIDE50', desc: 'Applies on your next campus Co-Ride split fuel share.', tag: 'RIDE' },
                { title: '₹100 Off PG Booking Deposit', code: 'PG100', desc: 'Exclusive concession code for premium booking on app.', tag: 'PG HOUSING' },
              ].map((coupon, index) => (
                <View
                  key={index}
                  style={{
                    backgroundColor: cardBg,
                    borderWidth: 1.5,
                    borderColor: border,
                    borderRadius: 16,
                    padding: 14,
                    marginBottom: 10,
                    position: 'relative',
                    overflow: 'hidden',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  {/* Semicircular Ticket Cutouts */}
                  <View style={{ position: 'absolute', left: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: isDark ? '#0B0B0D' : '#F8FAFC', borderWidth: 1.5, borderColor: border }} />
                  <View style={{ position: 'absolute', right: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: isDark ? '#0B0B0D' : '#F8FAFC', borderWidth: 1.5, borderColor: border }} />

                  <View style={{ flex: 1, paddingHorizontal: 6 }}>
                    <Text style={{ fontSize: 7.5, fontWeight: '900', color: COLORS.gold, letterSpacing: 1 }}>{coupon.tag}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: txt, marginTop: 2 }}>{coupon.title}</Text>
                    <Text style={{ fontSize: 8, color: txtSec, marginTop: 2 }}>{coupon.desc}</Text>
                  </View>

                  <View style={{ width: 1, height: 40, borderStyle: 'dashed', borderWidth: 0.5, borderColor: border, marginHorizontal: 8 }} />

                  <Animated.View style={{ transform: [{ scale: popBtnCode === coupon.code ? btnScaleAnim : 1.0 }] }}>
                    <TouchableOpacity
                      onPress={() => {
                        handleCopyCode(coupon.code);
                        Alert.alert('Coupon Copied', `Coupon code "${coupon.code}" copied to clipboard!`);
                      }}
                      style={{
                        backgroundColor: copiedCode === coupon.code ? COLORS.emerald : COLORS.red,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 10,
                        width: 85,
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 }}>
                        {copiedCode === coupon.code ? 'COPIED ✓' : coupon.code}
                      </Text>
                    </TouchableOpacity>
                  </Animated.View>
                </View>
              ))}
            </View>
            </Animated.View>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>
      </Animated.View>

      {/* ── CO-RIDE POST A COMMUTE MODAL FORM ── */}
      <Modal visible={showCreateModal} animationType="slide" transparent={true}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContentBox, { backgroundColor: cardBg }]}>
            <Text style={[s.modalTitle, { color: txt }]}>POST CAMPUS RIDE</Text>
            
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
              <Text style={[s.formLabel, { color: txt }]}>I AM THE:</Text>
              <View style={s.formRoleRow}>
                <DopaminePressable style={[s.roleBtn, creatorRole === 'rider' && s.roleBtnActive, { flex: 1 }]} onPress={() => setCreatorRole('rider')} sound="click" activeScale={0.95}>
                  <Text style={[s.roleBtnTextLabel, creatorRole === 'rider' && s.roleBtnTextLabelActive]}>🏍️ RIDER (HAVE BIKE)</Text>
                </DopaminePressable>
                <DopaminePressable style={[s.roleBtn, creatorRole === 'passenger' && s.roleBtnActive, { flex: 1 }]} onPress={() => setCreatorRole('passenger')} sound="click" activeScale={0.95}>
                  <Text style={[s.roleBtnTextLabel, creatorRole === 'passenger' && s.roleBtnTextLabelActive]}>🚶 PASSENGER</Text>
                </DopaminePressable>
              </View>

              <Text style={[s.formLabel, { color: txt }]}>START LOCATION (ORIGIN)</Text>
              <TextInput style={[s.formInput, { color: txt, borderColor: border }]} placeholder="e.g. SRM AP Main Gate" placeholderTextColor={txtSec} value={origin} onChangeText={setOrigin} />

              <Text style={[s.formLabel, { color: txt }]}>DESTINATION</Text>
              <TextInput style={[s.formInput, { color: txt, borderColor: border }]} placeholder="e.g. Vijayawada Station" placeholderTextColor={txtSec} value={destination} onChangeText={setDestination} />

              <Text style={[s.formLabel, { color: txt }]}>DEPARTURE TIME (YYYY-MM-DD HH:MM)</Text>
              <TextInput style={[s.formInput, { color: txt, borderColor: border }]} placeholder="e.g. 2026-07-15 10:30" placeholderTextColor={txtSec} value={departureTime} onChangeText={setDepartureTime} />

              <Text style={[s.formLabel, { color: txt }]}>VEHICLE TYPE</Text>
              <View style={s.formRoleRow}>
                {['Bike', 'Car', 'Auto'].map(v => (
                  <DopaminePressable key={v} style={[s.roleBtn, vehicleType === v && s.roleBtnActive, { flex: 1 }]} onPress={() => setVehicleType(v)} sound="click" activeScale={0.95}>
                    <Text style={[s.roleBtnTextLabel, vehicleType === v && s.roleBtnTextLabelActive]}>{v.toUpperCase()}</Text>
                  </DopaminePressable>
                ))}
              </View>

              <Text style={[s.formLabel, { color: txt }]}>ESTIMATED FUEL SPLIT COST (₹ TOTAL)</Text>
              <TextInput style={[s.formInput, { color: txt, borderColor: border }]} keyboardType="numeric" placeholder="e.g. 150" placeholderTextColor={txtSec} value={estimatedFuelCost} onChangeText={setEstimatedFuelCost} />

              <Text style={[s.formLabel, { color: txt }]}>RIDE VIBE PREFERENCE</Text>
              <View style={s.formRoleRow}>
                {['Any', 'Silent Ride 🤫', 'Chatty 💬'].map(vb => (
                  <DopaminePressable key={vb} style={[s.roleBtn, rideVibe === vb && s.roleBtnActive, { flex: 1 }]} onPress={() => setRideVibe(vb)} sound="click" activeScale={0.95}>
                    <Text style={[s.roleBtnTextLabel, rideVibe === vb && s.roleBtnTextLabelActive]}>{vb.toUpperCase()}</Text>
                  </DopaminePressable>
                ))}
              </View>

              <Text style={[s.formLabel, { color: txt }]}>NOTES (OPTIONAL)</Text>
              <TextInput style={[s.formInput, { color: txt, borderColor: border, height: 60 }]} multiline placeholder="Any specific requirements..." placeholderTextColor={txtSec} value={notes} onChangeText={setNotes} />

              <ActionPressable style={s.formSubmitBtn} onPress={handleCreateRide} disabled={submittingRide} sound="success">
                {submittingRide ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.formSubmitText}>POST COMMUTE LISTING 🚀</Text>
                )}
              </ActionPressable>

              <DopaminePressable style={s.formCancelBtn} onPress={() => setShowCreateModal(false)} sound="click">
                <Text style={s.formCancelText}>DISMISS</Text>
              </DopaminePressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} searchMode={activeTab === 'food' ? 'grocery' : 'food'} />

      {/* ── HIGH FIDELITY PRODUCT CATALOG BOTTOM SHEET ── */}
      {selectedCategoryName !== null && (
        <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
          {/* Backdrop */}
          <TouchableOpacity
            activeOpacity={1}
            style={StyleSheet.absoluteFill}
            onPress={closeCatalogSheet}
          >
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: catalogBackdropAnim }]} />
          </TouchableOpacity>

          {/* Sheet Body */}
          <Animated.View
            style={[
              s.catalogContentBox,
              {
                backgroundColor: cardSurface,
                borderTopWidth: 1,
                borderTopColor: border,
                transform: [{ translateY: catalogSheetAnim }],
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '75%',
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 20,
              }
            ]}
          >
            {/* Grab handle bar */}
            <View style={s.grabHandle} />
            
            <View style={s.catalogHeader}>
              <Text style={[s.catalogTitle, { color: txt }]}>{selectedCategoryName?.toUpperCase()}</Text>
              <TouchableOpacity style={s.catalogCloseBtn} onPress={closeCatalogSheet}>
                <Text style={{ fontSize: 18, color: txtSec, fontWeight: '800' }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 4 }}>
                {selectedCategoryName && getCategoryProducts(selectedCategoryName).map(product => {
                  const inCart = cart.find(i => i.id === product.id);
                  const quantity = inCart ? inCart.quantity : 0;
                  const cardWidth = (SW - 40 - 12 - 8) / 2;
                  return (
                    <View
                      key={product.id}
                      style={{
                        width: cardWidth,
                        backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: border,
                        overflow: 'hidden',
                        padding: 10,
                        position: 'relative',
                        justifyContent: 'space-between',
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: isDark ? 0.3 : 0.05,
                        shadowRadius: 8,
                        elevation: 3,
                        marginBottom: 4,
                      }}
                    >
                      {/* Product Image Wrap */}
                      <View style={{ width: '100%', height: 110, borderRadius: 14, overflow: 'hidden', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 10, position: 'relative' }}>
                        <TouchableOpacity
                          style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
                          onPress={() => {
                            closeCatalogSheet();
                            router.push(`/products/${product.id}` as any);
                          }}
                        >
                          <Image
                            source={{ uri: product.image }}
                            style={{ width: '90%', height: '90%' }}
                            resizeMode="contain"
                          />
                        </TouchableOpacity>
                        
                        {product.discount && (
                          <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: '#EA580C', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 }}>
                            <Text style={{ fontSize: 7, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>{product.discount}</Text>
                          </View>
                        )}

                        <View style={{ position: 'absolute', top: 6, right: 6 }}>
                          <View style={{ width: 14, height: 14, borderWidth: 1, borderColor: product.isVeg ? '#22C55E' : '#EF4444', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 2 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: product.isVeg ? '#22C55E' : '#EF4444' }} />
                          </View>
                        </View>
                      </View>

                      {/* Product Info */}
                      <View style={{ flex: 1, justifyContent: 'space-between' }}>
                        <View>
                          <Text style={{ fontSize: 9, color: txtSec, fontWeight: '700', marginBottom: 2 }}>{product.weight}</Text>
                          <Text style={{ fontSize: 12, fontWeight: '900', color: txt, lineHeight: 15, height: 30 }} numberOfLines={2}>{product.name}</Text>
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                          <View>
                            <Text style={{ fontSize: 13, fontWeight: '900', color: txt }}>₹{product.price}</Text>
                            {product.originalPrice > product.price && (
                              <Text style={{ fontSize: 9, color: txtSec, textDecorationLine: 'line-through' }}>₹{product.originalPrice}</Text>
                            )}
                          </View>

                          {/* Stepper / Add button */}
                          <View style={{ minWidth: 60 }}>
                            {quantity > 0 ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#16A34A', borderRadius: 10, paddingHorizontal: 4, height: 26, justifyContent: 'space-between' }}>
                                <TouchableOpacity
                                  style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}
                                  onPress={() => {
                                    const cartKey = cart.find(i => i.id === product.id)?.cartKey || product.id;
                                    updateQuantity(cartKey, quantity - 1);
                                  }}
                                >
                                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>-</Text>
                                </TouchableOpacity>
                                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 10, paddingHorizontal: 4 }}>{quantity}</Text>
                                <TouchableOpacity
                                  style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}
                                  onPress={() => {
                                    addToCart({
                                      id: product.id,
                                      name: product.name,
                                      price: product.price,
                                      image: product.image,
                                      restaurantId: 'mega-basket-vendor',
                                      restaurantName: 'Mega Basket Grocery'
                                    });
                                  }}
                                >
                                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>+</Text>
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <ScalePressable
                                onPress={() => {
                                  addToCart({
                                    id: product.id,
                                    name: product.name,
                                    price: product.price,
                                    image: product.image,
                                    restaurantId: 'mega-basket-vendor',
                                    restaurantName: 'Mega Basket Grocery'
                                  });
                                }}
                              >
                                <View style={{ height: 26, borderWidth: 1, borderColor: '#16A34A', borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'transparent' : '#F0FDF4', flexDirection: 'row', paddingHorizontal: 6 }}>
                                  <Text style={{ fontSize: 9, fontWeight: '900', color: '#16A34A', letterSpacing: 0.5 }}>ADD</Text>
                                  <Text style={{ fontSize: 10, fontWeight: '900', color: '#16A34A', marginLeft: 2 }}>+</Text>
                                </View>
                              </ScalePressable>
                            )}
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </Animated.View>
        </Animated.View>
      )}

      {/* ── FLOATING CART STATUS BAR ── */}
      {hasGroceryItems && (
        <Animated.View style={[s.floatingCartBar, { transform: [{ translateY: cartBarAnim }] }]}>
          <TouchableOpacity 
            activeOpacity={0.95} 
            style={s.floatingCartBarTouch}
            onPress={() => router.push('/checkout' as any)}
          >
            <LinearGradient
              colors={['#16A34A', '#15803D']}
              style={s.floatingCartBarGradient}
            >
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 8 }}>
                <Text style={{ fontSize: 18 }}>🛒</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.cartBarTitle}>{cartCount} ITEM{cartCount > 1 ? 'S' : ''} ADDED</Text>
                  <Text style={s.cartBarSubtitle} numberOfLines={1}>₹{cartSubtotal} • Mega Basket</Text>
                </View>
              </View>
              
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {cartSubtotal < 299 ? (
                  <Text style={[s.cartBarCta, { fontSize: 8.5, opacity: 0.95 }]}>
                    +₹{299 - cartSubtotal} for Free Del.
                  </Text>
                ) : (
                  <Text style={[s.cartBarCta, { fontSize: 9.5 }]}>Free Delivery! 🎉</Text>
                )}
                <View style={{ width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 2 }} />
                <Text style={[s.cartBarCta, { fontSize: 9.5 }]}>VIEW CART</Text>
                <Text style={{ fontSize: 11, color: '#fff', marginLeft: 2 }}>➔</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      )}



      {/* ── FORTUNE SPIN WHEEL OUTCOME MODAL ── */}
      <Modal visible={showWheelModal} transparent={true} animationType="fade">
        <View style={s.promoOverlayCentred}>
          {/* Confetti Animation Layer */}
          {wheelResult !== null && <Confetti />}

          <View style={[s.promoPopupCard, { backgroundColor: isDark ? '#1F2937' : '#fff' }]}>
            {/* Close Button */}
            <TouchableOpacity
              style={s.promoCloseBtn}
              onPress={() => {
                setShowWheelModal(false);
                setWheelResult(null);
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>

            <View style={{ alignItems: 'center', marginVertical: 12 }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>{wheelResult ? '🎉' : '🎡'}</Text>
              <Text style={[s.modalTitle, { color: txt, textAlign: 'center', marginBottom: 4 }]}>
                {wheelResult ? 'CONGRATULATIONS!' : 'BETTER LUCK NEXT TIME!'}
              </Text>
              <Text style={{ fontSize: 9.5, fontWeight: '800', color: txtSec, textAlign: 'center', marginBottom: 12 }}>
                {wheelResult ? 'You won a premium campus reward slice!' : 'Don\'t give up! Reset and spin again.'}
              </Text>

              {wheelResult ? (
                <LinearGradient
                  colors={['#AA7C11', '#D4AF7A', '#AA7C11']}
                  style={{
                    paddingHorizontal: 20,
                    paddingVertical: 16,
                    borderRadius: 20,
                    width: '100%',
                    alignItems: 'center',
                    marginVertical: 10
                  }}
                >
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#000', textAlign: 'center' }}>
                    {wheelResult.label}
                  </Text>
                  <Text style={{ fontSize: 8.5, fontWeight: '800', color: '#451A03', marginTop: 4, letterSpacing: 0.5 }}>
                    COUPON CODE UNLOCKED:
                  </Text>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: '#000', letterSpacing: 1.5, marginTop: 4 }}>
                    {wheelResult.code}
                  </Text>
                </LinearGradient>
              ) : (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: txtSec }}>Try again on your next spin.</Text>
                </View>
              )}

              {wheelResult && (
                <TouchableOpacity
                  onPress={() => {
                    setCopiedCode(wheelResult.code);
                    Alert.alert('Code Copied', `Coupon code "${wheelResult.code}" copied to clipboard!`);
                  }}
                  style={{
                    backgroundColor: '#111827',
                    width: '100%',
                    paddingVertical: 12,
                    borderRadius: 14,
                    alignItems: 'center',
                    marginTop: 10
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>COPY COUPON CODE</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => {
                  setShowWheelModal(false);
                  setWheelResult(null);
                }}
                style={{
                  paddingVertical: 12,
                  marginTop: 6
                }}
              >
                <Text style={{ fontSize: 9.5, fontWeight: '900', color: COLORS.gold, letterSpacing: 1 }}>CONTINUE EXPLORING</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },

  // BigBasket Custom Header Styles
  bbHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 8,
  },
  bbHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  bbHeaderLeft: {
    flex: 1,
  },
  bbProfileBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#16A34A',
    backgroundColor: '#fff',
  },
  bbProfileImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  bbHeaderSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bbSearchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  bbSearchInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    padding: 0,
  },
  bbShortcutsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  bbShortcutBtn: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // BigBasket Product Card Styles
  bbProductCard: {
    width: 140,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 1,
  },
  bbProductCardImgWrap: {
    width: '100%',
    height: 100,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 8,
  },
  bbProductCardImg: {
    width: '90%',
    height: '90%',
    resizeMode: 'contain',
  },
  bbWishlistBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 12,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bbAddBtnOverlapping: {
    position: 'absolute',
    bottom: -6,
    right: -6,
  },
  bbAddBtnSquare: {
    backgroundColor: '#16A34A',
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  bbAddBtnPlus: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  bbStepperOverlapping: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingHorizontal: 4,
    height: 28,
    gap: 4,
  },
  bbStepperBtnMini: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bbStepperBtnTextMini: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  bbStepperQtyMini: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    minWidth: 12,
    textAlign: 'center',
  },
  bbProductCardDetails: {
    flex: 1,
    justifyContent: 'space-between',
  },
  bbProductCardPrice: {
    fontSize: 13,
    fontWeight: '900',
  },
  bbProductCardOrigPrice: {
    fontSize: 10,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
  },
  bbDiscountTag: {
    backgroundColor: '#FEF08A',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  bbDiscountTagText: {
    color: '#854D0E',
    fontSize: 8,
    fontWeight: '900',
  },
  bbProductCardName: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
    lineHeight: 13,
    height: 26,
  },
  bbProductCardWeight: {
    fontSize: 9,
    color: '#64748B',
    fontWeight: '600',
  },

  bbCategoryCardCell: {
    width: (SW - 32 - 18) / 4,
    height: 90,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 6,
    marginBottom: 8,
  },
  bbCategoryCardName: {
    fontSize: 7.5,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 10,
    height: 20,
    marginTop: 2,
  },
  bbCategoryCardImgWrap: {
    width: '100%',
    height: 55,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bbCategoryCardImg: {
    width: '90%',
    height: '90%',
    resizeMode: 'contain',
  },

  // Nav
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  loc: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  greeting: { fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 2 },
  navRight: { flexDirection: 'row', gap: 8 },
  navBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(212, 175, 122, 0.25)' },
  
  // Hero Header
  heroHeader: { alignItems: 'center', marginBottom: 16 },
  ecoBadgeWrapper: { borderRadius: 20, overflow: 'hidden', marginBottom: 8 },
  ecoBadgeGradient: { paddingHorizontal: 16, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  ecoBadgeText: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 4 },
  heroTitle: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  underline: { width: 40, height: 3, backgroundColor: '#D4AF7A', borderRadius: 2, marginTop: 6 },
  
  // Search
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: 1, gap: 10, marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 12, fontWeight: '600', padding: 0 },
  searchBtnGradient: { paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  searchBtnText: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 2 },
  
  // Tabs
  tabRow: { flexDirection: 'row', marginHorizontal: 16, borderRadius: 16, padding: 4, marginBottom: 16, borderWidth: 1 },
  tabBtn: { flex: 1, borderRadius: 12, alignItems: 'center', overflow: 'hidden' },
  tabBtnActive: { },
  tabBtnActiveGradient: { width: '100%', paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  tabLabelActive: { color: '#000' },
  
  // Promo
  promoWrap: { marginHorizontal: 16, borderRadius: 24, overflow: 'hidden', height: 200, marginBottom: 24 },
  promoImg: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  promoOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  promoContent: { flex: 1, justifyContent: 'center', padding: 20, zIndex: 2 },
  promoTag: { fontSize: 9, fontWeight: '900', color: '#D4AF7A', letterSpacing: 4, marginBottom: 6 },
  promoTitle: { fontSize: 24, fontWeight: '900', color: '#fff', fontStyle: 'italic' },
  promoSub: { fontSize: 24, fontWeight: '900', color: '#D4AF7A', fontStyle: 'italic', marginBottom: 6 },
  promoDesc: { fontSize: 7, fontWeight: '700', color: '#bbb', letterSpacing: 2, marginBottom: 14, maxWidth: 250 },
  promoCta: { backgroundColor: '#D4AF7A', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24, alignSelf: 'flex-start', ...SHADOWS.goldGlow },
  promoCtaText: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 3 },
  promoDots: { position: 'absolute', bottom: 12, left: 20, flexDirection: 'row', gap: 4, zIndex: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 20, backgroundColor: '#D4AF7A', borderColor: '#D4AF7A' },
  
  // Departments
  sectionTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 3, paddingHorizontal: 16, marginTop: 24, marginBottom: 16 },
  deptGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12, marginBottom: 28 },
  deptItem: { width: DEPT_SIZE, alignItems: 'center' },
  deptImgWrap: { 
    width: DEPT_SIZE - 4, 
    height: DEPT_SIZE - 4, 
    borderRadius: 18, 
    position: 'relative',
    overflow: 'hidden',
    shadowColor: 'rgba(212, 175, 122, 0.15)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 3,
  },
  deptTextWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 6,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deptName: { fontSize: 7, fontWeight: '900', textAlign: 'center', letterSpacing: 0.5 },
  
  // Trending
  trendCard: { marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', height: 180, marginBottom: 12, position: 'relative' },
  trendImg: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  trendOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  trendContent: { flex: 1, justifyContent: 'flex-end', padding: 16, zIndex: 2 },
  trendTag: { backgroundColor: COLORS.red, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  trendTagText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  trendBadgeWrap: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  trendBadgeText: { fontSize: 8, fontWeight: '700', color: '#fff' },
  trendTitle: { fontSize: 18, fontWeight: '900', color: '#fff', marginBottom: 2 },
  trendDesc: { fontSize: 10, fontWeight: '500', color: 'rgba(255,255,255,0.7)', lineHeight: 14 },

  // PG filters
  filterLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5, marginTop: 12, marginBottom: 6 },
  rowFilters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, borderWidth: 1, marginRight: 4 },
  chipActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  chipText: { fontSize: 8, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 1 },
  chipTextActive: { color: '#fff' },

  // PG Cards
  pgCard: { width: '100%', height: 200, borderRadius: 24, overflow: 'hidden', borderWidth: 1, marginBottom: 16, position: 'relative', ...SHADOWS.card },
  pgCardImg: { ...StyleSheet.absoluteFill, width: '100%', height: '100%', resizeMode: 'cover' },
  pgCardOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  pgCardVerified: { position: 'absolute', top: 12, right: 12, backgroundColor: COLORS.greenRating, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  pgCardVerifiedText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 1.5 },
  pgCardContent: { flex: 1, justifyContent: 'flex-end', padding: 16, zIndex: 2 },
  pgCardGenderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  pgCardGender: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  pgCardDistance: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  pgCardName: { fontSize: 18, fontWeight: '900', color: '#fff' },
  pgCardAddr: { fontSize: 9, fontWeight: '600', color: '#bbb', marginTop: 2, marginBottom: 12 },
  pgCardPriceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pgCardPriceLabel: { fontSize: 7, fontWeight: '800', color: '#aaa', letterSpacing: 1 },
  pgCardPrice: { fontSize: 18, fontWeight: '900', color: COLORS.gold },
  pgCardBookBtn: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  pgCardBookText: { fontSize: 8, fontWeight: '900', color: '#000', letterSpacing: 1 },
  emptyState: { padding: 48, alignItems: 'center', justifyContent: 'center' },

  // Co-Ride styling
  karmaBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 20, borderWidth: 1, marginBottom: 16 },
  karmaLabel: { fontSize: 7, fontWeight: '800', color: COLORS.gold, letterSpacing: 1.5 },
  karmaVal: { fontSize: 18, fontWeight: '900', color: COLORS.gold },
  karmaBadge: { backgroundColor: '#000', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: COLORS.goldBorder },
  karmaBadgeText: { fontSize: 8, fontWeight: '900', color: COLORS.gold, letterSpacing: 1 },

  corideSubTabs: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  corideSubTabBtn: { flex: 1, paddingVertical: 12, borderRadius: 16, alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.borderDark },
  corideSubTabBtnActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  corideSubTabLabel: { fontSize: 9, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 1.5 },
  corideSubTabLabelActive: { color: '#fff' },

  rideCard: { padding: 16, borderRadius: 24, borderWidth: 1, marginBottom: 12 },
  rideCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  rideCreatorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rideAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.goldMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.goldBorder },
  rideAvatarText: { fontSize: 13, fontWeight: '900', color: COLORS.gold },
  rideCreatorName: { fontSize: 12, fontWeight: '800' },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  roleBadgeText: { fontSize: 7, fontWeight: '900', letterSpacing: 1 },

  ridePathRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, marginBottom: 12 },
  rideDotCol: { alignItems: 'center', width: 12 },
  rideDot: { width: 8, height: 8, borderRadius: 4 },
  rideDashLine: { width: 1, height: 24, backgroundColor: COLORS.textMuted, marginVertical: 2 },
  ridePathTextCol: { flex: 1, paddingLeft: 12 },
  ridePathText: { fontSize: 11, fontWeight: '700' },

  rideMetaRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.borderDark, paddingTop: 10 },
  metaLabel: { fontSize: 7, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1 },
  metaVal: { fontSize: 10, fontWeight: '800', marginTop: 1 },

  rideNotesBox: { padding: 10, borderRadius: 12, marginTop: 10 },
  rideNotesText: { fontSize: 9, fontWeight: '500', fontStyle: 'italic' },
  joinBtn: { width: '100%', paddingVertical: 12, borderRadius: 14, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', ...SHADOWS.goldGlow },
  joinBtnText: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 1.5 },

  invoiceCard: { marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: COLORS.borderDark },
  invoiceTitle: { fontSize: 8, fontWeight: '900', color: COLORS.gold, letterSpacing: 2, marginBottom: 8 },
  invoiceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  invoiceLabel: { fontSize: 8, fontWeight: '700', color: COLORS.textSecondary },
  invoiceVal: { fontSize: 9, fontWeight: '800' },

  actionBtn: { paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  completeBtn: { backgroundColor: COLORS.emerald, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  completeBtnText: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  cancelRideBtn: { borderWidth: 1.5, borderColor: '#EF4444', paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cancelRideBtnText: { color: '#EF4444', fontSize: 8, fontWeight: '900', letterSpacing: 1 },

  statusBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },

  floatingFab: { paddingVertical: 14, borderRadius: 16, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', marginVertical: 12, ...SHADOWS.redGlow },
  floatingFabText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 2 },

  // Modal styling
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContentBox: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, height: '80%', alignItems: 'center' },
  modalTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 3, marginBottom: 16 },
  formLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1, alignSelf: 'flex-start', marginTop: 12, marginBottom: 6 },
  formInput: { width: '100%', height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  formRoleRow: { flexDirection: 'row', gap: 10, width: '100%', marginBottom: 6 },
  roleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.borderDark, alignItems: 'center' },
  roleBtnActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  roleBtnTextLabel: { fontSize: 9, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 1 },
  roleBtnTextLabelActive: { color: '#000' },
  formSubmitBtn: { width: '100%', paddingVertical: 14, borderRadius: 16, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', marginTop: 24, ...SHADOWS.redGlow },
  formSubmitText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  formCancelBtn: { width: '100%', paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  formCancelText: { fontSize: 9, fontWeight: '900', color: COLORS.textSecondary, letterSpacing: 2 },

  // Redesigned Grocery Styles
  pillBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  pillBtnActive: { borderColor: '#22C55E' },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  monsoonStoreBanner: { borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' },
  monsoonBannerTitle: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 2, marginVertical: 4 },
  monsoonBannerSubtitle: { fontSize: 8, fontWeight: '900', color: '#34D399', letterSpacing: 1.5 },
  monsoonBannerDesc: { fontSize: 8, fontWeight: '600', color: '#ccc', letterSpacing: 0.5 },
  frogMascotContainer: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },

  oilStackContainer: { height: 160, width: SW, position: 'relative', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginVertical: 12 },
  oilCardStackItem: { width: SW * 0.55, height: 140, position: 'absolute', borderRadius: 20, overflow: 'hidden', ...SHADOWS.card },
  oilCardGradient: { flex: 1, padding: 12, position: 'relative', justifyContent: 'space-between' },
  oilCardLabel: { fontSize: 7, fontWeight: '900', color: 'rgba(255,255,255,0.7)', letterSpacing: 1 },
  oilCardTitle: { fontSize: 14, fontWeight: '900', color: '#fff', letterSpacing: 0.5, lineHeight: 18, marginTop: 4 },
  oilCardImgWrapper: { width: 80, height: 80, position: 'absolute', bottom: -10, right: -10 },
  oilCardImg: { width: '100%', height: '100%', resizeMode: 'contain' },

  healthCardCell: { width: 100, alignItems: 'center' },
  healthCardBacking: { width: 90, height: 90, borderRadius: 24, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' },
  healthCardImg: { width: '80%', height: '80%', resizeMode: 'contain' },
  healthCardText: { fontSize: 9, fontWeight: '900', textAlign: 'center', marginTop: 8, letterSpacing: 0.5, height: 26 },

  wellnessSeeAll: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center' },
  wellnessCard: { width: 140, borderRadius: 20, borderWidth: 1, overflow: 'hidden', ...SHADOWS.card },
  wellnessCardImgWrap: { width: '100%', height: 110, position: 'relative', backgroundColor: 'rgba(0,0,0,0.01)', alignItems: 'center', justifyContent: 'center' },
  wellnessCardImg: { width: '80%', height: '80%', resizeMode: 'contain' },
  discountBadge: { position: 'absolute', bottom: 8, left: 8, backgroundColor: '#F59E0B', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  discountText: { fontSize: 7, fontWeight: '900', color: '#fff' },
  wellnessCardContent: { padding: 10, flex: 1, justifyContent: 'space-between' },
  vegBadge: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegDotInner: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#22C55E' },
  weightLabel: { fontSize: 8, fontWeight: '700', color: '#666' },
  wellnessTitle: { fontSize: 10, fontWeight: '800', marginVertical: 4, height: 32 },
  wellnessPriceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  wellnessPrice: { fontSize: 11, fontWeight: '900' },
  wellnessOriginalPrice: { fontSize: 8, color: '#999', textDecorationLine: 'line-through' },
  addBtnWellness: { backgroundColor: '#fff', borderColor: '#22C55E', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 2 },
  addBtnWellnessText: { fontSize: 9, fontWeight: '900', color: '#22C55E' },
  addBtnWellnessPlus: { fontSize: 9, fontWeight: '900', color: '#22C55E', position: 'absolute', top: 1, right: 3 },
  stepperWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#22C55E', borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' },
  stepperBtn: { paddingHorizontal: 6, paddingVertical: 4, backgroundColor: '#DCFCE7' },
  stepperBtnText: { fontSize: 10, fontWeight: '900', color: '#22C55E' },
  stepperQty: { fontSize: 9, fontWeight: '900', paddingHorizontal: 6, textAlign: 'center', minWidth: 16 },

  categorySectionHeader: { fontSize: 13, fontWeight: '900', letterSpacing: 2, marginBottom: 12 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryItemCell: { width: (SW - 32 - 24) / 4, alignItems: 'center', marginBottom: 16 },
  categoryImageCard: { width: (SW - 32 - 24) / 4, height: (SW - 32 - 24) / 4, borderRadius: 16, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  categoryCellImage: { width: '80%', height: '80%', resizeMode: 'contain' },
  categoryCellName: { fontSize: 8, fontWeight: '800', textAlign: 'center', marginTop: 4, letterSpacing: 0.2 },

  promoOverlayCentred: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  promoPopupCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 28, padding: 18, alignItems: 'center', position: 'relative' },
  promoCloseBtn: { position: 'absolute', top: -36, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  promoPopupHeader: { alignItems: 'center', marginBottom: 14 },
  promoPopupHeaderSub: { fontSize: 11, fontWeight: '800', color: '#666', textAlign: 'center', marginBottom: 8 },
  perksRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  perkBadge: { width: 85, paddingVertical: 6, borderRadius: 10, backgroundColor: '#FEF3C7', borderStyle: 'dashed', borderWidth: 1, borderColor: '#F59E0B', alignItems: 'center' },
  perkBadgeVal: { fontSize: 11, fontWeight: '900', color: '#B45309' },
  perkBadgeLabel: { fontSize: 6, fontWeight: '800', color: '#B45309', textAlign: 'center', marginTop: 2, height: 16 },
  promoPopupGradient: { width: '100%', borderRadius: 20, padding: 14, alignItems: 'center', marginVertical: 8 },
  promoStoreTitle: { fontSize: 14, fontWeight: '900', color: '#fff', letterSpacing: 4, marginBottom: 8 },
  promoItemsGrid: { flexDirection: 'row', gap: 12, width: '100%', justifyContent: 'center', marginVertical: 8 },
  promoPopupItem: { width: 100, alignItems: 'center' },
  promoItemImgBg: { width: 75, height: 75, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  promoItemImg: { width: '80%', height: '80%', resizeMode: 'contain' },
  promoItemTag: { fontSize: 7, fontWeight: '900', backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, color: '#B45309', marginTop: -8 },
  promoItemTitle: { fontSize: 7, fontWeight: '800', color: '#fff', marginTop: 6 },
  promoItemPrice: { fontSize: 11, fontWeight: '900', color: '#FCD34D' },
  promoPesticidesText: { fontSize: 7, fontWeight: '800', color: '#34D399', letterSpacing: 0.5, marginTop: 8 },
  promoPopupCta: { width: '100%', backgroundColor: '#111', paddingVertical: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  promoPopupCtaText: { fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  promoPopupFooterText: { fontSize: 7, color: '#999', marginTop: 8 },

  // Catalog Bottom Sheet Styles
  catalogOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  catalogContentBox: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, height: '75%' },
  grabHandle: { width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  catalogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  catalogTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  catalogCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.03)', alignItems: 'center', justifyContent: 'center' },
  catalogProductRow: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 0.5 },
  catalogProductImgBg: { width: 85, height: 85, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.02)', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  catalogProductImg: { width: '80%', height: '80%', resizeMode: 'contain' },
  catalogDiscountBadge: { position: 'absolute', top: 4, left: 4, backgroundColor: '#F59E0B', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
  catalogDiscountText: { fontSize: 6, fontWeight: '900', color: '#fff' },
  catalogProductTitle: { fontSize: 11, fontWeight: '800', lineHeight: 14 },
  catalogProductPrice: { fontSize: 12, fontWeight: '900' },
  catalogProductOrigPrice: { fontSize: 9, color: '#999', textDecorationLine: 'line-through', marginTop: 1 },

  // Floating Cart Status Bar
  floatingCartBar: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 24 : 16,
    left: 16,
    right: 16,
    zIndex: 90,
  },
  floatingCartBarTouch: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#15803D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  floatingCartBarGradient: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cartBarTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1.5,
  },
  cartBarSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#E8F5E9',
    marginTop: 1,
  },
  cartBarCta: {
    fontSize: 11,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
  },

  // Flash Deal Ticker
  flashDealContainer: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flashBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  flashDealTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#1E293B',
  },
  flashDealTimerLabel: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  flashDealCta: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  flashDealCtaText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
  },

  // Brand Spotlight Grid
  brandGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  brandGridCell: {
    width: (SW - 32 - 16) / 3,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandCellText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  // Interactive Ad Video Card
  adVideoCard: {
    borderRadius: 24,
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  adVideoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  adLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  adLiveText: {
    color: '#94A3B8',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  adBrandTag: {
    color: '#34D399',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  adVideoBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    gap: 16,
  },
  adVideoSubtitle: {
    color: '#38BDF8',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  adVideoTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  adVideoDesc: {
    color: '#94A3B8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
  adVisualPlayer: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  adRotatingDisk: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  musicNoteContainer: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#38BDF8',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adVideoControls: {
    flexDirection: 'row',
    gap: 10,
  },
  adPlayBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adPlayBtnText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  adCtaBtn: {
    flex: 1,
    backgroundColor: '#34D399',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adCtaBtnText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },

  // Smart Cross-Promotion Card
  crossPromoCard: {
    width: SW * 0.65,
    borderRadius: 20,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  crossPromoImg: {
    width: 54,
    height: 54,
    resizeMode: 'contain',
  },
  crossPromoTitle: {
    fontSize: 10,
    fontWeight: '800',
  },
  crossPromoWeight: {
    fontSize: 8,
    color: '#666',
    marginTop: 1,
  },
  crossPromoPrice: {
    fontSize: 11,
    fontWeight: '900',
    flex: 1,
  },
  heroCarouselCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    marginTop: 12,
  },
  heroCarousel: {
    marginHorizontal: 0,
    borderRadius: 0,
    borderWidth: 0,
  },
});
