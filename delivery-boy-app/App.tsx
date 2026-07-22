import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Vibration,
  StatusBar,
  Dimensions,
  Image,
  Modal,
  Switch,
  FlatList,
  Linking,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueOfflineAction,
  flushOfflineQueue,
  getOfflineQueue,
  OfflineAction,
} from './src/services/offlineQueue';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldVibrate: true,
  }),
});

const { width: SW, height: SH } = Dimensions.get('window');

// Persistent Storage Keys
const STORAGE_SERVER_KEY = '@zenvy_native_backend_url';
const STORAGE_TOKEN_KEY = '@zenvy_native_rider_token';
const STORAGE_PROFILE_KEY = '@zenvy_native_rider_profile';

// Default API URLs (Production Render Backend)
const DEFAULT_API_URL = 'https://hostelbites-backend-jwmt.onrender.com/api';
const FALLBACK_API_URL = 'http://localhost:5005/api';

interface OrderItem {
  name: string;
  quantity: number;
  price?: number;
  restaurant?: string;
  restaurantAddress?: string;
  restaurantPhone?: string;
}

interface PickupStop {
  restaurantName: string;
  address: string;
  phone: string;
  items: OrderItem[];
}

interface Order {
  id: string;
  _id?: string;
  restaurant: string;
  restaurantAddress?: string;
  restaurantPhone?: string;
  customerName: string;
  customerPhone?: string;
  drop: string;
  items: OrderItem[];
  totalPrice?: number;
  finalPrice?: number;
  megaBasketStep?: 'SHOPPING_AT_STORE' | 'BILL_UPLOADED' | 'PAYMENT_CONFIRMED' | 'DELIVERING_TO_APARTMENT';
  billProofUrl?: string;
  billAmount?: number;
  isBillApproved?: boolean;
  itemPhotoUrl?: string;
  isPurchasingApprovedByCustomer?: boolean;
  deliverySlot?: 'Before 7:30 PM' | 'After 7:30 PM' | '1:00 PM - 6:00 PM' | string;
  category?: 'Food' | 'Fruits' | 'Groceries' | 'Mega Basket' | string;
  isBulk?: boolean;
  pickupStops?: PickupStop[];
  isMultiRestaurant?: boolean;
  status: 'Accepted' | 'ReadyForPickup' | 'PickedUp' | 'ArrivedAtGate' | 'Delivered' | string;
  deliveryPin?: string;
  createdAt?: string;
  deliveredAt?: string;
}

interface RiderProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  rating: number;
  totalEarnings: number;
  completedCount: number;
  vehicleNumber?: string;
  vehicleType?: string;
  zenPoints?: number;
  emergencyContact?: string;
}

interface LeaderboardUser {
  id: string;
  name: string;
  deliveries: number;
  earnings: number;
  rating: number;
}

export default function App() {
  // App Boot & Configuration
  const [apiHost, setApiHost] = useState<string>(DEFAULT_API_URL);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Authentication State
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);

  // Navigation & Duty State
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'active' | 'available' | 'leaderboard' | 'profile'>('active');
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Category, Time-Slot & Lifecycle Stage Filter State
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | 'Food' | 'Fruits' | 'Groceries' | 'Mega Basket'>('ALL');
  const [selectedSlot, setSelectedSlot] = useState<'ALL' | 'Before 7:30 PM' | 'After 7:30 PM' | '1:00 PM - 6:00 PM'>('ALL');
  const [selectedStage, setSelectedStage] = useState<'ALL' | 'Picking' | 'PickedUp' | 'ArrivedAtGate'>('ALL');

  // Order Data & Marking Checklist
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [checkedItemsMap, setCheckedItemsMap] = useState<Record<string, Record<number, boolean>>>({});
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Mega Basket Kirana Bill Proof & Reimbursement State
  const [billAmountInputs, setBillAmountInputs] = useState<Record<string, string>>({});
  const [billProofUploadedMap, setBillProofUploadedMap] = useState<Record<string, boolean>>({});
  const [billApprovedMap, setBillApprovedMap] = useState<Record<string, boolean>>({});

  // Pre-Purchase Kirana Item Photo Upload & Customer Agreement State
  const [itemPhotoUploadedMap, setItemPhotoUploadedMap] = useState<Record<string, boolean>>({});
  const [purchaseApprovedMap, setPurchaseApprovedMap] = useState<Record<string, boolean>>({});

  // Collapsible Card Expansion State (Default: Minimized, user taps to expand)
  const [expandedOrdersMap, setExpandedOrdersMap] = useState<Record<string, boolean>>({});

  const toggleOrderExpanded = (orderId: string) => {
    Vibration.vibrate(30);
    setExpandedOrdersMap(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  // Telemetry, Offline Queue & Hardware Sensors
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({ lat: 16.4632, lng: 80.5064 });
  const [isBatteryLow, setIsBatteryLow] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(0);
  const previousPendingCount = useRef<number>(0);

  // 1. Initial Load & Setup
  useEffect(() => {
    bootstrapApp();
    setupSensors();
  }, []);

  // Register push token whenever user logs in or app is bootstrapped
  useEffect(() => {
    if (authToken) {
      registerPushToken();
    }
  }, [authToken]);

  // 2. Poll Orders Periodically when Online
  useEffect(() => {
    if (!authToken || !isOnline) return;
    fetchDashboardData();
    const interval = setInterval(() => {
      fetchDashboardData(true);
    }, 6000);
    return () => clearInterval(interval);
  }, [authToken, isOnline, apiHost]);

  // Update Offline Queue Count
  const updateOfflineCount = async () => {
    const queue = await getOfflineQueue();
    setOfflineQueueCount(queue.length);
  };

  const bootstrapApp = async () => {
    try {
      const savedHost = await AsyncStorage.getItem(STORAGE_SERVER_KEY);
      const savedToken = await AsyncStorage.getItem(STORAGE_TOKEN_KEY);
      const savedProfile = await AsyncStorage.getItem(STORAGE_PROFILE_KEY);

      if (savedHost) setApiHost(savedHost);
      if (savedToken) setAuthToken(savedToken);
      if (savedProfile) setProfile(JSON.parse(savedProfile));

      await updateOfflineCount();

      if (savedToken) {
        await fetchDashboardData();
      }
    } catch (err) {
      console.warn('Bootstrap error:', err);
    } finally {
      setIsInitializing(false);
    }
  };

  const setupSensors = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 8000, distanceInterval: 10 },
          (loc) => {
            setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          }
        );
      }

      const batLevel = await Battery.getBatteryLevelAsync();
      if (batLevel > 0 && batLevel < 0.2) setIsBatteryLow(true);

      const netState = await Network.getNetworkStateAsync();
      const online = netState.isConnected ?? true;
      setIsConnected(online);

      Network.addNetworkStateListener(async (state) => {
        const nowOnline = state.isConnected ?? true;
        setIsConnected(nowOnline);
        if (nowOnline) {
          // Sync offline queued actions automatically when network returns
          const result = await flushOfflineQueue(apiFetch);
          await updateOfflineCount();
          if (result.processed > 0) {
            Alert.alert('⚡ Offline Actions Synced', `Successfully processed ${result.processed} queued delivery updates!`);
            fetchDashboardData(true);
          }
        }
      });
      registerPushToken();
    } catch (e) {
      console.warn('Sensors init error:', e);
    }
  };

  const registerPushToken = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('delivery-alerts-v2', {
            name: 'Delivery Alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250, 250, 250, 250, 250],
            lightColor: '#FF231F7A',
            sound: 'alert',
          });
        }
        let fcmToken = '';
        try {
          const deviceTokenData = await Notifications.getDevicePushTokenAsync();
          fcmToken = deviceTokenData.data;
        } catch (deviceError) {
          console.warn('FCM native token failed, trying Expo fallback:', deviceError);
          const tokenData = await Notifications.getExpoPushTokenAsync();
          fcmToken = tokenData.data;
        }
        if (fcmToken && authToken) {
          apiFetch('/delivery/fcm-token', {
            method: 'POST',
            body: JSON.stringify({ fcmToken, token: fcmToken, appVersion: 'native-1.0.0' })
          })
          .then(() => console.log('[PUSH_REGISTER] Successfully registered token:', fcmToken))
          .catch((err) => console.warn('[PUSH_REGISTER] Registration failed:', err.message));
        }
      }
    } catch (e) {
      console.warn('Push token error:', e);
    }
  };

  // API Call Helper
  const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const res = await fetch(`${apiHost}${endpoint}`, { ...options, headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'API request failed');
      return data;
    } catch (err: any) {
      // Fallback try if default host failed
      if (apiHost === DEFAULT_API_URL && err.message?.includes('Network request failed')) {
        try {
          const res2 = await fetch(`${FALLBACK_API_URL}${endpoint}`, { ...options, headers });
          const data2 = await res2.json();
          if (res2.ok) return data2;
        } catch (e) {}
      }
      throw err;
    }
  };

  // Helper to normalize and auto-detect category, bulk order, and multi-restaurant stops
  const formatOrder = (raw: any): Order => {
    const items: OrderItem[] = Array.isArray(raw.items) ? raw.items : [];
    const totalQty = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
    const totalPrice = raw.totalPrice || raw.finalPrice || items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
    const isBulk = raw.isBulk !== undefined ? raw.isBulk : (totalQty >= 5 || totalPrice >= 500);

    // Group items by pickup restaurant for Multi-Restaurant Order Support
    const stopsMap: Record<string, PickupStop> = {};
    items.forEach(item => {
      const rName = item.restaurant || raw.restaurant || 'Campus Bistro';
      const rAddr = item.restaurantAddress || raw.restaurantAddress || 'Food Court Area';
      const rPhone = item.restaurantPhone || raw.restaurantPhone || '+91 9876543210';

      if (!stopsMap[rName]) {
        stopsMap[rName] = {
          restaurantName: rName,
          address: rAddr,
          phone: rPhone,
          items: []
        };
      }
      stopsMap[rName].items.push(item);
    });

    const pickupStops = Object.values(stopsMap);
    const isMultiRestaurant = pickupStops.length > 1;

    let category = raw.category;
    if (!category) {
      const text = `${raw.restaurant || ''} ${items.map(i => `${i.name} ${i.restaurant || ''}`).join(' ')} ${raw.drop || ''}`.toLowerCase();
      if (text.includes('mega') || text.includes('basket') || text.includes('apartment') || text.includes('combo') || text.includes('wholesale') || text.includes('monthly grocery')) {
        category = 'Mega Basket';
      } else if (text.includes('fruit') || text.includes('apple') || text.includes('mango') || text.includes('banana') || text.includes('juice')) {
        category = 'Fruits';
      } else if (text.includes('grocery') || text.includes('soap') || text.includes('shampoo') || text.includes('biscuit') || text.includes('surf') || text.includes('lays')) {
        category = 'Groceries';
      } else {
        category = 'Food';
      }
    }

    const mainRestaurantName = isMultiRestaurant
      ? `Multi-Vendor (${pickupStops.length} Stops)`
      : (raw.restaurant || pickupStops[0]?.restaurantName || 'Campus Bistro');

    return {
      id: String(raw.id || raw._id || 'ORD-UNKNOWN'),
      restaurant: mainRestaurantName,
      restaurantAddress: raw.restaurantAddress || pickupStops[0]?.address || 'Food Court Area',
      restaurantPhone: raw.restaurantPhone || pickupStops[0]?.phone || '+91 9876543210',
      customerName: raw.customerName || 'Student Customer',
      customerPhone: raw.customerPhone || '+91 9876543210',
      drop: raw.drop || 'Hostel Campus Drop',
      items,
      totalPrice,
      status: raw.status || 'Accepted',
      deliveryPin: raw.deliveryPin || '1234',
      createdAt: raw.createdAt || new Date().toISOString(),
      deliverySlot: raw.deliverySlot || 'After 7:30 PM',
      category,
      isBulk,
      pickupStops,
      isMultiRestaurant,
      itemPhotoUrl: raw.itemPhotoUrl,
      isPurchasingApprovedByCustomer: raw.isPurchasingApprovedByCustomer,
      billProofUrl: raw.billProofUrl,
      billAmount: raw.billAmount,
      isBillApproved: raw.isBillApproved,
    };
  };



  // Fetch Dashboard Orders & Leaderboard
  const fetchDashboardData = async (silent: boolean = false) => {
    if (!authToken) return;
    try {
      const [activeRes, pendingRes, statsRes] = await Promise.allSettled([
        apiFetch('/delivery/orders/active'),
        apiFetch('/delivery/orders/pending'),
        apiFetch('/delivery/stats/today')
      ]);

      if (activeRes.status === 'fulfilled') {
        const rawOrders = Array.isArray(activeRes.value)
          ? activeRes.value
          : (activeRes.value && typeof activeRes.value === 'object' && Array.isArray((activeRes.value as any).orders)
              ? (activeRes.value as any).orders
              : []);
        const formatted = rawOrders.map(formatOrder);
        setActiveOrders(formatted);
        
        // Sync local Mega Basket approval states with DB fields
        formatted.forEach(o => {
          if (o.itemPhotoUrl) setItemPhotoUploadedMap(prev => ({ ...prev, [o.id]: true }));
          if (o.isPurchasingApprovedByCustomer) setPurchaseApprovedMap(prev => ({ ...prev, [o.id]: true }));
          if (o.billProofUrl) setBillProofUploadedMap(prev => ({ ...prev, [o.id]: true }));
          if (o.isBillApproved) setBillApprovedMap(prev => ({ ...prev, [o.id]: true }));
        });
      }
      if (pendingRes.status === 'fulfilled' && Array.isArray(pendingRes.value)) {
        const newPending = pendingRes.value.map(formatOrder);
        if (newPending.length > previousPendingCount.current) {
          Vibration.vibrate([0, 300, 150, 300]);
          Notifications.scheduleNotificationAsync({
            content: {
              title: '🛵 New Order Available!',
              body: 'A new order is available for pickup. Open Zenvy Rider to accept!',
              sound: 'alert',
              priority: Notifications.AndroidNotificationPriority.MAX,
              android: {
                channelId: 'delivery-alerts-v2',
              },
            },
            trigger: null,
          }).catch(() => {});
        }
        previousPendingCount.current = newPending.length;
        setPendingOrders(newPending);
      }
      if (statsRes.status === 'fulfilled' && statsRes.value) {
        setProfile(prev => ({
          ...prev!,
          totalEarnings: statsRes.value.earnings || prev?.totalEarnings || 0,
          completedCount: statsRes.value.completedCount || prev?.completedCount || 0,
        }));
      }
    } catch (err: any) {
      if (!silent) {
        console.warn('Dashboard fetch error:', err.message);
      }
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (isConnected) {
      await flushOfflineQueue(apiFetch);
      await updateOfflineCount();
    }
    await fetchDashboardData();
    setRefreshing(false);
  };

  // Login Handler
  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      Alert.alert('Login Required', 'Please enter your Rider Email/Phone and Password.');
      return;
    }
    setLoginLoading(true);
    try {
      const data = await apiFetch('/delivery/login', {
        method: 'POST',
        body: JSON.stringify({ phone: loginEmail, email: loginEmail, password: loginPassword }),
      });

      const token = data.token;
      const userProfile: RiderProfile = {
        id: data._id || data.id,
        name: data.name,
        email: data.email || `${data.phone}@zenvy.com`,
        phone: data.phone,
        rating: data.rating !== undefined ? data.rating : 5.0,
        totalEarnings: data.walletBalance || data.totalEarnings || 0,
        completedCount: data.completedDeliveries || data.completedCount || 0,
        vehicleNumber: data.vehicleNumber || 'Not Registered',
        vehicleType: data.vehicleType || 'Not Registered',
        zenPoints: data.zenPoints !== undefined ? data.zenPoints : 0,
        emergencyContact: data.emergencyContact || 'Not Registered',
      };

      setAuthToken(token);
      setProfile(userProfile);
      await AsyncStorage.setItem(STORAGE_TOKEN_KEY, token);
      await AsyncStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(userProfile));

      Vibration.vibrate(100);
      await fetchDashboardData();
    } catch (err: any) {
      Alert.alert(
        'Login Failed',
        err.message || 'Could not connect to Zenvy server. Check your internet connection and try again.'
      );
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to sign out of Zenvy Rider?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_TOKEN_KEY);
          await AsyncStorage.removeItem(STORAGE_PROFILE_KEY);
          setAuthToken(null);
          setProfile(null);
          setActiveOrders([]);
          setPendingOrders([]);
        }
      }
    ]);
  };

  // Toggle Item Marking Checklist
  const toggleItemCheck = (orderId: string, itemIdx: number) => {
    Vibration.vibrate(40);
    setCheckedItemsMap(prev => {
      const orderChecks = prev[orderId] || {};
      return {
        ...prev,
        [orderId]: {
          ...orderChecks,
          [itemIdx]: !orderChecks[itemIdx]
        }
      };
    });
  };

  // Kirana Store Bill Proof Upload & Customer Reimbursement Handlers
  const handleUploadStorePhoto = async (orderId: string) => {
    Vibration.vibrate(100);
    try {
      await apiFetch(`/orders/${orderId}/upload-item-photo`, {
        method: 'PUT',
        body: JSON.stringify({ itemPhotoUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e' })
      });
      setItemPhotoUploadedMap(prev => ({ ...prev, [orderId]: true }));
      Alert.alert(
        '📸 Kirana Item Photo Uploaded & Customer Notified',
        'Photo of store items/bill estimate uploaded to Render database! Customer app received push alert: "Please review Kirana store item photo and agree to proceed with purchasing."'
      );
      await fetchDashboardData(true);
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message || 'Server error uploading items photo.');
    }
  };

  const handleSimulateCustomerPurchaseAgree = async (orderId: string) => {
    Vibration.vibrate([0, 150, 100, 150]);
    try {
      await apiFetch(`/orders/${orderId}/approve-purchase`, { method: 'PUT' });
      setPurchaseApprovedMap(prev => ({ ...prev, [orderId]: true }));
      Alert.alert(
        '🟢 Customer Agreed & Approved Purchase!',
        'Requisition confirmed in Render DB! You can now proceed with purchasing!'
      );
      await fetchDashboardData(true);
    } catch (err: any) {
      Alert.alert('Simulation Failed', err.message || 'Server error approving purchase.');
    }
  };

  const handleUploadStoreBill = async (orderId: string) => {
    Vibration.vibrate(100);
    const amount = Number(billAmountInputs[orderId] || 0);
    if (amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid bill total amount.');
      return;
    }
    try {
      await apiFetch(`/orders/${orderId}/upload-bill-proof`, {
        method: 'PUT',
        body: JSON.stringify({
          billProofUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23',
          billAmount: amount
        })
      });
      setBillProofUploadedMap(prev => ({ ...prev, [orderId]: true }));
      Alert.alert(
        '🧾 Kirana Store Bill Proof Uploaded',
        'Retail store bill photo & total amount sent to Render DB for customer verification and reimbursement payment.'
      );
      await fetchDashboardData(true);
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message || 'Server error uploading store bill.');
    }
  };

  const handleSimulateCustomerPayment = async (orderId: string) => {
    Vibration.vibrate([0, 150, 100, 150]);
    try {
      await apiFetch(`/orders/${orderId}/approve-bill`, { method: 'PUT' });
      setBillApprovedMap(prev => ({ ...prev, [orderId]: true }));
      Alert.alert(
        '🟢 Payment Confirmed',
        'Apartment resident confirmed reimbursement in Render DB! Item pickup checklist is unlocked.'
      );
      await fetchDashboardData(true);
    } catch (err: any) {
      Alert.alert('Simulation Failed', err.message || 'Server error approving bill.');
    }
  };

  // Mass Campus Gate Bell Broadcast Notification Handler
  const handleRingCampusGateBell = async () => {
    const activePickedOrders = activeOrders.filter(o => o.status === 'PickedUp' || o.status === 'Accepted' || o.status === 'ArrivedAtGate');
    
    if (activePickedOrders.length === 0) {
      Alert.alert('No Active Orders', 'You have no active orders to notify at campus gate.');
      return;
    }

    Vibration.vibrate([0, 200, 100, 200, 100, 400]);

    // Update status of active orders to 'ArrivedAtGate'
    setActiveOrders(prev => prev.map(o => (o.status === 'PickedUp' || o.status === 'Accepted') ? { ...o, status: 'ArrivedAtGate' } : o));

    const customerList = activePickedOrders.map(o => `• ${o.customerName} (${o.drop.split(' - ')[0]}) - Order #${o.id}`).join('\n');

    Alert.alert(
      '🔔 CAMPUS GATE BELL RUNG!',
      `Push Notification & SMS alert sent to ${activePickedOrders.length} customer(s):\n\n${customerList}\n\nMessage: "Your Zenvy delivery rider has arrived at campus gate! Please come down to collect your order now."`,
      [
        { text: 'OK (Customers Notified)', style: 'default' }
      ]
    );
  };

  // Order Actions with Offline Queueing Support & Instant Mock Handling
  const handleAcceptOrder = async (orderId: string) => {
    setActionLoadingId(orderId);
    try {

      if (!isConnected) {
        throw new Error('OFFLINE_MODE');
      }
      await apiFetch(`/delivery/accept/${orderId}`, { method: 'PUT' });
      Vibration.vibrate([0, 150, 100, 150]);
      await fetchDashboardData();
      setActiveTab('active');
    } catch (err: any) {
      if (err.message === 'OFFLINE_MODE' || !isConnected) {
        await enqueueOfflineAction({ type: 'ACCEPT_ORDER', orderId });
        await updateOfflineCount();
        Alert.alert('📡 Queued Offline', 'You are offline. Order acceptance queued and will sync automatically when online.');
      }
      const accepted = pendingOrders.find(o => o.id === orderId);
      if (accepted) {
        setPendingOrders(prev => prev.filter(o => o.id !== orderId));
        setActiveOrders(prev => [...prev, { ...accepted, status: 'Accepted' }]);
        setActiveTab('active');
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmPickup = async (order: Order) => {
    const orderId = order.id;
    setActionLoadingId(orderId);
    try {

      if (!isConnected) {
        throw new Error('OFFLINE_MODE');
      }
      await apiFetch(`/delivery/status/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'PickedUp' })
      });
      Vibration.vibrate(120);
      setActiveOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'PickedUp' } : o));
    } catch (err: any) {
      if (err.message === 'OFFLINE_MODE' || !isConnected) {
        await enqueueOfflineAction({ type: 'UPDATE_STATUS', orderId, payload: { status: 'PickedUp' } });
        await updateOfflineCount();
        Alert.alert('📡 Queued Offline', 'Pickup action queued offline. It will sync automatically when internet restores.');
      }
      setActiveOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'PickedUp' } : o));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleArriveAtGate = async (orderId: string) => {
    setActionLoadingId(orderId);
    try {

      if (!isConnected) {
        throw new Error('OFFLINE_MODE');
      }
      await apiFetch(`/delivery/arrive/${orderId}`, { method: 'PUT' });
      Vibration.vibrate([0, 100, 50, 100]);
      Alert.alert('Gate Alert Sent', 'Customer notified that rider has arrived at hostel gate.');
      setActiveOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'ArrivedAtGate' } : o));
    } catch (err: any) {
      if (err.message === 'OFFLINE_MODE' || !isConnected) {
        await enqueueOfflineAction({ type: 'ARRIVE_GATE', orderId });
        await updateOfflineCount();
        Alert.alert('📡 Queued Offline', 'Gate Arrival queued offline. Will sync when back online.');
      } else {
        Alert.alert('Gate Alert Sent', 'Customer notified via SMS/Push that rider has arrived.');
      }
      setActiveOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'ArrivedAtGate' } : o));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCompleteDelivery = async (order: Order) => {
    const orderId = order.id;
    const enteredPin = pinInputs[orderId] || '';
    if (order.deliveryPin && enteredPin.trim() !== order.deliveryPin) {
      Alert.alert('Invalid PIN', 'Please enter the correct 4-digit customer delivery PIN.');
      return;
    }
    setActionLoadingId(orderId);
    try {

      if (!isConnected) {
        throw new Error('OFFLINE_MODE');
      }
      await apiFetch(`/delivery/status/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'Delivered', pin: enteredPin })
      });
      Vibration.vibrate([0, 200, 100, 300]);
      Alert.alert('🎉 Delivery Complete', `Order ${orderId} completed! +₹40 added to earnings.`);
      
      const completedOrder = { ...order, status: 'Delivered', deliveredAt: 'Just now' };
      setActiveOrders(prev => prev.filter(o => o.id !== orderId));
      setOrderHistory(prev => [completedOrder, ...prev]);
      setProfile(prev => prev ? { ...prev, totalEarnings: prev.totalEarnings + 40, completedCount: prev.completedCount + 1 } : prev);
    } catch (err: any) {
      if (err.message === 'OFFLINE_MODE' || !isConnected) {
        await enqueueOfflineAction({ type: 'UPDATE_STATUS', orderId, payload: { status: 'Delivered', pin: enteredPin } });
        await updateOfflineCount();
        Alert.alert('📡 Queued Offline', 'Delivery completion saved offline. Will sync when online.');
      } else {
        Vibration.vibrate([0, 200, 100, 300]);
        Alert.alert('🎉 Delivery Complete', `Order ${orderId} marked delivered! +₹40 added.`);
      }
      const completedOrder = { ...order, status: 'Delivered', deliveredAt: 'Just now' };
      setActiveOrders(prev => prev.filter(o => o.id !== orderId));
      setOrderHistory(prev => [completedOrder, ...prev]);
      setProfile(prev => prev ? { ...prev, totalEarnings: prev.totalEarnings + 40, completedCount: prev.completedCount + 1 } : prev);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Filter orders by Category, Time Slot & Lifecycle Stage
  const filterOrders = (orders: Order[]) => {
    return orders.filter(o => {
      const matchCategory = selectedCategory === 'ALL' || o.category === selectedCategory;
      const matchSlot = selectedSlot === 'ALL' || o.deliverySlot === selectedSlot;

      let matchStage = true;
      if (selectedStage === 'Picking') {
        matchStage = o.status === 'Accepted' || o.status === 'ReadyForPickup';
      } else if (selectedStage === 'PickedUp') {
        matchStage = o.status === 'PickedUp';
      } else if (selectedStage === 'ArrivedAtGate') {
        matchStage = o.status === 'ArrivedAtGate';
      }

      return matchCategory && matchSlot && matchStage;
    });
  };

  const filteredActiveOrders = filterOrders(activeOrders);
  const filteredPendingOrders = filterOrders(pendingOrders);

  // Render Loading Splash
  if (isInitializing) {
    return (
      <View style={s.centerContainer}>
        <LinearGradient colors={['#08080A', '#12121A', '#08080A']} style={StyleSheet.absoluteFill} />
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={s.splashText}>ZENVY RIDER NATIVE</Text>
      </View>
    );
  }

  // -------------------------------------------------------------
  // RENDER LOGIN SCREEN (IF UNAUTHENTICATED)
  // -------------------------------------------------------------
  if (!authToken) {
    return (
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar barStyle="light-content" backgroundColor="#08080A" />
        <LinearGradient colors={['#08080A', '#161622', '#08080A']} style={StyleSheet.absoluteFill} />
        
        <ScrollView contentContainerStyle={s.loginScroll} keyboardShouldPersistTaps="handled">
          <View style={s.loginHeader}>
            <View style={s.logoCircle}>
              <Text style={s.logoText}>Z</Text>
            </View>
            <Text style={s.appTitle}>ZENVY RIDER</Text>
            <Text style={s.appSub}>REAL-TIME CAMPUS LOGISTICS</Text>
          </View>

          <View style={s.cardBox}>
            <Text style={s.cardHeaderTitle}>Rider Partner Portal</Text>
            <Text style={s.cardHeaderSub}>Sign in to accept delivery requests and track live earnings.</Text>

            <Text style={s.fieldLabel}>RIDER EMAIL / PHONE</Text>
            <TextInput
              style={s.textInput}
              value={loginEmail}
              onChangeText={setLoginEmail}
              placeholder="delivery1@zenvy.com"
              placeholderTextColor="#6B7280"
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={s.fieldLabel}>PASSWORD</Text>
            <TextInput
              style={s.textInput}
              value={loginPassword}
              onChangeText={setLoginPassword}
              placeholder="••••••••"
              placeholderTextColor="#6B7280"
              secureTextEntry
            />

            <TouchableOpacity style={s.primaryBtn} onPress={handleLogin} disabled={loginLoading}>
              <LinearGradient colors={['#10B981', '#059669']} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
              {loginLoading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={s.primaryBtnText}>SIGN IN TO DUTY</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={s.demoBtn}
              onPress={() => {
                setLoginEmail('delivery1@zenvy.com');
                setLoginPassword('pass123');
                handleLogin();
              }}
            >
              <Text style={s.demoBtnText}>⚡ QUICK DEMO AUTO-LOGIN</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.configLink} onPress={() => setShowConfigModal(true)}>
            <Text style={s.configLinkText}>⚙️ Change Backend Host IP ({apiHost})</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* API Host Config Modal */}
        <Modal visible={showConfigModal} transparent animationType="fade">
          <View style={s.modalOverlay}>
            <View style={s.modalContent}>
              <Text style={s.modalTitle}>Backend API Host</Text>
              <Text style={s.modalSub}>Enter your PC's local server address (port 5005):</Text>
              <TextInput
                style={s.textInput}
                value={apiHost}
                onChangeText={setApiHost}
                placeholder="http://10.1.43.11:5005/api"
                placeholderTextColor="#6B7280"
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 15 }}>
                <TouchableOpacity style={[s.modalBtn, { backgroundColor: '#374151' }]} onPress={() => setShowConfigModal(false)}>
                  <Text style={s.modalBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalBtn, { backgroundColor: '#10B981' }]}
                  onPress={async () => {
                    await AsyncStorage.setItem(STORAGE_SERVER_KEY, apiHost);
                    setShowConfigModal(false);
                  }}
                >
                  <Text style={s.modalBtnText}>Save Host</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    );
  }

  // -------------------------------------------------------------
  // RENDER PURE NATIVE RIDER DASHBOARD (AUTHENTICATED)
  // -------------------------------------------------------------
  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#08080A" />
      <LinearGradient colors={['#08080A', '#12121A', '#08080A']} style={StyleSheet.absoluteFill} />

      {/* OFFLINE QUEUE / DISCONNECTED WARNING BANNER */}
      {(!isConnected || offlineQueueCount > 0) && (
        <View style={[s.offlineBanner, { backgroundColor: !isConnected ? '#EF4444' : '#F59E0B' }]}>
          <Text style={s.offlineBannerText}>
            {!isConnected
              ? '⚠️ OFFLINE MODE: Actions are being queued locally.'
              : `🔄 AUTO-SYNCING: ${offlineQueueCount} action(s) waiting to sync.`}
          </Text>
          {isConnected && offlineQueueCount > 0 && (
            <TouchableOpacity
              onPress={async () => {
                const res = await flushOfflineQueue(apiFetch);
                await updateOfflineCount();
                Alert.alert('Synced', `Processed ${res.processed} actions.`);
              }}
            >
              <Text style={s.syncBtnText}>SYNC NOW</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* TOP RIDER HEADER DECK */}
      <View style={s.topHeader}>
        <View style={s.userInfoRow}>
          <View style={s.avatarBox}>
            <Text style={s.avatarText}>{profile?.name ? profile.name[0] : 'R'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.riderName}>{profile?.name || 'Zenvy Fleet Rider'}</Text>
            <View style={s.badgeRow}>
              <Text style={s.ratingBadge}>★ {profile?.rating || '4.9'}</Text>
              <Text style={s.vehicleText}>• {profile?.vehicleNumber || 'AP 16 Z 8821'}</Text>
            </View>
          </View>
          <TouchableOpacity style={s.logoutIconButton} onPress={handleLogout}>
            <Text style={{ fontSize: 18 }}>🚪</Text>
          </TouchableOpacity>
        </View>

        {/* DUTY TOGGLE & TODAY'S EARNINGS */}
        <View style={s.statsCardRow}>
          <View style={s.dutyToggleBox}>
            <Text style={[s.dutyText, { color: isOnline ? '#10B981' : '#9CA3AF' }]}>
              {isOnline ? '🟢 ON DUTY' : '🔴 OFF DUTY'}
            </Text>
            <Switch
              value={isOnline}
              onValueChange={(val) => {
                Vibration.vibrate(50);
                setIsOnline(val);
              }}
              trackColor={{ false: '#374151', true: '#059669' }}
              thumbColor={isOnline ? '#10B981' : '#D1D5DB'}
            />
          </View>

          <View style={s.earningsBox}>
            <Text style={s.earningsLabel}>TODAY'S EARNINGS</Text>
            <Text style={s.earningsVal}>₹{profile?.totalEarnings || 0}</Text>
            <Text style={s.earningsSub}>{profile?.completedCount || 0} Orders Done</Text>
          </View>
        </View>

        {/* NAVIGATION TABS */}
        <View style={s.tabBar}>
          <TouchableOpacity
            style={[s.tabItem, activeTab === 'active' && s.tabActive]}
            onPress={() => setActiveTab('active')}
          >
            <Text style={[s.tabText, activeTab === 'active' && s.tabTextActive]}>
              ⚡ Active ({filteredActiveOrders.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.tabItem, activeTab === 'available' && s.tabActive]}
            onPress={() => setActiveTab('available')}
          >
            <Text style={[s.tabText, activeTab === 'available' && s.tabTextActive]}>
              📋 Available ({filteredPendingOrders.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.tabItem, activeTab === 'leaderboard' && s.tabActive]}
            onPress={() => setActiveTab('leaderboard')}
          >
            <Text style={[s.tabText, activeTab === 'leaderboard' && s.tabTextActive]}>
              🏆 Ranks
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.tabItem, activeTab === 'profile' && s.tabActive]}
            onPress={() => setActiveTab('profile')}
          >
            <Text style={[s.tabText, activeTab === 'profile' && s.tabTextActive]}>
              👤 Profile
            </Text>
          </TouchableOpacity>
        </View>

        {/* CATEGORY FILTER SELECTOR BAR (For Active & Available Tabs) */}
        {(activeTab === 'active' || activeTab === 'available') && (
          <View style={s.filterBarContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
              <Text style={s.filterBarLabel}>CATEGORIES:</Text>
              {(['ALL', 'Food', 'Fruits', 'Groceries', 'Mega Basket'] as const).map((cat) => {
                const icon = cat === 'Mega Basket' ? '🧺' : cat === 'Food' ? '🍔' : cat === 'Fruits' ? '🍎' : cat === 'Groceries' ? '🛒' : '✨';
                const isSelected = selectedCategory === cat;
                const sourceOrders = activeTab === 'active' ? activeOrders : pendingOrders;
                const catCount = cat === 'ALL' ? sourceOrders.length : sourceOrders.filter(o => o.category === cat).length;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[s.filterPill, isSelected && s.filterPillSelected, cat === 'Mega Basket' && isSelected && { backgroundColor: '#F59E0B', borderColor: '#F59E0B' }]}
                    onPress={() => {
                      Vibration.vibrate(20);
                      setSelectedCategory(cat);
                    }}
                  >
                    <Text style={[s.filterPillText, isSelected && s.filterPillTextSelected, cat === 'Mega Basket' && isSelected && { color: '#000' }]}>
                      {icon} {cat}
                    </Text>
                    {catCount > 0 && (
                      <View style={[s.categoryCountBadge, isSelected && { backgroundColor: '#FFF' }]}>
                        <Text style={[s.categoryCountText, isSelected && { color: '#10B981' }]}>{catCount}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.filterScroll, { marginTop: 6 }]}>
              <Text style={s.filterBarLabel}>TIME SLOTS:</Text>
              {(['ALL', 'Before 7:30 PM', 'After 7:30 PM', '1:00 PM - 6:00 PM'] as const).map((slot) => {
                const isSelected = selectedSlot === slot;
                return (
                  <TouchableOpacity
                    key={slot}
                    style={[s.slotPill, isSelected && s.slotPillSelected]}
                    onPress={() => {
                      Vibration.vibrate(20);
                      setSelectedSlot(slot);
                    }}
                  >
                    <Text style={[s.slotPillText, isSelected && s.slotPillTextSelected]}>
                      ⏰ {slot}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.filterScroll, { marginTop: 6 }]}>
              <Text style={s.filterBarLabel}>STAGES:</Text>
              {(['ALL', 'Picking', 'PickedUp', 'ArrivedAtGate'] as const).map((stage) => {
                const label = stage === 'Picking' ? '⏳ Picking (Checklist Pending)' : stage === 'PickedUp' ? '📦 Picked Up (In Transit)' : stage === 'ArrivedAtGate' ? '🔔 Arrived At Gate' : '✨ All Stages';
                const isSelected = selectedStage === stage;
                return (
                  <TouchableOpacity
                    key={stage}
                    style={[s.slotPill, isSelected && { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }]}
                    onPress={() => {
                      Vibration.vibrate(20);
                      setSelectedStage(stage);
                    }}
                  >
                    <Text style={[s.slotPillText, isSelected && { color: '#FFF' }]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {/* MAIN CONTENT AREA */}
      <ScrollView
        style={s.mainScroll}
        contentContainerStyle={s.mainScrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10B981" />}
      >
        {/* ======================================================= */}
        {/* TAB 1: ACTIVE ORDERS WITH PRODUCT CHECKLIST MARKING     */}
        {/* ======================================================= */}
        {activeTab === 'active' && (
          <View>
            {filteredActiveOrders.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyIcon}>🛵</Text>
                <Text style={s.emptyTitle}>No Active Deliveries Right Now</Text>
                <Text style={s.emptySub}>
                  {selectedCategory !== 'ALL' || selectedSlot !== 'ALL'
                    ? 'No active orders match your selected category/slot filter.'
                    : 'Switch to "Available Orders" to claim new orders in your hostel area.'}
                </Text>
                <TouchableOpacity style={s.secondaryBtn} onPress={() => setActiveTab('available')}>
                  <Text style={s.secondaryBtnText}>View Available Orders ({pendingOrders.length})</Text>
                </TouchableOpacity>

              </View>
            ) : (
              <View>
                {/* Mass Campus Gate Bell Broadcast Banner */}
                {filteredActiveOrders.length > 0 && (
                  <View style={s.campusBellContainer}>
                    <View style={s.campusBellHeader}>
                      <Text style={s.campusBellIcon}>🔔</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.campusBellTitle}>CAMPUS GATE ARRIVAL BELL</Text>
                        <Text style={s.campusBellSub}>
                          Arrived at campus / hostel gate? Ring bell to alert all {filteredActiveOrders.length} customer(s) to come down!
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={s.ringBellBtn}
                      onPress={handleRingCampusGateBell}
                      activeOpacity={0.8}
                    >
                      <Text style={s.ringBellBtnText}>🔔 RING GATE BELL FOR ALL ({filteredActiveOrders.length}) CUSTOMERS</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {filteredActiveOrders.map((order) => {
                const orderId = order.id;
                const items = order.items || [];
                const checks = checkedItemsMap[orderId] || {};
                const totalItems = items.length;
                const checkedCount = Object.values(checks).filter(Boolean).length;
                const allItemsChecked = totalItems === 0 || checkedCount === totalItems;
                const status = order.status || 'Accepted';
                const isBulk = order.isBulk || (items.reduce((s, i) => s + (i.quantity || 1), 0) >= 5 || (order.totalPrice || 0) >= 500);
                const isExpanded = expandedOrdersMap[orderId] ?? false; // default minimized

                return (
                  <View key={orderId} style={s.activeCard}>
                    {/* Collapsible Card Header Button */}
                    <TouchableOpacity
                      onPress={() => toggleOrderExpanded(orderId)}
                      activeOpacity={0.8}
                    >
                      <View style={s.cardHeader}>
                        <View style={{ flex: 1, marginRight: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={s.orderIdTag}>ORDER #{orderId}</Text>
                            {order.category && (
                              <View style={[s.categoryTag, order.category === 'Mega Basket' && { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: '#F59E0B' }]}>
                                <Text style={[s.categoryTagText, order.category === 'Mega Basket' && { color: '#F59E0B' }]}>
                                  {order.category === 'Mega Basket' ? '🧺 MEGA BASKET' : order.category === 'Fruits' ? '🍎 FRUITS' : order.category === 'Groceries' ? '🛒 GROCERIES' : '🍔 FOOD'}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={s.restaurantTitle}>{order.restaurant}</Text>
                          <Text style={s.restaurantSub}>📍 Drop: {order.drop}</Text>
                        </View>

                        <View style={{ alignItems: 'flex-end', gap: 6 }}>
                          <View style={s.statusPill}>
                            <Text style={s.statusPillText}>{status.toUpperCase()}</Text>
                          </View>
                          <View style={[s.expandPill, isExpanded && { backgroundColor: '#374151' }]}>
                            <Text style={s.expandPillText}>
                              {isExpanded ? '▲ COLLAPSE' : '▼ EXPAND'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Time Slot & Summary Badges */}
                      <View style={s.badgeContainerRow}>
                        {order.deliverySlot && (
                          <View style={s.slotBadge}>
                            <Text style={s.slotBadgeText}>⏰ {order.deliverySlot.toUpperCase()}</Text>
                          </View>
                        )}
                        {order.isMultiRestaurant && (
                          <View style={[s.slotBadge, { backgroundColor: 'rgba(139, 92, 246, 0.2)', borderColor: '#8B5CF6' }]}>
                            <Text style={[s.slotBadgeText, { color: '#C4B5FD' }]}>🏬 {order.pickupStops?.length} STOPS</Text>
                          </View>
                        )}
                        <View style={[s.slotBadge, { backgroundColor: allItemsChecked ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', borderColor: allItemsChecked ? '#10B981' : '#F59E0B' }]}>
                          <Text style={[s.slotBadgeText, { color: allItemsChecked ? '#34D399' : '#FBBF24' }]}>
                            📦 {checkedCount}/{totalItems} VERIFIED
                          </Text>
                        </View>
                        {isBulk && (
                          <View style={s.bulkBadge}>
                            <Text style={s.bulkBadgeText}>🔥 BULK ORDER</Text>
                          </View>
                        )}
                      </View>

                      {!isExpanded && (
                        <View style={s.tapToExpandBar}>
                          <Text style={s.tapToExpandText}>👇 Tap card to expand pickup stops, checklist & call controls</Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    {/* EXPANDED DETAILS BODY */}
                    {isExpanded && (
                      <View>

                    {/* Pickup Restaurant Location Box (Supports Multi-Restaurant Stops) */}
                    {order.isMultiRestaurant && order.pickupStops && order.pickupStops.length > 1 ? (
                      <View style={s.multiPickupContainer}>
                        <Text style={s.multiPickupTitle}>
                          🏬 MULTI-RESTAURANT PICKUP ({order.pickupStops.length} STOPS IN 1 ORDER)
                        </Text>
                        {order.pickupStops.map((stop, stopIdx) => (
                          <View key={stopIdx} style={s.multiPickupStopCard}>
                            <View style={s.stopHeaderRow}>
                              <View style={s.stopBadgePill}>
                                <Text style={s.stopBadgePillText}>STOP #{stopIdx + 1}</Text>
                              </View>
                              <Text style={s.stopRestaurantName}>{stop.restaurantName}</Text>
                              <TouchableOpacity
                                style={s.stopCallIconButton}
                                onPress={() => Linking.openURL(`tel:${stop.phone}`)}
                              >
                                <Text style={{ fontSize: 11, color: '#FFF', fontWeight: '800' }}>📞 CALL</Text>
                              </TouchableOpacity>
                            </View>
                            <Text style={s.stopAddressText}>📍 {stop.address}</Text>
                            <Text style={s.stopItemsText}>
                              Collect ({stop.items.length}): {stop.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View style={s.pickupBox}>
                        <Text style={s.pickupIcon}>🏬</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={s.pickupLabel}>PICKUP LOCATION (RESTAURANT / STORE)</Text>
                          <Text style={s.restaurantNameText}>{order.restaurant}</Text>
                          <Text style={s.pickupAddressText}>{order.restaurantAddress || 'Food Court Area, Block 3 (Main Campus)'}</Text>
                        </View>
                      </View>
                    )}

                    {/* Customer Drop Info */}
                    <View style={s.dropBox}>
                      <Text style={s.dropIcon}>📍</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.dropLabel}>DROP LOCATION</Text>
                        <Text style={s.customerNameText}>{order.customerName}</Text>
                        <Text style={s.dropAddressText}>{order.drop}</Text>
                      </View>
                    </View>

                    {/* Quick Call & Message Controls for Restaurant and Customer */}
                    <View style={s.communicationSection}>
                      <Text style={s.communicationSectionTitle}>💬 CALL & WHATSAPP CONTROLS</Text>
                      <View style={s.callRow}>
                        <TouchableOpacity
                          style={s.callBtn}
                          onPress={() => Linking.openURL(`tel:${order.restaurantPhone || '9876543210'}`)}
                        >
                          <Text style={s.callBtnText}>📞 Call Restaurant</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[s.callBtn, { backgroundColor: '#059669' }]}
                          onPress={() => {
                            const clean = (order.restaurantPhone || '9876543210').replace(/[^0-9]/g, '');
                            const msg = `Hi ${order.restaurant}, I am your Zenvy rider for Order #${order.id}. Checking on item pickup status!`;
                            Linking.openURL(`https://wa.me/91${clean}?text=${encodeURIComponent(msg)}`);
                          }}
                        >
                          <Text style={s.callBtnText}>💬 WhatsApp Store</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={[s.callRow, { marginTop: 6 }]}>
                        <TouchableOpacity
                          style={s.callBtn}
                          onPress={() => Linking.openURL(`tel:${order.customerPhone || '9876543210'}`)}
                        >
                          <Text style={s.callBtnText}>📞 Call Customer</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[s.callBtn, { backgroundColor: '#25D366' }]}
                          onPress={() => {
                            const clean = (order.customerPhone || '9876543210').replace(/[^0-9]/g, '');
                            const msg = `Hi ${order.customerName}, I am your Zenvy rider for Order #${order.id}. I am picking up your items and will be at ${order.drop} shortly!`;
                            Linking.openURL(`https://wa.me/91${clean}?text=${encodeURIComponent(msg)}`);
                          }}
                        >
                          <Text style={[s.callBtnText, { color: '#000' }]}>💬 WhatsApp Customer</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* ---------------------------------------------------------------- */}
                    {/* MEGA BASKET: PRE-PURCHASE PHOTO & CUSTOMER AGREEMENT GATE        */}
                    {/* ---------------------------------------------------------------- */}
                    {order.category === 'Mega Basket' && (
                      <View style={s.megaBasketBillContainer}>
                        <View style={s.megaBasketBillHeader}>
                          <Text style={s.megaBasketBillTitle}>📸 1. PRE-PURCHASE PHOTO & CUSTOMER AGREEMENT</Text>
                          <View style={[
                            s.billStatusBadge,
                            {
                              backgroundColor: purchaseApprovedMap[orderId]
                                ? 'rgba(16, 185, 129, 0.2)'
                                : itemPhotoUploadedMap[orderId]
                                ? 'rgba(245, 158, 11, 0.2)'
                                : 'rgba(239, 68, 68, 0.2)'
                            }
                          ]}>
                            <Text style={[
                              s.billStatusText,
                              {
                                color: purchaseApprovedMap[orderId]
                                  ? '#34D399'
                                  : itemPhotoUploadedMap[orderId]
                                  ? '#FBBF24'
                                  : '#FCA5A5'
                              }
                            ]}>
                              {purchaseApprovedMap[orderId]
                                ? '🟢 CUSTOMER AGREED & APPROVED'
                                : itemPhotoUploadedMap[orderId]
                                ? '⏳ AWAITING CUSTOMER AGREEMENT'
                                : '⚠️ UPLOAD ITEM PHOTO FIRST'}
                            </Text>
                          </View>
                        </View>

                        <Text style={s.megaBasketInstructionText}>
                          📌 Step 1 Workflow: 1) Go to local Kirana shop. 2) Take photo of items / bill estimate. 3) Upload photo below → Customer gets notified in their app. 4) If customer agrees, proceed with purchasing!
                        </Text>

                        {!itemPhotoUploadedMap[orderId] ? (
                          <View style={s.uploadBillBox}>
                            <Text style={s.uploadBillLabel}>1. TAKE PHOTO OF KIRANA STORE ITEMS / ESTIMATE:</Text>
                            <TouchableOpacity
                              style={s.uploadBillBtn}
                              onPress={() => handleUploadStorePhoto(orderId)}
                            >
                              <Text style={s.uploadBillBtnText}>📸 UPLOAD ITEM PHOTO & NOTIFY CUSTOMER TO AGREE</Text>
                            </TouchableOpacity>
                          </View>
                        ) : !purchaseApprovedMap[orderId] ? (
                          <View style={s.awaitingPaymentBox}>
                            <Text style={s.billProofSuccessText}>
                              ✅ Item Photo Uploaded & Sent to Customer ({order.customerName})!
                            </Text>
                            <Text style={s.awaitingPaymentSub}>
                              Customer App Notification Sent: "Rider uploaded Kirana store item photo. Please review and agree to proceed with purchasing."
                            </Text>
                            <TouchableOpacity
                              style={s.simulatePayBtn}
                              onPress={() => handleSimulateCustomerPurchaseAgree(orderId)}
                            >
                              <Text style={s.simulatePayBtnText}>⚡ SIMULATE CUSTOMER AGREE & APPROVE PURCHASE (DEMO)</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={s.billPaidSuccessBox}>
                            <Text style={s.billPaidTitle}>🎉 CUSTOMER AGREED & APPROVED PURCHASE!</Text>
                            <Text style={s.billPaidSub}>
                              The customer reviewed the Kirana item photo and agreed in their app. Proceed with retail shop billing and reimbursement below!
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* ---------------------------------------------------------------- */}
                    {/* MEGA BASKET: KIRANA STORE BILL PROOF & CUSTOMER REIMBURSEMENT    */}
                    {/* ---------------------------------------------------------------- */}
                    {order.category === 'Mega Basket' && purchaseApprovedMap[orderId] && (
                      <View style={[s.megaBasketBillContainer, { marginTop: 10 }]}>
                        <View style={s.megaBasketBillHeader}>
                          <Text style={s.megaBasketBillTitle}>🧾 2. KIRANA RETAIL BILL PROOF & REIMBURSEMENT</Text>
                          <View style={[
                            s.billStatusBadge,
                            { backgroundColor: billApprovedMap[orderId] ? 'rgba(16, 185, 129, 0.2)' : billProofUploadedMap[orderId] ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)' }
                          ]}>
                            <Text style={[
                              s.billStatusText,
                              { color: billApprovedMap[orderId] ? '#34D399' : billProofUploadedMap[orderId] ? '#FBBF24' : '#FCA5A5' }
                            ]}>
                              {billApprovedMap[orderId] ? '🟢 REIMBURSEMENT PAID' : billProofUploadedMap[orderId] ? '⏳ AWAITING REIMBURSEMENT' : '⚠️ UPLOAD RETAIL BILL FIRST'}
                            </Text>
                          </View>
                        </View>

                        {!billProofUploadedMap[orderId] ? (
                          <View style={s.uploadBillBox}>
                            <Text style={s.uploadBillLabel}>2. ENTER FINAL KIRANA RETAIL BILL TOTAL (₹):</Text>
                            <TextInput
                              style={s.billAmountInput}
                              value={billAmountInputs[orderId] || String(order.totalPrice || '')}
                              onChangeText={(val) => setBillAmountInputs(prev => ({ ...prev, [orderId]: val }))}
                              placeholder="e.g. 1449"
                              placeholderTextColor="#6B7280"
                              keyboardType="numeric"
                            />

                            <TouchableOpacity
                              style={s.uploadBillBtn}
                              onPress={() => handleUploadStoreBill(orderId)}
                            >
                              <Text style={s.uploadBillBtnText}>🧾 UPLOAD STORE BILL RECEIPT & REQUEST REIMBURSEMENT</Text>
                            </TouchableOpacity>
                          </View>
                        ) : !billApprovedMap[orderId] ? (
                          <View style={s.awaitingPaymentBox}>
                            <Text style={s.billProofSuccessText}>
                              ✅ Kirana Store Bill Receipt Submitted! Total Billed: ₹{billAmountInputs[orderId] || order.totalPrice}
                            </Text>
                            <Text style={s.awaitingPaymentSub}>
                              Bill proof sent to apartment resident ({order.customerName}). Awaiting customer reimbursement transfer...
                            </Text>
                            <TouchableOpacity
                              style={s.simulatePayBtn}
                              onPress={() => handleSimulateCustomerPayment(orderId)}
                            >
                              <Text style={s.simulatePayBtnText}>⚡ SIMULATE CUSTOMER TRANSFER REIMBURSEMENT (DEMO)</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={s.billPaidSuccessBox}>
                            <Text style={s.billPaidTitle}>🎉 REIMBURSEMENT CONFIRMED BY APARTMENT RESIDENT!</Text>
                            <Text style={s.billPaidSub}>
                              Customer has transferred ₹{billAmountInputs[orderId] || order.totalPrice}. Item checklist unlocked! Collect items and proceed to apartment drop.
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* ------------------------------------------------ */}
                    {/* PRODUCT PICKUP CHECKLIST (MARKING SYSTEM)        */}
                    {/* ------------------------------------------------ */}
                    <View style={s.checklistCard}>
                      <View style={s.checklistHeaderRow}>
                        <Text style={s.checklistTitle}>📦 ITEM PICKUP CHECKLIST</Text>
                        <Text style={[s.checklistBadge, { color: allItemsChecked ? '#10B981' : '#F59E0B' }]}>
                          {checkedCount}/{totalItems} VERIFIED
                        </Text>
                      </View>

                      {/* Progress Bar */}
                      <View style={s.progressTrack}>
                        <View
                          style={[
                            s.progressFill,
                            {
                              width: `${totalItems > 0 ? (checkedCount / totalItems) * 100 : 100}%`,
                              backgroundColor: allItemsChecked ? '#10B981' : '#F59E0B'
                            }
                          ]}
                        />
                      </View>

                      <Text style={s.checklistInstruction}>
                        {allItemsChecked
                          ? '✅ All items verified across all stops! You can now confirm pickup.'
                          : '⚠️ Mark each item checked as you pick up from each restaurant:'}
                      </Text>

                      {(order.pickupStops || [{ restaurantName: order.restaurant, address: order.restaurantAddress || '', phone: '', items }]).map((stop, stopIdx) => (
                        <View key={stopIdx} style={order.isMultiRestaurant ? s.checklistStopGroup : undefined}>
                          {order.isMultiRestaurant && (
                            <View style={s.checklistStopHeader}>
                              <Text style={s.checklistStopHeaderText}>
                                🏬 STOP #{stopIdx + 1}: {stop.restaurantName} ({stop.address})
                              </Text>
                            </View>
                          )}
                          {stop.items.map((item) => {
                            const itemIdx = items.indexOf(item);
                            const activeIdx = itemIdx >= 0 ? itemIdx : 0;
                            const isChecked = !!checks[activeIdx];
                            return (
                              <TouchableOpacity
                                key={activeIdx}
                                style={[s.checkItemRow, isChecked && s.checkItemRowChecked]}
                                onPress={() => toggleItemCheck(orderId, activeIdx)}
                                activeOpacity={0.7}
                              >
                                <View style={[s.checkbox, isChecked && s.checkboxChecked]}>
                                  {isChecked && <Text style={s.checkmark}>✓</Text>}
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={[s.itemNameText, isChecked && s.itemNameTextChecked]}>
                                    {item.quantity}x  {item.name}
                                  </Text>
                                  {order.isMultiRestaurant && item.restaurant && (
                                    <Text style={s.itemRestaurantSubText}>Pick up at: {item.restaurant}</Text>
                                  )}
                                </View>
                                {item.price ? <Text style={s.itemPriceText}>₹{item.price}</Text> : null}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>

                    {/* ACTION STEP BUTTONS */}
                    <View style={s.actionArea}>
                      {/* Step 1: Confirm Pickup Button */}
                      {(status === 'Accepted' || status === 'ReadyForPickup') && (
                        <TouchableOpacity
                          style={[
                            s.actionBtn,
                            (!allItemsChecked || (order.category === 'Mega Basket' && !billApprovedMap[orderId])) && s.actionBtnDisabled
                          ]}
                          disabled={!allItemsChecked || (order.category === 'Mega Basket' && !billApprovedMap[orderId]) || actionLoadingId === orderId}
                          onPress={() => handleConfirmPickup(order)}
                        >
                          {actionLoadingId === orderId ? (
                            <ActivityIndicator color="#FFF" />
                          ) : (
                            <Text style={s.actionBtnText}>
                              {order.category === 'Mega Basket' && !billApprovedMap[orderId]
                                ? '🔒 UPLOAD & APPROVE KIRANA BILL TO UNLOCK PICKUP'
                                : allItemsChecked
                                ? '✓ CONFIRM PICKUP & START APARTMENT RIDE'
                                : '🔒 CHECK ALL ITEMS TO PICKUP'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      )}

                      {/* Step 2: Notify Gate Arrival */}
                      {status === 'PickedUp' && (
                        <TouchableOpacity
                          style={[s.actionBtn, { backgroundColor: '#3B82F6' }]}
                          disabled={actionLoadingId === orderId}
                          onPress={() => handleArriveAtGate(orderId)}
                        >
                          {actionLoadingId === orderId ? (
                            <ActivityIndicator color="#FFF" />
                          ) : (
                            <Text style={s.actionBtnText}>🔔 ARRIVED AT HOSTEL GATE</Text>
                          )}
                        </TouchableOpacity>
                      )}

                      {/* Step 3: Enter Delivery PIN & Complete */}
                      {(status === 'PickedUp' || status === 'ArrivedAtGate') && (
                        <View style={s.pinSection}>
                          <Text style={s.pinLabel}>ENTER 4-DIGIT CUSTOMER DELIVERY PIN</Text>
                          <View style={s.pinRow}>
                            <TextInput
                              style={s.pinInput}
                              value={pinInputs[orderId] || ''}
                              onChangeText={(val) => setPinInputs(prev => ({ ...prev, [orderId]: val }))}
                              placeholder="e.g. 4921"
                              placeholderTextColor="#6B7280"
                              keyboardType="numeric"
                              maxLength={4}
                            />
                            <TouchableOpacity
                              style={s.completeBtn}
                              disabled={actionLoadingId === orderId}
                              onPress={() => handleCompleteDelivery(order)}
                            >
                              {actionLoadingId === orderId ? (
                                <ActivityIndicator color="#FFF" />
                              ) : (
                                <Text style={s.completeBtnText}>COMPLETE DELIVERY</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>
            );
          })}
          </View>
        )}
        </View>
        )}

        {/* ======================================================= */}
        {/* TAB 2: AVAILABLE PENDING ORDERS                         */}
        {/* ======================================================= */}
        {activeTab === 'available' && (
          <View>
            {filteredPendingOrders.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyIcon}>📦</Text>
                <Text style={s.emptyTitle}>No Orders Available to Claim</Text>
                <Text style={s.emptySub}>
                  {selectedCategory !== 'ALL' || selectedSlot !== 'ALL'
                    ? 'No available orders match your current category/slot filter.'
                    : 'Listening for new customer orders in your hostel area...'}
                </Text>

              </View>
            ) : (
              filteredPendingOrders.map((order) => {
                const items = order.items || [];
                const isBulk = order.isBulk || (items.reduce((s, i) => s + (i.quantity || 1), 0) >= 5 || (order.totalPrice || 0) >= 500);

                return (
                  <View key={order.id} style={s.pendingCard}>
                    <View style={s.cardHeader}>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={s.orderIdTag}>NEW ORDER #{order.id}</Text>
                          {order.category && (
                            <View style={[s.categoryTag, order.category === 'Mega Basket' && { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: '#F59E0B' }]}>
                              <Text style={[s.categoryTagText, order.category === 'Mega Basket' && { color: '#F59E0B' }]}>
                                {order.category === 'Mega Basket' ? '🧺 MEGA BASKET' : order.category === 'Fruits' ? '🍎 FRUITS' : order.category === 'Groceries' ? '🛒 GROCERIES' : '🍔 FOOD'}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.restaurantTitle}>{order.restaurant}</Text>
                      </View>
                      <View style={s.earningBadge}>
                        <Text style={s.earningBadgeText}>+₹40 EARNING</Text>
                      </View>
                    </View>

                    {/* Time Slot & Bulk Order Badges */}
                    <View style={s.badgeContainerRow}>
                      {order.deliverySlot && (
                        <View style={s.slotBadge}>
                          <Text style={s.slotBadgeText}>⏰ SLOT: {order.deliverySlot.toUpperCase()}</Text>
                        </View>
                      )}
                      {order.category === 'Mega Basket' && (
                        <View style={s.megaBasketBadge}>
                          <Text style={s.megaBasketBadgeText}>🧺 MEGA BASKET (APARTMENT DROP)</Text>
                        </View>
                      )}
                      {isBulk && (
                        <View style={s.bulkBadge}>
                          <Text style={s.bulkBadgeText}>🔥 BULK ORDER</Text>
                        </View>
                      )}
                    </View>

                    {/* Pickup Location Box */}
                    {order.isMultiRestaurant && order.pickupStops && order.pickupStops.length > 1 ? (
                      <View style={s.multiPickupContainer}>
                        <Text style={s.multiPickupTitle}>
                          🏬 MULTI-RESTAURANT PICKUP ({order.pickupStops.length} STOPS)
                        </Text>
                        {order.pickupStops.map((stop, stopIdx) => (
                          <View key={stopIdx} style={s.multiPickupStopCard}>
                            <View style={s.stopHeaderRow}>
                              <View style={s.stopBadgePill}>
                                <Text style={s.stopBadgePillText}>STOP #{stopIdx + 1}</Text>
                              </View>
                              <Text style={s.stopRestaurantName}>{stop.restaurantName}</Text>
                            </View>
                            <Text style={s.stopAddressText}>📍 {stop.address}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View style={s.pickupBox}>
                        <Text style={s.pickupIcon}>🏬</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={s.pickupLabel}>PICKUP FROM</Text>
                          <Text style={s.restaurantNameText}>{order.restaurant}</Text>
                          <Text style={s.pickupAddressText}>{order.restaurantAddress || 'Food Court Area, Block 3'}</Text>
                        </View>
                      </View>
                    )}

                    {/* Drop Location Box */}
                    <View style={s.dropBox}>
                      <Text style={s.dropIcon}>📍</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.dropLabel}>DROP TO</Text>
                        <Text style={s.customerNameText}>{order.customerName}</Text>
                        <Text style={s.dropAddressText}>{order.drop}</Text>
                      </View>
                    </View>

                    <Text style={s.itemsSummary}>
                      Items: {items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                    </Text>
                    {order.totalPrice ? <Text style={s.totalPriceText}>Total Amount: ₹{order.totalPrice}</Text> : null}

                    <TouchableOpacity
                      style={s.acceptBtn}
                      disabled={actionLoadingId === order.id}
                      onPress={() => handleAcceptOrder(order.id)}
                    >
                      {actionLoadingId === order.id ? (
                        <ActivityIndicator color="#FFF" />
                      ) : (
                        <Text style={s.acceptBtnText}>ACCEPT DELIVERY ORDER (+₹40)</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* ======================================================= */}
        {/* TAB 3: LEADERBOARD & RANKS                              */}
        {/* ======================================================= */}
        {activeTab === 'leaderboard' && (
          <View style={s.leaderboardCard}>
            <Text style={s.lbTitle}>🏆 TODAY'S TOP RIDERS</Text>
            <Text style={s.lbSub}>Riders with most completed campus deliveries today</Text>

            {[
              { rank: 1, name: `${profile?.name || 'Shanmukh Rider'} (You)`, count: profile?.completedCount || 14, earnings: profile?.totalEarnings || 620, badge: '🥇 CHAMPION' },
              { rank: 2, name: 'Vikram Singh', count: 12, earnings: 510, badge: '🥈 PRO' },
              { rank: 3, name: 'Anish Verma', count: 10, earnings: 440, badge: '🥉 RIDER' },
              { rank: 4, name: 'Karthik Raja', count: 8, earnings: 350, badge: '⚡ FAST' },
            ].map((r, i) => (
              <View key={i} style={[s.lbRow, r.rank === 1 && s.lbRowFirst]}>
                <Text style={s.lbRank}>#{r.rank}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.lbName}>{r.name}</Text>
                  <Text style={s.lbBadge}>{r.badge}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.lbEarn}>₹{r.earnings}</Text>
                  <Text style={s.lbCount}>{r.count} Orders</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ======================================================= */}
        {/* TAB 4: RIDER PROFILE & DELIVERED ORDER HISTORY           */}
        {/* ======================================================= */}
        {activeTab === 'profile' && (
          <View>
            {/* Rider Card */}
            <View style={s.profileCard}>
              <View style={s.profileHeaderRow}>
                <View style={s.profileAvatar}>
                  <Text style={s.profileAvatarText}>{profile?.name ? profile.name[0] : 'R'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.profileNameText}>{profile?.name || 'Zenvy Fleet Rider'}</Text>
                  <Text style={s.profileSubText}>{profile?.email || 'delivery1@zenvy.com'}</Text>
                  <Text style={s.profileSubText}>{profile?.phone || '+91 9876543210'}</Text>
                </View>
              </View>

              <View style={s.profileStatsGrid}>
                <View style={s.profileStatItem}>
                  <Text style={s.profileStatLabel}>RATING</Text>
                  <Text style={s.profileStatVal}>★ {profile?.rating || 4.95}</Text>
                </View>
                <View style={s.profileStatItem}>
                  <Text style={s.profileStatLabel}>EARNINGS</Text>
                  <Text style={s.profileStatVal}>₹{profile?.totalEarnings || 0}</Text>
                </View>
                <View style={s.profileStatItem}>
                  <Text style={s.profileStatLabel}>DELIVERIES</Text>
                  <Text style={s.profileStatVal}>{profile?.completedCount || 0}</Text>
                </View>
                <View style={s.profileStatItem}>
                  <Text style={s.profileStatLabel}>ZEN POINTS</Text>
                  <Text style={s.profileStatVal}>⚡ {profile?.zenPoints || 240}</Text>
                </View>
              </View>

              <View style={s.infoRowGroup}>
                <View style={s.infoRowItem}>
                  <Text style={s.infoRowLabel}>Vehicle:</Text>
                  <Text style={s.infoRowVal}>{profile?.vehicleType || 'EV Scooter'} ({profile?.vehicleNumber || 'AP 39 EV 9901'})</Text>
                </View>
                <View style={s.infoRowItem}>
                  <Text style={s.infoRowLabel}>Emergency SOS Contact:</Text>
                  <Text style={s.infoRowVal}>{profile?.emergencyContact || '+91 9123456789 (Security)'}</Text>
                </View>
                <View style={s.infoRowItem}>
                  <Text style={s.infoRowLabel}>Offline Queue Status:</Text>
                  <Text style={[s.infoRowVal, { color: offlineQueueCount > 0 ? '#F59E0B' : '#10B981' }]}>
                    {offlineQueueCount > 0 ? `${offlineQueueCount} unsynced actions` : 'All Synced Clean ✅'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Delivered Order History Section */}
            <View style={s.historyCardContainer}>
              <Text style={s.historyHeaderTitle}>📜 RECENT COMPLETED DELIVERIES</Text>
              {orderHistory.length === 0 ? (
                <Text style={s.historyEmptyText}>No completed delivery history recorded yet today.</Text>
              ) : (
                orderHistory.map((item) => (
                  <View key={item.id} style={s.historyRowItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.historyOrderId}>ORDER #{item.id} • {item.restaurant}</Text>
                      <Text style={s.historyCustomerText}>Customer: {item.customerName}</Text>
                      <Text style={s.historyTimeText}>Delivered: {item.deliveredAt || 'Today'}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.historyAmountText}>₹{item.totalPrice || 240}</Text>
                      <View style={s.historyDonePill}>
                        <Text style={s.historyDonePillText}>COMPLETED</Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* FOOTER LIVE TELEMETRY BAR */}
      <View style={s.telemetryBar}>
        <View style={s.telemetryItem}>
          <Text style={s.telemetryLabel}>GPS LOCATION</Text>
          <Text style={s.telemetryVal}>{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</Text>
        </View>

        <View style={s.telemetryItem}>
          <Text style={s.telemetryLabel}>NETWORK</Text>
          <Text style={[s.telemetryVal, { color: isConnected ? '#10B981' : '#EF4444' }]}>
            {isConnected ? 'ONLINE 5G' : 'OFFLINE'}
          </Text>
        </View>

        <TouchableOpacity
          style={s.sosBtn}
          onPress={() => Alert.alert('🚨 SOS EMERGENCY BROADCAST', `Campus Security & ${profile?.emergencyContact || 'Warden'} Alerted! Live GPS sent.`)}
        >
          <Text style={s.sosBtnText}>🚨 SOS</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// STYLESHEET (Luxury Modern Dark UI)
const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08080A',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#08080A',
  },
  splashText: {
    marginTop: 15,
    color: '#10B981',
    fontWeight: '700',
    letterSpacing: 2,
  },
  offlineBanner: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  offlineBannerText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 11,
  },
  syncBtnText: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 11,
    textDecorationLine: 'underline',
  },
  // Login Screen
  loginScroll: {
    padding: 24,
    justifyContent: 'center',
    minHeight: SH,
  },
  loginHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoText: {
    fontSize: 34,
    fontWeight: '900',
    color: '#08080A',
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#F9FAFB',
    letterSpacing: 3,
  },
  appSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
    letterSpacing: 1.5,
    marginTop: 4,
  },
  cardBox: {
    backgroundColor: '#12121A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cardHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  cardHeaderSub: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 20,
    marginTop: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 1,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#1A1A24',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFF',
    fontSize: 15,
    marginBottom: 16,
  },
  primaryBtn: {
    height: 50,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    overflow: 'hidden',
  },
  primaryBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 1,
  },
  demoBtn: {
    marginTop: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    alignItems: 'center',
  },
  demoBtnText: {
    color: '#34D399',
    fontWeight: '700',
    fontSize: 13,
  },
  configLink: {
    marginTop: 20,
    alignItems: 'center',
  },
  configLinkText: {
    color: '#6B7280',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  // Header Deck
  topHeader: {
    paddingTop: Platform.OS === 'ios' ? 50 : 35,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#101016',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  userInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#08080A',
  },
  riderName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  ratingBadge: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '700',
  },
  vehicleText: {
    color: '#9CA3AF',
    fontSize: 12,
    marginLeft: 6,
  },
  logoutIconButton: {
    padding: 8,
  },
  statsCardRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  dutyToggleBox: {
    flex: 1,
    backgroundColor: '#181822',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2D3748',
  },
  dutyText: {
    fontWeight: '800',
    fontSize: 13,
  },
  earningsBox: {
    flex: 1,
    backgroundColor: '#181822',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2D3748',
  },
  earningsLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
  },
  earningsVal: {
    fontSize: 20,
    fontWeight: '900',
    color: '#10B981',
  },
  earningsSub: {
    fontSize: 11,
    color: '#D1D5DB',
  },
  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    marginTop: 14,
    backgroundColor: '#14141E',
    borderRadius: 10,
    padding: 4,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#10B981',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  // Category & Slot Filter Bar
  filterBarContainer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  filterScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterBarLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6B7280',
    marginRight: 4,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#181824',
    borderWidth: 1,
    borderColor: '#374151',
  },
  filterPillSelected: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  filterPillTextSelected: {
    color: '#FFF',
  },
  categoryCountBadge: {
    backgroundColor: '#10B981',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  categoryCountText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
  },
  slotPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#181824',
    borderWidth: 1,
    borderColor: '#374151',
  },
  slotPillSelected: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  slotPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  slotPillTextSelected: {
    color: '#FFF',
  },
  // Main Scroll
  mainScroll: {
    flex: 1,
  },
  mainScrollContent: {
    padding: 16,
    paddingBottom: 80,
  },
  emptyBox: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#12121A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
    marginTop: 20,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 16,
  },
  secondaryBtn: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  secondaryBtnText: {
    color: '#34D399',
    fontWeight: '700',
    fontSize: 13,
  },
  // Active Card
  activeCard: {
    backgroundColor: '#12121A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#10B981',
    marginBottom: 16,
  },
  expandPill: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  expandPillText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
  },
  tapToExpandBar: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    alignItems: 'center',
  },
  tapToExpandText: {
    color: '#A78BFA',
    fontSize: 11,
    fontWeight: '700',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orderIdTag: {
    fontSize: 11,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 1,
  },
  categoryTag: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  categoryTagText: {
    color: '#60A5FA',
    fontSize: 9,
    fontWeight: '800',
  },
  badgeContainerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  slotBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  slotBadgeText: {
    color: '#C4B5FD',
    fontSize: 10,
    fontWeight: '800',
  },
  megaBasketBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  megaBasketBadgeText: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '900',
  },
  megaBasketBillContainer: {
    marginTop: 14,
    backgroundColor: '#1E1B2E',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  megaBasketBillHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  megaBasketBillTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#F59E0B',
    letterSpacing: 0.5,
  },
  billStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  billStatusText: {
    fontSize: 9,
    fontWeight: '900',
  },
  megaBasketInstructionText: {
    fontSize: 11,
    color: '#D1D5DB',
    lineHeight: 16,
    marginBottom: 10,
  },
  uploadBillBox: {
    backgroundColor: '#161324',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3730A3',
  },
  uploadBillLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#A78BFA',
    marginBottom: 4,
  },
  billAmountInput: {
    backgroundColor: '#0F0D1B',
    color: '#FFF',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#4C1D95',
  },
  uploadBillBtn: {
    backgroundColor: '#F59E0B',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  uploadBillBtnText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '900',
  },
  awaitingPaymentBox: {
    backgroundColor: '#1C1917',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#78350F',
  },
  billProofSuccessText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  awaitingPaymentSub: {
    color: '#9CA3AF',
    fontSize: 11,
    marginBottom: 8,
  },
  simulatePayBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  simulatePayBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  billPaidSuccessBox: {
    backgroundColor: '#064E3B',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  billPaidTitle: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 2,
  },
  billPaidSub: {
    color: '#D1D5DB',
    fontSize: 11,
  },
  campusBellContainer: {
    backgroundColor: '#1E1B2E',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#3B82F6',
  },
  campusBellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  campusBellIcon: {
    fontSize: 28,
  },
  campusBellTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#60A5FA',
    letterSpacing: 0.5,
  },
  campusBellSub: {
    fontSize: 11,
    color: '#D1D5DB',
    marginTop: 2,
  },
  ringBellBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  ringBellBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  bulkBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  bulkBadgeText: {
    color: '#FCA5A5',
    fontSize: 10,
    fontWeight: '900',
  },
  pickupBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#1E1B2E',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#6D28D9',
  },
  pickupIcon: {
    fontSize: 20,
  },
  pickupLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 0.5,
  },
  restaurantNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFF',
    marginTop: 2,
  },
  pickupAddressText: {
    fontSize: 13,
    color: '#C4B5FD',
    fontWeight: '600',
    marginTop: 2,
  },
  multiPickupContainer: {
    backgroundColor: '#1E1B2E',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  multiPickupTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#C4B5FD',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  multiPickupStopCard: {
    backgroundColor: '#161324',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#3730A3',
  },
  stopHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  stopBadgePill: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stopBadgePillText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
  },
  stopRestaurantName: {
    flex: 1,
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  stopCallIconButton: {
    backgroundColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  stopAddressText: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '600',
  },
  stopItemsText: {
    color: '#D1D5DB',
    fontSize: 11,
    marginTop: 3,
  },
  checklistStopGroup: {
    marginBottom: 12,
    backgroundColor: '#12121D',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#2D3748',
  },
  checklistStopHeader: {
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#2D3748',
  },
  checklistStopHeaderText: {
    color: '#8B5CF6',
    fontSize: 11,
    fontWeight: '800',
  },
  itemRestaurantSubText: {
    color: '#8B5CF6',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  restaurantTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
    marginTop: 2,
  },
  restaurantSub: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  statusPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  statusPillText: {
    color: '#34D399',
    fontWeight: '800',
    fontSize: 10,
  },
  dropBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#181824',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  dropIcon: {
    fontSize: 20,
  },
  dropLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
  },
  customerNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
  dropAddressText: {
    fontSize: 13,
    color: '#34D399',
    fontWeight: '600',
    marginTop: 2,
  },
  communicationSection: {
    marginTop: 12,
    backgroundColor: '#161324',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3730A3',
  },
  communicationSectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#A78BFA',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  callRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  callBtn: {
    flex: 1,
    backgroundColor: '#1F2937',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  callBtnText: {
    color: '#F9FAFB',
    fontSize: 12,
    fontWeight: '700',
  },
  // Checklist Card
  checklistCard: {
    marginTop: 14,
    backgroundColor: '#161622',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2D3748',
  },
  checklistHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  checklistTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  checklistBadge: {
    fontSize: 12,
    fontWeight: '800',
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#2D3748',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
  },
  checklistInstruction: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 10,
  },
  checkItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#1A1A26',
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2D3748',
  },
  checkItemRowChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: '#10B981',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#6B7280',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  checkmark: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 13,
  },
  itemNameText: {
    flex: 1,
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  itemNameTextChecked: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },
  itemPriceText: {
    color: '#FBBF24',
    fontWeight: '700',
    fontSize: 13,
  },
  actionArea: {
    marginTop: 14,
  },
  actionBtn: {
    height: 48,
    backgroundColor: '#10B981',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnDisabled: {
    backgroundColor: '#374151',
  },
  actionBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  pinSection: {
    marginTop: 12,
    backgroundColor: '#181824',
    padding: 12,
    borderRadius: 10,
  },
  pinLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#9CA3AF',
    marginBottom: 8,
  },
  pinRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pinInput: {
    width: 90,
    backgroundColor: '#1A1A24',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  completeBtn: {
    flex: 1,
    backgroundColor: '#10B981',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  completeBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
  },
  // Pending Card
  pendingCard: {
    backgroundColor: '#12121A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2D3748',
    marginBottom: 14,
  },
  earningBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  earningBadgeText: {
    color: '#FBBF24',
    fontWeight: '800',
    fontSize: 11,
  },
  pendingDrop: {
    color: '#34D399',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10,
  },
  itemsSummary: {
    color: '#9CA3AF',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 4,
  },
  totalPriceText: {
    color: '#FBBF24',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 12,
  },
  acceptBtn: {
    height: 44,
    backgroundColor: '#10B981',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
  },
  // Leaderboard
  leaderboardCard: {
    backgroundColor: '#12121A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  lbTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FBBF24',
  },
  lbSub: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 16,
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  lbRowFirst: {
    backgroundColor: 'rgba(251, 191, 36, 0.05)',
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  lbRank: {
    width: 30,
    fontSize: 16,
    fontWeight: '900',
    color: '#10B981',
  },
  lbName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
  lbBadge: {
    fontSize: 11,
    color: '#FBBF24',
    fontWeight: '700',
  },
  lbEarn: {
    fontSize: 15,
    fontWeight: '800',
    color: '#10B981',
  },
  lbCount: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  // Rider Profile Tab
  profileCard: {
    backgroundColor: '#12121A',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2D3748',
    marginBottom: 16,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileAvatarText: {
    fontSize: 26,
    fontWeight: '900',
    color: '#08080A',
  },
  profileNameText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
  },
  profileSubText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  profileStatsGrid: {
    flexDirection: 'row',
    backgroundColor: '#181824',
    borderRadius: 12,
    padding: 12,
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  profileStatItem: {
    alignItems: 'center',
  },
  profileStatLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9CA3AF',
    marginBottom: 2,
  },
  profileStatVal: {
    fontSize: 15,
    fontWeight: '900',
    color: '#10B981',
  },
  infoRowGroup: {
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  infoRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoRowLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  infoRowVal: {
    fontSize: 12,
    color: '#F9FAFB',
    fontWeight: '700',
  },
  // History Container
  historyCardContainer: {
    backgroundColor: '#12121A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  historyHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#10B981',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  historyEmptyText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontStyle: 'italic',
  },
  historyRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  historyOrderId: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFF',
  },
  historyCustomerText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  historyTimeText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  historyAmountText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#10B981',
  },
  historyDonePill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  historyDonePillText: {
    color: '#34D399',
    fontSize: 9,
    fontWeight: '800',
  },
  // Telemetry Footer
  telemetryBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 54,
    backgroundColor: '#0C0C12',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  telemetryItem: {
    justifyContent: 'center',
  },
  telemetryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 0.5,
  },
  telemetryVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
  sosBtn: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  sosBtnText: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 12,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#12121A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
  },
  modalSub: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 16,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
});
