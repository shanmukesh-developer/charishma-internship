/**
 * Food & groceries v2: saved items page (chips, two-column grid, empty state) and the saved items sheet.
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
import { Icon } from './FoodV2Icons';
import { BUTTON_ROLE } from '../../utils/pressRole';

export default function FoodV2Saved({ sheet = false }: { sheet?: boolean }) {
  const { router, isDark, m, topPad, winW, pageW, conn, cart, addToCart, updateQuantity, clearCart, mounted, c, shadow, greenGlow, stack, setStack, route, push, pop, homeKey, setHomeKey, reset, demo, setDemo, savedSheet, setSavedSheet, savedSample, setSavedSample, catalogue, setCatalogue, status, setStatus, storeHours, setStoreHours, fromNet, fetchCatalogue, saved, setSaved, loadSaved, savedIds, persistSaved, toggleSaved, qtyOf, closedLabel, addProduct, decProduct, storeIds, shopLines, shopCount, shopTotal, cartCount, addRequest, query, setQuery, chip, setChip, chipsOpen, setChipsOpen, aisle, setAisle, savedChip, setSavedChip, openListing, openProduct, inStock, closedShare, allClosed, someClosed, earliestOpen, hasShelf, dealShelf, topDeal, fromPrice, upTo, failKind, forcedFail, isLoading, isFailed, isEmpty, sampleSaved, savedResolved, savedGroup, savedCounts, savedChips, clean, forceDark } = useFoodV2();
  const { headerBtn, chipOnWhite, chipOnGreen, head, addControl, priceRow, productRow, productCard, miniTile, basketBar } = useFoodV2Ui();
  const { loadingCard, stateCard, stockingUp } = useFoodV2States();
  const savedEmpty = () => (
    // One soft surface only: the white sheet itself (no card inside it).
    <View style={[s.emptyCard, { paddingVertical: 36 }]}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="heart-outline" size={32} color={FOOD.primary} />
      </View>
      <Text style={[s.emptyTitle, { color: c.title }]}>No saved items yet</Text>
      <Text style={[s.emptyText, { color: c.slate }]}>Tap the heart icon on any product to save it here.</Text>
      <PressScale style={[s.emptyBtn, { backgroundColor: FOOD.primary }]} onPress={() => { setSavedSheet(false); reset({ name: 'home' }); }} accessibilityRole={BUTTON_ROLE}>
        <Text style={s.emptyBtnText}>Browse the campus store</Text>
      </PressScale>
    </View>
  );
  const savedFallback = (f: Saved, w?: number) => (
    <PressScale key={f.id} onPress={() => router.push(f.targetRoute as any)} style={[w ? s.card : s.row, { backgroundColor: c.card, width: w }, shadow]} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`${f.title}, ${f.price}. Open details`}>
      <View style={w ? [s.cardPlate, { backgroundColor: c.plate }] : [s.rowPlate, { width: 74, height: 74, backgroundColor: c.plate }]}>
        <Image source={{ uri: f.image || FALLBACK_IMG }} style={w ? s.cardImg : s.rowImg} resizeMode="contain" />
      </View>
      <View style={w ? undefined : s.rowBody}>
        <Text style={[w ? s.cardName : s.rowName, { color: c.name }]} numberOfLines={2}>{f.title}</Text>
        <Text style={[s.price, { color: c.price, marginTop: 4 }]}>{f.price}</Text>
      </View>
    </PressScale>
  );

  const renderSaved = () => {
    const shown = savedChip === 'All' ? savedResolved : savedResolved.filter(r => savedGroup(r) === savedChip);
    const w = Math.floor((pageW - 16 - 16 - 10) / 2);
    return (
      <View style={{ flex: 1, backgroundColor: FOOD.headerDeep[0] }}>
        <LinearGradient colors={FOOD.headerDeep} style={{ paddingTop: topPad }}>
          <View style={s.listHead}>
            <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Back" style={s.backBtn}>
              <Icon name="arrow-back" size={24} color="#FFFFFF" />
            </PressScale>
            <Text style={s.listTitle} accessibilityRole="header">Saved items</Text>
          </View>
          {savedResolved.length > 0 && (
            <ScrollView horizontal style={s.hScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRail}>
              {savedChips.map(g => chipOnGreen(g, g === 'All' ? 'All' : `${g} (${savedCounts[g]})`, savedChip === g, () => setSavedChip(g)))}
            </ScrollView>
          )}
          <View style={{ height: 10 }} />
        </LinearGradient>
        <View style={[s.inset, { backgroundColor: c.card }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 8, paddingBottom: 40 }}>
            {shown.length > 0 ? (
              <View style={s.grid}>
                {shown.map(({ f, p }, i) => <Enter key={f.id} index={i}>{p ? productCard(p, w) : savedFallback(f, w)}</Enter>)}
              </View>
            ) : savedEmpty()}
          </ScrollView>
        </View>
      </View>
    );
  };

  const savedSheetView = () => (
    <Modal visible={savedSheet} animationType="slide" transparent onRequestClose={() => setSavedSheet(false)}>
      <View style={s.sheetBackdrop}>
        <PressScale style={StyleSheet.absoluteFill} onPress={() => setSavedSheet(false)} accessibilityLabel="Close saved items" />
        <View style={[s.sheet, { backgroundColor: c.card }]}>
          <View style={s.sheetHead}>
            <Text style={[s.sheetTitle, { color: c.title }]} accessibilityRole="header">Saved items</Text>
            <PressScale onPress={() => setSavedSheet(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Close">
              <Icon name="close" size={24} color={c.slate} />
            </PressScale>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24, gap: 10 }} showsVerticalScrollIndicator={false}>
            {savedResolved.length ? savedResolved.map(({ f, p }) => (p
              ? productRow(p, { plate: 74, onOpen: () => { setSavedSheet(false); openProduct(p); } })
              : savedFallback(f))) : savedEmpty()}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
  return sheet ? savedSheetView() : renderSaved();
}
