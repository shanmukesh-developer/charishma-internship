/**
 * Food & groceries v2: state (catalogue, saved items, basket rules, navigation) shared through context.
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

export type FoodV2Ctx = ReturnType<typeof useFoodV2State>;
const Ctx = React.createContext<FoodV2Ctx | null>(null);
export const FoodV2Provider = Ctx.Provider;
export function useFoodV2(): FoodV2Ctx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFoodV2 outside FoodV2Provider');
  return v;
}

export function useFoodV2State({ forceDark, sections, onSection }: { forceDark?: boolean; sections?: { key: string; label: string }[]; onSection?: (key: string) => void }) {
  const clean = true;
  const router = useRouter();
  const isDark = !!forceDark;
  const m = isDark ? 'dark' : 'light';
  const topPad = useTopInset(36, Platform.OS === 'web' ? 12 : 44);
  const { width: winW } = useWindowDimensions();
  const pageW = Math.min(winW, 600);
  const conn = useConnectionState();
  // Food & groceries is the campus store basket: it reads, adds to and clears only that basket.
  const { baskets, addToCart: addAnyBasket, updateQuantity, clearBasket, totalItems } = useCart();
  const cart = baskets.store;
  const addToCart: typeof addAnyBasket = (item) => addAnyBasket({ ...item, basket: 'store' });
  const clearCart = () => clearBasket('store');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const c = {
    page: FOOD.page[m], surface: FOOD.surface[m], card: FOOD.card[m], plate: FOOD.plate[m], title: FOOD.title[m],
    name: FOOD.name[m], price: FOOD.price[m], slate: FOOD.slate[m], was: FOOD.was[m], off: FOOD.off[m], line: FOOD.line[m],
    mint: FOOD.mint[m], mintInk: FOOD.mintInk[m], chip: FOOD.chip[m], side: FOOD.side[m], field: FOOD.field[m], soft: FOOD.soft[m],
    tile: isDark ? FOOD.card.dark : '#F7FBFA', link: isDark ? FOOD.off.dark : '#2F9A58',
  };
  const shadow = isDark ? { borderWidth: 1, borderColor: FOOD.line.dark } : Platform.select<any>({
    web: { boxShadow: '0px 1px 2px rgba(16,40,30,0.05), 0px 4px 14px rgba(16,40,30,0.07)' },
    default: { shadowColor: '#0F2A1E', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 2 },
  });
  const greenGlow = Platform.select<any>({
    web: { boxShadow: '0px 2px 8px rgba(7,132,63,0.28)' },
    default: { shadowColor: FOOD.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  });

  // ── Navigation (internal stack) and the dev strip's forced states ──
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];
  const push = (r: Route) => setStack(s => [...s, r]);
  const pop = () => setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
  const [homeKey, setHomeKey] = useState(0);
  const reset = (r: Route) => { setHomeKey(k => k + 1); setStack(r.name === 'home' ? [r] : [{ name: 'home' }, r]); };
  const [demo, setDemo] = useState<DemoState>(null);
  const [savedSheet, setSavedSheet] = useState(false);
  /** Dev strip only: show four catalogue items as if saved (nothing is written to the device). */
  const [savedSample, setSavedSample] = useState(false);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (savedSheet) { setSavedSheet(false); return true; }
      if (stack.length > 1) { pop(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, savedSheet]));

  // ── Catalogue ──
  const [rawCatalogue, setCatalogue] = useState<Item[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storeHours, setStoreHours] = useState<Record<string, { isOpen: boolean; opensAt: string | null }>>({});
  // The item list's `orderable` follows the store's own hours only; the store list also applies the
  // campus night window (9 pm – 6 am). A store the server lists as closed makes its items closed too,
  // so cards say "Opens 6 am" and block adding instead of "In stock".
  const catalogue = useMemo(() => rawCatalogue.map(p => (p.orderable && storeHours[p.restaurantId]?.isOpen === false ? { ...p, orderable: false } : p)), [rawCatalogue, storeHours]);
  const fromNet = useRef(false);
  useEffect(() => {
    readCache<any[]>(CATALOGUE_CACHE_KEY).then(cached => {
      if (!mounted.current || fromNet.current || !cached || !Array.isArray(cached.data)) return;
      setCatalogue(toList(cached.data));
      setStatus('ready');
    }).catch(() => {});
  }, []);
  const fetchCatalogue = useCallback(async () => {
    setStatus(prev => (prev === 'ready' ? prev : 'loading'));
    try {
      const settled = await Promise.allSettled(SHOP_TYPES.map(async t => {
        const res = await apiFetch(`${API_URL}/api/catalogue/items?type=${encodeURIComponent(t)}&limit=200`);
        if (!res.ok) throw new Error(`catalogue ${res.status}`);
        const data = await readJson(res);
        const hours: Record<string, { isOpen: boolean; opensAt: string | null }> = {};
        (Array.isArray(data?.stores) ? data.stores : []).forEach((st: any) => {
          const sid = String(st?.id || st?._id || '');
          if (sid) hours[sid] = { isOpen: st.isOpen !== false, opensAt: typeof st.opensAt === 'string' ? st.opensAt : null };
        });
        if (mounted.current && Object.keys(hours).length) setStoreHours(prev => ({ ...prev, ...hours }));
        return Array.isArray(data?.items) ? data.items : [];
      }));
      const ok = settled.filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled');
      if (!ok.length) throw new Error('catalogue unavailable');
      if (!mounted.current) return;
      fromNet.current = true;
      setCatalogue(toList(ok.map(r => r.value).flat()));
      setStatus('ready');
    } catch {
      if (mounted.current) setStatus(prev => (prev === 'ready' ? prev : 'error'));
    }
  }, []);
  useEffect(() => { fetchCatalogue(); }, [fetchCatalogue]);

  // ── Saved items (same device list as the app) ──
  const [saved, setSaved] = useState<Saved[]>([]);
  const loadSaved = useCallback(() => {
    AsyncStorage.getItem(WISHLIST_KEY).then(raw => {
      if (!mounted.current) return;
      try {
        const list = raw ? JSON.parse(raw) : [];
        setSaved(Array.isArray(list) ? list.filter((f: any) => f && typeof f === 'object' && f.id && f.title) : []);
      } catch { setSaved([]); }
    }).catch(() => {});
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved, route]);
  const savedIds = useMemo(() => new Set(saved.map(f => f.id)), [saved]);
  const persistSaved = (next: Saved[]) => { setSaved(next); AsyncStorage.setItem(WISHLIST_KEY, JSON.stringify(next)).catch(() => {}); };
  const toggleSaved = (p: Item) => {
    Haptics.selectionAsync().catch(() => {});
    if (savedIds.has(p.id)) persistSaved(saved.filter(f => f.id !== p.id));
    else persistSaved([{ id: p.id, title: p.name, subtitle: [p.storeName, p.weight].filter(Boolean).join(' • ') || 'Campus store', price: fmt(p.price), image: p.image || FALLBACK_IMG, targetRoute: `/products/${p.id}` }, ...saved]);
  };

  /** "Added to basket" toast (FoodV2Motion AddedToast). */
  const [toast, setToast] = useState({ stamp: 0, label: '' });
  // ── Basket (real CartContext rules: one store per basket, shopping requests apart) ──
  const qtyOf = (id: string) => cart.filter(i => i.id === id).reduce((n, i) => n + i.quantity, 0);
  const closedLabel = (p: Item) => {
    if (p.orderable || !p.isAvailable) return null;
    const t = fmtShortClock(storeHours[p.restaurantId]?.opensAt);
    return t ? `Opens ${t}` : 'Closed now';
  };
  const addProduct = (p: Item) => {
    if (!p.orderable || !p.isAvailable) {
      const opens = closedLabel(p);
      Alert.alert(p.isAvailable ? `${p.storeName || 'This store'} is closed` : 'Sold out', p.isAvailable
        ? (opens ? `It ${opens.toLowerCase()}. You can browse now and add items once it opens.` : 'You can browse now and add items once it opens again.')
        : 'This item is out of stock right now. Please check back soon.');
      return;
    }
    const doAdd = () => {
      if (addToCart({ id: p.id, name: p.name, price: p.price, image: p.image || FALLBACK_IMG, restaurantId: p.restaurantId, restaurantName: p.storeName || 'Campus store' })) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        setToast({ stamp: Date.now(), label: p.name });
      }
    };
    if (cart.some(i => isCustomRequest(i))) {
      Alert.alert('Start a new basket?', 'Your basket has a shopping request, which is ordered separately. Clear it and add this item?', [
        { text: 'Keep basket', style: 'cancel' },
        { text: 'Clear & add', style: 'destructive', onPress: () => { clearCart(); doAdd(); } },
      ]);
      return;
    }
    doAdd();
  };
  const decProduct = (id: string) => {
    const line = cart.find(i => i.id === id);
    if (line) updateQuantity(line.cartKey, line.quantity - 1);
  };
  const storeIds = useMemo(() => new Set(catalogue.map(i => i.restaurantId)), [catalogue]);
  const shopLines = cart; // the whole campus store basket (store items + shopping requests)
  const shopCount = shopLines.reduce((n, i) => n + i.quantity, 0);
  const shopTotal = shopLines.reduce((n, i) => n + i.price * i.quantity, 0);
  /** Header basket badge: items in all three baskets, the same number as the Basket tab badge. */
  const cartCount = totalItems;

  // ── Shopping list (Mega Basket, POST at checkout: same as the app). Several lines; price optional. ──
  type ReqLine = { key: string; name: string; qty: string; price: string };
  const newLine = (): ReqLine => ({ key: `l${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: '', qty: '1', price: '' });
  const [reqLines, setReqLines] = useState<ReqLine[]>(() => [newLine()]);
  const addReqLine = () => setReqLines(ls => (ls.length >= 15 ? ls : [...ls, newLine()]));
  const updateReqLine = (key: string, patch: Partial<ReqLine>) => setReqLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const removeReqLine = (key: string) => setReqLines(ls => (ls.length <= 1 ? [newLine()] : ls.filter(l => l.key !== key)));
  const setFirstReqName = (name: string) => setReqLines(ls => {
    const empty = ls.find(l => !l.name.trim());
    if (empty) return ls.map(l => (l.key === empty.key ? { ...l, name } : l));
    return ls.length >= 15 ? ls : [...ls, { ...newLine(), name }];
  });
  const addRequest = () => {
    const filled = reqLines.filter(l => l.name.trim());
    if (!filled.length) { Alert.alert('What should we buy?', 'Please type at least one item (and brand, if you have one in mind).'); return; }
    const bad = filled.find(l => l.price.trim() && !(Number(l.price) > 0 && Number(l.price) <= 10000));
    if (bad) { Alert.alert('Check the price', `The price for "${bad.name.trim()}" should be between ₹1 and ₹10,000, or leave it empty.`); return; }
    const doAdd = () => {
      const stamp = Date.now();
      filled.forEach((l, i) => {
        const price = l.price.trim() ? Math.round(Number(l.price) * 100) / 100 : 0;
        const qty = Math.min(20, Math.max(1, parseInt(l.qty, 10) || 1));
        addToCart({ id: `custom-${stamp}-${i}`, name: `[Custom Request] ${l.name.trim()}`, price, quantity: qty, image: '', restaurantId: MEGA_BASKET_VENDOR, restaurantName: 'Shopping list' } as any);
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(filled.length === 1 ? 'Request added' : 'List added', `${filled.length === 1 ? `"${filled[0].name.trim()}" is` : `${filled.length} items are`} in your basket. A shopper buys ${filled.length === 1 ? 'it' : 'them'} for you, and you approve the final bill before paying.`);
      setReqLines([newLine()]);
      pop();
    };
    if (cart.some(i => !isCustomRequest(i))) {
      Alert.alert('Start a new basket?', 'Shopping requests are ordered separately from store and restaurant items. Clear your basket and add this list?', [
        { text: 'Keep basket', style: 'cancel' },
        { text: 'Clear & add', style: 'destructive', onPress: () => { clearCart(); doAdd(); } },
      ]);
      return;
    }
    doAdd();
  };

  // ── Listing / search state ──
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('All');
  const [chipsOpen, setChipsOpen] = useState(false);
  const [aisle, setAisle] = useState('all');
  const [savedChip, setSavedChip] = useState('All');
  const openListing = (shelf: string, q = '') => { setQuery(q); setChip('All'); setChipsOpen(false); setAisle('all'); push({ name: 'listing', shelf }); };
  // Product pages use the app route (app/products/[id].tsx renders FoodV2ProductView for shop items).
  const openProduct = (p: Item | string) => router.push(`/products/${typeof p === 'string' ? p : p.id}` as any);

  // ── Derived home data ──
  const inStock = catalogue.filter(p => p.isAvailable);
  const closedShare = inStock.length ? inStock.filter(p => !p.orderable).length / inStock.length : 0;
  const allClosed = status === 'ready' && inStock.length > 0 && closedShare === 1;
  const someClosed = status === 'ready' && closedShare >= 0.3 && closedShare < 1;
  const earliestOpen = Object.values(storeHours).filter(s => !s.isOpen).map(s => s.opensAt).filter(Boolean).sort()[0] || null;
  const hasShelf = (name: string) => status !== 'ready' || shelfItems(name, catalogue).length > 0;
  const dealShelf = useMemo(() => shelfItems('Deals', catalogue), [catalogue]);
  const topDeal = dealShelf[0] || null;
  const fromPrice = (items: Item[]) => (items.length ? `From ${fmt(Math.min(...items.map(i => i.price)))}` : null);
  const upTo = (items: Item[]) => {
    const max = items.reduce((mx, i) => Math.max(mx, i.discountPercent || 0), 0);
    return max >= 10 ? `Up to ${max}% off` : null;
  };

  const failKind: 'offline' | 'waking' | 'error' = conn === 'offline' ? 'offline' : conn === 'waking' ? 'waking' : 'error';
  const forcedFail: 'offline' | 'waking' | 'error' | null = demo === 'offline' ? 'offline' : demo === 'waking' ? 'waking' : demo === 'error' ? 'error' : null;
  const isLoading = demo === 'loading' || (!demo && status === 'loading' && catalogue.length === 0);
  const isFailed = !!forcedFail || (!demo && status === 'error' && catalogue.length === 0);
  const isEmpty = demo === 'empty' || (!demo && status === 'ready' && catalogue.length === 0);

  const sampleSaved: Saved[] = savedSample
    ? catalogue.filter(p => p.image && p.discountPercent).slice(0, 4).map(p => ({ id: p.id, title: p.name, subtitle: p.storeName || 'Campus store', price: fmt(p.price), image: p.image || FALLBACK_IMG, targetRoute: `/products/${p.id}` }))
    : [];
  const savedResolved = (savedSample ? sampleSaved : saved).map(f => ({ f, p: catalogue.find(x => x.id === f.id) || null }));
  const savedGroup = (r: { p: Item | null }) => (r.p ? groupOf(r.p) : 'Other');
  const savedCounts: Record<string, number> = {};
  savedResolved.forEach(r => { const g = savedGroup(r); savedCounts[g] = (savedCounts[g] || 0) + 1; });
  const savedChips = ['All', ...GROUP_ORDER.filter(g => savedCounts[g]), ...(savedCounts.Other ? ['Other'] : [])];


  return { sections, onSection, toast, setToast, router, isDark, m, topPad, winW, pageW, conn, cart, addToCart, updateQuantity, clearCart, mounted, c, shadow, greenGlow, stack, setStack, route, push, pop, homeKey, setHomeKey, reset, demo, setDemo, savedSheet, setSavedSheet, savedSample, setSavedSample, catalogue, setCatalogue, status, setStatus, storeHours, setStoreHours, fromNet, fetchCatalogue, saved, setSaved, loadSaved, savedIds, persistSaved, toggleSaved, qtyOf, closedLabel, addProduct, decProduct, storeIds, shopLines, shopCount, shopTotal, cartCount, reqLines, addReqLine, updateReqLine, removeReqLine, setFirstReqName, addRequest, query, setQuery, chip, setChip, chipsOpen, setChipsOpen, aisle, setAisle, savedChip, setSavedChip, openListing, openProduct, inStock, closedShare, allClosed, someClosed, earliestOpen, hasShelf, dealShelf, topDeal, fromPrice, upTo, failKind, forcedFail, isLoading, isFailed, isEmpty, sampleSaved, savedResolved, savedGroup, savedCounts, savedChips, clean, forceDark };
}
