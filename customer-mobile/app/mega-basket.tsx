import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import NightClosureBanner from '../components/NightClosureBanner';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform, RefreshControl, Linking } from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { ENDPOINTS, API_URL } from '../constants/api';
import { apiFetch } from '../utils/auth';
import { newIdempotencyKey, useDeliverySlots } from '../context/CartContext';
import DeliverySlotPicker from '../components/DeliverySlotPicker';
import { pickSlot, orderSlotLabel } from '../utils/deliverySlots';
import { connectSocket } from '../utils/socket';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { StaggeredSection, FloatingPulse, BounceIn } from '../components/AnimatedSection';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { formatINR, formatISTDate } from '../utils/format';
import { useTopInset } from '../utils/useTopInset';

interface BasketItem {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  priceEstimated: number;
  priceActual?: number | null;
  status: 'Pending' | 'Approved' | 'Unavailable' | string;
}

interface MegaBasket {
  id: string;
  status: 'Created' | 'PaidEstimate' | 'PartnerAssigned' | 'Shopping' | 'PriceApprovalPending' | 'Approved' | 'Purchased' | 'Delivering' | 'Delivered' | 'Cancelled';
  estimatedTotal: number;
  actualTotal?: number | null;
  shoppingFee: number;
  deliveryFee: number;
  deliveryAddress: string;
  /** Delivery slot label + window (server: utils/deliverySlots); null on lists made before slots. */
  deliverySlot?: string | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  deliveryPin?: string;
  paymentMethod: 'COD';
  paymentStatus: 'Pending' | 'Completed';
  items: BasketItem[];
  deliveryPartner?: {
    id?: string;
    name: string;
    phone: string;
    photoUrl?: string;
  } | null;
  createdAt: string;
}

/** Popular essentials from the campus Kirana store (GET /api/catalogue/items?type=grocery). Prices are shop estimates. */
interface QuickItem {
  id: string;
  name: string;
  unit: string;
  priceEstimated: number;
  category: string;
}

const NUM = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (n: any) => formatINR(NUM(n));
// Used only until GET /api/mega-basket/fees answers (or if it fails and there is no earlier list).
const FALLBACK_SHOPPING_FEE = 30;
const FALLBACK_DELIVERY_FEE = 20;
const basketTotal = (b: MegaBasket) =>
  NUM(b.actualTotal ?? b.estimatedTotal) + NUM(b.shoppingFee) + NUM(b.deliveryFee);
const cleanRoom = (room: any) => String(room || '').replace(/^\s*room\s*/i, '').trim();

export default function MegaBasketScreen() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  const router = useRouter();
  const { user } = useAuth();
  const { isDark, colors } = useTheme();
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const cardBg = colors.card;
  const bg = colors.bg;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;

  // Checkout opens this screen with ?tab=list after sending a shopping list, so the student sees it straight away.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string | string[] }>();
  const initialTab = (Array.isArray(tabParam) ? tabParam[0] : tabParam) === 'list' ? 'list' : 'new';
  const [activeTab, setActiveTab] = useState<'new' | 'list'>(initialTab);

  // Form States
  const [items, setItems] = useState<BasketItem[]>([]);
  const [customName, setCustomName] = useState('');
  const [customQty, setCustomQty] = useState('1');
  const [customUnit, setCustomUnit] = useState('pcs');
  const [customPrice, setCustomPrice] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState(() => {
    const u: any = user;
    const block = u?.hostelBlock;
    const room = cleanRoom(u?.roomNumber);
    if (block && room) return `${block}, Room ${room}`;
    return u?.address || '';
  });
  // The profile may load (or the user may sign in) after this screen opens
  useEffect(() => {
    const u: any = user;
    if (!u) return;
    const block = u.hostelBlock;
    const room = cleanRoom(u.roomNumber);
    const fromProfile = block && room ? `${block}, Room ${room}` : (u.address || '');
    if (fromProfile) setDeliveryAddress((prev: string) => prev || String(fromProfile));
  }, [user]);
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  // Idempotency key for the shopping list, tied to its contents and kept across retries until the
  // server answers, so a timed-out request that was processed is not created twice.
  const placeKeyRef = useRef<{ sig: string; key: string } | null>(null);

  // Popular essentials (real catalogue items)
  const [quickItems, setQuickItems] = useState<QuickItem[]>([]);
  const [quickLoading, setQuickLoading] = useState(true);
  // Current fees from the server (public GET /api/mega-basket/fees)
  const [serverFees, setServerFees] = useState<{ shopping: number; delivery: number } | null>(null);

  // Lists & Live updates
  const [baskets, setBaskets] = useState<MegaBasket[]>([]);
  const [selectedBasketId, setSelectedBasketId] = useState<string | null>(null);
  const [loadingBaskets, setLoadingBaskets] = useState(false);
  const [basketsError, setBasketsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [approvingPrice, setApprovingPrice] = useState(false);
  const approvingRef = useRef(false);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const liveNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    if (liveNoteTimer.current) clearTimeout(liveNoteTimer.current);
  }, []);

  const selectedBasket = useMemo(
    () => baskets.find((b) => String(b.id) === String(selectedBasketId)) || null,
    [baskets, selectedBasketId]
  );
  const isFinished = (status: MegaBasket['status']) => status === 'Delivered' || status === 'Cancelled';
  const activeBaskets = useMemo(() => baskets.filter((b) => !isFinished(b.status)), [baskets]);
  const pastBaskets = useMemo(() => baskets.filter((b) => isFinished(b.status)), [baskets]);

  const fetchBaskets = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingBaskets(true);
    try {
      const res = await apiFetch(ENDPOINTS.megaBasketList);
      const data = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (res.ok && Array.isArray(data)) {
        setBaskets(data.map((b: any) => ({ ...b, items: Array.isArray(b?.items) ? b.items : [] })));
        setBasketsError(null);
      } else {
        setBasketsError((data && typeof data.message === 'string' && data.message) || "We couldn't load your shopping lists.");
      }
    } catch {
      if (mountedRef.current) setBasketsError("Can't reach ZCS right now. Check your internet and try again.");
    } finally {
      if (mountedRef.current) setLoadingBaskets(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchBaskets();
  }, [user, fetchBaskets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/catalogue/items?type=grocery&limit=8`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const list = res.ok && data && Array.isArray(data.items) ? data.items : [];
        setQuickItems(list
          .filter((it: any) => it && it.name && it.isAvailable !== false)
          .slice(0, 8)
          .map((it: any) => ({
            id: String(it.id || it._id || it.name),
            name: String(it.name),
            unit: String(it.weight || 'pcs'),
            priceEstimated: NUM(it.price),
            category: String(it.category || 'Essentials'),
          })));
      } catch {
        if (!cancelled) setQuickItems([]);
      } finally {
        if (!cancelled) setQuickLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/mega-basket/fees`);
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !data) return;
        const shopping = Number(data.shoppingFee);
        const delivery = Number(data.deliveryFee);
        if (Number.isFinite(shopping) && Number.isFinite(delivery)) setServerFees({ shopping, delivery });
      } catch {
        // Falls back to the latest list's fees, then the defaults below.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const showLiveNote = useCallback((note: string) => {
    setLiveNote(note);
    if (liveNoteTimer.current) clearTimeout(liveNoteTimer.current);
    liveNoteTimer.current = setTimeout(() => { if (mountedRef.current) setLiveNote(null); }, 4000);
  }, []);

  // Live updates for the open basket (the server only sends them to the owner's basket room)
  useEffect(() => {
    if (!selectedBasketId) return;
    const room = String(selectedBasketId);
    const socket = connectSocket();
    const join = () => socket.emit('joinRoom', room);
    if (socket.connected) join();

    const onStatus = (data: { id?: string; status?: MegaBasket['status']; actualTotal?: number }) => {
      if (!data || String(data.id) !== room || !data.status) return;
      setBaskets((prev) => prev.map((b) => (String(b.id) === room
        ? { ...b, status: data.status as MegaBasket['status'], actualTotal: data.actualTotal ?? b.actualTotal }
        : b)));
      showLiveNote(`Update: ${getStatusLabel(data.status)}`);
      fetchBaskets({ silent: true });
    };
    const onItem = (item: BasketItem) => {
      if (!item || !item.name) return;
      setBaskets((prev) => prev.map((b) => (String(b.id) === room
        ? { ...b, items: b.items.map((i) => ((item.id && i.id === item.id) || (!item.id && i.name === item.name) ? { ...i, ...item } : i)) }
        : b)));
      showLiveNote(`Your shopper updated ${item.name}`);
    };

    socket.on('connect', join);
    socket.on('statusUpdated', onStatus);
    socket.on('basket_item_updated', onItem);
    return () => {
      socket.off('connect', join);
      socket.off('statusUpdated', onStatus);
      socket.off('basket_item_updated', onItem);
    };
  }, [selectedBasketId, fetchBaskets, showLiveNote]);

  const handleQuickAdd = (item: QuickItem) => {
    setItems(prev => {
      const exists = prev.find(i => i.name === item.name);
      if (exists) return prev.map(i => i.name === item.name ? { ...i, quantity: Math.min(50, i.quantity + 1) } : i);
      return [...prev, { name: item.name, quantity: 1, unit: item.unit, priceEstimated: item.priceEstimated, status: 'Pending' }];
    });
  };

  const handleAddCustom = () => {
    const name = customName.trim();
    if (!name) {
      Alert.alert('What should we buy?', 'Type the item name, for example "Tomato ketchup" or "Blue pen".');
      return;
    }
    const qty = Math.min(50, Math.max(1, parseInt(customQty, 10) || 1));
    const price = Math.max(0, parseFloat(customPrice) || 0);
    if (items.find(i => i.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Already on your list', `"${name}" is already in your shopping list. Change the quantity there instead.`);
      return;
    }
    setItems(prev => [...prev, {
      name,
      quantity: qty,
      unit: customUnit.trim() || 'pcs',
      priceEstimated: price,
      status: 'Pending'
    }]);
    setCustomName('');
    setCustomQty('1');
    setCustomPrice('');
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const subtotal = useMemo(() => {
    return items.reduce((acc, curr) => acc + (curr.priceEstimated * curr.quantity), 0);
  }, [items]);

  // Fees for the estimate: the server's current fees (GET /api/mega-basket/fees); if that fails, what the
  // server charged on the customer's latest list; the defaults only when neither is known.
  const latestFees = useMemo(() => {
    const withFees = baskets
      .filter((b) => Number.isFinite(Number(b.shoppingFee)) && Number.isFinite(Number(b.deliveryFee)))
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return withFees[0] ? { shopping: Number(withFees[0].shoppingFee), delivery: Number(withFees[0].deliveryFee) } : null;
  }, [baskets]);
  const shoppingFee = serverFees ? serverFees.shopping : latestFees ? latestFees.shopping : FALLBACK_SHOPPING_FEE;
  const deliveryFee = serverFees ? serverFees.delivery : latestFees ? latestFees.delivery : FALLBACK_DELIVERY_FEE;
  const grandTotal = subtotal + shoppingFee + deliveryFee;

  // Delivery slot for the list (shopping-list lead: 1 hour before the slot). Required when the server has slots.
  const { info: slotInfo, loading: slotsLoading, refresh: refreshSlots } = useDeliverySlots('list', true);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotNote, setSlotNote] = useState<string | null>(null);
  useEffect(() => { setSlotId((prev) => pickSlot(slotInfo, prev)); }, [slotInfo]);
  const selectedSlot = slotInfo?.slots?.find((x) => x.id === slotId && x.open) || null;

  const handlePlaceOrder = async () => {
    if (placingRef.current) return;
    if (!user) {
      router.push('/login' as any);
      return;
    }
    if (items.length === 0) {
      Alert.alert('Your list is empty', 'Add at least one item for your shopper to buy.');
      return;
    }
    if (deliveryAddress.trim().length < 3) {
      Alert.alert('Where should we deliver?', 'Add your hostel block and room number.');
      return;
    }
    if (slotInfo && slotInfo.slots.length > 0 && !selectedSlot) {
      Alert.alert('Pick a delivery slot', 'Choose when your shopper should deliver.');
      return;
    }

    placingRef.current = true;
    setPlacing(true);
    const body = {
      items: items.map(({ name, quantity, unit, priceEstimated }) => ({ name, quantity, unit, priceEstimated })),
      deliveryAddress: deliveryAddress.trim(),
      paymentMethod: 'COD',
      ...(selectedSlot ? { deliverySlot: selectedSlot.id } : {}),
    };
    const sig = JSON.stringify(body);
    if (!placeKeyRef.current || placeKeyRef.current.sig !== sig) {
      placeKeyRef.current = { sig, key: newIdempotencyKey() };
    }
    const idemKey = placeKeyRef.current.key;
    try {
      const res = await apiFetch(ENDPOINTS.megaBasketCreate, {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        body: JSON.stringify({ ...body, idempotencyKey: idemKey })
      });
      const data = await res.json().catch(() => null);
      // The server answered: this attempt is settled (409 = the same key is still being processed).
      if (res.status !== 409 && placeKeyRef.current?.key === idemKey) placeKeyRef.current = null;
      if (!mountedRef.current) return;

      if (res.ok && data && data.id) {
        setItems([]);
        setBaskets(prev => [{ ...data, items: Array.isArray(data.items) ? data.items : [] }, ...prev.filter(b => b.id !== data.id)]);
        setSelectedBasketId(String(data.id));
        setActiveTab('list');
        setSlotNote(null);
        const when = orderSlotLabel(data);
        Alert.alert('Shopping list sent', `${when ? `Delivery: ${when}. ` : ''}A shopper will pick it up before the slot. You will approve the real shop prices before they buy.`);
      } else if (data?.code === 'SLOT_CLOSED') {
        refreshSlots();
        if (data?.nextSlot?.id) setSlotId(String(data.nextSlot.id));
        setSlotNote(data?.nextSlot?.label ? `Booking for that slot has closed. We picked ${data.nextSlot.label} instead.` : 'Booking for that slot has closed. Pick another slot.');
        Alert.alert('That slot has closed', `${data.message} Check the delivery slot and send the list again.`);
      } else {
        Alert.alert('Not placed yet', (res.status < 500 && data && typeof data.message === 'string' && data.message) || "We couldn't send your shopping list. Please try again.");
      }
    } catch {
      if (!mountedRef.current) return;
      // The list may have reached the server before the connection dropped: reload My lists and
      // ask the user to check before retrying (a retry reuses the same key).
      Alert.alert("Couldn't confirm your list", "We couldn't confirm whether your shopping list was sent. Check My lists before trying again.");
      fetchBaskets({ silent: true });
    } finally {
      placingRef.current = false;
      if (mountedRef.current) setPlacing(false);
    }
  };

  const handleApproveBill = async () => {
    if (!selectedBasket || approvingRef.current) return;
    approvingRef.current = true;
    setApprovingPrice(true);
    try {
      const res = await apiFetch(ENDPOINTS.megaBasketApprove(selectedBasket.id), {
        method: 'POST'
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        Alert.alert('Prices approved', 'Your shopper is buying your items now.');
        fetchBaskets({ silent: true });
      } else {
        Alert.alert('Not approved', (res.status < 500 && data && typeof data.message === 'string' && data.message) || 'We could not approve the prices. Please try again.');
        fetchBaskets({ silent: true });
      }
    } catch {
      Alert.alert('Connection problem', "Can't reach ZCS right now. Check your internet and try again.");
    } finally {
      approvingRef.current = false;
      if (mountedRef.current) setApprovingPrice(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBaskets({ silent: true });
    if (mountedRef.current) setRefreshing(false);
  };

  const getStatusStep = (status: MegaBasket['status']) => {
    const steps = ['Created', 'PaidEstimate', 'PartnerAssigned', 'Shopping', 'PriceApprovalPending', 'Approved', 'Purchased', 'Delivering', 'Delivered'];
    return steps.indexOf(status);
  };

  const getStatusLabel = (status: MegaBasket['status']) => {
    const labels: Record<MegaBasket['status'], string> = {
      Created: 'Placed',
      PaidEstimate: 'Finding a shopper for you',
      PartnerAssigned: 'Shopper assigned',
      Shopping: 'Shopper is at the shop',
      PriceApprovalPending: 'Approve the prices',
      Approved: 'Prices approved',
      Purchased: 'Bought, packing your items',
      Delivering: 'On the way',
      Delivered: 'Delivered',
      Cancelled: 'Cancelled'
    };
    return labels[status] || 'Updating…';
  };



  return (
    <KeyboardAvoidingView style={[s.container, { paddingTop: topPad, backgroundColor: bg }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity 
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back" 
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
          <Text style={[s.subText, { color: '#F59E0B' }]}>A shopper buys it for you</Text>
          <Text style={[s.title, { color: txt }]}>Shopping list</Text>
        </View>
      </View>

      {/* Night closure: say it before the list is typed, not on Send */}
      <NightClosureBanner style={{ marginBottom: 8 }} />

      {/* Tabs */}
      <View style={[s.tabRow, { backgroundColor: cardBg, borderColor: border }]}>
        <TouchableOpacity 
          style={[s.tabBtn, activeTab === 'new' && s.tabBtnActive]} 
          onPress={() => { setActiveTab('new'); setSelectedBasketId(null); }}
        >
          {activeTab === 'new' ? (
            <LinearGradient
              colors={['#10B981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Text style={[s.tabLabel, activeTab === 'new' && s.tabLabelActive]}>New list</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[s.tabBtn, activeTab === 'list' && s.tabBtnActive]} 
          onPress={() => { setActiveTab('list'); if (user) fetchBaskets({ silent: baskets.length > 0 }); }}
        >
          {activeTab === 'list' ? (
            <LinearGradient
              colors={['#10B981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Text style={[s.tabLabel, activeTab === 'list' && s.tabLabelActive]}>
            My lists ({activeBaskets.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={{ flex: 1 }} 
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={activeTab === 'list' && user ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} colors={[COLORS.red]} /> : undefined}
      >
        {activeTab === 'new' ? (
          <View style={s.scrollContent}>
            {!user && (
              <TouchableOpacity style={[s.card, { backgroundColor: cardBg, borderColor: border, flexDirection: 'row', alignItems: 'center', gap: 12 }]} onPress={() => router.push('/login' as any)} activeOpacity={0.85}>
                <Ionicons name="lock-closed-outline" size={22} color={txtSec} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.listItemName, { color: txt }]}>Sign in to send a shopping list</Text>
                  <Text style={s.listItemSub}>You can build your list now and sign in to send it.</Text>
                </View>
                <Text style={{ color: COLORS.red, fontWeight: '900', fontSize: 12 }}>Sign in</Text>
              </TouchableOpacity>
            )}
            {/* Quick Add */}
            <StaggeredSection delay={50} direction="up">
              <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={s.cardTitle}>Quick add</Text>
                <View style={s.quickGrid}>
                  {quickLoading ? (
                    <ActivityIndicator color={COLORS.red} style={{ marginVertical: 12, alignSelf: 'center', flex: 1 }} />
                  ) : quickItems.length === 0 ? (
                    <Text style={[s.listItemSub, { paddingVertical: 8 }]}>Type anything you need below. Your shopper buys it from the nearest store.</Text>
                  ) : quickItems.map((item) => (
                    <TouchableOpacity key={item.id} style={[s.quickItem, { borderColor: border }]} onPress={() => handleQuickAdd(item)}>
                      <Text style={s.quickCat} numberOfLines={1}>{item.category}</Text>
                      <Text style={[s.quickName, { color: txt }]} numberOfLines={1}>{item.name}</Text>
                      <Text style={s.quickPrice}>Est. {money(item.priceEstimated)}{item.unit && item.unit !== 'pcs' ? ` · ${item.unit}` : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Custom Input */}
                <View style={s.customSection}>
                  <Text style={s.customTitle}>Add an item</Text>
                  <TextInput 
                    style={[s.input, { color: txt, borderColor: border }]}
                    placeholder="Item name (e.g. Tomato ketchup, blue pen)"
                    placeholderTextColor={txtSec}
                    value={customName}
                    onChangeText={setCustomName}
                  />
                  <View style={s.customRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>Qty</Text>
                      <TextInput 
                        style={[s.input, { color: txt, borderColor: border, textAlign: 'center' }]}
                        keyboardType="numeric"
                        value={customQty}
                        maxLength={2}
                        onChangeText={(val) => setCustomQty(val.replace(/[^0-9]/g, ''))}
                        onBlur={() => { if (!customQty || parseInt(customQty, 10) < 1) setCustomQty('1'); }}
                      />
                    </View>
                    <View style={{ flex: 1.5, marginHorizontal: 8 }}>
                      <Text style={s.inputLabel}>Unit</Text>
                      <TextInput 
                        style={[s.input, { color: txt, borderColor: border, textAlign: 'center' }]}
                        value={customUnit}
                        onChangeText={setCustomUnit}
                        placeholder="pcs / kg / packet"
                        placeholderTextColor={txtSec}
                      />
                    </View>
                    <View style={{ flex: 1.5 }}>
                      <Text style={s.inputLabel}>Est. price</Text>
                      <TextInput 
                        style={[s.input, { color: txt, borderColor: border, textAlign: 'center' }]}
                        keyboardType="numeric"
                        value={customPrice}
                        maxLength={6}
                        placeholder="₹ approx."
                        placeholderTextColor={txtSec}
                        onChangeText={(val) => setCustomPrice(val.replace(/[^0-9.]/g, ''))}
                      />
                    </View>
                  </View>
                  <TouchableOpacity style={s.addCustomBtn} onPress={handleAddCustom}>
                    <Text style={s.addCustomText}>Add to shopping list</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </StaggeredSection>

            {/* Shopping List Items */}
            {items.length > 0 && (
              <StaggeredSection delay={130} direction="up">
                <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                  <Text style={s.cardTitle}>Your shopping list ({items.length})</Text>
                  <View style={{ gap: 8, marginBottom: 12 }}>
                    {items.map((item, idx) => (
                      <View key={idx} style={[s.listItem, { borderColor: border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.listItemName, { color: txt }]}>{item.name}</Text>
                          <Text style={s.listItemSub}>{item.quantity} {item.unit} · Est. {money(item.priceEstimated)}/unit</Text>
                        </View>
                        <Text style={s.listItemPrice}>{money(item.priceEstimated * item.quantity)}</Text>
                        <TouchableOpacity style={s.removeBtn} onPress={() => handleRemoveItem(idx)} accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`}>
                          <Text style={s.removeText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>

                  {/* Subtotals */}
                  <View style={[s.summaryContainer, { borderTopColor: border }]}>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 12 }}>Items subtotal</Text>
                      <Text style={{ color: txt, fontSize: 12 }}>{money(subtotal)}</Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 12 }}>Shopping fee</Text>
                      <Text style={{ color: txt, fontSize: 12 }}>{money(shoppingFee)}</Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 12 }}>Delivery fee</Text>
                      <Text style={{ color: txt, fontSize: 12 }}>{money(deliveryFee)}</Text>
                    </View>
                    <View style={[s.summaryRow, s.grandTotalRow, { borderTopColor: border }]}>
                      <Text style={{ color: txt, fontSize: 12, fontWeight: '900' }}>Estimated total</Text>
                      <Text style={{ color: COLORS.red, fontSize: 14, fontWeight: '900' }}>{money(grandTotal)}</Text>
                    </View>
                  </View>
                </View>
              </StaggeredSection>
            )}

            {/* Delivery address & Payment */}
            <StaggeredSection delay={210} direction="up">
              <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={s.cardTitle}>Delivery and payment</Text>
                <Text style={s.inputLabel}>Hostel block and room</Text>
                <TextInput 
                  style={[s.input, { color: txt, borderColor: border }]}
                  placeholder="e.g. Ganga, Room 304"
                  placeholderTextColor={txtSec}
                  value={deliveryAddress}
                  onChangeText={setDeliveryAddress}
                />

                {(slotInfo || slotsLoading) && (
                  <View style={{ marginTop: 14 }}>
                    <DeliverySlotPicker
                      info={slotInfo}
                      selectedId={selectedSlot ? selectedSlot.id : null}
                      onSelect={(id) => { setSlotId(id); setSlotNote(null); }}
                      loading={slotsLoading}
                      note={slotNote}
                    />
                  </View>
                )}

                <Text style={[s.inputLabel, { marginTop: 12 }]}>Payment</Text>
                <View style={[s.listItem, { borderColor: border }]}>
                  <Ionicons name="cash-outline" size={18} color="#22c55e" style={{ marginRight: 10 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.listItemName, { color: txt }]}>Cash on Delivery</Text>
                    <Text style={s.listItemSub}>You approve the real shop bill first, then pay your shopper in cash.</Text>
                  </View>
                </View>
              </View>
            </StaggeredSection>

            {/* Submit button */}
            <FloatingPulse color={COLORS.red} style={s.placeOrderBtnContainer}>
              <TouchableOpacity style={[s.placeOrderBtn, { width: '100%' }]} onPress={handlePlaceOrder} disabled={placing}>
                {placing ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={s.placeOrderText}>Send list · est. {money(grandTotal)}</Text>
                )}
              </TouchableOpacity>
            </FloatingPulse>
          </View>
        ) : (
          <View style={s.scrollContent}>
            {selectedBasket ? (
              <View>
                <TouchableOpacity style={s.backToListBtn} onPress={() => setSelectedBasketId(null)}>
                  <Text style={s.backToListText}>‹ Back to my lists</Text>
                </TouchableOpacity>

                {!!liveNote && (
                  <BounceIn delay={0}>
                    <View style={[s.listItem, { borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.08)', marginBottom: 12 }]}>
                      <Ionicons name="notifications-outline" size={14} color="#10B981" style={{ marginRight: 8 }} />
                      <Text style={[s.listItemName, { color: txt, flex: 1 }]}>{liveNote}</Text>
                    </View>
                  </BounceIn>
                )}

                <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                  <View style={s.cardHeaderRow}>
                    <View>
                      <Text style={s.inputLabel}>List code</Text>
                      <Text style={s.basketCode}>#{String(selectedBasket.id).slice(-6).toUpperCase()}</Text>
                    </View>
                    <View style={s.statusBadge}>
                      <Text style={s.statusBadgeText}>{getStatusLabel(selectedBasket.status)}</Text>
                    </View>
                  </View>

                  {!!orderSlotLabel(selectedBasket) && (
                    <Text style={[s.listItemName, { color: txt, marginTop: 8 }]}>Delivery: {orderSlotLabel(selectedBasket)}</Text>
                  )}

                  {/* Shopper (the status itself is in the badge above) */}
                  {selectedBasket.deliveryPartner && (
                  <View style={s.statusDetailBox}>
                      <View style={[s.partnerBox, { marginTop: 0, paddingTop: 0, borderTopWidth: 0 }]}>
                        <Ionicons name="person-outline" size={16} color={txtSec} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.partnerLabel}>Your shopper</Text>
                          <Text style={[s.partnerName, { color: txt }]}>{selectedBasket.deliveryPartner.name}</Text>
                          {!!selectedBasket.deliveryPartner.phone && (
                            <TouchableOpacity
                              onPress={() => Linking.openURL(`tel:${String(selectedBasket.deliveryPartner?.phone || '').replace(/[^\d+]/g, '')}`).catch(() => Alert.alert('Could not start the call', 'Please dial the number from your phone app.'))}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Text style={s.partnerPhone}>Call {selectedBasket.deliveryPartner.phone}</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                  </View>
                  )}

                  {/* Delivery PIN (stored as deliveryPin) */}
                  {!!selectedBasket.deliveryPin && getStatusStep(selectedBasket.status) >= getStatusStep('Approved') && selectedBasket.status !== 'Delivered' && (
                    <View style={s.pinBox}>
                      <Text style={s.pinLabel}>Delivery PIN</Text>
                      <Text style={s.pinVal}>{selectedBasket.deliveryPin}</Text>
                      <Text style={s.pinSub}>Share this with your shopper at handover</Text>
                    </View>
                  )}

                  {/* Price Approval pending alerts */}
                  {selectedBasket.status === 'PriceApprovalPending' && (
                    <View style={s.approvalAlertBox}>
                      <Text style={s.approvalAlertTitle}>Approve the shop prices</Text>
                      <Text style={s.approvalAlertDesc}>
                        {selectedBasket.actualTotal != null
                          ? `Your shopper found the real shop prices. The items come to ${money(selectedBasket.actualTotal)}. Approve to let them buy.`
                          : 'Your shopper found the real shop prices. Approve to let them buy.'}
                      </Text>
                      <TouchableOpacity style={s.approveBtn} onPress={handleApproveBill} disabled={approvingPrice}>
                        {approvingPrice ? (
                          <ActivityIndicator size="small" color="#000" />
                        ) : (
                          <Text style={s.approveBtnText}>Approve prices</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Items list */}
                  <Text style={s.cardTitle}>Items</Text>
                  <View style={{ gap: 8, marginBottom: 16 }}>
                    {selectedBasket.items.map((item, idx) => {
                      const isShopping = getStatusStep(selectedBasket.status) >= getStatusStep('Shopping');
                      const actualPrice = item.priceActual !== undefined && item.priceActual !== null ? Number(item.priceActual) : null;
                      
                      return (
                        <View key={idx} style={[s.listItem, { borderColor: border }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.listItemName, { color: txt }, item.status === 'Unavailable' && { textDecorationLine: 'line-through', color: '#ff6b6b' }]}>
                              {item.name}
                            </Text>
                            <Text style={s.listItemSub}>
                              Qty {item.quantity} {item.unit} · Est. {money(item.priceEstimated)}/unit
                            </Text>
                          </View>

                          <View style={{ alignItems: 'flex-end' }}>
                            {item.status === 'Unavailable' ? (
                              <View style={s.unavailableBadge}><Text style={s.unavailableText}>Unavailable</Text></View>
                            ) : isShopping && actualPrice !== null ? (
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={s.actualItemPrice}>Actual: {money(actualPrice * item.quantity)}</Text>
                                {actualPrice !== item.priceEstimated && (
                                  <Text style={[s.priceDiffText, { color: actualPrice > item.priceEstimated ? '#ff6b6b' : '#22c55e' }]}>
                                    {actualPrice > item.priceEstimated ? '↑ Higher' : '↓ Lower'}
                                  </Text>
                                )}
                              </View>
                            ) : (
                              <Text style={[s.listItemPrice, { color: txtSec }]}>Est. {money(item.priceEstimated * item.quantity)}</Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  {/* Summaries */}
                  <View style={[s.summaryContainer, { borderTopColor: border }]}>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 12 }}>Shopping fee</Text>
                      <Text style={{ color: txt, fontSize: 12 }}>{money(selectedBasket.shoppingFee)}</Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 12 }}>Delivery fee</Text>
                      <Text style={{ color: txt, fontSize: 12 }}>{money(selectedBasket.deliveryFee)}</Text>
                    </View>
                    <View style={[s.summaryRow, s.grandTotalRow, { borderTopColor: border }]}>
                      <Text style={{ color: txt, fontSize: 12, fontWeight: '900' }}>{selectedBasket.actualTotal != null ? 'Total (cash on delivery)' : 'Estimated total'}</Text>
                      <Text style={{ color: COLORS.red, fontSize: 14, fontWeight: '900' }}>
                        {money(basketTotal(selectedBasket))}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <View>
                {!user ? (
                  <View style={s.emptyState}>
                    <Ionicons name="lock-closed-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
                    <Text style={[s.emptyTitle, { color: txt }]}>Sign in to see your shopping lists</Text>
                    <TouchableOpacity style={[s.addCustomBtn, { marginTop: 16, paddingHorizontal: 24 }]} onPress={() => router.push('/login' as any)}>
                      <Text style={s.addCustomText}>Sign in</Text>
                    </TouchableOpacity>
                  </View>
                ) : loadingBaskets && baskets.length === 0 ? (
                  <ActivityIndicator size="large" color={COLORS.red} style={{ marginTop: 40 }} />
                ) : basketsError && baskets.length === 0 ? (
                  <View style={s.emptyState}>
                    <Ionicons name="cloud-offline-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
                    <Text style={[s.emptyTitle, { color: txt }]}>Couldn't load your shopping lists</Text>
                    <Text style={s.emptySub}>{basketsError}</Text>
                    <TouchableOpacity style={[s.addCustomBtn, { marginTop: 16, paddingHorizontal: 24 }]} onPress={() => fetchBaskets()}>
                      <Text style={s.addCustomText}>Try again</Text>
                    </TouchableOpacity>
                  </View>
                ) : baskets.length === 0 ? (
                  <View style={s.emptyState}>
                    <Ionicons name="basket-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
                    <Text style={[s.emptyTitle, { color: txt }]}>No shopping lists yet</Text>
                    <Text style={s.emptySub}>Send a shopping list and a shopper will buy it for you.</Text>
                    <TouchableOpacity style={[s.addCustomBtn, { marginTop: 16, paddingHorizontal: 24 }]} onPress={() => setActiveTab('new')}>
                      <Text style={s.addCustomText}>New list</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 12 }}>
                    {[{ title: 'Active', list: activeBaskets }, { title: 'Past', list: pastBaskets }].filter((g) => g.list.length > 0).map((group) => (
                      <View key={group.title} style={{ gap: 12 }}>
                        <Text style={s.cardTitle}>{group.title} ({group.list.length})</Text>
                        {group.list.map((basket) => (
                          <TouchableOpacity
                            key={basket.id}
                            style={[s.card, { backgroundColor: cardBg, borderColor: border, marginBottom: 0 }]}
                            onPress={() => setSelectedBasketId(String(basket.id))}
                          >
                            <View style={s.cardHeaderRow}>
                              <Text style={s.basketCode}>List #{String(basket.id).slice(-6).toUpperCase()}</Text>
                              <View style={s.statusBadge}>
                                <Text style={s.statusBadgeText}>{getStatusLabel(basket.status)}</Text>
                              </View>
                            </View>
                            <Text style={[s.basketItemsText, { color: txtSec }]} numberOfLines={1}>
                              {basket.items.map(i => `${i.quantity} × ${i.name}`).join(', ')}
                            </Text>
                            {!!orderSlotLabel(basket) && (
                              <Text style={[s.basketItemsText, { color: txt }]} numberOfLines={1}>Delivery: {orderSlotLabel(basket)}</Text>
                            )}
                            <View style={s.basketFooterRow}>
                              <Text style={{ fontSize: 12, color: '#888' }}>{formatISTDate(basket.createdAt)}</Text>
                              <Text style={s.basketPrice}>{basket.actualTotal != null ? '' : 'Est. '}{money(basketTotal(basket))}</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>


    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backIcon: { fontSize: 32, fontWeight: '300' },
  subText: { fontSize: 12, fontWeight: '800', color: COLORS.red, letterSpacing: 0.3 },
  title: { fontSize: 18, fontWeight: '900' },

  tabRow: { flexDirection: 'row', padding: 4, borderRadius: 16, borderWidth: 1, marginHorizontal: 16, marginVertical: 12 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 12, overflow: 'hidden' },
  tabBtnActive: { backgroundColor: 'transparent' },
  tabLabel: { fontSize: 12, fontWeight: '800', color: '#888', letterSpacing: 0.2 },
  tabLabelActive: { color: '#FFF' },

  scrollContent: { paddingHorizontal: 16, paddingBottom: 220 },
  card: { padding: 16, borderRadius: 24, borderWidth: 1, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  cardTitle: { fontSize: 13, fontWeight: '900', color: COLORS.red, letterSpacing: 0.2, marginBottom: 12 },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  quickItem: { width: '48%', padding: 10, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.02)' },
  quickCat: { fontSize: 12, fontWeight: '800', color: '#888', letterSpacing: 0.2, marginBottom: 2 },
  quickName: { fontSize: 12, fontWeight: '900' },
  quickPrice: { fontSize: 12, fontWeight: '900', color: '#22c55e', marginTop: 6 },

  customSection: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 16 },
  customTitle: { fontSize: 12, fontWeight: '800', color: '#888', marginBottom: 8 },
  input: { height: 40, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 12, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.02)', marginBottom: 8 },
  inputLabel: { fontSize: 12, fontWeight: '800', color: '#888', letterSpacing: 0.2, marginBottom: 4 },
  customRow: { flexDirection: 'row', marginBottom: 12 },
  addCustomBtn: { height: 40, backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)' },
  addCustomText: { fontSize: 12, fontWeight: '900', color: '#22c55e', letterSpacing: 0.2 },

  listItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.02)', marginBottom: 6 },
  listItemName: { fontSize: 12, fontWeight: '900' },
  listItemSub: { fontSize: 12, color: '#888', fontWeight: '600', marginTop: 1 },
  listItemPrice: { fontSize: 12, fontWeight: '900', color: '#22c55e', marginRight: 10 },
  removeBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 12, color: '#ef4444', fontWeight: '900' },

  summaryContainer: { borderTopWidth: 1, paddingTop: 12, gap: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandTotalRow: { borderTopWidth: 1, paddingTop: 8, marginTop: 4 },

  paymentRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  paymentBtn: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.02)' },
  paymentBtnActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
  paymentBtnText: { fontSize: 12, fontWeight: '900', color: '#888', letterSpacing: 1 },

  placeOrderBtnContainer: {
    height: 50,
  },
  placeOrderBtn: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeOrderText: { fontSize: 13, fontWeight: '900', color: '#FFF', letterSpacing: 0.2 },

  backToListBtn: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 8 },
  backToListText: { fontSize: 12, fontWeight: '800', color: COLORS.red },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  basketCode: { fontSize: 14, fontWeight: '900', color: COLORS.red },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)' },
  statusBadgeText: { fontSize: 12, fontWeight: '800', color: '#22c55e', letterSpacing: 0.2 },

  statusDetailBox: { padding: 12, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.02)', borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.05)', marginBottom: 16 },
  statusDetailLabel: { fontSize: 12, fontWeight: '900', color: '#888', letterSpacing: 1, marginBottom: 2 },
  statusDetailText: { fontSize: 12, fontWeight: '900' },
  partnerBox: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)' },
  partnerLabel: { fontSize: 12, fontWeight: '800', color: '#888' },
  partnerName: { fontSize: 12, fontWeight: '900' },
  partnerPhone: { fontSize: 12, fontWeight: '900', color: '#22c55e', marginTop: 2 },

  pinBox: { padding: 16, borderRadius: 16, backgroundColor: 'rgba(34,197,94,0.03)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.15)', alignItems: 'center', marginBottom: 16 },
  pinLabel: { fontSize: 12, fontWeight: '800', color: '#22c55e', letterSpacing: 0.2 },
  pinVal: { fontSize: 24, fontWeight: '900', color: '#22c55e', letterSpacing: 6, marginVertical: 6 },
  pinSub: { fontSize: 12, fontWeight: '700', color: '#888' },

  approvalAlertBox: { padding: 14, borderRadius: 16, backgroundColor: 'rgba(245,158,11,0.05)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)', marginBottom: 16 },
  approvalAlertTitle: { fontSize: 12, fontWeight: '900', color: '#f59e0b', marginBottom: 4 },
  approvalAlertDesc: { fontSize: 12, fontWeight: '600', color: '#888', lineHeight: 14, marginBottom: 12 },
  approveBtn: { height: 38, backgroundColor: '#f59e0b', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  approveBtnText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.2 },

  unavailableBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.1)' },
  unavailableText: { fontSize: 12, fontWeight: '900', color: '#ef4444' },
  actualItemPrice: { fontSize: 12, fontWeight: '900', color: '#22c55e' },
  priceDiffText: { fontSize: 12, fontWeight: '900', marginTop: 1 },

  basketItemsText: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  basketFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 8, marginTop: 4 },
  basketPrice: { fontSize: 12, fontWeight: '900', color: '#22c55e' },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 0.2, marginBottom: 4, textAlign: 'center' },
  emptySub: { fontSize: 12, fontWeight: '600', color: '#888', textAlign: 'center', paddingHorizontal: 24, lineHeight: 15 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 340, backgroundColor: '#141416', borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 20 },
  modalTitle: { fontSize: 12, fontWeight: '900', color: COLORS.red, letterSpacing: 1.5, textAlign: 'center', marginBottom: 8 },
  modalDesc: { fontSize: 12, fontWeight: '700', color: '#888', textAlign: 'center', lineHeight: 12, marginBottom: 16 },
  qrDisplayBox: { alignItems: 'center', marginBottom: 20 },
  qrBorderSquare: { width: 160, height: 160, borderRadius: 16, borderWidth: 2, borderColor: '#22c55e', backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', gap: 6 },
  qrScanText: { fontSize: 12, fontWeight: '900', color: '#000' },
  qrUpiId: { fontSize: 12, fontWeight: '900', color: '#888' },
  utrInput: { height: 40, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.3)', color: '#FFF', textAlign: 'center', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 8 },
  modalCancelBtn: { flex: 1, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 12, fontWeight: '900', color: '#aaa', letterSpacing: 1 },
  modalSubmitBtn: { flex: 1.2, height: 38, borderRadius: 10, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center' },
  modalSubmitText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 1 }
});
