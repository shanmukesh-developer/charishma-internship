/**
 * Food & groceries v2: the top of the home screen with the reference's depth and glow:
 * green header (deep emerald, soft light, grain, gold hairline), notice, hero card (diagonal gradient, light spot,
 * floating cut-out basket spilling over the edges, shine on "Shop now") and the category tiles
 * (cut-out subjects on tinted plates, slightly over the tile top).
 * Others → Food & groceries (modules/foodV2).
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Image } from 'expo-image';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { SEARCH, SEARCH_HINTS, TILES, fmtShortClock, tileRows } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { useFoodV2Ui, Enter } from './FoodV2Ui';
import SectionHeader, { FOOD_HEADER } from './FoodV2SectionHeader';
import { CUT, TILE_ART } from './FoodV2Art';
import { FloatY, ShineSweep } from './FoodV2Motion';
import { Icon } from './FoodV2Icons';
import { useFoodScale } from './FoodV2Scale';
import { apiFetch } from '../../utils/auth';
import { useAuth } from '../../context/AuthContext';
import { BUTTON_ROLE } from '../../utils/pressRole';
import { goHome } from '../../utils/goHome';

/** Gold dot on the bell only when the signed-in student has unread notifications (GET, read-only). A guest has
 * none to read: no request (it used to answer 401 on every Groceries / Services open). */
export function useUnreadDot() {
  const { user } = useAuth();
  const uid = String(user?._id || user?.id || '');
  const [dot, setDot] = React.useState(false);
  React.useEffect(() => {
    if (!uid) { setDot(false); return; }
    let live = true;
    apiFetch('/api/notifications?limit=30').then(r => (r.ok ? r.json() : null)).then((d: any) => {
      const list = Array.isArray(d?.notifications) ? d.notifications : [];
      if (live) setDot(list.some((n: any) => n && (n.read === false || n.isRead === false)));
    }).catch(() => {});
    return () => { live = false; };
  }, [uid]);
  return dot;
}

const PILLS: [string, string][] = [['food', 'Food & groceries'], ['pg', 'PG stays'], ['services', 'Tech & repairs'], ['coride', 'Co-Ride'], ['promos', 'Deals & spin']];

/** Luxury header palette (owner feedback): deep emerald, one soft light, fine grain, gold hairline. */
export const LUX = { top: '#0B3D24', bottom: '#0F5132', gold: '#C9A24A', goldSoft: 'rgba(201,162,74,0.35)', badge: '#E9C46A' };

export function HomeHeader() {
  const { router, topPad, pageW, push, setSavedChip, openListing, sections, onSection, catalogue } = useFoodV2();
  const pills: [string, string][] = sections && sections.length ? sections.map(t => [t.key, t.label] as [string, string]) : PILLS;
  // Hints from what the store really sells (the fixed milk / rice / chips hints found nothing in a pickles-only
  // catalogue): short real product names, else the generic hints while the catalogue loads.
  const hints = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const p of catalogue) {
      const n = String(p.name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
      const key = n.toLowerCase();
      if (!n || n.length > 22 || seen.has(key)) continue;
      seen.add(key);
      names.push(`Search for '${n.toLowerCase()}'`);
      if (names.length >= 6) break;
    }
    return names.length ? names : SEARCH_HINTS;
  }, [catalogue]);
  const sc = useFoodScale();
  const unread = useUnreadDot();
  return (
    <SectionHeader
      topPad={topPad}
      pageW={pageW}
      compact={sc.compact}
      colors={FOOD_HEADER}
      // The active pill already says "Food & groceries"; the short line fits every phone width.
      subtitle="Campus store"
      hints={hints}
      searchLabel="Search groceries and essentials"
      onSearch={() => openListing(SEARCH)}
      pills={pills}
      active="food"
      onPill={k => { if (onSection) onSection(k); else router.push(`/(tabs)/others?tab=${k}` as any); }}
      onBack={() => goHome(router)}
      actions={[
        { icon: 'heart-outline', label: 'Saved items', onPress: () => { setSavedChip('All'); push({ name: 'saved' }); } },
        { icon: 'notifications-outline', label: unread ? 'Notifications, unread' : 'Notifications', onPress: () => router.push('/notifications' as any), dot: unread },
      ]}
    />
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
  // Narrow phones (< 400 px): the basket stays inside the card; larger phones keep the spill-over look.
  const inside = sc.w < 400;
  const artW = Math.round(inside ? Math.min(heroW * 0.42, heroH - 16) : Math.min(heroW * sc.hero.artRatio, sc.hero.artMax));
  const artH = Math.round(artW * 0.96);
  const textPct = inside ? 0.58 : sc.hero.textRatio;
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
        <FloatY style={{ position: 'absolute', right: inside ? 8 : -16, bottom: inside ? 8 : -20, width: artW, height: artH }}>
          <Image source={CUT.hero} style={{ width: artW, height: artH }} contentFit="contain" accessibilityElementsHidden />
        </FloatY>
        <View style={[s.heroText, { width: `${Math.round(textPct * 100)}%` as any, flex: 0, paddingBottom: 20 }]}>
          {/* wraps freely (no "…"): the card grows if a small phone needs a fourth line */}
          <Text style={[s.heroTitle, { fontSize: inside ? Math.min(sc.hero.title, 20) : sc.hero.title, lineHeight: Math.round((inside ? Math.min(sc.hero.title, 20) : sc.hero.title) * 1.25) }]} accessibilityRole="header">Campus essentials delivered to you</Text>
          <Text style={[s.heroSub, { fontSize: sc.hero.sub, lineHeight: Math.round(sc.hero.sub * 1.45) }]}>Fresh groceries · Tasty snacks · Daily needs</Text>
          <PressScale style={s.brightWrapSm} onPress={() => openListing('All Groceries')} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Shop now: open the whole campus store">
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

/** Shop by category: 3 + 2 + 2 tiles (tileRows; 3 + 3 / 3 + 2 while a shelf is empty), cut-out subjects on tinted plates. */
export function CategoryTiles() {
  const { isDark, pageW, c, shadow, hasShelf, openListing, openShops, push } = useFoodV2();
  const { head } = useFoodV2Ui();
  const sc = useFoodScale();
  const tiles = TILES.filter(t => hasShelf(t.key));
  if (!tiles.length) return null;
  const rows = tileRows(tiles, sc.tileCols);
  return (
    <View style={[s.sec, { marginTop: 30 }]}>
      {head('Shop by category', { onAll: () => push({ name: 'categories' }), arrow: true })}
      {rows.map((row, ri) => (
        <View key={ri} style={[s.tileRow, { marginTop: 12 }]}>
          {row.map((t, ti) => {
            const w = Math.floor((pageW - 32 - 10 * (row.length - 1)) / row.length);
            const art = TILE_ART[t.key];
            const tint = art ? art.tint[isDark ? 1 : 0] : c.tile;
            return (
              <Enter key={t.key} index={ri * 3 + ti}>
                <PressScale onPress={() => openShops(t.key)} scaleTo={0.97} style={{ width: w }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={t.label}>
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
