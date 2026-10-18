// Vehicle detail: photos, specs, availability, ratings, live price calculator and the booking request.
// C7: worded for its mode (RENT: owner / renter / rent; BORROW: lender / borrower / cost share), with the
// insurance disclaimer, and the request needs the booking terms ticked (sent as acceptTerms: true).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Dimensions, RefreshControl, Modal, TouchableOpacity, Alert, Platform } from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { useLocalSearchParams, useRouter } from 'expo-router';
import SafeImage from '../../components/SafeImage';
import {
  rentalsApi, type Listing, type Quote, type Review, type Eligibility, type SafetyInfo, VEHICLE_META, FUEL_LABEL, DAY_NAMES,
  inr, fmtDateTime, fmtHours, fmtTime, istDate, istInstant, priceLabel, RentalsError, wordsOf,
} from '../../modules/rentals/rentalsApi';
import { openLegal } from '../../utils/legal';
import { VEHICLE_FALLBACK, RHeader, usePalette, Card, SectionTitle, Badge, Btn, Stars, Row, Notice, StateView, DateTimeSelect, Field, useRentalLive } from '../../modules/rentals/ui';

const { width: SW } = Dimensions.get('window');

export default function RentalDetail() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [data, setData] = useState<{ listing: Listing; safety?: SafetyInfo; busy: { startAt: string; endAt: string; pending: boolean }[]; reviews: Review[] } | null>(null);
  const [error, setError] = useState<RentalsError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [elig, setElig] = useState<Eligibility | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([rentalsApi.listing(id), rentalsApi.eligibility().catch(() => null)]);
      setData(d as any);
      setElig(e);
      setError(null);
    } catch (e: any) {
      setError(e instanceof RentalsError ? e : new RentalsError(e?.message || 'Could not load this vehicle.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useRentalLive((e) => { if (!e.id || e.id === id || e.kind !== 'listing') load(); });

  // ── price calculator (server quote, never cached) ──
  const [start, setStart] = useState({ date: istDate(1), time: '10:00' });
  const [end, setEnd] = useState({ date: istDate(1), time: '18:00' });
  const startIso = useMemo(() => istInstant(start.date, start.time), [start]);
  const endIso = useMemo(() => istInstant(end.date, end.time), [end]);
  const [quote, setQuote] = useState<{ quote: Quote; available: boolean; reason: { code: string; message: string } | null } | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const listing = data?.listing;
  const canBook = !!listing && !listing.isMine && listing.status === 'APPROVED';

  useEffect(() => {
    if (!canBook) return;
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) { setQuote(null); setQuoteErr('Return must be after pickup.'); return; }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await rentalsApi.quote(id, startIso, endIso);
        if (!cancelled) { setQuote(q); setQuoteErr(null); }
      } catch (e: any) {
        if (!cancelled) { setQuote(null); setQuoteErr(e?.message || 'Could not price that.'); }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [id, startIso, endIso, canBook]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const words = wordsOf(listing);

  const startRequest = () => {
    if (elig && !elig.eligible) {
      Alert.alert('Verify your college', elig.message || 'Only college-verified students can rent vehicles.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Verify', onPress: () => router.push('/friends?screen=verification' as any) },
      ]);
      return;
    }
    if (elig && (!elig.licence || elig.licence.status === 'REJECTED')) {
      Alert.alert('Driving licence needed', elig.licence ? `Your licence was not accepted. Upload it again to ${words.verb.toLowerCase()}.` : `Add your driving licence once. Zenvy verifies it before the ${words.giver} can accept.`, [
        { text: 'Later', style: 'cancel' },
        { text: 'Add licence', onPress: () => router.push('/rentals/licence' as any) },
      ]);
      return;
    }
    if (elig && elig.licence && (!elig.licence.expiresOn || elig.licence.expiresOn < istDate(0))) {
      Alert.alert('Update your licence', elig.licence.expiresOn ? 'Your driving licence has expired. Upload your renewed licence to book.' : 'Add the "valid till" date of your driving licence before booking.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Update licence', onPress: () => router.push('/rentals/licence' as any) },
      ]);
      return;
    }
    setAgreed(false);
    setConfirmOpen(true);
  };

  // Ref lock: two taps in one frame must not send two booking requests.
  const sendingRef = useRef(false);
  const sendRequest = async () => {
    if (sendingRef.current) return;
    if (!agreed) { Alert.alert('Booking terms', 'Tick the box to accept the booking terms first.'); return; }
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await rentalsApi.requestBooking({ listingId: id, startAt: startIso, endAt: endIso, note: note.trim() || undefined, acceptTerms: true });
      setConfirmOpen(false);
      setNote('');
      router.replace(`/rentals/booking/${res.booking.id}` as any);
    } catch (e: any) {
      const err = e as RentalsError;
      if (err.code === 'LICENCE_REQUIRED' || err.code === 'LICENCE_REJECTED' || err.code === 'LICENCE_EXPIRED' || err.code === 'LICENCE_EXPIRY_REQUIRED' || err.code === 'LICENCE_CLASS_MISMATCH') {
        setConfirmOpen(false);
        Alert.alert('Driving licence', err.message, [{ text: 'Later', style: 'cancel' }, { text: 'Update licence', onPress: () => router.push('/rentals/licence' as any) }]);
      } else {
        Alert.alert('Could not send the request', err.message || 'Please try again.');
        if (err.code === 'SLOT_TAKEN') load();
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <RHeader title="Vehicle" />
        {error ? <StateView kind={error.status === 404 ? 'empty' : 'error'} title={error.status === 404 ? 'Not available' : 'Could not load'} message={error.message} actionLabel={error.status === 404 ? 'Browse vehicles' : 'Retry'} onAction={error.status === 404 ? () => router.replace('/rentals' as any) : load} /> : <StateView kind="loading" />}
      </View>
    );
  }
  const l = data.listing;
  const meta = VEHICLE_META[l.vehicleType];
  const w = wordsOf(l);
  const safety = data.safety;
  const openTerms = () => openLegal('terms');
  const weekly = Object.entries(l.weeklyHours || {}).filter(([, v]) => !!v) as [string, { start: string; end: string }][];

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <RHeader title={l.title} subtitle={`${meta.icon} ${meta.label}${l.year ? ` · ${l.year}` : ''}${l.registrationMasked ? ` · ${l.registrationMasked}` : ''}`}
        right={l.isMine ? <Btn label="Edit" small kind="secondary" onPress={() => router.push(`/rentals/new?id=${l.id}` as any)} /> : undefined} />
      <ScrollView contentContainerStyle={{ paddingBottom: canBook ? 130 : 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {(l.photos.length ? l.photos : [null]).map((uri, i) => (
            <View key={`${uri}-${i}`} style={{ width: SW, height: SW * 0.62, backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
              {uri ? <SafeImage source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" fallbackUri={VEHICLE_FALLBACK} maxWidth={900} accessibilityLabel={`Photo ${i + 1} of ${l.title}`} /> : <Text style={{ fontSize: 64 }}>{meta.icon}</Text>}
              {l.photos.length > 1 ? <View style={{ position: 'absolute', bottom: 10, right: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{i + 1}/{l.photos.length}</Text></View> : null}
            </View>
          ))}
        </ScrollView>

        <View style={{ padding: 16 }}>
          {l.isMine && l.status !== 'APPROVED' ? <Notice tone="warn">This is your vehicle. It is {l.status === 'PAUSED' ? 'paused' : l.status === 'PENDING_REVIEW' ? 'waiting for review' : l.status.toLowerCase().replace('_', ' ')} and not visible to other students.</Notice> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Badge label={w.badge} color={w.color} />
            <Text style={{ fontSize: 11.5, color: p.sub, flex: 1 }}>{w.verb === 'Rent' ? 'Commercial rental vehicle (rental number plate)' : 'Private vehicle, lent between students (non-commercial)'}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: p.success }}>{priceLabel(l)}</Text>
            {l.ratingCount > 0 ? <View style={{ alignItems: 'flex-end' }}><Stars value={l.ratingAvg} /><Text style={{ fontSize: 11, color: p.sub, marginTop: 2 }}>{l.ratingAvg.toFixed(1)} · {l.ratingCount} rating{l.ratingCount === 1 ? '' : 's'} · {l.tripCount} trips</Text></View> : <Badge label="NEW" color="#0EA5E9" />}
          </View>
          <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4 }}>Refundable deposit {inr(l.securityDeposit)} · minimum {fmtHours(l.minHours)}</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {[l.fuel ? `⛽ ${FUEL_LABEL[l.fuel]}` : null, l.transmission ? `⚙️ ${l.transmission === 'AUTOMATIC' ? 'Automatic' : 'Manual'}` : null, l.seats ? `💺 ${l.seats} seats` : null,
              l.kmLimitPerDay ? `🛣️ ${l.kmLimitPerDay} km/day${l.extraPerKm ? ` · ₹${l.extraPerKm}/extra km` : ''}` : '🛣️ No km limit', l.vehicleType !== 'CAR' ? (l.helmetIncluded ? '⛑️ Helmet included' : '⛑️ Bring your helmet') : null]
              .filter(Boolean).map((t) => <View key={t as string} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: p.card2 }}><Text style={{ fontSize: 11.5, fontWeight: '700', color: p.text }}>{t}</Text></View>)}
          </View>

          {l.owner ? (
            <Card style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, overflow: 'hidden', backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
                {l.owner.avatar ? <SafeImage source={{ uri: l.owner.avatar }} style={{ width: 42, height: 42 }} fallback={<Text style={{ fontSize: 18 }}>🧑‍🎓</Text>} /> : <Text style={{ fontSize: 18 }}>🧑‍🎓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: p.text }}>{l.owner.name} <Text style={{ color: p.success, fontSize: 12 }}>✓ verified student · {w.giver}</Text></Text>
                <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }}>{l.owner.rating && l.owner.rating.avg ? `★ ${l.owner.rating.avg} from ${l.owner.rating.count} student${l.owner.rating.count === 1 ? '' : 's'}` : 'No ratings yet'} · phone shared after you are confirmed</Text>
              </View>
            </Card>
          ) : null}

          <SectionTitle>Pickup</SectionTitle>
          <Card>
            <Text style={{ fontSize: 13.5, fontWeight: '800', color: p.text }}>📍 {l.pickupLocation || 'Shared after confirmation'}</Text>
            {l.fuelPolicy ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 6 }}>⛽ {l.fuelPolicy}</Text> : null}
          </Card>

          <SectionTitle>Availability</SectionTitle>
          <Card>
            {weekly.length ? weekly.sort(([a], [b]) => Number(a) - Number(b)).map(([d, w]) => <Row key={d} label={DAY_NAMES[Number(d)]} value={`${fmtTime(w.start)} – ${fmtTime(w.end)}`} />) : <Text style={{ fontSize: 12.5, color: p.sub }}>Pickup and return any time (agree the exact time with the owner).</Text>}
            {weekly.length ? <Text style={{ fontSize: 11, color: p.muted, marginTop: 6 }}>Pickup and return must be inside these hours. Days not listed are closed.</Text> : null}
            {l.blockedDates.length ? <Text style={{ fontSize: 12, color: p.warn, marginTop: 8 }}>Not renting: {l.blockedDates.map((b) => (b.start === b.end ? b.start : `${b.start} → ${b.end}`)).join(', ')}</Text> : null}
            {data.busy.length ? (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: p.sub, marginBottom: 4 }}>ALREADY BOOKED</Text>
                {data.busy.slice(0, 6).map((b) => <Text key={b.startAt} style={{ fontSize: 12, color: p.text, marginBottom: 2 }}>• {fmtDateTime(b.startAt)} → {fmtDateTime(b.endAt)}{b.pending ? ' (pending)' : ''}</Text>)}
              </View>
            ) : null}
          </Card>

          {l.rules ? <><SectionTitle>{`${w.Giver}'s rules`}</SectionTitle><Card><Text style={{ fontSize: 12.5, color: p.text, lineHeight: 19 }}>{l.rules}</Text></Card></> : null}

          {canBook ? (
            <>
              <SectionTitle>Price calculator</SectionTitle>
              <Card>
                <DateTimeSelect label="Pickup" date={start.date} time={start.time} onChange={(v) => { setStart(v); if (v.date > end.date) setEnd({ ...end, date: v.date }); }} />
                <DateTimeSelect label="Return" date={end.date} time={end.time} minDate={start.date} onChange={setEnd} />
                {quoteErr ? <Notice tone="danger">{quoteErr}</Notice> : quote ? (
                  <View>
                    {!quote.available && quote.reason ? <Notice tone="warn">{quote.reason.message}</Notice> : null}
                    <Row label={`${w.Price} · ${fmtHours(quote.quote.hours)}${quote.quote.minHoursApplied ? ' (minimum)' : ''}`} value={inr(quote.quote.rent)} />
                    <Row label="Refundable deposit" value={inr(quote.quote.deposit)} />
                    {quote.quote.kmAllowance ? <Row label="Km included" value={`${quote.quote.kmAllowance} km${quote.quote.extraPerKm ? ` · then ₹${quote.quote.extraPerKm}/km` : ''}`} /> : null}
                    <View style={{ height: 1, backgroundColor: p.border, marginVertical: 6 }} />
                    <Row label="Pay in cash at pickup" value={inr(quote.quote.payAtHandover)} strong />
                    <Text style={{ fontSize: 11, color: p.muted, marginTop: 6, lineHeight: 16 }}>{quote.quote.paymentNote} Zenvy does not collect this money.</Text>
                  </View>
                ) : <Text style={{ color: p.sub, fontSize: 12 }}>{quoting ? 'Calculating…' : 'Pick your times to see the price.'}</Text>}
              </Card>
            </>
          ) : null}

          {safety ? (
            <>
              <SectionTitle>Insurance & responsibility</SectionTitle>
              <Card>
                <Text style={{ fontSize: 12.5, color: p.text, lineHeight: 18 }}>🛡️ {safety.disclaimer}</Text>
                {safety.conditionPhotosRequired ? <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 8, lineHeight: 17 }}>📸 The {w.giver} records photos and the odometer at pickup and at return. You can add your own too.</Text> : null}
                <TouchableOpacity onPress={openTerms} accessibilityRole="link"><Text style={{ fontSize: 11.5, color: p.accent, fontWeight: '800', marginTop: 8 }}>Read the full Terms ›</Text></TouchableOpacity>
              </Card>
            </>
          ) : null}

          <SectionTitle>Ratings</SectionTitle>
          {data.reviews.length ? data.reviews.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '800', color: p.text, fontSize: 13 }}>{r.reviewer?.name || 'Student'}</Text>
                <Stars value={r.rating} />
              </View>
              {r.text ? <Text style={{ color: p.sub, fontSize: 12.5, marginTop: 6, lineHeight: 18 }}>{r.text}</Text> : null}
            </Card>
          )) : <Text style={{ color: p.sub, fontSize: 12.5 }}>No ratings yet.</Text>}
        </View>
      </ScrollView>

      {canBook ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 26, backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: p.sub }}>{quote ? `${fmtHours(quote.quote.hours)} · pay at pickup` : 'Pick times above'}</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: p.text }}>{quote ? inr(quote.quote.payAtHandover) : '—'}</Text>
          </View>
          <Btn label={`Request to ${w.verb.toLowerCase()}`} onPress={startRequest} disabled={!quote || !quote.available || quoting} style={{ flex: 1.3 }} />
        </View>
      ) : null}

      <Modal visible={confirmOpen} transparent animationType="slide" onRequestClose={() => setConfirmOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ backgroundColor: p.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 30, maxHeight: '92%' }}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={{ fontSize: 17, fontWeight: '900', color: p.text }}>{w.verb === 'Rent' ? 'Rental' : 'Borrow'} request to {l.owner?.name || `the ${w.giver}`}</Text>
              <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4, marginBottom: 12 }}>{fmtDateTime(startIso)} → {fmtDateTime(endIso)}</Text>
              {quote ? <Card><Row label={w.Price} value={inr(quote.quote.rent)} /><Row label="Deposit (returned at drop-off)" value={inr(quote.quote.deposit)} /><Row label="Cash at pickup" value={inr(quote.quote.payAtHandover)} strong /></Card> : null}
              <Field label={`Message to the ${w.giver} (optional)`} value={note} onChangeText={(t) => setNote(t.slice(0, 500))} placeholder="e.g. Going to Vijayawada, back by evening" multiline />
              {elig?.licence && elig.licence.status === 'PENDING' ? <Notice tone="info">Your licence is being verified. The {w.giver} can accept once Zenvy verifies it.</Notice> : null}
              <Text style={{ fontSize: 11, fontWeight: '900', color: p.sub, marginBottom: 6, letterSpacing: 0.5 }}>{w.verb === 'Rent' ? 'RENTAL TERMS' : 'BORROWING TERMS'}</Text>
              <Card>
                {(safety?.terms || []).map((t) => <Text key={t} style={{ fontSize: 12, color: p.text, lineHeight: 17, marginBottom: 6 }}>• {t}</Text>)}
                {safety?.disclaimer ? <Text style={{ fontSize: 11.5, color: p.sub, lineHeight: 16, marginTop: 4 }}>🛡️ {safety.disclaimer}</Text> : null}
              </Card>
              <TouchableOpacity onPress={() => setAgreed((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} accessibilityLabel="I accept these booking terms"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, marginBottom: 6 }}>
                <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: agreed ? p.accent : p.inputBorder, backgroundColor: agreed ? p.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {agreed ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                </View>
                <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '800', color: p.text }}>I accept these {w.verb === 'Rent' ? 'rental' : 'borrowing'} terms for this booking</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 11, color: p.muted, marginBottom: 12 }}>The {w.giver} has up to 2 hours to answer. The final price is calculated by Zenvy when you send the request.</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn label="Back" kind="secondary" onPress={() => setConfirmOpen(false)} style={{ flex: 1 }} />
                <Btn label="Send request" loading={sending} onPress={sendRequest} disabled={!agreed} style={{ flex: 2 }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {l.isMine ? (
        <TouchableOpacity onPress={() => router.push('/rentals/my-listings' as any)} style={{ position: 'absolute', bottom: 24, alignSelf: 'center', backgroundColor: p.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: p.border }} accessibilityRole="button">
          <Text style={{ color: p.text, fontWeight: '900', fontSize: 12.5 }}>Manage in My vehicles ›</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
