/**
 * ZCS Auto seat map: the shared auto-rickshaw seen from above, front at the top.
 * The arrangement comes from the trip's seatLayout (server): rows front to back, 'D' = driver (drawn with a
 * steering wheel, never bookable), null = gap, numbers = passenger seats. The real ZCS auto is
 *     1  driver  2      (front bench, beside the driver: boys only)
 *     3    4     5      (bench)
 *     6    7     8      (bench)
 * but any admin layout (up to 6 rows x 5 places) is drawn the same way: a rounded body with a narrower nose, a
 * windshield arc and handlebar, the driver's bench, then a bench strip under every passenger row.
 * Front-seat rule: seats in maleOnlySeats carry a "Boys" tag. For a viewer who is not a boy (viewer NOT_MALE) a
 * free boys-only seat is dimmed with a lock and a press explains why (onLockedPress, or an alert). UNKNOWN viewers
 * ('Prefer not to say') can tap it; the screen asks "Are you booking for a boy?" first. The server enforces it.
 * Every state has its own icon AND colour AND words in the label, so it never relies on colour alone.
 * Reused as-is by the Co-Ride v2 auto screens (prototypes/coride-v2) when they integrate.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { PressScale } from '../others/motion';
import { usePalette, AUTO_GREEN } from './ui';
import type { LayoutCell, RiderGender, SeatState, SeatViewer } from './autoRideApi';

export type SeatViewState = SeatState | 'SELECTED' | 'LOCKED';

export const SEAT_META: Record<SeatViewState, { label: string; word: string }> = {
  AVAILABLE: { label: 'Available', word: 'available' },
  SELECTED: { label: 'Selected', word: 'selected by you' },
  HELD: { label: 'Held', word: 'being booked by someone' },
  BOOKED: { label: 'Booked', word: 'booked' },
  UNAVAILABLE: { label: 'Unavailable', word: 'not available' },
  MINE: { label: 'Your seat', word: 'your seat' },
  MINE_HELD: { label: 'Held for you', word: 'held for you' },
  LOCKED: { label: 'Boys only', word: 'boys only, not available for you' },
};

export const FRONT_SEAT_NOTE = 'Seats beside the driver are for boys only. Please pick a seat in the back rows.';

/**
 * Profile gender 'Prefer not to say': asked when they first try a front seat or a quick booking. The answer goes
 * with the hold (riderGender) for that booking only; it is never saved to the profile. null = cancelled.
 */
export const askRiderGender = (): Promise<RiderGender | null> => new Promise((resolve) => {
  let done = false;
  const end = (v: RiderGender | null) => { if (!done) { done = true; resolve(v); } };
  Alert.alert('Are you booking for a boy?', 'Front seats beside the driver are for boys only.', [
    { text: 'Cancel', style: 'cancel', onPress: () => end(null) },
    { text: 'No, a girl', onPress: () => end('Female') },
    { text: 'Yes, a boy', onPress: () => end('Male') },
  ], { cancelable: true, onDismiss: () => end(null) });
});

type Ion = keyof typeof Ionicons.glyphMap;
type Look = { bg: string; border: string; fg: string; mark: Ion | null; dashed?: boolean; dim?: boolean };

/** Seats on the driver's bench (the default boys-only seats when the layout does not list them). */
const besideDriver = (rows: LayoutCell[][]) => {
  const r = rows.find((row) => row.includes('D'));
  return r ? r.filter((c): c is number => typeof c === 'number') : [];
};

const POS: Record<number, string[]> = {
  1: ['centre'], 2: ['left', 'right'], 3: ['left', 'centre', 'right'],
  4: ['left', 'centre left', 'centre right', 'right'], 5: ['left', 'centre left', 'centre', 'centre right', 'right'],
};

/** "front row left, beside the driver" / "back row centre" / "last row right" for screen readers. */
const placeOf = (rows: LayoutCell[][], ri: number, ci: number) => {
  const row = rows[ri];
  const places = row.map((c, i) => ({ c, i })).filter((x) => x.c !== null);
  const k = places.findIndex((x) => x.i === ci);
  const pos = (POS[places.length] || [])[k] || `place ${k + 1}`;
  if (row.includes('D')) return `front row ${pos}, beside the driver`;
  const rear = rows.map((r, i) => ({ r, i })).filter((x) => !x.r.includes('D'));
  const j = rear.findIndex((x) => x.i === ri);
  const name = rear.length === 1 || j === 0 ? 'back row' : j === rear.length - 1 ? 'last row' : `row ${ri + 1}`;
  return `${name} ${pos}`;
};

export default function SeatMap({ rows, states, selected, onToggle, selectable, maleOnlySeats, viewer = 'UNKNOWN', onLockedPress, showLegend = true }: {
  rows: LayoutCell[][];
  states: Record<number, SeatState>;
  selected: number[];
  onToggle?: (seatNo: number) => void;
  selectable: boolean;
  /** Boys-only seats (server layout.maleOnlySeats); default: the seats beside the driver. */
  maleOnlySeats?: number[];
  /** Who is looking (server seatMap.viewer). */
  viewer?: SeatViewer;
  /** A press on a boys-only seat this viewer cannot book (default: an alert with the reason). */
  onLockedPress?: (seatNo: number) => void;
  showLegend?: boolean;
}) {
  const p = usePalette();
  const [w, setW] = useState(0);
  const male = useMemo(() => new Set(maleOnlySeats ?? besideDriver(rows)), [maleOnlySeats, rows]);
  const cols = useMemo(() => Math.max(1, ...rows.map((r) => r.length)), [rows]);
  const sel = new Set(selected);

  // Geometry: seats 44..52 px, centred, never wider than the card (360..430 px phones).
  const avail = Math.min(w || 340, 400);
  const gap = cols >= 4 ? 8 : 12;
  const side = cols >= 5 ? 16 : 24;
  const seat = Math.max(44, Math.min(52, Math.floor((avail - side * 2 - gap * (cols - 1)) / cols)));
  const rowW = cols * seat + gap * (cols - 1);
  const bodyW = rowW + side * 2;
  const noseH = 62;
  const driverRowIdx = rows.findIndex((r) => r.includes('D'));
  const rowH = (ri: number) => (ri === driverRowIdx ? seat + 16 : seat + 14);
  const rowGap = 14;
  const tops: number[] = [];
  let y = noseH;
  rows.forEach((_, ri) => { tops.push(y); y += rowH(ri) + (ri < rows.length - 1 ? rowGap : 0); });
  const bodyH = y + 22;

  const body = p.isDark ? '#19191E' : '#F3F5F8';
  const outline = p.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.16)';
  const bench = p.isDark ? '#25252C' : '#E3E8EF';
  const line = p.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.09)';

  const stateOf = (n: number): SeatViewState => {
    if (sel.has(n)) return 'SELECTED';
    const s = states[n] || 'UNAVAILABLE';
    if (s === 'AVAILABLE' && viewer === 'NOT_MALE' && male.has(n)) return 'LOCKED';
    return s;
  };

  const look = (state: SeatViewState): Look => {
    switch (state) {
      case 'AVAILABLE': return { bg: p.card, border: p.accent, fg: p.accent, mark: null };
      case 'SELECTED': return { bg: p.button, border: p.button, fg: '#FFFFFF', mark: 'checkmark' };
      case 'HELD': return { bg: p.warnSoft, border: p.warn, fg: p.warn, mark: 'time-outline' };
      case 'BOOKED': return { bg: p.isDark ? '#2A2A31' : '#E4E8EE', border: p.isDark ? '#3A3A43' : '#C9D1DC', fg: p.muted, mark: 'person' };
      case 'MINE': return { bg: AUTO_GREEN, border: AUTO_GREEN, fg: '#FFFFFF', mark: 'star' };
      case 'MINE_HELD': return { bg: p.successSoft, border: p.success, fg: p.success, mark: 'time-outline' };
      case 'LOCKED': return { bg: p.card, border: p.muted, fg: p.muted, mark: 'lock-closed-outline', dashed: true, dim: true };
      default: return { bg: 'transparent', border: outline, fg: p.muted, mark: 'remove', dashed: true };
    }
  };

  const explain = (n: number) => {
    if (onLockedPress) onLockedPress(n);
    else Alert.alert(`Seat ${n} is for boys only`, FRONT_SEAT_NOTE);
  };

  const present = new Set<SeatViewState>();
  rows.flat().forEach((c) => { if (typeof c === 'number') present.add(stateOf(c)); });
  const legendKeys: SeatViewState[] = ['AVAILABLE', ...(selectable ? ['SELECTED' as SeatViewState] : []), 'MINE', 'BOOKED'];
  if (present.has('HELD')) legendKeys.push('HELD');
  if (present.has('MINE_HELD')) legendKeys.push('MINE_HELD');

  const W = bodyW;
  const H = bodyH;
  // Narrow rounded nose, shoulders out to the driver's bench, sides flaring slightly to the wider back.
  const outlinePath = `M ${W * 0.3} 5 Q ${W / 2} -3 ${W * 0.7} 5 C ${W * 0.86} 11 ${W - 9} ${noseH * 0.5} ${W - 9} ${noseH - 2} L ${W - 2} ${H - 24} Q ${W - 2} ${H - 2} ${W - 24} ${H - 2} L 24 ${H - 2} Q 2 ${H - 2} 2 ${H - 24} L 9 ${noseH - 2} C 9 ${noseH * 0.5} ${W * 0.14} 11 ${W * 0.3} 5 Z`;
  const total = rows.flat().filter((c) => typeof c === 'number').length;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ alignItems: 'center' }}>
      <View style={{ width: W, height: H }} accessibilityLabel={`Auto seat map, ${total} passenger seats, front at the top${male.size ? `. Seats ${[...male].join(' and ')} beside the driver are for boys only` : ''}`}>
        <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
          <Path d={outlinePath} fill={body} stroke={outline} strokeWidth={StyleSheet.hairlineWidth * 2} />
          {/* Windshield arc and handlebar */}
          <Path d={`M ${W * 0.27} 38 Q ${W / 2} 22 ${W * 0.73} 38`} fill="none" stroke={outline} strokeWidth={1.5} strokeLinecap="round" />
          <Path d={`M ${W * 0.41} ${noseH - 11} L ${W * 0.59} ${noseH - 11} M ${W / 2} ${noseH - 11} L ${W / 2} ${noseH - 3}`} fill="none" stroke={p.muted} strokeWidth={1.5} strokeLinecap="round" />
          {/* Dividers between the benches */}
          {tops.slice(1).map((t, i) => (
            <Path key={i} d={`M ${side} ${t - rowGap / 2} L ${W - side} ${t - rowGap / 2}`} stroke={line} strokeWidth={1} />
          ))}
        </Svg>
        {rows.map((row, ri) => {
          const isDriverRow = ri === driverRowIdx;
          return (
            <View key={ri} style={{ position: 'absolute', top: tops[ri], left: side, width: rowW, height: rowH(ri) }}>
              {!isDriverRow ? <View style={[st.bench, { top: seat * 0.5, height: seat * 0.5 + 9, backgroundColor: bench }]} /> : null}
              <View style={{ flexDirection: 'row', gap, justifyContent: 'center' }}>
                {row.map((cell, ci) => {
                  if (cell === null) return <View key={ci} style={{ width: seat, height: seat }} />;
                  if (cell === 'D') {
                    return (
                      <View key={ci} accessible accessibilityLabel="Driver, not bookable"
                        style={[st.seat, { width: seat, height: seat, backgroundColor: p.isDark ? '#23232A' : '#E9EDF2', borderColor: outline, borderWidth: 1 }]}>
                        <MaterialCommunityIcons name="steering" size={Math.round(seat * 0.42)} color={p.muted} />
                        <Text style={[st.sub, { color: p.muted }]}>Driver</Text>
                      </View>
                    );
                  }
                  const n = Number(cell);
                  const state = stateOf(n);
                  const lk = look(state);
                  const boys = male.has(n);
                  const locked = state === 'LOCKED';
                  const tappable = selectable && !!onToggle && (state === 'AVAILABLE' || state === 'SELECTED');
                  const label = `Seat ${n}, ${placeOf(rows, ri, ci)}, ${SEAT_META[state].word}${boys && !locked ? ', boys only' : ''}`;
                  return (
                    <View key={ci} style={{ width: seat, alignItems: 'center' }}>
                      <PressScale
                        disabled={!tappable && !locked}
                        onPress={() => (locked ? explain(n) : onToggle && onToggle(n))}
                        accessibilityRole="button"
                        accessibilityState={{ selected: state === 'SELECTED', disabled: !tappable }}
                        accessibilityLabel={label}
                        accessibilityHint={locked ? FRONT_SEAT_NOTE : tappable ? (state === 'SELECTED' ? 'Double tap to unselect' : 'Double tap to select') : undefined}
                        style={[st.seat, { width: seat, height: seat, backgroundColor: lk.bg, borderColor: lk.border, borderStyle: lk.dashed ? 'dashed' : 'solid', opacity: lk.dim ? 0.55 : 1 }]}
                      >
                        <Text style={{ fontSize: Math.round(seat * 0.34), fontWeight: '700', color: lk.fg, fontVariant: ['tabular-nums'] }}>{n}</Text>
                        {lk.mark ? <Ionicons name={lk.mark} size={12} color={lk.fg} style={{ marginTop: -1 }} /> : null}
                      </PressScale>
                      {boys ? (
                        <View style={[st.tag, { top: seat - 8, backgroundColor: p.card, borderColor: locked ? outline : p.accent }]} pointerEvents="none">
                          <Text style={[st.tagText, { color: locked ? p.muted : p.accent }]}>Boys</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
        <Text style={[st.front, { color: p.muted }]} pointerEvents="none">FRONT</Text>
      </View>
      {showLegend ? (
        <View style={st.legend}>
          {legendKeys.map((k) => {
            const lk = look(k);
            return (
              <View key={k} style={st.legendItem}>
                <View style={[st.swatch, { backgroundColor: lk.bg, borderColor: lk.border, borderStyle: lk.dashed ? 'dashed' : 'solid' }]}>
                  {lk.mark ? <Ionicons name={lk.mark} size={10} color={lk.fg} /> : null}
                </View>
                <Text style={[st.legendText, { color: p.sub }]}>{SEAT_META[k].label}</Text>
              </View>
            );
          })}
          {male.size ? (
            <View style={st.legendItem}>
              <View style={[st.swatch, { backgroundColor: p.card, borderColor: p.muted, borderStyle: 'dashed', opacity: viewer === 'NOT_MALE' ? 0.6 : 1 }]}>
                <Ionicons name="lock-closed-outline" size={10} color={p.muted} />
              </View>
              <Text style={[st.legendText, { color: p.sub }]}>Boys only</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  front: { position: 'absolute', top: 13, alignSelf: 'center', fontSize: 9, fontWeight: '700', letterSpacing: 2 },
  seat: { borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  sub: { fontSize: 10, fontWeight: '600', marginTop: 1 },
  bench: { position: 'absolute', left: -8, right: -8, borderRadius: 10 },
  tag: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  tagText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, rowGap: 8, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 12, fontWeight: '600' },
  swatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
