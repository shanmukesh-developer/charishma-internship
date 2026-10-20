import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useDietary } from '../context/DietaryContext';
import { StaggeredSection, BounceIn } from '../components/AnimatedSection';
import DopaminePressable from '../components/DopaminePressable';
import { LinearGradient } from 'expo-linear-gradient';
import { apiFetch } from '../utils/auth';
import { useLiveSync } from '../utils/useLiveSync';
import { campusHrefForNotification } from '../modules/campus/campusLinks';
import { rentalHrefForNotification } from '../modules/rentals/rentalLinks';
import { autoRideHrefForNotification } from '../modules/autoRide/autoRideLinks';
import { campusEventHrefForNotification } from '../modules/campusEvents/campusEventLinks';
import { safeId } from '../utils/ids';
import { Ionicons } from '@expo/vector-icons';
import { formatISTDate } from '../utils/format';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  type: string;
  read: boolean;
  isVeg?: boolean;
  orderId?: string;
  /** Routing info from the push (chatId, screen, ...) for campus / friends notifications. */
  data?: any;
}

const LOCAL_KEY = 'zenvy_notifications';

// Signed-in users: the list comes from the server (GET /api/notifications), so pushes that
// arrived while the app was closed are here too. Guests only have this device's announcements.
// Older app versions seeded made-up sample alerts with ids 'default-*'; they are purged on load.
const isLegacySample = (n: any) => typeof n?.id === 'string' && n.id.startsWith('default-');

const fromServer = (n: any): NotificationItem => ({
  id: String(n.id || n._id),
  title: n.title || '',
  body: n.body || '',
  timestamp: n.createdAt || '',
  type: n.type || 'info',
  read: !!n.read,
  orderId: n.orderId || n.data?.orderId || undefined,
  data: n.data && typeof n.data === 'object' ? n.data : undefined,
});

const markLocalAllRead = () => {
  AsyncStorage.getItem(LOCAL_KEY).then(stored => {
    if (!stored) return;
    try {
      const list = JSON.parse(stored);
      if (Array.isArray(list)) {
        AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(list.map((n: any) => ({ ...n, read: true })))).catch(() => {});
      }
    } catch {}
  }).catch(() => {});
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { user } = useAuth();
  const { dietMode } = useDietary();
  const signedIn = !!user;
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  const hadUnreadRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Leaving the notification center marks everything as read, so the Home bell badge clears.
      markLocalAllRead();
      if (signedInRef.current && hadUnreadRef.current) {
        apiFetch('/api/notifications/read-all', { method: 'PUT' }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    hadUnreadRef.current = notifications.some(n => !n.read);
  }, [notifications]);

  const loadLocal = async (): Promise<NotificationItem[]> => {
    const stored = await AsyncStorage.getItem(LOCAL_KEY);
    let parsed: any = [];
    try { parsed = stored ? JSON.parse(stored) : []; } catch { parsed = []; }
    const list: NotificationItem[] = Array.isArray(parsed) ? parsed : [];
    const loaded = list.filter(n => n && !isLegacySample(n) && (n.title || n.body));
    if (loaded.length !== list.length) {
      await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(loaded));
    }
    return loaded;
  };

  const loadNotifications = async () => {
    try {
      let list: NotificationItem[];
      if (signedIn) {
        try {
          const res = await apiFetch('/api/notifications?limit=100');
          const data = await res.json().catch(() => null);
          if (!res.ok || !data || !Array.isArray(data.notifications)) throw new Error(`status ${res.status}`);
          list = data.notifications.map(fromServer);
          if (mountedRef.current) setLoadError(null);
        } catch (e) {
          console.warn('Notifications sync error:', e);
          // Show what this phone received while we can't reach Zenvy.
          list = await loadLocal();
          if (mountedRef.current) setLoadError("Couldn't refresh your notifications. Pull down to try again.");
        }
      } else {
        list = await loadLocal();
      }
      list.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      if (mountedRef.current) setNotifications(list);
    } catch (e) {
      console.error('Error loading notifications:', e);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  // Live sync: admin broadcasts / announcements land in the list without a pull-to-refresh
  useLiveSync({
    types: ['announcement'],
    onChange: () => { loadNotifications(); },
  });

  const saveLocal = (list: NotificationItem[]) => {
    if (signedIn) return;
    AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(list)).catch(() => {});
  };

  const markAllAsRead = async () => {
    const updated = notifications.map(n => ({ ...n, read: true }));
    setNotifications(updated);
    markLocalAllRead();
    if (signedIn) {
      apiFetch('/api/notifications/read-all', { method: 'PUT' }).catch(() => {});
    } else {
      saveLocal(updated);
    }
  };

  const clearAllNotifications = () => {
    Alert.alert(
      'Clear notifications',
      'Clear your whole notification history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            const previous = notifications;
            setNotifications([]);
            AsyncStorage.setItem(LOCAL_KEY, JSON.stringify([])).catch(() => {});
            if (!signedIn) return;
            try {
              const res = await apiFetch('/api/notifications', { method: 'DELETE' });
              if (!res.ok) throw new Error(`status ${res.status}`);
            } catch {
              if (mountedRef.current) setNotifications(previous);
              Alert.alert('Could not clear', 'Please check your connection and try again.');
            }
          }
        }
      ]
    );
  };

  const deleteNotification = async (id: string) => {
    const previous = notifications;
    const updated = notifications.filter(n => n.id !== id);
    setNotifications(updated);
    if (!signedIn) {
      saveLocal(updated);
      return;
    }
    try {
      const res = await apiFetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`status ${res.status}`);
    } catch {
      if (mountedRef.current) setNotifications(previous);
      Alert.alert("Couldn't delete", 'Try again.');
    }
  };

  const handleNotificationPress = async (n: NotificationItem) => {
    // 1. Mark as read
    if (!n.read) {
      const updated = notifications.map(item => item.id === n.id ? { ...item, read: true } : item);
      setNotifications(updated);
      if (signedIn) {
        apiFetch(`/api/notifications/${encodeURIComponent(n.id)}/read`, { method: 'PUT' }).catch(() => {});
      } else {
        saveLocal(updated);
      }
    }

    // 2. Contextual navigation
    if (safeId(n.orderId)) {
      router.push(`/tracking/${safeId(n.orderId)}` as any);
    } else if (n.type === 'SUPPORT_TICKET') {
      router.push('/support' as any);
    } else if (n.type === 'ORDER_STATUS' || n.type === 'ORDER_UPDATE') {
      router.push('/(tabs)/orders' as any);
    } else if (n.type === 'SPIN_EARNED' || n.type === 'WALL_WINNER_REWARD') {
      router.push('/rewards' as any);
    } else if (campusEventHrefForNotification(n.type, n.data)) {
      // Campus Events registrations, tickets, team invitations, event updates and organizer reviews
      router.push(campusEventHrefForNotification(n.type, n.data) as any);
    } else if (autoRideHrefForNotification(n.type, n.data)) {
      // Zenvy Auto-Ride bookings, full-auto requests and trip updates
      router.push(autoRideHrefForNotification(n.type, n.data) as any);
    } else if (rentalHrefForNotification(n.type, n.data)) {
      // Rental requests, confirmations, reminders, licence and listing reviews
      router.push(rentalHrefForNotification(n.type, n.data) as any);
    } else if (campusHrefForNotification(n.type, n.data)) {
      // Friend requests, chats, verification results, birthdays and The Wall open the right Campus screen
      router.push(campusHrefForNotification(n.type, n.data) as any);
    } else if ((n.type === 'PG_BOOKING_STATUS' || n.type === 'PG_BOOKING') && safeId(n.data?.pgId)) {
      router.push(`/pg/${safeId(n.data?.pgId)}` as any);
    } else if (n.type === 'BADGE') {
      router.push('/rewards' as any);
    } else if (n.type === 'PROMO' || n.type === 'SURGE' || n.type === 'abandoned_cart' || n.type === 'streak_nudge') {
      router.push('/(tabs)' as any);
    } else if (n.title || n.body) {
      // Nothing to open for this one, so show the full message.
      Alert.alert(n.title || 'Notification', n.body || undefined);
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    if (!isoString || Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    if (formatISTDate(date) === formatISTDate(new Date(now.getTime() - 86400000))) {
      return 'Yesterday';
    }

    return formatISTDate(date);
  };

  const getIconForType = (type: string): React.ComponentProps<typeof Ionicons>['name'] => {
    switch (type) {
      case 'emergency': return 'alert-circle-outline';
      case 'warning': return 'warning-outline';
      case 'promo': case 'PROMO': case 'campaign': return 'gift-outline';
      case 'info': case 'global_broadcast': return 'megaphone-outline';
      case 'friend_accepted': case 'FRIEND_ACCEPTED': case 'FRIEND_REQUEST': return 'people-outline';
      case 'FRIEND_NUDGE': return 'hand-left-outline';
      case 'CAMPUS_VERIFICATION': return 'school-outline';
      case 'chat_message': case 'NEW_CHAT_MESSAGE': return 'chatbubble-outline';
      case 'ORDER_UPDATE': case 'ORDER_STATUS': return 'bicycle-outline';
      case 'GATE_ARRIVAL': return 'notifications-outline';
      case 'SUPPORT_TICKET': return 'help-buoy-outline';
      case 'PG_BOOKING_STATUS': case 'PG_BOOKING': return 'home-outline';
      case 'BADGE': case 'WALL_WINNER_REWARD': return 'trophy-outline';
      case 'SPIN_EARNED': return 'sync-outline';
      case 'streak_nudge': return 'flame-outline';
      case 'BIRTHDAY_ALERT': return 'gift-outline';
      case 'abandoned_cart': return 'basket-outline';
      default: return 'megaphone-outline';
    }
  };

  const getTypeColors = (type: string) => {
    if (isDark) {
      switch (type) {
        case 'emergency': return ['#EF4F5F', '#EF4F5F'];
        case 'warning': return ['#F59E0B', '#F59E0B'];
        case 'promo': return ['#D4AF7A', '#D4AF7A'];
        case 'friend_accepted': return ['#10B981', '#10B981'];
        case 'chat_message': return ['#3B82F6', '#3B82F6'];
        default: return ['#3B82F6', '#3B82F6'];
      }
    } else {
      switch (type) {
        case 'emergency': return ['#EF4F5F', '#EF4F5F'];
        case 'warning': return ['#D97706', '#D97706'];
        case 'promo': return ['#B45309', '#B45309'];
        case 'friend_accepted': return ['#059669', '#059669'];
        case 'chat_message': return ['#2563EB', '#2563EB'];
        default: return ['#2563EB', '#2563EB'];
      }
    }
  };

  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const bg = colors.bg;
  const cardBg = colors.card;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;

  const nonVegWords = ['chicken', 'mutton', 'meat', 'beef', 'pork', 'fish', 'prawn', 'wings', 'tandoori chicken', 'shawarma'];
  const displayedNotifications = notifications.filter(n => {
    // Veg mode hides non-veg promotions only, never announcements ('info') or the user's own order or account alerts.
    const isPromo = ['promo', 'PROMO', 'SURGE'].includes(n.type);
    if (dietMode === 'veg' && isPromo) {
      const text = (n.title + ' ' + n.body).toLowerCase();
      const hasNonVeg = nonVegWords.some(word => text.includes(word));
      if (hasNonVeg) return false;
    }
    return true;
  });

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border, backgroundColor: cardBg }]}>
        <TouchableOpacity
          style={[s.backBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}
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
          <Text style={{ fontSize: 16, color: txt }}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.subText, { color: goldColor }]}>
            {(() => {
              const unread = displayedNotifications.filter(n => !n.read).length;
              return unread > 0 ? `${unread} unread` : 'All caught up';
            })()}
          </Text>
          <Text style={[s.title, { color: txt }]}>Notifications</Text>
        </View>
        {notifications.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={markAllAsRead} style={s.actionHeaderBtn} accessibilityRole="button" accessibilityLabel="Mark all read">
            <Text style={[s.actionHeaderBtnText, { color: goldColor }]}>Mark all read</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={clearAllNotifications} style={s.actionHeaderBtn} accessibilityRole="button" accessibilityLabel="Clear all">
            <Text style={[s.actionHeaderBtnText, { color: COLORS.red }]}>Clear all</Text>
          </TouchableOpacity>
        </View>
        )}
      </View>

      {loadError && !loading ? (
        <TouchableOpacity activeOpacity={0.85} onPress={handleRefresh} style={{ marginHorizontal: 16, marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)' }}>
          <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{loadError}</Text>
        </TouchableOpacity>
      ) : null}

      {/* Main Content */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={goldColor} />
        </View>
      ) : displayedNotifications.length === 0 ? (
        <ScrollView
          contentContainerStyle={[s.center, { flexGrow: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={goldColor} />}
        >
          <BounceIn>
            <View style={s.emptyState}>
              <Ionicons name="notifications-outline" size={44} color={txtSec} style={{ marginBottom: 12 }} />
              <Text style={[s.emptyTitle, { color: txt }]}>No notifications yet</Text>
              <Text style={[s.emptyDesc, { color: txtSec }]}>
                Order updates and announcements will show here. Pull down to refresh.
              </Text>
            </View>
          </BounceIn>
        </ScrollView>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={goldColor} />}
        >
          <StaggeredSection delay={50} direction="up">
            <View style={s.list}>
              {displayedNotifications.map((n, idx) => {
                const indicatorColor = getTypeColors(n.type)[0];
                return (
                  <DopaminePressable
                    key={n.id || String(idx)}
                    activeScale={0.97}
                    sound="click"
                    onPress={() => handleNotificationPress(n)}
                    style={[
                      s.card,
                      {
                        backgroundColor: cardBg,
                        borderColor: border,
                      },
                      !n.read && {
                        borderColor: indicatorColor,
                        borderLeftWidth: 4,
                        borderLeftColor: indicatorColor
                      }
                    ]}
                  >
                    <View style={s.cardHeader}>
                      <View style={[s.iconBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: border, borderWidth: 1 }]}>
                        <Ionicons name={getIconForType(n.type)} size={20} color={indicatorColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={s.titleRow}>
                          <Text style={[s.cardTitle, { color: txt }, !n.read && { fontWeight: '900' }]} numberOfLines={1}>
                            {n.title}
                          </Text>
                          <Text style={[s.timeText, { color: txtSec }]}>{formatTime(n.timestamp)}</Text>
                        </View>
                        <Text style={[s.cardBody, { color: txtSec }, !n.read && { color: txt, fontWeight: '700' }]}>
                          {n.body}
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={s.deleteBtn}
                        onPress={() => deleteNotification(n.id)}
                        accessibilityRole="button"
                        accessibilityLabel="Delete notification"
                      >
                        <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '700' }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </DopaminePressable>
                );
              })}
            </View>
          </StaggeredSection>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  backIcon: { fontSize: 32, fontWeight: '300' },
  subText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  title: { fontSize: 18, fontWeight: '900' },

  actionHeaderBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  actionHeaderBtnText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },

  emptyState: {
    alignItems: 'center',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 16,
    maxWidth: 240,
  },

  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  list: {
    gap: 12,
  },

  card: {
    padding: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },

  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    flex: 1,
  },

  timeText: {
    fontSize: 9,
    fontWeight: '600',
  },

  cardBody: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 16,
  },

  deleteBtn: {
    padding: 6,
    marginLeft: 4,
    alignSelf: 'center',
  }
});
