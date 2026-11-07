/**
 * Rentals v2 sheets:
 *   book    the real request for a student vehicle: start day + time, duration (days / weeks / a month),
 *           the server quote (GET /quote: rent, deposit, pay at pickup), terms, a note, then
 *           POST /api/rentals/bookings. Sign-in, college verification and licence gates come first.
 *   sample  sample listings never book: a polite note, "Notify me" and, for vehicles, "List your vehicle".
 *   sent    request sent / noted.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { rentalsApi, istDate, istDayLabel, istInstant, fmtTime, wordsOf, type Quote } from '../rentals/rentalsApi';
import { DAY, W, PLATE } from './rentalsV2Theme';
import { CTA, Press } from './RentalsV2Kit';
import { Options, Sheet, SheetLabel } from './RentalsV2Sheet';
import { ICheck, IInfo } from './RentalsV2Icons';
import { ItemThumb } from './RentalsV2Rows';
import { inr, useRentalsV2, type RItem } from './rentalsV2Data';
import { useNav, type Duration } from './rentalsV2Nav';
import { themedSheet } from '../../utils/themeNow';
import SymbolIcon from '../../components/SymbolIcon';

const SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
const DAYS_FOR: Record<Duration, number> = { day: 1, week: 7, month: 30 };

function BookSheet({ item, duration }: { item: RItem; duration: Duration }) {
  const nav = useNav();
  const router = useRouter();
  const { user } = useAuth();
  const { elig } = useRentalsV2();
  const [day, setDay] = useState(istDate(1));
  const [time, setTime] = useState('10:00');
  const [dur, setDur] = useState<Duration>(duration);
  const [count, setCount] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const words = item.listing ? wordsOf(item.listing) : wordsOf(null);
  const days = Math.min(30, DAYS_FOR[dur] * (dur === 'month' ? 1 : count));
  const startAt = istInstant(day, time);
  const endAt = new Date(Date.parse(startAt) + days * 86400000).toISOString();
  const dayOptions = useMemo(() => Array.from({ length: 7 }, (_, i) => istDate(i)).map((d) => ({ key: d, label: istDayLabel(d) })), []);

  useEffect(() => {
    let live = true;
    setQuote(null); setWhy(null);
    rentalsApi.quote(item.id, startAt, endAt).then((r) => {
      if (!live) return;
      setQuote(r.quote);
      setWhy(r.available ? null : r.reason?.message || 'Not available for these dates.');
    }).catch((e: any) => { if (live) setWhy(e?.message || 'Could not get a price. Try again.'); });
    return () => { live = false; };
  }, [item.id, startAt, endAt]);

  const gate = !user ? { t: 'Sign in to send a request', a: 'Sign in', go: '/login' }
    : elig && !elig.eligible ? { t: elig.message || 'Verify your college to rent or borrow vehicles.', a: 'Verify now', go: '/friends?screen=verification' }
      : elig && elig.licence?.status !== 'VERIFIED' ? { t: elig.licence ? 'Your licence is being checked. You can send requests once it is verified.' : 'Add your driving licence once. The ZenWe team verifies it before your first trip.', a: elig.licence ? 'View licence' : 'Add licence', go: '/rentals/licence' }
        : null;

  // Validation (owner, 7 Nov 2026: "it's about validation"): every button in this sheet first checks the agreement.
  // Not ticked -> red box + message, nothing proceeds. The server also refuses a request without acceptTerms.
  const [agreeErr, setAgreeErr] = useState(false);
  const AGREE_MSG = 'Please tick the box to agree before continuing.';
  const requireAgree = () => { if (agree) return true; setAgreeErr(true); return false; };
  const send = async () => {
    if (!requireAgree()) return;
    if (!quote || why) return;
    setBusy(true); setErr(null);
    try {
      await rentalsApi.requestBooking({ listingId: item.id, startAt, endAt, note: note.trim() || undefined, acceptTerms: true });
      nav.openSheet({ kind: 'sent', title: 'Request sent', body: `The ${words.giver} has a few hours to accept. You will get a notification, and the pickup PIN appears in My rentals.`, mine: true });
    } catch (e: any) {
      setErr(e?.message || 'Could not send the request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={nav.closeSheet} title={`${words.verb} ${item.title}`}
      footer={gate ? <CTA label={gate.a} sub={agreeErr ? AGREE_MSG : 'Needed before you can send a request'} onPress={() => { if (!requireAgree()) return; nav.closeSheet(); router.push(gate.go as any); }} />
        : <CTA label="Send request" sub={agreeErr ? AGREE_MSG : quote ? `${inr(quote.payAtHandover)} at pickup · nothing paid now` : undefined} onPress={send} busy={busy} disabled={!quote || !!why} />}>
      {gate ? <View style={b.gate}><IInfo size={18} color={DAY.accent} strokeWidth={1.7} /><Text style={b.gateText}>{gate.t}</Text></View> : null}
      <SheetLabel>Pickup day</SheetLabel>
      <Options items={dayOptions} value={day} onChange={setDay} />
      <SheetLabel>Pickup time</SheetLabel>
      <Options items={SLOTS.map((s) => ({ key: s, label: fmtTime(s) }))} value={time} onChange={setTime} />
      <SheetLabel>Duration</SheetLabel>
      <Options items={[{ key: 'day', label: 'Daily' }, { key: 'week', label: 'Weekly' }, { key: 'month', label: 'Monthly' }]} value={dur} onChange={(d) => { setDur(d as Duration); setCount(1); }} />
      {dur !== 'month' ? (
        <View style={b.stepper}>
          <Text style={b.stepLabel}>{dur === 'day' ? 'Days' : 'Weeks'}</Text>
          <Press onPress={() => setCount(Math.max(1, count - 1))} label="Fewer" style={b.stepBtn}><SymbolIcon name="remove" style={b.stepSign} /></Press>
          <Text style={b.stepVal}>{count}</Text>
          <Press onPress={() => setCount(Math.min(dur === 'day' ? 30 : 4, count + 1))} label="More" style={b.stepBtn}><SymbolIcon name="add" style={b.stepSign} /></Press>
        </View>
      ) : <Text style={b.muted}>A month is 30 days, the longest single booking.</Text>}

      <View style={b.quote}>
        {quote ? (<>
          <Row k={`${words.Price} · ${days} day${days === 1 ? '' : 's'}`} v={inr(quote.rent)} />
          <Row k="Refundable deposit" v={inr(quote.deposit)} />
          <Row k="Pay at pickup" v={inr(quote.payAtHandover)} strong />
          {quote.kmAllowance ? <Text style={b.muted}>{quote.kmAllowance} km included{quote.extraPerKm ? ` · ${inr(quote.extraPerKm)} per extra km` : ''}</Text> : null}
        </>) : <Text style={b.muted}>{why || 'Getting the price from the server…'}</Text>}
        {quote && why ? <Text style={[b.muted, { color: DAY.red, marginTop: 6 }]}>{why}</Text> : null}
      </View>

      <SheetLabel>Note for the {words.giver} (optional)</SheetLabel>
      <TextInput value={note} onChangeText={setNote} placeholder="Pickup spot, ride plan…" placeholderTextColor={DAY.faint} maxLength={200} style={b.input} multiline />

      <Press onPress={() => { setAgree(!agree); setAgreeErr(false); }} label="I agree to the rental terms" style={b.agree}>
        <View style={[b.box, agree ? b.boxOn : null, agreeErr && !agree ? { borderColor: DAY.red, borderWidth: 2 } : null]}>{agree ? <ICheck size={14} color="#FFFFFF" strokeWidth={2.4} /> : null}</View>
        <Text style={b.agreeText}>I will show my licence at pickup, return on time, and pay any agreed extra km or damage charges.</Text>
      </Press>
      {agreeErr && !agree ? <Text accessibilityLiveRegion="polite" style={[b.muted, { color: DAY.red, marginTop: 6 }]}>{AGREE_MSG}</Text> : null}
      {err ? <Text style={[b.muted, { color: DAY.red, marginTop: 10 }]}>{err}</Text> : null}
    </Sheet>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={b.row}>
      <Text style={[b.rowK, strong ? { color: DAY.ink, fontWeight: W.label } : null]}>{k}</Text>
      <Text style={[b.rowV, strong ? { color: DAY.accent, fontWeight: W.title } : null]}>{v}</Text>
    </View>
  );
}

const NOTIFY_KEY = 'rentalsV2:notify';
function SampleSheet({ item }: { item: RItem }) {
  const nav = useNav();
  const router = useRouter();
  const vehicle = item.category === 'bike' || item.category === 'car';
  const noun = item.category === 'flat' ? 'flats' : item.category === 'room' ? 'rooms' : item.category === 'car' ? 'cars' : 'bikes';
  const notify = async () => {
    try {
      const raw = await AsyncStorage.getItem(NOTIFY_KEY);
      const set = new Set<string>(raw ? JSON.parse(raw) : []);
      set.add(item.category);
      await AsyncStorage.setItem(NOTIFY_KEY, JSON.stringify([...set]));
    } catch { /* storage unavailable: still confirm */ }
    nav.openSheet({ kind: 'sent', title: 'You are on the list', body: `We will show real ${noun} near campus here first as soon as they go live.` });
  };
  return (
    <Sheet visible onClose={nav.closeSheet} footer={
      <View style={{ gap: 10 }}>
        <CTA label="Notify me" onPress={notify} />
        {vehicle ? <Press onPress={() => { nav.closeSheet(); router.push('/rentals/new' as any); }} label="List your vehicle" style={b.ghost}><Text style={b.ghostText}>List your vehicle</Text></Press> : null}
      </View>}>
      <View style={{ alignItems: 'center', paddingTop: 4 }}>
        <ItemThumb item={item} w={180} h={120} radius={22} />
        <View style={b.tag}><IInfo size={13} color={DAY.sample} strokeWidth={1.8} /><Text style={b.tagText}>Sample listing</Text></View>
        <Text style={b.title}>{item.title}</Text>
        <Text style={b.body}>This is a sample listing. Real rentals near campus are coming soon. Tap “Notify me” to hear when they’re live.</Text>
      </View>
    </Sheet>
  );
}

function SentSheet({ title, body, mine }: { title: string; body: string; mine?: boolean }) {
  const nav = useNav();
  return (
    <Sheet visible onClose={nav.closeSheet} footer={<CTA label={mine ? 'View my rentals' : 'Done'} onPress={() => { nav.closeSheet(); if (mine) nav.push({ name: 'mine' }); }} />}>
      <View style={{ alignItems: 'center', paddingTop: 10 }}>
        <View style={[b.ok, { backgroundColor: PLATE.flat.bg[1] }]}><ICheck size={34} color={DAY.green} strokeWidth={2} /></View>
        <Text style={b.title}>{title}</Text>
        <Text style={b.body}>{body}</Text>
      </View>
    </Sheet>
  );
}

export default function RentalsV2Sheets() {
  const { sheet } = useNav();
  if (!sheet) return null;
  if (sheet.kind === 'book') return <BookSheet item={sheet.item} duration={sheet.duration} />;
  if (sheet.kind === 'sample') return <SampleSheet item={sheet.item} />;
  return <SentSheet title={sheet.title} body={sheet.body} mine={sheet.mine} />;
}

const b = themedSheet(() => ({
  gate: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: DAY.accentSoft, alignItems: 'center', marginTop: 4 },
  gateText: { flex: 1, fontSize: 12.5, color: DAY.ink2, lineHeight: 18 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  stepLabel: { flex: 1, fontSize: 13, color: DAY.ink2 },
  stepBtn: { width: 36, height: 36, borderRadius: 12, borderWidth: 1, borderColor: DAY.line, alignItems: 'center', justifyContent: 'center' },
  stepSign: { fontSize: 18, color: DAY.accent },
  stepVal: { minWidth: 22, textAlign: 'center', fontSize: 15, color: DAY.ink, fontWeight: W.title },
  quote: { marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: DAY.page, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowK: { fontSize: 13, color: DAY.muted },
  rowV: { fontSize: 13.5, color: DAY.ink },
  muted: { fontSize: 12, color: DAY.muted, marginTop: 8 },
  input: { minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: DAY.line, padding: 12, fontSize: 13.5, color: DAY.ink, textAlignVertical: 'top' },
  agree: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 16 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: DAY.faint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: DAY.accent, borderColor: DAY.accent },
  agreeText: { flex: 1, fontSize: 12.5, color: DAY.ink2, lineHeight: 18 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 16, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: DAY.sampleSoft },
  tagText: { fontSize: 12, color: DAY.sample, fontWeight: W.label },
  title: { fontSize: 19, fontWeight: W.title, color: DAY.ink, marginTop: 12, textAlign: 'center' },
  body: { fontSize: 13.5, color: DAY.ink2, lineHeight: 20, textAlign: 'center', marginTop: 8, paddingHorizontal: 8 },
  ghost: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: DAY.line, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 14.5, color: DAY.accent, fontWeight: W.label },
  ok: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
}));
