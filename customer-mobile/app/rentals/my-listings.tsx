// My vehicles: status of each listing, pending requests, edit / pause / resume / submit / remove.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import SafeImage from '../../components/SafeImage';
import { rentalsApi, type OwnListing, LISTING_STATUS_META, VEHICLE_META, priceLabel, wordsOf, tripsLabel } from '../../modules/rentals/rentalsApi';
import { VEHICLE_FALLBACK, RHeader, usePalette, Card, Badge, Btn, StateView, Notice, Stars, useRentalLive, RIcon } from '../../modules/rentals/ui';

const MISSING_LABEL: Record<string, string> = {
  photos: 'photos', 'documents.rc': 'RC', 'documents.insurance': 'insurance', 'documents.licence': 'your licence', price: 'rent or cost share',
  pickupLocation: 'pickup point', registrationNumber: 'registration', plateType: 'plate type', make: 'make', model: 'model', year: 'year', fuel: 'fuel',
  transmission: 'transmission', seats: 'seats', vehicleType: 'vehicle type',
};

export default function MyListings() {
  const router = useRouter();
  const p = usePalette();
  const [items, setItems] = useState<OwnListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await rentalsApi.myListings();
      setItems(res.listings);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load your vehicles.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useRentalLive(() => load());

  const act = async (l: OwnListing, kind: 'pause' | 'resume' | 'submit' | 'delete') => {
    if (busy) return; // one listing action at a time (double taps sent the same action twice)
    const run = async () => {
      setBusy(`${l.id}:${kind}`);
      try {
        const res: any = kind === 'pause' ? await rentalsApi.pauseListing(l.id)
          : kind === 'resume' ? await rentalsApi.resumeListing(l.id)
            : kind === 'submit' ? await rentalsApi.submitListing(l.id)
              : await rentalsApi.deleteListing(l.id);
        if (res?.message) Alert.alert('Done', res.message);
        await load();
      } catch (e: any) {
        Alert.alert('Could not update', e?.message || 'Please try again.');
      } finally {
        setBusy(null);
      }
    };
    if (kind === 'delete') {
      Alert.alert('Remove this vehicle?', 'Pending requests will be declined. Confirmed trips must be finished or cancelled first.', [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: run },
      ]);
    } else run();
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <RHeader title="My vehicles" subtitle="Vehicles you rent out or lend" right={<Btn label="+ Add" small onPress={() => router.push('/rentals/new' as any)} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        {items === null && !error ? <StateView kind="loading" /> : null}
        {error && !items ? <StateView kind="error" title="Could not load" message={error} actionLabel="Retry" onAction={load} /> : null}
        {items && items.length === 0 ? <StateView kind="empty" icon="key-outline" title="No vehicles yet" message="List your bike, scooter or car. You set the rent or cost share and the hours; renters or borrowers pay you in cash at pickup." actionLabel="Rent out or lend your vehicle" onAction={() => router.push('/rentals/new' as any)} /> : null}
        {items && items.some((l) => (l.pendingRequests || 0) > 0) ? (
          <TouchableOpacity onPress={() => router.push('/rentals/bookings?role=owner' as any)} accessibilityRole="button">
            <Notice tone="warn">You have booking requests waiting. Answer within 2 hours or they expire. Tap to open.</Notice>
          </TouchableOpacity>
        ) : null}
        {(items || []).map((l) => {
          const meta = LISTING_STATUS_META[l.status];
          return (
            <Card key={l.id}>
              <TouchableOpacity onPress={() => router.push(`/rentals/${l.id}` as any)} accessibilityRole="button" style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden', backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
                  {l.photos[0] ? <SafeImage source={{ uri: l.photos[0] }} style={{ width: 72, height: 72 }} contentFit="cover" fallbackUri={VEHICLE_FALLBACK} /> : <RIcon name={VEHICLE_META[l.vehicleType]?.icon || 'car-outline'} size={28} color={p.muted} />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Badge label={meta.label} color={meta.color} />
                    {l.plateType ? <Badge label={wordsOf(l).badge} color={wordsOf(l).color} /> : null}
                    {(l.pendingRequests || 0) > 0 ? <Badge label={`${l.pendingRequests} request${l.pendingRequests === 1 ? '' : 's'}`} color="#EF4444" /> : null}
                  </View>
                  <Text style={{ fontSize: 14.5, fontWeight: '900', color: p.text, marginTop: 5 }} numberOfLines={1}>{l.title}{l.year ? ` · ${l.year}` : ''}</Text>
                  <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{l.registrationDisplay || 'No registration yet'} · {priceLabel(l)}</Text>
                  {l.ratingCount > 0 ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}><Stars value={l.ratingAvg} size={11} /><Text style={{ fontSize: 11, color: p.sub }}>{tripsLabel(l.tripCount)}</Text></View> : null}
                </View>
              </TouchableOpacity>
              {l.status === 'REJECTED' && l.rejectionReason ? <Text style={{ color: p.danger, fontSize: 12, marginTop: 10 }}>Zenvy: {l.rejectionReason}</Text> : null}
              {(l.status === 'DRAFT' || l.status === 'REJECTED') && l.missing && l.missing.length ? <Text style={{ color: p.warn, fontSize: 12, marginTop: 8 }}>Still needed: {l.missing.map((m) => (m === 'price' && l.plateType ? wordsOf(l).price : MISSING_LABEL[m] || m)).join(', ')}</Text> : null}
              {l.status === 'PENDING_REVIEW' ? <Text style={{ color: p.sub, fontSize: 12, marginTop: 8 }}>Zenvy is checking your documents. You will get a notification.</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                <Btn label="Edit" small kind="secondary" onPress={() => router.push(`/rentals/new?id=${l.id}` as any)} />
                {(l.status === 'DRAFT' || l.status === 'REJECTED') && (!l.missing || !l.missing.length) ? <Btn label="Send for review" small loading={busy === `${l.id}:submit`} onPress={() => act(l, 'submit')} /> : null}
                {l.status === 'APPROVED' ? <Btn label="Pause" small kind="secondary" loading={busy === `${l.id}:pause`} onPress={() => act(l, 'pause')} /> : null}
                {l.status === 'PAUSED' ? <Btn label="Resume" small kind="success" loading={busy === `${l.id}:resume`} onPress={() => act(l, 'resume')} /> : null}
                {(l.pendingRequests || 0) + (l.openBookings || 0) > 0 ? <Btn label="Bookings" small kind="ghost" onPress={() => router.push('/rentals/bookings?role=owner' as any)} /> : null}
                <Btn label="Remove" small kind="ghost" loading={busy === `${l.id}:delete`} onPress={() => act(l, 'delete')} style={{ borderColor: p.danger }} />
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}
