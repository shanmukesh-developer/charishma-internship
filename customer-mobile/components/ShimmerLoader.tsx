import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Easing, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';

// ── Premium Shimmer Loading Skeleton ────────────────────────────────────
// A gliding light sweep animation over placeholder shapes.
// Use this in place of ActivityIndicator for a luxury loading feel.

interface ShimmerProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export default function ShimmerLoader({ width, height, borderRadius = 12, style }: ShimmerProps) {
  const { isDark } = useTheme();
  const shimmerX = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerX, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const baseBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  const shimmerColors: [string, string, string] = isDark
    ? ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.02)']
    : ['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.06)', 'rgba(0,0,0,0.02)'];

  const translateX = shimmerX.interpolate({
    inputRange: [-1, 1],
    outputRange: [-200, 200],
  });

  return (
    <View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: baseBg,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={{
          ...StyleSheet.absoluteFill as object,
          transform: [{ translateX }],
        }}
      >
        <LinearGradient
          colors={shimmerColors}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1, width: 200 }}
        />
      </Animated.View>
    </View>
  );
}

// ── Pre-built Shimmer Layouts ──
export function ShimmerCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[s.card, style]}>
      <ShimmerLoader width="100%" height={140} borderRadius={16} />
      <View style={s.cardBody}>
        <ShimmerLoader width="60%" height={14} borderRadius={6} />
        <ShimmerLoader width="40%" height={10} borderRadius={4} style={{ marginTop: 8 }} />
        <View style={s.cardRow}>
          <ShimmerLoader width={60} height={24} borderRadius={12} />
          <ShimmerLoader width={80} height={24} borderRadius={12} />
        </View>
      </View>
    </View>
  );
}

export function ShimmerListItem({ style }: { style?: ViewStyle }) {
  return (
    <View style={[s.listItem, style]}>
      <ShimmerLoader width={48} height={48} borderRadius={14} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <ShimmerLoader width="70%" height={12} borderRadius={6} />
        <ShimmerLoader width="45%" height={10} borderRadius={4} style={{ marginTop: 6 }} />
      </View>
      <ShimmerLoader width={50} height={20} borderRadius={10} />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
  },
  cardBody: {
    padding: 12,
    gap: 4,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
});
