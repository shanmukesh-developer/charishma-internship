// Zenvy Auto-Ride: one shared auto. Details + live seat map -> choose seats -> hold (countdown) -> review the
// server's fare breakdown -> confirm (cash to driver; wallet only when the server offers it) -> booking code + PIN.
// Holds are released when the passenger backs out or leaves the screen. Idempotency keys make retries safe.
// Front-seat rule: seats beside the driver are for boys only (server-enforced). For a girl they are locked on the map
// (a press says why) and never counted as hers; a 'Prefer not to say' profile is asked "Are you booking for a boy?"
// before a front seat or a quick booking, and the answer goes with this hold only (riderGender).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, Linking, BackHandler, StyleSheet } from 'react-native';
import { PressScale } from '../../../modules/others/motion';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import SafeImage from '../../../components/SafeImage';
import {
  autoRideApi, AutoRideError, newIdempotencyKey, errorCopy, inr, fmtDeparture, fmtClock, fromNow, mmss, queueLabel,
  PAYMENT_LABEL, type Trip, type SeatMap as SeatMapData, type Booking, type PaymentMethod, type SeatState, type RiderGender,
} from '../../../modules/autoRide/autoRideApi';
import {
  AHeader, usePalette, Card, Btn, Badge, StateView, Notice, Row, Stepper, StatusChip, VerifiedBadge, useAutoRideLive, useNow,
  refreshAutoRideStatus, AUTO_HOME, AutoTile,
} from '../../../modules/autoRide/ui';
import SeatMap, { askRiderGender, FRONT_SEAT_NOTE } from '../../../modules/autoRide/SeatMap';

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
  // "Are you booking for a boy?" answer (profile gender unknown only); kept for this booking, never saved.
  const [rider, setRider] = useState<RiderGender | null>(null);

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
            title={off ? 'ZENV Auto is not open yet' : loadError.status === 404 ? 'Auto not found' : loadError.isNetwork ? 'You seem to be offline' : 'Could not load'}
            message={loadError.message} actionLabel={loadError.status === 404 || off ? 'Back to autos' : 'Retry'}
            onAction={loadError.status === 404 || off ? () => router.replace(AUTO_HOME as any) : load} />
        ) : <StateView kind="loading" message="Loading the auto…" />}
      </View>
    );
  }

  const states: Record<number, SeatState> = {};
  map.seats.forEach((x) => { states[x.seatNo] = x.state; });
  const viewer = map.viewer || 'UNKNOWN';
  const maleOnly = new Set(map.layout.maleOnlySeats || map.seats.filter((x) => x.maleOnly).map((x) => x.seatNo));
  // Riders who are not boys never count the seats beside the driver (an UNKNOWN who said "a girl" neither).
  const notBoy = viewer === 'NOT_MALE' || (viewer === 'UNKNOWN' && !!rider && rider !== 'Male');
  const freeAll = map.seats.filter((x) => x.state === 'AVAILABLE').length;
  const free = notBoy ? map.seats.filter((x) => x.state === 'AVAILABLE' && !maleOnly.has(x.seatNo)).length : freeAll;
  const onlyFrontLeft = notBoy && freeAll > 0 && free === 0;
  const maxAllowed = Math.max(0, Math.min(free, trip.capacity, maxPerBooking || learnedMaxPerBooking || trip.capacity));
  const pickMode = map.seatSelectionEnabled;
  const seatCount = pickMode ? selected.length : Math.min(count, Math.max(1, maxAllowed));
  const canBook = trip.sharedBookingAllowed && maxAllowed > 0 && !trip.myBookingId;
  const mineConfirmed = trip.myBookingId && trip.myBookingStatus && trip.myBookingStatus !== 'HELD';

  const toggle = async (n: number) => {
    if (step !== 'select') return;
    if (!selected.includes(n) && maleOnly.has(n) && viewer !== 'MALE') {
      let answer = rider;
      if (viewer === 'UNKNOWN' && !answer) {
        answer = await askRiderGender();
        if (!answer) return;
        setRider(answer);
      }
      if (viewer === 'NOT_MALE' || answer !== 'Male') {
        Alert.alert(`Seat ${n} is for boys only`, FRONT_SEAT_NOTE);
        return;
      }
    }
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
      case 'FRONT_SEAT_MALE_ONLY':
      case 'NO_SUITABLE_SEAT': {
        // Server front-seat rule: drop the front seats from the pick; a refused confirm already gave the hold back.
        setSelected((cur) => cur.filter((n) => !maleOnly.has(n)));
        if (kind === 'confirm' || err.data?.released) { setHold(null); holdKey.current = null; confirmKey.current = null; setStep('select'); }
        await load();
        Alert.alert(title, message);
        return;
      }
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
    let answer = rider;
    if (viewer === 'UNKNOWN' && !answer && !pickMode) {
      // Quick booking: the server never auto-assigns a front seat to someone it does not know is a boy; ask once.
      answer = await askRiderGender();
      if (!answer) return;
      setRider(answer);
    }
    const riderBody = viewer === 'UNKNOWN' && answer ? { riderGender: answer } : {};
    if (fresh || !holdKey.current) holdKey.current = newIdempotencyKey();
    setBusy('hold');
    setRetry(null);
    try {
      const r = await autoRideApi.hold(id, pickMode ? { seatCount, seatNumbers: selected, ...riderBody } : { seatCount, ...riderBody }, holdKey.current);
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
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ alignItems: 'center', marginTop: 6, marginBottom: 18 }}>
            <View style={[ts.halo, { backgroundColor: p.successSoft }]}>
              <View style={[ts.dot, { backgroundColor: '#16A34A' }]}><Ionicons name="checkmark" size={40} color="#FFFFFF" /></View>
            </View>
            <Text style={[ts.h1, { color: p.text, marginTop: 16 }]} accessibilityRole="header">Booking confirmed!</Text>
            <Text style={{ fontSize: 14, color: p.sub, marginTop: 4, textAlign: 'center', maxWidth: 320, lineHeight: 20 }}>
              Your seat{done.seatCount === 1 ? ' is' : 's are'} booked. The auto leaves when the driver confirms departure; we will notify you.
            </Text>
          </View>
          <Card style={{ alignItems: 'center' }}>
            <Text style={[ts.kicker, { color: p.sub }]}>Booking code</Text>
            <Text selectable style={{ fontSize: 26, fontWeight: '800', color: p.text, letterSpacing: 4, marginTop: 4 }}>{done.bookingCode}</Text>
            {done.boardingPin ? (
              <>
                <Text style={[ts.kicker, { color: p.accent, marginTop: 14 }]}>Boarding PIN</Text>
                <Text style={{ fontSize: 38, fontWeight: '800', color: p.text, letterSpacing: 12, marginTop: 2 }} accessibilityLabel={`Boarding PIN ${done.boardingPin.split('').join(' ')}`}>{done.boardingPin}</Text>
                <Text style={{ fontSize: 13, color: p.sub, textAlign: 'center', lineHeight: 18 }}>Show the code and PIN to the driver when you board. Never share the PIN before that.</Text>
              </>
            ) : null}
          </Card>
          <Card>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
              <View style={{ alignItems: 'center', paddingTop: 4, width: 14 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: p.accent }} />
                <View style={{ width: 2, flex: 1, backgroundColor: p.border, marginVertical: 3 }} />
                <Ionicons name="location" size={13} color={p.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: p.text }}>{trip.pickup?.name || 'Pickup point'}</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: p.text, marginTop: 8 }}>{trip.destination || trip.route?.destination || 'Destination'}</Text>
              </View>
            </View>
            <Row label="Departure" value={fmtDeparture(trip.departureAt)} />
            <Row label="Seats" value={`${done.seatCount}${done.seatNumbers.length ? ` (no. ${done.seatNumbers.join(', ')})` : ''}`} />
            <Row label="Payment" value={done.paymentMethod === 'CASH' || !done.paymentMethod ? 'Cash to the driver at boarding' : PAYMENT_LABEL[done.paymentMethod]} />
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginVertical: 6 }} />
            <Row label="Total" value={inr(done.amount)} strong />
          </Card>
          {done.pickupInstructions ? <Notice tone="info">{done.pickupInstructions}</Notice> : null}
          <Btn label="View booking" icon="ticket-outline" onPress={() => router.replace(`/auto-ride/booking/${done.id}` as any)} />
          <Btn label="Back to home" kind="ghost" style={{ marginTop: 10 }} onPress={() => router.replace(AUTO_HOME as any)} />
        </ScrollView>
      </View>
    );
  }

  const cashOnly = methods.length <= 1 && (methods[0] || 'CASH') === 'CASH';
  const totalPreview = seatCount > 0 ? seatCount * (Number(trip.seatFare) || 0) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <AHeader title={step === 'review' ? 'Review and book' : 'Auto details and booking'} subtitle={`${queueLabel(trip.queueNumber)} to ${trip.destination || 'destination'}`} onBack={headerBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 150, width: '100%', maxWidth: 640, alignSelf: 'center' }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        {mineConfirmed ? (
          <PressScale onPress={() => router.push(`/auto-ride/booking/${trip.myBookingId}` as any)} accessibilityRole="button">
            <Notice tone="success">You have a booking on this auto. <Text style={{ fontWeight: '800', color: p.accent }}>Open it</Text></Notice>
          </PressScale>
        ) : null}
        {trip.mode === 'PRIVATE' && !mineConfirmed ? <Notice tone="warn">This auto has been booked as a full auto. Pick another auto.</Notice> : null}
        {trip.availability === 'NOT_OPEN' ? <Notice tone="info">Booking for this auto opens soon. Pull down to refresh.</Notice> : null}

        {/* Auto + driver */}
        <Card>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <AutoTile size={64} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: p.text }}>{trip.mode === 'PRIVATE' ? 'Full auto' : 'Shared auto'} · {queueLabel(trip.queueNumber)}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                {trip.driver?.rating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Ionicons name="star" size={13} color="#F5A524" />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: p.text }}>{trip.driver.rating.avg.toFixed(1)}</Text>
                    <Text style={{ fontSize: 12, color: p.muted }}>({trip.driver.rating.count})</Text>
                  </View>
                ) : <Text style={{ fontSize: 12, color: p.muted }}>No ratings yet</Text>}
                <VerifiedBadge verified={!!trip.driver?.verified} />
              </View>
              <View style={{ marginTop: 6 }}><StatusChip trip={trip} now={now + skew} /></View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: p.text }}>{inr(trip.seatFare)}</Text>
              <Text style={{ fontSize: 12, color: p.sub }}>per seat</Text>
            </View>
          </View>
          <View style={[ts.driverRow, { borderTopColor: p.border }]}>
            <View style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              {trip.driver?.photo ? <SafeImage source={{ uri: trip.driver.photo }} style={{ width: 44, height: 44 }} contentFit="cover" /> : <Ionicons name="person" size={20} color={p.accent} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: p.text }} numberOfLines={1}>{trip.driver?.name || 'Driver'}</Text>
              <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }} numberOfLines={2}>
                {trip.vehicle?.registration || 'Registration after booking'}{trip.vehicle?.registrationMasked ? ' (full number after booking)' : ''}
                {[trip.vehicle?.colour, trip.vehicle?.make, trip.vehicle?.model, trip.vehicle?.fuel].filter(Boolean).length ? ` · ${[trip.vehicle?.colour, trip.vehicle?.make, trip.vehicle?.model, trip.vehicle?.fuel].filter(Boolean).join(' ')}` : ''}
              </Text>
            </View>
          </View>
        </Card>

        {/* Ride details */}
        <Card>
          <Text style={[ts.cardTitle, { color: p.text }]}>Ride details</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <View style={{ alignItems: 'center', paddingTop: 4, width: 14 }}>
              <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2.5, borderColor: p.accent }} />
              <View style={{ width: 2, flex: 1, backgroundColor: p.border, marginVertical: 3 }} />
              <Ionicons name="location" size={14} color={p.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: p.muted, fontWeight: '700' }}>Pickup</Text>
              <Text style={{ fontSize: 15, fontWeight: '800', color: p.text }}>{trip.pickup?.name || trip.route?.origin || 'Pickup point'}</Text>
              {trip.pickup?.landmark ? <Text style={{ fontSize: 13, color: p.sub }}>{trip.pickup.landmark}</Text> : null}
              {trip.stops.length ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 8 }}>Stops: {trip.stops.join(' · ')}</Text> : null}
              <Text style={{ fontSize: 12, color: p.muted, fontWeight: '700', marginTop: 12 }}>Drop</Text>
              <Text style={{ fontSize: 15, fontWeight: '800', color: p.text }}>{trip.destination || trip.route?.destination || '—'}</Text>
              {trip.route ? <Text style={{ fontSize: 13, color: p.sub }}>{trip.route.name}{trip.route.distanceKm ? ` · ${trip.route.distanceKm} km` : ''}</Text> : null}
            </View>
          </View>
          {trip.pickup?.mapsUrl ? <Btn label="Open pickup in Maps" icon="navigate-outline" kind="secondary" small onPress={openMaps} style={{ marginTop: 12, alignSelf: 'flex-start' }} /> : null}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginVertical: 10 }} />
          <Row label="Departure" value={fmtDeparture(trip.departureAt)} strong />
          {trip.delayMinutes > 0 && trip.originalDepartureAt ? <Row label="Originally" value={`${fmtClock(trip.originalDepartureAt)} (delayed ${trip.delayMinutes} min)`} /> : null}
          <Row label="Leaves" value={fromNow(trip.departureAt, now + skew) || '—'} />
          <Row label="Seats" value={`${trip.remainingSeats} left of ${trip.capacity}${trip.heldSeats ? ` · ${trip.heldSeats} on hold` : ''}`} />
          {trip.minSeatsToDepart && trip.minSeatsToDepart < trip.capacity ? <Row label="Can leave with" value={`${trip.minSeatsToDepart}+ passengers`} /> : null}
          {trip.queueNumber ? <Text style={{ fontSize: 12, color: p.muted, marginTop: 6 }}>{queueLabel(trip.queueNumber)} at this stand. {trip.queueNote}</Text> : null}
        </Card>

        {/* Fare */}
        <Card>
          <Text style={[ts.cardTitle, { color: p.text }]}>Fare</Text>
          <View style={{ marginTop: 6 }}>
            <Row label="Fare per seat" value={inr(trip.seatFare)} />
            {trip.fullAutoFare ? <Row label="Whole auto" value={inr(trip.fullAutoFare)} /> : null}
          </View>
          <View style={[ts.cashRow, { backgroundColor: p.accentSoft }]}>
            <Ionicons name="cash-outline" size={18} color={p.accent} />
            <Text style={{ flex: 1, fontSize: 13, color: p.text, lineHeight: 18 }}>Pay the driver in cash when you board. Nothing is charged in the app for cash bookings.</Text>
          </View>
        </Card>

        {/* Seat map */}
        <Card>
          <Text style={[ts.cardTitle, { color: p.text }]}>{step === 'review' ? 'Your held seats' : pickMode ? 'Select seats' : 'Seat layout'}</Text>
          <Text style={{ fontSize: 13, color: p.sub, marginTop: 4, marginBottom: 14, lineHeight: 18 }}>
            {step === 'review' ? 'These seats are held for you until the timer runs out.' : pickMode ? 'Tap free seats to select them. The driver seat cannot be booked.' : 'Seats are assigned automatically on this auto; choose how many you need.'}
          </Text>
          <SeatMap rows={map.layout.rows} maleOnlySeats={map.layout.maleOnlySeats} viewer={notBoy ? 'NOT_MALE' : viewer === 'UNKNOWN' && rider === 'Male' ? 'MALE' : viewer}
            states={states} selected={step === 'select' ? selected : []} onToggle={toggle} selectable={pickMode && step === 'select' && canBook} />
          {step === 'select' && onlyFrontLeft && !trip.myBookingId ? (
            <Notice tone="warn">Only front seats left (boys only). Go back and book the next auto in the line.</Notice>
          ) : null}

          {step === 'select' && canBook ? (
            <View style={[ts.seatSummary, { borderTopColor: p.border }]}>
              <Text style={{ fontSize: 13, color: p.sub, textAlign: 'center', marginBottom: 10 }}>
                {freeAll} seat{freeAll === 1 ? '' : 's'} left{free < freeAll ? ` · ${free} for you` : ''}{pickMode && selected.length ? ` · ${selected.length} selected (${selected.join(', ')})` : ''}
              </Text>
              {pickMode ? null : <Stepper value={seatCount} min={1} max={Math.max(1, maxAllowed)} onChange={setCount} label="Seats" />}
              <View style={{ marginTop: pickMode ? 0 : 12 }}>
                <Row label="Price per seat" value={inr(trip.seatFare)} />
                <Row label={`Total (${seatCount} seat${seatCount === 1 ? '' : 's'})`} value={seatCount > 0 ? inr(totalPreview) : '—'} strong />
                <Text style={{ fontSize: 12, color: p.muted, marginTop: 2 }}>Up to {maxAllowed} seat{maxAllowed === 1 ? '' : 's'} per booking. The exact total is confirmed on the next step.</Text>
              </View>
            </View>
          ) : null}
        </Card>

        {step === 'select' && !canBook && !trip.myBookingId && trip.mode !== 'PRIVATE' && trip.availability !== 'NOT_OPEN' ? (
          <Notice tone="warn">Seat booking is closed for this auto ({trip.availabilityLabel}).</Notice>
        ) : null}

        {/* Review */}
        {step === 'review' && hold ? (
          <Card style={{ borderWidth: 1.5, borderColor: holdExpired ? p.danger : p.warn }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={[ts.cardTitle, { color: p.text }]}>Review and confirm</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: holdExpired ? p.dangerSoft : p.warnSoft }}
                accessibilityLabel={holdExpired ? 'Hold expired' : `Hold expires in ${mmss(holdLeft)}`} accessibilityLiveRegion="polite">
                <Ionicons name="time-outline" size={14} color={holdExpired ? p.danger : p.warn} />
                <Text style={{ fontWeight: '800', color: holdExpired ? p.danger : p.warn, fontSize: 13 }}>{holdExpired ? 'Expired' : mmss(holdLeft)}</Text>
              </View>
            </View>
            {notice ? <Notice tone="info">{notice}</Notice> : null}
            <Row label="Route" value={`${trip.pickup?.name || 'Pickup'} to ${trip.destination || '—'}`} />
            <Row label="Pickup" value={trip.pickup?.landmark ? `${trip.pickup.name} (${trip.pickup.landmark})` : trip.pickup?.name || '—'} />
            <Row label="Departure" value={fmtDeparture(trip.departureAt)} />
            <Row label="Seats" value={`${hold.seatCount}${hold.seatNumbers.length ? ` (no. ${hold.seatNumbers.join(', ')})` : ''}`} />
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginVertical: 8 }} />
            <Row label={`${hold.fareBreakdown.seats ?? hold.seatCount} seat${(hold.fareBreakdown.seats ?? hold.seatCount) === 1 ? '' : 's'} × ${inr(hold.fareBreakdown.seatFare ?? hold.seatFare)}`} value={inr(hold.fareBreakdown.total ?? hold.amount)} />
            <Row label="Total to pay" value={inr(hold.amount)} strong />

            <Text style={{ fontSize: 14, fontWeight: '800', color: p.text, marginTop: 14, marginBottom: 8 }}>Payment</Text>
            {cashOnly ? (
              <View style={[ts.cashRow, { backgroundColor: p.accentSoft, marginTop: 0 }]}>
                <Ionicons name="cash-outline" size={20} color={p.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: p.text }}>Pay the driver in cash when you board</Text>
                  <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>Show your booking code and PIN, then pay {inr(hold.amount)}.</Text>
                </View>
              </View>
            ) : methods.map((m) => {
              const on = payment === m;
              return (
                <PressScale key={m} onPress={() => setPayment(m)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={PAYMENT_LABEL[m]}
                  style={[ts.payRow, { borderColor: on ? p.accent : p.border, backgroundColor: on ? p.accentSoft : p.card }]}>
                  <Ionicons name={m === 'CASH' ? 'cash-outline' : 'wallet-outline'} size={20} color={on ? p.accent : p.sub} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: p.text }}>{m === 'CASH' ? 'Cash to the driver' : PAYMENT_LABEL[m]}</Text>
                    <Text style={{ fontSize: 12, color: p.sub }}>{m === 'CASH' ? 'Pay the driver when you board' : 'Paid now from your ZENV Wallet; refunds go back to it'}</Text>
                  </View>
                  <View style={[ts.radio, { borderColor: on ? p.accent : p.border }]}>{on ? <View style={[ts.radioDot, { backgroundColor: p.accent }]} /> : null}</View>
                </PressScale>
              );
            })}
            <Text style={{ fontSize: 12, color: p.muted, marginTop: 6 }}>You can cancel before the driver confirms departure. Cash bookings are never charged in the app.</Text>
          </Card>
        ) : null}

        {retry ? (
          <Notice tone="warn">{retry.message} Your request is saved; tap Retry to send it again safely (you will not be booked twice).</Notice>
        ) : null}
      </ScrollView>

      {/* Sticky action bar */}
      <View style={[ts.bar, { backgroundColor: p.card, borderTopColor: p.border }]}>
        <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center', gap: 8 }}>
          {step === 'select' ? (
            canBook ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <View style={{ minWidth: 84 }}>
                  <Text style={{ fontSize: 12, color: p.sub }}>{seatCount > 0 ? `${seatCount} seat${seatCount === 1 ? '' : 's'}` : 'No seats yet'}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: p.text }}>{seatCount > 0 ? inr(totalPreview) : inr(trip.seatFare)}</Text>
                </View>
                <Btn label={retry?.kind === 'hold' ? 'Retry' : 'Continue'} icon="arrow-forward" style={{ flex: 1 }}
                  onPress={() => doHold()} loading={busy === 'hold'} disabled={seatCount < 1} />
                {trip.privateBookingAllowed ? <Btn label="Full auto" kind="ghost" onPress={() => router.push(`/auto-ride/full/${trip.id}` as any)} /> : null}
              </View>
            ) : trip.privateBookingAllowed ? (
              <Btn label={`Book the whole auto · ${inr(trip.fullAutoFare)}`} icon="lock-closed-outline" onPress={() => router.push(`/auto-ride/full/${trip.id}` as any)} />
            ) : (
              <Btn label="Find another auto" kind="secondary" onPress={() => router.replace(AUTO_HOME as any)} />
            )
          ) : step === 'review' && hold ? (
            holdExpired ? (
              <Btn label="Hold expired · pick seats again" onPress={() => { setHold(null); holdKey.current = null; confirmKey.current = null; setStep('select'); load(); }} />
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn label="Release" kind="secondary" onPress={askRelease} loading={busy === 'release'} disabled={busy === 'confirm'} />
                <Btn label={retry?.kind === 'confirm' ? 'Retry booking' : `Book now · ${inr(hold.amount)}`} icon="checkmark" style={{ flex: 1 }} onPress={doConfirm} loading={busy === 'confirm'} disabled={busy === 'release'} />
              </View>
            )
          ) : null}
        </View>
      </View>
    </View>
  );
}

const ts = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  kicker: { fontSize: 13, fontWeight: '600' },
  halo: { width: 128, height: 128, borderRadius: 64, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  cashRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 12, marginTop: 12 },
  seatSummary: { marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1.5, marginBottom: 8, minHeight: 56 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20, borderTopWidth: StyleSheet.hairlineWidth },
});
