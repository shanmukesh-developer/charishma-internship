import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, ViewStyle, StyleProp, Dimensions, Platform, type LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useReduceMotion, isReduceMotionOn } from '../utils/reduceMotion';

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
  /** Where the section sits in its parent (e.g. a form scrolling to the section that needs the user). */
  onLayout?: (e: LayoutChangeEvent) => void;
}

export function StaggeredSection({ children, delay = 0, duration = 500, direction = 'up', style, onLayout }: StaggeredSectionProps) {
  // Reduce motion: start (and stay) at the final state.
  const still = isReduceMotionOn();
  const fadeAnim = useRef(new Animated.Value(still ? 1 : 0)).current;
  const slideAnim = useRef(new Animated.Value(still ? 0 : direction === 'up' ? 30 : direction === 'down' ? -30 : direction === 'left' ? 40 : -40)).current;
  const scaleAnim = useRef(new Animated.Value(still ? 1 : 0.95)).current;
  const reduce = useReduceMotion();

  useEffect(() => {
    if (!reduce) return;
    fadeAnim.setValue(1);
    slideAnim.setValue(0);
    scaleAnim.setValue(1);
  }, [reduce]);

  useEffect(() => {
    if (isReduceMotionOn()) return;
    const timeout = setTimeout(() => {
      if (isReduceMotionOn()) return;
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    }, delay);

    return () => clearTimeout(timeout);
  }, []);

  const isHorizontal = direction === 'left' || direction === 'right';

  return (
    <Animated.View
      onLayout={onLayout}
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
  const reduce = useReduceMotion();

  useEffect(() => {
    if (reduce) {
      shimmerAnim.setValue(-1);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 2,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [reduce]);

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
  const reduce = useReduceMotion();

  useEffect(() => {
    if (reduce) {
      pulseScale.setValue(1);
      pulseOpacity.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.25, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.6, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduce]);

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Animated.View
        pointerEvents="none"
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
  /** Size of the floating bar, so a screen can keep its scroll content clear of it. */
  onLayout?: (e: LayoutChangeEvent) => void;
}

export function FloatingPulse({ children, color = '#EF4F5F', style, onLayout }: FloatingPulseProps) {
  const breathScale = useRef(new Animated.Value(1)).current;
  const breathOpacity = useRef(new Animated.Value(0.15)).current;
  const reduce = useReduceMotion();

  useEffect(() => {
    if (reduce) {
      breathScale.setValue(1);
      breathOpacity.setValue(0.15);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(breathScale, { toValue: 1.15, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(breathScale, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(breathOpacity, { toValue: 0.3, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(breathOpacity, { toValue: 0.08, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduce]);

  return (
    <View style={[{ position: 'relative' }, style]} onLayout={onLayout}>
      <Animated.View
        pointerEvents="none"
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
  const [displayValue, setDisplayValue] = React.useState(0);

  // A number in a Text can't run on the native driver, so instead of a JS-driven Animated.timing (a JS
  // callback every frame, throttled to a re-render every 40 ms) the same ease-out count runs on one
  // 40 ms timer: the same steps on screen, without the per-frame animation loop.
  useEffect(() => {
    if (isReduceMotionOn()) {
      setDisplayValue(Math.round(target));
      return;
    }
    const start = Date.now();
    const ease = Easing.out(Easing.cubic);
    setDisplayValue(0);
    const t = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / Math.max(1, duration));
      setDisplayValue(Math.round(target * ease(k)));
      if (k >= 1) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
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
  const scale = useRef(new Animated.Value(isReduceMotionOn() ? 1 : 0)).current;
  const reduce = useReduceMotion();

  useEffect(() => {
    if (reduce) scale.setValue(1);
  }, [reduce]);

  useEffect(() => {
    if (isReduceMotionOn()) return;
    const timeout = setTimeout(() => {
      if (isReduceMotionOn()) return;
      Animated.spring(scale, {
        toValue: 1,
        friction: 3,
        tension: 120,
        useNativeDriver: true,
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
