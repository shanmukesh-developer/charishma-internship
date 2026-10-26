/**
 * Category art for the Campus Events v2 tiles, banners, fallbacks and the sample sheet: Microsoft Fluent Emoji 3D
 * renders (MIT, see eventsV2Art TILE_ICON) shown as images, never emoji characters: megaphone (All Events), guitar
 * (Cultural), trophy (Sports), light bulb (Workshops), raising hands (Clubs). A soft radial ground shadow sits under
 * each; `tilt` rotates it a little, like the reference.
 */
import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { TILE_ICON } from './eventsV2Art';
import type { TileKey } from './eventsV2Theme';

export default function GlossyIcon({ kind, size = 52, tilt = 0, shadow = true }: { kind: TileKey; size?: number; tilt?: number; shadow?: boolean }) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {shadow ? (
        <Svg width={size} height={size * 0.22} style={{ position: 'absolute', left: 0, bottom: -size * 0.06 }}>
          <Defs>
            <RadialGradient id={`s${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor="#12062E" stopOpacity="0.5" />
              <Stop offset="1" stopColor="#12062E" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx={size / 2} cy={size * 0.11} rx={size * 0.4} ry={size * 0.1} fill={`url(#s${id})`} />
        </Svg>
      ) : null}
      <Image source={TILE_ICON[kind]} style={{ width: size, height: size, transform: tilt ? [{ rotate: `${tilt}deg` }] : undefined }} contentFit="contain" />
    </View>
  );
}
