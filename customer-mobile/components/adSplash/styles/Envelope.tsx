// 3. Envelope (design envelope() + .e-* / .env and the realism pass): a dark green envelope sealed with gold
// wax. Swiping up breaks the seal, the top flap swings open in 3D (over the pocket until 90 deg, behind the
// card after), and the cream card inside rises out with a golden glow, showing the store, the photo, the
// offer and, at the end, the yellow Explore Offer button. Tapping anywhere (the seal included) plays it.
// Everything is in design units (300 x 620); motion runs on the UI thread.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  BlurMask, Circle, ColorMatrix, FillType, FractalNoise, Group, Image as SkiaImage, LinearGradient, Paragraph, Path, RadialGradient,
  Rect, RoundedRect, Skia, vec, Paint } from '@shopify/react-native-skia';
import { Cta, DBox, DH, DW, DesignCanvas, FONT, clamp, makePara, useAd, useProgressGesture } from '../kit';
import type { StyleDef } from './types';

// ── Geometry (design units; .env{left:25px;top:292px;width:250px;height:170px}) ──────────────────────
const EX = 25; const EY = 292; const EW = 250; const EH = 170;
const CARD = { x: EX + 18, y: EY + 14, w: EW - 36, h: 150 }; // .e-card
const FLAP_H = 96; // .e-flap
const SEAL = { cx: EX + EW / 2, cy: EY + 90, d: 40 }; // .e-seal (top 70, 40 x 40)
const ART = { w: 78, h: 62 }; // .e-card .art
const CTA_H = 30.5; // .e-card .cta: 11 px text, 1.5 line height, 7 px padding
const GOLD_BURST = ['#ffe7a8', '#f4c430', '#ffffff'];
const AFTER_BURST = ['#fff6d6', '#ffd36b', '#ffffff'];

/** CSS linear-gradient(<deg>) on a box -> Skia start / end points. */
function cssLinear(x: number, y: number, w: number, h: number, deg: number) {
  const a = (deg * Math.PI) / 180; const sx = Math.sin(a); const sy = -Math.cos(a);
  const L = Math.abs(w * sx) + Math.abs(h * sy); const cx = x + w / 2; const cy = y + h / 2;
  return { start: vec(cx - (sx * L) / 2, cy - (sy * L) / 2), end: vec(cx + (sx * L) / 2, cy + (sy * L) / 2) };
}

// The design's --noise: feTurbulence fractalNoise (base frequency .9, 3 octaves) through
// feColorMatrix "0 0 0 0 .2 / 0 0 0 0 .14 / 0 0 0 0 .08 / 0 0 0 .9 -.38". SVG filters work in linearRGB,
// so the brown constants are converted to sRGB here (.2/.14/.08 linear = .484/.410/.313 sRGB).
const NOISE_CM = [0, 0, 0, 0, 0.4845, 0, 0, 0, 0, 0.4101, 0, 0, 0, 0, 0.3133, 0, 0, 0, 0.9, -0.38];
function PaperNoise({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <Rect x={x} y={y} width={w} height={h}>
      <FractalNoise freqX={0.9} freqY={0.9} octaves={3} />
      <ColorMatrix matrix={NOISE_CM} />
    </Rect>
  );
}

/** The top flap (triangle, gradient + noise), rotating about its top edge in the env's 900 px perspective. */
function Flap({ transform, opacity }: { transform: SharedValue<any>; opacity: SharedValue<number> }) {
  const tri = useMemo(() => Skia.Path.Make().moveTo(EX, EY).lineTo(EX + EW, EY).lineTo(EX + EW / 2, EY + FLAP_H).close(), []);
  return (
    <Group layer={<Paint opacity={opacity} />}>
      {/* perspective-origin = the env's centre, transform-origin = the flap's top edge (see transform) */}
      <Group origin={vec(EX + EW / 2, EY + EH / 2)} transform={transform}>
        <Group clip={tri}>
          <Rect x={EX} y={EY} width={EW} height={FLAP_H}>
            <LinearGradient start={vec(0, EY)} end={vec(0, EY + FLAP_H)} colors={['#238554', '#0f472e']} />
          </Rect>
          <PaperNoise x={EX} y={EY} w={EW} h={FLAP_H} />
        </Group>
      </Group>
    </Group>
  );
}

/** The cream card: golden glow (box-shadow 0 0 46k px), paper, store name, photo, offer. */
function Card({ transform, opacity, glowOp, glowBlur, layout }: {
  transform: SharedValue<any>; opacity: SharedValue<number>; glowOp: SharedValue<number>; glowBlur: SharedValue<number>;
  layout: { name: any; off: any; nameY: number; artY: number; offY: number };
}) {
  const { art } = useAd();
  const cardRR = useMemo(() => Skia.RRectXY(Skia.XYWHRect(CARD.x, CARD.y, CARD.w, CARD.h), 6, 6), []);
  const artX = CARD.x + (CARD.w - ART.w) / 2;
  const artRR = useMemo(() => Skia.RRectXY(Skia.XYWHRect(artX, layout.artY, ART.w, ART.h), 6, 6), [artX, layout.artY]);
  const g = cssLinear(CARD.x, CARD.y, CARD.w, CARD.h, 160);
  return (
    <Group layer={<Paint opacity={opacity} />}>
      <Group origin={vec(CARD.x + CARD.w / 2, CARD.y + CARD.h)} transform={transform}>
        <Group layer={<Paint opacity={glowOp} />}>
          <RoundedRect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} r={6} color="rgb(255,214,102)">
            <BlurMask blur={glowBlur} style="normal" />
          </RoundedRect>
        </Group>
        <Group clip={cardRR}>
          <Rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h}>
            <LinearGradient start={g.start} end={g.end} colors={['#fcf1d8', '#edd9b0']} />
          </Rect>
          <PaperNoise x={CARD.x} y={CARD.y} w={CARD.w} h={CARD.h} />
        </Group>
        {layout.name ? <Paragraph paragraph={layout.name} x={CARD.x + 8} y={layout.nameY} width={CARD.w - 16} /> : null}
        {art ? (
          <Group clip={artRR}>
            <SkiaImage image={art} x={artX} y={layout.artY} width={ART.w} height={ART.h} fit="cover" />
          </Group>
        ) : null}
        {layout.off ? <Paragraph paragraph={layout.off} x={CARD.x + 8} y={layout.offY} width={CARD.w - 16} /> : null}
      </Group>
    </Group>
  );
}

/** Gold wax seal: irregular blob, radial gradient, inner rim light, inner bottom shade, drop shadow, embossed Z. */
function Seal({ transform, opacity }: { transform: SharedValue<any>; opacity: SharedValue<number> }) {
  const { fm } = useAd();
  const x = SEAL.cx - SEAL.d / 2; const y = SEAL.cy - SEAL.d / 2; const d = SEAL.d;
  const paths = useMemo(() => {
    // border-radius: 48% 52% 50% 50% / 52% 48% 52% 48%
    const body = Skia.Path.Make().addRRect({
      rect: Skia.XYWHRect(x, y, d, d),
      topLeft: { x: 0.48 * d, y: 0.52 * d }, topRight: { x: 0.52 * d, y: 0.48 * d },
      bottomRight: { x: 0.5 * d, y: 0.52 * d }, bottomLeft: { x: 0.5 * d, y: 0.48 * d },
    });
    const drop = body.copy().offset(0, 5); // 0 5px 9px rgba(0,0,0,.55)
    const inner = Skia.Path.Make().addRect(Skia.XYWHRect(x - 30, y - 30, d + 60, d + 60)); // inset 0 -4px 7px
    inner.addPath(body.copy().offset(0, -4));
    inner.setFillType(FillType.EvenOdd);
    return { body, drop, inner };
  }, [x, y, d]);
  const z = useMemo(() => makePara(fm, 'Z', d, { family: FONT.display, size: 19, weight: 700, color: '#6d4a0c', shadow: { color: 'rgba(255,255,255,0.45)', blur: 0, dy: 1 } }), [fm, d]);
  const zH = z ? z.getHeight() : 24;
  return (
    <Group layer={<Paint opacity={opacity} />} origin={vec(SEAL.cx, SEAL.cy)} transform={transform}>
      <Path path={paths.drop} color="rgba(0,0,0,0.55)">
        <BlurMask blur={4.5} style="normal" />
      </Path>
      <Path path={paths.body}>
        {/* radial-gradient(circle at 35% 28%, #fbe9a0, #d2a23a 46%, #7c5712) - farthest corner */}
        <RadialGradient c={vec(x + 0.35 * d, y + 0.28 * d)} r={Math.hypot(0.65 * d, 0.72 * d)} colors={['#fbe9a0', '#d2a23a', '#7c5712']} positions={[0, 0.46, 1]} />
      </Path>
      <Group clip={paths.body}>
        <Path path={paths.inner} color="rgba(0,0,0,0.4)">
          <BlurMask blur={3.5} style="normal" />
        </Path>
        <Path path={paths.body} style="stroke" strokeWidth={6} color="rgba(255,255,255,0.16)" />
      </Group>
      {z ? <Paragraph paragraph={z} x={x} y={SEAL.cy - zH / 2} width={d} /> : null}
    </Group>
  );
}

function EnvelopeAd() {
  const ad = useAd();
  const { fm, magic, stage: s } = ad;
  const sparked = useSharedValue(0);
  const [ctaOn, setCtaOn] = useState(false);
  const { p, gesture } = useProgressGesture({
    map: (_dx, dy) => { 'worklet'; return -dy / 190; },
    th: 0.3, ms: 750, sound: 'paper',
    after: () => ad.burstJS(150, 190, 34, AFTER_BURST, 5, 0.05, 6),
  });

  // first spark at the seal as it breaks
  useAnimatedReaction(() => p.value, (v) => {
    if (v > 0.06 && !sparked.value) {
      sparked.value = 1;
      magic.burst(150, 372, 30, GOLD_BURST, 4.5, 0.05, 5);
      runOnJS(ad.wave)(150, 372);
    }
  });
  useAnimatedReaction(() => p.value > 0.95, (on, prev) => { if (on !== prev) runOnJS(setCtaOn)(on); });

  // ── texts ──
  const head = useMemo(() => makePara(fm, 'A little surprise\nfrom your neighbourhood', DW, { family: FONT.hand, size: 26, weight: 600, color: '#ffffff', lineHeight: 1.1 }), [fm]);
  const layout = useMemo(() => {
    const name = makePara(fm, ad.ad.store.name.toUpperCase(), CARD.w - 16, { family: FONT.body, size: 9, weight: 400, color: '#3a2a10', letterSpacing: 0.9, lineHeight: 1.5 });
    const off = makePara(fm, ad.ad.offerText, CARD.w - 16, { family: FONT.display, size: 19, weight: 700, color: '#3a2a10', lineHeight: 1.05 });
    const nameH = name ? name.getHeight() : 13.5; const offH = off ? off.getHeight() : 20;
    // .e-card: flex column, centred, gap 2, padding 8 (the hidden CTA still takes its space)
    const total = nameH + 2 + ART.h + 2 + offH + 2 + CTA_H;
    const top = CARD.y + 8 + (CARD.h - 16 - total) / 2;
    const nameY = top; const artY = nameY + nameH + 2; const offY = artY + ART.h + 2; const ctaY = offY + offH + 2;
    return { name, off, nameY, artY, offY, ctaY };
  }, [fm, ad.ad.store.name, ad.ad.offerText]);

  // ── the design's set(p) ──
  const flapA = useDerivedValue(() => clamp(p.value / 0.35) * Math.PI); // rotateX 0..180 deg
  const flapT = useDerivedValue(() => [{ perspective: 900 }, { translateY: -EH / 2 }, { rotateX: flapA.value }, { translateY: EH / 2 }]);
  const flapOver = useDerivedValue<number>(() => (flapA.value <= Math.PI / 2 ? 1 : 0)); // z-index 4 (over the pocket)
  const flapUnder = useDerivedValue<number>(() => (flapA.value > Math.PI / 2 ? 1 : 0)); // z-index 1 (behind the card)
  const sealOp = useDerivedValue(() => 1 - clamp(p.value / 0.1));
  const sealT = useDerivedValue(() => [{ scale: 1 + clamp(p.value / 0.1) * 0.6 }]);
  const rise = useDerivedValue(() => clamp((p.value - 0.35) / 0.65));
  const cardT = useDerivedValue(() => [{ translateY: -205 * rise.value }, { scale: 1 + 0.14 * rise.value }]);
  const cardLow = useDerivedValue<number>(() => (p.value > 0.84 ? 0 : 1)); // z-index 2: inside the pocket
  const cardHigh = useDerivedValue<number>(() => (p.value > 0.84 ? 1 : 0)); // z-index 6: over everything
  const cardGlowOp = useDerivedValue(() => 0.85 * rise.value);
  const cardGlowBlur = useDerivedValue(() => Math.max(0.01, 23 * rise.value));
  const headOp = useDerivedValue(() => 1 - clamp(p.value * 3));
  const glowOp = useDerivedValue(() => clamp((p.value - 0.15) * 1.8));

  // ── static shapes ──
  const envRR = useMemo(() => Skia.RRectXY(Skia.XYWHRect(EX, EY, EW, EH), 6, 6), []);
  const front = useMemo(() => Skia.Path.Make().addPoly([
    { x: EX, y: EY }, { x: EX + EW / 2, y: EY + 0.52 * EH }, { x: EX + EW, y: EY }, { x: EX + EW, y: EY + EH }, { x: EX, y: EY + EH },
  ], true), []);
  const frontShadow = useMemo(() => front.copy().offset(0, -2), [front]);
  const gBack = cssLinear(EX, EY, EW, EH, 160);

  // the Explore Offer button rides on the card (RN view, same transform, origin = card bottom centre)
  const cardBox = useAnimatedStyle(() => ({
    transform: [{ translateY: -205 * rise.value * s.k }, { scale: 1 + 0.14 * rise.value }],
  }));
  // .e-card .cta { transition: opacity .4s .6s } - the button fades in after the card settles
  const ctaFade = useAnimatedStyle(() => ({
    opacity: withDelay(600, withTiming(clamp((p.value - 0.9) * 10), { duration: 400, easing: Easing.bezier(0.25, 0.1, 0.25, 1) })),
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <DesignCanvas>
            {/* .e-bg: radial-gradient(circle at 50% 50%, #12432c, #06140e 75%) */}
            <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3}>
              <RadialGradient c={vec(150, 310)} r={Math.hypot(150, 310)} colors={['#12432c', '#06140e']} positions={[0, 0.75]} />
            </Rect>
            {head ? <Group layer={<Paint opacity={headOp} />}><Paragraph paragraph={head} x={0} y={150} width={DW} /></Group> : null}

            {/* .e-back + its shadow (0 20px 40px -10px #000) */}
            <Rect x={EX + 10} y={EY + 10 + 20} width={EW - 20} height={EH - 20} color="#000">
              <BlurMask blur={20} style="normal" />
            </Rect>
            <Group clip={envRR}>
              <Rect x={EX} y={EY} width={EW} height={EH}>
                <LinearGradient start={gBack.start} end={gBack.end} colors={['#0f4a2f', '#082b1b']} />
              </Rect>
              <PaperNoise x={EX} y={EY} w={EW} h={EH} />
            </Group>

            {/* .e-glow (z 1, screen) */}
            <Group layer={<Paint opacity={glowOp} />} blendMode="screen">
              <Circle cx={EX + EW / 2} cy={EY + 40} r={170}>
                <RadialGradient c={vec(EX + EW / 2, EY + 40)} r={170 * Math.SQRT2} colors={['rgba(255,226,140,0.95)', 'rgba(255,190,70,0.35)', 'rgba(255,190,70,0)']} positions={[0, 0.4, 0.7]} />
              </Circle>
            </Group>

            <Flap transform={flapT} opacity={flapUnder} />
            <Card transform={cardT} opacity={cardLow} glowOp={cardGlowOp} glowBlur={cardGlowBlur} layout={layout} />

            {/* .e-front: the pocket, with its drop-shadow onto the card along the V */}
            <Path path={frontShadow} color="rgba(0,0,0,0.3)">
              <BlurMask blur={1.5} style="normal" />
            </Path>
            <Group clip={envRR}>
              <Group clip={front}>
                <Rect x={EX} y={EY} width={EW} height={EH}>
                  <LinearGradient start={gBack.start} end={gBack.end} colors={['#1e8050', '#0b3d27']} />
                </Rect>
                <PaperNoise x={EX} y={EY} w={EW} h={EH} />
              </Group>
            </Group>

            <Flap transform={flapT} opacity={flapOver} />
            <Seal transform={sealT} opacity={sealOp} />
            <Card transform={cardT} opacity={cardHigh} glowOp={cardGlowOp} glowBlur={cardGlowBlur} layout={layout} />
          </DesignCanvas>
        </View>
      </GestureDetector>

      {/* Outside the detector, so the pan never cancels the button's press. */}
      <DBox x={CARD.x} y={CARD.y} w={CARD.w} h={CARD.h} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: ['50%', '100%', 0] }, cardBox]} pointerEvents="box-none">
          <Animated.View
            pointerEvents={ctaOn ? 'auto' : 'none'}
            style={[{ position: 'absolute', left: 0, right: 0, top: (layout.ctaY - CARD.y) * s.k, height: CTA_H * s.k, alignItems: 'center', justifyContent: 'center' }, ctaFade]}>
            <Cta label="Explore Offer" fontSize={11} padV={7} padH={16} onPress={() => { if (p.value > 0.95) ad.explore(); }} />
          </Animated.View>
        </Animated.View>
      </DBox>
    </View>
  );
}

export const envelope: StyleDef = {
  Comp: EnvelopeAd,
  hint: 'Swipe up to open the envelope',
  ghost: [[150, 430], [150, 240]],
};
