// Earnings history (GET /delivery/stats/range: by week and by day, last 30 or 90 IST days) and payout
// statements (GET /delivery/payouts: amount, status, UTR, paid date). Read only, real data only.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C, R, S, T, shadow } from '../theme';
import { Badge, Btn, Card, EmptyState, ErrorState, Label, Skeleton } from '../ui/kit';
import * as api from '../services/deliveryApi';
import { errorMessage } from '../services/apiClient';
import { dateIST, dayLabel, rupees, rupeesExact, shortDate } from '../services/format';
import type { EarningsRange, PayoutStatement } from '../types';

type Period = 30 | 90;

/** `reloadKey` bumps on pull-to-refresh. */
export function EarningsHistory({ reloadKey }: { reloadKey: number }) {
  const [period, setPeriod] = useState<Period>(30);
  const [data, setData] = useState<EarningsRange | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setState((s) => (s === 'ready' ? s : 'loading'));
    try {
      const r = await api.fetchEarningsRange(period);
      if (my !== seq.current) return;
      setData(r);
      setState(r ? 'ready' : 'missing');
    } catch (e) {
      if (my !== seq.current) return;
      setError(errorMessage(e));
      setState('error');
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const days = data ? data.days.filter((d) => d.orders > 0).slice().reverse() : [];
  const weeks = data ? data.weeks.slice().reverse() : [];

  return (
    <View style={{ gap: S.lg }}>
      <View style={styles.chips}>
        {([30, 90] as Period[]).map((p) => {
          const on = p === period;
          return (
            <Pressable
              key={p}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (p !== period) {
                  setData(null);
                  setPeriod(p);
                }
              }}
              style={[styles.chip, on && { backgroundColor: C.ink, borderColor: C.ink }]}
            >
              <Text style={[T.small, { color: on ? C.white : C.ink, fontWeight: '800' }]}>Last {p} days</Text>
            </Pressable>
          );
        })}
      </View>

      {state === 'loading' && !data ? (
        <Skeleton height={170} />
      ) : state === 'error' && !data ? (
        <ErrorState message={error ?? 'Could not load your earnings.'} onRetry={load} />
      ) : state === 'missing' || !data ? (
        <EmptyState icon="calendar-clock" title="History is not available yet" body="Zenvy is updating. Check again later today." />
      ) : (
        <>
          <View style={[styles.hero, shadow]}>
            <Label color={C.white}>{`EARNED ${shortDate(data.from).toUpperCase()} TO ${shortDate(data.to).toUpperCase()}`}</Label>
            <Text style={[T.money, { color: C.white }]}>{rupees(data.totalEarnings)}</Text>
            <View style={{ flexDirection: 'row', gap: S.md }}>
              <Stat label="Orders" value={String(data.totalOrders)} />
              <Stat label="Cash collected" value={rupees(data.codCollected)} />
            </View>
          </View>

          <Card style={{ gap: S.xs }}>
            <Label>WEEK BY WEEK</Label>
            {weeks.map((w, i) => (
              <View key={w.weekStart} style={[styles.line, i < weeks.length - 1 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text style={[T.body, { color: C.ink, fontWeight: '700' }]}>
                    {shortDate(w.from)} to {shortDate(w.to)}
                  </Text>
                  <Text style={[T.small, { color: C.muted }]}>
                    {w.orders} deliver{w.orders === 1 ? 'y' : 'ies'}
                    {w.codCollected ? ` · ${rupees(w.codCollected)} cash` : ''}
                  </Text>
                </View>
                <Text style={[T.h3, { color: w.earnings ? C.greenDark : C.muted }]}>{rupees(w.earnings)}</Text>
              </View>
            ))}
          </Card>

          <Card style={{ gap: S.xs }}>
            <Label>DAY BY DAY</Label>
            {days.length === 0 ? (
              <Text style={[T.body, { color: C.muted }]}>No deliveries in this period.</Text>
            ) : (
              days.map((d, i) => (
                <View key={d.date} style={[styles.line, i < days.length - 1 && styles.divider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[T.body, { color: C.ink, fontWeight: '700' }]}>{dayLabel(d.date)}</Text>
                    <Text style={[T.small, { color: C.muted }]}>
                      {d.orders} deliver{d.orders === 1 ? 'y' : 'ies'}
                      {d.codCollected ? ` · ${rupees(d.codCollected)} cash` : ''}
                    </Text>
                  </View>
                  <Text style={[T.h3, { color: C.greenDark }]}>{rupees(d.earnings)}</Text>
                </View>
              ))
            )}
          </Card>
          <Text style={[T.small, { color: C.muted, textAlign: 'center' }]}>Days are India time (IST). Weeks start on Monday. Tips are paid separately.</Text>
        </>
      )}
    </View>
  );
}

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'grey' }> = {
  PAID: { label: 'Paid', tone: 'green' },
  PENDING: { label: 'Being processed', tone: 'amber' },
};

export function PayoutHistory({ reloadKey }: { reloadKey: number }) {
  const [list, setList] = useState<PayoutStatement[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await api.fetchPayouts(1);
      if (my !== seq.current) return;
      if (!r) {
        setState('missing');
        return;
      }
      setList(r.payouts);
      setHasMore(r.hasMore);
      setPage(1);
      setState('ready');
    } catch (e) {
      if (my !== seq.current) return;
      setError(errorMessage(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const loadMore = async () => {
    if (more || !hasMore) return;
    setMore(true);
    const my = seq.current;
    try {
      const r = await api.fetchPayouts(page + 1);
      if (my !== seq.current || !r) return;
      setList((cur) => {
        const seen = new Set((cur ?? []).map((p) => p.id));
        return [...(cur ?? []), ...r.payouts.filter((p) => !seen.has(p.id))];
      });
      setHasMore(r.hasMore);
      setPage((p) => p + 1);
    } catch {
      // the button stays; the rider can tap again
    } finally {
      setMore(false);
    }
  };

  if (state === 'loading' && !list) return <Skeleton height={140} />;
  if (state === 'error' && !list) return <ErrorState message={error ?? 'Could not load your payouts.'} onRetry={load} />;
  if (state === 'missing') return <EmptyState icon="bank-outline" title="Payouts are not available yet" body="Zenvy is updating. Check again later today." />;
  if (!list || list.length === 0) {
    return <EmptyState icon="bank-outline" title="No payouts yet" body="When Zenvy pays your earnings, each payment shows here with its reference number (UTR)." />;
  }
  return (
    <View style={{ gap: S.md }}>
      {list.map((p) => {
        const st = STATUS[p.status] ?? { label: p.status.charAt(0) + p.status.slice(1).toLowerCase(), tone: 'grey' as const };
        return (
          <Card key={p.id} style={{ gap: S.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
              <Text style={[T.h2, { color: p.net < 0 ? C.red : C.ink, flex: 1 }]}>{rupeesExact(p.net)}</Text>
              <Badge label={st.label} tone={st.tone} />
            </View>
            <Text style={[T.small, { color: C.ink2 }]}>
              {p.periodStart ? `${dateIST(p.periodStart)} to ${dateIST(p.periodEnd)}` : `Up to ${dateIST(p.periodEnd)}`} · {p.orderCount} deliver
              {p.orderCount === 1 ? 'y' : 'ies'}
            </Text>
            <View style={{ gap: 2 }}>
              <Line label="Earnings" value={rupeesExact(p.gross)} />
              {p.tips ? <Line label="Tips" value={rupeesExact(p.tips)} /> : null}
              {p.adjustments ? <Line label="Adjustments" value={rupeesExact(p.adjustments)} /> : null}
              {p.status === 'PAID' ? <Line label="Paid on" value={dateIST(p.paidAt)} /> : null}
              {p.status === 'PAID' && p.method ? <Line label="Paid by" value={p.method.toUpperCase()} /> : null}
              {p.utr ? <Line label="UTR" value={p.utr} selectable /> : null}
            </View>
          </Card>
        );
      })}
      {hasMore ? <Btn title="Show older payouts" variant="outline" size="mid" loading={more} onPress={loadMore} /> : null}
      <Text style={[T.small, { color: C.muted, textAlign: 'center' }]}>Questions about a payout? Raise a ticket in Help and quote the UTR.</Text>
    </View>
  );
}

function Line({ label, value, selectable }: { label: string; value: string; selectable?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
      <Text style={[T.small, { color: C.muted }]}>{label}</Text>
      <Text style={[T.small, { color: C.ink, fontWeight: '700', flexShrink: 1, textAlign: 'right' }]} selectable={selectable}>
        {value}
      </Text>
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
  chips: { flexDirection: 'row', gap: S.sm },
  chip: { flex: 1, minHeight: 44, borderRadius: R.pill, borderWidth: 2, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: C.greenDark, borderRadius: R.xl, padding: S.xl, gap: S.sm },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: R.md, padding: S.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm },
  divider: { borderBottomWidth: 1, borderBottomColor: C.cardAlt },
});
