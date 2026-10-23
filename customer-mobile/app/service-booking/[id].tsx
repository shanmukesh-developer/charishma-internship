/**
 * Track one campus service booking (repairs, tailoring, print, laundry).
 * Vertical stepper mapped to the server's booking statuses:
 *   REQUESTED -> CONFIRMED (or DIAGNOSED_QUOTED: quote waiting for approval) -> IN_PROGRESS (picked up,
 *   being worked on) -> READY_FOR_DELIVERY -> COMPLETED; CANCELLED ends it.
 * Actions are the existing endpoints: approve quote, cancel, rate. Live via socket serviceStatusUpdate.
 * Opened from the booking success screen and from Orders, Services.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Linking, RefreshControl, TextInput } from 'react-native';
import { PressScale, StateCard, SkeletonList } from '../../modules/others/motion';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../../context/AuthContext';
import { ENDPOINTS } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import { connectSocket } from '../../utils/socket';
import { formatINR, formatISTDateTime } from '../../utils/format';
import { familyOfBooking, useServicePalette, type ServiceFamily } from '../../modules/services/serviceTheme';
import { shortBookingRef, type IconName } from '../../modules/services/serviceFlow';

const ID_RE = /^[0-9a-f-]{8,64}$/i;

const RANK: Record<string, number> = { REQUESTED: 0, DIAGNOSED_QUOTED: 1, CONFIRMED: 1, IN_PROGRESS: 2, READY_FOR_DELIVERY: 3, COMPLETED: 4 };

const WORK_STEP: Record<ServiceFamily, string> = {
  repairs: 'Device picked up, under repair',
  tailoring: 'Clothes collected, stitching',
  print: 'Printing',
  laundry: 'Collected, washing',
  general: 'Picked up, in progress',
};
const WORK_HEADLINE: Record<ServiceFamily, string> = {
  repairs: 'Your device is under repair',
  tailoring: 'Your clothes are being stitched',
  print: 'Your print job is in progress',
  laundry: 'Your laundry is being washed',
  general: 'Your job is in progress',
};
const PARTNER: Record<ServiceFamily, string> = { repairs: 'technician', tailoring: 'tailor', print: 'print shop', laundry: 'laundry partner', general: 'partner' };
const HERO_ICON: Record<ServiceFamily, IconName> = { repairs: 'construct', tailoring: 'cut', print: 'print', laundry: 'shirt', general: 'briefcase' };

const digits10 = (v: unknown) => String(v || '').replace(/\D/g, '').slice(-10);
const spaced = (d: string) => (d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d);
/** Partner-written notes only (not the server's default "Status updated to X"). */
const humanNote = (n: unknown) => (typeof n === 'string' && n.trim() && !/^Status updated to /i.test(n) ? n.trim() : '');

export default function ServiceBookingTrackScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const rawId = String((Array.isArray(params.id) ? params.id[0] : params.id) || '');
  const id = ID_RE.test(rawId) ? rawId : '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'quote' | 'cancel' | 'rate' | null>(null);
  const busyRef = useRef(false);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const family = familyOfBooking(booking);
  const p = useServicePalette(family);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); setError('This booking link is not valid.'); return; }
    try {
      const res = await apiFetch(ENDPOINTS.servicesDetail(id));
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (res.ok && data?.booking) { setBooking(data.booking); setError(null); }
      else if (res.status === 401) setError('Sign in to see this booking.');
      else if (res.status >= 502 && res.status <= 504) setError('WAKING');
      else if (res.status === 404) setError('We could not find this booking.');
      else setError((data && typeof data.message === 'string' && data.message) || 'Something went wrong. Try again in a moment.');
    } catch {
      if (mountedRef.current) setError('OFFLINE');
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => { if (user) load(); else { setLoading(false); setError('Sign in to see this booking.'); } }, [user, load]);

  // Partner / admin stage changes and quotes arrive live.
  useEffect(() => {
    if (!user || !id) return;
    let socket: any;
    try { socket = connectSocket(); } catch { return; }
    const onUpdate = (payload: any) => { if (String(payload?.id || '') === id) load(); };
    socket.on('serviceStatusUpdate', onUpdate);
    return () => { socket.off('serviceStatusUpdate', onUpdate); };
  }, [user, id, load]);

  const run = async (kind: 'quote' | 'cancel' | 'rate', url: string, body: any, okHaptic = true) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (data?.booking && mountedRef.current) setBooking(data.booking);
      if (!res.ok) {
        Alert.alert(kind === 'quote' ? 'Could not approve' : kind === 'cancel' ? 'Could not cancel' : 'Could not send rating', data?.message || 'Please try again in a moment.');
        return;
      }
      if (okHaptic) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      Alert.alert('No connection', 'Please check your connection and try again.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  };

  const approveQuote = () => run('quote', ENDPOINTS.servicesConfirmQuote(id), { acceptQuote: true, quotedAmount: booking?.quotedAmount });
  const cancel = () => {
    Alert.alert('Cancel this booking?', `${booking?.title || 'This service'} will be cancelled.`, [
      { text: 'Keep booking', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: () => run('cancel', ENDPOINTS.servicesCancel(id), { reason: 'Cancelled by customer' }, false) },
    ]);
  };
  const sendRating = () => {
    if (rating < 1) { Alert.alert('Pick a rating', 'Tap the stars to rate this service.'); return; }
    run('rate', ENDPOINTS.servicesRate(id), { rating, review: review.trim() });
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any));

  // ── States ────────────────────────────────────────────────────────────────────────────────
  const header = (
    <View style={[s.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
      <PressScale onPress={goBack} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={p.text} />
      </PressScale>
      <Text style={[s.headerTitle, { color: p.text }]} accessibilityRole="header">Track your booking</Text>
      <PressScale onPress={() => router.push({ pathname: '/support', params: { bookingId: id } } as any)} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Help with this booking">
        <Ionicons name="help-circle-outline" size={24} color={p.text} />
      </PressScale>
    </View>
  );

  if (loading || (!booking && !error)) {
    return (
      <View style={[s.screen, { backgroundColor: p.page }]}>
        {header}
        <View style={s.body}><SkeletonList count={1} height={150} hint={false} /><SkeletonList count={1} height={280} hint={false} style={{ marginTop: 12 }} /><SkeletonList count={1} height={90} style={{ marginTop: 12 }} /></View>
      </View>
    );
  }
  if (!booking) {
    return (
      <View style={[s.screen, { backgroundColor: p.page }]}>
        {header}
        <View style={s.body}>
          <StateCard
            section={family === 'general' ? 'services' : family}
            kind={!user ? 'signin' : error === 'OFFLINE' ? 'offline' : error === 'WAKING' ? 'waking' : /find|valid/.test(String(error)) ? 'empty' : 'error'}
            icon={!user ? undefined : /find|valid/.test(String(error)) ? 'receipt-outline' : undefined}
            title={!user ? 'Sign in to see this booking' : error === 'OFFLINE' ? 'You are offline' : error === 'WAKING' ? 'Waking the server up'
              : /find/.test(String(error)) ? 'Booking not found' : /valid/.test(String(error)) ? 'This link is not valid' : 'Could not load this booking'}
            message={!user ? 'Your bookings are private to your account.' : error === 'OFFLINE' ? 'Check your internet connection and try again.' : error === 'WAKING' ? 'This takes a few seconds the first time.'
              : /find|valid/.test(String(error)) ? 'Open it from your bookings in Orders.' : String(error)}
            actionLabel={!user ? 'Sign in' : /find|valid/.test(String(error)) ? 'My bookings' : 'Try again'}
            onAction={() => (!user ? router.push('/login' as any)
              : /find|valid/.test(String(error)) ? router.replace({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any)
                : (setLoading(true), load()))}
          />
        </View>
      </View>
    );
  }

  // ── Booking ───────────────────────────────────────────────────────────────────────────────
  const b = booking;
  const status = String(b.status || 'REQUESTED');
  const cancelled = status === 'CANCELLED';
  const history: any[] = Array.isArray(b.trackingHistory) ? b.trackingHistory : [];
  const spec = b.specifications && typeof b.specifications === 'object' ? b.specifications : {};
  const details: { key: string; label: string; value: string }[] = Array.isArray(spec.details) ? spec.details : [];
  const reached = cancelled
    ? history.reduce((m, h) => (h?.stage in RANK ? Math.max(m, RANK[h.stage]) : m), 0)
    : (RANK[status] ?? 0);
  const quoteWaiting = status === 'DIAGNOSED_QUOTED';
  const amount = Number((quoteWaiting ? b.quotedAmount : (b.finalAmount || b.quotedAmount)) || 0) || 0;
  const lastAt = (stages: string[]) => {
    for (let i = history.length - 1; i >= 0; i--) if (stages.includes(history[i]?.stage)) return history[i];
    return null;
  };

  const steps = [
    { title: 'Request received', stages: ['REQUESTED'] },
    { title: quoteWaiting ? `Quote ready: ${formatINR(b.quotedAmount)}` : 'Confirmed', stages: ['CONFIRMED', 'DIAGNOSED_QUOTED'] },
    { title: WORK_STEP[family], stages: ['IN_PROGRESS'] },
    { title: family === 'print' ? 'Ready to deliver' : 'Ready for delivery', stages: ['READY_FOR_DELIVERY'] },
    { title: family === 'print' || family === 'laundry' || family === 'tailoring' ? 'Delivered' : 'Completed', stages: ['COMPLETED'] },
  ];

  const headline = cancelled ? 'Booking cancelled'
    : quoteWaiting ? `Quote ready: ${formatINR(b.quotedAmount)}`
      : status === 'REQUESTED' ? 'Request received'
        : status === 'CONFIRMED' ? 'Booking confirmed'
          : status === 'IN_PROGRESS' ? WORK_HEADLINE[family]
            : status === 'READY_FOR_DELIVERY' ? 'Ready for delivery'
              : 'Delivered';
  const subline = cancelled ? 'This booking is closed. Book again any time.'
    : quoteWaiting ? 'Approve the price so the work can go ahead.'
      : status === 'REQUESTED' ? `The ${PARTNER[family]} will call you to confirm the time and price.`
        : status === 'COMPLETED' ? 'Thanks for booking. Rate the service below.'
          : status === 'READY_FOR_DELIVERY' ? `The ${PARTNER[family]} will bring it to you.`
            : "We'll notify you at every step.";

  const d = b.driverDetails && typeof b.driverDetails === 'object' ? b.driverDetails : {};
  const partnerName = typeof d.name === 'string' ? d.name.trim() : '';
  const partnerPhone = digits10(d.phone);
  const myPhone = digits10(b.contactPhone);
  const canCancel = !cancelled && !['IN_PROGRESS', 'READY_FOR_DELIVERY', 'COMPLETED'].includes(status);
  const rated = Number(spec.userRating) || 0;

  const call = () => Linking.openURL(`tel:${partnerPhone}`).catch(() => Alert.alert('Could not start the call', 'Please dial the number from your phone app.'));

  const rows: [string, string][] = [
    ['Booking ID', `#${shortBookingRef(b.id)}`],
    ['Service', String(b.title || 'Service booking')],
    ...details.filter((x) => x.key !== 'notes').slice(0, 5).map((x) => [x.label, x.value] as [string, string]),
    ['Date and time', String(b.pickupSlot || '')],
    ['Address', [b.hostelBlock, b.roomNumber ? `Room ${b.roomNumber}` : ''].filter(Boolean).join(', ')],
    [status === 'COMPLETED' ? 'Amount' : 'Estimate', amount > 0 ? formatINR(amount) : 'Partner will quote'],
    ['Payment', 'Cash when the job is done'],
  ].filter(([, v]) => !!v) as [string, string][];

  return (
    <View style={[s.screen, { backgroundColor: p.page }]}>
      {header}
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: 32 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={p.accent} colors={[p.button]} />}
      >
        {/* Current stage */}
        <View style={[s.hero, { backgroundColor: cancelled ? p.raised : p.tint }]}>
          <View style={[s.heroIcon, { backgroundColor: cancelled ? p.sub : p.button }]}>
            <Ionicons name={cancelled ? 'close' : status === 'COMPLETED' ? 'checkmark' : HERO_ICON[family]} size={26} color="#FFFFFF" />
          </View>
          <Text style={[s.heroTitle, { color: p.text }]} accessibilityLiveRegion="polite">{headline}</Text>
          <Text style={[s.heroSub, { color: p.sub }]}>{subline}</Text>
          {quoteWaiting ? (
            <PressScale onPress={approveQuote} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Approve quote, ${formatINR(b.quotedAmount)}`}
              style={[s.cta, { backgroundColor: p.button, alignSelf: 'stretch', marginTop: 14 }]}>
              {busy === 'quote' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.ctaText}>Approve quote · {formatINR(b.quotedAmount)}</Text>}
            </PressScale>
          ) : null}
        </View>

        {/* Stepper */}
        <View style={[s.card, { backgroundColor: p.card }, p.shadow]}>
          {steps.map((st, i) => {
            const done = i < reached || (i === reached && (status === 'COMPLETED' || cancelled));
            const current = !cancelled && i === reached && status !== 'COMPLETED';
            const pendingAction = current && quoteWaiting;
            const h = i <= reached ? lastAt(st.stages) : null;
            const note = current ? humanNote(h?.note) : '';
            const last = i === steps.length - 1;
            const dotColor = done ? p.button : current ? (pendingAction ? p.warn : p.button) : p.line;
            return (
              <View key={st.title} style={s.stepRow}>
                <View style={s.rail}>
                  <View style={[s.dot, { borderColor: dotColor, backgroundColor: done ? p.button : p.card }]}>
                    {done ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : current ? <View style={[s.dotInner, { backgroundColor: dotColor }]} /> : null}
                  </View>
                  {!last || cancelled ? <View style={[s.line, { backgroundColor: i < reached ? p.button : p.line }]} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: last && !cancelled ? 0 : 18 }}>
                  <Text style={[s.stepTitle, { color: done || current ? p.text : p.muted }]}>{st.title}</Text>
                  <Text style={[s.stepSub, { color: pendingAction ? p.warn : p.sub }]}>
                    {pendingAction ? 'Waiting for your approval' : h?.timestamp ? formatISTDateTime(h.timestamp) : current ? 'In progress' : 'Pending'}
                  </Text>
                  {note ? <Text style={[s.stepNote, { color: p.sub }]}>{note}</Text> : null}
                </View>
              </View>
            );
          })}
          {cancelled ? (
            <View style={s.stepRow}>
              <View style={s.rail}>
                <View style={[s.dot, { borderColor: p.error, backgroundColor: p.error }]}><Ionicons name="close" size={13} color="#FFFFFF" /></View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.stepTitle, { color: p.error }]}>Cancelled</Text>
                <Text style={[s.stepSub, { color: p.sub }]}>{formatISTDateTime(lastAt(['CANCELLED'])?.timestamp) || ''}</Text>
                {humanNote(lastAt(['CANCELLED'])?.note) ? <Text style={[s.stepNote, { color: p.sub }]}>{humanNote(lastAt(['CANCELLED'])?.note)}</Text> : null}
              </View>
            </View>
          ) : null}
        </View>

        {/* Partner */}
        {!cancelled ? (
          <View style={[s.card, s.partner, { backgroundColor: p.card }, p.shadow]}>
            <View style={[s.avatar, { backgroundColor: p.tint }]}>
              <Ionicons name="person" size={22} color={p.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.small, { color: p.sub }]}>{partnerName ? `Assigned ${PARTNER[family]}` : `${PARTNER[family][0].toUpperCase()}${PARTNER[family].slice(1)}`}</Text>
              <Text style={[s.partnerName, { color: p.text }]} numberOfLines={1}>{partnerName || 'Being assigned'}</Text>
              <Text style={[s.small, { color: p.sub }]} numberOfLines={2}>
                {partnerPhone ? spaced(partnerPhone) : myPhone ? `They will call you on ${spaced(myPhone)}` : 'They will call you to confirm'}
              </Text>
            </View>
            {partnerPhone.length === 10 ? (
              <PressScale onPress={call} accessibilityRole="button" accessibilityLabel={`Call ${partnerName || 'the partner'}`} style={[s.callBtn, { backgroundColor: p.button }]}>
                <Ionicons name="call" size={18} color="#FFFFFF" />
              </PressScale>
            ) : null}
          </View>
        ) : null}

        {/* Rate */}
        {status === 'COMPLETED' ? (
          <View style={[s.card, { backgroundColor: p.card }, p.shadow]}>
            <Text style={[s.cardTitle, { color: p.text }]}>{rated ? 'Your rating' : 'Rate this service'}</Text>
            <View style={s.stars} accessibilityRole="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => {
                const on = n <= (rated || rating);
                return (
                  <PressScale key={n} disabled={!!rated} onPress={() => setRating(n)} accessibilityRole="radio" accessibilityState={{ selected: n === (rated || rating) }} accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`} style={s.starBtn}>
                    <Ionicons name={on ? 'star' : 'star-outline'} size={30} color={on ? '#F5A524' : p.muted} />
                  </PressScale>
                );
              })}
            </View>
            {rated ? (
              spec.userReview ? <Text style={[s.small, { color: p.sub }]}>{String(spec.userReview)}</Text> : <Text style={[s.small, { color: p.sub }]}>Thank you for your feedback.</Text>
            ) : (
              <>
                <TextInput value={review} onChangeText={setReview} placeholder="Tell others how it went (optional)" placeholderTextColor={p.muted} maxLength={500} multiline
                  accessibilityLabel="Review" style={[s.input, { backgroundColor: p.field, borderColor: p.line, color: p.text }]} />
                <PressScale onPress={sendRating} disabled={!!busy} accessibilityRole="button" style={[s.cta, { backgroundColor: p.button, marginTop: 12 }]}>
                  {busy === 'rate' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.ctaText}>Rate and review</Text>}
                </PressScale>
              </>
            )}
          </View>
        ) : null}

        {/* Summary */}
        <View style={[s.card, { backgroundColor: p.card, paddingVertical: 6 }, p.shadow]}>
          {rows.map(([k, v], i) => (
            <View key={`${k}-${i}`} style={[s.kv, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
              <Text style={[s.kvKey, { color: p.sub }]}>{k}</Text>
              <Text style={[s.kvVal, { color: k === 'Booking ID' ? p.accent : p.text }]}>{v}</Text>
            </View>
          ))}
        </View>

        {canCancel ? (
          <PressScale onPress={cancel} disabled={!!busy} accessibilityRole="button" style={[s.cta, s.outline, { borderColor: p.error }]}>
            {busy === 'cancel' ? <ActivityIndicator color={p.error} /> : <Text style={[s.ctaText, { color: p.error }]}>Cancel booking</Text>}
          </PressScale>
        ) : !cancelled && status !== 'COMPLETED' ? (
          <Text style={[s.small, { color: p.sub, textAlign: 'center', marginTop: 4 }]}>The partner has your items, so cancelling goes through support.</Text>
        ) : null}
        <PressScale onPress={() => router.push({ pathname: '/support', params: { bookingId: id } } as any)} style={s.textBtn} accessibilityRole="button">
          <Text style={{ color: p.accent, fontWeight: '700', fontSize: 14 }}>Need help with this booking?</Text>
        </PressScale>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  stateTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  body: { padding: 16, paddingTop: 6, width: '100%', maxWidth: 640, alignSelf: 'center' },
  hero: { borderRadius: 20, padding: 20, alignItems: 'center', marginBottom: 12 },
  heroIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  heroTitle: { fontSize: 19, fontWeight: '800', textAlign: 'center' },
  heroSub: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 4 },
  card: { borderRadius: 18, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  stepRow: { flexDirection: 'row', gap: 14 },
  rail: { width: 24, alignItems: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotInner: { width: 10, height: 10, borderRadius: 5 },
  line: { width: 2, flex: 1, minHeight: 18, marginVertical: 2, borderRadius: 1 },
  stepTitle: { fontSize: 15, fontWeight: '700' },
  stepSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  stepNote: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  partner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  partnerName: { fontSize: 15, fontWeight: '700', marginVertical: 1 },
  small: { fontSize: 13, lineHeight: 18 },
  callBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stars: { flexDirection: 'row', gap: 4, marginVertical: 10 },
  starBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 80, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, textAlignVertical: 'top' },
  kv: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, gap: 12 },
  kvKey: { width: 112, fontSize: 13, fontWeight: '600' },
  kvVal: { flex: 1, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  cta: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, flexDirection: 'row', gap: 8 },
  outline: { backgroundColor: 'transparent', borderWidth: 1.5 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  textBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
});
