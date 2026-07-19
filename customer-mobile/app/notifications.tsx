import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { StaggeredSection, BounceIn } from '../components/AnimatedSection';
import DopaminePressable from '../components/DopaminePressable';
import { LinearGradient } from 'expo-linear-gradient';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  type: 'info' | 'warning' | 'promo' | 'emergency' | 'friend_accepted' | 'chat_message';
  read: boolean;
}

const DEFAULT_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'default-1',
    title: '🚀 Zenvy Elite Status Unlocked!',
    body: 'Welcome to the premium campus circle! Enjoy 50% flat discount coupons, zero surge fees, and free priority delivery on all local orders. 🎁',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    type: 'promo',
    read: false,
  },
  {
    id: 'default-2',
    title: '🏆 Blockwars Challenge is Live!',
    body: 'Amaravathi Central is currently leading the weekly board. Order now to earn extra ZPoints and secure the block trophy! ⚡',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    type: 'info',
    read: false,
  },
  {
    id: 'default-3',
    title: '🚨 Zone Surge Alert: Rainfall',
    body: 'High demand detected in Central Hostels. Delivery speeds are optimized for priority partners. Stay indoors, we will bring your food warm! 🌧️',
    timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
    type: 'warning',
    read: true,
  }
];

export default function NotificationsScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      const stored = await AsyncStorage.getItem('zenvy_notifications');
      if (stored) {
        setNotifications(JSON.parse(stored));
      } else {
        await AsyncStorage.setItem('zenvy_notifications', JSON.stringify(DEFAULT_NOTIFICATIONS));
        setNotifications(DEFAULT_NOTIFICATIONS);
      }
    } catch (e) {
      console.error('Error loading notifications:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  const markAllAsRead = async () => {
    const updated = notifications.map(n => ({ ...n, read: true }));
    setNotifications(updated);
    try {
      await AsyncStorage.setItem('zenvy_notifications', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
  };

  const clearAllNotifications = () => {
    Alert.alert(
      'Clear Notifications',
      'Are you sure you want to clear all notification history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            setNotifications([]);
            try {
              await AsyncStorage.setItem('zenvy_notifications', JSON.stringify([]));
            } catch (e) {
              console.error(e);
            }
          }
        }
      ]
    );
  };

  const deleteNotification = async (id: string) => {
    const updated = notifications.filter(n => n.id !== id);
    setNotifications(updated);
    try {
      await AsyncStorage.setItem('zenvy_notifications', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
  };

  const toggleReadStatus = async (id: string) => {
    const updated = notifications.map(n => n.id === id ? { ...n, read: !n.read } : n);
    setNotifications(updated);
    try {
      await AsyncStorage.setItem('zenvy_notifications', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const getIconForType = (type: string) => {
    switch (type) {
      case 'emergency': return '🚨';
      case 'warning': return '⚠️';
      case 'promo': return '🎁';
      case 'info': return '📢';
      case 'friend_accepted': return '🤝';
      case 'chat_message': return '💬';
      default: return '📢';
    }
  };

  const getTypeColors = (type: string) => {
    if (isDark) {
      switch (type) {
        case 'emergency': return ['#EF4F5F', '#EF4F5F'];
        case 'warning': return ['#F59E0B', '#F59E0B'];
        case 'promo': return ['#C9A84C', '#C9A84C'];
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

  const txt = isDark ? '#FFF' : '#111';
  const txtSec = isDark ? '#AAA' : '#666';
  const bg = isDark ? '#0A0A0C' : '#FAFAFA';
  const cardBg = isDark ? '#141416' : '#FFF';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const goldColor = isDark ? COLORS.gold : COLORS.red;

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border, backgroundColor: bg }]}>
        <TouchableOpacity
          style={[s.backBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}
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
          <Text style={[s.subText, { color: goldColor }]}>CAMPUS BROADCASTS & ALERTS</Text>
          <Text style={[s.title, { color: txt }]}>Notifications</Text>
        </View>

        {notifications.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={markAllAsRead} style={s.actionHeaderBtn}>
              <Text style={[s.actionHeaderBtnText, { color: goldColor }]}>READ ALL</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearAllNotifications} style={s.actionHeaderBtn}>
              <Text style={[s.actionHeaderBtnText, { color: '#EF4444' }]}>CLEAR ALL</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Main Content */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={goldColor} />
        </View>
      ) : notifications.length === 0 ? (
        <ScrollView
          contentContainerStyle={[s.center, { flexGrow: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={goldColor} />}
        >
          <BounceIn>
            <View style={s.emptyState}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🔔</Text>
              <Text style={[s.emptyTitle, { color: txt }]}>ALL CAUGHT UP!</Text>
              <Text style={[s.emptyDesc, { color: txtSec }]}>
                No new alerts or announcements at this time. Pull down to refresh.
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
              {notifications.map((n, idx) => {
                const indicatorColor = getTypeColors(n.type)[0];
                return (
                  <DopaminePressable
                    key={n.id || String(idx)}
                    activeScale={0.97}
                    sound="click"
                    onPress={() => toggleReadStatus(n.id)}
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
                        <Text style={{ fontSize: 18 }}>{getIconForType(n.type)}</Text>
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
  subText: { fontSize: 8, fontWeight: '900', letterSpacing: 2 },
  title: { fontSize: 18, fontWeight: '900' },

  actionHeaderBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  actionHeaderBtnText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
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
    letterSpacing: 3,
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
