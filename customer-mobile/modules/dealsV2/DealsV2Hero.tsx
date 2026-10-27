/**
 * Deals & spin v2 hero (owner reference, official look): a glossy indigo card with depth (top highlight, one soft
 * light, layered shadow), the small "ZCS REWARDS" eyebrow with a crown (the one uppercase label, as the reference
 * shows), a plain title and the real spin rule, a white "See the wheel" pill, and on the right the real prize wheel
 * standing still on a glowing podium. Nothing moves here; the wheel only turns on the spin page during a real spin.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { DV, W, shadow } from './dealsV2Theme';
import { Press, usePageW } from './DealsV2Kit';
import { Podium } from './DealsV2Decor';
import { PrizeWheel, WheelDisk } from './DealsV2Wheel';
import { IArrowRight, ICrown } from './DealsV2Icons';
import { ORDERS_PER_SPIN, type Prize } from './dealsV2Data';

/** The still wheel on its podium (hero). */
export function WheelStage({ prizes, width, labels }: { prizes: Prize[]; width: number; labels?: boolean }) {
  const wheel = Math.round(width * 0.86);
  const h = wheel + width * 0.2;
  return (
    <View style={{ width, height: h }} pointerEvents="none">
      <Podium width={width} style={{ position: 'absolute', left: 0, bottom: -width * 0.06 }} />
      <PrizeWheel prizes={prizes} size={wheel} labels={labels ?? wheel >= 120} style={{ position: 'absolute', left: (width - wheel) / 2, top: 0 }} />
    </View>
  );
}

export function Hero({ prizes, spinsLeft, signedIn, onWheel }: { prizes: Prize[]; spinsLeft: number; signedIn: boolean; onWheel: () => void }) {
  const w = usePageW();
  const cardW = w - 32;
  const compact = w < 380;
  const artW = Math.round(cardW * (compact ? 0.45 : 0.47));
  const h1 = compact ? 23 : w >= 420 ? 27 : 25;
  const ready = signedIn && spinsLeft > 0;
  return (
    <View style={[s.wrap, shadow(3, '#2A1680')]}>
      <View style={s.card}>
        <LinearGradient colors={[DV.hero[0], DV.hero[1], DV.hero[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Svg width={cardW} height={260} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <RadialGradient id="dv2herolight" cx="78%" cy="40%" r="55%">
              <Stop offset="0" stopColor="#E3DAFF" stopOpacity={0.38} />
              <Stop offset="1" stopColor="#E3DAFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={cardW} height={260} fill="url(#dv2herolight)" />
        </Svg>
        <LinearGradient colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '42%' }]} />
        <View style={s.row}>
          <View style={{ flex: 1, minWidth: 0, paddingRight: 4 }}>
            <View style={s.eyebrow}>
              <View><ICrown size={13} color={DV.gold} strokeWidth={1.8} /></View>
              <Text style={s.eyebrowText}>ZCS REWARDS</Text>
            </View>
            <Text style={[s.h1, { fontSize: h1, lineHeight: h1 + 5 }]} accessibilityRole="header">Spin and win</Text>
            <Text style={[s.body, { fontSize: compact ? 12.3 : 13 }]}>
              Earn a spin for every {ORDERS_PER_SPIN} delivered orders. Win ZCS Points or a free-delivery coupon.
            </Text>
            <Press onPress={onWheel} label={ready ? 'Spin the wheel' : 'See the wheel'} style={[s.pill, shadow(2, '#120A3A')]} scaleTo={0.95}>
              <View style={s.pillWheel}><WheelDisk prizes={prizes} size={18} labels={false} /></View>
              <Text style={s.pillText} numberOfLines={1}>{ready ? 'Spin now' : 'See the wheel'}</Text>
              <View><IArrowRight size={15} color={DV.violetDeep} strokeWidth={2} /></View>
            </Press>
          </View>
          <View style={{ width: artW, marginRight: -6, marginTop: 4 }}>
            <WheelStage prizes={prizes} width={artW} />
            {ready ? (
              <View style={s.badge}><Text style={s.badgeText}>{spinsLeft} spin{spinsLeft === 1 ? '' : 's'} ready</Text></View>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 16, borderRadius: 26 },
  card: { borderRadius: 26, overflow: 'hidden', paddingLeft: 18, paddingRight: 12, paddingTop: 18, paddingBottom: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.24)' },
  row: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: 'rgba(16,8,60,0.3)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  eyebrowText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: W.title, letterSpacing: 1.4 },
  h1: { color: '#FFFFFF', fontWeight: W.display, letterSpacing: -0.3, marginTop: 12 },
  body: { color: 'rgba(240,236,255,0.9)', lineHeight: 18, marginTop: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', height: 40, paddingLeft: 8, paddingRight: 14, borderRadius: 20, backgroundColor: '#FFFFFF', marginTop: 14 },
  pillWheel: { width: 24, height: 24, borderRadius: 12, backgroundColor: DV.violetSoft, alignItems: 'center', justifyContent: 'center' },
  pillText: { color: DV.violetDeep, fontSize: 13.5, fontWeight: W.title },
  badge: { position: 'absolute', top: -2, left: 0, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', justifyContent: 'center' },
  badgeText: { color: DV.violetDeep, fontSize: 11, fontWeight: W.title },
});
