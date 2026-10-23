/**
 * The one Others header (Food & groceries v2 style), shared by every Others section:
 * back arrow, ZCS emblem + "ZCS" and the section line, plain header icons, a white search pill with
 * rotating section hints, and the section pills. Each section passes only its own accent colours.
 * Used by Food & groceries (FoodV2HomeTop) and by the other sections in app/(tabs)/others.tsx.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, type LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Image } from 'expo-image';
import { PressScale } from '../../modules/others/motion';
import { Icon } from './FoodV2Icons';

export type HeaderAction = { icon: string; label: string; onPress: () => void; badge?: number; dot?: boolean };
export type HeaderColors = { top: string; bottom: string; pillOnBg: string; pillOnInk: string };

/** Food & groceries: deep emerald (the reference look). */
export const FOOD_HEADER: HeaderColors = { top: '#0B3D24', bottom: '#0F5132', pillOnBg: '#E6F6EA', pillOnInk: '#0B5A2E' };
const EMBLEM = require('./assets/food-v2-brand-gold-z-emblem-2026-10-23.webp');
const SIDE = 16;

/** Rotating hint index (every 2.5 s). */
function useHintIndex() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(v => v + 1), 2500);
    return () => clearInterval(t);
  }, []);
  return i;
}

/** One soft light from the top-right (about 10% white). */
function HeaderLight({ width, height }: { width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="othershdrlight" cx="92%" cy="0%" rx="78%" ry="90%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.10" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#othershdrlight)" />
      </Svg>
    </View>
  );
}

function HeaderButton({ a }: { a: HeaderAction }) {
  const badge = a.badge || 0;
  return (
    <PressScale style={st.hdrBtn} scaleTo={0.92} haptic onPress={a.onPress} accessibilityRole="button" accessibilityLabel={badge ? `${a.label}, ${badge} item${badge === 1 ? '' : 's'}` : a.label}>
      <Icon name={a.icon} size={22} strokeWidth={1.6} color="rgba(255,255,255,0.95)" />
      {badge > 0 && <View style={st.badge}><Text style={st.badgeText}>{badge > 99 ? '99+' : badge}</Text></View>}
      {!!a.dot && badge === 0 && <View style={st.dot} />}
    </PressScale>
  );
}

export default function SectionHeader({ topPad, pageW, compact, colors, subtitle, hints, searchLabel, onSearch, pills, active, onPill, onBack, actions }: {
  topPad: number; pageW: number; compact: boolean; colors: HeaderColors;
  subtitle: string; hints: string[]; searchLabel: string; onSearch: () => void;
  pills: [string, string][]; active: string; onPill: (key: string) => void;
  onBack?: () => void; actions: HeaderAction[];
}) {
  const hint = useHintIndex();
  const railRef = useRef<ScrollView>(null);
  const railW = useRef(0);
  const pillPos = useRef<Record<string, { x: number; w: number }>>({});
  // Keep the first pill fully visible: scroll only when the active pill would be cut off on the right.
  const reveal = () => {
    const l = pillPos.current[active];
    if (!l || !railW.current) return;
    const overflow = l.x + l.w + SIDE + 24 - railW.current;
    railRef.current?.scrollTo({ x: overflow > 0 ? overflow : 0, animated: false });
  };
  useEffect(() => { reveal(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active]);
  const onPillLayout = (k: string) => (e: LayoutChangeEvent) => {
    pillPos.current[k] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
    if (k === active) reveal();
  };
  const side = compact ? 16 : 20;
  return (
    <LinearGradient colors={[colors.top, colors.bottom]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ paddingTop: topPad, overflow: 'hidden' }}>
      <HeaderLight width={pageW} height={topPad + 220} />
      <View style={[st.brandRow, { paddingLeft: onBack ? side - 10 : side, paddingRight: side }]}>
        {!!onBack && (
          <PressScale style={st.hdrBtn} scaleTo={0.92} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Home">
            <Icon name="arrow-back" size={22} strokeWidth={1.6} color="#FFFFFF" />
          </PressScale>
        )}
        <View style={st.brandBlock}>
          <View style={st.emblemGlow}>
            <View style={st.emblemRing}><Image source={EMBLEM} style={st.emblem} contentFit="cover" accessibilityLabel="ZCS emblem" /></View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.brandWord} accessibilityRole="header">ZCS</Text>
            <Text style={[st.brandSub, { fontSize: compact ? 12 : 12.5 }]} numberOfLines={1}>{subtitle}</Text>
          </View>
        </View>
        <View style={st.iconRow}>{actions.map(a => <HeaderButton key={a.label} a={a} />)}</View>
      </View>
      <PressScale style={[st.search, { marginHorizontal: side }]} onPress={onSearch} scaleTo={0.99} accessibilityRole="search" accessibilityLabel={searchLabel}>
        <Icon name="search" size={20} color="#1F3B4D" />
        <Text style={st.searchHint} numberOfLines={1}>{hints.length ? hints[hint % hints.length] : 'Search'}</Text>
      </PressScale>
      <ScrollView ref={railRef} horizontal style={st.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={st.pillRail}
        onLayout={e => { railW.current = e.nativeEvent.layout.width; reveal(); }} accessibilityRole="tablist">
        {pills.map(([k, label]) => {
          const on = k === active;
          return (
            <PressScale key={k} onLayout={onPillLayout(k)} onPress={() => { if (!on) onPill(k); }} scaleTo={0.95} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
              style={[st.pill, on ? { backgroundColor: colors.pillOnBg, borderColor: colors.pillOnBg } : st.pillOff]}>
              <Text style={[st.pillText, { color: on ? colors.pillOnInk : 'rgba(255,255,255,0.85)' }]} numberOfLines={1}>{label}</Text>
            </PressScale>
          );
        })}
      </ScrollView>
      {/* soft fade at the right edge: the pill row scrolls */}
      <LinearGradient colors={[`${colors.bottom}00`, colors.bottom]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.pillFade} pointerEvents="none" />
    </LinearGradient>
  );
}

const st = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 16 },
  brandBlock: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  emblemGlow: Platform.select<any>({
    web: { borderRadius: 17, boxShadow: '0px 0px 12px rgba(212,175,55,0.15)' },
    default: { borderRadius: 17, shadowColor: '#D4AF37', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  }),
  emblemRing: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#C9A24A', padding: 1, backgroundColor: '#07140D' },
  emblem: { width: '100%', height: '100%', borderRadius: 16 },
  brandWord: { color: '#FFFFFF', fontSize: 22, fontWeight: '600', letterSpacing: 2, lineHeight: 26 },
  brandSub: { color: 'rgba(255,255,255,0.72)', fontSize: 12.5, fontWeight: '400', marginTop: 1, letterSpacing: 0.2 },
  iconRow: { flexDirection: 'row', alignItems: 'center', marginRight: -10 },
  hdrBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 5, right: 3, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: '#D4AF37', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#0B3D24', fontSize: 10, fontWeight: '600' },
  dot: { position: 'absolute', top: 10, right: 11, width: 10, height: 10, borderRadius: 5, backgroundColor: '#D4AF37', borderWidth: 1.5, borderColor: '#0B3D24' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, marginTop: 16, paddingHorizontal: 16, borderRadius: 24, backgroundColor: '#FFFFFF' },
  searchHint: { flex: 1, fontSize: 15, fontWeight: '400', color: '#7E909B' },
  hScroll: { flexGrow: 0, flexShrink: 0 },
  pillRail: { paddingHorizontal: SIDE, paddingTop: 14, paddingBottom: 14, gap: 8 },
  pill: { height: 36, paddingHorizontal: 15, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pillOff: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.22)' },
  pillText: { fontSize: 13, fontWeight: '500' },
  pillFade: { position: 'absolute', right: 0, bottom: 0, width: 36, height: 64 },
});
