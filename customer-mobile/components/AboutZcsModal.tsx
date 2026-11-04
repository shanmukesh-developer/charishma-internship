/**
 * "About ZenWe" sheet (opened from Profile). The ZenWe badge and name, one
 * readable line about the app, real info rows (version and build from the app config, platform, the
 * campus chosen for checkout) and the credit line. Follows light / dark mode; Android back closes it.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { COLORS, surfaceLift } from '../constants/theme';
import { appVersionText } from './ProfileSettingsSection';
import ZenvBadge from './ZenvBadge';

// Same key and names as checkout.tsx / onboarding.tsx.
const CHECKOUT_CAMPUS_KEY = 'zenvy_checkout_campus';
const CAMPUS_LABEL: Record<string, string> = { srmap: 'SRM AP', vitap: 'VIT AP', amrita: 'Amrita' };

const BRAND_FONT = Platform.select({
  android: { fontFamily: 'sans-serif-medium', fontWeight: '500' as const },
  ios: { fontFamily: 'Avenir Next', fontWeight: '500' as const },
  default: { fontFamily: '"Avenir Next", Montserrat, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontWeight: '500' as const },
});

const platformName = () => (Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web');

export default function AboutZcsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { isDark, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const gold = isDark ? COLORS.gold : colors.gold;
  const [campus, setCampus] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(CHECKOUT_CAMPUS_KEY).then((v) => setCampus(v && CAMPUS_LABEL[v] ? CAMPUS_LABEL[v] : null)).catch(() => {});
  }, [visible]);

  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [
    { icon: 'pricetag-outline', label: 'Version', value: appVersionText() },
    { icon: 'phone-portrait-outline', label: 'Platform', value: platformName() },
    { icon: 'school-outline', label: 'College', value: campus || 'Not chosen yet' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={st.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close About" />
        <View style={[st.sheet, { backgroundColor: colors.bg, paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
          <View style={[st.grabber, { backgroundColor: colors.border }]} />
          <TouchableOpacity onPress={onClose} style={[st.close, { backgroundColor: colors.card }, surfaceLift(isDark, true)]} accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>

          {/* Brand */}
          <View style={st.brand} accessible accessibilityLabel="ZenWe">
            <ZenvBadge size={76} lift={!isDark} />
            <Text allowFontScaling={false} style={[st.wordmark, { color: gold }]}>ZenWe</Text>
          </View>
          <Text style={[st.tagline, { color: colors.text }]}>Food, groceries and campus services, delivered to your hostel.</Text>

          {/* Info */}
          <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }, surfaceLift(isDark)]}>
            {rows.map((r, i) => (
              <View key={r.label} style={[st.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]} accessible accessibilityLabel={`${r.label}: ${r.value}`}>
                <Ionicons name={r.icon} size={18} color={gold} />
                <Text style={[st.rowLabel, { color: colors.textSecondary }]}>{r.label}</Text>
                <Text style={[st.rowValue, { color: colors.text }]} numberOfLines={1}>{r.value}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity onPress={onClose} style={[st.done, { backgroundColor: gold }]} accessibilityRole="button" accessibilityLabel="Done" activeOpacity={0.85}>
            <Text style={[st.doneText, { color: isDark ? '#0A0A0B' : '#FFFFFF' }]}>Done</Text>
          </TouchableOpacity>

          <Text style={[st.credit, { color: colors.textMuted }]}>
            Designed and developed by <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Shanmukesh Kunjam</Text>
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  close: { position: 'absolute', top: 14, right: 16, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  brand: { alignItems: 'center', marginTop: 16 },
  // Web and iOS add the letter spacing after the last letter too; the same space in front keeps the word centred.
  wordmark: { ...BRAND_FONT, fontSize: 30, letterSpacing: 6, paddingLeft: Platform.OS === 'android' ? 0 : 6, marginTop: 14 },
  tagline: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 16, marginHorizontal: 8 },
  card: { borderRadius: 18, borderWidth: 1, marginTop: 20, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14 },
  rowLabel: { fontSize: 14, flex: 1 },
  rowValue: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  done: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  doneText: { fontSize: 15, fontWeight: '600' },
  credit: { fontSize: 12, textAlign: 'center', marginTop: 14 },
});
