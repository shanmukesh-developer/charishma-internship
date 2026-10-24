/**
 * Driver seat map: the shared auto-rickshaw seen from above, front at the top, drawn like the passenger app's
 * map (customer-mobile/modules/autoRide/SeatMap.tsx) so both sides see the same seats in the same places.
 * The real ZCS auto (trip seatLayout from the server) is
 *     1  driver  2      (front bench, beside you: boys only in the app)
 *     3    4     5
 *     6    7     8
 * Any admin layout (up to 6 rows x 5 places) is drawn the same way: rounded body with a narrower nose, windshield
 * arc and handlebar, your seat with the steering wheel, then a bench strip under each passenger row.
 * States are colour-keyed as before AND carry an icon and a word: free, held (being booked), app booking,
 * checked in, walk-in, closed. Seats in maleOnlySeats show a small "Boys" tag: the app only sells them to boys;
 * you can still mark any seat for a walk-in (you decide in person). With onSeatPress the seats become buttons
 * (tap a free seat to fill it with a walk-in, a walk-in seat to free it).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { LayoutCell, SeatState } from '../types';

export type DriverSeatState = Exclude<SeatState, 'MINE' | 'MINE_HELD'> | 'BOARDED';
type Ion = keyof typeof Ionicons.glyphMap;

export const SEAT_META: Record<DriverSeatState, { label: string; word: string; icon: Ion | null; color: string; fg: string; bg: string }> = {
  AVAILABLE: { label: 'Free', word: 'Free', icon: null, color: '#0E9F5B', fg: '#08743F', bg: '#FFFFFF' },
  HELD: { label: 'Being booked', word: 'Booking', icon: 'time-outline', color: '#F59E0B', fg: '#78350F', bg: '#FEF3C7' },
  BOOKED: { label: 'App booking', word: 'App', icon: 'phone-portrait-outline', color: '#475569', fg: '#FFFFFF', bg: '#64748B' },
  BOARDED: { label: 'Checked in', word: 'In', icon: 'checkmark-done', color: '#7C3AED', fg: '#FFFFFF', bg: '#7C3AED' },
  WALK_IN: { label: 'Walk-in', word: 'Walk-in', icon: 'walk-outline', color: '#0F766E', fg: '#FFFFFF', bg: '#0F766E' },
  UNAVAILABLE: { label: 'Closed', word: 'Closed', icon: 'remove', color: '#94A3B8', fg: '#64748B', bg: '#F1F5F9' },
};
const LEGEND: DriverSeatState[] = ['AVAILABLE', 'BOOKED', 'WALK_IN', 'BOARDED', 'HELD'];

const besideDriver = (rows: LayoutCell[][]) => {
  const r = rows.find((row) => row.includes('D'));
  return r ? r.filter((c): c is number => typeof c === 'number') : [];
};
const POS: Record<number, string[]> = {
  1: ['centre'], 2: ['left', 'right'], 3: ['left', 'centre', 'right'],
  4: ['left', 'centre left', 'centre right', 'right'], 5: ['left', 'centre left', 'centre', 'centre right', 'right'],
};
const placeOf = (rows: LayoutCell[][], ri: number, ci: number) => {
  const row = rows[ri];
  const places = row.map((c, i) => ({ c, i })).filter((x) => x.c !== null);
  const k = places.findIndex((x) => x.i === ci);
  const pos = (POS[places.length] || [])[k] || `place ${k + 1}`;
  if (row.includes('D')) return `front row ${pos}, beside you`;
  const rear = rows.map((r, i) => ({ r, i })).filter((x) => !x.r.includes('D'));
  const j = rear.findIndex((x) => x.i === ri);
  const name = rear.length === 1 || j === 0 ? 'back row' : j === rear.length - 1 ? 'last row' : `row ${ri + 1}`;
  return `${name} ${pos}`;
};

const BODY = '#F6F7F9';
const OUTLINE = 'rgba(11,13,18,0.18)';
const BENCH = '#E2E6EC';
const LINE = 'rgba(11,13,18,0.10)';

export default function SeatMap({ rows, states, labels, onSeatPress, busySeat, maleOnlySeats }: {
  rows: LayoutCell[][];
  states: Record<number, DriverSeatState>;
  /** seat -> passenger first name (bookings list) */
  labels?: Record<number, string>;
  /** Makes every passenger seat a button (walk-in editing). */
  onSeatPress?: (seatNo: number, state: DriverSeatState) => void;
  /** Seat whose change is being sent (dimmed). */
  busySeat?: number | null;
  /** Seats the app sells to boys only (server layout.maleOnlySeats); default: the seats beside the driver. */
  maleOnlySeats?: number[];
}) {
  const [w, setW] = useState(0);
  const male = useMemo(() => new Set(maleOnlySeats ?? besideDriver(rows)), [maleOnlySeats, rows]);
  const cols = useMemo(() => Math.max(1, ...rows.map((r) => r.length)), [rows]);
  const avail = Math.min(w || 340, 400);
  const gap = cols >= 4 ? 8 : 12;
  const side = cols >= 5 ? 16 : 24;
  const seat = Math.max(44, Math.min(52, Math.floor((avail - side * 2 - gap * (cols - 1)) / cols)));
  const rowW = cols * seat + gap * (cols - 1);
  const W = rowW + side * 2;
  const noseH = 62;
  const driverRowIdx = rows.findIndex((r) => r.includes('D'));
  const rowH = (ri: number) => seat + (ri === driverRowIdx ? 16 : 14);
  const rowGap = 14;
  const tops: number[] = [];
  let y = noseH;
  rows.forEach((_, ri) => { tops.push(y); y += rowH(ri) + (ri < rows.length - 1 ? rowGap : 0); });
  const H = y + 22;
  const count = rows.flat().filter((c) => typeof c === 'number').length;
  const outlinePath = `M ${W * 0.3} 5 Q ${W / 2} -3 ${W * 0.7} 5 C ${W * 0.86} 11 ${W - 9} ${noseH * 0.5} ${W - 9} ${noseH - 2} L ${W - 2} ${H - 24} Q ${W - 2} ${H - 2} ${W - 24} ${H - 2} L 24 ${H - 2} Q 2 ${H - 2} 2 ${H - 24} L 9 ${noseH - 2} C 9 ${noseH * 0.5} ${W * 0.14} 11 ${W * 0.3} 5 Z`;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ alignItems: 'center' }}>
      <View style={{ width: W, height: H }} accessibilityLabel={`Seat map, ${count} passenger seats, front at the top`}>
        <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
          <Path d={outlinePath} fill={BODY} stroke={OUTLINE} strokeWidth={1.2} />
          <Path d={`M ${W * 0.27} 38 Q ${W / 2} 22 ${W * 0.73} 38`} fill="none" stroke={OUTLINE} strokeWidth={1.5} strokeLinecap="round" />
          <Path d={`M ${W * 0.41} ${noseH - 11} L ${W * 0.59} ${noseH - 11} M ${W / 2} ${noseH - 11} L ${W / 2} ${noseH - 3}`} fill="none" stroke="#5B6472" strokeWidth={1.5} strokeLinecap="round" />
          {tops.slice(1).map((t, i) => <Path key={i} d={`M ${side} ${t - rowGap / 2} L ${W - side} ${t - rowGap / 2}`} stroke={LINE} strokeWidth={1} />)}
        </Svg>
        {rows.map((row, ri) => (
          <View key={ri} style={{ position: 'absolute', top: tops[ri], left: side, width: rowW, height: rowH(ri) }}>
            {ri !== driverRowIdx ? <View style={[st.bench, { top: seat * 0.5, height: seat * 0.5 + 9 }]} /> : null}
            <View style={{ flexDirection: 'row', gap, justifyContent: 'center' }}>
              {row.map((cell, ci) => {
                if (cell === null) return <View key={ci} style={{ width: seat, height: seat }} />;
                if (cell === 'D') {
                  return (
                    <View key={ci} accessible accessibilityLabel="Your seat, the driver" style={[st.seat, { width: seat, height: seat, backgroundColor: '#E9EDF2', borderColor: OUTLINE, borderWidth: 1 }]}>
                      <MaterialCommunityIcons name="steering" size={Math.round(seat * 0.42)} color="#5B6472" />
                      <Text style={[st.sub, { color: '#5B6472' }]}>You</Text>
                    </View>
                  );
                }
                const n = Number(cell);
                const state = states[n] || 'UNAVAILABLE';
                const m = SEAT_META[state];
                const who = labels && labels[n];
                const boys = male.has(n);
                const seatStyle = [st.seat, { width: seat, height: seat, backgroundColor: m.bg, borderColor: m.color, borderStyle: state === 'UNAVAILABLE' ? 'dashed' as const : 'solid' as const }, busySeat === n ? { opacity: 0.5 } : null];
                const inner = (
                  <>
                    <Text style={{ fontSize: Math.round(seat * 0.32), fontWeight: '800', color: m.fg, fontVariant: ['tabular-nums'] }}>{n}</Text>
                    {who ? (
                      <Text style={[st.sub, { color: m.fg }]} numberOfLines={1}>{who.slice(0, 6)}</Text>
                    ) : m.icon ? <Ionicons name={m.icon} size={13} color={m.fg} /> : <Text style={[st.sub, { color: m.fg }]}>{m.word}</Text>}
                  </>
                );
                const label = `Seat ${n}, ${placeOf(rows, ri, ci)}, ${m.label}${who ? `, ${who}` : ''}${boys ? ', boys only in the app' : ''}`;
                const tag = boys ? (
                  <View pointerEvents="none" style={[st.tag, { top: seat - 8 }]}><Text style={st.tagText}>Boys</Text></View>
                ) : null;
                return (
                  <View key={ci} style={{ width: seat, alignItems: 'center' }}>
                    {onSeatPress ? (
                      <Pressable
                        onPress={() => onSeatPress(n, state)}
                        disabled={busySeat === n}
                        accessibilityRole="button"
                        accessibilityLabel={`${label}${state === 'AVAILABLE' ? '. Tap to mark as filled' : state === 'WALK_IN' ? '. Tap to free' : ''}`}
                        style={({ pressed }) => [...seatStyle, pressed ? { transform: [{ scale: 0.96 }] } : null]}
                      >
                        {inner}
                      </Pressable>
                    ) : (
                      <View accessible accessibilityLabel={label} style={seatStyle}>{inner}</View>
                    )}
                    {tag}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
        <Text style={st.front} pointerEvents="none">FRONT</Text>
      </View>
      <View style={st.legend}>
        {LEGEND.map((k) => {
          const m = SEAT_META[k];
          return (
            <View key={k} style={st.legendItem}>
              <View style={[st.swatch, { backgroundColor: m.bg, borderColor: m.color }]}>
                {m.icon ? <Ionicons name={m.icon} size={10} color={m.fg} /> : null}
              </View>
              <Text style={st.legendText}>{m.label}</Text>
            </View>
          );
        })}
        {male.size ? (
          <View style={st.legendItem}>
            <View style={[st.swatch, { backgroundColor: '#FFFFFF', borderColor: '#1D4ED8' }]}><Text style={{ fontSize: 8, fontWeight: '800', color: '#1D4ED8' }}>B</Text></View>
            <Text style={st.legendText}>Boys only (app)</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  front: { position: 'absolute', top: 13, alignSelf: 'center', fontSize: 9, fontWeight: '800', letterSpacing: 2, color: '#5B6472' },
  seat: { borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  sub: { fontSize: 10, fontWeight: '700', marginTop: 1 },
  bench: { position: 'absolute', left: -8, right: -8, borderRadius: 10, backgroundColor: BENCH },
  tag: { position: 'absolute', backgroundColor: '#FFFFFF', borderColor: '#1D4ED8', borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  tagText: { fontSize: 9, fontWeight: '800', color: '#1D4ED8', letterSpacing: 0.3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, rowGap: 8, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  swatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});

/**
 * Seat states for the driver from GET /trips/:id/seats (AVAILABLE / HELD / BOOKED / WALK_IN / UNAVAILABLE) plus the
 * bookings list (BOARDED seats + first names).
 */
export function driverSeatStates(seats: { seatNo: number; state: SeatState }[], bookings: { seatNumbers: number[]; status: string; passengerName: string }[]) {
  const states: Record<number, DriverSeatState> = {};
  const labels: Record<number, string> = {};
  for (const s of seats) states[s.seatNo] = s.state === 'MINE' ? 'BOOKED' : s.state === 'MINE_HELD' ? 'HELD' : s.state;
  for (const b of bookings) {
    if (!['HELD', 'CONFIRMED', 'BOARDED'].includes(b.status)) continue;
    for (const n of b.seatNumbers) {
      if (b.status === 'BOARDED') states[n] = 'BOARDED';
      if (b.status !== 'HELD') labels[n] = b.passengerName;
    }
  }
  return { states, labels };
}
