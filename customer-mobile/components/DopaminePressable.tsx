import React, { useRef, useCallback, useState } from 'react';
import { TouchableOpacity, Animated, ViewStyle, Platform, View, StyleSheet } from 'react-native';
import { playSound } from '../utils/sounds';

// Hoist outside component to avoid re-creation on every render
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity) as any;
// expo-haptics import removed — disabled on Android to prevent crashes

// ── Dopamine Pressable ──────────────────────────────────────────────────
// A premium interactive wrapper with spring-loaded scale + opacity bounce.
// Upgraded with native GPU-driven 3D touch tilt dynamics for physical realism.

interface DopaminePressableProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: any;
  disabled?: boolean;
  activeScale?: number;       // Scale when pressed (default 0.96)
  springSpeed?: number;       // Spring animation speed (default 18)
  springBounciness?: number;  // Spring bounciness (default 4)
  sound?: 'click' | 'addToCart' | 'tabSwitch' | 'success' | 'worldTransition' | 'pgTransition' | 'rideTransition' | 'premiumRestaurantTransition' | null;
  activeOpacity?: number;
  tilt?: boolean;             // Enable 3D tilt mechanics (default false)
  haptic?: 'light' | 'medium' | 'heavy' | 'success' | 'none'; // Native haptics
}

export default function DopaminePressable({
  children,
  onPress,
  onLongPress,
  style,
  disabled = false,
  activeScale = 0.96,
  springSpeed = 18,
  springBounciness = 4,
  sound = 'click',
  activeOpacity = 0.9,
  tilt = false,
  haptic = 'light',
}: DopaminePressableProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const tiltX = useRef(new Animated.Value(0)).current;
  const tiltY = useRef(new Animated.Value(0)).current;
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const handleLayout = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  }, []);

  const handleTouch = useCallback((e: any) => {
    if (!tilt || Platform.OS === 'web' || !layout.width || !layout.height) return;
    const { locationX, locationY } = e.nativeEvent;

    // Clamp coordinates within layout boundaries
    const x = Math.max(0, Math.min(locationX, layout.width));
    const y = Math.max(0, Math.min(locationY, layout.height));

    const centerX = layout.width / 2;
    const centerY = layout.height / 2;

    // Normalized coordinates from -1 to 1
    const normX = (x - centerX) / centerX;
    const normY = (y - centerY) / centerY;

    Animated.parallel([
      Animated.spring(tiltX, {
        toValue: normX,
        useNativeDriver: false,
        tension: 140,
        friction: 12,
      }),
      Animated.spring(tiltY, {
        toValue: normY,
        useNativeDriver: false,
        tension: 140,
        friction: 12,
      }),
    ]).start();
  }, [tilt, layout]);

  const useNative = !tilt; // Use native driver if not using 3D tilt

  const handlePressIn = useCallback((e: any) => {
    Animated.spring(scaleAnim, {
      toValue: activeScale,
      useNativeDriver: useNative,
      speed: springSpeed,
      bounciness: springBounciness,
    }).start();

    // Disabled expo-haptics on Android to prevent crashes when touching animated items
    // if (Platform.OS !== 'web' && haptic !== 'none') {
    //   try {
    //     if (haptic === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    //     else if (haptic === 'heavy') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    //     else if (haptic === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    //     else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    //   } catch (e) {}
    // }

    if (tilt) {
      handleTouch(e);
    }
  }, [activeScale, springSpeed, springBounciness, tilt, handleTouch, useNative]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: useNative,
      speed: springSpeed,
      bounciness: springBounciness + 2,
    }).start();

    if (tilt) {
      Animated.parallel([
        Animated.spring(tiltX, {
          toValue: 0,
          useNativeDriver: false,
          tension: 160,
          friction: 10,
        }),
        Animated.spring(tiltY, {
          toValue: 0,
          useNativeDriver: false,
          tension: 160,
          friction: 10,
        }),
      ]).start();
    }
  }, [springSpeed, springBounciness, tilt, useNative]);

  // Throttle sound to prevent audio system overload on rapid taps
  const lastSoundRef = useRef(0);
  const handlePress = useCallback(() => {
    if (sound) {
      const now = Date.now();
      if (now - lastSoundRef.current > 150) {
        lastSoundRef.current = now;
        playSound(sound);
      }
    }
    onPress?.();
  }, [onPress, sound]);

  // Interpolations for 3D rotation
  const rotateX = tiltY.interpolate({
    inputRange: [-1, 1],
    outputRange: ['8deg', '-8deg'], // top touch tilts forward, bottom backward
  });

  const rotateY = tiltX.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-8deg', '8deg'], // left touch tilts left, right tilts right
  });

  const transformStyle = [
    ...(Platform.OS !== 'android' ? [{ perspective: 400 }] : []),
    { scale: scaleAnim },
    ...(tilt && Platform.OS !== 'android' ? [{ rotateX }, { rotateY }] : []),
  ];

  // AnimatedTouchable is now hoisted to module scope for performance

  return (
    <AnimatedTouchable
      onLayout={tilt ? handleLayout : undefined}
      onTouchMove={tilt ? handleTouch : undefined}
      activeOpacity={activeOpacity}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={[style, { transform: transformStyle }]}
    >
      {children}
    </AnimatedTouchable>
  );
}

// ── Preset Variants ──

// For cards and larger surfaces — gentler scale, default tilt = true
export function CardPressable({ tilt = true, ...props }: DopaminePressableProps) {
  return <DopaminePressable activeScale={0.98} springSpeed={14} springBounciness={3} sound={props.sound ?? null} tilt={tilt} {...props} />;
}

// For CTA / action buttons — snappier bounce
export function ActionPressable({ tilt = false, ...props }: DopaminePressableProps) {
  return <DopaminePressable activeScale={0.93} springSpeed={20} springBounciness={6} sound={props.sound ?? 'click'} tilt={tilt} haptic="medium" {...props} />;
}

// For add-to-cart buttons — satisfying pop
export function CartPressable({ tilt = false, ...props }: DopaminePressableProps) {
  return <DopaminePressable activeScale={0.9} springSpeed={22} springBounciness={8} sound={props.sound ?? 'addToCart'} tilt={tilt} haptic="heavy" {...props} />;
}
