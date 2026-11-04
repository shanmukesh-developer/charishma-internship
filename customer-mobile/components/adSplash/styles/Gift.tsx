// 4. Gift box (design gift() + .gift / .g-* and the realism pass): a green gift box with gold ribbon bands
// and a bow. Pulling the ribbon tail down flies the lid up and away, a golden glow and spinning rays light
// up, and the ad photo rises out of the box; past 90 % confetti bursts and the store, the offer and the
// Discover button appear, then the product gently bobs. Design units (300 x 620); motion on the UI thread.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  BlurMask, Circle, FillType, Group, LinearGradient, Paragraph, Path, RadialGradient, Rect, RoundedRect, Skia, TextAlign, vec, Paint } from '@shopify/react-native-skia';
import { Cta, DBox, DH, DW, DesignCanvas, FONT, FeatheredArt, Rays, clamp, makePara, useAd, useProgressGesture } from '../kit';
import type { StyleDef } from './types';

// ── Geometry (.gift{left:50%;top:310px;width:170px;height:130px}) ───────────────────────────────────
const GX = 65; const GY = 310; const GW = 170; const GH = 130;
const BODY = { x: GX, y: GY + GH - 96, w: 170, h: 96 }; // .g-body (bottom 0)
const LID = { x: GX - 8, y: GY + GH - 90 - 34, w: 186, h: 34 }; // .g-lid (left -8, bottom 90)
const BOW = { x: 150 - 28, y: LID.y - 22, w: 56, h: 26 }; // .g-bow (top -22, centred on the lid)
const PROD = { x: 150 - 75, y: GY + GH - 50 - 150, w: 150, h: 150 }; // .g-prod (bottom 50, 150 x 150)
const TAIL = { x: 150 - 8, y: GY + 60, w: 16, h: 64 }; // .g-tail
const GLOW = { cx: 150, cy: GY - 30 + 150, r: 150 }; // .g-glow (top -30, 300 x 300)
const RAYS = { cx: 150, cy: GY - 70 + 220, size: 440 }; // .g-rays (top -70, 440 x 440)
const OFFER_Y = 470; // .g-offer
const CONFETTI = ['#f4d77e', '#ffffff', '#43e598', '#e5b94b'];
const RIBBON = '#e5b94b';
const DEG = Math.PI / 180;
const bobEase = Easing.bezier(0.42, 0, 0.58, 1); // CSS ease-in-out

/** One bow loop: 26 x 24 box, 5 px gold border, border-radius 50% 50% 50% 0 (square bottom-left corner). */
function loopPath(x: number, y: number) {
  const outer = Skia.Path.Make().addRRect({
    rect: Skia.XYWHRect(x, y, 26, 24), topLeft: { x: 13, y: 12 }, topRight: { x: 13, y: 12 }, bottomRight: { x: 13, y: 12 }, bottomLeft: { x: 0, y: 0 },
  });
  outer.addRRect({
    rect: Skia.XYWHRect(x + 5, y + 5, 16, 14), topLeft: { x: 8, y: 7 }, topRight: { x: 8, y: 7 }, bottomRight: { x: 8, y: 7 }, bottomLeft: { x: 0, y: 0 },
  });
  outer.setFillType(FillType.EvenOdd);
  return outer;
}

function GiftAd() {
  const ad = useAd();
  const { fm, magic, stage: s } = ad;
  const burst = useSharedValue(0);
  const bob = useSharedValue(0);
  const [ctaOn, setCtaOn] = useState(false);
  const { p, gesture } = useProgressGesture({
    map: (_dx, dy) => { 'worklet'; return dy / 130; },
    th: 0.35, ms: 800, sound: 'paper',
  });

  useAnimatedReaction(() => p.value, (v) => {
    if (v > 0.9 && !burst.value) {
      burst.value = 1;
      runOnJS(ad.wave)(150, 360);
      magic.burst(150, 360, 70, CONFETTI, 7, 0.17, 5, 'rect');
    }
  });
  // .g-prod.bob .art { animation: bob 3s ease-in-out infinite } while p > .97
  useAnimatedReaction(() => p.value > 0.97, (on, prev) => {
    if (on && !prev) {
      bob.value = 0;
      bob.value = withRepeat(withSequence(withTiming(1, { duration: 1500, easing: bobEase }), withTiming(0, { duration: 1500, easing: bobEase })), -1, false);
    } else if (!on && prev) {
      cancelAnimation(bob);
      bob.value = 0;
    }
  });
  useAnimatedReaction(() => p.value > 0.9, (on, prev) => { if (on !== prev) runOnJS(setCtaOn)(on); });

  // ── texts ──
  const head = useMemo(() => makePara(fm, 'Something special\nis waiting…', DW, { family: FONT.hand, size: 28, weight: 600, color: '#ffffff', lineHeight: 1.1 }), [fm]);
  const offer = useMemo(() => {
    if (!fm) return null;
    // <b>name<br><span style="color:#f4c430">offer</span></b>: display 700, 24 px, line-height 1
    const b = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center }, fm);
    const base = { fontFamilies: [FONT.display], fontSize: 24, fontStyle: { weight: 700 }, heightMultiplier: 1 } as any;
    b.pushStyle({ ...base, color: Skia.Color('#ffffff') });
    b.addText(`${ad.ad.store.name}\n`);
    b.pop();
    b.pushStyle({ ...base, color: Skia.Color('#f4c430') });
    b.addText(ad.ad.offerText);
    b.pop();
    const para = b.build();
    para.layout(DW - 40); // 20 units each side: a long store name wraps instead of touching the edges
    return para;
  }, [fm, ad.ad.store.name, ad.ad.offerText]);
  const ctaY = OFFER_Y + (offer ? offer.getHeight() : 48) + 6;

  // ── static shapes ──
  const shapes = useMemo(() => {
    const bodyRR = Skia.RRectXY(Skia.XYWHRect(BODY.x, BODY.y, BODY.w, BODY.h), 6, 6);
    const lidRR = Skia.RRectXY(Skia.XYWHRect(LID.x, LID.y, LID.w, LID.h), 6, 6);
    // inset 0 10px 14px rgba(0,0,0,.35): everything outside the body moved down 10, blurred, clipped to the body
    const bodyInset = Skia.Path.Make().addRect(Skia.XYWHRect(BODY.x - 40, BODY.y - 40, BODY.w + 80, BODY.h + 80));
    bodyInset.addRRect(Skia.RRectXY(Skia.XYWHRect(BODY.x, BODY.y + 10, BODY.w, BODY.h), 6, 6));
    bodyInset.setFillType(FillType.EvenOdd);
    const tail = Skia.Path.Make().addPoly([
      { x: TAIL.x, y: TAIL.y }, { x: TAIL.x + TAIL.w, y: TAIL.y }, { x: TAIL.x + TAIL.w, y: TAIL.y + TAIL.h },
      { x: TAIL.x + TAIL.w / 2, y: TAIL.y + 0.82 * TAIL.h }, { x: TAIL.x, y: TAIL.y + TAIL.h },
    ], true);
    const loopL = loopPath(BOW.x, BOW.y);
    const loopR = loopPath(BOW.x + BOW.w - 26, BOW.y);
    // .g-bow { filter: drop-shadow(0 3px 3px rgba(0,0,0,.4)) }
    const bowPaint = Skia.Paint();
    bowPaint.setImageFilter(Skia.ImageFilter.MakeDropShadow(0, 3, 1.5, 1.5, Skia.Color('rgba(0,0,0,0.4)'), null));
    return { bodyRR, lidRR, bodyInset, tail, loopL, loopR, bowPaint };
  }, []);

  // ── the design's set(p) ──
  const lidT = useDerivedValue(() => [{ translateX: -26 * p.value }, { translateY: -52 * p.value }, { rotate: -46 * p.value * DEG }]);
  const glowOp = useDerivedValue(() => clamp(p.value * 1.4));
  const glowT = useDerivedValue(() => [{ scale: 0.3 + 0.7 * p.value }]);
  const prodOp = useDerivedValue(() => clamp((p.value - 0.15) * 1.6));
  const prodT = useDerivedValue(() => [{ translateY: 40 - 165 * p.value }, { scale: 0.4 + 0.6 * p.value }]);
  const bobT = useDerivedValue(() => [{ translateY: -9 * bob.value }, { rotate: 1.2 * DEG * bob.value }]);
  const tailT = useDerivedValue(() => [{ translateY: p.value * 44 }]);
  const tailOp = useDerivedValue(() => 1 - clamp((p.value - 0.5) * 2));
  const bowT = useDerivedValue(() => [{ scale: 1 - 0.35 * p.value }, { rotate: p.value * 18 * DEG }]);
  const headOp = useDerivedValue(() => 1 - clamp(p.value * 2));
  const offOp = useDerivedValue(() => clamp((p.value - 0.8) * 5));
  const raysOp = useDerivedValue(() => clamp((p.value - 0.2) * 1.4));
  const ctaStyle = useAnimatedStyle(() => ({ opacity: clamp((p.value - 0.8) * 5) }));

  const prodC = vec(PROD.x + PROD.w / 2, PROD.y + PROD.h / 2);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <DesignCanvas>
            {/* radial-gradient(circle at 50% 60%, #10402a, #050e09 75%) */}
            <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3}>
              <RadialGradient c={vec(150, 372)} r={Math.hypot(150, 372)} colors={['#10402a', '#050e09']} positions={[0, 0.75]} />
            </Rect>
            {head ? <Group layer={<Paint opacity={headOp} />}><Paragraph paragraph={head} x={0} y={110} width={DW} /></Group> : null}

            {/* .gift::before: ground shadow, radial-gradient(ellipse, rgba(0,0,0,.65), transparent 70%) */}
            <Rect x={GX - 40} y={GY + GH + 16 - 28} width={GW + 80} height={28}>
              <RadialGradient c={vec(150, GY + GH + 2)} r={((GW + 80) / 2) * Math.SQRT2} colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0)']} positions={[0, 0.7]}
                origin={vec(150, GY + GH + 2)} transform={[{ scaleY: 28 / (GW + 80) }]} />
            </Rect>

            {/* .g-rays: repeating-conic 0-6deg of 18deg, masked radial #000 10% -> transparent 68% (farthest corner), 14 s */}
            <Rays cx={RAYS.cx} cy={RAYS.cy} size={RAYS.size} color="rgba(255,226,140,0.55)" period={18} lit={6}
              inner={0.1 * Math.SQRT2} outer={0.68 * Math.SQRT2} secs={14} opacity={raysOp} />

            {/* .g-glow */}
            <Group layer={<Paint opacity={glowOp} />} origin={vec(GLOW.cx, GLOW.cy)} transform={glowT}>
              <Circle cx={GLOW.cx} cy={GLOW.cy} r={GLOW.r}>
                <RadialGradient c={vec(GLOW.cx, GLOW.cy)} r={GLOW.r * Math.SQRT2} colors={['rgba(255,214,102,0.9)', 'rgba(255,170,60,0.25)', 'rgba(255,170,60,0)']} positions={[0, 0.45, 0.7]} />
              </Circle>
            </Group>

            {/* .g-prod: the ad photo, feathered, rising out from behind the box */}
            <Group layer={<Paint opacity={prodOp} />} origin={prodC} transform={prodT}>
              <Group origin={prodC} transform={bobT}>
                <FeatheredArt x={PROD.x} y={PROD.y} w={PROD.w} h={PROD.h} stop={0.62} />
              </Group>
            </Group>

            {/* .g-body */}
            <Group clip={shapes.bodyRR}>
              <Rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h}>
                <LinearGradient start={vec(BODY.x, 0)} end={vec(BODY.x + BODY.w, 0)} colors={['#08331f', '#13794b', '#0e5a38', '#072a19']} positions={[0, 0.3, 0.68, 1]} />
              </Rect>
              <Rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h}>
                <LinearGradient start={vec(BODY.x, 0)} end={vec(BODY.x + BODY.w, 0)} colors={['rgba(244,215,126,0)', '#f4d77e', '#c99a2e', '#f4d77e', 'rgba(244,215,126,0)']} positions={[0.42, 0.42, 0.5, 0.58, 0.58]} />
              </Rect>
              <Path path={shapes.bodyInset} color="rgba(0,0,0,0.35)">
                <BlurMask blur={7} style="normal" />
              </Path>
            </Group>

            {/* .g-lid (origin left bottom) with the bow */}
            <Group origin={vec(LID.x, LID.y + LID.h)} transform={lidT}>
              <RoundedRect x={LID.x} y={LID.y + 8} width={LID.w} height={LID.h} r={6} color="rgba(0,0,0,0.45)">
                <BlurMask blur={6} style="normal" />
              </RoundedRect>
              <Group clip={shapes.lidRR}>
                <Rect x={LID.x} y={LID.y} width={LID.w} height={LID.h}>
                  <LinearGradient start={vec(LID.x, 0)} end={vec(LID.x + LID.w, 0)} colors={['#0a3b25', '#16874f', '#10603c', '#082e1b']} positions={[0, 0.32, 0.7, 1]} />
                </Rect>
                <Rect x={LID.x} y={LID.y} width={LID.w} height={LID.h}>
                  <LinearGradient start={vec(LID.x, 0)} end={vec(LID.x + LID.w, 0)} colors={['rgba(244,215,126,0)', '#f4d77e', '#c99a2e', '#f4d77e', 'rgba(244,215,126,0)']} positions={[0.43, 0.43, 0.5, 0.57, 0.57]} />
                </Rect>
              </Group>
              <Group layer={shapes.bowPaint}>
                <Group origin={vec(BOW.x + BOW.w / 2, BOW.y + BOW.h / 2)} transform={bowT}>
                  <Group origin={vec(BOW.x + 13, BOW.y + 12)} transform={[{ rotate: -12 * DEG }]}>
                    <Path path={shapes.loopL} color={RIBBON} />
                  </Group>
                  <Group origin={vec(BOW.x + BOW.w - 13, BOW.y + 12)} transform={[{ scaleX: -1 }, { rotate: -12 * DEG }]}>
                    <Path path={shapes.loopR} color={RIBBON} />
                  </Group>
                </Group>
              </Group>
            </Group>

            {/* .g-tail (z 4): the ribbon end you pull */}
            <Group layer={<Paint opacity={tailOp} />} transform={tailT}>
              <Path path={shapes.tail}>
                <LinearGradient start={vec(TAIL.x, 0)} end={vec(TAIL.x + TAIL.w, 0)} colors={['#a87a1c', '#f8df8c', '#b98a23']} positions={[0, 0.45, 1]} />
              </Path>
            </Group>

            {/* .g-offer */}
            {offer ? <Group layer={<Paint opacity={offOp} />}><Paragraph paragraph={offer} x={20} y={OFFER_Y} width={DW - 40} /></Group> : null}
          </DesignCanvas>
        </View>
      </GestureDetector>

      {/* Outside the detector, so the pan never cancels the button's press. */}
      <DBox x={0} y={ctaY} w={DW} h={41.5} style={{ alignItems: 'center', justifyContent: 'center' }} pointerEvents="box-none">
        <Animated.View style={ctaStyle} pointerEvents={ctaOn ? 'auto' : 'none'}>
          <Cta label="Discover" onPress={() => { if (p.value > 0.9) ad.explore(); }} />
        </Animated.View>
      </DBox>
    </View>
  );
}

export const gift: StyleDef = {
  Comp: GiftAd,
  hint: 'Pull the ribbon down to unbox',
  ghost: [[150, 380], [150, 470]],
};
