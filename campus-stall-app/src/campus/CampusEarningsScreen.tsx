// In-Campus Booking earnings (owner board vendor screen 6): real paid bookings only. Total paid by students,
// number of orders, the ZCS commission (1.5 %, recorded on each booking) and what is yours, plus recent orders.
// Students pay you directly by UPI: this is a record of what you received, not a payout from ZCS.
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { campusApi, dateTimeIST, inr, type CbEarnings } from '../lib/campusApi';
import { errorMessage } from '../lib/http';
import { color, font, radius, space, touch } from '../theme';
import { Card, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import { ScreenHeader, StatusBadge, Tile, itemsLine } from './CampusParts';
import { useCampusLive } from './useCampusLive';

const RANGES: { key: CbEarnings['range']; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];

export default function CampusEarningsScreen({ onBack, onOpen }: { onBack?: () => void; onOpen: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<CbEarnings['range']>('today');
  const [data, setData] = useState<CbEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    try {
      setData(await campusApi.earnings(range));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Couldn't load earnings."));
    } finally {
      setRefreshing(false);
    }
  }, [range]);
  useEffect(() => { setData(null); void load(); }, [load]);
  useCampusLive(() => { void load(); });

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <View style={styles.ranges} accessibilityRole="tablist">
        {RANGES.map((r) => {
          const sel = r.key === range;
          return (
            <Pressable key={r.key} onPress={() => setRange(r.key)} accessibilityRole="tab" accessibilityState={{ selected: sel }} style={[styles.range, sel && styles.rangeSel]}>
              <Text style={[font.small, { color: sel ? color.textInverse : color.text, fontWeight: '800' }]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <ErrorStrip text={error} onRetry={() => load(true)} busy={refreshing} /> : null}
      {data ? (
        <>
          <Card style={{ alignItems: 'center', gap: 2, backgroundColor: color.openTint, borderColor: color.open }}>
            <Text style={[font.small, { color: color.openDark, fontWeight: '800' }]}>Total paid by students</Text>
            <Text style={[font.money, { color: color.openDark, fontSize: 36, lineHeight: 42 }]}>{inr(data.total)}</Text>
            <Text style={[font.small, { color: color.textSecondary }]}>Straight to your UPI</Text>
          </Card>
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Tile label="Orders" value={String(data.orders)} caption={`${data.collected} collected`} />
            <Tile label={`ZenWe commission ${data.commissionPct}%`} value={inr(data.commission)} caption="Recorded per order" />
          </View>
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>Yours after commission</Text>
            <Text style={[font.h2, { color: color.text }]}>{inr(data.net)}</Text>
          </Card>
          <Text style={[font.h3, { color: color.text }]}>Recent orders</Text>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <ScreenHeader title="Earnings" sub="In-Campus Booking" onBack={onBack} />
      <FlatList
        data={data?.recent || []}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: space.md, gap: space.xs, paddingBottom: space.xxl + insets.bottom }}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[color.open]} />}
        ListEmptyComponent={!data ? <SkeletonCard /> : <EmptyState icon="wallet-outline" title="No paid bookings in this period" />}
        renderItem={({ item: b }) => (
          <Pressable onPress={() => onOpen(b.id)} accessibilityRole="button" accessibilityLabel={`Booking ${b.ref}, ${inr(b.amount)}`} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[font.body, { color: color.text, fontWeight: '800' }]}>#{b.ref} · {dateTimeIST(b.paymentVerifiedAt)}</Text>
                <Text style={[font.small, { color: color.textMuted }]} numberOfLines={1}>{itemsLine(b)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={[font.h3, { color: color.text }]}>{inr(b.amount)}</Text>
                <Text style={[font.small, { color: color.textMuted }]}>- {inr(b.commission)} ZenWe</Text>
              </View>
              <StatusBadge status={b.status} />
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ranges: { flexDirection: 'row', gap: space.xs },
  range: { flex: 1, minHeight: touch.min, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  rangeSel: { backgroundColor: color.openDark, borderColor: color.openDark },
});
