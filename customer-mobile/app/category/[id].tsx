import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import FssaiLine from '../../components/FssaiLine';
import { useAuth } from '../../context/AuthContext';
import { useCart, MAX_ITEM_QTY } from '../../context/CartContext';
import { API_URL } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import { useLiveSync } from '../../utils/useLiveSync';
import { readCache, writeCache } from '../../utils/swrCache';
import SafeImage from '../../components/SafeImage';
import { ShimmerCard } from '../../components/ShimmerLoader';
import ServiceBookingSheet from '../../modules/services/ServiceBookingSheet';

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

const CATEGORY_META: Record<string, { title: string; subtitle: string; icon: string }> = {
  electronics: { title: 'Electronics & Tech', subtitle: 'CHARGERS, BOARDS, GADGETS & ACCESSORIES', icon: '🔌' },
  mattresses: { title: 'Mattresses & Bedding', subtitle: 'ROOM ESSENTIALS & MOVE-IN GEAR', icon: '🛏️' },
  groceries: { title: 'Kirana & Late-Night Mart', subtitle: 'SNACKS, NOODLES, DRINKS & ESSENTIALS', icon: '🛒' },
  repairs: { title: 'Laptop & Tech Repairs', subtitle: 'DOORSTEP DIAGNOSTICS & HARDWARE FIX', icon: '💻' },
  print: { title: 'Printout & Xerox', subtitle: 'ASSIGNMENTS, THESIS BINDING & CAD', icon: '🖨️' },
  stationary: { title: 'Stationery & Study Kits', subtitle: 'NOTEBOOKS, PENS, LAB COATS & SUPPLIES', icon: '📓' },
  laundry: { title: 'Wash & Dry Clean', subtitle: 'HOSTEL DOORSTEP PICKUP & IRONING', icon: '🧺' },
  pharmacy: { title: 'Emergency Pharmacy', subtitle: 'MEDICINES, FIRST AID & WELLNESS', icon: '⚕️' },
  rentals: { title: 'Campus Rentals', subtitle: 'CYCLES, SCOOTERS & MORE', icon: '🚲' },
  tailoring: { title: 'Tailoring & Stitching', subtitle: 'CLOTHES ALTERATION, FITTING & REPAIRS', icon: '🪡' },
  toys: { title: 'Toys & Games', subtitle: 'BOARD GAMES, PUZZLES & GIFTS', icon: '🧸' },
  seeds: { title: 'Seeds & Gardening', subtitle: 'PLANTS FOR YOUR ROOM & BALCONY', icon: '🌱' },
};

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
}

interface StoreInfo { id: string; name: string; isOpen: boolean; opensAt: string | null; closedReason: string | null; fssaiLicenseNumber: string | null }

const formatOpensAt = (hhmm: string | null) => {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

export default function CategoryDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { user } = useAuth();
  const { addToCart, cart, updateQuantity, totalItems, totalPrice } = useCart();

  const requestedId = String(rawId || 'electronics').toLowerCase().trim();
  const categoryId = CATEGORY_ALIASES[requestedId] || requestedId;
  const isServiceCategory = SERVICE_CATEGORIES.includes(categoryId);
  const meta = CATEGORY_META[categoryId] || { title: 'Campus Store', subtitle: 'STUDENT ESSENTIALS', icon: '✨' };

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
  useEffect(() => () => { mountedRef.current = false; }, []);

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
        if (mode !== 'silent') setLoadError((data && typeof data.message === 'string' && data.message) || 'We could not load this store right now.');
        return;
      }
      applyCatalogue(data);
      writeCache(cacheKey, data);
      setLoadError(null);
    } catch {
      if (mountedRef.current && mode !== 'silent') setLoadError("Can't reach Zenvy right now. Check your internet and try again.");
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
        Alert.alert('Not taking bookings right now', `${item.name} is paused for now. Please pick another service or check back later.`);
        return;
      }
      if (!user) {
        Alert.alert('Sign in to book', 'Sign in so the partner knows where to pick up and whom to call.', [
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
    if (store && !store.isOpen) {
      const opens = formatOpensAt(store.opensAt);
      Alert.alert(`${store.name || 'This store'} is closed`, store.closedReason || (opens ? `It opens at ${opens}.` : 'Please check back later.'));
      return;
    }
    if (!item.orderable) {
      Alert.alert('Not available right now', `${item.name} can't be ordered at the moment. Please check back later.`);
      return;
    }
    const added = addToCart({
      id: item.id,
      name: item.name,
      price: item.price,
      image: item.image || '',
      quantity: 1,
      restaurantId: item.restaurantId,
      restaurantName: item.restaurantName || meta.title,
    });
    if (added) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const renderEmpty = () => {
    if (!CATEGORY_META[categoryId]) {
      return (
        <View style={s.emptyState}>
          <Text style={{ fontSize: 32, marginBottom: 8 }}>🧭</Text>
          <Text style={{ color: txt, fontSize: 15, fontWeight: '800' }}>This shelf isn't open yet</Text>
          <Text style={{ color: txtSec, fontSize: 12, marginTop: 4, textAlign: 'center', paddingHorizontal: 32 }}>We couldn't find this category. Explore the other stores instead.</Text>
          <TouchableOpacity style={[s.addBtn, { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10 }]} onPress={() => router.replace('/(tabs)/others' as any)}>
            <Text style={s.addBtnText}>EXPLORE STORES</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (loadError) {
      return (
        <View style={s.emptyState}>
          <Text style={{ fontSize: 32, marginBottom: 8 }}>📡</Text>
          <Text style={{ color: txt, fontSize: 15, fontWeight: '800' }}>Couldn't load this store</Text>
          <Text style={{ color: txtSec, fontSize: 12, marginTop: 4, textAlign: 'center', paddingHorizontal: 32 }}>{loadError}</Text>
          <TouchableOpacity style={[s.addBtn, { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10 }]} onPress={() => { setLoading(true); setLoadError(null); fetchCategoryItems('initial'); }}>
            <Text style={s.addBtnText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (q) {
      return (
        <View style={s.emptyState}>
          <Text style={{ fontSize: 32, marginBottom: 8 }}>🔍</Text>
          <Text style={{ color: txt, fontSize: 15, fontWeight: '800' }}>No match for "{searchQuery.trim()}"</Text>
          <Text style={{ color: txtSec, fontSize: 12, marginTop: 4 }}>Try a different word</Text>
          <TouchableOpacity style={[s.addBtn, { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10 }]} onPress={() => setSearchQuery('')}>
            <Text style={s.addBtnText}>CLEAR SEARCH</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={s.emptyState}>
        <Text style={{ fontSize: 32, marginBottom: 8 }}>📦</Text>
        <Text style={{ color: txt, fontSize: 15, fontWeight: '800' }}>Nothing on this shelf yet</Text>
        <Text style={{ color: txtSec, fontSize: 12, marginTop: 4, textAlign: 'center', paddingHorizontal: 32 }}>New items are added often. Need something now? Send it as a Mega Basket shopping list.</Text>
        <TouchableOpacity style={[s.addBtn, { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10 }]} onPress={() => router.push('/mega-basket' as any)}>
          <Text style={s.addBtnText}>OPEN MEGA BASKET</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border, backgroundColor: isDark ? '#111114' : '#FFF' }]}>
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
          <Text style={s.subText}>{meta.subtitle}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 18 }}>{meta.icon}</Text>
            <Text style={[s.title, { color: txt }]} numberOfLines={1}>{meta.title}</Text>
          </View>
        </View>
        <View style={{ backgroundColor: isServiceCategory ? 'rgba(59,130,246,0.12)' : 'rgba(16,185,129,0.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: isServiceCategory ? '#3B82F6' : '#10B981' }}>
          <Text style={{ fontSize: 9, fontWeight: '900', color: isServiceCategory ? '#3B82F6' : '#10B981', letterSpacing: 0.5 }}>
            {isServiceCategory ? '🛠️ CAMPUS SERVICE' : '🛍️ STORE'}
          </Text>
        </View>
      </View>

      {/* Search Filter */}
      <View style={[s.searchWrap, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}>
        <Text style={{ fontSize: 14 }}>🔍</Text>
        <TextInput
          placeholder={`Search in ${meta.title}...`}
          placeholderTextColor={txtSec}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={[s.searchInput, { color: txt }]}
          returnKeyType="search"
          maxLength={60}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: txtSec, fontSize: 12 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {categoryId === 'rentals' && (
        <TouchableOpacity
          onPress={() => router.push('/rentals' as any)}
          accessibilityRole="button"
          accessibilityLabel="Student vehicles: rent from verified students"
          style={[s.closedBanner, { backgroundColor: isDark ? 'rgba(14,165,233,0.14)' : 'rgba(14,165,233,0.10)' }]}
        >
          <Text style={{ fontSize: 14 }}>🏍️</Text>
          <Text style={{ flex: 1, color: txt, fontSize: 11, fontWeight: '700' }}>
            Student vehicles: rent bikes, scooters and cars from verified students, or rent out yours. <Text style={{ color: '#0EA5E9', fontWeight: '900' }}>Open ›</Text>
          </Text>
        </TouchableOpacity>
      )}

      {!isServiceCategory && closedStore && (
        <View style={[s.closedBanner, { backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)' }]}>
          <Text style={{ fontSize: 14 }}>🌙</Text>
          <Text style={{ flex: 1, color: txt, fontSize: 11, fontWeight: '700' }}>
            {closedStore.closedReason || `${closedStore.name || 'This store'} is closed${formatOpensAt(closedStore.opensAt) ? ` — opens ${formatOpensAt(closedStore.opensAt)}` : ''}. You can browse now and order when it opens.`}
          </Text>
        </View>
      )}

      {/* Grid List */}
      {loading && items.length === 0 ? (
        <View style={[s.listContent, { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 }]}>
          {[0, 1, 2, 3].map((k) => <ShimmerCard key={k} style={{ width: (SW - 44) / 2, height: 220 }} />)}
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
          contentContainerStyle={s.listContent}
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
          renderItem={({ item }) => {
            const isService = isServiceCategory || item.bookingOnly;
            const line = isService ? undefined : lineFor(item.id);
            const storeClosed = !isService && stores[item.storeId] && !stores[item.storeId].isOpen;
            // A closed store's items are "CLOSED", not "SOLD OUT" (the server's orderable is false for both)
            const soldOut = !item.inStock;
            return (
              <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                <View style={s.imageBox}>
                  {item.image ? (
                    <SafeImage source={{ uri: item.image }} style={[s.cardImg, soldOut && { opacity: 0.45 }]} maxWidth={300} />
                  ) : (
                    <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#1F1F23' : '#F3F4F6' }}>
                      <Text style={{ fontSize: 40 }}>{item.emoji || meta.icon}</Text>
                    </View>
                  )}
                  {!!item.discountPercent && item.discountPercent > 0 && (
                    <View style={s.discountBadge}>
                      <Text style={s.discountText}>{item.discountPercent}% OFF</Text>
                    </View>
                  )}
                  {soldOut && (
                    <View style={[s.discountBadge, { backgroundColor: '#374151', left: undefined, right: 8 }]}>
                      <Text style={s.discountText}>{isService ? 'PAUSED' : 'SOLD OUT'}</Text>
                    </View>
                  )}
                  {isService && !soldOut && (
                    <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                      <Text style={{ color: '#FCD34D', fontSize: 7.5, fontWeight: '900', letterSpacing: 0.5 }}>DOORSTEP</Text>
                    </View>
                  )}
                </View>
                <View style={s.cardInfo}>
                  <Text style={[s.itemName, { color: txt }]} numberOfLines={2}>{item.name}</Text>
                  {!!(item.desc || item.weight) && (
                    <Text style={s.itemDesc} numberOfLines={2}>{item.weight ? `${item.weight}${item.desc ? ' · ' : ''}` : ''}{item.desc}</Text>
                  )}

                  <View style={s.bottomRow}>
                    <View>
                      <Text style={[s.itemPrice, { color: txt }]}>₹{item.price}</Text>
                      {!!item.originalPrice && (
                        <Text style={s.originalPrice}>₹{item.originalPrice}</Text>
                      )}
                    </View>
                    {line ? (
                      <View style={s.stepper}>
                        <TouchableOpacity onPress={() => updateQuantity(line.cartKey, line.quantity - 1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          <Text style={s.stepperText}>−</Text>
                        </TouchableOpacity>
                        <Text style={s.stepperQty}>{line.quantity}</Text>
                        <TouchableOpacity
                          onPress={() => updateQuantity(line.cartKey, line.quantity + 1)}
                          disabled={line.quantity >= MAX_ITEM_QTY}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Text style={[s.stepperText, line.quantity >= MAX_ITEM_QTY && { opacity: 0.4 }]}>+</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[s.addBtn, isService && { backgroundColor: '#3B82F6' }, (soldOut || storeClosed) && { backgroundColor: '#9CA3AF' }]}
                        onPress={() => handleAction(item)}
                        disabled={soldOut}
                        activeOpacity={0.85}
                      >
                        <Text style={s.addBtnText}>{isService ? (soldOut ? 'UNAVAILABLE' : 'BOOK ➔') : soldOut ? 'SOLD OUT' : storeClosed ? 'CLOSED' : 'ADD +'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
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

      {/* Floating Cart Sticky Bar if items exist and NOT service category */}
      {!isServiceCategory && totalItems > 0 && (
        <TouchableOpacity
          style={s.floatingCartBar}
          onPress={() => router.push('/(tabs)/basket' as any)}
        >
          <View>
            <Text style={s.floatingCartCount}>{totalItems} ITEM{totalItems === 1 ? '' : 'S'} IN BASKET</Text>
            <Text style={s.floatingCartTotal}>₹{totalPrice}</Text>
          </View>
          <View style={s.viewCartBtn}>
            <Text style={s.viewCartText}>VIEW BASKET ➔</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 52 : 42,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backBtn: { paddingRight: 14, paddingVertical: 4 },
  backIcon: { fontSize: 32, fontWeight: '300', lineHeight: 32 },
  subText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, color: '#EF4444', marginBottom: 2 },
  title: { fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  serviceActionBtn: { backgroundColor: '#3B82F6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  serviceActionBtnText: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 13, fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 90 },
  columnWrapper: { justifyContent: 'space-between', marginBottom: 14 },
  card: {
    width: (SW - 44) / 2,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageBox: { width: '100%', height: 120, position: 'relative' },
  cardImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  discountBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#EF4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  discountText: { color: '#FFF', fontSize: 9, fontWeight: '900' },
  cardInfo: { padding: 10, flex: 1, justifyContent: 'space-between' },
  itemName: { fontSize: 13, fontWeight: '800', lineHeight: 17, marginBottom: 4 },
  itemDesc: { fontSize: 10, color: '#888', lineHeight: 14, marginBottom: 8 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  itemPrice: { fontSize: 14, fontWeight: '900' },
  originalPrice: { fontSize: 10, color: '#999', textDecorationLine: 'line-through' },
  addBtn: { backgroundColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addBtnText: { color: '#FFF', fontSize: 10, fontWeight: '900' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingBottom: 40 },
  closedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10, padding: 10, borderRadius: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  stepperText: { color: '#FFF', fontSize: 14, fontWeight: '900' },
  stepperQty: { color: '#FFF', fontSize: 12, fontWeight: '900', minWidth: 14, textAlign: 'center' },
  floatingCartBar: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  floatingCartCount: { color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  floatingCartTotal: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  viewCartBtn: { backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  viewCartText: { color: '#FFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
});
