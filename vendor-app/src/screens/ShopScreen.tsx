// Shop: the big OPEN / CLOSED switch, shop hours, and today's real numbers (from the orders list).
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { shopLine, useOpenToggle } from '../components/ShopBar';
import { deliveredDay, formatHHMM, istDayKey, rupees, todayIST, todayNumbers } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { color, font, radius, space, touch } from '../theme';
import { Button, Card, ErrorStrip, Sheet } from '../ui/kit';

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

/** "7", "7:30", "7.30 pm", "19:30" → "19:30"; null when it is not a time. */
export function parseTime(input: string): string | null {
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(input);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3] ? m[3].toLowerCase()[0] : null;
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const PRESETS: { label: string; start: string; end: string }[] = [
  { label: '6 AM – 10 PM', start: '06:00', end: '22:00' },
  { label: '7 AM – 9 PM', start: '07:00', end: '21:00' },
  { label: '5 PM – 11 PM', start: '17:00', end: '23:00' },
  { label: 'All day', start: '00:00', end: '00:00' },
];

function HoursSheet({ visible, onClose, start, end, weekly }: { visible: boolean; onClose: () => void; start?: string; end?: string; weekly?: boolean }) {
  const { setHours } = useStore();
  const [s, setS] = useState(start ? formatHHMM(start) : '');
  const [e, setE] = useState(end ? formatHHMM(end) : '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // State updates are async: two quick taps would both pass a `saving` check and send two saves.
  const savingRef = useRef(false);

  const save = async () => {
    if (savingRef.current) return;
    const ps = parseTime(s);
    const pe = parseTime(e);
    if (!ps || !pe) { setErr('Type times like 7:00 AM and 9:30 PM.'); return; }
    savingRef.current = true;
    setSaving(true);
    setErr(null);
    try {
      const res = await setHours({ start: ps, end: pe });
      if (res.ok) onClose();
      else setErr(res.error || "Couldn't save the hours.");
    } catch {
      setErr("Couldn't save the hours.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Shop hours">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
        <View style={styles.presets}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.label}
              onPress={() => { setS(formatHHMM(p.start)); setE(formatHHMM(p.end)); setErr(null); }}
              accessibilityRole="button"
              style={styles.preset}
            >
              <Text style={[font.small, { color: color.text, fontWeight: '800' }]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[font.label, { color: color.textMuted }]}>OPENS</Text>
            <TextInput value={s} onChangeText={(t) => { setS(t); setErr(null); }} placeholder="7:00 AM" placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel="Opening time" />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[font.label, { color: color.textMuted }]}>CLOSES</Text>
            <TextInput value={e} onChangeText={(t) => { setE(t); setErr(null); }} placeholder="9:30 PM" placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel="Closing time" />
          </View>
        </View>
        <Text style={[font.small, { color: color.textMuted }]}>Same open and close time = open all day. Outside these hours customers can't order even if the switch is ON.</Text>
        {weekly ? (
          <Text style={[font.small, { color: color.warning, fontWeight: '700' }]}>
            ZENV set different hours for some days. Saving here uses these same hours every day.
          </Text>
        ) : null}
        {err ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700' }]}>{err}</Text> : null}
        <Button label="SAVE HOURS" onPress={save} loading={saving} />
      </ScrollView>
    </Sheet>
  );
}

export default function ShopScreen() {
  const { orders, refreshing, refreshOrders, ordersError, ordersLoaded, restaurant } = useStore();
  const toggle = useOpenToggle();
  const [hoursOpen, setHoursOpen] = useState(false);
  const hours = toggle.store?.operatingHours || restaurant.operatingHours || null;
  const allDay = !hours?.start || !hours?.end || hours.start === hours.end;
  const line = shopLine(toggle.store);

  const s = useMemo(() => {
    const t = todayNumbers(orders);
    const days: { key: string; orders: number; cash: number }[] = [];
    const now = Date.now();
    for (let i = 6; i >= 0; i--) days.push({ key: istDayKey(now - i * 86400000), orders: 0, cash: 0 });
    for (const o of orders) {
      if (!o.createdAt || o.status === 'Cancelled') continue;
      const d = days.find((x) => x.key === istDayKey(o.createdAt as string));
      if (d) d.orders += 1;
      // Cash on the day it was collected (same rule as today's tile).
      const paidOn = o.status === 'Delivered' && o.isCOD ? deliveredDay(o) : null;
      const c = paidOn ? days.find((x) => x.key === istDayKey(paidOn)) : null;
      if (c) c.cash += o.finalPrice;
    }
    return { ...t, days, maxDay: Math.max(1, ...days.map((d) => d.orders)) };
  }, [orders]);
  const todayKey = todayIST();

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xxl * 2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshOrders({ pull: true })} colors={[color.text]} />}
    >
      {/* Big open / close */}
      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ionicons name="storefront" size={30} color={toggle.live ? color.openDark : color.closed} />
          <View style={{ flex: 1 }}>
            <Text style={[font.h2, { color: color.text }]}>{toggle.paused ? 'Paused' : toggle.live ? 'Shop is OPEN' : toggle.on ? 'Open switch on · Closed now' : 'Shop is CLOSED'}</Text>
            <Text style={[font.small, { color: line.tint, fontWeight: '800' }]}>{line.text}</Text>
          </View>
        </View>
        <Button
          label={toggle.on ? 'CLOSE SHOP' : 'OPEN SHOP'}
          icon={toggle.on ? 'moon' : 'sunny'}
          variant={toggle.on ? 'rejectOutline' : 'accept'}
          size="huge"
          onPress={toggle.press}
          loading={toggle.saving}
          disabled={!toggle.store && !toggle.storeError}
        />
      </Card>

      {/* Hours */}
      <Card style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ionicons name="time-outline" size={24} color={color.text} />
          <View style={{ flex: 1 }}>
            <Text style={[font.label, { color: color.textMuted }]}>HOURS</Text>
            <Text style={[font.h3, { color: color.text }]}>{allDay ? 'Open all day' : `${formatHHMM(hours?.start)} – ${formatHHMM(hours?.end)}`}</Text>
          </View>
          <Button label="Change" variant="secondary" size="secondary" icon="pencil" onPress={() => setHoursOpen(true)} />
        </View>
      </Card>

      {ordersError ? <ErrorStrip text={ordersError} onRetry={() => refreshOrders({ pull: true })} busy={refreshing} /> : null}
      <Text style={[font.h2, { color: color.text }]}>Today</Text>
      {!ordersLoaded ? <Text style={[font.body, { color: color.textMuted }]}>Loading…</Text> : null}
      <View style={styles.grid}>
        <Tile label="Cash collected" value={rupees(s.cashCollected)} caption={`From ${s.delivered} delivered order${s.delivered === 1 ? '' : 's'}`} tint={color.openDark} />
        <Tile label="Orders" value={String(s.orders)} caption={s.inProgress ? `${s.inProgress} still running` : 'Not counting cancelled'} />
      </View>
      <View style={styles.grid}>
        <Tile label="Cash on the way" value={rupees(s.cashOnTheWay)} caption="Out for delivery, not collected yet" tint={color.cash} />
        <Tile
          label="Cancelled"
          value={String(s.cancelled)}
          caption={s.missed ? `${s.missed} not accepted in time` : 'Rejected or cancelled'}
          tint={s.cancelled ? color.alert : undefined}
        />
      </View>

      <Card style={{ gap: space.sm }}>
        <Text style={[font.h3, { color: color.text }]}>Last 7 days</Text>
        {s.days.map((d) => (
          <View key={d.key} style={styles.dayRow} accessibilityLabel={`${dayLabel(d.key)}: ${d.orders} orders, ${rupees(d.cash)} cash`}>
            <Text style={[font.small, { color: color.text, width: 64, fontWeight: d.key === todayKey ? '800' : '500' }]}>
              {d.key === todayKey ? 'Today' : dayLabel(d.key)}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { width: `${(d.orders / s.maxDay) * 100}%` }]} />
            </View>
            <Text style={[font.small, { color: color.text, width: 100, textAlign: 'right' }]}>{d.orders} · {rupees(Math.round(d.cash))}</Text>
          </View>
        ))}
        <Text style={[font.small, { color: color.textMuted }]}>Orders (not cancelled) by the day placed · cash by the day collected. From your latest 200 orders.</Text>
      </Card>

      {toggle.sheets}
      {hoursOpen ? (
        <HoursSheet visible onClose={() => setHoursOpen(false)} start={hours?.start} end={hours?.end} weekly={!!hours?.weekly} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: space.md },
  tile: { flex: 1, gap: 4 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 28 },
  barTrack: { flex: 1, height: 12, backgroundColor: color.surfaceAlt, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 12, backgroundColor: color.open, borderRadius: radius.pill },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  preset: {
    minHeight: touch.min, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 2, borderColor: color.border,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center',
  },
  input: {
    ...font.h3, color: color.text, backgroundColor: color.surface, borderWidth: 2, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: touch.secondary + 4,
  },
});
