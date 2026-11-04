/**
 * Co-Ride v2 · one ZCS Auto stand on the board (same rules as modules/autoRide/ChargeBoard):
 *  - the seat map is modules/autoRide/SeatMap (layout.rows, layout.maleOnlySeats, viewer): the two seats
 *    beside the driver are boys only;
 *  - "N for you" from seatsForYou; when onlyFrontSeatsLeft: "Only front seats left (boys only)" and
 *    "Book auto #N instead" (the next auto in line with a seat for this passenger);
 *  - profile gender unknown: askRiderGender() once, sent as riderGender with the hold (never saved);
 *  - FRONT_SEAT_MALE_ONLY / NO_SUITABLE_SEAT and "moved on" codes refresh the board with a note;
 *  - the auto on charge with seat selection on (trip.seatSelectionEnabled): tapped seats are HELD on the server
 *    at once (others see them as being booked), Book confirms that hold; with none tapped, the server picks the
 *    best free seats for the count;
 *    an auto waiting in line opens the seat picker (app/auto-ride/trip/[id]?book=1) from "Choose seats";
 *  - success opens app/auto-ride/booking/[id] (PIN and the "Reach the auto in mm:ss" countdown).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { CR, W } from './coRideV2Theme';
import { Pill, PrimaryButton, OutlineButton, Card } from './CoRideV2Kit';
import { IBadge, ITicket, IUsers, ILock, STROKE } from './CoRideV2Icons';
import { RouteRail } from './CoRideV2RideCard';
import { SeatStepper } from './CoRideV2AutoParts';
import SeatMap, { askRiderGender, FRONT_SEAT_NOTE } from '../../modules/autoRide/SeatMap';
import { useCoRide } from './coRideV2Data';
import { inr, errorCopy, autoRideApi, newIdempotencyKey, type ChargeAuto, type ChargeLine, type SeatState, type SeatViewer, type RiderGender } from '../../modules/autoRide/autoRideApi';
import { themedSheet } from '../../utils/themeNow';

const MOVED_ON = ['AUTO_JUST_FILLED', 'AUTO_OFF_CHARGE', 'WAITING_IN_LINE', 'TRIP_FULL', 'BOOKING_CLOSED'];
const FRONT_ONLY = ['NO_SUITABLE_SEAT', 'FRONT_SEAT_MALE_ONLY'];
const seatsWord = (n: number) => `${n} seat${n === 1 ? '' : 's'}`;
const seatList = (ns: number[]) => `seat${ns.length === 1 ? '' : 's'} ${ns.join(', ')}`;
const SEAT_CHANGED = ['SEAT_TAKEN', 'INVALID_INPUT', 'SEAT_SELECTION_OFF'];
const HOLD_ENDED = ['HOLD_EXPIRED', 'BOOKING_NOT_HELD', 'BOOKING_EXPIRED'];
const forYou = (a: ChargeAuto) => (typeof a.seatsForYou === 'number' ? a.seatsForYou : a.remainingSeats);
const seatStates = (t: ChargeAuto) => { const m: Record<number, SeatState> = {}; (t.seatMap?.seats || []).forEach((x) => { m[x.seatNo] = x.state; }); return m; };

// The answer to "who is riding?" is kept for this app session only (it is never saved to the profile).
let riderAnswer: RiderGender | null = null;

function AutoBlock({ auto: t, line, front, next, onNote }: { auto: ChargeAuto; line: ChargeLine; front?: boolean; next: ChargeAuto | null; onNote: (m: string) => void }) {
  const d = useCoRide();
  const router = useRouter();
  const [count, setCount] = useState(1);
  // Redraws the board once "who is riding?" is answered (the answer lives in riderAnswer, for this app session).
  const [, setAnswered] = useState(0);
  const remaining = t.remainingSeats;
  const rawViewer: SeatViewer = t.seatMap?.viewer || 'UNKNOWN';
  // Boys can book every seat; only the two seats beside the driver are closed to girls. A profile without a gender
  // answers once; after "a boy" the board counts every seat for him, after "a girl" only the back rows.
  const viewer: SeatViewer = rawViewer === 'UNKNOWN' && riderAnswer ? (riderAnswer === 'Male' ? 'MALE' : 'NOT_MALE') : rawViewer;
  const states = seatStates(t);
  const maleOnly = new Set(t.seatMap?.layout?.maleOnlySeats || []);
  const myHeldSeats = Object.keys(states).map(Number).filter((n) => states[n] === 'MINE_HELD').sort((x, y) => x - y);
  const heldByMe = !!t.myBookingId && t.myBookingStatus === 'HELD';
  const freeSeats = Object.keys(states).map(Number).filter((n) => states[n] === 'AVAILABLE');
  const mineFree = t.seatMap ? (viewer === 'MALE' ? freeSeats.length : freeSeats.filter((n) => !maleOnly.has(n)).length) : forYou(t);
  // Seats this rider can still take here, counting the ones they are holding right now.
  const bookable = (viewer === 'NOT_MALE' ? mineFree : remaining) + (heldByMe ? myHeldSeats.length : 0);
  const max = Math.max(1, Math.min(d.autoMaxSeats, bookable || 1));
  useEffect(() => { if (count > max) setCount(max); }, [count, max]);
  const mine = !!t.myBookingId && !heldByMe;
  const canBook = !mine && bookable > 0 && t.sharedBookingAllowed;
  const frontOnly = !mine && !heldByMe && !!t.onlyFrontSeatsLeft && remaining > 0;
  // Seat choice on the auto on charge (the seat map is only drawn there).
  const pickMode = !!front && !!t.seatSelectionEnabled && canBook && !!t.seatMap?.layout?.rows?.length;
  const maxPick = max;
  const [picked, setPicked] = useState<number[]>([]);

  // Tapped seats are HELD on the server at once (POST holds with seatNumbers), so every other rider's board shows
  // them as "being booked" and nobody else can take them. Changing the choice releases the old hold and holds the
  // new seats; the hold ends by itself after a few minutes, on Book it is confirmed, on leaving it is released.
  const holdRef = useRef<{ id: string; seats: number[]; at: number } | null>(null);
  const wantRef = useRef<number[] | null>(null);
  const syncRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userPicked = useRef(false);
  const same = (x: number[], y: number[]) => x.length === y.length && x.every((n, i) => n === y[i]);

  const runSync = (): Promise<void> => {
    if (syncRef.current) return syncRef.current;
    syncRef.current = (async () => {
      try {
        while (wantRef.current) {
          const want = wantRef.current;
          wantRef.current = null;
          const cur = holdRef.current;
          if (cur && same(cur.seats, want)) continue;
          if (cur) { holdRef.current = null; await autoRideApi.release(cur.id).catch(() => {}); }
          if (!want.length) continue;
          try {
            const gender = rawViewer === 'UNKNOWN' && riderAnswer ? { riderGender: riderAnswer } : {};
            const h = await autoRideApi.hold(t.id, { seatCount: want.length, seatNumbers: want, ...gender }, newIdempotencyKey());
            if (h.booking?.status === 'HELD') holdRef.current = { id: h.booking.id, seats: want, at: Date.now() };
          } catch (e: any) {
            wantRef.current = null;
            const gone: number[] = (e?.data?.seats || e?.data?.details?.seats || []).map(Number);
            setPicked((p0) => (gone.length ? p0.filter((n) => !gone.includes(n)) : []));
            onNote(e?.code === 'SEAT_TAKEN' ? (e.message || 'That seat was just taken. Pick another seat.')
              : e?.code === 'RATE_LIMITED' ? 'You changed seats many times. Wait a minute, then pick again.'
                : (e?.message || 'Could not hold that seat. Please try again.'));
          }
        }
      } finally {
        syncRef.current = null;
        d.reloadAuto();
      }
    })();
    return syncRef.current;
  };
  const flushHold = async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; wantRef.current = picked; }
    if (wantRef.current || syncRef.current) await runSync();
  };
  // A short pause after the last tap, so quick taps make one hold, not several.
  useEffect(() => {
    if (!pickMode || !userPicked.current) return;
    userPicked.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; wantRef.current = picked; runSync(); }, 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, pickMode]);
  // Leaving the board (or the auto leaving the charge) releases a hold that was never booked.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const h = holdRef.current;
    holdRef.current = null;
    if (h) autoRideApi.release(h.id).catch(() => {});
  }, []);
  useEffect(() => {
    // Reopened with a hold of mine on this auto: show those seats as my choice.
    if (pickMode && heldByMe && !holdRef.current && !syncRef.current && myHeldSeats.length) {
      holdRef.current = { id: String(t.myBookingId), seats: myHeldSeats, at: Date.now() };
      setPicked(myHeldSeats);
      return;
    }
    // My hold ended elsewhere (expired after a few minutes): clear the choice. A hold just made waits for the board.
    if (holdRef.current && !heldByMe && !syncRef.current && Date.now() - holdRef.current.at > 8000) {
      holdRef.current = null;
      setPicked([]);
      onNote('Your seat hold ended. Pick your seats again.');
      return;
    }
    // A chosen seat someone else just took is dropped from the choice.
    setPicked((cur) => { const keep = cur.filter((n) => states[n] === 'AVAILABLE' || states[n] === 'MINE_HELD'); return keep.length === cur.length ? cur : keep; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const toggle = async (n: number) => {
    if (!picked.includes(n) && maleOnly.has(n) && viewer !== 'MALE') {
      if (viewer === 'UNKNOWN') {
        const a = await askRiderGender();
        if (!a) return;
        riderAnswer = a;
        setAnswered((x) => x + 1);
      }
      if (viewer === 'NOT_MALE' || riderAnswer !== 'Male') { Alert.alert(`Seat ${n} is for boys only`, FRONT_SEAT_NOTE); return; }
    }
    userPicked.current = true;
    setPicked((cur) => {
      if (cur.includes(n)) return cur.filter((x) => x !== n);
      if (cur.length >= maxPick) {
        if (maxPick === 1) return [n];
        Alert.alert('Seat limit', `You can book up to ${seatsWord(maxPick)} on this auto.`);
        return cur;
      }
      return [...cur, n].sort((x, y) => x - y);
    });
  };

  const book = async (target: ChargeAuto, seats: number, seatNumbers?: number[]) => {
    // Only the seats beside the driver depend on who rides: chosen back seats (3-8) never ask "boy or girl?".
    const backSeatsOnly = !!seatNumbers?.length && seatNumbers.every((n) => !maleOnly.has(n));
    if ((target.seatMap?.viewer || 'UNKNOWN') === 'UNKNOWN' && !riderAnswer && !backSeatsOnly) {
      const a = await askRiderGender();
      if (!a) return;
      riderAnswer = a;
      setAnswered((x) => x + 1);
    }
    const riderGender = (target.seatMap?.viewer || 'UNKNOWN') === 'UNKNOWN' ? riderAnswer : null;
    // Chosen seats: finish holding them, then confirm that hold (no second hold for the same seats).
    let heldId: string | undefined;
    if (seatNumbers?.length && target.id === t.id) {
      await flushHold();
      if (holdRef.current && same(holdRef.current.seats, seatNumbers)) heldId = holdRef.current.id;
      else return; // the seats could not be held (a note says why); the choice was updated
    }
    const r = await d.act('bookAuto', { auto: target, count: seats, riderGender, seatNumbers, heldId });
    if (r.ok) { holdRef.current = null; setPicked([]); if (r.data?.id) router.push(`/auto-ride/booking/${r.data.id}` as any); return; }
    if (heldId) holdRef.current = null;
    if (r.code && SEAT_CHANGED.includes(r.code)) { setPicked([]); onNote(r.message || 'That seat was just taken. Pick another seat.'); }
    else if (r.code && HOLD_ENDED.includes(r.code)) { setPicked([]); onNote('Your seat hold ended. Pick your seats again.'); }
    else if (r.code && MOVED_ON.includes(r.code)) onNote(r.message || 'This auto is no longer taking bookings.');
    else if (r.code && FRONT_ONLY.includes(r.code)) onNote(r.message || 'Only front seats left (boys only). Book the next auto below.');
    else { const c = errorCopy({ code: r.code, message: r.message }); Alert.alert(c.title, c.message); }
  };
  const ask = (target: ChargeAuto, seats: number, seatNumbers?: number[]) => {
    const isFront = target.id === line.onCharge?.id;
    Alert.alert(
      seatNumbers?.length ? `Book ${seatList(seatNumbers)}?` : `Book ${seatsWord(seats)}?`,
      `${isFront ? 'The auto on charge' : `Auto number ${target.position} in line`}, to ${line.destination || 'the destination'} from ${line.pickup?.name || 'the stand'}. ${inr((target.seatFare || 0) * seats)}, paid to the driver in cash when you board.`,
      [{ text: 'Not now', style: 'cancel' }, { text: 'Book', onPress: () => { book(target, seats, seatNumbers); } }],
    );
  };
  // "N of 8 left" matches the seat map: the server counts a seat held by anyone (this rider too) as not left, and a
  // seat tapped here that is still being held (the short pause before the hold) is not counted as left either.
  const pendingPicks = pickMode ? picked.filter((n) => states[n] === 'AVAILABLE').length : 0;
  const shownLeft = Math.max(0, remaining - pendingPicks);
  const filled = t.capacity ? Math.min(1, (t.capacity - shownLeft) / t.capacity) : 0;
  const busy = d.busy === String(t.id) || (!!next && d.busy === String(next.id));

  return (
    <View style={front ? st.front : st.waiting}>
      {front ? <Pill text="On charge now" tone="blue" style={{ marginBottom: 12 }} /> : null}
      <View style={st.row}>
        <View style={st.pos}><Text style={st.posText}>#{t.position}</Text></View>
        <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
          <View style={[st.row, { gap: 6 }]}>
            <Text style={st.driver} numberOfLines={1}>{t.driver?.firstName || t.driver?.name || 'Your driver'}</Text>
            {t.driver?.verified ? <IBadge size={15} color={CR.primary} strokeWidth={1.8} /> : null}
          </View>
          <Text style={st.meta} numberOfLines={1}>{t.vehicle?.registration || 'Auto number shows when you book'}{!front && line.onCharge && line.onCharge.seatFare !== t.seatFare ? ` · ${inr(t.seatFare)} per seat` : ''}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[front ? st.leftBig : st.left, { color: shownLeft ? CR.ink : CR.red }]}>{shownLeft}</Text>
          <Text style={st.meta}>of {t.capacity} left</Text>
          {viewer !== 'MALE' && remaining > 0 && mineFree < remaining ? (
            <Text style={[st.meta, { color: mineFree ? CR.ink2 : CR.red, fontWeight: W.label }]} accessibilityLabel={`${mineFree} seats for you. The seats beside the driver are for boys only.`}>{mineFree} for you</Text>
          ) : null}
        </View>
      </View>
      {front ? (
        <>
          <View style={st.bar}><View style={[st.barFill, { width: `${Math.round(filled * 100)}%`, backgroundColor: filled >= 1 ? CR.red : CR.primary }]} /></View>
          {t.seatMap?.layout?.rows?.length ? (
            <View style={{ marginTop: 16 }}>
              <SeatMap rows={t.seatMap.layout.rows} maleOnlySeats={t.seatMap.layout.maleOnlySeats} viewer={viewer} states={states} selected={pickMode ? picked : []} selectable={pickMode} onToggle={pickMode ? toggle : undefined} />
              {pickMode ? (
                <Text style={[st.meta, { textAlign: 'center', marginTop: 8 }]}>
                  {picked.length ? `${seatList(picked)} held for you for a few minutes. Others see ${picked.length === 1 ? 'it' : 'them'} as being booked. Tap again to remove.` : 'Tap a free seat to hold it, or just book and we give you the best free seat.'}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
      {mine ? (
        <OutlineButton label="View my booking" icon={ITicket} small style={{ marginTop: 12 }} onPress={() => router.push(`/auto-ride/booking/${t.myBookingId}` as any)} />
      ) : canBook ? (
        <View style={[st.row, { gap: 10, marginTop: 14 }]}>
          {max > 1 && !picked.length ? <SeatStepper value={count} max={max} onChange={setCount} /> : null}
          {picked.length ? (
            <PrimaryButton label={`Book ${seatList(picked)} · ${inr((t.seatFare || 0) * picked.length)}`} onPress={() => ask(t, picked.length, picked)} busy={busy} small style={{ flex: 1 }} />
          ) : (
            <PrimaryButton label={`Book ${seatsWord(count)} · ${inr((t.seatFare || 0) * count)}`} onPress={() => ask(t, count)} busy={busy} small style={{ flex: 1 }} />
          )}
        </View>
      ) : null}
      {canBook && !front && t.seatSelectionEnabled ? (
        <OutlineButton label="Choose seats" small style={{ marginTop: 8 }} onPress={() => router.push(`/auto-ride/trip/${t.id}?book=1` as any)} />
      ) : null}
      {frontOnly ? (
        <View style={{ marginTop: 12 }}>
          <View style={st.frontNote}>
            <ILock size={15} color={CR.muted} strokeWidth={STROKE} />
            <Text style={st.frontText}>Only front seats left (boys only)</Text>
          </View>
          {next ? <OutlineButton label={busy ? "Booking…" : `Book auto #${next.position} instead`} small disabled={busy} onPress={() => ask(next, 1)} style={{ marginTop: 8 }} />
            : <Text style={[st.meta, { marginTop: 6 }]}>No other auto in this line has a back seat free yet. Check again in a minute.</Text>}
        </View>
      ) : !mine && !canBook ? (
        <Text style={[st.meta, { marginTop: 12 }]}>{remaining > 0 ? 'Seats are being booked right now. Check again in a minute.' : 'This auto is full.'}</Text>
      ) : null}
    </View>
  );
}

export function LineCard({ line }: { line: ChargeLine }) {
  const [note, setNote] = useState<string | null>(null);
  const d = useCoRide();
  const lastKey = useRef(line.key);
  useEffect(() => { if (lastKey.current !== line.key) { lastKey.current = line.key; setNote(null); } }, [line.key]);
  const waiting = line.waitingAutos || [];
  const all = [...(line.onCharge ? [line.onCharge] : []), ...waiting];
  const nextFor = (t: ChargeAuto) => { const i = all.findIndex((a) => a.id === t.id); return all.slice(i + 1).find((a) => forYou(a) > 0 && !a.onlyFrontSeatsLeft) || null; };
  const fare = line.onCharge?.seatFare || line.seatFare;
  const onNote = (m: string) => { setNote(m); d.reloadAuto(); };
  return (
    <Card style={st.card}>
      <View style={[st.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <RouteRail from={`${line.pickup?.name || 'Stand'}${line.pickup?.landmark ? ` · ${line.pickup.landmark}` : ''}`} to={line.destination || line.route?.destination || 'Destination'} />
        </View>
        {fare ? <View style={{ alignItems: 'flex-end', marginLeft: 10 }}><Text style={st.fare}>{inr(fare)}</Text><Text style={st.meta}>per seat</Text></View> : null}
      </View>
      {note ? <Text style={st.note}>{note}</Text> : null}
      <View style={st.hr} />
      {line.onCharge ? <AutoBlock auto={line.onCharge} line={line} front next={nextFor(line.onCharge)} onNote={onNote} /> : (
        <View style={st.none}>
          <Text style={st.noneTitle}>No auto on charge right now</Text>
          <Text style={st.meta}>{waiting.length ? 'The next auto in line goes on charge shortly. You can book it below.' : 'When a driver puts an auto on charge here, it shows up at once.'}</Text>
        </View>
      )}
      <View style={st.waitHead}>
        <IUsers size={15} color={CR.muted} strokeWidth={STROKE} />
        <Text style={st.meta}>{waiting.length ? `${waiting.length} auto${waiting.length === 1 ? '' : 's'} waiting behind` : 'No autos waiting behind'}</Text>
      </View>
      {waiting.map((w) => <AutoBlock key={w.id} auto={w} line={line} next={nextFor(w)} onNote={onNote} />)}
    </Card>
  );
}

const st = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  card: { padding: 14, marginBottom: 12 },
  fare: { fontSize: 20, fontWeight: W.title, color: CR.ink },
  meta: { fontSize: 12.5, color: CR.muted, marginTop: 2, lineHeight: 17 },
  note: { fontSize: 13, color: CR.amber, backgroundColor: CR.amberSoft, borderRadius: 10, padding: 10, marginTop: 12, lineHeight: 18 },
  hr: { height: StyleSheet.hairlineWidth * 2, backgroundColor: CR.lineSoft, marginVertical: 14 },
  front: { paddingBottom: 4 },
  waiting: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: CR.lineSoft, paddingTop: 12, marginTop: 12 },
  pos: { width: 38, height: 38, borderRadius: 12, backgroundColor: CR.mint, alignItems: 'center', justifyContent: 'center' },
  posText: { fontSize: 13, fontWeight: W.title, color: CR.mintInk },
  driver: { fontSize: 15, fontWeight: W.title, color: CR.ink, flexShrink: 1 },
  leftBig: { fontSize: 26, fontWeight: W.title, letterSpacing: -0.4 },
  left: { fontSize: 18, fontWeight: W.title },
  bar: { height: 4, borderRadius: 2, backgroundColor: CR.lineSoft, overflow: 'hidden', marginTop: 12 },
  barFill: { height: 4 },
  none: { backgroundColor: CR.page, borderRadius: 12, padding: 12 },
  noneTitle: { fontSize: 14, fontWeight: W.label, color: CR.ink },
  waitHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  frontNote: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: CR.page, borderRadius: 10, padding: 10 },
  frontText: { flex: 1, fontSize: 13, color: CR.ink, lineHeight: 18 },
}));
