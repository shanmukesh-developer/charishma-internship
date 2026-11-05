import React, { useState, useEffect, useRef, useCallback } from 'react';
import { rankRelated } from '../../utils/relatedItems';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  TextInput,
  Share,
} from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from '../../components/SafeImage';
import { peekCache, readCache, writeCache, peekCachedRestaurant } from '../../utils/swrCache';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS, RADIUS } from '../../constants/theme';
import { useCart, basketKindOf } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import CustomizeDrawer, { isCustomizable } from '../../components/CustomizeDrawer';
import { apiFetch } from '../../utils/auth';
import { useLiveSync, affectsProduct, affectsStore } from '../../utils/useLiveSync';
import { isLocalVendorType, vendorCallNumber, callVendor, stallPayCopy } from '../../utils/localVendor';
import { useTheme } from '../../context/ThemeContext';
import AdSlot from '../../components/AdSlot';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { formatINR, isAmount, plural } from '../../utils/format';
import FoodV2ProductView from '../../modules/foodV2/FoodV2ProductView';
import { fromPrice, productDetails, productOptions, useAskOptions } from '../../components/ProductOptions';
import FormattedDescription, { isStructured } from '../../components/FormattedDescription';
import { takesSlotOrders } from '../../utils/storeOpenNow';
import { goHome } from '../../utils/goHome';
import SymbolIcon from '../../components/SymbolIcon';

const { width: SW } = Dimensions.get('window');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVIEW_MAX = 500;
// Quick review tags: food tags only for food stores (see NON_FOOD_TYPES below).
const FOOD_REVIEW_TAGS = ['Tasty', 'Good portion', 'Fresh and hot', 'Spicy', 'Good value'];
const NON_FOOD_REVIEW_TAGS = ['Good quality', 'As described', 'Good value'];

// Vendor types where a veg / non-veg mark makes no sense.
const NON_FOOD_TYPES = ['ELECTRONICS', 'HOME_ESSENTIALS', 'STATIONERY', 'STATIONARY', 'TOYS', 'SEEDS', 'RENTALS', 'RENTAL', 'REPAIRS', 'PRINT', 'LAUNDRY', 'TAILORING', 'PHARMACY'];

// specs keys that are internal bookkeeping (or rendered elsewhere) and must not be listed as product details. The
// import scripts' markers (demoFillKey, demoStallKey, ownerMenuKey, hiddenBy, addedBy, priceApprox) and the admin's
// option switches (autoWeights, packGrams) used to show as "Demo Fill Key: ..." rows under More information
// ("Owner menu key: owner-menu:..." on the Amrutham dishes, 1 Nov; the server no longer stores it either).
const HIDDEN_SPEC_KEYS = ['catalogueKey', 'originalPrice', 'rating', 'ratingCount', 'bookingOnly', 'extraFor', 'emoji', 'legacyIds', 'variants',
  'options', 'details', 'sortOrder', 'customizable', 'images', 'demoFillKey', 'demoStallKey', 'ownerMenuKey', 'hiddenBy', 'addedBy', 'priceApprox',
  'autoWeights', 'packGrams'];

/** A pack weight stored as a bare number of grams reads "1 kg" / "500 g", never "1000". */
const packText = (raw: unknown): string | null => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1000 ? `${Number((n / 1000).toFixed(2))} kg` : `${n} g`;
};

/** Only real images: http(s) URLs and uploaded data:image URIs. Anything else -> no image (neutral placeholder). */
export function getRealImageUri(uri?: string | null): string | null {
  if (!uri || typeof uri !== 'string') return null;
  const u = uri.trim();
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:image/')) return u;
  return null;
}

/** "shelfLife" / "shelf_life" -> "Shelf life" (sentence case). */
function humanizeKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function specIcon(label: string): React.ComponentProps<typeof Ionicons>['name'] {
  const l = label.toLowerCase();
  if (l.includes('weight') || l.includes('pack') || l.includes('size') || l.includes('portion') || l.includes('serve')) return 'cube-outline';
  if (l.includes('brand')) return 'pricetag-outline';
  if (l.includes('spice')) return 'flame-outline';
  if (l.includes('allergen')) return 'warning-outline';
  if (l.includes('ingredient')) return 'list-outline';
  if (l.includes('shelf') || l.includes('fresh') || l.includes('expiry')) return 'time-outline';
  if (l.includes('storage')) return 'snow-outline';
  return 'information-circle-outline';
}

/** Turns MenuItem.specs into displayable rows. Only real, admin/restaurant-entered values are shown. */
function buildSpecRows(specs: any): { label: string; value: string }[] {
  if (!specs || typeof specs !== 'object') return [];
  // The admin's own product details, exactly in the order entered (docs/PRODUCT_OPTIONS.md).
  const own = productDetails({ specs });
  if (own) return own;
  const rows: { label: string; value: string }[] = [];
  Object.entries(specs).forEach(([key, raw]) => {
    if (HIDDEN_SPEC_KEYS.includes(key)) return;
    let value: string | null = null;
    const grams = key === 'weight' ? packText(raw) : null;
    if (grams) value = grams;
    else if (typeof raw === 'string') value = raw.trim();
    else if (typeof raw === 'number' && Number.isFinite(raw)) value = String(raw);
    else if (typeof raw === 'boolean') value = raw ? 'Yes' : 'No';
    else if (Array.isArray(raw)) value = raw.filter((x) => typeof x === 'string' || typeof x === 'number').join(', ');
    if (!value) return;
    rows.push({ label: key === 'weight' ? 'Pack size' : humanizeKey(key), value });
  });
  return rows;
}

function starsFor(avg: number): string {
  const full = Math.round(avg);
  return '★'.repeat(Math.max(0, Math.min(5, full))) + '☆'.repeat(Math.max(0, 5 - Math.min(5, full)));
}

/** Real photo, or a neutral (non-photographic) placeholder when there is none or it fails to load. */
function ProductPhoto({ uri, style, emoji, isDark }: { uri: string | null; style: any; emoji?: string; isDark: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  if (!uri || failed) {
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#1A1D24' : '#F1F5F9' }]}>
        {emoji ? (
          <Text style={{ fontSize: 44, opacity: 0.8 }}>{emoji}</Text>
        ) : (
          <Ionicons name="cube-outline" size={40} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'} />
        )}
      </View>
    );
  }
  return <Image source={{ uri }} style={style} resizeMode="cover" onError={() => setFailed(true)} />;
}

type LoadState = 'loading' | 'ready' | 'notfound' | 'error';

// Booking-only services (backend utils/vendorTypes.js) open their booking page
/** Store types sold on Others → Food & groceries (FoodV2ProductView). */
const SHOP_VENDOR_TYPES = ['GROCERY', 'TOYS', 'SEEDS', 'ELECTRONICS', 'BAKERY'];

const SERVICE_CATEGORY_BY_VENDOR: Record<string, string> = {
  REPAIRS: 'repairs',
  PRINT: 'print',
  LAUNDRY: 'laundry',
  TAILORING: 'tailoring',
};

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const cleanId = (Array.isArray(id) ? id[0] : id || '').replace(/\/$/, '').trim();

  const { cart, addToCart, updateQuantity } = useCart();
  const { user } = useAuth();
  const { isDark, colors } = useTheme();
  const [customizing, setCustomizing] = useState(false);
  const askOptions = useAskOptions();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [product, setProduct] = useState<any>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadMessage, setLoadMessage] = useState('');
  const [activeImgIndex, setActiveImgIndex] = useState(0);
  const [descExpanded, setDescExpanded] = useState(false);
  const [imgWidth, setImgWidth] = useState(SW);
  const [store, setStore] = useState<any>(null);
  const [moreItems, setMoreItems] = useState<any[]>([]);
  // Saved items live on this device (same 'zenvy_wishlist' list the Others tab shows).
  const [isSaved, setIsSaved] = useState(false);
  useEffect(() => {
    if (!cleanId) return;
    AsyncStorage.getItem('zenvy_wishlist').then((raw) => {
      if (!mountedRef.current || !raw) return;
      try {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) setIsSaved(list.some((f: any) => (typeof f === 'string' ? f : f?.id) === cleanId));
      } catch {}
    }).catch(() => {});
  }, [cleanId]);

  // Reviews (server is the single source of truth)
  const [reviewsList, setReviewsList] = useState<any[]>([]);
  const [averageRating, setAverageRating] = useState(0);
  const [totalRatingCount, setTotalRatingCount] = useState(0);
  const [distribution, setDistribution] = useState<Record<string, number>>({});
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [userRating, setUserRating] = useState(5);
  const [userReviewText, setUserReviewText] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submittingReview, setSubmittingReview] = useState(false);
  const submittingRef = useRef(false);

  const loadReviews = useCallback(async (productId: string) => {
    try {
      const res = await apiFetch(`/api/users/products/${encodeURIComponent(productId)}/reviews`);
      if (!res.ok) return;
      const data = await res.json();
      if (!mountedRef.current) return;
      const list = Array.isArray(data?.reviews) ? data.reviews : [];
      setReviewsList(list);
      setTotalRatingCount(Number(data?.totalCount) || list.length);
      setAverageRating(Number(data?.averageRating) || 0);
      setDistribution(data?.distribution && typeof data.distribution === 'object' ? data.distribution : {});
    } catch (e) {
      console.warn('[Reviews] Failed to load reviews:', e);
    }
  }, []);

  const applyStore = useCallback((data: any, productId: string) => {
    setStore(data);
    const menu = Array.isArray(data?.menu) ? data.menu : [];
    // Ranked by how related each dish is to this one (utils/relatedItems), not the first 10 on the menu.
    const self = menu.find((m: any) => m && String(m.id || m._id) === String(productId)) || { id: productId };
    setMoreItems(rankRelated(self, menu, { max: 10 }));
  }, []);

  const loadStoreAndMore = useCallback(async (restaurantId: string, productId: string) => {
    // The store is usually already cached (home list / store screen): show it while it refreshes
    const cachedStore = peekCache<any>(`restaurant:${restaurantId}`) || peekCachedRestaurant(restaurantId);
    if (cachedStore && mountedRef.current) applyStore(cachedStore, productId);
    try {
      const res = await apiFetch(`/api/users/restaurants/${encodeURIComponent(restaurantId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!mountedRef.current) return;
      applyStore(data, productId);
      if (data && (data.id || data._id)) writeCache(`restaurant:${restaurantId}`, data);
    } catch (e) {
      console.warn('[ProductDetail] store load failed:', e);
    }
  }, [applyStore]);

  // silent = live-sync background refresh: keep the page on screen, no spinner, no error screen
  const loadProduct = useCallback(async (opts?: { silent?: boolean }) => {
    let silent = !!opts?.silent;
    let storeRequested: string | null = null;
    if (!cleanId || !UUID_RE.test(cleanId)) {
      setProduct(null);
      setLoadState('notfound');
      return;
    }
    if (!silent) {
      // Reviews only need the id: load them alongside the product, not after it
      loadReviews(cleanId);
      // Stale-while-revalidate: the last good copy of this product paints at once
      const cached = await readCache<any>(`product:${cleanId}`);
      if (!mountedRef.current) return;
      if (cached?.data && cached.data.id) {
        setProduct(cached.data);
        setActiveImgIndex(0);
        setLoadState('ready');
        if (cached.data.restaurantId) {
          storeRequested = String(cached.data.restaurantId);
          loadStoreAndMore(cached.data.restaurantId, cached.data.id);
        }
        silent = true;
      } else {
        setLoadState('loading');
        setLoadMessage('');
      }
    }
    try {
      const res = await apiFetch(`/api/users/products/${encodeURIComponent(cleanId)}`);
      const data = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (res.status === 404) {
        setProduct(null);
        setLoadMessage(data?.message || '');
        setLoadState('notfound');
        return;
      }
      if (!res.ok || !data) {
        if (silent) return;
        setLoadMessage(data?.message || '');
        setLoadState('error');
        return;
      }
      const price = Number(data.price);
      const originalPrice = Number(data.originalPrice) > price ? Number(data.originalPrice) : null;
      const discountPercent = originalPrice ? Math.round((1 - price / originalPrice) * 100) : null;
      const images = [data.imageUrl, data.image, ...(Array.isArray(data.images) ? data.images : [])]
        .map(getRealImageUri)
        .filter((u, i, arr): u is string => !!u && arr.indexOf(u) === i);
      let specs = data.specs;
      if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch { specs = {}; } }
      const resolved = {
        id: data.id || data._id,
        name: data.name || '',
        price,
        originalPrice,
        discountPercent: discountPercent && discountPercent > 0 ? discountPercent : null,
        weight: data.weight || null,
        images,
        emoji: specs?.emoji || null,
        description: (data.description || '').trim(),
        isVegetarian: data.isVegetarian,
        category: data.category,
        restaurantName: data.restaurantName || null,
        restaurantId: data.restaurantId || null,
        vendorType: data.vendorType || null,
        isAvailable: data.isAvailable !== false,
        // A laundry / print / repairs / tailoring product is always a booking, even when the
        // store's product row was added without the bookingOnly flag.
        orderable: data.orderable !== false && !!data.restaurantId && !data.directOrderOnly
          && !data.bookingOnly && !SERVICE_CATEGORY_BY_VENDOR[String(data.vendorType || '').toUpperCase()],
        bookingOnly: !!data.bookingOnly || !!SERVICE_CATEGORY_BY_VENDOR[String(data.vendorType || '').toUpperCase()],
        // Legacy flag (older servers): the item could only be ordered off Zenvy
        directOrderOnly: !!data.directOrderOnly,
        // CampusBites stall item: ordered here, the stall delivers it (cash on delivery to the stall)
        isStall: isLocalVendorType(data.vendorType) || String(data.fulfilment || '').toUpperCase() === 'VENDOR',
        isVaultItem: !!data.isVaultItem,
        storeIsOpen: data.storeIsOpen !== false,
        storeClosedReason: data.storeClosedReason || null,
        // Delivery slots: the store is closed now but takes orders for its next slot (orderable already says so).
        takesSlotOrders: data.takesSlotOrders === true,
        nextSlotLabel: typeof data.nextSlotLabel === 'string' ? data.nextSlotLabel : null,
        specRows: buildSpecRows(specs),
        specs: specs && typeof specs === 'object' ? specs : null,
        // Customer choices from the server: the admin's, else automatic weights (docs/PRODUCT_OPTIONS.md).
        options: Array.isArray(data.options) ? data.options : undefined,
        tags: Array.isArray(data.tags) ? data.tags.filter((t: any) => typeof t === 'string') : [],
        isEliteOnly: !!data.isEliteOnly,
      };
      setProduct(resolved);
      writeCache(`product:${cleanId}`, resolved);
      if (silent) setActiveImgIndex((i) => (i < images.length ? i : 0));
      else setActiveImgIndex(0);
      setLoadState('ready');
      if (resolved.restaurantId && String(resolved.restaurantId) !== storeRequested) loadStoreAndMore(resolved.restaurantId, resolved.id);
    } catch (err) {
      console.warn('[ProductDetail] load failed:', err);
      if (mountedRef.current && !silent) setLoadState('error');
    }
  }, [cleanId, loadReviews, loadStoreAndMore]);

  useEffect(() => {
    setStore(null);
    setMoreItems([]);
    setReviewsList([]);
    setTotalRatingCount(0);
    setAverageRating(0);
    setDistribution({});
    loadProduct();
  }, [loadProduct]);

  // Live sync: price / stock / image edits to this item (or its store going offline) update in place
  const liveStoreId = product?.restaurantId || null;
  useLiveSync({
    types: ['store', 'product'],
    onChange: (events) => {
      if (affectsProduct(events, cleanId, liveStoreId)) loadProduct({ silent: true });
      else if (liveStoreId && affectsStore(events, liveStoreId)) loadStoreAndMore(liveStoreId, cleanId);
    },
  });

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  };

  /**
   * Swiggy-style single-store basket. CartContext.addToCart owns the "Replace basket?" prompt
   * (it keeps Mega Basket custom requests and queues rapid taps), so we only flag add-ons here.
   */
  const addWithStoreCheck = (payload: any) => {
    const isAddOn = String(product?.vendorType || '').toUpperCase() === 'EXTRAS';
    const typed = { ...payload, vendorType: product?.vendorType || undefined };
    addToCart(isAddOn ? { ...typed, isAddOn: true } : product?.isStall ? { ...typed, isStall: true } : typed);
  };

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const closeReviewModal = () => {
    if (submittingRef.current) return;
    setShowReviewModal(false);
  };

  const handleSaveReview = async () => {
    if (submittingRef.current || !product) return;
    submittingRef.current = true;
    setSubmittingReview(true);
    try {
      const res = await apiFetch(`/api/users/products/${encodeURIComponent(product.id)}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          rating: userRating,
          comment: userReviewText.trim(),
          tags: selectedTags,
          productName: product.name,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (res.status === 401) {
        Alert.alert('Sign in to rate', "Sign in to rate items you've ordered.", [
          { text: 'Not now', style: 'cancel' },
          { text: 'Sign in', onPress: () => { setShowReviewModal(false); router.push('/login' as any); } },
        ]);
        return;
      }
      if (!res.ok) {
        Alert.alert('Could not post review', data?.message || 'Something went wrong. Please try again.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setShowReviewModal(false);
      setUserReviewText('');
      setSelectedTags([]);
      setUserRating(5);
      Alert.alert('Review posted', 'Thanks for your review.');
      loadReviews(product.id);
    } catch (e) {
      if (mountedRef.current) Alert.alert('No connection', 'Could not reach ZenWe. Check your internet and try again.');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmittingReview(false);
    }
  };

  if (loadState === 'loading') {
    return (
      <View style={[styles.loadingBox, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={COLORS.red} />
        <Text style={{ marginTop: 12, fontSize: 12, fontWeight: '800', color: COLORS.inkMuted }}>
          Loading item…
        </Text>
      </View>
    );
  }

  if (loadState !== 'ready' || !product) {
    const isError = loadState === 'error';
    return (
      <View style={[styles.container, { backgroundColor: colors.bg, padding: 24, justifyContent: 'center', alignItems: 'center' }]}>
        <TouchableOpacity
          style={{ position: 'absolute', top: Platform.OS === 'android' ? 44 : 54, left: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}
          onPress={goBack}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <Ionicons name={isError ? 'cloud-offline-outline' : 'cube-outline'} size={44} color={colors.textSecondary} style={{ marginBottom: 16 }} />
        <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: 0.2, textAlign: 'center', marginBottom: 8 }}>
          {isError ? "Couldn't load this item" : 'Item not available'}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textSecondary, textAlign: 'center', lineHeight: 18, marginBottom: 24, paddingHorizontal: 20 }}>
          {isError
            ? (loadMessage || 'Check your internet connection and try again.')
            : (loadMessage || 'This item is no longer on the menu. Explore what else is available near you.')}
        </Text>
        {isError ? (
          <TouchableOpacity
            style={{ backgroundColor: COLORS.red, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 16, ...SHADOWS.redGlow }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              loadProduct();
            }}
          >
            <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '900' }}>Try again</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={{ backgroundColor: COLORS.red, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16, ...SHADOWS.redGlow }}
            onPress={() => goHome(router)}
          >
            <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '900' }}>Back to Home</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // The stepper edits the plain (no-customization) basket line, whose cartKey is the item id.
  const qty = cart.find((i: any) => i.cartKey === product.id)?.quantity || 0;
  const isFoodItem = !NON_FOOD_TYPES.includes(String(product.vendorType || '').toUpperCase());
  const showDietMark = typeof product.isVegetarian === 'boolean' && isFoodItem;
  const reviewTags = isFoodItem ? FOOD_REVIEW_TAGS : NON_FOOD_REVIEW_TAGS;
  const storeEta: string | null = store?.time || null;
  const eliteLocked = product.isEliteOnly && !(user as any)?.isElite;
  const canAdd = product.orderable && !!product.restaurantId && !eliteLocked && !product.directOrderOnly;
  const directOrder = !!product.directOrderOnly;
  const isStall = !!product.isStall;
  const stallName: string = store?.name || product.restaurantName || 'the stall';
  const stallCall = isStall ? vendorCallNumber(store) : null;
  const customizable = isCustomizable({ specs: product.specs });
  const unavailableReason: string = directOrder
    ? 'Order this from the stall directly'
    : product.isVaultItem
    ? 'Daily deal — claim it from Home'
    : eliteLocked
      ? 'For ZenWe Elite members only'
      : product.bookingOnly
      ? 'This is a doorstep service — book a pickup instead'
      : !product.isAvailable
        ? 'Sold out right now'
        : !product.storeIsOpen
          ? (product.storeClosedReason || 'Store is closed right now')
          : 'Not available to order right now';
  const images: (string | null)[] = product.images.length > 0 ? product.images : [null];

  const productPayload = () => ({
    id: product.id,
    name: product.name,
    price: product.price,
    image: product.images[0] || '',
    restaurantId: product.restaurantId,
    restaurantName: product.restaurantName || store?.name || '',
  });

  const handleToggleSaved = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const next = !isSaved;
    setIsSaved(next);
    try {
      const raw = await AsyncStorage.getItem('zenvy_wishlist');
      let list: any[] = [];
      try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
      if (!Array.isArray(list)) list = [];
      list = list.filter((f: any) => (typeof f === 'string' ? f : f?.id) !== product.id);
      if (next) {
        list.push({
          id: product.id,
          title: product.name,
          subtitle: [product.restaurantName, product.weight].filter(Boolean).join(' · ') || 'Campus store',
          price: formatINR(product.price),
          image: product.images[0] || '',
          targetRoute: `/products/${product.id}`,
        });
      }
      await AsyncStorage.setItem('zenvy_wishlist', JSON.stringify(list));
    } catch {
      if (mountedRef.current) setIsSaved(!next);
    }
  };

  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await Share.share({
        // No zenvy:// link: it opens nothing for friends who don't have the app yet.
        message: `Check out ${product.name}${product.restaurantName ? ` from ${product.restaurantName}` : ''} on ZenWe.`,
      });
    } catch (e) {
      // user dismissed the share sheet
    }
  };

  // Others → Food & groceries items (campus store, toys, seeds, electronics) use the Others layout;
  // food dishes, stalls and services keep this screen's own layout below.
  const isShopItem = SHOP_VENDOR_TYPES.includes(String(product.vendorType || '').toUpperCase()) && !isStall && !product.bookingOnly && !directOrder;

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0B0C10' : '#F8FAFC' }]}>
      {isShopItem ? (
        <FoodV2ProductView
          product={product}
          store={store}
          moreItems={moreItems}
          cart={cart}
          isDark={isDark}
          isSaved={isSaved}
          averageRating={averageRating}
          totalRatingCount={totalRatingCount}
          reviewsList={reviewsList}
          canAdd={canAdd}
          unavailableReason={unavailableReason}
          customizable={customizable}
          onBack={goBack}
          onToggleSaved={handleToggleSaved}
          onShare={handleShare}
          onAdd={addWithStoreCheck}
          onCustomize={() => setCustomizing(true)}
          onUpdateQuantity={updateQuantity}
          onOpenProduct={(pid) => router.push(`/products/${pid}` as any)}
          onOpenStore={() => { if (product.restaurantId) router.push(`/restaurant/${product.restaurantId}` as any); }}
          onOpenBasket={() => router.push(`/(tabs)/basket?basket=${basketKindOf({ isStall: !!product.isStall, vendorType: product.vendorType })}` as any)}
          onRate={() => {
            if (!user) {
              Alert.alert('Sign in to rate', "Sign in to rate items you've ordered.", [
                { text: 'Not now', style: 'cancel' },
                { text: 'Sign in', onPress: () => router.push('/login' as any) },
              ]);
              return;
            }
            setShowReviewModal(true);
          }}
          getImageUri={getRealImageUri}
        />
      ) : (<>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* ZONE 1 — IMAGE GALLERY */}
        <View
          style={styles.imageGalleryContainer}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) setImgWidth(w);
          }}
        >
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / (imgWidth || SW));
              setActiveImgIndex(idx);
            }}
            keyExtractor={(_, index) => index.toString()}
            renderItem={({ item }) => (
              <ProductPhoto
                uri={item}
                emoji={product.emoji}
                isDark={isDark}
                style={[styles.galleryImage, { width: imgWidth || SW }]}
              />
            )}
          />

          {/* Floating Top Nav Actions */}
          <View style={styles.galleryTopNav}>
            <TouchableOpacity style={styles.iconCircleBtn} onPress={goBack} accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={22} color={COLORS.ink} />
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={styles.iconCircleBtn} onPress={handleToggleSaved} accessibilityLabel={isSaved ? 'Remove from saved' : 'Save item'}>
                <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={18} color={isSaved ? '#EF4F5F' : '#334155'} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconCircleBtn} onPress={handleShare} accessibilityLabel="Share">
                <Ionicons name="share-outline" size={17} color="#334155" />
              </TouchableOpacity>
            </View>
          </View>

          {product.discountPercent ? (
            <View style={styles.galleryDiscountRibbon}>
              <Text style={styles.galleryDiscountText}>{product.discountPercent}% off</Text>
            </View>
          ) : null}

          {images.length > 1 && (
            <View style={styles.dotRow}>
              {images.map((_: any, i: number) => (
                <View key={i} style={[styles.dot, i === activeImgIndex && styles.dotActive]} />
              ))}
            </View>
          )}
        </View>

        {/* ZONE 2 — CORE INFO SHEET */}
        <View style={[styles.coreInfoSheet, { backgroundColor: isDark ? '#141418' : '#FFFFFF' }]}>
          <View style={styles.topBadgesRow}>
            {storeEta ? (
              <View style={styles.expressBadge}>
                <Text style={styles.expressBolt}>⏱</Text>
                <Text style={styles.expressText}>{String(storeEta)}</Text>
              </View>
            ) : null}

            {showDietMark && (
              <View style={[styles.fssaiBadge, product.isVegetarian ? styles.fssaiVegBadge : styles.fssaiNonVegBadge]}>
                <View style={[styles.fssaiSquare, { borderColor: product.isVegetarian ? '#16A34A' : '#DC2626' }]}>
                  <View style={[styles.fssaiCircle, { backgroundColor: product.isVegetarian ? '#16A34A' : '#DC2626' }]} />
                </View>
                <Text style={[styles.fssaiText, { color: product.isVegetarian ? '#15803D' : '#B91C1C' }]}>
                  {product.isVegetarian ? 'Veg' : 'Non-veg'}
                </Text>
              </View>
            )}

            <View style={styles.topRatingPill}>
              <Text style={styles.topRatingStar}>★</Text>
              {totalRatingCount > 0 ? (
                <>
                  <Text style={styles.topRatingScore}>{averageRating.toFixed(1)}</Text>
                  <Text style={styles.topRatingCount}>({totalRatingCount})</Text>
                </>
              ) : (
                <Text style={styles.topRatingScore}>New</Text>
              )}
            </View>
          </View>

          <Text style={[styles.productNameTitle, { color: isDark ? '#FFF' : '#0F172A' }]}>
            {product.name}
          </Text>

          {product.restaurantName ? (
            <TouchableOpacity
              style={styles.kitchenStoreRow}
              activeOpacity={0.7}
              disabled={!product.restaurantId}
              onPress={() => router.push(`/restaurant/${product.restaurantId}` as any)}
            >
              <Ionicons name="storefront-outline" size={13} color={isDark ? '#CBD5E1' : '#334155'} style={{ marginRight: 4 }} />
              <Text style={[styles.kitchenStoreName, { color: isDark ? '#CBD5E1' : '#334155' }]}>
                {product.restaurantName}
              </Text>
              {product.weight ? (
                <>
                  <View style={styles.kitchenDot} />
                  <Text style={[styles.kitchenStoreName, { color: isDark ? '#94A3B8' : '#64748B' }]}>{product.weight}</Text>
                </>
              ) : null}
            </TouchableOpacity>
          ) : null}

          <View style={styles.priceContainerRow}>
            <Text style={[styles.priceCurrentBig, { color: isDark ? '#FFF' : '#0F172A' }]}>
              {formatINR(product.price)}
            </Text>
            {product.originalPrice ? (
              <Text style={styles.priceOriginalStrikethrough}>{formatINR(product.originalPrice)}</Text>
            ) : null}
            {product.discountPercent ? (
              <View style={styles.priceDiscountChip}>
                <Text style={styles.priceDiscountChipText}>{product.discountPercent}% off</Text>
              </View>
            ) : null}
          </View>

          {isStall && (
            <View style={[styles.priceGuaranteeCard, { backgroundColor: isDark ? 'rgba(249,115,22,0.10)' : '#FFF7ED', borderColor: isDark ? 'rgba(249,115,22,0.3)' : '#FED7AA' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <Ionicons name="storefront-outline" size={16} color={isDark ? '#FDBA74' : '#9A3412'} />
                <Text style={[styles.priceGuaranteeSub, { color: isDark ? '#FDBA74' : '#9A3412', flex: 1 }]}>
                  {`${stallName} delivers this itself. ${stallPayCopy(stallName)}.`}
                </Text>
                {!!stallCall && (
                  <TouchableOpacity
                    onPress={() => callVendor(store)}
                    accessibilityLabel={`Call ${stallName}`}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: '#256FEF' }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>Call stall</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {!canAdd && (
            <View style={[styles.priceGuaranteeCard, { backgroundColor: isDark ? 'rgba(239,68,68,0.08)' : '#FEF2F2', borderColor: isDark ? 'rgba(239,68,68,0.25)' : '#FECACA' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <Ionicons name={directOrder ? 'storefront-outline' : product.isVaultItem ? 'gift-outline' : 'pause-circle-outline'} size={16} color={isDark ? '#FCA5A5' : '#B91C1C'} />
                <Text style={[styles.priceGuaranteeSub, { color: isDark ? '#FCA5A5' : '#B91C1C', flex: 1 }]}>{unavailableReason}</Text>
              </View>
            </View>
          )}
        </View>

        {/* ZONE 4 — PRODUCT DETAILS (only real data) */}
        {(product.description || product.specRows.length > 0) ? (
          <View style={[styles.pdpSectionBox, { backgroundColor: isDark ? '#141418' : '#FFFFFF' }]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.pdpSectionTitle, { color: isDark ? '#FFF' : '#0F172A' }]}>
                Product details
              </Text>
            </View>

            {product.description ? (
              <>
                {isStructured(product.description) && descExpanded ? (
                  // Expanded: the admin's own layout (headings, lists, "Label: value" lines).
                  <FormattedDescription text={product.description} color={isDark ? '#94A3B8' : '#475569'} strong={isDark ? '#FFFFFF' : '#0F172A'} />
                ) : (
                  <Text
                    style={[styles.pdpDescriptionText, { color: isDark ? '#94A3B8' : '#475569' }]}
                    numberOfLines={descExpanded ? undefined : 3}
                  >
                    {product.description}
                  </Text>
                )}
                {product.description.length > 140 && (
                  <TouchableOpacity onPress={() => setDescExpanded(!descExpanded)} style={styles.readMoreTouch}>
                    <Text style={styles.readMoreLink}>{descExpanded ? 'Show less ▴' : 'Read more ▾'}</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : null}

            {product.specRows.length > 0 && (
              <View
                style={[
                  styles.specsCard,
                  { backgroundColor: isDark ? '#1A1D24' : '#FAFAFA', borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0' },
                ]}
              >
                {product.specRows.map((attr: any, idx: number) => (
                  <View
                    key={attr.label}
                    style={[
                      styles.specItemRow,
                      idx < product.specRows.length - 1 && styles.specItemBorder,
                      { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' },
                    ]}
                  >
                    <View style={styles.specIconBadge}>
                      <Ionicons name={specIcon(attr.label)} size={14} color="#64748B" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.specLabel}>{attr.label}</Text>
                      <Text style={[styles.specValue, { color: isDark ? '#F1F5F9' : '#1E293B' }]}>{attr.value}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {/* ZONE 5 — MORE FROM THIS STORE (real menu items, same store) */}
        {moreItems.length > 0 && (
          <View style={[styles.pdpSectionBox, { backgroundColor: isDark ? '#141418' : '#FFFFFF' }]}>
            <View style={{ marginBottom: 14 }}>
              <Text style={[styles.pdpSectionTitle, { color: isDark ? '#FFF' : '#0F172A', marginBottom: 2 }]}>
                More from {store?.name || product.restaurantName}
              </Text>
              <Text style={styles.sectionSub}>{directOrder ? 'Order directly from the stall' : isStall ? `Add to the same ${stallName} order` : 'Add to the same order'}</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
              {moreItems.map((rel: any) => {
                const relId = rel.id || rel._id;
                const relQty = cart.find((i: any) => i.cartKey === relId)?.quantity || 0;
                const relImg = getRealImageUri(rel.imageUrl || rel.image);
                // The related dish's own availability (this product being sold out must not block its neighbours)
                const relCanAdd = !!product.restaurantId && !product.isVaultItem && !directOrder && rel.orderable !== false && (store?.isOpen !== false || takesSlotOrders(store)) && !(rel.isEliteOnly && !(user as any)?.isElite);
                const relPayload = {
                  id: relId,
                  name: rel.name,
                  price: Number(rel.price),
                  image: relImg || '',
                  restaurantId: product.restaurantId,
                  restaurantName: store?.name || product.restaurantName || '',
                };
                return (
                  <TouchableOpacity
                    key={relId}
                    activeOpacity={0.85}
                    onPress={() => router.push(`/products/${relId}` as any)}
                    style={[
                      styles.pairingCard,
                      { backgroundColor: isDark ? '#1A1D24' : '#FFFFFF', borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0' },
                    ]}
                  >
                    <View style={styles.pairingImgContainer}>
                      <ProductPhoto uri={relImg} isDark={isDark} style={styles.pairingImg} />
                    </View>

                    <View style={styles.pairingContent}>
                      <Text style={[styles.pairingTitle, { color: isDark ? '#FFF' : '#0F172A' }]} numberOfLines={2}>
                        {rel.name}
                      </Text>

                      <View style={styles.pairingFooterRow}>
                        {isAmount(rel.price) ? (
                          <Text style={[styles.pairingPrice, { color: isDark ? '#FFF' : '#0F172A' }]}>{formatINR(rel.price)}</Text>
                        ) : <View />}

                        {!relCanAdd ? null : relQty === 0 ? (
                          <TouchableOpacity
                            style={styles.pairingAddBtn}
                            activeOpacity={0.8}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                              addWithStoreCheck(relPayload);
                            }}
                          >
                            <Text style={styles.pairingAddBtnText}>Add</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.pairingMiniStepper}>
                            <TouchableOpacity
                              style={styles.pairingMiniStepBtn}
                              onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                updateQuantity(relId, relQty - 1);
                              }}
                            >
                              <Text style={styles.pairingMiniStepText}>–</Text>
                            </TouchableOpacity>
                            <Text style={styles.pairingMiniStepVal}>{relQty}</Text>
                            <TouchableOpacity
                              style={styles.pairingMiniStepBtn}
                              disabled={relQty >= 20}
                              onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                updateQuantity(relId, relQty + 1);
                              }}
                            >
                              <SymbolIcon name="add" style={styles.pairingMiniStepText} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ZONE 6 — RATINGS & REVIEWS (server data only) */}
        <View style={[styles.pdpSectionBox, { backgroundColor: isDark ? '#141416' : '#FFF' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={[styles.pdpSectionTitle, { color: isDark ? '#FFF' : COLORS.ink, marginBottom: 2 }]}>
                Ratings and reviews
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? '#9CA3AF' : COLORS.inkMuted }}>
                From customers who ordered this item
              </Text>
            </View>

            <TouchableOpacity
              style={styles.writeReviewTopBtn}
              onPress={() => {
                if (!user) {
                  Alert.alert('Sign in to rate', "Sign in to rate items you've ordered.", [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'Sign in', onPress: () => router.push('/login' as any) },
                  ]);
                  return;
                }
                setShowReviewModal(true);
              }}
            >
              <Text style={styles.writeReviewTopBtnText}>Rate this item</Text>
            </TouchableOpacity>
          </View>

          {totalRatingCount > 0 && (
            <View style={[styles.ratingOverviewBox, { backgroundColor: isDark ? '#1C1C20' : '#F9FAFB' }]}>
              <View style={{ alignItems: 'center', width: 90 }}>
                <Text style={[styles.bigRatingScore, { color: isDark ? '#FFF' : COLORS.ink }]}>
                  {averageRating.toFixed(1)}
                </Text>
                <Text style={{ fontSize: 13, marginVertical: 2, color: '#F59E0B', letterSpacing: 1 }}>{starsFor(averageRating)}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: isDark ? '#9CA3AF' : COLORS.inkMuted }}>
                  {plural(totalRatingCount, 'rating')}
                </Text>
              </View>

              <View style={{ flex: 1, paddingLeft: 16, gap: 4 }}>
                {[5, 4, 3, 2, 1].map((starNum) => {
                  const count = Number(distribution?.[starNum]) || 0;
                  const pct = totalRatingCount > 0 ? Math.round((count / totalRatingCount) * 100) : 0;
                  const pctStr = `${pct}%`;
                  return (
                    <View key={starNum} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: isDark ? '#9CA3AF' : '#6B7280', width: 14 }}>
                        {starNum}★
                      </Text>
                      <View style={{ flex: 1, height: 6, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                        <View style={{ width: (pctStr as any), height: '100%', backgroundColor: starNum >= 4 ? '#22C55E' : starNum === 3 ? '#F59E0B' : '#EF4444', borderRadius: 3 }} />
                      </View>
                      <Text style={{ fontSize: 12, color: isDark ? '#9CA3AF' : '#6B7280', width: 26, textAlign: 'right' }}>
                        {pctStr}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {reviewsList.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 }}>
              <Ionicons name="star-outline" size={30} color="#F59E0B" style={{ marginBottom: 8 }} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: isDark ? '#FFF' : COLORS.ink, textAlign: 'center', marginBottom: 4 }}>
                No reviews yet
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? '#9CA3AF' : COLORS.inkMuted, textAlign: 'center', lineHeight: 18 }}>
                Ordered this before? Be the first to rate it.
              </Text>
            </View>
          ) : (
            reviewsList.map((rev: any) => (
              <View key={rev.id} style={[styles.reviewCard, { backgroundColor: isDark ? '#1A1A1E' : '#F9FAFB' }]}>
                <View style={styles.reviewUserRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={[styles.reviewUserName, { color: isDark ? '#FFF' : COLORS.ink }]}>{rev.name || 'ZenWe customer'}</Text>
                      {rev.verified ? (
                        <View style={styles.verifiedBadge}>
                          <Text style={styles.verifiedBadgeText}>Ordered</Text>
                        </View>
                      ) : null}
                    </View>
                    {rev.time ? <Text style={styles.reviewTime}>{rev.time}</Text> : null}
                  </View>
                  <View style={styles.starScoreChip}>
                    <Text style={styles.starScoreChipText}>{rev.rating} ★</Text>
                  </View>
                </View>
                {rev.comment ? (
                  <Text style={[styles.reviewComment, { color: isDark ? '#E5E7EB' : COLORS.ink }]}>{rev.comment}</Text>
                ) : null}
                {Array.isArray(rev.tags) && rev.tags.length > 0 ? (
                  <Text style={[styles.reviewTime, { marginTop: 6 }]}>{rev.tags.join(' · ')}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>

        {/* ZONE 7 — SPONSORED AD SLOT */}
        <View style={{ paddingHorizontal: 16 }}>
          <AdSlot placement="pdp_footer" />
        </View>
      </ScrollView>

      {/* ZONE 3 — STICKY BOTTOM ACTION BAR */}
      <View
        style={[
          styles.stickyBottomBar,
          {
            backgroundColor: isDark ? '#111317' : '#FFFFFF',
            borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
        {qty === 0 || !canAdd ? (
          <>
            <View style={styles.bottomPriceCol}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text style={[styles.bottomPriceBig, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                  {formatINR(fromPrice(productOptions(product)) ?? product.price)}
                </Text>
                {product.originalPrice ? (
                  <Text style={styles.bottomPriceStrikethrough}>{formatINR(product.originalPrice)}</Text>
                ) : null}
              </View>
              <Text style={styles.bottomPriceSub} numberOfLines={1}>{directOrder ? 'Price listed by the stall' : isStall ? stallPayCopy(stallName) : 'Final bill at checkout'}</Text>
            </View>

            {canAdd ? (
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.bottomAddCtaBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  // Admin-set choices (weights, flavours, types) are asked in the options sheet first.
                  const groups = productOptions(product);
                  if (groups.length) {
                    askOptions({ name: product.name, price: Number(product.price) || 0, image: product.images[0] || null, groups }).then((r) => {
                      if (r) addWithStoreCheck({ ...productPayload(), price: r.unitPrice, basePrice: Number(product.price) || 0, customizations: r.customizations });
                    });
                  } else if (customizable) setCustomizing(true);
                  else addWithStoreCheck(productPayload());
                }}
              >
                <LinearGradient colors={['#10B981', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bottomCtaGradient}>
                  <Text style={styles.bottomAddCtaText}>{customizable ? 'Customise and add' : 'Add to basket'}</Text>
                  <SymbolIcon name="add" style={styles.bottomAddPlusText} />
                </LinearGradient>
              </TouchableOpacity>
            ) : (directOrder || isStall) && product.restaurantId ? (
              <TouchableOpacity activeOpacity={0.86} style={styles.bottomAddCtaBtn} onPress={() => router.push(`/restaurant/${product.restaurantId}` as any)}>
                <LinearGradient colors={['#F97316', '#EA580C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bottomCtaGradient}>
                  <Text style={styles.bottomAddCtaText}>View stall</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : product.bookingOnly && SERVICE_CATEGORY_BY_VENDOR[String(product.vendorType || '').toUpperCase()] ? (
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.bottomAddCtaBtn}
                onPress={() => router.push(`/category/${SERVICE_CATEGORY_BY_VENDOR[String(product.vendorType || '').toUpperCase()]}` as any)}
              >
                <LinearGradient colors={['#3B82F6', '#2563EB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bottomCtaGradient}>
                  <Text style={styles.bottomAddCtaText}>Book this service</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : product.isVaultItem ? (
              // The deals list itself (same vault list and claim as Home's Daily deals card); it used to drop the user on Home.
              <TouchableOpacity activeOpacity={0.86} style={styles.bottomAddCtaBtn} onPress={() => router.push('/deals/today' as any)}>
                <LinearGradient colors={['#F59E0B', '#D97706']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bottomCtaGradient}>
                  <Text style={styles.bottomAddCtaText}>Go to daily deals</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <View style={[styles.bottomAddCtaBtn, { opacity: 0.55 }]}>
                <LinearGradient colors={['#9CA3AF', '#6B7280']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bottomCtaGradient}>
                  <Text style={styles.bottomAddCtaText}>{!product.isAvailable ? 'Sold out' : 'Unavailable'}</Text>
                </LinearGradient>
              </View>
            )}
          </>
        ) : (
          <>
            <View
              style={[
                styles.activeStepperPill,
                { backgroundColor: isDark ? '#1E232B' : '#F1F5F9', borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : '#10B981' },
              ]}
            >
              <TouchableOpacity
                style={styles.activeStepperBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  updateQuantity(product.id, qty - 1);
                }}
              >
                <Text style={styles.activeStepperBtnText}>–</Text>
              </TouchableOpacity>
              <Text style={[styles.activeStepperCountText, { color: isDark ? '#FFF' : '#0F172A' }]}>{qty}</Text>
              <TouchableOpacity
                style={[styles.activeStepperBtn, qty >= 20 && { opacity: 0.4 }]}
                disabled={qty >= 20}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  updateQuantity(product.id, qty + 1);
                }}
              >
                <SymbolIcon name="add" style={styles.activeStepperBtnText} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.88}
              style={styles.bottomViewCartBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                router.push(`/(tabs)/basket?basket=${basketKindOf({ isStall: !!product.isStall, vendorType: product.vendorType })}` as any);
              }}
            >
              <LinearGradient colors={['#10B981', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bottomCtaGradient}>
                <View>
                  <Text style={styles.bottomCartTotalLabel}>{plural(qty, 'item')}</Text>
                  <Text style={styles.bottomCartTotalVal}>{formatINR(qty * (Number(product.price) || 0))}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Text style={styles.bottomViewCartText}>View basket</Text><SymbolIcon name="chevron-forward" style={styles.bottomViewCartText} scale={1} /></View>
              </LinearGradient>
            </TouchableOpacity>
          </>
        )}
      </View>
      </>)}

      {customizing && (
        <CustomizeDrawer
          isOpen={customizing}
          onClose={() => setCustomizing(false)}
          onConfirm={(customizations, finalPrice) => {
            setCustomizing(false);
            addWithStoreCheck({ ...productPayload(), price: finalPrice, basePrice: product.price, customizations });
          }}
          itemName={product.name}
          basePrice={Number(product.price) || 0}
          tags={product.tags}
          category={product.category}
          isVegetarian={product.isVegetarian !== false}
        />
      )}

      {/* ── Rate & Review Modal ── */}
      <Modal visible={showReviewModal} transparent animationType="slide" onRequestClose={closeReviewModal}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBackdrop}>
            <ScrollView
              style={{ width: '100%', maxWidth: 420 }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.modalCard, { backgroundColor: isDark ? '#18181B' : '#FFF' }]}>
                <Text style={[styles.modalTitle, { color: isDark ? '#FFF' : COLORS.ink }]}>Rate this item</Text>
                <Text style={{ fontSize: 12, color: isDark ? '#9CA3AF' : COLORS.inkMuted, marginBottom: 16 }}>
                  How was {product.name}? Reviews are open to customers who received this item.
                </Text>

                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 18 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity
                      key={star}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setUserRating(star);
                      }}
                      accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`}
                    >
                      <Text style={{ fontSize: 32, color: '#F59E0B' }}>{star <= userRating ? '★' : '☆'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {reviewTags.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <TouchableOpacity
                        key={tag}
                        style={[styles.tagPill, isSelected && styles.tagPillActive]}
                        onPress={() => handleToggleTag(tag)}
                      >
                        <Text style={[styles.tagPillText, isSelected && { color: '#FFF' }]}>{tag}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TextInput
                  style={[styles.reviewTextInput, { color: isDark ? '#FFF' : COLORS.ink, borderColor: isDark ? 'rgba(255,255,255,0.15)' : '#E5E7EB' }]}
                  placeholder="What did you like or dislike? (optional)"
                  placeholderTextColor={isDark ? COLORS.textMuted : '#9CA3AF'}
                  multiline
                  numberOfLines={3}
                  maxLength={REVIEW_MAX}
                  value={userReviewText}
                  onChangeText={setUserReviewText}
                />
                <Text style={{ fontSize: 12, color: isDark ? '#9CA3AF' : '#9CA3AF', textAlign: 'right', marginTop: 4 }}>
                  {userReviewText.length}/{REVIEW_MAX}
                </Text>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <TouchableOpacity
                    style={[styles.modalCloseBtn, { flex: 1, backgroundColor: isDark ? '#27272A' : '#F3F4F6' }]}
                    onPress={closeReviewModal}
                    disabled={submittingReview}
                  >
                    <Text style={[styles.modalCloseBtnText, { color: isDark ? '#FFF' : '#374151' }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.submitReviewBtn, { flex: 1.5 }, submittingReview && { opacity: 0.7 }]}
                    onPress={handleSaveReview}
                    disabled={submittingReview}
                  >
                    {submittingReview ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={styles.submitReviewBtnText}>Submit review</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}



const styles = StyleSheet.create({
  container: {
    flex: 1,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ZONE 1: IMAGE GALLERY
  imageGalleryContainer: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 440,
    position: 'relative',
    backgroundColor: '#F8FAFC',
  },
  galleryImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  galleryTopNav: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  iconCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.cardElevated,
  },
  iconCircleText: {
    fontSize: 24,
    fontWeight: '900',
    color: COLORS.ink,
    marginTop: -2,
  },
  galleryDiscountRibbon: {
    position: 'absolute',
    top: 70,
    left: 16,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
  },
  galleryDiscountText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFF',
  },
  dotRow: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(20, 19, 31, 0.3)',
  },
  dotActive: {
    width: 18,
    backgroundColor: COLORS.primary,
  },

  // ZONE 2: CORE INFO SHEET
  coreInfoSheet: {
    marginTop: -24,
    backgroundColor: '#FFF',
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    padding: 20,
    ...SHADOWS.cardElevated,
  },
  // ZONE 2: TOP BADGES & CORE INFO
  topBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  expressBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  expressBolt: {
    fontSize: 12,
    color: '#B45309',
  },
  expressText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#92400E',
    letterSpacing: 0.3,
  },
  fssaiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 5,
    borderWidth: 1,
    gap: 5,
  },
  fssaiVegBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderColor: '#22C55E',
  },
  fssaiNonVegBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: '#EF4444',
  },
  fssaiSquare: {
    width: 13,
    height: 13,
    borderWidth: 1.5,
    borderRadius: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fssaiCircle: {
    width: 5.5,
    height: 5.5,
    borderRadius: 3,
  },
  fssaiText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  topRatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
    gap: 4,
  },
  topRatingStar: {
    fontSize: 12,
  },
  topRatingScore: {
    fontSize: 12,
    fontWeight: '900',
    color: '#D97706',
  },
  topRatingCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  productNameTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
    lineHeight: 28,
    marginBottom: 4,
  },
  kitchenStoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  kitchenStoreName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  kitchenDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#94A3B8',
  },
  kitchenVerifiedText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#10B981',
  },
  unitSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  unitPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  unitPillLight: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  unitPillDark: {
    backgroundColor: '#1E232B',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  unitPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  unitPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
  },
  unitPillTextActive: {
    color: '#FFFFFF',
  },
  priceContainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  priceCurrentBig: {
    fontSize: 26,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  priceOriginalStrikethrough: {
    fontSize: 15,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  priceDiscountChip: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priceDiscountChipText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#DC2626',
    letterSpacing: 0.2,
  },
  priceGuaranteeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  shieldIconPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceGuaranteeTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#047857',
    letterSpacing: 0.1,
  },
  priceGuaranteeSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
    marginTop: 1,
  },
  priceGuaranteeCompareLink: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },

  // ZONE 4: DETAILS, HIGHLIGHTS MATRIX & CULINARY SPECS
  pdpSectionBox: {
    marginTop: 10,
    padding: 18,
    borderRadius: 16,
    ...SHADOWS.cardElevated,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  pdpSectionTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  sectionSub: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },
  chefHatPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chefHatPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B45309',
  },
  pdpDescriptionText: {
    fontSize: 12.5,
    lineHeight: 19,
    letterSpacing: 0.1,
  },
  readMoreTouch: {
    marginTop: 4,
    marginBottom: 14,
  },
  readMoreLink: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563EB',
  },
  highlightsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  highlightCard: {
    width: '48.5%',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  highlightIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  highlightLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.2,
  },
  highlightValue: {
    fontSize: 12.5,
    fontWeight: '900',
    marginTop: 2,
  },
  highlightDesc: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  specsCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  specsCardTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  specItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  specItemBorder: {
    borderBottomWidth: 1,
  },
  specIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  specLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.2,
  },
  specValue: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 1,
  },

  // ZONE 5: OFTEN BOUGHT TOGETHER (SWIGGY PAIRING CARDS)
  popularBadge: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  popularBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#DC2626',
    letterSpacing: 0.4,
  },
  pairingCard: {
    width: 142,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    ...SHADOWS.cardElevated,
  },
  pairingImgContainer: {
    position: 'relative',
    width: '100%',
    height: 96,
  },
  pairingImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  pairingTagBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pairingTagText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0.3,
  },
  pairingContent: {
    padding: 10,
  },
  pairingTitle: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 15,
    minHeight: 30,
    marginBottom: 6,
  },
  pairingFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pairingPrice: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  pairingAddBtn: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pairingAddBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#059669',
    letterSpacing: 0.3,
  },
  pairingMiniStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 3,
    gap: 6,
  },
  pairingMiniStepBtn: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairingMiniStepText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFF',
  },
  pairingMiniStepVal: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFF',
    fontVariant: ['tabular-nums'],
  },

  // RATINGS & REVIEWS
  writeReviewTopBtn: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  writeReviewTopBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.primary,
  },
  ratingOverviewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    marginBottom: 14,
  },
  bigRatingScore: {
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 36,
  },
  reviewCard: {
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 10,
  },
  reviewUserRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  reviewUserName: {
    fontSize: 12,
    fontWeight: '900',
  },
  verifiedBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  verifiedBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#16A34A',
    letterSpacing: 0.5,
  },
  reviewTime: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 1,
  },
  starScoreChip: {
    backgroundColor: '#22C55E',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  starScoreChipText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFF',
  },
  reviewComment: {
    fontSize: 12,
    lineHeight: 16,
  },

  // STICKY BOTTOM BAR (ZEPTO & SWIGGY STANDARD)
  stickyBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    ...SHADOWS.cardElevated,
    zIndex: 100,
  },
  bottomPriceCol: {
    justifyContent: 'center',
  },
  bottomPriceBig: {
    fontSize: 22,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  bottomPriceStrikethrough: {
    fontSize: 13,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  bottomPriceSub: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },
  bottomAddCtaBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    ...SHADOWS.cardElevated,
  },
  bottomCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  bottomAddCtaText: {
    fontSize: 13.5,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  bottomAddPlusText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  activeStepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 12,
  },
  activeStepperBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeStepperBtnText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#10B981',
  },
  activeStepperCountText: {
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    minWidth: 18,
    textAlign: 'center',
  },
  bottomViewCartBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    ...SHADOWS.cardElevated,
  },
  bottomCartTotalLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.5,
  },
  bottomCartTotalVal: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  bottomViewCartText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  // MODALS
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFF',
    borderRadius: RADIUS.xl,
    padding: 20,
    ...SHADOWS.cardElevated,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.ink,
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    color: COLORS.inkMuted,
    marginBottom: 16,
  },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tagPillActive: {
    backgroundColor: COLORS.primary,
  },
  tagPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.primary,
  },
  reviewTextInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  submitReviewBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitReviewBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFF',
  },
  modalSavingsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 4,
  },
  modalSavingsText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  comparisonStoreName: {
    fontSize: 12,
  },
  bestPriceBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bestPriceBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#15803D',
    letterSpacing: 0.3,
  },
  comparisonDeliveryNote: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  comparisonPriceActive: {
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  comparisonPriceOther: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  modalGuaranteeFooterText: {
    fontSize: 12,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  modalClosePrimaryBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.cardElevated,
  },
  modalClosePrimaryBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  compareBtnPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modalCloseBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
});
