import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from 'react-native';

// react-native-web turns role "button" into a real <button>; stall cards hold buttons (add, more),
// which nests <button>s on web only. Native keeps the role for screen readers.
const BTN_ROLE = Platform.OS === 'web' ? undefined : ('button' as const);
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from './SafeImage';
import ShimmerLoader from './ShimmerLoader';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPE, surfaceLift } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../constants/api';
import { isLocalVendor, vendorCallNumber, callVendor } from '../utils/localVendor';
import { useSWRJson } from '../utils/swrCache';
import { useLiveSync } from '../utils/useLiveSync';
import { useCartActions, useCartState } from '../context/CartContext';
import { isCustomizable } from './CustomizeDrawer';
import CampusBitesAdWindow from './CampusBitesAdWindow';
import { liveOpenState } from '../utils/storeOpenNow';

/**
 * CampusBites: food stalls near campus (Restaurant rows with vendorType LOCAL_VENDOR / LOCAL / STALL).
 * Everything here comes from the server: GET /api/restaurants/local-vendors (active stalls, real
 * open/closed state from their hours, today's hours, ratings from real order ratings, matched campus)
 * and GET /api/campus/campuses. The home list is only used for an instant first paint.
 * Stall orders are cash on delivery to the stall, and the stall delivers them itself.
 * Stalls are added only by the admin in the admin portal (no sign-up path in the customer app).
 * Layout: section header, the stall ad window (CampusBitesAdWindow), then the stall list.
 */

interface CampusBitesSectionProps {
  /** Home store list (cached-first); stalls in it paint instantly until the stall list arrives. */
  restaurants: any[];
  /** True while the home list has nothing to show yet (first launch, no cache). */
  loading?: boolean;
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

/** "21:00" -> "9 pm", "09:30" -> "9:30 am" (compact, for the card footer). */
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

/** Status line: "Open · closes 9:00 PM" / "Closed · opens 10:00 AM" (the server decides open / closed). */
const statusLine = (vendor: any, open: boolean): string => {
  if (open) {
    const at = fmtTime(liveOpenState(vendor).closesAt);
    return at ? `Open · closes ${at}` : 'Open now';
  }
  return closedLabel(vendor);
};

/** Up to two menu categories, in menu order: "Fresh Juices, Shakes". */
const menuCategories = (vendor: any): string => {
  const seen: string[] = [];
  for (const m of Array.isArray(vendor.menu) ? vendor.menu : []) {
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

/** Dish categories that are not food: no veg / non-veg mark. */
const NON_FOOD_CATEGORY = /stationery|xerox|print|toiletr|laundry|household|electronic/i;

const idOf = (x: any) => String(x?._id || x?.id || '');
const availableMenu = (vendor: any): any[] => (Array.isArray(vendor.menu) ? vendor.menu : []).filter((m: any) => m && m.isAvailable !== false);

/** The Add button's label: the only part of the section that re-renders when the basket changes. */
const StallAddLabel = React.memo(function StallAddLabel({ itemId, justAdded, color }: { itemId: string; justAdded: boolean; color: string }) {
  const { quantityOf } = useCartState();
  const inBasket = quantityOf(itemId);
  return (
    <Text style={[s.addBtnText, { color: justAdded ? '#FFF' : color }]}>
      {justAdded ? 'Added' : inBasket > 0 ? `Add · ${inBasket}` : 'Add'}
    </Text>
  );
});

export default function CampusBitesSection({ restaurants, loading: homeLoading = false }: CampusBitesSectionProps) {
  const router = useRouter();
  const { isDark } = useTheme();
  const [selectedCampus, setSelectedCampus] = useState('ALL');
  const [stallSearch, setStallSearch] = useState('');
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

  const q = stallSearch.trim().toLowerCase();
  const results = useMemo(() => {
    const matchDish = (m: any) => [m?.name, m?.category, m?.description].some((t) => String(t || '').toLowerCase().includes(q));
    return allVendors
      .filter((r) => selectedCampus === 'ALL' || campusOf(r)?.code === selectedCampus)
      .map((r) => {
        if (!q) return { vendor: r, dishes: availableMenu(r).slice(0, PREVIEW_DISHES), dishMatches: 0 };
        const stallHit = [r.name, r.stallDescription, r.description, r.location, campusOf(r)?.name, ...(Array.isArray(r.tags) ? r.tags : [])]
          .some((t) => String(t || '').toLowerCase().includes(q));
        const hits = availableMenu(r).filter(matchDish);
        if (!stallHit && !hits.length) return null;
        return { vendor: r, dishes: (hits.length ? hits : availableMenu(r)).slice(0, PREVIEW_DISHES), dishMatches: hits.length };
      })
      .filter(Boolean)
      // Open stalls first (stable: the server's featured / rating order is kept inside each group).
      .map((x, i) => ({ x: x as { vendor: any; dishes: any[]; dishMatches: number }, i }))
      .sort((a, b) => (Number(isVendorOpen(b.x.vendor)) - Number(isVendorOpen(a.x.vendor))) || (a.i - b.i))
      .map(({ x }) => x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVendors, selectedCampus, q, campusOf, clockTick]);

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
    if (isCustomizable(item)) {
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

  const cardBg = isDark ? COLORS.bgCard : '#FFF';
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? COLORS.borderDark : COLORS.borderLight;
  // Light: white card on the soft layered shadow (no outline). Dark: the dark card with its hairline.
  const cardLift = surfaceLift(isDark);
  // Restrained palette: ONE accent (gold in dark, the app's primary accent in light) for actions only;
  // muted green / red only for the open / closed text; everything else neutral theme colours.
  const accent = isDark ? COLORS.gold : COLORS.red;
  const openInk = isDark ? '#6FBF8B' : '#2F7D4F';
  const closedInk = isDark ? '#E08A84' : '#B4473F';
  const chipBg = isDark ? 'rgba(255,255,255,0.05)' : '#F4F4F5';

  // Nothing to show yet: skeleton while the first stall list (or the home list) is still loading.
  const waiting = allVendors.length === 0 && (stallsSWR.loading || (homeLoading && !stallsSWR.data));
  const noStallsYet = !waiting && allVendors.length === 0;
  // Ad window "see all stalls": clear the campus filter, optionally search, and bring the list into view.
  const listTopRef = useRef<View>(null);
  const showList = (searchFor?: string) => {
    setSelectedCampus('ALL');
    setStallSearch(searchFor || '');
    if (Platform.OS === 'web') {
      setTimeout(() => {
        try { (listTopRef.current as any)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); } catch { /* optional */ }
      }, 50);
    }
  };
  const openCount = allVendors.filter(isVendorOpen).length;
  // Header chips: neutral surface, secondary text, muted icon.
  const pillStyle = isDark
    ? { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: COLORS.borderDark }
    : { backgroundColor: '#FFF', borderColor: 'transparent', ...surfaceLift(false, true) };

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
        Food from stalls around campus, at your door in about 30 minutes. Pay the stall in cash.
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

      {/* Ad window: stall promos, same carousel as the Home hero (it brings its own 16 px side padding) */}
      {!waiting && (
        <View style={s.adWindow}>
          <CampusBitesAdWindow stalls={allVendors} isOpen={isVendorOpen} onOpenStall={openStall} onShowList={showList} accent={accent} />
        </View>
      )}

      {waiting ? (
        <View style={{ gap: 12 }} accessibilityLabel="Loading local stalls">
          {[0, 1].map((i) => (
            <View key={i} style={[s.card, { backgroundColor: cardBg, borderColor: border }, cardLift]}>
              <View style={s.cardTop}>
                <ShimmerLoader width={68} height={68} borderRadius={12} />
                <View style={{ flex: 1, gap: 8 }}>
                  <ShimmerLoader width="70%" height={14} borderRadius={6} />
                  <ShimmerLoader width="40%" height={10} borderRadius={5} />
                  <ShimmerLoader width="90%" height={10} borderRadius={5} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : noStallsYet ? (
        <View style={[s.emptyState, { backgroundColor: cardBg, borderColor: border }, cardLift]}>
          <Ionicons name="storefront-outline" size={28} color={txtSec} style={{ marginBottom: 8 }} />
          {stallsSWR.error && !stallsSWR.data ? (
            <>
              <Text style={[s.emptyText, { color: txt, marginBottom: 4 }]}>Couldn't load the stalls</Text>
              <Text style={[s.emptySub, { color: txtSec, marginBottom: 14 }]}>Check your connection and try again.</Text>
              <TouchableOpacity
                onPress={() => stallsSWR.refresh({ silent: false })}
                activeOpacity={0.85}
                accessibilityRole={BTN_ROLE}
                style={[s.ctaBtn, { borderColor: accent }]}
              >
                <Text style={[s.ctaText, { color: accent }]}>Try again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={[s.emptySub, { color: txtSec }]}>Campus stalls will appear here soon.</Text>
          )}
        </View>
      ) : (<>
      {/* Campus filter: from the real campus list, only when stalls span 2+ campuses */}
      {campusPills.length >= 2 && (
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

      {/* Search across stalls and their dishes */}
      <View ref={listTopRef} />
      <View style={[s.searchWrap, { backgroundColor: cardBg, borderColor: border }, surfaceLift(isDark, true)]}>
        <Ionicons name="search" size={16} color={txtSec} />
        <TextInput
          style={[s.searchInput, { color: txt }]}
          placeholder="Search stalls or dishes"
          placeholderTextColor={txtSec}
          value={stallSearch}
          onChangeText={setStallSearch}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search local stalls and dishes"
        />
        {!!stallSearch && (
          <TouchableOpacity onPress={() => setStallSearch('')} accessibilityLabel="Clear search" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={txtSec} />
          </TouchableOpacity>
        )}
      </View>

      {/* Stall cards */}
      {results.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: cardBg, borderColor: border }, cardLift]}>
          <Ionicons name="search-outline" size={26} color={txtSec} style={{ marginBottom: 8 }} />
          <Text style={[s.emptyText, { color: txt }]}>
            {q ? `No stall or dish matches "${stallSearch.trim()}"` : 'No stalls listed for this campus yet'}
          </Text>
          {(q || selectedCampus !== 'ALL') && (
            <TouchableOpacity onPress={() => { setStallSearch(''); setSelectedCampus('ALL'); }} style={{ marginTop: 10 }} accessibilityRole={BTN_ROLE}>
              <Text style={[s.linkText, { color: accent }]}>Show all stalls</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        results.map(({ vendor, dishes, dishMatches }) => {
          const vid = idOf(vendor);
          const isPremium = vendor.subscriptionTier === 'premium';
          const isOpen = isVendorOpen(vendor);
          const vendorImg = vendor.imageUrl || vendor.logoUrl || vendor.image || null;
          const campus = campusPills.length >= 2 ? campusOf(vendor) : null; // only when stalls span campuses
          const ratingCount = Number(vendor.ratingCount) || 0;
          const rating = Number(vendor.rating);
          const rated = ratingCount > 0 && Number.isFinite(rating) && rating > 0;
          const hours = hoursShort(vendor);
          const menuCount = availableMenu(vendor).length;
          const meta = [menuCategories(vendor), campus?.name, landmarkOf(vendor)].filter(Boolean).join(' · ');
          const footLeft = [
            q && dishMatches > 0 ? `${dishMatches} matching` : null,
            menuCount > 0 ? `${menuCount} ${menuCount === 1 ? 'item' : 'items'}` : null,
            hours,
          ].filter(Boolean).join(' · ');

          return (
            <TouchableOpacity
              key={vid}
              activeOpacity={0.92}
              style={[s.card, { backgroundColor: cardBg, borderColor: border }, cardLift]}
              onPress={() => openStall(vendor)}
              accessibilityRole={BTN_ROLE}
              accessibilityLabel={`${vendor.name || 'Local stall'}, ${statusLine(vendor, isOpen)}`}
            >
              {/* Top: photo, name, one meta line, status */}
              <View style={s.cardTop}>
                <View style={[s.photo, { borderColor: border }]}>
                  {vendorImg ? (
                    <Image source={{ uri: vendorImg }} style={s.photoImg} placeholderIcon="storefront-outline" />
                  ) : (
                    <View style={[s.photoImg, s.noImg, { backgroundColor: chipBg }]}>
                      <Ionicons name="storefront-outline" size={26} color={txtSec} />
                    </View>
                  )}
                </View>

                <View style={s.info}>
                  <View style={s.nameRow}>
                    <Text style={[s.nameText, { color: txt }]} numberOfLines={1}>{vendor.name || 'Local stall'}</Text>
                    {isPremium ? (
                      <View style={[s.tag, { backgroundColor: chipBg }]}>
                        <Text style={[s.tagText, { color: accent }]}>Featured</Text>
                      </View>
                    ) : isNewStall(vendor) ? (
                      <View style={[s.tag, { backgroundColor: chipBg }]}>
                        <Text style={[s.tagText, { color: txtSec }]}>New</Text>
                      </View>
                    ) : null}
                  </View>
                  {!!meta && <Text style={[s.metaText, { color: txtSec }]} numberOfLines={1}>{meta}</Text>}
                  <View style={s.statusRow}>
                    <Ionicons name="time-outline" size={13} color={isOpen ? openInk : closedInk} />
                    <Text style={[s.statusText, { color: isOpen ? openInk : closedInk }]} numberOfLines={1}>{statusLine(vendor, isOpen)}</Text>
                    {rated && (
                      <>
                        <Text style={[s.statusText, { color: txtSec }]}>·</Text>
                        <Ionicons name="star" size={11} color={txtSec} />
                        <Text style={[s.statusText, { color: txt }]}>{rating.toFixed(1)} ({ratingCount})</Text>
                      </>
                    )}
                  </View>
                  {!!vendor.promoOffer && (
                    <Text style={[s.offerText, { color: txt }]} numberOfLines={1}>{String(vendor.promoOffer)}</Text>
                  )}
                </View>
              </View>

              {/* Dishes: 2-3 popular (or matching) ones. Closed stall: dimmed, no buttons. */}
              {dishes.length > 0 ? (
                <View style={[s.dishList, { borderTopColor: border }, !isOpen && { opacity: 0.55 }]}>
                  {dishes.map((m: any) => {
                    const mId = idOf(m);
                    const justAdded = addedKey === mId;
                    // No veg mark on non-food products (stationery, toiletries...): they are stored as veg.
                    const diet = NON_FOOD_CATEGORY.test(String(m.category || '')) ? null
                      : m.dietType === 'nonveg' ? 'nonveg' : m.dietType === 'egg' ? 'egg' : (m.dietType === 'veg' || m.isVegetarian === true) ? 'veg' : null;
                    const dietColor = diet === 'nonveg' ? '#C0392B' : diet === 'egg' ? '#B7791F' : '#1E8E3E';
                    return (
                      <View key={mId} style={s.dishRow}>
                        {diet ? (
                          <View style={[s.dietBox, { borderColor: dietColor }]} accessibilityLabel={diet === 'nonveg' ? 'Non-veg' : diet === 'egg' ? 'Contains egg' : 'Veg'}>
                            <View style={[s.dietDot, { backgroundColor: dietColor }]} />
                          </View>
                        ) : <View style={s.dietSpacer} />}
                        <Text style={[s.dishName, { color: txt }]} numberOfLines={1}>{m.name}</Text>
                        <Text style={[s.dishPrice, { color: txt }]}>₹{Number(m.price) || 0}</Text>
                        {isOpen && (
                          <TouchableOpacity
                            style={[s.addBtn, { borderColor: accent }, justAdded && { backgroundColor: accent }]}
                            accessibilityLabel={`Add ${m.name} from ${vendor.name || 'the stall'} to your basket`}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                            onPress={() => addStallItem(vendor, m, isOpen)}
                          >
                            <StallAddLabel itemId={mId} justAdded={justAdded} color={accent} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={[s.emptyDishes, { color: txtSec }]}>
                  {menuCount === 0 ? 'Menu coming soon.' : 'Everything is sold out right now.'}
                </Text>
              )}

              {/* Footer: items and hours on the left, View menu on the right */}
              <View style={[s.footer, { borderTopColor: border }]}>
                <Text style={[s.footText, { color: txtSec }]} numberOfLines={1}>{footLeft}</Text>
                <View style={s.footActions}>
                  {!!vendorCallNumber(vendor) && (
                    <TouchableOpacity
                      style={[s.callBtn, { borderColor: border }]}
                      accessibilityLabel={`Call ${vendor.name || 'the stall'}`}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      onPress={() => { trackClick(vid); callVendor(vendor); }}
                    >
                      <Ionicons name="call-outline" size={15} color={txt} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={s.viewMenu}
                    accessibilityLabel={`See the full menu of ${vendor.name || 'the stall'}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                    onPress={() => openStall(vendor)}
                  >
                    <Text style={[s.viewMenuText, { color: accent }]}>View menu</Text>
                    <Ionicons name="chevron-forward" size={16} color={accent} />
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}
      </>)}

      {/* Footer: the stall rule in one short line */}
      {!noStallsYet && !waiting && (
        <Text style={[s.disclaimer, { color: txtSec }]}>Stall orders are cash only. Coupons don't apply.</Text>
      )}
    </View>
  );
}

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
  searchInput: { flex: 1, ...TYPE.body, fontSize: 14 },

  emptyState: { padding: 24, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...TYPE.heading, textAlign: 'center' },
  emptySub: { ...TYPE.body, textAlign: 'center' },
  linkText: { ...TYPE.label },
  ctaBtn: { paddingHorizontal: 16, height: 40, justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  ctaText: { ...TYPE.button },

  // Stall card: radius 16 like the Home restaurant cards, 16 px padding, 12 px gaps.
  card: { borderRadius: 16, borderWidth: 1, marginBottom: 12, padding: 16, overflow: 'hidden' },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 68, height: 68, borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  photoImg: { width: '100%', height: '100%' },
  noImg: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { flexShrink: 1, fontSize: 16, fontWeight: '600', letterSpacing: 0.1 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  metaText: { fontSize: 13, fontWeight: '400' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 12, fontWeight: '500' },
  offerText: { fontSize: 12, fontWeight: '500' },

  dishList: { marginTop: 12, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  dishRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  dietBox: { width: 12, height: 12, borderRadius: 2, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
  dietDot: { width: 5, height: 5, borderRadius: 3 },
  dietSpacer: { width: 12 },
  dishName: { flex: 1, fontSize: 14, fontWeight: '500' },
  dishPrice: { fontSize: 14, fontWeight: '600' },
  addBtn: { height: 32, minWidth: 64, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  emptyDishes: { ...TYPE.body, marginTop: 12 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  footText: { flex: 1, fontSize: 12, fontWeight: '400' },
  footActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  callBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  viewMenu: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewMenuText: { fontSize: 14, fontWeight: '600' },

  disclaimer: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 8, lineHeight: 16 }
});
