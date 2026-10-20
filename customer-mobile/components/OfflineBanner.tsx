import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Animated, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../constants/api';
import { lastServerResponseAt } from '../utils/serverWake';

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [isOffline, setIsOffline] = useState(false);
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // Offline only when nothing answers: no response from Zenvy in the last 20 s (any status counts,
  // a cold-start 502/503 too), then both the Zenvy ping and a public 204 endpoint fail with a generous
  // timeout, twice in a row. Slow campus Wi-Fi or a server restart is never shown as "offline".
  const failStreak = useRef(0);
  const reachable = async (url: string): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      await fetch(url, { signal: controller.signal, headers: { 'Cache-Control': 'no-cache' } });
      return true; // any HTTP answer means the device is online
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  };
  const checkConnection = async (): Promise<boolean> => {
    if (Platform.OS === 'web') {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    }
    if (Date.now() - lastServerResponseAt() < 20000) { failStreak.current = 0; return true; }
    const online = (await reachable(`${API_URL}/api/ping`)) || (await reachable('https://clients3.google.com/generate_204'));
    if (online || Date.now() - lastServerResponseAt() < 20000) { failStreak.current = 0; return true; }
    failStreak.current += 1;
    return failStreak.current < 2;
  };

  useEffect(() => {
    // Pulse animation loop for offline status dot (only while the banner is shown)
    if (!isOffline) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim, isOffline]);

  useEffect(() => {
    let active = true;
    let timerId: any = null;

    const runCheck = async () => {
      const online = await checkConnection();
      if (!active) return;

      if (!online) {
        if (!isOffline) {
          setIsOffline(true);
          // Slide banner down
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 50,
            friction: 8,
          }).start();
        }
        // Check frequently if offline
        timerId = setTimeout(runCheck, 5000);
      } else {
        if (isOffline) {
          setIsOffline(false);
          // Slide banner back up
          Animated.timing(slideAnim, {
            toValue: -100,
            duration: 300,
            useNativeDriver: true,
          }).start();
        }
        // Check less frequently if online
        timerId = setTimeout(runCheck, failStreak.current > 0 ? 5000 : 15000);
      }
    };

    runCheck();

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [isOffline, slideAnim]);

  if (Platform.OS === 'web') return null;
  if (!isOffline) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.banner,
        {
          transform: [{ translateY: slideAnim }],
          paddingTop: Platform.OS === 'ios' ? insets.top : insets.top + 8,
        },
      ]}
    >
      <View style={styles.content}>
        <Animated.View style={[styles.dot, { opacity: pulseAnim }]} />
        <Text style={styles.text}>You're offline. Check your internet connection.</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#D43F4F', // Crimson red theme
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999998,
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
});
