/**
 * Rentals v2 home: "What would you like to rent today?", the 2 × 2 category cards and "Near Your Campus".
 * Owner, 26 Oct: official and still. Each card: a harmonised gradient (same lightness and chroma, different hue),
 * a top-left white highlight (~18%), a bottom-right vignette, a 1 px inner white border (~25%), a coloured outer
 * shadow, a radial light behind the cut-out, a soft ground shadow, a 21 px title, a 12.5 px white subtitle and a
 * white arrow button. Motion: one gentle fade-and-rise on first load (off with reduce motion); the art is still.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { CARD, NIGHT, W, shadow, type Category } from './rentalsV2Theme';
import { HOME_ART, HOME_ART_IS_PHOTO } from './rentalsV2Art';
import { FadeInUp, GroundShadow, Press, usePageW } from './RentalsV2Kit';
import { IArrowRight, IChevronRight, IPin } from './RentalsV2Icons';
import { CAMPUSES } from './rentalsV2Data';
import { useNav } from './rentalsV2Nav';
import { themedSheet } from '../../utils/themeNow';

const COPY: Record<Category, { t1: string; sub: string; label: string }> = {
  bike: { t1: 'Bike', sub: 'Daily · Weekly · Monthly', label: 'Bike rentals: daily, weekly, monthly' },
  car: { t1: 'Car', sub: 'Hatchback · Sedan · SUV', label: 'Car rentals: hatchback, sedan, SUV' },
  room: { t1: 'Room', sub: 'Single · Shared · PG', label: 'Room rentals: single, shared, PG' },
  flat: { t1: 'Flat', sub: '1BHK · 2BHK · Independent', label: 'Flat rentals: 1BHK, 2BHK, independent' },
};

/** Art box per card, as fractions of the card (x from the right edge). Tuned per subject shape. */
const ART: Record<Category, { w: number; h: number; top: number; right: number }> = {
  bike: { w: 0.42, h: 0.7, top: -0.08, right: 0.1 },
  car: { w: 0.66, h: 0.44, top: 0.09, right: -0.03 },
  room: { w: 0.52, h: 0.48, top: 0.07, right: 0.06 },
  flat: { w: 0.62, h: 0.44, top: 0.08, right: 0.01 },
};

/** Radial light behind the art: a white core fading out, tinted at the edge with the card's glow colour. */
function Glow({ size, color, id }: { size: number; color: string; id: string }) {
  return (
    <Svg width={size} height={size} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.62} />
          <Stop offset="0.45" stopColor={color} stopOpacity={0.32} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

function CategoryCard({ kind, w, h, index }: { kind: Category; w: number; h: number; index: number }) {
  const nav = useNav();
  const tone = CARD[kind];
  const copy = COPY[kind];
  const box = ART[kind];
  const artW = Math.round(w * box.w);
  const artH = Math.round(h * box.h);
  const artTop = Math.round(h * box.top);
  const artRight = Math.round(w * box.right);
  const glow = Math.round(Math.max(artW, artH) * 1.25);
  const compact = w < 176;
  const gid = `rv2glow${kind}`;
  return (
    <FadeInUp index={index} distance={14} style={{ width: w, height: h }}>
      <Press onPress={() => nav.push({ name: 'list', category: kind })} label={copy.label} style={[{ width: w, height: h, borderRadius: 20 }, shadow(3, tone.shadow)]} scaleTo={0.97}>
        <View style={[StyleSheet.absoluteFill, { borderRadius: 20, overflow: 'hidden' }]}>
          <LinearGradient colors={[tone.grad[0], tone.grad[1], tone.grad[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', right: artRight + artW / 2 - glow / 2, top: artTop + artH / 2 - glow / 2 }}><Glow size={glow} color={tone.glow} id={gid} /></View>
          <LinearGradient colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.62, y: 0.62 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(20,8,60,0.16)']} start={{ x: 0.45, y: 0.45 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: 18 }]} />
          <View style={[StyleSheet.absoluteFill, { borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }]} />
        </View>
        {HOME_ART_IS_PHOTO[kind] ? (
          /* A real room photo framed in the art area (rounded, thin white rim, soft shadow). */
          <View style={[{ position: 'absolute', right: artRight, top: artTop, width: artW, height: artH, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)', overflow: 'hidden' }, shadow(2, '#1A0A4A')]} pointerEvents="none">
            <Image source={HOME_ART[kind]} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={240} accessibilityIgnoresInvertColors />
          </View>
        ) : (
          <>
            {/* Ground shadow, then the cut-out (anchored to the bottom of its box). */}
            <GroundShadow width={artW * 0.78} height={14} opacity={0.38} color="#1A0A4A" style={{ position: 'absolute', right: artRight + artW * 0.11, top: artTop + artH - 9 }} />
            <View style={{ position: 'absolute', right: artRight, top: artTop, width: artW, height: artH }} pointerEvents="none">
              <Image source={HOME_ART[kind]} style={{ width: '100%', height: '100%' }} contentFit="contain" contentPosition="bottom" transition={240} accessibilityIgnoresInvertColors />
            </View>
          </>
        )}
        <View style={{ position: 'absolute', left: 12, right: 10, bottom: 10 }} pointerEvents="none">
          <Text style={[c.title, compact ? { fontSize: 19.5, lineHeight: 21 } : null]}>{copy.t1}</Text>
          <Text style={[c.title, compact ? { fontSize: 19.5, lineHeight: 21 } : null]}>Rentals</Text>
          <Text style={[c.sub, compact ? { letterSpacing: -0.25 } : null]} numberOfLines={1}>{compact && kind === 'flat' ? '1BHK · 2BHK · House' : copy.sub}</Text>
        </View>
        <View style={[c.arrow, shadow(2, '#12083A')]} pointerEvents="none"><IArrowRight size={15} color={tone.ink} strokeWidth={2.2} /></View>
      </Press>
    </FadeInUp>
  );
}

export function CategoryGrid() {
  const pw = usePageW();
  const pad = 10;
  const gap = 10;
  // Size the 2 columns from the row's real width (onLayout), not the window: when the container is narrower than
  // the window (web scrollbar, side panes, insets) two window-based cards no longer fit and wrapped into one column
  // with an empty right half (owner, 7 Nov 2026). The window width is only the first-frame guess.
  const [rowW, setRowW] = React.useState(0);
  const avail = rowW > 0 ? rowW : pw - pad * 2;
  const w = Math.floor((avail - gap) / 2) - 1;
  const h = Math.round(w * 0.84);
  return (
    <View style={{ paddingHorizontal: pad, marginTop: 6 }}>
      <View style={{ paddingHorizontal: 6, marginBottom: 14 }}>
        <Text style={c.section} accessibilityRole="header">What would you like to rent today?</Text>
      </View>
      <View
        onLayout={(e) => { const nw = Math.floor(e.nativeEvent.layout.width); if (nw > 0 && Math.abs(nw - rowW) > 1) setRowW(nw); }}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap, rowGap: 16, justifyContent: 'space-between' }}
      >
        {(['bike', 'car', 'room', 'flat'] as Category[]).map((k, i) => <CategoryCard key={k} kind={k} w={w} h={h} index={i} />)}
      </View>
    </View>
  );
}

export function NearCampus() {
  const nav = useNav();
  const pw = usePageW();
  const cw = Math.max(118, Math.floor((pw - 20 - 12) / 3));
  return (
    <View style={{ marginTop: 24 }}>
      <Press onPress={() => nav.push({ name: 'explore', near: 'srm' })} label="Near your campus" style={c.secRow} scaleTo={0.99}>
        <IPin size={17} color="#FFFFFF" strokeWidth={1.7} />
        <Text style={c.secTitle}>Near Your Campus</Text>
        <IChevronRight size={15} color={NIGHT.sub} strokeWidth={1.8} />
      </Press>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, gap: 8 }}>
        {CAMPUSES.map((cp, i) => (
          <FadeInUp key={cp.key} index={i + 4}>
            <Press onPress={() => nav.push({ name: 'explore', near: cp.key })} label={`${cp.name}, ${cp.key === 'srm' ? 'your campus' : `${cp.km.toFixed(1)} kilometres away`}`} style={[c.campus, { minWidth: cw }, shadow(2, '#05051A')]}>
              <LinearGradient colors={['rgba(255,255,255,0.13)', 'rgba(255,255,255,0.04)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
              <LinearGradient colors={['#E8E4FF', '#A18EE8', '#6F5BB0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={c.monoRing}>
                <LinearGradient colors={[cp.tint[0], cp.tint[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={c.mono}>
                  <Text style={[c.monoText, { color: cp.ink, fontSize: cp.initials.length > 2 ? 9 : 10.5 }]}>{cp.initials}</Text>
                </LinearGradient>
              </LinearGradient>
              <View>
                <Text style={c.campusName} numberOfLines={1}>{cp.name}</Text>
                <View style={c.kmPill}><Text style={c.kmText}>{cp.key === 'srm' ? 'Your campus' : `${cp.km.toFixed(1)} km`}</Text></View>
              </View>
            </Press>
          </FadeInUp>
        ))}
      </ScrollView>
    </View>
  );
}

const c = themedSheet(() => ({
  title: { color: '#FFFFFF', fontSize: 21, fontWeight: W.hero, lineHeight: 22.5, letterSpacing: -0.3, textShadowColor: 'rgba(30,10,80,0.28)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } },
  sub: { color: '#FFFFFF', fontSize: 12.5, marginTop: 5, fontWeight: W.label, textShadowColor: 'rgba(30,10,80,0.25)', textShadowRadius: 5 },
  arrow: { position: 'absolute', right: 10, bottom: 30, width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  section: { color: '#FFFFFF', fontSize: 16, fontWeight: W.title, letterSpacing: -0.1 },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, marginBottom: 12 },
  secTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: W.title },
  campus: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 56, paddingLeft: 8, paddingRight: 14, borderRadius: 14, backgroundColor: 'rgba(40,38,96,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  monoRing: { width: 36, height: 36, borderRadius: 18, padding: 2 },
  mono: { flex: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(20,18,60,0.6)' },
  monoText: { fontWeight: W.hero, letterSpacing: 0.2 },
  campusName: { color: '#FFFFFF', fontSize: 12, fontWeight: W.title },
  kmPill: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: 'rgba(167,139,250,0.24)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(196,181,253,0.45)', justifyContent: 'center' },
  kmText: { color: '#EDE7FF', fontSize: 10.5, fontWeight: W.label },
}));
