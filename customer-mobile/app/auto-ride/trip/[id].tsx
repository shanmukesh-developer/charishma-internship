// Zenvy Auto-Ride: one shared auto. Details + live seat map -> choose seats -> hold (countdown) -> review the
// server's fare breakdown -> confirm (cash to driver; wallet only when the server offers it) -> booking code + PIN.
// Holds are released when the passenger backs out or leaves the screen. Idempotency keys make retries safe.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, Linking, BackHandler, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import SafeImage from '../../../components/SafeImage';
import {
  autoRideApi, AutoRideError, newIdempotencyKey, errorCopy, inr, fmtDeparture, fmtClock, fromNow, mmss, queueLabel,
  PAYMENT_LABEL, type Trip, type SeatMap as SeatMapData, type Booking, type PaymentMethod, type SeatState,
} from '../../../modules/autoRide/autoRideApi';
import {
  AHeader, usePalette, Card, Btn, Badge, StateView, Notice, Row, Stepper, StatusChip, VerifiedBadge, useAutoRideLive, useNow,
  refreshAutoRideStatus, AUTO_HOME,
} from '../../../modules/autoRide/ui';
import SeatMap from '../../../modules/autoRide/SeatMap';

/** Seats-per-booking limit: GET /status settings.maxSeatsPerBooking, or learned from an INVALID_INPUT { max } answer. */
let learnedMaxPerBooking: number | null = null;

type Step = 'select' | 'review' | 'done';

export default function AutoTripScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const now = useNow(1000);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [map, setMap] = useState<SeatMapData | null>(null);
  const [loadError, setLoadError] = useState<AutoRideError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [skew, setSkew] = useState(0); // server clock - device clock
  const [methods, setMethods] = useState<PaymentMethod[]>(['CASH']);
  const [payment, setPayment] = useState<PaymentMethod>('CASH');

  const [step, setStep] = useState<Step>('select');
  const [count, setCount] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [hold, setHold] = useState<Booking | null>(null);
  const [done, setDone] = useState<Booking | null>(null);
  const [busy, setBusy] = useState<null | 'hold' | 'confirm' | 'release'>(null);
  const [retry, setRetry] = useState<null | { kind: 'hold' | 'confirm'; message: string }>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [maxPerBooking, setMaxPerBooking] = useState<number | null>(learnedMaxPerBooking);

  const holdKey = useRef<string | null>(null);
  const confirmKey = useRef<string | null>(null);
  const holdRef = useRef<Booking | null>(null);
  holdRef.current = hold;
  const doneRef = useRef(false);
  doneRef.current = !!done;

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([autoRideApi.trip(id), autoRideApi.seats(id)]);
      setTrip(t.trip);
      setMap(m);
      setLoadError(null);
      if (t.serverTime) setSkew(new Date(t.serverTime).getTime() - Date.now());
      // Resume my own open hold on this auto (the server keeps one hold per passenger per auto).
      if (t.trip.myBookingId && t.trip.myBookingStatus === 'HELD' && !holdRef.current && !doneRef.current) {
        const b = await autoRideApi.booking(t.trip.myBookingId).catch(() => null);
        if (b && b.booking.status === 'HELD') {
          setHold(b.booking);
          setSelected(b.booking.seatNumbers);
          setCount(b.booking.seatCount);
          setStep('review');
        }
      }
      return m;
    } catch (e: any) {
      setLoadError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load this auto.'));
      return null;
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    refreshAutoRideStatus().then((s) => {
      if (s.settings && Number(s.settings.maxSeatsPerBooking) > 0) setMaxPerBooking(Number(s.settings.maxSeatsPerBooking));
      const list = s.paymentMethods.length ? s.paymentMethods : (['CASH'] as PaymentMethod[]);
      setMethods(list);
      if (!list.includes('CASH')) setPayment(list[0]);
    }).catch(() => { /* cash stays the default */ });
  }, []);
  useAutoRideLive((e) => { if (!e.id || e.id === id || e.kind === 'reconnect' || e.kind === 'booking' || e.kind === 'trip') load(); });

  // Seats someone else just took drop out of my (not yet held) selection.
  useEffect(() => {
    if (!map || hold) return;
    const st: Record<number, SeatState> = {};
    map.seats.forEach((x) => { st[x.seatNo] = x.state; });
    setSelected((cur) => {
      const next = cur.filter((n) => st[n] === 'AVAILABLE');
      return next.length === cur.length ? cur : next;
    });
  }, [map, hold]);

  // Release a hold that is left behind (screen closed, swipe back, app navigation).
  useEffect(() => () => {
    const h = holdRef.current;
    if (h && h.status === 'HELD' && !doneRef.current) autoRideApi.release(h.id).catch(() => { /* the server expires it anyway */ });
  }, []);

  const releaseHold = useCallback(async (silent = false) => {
    const h = holdRef.current;
    if (!h) return;
    setBusy('release');
    try { await autoRideApi.release(h.id); } catch (e: any) { if (!silent && e?.code !== 'BOOKING_NOT_HELD') Alert.alert('Could not release', `${e?.message || 'Please try again.'} The hold ends by itself in a few minutes.`); }
    setBusy(null);
    setHold(null);
    holdKey.current = null;
    confirmKey.current = null;
    setRetry(null);
    setStep('select');
    load();
  }, [load]);

  const askRelease = useCallback(() => {
    Alert.alert('Release your seats?', 'Your held seats go back to other passengers.', [
      { text: 'Keep holding', style: 'cancel' },
      { text: 'Release', style: 'destructive', onPress: () => releaseHold() },
    ]);
  }, [releaseHold]);

  // Android back: review -> release + back to seat choice; done -> to the booking.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'review' && hold) { askRelease(); return true; }
      if (step === 'done' && done) { router.replace(`/auto-ride/booking/${done.id}` as any); return true; }
      return false;
    });
    return () => sub.remove();
  }, [step, hold, done, askRelease, router]);

  const headerBack = () => {
    if (step === 'review' && hold) return askRelease();
    if (step === 'done' && done) return router.replace(`/auto-ride/booking/${done.id}` as any);
    if (router.canGoBack()) router.back(); else router.replace(AUTO_HOME as any);
  };

  if (!trip || !map) {
    const off = loadError?.code === 'FEATURE_OFF';
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <AHeader title="Shared auto" />
        {loadError ? (
          <StateView kind={loadError.status === 404 || off ? 'empty' : 'error'} icon={off ? '🛺' : undefined}
            title={off ? 'Zenvy Auto is not open yet' : loadError.status === 404 ? 'Auto not found' : loadError.isNetwork ? 'You seem to be offline' : 'Could not load'}
            message={loadError.message} actionLabel={loadError.status === 404 || off ? 'Back to autos' : 'Retry'}
            onAction={loadError.status === 404 || off ? () => router.replace(AUTO_HOME as any) : load} />
        ) : <StateView kind="loading" message="Loading the auto…" />}
      </View>
    );
  }

  const states: Record<number, SeatState> = {};
  map.seats.forEach((x) => { states[x.seatNo] = x.state; });
  const free = map.seats.filter((x) => x.state === 'AVAILABLE').length;
  const maxAllowed = Math.max(0, Math.min(free, trip.capacity, maxPerBooking || learnedMaxPerBooking || trip.capacity));
  const pickMode = map.seatSelectionEnabled;
  const seatCount = pickMode ? selected.length : Math.min(count, Math.max(1, maxAllowed));
  const canBook = trip.sharedBookingAllowed && maxAllowed > 0 && !trip.myBookingId;
  const mineConfirmed = trip.myBookingId && trip.myBookingStatus && trip.myBookingStatus !== 'HELD';

  const toggle = (n: number) => {
    if (step !== 'select') return;
    setSelected((cur) => {
      if (cur.includes(n)) return cur.filter((x) => x !== n);
      if (cur.length >= maxAllowed) {
        if (maxAllowed === 1) return [n];
        Alert.alert('Seat limit', `You can book up to ${maxAllowed} seat${maxAllowed === 1 ? '' : 's'} on this auto.`);
        return cur;
      }
      return [...cur, n].sort((a, b) => a - b);
    });
  };

  const handleError = async (e: any, kind: 'hold' | 'confirm') => {
    const err: AutoRideError = e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Please try again.');
    const { title, message } = errorCopy(err);
    if (err.isNetwork) {
      // Unknown outcome: keep the same key so the retry returns the same hold / confirmation.
      setRetry({ kind, message: err.message });
      return;
    }
    setRetry(null);
    switch (err.code) {
      case 'SEAT_TAKEN': {
        const clash: number[] = Array.isArray(err.data?.seats) ? err.data.seats.map(Number) : [];
        setSelected((cur) => (clash.length ? cur.filter((n) => !clash.includes(n)) : cur));
        await load();
        Alert.alert(title, clash.length ? `${message} Your other picks are kept.` : message);
        return;
      }
      case 'INVALID_INPUT':
        if (err.data?.field === 'seatCount' && Number(err.data?.max) > 0) {
          learnedMaxPerBooking = Number(err.data.max);
          setMaxPerBooking(learnedMaxPerBooking);
          setCount((c) => Math.min(c, learnedMaxPerBooking!));
          setSelected((cur) => cur.slice(0, learnedMaxPerBooking!));
        }
        Alert.alert(title, message);
        return;
      case 'HOLD_EXPIRED':
        setHold(null);
        holdKey.current = null;
        confirmKey.current = null;
        setStep('select');
        await load();
        Alert.alert(title, message);
        return;
      case 'ALREADY_BOOKED':
        if (err.data?.bookingId) { router.replace(`/auto-ride/booking/${err.data.bookingId}` as any); return; }
        break;
      case 'IDEMPOTENCY_KEY_REUSED':
        holdKey.current = null;
        Alert.alert('Please try again', 'Tap Hold seats once more.');
        return;
      case 'PHONE_REQUIRED':
        Alert.alert(title, message, [{ text: 'Later', style: 'cancel' }, { text: 'Open profile', onPress: () => router.push('/(tabs)/profile' as any) }]);
        return;
      case 'PAYMENT_METHOD_OFF':
        setPayment('CASH');
        refreshAutoRideStatus().then((s) => setMethods(s.paymentMethods.length ? s.paymentMethods : ['CASH'])).catch(() => {});
        Alert.alert(title, message);
        return;
      case 'BOOKING_NOT_HELD': {
        const b = hold ? await autoRideApi.booking(hold.id).catch(() => null) : null;
        if (b && (b.booking.status === 'CONFIRMED' || b.booking.status === 'BOARDED')) { setDone(b.booking); setHold(null); setStep('done'); return; }
        setHold(null); holdKey.current = null; confirmKey.current = null; setStep('select'); await load();
        Alert.alert(title, message);
        return;
      }
      case 'FEATURE_OFF':
        setLoadError(err);
        setTrip(null);
        return;
      case 'TRIP_PRIVATE':
      case 'TRIP_FULL':
      case 'NOT_ENOUGH_SEATS':
      case 'BOOKING_CLOSED':
        if (kind === 'confirm' && holdRef.current) await autoRideApi.release(holdRef.current.id).catch(() => {});
        setHold(null); holdKey.current = null; confirmKey.current = null; setStep('select');
        await load();
        Alert.alert(title, message);
        return;
      default:
        break;
    }
    Alert.alert(title, message);
  };

  const doHold = async (fresh = false) => {
    if (busy) return;
    if (seatCount < 1) { Alert.alert('Pick a seat', pickMode ? 'Tap the seats you want on the map.' : 'Choose how many seats.'); return; }
    if (fresh || !holdKey.current) holdKey.current = newIdempotencyKey();
    setBusy('hold');
    setRetry(null);
    try {
      const r = await autoRideApi.hold(id, pickMode ? { seatCount, seatNumbers: selected } : { seatCount }, holdKey.current);
      const b = r.booking;
      if (b.status === 'CONFIRMED' || b.status === 'BOARDED') { router.replace(`/auto-ride/booking/${b.id}` as any); return; }
      if (b.status !== 'HELD') {
        // The key belonged to an earlier hold that has ended: start a fresh one once.
        holdKey.current = null;
        if (!fresh) { setBusy(null); return doHold(true); }
        throw new AutoRideError('Your earlier hold ended. Please try again.', 409, 'HOLD_EXPIRED');
      }
      if (r.duplicate && pickMode && b.seatNumbers.join(',') !== selected.join(',')) {
        setNotice(`You already had seat${b.seatCount === 1 ? '' : 's'} ${b.seatNumbers.join(', ')} held on this auto, so we kept that hold.`);
      } else setNotice(null);
      setHold(b);
      setSelected(b.seatNumbers);
      setCount(b.seatCount);
      confirmKey.current = null;
      setStep('review');
      autoRideApi.seats(id).then(setMap).catch(() => {});
    } catch (e: any) {
      await handleError(e, 'hold');
    } finally {
      setBusy(null);
    }
  };

  const doConfirm = async () => {
    if (busy || !hold) return;
    if (!confirmKey.current) confirmKey.current = newIdempotencyKey();
    setBusy('confirm');
    setRetry(null);
    try {
      const r = await autoRideApi.confirm(hold.id, payment, confirmKey.current);
      setDone(r.booking);
      setHold(null);
      holdKey.current = null;
      setStep('done');
      load();
    } catch (e: any) {
      await handleError(e, 'confirm');
    } finally {
      setBusy(null);
    }
  };

  const holdLeft = hold?.holdExpiresAt ? new Date(hold.holdExpiresAt).getTime() - (now + skew) : 0;
  const holdExpired = !!hold && holdLeft <= 0;

  const openMaps = () => trip.pickup?.mapsUrl && Linking.openURL(trip.pickup.mapsUrl).catch(() => Alert.alert('Could not open maps'));

  // ── Success ────────────────────────────────────────────────────────────────
  if (step === 'done' && done) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <AHeader title="Booking confirmed" subtitle={`${queueLabel(trip.queueNumber)} · ${fmtDeparture(trip.departureAt)}`} onBack={headerBack} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <Card style={{ alignItems: 'center', borderColor: p.success, backgroundColor: p.successSoft }}>
            <Text style={{ fontSize: 44 }}>✅</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: p.text, marginTop: 4 }}>Seat{done.seatCount === 1 ? '' : 's'} booked</Text>
            <Text style={{ fontSize: 12, color: p.sub, marginTop: 4, textAlign: 'center' }}>The auto leaves when the driver confirms departure. We will notify you.</Text>
          </Card>
          <Card style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '900', color: p.sub, letterSpacing: 1 }}>BOOKING CODE</Text>
            <Text selectable style={{ fontSize: 28, fontWeight: '900', color: p.text, letterSpacing: 4, marginTop: 4 }}>{done.bookingCode}</Text>
            {done.boardingPin ? (
              <>
                <Text style={{ fontSize: 11, fontWeight: '900', color: p.accent, letterSpacing: 1, marginTop: 14 }}>BOARDING PIN</Text>
                <Text style={{ fontSize: 40, fontWeight: '900', color: p.text, letterSpacing: 12, marginTop: 2 }} accessibilityLabel={`Boarding PIN ${done.boardingPin.split('').join(' ')}`}>{done.boardingPin}</Text>
                <Text style={{ fontSize: 11.5, color: p.sub, textAlign: 'center' }}>Show the code and PIN to the driver when you board. Never share the PIN before that.</Text>
              </>
            ) : null}
          </Card>
          <Card>
            <Row label="Seats" value={`${done.seatCount}${done.seatNumbers.length ? ` (no. ${done.seatNumbers.join(', ')})` : ''}`} />
            <Row label="Total" value={inr(done.amount)} strong />
            <Row label="Payment" value={done.paymentMethod ? PAYMENT_LABEL[done.paymentMethod] : '—'} />
          </Card>
          {done.pickupInstructions ? <Notice tone="info">📍 {done.pickupInstructions}</Notice> : null}
          <Btn label="View my booking" icon="🎫" onPress={() => router.replace(`/auto-ride/booking/${done.id}` as any)} />
          <Btn label="Back to autos" kind="secondary" style={{ marginTop: 10 }} onPress={() => router.replace(AUTO_HOME as any)} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <AHeader title={`${queueLabel(trip.queueNumber)} → ${trip.destination || 'Destination'}`} subtitle="Zenvy Auto · verified driver" onBack={headerBack} right={<Badge label={`${trip.confirmedSeats}/${trip.capacity}`} color="#16A34A" />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <StatusChip trip={trip} now={now + skew} />
          <Text style={{ fontSize: 11.5, color: p.sub }}>{trip.statusLabel}</Text>
        </View>

        {mineConfirmed ? (
          <TouchableOpacity onPress={() => router.push(`/auto-ride/booking/${trip.myBookingId}` as any)} accessibilityRole="button">
            <Notice tone="success">🎫 You have a booking on this auto. <Text style={{ fontWeight: '900', color: p.accent }}>Open it ›</Text></Notice>
          </TouchableOpacity>
        ) : null}
        {trip.mode === 'PRIVATE' && !mineConfirmed ? <Notice tone="warn">🔒 This auto has been booked as a full auto. Pick another auto.</Notice> : null}
        {trip.availability === 'NOT_OPEN' ? <Notice tone="info">🕒 Booking for this auto opens soon. Pull down to refresh.</Notice> : null}

        {/* Route */}
        <Card>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ alignItems: 'center', paddingTop: 4 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: p.success }} />
              <View style={{ width: 2, flex: 1, backgroundColor: p.border, marginVertical: 3 }} />
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: p.danger }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10.5, color: p.muted, fontWeight: '800' }}>PICKUP</Text>
              <Text style={{ fontSize: 15, fontWeight: '900', color: p.text }}>{trip.pickup?.name || trip.route?.origin || 'Pickup point'}</Text>
              {trip.pickup?.landmark ? <Text style={{ fontSize: 11.5, color: p.sub }}>{trip.pickup.landmark}</Text> : null}
              {trip.stops.length ? <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 8 }}>Stops: {trip.stops.join(' · ')}</Text> : null}
              <Text style={{ fontSize: 10.5, color: p.muted, fontWeight: '800', marginTop: 10 }}>DESTINATION</Text>
              <Text style={{ fontSize: 15, fontWeight: '900', color: p.text }}>{trip.destination || trip.route?.destination || '—'}</Text>
              {trip.route ? <Text style={{ fontSize: 11.5, color: p.sub }}>{trip.route.name}{trip.route.distanceKm ? ` · ${trip.route.distanceKm} km` : ''}</Text> : null}
            </View>
          </View>
          {trip.pickup?.mapsUrl ? <Btn label="Open pickup in Maps" icon="🗺️" kind="secondary" small onPress={openMaps} style={{ marginTop: 12 }} /> : null}
        </Card>

        {/* Time, fare, driver */}
        <Card>
          <Row label="Departure" value={fmtDeparture(trip.departureAt)} strong />
          {trip.delayMinutes > 0 && trip.originalDepartureAt ? <Row label="Originally" value={`${fmtClock(trip.originalDepartureAt)} (delayed ${trip.delayMinutes} min)`} /> : null}
          <Row label="Leaves" value={fromNow(trip.departureAt, now + skew) || '—'} />
          <Row label="Fare per seat" value={inr(trip.seatFare)} strong />
          {trip.fullAutoFare ? <Row label="Full auto fare" value={inr(trip.fullAutoFare)} /> : null}
          <Row label="Seats" value={`${trip.confirmedSeats} booked · ${trip.heldSeats} on hold · ${trip.remainingSeats} left of ${trip.capacity}`} />
          {trip.minSeatsToDepart && trip.minSeatsToDepart < trip.capacity ? <Row label="Can leave with" value={`${trip.minSeatsToDepart}+ passengers`} /> : null}
          {trip.queueNumber ? <Text style={{ fontSize: 11, color: p.muted, marginTop: 6 }}>{queueLabel(trip.queueNumber)} at this stand. {trip.queueNote}</Text> : null}
        </Card>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
            {trip.driver?.photo ? <SafeImage source={{ uri: trip.driver.photo }} style={{ width: 48, height: 48 }} contentFit="cover" /> : <Text style={{ fontSize: 22 }}>🧑‍✈️</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14.5, fontWeight: '900', color: p.text }}>{trip.driver?.name || 'Driver'}</Text>
              <VerifiedBadge verified={!!trip.driver?.verified} />
            </View>
            <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }}>
              {trip.driver?.rating ? `★ ${trip.driver.rating.avg.toFixed(1)} (${trip.driver.rating.count} ratings)` : 'No ratings yet'}
            </Text>
            <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }}>
              🔢 {trip.vehicle?.registration || '—'}{trip.vehicle?.registrationMasked ? ' (full number after booking)' : ''}
              {[trip.vehicle?.colour, trip.vehicle?.make, trip.vehicle?.model, trip.vehicle?.fuel].filter(Boolean).length ? ` · ${[trip.vehicle?.colour, trip.vehicle?.make, trip.vehicle?.model, trip.vehicle?.fuel].filter(Boolean).join(' ')}` : ''}
            </Text>
          </View>
        </Card>

        {/* Seat map */}
        <Card>
          <Text style={{ fontSize: 15, fontWeight: '900', color: p.text, marginBottom: 4 }}>{step === 'review' ? 'Your held seats' : pickMode ? 'Pick your seats' : 'Seat layout'}</Text>
          <Text style={{ fontSize: 11.5, color: p.sub, marginBottom: 12 }}>
            {step === 'review' ? 'These seats are held for you until the timer runs out.' : pickMode ? 'Tap free seats to select them. The driver seat cannot be booked.' : 'Seats are assigned automatically on this auto; choose how many you need.'}
          </Text>
          <SeatMap rows={map.layout.rows} states={states} selected={step === 'select' ? selected : []} onToggle={toggle} selectable={pickMode && step === 'select' && canBook} />
        </Card>

        {/* Step: choose seats */}
        {step === 'select' && canBook ? (
          <Card>
            {pickMode ? (
              <Text style={{ fontSize: 14, fontWeight: '900', color: p.text, textAlign: 'center' }}>
                {selected.length ? `${selected.length} seat${selected.length === 1 ? '' : 's'} selected: ${selected.join(', ')}` : 'No seats selected yet'}
              </Text>
            ) : (
              <Stepper value={seatCount} min={1} max={Math.max(1, maxAllowed)} onChange={setCount} label="Seats" />
            )}
            <Text style={{ fontSize: 11.5, color: p.sub, textAlign: 'center', marginTop: 8 }}>
              {seatCount > 0 ? `${seatCount} × ${inr(trip.seatFare)} per seat · the exact total is confirmed on the next step` : `Up to ${maxAllowed} seat${maxAllowed === 1 ? '' : 's'} per booking`}
            </Text>
          </Card>
        ) : null}
        {step === 'select' && !canBook && !trip.myBookingId && trip.mode !== 'PRIVATE' && trip.availability !== 'NOT_OPEN' ? (
          <Notice tone="warn">Seat booking is closed for this auto ({trip.availabilityLabel}).</Notice>
        ) : null}

        {/* Step: review */}
        {step === 'review' && hold ? (
          <Card style={{ borderColor: holdExpired ? p.danger : p.warn }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: '900', color: p.text }}>Review & confirm</Text>
              <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: holdExpired ? p.dangerSoft : p.warnSoft }}
                accessibilityLabel={holdExpired ? 'Hold expired' : `Hold expires in ${mmss(holdLeft)}`} accessibilityLiveRegion="polite">
                <Text style={{ fontWeight: '900', color: holdExpired ? p.danger : p.warn, fontSize: 13 }}>⏳ {holdExpired ? 'Expired' : mmss(holdLeft)}</Text>
              </View>
            </View>
            {notice ? <Notice tone="info">{notice}</Notice> : null}
            <Row label="Route" value={`${trip.pickup?.name || 'Pickup'} → ${trip.destination || '—'}`} />
            <Row label="Pickup" value={trip.pickup?.landmark ? `${trip.pickup.name} (${trip.pickup.landmark})` : trip.pickup?.name || '—'} />
            <Row label="Departure" value={fmtDeparture(trip.departureAt)} />
            <Row label="Passengers / seats" value={`${hold.seatCount}${hold.seatNumbers.length ? ` (no. ${hold.seatNumbers.join(', ')})` : ''}`} />
            <View style={{ height: 1, backgroundColor: p.border, marginVertical: 8 }} />
            <Row label={`${hold.fareBreakdown.seats ?? hold.seatCount} seat${(hold.fareBreakdown.seats ?? hold.seatCount) === 1 ? '' : 's'} × ${inr(hold.fareBreakdown.seatFare ?? hold.seatFare)}`} value={inr(hold.fareBreakdown.total ?? hold.amount)} />
            <Row label="Total to pay" value={inr(hold.amount)} strong />

            <Text style={{ fontSize: 10.5, fontWeight: '900', color: p.sub, letterSpacing: 0.8, marginTop: 12, marginBottom: 6 }}>PAYMENT</Text>
            {methods.map((m) => {
              const on = payment === m;
              return (
                <TouchableOpacity key={m} onPress={() => setPayment(m)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={PAYMENT_LABEL[m]}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: on ? p.accent : p.border, backgroundColor: on ? p.accentSoft : p.card2, marginBottom: 8, minHeight: 48 }}>
                  <Text style={{ fontSize: 18 }}>{m === 'CASH' ? '💵' : '👛'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontWeight: '900', color: p.text }}>{PAYMENT_LABEL[m]}</Text>
                    <Text style={{ fontSize: 11, color: p.sub }}>{m === 'CASH' ? 'Pay the driver when you board' : 'Paid now from your Zenvy Wallet; refunds go back to it'}</Text>
                  </View>
                  <Text style={{ fontSize: 16, color: on ? p.accent : p.muted }}>{on ? '◉' : '○'}</Text>
                </TouchableOpacity>
              );
            })}
            <Text style={{ fontSize: 11, color: p.muted, marginTop: 2 }}>You can cancel before the driver confirms departure. Cash bookings are never charged in the app.</Text>
          </Card>
        ) : null}

        {retry ? (
          <Notice tone="warn">📶 {retry.message} Your request is saved; tap Retry to send it again safely (you will not be booked twice).</Notice>
        ) : null}
      </ScrollView>

      {/* Sticky action bar */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 24, backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.border, gap: 8 }}>
        {step === 'select' ? (
          canBook ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label={retry?.kind === 'hold' ? 'Retry' : `Hold ${seatCount || ''} seat${seatCount === 1 ? '' : 's'}`.replace('  ', ' ')} icon="🛺" style={{ flex: 1 }}
                onPress={() => doHold()} loading={busy === 'hold'} disabled={seatCount < 1} />
              {trip.privateBookingAllowed ? <Btn label="Full auto" kind="ghost" onPress={() => router.push(`/auto-ride/full/${trip.id}` as any)} /> : null}
            </View>
          ) : trip.privateBookingAllowed ? (
            <Btn label={`Book Full Auto · ${inr(trip.fullAutoFare)}`} icon="🔒" onPress={() => router.push(`/auto-ride/full/${trip.id}` as any)} />
          ) : (
            <Btn label="Find another auto" kind="secondary" onPress={() => router.replace(AUTO_HOME as any)} />
          )
        ) : step === 'review' && hold ? (
          holdExpired ? (
            <Btn label="Hold expired · pick seats again" onPress={() => { setHold(null); holdKey.current = null; confirmKey.current = null; setStep('select'); load(); }} />
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="Release" kind="secondary" onPress={askRelease} loading={busy === 'release'} disabled={busy === 'confirm'} />
              <Btn label={retry?.kind === 'confirm' ? 'Retry confirm' : `Confirm · ${inr(hold.amount)}`} icon="✅" style={{ flex: 1 }} onPress={doConfirm} loading={busy === 'confirm'} disabled={busy === 'release'} />
            </View>
          )
        ) : null}
      </View>
    </View>
  );
}
