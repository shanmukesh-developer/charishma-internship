/**
 * Event pictures and the badges that sit on them: the photo (sample art, the event's own poster, or a glossy
 * category plate when there is none, never a stock photo of something else), the gradient scrim, the date block
 * (Thu / 29 / Oct) and the price pill (Free / ₹150).
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import SafeImage from '../../components/SafeImage';
import { dateTile } from '../campusEvents/campusEventsApi';
import { NIGHT, TILES, W, tileOf } from './eventsV2Theme';
import GlossyIcon from './EventsV2Glossy';
import type { EvCard } from './eventsV2Data';

export function Fallback({ e, iconSize = 64, iconRight }: { e: Pick<EvCard, 'category'>; iconSize?: number; iconRight?: boolean }) {
  const t = TILES.find((x) => x.key === tileOf(e.category)) || TILES[0];
  return (
    <LinearGradient colors={[t.grad[0], t.grad[2], '#1A1450']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { alignItems: iconRight ? 'flex-end' : 'center', justifyContent: iconRight ? 'flex-start' : 'center', padding: iconRight ? 18 : 0 }]}>
      <GlossyIcon kind={t.key} size={iconSize} />
    </LinearGradient>
  );
}

/** Fills its parent. `scrim` darkens the bottom for text on the photo. */
export function EventPhoto({ e, scrim = true, top = false, iconSize, iconRight }: { e: Pick<EvCard, 'category' | 'posterUrl' | 'art'>; scrim?: boolean; top?: boolean; iconSize?: number; iconRight?: boolean }) {
  const fb = <Fallback e={e} iconSize={iconSize} iconRight={iconRight} />;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {e.art ? <Image source={e.art} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        : e.posterUrl ? <SafeImage source={{ uri: e.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" fallback={fb} />
          : fb}
      {top ? <LinearGradient colors={['rgba(16,15,51,0.55)', 'rgba(16,15,51,0)']} style={[StyleSheet.absoluteFill, { height: '35%' }]} /> : null}
      {scrim ? <LinearGradient colors={['rgba(19,18,58,0)', 'rgba(19,18,58,0.35)', 'rgba(19,18,58,0.92)']} locations={[0.35, 0.65, 1]} style={StyleSheet.absoluteFill} /> : null}
    </View>
  );
}

export function DateBlock({ iso, style }: { iso: string | null; style?: StyleProp<ViewStyle> }) {
  const t = dateTile(iso);
  if (!t) return null;
  return (
    <View style={[s.date, style]} accessibilityLabel={`${t.dow} ${t.day} ${t.mon}`}>
      <LinearGradient colors={['rgba(255,255,255,0.98)', 'rgba(238,233,255,0.96)']} style={StyleSheet.absoluteFill} />
      <Text style={s.dow}>{t.dow}</Text>
      <Text style={s.day}>{t.day}</Text>
      <Text style={s.mon}>{t.mon}</Text>
    </View>
  );
}

export function PricePill({ isFree, label, style }: { isFree: boolean; label: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.price, style]} accessibilityLabel={isFree ? 'Free' : `Price ${label}`}>
      <LinearGradient colors={isFree ? ['#5EE59A', '#1FA463'] : ['#B79BFF', '#7646EA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '55%' }]} />
      <Text style={s.priceText}>{isFree ? 'Free' : label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  date: { width: 46, paddingVertical: 5, borderRadius: 13, alignItems: 'center', overflow: 'hidden' },
  dow: { fontSize: 11, color: NIGHT.violetDeep, fontWeight: W.label },
  day: { fontSize: 19, color: '#16133F', fontWeight: W.hero, lineHeight: 22 },
  mon: { fontSize: 11, color: '#4B4870', fontWeight: W.label },
  price: { height: 28, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.45)' },
  priceText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: W.title },
});
