// Home dashboard: Online / Offline, the current trip (route, pickup, queue no., status, passengers x/cap,
// seats left, departure), today's trips + earnings (GET /home, recorded money only), upcoming bookings on
// the current trip, alerts, and the action menu. Live: socket nudges + 30 s refresh.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, ErrorStrip, IconButton, SkeletonCard } from '../ui/kit';
import { Banner, ListRow, OfflineBanner, SectionTitle, StatBox } from '../ui/Screen';
import { SosButton } from '../ui/Sos';
import { useToast } from '../ui/Toast';
import { useSession } from '../state/SessionProvider';
import { useDriverEvents } from '../state/SocketProvider';
import { useLoad } from '../state/useLoad';
import { driverApi } from '../api/driverApi';
import { ApiError, NetworkError, errorMessage } from '../lib/http';
import { enqueue, remove, subscribeQueue } from '../lib/offlineQueue';
import { rupees, timeIst, dayIst, relative } from '../lib/format';
import { HOME_POLL_MS } from '../config';
import type { BookingDriver, HomeResponse, Trip } from '../types';
import type { ScreenProps } from '../nav';

export const STATUS_TONE = (s: string): { fg: string; bg: string } => {
  if (['OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'PUBLISHED'].includes(s)) return { fg: color.openDark, bg: color.openTint };
  if (['FULL', 'DRIVER_CONFIRMED', 'BOARDING'].includes(s)) return { fg: color.brandDark, bg: color.brandTint };
  if (s === 'IN_PROGRESS') return { fg: color.info, bg: color.infoTint };
  if (s === 'DELAYED') return { fg: color.warning, bg: color.warningTint };
  if (s === 'COMPLETED') return { fg: color.textSecondary, bg: color.surfaceAlt };
  return { fg: color.alertDark, bg: color.alertTint };
};

/** Union queue: an auto put on charge that is still at the stand (the stand view is its home). */
export const atStand = (t: Pick<Trip, 'dispatchMode' | 'status'>) => t.dispatchMode === 'ON_CHARGE'
  && ['PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL'].includes(t.status);

export function TripSummaryCard({ trip, onPress }: { trip: Trip; onPress?: () => void }) {
  const tone = STATUS_TONE(trip.status);
  const charge = trip.dispatchMode === 'ON_CHARGE';
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`Current trip ${trip.route?.name || ''}, ${trip.statusLabel}`}
      style={({ pressed }) => [styles.trip, pressed && onPress ? { opacity: 0.85 } : null]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Badge text={trip.statusLabel.toUpperCase()} fg={tone.fg} bg={tone.bg} />
        {trip.mode === 'PRIVATE' ? <Badge text="FULL AUTO" fg={color.boarded} bg={color.boardedTint} /> : null}
        <View style={{ flex: 1 }} />
        {charge && trip.line ? <Text style={[font.h2, { color: color.text }]}>{trip.onCharge ? 'On charge' : `Waiting · #${trip.line.position}`}</Text>
          : trip.queueNumber && !charge ? <Text style={[font.h2, { color: color.text }]}>Queue #{trip.queueNumber}</Text> : null}
      </View>
      <Text style={[font.h2, { color: color.text }]} numberOfLines={2}>{trip.route ? `${trip.route.origin} → ${trip.destination || trip.route.destination}` : trip.destination}</Text>
      <Text style={[font.body, { color: color.textSecondary }]}>Pickup: {trip.pickup?.name || '—'}{trip.pickup?.landmark ? ` (${trip.pickup.landmark})` : ''}</Text>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <StatBox label="Passengers" value={`${trip.confirmedSeats}/${trip.capacity}`} sub={trip.heldSeats ? `${trip.heldSeats} seat${trip.heldSeats === 1 ? '' : 's'} being booked` : undefined} />
        <StatBox label="Seats left" value={String(trip.remainingSeats)} />
        {charge && atStand(trip) ? (
          <StatBox label="Walk-in" value={String(trip.walkInSeats || 0)} sub="Leaves when full or on Depart" />
        ) : (
          <StatBox label="Departure" value={timeIst(trip.departureAt)} sub={`${dayIst(trip.departureAt)} · ${relative(trip.departureAt)}${trip.delayMinutes ? ` · delayed ${trip.delayMinutes} min` : ''}`} />
        )}
      </View>
      {onPress ? <Text style={[font.small, { color: color.info, fontWeight: '800' }]}>Open trip ›</Text> : null}
    </Pressable>
  );
}

export default function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { me, refreshMe, pushState } = useSession();
  const q = useLoad<HomeResponse>(() => driverApi.home(), [], { pollMs: HOME_POLL_MS });
  const [unread, setUnread] = useState(0);
  const [bookings, setBookings] = useState<BookingDriver[] | null>(null);
  const [toggling, setToggling] = useState(false);
  const [pendingOffline, setPendingOffline] = useState(false);

  const loadExtras = useCallback(async (h: HomeResponse | null) => {
    driverApi.notifications().then((n) => setUnread(n.unread)).catch(() => {});
    if (h?.currentTrip) driverApi.bookings(h.currentTrip.id).then((b) => setBookings(b.bookings)).catch(() => {});
    else setBookings(null);
  }, []);
  useEffect(() => { if (q.data) loadExtras(q.data); }, [q.data, loadExtras]);
  useDriverEvents(() => { q.reload(); });
  useEffect(() => subscribeQueue((list) => setPendingOffline(list.some((a) => a.type === 'GO_OFFLINE'))), []);

  const h = q.data;
  const online = pendingOffline ? false : !!h?.driver.isOnline;

  const setOnline = async (next: boolean) => {
    if (toggling) return;
    if (!next && h?.currentTrip && ['DRIVER_CONFIRMED', 'BOARDING', 'IN_PROGRESS'].includes(h.currentTrip.status)) {
      toast.show('Finish or cancel the current trip before going offline.', 'error');
      return;
    }
    setToggling(true);
    try {
      if (next) await remove('GO_OFFLINE');
      const r = await driverApi.setOnline(next);
      q.setData((d) => (d ? { ...d, driver: { ...d.driver, isOnline: r.isOnline } } : d));
      toast.show(r.isOnline ? 'You are online.' : 'You are offline.', 'success');
      refreshMe();
    } catch (e) {
      if (!next && e instanceof NetworkError) {
        // Safe to replay: going offline gives the same result however many times it lands.
        await enqueue('GO_OFFLINE');
        toast.show('No internet. You will be set offline as soon as the phone is back online.', 'info');
      } else {
        toast.show(errorMessage(e), 'error');
        if (e instanceof ApiError && e.code === 'DRIVER_NOT_VERIFIED') refreshMe();
      }
    } finally {
      setToggling(false);
    }
  };

  const openTrip = (t: Trip) => (atStand(t) ? navigation.navigate('Charge', { tripId: t.id }) : navigation.navigate('TripDetail', { tripId: t.id }));
  const putOnCharge = () => {
    if (h?.currentTrip) { openTrip(h.currentTrip); return; }
    navigation.navigate('PutOnCharge');
  };
  const startTrip = () => {
    if (h?.currentTrip) {
      Alert.alert('You have an active trip', 'Finish or cancel the current trip before starting a new one.', [
        { text: 'OK', style: 'cancel' },
        { text: 'Open current trip', onPress: () => navigation.navigate('TripDetail', { tripId: h.currentTrip!.id }) },
      ]);
      return;
    }
    navigation.navigate('Publish');
  };
  const needTrip = (tab: 'seats' | 'bookings') => {
    if (h?.currentTrip) navigation.navigate('TripDetail', { tripId: h.currentTrip.id, tab });
    else toast.show('No active trip right now. Start a new auto trip first.', 'info');
  };

  const cur = h?.currentTrip || null;
  const upcoming = (bookings || []).filter((b) => ['HELD', 'CONFIRMED', 'BOARDED'].includes(b.status));
  const firstName = (h?.driver.name || me?.driver.name || '').split(' ')[0];

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={[styles.head, { paddingTop: insets.top + space.xs }]}>
        <View style={{ flex: 1 }}>
          <Text style={[font.small, { color: color.textMuted }]}>Zenvy Auto Driver</Text>
          <Text style={[font.h2, { color: color.text }]} numberOfLines={1}>{firstName ? `Hi ${firstName}` : 'Hi'}</Text>
        </View>
        <View>
          <IconButton icon="notifications" label={`Notifications${unread ? `, ${unread} unread` : ''}`} onPress={() => navigation.navigate('Notifications')} />
          {unread ? <View style={styles.dot}><Text style={[font.label, { color: color.textInverse, fontSize: 11 }]}>{unread > 99 ? '99+' : unread}</Text></View> : null}
        </View>
        <SosButton tripId={cur?.id} />
      </View>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: insets.bottom + space.xxl }}
        refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={() => { q.refresh(); refreshMe(); }} />}>
        {q.loading && !h ? <><SkeletonCard /><SkeletonCard /></> : null}
        {q.error && !h ? <ErrorStrip text={q.error} onRetry={q.refresh} busy={q.refreshing} /> : null}
        {h ? (
          <>
            <Pressable onPress={() => setOnline(!online)} disabled={toggling} accessibilityRole="switch" accessibilityState={{ checked: online, busy: toggling }}
              accessibilityLabel={online ? 'You are online. Tap to go offline.' : 'You are offline. Tap to go online.'}
              style={[styles.duty, { backgroundColor: online ? color.open : color.closed }]}>
              <Ionicons name={online ? 'radio-button-on' : 'power'} size={34} color={color.textInverse} />
              <View style={{ flex: 1 }}>
                <Text style={[font.h1, { color: color.textInverse }]}>{toggling ? 'Please wait…' : online ? 'ONLINE' : 'OFFLINE'}</Text>
                <Text style={[font.body, { color: color.textInverse }]}>{online ? 'ఆన్‌లైన్ · Tap to go offline' : 'ఆఫ్‌లైన్ · Tap to go online'}</Text>
              </View>
            </Pressable>
            {pendingOffline ? <Banner tone="warn" text="Going offline is waiting for internet. It is sent automatically." /> : null}
            {h.alerts.map((a, i) => <Banner key={`${a.type}-${i}`} tone={a.type === 'VERIFICATION' ? 'warn' : 'info'} text={a.message} />)}
            {me && !me.featureEnabled ? <Banner tone="info" text="Auto-Ride bookings are switched off by Zenvy right now. You cannot publish trips until it opens." /> : null}
            {pushState === 'unavailable' || pushState === 'blocked' ? (
              <Banner tone="warn" text={pushState === 'blocked' ? 'Notifications are blocked. Allow them in phone Settings to hear about bookings while the app is closed.' : 'This phone cannot get push alerts in this app build. Keep the app open to see new bookings.'} />
            ) : null}

            <SectionTitle text="Current trip" />
            {cur ? <TripSummaryCard trip={cur} onPress={() => openTrip(cur)} /> : (
              <Card><Text style={[font.body, { color: color.textSecondary }]}>No active trip. Put your auto on charge when you reach the stand.</Text></Card>
            )}
            <Button
              label={cur && atStand(cur) ? 'Open the stand view' : cur ? 'Open current trip' : 'Put on charge'}
              icon={cur ? 'arrow-forward' : 'flash'}
              size="huge"
              variant="accept"
              onPress={putOnCharge}
            />

            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <StatBox label="Today's trips" value={String(h.todayTrips.length)} sub={`${h.todayTrips.filter((t) => t.status === 'COMPLETED').length} completed`} />
              <StatBox label="Today's earnings" value={rupees(h.todayEarnings.total)} sub={`Cash ${rupees(h.todayEarnings.cashCollected)}`} tone="ok" />
            </View>

            {cur ? (
              <>
                <SectionTitle text={`Bookings on this trip (${upcoming.length})`} />
                {bookings === null ? <SkeletonCard lines={1} /> : upcoming.length ? upcoming.slice(0, 5).map((b) => (
                  <Card key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[font.h3, { color: color.text }]}>{b.passengerName} · {b.seatCount} seat{b.seatCount === 1 ? '' : 's'}</Text>
                      <Text style={[font.small, { color: color.textSecondary }]}>{b.bookingCode}{b.seatNumbers.length ? ` · seat ${b.seatNumbers.join(', ')}` : ''}</Text>
                    </View>
                    <Badge text={b.status === 'HELD' ? 'BOOKING…' : b.status} fg={b.status === 'BOARDED' ? color.boarded : b.status === 'HELD' ? color.warning : color.openDark} bg={b.status === 'BOARDED' ? color.boardedTint : b.status === 'HELD' ? color.warningTint : color.openTint} />
                  </Card>
                )) : <Card><Text style={[font.body, { color: color.textSecondary }]}>No bookings yet.</Text></Card>}
              </>
            ) : null}

            <Button label="Schedule a trip with a set time" icon="calendar" variant="secondary" size="secondary" onPress={startTrip} />
            <SectionTitle text="Menu" />
            <ListRow icon="grid" title="Manage seats" onPress={() => needTrip('seats')} />
            <ListRow icon="list" title="View bookings" onPress={() => needTrip('bookings')} />
            <ListRow icon="people" title="View queue" sub={cur?.queueNumber ? `You are #${cur.queueNumber}` : undefined} onPress={() => navigation.navigate('Queue')} />
            <ListRow icon="car-sport" title="Full auto requests" badge={h.pendingPrivateRequests || null} onPress={() => navigation.navigate('Requests')} />
            <ListRow icon="time" title="Trip history" onPress={() => navigation.navigate('History')} />
            <ListRow icon="wallet" title="Earnings" onPress={() => navigation.navigate('Earnings')} />
            <ListRow icon="person-circle" title="Profile and vehicle" onPress={() => navigation.navigate('Profile')} />
            <ListRow icon="help-buoy" title="Help and support" onPress={() => navigation.navigate('Support')} />
            <ListRow icon="settings" title="Settings" onPress={() => navigation.navigate('Settings')} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border },
  duty: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, padding: space.lg, minHeight: 96 },
  trip: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.md, gap: space.sm, borderWidth: 2, borderColor: color.brand },
  dot: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: color.alert, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
