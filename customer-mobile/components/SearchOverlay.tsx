import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDietary } from '../context/DietaryContext';
import { useDietLight } from './local/dietLightTheme';
import { dietNow, isDarkNow, mixHex, themedSheet } from '../utils/themeNow';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Dimensions, Platform } from 'react-native';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from './SafeImage';
import { useRouter } from 'expo-router';
import { COLORS, RADIUS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../constants/api';
import { useCart } from '../context/CartContext';
import { apiFetch } from '../utils/auth';
import { isLocalVendorType } from '../utils/localVendor';
import { isCustomizable } from './CustomizeDrawer';
import { productOptions } from './ProductOptions';
import SymbolIcon from './SymbolIcon';
import {
  buildQueryPlan, correctQuery, loadSearchCorpus, localityOf, matchesEveryWord, rankItems, rankStores, type QueryPlan,
} from '../utils/searchMatch';

// Grocery search runs against the DB catalogue (GET /api/catalogue/items?type=grocery&q=…)
const toGroceryResult = (it: any) => ({
  id: it.id || it._id || it.menuItemId,
  name: it.name,
  price: Number(it.price) || 0,
  originalPrice: Number(it.originalPrice) || null,
  weight: it.weight || null,
  image: it.image || it.imageUrl || null,
  discount: Number(it.discountPercent) > 0 ? `${Number(it.discountPercent)}% OFF` : null,
  restaurantId: it.storeId || it.restaurantId,
  restaurantName: it.storeName || 'Kirana & Late-Night Mart',
  orderable: it.orderable !== false && it.isAvailable !== false,
  // Weights / flavours (admin-set or automatic): Add opens the product to choose (components/ProductOptions).
  ...(Array.isArray(it.options) && it.options.length ? { options: it.options } : {}),
});

const { width: SW } = Dimensions.get('window');

const idOf = (x: any) => String(x?._id || x?.id || '');

/** One server search per spelling (utils/searchMatch), merged without duplicates. Throws only when every request failed. */
async function searchPhrases(phrases: string[], signal: AbortSignal): Promise<{ restaurants: any[]; items: any[] }> {
  const answers = await Promise.all(phrases.map(async (p) => {
    try {
      const res = await apiFetch(`${API_URL}/api/users/search?q=${encodeURIComponent(p)}`, { signal });
      if (!res.ok) return null;
      const data = await res.json();
      return { restaurants: Array.isArray(data?.restaurants) ? data.restaurants : [], items: Array.isArray(data?.items) ? data.items : [] };
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      return null;
    }
  }));
  if (answers.every((a) => a === null)) throw new Error('search failed');
  const seenR = new Set<string>();
  const seenI = new Set<string>();
  const restaurants: any[] = [];
  const items: any[] = [];
  for (const a of answers) {
    if (!a) continue;
    for (const r of a.restaurants) { const k = idOf(r); if (k && !seenR.has(k)) { seenR.add(k); restaurants.push(r); } }
    for (const it of a.items) { const k = idOf(it); if (k && !seenI.has(k)) { seenI.add(k); items.push(it); } }
  }
  return { restaurants, items };
}

/**
 * Food search that forgives spelling (QA 5 Nov 2026: "biriyani" found nothing): every common spelling first; when
 * that finds nothing, the closest real menu words; for several words, the longest word filtered by all of them.
 * Results are ranked name-first. When nothing is found, a "Did you mean" from the loaded menus.
 */
async function searchFoodTolerant(plan: QueryPlan, signal: AbortSignal, stale: () => boolean): Promise<{
  restaurants: any[]; items: any[]; correctedTo: string | null; didYouMean: string | null;
}> {
  const tried = new Set<string>(plan.phrases);
  const ranked = (found: { restaurants: any[]; items: any[] }, p: QueryPlan) => ({
    restaurants: rankStores(found.restaurants, p),
    items: rankItems(found.items, p),
  });
  const first = await searchPhrases(plan.phrases, signal);
  if (first.restaurants.length || first.items.length) return { ...ranked(first, plan), correctedTo: null, didYouMean: null };
  if (stale()) return { restaurants: [], items: [], correctedTo: null, didYouMean: null };

  const corpus = await loadSearchCorpus();
  if (stale()) return { restaurants: [], items: [], correctedTo: null, didYouMean: null };
  const fix = corpus ? correctQuery(plan, corpus, 'strict') : null;
  if (fix) {
    const fixedPlan = buildQueryPlan(fix.query);
    const phrases = fixedPlan.phrases.filter((p) => !tried.has(p));
    phrases.forEach((p) => tried.add(p));
    if (phrases.length) {
      const again = await searchPhrases(phrases, signal);
      if (again.restaurants.length || again.items.length) return { ...ranked(again, fixedPlan), correctedTo: fix.display, didYouMean: null };
    }
  }
  // Several words in another order ("biryani chicken"): search the longest one, keep dishes that have every word.
  const usePlan = fix ? buildQueryPlan(fix.query) : plan;
  if (usePlan.tokens.length > 1 && !stale()) {
    const longest = usePlan.tokens.reduce((a, b) => (b[0].length > a[0].length ? b : a));
    const phrases = longest.filter((p) => !tried.has(p));
    phrases.forEach((p) => tried.add(p));
    if (phrases.length) {
      const wide = await searchPhrases(phrases, signal);
      const items = wide.items.filter((it) => matchesEveryWord(it, usePlan));
      if (items.length) return { restaurants: [], items: rankItems(items, usePlan), correctedTo: fix ? fix.display : null, didYouMean: null };
    }
  }
  const loose = corpus ? correctQuery(plan, corpus, 'loose') : null;
  return { restaurants: [], items: [], correctedTo: null, didYouMean: loose && !tried.has(loose.query) ? loose.display : null };
}

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  searchMode?: 'food' | 'grocery';
}

// Veg mode in search (owner, 10 Nov 2026: "while searching non-veg is coming even though we enabled Veg"). Same rules
// as Home: a dish shows only if it is veg (its own veg / egg / non-veg label first); a restaurant shows while it has a
// veg dish, or, when the result carries no menu, unless its name / cuisine says it is a non-veg place.
const searchIsVegDish = (item: any): boolean => {
  const d = String(item?.dietType || '').toLowerCase().replace(/[^a-z]/g, '');
  if (d === 'veg') return true;
  if (d === 'egg' || d === 'nonveg' || d === 'nonvegetarian') return false;
  const veg = item?.isVegetarian === true || String(item?.isVegetarian).toLowerCase() === 'true' || Number(item?.isVegetarian) === 1 || item?.isVeg === true;
  return veg && !/eggs?/i.test(String(item?.name || ''));
};
const SEARCH_NONVEG_WORDS = /(chicken|mutton|meat|fish|seafood|prawns?|shawarma|kebab|beef|pork|non-?veg|egg)/i;
const searchRestaurantHasVeg = (r: any): boolean => {
  const menu = Array.isArray(r?.menu) ? r.menu : [];
  if (menu.length) return menu.some(searchIsVegDish);
  if (r?.isVeg === true || r?.isVegetarian === true) return true;
  return !SEARCH_NONVEG_WORDS.test(`${r?.name || ''} ${r?.cuisine || ''}`);
};

export default function SearchOverlay({ isOpen, onClose, searchMode = 'food' }: SearchOverlayProps) {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { cart, addToCart, updateQuantity } = useCart();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ restaurants: any[]; items: any[]; isTrending?: boolean }>({
    restaurants: [],
    items: [],
  });
  // What the screen shows: with Veg on (Home's Veg tab), food search hides non-veg dishes and non-veg-only places.
  // Groceries are not filtered.
  const { dietMode } = useDietary();
  // Owner, 10 Nov 2026: food search wears the diet accent (red Non-veg / green Veg), not the old amber / gold.
  const diet = useDietLight();
  const vegOn = searchMode === 'food' && (dietMode === 'veg' || dietMode === 'eggarian');
  const shown = useMemo(() => (vegOn
    ? { ...results, restaurants: results.restaurants.filter(searchRestaurantHasVeg), items: results.items.filter(searchIsVegDish) }
    : results), [results, vegOn]);
  const [searchError, setSearchError] = useState(false);
  // Bumped by the Retry button to re-run the same search.
  const [retryTick, setRetryTick] = useState(0);
  const requestIdRef = useRef(0);
  // Spelling help (food): the corrected words the results are for, a "Did you mean" for no results, and popular
  // searches from the loaded menus (utils/searchMatch).
  const [correctedTo, setCorrectedTo] = useState<string | null>(null);
  const [didYouMean, setDidYouMean] = useState<string | null>(null);
  const [popular, setPopular] = useState<string[]>([]);
  // Veg on: no "Chicken" / "Mutton" / "Egg" chips under "Popular searches".
  const popularShown = useMemo(() => (vegOn ? popular.filter((w) => !SEARCH_NONVEG_WORDS.test(w)) : popular), [popular, vegOn]);
  useEffect(() => {
    if (!isOpen || searchMode !== 'food') return;
    let alive = true;
    loadSearchCorpus().then((c) => { if (alive && c) setPopular(c.popular); }).catch(() => { /* no popular row */ });
    return () => { alive = false; };
  }, [isOpen, searchMode]);

  const inputRef = useRef<TextInput>(null);

  // "Try searching" ideas from real names only (3 Nov 2026: the fixed Ghee / Atta / Biryani / Burger lists mostly led
  // to "No results"): food takes them from the server's trending dishes (the empty search), groceries from the
  // catalogue, read once when the overlay opens. No ideas, no row.
  const shortName = (n: any) => String(n || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const uniqueNames = (list: any[]) => [...new Set(list.map((i) => shortName(i?.name)).filter((n) => n.length >= 3 && n.length <= 24))].slice(0, 6);
  const [foodIdeas, setFoodIdeas] = useState<string[]>([]);
  const [groceryIdeas, setGroceryIdeas] = useState<string[]>([]);
  useEffect(() => {
    if (results.isTrending && shown.items.length) setFoodIdeas(uniqueNames(shown.items));
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isOpen || searchMode !== 'grocery' || groceryIdeas.length) return;
    let alive = true;
    apiFetch(`${API_URL}/api/catalogue/items?type=grocery&limit=40`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setGroceryIdeas(uniqueNames(Array.isArray(data?.items) ? data.items : [])); })
      .catch(() => { /* no ideas: the row stays hidden */ });
    return () => { alive = false; };
  }, [isOpen, searchMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const ideas = searchMode === 'grocery' ? groceryIdeas : foodIdeas;

  // Debounced search fetch (stale responses are ignored; failures show a friendly message)
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();
    if (searchMode === 'grocery' && trimmed.length <= 1) {
      requestIdRef.current++;
      setSearchError(false);
      setLoading(false);
      setResults({ restaurants: [], items: [] });
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      setSearchError(false);
      // apiFetch skips its own timeout when a signal is passed, so cap a stalled request here.
      timeoutTimer = setTimeout(() => controller.abort(), 15000);
      try {
        if (searchMode === 'food') {
          const plan = buildQueryPlan(trimmed);
          if (plan.norm.length >= 2) {
            const found = await searchFoodTolerant(plan, controller.signal, () => requestId !== requestIdRef.current);
            if (requestId !== requestIdRef.current) return;
            setResults({ restaurants: found.restaurants, items: found.items });
            setCorrectedTo(found.correctedTo);
            setDidYouMean(found.didYouMean);
            return;
          }
        }
        const url = searchMode === 'grocery'
          ? `${API_URL}/api/catalogue/items?type=grocery&q=${encodeURIComponent(trimmed)}&limit=40`
          : `${API_URL}/api/users/search?q=${encodeURIComponent(query)}`;
        const res = await apiFetch(url, { signal: controller.signal });
        if (requestId !== requestIdRef.current) return;
        setCorrectedTo(null);
        setDidYouMean(null);
        if (!res.ok) {
          setResults({ restaurants: [], items: [] });
          setSearchError(true);
          return;
        }
        const data = await res.json();
        if (requestId !== requestIdRef.current) return;
        if (searchMode === 'grocery') {
          const items = (Array.isArray(data?.items) ? data.items : []).map(toGroceryResult).filter((i: any) => i.id && i.restaurantId);
          setResults({ restaurants: [], items });
        } else {
          setResults({
            restaurants: Array.isArray(data?.restaurants) ? data.restaurants : [],
            items: Array.isArray(data?.items) ? data.items : [],
            isTrending: !!data?.isTrending,
          });
        }
      } catch (err: any) {
        // A cleanup abort (query changed / overlay closed) bumps requestIdRef, so only a stale request
        // returns here; a timeout abort keeps the same id and is shown as an error with Retry.
        if (requestId !== requestIdRef.current) return;
        if (err?.name !== 'AbortError') console.error('[SEARCH_ERROR]', err);
        setCorrectedTo(null);
        setDidYouMean(null);
        setResults({ restaurants: [], items: [] });
        setSearchError(true);
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, searchMode === 'grocery' ? 250 : 300);

    return () => {
      clearTimeout(delayDebounceFn);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      requestIdRef.current++;
      controller.abort();
      setLoading(false);
    };
  }, [query, isOpen, searchMode, retryTick]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(t);
    } else {
      setQuery('');
      setResults({ restaurants: [], items: [] });
      setSearchError(false);
      setCorrectedTo(null);
      setDidYouMean(null);
    }
  }, [isOpen]);

  const handleSelectRestaurant = (id: string) => {
    const restaurant = results.restaurants.find(r => (r._id || r.id) === id);
    const isPremium = restaurant?.subscriptionTier === 'premium' || restaurant?.isFeatured;
    const { playSound } = require('../utils/sounds');
    playSound(isPremium ? 'premiumRestaurantTransition' : 'click');
    onClose();
    router.push(`/restaurant/${id}` as any);
  };

  // Dishes open their kitchen's menu (like Swiggy/Zomato); store products open the product page.
  const FOOD_VENDOR_TYPES = ['FOOD', 'RESTAURANT', 'CAFE', 'BAKERY', 'SWEETS', 'DESSERT', 'DESSERTS', 'DRINKS', 'MESS'];
  const handleSelectItem = (item: any) => {
    const { playSound } = require('../utils/sounds');
    playSound('click');
    onClose();
    const rest = item?.restaurantId && typeof item.restaurantId === 'object' ? item.restaurantId : null;
    const restId = rest?._id || rest?.id || (typeof item?.restaurantId === 'string' ? item.restaurantId : null);
    const vType = String(rest?.vendorType || '').toUpperCase();
    // Dishes (CampusBites stall dishes too) open their kitchen / stall page
    if (restId && (!vType || FOOD_VENDOR_TYPES.includes(vType) || isLocalVendorType(vType))) {
      router.push(`/restaurant/${restId}` as any);
      return;
    }
    router.push(`/products/${item._id || item.id}` as any);
  };

  /** CampusBites stall dish from the food search: ADD straight to the basket (the stall delivers, COD). */
  const stallOf = (item: any) => {
    const rest = item?.restaurantId && typeof item.restaurantId === 'object' ? item.restaurantId : null;
    if (!rest || !isLocalVendorType(rest.vendorType)) return null;
    const id = String(rest._id || rest.id || '');
    return id ? { id, name: String(rest.name || '') } : null;
  };
  const addStallDish = (item: any) => {
    const stall = stallOf(item);
    const itemId = String(item?._id || item?.id || '');
    if (!stall || !itemId) return;
    if (isCustomizable(item) || productOptions(item).length) {
      onClose();
      router.push(`/products/${itemId}` as any);
      return;
    }
    addToCart({
      id: itemId,
      name: String(item.name || ''),
      price: Number(item.price) || 0,
      basePrice: Number(item.price) || 0,
      image: item.imageUrl || item.image || '',
      restaurantId: stall.id,
      restaurantName: stall.name,
      isStall: true,
    });
  };

  const cardBg = isDark ? colors.card : '#FFF';
  const txtColor = isDark ? '#FFF' : COLORS.textDark;
  const txtMuted = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? COLORS.borderDark : COLORS.borderLight;
  // Same accent as the search field border and spinner.
  const accent = diet.acc;

  return (
    <Modal visible={isOpen} animationType="fade" transparent={false} onRequestClose={onClose}>
      <View style={[s.container, { backgroundColor: isDark ? colors.bg : COLORS.bgLight }]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={[s.closeBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F1F5F9' }]}>
            <SymbolIcon name="close" style={[s.closeText, { color: txtColor }]} />
          </TouchableOpacity>
          <View style={[s.inputWrap, { borderColor: searchMode === 'grocery' ? '#22C55E' : diet.acc, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8FAFC' }]}>
            <TextInput
              ref={inputRef}
              style={[s.input, { color: txtColor }]}
              placeholder={searchMode === 'grocery' ? "Search groceries & essentials..." : "Search food or restaurants..."}
              placeholderTextColor={txtMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
            {loading && <ActivityIndicator size="small" color={searchMode === 'grocery' ? '#22C55E' : diet.acc} style={s.spinner} />}
          </View>
        </View>

        {/* Results Area */}
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {/* City Pulse Trending Banner */}
          {results.isTrending && (
            <View style={[s.trendingBanner, { backgroundColor: diet.soft, borderLeftColor: diet.acc }]}>
              <Text style={[s.trendingTag, { color: diet.acc }]}>TOP PICKS</Text>
              <Text style={[s.trendingTitle, { color: isDark ? '#FFF' : '#1E293B' }]}>Campus spots & dishes to try 🍽️</Text>
            </View>
          )}

          {/* Empty state */}
          {shown.restaurants.length === 0 && shown.items.length === 0 && query.length > 1 && !loading && (
            <View style={s.emptyState}>
              <Text style={s.emptyText}>{searchError ? "Couldn't search right now. Check your connection and try again." : `No results found for "${query}" 😕`}</Text>
              {!searchError && searchMode === 'food' && !!didYouMean && (
                <TouchableOpacity
                  onPress={() => setQuery(didYouMean)}
                  accessibilityRole="button"
                  accessibilityLabel={`Did you mean ${didYouMean}? Search for ${didYouMean}`}
                  style={s.didYouMean}
                >
                  <Text style={[s.didYouMeanText, { color: txtMuted }]}>
                    Did you mean <Text style={{ color: accent, fontWeight: '900' }}>{didYouMean}</Text>?
                  </Text>
                </TouchableOpacity>
              )}
              {!searchError && searchMode === 'food' && popularShown.length > 0 && (
                <View style={s.popularWrap}>
                  <Text style={[s.sectionTitle, { textAlign: 'center', color: isDark ? '#A1A1AA' : '#334155' }]}>POPULAR SEARCHES</Text>
                  <View style={[s.tagsRow, { justifyContent: 'center' }]}>
                    {popularShown.map((tag) => (
                      <TouchableOpacity
                        key={tag}
                        style={[s.tagBtn, { backgroundColor: cardBg, borderColor: border }]}
                        onPress={() => setQuery(tag)}
                        accessibilityRole="button"
                        accessibilityLabel={`Search for ${tag}`}
                      >
                        <Text style={[s.tagText, { color: txtColor }]}>{tag}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
              {searchError && (
                <TouchableOpacity
                  onPress={() => setRetryTick((t) => t + 1)}
                  accessibilityRole="button"
                  style={{ marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: border }}
                >
                  <Text style={{ color: isDark ? '#FFF' : '#1E293B', fontWeight: '700' }}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Results for the corrected spelling (e.g. "biriyani" -> Biryani) */}
          {searchMode === 'food' && !!correctedTo && !loading && (shown.restaurants.length > 0 || shown.items.length > 0) && (
            <Text style={[s.correctedText, { color: txtMuted }]} accessibilityRole="text">
              Showing results for <Text style={{ color: accent, fontWeight: '900' }}>{correctedTo}</Text>
            </Text>
          )}

          {/* Restaurants section */}
          {shown.restaurants.length > 0 && (
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: isDark ? '#A1A1AA' : '#334155' }]}>RESTAURANTS</Text>
              <View style={s.gridContainer}>
                {shown.restaurants.map((res) => {
                  const img = res.imageUrl || res.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
                  return (
                    <TouchableOpacity
                      key={res._id || res.id}
                      style={[s.gridCard, { backgroundColor: cardBg, borderColor: border }]}
                      onPress={() => handleSelectRestaurant(res._id || res.id)}
                    >
                      <Image source={{ uri: img }} style={s.gridCardImg} />
                      <View style={s.gridCardInfo}>
                        <Text style={[s.gridCardName, { color: txtColor }]} numberOfLines={1}>{res.name}</Text>
                        <Text style={[s.gridCardMeta, { color: isDark ? COLORS.textSecondary : '#617088' }]} numberOfLines={1}>{Number(res.rating) > 0 ? `⭐ ${Number(res.rating).toFixed(1)}` : 'New'} • {localityOf(res.location) || 'Campus'}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Items / Dishes section */}
          {shown.items.length > 0 && (
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: isDark ? '#A1A1AA' : '#334155' }]}>{searchMode === 'grocery' ? 'GROCERY ITEMS' : 'DISHES'}</Text>
              <View style={s.gridContainer}>
                {shown.items.map((item) => {
                  const img = item.image || item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
                  
                  if (searchMode === 'grocery') {
                    const inCart = cart.find(i => i.id === item.id);
                    const quantity = inCart ? inCart.quantity : 0;
                    return (
                      <View
                        key={item.id}
                        style={[s.gridCard, { backgroundColor: cardBg, borderColor: border }]}
                      >
                        <View style={{ position: 'relative' }}>
                          <Image source={{ uri: img }} style={s.gridCardImg} />
                          {item.discount && (
                            <View style={s.discountBadge}>
                              <Text style={s.discountText}>{item.discount}</Text>
                            </View>
                          )}
                        </View>
                        <View style={s.gridCardInfo}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#666', marginBottom: 2 }}>{item.weight || ''}</Text>
                          <Text style={[s.gridCardName, { color: txtColor, height: 32 }]} numberOfLines={2}>
                            {item.name}
                          </Text>
                          
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                            <View>
                              <Text style={s.gridCardPrice}>₹{item.price}</Text>
                              {item.originalPrice > item.price && (
                                <Text style={{ fontSize: 12, color: '#999', textDecorationLine: 'line-through' }}>₹{item.originalPrice}</Text>
                              )}
                            </View>
                            
                            {/* ADD / Stepper */}
                            {quantity > 0 ? (
                              <View style={s.stepperWrap}>
                                <TouchableOpacity
                                  style={s.stepperBtn}
                                  onPress={() => {
                                    const cartKey = cart.find(i => i.id === item.id)?.cartKey || item.id;
                                    updateQuantity(cartKey, quantity - 1);
                                  }}
                                >
                                  <Text style={s.stepperBtnText}>-</Text>
                                </TouchableOpacity>
                                <Text style={[s.stepperQty, { color: txtColor }]}>{quantity}</Text>
                                <TouchableOpacity
                                  style={s.stepperBtn}
                                  onPress={() => {
                                    if (productOptions(item).length) { onClose(); router.push(`/products/${item.id}` as any); return; }
                                    addToCart({
                                      id: item.id,
                                      name: item.name,
                                      price: item.price,
                                      image: item.image,
                                      restaurantId: item.restaurantId,
                                      restaurantName: item.restaurantName,
                                      vendorType: item.vendorType || undefined,
                                      ...(searchMode === 'grocery' ? { basket: 'store' as const } : {}),
                                    });
                                  }}
                                >
                                  <SymbolIcon name="add" style={s.stepperBtnText} />
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <TouchableOpacity
                                style={[s.addBtn, !item.orderable && s.addBtnOff]}
                                disabled={!item.orderable}
                                onPress={() => {
                                  // Weights / flavours to choose: open the product page (a bare add was refused at checkout).
                                  if (productOptions(item).length) { onClose(); router.push(`/products/${item.id}` as any); return; }
                                  addToCart({
                                    id: item.id,
                                    name: item.name,
                                    price: item.price,
                                    image: item.image,
                                    restaurantId: item.restaurantId,
                                    restaurantName: item.restaurantName,
                                    vendorType: item.vendorType || undefined,
                                    ...(searchMode === 'grocery' ? { basket: 'store' as const } : {}),
                                  });
                                }}
                              >
                                <Text style={[s.addBtnText, !item.orderable && s.addBtnOffText]}>{item.orderable ? (productOptions(item).length ? 'CHOOSE' : 'ADD +') : 'SOLD OUT'}</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      </View>
                    );
                  }

                  return (
                    <TouchableOpacity
                      key={item._id || item.id}
                      style={[s.gridCard, { backgroundColor: cardBg, borderColor: border }]}
                      onPress={() => handleSelectItem(item)}
                    >
                      <Image source={{ uri: img }} style={s.gridCardImg} />
                      <View style={s.gridCardInfo}>
                        <Text style={[s.gridCardName, { color: txtColor }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                          <Text style={s.gridCardPrice}>₹{item.price}</Text>
                          <Text style={s.gridCardRestName} numberOfLines={1}>{item.restaurantId?.name || ''}</Text>
                        </View>
                        {!!stallOf(item) && (() => {
                          const itemId = String(item._id || item.id);
                          const stallQty = cart.reduce((a, c) => (String(c.id) === itemId ? a + c.quantity : a), 0);
                          const soldOut = item.isAvailable === false;
                          return (
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: '#F97316' }}>🏪 STALL · CASH</Text>
                              <TouchableOpacity
                                style={[s.addBtn, soldOut && s.addBtnOff]}
                                disabled={soldOut}
                                accessibilityLabel={`Add ${item.name} to your basket`}
                                onPress={() => addStallDish(item)}
                              >
                                <Text style={[s.addBtnText, soldOut && s.addBtnOffText]}>{soldOut ? 'SOLD OUT' : stallQty > 0 ? `ADD + (${stallQty})` : 'ADD +'}</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })()}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Search suggestions when query is empty: real names from today's menus / catalogue only */}
          {query.length <= 1 && ideas.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>TRY SEARCHING</Text>
              <View style={s.tagsRow}>
                {ideas.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[s.tagBtn, { backgroundColor: cardBg, borderColor: border }]}
                    onPress={() => setQuery(tag)}
                  >
                    <Text style={[s.tagText, { color: txtColor }]}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// One sheet per look (light/dark x Non-veg/Veg): the diet accent.
const s = themedSheet(() => ({
  container: {
    flex: 1,
    paddingTop: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '800',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 16,
    height: 48,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    height: '100%',
    borderWidth: 0,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      }
    } as any),
  } as any,
  spinner: {
    marginLeft: 8,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 80,
  },
  trendingBanner: {
    backgroundColor: dietNow().soft,
    borderLeftWidth: 4,
    borderLeftColor: dietNow().acc,
    padding: 14,
    borderRadius: 16,
    marginBottom: 20,
  },
  trendingTag: {
    fontSize: 12,
    fontWeight: '900',
    color: dietNow().acc,
    letterSpacing: 2,
  },
  trendingTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFF',
    marginTop: 2,
  },
  emptyState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.textSecondary,
    letterSpacing: 2,
    marginBottom: 12,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: (SW - 44) / 2,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 6,
  },
  gridCardImg: {
    width: '100%',
    aspectRatio: 4/3,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  gridCardInfo: {
    padding: 10,
  },
  gridCardName: {
    fontSize: 12,
    fontWeight: '800',
  },
  gridCardMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  gridCardPrice: {
    fontSize: 12,
    fontWeight: '900',
    color: dietNow().acc,
  },
  gridCardRestName: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    maxWidth: 70,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepperWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#22C55E', borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' },
  stepperBtn: { paddingHorizontal: 6, paddingVertical: 4, backgroundColor: '#DCFCE7' },
  stepperBtnText: { fontSize: 12, fontWeight: '900', color: '#22C55E' },
  stepperQty: { fontSize: 12, fontWeight: '900', paddingHorizontal: 6, textAlign: 'center', minWidth: 16 },
  // Enabled add buttons use the app-wide action colour (owner, 5 Nov 2026); sold out keeps its old look (addBtnOff).
  addBtn: { backgroundColor: isDarkNow() ? mixHex(dietNow().acc, '#000000', 0.3) : dietNow().acc, borderColor: isDarkNow() ? mixHex(dietNow().acc, '#000000', 0.3) : dietNow().acc, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  addBtnText: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  addBtnOff: { backgroundColor: '#fff', borderColor: '#22C55E', opacity: 0.5 },
  addBtnOffText: { color: '#22C55E' },
  didYouMean: { marginTop: 14, paddingHorizontal: 16, paddingVertical: 8 },
  didYouMeanText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  popularWrap: { marginTop: 20, alignSelf: 'stretch', alignItems: 'center' },
  correctedText: { fontSize: 12, fontWeight: '600', marginBottom: 12 },
  discountBadge: { position: 'absolute', bottom: 8, left: 8, backgroundColor: '#F59E0B', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  discountText: { fontSize: 12, fontWeight: '900', color: '#fff' },
}));
