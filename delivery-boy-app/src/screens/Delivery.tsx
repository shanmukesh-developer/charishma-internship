// One active delivery as a single step flow: Pickup → Picked → Drop → PIN → Delivered.
// One obvious primary action at the bottom; Navigate + Call always one tap away.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, R, S, T, useInsets } from '../theme';
import { Badge, Btn, Card, IconBtn, Label, Row } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { SosButton } from '../ui/Sos';
import { PinPad } from '../ui/PinPad';
import { useRider } from '../state/RiderStore';
import { atStoreKitchenLabel, canUnassign, firstName, isDialable, kitchenChip, stepFor, stepIndex } from '../services/orderModel';
import * as links from '../services/links';
import { rupees } from '../services/format';
import { CashBox, Instructions, ItemChecklist, ItemsLine, PaymentPill, Place, StepBar, cashToCollect, distanceTo } from './parts';
import type { RiderOrder } from '../types';

// Item ticks survive leaving and re-opening the screen (memory only).
const tickStore = new Map<string, Set<number>>();

export function DeliveryScreen({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const r = useRider();
  const insets = useInsets();
  const live = r.active.data.find((o) => o.id === orderId) ?? null;
  const snapshot = useRef<RiderOrder | null>(live);
  if (live) snapshot.current = live;

  const [pin, setPin] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [done, setDone] = useState<{ earning: number | null; cash: number | null; order: RiderOrder } | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(() => tickStore.get(orderId) ?? new Set());
  const [confirmUnticked, setConfirmUnticked] = useState(false);
  const [menu, setMenu] = useState(false);
  const [unassignOpen, setUnassignOpen] = useState(false);

  // Order vanished (cancelled / released / support finished it) and we did not just deliver it: leave.
  useEffect(() => {
    if (!live && !done && r.active.loaded) onClose();
  }, [live, done, r.active.loaded, onClose]);

  const order = live ?? done?.order ?? snapshot.current;
  if (!order) return null;

  const step = stepFor(order.status);
  const idx = Math.max(0, stepIndex(order.status));
  const syncing = r.syncPendingIds.has(order.id);
  const isLocked = locked || order.pinLocked;
  const custName = firstName(order.customerName);
  const others = r.active.data.filter((o) => o.id !== order.id);
  const callStore = isDialable(order.restaurantPhone) ? () => links.call(order.restaurantPhone) : null;
  const callCustomer = order.customerPhone ? () => links.call(order.customerPhone) : null;
  const helpPrefill = `Order ${order.orderCode}: `;

  const navigate = (to: 'store' | 'drop') => {
    const dest =
      to === 'store'
        ? { coords: order.pickupCoords, address: order.restaurantAddress ?? order.restaurantName }
        : { coords: order.dropCoords, address: order.dropAddress ?? order.dropArea };
    links.openNavigation(dest).then((ok) => {
      if (!ok) r.showToast('No address to navigate to. Please call for directions.', 'error');
    });
  };

  const toggleTick = (i: number) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      tickStore.set(order.id, next);
      return next;
    });
  };

  const runDeliver = async () => {
    if (delivering) return;
    setDelivering(true);
    setPinMsg(null);
    try {
      const res = await r.deliver(order, pin);
      if (res.ok) {
        tickStore.delete(order.id);
        setDone({ earning: res.earning, cash: res.cash, order });
        return;
      }
      if (res.kind === 'invalid') {
        setShakeKey((k) => k + 1);
        setPin('');
        setPinMsg(res.attemptsLeft !== null ? `Wrong PIN. ${res.attemptsLeft} ${res.attemptsLeft === 1 ? 'try' : 'tries'} left.` : res.message);
      } else if (res.kind === 'locked') {
        setLocked(true);
        setPinMsg(res.message);
      } else {
        setPinMsg(res.message);
      }
    } finally {
      setDelivering(false);
    }
  };

  // ── Step content + the one primary action ────────────────────────────────
  let title = '';
  let body: React.ReactNode = null;
  let primary: React.ReactNode = null;

  if (step === 'TO_STORE') {
    title = 'Go to store';
    // Buy-at-store: the store has no Zenvy app, so "Store accepted" / "Kitchen preparing" would be invented.
    // readyAt (kitchen packed it) shows "Ready for pickup" even before the status catches up.
    const kitchen = kitchenChip(order);
    const dist = distanceTo(order, r.fix);
    body = (
      <>
        <Card style={{ gap: S.md }}>
          <Place kind="store" title={order.restaurantName} address={order.restaurantAddress} />
          <View style={styles.chips}>
            {order.buyAtStore ? <Badge tone="amber" icon="cart-outline" label="BUY AT STORE" /> : null}
            {order.deliverySlot ? <Badge tone="blue" icon="clock-outline" label={`SLOT ${order.deliverySlot}`} /> : null}
            {kitchen ? <Badge tone={kitchen.ready ? 'green' : 'blue'} icon={kitchen.ready ? 'check-circle' : 'chef-hat'} label={kitchen.text} /> : null}
            {dist ? <Badge tone="grey" icon="map-marker-distance" label={`${dist} away`} /> : null}
          </View>
        </Card>
        <ActionPair
          left={{ icon: 'navigation-variant', label: 'Navigate', onPress: () => navigate('store'), dark: true }}
          right={callStore ? { icon: 'phone', label: 'Call store', onPress: callStore } : null}
        />
        <Card style={{ gap: S.sm }}>
          <Label>ITEMS TO COLLECT</Label>
          <ItemsLine order={order} />
          <PaymentPill order={order} />
        </Card>
      </>
    );
    primary = <Btn title="Reached store" icon="storefront-check-outline" onPress={() => r.advance(order)} />;
  } else if (step === 'AT_STORE') {
    title = order.buyAtStore ? 'Buy at store' : 'Pick up order';
    const allTicked = order.items.length === 0 || ticked.size >= order.items.length;
    // Buy-at-store: the shop has no Zenvy app, so "Kitchen preparing" / "Food packed" would be invented.
    const kitchen = order.buyAtStore ? null : atStoreKitchenLabel(order);
    body = (
      <>
        <View style={{ gap: 2 }}>
          <Text style={[T.h2, { color: C.ink }]}>{order.restaurantName ?? 'Store'}</Text>
          <Text style={[T.body, { color: order.buyAtStore ? C.amber : C.ink2 }]}>
            {order.buyAtStore
              ? 'This store has no ZenWe app. Order and pay for these items at the counter, keep the bill, then tick each item.'
              : 'Tick every item before you leave.'}
          </Text>
        </View>
        {kitchen ? (
          <View style={styles.chips}>
            <Badge
              tone={order.kitchenReady ? 'green' : 'blue'}
              icon={order.kitchenReady ? 'check-circle' : 'chef-hat'}
              label={kitchen}
            />
          </View>
        ) : null}
        <ItemChecklist order={order} ticked={ticked} onToggle={toggleTick} showPrices={order.buyAtStore} />
        <Instructions items={order.instructions} />
        {callStore ? <Btn title="Call store" icon="phone" variant="outline" size="mid" onPress={callStore} /> : null}
      </>
    );
    primary = (
      <Btn
        title={allTicked ? 'Picked up order' : `Picked up (${ticked.size}/${order.items.length} ticked)`}
        icon="package-variant-closed-check"
        onPress={() => (allTicked ? r.advance(order) : setConfirmUnticked(true))}
      />
    );
  } else if (step === 'TO_DROP') {
    title = 'Go to customer';
    body = (
      <>
        <CashBox order={order} />
        <Card style={{ gap: S.md }}>
          <Place kind="drop" title={custName} address={order.dropAddress} />
          {order.deliverySlot ? <Badge tone="blue" icon="clock-outline" label={`SLOT ${order.deliverySlot}`} /> : null}
        </Card>
        <Instructions items={order.instructions} />
        <ActionPair
          left={{ icon: 'navigation-variant', label: 'Navigate', onPress: () => navigate('drop'), dark: true }}
          right={callCustomer ? { icon: 'phone', label: 'Call customer', onPress: callCustomer } : null}
        />
      </>
    );
    primary = <Btn title="Reached customer" icon="map-marker-check-outline" onPress={() => r.advance(order)} />;
  } else if (step === 'AT_DROP') {
    title = 'Hand over';
    const pinNeeded = order.hasDeliveryPin;
    body = (
      <>
        <CashBox order={order} />
        {isLocked ? (
          <Card style={{ gap: S.md, borderWidth: 2, borderColor: C.red }}>
            <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
              <MaterialCommunityIcons name="lock-alert" size={30} color={C.red} />
              <Text style={[T.h3, { color: C.red, flex: 1 }]}>PIN locked</Text>
            </View>
            <Text style={[T.body, { color: C.ink2 }]}>{pinMsg || 'Too many wrong PINs. ZenWe support can complete this delivery for you.'}</Text>
            <Btn
              title="Get help from support"
              icon="lifebuoy"
              variant="red"
              size="mid"
              onPress={() => r.setOverlay({ kind: 'support', prefill: `${helpPrefill}delivery PIN locked at handover.` })}
            />
          </Card>
        ) : pinNeeded ? (
          <>
            <Text style={[T.h3, { color: C.ink, textAlign: 'center' }]}>Ask {custName ?? 'the customer'} for the 4-digit PIN</Text>
            <PinPad
              value={pin}
              onChange={(v) => {
                setPin(v);
                setPinMsg(null);
              }}
              shakeKey={shakeKey}
              disabled={delivering}
            />
            {pinMsg ? (
              <Text style={[T.body, { color: C.red, textAlign: 'center', fontWeight: '800' }]} accessibilityRole="alert">
                {pinMsg}
              </Text>
            ) : null}
          </>
        ) : (
          <Card>
            <Text style={[T.body, { color: C.ink }]}>No PIN needed. Hand the order to {custName ?? 'the customer'}.</Text>
          </Card>
        )}
        <ActionPair
          left={callCustomer ? { icon: 'phone', label: 'Call', onPress: callCustomer } : null}
          right={
            order.customerPhone
              ? {
                  icon: 'whatsapp',
                  label: 'WhatsApp',
                  onPress: () =>
                    links.whatsapp(
                      order.customerPhone,
                      `Hi${custName ? ' ' + custName : ''}, your ZenWe rider is here with your order. Please share the 4-digit delivery PIN from your ZenWe app.`,
                    ),
                }
              : null
          }
        />
      </>
    );
    if (!isLocked) {
      const cash = cashToCollect(order);
      primary = (
        <Btn
          title={!r.connected ? 'No internet: cannot check PIN' : cash > 0 ? `Cash ${rupees(cash)} taken · Deliver` : 'Deliver'}
          icon={r.connected ? 'check-bold' : 'wifi-off'}
          variant="green"
          loading={delivering}
          disabled={!r.connected || (pinNeeded && pin.length !== 4)}
          onPress={runDeliver}
        />
      );
    }
  } else if (step === 'UNKNOWN') {
    // A status this app version does not know: never guess a step; send the rider to support.
    title = 'Contact support';
    body = (
      <Card style={{ gap: S.md }}>
        <Text style={[T.body, { color: C.ink }]}>
          This order has a status this app does not recognise{order.rawStatus ? ` ("${order.rawStatus}")` : ''}. Please contact ZenWe support before you do anything with it.
        </Text>
        <Btn
          title="Get help from support"
          icon="lifebuoy"
          size="mid"
          onPress={() => r.setOverlay({ kind: 'support', prefill: `${helpPrefill}order shows status ${order.rawStatus ?? 'unknown'}.` })}
        />
      </Card>
    );
  } else {
    title = 'Delivered';
  }

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <IconBtn icon="arrow-left" onPress={onClose} label="Back" />
        <View style={{ flex: 1 }}>
          <Text style={[T.label, { color: C.muted }]}>ORDER {order.orderCode}</Text>
          <Text style={[T.h2, { color: C.ink }]}>{title}</Text>
        </View>
        <SosButton />
        <IconBtn icon="dots-vertical" onPress={() => setMenu(true)} label="More options" />
      </View>
      <View style={{ paddingHorizontal: S.lg, gap: S.sm }}>
        <StepBar index={idx} />
        {syncing ? (
          <View style={styles.sync}>
            <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={C.amber} />
            <Text style={[T.small, { color: C.amber, fontWeight: '800' }]}>Saved on phone. Will sync when online.</Text>
          </View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {body}
        {order.earning !== null ? (
          <Text style={[T.small, { color: C.muted, textAlign: 'center' }]}>You earn {rupees(order.earning)} for this order.</Text>
        ) : null}
      </ScrollView>
      {primary ? <View style={[styles.footer, { paddingBottom: insets.bottom + S.md }]}>{primary}</View> : null}

      <Sheet visible={confirmUnticked} onClose={() => setConfirmUnticked(false)} title="Some items not ticked">
        <Text style={[T.body, { color: C.ink2 }]}>Make sure nothing is missing from the bag.</Text>
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Btn title="Check again" variant="outline" size="mid" onPress={() => setConfirmUnticked(false)} style={{ flex: 1 }} />
          <Btn
            title="All good"
            size="mid"
            onPress={() => {
              setConfirmUnticked(false);
              return r.advance(order);
            }}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>

      <Sheet visible={menu} onClose={() => setMenu(false)} title={`Order ${order.orderCode}`}>
        {canUnassign(order.status) ? (
          <Row
            icon="close-circle-outline"
            label="Can't do this order"
            value="Give it back to other riders"
            tint={C.red}
            onPress={() => {
              setMenu(false);
              setUnassignOpen(true);
            }}
          />
        ) : null}
        <Row
          icon="lifebuoy"
          label="Get help"
          value="Message ZenWe support"
          onPress={() => {
            setMenu(false);
            r.setOverlay({ kind: 'support', prefill: helpPrefill });
          }}
        />
        <Row
          icon="share-variant-outline"
          label="Share order ID"
          value={`${order.orderCode}`}
          onPress={() => {
            setMenu(false);
            Share.share({ message: `ZenWe order ${order.orderCode} (${order.id})` }).catch(() => {});
          }}
        />
      </Sheet>

      <Sheet visible={unassignOpen} onClose={() => setUnassignOpen(false)} title="Give this order back?">
        <Text style={[T.body, { color: C.ink2 }]}>Another rider will take it. Only do this if you really cannot pick it up.</Text>
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Btn title="Keep order" variant="outline" size="mid" onPress={() => setUnassignOpen(false)} style={{ flex: 1 }} />
          <Btn
            title="Give back"
            variant="red"
            size="mid"
            onPress={async () => {
              const ok = await r.unassign(order);
              setUnassignOpen(false);
              if (ok) onClose();
            }}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>

      <Sheet visible={!!done} onClose={onClose} blocking>
        {done ? (
          <View style={{ alignItems: 'center', gap: S.md }}>
            <View style={styles.doneIcon}>
              <MaterialCommunityIcons name="check-bold" size={48} color={C.white} />
            </View>
            <Text style={[T.h1, { color: C.ink }]}>Delivered!</Text>
            {done.earning !== null ? (
              <>
                <Text style={[T.money, { color: C.greenDark }]}>+{rupees(done.earning)}</Text>
                <Text style={[T.body, { color: C.ink2 }]}>added to your earnings</Text>
              </>
            ) : null}
            {done.cash ? (
              <View style={styles.cashDone}>
                <MaterialCommunityIcons name="cash" size={24} color={C.cash} />
                <Text style={[T.h3, { color: C.cash }]}>Cash with you: {rupees(done.cash)}</Text>
              </View>
            ) : null}
            <View style={{ alignSelf: 'stretch', gap: S.md, marginTop: S.sm }}>
              {others.length ? (
                <Btn
                  title="Next delivery"
                  icon="arrow-right"
                  onPress={() => {
                    const next = others[0];
                    setDone(null);
                    r.openDelivery(next.id);
                  }}
                />
              ) : null}
              <Btn title="Back to home" icon="home-outline" variant={others.length ? 'outline' : 'dark'} size={others.length ? 'mid' : 'big'} onPress={onClose} />
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

type Action = { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => unknown; dark?: boolean };

/** Two big side-by-side buttons (Navigate / Call). */
function ActionPair({ left, right }: { left: Action | null; right: Action | null }) {
  const list = [left, right].filter(Boolean) as Action[];
  if (!list.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: S.md }}>
      {list.map((a) => (
        <Btn key={a.label} title={a.label} icon={a.icon} variant={a.dark ? 'dark' : 'outline'} size="mid" onPress={a.onPress} style={{ flex: 1 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.lg, paddingBottom: S.md },
  body: { padding: S.lg, gap: S.lg, paddingBottom: S.xxl },
  chips: { flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.amberTint, padding: S.sm, borderRadius: R.md },
  footer: { padding: S.lg, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line },
  doneIcon: { width: 92, height: 92, borderRadius: 46, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', marginTop: S.sm },
  cashDone: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.cashTint, borderRadius: R.md, padding: S.md },
});
