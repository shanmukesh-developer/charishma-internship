// Small order building blocks shared by Home, Delivery, Earnings and History.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, R, S, T } from '../theme';
import { Badge } from '../ui/kit';
import { itemCount } from '../services/orderModel';
import { haversineKm } from '../services/location';
import { km, rupees } from '../services/format';
import type { RiderOrder } from '../types';
import type { Fix } from '../services/location';

export function cashToCollect(o: RiderOrder): number {
  return o.paymentMethod === 'COD' && o.amountToCollect && o.amountToCollect > 0 ? o.amountToCollect : 0;
}

/** "Collect ₹325 cash" or "Prepaid". Unknown payment → nothing. */
export function PaymentPill({ order }: { order: RiderOrder }) {
  const cash = cashToCollect(order);
  if (cash > 0) return <Badge tone="cash" icon="cash" label={`Collect ${rupees(cash)} cash`} />;
  if (order.paymentMethod) return <Badge tone="green" icon="check-circle" label="Prepaid · no cash" />;
  return null;
}

/** Huge cash box shown on the way to and at the customer. */
export function CashBox({ order }: { order: RiderOrder }) {
  const cash = cashToCollect(order);
  if (cash <= 0) {
    if (!order.paymentMethod) return null;
    return (
      <View style={[styles.cash, { backgroundColor: C.greenTint, borderColor: C.green }]}>
        <MaterialCommunityIcons name="check-decagram" size={32} color={C.greenDark} />
        <View style={{ flex: 1 }}>
          <Text style={[T.h3, { color: C.greenDark }]}>Prepaid</Text>
          <Text style={[T.body, { color: C.greenDark }]}>Do not take any cash.</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.cash} accessibilityLabel={`Collect ${cash} rupees cash`}>
      <MaterialCommunityIcons name="cash-multiple" size={36} color={C.cash} />
      <View style={{ flex: 1 }}>
        <Text style={[T.label, { color: C.cash }]}>COLLECT CASH</Text>
        <Text style={[T.money, { color: C.cash }]}>{rupees(cash)}</Text>
      </View>
    </View>
  );
}

export function distanceTo(order: RiderOrder, fix: Fix | null): string | null {
  if (fix && order.pickupCoords) return km(haversineKm(fix, order.pickupCoords));
  return null;
}

export function ItemsLine({ order }: { order: RiderOrder }) {
  const n = itemCount(order);
  if (!order.items.length) return null;
  const names = order.items
    .slice(0, 3)
    .map((i) => `${i.quantity} × ${i.name}${i.options ? ` (${i.options})` : ''}`)
    .join(', ');
  const more = order.items.length > 3 ? ` +${order.items.length - 3} more` : '';
  return (
    <Text style={[T.small, { color: C.ink2 }]} numberOfLines={2}>
      {n} item{n === 1 ? '' : 's'}: {names}
      {more}
    </Text>
  );
}

export function ItemChecklist({ order, ticked, onToggle }: { order: RiderOrder; ticked: Set<number>; onToggle: (i: number) => void }) {
  if (!order.items.length) {
    return <Text style={[T.body, { color: C.muted }]}>No item list for this order. Check the bill at the counter.</Text>;
  }
  return (
    <View style={{ gap: S.sm }}>
      {order.items.map((it, i) => {
        const on = ticked.has(i);
        return (
          <Pressable
            key={i}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${it.quantity} ${it.name}${it.options ? `, ${it.options}` : ''}`}
            onPress={() => onToggle(i)}
            style={[styles.check, on && { backgroundColor: C.greenTint, borderColor: C.green }]}
          >
            <MaterialCommunityIcons name={on ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={30} color={on ? C.green : C.muted} />
            <Text style={[T.h3, { color: C.ink, minWidth: 40 }]}>{it.quantity}×</Text>
            <View style={{ flex: 1 }}>
              <Text style={[T.body, { color: C.ink, fontWeight: '700' }]}>{it.name}</Text>
              {it.options ? <Text style={[T.small, { color: C.blue, fontWeight: '700', marginTop: 2 }]}>{it.options}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Instructions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.notes}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <MaterialCommunityIcons name="message-alert-outline" size={22} color={C.blue} />
        <Text style={[T.label, { color: C.blue }]}>CUSTOMER NOTE</Text>
      </View>
      {items.map((t, i) => (
        <Text key={i} style={[T.body, { color: C.ink, fontWeight: '700' }]}>
          • {t}
        </Text>
      ))}
    </View>
  );
}

const STEP_LABELS = ['Pickup', 'Picked', 'Drop', 'PIN', 'Done'];

/** 5-dot progress: pickup → picked → drop → PIN → delivered. */
export function StepBar({ index }: { index: number }) {
  return (
    <View style={styles.steps} accessibilityLabel={`Step ${index + 1} of 5: ${STEP_LABELS[index]}`}>
      {STEP_LABELS.map((l, i) => {
        const done = i < index;
        const now = i === index;
        return (
          <View key={l} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={[styles.stepBar, { backgroundColor: done || now ? (now ? C.ink : C.green) : C.line }]} />
            <Text style={[T.small, { color: now ? C.ink : done ? C.greenDark : C.muted, fontWeight: now ? '800' : '600' }]}>{l}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Where to go: icon, title, address. */
export function Place({ kind, title, address }: { kind: 'store' | 'drop'; title: string | null; address: string | null }) {
  return (
    <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'flex-start' }}>
      <View style={[styles.placeIcon, { backgroundColor: kind === 'store' ? C.amberTint : C.blueTint }]}>
        <MaterialCommunityIcons name={kind === 'store' ? 'storefront-outline' : 'map-marker-radius'} size={26} color={kind === 'store' ? C.amber : C.blue} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.label, { color: C.muted }]}>{kind === 'store' ? 'PICKUP' : 'DROP'}</Text>
        <Text style={[T.h3, { color: C.ink }]} numberOfLines={2}>
          {title ?? (kind === 'store' ? 'Store' : 'Customer')}
        </Text>
        {address ? (
          <Text style={[T.body, { color: C.ink2 }]} numberOfLines={3}>
            {address}
          </Text>
        ) : (
          <Text style={[T.small, { color: C.muted }]}>No address shared. Call for directions.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: S.lg,
    borderRadius: R.lg,
    borderWidth: 2,
    borderColor: C.cashLine,
    backgroundColor: C.cashTint,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    minHeight: 60,
    paddingHorizontal: S.md,
    borderRadius: R.md,
    borderWidth: 2,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  notes: { gap: S.xs, padding: S.md, borderRadius: R.md, backgroundColor: C.blueTint },
  steps: { flexDirection: 'row', gap: 6 },
  stepBar: { height: 6, borderRadius: 3, alignSelf: 'stretch' },
  placeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
