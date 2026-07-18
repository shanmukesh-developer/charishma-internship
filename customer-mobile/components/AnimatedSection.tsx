import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, ViewStyle, StyleProp, Dimensions, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SW } = Dimensions.get('window');

// ── Staggered Fade-In Section ──────────────────────────────────────────
// Wraps children and animates them in with a staggered slide + fade + scale
// entrance animation. Used throughout the app for premium feel.
interface StaggeredSectionProps {
  children: React.ReactNode;
  delay?: number;    // Extra delay before starting (ms)
  duration?: number; // Animation duration (ms)
  direction?: 'up' | 'down' | 'left' | 'right';
  style?: StyleProp<ViewStyle>;
}

export function StaggeredSection({ children, delay = 0, duration = 500, direction = 'up', style }: StaggeredSectionProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(direction === 'up' ? 30 : direction === 'down' ? -30 : direction === 'left' ? 40 : -40)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: false,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: false,
        }),
      ]).start();
    }, delay);

    return () => clearTimeout(timeout);
  }, []);

  const isHorizontal = direction === 'left' || direction === 'right';

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: fadeAnim,
          transform: [
            isHorizontal ? { translateX: slideAnim } : { translateY: slideAnim },
            { scale: scaleAnim },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ── Shimmer Loading Skeleton ──────────────────────────────────────────
// Premium shimmer effect for loading states. Mimics Zomato/Swiggy skeleton.
interface ShimmerProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function ShimmerSkeleton({ width, height, borderRadius = 12, style }: ShimmerProps) {
  const shimmerAnim = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 2,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();
  }, []);

  const translateX = shimmerAnim.interpolate({
    inputRange: [-1, 2],
    outputRange: [-SW, SW * 2],
  });

  return (
    <View style={[{ width: width as any, height, borderRadius, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' }, style]}>
      <Animated.View style={{ ...StyleSheet.absoluteFill, transform: [{ translateX }] }}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.15)', 'rgba(255,255,255,0.08)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ width: SW, height: '100%' }}
        />
      </Animated.View>
    </View>
  );
}

// ── Restaurant Card Loading Skeleton ──
export function RestaurantCardSkeleton() {
  return (
    <View style={skeletonStyles.card}>
      <ShimmerSkeleton width="100%" height={140} borderRadius={16} />
      <View style={{ padding: 10, gap: 8 }}>
        <ShimmerSkeleton width="70%" height={14} borderRadius={6} />
        <ShimmerSkeleton width="50%" height={10} borderRadius={4} />
        <ShimmerSkeleton width="90%" height={10} borderRadius={4} />
      </View>
    </View>
  );
}

// ── Pulsing Glow Ring ──
// Animated ring that pulses around an element (for promoted items, VIP badges)
interface PulseGlowProps {
  size: number;
  color?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function PulseGlow({ size, color = '#EF4F5F', children, style }: PulseGlowProps) {
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.25, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(pulseScale, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(pulseOpacity, { toValue: 0.6, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          opacity: pulseOpacity,
          transform: [{ scale: pulseScale }],
        }}
      />
      {children}
    </View>
  );
}

// ── Floating Action Pulse ──
// Creates a floating pulse effect behind FABs and CTAs
interface FloatingPulseProps {
  children: React.ReactNode;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export function FloatingPulse({ children, color = '#EF4F5F', style }: FloatingPulseProps) {
  const breathScale = useRef(new Animated.Value(1)).current;
  const breathOpacity = useRef(new Animated.Value(0.15)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(breathScale, { toValue: 1.15, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(breathScale, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
        Animated.sequence([
          Animated.timing(breathOpacity, { toValue: 0.3, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(breathOpacity, { toValue: 0.08, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <View style={[{ position: 'relative' }, style]}>
      <Animated.View
        style={{
          ...StyleSheet.absoluteFill,
          borderRadius: 999,
          backgroundColor: color,
          opacity: breathOpacity,
          transform: [{ scale: breathScale }],
        }}
      />
      {children}
    </View>
  );
}

// ── Animated Counter ──
// Smoothly counts up from 0 to target number (for stats/badges)
interface AnimatedCounterProps {
  target: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  style?: any;
}

export function AnimatedCounter({ target, duration = 1500, prefix = '', suffix = '', style }: AnimatedCounterProps) {
  const animValue = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = React.useState(0);

  useEffect(() => {
    animValue.setValue(0);
    const listener = animValue.addListener(({ value }) => {
      setDisplayValue(Math.round(value));
    });

    Animated.timing(animValue, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // Required for value listener
    }).start();

    return () => animValue.removeListener(listener);
  }, [target]);

  return (
    <Animated.Text style={style}>
      {prefix}{displayValue}{suffix}
    </Animated.Text>
  );
}

// ── Bounce In ──
// Wraps any child with a bouncy entrance (perfect for badges, icons, emojis)
interface BounceInProps {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function BounceIn({ children, delay = 0, style }: BounceInProps) {
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.spring(scale, {
        toValue: 1,
        friction: 3,
        tension: 120,
        useNativeDriver: false,
      }).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}

const skeletonStyles = StyleSheet.create({
  card: {
    width: (SW - 48) / 2,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
});
