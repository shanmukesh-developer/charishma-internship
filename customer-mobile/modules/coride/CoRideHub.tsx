/**
 * Others > Co-Ride: the rides home. "Where do you want to go?" search, Co-ride / Auto tiles, quick
 * actions (Need a lift? / Give a lift?), then Find a lift / Give a lift / My rides. Presentation and
 * screen-local state only: the ride lists, API calls and confirmations stay in app/(tabs)/others.tsx
 * and arrive here as props. Zenvy Auto renders its own section (passed in) while it is switched on.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { PressScale, FadeInUp } from '../others/motion';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useCoRidePalette, Segmented, KarmaLine, RideFilters, RideCard, MyRideCard, RideSkeleton, CoRideState, SectionLabel, Badge,
} from './CoRideUI';
import RideDetailsSheet from './RideDetailsSheet';
import { topDestinations, sameDestination } from './coRideFormat';

type CoTab = 'browse' | 'my-rides' | 'auto';

export interface CoRideHubProps {
  myId: string;
  karma: number;
  autoRideOn: boolean;
  /** Zenvy Auto's own section (AutoRideSection), shown while it is switched on. */
  autoSection: React.ReactNode;
  corideTab: CoTab;
  setCorideTab: (t: CoTab) => void;
  rides: any[];
  loadingRides: boolean;
  rideError: string | null;
  onRetryRides: () => void;
  myRides: any[];
  myRideGroups: { upcoming: any[]; past: any[] };
  loadingMyRides: boolean;
  myRidesError: string | null;
  onRetryMyRides: () => void;
  myJoinStatus: Record<string, string>;
  rideActionBusy: string | null;
  vehicleFilter: string;
  setVehicleFilter: (v: 'All' | 'Bike' | 'Car') => void;
  goingTo: string | null;
  setGoingTo: (d: string | null) => void;
  onJoin: (ride: any) => void;
  onApprove: (rideId: string, requestId: string) => void;
  onDecline: (rideId: string, requestId: string) => void;
  onComplete: (rideId: string) => void;
  onCancel: (rideId: string, kind: 'host' | 'leave' | 'withdraw') => void;
  onWhatsApp: (phone: any) => void;
  onSafety: () => void;
  /** Open "Post a ride" as a host with seats (rider) or as a student asking for a lift (passenger). */
  onPost: (role: 'rider' | 'passenger') => void;
  onSignIn: () => void;
}

export default function CoRideHub(props: CoRideHubProps) {
  const {
    myId, karma, autoRideOn, autoSection, corideTab, setCorideTab, rides, loadingRides, rideError, onRetryRides,
    myRides, myRideGroups, loadingMyRides, myRidesError, onRetryMyRides, myJoinStatus, rideActionBusy,
    vehicleFilter, setVehicleFilter, goingTo, setGoingTo, onJoin, onApprove, onDecline, onComplete, onCancel,
    onWhatsApp, onSafety, onPost, onSignIn,
  } = props;
  const p = useCoRidePalette();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'lift' | 'give'>('lift');
  const [history, setHistory] = useState<'upcoming' | 'past'>('upcoming');
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const mode: 'pool' | 'auto' = corideTab === 'auto' ? 'auto' : 'pool';
  const q = query.trim().toLowerCase();

  // Find a lift = students offering seats; Give a lift = students asking for one.
  const kindRides = useMemo(() => rides.filter((r) => (kind === 'give' ? r.creatorRole === 'passenger' : r.creatorRole !== 'passenger')), [rides, kind]);
  const vehicleRides = useMemo(() => kindRides.filter((r) => vehicleFilter === 'All' || r.vehicleType === vehicleFilter), [kindRides, vehicleFilter]);
  const destinations = useMemo(() => topDestinations(vehicleRides), [vehicleRides]);
  const shown = useMemo(() => {
    const t = (r: any) => new Date(r.departureTime).getTime() || 0;
    return vehicleRides
      .filter((r) => !goingTo || sameDestination(r.destination, goingTo))
      .filter((r) => !q || String(r.destination || '').toLowerCase().includes(q) || String(r.origin || '').toLowerCase().includes(q))
      .sort((a, b) => t(a) - t(b));
  }, [vehicleRides, goingTo, q]);
  const liftCount = rides.filter((r) => r.creatorRole !== 'passenger').length;
  const giveCount = rides.length - liftCount;
  const details = detailsId ? rides.find((r) => String(r.id) === detailsId) || null : null;

  const searchBar = (
    <View style={[s.search, { backgroundColor: p.surface }, p.shadow]}>
      <Ionicons name="search" size={18} color={p.sub} />
      <TextInput
        value={query}
        onChangeText={(t) => { setQuery(t); if (mode === 'auto') return; if (corideTab !== 'browse') setCorideTab('browse'); }}
        placeholder="Search a destination or pickup"
        placeholderTextColor={p.muted}
        style={[s.searchInput, { color: p.text }]}
        maxLength={60}
        returnKeyType="search"
        accessibilityLabel="Where do you want to go?"
      />
      {query ? (
        <PressScale onPress={() => setQuery('')} style={s.clear} accessibilityRole="button" accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={18} color={p.sub} />
        </PressScale>
      ) : null}
    </View>
  );

  const modeTile = (key: 'pool' | 'auto', title: string, sub: string, icon: string, badge?: string) => {
    const on = mode === key;
    return (
      <PressScale
        key={key}
        onPress={() => setCorideTab(key === 'auto' ? 'auto' : 'browse')}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${title}, ${sub}${badge ? `, ${badge}` : ''}`}
        style={[s.modeTile, { backgroundColor: on ? p.accentSoft : p.surface, borderColor: on ? p.accent : 'transparent' }, !on && p.shadow]}
      >
        <View style={[s.modeIcon, { backgroundColor: on ? p.button : p.accentSoft }]}>
          <MaterialCommunityIcons name={icon as any} size={26} color={on ? '#FFFFFF' : p.accent} />
        </View>
        <Text style={[s.modeTitle, { color: p.text }]}>{title}</Text>
        <Text style={[s.modeSub, { color: p.sub }]} numberOfLines={1}>{sub}</Text>
        {badge ? <View style={{ position: 'absolute', top: 10, right: 10 }}><Badge label={badge} tone="warning" /></View> : null}
      </PressScale>
    );
  };

  return (
    <View>
      <Text style={[s.h1, { color: p.text }]} accessibilityRole="header">Where do you want to go?</Text>
      {searchBar}

      <View style={s.modeRow} accessibilityRole="tablist">
        {modeTile('pool', 'Co-ride', 'Bike and car pool', 'account-group')}
        {modeTile('auto', 'Auto', autoRideOn ? 'Book a shared seat' : 'Shared auto seats', 'rickshaw', autoRideOn ? undefined : 'Soon')}
      </View>

      {mode === 'auto' && !autoRideOn ? (
      <View style={[s.offCard, { backgroundColor: p.surface }, p.shadow]}>
        <View style={[s.offIcon, { backgroundColor: p.accentSoft }]}>
          <MaterialCommunityIcons name="rickshaw" size={30} color={p.accent} />
        </View>
        <Text style={[s.offTitle, { color: p.text }]}>Zenvy Auto is opening soon</Text>
        <Text style={[s.offBody, { color: p.sub }]}>Shared autos on fixed campus routes, run by verified drivers. Book a seat, board with a PIN and pay the driver in cash.</Text>
        <View style={s.offList}>
          {[
            ['shield-checkmark-outline', 'Verified drivers and autos'],
            ['grid-outline', 'Pick your seat on a seat map'],
            ['cash-outline', 'Pay the driver in cash when you board'],
          ].map(([icon, text]) => (
            <View key={text} style={s.offRow}>
              <Ionicons name={icon as any} size={18} color={p.accent} />
              <Text style={[s.offRowText, { color: p.text }]}>{text}</Text>
            </View>
          ))}
        </View>
        <PressScale onPress={() => setCorideTab('browse')} style={[s.offBtn, { borderColor: p.accent }]} accessibilityRole="button">
          <Text style={{ color: p.accent, fontWeight: '700', fontSize: 14 }}>Find a co-ride instead</Text>
        </PressScale>
      </View>
      ) : !myId ? (
        <View style={{ marginTop: 12 }}>
          <CoRideState
            icon="person-circle-outline"
            title="Sign in to use Co-Ride"
            message="Co-Ride is only for signed-in students, so you always know who you ride with."
            actionLabel="Sign in"
            onAction={onSignIn}
          />
        </View>
      ) : mode === 'auto' ? (
        <View style={{ marginTop: 12 }}>{autoSection}</View>
      ) : (
        <>
          {/* Quick actions */}
          <Text style={[s.h2, { color: p.text }]}>Quick actions</Text>
          <View style={s.quickRow}>
            <PressScale onPress={() => onPost('passenger')} accessibilityRole="button" accessibilityLabel="Need a lift? Ask for a ride and split the fuel" style={{ flex: 1 }}>
              <LinearGradient colors={[p.heroFrom, p.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.quick}>
                <Text style={s.quickTitle}>Need a lift?</Text>
                <Text style={s.quickSub}>Ask for a ride and split the fuel</Text>
                <View style={s.quickArrow}><Ionicons name="arrow-forward" size={16} color="#1E40AF" /></View>
              </LinearGradient>
            </PressScale>
            <PressScale onPress={() => onPost('rider')} accessibilityRole="button" accessibilityLabel="Give a lift? Offer seats and share the fuel cost" style={{ flex: 1 }}>
              <View style={[s.quick, { backgroundColor: p.isDark ? 'rgba(52,211,153,0.14)' : '#E3F6EC' }]}>
                <Text style={[s.quickTitle, { color: p.isDark ? '#A7F3D0' : '#065F46' }]}>Give a lift?</Text>
                <Text style={[s.quickSub, { color: p.isDark ? '#6EE7B7' : '#047857' }]}>Offer seats, share the fuel cost</Text>
                <View style={[s.quickArrow, { backgroundColor: p.isDark ? '#047857' : '#FFFFFF' }]}><Ionicons name="arrow-forward" size={16} color={p.isDark ? '#FFFFFF' : '#047857'} /></View>
              </View>
            </PressScale>
          </View>

          <View style={{ marginTop: 14, marginBottom: 14 }}><KarmaLine points={karma} /></View>

          <Segmented
            label="Co-Ride"
            value={corideTab === 'my-rides' ? 'mine' : kind}
            onChange={(v) => { if (v === 'mine') setCorideTab('my-rides'); else { setKind(v); setGoingTo(null); setCorideTab('browse'); } }}
            options={[
              { key: 'lift', label: liftCount ? `Find a lift (${liftCount})` : 'Find a lift' },
              { key: 'give', label: giveCount ? `Give a lift (${giveCount})` : 'Give a lift' },
              { key: 'mine', label: myRideGroups.upcoming.length ? `My rides (${myRideGroups.upcoming.length})` : 'My rides' },
            ] as { key: 'lift' | 'give' | 'mine'; label: string }[]}
            style={{ marginBottom: 14 }}
          />

          {corideTab !== 'my-rides' ? (
            <View>
              {kindRides.length > 0 && (
                <RideFilters
                  vehicle={vehicleFilter}
                  onVehicle={(v) => { setVehicleFilter(v); setGoingTo(null); }}
                  destinations={destinations}
                  goingTo={goingTo}
                  onGoingTo={setGoingTo}
                />
              )}

              {loadingRides && rides.length === 0 ? (
                <RideSkeleton />
              ) : rideError && rides.length === 0 ? (
                <CoRideState icon="cloud-offline-outline" title="Rides did not load" message={rideError} actionLabel="Try again" onAction={onRetryRides} />
              ) : shown.length > 0 ? (
                <>
                  <View style={s.listHead}>
                    <Text style={[s.h2, { color: p.text, marginTop: 0, marginBottom: 0 }]}>{kind === 'give' ? 'Students asking for a lift' : 'Leaving soon'}</Text>
                    <Text style={[s.count, { color: p.sub }]}>{shown.length} {shown.length === 1 ? 'ride' : 'rides'}</Text>
                  </View>
                  {shown.map((ride, i) => (
                    <FadeInUp key={ride.id} index={i}>
                    <RideCard
                      key={ride.id}
                      ride={ride}
                      joinStatus={myJoinStatus[String(ride.id)]}
                      busy={rideActionBusy === ride.id}
                      onJoin={() => { if (rideActionBusy !== ride.id) onJoin(ride); }}
                      onDetails={() => setDetailsId(String(ride.id))}
                      onOpenMyRides={() => setCorideTab('my-rides')}
                    />
                    </FadeInUp>
                  ))}
                </>
              ) : kindRides.length > 0 ? (
                <CoRideState
                  icon="funnel-outline"
                  title={q ? `No rides match “${query.trim()}”` : `No ${vehicleFilter === 'All' ? '' : `${vehicleFilter.toLowerCase()} `}rides${goingTo ? ` to ${goingTo}` : ''} right now`}
                  message="Try another vehicle or destination, or post your own ride."
                  actionLabel="Clear filters"
                  secondary
                  onAction={() => { setVehicleFilter('All'); setGoingTo(null); setQuery(''); }}
                />
              ) : kind === 'give' ? (
                <CoRideState
                  icon="hand-left-outline"
                  title="Nobody is asking for a lift"
                  message="When students post that they need a ride, they show up here. Post your ride so they can find you."
                  actionLabel="Post a ride"
                  onAction={() => onPost('rider')}
                />
              ) : (
                <CoRideState
                  icon="map-outline"
                  title="No rides posted yet"
                  message="Be the first: post where you are going and when, and students heading the same way can join you."
                  actionLabel="Post a ride"
                  onAction={() => onPost('passenger')}
                />
              )}
            </View>
          ) : (
            <View>
              <Segmented
                label="My rides"
                value={history}
                onChange={setHistory}
                options={[
                  { key: 'upcoming', label: `Upcoming${myRideGroups.upcoming.length ? ` (${myRideGroups.upcoming.length})` : ''}` },
                  { key: 'past', label: `History${myRideGroups.past.length ? ` (${myRideGroups.past.length})` : ''}` },
                ]}
                style={{ marginBottom: 14 }}
              />
              {loadingMyRides && myRides.length === 0 ? (
                <RideSkeleton count={2} />
              ) : myRidesError && myRides.length === 0 ? (
                <CoRideState icon="cloud-offline-outline" title="Your rides did not load" message={myRidesError} actionLabel="Try again" onAction={onRetryMyRides} />
              ) : (history === 'upcoming' ? myRideGroups.upcoming : myRideGroups.past).length > 0 ? (
                <View>
                  <SectionLabel title={history === 'upcoming' ? 'Upcoming' : 'History'} count={(history === 'upcoming' ? myRideGroups.upcoming : myRideGroups.past).length} />
                  {(history === 'upcoming' ? myRideGroups.upcoming : myRideGroups.past).map((ride, i) => (
                    <FadeInUp key={ride.id} index={i}>
                    <MyRideCard
                      key={ride.id}
                      ride={ride}
                      myId={myId}
                      busy={rideActionBusy === ride.id}
                      onApprove={(reqId) => onApprove(ride.id, reqId)}
                      onDecline={(reqId) => onDecline(ride.id, reqId)}
                      onComplete={() => { if (rideActionBusy !== ride.id) onComplete(ride.id); }}
                      onCancel={(k) => { if (rideActionBusy !== ride.id) onCancel(ride.id, k); }}
                      onWhatsApp={onWhatsApp}
                      onSafety={onSafety}
                    />
                    </FadeInUp>
                  ))}
                </View>
              ) : (
                <CoRideState
                  icon="calendar-outline"
                  title={history === 'upcoming' ? 'No upcoming rides' : 'No past rides yet'}
                  message={history === 'upcoming' ? 'Rides you post or ask to join show up here.' : 'Completed and cancelled rides show up here.'}
                  actionLabel="Find a lift"
                  secondary
                  onAction={() => { setKind('lift'); setCorideTab('browse'); }}
                />
              )}
            </View>
          )}
        </>
      )}

      {details ? (
        <RideDetailsSheet
          ride={details}
          joinStatus={myJoinStatus[String(details.id)]}
          busy={rideActionBusy === details.id}
          onClose={() => setDetailsId(null)}
          onJoin={() => { const r = details; setDetailsId(null); if (rideActionBusy !== r.id) onJoin(r); }}
          onOpenMyRides={() => setCorideTab('my-rides')}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', letterSpacing: -0.2, marginTop: 4, marginBottom: 12 },
  h2: { fontSize: 17, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingLeft: 14, minHeight: 50 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 12 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modeRow: { flexDirection: 'row', gap: 12, marginTop: 14, marginBottom: 4 },
  modeTile: { flex: 1, borderRadius: 18, padding: 14, borderWidth: 1.5, minHeight: 124 },
  modeIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  modeTitle: { fontSize: 16, fontWeight: '800' },
  modeSub: { fontSize: 12, marginTop: 2 },
  quickRow: { flexDirection: 'row', gap: 12 },
  quick: { borderRadius: 18, padding: 14, minHeight: 112 },
  quickTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  quickSub: { color: 'rgba(255,255,255,0.88)', fontSize: 12, lineHeight: 16, marginTop: 4, paddingRight: 24 },
  quickArrow: { position: 'absolute', right: 12, bottom: 12, width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  listHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  count: { fontSize: 13, fontWeight: '600' },
  offCard: { borderRadius: 20, padding: 20, alignItems: 'center', marginTop: 12 },
  offIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  offTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  offBody: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  offList: { alignSelf: 'stretch', gap: 10, marginTop: 16 },
  offRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  offRowText: { flex: 1, fontSize: 14, fontWeight: '600' },
  offBtn: { marginTop: 18, minHeight: 46, borderRadius: 12, borderWidth: 1.5, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
});
