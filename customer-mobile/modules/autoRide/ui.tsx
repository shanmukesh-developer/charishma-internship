/**
 * Zenvy Auto UI kit: the blue Rides look shared with Co-Ride (white cards with a soft shadow on a light
 * grey page, light-first, dark supported). Same component names and props the Auto screens always used
 * (Card, Btn, Badge, Chips, StateView, Row, Notice, Field, Stepper...), plus the Auto pieces: header,
 * availability chip, verified badge, ticking clock, live-update hook and the feature-flag hook.
 * Emoji that older call sites pass as icons are dropped here, so every screen reads calm and consistent.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppActive } from '../../utils/useAppActive';
import {
  View, Text, StyleSheet, Platform, ActivityIndicator, ScrollView, TextInput,
  type StyleProp, type ViewStyle, type TextInputProps,
} from 'react-native';
import { PressScale, StateCard, SkeletonList } from '../others/motion';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useDietLight } from '../../components/local/dietLightTheme';
import { mixHex } from '../../utils/themeNow';
import { ACCENTS, SURFACE, shadow as othersShadow } from '../others/othersTheme';
import { connectSocket } from '../../utils/socket';
import { readCache, writeCache } from '../../utils/swrCache';
import { serverNow } from '../../utils/serverClock';
import { autoRideApi, availabilityChip, type PaymentMethod, type PublicSettings, type TripStatusBlock } from './autoRideApi';

export const AUTO_YELLOW = '#FACC15';
export const AUTO_GREEN = '#16A34A';
export const AUTO_HOME = '/(tabs)/services?tab=coride&sub=auto';

// ── Palette ──────────────────────────────────────────────────────────────────

export const usePalette = () => {
  const { isDark, colors } = useTheme();
  // Owner, 10 Nov 2026: one look - the diet page and accent (red Non-veg / green Veg) replace the old blue.
  const d = useDietLight();
  return useMemo(() => ({
    isDark,
    bg: d.page,
    card: isDark ? SURFACE.dark.card : SURFACE.light.card,
    card2: isDark ? '#1F1F24' : d.sel,
    text: colors.text,
    sub: colors.textSecondary,
    muted: colors.textMuted,
    border: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)',
    input: isDark ? '#1F1F24' : '#F6F7F9',
    inputBorder: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.10)',
    accent: isDark ? ACCENTS.auto.ink.dark : ACCENTS.auto.ink.light,
    button: ACCENTS.auto.solid,
    /** Hero gradient (white text on it). */
    grad: [ACCENTS.auto.deep, ACCENTS.auto.solid] as [string, string],
    /** Header band and its dark ink. */
    band: d.top,
    bandInk: d.dk,
    accentSoft: isDark ? ACCENTS.auto.tint.dark : ACCENTS.auto.tint.light,
    danger: isDark ? '#F87171' : '#DC2626',
    dangerSoft: isDark ? 'rgba(248,113,113,0.14)' : '#FEECEC',
    success: isDark ? '#34D399' : '#047857',
    successSoft: isDark ? 'rgba(16,185,129,0.14)' : '#E8F6EF',
    warn: isDark ? '#FBBF24' : '#B45309',
    warnSoft: isDark ? 'rgba(245,158,11,0.14)' : '#FDF4E3',
    shadow: othersShadow(isDark),
  }), [isDark, colors, d]);
};
export type Palette = ReturnType<typeof usePalette>;

// ── Text helpers ─────────────────────────────────────────────────────────────

const LEAD_EMOJI = /^(?:(?:[←-⯿☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF])[️‍]*\s*)+/;
/** "🎫 My booking" -> "My booking" (older call sites prefix labels with emoji). */
export const plain = (s: string) => String(s ?? '').replace(LEAD_EMOJI, '');
/** "SEAT BOOKING OPEN" -> "Seat booking open"; mixed case is kept. */
const calm = (s: string) => {
  const t = plain(s);
  return t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};
const stripChildren = (children: React.ReactNode): React.ReactNode => {
  const arr = React.Children.toArray(children);
  if (arr.length && typeof arr[0] === 'string') arr[0] = plain(arr[0] as string);
  return arr;
};
const isIon = (icon?: string | null): icon is keyof typeof Ionicons.glyphMap => !!icon && Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, icon);

// ── Building blocks ──────────────────────────────────────────────────────────

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[s.card, { backgroundColor: p.card }, p.shadow, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={s.sectionRow}>
      <Text style={[s.section, { color: p.text }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  const p = usePalette();
  return (
    <View style={[s.badge, { backgroundColor: `${color}${p.isDark ? '2E' : '1A'}` }]}>
      <Text style={[s.badgeText, { color: p.isDark ? lighten(color) : color }]} numberOfLines={1}>{calm(label)}</Text>
    </View>
  );
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export function Btn({ label, onPress, kind = 'primary', loading, disabled, style, icon, small }: {
  label: string; onPress?: () => void; kind?: BtnKind; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; icon?: string; small?: boolean;
}) {
  const p = usePalette();
  const off = disabled || loading;
  const solid = kind === 'primary' || kind === 'danger' || kind === 'success';
  const bg = kind === 'primary' ? p.button : kind === 'danger' ? p.danger : kind === 'success' ? AUTO_GREEN : kind === 'secondary' ? p.card : 'transparent';
  const fg = solid ? '#FFFFFF' : p.accent;
  const bc = kind === 'secondary' ? p.border : kind === 'ghost' ? p.accent : 'transparent';
  const text = plain(label);
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={[s.btn, { minHeight: small ? 40 : 52, paddingHorizontal: small ? 14 : 18, backgroundColor: bg, borderColor: bc, opacity: off ? 0.5 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {isIon(icon) ? <Ionicons name={icon} size={small ? 15 : 18} color={fg} /> : null}
          <Text style={[s.btnText, { fontSize: small ? 13 : 15, color: kind === 'secondary' ? p.text : fg }]} numberOfLines={1}>{text}</Text>
        </>
      )}
    </PressScale>
  );
}

export function Field({ label, hint, error, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const p = usePalette();
  return (
    <View style={[{ marginBottom: 14 }, style as any]}>
      <Text style={[s.label, { color: p.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={p.muted}
        {...props}
        style={[s.input, { color: p.text, backgroundColor: p.input, borderColor: error ? p.danger : p.inputBorder }, props.multiline ? { minHeight: 88, textAlignVertical: 'top' } : null]}
      />
      {error ? <Text style={[s.hint, { color: p.danger }]}>{error}</Text> : hint ? <Text style={[s.hint, { color: p.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange, multi, wrap = true }: {
  options: { key: T; label: string; hint?: string }[]; value: T | T[] | null; onChange: (v: any) => void; multi?: boolean; wrap?: boolean;
}) {
  const p = usePalette();
  const isOn = (k: T) => (Array.isArray(value) ? value.includes(k) : value === k);
  const press = (k: T) => {
    if (multi) {
      const arr = Array.isArray(value) ? value : [];
      onChange(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
    } else onChange(k);
  };
  const body = options.map((o) => {
    const on = isOn(o.key);
    return (
      <PressScale key={o.key} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }} accessibilityLabel={plain(o.label)} onPress={() => press(o.key)}
        style={[s.chip, { backgroundColor: on ? p.button : p.card, borderColor: on ? p.button : p.border }]}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: on ? '#FFFFFF' : p.text }} numberOfLines={1}>{plain(o.label)}</Text>
        {o.hint ? <Text style={{ fontSize: 11, color: on ? 'rgba(255,255,255,0.85)' : p.muted, marginTop: 1 }} numberOfLines={1}>{o.hint}</Text> : null}
      </PressScale>
    );
  });
  if (!wrap) return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>{body}</ScrollView>;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{body}</View>;
}

/** Pill tabs (blue fill on the selected one), like the Rides reference. */
export function Tabs<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const p = usePalette();
  return (
    <View style={[s.tabs, { backgroundColor: p.card, borderColor: p.border }]} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <PressScale key={o.key} onPress={() => onChange(o.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            style={[s.tab, on && { backgroundColor: p.button }]}>
            <Text style={{ fontSize: 13, fontWeight: on ? '700' : '600', color: on ? '#FFFFFF' : p.sub }} numberOfLines={1}>{o.label}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const p = usePalette();
  return (
    <PressScale accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={[s.toggleRow, { backgroundColor: p.card2 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: p.text }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 12, color: p.muted, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <View style={[s.track, { backgroundColor: value ? p.button : p.isDark ? '#3F3F46' : '#CBD5E1' }]}>
        <View style={[s.knob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </PressScale>
  );
}

export function StateView({ kind, title, message, actionLabel, onAction, icon }: {
  kind: 'loading' | 'empty' | 'error'; title?: string; message?: string; actionLabel?: string; onAction?: () => void; icon?: string;
}) {
  if (kind === 'loading') return <SkeletonList count={3} height={132} style={{ marginBottom: 12 }} />;
  const t = plain(title || '');
  const offline = /offline/i.test(t);
  const off = /not open yet/i.test(t);
  const auto = icon === '🛺';
  return (
    <StateCard
      section="auto"
      kind={off ? 'off' : offline ? 'offline' : kind === 'error' ? 'error' : 'empty'}
      icon={auto ? 'rickshaw' : isIon(icon) ? icon : undefined}
      mci={auto}
      title={offline ? 'You are offline' : t || (kind === 'error' ? 'Something went wrong' : 'Nothing here yet')}
      message={offline ? 'Check your internet connection and try again.' : message ? plain(message) : undefined}
      actionLabel={actionLabel}
      onAction={onAction}
    />
  );
}

export function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  const p = usePalette();
  return (
    <View style={s.kv}>
      <Text style={{ fontSize: 13, color: p.sub, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? '800' : '700', color: p.text, textAlign: 'right', flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'success'; children: React.ReactNode }) {
  const p = usePalette();
  const map = {
    info: [p.accentSoft, p.accent, 'information-circle-outline'],
    warn: [p.warnSoft, p.warn, 'alert-circle-outline'],
    danger: [p.dangerSoft, p.danger, 'warning-outline'],
    success: [p.successSoft, p.success, 'checkmark-circle-outline'],
  } as const;
  const [bg, fg, icon] = map[tone];
  return (
    <View style={[s.notice, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={18} color={fg} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: p.text, fontSize: 13, lineHeight: 19 }}>{stripChildren(children)}</Text>
    </View>
  );
}

// ── Auto pieces ──────────────────────────────────────────────────────────────

export function AHeader({ title, subtitle, right, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void }) {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.header, { backgroundColor: p.band, paddingTop: Math.max(insets.top, 12) + 4 }]}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace(AUTO_HOME as any)))}
        style={s.backBtn}
      >
        <Ionicons name="chevron-back" size={24} color={p.bandInk} />
      </PressScale>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.hTitle, { color: p.bandInk }]} numberOfLines={1}>{plain(title)}</Text>
        {subtitle ? <Text style={[s.hSub, { color: p.sub }]} numberOfLines={1}>{plain(subtitle)}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Availability chip: colour + dot + words (never colour alone). */
export function StatusChip({ trip, now }: { trip: Pick<TripStatusBlock, 'availability' | 'availabilityLabel' | 'delayMinutes' | 'departureAt' | 'remainingSeats'>; now?: number }) {
  const p = usePalette();
  const c = availabilityChip(trip, now);
  const fg = p.isDark ? lighten(c.color) : c.color;
  return (
    <View style={[s.chipStatus, { backgroundColor: `${c.color}${p.isDark ? '2E' : '1A'}` }]} accessibilityLabel={c.label}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: fg }} />
      <Text style={{ fontSize: 12, fontWeight: '700', color: fg }} numberOfLines={1}>{calm(c.label)}</Text>
    </View>
  );
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  const p = usePalette();
  if (!verified) return null;
  return (
    <View style={[s.verified, { backgroundColor: p.accentSoft }]} accessibilityLabel="Verified ZenWe Auto driver">
      <Ionicons name="shield-checkmark" size={12} color={p.accent} />
      <Text style={{ fontSize: 11, fontWeight: '800', color: p.accent }}>Verified</Text>
    </View>
  );
}

/** − n + counter with large touch targets. */
export function Stepper({ value, min = 1, max, onChange, label }: { value: number; min?: number; max: number; onChange: (n: number) => void; label: string }) {
  const p = usePalette();
  const btn = (icon: 'remove' | 'add', next: number, disabled: boolean, a11y: string) => (
    <PressScale accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onChange(next)}
      style={[s.stepBtn, { backgroundColor: icon === 'add' ? p.accentSoft : p.card2, opacity: disabled ? 0.4 : 1 }]}>
      <Ionicons name={icon} size={22} color={icon === 'add' ? p.accent : p.text} />
    </PressScale>
  );
  return (
    <View style={s.stepRow} accessibilityRole="adjustable" accessibilityLabel={`${label}: ${value}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
        if (e.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
      }}>
      {btn('remove', value - 1, value <= min, `Fewer ${label.toLowerCase()}`)}
      <View style={{ minWidth: 72, alignItems: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: p.text }}>{value}</Text>
        <Text style={{ fontSize: 12, color: p.muted, fontWeight: '600' }}>{label}</Text>
      </View>
      {btn('add', value + 1, value >= max, `More ${label.toLowerCase()}`)}
    </View>
  );
}

/** Rickshaw on a soft yellow tile (the auto's "photo" on cards). */
export function AutoTile({ size = 56 }: { size?: number }) {
  const p = usePalette();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: p.isDark ? 'rgba(250,204,21,0.16)' : '#FEF6D3', alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name="rickshaw" size={size * 0.56} color={p.isDark ? '#FDE68A' : '#A16207'} />
    </View>
  );
}

/** Re-renders every `ms` (countdowns). */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => serverNow());
  // Paused while the app is in the background (no 1 s re-renders nobody sees); jumps to the current
  // time as soon as the app is back.
  const appActive = useAppActive();
  useEffect(() => {
    if (!enabled || !appActive) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms, enabled, appActive]);
  return now;
}

/**
 * Calls `onChange` when the server nudges this passenger (`autoride:changed` {kind, id, status} in the
 * user's own room), when any trip's public listing changed (`data:changed` type 'auto_trip'), and after a
 * reconnect. Payloads are ids only; screens refetch through REST.
 */
const RECONNECT_REFETCH_MS = 15000;

export function useAutoRideLive(onChange: (e: { kind?: string; id?: string | null; status?: string }) => void, enabled = true) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    let socket: ReturnType<typeof connectSocket>;
    try { socket = connectSocket(); } catch { return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: any = {};
    let lastRank = -1;
    // One call per window with its most important event: reconnect (2) over the student's own update (1) over a
    // public change (0); keeping only the latest let a public change hide the student's own update (31 Oct 2026).
    const fire = (e: any, rank: number) => {
      if (rank >= lastRank) { last = e || {}; lastRank = rank; }
      if (timer) return;
      timer = setTimeout(() => { timer = null; const ev = last; lastRank = -1; try { ref.current(ev); } catch { /* screen gone */ } }, 350);
    };
    const onAuto = (e: any) => fire(e && typeof e === 'object' ? e : {}, 1);
    const onData = (e: any) => { if (e && e.type === 'auto_trip') fire({ kind: 'trip', id: e.id }, 0); };
    let connectedOnce = socket.connected;
    // A flapping connection (bad network, proxy without websockets) reconnects every few seconds; refetching on
    // each one sent hundreds of requests. Catch up at most once per RECONNECT_REFETCH_MS; real nudges are not limited.
    let lastReconnectFire = 0;
    const onConnect = () => {
      const now = Date.now();
      if (connectedOnce && now - lastReconnectFire >= RECONNECT_REFETCH_MS) {
        lastReconnectFire = now;
        fire({ kind: 'reconnect' }, 2);
      }
      connectedOnce = true;
    };
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

/** Fetches GET /api/auto-ride/status once per app session (cached); an error keeps the cached status, or hides Auto. */
export function useAutoRideStatus(enabled = true) {
  const [data, setData] = useState<StatusData | null>(statusMem);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    if (!statusMem) readCache<StatusData>(STATUS_CACHE_KEY).then((c) => { if (alive && c && c.data && !statusMem) setData(c.data); });
    if (!statusFetch) {
      statusFetch = autoRideApi.status()
        .then((r) => { const v = { enabled: !!r.enabled, paymentMethods: Array.isArray(r.paymentMethods) ? r.paymentMethods : [], settings: r.settings || null }; statusMem = v; writeCache(STATUS_CACHE_KEY, v); return v; })
        // Offline or a server error: keep the last known status (an open Auto must not turn into 'Soon'),
        // and leave statusMem empty so the next screen asks again. No cache at all = hidden.
        .catch(async () => {
          statusFetch = null;
          const c = await readCache<StatusData>(STATUS_CACHE_KEY).catch(() => null);
          return c && c.data ? c.data : { enabled: false, paymentMethods: [] as PaymentMethod[] };
        });
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

export function AutoHero({ title, subtitle, kicker = 'ZenWe Auto · verified drivers' }: { title: string; subtitle: string; kicker?: string }) {
  const p = usePalette();
  return (
    <LinearGradient colors={p.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>{kicker}</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 4 }}>{title}</Text>
      <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 5, lineHeight: 18 }}>{subtitle}</Text>
    </LinearGradient>
  );
}

/** Lighter tone of a status colour for dark surfaces. */
export const lighten = (hex: string) => {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
};

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingBottom: 10 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '800' },
  hSub: { fontSize: 12, marginTop: 1 },
  card: { borderRadius: 18, padding: 16, marginBottom: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 10 },
  section: { fontSize: 17, fontWeight: '800' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  btn: { borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnText: { fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: 15 },
  hint: { fontSize: 12, marginTop: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 38, justifyContent: 'center', alignItems: 'center' },
  tabs: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 4, gap: 4 },
  // Width follows the label (equal widths cut "On charge" / "My bookings" to "On char…" on a 360 px phone).
  tab: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 12, marginBottom: 12 },
  track: { width: 42, height: 24, borderRadius: 12, padding: 3, justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  stateCard: { alignItems: 'center', borderRadius: 18, paddingVertical: 28, paddingHorizontal: 24, marginBottom: 12 },
  stateIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, gap: 12 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 12, marginBottom: 12 },
  chipStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, alignSelf: 'flex-start', maxWidth: '100%' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  stepBtn: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: 22, padding: 18, marginBottom: 12 },
});
