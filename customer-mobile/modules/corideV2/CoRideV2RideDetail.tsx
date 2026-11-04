/**
 * Co-Ride v2 · Ride detail. Rides have places as text (no coordinates), so the route is a clean timeline
 * (pickup, stopovers, drop) instead of a map. Host card, vehicle (plate digits masked until your seat is
 * confirmed), open seats, fuel share, the host's preferences and notes, ride rules, safety (share trip,
 * SOS: 112 or ZCS support), and Request seat / withdraw with a clear pending / confirmed / declined status.
 * One seat per request (the join API takes no seat count), so there is no seat picker.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CR, R, GUTTER, W, shadow } from './coRideV2Theme';
import { ScreenHeader, Avatar, Pill, SeatDots, PrimaryButton, OutlineButton, IconBtn, Card } from './CoRideV2Kit';
import { IShare, IHelmet, INoSmoking, IClock, IShield, ISiren, IInfo, INote, IUsers, ICheckCircle, STROKE } from './CoRideV2Icons';
import { whenOf, poolTag, VehicleIcon, seatsText } from './CoRideV2RideCard';
import { StateCard, RideSkeleton } from './CoRideV2States';
import { useCoRide, shareOf, isOffer, isWomenOnly, isSameGenderOnly, maskVehicle } from './coRideV2Data';
import { useNav } from './coRideV2Nav';
import { firstName, inr, vehicleLabel, vibeLabel, genderLabel } from '../../modules/coride/coRideFormat';

function Stop({ label, place, note, last, kind }: { label: string; place: string; note?: string; last?: boolean; kind: 'from' | 'via' | 'to' }) {
  return (
    <View style={st.stop}>
      <View style={st.stopRail}>
        <View style={kind === 'to' ? st.dotTo : kind === 'via' ? st.dotVia : st.dotFrom} />
        {!last ? <View style={st.stopLine} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
        <Text style={st.stopLabel}>{label}</Text>
        <Text style={st.stopPlace}>{place}</Text>
        {note ? <Text style={st.stopNote}>{note}</Text> : null}
      </View>
    </View>
  );
}

function Row({ icon: Icon, text, sub }: { icon: any; text: string; sub?: string }) {
  return (
    <View style={st.rowItem}>
      <Icon size={18} color={CR.ink2} strokeWidth={STROKE} />
      <View style={{ flex: 1 }}>
        <Text style={st.rowText}>{text}</Text>
        {sub ? <Text style={st.rowSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export default function CoRideV2RideDetail() {
  const d = useCoRide();
  const { route, back, push, openSheet } = useNav();
  const insets = useSafeAreaInsets();
  const id = route.name === 'ride' ? route.id : '';
  const ride = d.rides.find((r) => String(r.id) === id) || d.myRides.find((r) => String(r.id) === id);

  if (!ride && (d.ridesLoading || d.myLoading)) {
    return <View style={{ flex: 1 }}><ScreenHeader title="Ride details" onBack={back} /><View style={{ padding: GUTTER }}><RideSkeleton count={1} /></View></View>;
  }
  if (!ride) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Ride details" onBack={back} />
        <View style={{ padding: GUTTER }}><StateCard title="This ride is no longer open" body="It may have filled up, left or been cancelled by the host." action="Find another lift" onAction={() => push({ name: 'find' })} /></View>
      </View>
    );
  }

  const w = whenOf(ride);
  const sh = shareOf(ride);
  const offer = isOffer(ride);
  const status = d.joinStatus[String(ride.id)];
  const mine = String(ride.creatorId || '') === d.myId;
  const confirmed = status === 'Approved';
  const seats = Math.max(0, Number(ride.availableSeats) || 0);
  const vehicleText = maskVehicle(ride.vehicleInfo, confirmed || mine);
  const stops: string[] = Array.isArray(ride.stopovers) ? ride.stopovers.filter(Boolean) : [];
  const vibe = vibeLabel(ride.rideVibe);
  const share = () => Share.share({ message: `My ZENV Co-Ride: ${ride.origin} to ${ride.destination}, ${w.label}, with ${firstName(ride.creator?.name)} (${poolTag(ride)}).` }).catch(() => {});
  const sos = () => openSheet({ kind: 'sos', rideId: mine || confirmed ? String(ride.id) : undefined });
  const statusPill = mine ? <Pill text="Your ride" tone="blue" />
    : status === 'Pending' ? <Pill text="Request pending" tone="amber" />
      : status === 'Approved' ? <Pill text="Seat confirmed" tone="green" icon={ICheckCircle} />
        : status === 'Rejected' ? <Pill text="Declined by the host" tone="red" />
          : <Pill text={offer ? `${seatsText(seats)} open` : 'Needs a lift'} tone={offer ? 'green' : 'amber'} />;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Ride details" sub={`${ride.origin} → ${ride.destination}`} onBack={back} right={<IconBtn icon={IShare} label="Share trip" onPress={share} />} />
      <ScrollView contentContainerStyle={{ padding: GUTTER, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        <Card style={st.block}>
          <View style={[st.row, { justifyContent: 'space-between' }]}>
            <View>
              <Text style={st.time}>{w.time}</Text>
              <Text style={st.sub}>{w.day}{w.relative ? ` · ${w.relative}` : ''}</Text>
            </View>
            {statusPill}
          </View>
          <View style={st.hr} />
          <Stop kind="from" label="Pickup" place={ride.origin} note={`Leaves ${w.time}`} />
          {stops.map((s) => <Stop key={s} kind="via" label="Stop" place={s} />)}
          <Stop kind="to" label="Drop" place={ride.destination} last />
        </Card>

        <Card style={st.block}>
          <View style={st.row}>
            <Avatar name={ride.creator?.name} image={ride.creator?.profileImage} size={48} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={st.name}>{firstName(ride.creator?.name)}</Text>
              <Text style={st.sub}>{offer ? 'Host' : 'Asking for a lift'}{genderLabel(ride.creator?.gender) ? ` · ${genderLabel(ride.creator?.gender)}` : ''}</Text>
            </View>
            {isWomenOnly(ride) ? <Pill text="Women only" tone="blue" icon={IShield} /> : isSameGenderOnly(ride) ? <Pill text="Same gender only" tone="neutral" /> : null}
          </View>
          <View style={st.hr} />
          <View style={st.rowItem}>
            <VehicleIcon ride={ride} size={18} color={CR.ink2} />
            <View style={{ flex: 1 }}>
              <Text style={st.rowText}>{offer ? vehicleLabel(ride.vehicleType) : `Prefers a ${vehicleLabel(ride.vehicleType).toLowerCase()}`}{vehicleText ? ` · ${vehicleText}` : ''}</Text>
              {vehicleText && !confirmed && !mine ? <Text style={st.rowSub}>Number shows once your seat is confirmed</Text> : null}
            </View>
          </View>
          {offer ? (
            <View style={st.rowItem}>
              <IUsers size={18} color={CR.ink2} strokeWidth={STROKE} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={st.rowText}>{seatsText(seats)} left · one seat per request</Text>
                <SeatDots open={seats} />
              </View>
            </View>
          ) : null}
        </Card>

        <Card style={st.block}>
          <Text style={st.blockTitle}>Fuel share</Text>
          <Text style={st.price}>{sh ? (sh.min === sh.max ? inr(sh.max) : `${inr(sh.min)} – ${inr(sh.max)}`) : 'Free ride'}<Text style={st.sub}>{sh ? ' per person' : ''}</Text></Text>
          <Text style={st.rowSub}>{sh ? `${inr(Number(ride.estimatedFuelCost))} in total, split by everyone on the ride. Less each as more seats fill.` : 'The host is not splitting fuel on this ride.'}</Text>
        </Card>

        <Card style={st.block}>
          <Text style={st.blockTitle}>Ride rules</Text>
          {ride.vehicleType !== 'Car' ? <Row icon={IHelmet} text="Helmet for both riders" sub="Bring your own unless the host says otherwise" /> : null}
          <Row icon={INoSmoking} text="No smoking on the ride" />
          <Row icon={IClock} text="Be at the pickup on time" sub="Message the host if you are running late" />
          <Row icon={IInfo} text={ride.autoApprove ? 'Instant join' : 'The host approves each rider'} sub={vibe ? `Ride preference: ${vibe}` : undefined} />
          {ride.notes ? <Row icon={INote} text="Note from the host" sub={String(ride.notes)} /> : null}
        </Card>

        <Card style={st.block}>
          <Text style={st.blockTitle}>Safety</Text>
          <View style={[st.row, { gap: 10 }]}>
            <OutlineButton label="Share trip" icon={IShare} onPress={share} small style={{ flex: 1 }} />
            <OutlineButton label="SOS" icon={ISiren} onPress={sos} small color={CR.red} style={{ flex: 1, borderColor: CR.redSoft }} />
          </View>
          <Text style={[st.rowSub, { marginTop: 10 }]}>Phone numbers are shared only between the host and confirmed riders.</Text>
        </Card>
      </ScrollView>

      <View style={[st.bar, { paddingBottom: Math.max(12, insets.bottom + 8) }]}>
        <View style={{ flex: 1 }}>
          <Text style={st.barPrice}>{sh ? inr(sh.max) : 'Free'}</Text>
          <Text style={st.rowSub}>{sh ? (sh.min === sh.max ? 'per person' : `per person, down to ${inr(sh.min)}`) : 'no fuel split'}</Text>
        </View>
        {mine ? <OutlineButton label="Manage in My rides" onPress={() => push({ name: 'mine', as: 'driver' })} small style={{ flex: 1.3 }} />
          : status === 'Pending' ? <OutlineButton label="Withdraw request" onPress={() => d.act('cancel', { rideId: String(ride.id) }).then((r) => openSheet({ kind: 'done', title: r.ok ? 'Request withdrawn' : 'Could not withdraw', body: r.message || 'Done.' }))} small color={CR.red} style={{ flex: 1.3 }} />
            : status === 'Approved' ? <PrimaryButton label="Open My rides" onPress={() => push({ name: 'mine', as: 'rider' })} small style={{ flex: 1.3 }} />
              : <PrimaryButton label={offer ? (ride.autoApprove ? 'Join ride' : 'Request seat') : 'Offer this lift'} onPress={() => openSheet({ kind: 'request', ride })} small style={{ flex: 1.3 }} />}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  block: { padding: 16, marginBottom: 12 },
  blockTitle: { fontSize: 15, fontWeight: W.title, color: CR.ink, marginBottom: 10 },
  time: { fontSize: 24, fontWeight: W.title, color: CR.ink, letterSpacing: -0.4 },
  sub: { fontSize: 13, color: CR.muted, marginTop: 2, fontWeight: W.body },
  name: { fontSize: 16, fontWeight: W.title, color: CR.ink },
  hr: { height: StyleSheet.hairlineWidth * 2, backgroundColor: CR.lineSoft, marginVertical: 14 },
  stop: { flexDirection: 'row' },
  stopRail: { width: 18, alignItems: 'center', paddingTop: 4, marginRight: 10 },
  dotFrom: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: CR.primary, backgroundColor: '#FFFFFF' },
  dotVia: { width: 8, height: 8, borderRadius: 4, backgroundColor: CR.faint },
  dotTo: { width: 10, height: 10, borderRadius: 5, backgroundColor: CR.primary },
  stopLine: { width: 1.4, flex: 1, backgroundColor: CR.tint2, marginTop: 4 },
  stopLabel: { fontSize: 12, color: CR.muted },
  stopPlace: { fontSize: 15, color: CR.ink, fontWeight: W.label, marginTop: 1 },
  stopNote: { fontSize: 12.5, color: CR.muted, marginTop: 2 },
  rowItem: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 7 },
  rowText: { fontSize: 14, color: CR.ink, lineHeight: 19 },
  rowSub: { fontSize: 12.5, color: CR.muted, marginTop: 2, lineHeight: 17 },
  price: { fontSize: 22, fontWeight: W.title, color: CR.ink, letterSpacing: -0.3 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CR.card, paddingHorizontal: GUTTER, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: CR.line, ...shadow(2) },
  barPrice: { fontSize: 20, fontWeight: W.title, color: CR.ink },
});
