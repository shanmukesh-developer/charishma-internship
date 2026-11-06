import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, mono, radius, shadow, space } from '../theme';
import {
  AddressBlock, CollectLine, CustomerBlock, DoneLine, Elapsed, ItemLines, NoteCallout, OrderActions, SlotLine,
} from './orderParts';
import type { Order } from '../types';

function OrderCardBase({ order, onOpen, onReject, onCancel }: {
  order: Order; onOpen: (o: Order) => void; onReject: (o: Order) => void; onCancel: (o: Order) => void;
}) {
  const isNew = order.stage === 'new';
  const done = order.stage === 'done';
  return (
    <View style={[styles.card, isNew && styles.cardNew]}>
      <Pressable
        onPress={() => onOpen(order)}
        accessibilityRole="button"
        accessibilityLabel={`Order ${order.shortId}, ${order.itemCount} items. Open details`}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font.orderId, mono, { color: color.text }]}>{order.orderCode}</Text>
          <Elapsed order={order} />
        </View>
        <Text style={[font.small, { color: color.info, fontWeight: '800' }]}>DETAILS</Text>
        <Ionicons name="chevron-forward" size={20} color={color.info} />
      </Pressable>

      <CustomerBlock order={order} compact />
      <SlotLine order={order} />
      <ItemLines order={order} max={done ? 3 : undefined} />
      <NoteCallout order={order} />
      {!done ? <AddressBlock order={order} /> : null}
      {!done || order.status === 'Delivered' ? <CollectLine order={order} /> : null}
      <DoneLine order={order} />
      <OrderActions order={order} onReject={() => onReject(order)} onCancel={() => onCancel(order)} />
    </View>
  );
}

export const OrderCard = memo(OrderCardBase);

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: color.border, ...shadow.card },
  cardNew: { borderColor: color.alert, borderWidth: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
