import * as Haptics from 'expo-haptics';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl, FlatList, Dimensions, Platform, Modal, ActivityIndicator, Alert, Animated, Linking, BackHandler, Vibration } from 'react-native';
import { takesSlotOrders } from '../../utils/storeOpenNow';
import { useSectionUsage, rankByUsage, recordSectionUse } from '../../utils/sectionUsage';
import { CB_COUNTER_PHOTO } from '../../modules/campusBooking/cbTheme';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from '../../components/SafeImage';
import { useLiveSync, hasType } from '../../utils/useLiveSync';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect, useIsFocused, useScrollToTop } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS, RADIUS, surfaceLift, surfaceShadow, LIGHT_HAIRLINE } from '../../constants/theme';
import { API_URL, ENDPOINTS } from '../../constants/api';
import { useAuth } from '../../context/AuthContext';
import { type BasketKind } from '../../context/CartContext';
import { FloatingBasketBar, FloatingBasketButton } from '../../components/FloatingBasket';
import { useTheme } from '../../context/ThemeContext';
import { useDietary } from '../../context/DietaryContext';
import { apiFetch } from '../../utils/auth';
import { readCache, writeCache, peekCache, RESTAURANTS_CACHE_KEY, useSWRJson, useCollegeEpoch, getCollegeEpoch } from '../../utils/swrCache';
import NexusExplorer, { cuisineHasDishes } from '../../components/NexusExplorer';
import SearchOverlay from '../../components/SearchOverlay';
import PromoCarousel from '../../components/PromoCarousel';
import HighClassPromoCarousel from '../../components/HighClassPromoCarousel';
import CampusLiveTicker from '../../components/CampusLiveTicker';
import { isLocalVendor } from '../../utils/localVendor';
import RecentlyViewed from '../../components/RecentlyViewed';
import { useWorldTransitionTrigger } from '../../context/WorldTransitionContext';
import AmbientBackground from '../../components/AmbientBackground';
import DopaminePressable, { CardPressable, ActionPressable } from '../../components/DopaminePressable';
import { StaggeredSection, RestaurantCardSkeleton, PulseGlow, BounceIn } from '../../components/AnimatedSection';
import NightClosureBanner, { NextSlotHint } from '../../components/NightClosureBanner';
import { featuredLabel } from '../../utils/promoLabel';
import ZenvyEcosystemGrid from '../../components/ZenvyEcosystemGrid';
import SafeImage from '../../components/SafeImage';
import { Ionicons } from '@expo/vector-icons';
import { istHour } from '../../utils/format';
import { storeEtaMins, storeEtaText } from '../../utils/storeEta';
import { isNewStore as isNewStoreRule } from '../../utils/storeBadge';
import { syncFavorites, toggleFavoriteStore, onFavoritesChange, isFavoriteIn } from '../../utils/favorites';
import { useTopInset } from '../../utils/useTopInset';
import { useIntroDone } from '../../utils/introGate';
import { rememberIntroSoundSetting } from '../../components/intro/introSound';
import SymbolIcon from '../../components/SymbolIcon';

const VaultTimerBadge = ({ pulseAnim }: { pulseAnim: any }) => {
  const [vaultTimer, setVaultTimer] = useState('00:00:00');
  const isFocused = useIsFocused();
  // Light mode: the timer was white on a white card (invisible); dark mode is unchanged
  const { isDark } = useTheme();
  useEffect(() => {
    if (!isFocused) return; // 1 s ticker only while the Home tab is on screen
    const iv = setInterval(() => {
      // Daily deals reset at midnight IST (coupons are valid until then)
      const IST_OFFSET = 5.5 * 3600000;
      const istNow = Date.now() + IST_OFFSET;
      const d = 86400000 - (istNow % 86400000);
      if (d < 0) return;
      const h = Math.floor(d / 3600000);
      const m = Math.floor((d % 3600000) / 60000);
      const s = Math.floor((d % 60000) / 1000);
      setVaultTimer(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    }, 1000);
    return () => clearInterval(iv);
  }, [isFocused]);
  
  return (
    <View style={StyleSheet.create({ vaultTimerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.06)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 } }).vaultTimerWrap}>
      <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', shadowColor: '#10B981', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8 }, { opacity: pulseAnim }]} />
      <Text style={{ fontSize: 13, fontWeight: '700', color: isDark ? '#fff' : '#0F172A', fontVariant: ['tabular-nums'] }}>{vaultTimer}</Text>
    </View>
  );
};

// Swiggy/Zomato style rotating search placeholder. Lives in its own component so the 3.5 s tick
// re-renders one TextInput instead of the whole home screen (it used to re-filter every restaurant).
const SEARCH_PLACEHOLDERS = [
  'Search for biryani…',
  'Search for pizza…',
  'Search for dosa…',
  'Search for cold coffee…',
  'Search for burgers…',
]; // short enough to fit whole at large phone text (QA 5 Nov, 130%)
const RotatingSearchInput = React.memo(function RotatingSearchInput({ search, color, placeholderColor, inputStyle }: { search: string; color: string; placeholderColor: string; inputStyle: any }) {
  const isFocused = useIsFocused();
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const placeholderFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isFocused) return; // tab hidden: no timers, no animations
    const interval = setInterval(() => {
      Animated.timing(placeholderFade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setPlaceholderIndex(prev => (prev + 1) % SEARCH_PLACEHOLDERS.length);
        Animated.timing(placeholderFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 3500);
    return () => clearInterval(interval);
  }, [isFocused, placeholderFade]);
  return (
    <Animated.View style={{ flex: 1, opacity: placeholderFade }}>
      <TextInput
        style={[inputStyle, { color }]}
        placeholder={SEARCH_PLACEHOLDERS[placeholderIndex]}
        placeholderTextColor={placeholderColor}
        value={search}
        editable={false}
        pointerEvents="none"
      />
    </Animated.View>
  );
});

/** Short area line for a store card: the first two comma parts of its address, without PIN codes. */
const shortArea = (loc: any): string => String(loc || "").split(",").map((x) => x.replace(/\b\d{6}\b/g, '').trim()).filter((x) => x && !/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}$/i.test(x)).slice(0, 2).join(', '); // drops map plus-codes like CHJ8+XGP

const { width: SW } = Dimensions.get('window');

const FILTERS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', label: 'All', icon: 'grid-outline' },
  // Shown only once the user has hearted a store (see the chip row)
  { key: 'favorites', label: 'Favourites', icon: 'heart-outline' },
  { key: 'veg', label: 'Pure veg', icon: 'leaf-outline' },
  { key: 'under99', label: 'Under ₹99', icon: 'cash-outline' },
  { key: 'topRated', label: 'Rated 4.5+', icon: 'star-outline' },
  { key: 'express', label: 'Under 20 min', icon: 'time-outline' },
  { key: 'premium', label: 'Featured', icon: 'sparkles-outline' },
  { key: 'budget', label: 'Under ₹150', icon: 'wallet-outline' },
  { key: 'jain', label: 'Jain', icon: 'flower-outline' },
  { key: 'eggless', label: 'Eggless', icon: 'egg-outline' },
];

// The small live dot in the "open now" pill: a soft pulse while Home is on screen (still otherwise).
const LiveDot = React.memo(function LiveDot({ color, active }: { color: string; active: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);
  return (
    <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: pulse }} />
    </View>
  );
});

const CLASSICS = [
  { name: 'Biryani', img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=200' },
  { name: 'Pizza', img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=200' },
  { name: 'Burgers', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=200' },
  { name: 'South Indian', img: 'https://images.unsplash.com/photo-1541832676-9b763b0239ab?q=80&w=200' },
  { name: 'Drinks', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=200' },
  { name: 'Chinese', img: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?q=80&w=200' },
  { name: 'Momos & Rolls', img: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?q=80&w=200' },
  { name: 'Shakes', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?q=80&w=200' },
  { name: 'Gym Fuel', img: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=200' },
  { name: 'Bakery', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?q=80&w=200' },
];


// Home feature cards: every section, swiped sideways (owner, 26 Oct). Standard order; sections this user opens
// regularly move to the front (utils/sectionUsage). Tech & repairs sits second from last.
const CATEGORIES = [
  { key: 'food', label: 'Food' },
  { key: 'pg', label: 'PG stays' },
  { key: 'rides', label: 'Co-Ride' },
  { key: 'rentals', label: 'Rentals' },
  { key: 'events', label: 'Campus events' },
  { key: 'services', label: 'Tech & Repairs' },
  { key: 'promos', label: 'Deals & spin' },
];
// In-Campus Booking (owner, 27 Oct): ALWAYS the first card, fixed (never ranked); the cards above keep their usage order after it.
const CAMPUS_BOOKING_CARD = { key: 'campusBooking', label: 'In-Campus Booking' };
// Its longer label fits the card on every width (about 111 px at 12 px bold): 12 px from ~420 px phones, ~11 px at 390, ~10 px at 360.
// Usage key per card (the Others section it opens).
const CATEGORY_USAGE_KEY: Record<string, string> = { rides: 'coride' };
const categoryUsageKeys = (c: { key: string }) => [CATEGORY_USAGE_KEY[c.key] || c.key];

// Licensed photos only: Unsplash (food, services) and the sections' own licensed assets.
const CATEGORY_IMAGES = {
  food: { uri: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&q=80' },
  pg: require('../../modules/pgV2/assets/pg-v2-building-modern-midrise-greenery-hd-2026-10-26.webp'),
  rides: require('../../modules/corideV2/assets/coride-v2-owner-tile-auto-rickshaw-2026-10-24.webp'),
  rentals: require('../../modules/rentalsV2/assets/rv2-demo-bike-ntorq-1-hd-2026-10-26.webp'),
  events: require('../../modules/eventsV2/assets/ev2-sample-concert-crowd-hd-2026-10-26.webp'),
  services: { uri: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=200&q=80' },
  promos: require('../../modules/dealsV2/assets/dv2-sample-deal-donut-stack-hd-2026-10-26.webp'),
  // Licensed (Unsplash License): a "Collect your order here" pickup counter by Hardik P. SafeImage asks the CDN for 3x the drawn width.
  campusBooking: { uri: CB_COUNTER_PHOTO },
};
// Three whole cards and a slice of the fourth, so the row reads as swipeable on every width.
const CAT_GAP = 8;
const CAT_CARD_W = Math.round((SW - 16 - CAT_GAP * 3) / 3.3);
const CAMPUS_LABEL_SIZE = Math.min(12, Math.floor(((CAT_CARD_W - 4) / 112) * 120) / 10);

function getGreeting() {
  const h = istHour();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Helper to accurately classify pure-vegetarian dining spots
const isPureVegRestaurant = (r: any): boolean => {
  if (r.isVeg === true || r.isVegetarian === true) return true;

  const parseTags = (t: any): string[] => {
    if (!t) return [];
    if (Array.isArray(t)) return t.map(x => String(x).toLowerCase());
    if (typeof t === 'string') {
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) return parsed.map(x => String(x).toLowerCase());
      } catch {
        return [t.toLowerCase()];
      }
    }
    return [];
  };

  const tags = parseTags(r.tags || r.categories);
  const name = (r.name || '').toLowerCase();
  const cuisine = (r.cuisine || '').toLowerCase();

  // Strictly Non-Veg keywords: If these exist, this restaurant is definitely NOT pure veg
  const nonVegKeywords = ['chicken', 'mutton', 'meat', 'fish', 'seafood', 'shawarma', 'kfc', 'non-veg', 'nonveg', 'kebab', 'beef', 'pork', 'parotta hub'];
  if (nonVegKeywords.some(w => name.includes(w) || tags.includes(w) || cuisine.includes(w))) {
    return false;
  }

  // If restaurant has a menu: check if any item is non-veg
  const menu = r.menu || [];
  if (menu.length > 0) {
    const hasNonVegItem = menu.some((item: any) => {
      if (item.isVegetarian === false || item.isVeg === false) return true;
      const iName = (item.name || '').toLowerCase();
      const iTags = (item.tags || []).map((t: string) => String(t).toLowerCase());
      return nonVegKeywords.some(w => iName.includes(w) || iTags.includes(w));
    });
    if (hasNonVegItem) return false;
  }

  // Pure veg indicators
  const vegKeywords = ['veg', 'pure-veg', 'pure veg', 'vegetarian', 'south-indian', 'tiffin', 'sweets', 'bakery', 'juice', 'fruits', 'chaat', 'idli', 'dosa', 'ice cream', 'icecream', 'salad', 'chai', 'coffee', 'dessert', 'waffle', 'thali', 'paneer'];
  return vegKeywords.some(w => name.includes(w) || tags.includes(w) || cuisine.includes(w));
};

// The Veg toggle (QA 5 Nov 2026): a restaurant shows while it has at least one veg dish it can serve now, not only
// pure-veg places ("Pure veg" stays as its own chip / Filters option). Same veg rule as the restaurant page.
const isVegDish = (item: any): boolean => {
  const d = String(item?.dietType || '').toLowerCase().replace(/[^a-z]/g, '');
  if (d === 'veg') return true;
  if (d === 'egg' || d === 'nonveg' || d === 'nonvegetarian') return false;
  return item?.isVegetarian === true || String(item?.isVegetarian).toLowerCase() === 'true' || Number(item?.isVegetarian) === 1 || item?.isVeg === true;
};
const hasVegDish = (r: any): boolean => {
  const menu = availableMenu(r);
  return menu.length > 0 ? menu.some(isVegDish) : isPureVegRestaurant(r);
};

// Restaurant types shown in the Home food list and the Classics explorer
const HOME_FOOD_TYPES = ['FOOD', 'RESTAURANT', 'CAFE', 'BAKERY', 'SWEETS', 'DESSERT', 'DESSERTS', 'DRINKS', 'MESS'];
// Stalls near campus are on the Local tab (components/CampusBitesSection: the stall delivers, COD), never in this grid
const isHomeFoodVendor = (r: any): boolean => {
  if (isLocalVendor(r)) return false;
  const t = String(r?.vendorType || '').toUpperCase();
  return !t || HOME_FOOD_TYPES.includes(t);
};

// Only dishes the store can actually serve right now
const availableMenu = (r: any): any[] => (Array.isArray(r?.menu) ? r.menu : []).filter((i: any) => i && i.isAvailable !== false);

// Open/closed: the server sends isOpen (vendor toggle + operatingHours, IST). Fall back to the raw fields for cached data.
const isRestaurantOpenNow = (r: any): boolean => {
  if (!r) return false;
  if (typeof r.isOpen === 'boolean') return r.isOpen;
  if (r.isActive === false || r.isOffline === true || r.isOpenNow === false) return false;
  let hours: any = r.operatingHours;
  if (typeof hours === 'string') { try { hours = JSON.parse(hours); } catch { hours = null; } }
  if (!hours || typeof hours !== 'object') return true;
  const [sH, sM] = String(hours.start || '00:00').split(':').map(Number);
  const [eH, eM] = String(hours.end || '23:59').split(':').map(Number);
  if ([sH, sM, eH, eM].some(n => Number.isNaN(n))) return true;
  const now = new Date();
  const ist = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
  const cur = ist.getHours() * 60 + ist.getMinutes();
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  if (end < start) return cur >= start || cur <= end; // overnight hours
  return cur >= start && cur <= end;
};

// "9:00 AM" from the server's opensAt ("09:00")
const formatOpensAt = (opensAt: any): string | null => {
  if (!opensAt || typeof opensAt !== 'string') return null;
  const [h, m] = opensAt.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${suffix}`;
};

// Diet keyword match across restaurant tags, name and available dishes
const hasDietTag = (r: any, kw: string): boolean => {
  const has = (v: any) => (Array.isArray(v) ? v : []).some((x: any) => String(x || '').toLowerCase().includes(kw));
  return has(r.tags) || (r.name || '').toLowerCase().includes(kw) || (r.cuisine || '').toLowerCase().includes(kw) ||
    availableMenu(r).some((i: any) => (i.name || '').toLowerCase().includes(kw) || (i.category || '').toLowerCase().includes(kw) || has(i.tags));
};

/**
 * One rule per filter chip, used both to filter the store grid and to decide which chips show: a chip appears only
 * while at least one store matches it (3 Nov 2026: "Rated 4.5+", "Featured" or "Jain" with no store behind them
 * opened an empty list; "Under 20 min" and Favourites already hid themselves this way).
 */
const matchesHomeFilter = (r: any, key: string, favorites: any[]): boolean => {
  if (key === 'favorites') return isFavoriteIn(favorites, r._id || r.id);
  if (key === 'veg') return isPureVegRestaurant(r);
  if (key === 'under99') return availableMenu(r).some((i: any) => Number(i.price) <= 99);
  if (key === 'topRated') return Number(r.rating) >= 4.5;
  if (key === 'express') { const d = storeEtaMins(r); return !!d && d <= 20; }
  if (key === 'budget') return availableMenu(r).some((i: any) => Number(i.price) < 150);
  if (key === 'premium') return r.subscriptionTier === 'premium' || r.isFeatured;
  if (key === 'jain') return hasDietTag(r, 'jain');
  if (key === 'eggless') return hasDietTag(r, 'eggless');
  return true;
};

export default function HomeScreen() {
  // Home's full content is drawn once the launch intro is done (utils/introGate); its data still loads meanwhile.
  const introDone = useIntroDone();
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  // Keyboard lift only while Home is the visible tab (it stays mounted under other screens).
  const homeFocused = useIsFocused();
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { isDark, toggleTheme, colors } = useTheme();
  const triggerTransition = useWorldTransitionTrigger();
  const scrollRef = useRef<ScrollView>(null);
  // Tapping the Home tab while Home is already open scrolls back to the top (QA 5 Nov 2026).
  useScrollToTop(scrollRef);
  // The promo carousel pauses its auto-advance and card animations once it is scrolled off-screen
  // The carousel sits below the stores: it animates only while some of it is on screen.
  const carouselTop = useRef(0);
  const carouselHeight = useRef(0);
  // The carousel sits near the top of Home, so it starts visible. (It used to start hidden and only became
  // visible on the first scroll event: on phones no scroll event fires at launch, so the art never animated.)
  const [carouselVisible, setCarouselVisible] = useState(true);
  const carouselVisibleRef = useRef(true);
  // The restaurant grid renders 12 cards first (it sits inside this ScrollView, so it cannot be a
  // virtualized list). It no longer grows on its own while scrolling: a "Show all" button ends it,
  // so Recently viewed below stays reachable without scrolling past every store.
  const GRID_PAGE = 12;
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  const gridBottom = useRef(0);
  // Where the user was when they tapped "Show all", so "Show fewer" can return them to that spot.
  const homeScrollY = useRef(0);
  const scrollYBeforeShowAll = useRef<number | null>(null);
  const onHomeScroll = useCallback((e: any) => {
    const ne = e?.nativeEvent || {};
    const y = ne.contentOffset?.y || 0;
    homeScrollY.current = y;
    const viewH = ne.layoutMeasurement?.height || 0;
    const visible = carouselHeight.current <= 0
      || (y + viewH > carouselTop.current && y < carouselTop.current + carouselHeight.current);
    if (visible !== carouselVisibleRef.current) {
      carouselVisibleRef.current = visible;
      setCarouselVisible(visible);
    }
  }, []);
  const nexusY = useRef(0);
  const gridY = useRef(0);
  const pendingNexusScroll = useRef(false);
  const scrollToGrid = () => { scrollRef.current?.scrollTo({ y: Math.max(0, gridY.current - 8), animated: true }); };
  const scrollToNexusSoon = (alreadyMounted: boolean) => {
    if (alreadyMounted && nexusY.current > 0) scrollRef.current?.scrollTo({ y: nexusY.current, animated: true });
    else pendingNexusScroll.current = true;
  };
  const [restaurants, setRestaurants] = useState<any[]>(() => peekCache<any[]>(RESTAURANTS_CACHE_KEY) || []);
  const [filter, setFilter] = useState('all');
  const [classicFilter, setClassicFilter] = useState('');
  const [search, setSearch] = useState('');
  const { dietMode, setDietMode } = useDietary();
  const [vegOnly, setVegOnly] = useState(dietMode === 'veg' || dietMode === 'eggarian');

  useEffect(() => {
    setVegOnly(dietMode === 'veg' || dietMode === 'eggarian');
  }, [dietMode]);
  const [loading, setLoading] = useState(() => !peekCache(RESTAURANTS_CACHE_KEY));
  const [refreshing, setRefreshing] = useState(false);
  const [classics, setClassics] = useState<any[]>(CLASSICS);
  // Popular dishes shows only the cuisines with at least one available dish on today's menus (3 Nov 2026: the fixed
  // list of ten led mostly to "No pizza dishes on campus menus right now"). Same rule as the dish list (NexusExplorer).
  const shownClassics = React.useMemo(() => classics.filter((c) => cuisineHasDishes(restaurants, c.name)), [classics, restaurants]);
  const [loadError, setLoadError] = useState<false | 'server' | 'network'>(false);
  // "Rides" shows only while Co-Ride has an upcoming ride (same check as the Others tab).
  const sectionsSWR = useSWRJson<{ sections?: Record<string, { live?: boolean; on?: boolean }> }>('/api/config/sections', { freshMs: 60 * 1000 });
  // The admins' Intro sound switch rides on the same answer; kept for the next app start (the intro plays before
  // the network answers).
  const introSoundOn = sectionsSWR.data?.sections?.introSound?.on;
  useEffect(() => { if (typeof introSoundOn === 'boolean') rememberIntroSoundSetting(introSoundOn); }, [introSoundOn]);
  // Same visibility as the Services pills: PG follows the server (which reports it always live); unknown (offline,
  // older server) shows it. Co-Ride, Rentals and Events always show (3 Nov 2026): posting a ride is how Co-Ride's
  // listings start (the Services pill already always showed), "List your vehicle" lives in Rentals, and with no
  // events the Events page says "Events open soon".
  const sectionUsage = useSectionUsage();
  const homeCategories = React.useMemo(() => {
    const sec = sectionsSWR.data?.sections;
    const shown = CATEGORIES.filter((c) => {
      if (c.key === 'pg') return sec?.pg?.live !== false;
      return true;
    });
    return [CAMPUS_BOOKING_CARD, ...rankByUsage(shown, categoryUsageKeys, sectionUsage)];
  }, [sectionsSWR.data, sectionUsage]);
  // Live count for the "All restaurants" header: food stores in the grid and how many are open now
  const storeCounts = React.useMemo(() => {
    const food = restaurants.filter(isHomeFoodVendor);
    // Delivery slots: a closed store that takes orders for the next slot still counts as taking orders.
    return { total: food.length, open: food.filter(isRestaurantOpenNow).length, slot: food.filter((r: any) => !isRestaurantOpenNow(r) && takesSlotOrders(r)).length };
  }, [restaurants]);
  // "Under 20 min" only when the server has measured delivery times (utils/storeEta)
  // Promo slides for switched-off sections are left out. "Find a ride" waits for a confirmed live
  // Co-Ride (no slide that pops in and out); PG stays unless the server says it is off.
  // Owner, 4 Nov 2026: no PG banner while PG stays has no listings (it led to an empty page). Unknown keeps it.
  const pgHomeSWR = useSWRJson<{ pgs?: unknown[] }>('/api/pg/home', { freshMs: 5 * 60 * 1000 });
  const noPgListed = Array.isArray(pgHomeSWR.data?.pgs) && pgHomeSWR.data!.pgs!.length === 0;
  const hiddenPromoSlides = React.useMemo(() => {
    const sec = sectionsSWR.data?.sections;
    const out: string[] = [];
    if (sec?.coride?.live !== true) out.push('ride');
    if (sec?.pg?.live === false || noPgListed) out.push('stays');
    if (sec?.campus?.live === false) out.push('campus-buddy');
    return out;
  }, [sectionsSWR.data, noPgListed]);
  // Owner, 31 Oct 2026: Campus can be switched off from the admin (Friends master switch); then the header
  // button and its promo go. Unknown (offline, older server) keeps them.
  const campusOff = sectionsSWR.data?.sections?.campus?.live === false;

  // Search Overlay State
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Vault and Block challenges Modal States
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [vaultChecked, setVaultChecked] = useState(false);
  const [loadingVault, setLoadingVault] = useState(false);
  const [vaultError, setVaultError] = useState(false);
  const [claimingItemId, setClaimingItemId] = useState<string | null>(null);

  const [showCatPrefModal, setShowCatPrefModal] = useState(false);

  // Zomato-range luxury animations
  const classicAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // Favorites state and logic
  const [favorites, setFavorites] = useState<string[]>([]);
  // The filter chips that have at least one food store behind them (matchesHomeFilter); the chosen chip always stays.
  const chipKeysWithStores = React.useMemo(() => {
    const food = restaurants.filter(isHomeFoodVendor);
    return new Set(FILTERS.filter((f) => food.some((r: any) => matchesHomeFilter(r, f.key, favorites))).map((f) => f.key));
  }, [restaurants, favorites]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadNonce, setUnreadNonce] = useState(0);
  const lastUnreadCheck = useRef<{ key: string; at: number }>({ key: '', at: 0 });

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1200,
          useNativeDriver: true,
        })
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, []);

  useEffect(() => {
    if (classicFilter !== '') {
      classicAnim.setValue(0);
      Animated.spring(classicAnim, {
        toValue: 1,
        tension: 60,
        friction: 8,
        useNativeDriver: true,
      }).start();
    }
  }, [classicFilter]);

  // Favourite stores: local list, synced to the account when signed in (utils/favorites)
  useEffect(() => onFavoritesChange(setFavorites), []);
  useEffect(() => {
    let alive = true;
    syncFavorites(user?.id || null).then((ids) => { if (alive) setFavorites(ids); }).catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);
  useEffect(() => {
    if (filter === 'favorites' && favorites.length === 0) setFilter('all');
  }, [filter, favorites.length]);

  const toggleFavorite = async (id: string) => {
    try {
      setFavorites(await toggleFavoriteStore(id, !!user));
    } catch (e) {
      console.warn('[FAVORITES] toggle failed:', e);
    }
  };

  const fetchVaultItems = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) {
      setLoadingVault(true);
      setVaultError(false);
      setVaultItems([]);
    }
    try {
      const res = await apiFetch(ENDPOINTS.vaultList);
      if (res.ok) {
        const data = await res.json();
        setVaultItems(Array.isArray(data) ? data : []);
        setVaultChecked(true);
        setVaultError(false);
      } else if (!silent) {
        setVaultError(true);
      }
    } catch (e) {
      console.error(e);
      if (!silent) setVaultError(true);
    } finally {
      if (!silent) setLoadingVault(false);
    }
  };
  // The Daily deals card's "Ends in" countdown shows only while there is a deal to claim (3 Nov 2026: it ran with no
  // deal behind it, fake urgency); the list is read quietly when Home opens.
  useEffect(() => { fetchVaultItems({ silent: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const liveDealCount = vaultItems.filter((v: any) => Number(v?.remainingCount ?? 1) > 0).length;

  const claimingRef = useRef(false);
  const handleClaimVault = async (itemId: string) => {
    if (!user) {
      setShowVaultModal(false);
      Alert.alert('Sign in to claim', "Sign in to claim today's deals.", [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: () => router.push('/login' as any) },
      ]);
      return;
    }
    if (claimingRef.current) return; // a double tap must not claim twice
    claimingRef.current = true;
    setClaimingItemId(itemId);
    try {
      const res = await apiFetch(ENDPOINTS.vaultClaim(itemId), { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        const code = data.code || data.coupon?.code;
        Alert.alert('Deal claimed', code ? `Use code ${code} at checkout. It's valid until midnight.` : (data.message || 'Added to your coupons.'));
        fetchVaultItems();
        if (refreshUser) refreshUser();
      } else {
        Alert.alert("Couldn't claim this deal", data.message || 'Please try again in a moment.');
      }
    } catch (e) {
      Alert.alert("Couldn't claim this deal", 'Check your connection and try again.');
    } finally {
      claimingRef.current = false;
      setClaimingItemId(null);
    }
  };





  // No photo -> '' (the card shows a neutral store placeholder, not a shared stock photo).
  const sanitizeImage = (url: any) => {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('data:image/') || url.length > 1000) return '';
    return url;
  };

  const fetchData = useCallback(async () => {
    // apiFetch rides out a server cold start: it retries 502/503/504 and "server starting" answers for
    // up to ~3 minutes while the global "Zenvy is waking up" banner shows (utils/serverWake.ts), so
    // Home never flashes an error during a restart. fields=summary: stores with a light menu (the
    // full menu loads on the store page).
    // A list asked for before the student changed college is dropped (the newer request owns the screen).
    const requestEpoch = getCollegeEpoch();
    let stale = false;
    try {
      const res = await apiFetch(`${ENDPOINTS.restaurants}?fields=summary`);
      const data = await res.json().catch(() => null);
      if (requestEpoch !== getCollegeEpoch()) { stale = true; return; }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      if (!Array.isArray(data)) throw Object.assign(new Error('Bad restaurants payload'), { status: res.status });
      const cleaned = data.map((r: any) => ({
        ...r,
        imageUrl: sanitizeImage(r.imageUrl || r.image),
        image: sanitizeImage(r.imageUrl || r.image)
      }));
      setRestaurants(cleaned);
      // Cache for instant load next time (memory for this session, storage for the next app start)
      writeCache(RESTAURANTS_CACHE_KEY, cleaned);
      setLoadError(false);
    } catch (e: any) {
      if (requestEpoch !== getCollegeEpoch()) { stale = true; return; }
      console.warn('[ZENVY_SYNC] Restaurants failed to load:', e?.message || e);
      // Keep whatever is on screen (the cached list); only an empty screen is an error
      const cached = await readCache<any[]>(RESTAURANTS_CACHE_KEY);
      const hadCache = !!(cached && Array.isArray(cached.data) && cached.data.length > 0);
      if (hadCache) setRestaurants((cur) => (cur.length ? cur : cached!.data));
      setLoadError(hadCache ? false : (Number(e?.status) >= 500 ? 'server' : 'network'));
    } finally {
      // A stale answer leaves the spinner to the request that replaced it (no empty "no stores" flash).
      if (!stale) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // The student changed college (checkout) while Home is open: its stores replace the other college's list. Not on
  // mount (a change made before Home opened is already in the first fetch).
  const collegeEpoch = useCollegeEpoch();
  const epochAtMount = useRef(collegeEpoch);
  useEffect(() => {
    if (collegeEpoch === epochAtMount.current) return;
    epochAtMount.current = collegeEpoch;
    setRestaurants([]);
    setLoading(true);
    fetchData();
  }, [collegeEpoch, fetchData]);

  // Stale-while-revalidate: paint the last good list at once (cold app start included), then refresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!peekCache(RESTAURANTS_CACHE_KEY)) {
        const cached = await readCache<any[]>(RESTAURANTS_CACHE_KEY);
        if (!cancelled && cached && Array.isArray(cached.data) && cached.data.length > 0) {
          setRestaurants((cur) => (cur.length ? cur : cached.data));
          setLoading(false);
        }
      }
      if (!cancelled) fetchData();
    })();
    return () => { cancelled = true; };
  }, [fetchData]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const countLocal = async () => {
        // Guests (or offline): alerts this device received. Old app versions seeded fake
        // 'default-*' sample alerts; they never count.
        const stored = await AsyncStorage.getItem('zenvy_notifications');
        const notifs = stored ? JSON.parse(stored) : [];
        return Array.isArray(notifs)
          ? notifs.filter((n: any) => n && !n.read && !(typeof n.id === 'string' && n.id.startsWith('default-'))).length
          : 0;
      };
      const checkUnread = async () => {
        try {
          if (user) {
            try {
              const res = await apiFetch('/api/notifications/unread-count');
              const data = await res.json().catch(() => null);
              if (res.ok && data && typeof data.unreadCount === 'number') {
                if (active) setUnreadCount(data.unreadCount);
                return;
              }
            } catch {}
          }
          const local = await countLocal();
          if (active) setUnreadCount(local);
        } catch (e) {
          console.warn('Unread count error:', e);
        }
      };
      // Tab switches re-focus Home constantly: re-check at most every 30 s (announcements and
      // user/nonce changes still re-check at once through the deps key).
      const checkKey = `${user?._id || user?.id || 'guest'}|${unreadNonce}`;
      if (lastUnreadCheck.current.key !== checkKey || Date.now() - lastUnreadCheck.current.at > 30000) {
        lastUnreadCheck.current = { key: checkKey, at: Date.now() };
        checkUnread();
      }
      return () => { active = false; };
    }, [user, unreadNonce])
  );

  // Exit prompt on Android back, only while Home is the focused screen. (usePathname re-rendered
  // this whole screen on every navigation anywhere in the app.)
  useFocusEffect(
    useCallback(() => {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        Alert.alert('Close ZenWe?', undefined, [
          { text: 'Cancel', onPress: () => null, style: 'cancel' },
          { text: 'Close', onPress: () => BackHandler.exitApp() },
        ]);
        return true;
      });
      return () => backHandler.remove();
    }, [])
  );

  // Live sync: admin / partner edits to stores, menus and config refresh the home feed in place
  // (silent refetch: the list stays on screen, no skeletons, scroll position untouched).
  const showVaultModalRef = useRef(showVaultModal);
  showVaultModalRef.current = showVaultModal;
  useLiveSync({
    types: ['store', 'product', 'config', 'coupon', 'announcement'],
    onChange: (events) => {
      if (hasType(events, 'store', 'product', 'config')) fetchData();
      if (hasType(events, 'announcement')) setUnreadNonce((n) => n + 1);
      if (showVaultModalRef.current && hasType(events, 'coupon')) fetchVaultItems({ silent: true });
    },
  });

  useEffect(() => { setGridLimit(GRID_PAGE); }, [vegOnly, filter, search, classicFilter]);

  // Memoized: the list is only re-filtered when its inputs change, not on every render
  // Loaded, no error, and no food vendor on ZCS at all (the real stores are being entered): the food filters,
  // "Popular dishes" and the restaurant grid would only lead to empty screens, so Home says so once instead.
  const noFoodVendors = !loading && !loadError && !restaurants.some(isHomeFoodVendor);
  const filtered = React.useMemo(() => restaurants
    .filter(isHomeFoodVendor)
    .filter(r => {
      if (vegOnly) {
        return hasVegDish(r);
      }
      return true;
    })
    .filter(r => matchesHomeFilter(r, filter, favorites))
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (r.name||'').toLowerCase().includes(q) || (r.cuisine||'').toLowerCase().includes(q) || (Array.isArray(r.tags) && r.tags.some((t: any) => String(t || '').toLowerCase().includes(q)));
    })
    .sort((a, b) => {
      const aFeat = a.isFeatured ? 1 : 0;
      const bFeat = b.isFeatured ? 1 : 0;
      if (bFeat !== aFeat) return bFeat - aFeat;
      if (!classicFilter) return 0;
      const q = classicFilter.toLowerCase();
      const aMatch = (a.cuisine||'').toLowerCase().includes(q) || (a.name||'').toLowerCase().includes(q) || availableMenu(a).some((m:any) => (m.name||'').toLowerCase().includes(q));
      const bMatch = (b.cuisine||'').toLowerCase().includes(q) || (b.name||'').toLowerCase().includes(q) || availableMenu(b).some((m:any) => (m.name||'').toLowerCase().includes(q));
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    }), [restaurants, vegOnly, filter, search, classicFilter, favorites]);

  const cardBg = isDark ? 'rgba(255, 255, 255, 0.08)' : colors.card;
  const txt = colors.text;
  const openBasket = useCallback((kind: BasketKind) => router.push(`/(tabs)/basket?basket=${kind}` as any), [router]);
  // When Home last came into focus: its "added" bar only counts adds made on Home after this moment.
  const [homeFocusedAt, setHomeFocusedAt] = useState(() => Date.now());
  useFocusEffect(useCallback(() => { setHomeFocusedAt(Date.now()); }, []));
  const txtSec = colors.textSecondary;
  const border = isDark ? COLORS.borderGold : colors.border;
  const bg = colors.bg;
  // Bottom sheets need an opaque surface (cardBg is translucent in dark mode)
  const sheetBg = isDark ? '#18181B' : colors.card;

  const goldColor = isDark ? COLORS.gold : colors.gold;
  const goldBorderColor = isDark ? COLORS.goldBorder : 'rgba(239, 79, 95, 0.35)';
  const avatarLetters = String(user?.name || '').trim().substring(0, 2).toUpperCase();
  const goldMutedColor = isDark ? COLORS.goldMuted : 'rgba(239, 79, 95, 0.1)';
  const goldGlowShadow = isDark ? SHADOWS.goldGlow : SHADOWS.redGlow;
  // Light mode: cards, tiles and pills get a soft lift so they separate from the page (dark: none)
  const lift = surfaceLift(isDark);
  const liftSm = surfaceLift(isDark, true);
  const shadowSm = surfaceShadow(isDark, true);

  // Behind the intro: a plain page (the intro covers it). The full Home is drawn as the intro's title holds still.
  if (!introDone) return <View style={[s.container, { paddingTop: topPad, backgroundColor: bg }]} />;

  return (
    <KeyboardAvoidingView style={[s.container, { paddingTop: topPad, backgroundColor: bg }]} enabled={homeFocused}>
      <AmbientBackground />
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} scrollEventThrottle={200} onScroll={onHomeScroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={goldColor} />}>

        {/* ── NAVBAR (SWIGGY & ZOMATO ELEVATED HEADER) ── */}
        <StaggeredSection delay={0} direction="down">
        <View style={s.nav}>
          <TouchableOpacity 
            style={s.navLeft}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/profile')}
          >
            <View style={[s.avatar, { backgroundColor: cardBg, borderColor: goldBorderColor, overflow: 'hidden' }, liftSm, user?.isElite && [s.avatarElite, { borderColor: goldColor }, goldGlowShadow]]}>
              {user?.profileImage ? (
                <SafeImage
                  source={{ uri: user.profileImage }}
                  // A broken profile photo shows the user's initials, never a stock photo of someone else.
                  fallback={avatarLetters
                    ? <Text style={[s.avatarText, { color: goldColor }]}>{avatarLetters}</Text>
                    : <Ionicons name="person" size={18} color={goldColor} />}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : avatarLetters ? (
                <Text style={[s.avatarText, { color: goldColor }]}>{avatarLetters}</Text>
              ) : (
                // A guest (or a name not set yet): a person, not the old "Z" brand letter.
                <Ionicons name="person" size={18} color={goldColor} accessibilityLabel="Guest" />
              )}
            </View>
            <View>
              <Text style={[s.greeting, { color: txtSec }]}>{getGreeting()}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.userName, { color: txt }]}>{(user?.name || 'Guest').trim().split(' ')[0] || 'Guest'}</Text>
                {!!user?.isElite && (
                  <View style={[s.eliteBadge, { backgroundColor: '#D4AF7A', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }]}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#000', letterSpacing: 0.3 }}>Elite</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>

          <View style={s.navRight}>
            {/* Campus: the one entry for chats, Friends (Pulse, Spaces, Forum, Tasks, Connect), Around campus and Me.
                Hidden while the admin has Campus switched off. */}
            {campusOff ? null : (
              <DopaminePressable
                style={[s.campusPill, { backgroundColor: cardBg, borderColor: goldBorderColor }, liftSm]}
                onPress={() => router.push('/friends' as any)}
                sound="click"
                activeScale={0.92}
                accessibilityRole="button"
                accessibilityLabel="Open Campus"
              >
                <Ionicons name="people-outline" size={16} color={goldColor} />
                <Text style={[s.campusPillText, { color: goldColor }]}>Campus</Text>
              </DopaminePressable>
            )}
            <DopaminePressable 
              style={[s.navBtn, { backgroundColor: cardBg, borderColor: goldBorderColor }, liftSm]} 
              onPress={toggleTheme}
              sound="click"
              activeScale={0.9}
              accessibilityRole="button"
              accessibilityLabel={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={18} color={goldColor} />
            </DopaminePressable>
            <DopaminePressable 
              style={[s.navBtn, { backgroundColor: cardBg, borderColor: goldBorderColor }, s.profileBtn, { borderColor: goldColor }, goldGlowShadow]} 
              onPress={() => { lastUnreadCheck.current.at = 0; router.push('/notifications' as any); }}
              sound="click"
              activeScale={0.9}
              accessibilityRole="button"
              accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            >
              <Ionicons name="notifications-outline" size={18} color={goldColor} />
              {unreadCount > 0 && <BounceIn><View style={s.badge}><Text style={s.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View></BounceIn>}
            </DopaminePressable>
          </View>
        </View>
        </StaggeredSection>

        {/* ── SEARCH & VEG MODE TOGGLE (SWIGGY / ZOMATO SIGNATURE BAR) ── */}
        <StaggeredSection delay={350} direction="left">
        <View style={s.searchBarContainer}>
          <TouchableOpacity 
            activeOpacity={0.9}
            onPress={() => setIsSearchOpen(true)}
            accessibilityRole="search"
            accessibilityLabel="Search dishes and stores"
            style={[s.searchWrap, { backgroundColor: cardBg, borderColor: isDark ? goldBorderColor : LIGHT_HAIRLINE, flex: 1, marginBottom: 0 }, lift]}
          >
            <Ionicons name="search-outline" size={17} color={txtSec} />
            <RotatingSearchInput search={search} color={txt} placeholderColor={txtSec} inputStyle={s.searchInput} />
            {!!search && (
              <TouchableOpacity
                onPress={() => setSearch('')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Clear search"
              >
                <SymbolIcon name="close" style={{ fontSize: 14, fontWeight: '600', color: txtSec }} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          {/* VEG MODE Switch (Swiggy / Zomato Style) */}
          <TouchableOpacity
            activeOpacity={0.8}
            accessibilityRole="switch"
            accessibilityState={{ checked: vegOnly }}
            accessibilityLabel="Veg only"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              const nextVal = !vegOnly;
              setVegOnly(nextVal);
              setDietMode(nextVal ? 'veg' : 'all');
              if (!nextVal && filter === 'veg') setFilter('all');
            }}
            style={[
              s.vegToggleWrap,
              { backgroundColor: cardBg, borderColor: vegOnly ? '#10B981' : (isDark ? 'rgba(255,255,255,0.1)' : LIGHT_HAIRLINE) },
              vegOnly ? surfaceShadow(isDark) : lift,
            ]}
          >
            <Text style={[s.vegToggleText, { color: vegOnly ? '#10B981' : txtSec }]}>Veg</Text>
            <View style={[s.vegSwitchTrack, { backgroundColor: vegOnly ? '#10B981' : (isDark ? 'rgba(255,255,255,0.2)' : '#E2E8F0') }]}>
              <View style={[s.vegSwitchThumb, vegOnly && s.vegSwitchThumbActive]} />
            </View>
          </TouchableOpacity>
        </View>
        </StaggeredSection>

        {/* ── PROMO CAROUSEL right under the search bar (owner's choice) ── */}
        <View style={{ height: 8 }} onLayout={(e) => { carouselTop.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }} />
        {/* ── HIGH-CLASS SWIGGY/ZOMATO PROMO CAROUSEL (WITH MINIATURE ANIMATIONS & ADMIN SPOTLIGHT) ── */}
        <StaggeredSection delay={100} direction="up">
          <View onLayout={(e) => { carouselHeight.current = e.nativeEvent.layout.height; }}>
          <HighClassPromoCarousel 
            visible={carouselVisible}
            hiddenSlideIds={hiddenPromoSlides}
            featuredRestaurants={restaurants}
            onSelectRestaurant={(id) => router.push(`/restaurant/${id}` as any)}
            onSelectSlide={(slide) => {
              if (slide.id === 'gold-pass') router.push('/(tabs)/profile');
              else if (slide.id === 'biryani') {
                const wasOpen = classicFilter !== '';
                setClassicFilter('Biryani');
                scrollToNexusSoon(wasOpen);
              } else if (slide.id === 'kfc') {
                const kfc = restaurants.find((r: any) => /kfc/i.test(r?.name || ''));
                if (kfc) router.push(`/restaurant/${kfc.id || kfc._id}` as any);
                else { setSearch('KFC'); scrollToGrid(); }
              } else if (slide.id === 'campus-buddy') {
                router.push('/friends' as any);
              } else if (slide.id === 'ride') {
                router.push({ pathname: '/(tabs)/services', params: { tab: 'rides' } } as any);
              } else if (slide.id === 'stays') {
                router.push({ pathname: '/(tabs)/services', params: { tab: 'stays' } } as any);
              } else if (slide.id === 'express-canteen') {
                router.push('/category/express' as any);
              } else if (slide.id === 'welcome-benefits') {
                fetchVaultItems();
                setShowVaultModal(true);
              } else if (slide.id === 'free-cash') {
                scrollToGrid();
              }
            }}
          />
          </View>
        </StaggeredSection>

        {/* ── LIVE CAMPUS TICKER (SWIGGY / ZOMATO DEALS & PULSE) ── */}
        <StaggeredSection delay={150} direction="up">
          <View style={{ marginTop: 6, marginBottom: 2 }}>
            <CampusLiveTicker />
          </View>
        </StaggeredSection>

        {/* ── NIGHT CLOSURE (9 PM to 6 AM): say it on Home, not first at checkout ── */}
        <NightClosureBanner style={{ marginTop: 0, marginBottom: 12 }} />
        {/* Delivery slots: the next slot and its booking cutoff, one quiet line (day only) */}
        <NextSlotHint style={{ marginTop: 0, marginBottom: 10 }} />

        {/* ── FEATURE CARDS: every section, swiped sideways; most used first ── */}
        <StaggeredSection delay={200} direction="up">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.premiumCatRow}
          contentContainerStyle={s.premiumCatGrid}
          snapToInterval={CAT_CARD_W + CAT_GAP}
          decelerationRate="fast"
        >
          {homeCategories.map((c, catIdx) => (
            <BounceIn key={c.key} delay={300 + Math.min(catIdx, 3) * 80} style={{ width: CAT_CARD_W }}>
            <DopaminePressable 
              style={[
                s.premiumCatBtn, 
                { 
                  backgroundColor: cardBg, 
                  borderColor: isDark ? border : LIGHT_HAIRLINE,
                },
                lift,
              ]} 
              onPress={() => {
                if (c.key === 'food') {
                  recordSectionUse('food');
                  scrollToGrid();
                } else if (c.key === 'campusBooking') {
                  router.push('/campus-booking' as any);
                } else {
                  // Others / Services record the visit from their ?tab= link. Tester, 5 Nov 2026: "Clicking on PG Stays
                  // opens the groceries tab": the card went to the Groceries tab, which then forwarded to Services.
                  // Each card now opens its own tab directly (Deals & spin lives in Groceries, the rest in Services).
                  const hub = c.key === 'promos' || c.key === 'food' ? '/(tabs)/others' : '/(tabs)/services';
                  router.push({ pathname: hub, params: { tab: c.key } } as any);
                }
              }}
              sound="tabSwitch"
              activeScale={0.95}
              accessibilityLabel={c.label}
            >
              <SafeImage 
                source={CATEGORY_IMAGES[c.key as keyof typeof CATEGORY_IMAGES]} 
                style={{ width: '100%', height: 60 }} 
                resizeMode="cover" 
              />
              <Text style={[s.premiumCatLabel, { color: txt, marginTop: 8, marginBottom: 8 }, c.key === 'campusBooking' && { letterSpacing: 0, fontSize: CAMPUS_LABEL_SIZE }]} numberOfLines={1} adjustsFontSizeToFit={c.key === 'campusBooking'} minimumFontScale={0.85}>
                {c.label}
              </Text>
            </DopaminePressable>
            </BounceIn>
          ))}
        </ScrollView>
        </StaggeredSection>

        {/* ── CLASSICS ── (only cuisines with a dish on today's menus; hidden when none has) */}
        {!noFoodVendors && shownClassics.length > 0 && (<>
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: txt }]}>Popular dishes</Text>
          <DopaminePressable 
            style={s.manageBtn} 
            sound="click"
            onPress={() => setShowCatPrefModal(true)}
          >
            <Text style={s.manageBtnText}>Filters</Text>
          </DopaminePressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16, marginBottom: 20 }}>
          {shownClassics.map((c, i) => {
            const isActive = classicFilter === c.name;
            return (
              <DopaminePressable 
                key={i} 
                style={s.classicItem} 
                onPress={() => {
                  const wasOpen = classicFilter !== '';
                  setClassicFilter(isActive ? '' : c.name);
                  if (!isActive) scrollToNexusSoon(wasOpen);
                }}
                sound="tabSwitch"
                activeScale={0.92}
              >
                <View style={[s.classicImgWrap, shadowSm, isActive && { borderColor: COLORS.red, ...SHADOWS.redGlow }]}>
                  <SafeImage source={{ uri: c.img }} style={s.classicImg} />
                </View>
                <Text style={[s.classicName, { color: isActive ? COLORS.red : txt }]}>{c.name}</Text>
              </DopaminePressable>
            );
          })}
        </ScrollView>

        {/* ── MENU EXPLORER: Dish Discovery ── */}
        {classicFilter !== '' && (
          <Animated.View 
            onLayout={(e) => {
              nexusY.current = e.nativeEvent.layout.y;
              if (pendingNexusScroll.current) {
                pendingNexusScroll.current = false;
                scrollRef.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: true });
              }
            }}
            style={{
              opacity: classicAnim,
              transform: [
                {
                  translateY: classicAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [25, 0],
                  })
                },
                {
                  scale: classicAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  })
                }
              ]
            }}
          >
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: txt }]}>{classicFilter}</Text>
              <TouchableOpacity onPress={() => setClassicFilter('')}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.red, letterSpacing: 0.2 }}>Clear</Text>
              </TouchableOpacity>
            </View>
            <NexusExplorer
              restaurants={restaurants.filter(isHomeFoodVendor)}
              activeCategory={classicFilter}
              onSelectItem={(restaurantId) => router.push(`/restaurant/${restaurantId}` as any)}
            />
          </Animated.View>
        )}

        </>)}

        {/* ── DAILY DEALS ── */}
        <StaggeredSection delay={600} direction="up">
        <CardPressable 
          style={[s.vaultCard, { backgroundColor: cardBg }, lift]} 
          onPress={() => {
            fetchVaultItems();
            setShowVaultModal(true);
          }}
          sound="click"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
            <View style={s.vaultLeft}>
              <PulseGlow size={44} color={COLORS.gold}>
                <View style={s.vaultIcon}><Ionicons name="pricetags" size={22} color={COLORS.gold} /></View>
              </PulseGlow>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.vaultTitle, { color: txt }]} numberOfLines={1}>Daily deals</Text>
                <Text style={[s.vaultSub, { color: txtSec }]} numberOfLines={2}>
                  {vaultChecked && liveDealCount === 0 ? 'No deals right now. Check back later.' : "Today's coupons, valid until midnight"}
                </Text>
              </View>
            </View>
            {vaultChecked && liveDealCount > 0 && (
              <View style={s.vaultRight}>
                <Text style={[s.vaultUntil, { color: txtSec, marginTop: 0, marginBottom: 4 }]}>Ends in</Text>
                <VaultTimerBadge pulseAnim={pulseAnim} />
              </View>
            )}
          </View>
        </CardPressable>
        </StaggeredSection>

        {/* Recently viewed: right under Daily deals (owner's choice) */}
        <RecentlyViewed />

        {/* ── ALL RESTAURANTS: header with the live open count, then the filter chips ── */}
        <View onLayout={(e) => { gridY.current = e.nativeEvent.layout.y; }} style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: txt }]}>All restaurants</Text>
          {!loading && storeCounts.total > 0 && (
            <View
              style={[s.livePill, { backgroundColor: storeCounts.open > 0 ? (isDark ? 'rgba(16,185,129,0.14)' : '#ECFDF5') : (isDark ? 'rgba(245,158,11,0.14)' : '#FFFBEB'), borderColor: storeCounts.open > 0 ? (isDark ? 'rgba(16,185,129,0.35)' : 'transparent') : (isDark ? 'rgba(245,158,11,0.35)' : 'transparent') }, surfaceShadow(isDark, true)]}
              accessible
              accessibilityLabel={storeCounts.open > 0 ? `${storeCounts.open} of ${storeCounts.total} restaurants open now` : storeCounts.slot > 0 ? 'Restaurants are taking orders for the next delivery slot' : 'All restaurants are closed right now'}
            >
              <LiveDot color={storeCounts.open > 0 ? '#10B981' : '#F59E0B'} active={homeFocused && storeCounts.open > 0} />
              <Text maxFontSizeMultiplier={1.3} style={[s.livePillText, { color: storeCounts.open > 0 ? (isDark ? '#34D399' : '#047857') : (isDark ? '#FBBF24' : '#B45309') }]}>
                {storeCounts.open > 0 ? `${storeCounts.open} open now` : storeCounts.slot > 0 ? 'Order for the next slot' : 'Closed right now'}
              </Text>
            </View>
          )}
        </View>
        <Text style={[s.sectionSub, { color: txtSec }]}>Fresh from campus kitchens, delivered to your hostel</Text>
        <View style={{ marginTop: -4, marginBottom: 12 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: 16, paddingRight: 84, paddingVertical: 4 }}>
            {(noFoodVendors ? [] : FILTERS).filter(f => f.key === filter || chipKeysWithStores.has(f.key)).map(f => {
              const isChipActive = filter === f.key;
              const activeBg = isDark ? goldColor : COLORS.red;
              const fg = isChipActive ? (isDark ? '#000' : '#FFF') : txtSec;
              return (
                <DopaminePressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[
                    s.filterChip,
                    { backgroundColor: isChipActive ? activeBg : cardBg, borderColor: isChipActive ? activeBg : (isDark ? COLORS.borderDark : LIGHT_HAIRLINE) },
                    isChipActive ? s.filterActiveShadow : liftSm,
                  ]}
                  sound="tabSwitch"
                  activeScale={0.93}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isChipActive }}
                  accessibilityLabel={`Filter: ${f.label}`}
                >
                  <Ionicons name={f.icon} size={13} color={isChipActive ? fg : (isDark ? goldColor : COLORS.red)} />
                  <Text style={[s.filterText, { color: fg }]} maxFontSizeMultiplier={1.3}>{f.label}</Text>
                </DopaminePressable>
              );
            })}
          </ScrollView>
          {/* Edge fade: the row reads as scrollable */}
          <LinearGradient
            pointerEvents="none"
            colors={[isDark ? 'rgba(9,9,11,0)' : 'rgba(244,245,247,0)', bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.chipFade}
          />
        </View>

        {/* ── RESTAURANT GRID ── */}
        <View style={s.grid} onLayout={(e) => { gridBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}>
          {loading ? (
            <>
              <View style={{ width: '100%' }}><RestaurantCardSkeleton /></View>
              <View style={{ width: '100%' }}><RestaurantCardSkeleton /></View>
              <View style={{ width: '100%' }}><RestaurantCardSkeleton /></View>
              <View style={{ width: '100%' }}><RestaurantCardSkeleton /></View>
            </>
          ) : loadError && restaurants.length === 0 ? (
            <View style={[s.emptyFilterBox, { backgroundColor: cardBg, borderColor: isDark ? goldBorderColor : COLORS.borderLight }]}>
              <Ionicons name="cloud-offline-outline" size={34} color={txtSec} style={{ marginBottom: 8 }} />
              <Text style={[s.emptyFilterTitle, { color: txt }]}>
                {loadError === 'server' ? 'ZenWe is still starting up' : "Couldn't load restaurants"}
              </Text>
              <Text style={[s.emptyFilterSub, { color: txtSec }]}>
                {loadError === 'server'
                  ? 'This usually takes a minute or two. Tap Try again in a moment.'
                  : 'Check your connection, then pull down or tap Try again.'}
              </Text>
              <TouchableOpacity
                style={[s.resetFilterBtn, { backgroundColor: goldColor }]}
                onPress={() => { setRefreshing(true); fetchData(); }}
                activeOpacity={0.85}
              >
                <Text style={[s.resetFilterBtnText, { color: isDark ? '#000' : '#fff' }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : filtered.length === 0 ? (
            <View style={[s.emptyFilterBox, { backgroundColor: cardBg, borderColor: isDark ? goldBorderColor : COLORS.borderLight }]}>
              <Ionicons name="restaurant-outline" size={34} color={txtSec} style={{ marginBottom: 8 }} />
              {noFoodVendors ? (
                <>
                  <Text style={[s.emptyFilterTitle, { color: txt }]}>Restaurants are joining ZenWe soon</Text>
                  <Text style={[s.emptyFilterSub, { color: txtSec }]}>Meanwhile, shop pickles and groceries from campus stores.</Text>
                  <TouchableOpacity
                    style={[s.resetFilterBtn, { backgroundColor: goldColor }]}
                    onPress={() => router.push({ pathname: '/(tabs)/others', params: { tab: 'food' } } as any)}
                    activeOpacity={0.85}
                  >
                    <Text style={[s.resetFilterBtnText, { color: isDark ? '#000' : '#fff' }]}>Shop groceries</Text>
                  </TouchableOpacity>
                </>
              ) : (<>
              <Text style={[s.emptyFilterTitle, { color: txt }]}>No restaurants match</Text>
              <Text style={[s.emptyFilterSub, { color: txtSec }]}>
                {(() => {
                  const parts: string[] = [];
                  if (vegOnly) parts.push('Veg only');
                  if (filter !== 'all') parts.push(FILTERS.find(f => f.key === filter)?.label || filter);
                  if (search) parts.push(`"${search}"`);
                  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
                  return parts.length
                    ? `Nothing matches ${list}. Clear the filters to see every restaurant.`
                    : 'No restaurants are listed right now. Pull down to refresh.';
                })()}
              </Text>
              {(vegOnly || filter !== 'all' || !!search || classicFilter !== '') && (
                <TouchableOpacity
                  style={[s.resetFilterBtn, { backgroundColor: goldColor }]}
                  onPress={() => {
                    setFilter('all');
                    setClassicFilter('');
                    setSearch('');
                    if (vegOnly) {
                      setVegOnly(false);
                      setDietMode('all');
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={[s.resetFilterBtnText, { color: isDark ? '#000' : '#fff' }]}>Clear filters</Text>
                </TouchableOpacity>
              )}
              </>)}
            </View>
          ) : (
            filtered.slice(0, gridLimit).map((r, i) => {
            const id = r._id || r.id;
            // Real data only: no invented ratings, ETAs, offers or prices
            const rating = Number(r.rating) || 0;
            // Measured from real deliveries only (utils/storeEta): seed times never show as fact
            const time: string | null = storeEtaText(r);
            const img = r.imageUrl || r.image || '';

            // Open/Closed status from the server (vendor toggle + operating hours, IST)
            const isOpen = isRestaurantOpenNow(r);
            // Closed now but taking orders for the next delivery slot: no dimming, the chip says so.
            const slotOrders = !isOpen && takesSlotOrders(r);
            const opensAtLabel = !isOpen ? formatOpensAt(r.opensAt) : null;

            const activeOffer: string | null = r.promoOffer || null;
            const cuisineText = Array.isArray(r.tags) && r.tags.length
              ? r.tags.slice(0, 4).map((t: any) => String(t)).join(' · ')
              : (r.cuisine || r.description || '');
            const areaText = shortArea(r.location || r.address || '');
            const slotText: string | null = isOpen && r.nextSlotLabel ? String(r.nextSlotLabel) : null;
            const isFav = isFavoriteIn(favorites, id);
            const isPremium = r.subscriptionTier === 'premium' || r.isFeatured;
            // "New" only for a recently listed store; an old store without ratings shows no badge.
            const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
            const isNewStore = Number.isFinite(createdMs) && isNewStoreRule(r);

            return (
              <StaggeredSection 
                key={id || i} 
                delay={50 + (i % 6) * 60} 
                direction="up"
                style={{ width: '100%' }}
              >
              <CardPressable 
                accessibilityRole="button"
                accessibilityLabel={`${r.name || 'Store'}${isOpen ? '' : opensAtLabel ? `, closed, opens ${opensAtLabel}` : ', closed'}${cuisineText ? `, ${cuisineText}` : ''}`}
                accessibilityHint="Opens the menu"
                style={[
                  s.rCard, 
                  { 
                    backgroundColor: cardBg, 
                    borderColor: r.isFeatured ? '#F59E0B' : (isDark ? 'rgba(255,255,255,0.10)' : LIGHT_HAIRLINE), 
                    borderWidth: r.isFeatured ? 1.5 : 1, 
                    width: '100%', 
                    marginHorizontal: 0,
                    ...(!isDark && !r.isFeatured ? lift : {}),
                    ...(r.isFeatured ? { shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 4 } : {})
                  }
                ]} 
                onPress={() => router.push(`/restaurant/${id}` as any)}
                sound={isPremium ? 'premiumRestaurantTransition' : 'click'}
              >
                <View style={s.rImgWrap} pointerEvents="box-none">
                  <SafeImage source={{ uri: img }} style={s.rImg} placeholderIcon="storefront-outline" />
                  
                  {/* Favorite Toggle Button */}
                  <DopaminePressable 
                    style={s.heartBtn}
                    onPress={() => toggleFavorite(id)}
                    sound="click"
                    activeScale={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={isFav ? `Remove ${r.name || 'this restaurant'} from favourites` : `Add ${r.name || 'this restaurant'} to favourites`}
                  >
                    <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={16} color={isFav ? '#EF4444' : '#6B7280'} />
                  </DopaminePressable>

                  {/* Open/Closed status badge with pulsing live dot */}
                  <View style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    backgroundColor: isOpen ? 'rgba(16,185,129,0.92)' : 'rgba(100,100,100,0.88)',
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                    borderRadius: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 3.5
                  }}>
                    <Animated.View style={{
                      width: 5,
                      height: 5,
                      borderRadius: 2.5,
                      backgroundColor: '#fff',
                      opacity: isOpen ? pulseAnim : 0.6
                    }} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff', letterSpacing: 0.2 }}>
                      {isOpen ? 'Open' : 'Closed'}
                    </Text>
                  </View>

                  {/* Featured badge: only for stores the admin flagged as featured (utils/promoLabel) */}
                  {!!featuredLabel(r) && (
                    <LinearGradient
                      colors={['#F59E0B', '#D97706']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 36,
                        paddingHorizontal: 6,
                        paddingVertical: 2.5,
                        borderRadius: 6,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 2,
                        shadowColor: '#F59E0B',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.4,
                        shadowRadius: 4,
                        elevation: 3
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#000', letterSpacing: 0.2 }}>
                        {featuredLabel(r)}
                      </Text>
                    </LinearGradient>
                  )}
 
                  {!!time && isOpen && (
                    <View style={s.timeChip}><Text style={s.timeText}>{time}</Text></View>
                  )}
                  {!isOpen && (
                    <View style={s.timeChip}><Text style={s.timeText}>{slotOrders ? 'Order for next slot' : opensAtLabel ? `Opens ${opensAtLabel}` : 'Closed now'}</Text></View>
                  )}
                  {!isOpen && !slotOrders && (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 16 }]} />
                  )}
                  {activeOffer && (
                    <View style={[
                      s.offerRibbon, 
                      r.isFeatured && { backgroundColor: '#F59E0B' }
                    ]}>
                      <Text style={[s.offerText, r.isFeatured && { color: '#000', fontWeight: '700' }]} numberOfLines={1}>
                        {activeOffer}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={s.rInfo}>
                  <View style={s.rTitleRow}>
                    <Text style={[s.rName, { color: txt }]} numberOfLines={2}>{r.name}</Text>
                    {rating > 0 ? (
                      <View style={s.ratingBadge}>
                        <Text style={s.ratingText} maxFontSizeMultiplier={1.3}>{rating.toFixed(1)}</Text>
                        <Text style={{ fontSize: 12, color: '#fff', fontWeight: '700' }}>★</Text>
                      </View>
                    ) : isNewStore ? (
                      <View style={s.ratingBadge}>
                        <Text style={s.ratingText} maxFontSizeMultiplier={1.3}>New</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Cuisine (from the restaurant's own tags) */}
                  {!!cuisineText && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                      <Text style={[s.rCuisine, { color: txtSec, flex: 1 }]} numberOfLines={1}>
                        {cuisineText}
                      </Text>
                    </View>
                  )}
 
                  {/* Area and next delivery slot: real data only (owner, 6 Nov 2026: wide cards, full photo + full name) */}
                  {(!!areaText || !!slotText) && (
                    <View style={s.rMetaRow}>
                      {!!areaText && (
                        <View style={s.rMetaLeft}>
                          <Ionicons name="location-outline" size={13} color={txtSec} />
                          <Text style={[s.rMetaText, { color: txtSec, flexShrink: 1 }]} numberOfLines={1}>{areaText}</Text>
                        </View>
                      )}
                      {!!slotText && (
                        <View style={s.rMetaRight}>
                          <Ionicons name="time-outline" size={13} color={COLORS.greenRating} />
                          <Text style={[s.rMetaText, { color: COLORS.greenRating, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1} accessibilityLabel={`Next delivery ${slotText}`}>{slotText}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Zomato style dashed offer line */}
                  {activeOffer && (
                    <View style={{ 
                      paddingTop: 6, 
                      borderTopWidth: 1, 
                      borderStyle: 'dashed', 
                      borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)', 
                      flexDirection: 'row', 
                      alignItems: 'center', 
                      gap: 4, 
                      marginTop: 4 
                    }}>
                      <Ionicons name="pricetag-outline" size={11} color={txtSec} />
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                        {activeOffer}
                      </Text>
                    </View>
                  )}
                </View>
              </CardPressable>
              </StaggeredSection>
            );
          })
        )}
        </View>

        {/* The grid ends here: one tap shows the rest (the sections below stay reachable) */}
        {!loading && filtered.length > gridLimit && (
          <TouchableOpacity
            style={[s.resetFilterBtn, { alignSelf: 'center', marginTop: 12, marginBottom: 8, backgroundColor: cardBg, borderWidth: 1, borderColor: isDark ? goldBorderColor : LIGHT_HAIRLINE }, lift]}
            onPress={() => { scrollYBeforeShowAll.current = homeScrollY.current; setGridLimit(filtered.length); }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Show all ${filtered.length} restaurants`}
          >
            <Text style={[s.resetFilterBtnText, { color: goldColor }]}>Show all {filtered.length} restaurants</Text>
          </TouchableOpacity>
        )}
        {/* Expanded: one tap goes back to the short list, at the spot the user left */}
        {!loading && gridLimit > GRID_PAGE && filtered.length > GRID_PAGE && (
          <TouchableOpacity
            style={[s.resetFilterBtn, { alignSelf: 'center', marginTop: 12, marginBottom: 8, backgroundColor: cardBg, borderWidth: 1, borderColor: isDark ? goldBorderColor : LIGHT_HAIRLINE, flexDirection: 'row', alignItems: 'center', gap: 6 }, lift]}
            onPress={() => {
              const back = scrollYBeforeShowAll.current;
              setGridLimit(GRID_PAGE);
              scrollYBeforeShowAll.current = null;
              if (back != null) setTimeout(() => scrollRef.current?.scrollTo({ y: back, animated: true }), 60);
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Show fewer restaurants"
          >
            <Ionicons name="chevron-up" size={16} color={goldColor} />
            <Text style={[s.resetFilterBtnText, { color: goldColor }]}>Show fewer</Text>
          </TouchableOpacity>
        )}


        {/* ── SECTION BREATHING SPACE ── (stalls near campus live on the Local tab: owner, 3 Nov 2026, "why twice") */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Daily deals modal ── */}
      <Modal visible={showVaultModal} animationType="slide" transparent={true} onRequestClose={() => setShowVaultModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContentBox, { backgroundColor: sheetBg }]}>
            <Text style={[s.modalTitle, { color: txt }]}>Today's deals</Text>
            <Text style={[s.modalSubtitle, { color: txtSec }]}>Claim a coupon. Valid until midnight.</Text>

            {loadingVault ? (
              <ActivityIndicator size="large" color={goldColor} style={{ marginVertical: 32 }} />
            ) : vaultError ? (
              <TouchableOpacity onPress={() => fetchVaultItems()} style={{ padding: 32, alignItems: 'center' }} activeOpacity={0.8}>
                <Ionicons name="alert-circle-outline" size={32} color={txtSec} style={{ marginBottom: 12 }} />
                <Text style={{ color: txtSec, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>Couldn't load today's deals. Tap to try again.</Text>
              </TouchableOpacity>
            ) : vaultItems.length > 0 ? (
              <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
                {vaultItems.map(item => {
                  const streakReq = Number(item.streakRequirement) || 0;
                  const userStreak = Number(user?.streakCount) || 0;
                  const hasStreak = userStreak >= streakReq;
                  const remaining = Number(item.remainingCount);
                  const showRemaining = item.remainingCount !== null && item.remainingCount !== undefined && item.remainingCount !== '' && Number.isFinite(remaining) && remaining >= 0;
                  // No photo: the neutral placeholder (never a stock picture that looks like the deal)
                  const itemImg = item.imageUrl || item.image || '';
                  return (
                    <View key={item.id} style={[s.vaultItemCard, { borderColor: border }]}>
                      <SafeImage source={{ uri: itemImg }} style={s.vaultItemImg} placeholderIcon="pricetag-outline" />
                      <View style={s.vaultItemInfo}>
                        <Text style={[s.vaultItemName, { color: txt }]}>{item.name}</Text>
                        {!!item.description && <Text style={[s.vaultItemDesc, { color: txtSec }]}>{item.description}</Text>}
                        {showRemaining && <Text style={[s.vaultItemStock, { color: COLORS.red }]}>{remaining === 0 ? 'None left' : `${remaining} left`}</Text>}
                        
                        {streakReq > 0 && (
                          <View style={s.vaultItemReqRow}>
                            <View style={[s.reqBadge, { backgroundColor: hasStreak ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }]}>
                              <Text style={[s.reqBadgeText, { color: hasStreak ? COLORS.emerald : '#EF4444' }]}>
                                {hasStreak ? `${streakReq}-day streak` : `Needs a ${streakReq}-day streak (you have ${userStreak})`}
                              </Text>
                            </View>
                          </View>
                        )}

                        {hasStreak ? (
                          <TouchableOpacity 
                            style={[s.claimBtn, { backgroundColor: goldColor }]}
                            onPress={() => handleClaimVault(item.id)}
                            disabled={claimingItemId === item.id}
                          >
                            {claimingItemId === item.id ? (
                              <ActivityIndicator size="small" color={isDark ? "#000" : "#fff"} />
                            ) : (
                              <Text style={[s.claimBtnText, { color: isDark ? '#000' : '#fff' }]}>Claim deal</Text>
                            )}
                          </TouchableOpacity>
                        ) : (
                          <View style={s.lockedBtn}>
                            <Text style={s.lockedBtnText}>Locked</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Ionicons name="pricetags-outline" size={32} color={txtSec} style={{ marginBottom: 12 }} />
                <Text style={{ color: txtSec, fontSize: 12, fontWeight: '700' }}>No deals today. Check back tomorrow.</Text>
              </View>
            )}

            <DopaminePressable 
              style={s.modalCloseBtn} 
              onPress={() => setShowVaultModal(false)}
              sound="click"
            >
              <Text style={s.modalCloseText}>Close</Text>
            </DopaminePressable>
          </View>
        </View>
      </Modal>

      {/* ── CATEGORY PREFERENCE & FILTER MODAL ── */}
      <Modal visible={showCatPrefModal} animationType="slide" transparent={true} onRequestClose={() => setShowCatPrefModal(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowCatPrefModal(false)} />
          <View style={[s.modalContentBox, { backgroundColor: sheetBg, borderColor: goldBorderColor, borderWidth: 1 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 6 }}>
              <Text style={[s.modalTitle, { color: txt, marginBottom: 0 }]}>Filters</Text>
              <TouchableOpacity onPress={() => setShowCatPrefModal(false)} style={{ padding: 4 }} accessibilityRole="button" accessibilityLabel="Close filters">
                <SymbolIcon name="close" style={{ fontSize: 18, color: txtSec, fontWeight: '600' }} />
              </TouchableOpacity>
            </View>
            <Text style={[s.modalSubtitle, { color: txtSec, marginBottom: 14, textAlign: 'left', alignSelf: 'stretch' }]}>Diet and cuisine shortcuts</Text>

            <ScrollView style={{ width: '100%', maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {/* Dietary Fast Switcher */}
              <View style={{ marginBottom: 16, padding: 12, borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC', borderWidth: 1, borderColor: border }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: goldColor, letterSpacing: 0.2, marginBottom: 8 }}>Diet</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      alignItems: 'center',
                      backgroundColor: filter === 'all' && !vegOnly ? (isDark ? goldColor : COLORS.red) : 'transparent',
                      borderWidth: 1,
                      borderColor: filter === 'all' && !vegOnly ? 'transparent' : border,
                    }}
                    onPress={() => {
                      setFilter('all');
                      if (vegOnly) {
                        setVegOnly(false);
                        setDietMode('all');
                      }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: filter === 'all' && !vegOnly ? (isDark ? '#000' : '#FFF') : txt }}>All restaurants</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      alignItems: 'center',
                      backgroundColor: filter === 'veg' ? '#10B981' : 'transparent',
                      borderWidth: 1,
                      borderColor: filter === 'veg' ? 'transparent' : border,
                    }}
                    onPress={() => {
                      // The real pure-veg filter (the "Pure veg" chip); the Veg toggle in the search bar shows every
                      // restaurant with at least one veg dish.
                      setFilter('veg');
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: filter === 'veg' ? '#FFF' : txt }}>Pure veg only</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Quick Jump Category Cards */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: txtSec, letterSpacing: 0.2, marginBottom: 8 }}>Popular cuisines</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {shownClassics.map((c, i) => {
                  const isSelected = classicFilter === c.name;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 10,
                        backgroundColor: isSelected ? (isDark ? goldColor : COLORS.red) : (isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9'),
                        borderWidth: 1,
                        borderColor: isSelected ? 'transparent' : border,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                      }}
                      onPress={() => {
                        const wasOpen = classicFilter !== '';
                        setClassicFilter(isSelected ? '' : c.name);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                        setShowCatPrefModal(false);
                        if (!isSelected) scrollToNexusSoon(wasOpen);
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '600', color: isSelected ? (isDark ? '#000' : '#FFF') : txt }}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <DopaminePressable 
              style={s.modalCloseBtn} 
              onPress={() => setShowCatPrefModal(false)}
              sound="click"
            >
              <Text style={s.modalCloseText}>Done</Text>
            </DopaminePressable>
          </View>
        </View>
      </Modal>

      {/* ── SEARCH OVERLAY DRAWER ── */}
      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      {/* ── FLOATING BOTTOM BASKET BAR and the floating basket button (components/FloatingBasket; a basket change
          re-renders only them) ── */}
      <FloatingBasketBar isDark={isDark} txt={txt} onOpen={openBasket} focusedAt={homeFocusedAt} />
      <FloatingBasketButton onPress={() => router.push('/(tabs)/basket' as any)} />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  campusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1 },
  campusPillText: { fontSize: 13, fontWeight: '600' },
  container: { 
    flex: 1, 
    paddingTop: Platform.OS === 'android' ? 40 : 50,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  // Nav
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },
  navLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: COLORS.bgCard, borderWidth: 1.5, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' },
  avatarElite: { borderColor: COLORS.gold, ...SHADOWS.goldGlow },
  avatarText: { fontSize: 13, fontWeight: '700', color: COLORS.gold },
  greeting: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  userName: { fontSize: 18, fontWeight: '700', letterSpacing: -0.5 },
  eliteBadge: { backgroundColor: COLORS.gold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  eliteBadgeText: { fontSize: 12, fontWeight: '700', color: '#000', letterSpacing: 0.3 },
  navRight: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  goldNavBadge: { borderRadius: 12, overflow: 'hidden' },
  goldNavBadgeGradient: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12 },
  goldNavBadgeText: { fontSize: 12, fontWeight: '700', color: '#000', letterSpacing: 0.8 },
  walletNavBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 4.5, borderRadius: 12, borderWidth: 1 },
  walletNavText: { fontSize: 12, fontWeight: '700' },
  navBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.goldBorder },
  profileBtn: { borderColor: COLORS.gold, ...SHADOWS.goldGlow },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  // Hero
  heroWrap: { marginHorizontal: 16, borderRadius: RADIUS.hero, overflow: 'hidden', height: 220, marginBottom: 16 },
  heroImg: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  heroContent: { flex: 1, justifyContent: 'center', padding: 24, zIndex: 2 },
  heroTag: { fontSize: 12, fontWeight: '700', color: COLORS.gold, letterSpacing: 0.3, marginBottom: 8 },
  heroTitle: { fontSize: 28, fontWeight: '700', color: '#fff', fontStyle: 'italic', lineHeight: 30 },
  heroSub: { fontSize: 28, fontWeight: '700', color: COLORS.gold, fontStyle: 'italic', lineHeight: 30, marginBottom: 8 },
  heroDesc: { fontSize: 12, fontWeight: '700', color: '#aaa', letterSpacing: 0.3, marginBottom: 16, maxWidth: 260 },
  heroCta: { backgroundColor: COLORS.gold, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 30, alignSelf: 'flex-start', ...SHADOWS.goldGlow },
  heroCtaText: { fontSize: 12, fontWeight: '700', color: '#000', letterSpacing: 0.3 },
  heroDots: { position: 'absolute', bottom: 14, left: 24, flexDirection: 'row', gap: 4, zIndex: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 22, backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  // Categories
  catRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  catBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: COLORS.borderDark },
  catIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.goldMuted, borderWidth: 1, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  // Search & Veg Mode Bar
  searchBarContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, gap: 8, marginBottom: 16 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderWidth: 1.5, gap: 8 },
  searchInput: { flex: 1, fontSize: 12, fontWeight: '600', padding: 0 },
  vegToggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5 },
  vegToggleText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  vegSwitchTrack: { width: 32, height: 18, borderRadius: 9, padding: 2, justifyContent: 'center' },
  vegSwitchThumb: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#94A3B8' },
  vegSwitchThumbActive: { transform: [{ translateX: 14 }], backgroundColor: '#FFFFFF' },
  // Classics
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  sectionSub: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, paddingHorizontal: 16, marginBottom: 12, marginTop: -4 },
  manageBtn: { backgroundColor: COLORS.bgCard, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: COLORS.borderDark },
  manageBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, letterSpacing: 0.3 },
  classicItem: { alignItems: 'center', marginRight: 16, width: 70 },
  classicImgWrap: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: COLORS.gold, overflow: 'hidden', marginBottom: 6, ...SHADOWS.goldGlow },
  classicImg: { width: '100%', height: '100%' },
  classicName: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, textAlign: 'center' },
  // Vault
  vaultCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, padding: 16, borderRadius: 28, borderWidth: 1, borderColor: COLORS.goldBorder, marginBottom: 24 },
  vaultLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, marginRight: 12 },
  vaultIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#000', borderWidth: 1, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' },
  vaultTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  vaultSub: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginTop: 2 },
  vaultRight: { alignItems: 'flex-end', flexShrink: 0 },
  vaultTimerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.goldMuted, borderWidth: 1, borderColor: COLORS.goldBorder, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  vaultDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.gold },
  vaultTimer: { fontSize: 12, fontWeight: '700', color: COLORS.gold, fontVariant: ['tabular-nums'] },
  vaultUntil: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginTop: 4 },
  // Filters
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, marginRight: 8 },
  filterActive: { backgroundColor: COLORS.red },
  filterActiveShadow: Platform.select({
    web: { boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.12), 0px 4px 10px rgba(0, 0, 0, 0.10)' },
    default: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.16, shadowRadius: 6, elevation: 3 },
  }) as any,
  chipFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 28 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  livePillText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  filterText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, letterSpacing: 0.3 },
  filterTextActive: { color: '#fff' },
  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, justifyContent: 'space-between', rowGap: 12 },
  rCard: { width: '100%', borderRadius: 16, overflow: 'hidden', ...SHADOWS.card },
  rImgWrap: { width: '100%', aspectRatio: 2.4, position: 'relative' }, // owner 7 Nov: a bit smaller than the 6 Nov medium (2)
  rImg: { width: '100%', height: '100%' },
  heartBtn: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  promotedBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  promotedText: { fontSize: 12, fontWeight: '700', color: '#fff', letterSpacing: 0.3 },
  timeChip: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 7, paddingVertical: 3.5, borderRadius: 6 },
  timeText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  offerRibbon: { position: 'absolute', bottom: 8, left: 0, backgroundColor: COLORS.blueOffer, paddingHorizontal: 8, paddingVertical: 4, borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  offerText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  rInfo: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 9 },
  rTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rName: { fontSize: 14, fontWeight: '800', color: '#111', flex: 1, marginRight: 8, lineHeight: 19 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: COLORS.greenRating, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  ratingText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  rCuisine: { fontSize: 12, color: '#888', fontWeight: '600' },
  rMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.25)' },
  rMetaLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
  rMetaRight: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, maxWidth: '60%' },
  rMetaText: { fontSize: 12, fontWeight: '600' },
  // BlockWars & Modals styles
  blockwarsBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 20 },
  blockwarsIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: COLORS.goldMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.goldBorder },
  blockwarsTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  blockwarsSub: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, marginTop: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContentBox: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, height: '80%', alignItems: 'center' },
  modalTitle: { fontSize: 14, fontWeight: '700', letterSpacing: 0.3, marginBottom: 6 },
  modalSubtitle: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 0.3, marginBottom: 20, textAlign: 'center' },
  modalCloseBtn: { width: '100%', paddingVertical: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  modalCloseText: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, letterSpacing: 0.3 },

  vaultItemCard: { flexDirection: 'row', padding: 12, borderRadius: 20, borderWidth: 1, marginBottom: 12 },
  vaultItemImg: { width: 80, height: 80, borderRadius: 12, marginRight: 12 },
  vaultItemInfo: { flex: 1, justifyContent: 'space-between' },
  vaultItemName: { fontSize: 12, fontWeight: '700' },
  vaultItemDesc: { fontSize: 12, fontWeight: '600', marginVertical: 2 },
  vaultItemStock: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  vaultItemReqRow: { flexDirection: 'row', marginBottom: 8 },
  reqBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  reqBadgeText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  claimBtn: { paddingVertical: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  claimBtnText: { fontSize: 12, fontWeight: '700', color: '#000', letterSpacing: 0.3 },
  lockedBtn: { paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  lockedBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },

  challengeCardLayout: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, marginBottom: 20, alignItems: 'center' },
  challengeEmoji: { fontSize: 32 },
  challengeTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  challengeDesc: { fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  challengeReward: { fontSize: 12, fontWeight: '700', color: COLORS.gold, letterSpacing: 0.3 },

  leaderboardTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginBottom: 10 },
  leaderboardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
  rankText: { fontSize: 12, fontWeight: '700', width: 24 },
  blockName: { fontSize: 12, fontWeight: '700' },
  scoreVal: { fontSize: 12, fontWeight: '700' },

  // Separate Hero Card & Premium Categories Grid
  heroCarouselCard: {
    marginHorizontal: 16,
    borderRadius: 28,
    overflow: 'hidden',
    marginBottom: 16,
    ...SHADOWS.card,
  },
  heroCarousel: {
    height: 200,
  },
  premiumCatRow: {
    marginTop: 16,
    marginBottom: 20,
  },
  premiumCatGrid: {
    paddingLeft: 16,
    // The last card can scroll clear of the floating basket button (54 wide, 14 from the edge).
    paddingRight: 84,
    // Room for the cards' shadow inside the scroll row.
    paddingTop: 2,
    paddingBottom: 6,
    gap: CAT_GAP,
  },
  premiumCatBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    paddingBottom: 8,
  },
  premiumCatIconOuter: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumCatIconImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  premiumCatLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  // Empty Filter State
  emptyFilterBox: {
    width: '100%',
    padding: 32,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  emptyFilterTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  emptyFilterSub: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 14,
    maxWidth: 260,
    marginBottom: 16,
  },
  resetFilterBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetFilterBtnText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
// BUST_CACHE_2026_07_19_00_42
// BUST_CACHE_2026_07_19_00_42
