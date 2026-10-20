import * as Haptics from 'expo-haptics';
import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform, TextInput, ActivityIndicator, Alert, Modal, Linking, Animated, Vibration, RefreshControl, BackHandler } from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from '../../components/SafeImage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams, useFocusEffect, useIsFocused } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, readJson, SERVER_BUSY_MESSAGE, NETWORK_ERROR_MESSAGE } from '../../utils/auth';
import { readCache, writeCache } from '../../utils/swrCache';
import { ENDPOINTS, API_URL, ZENVY_SUPPORT_PHONE } from '../../constants/api';
import { useCart, isCustomRequest } from '../../context/CartContext';
import PromoCarousel from '../../components/PromoCarousel';
import SearchOverlay from '../../components/SearchOverlay';
import AmbientBackground from '../../components/AmbientBackground';
import DopaminePressable, { CardPressable } from '../../components/DopaminePressable';
import { FloatingPulse, BounceIn } from '../../components/AnimatedSection';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import SafeImage from '../../components/SafeImage';
import ShimmerLoader from '../../components/ShimmerLoader';
import { PgListSection } from '../../modules/pg/PgListSection';
import type { PgHome } from '../../modules/pg/pgApi';
import { useLiveSync, hasType } from '../../utils/useLiveSync';
import RentalsSection from '../../modules/rentals/RentalsSection';
import AutoRideSection from '../../modules/autoRide/AutoRideSection';
import { useAutoRideStatus } from '../../modules/autoRide/ui';
import CampusEventsSection from '../../modules/campusEvents/CampusEventsSection';
import { useCampusEventsStatus } from '../../modules/campusEvents/ui';
import { Segmented, KarmaLine, PoolTabs, RideFilters, RideCard, MyRideCard, RideSkeleton, CoRideState, SectionLabel } from '../../modules/coride/CoRideUI';
import PostRideSheet, { maxSeatsFor } from '../../modules/coride/PostRideSheet';
import { fmtRideWhen, groupMyRides, topDestinations, sameDestination, inr } from '../../modules/coride/coRideFormat';

const { width: SW, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SH = SCREEN_HEIGHT;
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

const TABS = [
  { key: 'food', label: 'Food & Basket', icon: '🧺' },
  { key: 'services', label: 'Tech & Repairs', icon: '🛠️' },
  { key: 'pg', label: 'PG Stays', icon: '🏢' },
  { key: 'coride', label: 'Co-Ride', icon: '🏍️' },
  { key: 'rentals', label: 'Rentals', icon: '🚗' },
  // Zenvy Campus Events: shown only while GET /api/campus-events/status says enabled (see visibleTabs).
  { key: 'events', label: 'Campus Events', icon: '🎟️' },
  { key: 'promos', label: 'Deals & Spin', icon: '🎁' },
];

const BB_CATEGORIES = [
  { key: 'Fresh', label: 'Fruits & Veggies', icon: '🍎', bg: '#F0FDF4', border: '#DCFCE7', text: '#15803D' },
  { key: 'Grocery', label: 'Atta & Staples', icon: '🌾', bg: '#FFFBEB', border: '#FEF3C7', text: '#B45309' },
  { key: 'Chips & Namkeens', label: 'Snacks & Chips', icon: '🍟', bg: '#FEF2F2', border: '#FEE2E2', text: '#B91C1C' },
  { key: 'Biscuits & Cakes', label: 'Biscuits & Cakes', icon: '🍪', bg: '#FAF5FF', border: '#F3E8FF', text: '#6B21A8' },
  { key: 'Health', label: 'Health & Care', icon: '🥗', bg: '#ECFDF5', border: '#D1FAE5', text: '#047857' },
  { key: 'Electronics', label: 'Electronics', icon: '🔌', bg: '#F0F9FF', border: '#E0F2FE', text: '#0369A1' },
  { key: 'Toys', label: 'Toys & Play', icon: '🧸', bg: '#EFF6FF', border: '#DBEAFE', text: '#1D4ED8' },
  { key: 'Seeds', label: 'Seeds & Greens', icon: '🌱', bg: '#F5F5F4', border: '#E7E5E4', text: '#44403C' },
];

// Wheel look only. The prizes (labels, order) come from GET /api/rewards/spin-eligibility and the
// server picks the result in POST /api/rewards/use-spin.
const WHEEL_STYLES = [
  { emoji: '🛵', color: '#F59E0B' },
  { emoji: '💎', color: '#10B981' },
  { emoji: '💎', color: '#3B82F6' },
  { emoji: '💎', color: '#8B5CF6' },
  { emoji: '💎', color: '#EC4899' },
  { emoji: '💎', color: '#EF4444' },
  { emoji: '💎', color: '#06B6D4' },
  { emoji: '💎', color: '#6B7280' },
];

const PROMOS_FOOD = [
  { id: 'f1', tagline: 'CAMPUS STATIONERY 📚', title: 'EXAM ESSENTIALS', subtitle: 'STATIONERY HUB', desc: 'Notebooks, pens, lab coats & study kits delivered to your hostel.', btn: 'EXPLORE SUPPLIES →', img: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=600' },
  { id: 'f2', tagline: 'FITNESS GEAR 🏋️', title: 'STAY ACTIVE', subtitle: 'FIT & ACTIVE', desc: 'Skipping ropes, resistance bands & yoga mats for your hostel workouts.', btn: 'SHOP FITNESS →', img: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600' },
  { id: 'f3', tagline: 'NIGHT CANTEEN & PANTRY 🛒', title: 'HOSTEL BASKET', subtitle: 'GROCERY RUN', desc: 'Snacks, dairy, instant noodles & beverages from the campus mart.', btn: 'ORDER GROCERIES →', img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600' },
];

const PROMOS_SERVICES = [
  { id: 's1', tagline: 'LAPTOP & PHONE 💻', title: 'TECH REPAIRS', subtitle: 'ON CAMPUS', desc: 'Screen replacement, fan cleaning, thermal paste & hardware fixes. Book a slot in the app.', btn: 'BOOK REPAIR →', img: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=1200&q=80' },
  { id: 's2', tagline: 'CAMPUS TAILORING ✂️', title: 'UNIFORM & FABRIC', subtitle: 'ALTERATIONS', desc: 'Lab coat tailoring, fitting alterations, blazer adjustments & stitching requests.', btn: 'REQUEST TAILOR →', img: 'https://images.unsplash.com/photo-1528458909336-e7a0adfed0a5?w=1200&q=80' },
  { id: 's3', tagline: 'DOCUMENT HUB 🖨️', title: 'PRINTING', subtitle: '& BINDING', desc: 'Project reports, spiral binding, colour charts and assignment prints.', btn: 'SUBMIT PRINT JOB →', img: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=1200&q=80' },
];

const PROMOS_PG = [
  { id: 'p1', tagline: 'STUDENT STAYS 🏢', title: 'PG RESIDENCES', subtitle: 'NEAR CAMPUS', desc: 'Compare rent, sharing type and distance from campus, then request a bed right here.', btn: 'BROWSE STAYS →', img: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80' },
  { id: 'p2', tagline: 'BOOK IN THE APP 🤝', title: 'REQUEST A BED', subtitle: 'WE CONFIRM IT', desc: 'Send a booking request and the Zenvy housing team confirms it with you.', btn: 'VIEW LISTINGS →', img: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=80' },
];

const PROMOS_CORIDE = [
  // Not shown in the carousel any more (the Co-Ride tab opens on its own mode switch); kept for TAB_PROMOS.
  { id: 'c1', tagline: 'Student bike pool', title: 'Co-Ride', subtitle: 'Split the fuel', desc: 'Share rides between campus, Vijayawada and Guntur with other students and split the fuel.', btn: 'Post a ride →', img: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=1200&q=80' },
  { id: 'c4', tagline: 'Zenvy Auto', title: 'Shared autos', subtitle: 'Book a seat', desc: 'Book a seat in a shared auto with a verified Zenvy driver. Pay the driver at boarding.', btn: 'Book a seat →', img: 'https://images.unsplash.com/photo-1449965408869-ebd13bc9e5a8?w=1200&q=80' },
];

const PROMOS_OFFERS = [
  { id: 'o1', tagline: 'ORDER REWARDS 🎁', title: 'LUCKY REWARD', subtitle: 'SPIN WHEEL', desc: 'Every 2 delivered orders earn a spin. Win ZenPoints or a free-delivery coupon.', btn: 'SPIN THE WHEEL →', img: 'https://images.unsplash.com/photo-1596451190630-186aff535bf2?w=600' },
  { id: 'o2', tagline: 'YOUR COUPONS 🎫', title: 'READY TO USE', subtitle: 'AT CHECKOUT', desc: 'Coupons you have won show up here with their expiry date.', btn: 'SEE MY COUPONS →', img: 'https://images.unsplash.com/photo-1607344645866-009c320b63e0?w=600' },
];

const PROMOS_RENTALS = [
  { id: 'r1', tagline: 'STUDENT VEHICLES 🏍️', title: 'RENT A RIDE', subtitle: 'FROM CLASSMATES', desc: 'Bikes, scooters and cars from college-verified students. PIN pickup, cash at handover.', btn: 'BROWSE VEHICLES →', img: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=1200&q=80' },
  { id: 'r2', tagline: 'EARN FROM YOUR VEHICLE 💸', title: 'RENT IT OUT', subtitle: 'YOU SET THE PRICE', desc: 'List your bike, scooter or car in minutes. Zenvy verifies every renter and their licence.', btn: 'LIST MY VEHICLE →', img: 'https://images.unsplash.com/photo-1449965408869-ebd13bc9e5a8?w=1200&q=80' },
];

const TAB_PROMOS: Record<string, typeof PROMOS_FOOD> = {
  food: PROMOS_FOOD,
  services: PROMOS_SERVICES,
  pg: PROMOS_PG,
  coride: PROMOS_CORIDE,
  rentals: PROMOS_RENTALS,
  promos: PROMOS_OFFERS,
};

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

// Shelf tiles only: each tile's badge ("UP TO x% OFF" / "FROM ₹y") is computed from the real catalogue.
const TOY_MANIA_CATEGORIES = [
  {
    title: 'Vehicle toys',
    image: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=200&q=80',
    bg: '#E0F2FE',
    badgeBg: '#0284C7'
  },
  {
    title: 'Learning & education',
    image: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=200&q=80',
    bg: '#ECFDF5',
    badgeBg: '#059669'
  },
  {
    title: 'Sports & games',
    image: 'https://images.unsplash.com/photo-1531565637446-32307b194362?w=200&q=80',
    bg: '#FFF7ED',
    badgeBg: '#EA580C'
  },
  {
    title: 'Games & plushies',
    image: 'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=200&q=80',
    bg: '#F3E8FF',
    badgeBg: '#7C3AED'
  },
  {
    title: 'Baby & toddler toys',
    image: 'https://images.unsplash.com/photo-1555448248-2571daf6344b?w=200&q=80',
    bg: '#FDF2F8',
    badgeBg: '#DB2777'
  },
  {
    title: 'Fitness ready',
    image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=200&q=80',
    bg: '#FEF9C3',
    badgeBg: '#CA8A04'
  }
];

// ── Store catalogue (GET /api/catalogue/items) ──
// Every product on this screen comes from the server; the price shown is the price charged.
type CatalogueItem = {
  id: string;
  name: string;
  price: number;
  originalPrice: number | null;
  discountPercent: number | null;
  weight: string | null;
  brand: string | null;
  category: string | null;
  image: string | null;
  isVegetarian: boolean;
  isAvailable: boolean;
  orderable: boolean;
  bookingOnly: boolean;
  restaurantId: string;
  storeName: string | null;
  vendorType: string | null;
};

// Store types sold on the Food & Basket tab, and the booking-only service types (for "From ₹X" prices).
const SHOP_TYPES = ['grocery', 'toys', 'seeds', 'electronics'];
const OTHERS_CATALOGUE_KEY = 'others:catalogue';
/** Re-focusing the tab within this window reuses what is on screen (live sync covers edits). */
const FOCUS_REFRESH_MS = 60000;
const SERVICE_TYPES = ['repairs', 'tailoring', 'print', 'laundry', 'home'];
const PRODUCT_FALLBACK_IMG = 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&q=80';
// Custom "please buy this for me" requests keep using the Mega Basket shopping flow (POST /api/mega-basket).
const MEGA_BASKET_VENDOR = 'mega-basket-vendor';

const toCatalogueList = (rawItems: any[]): CatalogueItem[] => {
  const seen = new Set<string>();
  const items: CatalogueItem[] = [];
  rawItems.forEach((raw: any) => {
    const item = toCatalogueItem(raw);
    if (item && !item.bookingOnly && !seen.has(item.id)) { seen.add(item.id); items.push(item); }
  });
  return items;
};

const toCatalogueItem = (raw: any): CatalogueItem | null => {
  if (!raw || !raw.id || !raw.name) return null;
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0) return null;
  const original = Number(raw.originalPrice);
  const discount = Number(raw.discountPercent);
  return {
    id: String(raw.id),
    name: String(raw.name),
    price,
    originalPrice: Number.isFinite(original) && original > price ? original : null,
    discountPercent: Number.isFinite(discount) && discount > 0 ? Math.round(discount) : null,
    weight: raw.weight || null,
    brand: raw.brand || null,
    category: raw.category || null,
    image: raw.image || raw.imageUrl || null,
    isVegetarian: raw.isVegetarian !== false,
    isAvailable: raw.isAvailable !== false,
    orderable: raw.orderable !== false,
    bookingOnly: !!raw.bookingOnly,
    restaurantId: String(raw.restaurantId || raw.storeId || ''),
    storeName: raw.storeName || null,
    vendorType: raw.vendorType || null,
  };
};

const fmtPrice = (n: number) => `₹${Number.isInteger(n) ? n : Number(n).toFixed(2)}`;
const discountLabel = (p: CatalogueItem) => (p.discountPercent ? `${p.discountPercent}% OFF` : null);

// Which catalogue items a tile / pill / brand opens. Anything not listed here matches its own
// category name (or product names containing it). Tiles with no real products are hidden.
type Shelf = { categories?: string[]; keywords?: string[]; vendorTypes?: string[]; deals?: boolean };
const SHELVES: Record<string, Shelf> = {
  'All Groceries': { vendorTypes: ['GROCERY'] },
  Fresh: { categories: ['Fresh', 'Fresh Fruits', 'Fruits', 'Vegetables', 'Leafy Greens'] },
  Grocery: { categories: ['Grocery', 'Atta & Flours', 'Dals & Pulses', 'Rice & Grains', 'Edible Oils & Ghee', 'Masalas & Spices', 'Salt, Sugar & Jaggery', 'Daily Essentials'] },
  Electronics: { vendorTypes: ['ELECTRONICS'] },
  Organic: { categories: ['Organic'] },
  Health: { categories: ['Health', 'Monsoon Wellness Picks'] },
  Deals: { deals: true },
  Toys: { vendorTypes: ['TOYS'] },
  Seeds: { vendorTypes: ['SEEDS'] },
  'Atta & Flours': { categories: ['Atta & Flours'], keywords: ['atta'] },
  'Dals & Pulses': { categories: ['Dals & Pulses'], keywords: [' dal'] },
  'Edible Oils & Ghee': { categories: ['Edible Oils & Ghee'], keywords: ['ghee', ' oil'] },
  'Organic Staples': { categories: ['Organic'] },
  'Chips & Namkeens': { categories: ['Chips & Namkeens', 'Lays'] },
  'Drinks & Juices': { categories: ['Drinks & Juices', 'Coca Cola'] },
  'Tea & Coffee': { categories: ['Tea & Coffee', 'Nescafe'] },
  'Sweet Indulgences': { categories: ['Sweet Indulgences', 'Cadbury'] },
  'Health & Hygiene': { categories: ['Health'] },
  'Detergents & Cleaning': { categories: ['Detergents & Cleaning', 'Surf Excel'] },
  'Fit & active': { categories: ['Fitness ready'] },
};

const shelfItems = (name: string | null, items: CatalogueItem[]): CatalogueItem[] => {
  if (!name) return [];
  const shelf = SHELVES[name] || { categories: [name], keywords: [name] };
  const cats = (shelf.categories || []).map(c => c.toLowerCase());
  const keys = (shelf.keywords || []).map(k => k.toLowerCase());
  const types = shelf.vendorTypes || [];
  const seen = new Set<string>();
  const out = items.filter(i => {
    if (seen.has(i.id)) return false;
    const lowerName = i.name.toLowerCase();
    const lowerBrand = (i.brand || '').toLowerCase();
    const hit = (shelf.deals && (i.discountPercent || 0) >= 10)
      || (!!i.vendorType && types.includes(i.vendorType))
      || (!!i.category && cats.includes(i.category.toLowerCase()))
      || keys.some(k => lowerName.includes(k) || (!!lowerBrand && lowerBrand === k.trim()));
    if (hit) seen.add(i.id);
    return !!hit;
  });
  return shelf.deals ? out.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0)) : out;
};

// Rotating search hint lives in its own component so the whole screen does not re-render every 2.5 s.
const RotatingSearchPlaceholder = memo(({ color, textColor, style }: { color: string; textColor: string; style: any }) => {
  const [idx, setIdx] = useState(0);
  // Only rotates while the Others tab is on screen (the tab stays mounted behind the others).
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    const iv = setInterval(() => setIdx(i => (i + 1) % SEARCH_PLACEHOLDERS.length), 2500);
    return () => clearInterval(iv);
  }, [focused]);
  return (
    <TextInput
      style={[style, { color: textColor }]}
      placeholder={SEARCH_PLACEHOLDERS[idx]}
      placeholderTextColor={color}
      editable={false}
      pointerEvents="none"
    />
  );
});

const CONFETTI_COLORS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#EC4899', '#A855F7'];

// Each piece picks its random look once, so parent re-renders never make the confetti jump.
const ConfettiPiece = () => {
  const cfg = useRef({
    left: Math.random() * SW,
    size: Math.random() * 8 + 6,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    fall: Math.random() * 2000 + 1500,
    spin: Math.random() * 2000 + 1500,
    delay: Math.random() * 500,
  }).current;
  const yAnim = useRef(new Animated.Value(-20)).current;
  const rotAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(yAnim, { toValue: 500, duration: cfg.fall, delay: cfg.delay, useNativeDriver: true }),
      Animated.timing(rotAnim, { toValue: 360, duration: cfg.spin, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: cfg.left,
        width: cfg.size,
        height: cfg.size,
        backgroundColor: cfg.color,
        borderRadius: cfg.size / 2,
        transform: [
          { translateY: yAnim },
          { rotate: rotAnim.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) }
        ]
      }}
    />
  );
};

const Confetti = memo(() => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    {Array.from({ length: 12 }).map((_, i) => <ConfettiPiece key={i} />)}
  </View>
));

export default function OthersScreen() {
  const { isDark, toggleTheme, colors } = useTheme();
  const { user, setUser } = useAuth();
  const router = useRouter();
  const { tab, sub } = useLocalSearchParams<{ tab: string; sub?: string }>();
  const [activeTab, setActiveTab] = useState('food');
  const [groceryMode, setGroceryMode] = useState<'home' | 'categories'>('home');
  const [selectedBBOption, setSelectedBBOption] = useState('Fresh');
  const [showVegOnly, setShowVegOnly] = useState(false);
  const [listText, setListText] = useState('');
  const [showAutoFillCard, setShowAutoFillCard] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemQty, setCustomItemQty] = useState('1');
  const [customItemPrice, setCustomItemPrice] = useState('');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeTab]);

  // Synchronize active tab from navigation parameter (e.g. from Home category pills)
  useEffect(() => {
    if (tab) {
      if (tab === 'rides' || tab === 'coride') {
        setActiveTab('coride');
      } else if (tab === 'services') {
        setActiveTab('services');
      } else if (tab === 'pg' || tab === 'stays') {
        setActiveTab('pg');
      } else if (tab === 'promos' || tab === 'offers') {
        setActiveTab('promos');
      } else if (tab === 'food' || tab === 'basket') {
        setActiveTab('food');
      } else if (tab === 'rentals' || tab === 'rental' || tab === 'vehicles') {
        setActiveTab('rentals');
      } else if (tab === 'events' || tab === 'campus-events') {
        setActiveTab('events');
      }
    }
  }, [tab]);

  // Keep the route param in sync with the chip, so a later Home shortcut (same param) still switches tabs.
  const selectTab = useCallback((key: string) => {
    setActiveTab(key);
    try { router.setParams({ tab: key }); } catch {}
  }, [router]);

  const myId = String(user?._id || user?.id || '');
  // Campus Events chip: GET /api/campus-events/status once (cached); hidden while off or on any error.
  const campusEventsStatus = useCampusEventsStatus(!!myId);
  const campusEventsOn = !!campusEventsStatus?.enabled;
  const visibleTabs = useMemo(() => TABS.filter(t => t.key !== 'events' || campusEventsOn), [campusEventsOn]);
  useEffect(() => {
    if (activeTab === 'events' && campusEventsStatus && !campusEventsStatus.enabled) setActiveTab('food');
  }, [activeTab, campusEventsStatus]);
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const { cart, addToCart, updateQuantity, clearCart } = useCart();
  const [activeCategoryPill, setActiveCategoryPill] = useState('All');
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);

  // ── Store catalogue (real products & prices from the server) ──
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [catalogueStatus, setCatalogueStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [serviceFromPrice, setServiceFromPrice] = useState<Record<string, number>>({});

  const catalogueFromNetRef = useRef(false);
  // Stale-while-revalidate: the last good catalogue paints at once, the network refresh follows.
  useEffect(() => {
    let cancelled = false;
    readCache<any[]>(OTHERS_CATALOGUE_KEY).then((cached) => {
      if (cancelled || !cached || !Array.isArray(cached.data) || !isMountedRef.current) return;
      if (catalogueFromNetRef.current) return; // the network already answered
      setCatalogue(toCatalogueList(cached.data));
      setCatalogueStatus('ready');
    });
    return () => { cancelled = true; };
  }, []);

  const fetchCatalogue = useCallback(async () => {
    setCatalogueStatus(prev => (prev === 'ready' ? prev : 'loading'));
    try {
      // One store type failing (e.g. a slow request) must not blank the whole store.
      const settled = await Promise.allSettled(SHOP_TYPES.map(async t => {
        const res = await apiFetch(`${API_URL}/api/catalogue/items?type=${encodeURIComponent(t)}&limit=200`);
        if (!res.ok) throw new Error(`catalogue ${res.status}`);
        const data = await readJson(res);
        return Array.isArray(data?.items) ? data.items : [];
      }));
      const ok = settled.filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled');
      if (!ok.length) throw (settled[0] as PromiseRejectedResult)?.reason || new Error('catalogue unavailable');
      const raw = ok.map(r => r.value).flat();
      if (!isMountedRef.current) return;
      catalogueFromNetRef.current = true;
      setCatalogue(toCatalogueList(raw));
      setCatalogueStatus('ready');
      // Only a complete response is cached (a partial one would hide a store on the next open)
      if (ok.length === settled.length) writeCache(OTHERS_CATALOGUE_KEY, raw);
    } catch (err) {
      console.warn('[OTHERS_CATALOGUE]', err);
      if (isMountedRef.current) setCatalogueStatus(prev => (prev === 'ready' ? prev : 'error'));
    }
  }, []);

  // "From ₹X" on the service cards, from the real booking catalogue: one small cached call
  // (GET /api/catalogue/min-prices). A server without that endpoint yet falls back to the item lists.
  const fetchServicePrices = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/api/catalogue/min-prices?types=${encodeURIComponent(SERVICE_TYPES.join(','))}`);
      const data = res.ok ? await readJson(res) : null;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const entries = SERVICE_TYPES
          .map(t => [t, Number((data as any)[t])] as const)
          .filter(([, v]) => Number.isFinite(v) && v > 0);
        if (isMountedRef.current) setServiceFromPrice(Object.fromEntries(entries));
        return;
      }
    } catch (err) {
      console.warn('[OTHERS_SERVICE_MIN_PRICES]', err);
    }
    try {
      const entries = await Promise.all(SERVICE_TYPES.map(async t => {
        const res = await apiFetch(`${API_URL}/api/catalogue/items?type=${encodeURIComponent(t)}&limit=200`);
        if (!res.ok) return [t, 0] as const;
        const data = await readJson(res);
        const prices = (Array.isArray(data?.items) ? data.items : []).map((i: any) => Number(i.price)).filter((n: number) => Number.isFinite(n) && n > 0);
        return [t, prices.length ? Math.min(...prices) : 0] as const;
      }));
      if (isMountedRef.current) setServiceFromPrice(Object.fromEntries(entries.filter(([, v]) => v > 0)));
    } catch (err) {
      console.warn('[OTHERS_SERVICE_PRICES]', err);
    }
  }, []);

  const toyShelf = useMemo(() => shelfItems('Toys', catalogue).slice().sort((a, b) => a.price - b.price).slice(0, 8), [catalogue]);
  const seedShelf = useMemo(() => shelfItems('Seeds', catalogue), [catalogue]);
  const wellnessShelf = useMemo(() => shelfItems('Monsoon Wellness Picks', catalogue), [catalogue]);
  const dealShelf = useMemo(() => shelfItems('Deals', catalogue).slice(0, 8), [catalogue]);
  const topDeal = dealShelf[0] || null;
  const toyStartPrice = toyShelf.length ? toyShelf[0].price : null;
  const hasShelf = useCallback((name: string) => catalogueStatus !== 'ready' || shelfItems(name, catalogue).length > 0, [catalogue, catalogueStatus]);

  // One store per order: CartContext shows the Swiggy-style "Replace basket?" prompt.
  // Mega Basket shopping requests are ordered separately, so they never share a basket with store items.
  const addProduct = (product: CatalogueItem) => {
    if (!product.orderable || !product.isAvailable) {
      Alert.alert(
        product.isAvailable ? `${product.storeName || 'This store'} is closed` : 'Sold out',
        product.isAvailable ? 'You can order from here once the store opens again.' : 'This item is out of stock right now. Please check back soon.'
      );
      return;
    }
    const doAdd = () => {
      const added = addToCart({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image || PRODUCT_FALLBACK_IMG,
        restaurantId: product.restaurantId,
        restaurantName: product.storeName || 'Campus store',
      });
      if (added) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    };
    if (cart.some(i => isCustomRequest(i))) {
      Alert.alert(
        'Start a new basket?',
        'Your basket has a shopping request, which is ordered separately. Clear it and add this item?',
        [
          { text: 'Keep basket', style: 'cancel' },
          { text: 'Clear & add', style: 'destructive', onPress: () => { clearCart(); doAdd(); } },
        ]
      );
      return;
    }
    doAdd();
  };

  const openProduct = (product: CatalogueItem) => {
    router.push(`/products/${product.id}` as any);
  };

  // ── SPIN WHEEL & COUPONS (server-driven) ──
  const spinAnim = useRef(new Animated.Value(0)).current;
  const [currentRotation, setCurrentRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [wheelResult, setWheelResult] = useState<{ display: string; type: string; coupon: { code: string; expiryDate?: string } | null } | null>(null);
  const [showWheelModal, setShowWheelModal] = useState(false);
  const [spinsLeft, setSpinsLeft] = useState(0);
  const [spinPrizes, setSpinPrizes] = useState<Array<{ label: string; display?: string; type?: string }>>([]);
  const [spinNextIn, setSpinNextIn] = useState<number | null>(null);
  const [rewardsStatus, setRewardsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [coupons, setCoupons] = useState<any[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const spinLockRef = useRef(false);

  const fetchRewards = useCallback(async () => {
    if (!myId) { setRewardsStatus('ready'); setSpinsLeft(0); setCoupons([]); return; }
    setRewardsStatus(prev => (prev === 'ready' ? prev : 'loading'));
    try {
      const [eligRes, couponRes] = await Promise.all([
        apiFetch(`${API_URL}/api/rewards/spin-eligibility`),
        apiFetch(`${API_URL}/api/rewards/coupons`),
      ]);
      const elig = await readJson(eligRes);
      const couponData = await readJson(couponRes);
      if (!isMountedRef.current) return;
      if (!eligRes.ok && !couponRes.ok) throw new Error('rewards unavailable');
      if (eligRes.ok && elig) {
        setSpinsLeft(Math.max(0, Number(elig.spinsAvailable) || 0));
        setSpinNextIn(Number.isFinite(Number(elig.nextMilestoneIn)) ? Number(elig.nextMilestoneIn) : null);
        if (Array.isArray(elig.prizes)) setSpinPrizes(elig.prizes);
      }
      if (couponRes.ok) setCoupons(Array.isArray(couponData) ? couponData : []);
      setRewardsStatus('ready');
    } catch (err) {
      console.warn('[OTHERS_REWARDS]', err);
      if (isMountedRef.current) setRewardsStatus(prev => (prev === 'ready' ? prev : 'error'));
    }
  }, [myId]);

  // -- MICRO ANIMATIONS + STAGGERED ENTRANCE SYSTEM --
  const spinBtnScale = useRef(new Animated.Value(1)).current;
  const coinFloatAnim = useRef(new Animated.Value(0)).current;
  const btnScaleAnim = useRef(new Animated.Value(1)).current;
  const [popBtnCode, setPopBtnCode] = useState<string | null>(null);

  // Staggered entrance values (hero, wheel, coupons)
  const heroEnterO = useRef(new Animated.Value(0)).current;
  const heroEnterY = useRef(new Animated.Value(40)).current;
  const wheelEnterO = useRef(new Animated.Value(0)).current;
  const wheelEnterY = useRef(new Animated.Value(50)).current;
  const wheelScaleIn = useRef(new Animated.Value(0.7)).current;
  const couponsEnterO = useRef(new Animated.Value(0)).current;
  const couponsEnterY = useRef(new Animated.Value(40)).current;

  // Wheel ambient effects
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
      [heroEnterO, wheelEnterO, couponsEnterO,
       coupon0O, coupon1O, coupon2O, coupon3O].forEach(a => a.setValue(0));
      heroEnterY.setValue(40); wheelEnterY.setValue(50);
      couponsEnterY.setValue(40);
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
        enter(couponsEnterO, couponsEnterY, 450),
        ...couponAnims.map((ca, i) =>
          Animated.sequence([
            Animated.delay(550 + i * 100),
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
        Animated.timing(coinFloatAnim, { toValue: -4, duration: 1200, useNativeDriver: true }),
        Animated.timing(coinFloatAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
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
    try {
      Clipboard.setString(code);
    } catch {}
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

  // The server picks the prize; the wheel only animates to the slice it returned.
  const handleSpin = async () => {
    if (isSpinning || spinLockRef.current) return;
    if (!myId) {
      Alert.alert('Log in to spin', 'Spins are earned with delivered orders. Log in to see yours.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Log in', onPress: () => router.push('/login' as any) },
      ]);
      return;
    }
    if (spinsLeft <= 0) {
      Alert.alert('No spins yet', spinNextIn
        ? `Every 2 delivered orders earn a spin. ${spinNextIn} more order${spinNextIn === 1 ? '' : 's'} to go!`
        : 'Every 2 delivered orders earn you a spin.');
      return;
    }
    spinLockRef.current = true;
    setIsSpinning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    let data: any = null;
    try {
      const res = await apiFetch(`${API_URL}/api/rewards/use-spin`, { method: 'POST', body: JSON.stringify({}) });
      data = await readJson(res);
      if (!res.ok || !data || !Number.isInteger(data.prizeIndex)) {
        if (isMountedRef.current) {
          setIsSpinning(false);
          if (Number.isFinite(Number(data?.spinsAvailable))) setSpinsLeft(Number(data.spinsAvailable));
          Alert.alert('Could not spin', data?.message || (res.status >= 500 ? SERVER_BUSY_MESSAGE : 'Please try again in a moment.'));
          if (res.status === 400) fetchRewards();
        }
        spinLockRef.current = false;
        return;
      }
    } catch {
      if (isMountedRef.current) {
        setIsSpinning(false);
        Alert.alert('Could not spin', NETWORK_ERROR_MESSAGE);
      }
      spinLockRef.current = false;
      return;
    }

    const sectorCount = Math.max(1, spinPrizes.length || WHEEL_STYLES.length);
    const sectorAngle = 360 / sectorCount;
    const winnerIdx = ((data.prizeIndex % sectorCount) + sectorCount) % sectorCount;
    // Normalise to the wheel's current absolute angle so every spin lands on the announced slice.
    const norm = ((currentRotation % 360) + 360) % 360;
    const targetAngle = (360 - winnerIdx * sectorAngle) % 360;
    const targetRotation = currentRotation - norm + 1800 + targetAngle;

    Animated.timing(spinAnim, {
      toValue: targetRotation,
      duration: 4000,
      useNativeDriver: true,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    }).start(() => {
      spinLockRef.current = false;
      if (!isMountedRef.current) return;
      setIsSpinning(false);
      setCurrentRotation(targetRotation);
      setSpinsLeft(Math.max(0, Number(data.spinsAvailable) || 0));
      if (Number.isFinite(Number(data.zenPoints))) setUser({ zenPoints: Number(data.zenPoints) } as any);
      setWheelResult({
        display: data.prize?.display || data.message || 'You won a reward!',
        type: data.prize?.type || 'points',
        coupon: data.coupon || null,
      });
      setShowWheelModal(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      fetchRewards();
    });
  };

  const tabContentFade = useRef(new Animated.Value(0)).current;
  const tabContentTranslateY = useRef(new Animated.Value(20)).current;

  // Backdrop & Sheet Animations
  const catalogBackdropAnim = useRef(new Animated.Value(0)).current;
  const catalogSheetAnim = useRef(new Animated.Value(600)).current;

  // Floating Cart Status Bar Animation
  const cartBarAnim = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    tabContentFade.setValue(0);
    tabContentTranslateY.setValue(20);
    Animated.parallel([
      Animated.timing(tabContentFade, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(tabContentTranslateY, { toValue: 0, friction: 8, tension: 45, useNativeDriver: true }),
    ]).start();
  }, [activeTab]);

  // Bottom Sheet animation trigger
  useEffect(() => {
    if (selectedCategoryName !== null) {
      catalogBackdropAnim.setValue(0);
      catalogSheetAnim.setValue(600);
      Animated.parallel([
        Animated.timing(catalogBackdropAnim, { toValue: 0.65, duration: 250, useNativeDriver: true }),
        Animated.spring(catalogSheetAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
      ]).start();
    }
  }, [selectedCategoryName]);

  const closeCatalogSheet = () => {
    Animated.parallel([
      Animated.timing(catalogBackdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(catalogSheetAnim, { toValue: 600, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      if (isMountedRef.current) setSelectedCategoryName(null);
    });
  };

  // Android back closes the product sheet first instead of leaving the tab.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (selectedCategoryName !== null) {
          closeCatalogSheet();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [selectedCategoryName])
  );

  // Basket bar: only the lines from this screen's stores (plus Mega Basket shopping requests).
  const catalogueStoreIds = useMemo(() => new Set(catalogue.map(i => i.restaurantId)), [catalogue]);
  const shopLines = cart.filter(i => catalogueStoreIds.has(String(i.restaurantId)) || isCustomRequest(i));
  const hasShopItems = shopLines.length > 0;
  const shopSubtotal = shopLines.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const shopCount = shopLines.reduce((sum, item) => sum + item.quantity, 0);
  const shopStoreName = shopLines.find(i => !isCustomRequest(i))?.restaurantName || 'Mega Basket';

  // Floating Cart Bar animation trigger
  useEffect(() => {
    if (hasShopItems && activeTab === 'food') {
      Animated.spring(cartBarAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }).start();
    } else {
      Animated.timing(cartBarAnim, { toValue: 100, duration: 200, useNativeDriver: true }).start();
    }
  }, [hasShopItems, activeTab, shopCount]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Global search text
  const [searchQuery, setSearchQuery] = useState('');

  // ── PG States ──
  const [pgs, setPgs] = useState<any[]>([]);
  const [loadingPgs, setLoadingPgs] = useState(false);
  const [pgError, setPgError] = useState<string | null>(null);
  // PG list page extras (promotions, room tours, rails) from GET /api/pg/home; null on older servers.
  const [pgHome, setPgHome] = useState<PgHome | null>(null);

  // ── Co-Ride States ──
  const [corideTab, setCorideTab] = useState<'browse' | 'my-rides' | 'auto'>('browse');
  // Zenvy Auto-Ride (verified drivers): its sub-tab exists only while GET /api/auto-ride/status says enabled.
  const autoRideStatus = useAutoRideStatus(!!(user?._id || user?.id));
  const autoRideOn = !!autoRideStatus?.enabled;
  useEffect(() => {
    if ((tab === 'coride' || tab === 'rides') && sub === 'auto') setCorideTab('auto');
  }, [tab, sub]);
  const [rides, setRides] = useState<any[]>([]);
  const [myRides, setMyRides] = useState<any[]>([]);
  const [loadingRides, setLoadingRides] = useState(false);
  const [loadingMyRides, setLoadingMyRides] = useState(false);
  const [rideError, setRideError] = useState<string | null>(null);
  const [myRidesError, setMyRidesError] = useState<string | null>(null);
  const [rideActionBusy, setRideActionBusy] = useState<string | null>(null);
  const rideBusyRef = useRef(false);

  // Co-Ride Filter States
  const [vehicleFilter, setVehicleFilter] = useState<'All' | 'Bike' | 'Car' | 'Auto'>('All');
  // "Going to" quick filter: one of the destinations in the loaded rides (client-side only).
  const [goingTo, setGoingTo] = useState<string | null>(null);

  // Co-Ride Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatorRole, setCreatorRole] = useState<'rider' | 'passenger'>('rider');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [vehicleType, setVehicleType] = useState('Bike');
  const [availableSeats, setAvailableSeats] = useState('1');
  const [estimatedFuelCost, setEstimatedFuelCost] = useState('0');
  const [notes, setNotes] = useState('');
  const [rideVibe, setRideVibe] = useState('Any');
  const [autoApprove, setAutoApprove] = useState(false);
  const [submittingRide, setSubmittingRide] = useState(false);
  const submittingRideRef = useRef(false); // a double tap lands before the state flips (two rides posted)

  // Ordering hours (real: GET /api/orders/serviceability)
  const [serviceability, setServiceability] = useState<{ open: boolean; reopensAt?: string } | null>(null);

  // 5xx bodies can carry raw server/database errors: never show those to a student.
  const friendlyError = (res: Response | null, data: any, fallback: string): string => {
    if (res && res.status >= 500) return SERVER_BUSY_MESSAGE;
    const msg = data && typeof data.message === 'string' ? data.message.trim() : '';
    if (!msg || msg === 'Unauthorized') return fallback;
    if (/gender preferences mismatch/i.test(msg)) return 'This ride is set to same-gender riders only, so you cannot join it.';
    return msg;
  };

  const fmtClock = (hhmm?: string) => {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const h = parseInt(m[1], 10);
    return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
  };

  const promptLogin = (title: string, message: string) => {
    Alert.alert(title, message, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Log in', onPress: () => router.push('/login' as any) },
    ]);
  };

  const openExternal = (url: string, name: string) => {
    Linking.openURL(url).catch(() => Alert.alert(`Couldn't open ${name}`, 'Please try again, or open the app directly.'));
  };

  const fetchServiceability = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/api/orders/serviceability`);
      const data = await readJson(res);
      if (res.ok && data && typeof data.open === 'boolean' && isMountedRef.current) {
        setServiceability({ open: data.open, reopensAt: data.reopensAt });
      }
    } catch {
      // The badge simply stays hidden when we cannot tell.
    }
  }, []);

  // Load PG lists
  // silent = live-sync background refresh: keep the current list, no skeleton, no error card
  const fetchPGs = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoadingPgs(true);
    try {
      // One request for the whole PG page; the plain list is the fallback for an older server.
      let res = await apiFetch(`${API_URL}/api/pg/home`);
      let data = await readJson(res);
      const home = res.ok && data && Array.isArray(data.pgs) ? (data as PgHome) : null;
      if (!home && res.status === 404) { res = await apiFetch(ENDPOINTS.pgList); data = await readJson(res); }
      if (!isMountedRef.current) return;
      if (res.ok) {
        setPgs(home ? home.pgs : Array.isArray(data) ? data : []);
        setPgHome(home);
        setPgError(null);
      } else if (!silent) {
        setPgError(friendlyError(res, data, 'We could not load PG stays right now.'));
      }
    } catch {
      if (isMountedRef.current && !silent) setPgError(NETWORK_ERROR_MESSAGE);
    } finally {
      if (isMountedRef.current && !silent) setLoadingPgs(false);
    }
  }, []);

  // Load Co-Ride lists
  const fetchRides = useCallback(async () => {
    setLoadingRides(true);
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolPosts);
      const data = await readJson(res);
      if (!isMountedRef.current) return;
      if (res.ok) {
        setRides(Array.isArray(data) ? data : []);
        setRideError(null);
      } else {
        setRideError(friendlyError(res, data, 'We could not load rides right now.'));
      }
    } catch {
      if (isMountedRef.current) setRideError(NETWORK_ERROR_MESSAGE);
    } finally {
      if (isMountedRef.current) setLoadingRides(false);
    }
  }, []);

  // Load User commutes
  const fetchMyRides = useCallback(async () => {
    setLoadingMyRides(true);
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolMyRides);
      const data = await readJson(res);
      if (!isMountedRef.current) return;
      if (res.ok) {
        setMyRides(Array.isArray(data) ? data : []);
        setMyRidesError(null);
      } else {
        setMyRidesError(friendlyError(res, data, 'We could not load your rides right now.'));
      }
    } catch {
      if (isMountedRef.current) setMyRidesError(NETWORK_ERROR_MESSAGE);
    } finally {
      if (isMountedRef.current) setLoadingMyRides(false);
    }
  }, []);

  // Load whatever the visible tab needs (on focus, on tab change and on pull-to-refresh).
  // force = pull-to-refresh. Otherwise a job that ran less than FOCUS_REFRESH_MS ago is skipped:
  // every tab switch used to refire 5-10 requests (serviceability + one per store type).
  const lastLoadRef = useRef<Record<string, number>>({});
  const loadActiveTab = useCallback((force = false) => {
    const jobs: Promise<any>[] = [];
    // Throttled: shared listings that live sync keeps fresh. Per-user data (rides, rewards) always reloads.
    const run = (name: string, job: () => Promise<any>, throttle = true) => {
      const now = Date.now();
      if (throttle && !force && now - (lastLoadRef.current[name] || 0) < FOCUS_REFRESH_MS) return;
      lastLoadRef.current[name] = now;
      jobs.push(job());
    };
    run('serviceability', fetchServiceability);
    if (activeTab === 'food') run('catalogue', fetchCatalogue);
    else if (activeTab === 'services') { run('servicePrices', fetchServicePrices); run('catalogue', fetchCatalogue); }
    else if (activeTab === 'pg') run('pg', () => fetchPGs());
    else if (activeTab === 'coride' && myId) { run('rides', fetchRides, false); run('myRides', fetchMyRides, false); }
    else if (activeTab === 'promos') run('rewards', fetchRewards, false);
    return Promise.all(jobs);
  }, [activeTab, myId, fetchServiceability, fetchCatalogue, fetchServicePrices, fetchPGs, fetchRides, fetchMyRides, fetchRewards]);

  useFocusEffect(
    useCallback(() => {
      loadActiveTab(false);
    }, [loadActiveTab])
  );

  // Live sync: admin / store edits refresh the visible tab in place. fetchCatalogue / fetchRewards
  // keep the shown data while they reload, fetchPGs runs silent; nothing flashes a skeleton.
  useLiveSync({
    types: ['store', 'product', 'pg', 'coupon'],
    onChange: (events) => {
      const catalogueChanged = hasType(events, 'store', 'product');
      if (catalogueChanged) fetchServiceability();
      if (activeTab === 'food' && catalogueChanged) fetchCatalogue();
      else if (activeTab === 'services' && catalogueChanged) { fetchServicePrices(); fetchCatalogue(); }
      else if (activeTab === 'pg' && hasType(events, 'pg')) fetchPGs({ silent: true });
      else if (activeTab === 'promos' && hasType(events, 'coupon')) fetchRewards();
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadActiveTab(true);
    } finally {
      if (isMountedRef.current) setRefreshing(false);
    }
  }, [loadActiveTab]);

  // ── Co-Ride actions (confirmations + one action at a time) ──
  const runRideAction = async (rideId: string, request: () => Promise<Response>, successTitle: string, fallback: string, successBody?: string) => {
    if (rideBusyRef.current) return;
    rideBusyRef.current = true;
    setRideActionBusy(rideId);
    try {
      const res = await request();
      const data = await readJson(res);
      if (!isMountedRef.current) return;
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        // Completing a ride awards Karma: keep the banner in step with the server.
        if (Number.isFinite(Number(data?.karmaPoints))) setUser({ karmaPoints: Number(data.karmaPoints) } as any);
        Alert.alert(successTitle, successBody || data?.message || 'Done.');
        fetchRides();
        fetchMyRides();
      } else {
        Alert.alert('Could not update the ride', friendlyError(res, data, fallback));
      }
    } catch {
      if (isMountedRef.current) Alert.alert('Could not update the ride', NETWORK_ERROR_MESSAGE);
    } finally {
      rideBusyRef.current = false;
      if (isMountedRef.current) setRideActionBusy(null);
    }
  };

  const fuelText = (ride: any) => {
    const fuel = Number(ride.estimatedFuelCost) || 0;
    return fuel > 0 ? `${inr(fuel)} in total, shared by everyone on the ride` : 'No fuel split';
  };

  const handleJoinRide = (ride: any) => {
    if (!myId) { promptLogin('Log in to join rides', 'Co-rides are only for signed-in students.'); return; }
    const together = ride.creatorRole === 'passenger';
    Alert.alert(
      together ? 'Ride together?' : 'Join this ride?',
      `Route: ${ride.origin} → ${ride.destination}\nLeaves: ${fmtRideWhen(ride.departureTime).label}\n${ride.vehicleType === 'Auto' ? 'Fare' : 'Fuel'}: ${fuelText(ride)}\n${together ? 'Posted by' : 'Host'}: ${ride.creator?.name || 'A campus student'}`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: ride.autoApprove ? 'Join ride' : 'Request to join',
          onPress: () => runRideAction(
            ride.id,
            () => apiFetch(ENDPOINTS.bikepoolJoin(ride.id), { method: 'POST' }),
            ride.autoApprove ? 'You’re on this ride' : 'Request sent',
            'Could not join this ride.',
            ride.autoApprove
              ? 'You are on this ride. Open My rides to message the host on WhatsApp.'
              : 'The host will review your request. You can follow it in My rides.'
          ),
        },
      ]
    );
  };

  const handleCompleteRide = (rideId: string) => {
    Alert.alert('Mark this ride as completed?', 'Do this once everyone has reached. Everyone on the ride earns Karma points.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Complete ride', onPress: () => runRideAction(rideId, () => apiFetch(ENDPOINTS.bikepoolComplete(rideId), { method: 'POST' }), 'Ride completed', 'Could not complete this ride.') },
    ]);
  };

  const handleCancelRide = (rideId: string, kind: 'host' | 'leave' | 'withdraw') => {
    const copy = kind === 'host'
      ? { title: 'Cancel this ride?', body: 'Everyone who joined or requested will be released.', cta: 'Cancel ride' }
      : kind === 'leave'
        ? { title: 'Leave this ride?', body: 'Your seat will be offered to other students.', cta: 'Leave ride' }
        : { title: 'Withdraw your request?', body: 'The host will no longer see your request.', cta: 'Withdraw' };
    Alert.alert(copy.title, copy.body, [
      { text: 'Keep', style: 'cancel' },
      { text: copy.cta, style: 'destructive', onPress: () => runRideAction(rideId, () => apiFetch(ENDPOINTS.bikepoolCancel(rideId), { method: 'POST' }), 'Done', 'Could not update this ride.') },
    ]);
  };

  const handleApproveRequest = (rideId: string, requestId: string) => {
    runRideAction(rideId, () => apiFetch(`${API_URL}/api/bikepool/posts/${rideId}/requests/${requestId}/approve`, { method: 'POST' }), 'Rider approved', 'Could not approve this request.');
  };

  const handleRejectRequest = (rideId: string, requestId: string) => {
    runRideAction(rideId, () => apiFetch(`${API_URL}/api/bikepool/posts/${rideId}/requests/${requestId}/reject`, { method: 'POST' }), 'Request declined', 'Could not decline this request.');
  };

  const contactOnWhatsApp = (phone: any) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) {
      Alert.alert('Contact unavailable', 'This student has not shared a phone number.');
      return;
    }
    const intl = digits.length === 10 ? `91${digits}` : digits;
    openExternal(`https://wa.me/${intl}`, 'WhatsApp');
  };

  const handleSOS = () => {
    Alert.alert('Need help?', 'Call for help right away.', [
      { text: 'Call 112 (Emergency)', style: 'destructive', onPress: () => openExternal('tel:112', 'the dialer') },
      { text: 'Call Zenvy Support', onPress: () => openExternal(`tel:+${ZENVY_SUPPORT_PHONE}`, 'the dialer') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openCreateRide = () => {
    if (!myId) { promptLogin('Log in to post a ride', 'Co-rides are only for signed-in students.'); return; }
    setShowCreateModal(true);
  };

  const handleCreateRide = async () => {
    if (submittingRide || submittingRideRef.current) return;
    const o = origin.trim();
    const d = destination.trim();
    const n = notes.trim();
    if (!o || !d || !departureTime.trim()) {
      Alert.alert('A few details missing', 'Please add where you start, where you are going and when you leave.');
      return;
    }

    let parsedDate = departureDate ? new Date(departureDate) : new Date(departureTime);
    if (isNaN(parsedDate.getTime())) {
      // Time only, e.g. "18:30" or "6:30 PM"
      const timeMatch = departureTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const meridiem = timeMatch[3]?.toUpperCase();
        if (meridiem === 'PM' && hours < 12) hours += 12;
        if (meridiem === 'AM' && hours === 12) hours = 0;
        parsedDate = new Date();
        parsedDate.setHours(hours, minutes, 0, 0);
        if (parsedDate.getTime() < Date.now()) parsedDate.setDate(parsedDate.getDate() + 1);
      }
    }

    if (isNaN(parsedDate.getTime())) {
      Alert.alert('Check the departure time', 'Pick a quick option or type a time like "18:30" or "6:30 PM".');
      return;
    }
    if (parsedDate.getTime() < Date.now() - 5 * 60 * 1000) {
      Alert.alert('That time has passed', 'Please pick a departure time in the future.');
      return;
    }

    // Bike 1 seat, car up to 4 (the server accepts 1 to 6).
    const seats = Math.min(maxSeatsFor(vehicleType), Math.max(1, parseInt(availableSeats, 10) || 1));
    const fuel = Math.min(5000, Math.max(0, Math.round(Number(estimatedFuelCost) || 0)));

    submittingRideRef.current = true;
    setSubmittingRide(true);
    try {
      const res = await apiFetch(ENDPOINTS.bikepoolPosts, {
        method: 'POST',
        body: JSON.stringify({
          creatorRole,
          origin: o,
          destination: d,
          departureTime: parsedDate.toISOString(),
          vehicleType,
          availableSeats: seats,
          estimatedFuelCost: fuel,
          notes: n,
          rideVibe,
          autoApprove,
        })
      });
      const data = await readJson(res);
      if (!isMountedRef.current) return;
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Ride posted', autoApprove
          ? 'Students heading the same way can now join your ride.'
          : 'Students heading the same way can now request to join. You approve who rides with you.');
        setShowCreateModal(false);
        setOrigin('');
        setDestination('');
        setDepartureTime('');
        setDepartureDate(null);
        setAvailableSeats('1');
        setEstimatedFuelCost('0');
        setNotes('');
        setRideVibe('Any');
        setAutoApprove(false);
        setCorideTab('my-rides');
        fetchRides();
        fetchMyRides();
      } else {
        Alert.alert('Could not post the ride', friendlyError(res, data, 'Please check the details and try again.'));
      }
    } catch {
      if (isMountedRef.current) Alert.alert('Could not post the ride', NETWORK_ERROR_MESSAGE);
    } finally {
      submittingRideRef.current = false;
      if (isMountedRef.current) setSubmittingRide(false);
    }
  };

  // ── Mega Basket: quick list & custom shopping requests ──
  const handleSmartAutoFill = () => {
    if (!listText.trim()) {
      Alert.alert('Your list is empty', 'Type or paste your shopping list first, e.g. "2 maggi, 1 atta".');
      return;
    }
    if (catalogueStatus !== 'ready' || catalogue.length === 0) {
      Alert.alert('Store is still loading', 'Give it a second and try again.');
      return;
    }

    const matched: { item: CatalogueItem; qty: number }[] = [];
    const missed: string[] = [];
    listText.split(/[,\n;]+/).map(t => t.trim()).filter(Boolean).forEach(line => {
      const qtyMatch = line.match(/^(\d+)\s*(x\s*)?/i);
      const qty = Math.min(20, Math.max(1, qtyMatch ? parseInt(qtyMatch[1], 10) : 1));
      const q = line.replace(/^(\d+)\s*(x\s*)?/i, '').trim().toLowerCase();
      if (!q) return;
      const item = catalogue.find(p => p.orderable && p.isAvailable && (p.name.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)));
      if (item) matched.push({ item, qty });
      else missed.push(line);
    });

    if (matched.length === 0) {
      Alert.alert('No matches found', 'Try simple words like "atta", "chips" or "maggi" — or add it as a custom request.');
      return;
    }

    // One store per order: keep the lines from the first matched store.
    const storeId = matched[0].item.restaurantId;
    const sameStore = matched.filter(m => m.item.restaurantId === storeId);
    const skipped = matched.length - sameStore.length;
    let shownPrompt = false;
    sameStore.forEach(m => {
      const ok = addToCart({
        id: m.item.id,
        name: m.item.name,
        price: m.item.price,
        quantity: m.qty,
        image: m.item.image || PRODUCT_FALLBACK_IMG,
        restaurantId: m.item.restaurantId,
        restaurantName: m.item.storeName || 'Campus store',
      });
      if (!ok) shownPrompt = true;
    });

    setListText('');
    setShowAutoFillCard(false);
    if (shownPrompt) return; // the "Replace basket?" prompt is already on screen

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const notes2: string[] = [];
    if (missed.length) notes2.push(`Not found: ${missed.join(', ')}`);
    if (skipped) notes2.push(`${skipped} item${skipped === 1 ? '' : 's'} from another store were skipped (one store per order).`);
    Alert.alert('Added to basket ⚡', `${sameStore.length} item${sameStore.length === 1 ? '' : 's'} from ${sameStore[0].item.storeName || 'the store'}.${notes2.length ? `\n\n${notes2.join('\n')}` : ''}`);
  };

  const openCustomRequest = () => {
    setGroceryMode('categories');
    setShowAutoFillCard(false);
    setShowCustomForm(true);
  };

  const handleAddCustomRequest = () => {
    const name = customItemName.trim();
    if (!name) {
      Alert.alert('What should we buy?', 'Please type the item name (and brand, if you have one in mind).');
      return;
    }
    const price = Number(customItemPrice);
    if (!Number.isFinite(price) || price <= 0 || price > 10000) {
      Alert.alert('Add an estimated price', 'Enter the approximate price per unit (₹1 – ₹10,000). You approve the real bill later.');
      return;
    }
    const qty = Math.min(20, Math.max(1, parseInt(customItemQty, 10) || 1));

    const doAdd = () => {
      addToCart({
        id: `custom-${Date.now()}`,
        name: `[Custom Request] ${name}`,
        price: Math.round(price * 100) / 100,
        quantity: qty,
        image: '', // a shopping request has no product photo; the basket shows its placeholder
        restaurantId: MEGA_BASKET_VENDOR,
        restaurantName: 'Mega Basket',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Request added 🛍️', `"${name}" × ${qty} is in your basket. A Zenvy shopper buys it for you, and you approve the final bill before paying.`);
      setCustomItemName('');
      setCustomItemPrice('');
      setCustomItemQty('1');
      setShowCustomForm(false);
    };

    // Shopping requests are placed separately from store orders.
    if (cart.some(i => !isCustomRequest(i))) {
      Alert.alert(
        'Start a new basket?',
        'Shopping requests are ordered separately from store and restaurant items. Clear your basket and add this request?',
        [
          { text: 'Keep basket', style: 'cancel' },
          { text: 'Clear & add', style: 'destructive', onPress: () => { clearCart(); doAdd(); } },
        ]
      );
      return;
    }
    doAdd();
  };

  // Filter available ride posts
  const vehicleRides = rides.filter(ride => vehicleFilter === 'All' || ride.vehicleType === vehicleFilter);
  const rideDestinations = useMemo(() => topDestinations(vehicleRides), [vehicleRides]);
  const filteredRides = goingTo ? vehicleRides.filter(ride => sameDestination(ride.destination, goingTo)) : vehicleRides;
  const myRideGroups = useMemo(() => groupMyRides(myRides, myId), [myRides, myId]);
  // Rides I already asked to join (from My Rides), so Browse does not offer "Request to join" twice.
  const myJoinStatus = useMemo(() => {
    const map: Record<string, string> = {};
    myRides.forEach(r => {
      const mine = (Array.isArray(r.requests) ? r.requests : []).find((q: any) => String(q.passengerId) === myId);
      if (mine && (mine.status === 'Pending' || mine.status === 'Approved')) map[String(r.id)] = mine.status;
    });
    return map;
  }, [myRides, myId]);

  // ── Saved items (stored on this device; cleared on logout) ──
  type SavedItem = { id: string; title: string; subtitle: string; price: string; image: string; targetRoute: string };
  const [favoritesModalVisible, setFavoritesModalVisible] = useState(false);
  const [savedFavoritesList, setSavedFavoritesList] = useState<SavedItem[]>([]);
  const [legacyWishlistIds, setLegacyWishlistIds] = useState<string[]>([]);
  const wishlistIds = useMemo(() => savedFavoritesList.map(f => f.id), [savedFavoritesList]);

  // Re-read on every focus: product pages save to the same list, and logout clears it.
  const loadSaved = useCallback(() => {
    AsyncStorage.getItem('zenvy_wishlist').then(stored => {
      if (!isMountedRef.current) return;
      if (!stored) { setSavedFavoritesList([]); return; }
      try {
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return;
        // Product pages only open catalogue UUIDs; saved entries from old app versions with slug ids are dropped.
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        setSavedFavoritesList(parsed.filter((f: any) => {
          if (!f || typeof f !== 'object' || !f.id || !f.title) return false;
          const route = String(f.targetRoute || '');
          return !route.startsWith('/products/') || UUID_RE.test(route.slice('/products/'.length));
        }));
        // Older app versions saved only ids: resolve them once the catalogue is loaded.
        setLegacyWishlistIds(parsed.filter((f: any) => typeof f === 'string'));
      } catch {}
    }).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { loadSaved(); }, [loadSaved, myId]));

  // A different account (or logout) must never see the previous student's rides, spins or coupons.
  const lastUserRef = useRef(myId);
  useEffect(() => {
    if (lastUserRef.current === myId) return;
    lastUserRef.current = myId;
    setRides([]); setMyRides([]); setRideError(null); setMyRidesError(null);
    setCoupons([]); setSpinsLeft(0); setSpinNextIn(null); setRewardsStatus(myId ? 'loading' : 'ready');
  }, [myId]);

  const toSavedItem = (product: CatalogueItem): SavedItem => ({
    id: product.id,
    title: product.name,
    subtitle: [product.storeName, product.weight].filter(Boolean).join(' • ') || 'Campus store',
    price: fmtPrice(product.price),
    image: product.image || PRODUCT_FALLBACK_IMG,
    targetRoute: `/products/${product.id}`,
  });

  const persistSaved = (next: SavedItem[]) => {
    setSavedFavoritesList(next);
    AsyncStorage.setItem('zenvy_wishlist', JSON.stringify(next)).catch(() => {});
  };

  useEffect(() => {
    if (!legacyWishlistIds.length || catalogueStatus !== 'ready') return;
    const known = new Set(savedFavoritesList.map(f => f.id));
    const upgraded = legacyWishlistIds
      .map(id => catalogue.find(p => p.id === id))
      .filter((p): p is CatalogueItem => !!p && !known.has(p.id))
      .map(toSavedItem);
    setLegacyWishlistIds([]);
    if (upgraded.length) persistSaved([...savedFavoritesList, ...upgraded]);
  }, [legacyWishlistIds, catalogueStatus]);

  const toggleWishlistProduct = (product: CatalogueItem) => {
    Haptics.selectionAsync().catch(() => {});
    const exists = savedFavoritesList.some(f => f.id === product.id);
    persistSaved(exists ? savedFavoritesList.filter(f => f.id !== product.id) : [toSavedItem(product), ...savedFavoritesList]);
  };

  const removeSaved = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    persistSaved(savedFavoritesList.filter(f => f.id !== id));
  };

  const cardBg = isDark ? 'rgba(255, 255, 255, 0.08)' : colors.card;
  const cardSurface = isDark ? '#1D1D20' : colors.card;
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = isDark ? 'rgba(255, 255, 255, 0.18)' : colors.border;
  const bg = colors.bg;

  const accentGradient: [string, string] = isDark ? [COLORS.gold, COLORS.goldLight] : ['#EF4F5F', '#D43F4F'];

  const handlePromoAction = (promoId: string) => {
    switch (promoId) {
      case 'f1': router.push('/category/stationary' as any); break;
      case 'f2': setSelectedCategoryName('Fitness ready'); break;
      case 'f3': router.push('/category/groceries' as any); break;
      case 's1': router.push('/category/repairs' as any); break;
      case 's2': router.push('/category/tailoring' as any); break;
      case 's3': router.push('/category/print' as any); break;
      case 'p1':
      case 'p2': scrollViewRef.current?.scrollTo({ y: 300, animated: true }); break;
      case 'c1': openCreateRide(); break;
      case 'c4': setCorideTab('auto'); break;
      case 'r1': router.push('/rentals' as any); break;
      case 'r2': router.push('/rentals/new' as any); break;
      case 'o1': scrollViewRef.current?.scrollTo({ y: 250, animated: true }); break;
      case 'o2': scrollViewRef.current?.scrollToEnd({ animated: true }); break;
      default: break;
    }
  };

  const currentTabPromos = TAB_PROMOS[activeTab] || PROMOS_FOOD;
  const carouselOffers = currentTabPromos.map(p => ({
    id: p.id,
    imageUrl: p.img,
    tagline: p.tagline,
    title1: p.title,
    title2: p.subtitle,
    description: p.desc,
    buttonText: p.btn.replace(' →', ''),
    redirectAction: () => handlePromoAction(p.id),
  }));

  // ── Real-data derived shelves for the Food & Basket tab ──
  const BRANDS = [
    { name: 'Amul', img: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&q=80', border: '#B45309' },
    { name: 'Surf Excel', img: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=600&q=80', border: '#2563EB' },
    { name: 'Nescafe', img: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&q=80', border: '#78350F' },
    { name: 'Lays', img: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=600&q=80', border: '#D97706' },
    { name: 'Cadbury', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&q=80', border: '#6B21A8' },
    { name: 'Coca Cola', img: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=600&q=80', border: '#DC2626' },
  ];
  const HEALTH_TILES = [
    { name: 'Fit & active', img: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=200&q=80' },
    { name: 'Health', label: 'Health & care', img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=200&q=80' },
    { name: 'Organic', label: 'Organic', img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&q=80' },
    { name: 'Monsoon Wellness Picks', label: 'Wellness picks', img: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=200&q=80' },
  ];
  const CATEGORY_PILLS = [
    { label: 'All', icon: '🍽️', shelf: 'All Groceries' },
    { label: 'Fresh', icon: '🍎', shelf: 'Fresh' },
    { label: 'Grocery', icon: '🛒', shelf: 'Grocery' },
    { label: 'Electronics', icon: '🔌', shelf: 'Electronics' },
    { label: 'Organic', icon: '🌱', shelf: 'Organic' },
    { label: 'Health', icon: '🥗', shelf: 'Health' },
    { label: 'Deals', icon: '🏷️', shelf: 'Deals' },
  ];
  const oilShelf = useMemo(() => shelfItems('Edible Oils & Ghee', catalogue), [catalogue]);
  const toyTiles = useMemo(() => TOY_MANIA_CATEGORIES.map(t => {
    const items = shelfItems(t.title, catalogue);
    const maxOff = items.reduce((m, i) => Math.max(m, i.discountPercent || 0), 0);
    const minPrice = items.length ? Math.min(...items.map(i => i.price)) : 0;
    return { ...t, count: items.length, badge: maxOff >= 10 ? `UP TO ${maxOff}% OFF` : `FROM ${fmtPrice(minPrice)}` };
  }).filter(t => t.count > 0), [catalogue]);
  const groceryGrid = useMemo(() => GROCERY_CATEGORIES
    .map(section => ({ ...section, items: section.items.filter(i => shelfItems(i.name, catalogue).length > 0) }))
    .filter(section => section.items.length > 0), [catalogue]);
  const electronicsFrom = useMemo(() => {
    const prices = shelfItems('Electronics', catalogue).map(i => i.price).filter(p => p > 0);
    return prices.length ? Math.min(...prices) : 0;
  }, [catalogue]);

  const sheetProducts = selectedCategoryName ? shelfItems(selectedCategoryName, catalogue) : [];
  const visibleBBCategories = BB_CATEGORIES.filter(c => hasShelf(c.key));
  const bbProducts = shelfItems(selectedBBOption, catalogue).filter(p => !showVegOnly || p.isVegetarian);

  // Keep the side-bar selection on a category that has products.
  useEffect(() => {
    if (catalogueStatus === 'ready' && visibleBBCategories.length && !visibleBBCategories.some(c => c.key === selectedBBOption)) {
      setSelectedBBOption(visibleBBCategories[0].key);
    }
  }, [catalogueStatus, catalogue]);

  const qtyOf = (id: string) => cart.filter(i => i.id === id).reduce((sum, i) => sum + i.quantity, 0);
  const decProduct = (id: string) => {
    const line = cart.find(i => i.id === id);
    if (line) updateQuantity(line.cartKey, line.quantity - 1);
  };

  // Horizontal shelf card
  const renderShelfCard = (product: CatalogueItem) => {
    const quantity = qtyOf(product.id);
    const saved = wishlistIds.includes(product.id);
    const off = discountLabel(product);
    const soldOut = !product.isAvailable;
    return (
      <View key={product.id} style={[s.bbProductCard, { backgroundColor: cardSurface, borderColor: border }]}>
        <View style={s.bbProductCardImgWrap}>
          <TouchableOpacity style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} onPress={() => openProduct(product)}>
            <Image source={{ uri: product.image || PRODUCT_FALLBACK_IMG }} style={[s.bbProductCardImg, soldOut && { opacity: 0.4 }]} />
          </TouchableOpacity>

          {soldOut ? (
            <View style={[s.bbDiscountTag, { position: 'absolute', top: 6, left: 6, backgroundColor: '#6B7280' }]}>
              <Text style={[s.bbDiscountTagText, { color: '#fff' }]}>SOLD OUT</Text>
            </View>
          ) : off ? (
            <View style={[s.bbDiscountTag, { position: 'absolute', top: 6, left: 6, backgroundColor: '#FCD34D' }]}>
              <Text style={[s.bbDiscountTagText, { color: '#78350F' }]}>{off}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={s.bbWishlistBtn} onPress={() => toggleWishlistProduct(product)} activeOpacity={0.7}>
            <Text style={{ fontSize: 13, color: saved ? '#F59E0B' : '#999' }}>{saved ? '★' : '☆'}</Text>
          </TouchableOpacity>

          <View style={s.bbAddBtnOverlapping}>
            {quantity > 0 ? (
              <View style={s.bbStepperOverlapping}>
                <TouchableOpacity style={s.bbStepperBtnMini} onPress={() => decProduct(product.id)}>
                  <Text style={s.bbStepperBtnTextMini}>-</Text>
                </TouchableOpacity>
                <Text style={s.bbStepperQtyMini}>{quantity}</Text>
                <TouchableOpacity style={s.bbStepperBtnMini} onPress={() => addProduct(product)}>
                  <Text style={s.bbStepperBtnTextMini}>+</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[s.bbAddBtnSquare, soldOut && { opacity: 0.4 }]} onPress={() => addProduct(product)}>
                <Text style={s.bbAddBtnPlus}>+</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <TouchableOpacity onPress={() => openProduct(product)}>
          {!!product.brand && (
            <Text style={{ fontSize: 7.5, fontWeight: '900', color: txtSec, textTransform: 'uppercase', marginBottom: 2 }} numberOfLines={1}>{product.brand}</Text>
          )}
          <Text style={[s.bbProductCardName, { color: txt, height: 26 }]} numberOfLines={2}>{product.name}</Text>
          {!!product.weight && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Text style={s.bbProductCardWeight}>{product.weight}</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Text style={[s.bbProductCardPrice, { color: txt }]}>{fmtPrice(product.price)}</Text>
            {!!product.originalPrice && <Text style={s.bbProductCardOrigPrice}>{fmtPrice(product.originalPrice)}</Text>}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // Grid card (category mode + product sheet)
  const renderGridCard = (product: CatalogueItem, cardWidth: number, onOpen: () => void) => {
    const quantity = qtyOf(product.id);
    const off = discountLabel(product);
    const soldOut = !product.isAvailable;
    return (
      <View
        key={product.id}
        style={{
          width: cardWidth,
          backgroundColor: isDark ? '#18181B' : '#FFFFFF',
          borderRadius: 16,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9',
          padding: 8,
          marginBottom: 4,
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: isDark ? 0.3 : 0.06,
          shadowRadius: 8,
          elevation: 3,
        }}
      >
        <View style={{ width: '100%', height: 96, backgroundColor: '#FFF', borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F8FAFC' }}>
          <TouchableOpacity style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }} onPress={onOpen}>
            <Image source={{ uri: product.image || PRODUCT_FALLBACK_IMG }} style={{ width: '88%', height: '88%', resizeMode: 'contain', opacity: soldOut ? 0.4 : 1 }} />
          </TouchableOpacity>
          {(soldOut || off) && (
            <View style={{ position: 'absolute', top: 4, left: 4, borderRadius: 6, overflow: 'hidden' }}>
              <LinearGradient colors={soldOut ? ['#6B7280', '#4B5563'] : ['#EF4444', '#B91C1C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 5, paddingVertical: 2 }}>
                <Text style={{ fontSize: 6.5, fontWeight: '900', color: '#FFF', letterSpacing: 0.3 }}>{soldOut ? 'SOLD OUT' : off}</Text>
              </LinearGradient>
            </View>
          )}
          <View style={{ position: 'absolute', top: 4, right: 4 }}>
            <View style={{ width: 12, height: 12, borderWidth: 1, borderColor: product.isVegetarian ? '#22C55E' : '#EF4444', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 2 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: product.isVegetarian ? '#22C55E' : '#EF4444' }} />
            </View>
          </View>
        </View>

        <Text style={{ fontSize: 9.5, fontWeight: '800', color: txt, marginTop: 6, height: 26, lineHeight: 12 }} numberOfLines={2}>{product.name}</Text>
        <Text style={{ fontSize: 8, color: txtSec, marginTop: 2, fontWeight: '600' }} numberOfLines={1}>{product.weight || product.storeName || ' '}</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <View>
            <Text style={{ fontSize: 11, fontWeight: '900', color: isDark ? '#F3F4F6' : '#0F172A' }}>{fmtPrice(product.price)}</Text>
            {!!product.originalPrice && <Text style={{ fontSize: 8, color: txtSec, textDecorationLine: 'line-through' }}>{fmtPrice(product.originalPrice)}</Text>}
          </View>
          <View style={{ minWidth: 50 }}>
            {quantity > 0 ? (
              <View style={{ borderRadius: 10, overflow: 'hidden' }}>
                <LinearGradient colors={['#10B981', '#047857']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flexDirection: 'row', alignItems: 'center', height: 24, justifyContent: 'space-between', paddingHorizontal: 5 }}>
                  <TouchableOpacity style={{ width: 16, height: 18, alignItems: 'center', justifyContent: 'center' }} onPress={() => decProduct(product.id)}>
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>-</Text>
                  </TouchableOpacity>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 9.5, paddingHorizontal: 2 }}>{quantity}</Text>
                  <TouchableOpacity style={{ width: 16, height: 18, alignItems: 'center', justifyContent: 'center' }} onPress={() => addProduct(product)}>
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>+</Text>
                  </TouchableOpacity>
                </LinearGradient>
              </View>
            ) : (
              <TouchableOpacity style={{ borderRadius: 10, overflow: 'hidden', opacity: soldOut ? 0.5 : 1 }} onPress={() => addProduct(product)} activeOpacity={0.85}>
                <LinearGradient colors={soldOut ? ['#9CA3AF', '#6B7280'] : ['#10B981', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
                  <Text style={{ fontSize: 8.5, fontWeight: '900', color: '#FFF', letterSpacing: 0.5 }}>{soldOut ? 'SOLD OUT' : 'ADD +'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderShelf = (title: string, subtitle: string, items: CatalogueItem[], seeAll: string | null) => {
    if (!items.length) return null;
    return (
      <View style={{ marginTop: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: txt }}>{title}</Text>
            {!!subtitle && <Text style={{ fontSize: 10, color: txtSec, marginTop: 1 }}>{subtitle}</Text>}
          </View>
          {seeAll && (
            <TouchableOpacity onPress={() => setSelectedCategoryName(seeAll)} style={s.wellnessSeeAll} accessibilityLabel={`See all ${title}`}>
              <Text style={{ fontSize: 14, color: txtSec }}>›</Text>
            </TouchableOpacity>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
          {items.map(renderShelfCard)}
        </ScrollView>
      </View>
    );
  };

  const renderLoadError = (message: string, onRetry: () => void) => (
    <View style={[s.emptyState, { paddingVertical: 36, paddingHorizontal: 24 }]}>
      <Text style={{ fontSize: 32, marginBottom: 8 }}>📡</Text>
      <Text style={{ color: txt, fontSize: 13, fontWeight: '900', marginBottom: 4, textAlign: 'center' }}>Couldn't load this</Text>
      <Text style={{ color: txtSec, fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 14 }}>{message}</Text>
      <TouchableOpacity style={[s.resetBtn, { backgroundColor: COLORS.red }]} onPress={onRetry}>
        <Text style={[s.resetBtnText, { color: '#fff' }]}>TRY AGAIN</Text>
      </TouchableOpacity>
    </View>
  );

  const renderShelfSkeleton = () => (
    <View style={{ paddingTop: 16 }}>
      {[0, 1].map(row => (
        <View key={row} style={{ marginBottom: 18 }}>
          <ShimmerLoader width={160} height={16} borderRadius={8} style={{ marginLeft: 16, marginBottom: 10 }} />
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}>
            {[0, 1, 2].map(i => <ShimmerLoader key={i} width={120} height={180} borderRadius={16} />)}
          </View>
        </View>
      ))}
    </View>
  );

  const SERVICE_CARDS = [
    { id: 'LAPTOP_REPAIR', title: 'Laptop & Phone Repairs', tag: '💻 BOOK A SLOT', desc: 'Screen replacement, thermal paste, fan cleaning, SSD upgrades and hardware fixes.', icon: '💻', cat: 'repairs', priceKey: 'repairs', image: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&q=80' },
    { id: 'TAILORING', title: 'Tailoring & Stitching', tag: '🪡 ALTERATIONS', desc: 'Length shortening, shirt and kurti alterations, lab coat resizing and zip replacement.', icon: '✂️', cat: 'tailoring', priceKey: 'tailoring', image: 'https://images.unsplash.com/photo-1528458909336-e7a0adfed0a5?w=600&q=80' },
    { id: 'PRINTOUT', title: 'Printouts & Binding', tag: '🖨️ PRINT JOBS', desc: 'B&W and colour printouts, project reports, spiral and hard binding.', icon: '📄', cat: 'print', priceKey: 'print', image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=600&q=80' },
    { id: 'LAUNDRY', title: 'Wash, Dry Clean & Ironing', tag: '🧺 PICKUP & DROP', desc: 'Daily clothes, bedsheets, blankets and shoe cleaning from your hostel.', icon: '👕', cat: 'laundry', priceKey: 'laundry', image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=600&q=80' },
    { id: 'MATTRESSES', title: 'Mattresses & Room Gear', tag: '🛏️ MOVE-IN ESSENTIALS', desc: 'Foam mattresses, pillows, bedsheets, buckets and drying racks.', icon: '📦', cat: 'mattresses', priceKey: 'home', image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=600&q=80' },
    { id: 'ELECTRONICS', title: 'Chargers & Gadgets', tag: '🔌 TECH ESSENTIALS', desc: 'Laptop adapters, extension boards, calculators and study lamps.', icon: '🔋', cat: 'electronics', priceKey: 'electronics', image: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&q=80' },
  ];

  const wheelSectors = spinPrizes.map((p, i) => ({ label: p.label, ...WHEEL_STYLES[i % WHEEL_STYLES.length] }));
  const sectorDeg = 360 / Math.max(1, wheelSectors.length || WHEEL_STYLES.length);
  const zenPoints = Number(user?.zenPoints) || 0;

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <AmbientBackground />
      {/* ── UNIFIED LUXURY CAMPUS HEADER ── */}
      <View style={[s.bbHeader, { backgroundColor: cardSurface, borderBottomWidth: 1, borderColor: border, paddingBottom: 12, paddingTop: 6 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            <TouchableOpacity
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9', borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}
              onPress={() => router.replace('/(tabs)')}
              activeOpacity={0.7}
              accessibilityLabel="Back to Home"
            >
              <Ionicons name="arrow-back" size={19} color={txt} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: txt, letterSpacing: 0.3 }} numberOfLines={1}>
                Campus Hub & Services 🚀
              </Text>
              <Text style={{ fontSize: 9.5, fontWeight: '600', color: txtSec, fontStyle: 'italic' }} numberOfLines={1}>
                “Everything you need for effortless hostel life”
              </Text>
            </View>
          </View>

          {serviceability && (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: serviceability.open ? (isDark ? 'rgba(34, 197, 94, 0.15)' : '#DCFCE7') : (isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7'),
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: serviceability.open ? (isDark ? 'rgba(34, 197, 94, 0.3)' : '#86EFAC') : (isDark ? 'rgba(245, 158, 11, 0.3)' : '#FCD34D'),
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: serviceability.open ? '#22C55E' : '#F59E0B', marginRight: 5 }} />
              <Text style={{ fontSize: 9, fontWeight: '900', color: serviceability.open ? (isDark ? '#4ADE80' : '#15803D') : (isDark ? '#FCD34D' : '#B45309'), letterSpacing: 0.5 }}>
                {serviceability.open ? 'OPEN NOW' : `OPENS ${fmtClock(serviceability.reopensAt) || 'SOON'}`}
              </Text>
            </View>
          )}
        </View>

        {/* Search Bar & Wishlist */}
        <View style={s.bbHeaderSearchRow}>
          <CardPressable
            style={[s.bbSearchBar, { backgroundColor: isDark ? '#27272A' : '#F4F4F5', borderColor: border, height: 42, flex: 1 }]}
            onPress={() => setIsSearchOpen(true)}
            tilt={false}
          >
            <Text style={{ fontSize: 14, color: '#F59E0B' }}>🔍</Text>
            <RotatingSearchPlaceholder color={txtSec} textColor={txt} style={[s.bbSearchInput, { fontSize: 12, fontWeight: '600' }]} />
            <TouchableOpacity
              style={{ padding: 4, backgroundColor: 'rgba(245, 158, 11, 0.15)', borderRadius: 8 }}
              onPress={() => selectTab('promos')}
              accessibilityLabel="Deals and rewards"
            >
              <Text style={{ fontSize: 13 }}>🎁</Text>
            </TouchableOpacity>
          </CardPressable>

          <TouchableOpacity
            style={[s.bbShortcutBtn, { backgroundColor: isDark ? '#27272A' : '#F4F4F5', borderWidth: 1, borderColor: border, width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }]}
            onPress={() => setFavoritesModalVisible(true)}
            activeOpacity={0.8}
            accessibilityLabel="Saved items"
          >
            <Text style={{ fontSize: 15 }}>❤️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── TAB SELECTOR (HORIZONTAL SCROLLABLE CHIPS) ── */}
      <View style={{ marginBottom: 14 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}>
          {visibleTabs.map(t => {
            const isActive = activeTab === t.key;
            return (
              <DopaminePressable key={t.key} onPress={() => selectTab(t.key)} sound="tabSwitch" activeScale={0.95}>
                {isActive ? (
                  <LinearGradient
                    colors={accentGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 14, shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 3 }}
                  >
                    <Text style={{ fontSize: 15 }}>{t.icon}</Text>
                    <Text style={{ color: '#000', fontWeight: '900', fontSize: 12, letterSpacing: 0.2 }}>{t.label}</Text>
                  </LinearGradient>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: cardBg, borderWidth: 1, borderColor: border }}>
                    <Text style={{ fontSize: 14 }}>{t.icon}</Text>
                    <Text style={{ color: txtSec, fontWeight: '700', fontSize: 12 }}>{t.label}</Text>
                  </View>
                )}
              </DopaminePressable>
            );
          })}
        </ScrollView>
      </View>

      <Animated.View style={{ opacity: tabContentFade, transform: [{ translateY: tabContentTranslateY }], flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled={true}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} colors={[COLORS.red]} />}
        >
          {/* ── HERO CAROUSEL CARD ── */}
          {!(activeTab === 'food' && groceryMode === 'categories') && activeTab !== 'events' && activeTab !== 'pg' && activeTab !== 'coride' && (
            <View style={[s.heroCarouselCard, { borderColor: border }]}>
              <PromoCarousel offers={carouselOffers} containerStyle={s.heroCarousel} />
            </View>
          )}

          {/* ── MODE SELECTOR ── */}
          {activeTab === 'food' && (
            <View style={{ flexDirection: 'row', marginHorizontal: 12, marginTop: 4, marginBottom: 4, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9', borderRadius: 24, padding: 3, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0' }}>
              {(['home', 'categories'] as const).map(mode => (
                <TouchableOpacity key={mode} style={{ flex: 1, borderRadius: 20, overflow: 'hidden' }} onPress={() => setGroceryMode(mode)} activeOpacity={0.85}>
                  {groceryMode === mode ? (
                    <LinearGradient colors={['#10B981', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 6, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 9, fontWeight: '900', color: '#FFF', letterSpacing: 0.5 }}>{mode === 'home' ? '🏠 HOME' : '🗂️ CATEGORIES'}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={{ paddingVertical: 6, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: txtSec, letterSpacing: 0.3 }}>{mode === 'home' ? '🏠 HOME' : '🗂️ CATEGORIES'}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

        {/* ── FOOD / MEGA BASKET TAB ── */}
        {activeTab === 'food' && groceryMode === 'home' && (
          <View>
            {catalogueStatus === 'loading' && catalogue.length === 0 ? (
              renderShelfSkeleton()
            ) : catalogueStatus === 'error' && catalogue.length === 0 ? (
              renderLoadError('The campus store did not load. Check your internet and try again.', fetchCatalogue)
            ) : catalogue.length === 0 ? (
              <View style={[s.emptyState, { paddingVertical: 36 }]}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>🧺</Text>
                <Text style={{ color: txt, fontSize: 13, fontWeight: '900', marginBottom: 4 }}>The store is stocking up</Text>
                <Text style={{ color: txtSec, fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 14 }}>
                  Need something now? Send a shopping request and a Zenvy shopper will buy it for you.
                </Text>
                <TouchableOpacity style={[s.resetBtn, { backgroundColor: '#10B981' }]} onPress={openCustomRequest}>
                  <Text style={[s.resetBtnText, { color: '#fff' }]}>REQUEST AN ITEM</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* ── TOP DEAL (real discount from the catalogue) ── */}
                {topDeal && (
                  <View style={[s.flashDealContainer, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', marginTop: 12 }]}>
                    <LinearGradient colors={['#EF4444', '#DC2626']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.flashBadge}>
                      <Text style={s.flashBadgeText}>⚡ TOP DEAL</Text>
                    </LinearGradient>
                    <View style={{ flex: 1, paddingLeft: 8 }}>
                      <Text style={s.flashDealTitle} numberOfLines={1}>{topDeal.name} — {topDeal.discountPercent}% OFF</Text>
                      <Text style={s.flashDealTimerLabel} numberOfLines={1}>Now {fmtPrice(topDeal.price)}{topDeal.originalPrice ? ` (was ${fmtPrice(topDeal.originalPrice)})` : ''}</Text>
                    </View>
                    <TouchableOpacity style={s.flashDealCta} onPress={() => setSelectedCategoryName('Deals')}>
                      <Text style={s.flashDealCtaText}>ALL DEALS ➔</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={{ height: 4 }} />

                {/* ── CATEGORY PILLS ── */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginTop: 8, marginBottom: 16 }}>
                  {CATEGORY_PILLS.filter(p => hasShelf(p.shelf)).map(pill => {
                    const isActive = activeCategoryPill === pill.label;
                    return (
                      <DopaminePressable
                        key={pill.label}
                        style={[s.pillBtn, isActive && s.pillBtnActive, { borderColor: border, backgroundColor: isActive ? '#DCFCE7' : cardBg }]}
                        onPress={() => {
                          setActiveCategoryPill(pill.label);
                          setSelectedCategoryName(pill.shelf);
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

                {/* ── SHOP BY BRAND ── */}
                {BRANDS.some(b => hasShelf(b.name)) && (
                  <View style={{ marginBottom: 20 }}>
                    <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                      <Text style={[s.sectionTitle, { color: txt, marginVertical: 0, paddingLeft: 0 }]}>SHOP BY BRAND</Text>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 14 }}>
                      {BRANDS.filter(b => hasShelf(b.name)).map(brand => (
                        <DopaminePressable
                          key={brand.name}
                          style={{ width: 140, height: 200, borderRadius: 22, borderWidth: 1.5, borderColor: brand.border, overflow: 'hidden', backgroundColor: isDark ? '#1C1917' : '#F8FAFC', justifyContent: 'center', alignItems: 'center' }}
                          onPress={() => setSelectedCategoryName(brand.name)}
                          activeScale={0.96}
                          sound="click"
                        >
                          <SafeImage source={{ uri: brand.img }} style={{ width: '100%', height: '100%', position: 'absolute' }} />
                          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: 'rgba(0,0,0,0.65)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 11, letterSpacing: 0.5 }}>{brand.name}</Text>
                            <Text style={{ color: '#F59E0B', fontWeight: '800', fontSize: 10 }}>SHOP →</Text>
                          </View>
                        </DopaminePressable>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* ── TOYS ── */}
                {renderShelf(toyStartPrice !== null ? `Toys from ${fmtPrice(toyStartPrice)}` : 'Toys & games', 'Games, plushies, sports & more', toyShelf, 'Toys')}

                {/* ── TOYS & SPORTS GRID ── */}
                {toyTiles.length > 0 && (
                  <View style={{ paddingHorizontal: 16, marginTop: 20, marginBottom: 12 }}>
                    <Text style={{ fontSize: 17, fontWeight: '900', color: txt, letterSpacing: 0.3, marginBottom: 14 }}>Toys & Sports Mania</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      {toyTiles.map(item => (
                        <ScalePressable key={item.title} onPress={() => setSelectedCategoryName(item.title)} style={{ width: (SW - 32 - 10) / 2 }}>
                          <View style={{ width: '100%', height: 130, borderRadius: 18, overflow: 'hidden' }}>
                            <Image source={{ uri: item.image }} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} resizeMode="cover" />
                            <LinearGradient
                              colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.6)']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between', padding: 12 }}
                            >
                              <Text style={{ fontSize: 14, fontWeight: '900', color: '#fff', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }} numberOfLines={2}>
                                {item.title}
                              </Text>
                              <View style={{ backgroundColor: item.badgeBg, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
                                <Text style={{ fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 0.8 }}>{item.badge}</Text>
                              </View>
                            </LinearGradient>
                          </View>
                        </ScalePressable>
                      ))}
                    </View>
                  </View>
                )}

                {/* ── SEEDS ── */}
                {renderShelf('Bring home fresh greens', 'Seeds for your balcony garden', seedShelf, 'Seeds')}

                {/* ── BEST DEALS ── */}
                {dealShelf.length > 0 && (
                  <>
                    <View style={{ marginHorizontal: 16, marginTop: 20, height: 38, borderRadius: 10, backgroundColor: isDark ? '#27272A' : '#EFF6FF', borderStyle: 'dashed', borderWidth: 1, borderColor: isDark ? '#3F3F46' : '#BFDBFE', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 14 }}>🏷️</Text>
                      <Text style={{ fontSize: 10, fontWeight: '900', color: isDark ? '#93C5FD' : '#1D4ED8', letterSpacing: 1.5 }}>BEST DEALS</Text>
                    </View>
                    {renderShelf('Biggest savings right now', 'Prices you pay at checkout', dealShelf, 'Deals')}
                  </>
                )}

                {/* ── COOKING OILS & GHEE ── */}
                {renderShelf('Cooking Oils & Ghee', 'Kitchen staples for your hostel', oilShelf, 'Edible Oils & Ghee')}

                {/* ── BETTER HEALTH ── */}
                {HEALTH_TILES.some(h => hasShelf(h.name)) && (
                  <>
                    <Text style={[s.sectionTitle, { color: txt, marginTop: 24, paddingLeft: 16 }]}>Better health starts here</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12, marginBottom: 12 }}>
                      {HEALTH_TILES.filter(h => hasShelf(h.name)).map(h => (
                        <TouchableOpacity key={h.name} style={{ width: (SW - 32 - 24) / 3, alignItems: 'center', marginBottom: 12 }} onPress={() => setSelectedCategoryName(h.name)}>
                          <View style={{ width: '100%', height: 90, borderRadius: 16, backgroundColor: '#E6F4EA', overflow: 'hidden', justifyContent: 'flex-end', borderWidth: 1, borderColor: border }}>
                            <View style={{ position: 'absolute', top: 20, left: 10, right: 10, bottom: 0, borderTopLeftRadius: 36, borderTopRightRadius: 36, backgroundColor: '#10B981', opacity: 0.7 }} />
                            <Image source={{ uri: h.img }} style={{ width: '75%', height: '80%', resizeMode: 'cover', alignSelf: 'center', borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }} />
                          </View>
                          <Text style={{ fontSize: 9, fontWeight: '900', color: txt, textAlign: 'center', marginTop: 6 }} numberOfLines={2}>{h.label || h.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                {/* ── WELLNESS PICKS ── */}
                {renderShelf('Wellness picks', 'Honey, ginger, lemon & more', wellnessShelf, 'Monsoon Wellness Picks')}

                {/* ── DAILY ESSENTIALS, SNACKS, HOME NEEDS GRIDS ── */}
                <View style={{ height: 16 }} />
                {groceryGrid.map((section, sectionIdx) => {
                  const sectionColors = ['#059669', '#EA580C', '#7C3AED'];
                  return (
                    <View key={section.title} style={{ paddingHorizontal: 16, marginBottom: 20 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                        <Text style={{ fontSize: 17, fontWeight: '900', color: txt, letterSpacing: 0.3 }}>{section.title}</Text>
                        <View style={{ marginLeft: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: sectionColors[sectionIdx % sectionColors.length] }} />
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        {section.items.map(item => (
                          <ScalePressable key={item.name} onPress={() => setSelectedCategoryName(item.name)} style={{ width: (SW - 32 - 10) / 2 }}>
                            <View style={{ width: '100%', height: 120, borderRadius: 16, overflow: 'hidden' }}>
                              <Image source={{ uri: item.img }} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} resizeMode="cover" />
                              <LinearGradient
                                colors={['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.65)']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', padding: 10 }}
                              >
                                <Text style={{ fontSize: 12, fontWeight: '900', color: '#fff', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }} numberOfLines={2}>{item.name}</Text>
                              </LinearGradient>
                            </View>
                          </ScalePressable>
                        ))}
                      </View>
                    </View>
                  );
                })}

                {/* ── CAN'T FIND IT? (real Mega Basket shopping request) ── */}
                <TouchableOpacity activeOpacity={0.9} onPress={openCustomRequest} style={{ marginHorizontal: 16, marginBottom: 8, borderRadius: 18, overflow: 'hidden' }}>
                  <LinearGradient colors={['#115E59', '#134E4A']} style={s.monsoonStoreBanner}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.monsoonBannerSubtitle}>CAN'T FIND IT?</Text>
                      <Text style={s.monsoonBannerTitle}>REQUEST ANY ITEM 🛍️</Text>
                      <Text style={s.monsoonBannerDesc}>Tell us what you need. A Zenvy shopper buys it and you approve the bill before paying.</Text>
                    </View>
                    <View style={s.frogMascotContainer}>
                      <Text style={{ fontSize: 44 }}>📝</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ── CATEGORY MODE ── */}
        {activeTab === 'food' && groceryMode === 'categories' && (
          <View style={{ flex: 1, height: SH > 700 ? SH - 200 : 540, backgroundColor: isDark ? '#0B0B0D' : '#F8FAFC' }}>
            {/* Quick List Auto Fill Card */}
            {showAutoFillCard && (
              <View style={{ marginHorizontal: 10, backgroundColor: cardBg, borderWidth: 1, borderColor: '#22C55E', borderRadius: 14, padding: 10, marginVertical: 4, elevation: 3 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: txt, marginBottom: 4 }}>⚡ QUICK LIST</Text>
                <Text style={{ fontSize: 9, color: txtSec, marginBottom: 6 }}>Type your list and we'll add the matching items from the store.</Text>
                <TextInput
                  style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF', borderWidth: 1, borderColor: border, borderRadius: 8, padding: 6, fontSize: 11, color: txt, height: 52, textAlignVertical: 'top' }}
                  multiline
                  maxLength={500}
                  placeholder="e.g. 2 maggi, 1 atta, lays"
                  placeholderTextColor={txtSec}
                  value={listText}
                  onChangeText={setListText}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
                  <TouchableOpacity style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: isDark ? '#3F3F46' : '#E2E8F0' }} onPress={() => setShowAutoFillCard(false)}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: txt }}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#22C55E' }} onPress={handleSmartAutoFill}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff' }}>ADD ITEMS</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Custom Request Form */}
            {showCustomForm && (
              <View style={{ marginHorizontal: 10, backgroundColor: cardBg, borderWidth: 1, borderColor: '#EF4444', borderRadius: 14, padding: 10, marginVertical: 4, elevation: 3 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: txt, marginBottom: 4 }}>🛍️ REQUEST ANY ITEM</Text>
                <Text style={{ fontSize: 9, color: txtSec, marginBottom: 6 }}>A Zenvy shopper buys it for you. You approve the real bill before paying (Cash on Delivery).</Text>
                <TextInput
                  style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF', borderWidth: 1, borderColor: border, borderRadius: 6, paddingHorizontal: 8, height: 32, fontSize: 11, color: txt, marginBottom: 6 }}
                  placeholder="Item name and brand"
                  placeholderTextColor={txtSec}
                  maxLength={60}
                  value={customItemName}
                  onChangeText={setCustomItemName}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                  <TextInput
                    style={{ flex: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF', borderWidth: 1, borderColor: border, borderRadius: 6, paddingHorizontal: 8, height: 32, fontSize: 11, color: txt }}
                    placeholder="Qty (1–20)"
                    placeholderTextColor={txtSec}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={customItemQty}
                    onChangeText={t => setCustomItemQty(t.replace(/[^0-9]/g, ''))}
                  />
                  <TextInput
                    style={{ flex: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF', borderWidth: 1, borderColor: border, borderRadius: 6, paddingHorizontal: 8, height: 32, fontSize: 11, color: txt }}
                    placeholder="Est. price ₹ / unit"
                    placeholderTextColor={txtSec}
                    keyboardType="decimal-pad"
                    maxLength={7}
                    value={customItemPrice}
                    onChangeText={t => setCustomItemPrice(t.replace(/[^0-9.]/g, ''))}
                  />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                  <TouchableOpacity style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: isDark ? '#3F3F46' : '#E2E8F0' }} onPress={() => setShowCustomForm(false)}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: txt }}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#EF4444' }} onPress={handleAddCustomRequest}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff' }}>ADD TO BASKET</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Split Grid */}
            <View style={{ flexDirection: 'row', flex: 1, width: '100%', borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0' }}>
              {/* Sidebar */}
              <ScrollView
                style={{ width: 68, maxWidth: 68, minWidth: 68, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0', backgroundColor: isDark ? '#0D0E12' : '#F8FAFC' }}
                contentContainerStyle={{ alignItems: 'center', paddingBottom: 100 }}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={false}
              >
                {visibleBBCategories.map(cat => {
                  const isSelected = selectedBBOption === cat.key;
                  return (
                    <TouchableOpacity
                      key={cat.key}
                      style={{ width: 68, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isSelected ? (isDark ? 'rgba(16,185,129,0.08)' : '#F0FDF4') : 'transparent' }}
                      onPress={() => setSelectedBBOption(cat.key)}
                      activeOpacity={0.8}
                    >
                      {isSelected && (
                        <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3.5, backgroundColor: '#10B981', borderTopRightRadius: 3, borderBottomRightRadius: 3 }} />
                      )}
                      {isSelected ? (
                        <LinearGradient colors={['#10B981', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                          <Text style={{ fontSize: 18 }}>{cat.icon}</Text>
                        </LinearGradient>
                      ) : (
                        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9', alignItems: 'center', justifyContent: 'center', marginBottom: 4, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0' }}>
                          <Text style={{ fontSize: 17 }}>{cat.icon}</Text>
                        </View>
                      )}
                      <Text
                        style={{ fontSize: 7.5, fontWeight: isSelected ? '900' : '600', color: isSelected ? (isDark ? '#34D399' : '#047857') : txtSec, textAlign: 'center', paddingHorizontal: 2, lineHeight: 9 }}
                        numberOfLines={2}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Right Product Grid */}
              <ScrollView
                style={{ flex: 1, backgroundColor: isDark ? '#0B0B0D' : '#FAFAFA' }}
                contentContainerStyle={{ padding: 8, paddingBottom: 140 }}
                nestedScrollEnabled={true}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: txt, textTransform: 'uppercase', letterSpacing: 0.8, flex: 1 }} numberOfLines={1}>
                    ✨ {BB_CATEGORIES.find(c => c.key === selectedBBOption)?.label || selectedBBOption}
                  </Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <TouchableOpacity
                      style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: isDark ? 'rgba(16,185,129,0.2)' : '#DCFCE7', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: isDark ? 'rgba(16,185,129,0.4)' : '#86EFAC' }}
                      onPress={() => { setShowCustomForm(false); setShowAutoFillCard(v => !v); }}
                      accessibilityLabel="Quick list"
                    >
                      <Text style={{ fontSize: 11 }}>⚡</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: isDark ? 'rgba(239,68,68,0.2)' : '#FEE2E2', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: isDark ? 'rgba(239,68,68,0.4)' : '#FCA5A5' }}
                      onPress={() => { setShowAutoFillCard(false); setShowCustomForm(v => !v); }}
                      accessibilityLabel="Request any item"
                    >
                      <Text style={{ fontSize: 11 }}>🛍️</Text>
                    </TouchableOpacity>

                    <Text style={{ fontSize: 8, fontWeight: '800', color: txtSec, marginLeft: 2 }}>🟢 Veg</Text>
                    <TouchableOpacity
                      style={{ width: 28, height: 16, borderRadius: 9, backgroundColor: showVegOnly ? '#10B981' : '#D1D5DB', justifyContent: 'center', paddingHorizontal: 2 }}
                      onPress={() => setShowVegOnly(v => !v)}
                      accessibilityLabel="Veg only"
                    >
                      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff', alignSelf: showVegOnly ? 'flex-end' : 'flex-start' }} />
                    </TouchableOpacity>
                  </View>
                </View>

                {catalogueStatus === 'loading' && catalogue.length === 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {[0, 1, 2, 3].map(i => <ShimmerLoader key={i} width={(SW - 68 - 24) / 2} height={170} borderRadius={16} />)}
                  </View>
                ) : catalogueStatus === 'error' && catalogue.length === 0 ? (
                  renderLoadError('The campus store did not load.', fetchCatalogue)
                ) : bbProducts.length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 12 }}>
                    <Text style={{ fontSize: 28, marginBottom: 6 }}>🧺</Text>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: txt, textAlign: 'center' }}>{showVegOnly ? 'No veg items here' : 'Nothing here yet'}</Text>
                    <Text style={{ fontSize: 10, color: txtSec, textAlign: 'center', marginTop: 4, marginBottom: 12 }}>Request any item and a Zenvy shopper will buy it for you.</Text>
                    <TouchableOpacity style={[s.resetBtn, { backgroundColor: '#EF4444' }]} onPress={() => { setShowAutoFillCard(false); setShowCustomForm(true); }}>
                      <Text style={[s.resetBtnText, { color: '#fff' }]}>REQUEST AN ITEM</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {bbProducts.map(product => renderGridCard(product, (SW - 68 - 24) / 2, () => openProduct(product)))}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        )}

        {/* ── TECH & REPAIRS & SERVICES TAB ── */}
        {activeTab === 'services' && (
          <View style={{ paddingHorizontal: 16 }}>
            <View style={{ marginBottom: 14, marginTop: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#3B82F6', letterSpacing: 1.5 }}>CAMPUS SERVICES</Text>
              <Text style={{ fontSize: 16, fontWeight: '900', color: txt, marginTop: 2 }}>Book it from your hostel 🛠️</Text>
            </View>

            {SERVICE_CARDS.map(srv => {
              const from = srv.priceKey === 'electronics' ? electronicsFrom : (serviceFromPrice[srv.priceKey] || 0);
              return (
                <ScalePressable
                  key={srv.id}
                  style={{ borderRadius: 20, backgroundColor: cardSurface, borderWidth: 1, borderColor: border, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.25 : 0.07, shadowRadius: 10, elevation: 4 }}
                  onPress={() => router.push(`/category/${srv.cat}` as any)}
                >
                  <View style={{ flexDirection: 'row', padding: 14, gap: 14 }}>
                    <View style={{ width: 90, height: 90, borderRadius: 16, overflow: 'hidden' }}>
                      <Image source={{ uri: srv.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, justifyContent: 'flex-end', padding: 6 }}>
                        <Text style={{ fontSize: 16 }}>{srv.icon}</Text>
                      </LinearGradient>
                    </View>

                    <View style={{ flex: 1, justifyContent: 'space-between' }}>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                          <View style={{ backgroundColor: isDark ? 'rgba(59,130,246,0.15)' : '#EFF6FF', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: isDark ? 'rgba(59,130,246,0.3)' : '#BFDBFE' }}>
                            <Text style={{ fontSize: 7.5, fontWeight: '900', color: '#3B82F6', letterSpacing: 0.5 }}>{srv.tag}</Text>
                          </View>
                          {from > 0 && <Text style={{ fontSize: 12, fontWeight: '900', color: '#10B981' }}>From {fmtPrice(from)}</Text>}
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '900', color: txt, lineHeight: 18, letterSpacing: -0.2 }}>{srv.title}</Text>
                        <Text style={{ fontSize: 10.5, color: txtSec, lineHeight: 15, marginTop: 5 }} numberOfLines={2}>{srv.desc}</Text>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 10 }}>
                        <LinearGradient colors={isDark ? ['#3B82F6', '#2563EB'] : ['#1D4ED8', '#2563EB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 }}>
                          <Text style={{ fontSize: 10, fontWeight: '900', color: '#FFF', letterSpacing: 0.4 }}>{['repairs', 'tailoring', 'print', 'laundry'].includes(srv.cat) ? 'BOOK NOW ➔' : 'SHOP NOW ➔'}</Text>
                        </LinearGradient>
                      </View>
                    </View>
                  </View>
                </ScalePressable>
              );
            })}
          </View>
        )}

        {/* ── RENTALS TAB: student vehicles (peer to peer) + rental stores ── */}
        {activeTab === 'rentals' && <RentalsSection />}

        {/* ── CAMPUS EVENTS TAB: discovery, registrations, tickets (only while the server enables it) ── */}
        {activeTab === 'events' && campusEventsOn && <CampusEventsSection />}

        {/* ── PG STAYS TAB (modules/pg) ── */}
        {activeTab === 'pg' && (
          <PgListSection pgs={pgs} home={pgHome} loading={loadingPgs} error={pgError} onRetry={() => fetchPGs()} />
        )}

        {/* ── CO-RIDE (BIKEPOOL) TAB ── modules/coride: student bike pool + Zenvy Auto */}
        {activeTab === 'coride' && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
            {/* Mode: student bike pool or Zenvy shared auto */}
            <Segmented
              label="Ride mode"
              value={corideTab === 'auto' ? 'auto' : 'pool'}
              onChange={m => setCorideTab(m === 'auto' ? 'auto' : 'browse')}
              options={[
                { key: 'pool', label: 'Bike pool', icon: 'motorbike', iconSet: 'mci' },
                { key: 'auto', label: 'Zenvy Auto', icon: 'rickshaw', iconSet: 'mci' },
              ]}
            />
            <Text style={{ fontSize: 13, lineHeight: 18, color: txtSec, marginTop: 8 }}>
              {corideTab !== 'auto'
                ? 'Ride with students going your way and split the fuel.'
                : autoRideOn ? 'Book a seat in a shared auto with a verified driver. Pay the driver in cash when you board.' : 'Shared autos with verified drivers, starting soon.'}
            </Text>

            {!myId ? (
              <View style={{ marginTop: 16 }}>
                <CoRideState
                  icon="person-circle-outline"
                  title="Log in to use Co-Ride"
                  message="Co-Ride is only for signed-in students, so you always know who you ride with."
                  actionLabel="Log in"
                  onAction={() => router.push('/login' as any)}
                />
              </View>
            ) : corideTab === 'auto' ? (
              <View style={{ marginTop: 16 }}>
                {autoRideOn ? <AutoRideSection /> : (
                  <CoRideState
                    icon="rickshaw"
                    mci
                    title="Zenvy Auto is not open yet"
                    message="Shared autos with verified drivers start soon. You will be able to pick your seat and pay the driver in cash when you board."
                    actionLabel="Find a bike pool"
                    secondary
                    onAction={() => setCorideTab('browse')}
                  />
                )}
              </View>
            ) : (
              <>
                <KarmaLine points={Number(user?.karmaPoints) || 0} />
                <PoolTabs
                  value={corideTab === 'my-rides' ? 'my-rides' : 'browse'}
                  onChange={setCorideTab}
                  myRidesCount={myRideGroups.upcoming.length}
                  onPost={openCreateRide}
                />

                {/* FIND A RIDE */}
                {corideTab === 'browse' && (
                  <View>
                    {rides.length > 0 && (
                      <RideFilters
                        vehicle={vehicleFilter}
                        onVehicle={v => { setVehicleFilter(v); setGoingTo(null); }}
                        destinations={rideDestinations}
                        goingTo={goingTo}
                        onGoingTo={setGoingTo}
                      />
                    )}

                    {loadingRides && rides.length === 0 ? (
                      <RideSkeleton />
                    ) : rideError && rides.length === 0 ? (
                      <CoRideState icon="cloud-offline-outline" title="Rides did not load" message={rideError} actionLabel="Try again" onAction={fetchRides} />
                    ) : filteredRides.length > 0 ? (
                      filteredRides.map(ride => (
                        <RideCard
                          key={ride.id}
                          ride={ride}
                          joinStatus={myJoinStatus[String(ride.id)]}
                          busy={rideActionBusy === ride.id}
                          onJoin={() => { if (rideActionBusy !== ride.id) handleJoinRide(ride); }}
                          onOpenMyRides={() => setCorideTab('my-rides')}
                        />
                      ))
                    ) : rides.length > 0 ? (
                      <CoRideState
                        icon="funnel-outline"
                        title={`No ${vehicleFilter === 'All' ? '' : `${vehicleFilter.toLowerCase()} `}rides${goingTo ? ` to ${goingTo}` : ''} right now`}
                        message="Try another vehicle or destination, or post your own ride."
                        actionLabel="Clear filters"
                        secondary
                        onAction={() => { setVehicleFilter('All'); setGoingTo(null); }}
                      />
                    ) : (
                      <CoRideState
                        icon="map-outline"
                        title="No rides posted yet"
                        message="Post where you are going and students heading the same way can join you."
                        actionLabel="Post a ride"
                        onAction={openCreateRide}
                      />
                    )}
                  </View>
                )}

                {/* MY RIDES */}
                {corideTab === 'my-rides' && (
                  <View>
                    {loadingMyRides && myRides.length === 0 ? (
                      <RideSkeleton count={2} />
                    ) : myRidesError && myRides.length === 0 ? (
                      <CoRideState icon="cloud-offline-outline" title="Your rides did not load" message={myRidesError} actionLabel="Try again" onAction={fetchMyRides} />
                    ) : myRides.length > 0 ? (
                      ([['Upcoming', myRideGroups.upcoming], ['Past', myRideGroups.past]] as const).map(([title, list]) => list.length > 0 && (
                        <View key={title} style={{ marginBottom: 8 }}>
                          <SectionLabel title={title} count={list.length} />
                          {list.map(ride => (
                            <MyRideCard
                              key={ride.id}
                              ride={ride}
                              myId={myId}
                              busy={rideActionBusy === ride.id}
                              onApprove={reqId => handleApproveRequest(ride.id, reqId)}
                              onDecline={reqId => handleRejectRequest(ride.id, reqId)}
                              onComplete={() => { if (rideActionBusy !== ride.id) handleCompleteRide(ride.id); }}
                              onCancel={kind => { if (rideActionBusy !== ride.id) handleCancelRide(ride.id, kind); }}
                              onWhatsApp={contactOnWhatsApp}
                              onSafety={handleSOS}
                            />
                          ))}
                        </View>
                      ))
                    ) : (
                      <CoRideState
                        icon="calendar-outline"
                        title="No rides yet"
                        message="Rides you post or ask to join show up here."
                        actionLabel="Find a ride"
                        secondary
                        onAction={() => setCorideTab('browse')}
                      />
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* ── DEALS & SPINS TAB ── */}
        {activeTab === 'promos' && (
          <View style={{ paddingHorizontal: 16 }}>
            {/* 1. Rewards hero: real ZenPoints */}
            <Animated.View style={{ opacity: heroEnterO, transform: [{ translateY: heroEnterY }] }}>
              <View style={{ borderRadius: 24, overflow: 'hidden', marginBottom: 16, borderWidth: 1.5, borderColor: border }}>
                <LinearGradient
                  colors={isDark ? ['#1E1B4B', '#311042'] : ['#FDF4E3', '#FCE7C8']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: COLORS.gold, letterSpacing: 2 }}>ZENVY REWARDS</Text>
                    <Text style={{ fontSize: 24, fontWeight: '900', color: txt, marginTop: 4 }}>Your Rewards Hub</Text>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: txtSec, marginTop: 2 }}>Every 2 delivered orders earn a spin.</Text>
                  </View>
                  {myId ? (
                    <View style={{ alignItems: 'flex-end', minWidth: 80 }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: txtSec }}>ZENPOINTS</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        <Animated.View style={{ transform: [{ translateY: coinFloatAnim }] }}>
                          <Text style={{ fontSize: 20 }}>💎</Text>
                        </Animated.View>
                        <Text style={{ fontSize: 20, fontWeight: '900', color: COLORS.gold }}>{zenPoints}</Text>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={{ backgroundColor: COLORS.red, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 }} onPress={() => router.push('/login' as any)}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>LOG IN</Text>
                    </TouchableOpacity>
                  )}
                </LinearGradient>
              </View>
            </Animated.View>

            {/* 2. Spin wheel (server picks the prize) */}
            <Animated.View style={{ opacity: wheelEnterO, transform: [{ translateY: wheelEnterY }, { scale: wheelScaleIn }] }}>
              <View style={{ borderRadius: 24, borderWidth: 1.5, borderColor: border, backgroundColor: cardBg, padding: 20, alignItems: 'center', marginBottom: 16, ...SHADOWS.card }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: txt, letterSpacing: 1.5 }}>LUCKY SPIN WHEEL 🎡</Text>
                <Text style={{ fontSize: 9, fontWeight: '700', color: txtSec, marginTop: 2, marginBottom: 16 }}>Win ZenPoints or a free-delivery coupon</Text>

                <View style={{ width: 260, height: 260, justifyContent: 'center', alignItems: 'center', marginVertical: 12 }}>
                  <Animated.Text style={{ fontSize: 26, color: '#D4AF7A', position: 'absolute', top: -16, zIndex: 15, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4, transform: [{ translateY: pointerBounce }] }}>▼</Animated.Text>

                  <View style={{ width: 250, height: 250, borderRadius: 125, borderWidth: 6, borderColor: '#D4AF7A', backgroundColor: '#0B0B0D', justifyContent: 'center', alignItems: 'center', shadowColor: '#D4AF7A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 6 }}>
                    <Animated.View style={{
                      width: 238,
                      height: 238,
                      borderRadius: 119,
                      backgroundColor: '#111318',
                      overflow: 'hidden',
                      transform: [{ rotate: spinAnim.interpolate({ inputRange: [0, 360000], outputRange: ['0deg', '360000deg'] }) }]
                    }}>
                      {wheelSectors.map((_, idx) => (
                        <View
                          key={`line-${idx}`}
                          style={{ position: 'absolute', width: 1.5, height: 119, backgroundColor: 'rgba(212, 175, 122, 0.25)', top: 0, left: 118, transform: [{ rotate: `${idx * sectorDeg + sectorDeg / 2}deg` }, { translateY: 59.5 }] }}
                        />
                      ))}
                      {wheelSectors.map((sector, idx) => (
                        <View
                          key={`sector-${idx}`}
                          style={{ position: 'absolute', width: 86, height: 86, top: 76, left: 76, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: `${idx * sectorDeg}deg` }, { translateY: -64 }] }}
                        >
                          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: sector.color, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                            <Text style={{ fontSize: 15 }}>{sector.emoji}</Text>
                          </View>
                          <Text style={{ fontSize: 7, fontWeight: '900', color: '#fff', textAlign: 'center', marginTop: 3, width: 70 }}>{sector.label}</Text>
                        </View>
                      ))}
                      {wheelSectors.length === 0 && (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                          {rewardsStatus === 'loading' ? <ActivityIndicator color="#D4AF7A" /> : <Text style={{ fontSize: 40 }}>🎡</Text>}
                        </View>
                      )}
                    </Animated.View>
                  </View>

                  <Animated.View style={{ position: 'absolute', transform: [{ scale: spinBtnScale }], zIndex: 10 }}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      disabled={isSpinning || (!!myId && wheelSectors.length === 0)}
                      onPress={handleSpin}
                      accessibilityLabel="Spin the wheel"
                      style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: spinsLeft > 0 || !myId ? '#D4AF7A' : '#9CA3AF', alignItems: 'center', justifyContent: 'center', shadowColor: '#D4AF7A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 6, elevation: 5, borderWidth: 3, borderColor: '#fff' }}
                    >
                      {isSpinning ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <Text style={{ fontSize: 9.5, fontWeight: '900', color: '#000', letterSpacing: 0.5 }}>{spinsLeft > 0 || !myId ? 'SPIN' : 'LOCKED'}</Text>
                      )}
                    </TouchableOpacity>
                  </Animated.View>
                </View>

                <Text style={{ fontSize: 9, fontWeight: '800', color: spinsLeft > 0 ? COLORS.gold : txtSec, marginTop: 8, textAlign: 'center' }}>
                  {!myId
                    ? 'Log in to see your spins'
                    : rewardsStatus === 'error' || (rewardsStatus === 'ready' && wheelSectors.length === 0)
                      ? 'Could not load your spins. Pull down to retry.'
                      : spinsLeft > 0
                        ? `🎉 YOU HAVE ${spinsLeft} SPIN${spinsLeft === 1 ? '' : 'S'} READY`
                        : spinNextIn
                          ? `${spinNextIn} more delivered order${spinNextIn === 1 ? '' : 's'} to your next spin`
                          : 'Every 2 delivered orders earn a spin'}
                </Text>
              </View>
            </Animated.View>

            {/* 3. Your coupons (real, usable ones only) */}
            <Animated.View style={{ opacity: couponsEnterO, transform: [{ translateY: couponsEnterY }] }}>
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: txt, letterSpacing: 1.5, marginBottom: 12, textAlign: 'center' }}>YOUR COUPONS 🎟️</Text>

                {!myId ? (
                  <View style={[s.emptyState, { padding: 24 }]}>
                    <Text style={{ color: txtSec, fontSize: 11, fontWeight: '600', textAlign: 'center' }}>Log in to see the coupons you have won.</Text>
                  </View>
                ) : rewardsStatus === 'loading' && coupons.length === 0 ? (
                  <View style={{ gap: 10 }}>
                    {[0, 1].map(i => <ShimmerLoader key={i} width={SW - 32} height={70} borderRadius={16} />)}
                  </View>
                ) : rewardsStatus === 'error' && coupons.length === 0 ? (
                  renderLoadError('Your coupons did not load.', fetchRewards)
                ) : coupons.length === 0 ? (
                  <View style={[s.emptyState, { padding: 24 }]}>
                    <Text style={{ fontSize: 28, marginBottom: 6 }}>🎫</Text>
                    <Text style={{ color: txt, fontSize: 12, fontWeight: '900', marginBottom: 4 }}>No coupons yet</Text>
                    <Text style={{ color: txtSec, fontSize: 10, fontWeight: '600', textAlign: 'center' }}>Spin the wheel or claim a daily deal — coupons you win show up here.</Text>
                  </View>
                ) : (
                  coupons.map((coupon: any, index: number) => {
                    const code = String(coupon.code || '');
                    const anim = couponAnims[index] || null;
                    const days = Number(coupon.expiresInDays);
                    const expiry = Number.isFinite(days) && coupon.expiresInDays !== null
                      ? (days <= 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`)
                      : 'No expiry';
                    return (
                      <Animated.View key={code || index} style={anim ? { opacity: anim.o, transform: [{ translateY: anim.y }] } : undefined}>
                        <View style={{ backgroundColor: cardBg, borderWidth: 1.5, borderColor: border, borderRadius: 16, padding: 14, marginBottom: 10, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ position: 'absolute', left: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: isDark ? '#0B0B0D' : '#F8FAFC', borderWidth: 1.5, borderColor: border }} />
                          <View style={{ position: 'absolute', right: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: isDark ? '#0B0B0D' : '#F8FAFC', borderWidth: 1.5, borderColor: border }} />

                          <View style={{ flex: 1, paddingHorizontal: 6 }}>
                            <Text style={{ fontSize: 7.5, fontWeight: '900', color: COLORS.gold, letterSpacing: 1 }}>{expiry.toUpperCase()}</Text>
                            <Text style={{ fontSize: 12, fontWeight: '900', color: txt, marginTop: 2 }}>{coupon.label || 'Coupon'}</Text>
                            <Text style={{ fontSize: 8.5, color: txtSec, marginTop: 2 }}>Use code {code} at checkout</Text>
                          </View>

                          <View style={{ width: 1, height: 40, borderStyle: 'dashed', borderWidth: 0.5, borderColor: border, marginHorizontal: 8 }} />

                          <Animated.View style={{ transform: [{ scale: popBtnCode === code ? btnScaleAnim : 1.0 }] }}>
                            <TouchableOpacity
                              onPress={() => {
                                handleCopyCode(code);
                                Haptics.selectionAsync().catch(() => {});
                              }}
                              style={{ backgroundColor: copiedCode === code ? COLORS.emerald : COLORS.red, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, minWidth: 85, alignItems: 'center', justifyContent: 'center' }}
                              accessibilityLabel={`Copy code ${code}`}
                            >
                              <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 }} numberOfLines={1}>{copiedCode === code ? 'COPIED ✓' : code}</Text>
                            </TouchableOpacity>
                          </Animated.View>
                        </View>
                      </Animated.View>
                    );
                  })
                )}
              </View>
            </Animated.View>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>
      </Animated.View>

      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} searchMode={activeTab === 'food' ? 'grocery' : 'food'} />

      {/* ── PRODUCT CATALOG BOTTOM SHEET ── */}
      {selectedCategoryName !== null && (
        <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
          <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={closeCatalogSheet}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: catalogBackdropAnim }]} />
          </TouchableOpacity>

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
            <View style={s.grabHandle} />

            <View style={s.catalogHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[s.catalogTitle, { color: txt }]} numberOfLines={1}>{(selectedCategoryName === 'All Groceries' ? 'All groceries' : selectedCategoryName).toUpperCase()}</Text>
                {sheetProducts.length > 0 && <Text style={{ fontSize: 10, color: txtSec, fontWeight: '700', marginTop: 2 }}>{sheetProducts.length} item{sheetProducts.length === 1 ? '' : 's'}</Text>}
              </View>
              <TouchableOpacity style={s.catalogCloseBtn} onPress={closeCatalogSheet} accessibilityLabel="Close">
                <Text style={{ fontSize: 18, color: txtSec, fontWeight: '800' }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {catalogueStatus === 'loading' && catalogue.length === 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {[0, 1, 2, 3].map(i => <ShimmerLoader key={i} width={(SW - 40 - 12 - 8) / 2} height={190} borderRadius={20} />)}
                </View>
              ) : catalogueStatus === 'error' && catalogue.length === 0 ? (
                renderLoadError('The campus store did not load.', fetchCatalogue)
              ) : sheetProducts.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>🧺</Text>
                  <Text style={{ fontSize: 13, fontWeight: '900', color: txt }}>Nothing here yet</Text>
                  <Text style={{ fontSize: 11, color: txtSec, textAlign: 'center', marginTop: 4, marginBottom: 14, maxWidth: 260 }}>Request it and a Zenvy shopper will buy it for you.</Text>
                  <TouchableOpacity style={[s.resetBtn, { backgroundColor: '#10B981' }]} onPress={() => { closeCatalogSheet(); openCustomRequest(); }}>
                    <Text style={[s.resetBtnText, { color: '#fff' }]}>REQUEST AN ITEM</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 4 }}>
                  {sheetProducts.map(product => renderGridCard(product, (SW - 40 - 12 - 8) / 2, () => { closeCatalogSheet(); openProduct(product); }))}
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      )}

      {/* ── FLOATING BASKET BAR ── */}
      {hasShopItems && (
        <Animated.View style={[s.floatingCartBar, { transform: [{ translateY: cartBarAnim }] }]}>
          <TouchableOpacity activeOpacity={0.95} style={s.floatingCartBarTouch} onPress={() => router.push('/checkout' as any)}>
            <LinearGradient colors={['#16A34A', '#15803D']} style={s.floatingCartBarGradient}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 8 }}>
                <Text style={{ fontSize: 18 }}>🛒</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.cartBarTitle}>{shopCount} ITEM{shopCount > 1 ? 'S' : ''} ADDED</Text>
                  <Text style={s.cartBarSubtitle} numberOfLines={1}>{fmtPrice(Math.round(shopSubtotal * 100) / 100)} • {shopStoreName}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[s.cartBarCta, { fontSize: 9.5 }]}>VIEW BASKET</Text>
                <Text style={{ fontSize: 11, color: '#fff', marginLeft: 2 }}>➔</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* ── SPIN RESULT MODAL ── */}
      <Modal
        visible={showWheelModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => { setShowWheelModal(false); setWheelResult(null); }}
      >
        <View style={s.promoOverlayCentred}>
          {wheelResult !== null && <Confetti />}

          <View style={[s.promoPopupCard, { backgroundColor: isDark ? '#1F2937' : '#fff' }]}>
            <TouchableOpacity style={s.promoCloseBtn} onPress={() => { setShowWheelModal(false); setWheelResult(null); }} accessibilityLabel="Close">
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>

            <View style={{ alignItems: 'center', marginVertical: 12 }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>🎉</Text>
              <Text style={[s.modalTitle, { color: txt, textAlign: 'center', marginBottom: 4 }]}>CONGRATULATIONS!</Text>
              <Text style={{ fontSize: 9.5, fontWeight: '800', color: txtSec, textAlign: 'center', marginBottom: 12 }}>
                {wheelResult?.coupon ? 'Your coupon is ready to use at checkout.' : 'Added to your ZenPoints balance.'}
              </Text>

              {wheelResult && (
                <LinearGradient colors={['#AA7C11', '#D4AF7A', '#AA7C11']} style={{ paddingHorizontal: 20, paddingVertical: 16, borderRadius: 20, width: '100%', alignItems: 'center', marginVertical: 10 }}>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#000', textAlign: 'center' }}>{wheelResult.display}</Text>
                  {wheelResult.coupon && (
                    <>
                      <Text style={{ fontSize: 8.5, fontWeight: '800', color: '#451A03', marginTop: 6, letterSpacing: 0.5 }}>YOUR COUPON CODE</Text>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#000', letterSpacing: 1.5, marginTop: 4 }}>{wheelResult.coupon.code}</Text>
                      {!!wheelResult.coupon.expiryDate && !isNaN(new Date(wheelResult.coupon.expiryDate).getTime()) && (
                        <Text style={{ fontSize: 8.5, fontWeight: '700', color: '#451A03', marginTop: 4 }}>
                          Valid till {new Date(wheelResult.coupon.expiryDate).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                        </Text>
                      )}
                    </>
                  )}
                </LinearGradient>
              )}

              {wheelResult?.coupon && (
                <TouchableOpacity
                  onPress={() => {
                    const code = wheelResult.coupon!.code;
                    handleCopyCode(code);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                  style={{ backgroundColor: '#111827', width: '100%', paddingVertical: 12, borderRadius: 14, alignItems: 'center', marginTop: 10 }}
                >
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{copiedCode === wheelResult.coupon.code ? 'CODE COPIED ✓' : 'COPY COUPON CODE'}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={() => { setShowWheelModal(false); setWheelResult(null); }} style={{ paddingVertical: 12, marginTop: 6 }}>
                <Text style={{ fontSize: 9.5, fontWeight: '900', color: COLORS.gold, letterSpacing: 1 }}>AWESOME!</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── SAVED ITEMS MODAL ── */}
      <Modal visible={favoritesModalVisible} animationType="slide" transparent={true} onRequestClose={() => setFavoritesModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setFavoritesModalVisible(false)} />
          <View style={{ backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', minHeight: '45%', paddingBottom: Platform.OS === 'ios' ? 36 : 24, borderWidth: 1, borderColor: border }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? '#3F3F46' : '#E4E4E7', alignSelf: 'center', marginTop: 10, marginBottom: 14 }} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderColor: border }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 17, fontWeight: '900', color: txt }}>Saved Items ❤️</Text>
                  {savedFavoritesList.length > 0 && (
                    <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                      <Text style={{ color: '#EF4444', fontSize: 10, fontWeight: '900' }}>{savedFavoritesList.length} SAVED</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 10.5, color: txtSec, fontWeight: '600', marginTop: 2 }}>Products you starred in the campus store</Text>
              </View>
              <TouchableOpacity style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isDark ? '#27272A' : '#F1F5F9', alignItems: 'center', justifyContent: 'center' }} onPress={() => setFavoritesModalVisible(false)} accessibilityLabel="Close">
                <Ionicons name="close" size={18} color={txt} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ paddingHorizontal: 16, paddingTop: 12 }} showsVerticalScrollIndicator={false}>
              {savedFavoritesList.length > 0 ? (
                savedFavoritesList.map(item => (
                  <View key={item.id} style={{ flexDirection: 'row', backgroundColor: isDark ? '#242428' : '#F8FAFC', borderRadius: 16, borderWidth: 1, borderColor: border, padding: 12, marginBottom: 12, gap: 12, alignItems: 'center' }}>
                    <Image source={{ uri: item.image }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: isDark ? '#333' : '#E2E8F0' }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: '900', color: txt, lineHeight: 16 }} numberOfLines={2}>{item.title}</Text>
                      <Text style={{ fontSize: 9.5, color: txtSec, marginTop: 2 }} numberOfLines={1}>{item.subtitle}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                        <Text style={{ fontSize: 13, fontWeight: '900', color: '#10B981' }}>{item.price}</Text>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <TouchableOpacity style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: isDark ? '#3F3F46' : '#E2E8F0' }} onPress={() => removeSaved(item.id)}>
                            <Text style={{ fontSize: 9, fontWeight: '800', color: txtSec }}>REMOVE</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: '#EF4444' }}
                            onPress={() => {
                              setFavoritesModalVisible(false);
                              router.push(item.targetRoute as any);
                            }}
                          >
                            <Text style={{ fontSize: 9, fontWeight: '900', color: '#FFF' }}>VIEW ➔</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </View>
                ))
              ) : (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
                  <Text style={{ fontSize: 36, marginBottom: 10 }}>🔖</Text>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: txt }}>Nothing saved yet</Text>
                  <Text style={{ fontSize: 11, color: txtSec, marginTop: 4, textAlign: 'center', maxWidth: 260 }}>
                    Tap the ☆ on any product in Food & Basket to save it here.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── POST A RIDE SHEET (modules/coride/PostRideSheet; state + submit stay here) ── */}
      <PostRideSheet
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        creatorRole={creatorRole}
        setCreatorRole={setCreatorRole}
        origin={origin}
        setOrigin={setOrigin}
        destination={destination}
        setDestination={setDestination}
        departureTime={departureTime}
        setDepartureTime={setDepartureTime}
        setDepartureDate={setDepartureDate}
        vehicleType={vehicleType}
        setVehicleType={setVehicleType}
        availableSeats={availableSeats}
        setAvailableSeats={setAvailableSeats}
        estimatedFuelCost={estimatedFuelCost}
        setEstimatedFuelCost={setEstimatedFuelCost}
        notes={notes}
        setNotes={setNotes}
        rideVibe={rideVibe}
        setRideVibe={setRideVibe}
        autoApprove={autoApprove}
        setAutoApprove={setAutoApprove}
        submitting={submittingRide}
        onSubmit={handleCreateRide}
        onOpenAuto={() => { setShowCreateModal(false); setCorideTab('auto'); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 36 : Platform.OS === 'web' ? 12 : 44, width: '100%', maxWidth: 600, alignSelf: 'center' },

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
    color: '#8B8B93',
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
    color: '#617088',
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

  emptyState: { padding: 48, alignItems: 'center', justifyContent: 'center' },
  resetBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  resetBtnText: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },










  floatingFab: { paddingVertical: 14, borderRadius: 16, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', marginVertical: 12, ...SHADOWS.redGlow },
  floatingFabText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 2 },

  // Modal styling
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
    color: '#617088',
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
    color: '#8B8B93',
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
    color: '#8B8B93',
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
