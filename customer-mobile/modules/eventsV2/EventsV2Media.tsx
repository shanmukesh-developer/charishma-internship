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
import { NIGHT, TILES, W, hexA, tileOf } from './eventsV2Theme';
import GlossyIcon from './EventsV2Glossy';
import type { EvCard } from './eventsV2Data';

export function Fallback({ e, iconSize = 64, iconRight }: { e: Pick<EvCard, 'category'>; iconSize?: number; iconRight?: boolean }) {
  const t = TILES.find((x) => x.key === tileOf(e.category)) || TILES[0];
  return (
    <LinearGradient colors={[hexA(t.grad[2], 0.95), '#221F5C', NIGHT.page]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { alignItems: iconRight ? 'flex-end' : 'center', justifyContent: iconRight ? 'flex-start' : 'center', padding: iconRight ? 18 : 0 }]}>
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
      <Text style={s.dow}>{t.dow}</Text>
      <Text style={s.day}>{t.day}</Text>
      <Text style={s.mon}>{t.mon}</Text>
    </View>
  );
}

export function PricePill({ isFree, label, style }: { isFree: boolean; label: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.price, style]} accessibilityLabel={isFree ? 'Free' : `Price ${label}`}>
      {isFree ? <View style={s.freeDot} /> : null}
      <Text style={s.priceText}>{isFree ? 'Free' : label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  date: { width: 44, paddingTop: 5, paddingBottom: 6, borderRadius: 12, alignItems: 'center', overflow: 'hidden', backgroundColor: '#FFFFFF' },
  dow: { fontSize: 10.5, color: NIGHT.violetDeep, fontWeight: W.title, letterSpacing: 0.2 },
  day: { fontSize: 18, color: '#16133F', fontWeight: W.hero, lineHeight: 21 },
  mon: { fontSize: 10.5, color: '#5A5780', fontWeight: W.label },
  price: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: 'rgba(16,15,51,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  freeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: NIGHT.green },
  priceText: { color: '#FFFFFF', fontSize: 12, fontWeight: W.title, letterSpacing: 0.1 },
});
