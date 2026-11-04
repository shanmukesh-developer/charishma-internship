/**
 * FunnyPromoArt — "Zippy's Campus Day" illustrations for the Home hero carousel.
 *
 * Every scene is drawn (react-native-svg + Views), never photographed, and is driven by
 * two Animated.Values only:
 *   e — entrance clock, 0→1 once when the slide becomes active
 *   t — idle clock, 0→1 looped natively (useNativeDriver) while the slide is active
 * Every moving part is a keyframed interpolation of those clocks (transform / opacity only),
 * so a scene costs zero JS per frame, stops completely when inactive/unmounted, and
 * renders a static "final frame" for neighbours and for reduce-motion users.
 *
 * Motion is baked into the keyframes with real physics curves: damped springs (damping
 * ratio + natural frequency), anticipation before big moves, squash & stretch with volume
 * preservation, gravity arcs, decaying wobbles, sine-eased idle breathing and irregular
 * (hand-placed, deterministic) blinks. Lighting uses radial gradients, rim light,
 * speculars and soft contact shadows that scale with height. Detached background /
 * foreground elements get a little scroll parallax through ZippySquashContext.p.
 */
import React, { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TextStyle, View, ViewStyle, StyleProp } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient as SvgGrad,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { Image } from 'expo-image';
import { optimizeImageUri } from '../SafeImage';
import SymbolIcon from '../../components/SymbolIcon';

// ─────────────────────────────────────────────────────────────────────────────
// Shared types & keyframe helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface SceneProps {
  /** Only the settled slide is active; inactive scenes show their static final frame. */
  active: boolean;
  /** Card width in px (scenes lay themselves out against it). */
  size?: number;
  reduceMotion?: boolean;
  /** Featured-restaurant polaroid only: the admin-uploaded image. */
  imageUrl?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnimNode = any;
type P = [number, number];
type EaseFn = (x: number) => number;

export const CARD_H = 196;

const TAU = Math.PI * 2;
const lin: EaseFn = (x) => x;
const outCubic: EaseFn = (x) => 1 - Math.pow(1 - x, 3);
const outQuad: EaseFn = (x) => 1 - (1 - x) * (1 - x);
const inQuad: EaseFn = (x) => x * x;
const inCubic: EaseFn = (x) => x * x * x;
const inOut: EaseFn = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * Under-damped spring step response (mass-normalised): `zeta` is the damping ratio,
 * `w` the natural frequency across the segment. Settles at exactly 1.
 */
const spring = (zeta = 0.42, w = 13): EaseFn => {
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return (x) => (x >= 1 ? 1 : 1 - Math.exp(-zeta * w * x) * (Math.cos(wd * x) + ((zeta * w) / wd) * Math.sin(wd * x)));
};
const springy = spring(0.42, 13);
const soft = spring(0.7, 10); // barely overshoots — heavy things
const jelly = spring(0.32, 16); // wobbly things

/** Sampled easing segment from (t0,a) to (t1,b). */
function seg(t0: number, t1: number, a: number, b: number, fn: EaseFn = lin, steps?: number): P[] {
  const st = steps ?? (fn === lin ? 1 : 10);
  const out: P[] = [];
  for (let i = 0; i <= st; i++) {
    const x = i / st;
    out.push([t0 + (t1 - t0) * x, a + (b - a) * fn(x)]);
  }
  return out;
}

/** Sine wave between t0..t1 (integer `cycles` → seamless when t0=0, t1=L). */
function waveSeg(t0: number, t1: number, base: number, amp: number, cycles: number, phase = 0, perCycle = 12): P[] {
  const n = Math.max(2, Math.round(cycles * perCycle));
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    out.push([t0 + (t1 - t0) * x, base + amp * Math.sin(TAU * (cycles * x + phase))]);
  }
  return out;
}
const wave = (L: number, base: number, amp: number, cycles: number, phase = 0) => waveSeg(0, L, base, amp, cycles, phase);

/** Decaying oscillation (impact shake / growl) that starts and ends at `base`. */
function wobble(t0: number, t1: number, amp: number, cycles: number, base = 0): P[] {
  const n = Math.max(8, Math.round(cycles * 8));
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    out.push([t0 + (t1 - t0) * x, base + amp * Math.exp(-2.6 * x) * (1 - x) * Math.sin(TAU * cycles * x)]);
  }
  return out;
}

/** Natural blinks (fast close, tiny hold, slower open); `double` entries blink twice. */
function blinks(L: number, at: number[], double: number[] = [], closed = 0.08): P[] {
  const out: P[] = [[0, 1]];
  const one = (ms: number) => out.push([ms, 1], [ms + 55, closed], [ms + 90, closed], [ms + 185, 1]);
  at.forEach((ms) => {
    one(ms);
    if (double.includes(ms)) one(ms + 240);
  });
  out.push([L, 1]);
  return out;
}

/** One-shot bursts of `fn(u)` (u 0→1 over `dur`) starting at each of `starts`; `rest` otherwise. */
function bursts(starts: number[], dur: number, fn: (u: number) => number, rest: number, n = 10): P[] {
  const out: P[] = [[0, rest]];
  starts.forEach((s0) => {
    if (s0 > 0) out.push([s0 - 1, rest]);
    for (let i = 0; i <= n; i++) out.push([s0 + (dur * i) / n, fn(i / n)]);
    out.push([s0 + dur + 1, rest]);
  });
  return out;
}

/** Periodic `fn(u)` with its own period/offset inside a loop of length L (clean wrap points). */
function cyc(L: number, period: number, offset: number, fn: (u: number) => number, n = 10): P[] {
  const pts: { ms: number; wrap: boolean }[] = [];
  for (let k = 0; (k * period) / n <= L + 0.001; k++) pts.push({ ms: Math.min(L, (k * period) / n), wrap: false });
  for (let w = ((offset % period) + period) % period; w <= L + 0.001; w += period) pts.push({ ms: w, wrap: true });
  pts.sort((a, b) => a.ms - b.ms || (a.wrap ? 1 : -1));
  const ph = (ms: number) => ((((ms - offset) % period) + period) % period) / period;
  const out: P[] = [];
  pts.forEach(({ ms, wrap }) => {
    if (wrap) {
      if (ms > 0) out.push([ms - 0.5, fn(1)]);
      out.push([ms, fn(0)]);
    } else if (!pts.some((q) => q.wrap && Math.abs(q.ms - ms) < 1)) {
      out.push([ms, fn(ph(ms))]);
    }
  });
  return out;
}

function normalise(pts: P[]): P[] {
  const p = pts.length > 1 ? pts.map((q) => [q[0], q[1]] as P) : [pts[0], [pts[0][0] + 1, pts[0][1]] as P];
  // Strictly increasing input keeps every native interpolation driver happy.
  for (let i = 1; i < p.length; i++) if (p[i][0] <= p[i - 1][0]) p[i][0] = p[i - 1][0] + 0.01;
  return p;
}

/** Keyframes in milliseconds → interpolation of a 0..1 clock that spans `dur` ms. */
function kf(v: Animated.Value, dur: number, pts: P[]): AnimNode {
  const p = normalise(pts);
  return v.interpolate({ inputRange: p.map((q) => q[0] / dur), outputRange: p.map((q) => q[1]), extrapolate: 'clamp' });
}

function kfDeg(v: Animated.Value, dur: number, pts: P[]): AnimNode {
  const p = normalise(pts);
  return v.interpolate({
    inputRange: p.map((q) => q[0] / dur),
    outputRange: p.map((q) => `${q[1]}deg`),
    extrapolate: 'clamp',
  });
}

/** Volume-preserving partner for a scaleY value (squash → wider, stretch → thinner). */
const volXv = (s: number) => (s < 1 ? 1 + (1 - s) * 0.84 : 1 - (s - 1) * 0.44);
const volX = (n: AnimNode): AnimNode => n.interpolate({ inputRange: [0.5, 1, 1.5], outputRange: [1.42, 1, 0.78], extrapolate: 'clamp' });

/** Squash/rotate from the feet, like a real body standing on something. */
const FEET: ViewStyle = { transformOrigin: '50% 100%' };

/**
 * Entrance once, then a native idle loop — only while active and motion is allowed.
 * Cleanup stops everything, so nothing keeps running off-screen or after unmount.
 */
function useSceneClock(active: boolean, reduceMotion: boolean, loopMs: number, restMs: number, entranceMs: number) {
  const t = useRef(new Animated.Value(restMs / loopMs)).current;
  const e = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || reduceMotion) {
      t.stopAnimation();
      e.stopAnimation();
      t.setValue(restMs / loopMs);
      e.setValue(1);
      return;
    }
    t.setValue(0);
    e.setValue(0);
    // Clocks are linear on purpose: all easing is baked into the keyframes.
    const anim = Animated.sequence([
      Animated.timing(e, { toValue: 1, duration: entranceMs, easing: Easing.linear, useNativeDriver: true }),
      Animated.loop(Animated.timing(t, { toValue: 1, duration: loopMs, easing: Easing.linear, useNativeDriver: true })),
    ]);
    anim.start();
    return () => {
      anim.stop();
      t.stopAnimation();
      e.stopAnimation();
    };
  }, [active, reduceMotion, loopMs, restMs, entranceMs, t, e]);
  return { t, e };
}

const A = <T extends ViewStyle | TextStyle>(o: T): T & { position: 'absolute' } => ({ position: 'absolute', ...o });

function shade(hex: string, amt: number) {
  const x = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  const target = amt >= 0 ? 255 : 0;
  const k = Math.abs(amt);
  return `#${c.map((v) => Math.round(v + (target - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Scales corner art down on narrow cards (320–360px phones) while keeping it anchored to the
 * card's bottom-right corner, so it never crowds the text column.
 */
function CornerArt({ width, children }: { width: number; children: React.ReactNode }) {
  const k = Math.max(0.8, Math.min(1, width / 330));
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        k < 1 && { transform: [{ translateX: (width / 2) * (1 - k) }, { translateY: (CARD_H / 2) * (1 - k) }, { scale: k }] },
      ]}
    >
      {children}
    </View>
  );
}

/** Soft ambient-occlusion contact shadow (radial falloff). */
function ContactShadow({ w, h = 6, at, scale, opacity, strength = 0.5 }: { w: number; h?: number; at: ViewStyle; scale?: AnimNode; opacity?: AnimNode; strength?: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        A({ width: w, height: h, ...at }),
        opacity !== undefined ? { opacity } : null,
        scale !== undefined ? { transform: [{ scaleX: scale }, { scaleY: scale }] } : null,
      ]}
    >
      <Svg width={w} height={h} viewBox="0 0 10 10" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={`zv-ao-${Math.round(strength * 100)}`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#000000" stopOpacity={strength} />
            <Stop offset="0.55" stopColor="#000000" stopOpacity={strength * 0.45} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={5} cy={5} rx={5} ry={5} fill={`url(#zv-ao-${Math.round(strength * 100)})`} />
      </Svg>
    </Animated.View>
  );
}

/** Soft glow halo (for lamps, LEDs, lit windows). */
function Glow({ w, h, color, at, opacity, strength = 0.6 }: { w: number; h: number; color: string; at: ViewStyle; opacity?: AnimNode; strength?: number }) {
  const id = `zv-glow-${color.replace('#', '')}`;
  return (
    <Animated.View pointerEvents="none" style={[A({ width: w, height: h, ...at }), opacity !== undefined ? { opacity } : null]}>
      <Svg width={w} height={h} viewBox="0 0 10 10" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={color} stopOpacity={strength} />
            <Stop offset="0.45" stopColor={color} stopOpacity={strength * 0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={5} cy={5} rx={5} ry={5} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIPPY — the Zenvy mascot (saffron gumdrop). Appears in every scene.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The carousel feeds scroll-driven squash (scaleX/scaleY) here so Zippy stretches while dragged,
 * plus `p` (-1..1, the card's scroll position) for depth parallax.
 */
export const ZippySquashContext = createContext<{ sx?: AnimNode; sy?: AnimNode; p?: AnimNode }>({});

/** Parallax layer: k > 0 moves more than the art (foreground), k < 0 less (background). */
function Depth({ k, children }: { k: number; children: React.ReactNode }) {
  const { p } = useContext(ZippySquashContext);
  const tx = useMemo(
    () => (p !== undefined ? p.interpolate({ inputRange: [-1, 1], outputRange: [k, -k], extrapolate: 'clamp' }) : undefined),
    [p, k],
  );
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, tx !== undefined ? { transform: [{ translateX: tx }] } : null]}>
      {children}
    </Animated.View>
  );
}

type EyeAlt = 'happy' | 'flat' | 'star' | 'huge' | 'closed';

const PALETTES = {
  saffron: ['#FFB547', '#F97316'],
  mint: ['#A7F3D0', '#10B981'],
  cyan: ['#A5F3FC', '#0891B2'],
} as const;

const EYE = '#1A1205';
const BODY_PATH =
  'M20 5 C29.5 5 35.5 13.5 35.5 23 C35.5 30.5 29.5 34.5 20 34.5 C10.5 34.5 4.5 30.5 4.5 23 C4.5 13.5 10.5 5 20 5 Z';

function starPath(cx: number, cy: number, r: number) {
  const q = r * 0.3;
  return `M${cx} ${cy - r} L${cx + q} ${cy - q} L${cx + r} ${cy} L${cx + q} ${cy + q} L${cx} ${cy + r} L${cx - q} ${cy + q} L${cx - r} ${cy} L${cx - q} ${cy - q} Z`;
}

function EyeArt({ alt }: { alt: EyeAlt }) {
  const stroke = { stroke: EYE, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (alt) {
    case 'happy':
      return (
        <>
          <Path d="M13 22.5 L15.5 19.2 L18 22.5" {...stroke} />
          <Path d="M22 22.5 L24.5 19.2 L27 22.5" {...stroke} />
        </>
      );
    case 'flat':
      return <Path d="M12.8 21.5 H18.2 M21.8 21.5 H27.2" {...stroke} />;
    case 'closed':
      return <Path d="M13 20.5 Q15.5 23.2 18 20.5 M22 20.5 Q24.5 23.2 27 20.5" {...stroke} />;
    case 'star':
      return (
        <>
          <Path d={starPath(15.5, 21, 4)} fill="#FFF8EE" stroke={EYE} strokeWidth={0.9} />
          <Path d={starPath(24.5, 21, 4)} fill="#FFF8EE" stroke={EYE} strokeWidth={0.9} />
          <Circle cx={14.4} cy={19.9} r={0.8} fill="#FFFFFF" />
          <Circle cx={23.4} cy={19.9} r={0.8} fill="#FFFFFF" />
        </>
      );
    case 'huge':
    default:
      return (
        <>
          <Circle cx={15.2} cy={20.5} r={4.2} fill="#FFFFFF" stroke={EYE} strokeWidth={0.9} />
          <Circle cx={24.8} cy={20.5} r={4.2} fill="#FFFFFF" stroke={EYE} strokeWidth={0.9} />
          <Circle cx={15.6} cy={21} r={1.8} fill={EYE} />
          <Circle cx={24.4} cy={21} r={1.8} fill={EYE} />
          <Circle cx={15} cy={20.3} r={0.6} fill="#FFFFFF" />
          <Circle cx={23.8} cy={20.3} r={0.6} fill="#FFFFFF" />
        </>
      );
  }
}

interface ZippyProps {
  size?: number;
  palette?: keyof typeof PALETTES;
  /** scaleY of the dot eyes (blink / flinch). */
  blink?: AnimNode;
  /** opacity of the default dot eyes (crossfade against overlays). */
  eyesOpacity?: AnimNode;
  overlays?: { alt: EyeAlt; opacity: AnimNode }[];
  glasses?: AnimNode;
  helmet?: string;
  /** Idle breathing: a scaleY around 1 (scaleX is derived, volume-preserving). */
  breath?: AnimNode;
  /** Built-in contact shadow (turn off when the scene draws a height-aware one). */
  shadow?: boolean;
  /** Follow the carousel's drag squash (default true). */
  squash?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Zippy({
  size = 36,
  palette = 'saffron',
  blink,
  eyesOpacity,
  overlays,
  glasses,
  helmet,
  breath,
  shadow = true,
  squash = true,
  style,
  children,
}: ZippyProps) {
  const ctx = useContext(ZippySquashContext);
  const s = size / 40;
  const [c1, c2] = PALETTES[palette];
  const gid = `zv-body-${palette}`;
  const hid = helmet ? `zv-helm-${helmet.replace('#', '')}` : '';
  const box = { position: 'absolute' as const, left: 0, top: 0, width: size, height: size };
  const breathX = useMemo(() => (breath !== undefined ? volX(breath) : undefined), [breath]);

  const body = (
    <View style={{ width: size, height: size }}>
      {shadow ? (
        <Svg width={size} height={size} viewBox="0 0 40 40" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="zv-foot" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#000000" stopOpacity={0.5} />
              <Stop offset="0.6" stopColor="#000000" stopOpacity={0.2} />
              <Stop offset="1" stopColor="#000000" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={20} cy={35.6} rx={14} ry={3.2} fill="url(#zv-foot)" />
        </Svg>
      ) : null}
      <Animated.View
        style={[box, breath !== undefined ? { transformOrigin: '50% 88%', transform: [{ scaleX: breathX }, { scaleY: breath }] } : null]}
      >
        <Svg width={size} height={size} viewBox="0 0 40 40">
          <Defs>
            <RadialGradient id={gid} cx="0.38" cy="0.3" r="0.78" fx="0.33" fy="0.22">
              <Stop offset="0" stopColor={shade(c1, 0.4)} />
              <Stop offset="0.45" stopColor={c1} />
              <Stop offset="1" stopColor={c2} />
            </RadialGradient>
            <SvgGrad id={`${gid}-ao`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.55" stopColor="#000000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000000" stopOpacity={0.26} />
            </SvgGrad>
            <RadialGradient id={`${gid}-blush`} cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#FF4D6D" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#FF4D6D" stopOpacity={0} />
            </RadialGradient>
            {helmet ? (
              <RadialGradient id={hid} cx="0.35" cy="0.25" r="0.9">
                <Stop offset="0" stopColor={shade(helmet, 0.4)} />
                <Stop offset="0.5" stopColor={helmet} />
                <Stop offset="1" stopColor={shade(helmet, -0.35)} />
              </RadialGradient>
            ) : null}
          </Defs>
          <Path d={BODY_PATH} fill={`url(#${gid})`} />
          <Path d={BODY_PATH} fill={`url(#${gid}-ao)`} />
          {/* bounce light from the floor + rim light */}
          <Path d="M9.5 31 Q20 35.6 30.5 31" stroke="#FFFFFF" strokeOpacity={0.16} strokeWidth={1.3} fill="none" strokeLinecap="round" />
          <Path d="M29.6 9.8 C33.6 13.4 35.6 18.4 35.2 24" stroke="#FFF6E0" strokeOpacity={0.5} strokeWidth={1.1} fill="none" strokeLinecap="round" />
          <Ellipse cx={13.5} cy={12.8} rx={4.8} ry={2.5} fill="#FFFFFF" opacity={0.3} transform="rotate(-32 13.5 12.8)" />
          <Circle cx={11.7} cy={11} r={1.1} fill="#FFFFFF" opacity={0.85} />
          <Ellipse cx={10.6} cy={26.6} rx={3.2} ry={2.2} fill={`url(#${gid}-blush)`} />
          <Ellipse cx={29.4} cy={26.6} rx={3.2} ry={2.2} fill={`url(#${gid}-blush)`} />
          {helmet ? (
            <>
              <Path d="M6.5 17.5 C6.5 5.5 33.5 5.5 33.5 17.5 Z" fill={`url(#${hid})`} />
              <Path d="M9 15 C9.6 9.6 14.5 7.2 19 7" stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={1.1} fill="none" strokeLinecap="round" />
              <Rect x={5} y={16.2} width={30} height={2.6} rx={1.3} fill="#0B0B12" opacity={0.6} />
              <Rect x={7} y={16.6} width={11} height={0.8} rx={0.4} fill="#FFFFFF" opacity={0.3} />
            </>
          ) : null}
        </Svg>
        <Animated.View style={[box, eyesOpacity !== undefined ? { opacity: eyesOpacity } : null]}>
          {[15.5, 24.5].map((cx) => (
            <Animated.View
              key={cx}
              style={{
                position: 'absolute',
                left: (cx - 2) * s,
                top: 18 * s,
                width: 4 * s,
                height: 6 * s,
                borderRadius: 2 * s,
                backgroundColor: EYE,
                transform: blink !== undefined ? [{ scaleY: blink }] : [],
              }}
            >
              <View style={{ position: 'absolute', left: 0.7 * s, top: 0.8 * s, width: 1.4 * s, height: 1.4 * s, borderRadius: s, backgroundColor: '#FFFFFF', opacity: 0.9 }} />
              <View style={{ position: 'absolute', left: 2.3 * s, top: 3.6 * s, width: 0.8 * s, height: 0.8 * s, borderRadius: s, backgroundColor: '#FFFFFF', opacity: 0.45 }} />
            </Animated.View>
          ))}
        </Animated.View>
        {overlays?.map((o) => (
          <Animated.View key={o.alt} style={[box, { opacity: o.opacity }]}>
            <Svg width={size} height={size} viewBox="0 0 40 40">
              <EyeArt alt={o.alt} />
            </Svg>
          </Animated.View>
        ))}
        {glasses !== undefined ? (
          <Animated.View style={[box, { opacity: glasses }]}>
            <Svg width={size} height={size} viewBox="0 0 40 40">
              <Circle cx={15.3} cy={21} r={4.4} fill="rgba(255,255,255,0.18)" stroke={EYE} strokeWidth={1.2} />
              <Circle cx={24.7} cy={21} r={4.4} fill="rgba(255,255,255,0.18)" stroke={EYE} strokeWidth={1.2} />
              <Path d="M12.6 19.4 L14.4 17.8 M22 19.4 L23.8 17.8" stroke="#FFFFFF" strokeOpacity={0.7} strokeWidth={0.8} strokeLinecap="round" />
              <Path d="M19.6 20.4 Q20 19.6 20.4 20.4" stroke={EYE} strokeWidth={1.2} fill="none" />
            </Svg>
          </Animated.View>
        ) : null}
        {children}
      </Animated.View>
    </View>
  );

  if (squash && ctx.sx !== undefined && ctx.sy !== undefined) {
    return <Animated.View style={[style, { transform: [{ scaleX: ctx.sx }, { scaleY: ctx.sy }] }]}>{body}</Animated.View>;
  }
  return <View style={style}>{body}</View>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. FOOD — "The Hungry Stomach"
// ─────────────────────────────────────────────────────────────────────────────

function SteamWisp() {
  return (
    <Svg width={10} height={22} viewBox="0 0 10 22">
      <Path d="M5 21 C1.5 17.5 8.5 13.5 5 9.5 C2.5 6.5 7 3.5 5.5 1" stroke="#FFFFFF" strokeWidth={1.7} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export const FoodArt = memo(function FoodArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const L = 3400;
  const E = 700;
  const { t, e } = useSceneClock(active, reduceMotion, L, 1600, E);

  const v = useMemo(() => {
    const ring = (d: number, amp: number): { s: P[]; o: P[] } => ({
      s: [[0, 0.6], ...seg(d, d + 620, 0.6, 1.5, outCubic, 6), [2300 + d - 1, 1.5], [2300 + d, 0.6], ...seg(2300 + d, 2800 + d, 0.6, 1.3, outCubic, 5)],
      o: [[0, 0], [d, 0], [d + 40, amp], ...seg(d + 40, d + 620, amp, 0, outQuad, 5), [2300 + d, 0], [2340 + d, amp * 0.6], ...seg(2340 + d, 2800 + d, amp * 0.6, 0, outQuad, 4)],
    });
    const r1 = ring(0, 0.75);
    const r2 = ring(150, 0.6);
    const zSY: P[] = [[0, 1], [150, 1], ...seg(150, 330, 1, 1.1, inQuad, 3), [340, 1], ...seg(340, 385, 1, 0.7, outQuad, 2), ...seg(385, 660, 0.7, 1, jelly, 12)];
    return {
      stomachY: kf(e, E, seg(0, 500, 44, 0, spring(0.5, 12), 14)),
      stomachSY: kf(e, E, seg(0, 520, 0.82, 1, jelly, 14)),
      stomachBreath: kf(t, L, wave(L, 1, 0.016, 2, 0.25)),
      growl: kfDeg(t, L, [...wobble(0, 560, 6, 3.5), ...wobble(2300, 2700, 3, 2.5), [L, 0]]),
      bounce: kf(t, L, [[0, 0], [1200, 0], ...seg(1200, 1290, 0, 1.6, inOut, 3), ...seg(1290, 1420, 1.6, -7, outQuad, 5), ...seg(1420, 1540, -7, 0, inQuad, 5), ...seg(1540, 1620, 0, 1.2, outQuad, 3), ...seg(1620, 1820, 1.2, 0, springy, 8), [L, 0]]),
      ring1S: kf(t, L, r1.s),
      ring1O: kf(t, L, r1.o),
      ring2S: kf(t, L, r2.s),
      ring2O: kf(t, L, r2.o),
      mouthFlat: kf(t, L, [[0, 1], ...seg(900, 1060, 1, 0, inOut, 3), [3200, 0], ...seg(3200, 3360, 0, 1, inOut, 3)]),
      mouthGrin: kf(t, L, [[0, 0], ...seg(900, 1060, 0, 1, inOut, 3), [3200, 1], ...seg(3200, 3360, 1, 0, inOut, 3)]),
      zEnterY: kf(e, E, [[0, -34], [150, -34], ...seg(150, 340, -34, 0, inQuad, 6)]),
      zEnterO: kf(e, E, [[0, 0], [150, 0], [210, 1]]),
      zSX: kf(e, E, zSY.map(([ms, s]) => [ms, volXv(s)] as P)),
      zSY: kf(e, E, zSY),
      zShadow: kf(e, E, [[0, 0.3], [150, 0.3], ...seg(150, 340, 0.3, 1, inQuad, 5), [385, 1.15], ...seg(385, 640, 1.15, 1, outQuad, 3)]),
      zLean: kfDeg(t, L, [[0, 0], [560, 0], ...seg(560, 640, 0, 3, inOut, 3), ...seg(640, 840, 3, -10, spring(0.55, 13), 10), [1250, -10], ...seg(1250, 1500, -10, 0, inOut, 5), [L, 0]]),
      zBlink: kf(t, L, [[0, 1], [380, 1], [435, 0.08], [465, 0.08], [560, 1], [640, 1], [720, 0.35], [840, 0.35], [920, 1], [L, 1]]),
      zBreath: kf(t, L, wave(L, 1, 0.028, 2)),
      zEyes: kf(t, L, [[0, 1], ...seg(1000, 1100, 1, 0, inOut, 3), [3200, 0], ...seg(3200, 3330, 0, 1, inOut, 3)]),
      zHappy: kf(t, L, [[0, 0], ...seg(1000, 1100, 0, 1, inOut, 3), [3200, 1], ...seg(3200, 3330, 1, 0, inOut, 3)]),
      bowlO: kf(e, E, [[0, 0], ...seg(350, 520, 0, 1, inOut, 3)]),
      bowlS: kf(e, E, [[0, 0.6], ...seg(350, 620, 0.6, 1, spring(0.45, 14), 10)]),
      bowlTip: kfDeg(t, L, [[0, 0], [880, 0], ...seg(880, 980, 0, -7, inOut, 3), ...seg(980, 1260, -7, 35, spring(0.5, 12), 12), [3150, 35], ...seg(3150, 3380, 35, 0, inOut, 5), [L, 0]]),
      steamGate: kf(t, L, [[0, 1], [860, 1], ...seg(860, 1000, 1, 0, outQuad, 3), [3250, 0], ...seg(3250, 3400, 0, 1, inOut, 3)]),
      steam: [0, 1, 2].map((i) => {
        const off = i * 567;
        return {
          y: kf(t, L, cyc(L, 1700, off, (u) => -26 * outQuad(u))),
          x: kf(t, L, cyc(L, 1700, off, (u) => 2.6 * Math.sin(TAU * (1.1 * u + i * 0.3)) * u)),
          sx: kf(t, L, cyc(L, 1700, off, (u) => 0.8 + 0.9 * u)),
          o: kf(t, L, cyc(L, 1700, off, (u) => 0.5 * Math.pow(Math.sin(Math.PI * u), 1.6))),
        };
      }),
    };
  }, [t, e]);

  return (
    <CornerArt width={size}>
      {/* growl rings (background layer) */}
      <Depth k={-8}>
        {[
          [v.ring1S, v.ring1O],
          [v.ring2S, v.ring2O],
        ].map(([sc, op], i) => (
          <Animated.View
            key={i}
            style={[A({ right: 70, top: 140, width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#FB7185' }), { opacity: op, transform: [{ scale: sc }] }]}
          />
        ))}
      </Depth>

      {/* stomach (bleeds off bottom-right) */}
      <Animated.View
        style={[
          A({ right: -30, bottom: -34, width: 150, height: 130 }),
          { transform: [{ translateY: v.stomachY }, { translateY: v.bounce }, { scaleY: v.stomachSY }, { scaleY: v.stomachBreath }, { rotate: v.growl }] },
        ]}
      >
        <Svg width={150} height={130} viewBox="0 0 150 130">
          <Defs>
            <RadialGradient id="food-stomach" cx="0.4" cy="0.3" r="0.75" fx="0.36" fy="0.2">
              <Stop offset="0" stopColor="#FDA4AF" />
              <Stop offset="0.45" stopColor="#FB7185" />
              <Stop offset="1" stopColor="#BE123C" />
            </RadialGradient>
            <SvgGrad id="food-stomach-ao" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.5" stopColor="#4C0519" stopOpacity={0} />
              <Stop offset="1" stopColor="#4C0519" stopOpacity={0.45} />
            </SvgGrad>
          </Defs>
          <Path
            d="M24 34 C30 10 72 2 104 10 C136 18 150 52 142 84 C134 116 100 130 70 124 C46 119 40 100 46 86 C50 76 40 70 28 64 C16 58 20 44 24 34 Z"
            fill="url(#food-stomach)"
          />
          <Path
            d="M24 34 C30 10 72 2 104 10 C136 18 150 52 142 84 C134 116 100 130 70 124 C46 119 40 100 46 86 C50 76 40 70 28 64 C16 58 20 44 24 34 Z"
            fill="url(#food-stomach-ao)"
          />
          {/* soft fold + rim light + gloss */}
          <Path d="M48 88 C58 96 74 98 88 94" stroke="#9F1239" strokeOpacity={0.35} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M112 14 C132 24 144 48 140 74" stroke="#FFE4E6" strokeOpacity={0.45} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Ellipse cx={62} cy={19} rx={25} ry={6} fill="#FFFFFF" opacity={0.32} transform="rotate(-8 62 19)" />
          <Ellipse cx={46} cy={22} rx={3.2} ry={2} fill="#FFFFFF" opacity={0.75} transform="rotate(-8 46 22)" />
          <Circle cx={56} cy={38} r={5} fill="#3B0A16" />
          <Circle cx={80} cy={35} r={5} fill="#3B0A16" />
          <Circle cx={54.5} cy={36.4} r={1.6} fill="#FFFFFF" />
          <Circle cx={78.5} cy={33.4} r={1.6} fill="#FFFFFF" />
          <Circle cx={57.4} cy={39.6} r={0.8} fill="#FFFFFF" opacity={0.5} />
          <Circle cx={81.4} cy={36.6} r={0.8} fill="#FFFFFF" opacity={0.5} />
        </Svg>
        <Animated.View style={[A({ left: 0, top: 0, width: 150, height: 130 }), { opacity: v.mouthFlat }]}>
          <Svg width={150} height={130} viewBox="0 0 150 130">
            <Path d="M56 57 Q70 62 86 55" stroke="#3B0A16" strokeWidth={3} strokeLinecap="round" fill="none" />
          </Svg>
        </Animated.View>
        <Animated.View style={[A({ left: 0, top: 0, width: 150, height: 130 }), { opacity: v.mouthGrin }]}>
          <Svg width={150} height={130} viewBox="0 0 150 130">
            <Path d="M52 51 Q70 80 90 49 Q71 59 52 51 Z" fill="#7F1D1D" stroke="#3B0A16" strokeWidth={2} strokeLinejoin="round" />
            <Ellipse cx={71} cy={63} rx={7} ry={3.5} fill="#FDA4AF" />
            <Path d="M56 52.5 Q71 57 86 51" stroke="#FFFFFF" strokeOpacity={0.8} strokeWidth={1.6} fill="none" strokeLinecap="round" />
          </Svg>
        </Animated.View>
      </Animated.View>

      {/* everything resting on the stomach rides its hop */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateY: v.bounce }] }]}>
        {/* bowl contact shadow */}
        <ContactShadow w={34} h={6} at={{ right: 45, top: 102 }} opacity={v.bowlO} strength={0.55} />

        {/* steam (rises straight up, hides while the bowl is tipped) */}
        <Animated.View style={[A({ right: 44, top: 54, width: 36, height: 30 }), { opacity: v.steamGate }]}>
          {v.steam.map((w: { y: AnimNode; x: AnimNode; sx: AnimNode; o: AnimNode }, i: number) => (
            <Animated.View
              key={i}
              style={[A({ left: 6 + i * 8, top: 6, width: 10, height: 22 }), { opacity: w.o, transform: [{ translateX: w.x }, { translateY: w.y }, { scaleX: w.sx }] }]}
            >
              <SteamWisp />
            </Animated.View>
          ))}
        </Animated.View>

        {/* bowl of curry */}
        <Animated.View style={[A({ right: 44, top: 80, width: 36, height: 26 }), { opacity: v.bowlO, transform: [{ scale: v.bowlS }, { rotate: v.bowlTip }] }]}>
          <Svg width={36} height={26} viewBox="0 0 36 26">
            <Defs>
              <SvgGrad id="food-bowl" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFFFFF" />
                <Stop offset="0.55" stopColor="#E2E8F0" />
                <Stop offset="1" stopColor="#94A3B8" />
              </SvgGrad>
              <RadialGradient id="food-curry" cx="0.45" cy="0.4" r="0.6">
                <Stop offset="0" stopColor="#FDBA74" />
                <Stop offset="0.55" stopColor="#EA580C" />
                <Stop offset="1" stopColor="#9A3412" />
              </RadialGradient>
            </Defs>
            <Rect x={13} y={23.4} width={10} height={2} rx={1} fill="#94A3B8" />
            <Path d="M2 9 Q2 25 18 25 Q34 25 34 9 Z" fill="url(#food-bowl)" />
            <Path d="M5 12 Q6.5 20 13 22.5" stroke="#FFFFFF" strokeOpacity={0.85} strokeWidth={1.4} fill="none" strokeLinecap="round" />
            <Path d="M31 12 Q30 18.5 25 21.5" stroke="#64748B" strokeOpacity={0.35} strokeWidth={1.2} fill="none" strokeLinecap="round" />
            <Ellipse cx={18} cy={9} rx={16} ry={4.2} fill="#F8FAFC" />
            <Ellipse cx={18} cy={9.4} rx={14} ry={3.2} fill="url(#food-curry)" />
            <Ellipse cx={12.5} cy={8.2} rx={5} ry={2.2} fill="#FFFBEB" />
            <Ellipse cx={11.5} cy={7.6} rx={2.4} ry={0.8} fill="#FFFFFF" />
            <Circle cx={22} cy={8.6} r={0.9} fill="#16A34A" />
            <Circle cx={25.5} cy={9.8} r={0.7} fill="#15803D" />
            <Ellipse cx={21.5} cy={10.4} rx={2.4} ry={0.6} fill="#FFFFFF" opacity={0.45} />
          </Svg>
        </Animated.View>

        {/* Zippy's height-aware shadow on the stomach */}
        <ContactShadow w={30} h={6} at={{ right: 16, top: 103 }} scale={v.zShadow} opacity={v.zEnterO} />

        {/* Zippy perched on the stomach */}
        <Animated.View
          style={[
            A({ right: 12, top: 70 }),
            FEET,
            { opacity: v.zEnterO, transform: [{ translateY: v.zEnterY }, { scaleX: v.zSX }, { scaleY: v.zSY }, { rotate: v.zLean }] },
          ]}
        >
          <Zippy size={38} shadow={false} breath={v.zBreath} blink={v.zBlink} eyesOpacity={v.zEyes} overlays={[{ alt: 'happy', opacity: v.zHappy }]} />
        </Animated.View>
      </Animated.View>
    </CornerArt>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TRACKING — "The Route Band"
// ─────────────────────────────────────────────────────────────────────────────

export const TrackingArt = memo(function TrackingArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const W = size;
  const L = 4200;
  const E = 600;
  const { t, e } = useSceneClock(active, reduceMotion, L, 3000, E);
  const bandTop = 146;
  const x0 = 34;
  const x1 = W - 42;
  const T = x1 - x0;
  const yAt = (s: number) => 30 - 48 * s * (1 - s);
  const DOT_S = [0, 0.25, 0.5, 0.75, 1];
  const DOT_MS = [0, 643, 1000, 1357, 2000];

  const v = useMemo(() => {
    // Pull away gently, cruise, brake with a touch of overshoot at the gate.
    const prog: P[] = [];
    for (let ms = 0; ms <= 2000; ms += 80) prog.push([ms, 1.012 * (0.5 - 0.5 * Math.cos(Math.PI * (ms / 2000)))]);
    prog.push(...seg(2000, 2350, 1.012, 1, spring(0.5, 12), 8).slice(1));
    // Road vibration: two incommensurate frequencies, fading out as the scooter stops.
    const bob: P[] = [];
    for (let ms = 0; ms <= 2000; ms += 30) {
      const env = ms < 1750 ? 1 : Math.max(0, 1 - (ms - 1750) / 250);
      bob.push([ms, env * (1.1 * Math.sin((TAU * ms) / 170) + 0.5 * Math.sin((TAU * ms) / 93 + 1))]);
    }
    bob.push([L, 0]);
    const noteY: P[] = [[0, -24], [2150, -24], ...seg(2150, 2550, -24, 0, spring(0.5, 12), 12), [3600, 0], ...seg(3600, 3900, 0, -10, inQuad, 4)];
    const noteYN = kf(t, L, noteY);
    const dots = DOT_MS.map((ms, k) =>
      k === 0 ? kf(t, L, [[0, 1], [L, 1]]) : kf(t, L, [[0, 0.25], [ms - 120, 0.25], ...seg(ms - 120, ms, 0.25, 1, outQuad, 3), [3600, 1], ...seg(3600, 3900, 1, 0.25, inOut, 3)]),
    );
    return {
      clip: kf(e, E, seg(0, 420, -W, 0, outCubic, 6)),
      clipInner: kf(e, E, seg(0, 420, W, 0, outCubic, 6)),
      riderPop: kf(e, E, [[0, 0], [250, 0], ...seg(250, 560, 0, 1, spring(0.45, 14), 10)]),
      riderX: kf(t, L, [...prog.map(([ms, s]) => [ms, s * T] as P), [3850, T], [3860, 0], [L, 0]]),
      riderY: kf(t, L, [...prog.map(([ms, s]) => [ms, yAt(s) - 30] as P), [3850, 0]]),
      riderO: kf(t, L, [[0, 1], [3600, 1], ...seg(3600, 3850, 1, 0, inOut, 3), [L - 1, 0], [L, 1]]),
      bob: kf(t, L, bob),
      pitch: kfDeg(t, L, [...seg(0, 450, -4, 0, outCubic, 5), [1820, 0], ...seg(1820, 2000, 0, 7, outQuad, 4), ...seg(2000, 2450, 7, 0, spring(0.35, 15), 12), [L, 0]]),
      pinS: kf(t, L, [[0, 0], [2600, 0], ...seg(2600, 2900, 0, 1, spring(0.45, 14), 10), [3600, 1], ...seg(3600, 3780, 1, 0, inQuad, 3)]),
      noteY: noteYN,
      noteS: noteYN.interpolate({ inputRange: [-24, 0, 4], outputRange: [0.9, 1, 1.02], extrapolate: 'clamp' }),
      noteO: kf(t, L, [[0, 0], [2150, 0], ...seg(2150, 2260, 0, 1, outQuad, 3), [3600, 1], ...seg(3600, 3900, 1, 0, inQuad, 3)]),
      dots,
      dotS: dots.map((d: AnimNode) => d.interpolate({ inputRange: [0.25, 1], outputRange: [0.75, 1] })),
      blink: kf(t, L, blinks(L, [1100, 3200], [3200])),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, e, W, T]);

  const pathD = `M${x0} 30 Q${(x0 + x1) / 2} 6 ${x1} 30`;

  return (
    <>
      <Depth k={-6}>
        {/* route band (full width, behind the CTA) — revealed by a sliding clip */}
        <Animated.View style={[A({ left: 0, top: bandTop, width: W, height: 42, overflow: 'hidden' }), { transform: [{ translateX: v.clip }] }]}>
          <Animated.View style={{ width: W, height: 42, transform: [{ translateX: v.clipInner }] }}>
            <Svg width={W} height={42}>
              <Defs>
                <SvgGrad id="trk-pillar" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#E2E8F0" />
                  <Stop offset="1" stopColor="#64748B" />
                </SvgGrad>
              </Defs>
              <Path d={pathD} stroke="#22C55E" strokeOpacity={0.12} strokeWidth={8} fill="none" strokeLinecap="round" />
              <Path d={pathD} stroke="#22C55E" strokeOpacity={0.55} strokeWidth={2.5} strokeDasharray="6 7" fill="none" strokeLinecap="round" />
              <Ellipse cx={x1 + 17} cy={37} rx={18} ry={2.4} fill="#000000" opacity={0.3} />
              <Rect x={x1 + 4} y={12} width={5} height={24} rx={1.5} fill="url(#trk-pillar)" />
              <Rect x={x1 + 25} y={12} width={5} height={24} rx={1.5} fill="url(#trk-pillar)" />
              <Path d={`M${x1 + 6} 14 Q${x1 + 17.5} 0 ${x1 + 28} 14`} stroke="#CBD5E1" strokeWidth={3} fill="none" strokeLinecap="round" />
              <Path d={`M${x1 + 8} 12 Q${x1 + 13} 6 ${x1 + 17} 5`} stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={1} fill="none" strokeLinecap="round" />
            </Svg>
            <Text style={[A({ left: 8, top: 12 }), { fontSize: 15 }]}>🏪</Text>
          </Animated.View>
        </Animated.View>

        {/* status dots (placed, confirmed, preparing, on the way, at gate) */}
        {DOT_S.map((s, k) => (
          <Animated.View
            key={k}
            style={[
              A({ left: x0 + s * T - 4, top: bandTop + yAt(s) - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E', borderWidth: 1.5, borderColor: '#0E0E14' }),
              { opacity: v.dots[k], transform: [{ scale: v.dotS[k] }] },
            ]}
          />
        ))}

        {/* Zippy on his scooter */}
        <Animated.View
          style={[
            A({ left: x0 - 19, top: bandTop - 6, width: 38, height: 36 }),
            { opacity: v.riderO, transform: [{ translateX: v.riderX }, { translateY: v.riderY }, { scale: v.riderPop }] },
          ]}
        >
          <ContactShadow w={36} h={5} at={{ left: 1, top: 33 }} strength={0.6} />
          <Animated.View style={[{ width: 38, height: 36 }, FEET, { transform: [{ translateY: v.bob }, { rotate: v.pitch }] }]}>
            <Zippy size={24} helmet="#22C55E" shadow={false} blink={v.blink} style={A({ left: 6, top: 0 })} />
            <Svg width={38} height={16} viewBox="0 0 38 16" style={A({ left: 0, top: 20 })}>
              <Defs>
                <SvgGrad id="trk-body" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#4ADE80" />
                  <Stop offset="1" stopColor="#15803D" />
                </SvgGrad>
                <RadialGradient id="trk-lamp" cx="0.5" cy="0.5" r="0.5">
                  <Stop offset="0" stopColor="#FEF9C3" stopOpacity={0.9} />
                  <Stop offset="1" stopColor="#FEF9C3" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Path d="M7 8 H27 L31 2 H34" stroke="#22C55E" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Path d="M4 7 Q4 4.6 7 4.6 H23 Q28 4.6 28 8.5 V10.6 H4 Z" fill="url(#trk-body)" />
              <Rect x={6} y={5.2} width={15} height={1.1} rx={0.55} fill="#FFFFFF" opacity={0.45} />
              <Circle cx={34.5} cy={3} r={3.6} fill="url(#trk-lamp)" />
              <Circle cx={34.2} cy={3} r={1.3} fill="#FEF9C3" />
              {[8, 29].map((cx) => (
                <G key={cx}>
                  <Circle cx={cx} cy={12} r={3.6} fill="#0B0B12" stroke="#475569" strokeWidth={1.4} />
                  <Circle cx={cx} cy={12} r={1.3} fill="#CBD5E1" />
                  <Path d={`M${cx - 2.6} 10.4 A3 3 0 0 1 ${cx - 0.6} 9`} stroke="#FFFFFF" strokeOpacity={0.4} strokeWidth={0.8} fill="none" strokeLinecap="round" />
                </G>
              ))}
            </Svg>
          </Animated.View>
          {/* masked delivery PIN */}
          <Animated.View style={[A({ left: -6, top: -22, height: 18, paddingHorizontal: 5, borderRadius: 6, backgroundColor: '#0B0B12', borderWidth: 1, borderColor: '#22C55E', justifyContent: 'center' }), { transform: [{ scale: v.pinS }] }]}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>🔒 ••••</Text>
          </Animated.View>
        </Animated.View>
      </Depth>

      {/* "Rider at your gate" — copy of the real driverAtGate alert */}
      <Depth k={8}>
        <CornerArt width={size}>
          <Animated.View
            style={[
              A({
                right: 12,
                top: 16,
                width: 104,
                height: 40,
                borderRadius: 10,
                backgroundColor: '#1F2937',
                borderWidth: 1,
                borderColor: 'rgba(34,197,94,0.55)',
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 7,
                shadowColor: '#000',
                shadowOpacity: 0.35,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 4 },
              }),
              { opacity: v.noteO, transform: [{ translateY: v.noteY }, { scale: v.noteS }] },
            ]}
          >
            <View style={A({ left: 6, right: 6, top: 1, height: 1, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.12)' })} />
            <Text style={{ fontSize: 14, marginRight: 5 }}>🛵</Text>
            <Text numberOfLines={2} style={{ flex: 1, color: '#FFFFFF', fontSize: 12, fontWeight: '700', lineHeight: 13 }}>
              Rider at your gate
            </Text>
          </Animated.View>
        </CornerArt>
      </Depth>
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. KIRANA — "The Cupboard"
// ─────────────────────────────────────────────────────────────────────────────

const KIRANA_ITEMS = [
  { g: '🍜', right: 68, top: 34 },
  { g: '🍪', right: 40, top: 34 },
  { g: '🥤', right: 74, top: 84 },
  { g: '🍟', right: 44, top: 84 },
];

export const KiranaArt = memo(function KiranaArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const L = 3800;
  const E = 500;
  const { t, e } = useSceneClock(active, reduceMotion, L, 2700, E);

  const v = useMemo(() => {
    // Tug (anticipation), swing open on a heavy spring, then slam shut with a rebound.
    const doorS: P[] = [
      [0, 1],
      ...seg(0, 80, 1, 1.04, inOut, 3),
      ...seg(80, 440, 1.04, 0.15, spring(0.65, 12), 12),
      [3300, 0.15],
      ...seg(3300, 3550, 0.15, 1, inQuad, 4),
      [3600, 0.95],
      ...seg(3600, 3720, 0.95, 1, outQuad, 2),
      [L, 1],
    ];
    const zSY: P[] = [[0, 1], [950, 1], ...seg(950, 1180, 1, 0.78, inOut, 4), [2300, 0.78], ...seg(2300, 2420, 0.78, 1.12, outQuad, 3), ...seg(2420, 2800, 1.12, 1, springy, 10)];
    const moth = (fn: (u: number) => number, rest: number): P[] => [[0, rest], ...seg(300, 900, 0, 1, lin, 14).map(([ms, u]) => [ms, fn(u)] as P)];
    const wing: P[] = [[0, 1]];
    for (let ms = 300; ms <= 900; ms += 15) wing.push([ms, 0.675 + 0.325 * Math.cos((TAU * (ms - 300)) / 90)]);
    wing.push([L, 1]);
    return {
      cupX: kf(e, E, seg(0, 380, 30, 0, soft, 10)),
      zPop: kf(e, E, [[0, 0], [200, 0], ...seg(200, 500, 0, 1, spring(0.45, 14), 10)]),
      doorS: kf(t, L, doorS),
      doorLX: kf(t, L, doorS.map(([ms, s]) => [ms, -25 * (1 - s)] as P)),
      doorRX: kf(t, L, doorS.map(([ms, s]) => [ms, 25 * (1 - s)] as P)),
      mothY: kf(t, L, moth((u) => -40 * outQuad(u) + 3 * Math.sin(TAU * 3 * u), 0)),
      mothX: kf(t, L, moth((u) => -18 * u + 6 * Math.sin(TAU * 1.6 * u), 0)),
      mothO: kf(t, L, [[0, 0], [299, 0], [330, 1], [700, 1], ...seg(700, 900, 1, 0, inOut, 3)]),
      wing: kf(t, L, wing),
      zSY: kf(t, L, zSY),
      zSX: kf(t, L, zSY.map(([ms, s]) => [ms, volXv(s)] as P)),
      zEyes: kf(t, L, [[0, 1], ...seg(950, 1050, 1, 0, inOut, 2), [3500, 0], ...seg(3500, 3700, 0, 1, inOut, 3)]),
      zFlat: kf(t, L, [[0, 0], ...seg(950, 1050, 0, 1, inOut, 2), [2300, 1], ...seg(2300, 2400, 1, 0, inOut, 2)]),
      zHappy: kf(t, L, [[0, 0], ...seg(2300, 2400, 0, 1, inOut, 2), [3500, 1], ...seg(3500, 3700, 1, 0, inOut, 3)]),
      zBlink: kf(t, L, blinks(L, [460])),
      zBreath: kf(t, L, wave(L, 1, 0.025, 2)),
      screen: kf(t, L, [[0, 0.25], [1500, 0.25], [1560, 1], [1640, 0.4], [1720, 1], [1900, 0.25]]),
      items: KIRANA_ITEMS.map((_, i) => {
        const s0 = 1500 + i * 140;
        const land = s0 + 230;
        const sy: P[] = [[0, 1], [s0, 1], ...seg(s0, land, 1, 1.14, inQuad, 3), ...seg(land, land + 45, 1.14, 0.72, outQuad, 2), ...seg(land + 45, land + 320, 0.72, 1, jelly, 10)];
        const y = kf(t, L, [[0, -60], [s0, -60], ...seg(s0, land, -60, 0, inQuad, 6)]);
        return {
          y,
          sy: kf(t, L, sy),
          sx: kf(t, L, sy.map(([ms, s]) => [ms, volXv(s)] as P)),
          o: kf(t, L, [[0, 0], [s0, 0], [s0 + 10, 1], [3300, 1], ...seg(3300, 3600, 1, 0, inOut, 3)]),
          sh: y.interpolate({ inputRange: [-60, 0], outputRange: [0.2, 1], extrapolate: 'clamp' }),
        };
      }),
    };
  }, [t, e]);

  return (
    <CornerArt width={size}>
      <Animated.View style={[A({ right: -16, top: -24, width: 120, height: 200 }), { transform: [{ translateX: v.cupX }] }]}>
        <Svg width={120} height={200} viewBox="0 0 120 200">
          <Defs>
            <SvgGrad id="kirana-wood" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#6B3F18" />
              <Stop offset="0.45" stopColor="#8A5526" />
              <Stop offset="1" stopColor="#4F2C0F" />
            </SvgGrad>
            <SvgGrad id="kirana-cavity" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#0A0502" />
              <Stop offset="1" stopColor="#2A170A" />
            </SvgGrad>
            <SvgGrad id="kirana-ao" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity={0.6} />
              <Stop offset="1" stopColor="#000000" stopOpacity={0} />
            </SvgGrad>
          </Defs>
          <Rect x={0} y={0} width={120} height={200} rx={8} fill="url(#kirana-wood)" />
          <Path d="M14 4 C26 60 8 120 18 196 M104 4 C94 70 110 130 100 196 M60 2 C64 10 58 18 62 26" stroke="#3F230B" strokeOpacity={0.28} strokeWidth={1} fill="none" />
          <Rect x={4} y={22} width={112} height={4} fill="#3F230B" opacity={0.6} />
          <Rect x={4} y={21} width={112} height={1} fill="#C08850" opacity={0.5} />
          <Rect x={10} y={30} width={100} height={160} rx={3} fill="url(#kirana-cavity)" />
          <Rect x={10} y={30} width={100} height={12} fill="url(#kirana-ao)" />
          {[80, 130].map((y) => (
            <G key={y}>
              <Rect x={10} y={y} width={100} height={4} fill="#8A5526" />
              <Rect x={10} y={y} width={100} height={1} fill="#C08850" opacity={0.75} />
              <Rect x={10} y={y + 4} width={100} height={9} fill="url(#kirana-ao)" />
            </G>
          ))}
          <Rect x={2} y={2} width={6} height={196} rx={3} fill="#FFFFFF" opacity={0.08} />
        </Svg>
        {/* moth from the empty cupboard */}
        <Animated.View style={[A({ left: 46, top: 96, width: 18, height: 12 }), { opacity: v.mothO, transform: [{ translateX: v.mothX }, { translateY: v.mothY }] }]}>
          <Animated.View style={{ width: 18, height: 12, transform: [{ scaleX: v.wing }] }}>
            <Svg width={18} height={12} viewBox="0 0 18 12">
              <Ellipse cx={5} cy={6} rx={5} ry={4} fill="#9CA3AF" />
              <Ellipse cx={13} cy={6} rx={5} ry={4} fill="#9CA3AF" />
              <Ellipse cx={4} cy={4.8} rx={2.4} ry={1.4} fill="#E5E7EB" opacity={0.6} />
              <Ellipse cx={14} cy={4.8} rx={2.4} ry={1.4} fill="#E5E7EB" opacity={0.6} />
              <Ellipse cx={9} cy={6} rx={1.6} ry={4.5} fill="#4B5563" />
            </Svg>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* shelf shadows that tighten as each snack lands */}
      {KIRANA_ITEMS.map((it, i) => (
        <ContactShadow key={`sh-${it.g}`} w={20} h={4} at={{ right: it.right + 2, top: it.top + 21 }} scale={v.items[i].sh} opacity={v.items[i].o} strength={0.7} />
      ))}

      {/* snacks landing on the shelves */}
      {KIRANA_ITEMS.map((it, i) => (
        <Animated.View
          key={it.g}
          style={[
            A({ right: it.right, top: it.top, width: 24, height: 24, alignItems: 'center', justifyContent: 'flex-end' }),
            FEET,
            { opacity: v.items[i].o, transform: [{ translateY: v.items[i].y }, { scaleX: v.items[i].sx }, { scaleY: v.items[i].sy }] },
          ]}
        >
          <Text style={{ fontSize: 18, lineHeight: 22 }}>{it.g}</Text>
        </Animated.View>
      ))}

      {/* doors, hinged on the outside */}
      {[
        { right: 44, tx: v.doorLX, knob: 40 },
        { right: -6, tx: v.doorRX, knob: 10 },
      ].map((d, i) => (
        <Animated.View key={i} style={[A({ right: d.right, top: 6, width: 50, height: 160 }), { transform: [{ translateX: v.cupX }, { translateX: d.tx }, { scaleX: v.doorS }] }]}>
          <Svg width={50} height={160} viewBox="0 0 50 160">
            <Defs>
              <SvgGrad id="kirana-door" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#A06A36" />
                <Stop offset="1" stopColor="#7A4B22" />
              </SvgGrad>
              <SvgGrad id="kirana-panel" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#B07A44" />
                <Stop offset="1" stopColor="#6B3F18" />
              </SvgGrad>
              <RadialGradient id="kirana-knob" cx="0.35" cy="0.35" r="0.7">
                <Stop offset="0" stopColor="#FEF3C7" />
                <Stop offset="0.5" stopColor="#F59E0B" />
                <Stop offset="1" stopColor="#92400E" />
              </RadialGradient>
            </Defs>
            <Rect x={0.5} y={0} width={49} height={160} rx={2} fill="url(#kirana-door)" stroke="#4A2A0E" strokeWidth={1} />
            {[10, 86].map((y) => (
              <G key={y}>
                <Rect x={7} y={y} width={36} height={62} rx={3} fill="url(#kirana-panel)" stroke="#5B3412" strokeWidth={1.5} />
                <Path d={`M8.5 ${y + 61} V${y + 1.5} H41.5`} stroke="#D4A06A" strokeOpacity={0.55} strokeWidth={1} fill="none" />
                <Path d={`M41.5 ${y + 1.5} V${y + 60.5} H8.5`} stroke="#3F230B" strokeOpacity={0.5} strokeWidth={1} fill="none" />
              </G>
            ))}
            <Circle cx={d.knob} cy={80} r={3.3} fill="url(#kirana-knob)" />
            <Circle cx={d.knob - 1} cy={79} r={0.9} fill="#FFFFFF" opacity={0.8} />
          </Svg>
        </Animated.View>
      ))}

      {/* Zippy, phone in hand */}
      <Animated.View style={[A({ right: 106, bottom: 16 }), FEET, { transform: [{ scale: v.zPop }, { scaleX: v.zSX }, { scaleY: v.zSY }] }]}>
        <Zippy size={38} breath={v.zBreath} blink={v.zBlink} eyesOpacity={v.zEyes} overlays={[{ alt: 'flat', opacity: v.zFlat }, { alt: 'happy', opacity: v.zHappy }]}>
          <Glow w={22} h={26} color="#FDE047" at={{ right: -12, top: 13 }} opacity={v.screen} strength={0.45} />
          <View style={A({ right: -6, top: 18, width: 10, height: 16, borderRadius: 3, backgroundColor: '#0B0B12', padding: 1.5, borderWidth: 0.5, borderColor: '#334155' })}>
            <Animated.View style={{ flex: 1, borderRadius: 1.5, backgroundColor: '#EAB308', opacity: v.screen }} />
          </View>
        </Zippy>
      </Animated.View>
    </CornerArt>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PRINT — "Paper Storm"
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_DX = [-15, -35, -55];

function Sheet() {
  return (
    <Svg width={26} height={34} viewBox="0 0 26 34">
      <Defs>
        <SvgGrad id="print-sheet" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#DCE3EC" />
        </SvgGrad>
      </Defs>
      <Path d="M0 2 Q0 0 2 0 H19 L26 7 V32 Q26 34 24 34 H2 Q0 34 0 32 Z" fill="url(#print-sheet)" />
      <Path d="M19 0 V5 Q19 7 21 7 H26 Z" fill="#CBD5E1" />
      <Path d="M19 0 L26 7" stroke="#94A3B8" strokeOpacity={0.5} strokeWidth={0.6} />
      <Rect x={5} y={11} width={14} height={1.8} rx={0.9} fill="#CBD5E1" />
      <Rect x={5} y={16} width={16} height={1.8} rx={0.9} fill="#CBD5E1" />
      <Rect x={5} y={21} width={11} height={1.8} rx={0.9} fill="#CBD5E1" />
      <Rect x={5} y={26} width={15} height={1.8} rx={0.9} fill="#CBD5E1" />
    </Svg>
  );
}

export const PrintArt = memo(function PrintArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const L = 3400;
  const E = 600;
  const { t, e } = useSceneClock(active, reduceMotion, L, 2100, E);

  const v = useMemo(() => {
    const zSY: P[] = [[0, 1], [290, 1], ...seg(290, 350, 1, 0.84, inOut, 2), ...seg(350, 400, 0.84, 1.1, outQuad, 2), ...seg(400, 560, 1.1, 1, inOut, 3), ...seg(560, 600, 1, 0.8, outQuad, 2), ...seg(600, 820, 0.8, 1, jelly, 10), [L, 1]];
    const hop = kf(t, L, [[0, 0], [350, 0], ...seg(350, 460, 0, -12, outQuad, 4), ...seg(460, 570, -12, 0, inQuad, 4), [L, 0]]);
    return {
      groupY: kf(e, E, seg(0, 420, 50, 0, spring(0.45, 12), 12)),
      clockO: kf(e, E, [[0, 0], ...seg(250, 450, 0, 1, inOut, 3)]),
      cough: kf(t, L, [...wobble(0, 340, 3.2, 3), [L, 0]]),
      heave: kf(t, L, [[0, 1], ...seg(0, 80, 1, 1.045, outQuad, 2), ...seg(80, 160, 1.045, 0.97, inOut, 2), ...seg(160, 420, 0.97, 1, springy, 8), [L, 1]]),
      led: kf(t, L, [[0, 1], [50, 0.2], [100, 1], [150, 0.2], [200, 1], [250, 0.2], [300, 1], [L, 1]]),
      sheets: SHEET_DX.map((dx, i) => {
        const s0 = 350 + i * 160;
        const s1 = s0 + 650;
        const path = (fn: (u: number) => number, rest: number): P[] => [[0, rest], [s0, rest], ...seg(s0, s1, 0, 1, lin, 12).map(([ms, u]) => [ms, fn(u)] as P)];
        return {
          x: kf(t, L, path((u) => dx * outQuad(u) + 6 * Math.sin(TAU * 1.3 * u) * u, 0)),
          y: kf(t, L, path((u) => -100 * outCubic(u), 0)),
          r: kfDeg(t, L, path((u) => -20 + 45 * u + 12 * Math.sin(TAU * (1.6 * u + i * 0.2)), -20)),
          flip: kf(t, L, path((u) => 0.8 + 0.2 * Math.cos(TAU * (1.1 * u + i * 0.15)), 1)),
          o: kf(t, L, [[0, 0], [s0, 0], [s0 + 20, 0.9], [s0 + 420, 0.9], ...seg(s0 + 420, s1, 0.9, 0, inQuad, 3)]),
        };
      }),
      zHop: hop,
      zShadow: hop.interpolate({ inputRange: [-12, 0], outputRange: [0.6, 1], extrapolate: 'clamp' }),
      zSY: kf(t, L, zSY),
      zSX: kf(t, L, zSY.map(([ms, s]) => [ms, volXv(s)] as P)),
      zEyes: kf(t, L, [[0, 1], [350, 1], [430, 0], [3000, 0], ...seg(3000, 3200, 0, 1, inOut, 3)]),
      zHuge: kf(t, L, [[0, 0], [350, 0], [430, 1], [1700, 1], ...seg(1700, 1800, 1, 0, inOut, 2)]),
      zHappy: kf(t, L, [[0, 0], ...seg(1700, 1800, 0, 1, inOut, 2), [3000, 1], ...seg(3000, 3200, 1, 0, inOut, 3)]),
      zBlink: kf(t, L, blinks(L, [150])),
      zBreath: kf(t, L, wave(L, 1, 0.025, 2)),
      minute: kfDeg(t, L, [[0, 342], [1400, 342], ...seg(1400, 1440, 342, 341, inOut, 2), ...seg(1440, 1620, 341, 348, spring(0.3, 18), 10), [L, 348]]),
      stackY: kf(t, L, [[0, 10], [1700, 10], ...seg(1700, 1960, 10, 0, soft, 8), [3000, 0], ...seg(3000, 3300, 0, 10, inOut, 3)]),
      stackO: kf(t, L, [[0, 0], [1700, 0], [1760, 1], [3000, 1], ...seg(3000, 3200, 1, 0, inOut, 2)]),
    };
  }, [t, e]);

  return (
    <CornerArt width={size}>
      {/* wall clock, 8:57 */}
      <Depth k={-10}>
        <Animated.View style={[A({ right: 14, top: 12, width: 28, height: 28 }), { opacity: v.clockO }]}>
          <Svg width={28} height={28} viewBox="0 0 28 28">
            <Defs>
              <RadialGradient id="print-face" cx="0.45" cy="0.4" r="0.6">
                <Stop offset="0" stopColor="#FFFFFF" />
                <Stop offset="1" stopColor="#DBE4EE" />
              </RadialGradient>
            </Defs>
            <Circle cx={14.6} cy={15} r={12.5} fill="#000000" opacity={0.25} />
            <Circle cx={14} cy={14} r={12.5} fill="url(#print-face)" stroke="#38BDF8" strokeWidth={2.2} />
            <Path d="M14 3.5 V5.5 M24.5 14 H22.5 M14 24.5 V22.5 M3.5 14 H5.5" stroke="#334155" strokeWidth={1.4} strokeLinecap="round" />
            <Path d="M14 14 L8.2 13" stroke="#0F172A" strokeWidth={2} strokeLinecap="round" />
            <Circle cx={14} cy={14} r={1.6} fill="#0F172A" />
          </Svg>
          <Animated.View style={[A({ left: 0, top: 0, width: 28, height: 28 }), { transform: [{ rotate: v.minute }] }]}>
            <Svg width={28} height={28} viewBox="0 0 28 28">
              <Path d="M14 14 V5" stroke="#EF4444" strokeWidth={1.6} strokeLinecap="round" />
            </Svg>
          </Animated.View>
          {/* glass glare */}
          <Svg width={28} height={28} viewBox="0 0 28 28" style={A({ left: 0, top: 0 })}>
            <Path d="M6 9 A10 10 0 0 1 13 4.2" stroke="#FFFFFF" strokeOpacity={0.8} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          </Svg>
        </Animated.View>
      </Depth>

      {/* flying sheets (shoot up-left, flutter, fade) */}
      {v.sheets.map((sh: { x: AnimNode; y: AnimNode; r: AnimNode; flip: AnimNode; o: AnimNode }, i: number) => (
        <Animated.View
          key={i}
          style={[A({ right: 40, bottom: 34, width: 26, height: 34 }), { opacity: sh.o, transform: [{ translateX: sh.x }, { translateY: sh.y }, { rotate: sh.r }, { scaleX: sh.flip }] }]}
        >
          <Sheet />
        </Animated.View>
      ))}

      {/* printer + Zippy (one group) */}
      <Animated.View style={[A({ right: -10, bottom: -28, width: 166, height: 92 }), { transform: [{ translateY: v.groupY }, { translateX: v.cough }] }]}>
        {/* neat stapled stack rising out of the slot */}
        <Animated.View style={[A({ left: 84, top: -2, width: 36, height: 20 }), { opacity: v.stackO, transform: [{ translateY: v.stackY }] }]}>
          <View style={A({ left: 4, top: 0, width: 30, height: 18, borderRadius: 2, backgroundColor: '#E2E8F0' })} />
          <View style={A({ left: 0, top: 3, width: 30, height: 18, borderRadius: 2, backgroundColor: '#FFFFFF', borderWidth: 0.5, borderColor: '#CBD5E1' })} />
          <View style={A({ left: 3, top: 6, width: 8, height: 2, borderRadius: 1, backgroundColor: '#64748B' })} />
          <View style={A({ left: 6, top: 11, width: 18, height: 1.4, borderRadius: 1, backgroundColor: '#E2E8F0' })} />
        </Animated.View>
        <Animated.View style={[A({ left: 38, top: 8, width: 128, height: 84 }), FEET, { transform: [{ scaleY: v.heave }] }]}>
          <Svg width={128} height={84} viewBox="0 0 128 84">
            <Defs>
              <SvgGrad id="print-body" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#E2E8F0" />
                <Stop offset="0.45" stopColor="#CBD5E1" />
                <Stop offset="1" stopColor="#8796AB" />
              </SvgGrad>
              <SvgGrad id="print-lid" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#64748B" />
                <Stop offset="1" stopColor="#334155" />
              </SvgGrad>
              <SvgGrad id="print-slot" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#020617" />
                <Stop offset="1" stopColor="#334155" />
              </SvgGrad>
              <RadialGradient id="print-btn" cx="0.4" cy="0.35" r="0.65">
                <Stop offset="0" stopColor="#FFFFFF" />
                <Stop offset="1" stopColor="#94A3B8" />
              </RadialGradient>
            </Defs>
            <Rect x={18} y={6} width={92} height={16} rx={5} fill="url(#print-lid)" />
            <Rect x={22} y={7} width={84} height={1.2} rx={0.6} fill="#FFFFFF" opacity={0.3} />
            <Rect x={26} y={10} width={76} height={4} rx={2} fill="#0F172A" />
            <Rect x={0} y={18} width={128} height={66} rx={12} fill="url(#print-body)" />
            <Rect x={6} y={21} width={116} height={5} rx={2.5} fill="#FFFFFF" opacity={0.45} />
            <Path d="M4 34 H124" stroke="#94A3B8" strokeOpacity={0.6} strokeWidth={0.8} />
            <Path d="M122 26 Q126 40 124 62" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.4} fill="none" strokeLinecap="round" />
            <Rect x={22} y={40} width={64} height={10} rx={5} fill="url(#print-slot)" />
            <Rect x={24} y={41} width={60} height={2} rx={1} fill="#000000" opacity={0.5} />
            <Rect x={90} y={36} width={28} height={18} rx={4} fill="#CBD5E1" stroke="#94A3B8" strokeWidth={0.8} />
            <Circle cx={100} cy={45} r={6} fill="url(#print-btn)" stroke="#64748B" strokeWidth={1.4} />
          </Svg>
        </Animated.View>
        <Glow w={24} h={24} color="#EF4444" at={{ left: 38 + 112 - 8, top: 8 + 30 - 8 }} opacity={v.led} strength={0.7} />
        <Animated.View style={[A({ left: 38 + 112, top: 8 + 30, width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' }), { opacity: v.led }]}>
          <View style={A({ left: 1.5, top: 1.2, width: 2.5, height: 2, borderRadius: 1, backgroundColor: '#FECACA' })} />
        </Animated.View>
        {/* Zippy pressed against the printer */}
        <ContactShadow w={30} h={6} at={{ left: 8, top: 22 + 31 }} scale={v.zShadow} />
        <Animated.View style={[A({ left: 6, top: 22 }), FEET, { transform: [{ translateY: v.zHop }, { scaleX: v.zSX }, { scaleY: v.zSY }] }]}>
          <Zippy
            size={34}
            shadow={false}
            breath={v.zBreath}
            blink={v.zBlink}
            eyesOpacity={v.zEyes}
            overlays={[{ alt: 'huge', opacity: v.zHuge }, { alt: 'happy', opacity: v.zHappy }]}
          />
        </Animated.View>
      </Animated.View>
    </CornerArt>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CO-RIDE — "The Road"
// ─────────────────────────────────────────────────────────────────────────────

export const RideArt = memo(function RideArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const W = size;
  const L = 4000;
  const E = 400;
  const { t, e } = useSceneClock(active, reduceMotion, L, 2050, E);
  const Bx = Math.round(W * 0.66);
  const zLeft = Bx - 34;
  const seatDx = 36;
  const ride = W + 60 - Bx;

  const v = useMemo(() => {
    const lanes: P[] = [];
    for (let i = 0; i < 8; i++) lanes.push([i * 500, 0], [i * 500 + 499, -40]);
    lanes.push([L, 0]);
    const arrive = spring(0.78, 10);
    // Crouch → launch → ballistic arc onto the pillion (seat at y=-10) → land.
    const zY: P[] = [[0, 0], [1420, 0], ...seg(1420, 1500, 0, 1.5, inOut, 3)];
    for (let i = 1; i <= 12; i++) {
      const u = i / 12;
      zY.push([1500 + 400 * u, 1.5 * (1 - u) - 10 * u - 4 * 24 * u * (1 - u)]);
    }
    zY.push([2480, -10], [L, 0]);
    const zYN = kf(t, L, zY);
    const zSY: P[] = [[0, 1], [1400, 1], ...seg(1400, 1500, 1, 0.8, inOut, 3), ...seg(1500, 1560, 0.8, 1.12, outQuad, 2), ...seg(1560, 1880, 1.12, 1, inOut, 4), ...seg(1900, 1945, 1, 0.74, outQuad, 2), ...seg(1945, 2200, 0.74, 1, jelly, 10), [L, 1]];
    return {
      roadO: kf(e, E, [[0, 0], ...seg(0, 250, 0, 1, inOut, 3)]),
      lanes: kf(t, L, lanes),
      bikeX: kf(t, L, [...seg(0, 700, -120, Bx, arrive, 14), [2100, Bx], ...seg(2100, 2480, Bx, W + 60, inCubic, 8), [L, W + 60]]),
      bikeR: kfDeg(t, L, [...seg(0, 420, -3, 0, inOut, 4), ...seg(420, 600, 0, 5, outQuad, 3), ...seg(600, 1000, 5, 0, spring(0.35, 15), 10), [2100, 0], ...seg(2100, 2220, 0, -6, outQuad, 3), ...seg(2220, 2480, -6, -2, inOut, 3), [L, -3]]),
      bikeDip: kf(t, L, [[0, 0], [1900, 0], ...seg(1900, 1960, 0, 3, outQuad, 2), ...seg(1960, 2250, 3, 0, spring(0.4, 15), 10), [L, 0]]),
      dust: [0, 50, 100].map((d) => ({
        o: kf(t, L, [[0, 0], [560 + d, 0], [600 + d, 0.55], ...seg(600 + d, 1000 + d, 0.55, 0, outQuad, 4)]),
        s: kf(t, L, [[0, 0.4], [560 + d, 0.4], ...seg(560 + d, 1000 + d, 0.4, 1.6, outCubic, 5)]),
        y: kf(t, L, [[0, 0], [560 + d, 0], ...seg(560 + d, 1000 + d, 0, -8, outQuad, 4)]),
      })),
      okS: kf(t, L, [[0, 0], [1250, 0], ...seg(1250, 1500, 0, 1, spring(0.45, 14), 10), [2100, 1], ...seg(2100, 2200, 1, 0, inQuad, 3)]),
      zO: kf(t, L, [[0, 0], [250, 1], [2480, 1], [2500, 0], [L, 0]]),
      zX: kf(t, L, [[0, 0], [1500, 0], [1900, seatDx], [2100, seatDx], ...seg(2100, 2480, seatDx, seatDx + ride, inCubic, 8)]),
      zY: zYN,
      zSY: kf(t, L, zSY),
      zSX: kf(t, L, zSY.map(([ms, s]) => [ms, volXv(s)] as P)),
      zShS: zYN.interpolate({ inputRange: [-40, 0], outputRange: [0.45, 1], extrapolate: 'clamp' }),
      zShO: kf(t, L, [[0, 1], [1500, 1], ...seg(1500, 1880, 1, 0, inOut, 3), [L - 1, 0], [L, 1]]),
      zBlink: kf(t, L, blinks(L, [700])),
      zBreath: kf(t, L, wave(L, 1, 0.025, 2)),
      hostBlink: kf(t, L, blinks(L, [1700])),
      thumbO: kf(t, L, [[0, 0], ...seg(0, 250, 0, 1, inOut, 2), [1400, 1], ...seg(1400, 1460, 1, 0, inQuad, 2)]),
      askS: kf(t, L, [[0, 0], [900, 0], ...seg(900, 1150, 0, 1, spring(0.45, 14), 10), [1420, 1], ...seg(1420, 1500, 1, 0, inQuad, 3)]),
      speed: kf(t, L, [[0, 0], [2100, 0], [2200, 0.5], [2300, 0.15], [2400, 0.5], [2500, 0]]),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, e, W, Bx, ride]);

  const dashes = Math.ceil((W + 80) / 40);

  return (
    <>
      {/* road */}
      <Animated.View style={[A({ left: 0, right: 0, bottom: 0, height: 28, backgroundColor: '#1E293B', overflow: 'hidden' }), { opacity: v.roadO }]}>
        <Svg width={W} height={28} style={A({ left: 0, top: 0 })}>
          <Defs>
            <SvgGrad id="ride-road" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity={0.35} />
              <Stop offset="0.35" stopColor="#000000" stopOpacity={0} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.05} />
            </SvgGrad>
          </Defs>
          <Rect x={0} y={0} width={W} height={28} fill="url(#ride-road)" />
        </Svg>
        <View style={{ height: 2, backgroundColor: 'rgba(255,255,255,0.16)' }} />
        <Animated.View style={{ flexDirection: 'row', marginTop: 11, width: W + 80, transform: [{ translateX: v.lanes }] }}>
          {Array.from({ length: dashes }).map((_, i) => (
            <View key={i} style={{ width: 20, height: 3, borderRadius: 1.5, marginRight: 20, backgroundColor: 'rgba(255,255,255,0.5)' }} />
          ))}
        </Animated.View>
      </Animated.View>

      {/* speed lines */}
      <Depth k={10}>
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} style={[A({ right: 8 + i * 6, bottom: 38 + i * 9, width: 22 - i * 4, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF' }), { opacity: v.speed }]} />
        ))}
      </Depth>

      {/* bike with a cyan peer rider (the host) */}
      <Animated.View style={[A({ left: 0, bottom: 10, width: 66, height: 48 }), FEET, { transform: [{ translateX: v.bikeX }, { translateY: v.bikeDip }, { rotate: v.bikeR }] }]}>
        <ContactShadow w={62} h={7} at={{ left: 2, top: 43 }} strength={0.6} />
        {v.dust.map((d: { o: AnimNode; s: AnimNode; y: AnimNode }, i: number) => (
          <Animated.View
            key={i}
            style={[A({ left: -4 - i * 8, bottom: 2 + (i % 2) * 5, width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#94A3B8' }), { opacity: d.o, transform: [{ translateY: d.y }, { scale: d.s }] }]}
          />
        ))}
        <Zippy size={26} palette="cyan" squash={false} shadow={false} helmet="#0E7490" blink={v.hostBlink} style={A({ left: 30, top: 6 })} />
        <Svg width={66} height={22} viewBox="0 0 66 22" style={A({ left: 0, top: 26 })}>
          <Defs>
            <SvgGrad id="ride-body" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#22D3EE" />
              <Stop offset="1" stopColor="#0E7490" />
            </SvgGrad>
            <RadialGradient id="ride-lamp" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#FEF9C3" stopOpacity={0.9} />
              <Stop offset="1" stopColor="#FEF9C3" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Path d="M10 12 H44 L52 3 H58" stroke="#22D3EE" strokeWidth={3.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M7 9 Q7 5.5 11 5.5 H34 Q40 5.5 40 10 V12.5 H7 Z" fill="url(#ride-body)" />
          <Rect x={9} y={6.3} width={22} height={1.3} rx={0.65} fill="#FFFFFF" opacity={0.45} />
          <Circle cx={59} cy={3.4} r={4.4} fill="url(#ride-lamp)" />
          <Circle cx={58.6} cy={3.4} r={1.5} fill="#FEF9C3" />
          {[13, 53].map((cx) => (
            <G key={cx}>
              <Circle cx={cx} cy={16} r={5} fill="#0B0B12" stroke="#475569" strokeWidth={1.6} />
              <Circle cx={cx} cy={16} r={1.8} fill="#CBD5E1" />
              <Path d={`M${cx - 3.6} 13.8 A4.2 4.2 0 0 1 ${cx - 0.8} 11.9`} stroke="#FFFFFF" strokeOpacity={0.4} strokeWidth={0.9} fill="none" strokeLinecap="round" />
            </G>
          ))}
        </Svg>
        <Animated.View style={[A({ left: 34, top: -14, width: 18, height: 18, borderRadius: 9, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center' }), { transform: [{ scale: v.okS }] }]}>
          <SymbolIcon name="checkmark" style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900' }} />
        </Animated.View>
      </Animated.View>

      {/* Zippy at the roadside → hops on the pillion */}
      <Animated.View style={[A({ left: zLeft + 4, bottom: 13, width: 22, height: 6 }), { opacity: v.zO, transform: [{ translateX: v.zX }] }]}>
        <ContactShadow w={22} h={6} at={{ left: 0, top: 0 }} scale={v.zShS} opacity={v.zShO} />
      </Animated.View>
      <Animated.View style={[A({ left: zLeft, bottom: 16 }), FEET, { opacity: v.zO, transform: [{ translateX: v.zX }, { translateY: v.zY }, { scaleX: v.zSX }, { scaleY: v.zSY }] }]}>
        <Zippy size={30} shadow={false} breath={v.zBreath} blink={v.zBlink} />
        <Animated.Text style={[A({ left: -16, top: 8 }), { fontSize: 14, opacity: v.thumbO }]}>👍</Animated.Text>
        <Animated.View
          style={[
            A({ left: -8, top: -24, width: 46, height: 20, borderRadius: 7, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }),
            { transform: [{ scale: v.askS }] },
          ]}
        >
          <Text style={{ color: '#0B0B12', fontSize: 12, fontWeight: '800' }}>Join?</Text>
        </Animated.View>
      </Animated.View>
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. CAMPUS BUDDY — "The Notification Stack"
// ─────────────────────────────────────────────────────────────────────────────

function Squiggle({ w, color = 'rgba(255,255,255,0.45)' }: { w: number; color?: string }) {
  let d = 'M1 4';
  for (let x = 1; x + 6 <= w; x += 6) d += ` q1.5 -3 3 0 t3 0`;
  return (
    <Svg width={w} height={8} viewBox={`0 0 ${w} 8`}>
      <Path d={d} stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export const CampusBuddyArt = memo(function CampusBuddyArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const L = 4200;
  const E = 400;
  const { t, e } = useSceneClock(active, reduceMotion, L, 3000, E);

  const v = useMemo(() => {
    const pops = [1200, 1380, 1560];
    const twitch: P[] = [[0, 0]];
    pops.forEach((p) => twitch.push(...wobble(p, p + 160, 2.4, 2)));
    twitch.push([L, 0]);
    const zz = [0, 1080];
    const bar = kf(t, L, [[0, 0], [1900, 0], ...seg(1900, 2300, 0, 0.7, soft, 10), [3700, 0.7], ...seg(3700, 3900, 0.7, 0, inOut, 3)]);
    return {
      fadeIn: kf(e, E, [[0, 0], ...seg(0, 300, 0, 1, inOut, 3)]),
      // deep, slow sleep breaths → lighter awake breathing
      breath: kf(t, L, [...waveSeg(0, 2300, 1, 0.05, 2), ...waveSeg(2300, 4200, 1, 0.018, 2).slice(1)]),
      zRot: kfDeg(t, L, [[0, -90], [2220, -90], ...seg(2220, 2300, -90, -96, inOut, 3), ...seg(2300, 2750, -96, 0, spring(0.42, 13), 12), [3700, 0], ...seg(3700, 4050, 0, -90, inOut, 6), [L, -90]]),
      zSY: kf(t, L, [[0, 1], [2300, 1], ...seg(2300, 2420, 1, 1.22, outQuad, 3), ...seg(2420, 2750, 1.22, 1, spring(0.4, 14), 10), [L, 1]]),
      zX: kf(t, L, twitch),
      closed: kf(t, L, [[0, 1], [2300, 1], [2350, 0], [3700, 0], ...seg(3700, 3900, 0, 1, inOut, 3)]),
      huge: kf(t, L, [[0, 0], [2300, 0], [2350, 1], [2650, 1], ...seg(2650, 2750, 1, 0, inOut, 2)]),
      eyes: kf(t, L, [[0, 0], ...seg(2650, 2750, 0, 1, inOut, 2), [3700, 1], ...seg(3700, 3800, 1, 0, inOut, 2)]),
      glasses: kf(t, L, [[0, 0], ...seg(2700, 2850, 0, 1, inOut, 3), [3700, 1], ...seg(3700, 3800, 1, 0, inOut, 2)]),
      blink: kf(t, L, blinks(L, [3150])),
      zzY: kf(t, L, bursts(zz, 1060, (u) => -22 * outQuad(u), 0)),
      zzX: kf(t, L, bursts(zz, 1060, (u) => 4 * Math.sin(TAU * u), 0)),
      zzS: kf(t, L, bursts(zz, 1060, (u) => 0.7 + 0.5 * u, 0.7)),
      zzO: kf(t, L, bursts(zz, 1060, (u) => Math.pow(Math.sin(Math.PI * u), 1.2), 0)),
      bubbles: pops.map((s0) => ({
        s: kf(t, L, [[0, 0.6], [s0, 0.6], ...seg(s0, s0 + 320, 0.6, 1, spring(0.45, 14), 10), [3700, 1], ...seg(3700, 3900, 1, 0.6, inQuad, 3)]),
        y: kf(t, L, [[0, 8], [s0, 8], ...seg(s0, s0 + 320, 8, 0, spring(0.5, 13), 10), [3700, 0], ...seg(3700, 3900, 0, 8, inQuad, 3)]),
        o: kf(t, L, [[0, 0], [s0, 0], ...seg(s0, s0 + 80, 0, 1, outQuad, 2), [3700, 1], ...seg(3700, 3900, 1, 0, inQuad, 3)]),
      })),
      bar,
      barX: bar.interpolate({ inputRange: [0, 1], outputRange: [-23, 0] }),
    };
  }, [t, e]);

  const rows: { key: string; glyph: string; extra: 'squiggle' | 'poll' | 'ticks' }[] = [
    { key: 'notes', glyph: '📒', extra: 'squiggle' },
    { key: 'poll', glyph: '📊', extra: 'poll' },
    { key: 'chat', glyph: '💬', extra: 'ticks' },
  ];

  return (
    <CornerArt width={size}>
      {/* bubble stack — pops bottom → top */}
      <Depth k={6}>
        {rows.map((r, i) => {
          const b = v.bubbles[i];
          return (
            <Animated.View
              key={r.key}
              style={[
                A({
                  right: 12,
                  bottom: 70 + i * 28,
                  width: 92,
                  height: 24,
                  borderRadius: 9,
                  backgroundColor: '#2E1065',
                  borderWidth: 1,
                  borderColor: 'rgba(167,139,250,0.7)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 6,
                  shadowColor: '#000',
                  shadowOpacity: 0.35,
                  shadowRadius: 5,
                  shadowOffset: { width: 0, height: 3 },
                }),
                { opacity: b.o, transform: [{ translateY: b.y }, { scale: b.s }] },
              ]}
            >
              <View style={A({ left: 6, right: 6, top: 1, height: 1, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.14)' })} />
              <Text style={{ fontSize: 12, marginRight: 5 }}>{r.glyph}</Text>
              {r.extra === 'poll' ? (
                <View style={{ width: 46, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                  <Animated.View style={{ width: 46, height: 6, borderRadius: 3, backgroundColor: '#A78BFA', transform: [{ translateX: v.barX }, { scaleX: v.bar }] }} />
                </View>
              ) : (
                <Squiggle w={r.extra === 'ticks' ? 36 : 54} />
              )}
              {r.extra === 'ticks' ? <Text style={{ marginLeft: 4, fontSize: 12, fontWeight: '900', color: '#38BDF8' }}>✓✓</Text> : null}
            </Animated.View>
          );
        })}
      </Depth>

      {/* textbook + sleeping Zippy */}
      <Animated.View style={[A({ right: 10, bottom: 8 }), { opacity: v.fadeIn }]}>
        <Svg width={78} height={22} viewBox="0 0 78 22">
          <Defs>
            <SvgGrad id="cb-cover" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#8B5CF6" />
              <Stop offset="1" stopColor="#4C1D95" />
            </SvgGrad>
            <SvgGrad id="cb-pages" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="1" stopColor="#DDD6FE" />
            </SvgGrad>
            <RadialGradient id="cb-ao" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#000000" stopOpacity={0.45} />
              <Stop offset="1" stopColor="#000000" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={39} cy={20} rx={40} ry={2.4} fill="url(#cb-ao)" />
          <Rect x={0} y={4} width={78} height={16} rx={3} fill="url(#cb-cover)" />
          <Rect x={4} y={1} width={72} height={7} rx={2} fill="url(#cb-pages)" />
          <Path d="M6 3.2 H74 M6 5 H74 M6 6.6 H74" stroke="#C4B5FD" strokeOpacity={0.7} strokeWidth={0.4} />
          <Rect x={0} y={11} width={78} height={2} fill="#4C1D95" />
          <Rect x={2} y={8.6} width={74} height={0.9} rx={0.45} fill="#FFFFFF" opacity={0.3} />
        </Svg>
      </Animated.View>
      <Animated.View style={[A({ right: 30, bottom: 24 }), { opacity: v.fadeIn, transform: [{ translateX: v.zX }, { rotate: v.zRot }, { scaleY: v.zSY }] }]}>
        <Zippy
          size={38}
          shadow={false}
          breath={v.breath}
          blink={v.blink}
          eyesOpacity={v.eyes}
          overlays={[{ alt: 'closed', opacity: v.closed }, { alt: 'huge', opacity: v.huge }]}
          glasses={v.glasses}
        />
      </Animated.View>
      <Animated.Text
        style={[
          A({ right: 38, bottom: 66 }),
          { fontSize: 13, fontWeight: '900', color: '#A78BFA', opacity: v.zzO, transform: [{ translateX: v.zzX }, { translateY: v.zzY }, { scale: v.zzS }] },
        ]}
      >
        z
      </Animated.Text>
    </CornerArt>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. PG STAYS — "The Rumbling House"
// ─────────────────────────────────────────────────────────────────────────────

const Z_LETTERS = [
  { ch: 'z', fs: 12, s0: 0 },
  { ch: 'Z', fs: 16, s0: 350 },
  { ch: 'Z', fs: 22, s0: 700 },
];

function House({ color = '#34D399', size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Path d="M1 7 L7 1.5 L13 7 V13 H1 Z" fill={color} />
      <Path d="M1 7 L7 1.5 L13 7" stroke="#065F46" strokeWidth={1} fill="none" strokeLinejoin="round" />
      <Rect x={5.5} y={8.5} width={3} height={4.5} fill="#064E3B" />
      <Rect x={2.5} y={8} width={2} height={2} fill="#FDE68A" />
    </Svg>
  );
}

export const StaysArt = memo(function StaysArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const L = 4200;
  const E = 600;
  const { t, e } = useSceneClock(active, reduceMotion, L, 3000, E);

  const v = useMemo(() => {
    const shake: P[] = [[0, 0]];
    Z_LETTERS.forEach(({ s0 }) => shake.push(...wobble(s0, s0 + 200, 2.2, 2)));
    shake.push([L, 0]);
    // Escape: crouch in the window, ballistic leap to the floor, land; later a happy hop.
    const flight: P[] = [];
    for (let i = 0; i <= 12; i++) flight.push([1900 + (360 * i) / 12, i / 12]);
    const hop2: P[] = [];
    for (let i = 0; i <= 8; i++) hop2.push([2700 + (220 * i) / 8, i / 8]);
    const sy: P[] = [
      [0, 0.5],
      [1820, 0.5],
      ...seg(1820, 1900, 0.5, 0.44, inOut, 2),
      ...flight.map(([ms, u]) => [ms, 0.44 + 0.56 * inOut(u)] as P),
      ...seg(2260, 2300, 1, 0.72, outQuad, 2),
      ...seg(2300, 2560, 0.72, 1, jelly, 10),
      ...seg(2640, 2700, 1, 0.85, inOut, 2),
      ...seg(2700, 2740, 0.85, 1.1, outQuad, 2),
      ...seg(2740, 2900, 1.1, 1, inOut, 3),
      ...seg(2920, 2950, 1, 0.85, outQuad, 2),
      ...seg(2950, 3150, 0.85, 1, springy, 8),
      [L, 1],
    ];
    const fZY = kf(t, L, [
      [0, -79],
      [1900, -79],
      ...flight.map(([ms, u]) => [ms, -79 * (1 - u) - 4 * 40 * u * (1 - u)] as P),
      [2700, 0],
      ...hop2.map(([ms, u]) => [ms, -4 * 9 * u * (1 - u)] as P),
    ]);
    const zLetter = (s0: number) => ({
      y: kf(t, L, bursts([s0], 900, (u) => -44 * outQuad(u), 0)),
      x: kf(t, L, bursts([s0], 900, (u) => -20 * u + 4 * Math.sin(TAU * 1.2 * u), 0)),
      s: kf(t, L, bursts([s0], 900, (u) => 0.6 + 0.75 * outQuad(u), 0.6)),
      o: kf(t, L, bursts([s0], 900, (u) => (u < 0.15 ? u / 0.15 : Math.pow(1 - (u - 0.15) / 0.85, 1.4)), 0)),
    });
    const pillow = kf(t, L, [[0, 0], [700, 0], ...seg(700, 800, 0, 1, outQuad, 2), [1850, 1], [1900, 0]]);
    return {
      bY: kf(e, E, seg(0, 420, 30, 0, spring(0.55, 12), 12)),
      glow: kf(e, E, [[0, 0], [250, 0], [290, 0.75], [330, 0.15], [390, 0.9], [430, 0.45], [520, 1]]),
      shake: kf(t, L, shake),
      zs: Z_LETTERS.map(({ s0 }) => zLetter(s0)),
      winBlink: kf(t, L, [[0, 1], [300, 1], [355, 0.1], [385, 0.1], [470, 1], [700, 1], ...seg(700, 780, 1, 0.2, inOut, 2), [1850, 0.2], ...seg(1850, 1900, 0.2, 1, outQuad, 2), [L, 1]]),
      pillow,
      pillowY: pillow.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }),
      winZ: kf(t, L, [[0, 1], [1880, 1], [1900, 0], [4100, 0], [L, 1]]),
      fZO: kf(t, L, [[0, 0], [1880, 0], [1900, 1], [3800, 1], ...seg(3800, 4100, 1, 0, inOut, 3)]),
      fZX: kf(t, L, [
        [0, 49],
        [1900, 49],
        ...flight.map(([ms, u]) => [ms, 49 * (1 - u)] as P),
        [2700, 0],
        ...hop2.map(([ms, u]) => [ms, -14 * u] as P),
        [3800, -14],
        ...seg(3800, 4100, -14, 49, inOut, 4),
      ]),
      fZY,
      fZSY: kf(t, L, sy),
      fZSX: kf(t, L, sy.map(([ms, s]) => [ms, ms <= 2260 ? s : volXv(s)] as P)),
      fShS: fZY.interpolate({ inputRange: [-95, 0], outputRange: [0.35, 1], extrapolate: 'clamp' }),
      fShO: fZY.interpolate({ inputRange: [-70, -20, 0], outputRange: [0, 0.6, 1], extrapolate: 'clamp' }),
      fHappy: kf(t, L, [[0, 0], ...seg(2700, 2800, 0, 1, inOut, 2), [3800, 1], ...seg(3800, 4000, 1, 0, inOut, 3)]),
      fEyes: kf(t, L, [[0, 1], ...seg(2700, 2800, 1, 0, inOut, 2), [3800, 0], ...seg(3800, 4000, 0, 1, inOut, 3)]),
      fBlink: kf(t, L, blinks(L, [2450])),
      fBreath: kf(t, L, wave(L, 1, 0.025, 3)),
      houses: [0, 1, 2].map((i) => kf(t, L, [[0, 0], [2300 + i * 110, 0], ...seg(2300 + i * 110, 2560 + i * 110, 0, 1, spring(0.42, 14), 10), [3800, 1], ...seg(3800, 4000, 1, 0, inQuad, 3)])),
      calmX: kf(t, L, [[0, -30], [2600, -30], ...seg(2600, 3000, -30, 0, soft, 10), [3800, 0], ...seg(3800, 4100, 0, -30, inQuad, 4)]),
      calmO: kf(t, L, [[0, 0], ...seg(2600, 2700, 0, 1, inOut, 2), [3800, 1], ...seg(3800, 4100, 1, 0, inOut, 3)]),
    };
  }, [t, e]);

  // building box: right -24, bottom 0, 124×156 → left edge at (W - 100), top at 40
  const bLeft = (x: number) => ({ right: 124 - 24 - x });

  return (
    <CornerArt width={size}>
      {/* calm PG, slides in (further away → less parallax) */}
      <Depth k={-10}>
        <Animated.View style={[A({ right: 130, bottom: 0, width: 46, height: 76, alignItems: 'center' }), { opacity: v.calmO, transform: [{ translateX: v.calmX }] }]}>
          <Glow w={26} h={22} color="#FDE68A" at={{ left: 10, top: -3 }} strength={0.35} />
          <Text style={{ fontSize: 13, lineHeight: 16 }}>🌙</Text>
          <Svg width={46} height={60} viewBox="0 0 46 60">
            <Defs>
              <SvgGrad id="stays-calm" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#14B8A6" />
                <Stop offset="1" stopColor="#0F766E" />
              </SvgGrad>
            </Defs>
            <Path d="M3 14 L23 3 L43 14 V60 H3 Z" fill="url(#stays-calm)" />
            <Path d="M3 14 L23 3 L43 14" stroke="#5EEAD4" strokeOpacity={0.6} strokeWidth={1} fill="none" strokeLinejoin="round" />
            <Rect x={10} y={20} width={9} height={10} rx={1.5} fill="#99F6E4" opacity={0.9} />
            <Rect x={27} y={20} width={9} height={10} rx={1.5} fill="#134E4A" />
            <Rect x={18} y={42} width={10} height={18} rx={1.5} fill="#134E4A" />
          </Svg>
        </Animated.View>
      </Depth>

      {/* the snoring building */}
      <Animated.View style={[A({ right: -24, bottom: 0, width: 124, height: 156 }), { transform: [{ translateY: v.bY }, { translateX: v.shake }] }]}>
        <Svg width={124} height={156} viewBox="0 0 124 156">
          <Defs>
            <SvgGrad id="stays-bldg" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#0B7A5A" />
              <Stop offset="1" stopColor="#053F30" />
            </SvgGrad>
            <SvgGrad id="stays-roof" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#10B981" />
              <Stop offset="1" stopColor="#047857" />
            </SvgGrad>
          </Defs>
          <Rect x={0} y={16} width={124} height={140} rx={4} fill="url(#stays-bldg)" />
          {Array.from({ length: 9 }).map((_, i) => (
            <Rect key={i} x={0} y={30 + i * 14} width={124} height={0.6} fill="#000000" opacity={0.1} />
          ))}
          <Rect x={0} y={20} width={124} height={6} fill="#000000" opacity={0.22} />
          <Rect x={-4} y={8} width={132} height={12} rx={3} fill="url(#stays-roof)" />
          <Rect x={-2} y={9} width={128} height={1.4} rx={0.7} fill="#FFFFFF" opacity={0.3} />
          {[16, 51, 86].map((x) =>
            [40, 84].map((y) => (
              <G key={`${x}-${y}`}>
                <Rect x={x - 1} y={y - 1} width={24} height={26} rx={2.5} fill="#011F18" />
                <Rect x={x} y={y} width={22} height={24} rx={2} fill={x === 16 && y === 40 ? '#3F3A1E' : '#022C22'} />
                <Path d={`M${x + 3} ${y + 14} L${x + 12} ${y + 3}`} stroke="#FFFFFF" strokeOpacity={0.07} strokeWidth={3} />
                <Rect x={x - 2} y={y + 24} width={26} height={2.4} rx={1} fill="#10B981" opacity={0.55} />
              </G>
            )),
          )}
          <Rect x={50} y={124} width={24} height={32} rx={2} fill="#022C22" />
          <Rect x={46} y={153} width={32} height={3} rx={1} fill="#10B981" opacity={0.4} />
          <Circle cx={69} cy={141} r={1.3} fill="#FBBF24" />
        </Svg>
        {/* warm light spilling onto the wall around the roommate's window */}
        <Glow w={56} h={56} color="#FDE68A" at={{ left: 34, top: 24 }} opacity={v.glow} strength={0.4} />
        {/* lit roommate window */}
        <Animated.View style={[A({ left: 51, top: 40, width: 22, height: 24, borderRadius: 2, backgroundColor: '#FDE68A', overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }), { opacity: v.glow }]}>
          <Zippy size={18} palette="mint" squash={false} shadow={false} overlays={[{ alt: 'closed', opacity: 1 }]} eyesOpacity={0} />
        </Animated.View>
        {/* Zippy peeking from his own window */}
        <Animated.View style={[A({ left: 16, top: 40, width: 22, height: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }), { opacity: v.winZ }]}>
          <Zippy size={18} squash={false} shadow={false} blink={v.winBlink} />
          <Animated.View
            style={[A({ left: 4, top: 2, width: 14, height: 7, borderRadius: 3, backgroundColor: '#F8FAFC' }), { opacity: v.pillow, transform: [{ translateY: v.pillowY }, { rotate: '15deg' }] }]}
          />
        </Animated.View>
      </Animated.View>

      {/* ZzZ from the roommate */}
      {Z_LETTERS.map((z, i) => (
        <Animated.Text
          key={i}
          style={[
            A({ ...bLeft(62), top: 70 }),
            { fontSize: z.fs, fontWeight: '900', color: 'rgba(255,255,255,0.85)', opacity: v.zs[i].o, transform: [{ translateX: v.zs[i].x }, { translateY: v.zs[i].y }, { scale: v.zs[i].s }] },
          ]}
        >
          {z.ch}
        </Animated.Text>
      ))}

      {/* Zippy escapes onto the floor, phone full of PG listings */}
      <Animated.View style={[A({ right: 110, bottom: 5, width: 24, height: 6 }), { opacity: v.fZO, transform: [{ translateX: v.fZX }] }]}>
        <ContactShadow w={24} h={6} at={{ left: 0, top: 0 }} scale={v.fShS} opacity={v.fShO} />
      </Animated.View>
      <Animated.View style={[A({ right: 104, bottom: 8 }), FEET, { opacity: v.fZO, transform: [{ translateX: v.fZX }, { translateY: v.fZY }, { scaleX: v.fZSX }, { scaleY: v.fZSY }] }]}>
        <Zippy size={36} shadow={false} breath={v.fBreath} blink={v.fBlink} eyesOpacity={v.fEyes} overlays={[{ alt: 'happy', opacity: v.fHappy }]} />
        {[-14, 0, 14].map((deg, i) => (
          <Animated.View key={deg} style={[A({ left: 11 + (i - 1) * 12, top: -18 }), { opacity: v.houses[i], transform: [{ rotate: `${deg}deg` }, { scale: v.houses[i] }] }]}>
            <House />
          </Animated.View>
        ))}
      </Animated.View>
    </CornerArt>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. REWARDS — "The Half-Wheel"
// ─────────────────────────────────────────────────────────────────────────────

const WHEEL_COLORS = ['#F43F5E', '#FB7185', '#FBBF24', '#A78BFA'];
const CONFETTI = [
  { x: -34, y: -32, c: '#F43F5E' },
  { x: -46, y: -4, c: '#FBBF24' },
  { x: -32, y: 26, c: '#A78BFA' },
  { x: -8, y: -44, c: '#FB7185' },
  { x: -12, y: 40, c: '#FBBF24' },
  { x: -54, y: 14, c: '#F43F5E' },
];

function wedgePath(k: number) {
  const r = 100;
  const a0 = ((k * 45 - 22.5) * Math.PI) / 180;
  const a1 = ((k * 45 + 22.5) * Math.PI) / 180;
  const p = (a: number) => `${(110 + r * Math.cos(a)).toFixed(2)} ${(110 + r * Math.sin(a)).toFixed(2)}`;
  return `M110 110 L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`;
}

function WheelFace() {
  return (
    <Svg width={220} height={220} viewBox="0 0 220 220">
      <Defs>
        <RadialGradient id="rw-hub" cx="0.4" cy="0.35" r="0.65">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#E7DCCB" />
        </RadialGradient>
      </Defs>
      {Array.from({ length: 8 }).map((_, k) => (
        <Path key={k} d={wedgePath(k)} fill={WHEEL_COLORS[k % 4]} />
      ))}
      {Array.from({ length: 8 }).map((_, k) => {
        const a = ((k * 45 + 22.5) * Math.PI) / 180;
        return <Path key={`sep${k}`} d={`M110 110 L${(110 + 100 * Math.cos(a)).toFixed(2)} ${(110 + 100 * Math.sin(a)).toFixed(2)}`} stroke="#FFF8EE" strokeOpacity={0.55} strokeWidth={1.4} />;
      })}
      {Array.from({ length: 8 }).map((_, k) => {
        const a = (k * 45 * Math.PI) / 180;
        const cx = 110 + 66 * Math.cos(a);
        const cy = 110 + 66 * Math.sin(a);
        if (k === 0 || k === 4) {
          // a gift (k=4 sits under the pointer at rest)
          return (
            <G key={k}>
              <Rect x={cx - 7} y={cy + 6} width={16} height={2} rx={1} fill="#000000" opacity={0.18} />
              <Rect x={cx - 8} y={cy - 5} width={16} height={12} rx={2} fill="#FFFFFF" />
              <Rect x={cx - 9.5} y={cy - 9} width={19} height={5} rx={1.5} fill="#FFF1F2" />
              <Rect x={cx - 1.5} y={cy - 9} width={3} height={16} fill="#F43F5E" />
            </G>
          );
        }
        return (
          <SvgText key={k} x={cx} y={cy + 6} fontSize={17} fontWeight="900" fill="#FFFFFF" textAnchor="middle" stroke="#000000" strokeOpacity={0.12} strokeWidth={0.6}>
            ?
          </SvgText>
        );
      })}
      <Circle cx={110} cy={110} r={104} fill="none" stroke="#FFF8EE" strokeWidth={8} />
      <Circle cx={110} cy={110} r={100} fill="none" stroke="#000000" strokeOpacity={0.15} strokeWidth={1} />
      <Circle cx={110} cy={110} r={15} fill="url(#rw-hub)" />
      <Circle cx={110} cy={110} r={6} fill="#F43F5E" />
      <Circle cx={108.4} cy={108.4} r={1.8} fill="#FFFFFF" opacity={0.7} />
    </Svg>
  );
}

function Bulbs({ odd }: { odd: boolean }) {
  return (
    <Svg width={220} height={220} viewBox="0 0 220 220">
      <Defs>
        <RadialGradient id="rw-bulb" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#FEF3C7" stopOpacity={0.75} />
          <Stop offset="1" stopColor="#FDE68A" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {Array.from({ length: 8 }).map((_, k) => {
        if ((k % 2 === 1) !== odd) return null;
        const a = ((k * 45 + 22.5) * Math.PI) / 180;
        const cx = 110 + 104 * Math.cos(a);
        const cy = 110 + 104 * Math.sin(a);
        return (
          <G key={k}>
            <Circle cx={cx} cy={cy} r={8} fill="url(#rw-bulb)" />
            <Circle cx={cx} cy={cy} r={3.2} fill="#FEF3C7" />
            <Circle cx={cx - 0.9} cy={cy - 0.9} r={1} fill="#FFFFFF" />
          </G>
        );
      })}
    </Svg>
  );
}

/** Wheel angle while spinning: wind-up, then friction-style deceleration. */
function spinAngle(ms: number) {
  if (ms <= 150) return 0;
  if (ms <= 250) return -8 * inOut((ms - 150) / 100);
  const u = Math.min(1, (ms - 250) / 1500);
  return -8 + 1094 * (1 - Math.pow(1 - u, 3.2));
}

export const RewardsArt = memo(function RewardsArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const W = size;
  const L = 4600;
  const E = 600;
  const { t, e } = useSceneClock(active, reduceMotion, L, 2150, E);
  const wheelLeft = W + 11 - 110;
  const pointerX = wheelLeft - 12;

  const v = useMemo(() => {
    const tw: P[] = [[0, 1]];
    let on = true;
    for (let ms = 250; ms < 1800; ms += 150) {
      tw.push([ms, on ? 1 : 0.35]);
      on = !on;
    }
    tw.push([1800, 1], [L, 1]);
    const twInv: P[] = tw.map(([ms, o]) => [ms, ms >= 250 && ms < 1800 ? 1.35 - o : 1] as P);

    const spin: P[] = [[0, 0]];
    for (let ms = 150; ms <= 1750; ms += 25) spin.push([ms, spinAngle(ms)]);
    spin.push(...seg(1750, 2050, 1086, 1080, spring(0.5, 14), 10).slice(1), [L, 1080]);

    // The pointer flicks every time a peg (bulb) passes under it: a blur of
    // flutter while the wheel is fast, distinct clicks as it slows down.
    const crossings: number[] = [];
    let prevPeg = Math.floor((spinAngle(250) - 22.5) / 45);
    for (let ms = 255; ms <= 1750; ms += 5) {
      const peg = Math.floor((spinAngle(ms) - 22.5) / 45);
      if (peg !== prevPeg) {
        crossings.push(ms);
        prevPeg = peg;
      }
    }
    const kick: P[] = [[0, 0]];
    crossings.forEach((c, i) => {
      const dt = (crossings[i + 1] ?? 2100) - c;
      if (dt < 70) {
        kick.push([c, -11], [c + dt / 2, -16]);
      } else {
        kick.push([c, -4], [c + 25, -20], ...seg(c + 25, c + Math.min(dt - 5, 280), -20, 0, spring(0.35, 15), 8).slice(1));
      }
    });
    kick.push([L, 0]);

    return {
      wIn: kfDeg(e, E, seg(0, 480, -30, 0, soft, 10)),
      wO: kf(e, E, [[0, 0], ...seg(0, 300, 0, 1, inOut, 3)]),
      wRot: kfDeg(t, L, spin),
      kick: kfDeg(t, L, kick),
      bulbA: kf(t, L, tw),
      bulbB: kf(t, L, twInv),
      zIn: kf(e, E, [[0, 20], [200, 20], ...seg(200, 520, 20, 0, springy, 10)]),
      zInO: kf(e, E, [[0, 0], [200, 0], [300, 1]]),
      zRot: kfDeg(t, L, [[0, 0], ...seg(0, 250, 0, -18, inOut, 4), [300, -18], ...seg(300, 750, -18, 342, outCubic, 8), [751, -18], ...seg(751, 1500, -18, 0, spring(0.3, 12), 12)]),
      zSX: kf(t, L, [[0, 1], ...seg(0, 250, 1, 1.12, inOut, 3), ...seg(250, 320, 1.12, 1, outQuad, 2), [2200, 1], ...seg(2200, 2320, 1, -1, inOut, 5), ...seg(2320, 2440, -1, 1, inOut, 5)]),
      eyes: kf(t, L, [[0, 1], [750, 1], [800, 0], [3900, 0], ...seg(3900, 4100, 0, 1, inOut, 3)]),
      flat: kf(t, L, [[0, 0], [750, 0], [800, 1], [2050, 1], ...seg(2050, 2100, 1, 0, inOut, 2)]),
      happy: kf(t, L, [[0, 0], ...seg(2050, 2100, 0, 1, inOut, 2), [3900, 1], ...seg(3900, 4100, 1, 0, inOut, 3)]),
      blink: kf(t, L, blinks(L, [520])),
      breath: kf(t, L, wave(L, 1, 0.025, 3)),
      starsR: kfDeg(t, L, [[0, 0], [750, 0], [1950, 720]]),
      starsO: kf(t, L, [[0, 0], [740, 0], [760, 1], [1900, 1], ...seg(1900, 2000, 1, 0, inOut, 2)]),
      // burst outward against drag, then gravity takes over; paper tumbles (scaleY flip)
      confetti: CONFETTI.map((c, i) => {
        const path = (fn: (u: number) => number, rest: number): P[] => [[0, rest], [2200, rest], ...seg(2200, 3000, 0, 1, lin, 14).map(([ms, u]) => [ms, fn(u)] as P)];
        return {
          x: kf(t, L, path((u) => c.x * 1.15 * outCubic(Math.min(1, u / 0.6)), 0)),
          y: kf(t, L, path((u) => c.y * outCubic(Math.min(1, u / 0.4)) + 46 * Math.pow(Math.max(0, (u - 0.3) / 0.7), 2), 0)),
          fl: kf(t, L, path((u) => Math.cos(TAU * (2.5 * u + i * 0.17)), 1)),
        };
      }),
      cR: kfDeg(t, L, [[2200, 0], [3000, 540]]),
      cO: kf(t, L, [[0, 0], [2199, 0], [2200, 1], [2750, 1], ...seg(2750, 3000, 1, 0, inQuad, 3)]),
    };
  }, [t, e]);

  return (
    <CornerArt width={size}>
      <Depth k={-5}>
        {/* contact shadow behind the wheel (doesn't spin) */}
        <Animated.View style={[A({ left: wheelLeft, top: -12 + 5, width: 220, height: 220 }), { opacity: v.wO }]}>
          <Svg width={220} height={220} viewBox="0 0 220 220">
            <Defs>
              <RadialGradient id="rw-drop" cx="0.5" cy="0.5" r="0.5">
                <Stop offset="0.85" stopColor="#000000" stopOpacity={0.45} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={110} cy={110} r={112} fill="url(#rw-drop)" />
          </Svg>
        </Animated.View>

        <Animated.View style={[A({ left: wheelLeft, top: -12, width: 220, height: 220 }), { opacity: v.wO, transform: [{ rotate: v.wIn }, { rotate: v.wRot }] }]}>
          <WheelFace />
          <Animated.View style={[A({ left: 0, top: 0 }), { opacity: v.bulbA }]}>
            <Bulbs odd={false} />
          </Animated.View>
          <Animated.View style={[A({ left: 0, top: 0 }), { opacity: v.bulbB }]}>
            <Bulbs odd />
          </Animated.View>
        </Animated.View>

        {/* fixed lighting over the spinning face: specular + edge falloff */}
        <Animated.View style={[A({ left: wheelLeft, top: -12, width: 220, height: 220 }), { opacity: v.wO }]}>
          <Svg width={220} height={220} viewBox="0 0 220 220">
            <Defs>
              <RadialGradient id="rw-spec" cx="0.36" cy="0.3" r="0.55">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.3} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="rw-edge" cx="0.5" cy="0.5" r="0.5">
                <Stop offset="0.7" stopColor="#000000" stopOpacity={0} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0.3} />
              </RadialGradient>
            </Defs>
            <Circle cx={110} cy={110} r={100} fill="url(#rw-edge)" />
            <Circle cx={110} cy={110} r={100} fill="url(#rw-spec)" />
          </Svg>
        </Animated.View>
      </Depth>

      {/* pointer — pivots at its base so passing pegs flick the tip */}
      <Animated.View style={[A({ left: pointerX - 18, top: 88, width: 40, height: 20 }), { transform: [{ rotate: v.kick }] }]}>
        <Svg width={22} height={22} viewBox="0 0 22 22" style={A({ left: 18, top: 0 })}>
          <Defs>
            <SvgGrad id="rw-ptr" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="1" stopColor="#E7DCCB" />
            </SvgGrad>
          </Defs>
          <Path d="M3 4 L19 12 L3 20 Z" fill="#000000" opacity={0.3} />
          <Path d="M2 2 L18 10 L2 18 Z" fill="url(#rw-ptr)" stroke="#0B0B12" strokeWidth={1.5} strokeLinejoin="round" />
          <Circle cx={4.5} cy={10} r={1.6} fill="#F43F5E" />
        </Svg>
      </Animated.View>

      {/* confetti from the gift */}
      {CONFETTI.map((c, i) => (
        <Animated.View
          key={i}
          style={[
            A({ left: pointerX + 14, top: 96, width: 4, height: 7, borderRadius: 1, backgroundColor: c.c }),
            { opacity: v.cO, transform: [{ translateX: v.confetti[i].x }, { translateY: v.confetti[i].y }, { rotate: v.cR }, { scaleY: v.confetti[i].fl }] },
          ]}
        />
      ))}

      {/* Zippy clinging to the pointer */}
      <Animated.View style={[A({ left: pointerX - 4, top: 52 }), { opacity: v.zInO, transform: [{ translateX: v.zIn }, { rotate: v.zRot }, { scaleX: v.zSX }] }]}>
        <Zippy size={36} breath={v.breath} blink={v.blink} eyesOpacity={v.eyes} overlays={[{ alt: 'flat', opacity: v.flat }, { alt: 'happy', opacity: v.happy }]} />
        <Animated.View style={[A({ left: 3, top: -10, width: 30, height: 16 }), { opacity: v.starsO, transform: [{ rotate: v.starsR }] }]}>
          <Text style={[A({ left: 0, top: 0 }), { fontSize: 12, color: '#FDE68A' }]}>✦</Text>
          <Text style={[A({ right: 0, top: 2 }), { fontSize: 12, color: '#FDE68A' }]}>✦</Text>
        </Animated.View>
      </Animated.View>
    </CornerArt>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. FEATURED RESTAURANT — "The Polaroid" (real admin image only)
// ─────────────────────────────────────────────────────────────────────────────

export const PolaroidArt = memo(function PolaroidArt({ active, size = 320, reduceMotion = false, imageUrl }: SceneProps) {
  const L = 4800;
  const E = 1100;
  const { t, e } = useSceneClock(active, reduceMotion, L, 0, E);
  const [failed, setFailed] = useState(!imageUrl);

  useEffect(() => {
    setFailed(!imageUrl);
  }, [imageUrl]);

  const v = useMemo(() => {
    const dropY = kf(e, E, [[0, -40], ...seg(0, 650, -40, 0, spring(0.42, 12), 14)]);
    return {
      dropY,
      dropR: kfDeg(e, E, seg(0, 650, -14, -6, spring(0.42, 12), 14)),
      dropO: kf(e, E, [[0, 0], ...seg(0, 160, 0, 1, outQuad, 2)]),
      dropSh: dropY.interpolate({ inputRange: [-40, 0], outputRange: [0.55, 1], extrapolate: 'clamp' }),
      sway: kfDeg(t, L, wave(L, 1.5, 1.5, 2, 0.75)),
      peek: kf(e, E, [[0, 12], [250, 12], ...seg(250, 600, 12, 0, spring(0.55, 12), 10)]),
      blink: kf(t, L, blinks(L, [900, 2650, 4300], [2650])),
      breath: kf(t, L, wave(L, 1, 0.028, 3)),
      gloss: kf(t, L, [[0, -40], [2500, -40], ...seg(2500, 3300, -40, 130, inOut, 8), [L, 130]]),
      kissS: kf(e, E, [[0, 0], [550, 0], ...seg(550, 1050, 0, 1.2, outCubic, 4)]),
      kissO: kf(e, E, [[0, 0], [549, 0], [550, 1], ...seg(550, 1050, 1, 0, inQuad, 3)]),
    };
  }, [t, e]);

  if (failed) {
    return (
      <CornerArt width={size}>
        <ContactShadow w={44} h={8} at={{ right: 30, bottom: 26 }} scale={v.dropSh} opacity={v.dropO} />
        <Animated.View style={[A({ right: 34, bottom: 30, alignItems: 'center' }), { opacity: v.dropO, transform: [{ translateY: v.dropY }] }]}>
          <Text style={{ fontSize: 22, marginBottom: -6 }}>🍽️</Text>
          <Zippy size={46} shadow={false} breath={v.breath} blink={v.blink} />
        </Animated.View>
      </CornerArt>
    );
  }

  return (
    <CornerArt width={size}>
      {/* Zippy cameo, peeking from behind the photo */}
      <Animated.View style={[A({ right: 104, top: 122 }), { transform: [{ translateX: v.peek }] }]}>
        <Zippy size={30} breath={v.breath} blink={v.blink} />
        <Animated.Text style={[A({ right: -4, top: -12 }), { fontSize: 13, opacity: v.kissO, transform: [{ scale: v.kissS }] }]}>😋</Animated.Text>
      </Animated.View>

      <Animated.View
        style={[
          A({ right: 8, top: 34, width: 104, height: 116, borderRadius: 4, backgroundColor: '#FFFFFF', padding: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 6 }, elevation: 8 }),
          { opacity: v.dropO, transform: [{ translateY: v.dropY }, { rotate: v.dropR }, { rotate: v.sway }] },
        ]}
      >
        <View style={{ width: 92, height: 86, borderRadius: 2, overflow: 'hidden', backgroundColor: '#E5E7EB' }}>
          <Image source={{ uri: optimizeImageUri(imageUrl, 200) }} cachePolicy="memory-disk" style={{ width: 92, height: 86 }} contentFit="cover" onError={() => setFailed(true)} />
          {/* print vignette + moving sheen across the glossy photo */}
          <Svg width={92} height={86} viewBox="0 0 92 86" style={A({ left: 0, top: 0 })}>
            <Defs>
              <RadialGradient id="pol-vig" cx="0.5" cy="0.45" r="0.72">
                <Stop offset="0.6" stopColor="#000000" stopOpacity={0} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0.28} />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={92} height={86} fill="url(#pol-vig)" />
          </Svg>
          <Animated.View style={[A({ left: 0, top: -24, width: 22, height: 134 }), { transform: [{ translateX: v.gloss }, { rotate: '20deg' }] }]}>
            <Svg width={22} height={134} viewBox="0 0 22 134">
              <Defs>
                <SvgGrad id="pol-sheen" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
                  <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.32} />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                </SvgGrad>
              </Defs>
              <Rect x={0} y={0} width={22} height={134} fill="url(#pol-sheen)" />
            </Svg>
          </Animated.View>
        </View>
        <Svg width={92} height={14} viewBox="0 0 96 14" style={{ marginTop: 4 }}>
          <Path d="M14 8 q8 -5 16 0 t16 0 t16 0 t16 0" stroke="#F59E0B" strokeWidth={2} fill="none" strokeLinecap="round" />
        </Svg>
        {/* translucent tape with torn ends */}
        <Svg width={42} height={14} viewBox="0 0 42 14" style={A({ left: 33, top: -8, transform: [{ rotate: '8deg' }] })}>
          <Path d="M1 2 L3 1 L2 4 L4 6 L2 8 L3 11 L1 13 H40 L42 11 L40 9 L41 6 L39 4 L41 2 L40 1 Z" fill="#FFFFFF" opacity={0.42} />
          <Rect x={4} y={2} width={34} height={1.4} fill="#FFFFFF" opacity={0.5} />
        </Svg>
      </Animated.View>
    </CornerArt>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Fallback for custom slides passed in by a parent
// ─────────────────────────────────────────────────────────────────────────────

export const GenericArt = memo(function GenericArt({ active, size = 320, reduceMotion = false }: SceneProps) {
  const L = 2400;
  const { t } = useSceneClock(active, reduceMotion, L, 0, 300);
  const v = useMemo(() => {
    const sy: P[] = [[0, 1], ...seg(0, 120, 1, 0.86, inOut, 3), ...seg(120, 200, 0.86, 1.12, outQuad, 2), ...seg(200, 600, 1.12, 1, inOut, 3), ...seg(620, 670, 1, 0.78, outQuad, 2), ...seg(670, 950, 0.78, 1, jelly, 10), [L, 1]];
    const y = kf(t, L, [[0, 0], [120, 0], ...seg(120, 380, 0, -16, outQuad, 5), ...seg(380, 620, -16, 0, inQuad, 5), [L, 0]]);
    return {
      y,
      sy: kf(t, L, sy),
      sx: kf(t, L, sy.map(([ms, s]) => [ms, volXv(s)] as P)),
      sh: y.interpolate({ inputRange: [-16, 0], outputRange: [0.55, 1], extrapolate: 'clamp' }),
      blink: kf(t, L, blinks(L, [1500])),
      breath: kf(t, L, wave(L, 1, 0.025, 2)),
    };
  }, [t]);
  return (
    <CornerArt width={size}>
      <ContactShadow w={44} h={8} at={{ right: 46, bottom: 30 }} scale={v.sh} />
      <Animated.View style={[A({ right: 40, bottom: 34 }), FEET, { transform: [{ translateY: v.y }, { scaleX: v.sx }, { scaleY: v.sy }] }]}>
        <Zippy size={56} shadow={false} breath={v.breath} blink={v.blink} />
      </Animated.View>
    </CornerArt>
  );
});

/** Slide.type → scene. */
export const PROMO_ART: Record<string, React.ComponentType<SceneProps>> = {
  food: FoodArt,
  tracking: TrackingArt,
  kirana: KiranaArt,
  print: PrintArt,
  ride: RideArt,
  campus: CampusBuddyArt,
  stays: StaysArt,
  rewards: RewardsArt,
  featured_restaurant: PolaroidArt,
};

export function artForType(type: string): React.ComponentType<SceneProps> {
  return PROMO_ART[type] || GenericArt;
}
