/**
 * Top-down shared-auto seat map. The arrangement comes from the trip's seatLayout (server, set by the admin
 * at vehicle approval): rows front to back, 'D' = driver seat (drawn, never bookable), null = gap, numbers =
 * passenger seats 1..capacity. Works for any capacity / up to 6 rows x 5 places (backend limits).
 * Every state has its own colour AND mark AND words, so it never relies on colour alone.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PressScale } from '../others/motion';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { usePalette, AUTO_GREEN } from './ui';
import type { LayoutCell, SeatState } from './autoRideApi';

export type SeatViewState = SeatState | 'SELECTED';

export const SEAT_META: Record<SeatViewState, { label: string; icon: string; color: string; fg: string }> = {
  AVAILABLE: { label: 'Available', icon: '', color: '#2563EB', fg: '#1D4ED8' },
  SELECTED: { label: 'Selected', icon: '✓', color: '#2563EB', fg: '#fff' },
  HELD: { label: 'Held', icon: '…', color: '#D97706', fg: '#92400E' },
  BOOKED: { label: 'Booked', icon: '✕', color: '#94A3B8', fg: '#475569' },
  UNAVAILABLE: { label: 'Unavailable', icon: '—', color: '#CBD5E1', fg: '#64748B' },
  MINE: { label: 'Your seat', icon: '★', color: AUTO_GREEN, fg: '#fff' },
  MINE_HELD: { label: 'Held for you', icon: '…', color: '#22C55E', fg: '#fff' },
};

type Look = { bg: string; border: string; fg: string; mark: keyof typeof Ionicons.glyphMap | null; dashed?: boolean };

export default function SeatMap({ rows, states, selected, onToggle, selectable }: {
  rows: LayoutCell[][];
  states: Record<number, SeatState>;
  selected: number[];
  onToggle?: (seatNo: number) => void;
  selectable: boolean;
}) {
  const p = usePalette();
  const [w, setW] = useState(0);
  const cols = useMemo(() => Math.max(1, ...rows.map((r) => r.length)), [rows]);
  const pad = cols >= 5 ? 16 : 24;
  const gap = cols >= 5 ? 8 : 12;
  // Big touch targets (>= 42 px) but never wider than the screen (5 places fit on a 320 px phone).
  const seat = w ? Math.max(42, Math.min(58, Math.floor((w - pad * 2 - gap * (cols - 1) - 8) / cols))) : 52;
  const bodyW = cols * seat + gap * (cols - 1) + pad * 2;
  const noseH = 62;
  const bodyH = noseH + rows.length * (seat + gap) + 28;
  const sel = new Set(selected);

  const stateOf = (n: number): SeatViewState => (sel.has(n) ? 'SELECTED' : (states[n] || 'UNAVAILABLE'));

  const look = (state: SeatViewState): Look => {
    switch (state) {
      case 'AVAILABLE': return { bg: p.card, border: p.accent, fg: p.accent, mark: null };
      case 'SELECTED': return { bg: p.button, border: p.button, fg: '#FFFFFF', mark: 'checkmark' };
      case 'HELD': return { bg: p.warnSoft, border: p.warn, fg: p.warn, mark: 'time-outline' };
      case 'BOOKED': return { bg: p.isDark ? '#2A2A30' : '#E5E9F0', border: p.isDark ? '#3A3A42' : '#CBD3DE', fg: p.muted, mark: 'close' };
      case 'MINE': return { bg: AUTO_GREEN, border: AUTO_GREEN, fg: '#FFFFFF', mark: 'star' };
      case 'MINE_HELD': return { bg: p.successSoft, border: p.success, fg: p.success, mark: 'time-outline' };
      default: return { bg: 'transparent', border: p.border, fg: p.muted, mark: 'remove', dashed: true };
    }
  };

  const present = new Set<SeatViewState>(['AVAILABLE', 'SELECTED', 'BOOKED']);
  Object.values(states).forEach((v) => present.add(v));
  const legend = (['AVAILABLE', 'SELECTED', 'BOOKED', 'HELD', 'MINE', 'MINE_HELD', 'UNAVAILABLE'] as SeatViewState[]).filter((k) => present.has(k));

  const body = p.isDark ? '#1C1C22' : '#EEF1F6';
  const outline = p.isDark ? '#3A3A44' : '#CDD5E0';

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ alignItems: 'center' }}>
      <View style={{ width: bodyW, height: bodyH }} accessibilityLabel={`Seat map, ${rows.flat().filter((c) => typeof c === 'number').length} passenger seats, front at the top`}>
        <Svg width={bodyW} height={bodyH} style={StyleSheet.absoluteFill}>
          {/* Body seen from above: rounded nose at the front, cabin behind */}
          <Path
            d={`M ${bodyW * 0.28} 8 Q ${bodyW / 2} -2 ${bodyW * 0.72} 8 L ${bodyW - 10} ${noseH - 6} Q ${bodyW - 2} ${noseH} ${bodyW - 2} ${noseH + 14} L ${bodyW - 2} ${bodyH - 20} Q ${bodyW - 2} ${bodyH - 2} ${bodyW - 20} ${bodyH - 2} L 20 ${bodyH - 2} Q 2 ${bodyH - 2} 2 ${bodyH - 20} L 2 ${noseH + 14} Q 2 ${noseH} 10 ${noseH - 6} Z`}
            fill={body} stroke={outline} strokeWidth={1.5}
          />
          {/* Headlight, windscreen and rear bumper */}
          <Circle cx={bodyW / 2} cy={14} r={4.5} fill={p.isDark ? '#FDE68A' : '#FCD34D'} />
          <Rect x={bodyW * 0.3} y={26} width={bodyW * 0.4} height={9} rx={4.5} fill={p.isDark ? 'rgba(124,168,255,0.45)' : 'rgba(37,99,235,0.22)'} />
          <Rect x={bodyW * 0.22} y={bodyH - 10} width={bodyW * 0.56} height={5} rx={2.5} fill={outline} />
        </Svg>
        <Text style={[st.front, { color: p.muted }]}>FRONT</Text>
        <View style={{ position: 'absolute', top: noseH, left: pad, right: pad, gap }}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap, justifyContent: 'center' }}>
              {row.map((cell, ci) => {
                if (cell === null) return <View key={ci} style={{ width: seat, height: seat }} />;
                if (cell === 'D') {
                  return (
                    <View key={ci} style={[st.seat, { width: seat, height: seat, backgroundColor: p.isDark ? '#26262C' : '#DDE3EB', borderColor: outline }]}
                      accessibilityLabel="Driver seat, not bookable">
                      <MaterialCommunityIcons name="steering" size={seat * 0.42} color={p.sub} />
                      <Text style={[st.seatSub, { color: p.sub }]}>Driver</Text>
                    </View>
                  );
                }
                const n = Number(cell);
                const state = stateOf(n);
                const m = SEAT_META[state];
                const lk = look(state);
                const tappable = selectable && !!onToggle && (state === 'AVAILABLE' || state === 'SELECTED');
                return (
                  <PressScale
                    key={ci}
                    disabled={!tappable}
                    onPress={() => onToggle && onToggle(n)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: state === 'SELECTED', disabled: !tappable }}
                    accessibilityLabel={`Seat ${n}, ${m.label}${tappable ? (state === 'SELECTED' ? ', double tap to unselect' : ', double tap to select') : ''}`}
                    style={[st.seat, { width: seat, height: seat, backgroundColor: lk.bg, borderColor: lk.border, borderStyle: lk.dashed ? 'dashed' : 'solid' }]}
                  >
                    <View style={[st.backrest, { backgroundColor: lk.border, opacity: state === 'SELECTED' || state === 'MINE' ? 0.45 : 0.9 }]} />
                    <Text style={{ fontSize: seat * 0.32, fontWeight: '800', color: lk.fg }}>{n}</Text>
                    {lk.mark ? <Ionicons name={lk.mark} size={12} color={lk.fg} style={{ marginTop: -1 }} /> : null}
                  </PressScale>
                );
              })}
            </View>
          ))}
        </View>
      </View>
      <View style={st.legend}>
        {legend.map((k) => {
          const lk = look(k);
          return (
            <View key={k} style={st.legendItem}>
              <View style={[st.swatch, { backgroundColor: lk.bg, borderColor: lk.border, borderStyle: lk.dashed ? 'dashed' : 'solid' }]}>
                {lk.mark ? <Ionicons name={lk.mark} size={10} color={lk.fg} /> : null}
              </View>
              <Text style={{ fontSize: 12, color: p.sub, fontWeight: '600' }}>{SEAT_META[k].label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  front: { position: 'absolute', top: 40, alignSelf: 'center', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  seat: { borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backrest: { position: 'absolute', top: 0, left: 7, right: 7, height: 5, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  seatSub: { fontSize: 10, fontWeight: '700', marginTop: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, rowGap: 8, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
