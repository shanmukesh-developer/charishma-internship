// Earnings from real data only: /stats/today, /stats/week (or recent deliveries), per-order list,
// plus history by week / day (/stats/range) and payout statements (/payouts) in EarningsHistory.tsx.
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, R, S, T, shadow } from '../theme';
import { Banner, Card, EmptyState, ErrorState, Label, ScreenHeader, Segmented, Skeleton } from '../ui/kit';
import * as api from '../services/deliveryApi';
import type { RiderCash } from '../types';
import { useRider } from '../state/RiderStore';
import { dayLabel, istDayKey, lastNDayKeys, rupees, shortWeekday, timeIST, todayKey } from '../services/format';
import { OrderLine } from './History';
import { EarningsHistory, PayoutHistory } from './EarningsHistory';

export function EarningsScreen() {
  const r = useRider();
  const [seg, setSeg] = useState<'today' | 'week' | 'history' | 'payouts'>('today');
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // C6: cash held for Zenvy (COD) + what Zenvy owes, from GET /delivery/cash. Null on older servers.
  const [cashInfo, setCashInfo] = useState<RiderCash | null>(null);
  const loadCash = () => api.fetchCash().then(setCashInfo).catch(() => {});

  useEffect(() => {
    r.refreshEarnings();
    loadCash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tKey = todayKey();
  // Recomputed when the IST day changes (the screen can stay open past midnight).
  const weekKeys = useMemo(() => new Set(lastNDayKeys(7)), [tKey]);
  const rows = useMemo(() => {
    const list = r.history.data ?? [];
    return list.filter((o) => o.deliveredAt && (seg === 'today' ? istDayKey(o.deliveredAt) === tKey : weekKeys.has(istDayKey(o.deliveredAt))));
  }, [r.history.data, seg, tKey, weekKeys]);

  const t = r.today.data;
  const w = r.week;
  const codWeek = w?.days.some((d) => d.codCollected !== undefined) ? w.days.reduce((s, d) => s + (d.codCollected ?? 0), 0) : null;

  const amount = seg === 'today' ? t?.earnings ?? null : w?.totalEarnings ?? null;
  const orders = seg === 'today' ? t?.orders ?? null : w?.totalOrders ?? null;
  const cash = seg === 'today' ? (t?.codCollected ?? null) : codWeek;

  const loading = seg === 'today' ? !r.today.loaded && !t : !w && !r.history.loaded;
  const error = seg === 'today' ? (!t ? r.today.error : null) : !w ? r.history.error : null;
  const maxDay = Math.max(1, ...(w?.days.map((d) => d.earnings) ?? [1]));

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: S.xxl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              setReloadKey((k) => k + 1);
              await Promise.all([r.refreshEarnings(), loadCash()]);
            } finally {
              setRefreshing(false);
            }
          }}
        />
      }
    >
      <ScreenHeader title="Earnings" />
      <View style={styles.content}>
        <Segmented
          options={[
            { key: 'today', label: 'Today' },
            { key: 'week', label: '7 days' },
            { key: 'history', label: 'History' },
            { key: 'payouts', label: 'Payouts' },
          ]}
          value={seg}
          onChange={setSeg}
        />

        {seg === 'history' ? <EarningsHistory reloadKey={reloadKey} /> : null}
        {seg === 'payouts' ? <PayoutHistory reloadKey={reloadKey} /> : null}
        {seg === 'today' || seg === 'week' ? (
        <>

        {r.today.error && r.today.updatedAt && seg === 'today' ? (
          <Text style={[T.small, { color: C.amber, fontWeight: '700' }]}>Offline. Showing data from {timeIST(r.today.updatedAt)}.</Text>
        ) : null}

        {loading ? (
          <Skeleton height={170} />
        ) : error ? (
          <ErrorState message={error} onRetry={r.refreshEarnings} />
        ) : (
          <View style={[styles.hero, shadow]}>
            <Label color={C.white}>{seg === 'today' ? 'EARNED TODAY' : 'EARNED IN 7 DAYS'}</Label>
            <Text style={[T.money, { color: C.white }]}>{rupees(amount)}</Text>
            <View style={{ flexDirection: 'row', gap: S.md }}>
              <Stat label="Orders" value={orders !== null ? String(orders) : '—'} />
              <Stat label="Cash collected" value={cash !== null ? rupees(cash) : '—'} />
            </View>
          </View>
        )}

        {cashInfo ? <CashCard cash={cashInfo} /> : null}

        {seg === 'week' && w ? (
          <Card style={{ gap: S.md }}>
            <Label>DAY BY DAY</Label>
            <View style={styles.bars}>
              {w.days.map((d) => (
                <View key={d.date} style={styles.barCol} accessibilityLabel={`${dayLabel(d.date)}: ${rupees(d.earnings)}, ${d.orders} orders`}>
                  <Text style={[T.small, { color: C.ink, fontWeight: '800', fontSize: 11 }]} numberOfLines={1}>
                    {d.earnings ? Math.round(d.earnings) : ''}
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { height: `${Math.max(4, (d.earnings / maxDay) * 100)}%`, backgroundColor: d.date === tKey ? C.green : C.ink2 }]} />
                  </View>
                  <Text style={[T.small, { color: d.date === tKey ? C.greenDark : C.muted, fontWeight: '800' }]}>{shortWeekday(d.date)}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <Text style={[T.h3, { color: C.ink }]}>Orders ({rows.length})</Text>
        {rows.length === 0 ? (
          r.history.error && !r.history.data ? (
            <ErrorState message={r.history.error} onRetry={r.refreshHistory} />
          ) : (
            <EmptyState icon="cash-remove" title={seg === 'today' ? 'No deliveries yet today' : 'No deliveries in the last 7 days'} />
          )
        ) : (
          <Card style={{ paddingVertical: S.xs }}>
            {rows.map((o, i) => (
              <OrderLine key={o.id} order={o} last={i === rows.length - 1} showDay={seg === 'week'} />
            ))}
          </Card>
        )}

        </>
        ) : null}

        {r.profile?.totalEarnings !== null && r.profile?.totalEarnings !== undefined ? (
          <Text style={[T.small, { color: C.muted, textAlign: 'center' }]}>
            Lifetime: {rupees(r.profile.totalEarnings)}
            {r.profile.completedCount !== null ? ` · ${r.profile.completedCount} deliver${r.profile.completedCount === 1 ? 'y' : 'ies'}` : ''}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

// C6: informational. Cash collected for COD orders is handed over to Zenvy separately (deposits); it is
// never taken out of earnings. The deposit banner shows only when an admin has turned on a cash limit.
function CashCard({ cash }: { cash: RiderCash }) {
  const { status, position, recentDeposits } = cash;
  return (
    <Card style={{ gap: S.sm }}>
      {status.limitEnabled && status.overLimit && status.message ? <Banner text={status.message} tone="amber" icon="cash-lock" /> : null}
      <Label>CASH WITH YOU</Label>
      <Text style={[T.money, { color: C.cash }]}>{rupees(status.cashHeld)}</Text>
      <Text style={[T.small, { color: C.muted }]}>COD cash you collected and have not deposited to ZCS yet.</Text>
      <View style={{ gap: 4, marginTop: S.sm }}>
        <Line label="Cash you hold" value={rupees(position.cashHeld)} />
        <Line label="ZCS owes you (earnings + tips)" value={rupees(position.zenvyOwes)} />
        <Line label={position.net >= 0 ? 'Net: ZCS owes you' : 'Net: you owe ZCS'} value={rupees(Math.abs(position.net))} strong />
      </View>
      {recentDeposits.length ? (
        <View style={{ gap: 4, marginTop: S.sm }}>
          <Label>DEPOSITS</Label>
          {recentDeposits.map((d) => (
            <Line
              key={d.id}
              label={`${d.label}${d.method ? ` · ${d.method.toUpperCase()}` : ''} · ${dayLabel(istDayKey(d.createdAt))}`}
              value={`${d.amount < 0 ? '−' : '+'}${rupees(Math.abs(d.amount))}`}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
      <Text style={[T.small, { color: C.ink, flex: 1, fontWeight: strong ? '800' : '600' }]} numberOfLines={1}>{label}</Text>
      <Text style={[T.small, { color: C.ink, fontWeight: strong ? '800' : '700' }]}>{value}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[T.h3, { color: C.white }]}>{value}</Text>
      <Text style={[T.small, { color: C.white, opacity: 0.85 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: S.lg, gap: S.lg },
  hero: { backgroundColor: C.greenDark, borderRadius: R.xl, padding: S.xl, gap: S.sm },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: R.md, padding: S.md },
  bars: { flexDirection: 'row', gap: 6, height: 150, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  barFill: { width: '100%', borderRadius: 6 },
});
