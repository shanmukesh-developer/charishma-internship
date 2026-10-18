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
  ActivityIndicator,
  TextInput,
  Modal,
  RefreshControl,
} from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import FssaiLine from '../../components/FssaiLine';
import { useAuth } from '../../context/AuthContext';
import { useCart, MAX_ITEM_QTY, newIdempotencyKey } from '../../context/CartContext';
import { API_URL } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import { useLiveSync } from '../../utils/useLiveSync';
import { readCache, writeCache } from '../../utils/swrCache';
import SafeImage from '../../components/SafeImage';
import { ShimmerCard } from '../../components/ShimmerLoader';

const { width: SW } = Dimensions.get('window');

// Max attachment we send inline with a booking (the server accepts JSON bodies up to 10 MB; base64 adds ~33%).
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

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

// Laundry is priced per kg or per piece / pair: the student says how much, the server multiplies
// the catalogue price by it (backend routes/serviceRoutes.js priceServiceBooking). Keep MAX in sync.
const MAX_SERVICE_QTY = 50;
const laundryUnit = (name: string): 'kg' | 'pcs' => (/per\s*kg|\bkg\b/i.test(name) ? 'kg' : 'pcs');

// Pickup slots still ahead of us (a 4–6 PM slot is not offered at 8 PM).
const upcomingPickupSlots = (now = new Date()): string[] => {
  const h = now.getHours();
  const slots: string[] = [];
  if (h < 16) slots.push('Today 4:00 PM - 6:00 PM');
  if (h < 19) slots.push('Today 7:00 PM - 9:00 PM');
  slots.push('Tomorrow Morning 10 AM');
  if (h >= 8 && h < 20) slots.push('Urgent (within 2 hours)');
  return slots;
};

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

const cleanRoom = (room: any) => String(room || '').replace(/^\s*room\s*/i, '').trim();

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

  // Dedicated Service Booking Modal States
  const [selectedService, setSelectedService] = useState<CatalogueItem | null>(null);
  const [serviceModalVisible, setServiceModalVisible] = useState(false);
  const [serviceQty, setServiceQty] = useState('1');
  const [serviceNotes, setServiceNotes] = useState('');
  const [pickupSlots, setPickupSlots] = useState<string[]>(() => upcomingPickupSlots());
  const [pickupSlot, setPickupSlot] = useState<string>(() => upcomingPickupSlots()[0]);
  const [hostelBlock, setHostelBlock] = useState<string>((user as any)?.hostelBlock || '');
  const [roomNumber, setRoomNumber] = useState<string>(cleanRoom((user as any)?.roomNumber || (user as any)?.roomNo));
  const [contactPhone, setContactPhone] = useState<string>((user as any)?.phone || '');
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const submittingRef = useRef(false);
  // One key per booking attempt (made when the booking sheet opens, kept across retries until the
  // server answers) so a timed-out request the server did process is not booked twice on retry.
  const bookingKeyRef = useRef<string>(newIdempotencyKey());

  // Document Upload & Printout Specific States
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    size?: string;
    uri?: string;
    base64?: string;
    type?: string;
  } | null>(null);

  const [pageCount, setPageCount] = useState('1');
  const [printColor, setPrintColor] = useState<'bw' | 'color'>('bw');
  const [printSides, setPrintSides] = useState<'double' | 'single'>('double');
  const [bindingType, setBindingType] = useState<'none' | 'spiral' | 'hardbound'>('none');
  const [copies, setCopies] = useState('1');

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

  // Price shown in the booking sheet (and sent as the quote): the card price, or the print formula
  const isLaundry = categoryId === 'laundry';
  const qtyUnit = selectedService ? laundryUnit(selectedService.name) : 'pcs';
  const qtyNum = Math.min(MAX_SERVICE_QTY, Math.max(1, parseInt(serviceQty, 10) || 1));
  const calculatedServicePrice = useMemo(() => {
    if (categoryId === 'laundry') return Math.round((selectedService?.price || 0) * qtyNum * 100) / 100;
    if (categoryId !== 'print') return selectedService?.price || 0;
    const pages = Math.min(5000, Math.max(1, parseInt(pageCount, 10) || 1));
    const numCopies = Math.min(500, Math.max(1, parseInt(copies, 10) || 1));
    const costPerPage = (printColor === 'color' ? printRates.color : printRates.bw) ?? selectedService?.price ?? 0;
    const printTotal = pages * costPerPage * numCopies;
    const bindingCost = bindingType === 'spiral' ? (printRates.spiral ?? 0) : bindingType === 'hardbound' ? (printRates.hardbound ?? 0) : 0;
    return Math.round((printTotal + bindingCost) * 100) / 100;
  }, [categoryId, selectedService, qtyNum, pageCount, printColor, bindingType, copies, printRates]);

  // Photo / screenshot attachment (images only: there is no document picker in this build)
  const handlePickDocument = async () => {
    try {
      // Android uses the system photo picker (no permission); only iOS asks for library access.
      const perm = Platform.OS === 'ios' ? await ImagePicker.requestMediaLibraryPermissionsAsync() : { granted: true };
      if (!perm.granted) {
        Alert.alert('Allow photo access', 'To attach a photo, allow Zenvy to access your photos in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.5,
        base64: true,
      });
      if (result.canceled || !result.assets || !result.assets[0]) return;
      const asset = result.assets[0];
      const approxBytes = asset.fileSize || (asset.base64 ? Math.round(asset.base64.length * 0.75) : 0);
      if (approxBytes > MAX_ATTACHMENT_BYTES) {
        Alert.alert('That photo is too large', 'Please pick a photo under 6 MB, or crop it and try again.');
        return;
      }
      if (!asset.base64) {
        Alert.alert('Could not read that photo', 'Please try a different photo.');
        return;
      }
      setAttachedFile({
        name: asset.fileName || `Photo_${Date.now()}.jpg`,
        size: approxBytes ? `${(approxBytes / (1024 * 1024)).toFixed(2)} MB` : undefined,
        uri: asset.uri,
        base64: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`,
        type: asset.mimeType || 'image/jpeg',
      });
    } catch {
      Alert.alert('Could not attach', 'Something went wrong while picking the photo. Please try again.');
    }
  };

  useEffect(() => {
    const u: any = user;
    if (u?.hostelBlock) setHostelBlock((prev) => prev || u.hostelBlock);
    if (u?.roomNumber || u?.roomNo) setRoomNumber((prev) => prev || cleanRoom(u.roomNumber || u.roomNo));
    if (u?.phone) setContactPhone((prev) => prev || u.phone);
  }, [user]);

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
      setServiceNotes('');
      setServiceQty('1');
      const slots = upcomingPickupSlots();
      setPickupSlots(slots);
      setPickupSlot((prev) => (slots.includes(prev) ? prev : slots[0]));
      setAttachedFile(null);
      setPageCount('1');
      setCopies('1');
      setPrintColor(/colou?r/i.test(item.name) ? 'color' : 'bw');
      setBindingType(/spiral/i.test(item.name) ? 'spiral' : /thesis|hard\s*bound/i.test(item.name) ? 'hardbound' : 'none');
      bookingKeyRef.current = newIdempotencyKey();
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

  const handleConfirmServiceBooking = async () => {
    if (!selectedService || submittingRef.current) return;
    const block = hostelBlock.trim();
    const room = cleanRoom(roomNumber);
    if (!block || !room) {
      Alert.alert('Where should we pick up?', 'Please enter your hostel block and room number.');
      return;
    }
    const phoneDigits = String(contactPhone || '').replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      Alert.alert('Add a contact number', 'The partner calls you before pickup. Please enter your 10-digit mobile number.');
      return;
    }

    submittingRef.current = true;
    setSubmittingBooking(true);
    try {
      const serviceTypeMapping: Record<string, string> = {
        tailoring: 'TAILORING',
        repairs: 'LAPTOP_REPAIR',
        print: 'PRINTOUT',
        laundry: 'LAUNDRY'
      };

      const finalAmount = calculatedServicePrice;
      const notes = serviceNotes.trim();

      const payload = {
        serviceType: serviceTypeMapping[categoryId] || 'GENERAL',
        title: selectedService.name.slice(0, 200),
        description: (notes ? `[Notes: ${notes}] - ${selectedService.desc}` : selectedService.desc).slice(0, 2000),
        specifications: {
          quantity: isLaundry ? qtyNum : undefined,
          unit: isLaundry ? qtyUnit : undefined,
          pageCount: categoryId === 'print' ? pageCount : undefined,
          printColor: categoryId === 'print' ? printColor : undefined,
          printSides: categoryId === 'print' ? printSides : undefined,
          bindingType: categoryId === 'print' ? bindingType : undefined,
          copies: categoryId === 'print' ? copies : undefined,
          attachedFileName: attachedFile?.name || undefined,
          serviceName: selectedService.name,
          catalogueItemId: selectedService.id,
          category: categoryId,
          notes,
          clientRequestId: bookingKeyRef.current,
        },
        attachmentUrl: attachedFile?.base64 || undefined,
        quotedAmount: finalAmount,
        pickupSlot: pickupSlot,
        hostelBlock: block,
        roomNumber: room,
        deliveryAddress: `${block}, Room ${room}`,
        contactPhone: contactPhone,
        paymentMethod: 'COD',
      };

      let res: Response;
      try {
        res = await apiFetch(`${API_URL}/api/services/book`, {
          method: 'POST',
          headers: { 'Idempotency-Key': bookingKeyRef.current },
          body: JSON.stringify(payload)
        });
      } catch {
        // The booking may have reached the server before the connection dropped: keep the same key
        // for a retry and point the user at their bookings instead of implying nothing was placed.
        Alert.alert(
          'Couldn’t confirm the booking',
          "We couldn't confirm whether your booking went through. Check Orders → Services before trying again.",
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Check bookings', onPress: () => router.push({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any) },
          ]
        );
        return;
      }
      const data = await res.json().catch(() => null);
      // The server answered, so this attempt is settled; a later booking gets a fresh key.
      if (res.status !== 409) bookingKeyRef.current = newIdempotencyKey();

      if (res.ok && data && data.booking) {
        if (mountedRef.current) setServiceModalVisible(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        // The server prices the booking from the catalogue; show its number, not ours.
        const serverAmount = Number(data.booking.quotedAmount);
        const estimateLine = Number.isFinite(serverAmount) && serverAmount > 0
          ? `Estimate: ₹${serverAmount} (pay on delivery)`
          : Number.isFinite(serverAmount) ? 'Estimate: the partner will quote a price' : `Estimate: ₹${finalAmount} (pay on delivery)`;
        const qtyLine = isLaundry ? `\nQuantity: ${qtyNum} ${qtyUnit === 'kg' ? 'kg (approx.)' : qtyNum === 1 ? 'item' : 'items'}` : '';
        // Same short id as My Orders → Services and the admin dashboard (last 8 characters).
        Alert.alert(
          'Booking confirmed 🎉',
          `Booking #${String(data.booking.id || '').slice(-8).toUpperCase()}\n\n${selectedService.name}${qtyLine}\n${estimateLine}\nPickup: ${pickupSlot}\nAt: ${block}, Room ${room}\n\nThe partner will call you on ${contactPhone} before pickup and confirm the final price.`,
          [
            { text: 'Done', style: 'cancel' },
            { text: 'View booking', onPress: () => router.push({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any) },
          ]
        );
      } else if (res.status === 413) {
        Alert.alert('Attachment too large', 'Please attach a smaller photo, or remove it and share the file with the partner at pickup.');
      } else if (res.status === 401) {
        Alert.alert('Please sign in again', 'Your session has expired.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => router.push('/login' as any) },
        ]);
      } else {
        // The service was paused / removed since this shelf loaded: refresh it so the card shows that.
        if (data && data.code === 'SERVICE_UNAVAILABLE') fetchCategoryItems('silent');
        Alert.alert('Booking not placed',(data && typeof data.message === 'string' && res.status < 500 && data.message) || 'We could not book this service right now. Please try again.');
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmittingBooking(false);
    }
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

      {/* ── PROFESSIONAL SERVICE BOOKING MODAL ── */}
      <Modal
        visible={serviceModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setServiceModalVisible(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ 
            backgroundColor: isDark ? '#1C1C1E' : '#FFF', 
            borderTopLeftRadius: 28, 
            borderTopRightRadius: 28, 
            padding: 20, 
            maxHeight: '88%',
            borderWidth: 1,
            borderColor: border 
          }}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Modal Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={{ fontSize: 8.5, fontWeight: '900', color: '#3B82F6', letterSpacing: 1.5 }}>
                    {meta.title.toUpperCase()} • DOORSTEP SERVICE
                  </Text>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: txt, marginTop: 2 }}>
                    {selectedService?.name}
                  </Text>
                </View>
                <TouchableOpacity 
                  onPress={() => setServiceModalVisible(false)}
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isDark ? '#27272A' : '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: 14, color: txtSec, fontWeight: '900' }}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Price & Turnaround Badge */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <View style={{ backgroundColor: isDark ? '#27272A' : '#F8FAFC', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: border }}>
                  <Text style={{ fontSize: 8, fontWeight: '800', color: txtSec }}>
                    {categoryId === 'print' || isLaundry ? 'ESTIMATE' : 'STARTS AT'}
                  </Text>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: '#10B981', marginTop: 1 }}>
                    ₹{calculatedServicePrice}
                  </Text>
                </View>
                <View style={{ backgroundColor: isDark ? '#27272A' : '#F8FAFC', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: border, flex: 1 }}>
                  <Text style={{ fontSize: 8, fontWeight: '800', color: txtSec }}>HOW IT WORKS</Text>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: txt, marginTop: 2 }}>Partner calls you, confirms the final price, then picks up. Pay on delivery.</Text>
                </View>
              </View>

              {/* ── 1. DOCUMENT & FILE ATTACHMENT SECTION ── */}
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: txt, letterSpacing: 1 }}>
                    {categoryId === 'print' ? '📄 ATTACH PHOTOS OF YOUR PAGES' : '📸 ATTACH REFERENCE PHOTO'}
                  </Text>
                  <Text style={{ fontSize: 8.5, fontWeight: '700', color: '#3B82F6' }}>
                    OPTIONAL
                  </Text>
                </View>

                {attachedFile ? (
                  <View style={{
                    backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : '#ECFDF5',
                    borderWidth: 1,
                    borderColor: isDark ? 'rgba(16,185,129,0.3)' : '#86EFAC',
                    borderRadius: 14,
                    padding: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 22 }}>📄</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 11.5, fontWeight: '800', color: txt }} numberOfLines={1}>
                          {attachedFile.name}
                        </Text>
                        <Text style={{ fontSize: 9, fontWeight: '600', color: '#059669', marginTop: 2 }}>
                          {attachedFile.size ? `${attachedFile.size} • ` : ''}Attached ✅
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={() => setAttachedFile(null)}
                      style={{ backgroundColor: isDark ? '#27272A' : '#FEE2E2', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 }}
                    >
                      <Text style={{ fontSize: 9.5, fontWeight: '900', color: '#EF4444' }}>✕ Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={handlePickDocument}
                    style={{
                      borderWidth: 1.5,
                      borderStyle: 'dashed',
                      borderColor: isDark ? '#3B82F6' : '#60A5FA',
                      backgroundColor: isDark ? 'rgba(59,130,246,0.06)' : '#EFF6FF',
                      borderRadius: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 20 }}>📁</Text>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: '#2563EB', letterSpacing: 0.5 }}>
                      Tap to attach a photo
                    </Text>
                    <Text style={{ fontSize: 8.5, color: txtSec, fontWeight: '600' }}>
                      {categoryId === 'print' ? 'Photos up to 6 MB. Have a PDF? Hand it to the partner at pickup.' : 'Photos up to 6 MB.'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ── 2. PRINTOUT & XEROX SPECIFICATIONS ── */}
              {categoryId === 'print' && (
                <View style={{
                  backgroundColor: isDark ? '#222226' : '#F8FAFC',
                  borderRadius: 16,
                  padding: 12,
                  marginBottom: 14,
                  borderWidth: 1,
                  borderColor: border
                }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: txt, letterSpacing: 1, marginBottom: 10 }}>
                    🖨️ PRINT SPECIFICATIONS & COPIES
                  </Text>

                  {/* Page Count & Copies row */}
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 8.5, fontWeight: '800', color: txtSec, marginBottom: 4 }}>TOTAL PAGES</Text>
                      <TextInput
                        style={{
                          backgroundColor: isDark ? '#18181B' : '#FFF',
                          borderWidth: 1,
                          borderColor: border,
                          borderRadius: 10,
                          paddingHorizontal: 10,
                          paddingVertical: 7,
                          fontSize: 12,
                          fontWeight: '800',
                          color: txt
                        }}
                        keyboardType="numeric"
                        placeholder="e.g. 10"
                        placeholderTextColor={txtSec}
                        value={pageCount}
                        maxLength={4}
                        onChangeText={(v) => setPageCount(v.replace(/[^0-9]/g, ''))}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 8.5, fontWeight: '800', color: txtSec, marginBottom: 4 }}>NUMBER OF SETS/COPIES</Text>
                      <TextInput
                        style={{
                          backgroundColor: isDark ? '#18181B' : '#FFF',
                          borderWidth: 1,
                          borderColor: border,
                          borderRadius: 10,
                          paddingHorizontal: 10,
                          paddingVertical: 7,
                          fontSize: 12,
                          fontWeight: '800',
                          color: txt
                        }}
                        keyboardType="numeric"
                        placeholder="e.g. 1"
                        placeholderTextColor={txtSec}
                        value={copies}
                        maxLength={3}
                        onChangeText={(v) => setCopies(v.replace(/[^0-9]/g, ''))}
                      />
                    </View>
                  </View>

                  {/* Print Color Mode */}
                  <View style={{ marginBottom: 10 }}>
                    <Text style={{ fontSize: 8.5, fontWeight: '800', color: txtSec, marginBottom: 6 }}>COLOR MODE</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={{
                          flex: 1,
                          paddingVertical: 8,
                          borderRadius: 10,
                          backgroundColor: printColor === 'bw' ? (isDark ? 'rgba(59,130,246,0.18)' : '#EFF6FF') : (isDark ? '#18181B' : '#FFF'),
                          borderWidth: 1,
                          borderColor: printColor === 'bw' ? '#3B82F6' : border,
                          alignItems: 'center'
                        }}
                        onPress={() => setPrintColor('bw')}
                      >
                        <Text style={{ fontSize: 10, fontWeight: '900', color: printColor === 'bw' ? (isDark ? '#38BDF8' : '#2563EB') : txtSec }}>
                          Black & White{printRates.bw != null ? ` (₹${printRates.bw}/page)` : ''}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={{
                          flex: 1,
                          paddingVertical: 8,
                          borderRadius: 10,
                          backgroundColor: printColor === 'color' ? (isDark ? 'rgba(59,130,246,0.18)' : '#EFF6FF') : (isDark ? '#18181B' : '#FFF'),
                          borderWidth: 1,
                          borderColor: printColor === 'color' ? '#3B82F6' : border,
                          alignItems: 'center'
                        }}
                        onPress={() => setPrintColor('color')}
                      >
                        <Text style={{ fontSize: 10, fontWeight: '900', color: printColor === 'color' ? (isDark ? '#38BDF8' : '#2563EB') : txtSec }}>
                          🌈 Full Color{printRates.color != null ? ` (₹${printRates.color}/page)` : ''}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Binding Type */}
                  <View>
                    <Text style={{ fontSize: 8.5, fontWeight: '800', color: txtSec, marginBottom: 6 }}>BINDING / FINISHING</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {[
                        { key: 'none', label: 'No Binding', rate: 0 as number | null },
                        { key: 'spiral', label: `Spiral (+₹${printRates.spiral})`, rate: printRates.spiral },
                        { key: 'hardbound', label: `Hardbound (+₹${printRates.hardbound})`, rate: printRates.hardbound }
                      ].filter(b => b.rate != null).map(b => (
                        <TouchableOpacity
                          key={b.key}
                          style={{
                            flex: 1,
                            paddingVertical: 7,
                            borderRadius: 10,
                            backgroundColor: bindingType === b.key ? (isDark ? '#3B82F6' : '#2563EB') : (isDark ? '#18181B' : '#FFF'),
                            borderWidth: 1,
                            borderColor: bindingType === b.key ? '#2563EB' : border,
                            alignItems: 'center'
                          }}
                          onPress={() => setBindingType(b.key as any)}
                        >
                          <Text style={{ fontSize: 8.5, fontWeight: '800', color: bindingType === b.key ? '#FFF' : txtSec }}>
                            {b.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              )}


              {/* ── LAUNDRY QUANTITY (per kg / per piece) ── */}
              {isLaundry && selectedService && (
                <View style={{ backgroundColor: isDark ? '#222226' : '#F8FAFC', borderRadius: 16, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: border }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: txt, letterSpacing: 1, marginBottom: 8 }}>
                    {qtyUnit === 'kg' ? '⚖️ APPROX. WEIGHT (KG)' : '👕 NUMBER OF ITEMS / PAIRS'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => setServiceQty(String(Math.max(1, qtyNum - 1)))}
                      disabled={qtyNum <= 1}
                      style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#18181B' : '#FFF', borderWidth: 1, borderColor: border, opacity: qtyNum <= 1 ? 0.4 : 1 }}
                    >
                      <Text style={{ fontSize: 18, fontWeight: '900', color: txt }}>−</Text>
                    </TouchableOpacity>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: txt, minWidth: 28, textAlign: 'center' }}>{qtyNum}</Text>
                    <TouchableOpacity
                      onPress={() => setServiceQty(String(Math.min(MAX_SERVICE_QTY, qtyNum + 1)))}
                      disabled={qtyNum >= MAX_SERVICE_QTY}
                      style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#18181B' : '#FFF', borderWidth: 1, borderColor: border, opacity: qtyNum >= MAX_SERVICE_QTY ? 0.4 : 1 }}
                    >
                      <Text style={{ fontSize: 18, fontWeight: '900', color: txt }}>+</Text>
                    </TouchableOpacity>
                    <Text style={{ flex: 1, fontSize: 10, fontWeight: '700', color: txtSec }}>
                      ₹{selectedService.price} × {qtyNum}{qtyUnit === 'kg' ? ' kg' : ''}. {qtyUnit === 'kg' ? 'The partner weighs your clothes at pickup and confirms the final price.' : 'The partner confirms the count at pickup.'}
                    </Text>
                  </View>
                </View>
              )}

              {/* Pickup Time Slot */}
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: txt, letterSpacing: 1, marginBottom: 8 }}>
                  PREFERRED PICKUP SLOT
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {pickupSlots.map(slot => (
                    <TouchableOpacity
                      key={slot}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 10,
                        backgroundColor: pickupSlot === slot ? (isDark ? '#3B82F6' : '#2563EB') : (isDark ? '#27272A' : '#F1F5F9'),
                        borderWidth: 1,
                        borderColor: pickupSlot === slot ? '#2563EB' : border
                      }}
                      onPress={() => setPickupSlot(slot)}
                    >
                      <Text style={{ fontSize: 9.5, fontWeight: '800', color: pickupSlot === slot ? '#FFF' : txtSec }}>
                        {slot}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Hostel & Room Location (Doorstep Pickup) */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: txt, letterSpacing: 1, marginBottom: 6 }}>
                  DOORSTEP PICKUP LOCATION
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={{
                      flex: 1,
                      backgroundColor: isDark ? '#27272A' : '#F8FAFC',
                      borderWidth: 1,
                      borderColor: border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      fontSize: 11.5,
                      fontWeight: '700',
                      color: txt
                    }}
                    placeholder="Hostel block (e.g. Ganga)"
                    placeholderTextColor={txtSec}
                    value={hostelBlock}
                    maxLength={60}
                    onChangeText={setHostelBlock}
                  />
                  <TextInput
                    style={{
                      width: 120,
                      backgroundColor: isDark ? '#27272A' : '#F8FAFC',
                      borderWidth: 1,
                      borderColor: border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      fontSize: 11.5,
                      fontWeight: '700',
                      color: txt
                    }}
                    placeholder="Room no. (e.g. 412)"
                    placeholderTextColor={txtSec}
                    value={roomNumber}
                    maxLength={12}
                    onChangeText={setRoomNumber}
                  />
                </View>
                <TextInput
                  style={{
                    marginTop: 8,
                    backgroundColor: isDark ? '#27272A' : '#F8FAFC',
                    borderWidth: 1,
                    borderColor: border,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontSize: 11.5,
                    fontWeight: '700',
                    color: txt
                  }}
                  placeholder="Mobile number for the partner to call"
                  placeholderTextColor={txtSec}
                  keyboardType="phone-pad"
                  value={contactPhone}
                  maxLength={13}
                  onChangeText={(v) => setContactPhone(v.replace(/[^0-9+]/g, ''))}
                />
                <TextInput
                  style={{
                    marginTop: 8,
                    backgroundColor: isDark ? '#27272A' : '#F8FAFC',
                    borderWidth: 1,
                    borderColor: border,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontSize: 11.5,
                    fontWeight: '700',
                    color: txt,
                    minHeight: 44
                  }}
                  placeholder="Anything the partner should know? (optional)"
                  placeholderTextColor={txtSec}
                  value={serviceNotes}
                  maxLength={300}
                  multiline
                  onChangeText={setServiceNotes}
                />
              </View>

              {/* Confirm Booking CTA */}
              <TouchableOpacity
                style={{
                  backgroundColor: '#3B82F6',
                  paddingVertical: 14,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 10,
                  shadowColor: '#3B82F6',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 4
                }}
                onPress={handleConfirmServiceBooking}
                disabled={submittingBooking}
                activeOpacity={0.85}
              >
                {submittingBooking ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={{ color: '#FFF', fontSize: 11.5, fontWeight: '900', letterSpacing: 1 }}>
                    CONFIRM PICKUP • ₹{calculatedServicePrice} ON DELIVERY
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
