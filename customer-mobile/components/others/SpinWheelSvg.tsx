import React, { memo } from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

/**
 * Others → Deals & spin: the prize wheel drawing (owner reference, 22 Oct).
 * Segment i is centred at i × (360 / n) degrees clockwise from the top, which is the angle the
 * spin animation in app/(tabs)/others.tsx lands on for the server's prizeIndex. Only the drawing
 * lives here; the prize table and the result always come from the server.
 */
// SVG text falls back to a serif face on web; native uses the system font.
const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : undefined;

export const WHEEL_COLORS = ['#F6B23E', '#22B07D', '#3B82F6', '#8B5CF6', '#EF5DA8', '#F2704E', '#14B8A6', '#64748B'];

/** "10 ZEN" -> ["10", "points"], "FREE DEL" -> ["Free", "delivery"], anything else as one line. */
export const wheelLabelLines = (label: string, display?: string): [string, string] => {
  const raw = String(label || display || '').trim();
  const pts = raw.match(/(\d+)\s*(zen|points?)/i) || String(display || '').match(/(\d+)\s*zen/i);
  if (pts) return [pts[1], 'points'];
  if (/free\s*del/i.test(raw) || /free\s*delivery/i.test(String(display || ''))) return ['Free', 'delivery'];
  const clean = raw.replace(/[^A-Za-z0-9\s%₹]/g, '').trim();
  const [a, ...rest] = clean.split(/\s+/);
  return [a || '', rest.join(' ').toLowerCase()];
};

type Sector = { label: string; display?: string };

function polar(c: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
}

function SpinWheelSvg({ sectors, size, showLabels = true, ring = true }: { sectors: Sector[]; size: number; showLabels?: boolean; ring?: boolean }) {
  const n = Math.max(1, sectors.length || 8);
  const list: Sector[] = sectors.length ? sectors : Array.from({ length: 8 }, () => ({ label: '' }));
  const c = size / 2;
  const ringW = ring ? Math.max(6, size * 0.045) : 0;
  const r = c - ringW;
  const deg = 360 / n;
  const big = size >= 200;
  const dots = ring ? 16 : 0;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {ring && <Circle cx={c} cy={c} r={c - 0.5} fill="#5B3FD6" />}
      {list.map((sec, i) => {
        const a0 = i * deg - deg / 2;
        const a1 = i * deg + deg / 2;
        const p0 = polar(c, r, a0);
        const p1 = polar(c, r, a1);
        const d = n === 1
          ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`
          : `M ${c} ${c} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${p1.x} ${p1.y} Z`;
        const [l1, l2] = wheelLabelLines(sec.label, sec.display);
        return (
          <G key={i}>
            <Path d={d} fill={WHEEL_COLORS[i % WHEEL_COLORS.length]} stroke="rgba(255,255,255,0.85)" strokeWidth={big ? 2 : 1} />
            {showLabels && !!l1 && (
              <G transform={`rotate(${i * deg} ${c} ${c})`}>
                <SvgText x={c} y={c - r * 0.66} fill="#FFFFFF" fontSize={big ? size * 0.068 : 10} fontWeight="700" fontFamily={FONT} textAnchor="middle">{l1}</SvgText>
                {!!l2 && <SvgText x={c} y={c - r * 0.66 + size * 0.058} fill="#FFFFFF" fontSize={big ? size * 0.042 : 8} fontWeight="600" fontFamily={FONT} textAnchor="middle">{l2}</SvgText>}
              </G>
            )}
          </G>
        );
      })}
      {Array.from({ length: dots }).map((_, i) => {
        const p = polar(c, c - ringW / 2, (360 / dots) * i);
        return <Circle key={`d${i}`} cx={p.x} cy={p.y} r={Math.max(1.5, ringW * 0.22)} fill={i % 2 ? '#FFFFFF' : '#F6C453'} />;
      })}
    </Svg>
  );
}

export default memo(SpinWheelSvg);
