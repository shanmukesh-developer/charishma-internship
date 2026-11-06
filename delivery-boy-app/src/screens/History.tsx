// Past deliveries grouped by IST day.
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, S, T } from '../theme';
import { Card, EmptyState, ErrorState, ScreenHeader, Skeleton } from '../ui/kit';
import { useRider } from '../state/RiderStore';
import { dayLabel, istDayKey, rupees, timeIST } from '../services/format';
import type { RiderOrder } from '../types';

export function OrderLine({ order, last, showDay }: { order: RiderOrder; last?: boolean; showDay?: boolean }) {
  const when = order.deliveredAt ?? order.createdAt;
  const cancelled = order.status === 'Cancelled';
  const cod = order.paymentMethod === 'COD';
  return (
    <View style={[styles.line, !last && styles.lineBorder]}>
      <View style={[styles.icon, { backgroundColor: cancelled ? C.redTint : C.greenTint }]}>
        <MaterialCommunityIcons name={cancelled ? 'close' : 'check'} size={20} color={cancelled ? C.red : C.greenDark} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.body, { color: C.ink, fontWeight: '800' }]} numberOfLines={1}>
          {order.restaurantName ?? 'Store'}
        </Text>
        <Text style={[T.small, { color: C.muted }]} numberOfLines={1}>
          {order.orderCode} · {showDay && when ? `${dayLabel(istDayKey(when))}, ` : ''}
          {timeIST(when)}
          {cod && order.finalPrice !== null ? ` · Cash ${rupees(order.finalPrice)}` : order.paymentMethod ? ' · Prepaid' : ''}
        </Text>
      </View>
      <Text style={[T.h3, { color: cancelled ? C.muted : C.greenDark }]}>{cancelled ? '—' : `+${rupees(order.earning)}`}</Text>
    </View>
  );
}

export function HistoryScreen() {
  const r = useRider();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    r.refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, RiderOrder[]>();
    for (const o of r.history.data ?? []) {
      const when = o.deliveredAt ?? o.createdAt;
      const key = when ? istDayKey(when) : 'unknown';
      const list = map.get(key) ?? [];
      list.push(o);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [r.history.data]);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: S.xxl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              await r.refreshHistory();
            } finally {
              setRefreshing(false);
            }
          }}
        />
      }
    >
      <ScreenHeader title="History" />
      <View style={{ paddingHorizontal: S.lg, gap: S.lg }}>
        {r.history.error && r.history.updatedAt ? (
          <Text style={[T.small, { color: C.amber, fontWeight: '700' }]}>Offline. Showing data from {timeIST(r.history.updatedAt)}.</Text>
        ) : null}
        {!r.history.loaded && !r.history.data ? (
          <>
            <Skeleton height={90} />
            <Skeleton height={90} />
          </>
        ) : r.history.error && !r.history.data ? (
          <ErrorState message={r.history.error} onRetry={r.refreshHistory} />
        ) : groups.length === 0 ? (
          <EmptyState icon="history" title="No deliveries yet" body="Your completed deliveries will show here." />
        ) : (
          groups.map(([key, list]) => {
            const total = list.reduce((s, o) => s + (o.status === 'Cancelled' ? 0 : o.earning ?? 0), 0);
            return (
              <View key={key} style={{ gap: S.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[T.h3, { color: C.ink, flex: 1 }]}>{key === 'unknown' ? 'Earlier' : dayLabel(key)}</Text>
                  <Text style={[T.body, { color: C.greenDark, fontWeight: '800' }]}>
                    {rupees(total)} · {list.length} order{list.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <Card style={{ paddingVertical: S.xs }}>
                  {list.map((o, i) => (
                    <OrderLine key={o.id} order={o} last={i === list.length - 1} />
                  ))}
                </Card>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md },
  lineBorder: { borderBottomWidth: 1, borderBottomColor: C.cardAlt },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
