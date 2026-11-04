/**
 * Zenvy Campus Events UI kit: header with an Others > Campus Events fallback, poster-led event cards,
 * status / price pills, buttons, inputs, chips, toggles, state views (loading / empty / error-retry /
 * offline) and the status hook that decides whether the Others chip exists. Colours come from
 * ThemeContext (light + dark) with a violet -> pink Campus Events accent; every pill pairs colour with
 * an icon and words, and every touch target is at least 44 px.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useAppActive } from '../../utils/useAppActive';
import {
  View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, StyleSheet, Platform,
  type TextInputProps, type ViewStyle, type StyleProp,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import SafeImage from '../../components/SafeImage';
import { useTheme } from '../../context/ThemeContext';
import { readCache, writeCache } from '../../utils/swrCache';
import {
  campusEventsApi, CATEGORY_META, REG_STATE_META, REG_STATUS_META, capacityLine, dateTile, fmtClock, fmtWhen,
  type EventCard as EventCardT, type RegStatus, type StatusResponse, type CeIconName,
} from './campusEventsApi';

export type { CeIconName };

export const CE_HOME = '/(tabs)/others?tab=events';
export const CE_GRAD: [string, string] = ['#7C3AED', '#DB2777'];

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
    // Violet: 5.7:1 on white; the lighter tint keeps >= 4.5:1 on the dark background.
    accent: isDark ? '#A78BFA' : '#7C3AED',
    accentSoft: isDark ? 'rgba(167,139,250,0.16)' : '#EDE9FE',
    danger: isDark ? '#F87171' : '#DC2626',
    dangerSoft: isDark ? 'rgba(239,68,68,0.15)' : '#FEE2E2',
    success: isDark ? '#34D399' : '#047857',
    successSoft: isDark ? 'rgba(16,185,129,0.15)' : '#D1FAE5',
    warn: isDark ? '#FBBF24' : '#B45309',
    warnSoft: isDark ? 'rgba(245,158,11,0.15)' : '#FEF3C7',
  }), [isDark, colors]);
};
export type Palette = ReturnType<typeof usePalette>;

/** Readable foreground for a status colour on the current theme. */
const tone = (color: string, isDark: boolean) => (isDark ? color : shade(color));
const shade = (hex: string) => {
  // Darken mid-tone status colours for light backgrounds (contrast >= 4.5:1 on their soft fill).
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.max(0, Math.round(v * 0.72));
  return `#${[f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

export function EHeader({ title, subtitle, right, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <View style={[st.header, { borderBottomColor: p.border, backgroundColor: p.bg }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace(CE_HOME as any)))}
        style={[st.backBtn, { backgroundColor: p.card2 }]}
      >
        <Ionicons name="chevron-back" size={22} color={p.text} />
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.hTitle, { color: p.text }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
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

export function SectionTitle({ children, right, kicker }: { children: React.ReactNode; right?: React.ReactNode; kicker?: string }) {
  const p = usePalette();
  return (
    <View style={st.sectionRow}>
      <View style={{ flex: 1 }}>
        {kicker ? <Text style={{ fontSize: 12, fontWeight: '800', color: p.accent, letterSpacing: 0.3 }}>{kicker}</Text> : null}
        <Text style={[st.section, { color: p.text }]} accessibilityRole="header">{children}</Text>
      </View>
      {right}
    </View>
  );
}

/** Pill: colour + optional icon + words. */
export function Pill({ label, color, icon, solid }: { label: string; color: string; icon?: CeIconName; solid?: boolean }) {
  const p = usePalette();
  const fg = solid ? '#fff' : tone(color, p.isDark);
  return (
    <View style={[st.pill, { backgroundColor: solid ? color : `${color}22`, borderColor: solid ? color : `${color}66` }]} accessibilityLabel={label}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text style={{ fontSize: 12, fontWeight: '900', color: fg, letterSpacing: 0.2 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function RegStatusPill({ status }: { status: RegStatus }) {
  const m = REG_STATUS_META[status];
  return <Pill label={m.label} color={m.color} icon={m.icon} />;
}

export function PricePill({ label, isFree }: { label: string; isFree: boolean }) {
  return isFree ? <Pill label="Free" color="#059669" solid /> : <Pill label={label} color="#7C3AED" solid />;
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export function Btn({ label, onPress, kind = 'primary', loading, disabled, style, icon, small, a11yHint }: {
  label: string; onPress?: () => void; kind?: BtnKind; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; icon?: CeIconName; small?: boolean; a11yHint?: string;
}) {
  const p = usePalette();
  const off = disabled || loading;
  const pad = small ? { minHeight: 44, paddingHorizontal: 14 } : { minHeight: 52, paddingHorizontal: 18 };
  const light = kind === 'primary' || kind === 'danger' || kind === 'success';
  const content = loading
    ? <ActivityIndicator color={light ? '#fff' : p.accent} />
    : (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={light ? '#fff' : kind === 'ghost' ? p.accent : p.text} /> : null}
        <Text style={[st.btnText, { fontSize: small ? 12.5 : 14.5, color: light ? '#fff' : kind === 'ghost' ? p.accent : p.text, flexShrink: 1 }]} numberOfLines={1}>{label}</Text>
      </View>
    );
  const a11y = { accessibilityRole: 'button' as const, accessibilityLabel: label, accessibilityHint: a11yHint, accessibilityState: { disabled: !!off, busy: !!loading } };
  if (kind === 'primary') {
    return (
      <TouchableOpacity {...a11y} disabled={off} onPress={onPress} activeOpacity={0.85} style={[{ opacity: off ? 0.5 : 1, borderRadius: 14, overflow: 'hidden' }, style]}>
        <LinearGradient colors={CE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.btn, pad]}>{content}</LinearGradient>
      </TouchableOpacity>
    );
  }
  const bg = kind === 'danger' ? '#DC2626' : kind === 'success' ? '#047857' : kind === 'secondary' ? p.card2 : 'transparent';
  return (
    <TouchableOpacity {...a11y} disabled={off} onPress={onPress} activeOpacity={0.85}
      style={[st.btn, pad, { backgroundColor: bg, borderWidth: kind === 'secondary' || kind === 'ghost' ? 1 : 0, borderColor: kind === 'ghost' ? p.accent : p.border, opacity: off ? 0.5 : 1 }, style]}>
      {content}
    </TouchableOpacity>
  );
}

export function Field({ label, hint, error, style, required, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null; required?: boolean }) {
  const p = usePalette();
  return (
    <View style={[{ marginBottom: 14 }, style as any]}>
      <Text style={[st.label, { color: p.sub }]}>{label}{required ? <Text style={{ color: p.danger }}> *</Text> : null}</Text>
      <TextInput
        placeholderTextColor={p.muted}
        accessibilityLabel={label}
        accessibilityHint={error || hint}
        {...props}
        style={[st.input, { color: p.text, backgroundColor: p.input, borderColor: error ? p.danger : p.inputBorder }, props.multiline ? { minHeight: 92, textAlignVertical: 'top' } : null]}
      />
      {error ? <Text style={[st.hint, { color: p.danger }]} accessibilityLiveRegion="polite">{error}</Text> : hint ? <Text style={[st.hint, { color: p.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange, multi, wrap = true, accessibilityLabel }: {
  options: { key: T; label: string; hint?: string }[]; value: T | T[] | null; onChange: (v: any) => void; multi?: boolean; wrap?: boolean; accessibilityLabel?: string;
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
      <TouchableOpacity key={o.key} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }} accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label} onPress={() => press(o.key)}
        style={[st.chip, { backgroundColor: on ? p.accentSoft : p.card2, borderColor: on ? p.accent : p.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {on && multi ? <Ionicons name="checkmark" size={14} color={p.accent} /> : null}
          <Text style={{ fontSize: 12.5, fontWeight: '800', color: on ? p.accent : p.text }}>{o.label}</Text>
        </View>
        {o.hint ? <Text style={{ fontSize: 12, color: p.muted, marginTop: 1 }}>{o.hint}</Text> : null}
      </TouchableOpacity>
    );
  });
  if (!wrap) return <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={accessibilityLabel} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>{body}</ScrollView>;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel={accessibilityLabel}>{body}</View>;
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const p = usePalette();
  return (
    <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} accessibilityHint={hint} onPress={() => onChange(!value)} style={[st.toggleRow, { borderColor: p.border, backgroundColor: p.card2 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '800', color: p.text }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 12, color: p.muted, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <View style={[st.track, { backgroundColor: value ? '#047857' : p.isDark ? '#3F3F46' : '#CBD5E1' }]}>
        <View style={[st.knob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </TouchableOpacity>
  );
}

/** Square checkbox row (rules acceptance, collect payment). */
export function CheckRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const p = usePalette();
  return (
    <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={[st.checkRow, { borderColor: value ? p.accent : p.border, backgroundColor: value ? p.accentSoft : p.card2 }]}>
      <View style={[st.box, { borderColor: value ? p.accent : p.muted, backgroundColor: value ? p.accent : 'transparent' }]}>
        {value ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '800', color: p.text }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 2, lineHeight: 16 }}>{hint}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export type StateKind = 'loading' | 'empty' | 'error' | 'offline';
export function StateView({ kind, title, message, actionLabel, onAction, icon }: {
  kind: StateKind; title?: string; message?: string; actionLabel?: string; onAction?: () => void; icon?: CeIconName;
}) {
  const p = usePalette();
  if (kind === 'loading') {
    return <View style={st.state} accessibilityRole="progressbar" accessibilityLabel={message || 'Loading'}><ActivityIndicator color={p.accent} size="large" /><Text style={{ color: p.sub, marginTop: 10, fontSize: 12.5 }}>{message || 'Loading…'}</Text></View>;
  }
  const ic: CeIconName = icon || (kind === 'offline' ? 'cloud-offline-outline' : kind === 'error' ? 'alert-circle-outline' : 'ticket-outline');
  return (
    <View style={st.state}>
      <Ionicons name={ic} size={44} color={kind === 'error' ? p.danger : p.accent} style={{ marginBottom: 8 }} />
      {title ? <Text style={{ fontSize: 16, fontWeight: '900', color: p.text, textAlign: 'center' }} accessibilityRole="header">{title}</Text> : null}
      {message ? <Text style={{ fontSize: 13, color: p.sub, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>{message}</Text> : null}
      {actionLabel && onAction ? <Btn label={actionLabel} onPress={onAction} small style={{ marginTop: 14 }} kind={kind === 'empty' ? 'primary' : 'secondary'} /> : null}
    </View>
  );
}

/** Error -> the right state view (offline vs not found vs generic) with Retry. */
export function ErrorState({ error, onRetry, notFoundTitle = 'Not found', onNotFound, notFoundLabel }: { error: any; onRetry: () => void; notFoundTitle?: string; onNotFound?: () => void; notFoundLabel?: string }) {
  if (error?.status === 404) return <StateView kind="empty" icon="search-outline" title={notFoundTitle} message={error.message} actionLabel={notFoundLabel || 'Back to Campus Events'} onAction={onNotFound} />;
  if (error?.code === 'FEATURE_OFF') return <StateView kind="empty" icon="ticket-outline" title="Campus Events is not open yet" message={error.message} actionLabel="Retry" onAction={onRetry} />;
  if (error?.code === 'NETWORK' || error?.code === 'SERVER_BUSY') return <StateView kind="offline" title="You seem to be offline" message={error.message} actionLabel="Retry" onAction={onRetry} />;
  return <StateView kind="error" title="Could not load" message={error?.message || 'Please try again.'} actionLabel="Retry" onAction={onRetry} />;
}

export function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  const p = usePalette();
  return (
    <View style={st.kv}>
      <Text style={{ fontSize: 12.5, color: p.sub, flexShrink: 0, maxWidth: '45%' }}>{label}</Text>
      <Text style={{ fontSize: strong ? 15 : 13, fontWeight: strong ? '900' : '700', color: p.text, textAlign: 'right', flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

export function Notice({ tone: tn = 'info', children, icon }: { tone?: 'info' | 'warn' | 'danger' | 'success'; children: React.ReactNode; icon?: CeIconName }) {
  const p = usePalette();
  const map = { info: [p.accentSoft, p.accent], warn: [p.warnSoft, p.warn], danger: [p.dangerSoft, p.danger], success: [p.successSoft, p.success] } as const;
  const [bg, fg] = map[tn];
  return (
    <View style={[st.notice, { backgroundColor: bg, borderColor: `${fg}55` }]} accessibilityRole={tn === 'danger' || tn === 'warn' ? 'alert' : undefined}>
      {icon ? <Ionicons name={icon} size={17} color={fg} style={{ marginRight: 8, marginTop: 1 }} /> : null}
      <Text style={{ color: p.text, fontSize: 12.5, lineHeight: 18, flex: 1 }}>{children}</Text>
    </View>
  );
}

/** Poster with a category-coloured gradient fallback (never a stock photo of something else). */
export function Poster({ uri, category, height, radius = 16, children }: { uri: string | null | undefined; category: keyof typeof CATEGORY_META; height: number; radius?: number; children?: React.ReactNode }) {
  const meta = CATEGORY_META[category] || CATEGORY_META.OTHER;
  const fallback = (
    <LinearGradient colors={[meta.color, '#1E1B4B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={meta.icon} size={Math.min(56, height / 3)} color="rgba(255,255,255,0.92)" />
    </LinearGradient>
  );
  return (
    <View style={{ height, borderTopLeftRadius: radius, borderTopRightRadius: radius, overflow: 'hidden', backgroundColor: meta.color }}>
      {uri ? <SafeImage source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" fallback={fallback} /> : fallback}
      {children}
    </View>
  );
}

function DateTile({ iso }: { iso: string | null }) {
  const t = dateTile(iso);
  if (!t) return null;
  return (
    <View style={st.dateTile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#7C3AED', letterSpacing: 0.2 }}>{t.dow}</Text>
      <Text style={{ fontSize: 18, fontWeight: '900', color: '#111827', lineHeight: 20 }}>{t.day}</Text>
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#4B5563', letterSpacing: 0.2 }}>{t.mon}</Text>
    </View>
  );
}

const cardA11y = (e: EventCardT) => {
  const cap = capacityLine(e);
  return [e.title, e.categoryLabel, e.organizer?.name, fmtWhen(e.startAt), e.venue, e.price.isFree ? 'Free' : e.price.label, REG_STATE_META[e.registrationState]?.label, cap, e.myStatus ? `You: ${REG_STATUS_META[e.myStatus].label}` : null]
    .filter(Boolean).join(', ');
};

/** Poster-led card: carousels (compact) and the full list (wide). */
export function EventCard({ e, onPress, width, compact }: { e: EventCardT; onPress: () => void; width?: number; compact?: boolean }) {
  const p = usePalette();
  const meta = CATEGORY_META[e.category] || CATEGORY_META.OTHER;
  const state = REG_STATE_META[e.registrationState];
  const cap = capacityLine(e);
  const deadline = e.regClosesAt && e.registrationState === 'OPEN' ? `Register by ${fmtWhen(e.regClosesAt)}` : null;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={cardA11y(e)} accessibilityHint="Opens event details"
      style={[st.eCard, { width, backgroundColor: p.card, borderColor: p.border }]}>
      <Poster uri={e.posterUrl} category={e.category} height={compact ? 128 : 168}>
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={{ position: 'absolute', top: 10, left: 10 }}><DateTile iso={e.startAt} /></View>
        <View style={{ position: 'absolute', top: 10, right: 10, alignItems: 'flex-end', gap: 6 }}>
          <PricePill label={e.price.label} isFree={e.price.isFree} />
          {e.featured ? <Pill label="Featured" color="#D97706" icon="star" solid /> : null}
        </View>
        <View style={{ position: 'absolute', left: 10, bottom: 8, right: 10, flexDirection: 'row', gap: 6 }}>
          <View style={[st.catTag, { backgroundColor: 'rgba(0,0,0,0.55)' }]}><Ionicons name={meta.icon} size={11} color="#fff" /><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{e.categoryLabel}</Text></View>
          {e.isTeam ? <View style={[st.catTag, { backgroundColor: 'rgba(0,0,0,0.55)' }]}><Ionicons name="people-outline" size={11} color="#fff" /><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>Team</Text></View> : null}
          {e.format === 'SLOT' ? <View style={[st.catTag, { backgroundColor: 'rgba(0,0,0,0.55)' }]}><Ionicons name="calendar-outline" size={11} color="#fff" /><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>Slots</Text></View> : null}
        </View>
      </Poster>
      <View style={{ padding: 12, gap: 4 }}>
        <Text style={{ fontSize: compact ? 14 : 16, fontWeight: '900', color: p.text, letterSpacing: -0.2 }} numberOfLines={2}>{e.title}</Text>
        <Text style={{ fontSize: 12, color: p.sub, fontWeight: '700' }} numberOfLines={1}>{e.organizer?.club?.verified ? <><Ionicons name="checkmark-circle" size={12} color={p.accent} />{' '}</> : null}{e.organizer?.name || 'Campus organizer'}</Text>
        <Text style={{ fontSize: 12, color: p.text }} numberOfLines={1}><Ionicons name="time-outline" size={12} color={p.sub} /> {fmtWhen(e.startAt)}{e.endAt ? ` – ${fmtClock(e.endAt)}` : ''}</Text>
        {e.venue ? <Text style={{ fontSize: 12, color: p.text }} numberOfLines={1}><Ionicons name="location-outline" size={12} color={p.sub} /> {e.venue}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {e.myStatus ? <RegStatusPill status={e.myStatus} /> : <Pill label={state.label} color={state.color} icon={state.icon} />}
          {cap && !compact ? <Pill label={cap} color={e.registrationState === 'FULL' ? '#DC2626' : '#0EA5E9'} /> : null}
        </View>
        {!compact && deadline ? <Text style={{ fontSize: 12, color: p.warn, fontWeight: '800', marginTop: 2 }}><Ionicons name="hourglass-outline" size={12} color={p.warn} /> {deadline}</Text> : null}
        {!compact ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={[st.cardCta, { borderColor: p.border, backgroundColor: p.card2 }]}><Text style={{ fontSize: 12.5, fontWeight: '900', color: p.text }}>View details</Text></View>
            {e.registrationState === 'OPEN' && !e.myStatus ? (
              <LinearGradient colors={CE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.cardCta}>
                <Text style={{ fontSize: 12.5, fontWeight: '900', color: '#fff' }}>{e.isTeam ? 'Register team' : e.format === 'SLOT' ? 'Book a slot' : 'Register'}</Text>
              </LinearGradient>
            ) : null}
          </View>
        ) : cap ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{cap}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

/** Skeleton while a list loads. */
export function CardSkeleton({ width, height = 260 }: { width?: number; height?: number }) {
  const p = usePalette();
  return <View style={{ width, height, borderRadius: 18, backgroundColor: p.card2, marginBottom: 12 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

export function Hero({ title, subtitle, kicker = 'ZENV Campus Events', right }: { title: string; subtitle: string; kicker?: string; right?: React.ReactNode }) {
  return (
    <LinearGradient colors={CE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.9)', letterSpacing: 0.3 }}>{kicker}</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', color: '#fff', marginTop: 4, letterSpacing: -0.3 }}>{title}</Text>
          <Text style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.95)', marginTop: 5, lineHeight: 18 }}>{subtitle}</Text>
        </View>
        {right}
      </View>
    </LinearGradient>
  );
}

/** Re-renders every `ms` (countdowns). */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  // Paused while the app is in the background (no 1 s re-renders nobody sees); jumps to the current
  // time as soon as the app is back.
  const appActive = useAppActive();
  useEffect(() => {
    if (!enabled || !appActive) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled, appActive]);
  return now;
}

// ── /status (Others chip, payment options, organizer flag) ──────────────────
const STATUS_CACHE_KEY = 'campusevents:status';
let statusMem: StatusResponse | null = null;
let statusFetch: Promise<StatusResponse | null> | null = null;
const OFF: StatusResponse = { enabled: false, walletEnabled: false, onlinePayEnabled: false, ticketsReady: false, organizer: null, settings: { holdMinutes: 10, paymentMinutes: 15, maxUnpaidVenueReservations: 3 }, categories: [] };

/**
 * GET /api/campus-events/status once per app session (cached). Any error = hidden (enabled false) for
 * this session's first answer, retried on the next mount. The cached copy is only used to avoid a flash
 * while the live answer arrives.
 */
export function useCampusEventsStatus(enabled = true) {
  const [data, setData] = useState<StatusResponse | null>(statusMem);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    if (!statusMem) readCache<StatusResponse>(STATUS_CACHE_KEY).then((c) => { if (alive && c && c.data && !statusMem) setData(c.data); });
    if (!statusFetch) {
      statusFetch = campusEventsApi.status()
        .then((r) => { statusMem = r; writeCache(STATUS_CACHE_KEY, r); return r; })
        .catch(() => { statusFetch = null; statusMem = statusMem || OFF; return statusMem; });
    }
    statusFetch.then((v) => { if (alive && v) setData(v); });
    return () => { alive = false; };
  }, [enabled]);
  return data;
}
/** Fresh status (registration / payment screens need current payment switches). */
export const refreshCampusEventsStatus = async () => {
  const r = await campusEventsApi.status();
  statusMem = r;
  statusFetch = Promise.resolve(r);
  writeCache(STATUS_CACHE_KEY, r);
  return r;
};

export const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 44 : 54, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  hSub: { fontSize: 12, marginTop: 1 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10, marginBottom: 10, gap: 10 },
  section: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, alignSelf: 'flex-start', maxWidth: '100%' },
  btn: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnText: { fontWeight: '900', letterSpacing: 0.2 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 46, paddingVertical: Platform.OS === 'ios' ? 12 : 9, fontSize: 14.5 },
  hint: { fontSize: 12, marginTop: 4 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10, minHeight: 52 },
  track: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 12, marginBottom: 10, minHeight: 52 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12 },
  hero: { borderRadius: 22, padding: 16, marginBottom: 12 },
  eCard: { borderRadius: 18, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  dateTile: { width: 46, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.96)', alignItems: 'center' },
  catTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  cardCta: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
});
