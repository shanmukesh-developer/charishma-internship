import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useOrderSheets } from '../components/AcceptReject';
import { StageTabs } from '../components/Nav';
import { OrderCard } from '../components/OrderCard';
import { isTodayIST, acceptAnchorMs } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { color, font, space } from '../theme';
import { EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import type { Order, OrderStage } from '../types';

const EMPTY: Record<OrderStage, { title: string; body: string }> = {
  new: { title: 'No new orders', body: 'Keep the app open and the volume up. New orders ring and speak.' },
  preparing: { title: 'Nothing cooking', body: 'Accepted orders show here until you mark them ready.' },
  ready: { title: 'Nothing waiting', body: 'Packed orders wait here for the rider.' },
  pickedUp: { title: 'Nothing on the road', body: 'Orders out for delivery show here.' },
  past: { title: 'No past orders yet', body: 'Delivered and cancelled orders show here.' },
};

export default function OrdersScreen({ onOpenOrder }: { onOpenOrder: (o: Order) => void }) {
  const { orders, ordersLoaded, ordersError, refreshing, refreshOrders } = useStore();
  const [tab, setTab] = useState<OrderStage>('new');
  const { openAccept, openReject, sheets } = useOrderSheets();

  const { counts, list } = useMemo(() => {
    const c: Record<OrderStage, number> = { new: 0, preparing: 0, ready: 0, pickedUp: 0, past: 0 };
    for (const o of orders) c[o.stage] += 1;
    let l = orders.filter((o) => o.stage === tab);
    if (tab === 'past') {
      l = [...l.filter((o) => isTodayIST(o.createdAt)), ...l.filter((o) => !isTodayIST(o.createdAt))];
    } else {
      // Active queues: due first (accept clock: placement, or 60 min before the delivery slot) so the kitchen works
      // top-down and today's slot comes before tomorrow's even when tomorrow's was booked first.
      l = [...l].sort((a, b) => (acceptAnchorMs(a) || 0) - (acceptAnchorMs(b) || 0));
    }
    return { counts: c, list: l };
  }, [orders, tab]);

  // When the New tab empties but food is cooking, jump to Preparing once (less tapping in a rush).
  const lastNew = useRef(counts.new);
  useEffect(() => {
    if (tab === 'new' && lastNew.current > 0 && counts.new === 0 && counts.preparing > 0) setTab('preparing');
    lastNew.current = counts.new;
  }, [counts.new, counts.preparing, tab]);

  const renderItem = useCallback(
    ({ item }: { item: Order }) => <OrderCard order={item} onOpen={onOpenOrder} onAccept={openAccept} onReject={openReject} />,
    [onOpenOrder, openAccept, openReject],
  );

  const pull = useCallback(() => refreshOrders({ pull: true }), [refreshOrders]);

  return (
    <View style={{ flex: 1 }}>
      <StageTabs value={tab} onChange={setTab} counts={counts} />
      {!ordersLoaded ? (
        ordersError ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load orders" body={ordersError} action={{ label: 'Try again', onPress: pull, loading: refreshing }} />
        ) : (
          <View style={{ padding: space.md, gap: space.md }}><SkeletonCard /><SkeletonCard lines={2} /></View>
        )
      ) : (
        <FlatList
          data={list}
          keyExtractor={(o) => o.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Sep}
          initialNumToRender={6}
          windowSize={7}
          removeClippedSubviews
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} colors={[color.text]} />}
          ListHeaderComponent={ordersError ? <View style={{ marginBottom: space.md }}><ErrorStrip text={ordersError} onRetry={pull} busy={refreshing} /></View> : null}
          ListEmptyComponent={<EmptyState icon={tab === 'new' ? 'notifications-outline' : 'receipt-outline'} title={EMPTY[tab].title} body={EMPTY[tab].body} />}
          ListFooterComponent={tab === 'past' && list.length > 0 ? (
            <Text style={[font.small, { color: color.textMuted, textAlign: 'center', marginTop: space.md }]}>Showing your latest 200 orders</Text>
          ) : null}
        />
      )}
      {sheets}
    </View>
  );
}

const Sep = () => <View style={{ height: space.md }} />;

const styles = StyleSheet.create({
  list: { padding: space.md, paddingBottom: space.xxl * 2 },
});
