// 5. Wipe the Glass (design glass() + paintGlass()): a misted, rain-beaded window hides the offer. Through it
// the offer is a soft blur of its own colours, photo and price; wiping clears soft-edged streaks, and if the
// finger rests for 1.2 s the fog creeps back. Once ~40 % is clear the glass fades and the offer goes live
// with the star burst, the golden wave and the shine / count-up glow.
// The fog is painted once: a heavily blurred copy of the offer (rendered small, Gaussian-blurred, upscaled,
// like the design's 50 x 104 down-and-up sample), the misty tint, ~380 water droplets with running drip
// streaks, and the handwritten "Clear the fog… / Discover local deals!" in Caveat; then it is rasterised at
// the screen's pixel density so wiping only replays one image under the erased holes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  BlendMode, FilterMode, Image as SkiaImage, MipmapMode, PaintStyle, Picture, Skia, StrokeCap, TileMode, createPicture,
  type SkCanvas, type SkImage, type SkParagraph, type SkPicture,
} from '@shopify/react-native-skia';
import { Eraser } from '../Eraser';
import { OfferFace } from '../Offer';
import { DH, DW, FONT, fitOneLine, makePara, serp, useAd, pictureToImage } from '../kit';
import type { StyleDef } from './types';

const PW = 600; // paragraph layout width (text is centred on x = 150, never wraps)
const BLUR = 6; // design units; matches the softness of the design's 12x down / up sample

/** Canvas fillText(text, 150, baseline, maxWidth) for a one-line centred paragraph; `skew` = synthetic italic. */
function fillCentered(c: SkCanvas, para: SkParagraph | null, baseline: number, maxW = 0, skew = 0) {
  if (!para) return;
  const m = para.getLineMetrics()[0];
  const bl = m ? m.baseline : para.getHeight() * 0.8;
  const lw = m ? m.width : 0;
  c.save();
  c.translate(150, baseline);
  if (maxW && lw > maxW) c.scale(maxW / lw, 1);
  if (skew) c.skew(skew, 0);
  para.paint(c, -PW / 2, -bl);
  c.restore();
}

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

/** paintGlass(), halved into design units. */
function useFog() {
  const { ad, art, fm, stage } = useAd();
  const scale = Math.min(4, stage.k * PixelRatio.get());
  return useMemo(() => {
    const offSpec = { family: FONT.display, size: 44, weight: 700, color: '#ffffff' };
    const off = makePara(fm, ad.offerText, PW, { ...offSpec, size: fitOneLine(fm, ad.offerText, DW - 20, offSpec) });
    const sub = makePara(fm, ad.subline || '', PW, { family: FONT.body, size: 13, weight: 500, color: '#ffffff' });
    const hand = (t: string) => makePara(fm, t, PW, { family: FONT.hand, size: 32, weight: 600, color: 'rgba(255,255,255,0.85)' });
    const h1 = hand('Clear the fog…');
    const h2 = hand('Discover local deals!');

    // What sits behind the glass: the offer's colours, the photo feathered in, the offer and its line.
    const source = createPicture((c) => {
      const p = Skia.Paint();
      p.setAntiAlias(true);
      p.setShader(Skia.Shader.MakeRadialGradient({ x: 150, y: 250 }, 380, [Skia.Color(ad.colorA), Skia.Color(ad.colorA), Skia.Color(ad.colorB)], [0, 20 / 380, 1], TileMode.Clamp));
      c.drawRect(Skia.XYWHRect(0, 0, DW, DH), p);
      p.setShader(null);
      if (art) {
        const dst = Skia.XYWHRect(40, 165, 220, 220);
        const iw = art.width(); const ih = art.height();
        const s = Math.max(220 / iw, 220 / ih); const sw = 220 / s; const sh = 220 / s;
        c.saveLayer();
        c.drawImageRectOptions(art, Skia.XYWHRect((iw - sw) / 2, (ih - sh) / 2, sw, sh), dst, FilterMode.Linear, MipmapMode.Linear, null);
        const m = Skia.Paint();
        m.setBlendMode(BlendMode.DstIn);
        m.setShader(Skia.Shader.MakeRadialGradient({ x: 150, y: 275 }, 110, [Skia.Color('#000'), Skia.Color('#000'), Skia.Color('rgba(0,0,0,0)')], [0, 0.6, 1], TileMode.Clamp));
        c.drawRect(dst, m);
        c.restore();
      }
      fillCentered(c, off, 440);
      fillCentered(c, sub, 470, 260);
    }, Skia.XYWHRect(0, 0, DW, DH));
    // Blur it at 1 px per design unit (sigma in design units, no CTM guesswork), then upscale smoothly.
    const blurred = (() => {
      try {
        const bp = Skia.Paint();
        bp.setImageFilter(Skia.ImageFilter.MakeBlur(BLUR, BLUR, TileMode.Clamp, null));
        const pic = createPicture((c) => { c.saveLayer(bp); c.drawPicture(source); c.restore(); }, Skia.XYWHRect(0, 0, DW, DH));
        return pictureToImage(pic, DW, DH);
      } catch {
        return null;
      }
    })();

    const pic = createPicture((c) => {
      const p = Skia.Paint();
      p.setAntiAlias(true);
      if (blurred) {
        c.drawImageRectOptions(blurred, Skia.XYWHRect(0, 0, blurred.width(), blurred.height()), Skia.XYWHRect(0, 0, DW, DH), FilterMode.Linear, MipmapMode.None, null);
      } else {
        const bp = Skia.Paint();
        bp.setImageFilter(Skia.ImageFilter.MakeBlur(BLUR, BLUR, TileMode.Clamp, null));
        c.saveLayer(bp); c.drawPicture(source); c.restore();
      }
      // misty tint
      p.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: DH }, [Skia.Color('rgba(205,222,218,0.55)'), Skia.Color('rgba(176,198,192,0.82)')], [0, 1], TileMode.Clamp));
      c.drawRect(Skia.XYWHRect(0, 0, DW, DH), p);
      p.setShader(null);
      // water droplets; the bigger ones (over half of them) left a running streak above
      const streak = Skia.Paint();
      streak.setAntiAlias(true);
      streak.setStyle(PaintStyle.Stroke);
      streak.setStrokeCap(StrokeCap.Round);
      streak.setColor(Skia.Color('rgba(255,255,255,0.16)'));
      const dc = [Skia.Color('rgba(255,255,255,0.8)'), Skia.Color('rgba(255,255,255,0.12)'), Skia.Color('rgba(15,35,30,0.4)')];
      for (let i = 0; i < 380; i++) {
        const x = Math.random() * DW; const y = Math.random() * DH; const r = (3 + Math.pow(Math.random(), 2) * 17) / 2;
        if (r > 5 && Math.random() < 0.55) {
          streak.setStrokeWidth(r * 0.45);
          c.drawLine(x, y - r * 5, x, y, streak);
        }
        p.setShader(Skia.Shader.MakeTwoPointConicalGradient({ x: x - r * 0.3, y: y - r * 0.35 }, r * 0.1, { x, y }, r, dc, [0, 0.5, 1], TileMode.Clamp));
        c.drawCircle(x, y, r, p);
      }
      p.setShader(null);
      // handwriting on the glass (the design asks for italic Caveat; it has no italic, so the browser slants it)
      fillCentered(c, h1, 260, 0, -0.25);
      fillCentered(c, h2, 300, 0, -0.25);
    }, Skia.XYWHRect(0, 0, DW, DH));
    return { pic, img: rasterize(pic, scale) };
  }, [ad.offerText, ad.subline, ad.colorA, ad.colorB, art, fm, scale]);
}

function Glass() {
  const ad = useAd();
  const live = useSharedValue(0);
  const glow = useSharedValue(0);
  const [gone, setGone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const fog = useFog();

  const onReveal = () => {
    live.value = 1;
    // flourish(offer, 150, 300)
    ad.burstJS(150, 300, 40, ['#fff6d6', '#ffd36b', '#ffffff', '#ffb347'], 6, 0.05, 6, 'star');
    ad.wave(150, 300);
    glow.value = 1;
    timer.current = setTimeout(() => setGone(true), 520); // after the 500 ms fade, free the Explore button
  };

  return (
    <>
      <OfferFace live={live} glow={glow} />
      {gone ? null : (
        <Eraser
          surface={fog.img
            ? <SkiaImage image={fog.img} x={-ad.stage.dx} y={-ad.stage.dy} width={DW + 2 * ad.stage.dx} height={DH + 2 * ad.stage.dy} fit="fill" />
            : <Picture picture={fog.pic} />}
          kind="glass"
          refog
          need={0.4}
          gap={4.5}
          r={31}
          sound="glass"
          autoPath={serp(115, 505, 50)}
          exit="fade"
          onReveal={onReveal}
        />
      )}
    </>
  );
}

export const glass: StyleDef = {
  Comp: Glass,
  hint: 'Wipe the glass with your finger',
  ghost: [[70, 300], [230, 300], [70, 380], [230, 380], [70, 460], [230, 460]],
};
