import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import type { DeliverySlot, DeliverySlotsInfo } from '../utils/deliverySlots';

/**
 * Delivery slot picker (checkout): Today and Tomorrow, three slots each, from the server's slot list.
 * A closed slot is shown disabled with its reason ("Closed at 11:30 AM"); an open one says when booking
 * closes. Plain and static: no looping motion.
 */
// "12:30–1:00 PM" -> "12:30–1:00" + " PM" (the suffix is set smaller so three chips fit a phone row).
const timeMain = (t: string) => t.replace(/\s?(AM|PM)$/, '');
const timeSuffix = (t: string) => { const m = /\s?(AM|PM)$/.exec(t); return m ? ` ${m[1]}` : ''; };

export default function DeliverySlotPicker({
  info,
  selectedId,
  onSelect,
  loading,
  note,
}: {
  info: DeliverySlotsInfo | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  /** Optional line under the title (e.g. why the slots were refreshed). */
  note?: string | null;
}) {
  const { isDark, colors } = useTheme();
  const txt = colors.text;
  const sub = colors.textSecondary;
  const groups: { key: 'today' | 'tomorrow'; title: string; slots: DeliverySlot[] }[] = [
    { key: 'today', title: 'Today', slots: (info?.slots || []).filter((s) => s.day === 'today') },
    { key: 'tomorrow', title: 'Tomorrow', slots: (info?.slots || []).filter((s) => s.day === 'tomorrow') },
  ];
  const leadText = info?.leadReason
    ? `${info.leadReason}. Order before the time shown on each slot.`
    : 'Order at least 1 hour before a slot starts.';

  return (
    <View>
      <Text style={[s.title, { color: txt }]}>Delivery slot</Text>
      <Text style={[s.lead, { color: sub }]}>{leadText}</Text>
      {note ? (
        <View style={[s.note, { backgroundColor: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)' }]}>
          <Ionicons name="information-circle-outline" size={16} color="#B45309" />
          <Text style={[s.noteText, { color: txt }]}>{note}</Text>
        </View>
      ) : null}
      {!info && loading ? (
        <View style={s.loading}>
          <ActivityIndicator color={COLORS.red} />
          <Text style={[s.lead, { color: sub, marginTop: 6 }]}>Loading delivery slots…</Text>
        </View>
      ) : null}
      {info ? groups.map((g) => (
        <View key={g.key} style={{ marginTop: 10 }}>
          <Text style={[s.group, { color: sub }]}>{g.title}</Text>
          <View style={s.row}>
            {g.slots.map((slot) => {
              const active = slot.open && slot.id === selectedId;
              const closedLine = slot.closedText || `Closed at ${slot.closesAtLabel}`;
              return (
                <TouchableOpacity
                  key={slot.id}
                  activeOpacity={0.85}
                  disabled={!slot.open}
                  onPress={() => onSelect(slot.id)}
                  style={[
                    s.chip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    !slot.open && { opacity: 0.5, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F4F4F5' },
                    active && { borderColor: COLORS.red, backgroundColor: isDark ? 'rgba(239,79,95,0.08)' : 'rgba(239,79,95,0.04)' },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, checked: active, disabled: !slot.open }}
                  accessibilityLabel={`${slot.label}. ${slot.open ? `Order by ${slot.closesAtLabel}` : closedLine}`}
                >
                  <Text style={[s.time, { color: active ? COLORS.red : txt }]} numberOfLines={2}>
                    {timeMain(slot.timeLabel)}
                    <Text style={s.suffix}>{timeSuffix(slot.timeLabel)}</Text>
                  </Text>
                  <Text style={[s.when, { color: sub }]} numberOfLines={2}>
                    {slot.open ? `Order by ${slot.closesAtLabel}` : closedLine}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )) : null}
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2, marginBottom: 4 },
  lead: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  group: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, minWidth: 0, minHeight: 58, paddingVertical: 10, paddingHorizontal: 7, borderRadius: 14, borderWidth: 1.5, justifyContent: 'center' },
  time: { fontSize: 13, fontWeight: '800' },
  suffix: { fontSize: 10, fontWeight: '800' },
  when: { fontSize: 11, fontWeight: '600', marginTop: 3, lineHeight: 14 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  noteText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 16 },
  loading: { paddingVertical: 14, alignItems: 'center' },
});
