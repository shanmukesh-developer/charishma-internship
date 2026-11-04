import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS, surfaceLift } from '../../constants/theme';
import { API_URL } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import NightClosureBanner from '../../components/NightClosureBanner';
import NoticeCard from '../../components/NoticeCard';
import { useCartActions, useCartState, MAX_ITEM_QTY, basketKindOf, BasketKind } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import FssaiLine from '../../components/FssaiLine';
import { useDietary } from '../../context/DietaryContext';
import CustomizeDrawer, { isCustomizable } from '../../components/CustomizeDrawer';
import { fromPrice, productOptions, useAskOptions } from '../../components/ProductOptions';
import FormattedDescription, { firstParagraph, isStructured, plainDescription } from '../../components/FormattedDescription';
import { saveRecentlyViewed } from '../../components/RecentlyViewed';
import DopaminePressable, { CartPressable, ActionPressable, CardPressable } from '../../components/DopaminePressable';
import { StaggeredSection, FloatingPulse } from '../../components/AnimatedSection';
import SafeImage from '../../components/SafeImage';
import { isLocalVendor as isLocalVendorStore, vendorCallNumber, callVendor } from '../../utils/localVendor';
import { useLiveSync, affectsStore } from '../../utils/useLiveSync';
import { peekCache, readCache, writeCache, peekCachedRestaurant } from '../../utils/swrCache';
import { Ionicons } from '@expo/vector-icons';
import { formatINR, plural } from '../../utils/format';
import { storeEtaText } from '../../utils/storeEta';
import { isNewStore } from '../../utils/storeBadge';
import { getLocalFavorites, toggleFavoriteStore, isFavoriteIn } from '../../utils/favorites';
import { useTopInset } from '../../utils/useTopInset';
import { goHome } from '../../utils/goHome';
import StatusBarScrim from '../../components/StatusBarScrim';
import SymbolIcon from '../../components/SymbolIcon';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Booking-only service stores (backend utils/vendorTypes.js) and the shelf that books them.
const SERVICE_CATEGORY_BY_VENDOR: Record<string, string> = { REPAIRS: 'repairs', PRINT: 'print', LAUNDRY: 'laundry', TAILORING: 'tailoring' };
// Store types that don't sell food: no veg / non-veg mark and no food placeholder (same list as products/[id].tsx).
const NON_FOOD_TYPES = ['ELECTRONICS', 'HOME_ESSENTIALS', 'STATIONERY', 'STATIONARY', 'TOYS', 'SEEDS', 'RENTALS', 'RENTAL', 'REPAIRS', 'PRINT', 'LAUNDRY', 'TAILORING', 'PHARMACY'];
const isFoodVendorType = (vendorType: unknown) => !NON_FOOD_TYPES.includes(String(vendorType || '').toUpperCase());
// Diet filter names as people read them (the stored modes include 'eggarian' / 'nonveg').
const DIET_MODE_LABELS: Record<string, string> = { veg: 'Veg', egg: 'Egg', eggarian: 'Egg', 'non-veg': 'Non-veg', nonveg: 'Non-veg', all: 'allergy' };

const formatOpensAt = (hhmm?: string | null) => {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

const parseJson = (v: any) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

const seedRestaurant = (id: string): any => {
  if (!UUID_RE.test(id)) return null;
  const hit = peekCache<any>(`restaurant:${id}`) || peekCachedRestaurant(id);
  if (!hit || SERVICE_CATEGORY_BY_VENDOR[String(hit.vendorType || '').toUpperCase()]) return null;
  return { ...hit, menu: Array.isArray(hit.menu) ? hit.menu.filter(Boolean) : [] };
};

const isVegItem = (item: any) =>
  item?.isVegetarian === true || String(item?.isVegetarian).toLowerCase() === 'true' || Number(item?.isVegetarian) === 1;

/** veg / egg / non-veg of a menu item for the shop filters: the admin's food type first, else the veg flag. */
const dietKindOf = (item: any): 'veg' | 'egg' | 'nonveg' => {
  const d = String(item?.dietType || '').toLowerCase().replace(/[^a-z]/g, '');
  if (d === 'egg') return 'egg';
  if (d === 'veg') return 'veg';
  if (d === 'nonveg' || d === 'nonvegetarian') return 'nonveg';
  return isVegItem(item) ? 'veg' : 'nonveg';
};
type ShopFilterKey = 'all' | 'veg' | 'nonveg' | 'egg' | 'under99';
const SHOP_FILTERS: { key: Exclude<ShopFilterKey, 'all'>; label: string; icon: keyof typeof Ionicons.glyphMap; tint: string }[] = [
  { key: 'veg', label: 'Veg', icon: 'leaf-outline', tint: '#16A34A' },
  { key: 'nonveg', label: 'Non-veg', icon: 'restaurant-outline', tint: '#DC2626' },
  { key: 'egg', label: 'Egg', icon: 'egg-outline', tint: '#D97706' },
  { key: 'under99', label: 'Under ₹99', icon: 'cash-outline', tint: '#EF4F5F' },
];
const inShopFilter = (item: any, key: ShopFilterKey) => {
  if (key === 'all') return true;
  if (key === 'under99') { const n = Number(item?.price); return n > 0 && n < 99; }
  return dietKindOf(item) === key;
};

/** One dish's ADD button / − qty + stepper: reads the basket itself so only this control re-renders on a change. */
const MenuAddControl = React.memo(function MenuAddControl({ itemId, soldOut, customizable, isAdded, blocked, closed, eliteLocked, tint, onAdd }: {
  itemId: string; soldOut: boolean; customizable: boolean; isAdded: boolean; blocked: boolean; closed: boolean; eliteLocked: boolean; tint: string; onAdd: () => void;
}) {
  const { cart } = useCartState();
  const { updateQuantity } = useCartActions();
  const qtyInCart = cart.reduce((acc, c) => (String(c.id) === itemId ? acc + c.quantity : acc), 0);
  const plainLine = cart.find((c) => c.cartKey === itemId);
  return (
    <>
    {soldOut ? (
      <View style={[st.menuAddBtn, { backgroundColor: '#E5E7EB', borderColor: '#9CA3AF' }]}>
        <Text style={[st.menuAddBtnText, { color: '#6B7280' }]}>Sold out</Text>
      </View>
    ) : plainLine && !customizable ? (
      <View style={[st.stepperWrap, { backgroundColor: tint, borderColor: tint }]}>
        <TouchableOpacity
          style={st.stepperActionBtn}
          onPress={() => updateQuantity(plainLine.cartKey, plainLine.quantity - 1)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove one. ${plainLine.quantity} in basket`}
        >
          <SymbolIcon name="remove" style={st.stepperActionText} />
        </TouchableOpacity>
        <Text style={st.stepperCountText}>{plainLine.quantity}</Text>
        <TouchableOpacity
          style={st.stepperActionBtn}
          onPress={() => updateQuantity(plainLine.cartKey, plainLine.quantity + 1)}
          disabled={plainLine.quantity >= MAX_ITEM_QTY}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Add one more. ${plainLine.quantity} in basket`}
        >
          <SymbolIcon name="add" style={[st.stepperActionText, plainLine.quantity >= MAX_ITEM_QTY && { opacity: 0.4 }]} />
        </TouchableOpacity>
      </View>
    ) : (
      <CartPressable
        style={[
          st.menuAddBtn,
          isAdded
            ? { backgroundColor: '#EF4F5F', borderColor: '#EF4F5F' }
            : { backgroundColor: '#FFF5F6', borderColor: '#EF4F5F' },
          blocked && { backgroundColor: '#F3F4F6', borderColor: '#9CA3AF' },
        ]}
        onPress={onAdd}
        sound="addToCart"
      >
        <Text style={[
          st.menuAddBtnText,
          isAdded ? { color: '#fff' } : { color: '#EF4F5F' },
          blocked && { color: '#6B7280' },
        ]}>
          {isAdded ? 'Added' : closed ? 'Closed' : eliteLocked ? 'Elite' : customizable && qtyInCart > 0 ? `Add (${qtyInCart})` : 'Add'}
        </Text>
      </CartPressable>
    )}
    </>
  );
});

/** "View basket" bar: the only part of the page that reads the basket totals. */
const RestaurantFloatingCart = React.memo(function RestaurantFloatingCart({ tint, kind, onOpen }: { tint: string; kind: BasketKind; onOpen: (kind: BasketKind) => void }) {
  // This store's basket only (the other two baskets have their own checkouts).
  const { basketCounts, basketTotals } = useCartState();
  const totalItems = basketCounts[kind];
  const totalPrice = basketTotals[kind];
  if (!(totalItems > 0)) return null;
  return (
    <FloatingPulse color={tint} style={st.floatingCartContainer}>
      <DopaminePressable
        style={[st.floatingCart, { backgroundColor: tint, width: '100%' }]}
        onPress={() => onOpen(kind)}
        accessibilityRole="button"
        accessibilityLabel={`View basket, ${plural(totalItems, 'item')}, item total ${formatINR(totalPrice)}`}
        sound="success"
        activeScale={0.95}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={st.badgeContainer}><Text style={st.badgeText}>{totalItems}</Text></View>
            <View>
              <Text style={[st.floatingCartText, { color: '#fff' }]}>Item total {formatINR(totalPrice)}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Text style={[st.proceedText, { color: '#fff' }]}>View basket</Text><SymbolIcon name="chevron-forward" style={[st.proceedText, { color: '#fff' }]} scale={1} /></View>
          </View>
        </View>
      </DopaminePressable>
    </FloatingPulse>
  );
});

export default function RestaurantDetail() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String((Array.isArray(params.id) ? params.id[0] : params.id) || '').trim();
  const router = useRouter();
  // Actions only: basket changes re-render just the ADD controls and the floating bar below, not the whole menu.
  const { addToCart } = useCartActions();
  const askOptions = useAskOptions();
  const { user } = useAuth();
  const { isDark, colors } = useTheme();
  const { dietMode, setDietMode, isItemAllowed } = useDietary();

  // Instant first paint: this store's last good response, or its entry in the cached home list
  // (which carries the menu). The network refresh below replaces it a moment later.
  const [restaurant, setRestaurant] = useState<any>(() => seedRestaurant(id));
  const [loading, setLoading] = useState(() => !seedRestaurant(id));
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [activeCategory, setActiveCategory] = useState('All');
  // In-store search: filters the loaded menu by dish name, category or tag (all categories at once)
  const [menuSearch, setMenuSearch] = useState('');
  // Veg / Non-veg / Egg / Under ₹99 chips under the search (only the ones that split this menu).
  const [shopFilter, setShopFilter] = useState<ShopFilterKey>('all');
  const [descOpen, setDescOpen] = useState(false);
  // Long menus (a mart can list hundreds of items) mount 20 at a time; more mount as the user nears
  // the end of the list. A category or search change starts again at 20.
  const MENU_PAGE = 20;
  const [menuLimit, setMenuLimit] = useState(MENU_PAGE);
  useEffect(() => { setMenuLimit(MENU_PAGE); }, [activeCategory, menuSearch, shopFilter, id]);
  const growingMenu = useRef(false);
  // Past the hero photo, the menu scrolls under the clock: show the status-bar strip then (components/StatusBarScrim).
  const [pastHero, setPastHero] = useState(false);
  const onMenuScroll = useCallback((e: any) => {
    const ne = e?.nativeEvent || {};
    const past = (ne.contentOffset?.y || 0) > 200 - topPad;
    setPastHero((was) => (was === past ? was : past));
    const nearEnd = (ne.contentOffset?.y || 0) + (ne.layoutMeasurement?.height || 0) > (ne.contentSize?.height || 0) - 900;
    if (nearEnd && !growingMenu.current) {
      growingMenu.current = true;
      setMenuLimit((n) => n + MENU_PAGE);
      setTimeout(() => { growingMenu.current = false; }, 250);
    }
  }, [topPad]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [customizingItem, setCustomizingItem] = useState<any>(null);
  const openBasket = useCallback((kind: BasketKind) => router.push(`/(tabs)/basket?basket=${kind}` as any), [router]);

  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    if (addedTimer.current) clearTimeout(addedTimer.current);
  }, []);

  const isUserElite = !!(user as any)?.isElite;
  const restaurantRef = useRef<any>(restaurant);
  restaurantRef.current = restaurant;

  const loadRestaurant = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (!UUID_RE.test(id)) {
      setRestaurant(null);
      setLoadError({ notFound: true, message: "We couldn't find this store. It may have moved or closed." });
      setLoading(false);
      return;
    }
    if (mode === 'initial') {
      let seeded = !!restaurantRef.current;
      if (!seeded) {
        const cached = await readCache<any>(`restaurant:${id}`);
        if (cached?.data && mountedRef.current) {
          setRestaurant(cached.data);
          seeded = true;
        }
      }
      // With something on screen the refresh runs silently (no spinner); errors keep the cached menu
      if (seeded) mode = 'silent';
      else setLoading(true);
    }
    // apiFetch rides out a server cold start (retries with the "waking up" banner) and has its own timeout.
    try {
      const res = await apiFetch(`/api/users/restaurants/${id}`);
      const data = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (res.ok && data && (data.id || data._id)) {
        // Laundry / print / repairs / tailoring are booked (pickup slot, room, price estimate), not
        // ordered like food: open the booking shelf instead of a menu with ADD buttons.
        const serviceCategory = SERVICE_CATEGORY_BY_VENDOR[String(data.vendorType || '').toUpperCase()];
        if (serviceCategory) {
          router.replace(`/category/${serviceCategory}` as any);
          return;
        }
        const fresh = { ...data, menu: Array.isArray(data.menu) ? data.menu.filter(Boolean) : [] };
        setRestaurant(fresh);
        writeCache(`restaurant:${id}`, fresh);
        setLoadError(null);
        saveRecentlyViewed({
          id: data._id || data.id,
          name: data.name,
          image: data.imageUrl || data.image || '',
          type: 'restaurant'
        });
      } else if (res.status === 404) {
        setRestaurant(null);
        setLoadError({ notFound: true, message: "We couldn't find this store. It may have moved or closed." });
      } else if (mode !== 'silent') {
        setLoadError({ notFound: false, message: 'We could not load this menu right now. Please try again.' });
      }
    } catch {
      if (mountedRef.current && mode !== 'silent') {
        setLoadError({ notFound: false, message: "Can't reach ZenWe right now. Check your internet and try again." });
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [id, router]);

  useEffect(() => {
    loadRestaurant('initial');
  }, [loadRestaurant]);

  // Live sync: menu price / stock / store status edits for THIS store refresh the menu in place
  // (no spinner; the ScrollView keeps its position because the tree stays mounted).
  useLiveSync({
    types: ['store', 'product'],
    onChange: (events) => { if (affectsStore(events, id)) loadRestaurant('silent'); },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const favs = await getLocalFavorites();
        if (!cancelled) setIsFavorite(isFavoriteIn(favs, id));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [id]);

  const fullMenu: any[] = useMemo(() => (Array.isArray(restaurant?.menu) ? restaurant.menu : []), [restaurant]);
  const menu = useMemo(() => fullMenu.filter((item: any) => isItemAllowed(item)), [fullMenu, isItemAllowed]);
  const hiddenByDiet = fullMenu.length - menu.length;
  // A chip is offered only when it splits the menu (an all-veg menu shows no Veg / Non-veg pair).
  const shopChips = useMemo(() => {
    const kinds = new Set(menu.map(dietKindOf));
    const cheap = menu.filter((m: any) => inShopFilter(m, 'under99')).length;
    return SHOP_FILTERS.filter((f) => (f.key === 'under99'
      ? cheap > 0 && cheap < menu.length
      : kinds.size > 1 && kinds.has(f.key)));
  }, [menu]);
  useEffect(() => {
    if (shopFilter !== 'all' && !shopChips.some((f) => f.key === shopFilter)) setShopFilter('all');
  }, [shopChips, shopFilter]);
  const shopFilterLabel = shopFilter === 'all' ? '' : (SHOP_FILTERS.find((f) => f.key === shopFilter)?.label || '');

  // Pills come from the dishes' own categories, so every pill has dishes behind it
  const categories = useMemo(() => {
    const seen: string[] = [];
    menu.forEach((m: any) => {
      const c = String(m?.category || '').trim();
      if (c && !seen.some((x) => x.toLowerCase() === c.toLowerCase())) seen.push(c);
    });
    return ['All', ...seen];
  }, [menu]);

  useEffect(() => {
    if (!categories.some((c) => c === activeCategory)) setActiveCategory('All');
  }, [categories, activeCategory]);

  if (loading) {
    return (
      <View style={[st.container, st.center, { backgroundColor: isDark ? '#08090C' : COLORS.bgLight, padding: 24 }]}>
        <ActivityIndicator size="large" color={isDark ? COLORS.gold : COLORS.red} />
        <Text style={{ color: isDark ? 'rgba(255,255,255,0.6)' : COLORS.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.2, marginTop: 16 }}>
          Loading menu…
        </Text>
      </View>
    );
  }

  if (!restaurant) {
    const notFound = !!loadError?.notFound;
    return (
      <View style={[st.container, { backgroundColor: isDark ? '#08090C' : COLORS.bgLight, paddingTop: topPad, paddingHorizontal: 20 }]}>
        <TouchableOpacity
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB', alignItems: 'center', justifyContent: 'center', marginBottom: 30 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as any))}
        >
          <Ionicons name="arrow-back" size={20} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 20, borderRadius: 24, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF', borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB', ...SHADOWS.card }}>
          <Ionicons name={notFound ? 'storefront-outline' : 'cloud-offline-outline'} size={48} color={isDark ? 'rgba(255,255,255,0.6)' : COLORS.textSecondary} style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 18, fontWeight: '900', color: isDark ? '#FFF' : COLORS.textDark, letterSpacing: 0.2, textAlign: 'center', marginBottom: 8 }}>
            {notFound ? 'Store not found' : "Couldn't load the menu"}
          </Text>
          <Text style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.6)' : COLORS.textSecondary, textAlign: 'center', lineHeight: 18, marginBottom: 24 }}>
            {loadError?.message || 'Please try again.'}
          </Text>
          {!notFound && (
            <TouchableOpacity
              style={{ backgroundColor: COLORS.red, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16, marginBottom: 12, ...SHADOWS.redGlow }}
              onPress={() => loadRestaurant('initial')}
            >
              <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '900' }}>Try again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={{ paddingHorizontal: 24, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.red }}
            onPress={() => goHome(router)}
          >
            <Text style={{ color: COLORS.red, fontSize: 13, fontWeight: '900' }}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Partner branding set by the admin (Restaurant.brandTheme)
  const brand = parseJson(restaurant.brandTheme);
  const accent = brand ? (brand.accentColor || (isDark ? COLORS.gold : colors.gold)) : (isDark ? COLORS.gold : COLORS.red);
  const txt = brand ? (brand.fontColor || '#fff') : colors.text;
  const txtSec = brand ? (brand.fontColor ? brand.fontColor + 'B0' : colors.textSecondary) : colors.textSecondary;
  const cardBg = brand ? 'rgba(0,0,0,0.6)' : colors.card;
  const border = brand ? 'rgba(255,255,255,0.05)' : (isDark ? COLORS.borderDark : COLORS.borderLight);
  // Notes, the stall tag and the call button: quiet neutrals in the page's own colours (a brand store's too).
  const pageDark = !!brand || isDark;
  const notePalette = { bg: cardBg, border, text: txt, sub: txtSec, dark: pageDark };
  const quietFill = pageDark ? 'rgba(255,255,255,0.08)' : '#F1F2F5';
  const quietEdge = pageDark ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.16)';

  const ratingNum = Number(restaurant.rating);
  const hasRating = Number.isFinite(ratingNum) && ratingNum > 0;
  // CampusBites stalls are ordered here (basket -> COD to the stall); the stall delivers itself, no rider.
  const isLocalVendor = isLocalVendorStore(restaurant);
  const isFoodStore = isFoodVendorType(restaurant.vendorType);
  const vendorCall = isLocalVendor ? vendorCallNumber(restaurant) : null;
  const stallOffline = isLocalVendor && restaurant.isOffline === true;
  // Measured from real deliveries only (utils/storeEta): seed times never show as fact
  const deliveryTimeText = isLocalVendor ? null : storeEtaText(restaurant);
  const heroImg = restaurant.imageUrl || restaurant.image || null;
  const isOpen = restaurant.isOpen !== false;
  // Delivery slots (server takesSlotOrders): a store closed right now still takes orders for its next slot.
  const takesSlotOrders = !isOpen && restaurant.takesSlotOrders === true;
  const orderable = isOpen || takesSlotOrders;
  const opensAtText = formatOpensAt(restaurant.opensAt);
  const closedText = restaurant.closedReason || (opensAtText ? `Closed now — opens at ${opensAtText}` : 'Closed right now');

  async function toggleFavorite() {
    try {
      // Local list + account sync (utils/favorites); Home's hearts update through its listener
      const favs = await toggleFavoriteStore(id, !!user);
      setIsFavorite(isFavoriteIn(favs, id));
    } catch {}
  }

  const flashAdded = (itemId: string) => {
    setAddedId(itemId);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => { if (mountedRef.current) setAddedId(null); }, 800);
  };

  const blockedReason = (item: any): string | null => {
    if (!orderable) return closedText;
    if (stallOffline) return `${restaurant.name} is not taking orders on ZenWe right now.`;
    if (item.isAvailable === false) return `${item.name} is sold out right now.`;
    if (item.isEliteOnly && !isUserElite) return `${item.name} is for ZenWe Elite members.`;
    return null;
  };

  const handleAddToCart = (item: any) => {
    const reason = blockedReason(item);
    if (reason) {
      Alert.alert('Not available', reason);
      return;
    }
    // Admin-set choices (weights with their own prices, flavours, types): asked in the options sheet.
    const groups = productOptions(item);
    if (groups.length) {
      askOptions({ name: item.name, price: Number(item.price) || 0, image: item.image || item.imageUrl || null, groups }).then((r) => {
        if (!r) return;
        const itemId = String(item.id || item._id);
        const added = addToCart({
          id: itemId,
          name: item.name,
          price: r.unitPrice,
          basePrice: Number(item.price) || 0,
          image: item.image || item.imageUrl || '',
          restaurantId: String(restaurant.id || restaurant._id || id),
          restaurantName: restaurant.name,
          customizations: r.customizations as any,
          vendorType: restaurant.vendorType || undefined,
          ...(isLocalVendor ? { isStall: true } : {}),
        });
        if (added) flashAdded(itemId);
      });
      return;
    }
    if (isCustomizable(item)) {
      setCustomizingItem(item);
      return;
    }
    const itemId = String(item.id || item._id);
    const added = addToCart({
      id: itemId,
      name: item.name,
      price: Number(item.price) || 0,
      basePrice: Number(item.price) || 0,
      image: item.image || item.imageUrl || '',
      restaurantId: String(restaurant.id || restaurant._id || id),
      restaurantName: restaurant.name,
      vendorType: restaurant.vendorType || undefined,
      ...(isLocalVendor ? { isStall: true } : {}),
    });
    if (added) flashAdded(itemId);
  };

  const handleCustomizeConfirm = (customizations: any, finalPrice: number) => {
    const item = customizingItem;
    if (!item) return;
    const itemId = String(item.id || item._id);
    const added = addToCart({
      id: itemId,
      name: item.name,
      price: finalPrice,
      basePrice: Number(item.price) || 0,
      image: item.image || item.imageUrl || '',
      restaurantId: String(restaurant.id || restaurant._id || id),
      restaurantName: restaurant.name,
      customizations,
      vendorType: restaurant.vendorType || undefined,
      ...(isLocalVendor ? { isStall: true } : {}),
    });
    setCustomizingItem(null);
    if (added) flashAdded(itemId);
  };

  const menuQ = menuSearch.trim().toLowerCase().replace(/\s+/g, ' ');
  const filteredMenu = menu.filter((item: any) => {
    if (!inShopFilter(item, shopFilter)) return false;
    if (menuQ) {
      const tags = Array.isArray(item.tags) ? item.tags.join(' ') : '';
      const hay = `${item.name || ''} ${item.category || ''} ${tags}`.toLowerCase();
      return menuQ.split(' ').every((w) => hay.includes(w));
    }
    if (activeCategory === 'All') return true;
    return String(item.category || '').trim().toLowerCase() === activeCategory.toLowerCase();
  });

  return (
    <View style={[st.container, { backgroundColor: isDark ? '#0A0A0B' : '#F9FAFB' }]}>
      {brand ? (
        <LinearGradient
          colors={[brand.primaryColor || '#1A0000', brand.secondaryColor || '#111111']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: isDark ? COLORS.bgDark : COLORS.bgLight }} />
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={onMenuScroll}
        scrollEventThrottle={200}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRestaurant('refresh'); }} tintColor={accent} colors={[COLORS.red]} />}
      >
        {/* Hero Banner */}
        <View style={st.hero}>
          {heroImg ? (
            <SafeImage source={{ uri: heroImg }} style={st.heroImg} maxWidth={800} placeholderIcon="storefront-outline" />
          ) : (
            <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#1A1A1F' : '#FDE8EA' }}>
              <Ionicons name={isLocalVendor || !isFoodStore ? 'storefront-outline' : 'restaurant-outline'} size={64} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'} />
            </View>
          )}
          <View style={st.heroGrad} />

          {/* Back button */}
          <ActionPressable style={st.backBtn} accessibilityRole="button" accessibilityLabel="Back" onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </ActionPressable>

          {/* Favorite Heart Button */}
          <ActionPressable
            style={st.favoriteBtn}
            onPress={toggleFavorite}
            sound="click"
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? 'Remove from saved' : 'Save store'}
          >
            <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={18} color={isFavorite ? '#EF4F5F' : '#6B7280'} />
          </ActionPressable>
        </View>

        {/* Floating Info Card */}
        <View style={[st.floatingInfoCard, { backgroundColor: cardBg, borderColor: border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[st.statusBadge, { backgroundColor: isOpen ? '#10B981' : '#6B7280' }]}>
                <Text style={st.statusBadgeText}>{isOpen ? 'Open now' : 'Closed'}</Text>
              </View>
              {/* Same rule as Home (utils/storeBadge): a rating, else "New" only for a recently listed store */}
              {(hasRating || isNewStore(restaurant)) && (
                <Text style={{ color: txt, fontSize: 12, fontWeight: '700' }}>
                  {hasRating ? `★ ${ratingNum.toFixed(1)}` : 'New'}
                </Text>
              )}
            </View>
          </View>

          <Text style={[st.infoCardName, { color: txt }]}>{restaurant.name}</Text>
          {/* The store's own intro: a clean 3-line preview, "More" opens the full text in the owner's layout
              (headings, lists, **bold**: stores paste Markdown). It used to print every line, marks and all. */}
          {!!(restaurant.description || restaurant.stallDescription) && (() => {
            const full = String(restaurant.description || restaurant.stallDescription);
            const intro = firstParagraph(full);
            const hasMore = isStructured(full) || intro.length > 160;
            return (
              <View style={{ marginBottom: 8 }}>
                {descOpen && isStructured(full) ? (
                  <FormattedDescription text={full} color={txtSec} strong={txt} />
                ) : (
                  <Text style={[st.infoCardDesc, { color: txtSec, marginBottom: 0 }]} numberOfLines={descOpen ? undefined : 3}>{intro}</Text>
                )}
                {hasMore && (
                  <Text onPress={() => setDescOpen((v) => !v)} style={{ color: brand ? accent : '#EF4F5F', fontSize: 12, fontWeight: '800', marginTop: 4 }} accessibilityRole="button">
                    {descOpen ? 'Less' : 'More'}
                  </Text>
                )}
              </View>
            );
          })()}

          {isLocalVendor && (
            <View style={[st.localVendorBadge, { backgroundColor: quietFill }]}>
              <Text style={[st.localVendorBadgeText, { color: txtSec }]}>Campus stall</Text>
            </View>
          )}

          {/* Delivery & Time Details */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: border }}>
            <View style={{ flexDirection: 'row', gap: 12, flexShrink: 1 }}>
              {!!deliveryTimeText && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Ionicons name="time-outline" size={11} color={txtSec} />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: txtSec }}>{String(deliveryTimeText)}</Text>
                </View>
              )}
              {!!(restaurant.location || restaurant.campus) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
                  <Ionicons name="location-outline" size={11} color={txtSec} />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: txtSec, flexShrink: 1 }} numberOfLines={1}>{restaurant.location || restaurant.campus}</Text>
                </View>
              )}
            </View>

            {isLocalVendor && !!vendorCall && (
              <TouchableOpacity
                style={[st.contactBtn, { borderColor: quietEdge }]}
                accessibilityRole="button"
                accessibilityLabel={`Call ${restaurant.name}`}
                onPress={() => callVendor(restaurant)}
              >
                <Ionicons name="call-outline" size={13} color={txt} />
                <Text style={[st.contactBtnText, { color: txt }]}>Call stall</Text>
              </TouchableOpacity>
            )}
          </View>
          <FssaiLine number={restaurant.fssaiLicenseNumber} color={txtSec} />
        </View>

        {isLocalVendor && (stallOffline ? (
          <NoticeCard icon="pause-circle-outline" title="Not taking orders right now" sub="You can still look at the menu." palette={notePalette} />
        ) : (
          <NoticeCard icon="storefront-outline" title={`${String(restaurant.name || '').trim() || 'This stall'} delivers this order`} sub="Pay them in cash on delivery." palette={notePalette} />
        ))}

        {/* Campus night closure (9 PM to 6 AM): one clear banner, from the store's flag or the campus check */}
        {/* A store taking orders for its next slot says so itself below (one note, not two). */}
        <NightClosureBanner reopensAt={restaurant.campusClosed ? (restaurant.opensAt || '06:00') : takesSlotOrders ? null : undefined} palette={notePalette} />
        {!isOpen && !restaurant.campusClosed && (
          takesSlotOrders && restaurant.nextSlotLabel ? (
            <NoticeCard
              icon="time-outline"
              title="Closed right now"
              sub={`You can order for ${restaurant.nextSlotLabel}${restaurant.nextSlotClosesAt ? ` (order by ${restaurant.nextSlotClosesAt})` : ''}.`}
              palette={notePalette}
            />
          ) : (
            <NoticeCard
              icon="time-outline"
              title={restaurant.closedReason ? String(restaurant.closedReason).replace(/[.\s]+$/, '') : 'Closed right now'}
              sub={`${!restaurant.closedReason && opensAtText ? `Opens at ${opensAtText}. ` : ''}You can browse the menu and order when it opens.`}
              palette={notePalette}
            />
          )
        )}

        {/* In-store search (shown once a menu is long enough to need it) */}
        {menu.length > 6 && (
          <View style={[st.menuSearch, { backgroundColor: cardBg, borderColor: border }, surfaceLift(isDark)]}>
            <Ionicons name="search-outline" size={16} color={txtSec} />
            <TextInput
              value={menuSearch}
              onChangeText={setMenuSearch}
              placeholder={`Search in ${restaurant.name || 'this store'}`}
              placeholderTextColor={txtSec}
              style={[st.menuSearchInput, { color: txt }]}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search this menu"
            />
            {!!menuSearch && (
              <TouchableOpacity onPress={() => setMenuSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={17} color={txtSec} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Shop filters (Veg / Non-veg / Egg / Under ₹99): with the search and the categories; tap again to clear */}
        {shopChips.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
            {shopChips.map((f) => {
              const on = shopFilter === f.key;
              const activeBg = brand ? accent : '#EF4F5F';
              return (
                <DopaminePressable
                  key={f.key}
                  style={[st.categoryPill, st.shopChip, { backgroundColor: on ? activeBg : cardBg, borderColor: on ? activeBg : border }]}
                  onPress={() => setShopFilter(on ? 'all' : f.key)}
                  sound="tabSwitch"
                  activeScale={0.94}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Filter: ${f.label}`}
                >
                  <Ionicons name={f.icon} size={13} color={on ? '#FFF' : f.tint} />
                  <Text style={[st.categoryText, { color: on ? '#FFF' : txt }]} maxFontSizeMultiplier={1.3}>{f.label}</Text>
                  {on ? <Ionicons name="close" size={12} color="#FFF" /> : null}
                </DopaminePressable>
              );
            })}
          </ScrollView>
        )}

        {/* Category Filter Pills (hidden while searching: the search covers every category) */}
        {categories.length > 2 && !menuQ && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.categoryScroll} contentContainerStyle={{ paddingHorizontal: 16 }}>
            {categories.map(cat => {
              const isActive = activeCategory === cat;
              return (
                <DopaminePressable
                  key={cat}
                  style={[
                    st.categoryPill,
                    { backgroundColor: cardBg, borderColor: border },
                    isActive ? { backgroundColor: brand ? accent : '#EF4F5F', borderColor: brand ? accent : '#EF4F5F' } : {}
                  ]}
                  onPress={() => setActiveCategory(cat)}
                  sound="tabSwitch"
                  activeScale={0.94}
                >
                  <Text style={[st.categoryText, { color: isActive ? '#FFF' : txt }]} maxFontSizeMultiplier={1.3}>
                    {String(cat)}
                  </Text>
                </DopaminePressable>
              );
            })}
          </ScrollView>
        )}

        {/* Menu Items */}
        <View style={{ padding: 16, paddingBottom: 100 }}>
          <Text style={[st.menuTitle, { color: txt }]}>Menu</Text>
          <Text style={[st.menuSub, { color: txtSec }]}>
            {menuQ ? `${plural(filteredMenu.length, 'match', 'matches')} for "${menuSearch.trim()}"` : plural(filteredMenu.length, 'item')}{shopFilterLabel ? ` · ${shopFilterLabel}` : ''}{hiddenByDiet > 0 ? ` · ${hiddenByDiet} hidden by your food preferences` : ''}
          </Text>

          {filteredMenu.length === 0 && menuQ ? (
            <View style={[st.emptyMenu, { backgroundColor: cardBg, borderColor: border }]}>
              <Ionicons name="search-outline" size={36} color={txtSec} style={{ marginBottom: 8 }} />
              <Text style={{ color: txt, fontSize: 14, fontWeight: '800', textAlign: 'center' }}>No matching items</Text>
              <Text style={{ color: txtSec, fontSize: 12, marginTop: 4, textAlign: 'center', lineHeight: 16 }}>
                {`Nothing on this menu matches "${menuSearch.trim()}". Try another word.`}
              </Text>
              <TouchableOpacity style={[st.emptyMenuBtn, { backgroundColor: brand ? accent : '#EF4F5F' }]} onPress={() => setMenuSearch('')}>
                <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>Clear search</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {filteredMenu.length === 0 && !menuQ && shopFilter !== 'all' && (
            <View style={[st.emptyMenu, { backgroundColor: cardBg, borderColor: border }]}>
              <Ionicons name="filter-outline" size={36} color={txtSec} style={{ marginBottom: 8 }} />
              <Text style={{ color: txt, fontSize: 14, fontWeight: '800', textAlign: 'center' }}>{`No ${shopFilterLabel.toLowerCase()} items${activeCategory !== 'All' ? ` in ${activeCategory}` : ''}`}</Text>
              <TouchableOpacity style={[st.emptyMenuBtn, { backgroundColor: brand ? accent : '#EF4F5F' }]} onPress={() => setShopFilter('all')}>
                <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>Show all items</Text>
              </TouchableOpacity>
            </View>
          )}

          {filteredMenu.length === 0 && !menuQ && shopFilter === 'all' && (
            <View style={[st.emptyMenu, { backgroundColor: cardBg, borderColor: border }]}>
              <Ionicons name={hiddenByDiet > 0 ? 'filter-outline' : 'file-tray-outline'} size={36} color={txtSec} style={{ marginBottom: 8 }} />
              <Text style={{ color: txt, fontSize: 14, fontWeight: '800', textAlign: 'center' }}>
                {hiddenByDiet > 0 ? 'Hidden by your food preferences' : 'No items here yet'}
              </Text>
              <Text style={{ color: txtSec, fontSize: 12, marginTop: 4, textAlign: 'center', lineHeight: 16 }}>
                {hiddenByDiet > 0
                  ? `Your ${DIET_MODE_LABELS[String(dietMode)] || 'food'} filter hides ${plural(hiddenByDiet, 'item')} from this store.`
                  : 'This store is still adding items. Check back later.'}
              </Text>
              {hiddenByDiet > 0 && dietMode !== 'all' && (
                <TouchableOpacity style={[st.emptyMenuBtn, { backgroundColor: brand ? accent : '#EF4F5F' }]} onPress={() => setDietMode('all')}>
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>Show all items</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {filteredMenu.slice(0, menuLimit).map((item: any, i: number) => {
            const itemImg = item.image || item.imageUrl || null;
            const isVeg = isVegItem(item);
            const itemId = String(item._id || item.id || i);
            const isAdded = addedId === itemId;
            const soldOut = item.isAvailable === false;
            const eliteLocked = !!item.isEliteOnly && !isUserElite;
            const specs = parseJson(item.specs);
            const kcal = Number(specs?.kcal);
            const optionGroups = productOptions(item);
            const variantGroup = optionGroups.find((g) => g.type === 'variant');
            const customizable = isCustomizable(item) || optionGroups.length > 0;

            return (
              <StaggeredSection key={itemId} delay={Math.min(i, 10) * 60} direction="up">
              <CardPressable
                onPress={() => router.push(`/products/${itemId}` as any)}
                style={[st.menuCard, { backgroundColor: cardBg, borderColor: border }, (soldOut || eliteLocked) && { opacity: 0.6 }]}
              >
                <View style={st.menuInfo}>
                  {isFoodStore && (
                    <View style={[st.vegDot, { borderColor: isVeg ? '#22C55E' : '#AF3F3F' }]}>
                      {isVeg ? (
                        <View style={[st.vegDotInner, { backgroundColor: '#22C55E' }]} />
                      ) : (
                        <View style={st.nonVegTriangle} />
                      )}
                    </View>
                  )}
                  <Text style={[st.menuItemName, { color: txt }]} numberOfLines={2}>{item.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 2, flexWrap: 'wrap' }}>
                    <Text style={[st.menuItemPrice, { color: brand ? accent : '#EF4F5F' }]}>{formatINR(variantGroup ? (fromPrice(optionGroups) ?? item.price) : item.price)}</Text>
                    {Number.isFinite(kcal) && kcal > 0 && (
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700' }}>· {Math.round(kcal)} kcal</Text>
                    )}
                    {eliteLocked && (
                      <Text style={{ fontSize: 12, color: COLORS.gold, fontWeight: '900' }}>· Elite only</Text>
                    )}
                  </View>
                  {item.description ? <Text style={{ fontSize: 12, color: txtSec, marginTop: 2 }} numberOfLines={2}>{plainDescription(String(item.description))}</Text> : null}
                  {variantGroup
                    ? <Text style={{ fontSize: 12, color: txtSec, fontWeight: '800', marginTop: 4 }} numberOfLines={1}>{(variantGroup.choices || []).map((c) => c.label).join(' · ')}</Text>
                    : customizable && <Text style={{ fontSize: 12, color: txtSec, fontWeight: '800', marginTop: 4 }}>Customisable</Text>}
                </View>

                {/* Right image with floating ADD button */}
                <View style={st.imgBtnContainer} pointerEvents="box-none">
                  {itemImg ? (
                    <SafeImage source={{ uri: itemImg }} style={st.menuItemImg} placeholderIcon="fast-food-outline" />
                  ) : (
                    <View style={[st.menuItemImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#1F1F23' : '#F3F4F6' }]}>
                      <Ionicons name={isFoodStore ? 'restaurant-outline' : 'cube-outline'} size={28} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'} />
                    </View>
                  )}
                  <View style={st.floatingAddWrap} pointerEvents="box-none">
                    <MenuAddControl
                      itemId={itemId}
                      soldOut={soldOut}
                      customizable={customizable}
                      isAdded={isAdded}
                      blocked={!orderable || eliteLocked || stallOffline}
                      closed={!orderable || stallOffline}
                      eliteLocked={eliteLocked}
                      tint={brand ? accent : '#EF4F5F'}
                      onAdd={() => handleAddToCart(item)}
                    />
                  </View>
                </View>
              </CardPressable>
              </StaggeredSection>
            );
          })}
          {filteredMenu.length > menuLimit && (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator size="small" color={brand ? accent : '#EF4F5F'} />
            </View>
          )}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Floating Basket Bar (own component: re-renders alone when the basket changes) */}
      <RestaurantFloatingCart tint={brand ? accent : '#EF4F5F'} kind={basketKindOf({ isStall: isLocalVendor, vendorType: restaurant.vendorType })} onOpen={openBasket} />

      {customizingItem && (
        <CustomizeDrawer
          isOpen={!!customizingItem}
          onClose={() => setCustomizingItem(null)}
          onConfirm={handleCustomizeConfirm}
          itemName={customizingItem.name}
          basePrice={Number(customizingItem.price) || 0}
          tags={Array.isArray(customizingItem.tags) ? customizingItem.tags : []}
          category={customizingItem.category}
          isVegetarian={isVegItem(customizingItem)}
        />
      )}
      {pastHero ? <StatusBarScrim color={brand ? (brand.primaryColor || '#1A0000') : isDark ? COLORS.bgDark : COLORS.bgLight} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  emptyMenu: { alignItems: 'center', padding: 24, borderRadius: 20, borderWidth: 1, marginTop: 8 },
  emptyMenuBtn: { marginTop: 14, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  container: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { width: '100%', height: 200, position: 'relative' },
  heroImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  heroGrad: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  backBtn: { position: 'absolute', top: Platform.OS === 'android' ? 36 : 50, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  favoriteBtn: { position: 'absolute', top: Platform.OS === 'android' ? 36 : 50, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', zIndex: 2, ...SHADOWS.card },
  
  // Floating Card Overlap Style
  floatingInfoCard: { marginHorizontal: 16, marginTop: -32, borderRadius: 24, padding: 16, borderWidth: 1, ...SHADOWS.card, shadowOpacity: 0.15 },
  infoCardName: { fontSize: 20, fontWeight: '900', letterSpacing: 0.5, marginBottom: 4 },
  infoCardDesc: { fontSize: 12, fontWeight: '500', lineHeight: 14, marginBottom: 8 },
  localVendorBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginVertical: 4 },
  localVendorBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  statusBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  contactBtnText: { fontSize: 12, fontWeight: '800' },

  brandTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  brandTagText: { fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  menuTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 0.2, marginBottom: 2 },
  menuSub: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2, marginBottom: 16 },
  menuCard: { flexDirection: 'row', padding: 12, borderRadius: 24, marginBottom: 12, borderWidth: 1, alignItems: 'center' },
  menuInfo: { flex: 1, paddingRight: 12 },
  vegDot: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  vegDotInner: { width: 5, height: 5, borderRadius: 2.5 },
  nonVegTriangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 3.5,
    borderRightWidth: 3.5,
    borderBottomWidth: 6.5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#AF3F3F',
  },
  menuItemName: { fontSize: 13, fontWeight: '900', marginBottom: 2 },
  menuItemPrice: { fontSize: 14, fontWeight: '900', marginBottom: 4 },
  
  // Right Image container with floating button
  imgBtnContainer: { width: 90, height: 90, position: 'relative', alignItems: 'center', justifyContent: 'flex-end' },
  menuItemImg: { width: '100%', height: '100%', borderRadius: 16 },
  floatingAddWrap: { position: 'absolute', bottom: -8, zIndex: 10, width: '100%', alignItems: 'center' },
  menuAddBtn: { width: 72, paddingVertical: 6, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  menuAddBtnText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.2 },

  // Interactive stepper styles
  stepperWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 76,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    ...SHADOWS.card,
    elevation: 4,
  },
  stepperActionBtn: {
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperActionText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    lineHeight: 16,
  },
  stepperCountText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFFFFF',
  },

  // Promo Codes Styles
  promoTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 12 },
  promoSectionTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  swipeText: { fontSize: 12, fontWeight: '700' },
  promoCard: { width: 220, padding: 12, borderRadius: 16, borderStyle: 'dashed', borderWidth: 1.5, marginRight: 12 },
  promoCodeBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginBottom: 6 },
  promoCodeText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  promoDescText: { fontSize: 12, fontWeight: '800' },
  promoSubText: { fontSize: 12, fontWeight: '600', marginTop: 4 },

  // Category Filter Pills
  categoryScroll: { marginVertical: 12 },
  menuSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, height: 42, borderRadius: 14, borderWidth: 1 },
  menuSearchInput: { flex: 1, fontSize: 13, fontWeight: '600', paddingVertical: 0 },
  categoryPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8, borderWidth: 1 },
  categoryText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  shopChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // Floating Cart styles
  floatingCartContainer: {
    position: 'absolute', 
    bottom: 24, 
    left: 16, 
    right: 16, 
    zIndex: 100,
  },
  floatingCart: { 
    height: 56, 
    borderRadius: 28, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 24,
    shadowColor: '#EF4F5F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  badgeContainer: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  floatingCartText: { fontSize: 13, fontWeight: '900', letterSpacing: 0.2 },
  proceedText: { fontSize: 12, fontWeight: '900' },
});
// BUST_CACHE_2026_07_19_00_42
