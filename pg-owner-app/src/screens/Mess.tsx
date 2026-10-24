// Mess timetable & menu: meal timings, the weekly menu (day × meal, each tagged veg / non-veg / egg), notes
// and mess holidays (whole day or some meals). Saved in one go (PUT /listings/:id/mess); students see it on the
// PG page (holidays from today on). The server validates every field and names the one that is wrong.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';
import { Button, Card, Chip, EmptyState, ErrorStrip, IconButton, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, Field, Screen, SectionTitle } from '../ui/Screen';
import { ListingSwitcher } from '../ui/ListingSwitcher';
import { useListing } from '../state/ListingProvider';
import { useToast } from '../ui/Toast';
import { ownerApi } from '../api/ownerApi';
import { errorMessage } from '../lib/http';
import { dateLabel, istToday, shiftDay, timeLabel } from '../lib/format';
import { LIMITS } from '../config';
import type { DayKey, FoodTag, MessCell, MessHoliday, MessMeal, MessTimetable } from '../types';
import type { TabProps } from './Home';

const DAYS: { key: DayKey; short: string; long: string }[] = [
  { key: 'mon', short: 'Mon', long: 'Monday' }, { key: 'tue', short: 'Tue', long: 'Tuesday' }, { key: 'wed', short: 'Wed', long: 'Wednesday' },
  { key: 'thu', short: 'Thu', long: 'Thursday' }, { key: 'fri', short: 'Fri', long: 'Friday' }, { key: 'sat', short: 'Sat', long: 'Saturday' },
  { key: 'sun', short: 'Sun', long: 'Sunday' },
];
const TAGS: { key: Exclude<FoodTag, null>; label: string; tone: 'veg' | 'nonveg' | 'egg' }[] = [
  { key: 'veg', label: 'Veg', tone: 'veg' }, { key: 'nonveg', label: 'Non-veg', tone: 'nonveg' }, { key: 'egg', label: 'Egg', tone: 'egg' },
];
const STARTER: MessMeal[] = [
  { key: 'breakfast', label: 'Breakfast', start: '07:30', end: '09:30' },
  { key: 'lunch', label: 'Lunch', start: '12:30', end: '14:30' },
  { key: 'dinner', label: 'Dinner', start: '19:30', end: '21:30' },
];

type Draft = { meals: MessMeal[]; days: MessTimetable['days']; notes: string; holidays: MessHoliday[] };
const emptyDraft = (): Draft => ({ meals: [], days: {}, notes: '', holidays: [] });
const fromServer = (t: MessTimetable | null): Draft => (t ? {
  meals: t.meals.map((m) => ({ ...m })), days: JSON.parse(JSON.stringify(t.days || {})), notes: t.notes || '', holidays: (t.holidays || []).map((h) => ({ ...h, meals: [...h.meals] })),
} : emptyDraft());
const newMealKey = (meals: MessMeal[]) => {
  for (let i = 1; i < 50; i++) { const k = `meal_${i}`; if (!meals.some((m) => m.key === k)) return k; }
  return `meal_${Date.now() % 100000}`;
};
/** What is sent: empty menus dropped, times trimmed, past holidays dropped. */
const toPayload = (d: Draft): MessTimetable | null => {
  if (!d.meals.length) return null;
  const keys = new Set(d.meals.map((m) => m.key));
  const days: MessTimetable['days'] = {};
  for (const day of DAYS) {
    const row = d.days[day.key] || {};
    const out: Record<string, MessCell> = {};
    for (const [k, c] of Object.entries(row)) {
      if (!keys.has(k) || !c) continue;
      const menu = (c.menu || '').trim();
      if (menu || c.tag) out[k] = { menu, tag: c.tag || null };
    }
    if (Object.keys(out).length) days[day.key] = out;
  }
  const today = istToday();
  return {
    meals: d.meals.map((m) => ({ key: m.key, label: m.label.trim(), start: (m.start || '').trim() || null, end: (m.end || '').trim() || null })),
    days,
    notes: d.notes.trim(),
    holidays: d.holidays.filter((h) => h.date >= today).map((h) => ({ date: h.date, meals: h.meals.filter((k) => keys.has(k)), note: h.note.trim() })),
  };
};

export default function MessTab(_props: TabProps) {
  const { detail, loading, error, reload, setDetail, current } = useListing();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [day, setDay] = useState<DayKey>('mon');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addingHoliday, setAddingHoliday] = useState(false);

  const serverJson = useMemo(() => JSON.stringify(toPayload(fromServer(detail?.messTimetable || null))), [detail]);
  useEffect(() => { setDraft(fromServer(detail?.messTimetable || null)); setSaveError(null); }, [detail]);
  const dirty = JSON.stringify(toPayload(draft)) !== serverJson;

  const setMeal = (i: number, patch: Partial<MessMeal>) => setDraft((d) => ({ ...d, meals: d.meals.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const removeMeal = (i: number) => setDraft((d) => {
    const key = d.meals[i].key;
    const days: Draft['days'] = {};
    for (const [dk, row] of Object.entries(d.days)) { const r = { ...(row || {}) }; delete r[key]; days[dk as DayKey] = r; }
    return { ...d, meals: d.meals.filter((_, j) => j !== i), days, holidays: d.holidays.map((h) => ({ ...h, meals: h.meals.filter((k) => k !== key) })) };
  });
  const addMeal = () => setDraft((d) => ({ ...d, meals: [...d.meals, { key: newMealKey(d.meals), label: '', start: null, end: null }] }));
  const cellOf = (dk: DayKey, mk: string): MessCell => (draft.days[dk] && draft.days[dk]![mk]) || { menu: '', tag: null };
  const setCell = (dk: DayKey, mk: string, patch: Partial<MessCell>) => setDraft((d) => ({
    ...d, days: { ...d.days, [dk]: { ...(d.days[dk] || {}), [mk]: { ...cellOf(dk, mk), ...patch } } },
  }));
  const copyDayToAll = () => setDraft((d) => {
    const src = d.days[day] || {};
    const days: Draft['days'] = {};
    for (const x of DAYS) days[x.key] = JSON.parse(JSON.stringify(src));
    return { ...d, days };
  });

  const save = async () => {
    if (!detail || saving) return;
    const bad = draft.meals.find((m) => !m.label.trim());
    if (bad) { setSaveError('Give every meal a name (or remove it).'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await ownerApi.saveMess(detail.id, toPayload(draft));
      setDetail(r.listing);
      toast.show('Mess timetable saved.', 'success');
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const dayInfo = DAYS.find((x) => x.key === day)!;
  const upcoming = draft.holidays.filter((h) => h.date >= istToday());

  return (
    <Screen
      title="Mess timetable & menu"
      subtitle={current?.name}
      right={<ListingSwitcher />}
      refreshing={loading && !!detail}
      onRefresh={reload}
      keyboard
      tabBarSpace
      footer={dirty ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Undo" variant="secondary" onPress={() => setDraft(fromServer(detail?.messTimetable || null))} style={{ flex: 1 }} disabled={saving} />
          <Button label="Save timetable" icon="checkmark" onPress={save} loading={saving} style={{ flex: 2 }} />
        </View>
      ) : undefined}
    >
      {error && !detail ? <ErrorStrip text={error} onRetry={reload} busy={loading} /> : null}
      {!detail && !error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {saveError ? <Banner tone="error" text={saveError} /> : null}

      {detail && !draft.meals.length ? (
        <Card>
          <EmptyState icon="restaurant-outline" title="No mess timetable yet" body="Add your meals and their timings, then the menu for each day. Students see it on your PG page." />
          <Button label="Start with breakfast, lunch and dinner" icon="add" onPress={() => setDraft((d) => ({ ...d, meals: STARTER.map((m) => ({ ...m })) }))} />
        </Card>
      ) : null}

      {detail && draft.meals.length ? (
        <>
          <SectionTitle text="Meal timings" />
          <Card style={{ gap: space.sm }}>
            {draft.meals.map((m, i) => (
              <View key={m.key} style={st.mealRow}>
                <TextInput value={m.label} onChangeText={(v) => setMeal(i, { label: v.slice(0, 30) })} placeholder="Meal name" placeholderTextColor={color.textMuted}
                  style={[st.input, { flex: 1.4 }]} accessibilityLabel={`Meal ${i + 1} name`} />
                <TextInput value={m.start || ''} onChangeText={(v) => setMeal(i, { start: v.slice(0, 8) })} placeholder="07:30" placeholderTextColor={color.textMuted}
                  style={[st.input, st.time]} accessibilityLabel={`${m.label || 'Meal'} starts`} keyboardType="numbers-and-punctuation" />
                <Text style={[font.small, { color: color.textMuted }]}>to</Text>
                <TextInput value={m.end || ''} onChangeText={(v) => setMeal(i, { end: v.slice(0, 8) })} placeholder="09:30" placeholderTextColor={color.textMuted}
                  style={[st.input, st.time]} accessibilityLabel={`${m.label || 'Meal'} ends`} keyboardType="numbers-and-punctuation" />
                <IconButton icon="trash-outline" label={`Remove ${m.label || 'meal'}`} onPress={() => removeMeal(i)} tint={color.alertDark} bg={color.alertTint} size={38} />
              </View>
            ))}
            <Text style={[font.small, { color: color.textMuted }]}>24-hour times like 07:30 or 19:30. Leave both empty if there is no fixed time.</Text>
            {draft.meals.length < LIMITS.MAX_MEALS ? <Button label="Add a meal" icon="add" variant="secondary" size="secondary" onPress={addMeal} /> : null}
          </Card>

          <SectionTitle text="Weekly menu" right={<Pressable onPress={copyDayToAll} accessibilityRole="button" hitSlop={8}><Text style={[font.small, { color: color.primary, fontWeight: '700' }]}>Copy {dayInfo.short} to all days</Text></Pressable>} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
            {DAYS.map((x) => {
              const filled = Object.values(draft.days[x.key] || {}).some((c) => c && (c.menu.trim() || c.tag));
              return <Chip key={x.key} label={x.short} selected={day === x.key} onPress={() => setDay(x.key)} icon={filled ? 'checkmark' : undefined} />;
            })}
          </ScrollView>
          {draft.meals.map((m) => {
            const c = cellOf(day, m.key);
            return (
              <Card key={`${day}-${m.key}`} style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
                  <Text style={[font.h3, { color: color.text, flex: 1 }]}>{m.label || 'Meal'} · {dayInfo.long}</Text>
                  {m.start && m.end ? <Text style={[font.small, { color: color.textMuted }]}>{timeLabel(m.start) || m.start} – {timeLabel(m.end) || m.end}</Text> : null}
                </View>
                <TextInput value={c.menu} onChangeText={(v) => setCell(day, m.key, { menu: v.slice(0, LIMITS.MENU_LEN) })} placeholder="e.g. Idli, sambar, chutney" placeholderTextColor={color.textMuted}
                  style={[st.input, { minHeight: 64, textAlignVertical: 'top', paddingTop: 10 }]} multiline accessibilityLabel={`${m.label} menu on ${dayInfo.long}`} />
                <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
                  {TAGS.map((t) => <Chip key={t.key} label={t.label} tone={t.tone} selected={c.tag === t.key} onPress={() => setCell(day, m.key, { tag: c.tag === t.key ? null : t.key })} />)}
                </View>
              </Card>
            );
          })}

          <SectionTitle text="Mess holidays" />
          <Card style={{ gap: space.sm }}>
            {!upcoming.length ? <Text style={[font.body, { color: color.textMuted }]}>No upcoming mess holidays. Add festival days or days the mess is closed.</Text> : null}
            {upcoming.map((h) => (
              <View key={h.date} style={st.holiday}>
                <View style={st.holidayIcon}><Ionicons name="calendar-clear-outline" size={18} color={color.warn} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{dateLabel(h.date)}</Text>
                  <Text style={[font.small, { color: color.textMuted }]}>
                    {h.meals.length ? `${h.meals.map((k) => draft.meals.find((m) => m.key === k)?.label || k).join(', ')} closed` : 'Mess closed all day'}{h.note ? ` · ${h.note}` : ''}
                  </Text>
                </View>
                <IconButton icon="close" label={`Remove holiday on ${dateLabel(h.date)}`} onPress={() => setDraft((d) => ({ ...d, holidays: d.holidays.filter((x) => x.date !== h.date) }))} size={36} />
              </View>
            ))}
            {draft.holidays.length < LIMITS.HOLIDAYS_MAX ? <Button label="Add a mess holiday" icon="add" variant="secondary" size="secondary" onPress={() => setAddingHoliday(true)} /> : null}
          </Card>

          <Field label="Notes for students (optional)" value={draft.notes} onChangeText={(v) => setDraft((d) => ({ ...d, notes: v.slice(0, 1000) }))}
            placeholder="e.g. Sunday special lunch. Tell the warden by 10 am if you skip dinner." multiline />
          <Button label="Remove the whole timetable" variant="ghost" size="secondary" onPress={() => setDraft(emptyDraft())} />
        </>
      ) : null}

      <HolidaySheet
        visible={addingHoliday}
        meals={draft.meals}
        taken={draft.holidays.map((h) => h.date)}
        onClose={() => setAddingHoliday(false)}
        onAdd={(h) => { setDraft((d) => ({ ...d, holidays: [...d.holidays, h].sort((a, b) => (a.date < b.date ? -1 : 1)) })); setAddingHoliday(false); }}
      />
    </Screen>
  );
}

function HolidaySheet({ visible, meals, taken, onClose, onAdd }: {
  visible: boolean; meals: MessMeal[]; taken: string[]; onClose: () => void; onAdd: (h: MessHoliday) => void;
}) {
  const today = istToday();
  const [date, setDate] = useState(today);
  const [which, setWhich] = useState<string[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => { if (visible) { setDate(shiftDay(istToday(), 1)); setWhich([]); setNote(''); } }, [visible]);
  const days = useMemo(() => Array.from({ length: 60 }, (_, i) => shiftDay(today, i)), [today]);
  const weekday = (ymd: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${ymd}T00:00:00Z`).getUTCDay()];
  const clash = taken.includes(date);
  return (
    <Sheet visible={visible} onClose={onClose} title="Add a mess holiday">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md }}>
        <View style={{ gap: space.xs }}>
          <Text style={[font.label, { color: color.textSecondary }]}>DATE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
            {days.map((d) => {
              const on = d === date;
              const used = taken.includes(d);
              return (
                <Pressable key={d} onPress={() => setDate(d)} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: used }} disabled={used}
                  style={[st.dateChip, on && { backgroundColor: color.primary, borderColor: color.primary }, used && { opacity: 0.35 }]}>
                  <Text style={[font.label, { color: on ? color.textInverse : color.textMuted }]}>{weekday(d)}</Text>
                  <Text style={[font.h3, { color: on ? color.textInverse : color.text }]}>{Number(d.slice(8, 10))}</Text>
                  <Text style={[font.label, { color: on ? color.textInverse : color.textMuted }]}>{dateLabel(d).split(' ')[1]}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <View style={{ gap: space.xs }}>
          <Text style={[font.label, { color: color.textSecondary }]}>WHICH MEALS ARE OFF</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            <Chip label="Whole day" selected={!which.length} onPress={() => setWhich([])} />
            {meals.filter((m) => m.label.trim()).map((m) => (
              <Chip key={m.key} label={m.label} selected={which.includes(m.key)} onPress={() => setWhich((w) => (w.includes(m.key) ? w.filter((x) => x !== m.key) : [...w, m.key]))} />
            ))}
          </View>
        </View>
        <Field label="Reason (optional)" value={note} onChangeText={(v) => setNote(v.slice(0, 120))} placeholder="e.g. Sankranti" />
        {clash ? <Banner tone="warn" text="There is already a holiday on that date." /> : null}
        <Button label={`Add ${dateLabel(date)}`} icon="add" disabled={clash} onPress={() => onAdd({ date, meals: which, note: note.trim() })} />
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { ...font.body, color: color.text, minHeight: 44, borderWidth: 1.5, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: 10, backgroundColor: color.surface },
  time: { width: 66, textAlign: 'center', paddingHorizontal: 4 },
  holiday: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  holidayIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: color.warnTint, alignItems: 'center', justifyContent: 'center' },
  dateChip: { width: 58, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, alignItems: 'center', backgroundColor: color.surface },
});
