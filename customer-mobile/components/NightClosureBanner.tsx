import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useServiceability } from '../context/CartContext';
import NoticeCard, { type NoticePalette } from './NoticeCard';
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
export default function NightClosureBanner({ style, reopensAt, palette }: { style?: any; reopensAt?: string | null; palette?: NoticePalette }) {
  const { serviceability } = useServiceability();
  const next = serviceability?.nextSlot;
  if (reopensAt === undefined && serviceability?.open !== false && serviceability?.night && next) {
    return <NoticeCard icon="moon-outline" title="Order now for the next delivery slot" sub={`Next delivery: ${next.label}.`} palette={palette} style={style} />;
  }
  // A store page can pass the store's own campus flag; otherwise the campus-wide check decides.
  const closed = reopensAt !== undefined ? reopensAt !== null : serviceability?.open === false;
  if (!closed) return null;
  const when = reopensAt || serviceability?.reopensAt;
  return <NoticeCard icon="moon-outline" title="Ordering is closed for the night" sub={`${opensAtLine(when)}. You can still browse.`} palette={palette} style={style} />;
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
});
