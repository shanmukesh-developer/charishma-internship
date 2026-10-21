import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from '../../../../components/lucide';
import type { FriendsSubTab } from '../../../../types/campus';
import { FriendsColors, FriendsGradients, FMotion, FR, FS, FT, SectionTints, fui } from '../friendsTheme';

/** True when the OS asks for reduced motion (updates live). */
export const useReduceMotion = () => {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
};

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Friends button. Primary = brand gradient pill with dark ink (AA 9:1), secondary = tinted,
 * ghost = outline, danger = soft red. Presses scale to 0.97 (native driver; skipped on reduce-motion).
 */
export const FriendsButton: React.FC<{
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  compact?: boolean;
}> = ({ label, onPress, variant = 'primary', icon, loading, disabled, style, accessibilityLabel, accessibilityHint, compact }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const to = (v: number) => {
    if (reduce) return;
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };
  const off = disabled || loading;
  const height = compact ? 40 : variant === 'primary' ? 48 : 44;
  const textColor =
    variant === 'primary' ? FriendsColors.accentInk : variant === 'secondary' ? FriendsColors.accent : variant === 'danger' ? FriendsColors.danger : FriendsColors.ink;

  const content = (
    <View style={[styles.btnInner, { minHeight: height }]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon}
          <Text style={[styles.btnText, { color: textColor }, compact && { fontSize: 13 }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }, off && { opacity: 0.55 }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => to(0.97)}
        onPressOut={() => to(1)}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!off, busy: !!loading }}
        style={[
          styles.btn,
          variant === 'secondary' && fui.secondaryBtn,
          variant === 'ghost' && fui.ghostBtn,
          variant === 'danger' && styles.danger,
          { minHeight: height },
        ]}
      >
        {variant === 'primary' ? (
          <LinearGradient colors={FriendsGradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.gradient, { minHeight: height }]}>
            {content}
          </LinearGradient>
        ) : (
          content
        )}
      </Pressable>
    </Animated.View>
  );
};

/**
 * Stack header for every Friends sub-screen: 44px back target, title + subtitle, optional right slot,
 * and a hairline tinted with the section colour.
 */
export const FriendsHeader: React.FC<{
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  right?: React.ReactNode;
  section?: FriendsSubTab;
  backLabel?: string;
}> = ({ title, subtitle, onBack, right, section, backLabel = 'Back' }) => {
  const tint = section ? SectionTints[section] : null;
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={fui.iconBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel={backLabel} activeOpacity={0.7}>
        <ChevronLeft size={24} color={FriendsColors.ink} strokeWidth={2.2} />
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {tint ? <View style={[styles.dot, { backgroundColor: tint.fg }]} /> : null}
          <Text style={[FT.h2, { flexShrink: 1 }]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text style={[FT.small, { marginTop: 1 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {tint ? (
        <LinearGradient
          colors={[tint.line, 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerLine}
          pointerEvents="none"
        />
      ) : null}
    </View>
  );
};

/** Was a light falloff along a card's top edge; cards are flat now, so it renders nothing. */
export const CardGlow: React.FC<{ tint?: string; height?: number }> = () => null;

/** Gradient ring around an avatar (live hosts, highlighted people). */
export const GradientRing: React.FC<{ size: number; children: React.ReactNode; colors?: readonly [string, string, ...string[]]; width?: number }> = ({
  size,
  children,
  colors = FriendsGradients.ring,
  width = 2,
}) => (
  <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size + width * 4, height: size + width * 4, borderRadius: (size + width * 4) / 2, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ padding: width, borderRadius: (size + width * 2) / 2, backgroundColor: FriendsColors.bg }}>{children}</View>
  </LinearGradient>
);

/** Small uppercase section label with an optional tint dot. */
export const SectionLabel: React.FC<{ label: string; tint?: string; right?: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ label, tint, right, style }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: FS.sm }, style]}>
    {tint ? <View style={[styles.dot, { backgroundColor: tint }]} /> : null}
    <Text style={[FT.kicker, { flex: 1 }]} accessibilityRole="header">
      {label}
    </Text>
    {right}
  </View>
);

/** Fades children in on mount (opacity + 6px rise); instant on reduce-motion. Prevents hard pops. */
export const FadeIn: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle>; delay?: number }> = ({ children, style, delay = 0 }) => {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    const a = Animated.timing(v, { toValue: 1, duration: FMotion.base, delay, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reduce, v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>{children}</Animated.View>
  );
};

const styles = StyleSheet.create({
  btn: { borderRadius: FR.pill, overflow: 'hidden', justifyContent: 'center' },
  gradient: { borderRadius: FR.pill, justifyContent: 'center' },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  btnText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.1 },
  danger: { backgroundColor: FriendsColors.dangerSoft, borderWidth: 1, borderColor: 'rgba(243,139,128,0.3)', borderRadius: FR.pill },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.xs,
    paddingHorizontal: FS.xs,
    paddingVertical: 4,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: FriendsColors.lineSoft,
    backgroundColor: FriendsColors.bg,
  },
  headerLine: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});

/**
 * Brand gradient painted behind an accent-filled control. Drop it in as the first child of any
 * element styled with `backgroundColor: FriendsColors.accent` and pass the same radius.
 */
export const BrandFill: React.FC<{ radius?: number; colors?: readonly [string, string, ...string[]] }> = ({ radius = FR.pill, colors = FriendsGradients.brand }) => (
  <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius }, WEB_BEHIND]} pointerEvents="none" />
);

// react-native-web paints static children (e.g. SVG icons) under absolutely positioned siblings; keep the fill behind on web.
const WEB_BEHIND = Platform.OS === 'web' ? { zIndex: -1 } : null;
