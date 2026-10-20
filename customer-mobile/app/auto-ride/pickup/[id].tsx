// Zenvy Auto-Ride: one pickup point (stand set by the Zenvy admin) and its live queue for a day.
// Queue numbers show the order autos checked in; the departure order can differ. No device location is used.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Linking, Alert, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { autoRideApi, AutoRideError, istDate, istDayLabel, fmtClock, queueLabel, inr, type QueueEntry, type PickupBrief } from '../../../modules/autoRide/autoRideApi';
import { AHeader, usePalette, Card, Btn, StateView, Notice, Chips, StatusChip, VerifiedBadge, useAutoRideLive, useNow, AUTO_HOME } from '../../../modules/autoRide/ui';

const ENDED = ['COMPLETED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW', 'DRIVER_UNAVAILABLE', 'VEHICLE_UNAVAILABLE'];

export default function PickupQueueScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const now = useNow(30000);
  const [date, setDate] = useState(istDate(0));
  const [data, setData] = useState<{ pickupPoint: PickupBrief; queue: QueueEntry[]; note: string; date: string } | null>(null);
  const [error, setError] = useState<AutoRideError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await autoRideApi.queue(id, date);
      setData(r);
      setError(null);
    } catch (e: any) {
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load the queue.'));
    }
  }, [id, date]);
  useEffect(() => { load(); }, [load]);
  useAutoRideLive(() => load());

  if (!data) {
    const off = error?.code === 'FEATURE_OFF';
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <AHeader title="Pickup point" />
        {error ? <StateView kind={off || error.status === 404 ? 'empty' : 'error'} icon={off ? '🛺' : '📍'} title={off ? 'Zenvy Auto is not open yet' : error.status === 404 ? 'Pickup point not found' : error.isNetwork ? 'You seem to be offline' : 'Could not load'}
          message={error.message} actionLabel={off || error.status === 404 ? 'Back' : 'Retry'} onAction={off || error.status === 404 ? () => router.replace(`${AUTO_HOME}&seg=pickups` as any) : load} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const pt = data.pickupPoint;
  const mapsUrl = pt.mapsUrl || (pt.lat !== null && pt.lon !== null ? `https://www.google.com/maps/search/?api=1&query=${pt.lat},${pt.lon}` : null);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <AHeader title={pt.name} subtitle={pt.landmark || 'Zenvy auto stand'} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        {mapsUrl ? <Btn label="Open in Maps" icon="🗺️" kind="secondary" onPress={() => Linking.openURL(mapsUrl).catch(() => Alert.alert('Could not open maps'))} style={{ marginBottom: 12 }} /> : null}
        <Chips wrap={false} value={date} onChange={(v: string) => setDate(v)} options={[0, 1, 2].map((i) => ({ key: istDate(i), label: istDayLabel(istDate(i)) }))} />
        <View style={{ height: 12 }} />
        <Notice tone="info">ℹ️ {data.note}</Notice>
        {error ? <Notice tone="warn">⚠️ {error.message}</Notice> : null}

        <Text style={{ fontSize: 11, fontWeight: '900', color: p.sub, letterSpacing: 1, marginBottom: 8 }}>LIVE QUEUE · {istDayLabel(data.date).toUpperCase()}</Text>
        {data.queue.length === 0 ? (
          <StateView kind="empty" icon="🛺" title="No autos in the queue" message="No auto has checked in at this stand for this day yet. Pull down to refresh." />
        ) : data.queue.map((q) => {
          const ended = ENDED.includes(q.status);
          return (
            <TouchableOpacity key={q.id} activeOpacity={0.9} onPress={() => router.push(`/auto-ride/trip/${q.id}` as any)} accessibilityRole="button"
              accessibilityLabel={`${queueLabel(q.queueNumber)}, ${q.statusLabel}, ${q.confirmedSeats} of ${q.capacity} booked`}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: ended ? 0.6 : 1 }}>
                <View style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: ended ? p.card2 : '#FACC15', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: '#1F2937' }}>AUTO</Text>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: '#1F2937' }}>{String(q.queueNumber || 0).padStart(2, '0')}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: p.text }}>{q.confirmedSeats}/{q.capacity}</Text>
                    <Text style={{ fontSize: 11.5, color: p.sub }}>booked</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={{ fontSize: 12, fontWeight: '900', color: p.text }}>{inr(q.seatFare)}</Text>
                  </View>
                  <View style={{ marginTop: 4 }}>{ended ? <Text style={{ fontSize: 11.5, fontWeight: '900', color: p.sub }}>{q.status === 'COMPLETED' || q.status === 'IN_PROGRESS' ? 'Departed' : q.statusLabel}</Text> : <StatusChip trip={q} now={now} />}</View>
                  <Text style={{ fontSize: 11, color: p.muted, marginTop: 4 }} numberOfLines={1}>
                    → {q.destination || '—'} · leaves {fmtClock(q.departureAt)}{q.checkInAt ? ` · checked in ${fmtClock(q.checkInAt)}` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <Text style={{ fontSize: 11, color: p.sub }}>{q.driver?.name || 'Driver'}</Text>
                    <VerifiedBadge verified={!!q.driver?.verified} />
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
