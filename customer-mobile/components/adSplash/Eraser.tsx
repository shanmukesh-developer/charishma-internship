// Erasable surface (design eraser()): torn paper, silver scratch foil, fogged glass. The finger (or the
// auto path after a tap) stamps holes into a painted Skia layer; when `need` of the 30 x 62 coverage grid
// is cleared the surface is revealed. Everything runs on the UI thread; design units throughout.
import React, { useEffect, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, runOnUI, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { BlurMask, BlurStyle, Canvas, Group, Image, PaintStyle, Path, Skia, type SkImage, type SkPath } from '@shopify/react-native-skia';
import { AdCtx, DH, DW, rnd, stageTransform, useAd } from './kit';
import type { RustleKind } from './adSound';

const GX = 30;
const GY = 62;
const CELL = 10;
const BAKE_EVERY = 12; // stamps kept as live vector paths before they are baked into the mask images

/**
 * Off-screen CPU canvases the finished strokes are baked into (design units scaled by S, covering the whole
 * screen, not just the design box). Drawing a path that keeps growing (hundreds of overlapping circles, plus
 * a blur for glass) made the phone re-rasterise a full-screen mask every frame, slower with every stroke:
 * tear dropped to 25 fps with 300 ms stalls and glass to 22 fps. Now each frame draws two images plus at most
 * BAKE_EVERY stamps of live path, and baking only paints the new circles.
 */
function useMasks(kind: StampKind, stage: { W: number; H: number; k: number; dx: number; dy: number }) {
  return useMemo(() => {
    // Mask pixels per design unit. Glass holes are blurred (sigma 9 units), so a coarse mask looks the same and
    // keeps each bake (blur + snapshot + upload) small: at the tear resolution the glass wipe fell to ~25 fps.
    const S = Math.min(2.4, stage.k * PixelRatio.get() * 0.6) * (kind === 'glass' ? 0.4 : 1);
    const ew = stage.W / stage.k; const eh = stage.H / stage.k; // the screen in design units
    const w = Math.max(1, Math.ceil(ew * S)); const h = Math.max(1, Math.ceil(eh * S));
    const hole = Skia.Surface.Make(w, h);
    const rim = kind === 'tear' ? Skia.Surface.Make(w, h) : null;
    const holePaint = Skia.Paint(); holePaint.setAntiAlias(true); holePaint.setColor(Skia.Color('black'));
    if (kind === 'glass') holePaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 9, true));
    const rimPaint = Skia.Paint(); rimPaint.setAntiAlias(true); rimPaint.setColor(Skia.Color('#f4ead2'));
    const fibrePaint = Skia.Paint(); fibrePaint.setAntiAlias(true); fibrePaint.setColor(Skia.Color('rgba(255,255,255,0.75)'));
    fibrePaint.setStyle(PaintStyle.Stroke); fibrePaint.setStrokeWidth(0.7);
    return {
      S, ox: stage.dx, oy: stage.dy, ew, eh, hole, rim, holePaint, rimPaint, fibrePaint,
      blankHole: hole ? hole.makeImageSnapshot() : null, blankRim: rim ? rim.makeImageSnapshot() : null,
    };
  }, [kind, stage.W, stage.H, stage.k, stage.dx, stage.dy]);
}

export type StampKind = 'tear' | 'scratch' | 'glass';

export function Eraser({ surface, kind, need, gap, r, sound, autoPath, refog = false, fx, exit, onReveal }: {
  surface: React.ReactNode; // Skia elements painting the surface in design units
  kind: StampKind;
  need: number; // share of the grid to clear
  gap: number; // stamp spacing along a stroke
  r: number; // coverage radius
  sound: RustleKind;
  autoPath: Array<[number, number]>;
  refog?: boolean; // glass: fog creeps back after 1.2 s without wiping
  fx?: { cols: string[]; spd: number; g: number }; // flakes thrown while erasing (30 % of stamps)
  exit: 'fall' | 'fade'; // tear: the paper drops away; foil / glass: fade
  onReveal: () => void; // JS, once
}) {
  const ad = useAd();
  const { stage } = ad;
  const k = stage.k;
  const edges = useSharedValue<SkPath>(Skia.Path.Make()); // tear: paper rim
  const fibres = useSharedValue<SkPath>(Skia.Path.Make()); // tear: white fibres on the rim
  const holes = useSharedValue<SkPath>(Skia.Path.Make());
  const curA = useSharedValue(1);
  const prevA = useSharedValue(0);
  const cells = useSharedValue<number[]>(new Array(GX * GY).fill(0));
  const hit = useSharedValue(0);
  const shown = useSharedValue(0);
  const busy = useSharedValue(0);
  const last = useSharedValue({ x: 0, y: 0, t: 0, moved: 0, lastMove: 0 });
  const auto = useSharedValue({ on: 0, dist: 0, prevX: 0, prevY: 0, t: 0 });
  const out = useSharedValue(0);
  const masks = useMasks(kind, stage);
  const holeImg = useSharedValue<SkImage | null>(masks.blankHole);
  const rimImg = useSharedValue<SkImage | null>(masks.blankRim);
  const prevImg = useSharedValue<SkImage | null>(masks.blankHole); // glass: the older wipe fading back to fog
  const pending = useSharedValue(0);
  // Once revealed the surface stops taking touches, so the offer's buttons underneath work.
  const [revealed, setRevealed] = useState(false);
  const revealedJS = () => { setRevealed(true); onReveal(); };

  const reveal = () => {
    'worklet';
    if (shown.value) return;
    shown.value = 1;
    ad.feedbackW();
    out.value = withTiming(1, { duration: exit === 'fall' ? 750 : 500, easing: exit === 'fall' ? Easing.bezier(0.55, 0, 0.9, 0.45) : Easing.linear });
    runOnJS(revealedJS)();
  };

  /** Paints the live paths into the mask images and empties them (cheap: only the new circles are drawn). */
  const bake = () => {
    'worklet';
    if (!pending.value) return;
    pending.value = 0;
    const m = masks;
    if (m.rim) {
      const c = m.rim.getCanvas();
      c.save(); c.scale(m.S, m.S); c.translate(m.ox, m.oy);
      c.drawPath(edges.value, m.rimPaint); c.drawPath(fibres.value, m.fibrePaint);
      c.restore(); m.rim.flush();
      rimImg.value = m.rim.makeImageSnapshot();
      edges.value = Skia.Path.Make(); fibres.value = Skia.Path.Make();
    }
    if (m.hole) {
      const c = m.hole.getCanvas();
      c.save(); c.scale(m.S, m.S); c.translate(m.ox, m.oy);
      c.drawPath(holes.value, m.holePaint);
      c.restore(); m.hole.flush();
      holeImg.value = m.hole.makeImageSnapshot();
      holes.value = Skia.Path.Make();
    }
  };

  // One finger move = one update of each path and of the grid (each .modify() redraws the canvas, so per-stamp
  // updates meant several full redraws per frame on a phone). Tear stamps use 3 rim / 3 hole circles (was 4 / 4)
  // at a wider spacing: the same ragged edge for far less path work.
  const stampAll = (pts: number[]) => {
    'worklet';
    const R = r;
    if (kind === 'tear') {
      edges.modify((p) => { 'worklet'; for (let k = 0; k < pts.length; k += 2) for (let q = 0; q < 3; q++) p.addCircle(pts[k] + rnd(-7, 7), pts[k + 1] + rnd(-7, 7), R + 4 + rnd(0, 4.5)); return p; });
      fibres.modify((p) => {
        'worklet';
        for (let k = 0; k < pts.length; k += 2) for (let q = 0; q < 2; q++) {
          const a = rnd(0, 6.28); const r0 = R + rnd(1.5, 6); const a2 = a + rnd(-0.3, 0.3); const r1 = r0 + rnd(2, 5);
          p.moveTo(pts[k] + Math.cos(a) * r0, pts[k + 1] + Math.sin(a) * r0); p.lineTo(pts[k] + Math.cos(a2) * r1, pts[k + 1] + Math.sin(a2) * r1);
        }
        return p;
      });
      holes.modify((p) => { 'worklet'; for (let k = 0; k < pts.length; k += 2) for (let q = 0; q < 3; q++) p.addCircle(pts[k] + rnd(-5, 5), pts[k + 1] + rnd(-5, 5), R + rnd(-3.5, 2)); return p; });
    } else if (kind === 'scratch') {
      holes.modify((p) => { 'worklet'; for (let k = 0; k < pts.length; k += 2) for (let q = 0; q < 3; q++) { const a = rnd(0, 6.28); const d = rnd(0, 7); p.addCircle(pts[k] + Math.cos(a) * d, pts[k + 1] + Math.sin(a) * d, rnd(15, 21)); } return p; });
    } else {
      holes.modify((p) => { 'worklet'; for (let k = 0; k < pts.length; k += 2) p.addCircle(pts[k], pts[k + 1], 26); return p; });
    }
    // coverage grid, once
    const rr = R * 0.85;
    let add = 0;
    cells.modify((c) => {
      'worklet';
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k]; const y = pts[k + 1];
        const x0 = Math.max(0, Math.floor((x - rr) / CELL)); const x1 = Math.min(GX - 1, Math.floor((x + rr) / CELL));
        const y0 = Math.max(0, Math.floor((y - rr) / CELL)); const y1 = Math.min(GY - 1, Math.floor((y + rr) / CELL));
        for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
          if (!c[j * GX + i] && Math.hypot(i * CELL + CELL / 2 - x, j * CELL + CELL / 2 - y) <= rr) { c[j * GX + i] = 1; add++; }
        }
      }
      return c;
    }, false);
    hit.value += add;
    pending.value += pts.length / 2;
    if (pending.value >= BAKE_EVERY) bake();
    if (fx) for (let k = 0; k < pts.length; k += 2) if (Math.random() < 0.3) ad.magic.burst(pts[k], pts[k + 1], 2, fx.cols, fx.spd, fx.g, 5, 'rect');
  };

  const seg = (ax: number, ay: number, bx: number, by: number) => {
    'worklet';
    if (refog && curA.value < 0.98) {
      // Wiping again after the fog started to return: the old wipe keeps fading, this one starts clear.
      bake();
      prevImg.value = holeImg.value; prevA.value = curA.value;
      if (masks.hole) { masks.hole.getCanvas().clear(Skia.Color('transparent')); masks.hole.flush(); holeImg.value = masks.hole.makeImageSnapshot(); }
      holes.value = Skia.Path.Make(); curA.value = 1;
    }
    last.value = { ...last.value, lastMove: Date.now() };
    const d = Math.hypot(bx - ax, by - ay); const n = Math.max(1, Math.ceil(d / gap));
    const pts: number[] = [];
    for (let i = 1; i <= n; i++) pts.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n);
    stampAll(pts);
    ad.rustleW(sound, d / 11);
    if (!shown.value && hit.value / (GX * GY) > need) reveal();
  };

  // Tap = the gesture plays itself along the auto path (design auto(): 3.2 canvas px/ms = 1.6 design units/ms).
  const startAuto = () => {
    'worklet';
    if (busy.value || shown.value) return;
    busy.value = 1;
    auto.value = { on: 1, dist: 0, prevX: autoPath[0][0], prevY: autoPath[0][1], t: 0 };
  };
  useEffect(() => { ad.setAuto(() => { ad.engage(); runOnUI(startAuto)(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrameCallback((f) => {
    // auto play
    if (auto.value.on && !shown.value) {
      const a = auto.value; const now = f.timestamp; const dt = a.t ? Math.min(40, now - a.t) : 16;
      let dist = a.dist + dt * 1.6; let i = 0; let d = dist;
      const S: number[] = [];
      for (let q = 1; q < autoPath.length; q++) S.push(Math.hypot(autoPath[q][0] - autoPath[q - 1][0], autoPath[q][1] - autoPath[q - 1][1]));
      while (i < S.length && d > S[i]) { d -= S[i]; i++; }
      if (i >= S.length) { reveal(); auto.value = { ...a, on: 0 }; }
      else {
        const t = d / S[i]; const cx = autoPath[i][0] + (autoPath[i + 1][0] - autoPath[i][0]) * t; const cy = autoPath[i][1] + (autoPath[i + 1][1] - autoPath[i][1]) * t;
        seg(a.prevX, a.prevY, cx, cy); ad.magic.trail(cx, cy);
        auto.value = { on: 1, dist, prevX: cx, prevY: cy, t: now };
      }
    }
    // glass: the fog comes back after 1.2 s without wiping (4 % per 110 ms, cells re-fog at 2 %)
    if (refog && !shown.value && !busy.value && Date.now() - last.value.lastMove > 1200 && f.timestamp % 110 < 17) {
      if (hit.value > 0) {
        curA.value = curA.value * 0.96; prevA.value = prevA.value * 0.96;
        let lost = 0;
        cells.modify((c) => { 'worklet'; for (let i = 0; i < c.length; i++) if (c[i] && Math.random() < 0.02) { c[i] = 0; lost++; } return c; });
        hit.value -= lost;
      }
    }
  });

  const pan = Gesture.Pan().minDistance(0)
    .onBegin((e) => {
      ad.engageW();
      last.value = { x: e.x / k - stage.dx, y: e.y / k - stage.dy, t: Date.now(), moved: 0, lastMove: Date.now() };
    })
    .onUpdate((e) => {
      if (shown.value || busy.value) return;
      const x = e.x / k - stage.dx; const y = e.y / k - stage.dy; const L = last.value;
      seg(L.x, L.y, x, y);
      last.value = { ...last.value, x, y, moved: L.moved + Math.hypot(x - L.x, y - L.y) };
      ad.magic.trail(x, y);
    })
    .onFinalize(() => {
      bake();
      const L = last.value;
      if (!shown.value && L.moved < 8 && Date.now() - L.t < 450) startAuto();
    });

  const layerStyle = useAnimatedStyle(() => exit === 'fall'
    ? { opacity: 1 - out.value, transform: [{ translateX: 26 * k * out.value }, { translateY: 540 * k * out.value }, { rotate: `${9 * out.value}deg` }] }
    : { opacity: 1 - out.value });

  return (
    <GestureDetector gesture={pan}>
      <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents={revealed ? 'none' : 'auto'}>
        <Animated.View style={[StyleSheet.absoluteFill, layerStyle, kind === 'tear' ? styles.tornShadow : null]} pointerEvents="none">
          <Canvas style={StyleSheet.absoluteFill}>
            {/* Skia's renderer does not inherit React context: hand the ad to the painted surface. */}
            <AdCtx.Provider value={ad}>
            <Group transform={stageTransform(stage)}>
              <Group layer>
                {surface}
                {kind === 'tear' ? <Image image={rimImg} x={-masks.ox} y={-masks.oy} width={masks.ew} height={masks.eh} fit="fill" blendMode="srcATop" /> : null}
                {kind === 'tear' ? <Path path={edges} color="#f4ead2" blendMode="srcATop" /> : null}
                {kind === 'tear' ? <Path path={fibres} color="rgba(255,255,255,0.75)" style="stroke" strokeWidth={0.7} blendMode="srcATop" /> : null}
                {refog ? <Image image={prevImg} x={-masks.ox} y={-masks.oy} width={masks.ew} height={masks.eh} fit="fill" blendMode="dstOut" opacity={prevA} /> : null}
                <Image image={holeImg} x={-masks.ox} y={-masks.oy} width={masks.ew} height={masks.eh} fit="fill" blendMode="dstOut" opacity={refog ? curA : 1} />
                <Path path={holes} color="black" blendMode="dstOut" opacity={refog ? curA : 1}>
                  {kind === 'glass' ? <BlurMask blur={9} style="normal" /> : null}
                </Path>
              </Group>
            </Group>
            </AdCtx.Provider>
          </Canvas>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export const ERASER_SIZE = { w: DW, h: DH };

const styles = StyleSheet.create({
  tornShadow: { shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 10 } },
});
