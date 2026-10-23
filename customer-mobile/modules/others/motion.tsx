/**
 * Others motion and state kit. Subtle, premium, native-driver animations that respect the system
 * "reduce motion" setting:
 *   PressScale     press feedback (scale 0.97, optional light haptic) for cards, buttons and chips
 *   FadeInUp       staggered fade-and-rise entrance (first 8 items only, stagger capped)
 *   SlideIn        step / view transitions (re-runs when `stepKey` changes)
 *   BounceOnChange small bounce when a count goes up (basket badge)
 *   ProgressBar    animated step-flow progress
 *   StateCard      designed empty / error / offline / waking-up / feature-off cards
 *   SkeletonList   shimmer placeholders for first loads
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View,
  type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ShimmerLoader from '../../components/ShimmerLoader';
import { RADIUS, SPACE, TYPE, useOthersTheme, type OthersSection } from './othersTheme';
import { useConnectionState } from '../../utils/offlineStatus';

// ── Reduce motion ────────────────────────────────────────────────────────────

let reduceMotion = false;
let reduceKnown = false;
const listeners = new Set<(v: boolean) => void>();
const ensureReduceMotion = () => {
  if (reduceKnown) return;
  reduceKnown = true;
  AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = !!v; listeners.forEach((l) => l(reduceMotion)); }).catch(() => {});
  try {
    AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => { reduceMotion = !!v; listeners.forEach((l) => l(reduceMotion)); });
  } catch { /* web: no event */ }
};

/** True while the user asked the system to reduce motion. */
export function useReducedMotion() {
  ensureReduceMotion();
  const [v, setV] = useState(reduceMotion);
  useEffect(() => {
    listeners.add(setV);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}

// ── Press feedback ───────────────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed (default 0.97). */
  scaleTo?: number;
  /** Light haptic tick on press (only where the screen already gives haptic feedback). */
  haptic?: boolean;
  children?: React.ReactNode;
};

export function PressScale({ style, scaleTo = 0.97, haptic, onPressIn, onPressOut, onPress, disabled, children, ...rest }: PressScaleProps) {
  const reduce = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 6 : 0 }).start();
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => { if (!reduce && !disabled) to(scaleTo); onPressIn?.(e); }}
      onPressOut={(e: GestureResponderEvent) => { if (!reduce) to(1); onPressOut?.(e); }}
      onPress={(e: GestureResponderEvent) => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ── Entrances and transitions ────────────────────────────────────────────────

/** Fade and rise in on mount. Items from index 8 on appear at once (no long cascades). */
export function FadeInUp({ index = 0, children, style, distance = 10 }: { index?: number; children: React.ReactNode; style?: StyleProp<ViewStyle>; distance?: number }) {
  const reduce = useReducedMotion();
  const animate = !reduce && index < 8;
  const v = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.timing(v, { toValue: 1, duration: 320, delay: Math.min(index, 7) * 45, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!animate) return <View style={style}>{children}</View>;
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Slides content in from the side whenever `stepKey` changes (direction 1 = forward, -1 = back). */
export function SlideIn({ stepKey, direction = 1, children, style }: { stepKey: string; direction?: 1 | -1; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduce) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);
  return (
    <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }), transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [28 * direction, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Small bounce whenever `value` goes up (e.g. the basket count after an add). */
export function BounceOnChange({ value, children, style }: { value: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const s = useRef(new Animated.Value(1)).current;
  const prev = useRef(value);
  useEffect(() => {
    const up = value > prev.current;
    prev.current = value;
    if (!up || reduce) return;
    s.setValue(1);
    Animated.sequence([
      Animated.timing(s, { toValue: 1.22, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(s, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 12 }),
    ]).start();
  }, [value, reduce, s]);
  return <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>;
}

/** Animated progress bar (0..1) for step flows. */
export function ProgressBar({ progress, color, track, height = 3, style }: { progress: number; color: string; track: string; height?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const v = useRef(new Animated.Value(progress)).current;
  useEffect(() => {
    if (reduce) { v.setValue(progress); return; }
    Animated.timing(v, { toValue: progress, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress, reduce, v]);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }, style]}
      accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
      {w > 0 ? (
        <Animated.View style={{ width: w, height, borderRadius: height, backgroundColor: color, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-w, 0] }) }] }} />
      ) : null}
    </View>
  );
}

// ── States ───────────────────────────────────────────────────────────────────

export type StateKind = 'empty' | 'error' | 'offline' | 'waking' | 'off' | 'signin';

const STATE_ICON: Record<StateKind, string> = {
  empty: 'search-outline',
  error: 'alert-circle-outline',
  offline: 'cloud-offline-outline',
  waking: 'hourglass-outline',
  off: 'time-outline',
  signin: 'person-circle-outline',
};

/** Designed state card: icon in the section accent, one title, one line, one action. */
export function StateCard({ kind = 'empty', section = 'neutral', title, message, actionLabel, onAction, icon, mci, style }: {
  kind?: StateKind; section?: OthersSection; title: string; message?: string; actionLabel?: string; onAction?: () => void;
  icon?: string; mci?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useOthersTheme(section);
  // A failed load is told apart using the app-wide connection state (offline banner + server wake-up).
  const conn = useConnectionState();
  const failure = kind === 'error' || kind === 'offline' || kind === 'waking';
  const eff: StateKind = !failure ? kind : conn === 'offline' ? 'offline' : conn === 'waking' ? 'waking' : kind === 'error' ? 'error' : 'error';
  const changed = failure && eff !== kind;
  if (changed || (failure && eff !== 'error')) {
    title = eff === 'offline' ? 'You are offline' : eff === 'waking' ? 'Waking the server up' : 'Could not load this';
    message = eff === 'offline' ? 'Check your internet connection and try again.'
      : eff === 'waking' ? 'The server is starting up. This takes a few seconds the first time.'
        : (kind === 'error' ? message : 'Something went wrong. Try again in a moment.');
  }
  kind = eff;
  const danger = kind === 'error';
  const name = failure ? STATE_ICON[kind] : (icon || STATE_ICON[kind]);
  return (
    <View style={[st.state, { backgroundColor: t.card }, t.shadow, style]} accessibilityRole="summary">
      <View style={[st.stateIcon, { backgroundColor: danger ? t.errorTint : t.tint }]}>
        {mci
          ? <MaterialCommunityIcons name={name as any} size={26} color={danger ? t.error : t.accent} />
          : <Ionicons name={name as any} size={24} color={danger ? t.error : t.accent} />}
      </View>
      <Text style={[TYPE.subheading, { color: t.text, textAlign: 'center' }]} accessibilityRole="header">{title}</Text>
      {message ? <Text style={[TYPE.body, { color: t.sub, textAlign: 'center', marginTop: SPACE.xs }]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <PressScale onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel}
          style={[st.stateBtn, danger || kind === 'offline' || kind === 'waking'
            ? { borderWidth: 1.5, borderColor: t.accent }
            : { backgroundColor: t.solid }]}>
          <Text style={[TYPE.bodyStrong, { color: danger || kind === 'offline' || kind === 'waking' ? t.accent : '#FFFFFF', fontWeight: '700' }]}>{actionLabel}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

/**
 * Shimmer rows for a first load (list cards). After 8 s a quiet line says why it is taking long
 * (offline / server starting / slow network), so a long wait never looks like a frozen screen.
 */
/** Shown under any loading skeleton once a load passes 8 s: says why it is slow (offline, server waking, slow network). */
export function SlowLoadHint({ delay = 8000, style }: { delay?: number; style?: StyleProp<ViewStyle> }) {
  const conn = useConnectionState();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  const t = useOthersTheme('neutral');
  if (!slow) return null;
  return (
    <View style={[st.slowRow, style]} accessibilityLiveRegion="polite">
      <Ionicons name={conn === 'offline' ? 'cloud-offline-outline' : conn === 'waking' ? 'hourglass-outline' : 'time-outline'} size={16} color={t.sub} />
      <Text style={[TYPE.label, { color: t.sub, fontWeight: '500', flex: 1 }]}>
        {conn === 'offline'
          ? 'You seem to be offline. We will keep trying.'
          : conn === 'waking'
            ? 'The server is starting up. This takes a few seconds.'
            : 'Still loading. Your network may be slow.'}
      </Text>
    </View>
  );
}

export function SkeletonList({ count = 3, height = 88, style, hint = true }: { count?: number; height?: number; style?: StyleProp<ViewStyle>; hint?: boolean }) {
  return (
    <View style={[{ gap: SPACE.gap }, style]} accessible accessibilityLabel="Loading" accessibilityState={{ busy: true }}>
      {Array.from({ length: count }).map((_, i) => <ShimmerLoader key={i} width="100%" height={height} borderRadius={RADIUS.card} />)}
      {hint ? <SlowLoadHint /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  state: { alignItems: 'center', borderRadius: RADIUS.card, paddingVertical: SPACE.xl + 4, paddingHorizontal: SPACE.xl, marginBottom: SPACE.gap },
  stateIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.md },
  slowRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.xs },
  stateBtn: { marginTop: SPACE.lg, minHeight: 44, minWidth: 150, paddingHorizontal: SPACE.xl - 4, borderRadius: RADIUS.button, alignItems: 'center', justifyContent: 'center' },
});
