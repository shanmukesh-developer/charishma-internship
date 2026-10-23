/**
 * Food & groceries v2: "Can't find something?" shopping request page (Mega Basket).
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
import { CUT } from './FoodV2Art';
import { Image as ExpoImage } from 'expo-image';
import { Icon } from './FoodV2Icons';

export default function FoodV2MegaBasket() {
  const { router, isDark, m, topPad, winW, pageW, conn, cart, addToCart, updateQuantity, clearCart, mounted, c, shadow, greenGlow, stack, setStack, route, push, pop, homeKey, setHomeKey, reset, demo, setDemo, savedSheet, setSavedSheet, savedSample, setSavedSample, catalogue, setCatalogue, status, setStatus, storeHours, setStoreHours, fromNet, fetchCatalogue, saved, setSaved, loadSaved, savedIds, persistSaved, toggleSaved, qtyOf, closedLabel, addProduct, decProduct, storeIds, shopLines, shopCount, shopTotal, cartCount, reqName, setReqName, reqQty, setReqQty, reqPrice, setReqPrice, addRequest, query, setQuery, chip, setChip, chipsOpen, setChipsOpen, aisle, setAisle, savedChip, setSavedChip, openListing, openProduct, inStock, closedShare, allClosed, someClosed, earliestOpen, hasShelf, dealShelf, topDeal, fromPrice, upTo, failKind, forcedFail, isLoading, isFailed, isEmpty, sampleSaved, savedResolved, savedGroup, savedCounts, savedChips, clean, forceDark } = useFoodV2();
  const { headerBtn, chipOnWhite, chipOnGreen, head, addControl, priceRow, productRow, productCard, miniTile, basketBar } = useFoodV2Ui();
  const { loadingCard, stateCard, stockingUp } = useFoodV2States();
  const renderMega = () => {
    const halfW = Math.floor((pageW - 40 - 10) / 2);
    return (
      <LinearGradient colors={['#03321E', '#021A10']} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: topPad + 4, paddingHorizontal: 20, paddingBottom: 28, flexGrow: 1 }}>
          <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Back" style={[s.backBtn, { marginLeft: -4, marginBottom: 6 }]}>
            <Icon name="arrow-back" size={24} color="#FFFFFF" />
          </PressScale>
          <Text style={s.megaTitle} accessibilityRole="header">Can't find something?</Text>
          <Text style={s.megaSub}>Type what you need and a shopper will buy it for you.</Text>
          <View style={[s.megaCard, { backgroundColor: isDark ? FOOD.card.dark : '#F2F7F5' }]}>
            <View style={[s.megaField, { backgroundColor: isDark ? FOOD.plate.dark : '#FFFFFF' }]}>
              <Icon name="search" size={19} color="#8A9BA6" />
              <TextInput style={[s.megaInput, { color: c.title }]} value={reqName} onChangeText={setReqName} placeholder="e.g. protein powder, study lamp…" placeholderTextColor="#8A9BA6" maxLength={60} accessibilityLabel="What should we buy" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[s.megaSmall, { color: c.title, backgroundColor: isDark ? FOOD.plate.dark : '#FFFFFF' }]} value={reqQty} onChangeText={t => setReqQty(t.replace(/[^0-9]/g, ''))} placeholder="Qty" placeholderTextColor="#8A9BA6" keyboardType="number-pad" maxLength={2} accessibilityLabel="Quantity, 1 to 20" />
              <TextInput style={[s.megaSmall, { flex: 2, color: c.title, backgroundColor: isDark ? FOOD.plate.dark : '#FFFFFF' }]} value={reqPrice} onChangeText={t => setReqPrice(t.replace(/[^0-9.]/g, ''))} placeholder="Est. price ₹ / unit" placeholderTextColor="#8A9BA6" keyboardType="decimal-pad" maxLength={7} accessibilityLabel="Estimated price per unit" />
            </View>
            <PressScale style={[s.megaBtn, { backgroundColor: FOOD.cta }]} onPress={addRequest} accessibilityRole="button" accessibilityLabel="Send list: add this request to your basket">
              <Text style={s.megaBtnText}>Send list</Text>
            </PressScale>
            <Text style={[s.megaHint, { color: c.slate }]}>You approve the real bill before paying (cash on delivery).</Text>
          </View>
          <Text style={s.megaPop}>Popular requests</Text>
          <View style={s.megaGrid}>
            {POPULAR_REQUESTS.map(r => (
              <PressScale key={r} style={[s.megaChip, { width: halfW, backgroundColor: isDark ? FOOD.card.dark : '#F4F8F6' }]} onPress={() => setReqName(r)} accessibilityRole="button" accessibilityLabel={`Request ${r}`}>
                <Icon name="chevron-forward" size={15} color={FOOD.primary} />
                <Text style={[s.megaChipText, { color: c.title }]} numberOfLines={1}>{r}</Text>
              </PressScale>
            ))}
          </View>
          <View style={{ flex: 1, minHeight: 20 }} />
          <View style={{ alignItems: 'center', marginTop: 16 }}>
            <ExpoImage source={CUT.hero} style={{ width: Math.min(230, pageW - 100), height: Math.round(Math.min(230, pageW - 100) * 0.96) }} contentFit="contain" accessibilityElementsHidden />
            <Text style={s.megaFoot}>We'll find it. You relax.</Text>
          </View>
        </ScrollView>
      </LinearGradient>
    );
  };
  return renderMega();
}
