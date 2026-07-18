import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, ActivityIndicator, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/theme';

interface ServerWakeupOverlayProps {
  visible: boolean;
  onWakeupComplete: () => void;
}

export default function ServerWakeupOverlay({ visible, onWakeupComplete }: ServerWakeupOverlayProps) {
  const [countdown, setCountdown] = useState(90);
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      setCountdown(90);
      
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true })
        ])
      ).start();

      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            onWakeupComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [visible, onWakeupComplete, pulseAnim]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent={true} animationType="fade">
      <View style={styles.container}>
        <LinearGradient
          colors={['rgba(10,10,11,0.95)', '#0A0A0B']}
          style={StyleSheet.absoluteFill}
        />
        
        <View style={styles.content}>
          <Animated.View style={[styles.glowCircle, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={{ fontSize: 48, marginBottom: 20 }}>🚀</Text>
          <Text style={styles.title}>WAKING UP SERVERS</Text>
          <Text style={styles.subtitle}>
            Zenvy's free cloud backend is currently booting up. This usually takes about 90 seconds. Please wait...
          </Text>
          
          <View style={styles.timerBox}>
            <Text style={styles.timerText}>{countdown}s</Text>
          </View>
          
          <ActivityIndicator size="large" color={COLORS.gold} style={{ marginTop: 30 }} />
          <Text style={styles.footerText}>We will automatically connect when ready.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  content: {
    alignItems: 'center',
    padding: 30,
    backgroundColor: 'rgba(26,26,28,0.9)',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(201,168,76,0.3)',
    width: '85%',
  },
  glowCircle: {
    position: 'absolute',
    top: '30%',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(201,168,76,0.15)',
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 2,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  timerBox: {
    backgroundColor: 'rgba(201,168,76,0.1)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  timerText: {
    fontSize: 24,
    fontWeight: '900',
    color: COLORS.gold,
  },
  footerText: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
  }
});
