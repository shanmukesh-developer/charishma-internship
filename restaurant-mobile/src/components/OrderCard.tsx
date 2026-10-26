import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { rupees } from '../lib/model';
import { color, font, mono, radius, shadow, space } from '../theme';
import { IconButton } from '../ui/kit';
import {
  callNumber, CampusTag, Elapsed, ItemLines, NoteCallout, OrderActions, PastLine, PaymentBadge, PrepLine, RiderLine, SlotLine,
} from './orderParts';
import type { Order } from '../types';

function OrderCardBase({ order, onOpen, onAccept, onReject }: {
  order: Order; onOpen: (o: Order) => void; onAccept: (o: Order) => void; onReject: (o: Order) => void;
}) {
  const isNew = order.stage === 'new';
  const active = order.stage === 'new' || order.stage === 'preparing' || order.stage === 'ready';
  return (
    <View style={[styles.card, isNew && styles.cardNew]}>
      <Pressable
        onPress={() => onOpen(order)}
        accessibilityRole="button"
        accessibilityLabel={`Order ${order.shortId}, ${order.itemCount} items. Open details`}
        style={({ pressed }) => [{ gap: space.sm }, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.row}>
              <Text style={[font.orderId, mono, { color: color.text }]}>#{order.shortId}</Text>
              <CampusTag order={order} />
            </View>
            <Elapsed order={order} />
          </View>
          <PaymentBadge order={order} />
        </View>

        <SlotLine order={order} />
        <ItemLines order={order} max={order.stage === 'past' ? 3 : undefined} />
        <NoteCallout order={order} />

        <View style={[styles.row, styles.footer]}>
          <Text style={[font.h3, { color: color.text, flex: 1 }]}>
            {rupees(order.totalPrice)} <Text style={[font.small, { color: color.textMuted }]}>· {order.itemCount} item{order.itemCount === 1 ? '' : 's'}</Text>
          </Text>
          {active && order.customerPhone ? (
            <IconButton icon="call" label={`Call customer ${order.customerName || ''}`} onPress={() => callNumber(order.customerPhone)} />
          ) : null}
          <Ionicons name="chevron-forward" size={20} color={color.textMuted} />
        </View>
      </Pressable>

      <PrepLine order={order} />
      <RiderLine order={order} />
      <PastLine order={order} />
      <OrderActions order={order} onAccept={() => onAccept(order)} onReject={() => onReject(order)} />
    </View>
  );
}

export const OrderCard = memo(OrderCardBase);

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: color.border, ...shadow.card },
  cardNew: { borderColor: color.alert, borderWidth: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  footer: { borderTopWidth: 1, borderTopColor: color.surfaceAlt, paddingTop: space.sm },
});
