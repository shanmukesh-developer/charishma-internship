// Zenvy Auto-Ride: request the whole auto (private / full-auto booking). The request reserves nothing until the
// driver accepts; then the server books every seat as one booking. Fare, capacity and rules come from the server.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { PressScale } from '../../../modules/others/motion';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { useAuth } from '../../../context/AuthContext';
import {
  autoRideApi, AutoRideError, newIdempotencyKey, errorCopy, inr, fmtDeparture, queueLabel, PAYMENT_LABEL, type Trip, type PaymentMethod,
} from '../../../modules/autoRide/autoRideApi';
import { AHeader, usePalette, Card, Btn, StateView, Notice, Row, Field, Stepper, StatusChip, VerifiedBadge, refreshAutoRideStatus, AUTO_HOME } from '../../../modules/autoRide/ui';

const maskPhone = (ph?: string | null) => {
  const d = String(ph || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 2)}••••${d.slice(-4)}` : null;
};

export default function FullAutoRequestScreen() {
  const params = useLocalSearchParams<{ tripId: string | string[] }>();
  const tripId = String(Array.isArray(params.tripId) ? params.tripId[0] : params.tripId || '');
  const router = useRouter();
  const p = usePalette();
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<AutoRideError | null>(null);
  const [passengers, setPassengers] = useState(1);
  const [purpose, setPurpose] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>(['CASH']);
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await autoRideApi.trip(tripId);
      setTrip(r.trip);
      setError(null);
    } catch (e: any) {
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load this auto.'));
    }
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    refreshAutoRideStatus().then((s) => { const l = s.paymentMethods.length ? s.paymentMethods : (['CASH'] as PaymentMethod[]); setMethods(l); if (!l.includes('CASH')) setPayment(l[0]); }).catch(() => {});
  }, []);

  const submit = async () => {
    if (busy || !trip) return;
    if (!key.current) key.current = newIdempotencyKey();
    setBusy(true);
    setRetry(null);
    try {
      const r = await autoRideApi.requestPrivate(trip.id, { passengers, purpose: purpose.trim() || undefined, paymentMethod: payment }, key.current);
      router.replace(`/auto-ride/request/${r.request.id}` as any);
    } catch (e: any) {
      const err: AutoRideError = e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Please try again.');
      if (err.isNetwork) { setRetry(err.message); return; } // same key on retry: never two requests
      key.current = null;
      const { title, message } = errorCopy(err);
      if (err.code === 'PHONE_REQUIRED') {
        Alert.alert(title, message, [{ text: 'Later', style: 'cancel' }, { text: 'Open profile', onPress: () => router.push('/(tabs)/profile' as any) }]);
      } else if (err.code === 'PAYMENT_METHOD_OFF') {
        setPayment('CASH');
        Alert.alert(title, message);
      } else {
        if (['SEATS_ALREADY_BOOKED', 'TRIP_PRIVATE', 'TRIP_FULL', 'BOOKING_CLOSED', 'PRIVATE_OFF'].includes(err.code)) load();
        Alert.alert(title, message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!trip) {
    const off = error?.code === 'FEATURE_OFF';
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <AHeader title="Book full auto" />
        {error ? <StateView kind={off || error.status === 404 ? 'empty' : 'error'} icon={off ? '🛺' : undefined} title={off ? 'ZCS Auto is not open yet' : error.status === 404 ? 'Auto not found' : 'Could not load'} message={error.message}
          actionLabel={off || error.status === 404 ? 'Back to autos' : 'Retry'} onAction={off || error.status === 404 ? () => router.replace(AUTO_HOME as any) : load} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const phone = maskPhone((user as any)?.phone);
  const name = String((user as any)?.name || '').trim();
  const allowed = trip.privateBookingAllowed && !!trip.fullAutoFare;
  // Server total (fare + driver's extra charges); older servers send only fullAutoFare.
  const total = trip.fullAutoTotal ?? ((trip.fullAutoFare || 0) + (trip.extraCharges?.amount || 0));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }}>
      <AHeader title="Book the full auto" subtitle={`${queueLabel(trip.queueNumber)} · ${fmtDeparture(trip.departureAt)}`} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: 10 }}><StatusChip trip={trip} /></View>
        {!allowed ? (
          <Notice tone="warn">This auto cannot be booked as a full auto right now{trip.confirmedSeats + trip.heldSeats > 0 ? ' because some seats are already booked' : trip.fullAutoFare ? '' : ': the driver does not offer full-auto booking on this trip'}. You can book seats instead or pick another auto.</Notice>
        ) : null}

        <Card>
          <Row label="Route" value={`${trip.pickup?.name || trip.route?.origin || 'Pickup'} → ${trip.destination || '—'}`} />
          <Row label="Requested time" value={fmtDeparture(trip.departureAt)} />
          <Row label="Driver" value={<Text>{trip.driver?.name || 'Driver'} </Text>} />
          <View style={{ alignItems: 'flex-end', marginTop: -2, marginBottom: 4 }}><VerifiedBadge verified={!!trip.driver?.verified} /></View>
          <Row label="Capacity" value={`${trip.capacity} passenger seats`} />
          <View style={{ height: 1, backgroundColor: p.border, marginVertical: 8 }} />
          <Row label="Full auto fare (whole trip)" value={trip.fullAutoFare ? inr(trip.fullAutoFare) : 'Not offered'} strong={!trip.extraCharges} />
          {trip.extraCharges ? (
            <>
              <Row label={`Extra charges${trip.extraCharges.note ? ` (${trip.extraCharges.note})` : ''}`} value={inr(trip.extraCharges.amount)} />
              <Row label="Total for the full auto" value={inr(total)} strong />
            </>
          ) : <Row label="Extra charges" value="None" />}
          <Text style={{ fontSize: 12, color: p.muted, marginTop: 4 }}>The fare is fixed by the server when you send the request. Shared seat fare on this auto: {inr(trip.seatFare)}.</Text>
        </Card>

        <Card>
          <Text style={{ fontSize: 14, fontWeight: '900', color: p.text, marginBottom: 10 }}>Your group</Text>
          <Stepper value={passengers} min={1} max={Math.max(1, trip.capacity)} onChange={setPassengers} label="Passengers" />
          <View style={{ height: 14 }} />
          <Field label="Purpose (optional)" value={purpose} onChangeText={(t) => setPurpose(t.slice(0, 200))} placeholder="e.g. Group trip to Vijayawada station" maxLength={200} hint={`${purpose.length}/200 · shared with the driver`} />
          <Text style={{ fontSize: 12, fontWeight: '900', color: p.sub, letterSpacing: 0.8, marginBottom: 6 }}>CONTACT (FROM YOUR PROFILE)</Text>
          <Text style={{ fontSize: 13, color: p.text, fontWeight: '700' }}>{name || 'Your ZCS account'}{phone ? ` · ${phone}` : ''}</Text>
          {!phone ? <Text style={{ fontSize: 12, color: p.danger, marginTop: 4 }}>A verified mobile number on your profile is needed to book.</Text> : <Text style={{ fontSize: 12, color: p.muted, marginTop: 2 }}>Your number is not shown to the driver; they see your first name only.</Text>}
        </Card>

        <Card>
          <Text style={{ fontSize: 15, fontWeight: '800', color: p.text, marginBottom: 8 }}>Payment</Text>
          {methods.length <= 1 && (methods[0] || 'CASH') === 'CASH' ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.accentSoft }}>
              <Ionicons name="cash-outline" size={20} color={p.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: p.text }}>Pay the driver in cash when you board</Text>
                <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>Nothing is charged in the app.</Text>
              </View>
            </View>
          ) : methods.map((m) => {
            const on = payment === m;
            return (
              <PressScale key={m} onPress={() => setPayment(m)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={PAYMENT_LABEL[m]}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: on ? p.accent : p.border, backgroundColor: on ? p.accentSoft : p.card2, marginBottom: 8, minHeight: 48 }}>
                <Ionicons name={m === 'CASH' ? 'cash-outline' : 'wallet-outline'} size={20} color={on ? p.accent : p.sub} />
                <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '900', color: p.text }}>{PAYMENT_LABEL[m]}</Text>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? p.accent : p.muted} />
              </PressScale>
            );
          })}
        </Card>

        <Notice tone="info">
          How it works: the driver must accept your request (they get a few minutes to answer). Nothing is booked or charged until they accept. If someone books a seat first, the request cannot be served and you are told at once.
          {'\n'}Cancellation: you can cancel a waiting request any time. After acceptance you can cancel until the driver confirms departure{payment === 'WALLET' ? '; wallet refunds follow the ZCS refund policy shown on the booking' : '; cash is paid only at boarding'}.
        </Notice>

        {retry ? <Notice tone="warn">📶 {retry} Tap Retry: it is safe, you will not send two requests.</Notice> : null}
        <Btn label={retry ? 'Retry request' : `Request full auto · ${inr(total)}`} icon="🔒" onPress={submit} loading={busy} disabled={!allowed} />
        <Btn label="Book seats instead" kind="secondary" style={{ marginTop: 10 }} onPress={() => router.replace(`/auto-ride/trip/${trip.id}` as any)} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
