/**
 * Visual slot selector for slot-booking activities (drone soccer, practice sessions, facilities, gaming):
 * date strip -> sessions (morning / afternoon / evening) -> slot grid. Every tile shows start–end,
 * places left of capacity, price and state in words (OPEN / FULL / STARTED / YOURS), never colour alone.
 * Availability is the server's (GET /:id/slots, refreshed live); the picker never decides capacity.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { usePalette } from './ui';
import { dayLabel, fmtClock, REG_STATUS_META, type Slot } from './campusEventsApi';

const IST = 330 * 60 * 1000;
const sessionOf = (iso: string) => {
  const h = new Date(new Date(iso).getTime() + IST).getUTCHours();
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
};

export function DateStrip({ days, value, onChange }: { days: { date: string; slots: Slot[] }[]; value: string | null; onChange: (d: string) => void }) {
  const p = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }} accessibilityLabel="Pick a date">
      {days.map((d) => {
        const on = d.date === value;
        const open = d.slots.filter((x) => x.state === 'OPEN').length;
        const [dow, ...rest] = dayLabel(d.date).split(' ');
        return (
          <TouchableOpacity key={d.date} onPress={() => onChange(d.date)} accessibilityRole="radio" accessibilityState={{ checked: on }}
            accessibilityLabel={`${dayLabel(d.date)}, ${open} slot${open === 1 ? '' : 's'} open`}
            style={[s.day, { backgroundColor: on ? p.accent : p.card2, borderColor: on ? p.accent : p.border }]}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: on ? p.onAccent : p.sub }}>{dow}</Text>
            <Text style={{ fontSize: 13.5, fontWeight: '900', color: on ? p.onAccent : p.text, marginTop: 2 }} numberOfLines={1}>{rest.join(' ') || dayLabel(d.date)}</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: on ? 'rgba(255,255,255,0.9)' : open ? p.success : p.danger, marginTop: 3 }}>{open ? `${open} open` : 'Full'}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default function SlotPicker({ slots, selectedId, onSelect, now = Date.now(), allowFull = false }: { slots: Slot[]; selectedId: string | null; onSelect: (s: Slot) => void; now?: number; allowFull?: boolean }) {
  const p = usePalette();
  const groups = useMemo(() => {
    const out: { name: string; slots: Slot[] }[] = [];
    for (const sl of slots) {
      const n = sessionOf(sl.startAt);
      let g = out.find((x) => x.name === n);
      if (!g) { g = { name: n, slots: [] }; out.push(g); }
      g.slots.push(sl);
    }
    return out;
  }, [slots]);
  if (!slots.length) {
    return <Text style={{ color: p.sub, fontSize: 12.5, paddingVertical: 16, textAlign: 'center' }}>No slots on this day.</Text>;
  }
  return (
    <View>
      {groups.map((g) => (
        <View key={g.name} style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: p.sub, letterSpacing: 0.2, marginBottom: 8 }}>{g.name}</Text>
          <View style={s.grid}>
            {g.slots.map((sl) => {
              const mine = sl.myRegistration && sl.myRegistration.status !== 'CANCELLED' ? sl.myRegistration : null;
              const started = sl.state === 'STARTED' || new Date(sl.startAt).getTime() <= now;
              const full = sl.state === 'FULL';
              const off = !!mine || started || (full && !allowFull) || sl.state === 'CANCELLED';
              const on = selectedId === sl.id;
              const stateLabel = mine ? REG_STATUS_META[mine.status].label : started ? 'Started' : full ? (allowFull ? 'Full · waitlist' : 'Full') : sl.state === 'CANCELLED' ? 'Cancelled' : `${sl.remaining} of ${sl.capacity} left`;
              const stateColor = mine ? p.accent : started || sl.state === 'CANCELLED' ? p.muted : full ? p.danger : sl.remaining <= Math.max(1, Math.ceil(sl.capacity * 0.2)) ? p.warn : p.success;
              return (
                <TouchableOpacity key={sl.id} disabled={off} onPress={() => onSelect(sl)} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: off }}
                  accessibilityLabel={`${sl.label ? `${sl.label}, ` : ''}${fmtClock(sl.startAt)} to ${fmtClock(sl.endAt)}, ${stateLabel}, ${sl.price.isFree ? 'free' : sl.price.label}`}
                  style={[s.tile, { borderColor: on ? p.accent : p.border, backgroundColor: on ? p.accentSoft : off ? p.card2 : p.card, opacity: off && !mine ? 0.6 : 1 }]}>
                  <Text style={{ fontSize: 13.5, fontWeight: '900', color: p.text }}>{fmtClock(sl.startAt)}</Text>
                  <Text style={{ fontSize: 12, color: p.sub, marginTop: 1 }}>to {fmtClock(sl.endAt)} · {sl.durationMinutes} min</Text>
                  {sl.label ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 1 }} numberOfLines={1}>{sl.label}</Text> : null}
                  <View style={[s.bar, { backgroundColor: p.card2 }]}>
                    <View style={{ width: `${sl.capacity ? Math.min(100, Math.round(((sl.capacity - sl.remaining) / sl.capacity) * 100)) : 100}%`, height: '100%', backgroundColor: stateColor, borderRadius: 3 }} />
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: stateColor, marginTop: 4 }} numberOfLines={1}>{mine ? '★ ' : ''}{stateLabel}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: sl.price.isFree ? p.success : p.text, marginTop: 2 }}>{sl.price.isFree ? 'Free' : sl.price.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  day: { minWidth: 76, minHeight: 64, borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31.5%', minWidth: 100, flexGrow: 1, maxWidth: '49%', minHeight: 112, borderRadius: 14, borderWidth: 1.5, padding: 10 },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 8 },
});
