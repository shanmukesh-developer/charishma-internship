import * as Haptics from 'expo-haptics';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl, FlatList, Dimensions, Platform, Modal, ActivityIndicator, Alert, Animated, Linking, BackHandler, Vibration } from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from '../../components/SafeImage';
import { useLiveSync, hasType } from '../../utils/useLiveSync';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect, useIsFocused } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS, RADIUS } from '../../constants/theme';
import { API_URL, ENDPOINTS } from '../../constants/api';
import { useAuth } from '../../context/AuthContext';
import { useCartState } from '../../context/CartContext';
import { useTheme } from '../../context/ThemeContext';
import { useDietary } from '../../context/DietaryContext';
import { apiFetch } from '../../utils/auth';
import { readCache, writeCache, peekCache, RESTAURANTS_CACHE_KEY, useSWRJson } from '../../utils/swrCache';
import NexusExplorer from '../../components/NexusExplorer';
import SearchOverlay from '../../components/SearchOverlay';
import PromoCarousel from '../../components/PromoCarousel';
import HighClassPromoCarousel from '../../components/HighClassPromoCarousel';
import CampusLiveTicker from '../../components/CampusLiveTicker';
import CampusBitesSection from '../../components/CampusBitesSection';
import { isLocalVendor } from '../../utils/localVendor';
import RecentlyViewed from '../../components/RecentlyViewed';
import { useWorldTransition } from '../../context/WorldTransitionContext';
import AmbientBackground from '../../components/AmbientBackground';
import DopaminePressable, { CardPressable, ActionPressable } from '../../components/DopaminePressable';
import { StaggeredSection, RestaurantCardSkeleton, PulseGlow, BounceIn, FloatingPulse } from '../../components/AnimatedSection';
import NightClosureBanner from '../../components/NightClosureBanner';
import { featuredLabel } from '../../utils/promoLabel';
import ZenvyEcosystemGrid from '../../components/ZenvyEcosystemGrid';
import SafeImage from '../../components/SafeImage';
import { Ionicons } from '@expo/vector-icons';
import { formatINR, istHour, plural } from '../../utils/format';

const VaultTimerBadge = ({ pulseAnim }: { pulseAnim: any }) => {
  const [vaultTimer, setVaultTimer] = useState('00:00:00');
  const isFocused = useIsFocused();
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
    <View style={StyleSheet.create({ vaultTimerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 } }).vaultTimerWrap}>
      <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', shadowColor: '#10B981', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8 }, { opacity: pulseAnim }]} />
      <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] }}>{vaultTimer}</Text>
    </View>
  );
};

// Swiggy/Zomato style rotating search placeholder. Lives in its own component so the 3.5 s tick
// re-renders one TextInput instead of the whole home screen (it used to re-filter every restaurant).
const SEARCH_PLACEHOLDERS = [
  'Search for biryani…',
  'Search for pizza…',
  'Search for dosa and chai…',
  'Search for cold coffee and shakes…',
  'Search for burgers and fries…',
];
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

const { width: SW } = Dimensions.get('window');

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'veg', label: 'Veg' },
  { key: 'under99', label: 'Under ₹99' },
  { key: 'topRated', label: 'Rated 4.5+' },
  { key: 'express', label: 'Under 20 min' },
  { key: 'premium', label: 'Featured' },
  { key: 'budget', label: 'Under ₹150' },
  { key: 'jain', label: 'Jain' },
  { key: 'eggless', label: 'Eggless' },
];

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


const CATEGORIES = [
  { key: 'food', label: 'Food' },
  { key: 'basket', label: 'Shopping list' },
  { key: 'services', label: 'Tech & Repairs' },
  { key: 'rides', label: 'Rides' },
];

const CATEGORY_IMAGES = {
  food: { uri: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&q=80' },
  basket: { uri: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&q=80' },
  services: { uri: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=200&q=80' },
  rides: { uri: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=200&q=80' },
};

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

// Restaurant types shown in the Home food list and the Classics explorer
const HOME_FOOD_TYPES = ['FOOD', 'RESTAURANT', 'CAFE', 'BAKERY', 'SWEETS', 'DESSERT', 'DESSERTS', 'DRINKS', 'MESS'];
// CampusBites stalls live in their own section (CampusBitesSection: ADD to basket, the stall delivers, COD), not this grid
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

/** Floating "N items added" bar: reads the basket totals itself so an ADD doesn't re-render the whole Home screen. */
const HomeFloatingCart = React.memo(function HomeFloatingCart({ isDark, txt, onOpen }: { isDark: boolean; txt: string; onOpen: () => void }) {
  const { totalItems, totalPrice } = useCartState();
  if (!(totalItems > 0)) return null;
  return (
    <View style={s.floatingCartWrap} pointerEvents="box-none">
      <TouchableOpacity
        activeOpacity={0.92}
        style={[s.floatingCartBar, { backgroundColor: isDark ? '#1C1917' : '#FFFFFF', borderColor: isDark ? COLORS.gold : COLORS.red }]}
        onPress={onOpen}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={[s.floatingCartBadge, { backgroundColor: isDark ? COLORS.gold : COLORS.red }]}>
            <Text style={{ fontSize: 12, fontWeight: '900', color: isDark ? '#000' : '#FFF' }}>{totalItems}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.floatingCartLabel, { color: txt }]} numberOfLines={1}>
              {plural(totalItems, 'item')} added
            </Text>
            <Text style={[s.floatingCartSub, { color: isDark ? COLORS.gold : COLORS.red }]}>
              {formatINR(totalPrice)} subtotal
            </Text>
          </View>
        </View>
        <View style={[s.floatingCartCta, { backgroundColor: isDark ? COLORS.gold : COLORS.red }]}>
          <Text style={[s.floatingCartCtaText, { color: isDark ? '#000' : '#FFF' }]}>View basket</Text>
          <Text style={{ fontSize: 14, color: isDark ? '#000' : '#FFF', fontWeight: '900' }}>›</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
});

export default function HomeScreen() {
  // Keyboard lift only while Home is the visible tab (it stays mounted under other screens).
  const homeFocused = useIsFocused();
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { isDark, toggleTheme, colors } = useTheme();
  const { triggerTransition } = useWorldTransition();
  const scrollRef = useRef<ScrollView>(null);
  // The promo carousel pauses its auto-advance and card animations once it is scrolled off-screen
  // The carousel sits below the stores: it animates only while some of it is on screen.
  const carouselTop = useRef(0);
  const carouselHeight = useRef(0);
  const [carouselVisible, setCarouselVisible] = useState(false);
  const carouselVisibleRef = useRef(false);
  // The restaurant grid renders in pages of 12 (it sits inside this ScrollView, so it cannot be a
  // virtualized list): first paint mounts 12 cards instead of ~60, more mount as the user nears the end.
  const GRID_PAGE = 12;
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  const growingGrid = useRef(false);
  const gridBottom = useRef(0);
  const onHomeScroll = useCallback((e: any) => {
    const ne = e?.nativeEvent || {};
    const y = ne.contentOffset?.y || 0;
    // Near the bottom of the grid (not of the page: other sections follow it)
    const nearEnd = gridBottom.current > 0 && y + (ne.layoutMeasurement?.height || 0) > gridBottom.current - 900;
    if (nearEnd && !growingGrid.current) {
      growingGrid.current = true;
      setGridLimit((n) => n + GRID_PAGE);
      setTimeout(() => { growingGrid.current = false; }, 250);
    }
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
  const [loadError, setLoadError] = useState<false | 'server' | 'network'>(false);
  // "Rides" shows only while Co-Ride has an upcoming ride (same check as the Others tab).
  const sectionsSWR = useSWRJson<{ sections?: Record<string, { live?: boolean }> }>('/api/config/sections', { freshMs: 60 * 1000 });
  const homeCategories = React.useMemo(
    () => CATEGORIES.filter((c) => c.key !== 'rides' || sectionsSWR.data?.sections?.coride?.live !== false),
    [sectionsSWR.data],
  );

  // Search Overlay State
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Vault and Block challenges Modal States
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [loadingVault, setLoadingVault] = useState(false);
  const [vaultError, setVaultError] = useState(false);
  const [claimingItemId, setClaimingItemId] = useState<string | null>(null);

  const [showBlockModal, setShowBlockModal] = useState(false);
  const [activeChallenge, setActiveChallenge] = useState<any>(null);
  const [blockLeaderboard, setBlockLeaderboard] = useState<any[]>([]);
  const [loadingBlock, setLoadingBlock] = useState(false);
  const [showCatPrefModal, setShowCatPrefModal] = useState(false);

  // Zomato-range luxury animations
  const classicAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // Favorites state and logic
  const [favorites, setFavorites] = useState<string[]>([]);
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

  useEffect(() => {
    (async () => {
      try {
        const favs = await AsyncStorage.getItem('zenvy_favorites');
        if (favs) {
          const parsed = JSON.parse(favs);
          if (Array.isArray(parsed)) setFavorites(parsed);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const toggleFavorite = async (id: string) => {
    try {
      const favsStr = await AsyncStorage.getItem('zenvy_favorites');
      let favs = [];
      try {
        favs = favsStr ? JSON.parse(favsStr) : [];
      } catch (e) {
        console.warn('[FAVORITES] Failed to parse stored favorites:', e);
      }
      if (!Array.isArray(favs)) favs = [];
      if ((Array.isArray(favs) ? favs.includes(id) : false)) {
        favs = favs.filter((f: string) => f !== id);
      } else {
        favs.push(id);
      }
      setFavorites(favs);
      await AsyncStorage.setItem('zenvy_favorites', JSON.stringify(favs));
    } catch (e) {
      console.error(e);
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

  const fetchBlockChallenges = async () => {
    setLoadingBlock(true);
    try {
      // Fetch active challenge
      const resChallenge = await apiFetch(ENDPOINTS.activeChallenge);
      if (resChallenge.ok) {
        const data = await resChallenge.json();
        setActiveChallenge(data.challenge);
        setBlockLeaderboard(data.leaderboard || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBlock(false);
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
    try {
      const res = await apiFetch(`${ENDPOINTS.restaurants}?fields=summary`);
      const data = await res.json().catch(() => null);
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
      console.warn('[ZENVY_SYNC] Restaurants failed to load:', e?.message || e);
      // Keep whatever is on screen (the cached list); only an empty screen is an error
      const cached = await readCache<any[]>(RESTAURANTS_CACHE_KEY);
      const hadCache = !!(cached && Array.isArray(cached.data) && cached.data.length > 0);
      if (hadCache) setRestaurants((cur) => (cur.length ? cur : cached!.data));
      setLoadError(hadCache ? false : (Number(e?.status) >= 500 ? 'server' : 'network'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
        Alert.alert('Close Zenvy?', undefined, [
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
  const filtered = React.useMemo(() => restaurants
    .filter(isHomeFoodVendor)
    .filter(r => {
      if (vegOnly) {
        return isPureVegRestaurant(r);
      }
      return true;
    })
    .filter(r => {
      if (filter === 'veg') return isPureVegRestaurant(r);
      if (filter === 'under99') return availableMenu(r).some((i:any) => Number(i.price) <= 99);
      if (filter === 'topRated') return Number(r.rating) >= 4.5;
      if (filter === 'express') { const d = Number(r.deliveryTime); return d > 0 && d <= 20; }
      if (filter === 'budget') return availableMenu(r).some((i:any) => Number(i.price) < 150);
      if (filter === 'premium') return r.subscriptionTier === 'premium' || r.isFeatured;
      if (filter === 'jain') return hasDietTag(r, 'jain');
      if (filter === 'eggless') return hasDietTag(r, 'eggless');
      return true;
    })
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
    }), [restaurants, vegOnly, filter, search, classicFilter]);

  const cardBg = isDark ? 'rgba(255, 255, 255, 0.08)' : colors.card;
  const txt = colors.text;
  const openBasket = useCallback(() => router.push('/(tabs)/basket' as any), [router]);
  const txtSec = colors.textSecondary;
  const border = isDark ? COLORS.borderGold : colors.border;
  const bg = colors.bg;
  // Bottom sheets need an opaque surface (cardBg is translucent in dark mode)
  const sheetBg = isDark ? '#18181B' : colors.card;

  const goldColor = isDark ? COLORS.gold : colors.gold;
  const goldBorderColor = isDark ? COLORS.goldBorder : 'rgba(239, 79, 95, 0.35)';
  const goldMutedColor = isDark ? COLORS.goldMuted : 'rgba(239, 79, 95, 0.1)';
  const goldGlowShadow = isDark ? SHADOWS.goldGlow : SHADOWS.redGlow;

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: bg }]} enabled={homeFocused}>
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
            <View style={[s.avatar, { backgroundColor: cardBg, borderColor: goldBorderColor, overflow: 'hidden' }, user?.isElite && [s.avatarElite, { borderColor: goldColor }, goldGlowShadow]]}>
              {user?.profileImage ? (
                <SafeImage
                  source={{ uri: user.profileImage }}
                  // A broken profile photo shows the user's initials, never a stock photo of someone else.
                  fallback={<Text style={[s.avatarText, { color: goldColor }]}>{(user?.name||'Z').substring(0,2).toUpperCase()}</Text>}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : (
                <Text style={[s.avatarText, { color: goldColor }]}>{(user?.name||'Z').substring(0,2).toUpperCase()}</Text>
              )}
            </View>
            <View>
              <Text style={[s.greeting, { color: txtSec }]}>{getGreeting()}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.userName, { color: txt }]}>{(user?.name || 'Guest').trim().split(' ')[0] || 'Guest'}</Text>
                {!!user?.isElite && (
                  <View style={[s.eliteBadge, { backgroundColor: '#D4AF7A', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }]}>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.3 }}>Elite</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>

          <View style={s.navRight}>
            {/* Campus: the one entry for chats, Friends (Pulse, Spaces, Forum, Tasks, Connect), Around campus and Me */}
            <DopaminePressable
              style={[s.campusPill, { backgroundColor: cardBg, borderColor: goldBorderColor }]}
              onPress={() => router.push('/friends' as any)}
              sound="click"
              activeScale={0.92}
              accessibilityRole="button"
              accessibilityLabel="Open Campus"
            >
              <Ionicons name="people-outline" size={16} color={goldColor} />
              <Text style={[s.campusPillText, { color: goldColor }]}>Campus</Text>
            </DopaminePressable>
            <DopaminePressable 
              style={[s.navBtn, { backgroundColor: cardBg, borderColor: goldBorderColor }]} 
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
            style={[s.searchWrap, { backgroundColor: cardBg, borderColor: isDark ? goldBorderColor : COLORS.borderLight, flex: 1, marginBottom: 0 }]}
          >
            <Ionicons name="search-outline" size={17} color={txtSec} />
            <RotatingSearchInput search={search} color={txt} placeholderColor={txtSec} inputStyle={s.searchInput} />
            {!!search && (
              <TouchableOpacity
                onPress={() => setSearch('')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Clear search"
              >
                <Text style={{ fontSize: 14, fontWeight: '800', color: txtSec }}>✕</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          {/* VEG MODE Switch (Swiggy / Zomato Style) */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              const nextVal = !vegOnly;
              setVegOnly(nextVal);
              setDietMode(nextVal ? 'veg' : 'all');
              if (!nextVal && filter === 'veg') setFilter('all');
            }}
            style={[
              s.vegToggleWrap,
              { backgroundColor: cardBg, borderColor: vegOnly ? '#10B981' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') }
            ]}
          >
            <Text style={[s.vegToggleText, { color: vegOnly ? '#10B981' : txtSec }]}>Veg</Text>
            <View style={[s.vegSwitchTrack, { backgroundColor: vegOnly ? '#10B981' : (isDark ? 'rgba(255,255,255,0.2)' : '#E2E8F0') }]}>
              <View style={[s.vegSwitchThumb, vegOnly && s.vegSwitchThumbActive]} />
            </View>
          </TouchableOpacity>
        </View>
        </StaggeredSection>

        {/* ── NIGHT CLOSURE (9 PM to 6 AM): say it on Home, not first at checkout ── */}
        <NightClosureBanner style={{ marginTop: 0, marginBottom: 12 }} />

        {/* ── CATEGORIES GRID CONTAINER (EXACT FIT) ── */}
        <StaggeredSection delay={200} direction="up">
        <View style={s.premiumCatGrid}>
          {homeCategories.map((c, catIdx) => (
            <BounceIn key={c.key} delay={300 + catIdx * 80} style={{ flex: 1 }}>
            <DopaminePressable 
              style={[
                s.premiumCatBtn, 
                { 
                  backgroundColor: cardBg, 
                  borderColor: border,
                }
              ]} 
              onPress={() => {
                if (c.key === 'food') {
                  scrollToGrid();
                } else if (c.key === 'basket') {
                  router.push('/mega-basket' as any);
                } else if (c.key === 'services') {
                  router.push({ pathname: '/(tabs)/others', params: { tab: 'services' } } as any);
                } else if (c.key === 'rides') {
                  router.push({ pathname: '/(tabs)/others', params: { tab: 'rides' } } as any);
                }
              }}
              sound="tabSwitch"
              activeScale={0.95}
            >
              <SafeImage 
                source={CATEGORY_IMAGES[c.key as keyof typeof CATEGORY_IMAGES]} 
                style={{ width: '100%', height: 60 }} 
                resizeMode="cover" 
              />
              <Text style={[s.premiumCatLabel, { color: txt, marginTop: 8, marginBottom: 8 }]} numberOfLines={1}>
                {c.label}
              </Text>
            </DopaminePressable>
            </BounceIn>
          ))}
        </View>
        </StaggeredSection>

        {/* ── CLASSICS ── */}
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
          {classics.map((c, i) => {
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
                <View style={[s.classicImgWrap, isActive && { borderColor: COLORS.red, ...SHADOWS.redGlow }]}>
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
                <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.red, letterSpacing: 0.2 }}>Clear</Text>
              </TouchableOpacity>
            </View>
            <NexusExplorer
              restaurants={restaurants.filter(isHomeFoodVendor)}
              activeCategory={classicFilter}
              onSelectItem={(restaurantId) => router.push(`/restaurant/${restaurantId}` as any)}
            />
          </Animated.View>
        )}

        {/* ── FILTERS ── */}
        <View onLayout={(e) => { gridY.current = e.nativeEvent.layout.y; }} style={s.sectionHeader}><Text style={[s.sectionTitle, { color: txt }]}>All restaurants</Text></View>
        <Text style={[s.sectionSub, { color: txtSec }]}>Restaurants on your campus</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16, marginBottom: 16 }}>
          {FILTERS.map(f => {
            const isChipActive = filter === f.key;
            return (
              <DopaminePressable 
                key={f.key} 
                onPress={() => setFilter(f.key)} 
                style={[
                  s.filterChip, 
                  isChipActive ? s.filterActive : {}, 
                  { borderColor: isChipActive ? COLORS.red : (isDark ? COLORS.borderDark : COLORS.borderLight) }
                ]}
                sound="tabSwitch"
                activeScale={0.93}
              >
                <Text style={[s.filterText, isChipActive ? s.filterTextActive : {}]}>{f.label}</Text>
              </DopaminePressable>
            );
          })}
        </ScrollView>

        {/* ── RESTAURANT GRID ── */}
        <View style={s.grid} onLayout={(e) => { gridBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}>
          {loading ? (
            <>
              <View style={{ width: '48.5%' }}><RestaurantCardSkeleton /></View>
              <View style={{ width: '48.5%' }}><RestaurantCardSkeleton /></View>
              <View style={{ width: '48.5%' }}><RestaurantCardSkeleton /></View>
              <View style={{ width: '48.5%' }}><RestaurantCardSkeleton /></View>
            </>
          ) : loadError && restaurants.length === 0 ? (
            <View style={[s.emptyFilterBox, { backgroundColor: cardBg, borderColor: isDark ? goldBorderColor : COLORS.borderLight }]}>
              <Ionicons name="cloud-offline-outline" size={34} color={txtSec} style={{ marginBottom: 8 }} />
              <Text style={[s.emptyFilterTitle, { color: txt }]}>
                {loadError === 'server' ? 'Zenvy is still starting up' : "Couldn't load restaurants"}
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
            </View>
          ) : (
            filtered.slice(0, gridLimit).map((r, i) => {
            const id = r._id || r.id;
            // Real data only: no invented ratings, ETAs, offers or prices
            const rating = Number(r.rating) || 0;
            const deliveryMins = Number(r.deliveryTime) || 0;
            const time: string | null = r.time || (deliveryMins > 0 ? `${deliveryMins} min` : null);
            const img = r.imageUrl || r.image || '';

            // Open/Closed status from the server (vendor toggle + operating hours, IST)
            const isOpen = isRestaurantOpenNow(r);
            const opensAtLabel = !isOpen ? formatOpensAt(r.opensAt) : null;

            const activeOffer: string | null = r.promoOffer || null;
            const cuisineText = Array.isArray(r.tags) && r.tags.length
              ? r.tags.slice(0, 3).map((t: any) => String(t)).join(', ')
              : (r.cuisine || r.description || '');
            const isFav = (Array.isArray(favorites) ? favorites.includes(id) : false);
            const isPremium = r.subscriptionTier === 'premium' || r.isFeatured;
            // "New" only for a recently listed store; an old store without ratings shows no badge.
            const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
            const isNewStore = Number.isFinite(createdMs) && Date.now() - createdMs < 30 * 86400000;

            return (
              <StaggeredSection 
                key={id || i} 
                delay={50 + (i % 6) * 60} 
                direction="up"
                style={{ width: '48.5%' }}
              >
              <CardPressable 
                accessibilityRole="button"
                accessibilityLabel={`${r.name || 'Store'}${isOpen ? '' : opensAtLabel ? `, closed, opens ${opensAtLabel}` : ', closed'}${cuisineText ? `, ${cuisineText}` : ''}`}
                accessibilityHint="Opens the menu"
                style={[
                  s.rCard, 
                  { 
                    backgroundColor: cardBg, 
                    borderColor: r.isFeatured ? '#F59E0B' : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'), 
                    borderWidth: r.isFeatured ? 1.5 : 1, 
                    width: '100%', 
                    marginHorizontal: 0,
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
                    <Text style={{ fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 0.2 }}>
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
                      <Text style={{ fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.2 }}>
                        {featuredLabel(r)}
                      </Text>
                    </LinearGradient>
                  )}
 
                  {!!time && isOpen && (
                    <View style={s.timeChip}><Text style={s.timeText}>{time}</Text></View>
                  )}
                  {!isOpen && (
                    <View style={s.timeChip}><Text style={s.timeText}>{opensAtLabel ? `Opens ${opensAtLabel}` : 'Closed now'}</Text></View>
                  )}
                  {!isOpen && (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 16 }]} />
                  )}
                  {activeOffer && (
                    <View style={[
                      s.offerRibbon, 
                      r.isFeatured && { backgroundColor: '#F59E0B' }
                    ]}>
                      <Text style={[s.offerText, r.isFeatured && { color: '#000', fontWeight: '900' }]} numberOfLines={1}>
                        {activeOffer}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={s.rInfo}>
                  <View style={s.rTitleRow}>
                    <Text style={[s.rName, { color: txt }]} numberOfLines={1}>{r.name}</Text>
                    {rating > 0 ? (
                      <View style={s.ratingBadge}>
                        <Text style={s.ratingText}>{rating.toFixed(1)}</Text>
                        <Text style={{ fontSize: 12, color: '#fff', fontWeight: '900' }}>★</Text>
                      </View>
                    ) : isNewStore ? (
                      <View style={s.ratingBadge}>
                        <Text style={s.ratingText}>New</Text>
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

        {/* ── OFFERS AND CAMPUS PROMOS (below the stores, so restaurants are on the first screen) ── */}
        <View style={{ height: 8 }} onLayout={(e) => { carouselTop.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }} />
        {/* ── HIGH-CLASS SWIGGY/ZOMATO PROMO CAROUSEL (WITH MINIATURE ANIMATIONS & ADMIN SPOTLIGHT) ── */}
        <StaggeredSection delay={100} direction="up">
          <View onLayout={(e) => { carouselHeight.current = e.nativeEvent.layout.height; }}>
          <HighClassPromoCarousel 
            visible={carouselVisible}
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
              } else if (slide.id === 'mega-basket') {
                router.push('/mega-basket' as any);
              } else if (slide.id === 'campus-buddy') {
                router.push('/friends' as any);
              } else if (slide.id === 'ride') {
                router.push({ pathname: '/(tabs)/others', params: { tab: 'rides' } } as any);
              } else if (slide.id === 'stays') {
                router.push({ pathname: '/(tabs)/others', params: { tab: 'stays' } } as any);
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

        {/* ── DAILY DEALS ── */}
        <StaggeredSection delay={600} direction="up">
        <CardPressable 
          style={[s.vaultCard, { backgroundColor: cardBg }]} 
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
              <View>
                <Text style={[s.vaultTitle, { color: txt }]}>Daily deals</Text>
                <Text style={[s.vaultSub, { color: txtSec }]}>Today's coupons, valid until midnight</Text>
              </View>
            </View>
            <View style={s.vaultRight}>
              <VaultTimerBadge pulseAnim={pulseAnim} />
              <Text style={[s.vaultUntil, { color: txtSec }]}>Ends in</Text>
            </View>
          </View>
        </CardPressable>
        </StaggeredSection>

        {/* Recently Visited Memory Cache */}
        <RecentlyViewed />

        {/* ── SECTION BREATHING SPACE ── */}
        <View style={{ height: 20 }} />

        {/* ── CAMPUSBITES: LOCAL VENDORS ── */}
        <CampusBitesSection restaurants={restaurants} loading={loading} />

        <View style={{ height: 100 }} />
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
                  const itemImg = item.imageUrl || 'https://images.unsplash.com/photo-1618331835717-801e976710b2?w=400';
                  return (
                    <View key={item.id} style={[s.vaultItemCard, { borderColor: border }]}>
                      <Image source={{ uri: itemImg }} style={s.vaultItemImg} />
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

      {/* ── BLOCKWARS ARENA MODAL ── */}
      <Modal visible={showBlockModal} animationType="slide" transparent={true} onRequestClose={() => setShowBlockModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContentBox, { backgroundColor: sheetBg }]}>
            <Text style={[s.modalTitle, { color: txt }]}>Hostel block leaderboard</Text>
            <Text style={[s.modalSubtitle, { color: txtSec }]}>Hostel blocks compete for points each week</Text>

            {loadingBlock ? (
              <ActivityIndicator size="large" color={goldColor} style={{ marginVertical: 32 }} />
            ) : (
              <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
                {activeChallenge && (
                  <View style={[s.challengeCardLayout, { borderColor: border }]}>
                    <Text style={s.challengeEmoji}>{activeChallenge.emoji || '🏆'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.challengeTitle, { color: txt }]}>{activeChallenge.title}</Text>
                      <Text style={[s.challengeDesc, { color: txtSec }]}>{activeChallenge.description}</Text>
                    </View>
                  </View>
                )}

                <Text style={[s.leaderboardTitle, { color: txt }]}>Standings</Text>
                {blockLeaderboard.length > 0 ? (
                  blockLeaderboard.map((item, idx) => {
                    const isUserBlock = user?.hostelBlock === item.block;
                    return (
                      <View key={item.block} style={[s.leaderboardRow, { borderColor: border }, isUserBlock && { borderColor: goldColor, backgroundColor: isDark ? 'rgba(201,168,76,0.06)' : 'rgba(239,79,95,0.06)' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Text style={[s.rankText, { color: idx === 0 ? goldColor : idx === 1 ? '#9CA3AF' : idx === 2 ? '#B45309' : txtSec }]}>
                            #{idx + 1}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.blockName, { color: txt }]}>
                              BLOCK {item.block?.toUpperCase()} {isUserBlock && ' (MY BLOCK)'}
                            </Text>
                            <Text style={{ fontSize: 12, color: txtSec }}>
                              {item.participants || 0} ORDERERS • ₹{item.spend || 0} TOTAL VALUE
                            </Text>
                          </View>
                        </View>
                        <Text style={[s.scoreVal, { color: idx === 0 ? goldColor : txt }]}>
                          {item.orders || item.score || 0} ORDERS
                        </Text>
                      </View>
                    );
                  })
                ) : (
                  <View style={{ padding: 24, alignItems: 'center' }}>
                    <Text style={{ color: txtSec, fontSize: 12, fontWeight: '700' }}>No active standings yet this week.</Text>
                  </View>
                )}
              </ScrollView>
            )}

            <DopaminePressable 
              style={s.modalCloseBtn} 
              onPress={() => setShowBlockModal(false)}
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
                <Text style={{ fontSize: 18, color: txtSec, fontWeight: '800' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.modalSubtitle, { color: txtSec, marginBottom: 14 }]}>Diet and cuisine shortcuts</Text>

            <ScrollView style={{ width: '100%', maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {/* Dietary Fast Switcher */}
              <View style={{ marginBottom: 16, padding: 12, borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC', borderWidth: 1, borderColor: border }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: goldColor, letterSpacing: 0.2, marginBottom: 8 }}>Diet</Text>
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
                    <Text style={{ fontSize: 12, fontWeight: '900', color: filter === 'all' && !vegOnly ? (isDark ? '#000' : '#FFF') : txt }}>All restaurants</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      alignItems: 'center',
                      backgroundColor: vegOnly || filter === 'veg' ? '#10B981' : 'transparent',
                      borderWidth: 1,
                      borderColor: vegOnly || filter === 'veg' ? 'transparent' : border,
                    }}
                    onPress={() => {
                      // Same switch as the Veg toggle in the search bar, so the two never disagree.
                      setVegOnly(true);
                      setDietMode('veg');
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '900', color: vegOnly || filter === 'veg' ? '#FFF' : txt }}>Pure veg only</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Quick Jump Category Cards */}
              <Text style={{ fontSize: 12, fontWeight: '800', color: txtSec, letterSpacing: 0.2, marginBottom: 8 }}>Popular cuisines</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {classics.map((c, i) => {
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
                      <Text style={{ fontSize: 12, fontWeight: '800', color: isSelected ? (isDark ? '#000' : '#FFF') : txt }}>
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

      {/* ── FLOATING BOTTOM BASKET BAR (its own component: a basket change re-renders only it) ── */}
      <HomeFloatingCart isDark={isDark} txt={txt} onOpen={openBasket} />

      {/* ── Floating chat button: opens Campus (same place as the Campus pill) ── */}
      <FloatingPulse color={COLORS.red} style={s.fabBtnWrap}>
        <DopaminePressable
          style={s.fabBtn}
          onPress={() => router.push('/friends' as any)}
          sound="click"
          activeScale={0.88}
          accessibilityRole="button"
          accessibilityLabel="Open Campus chats"
        >
          <Ionicons name="chatbubbles" size={22} color="#FFFFFF" />
        </DopaminePressable>
      </FloatingPulse>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  campusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1 },
  campusPillText: { fontSize: 13, fontWeight: '800' },
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
  avatarText: { fontSize: 13, fontWeight: '900', color: COLORS.gold },
  greeting: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  userName: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  eliteBadge: { backgroundColor: COLORS.gold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  eliteBadgeText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.3 },
  navRight: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  goldNavBadge: { borderRadius: 12, overflow: 'hidden' },
  goldNavBadgeGradient: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12 },
  goldNavBadgeText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.8 },
  walletNavBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 4.5, borderRadius: 12, borderWidth: 1 },
  walletNavText: { fontSize: 12, fontWeight: '900' },
  navBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.goldBorder },
  profileBtn: { borderColor: COLORS.gold, ...SHADOWS.goldGlow },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '900', color: '#fff' },
  // Hero
  heroWrap: { marginHorizontal: 16, borderRadius: RADIUS.hero, overflow: 'hidden', height: 220, marginBottom: 16 },
  heroImg: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  heroContent: { flex: 1, justifyContent: 'center', padding: 24, zIndex: 2 },
  heroTag: { fontSize: 12, fontWeight: '900', color: COLORS.gold, letterSpacing: 0.3, marginBottom: 8 },
  heroTitle: { fontSize: 28, fontWeight: '900', color: '#fff', fontStyle: 'italic', lineHeight: 30 },
  heroSub: { fontSize: 28, fontWeight: '900', color: COLORS.gold, fontStyle: 'italic', lineHeight: 30, marginBottom: 8 },
  heroDesc: { fontSize: 12, fontWeight: '700', color: '#aaa', letterSpacing: 0.3, marginBottom: 16, maxWidth: 260 },
  heroCta: { backgroundColor: COLORS.gold, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 30, alignSelf: 'flex-start', ...SHADOWS.goldGlow },
  heroCtaText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.3 },
  heroDots: { position: 'absolute', bottom: 14, left: 24, flexDirection: 'row', gap: 4, zIndex: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 22, backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  // Categories
  catRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  catBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: COLORS.borderDark },
  catIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.goldMuted, borderWidth: 1, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  // Search & Veg Mode Bar
  searchBarContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, gap: 8, marginBottom: 16 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderWidth: 1.5, gap: 8 },
  searchInput: { flex: 1, fontSize: 12, fontWeight: '600', padding: 0 },
  vegToggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5 },
  vegToggleText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  vegSwitchTrack: { width: 32, height: 18, borderRadius: 9, padding: 2, justifyContent: 'center' },
  vegSwitchThumb: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#94A3B8' },
  vegSwitchThumbActive: { transform: [{ translateX: 14 }], backgroundColor: '#FFFFFF' },
  // Classics
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  sectionSub: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, paddingHorizontal: 16, marginBottom: 12, marginTop: -4 },
  manageBtn: { backgroundColor: COLORS.bgCard, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: COLORS.borderDark },
  manageBtnText: { fontSize: 12, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 0.3 },
  classicItem: { alignItems: 'center', marginRight: 16, width: 70 },
  classicImgWrap: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: COLORS.gold, overflow: 'hidden', marginBottom: 6, ...SHADOWS.goldGlow },
  classicImg: { width: '100%', height: '100%' },
  classicName: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3, textAlign: 'center' },
  // Vault
  vaultCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, padding: 16, borderRadius: 28, borderWidth: 1, borderColor: COLORS.goldBorder, marginBottom: 24 },
  vaultLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vaultIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#000', borderWidth: 1, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' },
  vaultTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  vaultSub: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginTop: 2 },
  vaultRight: { alignItems: 'flex-end' },
  vaultTimerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.goldMuted, borderWidth: 1, borderColor: COLORS.goldBorder, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  vaultDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.gold },
  vaultTimer: { fontSize: 12, fontWeight: '900', color: COLORS.gold, fontVariant: ['tabular-nums'] },
  vaultUntil: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3, marginTop: 4 },
  // Filters
  filterChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, marginRight: 8 },
  filterActive: { backgroundColor: COLORS.red },
  filterText: { fontSize: 12, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 0.3 },
  filterTextActive: { color: '#fff' },
  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, justifyContent: 'space-between', rowGap: 12 },
  rCard: { width: '100%', borderRadius: 16, overflow: 'hidden', ...SHADOWS.card },
  rImgWrap: { width: '100%', aspectRatio: 4/3, position: 'relative' },
  rImg: { width: '100%', height: '100%' },
  heartBtn: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  promotedBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  promotedText: { fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 0.3 },
  timeChip: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 7, paddingVertical: 3.5, borderRadius: 6 },
  timeText: { fontSize: 12, fontWeight: '900', color: '#fff' },
  offerRibbon: { position: 'absolute', bottom: 8, left: 0, backgroundColor: COLORS.blueOffer, paddingHorizontal: 8, paddingVertical: 4, borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  offerText: { fontSize: 12, fontWeight: '900', color: '#fff' },
  rInfo: { padding: 10 },
  rTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  rName: { fontSize: 13, fontWeight: '900', color: '#111', flex: 1, marginRight: 4 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: COLORS.greenRating, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  ratingText: { fontSize: 12, fontWeight: '900', color: '#fff' },
  rCuisine: { fontSize: 12, color: '#888', fontWeight: '600' },
  // BlockWars & Modals styles
  blockwarsBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 20 },
  blockwarsIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: COLORS.goldMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.goldBorder },
  blockwarsTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  blockwarsSub: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3, marginTop: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContentBox: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, height: '80%', alignItems: 'center' },
  modalTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3, marginBottom: 6 },
  modalSubtitle: { fontSize: 12, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.3, marginBottom: 20, textAlign: 'center' },
  modalCloseBtn: { width: '100%', paddingVertical: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  modalCloseText: { fontSize: 12, fontWeight: '900', color: COLORS.textSecondary, letterSpacing: 0.3 },

  vaultItemCard: { flexDirection: 'row', padding: 12, borderRadius: 20, borderWidth: 1, marginBottom: 12 },
  vaultItemImg: { width: 80, height: 80, borderRadius: 12, marginRight: 12 },
  vaultItemInfo: { flex: 1, justifyContent: 'space-between' },
  vaultItemName: { fontSize: 12, fontWeight: '900' },
  vaultItemDesc: { fontSize: 12, fontWeight: '600', marginVertical: 2 },
  vaultItemStock: { fontSize: 12, fontWeight: '800', marginBottom: 6 },
  vaultItemReqRow: { flexDirection: 'row', marginBottom: 8 },
  reqBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  reqBadgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  claimBtn: { paddingVertical: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  claimBtnText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.3 },
  lockedBtn: { paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  lockedBtnText: { fontSize: 12, fontWeight: '800', color: COLORS.textMuted },

  challengeCardLayout: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, marginBottom: 20, alignItems: 'center' },
  challengeEmoji: { fontSize: 32 },
  challengeTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  challengeDesc: { fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  challengeReward: { fontSize: 12, fontWeight: '900', color: COLORS.gold, letterSpacing: 0.3 },

  leaderboardTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3, marginBottom: 10 },
  leaderboardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
  rankText: { fontSize: 12, fontWeight: '900', width: 24 },
  blockName: { fontSize: 12, fontWeight: '900' },
  scoreVal: { fontSize: 12, fontWeight: '900' },

  // Floating Community FAB
  fabBtnWrap: { position: 'absolute', bottom: 20, right: 20, width: 54, height: 54, zIndex: 999 },
  fabBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', ...SHADOWS.redGlow },

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
  premiumCatGrid: {
    marginHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 20,
    gap: 8,
  },
  premiumCatBtn: {
    flex: 1,
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
    fontWeight: '900',
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
    fontWeight: '900',
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
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  // Floating Bottom Cart Bar
  floatingCartWrap: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 76,
    zIndex: 95,
  },
  floatingCartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    ...SHADOWS.card,
    elevation: 8,
  },
  floatingCartBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCartLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  floatingCartSub: {
    fontSize: 12,
    fontWeight: '800',
  },
  floatingCartCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  floatingCartCtaText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
});
// BUST_CACHE_2026_07_19_00_42
// BUST_CACHE_2026_07_19_00_42
