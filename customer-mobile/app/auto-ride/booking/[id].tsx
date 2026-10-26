// Zenvy Auto-Ride: one booking of mine. Booking code + boarding PIN, seats, trip status timeline, driver contact
// (only when the server returns it), pickup instructions, cancel (refund info from the server) and report a problem.
// ZCS Auto at the stand: a live "Reach the auto in 12:40" countdown (server arriveBy); a seat not checked in by then
// is released by the server as a no-show.
// The journey (modules/autoRide/BookingJourney): one "what to do now" card + the steps Booked -> Go to the auto ->
// Show your PIN to the driver -> Checked in -> On the way -> Reached, from the server's booking + trip state. When
// the auto is leaving and they are not checked in: "Show PIN 1234 to the driver now". Not checked in (NO_SHOW): what
// happened and what to do (the driver can still check them in with the PIN for a while; else Report a problem).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, Linking, Modal, TouchableOpacity } from 'react-native';
import { PressScale } from '../../../modules/others/motion';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import {
  autoRideApi, AutoRideError, errorCopy, inr, fmtDeparture, fmtClock, fromNow, mmss, queueLabel, BOOKING_STATUS_META, PAYMENT_LABEL,
  PAYMENT_STATUS_LABEL, TIMELINE, EXCEPTION_STATUSES, INCIDENT_CATEGORIES, type Booking,
} from '../../../modules/autoRide/autoRideApi';
import { AHeader, usePalette, Card, Btn, Badge, StateView, Notice, Row, Field, Chips, StatusChip, VerifiedBadge, useAutoRideLive, useAutoRideStatus, useNow, AUTO_HOME, AutoTile } from '../../../modules/autoRide/ui';
import { currentStep, JourneyNow, JourneySteps, MissedCard } from '../../../modules/autoRide/BookingJourney';

export default function AutoBookingScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState<AutoRideError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [category, setCategory] = useState<string>('OTHER');
  const [desc, setDesc] = useState('');
  const now = useNow(1000, b?.status === 'HELD' || (b?.status === 'CONFIRMED' && !!b?.arriveBy) || (b?.status === 'NO_SHOW' && !!b?.lateCheckInUntil));
  const settings = useAutoRideStatus()?.settings || null;

  const load = useCallback(async () => {
    try {
      const r = await autoRideApi.booking(id);
      setB(r.booking);
      setError(null);
    } catch (e: any) {
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load this booking.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useAutoRideLive((e) => { if (!e.id || e.id === id || e.id === b?.tripId || e.kind === 'reconnect') load(); });

  if (!b) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <AHeader title="Auto booking" />
        {error ? <StateView kind={error.status === 404 ? 'empty' : 'error'} title={error.status === 404 ? 'Booking not found' : error.isNetwork ? 'You seem to be offline' : 'Could not load'} message={error.message}
          actionLabel={error.status === 404 ? 'My auto bookings' : 'Retry'} onAction={error.status === 404 ? () => router.replace(`${AUTO_HOME}&seg=bookings` as any) : load} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const t = b.trip;
  const m = BOOKING_STATUS_META[b.status];
  const tripStatus = t?.status;
  const exception = tripStatus && EXCEPTION_STATUSES.includes(tripStatus);
  const activeIdx = tripStatus ? TIMELINE.findIndex((x) => x.statuses.includes(tripStatus === 'DELAYED' ? 'OPEN_FOR_BOOKING' : tripStatus)) : -1;
  const canCancel = (b.status === 'HELD' || b.status === 'CONFIRMED') && !!tripStatus && !['BOARDING', 'IN_PROGRESS', 'COMPLETED', ...EXCEPTION_STATUSES].includes(tripStatus);
  const afterDriverConfirm = tripStatus === 'DRIVER_CONFIRMED';
  const holdLeft = b.holdExpiresAt ? new Date(b.holdExpiresAt).getTime() - now : 0;
  const arriveLeft = b.status === 'CONFIRMED' && b.arriveBy ? new Date(b.arriveBy).getTime() - now : null;
  const arriveUrgent = arriveLeft !== null && arriveLeft <= 5 * 60 * 1000;
  const step = currentStep(b);
  const reportMissed = () => {
    setCategory('OTHER');
    if (!desc.trim()) setDesc('I was in the auto, but the driver did not check me in.');
    setReport(true);
  };

  const doCancel = () => {
    const held = b.status === 'HELD';
    // Refund % from GET /status settings (the server applies the same policy); generic copy if unknown.
    const pct = settings ? (afterDriverConfirm ? settings.refundAfterDriverConfirmPct : settings.refundBeforeDriverConfirmPct) : null;
    const walletNote = b.paymentMethod === 'WALLET'
      ? (pct !== null && pct !== undefined
        ? `${pct >= 100 ? 'You get the full' : pct <= 0 ? 'No' : `You get ${pct}% of the`} wallet payment${pct > 0 ? ` back (${inr((b.amount * pct) / 100)})` : ' is refunded'}${afterDriverConfirm ? ' because the driver has already confirmed departure' : ''}.`
        : (afterDriverConfirm ? 'The driver has already confirmed departure, so the refund may be reduced under the Zenvy refund policy.' : 'Your wallet payment is refunded under the Zenvy refund policy.'))
      : 'This is a cash booking, so nothing is charged.';
    Alert.alert(held ? 'Release held seats?' : 'Cancel this booking?', held ? 'The seats go back to other passengers.' : `${walletNote} The seats go back to other passengers.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: held ? 'Release' : 'Cancel booking', style: 'destructive', onPress: async () => {
          setBusy('cancel');
          try {
            const r = held ? await autoRideApi.release(b.id) : await autoRideApi.cancel(b.id);
            setB(r.booking);
            const nb = r.booking;
            if (!held) {
              Alert.alert('Booking cancelled', nb.refundAmount > 0
                ? `${inr(nb.refundAmount)} ${nb.status === 'REFUNDED' ? 'is back in' : 'will be refunded to'} your Zenvy Wallet.`
                : nb.paymentStatus ? PAYMENT_STATUS_LABEL[nb.paymentStatus] || 'Done.' : 'Done.');
            }
          } catch (e: any) {
            const c = errorCopy(e);
            Alert.alert(c.title, c.message);
            load();
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const sendReport = async () => {
    if (desc.trim().length < 5) { Alert.alert('Add details', 'Describe what happened (at least 5 characters).'); return; }
    setBusy('report');
    try {
      const r = await autoRideApi.incident(b.id, category, desc.trim());
      setReport(false);
      setDesc('');
      Alert.alert('Reported', r.message);
    } catch (e: any) {
      const c = errorCopy(e);
      Alert.alert(c.title, c.message);
    } finally {
      setBusy(null);
    }
  };

  const callDriver = () => {
    const digits = String(b.driverPhone || '').replace(/\D/g, '');
    if (!digits) return;
    Linking.openURL(`tel:${digits}`).catch(() => Alert.alert('Could not open', 'Calling is not available on this device.'));
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <AHeader title={`Booking ${b.bookingCode}`} subtitle={b.type === 'PRIVATE' ? 'Full auto · Zenvy Auto' : 'Shared auto · Zenvy Auto'} right={<Badge label={m.label} color={m.color} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        {exception ? <Notice tone="danger">⚠️ {t?.statusLabel}. {b.cancelReason || ''} {b.refundAmount > 0 ? `Refund: ${inr(b.refundAmount)} to your Zenvy Wallet.` : ''}</Notice> : null}
        {tripStatus === 'DELAYED' ? <Notice tone="warn">⚠️ The auto is delayed{t?.delayMinutes ? ` by ${t.delayMinutes} min` : ''}. New departure: {fmtDeparture(t?.departureAt)}.</Notice> : null}
        {b.status === 'HELD' ? (
          <Notice tone="warn">⏳ Seats held, not booked yet{holdLeft > 0 ? `: confirm within ${mmss(holdLeft)}` : ' (expired)'}. <Text style={{ fontWeight: '900', color: p.accent }} onPress={() => router.push(`/auto-ride/trip/${b.tripId}` as any)}>Finish booking ›</Text></Notice>
        ) : null}
        {step ? <JourneyNow b={b} step={step} now={now} /> : null}
        {b.status === 'NO_SHOW' ? <MissedCard b={b} now={now} onReport={reportMissed} /> : null}

        {(b.status === 'CONFIRMED' || b.status === 'BOARDED') ? (
          <Card style={{ alignItems: 'center' }}>
            {arriveLeft !== null ? (
              <View style={{ alignItems: 'center', marginBottom: 12 }}>
                <View accessibilityLiveRegion="polite" accessibilityLabel={arriveLeft > 0 ? `Reach the auto in ${mmss(arriveLeft)}` : 'Your time to reach the auto is up'}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: arriveUrgent ? p.dangerSoft : p.warnSoft }}>
                  <Ionicons name="time-outline" size={15} color={arriveUrgent ? p.danger : p.warn} />
                  <Text style={{ fontSize: 14, fontWeight: '800', color: arriveUrgent ? p.danger : p.warn, fontVariant: ['tabular-nums'] }}>
                    {arriveLeft > 0 ? `Reach the auto in ${mmss(arriveLeft)}` : 'Releasing your seat'}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: p.sub, textAlign: 'center', marginTop: 6, maxWidth: 300 }}>
                  Check in with the driver within {b.arrivalWindowMinutes || 15} minutes of booking, or your seat is released.
                </Text>
              </View>
            ) : null}
            <Text style={{ fontSize: 12, fontWeight: '900', color: p.sub, letterSpacing: 1 }}>BOOKING CODE</Text>
            <Text selectable style={{ fontSize: 28, fontWeight: '900', color: p.text, letterSpacing: 4, marginTop: 2 }}>{b.bookingCode}</Text>
            {b.boardingPin ? (
              <>
                <Text style={{ fontSize: 12, fontWeight: '900', color: p.accent, letterSpacing: 1, marginTop: 12 }}>BOARDING PIN</Text>
                <Text style={{ fontSize: 40, fontWeight: '900', color: p.text, letterSpacing: 12 }} accessibilityLabel={`Boarding PIN ${b.boardingPin.split('').join(' ')}`}>{b.boardingPin}</Text>
                <Text style={{ fontSize: 12, color: p.sub, textAlign: 'center' }}>Show the code and PIN to the driver when you board.</Text>
              </>
            ) : b.status === 'BOARDED' ? (
              <Text style={{ fontSize: 12, color: p.success, fontWeight: '800', marginTop: 8 }}>Checked in{b.boardedAt ? ` at ${fmtClock(b.boardedAt)}` : ''}</Text>
            ) : (
              <Text style={{ fontSize: 12, color: p.sub, marginTop: 8, textAlign: 'center' }}>Your PIN will appear here before boarding.</Text>
            )}
          </Card>
        ) : null}

        {b.pickupInstructions ? <Notice tone="info">📍 {b.pickupInstructions}</Notice> : null}

        {t ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <AutoTile size={40} />
              <Text style={{ fontSize: 15, fontWeight: '800', color: p.text }}>{b.type === 'PRIVATE' ? 'Full auto' : 'Shared auto'} · {queueLabel(t.queueNumber)}</Text>
              <View style={{ flex: 1 }} />
              <StatusChip trip={t} />
            </View>
            <Row label="From" value={t.pickup?.name || t.route?.origin || '—'} />
            <Row label="To" value={t.destination || t.route?.destination || '—'} />
            <Row label="Departure" value={`${fmtDeparture(t.departureAt)}${fromNow(t.departureAt, Date.now()) && !exception ? ` (${fromNow(t.departureAt)})` : ''}`} strong />
            <Row label="Driver" value={t.driver?.name || 'Driver'} />
            <View style={{ alignItems: 'flex-end', marginTop: -2 }}><VerifiedBadge verified={!!t.driver?.verified} /></View>
            <Row label="Auto" value={`${t.vehicle?.registration || '—'}${[t.vehicle?.colour, t.vehicle?.make, t.vehicle?.model].filter(Boolean).length ? ` · ${[t.vehicle?.colour, t.vehicle?.make, t.vehicle?.model].filter(Boolean).join(' ')}` : ''}`} />
            {t.pickup?.mapsUrl ? <Btn label="Pickup in Maps" icon="🗺️" kind="secondary" small style={{ marginTop: 10 }} onPress={() => Linking.openURL(t.pickup!.mapsUrl!).catch(() => Alert.alert('Could not open maps'))} /> : null}
            {b.driverPhone ? <Btn label="Call driver" icon="📞" kind="secondary" small style={{ marginTop: 8 }} onPress={callDriver} /> : null}
          </Card>
        ) : null}

        {/* The journey steps; other bookings (hold, ...) keep the plain trip status timeline */}
        {t && !exception && step ? <JourneySteps b={b} step={step} /> : null}
        {t && !exception && !step && b.status !== 'NO_SHOW' ? (
          <Card>
            <Text style={{ fontSize: 14, fontWeight: '900', color: p.text, marginBottom: 10 }}>Trip status</Text>
            {TIMELINE.map((x, i) => {
              const doneStep = activeIdx >= 0 && i < activeIdx;
              const current = i === activeIdx;
              return (
                <View key={x.key} style={{ flexDirection: 'row', gap: 10, minHeight: 34 }} accessibilityLabel={`${x.label}${current ? ', current' : doneStep ? ', done' : ''}`}>
                  <View style={{ alignItems: 'center', width: 18 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: doneStep || current ? p.button : p.border, backgroundColor: doneStep ? p.button : current ? p.accentSoft : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {doneStep ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
                    </View>
                    {i < TIMELINE.length - 1 ? <View style={{ width: 2, flex: 1, backgroundColor: doneStep ? p.button : p.border }} /> : null}
                  </View>
                  <View style={{ flex: 1, paddingBottom: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: current ? '900' : '700', color: doneStep || current ? p.text : p.muted }}>{x.label}</Text>
                    {current ? <Text style={{ fontSize: 12, color: p.sub }}>{t.statusLabel}</Text> : null}
                  </View>
                </View>
              );
            })}
            <Text style={{ fontSize: 12, color: p.muted }}>The trip moves to "On the way" only after the driver starts it. Live location is not shown.</Text>
          </Card>
        ) : null}

        <Card>
          <Row label="Seats" value={`${b.seatCount}${b.type === 'SHARED' && b.seatNumbers.length ? ` (no. ${b.seatNumbers.join(', ')})` : ''}`} />
          {b.type === 'SHARED' && b.fareBreakdown.seats ? <Row label={`${b.fareBreakdown.seats} × ${inr(b.fareBreakdown.seatFare)}`} value={inr(b.fareBreakdown.total)} /> : null}
          {b.type === 'PRIVATE' && b.fareBreakdown.extraCharges ? (
            <>
              <Row label="Full auto fare" value={inr(b.fareBreakdown.baseFare ?? b.amount)} />
              <Row label={`Extra charges${b.fareBreakdown.extraCharges.note ? ` (${b.fareBreakdown.extraCharges.note})` : ''}`} value={inr(b.fareBreakdown.extraCharges.amount)} />
            </>
          ) : b.type === 'PRIVATE' ? <Row label="Full auto fare" value={inr(b.fareBreakdown.fare ?? b.amount)} /> : null}
          <Row label="Total" value={inr(b.amount)} strong />
          <Row label="Payment" value={b.paymentMethod === 'CASH' ? 'Cash to the driver at boarding' : b.paymentMethod ? PAYMENT_LABEL[b.paymentMethod] : '—'} />
          {b.paymentStatus ? <Row label="Payment status" value={PAYMENT_STATUS_LABEL[b.paymentStatus] || b.paymentStatus} /> : null}
          {b.refundAmount > 0 ? <Row label="Refund" value={`${inr(b.refundAmount)}${b.refundedAt ? ' · done' : ' · pending'}`} /> : null}
          {b.cancelledAt ? <Row label="Cancelled" value={`${b.cancelledBy ? `by ${b.cancelledBy}` : ''}${b.cancelReason ? ` · ${b.cancelReason}` : ''}`} /> : null}
        </Card>

        {canCancel ? (
          <>
            <Text style={{ fontSize: 12, color: p.muted, marginBottom: 8 }}>
              {b.status === 'HELD' ? 'Releasing a hold is free.' : b.paymentMethod === 'WALLET' ? 'Cancel before the driver confirms departure for the best refund; the server applies the Zenvy refund policy.' : 'Cash booking: cancelling costs nothing. You cannot cancel once boarding starts.'}
            </Text>
            <Btn label={b.status === 'HELD' ? 'Release seats' : 'Cancel booking'} kind="danger" onPress={doCancel} loading={busy === 'cancel'} />
          </>
        ) : null}
        <Btn label="Report a problem" icon="🚩" kind="secondary" style={{ marginTop: 10 }} onPress={() => setReport(true)} />
        <Text style={{ fontSize: 12, color: p.muted, textAlign: 'center', marginTop: 10 }}>In danger? Call 112 immediately.</Text>
      </ScrollView>

      <Modal visible={report} transparent animationType="slide" onRequestClose={() => setReport(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: p.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 28 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '900', color: p.text }}>Report a problem</Text>
              <PressScale onPress={() => setReport(false)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}><Ionicons name="close" size={22} color={p.sub} /></PressScale>
            </View>
            <Chips value={category} onChange={(v: string) => setCategory(v)} options={INCIDENT_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} />
            <View style={{ height: 12 }} />
            <Field label="What happened?" value={desc} onChangeText={(x) => setDesc(x.slice(0, 2000))} multiline placeholder="Tell the Zenvy team what happened" />
            {category === 'SAFETY' || category === 'HARASSMENT' ? <Notice tone="danger">If you are in danger, call 112 now.</Notice> : null}
            <Btn label="Send report" onPress={sendReport} loading={busy === 'report'} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
