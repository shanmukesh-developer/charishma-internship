import React, { useState, useEffect, useRef } from 'react';
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
  Animated,
  Image
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../../constants/theme';
import { API_URL } from '../../constants/api';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { connectSocket, getSocket } from '../../utils/socket';
import { apiFetch } from '../../utils/auth';
import { StaggeredSection, FloatingPulse, BounceIn } from '../../components/AnimatedSection';
import ConfettiCannon from 'react-native-confetti-cannon';
import Svg, { Polyline, Circle } from 'react-native-svg';

const CHECKPOINTS = [
  { name: 'Mangalagiri Jn' },
  { name: 'Neerukonda' },
  { name: 'SRM Main Gate' },
  { name: 'Academic Block' },
  { name: 'Hostel Sector' },
];

const ROUTE_NODES = [
  { id: 'Restaurant', name: 'Kitchen', x: 25, y: 155, icon: '🍳' },
  { id: 'Mangalagiri Jn', name: 'Mangalagiri', x: 80, y: 120, icon: '📍' },
  { id: 'Neerukonda', name: 'Neerukonda', x: 130, y: 140, icon: '📍' },
  { id: 'SRM Main Gate', name: 'Main Gate', x: 190, y: 80, icon: '🛡️' },
  { id: 'Academic Block', name: 'Academic', x: 250, y: 100, icon: '🏫' },
  { id: 'Hostel Sector', name: 'Hostel', x: 310, y: 40, icon: '🏠' }
];

function TacticalRadarMap({ status, currentCheckpoint, isDark }: { status: number, currentCheckpoint: string, isDark: boolean }) {
  const riderPos = useRef(new Animated.ValueXY({ x: 25, y: 155 })).current;

  let riderIdx = 0;
  if (status === 4) {
    const idx = ROUTE_NODES.findIndex(n => n.id === currentCheckpoint);
    riderIdx = idx !== -1 ? idx : 1;
  } else if (status >= 5) {
    riderIdx = ROUTE_NODES.length - 1;
  }

  useEffect(() => {
    const targetNode = ROUTE_NODES[riderIdx];
    Animated.spring(riderPos, {
      toValue: { x: targetNode.x, y: targetNode.y },
      useNativeDriver: false,
      friction: 8,
      tension: 40
    }).start();
  }, [riderIdx]);

  const polylinePoints = ROUTE_NODES.map(n => `${n.x},${n.y}`).join(' ');
  const traveledPoints = ROUTE_NODES.slice(0, riderIdx + 1).map(n => `${n.x},${n.y}`).join(' ');

  const cardBg = isDark ? '#141416' : '#FFF';
  const border = isDark ? 'rgba(212, 175, 122, 0.25)' : 'rgba(0, 0, 0, 0.06)';
  const txt = isDark ? '#FFF' : '#111';
  const txtSec = isDark ? '#AAA' : '#666';

  return (
    <View style={[mapStyles.card, { backgroundColor: cardBg, borderColor: border }]}>
      <View style={mapStyles.headerRow}>
        <View>
          <Text style={mapStyles.badge}>GPS RADAR ARRAY</Text>
          <Text style={[mapStyles.title, { color: txt }]}>LIVE PATH TELEMETRY</Text>
        </View>
        <FloatingPulse color="#C9A84C">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#C9A84C' }} />
        </FloatingPulse>
      </View>

      <View style={mapStyles.canvasContainer}>
        <View style={mapStyles.gridOverlay}>
          {[...Array(6)].map((_, i) => (
            <View key={i} style={[mapStyles.gridLineH, { top: i * 35, borderBottomColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]} />
          ))}
          {[...Array(10)].map((_, i) => (
            <View key={i} style={[mapStyles.gridLineV, { left: i * 35, borderRightColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]} />
          ))}
        </View>

        <Svg style={StyleSheet.absoluteFill}>
          <Polyline
            points={polylinePoints}
            fill="none"
            stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}
            strokeWidth={4}
            strokeDasharray="5,5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {traveledPoints.length > 0 && (
            <Polyline
              points={polylinePoints}
              fill="none"
              stroke="#D4AF37"
              strokeWidth={4}
              strokeDasharray="5,5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.3}
            />
          )}

          {traveledPoints && (
            <Polyline
              points={traveledPoints}
              fill="none"
              stroke="#D4AF37"
              strokeWidth={4.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {ROUTE_NODES.map((n, i) => {
            const isCompleted = i < riderIdx;
            const isActive = i === riderIdx;
            return (
              <Circle
                key={n.id}
                cx={n.x}
                cy={n.y}
                r={isActive ? 8 : 5}
                fill={isActive ? '#D4AF37' : (isCompleted ? '#D4AF37' : (isDark ? '#333' : '#CCC'))}
                stroke={isActive ? (isDark ? '#000' : '#FFF') : 'transparent'}
                strokeWidth={2}
              />
            );
          })}
        </Svg>

        {ROUTE_NODES.map((n, i) => {
          const isActive = i === riderIdx;
          const isCompleted = i <= riderIdx;
          return (
            <View key={n.id} style={[mapStyles.nodeLabelContainer, { left: n.x - 30, top: n.y - 30 }]}>
              <View style={[mapStyles.nodeLabelBox, { backgroundColor: isActive ? '#D4AF37' : (isDark ? 'rgba(20,20,22,0.85)' : 'rgba(255,255,255,0.85)') }]}>
                <Text style={[mapStyles.nodeLabelText, { color: isActive ? '#000' : (isCompleted ? '#D4AF37' : txtSec) }]}>
                  {n.icon} {n.name}
                </Text>
              </View>
            </View>
          );
        })}

        <Animated.View
          style={[
            mapStyles.riderIconContainer,
            {
              left: Animated.subtract(riderPos.x, 18),
              top: Animated.subtract(riderPos.y, 22),
            }
          ]}
        >
          <View style={mapStyles.riderPulseRing} />
          <View style={mapStyles.riderAvatar}>
            <Text style={{ fontSize: 13 }}>🛵</Text>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const mapStyles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  badge: {
    fontSize: 7,
    fontWeight: '900',
    color: '#D4AF37',
    letterSpacing: 2
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 2
  },
  canvasContainer: {
    height: 195,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
    position: 'relative'
  },
  gridOverlay: {
    ...StyleSheet.absoluteFill
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: 1
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRightWidth: 1
  },
  nodeLabelContainer: {
    position: 'absolute',
    width: 60,
    alignItems: 'center'
  },
  nodeLabelBox: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center'
  },
  nodeLabelText: {
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.2
  },
  riderIconContainer: {
    position: 'absolute',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center'
  },
  riderPulseRing: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D4AF37',
    opacity: 0.6,
    transform: [{ scale: 1.4 }]
  },
  riderAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#D4AF37',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84
  }
});

interface OrderInfo {
  _id: string;
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
  };
}

interface Message {
  sender: string;
  senderRole: 'rider' | 'customer';
  message: string;
  timestamp: string | Date;
}

export default function TrackingScreen() {
  const { id: orderId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const { user } = useAuth();

  const [status, setStatus] = useState<number>(1);
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [currentCheckpoint, setCurrentCheckpoint] = useState('Mangalagiri Jn');
  const [eta, setEta] = useState('Calculating...');
  const [isConnected, setIsConnected] = useState(false);
  const [showDeliveryOverlay, setShowDeliveryOverlay] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [gateNotification, setGateNotification] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [cancelSecondsLeft, setCancelSecondsLeft] = useState(0);
  const [zoomPin, setZoomPin] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Chat states
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [remoteTyping, setRemoteTyping] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rating states
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingReview, setRatingReview] = useState('');
  const [ratingTip, setRatingTip] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);

  const userName = user?.name || 'Customer';

  // Copy PIN helper
  const copyPinToClipboard = () => {
    if (!orderInfo?.deliveryPin) return;
    Share.share({
      message: `My Zenvy Gate Verification PIN: ${orderInfo.deliveryPin}`,
    });
  };

  useEffect(() => {
    if (!orderId) return;

    const socket = connectSocket();

    // Join order room
    socket.emit('joinOrder', orderId);

    const handleConnect = () => {
      setIsConnected(true);
      socket.emit('joinOrder', orderId);
    };

    const handleDisconnect = () => setIsConnected(false);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    if (socket.connected) setIsConnected(true);

    socket.on('driverAtGate', (data: { message: string }) => {
      setGateNotification(data.message);
      setTimeout(() => setGateNotification(null), 10000);
    });

    const fetchOrder = async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/orders/${orderId}`);
        if (!res.ok) return;
        const data = await res.json();
        
        if (typeof data.items === 'string') {
          try { data.items = JSON.parse(data.items); } catch { data.items = []; }
        }
        setOrderInfo(data);
        
        if (data.status === 'Pending') setStatus(1);
        else if (data.status === 'Accepted') setStatus(2);
        else if (data.status === 'Preparing' || data.status === 'ReadyForPickup') setStatus(3);
        else if (data.status === 'PickedUp') setStatus(4);
        else if (data.status === 'Delivered') { 
          setStatus(5); 
          if (!data.rating) setShowRatingModal(true); 
        }
        else if (data.status === 'Cancelled') setStatus(-1);

        if (data.status === 'Pending' && data.createdAt) {
          const elapsed = (Date.now() - new Date(data.createdAt).getTime()) / 1000;
          setCancelSecondsLeft(Math.max(0, 120 - Math.round(elapsed)));
          if (elapsed < 30) setShowConfetti(true);
        }
      } catch (e) {
        console.error('Fetch order error:', e);
      }
    };

    socket.on('statusUpdated', (data: { id?: string; orderId?: string; status: string } | string) => {
      let s = '';
      if (typeof data === 'object' && data !== null) {
        const targetId = data.id || data.orderId;
        if (targetId && String(targetId) !== String(orderId)) return;
        s = data.status;
      } else {
        s = data;
      }

      if (s === 'Pending') setStatus(1);
      else if (s === 'Accepted') { setStatus(2); fetchOrder(); }
      else if (s === 'Preparing' || s === 'ReadyForPickup') { setStatus(3); fetchOrder(); }
      else if (s === 'PickedUp') { setStatus(4); fetchOrder(); }
      else if (s === 'Delivered') { setStatus(5); setShowDeliveryOverlay(true); }
      else if (s === 'Cancelled') setStatus(-1);
    });

    socket.on('checkpointUpdated', (d: { currentCheckpoint: string }) => {
      setCurrentCheckpoint(prev => prev === d.currentCheckpoint ? prev : d.currentCheckpoint);
    });

    // Chat Listeners
    const handleReceiveMessage = (msg: Message) => {
      setChatMessages(prev => [...prev, msg]);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
    };

    socket.on('receiveMessage', handleReceiveMessage);

    socket.on('typing_start', (data: { sender: string }) => {
      if (data.sender !== userName) setRemoteTyping(true);
    });

    socket.on('typing_end', (data: { sender: string }) => {
      if (data.sender !== userName) setRemoteTyping(false);
    });

    fetchOrder();
    const poll = setInterval(fetchOrder, 10000);

    return () => {
      clearInterval(poll);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('statusUpdated');
      socket.off('checkpointUpdated');
      socket.off('driverAtGate');
      socket.off('receiveMessage', handleReceiveMessage);
      socket.off('typing_start');
      socket.off('typing_end');
    };
  }, [orderId]);

  // Countdown timer for cancel window
  useEffect(() => {
    if (cancelSecondsLeft > 0 && status === 1) {
      const t = setInterval(() => setCancelSecondsLeft(p => Math.max(0, p - 1)), 1000);
      return () => clearInterval(t);
    }
  }, [cancelSecondsLeft, status]);

  // Calculate dynamic ETA
  useEffect(() => {
    if (status >= 4) { setEta('Arrived'); return; }
    const idx = CHECKPOINTS.findIndex(cp => cp.name === currentCheckpoint);
    const remaining = CHECKPOINTS.length - 1 - Math.max(0, idx);
    setEta(`~${Math.max(2, remaining * 4)} min`);
  }, [currentCheckpoint, status]);

  // Cancel order handler
  const handleCancelOrder = async () => {
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${orderId}/cancel`, { method: 'PUT' });
      if (res.ok) {
        setShowCancelConfirmation(false);
        setStatus(-1);
        Alert.alert('Success', 'Order cancelled and refund initiated.');
      } else {
        Alert.alert('Error', 'Unable to cancel order at this stage.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const handleApprovePurchase = async () => {
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${orderId}/approve-purchase`, { method: 'PUT' });
      if (res.ok) {
        Alert.alert('🟢 Purchase Approved', 'Rider is notified to proceed with shopping items.');
        const updated = await res.json();
        setOrderInfo(prev => prev ? { ...prev, ...updated.order } : prev);
      } else {
        Alert.alert('Error', 'Failed to approve purchase. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please check connection.');
    }
  };

  const handleApproveBill = async () => {
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${orderId}/approve-bill`, { method: 'PUT' });
      if (res.ok) {
        Alert.alert('💸 Reimbursement Confirmed', 'Reimbursement payment processed successfully! Checklist unlocked for rider.');
        const updated = await res.json();
        setOrderInfo(prev => prev ? { ...prev, ...updated.order } : prev);
      } else {
        Alert.alert('Error', 'Failed to approve bill. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please check connection.');
    }
  };

  // Submit Rating handler
  const handleSubmitRating = async () => {
    setSubmittingRating(true);
    try {
      const res = await apiFetch(`${API_URL}/api/orders/${orderId}/rate`, {
        method: 'PUT',
        body: JSON.stringify({
          rating: ratingStars,
          review: ratingReview,
          tipAmount: ratingTip ? Number(ratingTip) : 0
        })
      });
      if (res.ok) {
        setShowRatingModal(false);
        Alert.alert('Thank You', 'Your feedback was submitted successfully!');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmittingRating(false);
    }
  };

  // Chat message sending
  const sendMessage = () => {
    if (!chatInput.trim()) return;
    const s = getSocket();
    const messageData = {
      orderId,
      sender: userName,
      senderRole: 'customer',
      message: chatInput.trim()
    };
    s.emit('sendMessage', messageData);
    s.emit('typing_end', { orderId, sender: userName });
    setChatInput('');
  };

  const handleChatInputChange = (text: string) => {
    setChatInput(text);
    const s = getSocket();
    s.emit('typing_start', { orderId, sender: userName });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      s.emit('typing_end', { orderId, sender: userName });
    }, 1500);
  };

  const QUICK_REPLIES = [
    "Got it, coming down in 2 mins! 🏃‍♂️",
    "Please leave it with the gate warden/security. 🛡️",
    "Please leave it outside my room door. 🛏️",
    "Thanks, on my way! 🙌",
    "Please call me when you reach the gate. 📞"
  ];

  const steps = [
    { label: 'Order Placed', desc: 'Your order has been received.' },
    { label: 'Order Accepted', desc: 'Driver is preparing to fetch your meal.' },
    { label: 'Kitchen Preparing', desc: 'The kitchen is cooking your order right now.' },
    { label: 'Out for Delivery', desc: 'Rider is on the way to your hostel.' },
    { label: 'Arrived', desc: 'Pick up your food at the designated spot.' },
  ];

  const bg = isDark ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDark ? COLORS.bgCard : COLORS.bgLightCard;
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? COLORS.borderDark : COLORS.borderLight;

  if (status === -1) {
    return (
      <View style={[s.container, { backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <View style={s.cancelledCircle}>
          <Text style={{ fontSize: 32, color: COLORS.red }}>✕</Text>
        </View>
        <Text style={[s.cancelledTitle, { color: txt }]}>Order Cancelled</Text>
        <Text style={[s.cancelledDesc, { color: txtSec }]}>
          This order was cancelled. A full refund of{' '}
          <Text style={{ color: COLORS.emerald, fontWeight: '700' }}>
            ₹{orderInfo?.finalPrice || orderInfo?.totalPrice || 0}
          </Text>{' '}
          has been initiated.
        </Text>
        <TouchableOpacity style={s.returnBtn} onPress={() => router.replace('/(tabs)' as any)}>
          <Text style={s.returnBtnText}>RETURN HOME</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {showConfetti && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <ConfettiCannon count={200} origin={{ x: -10, y: 0 }} fadeOut={true} fallSpeed={2500} explosionSpeed={350} />
        </View>
      )}
      {/* ── HEADER ── */}
      <View style={[s.header, { backgroundColor: isDark ? '#000' : '#fff', borderBottomColor: border }]}>
        <TouchableOpacity 
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }} 
          style={s.backBtn}
        >
          <Text style={{ color: txt, fontSize: 18, fontWeight: 'bold' }}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: txt }]}>ORDER TRACKING</Text>
          {orderId && (
            <Text style={{ fontSize: 9, color: COLORS.gold, fontWeight: '800', letterSpacing: 1 }}>
              #{orderId.slice(-6).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[s.statusIndicator, { backgroundColor: isConnected ? 'rgba(16,185,129,0.1)' : 'rgba(239,79,95,0.1)' }]}>
            <View style={[s.statusDot, { backgroundColor: isConnected ? COLORS.emerald : COLORS.red }]} />
            <Text style={[s.statusText, { color: isConnected ? COLORS.emerald : COLORS.red }]}>
              {isConnected ? 'LIVE' : 'OFFLINE'}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* ── LIVE TACTICAL RADAR MAP ── */}
        <StaggeredSection delay={30} direction="up">
          <TacticalRadarMap status={status} currentCheckpoint={currentCheckpoint} isDark={isDark} />
        </StaggeredSection>

        {/* ── CURRENT STAGE CARD ── */}
        <StaggeredSection delay={50} direction="up">
          <View style={[s.currentStageCard, { backgroundColor: cardBg, borderColor: COLORS.goldBorder }]}>
            <Text style={s.stageEmoji}>
              {status === 1 ? '⏳' : status === 2 ? '✅' : status === 3 ? '🍳' : status === 4 ? '🛵' : '🎉'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.stageLabel, { color: txtSec }]}>CURRENT STATUS</Text>
              <Text style={[s.stageText, { color: txt }]}>
                {status === 1 && 'Waiting for restaurant acceptance'}
                {status === 2 && 'Order accepted — rider assigning'}
                {status === 3 && 'Kitchen is preparing your fresh meal'}
                {status === 4 && `Rider is on the way to ${currentCheckpoint}`}
                {status >= 5 && 'Order delivered successfully!'}
              </Text>
            </View>
            {eta && eta !== 'Calculating...' && (
              <View style={s.etaChip}>
                <Text style={s.etaText}>{eta}</Text>
              </View>
            )}
          </View>
        </StaggeredSection>

        {/* ── MEGA BASKET KIRANA APPROVAL PANEL ── */}
        {orderInfo?.category === 'Mega Basket' && (
          <StaggeredSection delay={80} direction="up">
            <View style={{ backgroundColor: cardBg, borderColor: COLORS.goldBorder, borderWidth: 1, padding: 16, borderRadius: 20, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: 8, borderRadius: 10 }}>
                  <Text style={{ fontSize: 16 }}>🧺</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: '#F59E0B', letterSpacing: 2 }}>MEGA BASKET ACTIVE WORKFLOW</Text>
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: txt }}>Household Kirana Verification</Text>
                </View>
              </View>

              {/* Step 1: Pre-Purchase Item/Estimate Approval */}
              <View style={{ borderBottomWidth: 1, borderBottomColor: border, paddingBottom: 14, marginBottom: 14 }}>
                <Text style={{ fontSize: 10, fontWeight: 'bold', color: txtSec, marginBottom: 4 }}>STEP 1: PRE-PURCHASE APPROVAL</Text>
                {!orderInfo.itemPhotoUrl ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                    <ActivityIndicator size="small" color="#F59E0B" />
                    <Text style={{ fontSize: 11, color: txtSec, fontStyle: 'italic' }}>
                      Rider is checking items at the Kirana store...
                    </Text>
                  </View>
                ) : (
                  <View>
                    <Text style={{ fontSize: 11, color: txt, marginBottom: 8 }}>
                      Rider has uploaded a preview of the grocery items and price estimate:
                    </Text>
                    {orderInfo.itemPhotoUrl && (
                      <View style={{ height: 160, borderRadius: 10, overflow: 'hidden', backgroundColor: '#222', marginBottom: 10 }}>
                        <Image source={{ uri: orderInfo.itemPhotoUrl }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
                      </View>
                    )}

                    {!orderInfo.isPurchasingApprovedByCustomer ? (
                      <TouchableOpacity
                        style={{ backgroundColor: '#F59E0B', paddingVertical: 10, borderRadius: 10, alignItems: 'center' }}
                        onPress={handleApprovePurchase}
                      >
                        <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 11 }}>🟢 AGREE & APPROVE PURCHASING</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 13 }}>🟢</Text>
                        <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLORS.emerald }}>
                          Pre-Purchase Approved! Rider is building basket.
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Step 2: Final Receipt Reimbursement Payment */}
              {orderInfo.isPurchasingApprovedByCustomer && (
                <View>
                  <Text style={{ fontSize: 10, fontWeight: 'bold', color: txtSec, marginBottom: 4 }}>STEP 2: RECEIPT REIMBURSEMENT</Text>
                  {!orderInfo.billProofUrl ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                      <ActivityIndicator size="small" color="#F59E0B" />
                      <Text style={{ fontSize: 11, color: txtSec, fontStyle: 'italic' }}>
                        Waiting for final billing/receipt upload...
                      </Text>
                    </View>
                  ) : (
                    <View>
                      <Text style={{ fontSize: 11, color: txt, marginBottom: 4 }}>
                        Rider uploaded the final receipt:
                      </Text>
                      <Text style={{ fontSize: 14, fontWeight: 'bold', color: COLORS.emerald, marginBottom: 8 }}>
                        Total Amount: ₹{orderInfo.billAmount}
                      </Text>
                      {orderInfo.billProofUrl && (
                        <View style={{ height: 160, borderRadius: 10, overflow: 'hidden', backgroundColor: '#222', marginBottom: 10 }}>
                          <Image source={{ uri: orderInfo.billProofUrl }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
                        </View>
                      )}

                      {!orderInfo.isBillApproved ? (
                        <TouchableOpacity
                          style={{ backgroundColor: COLORS.emerald, paddingVertical: 10, borderRadius: 10, alignItems: 'center' }}
                          onPress={handleApproveBill}
                        >
                          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 11 }}>
                            💸 CONFIRM REIMBURSEMENT & PAY ₹{orderInfo.billAmount}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 13 }}>🟢</Text>
                          <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLORS.emerald }}>
                            Bill Reimbursed & Confirmed! Rider is in transit.
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

        {/* ── BATCH DISCOUNT BANNER ── */}
        {orderInfo?.riderOtherOrders && orderInfo.riderOtherOrders > 0 && (
          <StaggeredSection delay={110} direction="up">
            <View style={s.ecoBanner}>
              <Text style={{ fontSize: 16, marginRight: 6 }}>🌱</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.ecoTitle}>Eco-Batching Active</Text>
                <Text style={s.ecoSubtitle}>Rider is delivering another order along the route to reduce carbon emissions.</Text>
              </View>
            </View>
          </StaggeredSection>
        )}

        {/* ── GATE VERIFICATION PIN ── */}
        {orderInfo?.deliveryPin && (
          <StaggeredSection delay={170} direction="up">
            <View style={[s.pinCard, { backgroundColor: cardBg, borderColor: border }]}>
              <View style={s.pinHeader}>
                <View style={s.pinIconWrap}>
                  <Text style={{ fontSize: 18 }}>🔑</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.pinLabel, { color: txtSec }]}>DELIVERY SECURITY PIN</Text>
                  <Text style={[s.pinDesc, { color: txt }]}>Show this code to the rider to verify delivery</Text>
                </View>
              </View>
              <View style={s.pinDisplayRow}>
                <TouchableOpacity style={s.pinButton} onPress={copyPinToClipboard}>
                  <Text style={s.pinText}>{orderInfo.deliveryPin}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.zoomBtn} onPress={() => setZoomPin(true)}>
                  <Text style={{ fontSize: 14 }}>🔍 ZOOM</Text>
                </TouchableOpacity>
              </View>
            </View>
          </StaggeredSection>
        )}

        {/* ── RIDER PROFILE CARD ── */}
        <StaggeredSection delay={230} direction="up">
          <View style={[s.riderCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={{ fontSize: 9, fontWeight: '900', color: COLORS.gold, letterSpacing: 2, marginBottom: 12 }}>
              DELIVERY RIDER DETAILS
            </Text>
            <View style={s.riderRow}>
              <View style={s.riderAvatarWrap}>
                <Text style={{ fontSize: 24 }}>🛵</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.riderName, { color: txt }]}>
                    {orderInfo?.deliveryPartner?.name || 'Assigning Captain...'}
                  </Text>
                  {orderInfo?.deliveryPartner && (
                    <View style={s.verifiedBadge}>
                      <Text style={s.verifiedText}>VERIFIED</Text>
                    </View>
                  )}
                </View>
                <Text style={[s.riderVehicle, { color: txtSec }]}>
                  {orderInfo?.deliveryPartner?.vehicleType || 'Zenvy Logistics'}
                  {orderInfo?.deliveryPartner?.vehicleNumber ? ` • ${orderInfo.deliveryPartner.vehicleNumber}` : ''}
                </Text>
                {orderInfo?.deliveryPartner && (
                  <Text style={{ fontSize: 9, color: COLORS.gold, fontWeight: '800', marginTop: 2 }}>
                    ⭐ {orderInfo?.deliveryPartner?.averageRating || '5.0'}
                  </Text>
                )}
              </View>
            </View>

            {/* Progress bar */}
            <View style={s.progressTrack}>
              <View
                style={[
                  s.progressBar,
                  { width: `${status === 1 ? 10 : status === 2 ? 30 : status === 3 ? 55 : status === 4 ? 85 : 100}%` }
                ]}
              />
            </View>
          </View>
        </StaggeredSection>

        {/* ── QUICK ACTION BUTTONS ── */}
        <StaggeredSection delay={290} direction="up">
          <View style={s.actionRow}>
            <TouchableOpacity style={[s.actionBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={() => setIsChatOpen(true)}>
              <Text style={{ fontSize: 16 }}>💬</Text>
              <Text style={[s.actionBtnText, { color: txt }]}>CHAT</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[s.actionBtn, { backgroundColor: cardBg, borderColor: border }, !orderInfo?.deliveryPartner?.phone && { opacity: 0.5 }]} 
              disabled={!orderInfo?.deliveryPartner?.phone}
              onPress={() => Linking.openURL(`tel:${orderInfo?.deliveryPartner?.phone}`)}
            >
              <Text style={{ fontSize: 16 }}>📞</Text>
              <Text style={[s.actionBtnText, { color: txt }]}>CALL RIDER</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.actionBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={copyPinToClipboard}>
              <Text style={{ fontSize: 16 }}>🔗</Text>
              <Text style={[s.actionBtnText, { color: txt }]}>SHARE</Text>
            </TouchableOpacity>
          </View>
        </StaggeredSection>

        {/* ── CANCEL WINDOW COUNTDOWN ── */}
        {status === 1 && cancelSecondsLeft > 0 && (
          <StaggeredSection delay={330} direction="up">
            <TouchableOpacity style={s.cancelBox} onPress={() => setShowCancelConfirmation(true)}>
              <Text style={s.cancelBoxText}>CANCEL ORDER ({cancelSecondsLeft}s)</Text>
            </TouchableOpacity>
          </StaggeredSection>
        )}

        {/* ── STEPS PROGRESS TIMELINE ── */}
        <StaggeredSection delay={370} direction="up">
          <View style={[s.timelineCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={{ fontSize: 9, fontWeight: '900', color: txtSec, letterSpacing: 2, marginBottom: 16 }}>
              ORDER STAGE TIMELINE
            </Text>
            <View style={{ gap: 0 }}>
              {steps.map((step, idx) => {
                const stepNum = idx + 1;
                const isDone = status > stepNum;
                const isCurrent = status === stepNum;
                const isUpcoming = status < stepNum;
                return (
                  <View key={idx} style={s.timelineStepRow}>
                    {idx < steps.length - 1 && <View style={[s.timelineLine, { backgroundColor: isDone ? COLORS.gold : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)') }]} />}
                    <View style={[
                      s.timelineDot,
                      {
                        borderColor: (isDone || isCurrent) ? COLORS.gold : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                        backgroundColor: isDone ? COLORS.gold : (isDark ? '#111' : '#f0f0f0')
                      }
                    ]}>
                      {isDone ? (
                        <Text style={{ fontSize: 9, color: '#000', fontWeight: '900' }}>✓</Text>
                      ) : (
                        <Text style={{ fontSize: 8, color: isCurrent ? COLORS.gold : txtSec, fontWeight: 'bold' }}>{stepNum}</Text>
                      )}
                    </View>
                    <View style={[s.timelineContent, isUpcoming && { opacity: 0.3 }]}>
                      <Text style={[s.timelineTitle, { color: isCurrent ? COLORS.gold : txt }]}>{step.label}</Text>
                      {(isCurrent || isDone) && <Text style={[s.timelineDesc, { color: txtSec }]}>{step.desc}</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </StaggeredSection>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── ZOOM PIN MODAL ── */}
      <Modal visible={zoomPin} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setZoomPin(false)} />
          <View style={[s.zoomPinBox, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={s.zoomTitle}>SECURITY PIN</Text>
            <Text style={[s.zoomDesc, { color: txtSec }]}>Show this code to the rider to verify delivery</Text>
            <View style={s.zoomPinDisplay}>
              <Text style={s.zoomPinText}>{orderInfo?.deliveryPin}</Text>
            </View>
            <TouchableOpacity style={s.zoomCloseBtn} onPress={() => setZoomPin(false)}>
              <Text style={s.zoomCloseText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── CANCEL CONFIRMATION MODAL ── */}
      <Modal visible={showCancelConfirmation} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowCancelConfirmation(false)} />
          <View style={[s.cancelModalBox, { backgroundColor: cardBg }]}>
            <Text style={[s.cancelModalTitle, { color: txt }]}>Cancel Order?</Text>
            <Text style={[s.cancelModalDesc, { color: txtSec }]}>
              This action cannot be undone. You will lose your queue position and any batch discounts.
            </Text>
            <TouchableOpacity style={s.confirmCancelBtn} onPress={handleCancelOrder}>
              <Text style={s.confirmCancelBtnText}>YES, CANCEL ORDER</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.dismissCancelBtn} onPress={() => setShowCancelConfirmation(false)}>
              <Text style={[s.dismissCancelBtnText, { color: txtSec }]}>KEEP MY ORDER</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── CHAT DRAWER MODAL ── */}
      <Modal visible={isChatOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setIsChatOpen(false)} />
          <View style={[s.chatContainer, { backgroundColor: isDark ? '#111116' : '#fff' }]}>
            {/* Header */}
            <View style={[s.chatHeader, { borderBottomColor: border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={s.chatAvatarWrap}>
                  <Text style={{ fontSize: 18 }}>🛵</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 8, color: COLORS.emerald, fontWeight: '900', letterSpacing: 2 }}>LIVE CHAT</Text>
                  <Text style={[s.chatRiderName, { color: txt }]}>
                    {orderInfo?.deliveryPartner?.name || 'Zenvy Captain'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setIsChatOpen(false)} style={s.chatCloseBtn}>
                <Text style={{ color: txtSec, fontSize: 16, fontWeight: '900' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Messages ScrollView */}
            <ScrollView
              ref={chatScrollRef}
              style={{ flex: 1, padding: 16 }}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {chatMessages.length === 0 && (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <Text style={{ fontSize: 24, marginBottom: 8 }}>💬</Text>
                  <Text style={{ fontSize: 11, color: txtSec, fontStyle: 'italic', textAlign: 'center' }}>
                    Direct messages are masked for your privacy.
                  </Text>
                </View>
              )}
              {chatMessages.map((msg, idx) => {
                const isMe = msg.sender === userName;
                return (
                  <View key={idx} style={[s.messageRow, { justifyContent: isMe ? 'flex-end' : 'flex-start' }]}>
                    <View style={[
                      s.messageBubble,
                      {
                        backgroundColor: isMe ? COLORS.emerald : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'),
                        borderBottomRightRadius: isMe ? 0 : 16,
                        borderBottomLeftRadius: isMe ? 16 : 0,
                      }
                    ]}>
                      <Text style={[s.messageText, { color: isMe ? '#fff' : txt }]}>
                        {msg.message}
                      </Text>
                    </View>
                  </View>
                );
              })}
              {remoteTyping && (
                <View style={{ flexDirection: 'row', padding: 8 }}>
                  <Text style={{ fontSize: 9, color: COLORS.emerald, fontWeight: '800' }}>Captain is typing...</Text>
                </View>
              )}
            </ScrollView>

            {/* Input & Quick Replies */}
            <View style={[s.chatFooter, { borderTopColor: border }]}>
              {/* Quick Replies list */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {QUICK_REPLIES.map((reply, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => {
                      const messageData = {
                        orderId,
                        sender: userName,
                        senderRole: 'customer',
                        message: reply
                      };
                      getSocket().emit('sendMessage', messageData);
                    }}
                    style={s.quickReplyChip}
                  >
                    <Text style={s.quickReplyText}>{reply.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={s.chatInputRow}>
                <TextInput
                  style={[s.chatInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', color: txt }]}
                  placeholder="Type a message..."
                  placeholderTextColor={txtSec}
                  value={chatInput}
                  onChangeText={handleChatInputChange}
                />
                <TouchableOpacity style={s.sendBtn} onPress={sendMessage}>
                  <Text style={{ fontSize: 16 }}>🚀</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── RATING MODAL ── */}
      <Modal visible={showRatingModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} />
          <View style={[s.ratingModalBox, { backgroundColor: cardBg }]}>
            <Text style={[s.ratingModalTitle, { color: txt }]}>Rate Your Experience</Text>
            <Text style={[s.ratingModalDesc, { color: txtSec }]}>
              How was the delivery by {orderInfo?.deliveryPartner?.name || 'Zenvy Captain'}?
            </Text>

            {/* Stars Row */}
            <View style={s.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRatingStars(star)}>
                  <Text style={{ fontSize: 32, color: star <= ratingStars ? COLORS.gold : '#aaa', marginHorizontal: 4 }}>
                    ★
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Review Input */}
            <TextInput
              style={[s.ratingInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', color: txt }]}
              placeholder="Leave a comment (optional)..."
              placeholderTextColor={txtSec}
              multiline
              value={ratingReview}
              onChangeText={setRatingReview}
            />

            {/* Tip Input */}
            <TextInput
              style={[s.ratingInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', color: txt, marginTop: 12 }]}
              placeholder="Add Tip for captain (e.g. ₹20)"
              placeholderTextColor={txtSec}
              keyboardType="numeric"
              value={ratingTip}
              onChangeText={setRatingTip}
            />

            {/* Submit rating */}
            <TouchableOpacity style={s.submitRatingBtn} onPress={handleSubmitRating} disabled={submittingRating}>
              {submittingRating ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={s.submitRatingText}>SUBMIT RATING</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
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
  headerTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
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
  stageEmoji: { fontSize: 24, marginRight: 12 },
  stageLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2, marginBottom: 2 },
  stageText: { fontSize: 13, fontWeight: '700' },
  etaChip: {
    backgroundColor: COLORS.goldMuted,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.goldBorder
  },
  etaText: { fontSize: 9, fontWeight: '900', color: COLORS.gold },

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
  ecoTitle: { fontSize: 11, fontWeight: '900', color: COLORS.emerald, letterSpacing: 1 },
  ecoSubtitle: { fontSize: 8, color: '#888', fontWeight: '500', marginTop: 2 },

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
  pinLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2 },
  pinDesc: { fontSize: 11, fontWeight: '600', marginTop: 2 },
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
  pinText: { fontSize: 18, fontWeight: '900', color: '#000', letterSpacing: 6 },
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
  riderName: { fontSize: 13, fontWeight: '800' },
  verifiedBadge: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  verifiedText: { fontSize: 6, fontWeight: '900', color: COLORS.emerald },
  riderVehicle: { fontSize: 9, fontWeight: '600', marginTop: 2 },
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
  actionBtnText: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5 },

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
  timelineTitle: { fontSize: 11, fontWeight: '800' },
  timelineDesc: { fontSize: 9, marginTop: 2, color: '#888' },

  // Cancel countdown
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
  cancelBoxText: { fontSize: 10, fontWeight: '900', color: COLORS.red, letterSpacing: 2 },

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
  cancelledTitle: { fontSize: 18, fontWeight: '900', marginBottom: 8 },
  cancelledDesc: { fontSize: 11, textAlign: 'center', lineHeight: 16, marginBottom: 24, maxWidth: 260 },
  returnBtn: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  returnBtnText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 2 },

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
  zoomTitle: { fontSize: 13, fontWeight: '900', color: COLORS.gold, letterSpacing: 3, marginBottom: 4 },
  zoomDesc: { fontSize: 9, fontWeight: '700', marginBottom: 20 },
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
  zoomPinText: { fontSize: 48, fontWeight: '900', color: '#000', letterSpacing: 10 },
  zoomCloseBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center'
  },
  zoomCloseText: { fontSize: 10, fontWeight: '800', color: '#888' },

  // Cancel Modal Box
  cancelModalBox: {
    width: '90%',
    padding: 24,
    borderRadius: 24,
    marginBottom: 40,
    alignItems: 'center'
  },
  cancelModalTitle: { fontSize: 14, fontWeight: '900', marginBottom: 8 },
  cancelModalDesc: { fontSize: 11, textAlign: 'center', lineHeight: 16, color: '#888', marginBottom: 24 },
  confirmCancelBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.red,
    alignItems: 'center',
    marginBottom: 8
  },
  confirmCancelBtnText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  dismissCancelBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center'
  },
  dismissCancelBtnText: { fontSize: 10, fontWeight: '800' },

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
  chatRiderName: { fontSize: 12, fontWeight: '800' },
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
  quickReplyText: { fontSize: 7, fontWeight: '900', letterSpacing: 1, color: '#aaa' },
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
  ratingModalTitle: { fontSize: 14, fontWeight: '900', marginBottom: 4 },
  ratingModalDesc: { fontSize: 10, color: '#888', marginBottom: 20 },
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
  submitRatingText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 2 }
});
