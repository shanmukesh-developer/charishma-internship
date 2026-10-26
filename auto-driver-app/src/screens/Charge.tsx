// The stand view of an auto put on charge (union queue). Shows whether the auto is on charge (leaves next) or
// waiting in line (#2, #3 ...); both take app bookings. Seats left, walk-in passengers (+1 / -1 or tap a seat),
// the app bookings, the fare (changeable until a student books), the line, and the two decisions: Depart (the
// auto on charge any time once someone is in, a waiting auto only when full) and Leave the line.
// Seat counts always come from the server (walk-ins are real seat rows); live via socket nudges + 10 s refresh.
// Each app booking shows its arrival countdown (server arriveBy): a student not checked in by then is released as a
// no-show by the server; the driver can check them in, or mark a no-show early once they have been warned.
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, ErrorStrip, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, Field, KeyValue, Screen, SectionTitle } from '../ui/Screen';
import { fareProblem, rangeText } from './PutOnCharge';
import SeatMap, { SEAT_META, driverSeatStates, type DriverSeatState } from '../ui/SeatMap';
import { SosButton } from '../ui/Sos';
import { useToast } from '../ui/Toast';
import { useLoad } from '../state/useLoad';
import { useDriverEvents } from '../state/SocketProvider';
import { driverApi } from '../api/driverApi';
import { errorMessage } from '../lib/http';
import { rupees } from '../lib/format';
import type { BookingDriver, LineEntry, SeatMapResponse, Trip } from '../types';
import type { ScreenProps } from '../nav';

const AT_STAND = ['PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL'];
const LEAVING = ['DRIVER_CONFIRMED', 'BOARDING', 'IN_PROGRESS'];
const WALK_IN_EDITABLE = [...AT_STAND, 'DRIVER_CONFIRMED', 'BOARDING'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Seats closed two ways, kept visibly apart: by app bookings (automatic) and by the driver (walk-ins). */
function SeatSplit({ trip }: { trip: Trip }) {
  const app = trip.appSeats || 0;
  const held = trip.heldSeats || 0;
  const walkIn = trip.walkInSeats || 0;
  const tile = (meta: { color: string; bg: string; fg: string }, value: number, title: string, sub: string) => (
    <View style={[styles.split, { borderColor: meta.color }]} accessibilityLabel={`${title}: ${value}. ${sub}`}>
      <View style={[styles.swatch, { backgroundColor: meta.bg, borderColor: meta.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={[font.big, { color: color.text, fontSize: 30, lineHeight: 34 }]}>{value}</Text>
        <Text style={[font.small, { color: color.text, fontWeight: '700' }]}>{title}</Text>
        <Text style={[font.small, { color: color.textMuted }]}>{sub}</Text>
      </View>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {tile(SEAT_META.BOOKED, app, 'Booked in the app', held ? `Closed automatically · ${held} being booked` : 'Closed automatically')}
      {tile(SEAT_META.WALK_IN, walkIn, 'Walk-in', 'Closed by you')}
    </View>
  );
}

interface Loaded { trip: Trip; line: LineEntry[]; seats: SeatMapResponse; bookings: BookingDriver[] }

const mmss = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/** "Arrives within 12:40" for one confirmed app booking (ticks every second; the server releases the seat at 0). */
function ArrivalCountdown({ arriveBy }: { arriveBy: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = new Date(arriveBy).getTime() - now;
  const urgent = left <= 5 * 60 * 1000;
  return (
    <Text style={[font.small, { color: urgent ? color.alert : color.warning, fontWeight: '800', fontVariant: ['tabular-nums'] }]}
      accessibilityLabel={left > 0 ? `Must check in within ${mmss(left)}` : 'Time is up, the seat is being released'}>
      {left > 0 ? `Check in within ${mmss(left)}` : 'Not here: seat being released'}
    </Text>
  );
}

function Hero({ trip }: { trip: Trip }) {
  const walkIn = trip.walkInSeats || 0;
  const app = trip.appSeats || 0;
  const pos = trip.line?.position || null;
  if (trip.onCharge) {
    return (
      <View style={[styles.hero, { backgroundColor: color.open }]} accessibilityRole="summary">
        <Text style={[font.h3, { color: color.textInverse }]}>On charge</Text>
        <Text style={[font.big, { color: color.textInverse }]}>{plural(trip.remainingSeats, 'seat')} left</Text>
        <Text style={[font.body, { color: color.textInverse }]}>{app} booked in the app · {walkIn} walk-in · {trip.capacity} seats</Text>
      </View>
    );
  }
  if (trip.queueState === 'WAITING') {
    const ahead = trip.line?.ahead || 0;
    return (
      <View style={[styles.hero, styles.heroWait]} accessibilityRole="summary">
        <Text style={[font.h3, { color: color.brandDark }]}>Waiting in line</Text>
        <Text style={[font.big, { color: color.text }]}>{pos ? `Number ${pos}` : 'In line'}</Text>
        <Text style={[font.body, { color: color.textSecondary }]}>
          {plural(ahead, 'auto')} ahead of you. Students can book your auto while you wait.
        </Text>
      </View>
    );
  }
  const full = trip.remainingSeats === 0;
  return (
    <View style={[styles.hero, { backgroundColor: color.brandTint, borderColor: color.brand }]} accessibilityRole="summary">
      <Text style={[font.h3, { color: color.brandDark }]}>{LEAVING.includes(trip.status) ? 'Leaving the stand' : full ? 'Full' : 'Off charge'}</Text>
      <Text style={[font.big, { color: color.text }]}>{trip.confirmedSeats}/{trip.capacity} seats filled</Text>
      <Text style={[font.body, { color: color.textSecondary }]}>
        {LEAVING.includes(trip.status) ? 'Check in students, then start the trip.' : 'The next auto is on charge now. Tap Depart when you are ready to leave.'}
      </Text>
    </View>
  );
}

export default function ChargeScreen({ navigation, route }: ScreenProps<'Charge'>) {
  const { tripId } = route.params;
  const toast = useToast();
  const q = useLoad<Loaded>(async () => {
    const [l, s, b] = await Promise.all([driverApi.tripLine(tripId), driverApi.seats(tripId), driverApi.bookings(tripId)]);
    return { trip: l.trip, line: l.line, seats: s, bookings: b.bookings };
  }, [tripId], { pollMs: 10000 });
  useDriverEvents(() => q.reload());
  const [busy, setBusy] = useState<string | null>(null);
  const [fareOpen, setFareOpen] = useState(false);
  const [fareText, setFareText] = useState('');

  const change = async (action: 'add' | 'remove', seatNo?: number) => {
    if (busy) return;
    setBusy(seatNo ? `seat:${seatNo}` : action);
    try {
      const r = await driverApi.walkIn(tripId, action, seatNo);
      q.setData((d) => (d ? { ...d, trip: { ...d.trip, ...r.trip }, seats: { ...d.seats, layout: r.layout, seats: r.seats } } : d));
      if (r.trip.status === 'FULL' && action === 'add') toast.show('The auto is full. The next auto is on charge now.', 'success');
      q.reload();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
      q.reload();
    } finally {
      setBusy(null);
    }
  };

  const depart = () => {
    Alert.alert('Depart now?', 'Your auto leaves the stand and the next auto goes on charge. Students who booked stay on your auto: check each one in with their booking code and PIN, then start the trip.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Depart',
        onPress: async () => {
          setBusy('depart');
          try {
            await driverApi.action(tripId, 'depart');
            toast.show('You are leaving the stand. Check in students, then start the trip.', 'success');
            navigation.replace('TripDetail', { tripId });
          } catch (e) {
            toast.show(errorMessage(e), 'error');
            q.reload();
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const leave = (hasBookings: boolean) => {
    Alert.alert('Leave the line?', hasBookings
      ? 'Students who booked your auto move to the next auto in the line that has room, at the same fare. Anyone who does not fit is told and their booking is cancelled.'
      : 'Your auto leaves the line. The autos behind you move up.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave the line',
        style: 'destructive',
        onPress: async () => {
          setBusy('leave');
          try {
            const r = await driverApi.action(tripId, 'cancel', { reason: 'The driver left the line' });
            const moved = r.bookingsMoved || 0;
            toast.show(moved ? `You left the line. ${moved} booking${moved === 1 ? '' : 's'} moved to the next auto.` : 'You left the line.', 'info');
            navigation.navigate('Home');
          } catch (e) {
            toast.show(errorMessage(e), 'error');
            q.reload();
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  if (q.loading && !q.data) return <Screen title="At the stand" onBack={() => navigation.goBack()}><SkeletonCard lines={4} /><SkeletonCard /></Screen>;
  if (!q.data) {
    return (
      <Screen title="At the stand" onBack={() => navigation.goBack()}>
        <ErrorStrip text={q.error || 'Could not load your auto.'} onRetry={q.refresh} busy={q.refreshing} />
      </Screen>
    );
  }

  const { trip, line, seats, bookings } = q.data;
  const terminal = !AT_STAND.includes(trip.status) && !LEAVING.includes(trip.status);
  const waiting = trip.queueState === 'WAITING';
  // The auto on charge may leave once someone is in; a waiting auto only when it is full (the server checks too).
  const canDepart = ['OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL'].includes(trip.status) && trip.confirmedSeats > 0
    && (!waiting || trip.status === 'FULL');
  const range = trip.fareRange || { min: null, max: null };
  const farePick = fareProblem(fareText, range.min, range.max);
  const saveFare = async () => {
    if (farePick || busy) return;
    setBusy('fare');
    try {
      const r = await driverApi.changeFare(tripId, Number(fareText));
      q.setData((d) => (d ? { ...d, trip: { ...d.trip, ...r.trip } } : d));
      setFareOpen(false);
      toast.show(`Fare set to ${rupees(r.trip.seatFare)} a seat.`, 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
      q.reload();
    } finally {
      setBusy(null);
    }
  };
  const editable = WALK_IN_EDITABLE.includes(trip.status) && trip.mode !== 'PRIVATE';
  const appBookings = bookings.filter((b) => ['HELD', 'CONFIRMED', 'BOARDED'].includes(b.status));
  const { states, labels } = driverSeatStates(seats.seats, appBookings);
  const rows = (seats.layout || trip.seatLayout || { rows: [] }).rows;
  const walkIn = trip.walkInSeats || 0;
  const busySeat = busy && busy.startsWith('seat:') ? Number(busy.slice(5)) : null;

  const noShow = (b: BookingDriver) => {
    Alert.alert(`${b.passengerName} did not come?`, `Booking ${b.bookingCode}. Their seat${b.seatCount === 1 ? '' : 's'} (${b.seatNumbers.join(', ')}) go back on sale. The app releases it by itself when the countdown ends.`, [
      { text: 'Keep waiting', style: 'cancel' },
      { text: 'Release seat', style: 'destructive', onPress: async () => {
        setBusy(`noshow:${b.id}`);
        try { await driverApi.noShow(tripId, b.id); toast.show(`Seat ${b.seatNumbers.join(', ')} is free again (no-show).`, 'success'); } catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); q.reload(); }
      } },
    ]);
  };

  const onSeat = (n: number, st: DriverSeatState) => {
    if (st === 'AVAILABLE') change('add', n);
    else if (st === 'WALK_IN') change('remove', n);
    else if (st === 'HELD') toast.show(`Seat ${n} is being booked in the app right now.`, 'info');
    else if (st === 'BOOKED' || st === 'BOARDED') toast.show(`Seat ${n} was booked in the app by a student. Only walk-in seats can be freed.`, 'info');
  };

  return (
    <Screen
      title={trip.route ? `To ${trip.destination || trip.route.destination}` : 'At the stand'}
      onBack={() => navigation.goBack()}
      right={!terminal ? <SosButton tripId={trip.id} /> : undefined}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
      stationary={!terminal}
      footer={canDepart ? (
        <Button label="Depart" icon="navigate" size="huge" variant="accept" loading={busy === 'depart'} disabled={!!busy} onPress={depart} />
      ) : LEAVING.includes(trip.status) ? (
        <Button label="Open trip" icon="arrow-forward" size="huge" variant="primary" onPress={() => navigation.replace('TripDetail', { tripId })} />
      ) : undefined}
    >
      {q.error ? <ErrorStrip text={`Showing the last loaded seats. ${q.error}`} onRetry={q.refresh} busy={q.refreshing} /> : null}
      {terminal ? (
        <Card style={{ gap: space.sm }}>
          <Text style={[font.h3, { color: color.text }]}>This auto is no longer in the line</Text>
          {trip.cancelReason ? <Text style={[font.body, { color: color.textSecondary }]}>{trip.cancelReason}</Text> : null}
          <Button label="Back to home" icon="home" variant="secondary" onPress={() => navigation.navigate('Home')} />
        </Card>
      ) : (
        <>
          <Hero trip={trip} />
          <SeatSplit trip={trip} />
          {waiting && trip.status === 'FULL' ? <Banner tone="ok" text="Your auto is full. You can depart now." /> : null}
          {trip.status === 'OPEN_FOR_BOOKING' && trip.heldSeats > 0 && trip.confirmedSeats === 0 ? (
            <Banner tone="info" text={`${plural(trip.heldSeats, 'seat is', 'seats are')} being booked in the app. You can depart once a passenger is in.`} />
          ) : null}

          {editable ? (
            <Card style={{ gap: space.sm }}>
              <Text style={[font.h3, { color: color.text }]}>Walk-in passengers</Text>
              <Text style={[font.small, { color: color.textMuted }]}>People who sat in without the app. Close their seats here so the app never sells them. Seats booked in the app close on their own.</Text>
              <View style={styles.counter}>
                <Button label="−1" variant="secondary" a11y="Free one walk-in seat" disabled={!walkIn || !!busy} loading={busy === 'remove'} onPress={() => change('remove')} style={{ flex: 1 }} />
                <View style={styles.count} accessibilityLabel={`${walkIn} walk-in passengers`}>
                  <Text style={[font.big, { color: color.text }]}>{walkIn}</Text>
                </View>
                <Button label="+1" variant="accept" a11y="Fill one seat with a walk-in passenger" disabled={trip.remainingSeats === 0 || !!busy} loading={busy === 'add'} onPress={() => change('add')} style={{ flex: 1 }} />
              </View>
            </Card>
          ) : null}

          <SectionTitle text="Seats" />
          <Card>
            <SeatMap rows={rows} maleOnlySeats={(seats.layout || trip.seatLayout || { rows: [] }).maleOnlySeats} states={states} labels={labels} onSeatPress={editable ? onSeat : undefined} busySeat={busySeat} />
            {editable ? <Text style={[font.small, { color: color.textMuted, textAlign: 'center', marginTop: space.xs }]}>Tap a free seat to fill it, or a walk-in seat to free it.</Text> : null}
          </Card>

          <SectionTitle text={`Booked in the app (${appBookings.length})`} />
          {appBookings.length ? appBookings.map((b) => (
            <Card key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={[font.h3, { color: color.text }]}>{b.passengerName} · {plural(b.seatCount, 'seat')}</Text>
                <Text style={[font.small, { color: color.textSecondary }]}>
                  {b.bookingCode}{b.seatNumbers.length ? ` · seat ${b.seatNumbers.join(', ')}` : ''}{b.cashToCollect ? ` · collect ${rupees(b.cashToCollect)}` : ''}
                </Text>
                {b.status === 'CONFIRMED' && b.arriveBy ? <ArrivalCountdown arriveBy={b.arriveBy} /> : null}
                {b.status === 'CONFIRMED' ? (
                  <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.xs }}>
                    <Button label="Check in" icon="qr-code" variant="accept" size="secondary" disabled={!!busy}
                      onPress={() => navigation.navigate('CheckIn', { tripId, code: b.bookingCode })} />
                    {b.arriveBy ? (
                      <Button label="Did not come" icon="person-remove" variant="rejectOutline" size="secondary" loading={busy === `noshow:${b.id}`} disabled={!!busy}
                        onPress={() => noShow(b)} />
                    ) : null}
                  </View>
                ) : null}
              </View>
              <Badge
                text={b.status === 'BOARDED' ? 'Checked in' : b.status === 'HELD' ? 'Booking' : 'Booked'}
                fg={b.status === 'BOARDED' ? color.boarded : b.status === 'HELD' ? color.warning : color.openDark}
                bg={b.status === 'BOARDED' ? color.boardedTint : b.status === 'HELD' ? color.warningTint : color.openTint}
              />
            </Card>
          )) : <Card><Text style={[font.body, { color: color.textSecondary }]}>No app bookings yet.</Text></Card>}
          {appBookings.some((b) => b.status === 'CONFIRMED') ? (
            <Button label="Check in a student" icon="qr-code" variant="secondary" onPress={() => navigation.navigate('CheckIn', { tripId })} />
          ) : null}

          <Card style={{ gap: 2 }}>
            <KeyValue k="Stand" v={trip.pickup?.name || '—'} />
            <KeyValue k="Fare" v={`${rupees(trip.seatFare)} a seat, cash`} />
            {trip.vehicle ? <KeyValue k="Auto" v={trip.vehicle.registration || ''} /> : null}
            {trip.fareLocked === false ? (
              <Button label="Change fare" icon="pricetag" variant="secondary" size="secondary" style={{ marginTop: space.xs }}
                onPress={() => { setFareText(String(trip.seatFare)); setFareOpen(true); }} />
            ) : trip.fareLocked && appBookings.length ? (
              <Text style={[font.small, { color: color.textMuted, marginTop: space.xxs }]}>The fare is locked because a student has booked.</Text>
            ) : null}
          </Card>
          <Sheet visible={fareOpen} onClose={() => setFareOpen(false)} title="Fare per seat">
            <View style={{ gap: space.md }}>
              <Field
                label="Fare per seat"
                prefix="₹"
                keyboardType="number-pad"
                value={fareText}
                onChangeText={(v) => setFareText(v.replace(/[^0-9.]/g, '').slice(0, 6))}
                error={fareText && farePick ? farePick : null}
                hint={rangeText(range.min, range.max) ? `Allowed ${rangeText(range.min, range.max)}. Locked once a student books.` : 'Locked once a student books.'}
              />
              <Button label="Save fare" icon="checkmark" variant="accept" loading={busy === 'fare'} disabled={!!farePick || !!busy} onPress={saveFare} />
            </View>
          </Sheet>

          {line.length ? (
            <>
              <SectionTitle text={`The line (${line.length})`} />
              {line.map((x) => (
                <View key={`${x.position}-${x.registration}`} style={[styles.lineRow, x.mine && styles.lineMine]}>
                  <Text style={[font.h3, { color: color.text, width: 40 }]}>#{x.position}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{x.mine ? 'You' : x.driverName}{x.registration ? ` · ${x.registration}` : ''}</Text>
                    <Text style={[font.small, { color: color.textMuted }]}>{x.filledSeats}/{x.capacity} filled{x.walkInSeats ? ` · ${x.walkInSeats} walk-in` : ''}</Text>
                  </View>
                  <Badge text={x.onCharge ? 'On charge' : 'Waiting'} fg={x.onCharge ? color.openDark : color.textSecondary} bg={x.onCharge ? color.openTint : color.surfaceAlt} />
                </View>
              ))}
            </>
          ) : null}

          {AT_STAND.includes(trip.status) ? (
            <Button label="Leave the line" icon="exit" variant="rejectOutline" loading={busy === 'leave'} disabled={!!busy} onPress={() => leave(appBookings.length > 0)} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: space.lg, gap: space.xxs, borderWidth: 2, borderColor: 'transparent' },
  heroWait: { backgroundColor: color.surface, borderColor: color.brand },
  counter: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  count: { minWidth: 72, alignItems: 'center' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  lineMine: { borderColor: color.open, borderWidth: 2 },
  split: { flex: 1, flexDirection: 'row', gap: space.xs, padding: space.sm, borderRadius: radius.md, borderWidth: 2, backgroundColor: color.surface },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5, marginTop: 8 },
});
