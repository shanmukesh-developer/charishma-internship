/**
 * In-Campus Booking parts, built from the app's existing pieces and styles (no new design):
 *   CbHeader       the checkout / tracking header (round back button, title, sub, hairline)
 *   AddControl     the store page Add button / stepper (app/restaurant/[id] MenuAddControl look)
 *   Card           the white card on the soft layered shadow (CampusBitesSection / checkout)
 *   PlaceButton    the checkout "Place order" button;  OutlineButton  the stall section "Try again" button
 *   StatusTag      the store page status badge;  VegBox  the stall dish diet box
 *   EmptyCard      the stall section empty / error card;  useCbLive  live updates (ids-only socket nudges)
 *   useCbSignIn    guests browse stalls and menus; booking actions ask them to sign in (the basket's prompt)
 * Motion: DopaminePressable press feedback and StaggeredSection one-time fade-ins only.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import DopaminePressable, { ActionPressable, CartPressable } from '../../components/DopaminePressable';
import { useTopInset } from '../../utils/useTopInset';
import { connectSocket } from '../../utils/socket';
import { COLORS, SHADOWS, surfaceLift, useCbTheme } from './cbTheme';
import type { CbStatus } from './cbApi';
import { useAuth } from '../../context/AuthContext';
import SymbolIcon from '../../components/SymbolIcon';

export { default as DopaminePressable } from '../../components/DopaminePressable';
export { StaggeredSection } from '../../components/AnimatedSection';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Guests browse the stalls and menus (QA Q23); adding to a booking, booking and "Your bookings" ask them to sign in
 * first, with the basket's prompt (app/(tabs)/basket: Alert, then /login). requireSignIn() returns true when signed in.
 */
export function useCbSignIn() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const signedIn = !!(user?._id || user?.id);
  const requireSignIn = (title = 'Sign in to check out', message = 'Sign in to book from campus stalls and track your pickup.') => {
    if (signedIn) return true;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign in', onPress: () => router.push('/login' as any) },
    ]);
    return false;
  };
  return { signedIn, authLoading: isLoading, requireSignIn };
}

/** Back to the previous screen, or the In-Campus Booking list when opened from a link / push. */
export function useCbBack(fallback = '/campus-booking') {
  const router = useRouter();
  return () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as any);
  };
}

export function CbHeader({ title, sub, right, onBack }: { title: string; sub?: string; right?: React.ReactNode; onBack?: () => void }) {
  const p = useCbTheme();
  const back = useCbBack();
  const topPad = useTopInset();
  return (
    <View style={[k.header, { paddingTop: topPad, backgroundColor: p.isDark ? p.page : '#FFF', borderBottomColor: p.border }]}>
      <TouchableOpacity onPress={onBack || back} style={[k.backBtn, { backgroundColor: p.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={20} color={p.txt} />
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[k.headerTitle, { color: p.txt }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {sub ? <Text style={{ fontSize: 12, fontWeight: '600', color: p.txtSec }} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = useCbTheme();
  return <View style={[k.card, { backgroundColor: p.card, borderColor: p.border }, surfaceLift(p.isDark), style]}>{children}</View>;
}

/** The store page Add button; turns into the filled stepper once the item is in this stall's pickup cart. */
export function AddControl({ qty, onAdd, onRemove, soldOut, closed, max = 10 }: { qty: number; onAdd: () => void; onRemove: () => void; soldOut?: boolean; closed?: boolean; max?: number }) {
  const p = useCbTheme();
  const tint = p.accent;
  if (soldOut) {
    return <View style={[k.addBtn, { backgroundColor: '#E5E7EB', borderColor: '#9CA3AF' }]}><Text style={[k.addText, { color: '#6B7280' }]}>Sold out</Text></View>;
  }
  if (qty > 0) {
    return (
      // Owner, 10 Nov 2026: soft accent pill, white round - / + (same size as Add), count centred.
      <View style={[k.softStepper, { backgroundColor: p.accentSoft, borderColor: p.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
        <TouchableOpacity style={k.softStepBtn} onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`Remove one. ${qty} in cart`}>
          <Ionicons name="remove" size={15} color={tint} />
        </TouchableOpacity>
        <Text style={[k.stepCount, { color: tint, fontSize: 13 }]}>{qty}</Text>
        <TouchableOpacity style={k.softStepBtn} onPress={onAdd} disabled={qty >= max} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`Add one more. ${qty} in cart`}>
          <Ionicons name="add" size={15} color={tint} style={qty >= max ? { opacity: 0.4 } : undefined} />
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <CartPressable style={[k.addBtn, closed ? { backgroundColor: '#F3F4F6', borderColor: '#D1D5DB' } : { backgroundColor: p.card, borderColor: p.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }]} onPress={onAdd} sound="addToCart">
      <Text style={[k.addText, { color: closed ? '#6B7280' : tint }]}>{closed ? 'Closed' : 'Add'}</Text>
    </CartPressable>
  );
}

/** Checkout's "Place order" button (red, glow), used for Proceed to pay / Submit payment. */
export function PlaceButton({ label, onPress, busy, busyLabel, disabled, style }: { label: string; onPress: () => void; busy?: boolean; busyLabel?: string; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const p = useCbTheme();
  return (
    <ActionPressable
      style={[k.placeBtn, { backgroundColor: p.accent, shadowColor: p.accent, opacity: disabled && !busy ? 0.5 : 1 }, style]}
      onPress={disabled || busy ? () => {} : onPress}
      disabled={busy}
      sound="success"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
    >
      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color="#fff" />
          <Text style={[k.placeText, { fontSize: 13 }]}>{busyLabel || 'Please wait…'}</Text>
        </View>
      ) : <Text style={k.placeText}>{label}</Text>}
    </ActionPressable>
  );
}

/** The stall section outline button ("Try again", "View menu"). */
export function OutlineButton({ label, onPress, icon, tone = 'accent', style, disabled, busy }: { label: string; onPress: () => void; icon?: IconName; tone?: 'accent' | 'neutral' | 'danger'; style?: StyleProp<ViewStyle>; disabled?: boolean; busy?: boolean }) {
  const p = useCbTheme();
  const c = tone === 'danger' ? COLORS.red : tone === 'neutral' ? p.txt : p.accent;
  return (
    <DopaminePressable
      style={[k.outline, { borderColor: tone === 'neutral' ? p.border : c, backgroundColor: p.card, opacity: disabled ? 0.5 : 1 }, style]}
      onPress={disabled || busy ? () => {} : onPress}
      sound="click"
      activeScale={0.97}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator color={c} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon ? <Ionicons name={icon} size={16} color={c} /> : null}
          <Text style={[k.outlineText, { color: c }]}>{label}</Text>
        </View>
      )}
    </DopaminePressable>
  );
}

/** Status words on the store page badge colours (never colour alone). */
export function StatusTag({ status, label }: { status: CbStatus; label: string }) {
  const p = useCbTheme();
  // Light mode (owner, 10 Nov 2026): one diet accent for live steps, grey for closed ones, red only when rejected.
  if (true) {
    const closed = status === 'COLLECTED' || status === 'CANCELLED';
    const bad = status === 'REJECTED';
    return (
      <View style={[k.statusBadge, { backgroundColor: bad ? (p.isDark ? 'rgba(239,68,68,0.15)' : '#FEECEC') : closed ? (p.isDark ? 'rgba(255,255,255,0.08)' : '#F2F3F6') : p.accentSoft }]}>
        <Text style={[k.statusBadgeText, { color: bad ? (p.isDark ? '#FCA5A5' : '#B42318') : closed ? p.closedInk : p.accent }]} numberOfLines={1}>{label}</Text>
      </View>
    );
  }
  const bg = status === 'PAYMENT_REVIEW' ? '#F59E0B'
    : status === 'REJECTED' || status === 'CANCELLED' ? '#B4473F'
      : status === 'PAYMENT_PENDING' ? '#6B7280'
        : '#10B981';
  return <View style={[k.statusBadge, { backgroundColor: bg }]}><Text style={k.statusBadgeText} numberOfLines={1}>{label}</Text></View>;
}

/** The stall dish diet box (CampusBitesSection). */
export function VegBox({ veg }: { veg: boolean }) {
  const c = veg ? '#1E8E3E' : '#C0392B';
  return (
    <View style={[k.dietBox, { borderColor: c }]} accessibilityLabel={veg ? 'Veg' : 'Non-veg'}>
      <View style={[k.dietDot, { backgroundColor: c }]} />
    </View>
  );
}

/** The stall section empty / error card. */
export function EmptyCard({ icon = 'storefront-outline', title, sub, actionLabel, onAction, loading }: { icon?: IconName; title?: string; sub?: string; actionLabel?: string; onAction?: () => void; loading?: boolean }) {
  const p = useCbTheme();
  return (
    <View style={[k.emptyState, { backgroundColor: p.card, borderColor: p.border }, surfaceLift(p.isDark)]}>
      {loading ? <ActivityIndicator color={p.accent} /> : <Ionicons name={icon} size={28} color={p.txtSec} style={{ marginBottom: 8 }} />}
      {title ? <Text style={[k.emptyText, { color: p.txt, marginBottom: sub ? 4 : 0 }]}>{title}</Text> : null}
      {sub ? <Text style={[k.emptySub, { color: p.txtSec, marginBottom: actionLabel ? 14 : 0 }]}>{sub}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} activeOpacity={0.85} style={[k.ctaBtn, { borderColor: p.accent }]} accessibilityRole="button">
          <Text style={[k.ctaText, { color: p.accent }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** A notice bar (the store page "delivers this order" / closed bars). */
export function NoticeBar({ icon, text, tone = 'orange', style }: { icon: IconName; text: string; tone?: 'orange' | 'indigo' | 'red' | 'green'; style?: StyleProp<ViewStyle> }) {
  const p = useCbTheme();
  const c = tone === 'indigo' ? '#6366F1' : tone === 'red' ? '#EF4F5F' : tone === 'green' ? '#10B981' : '#F97316';
  const rgb = tone === 'indigo' ? '99,102,241' : tone === 'red' ? '239,79,95' : tone === 'green' ? '16,185,129' : '249,115,22';
  // Light mode (owner, 10 Nov 2026): one quiet soft-accent line, no orange / indigo boxes. Dark keeps the tones.
  if (true) {
    return (
      <View style={[k.noticeBar, { backgroundColor: p.accentSoft, borderColor: 'transparent' }, style]}>
        <Ionicons name={icon} size={16} color={p.accent} />
        <Text style={{ flex: 1, color: p.txt, fontSize: 12.5, fontWeight: '600', lineHeight: 17 }}>{text}</Text>
      </View>
    );
  }
  return (
    <View style={[k.noticeBar, { backgroundColor: `rgba(${rgb},${p.isDark ? 0.12 : 0.08})`, borderColor: `rgba(${rgb},0.3)` }, style]}>
      <Ionicons name={icon} size={16} color={c} />
      <Text style={{ flex: 1, color: p.txt, fontSize: 12, fontWeight: '700', lineHeight: 16 }}>{text}</Text>
    </View>
  );
}

/**
 * Refetch when the server nudges this student (`campusbooking:changed` { id, status } in their own room), when a
 * stall changed (`data:changed` type 'store' / 'product'), and after a reconnect. Payloads are ids only.
 */
// catalog: also refresh on public store / product changes (menus, stock). Off for lists of the student's own bookings
// (Orders tab): that tab stays mounted, and every stock toggle on campus would otherwise re-read each student's bookings.
export function useCbLive(onChange: (e: { id?: string; status?: string; kind?: string }) => void, enabled = true, { catalog = true }: { catalog?: boolean } = {}) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    let socket: ReturnType<typeof connectSocket>;
    try { socket = connectSocket(); } catch { return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: any = {};
    let lastRank = -1;
    // One call per 300 ms window with the most important event of the window: a reconnect (2) over the student's own
    // booking update (1) over a public store / product change (0). Keeping only the latest let a stock change on
    // campus hide the student's own "Ready" (31 Oct 2026).
    const fire = (e: any, rank: number) => {
      if (rank >= lastRank) { last = e || {}; lastRank = rank; }
      if (timer) return;
      timer = setTimeout(() => { timer = null; const ev = last; lastRank = -1; try { ref.current(ev); } catch { /* screen gone */ } }, 300);
    };
    const onBooking = (e: any) => fire(e && typeof e === 'object' ? { ...e, kind: 'booking' } : {}, 1);
    const onData = (e: any) => { if (e && (e.type === 'store' || e.type === 'product')) fire({ kind: e.type, id: e.storeId || e.id }, 0); };
    let connectedOnce = socket.connected;
    let lastReconnect = 0;
    const onConnect = () => {
      const now = Date.now();
      if (connectedOnce && now - lastReconnect > 15000) { lastReconnect = now; fire({ kind: 'reconnect' }, 2); }
      connectedOnce = true;
    };
    socket.on('campusbooking:changed', onBooking);
    if (catalog) socket.on('data:changed', onData);
    socket.on('connect', onConnect);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off('campusbooking:changed', onBooking);
      if (catalog) socket.off('data:changed', onData);
      socket.off('connect', onConnect);
    };
  }, [enabled, catalog]);
}

export const k = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  headerTitle: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  addBtn: { width: 84, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  addText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.2 },
  softStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: 84, height: 32, paddingHorizontal: 4, borderRadius: 16, borderWidth: 1, ...SHADOWS.card },
  softStepBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: 76, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1, ...SHADOWS.card, elevation: 4 },
  stepBtn: { paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF', lineHeight: 16 },
  stepCount: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  placeBtn: { backgroundColor: COLORS.red, paddingVertical: 16, borderRadius: 16, alignItems: 'center', width: '100%', ...SHADOWS.redGlow },
  placeText: { fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  outline: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  outlineText: { fontSize: 14, fontWeight: '600', letterSpacing: 0.2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  statusBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  dietBox: { width: 12, height: 12, borderRadius: 2, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
  dietDot: { width: 5, height: 5, borderRadius: 3 },
  emptyState: { padding: 24, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '600', letterSpacing: 0.1, textAlign: 'center' },
  emptySub: { fontSize: 13, fontWeight: '400', textAlign: 'center' },
  ctaBtn: { paddingHorizontal: 16, height: 40, justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  ctaText: { fontSize: 14, fontWeight: '600', letterSpacing: 0.2 },
  noticeBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
});
