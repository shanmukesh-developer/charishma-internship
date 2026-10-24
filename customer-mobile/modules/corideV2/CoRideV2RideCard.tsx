/**
 * Co-Ride v2 ride cards, from real GET /api/bikepool/posts rows:
 *  - NearbyRideCard: the home card in the reference (host avatar + open seats, "4 seats available", from / to
 *    rail with the departure time, Bike pool tag, per-person price, chevron).
 *  - ResultRideCard: the richer Find-a-lift card (host first name, vehicle, women-only flag, timeline, seat
 *    dots, price per person, Request seat / status). No rating: rides have no rating on the server.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CR, R, W, shadow } from './coRideV2Theme';
import { Tap, Avatar, Pill, SeatDots, PrimaryButton } from './CoRideV2Kit';
import { IChevronRight, IBike, ICarSide, IUsers, IShield, STROKE } from './CoRideV2Icons';
import { fmtRideWhen, fmtClock12, inr, firstName, vehicleLabel } from '../../modules/coride/coRideFormat';
import { shareOf, isWomenOnly, isSameGenderOnly, isOffer, maskVehicle, type Ride } from './coRideV2Data';

export const whenOf = (ride: Ride) => {
  const d = new Date(ride?.departureTime);
  const w = fmtRideWhen(d);
  return { time: isNaN(d.getTime()) ? '' : fmtClock12(d), day: w.label.split(',')[0], relative: w.relative, label: w.label };
};
export const poolTag = (ride: Ride) => (ride?.vehicleType === 'Car' ? 'Car pool' : 'Bike pool');
export const VehicleIcon = ({ ride, size = 14, color = CR.tintInk }: { ride: Ride; size?: number; color?: string }) =>
  ride?.vehicleType === 'Car' ? <ICarSide size={size} color={color} strokeWidth={1.8} /> : <IBike size={size} color={color} strokeWidth={1.8} />;
export const seatsText = (n: number) => `${n} seat${n === 1 ? '' : 's'}`;

/** Big price + caption: exact when one seat, "up to" when more riders would lower it, "Free" with no split. */
export function PriceBlock({ ride, align = 'right', compact }: { ride: Ride; align?: 'right' | 'left'; compact?: boolean }) {
  const sh = shareOf(ride);
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <Text style={st.price}>{sh ? inr(sh.max) : 'Free'}</Text>
      <Text style={st.priceCap}>{!sh ? 'no fuel split' : sh.min === sh.max ? 'per person' : compact ? 'max / person' : `per person, down to ${inr(sh.min)}`}</Text>
    </View>
  );
}

function Rail({ from, to, fromNote, toNote }: { from: string; to: string; fromNote?: string; toNote?: string }) {
  return (
    <View style={st.rail} accessibilityLabel={`From ${from} to ${to}`}>
      <View style={st.railCol}>
        <View style={st.dotFrom} />
        <View style={st.railLine} />
        <View style={st.dotTo} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.place} numberOfLines={1}>{from}</Text>
        {fromNote ? <Text style={st.placeNote} numberOfLines={1}>{fromNote}</Text> : null}
        <Text style={[st.place, { marginTop: fromNote ? 10 : 14 }]} numberOfLines={1}>{to}</Text>
        {toNote ? <Text style={st.placeNote} numberOfLines={1}>{toNote}</Text> : null}
      </View>
    </View>
  );
}
export { Rail as RouteRail };

export function NearbyRideCard({ ride, onPress }: { ride: Ride; onPress: () => void }) {
  const w = whenOf(ride);
  const seats = Math.max(0, Number(ride.availableSeats) || 0);
  const offer = isOffer(ride);
  return (
    <Tap onPress={onPress} label={`${poolTag(ride)} from ${ride.origin} to ${ride.destination}, ${w.label}`} style={[st.card, st.nearby]}>
      <View style={st.nearLeft}>
        <View style={st.row}>
          <Avatar name={ride.creator?.name} image={ride.creator?.profileImage} size={32} ring />
          {offer ? Array.from({ length: Math.min(2, seats) }).map((_, i) => <View key={i} style={st.openSeat} />) : null}
        </View>
        <Pill text={offer ? `${seatsText(seats)} available` : 'Needs a lift'} tone={offer ? 'green' : 'amber'} style={{ marginTop: 10 }} />
      </View>
      <View style={st.vDivider} />
      <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 10 }}>
        <Rail from={ride.origin} to={ride.destination} fromNote={w.time} toNote={w.relative || w.day} />
      </View>
      <View style={st.vDivider} />
      <View style={st.nearRight}>
        <Pill text={poolTag(ride)} tone="blue" icon={ride.vehicleType === 'Car' ? ICarSide : IBike} />
        <View style={{ marginTop: 8 }}><PriceBlock ride={ride} compact /></View>
      </View>
      <IChevronRight size={17} color={CR.primary} strokeWidth={STROKE} />
    </Tap>
  );
}

export function ResultRideCard({ ride, status, busy, onOpen, onRequest, onOpenMine }: {
  ride: Ride; status?: string; busy?: boolean; onOpen: () => void; onRequest: () => void; onOpenMine: () => void;
}) {
  const w = whenOf(ride);
  const seats = Math.max(0, Number(ride.availableSeats) || 0);
  const offer = isOffer(ride);
  const vehicle = maskVehicle(ride.vehicleInfo, false) || vehicleLabel(ride.vehicleType);
  const statusPill = status === 'Pending' ? <Pill text="Request pending" tone="amber" />
    : status === 'Approved' ? <Pill text="Seat confirmed" tone="green" />
      : status === 'Rejected' ? <Pill text="Declined" tone="neutral" /> : null;
  return (
    <View style={[st.card, st.result]}>
      <Tap onPress={onOpen} label={`Ride with ${firstName(ride.creator?.name)} to ${ride.destination}, ${w.label}`}>
      <View style={st.row}>
        <Avatar name={ride.creator?.name} image={ride.creator?.profileImage} size={42} />
        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
          <View style={[st.row, { gap: 6 }]}>
            <Text style={st.name} numberOfLines={1}>{firstName(ride.creator?.name)}</Text>
            {isWomenOnly(ride) ? <Pill text="Women only" tone="blue" icon={IShield} /> : isSameGenderOnly(ride) ? <Pill text="Same gender only" tone="neutral" /> : null}
          </View>
          <View style={[st.row, { gap: 5, marginTop: 3 }]}>
            <VehicleIcon ride={ride} color={CR.muted} />
            <Text style={st.meta} numberOfLines={1}>{offer ? vehicle : 'Asking for a lift'}</Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={st.time}>{w.time}</Text>
          <Text style={st.meta}>{w.relative || w.day}</Text>
        </View>
      </View>
      <View style={{ marginTop: 14 }}><Rail from={ride.origin} to={ride.destination} /></View>
      <View style={st.hr} />
      <View style={[st.row, { justifyContent: 'space-between' }]}>
        <View style={{ gap: 6 }}>
          {offer ? <SeatDots open={seats} /> : <View style={[st.row, { gap: 5 }]}><IUsers size={14} color={CR.muted} strokeWidth={STROKE} /><Text style={st.meta}>{seatsText(Math.max(1, seats))} needed</Text></View>}
          {offer ? <Text style={st.meta}>{seatsText(seats)} left</Text> : null}
        </View>
        <PriceBlock ride={ride} />
      </View>
      </Tap>
      <View style={{ marginTop: 12 }}>
        {statusPill ? (
          <Tap onPress={onOpenMine} label="Open My rides" style={st.statusRow}>
            {statusPill}
            <Text style={st.link}>Open My rides</Text>
          </Tap>
        ) : (
          <PrimaryButton label={offer ? (ride.autoApprove ? 'Join ride' : 'Request seat') : 'Offer this lift'} onPress={onRequest} busy={busy} small />
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  card: { backgroundColor: CR.card, borderRadius: R.lg, marginBottom: 12, ...shadow(1) },
  nearby: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingLeft: 12, paddingRight: 6 },
  nearLeft: { width: 98, paddingRight: 6 },
  openSeat: { width: 28, height: 28, borderRadius: 14, marginLeft: -6, borderWidth: 1.4, borderStyle: 'dashed', borderColor: CR.faint, backgroundColor: '#FFFFFF' },
  vDivider: { width: StyleSheet.hairlineWidth * 2, alignSelf: 'stretch', backgroundColor: CR.lineSoft },
  nearRight: { alignItems: 'flex-end', paddingLeft: 8, paddingRight: 2, width: 90 },
  rail: { flexDirection: 'row' },
  railCol: { width: 14, alignItems: 'center', paddingTop: 5, marginRight: 8 },
  dotFrom: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.6, borderColor: CR.primary, backgroundColor: '#FFFFFF' },
  railLine: { width: 1.2, flex: 1, backgroundColor: CR.tint2, marginVertical: 3 },
  dotTo: { width: 8, height: 8, borderRadius: 4, backgroundColor: CR.primary, marginBottom: 6 },
  place: { fontSize: 13.5, color: CR.ink, fontWeight: W.label },
  placeNote: { fontSize: 12, color: CR.muted, marginTop: 2 },
  price: { fontSize: 19, fontWeight: W.title, color: CR.ink, letterSpacing: -0.3 },
  priceCap: { fontSize: 11, color: CR.muted, marginTop: 1, textAlign: 'right' },
  result: { padding: 14 },
  name: { fontSize: 15.5, fontWeight: W.title, color: CR.ink, flexShrink: 1 },
  meta: { fontSize: 12.5, color: CR.muted },
  time: { fontSize: 15, fontWeight: W.title, color: CR.ink },
  hr: { height: StyleSheet.hairlineWidth * 2, backgroundColor: CR.lineSoft, marginVertical: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  link: { fontSize: 13.5, color: CR.primary, fontWeight: W.label },
});
