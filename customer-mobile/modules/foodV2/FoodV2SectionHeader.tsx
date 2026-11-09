/**
 * The one Others header (Food & groceries v2 style), shared by every Others section:
 * back arrow, the ZenWe badge + "ZenWe" and the section line, plain header icons, a white search pill with
 * rotating section hints, and the section pills. Each section passes only its own accent colours.
 * Used by Food & groceries (FoodV2HomeTop) and by the other sections in app/(tabs)/others.tsx.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import FolderTabRail from '../others/FolderTabRail';
import ZenvBadge from '../../components/ZenvBadge';
import { PressScale } from '../../modules/others/motion';
import { Icon } from './FoodV2Icons';
import { useScreenActive } from '../../utils/useAppActive';
import { BUTTON_ROLE } from '../../utils/pressRole';
import { usePillReveal } from '../others/SectionPillRail';

export type HeaderAction = { icon: string; label: string; onPress: () => void; badge?: number; dot?: boolean };
export type HeaderColors = {
  top: string; bottom: string; pillOnBg: string; pillOnInk: string;
  /** A light band (Services: the diet band, owner 10 Nov 2026): brand, icons and pills draw in this dark ink instead
   * of white. Unset = the dark header with white ink (Food & groceries unchanged). */
  ink?: string;
  /** Unselected pill fill and edge on a light band. */
  pillOffBg?: string; pillOffLine?: string;
  /** Services (owner, 10 Nov 2026): the page colour under the header. Set = Home-style folder tabs instead of pills
   * (the selected tab flows into the page) and no ZenWe badge row - the section name is the title. */
  page?: string;
};

/** Food & groceries: deep emerald (the reference look). */
export const FOOD_HEADER: HeaderColors = { top: '#0B3D24', bottom: '#0F5132', pillOnBg: '#E6F6EA', pillOnInk: '#0B5A2E' };
const SIDE = 16;

/**
 * Rotating search hint (every 2.5 s). Its own small component: the tick used to re-render the whole
 * header (gradient, SVG light, emblem, pills) every 2.5 s, also while the tab was hidden or the app
 * was in the background. Now only this one Text updates, and only while the screen is on view.
 */
const RotatingHint = React.memo(function RotatingHint({ hints }: { hints: string[] }) {
  const [i, setI] = useState(0);
  const on = useScreenActive();
  useEffect(() => {
    if (!on || hints.length < 2) return;
    const t = setInterval(() => setI(v => v + 1), 2500);
    return () => clearInterval(t);
  }, [on, hints.length]);
  return <Text style={st.searchHint} numberOfLines={1}>{hints.length ? hints[i % hints.length] : 'Search'}</Text>;
});

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

function HeaderButton({ a, colors }: { a: HeaderAction; colors: HeaderColors }) {
  const badge = a.badge || 0;
  return (
    <PressScale style={st.hdrBtn} scaleTo={0.92} haptic onPress={a.onPress} accessibilityRole={BUTTON_ROLE} accessibilityLabel={badge ? `${a.label}, ${badge} item${badge === 1 ? '' : 's'}` : a.label}>
      <Icon name={a.icon} size={22} strokeWidth={1.6} color={colors.ink || 'rgba(255,255,255,0.95)'} />
      {badge > 0 && <View style={[st.badge, colors.ink ? { backgroundColor: colors.pillOnBg } : null]}><Text style={[st.badgeText, colors.ink ? { color: colors.pillOnInk } : null]}>{badge > 99 ? '99+' : badge}</Text></View>}
      {!!a.dot && badge === 0 && <View style={[st.dot, colors.ink ? { backgroundColor: colors.pillOnBg, borderColor: colors.top } : null]} />}
    </PressScale>
  );
}

export default function SectionHeader({ topPad, pageW, compact, colors, subtitle, hints, searchLabel, onSearch, pills, active, onPill, onBack, actions }: {
  topPad: number; pageW: number; compact: boolean; colors: HeaderColors;
  subtitle: string; hints: string[]; searchLabel: string; onSearch: () => void;
  pills: [string, string][]; active: string; onPill: (key: string) => void;
  onBack?: () => void; actions: HeaderAction[];
}) {
  // Scroll only when the active pill would be cut off on the right, and then start the row on a whole pill.
  const { railRef, tail, onRailLayout, onPillLayout } = usePillReveal(active, SIDE);
  const side = compact ? 16 : 20;
  // Light band (Services): dark ink everywhere white used to be.
  const ink = colors.ink;
  return (
    <LinearGradient colors={[colors.top, colors.bottom]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ paddingTop: topPad, overflow: 'hidden' }}>
      <HeaderLight width={pageW} height={topPad + 220} />
      <View style={[st.brandRow, { paddingLeft: onBack ? side - 10 : side, paddingRight: side }]}>
        {!!onBack && (
          <PressScale style={st.hdrBtn} scaleTo={0.92} onPress={onBack} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Back to Home">
            <Icon name="arrow-back" size={22} strokeWidth={1.6} color={ink || '#FFFFFF'} />
          </PressScale>
        )}
        {colors.page ? (
          <View style={st.brandBlock}>
            <Text style={[st.sectionTitle, { color: ink || '#FFFFFF', fontSize: compact ? 20 : 22 }]} numberOfLines={1} accessibilityRole="header">{(pills.find(([k]) => k === active) || [null, subtitle])[1]}</Text>
          </View>
        ) : (
          <View style={st.brandBlock}>
            <ZenvBadge size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[st.brandWord, ink ? { color: ink } : null]} accessibilityRole="header">ZenWe</Text>
              <Text style={[st.brandSub, { fontSize: compact ? 12 : 12.5 }, ink ? { color: ink, opacity: 0.72 } : null]} numberOfLines={1}>{subtitle}</Text>
            </View>
          </View>
        )}
        <View style={st.iconRow}>{actions.map(a => <HeaderButton key={a.label} a={a} colors={colors} />)}</View>
      </View>
      <PressScale style={[st.search, { marginHorizontal: side }, ink && colors.pillOffLine ? { borderWidth: 1, borderColor: colors.pillOffLine } : null]} onPress={onSearch} scaleTo={0.99} accessibilityRole="search" accessibilityLabel={searchLabel}>
        <Icon name="search" size={20} color="#1F3B4D" />
        <RotatingHint hints={hints} />
      </PressScale>
      {colors.page ? (
        <FolderTabRail tabs={pills} active={active} onTab={onPill} band={colors.bottom} page={colors.page} ink={ink || '#FFFFFF'} accent={colors.pillOnBg} side={side} />
      ) : (<>
      <ScrollView ref={railRef} horizontal style={st.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={[st.pillRail, { paddingRight: SIDE + tail }]}
        onLayout={onRailLayout} accessibilityRole="tablist">
        {pills.map(([k, label]) => {
          const on = k === active;
          return (
            <PressScale key={k} onLayout={onPillLayout(k)} onPress={() => { if (!on) onPill(k); }} scaleTo={0.95} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
              style={[st.pill, on ? { backgroundColor: colors.pillOnBg, borderColor: colors.pillOnBg } : ink ? { backgroundColor: colors.pillOffBg || 'transparent', borderColor: colors.pillOffLine || ink } : st.pillOff]}>
              <Text style={[st.pillText, { color: on ? colors.pillOnInk : ink || 'rgba(255,255,255,0.85)' }]} numberOfLines={1}>{label}</Text>
            </PressScale>
          );
        })}
      </ScrollView>
      {/* soft fade at the right edge: the pill row scrolls */}
      <LinearGradient colors={[`${colors.bottom}00`, colors.bottom]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.pillFade} pointerEvents="none" />
      </>)}
    </LinearGradient>
  );
}

const st = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 16 },
  brandBlock: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontWeight: '900', letterSpacing: -0.3 },
  brandWord: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', letterSpacing: 0.2, lineHeight: 26 },
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
