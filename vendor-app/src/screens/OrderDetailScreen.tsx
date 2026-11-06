import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUPPORT_PHONE } from '../config';
import {
  AddressBlock, CollectLine, CustomerBlock, DoneLine, Elapsed, ItemLines, NoteCallout, OrderActions, SlotLine, useOrderSheets,
} from '../components/orderParts';
import { clockIST, rupees } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { color, font, mono, space } from '../theme';
import { Button, Card, EmptyState, IconButton, kit } from '../ui/kit';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={kit.row}>
      <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>{label}</Text>
      <Text style={[font.body, { color: color.text, fontWeight: strong ? '800' : '600', textAlign: 'right', flexShrink: 1 }]}>{value}</Text>
    </View>
  );
}

export default function OrderDetailScreen({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { orders, restaurant, ordersLoaded } = useStore();
  const { openReject, openCancel, sheets } = useOrderSheets();
  const order = orders.find((o) => o.id === orderId);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
      <IconButton icon="arrow-back" label="Back" onPress={onBack} />
      <Text style={[font.h2, mono, { color: color.text, flex: 1 }]}>{order ? `${order.orderCode}` : 'Order'}</Text>
      {order ? <Elapsed order={order} /> : null}
    </View>
  );

  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        {header}
        <EmptyState
          icon="receipt-outline"
          title={ordersLoaded ? 'Order not found' : 'Loading…'}
          body={ordersLoaded ? 'It may be older than your latest 200 orders.' : undefined}
          action={{ label: 'Back to orders', onPress: onBack }}
        />
      </View>
    );
  }

  const help = () => {
    const text = encodeURIComponent(`Vendor ${restaurant.name} needs help with order ${order.orderCode}`);
    Linking.openURL(`https://wa.me/${SUPPORT_PHONE}?text=${text}`).catch(() => {});
  };
  const hasActions = order.stage !== 'done';
  const extra = Math.round((order.finalPrice - order.totalPrice) * 100) / 100;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xxl }}>
        <Card style={{ gap: space.sm }}>
          <CustomerBlock order={order} />
          <AddressBlock order={order} />
          <SlotLine order={order} />
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text style={[font.label, { color: color.textMuted }]}>ITEMS ({order.itemCount})</Text>
          <ItemLines order={order} showPrices />
          <View style={kit.divider} />
          <Row label="Item total" value={rupees(order.totalPrice)} />
          {extra !== 0 ? <Row label={extra > 0 ? 'Fees' : 'Discount'} value={rupees(extra)} /> : null}
          <Row label="Customer pays" value={rupees(order.finalPrice)} strong />
        </Card>

        <NoteCallout order={order} />
        <CollectLine order={order} />
        <DoneLine order={order} />

        <Card style={{ gap: space.xs }}>
          <Text style={[font.label, { color: color.textMuted }]}>TIMELINE</Text>
          <Row label="Placed" value={clockIST(order.createdAt) || '—'} />
          {order.acceptedAt ? <Row label="Accepted" value={clockIST(order.acceptedAt)} /> : null}
          {order.outForDeliveryAt ? <Row label="Out for delivery" value={clockIST(order.outForDeliveryAt)} /> : null}
          {order.deliveredAt ? <Row label="Delivered" value={clockIST(order.deliveredAt)} /> : null}
          {order.status === 'Cancelled' ? <Row label="Cancelled" value={clockIST(order.updatedAt) || '—'} /> : null}
        </Card>

        <Button label="Help with this order" icon="logo-whatsapp" variant="secondary" size="secondary" onPress={help} />
      </ScrollView>
      {hasActions ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + space.sm }]}>
          <OrderActions order={order} onReject={() => openReject(order)} onCancel={() => openCancel(order)} />
        </View>
      ) : null}
      {sheets}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border },
  bar: { backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, paddingHorizontal: space.md, paddingTop: space.sm },
});
