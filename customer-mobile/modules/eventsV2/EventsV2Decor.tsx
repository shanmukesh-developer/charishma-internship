/**
 * Decorative accents from the reference: the hand-drawn swash underline, the small swash arrow, four-point
 * sparkles, the little script heart, and gradient display text (violet -> pink italic, drawn as SVG text so
 * it works the same on Android, iOS and web).
 */
import React from 'react';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop, Text as SvgText } from 'react-native-svg';
import { NIGHT } from './eventsV2Theme';

const useUid = () => React.useId().replace(/[^a-zA-Z0-9]/g, '');

export function Swash({ width, height = 10, colors = NIGHT.swash, style }: { width: number; height?: number; colors?: readonly [string, string]; style?: any }) {
  const id = useUid();
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={style} pointerEvents="none">
      <Defs>
        <SvgGrad id={`s${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors[0]} stopOpacity="0.95" />
          <Stop offset="1" stopColor={colors[1]} stopOpacity="0.25" />
        </SvgGrad>
      </Defs>
      <Path d={`M2 ${height * 0.78} Q ${width * 0.45} ${height * 0.02} ${width - 2} ${height * 0.42}`} stroke={`url(#s${id})`} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Small looping arrow that points down-right (next to "Your Way" and section titles). */
export function SwashArrow({ size = 30, color = '#F0ABFC', style }: { size?: number; color?: string; style?: any }) {
  return (
    <Svg width={size} height={size * 0.8} viewBox="0 0 40 32" style={style} pointerEvents="none">
      <Path d="M3 6 C 12 2, 20 6, 18 13 C 16.5 18, 10 17, 12 12 C 14 7, 26 9, 34 24" stroke={color} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <Path d="M27.5 23.6 L34.4 24.6 L35 17.8" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Four-point sparkle. */
export function Sparkle({ size = 12, color = '#FFFFFF', opacity = 0.9, style }: { size?: number; color?: string; opacity?: number; style?: any }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style} pointerEvents="none">
      <Path d="M12 0 C 13 8, 16 11, 24 12 C 16 13, 13 16, 12 24 C 11 16, 8 13, 0 12 C 8 11, 11 8, 12 0 Z" fill={color} opacity={opacity} />
    </Svg>
  );
}

/** Small hand-drawn heart (script corner of the hero). */
export function ScriptHeart({ size = 14, color = '#F9A8D4', style }: { size?: number; color?: string; style?: any }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style} pointerEvents="none">
      <Path d="M12 20.5 C 6 16, 2.5 12.6, 3 8.4 C 3.4 5.4, 6.6 3.6, 9.2 5 C 10.6 5.8, 11.4 7, 12 8.2 C 12.6 7, 13.4 5.8, 14.8 5 C 17.4 3.6, 20.6 5.4, 21 8.4 C 21.5 12.6, 18 16, 12 20.5 Z" stroke={color} strokeWidth={1.7} fill={color} fillOpacity={0.35} strokeLinejoin="round" />
    </Svg>
  );
}

/** Gradient italic display text (single line). Width is estimated from the font size; pass `width` to pin it. */
export function GradientText({ text, size, width, colors = NIGHT.display, weight = '800', italic = true }: { text: string; size: number; width?: number; colors?: readonly [string, string]; weight?: string; italic?: boolean }) {
  const id = useUid();
  const w = width || Math.ceil(text.length * size * 0.6 + size * 0.3);
  const h = Math.ceil(size * 1.3);
  return (
    <Svg width={w} height={h} accessibilityLabel={text}>
      <Defs>
        <SvgGrad id={`t${id}`} x1="0" y1="0" x2="1" y2="0.3">
          <Stop offset="0" stopColor={colors[0]} />
          <Stop offset="1" stopColor={colors[1]} />
        </SvgGrad>
      </Defs>
      <SvgText x={1} y={size * 1.0} fontSize={size} fontWeight={weight} fontStyle={italic ? 'italic' : 'normal'} fill={`url(#t${id})`} letterSpacing={-0.3}>{text}</SvgText>
    </Svg>
  );
}
