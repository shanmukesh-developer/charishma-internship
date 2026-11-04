// Rent & payments: a RECORD only. Rent is paid at the PG (ZCS takes no online payments), and the owner marks a
// tenant's rent for a month as received: amount (defaults to the room rent), how it was paid, a note. Mistakes
// can be undone (the entry is kept as undone). Month switcher + the recent ledger.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, Chip, EmptyState, ErrorStrip, IconButton, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, Field, KeyValue, Screen, SectionTitle } from '../ui/Screen';
import { ListingSwitcher } from '../ui/ListingSwitcher';
import { useListing } from '../state/ListingProvider';
import { useHome } from '../state/HomeProvider';
import { useToast } from '../ui/Toast';
import { ownerApi } from '../api/ownerApi';
import { errorMessage } from '../lib/http';
import { dateLabel, dateTimeLabel, istMonth, monthLabel, rupees, shiftMonth } from '../lib/format';
import { LIMITS } from '../config';
import type { Booking, RentMethod, RentRecord, RentResponse } from '../types';
import type { TabProps } from './Home';

const METHODS: { key: RentMethod; label: string; icon: 'cash-outline' | 'phone-portrait-outline' | 'business-outline' | 'ellipsis-horizontal' }[] = [
  { key: 'cash', label: 'Cash', icon: 'cash-outline' },
  { key: 'upi', label: 'UPI', icon: 'phone-portrait-outline' },
  { key: 'bank', label: 'Bank', icon: 'business-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
];
const methodLabel = (m: string) => METHODS.find((x) => x.key === m)?.label || m;

export default function PaymentsTab(_props: TabProps) {
  const { current } = useListing();
  const { refresh: refreshHome } = useHome();
  const toast = useToast();
  const [month, setMonth] = useState(istMonth());
  const [data, setData] = useState<RentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<{ booking: Booking; expected: number } | null>(null);
  const [undoing, setUndoing] = useState<RentRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      setData(await ownerApi.rent(month, current.id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [month, current]);
  useEffect(() => { load(); }, [load]);

  const thisMonth = istMonth();
  const canNext = month < shiftMonth(thisMonth, 1);

  const undo = async () => {
    if (!undoing || busy) return;
    setBusy(true);
    try {
      await ownerApi.voidRent(undoing.id, 'Undone in the app');
      toast.show('Entry undone.', 'info');
      setUndoing(null);
      await load();
      refreshHome();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const s = data?.summary;
  return (
    <Screen title="Rent & payments" subtitle={current?.name} right={<ListingSwitcher />} refreshing={loading && !!data} onRefresh={load} tabBarSpace>
      <View style={st.monthBar}>
        <IconButton icon="chevron-back" label="Previous month" onPress={() => setMonth((m) => shiftMonth(m, -1))} bg={color.surface} tint={color.primaryDark} />
        <Text style={[font.h3, { color: color.text, flex: 1, textAlign: 'center' }]} accessibilityLiveRegion="polite">{monthLabel(month)}</Text>
        <IconButton icon="chevron-forward" label="Next month" onPress={() => setMonth((m) => shiftMonth(m, 1))} disabled={!canNext} bg={color.surface} tint={color.primaryDark} />
      </View>

      {error && !data ? <ErrorStrip text={error} onRetry={load} busy={loading} /> : null}
      {!data && !error ? <><SkeletonCard lines={2} /><SkeletonCard /></> : null}

      {s ? (
        <Card style={st.summary}>
          <View style={{ flex: 1 }}>
            <Text style={[font.label, { color: color.textMuted }]}>RECEIVED</Text>
            <Text style={[font.big, { color: color.text }]}>{rupees(s.amountReceived)}</Text>
            <Text style={[font.small, { color: color.textMuted }]}>of {rupees(s.amountExpected)} expected</Text>
          </View>
          <View style={st.pills}>
            <Badge text={`${s.received} paid`} fg={color.ok} bg={color.okTint} icon="checkmark-circle" />
            <Badge text={`${s.due} due`} fg={s.due ? color.warn : color.textMuted} bg={s.due ? color.warnTint : color.surfaceAlt} icon="time-outline" />
          </View>
        </Card>
      ) : null}
      <Banner tone="info" text="A record only. Rent is paid at the PG; ZenWe takes no online payments and no money moves here." />

      {data && !data.rows.length ? (
        <EmptyState icon="wallet-outline" title="No tenants this month" body="Accepted tenants who stayed in this month show here." />
      ) : null}
      {data?.rows.map(({ booking, expected, record }) => {
        const paid = record && record.status === 'RECEIVED';
        return (
          <Card key={booking.id} style={st.row}>
            <View style={[st.dot, { backgroundColor: paid ? color.okTint : color.warnTint }]}>
              <Ionicons name={paid ? 'checkmark' : 'time-outline'} size={18} color={paid ? color.ok : color.warn} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[font.h3, { color: color.text }]}>{booking.student.firstName}</Text>
              <Text style={[font.small, { color: color.textMuted }]}>
                {booking.room ? `Room ${booking.room.roomNumber}` : 'Room'} · #{booking.code}{booking.checkInDate ? ` · since ${dateLabel(booking.checkInDate)}` : ''}
              </Text>
              {paid ? <Text style={[font.small, { color: color.ok, fontWeight: '700' }]}>{rupees(record!.amount)} · {methodLabel(record!.method)}{record!.receivedAt ? ` · ${dateTimeLabel(record!.receivedAt)}` : ''}</Text> : null}
            </View>
            {paid
              ? <Button label="Undo" variant="secondary" size="secondary" onPress={() => setUndoing(record)} style={{ paddingHorizontal: space.sm }} />
              : <Button label="Mark paid" size="secondary" onPress={() => setMarking({ booking, expected })} style={{ paddingHorizontal: space.sm }} />}
          </Card>
        );
      })}

      {data && data.ledger.length ? (
        <>
          <SectionTitle text="Recent entries" />
          <Card style={{ gap: 2 }}>
            {data.ledger.slice(0, 20).map((l) => (
              <View key={l.id} style={st.ledger}>
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { color: l.status === 'VOIDED' ? color.textMuted : color.text, fontWeight: '600', textDecorationLine: l.status === 'VOIDED' ? 'line-through' : 'none' }]}>
                    {l.tenant?.firstName || 'Tenant'} · {monthLabel(l.month)}
                  </Text>
                  <Text style={[font.small, { color: color.textMuted }]}>{l.status === 'VOIDED' ? 'Undone' : `${methodLabel(l.method)}${l.note ? ` · ${l.note}` : ''}`}</Text>
                </View>
                <Text style={[font.h3, { color: l.status === 'VOIDED' ? color.textMuted : color.text }]}>{rupees(l.amount)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <MarkSheet target={marking} month={month} onClose={() => setMarking(null)} onDone={async () => { setMarking(null); await load(); refreshHome(); }} />
      <Sheet visible={!!undoing} onClose={() => setUndoing(null)} title="Undo this entry?">
        <Text style={[font.body, { color: color.textSecondary, marginBottom: space.md }]}>
          The rent for {monthLabel(month)} goes back to due. The entry stays in the history as undone.
        </Text>
        <View style={{ gap: space.xs }}>
          <Button label="Undo entry" variant="dangerOutline" onPress={undo} loading={busy} />
          <Button label="Keep it" variant="secondary" onPress={() => setUndoing(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function MarkSheet({ target, month, onClose, onDone }: { target: { booking: Booking; expected: number } | null; month: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<RentMethod>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (target) { setAmount(target.expected ? String(Math.round(target.expected)) : ''); setMethod('cash'); setNote(''); setError(null); }
  }, [target]);
  const n = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= LIMITS.RENT_MAX;
  const submit = async () => {
    if (!target || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ownerApi.recordRent({ bookingId: target.booking.id, month, amount: Math.round(n), method, note: note.trim() || undefined });
      toast.show(r.message, 'success');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={!!target} onClose={onClose} title={target ? `${target.booking.student.firstName}: rent for ${monthLabel(month)}` : 'Rent'}>
      <View style={{ gap: space.md }}>
        {target ? <KeyValue k="Room rent" v={target.expected ? `${rupees(target.expected)} /month` : 'Not set'} /> : null}
        <Field label="Amount received" prefix="₹" value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d]/g, '').slice(0, 6))} keyboardType="number-pad"
          error={amount && !valid ? `Enter an amount up to ${rupees(LIMITS.RENT_MAX)}.` : null} />
        <View style={{ gap: space.xs }}>
          <Text style={[font.label, { color: color.textSecondary }]}>PAID BY</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {METHODS.map((m) => <Chip key={m.key} label={m.label} icon={m.icon} selected={method === m.key} onPress={() => setMethod(m.key)} />)}
          </View>
        </View>
        <Field label="Note (optional)" value={note} onChangeText={(v) => setNote(v.slice(0, 200))} placeholder="e.g. Paid with the deposit" />
        {error ? <Banner tone="error" text={error} /> : null}
        <Button label="Mark as received" icon="checkmark-circle-outline" onPress={submit} loading={busy} disabled={!valid} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.primaryTint, borderRadius: radius.lg, padding: space.xs },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pills: { gap: space.xs, alignItems: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  ledger: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.border },
});
