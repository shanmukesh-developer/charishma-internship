// Publish Trip: auto -> route -> pickup point -> date / time -> seat fare + full-auto fare (route bounds
// shown) -> seats (<= approved) -> seat selection / full-auto on-off -> minimum passengers -> stops.
// Saved as a DRAFT first (POST /trips or PATCH /trips/:id), then POST /trips/:id/publish. Client checks
// mirror the server (lib/tripRules.ts validatePublish); the server's answer always wins. A failed publish
// keeps the draft so nothing typed is lost.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { color, font, radius, space } from '../theme';
import { Button, Card, Chip, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import { Banner, KeyValue, Screen, SectionTitle } from '../ui/Screen';
import { Stepper, SwitchRow } from '../ui/Stepper';
import { useToast } from '../ui/Toast';
import { useSession } from '../state/SessionProvider';
import { useLoad } from '../state/useLoad';
import { driverApi } from '../api/driverApi';
import { ApiError, errorMessage, serverNow } from '../lib/http';
import { istHhmm, istToMs, istYmd, nextIstDays, periodAt, validatePublish, type FormErrors } from '../lib/tripRules';
import { dayIst, rupees, timeIst } from '../lib/format';
import { LIMITS } from '../config';
import type { DriverSettings, RouteFull, Trip, TripInput, Vehicle } from '../types';
import type { ScreenProps } from '../nav';

const roundUp5 = (ms: number) => Math.ceil(ms / (5 * 60000)) * 5 * 60000;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fmt12 = (m: number) => { const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export default function PublishScreen({ navigation, route: nav }: ScreenProps<'Publish'>) {
  const draftId = nav.params?.draftId;
  const { me, refreshMe } = useSession();
  const q = useLoad(async () => {
    const [routes, drafts, settings] = await Promise.all([
      driverApi.routes(), driverApi.trips('draft'),
      driverApi.settings().then((r) => r.settings).catch(() => null), // older server: the LIMITS defaults
    ]);
    return { routes: routes.routes, drafts: drafts.trips, settings };
  }, [draftId]);
  const vehicles = (me?.vehicles || []).filter((v) => v.status === 'APPROVED' && v.approvedCapacity);
  const draft = draftId ? q.data?.drafts.find((t) => t.id === draftId) || null : null;

  if (q.loading || !me) return <Screen title="New auto trip" onBack={() => navigation.goBack()}><SkeletonCard lines={4} /><SkeletonCard /></Screen>;
  if (q.error && !q.data) return <Screen title="New auto trip" onBack={() => navigation.goBack()}><ErrorStrip text={q.error} onRetry={q.refresh} busy={q.refreshing} /></Screen>;
  if (me.driver.status !== 'VERIFIED') return <Screen title="New auto trip" onBack={() => navigation.goBack()}><EmptyState icon="shield-checkmark" title="Verification needed" body="ZenWe must verify your account before you can publish trips." /></Screen>;
  if (!vehicles.length) {
    return (
      <Screen title="New auto trip" onBack={() => navigation.goBack()}>
        <EmptyState icon="car" title="No approved auto" body="ZenWe has to approve your auto (and its passenger capacity) before you can publish a trip." />
        <Button label="Your autos" icon="car" variant="secondary" onPress={() => navigation.navigate('Vehicles')} />
      </Screen>
    );
  }
  if (!q.data!.routes.length) return <Screen title="New auto trip" onBack={() => navigation.goBack()}><EmptyState icon="map" title="No routes yet" body="ZenWe has not set up any auto routes yet. Please check again later." action={{ label: 'Refresh', onPress: q.refresh, loading: q.refreshing }} /></Screen>;
  return (
    <PublishForm
      key={draft?.id || 'new'}
      routes={q.data!.routes}
      vehicles={vehicles}
      drafts={q.data!.drafts}
      settings={q.data!.settings}
      draft={draft}
      isOnline={!!me.driver.isOnline}
      featureEnabled={me.featureEnabled}
      onBack={() => navigation.goBack()}
      onOpenDraft={(id) => navigation.setParams({ draftId: id })}
      onDraftsChanged={q.reload}
      onPublished={(t) => { refreshMe(); navigation.replace('TripDetail', { tripId: t.id }); }}
      refreshMe={refreshMe}
    />
  );
}

function PublishForm({ routes, vehicles, drafts, settings, draft, isOnline, featureEnabled, onBack, onOpenDraft, onDraftsChanged, onPublished, refreshMe }: {
  routes: RouteFull[]; vehicles: Vehicle[]; drafts: Trip[]; settings: DriverSettings | null; draft: Trip | null; isOnline: boolean; featureEnabled: boolean;
  onBack: () => void; onOpenDraft: (id: string) => void; onDraftsChanged: () => void; onPublished: (t: Trip) => void; refreshMe: () => Promise<unknown>;
}) {
  const toast = useToast();
  const now = serverNow();
  const start = draft?.departureAt ? new Date(draft.departureAt).getTime() : roundUp5(now + 15 * 60000);
  const [vehicleId, setVehicleId] = useState(draft?.vehicleId || (vehicles.length === 1 ? vehicles[0].id : null));
  const [routeId, setRouteId] = useState<string | null>(draft?.routeId || (routes.length === 1 ? routes[0].id : null));
  const [pickupId, setPickupId] = useState<string | null>(draft?.pickupPointId || null);
  const [ymd, setYmd] = useState(istYmd(start));
  const [minutes, setMinutes] = useState(toMin(istHhmm(start)));
  const vehicle = vehicles.find((v) => v.id === vehicleId) || null;
  const route = routes.find((r) => r.id === routeId) || null;
  // Approved capacity, never above the platform max the admin set (the server checks both again).
  const maxCap = Math.max(1, Math.min(vehicle?.approvedCapacity || 1, settings?.platformMaxCapacity || LIMITS.ABSOLUTE_MAX_CAPACITY));
  const maxAdvanceDays = settings?.maxAdvanceDays ?? LIMITS.MAX_ADVANCE_DAYS;
  const [capacity, setCapacity] = useState(Math.min(draft?.capacity || maxCap, maxCap));
  const [seatFare, setSeatFare] = useState(draft?.seatFare || route?.seatFareMin || 30);
  const [privateOn, setPrivateOn] = useState(!!draft?.privateBookingEnabled);
  const [fullFare, setFullFare] = useState<number>(draft?.fullAutoFare || route?.fullFareMin || Math.max(50, (draft?.seatFare || 30) * maxCap));
  const [extraAmount, setExtraAmount] = useState<number>(draft?.extraCharges?.amount || 0);
  const [extraNote, setExtraNote] = useState<string>(draft?.extraCharges?.note || '');
  const [seatSel, setSeatSel] = useState(draft ? draft.seatSelectionEnabled : true);
  const [minSeats, setMinSeats] = useState(draft?.minSeatsToDepart || Math.min(maxCap, route?.minSeatsToDepartDefault || maxCap));
  const [stops, setStops] = useState<string[]>(draft?.stops || []);
  const [savedDraft, setSavedDraft] = useState<Trip | null>(draft);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  // Keep values inside the chosen auto / route limits.
  useEffect(() => { setCapacity((c) => Math.min(Math.max(1, c), maxCap)); }, [maxCap]);
  useEffect(() => { setMinSeats((m) => Math.min(Math.max(1, m), capacity)); }, [capacity]);
  useEffect(() => {
    if (!route) return;
    if (!route.pickupPoints.some((p) => p.id === pickupId)) setPickupId(route.pickupPoints.length === 1 ? route.pickupPoints[0].id : null);
    setStops((s) => s.filter((x) => route.permittedStops.includes(x)));
    if (!draft) {
      if (route.seatFareMin != null) setSeatFare((f) => Math.max(f, route.seatFareMin!));
      if (route.seatFareMax != null) setSeatFare((f) => Math.min(f, route.seatFareMax!));
      if (route.fullFareMin != null) setFullFare((f) => Math.max(f, route.fullFareMin!));
      if (route.fullFareMax != null) setFullFare((f) => Math.min(f, route.fullFareMax!));
      if (route.minSeatsToDepartDefault) setMinSeats(Math.min(capacity, route.minSeatsToDepartDefault));
    }
  }, [routeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const departureMs = istToMs(ymd, toHhmm(minutes));
  const days = useMemo(() => nextIstDays(now, maxAdvanceDays + 1), []); // eslint-disable-line react-hooks/exhaustive-deps
  const extraMax = Math.min(LIMITS.MAX_EXTRA_CHARGES, fullFare);
  useEffect(() => { setExtraAmount((a) => Math.min(Math.max(0, a), extraMax)); }, [extraMax]);
  const extra = privateOn && extraAmount > 0 ? { amount: extraAmount, note: extraNote.trim() } : null;
  const period = route ? periodAt(route.operatingPeriods, departureMs) : null;

  const input = (): TripInput => ({
    vehicleId: vehicleId!, routeId: routeId!, pickupPointId: pickupId!, departureAt: new Date(departureMs).toISOString(),
    capacity, seatFare, fullAutoFare: privateOn ? fullFare : null, privateBookingEnabled: privateOn, seatSelectionEnabled: seatSel,
    minSeatsToDepart: minSeats, stops, extraCharges: extra,
  });

  const doPublish = async (t: Trip) => {
    try {
      const r = await driverApi.publish(t.id);
      toast.show(`Published. Your queue number is ${r.trip.queueNumber ?? '—'}.`, 'success');
      onPublished(r.trip);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'DRIVER_OFFLINE') {
        Alert.alert('You are offline', 'Go online now and publish this trip?', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Go online and publish', onPress: async () => {
            setBusy(true);
            try { await driverApi.setOnline(true); refreshMe(); await doPublish(t); } catch (err) { setServerErr(errorMessage(err)); } finally { setBusy(false); }
          } },
        ]);
      }
      setServerErr(`${errorMessage(e)} Your draft is saved.`);
      if (e instanceof ApiError && e.data?.field) setErrors({ [fieldKey(String(e.data.field))]: e.message });
      onDraftsChanged();
    }
  };

  const submit = async () => {
    setServerErr(null);
    const e = validatePublish({ vehicle, route, pickupPointId: pickupId, departureMs, capacity, seatFare, privateBookingEnabled: privateOn, fullAutoFare: privateOn ? fullFare : null, minSeatsToDepart: minSeats, stops }, serverNow());
    if (extra && extra.note.length < 3) e.fullAutoFare = 'Say what the extra charges are for (e.g. luggage, night charge).';
    setErrors(e);
    if (Object.keys(e).length) { toast.show('Please fix the marked fields.', 'error'); return; }
    setBusy(true);
    try {
      const saved = savedDraft ? (await driverApi.updateDraft(savedDraft.id, input())).trip : (await driverApi.createDraft(input())).trip;
      setSavedDraft(saved);
      await doPublish(saved);
    } catch (err) {
      setServerErr(errorMessage(err));
      if (err instanceof ApiError && err.data?.field) setErrors({ [fieldKey(String(err.data.field))]: err.message });
    } finally {
      setBusy(false);
    }
  };

  const confirmPublish = () => {
    if (!route || !vehicle) { submit(); return; }
    Alert.alert('Publish this trip?', `${route.origin} → ${route.destination}\n${dayIst(new Date(departureMs).toISOString())}, ${fmt12(minutes)}\n${capacity} seats × ${rupees(seatFare)}${privateOn ? `\nFull auto ${rupees(fullFare)}` : ''}\n\nPassengers can book as soon as it is published.`, [
      { text: 'Check again', style: 'cancel' },
      { text: 'Publish', onPress: submit },
    ]);
  };

  const deleteDraft = (t: Trip) => {
    Alert.alert('Delete this draft?', 'It was never shown to passengers.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await driverApi.deleteDraft(t.id); toast.show('Draft deleted.', 'success'); if (savedDraft?.id === t.id) setSavedDraft(null); onDraftsChanged(); } catch (e) { toast.show(errorMessage(e), 'error'); }
      } },
    ]);
  };

  const otherDrafts = drafts.filter((d) => d.id !== savedDraft?.id);
  return (
    <Screen title={savedDraft ? 'Draft trip' : 'New auto trip'} onBack={onBack} stationary
      footer={<Button label={savedDraft ? 'Save and publish' : 'Publish trip'} icon="megaphone" variant="accept" size="huge" onPress={confirmPublish} loading={busy} disabled={!featureEnabled} />}>
      {!featureEnabled ? <Banner tone="warn" text="Auto-Ride is switched off by ZenWe right now. You can come back and publish when it opens." /> : null}
      {!isOnline ? <Banner tone="info" text="You are offline. You will be asked to go online when you publish." /> : null}
      {serverErr ? <Banner tone="error" text={serverErr} /> : null}
      {otherDrafts.length ? (
        <Card style={{ gap: space.xs }}>
          <Text style={[font.h3, { color: color.text }]}>Your drafts</Text>
          {otherDrafts.map((d) => (
            <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Text style={[font.body, { color: color.textSecondary, flex: 1 }]} numberOfLines={2}>{d.route?.name || d.destination} · {dayIst(d.departureAt)} {timeIst(d.departureAt)}</Text>
              <Button label="Open" size="secondary" variant="secondary" onPress={() => onOpenDraft(d.id)} style={{ minHeight: 44 }} />
              <Button label="Delete" size="secondary" variant="rejectOutline" onPress={() => deleteDraft(d)} style={{ minHeight: 44 }} />
            </View>
          ))}
        </Card>
      ) : null}

      {vehicles.length > 1 ? (
        <>
          <SectionTitle text="1. Auto" />
          <View style={{ gap: space.xs }}>
            {vehicles.map((v) => <Chip key={v.id} label={v.registration || v.registrationNumber} sub={`${v.approvedCapacity} seats approved`} selected={vehicleId === v.id} onPress={() => setVehicleId(v.id)} />)}
          </View>
          {errors.vehicle ? <ErrText t={errors.vehicle} /> : null}
        </>
      ) : vehicle ? <KeyValue k="Auto" v={`${vehicle.registration || vehicle.registrationNumber} · ${vehicle.approvedCapacity} seats approved`} strong /> : null}

      <SectionTitle text="2. Route" />
      <View style={{ gap: space.xs }}>
        {routes.map((r) => (
          <Chip key={r.id} label={`${r.origin} → ${r.destination}`} sub={r.name} selected={routeId === r.id} onPress={() => setRouteId(r.id)} />
        ))}
      </View>
      {errors.route ? <ErrText t={errors.route} /> : null}

      {route ? (
        <>
          <SectionTitle text="3. Pickup point" />
          {route.pickupPoints.length ? (
            <View style={{ gap: space.xs }}>
              {route.pickupPoints.map((p) => <Chip key={p.id} label={p.name} sub={p.landmark || undefined} selected={pickupId === p.id} onPress={() => setPickupId(p.id)} />)}
            </View>
          ) : <Banner tone="warn" text="This route has no pickup points yet. Pick another route." />}
          {errors.pickup ? <ErrText t={errors.pickup} /> : null}

          <SectionTitle text="4. Date and time" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {days.map((d, i) => (
              <Chip key={d} label={i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayIst(`${d}T06:30:00.000Z`)} selected={ymd === d} onPress={() => setYmd(d)} style={{ minWidth: 100, flexGrow: 1 }} />
            ))}
          </View>
          <Stepper label="Departure time" value={minutes} min={0} max={23 * 60 + 55} step={5} onChange={setMinutes} format={fmt12}
            error={errors.departure}
            hint={route.operatingPeriods.length ? `Route hours: ${route.operatingPeriods.map((p) => `${p.label || p.key} ${p.start}-${p.end}`).join(', ')}${period ? ` · ${period.label || period.key}` : ''}` : 'This route runs all day.'} />

          <SectionTitle text="5. Fares" />
          <Stepper label="Fare per seat" value={seatFare} min={Math.max(1, route.seatFareMin ?? 1)} max={Math.min(LIMITS.MAX_FARE, route.seatFareMax ?? LIMITS.MAX_FARE)} step={5}
            onChange={setSeatFare} format={rupees} error={errors.seatFare}
            hint={`Allowed on this route: ${rupees(route.seatFareMin ?? 1)} to ${rupees(route.seatFareMax ?? LIMITS.MAX_FARE)}`} />
          <SwitchRow label="Take full-auto bookings" sub="A group books the whole auto at a separate fare. You accept or decline each request." value={privateOn} onChange={setPrivateOn} />
          {privateOn ? (
            <Stepper label="Full-auto fare" value={fullFare} min={Math.max(1, route.fullFareMin ?? 1)} max={Math.min(LIMITS.MAX_FULL_FARE, route.fullFareMax ?? LIMITS.MAX_FULL_FARE)} step={10}
              onChange={setFullFare} format={rupees} error={errors.fullAutoFare}
              hint={`Allowed: ${rupees(route.fullFareMin ?? 1)} to ${rupees(route.fullFareMax ?? LIMITS.MAX_FULL_FARE)}`} />
          ) : null}
          {privateOn ? (
            <>
              <Stepper label="Extra charges (optional)" value={extraAmount} min={0} max={extraMax} step={10} onChange={setExtraAmount} format={rupees}
                hint={`Added to the full-auto fare and shown to the passenger before they request. Up to ${rupees(extraMax)}.`} />
              {extraAmount > 0 ? (
                <TextInput
                  value={extraNote}
                  onChangeText={(v) => setExtraNote(v.slice(0, 120))}
                  placeholder="What is it for? e.g. Luggage, night charge"
                  placeholderTextColor={color.textMuted}
                  style={[font.body, styles.input]}
                  accessibilityLabel="What the extra charges are for"
                />
              ) : null}
              {extraAmount > 0 ? <KeyValue k="Full-auto total" v={rupees(fullFare + extraAmount)} /> : null}
            </>
          ) : null}

          <SectionTitle text="6. Seats" />
          <Stepper label="Seats for passengers" value={capacity} min={1} max={maxCap} onChange={setCapacity} error={errors.capacity} hint={`ZenWe approved ${maxCap} for this auto.`} />
          <SwitchRow label="Passengers pick their seats" sub="Off = seats are given automatically." value={seatSel} onChange={setSeatSel} />
          <Stepper label="Leave early with at least" value={minSeats} min={1} max={capacity} onChange={setMinSeats} format={(v) => `${v} passenger${v === 1 ? '' : 's'}`}
            error={errors.minSeatsToDepart} hint="When this many seats are confirmed you can confirm departure before the auto is full." />

          {route.permittedStops.length ? (
            <>
              <SectionTitle text="7. Stops on the way (optional)" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                {route.permittedStops.map((s) => (
                  <Chip key={s} label={s} selected={stops.includes(s)} onPress={() => setStops((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))} style={{ flexGrow: 1 }} />
                ))}
              </View>
              {errors.stops ? <ErrText t={errors.stops} /> : null}
            </>
          ) : null}

          <Card style={{ gap: 2 }}>
            <Text style={[font.h3, { color: color.text }]}>Summary</Text>
            <KeyValue k="Departure" v={`${dayIst(new Date(departureMs).toISOString())}, ${fmt12(minutes)}`} />
            <KeyValue k="If every seat fills" v={rupees(seatFare * capacity)} />
            <Text style={[font.small, { color: color.textMuted }]}>ZenWe gives your queue number when you publish. Passengers pay you in cash at boarding.</Text>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 2, borderColor: color.border, paddingHorizontal: space.md, color: color.text, backgroundColor: color.surface },
});

const ErrText = ({ t }: { t: string }) => <Text style={[font.small, { color: color.alertDark, fontWeight: '700' }]}>{t}</Text>;

const fieldKey = (f: string): keyof FormErrors => (({
  vehicleId: 'vehicle', routeId: 'route', pickupPointId: 'pickup', departureAt: 'departure', capacity: 'capacity',
  seatFare: 'seatFare', fullAutoFare: 'fullAutoFare', minSeatsToDepart: 'minSeatsToDepart', stops: 'stops',
  'extraCharges.amount': 'fullAutoFare', 'extraCharges.note': 'fullAutoFare',
} as Record<string, keyof FormErrors>)[f] || 'departure');
