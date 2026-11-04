import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

/** A screen with its own colours (a store's brand theme) passes them; otherwise the app theme's are used. */
export type NoticePalette = { bg: string; border: string; text: string; sub: string; dark: boolean };

/**
 * One look for the app's information notes (store closed, night delivery slot, a stall that delivers itself): a quiet
 * card with a hairline edge, a one-colour icon in a neutral circle, a bold line and a softer second line. Owner,
 * 3 Nov 2026: the old pastel indigo / orange boxes with coloured icons looked machine-made; colour stays for actions,
 * prices and the brand.
 */
export default function NoticeCard({ icon, title, sub, palette, style }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  sub?: string;
  palette?: NoticePalette;
  style?: StyleProp<ViewStyle>;
}) {
  const { isDark, colors } = useTheme();
  const p = palette || { bg: colors.card, border: colors.border, text: colors.text, sub: colors.textSecondary, dark: isDark };
  return (
    <View
      style={[s.card, { backgroundColor: p.bg, borderColor: p.border }, style]}
      accessibilityRole="summary"
      accessibilityLabel={sub ? `${title}. ${sub}` : title}
    >
      <View style={[s.iconWrap, { backgroundColor: p.dark ? 'rgba(255,255,255,0.08)' : '#F1F2F5' }]}>
        <Ionicons name={icon} size={16} color={p.text} />
      </View>
      <View style={s.body}>
        <Text style={[s.title, { color: p.text }]}>{title}</Text>
        {!!sub && <Text style={[s.sub, { color: p.sub }]}>{sub}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderWidth: 1 },
  iconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  title: { fontSize: 13, fontWeight: '800', letterSpacing: 0.1, lineHeight: 18 },
  sub: { fontSize: 12, fontWeight: '600', lineHeight: 17, marginTop: 1 },
});
