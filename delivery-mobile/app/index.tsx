import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Animated, 
  Dimensions, 
  KeyboardAvoidingView, 
  Platform, 
  Alert,
  Linking,
  ScrollView,
  StatusBar
} from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const { width: SW, height: SH } = Dimensions.get('window');

const STORAGE_KEY = '@zenvy_rider_server_url';
const ACTIVE_ORDERS_KEY = '@zenvy_cached_active_orders';
const OFFLINE_QUEUE_KEY = '@zenvy_offline_sync_queue';
const AUTH_TOKEN_KEY = '@zenvy_rider_auth_token';

const DEFAULT_PROD_URL = 'https://hostelbites-delivery.onrender.com';
const DEFAULT_LOCAL_URL = 'http://10.0.2.2:3001';

interface CachedOrder {
  id: string;
  restaurant: string;
  restaurantAddress: string;
  restaurantPhone: string;
  customerName: string;
  customerPhone: string;
  drop: string;
  items: Array<{ name: string; quantity: number }>;
  totalPrice: number;
  finalPrice: number;
  status: string;
  deliveryPin: string;
  deliverySlot?: string;
  createdAt?: string;
}

export default function AppEntry() {
  // Navigation / Connection states
  const [serverUrl, setServerUrl] = useState<string>('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [isUrlSelected, setIsUrlSelected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [webViewLoading, setWebViewLoading] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(2);
  const [customIp, setCustomIp] = useState<string>('');

  // Hardware/State tracking
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [batterySaverActive, setBatterySaverActive] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [cachedOrders, setCachedOrders] = useState<CachedOrder[]>([]);
  const [syncQueueSize, setSyncQueueSize] = useState<number>(0);
  const [driverToken, setDriverToken] = useState<string>('');

  // Command Deck / Sheet UI
  const [deckOpen, setDeckOpen] = useState<boolean>(false);
  const [inputPin, setInputPin] = useState<{ [key: string]: string }>({});
  
  // Offline Mode details / tab states
  const [offlineCategory, setOfflineCategory] = useState<'Fruits' | 'Food' | 'Groceries'>('Fruits');
  const [selectedOfflineOrder, setSelectedOfflineOrder] = useState<CachedOrder | null>(null);

  const webViewRef = useRef<WebView>(null);
  const countdownTimer = useRef<any>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const deckAnim = useRef(new Animated.Value(0)).current;

  // Offline Resolvers
  const getOrderSection = (order: CachedOrder): 'Fruits' | 'Food' | 'Groceries' => {
    const items = order.items || [];
    for (const item of items) {
      const name = (item.name || '').toLowerCase();
      if (name.includes('fruit') || name.includes('apple') || name.includes('banana') || name.includes('mango') || name.includes('orange') || name.includes('grape') || name.includes('berry') || name.includes('strawberry') || name.includes('watermelon') || name.includes('papaya')) {
        return 'Fruits';
      }
      if (name.includes('biryani') || name.includes('sweet') || name.includes('curry') || name.includes('rice') || name.includes('noodle') || name.includes('burger') || name.includes('pizza') || name.includes('roti') || name.includes('roll') || name.includes('dosa') || name.includes('idli') || name.includes('paneer') || name.includes('chicken') || name.includes('sandwich')) {
        return 'Food';
      }
    }
    return 'Groceries';
  };

  const getOrderTimeSlot = (order: CachedOrder): 'Before 7:30 AM' | 'After 7:30 AM' | '1:00 PM to 6:00 PM' => {
    const slot = (order.deliverySlot || '').toLowerCase();
    if (slot.includes('before 7:30') || slot.includes('breakfast') || slot.includes('early morning')) {
      return 'Before 7:30 AM';
    }
    if (slot.includes('1pm') || slot.includes('1 pm') || slot.includes('afternoon') || slot.includes('1pm to 6pm') || slot.includes('1pm-6pm')) {
      return '1:00 PM to 6:00 PM';
    }
    if (slot.includes('after 7:30')) {
      return 'After 7:30 AM';
    }

    if (order.createdAt) {
      const date = new Date(order.createdAt);
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const decimalTime = hours + minutes / 60;
      
      if (decimalTime < 7.5) {
        return 'Before 7:30 AM';
      } else if (decimalTime >= 13 && decimalTime <= 18) {
        return '1:00 PM to 6:00 PM';
      } else {
        return 'After 7:30 AM';
      }
    }
    
    return 'After 7:30 AM';
  };

  const isBulkOrder = (order: CachedOrder): boolean => {
    const totalQty = order.items?.reduce((sum, item) => sum + (item.quantity || 1), 0) || 0;
    const price = order.finalPrice || order.totalPrice || 0;
    return totalQty >= 5 || price >= 500;
  };

  // Initialize
  useEffect(() => {
    async function loadSavedData() {
      try {
        const url = await AsyncStorage.getItem(STORAGE_KEY);
        const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY) || '';
        const ordersJson = await AsyncStorage.getItem(ACTIVE_ORDERS_KEY);
        const queueJson = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);

        setDriverToken(token);
        if (ordersJson) setCachedOrders(JSON.parse(ordersJson));
        if (queueJson) setSyncQueueSize(JSON.parse(queueJson).length);

        if (url) {
          setSavedUrl(url);
          setServerUrl(url);
          startCountdown();
        } else {
          setLoading(false);
        }
      } catch (err) {
        setLoading(false);
      }
    }
    loadSavedData();
    setupNetworkMonitoring();
    setupBatteryMonitoring();
    requestLocationPermissions();
    requestNotificationPermissions();

    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  const requestNotificationPermissions = async () => {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
    } catch (e) {
      console.warn('Notification permissions request failed:', e);
    }
  };

  // Request Permissions & start GPS
  const requestLocationPermissions = async () => {
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert('Permission Required', 'GPS location access is critical for verifying order deliveries.');
        return;
      }
      await Location.requestBackgroundPermissionsAsync();
      startLocationTracking(batterySaverActive);
    } catch (e) {
      console.warn('GPS setup error:', e);
    }
  };

  // Start Location Tracking (with dynamic battery optimization polling)
  const startLocationTracking = async (useLowPower: boolean) => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
    }
    
    const accuracy = useLowPower ? Location.Accuracy.Balanced : Location.Accuracy.BestForNavigation;
    const timeInterval = useLowPower ? 30000 : 5000; // 30s in battery saver, 5s in active mode
    const distanceInterval = useLowPower ? 25 : 5;

    try {
      locationSubscription.current = await Location.watchPositionAsync(
        { accuracy, timeInterval, distanceInterval },
        (loc) => {
          const { latitude, longitude } = loc.coords;
          setCoords({ lat: latitude, lng: longitude });

          // Inject coords directly to WebView's global store to update Next.js map state
          if (webViewRef.current) {
            const jsInject = `
              window._lastGPSPosition = {
                coords: {
                  latitude: ${latitude},
                  longitude: ${longitude},
                  altitude: null,
                  accuracy: 10,
                  altitudeAccuracy: null,
                  heading: null,
                  speed: null
                },
                timestamp: Date.now()
              };
              if (window._gpsWatches) {
                Object.values(window._gpsWatches).forEach(cb => {
                  try { cb(window._lastGPSPosition); } catch(e) {}
                });
              }
              true;
            `;
            webViewRef.current.injectJavaScript(jsInject);
          }
        }
      );
    } catch (err) {
      console.warn('watchPosition error:', err);
    }
  };

  // Network Connectivity Monitoring
  const setupNetworkMonitoring = async () => {
    const state = await Network.getNetworkStateAsync();
    setIsOnline(state.isConnected ?? true);

    Network.addNetworkStateListener(state => {
      const connected = state.isConnected ?? true;
      setIsOnline(connected);
      if (connected) {
        // Trigger queue synchronization on reconnection
        syncOfflineDeliveries();
        // Dispatch standard online event to Next.js WebView logic
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(`window.dispatchEvent(new Event('online')); true;`);
        }
      } else {
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(`window.dispatchEvent(new Event('offline')); true;`);
        }
      }
    });
  };

  // Battery Level & Saver Mode Monitor
  const setupBatteryMonitoring = async () => {
    try {
      const level = await Battery.getBatteryLevelAsync();
      const state = await Battery.getBatteryStateAsync();
      const isLow = level < 0.20 && state !== Battery.BatteryState.CHARGING;
      
      setBatterySaverActive(isLow);
      
      Battery.addBatteryLevelListener(({ batteryLevel }) => {
        const isNowLow = batteryLevel < 0.20;
        setBatterySaverActive(prev => {
          if (prev !== isNowLow) {
            startLocationTracking(isNowLow);
          }
          return isNowLow;
        });
      });
    } catch (e) {
      console.warn('Battery tracking not available');
    }
  };

  // 2s Countdown Splash redirect
  const startCountdown = () => {
    setCountdown(2);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownTimer.current) clearInterval(countdownTimer.current);
          setIsUrlSelected(true);
          setLoading(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleConnect = async (url: string) => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, url);
      setServerUrl(url);
      setIsUrlSelected(true);
      setLoading(false);
      setConnectionError(false);
    } catch (err) {
      Alert.alert('Storage Error', 'Could not save server credentials');
    }
  };

  const handleCustomConnect = () => {
    let url = customIp.trim();
    if (!url) {
      Alert.alert('Input Error', 'Please enter a valid IP address');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }
    if (!url.includes(':') && url.startsWith('http://')) {
      url = url + ':3001';
    }
    handleConnect(url);
  };

  // Handle messages posted from Next.js WebView
  const handleWebViewMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'SYNC_ACTIVE_ORDERS') {
        // Cache active orders list locally for offline access
        setCachedOrders(data.orders || []);
        await AsyncStorage.setItem(ACTIVE_ORDERS_KEY, JSON.stringify(data.orders || []));
        
        // Update rider token cache
        if (data.token) {
          setDriverToken(data.token);
          await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
        }
      }

      if (data.type === 'NEW_ORDER' || data.type === 'SHOW_NOTIFICATION') {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: data.title || 'New Notification',
            body: data.body || '',
            sound: true,
          },
          trigger: null,
        });
      }
    } catch (e) {
      console.warn('WebView Message Parse Error:', e);
    }
  };

  // Sync Offline Queue Actions to Backend
  const syncOfflineDeliveries = async () => {
    try {
      const queueJson = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      if (!queueJson) return;

      const queue = JSON.parse(queueJson);
      if (queue.length === 0) return;

      const token = driverToken || await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) return;

      const url = serverUrl || await AsyncStorage.getItem(STORAGE_KEY);
      if (!url) return;

      let syncedCount = 0;
      const failedQueue = [];

      for (const item of queue) {
        try {
          const res = await fetch(`${url}/api/delivery/status/${item.orderId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: 'Delivered', pin: item.pin })
          });

          if (res.ok) {
            syncedCount++;
          } else {
            failedQueue.push(item);
          }
        } catch (err) {
          failedQueue.push(item);
        }
      }

      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(failedQueue));
      setSyncQueueSize(failedQueue.length);

      if (syncedCount > 0) {
        Alert.alert('Logistics Synced', `Successfully uploaded ${syncedCount} offline deliveries to the Command Hub.`);
        // Reload WebView to refresh stats
        if (webViewRef.current) webViewRef.current.reload();
      }
    } catch (e) {
      console.warn('Sync failed:', e);
    }
  };

  // Perform Offline Delivery Confirmation
  const performOfflineDelivery = async (orderId: string) => {
    const pin = inputPin[orderId] || '';
    const order = cachedOrders.find(o => o.id === orderId);
    
    if (order?.deliveryPin && order.deliveryPin !== pin) {
      Alert.alert('Security Error', 'Incorrect delivery PIN code');
      return;
    }

    try {
      const queueJson = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY) || '[]';
      const queue = JSON.parse(queueJson);
      
      // Add to queue
      queue.push({ orderId, pin, timestamp: Date.now() });
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      setSyncQueueSize(queue.length);

      // Remove from cached screen list
      const updatedOrders = cachedOrders.filter(o => o.id !== orderId);
      setCachedOrders(updatedOrders);
      await AsyncStorage.setItem(ACTIVE_ORDERS_KEY, JSON.stringify(updatedOrders));

      Alert.alert('Offline Delivery Recorded', 'Saved locally. Syncing will resume automatically when network coverage is restored.');
    } catch (e) {
      Alert.alert('Error', 'Failed to store offline delivery status');
    }
  };

  // Toggle Command Sheet
  const toggleDeck = () => {
    const toValue = deckOpen ? 0 : 1;
    Animated.spring(deckAnim, {
      toValue,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
    setDeckOpen(!deckOpen);
  };

  const handleReset = async () => {
    Alert.alert('Reset App', 'Return to connection portal?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_KEY);
          await AsyncStorage.removeItem(ACTIVE_ORDERS_KEY);
          await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
          setSavedUrl(null);
          setIsUrlSelected(false);
          setCachedOrders([]);
        }
      }
    ]);
  };

  // 1. Connection Splash Redirect
  if (loading && savedUrl) {
    return (
      <View style={s.container}>
        <LinearGradient colors={['#08080A', '#121216', '#08080A']} style={StyleSheet.absoluteFill} />
        <View style={s.splashContent}>
          <View style={s.logoBadge}><Text style={s.logoIcon}>Z</Text></View>
          <Text style={s.brandTitle}>ZENVY FLEET</Text>
          <Text style={s.brandTagline}>COMMAND DECK PROTOCOL</Text>
          <View style={s.countdownBox}>
            <ActivityIndicator size="small" color="#C9A84C" style={{ marginBottom: 12 }} />
            <Text style={s.countdownText}>Connecting to node in {countdown}s</Text>
            <Text style={s.serverSubtext} numberOfLines={1}>{savedUrl}</Text>
          </View>
          <TouchableOpacity style={s.cancelBtn} onPress={() => { if (countdownTimer.current) clearInterval(countdownTimer.current); setSavedUrl(null); setLoading(false); }}>
            <Text style={s.cancelBtnText}>CANCEL CONFIGURE PORTAL</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 2. Server Selection Card
  if (!isUrlSelected) {
    return (
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <LinearGradient colors={['#08080A', '#16161C', '#08080A']} style={StyleSheet.absoluteFill} />
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={s.headerSection}>
            <View style={s.logoBadge}><Text style={s.logoIcon}>Z</Text></View>
            <Text style={s.brandTitle}>ZENVY RIDER</Text>
            <Text style={s.brandTagline}>MOBILE LOGISTICS HUB</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Configure Portal Sync</Text>
            <Text style={s.cardDescription}>Link wrapper native sensors with the Zenvy backend systems.</Text>
            
            <TouchableOpacity style={s.optionBtn} onPress={() => handleConnect(DEFAULT_PROD_URL)}>
              <LinearGradient colors={['rgba(201, 168, 76, 0.15)', 'rgba(201, 168, 76, 0.03)']} style={StyleSheet.absoluteFill} />
              <View style={s.optionHeader}>
                <Text style={s.optionTitle}>✨ Production Cloud Server</Text>
                <View style={[s.statusIndicator, { backgroundColor: '#10B981' }]} />
              </View>
              <Text style={s.optionSubtext}>{DEFAULT_PROD_URL}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.optionBtn} onPress={() => handleConnect(DEFAULT_LOCAL_URL)}>
              <LinearGradient colors={['rgba(37, 99, 235, 0.12)', 'rgba(37, 99, 235, 0.02)']} style={StyleSheet.absoluteFill} />
              <View style={s.optionHeader}>
                <Text style={[s.optionTitle, { color: '#60A5FA' }]}>💻 Local Emulator Link</Text>
                <View style={[s.statusIndicator, { backgroundColor: '#F59E0B' }]} />
              </View>
              <Text style={s.optionSubtext}>{DEFAULT_LOCAL_URL}</Text>
            </TouchableOpacity>

            <View style={s.dividerRow}>
              <View style={s.dividerLine} /><Text style={s.dividerText}>CUSTOM IP DEVELOPMENT</Text><View style={s.dividerLine} />
            </View>

            <Text style={s.inputLabel}>DEVELOPER PORT / IP</Text>
            <TextInput
              style={s.ipInput}
              value={customIp}
              onChangeText={setCustomIp}
              placeholder="e.g. 192.168.1.15"
              placeholderTextColor="rgba(255, 255, 255, 0.25)"
              autoCapitalize="none"
              keyboardType="numeric"
            />
            <TouchableOpacity style={s.connectBtn} onPress={handleCustomConnect}>
              <Text style={s.connectBtnText}>CONNECT TO LOCALHOST NODE</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // WebView Injected Bootstrap: redirect navigator.geolocation queries to react native coordinates
  const INJECTED_GPS_BOOTSTRAP = `
    (function() {
      window._gpsWatches = window._gpsWatches || {};
      window._gpsWatchId = window._gpsWatchId || 1;
      
      navigator.geolocation.getCurrentPosition = function(success, error, options) {
        if (window._lastGPSPosition) {
          success(window._lastGPSPosition);
        } else {
          success({
            coords: {
              latitude: 16.4632,
              longitude: 80.5064,
              altitude: null,
              accuracy: 10,
              altitudeAccuracy: null,
              heading: null,
              speed: null
            },
            timestamp: Date.now()
          });
        }
      };
      
      navigator.geolocation.watchPosition = function(success, error, options) {
        const id = window._gpsWatchId++;
        window._gpsWatches[id] = success;
        if (window._lastGPSPosition) {
          success(window._lastGPSPosition);
        }
        return id;
      };
      
      navigator.geolocation.clearWatch = function(id) {
        delete window._gpsWatches[id];
      };
    })();
    true;
  `;

  const deckTranslateY = deckAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SH - 120, SH - 460]
  });

  return (
    <View style={s.mainWrapper}>
      <StatusBar barStyle="light-content" backgroundColor="#08080A" />

      {/* Online / Normal WebView screen */}
      {isOnline && !connectionError ? (
        <View style={{ flex: 1 }}>
          <WebView
            ref={webViewRef}
            source={{ uri: serverUrl }}
            onLoadStart={() => setWebViewLoading(true)}
            onLoadEnd={() => setWebViewLoading(false)}
            onMessage={handleWebViewMessage}
            injectedJavaScript={INJECTED_GPS_BOOTSTRAP}
            onError={() => setConnectionError(true)}
            style={{ flex: 1, backgroundColor: '#08080A' }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            geolocationEnabled={true}
            originWhitelist={['*']}
            mixedContentMode="always"
            allowsInlineMediaPlayback={true}
          />

          {/* Dynamic Floating Command Deck Drawer */}
          <Animated.View style={[s.deckContainer, { transform: [{ translateY: deckTranslateY }] }]}>
            {/* Header bar click triggers sliding toggle */}
            <TouchableOpacity style={s.deckHeader} onPress={toggleDeck} activeOpacity={0.9}>
              <View style={s.deckBar} />
              <View style={s.deckHeaderContent}>
                <Text style={s.deckTitle}>🛡️ ZENVY COMMAND DECK</Text>
                <View style={[s.statusBadge, { borderColor: batterySaverActive ? '#F59E0B' : '#10B981' }]}>
                  <Text style={[s.statusText, { color: batterySaverActive ? '#F59E0B' : '#10B981' }]}>
                    {batterySaverActive ? '⚡ GPS SAVER ACTIVE' : '🛰️ GPS HIGH PRECISION'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={s.deckContent}>
              <View style={s.sensorGrid}>
                <View style={s.sensorItem}>
                  <Text style={s.sensorLabel}>LATITUDE</Text>
                  <Text style={s.sensorVal}>{coords?.lat.toFixed(6) ?? '16.463200'}</Text>
                </View>
                <View style={s.sensorItem}>
                  <Text style={s.sensorLabel}>LONGITUDE</Text>
                  <Text style={s.sensorVal}>{coords?.lng.toFixed(6) ?? '80.506400'}</Text>
                </View>
                <View style={s.sensorItem}>
                  <Text style={s.sensorLabel}>SYNC QUEUE</Text>
                  <Text style={s.sensorVal}>{syncQueueSize} offline actions</Text>
                </View>
              </View>

              {/* Navigation Quick Shortcuts */}
              <View style={s.shortcutWrapper}>
                <Text style={s.sectionLabel}>FLEET SHORTCUTS</Text>
                
                {cachedOrders.length > 0 ? (
                  <View style={s.activeOrderShortcut}>
                    <Text style={s.activeOrderTitle}>🎯 Current Target: {cachedOrders[0].restaurant}</Text>
                    <Text style={s.activeOrderDesc} numberOfLines={1}>Drop: {cachedOrders[0].drop}</Text>
                    
                    <View style={s.btnRow}>
                      <TouchableOpacity 
                        style={s.shortcutBtn}
                        onPress={() => {
                          const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cachedOrders[0].restaurantAddress || cachedOrders[0].restaurant)}`;
                          Linking.openURL(url);
                        }}
                      >
                        <Text style={s.shortcutBtnText}>NAVIGATE RESTAURANT 🗺️</Text>
                      </TouchableOpacity>

                      <TouchableOpacity 
                        style={[s.shortcutBtn, { borderColor: '#3b82f6' }]}
                        onPress={() => {
                          const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cachedOrders[0].drop)}`;
                          Linking.openURL(url);
                        }}
                      >
                        <Text style={[s.shortcutBtnText, { color: '#60a5fa' }]}>NAVIGATE CLIENT 📍</Text>
                      </TouchableOpacity>
                    </View>
                    
                    <View style={[s.btnRow, { marginTop: 10 }]}>
                      {cachedOrders[0].customerPhone ? (
                        <TouchableOpacity 
                          style={[s.shortcutBtn, { borderColor: 'rgba(255,255,255,0.1)' }]}
                          onPress={() => Linking.openURL(`tel:${cachedOrders[0].customerPhone}`)}
                        >
                          <Text style={s.shortcutBtnText}>CALL CUSTOMER 📞</Text>
                        </TouchableOpacity>
                      ) : null}

                      <TouchableOpacity 
                        style={[s.shortcutBtn, { borderColor: '#EF4F5F' }]}
                        onPress={() => Linking.openURL('tel:112')}
                      >
                        <Text style={[s.shortcutBtnText, { color: '#EF4F5F' }]}>EMERGENCY SOS 🚨</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <Text style={s.noOrdersText}>No active orders loaded in cache. Accept an order to sync sensors.</Text>
                )}
              </View>

              <TouchableOpacity style={s.resetAppBtn} onPress={handleReset}>
                <Text style={s.resetAppBtnText}>DISCONNECT HUB PORTAL</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      ) : null}

      {/* 3. Offline Safeguard Vault Screen */}
      {(!isOnline || connectionError) && (
        <View style={s.offlineWrapper}>
          <LinearGradient colors={['#08080A', '#1E1212', '#08080A']} style={StyleSheet.absoluteFill} />
          
          <View style={s.offlineHeader}>
            <View style={s.dangerIcon}><Text style={s.dangerText}>⚠️</Text></View>
            <Text style={s.offlineTitle}>ZENVY OFFLINE SAFEGUARD</Text>
            <Text style={s.offlineSubtitle}>CELLULAR BLACKOUT DETECTED — LOCAL DATA ENGAGED</Text>
            <Text style={s.syncBadge}>Sync Queue: {syncQueueSize} orders pending upload</Text>
          </View>

          {/* Offline Category Segment Tabs */}
          <View style={s.tabContainer}>
            {(['Fruits', 'Food', 'Groceries'] as const).map((cat) => {
              const count = cachedOrders.filter(o => getOrderSection(o) === cat).length;
              const isActive = offlineCategory === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[s.tabButton, isActive && s.tabButtonActive]}
                  onPress={() => setOfflineCategory(cat)}
                >
                  <Text style={[s.tabButtonText, isActive && s.tabButtonTextActive]}>
                    {cat === 'Fruits' ? '🍏 Fruits' : cat === 'Food' ? '🍔 Food' : '📦 Groceries'} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView style={s.offlineList}>
            {(() => {
              const filtered = cachedOrders.filter(o => getOrderSection(o) === offlineCategory);
              if (filtered.length === 0) {
                return (
                  <View style={s.emptyOffline}>
                    <Text style={{ fontSize: 44, marginBottom: 16 }}>🗄️</Text>
                    <Text style={s.emptyOfflineTitle}>No {offlineCategory} Orders Caged</Text>
                    <Text style={s.emptyOfflineDesc}>
                      There are no active orders under the {offlineCategory} category currently cached in your local database.
                    </Text>
                  </View>
                );
              }

              // Group filtered
              const before730 = filtered.filter(o => getOrderTimeSlot(o) === 'Before 7:30 AM');
              const after730 = filtered.filter(o => getOrderTimeSlot(o) === 'After 7:30 AM');
              const slots1pmTo6pm = filtered.filter(o => getOrderTimeSlot(o) === '1:00 PM to 6:00 PM');

              const renderSlotSection = (title: string, list: CachedOrder[]) => {
                if (list.length === 0) return null;
                return (
                  <View key={title} style={{ marginBottom: 20 }}>
                    <View style={s.slotHeader}>
                      <View style={s.slotIndicatorDot} />
                      <Text style={s.slotHeaderText}>{title} ORDERS ({list.length})</Text>
                    </View>
                    {list.map((order) => {
                      const isBulk = isBulkOrder(order);
                      return (
                        <TouchableOpacity 
                          key={order.id} 
                          style={s.offlineCard}
                          onPress={() => setSelectedOfflineOrder(order)}
                        >
                          <View style={s.offlineCardHeader}>
                            <View style={{ flex: 1 }}>
                              <Text style={s.offlineRestName}>{order.restaurant}</Text>
                              <Text style={s.offlineOrderId}>#{order.id.slice(-6).toUpperCase()}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              {isBulk && (
                                <View style={s.bulkBadge}>
                                  <Text style={s.bulkBadgeText}>🔥 BULK</Text>
                                </View>
                              )}
                              <View style={[
                                s.slotBadge, 
                                title === 'Before 7:30 AM' ? { borderColor: '#FBBF24' } : title === '1:00 PM to 6:00 PM' ? { borderColor: '#3B82F6' } : { borderColor: '#10B981' }
                              ]}>
                                <Text style={[
                                  s.slotBadgeText, 
                                  title === 'Before 7:30 AM' ? { color: '#FBBF24' } : title === '1:00 PM to 6:00 PM' ? { color: '#3B82F6' } : { color: '#10B981' }
                                ]}>{getOrderTimeSlot(order)}</Text>
                              </View>
                            </View>
                          </View>

                          <View style={s.detailGroup}>
                            <Text style={s.detailLabel}>ITEMS PREVIEW</Text>
                            {order.items.slice(0, 2).map((it, idx) => (
                              <Text key={idx} style={s.itemText}>• {it.quantity}x {it.name}</Text>
                            ))}
                            {order.items.length > 2 && (
                              <Text style={s.moreText}>+ {order.items.length - 2} more items</Text>
                            )}
                          </View>
                          
                          <Text style={s.tapPrompt}>👉 Tap order for full customer details & call/message shortcuts</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              };

              return [
                renderSlotSection('Before 7:30 AM', before730),
                renderSlotSection('After 7:30 AM', after730),
                renderSlotSection('1:00 PM to 6:00 PM', slots1pmTo6pm)
              ];
            })()}
          </ScrollView>

          <View style={s.offlineFooter}>
            <TouchableOpacity 
              style={s.retryBtn} 
              onPress={() => {
                setConnectionError(false);
                setWebViewLoading(true);
                setupNetworkMonitoring();
              }}
            >
              <Text style={s.retryBtnText}>RETRY NETWORK CONNECTION</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.offlineResetBtn} onPress={handleReset}>
              <Text style={s.offlineResetBtnText}>RESET SERVER NODE CONFIG</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Customer details modal for offline mode */}
      {selectedOfflineOrder && (
        <View style={s.modalOverlay}>
          <View style={s.modalContainer}>
            <TouchableOpacity 
              style={s.closeModalBtn} 
              onPress={() => setSelectedOfflineOrder(null)}
            >
              <Text style={s.closeModalText}>✕</Text>
            </TouchableOpacity>

            <Text style={s.modalHeading}>CUSTOMER & OFFLINE DISPATCH</Text>
            <Text style={s.modalSubheading}>#{selectedOfflineOrder.id.toUpperCase()}</Text>

            <ScrollView style={{ maxHeight: 300, marginVertical: 16 }}>
              <View style={s.modalBlock}>
                <Text style={s.modalLabel}>RESTAURANT</Text>
                <Text style={s.modalVal}>{selectedOfflineOrder.restaurant}</Text>
                <Text style={s.modalSubVal}>{selectedOfflineOrder.restaurantAddress}</Text>
              </View>

              <View style={s.modalBlock}>
                <Text style={s.modalLabel}>CUSTOMER NAME</Text>
                <Text style={s.modalVal}>{selectedOfflineOrder.customerName || 'Zenvy Elite Guest'}</Text>
              </View>

              <View style={s.modalBlock}>
                <Text style={s.modalLabel}>DELIVERY SLOT</Text>
                <Text style={s.modalVal}>{getOrderTimeSlot(selectedOfflineOrder)}</Text>
              </View>

              <View style={s.modalBlock}>
                <Text style={s.modalLabel}>DROP ROOM / HUB GATE</Text>
                <Text style={s.modalVal}>{selectedOfflineOrder.drop}</Text>
              </View>

              <View style={s.modalBlock}>
                <Text style={s.modalLabel}>ITEMS ORDERED</Text>
                {selectedOfflineOrder.items.map((it, idx) => (
                  <Text key={idx} style={s.modalItemText}>• {it.quantity}x {it.name}</Text>
                ))}
              </View>
            </ScrollView>

            {/* Call and message actions */}
            <View style={s.modalActions}>
              <TouchableOpacity 
                style={[s.modalActBtn, { backgroundColor: '#1E3A8A' }]}
                onPress={() => {
                  if (selectedOfflineOrder.customerPhone && selectedOfflineOrder.customerPhone !== 'Hidden') {
                    Linking.openURL(`tel:${selectedOfflineOrder.customerPhone}`);
                  } else {
                    Alert.alert('Protected Contact', 'This customer phone is hidden for security.');
                  }
                }}
              >
                <Text style={s.modalActText}>📞 CALL CLIENT</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[s.modalActBtn, { backgroundColor: '#065F46' }]}
                onPress={() => {
                  if (selectedOfflineOrder.customerPhone && selectedOfflineOrder.customerPhone !== 'Hidden') {
                    Linking.openURL(`https://wa.me/91${selectedOfflineOrder.customerPhone}`);
                  } else {
                    Alert.alert('Protected Contact', 'This customer phone is hidden for security.');
                  }
                }}
              >
                <Text style={s.modalActText}>💬 WHATSAPP</Text>
              </TouchableOpacity>
            </View>

            {/* Offline PIN submission */}
            <View style={s.modalPinSection}>
              <Text style={s.modalLabel}>CONFIRM PIN CODE</Text>
              <View style={s.pinSubmitRow}>
                <TextInput
                  style={s.pinInput}
                  placeholder="ENTER PIN"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="numeric"
                  maxLength={4}
                  value={inputPin[selectedOfflineOrder.id] || ''}
                  onChangeText={(txt) => setInputPin(prev => ({ ...prev, [selectedOfflineOrder.id]: txt }))}
                />
                <TouchableOpacity 
                  style={s.deliverBtn}
                  onPress={() => {
                    performOfflineDelivery(selectedOfflineOrder.id);
                    setSelectedOfflineOrder(null);
                  }}
                >
                  <Text style={s.deliverBtnText}>DELIVER OFFLINE</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Full screen loader during web compile */}
      {webViewLoading && isOnline && !connectionError && (
        <View style={StyleSheet.absoluteFill}>
          <LinearGradient colors={['#08080A', 'rgba(10, 10, 13, 0.95)', '#08080A']} style={StyleSheet.absoluteFill} />
          <View style={s.splashContent}>
            <View style={s.logoBadge}><Text style={s.logoIcon}>Z</Text></View>
            <ActivityIndicator size="large" color="#C9A84C" style={{ marginTop: 24 }} />
            <Text style={s.loadingText}>Syncing Logistics Feed...</Text>
            <Text style={s.loadingUrl} numberOfLines={1}>{serverUrl}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  mainWrapper: {
    flex: 1,
    backgroundColor: '#08080A',
  },
  container: {
    flex: 1,
    backgroundColor: '#08080A',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  splashContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(201, 168, 76, 0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(201, 168, 76, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C9A84C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 8,
  },
  logoIcon: {
    fontSize: 44,
    fontWeight: '300',
    fontStyle: 'italic',
    color: '#D4AF37',
    marginTop: Platform.OS === 'ios' ? 4 : 0,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#C9A84C',
    letterSpacing: 6,
    marginTop: 18,
    textAlign: 'center',
  },
  brandTagline: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 4,
    marginTop: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  countdownBox: {
    marginTop: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  serverSubtext: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  cancelBtn: {
    marginTop: 32,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 14,
  },
  cancelBtnText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 1.5,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  card: {
    backgroundColor: '#16161C',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
    marginBottom: 24,
  },
  optionBtn: {
    height: 70,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    position: 'relative',
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  optionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#C9A84C',
    letterSpacing: 0.5,
  },
  optionSubtext: {
    fontSize: 9.5,
    color: '#6B7280',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  statusIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  dividerText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#6B7280',
    marginHorizontal: 12,
    letterSpacing: 1.5,
  },
  inputLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 2,
    marginBottom: 6,
  },
  ipInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '600',
    marginBottom: 16,
  },
  connectBtn: {
    backgroundColor: '#C9A84C',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  connectBtnText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 2.5,
  },
  loadingText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 18,
  },
  loadingUrl: {
    fontSize: 9,
    color: '#6B7280',
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // Collapsible Command Deck Sheet
  deckContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(16, 16, 22, 0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    height: 480,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 20,
    zIndex: 9999,
  },
  deckHeader: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 20,
  },
  deckBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 8,
  },
  deckHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  deckTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  deckContent: {
    padding: 20,
  },
  sensorGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sensorItem: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 12,
    marginHorizontal: 4,
  },
  sensorLabel: {
    fontSize: 7.5,
    fontWeight: '900',
    color: '#6B7280',
    letterSpacing: 1,
    marginBottom: 4,
  },
  sensorVal: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  shortcutWrapper: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 8.5,
    fontWeight: '900',
    color: '#C9A84C',
    letterSpacing: 2,
    marginBottom: 12,
  },
  activeOrderShortcut: {
    marginTop: 4,
  },
  activeOrderTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  activeOrderDesc: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
    marginBottom: 14,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  shortcutBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(251, 191, 36, 0.3)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shortcutBtnText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FBBF24',
    letterSpacing: 1.5,
  },
  noOrdersText: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    paddingVertical: 12,
  },
  resetAppBtn: {
    borderWidth: 1,
    borderColor: 'rgba(239, 79, 95, 0.2)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  resetAppBtnText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#EF4F5F',
    letterSpacing: 2,
  },

  // Offline Safeguard Vault CSS
  offlineWrapper: {
    flex: 1,
    backgroundColor: '#08080A',
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  offlineHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  dangerIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(239, 79, 95, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 79, 95, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  dangerText: {
    fontSize: 22,
  },
  offlineTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#EF4F5F',
    letterSpacing: 3,
  },
  offlineSubtitle: {
    fontSize: 8.5,
    fontWeight: '900',
    color: '#9CA3AF',
    letterSpacing: 1.5,
    marginTop: 4,
    textAlign: 'center',
  },
  syncBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FBBF24',
    marginTop: 12,
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  offlineList: {
    flex: 1,
    marginBottom: 20,
  },
  offlineCard: {
    backgroundColor: '#16161C',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    padding: 20,
    marginBottom: 16,
  },
  offlineCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    paddingBottom: 10,
    marginBottom: 12,
  },
  offlineRestName: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  offlineOrderId: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#6B7280',
    fontWeight: '900',
  },
  detailGroup: {
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 7.5,
    fontWeight: '900',
    color: '#6B7280',
    letterSpacing: 1,
    marginBottom: 2,
  },
  detailText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#E5E7EB',
  },
  itemText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#9CA3AF',
    marginLeft: 6,
  },
  offlineActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    paddingTop: 12,
  },
  callBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  callBtnText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#E5E7EB',
  },
  mapBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  mapBtnText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#60a5fa',
  },
  pinSubmitRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  pinInput: {
    width: 90,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    textAlign: 'center',
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  deliverBtn: {
    flex: 1,
    backgroundColor: '#EF4F5F',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliverBtnText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 1.5,
  },
  emptyOffline: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyOfflineTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  emptyOfflineDesc: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 40,
    marginTop: 6,
  },
  offlineFooter: {
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    paddingTop: 16,
    paddingBottom: 30,
  },
  retryBtn: {
    backgroundColor: '#C9A84C',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  retryBtnText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 2,
  },
  offlineResetBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  offlineResetBtnText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 1.5,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
  },
  tabButtonText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#6B7280',
  },
  tabButtonTextActive: {
    color: '#000000',
    fontWeight: '900',
  },
  slotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    paddingBottom: 6,
    marginBottom: 12,
    gap: 8,
  },
  slotIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3B82F6',
  },
  slotHeaderText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#9CA3AF',
    letterSpacing: 1.5,
  },
  bulkBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bulkBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#F59E0B',
  },
  slotBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  slotBadgeText: {
    fontSize: 8,
    fontWeight: '900',
  },
  moreText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#4B5563',
    marginTop: 4,
    marginLeft: 6,
  },
  tapPrompt: {
    fontSize: 8.5,
    color: '#6B7280',
    fontStyle: 'italic',
    marginTop: 10,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99999,
  },
  modalContainer: {
    width: '90%',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 24,
    padding: 24,
  },
  closeModalBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeModalText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  modalHeading: {
    fontSize: 10,
    fontWeight: '900',
    color: '#3B82F6',
    letterSpacing: 2,
  },
  modalSubheading: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
    marginBottom: 10,
  },
  modalBlock: {
    marginBottom: 14,
  },
  modalLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: '#6B7280',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  modalVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  modalSubVal: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
  },
  modalItemText: {
    fontSize: 11,
    color: '#D1D5DB',
    marginLeft: 4,
    marginTop: 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  modalActBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  modalPinSection: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 16,
  },
});
