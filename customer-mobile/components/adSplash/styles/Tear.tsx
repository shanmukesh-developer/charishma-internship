// 1. Tear the Ad Paper (design tear()): a paper poster covers the screen; dragging across it rips holes
// with paper-coloured rims and fibres, flakes fly, and once ~30 % is torn the paper drops away onto Home.
import React from 'react';
import { Eraser } from '../Eraser';
import { PosterArt } from '../Poster';
import { ScreenImage, serp, useAd, useSurfaceImage } from '../kit';
import type { StyleDef } from './types';

function Tear() {
  const { finish, ad } = useAd();
  // The poster painted once into an image: tearing then only redraws that image and the holes.
  const poster = useSurfaceImage(<PosterArt />, `tear-${ad.id}`);
  return (
    <Eraser
      surface={poster ? <ScreenImage image={poster} /> : <PosterArt />}
      kind="tear"
      need={0.3}
      gap={8}
      r={31}
      sound="paper"
      autoPath={serp(75, 530, 60, 30, 270)}
      fx={{ cols: ['#f4ead2', '#ffffff', '#e3d4b0'], spd: 3, g: 0.25 }}
      exit="fall"
      onReveal={() => { setTimeout(finish, 420); }}
    />
  );
}

export const tear: StyleDef = {
  Comp: Tear,
  hint: 'Drag across the paper to tear it',
  ghost: [[70, 170], [240, 235], [70, 320], [240, 390], [70, 470], [240, 540]],
  transparent: true,
};
