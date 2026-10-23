/**
 * Food & groceries v2: the top of the home screen with the reference's depth and glow:
 * green header (deep emerald, soft light, grain, gold hairline), notice, hero card (diagonal gradient, light spot,
 * floating cut-out basket spilling over the edges, shine on "Shop now") and the category tiles
 * (cut-out subjects on tinted plates, slightly over the tile top).
 * Others → Food & groceries (modules/foodV2).
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Image } from 'expo-image';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { SEARCH, SEARCH_HINTS, TILES, fmtShortClock } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { useFoodV2Ui, Enter, useHint } from './FoodV2Ui';
import { CUT, TILE_ART } from './FoodV2Art';
import { FloatY, ShineSweep } from './FoodV2Motion';
import { Icon } from './FoodV2Icons';
import { useFoodScale } from './FoodV2Scale';
import { apiFetch } from '../../utils/auth';

/** Gold dot on the bell only when the signed-in student has unread notifications (GET, read-only). */
function useUnreadDot() {
  const [dot, setDot] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    apiFetch('/api/notifications?limit=30').then(r => (r.ok ? r.json() : null)).then((d: any) => {
      const list = Array.isArray(d?.notifications) ? d.notifications : [];
      if (live) setDot(list.some((n: any) => n && (n.read === false || n.isRead === false)));
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return dot;
}

const PILLS: [string, string][] = [['food', 'Food & groc.'], ['services', 'Tech & repairs'], ['pg', 'PG'], ['coride', 'Co-Ride'], ['promos', 'Deals & spin']];

/** Luxury header palette (owner feedback): deep emerald, one soft light, fine grain, gold hairline. */
export const LUX = { top: '#0B3D24', bottom: '#0F5132', gold: '#C9A24A', goldSoft: 'rgba(201,162,74,0.35)', badge: '#E9C46A' };
const EMBLEM = require('./assets/food-v2-brand-gold-z-emblem-2026-10-23.webp');

/** One large, very soft light from the top-right (about 10% white). Smooth gradient only, no texture. */
function HeaderLight({ width, height }: { width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="fv2hdrlight" cx="92%" cy="0%" rx="78%" ry="90%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.10" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#fv2hdrlight)" />
      </Svg>
    </View>
  );
}

export function HomeHeader() {
  const { router, topPad, pageW, push, setSavedChip, openListing, sections, onSection } = useFoodV2();
  const pills: [string, string][] = sections && sections.length ? sections.map(t => [t.key, t.key === 'food' ? 'Food & groc.' : t.label] as [string, string]) : PILLS;
  const { headerBtn } = useFoodV2Ui();
  const hintIdx = useHint();
  const sc = useFoodScale();
  const unread = useUnreadDot();
  return (
    <LinearGradient colors={[LUX.top, LUX.bottom]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ paddingTop: topPad, overflow: 'hidden' }}>
      <HeaderLight width={pageW} height={topPad + 220} />
      <View style={[s.brandRow, { paddingHorizontal: sc.compact ? 16 : 20 }]}>
        <View style={st.brandBlock}>
          <View style={st.emblemGlow}>
            <View style={st.emblemRing}><Image source={EMBLEM} style={st.emblem} contentFit="cover" accessibilityLabel="ZCS emblem" /></View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.brandWord} accessibilityRole="header">ZCS</Text>
            <Text style={[s.brandSub, { fontSize: sc.compact ? 12 : 12.5 }]} numberOfLines={1}>{sc.compact ? 'Campus store' : 'Campus store · Food & groceries'}</Text>
          </View>
        </View>
        <View style={st.iconRow}>
          {headerBtn('heart-outline', 'Saved items', () => { setSavedChip('All'); push({ name: 'saved' }); })}
          {headerBtn('notifications-outline', unread ? 'Notifications, unread' : 'Notifications', () => router.push('/notifications' as any), 0, unread)}
        </View>
      </View>
      <PressScale style={[s.search, { marginHorizontal: sc.compact ? 16 : 20 }]} onPress={() => openListing(SEARCH)} scaleTo={0.99} accessibilityRole="search" accessibilityLabel="Search groceries and essentials">
        <Icon name="search" size={20} color="#1F3B4D" />
        <Text style={s.searchHint} numberOfLines={1}>{SEARCH_HINTS[hintIdx % SEARCH_HINTS.length]}</Text>
      </PressScale>
      <ScrollView horizontal style={s.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillRail}>
        {pills.map(([k, label]) => {
          const on = k === 'food';
          return (
            <PressScale key={k} onPress={() => { if (!on) { if (onSection) onSection(k); else router.push(`/(tabs)/others?tab=${k}` as any); } }} scaleTo={0.95} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
              style={[s.pill, on ? s.pillOn : s.pillOff]}>
              <Text style={[s.pillText, { color: on ? '#0B5A2E' : 'rgba(255,255,255,0.85)', fontWeight: '500' }]} numberOfLines={1}>{label}</Text>
            </PressScale>
          );
        })}
      </ScrollView>
      {/* soft fade at the right edge: the pill row scrolls */}
      <LinearGradient colors={['rgba(15,81,50,0)', LUX.bottom]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.pillFade} pointerEvents="none" />
    </LinearGradient>
  );
}

/** Green band behind the notice and the top half of the hero, the curve into white, and the hero. */
export function HomeBandHero() {
  const { isDark, pageW, c, allClosed, someClosed, earliestOpen, isLoading, isFailed, isEmpty, openListing } = useFoodV2();
  const sc = useFoodScale();
  const showNote = (allClosed || someClosed) && !isLoading && !isFailed && !isEmpty;
  const heroH = sc.hero.minH;
  const heroW = pageW - 32;
  const bandH = (showNote ? 74 : 0) + 6 + Math.round(heroH * 0.6);
  const artW = Math.round(Math.min(heroW * sc.hero.artRatio, sc.hero.artMax));
  const artH = Math.round(artW * 0.96);
  return (
    <View style={{ zIndex: 2 }}>
      <LinearGradient colors={[LUX.bottom, '#10573A']} style={{ position: 'absolute', left: 0, right: 0, top: -2, height: bandH + 2 }} />
      <Svg width={pageW} height={40} viewBox={`0 0 ${pageW} 40`} style={{ position: 'absolute', left: 0, top: bandH - 39 }}>
        <Path d={`M0 40 L0 26 Q ${pageW * 0.55} -14 ${pageW} 18 L${pageW} 40 Z`} fill={c.page} />
        <Path d={`M0 26 Q ${pageW * 0.55} -14 ${pageW} 18`} stroke={LUX.goldSoft} strokeWidth={1} fill="none" />
      </Svg>
      <View style={{ position: 'absolute', left: 0, right: 0, top: bandH, height: 40, backgroundColor: c.page }} />

      {showNote && (
        <View style={[s.notice, { backgroundColor: isDark ? 'rgba(214,237,216,0.14)' : FOOD.notice.light }]} accessibilityLiveRegion="polite">
          <Icon name="time-outline" size={24} color={isDark ? '#7FDCA3' : '#1F7A45'} />
          <View style={{ flex: 1 }}>
            <Text style={[s.noticeTitle, { color: isDark ? '#DFF5E6' : FOOD.noticeInk.light }]}>
              {allClosed ? (earliestOpen ? `Shops open at ${fmtShortClock(earliestOpen)}.` : 'Shops are closed right now.') : `Some shops open at ${earliestOpen ? fmtShortClock(earliestOpen) : 'a later time'}.`}
            </Text>
            <Text style={[s.noticeText, { color: isDark ? 'rgba(223,245,230,0.8)' : '#3E6B52' }]}>
              {allClosed ? 'Browse now and add items once they open.' : 'You can browse their items now.'}
            </Text>
          </View>
        </View>
      )}

      <View style={[s.heroCard, { minHeight: heroH, overflow: 'visible', borderWidth: 0 }]}>
        <View style={[StyleSheet.absoluteFill, st.heroBg]}>
          <LinearGradient colors={['#0B5631', '#04391F', '#032816']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Svg width={heroW} height={heroH + 120} style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id="fv2heroglow" cx="74%" cy="48%" rx="46%" ry="62%">
                <Stop offset="0" stopColor="#4ADE80" stopOpacity="0.42" />
                <Stop offset="0.55" stopColor="#22A447" stopOpacity="0.16" />
                <Stop offset="1" stopColor="#22A447" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width={heroW} height={heroH + 120} fill="url(#fv2heroglow)" />
          </Svg>
        </View>
        {/* soft shadow under the basket, then the floating cut-out spilling over the right / bottom edges */}
        <Svg width={artW} height={34} style={{ position: 'absolute', right: -6, bottom: -26 }} pointerEvents="none">
          <Defs>
            <RadialGradient id="fv2heroshadow" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor="#000000" stopOpacity="0.32" />
              <Stop offset="1" stopColor="#000000" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx={artW / 2} cy={17} rx={artW / 2.3} ry={12} fill="url(#fv2heroshadow)" />
        </Svg>
        <FloatY style={{ position: 'absolute', right: -16, bottom: -20, width: artW, height: artH }}>
          <Image source={CUT.hero} style={{ width: artW, height: artH }} contentFit="contain" accessibilityElementsHidden />
        </FloatY>
        <View style={[s.heroText, { width: `${Math.round(sc.hero.textRatio * 100)}%` as any, flex: 0, paddingBottom: 20 }]}>
          <Text style={[s.heroTitle, { fontSize: sc.hero.title, lineHeight: Math.round(sc.hero.title * 1.25) }]} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.85} accessibilityRole="header">Campus essentials delivered to you</Text>
          <Text style={[s.heroSub, { fontSize: sc.hero.sub, lineHeight: Math.round(sc.hero.sub * 1.45) }]} numberOfLines={2}>Fresh groceries · Tasty snacks · Daily needs</Text>
          <PressScale style={s.brightWrapSm} onPress={() => openListing('All Groceries')} accessibilityRole="button" accessibilityLabel="Shop now: open the whole campus store">
            <LinearGradient colors={FOOD.bright} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.heroBtn}>
              <Text style={[s.heroBtnText, { fontSize: sc.f(14) }]} numberOfLines={1}>Shop now</Text>
              <Icon name="arrow-forward" size={15} color="#FFFFFF" />
              <ShineSweep width={130} />
            </LinearGradient>
          </PressScale>
        </View>
      </View>
    </View>
  );
}

/** Shop by category: 3 + 2 tiles, cut-out subjects on tinted plates. */
export function CategoryTiles() {
  const { isDark, pageW, c, shadow, hasShelf, openListing } = useFoodV2();
  const { head } = useFoodV2Ui();
  const sc = useFoodScale();
  const tiles = TILES.filter(t => hasShelf(t.key));
  if (!tiles.length) return null;
  const rows = sc.tileCols === 2
    ? tiles.reduce((acc: typeof tiles[], t, i) => { if (i % 2 === 0) acc.push([t]); else acc[acc.length - 1].push(t); return acc; }, [])
    : tiles.length === 5 ? [tiles.slice(0, 3), tiles.slice(3)] : tiles.length === 4 ? [tiles.slice(0, 2), tiles.slice(2)] : tiles.length === 6 ? [tiles.slice(0, 3), tiles.slice(3)] : [tiles];
  return (
    <View style={[s.sec, { marginTop: 30 }]}>
      {head('Shop by category', { onAll: () => openListing('All Groceries'), arrow: true })}
      {rows.map((row, ri) => (
        <View key={ri} style={[s.tileRow, { marginTop: 12 }]}>
          {row.map((t, ti) => {
            const w = Math.floor((pageW - 32 - 10 * (row.length - 1)) / row.length);
            const art = TILE_ART[t.key];
            const tint = art ? art.tint[isDark ? 1 : 0] : c.tile;
            return (
              <Enter key={t.key} index={ri * 3 + ti}>
                <PressScale onPress={() => openListing(t.key)} scaleTo={0.97} style={{ width: w }} accessibilityRole="button" accessibilityLabel={t.label}>
                  <View style={[st.tile, { backgroundColor: c.card }, shadow]}>
                    <View style={[st.plate, { backgroundColor: tint }]}>
                      <Svg width={w - 12} height={18} style={st.plateShadow} pointerEvents="none">
                        <Defs>
                          <RadialGradient id={`fv2ts${ri}${ti}`} cx="50%" cy="50%" rx="50%" ry="50%">
                            <Stop offset="0" stopColor="#0F2A1E" stopOpacity="0.22" />
                            <Stop offset="1" stopColor="#0F2A1E" stopOpacity="0" />
                          </RadialGradient>
                        </Defs>
                        <Ellipse cx={(w - 12) / 2} cy={9} rx={(w - 12) / 2.6} ry={6} fill={`url(#fv2ts${ri}${ti})`} />
                      </Svg>
                    </View>
                    {art ? (
                      <Image source={art.art} style={[st.cut, Platform.OS === 'web' ? null : null]} contentFit="contain" accessibilityElementsHidden />
                    ) : null}
                    <Text style={[st.label, { color: isDark ? c.name : '#334651', fontSize: sc.f(12.5), lineHeight: sc.f(16) + 1, minHeight: (sc.f(16) + 1) * 2 }]} numberOfLines={2}>{t.label}</Text>
                  </View>
                </PressScale>
              </Enter>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  brandBlock: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  emblemGlow: Platform.select<any>({
    web: { borderRadius: 17, boxShadow: '0px 0px 12px rgba(212,175,55,0.15)' },
    default: { borderRadius: 17, shadowColor: '#D4AF37', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  }),
  emblemRing: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#C9A24A', padding: 1, backgroundColor: '#07140D' },
  emblem: { width: '100%', height: '100%', borderRadius: 16 },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 0, marginRight: -10 },
  heroBg: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: FOOD.heroLine },
  tile: { borderRadius: 12, paddingBottom: 12 },
  pillFade: { position: 'absolute', right: 0, bottom: 0, width: 36, height: 64 },
  plate: { height: 72, margin: 6, marginBottom: 0, borderRadius: 10 },
  plateShadow: { position: 'absolute', left: 0, bottom: 0 },
  cut: { position: 'absolute', left: 8, right: 8, top: -14, height: 86 },
  label: { fontSize: 12.5, fontWeight: '500', lineHeight: 16, marginTop: 8, paddingHorizontal: 8, textAlign: 'center' },
});
