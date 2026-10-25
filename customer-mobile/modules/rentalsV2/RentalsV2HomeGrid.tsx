/**
 * Rentals v2 home, body (owner board): "What would you like to rent today?" with a swash and the 2 × 2 glossy
 * gradient cards (cut-out art spilling over the top edge with a glow and a ground shadow, script tagline, title,
 * modes, white arrow button, pin accent), "Near Your Campus" monogram chips (distances computed from coordinates),
 * and "Popular This Week" (real first, then samples).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { FloatY } from '../foodV2/FoodV2Motion';
import { CARD, NIGHT, W, shadow, type Category } from './rentalsV2Theme';
import { HOME_ART } from './rentalsV2Art';
import { FadeInUp, GroundShadow, Press, usePageW } from './RentalsV2Kit';
import { IArrowRight, IChevronRight, IFlame, IHeart, IPin } from './RentalsV2Icons';
import { SCRIPT, Swash } from './RentalsV2HomeTop';
import { PopularCard } from './RentalsV2Rows';
import { CAMPUSES, popularItems, useRentalsV2 } from './rentalsV2Data';
import { useNav } from './rentalsV2Nav';

const COPY: Record<Category, { script: [string, string]; t1: string; sub: string; label: string }> = {
  bike: { script: ['Ride', 'Your Way'], t1: 'Bike', sub: 'Daily  •  Weekly  •  Monthly', label: 'Bike rentals: daily, weekly, monthly' },
  car: { script: ['Hit', 'the Road'], t1: 'Car', sub: 'Self Drive  •  With Driver', label: 'Car rentals' },
  room: { script: ['Your', 'Safe Space'], t1: 'Room', sub: 'Single  •  Shared  •  PG', label: 'Room rentals: single, shared, PG' },
  flat: { script: ['More', 'Space'], t1: 'Flat', sub: '1BHK  •  2BHK  •  Independent', label: 'Flat rentals: 1BHK, 2BHK, independent' },
};

/** Small hand-drawn decor under each script tagline (the board's squiggles, heart and sparks). */
function Decor({ kind }: { kind: Category }) {
  const c = 'rgba(255,255,255,0.85)';
  if (kind === 'room') return <IHeart size={12} color={c} strokeWidth={1.6} style={{ marginLeft: 22, marginTop: 1 }} />;
  if (kind === 'flat') {
    return (
      <Svg width={26} height={14} style={{ marginLeft: 26, marginTop: -16 }}>
        <Path d="M4 11 L10 6 M8 13 L16 9 M12 3 L18 1" stroke={c} strokeWidth={1.3} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg width={24} height={10} style={{ marginLeft: 18, marginTop: 1 }}>
      <Path d="M2 4 Q 8 1 13 4 T 22 3 M4 8 Q 10 5 15 8 T 22 7" stroke={c} strokeWidth={1.2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

function CategoryCard({ kind, w, h, index }: { kind: Category; w: number; h: number; index: number }) {
  const nav = useNav();
  const tone = CARD[kind];
  const copy = COPY[kind];
  // Art sits above the arrow button (its bottom ~30 px over the card's bottom) and spills over the top edge.
  const artW = Math.round(w * (kind === 'flat' ? 0.62 : kind === 'bike' ? 0.54 : 0.6));
  const artTop = kind === 'bike' ? -16 : kind === 'flat' ? -14 : kind === 'car' ? -2 : -6;
  const artH = Math.round(h - 30 - artTop);
  return (
    <FadeInUp index={index} style={{ width: w, height: h }}>
      <Press onPress={() => nav.push({ name: 'list', category: kind })} label={copy.label} style={[{ width: w, height: h }, shadow(3, '#0A0A2A')]} scaleTo={0.97}>
        <View style={[StyleSheet.absoluteFill, { borderRadius: 18, overflow: 'hidden' }]}>
          <LinearGradient colors={[tone.grad[0], tone.grad[1], tone.grad[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[g.glow, { backgroundColor: tone.glow, width: w * 0.78, height: w * 0.78, borderRadius: w, right: -w * 0.16, top: -w * 0.12 }]} />
          <View style={[g.glow, { backgroundColor: 'rgba(255,255,255,0.14)', width: w * 0.5, height: w * 0.5, borderRadius: w, right: w * 0.06, top: h * 0.12 }]} />
          <LinearGradient colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '48%' }]} />
          <View style={[StyleSheet.absoluteFill, { borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' }]} />
        </View>
        {/* Soft ground shadow + floating art (anchored to the bottom of its box, spilling over the top edge) */}
        <GroundShadow width={artW * 0.86} style={{ position: 'absolute', right: 2 + artW * 0.07, top: artTop + artH - 12 }} />
        <FloatY distance={2.5} period={3600 + index * 300} style={{ position: 'absolute', right: 2, top: artTop, width: artW, height: artH }}>
          <Image source={HOME_ART[kind]} style={{ width: '100%', height: '100%' }} contentFit="contain" contentPosition="bottom" accessibilityIgnoresInvertColors />
        </FloatY>
        <View style={[g.pin, kind === 'room' ? { opacity: 0 } : null]}>
          <IPin size={14} color={kind === 'bike' ? '#FF7AD9' : '#FFFFFF'} fill={kind === 'bike' ? 'rgba(255,122,217,0.55)' : 'rgba(255,255,255,0.35)'} strokeWidth={1.6} />
        </View>
        {/* Text */}
        <View style={{ position: 'absolute', left: 11, top: 9 }}>
          <Text style={g.script}>{copy.script[0]}</Text>
          <Text style={[g.script, { marginTop: -3 }]}>{copy.script[1]}</Text>
          <Decor kind={kind} />
        </View>
        <View style={{ position: 'absolute', left: 12, bottom: 10, right: 38 }}>
          <Text style={g.title}>{copy.t1}</Text>
          <Text style={[g.title, { marginTop: -2 }]}>Rentals</Text>
          <Text style={[g.sub, w < 176 ? { fontSize: 9, letterSpacing: -0.1 } : null]} numberOfLines={1}>{copy.sub}</Text>
        </View>
        <View style={[g.arrow, shadow(1, '#000000')]}><IArrowRight size={14} color={tone.ink} strokeWidth={2.1} /></View>
      </Press>
    </FadeInUp>
  );
}

export function CategoryGrid() {
  const pw = usePageW();
  const pad = 10;
  const gap = 9;
  const w = Math.floor((pw - pad * 2 - gap) / 2);
  const h = Math.round(w * 0.64);
  return (
    <View style={{ paddingHorizontal: pad, marginTop: 6 }}>
      <View style={{ paddingHorizontal: 6, marginBottom: 18 }}>
        <Text style={g.section} accessibilityRole="header">What would you like to rent today?</Text>
        <Swash width={40} height={7} style={{ marginTop: 2 }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, rowGap: 14 }}>
        {(['bike', 'car', 'room', 'flat'] as Category[]).map((k, i) => <CategoryCard key={k} kind={k} w={w} h={h} index={i} />)}
      </View>
    </View>
  );
}

export function NearCampus() {
  const nav = useNav();
  const pw = usePageW();
  const cw = Math.max(112, Math.floor((pw - 20 - 12) / 3));
  return (
    <View style={{ marginTop: 22 }}>
      <Press onPress={() => nav.push({ name: 'explore', near: 'srm' })} label="Near your campus" style={g.secRow} scaleTo={0.99}>
        <IPin size={16} color="#FFFFFF" fill="rgba(255,255,255,0.18)" strokeWidth={1.7} />
        <Text style={g.secTitle}>Near Your Campus</Text>
        <IChevronRight size={15} color={NIGHT.sub} strokeWidth={1.8} />
      </Press>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, gap: 6 }}>
        {CAMPUSES.map((c, i) => (
          <FadeInUp key={c.key} index={i}>
            <Press onPress={() => nav.push({ name: 'explore', near: c.key })} label={`${c.name}, ${c.key === 'srm' ? 'your campus' : `${c.km.toFixed(1)} kilometres away`}`} style={[g.campus, { minWidth: cw, paddingRight: 12 }]}>
              <LinearGradient colors={[c.tint[0], c.tint[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={g.mono}>
                <View style={g.monoRing}><Text style={[g.monoText, { color: c.ink, fontSize: c.initials.length > 2 ? 8.5 : 10 }]}>{c.initials}</Text></View>
              </LinearGradient>
              <View>
                <Text style={g.campusName} numberOfLines={1}>{c.name}</Text>
                <Text style={g.campusKm} numberOfLines={1}>{c.key === 'srm' ? 'Your campus' : `${c.km.toFixed(1)} km`}</Text>
              </View>
            </Press>
          </FadeInUp>
        ))}
      </ScrollView>
    </View>
  );
}

export function PopularWeek() {
  const nav = useNav();
  const { items } = useRentalsV2();
  const pw = usePageW();
  const list = popularItems(items, 8);
  const cw = Math.round((pw - 20 - 18) / 4.15);
  return (
    <View style={{ marginTop: 22 }}>
      <View style={[g.secRow, { justifyContent: 'space-between' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <IFlame size={17} color="#FFFFFF" fill="rgba(255,255,255,0.2)" strokeWidth={1.7} />
          <Text style={g.secTitle}>Popular This Week</Text>
        </View>
        <Press onPress={() => nav.push({ name: 'explore' })} label="View all" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 }}>
          <Text style={g.viewAll}>View all</Text>
          <IArrowRight size={13} color="#FFFFFF" strokeWidth={1.8} />
        </Press>
      </View>
      {list.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, gap: 6 }}>
          {list.map((it, i) => <FadeInUp key={it.id} index={i}><PopularCard item={it} w={Math.max(84, cw)} /></FadeInUp>)}
        </ScrollView>
      ) : (
        <View style={[g.campus, { marginHorizontal: 10, padding: 14 }]}><Text style={g.campusKm}>Popular rentals will show here as students book them.</Text></View>
      )}
    </View>
  );
}

export const g = StyleSheet.create({
  glow: { position: 'absolute', opacity: 0.6 },
  pin: { position: 'absolute', right: 10, top: 10 },
  script: { fontFamily: SCRIPT, color: '#FFFFFF', fontSize: 11.5, lineHeight: 15, textShadowColor: 'rgba(40,20,90,0.25)', textShadowRadius: 4 },
  title: { color: '#FFFFFF', fontSize: 16.5, fontWeight: W.title, lineHeight: 20, letterSpacing: -0.2, textShadowColor: 'rgba(30,20,80,0.22)', textShadowRadius: 6 },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 10, marginTop: 5 },
  arrow: { position: 'absolute', right: 9, bottom: 9, width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  section: { color: '#FFFFFF', fontSize: 15, fontWeight: W.title, letterSpacing: -0.1 },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, marginBottom: 11 },
  secTitle: { color: '#FFFFFF', fontSize: 14.5, fontWeight: W.title },
  viewAll: { color: '#FFFFFF', fontSize: 12, fontWeight: W.label },
  campus: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 46, paddingHorizontal: 7, borderRadius: 12, backgroundColor: NIGHT.chip, borderWidth: 1, borderColor: NIGHT.chipLine },
  mono: { width: 28, height: 28, borderRadius: 14, padding: 2 },
  monoRing: { flex: 1, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)', alignItems: 'center', justifyContent: 'center' },
  monoText: { fontWeight: W.title, letterSpacing: 0.2 },
  campusName: { color: '#FFFFFF', fontSize: 10.5, fontWeight: W.label },
  campusKm: { color: NIGHT.sub, fontSize: 10.5, marginTop: 2 },
});
