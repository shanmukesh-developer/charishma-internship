// Admin "Preview on phone" (zenvy://ad-preview?code=...): plays one sponsored splash ad exactly as students
// will see it, even while it is switched off or scheduled. The signed code names that one ad and expires in
// 15 minutes (backend routes/adRoutes.js). The ad plays over Home; this screen only loads it.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { API_URL } from '../constants/api';
import { apiFetch } from '../utils/auth';
import { artUrl, SPLASH_STYLES, type SplashAd } from '../components/adSplash/adSplashApi';
import { loadRuntime, showAdPreview } from '../components/adSplash/AdSplashHost';
import { goHome } from '../utils/goHome';

export default function AdPreviewScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/ads/preview?code=${encodeURIComponent(String(code || ''))}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || 'This preview link is not valid.');
        const ad = data?.ad as SplashAd;
        if (!ad || !SPLASH_STYLES.includes(ad.style)) throw new Error('This preview link is not valid.');
        const rt = await loadRuntime();
        const art = rt ? await rt.loadArt(artUrl(ad.imageUrl) || '') : null;
        if (!art) throw new Error("The ad's photo could not be loaded. Check the image in admin.");
        if (!alive) return;
        goHome(router);
        setTimeout(() => showAdPreview({ ad, art }), 250);
      } catch (e: any) {
        if (alive) setError(e?.message || 'Could not open the preview.');
      }
    })();
    return () => { alive = false; };
  }, [code]);
  return (
    <View style={styles.root}>
      {error ? (
        <>
          <Text style={styles.title}>Ad preview</Text>
          <Text style={styles.msg}>{error}</Text>
          <Pressable style={styles.btn} onPress={() => goHome(router)} accessibilityRole="button"><Text style={styles.btnText}>Go to Home</Text></Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color="#f4c430" />
          <Text style={styles.msg}>Opening the ad preview</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0b', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: '#f5f5f7', fontSize: 20, fontWeight: '700' },
  msg: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', maxWidth: 300 },
  btn: { marginTop: 8, backgroundColor: '#f4c430', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 99 },
  btnText: { color: '#2a1c00', fontWeight: '700' },
});
