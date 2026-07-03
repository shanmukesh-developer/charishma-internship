"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import RiderNavbar from './RiderNavbar';
import ActiveOrderCard from './ActiveOrderCard';
import OrdersList from './OrdersList';
import OfflineScreen from './OfflineScreen';
import LiveStatsBar from './LiveStatsBar';
import WeatherSignal from './WeatherSignal';
import SOSPanel from './SOSPanel';
import LiveLeaderboard from './LiveLeaderboard';
import RiderProfilePage from './RiderProfilePage';
import EarningsDashboard from './EarningsDashboard';
import ChatDrawer from '@/components/ChatDrawer';
import { useToast } from '@/components/RiderToast';
import ActiveTaskHUD from './ActiveTaskHUD';
import SpeedoWidget from './SpeedoWidget';
import dynamic from 'next/dynamic';
import NotificationDrawer, { type Notification, type NotifType } from './NotificationDrawer';
import { messaging } from '@/utils/firebase';
import { getToken } from 'firebase/messaging';

const RiderMap = dynamic(() => import('@/components/RiderMap'), { ssr: false });



interface Driver {
  _id: string;
  name: string;
  token: string;
  photoUrl?: string;
}

interface Order {
  id: string;
  restaurant: string;
  restaurantAddress?: string;
  customerName: string;
  customerPhone?: string;
  drop: string;
  items: { name: string; quantity: number; price?: number; image?: string }[];
  totalAmount?: number;
  totalPrice?: number;
  finalPrice?: number;
  note?: string;
  createdAt?: string;
  status?: string;
  _id?: string;
}

interface RawOrder {
  _id?: string;
  id?: string;
  customerName?: string;
  userId?: { name?: string };
  restaurant?: string;
  restaurantId?: { name?: string };
  drop?: string;
  deliveryAddress?: string;
  status?: string;
  items?: { name: string; quantity: number; price?: number; image?: string }[];
  [key: string]: unknown;
}

interface DashboardContainerProps {
  driver: Driver;
  onLogout: () => void;
  apiUrl: string;
}

export default function DashboardContainer({ driver, onLogout, apiUrl }: DashboardContainerProps) {
  const [isOnline, setIsOnline] = useState(false);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [taskSequence, setTaskSequence] = useState<any[]>([]);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [orderStatus, setOrderStatus] = useState<Record<string, string>>({});
  const [pinValues, setPinValues] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [currentDriver, setCurrentDriver] = useState(driver);
  const [activeIssue, setActiveIssue] = useState<{ issueType: string; details: string; senderRole: string } | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeChatOrderId, setActiveChatOrderId] = useState<string>('');
  const [todayStats, setTodayStats] = useState({ earnings: 0, orders: 0, zenPoints: 0, streak: 0 });
  const [showProfile, setShowProfile] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);
  const [isNetworkConnected, setIsNetworkConnected] = useState(typeof window !== 'undefined' ? navigator.onLine : true);
  const [driverPhoto, setDriverPhoto] = useState<string | undefined>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [currentCheckpoint, _setCurrentCheckpoint] = useState<string>('Mangalagiri Jn');

  const [orderTimers, setOrderTimers] = useState<Record<string, number>>({});
  const [riderPos, setRiderPos] = useState<[number, number] | undefined>(undefined);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const addNotification = useCallback((type: NotifType, title: string, body: string) => {
    setNotifications(prev => {
      const newNotif: Notification = {
        id: Math.random().toString(36).slice(2, 9),
        type,
        title,
        body,
        ts: Date.now(),
        read: false
      };
      const updated = [newNotif, ...prev].slice(0, 50);
      localStorage.setItem('rider_notifications', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const triggerNativeNotification = useCallback((title: string, body: string) => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(registration => {
            registration.showNotification(title, {
              body,
              icon: '/logo.png',
              badge: '/logo.png',
              vibrate: [200, 100, 200]
            });
          });
        } else {
          new Notification(title, { body });
        }
      } catch (err) {
        console.error('Failed to trigger native notification:', err);
      }
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('rider_notifications');
    if (saved) {
      try {
        setNotifications(JSON.parse(saved));
      } catch {}
    }

    // Request notification permission and register FCM + local push fallback
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then(async (permission) => {
        if (permission === 'granted' && messaging) {
          try {
            if ('serviceWorker' in navigator) {
              const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
              const token = await getToken(messaging, {
                serviceWorkerRegistration: reg,
                vapidKey: 'BDj_Nf5C14c1qE66g08a1Vl8H9rE2z6T5S3m8p0o9a2b3c4d5e6f7g8h9i_zenvy_key'
              });
              if (token) {
                await fetch(`${apiUrl}/api/delivery/fcm-token`, {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${driver.token}`
                  },
                  body: JSON.stringify({ fcmToken: token, appVersion: '1.0.0' })
                });
              }
            }
          } catch (err) {
            console.warn('FCM registration skipped or failed:', err);
          }
        }
      });
    }
  }, [apiUrl, driver.token]);

  const socketRef = useRef<Socket | null>(null);
  const { toast } = useToast();

  const { token: driverToken } = driver;

  // Fetch profile picture on mount
  useEffect(() => {
    const fetchPhoto = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/delivery/profile`, {
          });
        if (res.status === 401) return onLogout();
        if (res.ok) {
          const data = await res.json();
          if (data.photoUrl) {
            setDriverPhoto(data.photoUrl);
            setCurrentDriver(prev => ({ ...prev, photoUrl: data.photoUrl }));
          }
        }
      } catch {}
    };
    fetchPhoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, driverToken, onLogout]);

  // Live GPS tracking for RiderMap
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setRiderPos([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Restore state — and re-sync online status to backend on page load
  useEffect(() => {
    const syncOnlineStatus = async (status: boolean) => {
      try {
        await fetch(`${apiUrl}/api/delivery/online`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            },
          body: JSON.stringify({ isOnline: status })
        });
      } catch (err) {
        console.error('[RT] Status sync failed:', err);
      }
    };

    const saved = localStorage.getItem('isOnline');
    if (saved) {
      try {
        const wasOnline = JSON.parse(saved);
        setIsOnline(wasOnline);
        // Re-sync online state to backend so server knows rider is back
        syncOnlineStatus(wasOnline);
      } catch {}
    }
    const savedStats = localStorage.getItem('todayStats');
    if (savedStats) { try { setTodayStats(JSON.parse(savedStats)); } catch {} }
  }, [apiUrl, driverToken, onLogout]);

  const fetchActiveOrders = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/delivery/orders/active`, {
        });
      if (res.status === 401) return onLogout();
      if (res.ok) {
        const data = await res.json();
        const orders = data.orders || [];
        setActiveOrders(orders.map((o: RawOrder) => ({ 
          ...o, 
          id: String(o._id || o.id),
          customerName: o.customerName || o.userId?.name || 'Customer',
          restaurant: o.restaurant || o.restaurantId?.name || 'Restaurant',
          drop: o.drop || o.deliveryAddress || 'Delivery'
        })));
        setTaskSequence(data.taskSequence || []);
        const statusMap: Record<string, string> = {};
        orders.forEach((o: RawOrder) => { statusMap[String(o._id || o.id)] = o.status || 'Accepted'; });
        setOrderStatus(statusMap);
      }
    } catch (err) { console.error('[RT] Active orders fetch failed:', err); }
  }, [apiUrl, driverToken, onLogout]);

  const fetchPendingOrders = useCallback(async () => {
    if (!isOnline) return;
    try {
      const res = await fetch(`${apiUrl}/api/delivery/orders/pending`, {
        });
      if (res.status === 401) return onLogout();
      if (res.ok) {
        const data = await res.json();
        const orders = data.map((o: RawOrder) => ({ 
          ...o, 
          id: String(o._id || o.id),
          restaurant: o.restaurant || o.restaurantId?.name || 'Restaurant',
          drop: o.drop || o.deliveryAddress || 'Delivery'
        }));
        setAvailableOrders(orders);
        
        // Initialize timers for new orders (e.g. 60s to accept)
        setOrderTimers(prev => {
          const newTimers = { ...prev };
          orders.forEach((o: RawOrder) => {
            const id = o.id as string;
            if (id && !newTimers[id]) newTimers[id] = 60;
          });
          return newTimers;
        });
      }
    } catch (err) { console.error('[RT] Pending orders fetch failed:', err); }
  }, [apiUrl, driverToken, isOnline, onLogout]);

  // Timer Countdown Logic
  useEffect(() => {
    const interval = setInterval(() => {
      setOrderTimers(prev => {
        const next = { ...prev };
        let changed = false;
        Object.keys(next).forEach(id => {
          if (next[id] > 0) {
            next[id] -= 1;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/delivery/orders/history`, {
        });
      if (res.status === 401) return onLogout();
      if (res.ok) {
        const data = await res.json();
        setHistoryOrders(data.map((o: RawOrder) => ({ 
          ...o, 
          id: String(o._id || o.id),
          customerName: o.customerName || o.userId?.name || 'Customer',
          restaurant: o.restaurant || o.restaurantId?.name || 'Restaurant',
          drop: o.drop || o.deliveryAddress || 'Delivery'
        })));
      }
    } catch (err) { console.error('[RT] History fetch failed:', err); }
  }, [apiUrl, driverToken, onLogout]);

  const fetchTodayStats = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/delivery/stats/today`, {
        });
      if (res.status === 401) return onLogout();
      if (res.ok) {
        const data = await res.json();
        setTodayStats(data);
        localStorage.setItem('todayStats', JSON.stringify(data));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, driverToken, onLogout]);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/delivery/profile`, {
        });
      if (res.ok) {
        const data = await res.json();
        setCurrentDriver(prev => ({ ...prev, ...data }));
        if (data.photoUrl) setDriverPhoto(data.photoUrl);
      }
    } catch {}
  }, [apiUrl, driverToken]);

  useEffect(() => {
    fetchActiveOrders();
    fetchPendingOrders();
    fetchHistory();
    fetchTodayStats();
    fetchProfile();
    // Reduced from 15s to 30s — socket handles real-time updates, polling is a safety net
    const pollInterval = setInterval(() => {
      fetchActiveOrders();
      if (isOnline) fetchPendingOrders();
    }, 30000);
    return () => clearInterval(pollInterval);
  }, [fetchActiveOrders, fetchPendingOrders, fetchHistory, fetchTodayStats, fetchProfile, isOnline]);

  useEffect(() => {
    const socket = io(apiUrl.replace(/\/$/, ""), {
      auth: { token: driverToken, role: 'rider', driverId: currentDriver._id, name: currentDriver.name },
      transports: ['websocket', 'polling'], withCredentials: true,
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('rider_connected', { driverId: currentDriver._id, name: currentDriver.name });
      // Re-broadcast online state on every (re)connect so server is always up-to-date
      socket.emit('rider_status_change', {
        riderId: currentDriver._id,
        name: currentDriver.name,
        isOnline
      });
    });

    socket.on('newOrder', (order: Record<string, unknown>) => {
      if (!isOnline) return;
      const id = String(order._id || order.id);
      addNotification('order', 'New Order Available', `From ${order.restaurant || 'Zenvy'} to ${order.drop || 'Delivery'}`);
      triggerNativeNotification('New Order Available 📦', `From ${order.restaurant || 'Zenvy'} to ${order.drop || 'Delivery'}`);
      setAvailableOrders(prev => {
        if (prev.find(o => o.id === id)) return prev;
        return [{
          id,
          restaurant: String(order.restaurant || 'Zenvy'),
          customerName: String(order.customerName || 'Customer'),
          drop: String(order.drop || 'Delivery'),
          items: (order.items as Order['items']) || [],
          totalPrice: Number(order.totalPrice || 0),
          finalPrice: Number(order.finalPrice || 0),
          createdAt: String(order.createdAt || new Date().toISOString()),
          status: 'Pending'
        }, ...prev];
      });
    });

    socket.on('orderCancelled', ({ orderId }: { orderId: string }) => {
      addNotification('warning', 'Order Cancelled', `Order #${orderId.slice(-6)} has been cancelled.`);
      triggerNativeNotification('Order Cancelled ⚠️', `Order #${orderId.slice(-6)} has been cancelled.`);
      setAvailableOrders(prev => prev.filter(o => o.id !== String(orderId)));
      setActiveOrders(prev => prev.filter(o => o.id !== String(orderId)));
    });

    socket.on('issue_alert', (data: { issueType: string; details: string; senderRole: string }) => {
      addNotification('issue', 'Issue Reported', `${data.issueType}: ${data.details}`);
      triggerNativeNotification('Issue Reported ⚠️', `${data.issueType}: ${data.details}`);
      setActiveIssue(data);
      setTimeout(() => setActiveIssue(null), 15000);
    });

    socket.on('global_announcement', (ann: { message: string; type: 'info' | 'warning' | 'promo' | 'emergency' }) => {
      addNotification(ann.type, 'Broadcast Update', ann.message);
      triggerNativeNotification('Broadcast Update 📢', ann.message);
    });

    socket.on('rider_sos_status', (data: { riderId: string; status: string }) => {
      if (data.riderId === currentDriver._id && data.status === 'resolved') {
        addNotification('sos', 'SOS Resolved', 'Emergency alert resolved by admin control.');
        triggerNativeNotification('SOS Resolved ✅', 'Emergency alert resolved by administrative control.');
      }
    });

    return () => {
      socket.emit('rider_disconnected', { driverId: currentDriver._id });
      socket.disconnect();
    };
  }, [apiUrl, driverToken, currentDriver._id, currentDriver.name, isOnline, addNotification, triggerNativeNotification]);

  useEffect(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('rider_status_change', {
        riderId: currentDriver._id,
        name: currentDriver.name,
        isOnline
      });
    }
  }, [isOnline, currentDriver._id, currentDriver.name]);

  useEffect(() => {
    if (!socketRef.current) return;
    activeOrders.forEach(order => {
      socketRef.current?.emit('updateLocation', {
        orderId: order.id,
        currentCheckpoint,
        riderId: currentDriver._id,
        riderName: currentDriver.name
      });
    });
    socketRef.current?.emit('rider_location_update', {
      riderId: currentDriver._id,
      riderName: currentDriver.name,
      currentCheckpoint,
      activeOrderCount: activeOrders.length,
      isOnline
    });
  }, [currentCheckpoint, activeOrders, currentDriver._id, currentDriver.name, isOnline]);



  const toggleOnline = async () => {
    if (isOnline && activeOrders.length > 0) {
      toast('Complete or cancel active tasks before going offline.', 'warning');
      return;
    }
    const newStatus = !isOnline;
    try {
      const res = await fetch(`${apiUrl}/api/delivery/online`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ isOnline: newStatus })
      });
      if (res.ok) {
        setIsOnline(newStatus);
        localStorage.setItem('isOnline', JSON.stringify(newStatus));
        socketRef.current?.emit('rider_status_change', {
          riderId: currentDriver._id,
          name: currentDriver.name,
          isOnline: newStatus
        });
        if (newStatus) fetchPendingOrders();
        else setAvailableOrders([]);
      }
    } catch { toast('Network error. Could not update status.', 'error'); }
  };

  const acceptOrder = async (orderId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/delivery/accept/${orderId}`, {
        method: 'PUT',
        });
      if (res.ok) {
        socketRef.current?.emit('joinOrder', orderId);
        socketRef.current?.emit('rider_accepted', {
          orderId,
          riderId: currentDriver._id,
          riderName: currentDriver.name
        });
        setAvailableOrders(prev => prev.filter(o => o.id !== orderId));
        fetchActiveOrders();
        fetchHistory();
      } else {
        const data = await res.json();
        toast(data.message || 'Failed to accept order.', 'error');
      }
    } catch { toast('Network error during acceptance.', 'error'); }
    setActionLoading(false);
  };

  const queueOfflineAction = (orderId: string, status: 'PickedUp' | 'Delivered', pin?: string) => {
    try {
      const queue = JSON.parse(localStorage.getItem('offlineActionsQueue') || '[]');
      if (queue.some((x: any) => x.orderId === orderId && x.status === status)) return;
      queue.push({ orderId, status, pin, timestamp: Date.now() });
      localStorage.setItem('offlineActionsQueue', JSON.stringify(queue));
      
      if (status === 'PickedUp') {
        setOrderStatus(prev => ({ ...prev, [orderId]: 'PickedUp' }));
        toast('Offline fallback: Picked Up saved locally.', 'warning');
        addNotification('warning', 'Offline Action Saved', `Pickup for Order #${orderId.slice(-6)} saved offline.`);
      } else if (status === 'Delivered') {
        setActiveOrders(prev => prev.filter(o => o.id !== orderId));
        setTaskSequence(prev => prev.filter(t => t.orderId !== orderId));
        setPinValues(prev => { const n = { ...prev }; delete n[orderId]; return n; });
        toast('Offline fallback: Delivery saved locally. Will sync when online.', 'warning');
        addNotification('warning', 'Offline Action Saved', `Delivery for Order #${orderId.slice(-6)} saved offline.`);
      }
    } catch (err) {
      console.error('[OFFLINE] Failed to queue action:', err);
    }
  };

  const syncOfflineQueue = useCallback(async () => {
    try {
      const queue = JSON.parse(localStorage.getItem('offlineActionsQueue') || '[]');
      if (queue.length === 0) return;
      
      toast(`Syncing ${queue.length} offline actions...`, 'info');
      let successCount = 0;
      const remainingQueue = [];
      
      for (const item of queue) {
        try {
          const res = await fetch(`${apiUrl}/api/delivery/status/${item.orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: item.status, pin: item.pin })
          });
          if (res.ok) {
            successCount++;
            if (item.status === 'Delivered') {
              socketRef.current?.emit('rider_delivered', {
                orderId: item.orderId,
                riderId: currentDriver._id,
                riderName: currentDriver.name,
                earnings: 30
              });
            }
          } else {
            remainingQueue.push(item);
          }
        } catch (err) {
          remainingQueue.push(item);
        }
      }
      
      localStorage.setItem('offlineActionsQueue', JSON.stringify(remainingQueue));
      if (successCount > 0) {
        toast(`Synced ${successCount} offline actions!`, 'success');
        addNotification('info', 'Offline Sync Complete', `Successfully synced ${successCount} queued actions.`);
        fetchActiveOrders();
        fetchHistory();
        fetchTodayStats();
      }
    } catch (err) {
      console.error('[OFFLINE] Sync queue failed:', err);
    }
  }, [apiUrl, currentDriver._id, currentDriver.name, fetchActiveOrders, fetchHistory, fetchTodayStats, toast, addNotification]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      setIsNetworkConnected(true);
      toast('Network connection restored!', 'success');
      syncOfflineQueue();
    };
    const handleOffline = () => {
      setIsNetworkConnected(false);
      toast('Network connection lost. Offline mode active.', 'warning');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    if (navigator.onLine) {
      syncOfflineQueue();
    }
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncOfflineQueue, toast]);

  const pickUpOrder = async (orderId: string) => {
    if (!isNetworkConnected) {
      queueOfflineAction(orderId, 'PickedUp');
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/delivery/status/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ status: 'PickedUp' })
      });
      if (res.ok) {
        fetchActiveOrders();
        fetchTodayStats();
        fetchHistory();
        setPinValues(prev => ({ ...prev, [orderId]: '' }));
      } else {
        toast('Failed to update status on server.', 'error');
      }
    } catch {
      queueOfflineAction(orderId, 'PickedUp');
    }
    setActionLoading(false);
  };

  const deliverOrder = async (orderId: string) => {
    const pin = pinValues[orderId] || '';
    if (!isNetworkConnected) {
      queueOfflineAction(orderId, 'Delivered', pin);
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/delivery/status/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ status: 'Delivered', pin })
      });
      if (res.ok) {
        const earned = 30; // Flat ₹30 per delivery
        setTodayStats(prev => {
          const next = {
            ...prev,
            earnings: prev.earnings + earned,
            orders: prev.orders + 1,
            streak: prev.streak + 1,
            zenPoints: prev.zenPoints + 5
          };
          localStorage.setItem('todayStats', JSON.stringify(next));
          return next;
        });
        setActiveOrders(prev => prev.filter(o => o.id !== orderId));
        setTaskSequence(prev => prev.filter(t => t.orderId !== orderId));
        setPinValues(prev => { const n = { ...prev }; delete n[orderId]; return n; });
        socketRef.current?.emit('rider_delivered', {
          orderId,
          riderId: currentDriver._id,
          riderName: currentDriver.name,
          earnings: earned
        });
        fetchActiveOrders();
        fetchPendingOrders();
        fetchHistory();
        fetchTodayStats();
      } else {
        const data = await res.json();
        toast(data.message || 'Delivery verification failed.', 'error');
      }
    } catch {
      queueOfflineAction(orderId, 'Delivered', pin);
    }
    setActionLoading(false);
  };

  const reportIssue = (orderId: string, issueType: string) => {
    socketRef.current?.emit('report_issue', {
      orderId,
      senderRole: 'rider',
      issueType,
      riderName: currentDriver.name,
      details: `Captain ${currentDriver.name} reported: ${issueType}`
    });
    toast('Issue reported to Customer & Dispatch', 'success');
  };

  const cancelOrder = async (orderId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/delivery/cancel/${orderId}`, {
        method: 'PUT',
        });
      if (res.ok) {
        setActiveOrders(prev => prev.filter(o => o.id !== orderId));
        setTaskSequence(prev => prev.filter(t => t.orderId !== orderId));
        socketRef.current?.emit('rider_cancelled', { orderId, riderId: currentDriver._id });
        toast('Order released. It will be reassigned.', 'warning');
        fetchActiveOrders();
        fetchPendingOrders();
      } else {
        const data = await res.json();
        toast(data.message || 'Could not cancel order.', 'error');
      }
    } catch { toast('Network error during cancel.', 'error'); }
    setActionLoading(false);
  };

  if (showProfile) {
    return (
      <RiderProfilePage
        driver={driver}
        apiUrl={apiUrl}
        onClose={() => setShowProfile(false)}
        onUpdate={(data: { name: string; photoUrl?: string }) => {
          setCurrentDriver(prev => ({ ...prev, name: data.name, photoUrl: data.photoUrl }));
          localStorage.setItem('driver', JSON.stringify({ ...driver, name: data.name, photoUrl: data.photoUrl }));
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background font-outfit text-white selection:bg-blue-500/30 relative">
      <main className="max-w-4xl mx-auto p-4 md:p-8 pb-32">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <RiderNavbar
            driverName={currentDriver.name}
            driverPhoto={currentDriver.photoUrl || driverPhoto}
            isOnline={isOnline}
            unreadCount={notifications.filter(n => !n.read).length}
            toggleOnline={toggleOnline}
            onLogout={onLogout}
            onOpenProfile={() => setShowProfile(true)}
            onOpenEarnings={() => setShowEarnings(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            currentEarnings={todayStats.earnings}
          />
        </motion.div>

        {!isNetworkConnected && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mt-6 flex items-center justify-between text-red-400 animate-pulse">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-xs font-black uppercase tracking-wider">Offline Mode Active</p>
                <p className="text-[10px] text-red-400/80">Your connection is unstable. Pickup/delivery actions will be queued locally and synced automatically.</p>
              </div>
            </div>
          </div>
        )}

        {!isOnline ? (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
            <OfflineScreen />
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mt-8">
            
            {/* Quick Insights Rail */}
            <div className="md:col-span-4 space-y-6">
               <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
                  <LiveStatsBar
                    todayEarnings={todayStats.earnings}
                    todayOrders={todayStats.orders}
                    zenPoints={todayStats.zenPoints}
                    streak={todayStats.streak}
                  />
               </motion.div>

               <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
                 <WeatherSignal />
               </motion.div>
               
               <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}>
                 <SpeedoWidget />
               </motion.div>
               
               <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
                 <LiveLeaderboard
                    apiUrl={apiUrl}
                    token={driverToken}
                    driverId={driver._id}
                  />
               </motion.div>
            </div>

            {/* Operational Focus Area */}
            <div className="md:col-span-8 space-y-6">
              
              {/* Tab Navigation */}
              <div className="bg-surface border border-white/5 rounded-2xl p-1.5 flex gap-1">
                <button 
                  onClick={() => setActiveTab('pending')}
                  className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] transition-all duration-300 ${activeTab === 'pending' ? 'bg-white text-black' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Incoming
                </button>
                <button 
                  onClick={() => setActiveTab('history')}
                  className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] transition-all duration-300 ${activeTab === 'history' ? 'bg-white text-black' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Past Tasks
                </button>
              </div>

              <AnimatePresence mode="wait">
                {activeTab === 'pending' ? (
                  <motion.div 
                    key="pending-tab"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    {/* Active Tasks Section */}
                    {activeOrders.length > 0 && (
                      <div className="space-y-4">
                        {taskSequence.length > 0 && (
                          <ActiveTaskHUD 
                            task={taskSequence[0]} 
                            remainingTasksCount={taskSequence.length - 1} 
                          />
                        )}

                        {/* Live Map — shown whenever rider has active orders */}
                        <div className="relative w-full h-56 rounded-[24px] overflow-hidden border border-white/5 shadow-2xl">
                          <RiderMap
                            riderPos={riderPos}
                            destinationPos={undefined}
                            orders={[
                              ...activeOrders
                                .filter(o => (orderStatus[o.id] || o.status) === 'Accepted')
                                .map(o => ({ lat: 16.4632, lng: 80.5064, type: 'store' as const })),
                              ...activeOrders
                                .filter(o => (orderStatus[o.id] || o.status) === 'PickedUp')
                                .map(o => ({ lat: 16.468, lng: 80.512, type: 'drop' as const }))
                            ]}
                          />
                          <div className="absolute bottom-3 left-3 z-[1000] bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-xl flex items-center gap-2">
                            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                            <span className="text-[9px] font-black text-white uppercase tracking-widest">Live GPS · {activeOrders.length} Active</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                           <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                           <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest">Active Task Details</p>
                        </div>
                        {activeOrders.map((order) => (
                          <ActiveOrderCard
                            key={order.id}
                            order={order}
                            status={orderStatus[order.id] || order.status || 'Accepted'}
                            actionLoading={actionLoading}
                            pinValue={pinValues[order.id] || ''}
                            apiUrl={apiUrl}
                            token={driverToken}
                            onPinChange={(val) => setPinValues(prev => ({ ...prev, [order.id]: val }))}
                            onPickUp={pickUpOrder}
                            onDeliver={deliverOrder}
                            onChatOpen={(id) => { setActiveChatOrderId(id); setIsChatOpen(true); }}
                            onReportIssue={reportIssue}
                            onCancel={cancelOrder}
                          />
                        ))}
                        <div className="gold-line !opacity-20" />
                      </div>
                    )}

                    {/* Available Tasks Section */}
                    <OrdersList
                      orders={availableOrders}
                      orderTimers={orderTimers}
                      activeTab="pending"
                      onAccept={acceptOrder}
                      onDecline={(id) => setAvailableOrders(prev => prev.filter(o => o.id !== id))}
                      onRefresh={fetchPendingOrders}
                    />
                  </motion.div>
                ) : (
                  <motion.div 
                    key="history-tab"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <OrdersList
                      orders={historyOrders}
                      orderTimers={orderTimers}
                      activeTab="history"
                      onAccept={acceptOrder}
                      onDecline={() => {}}
                      onRefresh={fetchHistory}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
          </div>
        )}

        {/* Global Support Utilities */}
        <SOSPanel
          riderId={currentDriver._id}
          riderName={currentDriver.name}
          socket={socketRef.current}
        />
      </main>

      {/* Critical Status Overlay */}
      <AnimatePresence>
        {showEarnings && (
          <EarningsDashboard 
            onClose={() => setShowEarnings(false)}
            apiUrl={apiUrl}
            stats={todayStats}
          />
        )}
        
        {activeIssue && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-8 left-1/2 -translate-x-1/2 z-[200] w-[90%] max-w-md"
          >
             <div className="bg-red-500/90 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl flex items-center gap-5">
                <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center text-2xl">⚠️</div>
                <div className="flex-1">
                   <p className="text-[9px] font-bold text-white/50 uppercase tracking-widest mb-1">System Alert</p>
                   <p className="text-sm font-bold text-white leading-tight">{activeIssue.issueType}</p>
                </div>
                <button onClick={() => setActiveIssue(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/50">×</button>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ChatDrawer
        orderId={activeChatOrderId}
        userName={driver.name}
        userRole="rider"
        socket={socketRef.current}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />

      <NotificationDrawer
        open={showNotifications}
        notifications={notifications}
        onClose={() => setShowNotifications(false)}
        onClearAll={() => {
          setNotifications([]);
          localStorage.removeItem('rider_notifications');
        }}
        onMarkRead={(id) => {
          setNotifications(prev => {
            const updated = prev.map(n => n.id === id ? { ...n, read: true } : n);
            localStorage.setItem('rider_notifications', JSON.stringify(updated));
            return updated;
          });
        }}
      />
    </div>
  );
}
