/**
 * Weekly mess timetable: day tabs (today first selected and marked), the day's meals with times and
 * menus, veg / non-veg / egg marks, and on today's tab the meal being served now or the next one
 * ("Serving now · until 9:30 AM", "Starts in 25 min"), refreshed every 30 s. Times are IST.
 * Also the house timings card (gate, visitors, check-in / out, quiet hours, curfew note).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import {
  DAY_KEYS, DAY_SHORT, DAY_LONG, FOOD_TAG_LABEL, fmtRange, fmtTime, istNow, mealsForDay, mealStatus,
  type DayKey, type FoodTag, type MessTimetable, type PgTimings,
} from './pgApi';
import { usePgPalette, Press, SectionHeading, Divider, IconDoorOpen, IconUsers, IconCalendarClock, IconMoon, IconInfo, ICON, s as ui } from './ui';

const useMinuteClock = () => {
  const [now, setNow] = useState(() => istNow());
  useEffect(() => {
    const t = setInterval(() => setNow(istNow()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
};

/** Indian food mark: a square outline with a dot (green veg, brown non-veg, amber egg) plus the word. */
function FoodMark({ tag }: { tag: FoodTag }) {
  const p = usePgPalette();
  if (!tag) return null;
  const color = tag === 'veg' ? (p.isDark ? '#34D399' : '#15803D') : tag === 'egg' ? (p.isDark ? '#FBBF24' : '#B45309') : (p.isDark ? '#F87171' : '#9A3412');
  return (
    <View style={st.mark} accessibilityLabel={FOOD_TAG_LABEL[tag]}>
      <View style={[st.markBox, { borderColor: color }]}><View style={[st.markDot, { backgroundColor: color }]} /></View>
      <Text style={[ui.small, { color: p.sub }]}>{FOOD_TAG_LABEL[tag]}</Text>
    </View>
  );
}

export function PgMessSection({ timetable }: { timetable: MessTimetable | null }) {
  const p = usePgPalette();
  const now = useMinuteClock();
  const [day, setDay] = useState<DayKey>(now.day);
  const slots = useMemo(() => (timetable ? mealsForDay(timetable, day) : []), [timetable, day]);
  const isToday = day === now.day;
  const status = isToday ? mealStatus(slots, now.minutes) : null;

  if (!timetable || !timetable.meals.length) {
    return (
      <View>
        <SectionHeading title="Mess timings" />
        <Text style={[ui.body, { color: p.sub }]}>The mess timetable hasn't been added yet.</Text>
      </View>
    );
  }
  const anyMenu = slots.some((x) => x.cell && (x.cell.menu || x.cell.tag));

  return (
    <View>
      <SectionHeading title="Mess timings" detail="Times in IST" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }} accessibilityRole="tablist" style={{ marginBottom: 12 }}>
        {DAY_KEYS.map((d) => {
          const on = d === day;
          const today = d === now.day;
          return (
            <Press key={d} onPress={() => setDay(d)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${DAY_LONG[d]}${today ? ', today' : ''}`}
              style={[st.dayTab, { backgroundColor: on ? p.text : 'transparent', borderColor: on ? p.text : p.line }]}>
              <Text style={[st.dayText, { color: on ? p.bg : p.text }]}>{DAY_SHORT[d]}</Text>
              <Text style={[st.todayText, { color: on ? p.bg : p.accent, opacity: today ? 1 : 0 }]}>Today</Text>
            </Press>
          );
        })}
      </ScrollView>

      <View style={[st.table, { borderColor: p.line, backgroundColor: p.card }]}>
        {slots.map((slot, i) => {
          const live = status && status.key === slot.meal.key ? status : null;
          return (
            <View key={slot.meal.key}>
              {i > 0 ? <Divider /> : null}
              <View style={[st.row, live ? { backgroundColor: p.accentSoft } : null]} accessibilityLabel={`${slot.meal.label}${slot.start ? `, ${fmtRange(slot.start, slot.end)}` : ''}${live ? `, ${live.label}` : ''}${slot.cell?.menu ? `. ${slot.cell.menu}` : ''}`}>
                {live ? <View style={[st.liveBar, { backgroundColor: p.accent }]} /> : null}
                <View style={st.rowHead}>
                  <Text style={[st.meal, { color: p.text }]}>{slot.meal.label}</Text>
                  <Text style={[ui.small, { color: p.sub }]}>{slot.start ? fmtRange(slot.start, slot.end) : 'Time not set'}</Text>
                </View>
                {live ? <Text style={[st.live, { color: p.accent }]}>{live.label}</Text> : null}
                {slot.cell?.menu ? <Text style={[ui.body, { color: p.text, marginTop: 4 }]}>{slot.cell.menu}</Text> : null}
                {slot.cell?.tag ? <View style={{ marginTop: 6 }}><FoodMark tag={slot.cell.tag} /></View> : null}
                {!slot.cell?.menu && !slot.cell?.tag ? <Text style={[ui.small, { color: p.muted, marginTop: 4 }]}>Menu not added</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
      {!anyMenu ? <Text style={[ui.small, { color: p.muted, marginTop: 8 }]}>No menu added for {DAY_LONG[day]} yet.</Text> : null}
      {timetable.notes ? (
        <View style={[st.notes, { backgroundColor: p.sunken }]}>
          <IconInfo size={16} color={p.sub} strokeWidth={ICON.stroke} style={{ marginTop: 2 }} />
          <Text style={[ui.body, { color: p.sub, flex: 1 }]}>{timetable.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── House timings ───────────────────────────────────────────────────────────────────────────────
export function PgTimingsSection({ timings }: { timings: PgTimings | null }) {
  const p = usePgPalette();
  if (!timings) return null;
  const rows = [
    timings.gateOpen || timings.gateClose ? { icon: IconDoorOpen, label: 'Gate', value: timings.gateOpen && timings.gateClose ? `Opens ${fmtTime(timings.gateOpen)} · closes ${fmtTime(timings.gateClose)}` : '' } : null,
    timings.visitorFrom ? { icon: IconUsers, label: 'Visitors', value: fmtRange(timings.visitorFrom, timings.visitorTo) } : null,
    timings.checkIn || timings.checkOut ? {
      icon: IconCalendarClock,
      label: 'Check-in / check-out',
      value: [timings.checkIn ? `Check-in ${fmtTime(timings.checkIn)}` : '', timings.checkOut ? `check-out ${fmtTime(timings.checkOut)}` : ''].filter(Boolean).join(' · ').replace(/^check-out/, 'Check-out'),
    } : null,
    timings.quietFrom ? { icon: IconMoon, label: 'Quiet hours', value: fmtRange(timings.quietFrom, timings.quietTo) } : null,
  ].filter((r): r is { icon: typeof IconDoorOpen; label: string; value: string } => !!r && !!r.value);
  if (!rows.length && !timings.curfewNote) return null;
  return (
    <View>
      <SectionHeading title="Timings" />
      <View style={[st.table, { borderColor: p.line, backgroundColor: p.card }]}>
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <View key={r.label}>
              {i > 0 ? <Divider /> : null}
              <View style={st.timingRow} accessibilityLabel={`${r.label}: ${r.value}`}>
                <Icon size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} />
                <View style={{ flex: 1 }}>
                  <Text style={[ui.small, { color: p.muted }]}>{r.label}</Text>
                  <Text style={[ui.body, { color: p.text, marginTop: 1 }]}>{r.value}</Text>
                </View>
              </View>
            </View>
          );
        })}
        {timings.curfewNote ? (
          <>
            {rows.length ? <Divider /> : null}
            <View style={st.timingRow}>
              <IconInfo size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} />
              <View style={{ flex: 1 }}>
                <Text style={[ui.small, { color: p.muted }]}>Curfew</Text>
                <Text style={[ui.body, { color: p.text, marginTop: 1 }]}>{timings.curfewNote}</Text>
              </View>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  dayTab: { width: 52, minHeight: 52, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  dayText: { fontSize: 14, fontWeight: '600' },
  todayText: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  table: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { paddingHorizontal: 16, paddingVertical: 12 },
  liveBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  meal: { fontSize: 15, fontWeight: '600' },
  live: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  markBox: { width: 12, height: 12, borderWidth: 1.25, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  markDot: { width: 5, height: 5, borderRadius: 3 },
  notes: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 10, marginTop: 12 },
  timingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
});
