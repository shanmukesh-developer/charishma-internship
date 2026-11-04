// Boarding check-in: the passenger shows booking code + 4-digit PIN; the driver types both
// (POST /trips/:id/check-in). 5 wrong PINs lock that booking for 15 minutes (server: WRONG_PIN
// { attemptsLeft }, then 429 PIN_LOCKED). Cash bookings: the driver ticks "cash collected" so it counts
// in earnings. Never queued offline: the PIN check needs the server.
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, ErrorStrip, SkeletonCard } from '../ui/kit';
import { Banner, Screen } from '../ui/Screen';
import { SwitchRow } from '../ui/Stepper';
import { PinPad } from '../ui/PinPad';
import { useToast } from '../ui/Toast';
import { useLoad } from '../state/useLoad';
import { useDriverEvents } from '../state/SocketProvider';
import { driverApi } from '../api/driverApi';
import { ApiError, NetworkError, errorMessage } from '../lib/http';
import { rupees, timeIst } from '../lib/format';
import { LIMITS } from '../config';
import type { BookingDriver } from '../types';
import type { ScreenProps } from '../nav';

const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
// Where the server takes a check-in: boarding, on the way (a late passenger), and a union queue auto at the stand.
const CHECK_IN_STATUSES = ['BOARDING', 'IN_PROGRESS'];
const STAND_STATUSES = ['OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL', 'DRIVER_CONFIRMED'];
/** Booked and not in yet: confirmed, or marked not here but still in the late check-in time. */
export const toCheckIn = (b: BookingDriver) => b.status === 'CONFIRMED' || (b.status === 'NO_SHOW' && !!b.lateCheckInUntil);

export default function CheckInScreen({ navigation, route }: ScreenProps<'CheckIn'>) {
  const { tripId } = route.params;
  const toast = useToast();
  const q = useLoad(async () => {
    const [t, b] = await Promise.all([driverApi.trip(tripId), driverApi.bookings(tripId)]);
    return { trip: t.trip, bookings: b.bookings };
  }, [tripId]);
  useDriverEvents(() => q.reload(), (e) => e.kind === 'booking' || e.id === tripId);
  const [code, setCode] = useState(cleanCode(route.params.code || ''));
  const [pin, setPin] = useState('');
  const [cash, setCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [done, setDone] = useState<(BookingDriver & { late?: boolean; seatsChanged?: boolean }) | null>(null);

  const match = useMemo(() => (q.data?.bookings || []).find((b) => b.bookingCode === code) || null, [q.data, code]);
  useEffect(() => { setAttemptsLeft(null); setLocked(null); setError(null); }, [code]);

  const submit = async () => {
    if (busy || pin.length !== 4 || code.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const r = await driverApi.checkIn(tripId, code, pin, !!(match && match.cashToCollect > 0 && cash));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone({ ...r.booking, late: !!r.late, seatsChanged: !!r.seatsChanged });
      if (r.duplicate) toast.show('Already checked in.', 'info');
      q.reload();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setShake((n) => n + 1);
      setPin('');
      if (e instanceof ApiError && e.code === 'WRONG_PIN') setAttemptsLeft(Number(e.data?.attemptsLeft ?? 0));
      if (e instanceof ApiError && e.code === 'PIN_LOCKED') setLocked(e.message);
      setError(e instanceof NetworkError ? 'No internet. The PIN must be checked by ZENV. Try again when online.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => { setDone(null); setCode(''); setPin(''); setCash(false); setError(null); };

  if (q.loading && !q.data) return <Screen title="Check in" onBack={() => navigation.goBack()}><SkeletonCard /></Screen>;
  if (!q.data) return <Screen title="Check in" onBack={() => navigation.goBack()}><ErrorStrip text={q.error || 'Could not load.'} onRetry={q.refresh} busy={q.refreshing} /></Screen>;
  const trip = q.data.trip;
  const waiting = q.data.bookings.filter(toCheckIn);
  const open = CHECK_IN_STATUSES.includes(trip.status) || (trip.dispatchMode === 'ON_CHARGE' && STAND_STATUSES.includes(trip.status));

  if (!open) {
    return (
      <Screen title="Check in" onBack={() => navigation.goBack()} stationary>
        <Banner tone="warn" text={trip.status === 'DRIVER_CONFIRMED' ? 'Start boarding on the trip screen first, then check passengers in.' : `Check-in is only during boarding. Trip status: ${trip.statusLabel}.`} />
        <Button label="Back to trip" icon="arrow-back" variant="secondary" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen title="Check in" onBack={() => navigation.goBack()} stationary
        footer={<>
          {waiting.length ? <Button label={`Check in next (${waiting.length} waiting)`} icon="qr-code" size="huge" variant="accept" onPress={next} /> : null}
          <Button label="Back to trip" icon="arrow-back" variant={waiting.length ? 'secondary' : 'primary'} onPress={() => navigation.goBack()} />
        </>}>
        <Card style={{ alignItems: 'center', gap: space.sm, backgroundColor: color.openTint, borderColor: color.open }}>
          <Text style={[font.big, { color: color.openDark }]}>✓</Text>
          <Text style={[font.h1, { color: color.openDark }]}>{done.passengerName} is in</Text>
          <Text style={[font.h3, { color: color.openDark }]}>{done.passengerCount} passenger{done.passengerCount === 1 ? '' : 's'}{done.seatNumbers.length ? ` · seat ${done.seatNumbers.join(', ')}` : ''}</Text>
          {done.cashCollectedAt ? <Badge text={`CASH ${rupees(done.amount)} COLLECTED`} fg={color.openDark} bg={color.surface} /> : null}
        </Card>
        {done.late ? <Banner tone="ok" text={done.seatsChanged ? `Checked in late. Their old seat was taken, so they now have seat ${done.seatNumbers.join(', ')}.` : 'Checked in late. Their not-here mark is cleared.'} /> : null}
        <Text style={[font.body, { color: color.textSecondary, textAlign: 'center' }]}>Boarded {trip.boardedSeats} of {trip.confirmedSeats} confirmed seats.</Text>
      </Screen>
    );
  }

  return (
    <Screen title="Check in" onBack={() => navigation.goBack()} stationary
      footer={<Button label="Check in" icon="checkmark-circle" size="huge" variant="accept" loading={busy} disabled={pin.length !== 4 || code.length < 4 || !!locked} onPress={submit} />}>
      <Text style={[font.body, { color: color.textSecondary }]}>Ask the passenger for the booking code and 4-digit PIN in their ZENV app.</Text>
      <View style={{ gap: space.xxs }}>
        <Text style={[font.label, { color: color.textSecondary }]}>BOOKING CODE</Text>
        <TextInput value={code} onChangeText={(v) => setCode(cleanCode(v))} autoCapitalize="characters" autoCorrect={false} placeholder="ZA······" placeholderTextColor={color.textMuted}
          style={[font.code, { minHeight: 64, borderWidth: 2, borderColor: match ? color.open : color.border, borderRadius: radius.md, paddingHorizontal: space.md, color: color.text, backgroundColor: color.surface }]}
          accessibilityLabel="Booking code" />
      </View>
      {match ? (
        <Card style={{ gap: 2 }}>
          <Text style={[font.h3, { color: color.text }]}>{match.passengerName} · {match.passengerCount} passenger{match.passengerCount === 1 ? '' : 's'}</Text>
          <Text style={[font.body, { color: color.textSecondary }]}>{match.seatNumbers.length ? `Seat ${match.seatNumbers.join(', ')}` : `${match.seatCount} seats`} · {match.status === 'BOARDED' ? 'already checked in' : match.status === 'NO_SHOW' ? (match.lateCheckInUntil ? `marked not here, can still check in until ${timeIst(match.lateCheckInUntil)}` : 'marked not here') : 'booked, not checked in'}</Text>
        </Card>
      ) : code.length >= 8 ? <Banner tone="warn" text="No booking with this code on this trip. Check the code with the passenger." /> : null}
      {match && match.cashToCollect > 0 ? (
        <SwitchRow label={`Collected ${rupees(match.cashToCollect)} cash`} sub="Tick only after you have the money. It is added to your earnings." value={cash} onChange={setCash} />
      ) : null}
      <PinPad value={pin} onChange={(v) => { setPin(v); setError(null); }} disabled={busy || !!locked} shakeKey={shake} />
      {locked ? <Banner tone="error" title="Locked for 15 minutes" text={locked} /> : null}
      {error && !locked ? <Banner tone="error" text={error} /> : null}
      {attemptsLeft !== null && !locked ? (
        <Text style={[font.h3, { color: attemptsLeft <= 2 ? color.alertDark : color.warning, textAlign: 'center' }]}>
          {attemptsLeft} of {LIMITS.PIN_MAX_ATTEMPTS} attempts left
        </Text>
      ) : null}
    </Screen>
  );
}
