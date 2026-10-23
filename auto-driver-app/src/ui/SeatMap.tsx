/**
 * Read-only top-down auto seat map for the driver. Copied from customer-mobile/modules/autoRide/SeatMap.tsx
 * (same drawing, so driver and passengers see the same layout) and adapted: no selection, light theme only,
 * an extra BOARDED state, and an optional first-name label per seat from the bookings list.
 * The arrangement is the trip's seatLayout (server, set by the admin at vehicle approval): rows front to
 * back, 'D' = driver seat, null = gap, numbers = passenger seats 1..capacity (up to 6 rows x 5 places).
 * Every state has its own colour AND icon AND word, so it never relies on colour alone.
 * Union queue: WALK_IN = a seat the driver marked as filled by someone without the app. With onSeatPress the
 * seats become buttons (tap a free seat to fill it, a walk-in seat to free it).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Rect, Stop } from 'react-native-svg';
import type { LayoutCell, SeatState } from '../types';

export type DriverSeatState = Exclude<SeatState, 'MINE' | 'MINE_HELD'> | 'BOARDED';

export const SEAT_META: Record<DriverSeatState, { label: string; word: string; icon: string; color: string; fg: string; bg: string }> = {
  AVAILABLE: { label: 'Free', word: 'FREE', icon: '', color: '#10B981', fg: '#065F46', bg: '#ECFDF5' },
  HELD: { label: 'Held (not paid yet)', word: 'HELD', icon: '⏳', color: '#F59E0B', fg: '#78350F', bg: '#FEF3C7' },
  BOOKED: { label: 'Booked', word: 'BOOKED', icon: '✓', color: '#475569', fg: '#FFFFFF', bg: '#64748B' },
  BOARDED: { label: 'Boarded', word: 'IN', icon: '★', color: '#7C3AED', fg: '#FFFFFF', bg: '#7C3AED' },
  WALK_IN: { label: 'Walk-in', word: 'Walk-in', icon: '●', color: '#0F766E', fg: '#FFFFFF', bg: '#0F766E' },
  UNAVAILABLE: { label: 'Closed', word: 'CLOSED', icon: '—', color: '#CBD5E1', fg: '#64748B', bg: '#F1F5F9' },
};
const LEGEND: DriverSeatState[] = ['AVAILABLE', 'HELD', 'BOOKED', 'BOARDED', 'WALK_IN', 'UNAVAILABLE'];

export default function SeatMap({ rows, states, labels, onSeatPress, busySeat }: {
  rows: LayoutCell[][];
  states: Record<number, DriverSeatState>;
  /** seat -> passenger first name (bookings list) */
  labels?: Record<number, string>;
  /** Makes every passenger seat a button (walk-in editing). */
  onSeatPress?: (seatNo: number, state: DriverSeatState) => void;
  /** Seat whose change is being sent (dimmed). */
  busySeat?: number | null;
}) {
  const [w, setW] = useState(0);
  const cols = useMemo(() => Math.max(1, ...rows.map((r) => r.length)), [rows]);
  const pad = cols >= 5 ? 14 : 22;
  const gap = cols >= 5 ? 7 : 10;
  const seat = w ? Math.max(48, Math.min(72, Math.floor((w - pad * 2 - gap * (cols - 1)) / cols))) : 56;
  const bodyW = cols * seat + gap * (cols - 1) + pad * 2;
  const noseH = 54;
  const bodyH = noseH + rows.length * (seat + gap) + 26;
  const count = rows.flat().filter((c) => typeof c === 'number').length;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ alignItems: 'center' }}>
      <View style={{ width: bodyW, height: bodyH }} accessibilityLabel={`Seat map, ${count} passenger seats`}>
        <Svg width={bodyW} height={bodyH} style={StyleSheet.absoluteFill}>
          <Defs>
            <SvgGradient id="body" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FEF08A" />
              <Stop offset="1" stopColor="#BBF7D0" />
            </SvgGradient>
          </Defs>
          <Path
            d={`M ${bodyW * 0.3} 6 Q ${bodyW / 2} -4 ${bodyW * 0.7} 6 L ${bodyW - 8} ${noseH} Q ${bodyW - 2} ${noseH + 6} ${bodyW - 2} ${noseH + 18} L ${bodyW - 2} ${bodyH - 18} Q ${bodyW - 2} ${bodyH - 2} ${bodyW - 18} ${bodyH - 2} L 18 ${bodyH - 2} Q 2 ${bodyH - 2} 2 ${bodyH - 18} L 2 ${noseH + 18} Q 2 ${noseH + 6} 8 ${noseH} Z`}
            fill="url(#body)" stroke="#334155" strokeWidth={2}
          />
          <Circle cx={bodyW / 2} cy={12} r={5} fill="#FDE047" stroke="#334155" strokeWidth={1.5} />
          <Rect x={bodyW * 0.3} y={22} width={bodyW * 0.4} height={8} rx={4} fill="#7DD3FC" opacity={0.8} />
          <Rect x={bodyW * 0.2} y={bodyH - 10} width={bodyW * 0.6} height={6} rx={3} fill="#475569" />
        </Svg>
        <Text style={st.front}>FRONT</Text>
        <View style={{ position: 'absolute', top: noseH, left: pad, right: pad, gap }}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap, justifyContent: 'center' }}>
              {row.map((cell, ci) => {
                if (cell === null) return <View key={ci} style={{ width: seat, height: seat }} />;
                if (cell === 'D') {
                  return (
                    <View key={ci} style={[st.seat, { width: seat, height: seat, backgroundColor: '#E2E8F0', borderColor: '#94A3B8' }]} accessibilityLabel="Your seat (driver)">
                      <Text style={{ fontSize: seat * 0.34 }}>🧑‍✈️</Text>
                      <Text style={[st.seatSub, { color: '#334155' }]}>YOU</Text>
                    </View>
                  );
                }
                const n = Number(cell);
                const state = states[n] || 'UNAVAILABLE';
                const m = SEAT_META[state];
                const who = labels && labels[n];
                const seatStyle = [st.seat, { width: seat, height: seat, backgroundColor: m.bg, borderColor: m.color, borderStyle: state === 'UNAVAILABLE' ? 'dashed' as const : 'solid' as const }, busySeat === n ? { opacity: 0.5 } : null];
                const inner = (
                  <>
                    <View style={[st.backrest, { backgroundColor: m.color }]} />
                    <Text style={{ fontSize: seat * 0.32, fontWeight: '900', color: m.fg }}>{n}</Text>
                    <Text style={[st.seatSub, { color: m.fg }]} numberOfLines={1}>{who ? who.slice(0, 8) : `${m.icon ? `${m.icon} ` : ''}${m.word}`}</Text>
                  </>
                );
                if (onSeatPress) {
                  return (
                    <Pressable
                      key={ci}
                      onPress={() => onSeatPress(n, state)}
                      disabled={busySeat === n}
                      accessibilityRole="button"
                      accessibilityLabel={`Seat ${n}, ${m.label}${who ? `, ${who}` : ''}${state === 'AVAILABLE' ? '. Tap to mark as filled' : state === 'WALK_IN' ? '. Tap to free' : ''}`}
                      style={({ pressed }) => [...seatStyle, pressed ? { transform: [{ scale: 0.96 }] } : null]}
                    >
                      {inner}
                    </Pressable>
                  );
                }
                return (
                  <View key={ci} accessibilityLabel={`Seat ${n}, ${m.label}${who ? `, ${who}` : ''}`} style={seatStyle}>
                    {inner}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>
      <View style={st.legend}>
        {LEGEND.map((k) => {
          const m = SEAT_META[k];
          return (
            <View key={k} style={st.legendItem}>
              <View style={[st.swatch, { backgroundColor: m.bg, borderColor: m.color, borderStyle: k === 'UNAVAILABLE' ? 'dashed' : 'solid' }]}>
                <Text style={{ fontSize: 9, color: m.fg }}>{m.icon}</Text>
              </View>
              <Text style={{ fontSize: 13, color: '#374151', fontWeight: '700' }}>{m.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  front: { position: 'absolute', top: 34, alignSelf: 'center', fontSize: 9, fontWeight: '900', letterSpacing: 2, color: '#334155' },
  seat: { borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backrest: { position: 'absolute', top: 0, left: 6, right: 6, height: 5, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  seatSub: { fontSize: 9, fontWeight: '900', letterSpacing: 0.3, marginTop: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
});

/**
 * Seat states for the driver from GET /trips/:id/seats (AVAILABLE / HELD / BOOKED / UNAVAILABLE) plus the
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
