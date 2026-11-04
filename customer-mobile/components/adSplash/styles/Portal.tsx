// 7. Unlock the ZCS Portal (design portal()): a dark green field with the ZCS mark in the middle, ringed by
// a glowing green portal and 46 orbiting sparks. Swiping anywhere (distance / 130 = progress) opens a round
// hole from the centre; the ring and its sparks grow and fade with it, and the sponsor's offer behind grows
// from 80 % and settles from over-bright to normal. Past 35 % (or on a tap) it opens fully by itself; then
// the ring and sparks go and the offer gets the star burst, the golden wave and the shine / count-up glow.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Easing, cancelAnimation, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  BlendMode, BlurMask, BlurStyle, Circle, ColorMatrix, Group, Paint, Paragraph, Path, Picture, RadialGradient, Rect, Skia, vec,
} from '@shopify/react-native-skia';
import { OfferFace } from '../Offer';
import { DH, DW, DesignCanvas, FONT, clamp, makePara, rnd, useAd, useProgressGesture } from '../kit';
import type { StyleDef } from './types';

const CX = 150;
const CY = 620 * 0.44; // 272.8: the portal sits at 50 % 44 %
const TOP_R = 0.7 * Math.hypot(150, 620 - CY); // radial-gradient(circle at 50% 44%, ..., #04100a 70%) of the farthest corner
const LEAF = 'M5 27C3 12 12 4 28 4c1 15-6 23-19 23z';
const STEM = 'M5 27C12 18 17 13 25 8';

type Orb = { a: number; o: number; v: number; s: number };

function Portal() {
  const ad = useAd();
  const { fm } = ad;
  const reduce = useReducedMotion();
  const live = useSharedValue(0);
  const glow = useSharedValue(0);
  const [open, setOpen] = useState(false);

  const { p, gesture } = useProgressGesture({
    map: (dx, dy) => { 'worklet'; return Math.hypot(dx, dy) / 130; },
    th: 0.35,
    ms: 700,
    sound: 'glass',
    after: () => {
      setOpen(true); // ring + sparks removed, the touch layer goes so Explore can be pressed
      live.value = 1;
      // flourish(offer, 150, 273)
      ad.burstJS(150, 273, 40, ['#fff6d6', '#ffd36b', '#ffffff', '#ffb347'], 6, 0.05, 6, 'star');
      ad.wave(150, 273);
      glow.value = 1;
    },
  });

  // offer behind the portal: scale(.8 + .2 * clamp(p * 1.2)), brightness(1.5 - .5 * clamp(p * 1.3))
  const offScale = useDerivedValue(() => 0.8 + 0.2 * clamp(p.value * 1.2));
  const offBright = useDerivedValue(() => 1.5 - 0.5 * clamp(p.value * 1.3));

  // the hole: mask radial-gradient(transparent r, #000 r + 2px), r = p * 440
  const holeR = useDerivedValue(() => p.value * 440 + 2);
  const holePos = useDerivedValue(() => { const r = p.value * 440; return [0, r / (r + 2), 1]; });
  const holeOn = useDerivedValue(() => (p.value > 0 ? 1 : 0));
  const labOp = useDerivedValue(() => 0.9 * (1 - clamp(p.value * 3)));

  // the ring: border-box 150 + 2r across, border 5, glows outside and inside, opacity 1 - r / 380
  const ringR = useDerivedValue(() => 75 + p.value * 440);
  const ringMid = useDerivedValue(() => ringR.value - 2.5);
  const ringIn = useDerivedValue(() => ringR.value - 5);
  const ringClip = useDerivedValue(() => { const q = Skia.Path.Make(); q.addCircle(CX, CY, ringR.value - 5); return q; });
  const ringOp = useDerivedValue(() => clamp(1 - (p.value * 440) / 380));
  const pulse = useSharedValue(reduce ? 0.4 : 0); // brightness .8 <-> 1.3, 2.2 s alternate (none with reduced motion: 1)
  useEffect(() => {
    if (reduce) return;
    pulse.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.bezier(0.25, 0.1, 0.25, 1) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const ringMat = useDerivedValue(() => {
    const b = 0.8 + 0.5 * pulse.value;
    return [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
  });

  // 46 orbiting sparks on the ring, faster as it opens ('lighter' blend, 8 px canvas glow = sigma 2)
  const orbs = useSharedValue<Orb[]>(Array.from({ length: 46 }, () => ({ a: rnd(0, 6.28), o: rnd(-10, 16), v: rnd(0.012, 0.03) * (Math.random() < 0.5 ? 1 : -1), s: rnd(1, 2.8) })));
  const tick = useSharedValue(0);
  const sparksOn = useSharedValue(1);
  useEffect(() => { sparksOn.value = open ? 0 : 1; }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrameCallback((f) => {
    if (!sparksOn.value) return;
    const step = Math.min(3, (f.timeSincePreviousFrame ?? 16.67) / 16.67); // the design steps once per 60 Hz frame
    const pr = p.value;
    orbs.modify((os) => {
      'worklet';
      for (const q of os) q.a += q.v * (1 + pr * 3) * step;
      return os;
    });
    tick.value += 1;
  });
  const sparks = useDerivedValue(() => {
    tick.value; // redraw every frame
    const pr = p.value;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(-DW, -DH, DW * 3, DH * 3));
    const alpha = clamp(1 - pr * 1.1) * 0.9;
    if (alpha > 0) {
      const R = 75 + pr * 440;
      const halo = Skia.Paint();
      halo.setAntiAlias(true);
      halo.setBlendMode(BlendMode.Plus);
      halo.setColor(Skia.Color('#1fe08a'));
      halo.setAlphaf(alpha);
      halo.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 2, true));
      const dot = Skia.Paint();
      dot.setAntiAlias(true);
      dot.setBlendMode(BlendMode.Plus);
      const big = Skia.Color('#d9ffe9');
      const small = Skia.Color('#43e598');
      for (const q of orbs.value) {
        const x = CX + Math.cos(q.a) * (R + q.o);
        const y = 273 + Math.sin(q.a) * (R + q.o);
        c.drawCircle(x, y, q.s, halo);
        dot.setColor(q.s > 2 ? big : small);
        dot.setAlphaf(alpha);
        c.drawCircle(x, y, q.s, dot);
      }
    }
    return rec.finishRecordingAsPicture();
  });

  // ZCS mark (the design's leaf, 46 x 46) over the name, a column with a 4 px gap centred on the portal
  const name = useMemo(() => makePara(fm, 'ZENV', 600, { family: FONT.display, size: 24, weight: 700, color: '#ffffff', letterSpacing: -0.24 }), [fm]);
  const label = useMemo(() => makePara(fm, 'Swipe to unlock', 600, { family: FONT.body, size: 12, weight: 400, color: '#ffffff' }), [fm]);
  const nameH = name ? name.getHeight() : 30;
  const logoTop = CY - (46 + 4 + nameH) / 2;

  return (
    <>
      <OfferFace live={live} glow={glow} offSize={34} center={[0.5, 0.4]} spread={0.8} ctaLabel="Explore" scale={offScale} brightness={offBright} />
      <DesignCanvas>
        {/* dark top layer with the round hole */}
        <Group layer>
          <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3}>
            <RadialGradient c={vec(CX, CY)} r={TOP_R} colors={['#0c3a25', '#04100a']} />
          </Rect>
          <Group transform={[{ translateX: CX - 23 }, { translateY: logoTop }, { scale: 46 / 32 }]}>
            <Path path={LEAF} color="#2fa86a" />
            <Path path={STEM} color="#e9fff3" style="stroke" strokeWidth={2} strokeCap="round" />
          </Group>
          {name ? <Paragraph paragraph={name} x={CX - 300} y={logoTop + 50} width={600} /> : null}
          {label ? (
            <Group layer={<Paint opacity={labOp} />}>
              <Paragraph paragraph={label} x={CX - 300} y={DH * 0.66} width={600} />
            </Group>
          ) : null}
          <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3} blendMode="dstOut" opacity={holeOn}>
            <RadialGradient c={vec(CX, CY)} r={holeR} colors={['#000000', '#000000', 'rgba(0,0,0,0)']} positions={holePos} />
          </Rect>
        </Group>
        {open ? null : (
          <>
            {/* glowing ring */}
            <Group layer={<Paint opacity={ringOp}><ColorMatrix matrix={ringMat} /></Paint>}>
              <Circle cx={CX} cy={CY} r={ringR} color="#1fe08a">
                <BlurMask blur={13} style="outer" />
              </Circle>
              <Group layer clip={ringClip}>
                <Rect x={CX - 700} y={CY - 700} width={1400} height={1400} color="#1fe08a" />
                <Circle cx={CX} cy={CY} r={ringIn} color="#000000" blendMode="dstOut">
                  <BlurMask blur={13} style="normal" />
                </Circle>
              </Group>
              <Circle cx={CX} cy={CY} r={ringMid} color="#43e598" style="stroke" strokeWidth={5} />
            </Group>
            {/* orbiting sparks */}
            <Group layer>
              <Picture picture={sparks} />
            </Group>
          </>
        )}
      </DesignCanvas>
      {open ? null : (
        <GestureDetector gesture={gesture}>
          <View style={[StyleSheet.absoluteFill, { zIndex: 5 }]} />
        </GestureDetector>
      )}
    </>
  );
}

export const portal: StyleDef = {
  Comp: Portal,
  hint: 'Swipe the glowing logo to open the portal',
  ghost: [[150, 275], [260, 275]],
};
