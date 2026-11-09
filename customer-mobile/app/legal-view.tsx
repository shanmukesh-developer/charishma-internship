/**
 * In-app reader for the policy pages (QA Q5, 5 Nov 2026): Profile > Privacy policy and the other legal links used to
 * jump out to the phone's browser (on a fresh phone: Chrome's own sign-in screen first). They now open here, with a
 * back button, the page title and "Open in browser" for anyone who wants it. A page that cannot load says so and
 * shows the address.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useDietLight } from '../components/local/dietLightTheme';
import { LEGAL_LINKS, LEGAL_LABELS, type LegalPage } from '../utils/legal';

export default function LegalView() {
  const { page } = useLocalSearchParams<{ page?: string }>();
  const key = (page && page in LEGAL_LINKS ? page : 'index') as LegalPage;
  const url = LEGAL_LINKS[key];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const d = useDietLight();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const bg = isDark ? '#0A0A0B' : '#FFFFFF';
  const fg = d.dk;
  const sub = isDark ? '#A1A1AA' : '#64748B';
  const line = d.line;

  return (
    <View style={[st.root, { backgroundColor: d.top, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[st.bar, { borderBottomColor: line }]}>
        <TouchableOpacity onPress={() => router.back()} style={st.icon} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={fg} />
        </TouchableOpacity>
        <Text style={[st.title, { color: fg }]} numberOfLines={1} accessibilityRole="header">{LEGAL_LABELS[key]}</Text>
        <TouchableOpacity onPress={() => Linking.openURL(url).catch(() => {})} style={st.icon} accessibilityRole="link" accessibilityLabel="Open in browser" hitSlop={8}>
          <Ionicons name="open-outline" size={21} color={fg} />
        </TouchableOpacity>
      </View>
      {failed ? (
        <View style={[st.center, { backgroundColor: bg }]}>
          <Ionicons name="cloud-offline-outline" size={36} color={sub} />
          <Text style={[st.msg, { color: fg }]}>We couldn't load this page.</Text>
          <Text style={[st.small, { color: sub }]} selectable>{url}</Text>
          <TouchableOpacity onPress={() => { setFailed(false); setLoading(true); }} style={[st.retry, { backgroundColor: d.acc }]} accessibilityRole="button">
            <Text style={[st.retryText, { color: d.onAcc }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          source={{ uri: url }}
          style={{ flex: 1, backgroundColor: bg }}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setLoading(false); setFailed(true); }}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) { setLoading(false); setFailed(true); } }}
          setSupportMultipleWindows={false}
        />
      )}
      {loading && !failed && (
        <View style={st.loader} pointerEvents="none"><ActivityIndicator color={d.acc} /></View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  bar: { height: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  msg: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 12, textAlign: 'center' },
  retry: { marginTop: 8, backgroundColor: '#C8143F', borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  loader: { position: 'absolute', top: 120, left: 0, right: 0, alignItems: 'center' },
});
