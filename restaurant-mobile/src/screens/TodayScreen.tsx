// "Today" (IST), computed from the real orders list. No invented payouts or ratings.
import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { istDayKey, rupees, todayIST, todayNumbers } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { color, font, radius, space } from '../theme';
import { Card, ErrorStrip } from '../ui/kit';

function Tile({ label, value, caption, tint }: { label: string; value: string; caption?: string; tint?: string }) {
  return (
    <Card style={styles.tile}>
      <Text style={[font.label, { color: color.textMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[font.money, { color: tint || color.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {caption ? <Text style={[font.small, { color: color.textSecondary }]}>{caption}</Text> : null}
    </Card>
  );
}

const dayLabel = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]} ${d}`;
};

export default function TodayScreen() {
  const { orders, refreshing, refreshOrders, ordersError, ordersLoaded } = useStore();

  const s = useMemo(() => {
    const t = todayNumbers(orders);
    const days: { key: string; orders: number; sales: number }[] = [];
    const now = Date.now();
    for (let i = 6; i >= 0; i--) days.push({ key: istDayKey(now - i * 86400000), orders: 0, sales: 0 });
    for (const o of orders) {
      if (!o.createdAt || o.status === 'Cancelled') continue;
      const d = days.find((x) => x.key === istDayKey(o.createdAt as string));
      if (!d) continue;
      d.orders += 1;
      if (o.status === 'Delivered') d.sales += o.totalPrice;
    }
    return { ...t, days, maxDay: Math.max(1, ...days.map((d) => d.orders)) };
  }, [orders]);

  const todayKey = todayIST();

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xxl * 2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshOrders({ pull: true })} colors={[color.text]} />}
    >
      {ordersError ? <ErrorStrip text={ordersError} onRetry={() => refreshOrders({ pull: true })} busy={refreshing} /> : null}
      <Text style={[font.h1, { color: color.text }]}>Today</Text>
      {!ordersLoaded ? <Text style={[font.body, { color: color.textMuted }]}>Loading…</Text> : null}
      <View style={styles.grid}>
        <Tile label="Orders" value={String(s.orders)} caption="Not counting cancelled" />
        <Tile label="Sales" value={rupees(s.sales)} caption="Delivered · food value" tint={color.openDark} />
      </View>
      {s.inProgressValue > 0 ? (
        <Text style={[font.body, { color: color.textSecondary }]}>In progress: {rupees(s.inProgressValue)}</Text>
      ) : null}
      <View style={styles.grid}>
        <Tile label="Cash orders" value={String(s.codN)} caption={`${rupees(s.codAmt)} · rider collects`} tint={color.cash} />
        <Tile label="Paid orders" value={String(s.preN)} caption={`${rupees(s.preAmt)} · ZenWe Wallet`} tint={color.prepaid} />
      </View>
      <View style={styles.grid}>
        <Tile label="Cancelled" value={String(s.cancelled)} caption={s.missed ? `${s.missed} not accepted in time` : 'Rejected or cancelled'} tint={s.cancelled ? color.alert : undefined} />
        <Tile
          label="Avg prep"
          value={s.avgPrep !== null ? (s.avgPrep < 1 ? '<1 min' : `${s.avgPrep} min`) : '—'}
          caption={s.avgPrep !== null ? `From ${s.prepN} order${s.prepN === 1 ? '' : 's'}` : 'Shows after you mark orders ready'}
        />
      </View>

      <Card style={{ gap: space.sm }}>
        <Text style={[font.h3, { color: color.text }]}>Last 7 days</Text>
        {s.days.map((d) => (
          <View key={d.key} style={styles.dayRow} accessibilityLabel={`${dayLabel(d.key)}: ${d.orders} orders, ${rupees(d.sales)} delivered`}>
            <Text style={[font.small, { color: color.text, width: 64, fontWeight: d.key === todayKey ? '800' : '500' }]}>
              {d.key === todayKey ? 'Today' : dayLabel(d.key)}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { width: `${(d.orders / s.maxDay) * 100}%` }]} />
            </View>
            <Text style={[font.small, { color: color.text, width: 100, textAlign: 'right' }]}>{d.orders} · {rupees(Math.round(d.sales))}</Text>
          </View>
        ))}
        <Text style={[font.small, { color: color.textMuted }]}>Orders (not cancelled) · delivered sales. From your latest 200 orders.</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: space.md },
  tile: { flex: 1, gap: 4 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 28 },
  barTrack: { flex: 1, height: 12, backgroundColor: color.surfaceAlt, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 12, backgroundColor: color.open, borderRadius: radius.pill },
});
