import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useServiceability } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import { formatClock } from '../utils/format';

/** "Ordering opens at 6:00 am" from the server's reopensAt ("06:00", India time). */
export const opensAtLine = (reopensAt?: string | null) =>
  `Ordering opens at ${formatClock(reopensAt || '06:00').toLowerCase()}`;

/**
 * Campus night closure (the server's 9 PM to 6 AM window, utils/storeHours.js): a calm banner on Home
 * and store pages so nobody fills a basket only to learn at checkout that ordering is closed.
 * Renders nothing while ordering is open (or while the state is unknown).
 */
export default function NightClosureBanner({ style, reopensAt }: { style?: any; reopensAt?: string | null }) {
  const { isDark, colors } = useTheme();
  const { serviceability } = useServiceability();
  // A store page can pass the store's own campus flag; otherwise the campus-wide check decides.
  const closed = reopensAt !== undefined ? reopensAt !== null : serviceability?.open === false;
  if (!closed) return null;
  const when = reopensAt || serviceability?.reopensAt;
  return (
    <View
      style={[s.bar, { backgroundColor: isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }, style]}
      accessibilityRole="summary"
      accessibilityLabel={`Ordering is closed for the night. ${opensAtLine(when)}.`}
    >
      <Ionicons name="moon-outline" size={18} color="#6366F1" />
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { color: colors.text }]}>Ordering is closed for the night</Text>
        <Text style={[s.sub, { color: colors.textSecondary }]}>{opensAtLine(when)}. You can still browse.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  title: { fontSize: 14, fontWeight: '800' },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
