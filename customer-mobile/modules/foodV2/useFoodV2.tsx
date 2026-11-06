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
import { productOptions, useAskOptions } from '../../components/ProductOptions';
import { apiFetch, readJson } from '../../utils/auth';
import { API_URL } from '../../constants/api';
import { fetchCatalogueType } from '../../utils/catalogueFetch';
import { readCache, writeCache, useCollegeEpoch, getCollegeEpoch } from '../../utils/swrCache';
import { useConnectionState } from '../../utils/offlineStatus';
import { useTopInset } from '../../utils/useTopInset';
import { takesSlotOrders } from '../../utils/storeOpenNow';
import { FOOD } from './foodV2Theme';
import { FOOD_IMG, StorefrontArt, WaveArt, LoadingDots } from './FoodV2Kit';
import { IonName, Item, SHOP_TYPES, CATALOGUE_CACHE_KEY, FALLBACK_IMG, MEGA_BASKET_VENDOR, WISHLIST_KEY, toItem, toList, etaText, groupIN, fmt, sentence, offLabel, fmtShortClock, squash, Shelf, SHELVES, shelfItems, SEARCH, SEARCH_HINTS, TILES, Hero, HEROES, LIST_TITLES, AISLES, aisleOf, SHORT_CHIP, chipLabel, FRESH_CATS, GROUP_ORDER, groupOf, BRANDS, TOY_TILES, HEALTH_TILES, ESSENTIAL_AISLES, HERO_BG, LHERO_BG, Route, DemoState, Saved } from './FoodV2Data';

const GREEN_GLOW = Platform.select<any>({
  web: { boxShadow: '0px 2px 8px rgba(7,132,63,0.28)' },
  default: { shadowColor: FOOD.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
});

/** Row actions with a fixed identity (they call the latest closures), so memoized rows never re-render for them. */
/** A store's hours from the catalogue (takesSlotOrders: closed now, but orders go to its next delivery slot). */
type StoreHours = {
  isOpen: boolean; opensAt: string | null; takesSlotOrders: boolean; nextSlotLabel: string | null;
  // The shop itself, for the category -> shops screen (FoodV2Shops).
  name?: string; imageUrl?: string | null; logoUrl?: string | null; rating?: number | null; vendorType?: string | null; deliveryTime?: string | null;
};
export type FoodV2RowActions = {addProduct: (p: Item) => void; decProduct: (id: string) => void; toggleSaved: (p: Item) => void; openProduct: (p: Item | string) => void };

export type FoodV2Ctx = ReturnType<typeof useFoodV2State>;
const Ctx = React.createContext<FoodV2Ctx | null>(null);
export const FoodV2Provider = Ctx.Provider;
export function useFoodV2(): FoodV2Ctx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFoodV2 outside FoodV2Provider');
  return v;
}

export function useFoodV2State({ forceDark, sections, onSection, openSearch, onSearchOpened }: { forceDark?: boolean; sections?: { key: string; label: string }[]; onSection?: (key: string) => void; openSearch?: boolean; onSearchOpened?: () => void }) {
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
  const askOptions = useAskOptions();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Colours and shadows keep one identity per theme, so memoized rows (FoodV2Ui ProductRow) can skip
  // re-rendering when nothing they show changed.
  const c = useMemo(() => ({
    page: FOOD.page[m], surface: FOOD.surface[m], card: FOOD.card[m], plate: FOOD.plate[m], title: FOOD.title[m],
    name: FOOD.name[m], price: FOOD.price[m], slate: FOOD.slate[m], was: FOOD.was[m], off: FOOD.off[m], line: FOOD.line[m],
    mint: FOOD.mint[m], mintInk: FOOD.mintInk[m], chip: FOOD.chip[m], side: FOOD.side[m], field: FOOD.field[m], soft: FOOD.soft[m],
    tile: isDark ? FOOD.card.dark : '#F7FBFA', link: isDark ? FOOD.off.dark : '#2F9A58',
  }), [m, isDark]);
  const shadow = useMemo(() => (isDark ? { borderWidth: 1, borderColor: FOOD.line.dark } : Platform.select<any>({
    web: { boxShadow: '0px 1px 2px rgba(16,40,30,0.05), 0px 4px 14px rgba(16,40,30,0.07)' },
    default: { shadowColor: '#0F2A1E', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 2 },
  })), [isDark]);
  const greenGlow = GREEN_GLOW;

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
  const [storeHours, setStoreHours] = useState<Record<string, StoreHours>>({});
  // The item list's `orderable` follows the store's own hours only; the store list also applies the
  // campus night window (9 pm – 6 am). A store the server lists as closed makes its items closed too,
  // so cards say "Opens 6 am" and block adding instead of "In stock" - unless the store takes orders for
  // its next delivery slot (server takesSlotOrders): then its items stay orderable, as on the store page.
  const catalogue = useMemo(() => rawCatalogue.map(p => {
    const st = storeHours[p.restaurantId];
    return p.orderable && st && !st.isOpen && !st.takesSlotOrders ? { ...p, orderable: false } : p;
  }), [rawCatalogue, storeHours]);
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
    const requestEpoch = getCollegeEpoch();
    try {
      // Store hours from every response are applied in ONE update with the items. Each response used to
      // set them on arrival: four extra full re-renders of the store, each rebuilding the catalogue.
      const hours: Record<string, StoreHours> = {};
      const settled = await Promise.allSettled(SHOP_TYPES.map(async t => {
        // Every page of the type (utils/catalogueFetch): past 200 products the rest used to be cut off.
        const data = await fetchCatalogueType(t);
        data.stores.forEach((st: any) => {
          const sid = String(st?.id || st?._id || '');
          if (sid) hours[sid] = {
            isOpen: st.isOpen !== false, opensAt: typeof st.opensAt === 'string' ? st.opensAt : null, takesSlotOrders: takesSlotOrders(st), nextSlotLabel: typeof st.nextSlotLabel === 'string' ? st.nextSlotLabel : null,
            name: typeof st.name === 'string' ? st.name : undefined, imageUrl: st.imageUrl || null, logoUrl: st.logoUrl || null,
            rating: Number(st.rating) > 0 ? Number(st.rating) : null, vendorType: st.vendorType || null, deliveryTime: etaText(st.deliveryTime),
          };
        });
        return data.items;
      }));
      if (mounted.current && Object.keys(hours).length) setStoreHours(prev => ({ ...prev, ...hours }));
      const ok = settled.filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled');
      if (!ok.length) throw new Error('catalogue unavailable');
      // Unmounted, or the student changed college meanwhile (the other college's stores).
      if (!mounted.current || requestEpoch !== getCollegeEpoch()) return;
      fromNet.current = true;
      const raw = ok.map(r => r.value).flat();
      setCatalogue(toList(raw));
      setStatus('ready');
      // This screen now owns the store catalogue cache (Others no longer downloads a second copy while
      // Food & groceries is open). Only a complete answer is cached, as before.
      if (ok.length === settled.length) writeCache(CATALOGUE_CACHE_KEY, raw);
    } catch {
      if (mounted.current) setStatus(prev => (prev === 'ready' ? prev : 'error'));
    }
  }, []);
  useEffect(() => { fetchCatalogue(); }, [fetchCatalogue]);
  // The student changed college (checkout): the shops and products of that college replace these.
  const collegeEpoch = useCollegeEpoch();
  const epochAtMount = useRef(collegeEpoch);
  useEffect(() => {
    if (collegeEpoch === epochAtMount.current) return;
    epochAtMount.current = collegeEpoch;
    fetchCatalogue();
  }, [collegeEpoch, fetchCatalogue]);

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
  /** Sample sheet (foodV2Demo.ts): the item a sample tap opened, or null. */
  const [sampleOpen, setSampleOpen] = useState<Item | null>(null);
  const toggleSaved = (p: Item) => {
    if (p.isDemoContent) return; // samples are never saved
    Haptics.selectionAsync().catch(() => {});
    if (savedIds.has(p.id)) persistSaved(saved.filter(f => f.id !== p.id));
    else persistSaved([{ id: p.id, title: p.name, subtitle: [p.storeName, p.weight].filter(Boolean).join(' • ') || 'Campus store', price: fmt(p.price), image: p.image || FALLBACK_IMG, targetRoute: `/products/${p.id}` }, ...saved]);
  };

  /** "Added to basket" toast (FoodV2Motion AddedToast). */
  const [toast, setToast] = useState({ stamp: 0, label: '' });
  // ── Basket (real CartContext rules: several shops per basket, one order each at checkout) ──
  const qtyOf = (id: string) => cart.filter(i => i.id === id).reduce((n, i) => n + i.quantity, 0);
  const closedLabel = (p: Item) => {
    if (p.orderable || !p.isAvailable) return null;
    const t = fmtShortClock(storeHours[p.restaurantId]?.opensAt);
    return t ? `Opens ${t}` : 'Closed now';
  };
  const addProduct = (p: Item) => {
    // Samples never reach the basket: a tap on one opens the sample sheet instead.
    if (p.isDemoContent) { setSampleOpen(p); return; }
    if (!p.orderable || !p.isAvailable) {
      const opens = closedLabel(p);
      Alert.alert(p.isAvailable ? `${p.storeName || 'This store'} is closed` : 'Sold out', p.isAvailable
        ? (opens ? `It ${opens.toLowerCase()}. You can browse now and add items once it opens.` : 'You can browse now and add items once it opens again.')
        : 'This item is out of stock right now. Please check back soon.');
      return;
    }
    const doAdd = async () => {
      // Admin-set choices (weights with their own prices, flavours, types): asked in the options sheet first.
      const groups = productOptions(p);
      let extra: { price?: number; basePrice?: number; customizations?: any } = {};
      if (groups.length) {
        const r = await askOptions({ name: p.name, price: p.price, image: p.image || null, groups, accent: FOOD.primary });
        if (!r) return;
        extra = { price: r.unitPrice, basePrice: p.price, customizations: r.customizations };
      }
      if (addToCart({ id: p.id, name: p.name, price: p.price, image: p.image || FALLBACK_IMG, restaurantId: p.restaurantId, restaurantName: p.storeName || 'Campus store', vendorType: p.vendorType || undefined, ...extra })) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        setToast({ stamp: Date.now(), label: p.name });
      }
    };
    // (Shopping-list lines are gone: the basket drops them on load, so nothing can block an add here.)
    doAdd();
  };
  const decProduct = (id: string) => {
    // A product with several choice lines (500 g, 1 kg...): the one added last loses one.
    const lines = cart.filter(i => i.id === id);
    const line = lines[lines.length - 1];
    if (line) updateQuantity(line.cartKey, line.quantity - 1);
  };
  const storeIds = useMemo(() => new Set(catalogue.map(i => i.restaurantId)), [catalogue]);
  const shopLines = cart; // the whole campus store basket (store items + shopping requests)
  const shopCount = shopLines.reduce((n, i) => n + i.quantity, 0);
  const shopTotal = shopLines.reduce((n, i) => n + i.price * i.quantity, 0);
  /** Header basket badge: items in all three baskets, the same number as the Basket tab badge. */
  const cartCount = totalItems;

  // ── Listing / search state ──
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('All');
  const [chipsOpen, setChipsOpen] = useState(false);
  const [aisle, setAisle] = useState('all');
  const [savedChip, setSavedChip] = useState('All');
  const openListing = (shelf: string, q = '') => { setQuery(q); setChip('All'); setChipsOpen(false); setAisle('all'); push({ name: 'listing', shelf }); };
  /** Category tile -> the shops that sell it (owner, 28 Oct 2026: category -> shop -> that shop's menu). */
  const openShops = (shelf: string) => push({ name: 'shops', shelf });
  /** Shops with products on `shelf` (plus shops of the shelf's own store types), open ones first. */
  const shopsFor = (shelf: string) => {
    const counts = new Map<string, number>();
    shelfItems(shelf, catalogue).forEach(p => { if (p.restaurantId) counts.set(p.restaurantId, (counts.get(p.restaurantId) || 0) + 1); });
    const types = SHELVES[shelf]?.vendorTypes || [];
    Object.entries(storeHours).forEach(([sid, st]) => { if (st.vendorType && types.includes(st.vendorType) && !counts.has(sid)) counts.set(sid, 0); });
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n, ...(storeHours[id] || { isOpen: true, opensAt: null, takesSlotOrders: false, nextSlotLabel: null }) }))
      .filter(x => !!x.name)
      .sort((a, b) => Number(b.isOpen || b.takesSlotOrders) - Number(a.isOpen || a.takesSlotOrders) || b.n - a.n || String(a.name).localeCompare(String(b.name)));
  };
  // Another Others section's header search ("Search the campus store") lands here on the search screen.
  useEffect(() => {
    if (!openSearch) return;
    openListing(SEARCH);
    onSearchOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSearch]);
  // Product pages use the app route (app/products/[id].tsx renders FoodV2ProductView for shop items).
  // A sample has no product page (and no server id): it opens the sample sheet.
  const openProduct = (p: Item | string) => {
    if (typeof p !== 'string' && p.isDemoContent) { setSampleOpen(p); return; }
    if (typeof p === 'string' && p.startsWith('sample-food-')) return;
    router.push(`/products/${typeof p === 'string' ? p : p.id}` as any);
  };

  // Stable row actions (see FoodV2RowActions): the closures above change every render, these never do.
  const live = useRef({ addProduct, decProduct, toggleSaved, openProduct });
  live.current = { addProduct, decProduct, toggleSaved, openProduct };
  const rowActions = useMemo<FoodV2RowActions>(() => ({
    addProduct: (p) => live.current.addProduct(p),
    decProduct: (id) => live.current.decProduct(id),
    toggleSaved: (p) => live.current.toggleSaved(p),
    openProduct: (p) => live.current.openProduct(p),
  }), []);

  // ── Derived home data ──
  const inStock = catalogue.filter(p => p.isAvailable);
  const closedShare = inStock.length ? inStock.filter(p => !p.orderable).length / inStock.length : 0;
  const allClosed = status === 'ready' && inStock.length > 0 && closedShare === 1;
  const someClosed = status === 'ready' && closedShare >= 0.3 && closedShare < 1;
  const earliestOpen = Object.values(storeHours).filter(s => !s.isOpen && !s.takesSlotOrders).map(s => s.opensAt).filter(Boolean).sort()[0] || null;
  const hasShelf = (name: string) => status !== 'ready' || shelfItems(name, catalogue).length > 0;
  const dealShelf = useMemo(() => shelfItems('Deals', catalogue), [catalogue]);
  const topDeal = dealShelf[0] || null;
  // Just the price (owner, 29 Oct 2026: "remove 'From' and keep only the rupees"): the lowest in the shelf.
  const fromPrice = (items: Item[]) => (items.length ? fmt(Math.min(...items.map(i => i.price))) : null);
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


  return { sections, onSection, toast, setToast, router, isDark, m, topPad, winW, pageW, conn, cart, addToCart, updateQuantity, clearCart, mounted, c, shadow, greenGlow, stack, setStack, route, push, pop, homeKey, setHomeKey, reset, demo, setDemo, savedSheet, setSavedSheet, savedSample, setSavedSample, catalogue, setCatalogue, status, setStatus, storeHours, setStoreHours, fromNet, fetchCatalogue, saved, setSaved, loadSaved, savedIds, persistSaved, toggleSaved, qtyOf, closedLabel, addProduct, decProduct, storeIds, shopLines, shopCount, shopTotal, cartCount, query, setQuery, chip, setChip, chipsOpen, setChipsOpen, aisle, setAisle, savedChip, setSavedChip, openListing, openShops, shopsFor, openProduct, inStock, closedShare, allClosed, someClosed, earliestOpen, hasShelf, dealShelf, topDeal, fromPrice, upTo, failKind, forcedFail, isLoading, isFailed, isEmpty, sampleSaved, savedResolved, savedGroup, savedCounts, savedChips, clean, forceDark, rowActions, sampleOpen, setSampleOpen };
}
