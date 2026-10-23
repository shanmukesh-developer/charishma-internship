/**
 * Food & groceries v2: home (green header, notice, hero, categories and the home shelves).
 * Others → Food & groceries (modules/foodV2).
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Platform, Alert, Modal, useWindowDimensions, BackHandler } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { useRouter, useFocusEffect } from 'expo-router';
import { CachedImage as Image } from '../../components/SafeImage';
import ShimmerLoader from '../../components/ShimmerLoader';
import { PressScale, BounceOnChange, FadeInUp, SlowLoadHint } from '../../modules/others/motion';
import { useCart, isCustomRequest } from '../../context/CartContext';
import { apiFetch, readJson } from '../../utils/auth';
import { API_URL } from '../../constants/api';
import { readCache } from '../../utils/swrCache';
import { useConnectionState } from '../../utils/offlineStatus';
import { useTopInset } from '../../utils/useTopInset';
import { FOOD } from './foodV2Theme';
import { FOOD_IMG, StorefrontArt, ShoppingBasketArt, WaveArt, LoadingDots } from './FoodV2Kit';
import { IonName, Item, SHOP_TYPES, CATALOGUE_CACHE_KEY, FALLBACK_IMG, MEGA_BASKET_VENDOR, WISHLIST_KEY, toItem, toList, groupIN, fmt, sentence, offLabel, fmtShortClock, squash, Shelf, SHELVES, shelfItems, SEARCH, SEARCH_HINTS, TILES, Hero, HEROES, LIST_TITLES, AISLES, aisleOf, SHORT_CHIP, chipLabel, FRESH_CATS, GROUP_ORDER, groupOf, BRANDS, TOY_TILES, HEALTH_TILES, ESSENTIAL_AISLES, HERO_BG, LHERO_BG, POPULAR_REQUESTS, Route, DemoState, Saved } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { useFoodV2Ui, Enter, useHint } from './FoodV2Ui';
import { useFoodV2States } from './FoodV2States';
import { HomeHeader, HomeBandHero, CategoryTiles } from './FoodV2HomeTop';
import { useFoodScale } from './FoodV2Scale';
import { Icon } from './FoodV2Icons';

export default function FoodV2Home() {
  const { router, isDark, m, topPad, winW, pageW, conn, cart, addToCart, updateQuantity, clearCart, mounted, c, shadow, greenGlow, stack, setStack, route, push, pop, homeKey, setHomeKey, reset, demo, setDemo, savedSheet, setSavedSheet, savedSample, setSavedSample, catalogue, setCatalogue, status, setStatus, storeHours, setStoreHours, fromNet, fetchCatalogue, saved, setSaved, loadSaved, savedIds, persistSaved, toggleSaved, qtyOf, closedLabel, addProduct, decProduct, storeIds, shopLines, shopCount, shopTotal, cartCount, reqName, setReqName, reqQty, setReqQty, reqPrice, setReqPrice, addRequest, query, setQuery, chip, setChip, chipsOpen, setChipsOpen, aisle, setAisle, savedChip, setSavedChip, openListing, openProduct, inStock, closedShare, allClosed, someClosed, earliestOpen, hasShelf, dealShelf, topDeal, fromPrice, upTo, failKind, forcedFail, isLoading, isFailed, isEmpty, sampleSaved, savedResolved, savedGroup, savedCounts, savedChips, clean, forceDark } = useFoodV2();
  const { headerBtn, chipOnWhite, chipOnGreen, head, addControl, priceRow, productRow, productCard, miniTile, basketBar } = useFoodV2Ui();
  const { loadingCard, stateCard, stockingUp } = useFoodV2States();
  const sc = useFoodScale();
  const renderHome = () => {
    const showNote = (allClosed || someClosed) && !isLoading && !isFailed && !isEmpty;
    const heroH = 184;
    const bandH = (showNote ? 74 : 0) + 6 + Math.round(heroH * 0.6);
    const tiles = TILES.filter(t => hasShelf(t.key));
    const rows = tiles.length === 5 ? [tiles.slice(0, 3), tiles.slice(3)] : tiles.length === 4 ? [tiles.slice(0, 2), tiles.slice(2)] : tiles.length === 6 ? [tiles.slice(0, 3), tiles.slice(3)] : [tiles];
    const w3 = Math.floor((pageW - 32 - 20) / 3);
    const toyItems = shelfItems('Toys', catalogue);
    const toyTiles = TOY_TILES.map(t => ({ ...t, items: shelfItems(t.title, catalogue) })).filter(t => t.items.length > 0).slice(0, 3);
    const seeds = shelfItems('Seeds', catalogue);
    const oils = shelfItems('Edible Oils & Ghee', catalogue);
    const trio = [
      seeds.length ? { key: 'Seeds', label: 'Seeds', sub: fromPrice(seeds), img: seeds[0].image } : null,
      dealShelf.length ? { key: 'Deals', label: 'Best deals', sub: upTo(dealShelf) || fromPrice(dealShelf), img: dealShelf[0].image } : null,
      oils.length ? { key: 'Edible Oils & Ghee', label: 'Cooking oils & ghee', sub: fromPrice(oils), img: oils[0].image } : null,
    ].filter(Boolean) as { key: string; label: string; sub: string | null; img: string | null }[];
    const healthTiles = HEALTH_TILES.filter(h => hasShelf(h.name));
    const healthItems = healthTiles.flatMap(h => shelfItems(h.name, catalogue));
    const wellness = shelfItems('Monsoon Wellness Picks', catalogue);
    const aisles = ESSENTIAL_AISLES.filter(a => shelfItems(a, catalogue).length > 0);

    return (
      <ScrollView key={homeKey} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: shopCount > 0 ? sc.barSpace : 32 + sc.insets.bottom }} keyboardShouldPersistTaps="handled">
        <HomeHeader />
        {isLoading ? (
          <View style={{ backgroundColor: FOOD.header[1], paddingTop: 4 }}>
            <View style={[s.innerSurface, { backgroundColor: c.page }]}>{loadingCard(5)}</View>
          </View>
        ) : isFailed ? (
          <View style={{ padding: 16 }}>{stateCard(forcedFail || failKind, fetchCatalogue)}</View>
        ) : isEmpty ? (
          <View style={{ padding: 12 }}>{stockingUp()}</View>
        ) : (
          <>
            <HomeBandHero />
            <CategoryTiles />

            {/* ── Can't find something? ── */}
            <View style={s.sec}>
              {head("Can't find something?")}
              <PressScale style={[s.sendList, { backgroundColor: c.soft }]} onPress={() => push({ name: 'mega' })} accessibilityRole="button" accessibilityLabel="Send a list: type what you need and a shopper will buy it for you">
                <View style={[s.sendIcon, { backgroundColor: FOOD.primary }]}><Icon name="basket-outline" size={22} color="#FFFFFF" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.sendTitle, { color: c.title }]}>Send a list</Text>
                  <Text style={[s.sendText, { color: c.slate }]}>Type what you need and a shopper will buy it for you.</Text>
                </View>
                <Icon name="chevron-forward" size={18} color={c.slate} />
              </PressScale>
            </View>

            {/* ── Top deal ── */}
            {!!topDeal && (
              <View style={s.sec}>
                {head('Top deal', { onAll: () => openListing('Deals'), label: 'All deals' })}
                <View style={{ paddingHorizontal: 16 }}>{productRow(topDeal, { plate: 96 })}</View>
              </View>
            )}

            {/* ── Shop by brand ── */}
            {BRANDS.some(b => hasShelf(b.name)) && (
              <View style={s.sec}>
                {head('Shop by brand')}
                <ScrollView horizontal style={s.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={s.brandRail}>
                  {BRANDS.filter(b => hasShelf(b.name)).map(b => (
                    <PressScale key={b.name} onPress={() => openListing(b.name)} style={s.brand} accessibilityRole="button" accessibilityLabel={`Shop ${b.name}`}>
                      <View style={[s.brandCircle, { backgroundColor: c.card }, shadow]}><Image source={{ uri: b.img }} style={s.brandImg} resizeMode="cover" /></View>
                      <Text style={[s.brandName, { color: c.slate }]} numberOfLines={1}>{b.name}</Text>
                    </PressScale>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* ── Toys & sports ── */}
            {toyTiles.length > 0 && (
              <View style={s.sec}>
                {head('Toys & sports', { sub: upTo(toyItems) || fromPrice(toyItems), onAll: () => openListing('Toys') })}
                <View style={s.tileWrap}>{toyTiles.map(t => miniTile(t.title, sentence(t.title), null, t.img, () => openListing(t.title), w3))}</View>
              </View>
            )}

            {/* ── Seeds / Best deals / Cooking oils ── */}
            {trio.length > 0 && (
              <View style={[s.sec, s.tileWrap]}>
                {trio.map(t => miniTile(t.key, t.label, t.sub, t.img || FALLBACK_IMG, () => openListing(t.key), w3, true))}
              </View>
            )}

            {/* ── Better health ── */}
            {healthTiles.length > 0 && (
              <View style={s.sec}>
                {head('Better health', { sub: upTo(healthItems) || fromPrice(healthItems), onAll: () => openListing('Health') })}
                <ScrollView horizontal style={s.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tileRail}>
                  {healthTiles.map(h => { const first = shelfItems(h.name, catalogue).find(p => p.image); return miniTile(h.name, h.label, null, first?.image || h.img, () => openListing(h.name), w3, !!first); })}
                </ScrollView>
              </View>
            )}

            {/* ── Wellness picks (real products) ── */}
            {wellness.length > 0 && (
              <View style={s.sec}>
                {head('Wellness picks', { sub: fromPrice(wellness), onAll: () => openListing('Monsoon Wellness Picks') })}
                <ScrollView horizontal style={s.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tileRail}>
                  {wellness.slice(0, 8).map(p => miniTile(p.id, p.name, fmt(p.price), p.image || FALLBACK_IMG, () => openProduct(p), w3, true))}
                </ScrollView>
              </View>
            )}

            {/* ── Daily essentials, snacks and home needs ── */}
            {aisles.length > 0 && (
              <View style={s.sec}>
                {head('Daily essentials, snacks and home needs', { onAll: () => openListing('All Groceries') })}
                <PressScale style={s.banner} onPress={() => openListing('All Groceries')} accessibilityRole="button" accessibilityLabel="Daily essentials, snacks and home needs">
                  <Image source={{ uri: FOOD_IMG.essentials }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                </PressScale>
                <ScrollView horizontal style={s.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={[s.chipRail, { paddingTop: 12 }]}>
                  {aisles.map(a => chipOnWhite(a, chipLabel(a), false, () => openListing(a)))}
                </ScrollView>
              </View>
            )}
          </>
        )}
      </ScrollView>
    );
  };

  return renderHome();
}
