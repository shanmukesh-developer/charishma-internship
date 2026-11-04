import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Circle, Path, ClipPath } from 'react-native-svg';

// The ZCS mark (owner, 31 Oct 2026: "circles connecting, high class, luxurious"): three rings, gold / raspberry /
// amber, woven over and under each other (Community, Campus and Services, linked). Same geometry as the app icon
// (scratchpad make_rings_icon_2026_10_31.py): a 1024 canvas, rings on an equilateral triangle around the centre.
// The intro animates each ring as its own layer (so it turns about its own centre) and fades the weave in last,
// the moment the rings link.

const C = 512;
const D_CENTRE = 112;
export const RING_R = 160;
export const RING_W = 46;
const GAP = 10;
const HALF = (1.45 * RING_W) / RING_R;
const PAD = 14;
const BOX0 = 192; // the mark's square in the 1024 canvas: 192..832
export const BOX = 640;
const GAP_COLOR = '#120A0E';

export type RingKey = 'A' | 'B' | 'C';
export const RING_KEYS: RingKey[] = ['A', 'B', 'C'];
const ANGLE: Record<RingKey, number> = { A: -90, B: 30, C: 150 };
const STOPS: Record<RingKey, [string, string][]> = {
  A: [['0', '#FFE8B8'], ['0.55', '#EDBE6C'], ['1', '#C8893C']], // gold
  B: [['0', '#FF7A86'], ['0.5', '#E8364F'], ['1', '#A10F35']], // raspberry
  C: [['0', '#FFC27A'], ['0.5', '#FF8A47'], ['1', '#D9541F']], // amber
};

export const CENTRE: Record<RingKey, { x: number; y: number }> = Object.fromEntries(RING_KEYS.map((k) => {
  const a = (ANGLE[k] * Math.PI) / 180;
  return [k, { x: C + D_CENTRE * Math.cos(a), y: C + D_CENTRE * Math.sin(a) }];
})) as Record<RingKey, { x: number; y: number }>;

/** Unit vector from the mark centre to a ring centre (the direction a ring glides in from). */
export const OUTWARD: Record<RingKey, { x: number; y: number }> = Object.fromEntries(RING_KEYS.map((k) => {
  const a = (ANGLE[k] * Math.PI) / 180;
  return [k, { x: Math.cos(a), y: Math.sin(a) }];
})) as Record<RingKey, { x: number; y: number }>;

type Pt = { x: number; y: number };
const crossings = (p: RingKey, q: RingKey): { inner: Pt; outer: Pt } => {
  const a = CENTRE[p];
  const b = CENTRE[q];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const h = Math.sqrt(RING_R * RING_R - (d / 2) * (d / 2));
  const m = { x: a.x + dx / 2, y: a.y + dy / 2 };
  const u = { x: -dy / d, y: dx / d };
  const pts = [{ x: m.x + h * u.x, y: m.y + h * u.y }, { x: m.x - h * u.x, y: m.y - h * u.y }];
  pts.sort((s, t) => Math.hypot(s.x - C, s.y - C) - Math.hypot(t.x - C, t.y - C));
  return { inner: pts[0], outer: pts[1] };
};

// Borromean-style weave: at each pair's outer crossing the first ring is on top, at the inner one the second.
// Each entry: the ring on top, the crossing, the ring beneath.
const OVER: [RingKey, Pt, RingKey][] = (() => {
  const out: [RingKey, Pt, RingKey][] = [];
  for (const [p, q] of [['A', 'B'], ['B', 'C'], ['C', 'A']] as [RingKey, RingKey][]) {
    const x = crossings(p, q);
    out.push([p, x.outer, q], [q, x.inner, p]);
  }
  return out;
})();

// A ring's band (the area its stroke covers) as a fill shape, a hair wider than the stroke so the gap covers the
// ring's soft edge. The dark gap under an over-segment is clipped to the ring beneath: unclipped, its ends showed as
// dark dashes on the glow around each crossing (seen on the phone, 31 Oct 2026). Outer and inner loops run in
// opposite directions, so the hole stays open under either fill rule.
const band = (k: RingKey) => {
  const c = CENTRE[k];
  const loop = (r: number, sweep: 0 | 1) => {
    const a = `${(c.x + r).toFixed(2)} ${c.y.toFixed(2)}`;
    const b = `${(c.x - r).toFixed(2)} ${c.y.toFixed(2)}`;
    return `M ${a} A ${r} ${r} 0 1 ${sweep} ${b} A ${r} ${r} 0 1 ${sweep} ${a} Z`;
  };
  return `${loop(RING_R + RING_W / 2 + 0.75, 0)} ${loop(RING_R - RING_W / 2 - 0.75, 1)}`;
};

const arc = (k: RingKey, pt: Pt, half: number, r = RING_R) => {
  const c = CENTRE[k];
  const phi = Math.atan2(pt.y - c.y, pt.x - c.x);
  const s = { x: c.x + r * Math.cos(phi - half), y: c.y + r * Math.sin(phi - half) };
  const e = { x: c.x + r * Math.cos(phi + half), y: c.y + r * Math.sin(phi + half) };
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
};

const gradient = (id: string, k: RingKey) => {
  const c = CENTRE[k];
  return (
    <SvgGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={c.x - RING_R} y1={c.y - RING_R} x2={c.x + RING_R} y2={c.y + RING_R}>
      {STOPS[k].map(([o, col]) => <Stop key={o} offset={o} stopColor={col} />)}
    </SvgGradient>
  );
};

/** Size and top-left (in dp, inside a mark box of `size` dp) of one ring's own layer. */
export function ringLayerFrame(k: RingKey, size: number) {
  const s = size / BOX;
  const span = 2 * RING_R + RING_W + 2 * PAD;
  const c = CENTRE[k];
  return { size: span * s, left: (c.x - BOX0) * s - (span * s) / 2, top: (c.y - BOX0) * s - (span * s) / 2 };
}

/** One full ring (with its satin line), drawn in its own square so a rotation turns it about its own centre. */
export function RingLayer({ k, size, idPrefix }: { k: RingKey; size: number; idPrefix: string }) {
  const c = CENTRE[k];
  const span = 2 * RING_R + RING_W + 2 * PAD;
  const f = ringLayerFrame(k, size);
  const id = `${idPrefix}${k}`;
  return (
    <Svg width={f.size} height={f.size} viewBox={`${c.x - span / 2} ${c.y - span / 2} ${span} ${span}`}>
      <Defs>{gradient(id, k)}</Defs>
      <Circle cx={c.x} cy={c.y} r={RING_R} fill="none" stroke={`url(#${id})`} strokeWidth={RING_W} />
      <Circle cx={c.x} cy={c.y} r={RING_R - RING_W * 0.22} fill="none" stroke="#FFFFFF" strokeOpacity={0.16} strokeWidth={RING_W * 0.16} />
    </Svg>
  );
}

/** The over-segments that make the rings interlock (drawn above the three rings, same coordinates). */
export function WeaveLayer({ size, idPrefix }: { size: number; idPrefix: string }) {
  return (
    <Svg width={size} height={size} viewBox={`${BOX0} ${BOX0} ${BOX} ${BOX}`}>
      <Defs>
        {RING_KEYS.map((k) => gradient(`${idPrefix}${k}`, k))}
        {RING_KEYS.map((k) => (
          <ClipPath key={`under${k}`} id={`${idPrefix}Under${k}`}>
            <Path d={band(k)} clipRule="evenodd" />
          </ClipPath>
        ))}
      </Defs>
      {OVER.map(([k, pt, under], i) => (
        <React.Fragment key={i}>
          <Path d={arc(k, pt, HALF)} fill="none" stroke={GAP_COLOR} strokeWidth={RING_W + 2 * GAP} clipPath={`url(#${idPrefix}Under${under})`} />
          <Path d={arc(k, pt, HALF * 1.18)} fill="none" stroke={`url(#${idPrefix}${k})`} strokeWidth={RING_W} />
          <Path d={arc(k, pt, HALF * 1.18, RING_R - RING_W * 0.22)} fill="none" stroke="#FFFFFF" strokeOpacity={0.16} strokeWidth={RING_W * 0.16} />
        </React.Fragment>
      ))}
    </Svg>
  );
}

/**
 * The mark on its app-icon tile (the launcher icon's deep plum, a thin gold edge), for light or photo backgrounds
 * where the bare rings' dark weave gaps would show: the sign-in, sign-up and password screens.
 */
export function ZcsRingsTile({ size = 56, idPrefix = 'zcsTile' }: { size?: number; idPrefix?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundColor: '#1B0912',
        borderWidth: 1,
        borderColor: 'rgba(226,194,110,0.42)',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#1B0912',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.28,
        shadowRadius: 10,
        elevation: 6,
      }}
    >
      <ZcsRingsMark size={Math.round(size * 0.74)} idPrefix={idPrefix} />
    </View>
  );
}

/** The finished mark, still (reduce motion, or anywhere the logo is shown). */
export function ZcsRingsMark({ size, idPrefix = 'zcsMark' }: { size: number; idPrefix?: string }) {
  return (
    <View style={{ width: size, height: size }}>
      {RING_KEYS.map((k) => {
        const f = ringLayerFrame(k, size);
        return (
          <View key={k} style={{ position: 'absolute', left: f.left, top: f.top }}>
            <RingLayer k={k} size={size} idPrefix={`${idPrefix}R`} />
          </View>
        );
      })}
      <View style={{ position: 'absolute', left: 0, top: 0 }}>
        <WeaveLayer size={size} idPrefix={`${idPrefix}W`} />
      </View>
    </View>
  );
}
