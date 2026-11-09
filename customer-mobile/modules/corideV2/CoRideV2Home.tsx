/**
 * Co-Ride v2 home (reference, pin to pin): header, hero and route card (CoRideV2HomeTop), the two service
 * cards (Bike & car pool / Shared auto with real per-person ranges), quick actions (Need a lift? / Offer a
 * seat), the Karma row (real user.karmaPoints, +50 per completed ride), the Find / Give / My rides control
 * and Nearby rides from real posts. Nothing posted yet: a clean empty state with "Offer a seat" first.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { CR, R, GUTTER, W, shadow } from './coRideV2Theme';
import { Tap, Segmented, SectionTitle, Pill } from './CoRideV2Kit';
import { IArrowRight, IUsers, IGift, IBadge, IChevronRight, ISearch, ICarSide, ICar, IHand, IList, IBike, ICheckCircle, STROKE } from './CoRideV2Icons';
import { ART, ART_RATIO } from './coRideV2Art';
import { Hero, RouteCard } from './CoRideV2HomeTop';
import { LeavingNow, PopularRoutes, WeekendTrips, Savings, SafetyCard } from './CoRideV2HomeExtras';
import { NearbyRideCard, whenOf } from './CoRideV2RideCard';
import { RideSkeleton, StateCard, NetState } from './CoRideV2States';
import { useCoRide, KARMA_PER_RIDE, isOffer } from './coRideV2Data';
import { useNav } from './coRideV2Nav';
import { inr, fmtClock12 } from '../../modules/coride/coRideFormat';
import { themedSheet } from '../../utils/themeNow';

type Tab = 'lift' | 'give' | 'mine';
const range = (r: { min: number; max: number } | null) => (r ? (r.min === r.max ? inr(r.min) : `${inr(r.min)}–${inr(r.max)}`) : null);

function ServiceCard({ title, body, art, ratio, price, badge, tone, onPress, width }: {
  title: string; body: string; art?: any; ratio: number; price: string | null; badge?: string; tone: 'blue' | 'mint'; onPress: () => void; width: number;
}) {
  const blue = tone === 'blue';
  const artW = width - 24;
  return (
    <Tap onPress={onPress} label={`${title}. ${body}${price ? `. ${price}` : ''}`} style={[st.service, { width, borderColor: blue ? CR.tint2 : CR.mintLine }]}>
      <LinearGradient colors={blue ? [CR.card, CR.tint] : [CR.card, CR.mint]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      {badge ? <View style={st.badge}><Text style={st.badgeText}>{badge}</Text></View> : null}
      <View style={{ height: Math.min(84, artW / Math.max(1.3, ratio) + 6), justifyContent: 'flex-end', alignItems: 'center', marginTop: 8 }}>
        {art ? <Image source={art} style={{ width: Math.min(artW, 84 * ratio), height: Math.min(84, artW / ratio) }} contentFit="contain" accessibilityElementsHidden /> : <PoolIcons />}
      </View>
      <Text style={st.serviceTitle} numberOfLines={1}>{title}</Text>
      <Text style={st.serviceBody} numberOfLines={2}>{body}</Text>
      <View style={st.serviceFoot}>
        <IUsers size={15} color={blue ? CR.primary : CR.mintInk} strokeWidth={STROKE} />
        <Text style={st.servicePrice} numberOfLines={2}>{price ? <>{price}<Text style={st.per}> /person</Text></> : <Text style={st.per}>{blue ? 'Split the fuel' : 'Opening soon'}</Text>}</Text>
        <View style={[st.arrow, { backgroundColor: blue ? CR.primary : CR.mintInk }]}><IArrowRight size={17} color="#FFFFFF" strokeWidth={1.8} /></View>
      </View>
    </Tap>
  );
}

/** Quick actions are photo-free (owner: never repeat a picture; the pool card already shows the scooter
 *  and car): one thin line icon on a subtle gradient. */
/** Pool card art without repeating the hero picture: car, bike and people as one calm line-icon group. */
function PoolIcons() {
  return (
    <View style={st.poolIcons} accessibilityElementsHidden>
      <View style={[st.poolDisc, { width: 64, height: 64, borderRadius: 32 }]}><ICarSide size={30} color={CR.primary} strokeWidth={1.5} /></View>
      <View style={[st.poolDisc, st.poolSmall, { left: 6 }]}><IBike size={18} color={CR.primary} strokeWidth={1.6} /></View>
      <View style={[st.poolDisc, st.poolSmall, { right: 6 }]}><IUsers size={18} color={CR.primary} strokeWidth={1.6} /></View>
    </View>
  );
}

function QuickCard({ solid, title, body, icon: Icon, badge: Badge, onPress, width, status }: { solid: boolean; title: string; body: string; icon: any; badge?: any; onPress: () => void; width: number; status?: { text: string; done: boolean } | null }) {
  return (
    <Tap onPress={onPress} label={`${title} ${body}`} style={[st.quick, { width }]}>
      <LinearGradient colors={solid ? [CR.primarySoft, CR.primaryDeep] : [CR.tint, CR.tint2]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <View style={[st.quickIcon, { backgroundColor: solid ? 'rgba(255,255,255,0.16)' : CR.card, borderColor: solid ? 'rgba(255,255,255,0.28)' : CR.tint2 }]}>
        <Icon size={24} color={solid ? '#FFFFFF' : CR.primary} strokeWidth={STROKE} />
        {Badge ? <View style={[st.quickBadge, { backgroundColor: solid ? CR.primaryDeep : CR.primary }]}><Badge size={12} color="#FFFFFF" strokeWidth={1.8} /></View> : null}
      </View>
      <Text style={[st.quickTitle, { color: solid ? '#FFFFFF' : CR.primaryDeep }]} numberOfLines={1}>{title}</Text>
      <Text style={[st.quickBody, { color: solid ? 'rgba(255,255,255,0.88)' : CR.ink2 }]} numberOfLines={2}>{body}</Text>
      {status ? <View style={[st.row, { gap: 4, marginTop: 6 }]}>{status.done ? <ICheckCircle size={13} color={CR.green} strokeWidth={1.8} /> : null}<Text style={[st.quickStatus, { color: status.done ? CR.green : CR.primary }]} numberOfLines={1}>{status.text}</Text></View> : null}
      <View style={[st.quickArrow, { backgroundColor: CR.card }]}><IArrowRight size={17} color={CR.primary} strokeWidth={1.8} /></View>
    </Tap>
  );
}

function MyRideLine({ ride }: { ride: any }) {
  const { push } = useNav();
  const w = whenOf(ride);
  return (
    <Tap onPress={() => push({ name: 'mine' })} label={`My ride to ${ride.destination}`} style={st.mineLine}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.mineTitle} numberOfLines={1}>{ride.origin} → {ride.destination}</Text>
        <Text style={st.mineSub}>{w.label}</Text>
      </View>
      <IChevronRight size={18} color={CR.primary} strokeWidth={STROKE} />
    </Tap>
  );
}

/** The home body under the Others shell's blue Co-Ride header (the shell owns the scroll view). */
export function CoRideV2HomeBody() {
  const d = useCoRide();
  const { push, openSheet } = useNav();
  const { width } = useWindowDimensions();
  const pageW = Math.min(width, 520);
  const half = Math.floor((pageW - GUTTER * 2 - 12) / 2);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<Tab>('lift');
  // A regular ride running today (server templates): "Home after college · today 5:30 PM · Posted".
  const todayReg = useMemo(() => {
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const clock = (iso: string, minus = 0) => fmtClock12(new Date(new Date(iso).getTime() - minus * 60000));
    for (const t of d.templates || []) {
      if (!t.active) continue;
      const up = t.upcomingRide;
      if (up && up.rideDate === today && up.status !== 'Cancelled' && new Date(up.departureAt).getTime() > Date.now()) return { name: t.name || t.destination, at: clock(up.departureAt), posted: true, postsAt: '' };
      if (t.nextDepartureAt && new Date(new Date(t.nextDepartureAt).getTime() + 330 * 60000).toISOString().slice(0, 10) === today) return { name: t.name || t.destination, at: clock(t.nextDepartureAt), posted: false, postsAt: clock(t.nextDepartureAt, 150) };
    }
    return null;
  }, [d.templates]);
  const lifts = useMemo(() => d.rides.filter(isOffer).sort((a, b) => +new Date(a.departureTime) - +new Date(b.departureTime)), [d.rides]);
  const asks = useMemo(() => d.rides.filter((r) => !isOffer(r)), [d.rides]);
  const list = tab === 'lift' ? lifts : asks;

  const body = () => {
    if (tab === 'mine') {
      if (d.myLoading) return <RideSkeleton count={2} />;
      const net = <NetState connection={d.connection} error={d.myError} onRetry={d.reload} what="your rides" />;
      if (d.myError || d.connection !== 'online') return net;
      return d.myGroups.upcoming.length
        ? <View style={[st.mineCard, shadow(1)]}>{d.myGroups.upcoming.slice(0, 3).map((r) => <MyRideLine key={r.id} ride={r} />)}</View>
        : <StateCard title="No upcoming rides" body="Rides you post or ask to join show up here." action="Find a lift" onAction={() => setTab('lift')} />;
    }
    if (d.ridesLoading) return <RideSkeleton count={2} />;
    if (d.connection !== 'online' || (d.ridesError && !d.rides.length)) return <NetState connection={d.connection} error={d.ridesError} onRetry={d.reload} />;
    if (!list.length) {
      return tab === 'lift'
        ? <StateCard art title="No rides posted yet" body="Be the first: offer a seat on your way out, and students heading the same way can join you." action="Offer a seat" onAction={() => push({ name: 'post', role: 'rider' })} secondary="Ask for a lift" onSecondary={() => push({ name: 'post', role: 'passenger' })} />
        : <StateCard art title="Nobody is asking for a lift" body="When students post that they need a ride, they show up here." action="Offer a seat" onAction={() => push({ name: 'post', role: 'rider' })} />;
    }
    return list.slice(0, 3).map((r) => <NearbyRideCard key={r.id} ride={r} onPress={() => push({ name: 'ride', id: String(r.id) })} />);
  };

  return (
    <View style={{ paddingBottom: 40, backgroundColor: CR.page }}>
      <LinearGradient colors={[CR.heroTop, CR.heroBottom, CR.page]} locations={[0, 0.7, 1]} style={st.topBg} />
      <Hero />
      <RouteCard from={from} to={to} setFrom={setFrom} setTo={setTo} places={d.places} onSearch={() => push({ name: 'find', from: from.trim(), to: to.trim() })} />

      <View style={[st.pad, st.services]}>
        <ServiceCard tone="blue" title="Bike & car pool" body="Share rides, split fuel costs and save money" art={ART.pool} ratio={ART_RATIO.pool} price={range(d.pool)} width={half} onPress={() => push({ name: 'find' })} />
        <ServiceCard tone="mint" title="Shared auto" body="Book a shared auto, travel together" art={ART.auto} ratio={ART_RATIO.auto} price={d.autoOn ? range(d.autoFare) : null} width={half} onPress={() => push({ name: 'auto' })} />
      </View>

      <LeavingNow />
      <PopularRoutes />
      <View style={st.pad}>
        <SectionTitle title="Quick actions" style={{ marginTop: 22 }} />
        <View style={st.quickRow}>
          <QuickCard solid title="Need a lift?" body="Ask for a ride and split the fuel" icon={IHand} width={half} onPress={() => push({ name: 'post', role: 'passenger' })} />
          <QuickCard solid={false} title="Offer a seat" body={todayReg ? `${todayReg.name} · today ${todayReg.at}` : 'Share seats, share the fuel cost'} status={todayReg ? { text: todayReg.posted ? 'Posted' : `Posts by ${todayReg.postsAt}`, done: todayReg.posted } : null} icon={ICar} badge={IUsers} width={half} onPress={() => (todayReg ? push({ name: 'regular' }) : push({ name: 'post', role: 'rider' }))} />
        </View>

        <Tap onPress={() => openSheet({ kind: 'karma' })} label={`Karma ${d.karma}. Plus ${KARMA_PER_RIDE} per completed ride`} style={st.karma}>
          <IBadge size={20} color={CR.primary} strokeWidth={STROKE} />
          <Text style={st.karmaText}>Karma <Text style={{ fontWeight: W.title }}>{d.karma}</Text></Text>
          <View style={st.karmaDivider} />
          <Text style={st.karmaRule} numberOfLines={1}><Text style={{ color: CR.primary, fontWeight: W.label }}>+{KARMA_PER_RIDE}</Text> per completed ride</Text>
          <IGift size={20} color={CR.primary} strokeWidth={STROKE} />
          <IChevronRight size={16} color={CR.primary} strokeWidth={STROKE} />
        </Tap>

        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          style={{ marginTop: 14 }}
          options={[{ key: 'lift', label: 'Find a lift', icon: ISearch }, { key: 'give', label: 'Give a lift', icon: ICarSide }, { key: 'mine', label: 'My rides', icon: IList }]}
        />

        <SectionTitle
          title={tab === 'lift' ? 'Nearby rides' : tab === 'give' ? 'Students asking for a lift' : 'Your upcoming rides'}
          action={tab === 'mine' ? 'Open My rides' : list.length ? 'See all rides' : undefined}
          onAction={() => (tab === 'mine' ? push({ name: 'mine' }) : push({ name: 'find', kind: tab === 'give' ? 'give' : 'lift' }))}
          style={{ marginTop: 22 }}
        />
        {tab === 'give' && list.length ? <Pill text="Pick one to offer your seat" tone="blue" style={{ marginBottom: 10 }} /> : null}
        {body()}
      </View>
      <WeekendTrips />
      <Savings />
      <SafetyCard />
    </View>
  );
}

const st = themedSheet(() => ({
  topBg: { position: 'absolute', left: 0, right: 0, top: 0, height: 360 },
  pad: { paddingHorizontal: GUTTER },
  services: { flexDirection: 'row', gap: 12, marginTop: 14 },
  service: { borderRadius: R.lg, borderWidth: 1, padding: 12, overflow: 'hidden', backgroundColor: CR.card, ...shadow(1) },
  badge: { position: 'absolute', top: 8, right: 8, zIndex: 2, backgroundColor: CR.primary, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: W.label },
  serviceTitle: { marginTop: 8, fontSize: 15.5, fontWeight: W.title, color: CR.ink, letterSpacing: -0.2 },
  serviceBody: { marginTop: 3, fontSize: 12, lineHeight: 16.5, color: CR.ink2, minHeight: 33 },
  serviceFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  servicePrice: { flex: 1, fontSize: 12, color: CR.ink, fontWeight: W.label },
  per: { color: CR.muted, fontWeight: W.body },
  arrow: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  quickRow: { flexDirection: 'row', gap: 12 },
  quick: { borderRadius: R.lg, minHeight: 132, padding: 14, paddingRight: 48, overflow: 'hidden' },
  quickIcon: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  quickBadge: { position: 'absolute', right: -5, bottom: -5, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: CR.card },
  quickTitle: { fontSize: 15, fontWeight: W.title, letterSpacing: -0.2 },
  quickBody: { marginTop: 3, fontSize: 12, lineHeight: 16.5 },
  quickStatus: { fontSize: 12, fontWeight: W.label },
  row: { flexDirection: 'row', alignItems: 'center' },
  poolIcons: { width: 120, height: 72, alignItems: 'center', justifyContent: 'center' },
  poolDisc: { backgroundColor: CR.card, borderWidth: 1, borderColor: CR.tint2, alignItems: 'center', justifyContent: 'center' },
  poolSmall: { position: 'absolute', bottom: 0, width: 34, height: 34, borderRadius: 17 },
  quickArrow: { position: 'absolute', right: 12, bottom: 12, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  karma: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: CR.card, borderRadius: R.md, paddingHorizontal: 14, minHeight: 50, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line },
  karmaText: { fontSize: 14, color: CR.ink },
  karmaDivider: { width: StyleSheet.hairlineWidth * 2, height: 18, backgroundColor: CR.line, marginHorizontal: 4 },
  karmaRule: { flex: 1, fontSize: 12.5, color: CR.ink2 },
  mineCard: { backgroundColor: CR.card, borderRadius: R.lg, paddingHorizontal: 14 },
  mineLine: { flexDirection: 'row', alignItems: 'center', minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: CR.lineSoft },
  mineTitle: { fontSize: 14.5, color: CR.ink, fontWeight: W.label },
  mineSub: { fontSize: 12.5, color: CR.muted, marginTop: 2 },
}));
