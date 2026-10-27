// Pieces shared by the order card, order detail and the new-order alert.
import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CANCEL_REASONS, NEW_ORDER_LATE_MIN, NEW_ORDER_WARN_MIN, REJECT_REASONS } from '../config';
import { agoText, clockIST, istDayKey, isTodayIST, minutesSince, rupees, telDigits, waDigits } from '../lib/model';
import { useNow, useStore } from '../state/StoreProvider';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Chip, Sheet } from '../ui/kit';
import type { Order } from '../types';

export const callNumber = (phone: string | null | undefined) => {
  if (!phone) return;
  Linking.openURL(`tel:${telDigits(phone)}`).catch(() => {});
};

export const whatsappNumber = (phone: string | null | undefined, text?: string) => {
  if (!phone) return;
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  Linking.openURL(`https://wa.me/${waDigits(phone)}${q}`).catch(() => {});
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Finished order time: "9:05 PM" today, "Thu 15 · 9:05 PM" on an earlier day (the Done tab mixes days). */
function doneWhen(d: string | null): string {
  if (!d || isTodayIST(d)) return clockIST(d);
  const [y, m, day] = istDayKey(d).split('-').map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]} ${day} · ${clockIST(d)}`;
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
      {order.stage === 'done' ? doneWhen(order.createdAt) : agoText(order.createdAt, now)}
      {isNew && mins >= NEW_ORDER_LATE_MIN ? ' · accept now' : ''}
    </Text>
  );
}

/** Customer name + big CALL and WhatsApp buttons (the vendor talks to the customer directly). */
export function CustomerBlock({ order, compact }: { order: Order; compact?: boolean }) {
  const phone = order.customerPhone;
  const active = order.stage !== 'done';
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.row}>
        <Ionicons name="person-circle" size={28} color={color.text} />
        <View style={{ flex: 1 }}>
          <Text style={[font.h3, { color: color.text }]} numberOfLines={1}>{order.customerName || 'Customer'}</Text>
          {phone ? <Text style={[font.small, { color: color.textSecondary }]} selectable>{phone}</Text> : null}
        </View>
      </View>
      {phone && active ? (
        <View style={styles.row}>
          <Button
            label="CALL CUSTOMER"
            icon="call"
            variant="accept"
            size={compact ? 'secondary' : 'primary'}
            onPress={() => callNumber(phone)}
            style={{ flex: 2 }}
            a11y={`Call ${order.customerName || 'customer'}`}
          />
          <Button
            label="WhatsApp"
            icon="logo-whatsapp"
            variant="secondary"
            size={compact ? 'secondary' : 'primary'}
            onPress={() => whatsappNumber(phone, `Hi${order.customerName ? ` ${order.customerName}` : ''}, about your ZCS order #${order.shortId}`)}
            style={{ flex: 1 }}
            a11y={`WhatsApp ${order.customerName || 'customer'}`}
          />
        </View>
      ) : null}
      {!phone && active ? (
        <Text style={[font.small, { color: color.textMuted }]}>Customer phone not shared yet. Pull down to refresh.</Text>
      ) : null}
    </View>
  );
}

/** Where to deliver: hostel block / room chips + the full address. */
export function AddressBlock({ order }: { order: Order }) {
  if (!order.deliveryAddress && !order.hostelBlock && !order.roomNumber) return null;
  return (
    <View style={styles.addr} accessibilityLabel={`Deliver to ${order.deliveryAddress}`}>
      <Ionicons name="location" size={22} color={color.info} />
      <View style={{ flex: 1, gap: 4 }}>
        {order.hostelBlock || order.roomNumber ? (
          <View style={[styles.row, { flexWrap: 'wrap', gap: space.xs }]}>
            {order.hostelBlock ? <Badge text={`BLOCK ${order.hostelBlock}`} fg={color.textInverse} bg={color.info} /> : null}
            {order.roomNumber ? <Badge text={`ROOM ${order.roomNumber}`} fg={color.info} bg={color.surface} border={color.info} /> : null}
          </View>
        ) : null}
        {order.deliveryAddress ? (
          <Text style={[font.body, { color: color.text, fontWeight: '700' }]} selectable>{order.deliveryAddress}</Text>
        ) : null}
      </View>
    </View>
  );
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
            <View style={styles.qty}><Text style={[font.item, { color: color.textInverse }]}>{it.quantity}×</Text></View>
            <Text style={[font.item, { color: color.text, flex: 1 }]}>{it.name}</Text>
            {showPrices ? (
              <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{it.lineTotal !== null ? rupees(it.lineTotal) : '—'}</Text>
            ) : null}
          </View>
          {it.customizations ? <Text style={[font.body, styles.sub, { color: color.warning, fontWeight: '700' }]}>{it.customizations}</Text> : null}
        </View>
      ))}
      {more > 0 ? <Text style={[font.small, styles.sub, { color: color.textMuted }]}>+ {more} more item{more > 1 ? 's' : ''}</Text> : null}
    </View>
  );
}

/** The delivery slot the customer booked: deliver the order in this window. */
export function SlotLine({ order }: { order: Order }) {
  if (!order.slotLabel) return null;
  return (
    <View style={styles.slot} accessibilityLabel={`Deliver in the slot ${order.slotLabel}`}>
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

/** The money line: "Collect ₹X cash" for COD, "Paid" otherwise. */
export function CollectLine({ order }: { order: Order }) {
  // A cancelled order has nothing to collect (the detail screen used to say "Collect ₹X cash" here).
  if (order.status === 'Cancelled') return null;
  if (order.isCOD) {
    const done = order.status === 'Delivered';
    return (
      <View style={[styles.collect, done && { backgroundColor: color.openTint, borderColor: color.open }]}>
        <Ionicons name={done ? 'checkmark-circle' : 'cash'} size={26} color={done ? color.openDark : color.cash} />
        <Text style={[font.h2, { color: done ? color.openDark : color.cash, flex: 1 }]}>
          {done ? `Collected ${rupees(order.collectAmount)} cash` : `Collect ${rupees(order.collectAmount)} cash`}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.collect, { backgroundColor: color.prepaidTint, borderColor: color.open }]}>
      <Ionicons name="checkmark-circle" size={26} color={color.prepaid} />
      <Text style={[font.h3, { color: color.prepaid, flex: 1 }]}>Paid online · {rupees(order.finalPrice)} · collect nothing</Text>
    </View>
  );
}

export function DoneLine({ order }: { order: Order }) {
  if (order.stage !== 'done') return null;
  if (order.status === 'Delivered') {
    return <Badge text={`DELIVERED ${clockIST(order.deliveredAt || order.updatedAt)}`} icon="checkmark-done" fg={color.openDark} bg={color.openTint} />;
  }
  return (
    <View style={[styles.strip, { backgroundColor: color.alertTint }]}>
      <Ionicons name="close-circle" size={18} color={color.alert} />
      <Text style={[font.small, { color: color.alertDark, fontWeight: '700', flex: 1 }]}>
        Cancelled{order.cancellationReason ? ` — ${order.cancellationReason}` : ''}
      </Text>
    </View>
  );
}

/** One obvious action per stage: New → Accept (+ Reject), Accepted → Out for delivery, On the way → Delivered. */
export function OrderActions({ order, onReject, onCancel }: {
  order: Order; onReject: () => void; onCancel: () => void;
}) {
  const { busy, accept, outForDelivery, delivered } = useStore();
  const b = busy[order.id];
  if (order.stage === 'new') {
    return (
      <View style={styles.actions}>
        <Button label="Reject" variant="rejectOutline" onPress={onReject} disabled={!!b} loading={b === 'reject'} style={{ flex: 1 }} />
        <Button label="ACCEPT" variant="accept" icon="checkmark-circle" onPress={() => accept(order)} disabled={!!b} loading={b === 'accept'} style={{ flex: 2 }} />
      </View>
    );
  }
  if (order.stage === 'accepted') {
    return (
      <View style={{ gap: space.xs }}>
        <Button label="OUT FOR DELIVERY" variant="primary" icon="bicycle" onPress={() => outForDelivery(order)} disabled={!!b} loading={b === 'out'} />
        <Button label="Cancel order" variant="ghost" size="secondary" onPress={onCancel} disabled={!!b} loading={b === 'cancel'} />
      </View>
    );
  }
  if (order.stage === 'outForDelivery') {
    return (
      <View style={{ gap: space.xs }}>
        <Button
          label={order.isCOD ? `DELIVERED · GOT ${rupees(order.collectAmount)}` : 'DELIVERED'}
          variant="accept"
          icon="checkmark-done-circle"
          onPress={() => delivered(order)}
          disabled={!!b}
          loading={b === 'delivered'}
        />
        <Button label="Cancel order" variant="ghost" size="secondary" onPress={onCancel} disabled={!!b} loading={b === 'cancel'} />
      </View>
    );
  }
  return null;
}

/** Reason chips for Reject (new order) or Cancel (accepted order). Used inline in the alert and in sheets. */
export function ReasonPicker({ order, kind, onDone, onBack, onRed }: {
  order: Order; kind: 'reject' | 'cancel'; onDone: () => void; onBack?: () => void; onRed?: boolean;
}) {
  const { reject, cancel, busy, actionErrors } = useStore();
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const isOther = reason === 'Other';
  const finalReason = isOther ? other.trim() : reason;
  const b = busy[order.id];
  const reasons = kind === 'reject' ? REJECT_REASONS : CANCEL_REASONS;
  const run = kind === 'reject' ? reject : cancel;
  const err = !b ? actionErrors[order.id] : undefined;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[font.h2, { color: onRed ? color.textInverse : color.text }]}>{kind === 'reject' ? 'Why reject?' : 'Why cancel?'}</Text>
      <View style={[styles.grid, onRed && styles.panel]}>
        {[...reasons, 'Other'].map((r) => (
          <Chip key={r} label={r} tone="red" selected={reason === r} onPress={() => setReason(r)} style={styles.cell2} />
        ))}
      </View>
      {isOther ? (
        <TextInput
          value={other}
          onChangeText={(t) => setOther(t.slice(0, 250))}
          placeholder="Reason for the customer"
          placeholderTextColor={color.textMuted}
          style={styles.input}
          multiline
          maxLength={250}
          autoFocus
          accessibilityLabel="Other reason"
        />
      ) : null}
      {err ? (
        <View style={[styles.err, onRed && { backgroundColor: color.surface }]} accessibilityLiveRegion="assertive">
          <Text style={[font.body, { color: color.alertDark, fontWeight: '800' }]}>{err}</Text>
          <Text style={[font.small, { color: color.textSecondary }]}>Tap the button again to retry.</Text>
        </View>
      ) : null}
      <Button
        label={kind === 'reject' ? 'REJECT ORDER' : 'CANCEL ORDER'}
        variant={onRed ? 'onRed' : 'reject'}
        icon="close-circle"
        disabled={!finalReason || !!b}
        loading={b === kind}
        onPress={async () => { if (finalReason && (await run(order, finalReason))) onDone(); }}
      />
      {onBack ? <Button label="Back" variant={onRed ? 'outlineOnRed' : 'secondary'} size="secondary" onPress={onBack} disabled={!!b} /> : null}
    </View>
  );
}

/** Reject / cancel sheets for any screen: `const { openReject, openCancel, sheets } = useOrderSheets()`. */
export function useOrderSheets() {
  const [target, setTarget] = useState<{ order: Order; kind: 'reject' | 'cancel' } | null>(null);
  const close = () => setTarget(null);
  const sheets = (
    <Sheet
      visible={!!target}
      onClose={close}
      title={target ? `${target.kind === 'reject' ? 'Reject' : 'Cancel'} #${target.order.shortId}` : ''}
    >
      {target ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }}>
          <ReasonPicker key={`${target.kind}:${target.order.id}`} order={target.order} kind={target.kind} onDone={close} />
        </ScrollView>
      ) : null}
    </Sheet>
  );
  return {
    openReject: (order: Order) => setTarget({ order, kind: 'reject' }),
    openCancel: (order: Order) => setTarget({ order, kind: 'cancel' }),
    sheets,
  };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  qty: { minWidth: 40, height: 28, borderRadius: radius.sm, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  sub: { marginLeft: 48 },
  callout: { flexDirection: 'row', gap: space.xs, backgroundColor: color.warningTint, borderRadius: radius.md, padding: space.sm, borderWidth: 1, borderColor: color.cashBorder },
  addr: { flexDirection: 'row', gap: space.xs, backgroundColor: color.infoTint, borderRadius: radius.md, padding: space.sm },
  slot: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.infoTint, borderRadius: radius.md, padding: space.sm, borderWidth: 1, borderColor: color.info },
  collect: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.cashTint, borderRadius: radius.md,
    borderWidth: 2, borderColor: color.cashBorder, paddingHorizontal: space.sm, minHeight: 56,
  },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.md, padding: space.xs, minHeight: 40 },
  actions: { flexDirection: 'row', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  cell2: { flexGrow: 1, flexBasis: '46%', minHeight: 64 },
  err: { backgroundColor: color.alertTint, borderRadius: radius.md, padding: space.sm, gap: 2 },
  panel: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.xs },
  input: {
    minHeight: 72, borderWidth: 2, borderColor: color.border, borderRadius: radius.md, padding: space.sm,
    ...font.body, color: color.text, textAlignVertical: 'top', backgroundColor: color.surface,
  },
});
