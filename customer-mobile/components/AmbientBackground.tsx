import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// ── Screen background ───────────────────────────────────────────────────
// A flat, theme-coloured fill behind the main tabs. It used to draw drifting orbs, dust particles,
// mesh lines and shooting meteors (5 animation loops): distracting and a battery cost on low-end
// phones, so it is static now (21 Oct polish pass). Same props, so callers need no change.

const AmbientBackground = React.memo(function AmbientBackground(_props: { isStatic?: boolean }) {
  const { isDark } = useTheme();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? '#0A0A0B' : '#FBFBFC' }]} pointerEvents="none" />;
});

export default AmbientBackground;
