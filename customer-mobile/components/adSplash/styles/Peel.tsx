// 8. Peel to Reveal (design peel()): a red sticker covers the whole screen with its bottom-right corner
// already curled. Dragging up-left peels it: the sticker is what is left of the half-plane x + y <= c,
// the peeled part folds over as a cream flap (that part mirrored across the fold line x + y = c, kept on
// screen, with a drop shadow), a shade darkens Home just past the fold, and a rainbow holographic sheen
// runs along the sticker next to the fold. The style is transparent, so Home is what shows where the
// sticker has come off; once it is peeled away the ad closes onto Home.
//
// The geometry is the design's clipPoly / clipRect ported to UI-thread worklets, drawn as Skia paths, and
// it spans the whole screen (the design units of the stage plus any letterbox margin), so the sticker
// covers every edge on any aspect ratio. Its CSS 135deg gradients all reduce to t = (x + y) / (W + H).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { Group, LinearGradient, Path, Rect, Shadow, Skia, vec, type SkPath } from '@shopify/react-native-skia';
import { StickerArt } from '../Poster';
import { DesignCanvas, DH, DW, ScreenImage, useAd, useProgressGesture, useSurfaceImage } from '../kit';
import type { StyleDef } from './types';

const DESIGN_T = DW + DH; // the design's T, used for the finger map

type Pt = [number, number];

/** Sutherland-Hodgman against the half-plane a*u + b*v + c0 >= 0 (design clipPoly with a linear keep). */
function clipHalf(poly: Pt[], a: number, b: number, c0: number): Pt[] {
  'worklet';
  const out: Pt[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const A = poly[i]; const B = poly[(i + 1) % n];
    const fa = a * A[0] + b * A[1] + c0; const fb = a * B[0] + b * B[1] + c0;
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
  }
  return out;
}
/** design clipRect: keep the part of `poly` on the w x h screen. */
function clipRect(poly: Pt[], w: number, h: number): Pt[] {
  'worklet';
  let acc = poly;
  if (acc.length) acc = clipHalf(acc, 1, 0, 0);
  if (acc.length) acc = clipHalf(acc, -1, 0, w);
  if (acc.length) acc = clipHalf(acc, 0, 1, 0);
  if (acc.length) acc = clipHalf(acc, 0, -1, h);
  return acc;
}
/** Polygon (screen-local u, v) -> Skia path in design units. */
function toPath(poly: Pt[], ox: number, oy: number): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (poly.length < 3) return path;
  path.moveTo(poly[0][0] + ox, poly[0][1] + oy);
  for (let i = 1; i < poly.length; i++) path.lineTo(poly[i][0] + ox, poly[i][1] + oy);
  path.close();
  return path;
}

function Peel() {
  const { stage, finish, ad } = useAd();
  // The sticker face painted once into an image (the peel redraws it every frame).
  const sticker = useSurfaceImage(<StickerArt />, `peel-${ad.id}`);
  // The screen in design units: origin (ox, oy), size SW x SH (equals 300 x 620 when there is no letterbox).
  const ox = -stage.dx; const oy = -stage.dy;
  const SW = DW + 2 * stage.dx; const SH = DH + 2 * stage.dy;
  const TT = SW + SH;
  // The poster is scaled about its centre to cover the screen (cover fit), so no edge of it ever shows.
  const cover = Math.max(SW / DW, SH / DH);

  const { p, gesture } = useProgressGesture({
    map: (dx, dy) => { 'worklet'; return -(dx + dy) / (DESIGN_T - 40); },
    th: 0.28, ms: 900, sound: 'paper', after: finish,
  });

  // fold line u + v = c: 40 units in from the corner at rest, the top-left corner when fully peeled
  const fold = useDerivedValue(() => TT - (40 + p.value * (TT - 40)));
  const screenPoly = (): Pt[] => { 'worklet'; return [[0, 0], [SW, 0], [SW, SH], [0, SH]]; };
  const stickerPath = useDerivedValue(() => toPath(clipHalf(screenPoly(), -1, -1, fold.value), ox, oy));
  const shadePath = useDerivedValue(() => toPath(clipHalf(screenPoly(), 1, 1, -fold.value), ox, oy));
  const flapPath = useDerivedValue(() => {
    const c = fold.value;
    const Q = clipHalf(screenPoly(), 1, 1, -c);
    const F: Pt[] = Q.map((q) => [c - q[1], c - q[0]] as Pt); // mirrored across the fold
    return toPath(clipRect(F, SW, SH), ox, oy);
  });

  // point on the screen diagonal where the 135deg gradient is at t (0..1 of W + H)
  const diag = (t: number) => { 'worklet'; return vec(ox + (t * TT) / 2, oy + (t * TT) / 2); };
  // .flap: linear-gradient(135deg, #fffaf0 a%, #eadfc6 m%, #9d8c66 e%) - a = tip, e = fold, m always 70 % of the way
  const flapStart = useDerivedValue(() => diag((2 * fold.value - TT) / TT));
  const flapEnd = useDerivedValue(() => diag(fold.value / TT));
  // .pshade: linear-gradient(135deg, rgba(0,0,0,.5) e%, transparent e+7%)
  const shadeStart = useDerivedValue(() => diag(fold.value / TT));
  const shadeEnd = useDerivedValue(() => diag(fold.value / TT + 0.07));
  // .sticker::after (overlay): rainbow from sh-38% to sh%, sh = e
  const sheenStart = useDerivedValue(() => diag(fold.value / TT - 0.38));
  const sheenEnd = useDerivedValue(() => diag(fold.value / TT));

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        <DesignCanvas>
          {/* the sticker: poster on the red linear background, clipped to x + y <= c */}
          <Group clip={stickerPath}>
            <Group origin={vec(DW / 2, DH / 2)} transform={[{ scale: cover }]}>
              {sticker ? <ScreenImage image={sticker} /> : <StickerArt />}
            </Group>
            <Rect x={ox} y={oy} width={SW} height={SH} blendMode="overlay">
              <LinearGradient
                start={sheenStart} end={sheenEnd} flags={1}
                colors={['rgba(0,0,0,0)', 'rgba(255,80,160,0.55)', 'rgba(255,230,90,0.6)', 'rgba(80,255,200,0.55)', 'rgba(90,150,255,0.5)', 'rgba(0,0,0,0)']}
                positions={[0, 9 / 38, 18 / 38, 26 / 38, 33 / 38, 1]}
              />
            </Rect>
          </Group>

          {/* shade on Home just past the fold */}
          <Path path={shadePath}>
            <LinearGradient start={shadeStart} end={shadeEnd} colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} />
          </Path>

          {/* the folded flap with its drop shadow (drop-shadow(-3px -3px 5px rgba(0,0,0,.45))) */}
          <Path path={flapPath}>
            <LinearGradient start={flapStart} end={flapEnd} colors={['#fffaf0', '#eadfc6', '#9d8c66']} positions={[0, 0.7, 1]} />
            <Shadow dx={-3} dy={-3} blur={2.5} color="rgba(0,0,0,0.45)" />
          </Path>
        </DesignCanvas>
      </View>
    </GestureDetector>
  );
}

export const peel: StyleDef = {
  Comp: Peel,
  hint: 'Drag the corner to peel the sticker',
  ghost: [[272, 592], [150, 470], [70, 390]],
  transparent: true,
};
