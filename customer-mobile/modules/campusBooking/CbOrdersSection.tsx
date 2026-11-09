// Orders tab: the student's In-Campus bookings (owner, 30 Oct 2026: "user can't track it, the PIN doesn't work").
// Bookings lived only under In-Campus Booking > Your bookings, so a student who looked in Orders found nothing: no
// status, no pickup code to show the stall. Cards show the stall, the live status, what happens next and, once the
// stall accepted, the pickup code; a tap opens the booking (or its payment screen while proof is due). Closed bookings
// stay visible too (All: the last two days; Past: all recent ones) with the stall's cancel reason, so a paid booking
// the stall cancelled does not just vanish.
import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { cbApi, isOpenStatus, type CbBooking } from './cbApi';
import { inr, timeIST, useCbTheme } from './cbTheme';
import { resolveMediaUrl } from '../../utils/imageUpload';
import { StatusTag, useCbLive } from './cbKit';
import SymbolIcon from '../../components/SymbolIcon';

/** What the student does or waits for next, in one line. */
const nextStep = (b: CbBooking): string => {
  switch (b.status) {
    case 'PAYMENT_PENDING': return 'Pay the stall by UPI, then send the screenshot and transaction ID';
    case 'REJECTED': return 'The stall could not verify your payment: send the proof again';
    case 'PAYMENT_REVIEW': return 'The stall is checking your payment';
    case 'ACCEPTED':
    case 'PREPARING': return 'Being prepared: show this code when you collect';
    case 'READY': return 'Ready: show this code at the counter';
    case 'COLLECTED': return 'Collected';
    case 'CANCELLED': {
      // Student / system reasons end with a full stop ("Cancelled by the student."), the stall's do not: never print two.
      const reason = (b.cancellation?.reason || '').trim().replace(/\.+$/, '');
      const why = reason ? `${reason}. ` : '';
      if (b.paymentVerified) return `${why}The stall returns your payment to you.`;
      // The stall can cancel while it is still checking a payment the student already sent.
      if (b.cancellation?.by === 'vendor' && b.proof?.submittedAt) return `${why}If you paid, the stall returns it to you.`;
      return reason || 'Cancelled';
    }
    default: return b.statusLabel;
  }
};

const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
const closedAt = (b: CbBooking) => new Date(b.collectedAt || b.cancelledAt || b.updatedAt || b.createdAt || 0).getTime() || 0;

export default function CbOrdersSection({ filter, txt, txtSec, cardBg, border, accent, lift }: {
  /** The Orders tab filter: ALL = in progress + closed in the last two days, ACTIVE = in progress, PAST = closed. */
  filter: 'ALL' | 'ACTIVE' | 'PAST';
  txt: string; txtSec: string; cardBg: string; border: string; accent: string; lift?: object;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const signedIn = !!(user?._id || user?.id);
  const [all, setAll] = useState<CbBooking[]>([]);
  const p = useCbTheme();
  const newLook = true as boolean;

  const load = useCallback(async () => {
    if (!signedIn) { setAll([]); return; }
    try {
      const r = await cbApi.mine();
      setAll(r.bookings);
    } catch { /* offline: keep the last list; the booking screens show their own errors */ }
  }, [signedIn]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useCbLive(() => { void load(); }, signedIn, { catalog: false });

  if (!all.length) return null;
  const open = all.filter((b) => isOpenStatus(b.status));
  const closed = all.filter((b) => !isOpenStatus(b.status)).sort((a, b) => closedAt(b) - closedAt(a));
  const list = filter === 'ACTIVE' ? open
    : filter === 'PAST' ? closed
      : [...open, ...closed.filter((b) => Date.now() - closedAt(b) < TWO_DAYS)];
  if (!list.length && filter === 'ACTIVE') return null;
  return (
    <View style={st.wrap} accessibilityRole="summary">
      <View style={st.head}>
        <Text style={[st.title, { color: txt }]}>In-Campus bookings</Text>
        <TouchableOpacity onPress={() => router.push('/campus-booking/bookings' as any)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="link" accessibilityLabel="All your In-Campus bookings">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Text style={[st.link, { color: accent }]}>All bookings</Text><SymbolIcon name="chevron-forward" style={[st.link, { color: accent }]} scale={1} /></View>
        </TouchableOpacity>
      </View>
      {list.map((b) => {
        const proofDue = (b.status === 'PAYMENT_PENDING' || b.status === 'REJECTED') && b.canSubmitProof;
        const code = isOpenStatus(b.status) ? b.pickupCode : null;
        if (newLook) {
          // replicaBookingCard (owner, 10 Nov 2026): same card as the delivery orders.
          const liveB = isOpenStatus(b.status);
          const img = resolveMediaUrl(b.stall?.imageUrl || '') || null;
          const open_ = () => router.push((proofDue ? `/campus-booking/pay/${b.id}` : `/campus-booking/order/${b.id}`) as any);
          return (
            <TouchableOpacity key={b.id} activeOpacity={0.95} onPress={open_} style={[st.rCard, { backgroundColor: cardBg, borderColor: border }, lift]}
              accessibilityLabel={`In-Campus booking ${b.ref} at ${b.stall?.name || 'a campus stall'}, ${b.statusLabel}${code ? `, pickup code ${code.split('').join(' ')}` : ''}. Open`}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                {img ? (
                  <View style={st.rImg}><Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /></View>
                ) : (
                  <View style={[st.rImg, { backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="storefront-outline" size={22} color={accent} /></View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: txt, flexShrink: 1 }} numberOfLines={1}>{b.stall?.name || 'Campus stall'}</Text>
                    <View style={{ backgroundColor: p.accentSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}><Text style={{ fontSize: 10.5, fontWeight: '800', color: accent }}>Pickup</Text></View>
                  </View>
                  <Text style={{ fontSize: 12, color: txtSec, marginTop: 1 }} numberOfLines={2}>{`Booking #${b.ref} · ${b.itemCount} item${b.itemCount === 1 ? '' : 's'}${b.createdAt ? ` · ${timeIST(b.createdAt)}` : ''}`}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginTop: 7, backgroundColor: liveB ? p.accentSoft : (p.isDark ? 'rgba(255,255,255,0.08)' : '#F2F3F6') }}>
                    {liveB ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} /> : null}
                    <Text style={{ fontSize: 11.5, fontWeight: '800', color: liveB ? accent : p.closedInk }}>{b.statusLabel}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: txt, marginTop: 4 }}>{inr(b.amount)}</Text>
                  <Text style={{ fontSize: 11, color: txtSec, marginTop: 2 }}>{b.paymentVerified ? 'Paid by UPI' : 'Pay by UPI'}</Text>
                </View>
              </View>
              {code ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: p.accentSoft }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11.5, color: txt, opacity: 0.8 }}>Pickup code</Text>
                    <Text style={{ fontSize: 11.5, color: txt, opacity: 0.8 }} numberOfLines={1}>{`Show it at the ${b.stall?.name || 'stall'} counter`}</Text>
                  </View>
                  <Text style={{ fontSize: 24, fontWeight: '900', letterSpacing: 5, color: accent }}>{code}</Text>
                </View>
              ) : !liveB ? (
                <Text style={{ fontSize: 12, color: txtSec, marginTop: 10 }} numberOfLines={2}>{nextStep(b)}</Text>
              ) : null}
              {liveB ? (
                <View style={{ marginTop: 12, backgroundColor: accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
                  <Text style={{ color: p.isDark && p.accent === '#4ADE80' ? '#052E16' : '#FFFFFF', fontSize: 13.5, fontWeight: '800' }}>{proofDue ? `Pay the stall · ${inr(b.amount)}` : 'View booking'}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }
        return (
          <TouchableOpacity
            key={b.id}
            activeOpacity={0.92}
            onPress={() => router.push((proofDue ? `/campus-booking/pay/${b.id}` : `/campus-booking/order/${b.id}`) as any)}
            accessibilityLabel={`In-Campus booking ${b.ref} at ${b.stall?.name || 'a campus stall'}, ${b.statusLabel}${code ? `, pickup code ${code.split('').join(' ')}` : ''}. Open`}
            style={[st.card, { backgroundColor: cardBg, borderColor: border }, lift, !isOpenStatus(b.status) && { opacity: 0.85 }]}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <View style={st.row}>
                <Text style={[st.name, { color: txt }]} numberOfLines={1}>{b.stall?.name || 'Campus stall'}</Text>
                <StatusTag status={b.status} label={b.statusLabel} />
              </View>
              <Text style={[st.meta, { color: txtSec }]} numberOfLines={1}>{`${b.ref} · ${b.itemCount} item${b.itemCount === 1 ? '' : 's'} · ${inr(b.amount)} · pickup, no delivery`}</Text>
              <Text style={[st.next, { color: txt }]} numberOfLines={2}>{nextStep(b)}</Text>
            </View>
            {code ? (
              <View style={[st.codeBox, { borderColor: accent }]}>
                <Text style={[st.codeLabel, { color: txtSec }]}>PICKUP CODE</Text>
                <Text style={[st.code, { color: txt }]} maxFontSizeMultiplier={1.2}>{code}</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={txtSec} style={{ marginLeft: 10 }} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 15, fontWeight: '700' },
  link: { fontSize: 13, fontWeight: '600' },
  rCard: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 14 },
  rImg: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#111', overflow: 'hidden' },
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  meta: { fontSize: 12.5 },
  next: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  codeBox: { marginLeft: 12, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center' },
  codeLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8 },
  code: { fontSize: 22, fontWeight: '800', letterSpacing: 4, marginTop: 2 },
});
