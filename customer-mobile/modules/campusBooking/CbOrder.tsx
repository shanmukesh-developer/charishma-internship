/**
 * Booking tracking + pickup, in the order tracking screen's look (app/tracking/[id]): header, status notes, the
 * pickup code in the Delivery PIN card style (gold code button, Enlarge), the progress timeline (Payment verified ->
 * Order accepted -> Preparing -> Ready for pickup -> Collected) with real times, the estimated ready time from the
 * stall's prep setting, every update the push notifications announced, and the order summary. Live: the server
 * nudges this student's socket room on every change.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Clipboard from '@react-native-clipboard/clipboard';
import { cbApi, type CbBooking } from './cbApi';
import { COLORS, SHADOWS, inr, timeIST, whenIST, useCbTheme } from './cbTheme';
import { CbHeader, EmptyCard, NoticeBar, PlaceButton, StaggeredSection, StatusTag, useCbLive } from './cbKit';

const mem = new Map<string, CbBooking>();

export default function CbOrder({ id }: { id: string }) {
  const p = useCbTheme();
  const router = useRouter();
  const [b, setB] = useState<CbBooking | null>(mem.get(id) || null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    try {
      const r = await cbApi.booking(id);
      mem.set(id, r.booking);
      setB(r.booking);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not load the booking.');
    } finally {
      setRefreshing(false);
    }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useCbLive((e) => { if (!e.id || e.id === id || e.kind === 'reconnect') void load(); });
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/campus-booking' as any));
  if (!b) {
    return (
      <View style={{ flex: 1, backgroundColor: p.page }}>
        <CbHeader title="Order tracking" onBack={back} />
        <View style={{ padding: 16 }}>
          {err ? <EmptyCard icon="cloud-offline-outline" title="Couldn't load the booking" sub={err} actionLabel="Try again" onAction={() => load()} /> : <EmptyCard loading title="Loading your booking" />}
        </View>
      </View>
    );
  }

  const ready = b.status === 'READY';
  const live = ['ACCEPTED', 'PREPARING', 'READY'].includes(b.status);
  const minsToReady = b.estimatedReadyAt ? Math.round((new Date(b.estimatedReadyAt).getTime() - Date.now()) / 60000) : null;
  const cancelAfterPay = b.status === 'CANCELLED' && b.paymentVerified;
  const stallName = b.stall?.name || 'the stall';
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try { const r = await cbApi.cancel(b.id); setB(r.booking); } catch (e: any) { setErr(e?.message || 'Could not cancel.'); } finally { setBusy(false); }
  };
  const copyCode = () => { if (!b.pickupCode) return; Clipboard.setString(b.pickupCode); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const currentIdx = b.timeline.findIndex((x) => !x.done);

  return (
    <View style={{ flex: 1, backgroundColor: p.page }}>
      <CbHeader title={ready ? 'Order ready' : 'Order tracking'} sub={`Booking ${b.ref} · ${stallName}`} onBack={back} right={<StatusTag status={b.status} label={b.statusLabel} />} />
      <ScrollView
        contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 600, alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={p.accent} colors={[COLORS.red]} />}
      >
        {/* Status notes */}
        {b.status === 'PAYMENT_PENDING' ? <NoticeBar icon="qr-code-outline" text="Pay the stall by UPI and send the proof to confirm this booking." style={{ marginBottom: 16 }} /> : null}
        {b.status === 'PAYMENT_REVIEW' ? <NoticeBar icon="hourglass-outline" tone="indigo" text={`${stallName} is checking your payment in its UPI app. You get a notification when it is confirmed.`} style={{ marginBottom: 16 }} /> : null}
        {b.status === 'REJECTED' ? <NoticeBar icon="alert-circle-outline" tone="red" text={`${b.rejection?.reason || 'The stall could not verify the payment'}. Send the proof again or cancel.`} style={{ marginBottom: 16 }} /> : null}
        {b.status === 'CANCELLED' ? (
          <NoticeBar icon="close-circle-outline" tone="red" text={`${b.cancellation?.reason || 'This booking was cancelled.'}${cancelAfterPay ? ` Your payment was verified, so ${stallName} returns the amount to you directly.` : ''}`} style={{ marginBottom: 16 }} />
        ) : null}
        {b.status === 'COLLECTED' ? <NoticeBar icon="checkmark-circle-outline" tone="green" text={`Collected ${whenIST(b.collectedAt)}. Thank you for using ZCS.`} style={{ marginBottom: 16 }} /> : null}

        {(b.status === 'PAYMENT_PENDING' || b.status === 'REJECTED') && b.canSubmitProof ? (
          <View style={{ marginBottom: 12 }}>
            <PlaceButton label={b.status === 'REJECTED' ? 'Send the proof again' : `Pay the stall · ${inr(b.amount)}`} onPress={() => router.push(`/campus-booking/pay/${b.id}` as any)} />
          </View>
        ) : null}
        {b.canCancel ? (
          <TouchableOpacity style={s.cancelBox} onPress={cancel} disabled={busy} accessibilityRole="button">
            <Text style={s.cancelBoxText}>{busy ? 'Cancelling…' : 'Cancel booking'}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Pickup code (Delivery PIN card style) */}
        {live && b.pickupCode ? (
          <StaggeredSection delay={0} direction="up">
            <View style={[s.pinCard, { backgroundColor: p.card, borderColor: ready ? COLORS.gold : p.border }]}>
              <View style={s.pinHeader}>
                <View style={[s.pinIconWrap, { backgroundColor: p.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(212,175,122,0.12)' }]}>
                  <Ionicons name={ready ? 'checkmark-done-outline' : 'key-outline'} size={18} color={COLORS.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.pinLabel, { color: p.txtSec }]}>{ready ? 'Order ready · Pickup code' : 'Pickup code'}</Text>
                  <Text style={[s.pinDesc, { color: p.txt }]}>{ready ? `Show this code at ${stallName}'s counter.` : 'Show this code at the counter when your order is ready.'}</Text>
                </View>
              </View>
              <View style={s.pinDisplayRow}>
                <TouchableOpacity style={[s.pinButton, ready && { paddingVertical: 18 }]} onPress={copyCode} accessibilityLabel={`Pickup code ${b.pickupCode.split('').join(' ')}. Tap to copy`}>
                  <Text style={[s.pinText, ready && { fontSize: 30, letterSpacing: 10 }]}>{b.pickupCode}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.zoomBtn, { borderColor: p.border, backgroundColor: p.isDark ? 'rgba(255,255,255,0.05)' : '#F9FAFB' }]} onPress={() => setZoom(true)} accessibilityRole="button" accessibilityLabel="Enlarge the pickup code">
                  <Text style={{ fontSize: 12, fontWeight: '600', color: p.txt }}>{copied ? 'Copied' : 'Enlarge'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </StaggeredSection>
        ) : null}

        {/* Estimated ready time */}
        {live && !ready && b.estimatedReadyAt ? (
          <View style={[s.waitBox, { backgroundColor: p.card, borderColor: p.border }]}>
            <Ionicons name="time-outline" size={20} color={COLORS.gold} />
            <View style={{ flex: 1 }}>
              <Text style={[s.waitTitle, { color: p.txt }]}>{minsToReady !== null && minsToReady > 0 ? `Ready in about ${minsToReady} min` : 'Should be ready about now'}</Text>
              <Text style={[s.waitSub, { color: p.txtSec }]}>{`Estimated ready time ${timeIST(b.estimatedReadyAt)}, from ${stallName}'s usual prep time (${b.prepMinutes} min).`}</Text>
            </View>
          </View>
        ) : null}

        {/* Progress */}
        {b.status !== 'CANCELLED' ? (
          <StaggeredSection delay={80} direction="up">
            <View style={[s.timelineCard, { backgroundColor: p.card, borderColor: p.border }]}>
              <Text style={[s.cardLabel, { color: p.txtSec }]}>Order progress</Text>
              {b.timeline.map((step, i) => {
                const last = i === b.timeline.length - 1;
                const isCurrent = i === currentIdx && live;
                const pendingColor = p.isDark ? '#2D3748' : '#E2E8F0';
                return (
                  <View key={step.key} style={s.stepRow}>
                    <View style={s.nodeCol}>
                      <View style={[s.dot, step.done ? { backgroundColor: COLORS.gold } : isCurrent ? { backgroundColor: p.card, borderWidth: 2, borderColor: COLORS.gold } : { backgroundColor: pendingColor }]}>
                        {step.done ? <Ionicons name="checkmark" size={14} color="#FFF" /> : isCurrent ? <View style={s.dotInner} /> : null}
                      </View>
                      {!last ? <View style={[s.line, { backgroundColor: b.timeline[i + 1].done ? COLORS.gold : pendingColor }]} /> : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={[s.stepLabel, { color: isCurrent ? COLORS.gold : step.done ? p.txt : p.txtSec }]}>{step.label}</Text>
                        {step.at ? <Text style={[s.stepTime, { color: p.txtSec }]}>{timeIST(step.at)}</Text> : isCurrent ? <Text style={[s.stepTime, { color: COLORS.gold }]}>Now</Text> : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </StaggeredSection>
        ) : null}

        {/* Updates */}
        <View style={[s.timelineCard, { backgroundColor: p.card, borderColor: p.border }]}>
          <Text style={[s.cardLabel, { color: p.txtSec }]}>Updates</Text>
          {updatesOf(b).map((u, i) => (
            <View key={`${u.title}-${i}`} style={[s.updateRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border }]}>
              <Ionicons name={u.icon as any} size={16} color={u.tone === 'red' ? COLORS.red : COLORS.gold} />
              <View style={{ flex: 1 }}>
                <Text style={[s.updateTitle, { color: p.txt }]}>{u.title}</Text>
                <Text style={[s.updateSub, { color: p.txtSec }]}>{u.body}</Text>
              </View>
              <Text style={[s.stepTime, { color: p.txtSec }]}>{timeIST(u.at)}</Text>
            </View>
          ))}
        </View>

        {/* Order summary */}
        <View style={[s.timelineCard, { backgroundColor: p.card, borderColor: p.border }]}>
          <Text style={[s.cardLabel, { color: p.txtSec }]}>Order summary · {stallName}</Text>
          {b.items.map((it, idx) => (
            <View key={idx} style={s.summaryRow}>
              <Text style={[s.summaryItem, { color: p.txt }]} numberOfLines={2}>{it.quantity} × {it.name}</Text>
              <Text style={[s.summaryItem, { color: p.txt, flex: 0 }]}>{inr(it.lineTotal)}</Text>
            </View>
          ))}
          <View style={[s.summaryDivider, { backgroundColor: p.border }]} />
          <View style={s.summaryRow}>
            <Text style={[s.summaryTotalLabel, { color: p.txt }]}>{b.paymentVerified ? `Paid to ${stallName} by UPI` : `Pay ${stallName} by UPI`}</Text>
            <Text style={[s.summaryTotal, { color: p.txt }]}>{inr(b.amount)}</Text>
          </View>
          {b.proof.submittedAt ? (
            <Text style={[s.summaryAddress, { color: p.txtSec }]}>
              {`Proof sent ${whenIST(b.proof.submittedAt)}${b.proof.ref ? ` · UPI ref ${b.proof.ref}` : ''}${b.proof.hasImage ? ' · screenshot' : ''}`}
            </Text>
          ) : null}
          {b.note ? <Text style={[s.summaryAddress, { color: p.txtSec }]}>Note: {b.note}</Text> : null}
          <Text style={[s.summaryAddress, { color: p.txtSec }]}>Booked {whenIST(b.createdAt)} · pickup at the counter</Text>
        </View>

        {/* Quick actions (tracking action row) */}
        <View style={s.actionRow}>
          {b.stall ? (
            <TouchableOpacity style={[s.actionBtn, { backgroundColor: p.card, borderColor: p.border }]} onPress={() => router.push(`/campus-booking/stall/${b.stall!.id}` as any)} accessibilityRole="button" accessibilityLabel="Visit stall">
              <Ionicons name="storefront-outline" size={16} color={p.txt} />
              <Text style={[s.actionBtnText, { color: p.txt }]}>Visit stall</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[s.actionBtn, { backgroundColor: p.card, borderColor: p.border }]} onPress={() => router.push('/support' as any)} accessibilityRole="button" accessibilityLabel="Help">
            <Ionicons name="help-buoy-outline" size={16} color={p.txt} />
            <Text style={[s.actionBtnText, { color: p.txt }]}>Help</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Enlarged pickup code (the tracking screen's enlarged PIN) */}
      <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setZoom(false)} accessibilityLabel="Close" />
          <View style={[s.zoomPinBox, { backgroundColor: p.card, borderColor: p.border }]}>
            <Text style={s.zoomTitle}>Pickup code</Text>
            <Text style={[s.zoomDesc, { color: p.txtSec }]}>Show this code at {stallName}'s counter</Text>
            <View style={s.zoomPinDisplay}><Text style={s.zoomPinText}>{b.pickupCode}</Text></View>
            <TouchableOpacity style={s.zoomCloseBtn} onPress={() => setZoom(false)}><Text style={s.zoomCloseText}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

type Update = { title: string; body: string; at: string; icon: string; tone: 'gold' | 'red' };
/** One line per thing that happened, newest first (the same steps the push notifications announce). */
const updatesOf = (b: CbBooking): Update[] => {
  const s = b.stall?.name || 'The stall';
  const out: Update[] = [];
  if (b.createdAt) out.push({ title: 'Booked', body: `Booking ${b.ref} made at ${s}.`, at: b.createdAt, icon: 'bag-check-outline', tone: 'gold' });
  if (b.proof.submittedAt) out.push({ title: 'Payment proof sent', body: `${s} is checking your payment.`, at: b.proof.submittedAt, icon: 'cloud-upload-outline', tone: 'gold' });
  if (b.rejection?.at) out.push({ title: 'Payment not verified', body: b.rejection.reason || 'The stall could not verify the payment.', at: b.rejection.at, icon: 'alert-circle-outline', tone: 'red' });
  if (b.acceptedAt) out.push({ title: 'Order accepted', body: `${s} verified your payment and accepted the order.`, at: b.acceptedAt, icon: 'checkmark-done-outline', tone: 'gold' });
  const prep = b.timeline.find((x) => x.key === 'PREPARING');
  if (prep?.at) out.push({ title: 'Preparing your order', body: `${s} is preparing it.`, at: prep.at, icon: 'flame-outline', tone: 'gold' });
  if (b.readyAt) out.push({ title: 'Ready for pickup', body: 'Show your pickup code at the counter.', at: b.readyAt, icon: 'storefront-outline', tone: 'gold' });
  if (b.collectedAt) out.push({ title: 'Order completed', body: 'Collected at the stall. Thank you for using ZCS.', at: b.collectedAt, icon: 'checkmark-circle-outline', tone: 'gold' });
  if (b.cancelledAt) out.push({ title: 'Booking cancelled', body: b.cancellation?.reason || 'This booking was cancelled.', at: b.cancelledAt, icon: 'close-circle-outline', tone: 'red' });
  return out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
};

const s = StyleSheet.create({
  cancelBox: { paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(239,79,95,0.2)', backgroundColor: 'rgba(239,79,95,0.06)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  cancelBoxText: { fontSize: 13, fontWeight: '700', color: COLORS.red, letterSpacing: 0.2 },
  pinCard: { padding: 16, borderRadius: 20, borderWidth: 1, marginBottom: 16 },
  pinHeader: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  pinIconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pinLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  pinDesc: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  pinDisplayRow: { flexDirection: 'row', gap: 8 },
  pinButton: { flex: 1, backgroundColor: COLORS.gold, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, ...SHADOWS.goldGlow },
  pinText: { fontSize: 18, fontWeight: '700', color: '#000', letterSpacing: 6 },
  zoomBtn: { paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  waitBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  waitTitle: { fontSize: 14, fontWeight: '600' },
  waitSub: { fontSize: 12, fontWeight: '500', marginTop: 3, lineHeight: 17 },
  timelineCard: { padding: 16, borderRadius: 24, borderWidth: 1, marginBottom: 16 },
  cardLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2, marginBottom: 12 },
  stepRow: { flexDirection: 'row', gap: 12 },
  nodeCol: { alignItems: 'center', width: 26 },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.gold },
  line: { width: 2, flex: 1, marginVertical: 4, minHeight: 16 },
  stepLabel: { fontSize: 13, fontWeight: '600' },
  stepTime: { fontSize: 12, fontWeight: '500' },
  updateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  updateTitle: { fontSize: 13, fontWeight: '600' },
  updateSub: { fontSize: 12, marginTop: 2 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, gap: 8 },
  summaryItem: { flex: 1, fontSize: 12, fontWeight: '600' },
  summaryDivider: { height: 1, marginVertical: 10 },
  summaryTotalLabel: { fontSize: 12, fontWeight: '600', flex: 1 },
  summaryTotal: { fontSize: 15, fontWeight: '700' },
  summaryAddress: { fontSize: 12, fontWeight: '600', marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, borderWidth: 1, ...SHADOWS.card },
  actionBtnText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  zoomPinBox: { width: '90%', padding: 24, borderRadius: 24, borderWidth: 1, alignItems: 'center' },
  zoomTitle: { fontSize: 15, fontWeight: '700', color: COLORS.gold, letterSpacing: 0.2, marginBottom: 4 },
  zoomDesc: { fontSize: 12, fontWeight: '700', marginBottom: 20 },
  zoomPinDisplay: { width: '100%', backgroundColor: COLORS.gold, paddingVertical: 20, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 20, ...SHADOWS.goldGlow },
  zoomPinText: { fontSize: 48, fontWeight: '700', color: '#000', letterSpacing: 10 },
  zoomCloseBtn: { width: '100%', paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center' },
  zoomCloseText: { fontSize: 12, fontWeight: '600', color: '#888' },
});
