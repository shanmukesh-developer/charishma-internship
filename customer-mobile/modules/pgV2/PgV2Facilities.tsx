/**
 * Screen 5 · Amenities & Facilities: the building's facilities grid, today's mess timings ("View Menu"
 * opens the timetable) and a food note worked out from the menu marks (veg / non-veg / egg) plus the
 * mess notes the housing team wrote (e.g. the mess holiday). Hidden when the PG has no mess timetable.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { PG2, R, GUTTER, W } from './pgV2Theme';
import { Header, SectionTitle, EmptyState, Loading, k } from './PgV2Kit';
import { AmenityGroups, normaliseAmenities } from './PgV2Amenities';
import { IInfo, IBuilding, IUtensils, mealIcon, STROKE } from './PgV2Icons';
import { usePgDetail } from './pgV2Data';
import { useNav, usePgIdFor } from './pgV2Nav';
import { DAY_KEYS, fmtRange, istNow, mealsForDay, type MessTimetable } from '../../modules/pg/pgApi';
import { themedSheet } from '../../utils/themeNow';

/** "Veg / Non-Veg Available", "Veg only", … from the tags used anywhere in the week. Empty when untagged. */
export const foodLine = (t: MessTimetable) => {
  const tags = new Set<string>();
  DAY_KEYS.forEach((d) => Object.values(t.days[d] || {}).forEach((c) => { if (c?.tag) tags.add(c.tag); }));
  const veg = tags.has('veg');
  const non = tags.has('nonveg');
  const egg = tags.has('egg');
  if (veg && (non || egg)) return `Veg / ${non ? 'Non-Veg' : 'Egg'} Available`;
  if (veg) return 'Pure veg mess';
  if (non) return 'Non-veg served';
  if (egg) return 'Egg served';
  return '';
};

export function MessTimingRows({ t }: { t: MessTimetable }) {
  const now = istNow();
  const slots = mealsForDay(t, now.day).filter((s) => s.start || s.end);
  if (!slots.length) return null;
  return (
    <View style={[k.card, { paddingHorizontal: 14 }]}>
      {slots.map((s, i) => {
        const Icon = mealIcon(s.meal.key || s.meal.label);
        return (
          <View key={s.meal.key} style={[st.timeRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: PG2.line }]}>
            <Icon size={19} color={PG2.ink} strokeWidth={STROKE} />
            <Text style={st.meal}>{s.meal.label}</Text>
            <Text style={st.time}>{fmtRange(s.start, s.end)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function FoodNote({ t }: { t: MessTimetable }) {
  const line = foodLine(t);
  const notes = (t.notes || '').trim();
  if (!line && !notes) return null;
  return (
    <View style={st.note}>
      <View style={st.noteIcon}><IInfo size={20} color="#475569" strokeWidth={1.6} /></View>
      <View style={{ flex: 1 }}>
        {line ? <Text style={st.noteTitle}>{line}</Text> : null}
        {notes ? <Text style={st.noteBody}>{notes}</Text> : null}
      </View>
    </View>
  );
}

export default function PgV2Facilities() {
  const nav = useNav();
  const id = usePgIdFor();
  const { width } = useWindowDimensions();
  const { pg, state } = usePgDetail(id);
  const cellW = Math.floor((width - GUTTER * 2) / 4);
  const mess = pg?.messTimetable && pg.messTimetable.meals.length ? pg.messTimetable : null;

  return (
    <View style={{ flex: 1, backgroundColor: PG2.page }}>
      <Header title="Amenities & Facilities" onBack={nav.back} />
      {state === 'loading' ? <Loading /> : !pg ? <EmptyState icon={IBuilding} title="This PG isn't available" action="Back" onAction={nav.back} /> : (
        <ScrollView contentContainerStyle={{ padding: GUTTER, paddingTop: 8, paddingBottom: 40 }}>
          <SectionTitle title="Building Facilities" />
          {pg.amenities.length ? (
            <AmenityGroups items={normaliseAmenities(pg.amenities)} />
          ) : <Text style={k.small}>Facilities haven't been added yet.</Text>}

          <SectionTitle title="Mess Timings" action={mess ? 'View Menu' : undefined} onAction={() => nav.push({ name: 'mess', pgId: pg.id })} style={{ marginTop: 30 }} />
          {mess ? (
            <>
              <MessTimingRows t={mess} />
              <FoodNote t={mess} />
            </>
          ) : (
            <View style={st.none}>
              <IUtensils size={18} color={PG2.muted} strokeWidth={STROKE} />
              <Text style={[k.body, { color: PG2.muted, flex: 1 }]}>The mess timetable hasn't been added for this PG yet.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const st = themedSheet(() => ({
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54 },
  meal: { flex: 1, fontSize: 14, color: PG2.ink, fontWeight: W.label },
  time: { fontSize: 14, color: PG2.ink2 },
  note: { marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: PG2.line, backgroundColor: PG2.card },
  noteIcon: { width: 24, alignItems: 'center', paddingTop: 1 },
  noteTitle: { fontSize: 13.5, fontWeight: W.label, color: PG2.ink },
  noteBody: { marginTop: 3, fontSize: 13, color: PG2.muted, lineHeight: 19 },
  none: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: PG2.card, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: PG2.line },
}));
