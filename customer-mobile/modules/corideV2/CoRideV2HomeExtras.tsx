/**
 * Co-Ride v2 home additions (owner, 24 Oct), all from real data, hidden when there is none:
 *  - LeavingNow: offers leaving in the next 60 min + ZCS Auto autos on charge at the SRM AP Main Gate stand.
 *  - PopularRoutes: the real ZCS Auto routes (autoRideApi.routes) with live seats and the seat-fare range.
 *  - AutoMatch: on Find, the autos running to the searched destination.
 *  - WeekendTrips: long-distance rides on the coming Fri–Sun.
 *  - Savings: this month, completed rides where I rode, vs a full ZCS Auto on the same route.
 *  - SafetyCard: women-only rides (Find filter) and SOS (to the ride I am on, when there is one).
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { CR, R, GUTTER, W, shadow } from './coRideV2Theme';
import { Tap, Pill, SectionTitle } from './CoRideV2Kit';
import { IClock, IUsers, IArrowRight, IShield, ISiren, ICoins, IChevronRight, ICalendar, STROKE } from './CoRideV2Icons';
import { NearbyRideCard, whenOf, seatsText } from './CoRideV2RideCard';
import { useCoRide, isOffer, shareOf, type Ride } from './coRideV2Data';
import { useNav } from './coRideV2Nav';
import { inr, myRideInfo, sameDestination } from '../../modules/coride/coRideFormat';
import type { ChargeLine, RouteFull } from '../../modules/autoRide/autoRideApi';

const t = (r: Ride) => new Date(r.departureTime).getTime() || 0;
const lineSeats = (l: ChargeLine) => (l.onCharge?.remainingSeats || 0) + (l.waitingAutos || []).reduce((n, a) => n + (a.remainingSeats || 0), 0);
const fareText = (min?: number | null, max?: number | null) => (min && max ? (min === max ? inr(min) : `${inr(min)}–${inr(max)}`) : min ? inr(min) : null);
const LONG = ['hyderabad', 'vizag', 'visakhapatnam', 'tirupati', 'rajahmundry', 'rajamahendravaram', 'kakinada', 'nellore', 'chennai', 'bengaluru', 'bangalore', 'ongole', 'kurnool', 'warangal', 'eluru', 'srikakulam', 'anantapur', 'kadapa'];
export const isLongDistance = (r: Ride) => LONG.some((c) => String(r.destination || '').toLowerCase().includes(c));

function MiniCard({ tag, tone, title, meta, onPress }: { tag: string; tone: 'blue' | 'green'; title: string; meta: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} label={`${tag}. ${title}. ${meta}`} style={st.mini}>
      <Pill text={tag} tone={tone} icon={IClock} />
      <Text style={st.miniTitle} numberOfLines={1}>{title}</Text>
      <Text style={st.miniMeta} numberOfLines={1}>{meta}</Text>
    </Tap>
  );
}

export function LeavingNow() {
  const d = useCoRide();
  const { push } = useNav();
  const now = Date.now();
  const rides = d.rides.filter((r) => isOffer(r) && t(r) - now <= 60 * 60000 && t(r) - now > -10 * 60000).sort((a, b) => t(a) - t(b));
  const autos = (d.autoLines || []).filter((l) => l.onCharge && /main gate/i.test(l.pickup?.name || ''));
  if (d.ridesLoading && !rides.length) return null;
  return (
    <View style={{ marginTop: 18 }}>
      <SectionTitle title="Leaving now" style={{ paddingHorizontal: GUTTER, marginBottom: 8 }} />
      {rides.length || autos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: GUTTER, paddingBottom: 4 }}>
          {rides.map((r) => {
            const w = whenOf(r); const sh = shareOf(r);
            return <MiniCard key={r.id} tag={w.relative === 'Leaving now' ? 'Leaving now' : `Leaving ${w.relative || w.time}`} tone="blue" title={`${r.origin} → ${r.destination}`} meta={`${seatsText(Number(r.availableSeats) || 0)} · ${sh ? `${inr(sh.max)} per person` : 'Free'}`} onPress={() => push({ name: 'ride', id: String(r.id) })} />;
          })}
          {autos.map((l) => (
            <MiniCard key={l.key} tag="Auto on charge" tone="green" title={`${l.pickup?.name || 'Stand'} → ${l.destination || l.route?.destination || ''}`} meta={`${seatsText(l.onCharge!.remainingSeats)} left · ${inr(l.onCharge!.seatFare)} per seat`} onPress={() => push({ name: 'auto', key: l.key })} />
          ))}
        </ScrollView>
      ) : (
        <Tap onPress={() => push({ name: 'post', role: 'rider' })} label="No rides leaving right now. Offer a seat" style={st.emptyRow}>
          <Text style={st.emptyText}>No rides leaving right now</Text>
          <Text style={st.link}>Offer a seat</Text>
          <IArrowRight size={15} color={CR.primary} strokeWidth={STROKE} />
        </Tap>
      )}
    </View>
  );
}

export function PopularRoutes() {
  const d = useCoRide();
  const { push } = useNav();
  const routes = [...d.autoRoutes].filter((r) => r.isActive !== false && r.destination).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  if (!routes.length) return null;
  const seatsFor = (r: RouteFull) => (d.autoLines || []).filter((l) => l.route?.id === r.id).reduce((n, l) => n + lineSeats(l), 0);
  return (
    <View style={{ marginTop: 18 }}>
      <SectionTitle title="Popular routes" style={{ paddingHorizontal: GUTTER, marginBottom: 8 }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: GUTTER }}>
        {routes.map((r) => {
          const seats = seatsFor(r); const fare = fareText(r.seatFareMin, r.seatFareMax);
          return (
            <Tap key={r.id} onPress={() => push({ name: 'find', to: String(r.destination) })} label={`${r.destination}${fare ? `, ${fare} a seat` : ''}`} style={st.route}>
              <Text style={st.routeName} numberOfLines={1}>{r.destination}</Text>
              <Text style={st.routeMeta} numberOfLines={1}>{[fare ? `${fare} seat` : null, seats ? `${seats} seats now` : null].filter(Boolean).join(' · ') || 'ZENV Auto route'}</Text>
            </Tap>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Find: autos to the searched destination (on charge or waiting), one tap to the board. */
export function AutoMatch({ to }: { to: string }) {
  const d = useCoRide();
  const { push } = useNav();
  const q = to.trim().toLowerCase();
  if (!q || !d.autoOn) return null;
  const lines = (d.autoLines || []).filter((l) => String(l.destination || l.route?.destination || '').toLowerCase().includes(q));
  if (!lines.length) return null;
  const seats = lines.reduce((n, l) => n + lineSeats(l), 0);
  const fares = lines.map((l) => l.onCharge?.seatFare || l.seatFare || 0).filter(Boolean);
  return (
    <Tap onPress={() => push({ name: 'auto', key: lines[0].key })} label={`ZENV Auto to ${to}`} style={st.autoMatch}>
      <View style={{ flex: 1 }}>
        <Text style={st.autoTitle}>ZENV Auto to {lines[0].destination || to}</Text>
        <Text style={st.miniMeta}>{seats ? `${seatsText(seats)} on the board now` : 'No auto on charge right now'}{fares.length ? ` · ${fareText(Math.min(...fares), Math.max(...fares))} per seat` : ''}</Text>
      </View>
      <IChevronRight size={18} color={CR.mintInk} strokeWidth={STROKE} />
    </Tap>
  );
}

export function WeekendTrips() {
  const d = useCoRide();
  const { push } = useNav();
  const now = Date.now();
  const list = d.rides.filter((r) => isOffer(r) && isLongDistance(r) && t(r) > now && t(r) - now < 8 * 86400000 && [0, 5, 6].includes(new Date(t(r) + 330 * 60000).getUTCDay())).sort((a, b) => t(a) - t(b));
  return (
    <View style={{ paddingHorizontal: GUTTER, marginTop: 22 }}>
      <SectionTitle title="Going home this weekend?" action={list.length > 2 ? 'See all' : undefined} onAction={() => push({ name: 'find' })} />
      {list.slice(0, 2).map((r) => <NearbyRideCard key={r.id} ride={r} onPress={() => push({ name: 'ride', id: String(r.id) })} />)}
      <Tap onPress={() => push({ name: 'post', role: 'rider', weekend: true })} label="Post a weekend ride home" style={st.weekend}>
        <View style={st.weekendIcon}><ICalendar size={20} color={CR.primary} strokeWidth={STROKE} /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.autoTitle}>{list.length ? 'Driving home too?' : 'No weekend rides posted yet'}</Text>
          <Text style={st.miniMeta}>Post a long trip days ahead. Students book one seat each.</Text>
        </View>
        <IChevronRight size={18} color={CR.primary} strokeWidth={STROKE} />
      </Tap>
    </View>
  );
}

/** Only from real completed rides I rode this month, vs the route's full-auto fare. Hidden when nothing to show. */
export function Savings() {
  const d = useCoRide();
  const saved = useMemo(() => {
    const ist = new Date(Date.now() + 330 * 60000);
    let total = 0; let rides = 0;
    d.myRides.forEach((r) => {
      const i = myRideInfo(r, d.myId);
      if (i.isCreator || r.status !== 'Completed' || i.myStatus !== 'Approved') return;
      const dep = new Date(t(r) + 330 * 60000);
      if (dep.getUTCFullYear() !== ist.getUTCFullYear() || dep.getUTCMonth() !== ist.getUTCMonth()) return;
      const route = d.autoRoutes.find((x) => sameDestination(x.destination, r.destination));
      if (!route?.fullFareMin) return;
      const paid = Number(r.estimatedFuelCost) > 0 ? Math.ceil(Number(r.estimatedFuelCost) / (i.approved.length + 1)) : 0;
      if (route.fullFareMin > paid) { total += route.fullFareMin - paid; rides += 1; }
    });
    return rides ? { total, rides } : null;
  }, [d.myRides, d.myId, d.autoRoutes]);
  if (!saved) return null;
  return (
    <View style={[st.savings, { marginHorizontal: GUTTER }]}>
      <ICoins size={20} color={CR.green} strokeWidth={STROKE} />
      <View style={{ flex: 1 }}>
        <Text style={st.autoTitle}>You saved {inr(saved.total)} this month</Text>
        <Text style={st.miniMeta}>{saved.rides} shared ride{saved.rides === 1 ? '' : 's'}, compared with a full ZENV Auto on the same route</Text>
      </View>
    </View>
  );
}

export function SafetyCard() {
  const { push, openSheet } = useNav();
  const d = useCoRide();
  // SOS goes to the ride I am on now (host or confirmed rider, leaving within ±3 h), if any.
  const now = Date.now();
  const active = d.myRides.find((r) => { const i = myRideInfo(r, d.myId); const dt = t(r) - now; return i.isOpenRide && (i.isCreator || i.myStatus === 'Approved') && dt < 3 * 3600000 && dt > -3 * 3600000; });
  return (
    <View style={{ paddingHorizontal: GUTTER, marginTop: 22 }}>
      <SectionTitle title="Safety first" />
      <View style={st.safety}>
        <Tap onPress={() => push({ name: 'find', women: true })} label="Women-only rides" style={st.safetyItem}>
          <IShield size={20} color={CR.primary} strokeWidth={STROKE} />
          <Text style={st.safetyText}>Women-only rides</Text>
        </Tap>
        <View style={st.vline} />
        <Tap onPress={() => openSheet({ kind: 'sos', rideId: active ? String(active.id) : undefined })} label="SOS and emergency numbers" style={st.safetyItem}>
          <ISiren size={20} color={CR.red} strokeWidth={STROKE} />
          <Text style={st.safetyText}>SOS</Text>
        </Tap>
        <View style={st.vline} />
        <View style={st.safetyItem}>
          <IUsers size={20} color={CR.ink2} strokeWidth={STROKE} />
          <Text style={st.safetyText}>Numbers shared only once confirmed</Text>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  mini: { width: 228, backgroundColor: CR.card, borderRadius: R.lg, padding: 12, gap: 6, ...shadow(1) },
  miniTitle: { fontSize: 14, fontWeight: W.label, color: CR.ink, marginTop: 2 },
  miniMeta: { fontSize: 12.5, color: CR.muted, lineHeight: 17 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: GUTTER, backgroundColor: CR.card, borderRadius: R.md, paddingHorizontal: 14, minHeight: 48, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line },
  emptyText: { flex: 1, fontSize: 13.5, color: CR.ink2 },
  link: { fontSize: 13.5, color: CR.primary, fontWeight: W.label },
  route: { backgroundColor: CR.card, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10, minWidth: 120, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line },
  routeName: { fontSize: 14, fontWeight: W.label, color: CR.ink },
  routeMeta: { fontSize: 12, color: CR.muted, marginTop: 2 },
  autoMatch: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CR.mint, borderRadius: R.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: CR.mintLine },
  autoTitle: { fontSize: 14.5, fontWeight: W.title, color: CR.ink },
  weekend: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CR.card, borderRadius: R.lg, padding: 14, ...shadow(1) },
  weekendIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: CR.tint, alignItems: 'center', justifyContent: 'center' },
  savings: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CR.greenSoft, borderRadius: R.lg, padding: 14, marginTop: 14 },
  safety: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: CR.card, borderRadius: R.lg, paddingVertical: 12, ...shadow(1) },
  safetyItem: { flex: 1, alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  safetyText: { fontSize: 12, color: CR.ink2, textAlign: 'center', lineHeight: 16 },
  vline: { width: StyleSheet.hairlineWidth * 2, backgroundColor: CR.lineSoft },
});
