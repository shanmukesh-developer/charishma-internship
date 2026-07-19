import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { StaggeredSection, BounceIn } from '../components/AnimatedSection';
import DopaminePressable from '../components/DopaminePressable';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  type: 'info' | 'warning' | 'promo' | 'emergency';
  read: boolean;
}

const DEFAULT_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'default-1',
    title: '🚀 Welcome to Zenvy Elite!',
    body: 'You are now part of our premium campus network. Enjoy 50% discount codes, priority support, and instant free delivery on all orders.',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
    type: 'promo',
    read: false,
  },
  {
    id: 'default-2',
    title: '🏆 Blockwars Arena is Live!',
    body: 'The Amaravathi Central block challenge is heating up! Place orders to help your block climb the weekly leaderboard and win the exclusive rewards.',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(), // 5 hours ago
    type: 'info',
    read: false,
  },
  {
    id: 'default-3',
    title: '⚡ Zone Surge Alert',
    body: 'High demand detected in Central Zone. Delivery speeds are optimized for priority partners to guarantee lightning fast service.',
    timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), // 1 day ago
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
        // Pre-seed with default premium announcements
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
    
    // Check if yesterday
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
      case 'warning': return '⚡';
      case 'promo': return '🎁';
      default: return '📢';
    }
  };

  const getTypeColor = (type: string) => {
    if (isDark) {
      switch (type) {
        case 'emergency': return 'rgba(239, 79, 95, 0.15)';
        case 'warning': return 'rgba(245, 158, 11, 0.15)';
        case 'promo': return 'rgba(201, 168, 76, 0.15)';
        default: return 'rgba(59, 130, 246, 0.15)';
      }
    } else {
      switch (type) {
        case 'emergency': return '#FEE2E2';
        case 'warning': return '#FEF3C7';
        case 'promo': return '#FEF9C3';
        default: return '#DBEAFE';
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
              {notifications.map((n, idx) => (
                <TouchableOpacity 
                  key={n.id || String(idx)} 
                  activeOpacity={0.9}
                  onPress={() => toggleReadStatus(n.id)}
                  style={[
                    s.card, 
                    { 
                      backgroundColor: cardBg, 
                      borderColor: border,
                    },
                    !n.read && {
                      borderColor: isDark ? 'rgba(201, 168, 76, 0.4)' : 'rgba(239, 79, 95, 0.3)',
                      borderLeftWidth: 4,
                      borderLeftColor: goldColor
                    }
                  ]}
                >
                  <View style={s.cardHeader}>
                    <View style={[s.iconBadge, { backgroundColor: getTypeColor(n.type) }]}>
                      <Text style={{ fontSize: 16 }}>{getIconForType(n.type)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={s.titleRow}>
                        <Text style={[s.cardTitle, { color: txt }, !n.read && { fontWeight: '900' }]} numberOfLines={1}>
                          {n.title.toUpperCase()}
                        </Text>
                        <Text style={[s.timeText, { color: txtSec }]}>{formatTime(n.timestamp)}</Text>
                      </View>
                      <Text style={[s.cardBody, { color: txtSec }, !n.read && { color: txt }]}>
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
                </TouchableOpacity>
              ))}
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
    width: 38,
    height: 38,
    borderRadius: 12,
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
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    flex: 1,
  },
  
  timeText: {
    fontSize: 9,
    fontWeight: '600',
  },
  
  cardBody: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  
  deleteBtn: {
    padding: 6,
    marginLeft: 4,
    alignSelf: 'center',
  }
});
