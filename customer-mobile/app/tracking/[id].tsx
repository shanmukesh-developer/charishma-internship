import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  Alert,
  Share,
  Linking,
  Image,
  AppState,
} from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import Clipboard from '@react-native-clipboard/clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../../constants/theme';
import { API_URL } from '../../constants/api';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { connectSocket } from '../../utils/socket';
import { apiFetch, readJson } from '../../utils/auth';
import { safeId } from '../../utils/ids';
import { StaggeredSection } from '../../components/AnimatedSection';
import ConfettiCannon from 'react-native-confetti-cannon';
import { useReduceMotion } from '../../utils/reduceMotion';
import LiveOrderCockpit from '../../components/LiveOrderCockpit';
import FssaiLine from '../../components/FssaiLine';
import { isVendorFulfilled, vendorCallNumber, callVendor, stallPayCopy } from '../../utils/localVendor';
import { Ionicons } from '@expo/vector-icons';
import { formatINR } from '../../utils/format';
import { orderPicksText } from '../../components/CustomizeDrawer';
import { useServiceability } from '../../context/CartContext';
import { orderSlotLabel, istClockLabel as formatSlotClock } from '../../utils/deliverySlots';
import { useTopInset } from '../../utils/useTopInset';
import { goHome } from '../../utils/goHome';
import SymbolIcon from '../../components/SymbolIcon';
import { orderCode } from '../../utils/orderCode';
import { useDietLight } from '../../components/local/dietLightTheme';
const TRACK_SCOOTER = require('../../assets/home-redesign-2026-11-09/tracking-delivery-scooter-gemini-2026-11-10.webp');


/**
 * Maps the backend status enum to the screen's step number.
 * 1 placed, 2 confirmed, 3 preparing / rider at store, 4 out for delivery, 5 at gate, 6 delivered, -1 cancelled.
 * Unknown statuses keep the previous step instead of jumping backwards.
 */
const statusToStep = (s: string | undefined | null, prev: number): number => {
  switch (s) {
    case 'Pending': return 1;
    case 'Accepted': return 2;
    case 'Preparing':
    case 'ReadyForPickup':
    case 'Picking': return 3;
    case 'PickedUp':
    case 'OutForDelivery': return 4; // OutForDelivery: a CampusBites stall is bringing it itself
    case 'ArrivedAtGate': return 5;
    case 'Delivered': return 6;
    case 'Cancelled': return -1;
    default: return prev;
  }
};

const isTerminalStep = (step: number) => step === 6 || step === -1;

interface OrderInfo {
  _id: string;
  // Human order ID (ZEN-123); null only for an order the server has not numbered yet.
  orderNumber?: number | null;
  orderCode?: string | null;
  status: string;
  totalPrice: number;
  finalPrice?: number;
  batchDiscount?: number;
  deliveryPin?: string;
  items?: { name: string; quantity: number }[];
  riderOtherOrders?: number;
  createdAt?: string;
  category?: string;
  isPurchasingApprovedByCustomer?: boolean;
  itemPhotoUrl?: string;
  billProofUrl?: string;
  billAmount?: number;
  isBillApproved?: boolean;
  restaurant?: any;
  restaurantName?: string;
  deliveryAddress?: string;
  address?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  estDuration?: number | null;
  /** Delivery slot (server: utils/deliverySlots): label + window; 'ASAP' / null on older orders. */
  deliverySlot?: string | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  /** When the store must have accepted a Pending order (slot orders: from an hour before the slot). */
  storeAcceptBy?: string | null;
  rating?: number | null;
  refundedToWallet?: number;
  cancellationReason?: string | null;
  /** C8: set once the order is delivered (GET /api/orders/:id/receipt opens the printable receipt). */
  receiptNumber?: string | null;
  /** 'VENDOR' = a CampusBites stall delivers it itself (no rider, no PIN, cash to the stall). */
  fulfilment?: string | null;
  deliveryPartner?: {
    id: string;
    _id?: string;
    name: string;
    phone?: string;
    photoUrl?: string;
    averageRating?: number;
    totalRatings?: number;
    vehicleType?: string;
    vehicleNumber?: string;
    bio?: string;
    completedDeliveries?: number;
  };
  dropLat?: number | null;
  dropLng?: number | null;
}

type RiderFix = { lat: number; lng: number; at: number };

/** Straight-line distance in km (haversine). */
const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

export default function TrackingScreen() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  // Reject anything that is not a plain id (deep links / push data could carry '../' paths).
  const orderId = safeId(Array.isArray(params.id) ? params.id[0] : params.id);
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { user, refreshUser } = useAuth();

  const [status, setStatus] = useState<number>(1);
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [loadingOrder, setLoadingOrder] = useState<boolean>(true);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [gateNotification, setGateNotification] = useState<string | null>(null);
  const [zoomPin, setZoomPin] = useState(false);
  // Rider's live GPS position, relayed by the server to this order's room ('riderLocation').
  const [riderFix, setRiderFix] = useState<RiderFix | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  // storeAcceptTimeoutMin: how long the store has before the order is cancelled for free.
  const { serviceability } = useServiceability();
  const [approving, setApproving] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Rating states
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingReview, setRatingReview] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  // A fast double tap lands before the state flips: a ref blocks the second request
  // (it came back ALREADY_RATED and replaced the thank-you with an error).
  const submittingRatingRef = useRef(false);
  const orderActionRef = useRef(false); // same guard for cancel / approve purchase / approve bill

  const mountedRef = useRef(true);
  const statusRef = useRef(1);
  const fetchingRef = useRef(false);
  const lastFetchRef = useRef(0);
  // Last live status event, and a re-fetch asked for while one was already in flight.
  const lastSocketStatusAtRef = useRef(0);
  const refetchQueuedRef = useRef(false);
  // A retry cannot fix "no such order" (bad link / another account): no TRY AGAIN for those.
  const [orderErrorRetryable, setOrderErrorRetryable] = useState(true);
  const [orderNeedsSignIn, setOrderNeedsSignIn] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);

  // C8: signed 15-minute link to the printable receipt (only for this customer's delivered order).
  const openReceipt = useCallback(async () => {
    if (!orderId || receiptLoading) return;
    setReceiptLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/receipt`);
      const data = await readJson(res);
      if (!res.ok || !data || typeof data.url !== 'string' || !data.url) {
        Alert.alert('Receipt', (data && typeof data.message === 'string' && data.message) || 'The receipt is not available right now. Please try again.');
        return;
      }
      if (data.receipt?.receiptNumber) {
        setOrderInfo(prev => (prev && !prev.receiptNumber ? { ...prev, receiptNumber: String(data.receipt.receiptNumber) } : prev));
      }
      await Linking.openURL(data.url);
    } catch {
      Alert.alert('Receipt', "Can't reach ZenWe right now. Check your internet and try again.");
    } finally {
      setReceiptLoading(false);
    }
  }, [orderId, receiptLoading]);
  const ratingPromptedRef = useRef(false);
  const confettiShownRef = useRef(false);
  const reduceMotion = useReduceMotion();
  const gateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (gateTimerRef.current) clearTimeout(gateTimerRef.current);
    };
  }, []);

  const applyStep = (step: number) => {
    statusRef.current = step;
    setStatus(step);
  };

  // Copy the Delivery PIN (stored as deliveryPin)
  const copyPinToClipboard = () => {
    if (!orderInfo?.deliveryPin) return;
    Clipboard.setString(orderInfo.deliveryPin);
    Alert.alert('PIN copied', 'Share it with your rider only when you receive your order.');
  };

  const storeName = orderInfo?.restaurant?.name || orderInfo?.restaurantName || '';
  // CampusBites stall order: the stall accepts and delivers it itself
  const isVendorOrder = isVendorFulfilled(orderInfo);
  const stallLabel = storeName || 'the stall';
  const stallCallable = isVendorOrder && !!vendorCallNumber(orderInfo?.restaurant);
  const callStall = () => { if (orderInfo?.restaurant) callVendor(orderInfo.restaurant); };
  // Slot orders are delivered in their slot: the kitchen's prep minutes are not an arrival time.
  const slotLabel = orderSlotLabel(orderInfo);
  const estMinutes = !slotLabel && orderInfo?.estDuration && orderInfo.estDuration > 0 ? orderInfo.estDuration : null;
  // Pending slot order placed early: the store has until an hour before the slot (+ the usual minutes).
  const acceptByMs = orderInfo?.storeAcceptBy ? new Date(orderInfo.storeAcceptBy).getTime() : NaN;
  const acceptByLater = Number.isFinite(acceptByMs) && acceptByMs - Date.now() > 20 * 60 * 1000;

  // Share the order status (text only: never the delivery PIN, no link to a page that does not exist)
  const handleShareTracking = async () => {
    const stageText = status === 1 ? 'waiting for the store to confirm' : status === 2 ? 'confirmed' : status === 3 ? 'being prepared' : status === 4 ? (isVendorOrder ? `on the way from ${stallLabel}` : 'out for delivery') : status === 5 ? 'at the gate' : 'delivered';
    try {
      await Share.share({
        message: `My ZenWe order${storeName ? ` from ${storeName}` : ''} is ${stageText}.${estMinutes && status >= 2 && status <= 4 ? ` The store estimated about ${estMinutes} min.` : ''}`,
        title: 'ZenWe order status'
      });
    } catch {
      // Share sheet dismissed / unavailable: nothing to do.
    }
  };

  const fetchOrder = useCallback(async (): Promise<void> => {
    if (!orderId) {
      setLoadingOrder(false);
      return;
    }
    if (fetchingRef.current) {
      // A live update arrived mid-fetch: fetch again once this one is done (it may be older).
      refetchQueuedRef.current = true;
      return;
    }
    fetchingRef.current = true;
    const startedAt = Date.now();
    lastFetchRef.current = startedAt;
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}`);
      if (!res.ok) {
        const errData = (await readJson(res)) || {};
        if (!mountedRef.current) return;
        setOrderErrorRetryable(!(res.status === 404 || res.status === 403 || res.status === 401));
        setOrderNeedsSignIn(res.status === 401);
        setOrderError(
          res.status === 401
            ? 'Please sign in again to see this order.'
            : res.status === 404 || res.status === 403
              ? "We couldn't find this order on your account."
              : (res.status < 500 && errData.message) || 'We could not load this order. Please try again.'
        );
        return;
      }
      const data = await res.json();
      if (!mountedRef.current) return;

      if (typeof data.items === 'string') {
        try { data.items = JSON.parse(data.items); } catch { data.items = []; }
      }
      setOrderInfo(data);
      setOrderError(null);
      const fetchedStep = statusToStep(data.status, statusRef.current);
      // A live event newer than this request already moved the order on: don't step back to the older state.
      const stale = fetchedStep !== -1 && fetchedStep < statusRef.current && lastSocketStatusAtRef.current > startedAt;
      if (!stale) applyStep(fetchedStep);

      // Ask for a rating once per visit, and never for an order that is already rated.
      if (data.status === 'Delivered' && data.rating == null && !ratingPromptedRef.current) {
        ratingPromptedRef.current = true;
        setShowRatingModal(true);
      }

      if (data.createdAt) {
        const elapsed = (Date.now() - new Date(data.createdAt).getTime()) / 1000;
        if (data.status === 'Pending' && elapsed < 30 && !confettiShownRef.current) {
          confettiShownRef.current = true;
          setShowConfetti(true);
        }
      }
    } catch (e) {
      if (mountedRef.current) {
        setOrderErrorRetryable(true);
        setOrderError("Can't reach ZenWe right now. Check your internet and try again.");
      }
    } finally {
      fetchingRef.current = false;
      if (mountedRef.current) setLoadingOrder(false);
    }
    if (refetchQueuedRef.current && mountedRef.current) {
      refetchQueuedRef.current = false;
      await fetchOrder();
    }
  }, [orderId]);

  // Signed in from the "Sign in" button on the error screen: load the order at once.
  const signedInId = (user?.id || (user as any)?._id || null) as string | null;
  useEffect(() => {
    if (signedInId && orderNeedsSignIn) { setOrderNeedsSignIn(false); setLoadingOrder(true); fetchOrder(); }
  }, [signedInId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!orderId) {
      setLoadingOrder(false);
      setOrderErrorRetryable(false);
      setOrderError("We couldn't find this order.");
      return;
    }

    const socket = connectSocket();
    const join = () => socket.emit('joinOrder', orderId);
    join();

    const handleConnect = () => {
      setIsConnected(true);
      join();
      fetchOrder();
    };
    const handleDisconnect = () => setIsConnected(false);

    const handleGate = (data: { orderId?: string; message?: string }) => {
      // Another order's room event (several orders tracked in one session) is not for this screen.
      if (data && data.orderId && String(data.orderId) !== String(orderId)) return;
      setGateNotification(data?.message || 'Your rider is waiting at the gate.');
      if (gateTimerRef.current) clearTimeout(gateTimerRef.current);
      gateTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setGateNotification(null);
      }, 20000);
    };

    const handleStatus = (data: { id?: string; orderId?: string; status: string } | string) => {
      let s = '';
      if (typeof data === 'object' && data !== null) {
        const targetId = data.id || data.orderId;
        if (targetId && String(targetId) !== String(orderId)) return;
        s = data.status;
      } else {
        s = data;
      }
      if (!s) return;
      const step = statusToStep(s, statusRef.current);
      lastSocketStatusAtRef.current = Date.now();
      // Events can arrive out of order: only move forward (or to Cancelled). The fetch below
      // reads the server's real status either way.
      if (step === -1 || step >= statusRef.current) applyStep(step);
      if (s === 'Delivered' && !confettiShownRef.current) {
        confettiShownRef.current = true;
        setShowConfetti(true);
      }
      // Store timeout / admin cancel refunds Wallet orders: refresh the balance.
      if (s === 'Cancelled' && typeof data === 'object' && data !== null && Number((data as any).refundedToWallet) > 0) {
        refreshUser().catch(() => {});
      }
      fetchOrder();
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('driverAtGate', handleGate);
    const handleRiderLocation = (data: { orderId?: string; lat?: number; lng?: number; ts?: number }) => {
      if (!data || (data.orderId && String(data.orderId) !== String(orderId))) return;
      const lat = Number(data.lat);
      const lng = Number(data.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      // `at` is when THIS phone received the fix, on its own clock: the age below is measured against Date.now(),
      // so the server's `ts` (another clock) made the dot vanish on any phone running 2+ minutes fast. The server
      // relays a fix as soon as it gets it, so the receive time is the fix time to within the network delay.
      setRiderFix({ lat, lng, at: Date.now() });
    };

    socket.on('statusUpdated', handleStatus);
    socket.on('riderLocation', handleRiderLocation);
    if (socket.connected) setIsConnected(true);

    fetchOrder();

    // Safety-net polling: every 10 s while offline, every 30 s while the socket is live,
    // and never once the order is delivered or cancelled.
    const poll = setInterval(() => {
      if (isTerminalStep(statusRef.current)) return;
      if (AppState.currentState !== 'active') return; // the foreground listener below re-syncs on return
      const since = Date.now() - lastFetchRef.current;
      if (since < (socket.connected ? 30000 : 10000)) return;
      fetchOrder();
    }, 5000);

    // Re-sync when the app returns to the foreground.
    let appState = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (appState.match(/inactive|background/) && nextState === 'active') {
        if (!socket.connected) socket.connect();
        join();
        fetchOrder();
      }
      appState = nextState;
    });

    return () => {
      clearInterval(poll);
      appStateSubscription.remove();
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('driverAtGate', handleGate);
      socket.off('statusUpdated', handleStatus);
      socket.off('riderLocation', handleRiderLocation);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, fetchOrder]);

  // Keep the "updated Xs ago" line fresh while a live rider position is shown.
  useEffect(() => {
    if (!riderFix) return;
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 10000);
    return () => clearInterval(t);
  }, [riderFix]);

  // Owner, 5 Nov 2026 (server customerCancelRule): a store with a partner login can be cancelled until it accepts the
  // order (Pending); a buy-at-store shop (the rider buys at the counter) until a delivery partner takes it. No timed
  // window. The server sends canCancel on the order; a live status change hides the button until the order is read
  // again (fetchOrder runs on every status event), so the app never offers a cancel the server would refuse.
  const liveStatus = orderInfo?.status;
  const hasRider = !!(orderInfo?.deliveryPartner || (orderInfo as any)?.deliveryPartnerId);
  const buyAtStore = (orderInfo as any)?.storePaidByRider === true;
  const localCanCancel = !hasRider && (buyAtStore
    ? ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup'].includes(String(liveStatus))
    : liveStatus === 'Pending');
  const serverCanCancel = typeof (orderInfo as any)?.canCancel === 'boolean' ? (orderInfo as any).canCancel as boolean : localCanCancel;
  const canCancel = !!orderInfo && serverCanCancel && statusToStep(liveStatus, status) === status && status >= 1;

  // Cancel order handler
  const handleCancelOrder = async () => {
    if (cancelling || orderActionRef.current) return;
    if (!orderId) return;
    orderActionRef.current = true;
    setCancelling(true);
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'PUT', body: JSON.stringify({}) });
      const data = (await readJson(res)) || {};
      if (!mountedRef.current) return;
      setShowCancelConfirmation(false);
      if (res.ok) {
        // The server says what happened to the money; without it the screen builds that line itself (a fallback
        // "Order cancelled." repeated the title).
        setCancelMessage(data.message || '');
        setOrderInfo(prev => (prev ? { ...prev, status: 'Cancelled', refundedToWallet: Number(data.refundedToWallet) || 0 } : prev));
        applyStep(-1);
        if (Number(data.refundedToWallet) > 0) refreshUser().catch(() => {});
      } else {
        Alert.alert("Couldn't cancel", data.message || 'This order can no longer be cancelled.');
        fetchOrder();
      }
    } catch {
      if (mountedRef.current) Alert.alert('No connection', 'Please check your internet and try again.');
    } finally {
      orderActionRef.current = false;
      if (mountedRef.current) setCancelling(false);
    }
  };

  const handleApprovePurchase = async () => {
    if (approving || orderActionRef.current) return;
    if (!orderId) return;
    orderActionRef.current = true;
    setApproving(true);
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/approve-purchase`, { method: 'PUT' });
      const data = (await readJson(res)) || {};
      if (!mountedRef.current) return;
      if (res.ok) {
        Alert.alert('Purchase approved', data.message || 'Your rider will go ahead with the shopping.');
        if (data.order) setOrderInfo(prev => (prev ? { ...prev, ...data.order } : prev));
      } else {
        Alert.alert("Couldn't approve", data.message || 'Please try again.');
      }
    } catch {
      if (mountedRef.current) Alert.alert('No connection', 'Please check your internet and try again.');
    } finally {
      orderActionRef.current = false;
      if (mountedRef.current) setApproving(false);
    }
  };

  const handleApproveBill = async () => {
    if (approving || orderActionRef.current) return;
    if (!orderId) return;
    orderActionRef.current = true;
    setApproving(true);
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/approve-bill`, { method: 'PUT' });
      const data = (await readJson(res)) || {};
      if (!mountedRef.current) return;
      if (res.ok) {
        Alert.alert('Bill approved', data.message || 'Thanks! Your rider is on the way.');
        if (data.order) setOrderInfo(prev => (prev ? { ...prev, ...data.order } : prev));
        if (orderInfo?.paymentMethod === 'Wallet') refreshUser().catch(() => {});
      } else {
        Alert.alert("Couldn't approve the bill", data.message || 'Please try again.');
      }
    } catch {
      if (mountedRef.current) Alert.alert('No connection', 'Please check your internet and try again.');
    } finally {
      orderActionRef.current = false;
      if (mountedRef.current) setApproving(false);
    }
  };

  // Stall orders have no rider: no rider tip / rating
  // Tips are cash only: nothing is sent to the server.
  const tipAmount = 0;

  // Submit Rating handler (the server stores the item reviews itself)
  const handleSubmitRating = async () => {
    if (submittingRatingRef.current) return;
    if (!orderId) return;
    submittingRatingRef.current = true;
    setSubmittingRating(true);
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${encodeURIComponent(orderId)}/rate`, {
        method: 'PUT',
        body: JSON.stringify({
          rating: ratingStars,
          review: ratingReview.trim() || undefined,
          tipAmount
        })
      });
      const data = (await readJson(res)) || {};
      if (!mountedRef.current) return;
      if (res.ok) {
        setShowRatingModal(false);
        setOrderInfo(prev => (prev ? { ...prev, rating: data.rating ?? ratingStars } : prev));
        refreshUser().catch(() => {});
        if (data.tipError) {
          Alert.alert('Thanks for rating', `${data.tipError}`);
        } else {
          const points = Number(data.zenPointsEarned) || 0;
          Alert.alert('Thanks for rating', `${data.message || 'Your rating was saved.'}${points ? ` You earned ${points} ZenWe Points.` : ''}`);
        }
      } else if (data.code === 'ALREADY_RATED') {
        setShowRatingModal(false);
        setOrderInfo(prev => (prev ? { ...prev, rating: prev.rating ?? ratingStars } : prev));
        Alert.alert('Already rated', data.message || 'You have already rated this order.');
      } else {
        Alert.alert("Couldn't save your rating", data.message || 'Please try again.');
      }
    } catch (e) {
      console.error(e);
      if (mountedRef.current) Alert.alert('No connection', 'Please check your internet and try again.');
    } finally {
      submittingRatingRef.current = false;
      if (mountedRef.current) setSubmittingRating(false);
    }
  };

  const callRider = () => {
    const phone = orderInfo?.deliveryPartner?.phone;
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Could not start the call', `You can call your rider on ${phone}.`);
    });
  };

  const openHelp = () => {
    router.push({ pathname: '/support', params: { orderId: String(orderId || ''), orderCode: orderInfo?.orderCode || '' } } as any);
  };

  const rider = isVendorOrder ? null : (orderInfo?.deliveryPartner || null);

  // Live distance line: only from a real, recent GPS fix and a real drop pin on the order.
  const dropLat = Number(orderInfo?.dropLat);
  const dropLng = Number(orderInfo?.dropLng);
  const hasDrop = orderInfo?.dropLat != null && orderInfo?.dropLng != null && Number.isFinite(dropLat) && Number.isFinite(dropLng);
  const fixAgeSec = riderFix ? Math.max(0, Math.round((nowTick - riderFix.at) / 1000)) : null;
  const liveFix = riderFix && fixAgeSec !== null && fixAgeSec <= 120 && status >= 3 && status <= 5 ? riderFix : null;
  const riderKm = liveFix && hasDrop ? distanceKm(liveFix.lat, liveFix.lng, dropLat, dropLng) : null;
  const riderDistanceText = riderKm === null
    ? null
    : riderKm < 1 ? `${Math.max(10, Math.round(riderKm * 1000 / 10) * 10)} m away` : `${riderKm.toFixed(1)} km away`;

  const dl = useDietLight();
  const acc = dl.acc;
  const bg = dl.page;
  const cardBg = dl.card;
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = dl.edge;
  // Old dark layout stays in the file but no longer renders (owner, 10 Nov 2026: dark gets the new look).
  const legacy = false as boolean;

  if (loadingOrder && !orderInfo) {
    return (
      <View style={[s.container, { backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <ActivityIndicator size="large" color={COLORS.gold} />
        <Text style={{ fontSize: 13, fontWeight: '700', color: txt, letterSpacing: 0.2, marginTop: 18 }}>
          Loading your order…
        </Text>
        <Text style={{ fontSize: 12, color: txtSec, marginTop: 6, textAlign: 'center' }}>
          Order {orderCode(orderInfo, orderId)}
        </Text>
      </View>
    );
  }

  if (orderError && !orderInfo) {
    return (
      <View style={[s.container, { backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <View style={[s.cancelledCircle, { borderColor: COLORS.goldBorder, backgroundColor: 'rgba(212,175,122,0.1)' }]}>
          <Ionicons name="cloud-offline-outline" size={32} color={COLORS.gold} />
        </View>
        <Text style={[s.cancelledTitle, { color: txt, marginTop: 16 }]}>Couldn't load this order</Text>
        <Text style={[s.cancelledDesc, { color: txtSec, textAlign: 'center', marginTop: 8 }]}>
          {orderError}
        </Text>
        {(orderNeedsSignIn || !user) ? (
          <TouchableOpacity
            style={[s.returnBtn, { backgroundColor: COLORS.gold, marginTop: 24 }]}
            onPress={() => router.push('/login' as any)}
          >
            <Text style={[s.returnBtnText, { color: '#000' }]}>Sign in</Text>
          </TouchableOpacity>
        ) : orderErrorRetryable && !!orderId && (
          <TouchableOpacity
            style={[s.returnBtn, { backgroundColor: COLORS.gold, marginTop: 24 }]}
            onPress={() => { setLoadingOrder(true); fetchOrder(); }}
          >
            <Text style={[s.returnBtnText, { color: '#000' }]}>Try again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => goHome(router, '/(tabs)/orders')}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: txtSec }}>View all orders</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === -1) {
    const charged = Number(orderInfo?.finalPrice ?? orderInfo?.totalPrice ?? 0) || 0;
    // What the server actually refunded wins over the order price.
    const refunded = Number(orderInfo?.refundedToWallet);
    const refundAmount = Number.isFinite(refunded) && refunded > 0 ? refunded : charged;
    const refundLine = cancelMessage
      || (orderInfo?.paymentMethod === 'Wallet'
        ? `${formatINR(refundAmount)} was refunded to your ZenWe Wallet.`
        : 'No payment was taken for this Cash on Delivery order.');
    // Store / system cancels explain why; the customer's own cancel needs no reason line.
    const reasonText = orderInfo?.cancellationReason && !/by customer|by user/i.test(orderInfo.cancellationReason)
      ? orderInfo.cancellationReason
      : null;
    return (
      <View style={[s.container, { backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <View style={s.cancelledCircle}>
          <SymbolIcon name="close" style={{ fontSize: 32, color: COLORS.red }} />
        </View>
        <Text style={[s.cancelledTitle, { color: txt }]}>Order cancelled</Text>
        {!!reasonText && !cancelMessage && (
          <Text style={[s.cancelledDesc, { color: txt, fontWeight: '700', marginBottom: 6 }]}>{reasonText}</Text>
        )}
        <Text style={[s.cancelledDesc, { color: txtSec }]}>
          {refundLine}
        </Text>
        <TouchableOpacity style={s.returnBtn} onPress={() => goHome(router)}>
          <Text style={s.returnBtnText}>Back to Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => goHome(router, '/(tabs)/orders')}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: txtSec }}>View all orders</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 12 }} onPress={openHelp}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: txtSec }}>Need help?</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {showConfetti && !reduceMotion && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <ConfettiCannon count={200} origin={{ x: -10, y: 0 }} fadeOut={true} fallSpeed={2500} explosionSpeed={350} />
        </View>
      )}
      {/* ── HEADER ── */}
      <View style={[s.header, { paddingTop: topPad, backgroundColor: dl.top, borderBottomColor: 'transparent' }, { borderBottomLeftRadius: 22, borderBottomRightRadius: 22 }]}>
        <TouchableOpacity 
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }} 
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={20} color={dl.dk} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: dl.dk }]}>Order tracking</Text>
          {orderId && (
            <Text style={{ fontSize: 12, color: dl.dk, opacity: 0.7, fontWeight: '600', letterSpacing: 0.4 }}>
              {storeName ? `${storeName} · ` : ''}{orderCode(orderInfo, orderId)}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* Polling keeps the order fresh while the socket reconnects, so this is a grey note, not an error. */}
          <View style={[s.statusIndicator, { backgroundColor: isConnected ? dl.card : 'rgba(136,136,136,0.12)' }]}>
            <View style={[s.statusDot, { backgroundColor: isConnected ? acc : txtSec }]} />
            <Text style={[s.statusText, { color: isConnected ? acc : txtSec }]}>
              {isConnected ? 'Live' : 'Reconnecting…'}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* ── RIDER AT GATE BANNER (socket 'driverAtGate') ── */}
        {!!gateNotification && status < 6 && (
          <View style={s.gateBanner}>
            <Ionicons name="notifications" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={s.gateBannerTitle}>{gateNotification}</Text>
              <Text style={s.gateBannerSub}>Keep your Delivery PIN ready.</Text>
            </View>
            {!!rider?.phone && (
              <TouchableOpacity style={s.gateBannerBtn} onPress={callRider}>
                <Text style={s.gateBannerBtnText}>Call</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setGateNotification(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Dismiss">
              <SymbolIcon name="close" style={{ color: '#fff', fontSize: 14, fontWeight: '700' }} />
            </TouchableOpacity>
          </View>
        )}

        {/* v7FoodStatus: the replica's status card (light mode) */}
        {!legacy ? (() => {
          const done = status >= 6 ? 4 : status >= 4 ? 2 : status >= 2 ? 1 : 0;
          const labels = ['Confirmed', 'Preparing', 'On the way', 'Delivered'];
          const big = status === 1 ? 'Waiting for the store' : status === 2 ? 'Confirmed' : status === 3 ? 'Preparing' : status === 4 ? 'Out for delivery' : status === 5 ? 'At your gate' : 'Delivered';
          const eta = status === 5 ? 'Your rider is at the gate' : estMinutes && status >= 2 && status <= 4 ? `About ${estMinutes} min away` : slotLabel && status < 6 ? `Delivery: ${slotLabel}` : null;
          return (
            <StaggeredSection delay={30} direction="up">
              <View style={[s.v7Card, { backgroundColor: cardBg, borderColor: border }]}>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, paddingRight: 6 }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: txtSec }}>Current status</Text>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: txt, marginTop: 2 }}>{big}</Text>
                    {eta ? (
                      <View style={[s.v7Eta, { backgroundColor: dl.soft }]}>
                        <Ionicons name="time-outline" size={13} color={acc} />
                        <Text style={{ fontSize: 12, fontWeight: '800', color: acc }} numberOfLines={1}>{eta}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Image source={TRACK_SCOOTER} style={s.v7Art} resizeMode="contain" />
                </View>
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 16 }}>
                  {labels.map((l, i) => (
                    <View key={l} style={{ flex: 1, height: 4, borderRadius: 3, backgroundColor: dl.track, overflow: 'hidden' }}>
                      {i < done ? <View style={{ flex: 1, backgroundColor: acc }} /> : i === done && status < 6 ? <View style={{ width: '50%', height: '100%', backgroundColor: acc }} /> : null}
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  {labels.map((l, i) => <Text key={l} style={{ fontSize: 10.5, fontWeight: '700', color: i === done && status < 6 ? acc : txtSec }}>{l}</Text>)}
                </View>
                {!!liveFix && (
                  <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec, marginTop: 10 }}>
                    {riderDistanceText ? `${rider?.name || 'Your rider'} is ${riderDistanceText}` : 'Live rider location on'}
                    {fixAgeSec !== null ? (fixAgeSec < 15 ? ' · live' : ` · updated ${fixAgeSec}s ago`) : ''}
                  </Text>
                )}
                {isVendorOrder && status >= 4 && status < 6 ? <Text style={{ fontSize: 12, color: txtSec, marginTop: 8 }}>{`${stallLabel} is bringing it. Keep cash ready.`}</Text> : null}
              </View>
            </StaggeredSection>
          );
        })() : null}

        {/* ── LIVE ORDER COCKPIT (dark mode) ── */}
        {legacy ? <StaggeredSection delay={30} direction="up">
          <LiveOrderCockpit
            status={status}
            isDark={isDark}
            restaurantName={storeName || undefined}
            hostelAddress={orderInfo?.deliveryAddress || orderInfo?.address || undefined}
            orderId={orderInfo?._id || orderId || ''}
            orderCode={orderInfo ? orderCode(orderInfo, orderId) : null}
            riderInfo={rider}
            estMinutes={estMinutes}
            vendor={isVendorOrder ? { name: stallLabel, onCall: stallCallable ? callStall : null } : null}
          />
        </StaggeredSection> : null}

        {/* ── CURRENT STAGE CARD (dark mode) ── */}
        {legacy ? <StaggeredSection delay={50} direction="up">
          <View style={[s.currentStageCard, { backgroundColor: cardBg, borderColor: COLORS.goldBorder }]}>
            <View style={s.stageEmoji}>
              <Ionicons
                name={status === 1 ? 'hourglass-outline' : status === 2 ? 'checkmark-circle-outline' : status === 3 ? 'bag-handle-outline' : status === 4 ? (isVendorOrder ? 'storefront-outline' : 'bicycle-outline') : status === 5 ? 'notifications-outline' : 'checkmark-done-circle-outline'}
                size={26}
                color={COLORS.gold}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.stageLabel, { color: txtSec }]}>Current status</Text>
              <Text style={[s.stageText, { color: txt }]}>
                {isVendorOrder ? (
                  status === 1 ? `Waiting for ${stallLabel} to accept`
                  : status <= 3 ? `${stallLabel} accepted your order`
                  : status <= 5 ? `Out for delivery — ${stallLabel} is bringing it. Keep cash ready.`
                  : `Delivered by ${stallLabel}.`
                ) : <>
                {status === 1 && `Waiting for ${storeName || 'the store'} to accept`}
                {status === 2 && (rider ? `${rider.name || 'Your rider'} will pick up your order` : slotLabel ? 'Order confirmed. A rider is assigned shortly before your slot.' : 'Order confirmed — assigning a rider')}
                {status === 3 && (orderInfo?.status === 'Picking'
                  ? 'Your rider is at the store picking up your order'
                  : orderInfo?.status === 'ReadyForPickup'
                    ? 'Your order is packed and ready for pickup'
                    : 'Your order is being prepared')}
                {status === 4 && 'Your rider is on the way'}
                {status === 5 && 'Your rider has arrived at your gate.'}
                {status >= 6 && 'Order delivered.'}
                </>}
              </Text>
              {!!liveFix && (
                <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec, marginTop: 4 }}>
                  {riderDistanceText ? `${rider?.name || 'Your rider'} is ${riderDistanceText}` : 'Live rider location on'}
                  {fixAgeSec !== null ? (fixAgeSec < 15 ? ' · live' : ` · updated ${fixAgeSec}s ago`) : ''}
                </Text>
              )}
              {!!slotLabel && orderInfo?.status !== 'Cancelled' && (
                <Text style={{ fontSize: 12, fontWeight: '700', color: txt, marginTop: 6 }}>Delivery: {slotLabel}</Text>
              )}
            </View>
            {status === 5 ? (
              <View style={s.etaChip}>
                <Text style={s.etaText}>At gate</Text>
              </View>
            ) : estMinutes && status >= 2 && status <= 4 ? (
              <View style={s.etaChip}>
                <Text style={s.etaText}>~{estMinutes} min</Text>
              </View>
            ) : null}
          </View>
        </StaggeredSection> : null}

        {/* ── RECEIPT (C8): delivered orders only ── */}
        {orderInfo?.status === 'Delivered' && (
          <StaggeredSection delay={80} direction="up">
            <View style={[s.receiptCard, { backgroundColor: cardBg, borderColor: border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.stageLabel, { color: txtSec }]}>Receipt</Text>
                <Text style={{ color: txt, fontSize: 13, fontWeight: '600', marginTop: 2 }}>
                  {orderInfo.receiptNumber ? `No. ${orderInfo.receiptNumber}` : 'Your order receipt'}
                </Text>
                <FssaiLine number={orderInfo.restaurant ? (orderInfo.restaurant.fssaiLicenseNumber ?? null) : undefined} color={txtSec} style={{ marginTop: 2 }} />
              </View>
              <TouchableOpacity
                style={[s.receiptBtn, { backgroundColor: acc }, receiptLoading && { opacity: 0.6 }]}
                onPress={openReceipt}
                disabled={receiptLoading}
                accessibilityRole="button"
                accessibilityLabel="View receipt"
              >
                {receiptLoading ? <ActivityIndicator size="small" color={dl.onAcc} /> : <Text style={[s.receiptBtnText, { color: dl.onAcc }]}>View receipt</Text>}
              </TouchableOpacity>
            </View>
          </StaggeredSection>
        )}

        {/* ── RIDER IS DELIVERING ANOTHER ORDER ON THE WAY ── */}
        {(orderInfo?.riderOtherOrders ?? 0) > 0 && status < 6 && (
          <StaggeredSection delay={110} direction="up">
            <View style={s.ecoBanner}>
              <Ionicons name="git-merge-outline" size={16} color={COLORS.emerald} style={{ marginRight: 6 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.ecoTitle}>Shared route</Text>
                <Text style={s.ecoSubtitle}>Your rider is also delivering another order on the way.</Text>
              </View>
            </View>
          </StaggeredSection>
        )}

        {/* ── MEGA BASKET: approve the shopping and the final bill ── */}
        {orderInfo?.category === 'Mega Basket' && status < 6 && (
          <StaggeredSection delay={80} direction="up">
            <View style={{ backgroundColor: cardBg, borderColor: COLORS.goldBorder, borderWidth: 1, padding: 16, borderRadius: 20, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: 8, borderRadius: 10 }}>
                  <Ionicons name="basket-outline" size={16} color="#F59E0B" />
                </View>
                <View>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#F59E0B', letterSpacing: 0.2 }}>Shopping list</Text>
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: txt }}>Check your shopping</Text>
                </View>
              </View>

              {/* Step 1: approve the items before the rider buys them */}
              <View style={{ borderBottomWidth: 1, borderBottomColor: border, paddingBottom: 14, marginBottom: 14 }}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: txtSec, marginBottom: 4 }}>Step 1: approve the items</Text>
                {!orderInfo.itemPhotoUrl ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                    <ActivityIndicator size="small" color="#F59E0B" />
                    <Text style={{ fontSize: 12, color: txtSec, fontStyle: 'italic' }}>
                      Your rider will share a photo of the items from the store.
                    </Text>
                  </View>
                ) : (
                  <View>
                    <Text style={{ fontSize: 12, color: txt, marginBottom: 8 }}>
                      Your rider shared a photo of the items:
                    </Text>
                    <View style={{ height: 160, borderRadius: 10, overflow: 'hidden', backgroundColor: '#222', marginBottom: 10 }}>
                      <Image source={{ uri: orderInfo.itemPhotoUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    </View>

                    {!orderInfo.isPurchasingApprovedByCustomer ? (
                      <TouchableOpacity
                        style={{ backgroundColor: '#F59E0B', paddingVertical: 10, borderRadius: 10, alignItems: 'center', opacity: approving ? 0.6 : 1 }}
                        onPress={handleApprovePurchase}
                        disabled={approving}
                      >
                        {approving ? (
                          <ActivityIndicator size="small" color="#000" />
                        ) : (
                          <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 12 }}>Looks good, go ahead</Text>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="checkmark-circle" size={14} color={COLORS.emerald} />
                        <Text style={{ fontSize: 12, fontWeight: 'bold', color: COLORS.emerald }}>
                          Approved. Your rider is buying your items.
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Step 2: approve the final bill */}
              {orderInfo.isPurchasingApprovedByCustomer && (
                <View>
                  <Text style={{ fontSize: 12, fontWeight: 'bold', color: txtSec, marginBottom: 4 }}>Step 2: approve the bill</Text>
                  {!orderInfo.billProofUrl ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                      <ActivityIndicator size="small" color="#F59E0B" />
                      <Text style={{ fontSize: 12, color: txtSec, fontStyle: 'italic' }}>
                        Waiting for your rider to upload the store bill…
                      </Text>
                    </View>
                  ) : (
                    <View>
                      <Text style={{ fontSize: 12, color: txt, marginBottom: 4 }}>
                        Store bill uploaded by your rider:
                      </Text>
                      {Number(orderInfo.billAmount) > 0 && (
                        <Text style={{ fontSize: 14, fontWeight: 'bold', color: COLORS.emerald, marginBottom: 8 }}>
                          Bill amount: {formatINR(orderInfo.billAmount)}
                        </Text>
                      )}
                      <View style={{ height: 160, borderRadius: 10, overflow: 'hidden', backgroundColor: '#222', marginBottom: 10 }}>
                        <Image source={{ uri: orderInfo.billProofUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      </View>

                      {!orderInfo.isBillApproved ? (
                        <>
                          <TouchableOpacity
                            style={{ backgroundColor: COLORS.emerald, paddingVertical: 10, borderRadius: 10, alignItems: 'center', opacity: approving ? 0.6 : 1 }}
                            onPress={handleApproveBill}
                            disabled={approving}
                          >
                            {approving ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 12 }}>Approve bill</Text>
                            )}
                          </TouchableOpacity>
                          <Text style={{ fontSize: 12, color: txtSec, marginTop: 6, textAlign: 'center' }}>
                            {orderInfo.paymentMethod === 'Wallet'
                              ? 'The difference is adjusted in your ZenWe Wallet.'
                              : 'You pay the new total in cash at delivery.'}
                          </Text>
                        </>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="checkmark-circle" size={14} color={COLORS.emerald} />
                          <Text style={{ fontSize: 12, fontWeight: 'bold', color: COLORS.emerald }}>
                            Bill approved. Your rider is on the way.
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          </StaggeredSection>
        )}

        {/* ── DELIVERY PIN (stored as deliveryPin) ── */}
        {!!orderInfo?.deliveryPin && !isVendorOrder && status < 6 && (
          <StaggeredSection delay={170} direction="up">
            {!legacy ? (
              <View style={[s.v7Pin, { backgroundColor: dl.soft }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: dl.dk, opacity: 0.85 }}>Delivery PIN</Text>
                  <Text style={{ fontSize: 11.5, color: dl.dk, opacity: 0.8 }}>Share it with your rider at handover only</Text>
                  <TouchableOpacity onPress={() => setZoomPin(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Enlarge Delivery PIN">
                    <Text style={{ fontSize: 12, fontWeight: '800', color: acc, marginTop: 4 }}>Enlarge</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={copyPinToClipboard} accessibilityLabel="Copy Delivery PIN">
                  <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: 6, color: acc }}>{orderInfo.deliveryPin}</Text>
                </TouchableOpacity>
              </View>
            ) : (
            <View style={[s.pinCard, { backgroundColor: cardBg, borderColor: status >= 4 ? COLORS.gold : border }]}>
              <View style={s.pinHeader}>
                <View style={s.pinIconWrap}>
                  <Ionicons name="key-outline" size={18} color={COLORS.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.pinLabel, { color: txtSec }]}>Delivery PIN</Text>
                  <Text style={[s.pinDesc, { color: txt }]}>Share this PIN with your rider only at handover</Text>
                </View>
              </View>
              <View style={s.pinDisplayRow}>
                <TouchableOpacity style={s.pinButton} onPress={copyPinToClipboard} accessibilityLabel="Copy Delivery PIN">
                  <Text style={s.pinText}>{orderInfo.deliveryPin}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.zoomBtn} onPress={() => setZoomPin(true)} accessibilityRole="button" accessibilityLabel="Enlarge Delivery PIN">
                  <Text style={{ fontSize: 12, fontWeight: '600', color: txt }}>Enlarge</Text>
                </TouchableOpacity>
              </View>
            </View>
            )}
          </StaggeredSection>
        )}

        {/* ── QUICK ACTION BUTTONS ── */}
        <StaggeredSection delay={230} direction="up">
          <View style={s.actionRow}>
            {isVendorOrder ? (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: cardBg, borderColor: border }, s.v7Tile, !stallCallable && { opacity: 0.5 }]}
                disabled={!stallCallable}
                onPress={callStall}
                accessibilityLabel={`Call ${stallLabel}`}
              >
                <Ionicons name="call-outline" size={20} color={acc} />
                <Text style={[s.actionBtnText, { color: txt }]}>Call stall</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: cardBg, borderColor: border }, s.v7Tile, !(rider?.phone && status < 6) && { opacity: 0.5 }]}
                disabled={!(rider?.phone && status < 6)}
                onPress={callRider}
                accessibilityLabel="Call your rider"
              >
                <Ionicons name="call-outline" size={20} color={acc} />
                <Text style={[s.actionBtnText, { color: txt }]}>{rider ? 'Call rider' : 'No rider yet'}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[s.actionBtn, { backgroundColor: cardBg, borderColor: border }, s.v7Tile]} onPress={openHelp} accessibilityRole="button" accessibilityLabel="Help">
              <Ionicons name="help-buoy-outline" size={20} color={acc} />
              <Text style={[s.actionBtnText, { color: txt }]}>Help</Text>
            </TouchableOpacity>

            {status < 6 && (
              <TouchableOpacity style={[s.actionBtn, { backgroundColor: cardBg, borderColor: border }, s.v7Tile]} onPress={handleShareTracking} accessibilityRole="button" accessibilityLabel="Share tracking">
                <Ionicons name="share-social-outline" size={20} color={acc} />
                <Text style={[s.actionBtnText, { color: txt }]}>Share</Text>
              </TouchableOpacity>
            )}
          </View>
        </StaggeredSection>

        {/* ── WAITING FOR THE STORE (Pending): say what happens if it never answers ── */}
        {status === 1 && (
          <View style={[s.waitStoreBox, { backgroundColor: cardBg, borderColor: border }]} accessibilityRole="summary">
            <ActivityIndicator size="small" color={acc} />
            <View style={{ flex: 1 }}>
              <Text style={[s.waitStoreTitle, { color: txt }]}>Waiting for the store to accept</Text>
              <Text style={[s.waitStoreSub, { color: txtSec }]}>
                {acceptByLater
                  ? `The store confirms your order before your slot. If it doesn't accept by ${formatSlotClock(acceptByMs)}, we cancel the order for you. Nothing is charged. You can also cancel now for free.`
                  : `If the store doesn't accept within ${Number(serviceability?.storeAcceptTimeoutMin) > 0 ? Number(serviceability?.storeAcceptTimeoutMin) : 7} minutes, we cancel the order for you. Nothing is charged. You can also cancel now for free.`}
              </Text>
            </View>
          </View>
        )}

        {/* ── CANCEL (until the store accepts; buy-at-store shops: until a rider takes it) ── */}
        {canCancel && (
          <StaggeredSection delay={260} direction="up">
            <TouchableOpacity style={s.cancelBox} onPress={() => setShowCancelConfirmation(true)} disabled={cancelling} accessibilityRole="button">
              <Text style={s.cancelBoxText}>
                {status === 1 ? 'Cancel for free' : 'Cancel order'}
              </Text>
            </TouchableOpacity>
          </StaggeredSection>
        )}

        {/* ── RATE (delivered, not rated yet) ── */}
        {status >= 6 && orderInfo?.rating == null && (
          <StaggeredSection delay={260} direction="up">
            <TouchableOpacity style={[s.rateCta, { backgroundColor: cardBg }]} onPress={() => setShowRatingModal(true)}>
              {null}
              <View style={{ flex: 1 }}>
                <Text style={[s.rateCtaTitle, { color: txt }]}>How was your order?</Text>
                <Text style={[s.rateCtaSub, { color: txtSec }]}>Rate it and earn 10 points</Text>
              </View>
              {legacy ? <Ionicons name="chevron-forward" size={16} color={COLORS.gold} /> : (
                <View style={{ flexDirection: 'row', gap: 4 }}>{[0, 1, 2, 3, 4].map((i) => <Ionicons key={i} name="star" size={20} color={isDark ? 'rgba(255,255,255,0.2)' : '#E5E7EB'} />)}</View>
              )}
            </TouchableOpacity>
          </StaggeredSection>
        )}
        {status >= 6 && orderInfo?.rating != null && (
          <StaggeredSection delay={260} direction="up">
            <View style={[s.rateCta, { backgroundColor: cardBg }]}>
              {legacy ? <Ionicons name="heart-outline" size={20} color={COLORS.gold} /> : (
                <View style={{ flexDirection: 'row', gap: 2 }}>{[1, 2, 3, 4, 5].map((i) => <Ionicons key={i} name="star" size={16} color={i <= Number(orderInfo.rating) ? '#F5B301' : '#E5E7EB'} />)}</View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[s.rateCtaTitle, { color: txt }]}>You rated this order {orderInfo.rating}★</Text>
                <Text style={[s.rateCtaSub, { color: txtSec }]}>Thanks for your feedback.</Text>
              </View>
            </View>
          </StaggeredSection>
        )}

        {/* ── ORDER SUMMARY (real order data) ── */}
        {!!orderInfo && (
          <StaggeredSection delay={300} direction="up">
            <View style={[s.timelineCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec, letterSpacing: 0.2, marginBottom: 12 }}>
                Order summary{storeName ? ` · ${storeName}` : ''}
              </Text>
              {(Array.isArray(orderInfo.items) ? orderInfo.items : []).map((it, idx) => {
                // The customer's own weight / flavour / portion under the line (1 kg vs 250 g is not the same order).
                const picks = orderPicksText((it as any)?.customizations);
                return (
                  <View key={idx} style={s.summaryRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.summaryItem, { color: txt }]} numberOfLines={2}>
                        {it?.quantity || 1} × {it?.name || 'Item'}
                      </Text>
                      {picks ? <Text style={{ fontSize: 11.5, color: txtSec, marginTop: 1 }} numberOfLines={2}>{picks}</Text> : null}
                    </View>
                  </View>
                );
              })}
              <View style={[s.summaryDivider, { backgroundColor: border }]} />
              <View style={s.summaryRow}>
                <Text style={[s.summaryTotalLabel, { color: txt }]}>
                  {orderInfo.paymentMethod === 'Wallet' && !isVendorOrder
                    ? 'Paid from ZenWe Wallet'
                    : status >= 6
                      ? (isVendorOrder ? `Paid to ${stallLabel} in cash` : 'Paid in cash')
                      : isVendorOrder ? stallPayCopy(stallLabel) : 'To pay (Cash on Delivery)'}
                </Text>
                <Text style={[s.summaryTotal, { color: txt }]}>
                  {formatINR(Number(orderInfo.finalPrice ?? orderInfo.totalPrice ?? 0) || 0)}
                </Text>
              </View>
              {!!slotLabel && (
                <Text style={[s.summaryAddress, { color: txt }]} numberOfLines={1}>Delivery: {slotLabel}</Text>
              )}
              {!!(orderInfo.deliveryAddress || orderInfo.address) && (
                <Text style={[s.summaryAddress, { color: txtSec }]} numberOfLines={2}>
                  {orderInfo.deliveryAddress || orderInfo.address}
                </Text>
              )}
            </View>
          </StaggeredSection>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── ENLARGED DELIVERY PIN ── */}
      <Modal visible={zoomPin} transparent animationType="fade" onRequestClose={() => setZoomPin(false)}>
        <View style={[s.modalOverlay, { justifyContent: 'center' }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setZoomPin(false)} />
          <View style={[s.zoomPinBox, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={s.zoomTitle}>Delivery PIN</Text>
            <Text style={[s.zoomDesc, { color: txtSec }]}>Show this PIN to your rider at handover</Text>
            <View style={s.zoomPinDisplay}>
              <Text style={s.zoomPinText}>{orderInfo?.deliveryPin}</Text>
            </View>
            <TouchableOpacity style={s.zoomCloseBtn} onPress={() => setZoomPin(false)}>
              <Text style={s.zoomCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── CANCEL CONFIRMATION MODAL ── */}
      <Modal
        visible={showCancelConfirmation}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!cancelling) setShowCancelConfirmation(false); }}
      >
        <View style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => { if (!cancelling) setShowCancelConfirmation(false); }} />
          <View style={[s.cancelModalBox, { backgroundColor: cardBg }]}>
            <Text style={[s.cancelModalTitle, { color: txt }]}>Cancel this order?</Text>
            <Text style={[s.cancelModalDesc, { color: txtSec }]}>
              {orderInfo?.paymentMethod === 'Wallet'
                ? `${formatINR(Number(orderInfo?.finalPrice ?? orderInfo?.totalPrice ?? 0) || 0)} will go straight back to your ZenWe Wallet.`
                : 'No payment has been taken for this Cash on Delivery order.'}
            </Text>
            <TouchableOpacity
              style={[s.confirmCancelBtn, cancelling && { opacity: 0.6 }]}
              onPress={handleCancelOrder}
              disabled={cancelling}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.confirmCancelBtnText}>Yes, cancel order</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={s.dismissCancelBtn} onPress={() => setShowCancelConfirmation(false)} disabled={cancelling}>
              <Text style={[s.dismissCancelBtnText, { color: txtSec }]}>Keep my order</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── RATING MODAL ── */}
      <Modal visible={showRatingModal} transparent animationType="slide" onRequestClose={() => setShowRatingModal(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={s.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowRatingModal(false)} />
            <View style={[s.ratingModalBox, { backgroundColor: cardBg }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 4 }}>
                <Text style={[s.ratingModalTitle, { color: txt, marginBottom: 0 }]}>Rate your order</Text>
                <TouchableOpacity onPress={() => setShowRatingModal(false)} style={{ padding: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Close">
                  <SymbolIcon name="close" style={{ fontSize: 18, color: txtSec, fontWeight: '600' }} />
                </TouchableOpacity>
              </View>
              <Text style={[s.ratingModalDesc, { color: txtSec }]}>
                {isVendorOrder ? `How was your order from ${stallLabel}? (rates the stall's food and delivery)` : storeName ? `How was your order from ${storeName}?` : 'How was your order?'}
              </Text>

              {/* Stars Row */}
              <View style={s.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity key={star} onPress={() => setRatingStars(star)} accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}>
                    <Text style={{ fontSize: 32, color: star <= ratingStars ? COLORS.gold : '#aaa', marginHorizontal: 4 }}>
                      ★
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Review Input */}
              <TextInput
                style={[s.ratingInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', color: txt }]}
                placeholder="Tell us more (optional)"
                placeholderTextColor={txtSec}
                multiline
                maxLength={300}
                value={ratingReview}
                onChangeText={setRatingReview}
              />

              {/* Tips are cash only (owner, 20 Oct 2026): the wallet is never used for tips. Never on stall orders. */}
              {!!rider && !isVendorOrder && (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, width: '100%', marginTop: 12 }}>
                  <Ionicons name="cash-outline" size={16} color={txtSec} style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: txtSec }}>
                    {`If you'd like to tip ${rider.name ? rider.name.split(' ')[0] : 'your rider'}, please give it in cash. The full tip goes to them.`}
                  </Text>
                </View>
              )}

              {/* Submit rating */}
              <TouchableOpacity style={[s.submitRatingBtn, submittingRating && { opacity: 0.7 }]} onPress={handleSubmitRating} disabled={submittingRating}>
                {submittingRating ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={s.submitRatingText}>Submit rating</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={{ marginTop: 10, paddingVertical: 8, alignItems: 'center', width: '100%' }}
                onPress={() => setShowRatingModal(false)}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: txtSec }}>Maybe later</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  v7Card: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 12, overflow: 'hidden' },
  v7Eta: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, marginTop: 8 },
  v7Art: { width: 104, height: 96, marginRight: -6, marginTop: -4 },
  v7Pin: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18 },
  v7Tile: { flexDirection: 'column', gap: 5, paddingVertical: 12, borderRadius: 16 },
  receiptCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  receiptBtn: { backgroundColor: COLORS.gold, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, minWidth: 110, alignItems: 'center' },
  receiptBtnText: { color: '#000', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  container: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },

  // Rider-at-gate banner
  gateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.emerald,
    padding: 14,
    borderRadius: 18,
    marginBottom: 16,
    ...SHADOWS.card
  },
  gateBannerTitle: { fontSize: 13, fontWeight: '700', color: '#fff' },
  gateBannerSub: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  gateBannerBtn: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  gateBannerBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.emerald },

  // Rate CTA
  rateCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.goldBorder,
    marginBottom: 16
  },
  rateCtaTitle: { fontSize: 13, fontWeight: '600' },
  rateCtaSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  tipChip: {
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },

  // Order summary
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  summaryItem: { flex: 1, fontSize: 12, fontWeight: '600' },
  summaryDivider: { height: 1, marginVertical: 10 },
  summaryTotalLabel: { fontSize: 12, fontWeight: '600' },
  summaryTotal: { fontSize: 15, fontWeight: '700' },
  summaryAddress: { fontSize: 12, fontWeight: '600', marginTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 40 : 50,
    paddingBottom: 16,
    borderBottomWidth: 1
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
  headerTitle: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  scroll: { padding: 16 },

  // Stage card
  currentStageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    borderWidth: 1.5,
    marginBottom: 16
  },
  stageEmoji: { marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  stageLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, marginBottom: 2 },
  stageText: { fontSize: 13, fontWeight: '700' },
  etaChip: {
    backgroundColor: COLORS.goldMuted,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.goldBorder
  },
  etaText: { fontSize: 12, fontWeight: '700', color: COLORS.gold },

  // Eco banner
  ecoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.15)',
    padding: 14,
    borderRadius: 20,
    marginBottom: 16
  },
  ecoTitle: { fontSize: 12, fontWeight: '700', color: COLORS.emerald, letterSpacing: 0.2 },
  ecoSubtitle: { fontSize: 12, color: '#888', fontWeight: '500', marginTop: 2 },

  // PIN card
  pinCard: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16
  },
  pinHeader: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  pinIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  pinLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  pinDesc: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  pinDisplayRow: { flexDirection: 'row', gap: 8 },
  pinButton: {
    flex: 1,
    backgroundColor: COLORS.gold,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    ...SHADOWS.goldGlow
  },
  pinText: { fontSize: 18, fontWeight: '700', color: '#000', letterSpacing: 6 },
  zoomBtn: {
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderDark
  },

  // Rider card
  riderCard: {
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16
  },
  riderRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  riderAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderDark
  },
  riderName: { fontSize: 13, fontWeight: '600' },
  verifiedBadge: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  verifiedText: { fontSize: 12, fontWeight: '700', color: COLORS.emerald },
  riderVehicle: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 2,
    marginTop: 16,
    overflow: 'hidden'
  },
  progressBar: { height: '100%', backgroundColor: COLORS.gold },

  // Action Buttons row
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    ...SHADOWS.card
  },
  actionBtnText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },

  // Timeline
  timelineCard: {
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16
  },
  timelineStepRow: { flexDirection: 'row', gap: 12, position: 'relative' },
  timelineLine: {
    position: 'absolute',
    left: 13,
    top: 26,
    bottom: 0,
    width: 1.5,
    zIndex: 1
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5
  },
  timelineContent: { flex: 1, paddingBottom: 24 },
  timelineTitle: { fontSize: 12, fontWeight: '600' },
  timelineDesc: { fontSize: 12, marginTop: 2, color: '#888' },

  // Cancel countdown
  waitStoreBox: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  waitStoreTitle: { fontSize: 14, fontWeight: '600' },
  waitStoreSub: { fontSize: 12, fontWeight: '500', marginTop: 3, lineHeight: 17 },
  cancelBox: {
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239,79,95,0.2)',
    backgroundColor: 'rgba(239,79,95,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16
  },
  cancelBoxText: { fontSize: 13, fontWeight: '700', color: COLORS.red, letterSpacing: 0.2 },

  // Cancel circle / screen
  cancelledCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239,79,95,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16
  },
  cancelledTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  cancelledDesc: { fontSize: 12, textAlign: 'center', lineHeight: 16, marginBottom: 24, maxWidth: 260 },
  returnBtn: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  returnBtnText: { fontSize: 13, fontWeight: '700', color: '#000', letterSpacing: 0.2 },

  // Modals overlays
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  
  // zoom PIN modal
  zoomPinBox: {
    width: '90%',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 40
  },
  zoomTitle: { fontSize: 15, fontWeight: '700', color: COLORS.gold, letterSpacing: 0.2, marginBottom: 4 },
  zoomDesc: { fontSize: 12, fontWeight: '700', marginBottom: 20 },
  zoomPinDisplay: {
    width: '100%',
    backgroundColor: COLORS.gold,
    paddingVertical: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...SHADOWS.goldGlow
  },
  zoomPinText: { fontSize: 48, fontWeight: '700', color: '#000', letterSpacing: 10 },
  zoomCloseBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center'
  },
  zoomCloseText: { fontSize: 12, fontWeight: '600', color: '#888' },

  // Cancel Modal Box
  cancelModalBox: {
    width: '90%',
    padding: 24,
    borderRadius: 24,
    marginBottom: 40,
    alignItems: 'center'
  },
  cancelModalTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  cancelModalDesc: { fontSize: 12, textAlign: 'center', lineHeight: 16, color: '#888', marginBottom: 24 },
  confirmCancelBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.red,
    alignItems: 'center',
    marginBottom: 8
  },
  confirmCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  dismissCancelBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center'
  },
  dismissCancelBtnText: { fontSize: 12, fontWeight: '600' },

  // Chat Drawer container
  chatContainer: {
    width: '100%',
    height: '80%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden'
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1
  },
  chatAvatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(16,185,129,0.1)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  chatRiderName: { fontSize: 12, fontWeight: '600' },
  chatCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  messageRow: { flexDirection: 'row', marginBottom: 12 },
  messageBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    maxWidth: '85%'
  },
  messageText: { fontSize: 12, fontWeight: '500' },
  chatFooter: { padding: 16, borderTopWidth: 1 },
  quickReplyChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginRight: 6
  },
  quickReplyText: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: '#aaa' },
  chatInputRow: { flexDirection: 'row', gap: 8 },
  chatInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    fontSize: 12
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.emerald,
    alignItems: 'center',
    justifyContent: 'center'
  },

  // Rating Modal Box
  ratingModalBox: {
    width: '90%',
    padding: 24,
    borderRadius: 24,
    marginBottom: 40,
    alignItems: 'center'
  },
  ratingModalTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  ratingModalDesc: { fontSize: 12, color: '#888', marginBottom: 20 },
  starsRow: { flexDirection: 'row', marginBottom: 20 },
  ratingInput: {
    width: '100%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    height: 48
  },
  submitRatingBtn: {
    width: '100%',
    backgroundColor: COLORS.gold,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 20,
    ...SHADOWS.goldGlow
  },
  submitRatingText: { fontSize: 13, fontWeight: '700', color: '#000', letterSpacing: 0.2 },

  // Driver Profile Modal Styles
  driverModalBox: {
    width: '92%',
    maxWidth: 440,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    position: 'relative',
    ...SHADOWS.card
  },
  modalDragHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(128,128,128,0.3)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8
  },
  driverModalCloseBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(128,128,128,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10
  },
  driverModalAvatarRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2.5,
    borderColor: COLORS.gold,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  driverModalAvatarImg: {
    width: 68,
    height: 68,
    borderRadius: 34
  },
  driverVerifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#16A34A',
    borderWidth: 2,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center'
  },
  driverModalName: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5
  },
  driverRatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(212,175,55,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12
  },
  driverTagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12
  },
  driverInfoGrid: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    marginVertical: 4
  },
  driverInfoItem: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center'
  },
  driverInfoLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4
  },
  driverInfoValue: {
    fontSize: 12,
    fontWeight: '700'
  },
  driverActionCallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14
  },
  driverActionChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5
  }
});
