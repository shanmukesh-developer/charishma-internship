/**
 * Food & groceries v2: loading, offline / server starting / error and "stocking up" states.
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
import { FOOD_IMG, StorefrontArt, WaveArt, LoadingDots } from './FoodV2Kit';
import { IonName, Item, SHOP_TYPES, CATALOGUE_CACHE_KEY, FALLBACK_IMG, MEGA_BASKET_VENDOR, WISHLIST_KEY, toItem, toList, groupIN, fmt, sentence, offLabel, fmtShortClock, squash, Shelf, SHELVES, shelfItems, SEARCH, SEARCH_HINTS, TILES, Hero, HEROES, LIST_TITLES, AISLES, aisleOf, SHORT_CHIP, chipLabel, FRESH_CATS, GROUP_ORDER, groupOf, BRANDS, TOY_TILES, HEALTH_TILES, ESSENTIAL_AISLES, HERO_BG, LHERO_BG, Route, DemoState, Saved } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { PulseBlock } from './FoodV2Motion';
import { Icon } from './FoodV2Icons';
import { BUTTON_ROLE } from '../../utils/pressRole';

export function useFoodV2States() {
  const { router, isDark, m, topPad, winW, pageW, conn, cart, addToCart, updateQuantity, clearCart, mounted, c, shadow, greenGlow, stack, setStack, route, push, pop, homeKey, setHomeKey, reset, demo, setDemo, savedSheet, setSavedSheet, savedSample, setSavedSample, catalogue, setCatalogue, status, setStatus, storeHours, setStoreHours, fromNet, fetchCatalogue, saved, setSaved, loadSaved, savedIds, persistSaved, toggleSaved, qtyOf, closedLabel, addProduct, decProduct, storeIds, shopLines, shopCount, shopTotal, cartCount, query, setQuery, chip, setChip, chipsOpen, setChipsOpen, aisle, setAisle, savedChip, setSavedChip, openListing, openProduct, inStock, closedShare, allClosed, someClosed, earliestOpen, hasShelf, dealShelf, topDeal, fromPrice, upTo, failKind, forcedFail, isLoading, isFailed, isEmpty, sampleSaved, savedResolved, savedGroup, savedCounts, savedChips, clean, forceDark } = useFoodV2();
  const loadingCard = (rows = 4) => (
    <View style={[s.loadCard, { backgroundColor: c.card }]} accessible accessibilityLabel="Loading products" accessibilityState={{ busy: true }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[s.skRow, { borderColor: c.line, backgroundColor: isDark ? '#202024' : '#FBFCFC' }]}>
          <Sk width={68} height={68} borderRadius={10} />
          <View style={{ flex: 1, gap: 8 }}>
            <Sk width="88%" height={10} borderRadius={5} />
            <Sk width="60%" height={10} borderRadius={5} />
            <Sk width="38%" height={8} borderRadius={4} />
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignSelf: 'flex-end' }}>
            <Sk width={24} height={24} borderRadius={12} />
            <Sk width={24} height={24} borderRadius={12} />
          </View>
        </View>
      ))}
      <Text style={[s.loadText, { color: c.slate }]}>Loading products…</Text>
      <LoadingDots />
      <SlowLoadHint style={{ marginTop: 16, justifyContent: 'center' }} />
    </View>
  );

  /** Offline / server starting / error card (utils/offlineStatus decides which). */
  const stateCard = (kind: 'offline' | 'waking' | 'error', onRetry: () => void) => {
    const copy = kind === 'offline'
      ? { title: "You're offline", text: 'Check your internet connection and try again.' }
      : kind === 'waking'
        ? { title: 'Server is starting…', text: 'Please wait a moment. This takes a few seconds the first time.' }
        : { title: 'Something went wrong', text: "We couldn't load the products right now." };
    return (
      <View style={[s.stateCard, { backgroundColor: c.card }]} accessibilityRole="summary">
        {kind === 'offline' ? <Icon name="wifi-off" size={52} color={isDark ? '#A1A1AA' : '#3E5868'} />
          : kind === 'waking' ? <Icon name="server" size={50} color={isDark ? '#A1A1AA' : '#5E7180'} />
            : <Icon name="warning-outline" size={46} color="#E5484D" />}
        <Text style={[s.stateTitle, { color: c.title }]} accessibilityRole="header">{copy.title}</Text>
        <Text style={[s.stateText, { color: c.slate }]}>{copy.text}</Text>
        <PressScale style={[s.stateBtn, { backgroundColor: FOOD.cta }]} onPress={onRetry} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Retry">
          <Text style={s.stateBtnText}>Retry</Text>
        </PressScale>
      </View>
    );
  };

  const stockingUp = () => (
    <LinearGradient colors={['#04391F', '#021A10']} style={s.stock}>
      <StorefrontArt width={Math.min(220, pageW - 120)} />
      <Text style={s.stockTitle} accessibilityRole="header">The store is stocking up</Text>
      <Text style={s.stockText}>Nothing here yet. New products are added often.</Text>
    </LinearGradient>
  );

  return { loadingCard, stateCard, stockingUp };
}

/** Skeleton block: shimmer on phones; a still grey block on web (the JS shimmer does not repaint there). */
function Sk({ width, height, borderRadius }: { width: number | string; height: number; borderRadius: number }) {
  if (Platform.OS !== 'web') return <ShimmerLoader width={width} height={height} borderRadius={borderRadius} />;
  return <PulseBlock width={width} height={height} borderRadius={borderRadius} color="rgba(120,150,138,0.18)" />;
}
