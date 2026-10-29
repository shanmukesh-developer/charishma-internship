// Pieces shared by the order card, order detail and the new-order alert.
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NEW_ORDER_LATE_MIN, NEW_ORDER_WARN_MIN } from '../config';
import { agoText, clockIST, minutesSince, rupees } from '../lib/model';
import { useNow, useStore } from '../state/StoreProvider';
import { color, font, radius, space } from '../theme';
import { Badge, Button, IconButton } from '../ui/kit';
import type { Order } from '../types';

export const callNumber = (phone: string | null | undefined) => {
  if (!phone) return;
  Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => {});
};

export function PaymentBadge({ order, withAmount }: { order: Order; withAmount?: boolean }) {
  if (order.isCOD) {
    return (
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Badge text="CASH" icon="cash-outline" fg={color.cash} bg={color.cashTint} border={color.cashBorder} />
        {withAmount ? <Text style={[font.label, { color: color.cash }]}>Rider collects {rupees(order.finalPrice)}</Text> : null}
      </View>
    );
  }
  return <Badge text="PAID" icon="checkmark-circle" fg={color.prepaid} bg={color.prepaidTint} />;
}

export function Elapsed({ order, onDark }: { order: Order; onDark?: boolean }) {
  const now = useNow();
  const mins = minutesSince(order.createdAt, now);
  const isNew = order.stage === 'new';
  const tint = onDark ? color.textInverse
    : isNew && mins >= NEW_ORDER_LATE_MIN ? color.alert
      : isNew && mins >= NEW_ORDER_WARN_MIN ? color.warning : color.textMuted;
  return (
    <Text style={[font.small, { color: tint, fontWeight: isNew && mins >= NEW_ORDER_WARN_MIN ? '800' : '600' }]}>
      {order.stage === 'past' ? clockIST(order.createdAt) : agoText(order.createdAt, now)}
      {isNew && mins >= NEW_ORDER_LATE_MIN ? ' · accept now' : ''}
    </Text>
  );
}

export function CampusTag({ order }: { order: Order }) {
  if (!order.campus) return null;
  return <Badge text={order.campus.toUpperCase()} icon="location" fg={color.info} bg={color.infoTint} />;
}

export function ItemLines({ order, showPrices, max }: { order: Order; showPrices?: boolean; max?: number }) {
  const list = max ? order.items.slice(0, max) : order.items;
  const more = order.items.length - list.length;
  if (order.items.length === 0) {
    return <Text style={[font.small, { color: color.textMuted }]}>Loading items…</Text>;
  }
  return (
    <View style={{ gap: space.xs }}>
      {list.map((it) => (
        <View key={it.key}>
          <View style={styles.lineRow}>
            <View style={styles.qty}><Text style={[font.item, { color: color.textInverse }]}>{it.quantity}</Text></View>
            <Text style={[font.item, { color: color.text, flex: 1 }]}>{it.name}</Text>
            {it.isAddOn ? <Badge text="ADD-ON" fg={color.info} bg={color.infoTint} /> : null}
            {showPrices ? (
              <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{it.lineTotal !== null ? rupees(it.lineTotal) : '—'}</Text>
            ) : null}
          </View>
          {it.customizations ? <Text style={[font.body, styles.sub, { color: color.warning, fontWeight: '700' }]}>{it.customizations}</Text> : null}
          {showPrices && it.unitPrice !== null && it.quantity > 1 ? (
            <Text style={[font.small, styles.sub, { color: color.textMuted }]}>{rupees(it.unitPrice)} × {it.quantity}</Text>
          ) : null}
        </View>
      ))}
      {more > 0 ? <Text style={[font.small, styles.sub, { color: color.textMuted }]}>+ {more} more item{more > 1 ? 's' : ''}</Text> : null}
    </View>
  );
}

/** The delivery slot the customer booked: the kitchen plans the order for this window. */
export function SlotLine({ order }: { order: Order }) {
  if (!order.slotLabel) return null;
  return (
    <View style={styles.slot} accessibilityLabel={`Delivery slot ${order.slotLabel}`}>
      <Ionicons name="time" size={20} color={color.info} />
      <View style={{ flex: 1 }}>
        <Text style={[font.label, { color: color.info }]}>DELIVERY SLOT</Text>
        <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{order.slotLabel}</Text>
      </View>
    </View>
  );
}

export function NoteCallout({ order }: { order: Order }) {
  if (!order.instructions.length) return null;
  return (
    <View style={styles.callout} accessibilityLabel={`Customer note: ${order.instructions.join('. ')}`}>
      <Ionicons name="chatbubble-ellipses" size={20} color={color.warning} />
      <View style={{ flex: 1 }}>
        <Text style={[font.label, { color: color.warning }]}>CUSTOMER NOTE</Text>
        {order.instructions.map((t, i) => (
          <Text key={i} style={[font.body, { color: color.text, fontWeight: '600' }]}>{t}</Text>
        ))}
      </View>
    </View>
  );
}

export function RiderLine({ order }: { order: Order }) {
  if (order.stage !== 'preparing' && order.stage !== 'ready' && order.stage !== 'pickedUp') return null;
  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'bicycle';
  let text: string;
  let strong = false;
  if (order.stage === 'pickedUp') text = order.status === 'ArrivedAtGate' ? 'Rider at the customer’s gate' : 'Out for delivery';
  else if (order.status === 'Picking') { text = `${order.riderName || 'Rider'} is at your counter`; icon = 'storefront'; strong = true; }
  else if (!order.deliveryPartnerId) { text = 'Finding a rider…'; icon = 'search'; }
  else text = `${order.riderName || 'Rider'} is coming`;
  return (
    <View style={[styles.rider, strong && { backgroundColor: color.info }]}>
      <Ionicons name={icon} size={20} color={strong ? color.textInverse : color.info} />
      <Text style={[font.body, { color: strong ? color.textInverse : color.info, flex: 1, fontWeight: '800' }]}>{text}</Text>
      {order.deliveryPartnerId && order.riderPhone && order.stage !== 'pickedUp' ? (
        <IconButton icon="call" label={`Call rider ${order.riderName || ''}`} onPress={() => callNumber(order.riderPhone)} tint={color.info} bg={color.surface} />
      ) : null}
    </View>
  );
}

export function PrepLine({ order }: { order: Order }) {
  const now = useNow();
  if (order.stage !== 'preparing' || !order.estDuration) return null;
  const acceptedMs = order.acceptedAt ? new Date(order.acceptedAt).getTime() : NaN;
  if (!Number.isFinite(acceptedMs)) {
    return <Text style={[font.body, { color: color.textSecondary }]}>Prep time {order.estDuration} min</Text>;
  }
  const prepMs = order.estDuration * 60000;
  const slotMs = order.slotStart ? new Date(order.slotStart).getTime() : NaN;
  const due = Number.isFinite(slotMs) ? Math.max(slotMs, acceptedMs + prepMs) : acceptedMs + prepMs;
  const cookFrom = due - prepMs;
  if (Number.isFinite(slotMs) && now < cookFrom) {
    // Accepted early for a later slot: nothing is late yet, say when to start.
    return (
      <View style={styles.prep}>
        <Ionicons name="time-outline" size={20} color={color.textSecondary} />
        <Text style={[font.body, { color: color.textSecondary, fontWeight: '800', flex: 1 }]}>
          Start cooking by {clockIST(cookFrom)} · ready by {clockIST(due)}
        </Text>
      </View>
    );
  }
  const left = Math.round((due - now) / 60000);
  const late = left < 0;
  return (
    <View style={[styles.prep, late && { backgroundColor: color.alertTint }]}>
      <Ionicons name="timer-outline" size={20} color={late ? color.alert : color.textSecondary} />
      <Text style={[font.body, { color: late ? color.alertDark : color.textSecondary, fontWeight: '800', flex: 1 }]}>
        {late ? `${-left} min late` : `${left} min left`} · ready by {clockIST(due)}
      </Text>
    </View>
  );
}

export function PastLine({ order }: { order: Order }) {
  if (order.stage !== 'past') return null;
  if (order.status === 'Delivered') {
    return <Badge text={`DELIVERED ${clockIST(order.deliveredAt || order.updatedAt)}`} icon="checkmark-done" fg={color.openDark} bg={color.openTint} />;
  }
  return (
    <View style={[styles.prep, { backgroundColor: color.alertTint }]}>
      <Ionicons name="close-circle" size={18} color={color.alert} />
      <Text style={[font.small, { color: color.alertDark, fontWeight: '700', flex: 1 }]}>
        Cancelled{order.cancellationReason ? ` — ${order.cancellationReason}` : ''}
      </Text>
    </View>
  );
}

/** One obvious action per stage: New → Accept (+ Reject), Preparing → MARK READY, Ready → info. */
export function OrderActions({ order, onAccept, onReject }: { order: Order; onAccept: () => void; onReject: () => void }) {
  const { busy, markReady, isGhostTap } = useStore();
  const b = busy[order.id];
  // Opening the accept / reject sheet is not a server action: guard it here against a double tap that
  // landed on this card after the previous order left the list.
  const guarded = (fn: () => void) => () => { if (!isGhostTap(order.id)) fn(); };
  if (order.stage === 'new') {
    return (
      <View style={styles.actions}>
        <Button label="Reject" variant="rejectOutline" onPress={guarded(onReject)} disabled={!!b} loading={b === 'reject'} style={{ flex: 1 }} />
        <Button label="Accept" variant="accept" icon="checkmark-circle" onPress={guarded(onAccept)} disabled={!!b} loading={b === 'accept'} style={{ flex: 2 }} />
      </View>
    );
  }
  if (order.stage === 'preparing') {
    return <Button label="MARK READY" variant="primary" icon="bag-check" onPress={() => markReady(order)} disabled={!!b} loading={b === 'ready'} />;
  }
  if (order.stage === 'ready') {
    if (order.status === 'Picking' && !order.readyAt) {
      return <Button label="FOOD PACKED — TELL RIDER" variant="primary" icon="bag-check" onPress={() => markReady(order)} disabled={!!b} loading={b === 'ready'} />;
    }
    return (
      <View style={styles.strip}>
        <Ionicons name="bag-check" size={20} color={color.openDark} />
        <Text style={[font.body, { color: color.openDark, fontWeight: '800', flex: 1 }]}>
          {order.status === 'Picking' ? 'Packed · hand it to the rider' : 'Packed · waiting for the rider'}
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  qty: { minWidth: 32, height: 28, borderRadius: radius.sm, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  sub: { marginLeft: 40 },
  callout: { flexDirection: 'row', gap: space.xs, backgroundColor: color.warningTint, borderRadius: radius.md, padding: space.sm, borderWidth: 1, borderColor: color.cashBorder },
  slot: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.infoTint, borderRadius: radius.md, padding: space.sm, borderWidth: 1, borderColor: color.info },
  rider: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.infoTint, borderRadius: radius.md, paddingLeft: space.sm, paddingRight: 4, minHeight: 52 },
  prep: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.surfaceAlt, borderRadius: radius.md, padding: space.xs, minHeight: 40 },
  actions: { flexDirection: 'row', gap: space.sm },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.openTint, borderRadius: radius.md, padding: space.sm, minHeight: 52 },
});
