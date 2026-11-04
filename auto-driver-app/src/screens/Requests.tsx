// Full-auto (private) requests: a group asks to book the whole auto at the trip's full-auto fare.
// Accept / Decline before respondBy (countdown from server time). The server re-checks everything at
// accept: seats already booked -> 409 SEATS_ALREADY_BOOKED (request closed, passenger told), expired ->
// 410 REQUEST_EXPIRED. Nothing is booked until the driver accepts.
import React, { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, Chip, EmptyState, ErrorStrip, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, KeyValue, Screen } from '../ui/Screen';
import { useToast } from '../ui/Toast';
import { useLoad } from '../state/useLoad';
import { useDriverEvents } from '../state/SocketProvider';
import { useSession } from '../state/SessionProvider';
import { driverApi } from '../api/driverApi';
import { errorMessage, serverNow } from '../lib/http';
import { countdown, dateTimeIst, rupees } from '../lib/format';
import type { PrivateRequest } from '../types';
import type { ScreenProps } from '../nav';

const DECLINE = ['Auto not available then', 'Too many passengers', 'Already booked', 'Route not possible'];

export default function RequestsScreen({ navigation }: ScreenProps<'Requests'>) {
  const toast = useToast();
  const { me } = useSession();
  const [tab, setTab] = useState<'open' | 'all'>('open');
  const q = useLoad(() => driverApi.privateRequests(tab === 'open' ? 'REQUESTED' : undefined), [tab], { pollMs: 15000 });
  useDriverEvents(() => q.reload());
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PrivateRequest | null>(null);

  const accept = (r: PrivateRequest) => {
    Alert.alert('Accept this full-auto booking?', `${r.passengerName} · ${r.passengers} passenger${r.passengers === 1 ? '' : 's'} · ${rupees(r.fare)}\nThe whole auto is booked for this group. No one else can book seats.`, [
      { text: 'No', style: 'cancel' },
      { text: 'Accept', onPress: async () => {
        setBusy(r.id);
        try {
          const res = await driverApi.acceptPrivate(r.id);
          toast.show(res.booking ? `Accepted. Booking ${res.booking.bookingCode}.` : 'Accepted.', 'success');
          q.reload();
          if (res.trip?.id) navigation.navigate('TripDetail', { tripId: res.trip.id, tab: 'bookings' });
        } catch (e) {
          toast.show(errorMessage(e), 'error');
          q.reload();
        } finally { setBusy(null); }
      } },
    ]);
  };

  const list = q.data?.requests || [];
  return (
    <Screen title="Full auto requests" onBack={() => navigation.goBack()} refreshing={q.refreshing} onRefresh={q.refresh} stationary>
      {me && !me.featureEnabled ? <Banner tone="warn" text="Auto-Ride is switched off by ZENV right now, so requests cannot be accepted." /> : null}
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <Chip label="Waiting" selected={tab === 'open'} onPress={() => setTab('open')} style={{ flex: 1 }} />
        <Chip label="All" selected={tab === 'all'} onPress={() => setTab('all')} style={{ flex: 1 }} />
      </View>
      {q.loading && !q.data ? <SkeletonCard /> : null}
      {q.error && !q.data ? <ErrorStrip text={q.error} onRetry={q.refresh} busy={q.refreshing} /> : null}
      {q.data && !list.length ? <EmptyState icon="car-sport" title={tab === 'open' ? 'No requests waiting' : 'No requests yet'} body="Turn on full-auto bookings when you publish a trip to get requests." /> : null}
      {list.map((r) => {
        const cd = countdown(r.respondBy);
        const open = r.status === 'REQUESTED' && cd.ms > 0;
        return (
          <Card key={r.id} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Text style={[font.h2, { color: color.text, flex: 1 }]}>{r.passengerName}</Text>
              <Badge text={r.status === 'REQUESTED' && !open ? 'TIME UP' : r.status} fg={open ? color.warning : r.status === 'ACCEPTED' ? color.openDark : color.textSecondary} bg={open ? color.warningTint : r.status === 'ACCEPTED' ? color.openTint : color.surfaceAlt} />
            </View>
            <KeyValue k="Passengers" v={String(r.passengers)} />
            <KeyValue k="Fare (whole auto)" v={rupees(r.fare)} strong />
            <KeyValue k="Payment" v={r.paymentMethod === 'CASH' ? 'Cash at boarding' : r.paymentMethod} />
            {r.purpose ? <KeyValue k="Purpose" v={r.purpose} /> : null}
            <KeyValue k="Asked" v={dateTimeIst(r.createdAt)} />
            {open ? <Text style={[font.h3, { color: cd.ms < 120000 ? color.alertDark : color.warning }]}>Answer within {cd.text}</Text> : null}
            {open ? (
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                <Button label="Decline" variant="rejectOutline" style={{ flex: 1 }} disabled={!!busy} onPress={() => setDeclining(r)} />
                <Button label="Accept" variant="accept" style={{ flex: 1 }} loading={busy === r.id} disabled={!!busy && busy !== r.id} onPress={() => accept(r)} />
              </View>
            ) : null}
            {r.status === 'ACCEPTED' ? <Button label="Open trip" icon="open" variant="secondary" size="secondary" onPress={() => navigation.navigate('TripDetail', { tripId: r.tripId })} /> : null}
          </Card>
        );
      })}
      <Text style={[font.small, { color: color.textMuted }]}>Times shown are ZENV server times (IST). Now: {dateTimeIst(new Date(serverNow()).toISOString())}</Text>
      <DeclineSheet req={declining} onClose={() => setDeclining(null)} onDone={() => { setDeclining(null); q.reload(); }} />
    </Screen>
  );
}

function DeclineSheet({ req, onClose, onDone }: { req: PrivateRequest | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); }, [req?.id]);
  const send = async () => {
    if (!req) return;
    setBusy(true);
    try {
      await driverApi.declinePrivate(req.id, reason.trim() || undefined);
      toast.show('Declined. The passenger was told.', 'success');
      onDone();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <Sheet visible={!!req} onClose={onClose} title="Decline request">
      <View style={{ gap: space.md }}>
        <View style={{ gap: space.xs }}>
          {DECLINE.map((d) => <Chip key={d} label={d} selected={reason === d} onPress={() => setReason(reason === d ? '' : d)} />)}
        </View>
        <TextInput value={reason} onChangeText={(v) => setReason(v.slice(0, 200))} placeholder="Reason (optional)" placeholderTextColor={color.textMuted}
          style={[font.body, { minHeight: 52, borderWidth: 2, borderColor: color.border, borderRadius: radius.md, padding: space.sm, color: color.text }]} accessibilityLabel="Decline reason" />
        <Button label="Decline" variant="reject" loading={busy} onPress={send} />
      </View>
    </Sheet>
  );
}
