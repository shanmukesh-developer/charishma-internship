// Payout statements (read only): every statement Zenvy made for this store, with the amount, status,
// UTR and paid date, plus what is not on a statement yet. GET /api/restaurants/:id/payouts.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUPPORT_PHONE } from '../config';
import { getPayouts, type PayoutStatement, type StorePayouts } from '../lib/api';
import { errorMessage } from '../lib/http';
import { istDayKey, rupees } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { color, font, space } from '../theme';
import { Badge, Button, Card, EmptyState, IconButton, kit, SkeletonCard } from '../ui/kit';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "21 Oct 2026" (IST calendar day). */
function dateIST(d: string | null): string {
  if (!d) return '—';
  const key = istDayKey(d);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '—';
}

function Line({ label, value, strong, selectable }: { label: string; value: string; strong?: boolean; selectable?: boolean }) {
  return (
    <View style={kit.row}>
      <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>{label}</Text>
      <Text selectable={selectable} style={[font.body, { color: color.text, fontWeight: strong ? '800' : '600', textAlign: 'right', flexShrink: 1 }]}>{value}</Text>
    </View>
  );
}

function Statement({ p }: { p: PayoutStatement }) {
  const paid = p.status === 'PAID';
  return (
    <Card style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={[font.money, { color: p.net < 0 ? color.alertDark : color.text, flex: 1 }]} numberOfLines={1} adjustsFontSizeToFit>
          {rupees(p.net)}
        </Text>
        <Badge
          text={paid ? 'Paid' : 'Being processed'}
          fg={paid ? color.openDark : color.warning}
          bg={paid ? color.openTint : color.warningTint}
          icon={paid ? 'checkmark-circle' : 'time-outline'}
        />
      </View>
      <Text style={[font.small, { color: color.textSecondary }]}>
        {p.periodStart ? `${dateIST(p.periodStart)} to ${dateIST(p.periodEnd)}` : `Up to ${dateIST(p.periodEnd)}`} · {p.orderCount} order{p.orderCount === 1 ? '' : 's'}
      </Text>
      {p.net < 0 ? (
        <Text style={[font.small, { color: color.alertDark, fontWeight: '700' }]}>You owe ZCS this amount: you collected the cash for these orders yourself.</Text>
      ) : null}
      <View>
        <Line label="Sales" value={rupees(p.gross)} />
        <Line label="ZCS commission" value={p.commission ? `-${rupees(p.commission)}` : rupees(0)} />
        {p.adjustments ? <Line label="Adjustments" value={rupees(p.adjustments)} /> : null}
        <Line label="Net" value={rupees(p.net)} strong />
        {paid ? <Line label="Paid on" value={dateIST(p.paidAt)} /> : null}
        {paid && p.method ? <Line label="Paid by" value={p.method.toUpperCase()} /> : null}
        {p.utr ? <Line label="UTR" value={p.utr} selectable /> : null}
      </View>
    </Card>
  );
}

export default function PayoutsScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { restaurant } = useStore();
  const [data, setData] = useState<StorePayouts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(1);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await getPayouts(restaurant.id, 1);
      if (my !== seq.current) return;
      setData(r);
      setPage(1);
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e, "Couldn't load your payouts."));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [restaurant.id]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (more || !data?.hasMore) return;
    setMore(true);
    const my = seq.current;
    try {
      const r = await getPayouts(restaurant.id, page + 1);
      if (my !== seq.current) return;
      setData((cur) => {
        if (!cur) return r;
        const seen = new Set(cur.payouts.map((p) => p.id));
        return { ...cur, payouts: [...cur.payouts, ...r.payouts.filter((p) => !seen.has(p.id))], hasMore: r.hasMore };
      });
      setPage((p) => p + 1);
    } catch {
      // the button stays; tap again
    } finally {
      setMore(false);
    }
  };

  const help = () => {
    const text = encodeURIComponent(`${restaurant.name || 'My store'} has a question about a payout`);
    Linking.openURL(`https://wa.me/${SUPPORT_PHONE}?text=${text}`).catch(() => {});
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
        <IconButton icon="arrow-back" label="Back" onPress={onBack} />
        <Text style={[font.h2, { color: color.text, flex: 1 }]}>Payout statements</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: insets.bottom + space.xxl }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={load} colors={[color.text]} />}
      >
        {!data && loading ? (
          <><SkeletonCard lines={3} /><SkeletonCard lines={3} /></>
        ) : !data ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load your payouts" body={error || undefined} action={{ label: 'Try again', onPress: load, loading }} />
        ) : (
          <>
            <Card style={{ gap: 4 }}>
              <Text style={[font.label, { color: color.textMuted }]}>NOT ON A STATEMENT YET</Text>
              <Text style={[font.h2, { color: color.text }]}>{rupees(data.pending.net)}</Text>
              <Text style={[font.small, { color: color.textSecondary }]}>
                {data.pending.orders
                  ? `${data.pending.orders} delivered order${data.pending.orders === 1 ? '' : 's'} will go on your next statement.`
                  : 'Every delivered order is on a statement.'}
              </Text>
            </Card>
            {data.payouts.length === 0 ? (
              <EmptyState icon="wallet-outline" title="No statements yet" body="When ZCS pays you, each statement shows here with its UTR (bank reference)." />
            ) : (
              data.payouts.map((p) => <Statement key={p.id} p={p} />)
            )}
            {data.hasMore ? <Button label="Show older statements" variant="secondary" size="secondary" loading={more} onPress={loadMore} /> : null}
            <Text style={[font.small, { color: color.textMuted, textAlign: 'center' }]}>Dates are India time (IST). Amounts in ₹.</Text>
            <Button label="Ask about a payout" icon="logo-whatsapp" variant="secondary" size="secondary" onPress={help} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm,
    backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border,
  },
});
