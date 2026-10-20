/**
 * Others > Co-Ride > 🛺 AUTO: Zenvy Auto-Ride (shared autos run by verified Zenvy Auto drivers; NOT the
 * peer-to-peer "Auto" pools of Co-Ride). Four segments: Shared Auto | Book Full Auto | My Auto Bookings |
 * Nearby Pickup Points. Routes and pickup points are the ones the Zenvy admin configured (server); every
 * count, fare and status on a card comes from the server. No device location is used.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Linking, Alert, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { readCache, writeCache } from '../../utils/swrCache';
import {
  autoRideApi, type Trip, type RouteFull, type Booking, type PrivateRequest, type PickupBrief, type RouteBrief,
  inr, fmtDeparture, fromNow, istDate, istDayLabel, fmtHHMM, queueLabel, AutoRideError, BOOKING_STATUS_META, PRIVATE_STATUS_META, LIVE_BOOKING,
} from './autoRideApi';
import { Ionicons } from '@expo/vector-icons';
import { usePalette, Card, Btn, Badge, StateView, Notice, Chips, StatusChip, VerifiedBadge, Stepper, useAutoRideLive, useNow, useAutoRideStatus } from './ui';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch { /* new arch: no-op */ }
}
const ease = () => { try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch { /* ignore */ } };

type Seg = 'shared' | 'full' | 'bookings' | 'pickups';
const SEGS: { key: Seg; label: string; icon: string }[] = [
  { key: 'shared', label: 'Shared auto', icon: 'people-outline' },
  { key: 'full', label: 'Book full auto', icon: 'lock-closed-outline' },
  { key: 'bookings', label: 'My auto bookings', icon: 'ticket-outline' },
  { key: 'pickups', label: 'Pickup points', icon: 'location-outline' },
];
const isSeg = (v: any): v is Seg => SEGS.some((x) => x.key === v);

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
  const [seg, setSeg] = useState<Seg>(isSeg(params.seg) ? params.seg : 'shared');
  useEffect(() => { if (isSeg(params.seg)) setSeg(params.seg); }, [params.seg]);
  const routesState = useRoutes();

  return (
    <View>
      {/* The Co-Ride tab (others.tsx) already introduces Zenvy Auto above this: one plain line, no gradient hero. */}
      <Text style={{ fontSize: 13, lineHeight: 18, color: p.sub, marginBottom: 12 }}>
        Book a seat, or the whole auto. Zenvy checks every driver and auto.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4, paddingRight: 8 }} style={{ marginBottom: 12 }}>
        {SEGS.map((x) => {
          const on = seg === x.key;
          return (
            <TouchableOpacity key={x.key} onPress={() => { ease(); setSeg(x.key); }} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={x.label}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, backgroundColor: on ? p.text : p.card, borderColor: on ? p.text : p.border, minHeight: 44 }}>
              <Ionicons name={x.icon as any} size={16} color={on ? p.card : p.sub} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: on ? p.card : p.text }}>{x.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {seg === 'shared' ? <TripSearch mode="shared" {...routesState} /> : null}
      {seg === 'full' ? <TripSearch mode="full" {...routesState} /> : null}
      {seg === 'bookings' ? <MyBookings /> : null}
      {seg === 'pickups' ? <PickupPoints /> : null}
    </View>
  );
}

// ── Shared Auto / Book Full Auto ────────────────────────────────────────────
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

  if (error && error.code === 'FEATURE_OFF') {
    return <StateView kind="empty" icon="🛺" title="Zenvy Auto is not open yet" message={error.message} />;
  }

  return (
    <View>
      {mode === 'full' ? (
        <Notice tone="info">🔒 Book the whole auto for your group. You send a request at the driver's full-auto fare; nothing is booked until the driver accepts. Only autos with no seats booked yet can be taken as a full auto.</Notice>
      ) : null}

      <Card>
        <TouchableOpacity onPress={() => { ease(); setShowFilters((v) => !v); }} accessibilityRole="button" accessibilityLabel={showFilters ? 'Hide search options' : 'Show search options'}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: p.text }}>🔎 Find an auto</Text>
            <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }} numberOfLines={1}>
              {(route ? `→ ${route.destination || route.name}` : 'Any route')} · {istDayLabel(date)}{time ? ` · ~${fmtHHMM(time)}` : ''} · {passengers} {passengers === 1 ? 'passenger' : 'passengers'}
            </Text>
          </View>
          <Text style={{ color: p.accent, fontWeight: '900', fontSize: 12 }}>{showFilters ? 'Hide ▲' : 'Edit ▼'}</Text>
        </TouchableOpacity>

        {showFilters ? (
          <View style={{ marginTop: 12 }}>
            <Label text="Destination / route" />
            {routes === null && !routesError ? <Text style={{ color: p.muted, fontSize: 12 }}>Loading routes…</Text> : null}
            {routesError && !routes ? (
              <TouchableOpacity onPress={reloadRoutes} accessibilityRole="button"><Text style={{ color: p.sub, fontSize: 12 }}>⚠️ {routesError.message} <Text style={{ color: p.accent, fontWeight: '900' }}>Retry</Text></Text></TouchableOpacity>
            ) : null}
            {routes && routes.length === 0 ? <Text style={{ color: p.muted, fontSize: 12 }}>No routes are set up yet.</Text> : null}
            {routes && routes.length > 0 ? (
              <Chips wrap={false} value={routeId || 'ALL'} onChange={(v: string) => setRouteId(v === 'ALL' ? '' : v)}
                options={[{ key: 'ALL', label: 'All routes' }, ...routes.map((r) => ({ key: r.id, label: `→ ${r.destination || r.name}`, hint: r.origin ? `from ${r.origin}` : undefined }))]} />
            ) : null}

            <Label text="Pickup point" />
            {pickups.length === 0 ? <Text style={{ color: p.muted, fontSize: 12 }}>{routes ? 'No pickup points on this route yet.' : '—'}</Text> : (
              <Chips wrap={false} value={pickupId || 'ALL'} onChange={(v: string) => setPickupId(v === 'ALL' ? '' : v)}
                options={[{ key: 'ALL', label: 'Any pickup' }, ...pickups.map((x) => ({ key: x.id, label: `📍 ${x.name}`, hint: x.landmark || undefined }))]} />
            )}

            <Label text="Date" />
            <Chips wrap={false} value={date} onChange={(v: string) => setDate(v)} options={dates.map((d) => ({ key: d, label: istDayLabel(d) }))} />

            <Label text="Preferred time" />
            <Chips wrap={false} value={time || 'ANY'} onChange={(v: string) => setTime(v === 'ANY' ? '' : v)}
              options={[{ key: 'ANY', label: 'Any time' }, ...TIME_OPTIONS.map((t) => ({ key: t, label: fmtHHMM(t) }))]} />

            <Label text="Passengers" />
            <Stepper value={passengers} min={1} max={maxPassengers} onChange={setPassengers} label="Passengers" />

            <Btn label={loading ? 'Searching…' : 'Search autos'} icon="🔎" onPress={search} loading={loading} style={{ marginTop: 14 }} />
          </View>
        ) : null}
      </Card>

      {trips === null && !error ? (
        <StateView kind="loading" message="Looking for autos…" />
      ) : error && !trips ? (
        <StateView kind="error" title={error.isNetwork ? 'You seem to be offline' : 'Could not load autos'} message={error.message} actionLabel="Retry" onAction={search} />
      ) : (
        <View>
          {error ? <Notice tone="warn">⚠️ {error.message} Showing the last results.</Notice> : null}
          <Text style={{ fontSize: 11, fontWeight: '900', color: p.sub, letterSpacing: 1, marginBottom: 8, marginTop: 4 }}>
            {(trips || []).length} AUTO{(trips || []).length === 1 ? '' : 'S'} · {istDayLabel(date).toUpperCase()}
          </Text>
          {(trips || []).length === 0 ? (
            <StateView kind="empty" icon="🛺" title={mode === 'full' ? 'No autos open for full booking' : 'No autos match'}
              message={mode === 'full' ? 'Full-auto booking is possible only on autos that have no seats booked yet and whose driver allows it. Try another time or route.' : 'Drivers publish their trips through the day. Try another date, time or route, or check the pickup point queue.'}
              actionLabel="Refresh" onAction={search} />
          ) : (
            (trips || []).map((t) => (
              <TripCard key={t.id} t={t} now={now} mode={mode}
                onView={() => router.push(`/auto-ride/trip/${t.id}` as any)}
                onBook={() => router.push(`/auto-ride/trip/${t.id}?book=1` as any)}
                onFull={() => router.push(`/auto-ride/full/${t.id}` as any)}
                onMine={() => t.myBookingId && router.push(`/auto-ride/booking/${t.myBookingId}` as any)} />
            ))
          )}
        </View>
      )}
    </View>
  );
}

function Label({ text }: { text: string }) {
  const p = usePalette();
  return <Text style={{ fontSize: 10.5, fontWeight: '900', color: p.sub, letterSpacing: 0.8, marginTop: 12, marginBottom: 6 }}>{text.toUpperCase()}</Text>;
}

export function TripCard({ t, now, mode = 'shared', onView, onBook, onFull, onMine }: {
  t: Trip; now: number; mode?: 'shared' | 'full'; onView: () => void; onBook?: () => void; onFull?: () => void; onMine?: () => void;
}) {
  const p = usePalette();
  const filled = t.capacity ? Math.min(1, (t.confirmedSeats + t.heldSeats) / t.capacity) : 0;
  const mine = !!t.myBookingId;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <TouchableOpacity onPress={onView} activeOpacity={0.9} accessibilityRole="button"
        accessibilityLabel={`${queueLabel(t.queueNumber)} to ${t.destination || 'destination'}, departs ${fmtDeparture(t.departureAt)}, ${inr(t.seatFare)} per seat, ${t.remainingSeats} of ${t.capacity} seats left`}
        style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ backgroundColor: '#FACC15', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: '900', color: '#1F2937' }}>🛺 {queueLabel(t.queueNumber)}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <StatusChip trip={t} now={now} />
        </View>

        <View style={{ flexDirection: 'row', marginTop: 12, gap: 10 }}>
          <View style={{ alignItems: 'center', paddingTop: 3 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.success }} />
            <View style={{ width: 2, flex: 1, backgroundColor: p.border, marginVertical: 2 }} />
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: p.danger }} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13.5, fontWeight: '800', color: p.text }} numberOfLines={1}>{t.pickup?.name || t.route?.origin || 'Pickup point'}</Text>
            {t.pickup?.landmark ? <Text style={{ fontSize: 11, color: p.muted }} numberOfLines={1}>{t.pickup.landmark}</Text> : null}
            <Text style={{ fontSize: 15, fontWeight: '900', color: p.text, marginTop: 6 }} numberOfLines={1}>{t.destination || t.route?.destination || 'Destination'}</Text>
            {t.route?.name ? <Text style={{ fontSize: 11, color: p.muted }} numberOfLines={1}>{t.route.name}{t.route.distanceKm ? ` · ${t.route.distanceKm} km` : ''}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: p.text }}>{inr(t.seatFare)}</Text>
            <Text style={{ fontSize: 10.5, color: p.sub, fontWeight: '700' }}>per seat</Text>
            {t.fullAutoFare ? <Text style={{ fontSize: 10.5, color: '#8B5CF6', fontWeight: '800', marginTop: 4 }}>Full {inr(t.fullAutoFare)}</Text> : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: p.text }}>🕒 {fmtDeparture(t.departureAt)}</Text>
          <Text style={{ fontSize: 11, color: p.muted }}>{fromNow(t.departureAt, now)}</Text>
        </View>

        <View style={{ marginTop: 10 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: p.card2, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(filled * 100)}%`, height: 8, backgroundColor: filled >= 1 ? p.danger : filled >= 0.75 ? '#F97316' : p.success }} />
          </View>
          <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 5 }}>
            <Text style={{ fontWeight: '900', color: p.text }}>{t.confirmedSeats}/{t.capacity}</Text> booked
            {t.heldSeats ? ` · ${t.heldSeats} on hold` : ''} · <Text style={{ fontWeight: '900', color: t.remainingSeats ? p.success : p.danger }}>{t.remainingSeats} left</Text>
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 12, color: p.text, fontWeight: '800' }}>👤 {t.driver?.name || 'Driver'}</Text>
          <VerifiedBadge verified={!!t.driver?.verified} />
          {t.driver?.rating ? <Text style={{ fontSize: 11, color: p.sub }}>★ {t.driver.rating.avg.toFixed(1)} ({t.driver.rating.count})</Text> : null}
          {t.vehicle?.registration ? <Text style={{ fontSize: 11, color: p.sub }}>🔢 {t.vehicle.registration}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Badge label={t.sharedBookingAllowed ? 'SEAT BOOKING OPEN' : 'SEAT BOOKING CLOSED'} color={t.sharedBookingAllowed ? '#10B981' : '#64748B'} />
          <Badge label={t.privateBookingAllowed ? 'FULL AUTO POSSIBLE' : t.fullAutoFare ? 'FULL AUTO NOT POSSIBLE NOW' : 'NO FULL AUTO'} color={t.privateBookingAllowed ? '#8B5CF6' : '#64748B'} />
          {t.seatSelectionEnabled ? <Badge label="PICK YOUR SEAT" color="#0EA5E9" /> : null}
        </View>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingTop: 0 }}>
        {mine ? (
          <Btn label={t.myBookingStatus === 'HELD' ? 'Finish booking' : 'My booking'} icon="🎫" small style={{ flex: 1 }} onPress={t.myBookingStatus === 'HELD' ? onBook : onMine} />
        ) : (
          <>
            <Btn label="View Auto" kind="secondary" small style={{ flex: 1 }} onPress={onView} />
            {mode === 'shared' ? <Btn label="Book Seats" small style={{ flex: 1.2 }} onPress={onBook} disabled={!t.sharedBookingAllowed} /> : null}
            {t.fullAutoFare ? <Btn label="Book Full Auto" kind={mode === 'full' ? 'primary' : 'ghost'} small style={{ flex: 1.2 }} onPress={onFull} disabled={!t.privateBookingAllowed} /> : null}
          </>
        )}
      </View>
    </Card>
  );
}

// ── My Auto Bookings ────────────────────────────────────────────────────────
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
      <Chips value={scope} onChange={(v: 'upcoming' | 'past') => setScope(v)} options={[{ key: 'upcoming', label: '⏳ Upcoming' }, { key: 'past', label: '🗂️ Past' }]} />
      <View style={{ height: 12 }} />
      {openReqs.length ? (
        <View style={{ marginBottom: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '900', color: p.sub, letterSpacing: 1, marginBottom: 8 }}>FULL-AUTO REQUESTS</Text>
          {openReqs.map((r) => {
            const m = PRIVATE_STATUS_META[r.status];
            return (
              <TouchableOpacity key={r.id} onPress={() => router.push(`/auto-ride/request/${r.id}` as any)} accessibilityRole="button" accessibilityLabel={`Full-auto request, ${m.label}`}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 24 }}>🔒</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontWeight: '900', color: p.text }}>Full auto · {r.passengers} passenger{r.passengers === 1 ? '' : 's'}</Text>
                    <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }}>{inr(r.fare)} · {r.status === 'REQUESTED' && r.respondBy ? `driver answers ${fromNow(r.respondBy)}` : (r.declineReason || m.label)}</Text>
                  </View>
                  <Badge label={`${m.icon} ${m.label.toUpperCase()}`} color={m.color} />
                </Card>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {bookings === null && !error ? <StateView kind="loading" message="Loading your auto bookings…" /> : error && !bookings ? (
        <StateView kind="error" title={error.isNetwork ? 'You seem to be offline' : 'Could not load'} message={error.message} actionLabel="Retry" onAction={load} />
      ) : (bookings || []).length === 0 ? (
        <StateView kind="empty" icon="🎫" title={scope === 'upcoming' ? 'No upcoming auto bookings' : 'No past auto bookings'} message={scope === 'upcoming' ? 'Book a seat on a shared auto and it shows up here with your booking code and PIN.' : 'Completed and cancelled bookings appear here.'} />
      ) : (
        (bookings || []).map((b) => <BookingRow key={b.id} b={b} onPress={() => router.push(`/auto-ride/booking/${b.id}` as any)} />)
      )}
    </View>
  );
}

function BookingRow({ b, onPress }: { b: Booking; onPress: () => void }) {
  const p = usePalette();
  const m = BOOKING_STATUS_META[b.status];
  const t = b.trip;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={`Booking ${b.bookingCode}, ${m.label}`}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: p.text, letterSpacing: 1 }}>{b.bookingCode}</Text>
          {b.type === 'PRIVATE' ? <Badge label="FULL AUTO" color="#8B5CF6" /> : null}
          <View style={{ flex: 1 }} />
          <Badge label={`${m.icon} ${m.label.toUpperCase()}`} color={m.color} />
        </View>
        <Text style={{ fontSize: 14.5, fontWeight: '900', color: p.text, marginTop: 8 }} numberOfLines={1}>
          {t?.pickup?.name || 'Pickup'} → {t?.destination || 'Destination'}
        </Text>
        <Text style={{ fontSize: 12, color: p.sub, marginTop: 3 }}>
          🕒 {fmtDeparture(t?.departureAt)} · {b.seatCount} seat{b.seatCount === 1 ? '' : 's'}{b.seatNumbers.length && b.type === 'SHARED' ? ` (${b.seatNumbers.join(', ')})` : ''} · {inr(b.amount)}
        </Text>
        {t && LIVE_BOOKING.includes(b.status) ? <View style={{ marginTop: 8 }}><StatusChip trip={t} /></View> : null}
      </Card>
    </TouchableOpacity>
  );
}

// ── Nearby Pickup Points ────────────────────────────────────────────────────
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
    if (error.code === 'FEATURE_OFF') return <StateView kind="empty" icon="🛺" title="Zenvy Auto is not open yet" message={error.message} />;
    return <StateView kind="error" title={error.isNetwork ? 'You seem to be offline' : 'Could not load'} message={error.message} actionLabel="Retry" onAction={load} />;
  }
  return (
    <View>
      <Notice tone="info">📍 {data?.note || 'Pickup stands set by Zenvy.'} Your phone's location is not used.</Notice>
      {groups.length === 0 ? <StateView kind="empty" icon="📍" title="No pickup points yet" message="Zenvy has not set up auto stands yet." /> : null}
      {groups.map((g) => (
        <View key={g.route?.id || 'none'} style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '900', color: p.sub, letterSpacing: 1, marginBottom: 8 }}>
            {(g.route ? `${g.route.origin || ''} → ${g.route.destination || g.route.name}` : 'OTHER').toUpperCase()}
          </Text>
          {g.points.map((x) => (
            <Card key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }} onPress={() => router.push(`/auto-ride/pickup/${x.id}` as any)}
                accessibilityRole="button" accessibilityLabel={`${x.name}, view live queue`}>
                <Text style={{ fontSize: 24 }}>🚏</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: p.text }}>{x.name}</Text>
                  {x.landmark ? <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }}>{x.landmark}</Text> : null}
                  <Text style={{ fontSize: 11, color: p.accent, fontWeight: '800', marginTop: 3 }}>View live queue ›</Text>
                </View>
              </TouchableOpacity>
              {x.mapsUrl ? (
                <Btn label="Maps" icon="🗺️" kind="secondary" small onPress={() => Linking.openURL(x.mapsUrl!).catch(() => Alert.alert('Could not open maps'))} />
              ) : null}
            </Card>
          ))}
        </View>
      ))}
    </View>
  );
}
