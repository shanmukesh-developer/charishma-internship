// Zenvy Auto-Ride: status of a full-auto request. Never says "confirmed" before the driver ACCEPTED it.
// REQUESTED (driver answers by respondBy) -> ACCEPTED (booking created) | DECLINED | CONFLICT | EXPIRED | CANCELLED.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert } from 'react-native';
import { PressScale } from '../../../modules/others/motion';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  autoRideApi, AutoRideError, errorCopy, inr, fmtDeparture, mmss, PRIVATE_STATUS_META, PAYMENT_LABEL, type PrivateRequest, type Trip,
} from '../../../modules/autoRide/autoRideApi';
import { AHeader, usePalette, Card, Btn, Badge, StateView, Notice, Row, useAutoRideLive, useNow, AUTO_HOME } from '../../../modules/autoRide/ui';

export default function FullAutoRequestStatusScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [req, setReq] = useState<PrivateRequest | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<AutoRideError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const waiting = req?.status === 'REQUESTED';
  const now = useNow(1000, waiting);

  const load = useCallback(async () => {
    try {
      const r = await autoRideApi.privateRequest(id);
      setReq(r.request);
      setError(null);
      // Trip details are only for context; they may be unavailable while the feature is off.
      autoRideApi.trip(r.request.tripId).then((t) => setTrip(t.trip)).catch(() => {});
    } catch (e: any) {
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load this request.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useAutoRideLive(() => load());
  // Accept / decline / conflict / expiry / cancel arrive as socket nudges (useAutoRideLive above); a slow
  // poll while waiting only covers a dropped socket.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [waiting, load]);
  // Past respondBy: ask the server (the lifecycle job marks it EXPIRED).
  const left = req?.respondBy ? new Date(req.respondBy).getTime() - now : 0;
  useEffect(() => { if (waiting && left <= 0 && req?.respondBy) { const t = setTimeout(load, 4000); return () => clearTimeout(t); } return undefined; }, [waiting, left <= 0, load, req?.respondBy]);

  const cancel = () => {
    if (!req) return;
    Alert.alert('Cancel this request?', 'The driver will no longer see it.', [
      { text: 'Keep waiting', style: 'cancel' },
      {
        text: 'Cancel request', style: 'destructive', onPress: async () => {
          setBusy(true);
          try { const r = await autoRideApi.cancelPrivate(req.id); setReq(r.request); } catch (e: any) { const c = errorCopy(e); Alert.alert(c.title, c.message); load(); } finally { setBusy(false); }
        },
      },
    ]);
  };

  if (!req) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <AHeader title="Full-auto request" />
        {error ? <StateView kind={error.status === 404 ? 'empty' : 'error'} title={error.status === 404 ? 'Request not found' : 'Could not load'} message={error.message}
          actionLabel={error.status === 404 ? 'My auto bookings' : 'Retry'} onAction={error.status === 404 ? () => router.replace(`${AUTO_HOME}&seg=bookings` as any) : load} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const m = PRIVATE_STATUS_META[req.status];
  const hero = {
    REQUESTED: { icon: '⏳', title: 'Waiting for the driver', body: req.note || 'Nothing is booked until the driver accepts.' },
    ACCEPTED: { icon: '✅', title: 'Driver accepted: full auto booked', body: 'Your booking code and PIN are on the booking.' },
    DECLINED: { icon: '✕', title: 'The driver declined', body: req.declineReason || 'Nothing was charged. Try another auto.' },
    CONFLICT: { icon: '⚠️', title: 'Could not be booked', body: req.declineReason || 'Seats on this auto were booked first. Nothing was charged.' },
    EXPIRED: { icon: '⌛', title: 'Request expired', body: 'The driver did not answer in time. Nothing was charged.' },
    CANCELLED: { icon: '✕', title: 'Request cancelled', body: req.declineReason || 'You cancelled this request.' },
  }[req.status];

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <AHeader title="Full-auto request" subtitle={trip ? `${trip.pickup?.name || 'Pickup'} → ${trip.destination || ''}` : undefined} right={<Badge label={m.label.toUpperCase()} color={m.color} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        <Card style={{ alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: `${m.color}1F` }}>
            <Ionicons name={req.status === 'ACCEPTED' ? 'checkmark-circle' : req.status === 'REQUESTED' ? 'time-outline' : req.status === 'CONFLICT' ? 'alert-circle-outline' : 'close-circle-outline'} size={34} color={m.color} />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '900', color: p.text, marginTop: 4, textAlign: 'center' }}>{hero.title}</Text>
          <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 6, textAlign: 'center', lineHeight: 18 }}>{hero.body}</Text>
          {waiting && req.respondBy ? (
            <View style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: p.warnSoft }} accessibilityLiveRegion="polite"
              accessibilityLabel={left > 0 ? `Driver answers within ${mmss(left)}` : 'Checking for the driver answer'}>
              <Text style={{ fontWeight: '900', color: p.warn, fontSize: 14 }}>{left > 0 ? `Driver answers within ${mmss(left)}` : 'Checking…'}</Text>
            </View>
          ) : null}
        </Card>

        <Card>
          <Row label="Passengers" value={`${req.passengers}`} />
          {req.extraCharges ? <Row label={`Extra charges${req.extraCharges.note ? ` (${req.extraCharges.note})` : ''}`} value={`incl. ${inr(req.extraCharges.amount)}`} /> : null}
          <Row label="Full auto fare" value={inr(req.fare)} strong />
          <Row label="Payment" value={PAYMENT_LABEL[req.paymentMethod] || req.paymentMethod} />
          {req.purpose ? <Row label="Purpose" value={req.purpose} /> : null}
          {trip ? <Row label="Departure" value={fmtDeparture(trip.departureAt)} /> : null}
          {trip ? <Row label="Driver" value={trip.driver?.name || 'Driver'} /> : null}
        </Card>

        {req.status === 'ACCEPTED' && req.bookingId ? (
          <Btn label="Open my booking" icon="🎫" onPress={() => router.replace(`/auto-ride/booking/${req.bookingId}` as any)} />
        ) : null}
        {waiting ? (
          <>
            <Notice tone="info">You will get a notification when the driver answers. You can leave this screen.</Notice>
            <Btn label="Cancel request" kind="danger" onPress={cancel} loading={busy} />
          </>
        ) : null}
        {['DECLINED', 'CONFLICT', 'EXPIRED', 'CANCELLED'].includes(req.status) ? (
          <Btn label="Find another auto" onPress={() => router.replace(AUTO_HOME as any)} />
        ) : null}
      </ScrollView>
    </View>
  );
}
