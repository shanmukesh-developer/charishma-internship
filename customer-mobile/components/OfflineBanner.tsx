import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Animated, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [isOffline, setIsOffline] = useState(false);
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // Connection check method using AbortController for reliable timeout
  const checkConnection = async (): Promise<boolean> => {
    if (Platform.OS === 'web') {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch('https://clients3.google.com/generate_204', {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' }
      });
      clearTimeout(timeoutId);
      return response.status >= 200 && response.status < 400;
    } catch (err) {
      clearTimeout(timeoutId);
      return false;
    }
  };

  useEffect(() => {
    // Pulse animation loop for offline status dot
    Animated.loop(
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
    ).start();
  }, [pulseAnim]);

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
        timerId = setTimeout(runCheck, 4000);
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
        timerId = setTimeout(runCheck, 10000);
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
        <Text style={styles.text}>CONNECTION INTERRUPTED — OFFLINE MODE</Text>
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
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
});
