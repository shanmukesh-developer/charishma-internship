/**
 * Co-Ride v2 · My regular rides (GET /api/bikepool/templates): each template with an on/off switch (pause /
 * resume), Skip today (cancels today's posted ride too), Edit, Delete, and its next ride. The server posts
 * each one by itself ~2.5 h before departure and sends "Your 5:30 PM ride … is live · Tap to skip today"
 * (data.path /coride/regular). Opened with ?new=1&from&to… it starts the form from that ride.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert } from 'react-native';
import { CR, R, GUTTER, W, shadow } from './coRideV2Theme';
import { ScreenHeader, Pill, OutlineButton } from './CoRideV2Kit';
import { IPlus, IBell, IClock, ICheckCircle, IShield, STROKE } from './CoRideV2Icons';
import { RouteRail } from './CoRideV2RideCard';
import { StateCard, RideSkeleton, NetState } from './CoRideV2States';
import RegularForm, { draftFrom, DAY_SHORT, WEEK_ORDER, type RegDraft } from './CoRideV2RegularForm';
import { coRideApi, istDate, type Template } from './coRideV2Api';
import { clock12 } from './coRideV2Regular';
import { useCoRide } from './coRideV2Data';
import { useNav } from './coRideV2Nav';
import { inr, fmtRideWhen } from '../../modules/coride/coRideFormat';
import { themedSheet } from '../../utils/themeNow';

const daysText = (days: number[]) => {
  const set = WEEK_ORDER.filter((d) => days.includes(d));
  if (set.length === 7) return 'Every day';
  if (set.length === 6 && !days.includes(0)) return 'Mon–Sat';
  if (set.length === 5 && !days.includes(0) && !days.includes(6)) return 'Mon–Fri';
  return set.map((d) => DAY_SHORT[d]).join(', ');
};
const share = (t: Template) => (t.estimatedFuelCost > 0 ? (() => { const a = Math.ceil(t.estimatedFuelCost / (t.seats + 1)); const b = Math.ceil(t.estimatedFuelCost / 2); return a === b ? inr(a) : `${inr(a)}–${inr(b)}`; })() : null);

function status(t: Template): { text: string; tone: 'green' | 'blue' | 'neutral'; live: boolean } {
  if (!t.active) return { text: 'Paused', tone: 'neutral', live: false };
  const up = t.upcomingRide;
  if (up && up.status && up.status !== 'Cancelled') return { text: `Posted · ${fmtRideWhen(up.departureAt).label}`, tone: 'green', live: true };
  if (t.skipDates.includes(istDate(0))) return { text: 'Skipped today', tone: 'neutral', live: false };
  if (t.nextDepartureAt) return { text: `Next · ${fmtRideWhen(t.nextDepartureAt).label}`, tone: 'blue', live: false };
  return { text: 'No days set', tone: 'neutral', live: false };
}

function TemplateCard({ t, onEdit, onChanged }: { t: Template; onEdit: () => void; onChanged: () => void }) {
  const { openSheet } = useNav();
  const [busy, setBusy] = useState<string | null>(null);
  const s = status(t);
  // "Skip" acts on the next departure's date (today, or the next day this ride runs).
  const nextDate = t.upcomingRide?.rideDate || (t.nextDepartureAt ? new Date(new Date(t.nextDepartureAt).getTime() + 330 * 60000).toISOString().slice(0, 10) : null);
  const run = async (key: string, fn: () => Promise<any>, done: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) { openSheet({ kind: 'done', title: 'Could not update', body: r.message }); return; }
    onChanged();
    if (done) openSheet({ kind: 'done', title: done, body: r.data?.cancelledRideId ? 'The ride that was already posted for that day is cancelled, and anyone who asked was released.' : 'Saved.' });
  };
  const skipLabel = nextDate === istDate(0) ? 'Skip today' : 'Skip next';
  return (
    <View style={[st.card, !t.active && { opacity: 0.75 }]}>
      <View style={st.row}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={1}>{t.name || `${t.origin} → ${t.destination}`}</Text>
          <Text style={st.meta}>{daysText(t.days)} · {clock12(t.time)}</Text>
        </View>
        <Switch value={t.active} disabled={!!busy} onValueChange={(v) => run('active', () => (v ? coRideApi.resume(t.id) : coRideApi.pause(t.id)), '')}
          trackColor={{ true: CR.primary, false: CR.line }} thumbColor="#FFFFFF" {...({ activeThumbColor: '#FFFFFF' } as any)} accessibilityLabel={`${t.name || 'Regular ride'} on or off`} />
      </View>
      <View style={{ marginTop: 12 }}><RouteRail from={t.origin} to={t.destination} /></View>
      <View style={[st.row, { gap: 8, marginTop: 12, flexWrap: 'wrap' }]}>
        <Pill text={s.text} tone={s.tone} icon={s.live ? ICheckCircle : IClock} />
        <Pill text={`${t.vehicleType} · ${t.seats} seat${t.seats === 1 ? '' : 's'}`} />
        <Pill text={share(t) ? `${share(t)} per person` : 'Free ride'} />
        {t.womenOnly ? <Pill text="Women only" tone="blue" icon={IShield} /> : null}
      </View>
      <View style={[st.row, { gap: 8, marginTop: 14 }]}>
        {t.active && nextDate ? (
          <OutlineButton small label={busy === 'skip' ? 'Skipping…' : skipLabel} disabled={!!busy}
            onPress={() => Alert.alert(`${skipLabel}?`, 'This day will not be posted. If it is already live, that ride is cancelled and riders are told.', [
              { text: 'Keep', style: 'cancel' }, { text: skipLabel, style: 'destructive', onPress: () => run('skip', () => coRideApi.skip(t.id, nextDate), 'Skipped') },
            ])} style={{ flex: 1 }} />
        ) : null}
        <OutlineButton small label="Edit" onPress={onEdit} style={{ flex: 1 }} />
        <OutlineButton small label="Delete" color={CR.red} disabled={!!busy} style={{ flex: 1, borderColor: CR.redSoft }}
          onPress={() => Alert.alert('Delete this regular ride?', 'It stops posting. Rides already posted stay in My rides.', [
            { text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => run('delete', () => coRideApi.deleteTemplate(t.id), '') },
          ])} />
      </View>
    </View>
  );
}

export default function CoRideV2RegularScreen() {
  const d = useCoRide();
  const { route, back } = useNav();
  const base = route.name === 'regular' ? route.base : undefined;
  const [editing, setEditing] = useState<{ id?: string; value: RegDraft } | null>(null);
  useEffect(() => { if (base) setEditing({ value: draftFrom(null, base) }); }, [base]);
  const list = d.templates;

  const body = () => {
    if (list === null && !d.templatesError) return <RideSkeleton count={2} />;
    if (list === null) return <NetState connection={d.connection} error={d.templatesError} onRetry={d.reloadTemplates} what="your regular rides" />;
    if (!list.length) {
      return <StateCard title="No regular rides yet" body="Going home after college every day? Save it once, pick your days, and the ride posts itself about 2.5 hours before you leave." action="Make a regular ride" onAction={() => setEditing({ value: draftFrom() })} />;
    }
    return (
      <>
        {list.map((t) => <TemplateCard key={t.id} t={t} onEdit={() => setEditing({ id: t.id, value: draftFrom(t) })} onChanged={() => { d.reloadTemplates(); d.reload(); }} />)}
        {list.length < 10 ? <OutlineButton label="Add a regular ride" icon={IPlus} onPress={() => setEditing({ value: draftFrom() })} /> : <Text style={st.meta}>You have 10 regular rides, the most you can save.</Text>}
      </>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Regular rides" sub="Post once, ride every day" onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {body()}
        <View style={[st.card, { marginTop: 20 }]}>
          <View style={[st.row, { gap: 10 }]}>
            <View style={st.icon}><IBell size={16} color={CR.primary} strokeWidth={STROKE} /></View>
            <Text style={[st.meta, { flex: 1, marginTop: 0 }]}>Each day it runs, your ride goes live about 2.5 hours before you leave. You get a notification with Skip today, a reminder 15 minutes before, and you still accept each rider.</Text>
          </View>
        </View>
      </ScrollView>
      {editing ? <RegularForm id={editing.id} value={editing.value} onClose={() => setEditing(null)} onSaved={() => { d.reloadTemplates(); d.reload(); }} /> : null}
    </View>
  );
}

const st = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  card: { backgroundColor: CR.card, borderRadius: R.lg, padding: 14, marginBottom: 12, ...shadow(1) },
  name: { fontSize: 15.5, fontWeight: W.title, color: CR.ink },
  meta: { fontSize: 12.5, color: CR.muted, marginTop: 2, lineHeight: 17 },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: CR.tint, alignItems: 'center', justifyContent: 'center' },
}));
