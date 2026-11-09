import React, { forwardRef, useState, useMemo, useEffect, useRef, useImperativeHandle } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from 'react-native';

// react-native-web turns role "button" into a real <button>. The stall cards' tap area and their Add buttons are
// siblings (components/StallCard), so nothing here nests a button in a button; the Home controls below keep the
// native-only role they always had. Native keeps the role for screen readers.
const BTN_ROLE = Platform.OS === 'web' ? undefined : ('button' as const);
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPE, surfaceLift } from '../constants/theme';
import { dietNow } from '../utils/themeNow';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../constants/api';
import { isLocalVendor } from '../utils/localVendor';
import { useSWRJson } from '../utils/swrCache';
import { useLiveSync } from '../utils/useLiveSync';
import { useCartActions } from '../context/CartContext';
import { productOptions } from './ProductOptions';
import { isCustomizable } from './CustomizeDrawer';
import CampusBitesAdWindow from './CampusBitesAdWindow';
import { StallCard, StallCardSkeleton, StallFilterChip, StallListMessage } from './StallCard';
import { liveOpenState, takesSlotOrders } from '../utils/storeOpenNow';

/**
 * CampusBites: food stalls near campus (Restaurant rows with vendorType LOCAL_VENDOR / LOCAL / STALL).
 * Everything here comes from the server: GET /api/restaurants/local-vendors (active stalls, real
 * open/closed state from their hours, today's hours, ratings from real order ratings, matched campus)
 * and GET /api/campus/campuses. The home list is only used for an instant first paint.
 * Stall orders are cash on delivery to the stall, and the stall delivers them itself.
 * Stalls are added only by the admin in the admin portal (no sign-up path in the customer app).
 * Two layouts (owner, 3 Nov 2026: the stalls in the Zomato / Swiggy listing style):
 *  - 'section' (Home): section header, the stall ad window (CampusBitesAdWindow), campus pills, search, the cards.
 *  - 'page' (the Local tab, app/(tabs)/local.tsx, which refreshes it through the ref): a big search bar and filter
 *    chips (Open now, Rated 4+, campuses), the page's banner, the ad window, a list heading with the live count,
 *    then the cards. While a search or filter is on, the banner and ad window step aside so the results sit right
 *    under the controls.
 * The cards themselves (photo-first, offer and status on the photo) are components/StallCard.
 */

interface CampusBitesSectionProps {
  /** Home store list (cached-first); stalls in it paint instantly until the stall list arrives. */
  restaurants: any[];
  /** True while the home list has nothing to show yet (first launch, no cache). */
  loading?: boolean;
  /** 'section' (default, Home) or 'page' (the Local tab). */
  variant?: 'section' | 'page';
  /** 'page' only: shown under the filter chips, above the stall list (the Local tab's In-Campus Booking banner). */
  banner?: React.ReactNode;
}

interface CampusItem { id: string; code: string; name: string }

const PREVIEW_DISHES = 3;
const norm = (x: any) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "13:30" -> "1:30 PM" */
const fmtTime = (hhmm: any): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
};

const parseHours = (v: any) => {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v && typeof v === 'object' ? v : null;
};

/** Today's hours: the server's text, else the stored start/end. null when the stall set no hours. */
const hoursText = (vendor: any): string | null => {
  if (typeof vendor.hoursToday === 'string' && vendor.hoursToday) return vendor.hoursToday;
  const h = parseHours(vendor.operatingHours);
  const start = fmtTime(h?.start);
  const end = fmtTime(h?.end);
  if (!start || !end) return null;
  return start === end ? 'Open 24 hours' : `${start} – ${end}`;
};

/**
 * Open / closed right now: the vendor's switches, then its hours in India time, re-checked on the
 * device clock (utils/storeOpenNow, same rules as the server) so a list fetched at 8:55 PM shows
 * "Closed" at 9:00 PM. The vendor's offline switch wins.
 */
const isVendorOpen = (vendor: any): boolean => liveOpenState(vendor).isOpen;

const closedLabel = (vendor: any): string => {
  const at = fmtTime(liveOpenState(vendor).opensAt);
  if (vendor.isOffline === true) return 'Not taking orders right now';
  return at ? `Closed · opens ${at}` : 'Closed now';
};

/** "21:00" -> "9 pm", "09:30" -> "9:30 am" (compact, for the card's facts row). */
const fmtShort = (hhmm: any): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]) % 24;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${m[2] === '00' ? hr : `${hr}:${m[2]}`} ${h >= 12 ? 'pm' : 'am'}`;
};

/** "10 am–9 pm" from the stored hours; the server's text when the stall uses weekly hours. */
const hoursShort = (vendor: any): string | null => {
  const h = parseHours(vendor.operatingHours);
  const start = fmtShort(h?.start);
  const end = fmtShort(h?.end);
  if (start && end) return start === end ? 'Open 24 hours' : `${start}–${end}`;
  return hoursText(vendor);
};

/**
 * Status line: "Open · closes 9:00 PM" / "Closed · opens 10:00 AM" (the server decides open / closed). A closed
 * stall that takes orders for its next delivery slot says when that order arrives: "Order for Today 4:30–5:30 PM".
 */
const statusLine = (vendor: any, open: boolean): string => {
  if (open) {
    const at = fmtTime(liveOpenState(vendor).closesAt);
    return at ? `Open · closes ${at}` : 'Open now';
  }
  if (takesSlotOrders(vendor) && vendor.nextSlotLabel) return `Order for ${vendor.nextSlotLabel}`;
  return closedLabel(vendor);
};

/** Extras sold with a dish ("Add-ons: Extra Garlic Sauce"): never what the stall is about. */
const ADD_ON_CATEGORY = /^(add[\s-]?ons?|extras?|dips?|sauces?)$/i;
const isAddOn = (m: any) => ADD_ON_CATEGORY.test(String(m?.category || '').trim());
/** Main dishes first, add-ons last (the server sorts categories A-Z, so "Add-ons" would lead). */
const mainsFirst = (items: any[]): any[] => [...items.filter((m) => !isAddOn(m)), ...items.filter(isAddOn)];

/** Up to two menu categories, in menu order: "Fresh Juices, Shakes" (add-on categories only when nothing else). */
const menuCategories = (vendor: any): string => {
  const seen: string[] = [];
  for (const m of mainsFirst(Array.isArray(vendor.menu) ? vendor.menu : [])) {
    const c = String(m?.category || '').trim();
    if (c && !seen.some((x) => x.toLowerCase() === c.toLowerCase())) seen.push(c);
    if (seen.length === 2) break;
  }
  return seen.join(', ');
};

/** The landmark part of the address: "Opposite SRM AP main gate, Neerukonda" -> "Opposite SRM AP main gate". */
const landmarkOf = (vendor: any): string => String(vendor.location || '').split(',')[0].trim();

/** Listed in the last 30 days and not rated yet. */
const NEW_FOR_MS = 30 * 24 * 3600 * 1000;
const isNewStall = (vendor: any): boolean => {
  if ((Number(vendor.ratingCount) || 0) > 0) return false;
  const at = Date.parse(vendor.publishedAt || vendor.createdAt || '');
  return Number.isFinite(at) && Date.now() - at < NEW_FOR_MS;
};

const idOf = (x: any) => String(x?._id || x?.id || '');
const availableMenu = (vendor: any): any[] => (Array.isArray(vendor.menu) ? vendor.menu : []).filter((m: any) => m && m.isAvailable !== false);

/** The real rating (from delivered-order ratings), or null while the stall has none. */
const ratingOf = (vendor: any): number | null => {
  const count = Number(vendor.ratingCount) || 0;
  const r = Number(vendor.rating);
  return count > 0 && Number.isFinite(r) && r > 0 ? r : null;
};

/** "from ₹40": the lowest price on sale now, main dishes only (an add-on at ₹10 is not what a meal costs). */
const fromPriceOf = (vendor: any): number | null => {
  const priced = availableMenu(vendor).filter((m) => Number(m.price) > 0);
  const mains = priced.filter((m) => !isAddOn(m));
  const pool = mains.length ? mains : priced;
  return pool.length ? Math.min(...pool.map((m) => Number(m.price))) : null;
};

/** In place of the price when nothing is on sale. */
const menuNoteOf = (vendor: any): string | null => {
  const all = (Array.isArray(vendor.menu) ? vendor.menu : []).filter(Boolean);
  if (!all.length) return 'Menu coming soon';
  return availableMenu(vendor).length ? null : 'Sold out right now';
};

/** "4 stalls · 3 open now" for the stalls on screen. */
const countLineOf = (shown: number, open: number): string | null => {
  if (shown <= 0) return null;
  if (shown === 1) return `1 stall · ${open ? 'open now' : 'closed now'}`;
  return `${shown} stalls · ${open === 0 ? 'all closed now' : `${open} open now`}`;
};

/** What the screen around the section can call: the Local tab's pull-to-refresh asks for the stalls again. */
export type CampusBitesSectionHandle = { refresh: () => Promise<void> };

const CampusBitesSection = forwardRef<CampusBitesSectionHandle, CampusBitesSectionProps>(function CampusBitesSection({ restaurants, loading: homeLoading = false, variant = 'section', banner }, ref) {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const isPage = variant === 'page';
  const [selectedCampus, setSelectedCampus] = useState('ALL');
  const [stallSearch, setStallSearch] = useState('');
  // Local tab filter chips (the Home section has none, so these stay off there).
  const [openOnly, setOpenOnly] = useState(false);
  const [rated4, setRated4] = useState(false);
  const { addToCart } = useCartActions();
  const [addedKey, setAddedKey] = useState<string | null>(null);
  // Re-check open / closed every minute (a stall closing at 9 PM flips without a refetch).
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const stallsSWR = useSWRJson<any[]>('/api/restaurants/local-vendors', { validate: Array.isArray });
  const campusSWR = useSWRJson<CampusItem[]>('/api/campus/campuses', { validate: Array.isArray, freshMs: 30 * 60 * 1000 });

  // Admin / vendor changed a store or a dish (hours, open switch, menu, stock): refetch silently.
  useLiveSync({ types: ['store', 'product'], onChange: () => { stallsSWR.refresh({ silent: true }); } });
  // The Local tab's pull-to-refresh: the stalls and the campus list again; resolves once both have answered.
  useImperativeHandle(ref, () => ({
    refresh: async () => { await Promise.all([stallsSWR.refresh({ silent: true }), campusSWR.refresh({ silent: true })]); },
  }), [stallsSWR.refresh, campusSWR.refresh]);
  // Home pull-to-refresh (new store list) refreshes the stalls too.
  const refreshRef = useRef(stallsSWR.refresh);
  refreshRef.current = stallsSWR.refresh;
  const firstProp = useRef(true);
  useEffect(() => {
    if (firstProp.current) { firstProp.current = false; return; }
    refreshRef.current({ silent: true });
  }, [restaurants]);

  const campuses = useMemo(() => (Array.isArray(campusSWR.data) ? campusSWR.data : []), [campusSWR.data]);
  const campusOf = useMemo(() => (vendor: any): CampusItem | null => {
    if (vendor.campusCode) return campuses.find((c) => c.code === vendor.campusCode) || { id: vendor.campusCode, code: vendor.campusCode, name: vendor.campusName || vendor.campusCode };
    const k = norm(vendor.campus);
    if (!k) return null;
    return campuses.find((c) => norm(c.code) === k || norm(c.name) === k)
      || (k.length >= 3 ? campuses.find((c) => norm(c.code).startsWith(k) || norm(c.name).startsWith(k)) : undefined)
      || null;
  }, [campuses]);

  const allVendors = useMemo(() => {
    const src = Array.isArray(stallsSWR.data) ? stallsSWR.data : (Array.isArray(restaurants) ? restaurants : []);
    return src.filter((r) => r && isLocalVendor(r) && r.isActive !== false);
  }, [stallsSWR.data, restaurants]);

  // Campus pills: only campuses from the real list that have at least one stall (shown when 2+ do).
  const campusPills = useMemo(() => {
    const codes = new Set(allVendors.map((v) => campusOf(v)?.code).filter(Boolean) as string[]);
    return campuses.filter((c) => codes.has(c.code));
  }, [allVendors, campuses, campusOf]);
  useEffect(() => {
    if (selectedCampus !== 'ALL' && !campusPills.some((c) => c.code === selectedCampus)) setSelectedCampus('ALL');
  }, [campusPills, selectedCampus]);
  // "Rated 4+" only while some stall has real ratings.
  const anyRated = useMemo(() => allVendors.some((v) => ratingOf(v) != null), [allVendors]);
  useEffect(() => { if (!anyRated && rated4) setRated4(false); }, [anyRated, rated4]);

  const q = stallSearch.trim().toLowerCase();
  const results = useMemo(() => {
    const matchDish = (m: any) => [m?.name, m?.category, m?.description].some((t) => String(t || '').toLowerCase().includes(q));
    return allVendors
      .filter((r) => selectedCampus === 'ALL' || campusOf(r)?.code === selectedCampus)
      .filter((r) => !openOnly || isVendorOpen(r))
      .filter((r) => !rated4 || (ratingOf(r) ?? 0) >= 4)
      .map((r) => {
        // Outside a search the card shows no dishes (tap it for the menu).
        if (!q) return { vendor: r, dishes: [] as any[], dishMatches: 0 };
        const stallHit = [r.name, r.stallDescription, r.description, r.location, campusOf(r)?.name, ...(Array.isArray(r.tags) ? r.tags : [])]
          .some((t) => String(t || '').toLowerCase().includes(q));
        const hits = availableMenu(r).filter(matchDish);
        if (!stallHit && !hits.length) return null;
        return { vendor: r, dishes: mainsFirst(hits).slice(0, PREVIEW_DISHES), dishMatches: hits.length };
      })
      .filter(Boolean)
      // Open stalls first (stable: the server's featured / rating order is kept inside each group).
      .map((x, i) => ({ x: x as { vendor: any; dishes: any[]; dishMatches: number }, i }))
      .sort((a, b) => (Number(isVendorOpen(b.x.vendor)) - Number(isVendorOpen(a.x.vendor))) || (a.i - b.i))
      .map(({ x }) => x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVendors, selectedCampus, q, campusOf, clockTick, openOnly, rated4]);

  /** ADD a stall dish straight to the basket (customisable dishes open their page first). */
  const addStallItem = (vendor: any, item: any, open: boolean) => {
    const itemId = idOf(item);
    const vendorId = idOf(vendor);
    if (!itemId || !vendorId) return;
    if (!open) {
      const opensAt = fmtTime(liveOpenState(vendor).opensAt);
      Alert.alert('Closed right now', (vendor.isOpen === false && vendor.closedReason)
        || `${vendor.name || 'This stall'} is closed now.${opensAt ? ` It opens at ${opensAt}.` : ' Try again when it opens.'}`);
      return;
    }
    if (item.isAvailable === false) {
      Alert.alert('Sold out', `${item.name} is sold out right now.`);
      return;
    }
    // Choices to make (customisable, or admin-set weights / portions): the product page asks for them.
    if (isCustomizable(item) || productOptions(item).length) {
      router.push(`/products/${itemId}` as any);
      return;
    }
    const added = addToCart({
      id: itemId,
      name: String(item.name || ''),
      price: Number(item.price) || 0,
      basePrice: Number(item.price) || 0,
      image: item.imageUrl || item.image || '',
      restaurantId: vendorId,
      restaurantName: String(vendor.name || ''),
      isStall: true,
    });
    if (added) {
      setAddedKey(itemId);
      setTimeout(() => setAddedKey((k) => (k === itemId ? null : k)), 900);
    }
  };

  const trackClick = (vendorId: string) => {
    fetch(`${API_URL}/api/restaurants/${vendorId}/click`, { method: 'POST' }).catch(() => {});
  };
  const openStall = (vendor: any) => {
    const id = idOf(vendor);
    if (!id) return;
    trackClick(id);
    try {
      const { playSound } = require('../utils/sounds');
      playSound(vendor.subscriptionTier === 'premium' ? 'premiumRestaurantTransition' : 'click');
    } catch { /* sound is optional */ }
    router.push(`/restaurant/${id}` as any);
  };

  const cardBg = isDark ? colors.card : '#FFF';
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? COLORS.borderDark : COLORS.borderLight;
  // Restrained palette: ONE accent (gold in dark, the app's primary accent in light) for actions only;
  // everything else neutral theme colours.
  const accent = dietNow().acc;

  // Nothing to show yet: skeleton while the first stall list (or the home list) is still loading.
  const waiting = allVendors.length === 0 && (stallsSWR.loading || (homeLoading && !stallsSWR.data));
  const noStallsYet = !waiting && allVendors.length === 0;
  const hasStalls = !waiting && allVendors.length > 0;
  // A search or filter is on (only meaningful while there are stalls to search: the controls hide without them).
  const filtering = hasStalls && (!!q || openOnly || rated4 || selectedCampus !== 'ALL');
  const clearFilters = () => { setStallSearch(''); setSelectedCampus('ALL'); setOpenOnly(false); setRated4(false); };
  // Ad window "see all stalls": clear the filters, optionally search, and bring the list into view.
  const listTopRef = useRef<View>(null);
  const showList = (searchFor?: string) => {
    setSelectedCampus('ALL');
    setOpenOnly(false);
    setRated4(false);
    setStallSearch(searchFor || '');
    if (Platform.OS === 'web') {
      setTimeout(() => {
        try { (listTopRef.current as any)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); } catch { /* optional */ }
      }, 50);
    }
  };
  const openCount = allVendors.filter(isVendorOpen).length;
  const countLine = countLineOf(results.length, results.filter((x) => isVendorOpen(x.vendor)).length);
  // Header chips: neutral surface, secondary text, muted icon.
  const pillStyle = isDark
    ? { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: COLORS.borderDark }
    : { backgroundColor: '#FFF', borderColor: 'transparent', ...surfaceLift(false, true) };

  const searchInput = (
    <TextInput
      style={[isPage ? s.bigSearchInput : s.searchInput, { color: txt }]}
      placeholder="Search stalls or dishes"
      placeholderTextColor={txtSec}
      value={stallSearch}
      onChangeText={setStallSearch}
      returnKeyType="search"
      autoCorrect={false}
      accessibilityLabel="Search local stalls and dishes"
    />
  );

  const stallCards = results.map(({ vendor, dishes, dishMatches }) => {
    const isOpen = isVendorOpen(vendor);
    // Closed right now but taking orders for its next delivery slot (server takesSlotOrders).
    const orderable = isOpen || takesSlotOrders(vendor);
    const campus = campusPills.length >= 2 ? campusOf(vendor) : null; // only when stalls span campuses
    const rating = ratingOf(vendor);
    const promo = typeof vendor.promoOffer === 'string' && vendor.promoOffer.trim() ? vendor.promoOffer.trim() : null;
    const status = statusLine(vendor, isOpen);
    const name = vendor.name || 'Local stall';
    return (
      <StallCard
        key={idOf(vendor)}
        name={name}
        photo={vendor.imageUrl || vendor.logoUrl || vendor.image || null}
        tag={vendor.subscriptionTier === 'premium' ? 'Featured' : isNewStall(vendor) ? 'New' : null}
        isOpen={isOpen}
        orderable={orderable}
        photoNote={isOpen ? promo : status}
        rating={rating}
        meta={[menuCategories(vendor), campus?.name, landmarkOf(vendor)].filter(Boolean).join(' · ')}
        hours={hoursShort(vendor)}
        fromPrice={fromPriceOf(vendor)}
        menuNote={menuNoteOf(vendor)}
        dishes={dishes}
        dishMatches={dishMatches}
        addedId={addedKey}
        accessibilityLabel={[name, status, rating != null ? `rated ${rating.toFixed(1)}` : null, isOpen ? promo : null].filter(Boolean).join(', ')}
        onPress={() => openStall(vendor)}
        onAdd={(m) => addStallItem(vendor, m, orderable)}
      />
    );
  });

  const body = waiting ? (
    <View accessibilityLabel="Loading local stalls">
      <StallCardSkeleton />
      <StallCardSkeleton />
    </View>
  ) : noStallsYet ? (
    stallsSWR.error && !stallsSWR.data ? (
      <StallListMessage
        inCard={!isPage}
        icon="cloud-offline-outline"
        title="Couldn't load the stalls"
        sub="Check your connection and try again."
        action="Try again"
        onAction={() => stallsSWR.refresh({ silent: false })}
      />
    ) : (
      // Two balanced lines (a free wrap left "join." alone on the second line of a 375 px phone).
      <StallListMessage inCard={!isPage} icon="storefront-outline" title="No stalls yet" sub={'Stalls around campus show here\nas soon as they join.'} />
    )
  ) : (<>
    {/* Home: campus filter (only when stalls span 2+ campuses) and the search, as before */}
    {!isPage && campusPills.length >= 2 && (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.campusScroll}>
        {[{ code: 'ALL', name: 'All campuses' }, ...campusPills].map((c) => {
          const isActive = selectedCampus === c.code;
          return (
            <TouchableOpacity
              key={c.code}
              style={[s.campusPill, { backgroundColor: cardBg, borderColor: isActive ? accent : border }]}
              onPress={() => setSelectedCampus(c.code)}
              accessibilityRole={BTN_ROLE}
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[s.campusLabel, { color: isActive ? accent : txtSec }]} numberOfLines={1}>
                {c.code === 'ALL' ? 'All' : c.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    )}
    {!isPage && <View ref={listTopRef} />}
    {!isPage && (
      <View style={[s.searchWrap, { backgroundColor: cardBg, borderColor: border }, surfaceLift(isDark, true)]}>
        <Ionicons name="search" size={16} color={txtSec} />
        {searchInput}
        {!!stallSearch && (
          <TouchableOpacity onPress={() => setStallSearch('')} accessibilityLabel="Clear search" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={txtSec} />
          </TouchableOpacity>
        )}
      </View>
    )}

    {results.length === 0 ? (
      <StallListMessage
        inCard={!isPage}
        icon="search-outline"
        title={q ? `No stall or dish matches "${stallSearch.trim()}"` : (openOnly || rated4) ? 'No stalls match these filters' : 'No stalls listed for this campus yet'}
        action={filtering ? 'Show all stalls' : undefined}
        onAction={clearFilters}
      />
    ) : stallCards}
  </>);

  if (isPage) {
    return (
      <View style={s.page}>
        {/* Search and filter chips: only with stalls to search */}
        {hasStalls && (
          <>
            <View style={[s.bigSearch, { backgroundColor: cardBg, borderColor: border }, surfaceLift(isDark, true)]}>
              <Ionicons name="search" size={19} color={accent} />
              {searchInput}
              {!!stallSearch && (
                <TouchableOpacity onPress={() => setStallSearch('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={19} color={txtSec} />
                </TouchableOpacity>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.chipScroll} contentContainerStyle={s.chipRow}>
              <StallFilterChip label="Open now" selected={openOnly} onPress={() => setOpenOnly((v) => !v)} />
              {anyRated && <StallFilterChip label="Rated 4+" selected={rated4} onPress={() => setRated4((v) => !v)} />}
              {campusPills.length >= 2 && (
                <>
                  <View style={[s.chipDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)' }]} />
                  {campusPills.map((c) => (
                    <StallFilterChip
                      key={c.code}
                      label={c.name}
                      selected={selectedCampus === c.code}
                      onPress={() => setSelectedCampus((cur) => (cur === c.code ? 'ALL' : c.code))}
                    />
                  ))}
                </>
              )}
            </ScrollView>
          </>
        )}

        {/* The page's banner and the stall promos; they step aside while a search or filter is on */}
        {!filtering && !!banner && <View style={s.bannerWrap}>{banner}</View>}
        {!filtering && hasStalls && (
          <View style={s.adWindowPage}>
            <CampusBitesAdWindow stalls={allVendors} isOpen={isVendorOpen} onOpenStall={openStall} onShowList={showList} accent={accent} />
          </View>
        )}

        {/* List heading: the live count and the stall rules, small and neutral */}
        <View ref={listTopRef} style={s.listHead}>
          <Text style={[s.listTitle, { color: txt }]} accessibilityRole="header">Stalls near campus</Text>
          {hasStalls && !!countLine && <Text style={[s.listCount, { color: txtSec }]}>{countLine}</Text>}
          {hasStalls && (
            <View style={s.factRow}>
              <View style={s.fact}>
                <Ionicons name="cash-outline" size={13} color={txtSec} />
                <Text style={[s.factText, { color: txtSec }]}>Cash only</Text>
              </View>
              <View style={s.fact}>
                <Ionicons name="time-outline" size={13} color={txtSec} />
                <Text style={[s.factText, { color: txtSec }]}>Delivered by the stall in about 30 min</Text>
              </View>
            </View>
          )}
        </View>

        {body}

        {hasStalls && <Text style={[s.disclaimer, { color: txtSec }]}>Coupons don't apply to stall orders.</Text>}
      </View>
    );
  }

  return (
    <View style={s.section}>
      {/* Header: one title in the Home section style, a short subtitle, the cash-only rule and the stall count */}
      <View style={s.header}>
        <View style={[s.headerIcon, isDark ? { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: COLORS.borderDark } : { backgroundColor: '#FFF', ...surfaceLift(false, true) }]}>
          <Ionicons name="storefront-outline" size={18} color={txt} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.titleRow}>
            <Text style={[s.sectionTitle, { color: txt }]} numberOfLines={1} accessibilityRole="header">Stalls near campus</Text>
          </View>
        </View>
      </View>
      {/* Full width under the title row and never clipped: it wraps (2 lines on a 360 px phone) */}
      <Text style={[s.sectionSub, { color: txtSec }]}>
        Food from stalls around campus, at your hostel gate in about 30 minutes. Pay the stall in cash.
      </Text>
      {/* Chips: full width under the subtitle, neutral with a muted icon */}
      <View style={s.pillRow}>
        <View style={[s.pill, pillStyle]}>
          <Ionicons name="cash-outline" size={12} color={txtSec} />
          <Text style={[s.pillText, { color: txtSec }]}>Cash only</Text>
        </View>
        <View style={[s.pill, pillStyle]}>
          <Ionicons name="time-outline" size={12} color={txtSec} />
          <Text style={[s.pillText, { color: txtSec }]}>30 min delivery</Text>
        </View>
        {allVendors.length > 0 && (
          <View style={[s.pill, pillStyle]} accessibilityLabel={`${allVendors.length} stalls, ${openCount} open now`}>
            <Ionicons name="storefront-outline" size={12} color={txtSec} />
            <Text style={[s.pillText, { color: txtSec }]}>{allVendors.length} {allVendors.length === 1 ? 'stall' : 'stalls'}</Text>
          </View>
        )}
      </View>

      {/* Ad window: stall promos, same carousel as the Home hero (it brings its own 16 px side padding). Only with real
          stalls: with none it was a "Coming soon" stock-photo carousel stacked on the empty card below. */}
      {hasStalls && (
        <View style={s.adWindow}>
          <CampusBitesAdWindow stalls={allVendors} isOpen={isVendorOpen} onOpenStall={openStall} onShowList={showList} accent={accent} />
        </View>
      )}

      {body}

      {/* Footer: the stall rule in one short line */}
      {hasStalls && (
        <Text style={[s.disclaimer, { color: txtSec }]}>Stall orders are cash only. Coupons don't apply.</Text>
      )}
    </View>
  );
});

export default CampusBitesSection;

// Web: no browser focus ring drawn inside the rounded search field (the caret shows focus), as in the Groceries search.
const WEB_NO_OUTLINE: any = Platform.OS === 'web' ? { outlineStyle: 'none' } : null;

const s = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 32, marginBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 0.1, marginRight: 2 },
  sectionSub: { alignSelf: 'stretch', flexShrink: 1, maxWidth: '100%', fontSize: 12, fontWeight: '500', letterSpacing: 0.2, marginTop: 8, marginBottom: 8, lineHeight: 17 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '500' },
  adWindow: { marginHorizontal: -16, marginBottom: 10 },

  campusScroll: { marginBottom: 12 },
  campusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, marginRight: 8, maxWidth: 200 },
  campusLabel: { ...TYPE.chip },

  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 44, borderRadius: 12, borderWidth: 1, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, ...TYPE.body, fontSize: 14, ...WEB_NO_OUTLINE },

  // Local tab ('page'): big search, chips, banner, list heading.
  page: { paddingHorizontal: 16, marginBottom: 28 },
  bigSearch: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  bigSearchInput: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '500', paddingVertical: 0, ...WEB_NO_OUTLINE },
  // Edge to edge so the chips scroll under the screen edge; the padding leaves room for the chips' shadow.
  chipScroll: { marginHorizontal: -16, marginBottom: 14 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 4 },
  chipDivider: { width: 1, height: 20, marginHorizontal: 2 },
  bannerWrap: { marginBottom: 22 },
  adWindowPage: { marginHorizontal: -16, marginBottom: 18 },
  listHead: { marginBottom: 14 },
  listTitle: { fontSize: 18, fontWeight: '700', letterSpacing: 0.1 },
  listCount: { fontSize: 13, fontWeight: '500', marginTop: 3 },
  factRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  factText: { fontSize: 12, fontWeight: '500' },

  disclaimer: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 4, lineHeight: 16 }
});
