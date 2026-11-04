import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServerWaking } from '../utils/serverWake';

/**
 * App-wide "Zenvy is waking up" banner. utils/auth.ts apiFetch retries GETs through a backend cold start
 * (up to ~3 minutes); while any of those requests is waiting, this calm banner stays up, and it slides
 * away by itself once the data loads. Screens keep showing their cached data meanwhile.
 */
export default function ServerWakeBanner() {
  const insets = useSafeAreaInsets();
  const waking = useServerWaking();
  // Ignore very short blips (one quick retry) so the banner does not flash.
  const [shown, setShown] = useState(false);
  const slide = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    if (!waking) { setShown(false); return; }
    const t = setTimeout(() => setShown(true), 1500);
    return () => clearTimeout(t);
  }, [waking]);

  useEffect(() => {
    Animated.timing(slide, { toValue: shown ? 0 : -120, duration: shown ? 260 : 220, useNativeDriver: true }).start();
  }, [shown, slide]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[st.wrap, { top: insets.top + 8, transform: [{ translateY: slide }] }]}
      accessibilityLiveRegion="polite"
    >
      {shown && (
        <View style={st.inner} accessibilityRole="alert" accessibilityLabel="ZenWe is waking up. Your data will load in a moment.">
          <ActivityIndicator size="small" color="#C9A84C" />
          <View style={{ flex: 1 }}>
            <Text style={st.title}>ZenWe is waking up…</Text>
            <Text style={st.sub}>This can take a minute or two. We'll load everything as soon as it's ready.</Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 999997, elevation: 9 },
  inner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(20,20,22,0.96)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  title: { color: '#F5F5F5', fontSize: 14, fontWeight: '800' },
  sub: { color: '#C7C7CC', fontSize: 12, fontWeight: '500', marginTop: 2, lineHeight: 16 },
});
