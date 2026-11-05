/**
 * Shared building blocks for the Rentals screens: header, cards, buttons, chips, inputs, loading /
 * empty / error states, star ratings, an in-app date + time picker (no extra native module) and the
 * live-update hook. Colours come from ThemeContext so light and dark mode match the rest of Zenvy.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, StyleSheet, Platform,
  type TextInputProps, type ViewStyle, type StyleProp,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { connectSocket } from '../../utils/socket';
import { istDate, istDayLabel, fmtTime } from './rentalsApi';

/** Shown when a vehicle photo cannot load (never the food fallback). */
export const VEHICLE_FALLBACK = 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=600&q=70';
export const ACCENT = '#0EA5E9';
export const ACCENT_DARK = '#0284C7';
export const GRAD: [string, string] = ['#0EA5E9', '#6366F1'];

/**
 * `icon` props accept an Ionicons glyph name ('car-outline'); older callers may still pass an emoji
 * string, which keeps rendering as text so nothing breaks.
 */
export const isIoniconName = (icon?: string | null): icon is keyof typeof Ionicons.glyphMap =>
  typeof icon === 'string' && /^[a-z0-9-]+$/.test(icon) && Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, icon);

/** An Ionicons glyph by name (falls back to nothing for an unknown name). */
export function RIcon({ name, size = 18, color }: { name: string; size?: number; color: string }) {
  if (!isIoniconName(name)) return null;
  return <Ionicons name={name} size={size} color={color} />;
}

export const usePalette = () => {
  const { isDark, colors } = useTheme();
  return useMemo(() => ({
    isDark,
    bg: colors.bg,
    card: colors.card,
    card2: isDark ? '#1F1F23' : '#F4F6FA',
    text: colors.text,
    sub: colors.textSecondary,
    muted: colors.textMuted,
    border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)',
    input: colors.inputBg,
    inputBorder: colors.inputBorder,
    accent: ACCENT,
    accentSoft: isDark ? 'rgba(14,165,233,0.16)' : '#E0F2FE',
    danger: '#EF4444',
    dangerSoft: isDark ? 'rgba(239,68,68,0.15)' : '#FEE2E2',
    success: '#10B981',
    successSoft: isDark ? 'rgba(16,185,129,0.15)' : '#D1FAE5',
    warn: '#F59E0B',
    warnSoft: isDark ? 'rgba(245,158,11,0.15)' : '#FEF3C7',
  }), [isDark, colors]);
};
export type Palette = ReturnType<typeof usePalette>;

export function RHeader({ title, subtitle, right, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <View style={[st.header, { borderBottomColor: p.border, backgroundColor: p.bg }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/services?tab=rentals' as any)))}
        style={[st.backBtn, { backgroundColor: p.card2 }]}
      >
        <Ionicons name="chevron-back" size={20} color={p.text} />
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.hTitle, { color: p.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[st.hSub, { color: p.sub }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[st.card, { backgroundColor: p.card, borderColor: p.border }, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={st.sectionRow}>
      <Text style={[st.section, { color: p.text }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[st.badge, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
      <Text style={[st.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export function Btn({ label, onPress, kind = 'primary', loading, disabled, style, icon, small }: {
  label: string; onPress?: () => void; kind?: BtnKind; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; icon?: string; small?: boolean;
}) {
  const p = usePalette();
  const off = disabled || loading;
  const pad = small ? { paddingVertical: 9, paddingHorizontal: 14 } : { paddingVertical: 14, paddingHorizontal: 18 };
  const fg = kind === 'primary' || kind === 'danger' || kind === 'success' ? '#fff' : kind === 'ghost' ? p.accent : p.text;
  const ion = isIoniconName(icon);
  const content = loading
    ? <ActivityIndicator color={kind === 'primary' || kind === 'danger' || kind === 'success' ? '#fff' : p.accent} />
    : (
      <>
        {ion ? <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={small ? 14 : 16} color={fg} style={{ marginRight: 6 }} /> : null}
        <Text style={[st.btnText, { fontSize: small ? 12 : 14, color: fg }]}>{icon && !ion ? `${icon}  ` : ''}{label}</Text>
      </>
    );
  if (kind === 'primary') {
    return (
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={off} onPress={onPress} activeOpacity={0.85} style={[{ opacity: off ? 0.55 : 1, borderRadius: 14, overflow: 'hidden' }, style]}>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.btn, pad]}>{content}</LinearGradient>
      </TouchableOpacity>
    );
  }
  const bg = kind === 'danger' ? p.danger : kind === 'success' ? p.success : kind === 'secondary' ? p.card2 : 'transparent';
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={off} onPress={onPress} activeOpacity={0.85}
      style={[st.btn, pad, { backgroundColor: bg, borderWidth: kind === 'secondary' || kind === 'ghost' ? 1 : 0, borderColor: kind === 'ghost' ? p.accent : p.border, opacity: off ? 0.55 : 1 }, style]}>
      {content}
    </TouchableOpacity>
  );
}

export function Field({ label, hint, error, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const p = usePalette();
  return (
    <View style={[{ marginBottom: 14 }, style as any]}>
      <Text style={[st.label, { color: p.sub }]}>{label}</Text>
      <TextInput
        placeholderTextColor={p.muted}
        {...props}
        style={[st.input, { color: p.text, backgroundColor: p.input, borderColor: error ? p.danger : p.inputBorder }, props.multiline ? { minHeight: 84, textAlignVertical: 'top' } : null]}
      />
      {error ? <Text style={[st.hint, { color: p.danger }]}>{error}</Text> : hint ? <Text style={[st.hint, { color: p.muted }]}>{hint}</Text> : null}
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
      <TouchableOpacity key={o.key} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }} accessibilityLabel={o.label} onPress={() => press(o.key)}
        style={[st.chip, { backgroundColor: on ? p.accentSoft : p.card2, borderColor: on ? p.accent : p.border }]}>
        <Text style={{ fontSize: 12.5, fontWeight: '800', color: on ? p.accent : p.text }}>{o.label}</Text>
        {o.hint ? <Text style={{ fontSize: 12, color: p.muted, marginTop: 1 }}>{o.hint}</Text> : null}
      </TouchableOpacity>
    );
  });
  if (!wrap) return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>{body}</ScrollView>;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{body}</View>;
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const p = usePalette();
  return (
    <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={[st.toggleRow, { borderColor: p.border, backgroundColor: p.card2 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '800', color: p.text }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 12, color: p.muted, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <View style={[st.track, { backgroundColor: value ? p.success : p.isDark ? '#3F3F46' : '#CBD5E1' }]}>
        <View style={[st.knob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </TouchableOpacity>
  );
}

export function StateView({ kind, title, message, actionLabel, onAction, icon }: {
  kind: 'loading' | 'empty' | 'error'; title?: string; message?: string; actionLabel?: string; onAction?: () => void; icon?: string;
}) {
  const p = usePalette();
  if (kind === 'loading') {
    return <View style={st.state} accessibilityRole="progressbar"><ActivityIndicator color={p.accent} size="large" /><Text style={{ color: p.sub, marginTop: 10, fontSize: 12 }}>{message || 'Loading…'}</Text></View>;
  }
  return (
    <View style={st.state}>
      {icon && !isIoniconName(icon)
        ? <Text style={{ fontSize: 40, marginBottom: 8 }}>{icon}</Text>
        : <Ionicons name={(icon as keyof typeof Ionicons.glyphMap) || (kind === 'error' ? 'alert-circle-outline' : 'bicycle-outline')} size={44} color={kind === 'error' ? p.danger : p.accent} style={{ marginBottom: 8 }} />}
      {title ? <Text style={{ fontSize: 16, fontWeight: '900', color: p.text, textAlign: 'center' }}>{title}</Text> : null}
      {message ? <Text style={{ fontSize: 12.5, color: p.sub, textAlign: 'center', marginTop: 6, lineHeight: 18 }}>{message}</Text> : null}
      {actionLabel && onAction ? <Btn label={actionLabel} onPress={onAction} small style={{ marginTop: 14 }} kind={kind === 'error' ? 'secondary' : 'primary'} /> : null}
    </View>
  );
}

export function Stars({ value, size = 13, onChange }: { value: number; size?: number; onChange?: (n: number) => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: onChange ? 8 : 1 }} accessibilityRole={onChange ? 'adjustable' : 'text'} accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Text key={n} onPress={onChange ? () => onChange(n) : undefined} style={{ fontSize: size, color: n <= Math.round(value) ? '#F59E0B' : p.muted }}>★</Text>
      ))}
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  const p = usePalette();
  return (
    <View style={st.kv}>
      <Text style={{ fontSize: 12.5, color: p.sub, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: strong ? 15 : 13, fontWeight: strong ? '900' : '700', color: p.text, textAlign: 'right', flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'success'; children: React.ReactNode }) {
  const p = usePalette();
  const map = { info: [p.accentSoft, p.accent], warn: [p.warnSoft, p.warn], danger: [p.dangerSoft, p.danger], success: [p.successSoft, p.success] } as const;
  const [bg, fg] = map[tone];
  return <View style={[st.notice, { backgroundColor: bg, borderColor: `${fg}55` }]}><Text style={{ color: p.text, fontSize: 12.5, lineHeight: 18 }}>{children}</Text></View>;
}

// ── Date + time picker (chips) ──────────────────────────────────────────────
export const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 30]) out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  return out;
})();

export function DateTimeSelect({ label, date, time, onChange, days = 30, minDate }: {
  label: string; date: string; time: string; onChange: (v: { date: string; time: string }) => void; days?: number; minDate?: string;
}) {
  const p = usePalette();
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => istDate(i)).filter((d) => !minDate || d >= minDate), [days, minDate]);
  const timeRef = useRef<ScrollView>(null);
  useEffect(() => {
    const idx = TIME_SLOTS.indexOf(time);
    if (idx > 0) setTimeout(() => timeRef.current?.scrollTo({ x: Math.max(0, idx * 74 - 80), animated: false }), 50);
  }, [time]);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[st.label, { color: p.sub }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
        {dates.map((d) => {
          const on = d === date;
          return (
            <TouchableOpacity key={d} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={istDayLabel(d)} onPress={() => onChange({ date: d, time })}
              style={[st.dateChip, { backgroundColor: on ? p.accent : p.card2, borderColor: on ? p.accent : p.border }]}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: on ? '#fff' : p.text }}>{istDayLabel(d)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <ScrollView ref={timeRef} horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6, paddingRight: 16 }}>
        {TIME_SLOTS.map((t) => {
          const on = t === time;
          return (
            <TouchableOpacity key={t} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={fmtTime(t)} onPress={() => onChange({ date, time: t })}
              style={[st.timeChip, { backgroundColor: on ? p.accentSoft : 'transparent', borderColor: on ? p.accent : p.border }]}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: on ? p.accent : p.sub }}>{fmtTime(t)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Live updates ────────────────────────────────────────────────────────────
/**
 * Calls `onChange` when the server nudges this student about a rental (`rental:changed`, own room)
 * or a listing became visible / hidden (`data:changed` type 'rental'), and after a reconnect.
 * Payloads are ids only; screens refetch through REST.
 */
export function useRentalLive(onChange: (e: { kind?: string; id?: string | null; status?: string }) => void, enabled = true) {
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
    const onRental = (e: any) => fire(e && typeof e === 'object' ? e : {}, 1);
    const onData = (e: any) => { if (e && e.type === 'rental') fire({ kind: 'listing', id: e.id }, 0); };
    let connectedOnce = socket.connected;
    // Catch up after a reconnect at most once per 15 s: a flapping connection must not turn into a request storm.
    let lastReconnectFire = 0;
    const onConnect = () => {
      const now = Date.now();
      if (connectedOnce && now - lastReconnectFire >= 15000) { lastReconnectFire = now; fire({ kind: 'reconnect' }, 2); }
      connectedOnce = true;
    };
    socket.on('rental:changed', onRental);
    socket.on('data:changed', onData);
    socket.on('connect', onConnect);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off('rental:changed', onRental);
      socket.off('data:changed', onData);
      socket.off('connect', onConnect);
    };
  }, [enabled]);
}

export const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 44 : 54, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  hSub: { fontSize: 12, marginTop: 1 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 10 },
  section: { fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  btn: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnText: { fontWeight: '900', letterSpacing: 0.2 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 9, fontSize: 14 },
  hint: { fontSize: 12, marginTop: 4 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  track: { width: 42, height: 24, borderRadius: 12, padding: 3, justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  notice: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12 },
  dateChip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  timeChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, width: 68, alignItems: 'center' },
});
