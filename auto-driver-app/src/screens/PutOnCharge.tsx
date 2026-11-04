// Put on charge (union queue), the main action at the stand. The driver picks the stand (one per destination:
// SRM gate to Mangalagiri, to Vijayawada, ...) and the auto. No departure time: the auto leaves when it is full
// or when the driver taps Depart. Fare = the seat fare ZCS set for the route, which the driver may change inside
// the route's range; capacity = the approved seats. The server puts the auto in line: on charge at once when
// nobody is ahead, otherwise waiting (#2, #3, ...). Students can book any auto in the line.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';
import { Button, Card, Chip, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import { Banner, Field, Screen, SectionTitle } from '../ui/Screen';
import { useToast } from '../ui/Toast';
import { useLoad } from '../state/useLoad';
import { useSession } from '../state/SessionProvider';
import { driverApi } from '../api/driverApi';
import { ApiError, errorMessage } from '../lib/http';
import { rupees } from '../lib/format';
import type { ChargeStand } from '../types';
import type { ScreenProps } from '../nav';

const standKey = (s: ChargeStand) => `${s.pickupPointId}:${s.routeId}`;

/** The range text for a stand's fare ("₹20 to ₹60"), or null when the route has no bounds. */
export const rangeText = (min: number | null | undefined, max: number | null | undefined) => {
  if (min && max) return `${rupees(min)} to ${rupees(max)}`;
  if (min) return `at least ${rupees(min)}`;
  if (max) return `up to ${rupees(max)}`;
  return null;
};

/** null = fine, else the problem with the typed fare. */
export const fareProblem = (raw: string, min: number | null | undefined, max: number | null | undefined) => {
  const v = Number(raw);
  if (!raw.trim() || !Number.isFinite(v) || v <= 0) return 'Enter the fare per seat.';
  if (min && v < min) return `The fare must be at least ${rupees(min)}.`;
  if (max && v > max) return `The fare can be at most ${rupees(max)}.`;
  return null;
};

const lineText = (s: ChargeStand) => {
  if (!s.inLine) return 'No autos in line';
  return `${s.inLine} auto${s.inLine === 1 ? '' : 's'} in line`;
};

export default function PutOnChargeScreen({ navigation }: ScreenProps<'PutOnCharge'>) {
  const toast = useToast();
  const { me, refreshMe } = useSession();
  const q = useLoad(() => driverApi.chargeSetup(), []);
  const [standId, setStandId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fare, setFare] = useState('');

  const data = q.data;
  const stands = data?.stands || [];
  const vehicles = data?.vehicles || [];
  useEffect(() => {
    if (!vehicleId && vehicles.length) setVehicleId(vehicles[0].id);
  }, [vehicles, vehicleId]);
  useEffect(() => {
    if (!standId && stands.length === 1 && stands[0].fareSet) setStandId(standKey(stands[0]));
  }, [stands, standId]);

  const stand = useMemo(() => stands.find((s) => standKey(s) === standId) || null, [stands, standId]);
  // A new stand pre-fills its set fare; the driver may change it inside the route range.
  useEffect(() => { setFare(stand && stand.seatFare ? String(stand.seatFare) : ''); }, [stand]);
  const problem = stand ? fareProblem(fare, stand.seatFareMin, stand.seatFareMax) : null;
  const vehicle = vehicles.find((v) => v.id === vehicleId) || null;
  const byPickup = useMemo(() => {
    const groups = new Map<string, ChargeStand[]>();
    for (const s of stands) {
      const k = s.pickup.name;
      groups.set(k, [...(groups.get(k) || []), s]);
    }
    return [...groups.entries()];
  }, [stands]);

  const go = async () => {
    if (!stand || !vehicle || busy) return;
    if (problem) { toast.show(problem, 'error'); return; }
    setBusy(true);
    try {
      const picked = Number(fare);
      const r = await driverApi.putOnCharge(stand.pickupPointId, vehicle.id, picked !== stand.seatFare ? picked : undefined);
      const pos = r.trip.line?.position || 1;
      toast.show(r.trip.onCharge ? 'You are on charge now.' : `You are number ${pos} in line.`, 'success');
      navigation.replace('Charge', { tripId: r.trip.id });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
      if (e instanceof ApiError && e.code === 'ACTIVE_TRIP_EXISTS') q.refresh();
      if (e instanceof ApiError && (e.code === 'DRIVER_OFFLINE' || e.code === 'DRIVER_NOT_VERIFIED')) refreshMe();
    } finally {
      setBusy(false);
    }
  };

  if (q.loading && !data) return <Screen title="Put on charge" onBack={() => navigation.goBack()}><SkeletonCard /><SkeletonCard /></Screen>;
  if (!data) {
    return (
      <Screen title="Put on charge" onBack={() => navigation.goBack()}>
        <ErrorStrip text={q.error || 'Could not load the stands.'} onRetry={q.refresh} busy={q.refreshing} />
      </Screen>
    );
  }

  const current = data.currentTrip;
  return (
    <Screen
      title="Put on charge"
      onBack={() => navigation.goBack()}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
      footer={!current ? (
        <Button
          label={stand && !stand.onCharge ? 'Put on charge' : stand ? 'Join the line' : 'Put on charge'}
          icon="flash"
          size="huge"
          variant="accept"
          loading={busy}
          disabled={!stand || !vehicle || !stand.fareSet || !!problem}
          onPress={go}
        />
      ) : undefined}
    >
      {current ? (
        <Card style={{ gap: space.sm }}>
          <Text style={[font.h3, { color: color.text }]}>You already have an active trip</Text>
          <Text style={[font.body, { color: color.textSecondary }]}>Finish it, or leave the line, before you put your auto on charge again.</Text>
          <Button
            label="Open current trip"
            icon="arrow-forward"
            variant="primary"
            onPress={() => (current.dispatchMode === 'ON_CHARGE'
              ? navigation.replace('Charge', { tripId: current.id })
              : navigation.replace('TripDetail', { tripId: current.id }))}
          />
        </Card>
      ) : null}
      {me && !me.featureEnabled ? <Banner tone="info" text="ZENV Auto bookings are switched off right now. You can put your auto on charge once they open." /> : null}

      <SectionTitle text="Where is your auto?" />
      {!stands.length ? (
        <EmptyState icon="location" title="No stands yet" body="ZENV has not added a stand and destination yet. Please ask the ZENV team." />
      ) : byPickup.map(([pickupName, list]) => (
        <View key={pickupName} style={{ gap: space.xs }}>
          <Text style={[font.small, { color: color.textMuted }]}>{pickupName}</Text>
          {list.map((s) => {
            const selected = standId === standKey(s);
            return (
              <Pressable
                key={standKey(s)}
                onPress={() => (s.fareSet ? setStandId(standKey(s)) : toast.show('ZENV has not set the seat fare for this destination yet.', 'info'))}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !s.fareSet }}
                accessibilityLabel={`To ${s.destination}, ${s.seatFare ? `${rupees(s.seatFare)} a seat` : 'fare not set'}, ${lineText(s)}`}
                style={({ pressed }) => [styles.stand, selected && styles.standOn, !s.fareSet && { opacity: 0.55 }, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={26} color={selected ? color.open : color.textMuted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[font.h2, { color: color.text }]} numberOfLines={1}>To {s.destination}</Text>
                  <Text style={[font.small, { color: color.textSecondary }]}>
                    {s.fareSet && s.seatFare ? `${rupees(s.seatFare)} a seat` : 'Fare not set yet'} · {lineText(s)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <SectionTitle text="Your auto" />
      {!vehicles.length ? (
        <Card style={{ gap: space.sm }}>
          <Text style={[font.body, { color: color.textSecondary }]}>None of your autos is approved yet. ZENV checks the papers and approves the seats.</Text>
          <Button label="My autos" icon="car" variant="secondary" onPress={() => navigation.navigate('Vehicles')} />
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {vehicles.map((v) => (
            <Chip key={v.id} label={v.registration || 'Auto'} sub={`${v.capacity} seats`} selected={vehicleId === v.id} onPress={() => setVehicleId(v.id)} style={{ minWidth: 150, flexGrow: 1 }} />
          ))}
        </View>
      )}

      {stand && stand.fareSet ? (
        <>
          <Field
            label="Fare per seat"
            prefix="₹"
            keyboardType="number-pad"
            value={fare}
            onChangeText={(v) => setFare(v.replace(/[^0-9.]/g, '').slice(0, 6))}
            error={fare && problem ? problem : null}
            hint={`${rangeText(stand.seatFareMin, stand.seatFareMax) ? `Allowed ${rangeText(stand.seatFareMin, stand.seatFareMax)}. ` : ''}You can change it until a student books.`}
          />
        </>
      ) : null}

      {stand && vehicle ? (
        <Card style={{ gap: space.xs }}>
          <Text style={[font.h3, { color: color.text }]}>{stand.pickup.name} to {stand.destination}</Text>
          <Text style={[font.body, { color: color.textSecondary }]}>
            {!problem ? `${rupees(Number(fare))} a seat, paid in cash` : 'Set the fare'} · {vehicle.capacity} seats
          </Text>
          <Text style={[font.small, { color: color.textMuted }]}>
            {stand.onCharge
              ? `Another auto is on charge. You join the line as number ${stand.inLine + 1}; students can book your auto while you wait.`
              : 'Nobody is on charge here. Your auto goes on charge at once.'}
          </Text>
          <Text style={[font.small, { color: color.textMuted }]}>No departure time: you leave when the auto is full, or when you tap Depart.</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: color.surface, borderWidth: 2, borderColor: color.border, minHeight: 72 },
  standOn: { borderColor: color.open, backgroundColor: color.openTint },
});
