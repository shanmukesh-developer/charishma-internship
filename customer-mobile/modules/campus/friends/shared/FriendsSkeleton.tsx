import React, { createContext, useContext, useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, DimensionValue } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FriendsColors, FS, FR } from '../friendsTheme';
import { useReduceMotion } from './FriendsUi';

import { themedSheet } from '../../../../utils/themeNow';
/** One shared shimmer clock per skeleton group (a single native-driven loop, not one per block). */
const ShimmerCtx = createContext<Animated.Value | null>(null);

const useShimmer = (enabled = true) => {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce || !enabled) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduce, v, enabled]);
  return reduce || !enabled ? null : v;
};

/** Placeholder block for dark surfaces with a soft sweeping highlight (still on reduce-motion). */
export const SkeletonBlock: React.FC<{ width: DimensionValue; height: number; radius?: number }> = ({ width, height, radius = 8 }) => {
  const shared = useContext(ShimmerCtx);
  const own = useShimmer(!shared);
  const v = shared || own;
  return (
    <View style={{ width, height, borderRadius: radius, backgroundColor: FriendsColors.cardHi, overflow: 'hidden' }}>
      {v ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { width: 160, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-160, 420] }) }] },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
};

/** Loading placeholder for Friends lists (posts, threads, tasks, people). Same rhythm as real cards → no jump. */
/** `flush` drops the side padding when the parent list already pads its content (keeps cards aligned → no jump). */
export const FriendsSkeleton: React.FC<{ rows?: number; variant?: 'post' | 'row'; flush?: boolean }> = ({ rows = 4, variant = 'post', flush }) => {
  const v = useShimmer();
  return (
    <ShimmerCtx.Provider value={v}>
      <View style={{ padding: flush ? 0 : FS.lg, paddingTop: flush ? FS.sm : FS.lg, gap: FS.md }} accessibilityLabel="Loading" accessibilityRole="progressbar">
        {Array.from({ length: rows }).map((_, i) => (
          <View key={i} style={[styles.card, { opacity: 1 - i * 0.14 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: FS.md }}>
              <SkeletonBlock width={40} height={40} radius={20} />
              <View style={{ flex: 1, gap: 8 }}>
                <SkeletonBlock width="45%" height={12} />
                <SkeletonBlock width="25%" height={10} />
              </View>
            </View>
            {variant === 'post' ? (
              <View style={{ gap: 8, marginTop: FS.md }}>
                <SkeletonBlock width="95%" height={12} />
                <SkeletonBlock width="80%" height={12} />
                <SkeletonBlock width="55%" height={12} />
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </ShimmerCtx.Provider>
  );
};

const styles = themedSheet(() => ({
  card: {
    backgroundColor: FriendsColors.card,
    borderRadius: FR.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: FriendsColors.line,
    padding: FS.lg,
  },
}));
