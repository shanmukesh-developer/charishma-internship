/**
 * Food & groceries v2: category listing and search results.
 *  - Category: fixed green bar (back, title, basket); a 120 px banner in the hero style that fades
 *    and slides up under the bar as the products scroll; the search (and chips) then stay pinned;
 *    then EITHER the aisle sidebar (Groceries, All groceries) OR curated chips. Never both.
 *    The sidebar is its own scroll area: it stays in place while the products scroll.
 *  - Search: search field in the bar, result count, group chips, or a group sidebar when results
 *    span three or more groups.
 *  Products are a FlatList with fixed row heights (getItemLayout) so fast flings don't paint blank.
 * Others → Food & groceries (modules/foodV2).
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Animated, FlatList, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { CachedImage as Image } from '../../components/SafeImage';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { Item, SEARCH, TILES, HEROES, LIST_TITLES, AISLES, aisleOf, GROUP_ORDER, groupOf, BRANDS, LHERO_BG, sentence, shelfItems } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { useFoodV2Ui, Enter, ROW_H, ROW_GAP } from './FoodV2Ui';
import { useFoodV2States } from './FoodV2States';
import { SlideChips } from './FoodV2Motion';
import { BANNER_ART, BANNER_SLIDES } from './FoodV2Art';
import BannerSlider from './FoodV2BannerSlider';
import { chipsFor, inChip } from './FoodV2Chips';
import { Icon, GROUP_ICON } from './FoodV2Icons';
import { useFoodScale } from './FoodV2Scale';

const AISLE_ICON: Record<string, string> = { all: 'grid', rice: 'wheat', atta: 'package', dal: 'bean', pickles: 'flame', oil: 'droplet', snacks: 'cookie', bev: 'cup-soda', other: 'basket-outline' };
const BANNER_H = 120;
/** Space under the banner (part of the block that slides away). */
const BANNER_GAP = 22;
const STRIDE = ROW_H + ROW_GAP;
const NATIVE = Platform.OS !== 'web';

export default function FoodV2Listing({ shelf }: { shelf: string }) {
  const { router, isDark, topPad, pageW, c, pop, push, catalogue, fetchCatalogue, shopCount, cartCount, cart, savedIds, query, setQuery, chip, setChip, aisle, setAisle, failKind, forcedFail, isLoading, isFailed } = useFoodV2();
  const { headerBtn, chipOnGreen, productRow, basketBar } = useFoodV2Ui();
  const { loadingCard, stateCard } = useFoodV2States();
  const scrollY = useRef(new Animated.Value(0)).current;
  const lastY = useRef(0);
  const listRef = useRef<FlatList<Item>>(null);
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
  const chipMatch = (p: Item) => effChip === 'All' || (isSearch ? groupOf(p) === effChip : inChip(shelf, p, effChip));
  const filtered = queried.filter(chipMatch);
  const effAisle = side.some(a => a.key === aisle) ? aisle : 'all';
  const visible = side.length ? filtered.filter(p => effAisle === 'all' || sideOf(p) === effAisle) : filtered;
  const countLine = q ? `${visible.length} result${visible.length === 1 ? '' : 's'} for '${query.trim()}'` : `${visible.length} item${visible.length === 1 ? '' : 's'} in the campus store`;

  // Category pages: the banner block slides up by `collapse` as the products scroll.
  const collapse = isSearch ? 0 : hero ? BANNER_H + BANNER_GAP : 8;
  const bottomPad = (shopCount > 0 ? sc.barSpace : 24 + sc.insets.bottom) + collapse;
  const padTop = side.length ? 2 : isSearch ? 10 : 6;

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => { lastY.current = value; });
    return () => scrollY.removeListener(id);
  }, [scrollY]);
  // A new aisle / chip / query starts at the top of the products, keeping the banner as it was.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: Math.min(lastY.current, collapse), animated: false });
  }, [effAisle, effChip, q, collapse]);

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
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: NATIVE });
  const list = (
    <Animated.FlatList
      ref={listRef as any}
      style={{ flex: 1, minWidth: 0 }}
      data={visible}
      keyExtractor={(p: Item) => p.id}
      extraData={{ cart, savedIds, isDark }}
      renderItem={({ item, index }: { item: Item; index: number }) => (
        <View style={{ height: STRIDE, paddingBottom: ROW_GAP }}>
          {index < 8 ? <Enter index={index}>{productRow(item)}</Enter> : productRow(item)}
        </View>
      )}
      getItemLayout={(_: any, index: number) => ({ length: STRIDE, offset: padTop + STRIDE * index, index })}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={30}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={onScroll}
      contentContainerStyle={{ paddingTop: padTop, paddingBottom: bottomPad, paddingLeft: side.length ? 10 : 16, paddingRight: side.length ? 12 : 16 }}
    />
  );
  const sidebar = (
    <ScrollView style={[st.side, { backgroundColor: isDark ? '#141416' : '#F6F9F8' }]} contentContainerStyle={{ paddingVertical: 4, paddingBottom: bottomPad }} showsVerticalScrollIndicator={false}>
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
    </ScrollView>
  );
  const products = isLoading ? <View style={{ paddingTop: padTop }}>{loadingCard(4)}</View>
    : isFailed ? <View style={{ paddingHorizontal: 16, paddingTop: padTop }}>{stateCard(forcedFail || failKind, fetchCatalogue)}</View>
      : visible.length === 0 ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {side.length > 0 && sidebar}
          <View style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>{empty}</View>
        </View>
      )
        : side.length ? <View style={{ flex: 1, flexDirection: 'row' }}>{sidebar}{list}</View>
          : list;
  /** Clear (x) with a full 44 px tap area. */
  const clearBtn = (color: string, icon: string, size: number) => (
    <PressScale style={st.clear} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
      <Icon name={icon} size={size} color={color} />
    </PressScale>
  );

  // ── Search ──
  if (isSearch) {
    return (
      <View style={{ flex: 1, backgroundColor: FOOD.headerDeep[0], overflow: 'hidden' }}>
        <LinearGradient colors={FOOD.headerDeep} style={{ paddingTop: topPad }}>
          <View style={s.srchHead}>
            <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn}>
              <Icon name="arrow-back" size={22} color="#FFFFFF" />
            </PressScale>
            <View style={s.srchField}>
              <Icon name="search" size={19} color="#1F3B4D" />
              <TextInput style={s.srchInput} value={query} onChangeText={setQuery} placeholder="Search for 'milk', 'rice', 'chips'…" placeholderTextColor="#8A9BA6" autoFocus={!query} returnKeyType="search" maxLength={60} accessibilityLabel="Search the campus store" />
              {!!query && clearBtn('#3E5868', 'close', 19)}
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
        <View style={[s.inset, { backgroundColor: c.card }]}>{products}</View>
        {shopCount > 0 && basketBar()}
      </View>
    );
  }

  // ── Category ──
  const art = BANNER_ART[shelf];
  const fade = scrollY.interpolate({ inputRange: [0, 90], outputRange: [1, 0], extrapolate: 'clamp' });
  const slide = scrollY.interpolate({ inputRange: [0, Math.max(1, collapse)], outputRange: [0, -collapse], extrapolate: 'clamp' });
  const bannerW = pageW - 32;
  return (
    <View style={{ flex: 1, backgroundColor: c.page, overflow: 'hidden' }}>
      <LinearGradient colors={FOOD.header} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ paddingTop: topPad, zIndex: 3 }}>
        <View style={[s.listHead, { paddingBottom: 8 }]}>
          <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn}>
            <Icon name="arrow-back" size={22} color="#FFFFFF" />
          </PressScale>
          <Text style={s.listTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {headerBtn('cart-outline', 'Basket', () => router.push('/(tabs)/basket?basket=store' as any), cartCount)}
        </View>
      </LinearGradient>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {/* Banner + pinned search + products move up together by `collapse`; then only the products scroll. */}
        <Animated.View style={[st.column, { bottom: -collapse, transform: [{ translateY: slide }] }]}>
          {/* banner (fades as it slides under the bar) */}
          <View style={{ height: collapse, backgroundColor: FOOD.header[1], paddingHorizontal: 16 }}>
            {!!hero && (
              <Animated.View style={[st.banner, { height: BANNER_H, opacity: fade }]}>
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
                {!!art && <BannerSlider slides={BANNER_SLIDES[shelf] || [art]} style={[st.art, { width: bannerW * (sc.compact ? 0.44 : 0.46) }]} dotsStyle={st.dots} />}
                <View style={st.bannerText}>
                  <Text style={st.bannerTitle} numberOfLines={3}>{hero.title}</Text>
                  {!!hero.sub && <Text style={st.bannerSub} numberOfLines={2}>{hero.sub}</Text>}
                </View>
              </Animated.View>
            )}
          </View>

          {/* pinned search (and chips) */}
          <View style={{ backgroundColor: c.page, paddingTop: 10, paddingBottom: chipList.length ? 4 : 10 }}>
            <View style={[s.field, { backgroundColor: c.field, borderColor: c.line, marginTop: 0, marginBottom: 0 }]}>
              <Icon name="search" size={19} color={isDark ? '#A1A1AA' : '#1F3B4D'} />
              <TextInput style={[s.fieldInput, { color: c.title }]} value={query} onChangeText={setQuery} placeholder={`Search in ${title.toLowerCase()}`} placeholderTextColor={isDark ? '#71717A' : '#7E909B'} maxLength={60} returnKeyType="search" accessibilityLabel={`Search in ${title}`} />
              {!!query && clearBtn(c.slate, 'close-circle', 18)}
            </View>
            {chipList.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <SlideChips items={['All', ...chipList].map(k => ({ key: k, label: k }))} active={effChip} onSelect={setChip} chipBg={c.chip} textColor={c.slate} />
              </View>
            )}
          </View>

          {/* products (own scroll; the sidebar beside them scrolls on its own) */}
          <View style={{ flex: 1 }}>{products}</View>
        </Animated.View>
      </View>
      {shopCount > 0 && basketBar()}
    </View>
  );
}

const st = StyleSheet.create({
  column: { position: 'absolute', top: 0, left: 0, right: 0 },
  banner: { borderRadius: 16 },
  bannerBg: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  art: { position: 'absolute', right: -8, bottom: -16, height: BANNER_H + 22 },
  dots: { left: 16, bottom: 12 },
  bannerText: { width: '56%', paddingLeft: 16, paddingTop: 10, paddingBottom: 22, justifyContent: 'center', height: BANNER_H },
  bannerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '500', lineHeight: 23 },
  bannerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '400', lineHeight: 16, marginTop: 4 },
  side: { width: 84, flexGrow: 0, flexShrink: 0, borderTopRightRadius: 14 },
  sideItem: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, marginVertical: 2, marginRight: 6, borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  sideBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: FOOD.primary },
  sideIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  sideText: { fontSize: 11.5, lineHeight: 15, textAlign: 'center' },
  clear: { width: 44, height: 44, marginRight: -14, alignItems: 'center', justifyContent: 'center' },
});
