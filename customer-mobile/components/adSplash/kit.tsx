// Shared parts of the sponsored splash (owner design "Zenvy Ad Splash", 28 Oct 2026; reference copy in the
// session scratchpad: script.js + design.css). The design is drawn on a 300 x 620 phone; here every style
// works in those DESIGN UNITS and the stage maps them onto the real screen: Skia layers through one
// transform (vector-sharp at any size), React Native views through X()/Y()/S(). Nothing is bitmap-scaled.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Asset } from 'expo-asset';
import { PixelRatio, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, runOnUI, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import {
  Canvas, Circle, Group, Image as SkiaImage, Paragraph, Picture, RadialGradient, Rect, Skia, SweepGradient, LinearGradient,
  TextAlign, BlendMode, vec, useImage, drawAsPicture, type SkImage, type SkPicture, type SkParagraph, type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';
import type { SplashAd } from './adSplashApi';
import { absoluteImage } from './adSplashApi';
import type { AdSound, RustleKind } from './adSound';

// ── Stage: design units -> screen ─────────────────────────────────────────────────────────────────
export const DW = 300;
export const DH = 620;
export type Stage = { W: number; H: number; k: number; dx: number; dy: number };
export function useStage(): Stage {
  const { width: W, height: H } = useWindowDimensions();
  return useMemo(() => {
    const k = Math.min(W / DW, H / DH);
    return { W, H, k, dx: (W / k - DW) / 2, dy: (H / k - DH) / 2 };
  }, [W, H]);
}
/** Skia transform that draws design units on the full-screen canvas. */
export const stageTransform = (s: Stage) => [{ translateX: s.dx * s.k }, { translateY: s.dy * s.k }, { scale: s.k }];

// ── Fonts (Skia paragraphs; the same families the design loads from Google Fonts, OFL) ────────────
export const FONT = { display: 'Bricolage Grotesque', body: 'DM Sans', hand: 'Caveat' };
const SKIA_FONTS: Record<string, number[]> = {
    [FONT.display]: [
      require('@expo-google-fonts/bricolage-grotesque/500Medium/BricolageGrotesque_500Medium.ttf'),
      require('@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf'),
    ],
    [FONT.body]: [
      require('@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf'),
      require('@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf'),
      require('@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf'),
    ],
    [FONT.hand]: [require('@expo-google-fonts/caveat/600SemiBold/Caveat_600SemiBold.ttf')],
};
/**
 * Skia font manager with the three families. The font files are resolved with expo-asset (bundled file on
 * a phone, served URL on web) and read with Skia.Data.fromURI. (Skia's own useFonts froze the web preview
 * while resolving bundled assets; this path is the same on every platform.)
 */
export function useAdFontMgr(): SkTypefaceFontProvider | null {
  const [fm, setFm] = useState<SkTypefaceFontProvider | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const prov = Skia.TypefaceFontProvider.Make();
      for (const [family, mods] of Object.entries(SKIA_FONTS)) {
        for (const mod of mods) {
          const asset = Asset.fromModule(mod);
          await asset.downloadAsync();
          const data = await Skia.Data.fromURI(asset.localUri || asset.uri);
          const tf = Skia.Typeface.MakeFreeTypeFaceFromData(data);
          if (tf) prov.registerFont(tf, family);
        }
      }
      if (alive) setFm(prov);
    })().catch(() => { /* fonts missing: the shell skips the ad after 3 s */ });
    return () => { alive = false; };
  }, []);
  return fm;
}
/** React Native font family names for views (registered in AdSplash with expo-font). */
export const RNFONT = {
  display700: 'AdBricolage700', display500: 'AdBricolage500', body400: 'AdDMSans400', body500: 'AdDMSans500',
  body700: 'AdDMSans700', hand600: 'AdCaveat600',
};
export const RN_FONT_FILES = {
  [RNFONT.display700]: require('@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf'),
  [RNFONT.display500]: require('@expo-google-fonts/bricolage-grotesque/500Medium/BricolageGrotesque_500Medium.ttf'),
  [RNFONT.body400]: require('@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf'),
  [RNFONT.body500]: require('@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf'),
  [RNFONT.body700]: require('@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf'),
  [RNFONT.hand600]: require('@expo-google-fonts/caveat/600SemiBold/Caveat_600SemiBold.ttf'),
};

export type TextSpec = {
  family: string; size: number; weight?: number; color?: string; align?: 'left' | 'center' | 'right';
  letterSpacing?: number; lineHeight?: number; shadow?: { color: string; blur: number; dy?: number }; italic?: boolean;
};
/** One laid-out paragraph (design units). Text may hold "\n". */
export function makePara(fm: SkTypefaceFontProvider | null, text: string, width: number, t: TextSpec): SkParagraph | null {
  'worklet';
  if (!fm) return null;
  const align = t.align === 'left' ? TextAlign.Left : t.align === 'right' ? TextAlign.Right : TextAlign.Center;
  const b = Skia.ParagraphBuilder.Make({ textAlign: align }, fm);
  // Only keys with real values: native Skia rejects a key that is present but undefined ("Value is undefined,
  // expected a number"), which the web build silently accepted.
  const style: any = {
    fontFamilies: [t.family], fontSize: t.size, fontStyle: { weight: t.weight || 400, slant: t.italic ? 1 : 0 },
    color: Skia.Color(t.color || '#ffffff'), letterSpacing: t.letterSpacing || 0, halfLeading: true,
  };
  if (typeof t.lineHeight === 'number') style.heightMultiplier = t.lineHeight;
  if (t.shadow) style.shadows = [{ color: Skia.Color(t.shadow.color), blurRadius: t.shadow.blur, offset: { x: 0, y: t.shadow.dy || 0 } }];
  b.pushStyle(style);
  b.addText(text);
  b.pop();
  const p = b.build();
  p.layout(width);
  return p;
}
/**
 * The largest font size, at most `size`, at which `text` fits on one line `maxW` wide (never below `min`).
 * Admins write offers like "FLAT 15% OFF", which wrapped at the design's 44 px and ran into the line below.
 */
export function fitOneLine(fm: SkTypefaceFontProvider | null, text: string, maxW: number, t: TextSpec, min = 22): number {
  const p = makePara(fm, text, 100000, t);
  if (!p) return t.size;
  const w = p.getMaxIntrinsicWidth();
  return w <= maxW ? t.size : Math.max(min, Math.floor((t.size * maxW) / w * 10) / 10);
}
export function useParas(fm: SkTypefaceFontProvider | null, items: Array<[string, number, TextSpec]>) {
  return useMemo(() => items.map(([txt, w, t]) => makePara(fm, txt, w, t)), [fm, JSON.stringify(items)]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Ad context ────────────────────────────────────────────────────────────────────────────────────
export type MagicApi = {
  /** Worklet: star burst (the design's magic().burst) or flake/confetti burst (fxLayer().burst: kind 'rect'). */
  burst: (x: number, y: number, n: number, cols: string[], spd?: number, g?: number, sz?: number, kind?: 'star' | 'rect') => void;
  /** Worklet: finger trail glints. */
  trail: (x: number, y: number) => void;
};
export type AdApi = {
  ad: SplashAd;
  stage: Stage;
  art: SkImage | null; // the ad photo (store photo chosen by the admin)
  fm: SkTypefaceFontProvider | null;
  sound: AdSound;
  magic: MagicApi;
  burstJS: (x: number, y: number, n: number, cols: string[], spd?: number, g?: number, sz?: number, kind?: 'star' | 'rect') => void; // JS-thread burst
  wave: (x: number, y: number) => void; // JS
  engaged: SharedValue<number>; // 1 once the person touched the ad (hint, idle bar and ghost go away)
  engage: () => void; // JS
  engageW: () => void; // worklet
  finish: () => void; // JS: close the ad (whoosh, fade) and land on Home
  explore: () => void; // JS: close the ad and open the store
  setAuto: (fn: () => void) => void; // the style's "play the gesture by itself" (tap anywhere / accessibility)
  rustleW: (kind: RustleKind, power: number) => void; // worklet-safe rustle (throttled)
  feedbackW: () => void; // worklet-safe haptic tick + chime (the design's vib(); chime())
};
export const AdCtx = createContext<AdApi | null>(null);
export function useAd(): AdApi {
  const a = useContext(AdCtx);
  if (!a) throw new Error('useAd outside AdSplash');
  return a;
}

/**
 * A recorded picture painted once into an image (w x h px) on a CPU raster surface, on every platform.
 *  - Android: Skia's GPU offscreen render (drawAsImageFromPicture) waits for the UI thread; called while the app
 *    starts up (the ad is prepared under the intro) it froze the whole app on a black screen (1.0.29).
 *  - Web: every GPU offscreen surface opens a new WebGL context and browsers cap them.
 * One CPU pass of a few tens of ms, during the intro, then only this image is drawn.
 */
export function pictureToImage(pic: SkPicture, w: number, h: number): SkImage | null {
  try {
    const surf = Skia.Surface.Make(w, h);
    if (!surf) return null;
    surf.getCanvas().drawPicture(pic);
    surf.flush();
    return surf.makeImageSnapshot();
  } catch {
    return null;
  }
}

/**
 * A static surface (poster, sticker) painted ONCE into a screen-sized image at the phone's pixel density.
 * Drawing that one image is cheap; redrawing the live element (photo, gradients, paragraphs, 5200 grain specks)
 * on every touch move is what made tearing / peeling lag on phones. Null until ready (callers draw the live
 * element meanwhile). Draw it inside the stage transform at x -dx, y -dy, W/k by H/k (ScreenImage below).
 */
export function useSurfaceImage(element: React.ReactElement, key: string): SkImage | null {
  const ad = useAd();
  const [img, setImg] = useState<SkImage | null>(null);
  useEffect(() => {
    let alive = true;
    const s = ad.stage;
    const pr = Math.min(3, PixelRatio.get());
    const w = Math.ceil(s.W * pr);
    const h = Math.ceil(s.H * pr);
    drawAsPicture(
      <AdCtx.Provider value={ad}>
        <Group transform={[{ scale: pr }, ...stageTransform(s)]}>{element}</Group>
      </AdCtx.Provider>,
      Skia.XYWHRect(0, 0, w, h),
    ).then((pic) => { const out = pictureToImage(pic, w, h); if (alive && out) setImg(out); }).catch(() => {});
    return () => { alive = false; };
  }, [key, ad.fm, ad.art, ad.stage.W, ad.stage.H]); // eslint-disable-line react-hooks/exhaustive-deps
  return img;
}
/** A useSurfaceImage result drawn over the whole screen, from inside the stage transform. */
export function ScreenImage({ image }: { image: SkImage }) {
  const { stage: s } = useAd();
  return <SkiaImage image={image} x={-s.dx} y={-s.dy} width={s.W / s.k} height={s.H / s.k} fit="fill" />;
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────
export const clamp = (v: number, a = 0, b = 1) => { 'worklet'; return Math.min(b, Math.max(a, v)); };
export const rnd = (a: number, b: number) => { 'worklet'; return a + Math.random() * (b - a); };
export const easeOutCubic = Easing.bezier(0.33, 1, 0.68, 1);
/** Serpentine auto path (design serp()), in design units (the design's are in 2x canvas units: halved). */
export function serp(y0: number, y1: number, step: number, x0 = 35, x1 = 265): Array<[number, number]> {
  const P: Array<[number, number]> = [];
  let r = 0;
  for (let y = y0; y <= y1; y += step, r++) { P.push(r % 2 ? [x1, y] : [x0, y]); P.push(r % 2 ? [x0, y] : [x1, y]); }
  return P;
}

// ── Full-screen Skia layer in design units ───────────────────────────────────────────────────────
export function DesignCanvas({ children, style, pointerEvents = 'none' }: { children: React.ReactNode; style?: any; pointerEvents?: 'none' | 'auto' | 'box-none' }) {
  const ad = useAd();
  // Skia draws its children with its own React renderer, which does not inherit context: hand the ad on.
  // pointerEvents lives on a plain View: Android's Skia view does not honour it, so a bare full-screen canvas
  // would swallow every touch meant for the gesture layers.
  return (
    <View pointerEvents={pointerEvents} style={StyleSheet.flatten([StyleSheet.absoluteFill, style])}>
      <Canvas style={StyleSheet.absoluteFill}>
        <AdCtx.Provider value={ad}>
          <Group transform={stageTransform(ad.stage)}>{children}</Group>
        </AdCtx.Provider>
      </Canvas>
    </View>
  );
}
/** Absolute RN box placed in design units. */
export function DBox({ x, y, w, h, style, children, pointerEvents }: { x: number; y: number; w: number; h: number; style?: any; children?: React.ReactNode; pointerEvents?: any }) {
  const { stage: s } = useAd();
  return (
    <View pointerEvents={pointerEvents} style={[{ position: 'absolute', left: (x + s.dx) * s.k, top: (y + s.dy) * s.k, width: w * s.k, height: h * s.k }, style]}>
      {children}
    </View>
  );
}

// ── The ad photo, feathered into the background (design feather(): radial mask, solid to `stop`) ─
export function FeatheredArt({ x, y, w, h, stop = 0.62 }: { x: number; y: number; w: number; h: number; stop?: number }) {
  const { art } = useAd();
  if (!art) return null;
  return (
    <Group layer>
      <SkiaImage image={art} x={x} y={y} width={w} height={h} fit="cover" />
      <Rect x={x} y={y} width={w} height={h} blendMode="dstIn">
        <RadialGradient c={vec(x + w / 2, y + h / 2)} r={Math.min(w, h) / 2} colors={['#000', '#000', 'transparent']} positions={[0, stop, 1]} />
      </Rect>
    </Group>
  );
}

// ── Spinning light rays (repeating conic gradient, radial-masked, screen blend) ────────────────────
function rayStops(on: string, period: number, lit: number) {
  const colors: string[] = [];
  const pos: number[] = [];
  for (let a = 0; a < 360; a += period) {
    colors.push(on, on, 'transparent', 'transparent');
    pos.push(a / 360, (a + lit) / 360, (a + lit) / 360, Math.min(1, (a + period) / 360));
  }
  return { colors, pos };
}
export function Rays({ cx, cy, size, color = 'rgba(255,226,150,0.42)', period = 15, lit = 5, inner = 0.08, outer = 0.66, secs = 26, opacity }: {
  cx: number; cy: number; size: number; color?: string; period?: number; lit?: number; inner?: number; outer?: number; secs?: number; opacity?: SharedValue<number> | number;
}) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(Math.PI * 2, { duration: secs * 1000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rot);
  }, [secs]); // eslint-disable-line react-hooks/exhaustive-deps
  const tr = useDerivedValue(() => [{ rotate: rot.value }]);
  const { colors, pos } = useMemo(() => rayStops(color, period, lit), [color, period, lit]);
  const r = size / 2;
  return (
    <Group layer blendMode="screen" opacity={opacity as any}>
      <Group origin={vec(cx, cy)} transform={tr}>
        <Circle cx={cx} cy={cy} r={r}>
          <SweepGradient c={vec(cx, cy)} colors={colors} positions={pos} />
        </Circle>
      </Group>
      <Circle cx={cx} cy={cy} r={r} blendMode="dstIn">
        <RadialGradient c={vec(cx, cy)} r={r} colors={['#000', '#000', 'transparent']} positions={[0, inner, outer]} />
      </Circle>
    </Group>
  );
}

// ── Stardust + confetti (design magic() and fxLayer()), one Skia picture redrawn per frame ─────────
type Part = { x: number; y: number; vx: number; vy: number; g: number; l: number; l0: number; s: number; r: number; vr: number; c: string; rect: boolean };
type Glint = { x: number; y: number; r: number; vy: number; ph: number; sp: number };
export function useMagicLayer(stage: Stage, active: SharedValue<number>) {
  const parts = useSharedValue<Part[]>([]);
  const amb = useSharedValue<Glint[]>(Array.from({ length: 26 }, () => ({ x: Math.random() * DW, y: Math.random() * DH, r: 0.6 + Math.random() * 1.2, vy: -(0.08 + Math.random() * 0.22), ph: Math.random() * 6.28, sp: 0.02 + Math.random() * 0.03 })));
  const frame = useSharedValue(0);
  // One unit 4-point star (radius 1), built once and drawn scaled per particle: building a fresh path for every
  // particle on every frame was the stardust's main cost on phones.
  const star = useMemo(() => {
    const path = Skia.Path.Make();
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4; const rr = k % 2 ? 0.28 : 1;
      if (k === 0) path.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr); else path.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    path.close();
    return path;
  }, []);
  useFrameCallback(() => {
    if (!active.value) return;
    parts.modify((ps) => {
      'worklet';
      const out: Part[] = [];
      for (const p of ps) {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.l -= 1; p.r += p.vr;
        if (p.l > 0 && p.y < DH + 20) out.push(p);
      }
      return out;
    });
    amb.modify((as) => {
      'worklet';
      for (const a of as) { a.y += a.vy; a.ph += a.sp; if (a.y < -4) { a.y = DH + 4; a.x = Math.random() * DW; } }
      return as;
    });
    frame.value += 1;
  });
  const picture = useDerivedValue(() => {
    frame.value; // redraw every frame
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, stage.W, stage.H));
    c.translate(stage.dx * stage.k, stage.dy * stage.k);
    c.scale(stage.k, stage.k);
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setBlendMode(BlendMode.Plus); // 'lighter'
    paint.setColor(Skia.Color('#ffe7a8'));
    for (const a of amb.value) {
      paint.setAlphaf(0.2 + 0.5 * Math.abs(Math.sin(a.ph)));
      c.drawCircle(a.x, a.y, a.r, paint);
    }
    for (const p of parts.value) {
      paint.setColor(Skia.Color(p.c));
      if (p.rect) {
        paint.setBlendMode(BlendMode.SrcOver); // confetti / flakes
        paint.setAlphaf(Math.min(1, p.l / 18));
        c.save(); c.translate(p.x, p.y); c.rotate((p.r * 180) / Math.PI, 0, 0);
        c.drawRect(Skia.XYWHRect(-p.s, -p.s / 2, p.s * 2, p.s), paint);
        c.restore();
      } else {
        paint.setBlendMode(BlendMode.Plus);
        paint.setAlphaf(Math.min(1, p.l / p.l0) * (0.65 + 0.35 * Math.sin(p.l * 0.6)));
        c.save(); c.translate(p.x, p.y); c.rotate((p.r * 180) / Math.PI, 0, 0); c.scale(p.s, p.s);
        c.drawPath(star, paint);
        c.restore();
      }
    }
    return rec.finishRecordingAsPicture();
  });
  const magic: MagicApi = useMemo(() => ({
    burst: (x, y, n, cols, spd = 4, g = 0.06, sz = 5, kind = 'star') => {
      'worklet';
      parts.modify((ps) => {
        'worklet';
        for (let i = 0; i < n && ps.length < 160; i++) {
          const a = Math.random() * 6.283;
          if (kind === 'rect') {
            const v = Math.random() * spd;
            ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.45, g, l: 40 + Math.random() * 34, l0: 74, s: 1.4 + Math.random() * 2.6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length], rect: true });
          } else {
            const v = (0.3 + Math.random() * 0.7) * spd; const l = 34 + Math.random() * 36;
            ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g, l, l0: l, s: 2 + Math.random() * (sz - 2), r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length], rect: false });
          }
        }
        return ps;
      });
    },
    trail: (x, y) => {
      'worklet';
      parts.modify((ps) => {
        'worklet';
        const cols = ['#fff6d6', '#ffd36b', '#ffffff'];
        // one glint per call (was two), and never past 160 live particles: a lighter trail, less touch latency
        for (let i = 0; i < 1 && ps.length < 160; i++) {
          const l = 18 + Math.random() * 14;
          ps.push({ x: x + (Math.random() - 0.5) * 10, y: y + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5), vy: -0.6 + Math.random() * 0.8, g: 0.02, l, l0: l, s: 2 + Math.random() * 2.5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % 3], rect: false });
        }
        return ps;
      });
    },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return { picture, magic };
}
export function MagicCanvas({ picture }: { picture: SharedValue<any> }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 21 }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

// ── Expanding golden ring (design .wave) ───────────────────────────────────────────────────────────
export function WaveRing({ x, y, onEnd }: { x: number; y: number; onEnd: () => void }) {
  const { stage: s } = useAd();
  const t = useSharedValue(0);
  useEffect(() => { t.value = withTiming(1, { duration: 850, easing: Easing.out(Easing.quad) }, (f) => { if (f) runOnJS(onEnd)(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 21 * t.value }], opacity: 1 - t.value, borderWidth: (3 - 2 * t.value) / (1 + 21 * t.value) * s.k }));
  const d = 20 * s.k;
  return (
    <Animated.View pointerEvents="none" style={[{
      position: 'absolute', zIndex: 22, left: (x + s.dx) * s.k - d / 2, top: (y + s.dy) * s.k - d / 2, width: d, height: d, borderRadius: d,
      borderColor: 'rgba(255,231,168,0.95)', shadowColor: '#ffd666', shadowOpacity: 0.85, shadowRadius: 12,
    }, st]} />
  );
}

// ── Hint, ghost finger, idle bar, Skip ────────────────────────────────────────────────────────────
export function Hint({ text }: { text: string }) {
  const { stage: s, engaged } = useAd();
  const pulse = useSharedValue(0);
  useEffect(() => { pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false); return () => cancelAnimation(pulse); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const wrap = useAnimatedStyle(() => ({ opacity: withTiming(engaged.value ? 0 : 0.92, { duration: 250 }) }));
  const ring = useAnimatedStyle(() => {
    const p = pulse.value;
    const sc = p < 0.6 ? 0.8 + (0.35 * p) / 0.6 : 1.15 + (0.15 * (p - 0.6)) / 0.4;
    const op = p < 0.6 ? 0.4 + (0.6 * p) / 0.6 : 1 - (p - 0.6) / 0.4;
    return { transform: [{ scale: sc }], opacity: op };
  });
  const d = 30 * s.k;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', zIndex: 12, left: 0, right: 0, bottom: (22 + s.dy) * s.k, alignItems: 'center', gap: 2 * s.k }, wrap]}>
      <Animated.View style={[{ width: d, height: d, borderRadius: d, borderWidth: 2 * s.k, borderColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' }, ring]}>
        <View style={{ width: d - 16 * s.k - 4 * s.k, height: d - 16 * s.k - 4 * s.k, borderRadius: d, backgroundColor: '#fff' }} />
      </Animated.View>
      <Text style={[st.hintText, { fontSize: 12.5 * s.k, marginTop: 4 * s.k }]}>{text}</Text>
      <Text style={[st.hintSmall, { fontSize: 10.5 * s.k }]}>or just tap</Text>
    </Animated.View>
  );
}

/** Ghost finger that shows the gesture until the person touches the ad (1.8 s move, 1 s pause, repeat). */
export function Ghost({ path }: { path: Array<[number, number]> }) {
  const { stage: s, engaged, magic } = useAd();
  const t0 = useSharedValue(-1);
  const pos = useSharedValue({ x: path[0][0], y: path[0][1], o: 0, sc: 0.9 });
  useFrameCallback((f) => {
    if (engaged.value) { if (pos.value.o !== 0) pos.value = { ...pos.value, o: 0 }; return; }
    if (t0.value < 0) t0.value = f.timestamp;
    const dur = 1800; const pause = 1000; const k = (f.timestamp - t0.value) % (dur + pause);
    if (k > dur) { pos.value = { ...pos.value, o: 0 }; return; }
    const u = k / dur; const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const seg = e * (path.length - 1); const i = Math.min(path.length - 2, Math.floor(seg)); const r = seg - i;
    const x = path[i][0] + (path[i + 1][0] - path[i][0]) * r; const y = path[i][1] + (path[i + 1][1] - path[i][1]) * r;
    pos.value = { x, y, o: u < 0.1 ? u / 0.1 : u > 0.9 ? (1 - u) / 0.1 : 1, sc: 0.9 + 0.1 * Math.sin(u * Math.PI) };
    if (u > 0.08 && u < 0.92) magic.trail(x, y);
  });
  const d = 44 * s.k;
  const style = useAnimatedStyle(() => ({
    opacity: pos.value.o,
    transform: [{ translateX: (pos.value.x + s.dx) * s.k - d / 2 }, { translateY: (pos.value.y + s.dy) * s.k - d / 2 }, { scale: pos.value.sc }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', zIndex: 45, left: 0, top: 0, width: d, height: d, borderRadius: d, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 9, shadowOffset: { width: 0, height: 8 } }, style]}>
      <View style={{ width: d * 0.55, height: d * 0.55, borderRadius: d, backgroundColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: d * 0.27, height: d * 0.27, borderRadius: d, backgroundColor: 'rgba(255,255,255,0.95)' }} />
      </View>
    </Animated.View>
  );
}

/** 10 s bar under the status bar; an untouched ad closes when it runs out (design .idle). */
export function IdleBar({ onTimeout }: { onTimeout: () => void }) {
  const { stage: s, engaged } = useAd();
  const p = useSharedValue(1);
  useEffect(() => {
    p.value = withTiming(0, { duration: 10000, easing: Easing.linear }, (done) => { if (done) runOnJS(onTimeout)(); });
    return () => cancelAnimation(p);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const wrap = useAnimatedStyle(() => ({ opacity: engaged.value ? 0 : 1 }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: p.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', zIndex: 39, left: (14 + s.dx) * s.k, right: (64 + s.dx) * s.k, top: (40 + s.dy) * s.k, height: 3 * s.k, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' }, wrap]}>
      <Animated.View style={[{ flex: 1, backgroundColor: 'rgba(255,255,255,0.85)', transformOrigin: 'left' } as any, bar]} />
    </Animated.View>
  );
}

export function SkipButton({ onPress }: { onPress: () => void }) {
  const { stage: s } = useAd();
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip ad"
      style={{ position: 'absolute', zIndex: 40, top: (30 + s.dy) * s.k, right: (14 + s.dx) * s.k, backgroundColor: 'rgba(0,0,0,0.42)', paddingVertical: 5 * s.k, paddingHorizontal: 11 * s.k, borderRadius: 99 }}>
      <Text style={{ color: '#fff', fontFamily: RNFONT.body700, fontSize: 11 * s.k }}>Skip ›</Text>
    </Pressable>
  );
}

/** Pill button (design .cta, .cta.y = yellow). */
export function Cta({ label, onPress, yellow = true, style, fontSize = 13, padV = 11, padH = 26 }: { label: string; onPress: () => void; yellow?: boolean; style?: any; fontSize?: number; padV?: number; padH?: number }) {
  const { stage: s } = useAd();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [{ backgroundColor: yellow ? '#f4c430' : '#1f9d5c', borderRadius: 99, paddingVertical: padV * s.k, paddingHorizontal: padH * s.k, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 6 }, elevation: 6, opacity: pressed ? 0.85 : 1 }, style]}>
      <Text style={{ color: yellow ? '#2a1c00' : '#fff', fontFamily: RNFONT.body700, fontSize: fontSize * s.k }}>{label}</Text>
    </Pressable>
  );
}

// ── Progress gesture (design prog(): finger maps to 0..1; tap or past the threshold completes) ──
export function useProgressGesture(o: {
  map: (dx: number, dy: number) => number; // worklet, design units
  th?: number; ms?: number; sound?: RustleKind;
  after?: () => void; // JS, after completion feedback
}) {
  const ad = useAd();
  const p = useSharedValue(0);
  const fin = useSharedValue(0);
  const last = useSharedValue({ x: 0, y: 0, t: 0, moved: 0 });
  const after = useRef(o.after);
  after.current = o.after;
  const runAfter = () => { after.current?.(); };
  const go = () => {
    'worklet';
    if (fin.value) return;
    fin.value = 1;
    p.value = withTiming(1, { duration: o.ms || 600, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) { ad.feedbackW(); runOnJS(runAfter)(); }
    });
  };
  const goJS = () => { ad.engage(); runOnUI(go)(); };
  useEffect(() => { ad.setAuto(goJS); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const k = ad.stage.k;
  const gesture = useMemo(() => Gesture.Pan().minDistance(0)
    .onBegin((e) => { last.value = { x: e.x, y: e.y, t: Date.now(), moved: 0 }; runOnJS(ad.engage)(); })
    .onUpdate((e) => {
      if (fin.value) return;
      const sp = Math.hypot(e.x - last.value.x, e.y - last.value.y) / k;
      last.value = { x: e.x, y: e.y, t: last.value.t, moved: last.value.moved + sp };
      p.value = clamp(o.map(e.translationX / k, e.translationY / k));
      if (sp > 1.5) ad.rustleW(o.sound || 'paper', sp / 14);
      ad.magic.trail(e.x / k - ad.stage.dx, e.y / k - ad.stage.dy);
    })
    .onFinalize(() => {
      if (fin.value) return;
      const tap = last.value.moved < 8 && Date.now() - last.value.t < 450;
      if (tap || p.value > (o.th ?? 0.4)) go();
      else p.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    }), [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return { p, gesture, done: fin };
}

const st = StyleSheet.create({
  hintText: { color: '#fff', fontFamily: RNFONT.body700, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8 },
  hintSmall: { color: 'rgba(255,255,255,0.8)', fontFamily: RNFONT.body500, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8 },
});

export { absoluteImage, useImage, Paragraph, LinearGradient, withDelay, withSequence };
