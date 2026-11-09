/**
 * Booking tracking + pickup, in the order tracking screen's look (app/tracking/[id]): header, status notes, the
 * pickup code in the Delivery PIN card style (gold code button, Enlarge), the progress timeline (Payment verified ->
 * Order accepted -> Preparing -> Ready for pickup -> Collected) with real times, the estimated ready time from the
 * stall's prep setting, every update the push notifications announced, and the order summary. Live: the server
 * nudges this student's socket room on every change.
 */
import { useDietLight } from '../../components/local/dietLightTheme';
import { useTopInset } from '../../utils/useTopInset';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Modal, RefreshControl, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { resolveMediaUrl } from '../../utils/imageUpload';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Clipboard from '@react-native-clipboard/clipboard';
import { serverNow } from '../../utils/serverClock';
import { cbApi, type CbBooking } from './cbApi';
import { COLORS, SHADOWS, inr, timeIST, whenIST, useCbTheme } from './cbTheme';
import { CbHeader, EmptyCard, NoticeBar, PlaceButton, StaggeredSection, StatusTag, useCbLive } from './cbKit';

const mem = new Map<string, CbBooking>();

export default function CbOrder({ id }: { id: string }) {
  const d = useDietLight();
  const topPad = useTopInset();
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
  // Owner, 10 Nov 2026: the gold of this screen follows the diet accent in light mode.
  const gold = p.accent;
  // The old dark layout stays in the file but no longer renders (owner, 10 Nov 2026: dark gets the new look).
  const legacy = false as boolean;
  const live = ['ACCEPTED', 'PREPARING', 'READY'].includes(b.status);
  const minsToReady = b.estimatedReadyAt ? Math.round((new Date(b.estimatedReadyAt).getTime() - serverNow()) / 60000) : null;
  const cancelAfterPay = b.status === 'CANCELLED' && b.paymentVerified;
  // Cancelled while the stall was still checking a payment the student had already sent: by the stall, by the
  // student (allowed while the payment is in review), or by the review deadline. The money goes back the same way.
  const cancelInReview = b.status === 'CANCELLED' && !b.paymentVerified && !!b.proof?.submittedAt;
  const stallName = b.stall?.name || 'the stall';
  // The stall's reasons have no full stop, the student / system ones do: end with exactly one before the refund line.
  const cancelReason = `${(b.cancellation?.reason || 'This booking was cancelled').trim().replace(/\.+$/, '')}.`;
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try { const r = await cbApi.cancel(b.id); setB(r.booking); } catch (e: any) { setErr(e?.message || 'Could not cancel.'); } finally { setBusy(false); }
  };
  const copyCode = () => { if (!b.pickupCode) return; Clipboard.setString(b.pickupCode); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const currentIdx = b.timeline.findIndex((x) => !x.done);

  return (
    <View style={{ flex: 1, backgroundColor: p.page }}>
      {legacy ? (
        <CbHeader title={ready ? 'Order ready' : 'Order tracking'} sub={`Booking ${b.ref} · ${stallName}`} onBack={back} right={<StatusTag status={b.status} label={b.statusLabel} />} />
      ) : (
        <View style={[s.band, { backgroundColor: d.top, paddingTop: topPad + 8 }]}>
          <TouchableOpacity onPress={back} style={[s.bandBack, { backgroundColor: p.card }]} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={20} color={d.dk} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.bandTitle, { color: d.dk }]} numberOfLines={1} accessibilityRole="header">{ready ? 'Order ready' : 'Order tracking'}</Text>
            <Text style={{ fontSize: 12, color: d.dk, opacity: 0.7 }} numberOfLines={1}>{`${stallName} · pickup at the counter · ${b.ref}`}</Text>
          </View>
          <StatusTag status={b.status} label={b.statusLabel} />
        </View>
      )}
      <ScrollView
        contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 600, alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={p.accent} colors={[COLORS.red]} />}
      >
        {/* Status notes */}
        {b.status === 'PAYMENT_PENDING' ? <NoticeBar icon="qr-code-outline" text="Pay the stall by UPI and send the proof to confirm this booking." style={{ marginBottom: 16 }} /> : null}
        {b.status === 'PAYMENT_REVIEW' ? <NoticeBar icon="hourglass-outline" tone="indigo" text={`${stallName} is checking your payment in its UPI app. You get a notification when it is confirmed.`} style={{ marginBottom: 16 }} /> : null}
        {b.status === 'REJECTED' ? <NoticeBar icon="alert-circle-outline" tone="red" text={`${b.rejection?.reason || 'The stall could not verify the payment'}. Send the proof again or cancel.`} style={{ marginBottom: 16 }} /> : null}
        {b.status === 'CANCELLED' ? (
          <NoticeBar icon="close-circle-outline" tone="red" text={`${cancelReason}${cancelAfterPay ? ` Your payment was verified, so ${stallName} returns the amount to you directly.` : cancelInReview ? ` If you paid, ${stallName} returns the amount to you directly.` : ''}`} style={{ marginBottom: 16 }} />
        ) : null}
        {b.status === 'COLLECTED' ? <NoticeBar icon="checkmark-circle-outline" tone="green" text={`Collected ${whenIST(b.collectedAt)}. Thank you for using ZenWe.`} style={{ marginBottom: 16 }} /> : null}

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

        {/* v7StatusCard: the replica's tracking card (light mode) */}
        {b.status !== 'CANCELLED' ? (() => {
          const steps = b.timeline;
          const short = (l: string) => {
            const x = l.toLowerCase();
            return x.includes('payment') ? 'Paid' : x.includes('accept') ? 'Accepted' : x.includes('prepar') ? 'Preparing' : x.includes('ready') ? 'Ready' : x.includes('collect') ? 'Collected' : l;
          };
          const doneN = steps.filter((x) => x.done).length;
          const img = resolveMediaUrl(b.stall?.imageUrl || '') || null;
          const sub = ready ? `Show your code at ${stallName}'s counter` : live && b.estimatedReadyAt ? (minsToReady !== null && minsToReady > 0 ? `Ready in about ${minsToReady} min` : `Should be ready about now · ${timeIST(b.estimatedReadyAt)}`) : null;
          return (
            <StaggeredSection delay={0} direction="up">
              <View style={[s.v7Card, { backgroundColor: p.card, borderColor: p.border }]}>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: p.txtSec }}>Current status</Text>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: p.txt, marginTop: 2 }}>{b.statusLabel}</Text>
                    {sub ? (
                      <View style={[s.etaPill, { backgroundColor: p.accentSoft, alignSelf: 'flex-start', marginTop: 8, marginBottom: 0 }]}>
                        <Ionicons name="time-outline" size={13} color={p.accent} />
                        <Text style={{ fontSize: 12, fontWeight: '800', color: p.accent }}>{sub}</Text>
                      </View>
                    ) : null}
                  </View>
                  {img ? <View style={[s.v7Img, { backgroundColor: '#111', overflow: 'hidden' }]}><Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /></View> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 18 }}>
                  {steps.map((x, i) => (
                    <View key={x.key} style={{ flex: 1, height: 4, borderRadius: 3, backgroundColor: p.isDark ? 'rgba(255,255,255,0.12)' : '#ECEEF3', overflow: 'hidden' }}>
                      {x.done ? <View style={{ flex: 1, backgroundColor: p.accent }} /> : i === doneN && live ? <View style={{ width: '50%', height: '100%', backgroundColor: p.accent }} /> : null}
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', marginTop: 6 }}>
                  {steps.map((x, i) => (
                    <Text key={x.key} style={{ flex: 1, textAlign: i === 0 ? 'left' : i === steps.length - 1 ? 'right' : 'center', fontSize: 10, fontWeight: '700', color: i === doneN && live ? p.accent : p.txtSec }} numberOfLines={1}>{short(x.label)}</Text>
                  ))}
                </View>
              </View>
              {live && b.pickupCode ? (
                <View style={[s.v7Pin, { backgroundColor: p.accentSoft }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: d.dk, opacity: 0.85 }}>Pickup code</Text>
                    <Text style={{ fontSize: 11.5, color: d.dk, opacity: 0.8 }}>{copied ? 'Copied' : 'Show it at the counter'}</Text>
                    <TouchableOpacity onPress={() => setZoom(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Enlarge the pickup code">
                      <Text style={{ fontSize: 12, fontWeight: '800', color: p.accent, marginTop: 4 }}>Enlarge</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={copyCode} accessibilityRole="button" accessibilityLabel={`Pickup code ${b.pickupCode.split('').join(' ')}. Tap to copy`}>
                    <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: 6, color: p.accent }}>{b.pickupCode}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {[
                  ...(b.stall ? [{ icon: 'storefront-outline', label: 'Visit stall', on: () => router.push(`/campus-booking/stall/${b.stall!.id}` as any) }] : []),
                  { icon: 'help-circle-outline', label: 'Help', on: () => router.push('/support' as any) },
                  { icon: 'share-social-outline', label: 'Share', on: () => { Share.share({ message: `My ZenWe booking ${b.ref} at ${stallName}${b.pickupCode ? ` · pickup code ${b.pickupCode}` : ''}` }).catch(() => {}); } },
                ].map((a) => (
                  <TouchableOpacity key={a.label} onPress={a.on} style={[s.v7Tile, { backgroundColor: p.card, borderColor: p.border }]} accessibilityRole="button">
                    <Ionicons name={a.icon as any} size={20} color={p.accent} />
                    <Text style={{ fontSize: 12, fontWeight: '800', color: p.txt }}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </StaggeredSection>
          );
        })() : null}
        {legacy && live && b.pickupCode ? (
          <StaggeredSection delay={0} direction="up">
            <View style={[s.pinCard, { backgroundColor: p.card, borderColor: ready ? gold : p.border }]}>
              <View style={s.pinHeader}>
                <View style={[s.pinIconWrap, { backgroundColor: p.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(212,175,122,0.12)' }]}>
                  <Ionicons name={ready ? 'checkmark-done-outline' : 'key-outline'} size={18} color={gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.pinLabel, { color: p.txtSec }]}>{ready ? 'Order ready · Pickup code' : 'Pickup code'}</Text>
                  <Text style={[s.pinDesc, { color: p.txt }]}>{ready ? `Show this code at ${stallName}'s counter.` : 'Show this code at the counter when your order is ready.'}</Text>
                </View>
              </View>
              <View style={s.pinDisplayRow}>
                <TouchableOpacity style={[s.pinButton, { backgroundColor: gold, shadowColor: gold }, ready && { paddingVertical: 18 }]} onPress={copyCode} accessibilityLabel={`Pickup code ${b.pickupCode.split('').join(' ')}. Tap to copy`}>
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
        {legacy && live && !ready && b.estimatedReadyAt ? (
          <View style={[s.waitBox, { backgroundColor: p.card, borderColor: p.border }]}>
            <Ionicons name="time-outline" size={20} color={gold} />
            <View style={{ flex: 1 }}>
              <Text style={[s.waitTitle, { color: p.txt }]}>{minsToReady !== null && minsToReady > 0 ? `Ready in about ${minsToReady} min` : 'Should be ready about now'}</Text>
              <Text style={[s.waitSub, { color: p.txtSec }]}>{`Estimated ready time ${timeIST(b.estimatedReadyAt)}, from ${stallName}'s usual prep time (${b.prepMinutes} min).`}</Text>
            </View>
          </View>
        ) : null}

        {/* Progress */}
        {legacy && b.status !== 'CANCELLED' ? (
          <StaggeredSection delay={80} direction="up">
            <View style={[s.timelineCard, { backgroundColor: p.card, borderColor: p.border }]}>
              <Text style={[s.cardLabel, { color: p.txtSec }, s.cardLabelCaps]}>Order progress</Text>
              {b.timeline.map((step, i) => {
                const last = i === b.timeline.length - 1;
                const isCurrent = i === currentIdx && live;
                const pendingColor = p.isDark ? '#2D3748' : '#E2E8F0';
                return (
                  <View key={step.key} style={s.stepRow}>
                    <View style={s.nodeCol}>
                      <View style={[s.dot, step.done ? { backgroundColor: gold } : isCurrent ? { backgroundColor: p.card, borderWidth: 2, borderColor: gold, ...(p.isDark ? null : { shadowColor: gold, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }) } : (p.isDark ? { backgroundColor: pendingColor } : { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#D9DBE3' })]}>
                        {step.done ? <Ionicons name="checkmark" size={14} color="#FFF" /> : isCurrent ? <View style={[s.dotInner, { backgroundColor: gold }]} /> : null}
                      </View>
                      {!last ? <View style={[s.line, { backgroundColor: b.timeline[i + 1].done ? gold : pendingColor }]} /> : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={[s.stepLabel, { color: isCurrent ? gold : step.done ? p.txt : p.txtSec }]}>{step.label}</Text>
                        {step.at ? <Text style={[s.stepTime, { color: p.txtSec }]}>{timeIST(step.at)}</Text> : isCurrent ? <Text style={[s.stepTime, { color: gold }]}>Now</Text> : null}
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
          <Text style={[s.cardLabel, { color: p.txtSec }, s.cardLabelCaps]}>Updates</Text>
          {updatesOf(b).map((u, i) => (
            <View key={`${u.title}-${i}`} style={[s.updateRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border }]}>
              <Ionicons name={u.icon as any} size={16} color={u.tone === 'red' ? COLORS.red : p.accent} />
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
          <Text style={[s.cardLabel, { color: p.txtSec }, s.cardLabelCaps]}>Order summary · {stallName}</Text>
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
          {/* Stationery / print: the PDFs sent with the booking (signed links, valid about an hour) */}
          {(b.documents || []).map((d) => (
            <TouchableOpacity
              key={d.id}
              disabled={!d.url}
              onPress={() => { if (d.url) Linking.openURL(d.url).catch(() => {}); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Open ${d.name}`}
            >
              <Ionicons name="document-text-outline" size={16} color={p.accent} />
              <Text style={[s.summaryAddress, { color: p.txt, flex: 1, marginTop: 0 }]} numberOfLines={1}>{d.name}</Text>
              {d.url ? <Ionicons name="open-outline" size={14} color={p.txtSec} /> : null}
            </TouchableOpacity>
          ))}
          <Text style={[s.summaryAddress, { color: p.txtSec }]}>Booked {whenIST(b.createdAt)} · pickup at the counter</Text>
        </View>

        {/* Quick actions (tracking action row) - dark mode; light mode has the tiles */}
        <View style={[s.actionRow, { display: 'none' }]}>
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
            <Text style={[s.zoomTitle, { color: gold }]}>Pickup code</Text>
            <Text style={[s.zoomDesc, { color: p.txtSec }]}>Show this code at {stallName}'s counter</Text>
            <View style={[s.zoomPinDisplay, { backgroundColor: gold, shadowColor: gold }]}><Text style={s.zoomPinText}>{b.pickupCode}</Text></View>
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
  if (b.collectedAt) out.push({ title: 'Order completed', body: 'Collected at the stall. Thank you for using ZenWe.', at: b.collectedAt, icon: 'checkmark-circle-outline', tone: 'gold' });
  if (b.cancelledAt) out.push({ title: 'Booking cancelled', body: b.cancellation?.reason || 'This booking was cancelled.', at: b.cancelledAt, icon: 'close-circle-outline', tone: 'red' });
  return out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
};

const s = StyleSheet.create({
  v7Card: { backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 12, overflow: 'hidden' },
  v7Img: { width: 86, height: 86, borderRadius: 18, marginTop: -2, marginRight: -2 },
  v7Pin: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, marginBottom: 12 },
  v7Tile: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 12, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1 },
  band: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  bandBack: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  bandTitle: { fontSize: 18, fontWeight: '800' },
  ticketCard: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', backgroundColor: '#FFFFFF', marginBottom: 12 },
  ticketCode: { fontSize: 36, fontWeight: '900', letterSpacing: 9, marginVertical: 4 },
  etaPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginBottom: 14 },
  cardLabelCaps: { textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 11.5, fontWeight: '800' },
  cancelBox: { paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(239,79,95,0.2)', backgroundColor: 'rgba(239,79,95,0.06)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  cancelBoxText: { fontSize: 13, fontWeight: '700', color: COLORS.red, letterSpacing: 0.2 },
  pinCard: { padding: 16, borderRadius: 20, borderWidth: 1, marginBottom: 16 },
  pinHeader: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  pinIconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pinLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  pinDesc: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  pinDisplayRow: { flexDirection: 'row', gap: 8 },
  pinButton: { flex: 1, backgroundColor: COLORS.gold, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, ...SHADOWS.goldGlow },
  pinText: { fontSize: 18, fontWeight: '700', color: '#FFF', letterSpacing: 6 },
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
  zoomPinText: { fontSize: 48, fontWeight: '700', color: '#FFF', letterSpacing: 10 },
  zoomCloseBtn: { width: '100%', paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center' },
  zoomCloseText: { fontSize: 12, fontWeight: '600', color: '#888' },
});
