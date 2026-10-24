import * as Haptics from 'expo-haptics';
import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, useWindowDimensions, Platform, TextInput, ActivityIndicator, Alert, Modal, Linking, Animated, Vibration, RefreshControl, BackHandler, Share } from 'react-native';
import { PressScale, BounceOnChange, FadeInUp, StateCard, SlowLoadHint } from '../../modules/others/motion';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from '../../components/SafeImage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams, useFocusEffect, useIsFocused } from 'expo-router';
import { COLORS, SHADOWS, RADIUS, surfaceLift, LIGHT_HAIRLINE, LIGHT_SURFACE, LIGHT_SURFACE_SM } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, readJson, SERVER_BUSY_MESSAGE, NETWORK_ERROR_MESSAGE } from '../../utils/auth';
import { readCache, writeCache, useSWRJson } from '../../utils/swrCache';
import { ENDPOINTS, API_URL, ZENVY_SUPPORT_PHONE } from '../../constants/api';
import { useCart, isCustomRequest } from '../../context/CartContext';
import PromoCarousel from '../../components/PromoCarousel';
import SpinWheelSvg from '../../components/others/SpinWheelSvg';
import SearchOverlay from '../../components/SearchOverlay';
import AmbientBackground from '../../components/AmbientBackground';
import DopaminePressable, { CardPressable } from '../../components/DopaminePressable';
import { FloatingPulse, BounceIn } from '../../components/AnimatedSection';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import SafeImage from '../../components/SafeImage';
import ShimmerLoader from '../../components/ShimmerLoader';
import { PgV2OthersSection } from '../../modules/pgV2/PgV2Route';
import { reloadPgV2List } from '../../modules/pgV2/pgV2Data';
import { PG_HEADER as PG_V2_HEADER, PG_HINTS as PG_V2_HINTS } from '../../modules/pgV2/PgV2Home';
import { useLiveSync, hasType } from '../../utils/useLiveSync';
import RentalsSection from '../../modules/rentals/RentalsSection';
import AutoRideSection from '../../modules/autoRide/AutoRideSection';
import { useAutoRideStatus } from '../../modules/autoRide/ui';
import CampusEventsSection from '../../modules/campusEvents/CampusEventsSection';
import { useCampusEventsStatus } from '../../modules/campusEvents/ui';
import CoRideHub from '../../modules/coride/CoRideHub';
import SectionHeader, { FOOD_HEADER, type HeaderColors } from '../../modules/foodV2/FoodV2SectionHeader';
import { useUnreadDot } from '../../modules/foodV2/FoodV2HomeTop';
import { ACCENTS as OTHERS_ACCENTS, PILL_ACCENT, shadow as othersShadow, TYPE as OTHERS_TYPE, RADIUS as OTHERS_RADIUS, STATUS as OTHERS_STATUS, SURFACE as OTHERS_SURFACE } from '../../modules/others/othersTheme';
import PostRideSheet, { maxSeatsFor } from '../../modules/coride/PostRideSheet';
import { fmtRideWhen, groupMyRides, topDestinations, sameDestination, inr } from '../../modules/coride/coRideFormat';
import { useTopInset } from '../../utils/useTopInset';
import FoodV2Screen from '../../modules/foodV2/FoodV2Screen';

const { width: SW, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SH = SCREEN_HEIGHT;
const DEPT_SIZE = (SW - 48 - 36) / 4;

const ScalePressable = ({ children, onPress, style, activeOpacity = 0.85, accessibilityLabel, accessibilityRole = 'button', accessibilityHint }: any) => {
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
    <PressScale
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      style={style}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </PressScale>
  );
};

type IonName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { key: string; label: string; icon: IonName }[] = [
  // Owner order (24 Oct): PG stays right after Food & groceries.
  { key: 'food', label: 'Food & groceries', icon: 'basket-outline' },
  { key: 'pg', label: 'PG stays', icon: 'business-outline' },
  { key: 'services', label: 'Tech & repairs', icon: 'construct-outline' },
  { key: 'coride', label: 'Co-Ride', icon: 'bicycle-outline' },
  { key: 'rentals', label: 'Rentals', icon: 'car-outline' },
  // Campus Events: shown only while GET /api/campus-events/status says enabled (see visibleTabs).
  { key: 'events', label: 'Campus events', icon: 'ticket-outline' },
  { key: 'promos', label: 'Deals & spin', icon: 'gift-outline' },
];

const BB_CATEGORIES: { key: string; label: string; icon: IonName }[] = [
  { key: 'Fresh', label: 'Fruits & veggies', icon: 'nutrition-outline' },
  { key: 'Grocery', label: 'Atta & staples', icon: 'basket-outline' },
  { key: 'Chips & Namkeens', label: 'Snacks & chips', icon: 'fast-food-outline' },
  { key: 'Biscuits & Cakes', label: 'Biscuits & cakes', icon: 'cafe-outline' },
  { key: 'Health', label: 'Health & care', icon: 'medkit-outline' },
  { key: 'Electronics', label: 'Electronics', icon: 'flash-outline' },
  { key: 'Toys', label: 'Toys & play', icon: 'game-controller-outline' },
  { key: 'Seeds', label: 'Seeds & greens', icon: 'leaf-outline' },
];

// Wheel look only. The prizes (labels, order) come from GET /api/rewards/spin-eligibility and the
// server picks the result in POST /api/rewards/use-spin.
// Display mirror of the server's 8-sector prize table (same order as backend SPIN_PRIZES), used only to
// draw the wheel before the live table arrives (signed out). The server still picks every prize.
const WHEEL_PRIZE_MIRROR = [
  { label: 'FREE DEL', display: 'Free delivery' }, { label: '10 ZEN' }, { label: '20 ZEN' }, { label: '5 ZEN' },
  { label: '50 ZEN' }, { label: '100 ZEN' }, { label: '5 ZEN' }, { label: '2 ZEN' },
];

const ACCENTS_FOOD_SOLID = OTHERS_ACCENTS.food.solid;
const ACCENTS_FOOD_DEEP = OTHERS_ACCENTS.food.deep;

const WHEEL_STYLES = [
  { color: '#F59E0B' },
  { color: '#10B981' },
  { color: '#3B82F6' },
  { color: '#8B5CF6' },
  { color: '#EC4899' },
  { color: '#EF4444' },
  { color: '#06B6D4' },
  { color: '#6B7280' },
];

// Hero carousel copy: sentence case, shown as written (components/PromoCarousel).
const PROMOS_FOOD = [
  { id: 'f1', tagline: 'Campus stationery', title: 'Exam essentials', subtitle: '', desc: 'Notebooks, pens, lab coats and study kits, delivered to your hostel.', btn: 'Explore', img: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=900&q=80' },
  { id: 'f2', tagline: 'Fitness gear', title: 'Stay active in the hostel', subtitle: '', desc: 'Skipping ropes, resistance bands and yoga mats for your room workouts.', btn: 'Explore', img: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=900&q=80' },
  { id: 'f3', tagline: 'Night canteen and pantry', title: 'Your hostel grocery run', subtitle: '', desc: 'Snacks, dairy, instant noodles and drinks from the campus mart.', btn: 'Explore', img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=900&q=80' },
];

const PROMOS_SERVICES = [
  { id: 's1', tagline: 'Laptop and phone', title: 'Tech repairs on campus', subtitle: '', desc: 'Screen replacement, fan cleaning, thermal paste and hardware fixes. Book a slot in the app.', btn: 'Book a repair', img: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=1200&q=80' },
  { id: 's2', tagline: 'Campus tailoring', title: 'Uniform and fabric alterations', subtitle: '', desc: 'Lab coat tailoring, fitting alterations, blazer adjustments and stitching requests.', btn: 'Request a tailor', img: 'https://images.unsplash.com/photo-1630930678172-63343537a00a?w=1200&q=80' },
  { id: 's3', tagline: 'Document hub', title: 'Printing and binding', subtitle: '', desc: 'Project reports, spiral binding, colour charts and assignment prints.', btn: 'Send a print job', img: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=1200&q=80' },
];

const PROMOS_PG = [
  { id: 'p1', tagline: 'Student stays', title: 'PG residences near campus', subtitle: '', desc: 'Compare rent, sharing type and distance from campus, then request a bed right here.', btn: 'Browse stays', img: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80' },
  { id: 'p2', tagline: 'Book in the app', title: 'Request a bed, we confirm it', subtitle: '', desc: 'Send a booking request and the housing team confirms it with you.', btn: 'View listings', img: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=80' },
];

const PROMOS_CORIDE = [
  // Not shown in the carousel any more (the Co-Ride tab opens on its own mode switch); kept for TAB_PROMOS.
  { id: 'c1', tagline: 'Student bike pool', title: 'Co-Ride', subtitle: '', desc: 'Share rides between campus, Vijayawada and Guntur with other students and split the fuel.', btn: 'Post a ride', img: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=1200&q=80' },
  { id: 'c4', tagline: 'Shared autos', title: 'Book a seat', subtitle: '', desc: 'Book a seat in a shared auto with a verified driver. Pay the driver at boarding.', btn: 'Book a seat', img: 'https://images.unsplash.com/photo-1449965408869-ebd13bc9e5a8?w=1200&q=80' },
];

const PROMOS_OFFERS = [
  { id: 'o1', tagline: 'Order rewards', title: 'Spin the reward wheel', subtitle: '', desc: 'Every 2 delivered orders earn a spin. Win ZenPoints or a free-delivery coupon.', btn: 'Spin the wheel', img: 'https://images.unsplash.com/photo-1596451190630-186aff535bf2?w=900&q=80' },
  { id: 'o2', tagline: 'Your coupons', title: 'Ready to use at checkout', subtitle: '', desc: 'Coupons you have won show up here with their expiry date.', btn: 'See my coupons', img: 'https://images.unsplash.com/photo-1607344645866-009c320b63e0?w=900&q=80' },
];

const PROMOS_RENTALS = [
  { id: 'r1', tagline: 'Student vehicles', title: 'Rent a ride from classmates', subtitle: '', desc: 'Bikes, scooters and cars from college-verified students. PIN pickup, cash at handover.', btn: 'Browse vehicles', img: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=1200&q=80' },
  { id: 'r2', tagline: 'Earn from your vehicle', title: 'Rent it out, you set the price', subtitle: '', desc: 'List your bike, scooter or car in minutes. Every renter and their licence is verified.', btn: 'List my vehicle', img: 'https://images.unsplash.com/photo-1449965408869-ebd13bc9e5a8?w=1200&q=80' },
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
      { name: 'Gourmet', img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&q=80' }
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

/** Campus ordering closes at 9 pm (backend utils/storeHours NIGHT_START_HOUR) when the server sends no closesAt. */
const CAMPUS_CLOSES_AT = '21:00';

// ── Food & groceries (owner reference, 22 Oct): green accent, basket category tiles, listing heroes ──
// Tiles open real catalogue shelves (SHELVES below); tiles with no products are hidden. Photos are
// Unsplash images checked by hand for the subject.
const BASKET_TILES: { key: string; label: string; img: string; tint: string }[] = [
  { key: 'Grocery', label: 'Groceries', img: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=300&q=70', tint: '#EAF5EC' },
  { key: 'Fresh', label: 'Fruits & vegetables', img: 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=300&q=70', tint: '#E8F1FB' },
  { key: 'Snacks & beverages', label: 'Snacks & beverages', img: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=300&q=70', tint: '#E6F4F8' },
  { key: 'Bakery & breakfast', label: 'Bakery & breakfast', img: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=300&q=70', tint: '#FDF0E6' },
  { key: 'Toys', label: 'Toys & games', img: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=300&q=70', tint: '#F1ECFB' },
  { key: 'Health & care', label: 'Health & personal care', img: 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=300&q=70', tint: '#E7F0FA' },
];

type ListingHero = { title: string; sub: string; img: string; tint: string; tintDark: string };
const HERO_GREEN = { tint: '#EAF5EC', tintDark: '#14241A' };
const LISTING_HEROES: Record<string, ListingHero> = {
  'All Groceries': { title: 'Everything in the campus store', sub: 'Groceries · Snacks · Essentials', img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&q=70', ...HERO_GREEN },
  Grocery: { title: 'Fresh groceries at best prices', sub: 'Quality · Fresh · Daily', img: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=500&q=70', ...HERO_GREEN },
  Fresh: { title: 'Fresh and healthy, always', sub: 'Farm fresh · Daily', img: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=500&q=70', ...HERO_GREEN },
  'Snacks & beverages': { title: 'Snack time, sorted', sub: 'Chips · Drinks · Chocolates', img: 'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=500&q=70', tint: '#FFF6E2', tintDark: '#2A2416' },
  'Bakery & breakfast': { title: 'Freshly baked, every day', sub: 'Biscuits · Cakes · Breakfast', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500&q=70', tint: '#FDF0E6', tintDark: '#2A1F16' },
  'Health & care': { title: 'Stay healthy, stay fresh', sub: 'Wellness · Personal care · Hygiene', img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=70', tint: '#E6F1FB', tintDark: '#16202B' },
  Toys: { title: 'Play time, delivered', sub: 'Games · Plushies · Sports', img: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=500&q=70', tint: '#F1ECFB', tintDark: '#211B2E' },
  Deals: { title: 'Best deals today', sub: 'Biggest savings, at the price you pay', img: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&q=70', ...HERO_GREEN },
  Seeds: { title: 'Grow your own greens', sub: 'Seeds for your balcony garden', img: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=500&q=70', ...HERO_GREEN },
  Electronics: { title: 'Chargers and gadgets', sub: 'Cables · Adapters · Study tech', img: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=500&q=70', tint: '#E6F1FB', tintDark: '#16202B' },
};
const FOOD_HERO_IMG = 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&q=70';

/** Tech & repairs search hints (the header search opens the repairs page with its search). */
const SERVICE_SEARCH_HINTS = ["Search for 'laptop screen'", "Search for 'phone battery'", "Search for 'keyboard repair'", "Search for 'fan cleaning'"];
/** PG stays and Co-Ride: the header search focuses the section's own search box (never the grocery search). */
const PG_SEARCH_HINTS = PG_V2_HINTS;
const CORIDE_SEARCH_HINTS = ['Search lifts by destination', "Search for 'Vijayawada'", "Search for 'Guntur'"];
const EVENTS_SEARCH_HINTS = ['Search events and venues', "Search for 'hackathon'", "Search for 'cricket'"];
/** Sections without a search of their own (Deals, Rentals): the search says what it searches. */
const STORE_SEARCH_HINTS = ['Search the campus store'];
/** Others header per section: Food & groceries' structure, each section in its own accent (deep tones for white text). */
const SECTION_HEADER: Record<string, HeaderColors> = {
  food: FOOD_HEADER,
  services: { top: '#211A6B', bottom: '#2D2491', pillOnBg: '#EFEDFF', pillOnInk: '#3B2FC4' },
  pg: PG_V2_HEADER, // PG v2 indigo; its bottom colour continues into the PG v2 hero
  coride: { top: '#0E2A66', bottom: '#15398C', pillOnBg: '#EAF1FF', pillOnInk: '#1E40AF' },
  promos: { top: '#2A1670', bottom: '#381F94', pillOnBg: '#EFEBFF', pillOnInk: '#4B2BC8' },
  neutral: { top: '#1B2433', bottom: '#263247', pillOnBg: '#F1F3F6', pillOnInk: '#1E293B' },
};
const SECTION_SUBTITLE: Record<string, string> = {
  services: 'Campus services', pg: 'PG stays near campus', coride: 'Co-Ride · Lifts and autos',
  rentals: 'Rentals', events: 'Campus events', promos: 'Deals & spin',
};
const SEARCH_PLACEHOLDERS = ["Search for 'rice'", "Search for 'chips'", "Search for 'curd'", "Search for 'atta'", "Search for 'ghee'", "Search for 'toys'", "Search for 'seeds'"];

// Shelf tiles only: each tile's badge ("Up to x% off" / "From ₹y") is computed from the real catalogue.
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
  /** Real customer rating (shown only when ratingCount > 0). */
  rating: number | null;
  ratingCount: number;
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
    rating: Number.isFinite(Number(raw.rating)) && Number(raw.rating) > 0 ? Number(raw.rating) : null,
    ratingCount: Math.max(0, Math.floor(Number(raw.ratingCount) || 0)),
  };
};

/** Indian digit grouping (₹1,23,456.50) without relying on Intl, which older Hermes builds lack. */
const groupIN = (digits: string) => {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  return `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
};
const fmtPrice = (n: number) => {
  const v = Math.abs(Number(n) || 0);
  const [whole, frac] = (Number.isInteger(v) ? String(v) : v.toFixed(2)).split('.');
  return `${Number(n) < 0 ? '-' : ''}₹${groupIN(whole)}${frac ? `.${frac}` : ''}`;
};
/** "Salt, Sugar & Jaggery" -> "Salt, sugar & jaggery" (display only; shelf keys keep their names). */
const sentence = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t);
/** Veg / non-veg marks only make sense on food: not on soap, toys, seeds or chargers. */
const NON_FOOD_CATEGORY = /bath|body|hair|beauty|skin|detergent|clean|hygiene|health|electronic|toy|seed|stationer/i;
const isFoodProduct = (p: CatalogueItem) => p.vendorType === 'GROCERY' && !NON_FOOD_CATEGORY.test(p.category || '');
/** What a daily deal's coupon is worth, the way the server builds it (routes/vaultRoutes claim):
 *  a free-delivery coupon, or (original price - deal price) off. */
const vaultDealTag = (item: any): string | null => {
  if (/free\s*delivery/i.test(String(item?.name || ''))) return 'Free delivery';
  const value = Math.max(0, (Number(item?.originalPrice) || 0) - (Number(item?.price) || 0));
  return value > 0 ? `${fmtPrice(value)} off` : null;
};
/** Minimum order for a coupon claimed from this deal, as the server sets it (routes/vaultRoutes.js
 * vaultMinOrder): the deal's own minimum, else its original price. */
const vaultMinOrder = (item: any): number => {
  const own = Number(item?.minOrderValue);
  if (Number.isFinite(own) && own > 0) return Math.round(own);
  const mrp = Number(item?.originalPrice);
  return Number.isFinite(mrp) && mrp > 0 ? Math.round(mrp) : 0;
};
/** Server prize text without the emoji ("10 ZenPoints 💎" -> "10 ZenPoints"). */
const stripEmoji = (t: string) => String(t || '').replace(/[\uD800-\uDFFF\u2600-\u27BF\uFE0F]/g, '').replace(/\s+/g, ' ').trim();
const discountLabel = (p: CatalogueItem) => (p.discountPercent ? `${p.discountPercent}% off` : null);

// Which catalogue items a tile / pill / brand opens. Anything not listed here matches its own
// category name (or product names containing it). Tiles with no real products are hidden.
type Shelf = { categories?: string[]; keywords?: string[]; vendorTypes?: string[]; deals?: boolean };
const SHELVES: Record<string, Shelf> = {
  'All Groceries': { vendorTypes: ['GROCERY'] },
  Fresh: { categories: ['Fresh', 'Fresh Fruits', 'Fruits', 'Vegetables', 'Leafy Greens'] },
  Grocery: { categories: ['Grocery', 'Staples', 'Atta & Flours', 'Dals & Pulses', 'Rice & Grains', 'Edible Oils & Ghee', 'Oils', 'Masalas & Spices', 'Salt, Sugar & Jaggery', 'Daily Essentials', 'Dairy', 'Dry Fruits'] },
  'Snacks & beverages': { categories: ['Snacks', 'Chips & Namkeens', 'Lays', 'Drinks & Juices', 'Juices & Cups', 'Coca Cola', 'Tea & Coffee', 'Nescafe', 'Cadbury', 'Sweet Indulgences', 'Instant & Frozen Food'] },
  'Bakery & breakfast': { categories: ['Bakery', 'Biscuits & Cakes', 'Breakfast Options'] },
  'Health & care': { categories: ['Health', 'Monsoon Wellness Picks', 'Bath, Body & Hair', 'Beauty & Skincare'] },
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

/** Listing page key for "search the whole campus store" (header search on Food & groceries). */
const SEARCH_SHELF = '__search';

/** Shelves computed once per catalogue array (render-time callers ask for the same shelves again and again). */
const shelfCache = new WeakMap<CatalogueItem[], Map<string, CatalogueItem[]>>();
const shelfItems = (name: string | null, items: CatalogueItem[]): CatalogueItem[] => {
  if (!name) return [];
  let byName = shelfCache.get(items);
  if (!byName) { byName = new Map(); shelfCache.set(items, byName); }
  const hit = byName.get(name);
  if (hit) return hit;
  const out = computeShelf(name, items);
  byName.set(name, out);
  return out;
};
const computeShelf = (name: string, items: CatalogueItem[]): CatalogueItem[] => {
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
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset(36, Platform.OS === 'web' ? 12 : 44);
  const { isDark, toggleTheme, colors } = useTheme();
  // Live window width (follows rotation / window resizes); the screen is capped at 600 wide.
  const { width: winW } = useWindowDimensions();
  const pageW = Math.min(winW, 600);
  const { user, setUser, refreshUser } = useAuth();
  const router = useRouter();
  const unreadDot = useUnreadDot();
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
  // Header search on PG stays / Co-Ride: bumped to focus that section's own search box.
  const [sectionSearchTick, setSectionSearchTick] = useState(0);
  // Deals / Rentals header search: open Food & groceries on its search screen (the store search lives there).
  const [storeSearchOnOpen, setStoreSearchOnOpen] = useState(false);
  // Stable, so the memoized Food & groceries screen is not re-rendered by this screen's own renders.
  const onStoreSearchOpened = useCallback(() => setStoreSearchOnOpen(false), []);

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
  // Sections with no live listings yet (no PG, no upcoming ride, no rental) are hidden and come back as
  // soon as one is listed (GET /api/config/sections, cached 60 s). Food & groceries, Tech & Repairs and
  // Deals always show; unknown (offline, older server) shows everything.
  const sectionsSWR = useSWRJson<{ sections?: Record<string, { live?: boolean }> }>('/api/config/sections', { freshMs: 60 * 1000 });
  const sectionLive = useCallback((key: string) => {
    const sec = sectionsSWR.data?.sections;
    // Co-Ride always shows: posting a ride is how its listings start, so hiding it while empty was a dead end.
    const k = key === 'pg' ? 'pg' : key === 'rentals' ? 'rentals' : null;
    if (!k || !sec || !sec[k]) return true;
    return sec[k].live !== false;
  }, [sectionsSWR.data]);
  const visibleTabs = useMemo(
    () => TABS.filter(t => (t.key !== 'events' || campusEventsOn) && sectionLive(t.key)),
    [campusEventsOn, sectionLive],
  );
  useEffect(() => {
    if (activeTab === 'events' && campusEventsStatus && !campusEventsStatus.enabled) setActiveTab('food');
  }, [activeTab, campusEventsStatus]);
  useEffect(() => {
    if (!sectionLive(activeTab)) setActiveTab('food');
  }, [activeTab, sectionLive]);
  const isMountedRef = useRef(true);
  // Set true in the body too: fast refresh / StrictMode re-run effects, and a ref left false would drop every later update.
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  // The Others section is the campus store basket: it reads, adds to and clears only that basket.
  const { baskets, addToCart: addAnyBasket, updateQuantity, clearBasket } = useCart();
  const cart = baskets.store;
  const addToCart: typeof addAnyBasket = (item) => addAnyBasket({ ...item, basket: 'store' });
  const clearCart = () => clearBasket('store');
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

  const [storeHours, setStoreHours] = useState<Record<string, { name: string; isOpen: boolean; opensAt: string | null }>>({});
  const fetchCatalogue = useCallback(async () => {
    setCatalogueStatus(prev => (prev === 'ready' ? prev : 'loading'));
    try {
      // One store type failing (e.g. a slow request) must not blank the whole store.
      const settled = await Promise.allSettled(SHOP_TYPES.map(async t => {
        const res = await apiFetch(`${API_URL}/api/catalogue/items?type=${encodeURIComponent(t)}&limit=200`);
        if (!res.ok) throw new Error(`catalogue ${res.status}`);
        const data = await readJson(res);
        // Store hours (isOpen / opensAt) so closed shops show "Opens 9 am" on their cards.
        const hours: Record<string, { name: string; isOpen: boolean; opensAt: string | null }> = {};
        (Array.isArray(data?.stores) ? data.stores : []).forEach((st: any) => {
          const sid = String(st?.id || st?._id || '');
          if (sid) hours[sid] = { name: String(st.name || ''), isOpen: st.isOpen !== false, opensAt: typeof st.opensAt === 'string' ? st.opensAt : null };
        });
        if (isMountedRef.current && Object.keys(hours).length) setStoreHours(prev => ({ ...prev, ...hours }));
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
      const opens = closedOpensLabel(product);
      Alert.alert(
        product.isAvailable ? `${product.storeName || 'This store'} is closed` : 'Sold out',
        product.isAvailable
          ? (opens ? `It ${opens.toLowerCase()}. You can browse now and add items once it opens.` : 'You can browse now and add items once it opens again.')
          : 'This item is out of stock right now. Please check back soon.'
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

  // ── Deals & spin: today's deals (GET /api/vault, the same list and claim as Home) and the spin page ──
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [claimingVaultId, setClaimingVaultId] = useState<string | null>(null);
  const claimingVaultRef = useRef(false);
  const [spinOpen, setSpinOpen] = useState(false);
  // Deal detail sheet: one of today's deals with real "how to avail" steps.
  const [dealDetail, setDealDetail] = useState<any | null>(null);
  // /rewards (Profile, checkout, notifications) lands on this tab; ?tab=promos&sub=spin opens the spin page.
  useEffect(() => {
    if ((tab === 'promos' || tab === 'offers') && sub === 'spin') {
      setSpinOpen(true);
      // One-shot: clear it so a later tab switch back to Deals & spin does not reopen the wheel.
      try { router.setParams({ sub: undefined } as any); } catch {}
    }
  }, [tab, sub]);
  const fetchVault = useCallback(async () => {
    try {
      const res = await apiFetch(ENDPOINTS.vaultList);
      const data = await readJson(res);
      if (res.ok && isMountedRef.current) setVaultItems(Array.isArray(data) ? data : []);
    } catch {
      // The deals row simply stays hidden when the list cannot load.
    }
  }, []);
  const claimVault = async (item: any) => {
    if (!myId) {
      Alert.alert('Sign in to claim', "Sign in to claim today's deals.", [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: () => router.push('/login' as any) },
      ]);
      return;
    }
    if (claimingVaultRef.current) return; // a double tap must not claim twice
    claimingVaultRef.current = true;
    setClaimingVaultId(item.id);
    try {
      const res = await apiFetch(ENDPOINTS.vaultClaim(item.id), { method: 'POST' });
      const data: any = await readJson(res);
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        const code = data?.code || data?.coupon?.code;
        Alert.alert('Deal claimed', code ? `Use code ${code} at checkout. It's valid until midnight.` : (data?.message || 'Added to your coupons.'));
        fetchVault();
        fetchRewards();
        refreshUser?.().catch?.(() => {});
      } else {
        Alert.alert("Couldn't claim this deal", data?.message || (res.status >= 500 ? SERVER_BUSY_MESSAGE : 'Please try again in a moment.'));
      }
    } catch {
      Alert.alert("Couldn't claim this deal", NETWORK_ERROR_MESSAGE);
    } finally {
      claimingVaultRef.current = false;
      if (isMountedRef.current) setClaimingVaultId(null);
    }
  };

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
    if (activeTab !== 'promos' || !spinOpen) return;
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
  }, [activeTab, spinOpen]);

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
      Alert.alert('Sign in to spin', 'Spins are earned with delivered orders. Sign in to see yours.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: () => router.push('/login' as any) },
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
  const catalogSheetAnim = useRef(new Animated.Value(SW)).current;
  // Category listing page: search text and sub-category chip (reset each time a listing opens).
  const [listQuery, setListQuery] = useState('');
  const [listChip, setListChip] = useState('All');

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
      catalogSheetAnim.setValue(winW);
      setListQuery('');
      setListChip('All');
      Animated.parallel([
        Animated.timing(catalogBackdropAnim, { toValue: 0.65, duration: 250, useNativeDriver: true }),
        Animated.spring(catalogSheetAnim, { toValue: 0, friction: 10, tension: 60, useNativeDriver: true }),
      ]).start();
    }
  }, [selectedCategoryName]);

  const closeCatalogSheet = () => {
    Animated.parallel([
      Animated.timing(catalogBackdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(catalogSheetAnim, { toValue: winW, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      if (isMountedRef.current) setSelectedCategoryName(null);
    });
  };

  // Android back closes the product sheet first instead of leaving the tab.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (spinOpen) {
          setSpinOpen(false);
          return true;
        }
        if (selectedCategoryName !== null) {
          closeCatalogSheet();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [selectedCategoryName, spinOpen])
  );

  // Basket bar: only the lines from this screen's stores (plus Mega Basket shopping requests).
  const catalogueStoreIds = useMemo(() => new Set(catalogue.map(i => i.restaurantId)), [catalogue]);
  const shopLines = cart.filter(i => catalogueStoreIds.has(String(i.restaurantId)) || isCustomRequest(i));
  const hasShopItems = shopLines.length > 0;
  const shopSubtotal = shopLines.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const shopCount = shopLines.reduce((sum, item) => sum + item.quantity, 0);
  const shopStoreName = shopLines.find(i => !isCustomRequest(i))?.restaurantName || 'Shopping list';

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
  // PG stays data lives in modules/pgV2 (shared session store); refresh goes through reloadPgV2List.

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
  const [serviceability, setServiceability] = useState<{ open: boolean; reopensAt?: string; closesAt?: string } | null>(null);

  // 5xx bodies can carry raw server/database errors: never show those to a student.
  const friendlyError = (res: Response | null, data: any, fallback: string): string => {
    // 502-504 survived the cold-start retry (still starting); any other 5xx is a real server error, not a wake-up.
    if (res && res.status >= 502 && res.status <= 504) return 'The server is starting up. Try again in a few seconds.';
    if (res && res.status >= 500) return 'Something went wrong on our side. Try again in a moment.';
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

  // "9 pm", "6:30 am": the short form used by the header status chip.
  const fmtShortClock = (hhmm?: string) => {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const h = parseInt(m[1], 10);
    return `${h % 12 === 0 ? 12 : h % 12}${m[2] === '00' ? '' : `:${m[2]}`} ${h < 12 ? 'am' : 'pm'}`;
  };
  /** "Opens 9 am" for an in-stock item whose store is closed right now; null when it can be ordered. */
  function closedOpensLabel(product: CatalogueItem): string | null {
    if (product.orderable || !product.isAvailable) return null;
    const st = storeHours[product.restaurantId];
    const t = st && st.opensAt ? fmtShortClock(st.opensAt) : '';
    return t ? `Opens ${t}` : 'Closed now';
  }
  // Shops that are closed right now while the campus itself is open (e.g. 8 am, shops open at 9 am).
  const closedShops = Object.values(storeHours).filter(st => !st.isOpen);
  const earliestOpen = closedShops.map(st => st.opensAt).filter(Boolean).sort()[0] || null;
  const inStock = catalogue.filter(pr => pr.isAvailable);
  const closedItemShare = inStock.length ? inStock.filter(pr => !pr.orderable).length / inStock.length : 0;
  const allShopsClosed = catalogueStatus === 'ready' && inStock.length > 0 && closedItemShare === 1;
  const someShopsClosed = catalogueStatus === 'ready' && closedItemShare >= 0.3 && closedItemShare < 1;

  const promptLogin = (title: string, message: string) => {
    Alert.alert(title, message, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Sign in', onPress: () => router.push('/login' as any) },
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
        setServiceability({ open: data.open, reopensAt: data.reopensAt, closesAt: typeof data.closesAt === 'string' ? data.closesAt : undefined });
      }
    } catch {
      // The badge simply stays hidden when we cannot tell.
    }
  }, []);

  // Load PG lists
  // silent = live-sync background refresh: keep the current list, no skeleton, no error card
  const fetchPGs = useCallback(async (opts?: { silent?: boolean }) => {
    await reloadPgV2List({ silent: !!opts?.silent });
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
    // Food & groceries (modules/foodV2) loads, caches and shows its own catalogue. This screen used to
    // download the same four store lists again in parallel (8 requests, two parses, ~10 re-renders of
    // both screens on every open) for state the food tab never shows.
    if (activeTab === 'services') { run('servicePrices', fetchServicePrices); run('catalogue', fetchCatalogue); }
    else if (activeTab === 'pg') run('pg', () => fetchPGs());
    else if (activeTab === 'coride' && myId) { run('rides', fetchRides, false); run('myRides', fetchMyRides, false); }
    else if (activeTab === 'promos') { run('rewards', fetchRewards, false); run('vault', fetchVault); }
    return Promise.all(jobs);
  }, [activeTab, myId, fetchServiceability, fetchCatalogue, fetchServicePrices, fetchPGs, fetchRides, fetchMyRides, fetchRewards, fetchVault]);

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
      if (activeTab === 'services' && catalogueChanged) { fetchServicePrices(); fetchCatalogue(); }
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
    if (!myId) { promptLogin('Sign in to join rides', 'Co-rides are only for signed-in students.'); return; }
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
    if (!myId) { promptLogin('Sign in to post a ride', 'Co-rides are only for signed-in students.'); return; }
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
    Alert.alert('Added to basket', `${sameStore.length} item${sameStore.length === 1 ? '' : 's'} from ${sameStore[0].item.storeName || 'the store'}.${notes2.length ? `\n\n${notes2.join('\n')}` : ''}`);
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
        restaurantName: 'Shopping list',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Request added', `"${name}" × ${qty} is in your basket. A shopper buys it for you, and you approve the final bill before paying.`);
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
  const cardSurface = isDark ? OTHERS_SURFACE.dark.card : colors.card;
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = isDark ? 'rgba(255, 255, 255, 0.18)' : colors.border;
  // Light mode: cards, tiles and pills get a soft lift so they separate from the page (dark: none)
  const lift = surfaceLift(isDark);
  const liftSm = surfaceLift(isDark, true);
  const cardEdge = isDark ? border : LIGHT_HAIRLINE;
  const bg = colors.bg;
  // Grid widths from the live window (16 px gutters, 12 px gaps).
  const TILE_W = Math.floor((pageW - 32 - 12) / 2);
  const GRID_CARD_W = Math.floor((pageW - 76 - 24 - 10) / 2); // Categories mode: 76 px aisle rail
  const LIST_CARD_W = Math.floor((pageW - 32 - 12) / 2);
  const BASKET_TILE_W = Math.floor((pageW - 32 - 24) / 3);
  const DEAL_CARD_W = Math.floor((pageW - 32 - 12) / 2);
  const spinWheelSize = Math.min(pageW - 64, 320);

  const accentGradient: [string, string] = isDark ? [COLORS.gold, COLORS.goldLight] : ['#EF4F5F', '#D43F4F'];
  // Solid accent (pills, buttons) and the accent used for small text (a step darker in light for contrast).
  const accent = isDark ? COLORS.gold : COLORS.red;
  const onAccent = isDark ? '#0A0A0B' : '#FFFFFF';
  const accentInk = isDark ? COLORS.gold : COLORS.redDark;
  // Soft card surfaces: light = white with the layered shadow, dark = raised grey with a hairline.
  const fieldSurface = isDark
    ? { backgroundColor: OTHERS_SURFACE.dark.card, borderColor: 'rgba(255,255,255,0.08)' }
    : [{ backgroundColor: '#FFFFFF', borderColor: 'transparent' }, LIGHT_SURFACE_SM];
  const iconBtnSurface = fieldSurface;
  // Food & groceries accent: fresh green on white cards (owner's choice, 22 Oct).
  // Section accents come from the Others tokens (modules/others/othersTheme.ts).
  const fg = {
    solid: OTHERS_ACCENTS.food.solid,
    ink: isDark ? OTHERS_ACCENTS.food.ink.dark : OTHERS_ACCENTS.food.ink.light,
    tint: isDark ? OTHERS_ACCENTS.food.tint.dark : OTHERS_ACCENTS.food.tint.light,
    heroBg: isDark ? '#14241A' : '#EAF5EC',
    plate: isDark ? '#232327' : '#F4F5F7',
  };
  // Deals & spin accent: purple / indigo (owner's choice, 22 Oct).
  const dp = {
    solid: isDark ? '#7C5CFF' : OTHERS_ACCENTS.deals.solid,
    ink: isDark ? OTHERS_ACCENTS.deals.ink.dark : OTHERS_ACCENTS.deals.ink.light,
    tint: isDark ? OTHERS_ACCENTS.deals.tint.dark : OTHERS_ACCENTS.deals.tint.light,
    heroA: isDark ? '#3B2A99' : '#6D4AFF',
    heroB: isDark ? '#24185F' : OTHERS_ACCENTS.deals.deep,
  };
  const greenShadow = Platform.select<any>({
    web: { boxShadow: '0px 2px 8px rgba(30,142,62,0.28)' },
    default: { shadowColor: '#1E8E3E', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  });
  const activePillShadow = Platform.select<any>({
    web: { boxShadow: isDark ? '0px 2px 10px rgba(212,175,122,0.22)' : '0px 2px 8px rgba(239,79,95,0.28)' },
    default: { shadowColor: accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: isDark ? 0.2 : 0.26, shadowRadius: 8, elevation: 3 },
  });

  /** Section pills (size md, 40 high) and category chips (size sm, 36 high) share one look. */
  const renderPill = ({ key, label, icon, active, onPress, size = 'md', sound = 'click', green = false, tone }: {
    key: string; label: string; icon?: IonName; active: boolean; onPress: () => void; size?: 'md' | 'sm'; sound?: 'click' | 'tabSwitch';
    /** Food & groceries: green accent (owner's section colour). */
    green?: boolean;
    /** Section colour for the active state (Deals & spin: purple). */
    tone?: string;
  }) => {
    const sm = size === 'sm';
    const on = tone || (green ? fg.solid : accent);
    const onText = tone || green ? '#FFFFFF' : onAccent;
    const toneShadow = tone ? Platform.select<any>({
      web: { boxShadow: `0px 2px 8px ${tone}55` },
      default: { shadowColor: tone, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
    }) : null;
    return (
      <DopaminePressable
        key={key}
        onPress={onPress}
        sound={sound}
        activeScale={0.95}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        style={[
          s.pill,
          sm && s.pillSm,
          active ? [{ backgroundColor: on, borderColor: on }, tone ? toneShadow : green ? greenShadow : activePillShadow] : fieldSurface,
        ]}
      >
        {!!icon && <Ionicons name={icon} size={sm ? 15 : 16} color={active ? onText : txtSec} />}
        <Text style={[s.pillLabel, sm && s.pillLabelSm, { color: active ? onText : txt, fontWeight: active ? '600' : '500' }]} numberOfLines={1}>{label}</Text>
      </DopaminePressable>
    );
  };

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

  // Zenvy Auto promos only while the feature is on.
  const currentTabPromos = (TAB_PROMOS[activeTab] || PROMOS_FOOD).filter(p => p.id !== 'c4' || autoRideOn);
  const carouselOffers = currentTabPromos.map(p => ({
    id: p.id,
    imageUrl: p.img,
    tagline: p.tagline,
    title1: p.title,
    title2: p.subtitle,
    description: p.desc,
    buttonText: p.btn,
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
  const CATEGORY_PILLS: { label: string; icon: IonName; shelf: string }[] = [
    { label: 'All', icon: 'apps-outline', shelf: 'All Groceries' },
    { label: 'Fresh', icon: 'nutrition-outline', shelf: 'Fresh' },
    { label: 'Grocery', icon: 'cart-outline', shelf: 'Grocery' },
    { label: 'Electronics', icon: 'flash-outline', shelf: 'Electronics' },
    { label: 'Organic', icon: 'leaf-outline', shelf: 'Organic' },
    { label: 'Health', icon: 'fitness-outline', shelf: 'Health' },
    { label: 'Deals', icon: 'pricetag-outline', shelf: 'Deals' },
  ];
  const oilShelf = useMemo(() => shelfItems('Edible Oils & Ghee', catalogue), [catalogue]);
  const toyTiles = useMemo(() => TOY_MANIA_CATEGORIES.map(t => {
    const items = shelfItems(t.title, catalogue);
    const maxOff = items.reduce((m, i) => Math.max(m, i.discountPercent || 0), 0);
    const minPrice = items.length ? Math.min(...items.map(i => i.price)) : 0;
    return { ...t, count: items.length, badge: maxOff >= 10 ? `Up to ${maxOff}% off` : `From ${fmtPrice(minPrice)}` };
  }).filter(t => t.count > 0), [catalogue]);
  const groceryGrid = useMemo(() => GROCERY_CATEGORIES
    .map(section => ({ ...section, items: section.items.filter(i => shelfItems(i.name, catalogue).length > 0) }))
    .filter(section => section.items.length > 0), [catalogue]);
  const electronicsFrom = useMemo(() => {
    const prices = shelfItems('Electronics', catalogue).map(i => i.price).filter(p => p > 0);
    return prices.length ? Math.min(...prices) : 0;
  }, [catalogue]);

  const sheetProducts = selectedCategoryName === SEARCH_SHELF ? catalogue : selectedCategoryName ? shelfItems(selectedCategoryName, catalogue) : [];
  // Sub-category chips from the products' own categories (most stocked first), only when there are 2+.
  const listChips = useMemo(() => {
    const counts = new Map<string, number>();
    sheetProducts.forEach(p => { if (p.category) counts.set(p.category, (counts.get(p.category) || 0) + 1); });
    const keys = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 8);
    return keys.length > 1 ? keys : [];
  }, [selectedCategoryName, catalogue]);
  const listQ = listQuery.trim().toLowerCase();
  const listProducts = sheetProducts.filter(p =>
    (listChip === 'All' || p.category === listChip)
    && (!listQ || p.name.toLowerCase().includes(listQ) || (p.brand || '').toLowerCase().includes(listQ) || (p.category || '').toLowerCase().includes(listQ)));
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

  /** Section title (sentence case, title weight) with an optional subtitle and "See all". */
  const renderSectionHeader = (title: string, subtitle?: string | null, onSeeAll?: (() => void) | null) => (
    <View style={s.secHead}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.secTitle, { color: txt }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {!!subtitle && <Text style={[s.secSub, { color: txtSec }]} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {!!onSeeAll && (
        <PressScale style={s.textBtn} onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`See all: ${title}`}>
          <Text style={[s.textBtnText, { color: fg.ink }]}>See all</Text>
          <Ionicons name="chevron-forward" size={15} color={fg.ink} />
        </PressScale>
      )}
    </View>
  );

  // Designed state card in the section's accent; it tells offline / waking-up / error apart itself.
  const renderLoadError = (message: string, onRetry: () => void) => (
    <StateCard
      kind="error"
      section={activeTab === 'promos' ? 'deals' : 'food'}
      title="Could not load this"
      message={message}
      actionLabel="Try again"
      onAction={onRetry}
      style={{ marginHorizontal: 16, marginTop: 12 }}
    />
  );

  const SERVICE_CARD_ICON: Record<string, IonName> = {
    repairs: 'laptop-outline', tailoring: 'cut-outline', print: 'print-outline', laundry: 'shirt-outline',
    mattresses: 'bed-outline', electronics: 'hardware-chip-outline',
  };
  const SERVICE_CARDS = [
    { id: 'LAPTOP_REPAIR', title: 'Laptop and phone repairs', tag: 'Book a slot', desc: 'Screen replacement, thermal paste, fan cleaning, SSD upgrades and hardware fixes.', icon: '💻', cat: 'repairs', priceKey: 'repairs', image: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&q=80' },
    { id: 'TAILORING', title: 'Tailoring and stitching', tag: 'Alterations', desc: 'Length shortening, shirt and kurti alterations, lab coat resizing and zip replacement.', icon: '✂️', cat: 'tailoring', priceKey: 'tailoring', image: 'https://images.unsplash.com/photo-1630930678172-63343537a00a?w=600&q=80' },
    { id: 'PRINTOUT', title: 'Printouts and binding', tag: 'Print jobs', desc: 'B&W and colour printouts, project reports, spiral and hard binding.', icon: '📄', cat: 'print', priceKey: 'print', image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=600&q=80' },
    { id: 'LAUNDRY', title: 'Wash, dry clean and ironing', tag: 'Pickup and drop', desc: 'Daily clothes, bedsheets, blankets and shoe cleaning from your hostel.', icon: '👕', cat: 'laundry', priceKey: 'laundry', image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=600&q=80' },
    { id: 'MATTRESSES', title: 'Mattresses and room gear', tag: 'Move-in essentials', desc: 'Foam mattresses, pillows, bedsheets, buckets and drying racks.', icon: '📦', cat: 'mattresses', priceKey: 'home', image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=600&q=80' },
    { id: 'ELECTRONICS', title: 'Chargers and gadgets', tag: 'Tech essentials', desc: 'Laptop adapters, extension boards, calculators and study lamps.', icon: '🔋', cat: 'electronics', priceKey: 'electronics', image: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&q=80' },
  ];

  const wheelDisplayPrizes = spinPrizes.length ? spinPrizes : WHEEL_PRIZE_MIRROR;
  const wheelSectors = spinPrizes.map((p, i) => ({ label: p.label, ...WHEEL_STYLES[i % WHEEL_STYLES.length] }));
  const sectorDeg = 360 / Math.max(1, wheelSectors.length || WHEEL_STYLES.length);
  const zenPoints = Number(user?.zenPoints) || 0;

  // Food & groceries v2 (modules/foodV2): its own green header, section pills, listings, product
  // links and basket bar. Real catalogue, CartContext rules, Mega Basket and saved items live there.
  if (activeTab === 'food') {
    return (
      <View style={{ flex: 1, backgroundColor: isDark ? '#09090B' : '#FFFFFF' }}>
        <FoodV2Screen forceDark={isDark} sections={visibleTabs} onSection={selectTab} openSearch={storeSearchOnOpen} onSearchOpened={onStoreSearchOpened} />
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: 0, backgroundColor: bg }]}>
      <AmbientBackground />
      {/* ── HEADER: the same header as Food & groceries (modules/foodV2/FoodV2SectionHeader); only the accent changes ── */}
      <SectionHeader
        topPad={topPad}
        pageW={Math.min(SW, 600)}
        compact={SW < 360}
        colors={SECTION_HEADER[activeTab] || SECTION_HEADER.neutral}
        subtitle={SECTION_SUBTITLE[activeTab] || 'Campus services'}
        hints={activeTab === 'services' ? SERVICE_SEARCH_HINTS : activeTab === 'pg' ? PG_SEARCH_HINTS : activeTab === 'coride' ? CORIDE_SEARCH_HINTS : activeTab === 'events' ? EVENTS_SEARCH_HINTS : STORE_SEARCH_HINTS}
        searchLabel={activeTab === 'services' ? 'Search repairs' : activeTab === 'pg' ? 'Search PGs by area or name' : activeTab === 'coride' ? 'Search lifts by destination' : activeTab === 'events' ? 'Search events and venues' : 'Search the campus store'}
        onSearch={() => {
          if (activeTab === 'services') { router.push('/category/repairs' as any); return; }
          // PG stays: the header search is the one PG search; it opens PG Buildings focused.
          if (activeTab === 'pg') { router.push('/pg/list?focus=1' as any); return; }
          if (activeTab === 'coride' || activeTab === 'events') {
            scrollViewRef.current?.scrollTo({ y: 0, animated: true });
            setSectionSearchTick((n) => n + 1);
            return;
          }
          // The grocery search sheet only exists in Food & groceries: go there, already searching.
          setStoreSearchOnOpen(true);
          selectTab('food');
        }}
        pills={visibleTabs.map(t => [t.key, t.label] as [string, string])}
        active={activeTab}
        onPill={selectTab}
        onBack={() => router.replace('/(tabs)')}
        actions={[
          { icon: 'heart-outline', label: 'Saved items', onPress: () => setFavoritesModalVisible(true) },
          { icon: 'notifications-outline', label: unreadDot ? 'Notifications, unread' : 'Notifications', onPress: () => router.push('/notifications' as any), dot: unreadDot },
        ]}
      />

      <Animated.View style={{ opacity: tabContentFade, transform: [{ translateY: tabContentTranslateY }], flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled={true}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} colors={[COLORS.red]} />}
        >
          {/* ── HERO CAROUSEL CARD ── */}
          {activeTab !== 'food' && activeTab !== 'promos' && activeTab !== 'events' && activeTab !== 'pg' && activeTab !== 'coride' && (
            <View style={[s.heroCarouselCard, isDark ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' } : LIGHT_SURFACE]}>
              <PromoCarousel offers={carouselOffers} containerStyle={s.heroCarousel} accent={PILL_ACCENT[activeTab] ? OTHERS_ACCENTS[PILL_ACCENT[activeTab]!].solid : undefined} />
            </View>
          )}

        {/* ── TECH & REPAIRS & SERVICES TAB ── */}
        {activeTab === 'services' && (
          <View style={{ paddingHorizontal: 16 }}>
            <View style={{ marginBottom: 14, marginTop: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: isDark ? OTHERS_ACCENTS.services.ink.dark : OTHERS_ACCENTS.services.ink.light }}>Campus services</Text>
              <Text style={{ ...OTHERS_TYPE.heading, color: txt, marginTop: 2 }}>Book it from your hostel</Text>
            </View>

            {SERVICE_CARDS.map(srv => {
              const from = srv.priceKey === 'electronics' ? electronicsFrom : (serviceFromPrice[srv.priceKey] || 0);
              return (
                <ScalePressable
                  key={srv.id}
                  style={[{ borderRadius: 16, backgroundColor: cardSurface, marginBottom: 12, overflow: 'hidden' }, othersShadow(isDark)]}
                  onPress={() => router.push(`/category/${srv.cat}` as any)}
                >
                  <View style={{ flexDirection: 'row', padding: 14, gap: 14 }}>
                    <View style={{ width: 90, height: 90, borderRadius: 16, overflow: 'hidden' }}>
                      <Image source={{ uri: srv.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityElementsHidden />
                    </View>

                    <View style={{ flex: 1, justifyContent: 'space-between' }}>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                          <View style={{ backgroundColor: isDark ? OTHERS_ACCENTS.services.tint.dark : OTHERS_ACCENTS.services.tint.light, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: isDark ? OTHERS_ACCENTS.services.ink.dark : OTHERS_ACCENTS.services.ink.light }}>{srv.tag}</Text>
                          </View>
                          {from > 0 && <Text style={{ fontSize: 13, fontWeight: '800', color: txt, flexShrink: 1, marginLeft: 8, textAlign: 'right' }} numberOfLines={1}>{srv.cat === 'repairs' ? `${fmtPrice(from)} inspection` : `From ${fmtPrice(from)}`}</Text>}
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: txt, lineHeight: 18, letterSpacing: -0.2 }}>{srv.title}</Text>
                        <Text style={{ fontSize: 12, color: txtSec, lineHeight: 16, marginTop: 5 }} numberOfLines={2} ellipsizeMode="tail">{srv.desc}</Text>
                        {/* The ₹99 is the doorstep inspection (catalogue item); the partner's quote replaces it and nothing is charged for a declined quote. */}
                        {srv.cat === 'repairs' && from > 0 && <Text style={{ fontSize: 12, color: txtSec, lineHeight: 16, marginTop: 4, fontWeight: '600' }} numberOfLines={1}>You approve the quote before any work</Text>}
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 10 }}>
                        <LinearGradient colors={[OTHERS_ACCENTS.services.deep, OTHERS_ACCENTS.services.solid]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>{['repairs', 'tailoring', 'print', 'laundry'].includes(srv.cat) ? 'Book now' : 'Shop now'}</Text>
                          <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
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
        {activeTab === 'events' && campusEventsOn && <CampusEventsSection focusSearchTick={sectionSearchTick} />}

        {/* ── PG STAYS TAB (modules/pgV2): hero, filters, My bookings and buildings near campus ── */}
        {activeTab === 'pg' && <PgV2OthersSection />}

        {/* ── CO-RIDE TAB ── modules/coride/CoRideHub: rides home, student bike and car pool, and Zenvy Auto */}
        {activeTab === 'coride' && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
            <CoRideHub
              myId={myId}
              karma={Number(user?.karmaPoints) || 0}
              autoRideOn={autoRideOn}
              autoSection={<AutoRideSection />}
              corideTab={corideTab}
              setCorideTab={setCorideTab}
              rides={rides}
              loadingRides={loadingRides}
              rideError={rideError}
              onRetryRides={fetchRides}
              myRides={myRides}
              myRideGroups={myRideGroups}
              loadingMyRides={loadingMyRides}
              myRidesError={myRidesError}
              onRetryMyRides={fetchMyRides}
              myJoinStatus={myJoinStatus}
              rideActionBusy={rideActionBusy}
              vehicleFilter={vehicleFilter}
              setVehicleFilter={setVehicleFilter}
              goingTo={goingTo}
              setGoingTo={setGoingTo}
              onJoin={handleJoinRide}
              onApprove={handleApproveRequest}
              onDecline={handleRejectRequest}
              onComplete={handleCompleteRide}
              onCancel={handleCancelRide}
              onWhatsApp={contactOnWhatsApp}
              onSafety={handleSOS}
              onPost={(role) => { setCreatorRole(role); openCreateRide(); }}
              onSignIn={() => router.push('/login' as any)}
              focusSearchTick={sectionSearchTick}
            />
          </View>
        )}

        {/* ── DEALS & SPINS TAB ── */}
        {activeTab === 'promos' && (
          <View>
            {/* ── HERO: Deals & spin ── */}
            <LinearGradient colors={[dp.heroA, dp.heroB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.dlHero}>
              <View style={s.dlHeroText}>
                <Text style={s.dlHeroTitle} accessibilityRole="header">Deals & spin</Text>
                <Text style={s.dlHeroTag}>Spin. Win. Save.</Text>
                <Text style={s.dlHeroSub}>Every 2 delivered orders earn a spin. Win ZenPoints or a free-delivery coupon.</Text>
                <PressScale style={s.dlHeroBtn} onPress={() => setSpinOpen(true)} accessibilityRole="button" accessibilityLabel="Spin now">
                  <Ionicons name="sync-circle-outline" size={16} color={dp.heroB} />
                  <Text style={[s.dlHeroBtnText, { color: dp.heroB }]}>{!myId || spinsLeft > 0 ? 'Spin now' : 'See the wheel'}</Text>
                </PressScale>
              </View>
              <View style={s.dlHeroWheel}>
                <SpinWheelSvg sectors={wheelDisplayPrizes} size={112} showLabels={false} />
                <View style={s.dlHeroHub} />
                {!!myId && spinsLeft > 0 && (
                  <View style={s.dlHeroBadge}>
                    <Text style={[s.dlHeroBadgeText, { color: dp.heroB }]}>{spinsLeft} spin{spinsLeft === 1 ? '' : 's'}</Text>
                  </View>
                )}
              </View>
            </LinearGradient>

            {/* ── BALANCES: ZenPoints and wallet (signed in) ── */}
            {!!myId ? (
              <View style={s.dlStatRow}>
                <View style={[s.dlStat, { backgroundColor: cardSurface, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent' }, lift]}>
                  <View style={[s.dlStatIcon, { backgroundColor: dp.tint }]}>
                    <Ionicons name="diamond-outline" size={18} color={dp.ink} />
                  </View>
                  <Text style={[s.dlStatLabel, { color: txtSec }]}>ZenPoints</Text>
                  <Text style={[s.dlStatValue, { color: txt }]}>{zenPoints.toLocaleString('en-IN')}</Text>
                </View>
                <PressScale
                  style={[s.dlStat, { backgroundColor: cardSurface, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent' }, lift]}
                  onPress={() => router.push('/wallet-history' as any)}
                  accessibilityRole="button"
                  accessibilityLabel="Wallet balance and history"
                >
                  <View style={[s.dlStatIcon, { backgroundColor: dp.tint }]}>
                    <Ionicons name="wallet-outline" size={18} color={dp.ink} />
                  </View>
                  <Text style={[s.dlStatLabel, { color: txtSec }]}>Wallet</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[s.dlStatValue, { color: txt }]}>{fmtPrice(Number((user as any)?.walletBalance) || 0)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={txtSec} />
                  </View>
                </PressScale>
              </View>
            ) : (
              <View style={[s.dlSignIn, { backgroundColor: cardSurface, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent' }, lift]}>
                <View style={[s.dlStatIcon, { backgroundColor: dp.tint }]}>
                  <Ionicons name="person-outline" size={18} color={dp.ink} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.dlCardTitle, { color: txt }]}>Sign in for your rewards</Text>
                  <Text style={[s.dlCardSub, { color: txtSec }]}>See your spins, ZenPoints, coupons and wallet.</Text>
                </View>
                <PressScale style={[s.dlSmallBtn, { backgroundColor: dp.solid }]} onPress={() => router.push('/login' as any)} accessibilityRole="button">
                  <Text style={s.dlSmallBtnText}>Sign in</Text>
                </PressScale>
              </View>
            )}

            {/* ── TODAY'S DEALS (GET /api/vault; claiming gives a real coupon) ── */}
            {vaultItems.length > 0 && (
              <View style={s.secBlock}>
                <View style={s.secHead}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.secTitle, { color: txt }]} accessibilityRole="header">Today's deals</Text>
                    <Text style={[s.secSub, { color: txtSec }]} numberOfLines={1}>
                      {myId ? `Your order streak: ${Number((user as any)?.streakCount) || 0} day${(Number((user as any)?.streakCount) || 0) === 1 ? '' : 's'} · use codes before midnight` : 'Claim one and use the code before midnight'}
                    </Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent}>
                  {vaultItems.map((item: any, di: number) => {
                    const tag = vaultDealTag(item);
                    const streak = Number(item.streakRequirement) || 0;
                    const left = Number(item.remainingCount) || 0;
                    const busy = claimingVaultId === item.id;
                    return (
                      <FadeInUp key={item.id} index={di}><View style={[s.dlDeal, { width: DEAL_CARD_W, backgroundColor: cardSurface, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent' }, liftSm]}>
                        <PressScale onPress={() => setDealDetail(item)} accessibilityRole="button" accessibilityLabel={`${item.name}: how to avail`}>
                        <View style={[s.dlDealImg, { backgroundColor: isDark ? '#232327' : '#EEF0F3' }]}>
                          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
                            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: dp.tint }]}>
                              <Ionicons name={tag === 'Free delivery' ? 'bicycle-outline' : 'pricetag-outline'} size={30} color={dp.ink} />
                            </View>
                          )}
                          {!!tag && (
                            <View style={[s.dlTag, { backgroundColor: dp.solid }]}>
                              <Text style={s.dlTagText}>{tag}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[s.dlDealName, { color: txt }]} numberOfLines={2}>{item.name}</Text>
                        </PressScale>
                        <View style={s.dlDealMeta}>
                          <Ionicons name={streak > 0 ? 'flame-outline' : 'time-outline'} size={13} color={txtSec} />
                          <Text style={[s.dlDealMetaText, { color: txtSec }]} numberOfLines={1}>
                            {streak > 0 ? `${streak}-day streak needed` : `${left} left today`}
                          </Text>
                        </View>
                        {(() => {
                          // Streak deals: show what is still needed instead of a Claim button the server will refuse.
                          const myStreak = Number((user as any)?.streakCount) || 0;
                          const need = !!myId && streak > myStreak ? streak - myStreak : 0;
                          return need > 0 ? (
                            <PressScale
                              style={[s.dlDealBtn, { backgroundColor: dp.tint, flexDirection: 'row', gap: 6 }]}
                              onPress={() => Alert.alert('Keep your order streak', `Order on ${need} more day${need === 1 ? '' : 's'} in a row to unlock ${item.name}.`)}
                              accessibilityRole="button"
                              accessibilityLabel={`${item.name} is locked. ${need} more day${need === 1 ? '' : 's'} of orders needed`}
                            >
                              <Ionicons name="lock-closed-outline" size={14} color={dp.ink} />
                              <Text style={[s.dlSmallBtnText, { color: dp.ink }]}>{need} more day{need === 1 ? '' : 's'}</Text>
                            </PressScale>
                          ) : (
                            <PressScale
                              style={[s.dlDealBtn, { backgroundColor: dp.solid, opacity: busy ? 0.7 : 1 }]}
                              onPress={() => claimVault(item)}
                              disabled={busy}
                              accessibilityRole="button"
                              accessibilityLabel={`Claim ${item.name}`}
                            >
                              {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={s.dlSmallBtnText}>Claim deal</Text>}
                            </PressScale>
                          );
                        })()}
                      </View></FadeInUp>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* ── SPIN & WIN STRIP ── */}
            <PressScale
              style={[s.dlStrip, { backgroundColor: dp.tint }]}
              onPress={() => setSpinOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Open the spin wheel"
            >
              <View style={s.dlStripWheel}>
                <SpinWheelSvg sectors={wheelDisplayPrizes} size={48} showLabels={false} ring={false} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.dlCardTitle, { color: txt }]}>Spin & win</Text>
                <Text style={[s.dlCardSub, { color: txtSec }]} numberOfLines={2}>
                  {!myId
                    ? 'Sign in to see your spins'
                    : spinsLeft > 0
                      ? `You have ${spinsLeft} spin${spinsLeft === 1 ? '' : 's'} ready`
                      : spinNextIn
                        ? `${spinNextIn} more delivered order${spinNextIn === 1 ? '' : 's'} to your next spin`
                        : 'Every 2 delivered orders earn a spin'}
                </Text>
              </View>
              <View style={[s.dlSmallBtn, { backgroundColor: dp.solid }]}>
                <Text style={s.dlSmallBtnText}>{!myId || spinsLeft > 0 ? 'Play now' : 'View wheel'}</Text>
              </View>
            </PressScale>

            {/* ── YOUR COUPONS (real, usable ones only) ── */}
            {!!myId && (
              <View style={s.secBlock}>
                {renderSectionHeader('Your coupons', coupons.length ? `${coupons.length} ready to use at checkout` : null)}
                <View style={{ paddingHorizontal: 16, gap: 12 }}>
                  {rewardsStatus === 'loading' && coupons.length === 0 ? (
                    [0, 1].map(i => <ShimmerLoader key={i} width={pageW - 32} height={76} borderRadius={16} />)
                  ) : rewardsStatus === 'error' && coupons.length === 0 ? (
                    renderLoadError('Your coupons did not load.', () => { fetchRewards(); fetchVault(); })
                  ) : coupons.length === 0 ? (
                    <View style={[s.dlEmpty, { backgroundColor: cardSurface, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent' }, liftSm]}>
                      <Ionicons name="ticket-outline" size={22} color={dp.ink} />
                      <Text style={[s.dlCardSub, { color: txtSec, flex: 1 }]}>No coupons yet. Spin the wheel or claim a daily deal and they show up here.</Text>
                    </View>
                  ) : (
                    coupons.map((coupon: any, index: number) => {
                      const code = String(coupon.code || '');
                      const days = Number(coupon.expiresInDays);
                      const expiry = Number.isFinite(days) && coupon.expiresInDays !== null
                        ? (days <= 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`)
                        : 'No expiry';
                      const copied = copiedCode === code;
                      return (
                        <FadeInUp key={code || index} index={index}><View style={[s.dlCoupon, { backgroundColor: cardSurface, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent' }, liftSm]}>
                          <View style={[s.dlCouponIcon, { backgroundColor: dp.tint }]}>
                            <Ionicons name={coupon.type === 'FREEDEL' ? 'bicycle-outline' : 'pricetag-outline'} size={20} color={dp.ink} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[s.dlCardTitle, { color: txt }]} numberOfLines={1}>{coupon.label || 'Coupon'}</Text>
                            <Text style={[s.dlCardSub, { color: txtSec }]} numberOfLines={1}>{code} · {expiry}</Text>
                          </View>
                          <PressScale
                            style={[s.dlOutlineBtn, { borderColor: copied ? (isDark ? '#34D399' : '#047857') : dp.solid }]}
                            onPress={() => { handleCopyCode(code); Haptics.selectionAsync().catch(() => {}); }}
                            accessibilityRole="button"
                            accessibilityLabel={`Copy code ${code}`}
                          >
                            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={copied ? (isDark ? '#34D399' : '#047857') : dp.ink} />
                            <Text style={[s.dlOutlineBtnText, { color: copied ? (isDark ? '#34D399' : '#047857') : dp.ink }]}>{copied ? 'Copied' : 'Copy'}</Text>
                          </PressScale>
                        </View></FadeInUp>
                      );
                    })
                  )}
                </View>
              </View>
            )}

            {/* ── REFER & EARN (real referral code; both get 50 ZenPoints) ── */}
            {!!myId && !!(user as any)?.referralCode && (
              <View style={[s.dlRefer, { backgroundColor: cardSurface, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent' }, lift]}>
                <View style={s.dlReferTop}>
                  <View style={[s.dlCouponIcon, { backgroundColor: dp.tint }]}>
                    <Ionicons name="gift-outline" size={20} color={dp.ink} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.dlCardTitle, { color: txt }]}>Invite friends, earn ZenPoints</Text>
                    <Text style={[s.dlCardSub, { color: txtSec }]}>When a friend signs up with your code, you both get 50 ZenPoints.</Text>
                  </View>
                </View>
                <View style={s.dlReferRow}>
                  <PressScale
                    style={[s.dlCodeBox, { borderColor: dp.solid, backgroundColor: dp.tint }]}
                    onPress={() => { handleCopyCode(String((user as any).referralCode)); Haptics.selectionAsync().catch(() => {}); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy referral code ${(user as any).referralCode}`}
                  >
                    <Text style={[s.dlCodeLabel, { color: txtSec }]}>Your code</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[s.dlCodeText, { color: txt }]}>{(user as any).referralCode}</Text>
                      <Ionicons name={copiedCode === String((user as any).referralCode) ? 'checkmark' : 'copy-outline'} size={14} color={dp.ink} />
                    </View>
                  </PressScale>
                  <PressScale
                    style={[s.dlShareBtn, { backgroundColor: dp.solid }]}
                    onPress={async () => {
                      const name = (user as any)?.name?.split(' ')[0] || 'Your friend';
                      try {
                        await Share.share({ message: `${name} invited you: campus food and essentials delivered to your hostel. Sign up with code ${(user as any).referralCode} and you both get 50 ZenPoints.` });
                      } catch {}
                    }}
                    accessibilityRole="button"
                  >
                    <Ionicons name="share-social-outline" size={16} color="#FFFFFF" />
                    <Text style={s.dlSmallBtnText}>Share</Text>
                  </PressScale>
                </View>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>
      </Animated.View>

      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} searchMode={activeTab === 'food' ? 'grocery' : 'food'} />

      {/* ── DEAL DETAIL (real steps: claim, copy the code, apply it at checkout before midnight) ── */}
      <Modal visible={!!dealDetail} transparent animationType="slide" onRequestClose={() => setDealDetail(null)}>
        <View style={s.ddBackdrop}>
          <PressScale style={StyleSheet.absoluteFill} onPress={() => setDealDetail(null)} accessibilityLabel="Close" />
          {!!dealDetail && (() => {
            const tag = vaultDealTag(dealDetail);
            const streak = Number(dealDetail.streakRequirement) || 0;
            const left = Number(dealDetail.remainingCount) || 0;
            const busy = claimingVaultId === dealDetail.id;
            const need = !!myId && streak > (Number((user as any)?.streakCount) || 0) ? streak - (Number((user as any)?.streakCount) || 0) : 0;
            const steps = [
              streak > 0 ? `Keep a ${streak}-day order streak (order on consecutive days).` : null,
              'Tap "Claim deal". You get your own coupon code.',
              // The server refuses the code below the deal's minimum order, so say it before checkout does.
              vaultMinOrder(dealDetail) > 0
                ? `Apply the code at checkout on an order of ${fmtPrice(vaultMinOrder(dealDetail))} or more. It works until midnight today.`
                : 'Apply the code at checkout. It works until midnight today.',
            ].filter(Boolean) as string[];
            return (
              <View style={[s.ddSheet, { backgroundColor: cardSurface }]}>
                <View>
                  {dealDetail.imageUrl ? <Image source={{ uri: dealDetail.imageUrl }} style={s.ddImg} resizeMode="cover" /> : <View style={[s.ddImg, { backgroundColor: dp.tint }]} />}
                  {!!tag && <View style={[s.dlTag, { backgroundColor: dp.solid, top: 12, left: 12 }]}><Text style={s.dlTagText}>{tag}</Text></View>}
                  <PressScale style={s.ddClose} onPress={() => setDealDetail(null)} accessibilityRole="button" accessibilityLabel="Close">
                    <Ionicons name="close" size={20} color="#0F172A" />
                  </PressScale>
                </View>
                <View style={s.ddBody}>
                  <Text style={[s.ddTitle, { color: txt }]}>{dealDetail.name}</Text>
                  <View style={s.ddMetaRow}>
                    <View style={[s.ddMeta, { backgroundColor: dp.tint }]}>
                      <Ionicons name="time-outline" size={14} color={dp.ink} />
                      <Text style={[s.ddMetaText, { color: txt }]}>Valid till midnight</Text>
                    </View>
                    <View style={[s.ddMeta, { backgroundColor: dp.tint }]}>
                      <Ionicons name="pricetags-outline" size={14} color={dp.ink} />
                      <Text style={[s.ddMetaText, { color: txt }]}>{left} left today</Text>
                    </View>
                  </View>
                  <Text style={[s.ddHow, { color: txt }]}>How to avail</Text>
                  {steps.map((t, i) => (
                    <View key={i} style={s.ddStep}>
                      <View style={[s.ddStepNum, { backgroundColor: dp.tint }]}>
                        <Text style={[s.ddStepNumText, { color: dp.ink }]}>{i + 1}</Text>
                      </View>
                      <Text style={[s.ddStepText, { color: txt }]}>{t}</Text>
                    </View>
                  ))}
                </View>
                {need > 0 ? (
                  <View style={[s.ddCta, { backgroundColor: dp.tint, flexDirection: 'row', gap: 8 }]} accessible accessibilityLabel={`Locked. ${need} more day${need === 1 ? '' : 's'} of orders needed`}>
                    <Ionicons name="lock-closed-outline" size={16} color={dp.ink} />
                    <Text style={[s.wonPrimaryText, { color: dp.ink }]}>Unlocks after {need} more day{need === 1 ? '' : 's'} of orders</Text>
                  </View>
                ) : (
                <PressScale
                  style={[s.ddCta, { backgroundColor: dp.solid, opacity: busy ? 0.7 : 1 }]}
                  onPress={() => claimVault(dealDetail)}
                  disabled={busy}
                  accessibilityRole="button"
                >
                  {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.wonPrimaryText}>Claim deal</Text>}
                </PressScale>
                )}
              </View>
            );
          })()}
        </View>
      </Modal>

      {/* ── SPIN PAGE (Deals & spin; the server picks the prize, the wheel animates to it) ── */}
      {spinOpen && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 110 }]}>
          <LinearGradient colors={['#2E1F86', '#1C1257']} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={[StyleSheet.absoluteFill, { paddingTop: topPad }]}>
            <View style={s.spHead}>
              <PressScale style={s.spBack} onPress={() => setSpinOpen(false)} accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              </PressScale>
              <Text style={s.spHeadTitle} accessibilityRole="header">Spin & win</Text>
            </View>

            <ScrollView contentContainerStyle={s.spBody} showsVerticalScrollIndicator={false}>
              {!!myId && (
                <View style={s.spChip}>
                  <Ionicons name="gift-outline" size={14} color="#FFFFFF" />
                  <Text style={s.spChipText}>{spinsLeft} spin{spinsLeft === 1 ? '' : 's'} left</Text>
                </View>
              )}
              <Text style={s.spTitle}>Spin the wheel</Text>
              <Text style={s.spSub}>Win ZenPoints or a free-delivery coupon</Text>

              <View style={[s.spWheelWrap, { width: spinWheelSize + 24, height: spinWheelSize + 24 }]}>
                <View style={[s.spGlow, { width: spinWheelSize + 24, height: spinWheelSize + 24, borderRadius: (spinWheelSize + 24) / 2 }]} />
                <Animated.View style={{ width: spinWheelSize, height: spinWheelSize, transform: [{ rotate: spinAnim.interpolate({ inputRange: [0, 360000], outputRange: ['0deg', '360000deg'] }) }] }}>
                  <SpinWheelSvg sectors={wheelDisplayPrizes} size={spinWheelSize} />
                </Animated.View>
                <View style={s.spPointer} pointerEvents="none">
                  <Ionicons name="caret-down" size={34} color="#F6C453" />
                </View>
                {wheelSectors.length === 0 && rewardsStatus === 'loading' && (
                  <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#FFFFFF" /></View>
                  </View>
                )}
                <Animated.View style={[s.spHubWrap, { transform: [{ scale: spinsLeft > 0 && !isSpinning ? spinBtnScale : 1 }] }]}>
                  <PressScale
                    disabled={isSpinning || (!!myId && wheelSectors.length === 0)}
                    onPress={handleSpin}
                    accessibilityRole="button"
                    accessibilityLabel="Spin the wheel"
                    style={[s.spHub, { backgroundColor: spinsLeft > 0 || !myId ? '#F6C453' : '#A1A1AA' }]}
                  >
                    {isSpinning ? <ActivityIndicator size="small" color="#1C1257" /> : (
                      <Text style={s.spHubText}>{spinsLeft > 0 || !myId ? 'Spin' : 'Locked'}</Text>
                    )}
                  </PressScale>
                </Animated.View>
              </View>

              <Text style={s.spStatus}>
                {!myId
                  ? 'Sign in to see your spins'
                  : rewardsStatus === 'error' || (rewardsStatus === 'ready' && wheelSectors.length === 0)
                    ? 'Could not load your spins. Go back and pull down to retry.'
                    : spinsLeft > 0
                      ? `You have ${spinsLeft} spin${spinsLeft === 1 ? '' : 's'} ready`
                      : spinNextIn
                        ? `${spinNextIn} more delivered order${spinNextIn === 1 ? '' : 's'} to your next spin`
                        : 'Every 2 delivered orders earn a spin'}
              </Text>

              {!!myId && spinsLeft === 0 && rewardsStatus === 'ready' && wheelSectors.length > 0 ? (
                <PressScale
                  onPress={() => { setSpinOpen(false); selectTab('food'); }}
                  accessibilityRole="button"
                  accessibilityLabel="Shop the campus store to earn your next spin"
                  style={s.spEarnBtn}
                >
                  <Ionicons name="basket-outline" size={18} color="#1C1257" />
                  <Text style={s.spEarnText}>Shop the campus store</Text>
                </PressScale>
              ) : null}

              <View style={s.spNote}>
                <View style={s.spNoteIcon}>
                  <Ionicons name="information-circle-outline" size={20} color="#F6C453" />
                </View>
                <Text style={s.spNoteText}>Every 2 delivered orders earn a spin. ZenPoints are added to your balance at once; a coupon shows up in Your coupons.</Text>
              </View>
            </ScrollView>
          </LinearGradient>
        </View>
      )}

      {/* ── SPIN RESULT ("Congratulations") ── */}
      <Modal
        visible={showWheelModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => { setShowWheelModal(false); setWheelResult(null); }}
      >
        <View style={[s.wonPage, { backgroundColor: isDark ? '#0E0B1F' : '#F7F5FF', paddingTop: topPad }]}>
          {wheelResult !== null && <Confetti />}
          <View style={s.spHead}>
            <PressScale style={[s.spBack, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF' }]} onPress={() => { setShowWheelModal(false); setWheelResult(null); }} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={txt} />
            </PressScale>
            <Text style={[s.spHeadTitle, { color: txt }]}>Spin & win</Text>
          </View>

          <View style={s.wonBody}>
            <View style={[s.wonIcon, { backgroundColor: dp.tint }]}>
              <Ionicons name={wheelResult?.coupon ? 'ticket' : 'diamond'} size={44} color={dp.ink} />
            </View>
            <Text style={[s.wonTitle, { color: txt }]}>Congratulations!</Text>
            <Text style={[s.wonSub, { color: txtSec }]}>You won</Text>

            {wheelResult && (
              <View style={[s.wonPrize, { backgroundColor: isDark ? 'rgba(246,196,83,0.10)' : '#FFF8E6', borderColor: '#F6C453' }]}>
                <Text style={[s.wonPrizeText, { color: txt }]}>{stripEmoji(wheelResult.display) || wheelResult.display}</Text>
                <Text style={[s.wonPrizeSub, { color: txtSec }]}>
                  {wheelResult.coupon ? 'Your coupon is ready to use at checkout.' : 'Added to your ZenPoints balance.'}
                </Text>
              </View>
            )}

            {!!wheelResult?.coupon && (
              <>
                <Text style={[s.wonCode, { color: txt }]}>Code: {wheelResult.coupon.code}</Text>
                {!!wheelResult.coupon.expiryDate && !isNaN(new Date(wheelResult.coupon.expiryDate).getTime()) && (
                  <Text style={[s.wonValid, { color: txtSec }]}>
                    Valid till {new Date(wheelResult.coupon.expiryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                )}
              </>
            )}
          </View>

          <View style={s.wonActions}>
            {!!wheelResult?.coupon ? (
              <PressScale
                style={[s.wonPrimary, { backgroundColor: dp.solid }]}
                onPress={() => { handleCopyCode(wheelResult.coupon!.code); Haptics.selectionAsync().catch(() => {}); }}
                accessibilityRole="button"
              >
                <Text style={s.wonPrimaryText}>{copiedCode === wheelResult.coupon.code ? 'Code copied' : 'Copy code'}</Text>
              </PressScale>
            ) : spinsLeft > 0 ? (
              <PressScale style={[s.wonPrimary, { backgroundColor: dp.solid }]} onPress={() => { setShowWheelModal(false); setWheelResult(null); }} accessibilityRole="button">
                <Text style={s.wonPrimaryText}>Spin again</Text>
              </PressScale>
            ) : null}
            <PressScale
              style={[s.wonSecondary, { borderColor: dp.solid }]}
              onPress={() => { setShowWheelModal(false); setWheelResult(null); setSpinOpen(false); }}
              accessibilityRole="button"
            >
              <Text style={[s.wonSecondaryText, { color: dp.ink }]}>Back to deals</Text>
            </PressScale>
          </View>
        </View>
      </Modal>

      {/* ── SAVED ITEMS MODAL ── */}
      <Modal visible={favoritesModalVisible} animationType="slide" transparent={true} onRequestClose={() => setFavoritesModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
          <PressScale style={StyleSheet.absoluteFill} onPress={() => setFavoritesModalVisible(false)} />
          <View style={{ backgroundColor: isDark ? OTHERS_SURFACE.dark.card : OTHERS_SURFACE.light.card, borderTopLeftRadius: OTHERS_RADIUS.sheet, borderTopRightRadius: OTHERS_RADIUS.sheet, maxHeight: '85%', minHeight: '45%', paddingBottom: Platform.OS === 'ios' ? 36 : 24 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? OTHERS_SURFACE.dark.line : OTHERS_SURFACE.light.line, alignSelf: 'center', marginTop: 10, marginBottom: 14 }} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: isDark ? OTHERS_SURFACE.dark.line : OTHERS_SURFACE.light.line }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ ...OTHERS_TYPE.heading, color: txt }}>Saved items</Text>
                  {savedFavoritesList.length > 0 && (
                    <View style={{ backgroundColor: fg.tint, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                      <Text style={{ color: fg.ink, fontSize: 12, fontWeight: '700' }}>{savedFavoritesList.length} saved</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 13, color: txtSec, marginTop: 2 }}>Products you saved in the campus store</Text>
              </View>
              <PressScale style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: isDark ? OTHERS_SURFACE.dark.raised : OTHERS_SURFACE.light.raised, alignItems: 'center', justifyContent: 'center' }} onPress={() => setFavoritesModalVisible(false)} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={txt} />
              </PressScale>
            </View>

            <ScrollView style={{ paddingHorizontal: 16, paddingTop: 12 }} showsVerticalScrollIndicator={false}>
              {savedFavoritesList.length > 0 ? (
                savedFavoritesList.map(item => (
                  <View key={item.id} style={{ flexDirection: 'row', backgroundColor: isDark ? OTHERS_SURFACE.dark.raised : OTHERS_SURFACE.light.raised, borderRadius: 16, padding: 12, marginBottom: 12, gap: 12, alignItems: 'center' }}>
                    <Image source={{ uri: item.image }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: isDark ? OTHERS_SURFACE.dark.field : '#E9EDF2' }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: txt, lineHeight: 18 }} numberOfLines={2}>{item.title}</Text>
                      <Text style={{ fontSize: 12, color: txtSec, marginTop: 2 }} numberOfLines={1}>{item.subtitle}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                        <Text style={{ fontSize: 15, fontWeight: '800', color: txt }}>{item.price}</Text>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <PressScale style={{ height: 36, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: isDark ? OTHERS_SURFACE.dark.line : OTHERS_SURFACE.light.line, alignItems: 'center', justifyContent: 'center' }} onPress={() => removeSaved(item.id)} accessibilityRole="button" accessibilityLabel={`Remove ${item.title}`}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: txtSec }}>Remove</Text>
                          </PressScale>
                          <PressScale
                            style={{ height: 36, paddingHorizontal: 16, borderRadius: 12, backgroundColor: fg.solid, alignItems: 'center', justifyContent: 'center' }}
                            accessibilityRole="button"
                            accessibilityLabel={`View ${item.title}`}
                            onPress={() => {
                              setFavoritesModalVisible(false);
                              router.push(item.targetRoute as any);
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>View</Text>
                          </PressScale>
                        </View>
                      </View>
                    </View>
                  </View>
                ))
              ) : (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: fg.tint, marginBottom: 12 }}><Ionicons name="heart-outline" size={24} color={fg.ink} /></View>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: txt }}>Nothing saved yet</Text>
                  <Text style={{ fontSize: 12, color: txtSec, marginTop: 4, textAlign: 'center', maxWidth: 260 }}>
                    Tap the heart on any product in Food & groceries to save it here.
                  </Text>
                  <PressScale
                    onPress={() => { setFavoritesModalVisible(false); selectTab('food'); }}
                    accessibilityRole="button"
                    style={{ marginTop: 16, height: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: fg.solid, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>Browse the campus store</Text>
                  </PressScale>
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

  // PG filters


  // Floating Cart Status Bar
  heroCarouselCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    marginBottom: 12,
    marginTop: 8,
  },
  heroCarousel: {
    marginHorizontal: 0,
  },

  // -- Campus Hub header (Food & groceries redesign, 22 Oct) --
  hubHeader: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: 12 },
  hubTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hubTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hubTitle: { ...OTHERS_TYPE.title },
  hubSubtitle: { ...OTHERS_TYPE.label, fontWeight: '400', marginTop: 2 },
  hubStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingHorizontal: 9, borderRadius: 12, flexShrink: 0 },
  hubStatusDot: { width: 6, height: 6, borderRadius: 3 },
  hubStatusText: { fontSize: 12, fontWeight: '600' },
  hubSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hubSearch: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 14, borderRadius: OTHERS_RADIUS.button, borderWidth: 1 },
  hubSearchInput: { flex: 1, fontSize: 14, fontWeight: '400', padding: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null) },
  hubIconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hubIconBtnLg: { width: 44, height: 44, borderRadius: OTHERS_RADIUS.button },

  // Section pills (40) and category chips (36): one style, two sizes.
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1 },
  pillSm: { height: 36, paddingHorizontal: 12, borderRadius: 18, gap: 5 },
  pillLabel: { fontSize: 13, letterSpacing: 0.1 },
  pillLabelSm: { fontSize: 12.5 },

  // Top deal card

  // Section header + rails (16 px gutters, 12 px gaps)
  secBlock: { marginTop: 24 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 12 },
  secTitle: { fontSize: 18, fontWeight: '700', letterSpacing: 0.1 },
  secSub: { fontSize: 13, fontWeight: '400', marginTop: 2 },
  railContent: { paddingHorizontal: 16, gap: 12, paddingBottom: 6 },
  dietMark: { position: 'absolute', top: 8, right: 13, width: 14, height: 14, borderRadius: 3, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  dietDot: { width: 6, height: 6, borderRadius: 3 },

  // Brand rail

  // Photo tiles (toys, health, grocery aisles)

  // Empty / error states

  // Categories mode

  // ── Food & groceries rebuild (owner reference, 22 Oct) ──



  // Product card
  fCard: { borderRadius: 16, borderWidth: 1, padding: 8 },
  fPlate: { width: '100%', aspectRatio: 1.12, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  fPlateTouch: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 12, overflow: 'hidden' },
  fImg: { width: '78%', height: '82%', resizeMode: 'contain' },
  fTag: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 6, height: 20, borderRadius: 6, justifyContent: 'center' },
  fTagText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
  fHeart: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  fPlus: { position: 'absolute', right: 6, bottom: 6, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  fClosedPill: { position: 'absolute', right: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 8, borderRadius: 13 },
  fClosedText: { fontSize: 11, fontWeight: '700' },
  fStepper: { position: 'absolute', right: 6, bottom: 6, height: 30, minWidth: 84, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  fStepBtn: { width: 24, height: 28, alignItems: 'center', justifyContent: 'center' },
  fStepQty: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', minWidth: 18, textAlign: 'center' },
  fName: { fontSize: 13, fontWeight: '600', lineHeight: 18, height: 36, marginTop: 4, paddingRight: 2 },
  fMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  fMeta: { fontSize: 12, fontWeight: '400', flexShrink: 1 },
  fPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  fPrice: { fontSize: 15, fontWeight: '700' },
  fWas: { fontSize: 12, fontWeight: '400', textDecorationLine: 'line-through' },
  fRateRow: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 18, marginTop: 2 },
  fRate: { fontSize: 12, fontWeight: '600' },
  fRateCount: { fontSize: 12, fontWeight: '400' },

  // Categories mode header

  // Category listing page
  dietInline: { position: 'relative', top: 0, right: 0, width: 12, height: 12, borderRadius: 2 },

  // ── Deals & spin (owner reference, 22 Oct): purple accent ──
  dlHero: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, borderRadius: 20, padding: 18, paddingRight: 12, gap: 8, overflow: 'hidden' },
  dlHeroText: { flex: 1, minWidth: 0 },
  dlHeroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', letterSpacing: 0.1 },
  dlHeroTag: { color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: '600', marginTop: 2 },
  dlHeroSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '400', lineHeight: 17, marginTop: 6 },
  dlHeroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: '#FFFFFF', marginTop: 12 },
  dlHeroBtnText: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  dlHeroWheel: { width: 116, height: 116, alignItems: 'center', justifyContent: 'center' },
  dlHeroHub: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#F6C453', borderWidth: 3, borderColor: '#FFFFFF' },
  dlHeroBadge: { position: 'absolute', top: -2, right: -2, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', justifyContent: 'center' },
  dlHeroBadgeText: { fontSize: 11, fontWeight: '700' },

  dlStatRow: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 16 },
  dlStat: { flex: 1, padding: 14, borderRadius: 16, borderWidth: 1, gap: 4 },
  dlStatIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  dlStatLabel: { fontSize: 12, fontWeight: '500' },
  dlStatValue: { fontSize: 20, fontWeight: '700' },
  dlSignIn: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 16, borderWidth: 1 },

  dlCardTitle: { fontSize: 15, fontWeight: '600' },
  dlCardSub: { fontSize: 13, fontWeight: '400', lineHeight: 18, marginTop: 2 },
  dlSmallBtn: { height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  dlSmallBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },

  dlDeal: { borderRadius: 16, borderWidth: 1, padding: 8 },
  dlDealImg: { width: '100%', aspectRatio: 16 / 10, borderRadius: 12, overflow: 'hidden' },
  dlTag: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center' },
  dlTagText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  dlDealName: { fontSize: 14, fontWeight: '600', lineHeight: 19, height: 38, marginTop: 8 },
  dlDealMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  dlDealMetaText: { fontSize: 12, fontWeight: '400', flexShrink: 1 },
  dlDealBtn: { height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10 },

  dlStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 20, padding: 14, borderRadius: 16 },
  dlStripWheel: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },

  dlEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
  dlCoupon: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  dlCouponIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dlOutlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  dlOutlineBtnText: { fontSize: 13, fontWeight: '600' },

  dlRefer: { marginHorizontal: 16, marginTop: 24, marginBottom: 8, padding: 16, borderRadius: 16, borderWidth: 1 },
  dlReferTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dlReferRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  dlCodeBox: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 12, justifyContent: 'center' },
  dlCodeLabel: { fontSize: 11, fontWeight: '500' },
  dlCodeText: { fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  dlShareBtn: { height: 48, paddingHorizontal: 18, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },

  // Deal detail sheet
  ddBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  ddSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', paddingBottom: Platform.OS === 'ios' ? 32 : 20, maxWidth: 600, width: '100%', alignSelf: 'center' },
  ddImg: { width: '100%', aspectRatio: 16 / 9 },
  ddClose: { position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  ddBody: { paddingHorizontal: 16, paddingTop: 16 },
  ddTitle: { fontSize: 20, fontWeight: '700', lineHeight: 26 },
  ddMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  ddMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 15 },
  ddMetaText: { fontSize: 12, fontWeight: '500' },
  ddHow: { fontSize: 15, fontWeight: '600', marginTop: 20, marginBottom: 4 },
  ddStep: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  ddStepNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  ddStepNumText: { fontSize: 12, fontWeight: '700' },
  ddStepText: { flex: 1, fontSize: 14, fontWeight: '400', lineHeight: 19 },
  ddCta: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginHorizontal: 16, marginTop: 20 },

  // Spin page
  spHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  spBack: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  spHeadTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  spBody: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 48 },
  spChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 4 },
  spChipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  spTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  spSub: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '400', marginTop: 4, textAlign: 'center' },
  spWheelWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  spGlow: { position: 'absolute', backgroundColor: 'rgba(124,92,255,0.35)' },
  spPointer: { position: 'absolute', top: -6, alignItems: 'center' },
  spHubWrap: { position: 'absolute' },
  spHub: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#FFFFFF' },
  spEarnBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center', height: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: '#F6C453', marginTop: 14 },
  spEarnText: { color: '#1C1257', fontSize: 14, fontWeight: '700' },
  spHubText: { color: '#1C1257', fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },
  spStatus: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginTop: 24, textAlign: 'center' },
  spNote: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', marginTop: 24, padding: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  spNoteIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(246,196,83,0.16)', alignItems: 'center', justifyContent: 'center' },
  spNoteText: { flex: 1, color: 'rgba(255,255,255,0.86)', fontSize: 13, fontWeight: '400', lineHeight: 18 },

  // Spin result
  wonPage: { flex: 1 },
  wonBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  wonIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  wonTitle: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  wonSub: { fontSize: 16, fontWeight: '500', marginTop: 2, textAlign: 'center' },
  wonPrize: { alignSelf: 'stretch', marginTop: 20, paddingVertical: 20, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center' },
  wonPrizeText: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  wonPrizeSub: { fontSize: 13, fontWeight: '400', marginTop: 6, textAlign: 'center' },
  wonCode: { fontSize: 15, fontWeight: '600', marginTop: 16, letterSpacing: 0.5 },
  wonValid: { fontSize: 13, fontWeight: '400', marginTop: 4 },
  wonActions: { paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 36 : 24, gap: 10 },
  wonPrimary: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  wonPrimaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  wonSecondary: { height: 52, borderRadius: 26, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  wonSecondaryText: { fontSize: 16, fontWeight: '600' },

  // Text button with a chevron ("All deals", "See all")
  textBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32, paddingLeft: 4 },
  textBtnText: { fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },
});
