// Home's floating basket button artwork. Owner reference (28 Oct 2026): flat one-colour woven fruit baskets
// (rounded handle, rim band, basket-weave body, fruit peeking over the rim, a base band). Original vector in that
// style: solid `color` shapes with the weave and the fruit outlines cut in the button colour (`bg`).
// Geometry is laid out on a 48 grid and centred (arch peak 9.8 to base 41.4, lifted 1.6), the weave is
// computed from the body's slanted sides so every strand sits inside them with an even margin.
import React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

// Basket body: a trapezoid from y 24 (x 9.5 -> 38.5) to y 37.6 (x 12.6 -> 35.4) with rounded bottom corners.
const TOP = 24;
const BOTTOM = 37.6;
const xLeft = (y: number) => 9.5 + ((y - TOP) * 3.1) / (BOTTOM - TOP);
const xRight = (y: number) => 38.5 - ((y - TOP) * 3.1) / (BOTTOM - TOP);
const BODY = `M9.5 ${TOP} H38.5 L35.9 ${BOTTOM - 1.4} Q35.5 ${BOTTOM} 34 ${BOTTOM} H14 Q12.5 ${BOTTOM} 12.1 ${BOTTOM - 1.4} Z`;

/** Three woven bands; in each, upright strands every 4.2 units, offset half a step from the band above (brick). */
function weave(bg: string) {
  const out: React.ReactNode[] = [];
  const bandH = (BOTTOM - TOP) / 3;
  for (let b = 0; b < 3; b++) {
    const y0 = TOP + b * bandH;
    const y1 = y0 + bandH;
    if (b > 0) out.push(<Path key={`sep${b}`} d={`M${xLeft(y0) + 0.6} ${y0} H${xRight(y0) - 0.6}`} stroke={bg} strokeWidth={1.1} strokeLinecap="round" />);
    const yMid = (y0 + y1) / 2;
    const from = xLeft(y1) + 2.6;
    const to = xRight(y1) - 2.6;
    const step = 4.2;
    const count = Math.floor((to - from) / step);
    const start = (from + to) / 2 - (count * step) / 2 + (b % 2 ? step / 2 : 0);
    for (let i = 0; i <= count; i++) {
      const x = start + i * step;
      if (x < from - 0.01 || x > to + 0.01) continue;
      out.push(<Path key={`s${b}-${i}`} d={`M${x} ${yMid - bandH / 2 + 1.2} V${yMid + bandH / 2 - 1.2}`} stroke={bg} strokeWidth={1.1} strokeLinecap="round" />);
    }
  }
  return out;
}

export default function BasketFabIcon({ size = 30, color = '#FFFFFF', bg = '#EF4444' }: { size?: number; color?: string; bg?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {/* drawn on the 48 grid, lifted 1.6 so the shape (arch peak 9.8 to base 41.4) is centred on 24 */}
      <G transform="translate(0 -1.6)">
      {/* handle: a full arch, drawn first so the fruit sits in front of its lower half only */}
      <Path d="M13.6 20.5 C13.6 6.2, 34.4 6.2, 34.4 20.5" fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />

      {/* fruit over the rim, inside the arch: apple with stem and leaf, a round fruit */}
      <G>
        <Circle cx={20.2} cy={17.4} r={4.1} fill={color} stroke={bg} strokeWidth={1.2} />
        <Path d="M20.2 13.4 C20.1 12.5, 20.4 11.8, 21 11.3" stroke={color} strokeWidth={1.2} strokeLinecap="round" fill="none" />
        <Path d="M21.1 12.4 C22.3 11, 24 11.1, 24.6 11.8 C23.6 13, 22.2 13.1, 21.1 12.4 Z" fill={color} />
        <Circle cx={27.9} cy={17.8} r={3.7} fill={color} stroke={bg} strokeWidth={1.2} />
      </G>

      {/* rim band */}
      <Rect x={7.8} y={19.6} width={32.4} height={4.4} rx={2.2} fill={color} />

      {/* woven body: solid, with the weave cut in the button colour */}
      <Path d={BODY} fill={color} />
      <G>{weave(bg)}</G>

      {/* base band */}
      <Rect x={15.2} y={39.2} width={17.6} height={2.2} rx={1.1} fill={color} />
      </G>
    </Svg>
  );
}
