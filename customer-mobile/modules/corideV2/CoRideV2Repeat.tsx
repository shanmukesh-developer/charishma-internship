/**
 * Co-Ride v2 · one-tap repeat (owner request): "Offer a seat" opens on the student's last offered ride
 * (from GET /my-rides) with "Offer again today · 5:30 PM" (or tomorrow when that time has passed), Edit,
 * and "Make this a regular ride". Posting uses the normal POST /api/bikepool/posts body.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CR, R, W, shadow } from './coRideV2Theme';
import { PrimaryButton, OutlineButton, Pill } from './CoRideV2Kit';
import { IRefresh, IRoute } from './CoRideV2Icons';
import { RouteRail } from './CoRideV2RideCard';
import { offeredSeats, timeOfRide, clock12 } from './coRideV2Regular';
import type { Ride } from './coRideV2Data';
import { inr } from '../../modules/coride/coRideFormat';
import { themedSheet } from '../../utils/themeNow';

/** Next departure at the same IST clock time: today if still 10+ min ahead, else tomorrow. */
export function nextAtSameTime(ride: Ride): { date: Date; today: boolean; hhmm: string } {
  const hhmm = timeOfRide(ride);
  const [h, m] = hhmm.split(':').map(Number);
  const IST = 330 * 60000;
  const nowIst = new Date(Date.now() + IST);
  const at = (addDays: number) => new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() + addDays, h, m) - IST);
  const today = at(0);
  return today.getTime() > Date.now() + 10 * 60000 ? { date: today, today: true, hhmm } : { date: at(1), today: false, hhmm };
}

/** The POST body for a repeat of `ride` at `when` (same route, vehicle, seats, fuel, notes, vibe, approval). */
export function repeatBody(ride: Ride, when: Date) {
  return {
    creatorRole: 'rider', origin: String(ride.origin), destination: String(ride.destination), departureTime: when.toISOString(),
    vehicleType: ride.vehicleType === 'Car' ? 'Car' : 'Bike', availableSeats: offeredSeats(ride),
    estimatedFuelCost: Math.max(0, Math.min(5000, Math.round(Number(ride.estimatedFuelCost) || 0))),
    notes: String(ride.notes || ''), rideVibe: String(ride.rideVibe || 'Any'), autoApprove: !!ride.autoApprove,
    womenOnly: ride.womenOnly === true, autoAcceptKnown: ride.autoAcceptKnown === true,
  };
}

export function RepeatCard({ ride, busy, onRepeat, onEdit, onRegular }: { ride: Ride; busy?: boolean; onRepeat: () => void; onEdit: () => void; onRegular: () => void }) {
  const next = nextAtSameTime(ride);
  const seats = offeredSeats(ride);
  const fuel = Number(ride.estimatedFuelCost) || 0;
  const share = fuel > 0 ? { a: Math.ceil(fuel / (seats + 1)), b: Math.ceil(fuel / 2) } : null;
  return (
    <View style={st.card}>
      <View style={[st.row, { justifyContent: 'space-between' }]}>
        <Text style={st.kicker}>Your last ride</Text>
        <Pill text={clock12(next.hhmm)} tone="blue" />
      </View>
      <View style={{ marginTop: 10 }}><RouteRail from={ride.origin} to={ride.destination} /></View>
      <View style={[st.row, { gap: 8, marginTop: 12, flexWrap: 'wrap' }]}>
        <Pill text={`${ride.vehicleType === 'Car' ? 'Car' : 'Bike'} · ${seats} seat${seats === 1 ? '' : 's'}`} />
        <Pill text={share ? `${share.a === share.b ? inr(share.a) : `${inr(share.a)}–${inr(share.b)}`} per person` : 'Free ride'} tone={share ? 'green' : 'neutral'} />
      </View>
      <PrimaryButton label={`Offer again ${next.today ? 'today' : 'tomorrow'} · ${clock12(next.hhmm)}`} icon={IRefresh} onPress={onRepeat} busy={busy} style={{ marginTop: 14 }} />
      <View style={[st.row, { gap: 10, marginTop: 10 }]}>
        <OutlineButton label="Edit details" onPress={onEdit} small style={{ flex: 1 }} />
        <OutlineButton label="Make it regular" icon={IRoute} onPress={onRegular} small style={{ flex: 1.2 }} />
      </View>
    </View>
  );
}

export function OrDivider({ text }: { text: string }) {
  return (
    <View style={[st.row, { marginVertical: 16, gap: 10 }]}>
      <View style={st.line} /><Text style={st.or}>{text}</Text><View style={st.line} />
    </View>
  );
}

const st = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  card: { backgroundColor: CR.card, borderRadius: R.lg, padding: 14, marginTop: 12, borderWidth: 1, borderColor: CR.tint2, ...shadow(1) },
  kicker: { fontSize: 12.5, color: CR.muted, fontWeight: W.label },
  line: { flex: 1, height: StyleSheet.hairlineWidth * 2, backgroundColor: CR.line },
  or: { fontSize: 12.5, color: CR.muted },
}));
