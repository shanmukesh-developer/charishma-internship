/**
 * ZCS Auto: the union queue board. Autos line up at each stand (SRM gate to Mangalagiri, to Vijayawada, ...)
 * in the order they arrive. The auto at the front is "on charge" (it leaves next); the autos behind it wait
 * (#2, #3 ...). Students can book any of them. For every destination this shows the auto on charge (driver
 * first name, auto number, live seats left, seat map, fare) with "Book 1 seat" (more seats up to the server's
 * limit), then each waiting auto with its seats left and its own Book button. Everything shown comes from
 * GET /api/auto-ride/on-charge. Cash to the driver at boarding; no payment picker.
 * If an auto fills while the student is booking, the server answers AUTO_JUST_FILLED; the board refreshes,
 * says "This auto just filled. The next auto is on charge now" and offers the next auto in the same card.
 * Front-seat rule: seats 1 and 2 beside the driver are for boys only (server-enforced). Seat counts show what THIS
 * passenger can book ("5 left · 3 for you"); when only the front seats are left for a girl the card says
 * "Only front seats left (boys only)" and offers the next auto with a seat for her. A passenger whose profile
 * gender is 'Prefer not to say' is asked once on this board "Are you booking for a boy?"; the answer goes with each
 * hold (riderGender) and is never saved to the profile.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FadeInUp } from '../others/motion';
import { readCache, writeCache } from '../../utils/swrCache';
import { autoRideApi, AutoRideError, errorCopy, inr, newIdempotencyKey, type ChargeAuto, type ChargeLine, type SeatState, type RiderGender } from './autoRideApi';
import { usePalette, Card, Btn, StateView, Notice, Stepper, AutoTile, VerifiedBadge, useAutoRideLive } from './ui';
import SeatMap, { askRiderGender } from './SeatMap';

const BOARD_KEY = 'autoride:on-charge';
const POLL_MS = 15000;
/** Codes meaning "this auto can no longer take your booking; another one can". */
const MOVED_ON = ['AUTO_JUST_FILLED', 'AUTO_OFF_CHARGE', 'WAITING_IN_LINE', 'TRIP_FULL', 'BOOKING_CLOSED'];
/** Codes of the front-seat rule (seats beside the driver are for boys only). */
const FRONT_ONLY = ['NO_SUITABLE_SEAT', 'FRONT_SEAT_MALE_ONLY'];
const FRONT_ONLY_NOTE = 'Only front seats left (boys only). Book the next auto below.';

/** Seats this passenger can book on an auto (falls back to all free seats on an older server). */
const forYou = (a: ChargeAuto) => (typeof a.seatsForYou === 'number' ? a.seatsForYou : a.remainingSeats);

const seatsWord = (n: number) => `${n} seat${n === 1 ? '' : 's'}`;

/** onUnavailable: the server has no on-charge board yet (older backend, 404): the parent hides this tab. */
export default function ChargeBoard({ onUnavailable }: { onUnavailable?: () => void } = {}) {
  const p = usePalette();
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;
  const [lines, setLines] = useState<ChargeLine[] | null>(null);
  const [maxPer, setMaxPer] = useState(4);
  const [error, setError] = useState<AutoRideError | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});
  // "Are you booking for a boy?" (profile gender unknown): asked once on this board, sent with each hold.
  const riderRef = useRef<RiderGender | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const r = await autoRideApi.onCharge();
      if (!alive.current) return;
      setLines(r.lines);
      setMaxPer(Math.max(1, Number(r.maxSeatsPerBooking) || 1));
      setError(null);
      writeCache(BOARD_KEY, { lines: r.lines, maxSeatsPerBooking: r.maxSeatsPerBooking });
    } catch (e: any) {
      if (!alive.current) return;
      if (e?.status === 404) { unavailableRef.current?.(); return; }
      setError(e instanceof AutoRideError ? e : new AutoRideError(e?.message || 'Could not load the autos.'));
    }
  }, []);

  useEffect(() => {
    readCache<{ lines: ChargeLine[]; maxSeatsPerBooking: number }>(BOARD_KEY).then((c) => {
      if (alive.current && c && c.data && Array.isArray(c.data.lines)) setLines((cur) => cur || c.data.lines);
    });
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  useAutoRideLive(() => { load(); });

  const onMovedOn = useCallback((key: string, message: string) => {
    setNotices((n) => ({ ...n, [key]: message }));
    load();
  }, [load]);
  const clearNotice = useCallback((key: string) => setNotices((n) => {
    if (!n[key]) return n;
    const next = { ...n };
    delete next[key];
    return next;
  }), []);

  if (error && error.code === 'FEATURE_OFF') {
    return <StateView kind="empty" icon="🛺" title="ZenWe Auto is not open yet" message={error.message} />;
  }
  if (lines === null && !error) return <StateView kind="loading" message="Looking for autos on charge…" />;
  if (error && !lines) {
    return <StateView kind="error" title={error.isNetwork ? 'You seem to be offline' : 'Could not load the autos'} message={error.message} actionLabel="Try again" onAction={load} />;
  }

  return (
    <View>
      <Text style={[st.intro, { color: p.sub }]}>
        Autos leave the stand one by one. Book the auto on charge, or one waiting behind it, and pay the driver in cash when you board.
      </Text>
      {error ? <Notice tone="warn">{error.message} Showing the last update.</Notice> : null}
      {(lines || []).length === 0 ? (
        <StateView kind="empty" icon="🛺" title="No stands yet" message="ZenWe Auto stands will show up here once they are set up." />
      ) : (
        (lines || []).map((l, i) => (
          <FadeInUp key={l.key} index={i}>
            <LineCard line={l} maxPer={maxPer} notice={notices[l.key] || null} onMovedOn={onMovedOn} clearNotice={clearNotice} reload={load} riderRef={riderRef} />
          </FadeInUp>
        ))
      )}
    </View>
  );
}

function LineCard({ line, maxPer, notice, onMovedOn, clearNotice, reload, riderRef }: {
  line: ChargeLine; maxPer: number; notice: string | null;
  onMovedOn: (key: string, message: string) => void; clearNotice: (key: string) => void; reload: () => void;
  riderRef: React.MutableRefObject<RiderGender | null>;
}) {
  const p = usePalette();
  const front = line.onCharge;
  const waiting = line.waitingAutos || [];
  const all = [...(front ? [front] : []), ...waiting];
  /** The next auto behind `a` with a seat for this passenger (offered when only boys-only seats are left on `a`). */
  const nextFor = (a: ChargeAuto) => {
    const i = all.findIndex((x) => x.id === a.id);
    return all.slice(i + 1).find((x) => forYou(x) > 0 && x.sharedBookingAllowed && !x.myBookingId) || null;
  };
  const common = { line, maxPer, onMovedOn, clearNotice, reload, riderRef };
  const shownFare = front ? front.seatFare : line.seatFare;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={st.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[st.dest, { color: p.text }]} numberOfLines={1}>To {line.destination || line.route?.destination || 'destination'}</Text>
          <Text style={{ fontSize: 13, color: p.sub, marginTop: 2 }} numberOfLines={1}>
            from {line.pickup?.name || 'the stand'}{line.pickup?.landmark ? ` · ${line.pickup.landmark}` : ''}
          </Text>
        </View>
        {shownFare ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[st.fare, { color: p.text }]}>{inr(shownFare)}</Text>
            <Text style={{ fontSize: 12, color: p.muted }}>per seat</Text>
          </View>
        ) : null}
      </View>

      {notice ? <View style={{ paddingHorizontal: 14 }}><Notice tone="info">{notice}</Notice></View> : null}

      {front ? (
        <AutoBlock auto={front} full next={nextFor(front)} {...common} />
      ) : (
        <View style={[st.empty, { backgroundColor: p.card2 }]}>
          <Ionicons name="time-outline" size={18} color={p.muted} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: p.text }}>No auto on charge right now</Text>
            <Text style={{ fontSize: 13, color: p.sub, marginTop: 2, lineHeight: 18 }}>
              {waiting.length ? 'The next auto in line goes on charge shortly. You can book it below.' : 'When a driver puts an auto on charge here, it shows up at once.'}
            </Text>
          </View>
        </View>
      )}

      {waiting.length ? (
        <View style={[st.waitHead, { borderTopColor: p.border }]}>
          <Ionicons name="people-outline" size={15} color={p.muted} />
          <Text style={{ fontSize: 13, color: p.sub }}>{waiting.length} auto{waiting.length === 1 ? '' : 's'} waiting behind</Text>
        </View>
      ) : front ? (
        <View style={[st.waitHead, { borderTopColor: p.border }]}>
          <Ionicons name="people-outline" size={15} color={p.muted} />
          <Text style={{ fontSize: 13, color: p.sub }}>No autos waiting behind</Text>
        </View>
      ) : null}
      {waiting.map((w) => (
        <AutoBlock key={w.id} auto={w} next={nextFor(w)} {...common} />
      ))}
    </Card>
  );
}

/**
 * One bookable auto. full = the auto on charge (pill, big seat count, seat map); otherwise a compact row for an
 * auto waiting in line (#2, #3 ...) with its seats left and Book.
 */
function AutoBlock({ auto: t, line, maxPer, full, next, onMovedOn, clearNotice, reload, riderRef }: {
  auto: ChargeAuto; line: ChargeLine; maxPer: number; full?: boolean; next: ChargeAuto | null;
  onMovedOn: (key: string, message: string) => void; clearNotice: (key: string) => void; reload: () => void;
  riderRef: React.MutableRefObject<RiderGender | null>;
}) {
  const p = usePalette();
  const router = useRouter();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const remaining = t.remainingSeats;
  const viewer = t.seatMap?.viewer || 'UNKNOWN';
  const mineFree = forYou(t);
  // What this passenger can book: a girl never counts the boys-only front seats; an unknown passenger may be a boy.
  const bookable = viewer === 'NOT_MALE' ? mineFree : remaining;
  const frontOnly = !!t.onlyFrontSeatsLeft;
  const maxHere = Math.max(1, Math.min(maxPer, bookable || 1));
  useEffect(() => { if (count > maxHere) setCount(maxHere); }, [count, maxHere]);
  useEffect(() => { setCount(1); }, [t.id]);
  const mine = !!t.myBookingId;
  const canBook = !mine && bookable > 0 && t.sharedBookingAllowed;

  const book = async (target: ChargeAuto = t, seats = count) => {
    if (busy) return;
    // Profile gender unknown: ask once, before the first quick booking on this board.
    if ((target.seatMap?.viewer || 'UNKNOWN') === 'UNKNOWN' && !riderRef.current) {
      const answer = await askRiderGender();
      if (!answer) return;
      riderRef.current = answer;
    }
    setBusy(true);
    let heldId: string | null = null;
    try {
      const rider = (target.seatMap?.viewer || 'UNKNOWN') === 'UNKNOWN' && riderRef.current ? { riderGender: riderRef.current } : {};
      const h = await autoRideApi.hold(target.id, { seatCount: seats, ...rider }, newIdempotencyKey());
      const b = h.booking;
      if (b.status === 'CONFIRMED' || b.status === 'BOARDED') { router.push(`/auto-ride/booking/${b.id}` as any); return; }
      heldId = b.id;
      const c = await autoRideApi.confirm(b.id, 'CASH', newIdempotencyKey());
      heldId = null;
      clearNotice(line.key);
      router.push(`/auto-ride/booking/${c.booking.id}` as any);
      reload();
    } catch (e: any) {
      const code = e?.code;
      // A seat held but not confirmed is given back at once (it would otherwise block it for a few minutes).
      if (heldId && !(e instanceof AutoRideError && e.isNetwork)) autoRideApi.release(heldId).catch(() => {});
      if (MOVED_ON.includes(code)) {
        // The server says whether the next auto is already on charge ("This auto just filled. The next auto is on charge now.").
        onMovedOn(line.key, e.message || 'This auto is no longer taking bookings.');
      } else if (FRONT_ONLY.includes(code)) {
        onMovedOn(line.key, FRONT_ONLY_NOTE);
      } else if (code === 'NOT_ENOUGH_SEATS') {
        Alert.alert('Not enough seats', e.message);
        reload();
      } else {
        const c = errorCopy(e);
        Alert.alert(c.title, c.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const ask = (target: ChargeAuto = t, seats = count) => {
    const front = target.id === line.onCharge?.id;
    Alert.alert(
      `Book ${seatsWord(seats)}?`,
      `${front ? 'The auto on charge' : `Auto number ${target.position} in line`}, to ${line.destination || 'the destination'} from ${line.pickup?.name || 'the stand'}. ${inr(target.seatFare * seats)}, paid to the driver in cash when you board.`,
      [{ text: 'Not now', style: 'cancel' }, { text: 'Book', onPress: () => { book(target, seats); } }],
    );
  };

  const states: Record<number, SeatState> = {};
  for (const s of t.seatMap?.seats || []) states[s.seatNo] = s.state;
  const filled = t.capacity ? Math.min(1, (t.capacity - remaining) / t.capacity) : 0;
  const differentFare = !full && line.onCharge && line.onCharge.seatFare !== t.seatFare;

  const driverRow = (
    <View style={st.driverRow}>
      <AutoTile size={full ? 44 : 36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {!full ? <Text style={{ fontSize: 13, color: p.muted, fontWeight: '600' }}>#{t.position}</Text> : null}
          <Text style={{ fontSize: 15, fontWeight: '600', color: p.text }} numberOfLines={1}>{t.driver?.firstName || t.driver?.name || 'Your driver'}</Text>
          <VerifiedBadge verified={!!t.driver?.verified} />
        </View>
        <Text style={{ fontSize: 13, color: p.sub, marginTop: 2, letterSpacing: 0.3 }} numberOfLines={1}>
          {t.vehicle?.registration || ''}{differentFare ? `${t.vehicle?.registration ? ' · ' : ''}${inr(t.seatFare)} per seat` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[full ? st.left : st.leftSmall, { color: remaining ? p.text : p.danger }]}>{remaining}</Text>
        <Text style={{ fontSize: 12, color: p.muted }}>of {t.capacity} left</Text>
        {viewer !== 'MALE' && remaining > 0 && mineFree < remaining ? (
          <Text style={{ fontSize: 12, color: mineFree ? p.sub : p.danger, fontWeight: '600', marginTop: 1 }}
            accessibilityLabel={`${remaining} seats left, ${mineFree} for you. The seats beside the driver are for boys only.`}>
            {mineFree} for you
          </Text>
        ) : null}
      </View>
    </View>
  );

  const actions = mine ? (
    <Btn label="View my booking" icon="ticket-outline" small={!full} style={{ marginTop: full ? 14 : 10 }} onPress={() => router.push(`/auto-ride/booking/${t.myBookingId}` as any)} />
  ) : canBook ? (
    <View style={{ marginTop: 10 }}>
      {full && maxHere > 1 ? <Stepper value={count} min={1} max={maxHere} onChange={setCount} label="Seats" /> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: full ? 10 : 0 }}>
        {!full && maxHere > 1 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Btn label="−" kind="secondary" small disabled={count <= 1} onPress={() => setCount(Math.max(1, count - 1))} />
            <Text style={{ minWidth: 22, textAlign: 'center', fontSize: 15, fontWeight: '600', color: p.text }} accessibilityLabel={`${count} seats`}>{count}</Text>
            <Btn label="+" kind="secondary" small disabled={count >= maxHere} onPress={() => setCount(Math.min(maxHere, count + 1))} />
          </View>
        ) : null}
        <Btn label={`Book ${seatsWord(count)}`} small={!full} loading={busy} onPress={() => ask()} style={{ flex: 1 }} />
      </View>
      {t.seatSelectionEnabled ? (
        <Btn label="Choose my seats" kind="ghost" small style={{ marginTop: 4 }} onPress={() => router.push(`/auto-ride/trip/${t.id}?book=1` as any)} />
      ) : null}
    </View>
  ) : null;
  // Only the boys-only front seats are left (for a girl, or for a passenger who has not said).
  const frontNote = !mine && frontOnly && remaining > 0 ? (
    <View style={{ marginTop: 10 }}>
      <View style={[st.frontNote, { backgroundColor: p.card2 }]}>
        <Ionicons name="lock-closed-outline" size={15} color={p.muted} />
        <Text style={{ flex: 1, fontSize: 13, color: p.text, lineHeight: 18 }}>Only front seats left (boys only)</Text>
      </View>
      {next ? (
        <Btn label={`Book auto #${next.position} instead`} kind="secondary" small style={{ marginTop: 8 }} loading={busy} onPress={() => ask(next, 1)} />
      ) : (
        <Text style={{ fontSize: 13, color: p.sub, marginTop: 6 }}>No other auto in this line has a back seat free yet. Check again in a minute.</Text>
      )}
    </View>
  ) : null;
  const closedNote = !mine && !canBook && !frontNote ? (
    <Text style={{ fontSize: 13, color: p.sub, marginTop: 10 }}>
      {remaining > 0 ? 'Seats are being booked right now. Check again in a minute.' : 'This auto is full.'}
    </Text>
  ) : null;

  if (!full) {
    return (
      <View style={[st.compact, { borderTopColor: p.border }]}>
        {driverRow}
        {actions}
        {frontNote}
        {closedNote}
      </View>
    );
  }
  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
      <View style={[st.pill, { backgroundColor: p.accentSoft }]}>
        <View style={[st.dot, { backgroundColor: p.button }]} />
        <Text style={{ fontSize: 12, fontWeight: '600', color: p.accent }}>On charge now</Text>
      </View>
      {driverRow}
      <View style={{ height: 4, borderRadius: 2, backgroundColor: p.card2, overflow: 'hidden', marginTop: 12 }}>
        <View style={{ width: `${Math.round(filled * 100)}%`, height: 4, backgroundColor: filled >= 1 ? p.danger : p.button }} />
      </View>
      {t.seatMap ? (
        <View style={{ marginTop: 14 }}>
          <SeatMap rows={t.seatMap.layout.rows} maleOnlySeats={t.seatMap.layout.maleOnlySeats} viewer={viewer} states={states} selected={[]} selectable={false} />
        </View>
      ) : null}
      {actions}
      {frontNote}
      {closedNote}
    </View>
  );
}

const st = StyleSheet.create({
  intro: { fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, paddingBottom: 10 },
  dest: { fontSize: 17, fontWeight: '700' },
  fare: { fontSize: 18, fontWeight: '700' },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  left: { fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  leftSmall: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  waitHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  compact: { paddingHorizontal: 14, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  frontNote: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  empty: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 14, marginBottom: 14, borderRadius: 12, padding: 12 },
});
