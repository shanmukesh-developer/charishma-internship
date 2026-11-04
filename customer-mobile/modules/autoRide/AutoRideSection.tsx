/**
 * Others > Co-Ride > Auto: Zenvy Auto-Ride (shared autos run by verified Zenvy Auto drivers; NOT the
 * peer-to-peer pools of Co-Ride). Tabs: Shared seat | Full auto | My bookings, plus Pickup points.
 * Routes and pickup points are the ones the Zenvy admin configured (server); every count, fare and status
 * on a card comes from the server. No device location is used.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Linking, Alert, LayoutAnimation, Platform, UIManager, StyleSheet } from 'react-native';
import { PressScale, FadeInUp } from '../others/motion';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { readCache, writeCache } from '../../utils/swrCache';
import {
  autoRideApi, type Trip, type RouteFull, type Booking, type PrivateRequest, type PickupBrief, type RouteBrief,
  inr, fmtDeparture, fromNow, istDate, istDayLabel, fmtHHMM, queueLabel, AutoRideError, BOOKING_STATUS_META, PRIVATE_STATUS_META, LIVE_BOOKING,
} from './autoRideApi';
import { usePalette, Card, Btn, Badge, StateView, Notice, Chips, Tabs, StatusChip, VerifiedBadge, Stepper, AutoTile, useAutoRideLive, useNow, useAutoRideStatus } from './ui';
import ChargeBoard from './ChargeBoard';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch { /* new arch: no-op */ }
}
const ease = () => { try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch { /* ignore */ } };

// 'charge' = the ZCS Auto union queue board (autos on charge at each stand); 'shared' = autos published with a time.
type Seg = 'charge' | 'shared' | 'full' | 'bookings' | 'pickups';
const isSeg = (v: any): v is Seg => v === 'charge' || v === 'shared' || v === 'full' || v === 'bookings' || v === 'pickups';

const ROUTES_KEY = 'autoride:routes';

/** Routes + pickup points (admin-configured; read-only list, cached for an instant paint). */
function useRoutes() {
  const [routes, setRoutes] = useState<RouteFull[] | null>(null);
  const [error, setError] = useState<AutoRideError | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await autoRideApi.routes();
      setRoutes(r.routes);
      setError(null);
      writeCache(ROUTES_KEY, r.routes);
    } catch (e: any) {
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load routes.'));
    }
  }, []);
  useEffect(() => {
    let alive = true;
    readCache<RouteFull[]>(ROUTES_KEY).then((c) => { if (alive && c && Array.isArray(c.data)) setRoutes((cur) => cur || c.data); });
    load();
    return () => { alive = false; };
  }, [load]);
  return { routes, error, reload: load };
}

export default function AutoRideSection() {
  const p = usePalette();
  const params = useLocalSearchParams<{ seg?: string }>();
  const [seg, setSeg] = useState<Seg>(isSeg(params.seg) ? params.seg : 'charge');
  useEffect(() => { if (isSeg(params.seg)) setSeg(params.seg); }, [params.seg]);
  const routesState = useRoutes();
  // The on-charge board needs a backend that serves it; until then the section opens on Scheduled as before.
  const [chargeOk, setChargeOk] = useState(true);
  const chargeGone = useCallback(() => { setChargeOk(false); setSeg((cur) => (cur === 'charge' ? 'shared' : cur)); }, []);
  const home: Seg = chargeOk ? 'charge' : 'shared';

  return (
    <View>
      <Tabs
        label="ZenWe Auto"
        // Pickup points is not a tab: no tab looks selected while it is open.
        value={seg}
        onChange={(v) => { ease(); setSeg(v); }}
        options={[
          ...(chargeOk ? [{ key: 'charge' as Seg, label: 'On charge' }] : []),
          { key: 'shared' as Seg, label: chargeOk ? 'Scheduled' : 'Shared seat' },
          { key: 'full' as Seg, label: 'Full auto' },
          { key: 'bookings' as Seg, label: 'My bookings' },
        ]}
      />
      <PressScale onPress={() => { ease(); setSeg(seg === 'pickups' ? home : 'pickups'); }} accessibilityRole="button"
        accessibilityLabel={seg === 'pickups' ? 'Back to autos' : 'Pickup points and live queues'}
        style={[st.linkRow, { backgroundColor: p.card }, p.shadow]}>
        <View style={[st.linkIcon, { backgroundColor: p.accentSoft }]}><Ionicons name={seg === 'pickups' ? 'arrow-back' : 'location-outline'} size={18} color={p.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: p.text }}>{seg === 'pickups' ? 'Back to autos' : 'Pickup points and live queues'}</Text>
          {seg !== 'pickups' ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 1 }}>Stands set by ZenWe, with the autos waiting at each</Text> : null}
        </View>
        {seg !== 'pickups' ? <Ionicons name="chevron-forward" size={18} color={p.muted} /> : null}
      </PressScale>
      {seg === 'charge' && chargeOk ? <ChargeBoard onUnavailable={chargeGone} /> : null}
      {seg === 'shared' ? <TripSearch mode="shared" {...routesState} /> : null}
      {seg === 'full' ? <TripSearch mode="full" {...routesState} /> : null}
      {seg === 'bookings' ? <MyBookings /> : null}
      {seg === 'pickups' ? <PickupPoints /> : null}
    </View>
  );
}

// ── Shared seat / Full auto ─────────────────────────────────────────────────
const TIME_OPTIONS = (() => {
  const out: string[] = [];
  for (let h = 5; h < 24; h++) for (const m of [0, 30]) out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  return out;
})();

function TripSearch({ mode, routes, error: routesError, reload: reloadRoutes }: { mode: 'shared' | 'full'; routes: RouteFull[] | null; error: AutoRideError | null; reload: () => void }) {
  const p = usePalette();
  const router = useRouter();
  const now = useNow(30000);
  const [routeId, setRouteId] = useState<string>('');
  const [pickupId, setPickupId] = useState<string>('');
  const [date, setDate] = useState<string>(istDate(0));
  const [time, setTime] = useState<string>('');
  const [passengers, setPassengers] = useState(1);
  // One auto carries at most the platform capacity (owner rule: 8); more passengers can never match.
  const autoStatus = useAutoRideStatus();
  const maxPassengers = Math.max(1, Math.min(8, Number(autoStatus?.settings?.platformMaxCapacity) || 8));
  useEffect(() => { if (passengers > maxPassengers) setPassengers(maxPassengers); }, [passengers, maxPassengers]);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<AutoRideError | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  const route = routes?.find((r) => r.id === routeId) || null;
  const pickups = useMemo(() => {
    const all = (routes || []).flatMap((r) => r.pickupPoints.filter((x) => x.isActive).map((x) => ({ ...x, routeName: r.name })));
    return routeId ? all.filter((x) => x.routeId === routeId) : all;
  }, [routes, routeId]);
  useEffect(() => { if (pickupId && !pickups.some((x) => x.id === pickupId)) setPickupId(''); }, [pickups, pickupId]);
  const pickup = pickups.find((x) => x.id === pickupId) || null;

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const r = await autoRideApi.browse({
        routeId: routeId || null, pickupPointId: pickupId || null, date, time: time || null,
        passengers: passengers > 1 ? passengers : null, mode: mode === 'full' ? 'private' : null,
      });
      ease();
      setTrips(r.trips);
      setError(null);
    } catch (e: any) {
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load autos.'));
    } finally {
      setLoading(false);
    }
  }, [routeId, pickupId, date, time, passengers, mode]);

  // First search with the defaults (today, any route); later ones run on "Search".
  useEffect(() => { search(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode]);
  useAutoRideLive((e) => { if (e.kind === 'trip' || e.kind === 'reconnect' || e.kind === 'booking') search(); });

  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => istDate(i)), []);
  // Today only offers times that are still ahead (IST); a time that has passed falls back to "Any time".
  const timeOptions = useMemo(() => {
    if (date !== istDate(0)) return TIME_OPTIONS;
    const ist = new Date(now + 5.5 * 60 * 60 * 1000);
    const nowHHMM = `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
    return TIME_OPTIONS.filter((t) => t > nowHHMM);
  }, [date, now]);
  useEffect(() => { if (time && !timeOptions.includes(time)) setTime(''); }, [time, timeOptions]);

  if (error && error.code === 'FEATURE_OFF') {
    return <StateView kind="empty" icon="🛺" title="ZenWe Auto is not open yet" message={error.message} />;
  }
  // No routes yet: a search form with nothing to pick from is a dead end; say so calmly instead.
  if (routes && routes.length === 0) {
    return (
      <StateView kind="empty" icon="map-outline" title="No auto routes yet"
        message="Scheduled and full autos show up here once routes and stands are set up. Until then, find a co-ride or check the On charge board."
        actionLabel="Check again" onAction={reloadRoutes} />
    );
  }

  const placeRow = (icon: 'radio-button-on' | 'location', label: string, value: string, hint?: string) => (
    <View style={[st.place, { backgroundColor: p.card2 }]}>
      <Ionicons name={icon} size={16} color={p.accent} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 11, color: p.muted, fontWeight: '700' }}>{label}</Text>
        <Text style={{ fontSize: 14, color: p.text, fontWeight: '700' }} numberOfLines={1}>{value}</Text>
        {hint ? <Text style={{ fontSize: 12, color: p.sub }} numberOfLines={1}>{hint}</Text> : null}
      </View>
    </View>
  );

  return (
    <View>
      {mode === 'full' ? (
        <Notice tone="info">Book the whole auto for your group. You send a request at the driver's full-auto fare; nothing is booked until the driver accepts. Only autos with no seats booked yet can be taken as a full auto.</Notice>
      ) : null}

      <Card>
        <View style={{ gap: 8 }}>
          {placeRow('radio-button-on', 'Pickup point', pickup ? pickup.name : 'Any pickup point', pickup?.landmark || undefined)}
          {placeRow('location', 'Drop', route ? (route.destination || route.name) : 'Any route', route?.origin ? `from ${route.origin}` : undefined)}
        </View>
        <PressScale onPress={() => { ease(); setShowFilters((v) => !v); }} accessibilityRole="button" accessibilityLabel={showFilters ? 'Hide search options' : 'Show search options'}
          style={st.summaryRow}>
          <Ionicons name="calendar-outline" size={16} color={p.sub} />
          <Text style={{ flex: 1, fontSize: 13, color: p.text, fontWeight: '600' }} numberOfLines={1}>
            {istDayLabel(date)}{time ? ` · around ${fmtHHMM(time)}` : ' · any time'} · {passengers} {passengers === 1 ? 'passenger' : 'passengers'}
          </Text>
          <Text style={{ color: p.accent, fontWeight: '700', fontSize: 13 }}>{showFilters ? 'Hide' : 'Edit'}</Text>
        </PressScale>

        {showFilters ? (
          <View>
            <Label text="Drop / route" />
            {routes === null && !routesError ? <Text style={{ color: p.muted, fontSize: 13 }}>Loading routes…</Text> : null}
            {routesError && !routes ? (
              <PressScale onPress={reloadRoutes} accessibilityRole="button"><Text style={{ color: p.sub, fontSize: 13 }}>{routesError.message} <Text style={{ color: p.accent, fontWeight: '700' }}>Retry</Text></Text></PressScale>
            ) : null}
            {routes && routes.length === 0 ? <Text style={{ color: p.muted, fontSize: 13 }}>No routes are set up yet.</Text> : null}
            {routes && routes.length > 0 ? (
              <Chips wrap={false} value={routeId || 'ALL'} onChange={(v: string) => setRouteId(v === 'ALL' ? '' : v)}
                options={[{ key: 'ALL', label: 'All routes' }, ...routes.map((r) => ({ key: r.id, label: r.destination || r.name, hint: r.origin ? `from ${r.origin}` : undefined }))]} />
            ) : null}

            <Label text="Pickup point" />
            {pickups.length === 0 ? <Text style={{ color: p.muted, fontSize: 13 }}>{routes ? 'No pickup points on this route yet.' : '—'}</Text> : (
              <Chips wrap={false} value={pickupId || 'ALL'} onChange={(v: string) => setPickupId(v === 'ALL' ? '' : v)}
                options={[{ key: 'ALL', label: 'Any pickup' }, ...pickups.map((x) => ({ key: x.id, label: x.name, hint: x.landmark || undefined }))]} />
            )}

            <Label text="Date" />
            <Chips wrap={false} value={date} onChange={(v: string) => setDate(v)} options={dates.map((d) => ({ key: d, label: istDayLabel(d) }))} />

            <Label text="Preferred time" />
            <Chips wrap={false} value={time || 'ANY'} onChange={(v: string) => setTime(v === 'ANY' ? '' : v)}
              options={[{ key: 'ANY', label: 'Any time' }, ...timeOptions.map((t) => ({ key: t, label: fmtHHMM(t) }))]} />

            <Label text="Passengers" />
            <Stepper value={passengers} min={1} max={maxPassengers} onChange={setPassengers} label="Passengers" />

            <Btn label={loading ? 'Searching…' : 'Search autos'} icon="search" onPress={search} loading={loading} style={{ marginTop: 16 }} />
          </View>
        ) : null}
      </Card>

      {trips === null && !error ? (
        <StateView kind="loading" message="Looking for autos…" />
      ) : error && !trips ? (
        <StateView kind="error" title={error.isNetwork ? 'You seem to be offline' : 'Could not load autos'} message={error.message} actionLabel="Retry" onAction={() => { if (routesError && !routes) reloadRoutes(); search(); }} />
      ) : (
        <View>
          {error ? <Notice tone="warn">{error.message} Showing the last results.</Notice> : null}
          <View style={st.listHead}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: p.text }}>{mode === 'full' ? 'Autos for your group' : 'Autos leaving'}</Text>
            <Text style={{ fontSize: 13, color: p.sub, fontWeight: '600' }}>{(trips || []).length} · {istDayLabel(date)}</Text>
          </View>
          {(trips || []).length === 0 ? (
            <StateView kind="empty" icon="🛺" title={mode === 'full' ? 'No autos open for full booking' : 'No autos match'}
              message={mode === 'full' ? 'Full-auto booking is possible only on autos that have no seats booked yet and whose driver allows it. Try another time or route.' : 'Drivers publish their trips through the day. Try another date, time or route, or check the pickup point queue.'}
              actionLabel="Refresh" onAction={search} />
          ) : (
            (trips || []).map((t, i) => (
              <FadeInUp key={t.id} index={i}>
              <TripCard t={t} now={now} mode={mode}
                onView={() => router.push(`/auto-ride/trip/${t.id}` as any)}
                onBook={() => router.push(`/auto-ride/trip/${t.id}?book=1` as any)}
                onFull={() => router.push(`/auto-ride/full/${t.id}` as any)}
                onMine={() => t.myBookingId && router.push(`/auto-ride/booking/${t.myBookingId}` as any)} />
              </FadeInUp>
            ))
          )}
        </View>
      )}
    </View>
  );
}

function Label({ text }: { text: string }) {
  const p = usePalette();
  return <Text style={{ fontSize: 13, fontWeight: '700', color: p.text, marginTop: 16, marginBottom: 8 }}>{text}</Text>;
}

export function TripCard({ t, now, mode = 'shared', onView, onBook, onFull, onMine }: {
  t: Trip; now: number; mode?: 'shared' | 'full'; onView: () => void; onBook?: () => void; onFull?: () => void; onMine?: () => void;
}) {
  const p = usePalette();
  const filled = t.capacity ? Math.min(1, (t.confirmedSeats + t.heldSeats) / t.capacity) : 0;
  const mine = !!t.myBookingId;
  const full = mode === 'full';
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <PressScale onPress={onView} accessibilityRole="button"
        accessibilityLabel={`${queueLabel(t.queueNumber)} to ${t.destination || 'destination'}, departs ${fmtDeparture(t.departureAt)}, ${inr(t.seatFare)} per seat, ${t.remainingSeats} of ${t.capacity} seats left`}
        style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <AutoTile size={60} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: p.text }} numberOfLines={1}>{full ? 'Full auto' : 'Shared auto'} · {queueLabel(t.queueNumber)}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 12, color: p.sub }} numberOfLines={1}>{t.driver?.name || 'Driver'}</Text>
              <VerifiedBadge verified={!!t.driver?.verified} />
              {t.driver?.rating ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Ionicons name="star" size={12} color="#F5A524" />
                  <Text style={{ fontSize: 12, color: p.text, fontWeight: '700' }}>{t.driver.rating.avg.toFixed(1)}</Text>
                  <Text style={{ fontSize: 12, color: p.muted }}>({t.driver.rating.count})</Text>
                </View>
              ) : null}
            </View>
            <View style={{ marginTop: 6 }}><StatusChip trip={t} now={now} /></View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 19, fontWeight: '800', color: p.text }}>{full && t.fullAutoFare ? inr(t.fullAutoFare) : inr(t.seatFare)}</Text>
            <Text style={{ fontSize: 12, color: p.sub }}>{full && t.fullAutoFare ? 'whole auto' : 'per seat'}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', marginTop: 14, gap: 10 }}>
          <View style={{ alignItems: 'center', paddingTop: 4, width: 14 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: p.accent }} />
            <View style={{ width: 2, flex: 1, backgroundColor: p.border, marginVertical: 3 }} />
            <Ionicons name="location" size={13} color={p.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: p.text }} numberOfLines={1}>{t.pickup?.name || t.route?.origin || 'Pickup point'}</Text>
            {t.pickup?.landmark ? <Text style={{ fontSize: 12, color: p.muted }} numberOfLines={1}>{t.pickup.landmark}</Text> : null}
            <Text style={{ fontSize: 14, fontWeight: '700', color: p.text, marginTop: 8 }} numberOfLines={1}>{t.destination || t.route?.destination || 'Destination'}</Text>
            {t.route?.name ? <Text style={{ fontSize: 12, color: p.muted }} numberOfLines={1}>{t.route.name}{t.route.distanceKm ? ` · ${t.route.distanceKm} km` : ''}</Text> : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <Ionicons name="time-outline" size={15} color={p.sub} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: p.text }}>{fmtDeparture(t.departureAt)}</Text>
          <Text style={{ fontSize: 13, color: p.muted }}>{fromNow(t.departureAt, now)}</Text>
        </View>

        <View style={{ marginTop: 10 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: p.card2, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(filled * 100)}%`, height: 6, backgroundColor: filled >= 1 ? p.danger : filled >= 0.75 ? p.warn : p.button }} />
          </View>
          <Text style={{ fontSize: 12, color: p.sub, marginTop: 5 }}>
            <Text style={{ fontWeight: '800', color: p.text }}>{t.remainingSeats} of {t.capacity}</Text> seats left
            {t.heldSeats ? ` · ${t.heldSeats} on hold` : ''}
            {t.vehicle?.registration ? ` · ${t.vehicle.registration}` : ''}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {!t.sharedBookingAllowed ? <Badge label="Seat booking closed" color="#64748B" /> : null}
          {t.fullAutoFare && !full ? <Badge label={t.privateBookingAllowed ? `Whole auto ${inr(t.fullAutoFare)}` : 'Whole auto not possible now'} color={t.privateBookingAllowed ? '#2563EB' : '#64748B'} /> : null}
          {t.seatSelectionEnabled ? <Badge label="Pick your seat" color="#2563EB" /> : null}
        </View>
      </PressScale>

      <View style={[st.cardFoot, { borderTopColor: p.border }]}>
        {mine ? (
          <Btn label={t.myBookingStatus === 'HELD' ? 'Finish booking' : 'My booking'} icon="ticket-outline" small style={{ flex: 1 }} onPress={t.myBookingStatus === 'HELD' ? onBook : onMine} />
        ) : (
          <>
            <Btn label="Details" kind="secondary" small style={{ flex: 1 }} onPress={onView} />
            {!full ? <Btn label="Book seats" small style={{ flex: 1.3 }} onPress={onBook} disabled={!t.sharedBookingAllowed} /> : null}
            {!full && t.fullAutoFare && t.privateBookingAllowed ? <Btn label="Full auto" kind="ghost" small onPress={onFull} /> : null}
            {full && t.fullAutoFare ? <Btn label="Request full auto" small style={{ flex: 1.5 }} onPress={onFull} disabled={!t.privateBookingAllowed} /> : null}
          </>
        )}
      </View>
    </Card>
  );
}

// ── My bookings ──────────────────────────────────────────────────────────────
function MyBookings() {
  const p = usePalette();
  const router = useRouter();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [requests, setRequests] = useState<PrivateRequest[]>([]);
  const [error, setError] = useState<AutoRideError | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([autoRideApi.bookings(scope), autoRideApi.privateRequests().catch(() => ({ requests: [] as PrivateRequest[] }))]);
      ease();
      setBookings(b.bookings);
      setRequests(r.requests);
      setError(null);
    } catch (e: any) {
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load your bookings.'));
    }
  }, [scope]);
  useEffect(() => { setBookings(null); load(); }, [load]);
  useAutoRideLive(() => load());

  const openReqs = requests.filter((r) => (scope === 'upcoming' ? r.status === 'REQUESTED' : r.status !== 'REQUESTED' && r.status !== 'ACCEPTED'));

  return (
    <View>
      <Tabs label="My auto bookings" value={scope} onChange={setScope} options={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'History' }]} />
      <View style={{ height: 12 }} />
      {openReqs.length ? (
        <View style={{ marginBottom: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: p.text, marginBottom: 8 }}>Full-auto requests</Text>
          {openReqs.map((r) => {
            const m = PRIVATE_STATUS_META[r.status];
            return (
              <PressScale key={r.id} onPress={() => router.push(`/auto-ride/request/${r.id}` as any)} accessibilityRole="button" accessibilityLabel={`Full-auto request, ${m.label}`}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={[st.linkIcon, { backgroundColor: p.accentSoft, width: 44, height: 44 }]}><Ionicons name="lock-closed-outline" size={20} color={p.accent} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: p.text }}>Full auto · {r.passengers} passenger{r.passengers === 1 ? '' : 's'}</Text>
                    <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{inr(r.fare)} · {r.status === 'REQUESTED' && r.respondBy ? `driver answers ${fromNow(r.respondBy)}` : (r.declineReason || m.label)}</Text>
                  </View>
                  <Badge label={m.label} color={m.color} />
                </Card>
              </PressScale>
            );
          })}
        </View>
      ) : null}

      {bookings === null && !error ? <StateView kind="loading" message="Loading your auto bookings…" /> : error && !bookings ? (
        <StateView kind="error" title={error.isNetwork ? 'You seem to be offline' : 'Could not load'} message={error.message} actionLabel="Retry" onAction={load} />
      ) : (bookings || []).length === 0 ? (
        <StateView kind="empty" icon="ticket-outline" title={scope === 'upcoming' ? 'No upcoming auto bookings' : 'No past auto bookings'} message={scope === 'upcoming' ? 'Book a seat on a shared auto and it shows up here with your booking code and PIN.' : 'Completed and cancelled bookings appear here.'} />
      ) : (
        (bookings || []).map((b, i) => <FadeInUp key={b.id} index={i}><BookingRow b={b} onPress={() => router.push(`/auto-ride/booking/${b.id}` as any)} /></FadeInUp>)
      )}
    </View>
  );
}

function BookingRow({ b, onPress }: { b: Booking; onPress: () => void }) {
  const p = usePalette();
  const m = BOOKING_STATUS_META[b.status];
  const t = b.trip;
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`Booking ${b.bookingCode}, ${m.label}`}>
      <Card style={{ flexDirection: 'row', gap: 12 }}>
        <AutoTile size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: p.text, flex: 1 }} numberOfLines={1}>{b.type === 'PRIVATE' ? 'Full auto' : 'Shared auto'}</Text>
            <Badge label={m.label} color={m.color} />
          </View>
          <Text style={{ fontSize: 13, color: p.text, fontWeight: '600', marginTop: 4 }} numberOfLines={1}>
            {t?.pickup?.name || 'Pickup'} to {t?.destination || 'Destination'}
          </Text>
          <Text style={{ fontSize: 12, color: p.sub, marginTop: 3 }}>
            {fmtDeparture(t?.departureAt)} · {b.seatCount} seat{b.seatCount === 1 ? '' : 's'}{b.seatNumbers.length && b.type === 'SHARED' ? ` (${b.seatNumbers.join(', ')})` : ''} · {inr(b.amount)}
          </Text>
          <Text style={{ fontSize: 12, color: p.muted, marginTop: 2, letterSpacing: 0.5 }}>{b.bookingCode}</Text>
          {t && LIVE_BOOKING.includes(b.status) ? <View style={{ marginTop: 8 }}><StatusChip trip={t} /></View> : null}
        </View>
      </Card>
    </PressScale>
  );
}

// ── Pickup points ────────────────────────────────────────────────────────────
function PickupPoints() {
  const p = usePalette();
  const router = useRouter();
  const [data, setData] = useState<{ points: (PickupBrief & { route: RouteBrief | null })[]; note: string } | null>(null);
  const [error, setError] = useState<AutoRideError | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await autoRideApi.pickupPoints();
      setData({ points: r.pickupPoints, note: r.note });
      setError(null);
    } catch (e: any) {
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load pickup points.'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const m = new Map<string, { route: RouteBrief | null; points: (PickupBrief & { route: RouteBrief | null })[] }>();
    for (const x of data?.points || []) {
      const k = x.route?.id || 'none';
      if (!m.has(k)) m.set(k, { route: x.route, points: [] });
      m.get(k)!.points.push(x);
    }
    return [...m.values()];
  }, [data]);

  if (!data && !error) return <StateView kind="loading" message="Loading pickup points…" />;
  if (error && !data) {
    if (error.code === 'FEATURE_OFF') return <StateView kind="empty" icon="🛺" title="ZenWe Auto is not open yet" message={error.message} />;
    return <StateView kind="error" title={error.isNetwork ? 'You seem to be offline' : 'Could not load'} message={error.message} actionLabel="Retry" onAction={load} />;
  }
  return (
    <View>
      <Notice tone="info">{data?.note || 'Pickup stands set by ZenWe.'} Your phone's location is not used.</Notice>
      {groups.length === 0 ? <StateView kind="empty" icon="location-outline" title="No pickup points yet" message="ZenWe has not set up auto stands yet." /> : null}
      {groups.map((g) => (
        <View key={g.route?.id || 'none'} style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: p.text, marginBottom: 8 }}>
            {g.route ? `${g.route.origin ? `${g.route.origin} to ` : ''}${g.route.destination || g.route.name}` : 'Other stands'}
          </Text>
          {g.points.map((x) => (
            <Card key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <PressScale style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }} onPress={() => router.push(`/auto-ride/pickup/${x.id}` as any)}
                accessibilityRole="button" accessibilityLabel={`${x.name}, view live queue`}>
                <View style={[st.linkIcon, { backgroundColor: p.accentSoft, width: 44, height: 44 }]}><Ionicons name="flag-outline" size={20} color={p.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: p.text }}>{x.name}</Text>
                  {x.landmark ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{x.landmark}</Text> : null}
                  <Text style={{ fontSize: 12, color: p.accent, fontWeight: '700', marginTop: 3 }}>View live queue</Text>
                </View>
              </PressScale>
              {x.mapsUrl ? (
                <Btn label="Maps" icon="navigate-outline" kind="secondary" small onPress={() => Linking.openURL(x.mapsUrl!).catch(() => Alert.alert('Could not open maps'))} />
              ) : null}
            </Card>
          ))}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 12, marginTop: 12, marginBottom: 12, minHeight: 56 },
  linkIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  place: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 6 },
  listHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4, marginBottom: 10 },
  cardFoot: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
