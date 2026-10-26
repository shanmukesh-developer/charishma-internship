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
 * Night hours (9 PM to 6 AM, utils/storeHours.js). With delivery slots (the server default) ordering stays
 * open at night: an order placed now is delivered in the next slot, so the banner says when that is.
 * Without slots (server switch) it is the old "closed for the night" banner.
 * Renders nothing in the day (or while the state is unknown).
 */
export default function NightClosureBanner({ style, reopensAt }: { style?: any; reopensAt?: string | null }) {
  const { isDark, colors } = useTheme();
  const { serviceability } = useServiceability();
  const next = serviceability?.nextSlot;
  if (reopensAt === undefined && serviceability?.open !== false && serviceability?.night && next) {
    return (
      <View
        style={[s.bar, { backgroundColor: isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }, style]}
        accessibilityRole="summary"
        accessibilityLabel={`You can order now. Orders placed now are delivered ${next.label}.`}
      >
        <Ionicons name="moon-outline" size={18} color="#6366F1" />
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.text }]}>Order now for the next delivery slot</Text>
          <Text style={[s.sub, { color: colors.textSecondary }]}>Next delivery: {next.label}.</Text>
        </View>
      </View>
    );
  }
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

/**
 * Home: one quiet line in the day, "Next delivery 4:30–5:30 PM · order by 3:30 PM" (server's next open
 * slot at the standard 1-hour lead). Nothing at night (the banner above covers it) or when slots are off.
 */
export function NextSlotHint({ style }: { style?: any }) {
  const { colors } = useTheme();
  const { serviceability } = useServiceability();
  const next = serviceability?.nextSlot;
  if (!next || serviceability?.night || serviceability?.open === false) return null;
  const when = next.day === 'tomorrow' ? `tomorrow ${next.timeLabel}` : next.timeLabel;
  const text = `Next delivery ${when} · order by ${next.closesAtLabel}`;
  return (
    <View style={[s.hint, style]} accessibilityRole="text" accessibilityLabel={text}>
      <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
      <Text style={[s.hintText, { color: colors.textSecondary }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16 },
  hintText: { flex: 1, fontSize: 12, fontWeight: '600', letterSpacing: 0.1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  title: { fontSize: 14, fontWeight: '800' },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
