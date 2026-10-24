/**
 * Screen 9 · Mess timetable and weekly menu: Timetable / Weekly Menu control; the timetable shows
 * today's meal times (tinted rows) and today's menu; the weekly menu has a day picker (today marked).
 * All from the PG's messTimetable (times in IST). Empty state when the PG has none.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { PG2, R, GUTTER, W } from './pgV2Theme';
import { Header, Tap, Segmented, SectionTitle, EmptyState, Loading, k } from './PgV2Kit';
import { IUtensils, mealIcon } from './PgV2Icons';
import { SLATE } from './PgV2Amenities';
import { usePgDetail } from './pgV2Data';
import { useNav, usePgIdFor } from './pgV2Nav';
import { DAY_KEYS, DAY_SHORT, DAY_LONG, FOOD_TAG_LABEL, fmtRange, istNow, mealsForDay, type DayKey, type FoodTag, type MealSlot, type MessTimetable } from '../../modules/pg/pgApi';

const TAG_COLOR: Record<'veg' | 'nonveg' | 'egg', string> = { veg: '#15803D', nonveg: '#9A3412', egg: '#B45309' };

function FoodMark({ tag }: { tag: FoodTag }) {
  if (!tag) return null;
  return (
    <View style={[k.row, { gap: 5 }]} accessibilityLabel={FOOD_TAG_LABEL[tag]}>
      <View style={[st.markBox, { borderColor: TAG_COLOR[tag] }]}><View style={[st.markDot, { backgroundColor: TAG_COLOR[tag] }]} /></View>
      <Text style={k.small}>{FOOD_TAG_LABEL[tag]}</Text>
    </View>
  );
}

function Timings({ slots }: { slots: MealSlot[] }) {
  const timed = slots.filter((s) => s.start || s.end);
  if (!timed.length) return null;
  return (
    <View style={st.card}>
      {timed.map((s, i) => {
        const Icon = mealIcon(s.meal.key || s.meal.label);
        return (
          <View key={s.meal.key} style={[st.timeRow, i > 0 && st.hair]}>
            <Icon size={20} color={SLATE} strokeWidth={1.6} />
            <Text style={st.meal}>{s.meal.label}</Text>
            <Text style={st.time}>{fmtRange(s.start, s.end)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Menu({ slots }: { slots: MealSlot[] }) {
  const withMenu = slots.filter((s) => s.cell && (s.cell.menu || s.cell.tag));
  if (!withMenu.length) return <Text style={k.small}>The menu for this day hasn't been added.</Text>;
  return (
    <View style={[k.card, { paddingHorizontal: 12 }]}>
      {withMenu.map((s, i) => {
        const Icon = mealIcon(s.meal.key || s.meal.label);
        return (
          <View key={s.meal.key} style={[st.menuRow, i > 0 && st.hair]}>
            <Icon size={20} color={SLATE} strokeWidth={1.6} />
            <Text style={st.menuMeal}>{s.meal.label}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              {s.cell?.menu ? <Text style={st.menuText}>{s.cell.menu}</Text> : null}
              <FoodMark tag={s.cell?.tag || null} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Weekly({ t, today }: { t: MessTimetable; today: DayKey }) {
  const [day, setDay] = useState<DayKey>(today);
  const slots = mealsForDay(t, day);
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>
        {DAY_KEYS.map((d) => {
          const on = d === day;
          return (
            <Tap key={d} onPress={() => setDay(d)} role="tab" selected={on} label={DAY_LONG[d]} style={[st.day, on && { backgroundColor: PG2.primary, borderColor: PG2.primary }]}>
              <Text style={[st.dayText, on && { color: '#FFFFFF' }]}>{DAY_SHORT[d]}</Text>
              {d === today ? <View style={[st.todayDot, on && { backgroundColor: '#FFFFFF' }]} /> : null}
            </Tap>
          );
        })}
      </ScrollView>
      <SectionTitle title={day === today ? `Today · ${DAY_LONG[day]}` : DAY_LONG[day]} />
      <Timings slots={slots} />
      <View style={{ height: 16 }} />
      <Menu slots={slots} />
    </View>
  );
}

export default function PgV2Mess() {
  const nav = useNav();
  const id = usePgIdFor();
  const { pg, state } = usePgDetail(id);
  const [mode, setMode] = useState<'timetable' | 'weekly'>('timetable');
  const now = istNow();
  const t = pg?.messTimetable && pg.messTimetable.meals.length ? pg.messTimetable : null;

  return (
    <View style={{ flex: 1, backgroundColor: PG2.page }}>
      <Header title="Mess Timetable & Menu" onBack={nav.back} />
      {state === 'loading' ? <Loading /> : !t ? (
        <EmptyState icon={IUtensils} title="Mess timetable not added yet" body={pg ? `${pg.name} hasn't shared its mess timings and menu.` : undefined} action="Back" onAction={nav.back} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: GUTTER, paddingTop: 6, paddingBottom: 40 }}>
          <Segmented value={mode} onChange={setMode} options={[{ key: 'timetable', label: 'Timetable' }, { key: 'weekly', label: 'Weekly Menu' }]} />
          <View style={{ height: 20 }} />
          {mode === 'timetable' ? (
            <>
              <SectionTitle title="Mess Timings" />
              <Timings slots={mealsForDay(t, now.day)} />
              <SectionTitle title="Today's Menu" style={{ marginTop: 24 }} />
              <Menu slots={mealsForDay(t, now.day)} />
              {t.notes ? <Text style={[k.small, { marginTop: 16, lineHeight: 18 }]}>{t.notes}</Text> : null}
            </>
          ) : <Weekly t={t} today={now.day} />}
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: R.md, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E6E3F5', paddingHorizontal: 14 },
  hair: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ECEAF5' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 50 },
  meal: { flex: 1, fontSize: 14, fontWeight: W.label, color: PG2.ink },
  time: { fontSize: 13.5, color: PG2.ink2 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10 },
  menuIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  menuMeal: { width: 84, fontSize: 13.5, fontWeight: W.label, color: PG2.ink },
  menuText: { fontSize: 13, color: PG2.ink2, lineHeight: 18 },
  markBox: { width: 12, height: 12, borderWidth: 1.25, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  markDot: { width: 5, height: 5, borderRadius: 3 },
  day: { width: 52, height: 52, borderRadius: R.md, borderWidth: 1, borderColor: PG2.line, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 13.5, fontWeight: W.label, color: PG2.ink2 },
  todayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: PG2.primary, marginTop: 4 },
});
