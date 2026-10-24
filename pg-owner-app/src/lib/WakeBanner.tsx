import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServerWaking } from './serverWake';

/**
 * "ZCS is waking up" banner: shown while a GET is riding out a backend restart (serverWake.ts retries
 * for up to ~3 minutes), gone by itself once the data loads. Never blocks touches.
 */
export default function WakeBanner() {
  const insets = useSafeAreaInsets();
  const waking = useServerWaking();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!waking) { setShown(false); return; }
    const t = setTimeout(() => setShown(true), 1500); // no flash for one quick retry
    return () => clearTimeout(t);
  }, [waking]);
  if (!shown) return null;
  return (
    <View pointerEvents="none" style={[st.wrap, { top: insets.top + 8 }]}>
      <View style={st.inner} accessibilityRole="alert" accessibilityLabel="ZCS is waking up. Your data will load in a moment.">
        <ActivityIndicator size="small" color="#C9A84C" />
        <View style={{ flex: 1 }}>
          <Text style={st.title}>ZCS is waking up…</Text>
          <Text style={st.sub}>This can take a minute or two. Everything loads as soon as it's ready.</Text>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 9999, elevation: 9 },
  inner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(20,20,22,0.96)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)', paddingHorizontal: 14, paddingVertical: 12,
  },
  title: { color: '#F5F5F5', fontSize: 14, fontWeight: '800' },
  sub: { color: '#C7C7CC', fontSize: 12, fontWeight: '500', marginTop: 2, lineHeight: 16 },
});
