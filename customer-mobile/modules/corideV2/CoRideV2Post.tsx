/**
 * Co-Ride v2 · Give a lift (and Ask for a lift): a six-step sheet with live validation, then review and post.
 * The payload is exactly the current app's POST /api/bikepool/posts body (creatorRole, origin, destination,
 * departureTime, vehicleType, availableSeats, estimatedFuelCost, notes, rideVibe, autoApprove).
 * After posting: My rides, with the "Ride posted" sheet. Opens on the last offered ride for a one-tap repeat.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CR, R, GUTTER, W, shadow } from './coRideV2Theme';
import { ScreenHeader, PrimaryButton, OutlineButton, Tap } from './CoRideV2Kit';
import { IArrowRight } from './CoRideV2Icons';
import { RouteRail } from './CoRideV2RideCard';
import { StepRoute, StepTime, StepVehicle, StepPrice, StepPrefs, draftDate, dayLabel, slotLabel, type Draft } from './CoRideV2PostSteps';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { RepeatCard, OrDivider, nextAtSameTime, repeatBody } from './CoRideV2Repeat';
import { lastOffer, offeredSeats, timeOfRide, clock12 } from './coRideV2Regular';
import { useCoRide, maxSeatsFor, isOffer } from './coRideV2Data';
import { useNav } from './coRideV2Nav';
import { inr, sameDestination, vibeLabel } from '../../modules/coride/coRideFormat';
import { themedSheet } from '../../utils/themeNow';

const STEPS = ['Route', 'Date and time', 'Vehicle and seats', 'Price per seat', 'Preferences', 'Review'];
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);

export default function CoRideV2Post() {
  const d = useCoRide();
  const { route, back, openSheet, replace, push } = useNav();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState<Record<number, boolean>>({});
  const r0 = route.name === 'post' ? route : null;
  // Weekend trip: start on the coming Friday (or today if it is already Fri–Sun).
  const weekendDay = (() => { const dow = new Date(Date.now() + 330 * 60000).getUTCDay(); return dow >= 5 || dow === 0 ? 0 : 5 - dow; })();
  const [dr, setDr] = useState<Draft>({
    role: r0 ? r0.role : 'rider', from: '', to: r0?.prefillTo || '', day: r0?.weekend ? weekendDay : 0, slot: null,
    vehicle: r0?.weekend ? 'Car' : 'Bike', seats: 1, fuel: '0', vibe: 'Any', autoApprove: false, notes: '', womenOnly: false, autoAcceptKnown: false,
  });
  const last = (r0?.repeatId ? d.myRides.find((x) => String(x.id) === r0.repeatId) : null) || (r0?.role === 'rider' && !r0?.weekend && !r0?.prefillTo ? lastOffer(d.myRides, d.myId) : null);
  const [hideRepeat, setHideRepeat] = useState(false);
  const showRepeat = !!last && !hideRepeat;
  const editFrom = (ride: any) => {
    setHideRepeat(true);
    setDr((c) => ({ ...c, role: 'rider', from: String(ride.origin), to: String(ride.destination), vehicle: ride.vehicleType === 'Car' ? 'Car' : 'Bike',
      seats: offeredSeats(ride), fuel: String(Math.round(Number(ride.estimatedFuelCost) || 0)), vibe: String(ride.rideVibe || 'Any'), autoApprove: !!ride.autoApprove, notes: String(ride.notes || ''),
      womenOnly: ride.womenOnly === true, autoAcceptKnown: ride.autoAcceptKnown === true,
      day: nextAtSameTime(ride).today ? 0 : 1, slot: timeOfRide(ride) }));
  };
  const repeat = async () => {
    if (!last) return;
    const next = nextAtSameTime(last);
    const body = repeatBody(last, next.date);
    const r = await d.act('post', { body });
    if (!r.ok) { openSheet({ kind: 'done', title: 'Could not post the ride', body: r.message || 'Please try again.' }); return; }
    const sh = body.estimatedFuelCost > 0 ? { a: Math.ceil(body.estimatedFuelCost / (body.availableSeats + 1)), b: Math.ceil(body.estimatedFuelCost / 2) } : null;
    replace({ name: 'mine', as: 'driver' }, { kind: 'posted', base: { origin: body.origin, destination: body.destination, time: next.hhmm, vehicle: body.vehicleType as 'Bike' | 'Car', seats: body.availableSeats, fuel: body.estimatedFuelCost }, summary: { from: body.origin, to: body.destination, when: `${next.today ? 'Today' : 'Tomorrow'}, ${clock12(next.hhmm)}`, vehicle: body.vehicleType, seats: body.availableSeats, share: sh ? (sh.a === sh.b ? inr(sh.a) : `${inr(sh.a)}–${inr(sh.b)}`) : null, role: 'rider' } });
  };
  const set = (p: Partial<Draft>) => setDr((cur) => ({ ...cur, ...p }));

  // Suggested fuel totals from similar REAL rides (same destination, else same vehicle); none when there are none.
  const suggest = useMemo(() => {
    const offers = d.rides.filter((r) => isOffer(r) && Number(r.estimatedFuelCost) > 0);
    const same = offers.filter((r) => sameDestination(r.destination, dr.to));
    const pool = (same.length ? same : offers.filter((r) => (r.vehicleType === 'Car') === (dr.vehicle === 'Car'))).map((r) => Number(r.estimatedFuelCost));
    if (!pool.length) return [] as number[];
    const m = median(pool);
    return Array.from(new Set([round10(m * 0.8), round10(m), round10(m * 1.2)]));
  }, [d.rides, dr.to, dr.vehicle]);

  const when = draftDate(dr);
  const errors: Record<string, string> = {};
  if (!dr.from.trim()) errors.from = 'Add where you start from.';
  if (!dr.to.trim()) errors.to = 'Add where you are going.';
  else if (dr.from.trim() && sameDestination(dr.from, dr.to)) errors.to = 'From and To are the same place.';
  if (!when) errors.slot = 'Pick when you leave.';
  else if (when.getTime() < Date.now()) errors.slot = 'That time has passed. Pick a later one.';
  const fuel = Math.round(Number(dr.fuel) || 0);
  if (fuel > 5000) errors.fuel = 'Keep the fuel cost under ₹5,000.';
  const stepErrors = [['from', 'to'], ['slot'], [], ['fuel'], [], []][step].filter((k) => errors[k]);
  const shown = tried[step] ? errors : {};

  const next = () => {
    if (stepErrors.length) { setTried((t) => ({ ...t, [step]: true })); return; }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const share = fuel > 0 ? { min: Math.ceil(fuel / (dr.seats + 1)), max: Math.ceil(fuel / 2) } : null;
  const shareText = share ? (share.min === share.max ? inr(share.min) : `${inr(share.min)}–${inr(share.max)}`) : null;

  const post = async () => {
    const bad = Object.keys(errors);
    if (bad.length) { setStep(bad.some((k) => k === 'from' || k === 'to') ? 0 : bad.includes('slot') ? 1 : 3); return; }
    const body = {
      creatorRole: dr.role, origin: dr.from.trim(), destination: dr.to.trim(), departureTime: when!.toISOString(),
      vehicleType: dr.vehicle, availableSeats: Math.min(maxSeatsFor(dr.vehicle), dr.seats), estimatedFuelCost: Math.max(0, Math.min(5000, fuel)),
      notes: dr.notes.trim(), rideVibe: dr.vibe, autoApprove: dr.autoApprove,
      womenOnly: dr.role === 'rider' && dr.womenOnly, autoAcceptKnown: dr.role === 'rider' && !dr.autoApprove && dr.autoAcceptKnown,
    };
    const r = await d.act('post', { body });
    if (!r.ok) { openSheet({ kind: 'done', title: 'Could not post the ride', body: r.message || 'Please check the details and try again.' }); return; }
    replace({ name: 'mine', as: dr.role === 'rider' ? 'driver' : 'rider' }, { kind: 'posted', base: { origin: body.origin, destination: body.destination, time: dr.slot!, vehicle: dr.vehicle, seats: body.availableSeats, fuel: body.estimatedFuelCost }, summary: { from: body.origin, to: body.destination, when: `${dayLabel(dr.day)}, ${slotLabel(dr.slot!)}`, vehicle: dr.vehicle, seats: body.availableSeats, share: shareText, role: dr.role } });
  };

  const review = (
    <View>
      {[
        { k: 0, t: 'Route', v: <RouteRail from={dr.from || 'Not set'} to={dr.to || 'Not set'} /> },
        { k: 1, t: 'Leaving', v: <Text style={st.val}>{dr.slot ? `${dayLabel(dr.day)}, ${slotLabel(dr.slot)}` : 'Not set'}</Text> },
        { k: 2, t: dr.role === 'rider' ? 'Vehicle and seats' : 'Vehicle and seats needed', v: <Text style={st.val}>{dr.vehicle} · {dr.seats} seat{dr.seats === 1 ? '' : 's'}</Text> },
        { k: 3, t: 'Price per seat', v: <Text style={st.val}>{shareText ? `${shareText} per seat · ${inr(fuel)} fuel in total` : 'Free ride'}</Text> },
        { k: 4, t: 'Preferences', v: <Text style={st.val}>{dr.womenOnly ? 'Women only · ' : ''}{dr.autoApprove ? 'Anyone can join instantly' : dr.autoAcceptKnown ? 'You approve new riders; known riders join at once' : 'You approve each rider'}{vibeLabel(dr.vibe) ? ` · ${vibeLabel(dr.vibe)}` : ''}{dr.notes ? `\n${dr.notes}` : ''}</Text> },
      ].map((row) => (
        <View key={row.k} style={st.reviewRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.reviewLabel}>{row.t}</Text>
            <View style={{ marginTop: 6 }}>{row.v}</View>
          </View>
          <Tap onPress={() => setStep(row.k)} label={`Edit ${row.t.toLowerCase()}`} role="link" style={st.edit}><Text style={st.editText}>Edit</Text></Tap>
        </View>
      ))}
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScreenHeader title={dr.role === 'rider' ? 'Offer a seat' : 'Ask for a lift'} sub={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} onBack={step ? () => setStep(step - 1) : back} />
      <View style={st.progress} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => <View key={s} style={[st.seg, i <= step && st.segOn]} />)}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 140 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step === 0 && showRepeat && last ? (
          <>
            <RepeatCard ride={last} busy={d.busy === 'post'} onRepeat={repeat} onEdit={() => editFrom(last)} onRegular={() => push({ name: 'regular', base: { origin: String(last.origin), destination: String(last.destination), time: timeOfRide(last), vehicle: last.vehicleType === 'Car' ? 'Car' : 'Bike', seats: offeredSeats(last), fuel: Math.round(Number(last.estimatedFuelCost) || 0) } })} />
            <OrDivider text="or post a new ride" />
          </>
        ) : null}
        <Text style={st.stepTitle}>{STEPS[step]}</Text>
        {step === 0 ? <StepRoute dr={dr} set={set} errors={shown} />
          : step === 1 ? <StepTime dr={dr} set={set} errors={shown} />
            : step === 2 ? <StepVehicle dr={dr} set={set} />
              : step === 3 ? <StepPrice dr={dr} set={set} suggest={suggest} errors={shown} />
                : step === 4 ? <StepPrefs dr={dr} set={set} />
                  : review}
      </ScrollView>
      <View style={[st.bar, { paddingBottom: Math.max(12, insets.bottom + 8) }]}>
        <View style={st.barRow}>
        {step > 0 ? <OutlineButton label="Back" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
        {step < STEPS.length - 1
          ? <PrimaryButton label="Continue" icon={IArrowRight} onPress={next} style={{ flex: 2 }} />
          : <PrimaryButton label={dr.role === 'rider' ? 'Post ride' : 'Post request'} onPress={post} busy={d.busy === 'post'} style={{ flex: 2 }} />}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = themedSheet(() => ({
  progress: { flexDirection: 'row', gap: 4, paddingHorizontal: GUTTER, paddingBottom: 6, backgroundColor: CR.page },
  seg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: CR.line },
  segOn: { backgroundColor: CR.primary },
  stepTitle: { fontSize: 21, fontWeight: W.title, color: CR.ink, marginTop: 12, letterSpacing: -0.3 },
  val: { fontSize: 14.5, color: CR.ink, lineHeight: 20 },
  reviewRow: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: CR.card, borderRadius: R.lg, padding: 14, marginTop: 12, ...shadow(1) },
  reviewLabel: { fontSize: 12.5, color: CR.muted },
  edit: { minHeight: 32, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  editText: { fontSize: 13.5, color: CR.primary, fontWeight: W.label },
  barRow: { flexDirection: 'row', gap: 10 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CR.card, paddingHorizontal: GUTTER, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: CR.line },
}));
