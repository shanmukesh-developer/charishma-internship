import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  Alert,
  BackHandler,
} from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { API_URL, ENDPOINTS } from '../constants/api';
import {
  useCart,
  useBasketQuote,
  isBasketKind,
  BASKET_ORDER_TITLES,
  BasketKind,
  useServiceability,
  useDeliverySlots,
  isCustomRequest,
  storeGroupsOf,
  toOrderLine,
  friendlyNetworkMessage,
  newIdempotencyKey,
  DELIVERY_INSTRUCTIONS,
  DELIVERY_INSTRUCTIONS_KEY,
  type CartItem,
  type OrderQuote,
} from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/auth';
import { readCache, writeCache, useSWRJson } from '../utils/swrCache';
import { StaggeredSection, FloatingPulse, BounceIn } from '../components/AnimatedSection';
import DopaminePressable, { ActionPressable } from '../components/DopaminePressable';
import { stallErrorMessage, stallPayCopy } from '../utils/localVendor';
import { cleanBlock, cleanRoom as cleanRoomNo, saveHostelToProfile } from '../utils/hostel';
import FssaiLine from '../components/FssaiLine';
import DeliverySlotPicker from '../components/DeliverySlotPicker';
import { pickSlot } from '../utils/deliverySlots';
import { Ionicons } from '@expo/vector-icons';
import { formatINR, formatClock, plural } from '../utils/format';
import { plainDiscountLabel } from '../utils/billLabel';
import { useTopInset } from '../utils/useTopInset';
import { syncPlaces, addPlace, removePlace, placeText, placeFromText, PLACE_LABELS, type SavedPlace } from '../utils/savedAddresses';
import { setCollege, clearCollege } from '../utils/college';
import { goHome } from '../utils/goHome';
import SymbolIcon from '../components/SymbolIcon';

const PLACE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Hostel: 'home-outline', Library: 'library-outline', Lab: 'flask-outline', Friend: 'people-outline', Other: 'location-outline',
};

type IonName = React.ComponentProps<typeof Ionicons>['name'];

type CampusKey = 'srmap' | 'vitap' | 'amrita';
type PayMethod = 'COD' | 'Wallet';

/** Exactly what the customer confirmed: placed as-is (never re-read from a later render). */
interface OrderSnapshot {
  sig: string;
  orderLines: CartItem[];
  customLines: CartItem[];
  paymentMethod: PayMethod;
  couponCode: string | null;
  isStallOrder: boolean;
  stallName: string;
  /** The bill shown in the confirm dialog; the server refuses with PRICE_CHANGED if it moved. */
  expectedTotal: number | null;
  campus: CampusKey;
  deliveryAddress: string;
  basketAddress: string;
  deliveryNotes: string[];
  /** Delivery slot id ('2026-10-27|S1') + its label; null when the server runs without slots. */
  deliverySlot: string | null;
  slotLabel: string | null;
}

/** An order request whose outcome we never heard (timeout / dropped connection). */
interface UnsettledAttempt {
  sig: string;
  key: string;
  startedAt: number;
  cartKeys: string[];
}

const CHECKOUT_CAMPUS_KEY = 'zenvy_checkout_campus';
const isCampusKey = (v: any): v is CampusKey => v === 'srmap' || v === 'vitap' || v === 'amrita';
/** Best guess from a college email (e.g. name@srmap.edu.in); null = the customer picks. */
const campusFromEmail = (email?: string | null): CampusKey | null => {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  if (/(^|\.)srmap\./.test(domain)) return 'srmap';
  if (/(^|\.)vitap\./.test(domain)) return 'vitap';
  if (/amrita/.test(domain)) return 'amrita';
  return null;
};

interface ExtraItem {
  id: string;
  name: string;
  price: number;
  emoji?: string | null;
  image?: string | null;
  restaurantId: string;
  storeName?: string;
}

interface UserCoupon {
  id: string;
  code: string;
  type: string;
  label?: string;
  expiresInDays?: number | null;
}

// Server answers about colleges (backend utils/campuses): the basket or the college has to change, not the bill.
const COLLEGE_CODES = ['STORE_NOT_AT_CAMPUS', 'CAMPUS_PAUSED', 'CAMPUS_SOON'];
// Campuses the order service delivers to (server: resolveCampus in orderController).
// The label also starts the delivery address sent to the server ("SRM AP - Ganga, Room 304").
const CAMPUSES: { key: CampusKey; label: string; sub: string; code: string }[] = [
  { key: 'srmap', label: 'SRM AP', sub: 'SRM University AP', code: 'SRMAP' },
  { key: 'vitap', label: 'VIT AP', sub: 'VIT-AP University', code: 'VITAP' },
  { key: 'amrita', label: 'Amrita', sub: 'Amrita Vishwa Vidyapeetham AP', code: 'AMRITA' },
];

// Which add-on shelf (GET /api/catalogue/items?type=extras&for=…) fits the dishes in the basket.
function detectDishType(name: string): string {
  const n = name.toLowerCase();
  if (/cake|pastry|brownie|cupcake|cheesecake|gateau|truffle/.test(n)) return 'cake';
  if (/pizza|calzone/.test(n)) return 'pizza';
  if (/biryani|biriyani|pulao|rice bowl/.test(n)) return 'biryani';
  if (/juice|shake|coffee|tea|chai|lassi|smoothie|lemonade|mojito|frappe|milkshake/.test(n)) return 'beverage';
  if (/sweet|laddu|ladoo|barfi|halwa|jalebi|kaju|peda|mysore pak|mithai/.test(n)) return 'sweets';
  if (/burger|sandwich|wrap|sub|roll|frank|hotdog/.test(n)) return 'burger';
  if (/ice cream|kulfi|falooda|sundae|gelato/.test(n)) return 'dessert';
  if (/chicken|tandoori|kebab|tikka|grilled/.test(n)) return 'chicken';
  if (/noodle|chowmein|fried rice|manchurian|momos/.test(n)) return 'chinese';
  if (/dosa|idli|uttapam|vada|sambar|upma/.test(n)) return 'south';
  return 'meal';
}

const cleanRoom = (room: any) => cleanRoomNo(room);

/** "Ganga, Room 304" / "Ganga Block, 304" -> { block, room }; null when the box holds something else. */
const parseHostelAddress = (addr: string): { block: string; room: string } | null => {
  const m = String(addr || '').match(/^\s*([^,]{2,60}?)\s*,\s*(?:room\s*(?:no\.?|#)?\s*)?([A-Za-z0-9][A-Za-z0-9\/-]{0,19})\s*$/i);
  if (!m || /^\d+$/.test(m[1].trim())) return null;
  return { block: cleanBlock(m[1]), room: cleanRoom(m[2]) };
};

export default function CheckoutScreen() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  const router = useRouter();
  const { baskets, basketCounts, activeBasket, setActiveBasket, addToCart, setCart, removeItems: removeAnyItems } = useCart();
  // Delivery checkouts: /checkout?basket=restaurant|store|stall orders only that basket (default: the active one).
  // The Campus store tab never comes here (its stalls book through the campus booking screen, see below).
  const { basket: basketParamRaw, store: storeParamRaw } = useLocalSearchParams<{ basket?: string | string[]; store?: string | string[] }>();
  const basketParam = Array.isArray(basketParamRaw) ? basketParamRaw[0] : basketParamRaw;
  const requestedKind: BasketKind = isBasketKind(basketParam) ? basketParam : activeBasket;
  const campusRequested = requestedKind === 'campus';
  const basketKind: BasketKind = campusRequested ? 'restaurant' : requestedKind;
  // Every basket can hold several shops (restaurants 5 Nov, Groceries and Local stores 6 Nov 2026): checkout places
  // ONE shop's order (?store=<id>, default the first shop); the other shops stay in the basket for their own order.
  const storeParam = String((Array.isArray(storeParamRaw) ? storeParamRaw[0] : storeParamRaw) || '');
  const restaurantGroups = useMemo(() => storeGroupsOf(baskets[basketKind]), [basketKind, baskets]);
  const checkoutStoreId: string | null = restaurantGroups.length === 0
    ? null
    : (restaurantGroups.find((g) => g.storeId === storeParam) || restaurantGroups[0]).storeId || null;
  const cart = useMemo(
    () => (checkoutStoreId ? (restaurantGroups.find((g) => g.storeId === checkoutStoreId)?.lines || []) : baskets[basketKind]),
    [checkoutStoreId, restaurantGroups, baskets, basketKind]
  );
  const totalItems = checkoutStoreId ? cart.reduce((n, l) => n + l.quantity, 0) : basketCounts[basketKind];
  const removeItems = (m: { ids?: string[]; names?: string[] }) => removeAnyItems({ ...m, basket: basketKind });
  // A campus stall is booked on its own booking screen (campus booking API, pickup, no delivery or platform fee).
  useEffect(() => {
    if (!campusRequested) return;
    if (storeParam) router.replace(`/campus-booking/cart/${encodeURIComponent(storeParam)}` as any);
    else router.replace('/(tabs)/basket?basket=campus' as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campusRequested]);
  useEffect(() => {
    if (campusRequested) return;
    if (activeBasket !== basketKind) setActiveBasket(basketKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketKind]);
  // After an order: back to the Basket tab on this (now empty) basket, with the order on top.
  const { user, refreshUser, setUser } = useAuth();
  const { isDark, colors } = useTheme();

  const navigation = useNavigation();
  // No silent default: the last campus picked here, else the college email's campus, else the customer picks.
  const [campus, setCampusState] = useState<CampusKey | null>(null);
  const campusTouchedRef = useRef(false);
  // Colleges' status (GET /api/config/campuses): a coming-soon college cannot be picked, a paused one says so (the
  // server refuses both; same defaults as the server until it answers).
  const campusesSWR = useSWRJson<{ campuses?: { key: string; status: string }[] }>('/api/config/campuses', { freshMs: 30 * 1000 });
  const campusStatus = (key: CampusKey): 'open' | 'paused' | 'soon' => {
    const row = campusesSWR.data?.campuses?.find((c) => c.key === key);
    if (row) return row.status === 'paused' || row.status === 'soon' ? row.status : 'open';
    return key === 'amrita' ? 'soon' : 'open';
  };
  // Destructive only on the server's answer (never on the built-in defaults while it loads): once Amrita opens, a
  // student's Amrita pick must not be wiped for a moment on every checkout.
  const statusKnown = Array.isArray(campusesSWR.data?.campuses);
  const campusSoon = statusKnown && campus ? campusStatus(campus) === 'soon' : false;
  // A saved college that is not open yet (picked in an older build): forgotten here and for every list, so the
  // student picks an open one instead of every bill failing with "starts soon".
  useEffect(() => { if (campusSoon) { setCampusState(null); clearCollege(); } }, [campusSoon]);
  const setCampus = (key: CampusKey) => {
    campusTouchedRef.current = true;
    setCampusState(key);
    // The student's college for every list too (utils/college: saved under the same key, lists refresh for it).
    setCollege(key);
  };
  const [address, setAddress] = useState('');
  // Saved places (utils/savedAddresses): local list, synced to the account when signed in
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [pickingLabel, setPickingLabel] = useState(false);
  const [landmark, setLandmark] = useState('');
  const [instructionIds, setInstructionIds] = useState<string[]>([]);
  const [campusBlocks, setCampusBlocks] = useState<Record<string, string[]>>({});
  const [savingHostel, setSavingHostel] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<PayMethod>('COD');

  const [coupons, setCoupons] = useState<UserCoupon[]>([]);
  const [couponCode, setCouponCode] = useState<string | null>(null);

  // Rewards "Use now" opens checkout with ?coupon=CODE. The quote drops it (COUPON_INVALID) if it is not usable.
  const { coupon: couponParam } = useLocalSearchParams<{ coupon?: string | string[] }>();
  // Codes are matched exactly by the server: keep the link's case.
  const couponFromLink = String((Array.isArray(couponParam) ? couponParam[0] : couponParam) || '').trim();
  const couponLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (couponLinkAppliedRef.current || !couponFromLink) return;
    couponLinkAppliedRef.current = true;
    setCouponCode(couponFromLink.slice(0, 40));
  }, [couponFromLink]);

  const [extras, setExtras] = useState<ExtraItem[]>([]);

  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  // The confirm dialog is open: a second tap must not stack another one.
  const confirmOpenRef = useRef(false);
  // Set while an order request's outcome is unknown: retries reuse its key (same basket) and
  // look in recent orders first, so a request that did get through is never placed twice.
  const attemptRef = useRef<UnsettledAttempt | null>(null);
  // Separate key for the Mega Basket shopping list, tied to its exact contents and kept across retries
  // until the server answers, so a timed-out request that was processed is not created twice.
  const basketKeyRef = useRef<{ sig: string; key: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // A missing college, address or slot scrolls to that section (2 Nov 2026: after "Pick your college" the page
  // stayed at the bottom with the college picker off screen); the address case puts the cursor in the field.
  const scrollRef = useRef<ScrollView>(null);
  const addressRef = useRef<TextInput>(null);
  const sectionY = useRef({ college: 0, slot: 0 });
  // Instant: the alert that opens with it cancels a smooth scroll on the web.
  const scrollToSection = (key: 'college' | 'slot') => scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[key] - 12), animated: false });

  const orderLines = useMemo(() => cart.filter((i) => !isCustomRequest(i)), [cart]);
  const customLines = useMemo(() => cart.filter((i) => isCustomRequest(i)), [cart]);
  const hasOrder = orderLines.length > 0;
  const hasCustom = customLines.length > 0;

  const { quote, loading: quoteLoading, error: quoteError, refresh: refreshQuote } = useBasketQuote(couponCode, !!user, true, basketKind, checkoutStoreId);
  const { serviceability, refresh: refreshServiceability } = useServiceability();
  // CampusBites stall basket: the stall delivers, cash on delivery to the stall, no coupons / add-ons.
  const isStallOrder = hasOrder && (quote ? quote.fulfilment === 'VENDOR' : orderLines.some((i) => i.isStall));
  const stallName = (isStallOrder && (quote?.store?.name || orderLines.find((i) => i.isStall)?.restaurantName)) || 'the stall';
  const isClosed = (quote?.serviceability?.open === false) || serviceability?.open === false;
  const reopensAt = serviceability?.reopensAt || quote?.serviceability?.reopensAt || null;
  const closedMessage = quote?.serviceability?.message || serviceability?.message ||
    (reopensAt
      ? `Campus stores are closed for the night. Ordering opens again at ${formatClock(reopensAt)}.`
      : 'Campus stores are closed for the night. Ordering opens again in the morning.');

  // ── Delivery slot (server: utils/deliverySlots) ──
  // The food / store / stall order takes its slots from the quote (lead from the items, store hours). A
  // shopping list on its own asks GET /api/orders/delivery-slots?type=list. One pick covers both: a slot open
  // for the order is open for the list too (the list's lead is never longer).
  const { info: listSlots, loading: listSlotsLoading, refresh: refreshListSlots } = useDeliverySlots('list', hasCustom && !hasOrder);
  const slotInfo = hasOrder ? (quote?.deliverySlots ?? null) : (hasCustom ? listSlots : null);
  const slotsOn = !!slotInfo && Array.isArray(slotInfo.slots) && slotInfo.slots.length > 0;
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotNote, setSlotNote] = useState<string | null>(null);
  useEffect(() => {
    // Keep the pick while it is still open; otherwise the earliest open slot.
    setSlotId((prev) => pickSlot(slotInfo, prev));
  }, [slotInfo]);
  const selectedSlot = slotsOn ? (slotInfo!.slots.find((x) => x.id === slotId && x.open) || null) : null;
  const refreshSlots = () => { if (hasOrder) refreshQuote(); else refreshListSlots(); };

  // Latest bill, read by the confirm dialog's button (its closure is from an earlier render).
  const quoteRef = useRef<OrderQuote | null>(quote);
  quoteRef.current = quote;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved: string | null = null;
      try { saved = await AsyncStorage.getItem(CHECKOUT_CAMPUS_KEY); } catch {}
      if (cancelled || campusTouchedRef.current) return;
      const guess = isCampusKey(saved) ? saved : campusFromEmail((user as any)?.email);
      if (guess) {
        setCampusState(guess);
        // The college email's campus is the student's college for the lists and the bill too.
        if (!isCampusKey(saved)) setCollege(guess);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Leaving while the order is being placed would hide its outcome: block back until it settles.
  useEffect(() => {
    try { (navigation as any)?.setOptions?.({ gestureEnabled: !placing }); } catch {}
    if (!placing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Placing your order', 'Hang on a moment, we are confirming your order.');
      return true;
    });
    return () => sub.remove();
  }, [placing, navigation]);

  useEffect(() => {
    let alive = true;
    syncPlaces((user as any)?.id || null).then((list) => { if (alive) setPlaces(list); }).catch(() => {});
    return () => { alive = false; };
  }, [(user as any)?.id]);

  // Prefill the address from the profile
  useEffect(() => {
    if (!user) return;
    const block = (user as any)?.hostelBlock;
    const room = cleanRoom((user as any)?.roomNumber);
    setAddress((prev) => {
      if (prev) return prev;
      if (block && room) return `${block}, Room ${room}`;
      if (block) return String(block);
      return (user as any)?.address || '';
    });
  }, [user]);

  // Delivery notes picked on the Basket tab
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(DELIVERY_INSTRUCTIONS_KEY);
        const parsed = stored ? JSON.parse(stored) : null;
        if (Array.isArray(parsed) && mountedRef.current) setInstructionIds(parsed.filter((x) => typeof x === 'string'));
      } catch {}
    })();
  }, []);

  // Hostel blocks per campus come from the campus directory (admin-managed)
  useEffect(() => {
    let cancelled = false;
    const apply = (data: any[]) => {
      const map: Record<string, string[]> = {};
      data.forEach((c: any) => {
        const code = String(c?.code || '').toUpperCase().replace(/[^A-Z]/g, '');
        const match = CAMPUSES.find((k) => code.startsWith(k.code));
        const blocks = c?.settings?.hostelBlocks;
        if (match && Array.isArray(blocks)) {
          map[match.key] = blocks.filter((b: any) => typeof b === 'string' && b.trim()).slice(0, 16);
        }
      });
      setCampusBlocks(map);
    };
    (async () => {
      // The campus directory rarely changes: chips paint from the last good copy, then refresh
      const cached = await readCache<any[]>('campus:campuses');
      if (!cancelled && cached && Array.isArray(cached.data)) apply(cached.data);
      try {
        const res = await apiFetch(`${API_URL}/api/campus/campuses`);
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !Array.isArray(data)) return;
        writeCache('campus:campuses', data);
        apply(data);
      } catch {
        // Chips are a shortcut only; the address field always works.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Usable coupons
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/rewards/coupons`);
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && Array.isArray(data)) setCoupons(data);
      } catch {
        // No coupons shown; checkout still works.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // A coupon the server refuses for this basket (not valid any more, another store, a missing item, below its
  // minimum, or it would save nothing) is dropped with the server's reason, so the bill comes back at once.
  useEffect(() => {
    const code = String(quoteError?.code || '');
    if (couponCode && code.startsWith('COUPON_') && code !== 'COUPON_NOT_FOR_STALL') {
      Alert.alert('Coupon not applied', quoteError?.message || 'This coupon does not work on this order.');
      setCouponCode(null);
    }
  }, [quoteError, couponCode]);

  // Stall orders take no coupon (COUPON_NOT_FOR_STALL): drop it quietly, the coupon section is hidden for them.
  useEffect(() => {
    if (couponCode && (isStallOrder || quoteError?.code === 'COUPON_NOT_FOR_STALL')) setCouponCode(null);
  }, [quoteError, couponCode, isStallOrder]);

  // Wallet is not possible when the balance is short, or for a stall (cash to the stall only)
  useEffect(() => {
    if (paymentMethod === 'Wallet' && ((quote && quote.canPayWithWallet === false) || isStallOrder)) setPaymentMethod('COD');
  }, [quote, paymentMethod, isStallOrder]);

  // "Pairs well with your order": real add-ons from the catalogue
  const dishTypesKey = useMemo(() => {
    const types = new Set(orderLines.filter((i) => !i.isAddOn).map((i) => detectDishType(i.name)));
    return [...types].slice(0, 3).sort().join(',');
  }, [orderLines]);

  useEffect(() => {
    if (!dishTypesKey) { setExtras([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const lists = await Promise.all(dishTypesKey.split(',').map(async (t) => {
          const res = await fetch(`${API_URL}/api/catalogue/items?type=extras&for=${encodeURIComponent(t)}`);
          const data = await res.json().catch(() => null);
          return res.ok && data && Array.isArray(data.items) ? data.items : [];
        }));
        if (cancelled) return;
        const seen = new Set<string>();
        const result: ExtraItem[] = [];
        lists.flat().forEach((it: any) => {
          const id = String(it?.id || it?._id || '');
          if (!id || seen.has(id) || it.isAvailable === false || it.orderable === false) return;
          seen.add(id);
          result.push({
            id,
            name: String(it.name || ''),
            price: Number(it.price) || 0,
            emoji: it.emoji || null,
            image: it.imageUrl || it.image || null,
            restaurantId: String(it.restaurantId || it.storeId || ''),
            storeName: it.storeName,
          });
        });
        setExtras(result);
      } catch {
        if (!cancelled) setExtras([]);
      }
    })();
    return () => { cancelled = true; };
  }, [dishTypesKey]);

  // Only the order's own restaurant's items (owner, 5 Nov 2026: "related products are so random"): an extra from
  // another store would start a second order. No match = no section.
  const orderStoreId = checkoutStoreId || String(orderLines.find((i) => !i.isAddOn)?.restaurantId || '');
  const suggestions = useMemo(() => {
    if (isStallOrder || !orderStoreId) return [];
    const inCart = new Set(cart.map((i) => String(i.id)));
    return extras.filter((e) => String(e.restaurantId || '') === orderStoreId && !inCart.has(e.id)).slice(0, 8);
  }, [extras, cart, isStallOrder, orderStoreId]);
  const addOnLines = useMemo(() => orderLines.filter((i) => i.isAddOn), [orderLines]);
  const removeAddOns = () => {
    const keys = new Set(addOnLines.map((l) => l.cartKey));
    setCart((prev) => prev.filter((i) => !keys.has(i.cartKey)));
  };

  const customEstimate = customLines.reduce((acc, i) => acc + (Number(i.price) || 0) * i.quantity, 0);
  const campusLabel = CAMPUSES.find((c) => c.key === campus)?.label || '';

  const deliveryNotes = useMemo(
    () => DELIVERY_INSTRUCTIONS.filter((d) => instructionIds.includes(d.id)).map((d) => d.note),
    [instructionIds]
  );

  // Food orders carry the notes as deliveryInstructions (both partner apps show them), so they are
  // left out of the address there. Mega Basket has no instructions field: keep them in its address.
  const buildDeliveryAddress = (withNotes = false) => {
    const parts = [`${campusLabel} - ${address.trim()}`];
    if (landmark.trim()) parts.push(`Landmark: ${landmark.trim()}`);
    if (withNotes && deliveryNotes.length) parts.push(`Note: ${deliveryNotes.join(', ')}`);
    return parts.join(' · ').slice(0, 480);
  };

  const unavailableFrom = (body: any) => {
    const list = Array.isArray(body?.unavailableItems) ? body.unavailableItems : [];
    // BOOKING_ONLY_ITEMS: services (print, laundry, …) that must be booked, not ordered
    const bookingOnly = Array.isArray(body?.bookingOnlyItems) ? body.bookingOnlyItems : [];
    return {
      ids: list.map((u: any) => String(u?.id || '')).filter(Boolean),
      names: [...list.map((u: any) => String(u?.name || '')), ...bookingOnly.map((n: any) => String(n || ''))].filter(Boolean),
    };
  };

  const offerRemoveUnavailable = (message: string, body: any) => {
    const { ids, names } = unavailableFrom(body);
    Alert.alert('Some items are unavailable', message, [
      { text: 'Keep editing', style: 'cancel' },
      ...(ids.length || names.length
        ? [{ text: 'Remove them', style: 'destructive' as const, onPress: () => removeItems({ ids, names }) }]
        : []),
    ]);
  };

  /** OPTION_INVALID: a weight / flavour pick is missing or no longer offered. Retrying gives the same answer. */
  const chooseOptionsAgain = (body: any) => {
    const id = body?.menuItemId ? String(body.menuItemId) : null;
    if (id) {
      removeItems({ ids: [id] });
      router.push(`/products/${id}` as any);
    } else goHome(router, '/(tabs)/basket');
  };
  const offerChooseOptions = (message: string, body: any) => {
    Alert.alert('Choose again', message || 'One item needs its options chosen again.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Choose again', onPress: () => chooseOptionsAgain(body) },
    ]);
  };

  const offerRemoveStallAddOns = (message: string) => {
    Alert.alert('Remove add-ons', message || `Add-ons can't be added to a ${stallName} order.`, [
      { text: 'Keep editing', style: 'cancel' },
      ...(addOnLines.length ? [{ text: 'Remove add-ons', style: 'destructive' as const, onPress: removeAddOns }] : []),
    ]);
  };

  const canPlace = !placing && !isClosed && !!user && !!campus && address.trim().length >= 3 &&
    (hasOrder ? (!!quote && !quoteLoading) : hasCustom);

  // Store name for error copy (a stall's own name, or the store the basket is from).
  const errorStoreName = isStallOrder
    ? stallName
    : (quote?.store?.name || orderLines.find((i) => !i.isAddOn)?.restaurantName || 'This store');

  /** One checkout attempt = this basket, payment, coupon and address (the bill is checked by the server). */
  const attemptSig = JSON.stringify([
    orderLines.map(toOrderLine),
    customLines.map((i) => [i.id, i.name, i.quantity, i.price]),
    isStallOrder ? 'COD' : paymentMethod,
    isStallOrder ? null : couponCode,
    campus,
    address.trim(),
    landmark.trim(),
    deliveryNotes,
    selectedSlot ? selectedSlot.id : null,
  ]);
  const liveSigRef = useRef(attemptSig);
  liveSigRef.current = attemptSig;

  const buildSnapshot = (): OrderSnapshot | null => {
    if (!campus) return null;
    return {
      sig: attemptSig,
      orderLines,
      customLines,
      paymentMethod: isStallOrder ? 'COD' : paymentMethod,
      couponCode: isStallOrder ? null : couponCode,
      isStallOrder,
      stallName,
      expectedTotal: hasOrder && quote ? quote.finalPrice : null,
      campus,
      deliveryAddress: buildDeliveryAddress(),
      basketAddress: buildDeliveryAddress(true),
      deliveryNotes,
      deliverySlot: selectedSlot ? selectedSlot.id : null,
      slotLabel: selectedSlot ? selectedSlot.label : null,
    };
  };

  /**
   * The last order request timed out: did it reach the server? Its Idempotency-Key is stored on the
   * order, so a match in recent orders means it was placed. 'unknown' = could not check.
   */
  const findSettledAttempt = async (attempt: UnsettledAttempt): Promise<string | null | 'unknown'> => {
    try {
      const res = await apiFetch(ENDPOINTS.myOrders);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) return 'unknown';
      const hit = data.find((o: any) => o && (
        (o.idempotencyKey && o.idempotencyKey === attempt.key) ||
        (!('idempotencyKey' in o) && new Date(o.createdAt).getTime() >= attempt.startedAt - 5000)
      ));
      return hit ? String(hit._id || hit.id) : null;
    } catch {
      return 'unknown';
    }
  };

  // After a successful order (owner, 10 Nov 2026: "navigate to home screen instead of basket"): checkout closes, Home is
  // the tab underneath, and tracking (or the shopping list) opens on top, so Back from tracking lands on Home. The
  // other shops stay in the basket.
  const showAfterOrder = (path: string) => {
    try { if (router.canDismiss()) router.dismissAll(); } catch { /* nothing to dismiss */ }
    router.navigate('/(tabs)' as any);
    router.push(path as any);
  };

  const goToPlacedOrder = (orderId: string, cartKeys: string[]) => {
    const keys = new Set(cartKeys);
    setCart((prev) => prev.filter((i) => !keys.has(i.cartKey)));
    refreshUser().catch(() => {});
    showAfterOrder(`/tracking/${orderId}`);
  };

  const handlePlaceOrder = async () => {
    if (placingRef.current || confirmOpenRef.current) return;
    if (cart.length === 0) {
      Alert.alert('Your basket is empty', 'Add an item to your basket first.');
      return;
    }
    if (isClosed) {
      Alert.alert('Closed for the night', closedMessage);
      return;
    }
    if (!campus) {
      scrollToSection('college');
      Alert.alert('Pick your college', 'Choose the college we should deliver to.');
      return;
    }
    if (address.trim().length < 3) {
      scrollToSection('college');
      Alert.alert('Where should we deliver?', `Add your hostel block and room number (e.g. Ganga, Room 304). ${isStallOrder ? stallName : 'The rider'} calls you at your hostel gate.`, [
        { text: 'OK', onPress: () => addressRef.current?.focus() },
      ]);
      return;
    }
    if (slotsOn && !selectedSlot) {
      scrollToSection('slot');
      Alert.alert('Pick a delivery slot', 'Choose when we should deliver your order.');
      return;
    }
    if (hasOrder && (!quote || quoteLoading)) {
      if (quoteLoading) Alert.alert('One moment', 'We are updating your bill. Try again in a second.');
      else if (quoteError?.code === 'ITEMS_UNAVAILABLE' || quoteError?.code === 'BOOKING_ONLY_ITEMS') offerRemoveUnavailable(quoteError.message, quoteError.body);
      else if (quoteError?.code === 'ADDONS_NOT_FOR_STALL') offerRemoveStallAddOns(quoteError.message);
      else if (quoteError?.code === 'OPTION_INVALID') offerChooseOptions(quoteError.message, quoteError.body);
      else if (quoteError && stallErrorMessage(quoteError.code, quoteError.message, errorStoreName)) {
        const m = stallErrorMessage(quoteError.code, quoteError.message, errorStoreName)!;
        Alert.alert(m.title, m.message);
      }
      // College rules (pick your college / a store at your college): retrying gives the same answer.
      else if (quoteError && COLLEGE_CODES.includes(String(quoteError.code))) Alert.alert('Not available at your college', quoteError.message);
      else if (quoteError) Alert.alert("We couldn't calculate your bill", quoteError.message, [{ text: 'OK', style: 'cancel' }, { text: 'Retry', onPress: refreshQuote }]);
      return;
    }

    // An earlier request timed out: look for it before placing anything again.
    const pending = attemptRef.current;
    if (pending && hasOrder) {
      confirmOpenRef.current = true;
      setPlacing(true);
      const found = await findSettledAttempt(pending);
      confirmOpenRef.current = false;
      if (mountedRef.current) setPlacing(false);
      if (found === 'unknown') {
        Alert.alert('Connection problem', `${friendlyNetworkMessage} We need to check whether your last order went through before placing another.`);
        return;
      }
      if (found) {
        attemptRef.current = null;
        Alert.alert('Your order went through', 'Your earlier order was placed. Opening it now.', [
          { text: 'View order', onPress: () => goToPlacedOrder(found, pending.cartKeys) },
        ], { cancelable: false });
        return;
      }
      // Not placed: a changed basket is a new attempt; the same basket keeps the key (the server dedupes).
      if (pending.sig !== attemptSig) attemptRef.current = null;
    }

    const snap = buildSnapshot();
    if (!snap) return;

    const lines: string[] = [];
    if (hasOrder && quote) {
      const n = snap.orderLines.reduce((a, i) => a + i.quantity, 0);
      lines.push(`${plural(n, 'item')} from ${quote.store?.name || 'your store'} · ${formatINR(quote.finalPrice)}`);
      lines.push(snap.isStallOrder
        ? `Payment: ${stallPayCopy(stallName)} (${stallName} delivers it, no ZenWe rider)`
        : `Payment: ${snap.paymentMethod === 'Wallet' ? 'ZenWe Wallet' : 'Cash on Delivery'}`);
    }
    if (hasCustom) {
      lines.push(`Shopping list (${customLines.length}) · est. ${formatINR(customEstimate)} + fees, cash on delivery`);
    }
    lines.push(`Deliver to: ${campusLabel} - ${address.trim()}`);
    if (snap.slotLabel) lines.push(`Delivery: ${snap.slotLabel}`);

    confirmOpenRef.current = true;
    const release = () => { confirmOpenRef.current = false; };
    Alert.alert('Confirm your order', lines.join('\n'), [
      { text: 'Edit', style: 'cancel', onPress: release },
      {
        text: 'Place order',
        onPress: () => {
          release();
          // The basket, payment or bill changed while the dialog was open: show the new one first.
          const latestTotal = quoteRef.current ? quoteRef.current.finalPrice : null;
          if (liveSigRef.current !== snap.sig || (snap.expectedTotal !== null && latestTotal !== snap.expectedTotal)) {
            Alert.alert('Your basket changed', 'Check your updated basket and bill, then tap Place order again.');
            return;
          }
          executeOrderPlacement(snap);
        },
      },
    ], { cancelable: true, onDismiss: release });
  };

  /** The bill moved between the confirm dialog and the server (price / fee / coupon change). */
  const confirmNewPrice = (snap: OrderSnapshot, message: string, fresh: any) => {
    const newTotal = fresh && typeof fresh.finalPrice === 'number' ? fresh.finalPrice : null;
    if (newTotal === null) {
      Alert.alert('Your bill changed', `${message} Check the updated bill and tap Place order again.`);
      return;
    }
    if (snap.paymentMethod === 'Wallet' && fresh.canPayWithWallet === false) {
      Alert.alert('Your bill changed', `${message} Your Wallet balance does not cover the new total. Pay with cash instead.`, [
        { text: 'OK', style: 'cancel' },
        { text: 'Pay cash instead', onPress: () => setPaymentMethod('COD') },
      ]);
      return;
    }
    confirmOpenRef.current = true;
    const release = () => { confirmOpenRef.current = false; };
    Alert.alert('Your bill changed', message, [
      { text: 'Edit', style: 'cancel', onPress: release },
      {
        text: `Place for ${formatINR(newTotal)}`,
        onPress: () => {
          release();
          if (liveSigRef.current !== snap.sig) {
            Alert.alert('Your basket changed', 'Check your updated basket and bill, then tap Place order again.');
            return;
          }
          executeOrderPlacement({ ...snap, expectedTotal: newTotal });
        },
      },
    ], { cancelable: true, onDismiss: release });
  };

  const executeOrderPlacement = async (snap: OrderSnapshot) => {
    if (placingRef.current) return;
    placingRef.current = true;
    setPlacing(true);
    const { orderLines: lines, customLines: listLines, stallName: snapStall } = snap;
    let placedOrderId: string | null = null;
    let placedBasket = false;
    let navigateTo: string | null = null;

    try {
      // 1. The food / store order — priced and charged by the server
      if (lines.length > 0) {
        // Same basket as an unsettled attempt -> same key, so the server returns that order instead of a second one.
        if (!attemptRef.current || attemptRef.current.sig !== snap.sig) {
          attemptRef.current = { sig: snap.sig, key: newIdempotencyKey(), startedAt: Date.now(), cartKeys: lines.map((l) => l.cartKey) };
        }
        const key = attemptRef.current.key;
        let res: Response;
        try {
          res = await apiFetch(ENDPOINTS.placeOrder, {
            method: 'POST',
            headers: { 'Idempotency-Key': key },
            body: JSON.stringify({
              items: lines.map(toOrderLine),
              paymentMethod: snap.paymentMethod,
              deliveryAddress: snap.deliveryAddress,
              campus: snap.campus,
              // Slot id from the picker; 'ASAP' only when the server runs without slots (it then assigns none).
              deliverySlot: snap.deliverySlot || 'ASAP',
              ...(snap.deliveryNotes.length ? { deliveryInstructions: snap.deliveryNotes } : {}),
              idempotencyKey: key,
              ...(snap.couponCode ? { couponCode: snap.couponCode } : {}),
              ...(snap.expectedTotal !== null ? { expectedTotal: snap.expectedTotal } : {}),
            }),
          });
        } catch {
          // Outcome unknown: the attempt (and its key) stays, and the next tap checks Orders first.
          Alert.alert('Connection problem', `${friendlyNetworkMessage} If your order went through, it will show up in Orders.`);
          return;
        }
        const data = await res.json().catch(() => null);
        const code = data?.code;
        // A gateway / proxy error (502 / 503 / 504 HTML page, no JSON) is NOT an answer from our server: the order may
        // have gone through. Keep the attempt and its key (the next tap checks Orders first, and the same key makes
        // the server return that order instead of placing a second one - a double Wallet charge otherwise).
        if (!data && res.status >= 500) {
          Alert.alert('Connection problem', `${friendlyNetworkMessage} If your order went through, it will show up in Orders.`);
          return;
        }
        // Our server answered: the attempt is settled, except "still being placed" (same key in flight).
        if (code !== 'ORDER_IN_PROGRESS') attemptRef.current = null;
        if (res.ok && data && (data._id || data.id)) {
          placedOrderId = String(data._id || data.id);
          const placedKeys = new Set(lines.map((l) => l.cartKey));
          setCart((prev) => prev.filter((i) => !placedKeys.has(i.cartKey)));
        } else {
          const message = (data && typeof data.message === 'string' && data.message) || 'We could not place your order. Please try again.';
          if (code === 'PRICE_CHANGED') {
            refreshQuote();
            confirmNewPrice(snap, message, data?.quote);
            return;
          }
          if (code === 'SLOT_CLOSED') {
            // The slot closed while the customer was checking out: fresh slots, the next open one picked.
            refreshQuote();
            if (data?.nextSlot?.id) setSlotId(String(data.nextSlot.id));
            setSlotNote(data?.nextSlot?.label ? `Booking for that slot has closed. We picked ${data.nextSlot.label} instead.` : 'Booking for that slot has closed. Pick another slot.');
            Alert.alert('That slot has closed', `${message} Check the delivery slot and tap Place order again.`);
            return;
          }
          if (code === 'ITEMS_UNAVAILABLE' || code === 'BOOKING_ONLY_ITEMS') offerRemoveUnavailable(message, data);
          else if (code === 'OPTION_INVALID') offerChooseOptions(message, data);
          else if (code === 'STALL_COD_ONLY') {
            setPaymentMethod('COD');
            Alert.alert('Cash only', `${message} Payment is now set to cash. Tap Place order again.`);
          } else if (code === 'COUPON_NOT_FOR_STALL') {
            setCouponCode(null);
            Alert.alert('Coupon removed', `Coupons can't be used on ${snapStall} orders, so we removed it. Tap Place order again.`);
          } else if (code === 'ADDONS_NOT_FOR_STALL') {
            offerRemoveStallAddOns(message);
          } else if (stallErrorMessage(code, message, errorStoreName)) {
            const m = stallErrorMessage(code, message, errorStoreName)!;
            Alert.alert(m.title, m.message);
          } else if (code === 'INSUFFICIENT_WALLET') {
            Alert.alert('Not enough Wallet balance', message, [
              { text: 'OK', style: 'cancel' },
              { text: 'Pay cash instead', onPress: () => setPaymentMethod('COD') },
            ]);
          } else if (code === 'COUPON_INVALID') {
            setCouponCode(null);
            Alert.alert('Coupon not applied', message);
          } else if (code === 'ORDERING_CLOSED') {
            refreshServiceability();
            Alert.alert('Closed for the night', message);
          } else if (code === 'ORDER_IN_PROGRESS') {
            Alert.alert('Almost there', message);
          } else {
            Alert.alert('Order not placed', message);
          }
          refreshQuote();
          return;
        }
      }

      // 2. Mega Basket shopping list (free-text requests a rider buys for you; cash on delivery)
      if (listLines.length > 0) {
        const basketBody = {
          items: listLines.map((i) => ({
            name: String(i.name || '').replace(/^\[Custom Request\]\s*/i, ''),
            quantity: i.quantity,
            unit: 'pcs',
            priceEstimated: Number(i.price) || 0,
          })),
          deliveryAddress: snap.basketAddress,
          paymentMethod: 'COD',
          ...(snap.deliverySlot ? { deliverySlot: snap.deliverySlot } : {}),
        };
        const basketSig = JSON.stringify(basketBody);
        if (!basketKeyRef.current || basketKeyRef.current.sig !== basketSig) {
          basketKeyRef.current = { sig: basketSig, key: newIdempotencyKey() };
        }
        const basketKey = basketKeyRef.current.key;
        try {
          const res = await apiFetch(`${API_URL}/api/mega-basket`, {
            method: 'POST',
            headers: { 'Idempotency-Key': basketKey },
            body: JSON.stringify({ ...basketBody, idempotencyKey: basketKey }),
          });
          const data = await res.json().catch(() => null);
          // The server answered: this attempt is settled (409 = the same key is still being processed).
          if (res.status !== 409 && basketKeyRef.current?.key === basketKey) basketKeyRef.current = null;
          if (res.ok) {
            placedBasket = true;
            const keys = new Set(listLines.map((l) => l.cartKey));
            setCart((prev) => prev.filter((i) => !keys.has(i.cartKey)));
          } else if (data?.code === 'SLOT_CLOSED') {
            refreshSlots();
            if (data?.nextSlot?.id) setSlotId(String(data.nextSlot.id));
            setSlotNote(data?.nextSlot?.label ? `Booking for that slot has closed. We picked ${data.nextSlot.label} instead.` : 'Booking for that slot has closed. Pick another slot.');
            Alert.alert(placedOrderId ? 'Order placed, shopping list not sent' : 'That slot has closed',
              placedOrderId ? `${data.message} Your shopping list is still in your basket. Pick a slot and send it again.` : `${data.message} Check the delivery slot and tap Place order again.`);
          } else {
            const message = (data && typeof data.message === 'string' && data.message) || 'We could not send your shopping list.';
            Alert.alert(placedOrderId ? 'Order placed, shopping list not sent' : 'Shopping list not sent',
              placedOrderId ? `${message} Your shopping list is still in your basket — try again from there.` : message);
          }
        } catch {
          // The list may have reached the server before the connection dropped; the same key is reused
          // on retry, but tell the user to check first instead of claiming it was not sent.
          Alert.alert(placedOrderId ? 'Order placed, shopping list not confirmed' : "Couldn't confirm your shopping list",
            `We couldn't confirm whether your shopping list was sent. Check Shopping list → My lists before trying again.${placedOrderId ? ' Your shopping list is still in your basket.' : ''}`);
        }
      }

      if (placedOrderId || placedBasket) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        refreshUser().catch(() => {});
        navigateTo = placedOrderId ? `/tracking/${placedOrderId}` : '/mega-basket?tab=list';
      }
    } finally {
      placingRef.current = false;
      if (mountedRef.current) setPlacing(false);
    }
    // Navigate only after the "placing" lock is released (the back guard would otherwise block it).
    if (navigateTo) {
      showAfterOrder(navigateTo);
    }
  };

  const bg = colors.bg;
  const cardBg = colors.card;
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;

  const headerStoreName = quote?.store?.name
    || orderLines.find((i) => !i.isAddOn)?.restaurantName
    || (hasCustom ? 'Shopping list' : '');

  const goBack = () => {
    if (placingRef.current) {
      Alert.alert('Placing your order', 'Hang on a moment, we are confirming your order.');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  };

  const header = (
    <View style={[s.header, { paddingTop: topPad, backgroundColor: bg, borderBottomColor: border }]}>
      <TouchableOpacity onPress={goBack} style={[s.backBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={20} color={txt} />
      </TouchableOpacity>
      <View style={{ flexShrink: 1 }}>
        <Text style={[s.title, { color: goldColor }]}>{BASKET_ORDER_TITLES[basketKind]}</Text>
        {!!headerStoreName && (
          <Text style={{ fontSize: 12, fontWeight: '600', color: txtSec }} numberOfLines={1}>from {headerStoreName}</Text>
        )}
      </View>
    </View>
  );

  // Guests: sign in first (the bill and the order need an account)
  if (!user) {
    return (
      <View style={[s.container, { backgroundColor: bg }]}>
        {header}
        <View style={s.centerBox}>
          <Ionicons name="lock-closed-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
          <Text style={[s.centerTitle, { color: txt }]}>Sign in to check out</Text>
          <Text style={[s.centerSub, { color: txtSec }]}>Your basket is saved. Sign in to see your bill and place the order.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.push('/login' as any)}>
            <Text style={s.primaryBtnText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (cart.length === 0) {
    return (
      <View style={[s.container, { backgroundColor: bg }]}>
        {header}
        <View style={s.centerBox}>
          <Ionicons name="basket-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
          <Text style={[s.centerTitle, { color: txt }]}>Your basket is empty</Text>
          <Text style={[s.centerSub, { color: txtSec }]}>Add something from a campus store to check out.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => goHome(router)}>
            <Text style={s.primaryBtnText}>Browse stores</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const blocks: string[] = (campus && campusBlocks[campus]) || [];
  // "Save as my hostel & room": offered when the box holds a block + room that differs from the profile.
  const typedHostel = parseHostelAddress(address);
  const hostelSaved = !!typedHostel &&
    cleanBlock((user as any)?.hostelBlock).toLowerCase() === typedHostel.block.toLowerCase() &&
    cleanRoom((user as any)?.roomNumber).toLowerCase() === typedHostel.room.toLowerCase();
  const saveTypedHostel = async () => {
    if (!typedHostel || savingHostel || hostelSaved) return;
    setSavingHostel(true);
    try {
      const updated = await saveHostelToProfile(typedHostel.block, typedHostel.room);
      if (mountedRef.current) setUser(updated);
      Haptics.selectionAsync().catch(() => {});
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message || 'Please try again.');
    } finally {
      if (mountedRef.current) setSavingHostel(false);
    }
  };
  const typedPlaceSaved = places.some((pl) => placeText(pl).toLowerCase() === address.trim().toLowerCase());
  const saveTypedPlace = async (label: string) => {
    setPickingLabel(false);
    try {
      const next = await addPlace(placeFromText(address, label, typedHostel), !!user);
      if (mountedRef.current) setPlaces(next);
      Haptics.selectionAsync().catch(() => {});
    } catch {
      Alert.alert("Couldn't save", 'Please try again.');
    }
  };
  const confirmRemovePlace = (pl: SavedPlace) => {
    Alert.alert('Remove saved place?', `${pl.label}: ${placeText(pl)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { const next = await removePlace(pl.id, !!user); if (mountedRef.current) setPlaces(next); } },
    ]);
  };
  const profileBlock = (user as any)?.hostelBlock ? String((user as any).hostelBlock) : null;
  const blockChips = profileBlock && !blocks.includes(profileBlock) ? [profileBlock, ...blocks] : blocks;
  const walletBalance = Number(quote?.walletBalance ?? (user as any)?.walletBalance ?? 0) || 0;
  const walletAllowed = hasOrder && !!quote && quote.canPayWithWallet !== false;
  // Buy-at-store shops (the rider pays the shop) take cash only: say so instead of "not enough balance".
  const storeCodOnly = hasOrder && !!quote && Array.isArray(quote.paymentMethods) && !quote.paymentMethods.includes('Wallet');

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: bg }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {header}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[s.scroll, { paddingBottom: 220 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {isClosed && (
          <View style={[s.noticeCard, { backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }]}>
            <Ionicons name="moon-outline" size={20} color="#6366F1" />
            <View style={{ flex: 1 }}>
              <Text style={[s.noticeTitle, { color: txt }]}>Closed for the night</Text>
              <Text style={[s.noticeSub, { color: txtSec }]}>{closedMessage}</Text>
            </View>
          </View>
        )}

        {/* Campus Selection */}
        <StaggeredSection delay={50} direction="up" onLayout={(e) => { sectionY.current.college = e.nativeEvent.layout.y; }}>
          <Text style={[s.sectionTitle, { color: txt }]}>Your college</Text>
          {!campus && (
            <Text style={[s.helperText, { color: COLORS.red }]}>Pick the college we should deliver to.</Text>
          )}
          <View style={s.campusRow}>
            {CAMPUSES.map(item => {
              const isActive = campus === item.key;
              const st = campusStatus(item.key);
              const soon = st === 'soon';
              return (
                <DopaminePressable
                  key={item.key}
                  style={[
                    s.campusBtnNew,
                    { backgroundColor: cardBg, borderColor: border },
                    isActive && { borderColor: goldColor, backgroundColor: isDark ? 'rgba(201,168,76,0.08)' : 'rgba(239,79,95,0.05)' },
                    soon && { opacity: 0.5 },
                  ]}
                  disabled={soon}
                  onPress={() => setCampus(item.key)}
                  sound="click"
                  activeScale={0.95}
                  accessibilityRole="radio"
                  accessibilityLabel={`${item.label}, ${item.sub}${soon ? ', coming soon' : st === 'paused' ? ', ordering paused for now' : ''}`}
                  accessibilityState={{ selected: isActive, checked: isActive, disabled: soon }}
                >
                  <Text style={[s.campusLabelNew, { color: isActive ? goldColor : txt }]}>{item.label}</Text>
                  <Text style={[s.campusSubLabelNew, { color: st === 'paused' ? COLORS.red : txtSec }]} numberOfLines={2}>{soon ? 'Coming soon' : st === 'paused' ? 'Ordering paused' : item.sub}</Text>
                  {isActive && (
                    // The bounce wrapper itself sits in the top-right corner (it was in the text flow, so the tick
                    // landed on the second line of "SRM University AP").
                    <BounceIn delay={0} style={s.activeCheckWrap}>
                      <View style={[s.activeCheckBadge, { backgroundColor: goldColor }]}>
                        <Ionicons name="checkmark" size={11} color="#000" />
                      </View>
                    </BounceIn>
                  )}
                </DopaminePressable>
              );
            })}
          </View>

          {/* Saved places: one tap fills the address; long press removes */}
          {places.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
              {places.map((pl) => {
                const text = placeText(pl);
                const isSelected = text.toLowerCase() === address.trim().toLowerCase();
                return (
                  <DopaminePressable
                    key={pl.id}
                    accessibilityRole="radio"
                    accessibilityLabel={`${pl.label}, ${text}`}
                    accessibilityHint="Long press to remove"
                    accessibilityState={{ selected: isSelected, checked: isSelected }}
                    style={[s.placeChip, {
                      backgroundColor: isSelected ? (isDark ? goldColor : '#EF4F5F') : cardBg,
                      borderColor: isSelected ? (isDark ? goldColor : '#EF4F5F') : border,
                    }]}
                    onPress={() => setAddress(text)}
                    onLongPress={() => confirmRemovePlace(pl)}
                  >
                    <Ionicons name={PLACE_ICON[pl.label] || 'location-outline'} size={14} color={isSelected ? (isDark ? '#000' : '#FFF') : goldColor} />
                    <View style={{ maxWidth: 170 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: isSelected ? (isDark ? '#000' : '#FFF') : txt }} numberOfLines={1}>{pl.label}</Text>
                      <Text style={{ fontSize: 11, fontWeight: '400', color: isSelected ? (isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)') : txtSec }} numberOfLines={1}>{text}</Text>
                    </View>
                  </DopaminePressable>
                );
              })}
            </ScrollView>
          )}

          <TextInput
            ref={addressRef}
            style={[s.input, { backgroundColor: cardBg, color: txt, borderColor: address.trim().length >= 3 ? border : 'rgba(239,68,68,0.5)' }]}
            placeholder="Hostel block & room no. (e.g. Ganga, Room 304)"
            placeholderTextColor={txtSec}
            value={address}
            onChangeText={setAddress}
            maxLength={200}
            returnKeyType="next"
          />
          {typedHostel && (
            <TouchableOpacity
              onPress={saveTypedHostel}
              disabled={hostelSaved || savingHostel}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: hostelSaved, busy: savingHostel }}
              accessibilityLabel="Save as my hostel and room"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -4, marginBottom: 10, alignSelf: 'flex-start', paddingVertical: 4 }}
            >
              <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: hostelSaved ? COLORS.emerald : border, backgroundColor: hostelSaved ? COLORS.emerald : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {savingHostel ? <ActivityIndicator size="small" color={txt} /> : hostelSaved ? <SymbolIcon name="checkmark" style={{ color: '#fff', fontSize: 12, fontWeight: '700' }} /> : null}
              </View>
              <Text style={{ fontSize: 12, fontWeight: '700', color: hostelSaved ? COLORS.emerald : txtSec }}>
                {hostelSaved ? 'Saved as my hostel & room' : 'Save as my hostel & room'}
              </Text>
            </TouchableOpacity>
          )}
          {/* Save the typed address as a labelled place (Hostel, Library...) */}
          {address.trim().length >= 3 && !typedPlaceSaved && (
            pickingLabel ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: -4, marginBottom: 10 }}>
                <Text style={{ fontSize: 12, fontWeight: '500', color: txtSec, marginRight: 2 }}>Save as</Text>
                {PLACE_LABELS.map((label) => (
                  <TouchableOpacity
                    key={label}
                    onPress={() => saveTypedPlace(label)}
                    style={[s.blockChip, { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: cardBg, borderColor: border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Save this address as ${label}`}
                  >
                    <Ionicons name={PLACE_ICON[label]} size={12} color={goldColor} />
                    <Text style={{ fontSize: 12, fontWeight: '500', color: txt }}>{label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity onPress={() => setPickingLabel(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Cancel">
                  <Text style={{ fontSize: 12, fontWeight: '500', color: txtSec, marginLeft: 4 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setPickingLabel(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4, marginBottom: 10, alignSelf: 'flex-start', paddingVertical: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Save this address as a place"
              >
                <Ionicons name="bookmark-outline" size={14} color={goldColor} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: goldColor }}>Save this place for next time</Text>
              </TouchableOpacity>
            )
          )}
          {blockChips.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {blockChips.map((block) => {
                const isSelected = address.toLowerCase().startsWith(block.toLowerCase());
                return (
                  <DopaminePressable
                    key={block}
                    accessibilityRole="radio"
                    accessibilityLabel={`Hostel block ${block}`}
                    accessibilityState={{ selected: isSelected, checked: isSelected }}
                    style={[s.blockChip, {
                      backgroundColor: isSelected ? (isDark ? goldColor : '#EF4F5F') : cardBg,
                      borderColor: isSelected ? (isDark ? goldColor : '#EF4F5F') : border,
                    }]}
                    onPress={() => {
                      const roomMatch = address.match(/(?:room\s*#?\s*|#\s*)(\w+)/i) || address.match(/\b(\d{3,4})\b/);
                      const roomPart = roomMatch ? `Room ${roomMatch[1]}` : '';
                      if (isSelected) setAddress(roomPart);
                      else setAddress(roomPart ? `${block}, ${roomPart}` : `${block}, Room `);
                    }}
                    sound="click"
                    activeScale={0.92}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: isSelected ? '#FFFFFF' : txt, letterSpacing: 0.2 }}>
                      {block}
                    </Text>
                  </DopaminePressable>
                );
              })}
            </View>
          )}
          <TextInput
            style={[s.input, { backgroundColor: cardBg, color: txt, borderColor: border }]}
            placeholder={isStallOrder ? `Landmark or note for ${stallName} (optional)` : 'Landmark or note for the rider (optional)'}
            placeholderTextColor={txtSec}
            value={landmark}
            onChangeText={setLandmark}
            maxLength={120}
          />
          {deliveryNotes.length > 0 && (
            <Text style={[s.helperText, { color: txtSec }]}>{isStallOrder ? 'Note for the stall' : 'Rider note'}: {deliveryNotes.join(', ')}</Text>
          )}
        </StaggeredSection>

        {/* Pairs Well With Your Order (catalogue add-ons) */}
        {hasOrder && suggestions.length > 0 && (
          <StaggeredSection delay={130} direction="up">
            <View style={{ marginTop: 20 }}>
              <Text style={[s.sectionTitle, { color: txt, marginBottom: 8 }]}>Pairs well with your order</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.extrasScroll}>
                {suggestions.map(extra => (
                  <TouchableOpacity
                    key={extra.id}
                    style={[s.extraCard, { backgroundColor: cardBg }]}
                    activeOpacity={0.85}
                    onPress={() => {
                      const added = addToCart({
                        id: extra.id,
                        name: extra.name,
                        price: extra.price,
                        image: extra.image || '',
                        restaurantId: extra.restaurantId,
                        restaurantName: extra.storeName || 'Add-ons',
                        isAddOn: true,
                        basket: basketKind,
                        ...(checkoutStoreId ? { forStoreId: checkoutStoreId } : {}),
                      });
                      if (added) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    }}
                  >
                    {extra.emoji ? (
                      <Text style={{ fontSize: 24, marginBottom: 4 }}>{extra.emoji}</Text>
                    ) : (
                      <Ionicons name="add-circle-outline" size={24} color={COLORS.gold} style={{ marginBottom: 4 }} />
                    )}
                    <Text style={[s.extraName, { color: txt }]} numberOfLines={2}>{extra.name}</Text>
                    <Text style={s.extraPrice}>{formatINR(extra.price)}</Text>
                    <Text style={s.extraAddBtn}>Add</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </StaggeredSection>
        )}

        {/* Stall order: how it works (+ leftover add-ons to remove) */}
        {isStallOrder && (
          <View style={[s.noticeCard, { marginTop: 20, backgroundColor: isDark ? 'rgba(249,115,22,0.10)' : 'rgba(249,115,22,0.07)', borderColor: 'rgba(249,115,22,0.3)' }]}>
            <Ionicons name="storefront-outline" size={20} color="#F97316" />
            <View style={{ flex: 1 }}>
              <Text style={[s.noticeTitle, { color: txt }]}>{stallName} delivers this order</Text>
              <Text style={[s.noticeSub, { color: txtSec }]}>
                {stallPayCopy(stallName)}. No ZenWe rider and no Delivery PIN. Coupons and add-ons don't apply to stall orders.
              </Text>
              {addOnLines.length > 0 && (
                <TouchableOpacity style={[s.smallBtn, { marginTop: 10 }]} onPress={removeAddOns}>
                  <Text style={s.smallBtnText}>Remove {plural(addOnLines.length, 'add-on')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Coupons */}
        {hasOrder && !isStallOrder && (
          <StaggeredSection delay={210} direction="up">
            <View style={{ marginTop: 20 }}>
              <Text style={[s.sectionTitle, { color: txt, marginBottom: 10 }]}>Your coupons</Text>
              {coupons.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.couponsScroll}>
                  {coupons.map(cpn => {
                    const isActive = couponCode === cpn.code;
                    return (
                      <TouchableOpacity
                        key={cpn.id || cpn.code}
                        style={[s.couponCard, isActive && s.couponCardActive, { backgroundColor: cardBg }]}
                        onPress={() => setCouponCode(isActive ? null : cpn.code)}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`Coupon ${cpn.code}`}
                        accessibilityState={{ checked: isActive }}
                      >
                        <Ionicons name={cpn.type === 'FREEDEL' ? 'bicycle-outline' : 'pricetag-outline'} size={20} color={COLORS.gold} style={{ marginBottom: 4 }} />
                        <Text style={[s.couponCode, { color: txt }]}>{cpn.code}</Text>
                        <Text style={s.couponType}>{cpn.label || (cpn.type === 'FREEDEL' ? 'Free delivery' : 'Discount')}</Text>
                        {typeof cpn.expiresInDays === 'number' && (
                          <Text style={s.couponType}>{cpn.expiresInDays <= 0 ? 'Expires today' : `Expires in ${plural(cpn.expiresInDays, 'day')}`}</Text>
                        )}
                        {isActive && <Text style={s.activeIndicator}>{quoteLoading ? 'Applying…' : 'Applied'}</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : (
                <TouchableOpacity style={[s.emptyCoupons, { backgroundColor: cardBg }]} onPress={() => router.push('/rewards' as any)} activeOpacity={0.85}>
                  <Ionicons name="gift-outline" size={20} color={COLORS.textSecondary} style={{ marginBottom: 4 }} />
                  <Text style={s.emptyCouponsText}>No coupons yet</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Text style={s.emptyCouponsSub}>Spin the wheel in Rewards to win one</Text><SymbolIcon name="chevron-forward" style={s.emptyCouponsSub} scale={1} /></View>
                </TouchableOpacity>
              )}
            </View>
          </StaggeredSection>
        )}

        {/* Delivery slot: Today / Tomorrow (server slots; picking one is required) */}
        {(slotsOn || (hasCustom && !hasOrder && listSlotsLoading)) && (
          <StaggeredSection delay={260} direction="up" onLayout={(e) => { sectionY.current.slot = e.nativeEvent.layout.y; }}>
            <View style={{ marginTop: 24 }}>
              <DeliverySlotPicker
                info={slotsOn ? slotInfo : null}
                selectedId={selectedSlot ? selectedSlot.id : null}
                onSelect={(id) => { setSlotId(id); setSlotNote(null); Haptics.selectionAsync().catch(() => {}); }}
                loading={hasOrder ? quoteLoading : listSlotsLoading}
                note={slotNote}
              />
            </View>
          </StaggeredSection>
        )}

        {/* Payment: Cash on Delivery or Wallet */}
        <StaggeredSection delay={290} direction="up">
          <Text style={[s.sectionTitle, { color: txt, marginTop: 24 }]}>Payment method</Text>
          <View style={s.payRowNew}>
            {(isStallOrder ? [
              { key: 'COD' as PayMethod, title: 'Cash on Delivery', desc: stallPayCopy(stallName), icon: 'cash-outline' as IonName, enabled: true },
            ] : [
              { key: 'COD' as PayMethod, title: 'Cash on Delivery', desc: 'Pay the rider in cash when it arrives', icon: 'cash-outline' as IonName, enabled: true },
              {
                key: 'Wallet' as PayMethod,
                title: 'ZenWe Wallet',
                desc: storeCodOnly
                  ? 'This store takes cash on delivery only'
                  : walletAllowed
                    ? `Balance ${formatINR(walletBalance)}`
                    // No bill yet (loading, or it failed): "not enough" would be a guess.
                    : !quote
                      ? (quoteError && !quoteLoading ? `Balance ${formatINR(walletBalance)}` : `Balance ${formatINR(walletBalance)} · checking the bill…`)
                      : `Balance ${formatINR(walletBalance)} · not enough for this order`,
                icon: 'wallet-outline' as IonName,
                enabled: walletAllowed,
              },
            ]).map(item => {
              const isActive = paymentMethod === item.key;
              return (
                <DopaminePressable
                  key={item.key}
                  style={[
                    s.payCardNew,
                    { backgroundColor: cardBg, borderColor: border, opacity: item.enabled ? 1 : 0.55 },
                    isActive && { borderColor: COLORS.red, backgroundColor: isDark ? 'rgba(239,79,95,0.06)' : 'rgba(239,79,95,0.03)' }
                  ]}
                  onPress={() => { if (item.enabled) setPaymentMethod(item.key); }}
                  accessibilityRole="radio"
                  accessibilityLabel={`${item.title}. ${item.desc}`}
                  accessibilityState={{ selected: isActive, checked: isActive, disabled: !item.enabled }}
                  disabled={!item.enabled}
                  sound="click"
                  activeScale={0.97}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                      <Ionicons name={item.icon} size={22} color={isActive ? COLORS.red : txtSec} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.payCardTitle, { color: isActive ? COLORS.red : txt }]}>{item.title}</Text>
                        <Text style={[s.payCardDesc, { color: txtSec }]}>{item.desc}</Text>
                      </View>
                    </View>
                    <View style={[s.radioOuter, { borderColor: isActive ? COLORS.red : border }]}>
                      {isActive && (
                        <BounceIn delay={0}>
                          <View style={[s.radioInner, { backgroundColor: COLORS.red }]} />
                        </BounceIn>
                      )}
                    </View>
                  </View>
                </DopaminePressable>
              );
            })}
          </View>
          {hasOrder && hasCustom && paymentMethod === 'Wallet' && (
            <Text style={[s.helperText, { color: txtSec }]}>Your shopping list is paid in cash when it arrives.</Text>
          )}
        </StaggeredSection>

        {/* Bill (from the server quote — exactly what you will be charged) */}
        <StaggeredSection delay={370} direction="up">
          <View style={[s.billCard, { backgroundColor: cardBg, borderColor: border, borderWidth: 1, marginTop: 24 }]}>
            {hasOrder && quoteLoading && !quote && (
              <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                <ActivityIndicator color={COLORS.red} />
                <Text style={[s.helperText, { color: txtSec, marginTop: 8 }]}>Calculating your bill…</Text>
              </View>
            )}

            {hasOrder && !quote && !quoteLoading && quoteError && (
              <View style={{ paddingVertical: 8 }}>
                <Text style={[s.noticeTitle, { color: txt }]}>{COLLEGE_CODES.includes(String(quoteError.code)) ? 'Not available at your college' : "We couldn't calculate your bill"}</Text>
                <Text style={[s.noticeSub, { color: txtSec, marginBottom: 10 }]}>{quoteError.message}</Text>
                {quoteError.code === 'CAMPUS_SOON' ? null : quoteError.code === 'ITEMS_UNAVAILABLE' || quoteError.code === 'BOOKING_ONLY_ITEMS' ? (
                  <TouchableOpacity style={s.smallBtn} onPress={() => { const u = unavailableFrom(quoteError.body); removeItems(u); }}>
                    <Text style={s.smallBtnText}>Remove unavailable items</Text>
                  </TouchableOpacity>
                ) : quoteError.code === 'ADDONS_NOT_FOR_STALL' ? (
                  <TouchableOpacity style={s.smallBtn} onPress={removeAddOns}>
                    <Text style={s.smallBtnText}>Remove add-ons</Text>
                  </TouchableOpacity>
                ) : quoteError.code === 'OPTION_INVALID' ? (
                  <TouchableOpacity style={s.smallBtn} onPress={() => chooseOptionsAgain(quoteError.body)}>
                    <Text style={s.smallBtnText}>Choose again</Text>
                  </TouchableOpacity>
                ) : quoteError.code === 'MULTIPLE_STORES' || quoteError.code === 'ADDONS_ONLY' || quoteError.code === 'TOO_MANY_LINES' || quoteError.code === 'INVALID_QUANTITY' || quoteError.code === 'STORE_CLOSED' || quoteError.code === 'STORE_NOT_AT_CAMPUS' ? (
                  // Retrying gives the same answer: the basket itself has to change.
                  <TouchableOpacity style={s.smallBtn} onPress={() => goHome(router, '/(tabs)/basket')}>
                    <Text style={s.smallBtnText}>Edit basket</Text>
                  </TouchableOpacity>
                ) : quoteError.code === 'MIN_ORDER_NOT_MET' && quoteError.body?.storeId ? (
                  <TouchableOpacity style={s.smallBtn} onPress={() => router.push(`/restaurant/${quoteError.body.storeId}` as any)}>
                    <Text style={s.smallBtnText}>Add more items</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={s.smallBtn} onPress={refreshQuote}>
                    <Text style={s.smallBtnText}>Try again</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {hasOrder && quote && (
              <View style={{ opacity: quoteLoading ? 0.5 : 1 }}>
                <View style={s.billRow}>
                  <Text style={[s.billLabel, { color: txt }]}>Item total</Text>
                  <Text style={[s.billVal, { color: txt }]}>{formatINR(quote.subtotal)}</Text>
                </View>
                <View style={s.billRow}>
                  <Text style={[s.billLabel, { color: txt }]}>Delivery fee</Text>
                  <Text style={[s.billVal, { color: quote.deliveryFee === 0 ? COLORS.emerald : txt }]}>
                    {quote.deliveryFee === 0 ? 'Free' : formatINR(quote.deliveryFee)}
                  </Text>
                </View>
                {Number(quote.platformFee) > 0 && (
                  <View style={s.billRow}>
                    <Text style={[s.billLabel, { color: txt }]}>Platform fee</Text>
                    <Text style={[s.billVal, { color: txt }]}>{formatINR(Number(quote.platformFee))}</Text>
                  </View>
                )}
                {quote.packagingFee > 0 && (
                  <View style={s.billRow}>
                    <Text style={[s.billLabel, { color: txt }]}>Packaging</Text>
                    <Text style={[s.billVal, { color: txt }]}>{formatINR(quote.packagingFee)}</Text>
                  </View>
                )}
                {quote.taxes > 0 && (
                  <View style={s.billRow}>
                    <Text style={[s.billLabel, { color: txt }]}>Taxes</Text>
                    <Text style={[s.billVal, { color: txt }]}>{formatINR(quote.taxes)}</Text>
                  </View>
                )}
                {(quote.discounts || []).filter((d) => d && d.amount > 0).map((d, idx) => (
                  <View style={s.billRow} key={`${d.type}-${idx}`}>
                    <Text style={[s.billLabel, { color: COLORS.emerald, flex: 1 }]} numberOfLines={1}>{plainDiscountLabel(d.label)}</Text>
                    <Text style={[s.billVal, { color: COLORS.emerald }]}>{formatINR(-Math.abs(Number(d.amount) || 0))}</Text>
                  </View>
                ))}
                <View style={[s.billRow, { borderTopWidth: 1, borderTopColor: border, paddingTop: 12, marginTop: 8 }]}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: txt }}>{isStallOrder ? 'Pay the stall' : 'To pay'}</Text>
                  <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.red }}>{formatINR(quote.finalPrice)}</Text>
                </View>
                {isStallOrder && (
                  <Text style={[s.helperText, { color: txtSec, marginTop: 6 }]}>{stallPayCopy(stallName)}.</Text>
                )}
                {quote.totalDiscount > 0 && (
                  <Text style={[s.savingsText]}>You save {formatINR(quote.totalDiscount)} on this order</Text>
                )}
                <FssaiLine number={quote.store?.fssaiLicenseNumber} storeName={quote.store?.name || undefined} color={txtSec} />
              </View>
            )}

            {hasCustom && (
              <View style={[hasOrder && { borderTopWidth: 1, borderTopColor: border, marginTop: 12, paddingTop: 12 }]}>
                <View style={s.billRow}>
                  <Text style={[s.billLabel, { color: txt }]}>Shopping list (est.)</Text>
                  <Text style={[s.billVal, { color: txt }]}>{formatINR(customEstimate)}</Text>
                </View>
                <Text style={[s.helperText, { color: txtSec }]}>
                  A rider shops your list. You pay the actual shop bill plus shopping and delivery fees, in cash on delivery.
                </Text>
              </View>
            )}
          </View>
        </StaggeredSection>

        <FloatingPulse color={COLORS.red} style={s.placeBtnContainer}>
          <ActionPressable
            style={[s.placeBtn, { width: '100%', opacity: canPlace ? 1 : 0.5 }]}
            onPress={handlePlaceOrder}
            disabled={placing}
            sound="success"
            accessibilityRole="button"
            accessibilityLabel={placing ? 'Placing your order' : 'Place order'}
            accessibilityState={{ disabled: placing || !canPlace, busy: placing }}
          >
            {placing ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color="#fff" />
                <Text style={[s.placeText, { fontSize: 13 }]}>Placing order…</Text>
              </View>
            ) : (
              <Text style={s.placeText}>
                {isClosed
                  ? 'Closed for the night'
                  : hasOrder && quote
                    ? `Place order · ${formatINR(quote.finalPrice)}`
                    : `Place order${totalItems ? ` · ${plural(totalItems, 'item')}` : ''}`}
              </Text>
            )}
          </ActionPressable>
        </FloatingPulse>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 40 : 50, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  title: { fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  scroll: { padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2, marginBottom: 12 },
  campusRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  campusBtnNew: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, alignItems: 'center', borderWidth: 1.5, position: 'relative', overflow: 'hidden' },
  campusLabelNew: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  campusSubLabelNew: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginTop: 2, textAlign: 'center' },
  activeCheckWrap: { position: 'absolute', top: 6, right: 6 },
  activeCheckBadge: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 13, marginBottom: 10, fontWeight: '600' },
  blockChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1.5 },
  placeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, borderWidth: 1.5 },
  helperText: { fontSize: 12, fontWeight: '600', lineHeight: 15, marginBottom: 6 },
  payRowNew: { gap: 10, marginBottom: 12 },
  payCardNew: { padding: 14, borderRadius: 16, borderWidth: 1.5 },
  payCardTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  payCardDesc: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600', marginTop: 2 },
  radioOuter: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 8, height: 8, borderRadius: 4 },
  billCard: { padding: 16, borderRadius: 20 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  billLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  billVal: { fontSize: 12, fontWeight: '600' },
  savingsText: { fontSize: 12, fontWeight: '600', color: COLORS.emerald, marginTop: 8, textAlign: 'center' },
  placeBtnContainer: {
    marginTop: 24,
    marginBottom: Platform.OS === 'android' ? 80 : 40,
  },
  placeBtn: {
    backgroundColor: COLORS.red,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    ...SHADOWS.redGlow,
  },
  placeText: { fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },

  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  noticeTitle: { fontSize: 12, fontWeight: '700' },
  noticeSub: { fontSize: 12, fontWeight: '600', marginTop: 2, lineHeight: 15 },
  smallBtn: { alignSelf: 'flex-start', backgroundColor: COLORS.red, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  centerSub: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  primaryBtn: { backgroundColor: COLORS.red, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 16, ...SHADOWS.redGlow },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },

  // Suggested Extras
  extrasScroll: { gap: 10, paddingRight: 16 },
  extraCard: { width: 120, padding: 12, borderRadius: 20, borderWidth: 1, borderColor: COLORS.borderDark, alignItems: 'center' },
  extraName: { fontSize: 12, fontWeight: '600', marginTop: 4, width: '100%', textAlign: 'center' },
  extraPrice: { fontSize: 12, fontWeight: '700', color: COLORS.gold, marginTop: 2 },
  extraAddBtn: { fontSize: 12, fontWeight: '700', color: '#000', backgroundColor: COLORS.gold, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 8, overflow: 'hidden' },

  // Coupons
  couponsScroll: { gap: 10, paddingRight: 16 },
  couponCard: { width: 130, padding: 12, borderRadius: 20, borderWidth: 1, borderColor: COLORS.borderDark, alignItems: 'center', position: 'relative' },
  couponCardActive: { borderColor: COLORS.gold, borderWidth: 1.5 },
  couponCode: { fontSize: 12, fontWeight: '700' },
  couponType: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, marginTop: 2 },
  activeIndicator: { fontSize: 12, fontWeight: '700', color: COLORS.gold, marginTop: 6 },
  emptyCoupons: { padding: 20, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.borderDark, alignItems: 'center' },
  emptyCouponsText: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  emptyCouponsSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
});
