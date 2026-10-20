/**
 * Top-down shared-auto seat map. The arrangement comes from the trip's seatLayout (server, set by the admin
 * at vehicle approval): rows front to back, 'D' = driver seat (drawn, never bookable), null = gap, numbers =
 * passenger seats 1..capacity. Works for any capacity / up to 6 rows x 5 places (backend limits).
 * Every state has its own colour AND icon AND words, so it never relies on colour alone.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { usePalette } from '../rentals/ui';
import type { LayoutCell, SeatState } from './autoRideApi';

export type SeatViewState = SeatState | 'SELECTED';

export const SEAT_META: Record<SeatViewState, { label: string; icon: string; color: string; fg: string }> = {
  AVAILABLE: { label: 'Available', icon: '', color: '#10B981', fg: '#065F46' },
  SELECTED: { label: 'Selected', icon: '✓', color: '#0EA5E9', fg: '#fff' },
  HELD: { label: 'Held', icon: '⏳', color: '#F59E0B', fg: '#78350F' },
  BOOKED: { label: 'Booked', icon: '✕', color: '#94A3B8', fg: '#334155' },
  UNAVAILABLE: { label: 'Unavailable', icon: '—', color: '#CBD5E1', fg: '#64748B' },
  MINE: { label: 'Your seat', icon: '★', color: '#8B5CF6', fg: '#fff' },
  MINE_HELD: { label: 'Held for you', icon: '⏳', color: '#A78BFA', fg: '#fff' },
};

const LEGEND: SeatViewState[] = ['AVAILABLE', 'SELECTED', 'HELD', 'BOOKED', 'MINE', 'UNAVAILABLE'];

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
  const pad = cols >= 5 ? 14 : 22;
  const gap = cols >= 5 ? 7 : 10;
  // Big touch targets (>= 42 px) but never wider than the screen (5 places fit on a 320 px phone).
  const seat = w ? Math.max(42, Math.min(62, Math.floor((w - pad * 2 - gap * (cols - 1)) / cols))) : 52;
  const bodyW = cols * seat + gap * (cols - 1) + pad * 2;
  const noseH = 54;
  const bodyH = noseH + rows.length * (seat + gap) + 26;
  const sel = new Set(selected);

  const stateOf = (n: number): SeatViewState => (sel.has(n) ? 'SELECTED' : (states[n] || 'UNAVAILABLE'));

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ alignItems: 'center' }}>
      <View style={{ width: bodyW, height: bodyH }} accessibilityLabel={`Seat map, ${rows.flat().filter((c) => typeof c === 'number').length} passenger seats`}>
        <Svg width={bodyW} height={bodyH} style={StyleSheet.absoluteFill}>
          <Defs>
            <SvgGradient id="body" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={p.isDark ? '#3F3A12' : '#FEF08A'} />
              <Stop offset="1" stopColor={p.isDark ? '#1E3A24' : '#BBF7D0'} />
            </SvgGradient>
          </Defs>
          {/* Body: rounded nose at the front, wider passenger cabin behind */}
          <Path
            d={`M ${bodyW * 0.3} 6 Q ${bodyW / 2} -4 ${bodyW * 0.7} 6 L ${bodyW - 8} ${noseH} Q ${bodyW - 2} ${noseH + 6} ${bodyW - 2} ${noseH + 18} L ${bodyW - 2} ${bodyH - 18} Q ${bodyW - 2} ${bodyH - 2} ${bodyW - 18} ${bodyH - 2} L 18 ${bodyH - 2} Q 2 ${bodyH - 2} 2 ${bodyH - 18} L 2 ${noseH + 18} Q 2 ${noseH + 6} 8 ${noseH} Z`}
            fill="url(#body)" stroke={p.isDark ? '#A3A3A3' : '#334155'} strokeWidth={2}
          />
          {/* Headlight + windscreen */}
          <Circle cx={bodyW / 2} cy={12} r={5} fill="#FDE047" stroke={p.isDark ? '#A3A3A3' : '#334155'} strokeWidth={1.5} />
          <Rect x={bodyW * 0.3} y={22} width={bodyW * 0.4} height={8} rx={4} fill={p.isDark ? '#38BDF8' : '#7DD3FC'} opacity={0.8} />
          {/* Rear bumper */}
          <Rect x={bodyW * 0.2} y={bodyH - 10} width={bodyW * 0.6} height={6} rx={3} fill={p.isDark ? '#525252' : '#475569'} />
        </Svg>
        <Text style={[st.front, { color: p.isDark ? '#E5E5E5' : '#334155' }]}>FRONT</Text>
        <View style={{ position: 'absolute', top: noseH, left: pad, right: pad, gap }}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap, justifyContent: 'center' }}>
              {row.map((cell, ci) => {
                if (cell === null) return <View key={ci} style={{ width: seat, height: seat }} />;
                if (cell === 'D') {
                  return (
                    <View key={ci} style={[st.seat, { width: seat, height: seat, backgroundColor: p.isDark ? '#262626' : '#E2E8F0', borderColor: p.isDark ? '#525252' : '#94A3B8' }]}
                      accessibilityLabel="Driver seat, not bookable">
                      <Text style={{ fontSize: seat * 0.36 }}>🧑‍✈️</Text>
                      <Text style={[st.seatSub, { color: p.sub }]}>DRIVER</Text>
                    </View>
                  );
                }
                const n = Number(cell);
                const state = stateOf(n);
                const m = SEAT_META[state];
                const tappable = selectable && !!onToggle && (state === 'AVAILABLE' || state === 'SELECTED');
                const solid = state === 'SELECTED' || state === 'MINE' || state === 'MINE_HELD';
                const bg = solid ? m.color : state === 'AVAILABLE' ? (p.isDark ? 'rgba(16,185,129,0.18)' : '#ECFDF5') : state === 'HELD' ? (p.isDark ? 'rgba(245,158,11,0.2)' : '#FEF3C7') : (p.isDark ? '#2A2A2E' : '#F1F5F9');
                const fg = solid ? '#fff' : p.isDark ? (state === 'AVAILABLE' ? '#6EE7B7' : state === 'HELD' ? '#FCD34D' : '#A1A1AA') : m.fg;
                return (
                  <TouchableOpacity
                    key={ci}
                    disabled={!tappable}
                    onPress={() => onToggle && onToggle(n)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityState={{ selected: state === 'SELECTED', disabled: !tappable }}
                    accessibilityLabel={`Seat ${n}, ${m.label}${tappable ? (state === 'SELECTED' ? ', double tap to unselect' : ', double tap to select') : ''}`}
                    style={[st.seat, { width: seat, height: seat, backgroundColor: bg, borderColor: m.color, borderStyle: state === 'UNAVAILABLE' ? 'dashed' : 'solid' }]}
                  >
                    <View style={[st.backrest, { backgroundColor: m.color, opacity: solid ? 0.55 : 0.8 }]} />
                    <Text style={{ fontSize: seat * 0.32, fontWeight: '900', color: fg }}>{n}</Text>
                    <Text style={[st.seatSub, { color: fg }]} numberOfLines={1}>{m.icon ? `${m.icon} ` : ''}{state === 'AVAILABLE' ? 'FREE' : state === 'MINE' ? 'YOU' : state === 'MINE_HELD' ? 'YOURS' : m.label.toUpperCase()}</Text>
                  </TouchableOpacity>
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
              <View style={[st.swatch, { backgroundColor: k === 'SELECTED' || k === 'MINE' ? m.color : `${m.color}33`, borderColor: m.color, borderStyle: k === 'UNAVAILABLE' ? 'dashed' : 'solid' }]}>
                <Text style={{ fontSize: 12, color: k === 'SELECTED' || k === 'MINE' ? '#fff' : p.text }}>{m.icon}</Text>
              </View>
              <Text style={{ fontSize: 12, color: p.sub, fontWeight: '700' }}>{m.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  front: { position: 'absolute', top: 34, alignSelf: 'center', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  seat: { borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backrest: { position: 'absolute', top: 0, left: 6, right: 6, height: 5, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  seatSub: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3, marginTop: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 16, height: 16, borderRadius: 5, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
});
