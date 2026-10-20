import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Linking, Alert } from 'react-native';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from './SafeImage';
import ShimmerLoader from './ShimmerLoader';
import { useRouter } from 'expo-router';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { API_URL, ZENVY_SUPPORT_WHATSAPP } from '../constants/api';
import { isLocalVendor, vendorCallNumber, callVendor, stallPayCopy } from '../utils/localVendor';
import { useSWRJson } from '../utils/swrCache';
import { useLiveSync } from '../utils/useLiveSync';
import { useCartActions, useCartState } from '../context/CartContext';
import { isCustomizable } from './CustomizeDrawer';

/**
 * CampusBites: food stalls near campus (Restaurant rows with vendorType LOCAL_VENDOR / LOCAL / STALL).
 * Everything here comes from the server: GET /api/restaurants/local-vendors (active stalls, real
 * open/closed state from their hours, today's hours, ratings from real order ratings, matched campus)
 * and GET /api/campus/campuses. The home list is only used for an instant first paint.
 * Stall orders are cash on delivery to the stall, and the stall delivers them itself.
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

/** The server decides open / closed (vendor switch + hours in IST); the vendor's offline switch wins. */
const isVendorOpen = (vendor: any): boolean => {
  if (vendor.isActive === false || vendor.isOffline === true) return false;
  return vendor.isOpen !== false;
};

const closedLabel = (vendor: any): string => {
  const at = fmtTime(vendor.opensAt);
  if (vendor.isOffline === true) return 'Not taking orders right now';
  return at ? `Closed · opens ${at}` : 'Closed now';
};

const idOf = (x: any) => String(x?._id || x?.id || '');
const availableMenu = (vendor: any): any[] => (Array.isArray(vendor.menu) ? vendor.menu : []).filter((m: any) => m && m.isAvailable !== false);

/** The ADD button's label: the only part of the section that re-renders when the basket changes. */
const StallAddLabel = React.memo(function StallAddLabel({ itemId, justAdded, isOpen }: { itemId: string; justAdded: boolean; isOpen: boolean }) {
  const { quantityOf } = useCartState();
  const inBasket = quantityOf(itemId);
  return (
    <Text style={[s.addBtnText, justAdded && { color: '#fff' }]}>
      {justAdded ? '✓ ADDED' : !isOpen ? 'CLOSED' : inBasket > 0 ? `ADD + (${inBasket})` : 'ADD +'}
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
      .filter(Boolean) as { vendor: any; dishes: any[]; dishMatches: number }[];
  }, [allVendors, selectedCampus, q, campusOf]);

  /** ADD a stall dish straight to the basket (customisable dishes open their page first). */
  const addStallItem = (vendor: any, item: any, open: boolean) => {
    const itemId = idOf(item);
    const vendorId = idOf(vendor);
    if (!itemId || !vendorId) return;
    if (!open) {
      Alert.alert('Closed right now', vendor.closedReason || `${vendor.name || 'This stall'} is not taking orders right now. Try again when it opens.`);
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

  // Nothing to show yet: skeleton while the first stall list (or the home list) is still loading.
  const waiting = allVendors.length === 0 && (stallsSWR.loading || (homeLoading && !stallsSWR.data));
  const noStallsYet = !waiting && allVendors.length === 0;
  const openListStall = () => {
    const msg = 'Hi Zenvy! I run a food stall near campus and would like to list it on CampusBites.';
    Linking.openURL(`https://wa.me/${ZENVY_SUPPORT_WHATSAPP}?text=${encodeURIComponent(msg)}`)
      .catch(() => Alert.alert('WhatsApp not available', `Message us on +${ZENVY_SUPPORT_WHATSAPP} to list your stall.`));
  };
  const openCount = allVendors.filter(isVendorOpen).length;

  return (
    <View style={s.section}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={s.badgeRow}>
          <View style={s.badgeIconWrap}><Text style={{ fontSize: 12 }}>🏪</Text></View>
          <Text style={s.badgeTag}>CAMPUSBITES</Text>
          {allVendors.length > 0 && (
            <Text style={[s.countTag, { color: txtSec }]}>
              {openCount} OF {allVendors.length} OPEN NOW
            </Text>
          )}
        </View>
        <Text style={[s.sectionTitle, { color: txt }]}>
          LOCAL <Text style={{ color: COLORS.gold }}>VENDOR STALLS</Text>
        </Text>
        <Text style={[s.sectionDesc, { color: txtSec }]}>
          FOOD STALLS NEAR YOUR CAMPUS. ORDER RIGHT HERE ON ZENVY — THE STALL DELIVERS IT TO YOU AND YOU PAY THEM IN CASH.
        </Text>
      </View>

      {waiting ? (
        <View style={{ gap: 12 }} accessibilityLabel="Loading local stalls">
          {[0, 1].map((i) => (
            <View key={i} style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
              <View style={s.cardBody}>
                <ShimmerLoader width={88} height={88} borderRadius={14} />
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
        <View style={[s.emptyState, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={{ fontSize: 32, marginBottom: 8 }}>🏪</Text>
          <Text style={[s.emptyText, { color: txt, marginBottom: 6 }]}>
            {stallsSWR.error && !stallsSWR.data ? "COULDN'T LOAD LOCAL STALLS" : 'NO LOCAL STALLS LISTED YET'}
          </Text>
          <Text style={{ color: txtSec, fontSize: 12, textAlign: 'center', marginBottom: 14 }}>
            {stallsSWR.error && !stallsSWR.data
              ? 'Check your connection and try again.'
              : 'Chai, tiffin and juice stalls near campus show up here once they join Zenvy.'}
          </Text>
          {stallsSWR.error && !stallsSWR.data ? (
            <TouchableOpacity
              onPress={() => stallsSWR.refresh({ silent: false })}
              activeOpacity={0.85}
              accessibilityRole="button"
              style={[s.ctaBtn, { backgroundColor: COLORS.gold }]}
            >
              <Text style={s.ctaText}>TRY AGAIN</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={openListStall}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="List your stall on CampusBites via WhatsApp"
              style={[s.ctaBtn, { backgroundColor: COLORS.gold }]}
            >
              <Text style={s.ctaText}>RUN A STALL? LIST IT FREE →</Text>
            </TouchableOpacity>
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
                style={[s.campusPill, { backgroundColor: isActive ? COLORS.gold : cardBg, borderColor: isActive ? COLORS.gold : border }]}
                onPress={() => setSelectedCampus(c.code)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[s.campusLabel, { color: isActive ? '#000' : txt }]} numberOfLines={1}>
                  {c.code === 'ALL' ? 'All' : c.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Search across stalls and their dishes */}
      <View style={[s.searchWrap, { backgroundColor: cardBg, borderColor: border }]}>
        <Text style={{ fontSize: 14, color: txtSec }}>🔍</Text>
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
            <Text style={{ fontSize: 13, color: txtSec, fontWeight: '900' }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Vendor Cards List */}
      {results.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={{ fontSize: 32, marginBottom: 8 }}>🔎</Text>
          <Text style={[s.emptyText, { color: txtSec }]}>
            {q ? `NO STALL OR DISH MATCHES “${stallSearch.trim().toUpperCase()}”` : 'NO STALLS LISTED FOR THIS CAMPUS YET'}
          </Text>
          {(q || selectedCampus !== 'ALL') && (
            <TouchableOpacity onPress={() => { setStallSearch(''); setSelectedCampus('ALL'); }} style={{ marginTop: 10 }} accessibilityRole="button">
              <Text style={{ color: COLORS.gold, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 }}>SHOW ALL STALLS</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        results.map(({ vendor, dishes, dishMatches }) => {
          const vid = idOf(vendor);
          const isPremium = vendor.subscriptionTier === 'premium';
          const isOpen = isVendorOpen(vendor);
          const vendorImg = vendor.imageUrl || vendor.logoUrl || vendor.image || null;
          const campus = campusOf(vendor);
          const ratingCount = Number(vendor.ratingCount) || 0;
          const rating = Number(vendor.rating);
          const hours = hoursText(vendor);
          const menuCount = availableMenu(vendor).length;
          const more = Math.max(0, (q ? dishMatches : menuCount) - dishes.length);

          return (
            <TouchableOpacity
              key={vid}
              activeOpacity={0.95}
              style={[
                s.card,
                { backgroundColor: cardBg, borderColor: isPremium ? COLORS.goldBorder : border },
                !isOpen && { opacity: 0.8 }
              ]}
              onPress={() => openStall(vendor)}
              accessibilityRole="button"
              accessibilityLabel={`${vendor.name || 'Local stall'}, ${isOpen ? 'open now' : closedLabel(vendor)}`}
            >
              {isPremium && (
                <View style={s.featuredBadge}>
                  <Text style={s.featuredText}>⭐ FEATURED</Text>
                </View>
              )}

              <View style={s.cardBody}>
                <View style={[s.imageWrap, { borderColor: border }]}>
                  {vendorImg ? (
                    <Image source={{ uri: vendorImg }} style={s.cardImg} placeholderIcon="storefront-outline" />
                  ) : (
                    <View style={[s.cardImg, s.noImg, { backgroundColor: isDark ? 'rgba(251,191,36,0.08)' : '#FFF7E6' }]}>
                      <Text style={s.noImgText}>{String(vendor.name || '?').trim().charAt(0).toUpperCase() || '🏪'}</Text>
                    </View>
                  )}
                  <View style={[s.statusChip, { backgroundColor: isOpen ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)' }]}>
                    <View style={s.statusDot} />
                    <Text style={s.statusText}>{isOpen ? 'OPEN' : 'CLOSED'}</Text>
                  </View>
                </View>

                <View style={s.info}>
                  <Text style={[s.nameText, { color: txt }]} numberOfLines={1}>{String(vendor.name || 'Local stall').toUpperCase()}</Text>

                  <View style={s.metaRow}>
                    {!!campus && <View style={s.campusTag}><Text style={s.campusTagText} numberOfLines={1}>{campus.code}</Text></View>}
                    <Text style={[s.ratingText, { color: txt }]}>
                      {ratingCount > 0 && Number.isFinite(rating) && rating > 0 ? `⭐ ${rating.toFixed(1)} (${ratingCount})` : '✨ NEW'}
                    </Text>
                  </View>

                  {!!(vendor.stallDescription || vendor.description) && (
                    <Text style={[s.descText, { color: txtSec }]} numberOfLines={2}>
                      {vendor.stallDescription || vendor.description}
                    </Text>
                  )}

                  <View style={s.chipRow}>
                    <View style={[s.chip, s.codChip]}><Text style={s.codText}>💵 CASH ON DELIVERY</Text></View>
                    <View style={[s.chip, s.deliverChip]}><Text style={s.deliverText}>🛵 STALL DELIVERS</Text></View>
                  </View>

                  {!!vendor.promoOffer && (
                    <View style={s.promoWrap}>
                      <Text style={s.promoText}>{String(vendor.promoOffer).toUpperCase()}</Text>
                    </View>
                  )}
                </View>
              </View>

              {!isOpen && (
                <Text style={[s.closedNote, { color: '#EF4444' }]} numberOfLines={2}>{closedLabel(vendor)}</Text>
              )}

              {/* Menu preview with quick ADD (search shows the matching dishes) */}
              {dishes.length > 0 && (
                <View style={s.dishList}>
                  {dishes.map((m: any) => {
                    const mId = idOf(m);
                    const justAdded = addedKey === mId;
                    return (
                      <View key={mId} style={[s.dishRow, { borderColor: border }]}>
                        <Text style={[s.dishName, { color: txt }]} numberOfLines={1}>
                          {m.dietType === 'veg' || m.isVegetarian === true ? '🟢 ' : m.dietType === 'nonveg' ? '🔴 ' : m.dietType === 'egg' ? '🟡 ' : ''}{m.name}
                        </Text>
                        <Text style={[s.dishPrice, { color: txt }]}>₹{Number(m.price) || 0}</Text>
                        <TouchableOpacity
                          style={[s.addBtn, !isOpen && { opacity: 0.5 }, justAdded && { backgroundColor: '#EF4F5F' }]}
                          accessibilityLabel={`Add ${m.name} from ${vendor.name || 'the stall'} to your basket`}
                          onPress={() => addStallItem(vendor, m, isOpen)}
                        >
                          <StallAddLabel itemId={mId} justAdded={justAdded} isOpen={isOpen} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  {more > 0 && (
                    <TouchableOpacity onPress={() => openStall(vendor)} accessibilityRole="button">
                      <Text style={[s.moreText, { color: COLORS.gold }]}>
                        {q ? `+${more} MORE MATCHING ${more === 1 ? 'DISH' : 'DISHES'} →` : `+${more} MORE ON THE MENU →`}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <Text style={[s.payNote, { color: txtSec }]}>💵 {stallPayCopy(vendor.name)}</Text>
                </View>
              )}
              {dishes.length === 0 && (
                <Text style={[s.payNote, { color: txtSec, marginTop: 10 }]}>
                  {menuCount === 0 ? 'Menu coming soon.' : 'Everything is sold out right now.'}
                </Text>
              )}

              {/* Bottom row: today's hours, menu size, call, order */}
              <View style={[s.bottomRow, { borderTopColor: border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 }}>
                  {!!hours && <Text style={[s.hoursText, { color: txtSec }]} numberOfLines={1}>🕐 {hours}</Text>}
                  {menuCount > 0 && <Text style={[s.hoursText, { color: txtSec }]}>📋 {menuCount} {menuCount === 1 ? 'item' : 'items'}</Text>}
                </View>

                <View style={s.actions}>
                  {!!vendorCallNumber(vendor) && (
                    <TouchableOpacity
                      style={[s.actionBtn, s.callBtn]}
                      accessibilityLabel={`Call ${vendor.name || 'the stall'}`}
                      onPress={() => {
                        trackClick(vid);
                        callVendor(vendor);
                      }}
                    >
                      <Text style={s.callText}>📞 CALL</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[s.actionBtn, s.orderBtn]}
                    accessibilityLabel={`See the full menu of ${vendor.name || 'the stall'}`}
                    onPress={() => openStall(vendor)}
                  >
                    <Text style={s.orderText}>VIEW MENU →</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}
      </>)}

      {/* Footer: how stall orders work + list-your-stall link */}
      <Text style={[s.disclaimer, { color: txtSec }]}>
        Stall orders are placed on Zenvy and delivered by the stall itself. Pay the stall in cash on delivery — no coupons or add-ons on stall orders.
      </Text>
      {!noStallsYet && !waiting && (
        <TouchableOpacity onPress={openListStall} accessibilityRole="button" accessibilityLabel="List your stall on CampusBites via WhatsApp" style={{ alignSelf: 'center', marginTop: 6 }}>
          <Text style={{ color: COLORS.gold, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 }}>RUN A STALL? LIST IT FREE →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 32, marginBottom: 28 },
  headerRow: { marginBottom: 12 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  badgeIconWrap: { width: 22, height: 22, borderRadius: 6, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  badgeTag: { fontSize: 12, fontWeight: '900', color: COLORS.gold, letterSpacing: 2 },
  countTag: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginLeft: 'auto' },
  sectionTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5, fontStyle: 'italic' },
  sectionDesc: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 4, lineHeight: 12 },

  campusScroll: { marginBottom: 12 },
  campusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, marginRight: 8, maxWidth: 200 },
  campusLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },

  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 42, borderRadius: 12, borderWidth: 1, gap: 8, marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 12, fontWeight: '600' },

  emptyState: { padding: 28, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5, textAlign: 'center' },
  ctaBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12 },
  ctaText: { color: '#000', fontWeight: '900', fontSize: 12, letterSpacing: 0.6 },

  card: { borderRadius: 20, borderWidth: 1, marginBottom: 14, overflow: 'hidden', padding: 14, position: 'relative', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  featuredBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: COLORS.gold, paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 10, zIndex: 2 },
  featuredText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 1 },

  cardBody: { flexDirection: 'row', gap: 12 },
  imageWrap: { width: 88, height: 88, borderRadius: 14, overflow: 'hidden', borderWidth: 1, position: 'relative' },
  cardImg: { width: '100%', height: '100%' },
  noImg: { alignItems: 'center', justifyContent: 'center' },
  noImgText: { fontSize: 34, fontWeight: '900', color: COLORS.gold },
  statusChip: { position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  statusDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFF' },
  statusText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 1 },

  info: { flex: 1 },
  nameText: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3, paddingRight: 56 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  campusTag: { backgroundColor: 'rgba(251,146,60,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, maxWidth: 110 },
  campusTagText: { color: '#FB923C', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  ratingText: { fontSize: 12, fontWeight: '700' },
  descText: { fontSize: 12, fontWeight: '600', marginTop: 6, lineHeight: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  codChip: { backgroundColor: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.25)' },
  codText: { color: '#059669', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  deliverChip: { backgroundColor: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)' },
  deliverText: { color: '#2563EB', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  promoWrap: { alignSelf: 'flex-start', backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 6 },
  promoText: { color: '#FBBF24', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  closedNote: { fontSize: 12, fontWeight: '800', marginTop: 8 },

  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderWidth: 0, borderTopWidth: 1, gap: 8 },
  hoursText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  actions: { flexDirection: 'row', gap: 6 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  callBtn: { backgroundColor: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.2)' },
  callText: { color: '#3B82F6', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  orderBtn: { backgroundColor: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)' },
  orderText: { color: '#10B981', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  dishList: { marginTop: 10, gap: 6 },
  dishRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  dishName: { flex: 1, fontSize: 12, fontWeight: '700' },
  dishPrice: { fontSize: 12, fontWeight: '900' },
  addBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#EF4F5F', backgroundColor: '#FFF5F6', minWidth: 64, alignItems: 'center' },
  addBtnText: { color: '#EF4F5F', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  moreText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.6, paddingVertical: 2 },
  payNote: { fontSize: 12, fontWeight: '700', marginTop: 2 },

  disclaimer: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textAlign: 'center', marginTop: 12, lineHeight: 11 }
});
