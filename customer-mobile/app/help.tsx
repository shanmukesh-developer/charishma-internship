import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useDietLight } from '../components/local/dietLightTheme';
import { HELP_FAQ } from '../constants/helpFaq';
import { useTopInset } from '../utils/useTopInset';
import { useSWRJson } from '../utils/swrCache';

/** Help & FAQ: short answers from constants/helpFaq.ts, then a way to reach support. */
export default function HelpScreen() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const d = useDietLight();
  const [open, setOpen] = useState<string | null>(null);
  // The Campus answers point at the Campus button on Home, which is hidden while the admins have Campus switched off
  // (GET /api/config/sections campus.live; until its launch after Sankranti, 3 Nov 2026): hide them meanwhile.
  const sectionsSWR = useSWRJson<{ sections?: Record<string, { live?: boolean }> }>('/api/config/sections', { freshMs: 60 * 1000 });
  const campusOff = sectionsSWR.data?.sections?.campus?.live === false;
  const faq = campusOff ? HELP_FAQ.filter((section) => section.title !== 'Campus') : HELP_FAQ;

  // Owner, 10 Nov 2026: the app's one diet look (light band header, diet page, white cards, the diet accent).
  const bg = d.page;
  const cardBg = d.card;
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const accent = d.acc;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile' as any));

  return (
    <View style={[s.container, { paddingTop: topPad, backgroundColor: d.top }]}>
      <View style={[s.header, { borderBottomColor: d.top }]}>
        <TouchableOpacity style={[s.backBtn, { borderColor: d.line, backgroundColor: d.card }]} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={18} color={d.dk} />
        </TouchableOpacity>
        <Text style={[s.title, { color: d.dk }]} accessibilityRole="header">Help and FAQ</Text>
      </View>

      <ScrollView style={{ backgroundColor: bg }} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {faq.map((section) => (
          <View key={section.title} style={s.section}>
            <Text style={[s.sectionTitle, { color: txtSec }]} accessibilityRole="header">{section.title}</Text>
            <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
              {section.items.map((item, i) => {
                const key = `${section.title}:${i}`;
                const expanded = open === key;
                return (
                  <View key={key} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border } : undefined}>
                    <TouchableOpacity
                      style={s.qRow}
                      onPress={() => setOpen(expanded ? null : key)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      accessibilityLabel={item.q}
                    >
                      <Text style={[s.q, { color: txt }]}>{item.q}</Text>
                      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={txtSec} />
                    </TouchableOpacity>
                    {expanded && <Text style={[s.a, { color: txtSec }]}>{item.a}</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={[s.supportBtn, { borderColor: accent }]}
          onPress={() => router.push('/support' as any)}
          accessibilityRole="button"
          accessibilityLabel="Open the Support centre"
        >
          <Text style={[s.supportText, { color: accent }]}>Still need help? Open the Support centre</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50, maxWidth: 600, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' },
  scroll: { padding: 16, paddingBottom: 60 },
  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14, minHeight: 48 },
  q: { flex: 1, fontSize: 14, fontWeight: '700' },
  a: { fontSize: 13, lineHeight: 19, paddingHorizontal: 14, paddingBottom: 14 },
  supportBtn: { marginTop: 4, minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  supportText: { fontSize: 14, fontWeight: '700' },
});
