/**
 * Category tiles (reference): five glossy gradient pills, each with a 3D-style icon top-left, a label and a
 * small round arrow. Depth = gradient body + soft top highlight + inner bottom shade + a glow behind the icon +
 * a coloured layered shadow. Tapping opens the listing filtered to that category.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { FloatY } from '../foodV2/FoodV2Motion';
import { TILES, W, shadow } from './eventsV2Theme';
import { Press, FadeInUp, usePageW } from './EventsV2Kit';
import GlossyIcon from './EventsV2Glossy';
import { IArrowRight } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';

function Glow({ color, size }: { color: string; size: number }) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', left: -size * 0.12, top: -size * 0.14 }} pointerEvents="none">
      <Defs>
        <RadialGradient id={`g${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Ellipse cx={size / 2} cy={size / 2} rx={size / 2} ry={size / 2} fill={`url(#g${id})`} />
    </Svg>
  );
}

export default function CategoryTiles() {
  const nav = useNav();
  const w = usePageW();
  const tileW = Math.round(Math.max(102, Math.min(120, (w - 32 - 20) / 2.9)));
  const tileH = Math.round(tileW * 1.02);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14, gap: 10 }}>
      {TILES.map((t, i) => (
        <FadeInUp key={t.key} index={i}>
          <Press onPress={() => nav.push({ name: 'explore', tile: t.key })} label={t.label} hint="Shows these events" style={[{ width: tileW, height: tileH }, s.tile, shadow(2, t.grad[2])]} scaleTo={0.95}>
            <LinearGradient colors={[t.grad[0], t.grad[1], t.grad[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)']} locations={[0, 0.4, 1]} style={[StyleSheet.absoluteFill, { height: '58%' }]} />
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(20,6,60,0.28)']} style={[StyleSheet.absoluteFill, { top: '55%' }]} />
            <Glow color={t.glow} size={tileW * 0.86} />
            <FloatY distance={2} period={3400 + i * 260} style={{ position: 'absolute', left: 6, top: 4 }}>
              <GlossyIcon kind={t.key} size={Math.round(tileW * 0.5)} />
            </FloatY>
            <View style={s.foot}>
              <Text style={[s.label, tileW < 112 ? { fontSize: 12 } : null]} numberOfLines={1}>{t.label}</Text>
              <View style={s.arrow}><IArrowRight size={12} color={t.grad[2]} strokeWidth={2.2} /></View>
            </View>
            <View style={s.rim} pointerEvents="none" />
          </Press>
        </FadeInUp>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  tile: { borderRadius: 24, overflow: 'hidden' },
  foot: { position: 'absolute', left: 11, right: 9, bottom: 11, flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { flex: 1, color: '#FFFFFF', fontSize: 13.5, fontWeight: W.title, letterSpacing: -0.1, textShadowColor: 'rgba(20,6,60,0.35)', textShadowRadius: 4 },
  arrow: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  rim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)' },
});
