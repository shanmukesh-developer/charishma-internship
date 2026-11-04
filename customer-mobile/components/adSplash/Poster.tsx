// The paper poster ad (design paintPoster() for Tear, poster() for Peel): the ad's colours, the photo
// feathered in the middle, the headline, a yellow offer stamp, the brand mark, paper grain, the two fold
// creases, a vignette and a sheen. Skia elements in design units (put inside DesignCanvas / Eraser).
import React, { useMemo } from 'react';
import { Circle, Group, LinearGradient, Paragraph, Picture, RadialGradient, Rect, Skia, createPicture, vec } from '@shopify/react-native-skia';
import { DH, DW, FONT, FeatheredArt, makePara, useAd } from './kit';

/** Paper grain: 5200 specks, recorded once. */
function useGrain() {
  return useMemo(() => createPicture((c) => {
    const p = Skia.Paint();
    for (let i = 0; i < 5200; i++) {
      p.setColor(Skia.Color(Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'));
      c.drawRect(Skia.XYWHRect(Math.random() * DW, Math.random() * DH, 0.5 + Math.random(), 0.5 + Math.random()), p);
    }
  }, Skia.XYWHRect(0, 0, DW, DH)), []);
}

/**
 * Peel's sticker face (design poster() + .poster CSS, sticker variant): 160deg red gradient, ZCS mark,
 * 34 px headline, 210 photo, 11 px line, 68 px yellow stamp at right 16 / bottom 70 turned -10deg. The
 * design hides the paper grain / creases / sheen on the sticker (.sticker .poster::after{display:none}).
 */
export function StickerArt({ colors = ['#e23a3a', '#a11319'] }: { colors?: [string, string] }) {
  const { ad, fm } = useAd();
  const head = useMemo(() => makePara(fm, ad.headline, 256, { family: FONT.display, size: 34, weight: 700, color: '#fff', lineHeight: 1.02, shadow: { color: 'rgba(0,0,0,0.4)', blur: 5, dy: 2 } }), [fm, ad.headline]);
  const brand = useMemo(() => makePara(fm, 'ZenWe', 120, { family: FONT.display, size: 15, weight: 700, color: '#fff', align: 'left' }), [fm]);
  const sub = useMemo(() => makePara(fm, ad.subline || '', 256, { family: FONT.body, size: 11, weight: 400, color: 'rgba(255,255,255,0.9)' }), [fm, ad.subline]);
  const [o1, o2] = useMemo(() => { const w = ad.offerText.split(' OFF'); return [w[0] || ad.offerText, w.length > 1 ? 'OFF' : '']; }, [ad.offerText]);
  const s1 = useMemo(() => makePara(fm, o1, 64, { family: FONT.body, size: 13, weight: 700, color: '#2a1c00', lineHeight: 1.05 }), [fm, o1]);
  const s2 = useMemo(() => makePara(fm, o2, 64, { family: FONT.body, size: 13, weight: 700, color: '#2a1c00', lineHeight: 1.05 }), [fm, o2]);
  const headH = head ? head.getHeight() : 70; const subH = sub ? sub.getHeight() : 14;
  const total = headH + 6 + 210 + 6 + subH;
  const top = 54 + (DH - 54 - 40 - total) / 2;
  const cx = DW - 16 - 34; const cy = DH - 70 - 34;
  const s1H = s1 ? s1.getHeight() : 14; const s2H = s2 ? s2.getHeight() : 0;
  return (
    <Group>
      <Rect x={0} y={0} width={DW} height={DH}>
        <LinearGradient start={vec(32.8, -11.9)} end={vec(267.2, 631.9)} colors={colors} />
      </Rect>
      {brand ? <Paragraph paragraph={brand} x={40} y={36} width={120} /> : null}
      {head ? <Paragraph paragraph={head} x={22} y={top} width={256} /> : null}
      <FeatheredArt x={45} y={top + headH + 6} w={210} h={210} />
      {sub ? <Paragraph paragraph={sub} x={22} y={top + headH + 6 + 210 + 6} width={256} /> : null}
      <Group origin={vec(cx, cy)} transform={[{ rotate: (-10 * Math.PI) / 180 }]}>
        <Circle cx={cx} cy={cy} r={34} color="#f4c430" />
        {s1 ? <Paragraph paragraph={s1} x={cx - 32} y={cy - (s1H + s2H) / 2} width={64} /> : null}
        {s2 ? <Paragraph paragraph={s2} x={cx - 32} y={cy - (s1H + s2H) / 2 + s1H} width={64} /> : null}
      </Group>
    </Group>
  );
}

export function PosterArt({ bg = 'radial' }: { bg?: 'radial' | [string, string] }) {
  const { ad, fm } = useAd();
  const grain = useGrain();
  // Each headline line stays whole and is squeezed to 260 wide when longer (the design's fillText maxWidth).
  const head = useMemo(() => {
    const p = makePara(fm, ad.headline, 4000, { family: FONT.display, size: 44, weight: 700, color: '#fff', lineHeight: 48 / 44, shadow: { color: 'rgba(0,0,0,0.55)', blur: 11 }, align: 'left' });
    const w = p ? Math.ceil(p.getLongestLine()) + 2 : 260;
    return { p: makePara(fm, ad.headline, w, { family: FONT.display, size: 44, weight: 700, color: '#fff', lineHeight: 48 / 44, shadow: { color: 'rgba(0,0,0,0.55)', blur: 11 } }), w };
  }, [fm, ad.headline]);
  const brand = useMemo(() => makePara(fm, 'ZenWe', 120, { family: FONT.display, size: 20, weight: 700, color: '#fff', align: 'left' }), [fm]);
  const spons = useMemo(() => makePara(fm, 'SPONSORED', 120, { family: FONT.body, size: 11, weight: 500, color: 'rgba(255,255,255,0.8)', align: 'right', letterSpacing: 0.6 }), [fm]);
  // Under the photo, left of the stamp: clear of the bottom hint (the design had them on top of each other).
  const sub = useMemo(() => makePara(fm, ad.subline || '', 176, { family: FONT.body, size: 13, weight: 500, color: 'rgba(255,255,255,0.92)', align: 'left', lineHeight: 1.3 }), [fm, ad.subline]);
  const [o1, o2] = useMemo(() => { const w = ad.offerText.replace(/^FLAT\s+/i, '').split(' '); return [w[0] || '', w.slice(1).join(' ')]; }, [ad.offerText]);
  const stamp1 = useMemo(() => makePara(fm, o1, 76, { family: FONT.display, size: 22, weight: 700, color: '#2a1c00', lineHeight: 1 }), [fm, o1]);
  const stamp2 = useMemo(() => makePara(fm, o2, 76, { family: FONT.display, size: 15, weight: 700, color: '#2a1c00', lineHeight: 1 }), [fm, o2]);
  const headH = head.p ? head.p.getHeight() : 96;
  const squeeze = Math.min(1, 260 / head.w);
  return (
    <Group>
      <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3}>
        {bg === 'radial'
          ? <RadialGradient c={vec(150, 320)} r={480} colors={[ad.colorA, ad.colorB]} />
          : <LinearGradient start={vec(DW * 0.33, 0)} end={vec(DW * 0.67, DH)} colors={bg} />}
      </Rect>
      <FeatheredArt x={20} y={210} w={260} h={260} />
      {head.p ? (
        <Group origin={vec(150, 0)} transform={[{ scaleX: squeeze }]}>
          <Paragraph paragraph={head.p} x={150 - head.w / 2} y={Math.max(78, 150 - headH / 2)} width={head.w} />
        </Group>
      ) : null}
      {brand ? <Paragraph paragraph={brand} x={22} y={57} width={120} /> : null}
      {spons ? <Paragraph paragraph={spons} x={158} y={62} width={120} /> : null}
      {sub ? <Paragraph paragraph={sub} x={22} y={478} width={176} /> : null}
      <Group origin={vec(240, 495)} transform={[{ rotate: -0.18 }]}>
        <Circle cx={240} cy={495} r={38} color="#f4c430" />
        {stamp1 ? <Paragraph paragraph={stamp1} x={202} y={o2 ? 476 : 484} width={76} /> : null}
        {stamp2 ? <Paragraph paragraph={stamp2} x={202} y={499} width={76} /> : null}
      </Group>
      <Picture picture={grain} />
      <Rect x={99.5} y={-DH} width={1} height={DH * 3} color="rgba(0,0,0,0.2)" />
      <Rect x={-DW} y={309.5} width={DW * 3} height={1} color="rgba(0,0,0,0.2)" />
      <Rect x={100.5} y={-DH} width={1} height={DH * 3} color="rgba(255,255,255,0.17)" />
      <Rect x={-DW} y={310.5} width={DW * 3} height={1} color="rgba(255,255,255,0.17)" />
      <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3}>
        <RadialGradient c={vec(150, 310)} r={410} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.42)']} positions={[0, 150 / 410, 1]} />
      </Rect>
      <Rect x={-DW} y={-DH} width={DW * 3} height={DH * 3}>
        <LinearGradient start={vec(0, 0)} end={vec(DW, DH)} colors={['rgba(255,255,255,0.15)', 'rgba(255,255,255,0)']} positions={[0, 0.35]} />
      </Rect>
    </Group>
  );
}
