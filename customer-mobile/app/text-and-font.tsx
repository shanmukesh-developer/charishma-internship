/**
 * Font & text size (owner, 10 Nov 2026): pick an app font (phone default + 20 international fonts, downloaded when
 * picked) and a text size (5 steps, capped by the screen). A live preview shows the choice before Apply; Apply
 * re-draws the whole app (utils/appText).
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useDietLight } from '../components/local/dietLightTheme';
import { useTopInset } from '../utils/useTopInset';
import { APP_FONTS, TEXT_SIZES, applyAppText, getAppTextPrefs, loadAppFont, maxSizeScale, previewFamily } from '../utils/appText';

export default function TextAndFontScreen() {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const d = useDietLight();
  const topPad = useTopInset();
  const saved = getAppTextPrefs();
  const [font, setFont] = useState<string | null>(saved.font);
  const [size, setSize] = useState<number>(saved.size);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [, setTick] = useState(0);
  const maxScale = useMemo(() => maxSizeScale(), []);
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const card = isDark ? colors.card : '#FFFFFF';
  const edge = isDark ? colors.border : 'rgba(17,17,26,0.07)';
  const changed = font !== saved.font || Math.abs(size - saved.size) > 0.001;

  // Preview text skips the app-wide swap (it names its own family), so it shows the choice before Apply.
  const pv = (w: number, fs: number) => {
    const fam = previewFamily(font, w);
    return fam ? { fontFamily: fam, fontSize: fs * size } : { fontSize: fs * size, fontWeight: String(w) as any };
  };

  const pick = async (key: string | null) => {
    setFailed(null);
    setFont(key);
    if (!key) return;
    setLoadingKey(key);
    try { await loadAppFont(key); setTick((n) => n + 1); }
    catch { setFailed(key); }
    finally { setLoadingKey((k) => (k === key ? null : k)); }
  };

  const apply = async () => {
    if (!changed || applying) return;
    setApplying(true);
    try { await applyAppText({ font, size }); }
    catch { if (font) setFailed(font); setApplying(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? colors.bg : d.pageDeep }}>
      <View style={[st.header, { paddingTop: topPad + 10, backgroundColor: d.top }]}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as any))} style={[st.back, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF' }]} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={21} color={d.dk} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[st.title, { color: d.dk }]}>Font & text size</Text>
          <Text style={[st.sub, { color: d.dk }]}>Changes every screen of ZenWe</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {/* Live preview */}
        <View style={[st.card, { backgroundColor: card, borderColor: edge }]}>
          <Text style={[st.cap, { color: txtSec }]}>PREVIEW</Text>
          <Text style={[{ color: txt, marginTop: 6 }, pv(800, 20)]} maxFontSizeMultiplier={1}>Biryani at your hostel gate</Text>
          <Text style={[{ color: txtSec, marginTop: 6 }, pv(500, 14)]} maxFontSizeMultiplier={1}>Order before 11:30 AM for the 12:30–1:00 PM slot. Cash or Wallet.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <Text style={[{ color: txt }, pv(700, 16)]} maxFontSizeMultiplier={1}>₹149</Text>
            <View style={[st.previewBtn, { backgroundColor: d.acc }]}>
              <Text style={[{ color: d.onAcc }, pv(800, 13)]} maxFontSizeMultiplier={1}>Add to basket</Text>
            </View>
          </View>
        </View>

        {/* Text size */}
        <View style={[st.card, { backgroundColor: card, borderColor: edge }]}>
          <View style={st.secRow}>
            <Ionicons name="text-outline" size={17} color={d.acc} />
            <Text style={[st.secText, { color: txt }]}>Text size</Text>
          </View>
          <View style={[st.sizeTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : d.soft }]}>
            {TEXT_SIZES.map((s) => {
              const on = Math.abs(size - s.scale) < 0.001;
              const off = s.scale > maxScale + 0.001;
              return (
                <TouchableOpacity
                  key={s.key}
                  disabled={off}
                  onPress={() => setSize(s.scale)}
                  style={[st.sizeStep, on && { backgroundColor: card, shadowColor: d.acc, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 }, off && { opacity: 0.35 }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: off }}
                  accessibilityLabel={`${s.label} text`}
                >
                  <Text style={{ fontSize: 11 + (s.scale - 0.92) * 22, fontWeight: '900', color: on ? d.acc : txt }} maxFontSizeMultiplier={1}>A</Text>
                  <Text style={{ fontSize: 10.5, fontWeight: '700', color: on ? d.acc : txtSec, marginTop: 2 }} numberOfLines={1} maxFontSizeMultiplier={1}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {maxScale < 1.25 ? <Text style={[st.note, { color: txtSec }]}>The biggest sizes are hidden on this phone so screens never overflow.</Text> : null}
        </View>

        {/* Fonts */}
        <View style={[st.card, { backgroundColor: card, borderColor: edge }]}>
          <View style={st.secRow}>
            <Ionicons name="color-palette-outline" size={17} color={d.acc} />
            <Text style={[st.secText, { color: txt }]}>App font</Text>
          </View>
          <Text style={[st.note, { color: txtSec, marginTop: 4, marginBottom: 6 }]}>A font downloads the first time you pick it (needs internet once).</Text>
          {[{ key: null as string | null, label: 'Phone default', note: 'The font your phone uses' }, ...APP_FONTS].map((f, i) => {
            const on = font === f.key;
            const fam = f.key ? previewFamily(f.key, 600) : undefined;
            return (
              <TouchableOpacity
                key={f.key || 'default'}
                onPress={() => pick(f.key)}
                style={[st.fontRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: edge }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={f.label}
              >
                <View style={[st.aa, { backgroundColor: on ? d.soft : isDark ? 'rgba(255,255,255,0.05)' : '#F5F6F8' }]}>
                  <Text style={[{ fontSize: 17, color: on ? d.acc : txt }, fam ? { fontFamily: fam } : { fontWeight: '700' }]} maxFontSizeMultiplier={1}>Aa</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 15, color: txt }, fam ? { fontFamily: fam } : { fontWeight: '700' }]} numberOfLines={1} maxFontSizeMultiplier={1.1}>{f.label}</Text>
                  {!!f.key && failed === f.key ? (
                    <Text style={{ fontSize: 12, color: '#DC2626', fontWeight: '600', marginTop: 1 }}>Couldn't download. Check the internet and tap again.</Text>
                  ) : (f as any).note ? (
                    <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', marginTop: 1 }}>{(f as any).note}</Text>
                  ) : null}
                </View>
                {!!f.key && loadingKey === f.key ? (
                  <ActivityIndicator size="small" color={d.acc} />
                ) : (
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? d.acc : txtSec} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={[st.footer, { backgroundColor: card, borderTopColor: edge }]}>
        <TouchableOpacity
          onPress={apply}
          disabled={!changed || applying || !!loadingKey}
          style={[st.applyBtn, { backgroundColor: d.acc }, (!changed || !!loadingKey) && { opacity: 0.45 }]}
          accessibilityRole="button"
        >
          {applying ? <ActivityIndicator color={d.onAcc} /> : <Text style={{ color: d.onAcc, fontSize: 15, fontWeight: '800' }}>{changed ? 'Apply to the whole app' : 'Pick a font or size'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  sub: { fontSize: 12.5, fontWeight: '600', opacity: 0.7, marginTop: 2 },
  card: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 14 },
  cap: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  previewBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12 },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secText: { fontSize: 15.5, fontWeight: '900' },
  sizeTrack: { flexDirection: 'row', marginTop: 12, borderRadius: 16, padding: 4, gap: 4 },
  sizeStep: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingVertical: 8, borderRadius: 12, minHeight: 58 },
  note: { fontSize: 12, fontWeight: '600', marginTop: 8 },
  fontRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  aa: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1 },
  applyBtn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
