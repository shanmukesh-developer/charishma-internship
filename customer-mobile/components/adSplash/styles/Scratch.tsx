// 2. Scratch to Discover (design scratch() + paintFoil()): a silver scratch card covers the offer. Rubbing it
// scrapes the foil away (silver flakes fly); once ~36 % is cleared the foil fades, the offer goes live with a
// burst of foil-coloured confetti, the star burst, the golden wave and the shine / count-up glow.
// The foil is painted once (metallic gradient, brushed streaks, colour speckle, the diagonal sheen, embossed
// "Scratch / & Win", "Special offer inside", the double border) into a picture and rasterised at the
// screen's pixel density, so every frame of scratching only replays one image under the erased holes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  Image as SkiaImage, Picture, PaintStyle, Skia, TileMode, createPicture,
  type SkCanvas, type SkImage, type SkParagraph, type SkPicture,
} from '@shopify/react-native-skia';
import { Eraser } from '../Eraser';
import { OfferFace } from '../Offer';
import { DH, DW, FONT, makePara, serp, useAd, pictureToImage } from '../kit';
import type { StyleDef } from './types';

const PW = 600; // paragraph layout width (text is centred on x = 150, never wraps)

/** Draws a one-line paragraph centred on x = 150 with its baseline at `baseline` (canvas fillText). */
function fillCentered(c: SkCanvas, para: SkParagraph | null, baseline: number, dx = 0, dy = 0) {
  if (!para) return;
  const m = para.getLineMetrics()[0];
  const bl = m ? m.baseline : para.getHeight() * 0.8;
  para.paint(c, 150 - PW / 2 + dx, baseline - bl + dy);
}

/** Picture -> raster image at `scale` device px per design unit (null if the offscreen surface fails). */
function rasterize(pic: SkPicture, scale: number): SkImage | null {
  try {
    const w = Math.ceil(DW * scale);
    const h = Math.ceil(DH * scale);
    const scaled = createPicture((c) => { c.scale(scale, scale); c.drawPicture(pic); }, Skia.XYWHRect(0, 0, w, h));
    return pictureToImage(scaled, w, h);
  } catch {
    return null;
  }
}

/** paintFoil(), halved into design units. */
function useFoil() {
  const { fm, stage } = useAd();
  const scale = Math.min(4, stage.k * PixelRatio.get());
  return useMemo(() => {
    const big = (color: string) => makePara(fm, 'Scratch', PW, { family: FONT.display, size: 42, weight: 700, color });
    const win = (color: string) => makePara(fm, '& Win', PW, { family: FONT.display, size: 42, weight: 700, color });
    const passes: Array<[number, number, string]> = [[-1, -1, 'rgba(255,255,255,0.9)'], [1, 1, 'rgba(40,48,54,0.55)'], [0, 0, '#7b848a']];
    const texts = passes.map(([dx, dy, col]) => ({ dx, dy, a: big(col), b: win(col) }));
    const inside = makePara(fm, 'Special offer inside', PW, { family: FONT.body, size: 17, weight: 500, color: '#6a7378' });

    const pic = createPicture((c) => {
      const p = Skia.Paint();
      p.setAntiAlias(true);
      // metallic base
      p.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: DW, y: DH },
        ['#e4e7ea', '#a9b0b5', '#eef0f2', '#9aa1a6', '#d6dadd'].map((s) => Skia.Color(s)), [0, 0.3, 0.55, 0.8, 1], TileMode.Clamp));
      c.drawRect(Skia.XYWHRect(0, 0, DW, DH), p);
      p.setShader(null);
      // fine horizontal brushed streaks
      p.setAntiAlias(false);
      for (let i = 0; i < 1400; i++) {
        if (Math.random() > 0.5) { p.setColor(Skia.Color('#ffffff')); p.setAlphaf(0.05 + Math.random() * 0.16); }
        else { p.setColor(Skia.Color('rgb(40,50,56)')); p.setAlphaf(0.03 + Math.random() * 0.08); }
        c.drawRect(Skia.XYWHRect(0, Math.random() * DH, DW, (0.6 + Math.random() * 1.6) / 2), p);
      }
      // colour speckle
      const spk = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const col = Skia.Color(`rgba(${k & 1 ? 255 : 60},${k & 2 ? 255 : 60},${k & 4 ? 255 : 70},0.1)`); return col; });
      for (let i = 0; i < 2200; i++) {
        p.setColor(spk[(Math.random() > 0.5 ? 1 : 0) | (Math.random() > 0.5 ? 2 : 0) | (Math.random() > 0.5 ? 4 : 0)]);
        c.drawRect(Skia.XYWHRect(Math.random() * DW, Math.random() * DH, 1, 1), p);
      }
      p.setAntiAlias(true);
      // diagonal sheen band (the design rotates the canvas 0.5 rad and fills a 60-wide band of a 0..300 gradient)
      c.save();
      c.rotate((0.5 * 180) / Math.PI, 0, 0);
      p.setColor(Skia.Color('#ffffff'));
      p.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: DW, y: 0 },
        [Skia.Color('rgba(255,255,255,0)'), Skia.Color('rgba(255,255,255,0.38)'), Skia.Color('rgba(255,255,255,0)')], [0, 0.5, 1], TileMode.Clamp));
      c.drawRect(Skia.XYWHRect(60, -100, 60, 900), p);
      p.setShader(null);
      c.restore();
      // embossed lettering: highlight up-left, shadow down-right, then the face
      for (const t of texts) { fillCentered(c, t.a, 260, t.dx, t.dy); fillCentered(c, t.b, 308, t.dx, t.dy); }
      fillCentered(c, inside, 350);
      // double border
      p.setStyle(PaintStyle.Stroke);
      p.setColor(Skia.Color('rgba(255,255,255,0.7)'));
      p.setStrokeWidth(3);
      c.drawRect(Skia.XYWHRect(1.5, 1.5, 297, 617), p);
      p.setColor(Skia.Color('rgba(60,70,76,0.45)'));
      p.setStrokeWidth(1);
      c.drawRect(Skia.XYWHRect(5, 5, 290, 610), p);
    }, Skia.XYWHRect(0, 0, DW, DH));
    return { pic, img: rasterize(pic, scale) };
  }, [fm, scale]);
}

function Scratch() {
  const ad = useAd();
  const live = useSharedValue(0);
  const glow = useSharedValue(0);
  const [gone, setGone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const foil = useFoil();

  const onReveal = () => {
    live.value = 1;
    ad.burstJS(150, 300, 26, ['#f4c430', '#ffffff', '#e6e9ec'], 5, 0.16, 5, 'rect');
    // flourish(offer, 150, 290)
    ad.burstJS(150, 290, 40, ['#fff6d6', '#ffd36b', '#ffffff', '#ffb347'], 6, 0.05, 6, 'star');
    ad.wave(150, 290);
    glow.value = 1;
    // the foil fades in 500 ms; then its touch layer goes so the Explore button can be pressed
    timer.current = setTimeout(() => setGone(true), 520);
  };

  return (
    <>
      <OfferFace live={live} glow={glow} />
      {gone ? null : (
        <Eraser
          surface={foil.img
            ? <SkiaImage image={foil.img} x={-ad.stage.dx} y={-ad.stage.dy} width={DW + 2 * ad.stage.dx} height={DH + 2 * ad.stage.dy} fit="fill" />
            : <Picture picture={foil.pic} />}
          kind="scratch"
          need={0.36}
          gap={6}
          r={21}
          sound="foil"
          autoPath={serp(115, 505, 47.5)}
          fx={{ cols: ['#e6e9ec', '#a3abb0', '#ffffff'], spd: 2.4, g: 0.22 }}
          exit="fade"
          onReveal={onReveal}
        />
      )}
    </>
  );
}

export const scratch: StyleDef = {
  Comp: Scratch,
  hint: 'Scratch the silver with your finger',
  ghost: [[80, 300], [220, 300], [80, 360], [220, 360], [80, 420], [220, 420]],
};
