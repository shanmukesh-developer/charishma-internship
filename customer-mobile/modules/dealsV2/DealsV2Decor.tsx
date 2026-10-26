/**
 * Deals & spin v2 art (official look, owner 26 Oct: still, clean, no confetti, sparkles or doodles):
 *   Coin       glossy gold ZenPoints coin with a Z (gold is used only for ZenPoints)
 *   Podium     two-tier indigo podium with a soft glow (the wheel stands on it)
 *   IconPlate  glossy indigo plate holding one thin lucide icon
 * Nothing here moves.
 */
import React, { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgLinear, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { DV, shadow } from './dealsV2Theme';

const useSvgId = (p: string) => `${p}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

export function Coin({ size = 28, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const id = useSvgId('dv2coin');
  return (
    <View style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Defs>
          <RadialGradient id={`${id}f`} cx="35%" cy="30%" r="75%">
            <Stop offset="0" stopColor="#FFF6CF" />
            <Stop offset="0.45" stopColor="#F8CC5A" />
            <Stop offset="1" stopColor="#C4840C" />
          </RadialGradient>
          <SvgLinear id={`${id}e`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#E0A21E" />
            <Stop offset="1" stopColor="#8F5A00" />
          </SvgLinear>
        </Defs>
        <Ellipse cx={20} cy={21.5} rx={17.5} ry={17} fill={`url(#${id}e)`} />
        <Circle cx={20} cy={20} r={17} fill={`url(#${id}f)`} />
        <Circle cx={20} cy={20} r={13} fill="none" stroke="#B57A0E" strokeOpacity={0.55} strokeWidth={1.2} />
        <SvgText x={20} y={25.5} fontSize={15} fontWeight="700" fill="#9A6200" textAnchor="middle">Z</SvgText>
        <Path d="M 9 13 Q 14 6 23 6" stroke="#FFFFFF" strokeOpacity={0.7} strokeWidth={2} fill="none" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** Two-tier indigo podium with a soft glow under it. */
export function Podium({ width, style }: { width: number; style?: StyleProp<ViewStyle> }) {
  const id = useSvgId('dv2pod');
  const h = width * 0.42;
  const cx = width / 2;
  return (
    <View style={style} pointerEvents="none">
      <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
        <Defs>
          <RadialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#DCD0FF" stopOpacity={0.7} />
            <Stop offset="0.55" stopColor="#9E86F2" stopOpacity={0.25} />
            <Stop offset="1" stopColor="#6D4FE0" stopOpacity={0} />
          </RadialGradient>
          <SvgLinear id={`${id}side`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#2E1A86" />
            <Stop offset="0.5" stopColor="#5D44D6" />
            <Stop offset="1" stopColor="#2E1A86" />
          </SvgLinear>
          <SvgLinear id={`${id}top`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#D6CCFF" />
            <Stop offset="1" stopColor="#8E7AF0" />
          </SvgLinear>
        </Defs>
        <Ellipse cx={cx} cy={h * 0.62} rx={width * 0.5} ry={h * 0.36} fill={`url(#${id}glow)`} />
        <G>
          <Path d={`M ${cx - width * 0.4} ${h * 0.5} L ${cx - width * 0.4} ${h * 0.68} A ${width * 0.4} ${h * 0.16} 0 0 0 ${cx + width * 0.4} ${h * 0.68} L ${cx + width * 0.4} ${h * 0.5} Z`} fill={`url(#${id}side)`} />
          <Ellipse cx={cx} cy={h * 0.5} rx={width * 0.4} ry={h * 0.16} fill={`url(#${id}top)`} />
          <Path d={`M ${cx - width * 0.3} ${h * 0.3} L ${cx - width * 0.3} ${h * 0.44} A ${width * 0.3} ${h * 0.11} 0 0 0 ${cx + width * 0.3} ${h * 0.44} L ${cx + width * 0.3} ${h * 0.3} Z`} fill={`url(#${id}side)`} />
          <Ellipse cx={cx} cy={h * 0.3} rx={width * 0.3} ry={h * 0.11} fill={`url(#${id}top)`} />
          <Ellipse cx={cx} cy={h * 0.3} rx={width * 0.3} ry={h * 0.11} fill="none" stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={1} />
          <Ellipse cx={cx} cy={h * 0.5} rx={width * 0.4} ry={h * 0.16} fill="none" stroke="#FFFFFF" strokeOpacity={0.3} strokeWidth={1} />
        </G>
      </Svg>
    </View>
  );
}

/** Glossy indigo plate with one thin icon (layered: gradient, top highlight, hairline, then the icon). */
export function IconPlate({ size = 40, radius, children, soft, style }: { size?: number; radius?: number; children: React.ReactNode; soft?: boolean; style?: StyleProp<ViewStyle> }) {
  const r = radius ?? Math.round(size * 0.32);
  return (
    <View style={[{ width: size, height: size, borderRadius: r }, soft ? null : shadow(1, DV.violetDeep), style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
        {soft ? <View style={[StyleSheet.absoluteFill, { backgroundColor: DV.violetSoft }]} /> : (
          <>
            <LinearGradient colors={[DV.go[0], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
          </>
        )}
        <View style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: StyleSheet.hairlineWidth, borderColor: soft ? DV.violetLine : 'rgba(255,255,255,0.4)' }]} />
      </View>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>{children}</View>
    </View>
  );
}
