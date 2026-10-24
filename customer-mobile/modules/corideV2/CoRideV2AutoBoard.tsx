/**
 * Co-Ride v2 · one ZCS Auto stand on the board (same rules as modules/autoRide/ChargeBoard):
 *  - the seat map is modules/autoRide/SeatMap (layout.rows, layout.maleOnlySeats, viewer): the two seats
 *    beside the driver are boys only;
 *  - "N for you" from seatsForYou; when onlyFrontSeatsLeft: "Only front seats left (boys only)" and
 *    "Book auto #N instead" (the next auto in line with a seat for this passenger);
 *  - profile gender unknown: askRiderGender() once, sent as riderGender with the hold (never saved);
 *  - FRONT_SEAT_MALE_ONLY / NO_SUITABLE_SEAT and "moved on" codes refresh the board with a note;
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
import SeatMap, { askRiderGender } from '../../modules/autoRide/SeatMap';
import { useCoRide } from './coRideV2Data';
import { inr, errorCopy, type ChargeAuto, type ChargeLine, type SeatState, type RiderGender } from '../../modules/autoRide/autoRideApi';

const MOVED_ON = ['AUTO_JUST_FILLED', 'AUTO_OFF_CHARGE', 'WAITING_IN_LINE', 'TRIP_FULL', 'BOOKING_CLOSED'];
const FRONT_ONLY = ['NO_SUITABLE_SEAT', 'FRONT_SEAT_MALE_ONLY'];
const seatsWord = (n: number) => `${n} seat${n === 1 ? '' : 's'}`;
const forYou = (a: ChargeAuto) => (typeof a.seatsForYou === 'number' ? a.seatsForYou : a.remainingSeats);
const seatStates = (t: ChargeAuto) => { const m: Record<number, SeatState> = {}; (t.seatMap?.seats || []).forEach((x) => { m[x.seatNo] = x.state; }); return m; };

// The answer to "who is riding?" is kept for this app session only (it is never saved to the profile).
let riderAnswer: RiderGender | null = null;

function AutoBlock({ auto: t, line, front, next, onNote }: { auto: ChargeAuto; line: ChargeLine; front?: boolean; next: ChargeAuto | null; onNote: (m: string) => void }) {
  const d = useCoRide();
  const router = useRouter();
  const [count, setCount] = useState(1);
  const remaining = t.remainingSeats;
  const viewer = t.seatMap?.viewer || 'UNKNOWN';
  const mineFree = forYou(t);
  const bookable = viewer === 'NOT_MALE' ? mineFree : remaining;
  const max = Math.max(1, Math.min(d.autoMaxSeats, bookable || 1));
  useEffect(() => { if (count > max) setCount(max); }, [count, max]);
  const mine = !!t.myBookingId;
  const canBook = !mine && bookable > 0 && t.sharedBookingAllowed;
  const frontOnly = !mine && !!t.onlyFrontSeatsLeft && remaining > 0;

  const book = async (target: ChargeAuto, seats: number) => {
    if ((target.seatMap?.viewer || 'UNKNOWN') === 'UNKNOWN' && !riderAnswer) {
      const a = await askRiderGender();
      if (!a) return;
      riderAnswer = a;
    }
    const riderGender = (target.seatMap?.viewer || 'UNKNOWN') === 'UNKNOWN' ? riderAnswer : null;
    const r = await d.act('bookAuto', { auto: target, count: seats, riderGender });
    if (r.ok) { if (r.data?.id) router.push(`/auto-ride/booking/${r.data.id}` as any); return; }
    if (r.code && MOVED_ON.includes(r.code)) onNote(r.message || 'This auto is no longer taking bookings.');
    else if (r.code && FRONT_ONLY.includes(r.code)) onNote(r.message || 'Only front seats left (boys only). Book the next auto below.');
    else { const c = errorCopy({ code: r.code, message: r.message }); Alert.alert(c.title, c.message); }
  };
  const ask = (target: ChargeAuto, seats: number) => {
    const isFront = target.id === line.onCharge?.id;
    Alert.alert(
      `Book ${seatsWord(seats)}?`,
      `${isFront ? 'The auto on charge' : `Auto number ${target.position} in line`}, to ${line.destination || 'the destination'} from ${line.pickup?.name || 'the stand'}. ${inr((target.seatFare || 0) * seats)}, paid to the driver in cash when you board.`,
      [{ text: 'Not now', style: 'cancel' }, { text: 'Book', onPress: () => { book(target, seats); } }],
    );
  };
  const filled = t.capacity ? Math.min(1, (t.capacity - remaining) / t.capacity) : 0;
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
          <Text style={[front ? st.leftBig : st.left, { color: remaining ? CR.ink : CR.red }]}>{remaining}</Text>
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
              <SeatMap rows={t.seatMap.layout.rows} maleOnlySeats={t.seatMap.layout.maleOnlySeats} viewer={viewer} states={seatStates(t)} selected={[]} selectable={false} />
            </View>
          ) : null}
        </>
      ) : null}
      {mine ? (
        <OutlineButton label="View my booking" icon={ITicket} small style={{ marginTop: 12 }} onPress={() => router.push(`/auto-ride/booking/${t.myBookingId}` as any)} />
      ) : canBook ? (
        <View style={[st.row, { gap: 10, marginTop: 14 }]}>
          {max > 1 ? <SeatStepper value={count} max={max} onChange={setCount} /> : null}
          <PrimaryButton label={`Book ${seatsWord(count)} · ${inr((t.seatFare || 0) * count)}`} onPress={() => ask(t, count)} busy={busy} small style={{ flex: 1 }} />
        </View>
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

const st = StyleSheet.create({
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
});
