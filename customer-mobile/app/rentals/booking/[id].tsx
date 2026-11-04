// One rental / borrowing booking, for the renter / borrower or the owner / lender: status, money, contact
// (after confirmation), PIN handover / return, accept / decline / cancel / complete, rate and report.
// C7 safety: worded for the booking's mode (RENT: owner / renter; BORROW: lender / borrower), terms
// acceptance for bookings made from an older app, pickup / return condition photos + odometer (required
// from the owner / lender before each PIN step when the admin switch is on), and the extra-charges claim
// the renter / borrower accepts or disputes.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, Linking, Modal, TextInput, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import SafeImage from '../../../components/SafeImage';
import { formatINR } from '../../../utils/format';
import { pickAndUploadImage, alertUploadError } from '../../../utils/imageUpload';
import {
  rentalsApi, type Booking, type ConditionRecord, BOOKING_STATUS_META, CHARGES_STATUS_LABEL, inr, fmtDateTime, fmtHours, RentalsError, wordsOf, bookingStatusLabel, tripsLabel, ratingLabel,
} from '../../../modules/rentals/rentalsApi';
import { VEHICLE_FALLBACK, RHeader, usePalette, Card, SectionTitle, Badge, Btn, Row, Notice, StateView, Field, useRentalLive } from '../../../modules/rentals/ui';
import SymbolIcon from '../../../components/SymbolIcon';

const until = (iso: string | null | undefined) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const MIN_PHOTOS = 2;
const MAX_PHOTOS = 6;
type Pic = { ref: string; preview: string };

/** Read-only row of (signed, private) photos. */
function Thumbs({ uris, size = 64 }: { uris: string[]; size?: number }) {
  const p = usePalette();
  if (!uris.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
      {uris.map((u, i) => (
        <TouchableOpacity key={`${u}-${i}`} onPress={() => Linking.openURL(u).catch(() => {})} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1}`}
          style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', backgroundColor: p.card2 }}>
          <Image source={{ uri: u }} style={{ width: '100%', height: '100%' }} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function RentalBookingScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState<RentalsError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [extraKm, setExtraKm] = useState('');
  const [otherCharges, setOtherCharges] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [prompt, setPrompt] = useState<null | { kind: 'decline' | 'cancel'; required: boolean }>(null);
  const [reason, setReason] = useState('');
  // C7 state
  const [termsTicked, setTermsTicked] = useState(false);
  const [condPics, setCondPics] = useState<Pic[]>([]);
  const [odometer, setOdometer] = useState('');
  const [condNote, setCondNote] = useState('');
  const [condOpen, setCondOpen] = useState(false);
  const [evidence, setEvidence] = useState<Pic[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');
  const [disputePics, setDisputePics] = useState<Pic[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await rentalsApi.booking(id);
      setB(res.booking);
      setError(null);
    } catch (e: any) {
      setError(e instanceof RentalsError ? e : new RentalsError(e?.message || 'Could not load this booking.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useRentalLive((e) => { if (!e.id || e.id === id || e.kind === 'reconnect') load(); });

  const run = async (key: string, fn: () => Promise<{ booking: Booking }>, done?: string) => {
    if (busy) return false;
    setBusy(key);
    try {
      const res = await fn();
      setB(res.booking);
      setPin('');
      if (done) Alert.alert('Done', done);
      return true;
    } catch (e: any) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
      if (['INVALID_STATE', 'EXPIRED', 'CONDITION_REQUIRED', 'TERMS_PENDING', 'CHARGES_CLOSED'].includes(e?.code)) load();
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** Picks + uploads one private photo (rental_condition) into `setter` (max `max`). */
  const addPic = async (key: string, list: Pic[], setter: (f: (cur: Pic[]) => Pic[]) => void, max: number) => {
    if (uploading || list.length >= max) return;
    setUploading(key);
    try {
      const up = await pickAndUploadImage('rental_condition', { maxEdge: 1600 });
      if (up) setter((cur) => [...cur.filter((x) => x.ref !== up.url), { ref: up.url, preview: up.previewUrl || up.localUri }].slice(0, max));
    } catch (e) {
      alertUploadError(e, () => addPic(key, list, setter, max));
    } finally {
      setUploading(null);
    }
  };

  if (!b) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <RHeader title="Booking" />
        {error ? <StateView kind={error.status === 404 ? 'empty' : 'error'} title={error.status === 404 ? 'Booking not found' : 'Could not load'} message={error.message} actionLabel={error.status === 404 ? 'My bookings' : 'Retry'} onAction={error.status === 404 ? () => router.replace('/rentals/bookings' as any) : load} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const w = wordsOf(b);
  const meta = { ...(BOOKING_STATUS_META[b.status] || BOOKING_STATUS_META.REQUESTED), label: bookingStatusLabel(b.status, b) };
  const isOwner = b.role === 'OWNER';
  const other = b.counterpart;
  const beforeStart = new Date(b.startAt).getTime() > Date.now();
  const photosRequired = b.conditionPhotosRequired !== false;
  const ownPickup = b.pickupCondition?.owner || null;
  const ownReturn = b.returnCondition?.owner || null;
  // Stage the owner / lender must record before the next PIN step (null = nothing pending).
  const ownerStage: 'PICKUP' | 'RETURN' | null = isOwner && photosRequired
    ? (b.status === 'ACCEPTED' && !ownPickup ? 'PICKUP' : b.status === 'ACTIVE' && !ownReturn ? 'RETURN' : null)
    : null;
  // Stage the renter / borrower may (optionally) add their own photos to.
  const renterStage: 'PICKUP' | 'RETURN' | null = isOwner ? null
    : b.status === 'ACCEPTED' ? 'PICKUP'
      : b.status === 'ACTIVE' || b.status === 'RETURNED' ? 'RETURN' : null;
  const charges = b.charges;
  const guidance = (() => {
    switch (b.status) {
      case 'REQUESTED': return isOwner ? `Answer within ${until(b.respondBy)} or the request expires.` : `Waiting for the ${w.giver}. They have ${until(b.respondBy)} to answer.`;
      case 'ACCEPTED': return isOwner
        ? `At pickup: check the ${w.taker}'s licence, collect the cash, ${photosRequired ? 'take 2-6 photos of the vehicle and note the odometer, ' : ''}then type the 4-digit pickup PIN the ${w.taker} shows you.`
        : `At pickup: show this PIN to the ${w.giver} after you pay the cash. Check the vehicle and the ${w.giver}'s photos before you ride.`;
      case 'ACTIVE': return isOwner
        ? `When the vehicle is back, check it, ${photosRequired ? 'take return photos with the odometer, ' : ''}and type the ${w.taker}'s return PIN. Then return the deposit.`
        : `Enjoy the ride. When you return the vehicle, show the ${w.giver} this return PIN and collect your deposit.`;
      case 'RETURNED': return isOwner ? 'Close the trip: add any extra km or charges, or just complete it.' : `Returned. The ${w.giver} is closing the trip.`;
      case 'COMPLETED': return charges?.status === 'PENDING'
        ? (isOwner ? `Trip completed. Your extra charges wait for the ${w.taker} to accept (until ${fmtDateTime(charges.respondBy)}).` : 'Trip completed. Review the extra charges below: accept them or dispute them.')
        : 'Trip completed. Rate each other to help the community.';
      case 'DECLINED': return b.declineReason ? `Declined: ${b.declineReason}` : `The ${w.giver} could not take this booking.`;
      case 'EXPIRED': return 'This request expired.';
      case 'CANCELLED': return `Cancelled by ${b.cancelledBy === 'OWNER' ? `the ${w.giver}` : `the ${w.taker}`}${b.cancelReason ? `: ${b.cancelReason}` : '.'}`;
      default: return '';
    }
  })();

  const call = (phone?: string | null, wa = false) => {
    if (!phone) return;
    const digits = phone.replace(/\D/g, '');
    const url = wa ? `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}` : `tel:${digits}`;
    Linking.openURL(url).catch(() => Alert.alert('Could not open', wa ? 'WhatsApp is not available.' : 'Calling is not available on this device.'));
  };

  // The renter / borrower cancelling a request that is not answered yet is a "withdraw".
  const withdrawing = !isOwner && b.status === 'REQUESTED';
  const confirmPrompt = () => {
    if (!prompt) return;
    const r = reason.trim();
    if (prompt.required && r.length < 5) { Alert.alert('Add a reason', `Tell the ${w.taker} why (at least 5 characters).`); return; }
    const kind = prompt.kind;
    setPrompt(null);
    setReason('');
    run(kind, () => (kind === 'decline' ? rentalsApi.decline(b.id, r || undefined) : rentalsApi.cancel(b.id, r || undefined)), kind === 'decline' ? 'Request declined.' : withdrawing ? 'Request withdrawn.' : 'Booking cancelled.');
  };

  const saveCondition = async (stage: 'PICKUP' | 'RETURN') => {
    if (condPics.length < MIN_PHOTOS) { Alert.alert('Add photos', `Take at least ${MIN_PHOTOS} photos (front, back, sides, odometer).`); return; }
    const odo = odometer.trim() ? Number(odometer) : undefined;
    if (isOwner && (odo === undefined || !Number.isFinite(odo))) { Alert.alert('Odometer', 'Enter the odometer reading in km.'); return; }
    const ok = await run('condition', () => rentalsApi.condition(b.id, { stage, photos: condPics.map((x) => x.ref), odometer: odo, note: condNote.trim() || undefined }),
      isOwner ? `${stage === 'PICKUP' ? 'Pickup' : 'Return'} photos saved. Now type the ${w.taker}'s PIN.` : 'Your photos are saved on this booking.');
    if (ok) { setCondPics([]); setOdometer(''); setCondNote(''); setCondOpen(false); }
  };

  const completeTrip = () => {
    const km = extraKm ? Number(extraKm) : 0;
    const other = otherCharges ? Number(otherCharges) : 0;
    if (b.otherChargesCap !== undefined && other > b.otherChargesCap) { Alert.alert('Too high', `Other charges can be at most ${inr(b.otherChargesCap)} for this trip. For bigger damage, report a problem.`); return; }
    if ((km > 0 || other > 0) && closeNote.trim().length < 5) { Alert.alert('Explain the charges', `Add a note for the ${w.taker} (at least 5 characters).`); return; }
    run('complete', () => rentalsApi.complete(b.id, { extraKm: km, otherCharges: other, note: closeNote.trim() || undefined, photos: evidence.map((x) => x.ref) }),
      km > 0 || other > 0 ? `Trip completed. The ${w.taker} can now accept or dispute the extra charges.` : `Trip completed. Rate your ${w.taker}.`)
      .then((ok) => { if (ok) setEvidence([]); });
  };

  const sendDispute = async () => {
    if (disputeNote.trim().length < 10) { Alert.alert('Explain why', 'Tell the ZENV team why you dispute the charges (at least 10 characters).'); return; }
    const ok = await run('dispute', () => rentalsApi.respondCharges(b.id, { action: 'DISPUTE', note: disputeNote.trim(), photos: disputePics.map((x) => x.ref) }), 'Dispute sent. The ZENV team will review both sides and tell you the outcome.');
    if (ok) { setDisputeOpen(false); setDisputeNote(''); setDisputePics([]); }
  };

  // Render helpers (plain functions, not components: inputs must keep focus while typing).
  const pinBox = (value: string | null | undefined, label: string, hint: string) => (
    <Card style={{ alignItems: 'center', borderColor: p.accent, backgroundColor: p.accentSoft }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: p.accent, letterSpacing: 0.2 }}>{label}</Text>
      <Text style={{ fontSize: 42, fontWeight: '900', color: p.text, letterSpacing: 12, marginVertical: 6 }} accessibilityLabel={`${label} ${String(value || '').split('').join(' ')}`}>{value || '••••'}</Text>
      <Text style={{ fontSize: 12, color: p.sub, textAlign: 'center' }}>{hint}</Text>
    </Card>
  );

  const pinEntry = (label: string, action: () => void) => (
    <Card>
      <Text style={{ fontSize: 12, fontWeight: '900', color: p.sub, marginBottom: 8 }}>{label}</Text>
      <TextInput value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} placeholder="••••" placeholderTextColor={p.muted}
        accessibilityLabel={label}
        style={{ fontSize: 30, fontWeight: '900', letterSpacing: 14, textAlign: 'center', color: p.text, borderWidth: 1, borderColor: p.inputBorder, backgroundColor: p.input, borderRadius: 14, paddingVertical: 10 }} />
      {b.pinLocked ? <Text style={{ color: p.danger, fontSize: 12, marginTop: 6 }}>Too many wrong tries. Wait 15 minutes and try again.</Text> : null}
      <Btn label="Confirm PIN" onPress={action} disabled={pin.length !== 4} loading={busy === 'pin'} style={{ marginTop: 10 }} />
    </Card>
  );

  const picGrid = (key: string, list: Pic[], setter: (f: (cur: Pic[]) => Pic[]) => void, max: number) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      {list.map((ph) => (
        <TouchableOpacity key={ph.ref} onPress={() => setter((cur) => cur.filter((x) => x.ref !== ph.ref))} accessibilityRole="button" accessibilityLabel="Remove photo"
          style={{ width: 70, height: 70, borderRadius: 12, overflow: 'hidden' }}>
          <Image source={{ uri: ph.preview }} style={{ width: '100%', height: '100%' }} />
        </TouchableOpacity>
      ))}
      {list.length < max ? (
        <TouchableOpacity onPress={() => addPic(key, list, setter, max)} accessibilityRole="button" accessibilityLabel="Add photo"
          style={{ width: 70, height: 70, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.accent, alignItems: 'center', justifyContent: 'center' }}>
          {uploading === key ? <ActivityIndicator color={p.accent} /> : <SymbolIcon name="add" style={{ color: p.accent, fontSize: 22 }} />}
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const conditionForm = (stage: 'PICKUP' | 'RETURN', required: boolean) => (
    <Card style={required ? { borderColor: p.warn } : undefined}>
      <Text style={{ fontSize: 13, fontWeight: '900', color: p.text }}>{stage === 'PICKUP' ? 'Pickup' : 'Return'} condition{required ? ' (required)' : ' (optional)'}</Text>
      <Text style={{ fontSize: 12, color: p.sub, marginTop: 4, marginBottom: 8, lineHeight: 16 }}>
        {required ? `Take ${MIN_PHOTOS}-${MAX_PHOTOS} clear photos (all sides + odometer) before the ${stage === 'PICKUP' ? 'pickup' : 'return'} PIN. Both of you and the ZENV team can see them.` : `Add your own ${MIN_PHOTOS}-${MAX_PHOTOS} photos so both sides have a record. Private to the two of you and the ZENV team.`}
      </Text>
      {picGrid(`cond-${stage}`, condPics, setCondPics, MAX_PHOTOS)}
      <Field label={isOwner ? 'Odometer (km)' : 'Odometer (km, optional)'} value={odometer} onChangeText={(t) => setOdometer(t.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" placeholder="e.g. 12500" />
      <Field label="Note (optional)" value={condNote} onChangeText={(t) => setCondNote(t.slice(0, 300))} placeholder="e.g. Small scratch on the left mirror" />
      <Btn label="Save photos" onPress={() => saveCondition(stage)} loading={busy === 'condition'} disabled={condPics.length < MIN_PHOTOS || !!uploading} />
    </Card>
  );

  const conditionView = (rec: ConditionRecord | null | undefined, title: string) => (rec && (rec.owner || rec.renter) ? (
    <Card>
      <Text style={{ fontSize: 12.5, fontWeight: '900', color: p.text }}>{title}</Text>
      {rec.owner ? (
        <View style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 12, color: p.sub }}>{w.Giver}{rec.owner.odometer !== null ? ` · odometer ${rec.owner.odometer} km` : ''}{rec.owner.at ? ` · ${fmtDateTime(rec.owner.at)}` : ''}</Text>
          <Thumbs uris={rec.owner.photos} />
          {rec.owner.note ? <Text style={{ fontSize: 12, color: p.text }}>“{rec.owner.note}”</Text> : null}
        </View>
      ) : null}
      {rec.renter ? (
        <View style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 12, color: p.sub }}>{w.Taker}{rec.renter.odometer !== null ? ` · odometer ${rec.renter.odometer} km` : ''}{rec.renter.at ? ` · ${fmtDateTime(rec.renter.at)}` : ''}</Text>
          <Thumbs uris={rec.renter.photos} />
          {rec.renter.note ? <Text style={{ fontSize: 12, color: p.text }}>“{rec.renter.note}”</Text> : null}
        </View>
      ) : null}
    </Card>
  ) : null);

  const termsCard = () => (
    <Card style={{ borderColor: p.warn }}>
      <Text style={{ fontSize: 13, fontWeight: '900', color: p.text }}>Accept the {w.verb === 'Rent' ? 'rental' : 'borrowing'} terms</Text>
      <Text style={{ fontSize: 12, color: p.sub, marginTop: 4, marginBottom: 8 }}>This booking was sent from an older version of the app. Accept the terms before pickup.</Text>
      {(b.safety?.terms || []).map((t) => <Text key={t} style={{ fontSize: 12, color: p.text, lineHeight: 17, marginBottom: 5 }}>• {t}</Text>)}
      {b.safety?.disclaimer ? <Text style={{ fontSize: 12, color: p.sub, lineHeight: 16, marginTop: 2 }}>{b.safety.disclaimer}</Text> : null}
      <TouchableOpacity onPress={() => setTermsTicked((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: termsTicked }} accessibilityLabel="I accept these booking terms"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: termsTicked ? p.accent : p.inputBorder, backgroundColor: termsTicked ? p.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {termsTicked ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
        </View>
        <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '800', color: p.text }}>I accept these terms for this booking</Text>
      </TouchableOpacity>
      <Btn label="Accept terms" disabled={!termsTicked} loading={busy === 'terms'} onPress={() => run('terms', () => rentalsApi.acceptTerms(b.id), 'Terms accepted. You are ready for pickup.')} />
    </Card>
  );

  const chargesCard = () => {
    if (!charges || charges.status === 'NONE') return null;
    const final = ['ACCEPTED', 'AUTO_ACCEPTED', 'UPHELD', 'REDUCED', 'VOIDED'].includes(charges.status);
    return (
      <>
        <SectionTitle>Extra charges</SectionTitle>
        <Card style={charges.status === 'PENDING' && !isOwner ? { borderColor: p.warn } : undefined}>
          <Row label={`Claimed by the ${w.giver}`} value={inr(charges.claimed)} />
          {b.extraBreakdown?.extraKm ? <Text style={{ fontSize: 12, color: p.sub }}>{b.extraBreakdown.extraKm} extra km{b.extraBreakdown.perKm ? ` × ${formatINR(b.extraBreakdown.perKm)}` : ''}{b.extraBreakdown.otherCharges ? ` + other ${inr(b.extraBreakdown.otherCharges)}` : ''}</Text> : null}
          {charges.note ? <Text style={{ fontSize: 12, color: p.text, marginTop: 4 }}>“{charges.note}”</Text> : null}
          <Thumbs uris={charges.photos} />
          <Row label="Status" value={CHARGES_STATUS_LABEL[charges.status] || charges.status} />
          {final ? <Row label="Counts towards the final amount" value={inr(charges.counted)} strong /> : null}
          {charges.status === 'PENDING' ? <Text style={{ fontSize: 12, color: p.muted, marginTop: 4 }}>{isOwner ? `The ${w.taker} can accept or dispute until ${fmtDateTime(charges.respondBy)}. If they do not answer, the charges count as accepted.` : `Answer by ${fmtDateTime(charges.respondBy)} (${until(charges.respondBy)} left). If you do not answer, the charges count as accepted.`}</Text> : null}
          {charges.disputeNote ? <Text style={{ fontSize: 12, color: p.text, marginTop: 6 }}>{w.Taker}'s dispute: “{charges.disputeNote}”</Text> : null}
          <Thumbs uris={charges.disputePhotos} />
          {charges.resolution ? <Notice tone="info">ZENV team decision: {charges.resolution.outcome === 'UPHOLD' ? 'charges upheld' : charges.resolution.outcome === 'VOID' ? 'charges cancelled' : `reduced to ${inr(charges.resolution.amount)}`}{charges.resolution.reason ? `. ${charges.resolution.reason}` : ''}</Notice> : null}
          {b.canRespondToCharges ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Btn label="Dispute" kind="secondary" onPress={() => setDisputeOpen(true)} style={{ flex: 1 }} loading={busy === 'dispute'} />
              <Btn label={`Accept ${inr(charges.claimed)}`} kind="success" onPress={() => run('accept-charges', () => rentalsApi.respondCharges(b.id, { action: 'ACCEPT' }), `Accepted. Settle ${inr(charges.claimed)} in cash with the ${w.giver}.`)} style={{ flex: 1.4 }} loading={busy === 'accept-charges'} />
            </View>
          ) : null}
        </Card>
      </>
    );
  };

  const pendingClaim = charges?.status === 'PENDING' || charges?.status === 'DISPUTED';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }}>
      <RHeader title={b.vehicleTitle} subtitle={isOwner ? (w.verb === 'Rent' ? 'Your vehicle · rented out' : 'Your vehicle · lent') : (w.verb === 'Rent' ? 'Your rental' : 'You are borrowing')} right={<Badge label={meta.label} color={meta.color} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 50 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Badge label={w.badge} color={w.color} />
          <Text style={{ fontSize: 12, color: p.sub, flex: 1 }}>{w.verb === 'Rent' ? 'Commercial rental vehicle' : 'Private vehicle, borrowed between students'}</Text>
        </View>
        {guidance ? <Notice tone={['DECLINED', 'CANCELLED', 'EXPIRED'].includes(b.status) ? 'warn' : 'info'}>{guidance}</Notice> : null}

        {!isOwner && b.termsPending && ['REQUESTED', 'ACCEPTED'].includes(b.status) ? termsCard() : null}
        {isOwner && b.termsPending && ['REQUESTED', 'ACCEPTED'].includes(b.status) ? <Notice tone="warn">The {w.taker} has not accepted the booking terms yet (older app). Pickup can start once they accept them in the app.</Notice> : null}

        {!isOwner && b.status === 'ACCEPTED' ? pinBox(b.pickupPin, 'Pickup PIN', `Show this to the ${w.giver} at pickup, only after you get the vehicle keys.`) : null}
        {!isOwner && b.status === 'ACTIVE' ? pinBox(b.returnPin, 'Return PIN', `Show this to the ${w.giver} when you hand the vehicle back and get your deposit.`) : null}

        {ownerStage ? conditionForm(ownerStage, true) : null}
        {isOwner && b.status === 'ACCEPTED' && !ownerStage ? pinEntry(`${w.Taker}'s pickup PIN`, () => run('pin', () => rentalsApi.handover(b.id, pin), 'Trip started. Return is due ' + fmtDateTime(b.endAt) + '.')) : null}
        {isOwner && b.status === 'ACTIVE' && !ownerStage ? pinEntry(`${w.Taker}'s return PIN`, () => run('pin', () => rentalsApi.markReturned(b.id, pin), 'Vehicle returned. Give back the deposit, then complete the trip.')) : null}

        {renterStage ? (condOpen ? conditionForm(renterStage, false) : (
          <Btn label={`Add my ${renterStage === 'PICKUP' ? 'pickup' : 'return'} photos (optional)`} icon="camera-outline" kind="ghost" onPress={() => { setCondPics([]); setCondOpen(true); }} style={{ marginBottom: 10 }} />
        )) : null}

        <Card style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ width: 70, height: 70, borderRadius: 12, overflow: 'hidden', backgroundColor: p.card2 }}>
            {b.vehiclePhoto ? <SafeImage source={{ uri: b.vehiclePhoto }} style={{ width: 70, height: 70 }} contentFit="cover" fallbackUri={VEHICLE_FALLBACK} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14.5, fontWeight: '900', color: p.text }}>{b.vehicleTitle}</Text>
            {b.registration ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{b.registration}</Text> : null}
            <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{b.pickupLocation || `Pickup point shared by the ${w.giver}`}</Text>
            {b.vehicleType !== 'CAR' ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{b.helmetIncluded ? 'Helmet included' : 'Bring your own helmet'}</Text> : null}
          </View>
        </Card>

        <Card>
          <Row label="Pickup" value={fmtDateTime(b.startAt)} />
          <Row label="Return" value={fmtDateTime(b.endAt)} />
          <Row label="Billed" value={fmtHours(b.billableHours)} />
          {b.kmAllowance ? <Row label="Km included" value={`${b.kmAllowance} km`} /> : null}
        </Card>

        <SectionTitle>Payment (cash, between you two)</SectionTitle>
        <Card>
          <Row label={w.Price} value={inr(b.rentAmount)} />
          <Row label="Refundable deposit" value={inr(b.depositAmount)} />
          <Row label="Cash at pickup" value={inr(b.payAtHandover)} strong />
          {b.status === 'COMPLETED' ? (
            <>
              <View style={{ height: 1, backgroundColor: p.border, marginVertical: 6 }} />
              {b.extraCharges > 0 ? <Row label="Extra charges" value={inr(b.extraCharges)} /> : null}
              {pendingClaim ? <Row label="Extra charges (not final yet)" value={inr(charges?.claimed)} /> : null}
              <Row label={`Final ${w.price}`} value={inr(b.finalAmount ?? b.rentAmount)} strong />
              <Text style={{ fontSize: 12, color: p.muted }}>The deposit of {inr(b.depositAmount)} goes back to the {w.taker}.</Text>
            </>
          ) : <Text style={{ fontSize: 12, color: p.muted, marginTop: 4 }}>ZENV does not collect this money. The deposit is returned in cash when the vehicle comes back.</Text>}
        </Card>

        {chargesCard()}

        {conditionView(b.pickupCondition, 'Pickup condition')}
        {conditionView(b.returnCondition, 'Return condition')}

        <SectionTitle>{isOwner ? w.Taker : w.Giver}</SectionTitle>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
              {other?.avatar ? <SafeImage source={{ uri: other.avatar }} style={{ width: 44, height: 44 }} fallback={<Ionicons name="person-outline" size={20} color={p.muted} />} /> : <Ionicons name="person-outline" size={20} color={p.muted} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: p.text }}>{other?.name || 'Student'} <Text style={{ color: p.success, fontSize: 12 }}>Verified</Text></Text>
              <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>
                {other?.rating && other.rating.avg ? `★ ${ratingLabel(other.rating.avg)} (${other.rating.count})` : 'No ratings yet'}{other?.rating?.trips ? ` · ${tripsLabel(other.rating.trips)}` : ''}
              </Text>
            </View>
          </View>
          {isOwner && b.renterLicence ? (
            <Text style={{ fontSize: 12, color: b.renterLicence.status === 'VERIFIED' ? p.success : p.warn, marginTop: 10 }}>
              Driving licence: {b.renterLicence.status === 'VERIFIED' ? `verified by ZENV (${b.renterLicence.classes.join(', ')})` : b.renterLicence.status === 'PENDING' ? 'being verified by ZENV, you can accept once verified' : b.renterLicence.status === 'REJECTED' ? 'not accepted by ZENV' : 'not added yet'}
            </Text>
          ) : null}
          {b.renterNote ? <Text style={{ fontSize: 12.5, color: p.text, marginTop: 10 }}>“{b.renterNote}”</Text> : null}
          {b.contactVisible && other?.phone ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Btn label="Call" icon="call-outline" small kind="success" onPress={() => call(other.phone)} style={{ flex: 1 }} />
              <Btn label="WhatsApp" icon="logo-whatsapp" small kind="secondary" onPress={() => call(other.phone, true)} style={{ flex: 1 }} />
            </View>
          ) : <Text style={{ fontSize: 12, color: p.muted, marginTop: 10 }}>{['REQUESTED'].includes(b.status) ? `Phone numbers are shared once the ${w.giver} accepts.` : 'Phone numbers are visible only during a confirmed trip.'}</Text>}
        </Card>

        {b.fuelPolicy || b.rules ? (
          <>
            <SectionTitle>Rules</SectionTitle>
            <Card>
              {b.fuelPolicy ? <Text style={{ fontSize: 12.5, color: p.text }}>Fuel: {b.fuelPolicy}</Text> : null}
              {b.rules ? <Text style={{ fontSize: 12.5, color: p.text, marginTop: 6, lineHeight: 18 }}>{b.rules}</Text> : null}
            </Card>
          </>
        ) : null}

        {b.safety?.disclaimer && ['REQUESTED', 'ACCEPTED', 'ACTIVE'].includes(b.status) && !b.termsPending ? (
          <Text style={{ fontSize: 12, color: p.muted, lineHeight: 16, marginTop: 4, marginBottom: 8 }}>{b.safety.disclaimer}{b.termsAcceptedAt ? ` You accepted the booking terms on ${fmtDateTime(b.termsAcceptedAt)}.` : ''}</Text>
        ) : null}

        {isOwner && b.status === 'RETURNED' ? (
          <>
            <SectionTitle>Close the trip</SectionTitle>
            <Card>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Field label="Extra km driven" value={extraKm} onChangeText={(t) => setExtraKm(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="0" style={{ flex: 1 }} hint={b.priceBreakdown?.extraPerKm ? `${formatINR(b.priceBreakdown.extraPerKm)}/km` : 'No km charge set'} />
                <Field label="Other charges ₹" value={otherCharges} onChangeText={(t) => setOtherCharges(t.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 7))} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} hint={b.otherChargesCap !== undefined ? `Fuel, late fee… max ${inr(b.otherChargesCap)}` : 'Fuel, late fee…'} />
              </View>
              <Field label={extraKm || otherCharges ? `Explain the charges for the ${w.taker} (required)` : `Note for the ${w.taker}`} value={closeNote} onChangeText={(t) => setCloseNote(t.slice(0, 300))} placeholder={extraKm || otherCharges ? 'e.g. 40 km over the limit, fuel top-up' : 'Optional'} />
              {Number(otherCharges) > 0 || Number(extraKm) > 0 ? (
                <>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: p.sub, marginBottom: 6 }}>Evidence photos (optional, private)</Text>
                  {picGrid('evidence', evidence, setEvidence, 4)}
                  <Text style={{ fontSize: 12, color: p.muted, marginBottom: 10, lineHeight: 16 }}>Extra charges only count once the {w.taker} accepts them (or does not answer in time). They can dispute them, and the ZENV team then decides.</Text>
                </>
              ) : null}
              <Btn label="Complete trip" kind="success" loading={busy === 'complete'} onPress={completeTrip} />
            </Card>
          </>
        ) : null}

        <View style={{ gap: 10, marginTop: 8 }}>
          {isOwner && b.status === 'REQUESTED' ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn label="Decline" kind="secondary" onPress={() => setPrompt({ kind: 'decline', required: false })} style={{ flex: 1 }} loading={busy === 'decline'} />
              <Btn label="Accept" onPress={() => run('accept', () => rentalsApi.accept(b.id), `Confirmed. The ${w.taker} can now see your number and their pickup PIN.`)} style={{ flex: 2 }} loading={busy === 'accept'}
                disabled={b.renterLicence ? b.renterLicence.status !== 'VERIFIED' : false} />
            </View>
          ) : null}
          {!isOwner && (b.status === 'REQUESTED' || (b.status === 'ACCEPTED' && beforeStart)) ? <Btn label={b.status === 'REQUESTED' ? 'Withdraw request' : 'Cancel booking'} kind="secondary" onPress={() => setPrompt({ kind: 'cancel', required: false })} loading={busy === 'cancel'} /> : null}
          {isOwner && b.status === 'ACCEPTED' ? <Btn label="Cancel booking" kind="secondary" onPress={() => setPrompt({ kind: 'cancel', required: true })} loading={busy === 'cancel'} /> : null}
          {b.canRate ? <Btn label={isOwner ? `Rate the ${w.taker}` : 'Rate your trip'} icon="star-outline" onPress={() => router.push(`/rentals/rate/${b.id}` as any)} /> : null}
          {b.rated ? <Text style={{ color: p.success, fontSize: 12, textAlign: 'center', fontWeight: '800' }}>You rated this trip.</Text> : null}
          {b.canReport ? <Btn label="Report a problem" kind="ghost" onPress={() => router.push(`/rentals/report/${b.id}` as any)} style={{ borderColor: p.danger }} /> : null}
          <Btn label="View vehicle" kind="ghost" onPress={() => router.push(`/rentals/${b.listingId}` as any)} />
        </View>
      </ScrollView>

      <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={() => setPrompt(null)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: p.bg, borderRadius: 20, padding: 18 }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: p.text, marginBottom: 10 }}>{prompt?.kind === 'decline' ? 'Decline this request?' : withdrawing ? 'Withdraw this request?' : 'Cancel this booking?'}</Text>
            <Field label={prompt?.required ? 'Reason (required)' : 'Reason (optional)'} value={reason} onChangeText={(t) => setReason(t.slice(0, 300))} placeholder={prompt?.kind === 'decline' ? 'e.g. I need it that day' : 'Tell them why'} multiline />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn label="Back" kind="secondary" onPress={() => { setPrompt(null); setReason(''); }} style={{ flex: 1 }} />
              <Btn label={prompt?.kind === 'decline' ? 'Decline' : withdrawing ? 'Withdraw request' : 'Cancel booking'} kind="danger" onPress={confirmPrompt} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={disputeOpen} transparent animationType="slide" onRequestClose={() => setDisputeOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: p.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 30 }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: p.text, marginBottom: 6 }}>Dispute {inr(charges?.claimed)} of extra charges</Text>
            <Text style={{ fontSize: 12, color: p.sub, marginBottom: 10, lineHeight: 16 }}>The ZENV team sees both sides, the pickup / return photos and your evidence, then upholds, reduces or cancels the charges. Until then they do not count.</Text>
            <Field label="Why do you dispute them? (required)" value={disputeNote} onChangeText={(t) => setDisputeNote(t.slice(0, 1000))} placeholder="e.g. The scratch is visible in the pickup photos" multiline />
            <Text style={{ fontSize: 12, fontWeight: '800', color: p.sub, marginBottom: 6 }}>Photos (optional, private)</Text>
            {picGrid('dispute', disputePics, setDisputePics, 4)}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn label="Back" kind="secondary" onPress={() => setDisputeOpen(false)} style={{ flex: 1 }} />
              <Btn label="Send dispute" kind="danger" onPress={sendDispute} loading={busy === 'dispute'} disabled={disputeNote.trim().length < 10 || !!uploading} style={{ flex: 1.4 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}
