/** Your In-Campus Bookings (real bookings of this student only): in progress first, then past ones. Stall-card look. */
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { cbApi, isOpenStatus, type CbBooking } from './cbApi';
import { TYPE, inr, surfaceLift, whenIST, useCbTheme } from './cbTheme';
import { CbHeader, EmptyCard, StatusTag, useCbLive } from './cbKit';

export default function CbBookings() {
  const p = useCbTheme();
  const router = useRouter();
  const [list, setList] = useState<CbBooking[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    try {
      const r = await cbApi.mine();
      setList([...r.bookings.filter((b) => isOpenStatus(b.status)), ...r.bookings.filter((b) => !isOpenStatus(b.status))]);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not load your bookings.');
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useCbLive(() => { void load(); });

  return (
    <View style={{ flex: 1, backgroundColor: p.page }}>
      <CbHeader title="Your bookings" sub="In-Campus Booking" />
      <FlatList
        data={list || []}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, width: '100%', maxWidth: 600, alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={p.accent} colors={[p.accent]} />}
        ListEmptyComponent={!list ? (err ? <EmptyCard icon="cloud-offline-outline" title="Couldn't load your bookings" sub={err} actionLabel="Try again" onAction={() => load()} /> : <EmptyCard loading title="Loading your bookings" />)
          : <EmptyCard icon="bag-check-outline" title="No bookings yet" sub="Book from a campus stall and your bookings appear here." actionLabel="Browse stalls" onAction={() => router.replace('/campus-booking' as any)} />}
        renderItem={({ item: b }) => (
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={() => router.push(((b.status === 'PAYMENT_PENDING' || b.status === 'REJECTED') && b.canSubmitProof ? `/campus-booking/pay/${b.id}` : `/campus-booking/order/${b.id}`) as any)}
            accessibilityLabel={`Booking ${b.ref} at ${b.stall?.name || 'a stall'}, ${b.statusLabel}`}
            style={[st.card, { backgroundColor: p.card, borderColor: p.border }, surfaceLift(p.isDark)]}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[st.name, { color: p.txt, flexShrink: 1 }]} numberOfLines={1}>{b.stall?.name || 'Campus stall'}</Text>
                <StatusTag status={b.status} label={b.statusLabel} />
              </View>
              <Text style={[st.meta, { color: p.txtSec }]} numberOfLines={1}>{`${b.ref} · ${b.itemCount} item${b.itemCount === 1 ? '' : 's'} · ${whenIST(b.createdAt)}`}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
              <Text style={[TYPE.price, { color: p.txt }]}>{inr(b.amount)}</Text>
              <Ionicons name="chevron-forward" size={16} color={p.txtSec} style={{ marginTop: 4 }} />
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const st = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  name: { fontSize: 16, fontWeight: '600', letterSpacing: 0.1 },
  meta: { fontSize: 13, fontWeight: '400' },
});
