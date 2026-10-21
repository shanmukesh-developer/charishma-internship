import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { COLORS } from '../constants/theme';
import { HELP_FAQ } from '../constants/helpFaq';

/** Help & FAQ: short answers from constants/helpFaq.ts, then a way to reach support. */
export default function HelpScreen() {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const [open, setOpen] = useState<string | null>(null);

  const bg = colors.bg;
  const cardBg = colors.card;
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const accent = isDark ? COLORS.gold : colors.gold;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile' as any));

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity style={[s.backBtn, { borderColor: border }]} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={18} color={txt} />
        </TouchableOpacity>
        <Text style={[s.title, { color: txt }]} accessibilityRole="header">Help and FAQ</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {HELP_FAQ.map((section) => (
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
