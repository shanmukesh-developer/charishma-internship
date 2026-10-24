/**
 * Co-Ride v2 · My rides (GET /api/bikepool/my-rides). As rider: rides I asked to join, plus my own lift
 * requests; As driver: rides I host. Upcoming / Past, status pills. Hosts accept or decline seat requests,
 * complete or cancel the ride; riders withdraw or leave, and message the host on WhatsApp once confirmed
 * (the server shares phone numbers only between the host and approved riders).
 * Not offered (no API yet): "Start ride" and cancel reasons. Owner decisions in the report.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Linking } from 'react-native';
import { CR, R, GUTTER, W, shadow, type Tone } from './coRideV2Theme';
import { ScreenHeader, Segmented, Avatar, Pill, PrimaryButton, OutlineButton, Tap, Chip } from './CoRideV2Kit';
import { IMessage, ICheck, IX, IFlag, ICircleX, IRefresh, IRoute, STROKE } from './CoRideV2Icons';
import { RouteRail, whenOf, poolTag } from './CoRideV2RideCard';
import { RideSkeleton, StateCard, NetState } from './CoRideV2States';
import { useCoRide, type Ride } from './coRideV2Data';
import { useNav } from './coRideV2Nav';
import { myRideInfo, firstName } from '../../modules/coride/coRideFormat';

const toneOf = (t: string): Tone => (t === 'success' ? 'green' : t === 'warning' ? 'amber' : 'neutral');
const openWhatsApp = (phone: any) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) { Alert.alert('Contact unavailable', 'This student has not shared a phone number.'); return; }
  Linking.openURL(`https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`).catch(() => {});
};

function MyRideCard({ ride }: { ride: Ride }) {
  const d = useCoRide();
  const { openSheet, push } = useNav();
  const info = myRideInfo(ride, d.myId);
  const w = whenOf(ride);
  const busy = d.busy === String(ride.id);
  const run = (kind: 'approve' | 'reject' | 'complete' | 'cancel', args: any, okTitle: string) =>
    d.act(kind, { rideId: String(ride.id), ...args }).then((r) => openSheet({ kind: 'done', title: r.ok ? okTitle : 'Could not update the ride', body: r.message || 'Done.' }));
  const confirm = (title: string, body: string, cta: string, fn: () => void, destructive = true) =>
    Alert.alert(title, body, [{ text: 'Keep', style: 'cancel' }, { text: cta, style: destructive ? 'destructive' : 'default', onPress: fn }]);
  const host = ride.creator;

  return (
    <View style={st.card}>
      <View style={[st.row, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.when}>{w.label}</Text>
          <Text style={st.meta}>{poolTag(ride)}{w.relative ? ` · ${w.relative}` : ''}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Pill text={info.badge.label} tone={toneOf(info.badge.tone)} />
          {info.isCreator && !info.isOpenRide && ride.creatorRole !== 'passenger' ? (
            <Chip label="Repeat" icon={IRefresh} on={false} onPress={() => push({ name: 'post', role: 'rider', repeatId: String(ride.id) })} />
          ) : null}
        </View>
      </View>
      <View style={{ marginTop: 12 }}><RouteRail from={ride.origin} to={ride.destination} /></View>

      {info.isCreator ? (
        <>
          {info.pending.length ? <Text style={st.sub}>Seat requests</Text> : null}
          {info.pending.map((rq: any) => (
            <View key={rq.id} style={st.person}>
              <Avatar name={rq.passenger?.name} image={rq.passenger?.profileImage} size={36} />
              <Text style={st.personName} numberOfLines={1}>{firstName(rq.passenger?.name)}</Text>
              <Tap onPress={() => run('reject', { requestId: rq.id }, 'Request declined')} disabled={busy} label={`Decline ${firstName(rq.passenger?.name)}`} style={[st.round, { backgroundColor: CR.redSoft }]}><IX size={18} color={CR.red} strokeWidth={STROKE} /></Tap>
              <Tap onPress={() => run('approve', { requestId: rq.id }, 'Rider approved')} disabled={busy} label={`Accept ${firstName(rq.passenger?.name)}`} style={[st.round, { backgroundColor: CR.greenSoft }]}><ICheck size={18} color={CR.green} strokeWidth={STROKE} /></Tap>
            </View>
          ))}
          {info.approved.length ? <Text style={st.sub}>Riding with you</Text> : null}
          {info.approved.map((rq: any) => (
            <View key={rq.id} style={st.person}>
              <Avatar name={rq.passenger?.name} image={rq.passenger?.profileImage} size={36} />
              <Text style={st.personName} numberOfLines={1}>{firstName(rq.passenger?.name)}</Text>
              {rq.passenger?.phone ? <OutlineButton label="WhatsApp" icon={IMessage} small color={CR.whatsapp} onPress={() => openWhatsApp(rq.passenger.phone)} style={{ height: 36 }} /> : null}
            </View>
          ))}
          {info.isOpenRide ? (
            <View style={st.actions}>
              <OutlineButton label="Cancel ride" icon={ICircleX} small color={CR.red} style={{ flex: 1, borderColor: CR.redSoft }} onPress={() => confirm('Cancel this ride?', 'Everyone who joined or requested will be released.', 'Cancel ride', () => run('cancel', {}, 'Ride cancelled'))} />
              <PrimaryButton label="Complete" icon={IFlag} small busy={busy} style={{ flex: 1 }} onPress={() => confirm('Mark this ride as completed?', 'Do this once everyone has reached. Everyone on the ride earns Karma.', 'Complete ride', () => run('complete', {}, 'Ride completed'), false)} />
            </View>
          ) : null}
        </>
      ) : (
        <>
          <View style={[st.person, { marginTop: 12 }]}>
            <Avatar name={host?.name} image={host?.profileImage} size={36} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.personName} numberOfLines={1}>{firstName(host?.name)}</Text>
              <Text style={st.meta}>{info.myStatus === 'Approved' ? 'Your host · seat confirmed' : 'Host'}</Text>
            </View>
            {info.myStatus === 'Approved' && host?.phone ? <OutlineButton label="WhatsApp" icon={IMessage} small color={CR.whatsapp} onPress={() => openWhatsApp(host.phone)} style={{ height: 36 }} /> : null}
          </View>
          {info.isOpenRide && (info.myStatus === 'Pending' || info.myStatus === 'Approved') ? (
            <OutlineButton
              label={info.myStatus === 'Pending' ? 'Withdraw request' : 'Leave ride'}
              small color={CR.red} style={{ marginTop: 12, borderColor: CR.redSoft }}
              onPress={() => confirm(info.myStatus === 'Pending' ? 'Withdraw your request?' : 'Leave this ride?', info.myStatus === 'Pending' ? 'The host will no longer see your request.' : 'Your seat will be offered to other students.', info.myStatus === 'Pending' ? 'Withdraw' : 'Leave ride', () => run('cancel', {}, 'Done'))}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

export default function CoRideV2MyRides() {
  const d = useCoRide();
  const { route, back, push } = useNav();
  const [as, setAs] = useState<'rider' | 'driver'>(route.name === 'mine' && route.as ? route.as : 'rider');
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const isDriverRide = (r: Ride) => String(r.creatorId) === d.myId && r.creatorRole !== 'passenger';
  const lists = useMemo(() => {
    const pick = (xs: Ride[]) => xs.filter((r) => (as === 'driver' ? isDriverRide(r) : !isDriverRide(r)));
    return { upcoming: pick(d.myGroups.upcoming), past: pick(d.myGroups.past) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.myGroups, as, d.myId]);
  const list = lists[when];
  const pendingForMe = lists.upcoming.reduce((n, r) => n + (String(r.creatorId) === d.myId ? myRideInfo(r, d.myId).pending.length : 0), 0);

  const body = () => {
    if (d.myLoading) return <RideSkeleton count={2} />;
    if (!d.myRides.length && (d.connection !== 'online' || d.myError)) return <NetState connection={d.connection} error={d.myError} onRetry={d.reload} what="your rides" />;
    if (!list.length) {
      return when === 'upcoming'
        ? (as === 'rider'
          ? <StateCard art title="No upcoming rides" body="Rides you ask to join show up here, with the host's status." action="Find a lift" onAction={() => push({ name: 'find' })} />
          : <StateCard art title="You are not hosting a ride" body="Offer a seat on your way out and approve who rides with you." action="Offer a seat" onAction={() => push({ name: 'post', role: 'rider' })} />)
        : <StateCard title="No past rides yet" body="Completed and cancelled rides show up here." />;
    }
    return list.map((r) => <MyRideCard key={r.id} ride={r} />);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="My rides" sub={pendingForMe ? `${pendingForMe} seat request${pendingForMe === 1 ? '' : 's'} waiting` : undefined} onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <Segmented<'rider' | 'driver'> value={as} onChange={setAs} options={[{ key: 'rider', label: 'As rider' }, { key: 'driver', label: 'As driver' }]} />
        <View style={st.tabs}>
          <Chip label={`Upcoming${lists.upcoming.length ? ` · ${lists.upcoming.length}` : ''}`} on={when === 'upcoming'} onPress={() => setWhen('upcoming')} />
          <Chip label={`Past${lists.past.length ? ` · ${lists.past.length}` : ''}`} on={when === 'past'} onPress={() => setWhen('past')} />
        </View>
        {as === 'driver' ? (
          <Tap onPress={() => push({ name: 'regular' })} label="My regular rides" style={st.regRow}>
            <IRoute size={18} color={CR.primary} strokeWidth={STROKE} />
            <Text style={st.regText}>My regular rides</Text>
            <Text style={st.meta}>{d.templates?.length ? `${d.templates.length} saved` : 'Post once, ride every day'}</Text>
          </Tap>
        ) : null}
        {body()}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  card: { backgroundColor: CR.card, borderRadius: R.lg, padding: 14, marginBottom: 12, ...shadow(1) },
  when: { fontSize: 15, fontWeight: W.title, color: CR.ink },
  meta: { fontSize: 12.5, color: CR.muted, marginTop: 2 },
  sub: { fontSize: 12.5, color: CR.muted, marginTop: 14, marginBottom: 2 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  personName: { flex: 1, fontSize: 14.5, color: CR.ink, fontWeight: W.label },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 12 },
  regRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CR.tint, borderRadius: R.md, paddingHorizontal: 14, minHeight: 48, marginBottom: 12 },
  regText: { flex: 1, fontSize: 14, color: CR.primaryDeep, fontWeight: W.label },
});
