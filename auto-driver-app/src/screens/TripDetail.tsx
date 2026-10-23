// Trip Detail: the live trip for its driver. Tabs: Status (state + the next action), Seats (the same live
// seat layout passengers see) and Bookings (first name + booking code + seats + boarding status, holds,
// no-show). Data: GET /trips/:id, /trips/:id/seats, /trips/:id/bookings; refreshed by socket nudges
// ('autoride:changed') and every 10 s. Buttons follow the state machine (lib/tripRules.ts actionsFor).
// Trip actions are never queued offline: after a network failure the trip is re-read from the server
// first, so a change that did reach it is not sent twice.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, Chip, EmptyState, ErrorStrip, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, KeyValue, Screen, SectionTitle } from '../ui/Screen';
import SeatMap, { driverSeatStates } from '../ui/SeatMap';
import { SosButton } from '../ui/Sos';
import { useToast } from '../ui/Toast';
import { useDriverEvents } from '../state/SocketProvider';
import { useLoad } from '../state/useLoad';
import { driverApi } from '../api/driverApi';
import { ApiError, NetworkError, errorMessage, serverNow } from '../lib/http';
import { ACTION_TARGET, TERMINAL, actionsFor } from '../lib/tripRules';
import { countdown, dateTimeIst, rupees, timeIst } from '../lib/format';
import { TRIP_POLL_MS } from '../config';
import { TripSummaryCard, atStand } from './Home';
import type { BookingDriver, DriverAction, Trip, TripStatus } from '../types';
import type { ScreenProps } from '../nav';

type Tab = 'status' | 'seats' | 'bookings';

const ACTION_COPY: Record<string, { label: string; icon: any; confirmTitle: string; confirmBody: string; ok: string }> = {
  'confirm-departure': { label: 'Confirm departure', icon: 'checkmark-done', confirmTitle: 'Is the auto ready to leave?', confirmBody: 'Passengers are told you confirmed. Seats that are still being booked (not paid) are released and booking closes.', ok: 'Departure confirmed.' },
  'start-boarding': { label: 'Start boarding', icon: 'enter', confirmTitle: 'Start boarding?', confirmBody: 'Passengers are told to show their booking code and PIN.', ok: 'Boarding started.' },
  start: { label: 'Start trip', icon: 'play', confirmTitle: 'Safety check', confirmBody: 'Everyone seated? Nobody on the footboard or outside the auto? Passengers who did not board are marked as missed.', ok: 'Trip started. Drive safe.' },
  arrive: { label: 'Arrived at destination', icon: 'flag', confirmTitle: 'Arrived?', confirmBody: 'Mark that you reached the destination.', ok: 'Arrival marked.' },
  complete: { label: 'Complete trip', icon: 'checkmark-circle', confirmTitle: 'Complete the trip?', confirmBody: 'All passengers got down? The trip cannot be restarted after this.', ok: 'Trip completed.' },
  resume: { label: 'Back on schedule', icon: 'play-forward', confirmTitle: 'Resume the trip?', confirmBody: 'Passengers are told you are back on schedule.', ok: 'Trip resumed.' },
};
const ACTION_BODY: Partial<Record<DriverAction, Record<string, unknown>>> = {
  'confirm-departure': { ready: true },
  start: { safetyConfirmed: true },
};
const DELAYS = [5, 10, 15, 20, 30, 45, 60];

export default function TripDetailScreen({ navigation, route }: ScreenProps<'TripDetail'>) {
  const { tripId } = route.params;
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(route.params.tab || 'status');
  const [busy, setBusy] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<{ action: DriverAction; from: TripStatus; at: number } | null>(null);
  const [sheet, setSheet] = useState<'delay' | 'cancel' | null>(null);
  const [now, setNow] = useState(serverNow());
  useEffect(() => { const t = setInterval(() => setNow(serverNow()), 1000); return () => clearInterval(t); }, []);

  const q = useLoad(async () => {
    const [t, s, b] = await Promise.all([driverApi.trip(tripId), driverApi.seats(tripId), driverApi.bookings(tripId)]);
    return { trip: t.trip, seats: s, bookings: b.bookings, at: Date.now() };
  }, [tripId], { pollMs: TRIP_POLL_MS });
  useDriverEvents(() => q.reload(), (e) => e.kind === 'booking' || e.id === tripId);

  const trip = q.data?.trip || null;
  const acts = trip ? actionsFor(trip, now) : null;
  const terminal = trip ? TERMINAL.includes(trip.status) : false;

  const run = useCallback(async (action: DriverAction, body: Record<string, unknown> = {}) => {
    if (!trip || busy) return false;
    setBusy(action);
    const from = trip.status;
    try {
      const r = await driverApi.action(trip.id, action, { ...(ACTION_BODY[action] || {}), ...body });
      setUncertain(null);
      q.setData((d) => (d ? { ...d, trip: r.trip, at: Date.now() } : d));
      toast.show(ACTION_COPY[action]?.ok || (r.bookingsCancelled ? `Trip closed. ${r.bookingsCancelled} booking${r.bookingsCancelled === 1 ? '' : 's'} cancelled and passengers told.` : 'Done.'), 'success');
      q.reload();
      return true;
    } catch (e) {
      if (e instanceof NetworkError) {
        setUncertain({ action, from, at: Date.now() });
        toast.show('Not confirmed by Zenvy (no internet). Checking the trip before you try again.', 'error');
      } else {
        toast.show(errorMessage(e), 'error');
      }
      q.reload();
      return false;
    } finally {
      setBusy(null);
    }
  }, [trip, busy, q, toast]);

  // After a network failure: did the change reach the server? Decided only on a trip read AFTER the failure;
  // until then the action buttons stay disabled (never re-sent blindly).
  const fresh = q.data && uncertain ? q.data.at > uncertain.at : false;
  useEffect(() => {
    if (!uncertain || !trip || !fresh) return;
    const a = uncertain.action;
    const reached = a === 'arrive' ? !!trip.arrivedAt
      : a === 'unavailable' ? trip.status === 'DRIVER_UNAVAILABLE' || trip.status === 'VEHICLE_UNAVAILABLE'
        : a === 'resume' ? trip.status !== 'DELAYED'
          : trip.status === ACTION_TARGET[a as keyof typeof ACTION_TARGET];
    setUncertain(null);
    toast.show(reached ? 'Zenvy got your last change. The trip is up to date.' : 'Zenvy did not get your last change. You can try again now.', reached ? 'success' : 'info');
  }, [trip, uncertain, fresh, toast]);

  const ask = (action: DriverAction) => {
    const c = ACTION_COPY[action];
    Alert.alert(c.confirmTitle, c.confirmBody, [{ text: 'No', style: 'cancel' }, { text: 'Yes', onPress: () => { run(action); } }]);
  };

  if (q.loading && !q.data) return <Screen title="Trip" onBack={() => navigation.goBack()}><SkeletonCard lines={4} /><SkeletonCard /></Screen>;
  if (!trip) {
    const nf = q.error && /not found/i.test(q.error);
    return (
      <Screen title="Trip" onBack={() => navigation.goBack()}>
        {nf ? <EmptyState icon="search" title="Trip not found" /> : <ErrorStrip text={q.error || 'Could not load the trip.'} onRetry={q.refresh} busy={q.refreshing} />}
      </Screen>
    );
  }
  const bookings = q.data!.bookings;
  const seatInfo = driverSeatStates(q.data!.seats.seats, bookings);
  const primary = acts?.primary || null;

  return (
    <Screen
      title={trip.queueNumber ? `Trip · Queue #${trip.queueNumber}` : 'Trip'}
      onBack={() => navigation.goBack()}
      right={!terminal ? <SosButton tripId={trip.id} /> : undefined}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
      stationary={!terminal}
      footer={!terminal && tab === 'status' && primary ? (
        primary === 'check-in'
          ? <Button label="Check in a passenger" icon="qr-code" size="huge" variant="accept" onPress={() => navigation.navigate('CheckIn', { tripId: trip.id })} />
          : <Button label={ACTION_COPY[primary].label} icon={ACTION_COPY[primary].icon} size="huge" variant="accept" loading={busy === primary || !!uncertain} disabled={!!busy || !!uncertain} onPress={() => ask(primary as DriverAction)} />
      ) : undefined}
    >
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        {(['status', 'seats', 'bookings'] as Tab[]).map((t) => (
          <Chip key={t} label={t === 'status' ? 'Status' : t === 'seats' ? 'Seats' : `Bookings (${bookings.filter((b) => ['HELD', 'CONFIRMED', 'BOARDED'].includes(b.status)).length})`} selected={tab === t} onPress={() => setTab(t)} style={{ flex: 1 }} />
        ))}
      </View>
      {q.error ? <ErrorStrip text={`Showing the last loaded status. ${q.error}`} onRetry={q.refresh} busy={q.refreshing} /> : null}
      {uncertain ? <Banner tone="warn" title="Waiting for Zenvy" text="Your last tap may not have reached Zenvy. Checking the trip with Zenvy before you can tap again (pull down to retry)." /> : null}

      {tab === 'status' ? (
        <>
          <TripSummaryCard trip={trip} />
          {atStand(trip) ? (
            <Button label="Open the stand view" icon="people" variant="primary" onPress={() => navigation.navigate('Charge', { tripId: trip.id })} />
          ) : null}
          {trip.mode === 'PRIVATE' ? <Banner tone="info" text="Booked as a full auto by one group. No other passengers can book." /> : null}
          {trip.status === 'PUBLISHED' && trip.bookingOpensAt ? <Banner tone="info" text={`Booking opens at ${timeIst(trip.bookingOpensAt)}.`} /> : null}
          {trip.status === 'OPEN_FOR_BOOKING' ? <Banner tone="info" text={`You can confirm departure when ${trip.minSeatsToDepart} seat${trip.minSeatsToDepart === 1 ? ' is' : 's are'} confirmed, or when the auto is full.`} /> : null}
          {trip.status === 'BOARDING' && !trip.boardedSeats ? <Banner tone="info" text="Check in at least one passenger (booking code + PIN) before you start." /> : null}
          {trip.cancelReason ? <Banner tone="error" text={`Reason: ${trip.cancelReason}`} /> : null}
          {trip.delayReason && trip.status === 'DELAYED' ? <Banner tone="warn" text={`Delay reason: ${trip.delayReason}`} /> : null}
          {primary === 'start' ? <Button label="Check in another passenger" icon="qr-code" variant="secondary" onPress={() => navigation.navigate('CheckIn', { tripId: trip.id })} /> : null}

          <Card style={{ gap: 2 }}>
            <KeyValue k="Seat fare" v={rupees(trip.seatFare)} />
            {trip.privateBookingEnabled ? <KeyValue k="Full-auto fare" v={trip.fullAutoFare ? rupees(trip.fullAutoFare) : '—'} /> : null}
            <KeyValue k="Boarded" v={`${trip.boardedSeats} of ${trip.confirmedSeats}`} />
            <KeyValue k="Leave early with" v={`${trip.minSeatsToDepart} passengers`} />
            {trip.stops.length ? <KeyValue k="Stops" v={trip.stops.join(', ')} /> : null}
            {trip.vehicle ? <KeyValue k="Auto" v={trip.vehicle.registration || ''} /> : null}
            {trip.originalDepartureAt && trip.delayMinutes ? <KeyValue k="Planned time" v={timeIst(trip.originalDepartureAt)} /> : null}
          </Card>
          <Card style={{ gap: 2 }}>
            <Text style={[font.h3, { color: color.text }]}>Timeline</Text>
            {([['Published', trip.publishedAt], ['Departure confirmed', trip.confirmedAt], ['Boarding', trip.boardingAt], ['Started', trip.startedAt], ['Arrived', trip.arrivedAt], ['Completed', trip.completedAt]] as const)
              .filter(([, v]) => !!v).map(([k, v]) => <KeyValue key={k} k={k} v={dateTimeIst(v)} />)}
          </Card>

          {!terminal && acts ? (
            <>
              <SectionTitle text="Problems" />
              {acts.delay && trip.dispatchMode !== 'ON_CHARGE' ? <Button label="Report a delay" icon="time" variant="secondary" disabled={!!uncertain} onPress={() => setSheet('delay')} /> : null}
              {acts.cancel ? <Button label="Cancel trip" icon="close-circle" variant="rejectOutline" disabled={!!uncertain} onPress={() => setSheet('cancel')} /> : null}
              <Button label="Report a problem" icon="flag" variant="ghost" size="secondary" onPress={() => navigation.navigate('Support')} />
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'seats' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            <Badge text={`${trip.confirmedSeats}/${trip.capacity} CONFIRMED`} fg={color.openDark} bg={color.openTint} />
            <Badge text={`${trip.remainingSeats} FREE`} fg={color.text} bg={color.surfaceAlt} />
            {trip.heldSeats ? <Badge text={`${trip.heldSeats} BEING BOOKED`} fg={color.warning} bg={color.warningTint} /> : null}
            <Badge text={`${trip.boardedSeats} BOARDED`} fg={color.boarded} bg={color.boardedTint} />
          </View>
          <Card>
            <SeatMap rows={(q.data!.seats.layout || trip.seatLayout || { rows: [] }).rows} states={seatInfo.states} labels={seatInfo.labels} />
          </Card>
          <Text style={[font.small, { color: color.textMuted }]}>Seats and bookings are managed by Zenvy. Held seats are released automatically if the passenger does not confirm.</Text>
        </>
      ) : null}

      {tab === 'bookings' ? (
        <BookingsList bookings={bookings} now={now} canNoShow={!!acts?.noShow} tripId={trip.id} onChanged={q.reload} />
      ) : null}

      <DelaySheet visible={sheet === 'delay'} onClose={() => setSheet(null)} busy={busy === 'delay'} onSubmit={async (minutes, reason) => { if (await run('delay', { minutes, reason })) setSheet(null); }} />
      <CancelSheet visible={sheet === 'cancel'} onClose={() => setSheet(null)} busy={busy === 'cancel' || busy === 'unavailable'} canDriver={!!acts?.driverUnavailable} canVehicle={!!acts?.vehicleUnavailable}
        passengers={trip.confirmedSeats + trip.heldSeats}
        onSubmit={async (kind, reason) => {
          const ok = kind === 'CANCEL' ? await run('cancel', { reason }) : await run('unavailable', { kind, reason });
          if (ok) setSheet(null);
        }} />
    </Screen>
  );
}

function BookingsList({ bookings, now, canNoShow, tripId, onChanged }: { bookings: BookingDriver[]; now: number; canNoShow: boolean; tripId: string; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const live = bookings.filter((b) => ['CONFIRMED', 'BOARDED', 'COMPLETED'].includes(b.status));
  const holds = bookings.filter((b) => b.status === 'HELD');
  const closed = bookings.filter((b) => !['CONFIRMED', 'BOARDED', 'COMPLETED', 'HELD'].includes(b.status));
  const cash = live.reduce((a, b) => a + (b.cashToCollect || 0), 0);
  const noShow = (b: BookingDriver) => {
    Alert.alert(`Mark ${b.passengerName} as no-show?`, `Booking ${b.bookingCode}. Only do this if the passenger did not come to the pickup point. Their seats are freed.`, [
      { text: 'No', style: 'cancel' },
      { text: 'Mark no-show', style: 'destructive', onPress: async () => {
        setBusy(b.id);
        try { await driverApi.noShow(tripId, b.id); toast.show('Marked as no-show.', 'success'); onChanged(); } catch (e) { toast.show(errorMessage(e), 'error'); onChanged(); } finally { setBusy(null); }
      } },
    ]);
  };
  if (!bookings.length) return <EmptyState icon="people" title="No bookings yet" body="Bookings show here as soon as passengers book." />;
  return (
    <>
      {cash > 0 ? <Banner tone="warn" text={`Cash to collect at boarding: ${rupees(cash)}`} /> : null}
      <SectionTitle text={`Confirmed (${live.length})`} />
      {live.map((b) => (
        <Card key={b.id} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Text style={[font.h2, { color: color.text, flex: 1 }]}>{b.passengerName}</Text>
            <Badge text={b.status === 'BOARDED' ? 'BOARDED' : b.status === 'COMPLETED' ? 'DONE' : 'NOT BOARDED'} fg={b.status === 'CONFIRMED' ? color.warning : color.boarded} bg={b.status === 'CONFIRMED' ? color.warningTint : color.boardedTint} />
          </View>
          <Text style={[font.code, { color: color.text }]}>{b.bookingCode}</Text>
          <Text style={[font.body, { color: color.textSecondary }]}>
            {b.passengerCount} passenger{b.passengerCount === 1 ? '' : 's'} · {b.seatNumbers.length ? `seat ${b.seatNumbers.join(', ')}` : `${b.seatCount} seat${b.seatCount === 1 ? '' : 's'}`}{b.type === 'PRIVATE' ? ' · full auto' : ''}
          </Text>
          <Text style={[font.body, { color: b.cashToCollect ? color.cash : color.textSecondary, fontWeight: '700' }]}>
            {b.cashToCollect ? `Collect ${rupees(b.cashToCollect)} cash` : b.cashCollectedAt ? `Cash ${rupees(b.amount)} collected` : b.paymentMethod === 'WALLET' ? `Paid by wallet ${rupees(b.amount)}` : rupees(b.amount)}
          </Text>
          {canNoShow && b.status === 'CONFIRMED' ? <Button label="Did not come (no-show)" icon="person-remove" variant="rejectOutline" size="secondary" loading={busy === b.id} onPress={() => noShow(b)} /> : null}
        </Card>
      ))}
      {holds.length ? <SectionTitle text={`Being booked now (${holds.length})`} /> : null}
      {holds.map((b) => (
        <Card key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={[font.h3, { color: color.text }]}>{b.passengerName} · {b.seatCount} seat{b.seatCount === 1 ? '' : 's'}</Text>
            <Text style={[font.small, { color: color.textSecondary }]}>Not confirmed yet{b.holdExpiresAt ? ` · released in ${countdown(b.holdExpiresAt).text}` : ''}</Text>
          </View>
          <Badge text="HELD" fg={color.warning} bg={color.heldTint} />
        </Card>
      ))}
      {closed.length ? <SectionTitle text={`Cancelled / missed (${closed.length})`} /> : null}
      {closed.map((b) => (
        <Card key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, opacity: 0.75 }}>
          <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>{b.passengerName} · {b.bookingCode} · {b.seatCount} seat{b.seatCount === 1 ? '' : 's'}</Text>
          <Badge text={b.status.replace('_', ' ')} fg={color.textSecondary} bg={color.surfaceAlt} />
        </Card>
      ))}
      <Text style={[font.small, { color: color.textMuted }]}>Passenger phone numbers are kept private. Ask passengers to show their booking code and PIN.</Text>
    </>
  );
}

function DelaySheet({ visible, onClose, onSubmit, busy }: { visible: boolean; onClose: () => void; onSubmit: (m: number, r: string) => void; busy: boolean }) {
  const [m, setM] = useState(10);
  const [reason, setReason] = useState('');
  return (
    <Sheet visible={visible} onClose={onClose} title="How late will you be?">
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {DELAYS.map((d) => <Chip key={d} label={`${d} min`} selected={m === d} onPress={() => setM(d)} style={{ minWidth: 88, flexGrow: 1 }} />)}
        </View>
        <TextInput value={reason} onChangeText={(v) => setReason(v.slice(0, 300))} placeholder="Reason (optional), e.g. traffic at the canal" placeholderTextColor={color.textMuted}
          style={[font.body, { minHeight: 56, borderWidth: 2, borderColor: color.border, borderRadius: radius.md, padding: space.sm, color: color.text }]} accessibilityLabel="Delay reason" />
        <Text style={[font.small, { color: color.textMuted }]}>Passengers are told the new departure time.</Text>
        <Button label={`Report ${m} min delay`} icon="time" loading={busy} onPress={() => onSubmit(m, reason.trim())} />
      </View>
    </Sheet>
  );
}

function CancelSheet({ visible, onClose, onSubmit, busy, canDriver, canVehicle, passengers }: {
  visible: boolean; onClose: () => void; onSubmit: (kind: 'CANCEL' | 'DRIVER' | 'VEHICLE', reason: string) => void; busy: boolean; canDriver: boolean; canVehicle: boolean; passengers: number;
}) {
  const [kind, setKind] = useState<'CANCEL' | 'DRIVER' | 'VEHICLE'>('CANCEL');
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= 3;
  const options = useMemo(() => [
    { k: 'CANCEL' as const, label: 'Cancel this trip', show: true },
    { k: 'DRIVER' as const, label: 'I cannot drive (unwell / emergency)', show: canDriver },
    { k: 'VEHICLE' as const, label: 'Auto problem (breakdown / puncture)', show: canVehicle },
  ].filter((o) => o.show), [canDriver, canVehicle]);
  const submit = () => {
    Alert.alert('Cancel the trip?', `${passengers ? `${passengers} passenger seat${passengers === 1 ? '' : 's'} will be cancelled and told. ` : ''}This cannot be undone.`, [
      { text: 'Keep the trip', style: 'cancel' },
      { text: 'Cancel trip', style: 'destructive', onPress: () => onSubmit(kind, reason.trim()) },
    ]);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Cancel trip">
      <View style={{ gap: space.md }}>
        <View style={{ gap: space.xs }}>
          {options.map((o) => <Chip key={o.k} label={o.label} selected={kind === o.k} tone="red" onPress={() => setKind(o.k)} />)}
        </View>
        <TextInput value={reason} onChangeText={(v) => setReason(v.slice(0, 300))} placeholder="Tell passengers why (required)" placeholderTextColor={color.textMuted}
          style={[font.body, { minHeight: 56, borderWidth: 2, borderColor: ok || !reason ? color.border : color.alert, borderRadius: radius.md, padding: space.sm, color: color.text }]} accessibilityLabel="Cancel reason" />
        <Button label="Cancel trip" icon="close-circle" variant="reject" loading={busy} disabled={!ok} onPress={submit} />
      </View>
    </Sheet>
  );
}
