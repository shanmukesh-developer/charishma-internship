// My rental bookings: as renter / borrower (vehicles I rent or borrow) and as owner / lender (requests for my
// vehicles), upcoming / past. C7: every row is worded for its mode (Rent or Borrow) and badged.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import SafeImage from '../../components/SafeImage';
import { rentalsApi, type Booking, BOOKING_STATUS_META, VEHICLE_META, inr, fmtDateTime, wordsOf, bookingStatusLabel } from '../../modules/rentals/rentalsApi';
import { VEHICLE_FALLBACK, RHeader, usePalette, Chips, Badge, StateView, useRentalLive } from '../../modules/rentals/ui';

export default function RentalBookings() {
  const params = useLocalSearchParams<{ role?: string }>();
  const router = useRouter();
  const p = usePalette();
  const [role, setRole] = useState<'renter' | 'owner'>(params.role === 'owner' ? 'owner' : 'renter');
  const [scope, setScope] = useState<'open' | 'past'>('open');
  const [items, setItems] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Only the latest request may update the list (switching role / scope quickly must not show the other list).
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    const my = ++reqIdRef.current;
    try {
      const res = await rentalsApi.bookings(role, scope);
      if (my !== reqIdRef.current) return;
      setItems(Array.isArray(res?.bookings) ? res.bookings : []);
      setError(null);
    } catch (e: any) {
      if (my === reqIdRef.current) setError(e?.message || 'Could not load bookings.');
    }
  }, [role, scope]);
  useEffect(() => { setItems(null); load(); }, [load]);
  useRentalLive(() => load());

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <RHeader title="My bookings" subtitle="Rent & borrow · cash at pickup · PIN handover" />
      <FlatList
        data={items || []}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}
        ListHeaderComponent={
          <View style={{ marginBottom: 12, gap: 10 }}>
            <Chips<'renter' | 'owner'> options={[{ key: 'renter', label: '🧳 I am renting / borrowing' }, { key: 'owner', label: '🔑 My vehicles' }]} value={role} onChange={setRole} />
            <Chips<'open' | 'past'> options={[{ key: 'open', label: 'Upcoming & active' }, { key: 'past', label: 'Past' }]} value={scope} onChange={setScope} />
          </View>
        }
        ListEmptyComponent={
          items === null && !error ? <StateView kind="loading" />
            : error ? <StateView kind="error" title="Could not load" message={error} actionLabel="Retry" onAction={load} />
              : <StateView kind="empty" icon={role === 'renter' ? '🧳' : '🔑'} title={scope === 'open' ? 'Nothing coming up' : 'No past trips'}
                message={role === 'renter' ? 'Find a bike, scooter or car from a verified student.' : 'Requests for your vehicles show up here.'}
                actionLabel={role === 'renter' ? 'Browse vehicles' : 'My vehicles'} onAction={() => router.push((role === 'renter' ? '/rentals' : '/rentals/my-listings') as any)} />
        }
        renderItem={({ item: b }) => {
          const w = wordsOf(b);
          const known = !!BOOKING_STATUS_META[b.status];
          const baseMeta = known ? { ...BOOKING_STATUS_META[b.status], label: bookingStatusLabel(b.status, b) } : { ...BOOKING_STATUS_META.REQUESTED, label: String(b.status || 'Booking') };
          const needsAction = b.role === 'OWNER' && b.status === 'REQUESTED';
          // The owner is the one who has to answer: never show them "waiting for owner".
          const meta = needsAction ? { ...baseMeta, label: 'New request' } : baseMeta;
          return (
            <TouchableOpacity onPress={() => router.push(`/rentals/booking/${b.id}` as any)} accessibilityRole="button" accessibilityLabel={`${b.vehicleTitle}, ${meta.label}`}
              style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: needsAction ? p.warn : p.border, backgroundColor: p.card, marginBottom: 10 }}>
              <View style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
                {b.vehiclePhoto ? <SafeImage source={{ uri: b.vehiclePhoto }} style={{ width: 64, height: 64 }} contentFit="cover" fallbackUri={VEHICLE_FALLBACK} /> : <Text style={{ fontSize: 26 }}>{b.vehicleType ? VEHICLE_META[b.vehicleType].icon : '🚗'}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Badge label={meta.label.toUpperCase()} color={meta.color} />
                  <Badge label={w.badge} color={w.color} />
                  {needsAction ? <Badge label="ANSWER NOW" color="#EF4444" /> : null}
                  {b.role === 'RENTER' && (b.canRespondToCharges || b.termsPending) ? <Badge label={b.termsPending ? 'ACCEPT TERMS' : 'REVIEW CHARGES'} color="#EF4444" /> : null}
                </View>
                <Text style={{ fontSize: 14, fontWeight: '900', color: p.text, marginTop: 4 }} numberOfLines={1}>{b.vehicleTitle}</Text>
                <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }} numberOfLines={1}>{fmtDateTime(b.startAt)} → {fmtDateTime(b.endAt)}</Text>
                <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }} numberOfLines={1}>{b.role === 'OWNER' ? `${w.Taker}: ${b.counterpart?.name || 'Student'}` : `${w.Giver}: ${b.counterpart?.name || 'Student'}`} · {inr(b.payAtHandover)} cash at pickup</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}
