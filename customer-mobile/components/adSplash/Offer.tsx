// The revealed offer (design offerHTML() + .offer/.o-* styles + flourish()): radial background in the ad's
// two colours, slow light rays, store name, the photo feathered in, the offer in big display type, the
// line, and the yellow Explore button. `live` (0/1) brings the button in and pops the photo; `glow` (0/1)
// starts the bob, the shine sweep over the offer and the count-up of its number (the design's flourish).
import React, { useMemo } from 'react';
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { Group, LinearGradient, Paragraph, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { Cta, DBox, DesignCanvas, DH, DW, FONT, FeatheredArt, Rays, fitOneLine, makePara, useAd } from './kit';

/** Layout of the offer column (CSS flex, gap 8, padding 40 26 30, centred) computed in design units. */
export function offerLayout(subH: number, offSize: number) {
  const brandH = 14; const artH = 210; const artVis = artH - 28; const ctaH = 38; const gap = 8;
  const total = brandH + gap + artVis + gap + offSize + gap + subH + 6 + gap + ctaH;
  let y = 40 + (DH - 70 - total) / 2;
  const brandY = y; y += brandH + gap;
  const artY = y - 14; y += artVis + gap;
  const offY = y; y += offSize + gap;
  const subY = y; y += subH + 6 + gap;
  const ctaY = y;
  return { brandY, artY, artH, offY, subY, ctaY, ctaH };
}

export function OfferFace({ live, glow, offSize: maxOff = 44, ctaLabel = 'Explore Offer', center = [0.5, 0.36], spread = 0.78, rays = true, opacity, scale, brightness }: {
  live: SharedValue<number>; glow: SharedValue<number>; offSize?: number; ctaLabel?: string;
  center?: [number, number]; spread?: number; rays?: boolean;
  opacity?: SharedValue<number>; scale?: SharedValue<number>; brightness?: SharedValue<number>; // portal
}) {
  const { ad, fm, stage, explore } = useAd();
  const sub = useMemo(() => makePara(fm, ad.subline || '', 200, { family: FONT.body, size: 12, weight: 500, color: 'rgba(255,255,255,0.92)', lineHeight: 1.35 }), [fm, ad.subline]);
  const brand = useMemo(() => makePara(fm, ad.store.name.toUpperCase(), 260, { family: FONT.body, size: 11, weight: 700, letterSpacing: 1.3, color: 'rgba(255,255,255,0.9)' }), [fm, ad.store.name]);
  // the offer always sits on one line: a long one ("FLAT 15% OFF") is set smaller instead of wrapping
  const offSize = useMemo(() => fitOneLine(fm, ad.offerText, DW - 20, { family: FONT.display, size: maxOff, weight: 700 }), [fm, ad.offerText, maxOff]);
  const L = offerLayout(sub ? sub.getHeight() : 16, offSize);

  // offer number count-up (design countUp: 0 -> N over 900 ms, ease-out cubic)
  const num = useMemo(() => { const m = ad.offerText.match(/\d+/); return m ? Number(m[0]) : null; }, [ad.offerText]);
  const count = useSharedValue(num ?? 0);
  const shine = useSharedValue(0);
  const shineOn = useSharedValue(0);
  const pop = useSharedValue(0); // 0 = not yet live
  const bob = useSharedValue(0);
  useAnimatedReaction(() => live.value, (v, prev) => {
    if (v && !prev) {
      pop.value = 0.7;
      pop.value = withSpring(1, { damping: 7, stiffness: 160, mass: 0.6 });
    }
  });
  useAnimatedReaction(() => glow.value, (v, prev) => {
    if (v && !prev) {
      if (num !== null) { count.value = 0; count.value = withTiming(num, { duration: 900, easing: Easing.out(Easing.cubic) }); }
      shineOn.value = 1;
      shine.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1, false);
      bob.value = withDelay(live.value ? 700 : 0, withRepeat(withSequence(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1700, easing: Easing.inOut(Easing.sin) })), -1, false));
    }
  });
  const offText = ad.offerText;
  // Every step of the count-up laid out once here (0 .. N): building a paragraph on the UI thread on every
  // frame of the count-up cost the glass ad a burst of dropped frames right at the reveal.
  const offParas = useMemo(() => {
    const spec = { family: FONT.display, size: offSize, weight: 700, color: '#ffffff', lineHeight: 1, shadow: { color: 'rgba(0,0,0,0.35)', blur: 7, dy: 3 } };
    if (num === null || num > 100) return [makePara(fm, offText, DW - 20, spec)];
    return Array.from({ length: num + 1 }, (_, i) => makePara(fm, offText.replace(/\d+/, String(i)), DW - 20, spec));
  }, [fm, offText, offSize, num]);
  const offPara = useDerivedValue(() => (offParas.length === 1 ? offParas[0] : offParas[Math.min(offParas.length - 1, Math.max(0, Math.round(count.value)))]));
  const shineStart = useDerivedValue(() => vec(DW * (1.3 - 2.6 * shine.value) - DW * 1.3, 0));
  const shineEnd = useDerivedValue(() => vec(DW * (1.3 - 2.6 * shine.value) + DW * 1.3, 0));
  const shineOpacity = useDerivedValue(() => shineOn.value);

  const artTransform = useDerivedValue(() => {
    const s = live.value ? pop.value || 1 : 1;
    return [{ translateY: -9 * bob.value }, { rotate: (1.2 * Math.PI / 180) * bob.value }, { scale: s }];
  });
  const cx = DW * center[0]; const cy = DH * center[1];
  const bgR = Math.hypot(Math.max(cx, DW - cx), Math.max(cy, DH - cy)) * spread;
  const art = { x: (DW - 210) / 2, y: L.artY, w: 210, h: 210 };
  const ctaStyle = useAnimatedStyle(() => ({
    opacity: withDelay(300, withTiming(live.value ? 1 : 0, { duration: 400 })),
    transform: [{ translateY: withDelay(300, withTiming(live.value ? 0 : 6 * stage.k, { duration: 400 })) }],
  }));
  const wrapStyle = useAnimatedStyle(() => ({ opacity: opacity ? opacity.value : 1, transform: [{ scale: scale ? scale.value : 1 }] }));
  const brightLayer = useDerivedValue(() => (brightness ? Math.max(0, brightness.value - 1) : 0));

  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, wrapStyle]} pointerEvents="box-none">
      <DesignCanvas>
        <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3}>
          <RadialGradient c={vec(cx, cy)} r={bgR} colors={[ad.colorA, ad.colorB]} />
        </Rect>
        {rays ? <Rays cx={150} cy={296} size={560} inner={0.113} outer={0.933} /> : null}
        {brand ? <Paragraph paragraph={brand} x={(DW - 260) / 2} y={L.brandY} width={260} /> : null}
        <Group origin={vec(art.x + art.w / 2, art.y + art.h / 2)} transform={artTransform}>
          <FeatheredArt x={art.x} y={art.y} w={art.w} h={art.h} />
        </Group>
        <Group layer>
          <Paragraph paragraph={offPara} x={10} y={L.offY} width={DW - 20} />
          <Group opacity={shineOpacity}>
            <Rect x={0} y={L.offY - 6} width={DW} height={offSize + 14} blendMode="srcIn">
              <LinearGradient start={shineStart} end={shineEnd} colors={['#ffffff', '#ffffff', '#ffe7a8', '#fff3c4', '#ffe7a8', '#ffffff', '#ffffff']} positions={[0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]} />
            </Rect>
          </Group>
        </Group>
        {sub ? <Paragraph paragraph={sub} x={(DW - 200) / 2} y={L.subY} width={200} /> : null}
        <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3} color="white" opacity={brightLayer} blendMode="softLight" />
      </DesignCanvas>
      <DBox x={0} y={L.ctaY} w={DW} h={L.ctaH} style={{ alignItems: 'center' }} pointerEvents="box-none">
        <Animated.View style={ctaStyle}>
          <Cta label={ctaLabel} onPress={() => { if (live.value) explore(); }} />
        </Animated.View>
      </DBox>
    </Animated.View>
  );
}
