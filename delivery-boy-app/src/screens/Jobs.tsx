// Service pickups (laundry / tailoring / repairs collected from the student's room and brought back) and, only to
// finish one the rider already holds, shopping lists (removed 28 Oct 2026: never in the pool, never claimable).
// JobsOnHome: the rider's own jobs + the open pickup pool on Home. JobScreen: one
// job, full screen, step by step. State and actions: state/JobsStore.
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, R, S, T, useInsets } from '../theme';
import { Badge, Banner, Btn, Card, IconBtn, ScreenHeader } from '../ui/kit';
import { PinPad } from '../ui/PinPad';
import { useRider } from '../state/RiderStore';
import { useJobs } from '../state/JobsStore';
import * as links from '../services/links';
import { minutesAgo, rupees } from '../services/format';
import { isDialable } from '../services/orderModel';
import * as jobs from '../services/jobsApi';
import type { BasketItem, RiderBasket, RiderService } from '../services/jobsApi';

// ── Labels ─────────────────────────────────────────────────────────────────────
const BASKET_STEP: Record<string, string> = {
  PartnerAssigned: 'Go to the shop',
  Shopping: 'Shopping',
  PriceApprovalPending: 'Waiting for bill approval',
  Approved: 'Bill approved: buy and deliver',
  Purchased: 'Bought: deliver now',
  Delivering: 'Deliver to customer',
};
const SERVICE_STEP: Record<string, string> = {
  REQUESTED: 'Collect from student',
  CONFIRMED: 'Collect from student',
  DIAGNOSED_QUOTED: 'Waiting for price approval',
  IN_PROGRESS: 'Take it to the shop',
  READY_FOR_DELIVERY: 'Bring it back to student',
};
const serviceName = (s: RiderService) => s.serviceName ?? s.title;
const qtyText = (s: RiderService) => (s.quantity ? ` · ${s.quantity}${s.unit ? ` ${s.unit}` : ''}` : '');
const itemsCount = (b: RiderBasket) => b.items.reduce((n, i) => n + (i.quantity || 1), 0);

// ── Home section ───────────────────────────────────────────────────────────────
export function JobsOnHome() {
  const r = useRider();
  const j = useJobs();
  const mine = j.myBaskets.length + j.myServices.length;
  const pool = j.servicePool.length;
  if (!mine && !(r.isOnline && pool)) return null;
  return (
    <View style={{ gap: S.md }}>
      {mine ? (
        <>
          <Text style={[T.h3, { color: C.ink }]}>{mine === 1 ? 'Your job' : `Your jobs (${mine})`}</Text>
          {j.myBaskets.map((b) => (
            <Card key={b.id} style={styles.mineCard}>
              <View style={styles.rowCenter}>
                <Badge tone="gold" icon="cart-outline" label="SHOPPING LIST" />
                <Text style={[T.label, { color: C.muted, marginLeft: 'auto' }]}>#{b.shortId}</Text>
              </View>
              <Text style={[T.h2, { color: C.ink }]}>{BASKET_STEP[b.status] ?? 'Contact support'}</Text>
              <Text style={[T.body, { color: C.ink2 }]} numberOfLines={2}>
                {itemsCount(b)} item{itemsCount(b) === 1 ? '' : 's'} · {b.deliveryAddress ?? b.area ?? 'Customer'}
              </Text>
              <Btn title="Continue" icon="arrow-right" onPress={() => j.setOpenJob({ kind: 'basket', id: b.id })} />
            </Card>
          ))}
          {j.myServices.map((s) => (
            <Card key={s.id} style={styles.mineCard}>
              <View style={styles.rowCenter}>
                <Badge tone="blue" icon="hanger" label="PICKUP" />
                <Text style={[T.label, { color: C.muted, marginLeft: 'auto' }]}>#{s.shortId}</Text>
              </View>
              <Text style={[T.h2, { color: C.ink }]}>{SERVICE_STEP[s.status] ?? 'Contact support'}</Text>
              <Text style={[T.body, { color: C.ink2 }]} numberOfLines={2}>
                {serviceName(s)}{qtyText(s)} · {s.deliveryAddress ?? s.area ?? 'Student'}
              </Text>
              <Btn title="Continue" icon="arrow-right" onPress={() => j.setOpenJob({ kind: 'service', id: s.id })} />
            </Card>
          ))}
        </>
      ) : null}

      {r.isOnline && pool ? (
        <>
          <Text style={[T.h3, { color: C.ink }]}>Pickups ({pool})</Text>
          {j.servicePool.map((s) => (
            <PoolCard
              key={s.id}
              tone="blue"
              icon="hanger"
              label="PICKUP"
              title={`${serviceName(s)}${qtyText(s)}`}
              lines={[
                `Collect from: ${s.area ?? 'shown after you accept'}`,
                s.pickupSlot ? `When: ${s.pickupSlot}` : null,
                s.store?.name ? `Shop: ${s.store.name}${s.store.location ? `, ${s.store.location}` : ''}` : null,
              ]}
              ago={minutesAgo(s.createdAt)}
              connected={r.connected}
              onAccept={() => j.claim(s.id)}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function PoolCard({
  tone,
  icon,
  label,
  title,
  lines,
  ago,
  connected,
  onAccept,
}: {
  tone: 'blue';
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  title: string;
  lines: (string | null)[];
  ago: string | null;
  connected: boolean;
  onAccept: () => Promise<boolean>;
}) {
  return (
    <Card style={{ gap: S.sm }}>
      <View style={styles.rowCenter}>
        <Badge tone={tone} icon={icon} label={label} />
        {ago ? <Text style={[T.small, { color: C.muted, marginLeft: 'auto' }]}>{ago}</Text> : null}
      </View>
      <Text style={[T.h3, { color: C.ink }]} numberOfLines={2}>
        {title}
      </Text>
      {lines.filter(Boolean).map((l, i) => (
        <Text key={i} style={[T.small, { color: C.ink2 }]} numberOfLines={2}>
          {l}
        </Text>
      ))}
      <Btn title={connected ? 'Accept' : 'No internet'} variant="green" size="mid" icon={connected ? 'check-bold' : 'wifi-off'} disabled={!connected} onPress={onAccept} />
    </Card>
  );
}

// ── Full-screen job ────────────────────────────────────────────────────────────
export function JobScreen() {
  const j = useJobs();
  const job = j.openJob;
  if (!job) return null;
  if (job.kind === 'basket') {
    const b = j.myBaskets.find((x) => x.id === job.id);
    return b ? <BasketJob basket={b} onClose={() => j.setOpenJob(null)} /> : null;
  }
  const s = j.myServices.find((x) => x.id === job.id);
  return s ? <ServiceJob booking={s} onClose={() => j.setOpenJob(null)} /> : null;
}

function Shell({ title, onClose, phone, children }: { title: string; onClose: () => void; phone: string | null; children: React.ReactNode }) {
  const insets = useInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: S.lg }}>
        <ScreenHeader
          title={title}
          onBack={onClose}
          right={isDialable(phone) ? <IconBtn icon="phone" label="Call the customer" onPress={() => links.call(phone)} color={C.greenDark} /> : null}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: insets.bottom + S.xxl }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PlaceCard({ label, title, address, phone, coords }: { label: string; title: string | null; address: string | null; phone?: string | null; coords?: { lat: number; lng: number } | null }) {
  return (
    <Card style={{ gap: S.sm }}>
      <Text style={[T.label, { color: C.muted }]}>{label}</Text>
      {title ? <Text style={[T.h3, { color: C.ink }]}>{title}</Text> : null}
      {address ? <Text style={[T.body, { color: C.ink2 }]}>{address}</Text> : null}
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        {address || coords ? (
          <Btn title="Navigate" icon="navigation-variant" variant="outline" size="mid" onPress={() => links.openNavigation({ coords: coords ?? null, address })} style={{ flex: 1 }} />
        ) : null}
        {isDialable(phone) ? <Btn title="Call" icon="phone" variant="outline" size="mid" onPress={() => links.call(phone)} style={{ flex: 1 }} /> : null}
      </View>
    </Card>
  );
}

// ── Shopping list ──────────────────────────────────────────────────────────────
function BasketJob({ basket: b, onClose }: { basket: RiderBasket; onClose: () => void }) {
  const j = useJobs();
  const r = useRider();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const shopping = ['PartnerAssigned', 'Shopping', 'PriceApprovalPending'].includes(b.status);
  const allMarked = b.items.every((i) => i.status === 'Purchased' || i.status === 'Unavailable');
  const billTotal = useMemo(
    () => b.items.reduce((sum, i) => (i.status === 'Unavailable' ? sum : sum + (i.priceActual ?? i.priceEstimated ?? 0) * (i.quantity || 1)), 0),
    [b.items],
  );

  const markItem = async (item: BasketItem, status: 'Purchased' | 'Unavailable') => {
    let priceActual: number | null | undefined;
    if (status === 'Purchased') {
      const raw = (prices[item.id] ?? '').replace(/[^\d.]/g, '');
      const n = raw ? Number(raw) : item.priceActual ?? item.priceEstimated;
      if (n === null || n === undefined || !Number.isFinite(n) || n < 0) {
        r.showToast(`Enter the price you paid for ${item.name}.`, 'error');
        return false;
      }
      priceActual = Math.round(n * 100) / 100;
    }
    return j.step(async () => {
      if (b.status === 'PartnerAssigned') await jobs.startShopping(b.id);
      await jobs.setBasketItem(b.id, item.id, { status, ...(priceActual !== undefined ? { priceActual } : {}) });
    });
  };

  const deliver = async () => {
    setPinMsg(null);
    const ok = await j.step(() => jobs.completeBasket(b.id, pin), 'Delivered. Thank you!');
    if (!ok) {
      setPin('');
      setShake((n) => n + 1);
      setPinMsg('Ask the customer for the 4-digit PIN in their ZENV app.');
    }
  };

  return (
    <Shell title={`List #${b.shortId}`} onClose={onClose} phone={b.customerPhone}>
      <Text style={[T.h2, { color: C.ink }]}>{BASKET_STEP[b.status] ?? 'Contact support'}</Text>
      {b.deliverySlot ? <Badge tone="blue" icon="clock-outline" label={`SLOT ${b.deliverySlot}`} /> : null}

      {shopping ? (
        <Banner tone="blue" icon="cart-outline" text="Buy at any campus shop. Mark each item as bought (with the price you paid) or not available, then send the bill. The customer approves it in their app before you deliver." />
      ) : null}
      {b.status === 'PriceApprovalPending' ? (
        <Banner tone="amber" icon="timer-sand" text={`Bill sent: ${rupees(b.actualTotal)}. Waiting for the customer to approve it. Changing an item sends a new bill.`} />
      ) : null}

      <Card style={{ gap: S.md }}>
        <Text style={[T.label, { color: C.muted }]}>ITEMS ({itemsCount(b)})</Text>
        {b.items.map((i) => {
          const done = i.status === 'Purchased' || i.status === 'Unavailable';
          return (
            <View key={i.id} style={[styles.item, done && { opacity: 0.85 }]}>
              <View style={styles.rowCenter}>
                <MaterialCommunityIcons
                  name={i.status === 'Purchased' ? 'check-circle' : i.status === 'Unavailable' ? 'close-circle' : 'checkbox-blank-circle-outline'}
                  size={24}
                  color={i.status === 'Purchased' ? C.green : i.status === 'Unavailable' ? C.red : C.muted}
                />
                <Text style={[T.body, { color: C.ink, fontWeight: '800', flex: 1 }]}>
                  {i.quantity} × {i.name}
                  {i.unit ? ` (${i.unit})` : ''}
                </Text>
                <Text style={[T.small, { color: C.muted }]}>
                  {i.status === 'Purchased' ? rupees(i.priceActual) : i.status === 'Unavailable' ? 'Not available' : `est. ${rupees(i.priceEstimated)}`}
                </Text>
              </View>
              {shopping ? (
                <View style={styles.rowCenter}>
                  <TextInput
                    value={prices[i.id] ?? ''}
                    onChangeText={(t) => setPrices((p) => ({ ...p, [i.id]: t }))}
                    placeholder={`Price for 1 (${rupees(i.priceActual ?? i.priceEstimated)})`}
                    placeholderTextColor={C.muted}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    accessibilityLabel={`Price you paid for one ${i.name}`}
                  />
                  <Btn title="Bought" size="small" variant="green" onPress={() => markItem(i, 'Purchased')} />
                  <Btn title="N/A" size="small" variant="outline" onPress={() => markItem(i, 'Unavailable')} accessibilityLabel={`${i.name} not available`} />
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      {shopping ? (
        <Btn
          title={allMarked ? `Send bill ${rupees(billTotal)}` : 'Mark every item first'}
          icon="send"
          disabled={!allMarked}
          onPress={() => j.step(async () => {
            if (b.status === 'PartnerAssigned') await jobs.startShopping(b.id);
            await jobs.submitBill(b.id);
          }, 'Bill sent to the customer')}
        />
      ) : null}

      <PlaceCard label="DELIVER TO" title={b.customerName} address={b.deliveryAddress ?? b.area} phone={b.customerPhone} />

      <Card style={{ gap: S.xs, backgroundColor: C.cashTint }}>
        <Text style={[T.label, { color: C.cash }]}>COLLECT CASH</Text>
        <Text style={[T.h1, { color: C.cash }]}>{rupees(jobs.basketCashToCollect(b))}</Text>
        <Text style={[T.small, { color: C.cash }]}>
          {b.actualTotal !== null ? 'Approved bill' : 'Estimate'} + shopping fee {rupees(b.shoppingFee)} + delivery fee {rupees(b.deliveryFee)}
        </Text>
      </Card>

      {b.status === 'Approved' || b.status === 'Purchased' ? (
        <Btn title="Start delivery" icon="moped" variant="green" onPress={() => j.step(() => jobs.startBasketDelivery(b.id), 'On the way')} />
      ) : null}
      {b.status === 'Delivering' ? (
        <Card style={{ gap: S.md }}>
          <Text style={[T.h3, { color: C.ink }]}>Customer's delivery PIN</Text>
          <PinPad value={pin} onChange={(v) => { setPin(v); setPinMsg(null); }} shakeKey={shake} />
          {pinMsg ? <Text style={[T.body, { color: C.red, textAlign: 'center', fontWeight: '800' }]} accessibilityRole="alert">{pinMsg}</Text> : null}
          <Btn title="Delivered, cash collected" icon="check-bold" variant="green" disabled={pin.length !== 4} onPress={deliver} />
        </Card>
      ) : null}
    </Shell>
  );
}

// ── Service pickup ─────────────────────────────────────────────────────────────
function ServiceJob({ booking: s, onClose }: { booking: RiderService; onClose: () => void }) {
  const j = useJobs();
  const beforePickup = ['REQUESTED', 'CONFIRMED', 'DIAGNOSED_QUOTED'].includes(s.status);
  const amount = s.finalAmount || s.quotedAmount;
  const room = [s.deliveryAddress ?? [s.area, s.roomNumber ? `Room ${s.roomNumber}` : null].filter(Boolean).join(', ')].filter(Boolean)[0] || null;
  return (
    <Shell title={`Pickup #${s.shortId}`} onClose={onClose} phone={s.contactPhone}>
      <Text style={[T.h2, { color: C.ink }]}>{SERVICE_STEP[s.status] ?? 'Contact support'}</Text>
      <Card style={{ gap: S.xs }}>
        <Text style={[T.label, { color: C.muted }]}>SERVICE</Text>
        <Text style={[T.h3, { color: C.ink }]}>{serviceName(s)}{qtyText(s)}</Text>
        {s.pickupSlot ? <Text style={[T.body, { color: C.ink2 }]}>When: {s.pickupSlot}</Text> : null}
        {s.description ? <Text style={[T.body, { color: C.ink2 }]}>{s.description}</Text> : null}
        {s.details.map((d, i) => (
          <Text key={i} style={[T.small, { color: C.ink2 }]}>
            {d.label}: {d.value}
          </Text>
        ))}
      </Card>

      {s.status === 'DIAGNOSED_QUOTED' ? (
        <Banner tone="amber" icon="timer-sand" text={`New price ${rupees(s.quotedAmount)} is waiting for the student's approval. Collect only after they approve.`} />
      ) : null}

      <PlaceCard
        label={s.status === 'IN_PROGRESS' ? 'COLLECTED FROM' : 'STUDENT'}
        title={null}
        address={room}
        phone={s.contactPhone}
      />
      {s.store ? (
        <PlaceCard label={s.status === 'READY_FOR_DELIVERY' ? 'COLLECT BACK FROM' : 'TAKE IT TO'} title={s.store.name} address={s.store.location} phone={s.store.phone} coords={s.store.coords} />
      ) : null}

      {amount > 0 ? (
        <Card style={{ gap: S.xs, backgroundColor: C.cashTint }}>
          <Text style={[T.label, { color: C.cash }]}>{s.status === 'READY_FOR_DELIVERY' ? 'COLLECT CASH' : 'PRICE'}</Text>
          <Text style={[T.h1, { color: C.cash }]}>{rupees(amount)}</Text>
          <Text style={[T.small, { color: C.cash }]}>Cash when the job is done. The shop confirms the final price.</Text>
        </Card>
      ) : null}

      {s.status === 'REQUESTED' || s.status === 'CONFIRMED' ? (
        <Btn title="Collected from student" icon="check-bold" variant="green" onPress={() => j.step(() => jobs.setServiceStatus(s.id, 'IN_PROGRESS', 'Collected by the ZENV rider'), 'Marked as collected')} />
      ) : null}
      {s.status === 'IN_PROGRESS' ? (
        <Btn title="Ready: bringing it back" icon="moped" variant="green" onPress={() => j.step(() => jobs.setServiceStatus(s.id, 'READY_FOR_DELIVERY', 'Rider is bringing it back'), 'Student told')} />
      ) : null}
      {s.status === 'READY_FOR_DELIVERY' ? (
        <Btn
          title={amount > 0 ? `Handed over, ${rupees(amount)} collected` : 'Handed over to student'}
          icon="check-all"
          variant="green"
          onPress={() => j.step(() => jobs.setServiceStatus(s.id, 'COMPLETED', 'Returned to the student'), 'Done. Thank you!')}
        />
      ) : null}
      {beforePickup ? (
        <Btn title="I can't do this pickup" variant="outline" size="mid" onPress={() => j.step(() => jobs.releaseService(s.id), 'Handed back to other riders')} />
      ) : null}
    </Shell>
  );
}

const styles = StyleSheet.create({
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  mineCard: { gap: S.md, borderWidth: 2, borderColor: C.ink },
  item: { gap: S.sm, paddingVertical: S.xs, borderBottomWidth: 1, borderBottomColor: C.line },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    color: C.ink,
    backgroundColor: C.card,
    fontSize: 16,
  },
});
