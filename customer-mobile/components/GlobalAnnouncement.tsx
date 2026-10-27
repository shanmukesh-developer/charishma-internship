import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Dimensions, Platform, AppState, Alert } from 'react-native';
import { Socket } from 'socket.io-client';
import { connectSocket } from '../utils/socket';
import { API_URL } from '../constants/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { useAuth } from '../context/AuthContext';
import { campusHrefForNotification } from '../modules/campus/campusLinks';
import { rentalHrefForNotification } from '../modules/rentals/rentalLinks';
import { autoRideHrefForNotification } from '../modules/autoRide/autoRideLinks';
import { corideHrefForNotification } from '../modules/corideV2/coRideLinks';
import { campusEventHrefForNotification } from '../modules/campusEvents/campusEventLinks';

let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch (e: any) {
  console.warn('expo-notifications not available:', e.message);
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { safeId } from '../utils/ids';

const { width } = Dimensions.get('window');

interface Announcement {
  message: string;
  type: 'info' | 'warning' | 'promo' | 'emergency';
}

const TYPE_STYLES = {
  info: { bg: 'rgba(26, 26, 28, 0.95)', border: 'rgba(212, 175, 122, 0.6)', icon: '✨' },
  warning: { bg: 'rgba(26, 26, 28, 0.95)', border: 'rgba(245, 158, 11, 0.6)', icon: '⚠️' },
  promo: { bg: 'rgba(26, 26, 28, 0.95)', border: 'rgba(212, 175, 122, 0.8)', icon: '🎁' },
  emergency: { bg: 'rgba(26, 26, 28, 0.95)', border: 'rgba(239, 79, 95, 0.8)', icon: '🚨' },
};

// Push `data.type` values the backend sends for an order (orderController / deliveryPartnerController)
const ORDER_PUSH_TYPES = ['order', 'ORDER_UPDATE', 'GATE_ARRIVAL', 'ORDER_STATUS'];
const CHAT_PUSH_TYPES = ['chat_message', 'NEW_CHAT_MESSAGE', 'FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'FRIEND_NUDGE'];
const NOTIF_HISTORY_KEY = 'zenvy_notifications';
const MAX_HISTORY = 100;

/** Adds one item to the on-device notification inbox (newest first, no duplicates by id). */
const saveToHistory = async (item: { id: string; title: string; body: string; type: string; orderId?: string; data?: any }) => {
  try {
    const stored = await AsyncStorage.getItem(NOTIF_HISTORY_KEY);
    let notifs: any[] = [];
    try { notifs = stored ? JSON.parse(stored) : []; } catch { notifs = []; }
    if (!Array.isArray(notifs)) notifs = [];
    if (notifs.some((n: any) => n?.id === item.id)) return;
    notifs.unshift({ ...item, timestamp: new Date().toISOString(), read: false });
    await AsyncStorage.setItem(NOTIF_HISTORY_KEY, JSON.stringify(notifs.slice(0, MAX_HISTORY)));
  } catch (e) {
    console.warn('Error saving notification history:', e);
  }
};

// Short explainer shown before the system notification dialog.
const PUSH_ASK_LATER_KEY = 'zenvy_push_ask_later_at';
const PUSH_ASK_AGAIN_MS = 3 * 24 * 60 * 60 * 1000;
const askBeforePushPermission = () => new Promise<boolean>((resolve) => {
  Alert.alert(
    'Get order and rider updates',
    'ZCS sends a notification when the store accepts your order, when the rider is at your gate, and when a quote is ready. No ads.',
    [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Turn on', onPress: () => resolve(true) },
    ],
    { cancelable: true, onDismiss: () => resolve(false) },
  );
});

export default function GlobalAnnouncement() {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const slideAnim = React.useRef(new Animated.Value(-150)).current;
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useAuth();
  // Effects depend on the account id only: profile refreshes create a new user object every time
  const userId = (user as any)?._id || (user as any)?.id || null;
  const userRef = React.useRef(user);
  userRef.current = user;
  const insets = useSafeAreaInsets();
  const topOffset = Math.max(insets.top + 8, 16);
  const topOffsetRef = React.useRef(topOffset);
  topOffsetRef.current = topOffset;

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const hideAnnouncement = () => {
    clearHideTimer();
    Animated.timing(slideAnim, {
      toValue: -200,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setAnnouncement(null));
  };
  const hideRef = React.useRef(hideAnnouncement);
  hideRef.current = hideAnnouncement;

  // Register this phone's push token once per signed-in account
  useEffect(() => {
    if (Platform.OS === 'web' || !userId || !Notifications) return;
    let cancelled = false;

    const registerPushToken = async () => {
      try {
        const existing = await Notifications.getPermissionsAsync();
        const existingStatus = existing.status;
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          // Explain first, then show Android's dialog (asked cold, many tapped "Don't allow" and missed
          // order and rider updates). "Not now" asks again after 3 days; a hard "Don't allow" is respected.
          if (existing.canAskAgain === false) return;
          const lastNo = Number(await AsyncStorage.getItem(PUSH_ASK_LATER_KEY).catch(() => null)) || 0;
          if (Date.now() - lastNo < PUSH_ASK_AGAIN_MS) return;
          const wants = await askBeforePushPermission();
          if (cancelled) return;
          if (!wants) {
            await AsyncStorage.setItem(PUSH_ASK_LATER_KEY, String(Date.now())).catch(() => {});
            return;
          }
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted' || cancelled) return;

        const Constants = require('expo-constants').default;
        let fcmToken = '';
        try {
          const deviceTokenData = await Notifications.getDevicePushTokenAsync();
          fcmToken = deviceTokenData.data;
        } catch (deviceError) {
          console.warn('FCM native token failed in GlobalAnnouncement, trying Expo fallback:', deviceError);
          let projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
          if (!projectId || projectId === 'your-eas-project-id') {
            projectId = undefined;
          }
          const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
          fcmToken = tokenData.data;
        }

        if (!fcmToken || cancelled) return;

        // Sync with backend (the server detaches this token from any other account)
        const { apiFetch } = require('../utils/auth');
        const res = await apiFetch(`${API_URL}/api/users/fcm-token`, {
          method: 'POST',
          body: JSON.stringify({
            fcmToken,
            appVersion: Constants.expoConfig?.version,
            platform: Platform.OS,
          })
        });
        if (res.ok) {
          // Remembered so logout can unregister this device
          await AsyncStorage.setItem('zenvy_push_token', fcmToken).catch(() => {});
        } else {
          console.warn('[PUSH] Auto-register failed:', res.status);
        }
      } catch (err) {
        console.warn('[PUSH] Auto-register error:', err);
      }
    };

    const timer = setTimeout(registerPushToken, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web' || !Notifications) return;
    let responseSub: any;
    // Set notification handler at runtime (not module scope — avoids Android crash)
    try {
      Notifications.setNotificationHandler({
        handleNotification: async (notification: any) => {
          // Admin broadcasts also arrive over the socket as an in-app toast: don't show them twice
          const type = notification?.request?.content?.data?.type;
          const inApp = type === 'global_broadcast';
          return {
            shouldShowAlert: !inApp,
            shouldPlaySound: !inApp,
            shouldSetBadge: false,
            shouldShowBanner: !inApp,
            shouldShowList: true,
          };
        },
      });

      // Register notification category for calls with action buttons (WhatsApp style)
      Notifications.setNotificationCategoryAsync('incoming-call', [
        {
          identifier: 'ANSWER',
          buttonTitle: '🟢 Answer',
          options: {
            opensAppToForeground: true,
          },
        },
        {
          identifier: 'DECLINE',
          buttonTitle: '🔴 Decline',
          options: {
            opensAppToForeground: false,
            isDestructive: true,
          },
        },
      ]).catch(() => {});
    } catch (e) {
      console.warn('Failed to set notification handler:', e);
    }

    // Opens the screen a tapped notification refers to
    const handleResponse = async (response: any, delayMs = 0) => {
      try {
        // Clear so the same tap is never handled twice
        try { Notifications.clearLastNotificationResponse?.(); } catch {}
        const { actionIdentifier, notification } = response || {};
        const data = notification?.request?.content?.data || {};
        const { router: nav } = require('expo-router');
        const go = (path: string) => setTimeout(() => {
          try { nav.push(path as any); } catch (e) { console.warn('Notification nav failed:', e); }
        }, delayMs);

        const campusHref = campusHrefForNotification(data.type, data);
        const rentalHref = rentalHrefForNotification(data.type, data);
        const autoRideHref = autoRideHrefForNotification(data.type, data);
        const campusEventHref = campusEventHrefForNotification(data.type, data);
        const corideHref = corideHrefForNotification(data.type, data);
        if (data.type === 'CAMPUS_BOOKING') {
          // In-Campus Booking: payment reviewed, accepted, preparing, ready for pickup, collected, cancelled
          const bid = safeId(data.bookingId);
          go(bid ? `/campus-booking/order/${bid}` : '/campus-booking/bookings');
        } else if (corideHref) {
          // Co-Ride: regular ride live / reminders / cancellations (data.path or data.poolId)
          go(corideHref);
        } else if (campusEventHref) {
          // Zenvy Campus Events: registrations, tickets, team invitations, event updates, organizer reviews
          go(campusEventHref);
        } else if (autoRideHref) {
          // Zenvy Auto-Ride: seat bookings, full-auto requests, trip updates (full, departure, delays, refunds)
          go(autoRideHref);
        } else if (rentalHref) {
          // Rentals: booking requests / confirmations / reminders, licence and listing reviews
          go(rentalHref);
        } else if (campusHref) {
          // Campus chats, calls, friend requests, verification results, birthdays and The Wall
          go(campusHref);
        } else if (data.type === 'BIRTHDAY_ALERT') {
          go('/friends?tab=friends&sub=pulse&segment=posts');
        } else if (data.type === 'promo' || data.type === 'offer') {
          go('/others');
        } else if (['badge', 'BADGE', 'SPIN_EARNED', 'points', 'coupon', 'streak_nudge'].includes(data.type)) {
          go('/rewards');
        } else if (data.type === 'PG_BOOKING' || data.type === 'PG_BOOKING_STATUS') {
          go('/others?tab=stays');
        } else if (typeof data.type === 'string' && data.type.startsWith('WALL_')) {
          go('/friends?tab=friends&sub=pulse&segment=wall');
        } else if (data.type === 'abandoned_cart') {
          go('/basket');
        } else if (ORDER_PUSH_TYPES.includes(data.type)) {
          const orderIdStr = safeId(data.orderId) || safeId(data.id);
          go(orderIdStr ? `/tracking/${orderIdStr}` : '/(tabs)/orders');
        } else if (CHAT_PUSH_TYPES.includes(data.type)) {
          go('/friends');
        } else if (data.type === 'SUPPORT_TICKET') {
          go('/support');
        } else if (data.type === 'SERVICE_QUOTE') {
          // "Quote ready for …: tap to approve" opens that booking in Orders > Services
          const bid = safeId(data.bookingId);
          go(bid ? `/(tabs)/orders?segment=services&bookingId=${bid}` : '/(tabs)/orders?segment=services');
        } else if (data.type && data.type !== 'chat_message') {
          // Anything else (campaigns, broadcasts, new types): the in-app inbox lists it
          go('/notifications');
        }
      } catch (err) {
        console.warn('Error handling notification response:', err);
      }
    };

    try {
      responseSub = Notifications.addNotificationResponseReceivedListener((r: any) => handleResponse(r));
    } catch (e) {
      console.warn('Failed to add notification response listener:', e);
    }

    // The notification tap that cold-launched the app fired before this listener existed
    try {
      const last = Notifications.getLastNotificationResponse?.();
      if (last) handleResponse(last, 600); // give the navigator a moment to mount
    } catch (e) {
      console.warn('Failed to read last notification response:', e);
    }

    // Save pushes received in the foreground to the notification inbox
    let notificationSub: any;
    try {
      notificationSub = Notifications.addNotificationReceivedListener((notification: any) => {
        const { title, body, data } = notification?.request?.content || {};
        if (data?.type === 'call' || data?.source === 'zenvy_socket') return; // socket toasts are saved below
        saveToHistory({
          id: notification?.request?.identifier || `${Date.now()}-${Math.random()}`,
          title: title || '📢 ZCS',
          body: body || '',
          type: data?.type || 'info',
          ...(data?.orderId ? { orderId: String(data.orderId) } : {}),
          ...(data?.screen || data?.chatId ? { data: {
            screen: data.screen, chatId: data.chatId, kind: data.kind, friendshipId: data.friendshipId,
            // Campus Events pushes carry ids only; keep them so an inbox tap opens the right screen.
            ...(data.screen === 'campus_event' ? { eventId: data.eventId, registrationId: data.registrationId, teamId: data.teamId, ticketId: data.ticketId } : {}),
            ...(data.screen === 'campus_booking' ? { bookingId: data.bookingId } : {}),
          } } : {}),
        });
      });
    } catch (e) {
      console.warn('Failed to add notification received listener:', e);
    }

    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('incoming-calls', {
        name: 'Incoming Calls 📞',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500, 250, 500, 250, 500],
        lightColor: '#10B981',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      }).catch((e: any) => console.warn('Failed to set channel:', e));
    }

    // Live campus announcements (public broadcast, no sign-in needed)
    // Uses the app's one shared socket (a second connection doubled every server event)
    const socket: Socket = connectSocket();

    const onAnnouncement = async (data: Announcement) => {
      if (!data || typeof data.message !== 'string' || !data.message) return;
      let processedMessage = data.message;
      if (processedMessage.includes('{{username}}')) {
        let userName = 'there';
        const currentUser = userRef.current;
        if (currentUser && currentUser.name) {
          userName = currentUser.name.split(' ')[0];
        } else {
          try {
            const stored = await AsyncStorage.getItem('zenvy_user');
            if (stored) {
              const u = JSON.parse(stored);
              if (u.name) userName = u.name.split(' ')[0];
            }
          } catch (e) {}
        }
        processedMessage = processedMessage.replace(/{{username}}/g, userName);
      }
      const title = data.type === 'emergency' ? '🚨 ZCS Alert' : data.type === 'promo' ? '🎉 ZCS Update' : '📢 ZCS Announcement';

      // In the background the toast is invisible: show a system notification instead
      if (AppState.currentState !== 'active') {
        try {
          await Notifications.scheduleNotificationAsync({
            content: { title, body: processedMessage, data: { type: data.type, source: 'zenvy_socket' } },
            trigger: null,
          });
        } catch (err) {
          console.warn('Native notification failed', err);
        }
      }

      saveToHistory({ id: `ann-${Date.now()}-${Math.random()}`, title, body: processedMessage, type: data.type || 'info' });

      setAnnouncement({ ...data, message: processedMessage });

      Animated.spring(slideAnim, {
        toValue: topOffsetRef.current,
        useNativeDriver: true,
        friction: 8,
        tension: 40
      }).start();

      // A newer announcement restarts the auto-hide timer
      clearHideTimer();
      if (data.type !== 'emergency') {
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          hideRef.current();
        }, 8000);
      }
    };
    socket.on('global_announcement', onAnnouncement);

    return () => {
      clearHideTimer();
      socket.off('global_announcement', onAnnouncement);
      if (responseSub) responseSub.remove();
      if (notificationSub) notificationSub.remove();
    };
  }, []);

  if (!announcement) return null;

  const style = TYPE_STYLES[announcement.type] || TYPE_STYLES.info;

  const handlePress = () => {
    hideAnnouncement();
    if (announcement.message.includes('Birthday')) {
      router.push('/friends?tab=friends&sub=pulse&segment=posts' as any);
    } else {
      router.push('/notifications' as any);
    }
  };

  return (
    <Animated.View style={[s.container, { transform: [{ translateY: slideAnim }] }]}>
      <BlurView intensity={80} tint="dark" style={[s.blur, { backgroundColor: style.bg, borderColor: style.border }]}>
        <View style={s.content}>
          <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 8 }} onPress={handlePress}>
            <Text style={s.icon}>{style.icon}</Text>
            <Text style={s.message} numberOfLines={2}>{announcement.message}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={hideAnnouncement} style={s.closeBtn}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
      </BlurView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  blur: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingVertical: 12,
  },
  icon: {
    fontSize: 22,
    marginRight: 12,
  },
  message: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  closeBtn: {
    padding: 8,
    marginLeft: 8,
  },
  closeText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 18,
    fontWeight: '900',
  }
});
