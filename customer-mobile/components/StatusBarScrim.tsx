import React from 'react';
import { Animated, Platform, StatusBar, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Opaque backdrop for the status-bar area on edge-to-edge screens whose header scrolls away.
 *
 * The app draws under a transparent, translucent status bar (app/_layout.tsx). Screens that keep their
 * header INSIDE the ScrollView (Food & groceries home, PG building / room photos, product photos) used to
 * scroll their content straight under the clock and the status icons. Put this as the LAST child of the
 * screen's root View (a sibling of the ScrollView): it covers exactly the status-bar height and fades in
 * once the content starts to move under it, so the screen at rest looks the same as before.
 *
 *   scrollY  the ScrollView's vertical offset (Animated.Value); without it the backdrop is always on
 *   from/to  scroll range (px) over which it fades from clear to opaque
 */
export default function StatusBarScrim({ color, scrollY, from = 0, to = 12 }: {
  color: string; scrollY?: Animated.Value; from?: number; to?: number;
}) {
  const insets = useSafeAreaInsets();
  const height = Math.round(Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0));
  if (height <= 0) return null;
  const opacity = scrollY
    ? scrollY.interpolate({ inputRange: [from, Math.max(from + 1, to)], outputRange: [0, 1], extrapolate: 'clamp' })
    : 1;
  return <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[st.scrim, { height, backgroundColor: color, opacity }]} />;
}

const st = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, elevation: 50 },
});
