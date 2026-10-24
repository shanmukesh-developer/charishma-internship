/**
 * Co-Ride v2 · regular ride form (sheet): name, route, days, time, vehicle and seats (bike 1, car 1–4), fuel
 * (₹0–5000), auto-accept known riders, women-only. Saves with POST / PATCH /api/bikepool/templates; server
 * validation errors show under the form.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TextInput } from 'react-native';
import { CR, R, W } from './coRideV2Theme';
import { PrimaryButton, Chip, Sheet, Segmented, Tap } from './CoRideV2Kit';
import { IPlus, IMinus, STROKE } from './CoRideV2Icons';
import { WomenOnlyOption } from './CoRideV2Gender';
import { coRideApi, type Template } from './coRideV2Api';
import { clock12 } from './coRideV2Regular';
import { maxSeatsFor, FROM_PICKS, TO_PICKS } from './coRideV2Data';

export type RegDraft = {
  name: string; origin: string; destination: string; days: number[]; time: string; vehicle: 'Bike' | 'Car'; seats: number;
  fuel: number; autoAcceptKnown: boolean; womenOnly: boolean;
};
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIMES = Array.from({ length: 35 }, (_, i) => { const m = 6 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });

export const draftFrom = (t?: Partial<Template> | null, base?: Partial<RegDraft>): RegDraft => ({
  name: t?.name || base?.name || 'Home after college', origin: t?.origin || base?.origin || '', destination: t?.destination || base?.destination || '',
  days: t?.days || base?.days || [1, 2, 3, 4, 5, 6], time: t?.time || base?.time || '17:30',
  vehicle: (t?.vehicleType || base?.vehicle || 'Bike') as 'Bike' | 'Car', seats: t?.seats || base?.seats || 1, fuel: t?.estimatedFuelCost ?? base?.fuel ?? 0,
  autoAcceptKnown: !!(t?.autoAcceptKnown ?? base?.autoAcceptKnown), womenOnly: !!(t?.womenOnly ?? base?.womenOnly),
});

export default function RegularForm({ id, value, onClose, onSaved }: { id?: string; value: RegDraft; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<RegDraft>) => setR((c) => ({ ...c, ...p }));
  const ok = r.origin.trim() && r.destination.trim() && r.days.length > 0;
  const toggleDay = (d: number) => set({ days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] });
  const save = async () => {
    setBusy(true); setError(null);
    const body = {
      name: r.name.trim() || undefined, origin: r.origin.trim(), destination: r.destination.trim(), days: [...r.days].sort(), time: r.time,
      vehicleType: (r.vehicle === 'Car' ? 'car' : 'bike') as 'car' | 'bike', seats: r.vehicle === 'Bike' ? 1 : r.seats, estimatedFuelCost: r.fuel,
      autoAcceptKnown: r.autoAcceptKnown, womenOnly: r.womenOnly,
    };
    const res = id ? await coRideApi.updateTemplate(id, body) : await coRideApi.createTemplate(body);
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    onSaved(); onClose();
  };
  const input = (v: string, onChange: (t: string) => void, ph: string) => (
    <TextInput value={v} onChangeText={onChange} placeholder={ph} placeholderTextColor={CR.faint} style={st.input} maxLength={80} accessibilityLabel={ph} />
  );
  const picks = (list: string[], onPick: (p: string) => void, cur: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingTop: 8 }}>
      {list.map((p) => <Chip key={p} label={p} on={cur === p} onPress={() => onPick(p)} />)}
    </ScrollView>
  );
  return (
    <Sheet visible onClose={onClose} title={id ? 'Edit regular ride' : 'Make it a regular ride'}
      footer={<>
        {error ? <Text style={st.error}>{error}</Text> : null}
        <PrimaryButton label={id ? 'Save changes' : 'Save regular ride'} disabled={!ok} busy={busy} onPress={save} />
      </>}>
      <Text style={st.label}>Name</Text>
      {input(r.name, (name) => set({ name }), 'e.g. Home after college')}
      <Text style={st.label}>From</Text>
      {input(r.origin, (origin) => set({ origin }), 'Pickup point')}
      {picks(FROM_PICKS, (origin) => set({ origin }), r.origin)}
      <Text style={st.label}>To</Text>
      {input(r.destination, (destination) => set({ destination }), 'Destination')}
      {picks(TO_PICKS, (destination) => set({ destination }), r.destination)}
      <Text style={st.label}>Days</Text>
      <View style={st.wrap}>{WEEK_ORDER.map((d) => <Chip key={d} label={DAY_SHORT[d]} on={r.days.includes(d)} onPress={() => toggleDay(d)} />)}</View>
      <Text style={st.label}>Leaving at</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {TIMES.map((t) => <Chip key={t} label={clock12(t)} on={r.time === t} onPress={() => set({ time: t })} />)}
      </ScrollView>
      <Text style={st.label}>Vehicle and seats</Text>
      <View style={[st.row, { gap: 10 }]}>
        <Segmented<'Bike' | 'Car'> compact value={r.vehicle} onChange={(v) => set({ vehicle: v, seats: Math.min(r.seats, maxSeatsFor(v)) })} style={{ flex: 1 }} options={[{ key: 'Bike', label: 'Bike' }, { key: 'Car', label: 'Car' }]} />
        <View style={st.stepper}>
          <Tap onPress={() => set({ seats: Math.max(1, r.seats - 1) })} disabled={r.seats <= 1} label="Fewer seats" style={st.stepBtn}><IMinus size={16} color={CR.ink} strokeWidth={STROKE} /></Tap>
          <Text style={st.stepVal}>{r.seats}</Text>
          <Tap onPress={() => set({ seats: Math.min(maxSeatsFor(r.vehicle), r.seats + 1) })} disabled={r.seats >= maxSeatsFor(r.vehicle)} label="More seats" style={st.stepBtn}><IPlus size={16} color={CR.ink} strokeWidth={STROKE} /></Tap>
        </View>
      </View>
      <Text style={st.label}>Fuel cost to split (₹)</Text>
      <TextInput value={r.fuel ? String(r.fuel) : ''} onChangeText={(t) => set({ fuel: Math.min(5000, Number(t.replace(/[^0-9]/g, '')) || 0) })} placeholder="0 for a free ride" placeholderTextColor={CR.faint} keyboardType="number-pad" style={st.input} accessibilityLabel="Fuel cost to split" />
      <View style={[st.row, { gap: 12, marginTop: 18 }]}>
        <View style={{ flex: 1 }}>
          <Text style={st.switchTitle}>Auto-accept students I have ridden with</Text>
          <Text style={st.meta}>Everyone else still needs your accept or decline.</Text>
        </View>
        <Switch value={r.autoAcceptKnown} onValueChange={(v) => set({ autoAcceptKnown: v })} trackColor={{ true: CR.primary, false: CR.line }} thumbColor="#FFFFFF" {...({ activeThumbColor: '#FFFFFF' } as any)} accessibilityLabel="Auto-accept students I have ridden with" />
      </View>
      <View style={{ marginTop: 18 }}><WomenOnlyOption value={r.womenOnly} onChange={(womenOnly) => set({ womenOnly })} /></View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 13.5, fontWeight: W.label, color: CR.ink, marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: CR.field, borderRadius: R.md, paddingHorizontal: 12, minHeight: 46, fontSize: 14.5, color: CR.ink, outlineStyle: 'none' } as any,
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CR.field, borderRadius: 999, padding: 3 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  stepVal: { fontSize: 16, fontWeight: W.title, color: CR.ink, minWidth: 16, textAlign: 'center' },
  switchTitle: { fontSize: 14, color: CR.ink, fontWeight: W.label },
  meta: { fontSize: 12.5, color: CR.muted, marginTop: 2, lineHeight: 17 },
  error: { fontSize: 13, color: CR.red, marginBottom: 8 },
});
