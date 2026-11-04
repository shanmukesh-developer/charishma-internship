import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { COLORS } from '../constants/theme';

interface ServerWakeupOverlayProps {
  visible: boolean;
  onWakeupComplete?: () => void;
  /** Called when the server answers the health check again (e.g. to re-run a failed request). */
  onRetry?: () => void;
  /** Called when the user dismisses the banner with ✕. Falls back to onWakeupComplete. */
  onCancel?: () => void;
  /** Text shown when the server is still unreachable after all retries. */
  offlineText?: string;
}

/**
 * Non-blocking wakeup overlay — shows a subtle top banner instead of a 
 * full-screen modal so users can browse the app while the backend spins up.
 * Auto-retries every 10s in the background and auto-dismisses after success or timeout.
 */
export default function ServerWakeupOverlay({ visible, onWakeupComplete, onRetry, onCancel, offlineText }: ServerWakeupOverlayProps) {
  const [retryCount, setRetryCount] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'retrying' | 'connected' | 'offline'>('connecting');
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const dotPulse = useRef(new Animated.Value(0.3)).current;
  const MAX_RETRIES = 18; // 18 retries × 10 s = 3 min (a restart takes 2 to 3 minutes)

  // Latest callbacks + pending timers, so nothing fires after the banner unmounts
  const cbRef = useRef({ onWakeupComplete, onRetry, onCancel });
  cbRef.current = { onWakeupComplete, onRetry, onCancel };
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timersRef.current = timersRef.current.filter(x => x !== t);
      fn();
    }, ms);
    timersRef.current.push(t);
  };
  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (!visible) {
      // Slide out
      Animated.timing(slideAnim, { toValue: -120, duration: 300, useNativeDriver: true }).start();
      return;
    }

    setStatus('connecting');
    setRetryCount(0);

    // Slide in
    Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }).start();

    // Pulse animation for the dot
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(dotPulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    pulseLoop.start();

    // Auto-dismiss after 4 seconds — let the user browse while we retry in background
    const autoDismiss = setTimeout(() => {
      Animated.timing(slideAnim, { toValue: -120, duration: 300, useNativeDriver: true }).start();
    }, 4000);

    return () => {
      pulseLoop.stop();
      clearTimeout(autoDismiss);
    };
  }, [visible]);

  // Background retry logic
  useEffect(() => {
    if (!visible) return;
    let attempts = 0;
    let done = false;

    const retryInterval = setInterval(async () => {
      if (done) return;
      attempts += 1;
      setRetryCount(attempts);
      if (attempts >= MAX_RETRIES) {
        done = true;
        clearInterval(retryInterval);
        setStatus('offline');
        Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }).start();
        // Let the user carry on; the screen decides what to show next
        later(() => {
          Animated.timing(slideAnim, { toValue: -120, duration: 300, useNativeDriver: true }).start();
          cbRef.current.onWakeupComplete?.();
        }, 4000);
        return;
      }
      setStatus('retrying');

      // Try a quick health-check ping
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const { API_URL } = require('../constants/api');
        const res = await fetch(`${API_URL}/api/health`, { signal: controller.signal });
        if (res.ok && !done) {
          done = true;
          clearInterval(retryInterval);
          setStatus('connected');
          Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }).start();
          later(() => {
            Animated.timing(slideAnim, { toValue: -120, duration: 300, useNativeDriver: true }).start();
            cbRef.current.onRetry?.();
            cbRef.current.onWakeupComplete?.();
          }, 1200);
        }
      } catch {
        // Still waking up, will retry
      } finally {
        clearTimeout(timeout);
      }
    }, 10000);

    return () => {
      done = true;
      clearInterval(retryInterval);
    };
  }, [visible]);

  if (!visible) return null;

  const statusConfig = {
    connecting: { text: 'ZENV is waking up…', color: COLORS.gold || '#C9A84C' },
    retrying: { text: 'ZENV is waking up. This can take a minute or two…', color: '#F59E0B' },
    connected: { text: 'Connected. Loading…', color: '#10B981' },
    offline: { text: offlineText || "ZENV is taking longer than usual. Please try again in a minute.", color: '#6B7280' },
  };

  const { text, color } = statusConfig[status];

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      <View style={[styles.bannerInner, { borderColor: `${color}33` }]}>
        <View style={styles.bannerLeft}>
          <Animated.View style={[styles.statusDot, { backgroundColor: color, opacity: dotPulse }]} />
          <Text style={styles.bannerText} numberOfLines={2}>{text}</Text>
        </View>
        {status !== 'connected' && (
          <TouchableOpacity 
            style={styles.dismissBtn}
            onPress={() => {
              Animated.timing(slideAnim, { toValue: -120, duration: 200, useNativeDriver: true }).start();
              later(() => {
                if (cbRef.current.onCancel) cbRef.current.onCancel();
                else cbRef.current.onWakeupComplete?.();
              }, 300);
            }}
          >
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        )}
        {status === 'connecting' && (
          <ActivityIndicator size="small" color={color} style={{ marginLeft: 8 }} />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 0 : 48,
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 10,
  },
  bannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(20,20,22,0.95)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bannerIcon: {
    fontSize: 14,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E5E7EB',
    flex: 1,
  },
  dismissBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  dismissText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '700',
  },
});
