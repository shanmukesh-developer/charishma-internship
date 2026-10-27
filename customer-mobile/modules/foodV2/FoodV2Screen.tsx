/**
 * Food & groceries v2: screen router. Provides the shared state, the dev screen switcher (hidden with ?clean=1) and the route switch.
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
import { useFoodV2, useFoodV2State, FoodV2Provider } from './useFoodV2';
import { useFoodV2Ui } from './FoodV2Ui';
import FoodV2Home from './FoodV2Home';
import FoodV2Listing from './FoodV2Listing';
import FoodV2Search from './FoodV2Search';
import FoodV2Saved from './FoodV2Saved';
import FoodV2MegaBasket from './FoodV2MegaBasket';
import FoodV2Categories from './FoodV2Categories';
import { AddedToast } from './FoodV2Motion';
import FoodV2SampleSheet from './FoodV2SampleSheet';

/** Others → Food & groceries. `sections` / `onSection` drive the section pills in the green header;
 * `openSearch` opens the store search (then `onSearchOpened` is called once).
 * Memoized: the 3,000-line Others screen re-renders on every keystroke / basket change of its own, and
 * each of those used to re-render the whole store (home shelves, rows, header) for nothing. */
function FoodV2Screen(props: { forceDark?: boolean; sections?: { key: string; label: string }[]; onSection?: (key: string) => void; openSearch?: boolean; onSearchOpened?: () => void }) {
  const ctx = useFoodV2State(props);
  return <FoodV2Provider value={ctx}><FoodV2Body /></FoodV2Provider>;
}
export default React.memo(FoodV2Screen);

function FoodV2Body() {
  const { toast, c, route, shopCount, isLoading, isFailed, isEmpty } = useFoodV2();
  const { basketBar } = useFoodV2Ui();
  return (
    <View style={[s.root, { backgroundColor: c.page }]}>
      {route.name === 'home' && (
        <View style={{ flex: 1 }}>
          <FoodV2Home />
          {shopCount > 0 && !isLoading && !isFailed && !isEmpty && basketBar()}
        </View>
      )}
      {route.name === 'listing' && (route.shelf === SEARCH ? <FoodV2Search /> : <FoodV2Listing shelf={route.shelf} />)}
      {route.name === 'saved' && <FoodV2Saved />}
      {route.name === 'mega' && <FoodV2MegaBasket />}
      {route.name === 'categories' && <FoodV2Categories />}
      <FoodV2Saved sheet />
      <FoodV2SampleSheet />
      <AddedToast stamp={toast.stamp} label={toast.label} bottom={shopCount > 0 ? 92 : 24} />
    </View>
  );
}
