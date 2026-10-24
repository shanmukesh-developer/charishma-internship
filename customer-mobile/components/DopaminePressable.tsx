import React, { useRef, useCallback, useMemo } from 'react';
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
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'tab' | 'checkbox' | 'radio' | 'none';
  accessibilityHint?: string;
  accessibilityState?: { disabled?: boolean; selected?: boolean; checked?: boolean; busy?: boolean };
  testID?: string;
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
  accessibilityLabel,
  accessibilityRole,
  accessibilityHint,
  accessibilityState,
  testID,
}: DopaminePressableProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const tiltX = useRef(new Animated.Value(0)).current;
  const tiltY = useRef(new Animated.Value(0)).current;
  // Size for the tilt maths lives in a ref: it used to be state, so every tilt card re-rendered once
  // more right after mounting (and again on every size change) just to store its own size.
  const layoutRef = useRef({ width: 0, height: 0 });

  const handleLayout = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.layout;
    layoutRef.current = { width, height };
  }, []);

  // All springs here (scale and tilt) run on the native driver: they only drive transforms, so the UI
  // thread animates them and a busy JS thread can't make a press feel late. (The tilt springs were
  // JS-driven, which also forced the press scale onto JS on iOS.)
  const handleTouch = useCallback((e: any) => {
    const layout = layoutRef.current;
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
        useNativeDriver: true,
        tension: 140,
        friction: 12,
      }),
      Animated.spring(tiltY, {
        toValue: normY,
        useNativeDriver: true,
        tension: 140,
        friction: 12,
      }),
    ]).start();
  }, [tilt]);

  // The 3D tilt is iOS-only (Android drops the rotation), so Android skips the per-finger-move springs.
  const tiltOn = tilt && Platform.OS === 'ios';
  // react-native-web has no native animated module (it falls back to JS on its own).
  const useNative = Platform.OS !== 'web';

  const handlePressIn = useCallback((e: any) => {
    Animated.spring(scaleAnim, {
      toValue: activeScale,
      useNativeDriver: useNative,
      speed: springSpeed,
      bounciness: springBounciness,
    }).start();

    // Note: expo-haptics disabled on Android to prevent crashes when touching animated items

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

    if (tiltOn) { // the tilt values are only on screen on iOS
      Animated.parallel([
        Animated.spring(tiltX, {
          toValue: 0,
          useNativeDriver: useNative,
          tension: 160,
          friction: 10,
        }),
        Animated.spring(tiltY, {
          toValue: 0,
          useNativeDriver: useNative,
          tension: 160,
          friction: 10,
        }),
      ]).start();
    }
  }, [springSpeed, springBounciness, tiltOn, useNative]);

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

  // Interpolations for 3D rotation and the transform, built once (new animated nodes on every render
  // made each card's animated style re-attach on every parent render).
  const transformStyle = useMemo(() => {
    const rotateX = tiltY.interpolate({
      inputRange: [-1, 1],
      outputRange: ['8deg', '-8deg'], // top touch tilts forward, bottom backward
    });
    const rotateY = tiltX.interpolate({
      inputRange: [-1, 1],
      outputRange: ['-8deg', '8deg'], // left touch tilts left, right tilts right
    });
    return [
      ...(Platform.OS !== 'android' ? [{ perspective: 400 }] : []),
      { scale: scaleAnim },
      ...(tiltOn ? [{ rotateX }, { rotateY }] : []),
    ];
  }, [tiltOn, tiltX, tiltY, scaleAnim]);

  // AnimatedTouchable is now hoisted to module scope for performance

  return (
    <AnimatedTouchable
      onLayout={tiltOn ? handleLayout : undefined}
      onTouchMove={tiltOn ? handleTouch : undefined}
      activeOpacity={activeOpacity}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      // react-native-web turns role "button" into a real <button>, and cards contain buttons (heart,
      // add), which nests <button>s on web only. Native keeps the role for screen readers.
      accessibilityRole={Platform.OS === 'web' && accessibilityRole === 'button' ? undefined : accessibilityRole}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState ?? (disabled ? { disabled: true } : undefined)}
      testID={testID}
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
