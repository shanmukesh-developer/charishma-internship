import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import NightClosureBanner from '../../components/NightClosureBanner';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  Alert,
  FlatList,
  TextInput,
  RefreshControl,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import FssaiLine from '../../components/FssaiLine';
import { useAuth } from '../../context/AuthContext';
import { useCart, MAX_ITEM_QTY } from '../../context/CartContext';
import { productOptions, useAskOptions } from '../../components/ProductOptions';
import { API_URL } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import { useLiveSync } from '../../utils/useLiveSync';
import { readCache, writeCache } from '../../utils/swrCache';
import SafeImage from '../../components/SafeImage';
import { ShimmerCard } from '../../components/ShimmerLoader';
import ServiceBookingSheet from '../../modules/services/ServiceBookingSheet';
import ServicesHome from '../../modules/services/ServicesHome';
import { resolveServiceForm } from '../../modules/services/serviceForms';
import ServicesV2List from '../../modules/servicesV2/ServicesV2List';
import ServicesV2Products from '../../modules/servicesV2/ServicesV2Products';
import { isProductShelf, isServiceShelf } from '../../modules/servicesV2/servicesV2Data';
import { formatClock, formatINR, plural } from '../../utils/format';
import { goHome } from '../../utils/goHome';

const { width: SW } = Dimensions.get('window');

// App category ids that point at the same shelf
const CATEGORY_ALIASES: Record<string, string> = {
  grocery: 'groceries',
  express: 'groceries',
  kirana: 'groceries',
  stationery: 'stationary',
  bedding: 'mattresses',
  rental: 'rentals',
};

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const CATEGORY_META: Record<string, { title: string; subtitle: string; icon: IconName }> = {
  electronics: { title: 'Electronics and accessories', subtitle: 'Chargers, boards, gadgets and accessories', icon: 'hardware-chip-outline' },
  mattresses: { title: 'Mattresses and bedding', subtitle: 'Room essentials and move-in gear', icon: 'bed-outline' },
  groceries: { title: 'Kirana and late-night mart', subtitle: 'Snacks, noodles, drinks and essentials', icon: 'basket-outline' },
  repairs: { title: 'Laptop and phone repairs', subtitle: 'Screens, keyboards, upgrades and check-ups', icon: 'laptop-outline' },
  print: { title: 'Print and xerox', subtitle: 'Assignments, thesis binding and A3 drawings', icon: 'print-outline' },
  stationary: { title: 'Stationery and study kits', subtitle: 'Notebooks, pens, lab coats and supplies', icon: 'pencil-outline' },
  laundry: { title: 'Laundry and dry cleaning', subtitle: 'Washing, ironing and dry cleaning, collected from your hostel', icon: 'shirt-outline' },
  pharmacy: { title: 'Pharmacy', subtitle: 'Medicines, first aid and wellness', icon: 'medkit-outline' },
  rentals: { title: 'Rental stores', subtitle: 'Cycles, scooters and more', icon: 'bicycle-outline' },
  tailoring: { title: 'Tailoring and stitching', subtitle: 'Alterations, fitting and repairs', icon: 'cut-outline' },
  toys: { title: 'Toys and games', subtitle: 'Board games, puzzles and gifts', icon: 'game-controller-outline' },
  seeds: { title: 'Seeds and gardening', subtitle: 'Plants for your room and balcony', icon: 'leaf-outline' },
};
const FALLBACK_META = { title: 'Campus store', subtitle: 'Student essentials', icon: 'storefront-outline' as IconName };

const SERVICE_CATEGORIES = ['tailoring', 'repairs', 'print', 'laundry'];

interface CatalogueItem {
  id: string;
  name: string;
  price: number;
  originalPrice: number | null;
  discountPercent: number | null;
  image: string | null;
  emoji: string | null;
  desc: string;
  weight: string | null;
  restaurantId: string;
  restaurantName: string;
  storeId: string;
  bookingOnly: boolean;
  /** Server `orderable`: in stock AND the store is open right now. */
  orderable: boolean;
  inStock: boolean;
  /** Admin-set (or automatic weight) choices from the server: components/ProductOptions. */
  options?: any[];
}

interface StoreInfo {
  id: string; name: string; isOpen: boolean; opensAt: string | null; closedReason: string | null; fssaiLicenseNumber: string | null; campusClosed?: boolean;
  /** Delivery slots: closed right now but taking orders for its next slot (server takesSlotOrders). */
  takesSlotOrders?: boolean; nextSlotLabel?: string | null; nextSlotClosesAt?: string | null;
}
/** Can the basket take this store's items now (open, or orderable for a later slot)? */
const storeOrderable = (st: StoreInfo | undefined) => !st || st.isOpen || st.takesSlotOrders === true;

/** "7:00 AM" from the store's HH:MM opening time, or null when it is missing. */
const formatOpensAt = (hhmm: string | null) => (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm) ? formatClock(hhmm) : null);

/** Service shelves (repairs, tailoring, print, laundry) get the services page; every other shelf the store grid. */
export default function CategoryRoute() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const requestedId = String(rawId || 'electronics').toLowerCase().trim();
  const categoryId = CATEGORY_ALIASES[requestedId] || requestedId;
  // Tech & repairs v2 (modules/servicesV2): service lists and the Room essentials / Chargers & gadgets shelves.
  if (isServiceShelf(categoryId)) return <ServicesV2List key={categoryId} shelf={categoryId} />;
  if (isProductShelf(categoryId)) return <ServicesV2Products key={categoryId} shelf={categoryId} />;
  // Print stays on the older page so links from past print bookings still open (Printouts left the app).
  if (categoryId === 'print') return <ServicesHome key={categoryId} categoryId={categoryId} />;
  return <CategoryDetailScreen />;
}

function CategoryDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { user } = useAuth();
  // Shop categories fill the campus store basket.
  const { addToCart: addAnyBasket, baskets, basketCounts, basketTotals, updateQuantity } = useCart();
  const askOptions = useAskOptions();
  const cart = baskets.store;
  const totalItems = basketCounts.store;
  const totalPrice = basketTotals.store;
  const addToCart: typeof addAnyBasket = (item) => addAnyBasket({ ...item, basket: 'store' });

  const requestedId = String(rawId || 'electronics').toLowerCase().trim();
  const categoryId = CATEGORY_ALIASES[requestedId] || requestedId;
  const isServiceCategory = SERVICE_CATEGORIES.includes(categoryId);
  const meta = CATEGORY_META[categoryId] || FALLBACK_META;
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [stores, setStores] = useState<Record<string, StoreInfo>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Service booking sheet (modules/services/ServiceBookingSheet.tsx: per-service questions)
  const [selectedService, setSelectedService] = useState<CatalogueItem | null>(null);
  const [serviceModalVisible, setServiceModalVisible] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Print rates come from the same catalogue rows the print cards show
  const printRates = useMemo(() => {
    const find = (re: RegExp) => items.find((i) => re.test(i.name))?.price ?? null;
    return {
      bw: find(/black|b\s*&\s*w|b\/w/i),
      color: find(/colou?r/i),
      spiral: find(/spiral/i),
      hardbound: find(/hard\s*bound|thesis/i),
    };
  }, [items]);


  const applyCatalogue = useCallback((data: any) => {
    const storeMap: Record<string, StoreInfo> = {};
    (Array.isArray(data.stores) ? data.stores : []).forEach((st: any) => {
      const sid = String(st?.id || st?._id || '');
      if (sid) storeMap[sid] = {
        id: sid,
        name: String(st.name || ''),
        isOpen: st.isOpen !== false,
        opensAt: st.opensAt || null,
        closedReason: st.closedReason || null,
        campusClosed: !!st.campusClosed,
        takesSlotOrders: st.takesSlotOrders === true,
        nextSlotLabel: typeof st.nextSlotLabel === 'string' ? st.nextSlotLabel : null,
        nextSlotClosesAt: typeof st.nextSlotClosesAt === 'string' ? st.nextSlotClosesAt : null,
        fssaiLicenseNumber: typeof st.fssaiLicenseNumber === 'string' && st.fssaiLicenseNumber ? st.fssaiLicenseNumber : null,
      };
    });
    setStores(storeMap);
    setItems(data.items.map((it: any) => {
      const price = Number(it.price) || 0;
      const original = Number(it.originalPrice) || 0;
      return {
        id: String(it.id || it._id),
        name: String(it.name || ''),
        price,
        originalPrice: original > price ? original : null,
        discountPercent: original > price ? (Number(it.discountPercent) || Math.round((1 - price / original) * 100)) : null,
        image: it.imageUrl || it.image || null,
        emoji: it.emoji || null,
        desc: String(it.description || ''),
        weight: it.weight || null,
        restaurantId: String(it.restaurantId || it.storeId || ''),
        restaurantName: String(it.storeName || ''),
        storeId: String(it.storeId || it.restaurantId || ''),
        bookingOnly: !!it.bookingOnly,
        orderable: it.orderable !== false && it.isAvailable !== false,
        inStock: it.isAvailable !== false,
        ...(Array.isArray(it.options) && it.options.length ? { options: it.options } : {}),
      } as CatalogueItem;
    }));
  }, []);

  // 'silent' = live-sync background refresh: keep what is on screen, no spinner, no error screen
  const fetchCategoryItems = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (!CATEGORY_META[categoryId]) {
      setItems([]);
      setLoading(false);
      return;
    }
    const url = `${API_URL}/api/catalogue/items?type=${encodeURIComponent(categoryId)}&includeUnavailable=true`;
    const cacheKey = `catalogue:${categoryId}:all`;
    if (mode === 'initial') {
      // Stale-while-revalidate: show the last good shelf at once, refresh silently behind it
      const cached = await readCache<any>(cacheKey);
      if (cached?.data && Array.isArray(cached.data.items) && mountedRef.current) {
        applyCatalogue(cached.data);
        setLoading(false);
        mode = 'silent';
      } else setLoading(true);
    }
    try {
      const res = await apiFetch(url);
      const data = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (!res.ok || !data || !Array.isArray(data.items)) {
        if (mode !== 'silent') setLoadError((data && typeof data.message === 'string' && data.message) || 'We could not load this shelf right now. Try again in a moment.');
        return;
      }
      applyCatalogue(data);
      writeCache(cacheKey, data);
      setLoadError(null);
    } catch {
      if (mountedRef.current && mode !== 'silent') setLoadError('We could not connect. Check your internet connection and try again.');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [categoryId, applyCatalogue]);

  useEffect(() => {
    fetchCategoryItems('initial');
  }, [fetchCategoryItems]);

  // Live sync: price / stock / store-hours edits from admin or the store partner update this shelf in place
  useLiveSync({
    types: ['store', 'product'],
    onChange: () => { fetchCategoryItems('silent'); },
  });

  const onRefresh = () => {
    setRefreshing(true);
    fetchCategoryItems('refresh');
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredItems = useMemo(() => (q
    ? items.filter(item => item.name.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q))
    : items), [items, q]);

  // A closed store (outside its hours) can be browsed but not ordered from
  const closedStore = useMemo(() => Object.values(stores).find((st) => !st.isOpen) || null, [stores]);

  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const bg = colors.bg;
  const cardBg = colors.card;
  const border = colors.border;

  const lineFor = (itemId: string) => cart.find((i) => i.cartKey === itemId);

  const handleAction = (item: CatalogueItem) => {
    if (isServiceCategory || item.bookingOnly) {
      if (!item.inStock) {
        Alert.alert('Not taking bookings right now', `${item.name} is paused. Pick another service or check back later.`);
        return;
      }
      if (!user) {
        Alert.alert('Sign in to book', 'Sign in so the partner knows where to come and whom to call.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Sign in', onPress: () => router.push('/login' as any) },
        ]);
        return;
      }
      setSelectedService(item);
      setServiceModalVisible(true);
      return;
    }
    const store = stores[item.storeId];
    if (store && !storeOrderable(store)) {
      const opens = formatOpensAt(store.opensAt);
      Alert.alert(`${store.name || 'This store'} is closed`, store.closedReason || (opens ? `It opens at ${opens}.` : 'Check back later.'));
      return;
    }
    if (!item.orderable) {
      Alert.alert('Not available right now', `${item.name} cannot be ordered right now. Check back later.`);
      return;
    }
    // Products with choices (weights with their own prices, flavours): asked in the options sheet first; added
    // bare, checkout refused them ("please choose a Weight").
    const groups = productOptions(item);
    const finish = (extra: { price?: number; basePrice?: number; customizations?: any } = {}) => {
      const added = addToCart({
        id: item.id,
        name: item.name,
        price: item.price,
        image: item.image || '',
        quantity: 1,
        restaurantId: item.restaurantId,
        restaurantName: item.restaurantName || meta.title,
        ...extra,
      });
      if (added) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    };
    if (!groups.length) { finish(); return; }
    askOptions({ name: item.name, price: item.price, image: item.image || null, groups }).then((r) => {
      if (r) finish({ price: r.unitPrice, basePrice: item.price, customizations: r.customizations });
    });
  };

  // Light / dark tokens for this screen (stores use the app red; services use the booking sheet's blue)
  const t = {
    surface: isDark ? '#111114' : '#FFFFFF',
    soft: isDark ? 'rgba(255,255,255,0.06)' : '#F1F3F5',
    accent: isDark ? '#60A5FA' : '#1D4ED8',
    accentBg: isDark ? 'rgba(96,165,250,0.16)' : '#EFF4FF',
    primary: isServiceCategory ? (isDark ? '#3B82F6' : '#1D4ED8') : COLORS.red,
    muted: isDark ? '#3F3F46' : '#9CA3AF',
    link: isDark ? '#38BDF8' : '#0369A1',
  };

  const StateView = ({ icon, title, body, action, onAction }: { icon: IconName; title: string; body: string; action?: string; onAction?: () => void }) => (
    <View style={s.emptyState}>
      <View style={[s.stateIcon, { backgroundColor: t.soft }]}>
        <Ionicons name={icon} size={26} color={txtSec} />
      </View>
      <Text style={[s.stateTitle, { color: txt }]} accessibilityRole="header">{title}</Text>
      <Text style={[s.stateBody, { color: txtSec }]}>{body}</Text>
      {action && onAction ? (
        <TouchableOpacity style={[s.stateBtn, { borderColor: border }]} onPress={onAction} accessibilityRole="button" activeOpacity={0.8}>
          <Text style={[s.stateBtnText, { color: txt }]}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderEmpty = () => {
    if (!CATEGORY_META[categoryId]) {
      return (
        <StateView
          icon="compass-outline"
          title="This shelf is not open yet"
          body="We could not find this category. Browse the other stores instead."
          action="Browse stores"
          onAction={() => goHome(router, '/(tabs)/others')}
        />
      );
    }
    if (loadError) {
      return (
        <StateView
          icon="cloud-offline-outline"
          title="Could not load this shelf"
          body={loadError}
          action="Try again"
          onAction={() => { setLoading(true); setLoadError(null); fetchCategoryItems('initial'); }}
        />
      );
    }
    if (q) {
      return (
        <StateView
          icon="search-outline"
          title={`No results for “${searchQuery.trim()}”`}
          body="Check the spelling or try a shorter word."
          action="Clear search"
          onAction={() => setSearchQuery('')}
        />
      );
    }
    if (isServiceCategory) {
      return (
        <StateView
          icon={meta.icon}
          title="No services listed yet"
          body="Partners add their services here as they join. Pull down to refresh, or check back later."
        />
      );
    }
    return (
      <StateView
        icon={meta.icon}
        title="Nothing on this shelf yet"
        body="New items are added often."
      />
    );
  };

  // Price on a card. A service with a fixed card price is a starting price ("From ₹999");
  // print and laundry cards show their per-page / per-kg / per-piece rate as listed.
  const priceText = (item: CatalogueItem, isService: boolean) => {
    if (!isService) return formatINR(item.price);
    const form = resolveServiceForm(categoryId, item.name);
    // Only a starting price is "from"; a set charge (inspection, measurement visit) is just the price.
    return form.pricing.kind === 'fixed' && form.priceLabel === 'Starting price' ? `From ${formatINR(item.price)}` : formatINR(item.price);
  };

  const renderCard = ({ item }: { item: CatalogueItem }) => {
    const isService = isServiceCategory || item.bookingOnly;
    const line = isService ? undefined : lineFor(item.id);
    const storeClosed = !isService && !!stores[item.storeId] && !storeOrderable(stores[item.storeId]);
    const soldOut = !item.inStock;
    const actionLabel = isService ? (soldOut ? 'Paused' : 'Book') : soldOut ? 'Sold out' : storeClosed ? 'Closed' : 'Add';
    const price = priceText(item, isService);
    const priceNote = isService && categoryId === 'tailoring' && resolveServiceForm(categoryId, item.name).pricing.kind === 'perUnit' ? 'per piece' : null;
    const atMax = !!line && line.quantity >= MAX_ITEM_QTY;
    return (
      <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
        <View style={[s.imageBox, { backgroundColor: t.soft }]}>
          {item.image ? (
            <SafeImage source={{ uri: item.image }} style={[s.cardImg, soldOut && { opacity: 0.45 }]} maxWidth={300} />
          ) : (
            <View style={s.imagePlaceholder}>
              <Ionicons name={meta.icon} size={32} color={txtSec} />
            </View>
          )}
          {soldOut ? (
            <View style={[s.badge, { backgroundColor: '#374151' }]}>
              <Text style={s.badgeText}>{isService ? 'Paused' : 'Sold out'}</Text>
            </View>
          ) : !!item.discountPercent && item.discountPercent > 0 ? (
            <View style={[s.badge, { backgroundColor: COLORS.red }]}>
              <Text style={s.badgeText}>{item.discountPercent}% off</Text>
            </View>
          ) : null}
        </View>
        <View style={s.cardInfo}>
          <Text style={[s.itemName, { color: txt }]} numberOfLines={2}>{item.name}</Text>
          <Text style={[s.itemDesc, { color: txtSec }]} numberOfLines={2} ellipsizeMode="tail">
            {item.weight ? `${item.weight}${item.desc ? ' · ' : ''}` : ''}{item.desc}
          </Text>

          <View style={s.bottomRow}>
            <View style={{ flexShrink: 1, marginRight: 6 }}>
              <Text style={[s.itemPrice, { color: txt }]} numberOfLines={1}>{price}</Text>
              {!!priceNote && !item.originalPrice && (
                <Text style={[s.originalPrice, { color: txtSec, textDecorationLine: 'none' }]}>{priceNote}</Text>
              )}
              {!!item.originalPrice && (
                <Text style={[s.originalPrice, { color: txtSec }]} accessibilityLabel={`Was ${formatINR(item.originalPrice)}`}>
                  {formatINR(item.originalPrice)}
                </Text>
              )}
            </View>
            {line ? (
              <View style={[s.stepper, { backgroundColor: t.primary }]}>
                <TouchableOpacity
                  onPress={() => updateQuantity(line.cartKey, line.quantity - 1)}
                  style={s.stepBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove one ${item.name}`}
                >
                  <Ionicons name="remove" size={16} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={s.stepperQty} accessibilityLabel={`${line.quantity} in basket`}>{line.quantity}</Text>
                <TouchableOpacity
                  onPress={() => updateQuantity(line.cartKey, line.quantity + 1)}
                  disabled={atMax}
                  style={[s.stepBtn, atMax && { opacity: 0.4 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add one more ${item.name}`}
                  accessibilityState={{ disabled: atMax }}
                >
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: soldOut || storeClosed ? t.muted : t.primary }]}
                onPress={() => handleAction(item)}
                disabled={soldOut}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ disabled: soldOut }}
                accessibilityLabel={`${actionLabel} ${item.name}, ${price}${priceNote ? ` ${priceNote}` : ''}`}
              >
                <Text style={s.actionText}>{actionLabel}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  const opensAt = closedStore ? formatOpensAt(closedStore.opensAt) : null;

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border, backgroundColor: t.surface, paddingTop: Math.max(insets.top, 12) + 6 }]}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as any))}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={txt} />
        </TouchableOpacity>
        <View style={[s.headerIcon, { backgroundColor: t.soft }]}>
          <Ionicons name={meta.icon} size={20} color={txt} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: txt }]} numberOfLines={1} accessibilityRole="header">{meta.title}</Text>
          <Text style={[s.subText, { color: txtSec }]} numberOfLines={1}>{meta.subtitle}</Text>
        </View>
        <View style={[s.kindPill, { backgroundColor: isServiceCategory ? t.accentBg : t.soft }]}>
          <Text style={[s.kindText, { color: isServiceCategory ? t.accent : txtSec }]}>{isServiceCategory ? 'Service' : 'Store'}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={[s.searchWrap, { backgroundColor: t.soft }]}>
        <Ionicons name="search" size={16} color={txtSec} />
        <TextInput
          placeholder={`Search ${meta.title.toLowerCase()}…`}
          placeholderTextColor={txtSec}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={[s.searchInput, { color: txt }]}
          returnKeyType="search"
          maxLength={60}
          accessibilityLabel={`Search ${meta.title.toLowerCase()}`}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={s.clearBtn} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={txtSec} />
          </TouchableOpacity>
        )}
      </View>

      {categoryId === 'rentals' && (
        <TouchableOpacity
          onPress={() => router.push('/rentals' as any)}
          accessibilityRole="button"
          accessibilityLabel="Student vehicles: rent or borrow bikes, scooters and cars from verified students, or list yours. Opens student vehicles."
          style={[s.banner, { backgroundColor: isDark ? 'rgba(14,165,233,0.14)' : 'rgba(14,165,233,0.10)' }]}
        >
          <Ionicons name="bicycle-outline" size={18} color={t.link} />
          <Text style={[s.bannerText, { color: txt }]}>
            Student vehicles: rent or borrow bikes, scooters and cars from verified students, or list yours.
          </Text>
          <Ionicons name="chevron-forward" size={18} color={t.link} />
        </TouchableOpacity>
      )}

      {/* Campus night closure (9 PM to 6 AM): one clear banner instead of a "closed" line per store */}
      {!isServiceCategory && <NightClosureBanner style={{ marginBottom: 4 }} />}
      {!isServiceCategory && closedStore && !closedStore.campusClosed && (
        <View style={[s.banner, { backgroundColor: isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)' }]}>
          <Ionicons name="time-outline" size={18} color={txtSec} />
          <Text style={[s.bannerText, { color: txt }]}>
            {closedStore.takesSlotOrders && closedStore.nextSlotLabel
              ? `${closedStore.name || 'This store'} is closed right now. You can order for ${closedStore.nextSlotLabel}${closedStore.nextSlotClosesAt ? ` (order by ${closedStore.nextSlotClosesAt})` : ''}.`
              : closedStore.closedReason || `${closedStore.name || 'This store'} is closed${opensAt ? ` and opens at ${opensAt}` : ''}. You can browse now and order when it opens.`}
          </Text>
        </View>
      )}

      {/* Grid */}
      {loading && items.length === 0 ? (
        <View
          style={[s.listContent, { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 }]}
          accessible
          accessibilityLabel="Loading"
          accessibilityState={{ busy: true }}
        >
          {[0, 1, 2, 3].map((k) => <ShimmerCard key={k} style={{ width: (SW - 44) / 2, height: 236 }} />)}
        </View>
      ) : filteredItems.length > 0 ? (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          numColumns={2}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={[s.listContent, { paddingBottom: (!isServiceCategory && totalItems > 0 ? 110 : 32) + insets.bottom }]}
          columnWrapperStyle={s.columnWrapper}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} colors={[COLORS.red]} />}
          ListFooterComponent={!isServiceCategory && Object.keys(stores).length > 0 ? (
            <View style={{ paddingTop: 8, paddingBottom: 4 }}>
              {Object.values(stores).map((st) => (
                <FssaiLine
                  key={st.id}
                  number={st.fssaiLicenseNumber}
                  storeName={Object.keys(stores).length > 1 ? st.name || undefined : undefined}
                  color={txtSec}
                  style={{ textAlign: 'center', marginTop: 2 }}
                />
              ))}
            </View>
          ) : null}
          renderItem={renderCard}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={CATEGORY_META[categoryId] ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} colors={[COLORS.red]} /> : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {renderEmpty()}
        </ScrollView>
      )}

      {/* Basket bar (stores only) */}
      {!isServiceCategory && totalItems > 0 && (
        <TouchableOpacity
          style={[s.basketBar, { bottom: 16 + insets.bottom }]}
          onPress={() => router.push('/(tabs)/basket?basket=store' as any)}
          accessibilityRole="button"
          accessibilityLabel={`${plural(totalItems, 'item')} in basket, ${formatINR(totalPrice)}. View basket.`}
          activeOpacity={0.9}
        >
          <View>
            <Text style={s.basketCount}>{plural(totalItems, 'item')} in basket</Text>
            <Text style={s.basketTotal}>{formatINR(totalPrice)}</Text>
          </View>
          <View style={s.viewBasket}>
            <Text style={s.viewBasketText}>View basket</Text>
            <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
          </View>
        </TouchableOpacity>
      )}

      <ServiceBookingSheet
        visible={serviceModalVisible}
        item={selectedService}
        shelfId={categoryId}
        shelfTitle={meta.title}
        rates={printRates}
        onClose={() => setServiceModalVisible(false)}
        onServiceUnavailable={() => fetchCategoryItems('silent')}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12, paddingLeft: 4, paddingRight: 12, borderBottomWidth: 1, gap: 8 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
  subText: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  kindPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  kindText: { fontSize: 12, fontWeight: '700' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginVertical: 12, paddingLeft: 12, minHeight: 44, borderRadius: 12, gap: 8 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  clearBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, minHeight: 44 },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  listContent: { paddingHorizontal: 16 },
  columnWrapper: { justifyContent: 'space-between', marginBottom: 14 },
  card: { width: (SW - 44) / 2, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  imageBox: { width: '100%', height: 120 },
  cardImg: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  cardInfo: { padding: 10, flex: 1 },
  itemName: { fontSize: 14, fontWeight: '700', lineHeight: 18, minHeight: 36 },
  itemDesc: { fontSize: 12, lineHeight: 16, minHeight: 32, marginTop: 2 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  itemPrice: { fontSize: 15, fontWeight: '800' },
  originalPrice: { fontSize: 12, textDecorationLine: 'line-through' },
  actionBtn: { minWidth: 64, minHeight: 44, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, minHeight: 44 },
  stepBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepperQty: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', minWidth: 18, textAlign: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60, paddingBottom: 40 },
  stateIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  stateTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  stateBody: { fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  stateBtn: { marginTop: 18, minHeight: 44, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stateBtnText: { fontSize: 14, fontWeight: '700' },
  basketBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#047857',
    borderRadius: 14,
    paddingHorizontal: 16,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  basketCount: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  basketTotal: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  viewBasket: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.18)', paddingHorizontal: 12, minHeight: 36, borderRadius: 10 },
  viewBasketText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
