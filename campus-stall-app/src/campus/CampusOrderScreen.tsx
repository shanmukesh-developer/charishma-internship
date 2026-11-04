// One In-Campus Booking (owner board vendor screens 3 and 4): payment verification (the student's screenshot,
// the UPI ID they paid, the reference, time and amount) with Reject / Confirm payment, then Start preparing,
// Mark as ready, Hand over (type the student's pickup code) or Cancel order. Every action waits for the server.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NetImage } from '../components/NetImage';
import { campusApi, inr, timeIST, type CbReason, type CbVendorBooking } from '../lib/campusApi';
import { ApiError, errorMessage } from '../lib/http';
import { color, font, mono, radius, space, touch } from '../theme';
import { Button, Card, Chip, EmptyState, Sheet, kit } from '../ui/kit';
import { useToast } from '../ui/Toast';
import { ScreenHeader, StatusBadge, Timeline } from './CampusParts';
import { useCampusLive } from './useCampusLive';

const FALLBACK_REJECT: CbReason[] = [
  { code: 'NOT_RECEIVED', label: 'Payment not received in the stall UPI account' },
  { code: 'AMOUNT_MISMATCH', label: 'The amount paid does not match the order total' },
  { code: 'UNCLEAR', label: 'The screenshot or reference could not be checked' },
];
const FALLBACK_CANCEL: CbReason[] = [
  { code: 'OUT_OF_STOCK', label: 'An item is out of stock' },
  { code: 'CLOSING', label: 'The stall is closing' },
  { code: 'TOO_BUSY', label: 'The stall is too busy right now' },
];

function Row({ label, value, strong, mono: m }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <View style={kit.row}>
      <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>{label}</Text>
      <Text style={[font.body, m ? mono : null, { color: color.text, fontWeight: strong ? '800' : '600', textAlign: 'right', flexShrink: 1 }]} selectable>{value}</Text>
    </View>
  );
}

export default function CampusOrderScreen({ bookingId, onBack }: { bookingId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [b, setB] = useState<CbVendorBooking | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'reject' | 'cancel' | 'code' | null>(null);
  const [zoom, setZoom] = useState(false);
  // Pickup-code pause (server 429 CODE_LOCKED after too many wrong codes): the hand-over button waits it out.
  const [codeLockedUntil, setCodeLockedUntil] = useState<number | null>(null);
  const [reasons, setReasons] = useState<{ reject: CbReason[]; cancel: CbReason[] }>({ reject: FALLBACK_REJECT, cancel: FALLBACK_CANCEL });
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await campusApi.get(bookingId);
      setB(r.booking);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errorMessage(e, "Couldn't load this booking."));
    }
  }, [bookingId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    campusApi.settings().then((r) => setReasons({ reject: r.settings.rejectReasons, cancel: r.settings.cancelReasons })).catch(() => {});
  }, []);
  useCampusLive((e) => { if (!e.id || e.id === bookingId) void load(); });

  const run = async (key: string, fn: () => Promise<{ booking: CbVendorBooking }>, done?: string, onErr?: (e: unknown) => void) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(key);
    setActionErr(null);
    try {
      const r = await fn();
      setB(r.booking);
      if (done) toast.show(done, 'success');
      return true;
    } catch (e) {
      setActionErr(errorMessage(e, "Couldn't save. Please try again."));
      if (e instanceof ApiError && (e.code === 'CHANGED' || e.code === 'BAD_TRANSITION')) void load();
      onErr?.(e);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  if (!b) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <ScreenHeader title="Booking" onBack={onBack} />
        <EmptyState icon="bag-check-outline" title={loadErr ? "Couldn't load the booking" : 'Loading…'} body={loadErr || undefined} action={loadErr ? { label: 'Try again', onPress: load } : undefined} />
      </View>
    );
  }

  const review = b.status === 'PAYMENT_REVIEW';
  const canCancel = ['PAYMENT_REVIEW', 'ACCEPTED', 'PREPARING', 'READY'].includes(b.status);
  const proofUri = b.proof.imageUrl;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <ScreenHeader title={`#${b.ref}`} sub={`${b.customer.firstName} · ${b.itemCount} item${b.itemCount === 1 ? '' : 's'} · ${inr(b.amount)}`} onBack={onBack} right={<StatusBadge status={b.status} />} />
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xxl * 3 + insets.bottom }}>
        {/* Payment verification */}
        {b.proof.submittedAt || review ? (
          <Card style={{ gap: space.sm }}>
            <Text style={[font.h3, { color: color.text }]}>Payment proof</Text>
            {proofUri ? (
              <Pressable onPress={() => setZoom(true)} accessibilityRole="button" accessibilityLabel="Open the payment screenshot full screen">
                <NetImage uri={proofUri} style={styles.proof} resizeMode="contain" accessibilityLabel="Payment screenshot" fallback={<View style={[styles.proof, styles.noProof]}><Text style={[font.small, { color: color.textMuted }]}>Screenshot could not load</Text></View>} />
                <Text style={[font.small, { color: color.textMuted, textAlign: 'center', marginTop: 4 }]}>Tap to zoom</Text>
              </Pressable>
            ) : b.proof.hasImage ? null : (
              <Text style={[font.small, { color: color.textMuted }]}>No screenshot. The student sent the UPI reference only.</Text>
            )}
            <Row label="Paid to (your UPI ID)" value={b.payeeUpiId || '–'} />
            <Row label="UPI reference" value={b.proof.ref || 'Not given'} mono={!!b.proof.ref} />
            <Row label="Sent at" value={timeIST(b.proof.submittedAt)} />
            <Row label="Amount to check" value={inr(b.amount)} strong />
            {b.proof.attempts > 1 ? <Text style={[font.small, { color: color.warning, fontWeight: '700' }]}>Sent again (attempt {b.proof.attempts}).</Text> : null}
            {review ? (
              <Text style={[font.small, { color: color.textSecondary }]}>Open your UPI app and check that {inr(b.amount)} arrived{b.proof.ref ? ` with reference ${b.proof.ref}` : ''} before you confirm.</Text>
            ) : null}
          </Card>
        ) : null}

        {b.status === 'PAYMENT_PENDING' ? (
          <Card><Text style={[font.body, { color: color.textSecondary }]}>Waiting for the student to pay {inr(b.amount)} and send the proof. It is cancelled automatically if no proof arrives in 20 minutes.</Text></Card>
        ) : null}
        {b.status === 'REJECTED' ? (
          <Card style={{ gap: 4 }}>
            <Text style={[font.h3, { color: color.alertDark }]}>You rejected this payment</Text>
            <Text style={[font.body, { color: color.textSecondary }]}>{b.rejection?.reason}. The student can send the proof again or cancel.</Text>
          </Card>
        ) : null}
        {b.status === 'CANCELLED' ? (
          <Card style={{ gap: 4 }}>
            <Text style={[font.h3, { color: color.alertDark }]}>Cancelled{b.cancellation?.by === 'student' ? ' by the student' : b.cancellation?.by === 'system' ? ' (not paid in time)' : ''}</Text>
            <Text style={[font.body, { color: color.textSecondary }]}>{b.cancellation?.reason}</Text>
            {b.paymentVerifiedAt ? <Text style={[font.body, { color: color.warning, fontWeight: '700' }]}>You confirmed this payment. Return {inr(b.amount)} to the student.</Text> : null}
          </Card>
        ) : null}

        {/* Items */}
        <Card style={{ gap: space.xs }}>
          <Text style={[font.h3, { color: color.text }]}>Items</Text>
          {b.items.map((it, i) => (
            <View key={`${it.menuItemId}-${i}`} style={kit.row}>
              <View style={[styles.veg, { borderColor: it.isVeg ? color.veg : color.nonVeg }]}><View style={[styles.vegDot, { backgroundColor: it.isVeg ? color.veg : color.nonVeg }]} /></View>
              <Text style={[font.item, { color: color.text, flex: 1 }]}>{it.quantity} x {it.name}</Text>
              <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{inr(it.lineTotal)}</Text>
            </View>
          ))}
          {b.note ? <Text style={[font.body, { color: color.warning, fontWeight: '700', marginTop: 4 }]}>Note: {b.note}</Text> : null}
          {/* Stationery / print: the student's PDFs. Open downloads the file (link valid about an hour; reopen the booking for a fresh one). */}
          {(b.documents || []).length ? (
            <View style={{ gap: space.xs, marginTop: space.xs }}>
              <Text style={[font.body, { color: color.text, fontWeight: '800' }]}>Files to print ({(b.documents || []).length})</Text>
              {(b.documents || []).map((d) => (
                <Pressable
                  key={d.id}
                  disabled={!d.url}
                  onPress={() => { if (d.url) Linking.openURL(d.url).catch(() => toast.show('Could not open the file. Reopen this booking and try again.', 'error')); }}
                  style={({ pressed }) => [kit.row, { gap: space.sm, paddingVertical: 6, opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${d.name}`}
                >
                  <Ionicons name="document-text-outline" size={22} color={color.primary} />
                  <Text style={[font.body, { color: color.text, flex: 1 }]} numberOfLines={1}>{d.name}</Text>
                  <Text style={[font.body, { color: color.primary, fontWeight: '800' }]}>{d.url ? 'Open' : ''}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={[kit.divider, { marginVertical: space.xs }]} />
          <Row label="Total paid by the student" value={inr(b.amount)} strong />
          <Row label={`ZenWe commission ${b.commissionPct}%`} value={`- ${inr(b.commission)}`} />
          <Row label="Your amount" value={inr(b.net)} strong />
        </Card>

        {/* Progress */}
        {b.status !== 'CANCELLED' ? (
          <Card style={{ gap: space.sm }}>
            <Text style={[font.h3, { color: color.text }]}>Progress</Text>
            <Timeline steps={b.timeline} />
            {b.estimatedReadyAt && ['ACCEPTED', 'PREPARING'].includes(b.status) ? (
              <Text style={[font.small, { color: color.textSecondary }]}>The student was told it is ready by {timeIST(b.estimatedReadyAt)} ({b.prepMinutes} min).</Text>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>

      {/* Actions */}
      {review || canCancel ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + space.sm }]}>
          {actionErr ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700' }]} accessibilityLiveRegion="polite">{actionErr}</Text> : null}
          {review ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Reject" variant="rejectOutline" onPress={() => setSheet('reject')} style={{ flex: 1 }} disabled={!!busy} />
              <Button label="Confirm payment" variant="accept" icon="checkmark" onPress={() => run('confirm', () => campusApi.confirmPayment(b.id), 'Payment confirmed. The student was told.')} loading={busy === 'confirm'} style={{ flex: 2 }} />
            </View>
          ) : null}
          {b.status === 'ACCEPTED' ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Start preparing" variant="secondary" onPress={() => run('prep', () => campusApi.preparing(b.id))} loading={busy === 'prep'} style={{ flex: 1 }} />
              <Button label="Mark as ready" variant="accept" icon="checkmark-done" onPress={() => run('ready', () => campusApi.ready(b.id), 'Marked ready. The student was told.')} loading={busy === 'ready'} style={{ flex: 1 }} />
            </View>
          ) : null}
          {b.status === 'PREPARING' ? (
            <Button label="Mark as ready" variant="accept" icon="checkmark-done" onPress={() => run('ready', () => campusApi.ready(b.id), 'Marked ready. The student was told.')} loading={busy === 'ready'} />
          ) : null}
          {/* The student has the code from the moment the order is accepted: the stall can hand over from here too
              (the server checks the code, then completes the order). */}
          {b.status === 'ACCEPTED' || b.status === 'PREPARING' || b.status === 'READY' ? (
            <Button label="Hand over (enter pickup code)" variant={b.status === 'READY' ? 'accept' : 'secondary'} icon="key-outline" onPress={() => { setActionErr(null); setSheet('code'); }} />
          ) : null}
          {(b.status === 'ACCEPTED' || b.status === 'PREPARING') ? (
            <Text style={[font.small, { color: color.textMuted }]}>When the student comes to collect, tap Hand over and type the 4-character code on their phone.</Text>
          ) : null}
          {b.pickupLocked ? (
            <Text style={[font.small, { color: color.alertDark, fontWeight: '700' }]}>Code checking is paused after too many wrong codes. Try again in a few minutes.</Text>
          ) : null}
          {canCancel && !review ? <Button label="Cancel order" variant="ghost" onPress={() => setSheet('cancel')} disabled={!!busy} style={{ minHeight: touch.secondary }} /> : null}
          {review ? <Button label="Can't take this order" variant="ghost" onPress={() => setSheet('cancel')} disabled={!!busy} style={{ minHeight: touch.secondary }} /> : null}
        </View>
      ) : null}

      {sheet === 'reject' ? (
        <ReasonSheet
          title="Reject this payment?"
          body="The student is told why and can send the proof again or cancel."
          reasons={reasons.reject}
          confirm="Reject payment"
          onClose={() => setSheet(null)}
          onConfirm={async (code, note) => { if (await run('reject', () => campusApi.rejectPayment(b.id, code, note), 'Payment rejected. The student was told.')) setSheet(null); }}
          busy={busy === 'reject'}
          error={actionErr}
        />
      ) : null}
      {sheet === 'cancel' ? (
        <ReasonSheet
          title="Cancel this order?"
          body={b.paymentVerifiedAt || review ? `If the student already paid, return ${inr(b.amount)} to them.` : 'The student is told why.'}
          reasons={b.status === 'READY' ? [...reasons.cancel, { code: 'NOT_COLLECTED', label: 'The order was not collected' }] : reasons.cancel}
          confirm="Cancel order"
          onClose={() => setSheet(null)}
          onConfirm={async (code, note) => { if (await run('cancel', () => campusApi.cancel(b.id, code, note), 'Order cancelled. The student was told.')) setSheet(null); }}
          busy={busy === 'cancel'}
          error={actionErr}
        />
      ) : null}
      {sheet === 'code' ? (
        <CodeSheet
          refText={b.ref}
          onClose={() => setSheet(null)}
          busy={busy === 'collect'}
          error={actionErr}
          lockedUntil={codeLockedUntil}
          onSubmit={async (code) => {
            // Also from Accepted / Preparing (the student is already at the counter): the server checks the code first
            // and only then completes it, so a wrong code (say, on the wrong booking) never marks it ready.
            const ok = await run('collect', () => campusApi.collect(b.id, code), 'Handed over. Order complete.', (e) => {
              if (!(e instanceof ApiError)) return;
              if (e.code === 'CODE_LOCKED') {
                const sec = Number(e.data?.retryAfter);
                setCodeLockedUntil(Date.now() + (Number.isFinite(sec) && sec > 0 ? sec : 15 * 60) * 1000);
              } else if (e.code === 'WRONG_CODE' && Number(e.data?.triesLeft) === 0) {
                setCodeLockedUntil(Date.now() + 15 * 60 * 1000);
              }
            });
            if (ok) { setCodeLockedUntil(null); setSheet(null); }
          }}
        />
      ) : null}

      <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)} statusBarTranslucent>
        <Pressable style={styles.zoom} onPress={() => setZoom(false)} accessibilityLabel="Close screenshot">
          {proofUri ? <NetImage uri={proofUri} style={{ width: '100%', height: '85%' }} resizeMode="contain" /> : null}
          <Text style={[font.body, { color: color.textInverse, marginTop: space.sm }]}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

function ReasonSheet({ title, body, reasons, confirm, onClose, onConfirm, busy, error }: {
  title: string; body: string; reasons: CbReason[]; confirm: string; onClose: () => void; onConfirm: (code: string, note?: string) => void; busy: boolean; error: string | null;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <Sheet visible onClose={onClose} title={title}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
        <Text style={[font.body, { color: color.textSecondary }]}>{body}</Text>
        {reasons.map((r) => <Chip key={r.code} label={r.label} selected={code === r.code} onPress={() => setCode(r.code)} tone="red" />)}
        <Chip label="Other reason" selected={code === 'OTHER'} onPress={() => setCode('OTHER')} tone="red" />
        {code === 'OTHER' ? (
          <TextInput value={note} onChangeText={setNote} placeholder="Write the reason" placeholderTextColor={color.textMuted} maxLength={160} style={styles.input} accessibilityLabel="Reason" />
        ) : null}
        {error ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700' }]}>{error}</Text> : null}
        <Button label={confirm} variant="reject" onPress={() => code && onConfirm(code, code === 'OTHER' ? note.trim() : undefined)} disabled={!code || (code === 'OTHER' && !note.trim())} loading={busy} />
      </ScrollView>
    </Sheet>
  );
}

function CodeSheet({ refText, onClose, onSubmit, busy, error, lockedUntil }: { refText: string; onClose: () => void; onSubmit: (code: string) => void; busy: boolean; error: string | null; lockedUntil: number | null }) {
  const [code, setCode] = useState('');
  // Re-render every 15 s while paused so the countdown moves and the button comes back by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lockedUntil || lockedUntil <= Date.now()) return undefined;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  const waitMin = lockedUntil && lockedUntil > now ? Math.max(1, Math.ceil((lockedUntil - now) / 60000)) : 0;
  const send = () => { if (code.length === 4 && !waitMin && !busy) onSubmit(code); };
  return (
    <Sheet visible onClose={onClose} title="Enter the pickup code">
      <View style={{ gap: space.sm }}>
        <Text style={[font.body, { color: color.textSecondary }]}>Ask the student for the 4-character code on their phone for booking #{refText}, then hand over the order.</Text>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
          placeholder="A3F7"
          placeholderTextColor={color.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={4}
          style={[styles.input, styles.codeInput]}
          accessibilityLabel="Pickup code"
          onSubmitEditing={send}
        />
        {error ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700' }]} accessibilityLiveRegion="polite">{error}</Text> : null}
        {waitMin ? <Text style={[font.body, { color: color.textSecondary }]} accessibilityLiveRegion="polite">Code checking is paused after too many wrong codes. Try again in {waitMin} min{waitMin === 1 ? '' : 's'}.</Text> : null}
        <Button label={waitMin ? `Paused: try again in ${waitMin} min` : 'Check code and hand over'} variant="accept" icon={waitMin ? 'time-outline' : 'checkmark'} onPress={send} disabled={code.length !== 4 || !!waitMin} loading={busy} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  proof: { width: '100%', height: 340, borderRadius: radius.md, backgroundColor: color.surfaceAlt },
  noProof: { alignItems: 'center', justifyContent: 'center' },
  veg: { width: 16, height: 16, borderWidth: 2, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegDot: { width: 7, height: 7, borderRadius: 4 },
  bar: { paddingHorizontal: space.md, paddingTop: space.sm, gap: space.xs, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border },
  zoom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: space.md },
  input: { ...font.h3, color: color.text, backgroundColor: color.surface, borderWidth: 2, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: touch.secondary + 4 },
  codeInput: { fontSize: 34, lineHeight: 40, letterSpacing: 10, textAlign: 'center', fontWeight: '800', minHeight: 72 },
});
