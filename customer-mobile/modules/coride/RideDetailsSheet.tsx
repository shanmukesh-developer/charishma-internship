/**
 * Co-Ride ride details (full screen): route with an "Open in Maps" link, the host, the vehicle, trip
 * facts and the fuel split, then Request to join. Everything shown comes from the ride post
 * (GET /api/bikepool/posts); joining still runs through others.tsx (confirmation + POST join).
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, Linking, Alert } from 'react-native';
import { PressScale } from '../others/motion';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCoRidePalette, Avatar, Badge, CoBtn, RouteLine, VEHICLE_ICON } from './CoRideUI';
import { fmtRideWhen, inr, firstName, vehicleLabel, vibeLabel, genderLabel, costWord } from './coRideFormat';

export const openRouteInMaps = (from: string, to: string) => {
  const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`;
  Linking.openURL(url).catch(() => Alert.alert('Could not open Maps', 'Search for the route in your maps app.'));
};

export default function RideDetailsSheet({ ride, joinStatus, busy, onClose, onJoin, onOpenMyRides }: {
  ride: any | null;
  joinStatus?: string;
  busy: boolean;
  onClose: () => void;
  onJoin: () => void;
  onOpenMyRides: () => void;
}) {
  const p = useCoRidePalette();
  const insets = useSafeAreaInsets();
  if (!ride) return null;

  const needsRide = ride.creatorRole === 'passenger';
  const when = fmtRideWhen(ride.departureTime);
  const seats = Number(ride.availableSeats) || 0;
  const fuel = Number(ride.estimatedFuelCost) || 0;
  const vehicle = vehicleLabel(ride.vehicleType);
  const name = firstName(ride.creator?.name, 'Student');
  const hostBits = [genderLabel(ride.creator?.gender), vibeLabel(ride.rideVibe)].filter(Boolean).join(' · ');
  // You and the host share the fuel; every open seat that fills lowers each share.
  const most = fuel > 0 ? Math.ceil(fuel / 2) : 0;
  const least = fuel > 0 ? Math.ceil(fuel / (Math.max(1, seats) + 1)) : 0;

  const facts: { icon: string; mci?: boolean; label: string; value: string }[] = [
    { icon: 'time-outline', label: 'Leaves', value: when.relative ? `${when.label} · ${when.relative}` : when.label },
    { icon: 'person-outline', label: needsRide ? 'Seats needed' : 'Seats left', value: String(seats) },
    { icon: needsRide ? 'hand-left-outline' : ride.autoApprove ? 'flash-outline' : 'checkmark-done-outline', label: 'Joining', value: needsRide ? 'You offer the ride' : ride.autoApprove ? 'Instant, while seats last' : 'Host approves each request' },
    ...(vibeLabel(ride.rideVibe) ? [{ icon: 'musical-notes-outline', label: 'Ride preference', value: vibeLabel(ride.rideVibe) as string }] : []),
    ...(String(ride.genderPreference || '') === 'Same Gender Only' ? [{ icon: 'people-outline', label: 'Who can join', value: 'Same gender only' }] : []),
  ];

  const action = joinStatus === 'Approved' ? { label: 'You’re on this ride', kind: 'success' as const, go: () => { onClose(); onOpenMyRides(); } }
    : joinStatus ? { label: 'Request sent', kind: 'secondary' as const, go: () => { onClose(); onOpenMyRides(); } }
      : { label: needsRide ? 'Ride together' : ride.autoApprove ? 'Join ride' : 'Request to join', kind: 'primary' as const, go: onJoin };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[s.screen, { backgroundColor: p.page }]}>
        <View style={[s.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
          <PressScale onPress={onClose} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={p.text} />
          </PressScale>
          <Text style={[s.headerTitle, { color: p.text }]} accessibilityRole="header">Ride details</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={[s.body, { paddingBottom: 24 }]} showsVerticalScrollIndicator={false}>
          {/* Route */}
          <View style={[s.card, { backgroundColor: p.surface }, p.shadow]}>
            <View style={[s.routeBand, { backgroundColor: p.accentSoft }]}>
              <MaterialCommunityIcons name="map-marker-path" size={22} color={p.accent} />
              <Text style={[s.routeBandText, { color: p.text }]} numberOfLines={1}>{ride.origin} to {ride.destination}</Text>
            </View>
            <RouteLine from={ride.origin} to={ride.destination} fromNote="Pickup" toNote="Drop" />
            <PressScale onPress={() => openRouteInMaps(ride.origin, ride.destination)} style={s.mapsLink} accessibilityRole="link" accessibilityLabel="Open the route in Maps">
              <Ionicons name="navigate-outline" size={16} color={p.accent} />
              <Text style={[s.mapsText, { color: p.accent }]}>Open route in Maps</Text>
            </PressScale>
          </View>

          {/* Host + vehicle */}
          <View style={[s.card, { backgroundColor: p.surface }, p.shadow]}>
            <View style={s.hostRow}>
              <Avatar name={ride.creator?.name} image={ride.creator?.profileImage} size={52} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.hostName, { color: p.text }]} numberOfLines={1}>{name}</Text>
                <Text style={[s.small, { color: p.sub }]} numberOfLines={1}>{hostBits || 'Campus student'}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                  <Badge label="Signed-in student" tone="accent" />
                  {needsRide ? <Badge label="Asking for a lift" tone="warning" /> : null}
                </View>
              </View>
            </View>
            <View style={[s.vehicleRow, { borderTopColor: p.divider }]}>
              <View style={[s.vehTile, { backgroundColor: p.accentSoft }]}>
                <MaterialCommunityIcons name={VEHICLE_ICON[vehicle] || 'motorbike'} size={24} color={p.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.rowTitle, { color: p.text }]}>{needsRide ? `Prefers a ${vehicle.toLowerCase()}` : vehicle}</Text>
                <Text style={[s.small, { color: p.sub }]} numberOfLines={1}>{ride.vehicleInfo || (vehicle === 'Bike' ? 'One pillion seat' : 'Up to 4 riders')}</Text>
              </View>
            </View>
          </View>

          {/* Trip facts */}
          <View style={[s.card, { backgroundColor: p.surface, paddingVertical: 6 }, p.shadow]}>
            {facts.map((f, i) => (
              <View key={f.label} style={[s.fact, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.divider }]}>
                <Ionicons name={f.icon as any} size={18} color={p.accent} />
                <Text style={[s.factLabel, { color: p.sub }]}>{f.label}</Text>
                <Text style={[s.factValue, { color: p.text }]} numberOfLines={2}>{f.value}</Text>
              </View>
            ))}
          </View>

          {/* Cost sharing */}
          <View style={[s.card, { backgroundColor: p.surface }, p.shadow]}>
            <Text style={[s.cardTitle, { color: p.text }]}>{costWord(ride) === 'Fare share' ? 'Fare sharing' : 'Cost sharing'}</Text>
            {fuel > 0 ? (
              <>
                <View style={s.costRow}>
                  <Text style={[s.costLabel, { color: p.sub }]}>{costWord(ride) === 'Fare share' ? 'Total fare' : 'Total fuel cost'}</Text>
                  <Text style={[s.costValue, { color: p.text }]}>{inr(fuel)}</Text>
                </View>
                <View style={s.costRow}>
                  <Text style={[s.costLabel, { color: p.sub }]}>Your share</Text>
                  <Text style={[s.costValue, { color: p.accent, fontSize: 17 }]}>{least === most ? inr(most) : `${inr(least)}–${most}`}</Text>
                </View>
                <Text style={[s.small, { color: p.sub, marginTop: 8 }]}>
                  Split evenly between everyone on the ride. Settle it directly with {needsRide ? 'the student' : 'the host'} after the ride.
                </Text>
              </>
            ) : (
              <Text style={[s.small, { color: p.sub, marginTop: 6 }]}>No fuel split. This one is a free ride.</Text>
            )}
          </View>

          {ride.notes ? (
            <View style={[s.card, { backgroundColor: p.surface }, p.shadow]}>
              <Text style={[s.cardTitle, { color: p.text }]}>Note from {name}</Text>
              <Text style={[s.small, { color: p.sub, marginTop: 6, fontSize: 14, lineHeight: 20 }]}>{ride.notes}</Text>
            </View>
          ) : null}

          <View style={[s.safety, { backgroundColor: p.accentSoft }]}>
            <Ionicons name="shield-checkmark-outline" size={18} color={p.accent} />
            <Text style={[s.small, { color: p.text, flex: 1 }]}>
              Once you are on the ride, message {needsRide ? 'the student' : 'the host'} on WhatsApp from My rides. Share your trip with a friend, and call 112 in an emergency.
            </Text>
          </View>
        </ScrollView>

        <View style={[s.footer, { backgroundColor: p.surface, borderTopColor: p.divider, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={s.footerRow}>
            <CoBtn label="Maps" kind="outline" icon="navigate-outline" onPress={() => openRouteInMaps(ride.origin, ride.destination)} style={{ minHeight: 52, paddingHorizontal: 18 }} a11y="Open the route in Maps" />
            <CoBtn label={action.label} kind={action.kind} loading={busy} onPress={action.go} style={{ flex: 1, minHeight: 52 }}
              a11y={action.go === onJoin ? `${action.label}: ${ride.origin} to ${ride.destination}` : `${action.label}. Open My rides`} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  body: { padding: 16, paddingTop: 6, width: '100%', maxWidth: 640, alignSelf: 'center' },
  card: { borderRadius: 18, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  routeBand: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  routeBandText: { flex: 1, fontSize: 14, fontWeight: '700' },
  mapsLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: 8, alignSelf: 'flex-start' },
  mapsText: { fontSize: 14, fontWeight: '700' },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hostName: { fontSize: 17, fontWeight: '800' },
  small: { fontSize: 13, lineHeight: 18 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  vehTile: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  factLabel: { width: 112, fontSize: 13, fontWeight: '600' },
  factValue: { flex: 1, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 },
  costLabel: { fontSize: 14 },
  costValue: { fontSize: 15, fontWeight: '800' },
  safety: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 12 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12 },
  footerRow: { flexDirection: 'row', gap: 10, width: '100%', maxWidth: 640, alignSelf: 'center' },
});
