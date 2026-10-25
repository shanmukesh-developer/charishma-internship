/**
 * Glossy 3D-style category art for the Campus Events v2 tiles (drawn SVG, no emoji, no photos):
 * megaphone (All Events), guitar (Cultural), trophy (Sports), light bulb (Workshops), people (Clubs).
 * Each has layered gradients, a specular highlight and a soft ground shadow, in a 64 x 64 box.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as LG, Path, RadialGradient as RG, Rect, Stop } from 'react-native-svg';
import type { TileKey } from './eventsV2Theme';

const useUid = () => React.useId().replace(/[^a-zA-Z0-9]/g, '');

function Ground({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <RG id={`sh${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#140A3C" stopOpacity="0.45" />
          <Stop offset="1" stopColor="#140A3C" stopOpacity="0" />
        </RG>
      </Defs>
      <Ellipse cx="32" cy="60" rx="20" ry="3.4" fill={`url(#sh${id})`} />
    </>
  );
}

function Megaphone({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LG id={`c${id}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFFFFF" /><Stop offset="0.55" stopColor="#E4DAFF" /><Stop offset="1" stopColor="#A98EF3" /></LG>
        <LG id={`m${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#9C7CF8" /><Stop offset="1" stopColor="#4B2BC4" /></LG>
        <LG id={`p${id}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FF9ACD" /><Stop offset="1" stopColor="#D63A86" /></LG>
      </Defs>
      <Ground id={id} />
      <Path d="M24 38 L28.5 51 Q29.6 54 32.4 52.8 L34.6 51.8 Q37 50.6 35.8 47.8 L31.5 39 Z" fill={`url(#p${id})`} />
      <Rect x="9" y="24.5" width="11" height="15" rx="3.4" fill={`url(#p${id})`} />
      <Path d="M18 26.5 L45.5 12.6 Q50 11 50 15.6 L50 48.4 Q50 53 45.5 51.4 L18 37.5 Z" fill={`url(#c${id})`} />
      <Ellipse cx="49.4" cy="32" rx="4.8" ry="18.6" fill={`url(#m${id})`} />
      <Ellipse cx="49.9" cy="32" rx="2.6" ry="14.2" fill="#2E1688" opacity="0.55" />
      <Path d="M20.5 28.4 L44.6 16.4 Q46.8 15.6 46.8 17.8 L46.8 20.6 L21.5 31.2 Z" fill="#FFFFFF" opacity="0.75" />
      <Rect x="11" y="26.5" width="3" height="8" rx="1.5" fill="#FFFFFF" opacity="0.55" />
      <Path d="M56 22.5 Q60.5 32 56 41.5" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity="0.9" />
      <Path d="M59.8 17.5 Q66.5 32 59.8 46.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.5" />
    </>
  );
}

function Guitar({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LG id={`b${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FFE2B0" /><Stop offset="0.5" stopColor="#F79A45" /><Stop offset="1" stopColor="#B83E0E" /></LG>
        <LG id={`n${id}`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#8A4B26" /><Stop offset="1" stopColor="#4A2410" /></LG>
      </Defs>
      <Ground id={id} />
      <G transform="rotate(32 32 33)">
        <Rect x="29.6" y="2" width="4.8" height="27" rx="1.6" fill={`url(#n${id})`} />
        <Rect x="27.6" y="0" width="8.8" height="7.5" rx="2.4" fill="#3B1C0C" />
        <Circle cx="27.6" cy="2.6" r="1.1" fill="#F5D6A8" /><Circle cx="36.4" cy="2.6" r="1.1" fill="#F5D6A8" />
        <Circle cx="32" cy="30.5" r="9.6" fill={`url(#b${id})`} />
        <Circle cx="32" cy="45" r="13.4" fill={`url(#b${id})`} />
        <Circle cx="32" cy="37.6" r="4.4" fill="#3B1C0C" />
        <Circle cx="32" cy="37.6" r="5.6" fill="none" stroke="#FFE7C2" strokeWidth="0.9" opacity="0.8" />
        <Rect x="26.5" y="47.4" width="11" height="3.2" rx="1.6" fill="#4A2410" />
        <Path d="M31.2 5 L31.2 48.6 M32.8 5 L32.8 48.6" stroke="#FFF3DD" strokeWidth="0.55" opacity="0.9" />
        <Ellipse cx="25.6" cy="42" rx="3.4" ry="7" fill="#FFFFFF" opacity="0.45" />
        <Ellipse cx="28.4" cy="27.4" rx="2" ry="3.4" fill="#FFFFFF" opacity="0.4" />
      </G>
    </>
  );
}

function Trophy({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LG id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FFF4B8" /><Stop offset="0.45" stopColor="#FBC02D" /><Stop offset="1" stopColor="#C77506" /></LG>
        <LG id={`d${id}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#4C3AAE" /><Stop offset="1" stopColor="#24186A" /></LG>
      </Defs>
      <Ground id={id} />
      <Path d="M18.5 15.5 H12.6 Q10.2 15.5 10.4 18.6 Q11 28.4 20.4 30.6" stroke={`url(#g${id})`} strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <Path d="M45.5 15.5 H51.4 Q53.8 15.5 53.6 18.6 Q53 28.4 43.6 30.6" stroke={`url(#g${id})`} strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <Path d="M17 10.5 H47 V23.5 Q47 38.6 32 40.6 Q17 38.6 17 23.5 Z" fill={`url(#g${id})`} />
      <Rect x="28.6" y="39.6" width="6.8" height="8" fill="#D88A0A" />
      <Rect x="20" y="47" width="24" height="6.4" rx="2" fill={`url(#d${id})`} />
      <Rect x="16.5" y="52.4" width="31" height="5.2" rx="2" fill={`url(#d${id})`} />
      <Rect x="26" y="48.8" width="12" height="2.6" rx="1.3" fill="#FCD34D" opacity="0.9" />
      <Path d="M32 17.4 L34.1 21.6 L38.7 22.3 L35.3 25.5 L36.2 30.1 L32 27.9 L27.8 30.1 L28.7 25.5 L25.3 22.3 L29.9 21.6 Z" fill="#FFFFFF" opacity="0.92" />
      <Path d="M20.4 13.4 H24.6 V24 Q24.6 31.4 27.8 35.8 Q20.4 32.6 20.4 23.6 Z" fill="#FFFFFF" opacity="0.5" />
      <Rect x="17" y="10.5" width="30" height="2.6" rx="1.3" fill="#FFF7D0" opacity="0.8" />
    </>
  );
}

function Bulb({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <RG id={`gl${id}`} cx="50%" cy="45%" rx="50%" ry="50%"><Stop offset="0" stopColor="#FFF7C2" stopOpacity="0.75" /><Stop offset="1" stopColor="#FFF7C2" stopOpacity="0" /></RG>
        <RG id={`b${id}`} cx="42%" cy="38%" rx="62%" ry="62%"><Stop offset="0" stopColor="#FFFDF0" /><Stop offset="0.5" stopColor="#FDE47A" /><Stop offset="1" stopColor="#F29A0C" /></RG>
        <LG id={`s${id}`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#F3F4F6" /><Stop offset="0.5" stopColor="#A7ADB8" /><Stop offset="1" stopColor="#5D6470" /></LG>
      </Defs>
      <Ground id={id} />
      <Circle cx="32" cy="25" r="25" fill={`url(#gl${id})`} />
      <Path d="M32 8.6 C 41.6 8.6 48.4 15.8 48.4 25 C 48.4 31.4 44.8 35.2 41.6 38.6 Q 39.6 41 39.4 44.4 H 24.6 Q 24.4 41 22.4 38.6 C 19.2 35.2 15.6 31.4 15.6 25 C 15.6 15.8 22.4 8.6 32 8.6 Z" fill={`url(#b${id})`} />
      <Path d="M27 34 Q28.6 25 32 31 Q35.4 25 37 34" stroke="#E2620B" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <Path d="M29.4 34 V44.2 M34.6 34 V44.2" stroke="#E2620B" strokeWidth="1" opacity="0.6" />
      <Rect x="24.4" y="44" width="15.2" height="10.4" rx="2.6" fill={`url(#s${id})`} />
      <Rect x="24.4" y="47" width="15.2" height="1.3" fill="#4B5563" opacity="0.5" />
      <Rect x="24.4" y="50.4" width="15.2" height="1.3" fill="#4B5563" opacity="0.5" />
      <Path d="M28 54.2 H36 Q34.6 58.4 32 58.4 Q29.4 58.4 28 54.2 Z" fill="#3F4652" />
      <Ellipse cx="24.6" cy="18.6" rx="3.6" ry="6.6" fill="#FFFFFF" opacity="0.8" transform="rotate(-28 24.6 18.6)" />
      <Circle cx="29.6" cy="13.4" r="1.4" fill="#FFFFFF" opacity="0.8" />
    </>
  );
}

function People({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LG id={`a${id}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFE6F3" /><Stop offset="1" stopColor="#F28AC0" /></LG>
        <LG id={`f${id}`} x1="0" y1="0" x2="0.3" y2="1"><Stop offset="0" stopColor="#FFFFFF" /><Stop offset="0.55" stopColor="#FFD3EA" /><Stop offset="1" stopColor="#E0559C" /></LG>
      </Defs>
      <Ground id={id} />
      <Circle cx="19.5" cy="21" r="6.8" fill={`url(#a${id})`} opacity="0.95" />
      <Path d="M7.5 45 Q7.5 30.6 19.5 30.6 Q27 30.6 29.6 36 L24 48 H7.5 Z" fill={`url(#a${id})`} opacity="0.95" />
      <Circle cx="44.5" cy="21" r="6.8" fill={`url(#a${id})`} opacity="0.95" />
      <Path d="M56.5 45 Q56.5 30.6 44.5 30.6 Q37 30.6 34.4 36 L40 48 H56.5 Z" fill={`url(#a${id})`} opacity="0.95" />
      <Circle cx="32" cy="25.4" r="8.8" fill={`url(#f${id})`} />
      <Path d="M15.6 55 Q15.6 36.6 32 36.6 Q48.4 36.6 48.4 55 Z" fill={`url(#f${id})`} />
      <Ellipse cx="28.6" cy="21.6" rx="2.6" ry="3.6" fill="#FFFFFF" opacity="0.85" />
      <Path d="M21 49 Q22 41.6 28.6 40" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.7" />
      <Ellipse cx="17" cy="18.6" rx="1.6" ry="2.4" fill="#FFFFFF" opacity="0.7" />
      <Ellipse cx="42" cy="18.6" rx="1.6" ry="2.4" fill="#FFFFFF" opacity="0.7" />
    </>
  );
}

const ART: Record<TileKey, React.ComponentType<{ id: string }>> = { all: Megaphone, cultural: Guitar, sports: Trophy, workshops: Bulb, clubs: People };

export default function GlossyIcon({ kind, size = 52 }: { kind: TileKey; size?: number }) {
  const id = useUid();
  const A = ART[kind];
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <A id={id} />
      </Svg>
    </View>
  );
}
