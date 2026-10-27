// Home: duty switch, today's money, active deliveries, incoming offers.
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, R, S, T, shadow } from '../theme';
import { Badge, Banner, Btn, Card, EmptyState, ErrorState, IconBtn, Skeleton } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { SosButton } from '../ui/Sos';
import { useRider } from '../state/RiderStore';
import { useVoice } from '../voice/useVoice';
import { firstName, kitchenChip, stepFor, stepIndex } from '../services/orderModel';
import { minutesAgo, rupees } from '../services/format';
import { OFFER_SECONDS } from '../config';
import { ItemsLine, PaymentPill, distanceTo } from './parts';
import { AlertHealthBanner, StayReachableCard } from './StayReachable';
import type { RiderOrder } from '../types';

// Offers whose countdown ran out (moved to "More orders"). Module-level so switching tabs does not restart the timer.
const expiredOffers = new Set<string>();

const STEP_TEXT = ['Go to store', 'At store: pick up', 'Go to customer', 'At customer: get PIN', 'Delivered'];

export function HomeScreen() {
  const r = useRider();
  const voice = useVoice();
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOffline, setConfirmOffline] = useState(false);
  const [expired, setExpired] = useState<Set<string>>(() => new Set(expiredOffers));

  const hero = r.offers.find((o) => !expired.has(o.id));
  const others = r.offers.filter((o) => o.id !== hero?.id);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([r.refreshOrders(), r.refreshToday(), r.refreshProfile()]);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleDuty = () => {
    if (r.isOnline && r.active.data.length > 0) {
      setConfirmOffline(true);
      return;
    }
    return r.setDuty(!r.isOnline);
  };

  const name = firstName(r.profile?.name) ?? 'Rider';
  const firstLoad = !r.active.loaded;

  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[T.small, { color: C.muted }]}>ZCS Rider</Text>
            <Text style={[T.h2, { color: C.ink }]} numberOfLines={1}>
              Hi, {name}
            </Text>
          </View>
          <IconBtn
            icon={voice.enabled ? 'volume-high' : 'volume-off'}
            label={voice.enabled ? 'Voice announcements on. Open voice settings' : 'Voice announcements off. Open voice settings'}
            onPress={() => r.setOverlay({ kind: 'voice' })}
            color={voice.enabled ? C.greenDark : C.muted}
          />
          <SosButton />
        </View>

        <DutySwitch online={r.isOnline} busy={r.dutyBusy} onPress={toggleDuty} />
        <TodayStrip />
        {r.today.data?.cash?.limitEnabled && r.today.data.cash.overLimit && r.today.data.cash.message ? (
          <Banner text={r.today.data.cash.message} tone="amber" icon="cash-lock" />
        ) : null}

        <AlertHealthBanner />
        {r.locationDenied ? <Banner tone="blue" icon="crosshairs-off" text="Location is off. Turn it on so customers can see you." /> : null}
        {!r.locationDenied && r.backgroundLocationOff ? (
          <Banner
            tone="blue"
            icon="map-marker-off"
            text={'Customers lose your live location when you open Google Maps. Set location to "Allow all the time".'}
            action={{ label: 'Allow', onPress: r.allowBackgroundLocation }}
          />
        ) : null}

        {r.active.data.length === 0 ? <StayReachableCard /> : null}

        {r.active.data.length > 0 ? (
          <View style={{ gap: S.md }}>
            <Text style={[T.h3, { color: C.ink }]}>
              {r.active.data.length === 1 ? 'Your delivery' : `Your deliveries (${r.active.data.length})`}
            </Text>
            {r.active.data.map((o) => (
              <ActiveCard key={o.id} order={o} syncing={r.syncPendingIds.has(o.id)} onOpen={() => r.openDelivery(o.id)} />
            ))}
          </View>
        ) : null}

        {r.active.error && !r.active.data.length ? <ErrorState message={r.active.error} onRetry={r.refreshOrders} /> : null}

        {firstLoad && r.connected ? (
          <Skeleton height={200} />
        ) : r.isOnline ? (
          hero ? (
            <OfferCard
              key={hero.id}
              order={hero}
              distance={distanceTo(hero, r.fix)}
              connected={r.connected}
              covered={!!r.deliveryId || !!r.overlay}
              onAccept={() => r.accept(hero)}
              onSkip={() => r.skipOffer(hero.id)}
              onExpire={() => {
                expiredOffers.add(hero.id);
                setExpired((s) => new Set(s).add(hero.id));
              }}
            />
          ) : r.pending.error && !r.pending.data.length ? (
            <ErrorState message={r.pending.error} onRetry={r.refreshOrders} />
          ) : others.length === 0 ? (
            <WaitingCard />
          ) : null
        ) : r.active.data.length === 0 ? (
          <EmptyState icon="power-sleep" title="You are offline" body="Go online to start getting delivery orders." />
        ) : null}

        {r.isOnline && others.length > 0 ? (
          <View style={{ gap: S.md }}>
            <Text style={[T.h3, { color: C.ink }]}>More orders ({others.length})</Text>
            {others.map((o) => (
              <SmallOffer key={o.id} order={o} distance={distanceTo(o, r.fix)} connected={r.connected} onAccept={() => r.accept(o)} onSkip={() => r.skipOffer(o.id)} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Sheet visible={confirmOffline} onClose={() => setConfirmOffline(false)} title="Go offline?">
        <Text style={[T.body, { color: C.ink2 }]}>
          You still have {r.active.data.length} deliver{r.active.data.length === 1 ? 'y' : 'ies'}. You will stop getting new orders but can finish{' '}
          {r.active.data.length === 1 ? 'it' : 'them'}.
        </Text>
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Btn title="Stay online" variant="outline" size="mid" onPress={() => setConfirmOffline(false)} style={{ flex: 1 }} />
          <Btn
            title="Go offline"
            size="mid"
            onPress={() => {
              setConfirmOffline(false);
              return r.setDuty(false);
            }}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>
    </>
  );
}

function DutySwitch({ online, busy, onPress }: { online: boolean; busy: boolean; onPress: () => unknown }) {
  return (
    <View style={[styles.duty, { backgroundColor: online ? C.green : C.ink }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
        <View style={[styles.dot, { backgroundColor: online ? '#B7F5D2' : '#9CA3AF' }]} />
        <View style={{ flex: 1 }}>
          <Text style={[T.h1, { color: C.white }]}>{online ? 'ONLINE' : 'OFFLINE'}</Text>
          <Text style={[T.body, { color: C.white, opacity: 0.9 }]}>{online ? 'You are getting orders' : 'You will not get orders'}</Text>
        </View>
      </View>
      <Btn
        title={online ? 'Go offline' : 'Go online'}
        icon={online ? 'power' : 'power'}
        variant="outline"
        textColor={online ? C.greenDark : C.ink}
        loading={busy}
        onPress={onPress}
        accessibilityLabel={online ? 'Go offline' : 'Go online and start getting orders'}
      />
    </View>
  );
}

function TodayStrip() {
  const r = useRider();
  const t = r.today.data;
  const tiles: { label: string; value: string; color: string }[] = [
    { label: 'EARNED TODAY', value: t ? rupees(t.earnings) : '—', color: C.greenDark },
    { label: 'ORDERS', value: t ? String(t.orders) : '—', color: C.ink },
    // C6: cash held for Zenvy (ledger) when the server sends it; older servers: COD collected today.
    { label: 'CASH WITH YOU', value: t?.cash ? rupees(t.cash.cashHeld) : t && t.codCollected !== undefined ? rupees(t.codCollected) : '—', color: C.cash },
  ];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open earnings" onPress={() => r.setTab('earnings')} style={styles.strip}>
      {tiles.map((x) => (
        <View key={x.label} style={styles.tile}>
          <Text style={[T.h2, { color: x.color }]} numberOfLines={1} adjustsFontSizeToFit>
            {x.value}
          </Text>
          <Text style={[T.label, { color: C.muted, fontSize: 11 }]}>{x.label}</Text>
        </View>
      ))}
    </Pressable>
  );
}

function ActiveCard({ order, syncing, onOpen }: { order: RiderOrder; syncing: boolean; onOpen: () => unknown }) {
  const idx = Math.max(0, stepIndex(order.status));
  const store = idx <= 1 ? kitchenChip(order) : null;
  return (
    <Card style={{ gap: S.md, borderWidth: 2, borderColor: C.ink }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Text style={[T.label, { color: C.muted, flex: 1 }]}>ORDER #{order.shortId}</Text>
        {syncing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={C.amber} />
            <Text style={[T.small, { color: C.amber, fontWeight: '800' }]}>Will sync</Text>
          </View>
        ) : null}
      </View>
      <Text style={[T.h2, { color: C.ink }]}>{stepFor(order.status) === 'UNKNOWN' ? 'Contact support' : STEP_TEXT[idx]}</Text>
      <Text style={[T.body, { color: C.ink2 }]} numberOfLines={2}>
        {idx <= 1 ? order.restaurantName ?? 'Store' : order.dropAddress ?? 'Customer'}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {order.buyAtStore && idx <= 1 ? <Badge tone="amber" icon="cart-outline" label="BUY AT STORE" /> : null}
        {order.deliverySlot ? <Badge tone="blue" icon="clock-outline" label={`SLOT ${order.deliverySlot}`} /> : null}
        {store ? <PillText text={store.text} ready={store.ready} /> : null}
        <PaymentPill order={order} />
      </View>
      <Btn title="Continue" icon="arrow-right" onPress={onOpen} />
    </Card>
  );
}

function PillText({ text, ready }: { text: string; ready: boolean }) {
  return (
    <View style={[styles.pill, { backgroundColor: ready ? C.greenTint : C.blueTint }]}>
      <MaterialCommunityIcons name={ready ? 'check-circle' : 'chef-hat'} size={16} color={ready ? C.greenDark : C.blue} />
      <Text style={[T.small, { color: ready ? C.greenDark : C.blue, fontWeight: '800' }]}>{text}</Text>
    </View>
  );
}

function Countdown({ seconds, onDone, paused }: { seconds: number; onDone: () => void; paused: boolean }) {
  const progress = useRef(new Animated.Value(1)).current;
  const [left, setLeft] = useState(seconds);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (paused) return;
    const anim = Animated.timing(progress, {
      toValue: 0,
      duration: left * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start();
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      anim.stop();
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !paused && !fired.current) {
      fired.current = true;
      doneRef.current();
    }
  }, [left, paused]);
  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.countTrack}>
        <Animated.View style={[styles.countFill, { width, backgroundColor: left <= 8 ? C.red : C.green }]} />
      </View>
      <Text style={[T.small, { color: left <= 8 ? C.red : C.muted, fontWeight: '800', textAlign: 'right' }]}>{left}s to accept</Text>
    </View>
  );
}

function OfferCard({
  order,
  distance,
  connected,
  covered,
  onAccept,
  onSkip,
  onExpire,
}: {
  order: RiderOrder;
  distance: string | null;
  connected: boolean;
  /** Home is under the delivery screen / an overlay: the rider cannot see this card, so its clock waits. */
  covered: boolean;
  onAccept: () => Promise<boolean>;
  onSkip: () => void;
  onExpire: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const accept = async () => {
    if (accepting) return;
    setAccepting(true);
    try {
      await onAccept();
    } finally {
      setAccepting(false);
    }
  };
  const ago = minutesAgo(order.createdAt);
  const chip = kitchenChip(order);
  // TalkBack: announce the new order once. (A live region on the whole card re-read it every second
  // because the countdown inside it ticks.)
  useEffect(() => {
    const earn = order.earning !== null ? `, you earn ${Math.round(order.earning)} rupees` : '';
    AccessibilityInfo.announceForAccessibility(`New delivery order from ${order.restaurantName ?? 'a store'}${earn}`);
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={[styles.offer, shadow]}>
      <View style={styles.offerTop}>
        <MaterialCommunityIcons name="bell-ring" size={24} color={C.white} />
        <Text style={[T.h3, { color: C.white, flex: 1 }]}>New delivery order</Text>
        {ago ? <Text style={[T.small, { color: C.white, opacity: 0.85 }]}>{ago}</Text> : null}
      </View>
      <View style={{ padding: S.lg, gap: S.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: S.sm }}>
          <Text style={[T.money, { color: C.greenDark }]}>{order.earning !== null ? `+${rupees(order.earning)}` : '—'}</Text>
          <Text style={[T.body, { color: C.muted, paddingBottom: 8 }]}>you earn</Text>
        </View>
        <View style={{ gap: S.xs }}>
          <Text style={[T.label, { color: order.buyAtStore ? C.amber : C.muted }]}>
            {order.buyAtStore ? 'BUY AT STORE' : 'PICKUP'}{distance ? ` · ${distance} away` : ''}
          </Text>
          <Text style={[T.h2, { color: C.ink }]} numberOfLines={2}>
            {order.restaurantName ?? 'Store'}
          </Text>
          {order.restaurantAddress ? (
            <Text style={[T.body, { color: C.ink2 }]} numberOfLines={2}>
              {order.restaurantAddress}
            </Text>
          ) : null}
        </View>
        <View style={{ gap: S.xs }}>
          <Text style={[T.label, { color: C.muted }]}>DROP{order.distanceKm ? ` · ${order.distanceKm.toFixed(1)} km trip` : ''}</Text>
          <Text style={[T.body, { color: C.ink, fontWeight: '700' }]} numberOfLines={2}>
            {order.dropAddress ?? order.dropArea ?? 'Shown after you accept'}
          </Text>
        </View>
        {order.deliverySlot ? (
          <View style={{ gap: S.xs }}>
            <Text style={[T.label, { color: C.muted }]}>DELIVERY SLOT</Text>
            <Text style={[T.body, { color: C.ink, fontWeight: '700' }]}>{order.deliverySlot}</Text>
          </View>
        ) : null}
        <ItemsLine order={order} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          <PaymentPill order={order} />
          {chip ? <PillText text={chip.text} ready={chip.ready} /> : null}
        </View>
        <Countdown seconds={OFFER_SECONDS} onDone={onExpire} paused={accepting || covered} />
        <Btn
          title={connected ? 'Accept order' : 'No internet'}
          icon={connected ? 'check-bold' : 'wifi-off'}
          variant="green"
          loading={accepting}
          disabled={!connected}
          onPress={accept}
        />
        <Btn title="Skip" variant="outline" size="mid" onPress={onSkip} disabled={accepting} accessibilityLabel="Skip this order" />
      </View>
    </View>
  );
}

function SmallOffer({
  order,
  distance,
  connected,
  onAccept,
  onSkip,
}: {
  order: RiderOrder;
  distance: string | null;
  connected: boolean;
  onAccept: () => Promise<boolean>;
  onSkip: () => void;
}) {
  return (
    <Card style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Text style={[T.h3, { color: C.ink, flex: 1 }]} numberOfLines={1}>
          {order.buyAtStore ? 'Buy at store: ' : ''}{order.restaurantName ?? 'Store'}
        </Text>
        <Text style={[T.h2, { color: C.greenDark }]}>{order.earning !== null ? `+${rupees(order.earning)}` : ''}</Text>
      </View>
      <Text style={[T.small, { color: C.ink2 }]} numberOfLines={1}>
        {[distance ? `${distance} to pickup` : null, order.dropAddress ?? order.dropArea].filter(Boolean).join(' · ') || 'Drop shown after you accept'}
      </Text>
      {order.deliverySlot ? (
        <Text style={[T.small, { color: C.ink, fontWeight: '700' }]} numberOfLines={1}>Slot: {order.deliverySlot}</Text>
      ) : null}
      <PaymentPill order={order} />
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Btn title="Skip" variant="outline" size="mid" onPress={onSkip} style={{ flex: 1 }} />
        <Btn title="Accept" variant="green" size="mid" icon="check-bold" disabled={!connected} onPress={onAccept} style={{ flex: 2 }} />
      </View>
    </Card>
  );
}

function WaitingCard() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  return (
    <Card style={{ alignItems: 'center', gap: S.md, paddingVertical: S.xl }}>
      <View style={{ width: 90, height: 90, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[styles.ring, { transform: [{ scale }], opacity }]} />
        <View style={styles.ringCore}>
          <MaterialCommunityIcons name="moped" size={34} color={C.white} />
        </View>
      </View>
      <Text style={[T.h3, { color: C.ink }]}>Looking for orders…</Text>
      <Text style={[T.body, { color: C.muted, textAlign: 'center' }]}>You will hear a sound when an order comes. Keep ZCS Rider allowed in the background.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: S.lg, gap: S.lg, paddingBottom: S.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  duty: { borderRadius: R.xl, padding: S.lg, gap: S.lg },
  dot: { width: 18, height: 18, borderRadius: 9 },
  strip: { flexDirection: 'row', backgroundColor: C.card, borderRadius: R.lg, paddingVertical: S.md, ...shadow },
  tile: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: S.xs },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill },
  offer: { backgroundColor: C.card, borderRadius: R.xl, overflow: 'hidden', borderWidth: 3, borderColor: C.green },
  offerTop: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.green, paddingHorizontal: S.lg, paddingVertical: S.md },
  countTrack: { height: 8, borderRadius: 4, backgroundColor: C.cardAlt, overflow: 'hidden' },
  countFill: { height: 8, borderRadius: 4 },
  ring: { position: 'absolute', width: 90, height: 90, borderRadius: 45, backgroundColor: C.green },
  ringCore: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
});
