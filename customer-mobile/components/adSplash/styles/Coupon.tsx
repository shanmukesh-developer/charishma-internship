// 6. Pull the Coupon (design coupon()): a paper coupon ticket on a deep red background. The main part is
// cream paper with a perforated right edge and a holographic sheen sweeping over it; the golden stub on the
// right says PULL TO TEAR. Pulling the stub to the right tears it off (it lifts, turns and fades) and the
// coupon flips to "Coupon applied" with a green check that slams in, a star burst, a ring wave and the
// yellow Explore button. Design units throughout (ticket 260 x 410 at 20, 96).
import React, { useMemo, useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, View } from 'react-native';
import { Easing, runOnJS, useAnimatedReaction, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  Box, BoxShadow, Circle, Group, Image as SkiaImage, ImageShader, LinearGradient, Paragraph, Path, PathOp, RadialGradient, Rect,
  Skia, TextAlign, rect, rrect, vec, type SkParagraph, type SkTypefaceFontProvider, Paint } from '@shopify/react-native-skia';
import { DBox, DesignCanvas, DH, DW, FONT, clamp, useAd, useProgressGesture } from '../kit';
import type { StyleDef } from './types';

// ── Geometry (design .cp / .cp-main / .cp-stub) ──────────────────────────────────────────────────────
const CP_X = 20;
const CP_Y = 96;
const CP_W = 260;
const CP_H = 410;
const MAIN_W = 204;
const STUB_W = 56;
const PAD = 16; // .cp-main padding
const IN_W = MAIN_W - PAD * 2; // 172: widest a line can be inside the main part
const SMALL_W = 150; // .cp-main small{max-width:150px}

/** CSS linear-gradient(<deg>) on a w x h box -> Skia start / end points (box coordinates). */
function cssLinear(deg: number, w: number, h: number) {
  const r = (deg * Math.PI) / 180;
  const dx = Math.sin(r); const dy = -Math.cos(r);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  return { start: vec(w / 2 - (dx * L) / 2, h / 2 - (dy * L) / 2), end: vec(w / 2 + (dx * L) / 2, h / 2 + (dy * L) / 2) };
}

/** Teeth: every 10 units down the cut, alternately 5 in and flush (design teethM / teethS). */
function couponPaths() {
  const main = Skia.Path.Make();
  main.moveTo(0, 0);
  for (let y = 0, i = 0; y <= CP_H; y += 10, i++) main.lineTo(MAIN_W - (i % 2 ? 0 : 5), y);
  main.lineTo(0, CP_H);
  main.close();
  const mainBox = Skia.Path.Make();
  mainBox.addRRect({ rect: rect(0, 0, MAIN_W, CP_H), topLeft: vec(10, 10), topRight: vec(0, 0), bottomRight: vec(0, 0), bottomLeft: vec(10, 10) });
  const stub = Skia.Path.Make();
  for (let y = 0, i = 0; y <= CP_H; y += 10, i++) { const d = i % 2 ? 0 : 5; if (i === 0) stub.moveTo(d, y); else stub.lineTo(d, y); }
  stub.lineTo(STUB_W, CP_H);
  stub.lineTo(STUB_W, 0);
  stub.close();
  const stubBox = Skia.Path.Make();
  stubBox.addRRect({ rect: rect(0, 0, STUB_W, CP_H), topLeft: vec(0, 0), topRight: vec(10, 10), bottomRight: vec(10, 10), bottomLeft: vec(0, 0) });
  return {
    main: Skia.Path.MakeFromOp(main, mainBox, PathOp.Intersect) ?? main,
    stub: Skia.Path.MakeFromOp(stub, stubBox, PathOp.Intersect) ?? stub,
  };
}

/**
 * The design's paper noise (--noise: feTurbulence fractalNoise .9, 3 octaves, stitched 160 px tile, then
 * feColorMatrix to a brown with alpha .9a - .38). Skia's fractal noise is the same SVG algorithm; the RGB
 * constants are the filter's linearRGB .2/.14/.08 converted to sRGB. Rendered once into a tile image at
 * screen density, then repeated, so nothing per-pixel runs per frame.
 */
const NOISE = 160;
function usePaperNoise(k: number) {
  return useMemo(() => {
    const s = Math.min(3, Math.max(1, k * PixelRatio.get()));
    const px = Math.ceil(NOISE * s);
    const surf = Skia.Surface.Make(px, px);
    if (!surf) return null;
    const c = surf.getCanvas();
    c.scale(px / NOISE, px / NOISE);
    const paint = Skia.Paint();
    paint.setShader(Skia.Shader.MakeFractalNoise(0.9, 0.9, 3, 0, NOISE, NOISE));
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix([
      0, 0, 0, 0, 0.4845,
      0, 0, 0, 0, 0.4101,
      0, 0, 0, 0, 0.3133,
      0, 0, 0, 0.9, -0.38,
    ]));
    c.drawRect(Skia.XYWHRect(0, 0, NOISE, NOISE), paint);
    surf.flush();
    return surf.makeImageSnapshot();
  }, [k]);
}

type PSpec = { family: string; size: number; weight: number; color: string; lh: number; ls?: number };
/** Centred paragraph with CSS line boxes (half-leading), laid out to `width`. */
function para(fm: SkTypefaceFontProvider | null, text: string, width: number, t: PSpec): SkParagraph | null {
  if (!fm || !text) return null;
  const b = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center }, fm);
  b.pushStyle({
    fontFamilies: [t.family], fontSize: t.size, fontStyle: { weight: t.weight as any }, color: Skia.Color(t.color),
    letterSpacing: t.ls || 0, heightMultiplier: t.lh, halfLeading: true,
  });
  b.addText(text);
  b.pop();
  const p = b.build();
  p.layout(width);
  return p;
}
const H = (p: SkParagraph | null) => (p ? p.getHeight() : 0);

// Main paper (linear-gradient(160deg,#fcebcb,#f0d6a4)), stub paper (160deg,#efd196,#d9b170).
const MAIN_G = cssLinear(160, MAIN_W, CP_H);
const STUB_G = cssLinear(160, STUB_W, CP_H);
// Holographic sheen (.cp-main::after): linear-gradient(115deg, ...) sized 260% x 100% of the main part,
// repeating, background-position 130% -> -130% over 3.2 s, soft-light.
const HOLO_W = MAIN_W * 2.6;
const HOLO_G = cssLinear(115, HOLO_W, CP_H);
const HOLO_TRAVEL = (HOLO_W - MAIN_W) * 1.3; // offset runs from -TRAVEL to +TRAVEL

function Coupon() {
  const { ad, fm, art, stage, magic, wave, explore } = useAd();
  const paths = useMemo(couponPaths, []);
  const noise = usePaperNoise(stage.k);
  const reduce = useReducedMotion();

  // ── text (the design's .pre column and the .ok face) ──
  const T = useMemo(() => {
    const red = '#b3261e'; const ink = '#3a1a0a';
    const brand = para(fm, `ZENV · ${ad.store.name}`.toUpperCase(), IN_W, { family: FONT.body, size: 10, weight: 700, color: red, lh: 1.5, ls: 1.4 });
    const head = para(fm, ad.headline.replace(/\s*\n\s*/g, ' '), IN_W, { family: FONT.display, size: 30, weight: 700, color: red, lh: 1 });
    const off = para(fm, ad.offerText, IN_W, { family: FONT.display, size: 26, weight: 700, color: red, lh: 1 });
    const sub = para(fm, ad.subline || '', SMALL_W, { family: FONT.body, size: 11, weight: 400, color: ink, lh: 1.5 });
    const okHead = para(fm, 'Coupon applied', IN_W, { family: FONT.display, size: 24, weight: 700, color: red, lh: 1 });
    const okSub = para(fm, `${ad.offerText} · ${ad.subline || ''}`, SMALL_W, { family: FONT.body, size: 11, weight: 400, color: ink, lh: 1.5 });
    const ctaProbe = para(fm, 'Explore', 400, { family: FONT.body, size: 13, weight: 700, color: '#2a1c00', lh: 1.5 });
    const ctaW = Math.ceil((ctaProbe ? ctaProbe.getMaxIntrinsicWidth() : 48) + 1) + 52; // .cta padding 11 26
    const cta = para(fm, 'Explore', ctaW, { family: FONT.body, size: 13, weight: 700, color: '#2a1c00', lh: 1.5 });
    const stubTxt = para(fm, 'PULL TO TEAR', 300, { family: FONT.body, size: 11, weight: 700, color: '#7a3a14', lh: 1.5, ls: 1.98 });

    // .cp-main: flex column, centred, gap 6 (pre) / .ok: gap 8
    const ART_H = 96; const GAP = 6;
    const preH = H(brand) + H(head) + ART_H + H(off) + H(sub) + GAP * 4;
    let y = (CP_H - preH) / 2;
    const yBrand = y; y += H(brand) + GAP;
    const yHead = y; y += H(head) + GAP;
    const yArt = y; y += ART_H + GAP;
    const yOff = y; y += H(off) + GAP;
    const ySub = y;
    const CTA_H = 13 * 1.5 + 22; const OK_GAP = 8; const EM = 44;
    const okH = EM + OK_GAP + H(okHead) + OK_GAP + H(okSub) + OK_GAP + CTA_H;
    y = (CP_H - okH) / 2;
    const yEm = y; y += EM + OK_GAP;
    const yOkHead = y; y += H(okHead) + OK_GAP;
    const yOkSub = y; y += H(okSub) + OK_GAP;
    const yCta = y;
    return {
      brand, head, off, sub, okHead, okSub, cta, ctaW, stubTxt, stubW: stubTxt ? stubTxt.getMaxIntrinsicWidth() : 0,
      yBrand, yHead, yArt, yOff, ySub, yEm, yOkHead, yOkSub, yCta, CTA_H, EM,
    };
  }, [fm, ad.store.name, ad.headline, ad.offerText, ad.subline]);

  // ── gesture: the stub follows the finger to the right (prog map dx/130) ──
  const { p, gesture } = useProgressGesture({ map: (dx) => { 'worklet'; return dx / 130; }, th: 0.35, ms: 550, sound: 'paper' });
  const stubTransform = useDerivedValue(() => [
    { translateX: 130 * p.value }, { translateY: -46 * p.value }, { rotate: ((24 * Math.PI) / 180) * p.value },
  ]);
  const stubOpacity = useDerivedValue(() => 1 - clamp((p.value - 0.75) * 4));
  const isDone = useDerivedValue(() => (p.value > 0.6 ? 1 : 0));
  const preOpacity = useDerivedValue(() => 1 - isDone.value);

  // ── done face: the check slams in each time the face turns (CSS animation restarts with .done) ──
  const slam = useSharedValue(1);
  const stamped = useSharedValue(0);
  const [okLive, setOkLive] = useState(false);
  useAnimatedReaction(() => isDone.value, (v, prev) => {
    if (prev === null || v === prev) return;
    if (v) {
      slam.value = 0;
      slam.value = withTiming(1, { duration: 550, easing: Easing.bezier(0.2, 1.6, 0.4, 1) });
      if (!stamped.value) {
        stamped.value = 1;
        magic.burst(130, 300, 34, ['#ffd36b', '#ffffff', '#fff0c0'], 5, 0.07, 5);
        runOnJS(wave)(130, 300);
      }
    }
    runOnJS(setOkLive)(!!v);
  });
  const emCy = T.yEm + T.EM / 2;
  const emTransform = useDerivedValue(() => [
    { scale: 2.8 - 1.8 * slam.value }, { rotate: ((-30 * Math.PI) / 180) * (1 - slam.value) },
  ]);
  const emOpacity = useDerivedValue(() => isDone.value * clamp(slam.value));
  const pressed = useSharedValue(0);
  const ctaOpacity = useDerivedValue(() => 1 - 0.15 * pressed.value);

  // ── holographic sheen: background-position 130% -> -130%, linear, 3.2 s ──
  const holo = useSharedValue(0.5);
  React.useEffect(() => {
    if (reduce) { holo.value = 0.5; return; } // reduced motion: the sheen holds still (design: animation none)
    holo.value = 0;
    holo.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.linear }), -1, false);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const holoTransform = useDerivedValue(() => [{ translateX: -HOLO_TRAVEL + 2 * HOLO_TRAVEL * holo.value }]);

  const shadowPaint = useMemo(() => {
    const pt = Skia.Paint();
    pt.setImageFilter(Skia.ImageFilter.MakeDropShadow(0, 16, 11, 11, Skia.Color('rgba(0,0,0,0.6)'), null, null)); // drop-shadow(0 16px 22px)
    return pt;
  }, []);

  const artX = (MAIN_W - 132) / 2;
  const artBox = rrect(rect(artX, T.yArt, 132, 96), 8, 8);
  const ctaX = (MAIN_W - T.ctaW) / 2;
  const stubCx = 28 + 2; // flex-centred, margin-left 4
  const noiseShader = (w: number) => noise
    ? <ImageShader image={noise} tx="repeat" ty="repeat" fit="fill" rect={rect(0, 0, NOISE, NOISE)} key={`n${w}`} />
    : null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <DesignCanvas>
            {/* .c-bg: radial-gradient(circle at 50% 30%, #4a1411, #1b0807 75%), farthest-corner */}
            <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3}>
              <RadialGradient c={vec(DW / 2, DH * 0.3)} r={Math.hypot(DW / 2, DH * 0.7)} colors={['#4a1411', '#1b0807']} positions={[0, 0.75]} />
            </Rect>

            <Group transform={[{ translateX: CP_X }, { translateY: CP_Y }]} layer={shadowPaint}>
              {/* ── main part ── */}
              <Group clip={paths.main}>
                <Rect x={0} y={0} width={MAIN_W} height={CP_H}>
                  <LinearGradient start={MAIN_G.start} end={MAIN_G.end} colors={['#fcebcb', '#f0d6a4']} />
                </Rect>
                {noise ? <Rect x={0} y={0} width={MAIN_W} height={CP_H}>{noiseShader(MAIN_W)}</Rect> : null}

                <Group layer={<Paint opacity={preOpacity} />}>
                  {T.brand ? <Paragraph paragraph={T.brand} x={PAD} y={T.yBrand} width={IN_W} /> : null}
                  {T.head ? <Paragraph paragraph={T.head} x={PAD} y={T.yHead} width={IN_W} /> : null}
                  <Box box={artBox} color="#e3c48f">
                    <BoxShadow dx={0} dy={6} blur={7} color="rgba(60,20,5,0.35)" />
                  </Box>
                  {art ? (
                    <Group clip={artBox}>
                      <SkiaImage image={art} x={artX} y={T.yArt} width={132} height={96} fit="cover" />
                    </Group>
                  ) : null}
                  {T.off ? <Paragraph paragraph={T.off} x={PAD} y={T.yOff} width={IN_W} /> : null}
                  {T.sub ? <Paragraph paragraph={T.sub} x={(MAIN_W - SMALL_W) / 2} y={T.ySub} width={SMALL_W} /> : null}
                </Group>

                <Group layer={<Paint opacity={isDone} />}>
                  <Group origin={vec(MAIN_W / 2, emCy)} transform={emTransform} layer={<Paint opacity={emOpacity} />}>
                    <Circle cx={MAIN_W / 2} cy={emCy} r={T.EM / 2} color="#1f9d5c" />
                    <Path
                      path={`M ${MAIN_W / 2 - 7.5} ${emCy + 0.5} L ${MAIN_W / 2 - 2.5} ${emCy + 5.5} L ${MAIN_W / 2 + 8} ${emCy - 6}`}
                      style="stroke" strokeWidth={2.8} strokeCap="round" strokeJoin="round" color="#ffffff"
                    />
                  </Group>
                  {T.okHead ? <Paragraph paragraph={T.okHead} x={PAD} y={T.yOkHead} width={IN_W} /> : null}
                  {T.okSub ? <Paragraph paragraph={T.okSub} x={(MAIN_W - SMALL_W) / 2} y={T.yOkSub} width={SMALL_W} /> : null}
                  <Group layer={<Paint opacity={ctaOpacity} />}>
                    <Box box={rrect(rect(ctaX, T.yCta, T.ctaW, T.CTA_H), T.CTA_H / 2, T.CTA_H / 2)} color="#f4c430">
                      <BoxShadow dx={0} dy={6} blur={8} spread={-6} color="rgba(0,0,0,0.5)" />
                    </Box>
                    {T.cta ? <Paragraph paragraph={T.cta} x={ctaX} y={T.yCta + 11} width={T.ctaW} /> : null}
                  </Group>
                </Group>

                {/* holographic sweep over everything on the main part (z-index 3, soft-light) */}
                <Group transform={holoTransform}>
                  {[-1, 0, 1].map((n) => (
                    <Rect key={n} x={n * HOLO_W} y={0} width={HOLO_W} height={CP_H} blendMode="softLight">
                      <LinearGradient
                        start={vec(HOLO_G.start.x + n * HOLO_W, HOLO_G.start.y)} end={vec(HOLO_G.end.x + n * HOLO_W, HOLO_G.end.y)}
                        colors={['rgba(0,0,0,0)', 'rgba(255,255,255,0.7)', 'rgba(255,196,120,0.35)', 'rgba(0,0,0,0)']}
                        positions={[0.3, 0.44, 0.52, 0.66]} flags={1}
                      />
                    </Rect>
                  ))}
                </Group>
              </Group>

              {/* ── stub: transform-origin left bottom ── */}
              <Group transform={[{ translateX: MAIN_W }]}>
                <Group origin={vec(0, CP_H)} transform={stubTransform} layer={<Paint opacity={stubOpacity} />}>
                  <Group clip={paths.stub}>
                    <Rect x={0} y={0} width={STUB_W} height={CP_H}>
                      <LinearGradient start={STUB_G.start} end={STUB_G.end} colors={['#efd196', '#d9b170']} />
                    </Rect>
                    {noise ? <Rect x={0} y={0} width={STUB_W} height={CP_H}>{noiseShader(STUB_W)}</Rect> : null}
                    {T.stubTxt ? (
                      <Group origin={vec(stubCx, CP_H / 2)} transform={[{ rotate: Math.PI / 2 }]}>
                        <Paragraph paragraph={T.stubTxt} x={stubCx - 150} y={CP_H / 2 - 8.25} width={300} />
                      </Group>
                    ) : null}
                  </Group>
                </Group>
              </Group>
            </Group>
          </DesignCanvas>
        </View>
      </GestureDetector>

      {/* The Explore button's touch target sits outside the pan so a tap on it is never taken as a pull. */}
      <DBox x={CP_X + ctaX} y={CP_Y + T.yCta} w={T.ctaW} h={T.CTA_H} pointerEvents={okLive ? 'auto' : 'none'}>
        <Pressable
          accessibilityRole="button" accessibilityLabel="Explore" accessibilityElementsHidden={!okLive} importantForAccessibility={okLive ? 'yes' : 'no-hide-descendants'}
          onPressIn={() => { pressed.value = withTiming(1, { duration: 80 }); }}
          onPressOut={() => { pressed.value = withTiming(0, { duration: 160 }); }}
          onPress={() => { if (okLive) explore(); }}
          style={StyleSheet.absoluteFill}
        />
      </DBox>
    </View>
  );
}

export const coupon: StyleDef = {
  Comp: Coupon,
  hint: 'Pull the perforated edge to the right',
  ghost: [[250, 300], [292, 290]],
};

