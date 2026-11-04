/**
 * The app's REAL prize wheel, drawn premium: the same sectors, colours, order and labels as
 * components/others/SpinWheelSvg (segment i centred at i × 360/n degrees clockwise from the top, the angle the spin
 * lands on for the server's prizeIndex), with glossy per-segment gradients, an indigo rim with a row of lights, a
 * glass gloss, a hub holding the ZenWe badge and a pointer. Still: it only turns while a real spin runs.
 *   WheelDisk   the rotating part (segments + labels)
 *   PrizeWheel  the full wheel: rim + lights + disk (optionally rotated) + gloss + hub + pointer
 */
import React, { memo, useId } from 'react';
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient as SvgLinear, Path, RadialGradient, Stop, Text as SvgText, Ellipse } from 'react-native-svg';
import { Image } from 'expo-image';
import { WHEEL_COLORS, wheelLabelLines } from '../../components/others/SpinWheelSvg';
import type { Prize } from './dealsV2Data';
import { themedSheet } from '../../utils/themeNow';

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const ZCS_EMBLEM = require('../../assets/zenwe-brand-badge-2026-11-04.webp');
const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : undefined;

const polar = (c: number, r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
};
/** Lighter tint of a hex colour (for the glossy segment gradients). */
const tint = (hex: string, k: number) => {
  const h = hex.replace('#', '');
  const ch = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) + (255 - parseInt(h.slice(i, i + 2), 16)) * k);
  return `rgb(${ch(0)},${ch(2)},${ch(4)})`;
};
const useSvgId = (p: string) => `${p}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

/** Rotating part: segments + labels, drawn at `size` (the disk inside the rim). */
export const WheelDisk = memo(function WheelDisk({ prizes, size, labels = true }: { prizes: Prize[]; size: number; labels?: boolean }) {
  const id = useSvgId('dv2disk');
  const n = Math.max(1, prizes.length || 8);
  const c = size / 2;
  const r = c;
  const deg = 360 / n;
  const big = size >= 180;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        {prizes.map((_, i) => {
          const col = WHEEL_COLORS[i % WHEEL_COLORS.length];
          return (
            <RadialGradient key={i} id={`${id}s${i}`} cx={c} cy={c} r={r} gradientUnits="userSpaceOnUse">
              <Stop offset="0.15" stopColor={tint(col, 0.32)} />
              <Stop offset="0.72" stopColor={col} />
              <Stop offset="1" stopColor={col} stopOpacity={0.92} />
            </RadialGradient>
          );
        })}
      </Defs>
      {prizes.map((p, i) => {
        const a0 = i * deg - deg / 2;
        const a1 = i * deg + deg / 2;
        const p0 = polar(c, r, a0);
        const p1 = polar(c, r, a1);
        const d = n === 1 ? `M ${c} 0 A ${r} ${r} 0 1 1 ${c - 0.01} 0 Z` : `M ${c} ${c} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${p1.x} ${p1.y} Z`;
        const [l1, l2] = wheelLabelLines(p.label, p.display);
        return (
          <G key={i}>
            <Path d={d} fill={`url(#${id}s${i})`} stroke="rgba(255,255,255,0.9)" strokeWidth={big ? 2 : 1.2} />
            {labels && !!l1 && (
              <G transform={`rotate(${i * deg} ${c} ${c})`}>
                <SvgText x={c} y={c - r * 0.64} fill="#FFFFFF" fontSize={big ? size * 0.078 : Math.max(8, size * 0.085)} fontWeight="700" fontFamily={FONT} textAnchor="middle" stroke="rgba(30,10,80,0.18)" strokeWidth={0.6}>{l1}</SvgText>
                {!!l2 && <SvgText x={c} y={c - r * 0.64 + size * 0.062} fill="#FFFFFF" fillOpacity={0.94} fontSize={big ? size * 0.046 : Math.max(6, size * 0.05)} fontWeight="500" fontFamily={FONT} textAnchor="middle">{l2}</SvgText>}
              </G>
            )}
          </G>
        );
      })}
      {/* soft inner shade at the rim edge (depth) */}
      <Circle cx={c} cy={c} r={r - 1} fill="none" stroke="rgba(20,6,60,0.22)" strokeWidth={size * 0.03} />
    </Svg>
  );
});

function Lights({ size, ring, count, phase }: { size: number; ring: number; count: number; phase: 0 | 1 }) {
  const c = size / 2;
  const id = useSvgId('dv2bulb');
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.45" stopColor="#FFF4C2" />
          <Stop offset="1" stopColor="#F6C453" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {Array.from({ length: count }).filter((_, i) => i % 2 === phase).map((_, k) => {
        const i = k * 2 + phase;
        const p = polar(c, c - ring / 2, (360 / count) * i);
        const b = Math.max(2, ring * 0.26);
        return (
          <G key={i}>
            <Circle cx={p.x} cy={p.y} r={b * 2.1} fill={`url(#${id}g)`} />
            <Circle cx={p.x} cy={p.y} r={b} fill="#FFFBEA" />
          </G>
        );
      })}
    </Svg>
  );
}

/** Full premium wheel. `rotate` is an Animated degree value for the spin page; omit it for a still wheel. */
export function PrizeWheel({ prizes, size, rotate, labels = true, style }: {
  prizes: Prize[]; size: number; rotate?: Animated.Value; labels?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const id = useSvgId('dv2rim');
  const c = size / 2;
  const ring = Math.max(8, size * 0.085);
  const disk = size - ring * 2;
  const hub = 2 * Math.round(Math.max(22, size * 0.2) / 2); // even whole pixels: the badge stays centred on the hub cap
  const bulbs = size >= 160 ? 20 : 14;
  const spin = rotate ? { transform: [{ rotate: rotate.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) }] } : null;
  return (
    <View style={[{ width: size, height: size }, style]} accessibilityLabel="Prize wheel">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgLinear id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#8F7BF5" />
            <Stop offset="0.45" stopColor="#4B32C8" />
            <Stop offset="1" stopColor="#241278" />
          </SvgLinear>
          <SvgLinear id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFE9A6" />
            <Stop offset="0.5" stopColor="#F6C453" />
            <Stop offset="1" stopColor="#C98A12" />
          </SvgLinear>
        </Defs>
        <Circle cx={c} cy={c} r={c - 0.5} fill={`url(#${id}r)`} />
        <Circle cx={c} cy={c} r={c - 1.2} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
        <Circle cx={c} cy={c} r={c - ring + 1} fill="none" stroke={`url(#${id}g)`} strokeWidth={Math.max(2, size * 0.014)} />
      </Svg>
      <View style={StyleSheet.absoluteFill} pointerEvents="none"><Lights size={size} ring={ring} count={bulbs} phase={0} /></View>
      <View style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} pointerEvents="none"><Lights size={size} ring={ring} count={bulbs} phase={1} /></View>
      <Animated.View style={[{ position: 'absolute', left: ring, top: ring, width: disk, height: disk }, spin]}>
        <WheelDisk prizes={prizes} size={disk} labels={labels} />
      </Animated.View>
      {/* glass gloss over the disk (static, so the light stays put while the wheel turns) */}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <SvgLinear id={`${id}gl`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.36} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </SvgLinear>
          <RadialGradient id={`${id}hub`} cx="40%" cy="35%" r="70%">
            <Stop offset="0" stopColor="#FFF3C4" />
            <Stop offset="0.55" stopColor="#F6C453" />
            <Stop offset="1" stopColor="#B57A0E" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={c} cy={ring + disk * 0.3} rx={disk * 0.42} ry={disk * 0.26} fill={`url(#${id}gl)`} />
        <Circle cx={c} cy={c} r={hub / 2 + Math.max(3, size * 0.018)} fill={`url(#${id}hub)`} />
        <Circle cx={c} cy={c} r={hub / 2 + Math.max(3, size * 0.018)} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1} />
        {/* pointer: gold drop at the top, pointing into the wheel */}
        <Path d={`M ${c - size * 0.055} ${size * 0.012} L ${c + size * 0.055} ${size * 0.012} L ${c} ${ring + size * 0.07} Z`} fill={`url(#${id}g)`} stroke="#FFFFFF" strokeWidth={Math.max(1, size * 0.006)} strokeLinejoin="round" />
        <Circle cx={c} cy={size * 0.03} r={Math.max(2, size * 0.014)} fill="#FFFFFF" />
      </Svg>
      <View pointerEvents="none" style={[st.hub, { width: hub, height: hub, borderRadius: hub / 2, left: c - hub / 2, top: c - hub / 2 }]}>
        <Image source={ZCS_EMBLEM} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityLabel="ZenWe logo" />
      </View>
    </View>
  );
}

const st = themedSheet(() => ({
  hub: { position: 'absolute', overflow: 'hidden', backgroundColor: '#FAE04B', borderWidth: 1, borderColor: 'rgba(255,240,200,0.9)' },
}));
