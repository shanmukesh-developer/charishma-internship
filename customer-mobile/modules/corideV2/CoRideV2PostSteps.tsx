/**
 * Co-Ride v2 · Give a lift, the step bodies: 1 route, 2 day and time (past times hidden), 3 vehicle and
 * seats (bike 1, car 1 to 4), 4 price per seat (riders split the fuel; suggestion from similar real rides),
 * 5 preferences (who can join, auto-accept known riders, women-only for Female hosts, ride vibe, notes).
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Switch } from 'react-native';
import { WomenOnlyOption } from './CoRideV2Gender';
import { CR, R, W } from './coRideV2Theme';
import { Chip, Tap, Segmented } from './CoRideV2Kit';
import { IMapPin, ISwap, IBike, ICarSide, IMinus, IPlus, IAlert, IKey, IUser, STROKE } from './CoRideV2Icons';
import { FROM_PICKS, TO_PICKS, maxSeatsFor } from './coRideV2Data';
import { inr } from '../../modules/coride/coRideFormat';

export type Draft = {
  role: 'rider' | 'passenger'; from: string; to: string; day: number; slot: string | null;
  vehicle: 'Bike' | 'Car'; seats: number; fuel: string; vibe: string; autoApprove: boolean; notes: string;
  womenOnly: boolean; autoAcceptKnown: boolean;
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayLabel = (off: number) => { const d = new Date(); d.setDate(d.getDate() + off); return off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : `${DAYS[d.getDay()]} ${d.getDate()}`; };
export const slotLabel = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
export const draftDate = (dr: Draft) => {
  if (!dr.slot) return null;
  const [h, m] = dr.slot.split(':').map(Number);
  const d = new Date(); d.setDate(d.getDate() + dr.day); d.setHours(h, m, 0, 0);
  return d;
};
const SLOTS = Array.from({ length: (24 - 6) * 4 }, (_, i) => { const mins = 6 * 60 + i * 15; return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; });
const PARTS: { label: string; from: number; to: number }[] = [
  { label: 'Morning', from: 6, to: 12 }, { label: 'Afternoon', from: 12, to: 17 }, { label: 'Evening', from: 17, to: 21 }, { label: 'Night', from: 21, to: 24 },
];
export const NOTE_ADDONS = ['Small bag is fine', 'No luggage, please', 'Helmet provided', 'Can stop on the way'];

export function Label({ text, hint }: { text: string; hint?: string }) {
  return (
    <View style={st.labelRow}>
      <Text style={st.label}>{text}</Text>
      {hint ? <Text style={st.hint}>{hint}</Text> : null}
    </View>
  );
}
export function Err({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <View style={st.errRow} accessibilityLiveRegion="polite"><IAlert size={14} color={CR.red} strokeWidth={STROKE} /><Text style={st.err}>{msg}</Text></View>;
}
function PlaceInput({ value, onChange, placeholder, picks, error }: { value: string; onChange: (v: string) => void; placeholder: string; picks: string[]; error?: string }) {
  return (
    <>
      <View style={[st.input, error ? { borderColor: CR.red } : null]}>
        <IMapPin size={18} color={CR.primary} strokeWidth={STROKE} />
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={CR.faint} style={st.inputText} maxLength={80} accessibilityLabel={placeholder} />
      </View>
      <Err msg={error} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={st.chips}>
        {picks.map((p) => <Chip key={p} label={p} on={value === p} onPress={() => onChange(p)} />)}
      </ScrollView>
    </>
  );
}

export function StepRoute({ dr, set, errors }: { dr: Draft; set: (p: Partial<Draft>) => void; errors: Record<string, string> }) {
  return (
    <View>
      <Label text="You are" />
      <Segmented<'rider' | 'passenger'> compact value={dr.role} onChange={(role) => set({ role })} options={[{ key: 'rider', label: 'Offering seats', icon: IKey }, { key: 'passenger', label: 'Asking for a lift', icon: IUser }]} />
      <Label text="From" />
      <PlaceInput value={dr.from} onChange={(from) => set({ from })} placeholder="Pickup point, e.g. Campus Gate" picks={FROM_PICKS} error={errors.from} />
      <Tap onPress={() => set({ from: dr.to, to: dr.from })} label="Swap from and to" style={st.swap}><ISwap size={16} color={CR.primary} strokeWidth={STROKE} /><Text style={st.swapText}>Swap</Text></Tap>
      <Label text="To" />
      <PlaceInput value={dr.to} onChange={(to) => set({ to })} placeholder="Destination, e.g. PVP Square Mall" picks={TO_PICKS} error={errors.to} />
    </View>
  );
}

export function StepTime({ dr, set, errors }: { dr: Draft; set: (p: Partial<Draft>) => void; errors: Record<string, string> }) {
  const now = new Date();
  const minMins = now.getHours() * 60 + now.getMinutes() + 10;
  const slots = SLOTS.filter((s) => { if (dr.day > 0) return true; const [h, m] = s.split(':').map(Number); return h * 60 + m >= minMins; });
  return (
    <View>
      <Label text="Day" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
        {Array.from({ length: 7 }).map((_, i) => <Chip key={i} label={dayLabel(i)} on={dr.day === i} onPress={() => set({ day: i, slot: null })} />)}
      </ScrollView>
      <Label text="Leaving at" hint={dr.day === 0 ? 'Past times are hidden' : undefined} />
      <Err msg={errors.slot} />
      {slots.length === 0 ? <Text style={[st.hint, st.hintLeft]}>No times left today. Pick tomorrow.</Text> : null}
      {PARTS.map((p) => {
        const list = slots.filter((s) => { const h = Number(s.slice(0, 2)); return h >= p.from && h < p.to; });
        if (!list.length) return null;
        return (
          <View key={p.label} style={{ marginTop: 10 }}>
            <Text style={st.part}>{p.label}</Text>
            <View style={st.grid}>
              {list.map((s) => (
                <Tap key={s} onPress={() => set({ slot: s })} label={slotLabel(s)} role="tab" selected={dr.slot === s} style={[st.slot, dr.slot === s && st.slotOn]}>
                  <Text style={[st.slotText, dr.slot === s && { color: '#FFFFFF' }]}>{slotLabel(s)}</Text>
                </Tap>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function StepVehicle({ dr, set }: { dr: Draft; set: (p: Partial<Draft>) => void }) {
  const cap = maxSeatsFor(dr.vehicle);
  const pick = (v: 'Bike' | 'Car') => set({ vehicle: v, seats: Math.min(dr.seats, maxSeatsFor(v)) });
  return (
    <View>
      <Label text={dr.role === 'rider' ? 'Your vehicle' : 'Vehicle you prefer'} />
      <View style={st.vRow}>
        {(['Bike', 'Car'] as const).map((v) => {
          const on = dr.vehicle === v;
          const Icon = v === 'Bike' ? IBike : ICarSide;
          return (
            <Tap key={v} onPress={() => pick(v)} label={v} role="tab" selected={on} style={[st.vCard, on && st.vOn]}>
              <Icon size={26} color={on ? CR.primary : CR.ink2} strokeWidth={STROKE} />
              <Text style={[st.vTitle, on && { color: CR.primaryDeep }]}>{v}</Text>
              <Text style={[st.hint, st.hintLeft, { marginTop: 0 }]}>{v === 'Bike' ? '1 pillion seat' : 'Up to 4 seats'}</Text>
            </Tap>
          );
        })}
      </View>
      <Label text={dr.role === 'rider' ? 'Seats you can offer' : 'Seats you need'} hint={dr.vehicle === 'Bike' ? 'A bike takes one pillion rider' : '1 to 4 in a car'} />
      <View style={st.stepper} accessibilityRole="adjustable" accessibilityLabel={`Seats: ${dr.seats}`}>
        <Tap onPress={() => set({ seats: Math.max(1, dr.seats - 1) })} disabled={dr.seats <= 1} label="Fewer seats" style={st.stepBtn}><IMinus size={18} color={CR.ink} strokeWidth={STROKE} /></Tap>
        <Text style={st.stepVal}>{dr.seats}</Text>
        <Tap onPress={() => set({ seats: Math.min(cap, dr.seats + 1) })} disabled={dr.seats >= cap} label="More seats" style={st.stepBtn}><IPlus size={18} color={CR.ink} strokeWidth={STROKE} /></Tap>
      </View>
    </View>
  );
}

export function StepPrice({ dr, set, suggest, errors }: { dr: Draft; set: (p: Partial<Draft>) => void; suggest: number[]; errors: Record<string, string> }) {
  const fuel = Math.max(0, Math.round(Number(dr.fuel) || 0));
  const each = useMemo(() => (fuel > 0 ? { min: Math.ceil(fuel / (dr.seats + 1)), max: Math.ceil(fuel / 2) } : null), [fuel, dr.seats]);
  return (
    <View>
      <View style={st.readout}>
        <Text style={st.readoutBig}>{each ? (each.min === each.max ? inr(each.min) : `${inr(each.min)} – ${inr(each.max)}`) : 'Free'}</Text>
        <Text style={[st.hint, st.hintLeft]}>{each ? (each.min === each.max ? 'per seat' : `per seat: ${inr(each.min)} when all ${dr.seats} fill, ${inr(each.max)} with one rider`) : 'No fuel split on this ride'}</Text>
      </View>
      <Label text="Fuel cost to split" hint="Shared by you and your riders" />
      <View style={[st.input, errors.fuel ? { borderColor: CR.red } : null]}>
        <Text style={st.rupee}>₹</Text>
        <TextInput value={dr.fuel === '0' ? '' : dr.fuel} onChangeText={(v) => set({ fuel: v.replace(/[^0-9]/g, '') || '0' })} placeholder="0" placeholderTextColor={CR.faint} keyboardType="number-pad" maxLength={4} style={st.inputText} accessibilityLabel="Fuel cost to split, in rupees" />
      </View>
      <Err msg={errors.fuel} />
      <Label text="Suggested" hint={suggest.length ? 'From similar rides posted on ZENV' : undefined} />
      {suggest.length ? (
        <View style={[st.grid, { marginTop: 2 }]}>
          {suggest.map((v) => <Chip key={v} label={inr(v)} on={fuel === v} onPress={() => set({ fuel: String(v) })} />)}
          <Chip label="Free ride" on={fuel === 0} onPress={() => set({ fuel: '0' })} />
        </View>
      ) : <Text style={[st.hint, st.hintLeft]}>No similar rides yet to suggest a price. Leave it empty for a free ride.</Text>}
    </View>
  );
}

export function StepPrefs({ dr, set }: { dr: Draft; set: (p: Partial<Draft>) => void }) {
  const addNote = (t: string) => set({ notes: dr.notes.includes(t) ? dr.notes.replace(t, '').replace(/\s*·\s*·\s*/g, ' · ').replace(/^\s*·\s*|\s*·\s*$/g, '') : [dr.notes.trim(), t].filter(Boolean).join(' · ') });
  return (
    <View>
      <Label text="Who can join" />
      <Segmented<'approve' | 'any'> compact value={dr.autoApprove ? 'any' : 'approve'} onChange={(v) => set({ autoApprove: v === 'any' })} options={[{ key: 'approve', label: 'I approve each' }, { key: 'any', label: 'Anyone, instantly' }]} />
      {!dr.autoApprove && dr.role === 'rider' ? (
        <View style={[st.vRow, { alignItems: 'center', marginTop: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={st.label}>Auto-accept students I have ridden with</Text>
            <Text style={[st.hint, st.hintLeft, { marginTop: 0 }]}>Everyone else still needs your accept or decline.</Text>
          </View>
          <Switch value={dr.autoAcceptKnown} onValueChange={(v) => set({ autoAcceptKnown: v })} trackColor={{ true: CR.primary, false: CR.line }} thumbColor="#FFFFFF" {...({ activeThumbColor: '#FFFFFF' } as any)} accessibilityLabel="Auto-accept students I have ridden with" />
        </View>
      ) : null}
      {dr.role === 'rider' ? <View style={{ marginTop: 16 }}><WomenOnlyOption value={dr.womenOnly} onChange={(womenOnly) => set({ womenOnly })} /></View> : null}
      <Label text="Ride preference" />
      <View style={st.grid}>
        {[{ k: 'Any', l: 'No preference' }, { k: 'Silent Ride 🤫', l: 'Quiet ride' }, { k: 'Chatty 💬', l: 'Chatty' }].map((v) => <Chip key={v.k} label={v.l} on={dr.vibe === v.k} onPress={() => set({ vibe: v.k })} />)}
      </View>
      <Label text="Luggage and notes" hint="Optional" />
      <View style={st.grid}>
        {NOTE_ADDONS.filter((n) => dr.vehicle === 'Bike' || n !== 'Helmet provided').map((n) => <Chip key={n} label={n} on={dr.notes.includes(n)} onPress={() => addNote(n)} />)}
      </View>
      <View style={[st.input, { minHeight: 84, alignItems: 'flex-start', paddingTop: 10, marginTop: 10 }]}>
        <TextInput value={dr.notes} onChangeText={(notes) => set({ notes })} placeholder="Anything riders should know" placeholderTextColor={CR.faint} style={[st.inputText, { minHeight: 64, textAlignVertical: 'top' }]} multiline maxLength={300} accessibilityLabel="Notes for riders" />
      </View>
    </View>
  );
}

export const st = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: W.label, color: CR.ink },
  hint: { fontSize: 12.5, color: CR.muted, flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  hintLeft: { textAlign: 'left', marginLeft: 0, marginTop: 4, lineHeight: 17 },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  err: { fontSize: 12.5, color: CR.red },
  input: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CR.field, borderRadius: R.md, paddingHorizontal: 12, minHeight: 50, borderWidth: 1, borderColor: 'transparent' },
  inputText: { flex: 1, fontSize: 15, color: CR.ink, paddingVertical: 8, outlineStyle: 'none' } as any,
  rupee: { fontSize: 16, color: CR.muted },
  chips: { gap: 8, paddingTop: 10, paddingRight: 8 },
  swap: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', minHeight: 36, marginTop: 6 },
  swapText: { fontSize: 13, color: CR.primary, fontWeight: W.label },
  part: { fontSize: 12.5, color: CR.muted, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { minWidth: 82, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: CR.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line },
  slotOn: { backgroundColor: CR.primary, borderColor: CR.primary },
  slotText: { fontSize: 13.5, color: CR.ink2, fontWeight: W.label },
  vRow: { flexDirection: 'row', gap: 12 },
  vCard: { flex: 1, borderRadius: R.lg, padding: 14, gap: 6, backgroundColor: CR.card, borderWidth: 1, borderColor: CR.line },
  vOn: { borderColor: CR.primary, backgroundColor: CR.tint },
  vTitle: { fontSize: 15.5, fontWeight: W.title, color: CR.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 18, backgroundColor: CR.card, borderRadius: R.pill, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line, padding: 4 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: CR.field },
  stepVal: { fontSize: 20, fontWeight: W.title, color: CR.ink, minWidth: 24, textAlign: 'center' },
  readout: { backgroundColor: CR.tint, borderRadius: R.lg, padding: 16, marginTop: 4 },
  readoutBig: { fontSize: 26, fontWeight: W.title, color: CR.primaryDeep, letterSpacing: -0.4 },
});
