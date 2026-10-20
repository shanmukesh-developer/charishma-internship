/**
 * Zenvy Auto-Ride UI kit. Reuses the Rentals building blocks (cards, buttons, chips, inputs, state views,
 * ThemeContext palette for light / dark) and adds the Auto-Ride pieces: header with a Co-Ride fallback,
 * availability chip, seat stepper, ticking clock, live-update hook and the feature-flag hook.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { connectSocket } from '../../utils/socket';
import { readCache, writeCache } from '../../utils/swrCache';
import { usePalette } from '../rentals/ui';
import { autoRideApi, availabilityChip, type PaymentMethod, type PublicSettings, type TripStatusBlock } from './autoRideApi';

export { usePalette, Card, SectionTitle, Badge, Btn, Field, Chips, StateView, Row, Notice, Toggle } from '../rentals/ui';
export type { Palette } from '../rentals/ui';

/** Auto-rickshaw yellow + Zenvy green: distinct from Rentals blue and the peer Co-Ride red. */
export const AUTO_YELLOW = '#FACC15';
export const AUTO_GREEN = '#16A34A';
export const AUTO_GRAD: [string, string] = ['#16A34A', '#0EA5E9'];
export const AUTO_HOME = '/(tabs)/others?tab=coride&sub=auto';

export function AHeader({ title, subtitle, right, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <View style={[s.header, { borderBottomColor: p.border, backgroundColor: p.bg }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace(AUTO_HOME as any)))}
        style={[s.backBtn, { backgroundColor: p.card2 }]}
      >
        <Text style={{ fontSize: 20, color: p.text, marginTop: -2 }}>‹</Text>
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.hTitle, { color: p.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[s.hSub, { color: p.sub }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Availability chip: colour + icon + words (never colour alone). */
export function StatusChip({ trip, now }: { trip: Pick<TripStatusBlock, 'availability' | 'availabilityLabel' | 'delayMinutes' | 'departureAt' | 'remainingSeats'>; now?: number }) {
  const c = availabilityChip(trip, now);
  return (
    <View style={[s.chip, { backgroundColor: `${c.color}1F`, borderColor: `${c.color}66` }]} accessibilityLabel={c.label}>
      <Text style={{ fontSize: 10.5 }}>{c.icon}</Text>
      <Text style={{ fontSize: 10.5, fontWeight: '900', color: c.color, letterSpacing: 0.2 }} numberOfLines={1}>{c.label}</Text>
    </View>
  );
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  const p = usePalette();
  if (!verified) return null;
  return (
    <View style={[s.verified, { backgroundColor: p.successSoft }]} accessibilityLabel="Verified Zenvy Auto driver">
      <Text style={{ fontSize: 9.5, fontWeight: '900', color: p.success }}>✔ VERIFIED</Text>
    </View>
  );
}

/** − n + stepper with large touch targets. */
export function Stepper({ value, min = 1, max, onChange, label }: { value: number; min?: number; max: number; onChange: (n: number) => void; label: string }) {
  const p = usePalette();
  const btn = (txt: string, next: number, disabled: boolean, a11y: string) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onChange(next)}
      style={[s.stepBtn, { backgroundColor: disabled ? p.card2 : p.accentSoft, borderColor: disabled ? p.border : p.accent, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={{ fontSize: 22, fontWeight: '900', color: disabled ? p.muted : p.accent }}>{txt}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={s.stepRow} accessibilityRole="adjustable" accessibilityLabel={`${label}: ${value}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
        if (e.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
      }}>
      {btn('−', value - 1, value <= min, `Fewer ${label.toLowerCase()}`)}
      <View style={{ minWidth: 64, alignItems: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: '900', color: p.text }}>{value}</Text>
        <Text style={{ fontSize: 10, color: p.muted, fontWeight: '800' }}>{label.toUpperCase()}</Text>
      </View>
      {btn('+', value + 1, value >= max, `More ${label.toLowerCase()}`)}
    </View>
  );
}

/** Re-renders every `ms` (countdowns). */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return now;
}

/**
 * Calls `onChange` when the server nudges this passenger (`autoride:changed` {kind, id, status} in the
 * user's own room), when any trip's public listing changed (`data:changed` type 'auto_trip'), and after a
 * reconnect. Payloads are ids only; screens refetch through REST.
 */
export function useAutoRideLive(onChange: (e: { kind?: string; id?: string | null; status?: string }) => void, enabled = true) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    let socket: ReturnType<typeof connectSocket>;
    try { socket = connectSocket(); } catch { return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: any = {};
    const fire = (e: any) => {
      last = e || {};
      if (timer) return;
      timer = setTimeout(() => { timer = null; try { ref.current(last); } catch { /* screen gone */ } }, 350);
    };
    const onAuto = (e: any) => fire(e && typeof e === 'object' ? e : {});
    const onData = (e: any) => { if (e && e.type === 'auto_trip') fire({ kind: 'trip', id: e.id }); };
    let connectedOnce = socket.connected;
    const onConnect = () => { if (connectedOnce) fire({ kind: 'reconnect' }); connectedOnce = true; };
    socket.on('autoride:changed', onAuto);
    socket.on('data:changed', onData);
    socket.on('connect', onConnect);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off('autoride:changed', onAuto);
      socket.off('data:changed', onData);
      socket.off('connect', onConnect);
    };
  }, [enabled]);
}

const STATUS_CACHE_KEY = 'autoride:status';
type StatusData = { enabled: boolean; paymentMethods: PaymentMethod[]; settings?: PublicSettings | null };
let statusMem: StatusData | null = null;
let statusFetch: Promise<StatusData> | null = null;

/** Fetches GET /api/auto-ride/status once per app session (cached); any error = hidden. */
export function useAutoRideStatus(enabled = true) {
  const [data, setData] = useState<StatusData | null>(statusMem);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    if (!statusMem) readCache<StatusData>(STATUS_CACHE_KEY).then((c) => { if (alive && c && c.data && !statusMem) setData(c.data); });
    if (!statusFetch) {
      statusFetch = autoRideApi.status()
        .then((r) => { const v = { enabled: !!r.enabled, paymentMethods: Array.isArray(r.paymentMethods) ? r.paymentMethods : [], settings: r.settings || null }; statusMem = v; writeCache(STATUS_CACHE_KEY, v); return v; })
        .catch(() => { statusFetch = null; const v = { enabled: false, paymentMethods: [] as PaymentMethod[] }; statusMem = v; return v; });
    }
    statusFetch.then((v) => { if (alive) setData(v); });
    return () => { alive = false; };
  }, [enabled]);
  return data;
}
/** Fresh status (checkout screens: the payment methods must be current). */
export const refreshAutoRideStatus = async () => {
  statusFetch = null;
  const r = await autoRideApi.status();
  statusMem = { enabled: !!r.enabled, paymentMethods: r.paymentMethods || [], settings: r.settings || null };
  writeCache(STATUS_CACHE_KEY, statusMem);
  return statusMem;
};

export function AutoHero({ title, subtitle, kicker = 'Zenvy Auto · verified drivers' }: { title: string; subtitle: string; kicker?: string }) {
  return (
    <LinearGradient colors={AUTO_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
      <Text style={{ fontSize: 9, fontWeight: '900', color: 'rgba(255,255,255,0.88)', letterSpacing: 1.5 }}>{kicker}</Text>
      <Text style={{ fontSize: 19, fontWeight: '900', color: '#fff', marginTop: 4, letterSpacing: -0.3 }}>{title}</Text>
      <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.92)', marginTop: 5, lineHeight: 17 }}>{subtitle}</Text>
    </LinearGradient>
  );
}

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 44 : 54, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  hSub: { fontSize: 11.5, marginTop: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, alignSelf: 'flex-start', maxWidth: '100%' },
  verified: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  stepBtn: { width: 52, height: 52, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: 22, padding: 16, marginBottom: 12 },
});
