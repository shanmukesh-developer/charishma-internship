import TabBackButton from '../../components/TabBackButton';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, RefreshControl, Animated, LayoutAnimation, UIManager, Alert, ActivityIndicator, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ShimmerCard } from '../../components/ShimmerLoader';
import { connectSocket } from '../../utils/socket';
import { COLORS, SHADOWS, surfaceLift } from '../../constants/theme';
import { ENDPOINTS } from '../../constants/api';
import { useTheme } from '../../context/ThemeContext';
import { useCartActions, basketKindOf } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/auth';
import AmbientBackground from '../../components/AmbientBackground';
import { StaggeredSection, BounceIn, FloatingPulse, PulseGlow } from '../../components/AnimatedSection';
import { ActionPressable } from '../../components/DopaminePressable';
import { isVendorFulfilled } from '../../utils/localVendor';
import { formatINR, formatISTDate, formatISTDateTime, plural } from '../../utils/format';
import { orderSlotLabel } from '../../utils/deliverySlots';
import { Ionicons } from '@expo/vector-icons';
import { plainDiscountLabel } from '../../utils/billLabel';
import { useTopInset } from '../../utils/useTopInset';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ScalePressable = ({ children, onPress, style, activeOpacity = 0.85 }: any) => {
  const scale = useRef(new Animated.Value(1)).current;
  
  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
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

// Friendly labels for the backend status enum (never show raw enums like READYFORPICKUP).
const STATUS_LABEL: Record<string, string> = {
  Pending: 'Awaiting store',
  Accepted: 'Confirmed',
  Preparing: 'Preparing',
  ReadyForPickup: 'Ready for pickup',
  Picking: 'Rider at store',
  PickedUp: 'Out for delivery',
  OutForDelivery: 'Out for delivery',
  ArrivedAtGate: 'Rider at gate',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
};
const statusLabel = (s?: string) => {
  if (!s) return 'Awaiting store';
  if (STATUS_LABEL[s]) return STATUS_LABEL[s];
  console.warn('Unknown order status:', s);
  return 'In progress';
};
/** "Ravi will call you on 98765 43210" (partner details set by Zenvy), else who usually calls. */
const callerLine = (b: any): string => {
  const d = b && typeof b.driverDetails === 'object' && b.driverDetails ? b.driverDetails : {};
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  const phone = typeof d.phone === 'string' ? d.phone.replace(/\D/g, '').slice(-10) : '';
  const mine = typeof b?.contactPhone === 'string' ? b.contactPhone.replace(/\D/g, '').slice(-10) : '';
  const onMine = mine.length === 10 ? ` on ${mine.slice(0, 5)} ${mine.slice(5)}` : '';
  if (name && phone.length === 10) return `${name} (${phone.slice(0, 5)} ${phone.slice(5)}) will call you${onMine}.`;
  if (name) return `${name} will call you${onMine}.`;
  return `The partner or the ZCS team will call you${onMine} to confirm the details.`;
};

/** One short reference for orders and bookings: the last 6 characters of the id. */
const shortRef = (id: unknown) => String(id || '').slice(-6).toUpperCase();
const FILTER_LABEL: Record<string, string> = { ALL: 'All', ACTIVE: 'Active', PAST: 'Past', SERVICES: 'Services' };
const isActiveStatus = (s?: string) => s !== 'Delivered' && s !== 'Cancelled';
const PIN_STATUSES = ['Accepted', 'Preparing', 'ReadyForPickup', 'Picking', 'PickedUp', 'ArrivedAtGate'];

// The server sends at most this many orders per page (GET /api/orders/myorders).
const ORDERS_SERVER_PAGE = 50;
const orderKey = (o: any) => String(o?._id || o?.id || '');
// Order search, on the phone too (a server without ?q= support still gets a working search box).
const orderMatches = (o: any, q: string): boolean => {
  if (!q) return true;
  const hay = [o?.restaurantName, o?.restaurant?.name, o?.category === 'Mega Basket' ? 'shopping list' : '']
    .concat(parseItems(o?.items).map((i: any) => i?.name))
    .filter(Boolean).join(' ').toLowerCase();
  return q.split(' ').every((w) => hay.includes(w));
};

const parseItems = (raw: any): any[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
};

const parseBreakdown = (raw: any): any => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

// Service bookings (repairs, print, laundry, tailoring…)
const SERVICE_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  DIAGNOSED_QUOTED: 'Quote ready',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  READY_FOR_DELIVERY: 'Ready for delivery',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const serviceStatusLabel = (s?: string) => (s && SERVICE_STATUS_LABEL[s]) || (s ? s.replace(/_/g, ' ').toLowerCase() : 'Requested');
const isServiceOpen = (s?: string) => s !== 'COMPLETED' && s !== 'CANCELLED';
// The partner has the student's items: cancelling goes through support (the server refuses it too).
const PICKED_UP_STATUSES = ['IN_PROGRESS', 'READY_FOR_DELIVERY'];
const formatWhen = (iso?: string) => formatISTDateTime(iso);

const amountCharged = (o: any) => Number(o.finalPrice ?? o.priceBreakdown?.finalPrice ?? o.totalPrice ?? 0) || 0;

export default function OrdersScreen() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { user, refreshUser } = useAuth();
  const { addToCart } = useCartActions();
  const [orders, setOrders] = useState<any[]>([]);
  // Paging past the newest 50 (?before=) and search (?q=); both degrade to the loaded list.
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'PAST' | 'SERVICES'>('ALL');
  // Order history renders 15 cards at a time (it lives inside a ScrollView with the filters and
  // bookings, so it is paged rather than virtualized); more mount as the user nears the end.
  const ORDER_PAGE = 15;
  const [orderLimit, setOrderLimit] = useState(ORDER_PAGE);
  useEffect(() => { setOrderLimit(ORDER_PAGE); }, [filter]);
  const growingOrders = useRef(false);
  const onOrdersScroll = useCallback((e: any) => {
    const ne = e?.nativeEvent || {};
    const nearEnd = (ne.contentOffset?.y || 0) + (ne.layoutMeasurement?.height || 0) > (ne.contentSize?.height || 0) - 800;
    if (nearEnd && !growingOrders.current) {
      growingOrders.current = true;
      setOrderLimit((n) => n + ORDER_PAGE);
      setTimeout(() => { growingOrders.current = false; }, 250);
    }
  }, []);
  const [bookings, setBookings] = useState<any[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);
  const [bookingDetail, setBookingDetail] = useState<Record<string, any>>({});
  const [bookingBusyId, setBookingBusyId] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  // State updates are async: this ref stops a fast double tap from confirming a quote twice.
  const acceptingRef = useRef(false);
  const { segment, bookingId } = useLocalSearchParams<{ segment?: string | string[]; bookingId?: string | string[] }>();
  const segmentParam = Array.isArray(segment) ? segment[0] : segment;
  // A "Quote ready" notification opens Services with that booking expanded.
  const bookingParam = String((Array.isArray(bookingId) ? bookingId[0] : bookingId) || '');
  const openedBookingRef = useRef('');
  useEffect(() => {
    if (segmentParam === 'services' || bookingParam) setFilter('SERVICES');
  }, [segmentParam, bookingParam]);
  const mountedRef = useRef(true);
  const hasLoadedRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleReorder = async (order: any) => {
    const orderKey = order._id || order.id;
    if (reorderingId) return;
    const items = parseItems(order.items);
    if (items.length === 0) {
      Alert.alert('Reorder unavailable', 'We could not find the items from this order.');
      return;
    }
    const targetRestaurantId = order.restaurantId || order.restaurant?.id;
    const targetRestaurantName = order.restaurantName || order.restaurant?.name || 'this store';
    if (!targetRestaurantId) {
      Alert.alert('Reorder unavailable', 'This store is no longer on ZCS.');
      return;
    }

    setReorderingId(orderKey);
    try {
      // Re-read the live menu so the basket uses today's prices and availability.
      const res = await apiFetch(ENDPOINTS.restaurantMenu(targetRestaurantId));
      if (!res.ok) throw new Error(`menu ${res.status}`);
      const menu = await res.json();
      const menuById = new Map<string, any>();
      (Array.isArray(menu) ? menu : []).forEach((m: any) => menuById.set(String(m.id || m._id), m));

      const available: { item: any; live: any }[] = [];
      const dropped: string[] = [];
      items.forEach((item: any) => {
        const itemId = String(item.menuItemId || item.id || item._id || '');
        const live = itemId ? menuById.get(itemId) : null;
        // Stall orders take no add-ons: skip the old order's add-on lines
        if (item.isAddOn && isVendorFulfilled(order)) return;
        if (!live || live.isAvailable === false) {
          // Add-ons (EXTRAS) live in a different store; the basket offers them again at checkout.
          if (!item.isAddOn) dropped.push(item.name || 'An item');
          return;
        }
        available.push({ item, live });
      });

      if (!mountedRef.current) return;
      if (available.length === 0) {
        Alert.alert('Items unavailable', `None of the items from this order are available at ${targetRestaurantName} right now.`);
        return;
      }

      // The basket enforces one store per order itself: when it holds another store's items,
      // addToCart returns false and shows a single "Replace basket?" prompt for all these lines.
      let addedAny = false;
      available.forEach(({ item, live }) => {
        // Customized lines carry their add-on cost (portion, toppings…) on top of today's base price;
        // the server quote is still the bill.
        const hasCustom = !!(item.customizations && typeof item.customizations === 'object' && Object.keys(item.customizations).length);
        const addOn = hasCustom ? Math.max(0, Number(item.addOnPrice) || 0) : 0;
        const added = addToCart({
            id: String(live.id || live._id),
            name: live.name || item.name,
            price: (Number(live.price) || 0) + addOn,
            basePrice: Number(live.price) || 0,
            image: live.imageUrl || item.image || '',
            restaurantId: targetRestaurantId,
            restaurantName: targetRestaurantName,
            quantity: Math.min(Math.max(Number(item.quantity) || 1, 1), 20),
            customizations: item.customizations || undefined,
            vendorType: order.category || undefined,
            ...(isVendorFulfilled(order) ? { isStall: true } : {}),
        });
        if (added) addedAny = true;
      });
      if (!addedAny) return; // the basket's "Replace basket?" prompt is showing

      if (dropped.length > 0) {
        Alert.alert(
          'Some items are unavailable',
          `${dropped.join(', ')} ${dropped.length === 1 ? 'is' : 'are'} not available right now, so we left ${dropped.length === 1 ? 'it' : 'them'} out.`
        );
      }
      router.push(`/(tabs)/basket?basket=${basketKindOf({ isStall: isVendorFulfilled(order), vendorType: order.category })}` as any);
    } catch (e) {
      console.error('Reorder error:', e);
      if (mountedRef.current) Alert.alert('Could not reorder', 'Please check your connection and try again.');
    } finally {
      if (mountedRef.current) setReorderingId(null);
    }
  };

  const fetchOrders = useCallback(async (mode: 'initial' | 'silent' = 'initial') => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    // Full-screen skeleton only for the very first load; later refreshes keep the list on screen.
    if (mode === 'initial' && !hasLoadedRef.current) setLoading(true);
    try {
      const res = await apiFetch(ENDPOINTS.myOrders);
      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      const data = await res.json();
      if (!mountedRef.current) return;
      const fresh: any[] = Array.isArray(data) ? data : [];
      // A refresh brings the newest page; older pages the user already loaded stay below it.
      setOrders((prev) => {
        if (!prev.length || fresh.length < ORDERS_SERVER_PAGE) return fresh;
        const ids = new Set(fresh.map(orderKey));
        const oldest = new Date(fresh[fresh.length - 1]?.createdAt || 0).getTime();
        const older = prev.filter((o) => !ids.has(orderKey(o)) && new Date(o?.createdAt || 0).getTime() < oldest);
        return [...fresh, ...older];
      });
      if (!hasLoadedRef.current) setHasMoreOrders(fresh.length >= ORDERS_SERVER_PAGE);
      setError(null);
      hasLoadedRef.current = true;
    } catch (e: any) {
      console.error('Orders sync error:', e);
      if (mountedRef.current) setError('We could not load your orders. Check your connection and try again.');
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Older orders: the page before the oldest one on screen. A server that ignores ?before= sends the
  // same newest page again; nothing new is added and the button goes away.
  const loadOlderOrders = useCallback(async () => {
    if (loadingOlder) return;
    const oldest = orders[orders.length - 1]?.createdAt;
    if (!oldest) { setHasMoreOrders(false); return; }
    setLoadingOlder(true);
    try {
      const res = await apiFetch(`${ENDPOINTS.myOrders}?before=${encodeURIComponent(String(oldest))}&limit=${ORDERS_SERVER_PAGE}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      if (!mountedRef.current) return;
      const page: any[] = Array.isArray(data) ? data : [];
      let added = 0;
      setOrders((prev) => {
        const ids = new Set(prev.map(orderKey));
        const extra = page.filter((o) => !ids.has(orderKey(o)));
        added = extra.length;
        return extra.length ? [...prev, ...extra] : prev;
      });
      setHasMoreOrders(page.length >= ORDERS_SERVER_PAGE && added > 0);
      setOrderLimit((n) => n + ORDER_PAGE);
    } catch {
      if (mountedRef.current) Alert.alert("Couldn't load older orders", 'Check your connection and try again.');
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
    }
  }, [orders, loadingOlder]);

  // Search: instant on the loaded orders, then the server's ?q= finds older ones (debounced).
  const searchQ = orderSearch.trim().toLowerCase().replace(/\s+/g, ' ');
  useEffect(() => {
    if (searchQ.length < 2) { setSearchResults(null); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`${ENDPOINTS.myOrders}?q=${encodeURIComponent(searchQ)}&limit=${ORDERS_SERVER_PAGE}`);
        const data = res.ok ? await res.json() : null;
        if (alive && mountedRef.current) setSearchResults(Array.isArray(data) ? data : null);
      } catch {
        if (alive && mountedRef.current) setSearchResults(null);
      } finally {
        if (alive && mountedRef.current) setSearching(false);
      }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [searchQ]);
  const listOrders: any[] = React.useMemo(() => {
    if (!searchQ) return orders;
    const seen = new Set<string>();
    return [...orders, ...(searchResults || [])]
      .filter((o) => { const k = orderKey(o); if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .filter((o) => orderMatches(o, searchQ))
      .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
  }, [orders, searchResults, searchQ]);

  const fetchBookings = useCallback(async () => {
    setBookingsLoading(true);
    try {
      const res = await apiFetch(ENDPOINTS.servicesMyBookings);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `status ${res.status}`);
      if (!mountedRef.current) return;
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
      setBookingsError(null);
      setBookingsLoaded(true);
    } catch (e) {
      console.warn('Service bookings error:', e);
      if (mountedRef.current) setBookingsError('We could not load your service bookings. Check your connection and try again.');
    } finally {
      if (mountedRef.current) setBookingsLoading(false);
    }
  }, []);

  const toggleBooking = async (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (!next) return;
    try {
      const res = await apiFetch(ENDPOINTS.servicesDetail(id));
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.booking && mountedRef.current) {
        setBookingDetail(prev => ({ ...prev, [id]: data.booking }));
      }
    } catch {
      // The card already shows the list data; the timeline simply stays as it was.
    }
  };

  useEffect(() => {
    if (!bookingParam || openedBookingRef.current === bookingParam) return;
    if (!bookings.some((x) => String(x.id || x._id) === bookingParam)) return;
    openedBookingRef.current = bookingParam;
    if (expanded !== bookingParam) toggleBooking(bookingParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingParam, bookings]);

  const applyBooking = (id: string, booking: any) => {
    if (!booking || !mountedRef.current) return;
    setBookings(prev => prev.map(x => (String(x.id || x._id) === id ? { ...x, ...booking } : x)));
    setBookingDetail(prev => ({ ...prev, [id]: booking }));
  };

  const cancelBooking = (b: any) => {
    const id = String(b.id || b._id);
    Alert.alert('Cancel this booking?', `${b.title || 'This service'} will be cancelled.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          setBookingBusyId(id);
          try {
            const res = await apiFetch(ENDPOINTS.servicesCancel(id), { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by customer' }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              // The server sends the current booking back (e.g. already picked up): show its real stage.
              if (data?.booking) applyBooking(id, data.booking);
              Alert.alert('Could not cancel', data?.message || 'Please try again in a moment.');
              return;
            }
            applyBooking(id, data.booking || { ...b, status: 'CANCELLED' });
          } catch {
            Alert.alert('Could not cancel', 'Please check your connection and try again.');
          } finally {
            if (mountedRef.current) setBookingBusyId(null);
          }
        },
      },
    ]);
  };

  const acceptQuote = async (b: any) => {
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    const id = String(b.id || b._id);
    setBookingBusyId(id);
    try {
      // quotedAmount = the price the student saw: the server refuses (QUOTE_CHANGED) if it moved meanwhile.
      const res = await apiFetch(ENDPOINTS.servicesConfirmQuote(id), { method: 'POST', body: JSON.stringify({ acceptQuote: true, quotedAmount: b.quotedAmount }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert('Could not confirm', data?.message || 'Please try again in a moment.');
        return;
      }
      applyBooking(id, data.booking);
    } catch {
      Alert.alert('Could not confirm', 'Please check your connection and try again.');
    } finally {
      acceptingRef.current = false;
      if (mountedRef.current) setBookingBusyId(null);
    }
  };

  // Refetch every time the tab gains focus (after checkout, cancel, rating...).
  useFocusEffect(
    useCallback(() => {
      if (user) fetchOrders(hasLoadedRef.current ? 'silent' : 'initial');
      if (user && filter === 'SERVICES') fetchBookings();
    }, [user, fetchOrders, fetchBookings, filter])
  );

  // Clear the list when the account signs out.
  useEffect(() => {
    if (!user) {
      setOrders([]);
      setBookings([]);
      setBookingsLoaded(false);
      setBookingDetail({});
      hasLoadedRef.current = false;
    }
  }, [user]);

  // Live status for active orders: join each order room and patch the card in place.
  const activeIdsKey = orders
    .filter(o => isActiveStatus(o.status))
    .map(o => String(o._id || o.id))
    .sort()
    .join(',');
  useEffect(() => {
    if (!user || !activeIdsKey) return;
    const ids = activeIdsKey.split(',');
    let socket: any;
    try {
      socket = connectSocket();
    } catch {
      return;
    }
    const join = () => ids.forEach(id => socket.emit('joinOrder', id));
    join();
    const onStatus = (payload: any) => {
      const pid = String(payload?.id || payload?.orderId || '');
      if (!pid || !ids.includes(pid) || !payload?.status || !mountedRef.current) return;
      // A store timeout / cancel refunds Wallet orders: keep the balance on Profile and Checkout current.
      if (payload.status === 'Cancelled' && Number(payload.refundedToWallet) > 0) refreshUser?.().catch(() => {});
      setOrders(prev => prev.map(o => (
        String(o._id || o.id) === pid
          ? {
              ...o,
              status: payload.status,
              ...(payload.finalPrice != null ? { finalPrice: payload.finalPrice } : {}),
              ...(payload.reason === 'STORE_TIMEOUT' ? { cancellationReason: 'The store did not accept the order in time' } : {}),
            }
          : o
      )));
    };
    socket.on('connect', join);
    socket.on('statusUpdated', onStatus);
    return () => {
      socket.off('connect', join);
      socket.off('statusUpdated', onStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeIdsKey]);

  // Admin / partner stage changes and quotes arrive live (server: serviceStatusUpdate to this user's room).
  useEffect(() => {
    if (!user) return;
    let socket: any;
    try {
      socket = connectSocket();
    } catch {
      return;
    }
    const onServiceStatus = (payload: any) => {
      const pid = String(payload?.id || '');
      if (!pid || !mountedRef.current) return;
      setBookings(prev => prev.map(x => (
        String(x.id || x._id) === pid
          ? {
              ...x,
              ...(payload.status ? { status: payload.status } : {}),
              ...(payload.quotedAmount != null ? { quotedAmount: payload.quotedAmount } : {}),
              ...(payload.finalAmount != null ? { finalAmount: payload.finalAmount } : {}),
            }
          : x
      )));
      // Pull the full booking (timeline note) for an open card, and the list for a new booking.
      apiFetch(ENDPOINTS.servicesDetail(pid))
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data?.booking || !mountedRef.current) return;
          setBookings(prev => (prev.some(x => String(x.id || x._id) === pid)
            ? prev.map(x => (String(x.id || x._id) === pid ? { ...x, ...data.booking } : x))
            : [data.booking, ...prev]));
          setBookingDetail(prev => ({ ...prev, [pid]: data.booking }));
        })
        .catch(() => {});
    };
    socket.on('serviceStatusUpdate', onServiceStatus);
    return () => {
      socket.off('serviceStatusUpdate', onServiceStatus);
    };
  }, [user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await (filter === 'SERVICES' ? fetchBookings() : fetchOrders('silent'));
    if (mountedRef.current) setRefreshing(false);
  };

  const bg = colors.bg;
  const cardBg = colors.card;
  // Light mode: cards get a soft lift so they separate from the page (dark: none)
  const lift = surfaceLift(isDark);
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;

  if (!user) {
    return (
      <View style={[st.container, { paddingTop: topPad, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <AmbientBackground />
        <Ionicons name="lock-closed-outline" size={48} color={txtSec} style={{ marginBottom: 16 }} />
        <Text style={{ fontSize: 18, fontWeight: '700', color: txt, letterSpacing: 0.2, textAlign: 'center', marginBottom: 8 }}>
          Sign in to see your orders
        </Text>
        <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', textAlign: 'center', marginBottom: 24, lineHeight: 18 }}>
          Track deliveries and get your Delivery PIN.
        </Text>
        <TouchableOpacity 
          style={{ 
            backgroundColor: COLORS.red, 
            paddingHorizontal: 32, 
            paddingVertical: 14, 
            borderRadius: 16, 
            ...SHADOWS.redGlow 
          }} 
          onPress={() => router.push('/login' as any)}
        >
          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>Sign in or sign up</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(expanded === id ? null : id);
  };

  const statusColor = (s: string) => {
    if (s === 'Delivered') return COLORS.emerald;
    if (s === 'Cancelled') return '#EF4444';
    return isDark ? COLORS.gold : colors.gold;
  };

  const renderServices = () => {
    if (bookingsLoading && !bookingsLoaded) {
      return (
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          <ShimmerCard />
          <ShimmerCard />
        </View>
      );
    }
    if (bookingsError && bookings.length === 0) {
      return (
        <View style={[st.emptyBox, { backgroundColor: cardBg, borderColor: border }, lift]}>
          <Ionicons name="cloud-offline-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
          <Text style={[st.emptyTitle, { color: txt }]}>Couldn't load your bookings</Text>
          <Text style={[st.emptyDesc, { color: txtSec }]}>{bookingsError}</Text>
          <TouchableOpacity style={[st.browseBtn, { backgroundColor: COLORS.gold || '#D4AF7A' }]} activeOpacity={0.85} onPress={fetchBookings}>
            <Text style={[st.browseBtnText, { color: '#000' }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (bookings.length === 0) {
      return (
        <View style={[st.emptyBox, { backgroundColor: cardBg, borderColor: border }, lift]}>
          <Ionicons name="construct-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
          <Text style={[st.emptyTitle, { color: txt }]}>No service bookings yet</Text>
          <Text style={[st.emptyDesc, { color: txtSec }]}>
            Repairs, laundry and tailoring you book will show up here with their live status.
          </Text>
          <TouchableOpacity style={[st.browseBtn, { backgroundColor: COLORS.red }]} activeOpacity={0.85} onPress={() => router.push({ pathname: '/(tabs)/others', params: { tab: 'services' } } as any)}>
            <Text style={st.browseBtnText}>Browse services</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return bookings.map((b, idx) => {
      const bid = String(b.id || b._id);
      const detail = bookingDetail[bid] || b;
      const isOpen = isServiceOpen(b.status);
      const isExpanded = expanded === bid;
      // A fresh quote is what the student is asked to accept; otherwise the final (or estimated) amount.
      const amount = Number((b.status === 'DIAGNOSED_QUOTED' ? b.quotedAmount : (b.finalAmount || b.quotedAmount)) || 0) || 0;
      const spec = detail.specifications && typeof detail.specifications === 'object' ? detail.specifications : {};
      const qty = Number(spec.quantity) || 0;
      const qtyText = qty > 0 ? `${qty} ${spec.unit === 'kg' ? 'kg (approx.)' : qty === 1 ? 'item' : 'items'}` : '';
      const history: any[] = Array.isArray(detail.trackingHistory) ? detail.trackingHistory : [];
      const busy = bookingBusyId === bid;
      const color = b.status === 'COMPLETED' ? COLORS.emerald : b.status === 'CANCELLED' ? '#EF4444' : goldColor;
      return (
        <StaggeredSection key={bid} delay={idx * 60} direction="up">
          <ScalePressable style={[st.card, { backgroundColor: cardBg, borderColor: border }, lift]} onPress={() => toggleBooking(bid)}>
            <View style={st.cardHeader}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700', letterSpacing: 0.3 }}>
                  <Text style={{ color: goldColor, fontWeight: '600' }}>Booking #{shortRef(bid)}</Text>
                </Text>
                <Text style={[st.restaurantName, { color: txt }]} numberOfLines={2}>{b.title || 'Service booking'}</Text>
                <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>
                  {[b.pickupSlot, formatWhen(b.createdAt)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                <Text style={[st.statusBadge, { color }]}>{serviceStatusLabel(b.status)}</Text>
                <Text style={[st.price, { color: txt }]}>{amount > 0 ? formatINR(amount) : 'Quote pending'}</Text>
                {amount > 0 && b.status !== 'COMPLETED' ? (
                  <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700' }}>estimate</Text>
                ) : null}
              </View>
            </View>

            {/* Quote waiting for the student, and who will call (the partner or the Zenvy team) */}
            {b.status === 'DIAGNOSED_QUOTED' && Number(b.quotedAmount) > 0 && (
              <View style={[st.quotePill, { borderColor: goldColor }]}>
                <Ionicons name="pricetag-outline" size={14} color={goldColor} />
                <Text style={[st.quotePillText, { color: txt }]}>Quote ready: {formatINR(b.quotedAmount)}. Approve it to go ahead.</Text>
              </View>
            )}
            {isOpen && (
              <Text style={[st.callLine, { color: txtSec }]}>
                {callerLine(detail)}
              </Text>
            )}
            <TouchableOpacity
              style={{ marginTop: 8, alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}
              onPress={() => router.push(`/service-booking/${bid}` as any)}
              accessibilityRole="button"
              accessibilityLabel={`Track booking ${shortRef(bid)}`}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: isDark ? goldColor : COLORS.red }}>Track booking ›</Text>
            </TouchableOpacity>

            {isExpanded && (
              <View style={[st.details, { borderTopColor: border }]}>
                {detail.description ? (
                  <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', marginBottom: 8 }}>{detail.description}</Text>
                ) : null}
                {qtyText || detail.hostelBlock || detail.roomNumber ? (
                  <Text style={{ fontSize: 12, color: txt, fontWeight: '700', marginBottom: 8 }}>
                    {[qtyText, [detail.hostelBlock, detail.roomNumber ? `Room ${detail.roomNumber}` : ''].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {history.map((h: any, i: number) => (
                  <View key={`h-${i}`} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 12, color: i === history.length - 1 ? goldColor : txtSec }}>●</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: txt, fontWeight: '600' }}>{serviceStatusLabel(h.stage)}</Text>
                      {h.note ? <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>{h.note}</Text> : null}
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>{formatWhen(h.timestamp)}</Text>
                    </View>
                  </View>
                ))}
                <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', marginTop: 6 }}>
                  {b.paymentMethod === 'Wallet' ? 'Pay from ZCS Wallet' : 'Pay in cash when the job is done'}
                </Text>
                {b.status === 'DIAGNOSED_QUOTED' && (
                  <ActionPressable style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12 }} onPress={() => { if (!busy) acceptQuote(b); }} sound="click">
                    <LinearGradient colors={['#D4AF7A', '#F0D9A8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.trackBtnGradient}>
                      {busy ? <ActivityIndicator size="small" color="#000" /> : <Text style={st.trackBtnText}>Accept quote · {formatINR(b.quotedAmount)}</Text>}
                    </LinearGradient>
                  </ActionPressable>
                )}
                {isOpen && !PICKED_UP_STATUSES.includes(b.status) && (
                  <TouchableOpacity
                    disabled={busy}
                    style={{ marginTop: 12, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: '#EF4444', alignItems: 'center' }}
                    onPress={() => cancelBooking(b)}
                  >
                    {busy ? <ActivityIndicator size="small" color="#EF4444" /> : (
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#EF4444', letterSpacing: 0.3 }}>Cancel booking</Text>
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => router.push({ pathname: '/support', params: { bookingId: bid } } as any)}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: isDark ? goldColor : COLORS.red }}>Need help with this booking? ›</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScalePressable>
        </StaggeredSection>
      );
    });
  };

  return (
    <View style={[st.container, { paddingTop: topPad, backgroundColor: bg }]}>
      <AmbientBackground />
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={250}
        onScroll={onOrdersScroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={goldColor} colors={[COLORS.red, COLORS.gold]} />
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
          <TabBackButton />
          <Text style={[st.pageTitle, { color: txt, paddingHorizontal: 0, marginBottom: 0 }]}>Your orders</Text>
        </View>

        <View style={st.filterRow}>
          {['ALL', 'ACTIVE', 'PAST', 'SERVICES'].map((f) => {
            const isActive = filter === f;
            return (
              <TouchableOpacity
                key={f}
                style={[
                  st.filterBtn,
                  { 
                    backgroundColor: isActive ? (isDark ? goldColor : COLORS.red) : (isDark ? 'rgba(255,255,255,0.05)' : cardBg),
                    borderColor: isActive ? 'transparent' : border
                  },
                  !isActive && surfaceLift(isDark, true),
                ]}
                onPress={() => setFilter(f as any)}
              >
                <Text maxFontSizeMultiplier={1.3} style={[
                  st.filterBtnText, 
                  { color: isActive ? (isDark ? '#000' : '#FFF') : txtSec }
                ]}>
                  {FILTER_LABEL[f] || f}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {filter !== 'SERVICES' && orders.length > 0 && (
          <View style={[st.orderSearch, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : cardBg, borderColor: border }, lift]}>
            <Ionicons name="search-outline" size={16} color={txtSec} />
            <TextInput
              value={orderSearch}
              onChangeText={setOrderSearch}
              placeholder="Search by store or dish"
              placeholderTextColor={txtSec}
              style={[st.orderSearchInput, { color: txt }]}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search your orders"
            />
            {searching ? <ActivityIndicator size="small" color={txtSec} /> : !!orderSearch && (
              <TouchableOpacity onPress={() => setOrderSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={17} color={txtSec} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {filter === 'SERVICES' ? renderServices() : null}

        {filter !== 'SERVICES' && error && orders.length > 0 && !loading ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => fetchOrders('silent')}
            style={{ marginHorizontal: 16, marginBottom: 12, padding: 10, borderRadius: 12, backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)' }}
          >
            <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>
              Couldn't refresh your orders. Tap to try again.
            </Text>
          </TouchableOpacity>
        ) : null}

        {filter === 'SERVICES' ? null : loading ? (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            <ShimmerCard />
            <ShimmerCard />
            <ShimmerCard />
          </View>
        ) : error && orders.length === 0 ? (
          <View style={[st.emptyBox, { backgroundColor: cardBg, borderColor: border }, lift]}>
            <Ionicons name="cloud-offline-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
            <Text style={[st.emptyTitle, { color: txt }]}>Couldn't load your orders</Text>
            <Text style={[st.emptyDesc, { color: txtSec }]}>
              {error}
            </Text>
            <TouchableOpacity
              style={[st.browseBtn, { backgroundColor: COLORS.gold || '#D4AF7A' }]}
              activeOpacity={0.85}
              onPress={() => fetchOrders('initial')}
            >
              <Text style={[st.browseBtnText, { color: '#000' }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : orders.length === 0 ? (
          <View style={[st.emptyBox, { backgroundColor: cardBg, borderColor: border }, lift]}>
            <FloatingPulse>
              <Ionicons name="receipt-outline" size={50} color={txtSec} style={{ marginBottom: 16 }} />
            </FloatingPulse>
            <Text style={[st.emptyTitle, { color: txt }]}>No orders yet</Text>
            <Text style={[st.emptyDesc, { color: txtSec }]}>
              Your food, grocery and shopping list orders will show up here.
            </Text>
            <TouchableOpacity 
              style={[st.browseBtn, { backgroundColor: COLORS.red }]}
              activeOpacity={0.85}
              onPress={() => router.push('/(tabs)' as any)}
            >
              <Text style={st.browseBtnText}>Browse restaurants</Text>
            </TouchableOpacity>
          </View>
        ) : !loading && listOrders.filter(o => {
          if (filter === 'ACTIVE') return o.status !== 'Delivered' && o.status !== 'Cancelled';
          if (filter === 'PAST') return o.status === 'Delivered' || o.status === 'Cancelled';
          return true;
        }).length === 0 ? (
          <View style={[st.emptyBox, { backgroundColor: cardBg, borderColor: border }, lift]}>
            <Ionicons name={filter === 'ACTIVE' ? 'bicycle-outline' : 'document-text-outline'} size={44} color={txtSec} style={{ marginBottom: 12 }} />
            <Text style={[st.emptyTitle, { color: txt }]}>
              {searchQ ? 'No matching orders' : filter === 'ACTIVE' ? 'No active orders' : 'No past orders'}
            </Text>
            <Text style={[st.emptyDesc, { color: txtSec }]}>
              {searchQ
                ? `No ${filter === 'ACTIVE' ? 'active ' : filter === 'PAST' ? 'past ' : ''}orders match "${orderSearch.trim()}".`
                : filter === 'ACTIVE'
                ? 'You have no orders on the way right now.'
                : 'Delivered and cancelled orders will show up here.'}
            </Text>
            <TouchableOpacity 
              style={[st.browseBtn, { backgroundColor: COLORS.red }]}
              activeOpacity={0.85}
              onPress={() => searchQ ? setOrderSearch('') : filter === 'ACTIVE' ? router.push('/(tabs)' as any) : setFilter('ALL')}
            >
              <Text style={st.browseBtnText}>
                {searchQ ? 'Clear search' : filter === 'ACTIVE' ? 'Browse restaurants' : 'See all orders'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {filter !== 'SERVICES' && !loading && listOrders.filter(o => {
          if (filter === 'ACTIVE') return o.status !== 'Delivered' && o.status !== 'Cancelled';
          if (filter === 'PAST') return o.status === 'Delivered' || o.status === 'Cancelled';
          return true;
        }).slice(0, orderLimit).map((o, idx) => {
          const id = shortRef(o._id || o.id);
          const isExpanded = expanded === (o._id || o.id);
          const orderItems: any[] = parseItems(o.items);
          const breakdown = parseBreakdown(o.priceBreakdown);
          const charged = amountCharged(o);
          const restaurantName = o.restaurantName || o.restaurant?.name || (o.category === 'Mega Basket' ? 'Shopping list' : 'ZCS order');
          const needsRating = o.status === 'Delivered' && o.rating == null;
          // Customer cancels carry no reason (or the default one); store / system cancels explain themselves.
          const cancelReason = o.status === 'Cancelled' && typeof o.cancellationReason === 'string'
            && o.cancellationReason.trim() && !/by customer|by user/i.test(o.cancellationReason)
            ? o.cancellationReason.trim()
            : null;
          // The server sends deliveryPin = null for stall (vendor-delivered) orders, so this card only shows for rider handovers.
          const showPin = !!o.deliveryPin && PIN_STATUSES.includes(o.status);
          const subtotal = Number(breakdown?.subtotal ?? o.totalPrice ?? 0) || 0;
          const deliveryFee = Number(breakdown?.deliveryFee ?? o.deliveryFee ?? 0) || 0;
          const discounts: any[] = Array.isArray(breakdown?.discounts)
            ? breakdown.discounts.filter((d: any) => Number(d?.amount) > 0)
            : [
                ...(Number(o.batchDiscount) > 0 ? [{ label: 'Shared delivery discount', amount: Number(o.batchDiscount) }] : []),
                ...(Number(o.gateDiscount) > 0 ? [{ label: 'Member discount', amount: Number(o.gateDiscount) }] : []),
              ];
          const paymentLabel = o.paymentMethod === 'Wallet' ? 'Paid from ZCS Wallet' : o.paymentMethod === 'COD' ? 'Cash on Delivery' : null;

          return (
            <StaggeredSection key={o._id || o.id} delay={idx * 80} direction="up">
              <ScalePressable 
                style={[st.card, { backgroundColor: cardBg, borderColor: border }, lift]} 
                onPress={() => toggleExpand(o._id || o.id)}
              >
              <View style={st.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700', letterSpacing: 0.3 }}>
                    {o.status === 'Cancelled' ? '✕' : o.status === 'Delivered' ? '✓' : '◉'}{' '}
                    <Text style={{ color: goldColor, fontWeight: '600' }}>Order #{id}</Text>
                  </Text>
                  <Text style={[st.restaurantName, { color: txt }]} numberOfLines={1}>{restaurantName}</Text>
                  <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>{[plural(orderItems.length, 'item'), formatISTDate(o.createdAt)].filter(Boolean).join(' · ')}</Text>
                  {!!orderSlotLabel(o) && o.status !== 'Cancelled' && (
                    <Text style={{ fontSize: 12, color: txt, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>Delivery: {orderSlotLabel(o)}</Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                    {o.status !== 'Delivered' && o.status !== 'Cancelled' && (
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' }} />
                    )}
                    <Text style={[st.statusBadge, { color: statusColor(o.status) }]}>{statusLabel(o.status)}</Text>
                  </View>
                  <Text style={[st.price, { color: txt }]}>{formatINR(charged)}</Text>
                </View>
              </View>

              {/* Quick 1-Tap Track Strip on Active Orders */}
              {o.status !== 'Delivered' && o.status !== 'Cancelled' && !isExpanded && (
                <TouchableOpacity
                  style={{
                    marginTop: 10,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: isDark ? 'rgba(212,175,122,0.15)' : 'rgba(239,79,95,0.08)',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    router.push(`/tracking/${o._id || o.id}` as any);
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: isDark ? goldColor : COLORS.red, letterSpacing: 0.2 }}>
                    {statusLabel(o.status)} · Track order
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: isDark ? goldColor : COLORS.red }}>›</Text>
                </TouchableOpacity>
              )}

              {/* Rate a delivered order (the tracking screen opens the rating sheet) */}
              {needsRating && !isExpanded && (
                <TouchableOpacity
                  style={{
                    marginTop: 10,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: isDark ? 'rgba(212,175,122,0.12)' : 'rgba(201,151,46,0.08)',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    router.push(`/tracking/${o._id || o.id}` as any);
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: goldColor, letterSpacing: 0.2 }}>Rate this order</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: goldColor }}>›</Text>
                </TouchableOpacity>
              )}

              {isExpanded && (
                <View style={[st.details, { borderTopColor: border }]}>
                  {showPin && (
                    <View style={[st.otpSection, { borderColor: isDark ? 'rgba(212,175,122,0.3)' : 'rgba(201,151,46,0.3)', backgroundColor: isDark ? 'rgba(212,175,122,0.08)' : 'rgba(201,151,46,0.08)' }]}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: goldColor, letterSpacing: 0.3, marginBottom: 4 }}>Delivery PIN</Text>
                      <View style={st.otpBox}>
                        <Text style={[st.otpText, { color: goldColor }]}>{o.deliveryPin}</Text>
                        <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700', lineHeight: 14 }}>Share this PIN with your{'\n'}rider at handover only</Text>
                      </View>
                    </View>
                  )}
                  {cancelReason ? (
                    <Text style={{ fontSize: 12, color: '#EF4444', fontWeight: '700', marginBottom: 8 }}>{cancelReason}</Text>
                  ) : null}
                  {orderItems.map((item: any, i: number) => {
                    const qty = Number(item.quantity) || 1;
                    const line = Number(item.lineTotal ?? (Number(item.unitPrice ?? item.price ?? 0) * qty)) || 0;
                    return (
                      <View key={i} style={st.itemRow}>
                        <Text style={{ fontSize: 12, color: txt, fontWeight: '600', flex: 1, marginRight: 8 }} numberOfLines={2}>{qty} × {item.name}</Text>
                        <Text style={{ fontSize: 12, color: txt, fontWeight: '600' }}>{formatINR(line)}</Text>
                      </View>
                    );
                  })}
                  <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }}>
                    <View style={st.itemRow}>
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>Item total</Text>
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700' }}>{formatINR(subtotal)}</Text>
                    </View>
                    {deliveryFee > 0 && (
                      <View style={st.itemRow}>
                        <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>Delivery fee</Text>
                        <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700' }}>{formatINR(deliveryFee)}</Text>
                      </View>
                    )}
                    {discounts.map((d: any, i: number) => (
                      <View key={`d-${i}`} style={st.itemRow}>
                        <Text style={{ fontSize: 12, color: COLORS.emerald, fontWeight: '600', flex: 1, marginRight: 8 }} numberOfLines={1}>{plainDiscountLabel(d.label)}</Text>
                        <Text style={{ fontSize: 12, color: COLORS.emerald, fontWeight: '700' }}>{formatINR(-Math.abs(Number(d.amount)))}</Text>
                      </View>
                    ))}
                    <View style={st.itemRow}>
                      <Text style={{ fontSize: 12, color: txt, fontWeight: '700' }}>{o.status === 'Cancelled' ? 'Order total' : 'Total'}</Text>
                      <Text style={{ fontSize: 12, color: txt, fontWeight: '700' }}>{formatINR(charged)}</Text>
                    </View>
                    {paymentLabel && (
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', marginTop: 2 }}>
                        {paymentLabel}
                        {o.status === 'Cancelled' && o.paymentMethod === 'Wallet' ? ' · refunded to Wallet' : ''}
                        {o.status === 'Cancelled' && o.paymentMethod === 'COD' ? ' · no payment taken' : ''}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={{ marginTop: 10, alignSelf: 'flex-start' }}
                    onPress={() => router.push({ pathname: '/support', params: { orderId: String(o._id || o.id) } } as any)}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: isDark ? goldColor : COLORS.red }}>Need help with this order? ›</Text>
                  </TouchableOpacity>
                  {needsRating && (
                    <TouchableOpacity
                      style={{ marginTop: 8, alignSelf: 'flex-start' }}
                      onPress={() => router.push(`/tracking/${o._id || o.id}` as any)}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '600', color: goldColor }}>Rate this order ›</Text>
                    </TouchableOpacity>
                  )}
                  {o.status !== 'Delivered' && o.status !== 'Cancelled' ? (
                    <ActionPressable style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12 }} onPress={() => router.push(`/tracking/${o._id || o.id}` as any)} sound="click">
                      <LinearGradient
                        colors={['#D4AF7A', '#F0D9A8']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={st.trackBtnGradient}
                      >
                        <Text style={st.trackBtnText}>Track order</Text>
                      </LinearGradient>
                    </ActionPressable>
                  ) : (
                    <ActionPressable style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12 }} onPress={() => handleReorder(o)} sound="click">
                      <LinearGradient
                        colors={['#EF4F5F', '#FF6B7B']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={st.trackBtnGradient}
                      >
                        {reorderingId === (o._id || o.id) ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={[st.trackBtnText, { color: '#fff' }]}>Reorder</Text>
                        )}
                      </LinearGradient>
                    </ActionPressable>
                  )}
                </View>
              )}
            </ScalePressable>
            </StaggeredSection>
          );
        })}
        {filter !== 'SERVICES' && !loading && !searchQ && hasMoreOrders && orderLimit >= listOrders.filter(o => {
          if (filter === 'ACTIVE') return o.status !== 'Delivered' && o.status !== 'Cancelled';
          if (filter === 'PAST') return o.status === 'Delivered' || o.status === 'Cancelled';
          return true;
        }).length && (
          <TouchableOpacity
            style={[st.olderBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : cardBg, borderColor: border }, lift]}
            onPress={loadOlderOrders}
            disabled={loadingOlder}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Load older orders"
          >
            {loadingOlder ? <ActivityIndicator size="small" color={goldColor} /> : <Text style={[st.olderBtnText, { color: goldColor }]}>Load older orders</Text>}
          </TouchableOpacity>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  quotePill: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  quotePillText: { flex: 1, fontSize: 13, fontWeight: '600' },
  callLine: { fontSize: 12, fontWeight: '600', marginTop: 8, lineHeight: 17 },
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50, width: '100%', maxWidth: 600, alignSelf: 'center' },
  pageTitle: { fontSize: 24, fontWeight: '700', letterSpacing: 0.3, paddingHorizontal: 16, marginBottom: 16 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 12, fontWeight: '600' },
  emptyBox: { marginHorizontal: 16, marginTop: 20, padding: 32, borderRadius: 24, alignItems: 'center', borderWidth: 1, ...SHADOWS.card },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 12 },
  browseBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16, ...SHADOWS.redGlow },
  browseBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginBottom: 20, gap: 8 },
  filterBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1 },
  filterBtnText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  orderSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: -8, marginBottom: 16, paddingHorizontal: 14, height: 42, borderRadius: 14, borderWidth: 1 },
  orderSearchInput: { flex: 1, fontSize: 13, fontWeight: '600', paddingVertical: 0 },
  olderBtn: { alignSelf: 'center', marginTop: 4, marginBottom: 8, paddingHorizontal: 20, paddingVertical: 10, minWidth: 160, alignItems: 'center', borderRadius: 14, borderWidth: 1 },
  olderBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  card: { marginHorizontal: 16, marginBottom: 12, borderRadius: 20, padding: 16, borderWidth: 1, ...SHADOWS.card },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  restaurantName: { fontSize: 15, fontWeight: '700', marginVertical: 3, letterSpacing: -0.2 },
  statusBadge: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  price: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  details: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  otpSection: { marginBottom: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  otpBox: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  otpText: { fontSize: 28, fontWeight: '700', color: '#D4AF7A', fontVariant: ['tabular-nums'], letterSpacing: 6 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  trackBtnGradient: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  trackBtnText: { fontSize: 13, fontWeight: '700', color: '#000', letterSpacing: 0.3 },
});
