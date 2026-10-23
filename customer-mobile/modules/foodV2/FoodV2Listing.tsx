/**
 * Food & groceries v2: category listing and search results.
 *  - Category: fixed green bar (back, title, basket); a 120 px banner in the hero style that fades
 *    and scrolls under the bar; the search stays pinned; then EITHER the aisle sidebar (Groceries,
 *    All groceries) OR curated chips (full-width shelves). Never both. No decoration over products.
 *  - Search: search field in the bar, result count, group chips, or a group sidebar when results
 *    span three or more groups.
 * Others → Food & groceries (modules/foodV2).
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Image as ExpoImage } from 'expo-image';
import { CachedImage as Image } from '../../components/SafeImage';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { Item, SEARCH, TILES, HEROES, LIST_TITLES, AISLES, aisleOf, GROUP_ORDER, groupOf, BRANDS, LHERO_BG, sentence, shelfItems } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { useFoodV2Ui, Enter } from './FoodV2Ui';
import { useFoodV2States } from './FoodV2States';
import { SlideChips } from './FoodV2Motion';
import { BANNER_ART, BANNER_SLIDES } from './FoodV2Art';
import BannerSlider from './FoodV2BannerSlider';
import { chipOf, chipsFor } from './FoodV2Chips';
import { Icon, GROUP_ICON } from './FoodV2Icons';
import { useFoodScale } from './FoodV2Scale';

const AISLE_ICON: Record<string, string> = { all: 'grid', rice: 'wheat', atta: 'package', dal: 'bean', oil: 'droplet', snacks: 'cookie', bev: 'cup-soda', other: 'basket-outline' };
const BANNER_H = 120;

export default function FoodV2Listing({ shelf }: { shelf: string }) {
  const { router, isDark, topPad, pageW, c, shadow, pop, push, catalogue, fetchCatalogue, shopCount, cartCount, query, setQuery, chip, setChip, aisle, setAisle, failKind, forcedFail, isLoading, isFailed } = useFoodV2();
  const { headerBtn, chipOnGreen, productRow, basketBar } = useFoodV2Ui();
  const { loadingCard, stateCard } = useFoodV2States();
  const scrollY = useRef(new Animated.Value(0)).current;
  const sc = useFoodScale();

  const isSearch = shelf === SEARCH;
  const base = isSearch ? catalogue : shelfItems(shelf, catalogue);
  const title = isSearch ? 'Search' : TILES.find(t => t.key === shelf)?.label || LIST_TITLES[shelf] || (BRANDS.some(b => b.name === shelf) ? shelf : sentence(shelf));
  const hero = isSearch ? null : HEROES[shelf];
  const q = query.trim().toLowerCase();
  const queried = base.filter(p => !q || p.name.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
  const groups = GROUP_ORDER.filter(g => queried.some(p => groupOf(p) === g));

  // one category navigation only: sidebar (aisles / search groups) or curated chips
  const useSidebar = isSearch ? (!!q && groups.length >= 3) : !!hero?.sidebar;
  let side: { key: string; label: string; icon: string }[] = [];
  let sideOf: (p: Item) => string = () => 'all';
  if (useSidebar && !isSearch) {
    const present = new Set(base.map(aisleOf));
    side = [{ key: 'all', label: 'All', icon: AISLE_ICON.all },
      ...AISLES.filter(a => present.has(a.key)).map(a => ({ key: a.key, label: a.label, icon: AISLE_ICON[a.key] })),
      ...(present.has('other') ? [{ key: 'other', label: 'Other', icon: AISLE_ICON.other }] : [])];
    sideOf = aisleOf;
    if (side.length < 3) side = [];
  } else if (useSidebar) {
    side = [{ key: 'all', label: 'All', icon: AISLE_ICON.all }, ...groups.map(g => ({ key: g, label: g, icon: GROUP_ICON[g] || 'basket-outline' }))];
    sideOf = groupOf;
  }
  const chipList = side.length ? [] : isSearch ? groups : chipsFor(shelf, base);
  const effChip = chip === 'All' || chipList.includes(chip) ? chip : 'All';
  const chipMatch = (p: Item) => effChip === 'All' || (isSearch ? groupOf(p) === effChip : chipOf(shelf, p) === effChip);
  const filtered = queried.filter(chipMatch);
  const effAisle = side.some(a => a.key === aisle) ? aisle : 'all';
  const visible = side.length ? filtered.filter(p => effAisle === 'all' || sideOf(p) === effAisle) : filtered;
  const countLine = q ? `${visible.length} result${visible.length === 1 ? '' : 's'} for '${query.trim()}'` : `${visible.length} item${visible.length === 1 ? '' : 's'} in the campus store`;

  const empty = (
    <View style={[s.emptyCard, { backgroundColor: c.soft, marginHorizontal: 16 }]}>
      <Icon name={q ? 'search-outline' : 'basket-outline'} size={34} color={FOOD.primary} />
      <Text style={[s.emptyTitle, { color: c.title }]}>{q ? 'No matches' : 'Nothing here yet'}</Text>
      <Text style={[s.emptyText, { color: c.slate }]}>{q ? `Nothing matches "${query.trim()}". Request it and a shopper will buy it for you.` : 'Request it and a shopper will buy it for you.'}</Text>
      <PressScale style={[s.emptyBtn, { backgroundColor: FOOD.primary }]} onPress={() => push({ name: 'mega' })} accessibilityRole="button">
        <Text style={s.emptyBtnText}>Start a shopping list</Text>
      </PressScale>
    </View>
  );
  const list = (
    <View style={{ flex: 1, minWidth: 0, paddingLeft: side.length ? 10 : 16, paddingRight: side.length ? 12 : 16, gap: 10 }}>
      {visible.map((p, i) => <Enter key={p.id} index={i}>{productRow(p)}</Enter>)}
    </View>
  );
  const sidebar = (
    <View style={[st.side, { backgroundColor: isDark ? '#141416' : '#F6F9F8' }]}>
      {side.map(a => {
        const on = effAisle === a.key;
        return (
          <PressScale key={a.key} style={[st.sideItem, on && { backgroundColor: isDark ? 'rgba(76,193,122,0.14)' : '#E3F5EB' }]} onPress={() => setAisle(a.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={a.label}>
            {on && <View style={st.sideBar} />}
            <View style={[st.sideIcon, { backgroundColor: on ? (isDark ? 'rgba(76,193,122,0.2)' : '#FFFFFF') : (isDark ? '#1D1D20' : '#FFFFFF') }]}>
              <Icon name={a.icon} size={18} color={on ? FOOD.primary : (isDark ? '#A1A1AA' : '#6B7F8C')} />
            </View>
            <Text style={[st.sideText, { color: on ? (isDark ? '#7FDCA3' : FOOD.primary) : (isDark ? '#A1A1AA' : '#6B7F8C'), fontWeight: on ? '500' : '400' }]} numberOfLines={2}>{a.label}</Text>
          </PressScale>
        );
      })}
    </View>
  );
  const body = isLoading ? loadingCard(4)
    : isFailed ? <View style={{ paddingHorizontal: 16 }}>{stateCard(forcedFail || failKind, fetchCatalogue)}</View>
      : visible.length === 0 ? empty
        : side.length ? <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>{sidebar}{list}</View>
          : list;
  const bottomPad = shopCount > 0 ? sc.barSpace : 24 + sc.insets.bottom;

  // ── Search ──
  if (isSearch) {
    return (
      <View style={{ flex: 1, backgroundColor: FOOD.headerDeep[0] }}>
        <LinearGradient colors={FOOD.headerDeep} style={{ paddingTop: topPad }}>
          <View style={s.srchHead}>
            <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn}>
              <Icon name="arrow-back" size={22} color="#FFFFFF" />
            </PressScale>
            <View style={s.srchField}>
              <Icon name="search" size={19} color="#1F3B4D" />
              <TextInput style={s.srchInput} value={query} onChangeText={setQuery} placeholder="Search for 'milk', 'rice', 'chips'…" placeholderTextColor="#8A9BA6" autoFocus={!query} returnKeyType="search" maxLength={60} accessibilityLabel="Search the campus store" />
              {!!query && (
                <PressScale onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Icon name="close" size={19} color="#3E5868" />
                </PressScale>
              )}
            </View>
          </View>
          {!isLoading && !isFailed && <Text style={s.srchCount}>{countLine}</Text>}
          {chipList.length > 0 && (
            <ScrollView horizontal style={s.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRail}>
              {['All', ...chipList].map(g => chipOnGreen(g, g, effChip === g, () => setChip(g)))}
            </ScrollView>
          )}
          <View style={{ height: 10 }} />
        </LinearGradient>
        <View style={[s.inset, { backgroundColor: c.card }]}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: side.length ? 0 : 10, paddingBottom: bottomPad }}>
            {body}
          </ScrollView>
        </View>
        {shopCount > 0 && basketBar()}
      </View>
    );
  }

  // ── Category ──
  const art = BANNER_ART[shelf];
  const fade = scrollY.interpolate({ inputRange: [0, 90], outputRange: [1, 0], extrapolate: 'clamp' });
  const lift = scrollY.interpolate({ inputRange: [0, 120], outputRange: [0, -18], extrapolate: 'clamp' });
  const bannerW = pageW - 32;
  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <LinearGradient colors={FOOD.header} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ paddingTop: topPad, zIndex: 3 }}>
        <View style={[s.listHead, { paddingBottom: 8 }]}>
          <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn}>
            <Icon name="arrow-back" size={22} color="#FFFFFF" />
          </PressScale>
          <Text style={s.listTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {headerBtn('cart-outline', 'Basket', () => router.push('/(tabs)/basket' as any), cartCount)}
        </View>
      </LinearGradient>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[1]}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        contentContainerStyle={{ paddingBottom: bottomPad }}
      >
        {/* 0: banner (fades and scrolls under the bar) */}
        <View style={{ backgroundColor: FOOD.header[1], paddingHorizontal: 16, paddingBottom: hero ? 22 : 8 }}>
          {!!hero && (
            <Animated.View style={[st.banner, { minHeight: BANNER_H, opacity: fade, transform: [{ translateY: lift }] }]}>
              <View style={[StyleSheet.absoluteFill, st.bannerBg]}>
                <LinearGradient colors={['#1E7A42', LHERO_BG, '#0E4A27']} locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <Svg width={bannerW} height={BANNER_H + 40} style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Defs>
                    <RadialGradient id="fv2banglow" cx="78%" cy="55%" rx="42%" ry="75%">
                      <Stop offset="0" stopColor="#4ADE80" stopOpacity="0.42" />
                      <Stop offset="1" stopColor="#4ADE80" stopOpacity="0" />
                    </RadialGradient>
                  </Defs>
                  <Rect x="0" y="0" width={bannerW} height={BANNER_H + 40} fill="url(#fv2banglow)" />
                </Svg>
                {!art && (
                  <View style={s.lHeroImg}>
                    <Image source={{ uri: hero.img }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityElementsHidden />
                    <LinearGradient colors={[LHERO_BG, 'rgba(26,98,52,0.55)', 'rgba(26,98,52,0)']} locations={[0, 0.3, 0.62]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
                    <View style={[s.seam, { backgroundColor: LHERO_BG }]} />
                  </View>
                )}
              </View>
              {!!art && (
                <>
                  <Svg width={bannerW * 0.44} height={26} style={st.artShadow} pointerEvents="none">
                    <Defs>
                      <RadialGradient id="fv2banshadow" cx="50%" cy="50%" rx="50%" ry="50%">
                        <Stop offset="0" stopColor="#000000" stopOpacity="0.3" />
                        <Stop offset="1" stopColor="#000000" stopOpacity="0" />
                      </RadialGradient>
                    </Defs>
                    <Ellipse cx={bannerW * 0.22} cy={13} rx={bannerW * 0.19} ry={9} fill="url(#fv2banshadow)" />
                  </Svg>
                  <BannerSlider slides={BANNER_SLIDES[shelf] || [art]} style={[st.art, { width: bannerW * (sc.compact ? 0.44 : 0.46) }]} dotsStyle={st.dots} />
                </>
              )}
              <View style={st.bannerText}>
                <Text style={st.bannerTitle}>{hero.title}</Text>
                {!!hero.sub && <Text style={st.bannerSub}>{hero.sub}</Text>}
              </View>
            </Animated.View>
          )}
        </View>

        {/* 1: pinned search */}
        <View style={{ backgroundColor: c.page, paddingTop: 10, paddingBottom: chipList.length ? 4 : 10 }}>
          <View style={[s.field, { backgroundColor: c.field, borderColor: c.line, marginTop: 0, marginBottom: 0 }]}>
            <Icon name="search" size={19} color={isDark ? '#A1A1AA' : '#1F3B4D'} />
            <TextInput style={[s.fieldInput, { color: c.title }]} value={query} onChangeText={setQuery} placeholder={`Search in ${title.toLowerCase()}`} placeholderTextColor={isDark ? '#71717A' : '#7E909B'} maxLength={60} returnKeyType="search" accessibilityLabel={`Search in ${title}`} />
            {!!query && (
              <PressScale onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Clear search">
                <Icon name="close-circle" size={18} color={c.slate} />
              </PressScale>
            )}
          </View>
          {chipList.length > 0 && (
            <View style={{ marginTop: 10 }}>
              <SlideChips items={['All', ...chipList].map(k => ({ key: k, label: k }))} active={effChip} onSelect={setChip} chipBg={c.chip} textColor={c.slate} />
            </View>
          )}
        </View>

        {/* 2: products */}
        <View style={{ paddingTop: side.length ? 2 : 6 }}>{body}</View>
      </Animated.ScrollView>
      {shopCount > 0 && basketBar()}
    </View>
  );
}

const st = StyleSheet.create({
  banner: { borderRadius: 16 },
  bannerBg: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  art: { position: 'absolute', right: -8, bottom: -16, height: BANNER_H + 22 },
  artShadow: { position: 'absolute', right: 4, bottom: -22 },
  dots: { left: 16, bottom: 12 },
  bannerText: { width: '55%', paddingLeft: 16, paddingTop: 16, paddingBottom: 28, justifyContent: 'center', minHeight: BANNER_H },
  bannerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '500', lineHeight: 26 },
  bannerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '400', lineHeight: 17, marginTop: 6 },
  side: { width: 84, borderTopRightRadius: 14, borderBottomRightRadius: 14, paddingVertical: 4, alignSelf: 'flex-start' },
  sideItem: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, marginVertical: 2, marginRight: 6, borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  sideBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: FOOD.primary },
  sideIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  sideText: { fontSize: 11.5, lineHeight: 15, textAlign: 'center' },
});
