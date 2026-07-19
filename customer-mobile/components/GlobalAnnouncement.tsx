import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Dimensions } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { API_URL } from '../constants/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { useAuth } from '../context/AuthContext';
import * as Notifications from 'expo-notifications';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

interface Announcement {
  message: string;
  type: 'info' | 'warning' | 'promo' | 'emergency';
}

const TYPE_STYLES = {
  info: { bg: 'rgba(26, 26, 28, 0.95)', border: 'rgba(201, 168, 76, 0.6)', icon: '✨' },
  warning: { bg: 'rgba(26, 26, 28, 0.95)', border: 'rgba(245, 158, 11, 0.6)', icon: '⚠️' },
  promo: { bg: 'rgba(26, 26, 28, 0.95)', border: 'rgba(201, 168, 76, 0.8)', icon: '🎁' },
  emergency: { bg: 'rgba(26, 26, 28, 0.95)', border: 'rgba(239, 79, 95, 0.8)', icon: '🚨' },
};

export default function GlobalAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const slideAnim = React.useRef(new Animated.Value(-150)).current;
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const topOffset = Math.max(insets.top + 8, 16);

  useEffect(() => {
    if (!user) return;
    
    const registerPushToken = async () => {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;
        
        let fcmToken = '';
        try {
          const deviceTokenData = await Notifications.getDevicePushTokenAsync();
          fcmToken = deviceTokenData.data;
        } catch (deviceError) {
          console.warn('FCM native token failed in GlobalAnnouncement, trying Expo fallback:', deviceError);
          const Constants = require('expo-constants').default;
          let projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
          if (!projectId || projectId === 'your-eas-project-id') {
            projectId = undefined; 
          }
          const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
          fcmToken = tokenData.data;
        }
        
        if (!fcmToken) return;
        
        // Sync with backend
        const { apiFetch } = require('../utils/auth');
        const res = await apiFetch(`${API_URL}/api/users/fcm-token`, {
          method: 'POST',
          body: JSON.stringify({
            fcmToken,
            appVersion: '1.0.0'
          })
        });
        if (res.ok) {
          console.log('[PUSH] Push token auto-registered successfully.');
        } else {
          console.warn('[PUSH] Auto-register failed:', res.status);
        }
      } catch (err) {
        console.warn('[PUSH] Auto-register error:', err);
      }
    };
    
    const timer = setTimeout(registerPushToken, 3000);
    return () => clearTimeout(timer);
  }, [user]);

  useEffect(() => {
    // Set notification handler at runtime (not module scope — avoids Android crash)
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
    } catch (e) {
      console.warn('Failed to set notification handler:', e);
    }

    // Request notification permissions gracefully
    Notifications.requestPermissionsAsync().catch(() => {});

    const socket: Socket = io(API_URL, { transports: ['websocket', 'polling'] });
    
    socket.on('global_announcement', async (data: Announcement) => {
      let processedMessage = data.message;
      if (processedMessage.includes('{{username}}')) {
        let userName = 'User';
        if (user && user.name) {
          userName = user.name.split(' ')[0];
        } else {
          try {
            const stored = await AsyncStorage.getItem('user');
            if (stored) {
              const u = JSON.parse(stored);
              if (u.name) userName = u.name.split(' ')[0];
            }
          } catch (e) {}
        }
        processedMessage = processedMessage.replace(/{{username}}/g, userName);
      }

      // Fire a native OS push notification
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: data.type === 'emergency' ? '🚨 Zenvy Alert' : data.type === 'promo' ? '🎉 Zenvy Update' : '📢 Zenvy',
            body: processedMessage,
            data: { type: data.type },
          },
          trigger: null,
        });
      } catch (err) {
        console.warn('Native notification failed', err);
      }

      setAnnouncement({ ...data, message: processedMessage });
      
      Animated.spring(slideAnim, {
        toValue: topOffset,
        useNativeDriver: true,
        friction: 8,
        tension: 40
      }).start();

      if (data.type !== 'emergency') {
        setTimeout(() => {
          hideAnnouncement();
        }, 8000);
      }
    });

    return () => { socket.disconnect(); };
  }, [user, topOffset]);

  const hideAnnouncement = () => {
    Animated.timing(slideAnim, {
      toValue: -200,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setAnnouncement(null));
  };

  if (!announcement) return null;

  const style = TYPE_STYLES[announcement.type] || TYPE_STYLES.info;

  return (
    <Animated.View style={[s.container, { transform: [{ translateY: slideAnim }] }]}>
      <BlurView intensity={80} tint="dark" style={[s.blur, { backgroundColor: style.bg, borderColor: style.border }]}>
        <View style={s.content}>
          <Text style={s.icon}>{style.icon}</Text>
          <Text style={s.message}>{announcement.message}</Text>
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
