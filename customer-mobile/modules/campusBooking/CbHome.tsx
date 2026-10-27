/**
 * In-Campus Booking stall list (opened from the fixed first Home card). Same look as the Home stall section
 * (components/CampusBitesSection): header line, chips, search, stall cards with photo, name, menu line, open state,
 * real rating only, up to 3 dishes with Add, and "View menu". Adds go to that stall's own pickup cart (cbCart),
 * never to a delivery basket. Bookings in progress are listed first.
 * While few real stalls take bookings, sample stalls (campusBookingDemo.ts) follow the real ones, tagged "Sample":
 * their dishes have a "Sample" tag instead of Add (it opens CbSampleSheet) and their page never calls the server.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CachedImage as Image } from '../../components/SafeImage';
import { resolveMediaUrl } from '../../utils/imageUpload';
import { cbApi, type CbBooking, type CbCategoryKey, type CbHome as HomeData, type CbStall } from './cbApi';
import { cbCart, cartTotals, useCbCartTick } from './cbCart';
import { TYPE, hhmm12, inr, surfaceLift, timeIST, useCbTheme } from './cbTheme';
import { AddControl, CbHeader, DopaminePressable, EmptyCard, NoticeBar, StaggeredSection, StatusTag, VegBox, useCbLive } from './cbKit';
import { isSampleStall, sampleItemArt, sampleStallsFor } from './campusBookingDemo';
import CbSampleSheet, { CbSampleTag, type CbSampleNote } from './CbSampleSheet';

let homeMem: HomeData | null = null;

const CATEGORY_CHIPS: { key: CbCategoryKey | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'food', label: 'Food & Beverages' },
  { key: 'snacks', label: 'Snacks & Bakery' },
  { key: 'stationery', label: 'Stationery' },
  { key: 'more', label: 'More' },
];
// No veg mark on non-food products (stationery, toiletries...), same rule as the Home stall section.
const NON_FOOD_CATEGORY = /stationery|xerox|print|toiletr|laundry|household|electronic/i;

const statusLine = (v: CbStall) => {
  if (v.isOpen) return `Open · ready in about ${v.prepMinutes} min`;
  const opens = hhmm12(v.opensAt);
  return opens ? `Closed · opens ${opens}` : 'Closed now';
};

export default function CbHome() {
  const p = useCbTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<HomeData | null>(homeMem);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [chip, setChip] = useState<CbCategoryKey | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sampleNote, setSampleNote] = useState<CbSampleNote | null>(null);
  useCbCartTick();

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    try {
      const d = await cbApi.home();
      homeMem = d;
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load the stalls.');
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useCbLive(() => { void load(); });

  const q = search.trim().toLowerCase();
  const pick = useCallback((list: CbStall[]) => {
    const inChip = list.filter((v) => chip === 'all' || v.category === chip);
    if (!q) return inChip;
    return inChip.filter((v) => [v.name, v.location, v.menuCategories, v.categoryLabel, ...(v.tags || []), ...(v.preview || []).map((m) => m.name)]
      .some((t) => String(t || '').toLowerCase().includes(q)));
  }, [chip, q]);
  const stalls = useMemo(() => pick(data?.stalls || []), [data, pick]);
  // Samples only once the real list is known (never while loading or after an error), after the real stalls.
  const allSamples = useMemo(() => (data ? sampleStallsFor(data.stalls || []) : []), [data]);
  const samples = useMemo(() => pick(allSamples), [allSamples, pick]);
  const allStalls = data?.stalls || [];
  const openCount = allStalls.filter((v) => v.isOpen).length;
  const latest = cbCart.latest();
  const latestTotals = latest ? cartTotals(latest.lines) : null;
  const latestStall = latest ? allStalls.find((v) => v.id === latest.stallId) : null;

  const pillStyle = p.isDark ? { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: p.border } : { backgroundColor: '#FFF', borderColor: 'transparent', ...surfaceLift(false, true) };

  return (
    <View style={{ flex: 1, backgroundColor: p.page }}>
      <CbHeader
        title="In-Campus Booking"
        sub={data ? (!allStalls.length && allSamples.length ? 'Sample stalls for now' : `${allStalls.length} ${allStalls.length === 1 ? 'stall' : 'stalls'} · ${openCount} open now`) : 'Campus stalls'}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as any))}
        right={(
          <TouchableOpacity onPress={() => router.push('/campus-booking/bookings' as any)} style={[st.headerIcon, pillStyle]} accessibilityRole="button" accessibilityLabel={`Your bookings${data?.active.length ? `, ${data.active.length} in progress` : ''}`}>
            <Ionicons name="receipt-outline" size={18} color={p.txt} />
            {data?.active.length ? <View style={[st.dot, { backgroundColor: p.accent }]} /> : null}
          </TouchableOpacity>
        )}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: (latest ? 110 : 40) + insets.bottom, width: '100%', maxWidth: 600, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={p.accent} colors={[p.accent]} />}
      >
        <Text style={[st.sectionSub, { color: p.txtSec }]}>
          Book from campus stalls and collect at the counter. You pay the stall directly by UPI.
        </Text>
        <View style={st.pillRow}>
          <View style={[st.pill, pillStyle]}>
            <Ionicons name="qr-code-outline" size={12} color={p.txtSec} />
            <Text style={[st.pillText, { color: p.txtSec }]}>Pay the stall by UPI</Text>
          </View>
          <View style={[st.pill, pillStyle]}>
            <Ionicons name="storefront-outline" size={12} color={p.txtSec} />
            <Text style={[st.pillText, { color: p.txtSec }]}>Pickup at the counter</Text>
          </View>
        </View>

        {/* Bookings in progress */}
        {data?.active.length ? (
          <View style={{ marginTop: 8 }}>
            <Text style={[st.sectionTitle, { color: p.txt }]}>In progress</Text>
            {data.active.map((b) => <ActiveRow key={b.id} b={b} onPress={() => router.push(((b.status === 'PAYMENT_PENDING' || b.status === 'REJECTED') && b.canSubmitProof ? `/campus-booking/pay/${b.id}` : `/campus-booking/order/${b.id}`) as any)} />)}
          </View>
        ) : null}

        {/* Search across stalls and their dishes */}
        <View style={[st.searchWrap, { backgroundColor: p.card, borderColor: p.border }, surfaceLift(p.isDark, true)]}>
          <Ionicons name="search" size={16} color={p.txtSec} />
          <TextInput
            style={[st.searchInput, { color: p.txt }]}
            placeholder="Search stalls or items"
            placeholderTextColor={p.txtSec}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search stalls and items"
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={p.txtSec} />
            </TouchableOpacity>
          )}
        </View>

        {/* Category filter (the stall section's campus pills) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {CATEGORY_CHIPS.map((c) => {
            const on = chip === c.key;
            return (
              <TouchableOpacity key={c.key} style={[st.chip, { backgroundColor: p.card, borderColor: on ? p.accent : p.border }]} onPress={() => setChip(c.key)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[st.chipLabel, { color: on ? p.accent : p.txtSec }]} numberOfLines={1}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {!data && !error ? <EmptyCard loading title="Loading campus stalls" /> : null}
        {!data && error ? <EmptyCard icon="cloud-offline-outline" title="Couldn't load the stalls" sub={error} actionLabel="Try again" onAction={() => load()} /> : null}
        {data && !allStalls.length && !allSamples.length ? (
          <EmptyCard title="No stalls take bookings yet" sub="Campus stalls appear here as soon as they start taking In-Campus Bookings." />
        ) : null}
        {data && (allStalls.length > 0 || allSamples.length > 0) && !stalls.length && !samples.length ? (
          <EmptyCard icon="search-outline" title={q ? `No stall or item matches "${search.trim()}"` : 'No stalls in this category yet'} actionLabel="Show all stalls" onAction={() => { setSearch(''); setChip('all'); }} />
        ) : null}

        {stalls.map((v, i) => (
          <StaggeredSection key={v.id} delay={Math.min(i, 6) * 60} direction="up">
            <StallCard stall={v} onOpen={() => router.push(`/campus-booking/stall/${v.id}` as any)} />
          </StaggeredSection>
        ))}

        {/* Sample stalls (campusBookingDemo.ts): after the real ones, never booked */}
        {samples.length ? (
          <NoticeBar
            icon="information-circle-outline"
            text={allStalls.length ? "More stalls are coming. The ones tagged Sample show what to expect and can't be booked yet." : "No stall takes bookings yet. The stalls below are samples of what's coming and can't be booked yet."}
            style={{ marginBottom: 12, marginTop: stalls.length ? 4 : 0 }}
          />
        ) : null}
        {samples.map((v, i) => (
          <StaggeredSection key={v.id} delay={Math.min(stalls.length + i, 6) * 60} direction="up">
            <StallCard stall={v} onOpen={() => router.push(`/campus-booking/stall/${v.id}` as any)} onSample={setSampleNote} />
          </StaggeredSection>
        ))}

        {allStalls.length > 0 ? <Text style={[st.disclaimer, { color: p.txtSec }]}>You pay the stall directly by UPI. ZCS does not take or hold the money.</Text> : null}
      </ScrollView>

      {latest && latestTotals && latestTotals.count > 0 ? (
        <View style={[st.cartWrap, { bottom: 16 + insets.bottom }]}>
          <DopaminePressable
            style={st.cartBar}
            onPress={() => router.push(`/campus-booking/cart/${latest.stallId}` as any)}
            accessibilityRole="button"
            accessibilityLabel={`View cart, ${latestTotals.count} items, item total ${inr(latestTotals.total)}`}
            sound="success"
            activeScale={0.95}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <View style={st.badge}><Text style={st.badgeText}>{latestTotals.count}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.cartText} numberOfLines={1}>Item total {inr(latestTotals.total)}</Text>
                {latestStall ? <Text style={st.cartSub} numberOfLines={1}>{latestStall.name}</Text> : null}
              </View>
            </View>
            <Text style={st.cartText}>View cart ›</Text>
          </DopaminePressable>
        </View>
      ) : null}
      <CbSampleSheet note={sampleNote} onClose={() => setSampleNote(null)} />
    </View>
  );
}

function StallCard({ stall: v, onOpen, onSample }: { stall: CbStall; onOpen: () => void; onSample?: (n: CbSampleNote) => void }) {
  const p = useCbTheme();
  useCbCartTick();
  const sample = isSampleStall(v) ? v : null;
  const img = sample ? null : resolveMediaUrl(v.imageUrl) || resolveMediaUrl(v.logoUrl);
  const meta = [v.menuCategories || v.categoryLabel, v.location].filter(Boolean).join(' · ');
  const dishes = v.preview || [];
  const foot = [v.itemCount ? `${v.itemCount} ${v.itemCount === 1 ? 'item' : 'items'}` : null, v.hoursToday].filter(Boolean).join(' · ');
  return (
    <TouchableOpacity activeOpacity={0.92} style={[st.card, { backgroundColor: p.card, borderColor: p.border }, surfaceLift(p.isDark)]} onPress={onOpen} accessibilityLabel={`${v.name}${sample ? ", sample stall" : ""}, ${statusLine(v)}`}>
      <View style={st.cardTop}>
        <View style={[st.photo, { borderColor: p.border }]}>
          {sample ? <Image source={sample.art} style={st.photoImg} placeholderIcon="storefront-outline" /> : img ? <Image source={{ uri: img }} style={st.photoImg} placeholderIcon="storefront-outline" /> : (
            <View style={[st.photoImg, st.noImg, { backgroundColor: p.chipBg }]}><Ionicons name="storefront-outline" size={26} color={p.txtSec} /></View>
          )}
        </View>
        <View style={st.info}>
          {sample ? (
            <View style={st.nameRow}>
              <Text style={[st.nameText, { color: p.txt, flexShrink: 1 }]} numberOfLines={1}>{v.name}</Text>
              <CbSampleTag />
            </View>
          ) : <Text style={[st.nameText, { color: p.txt }]} numberOfLines={1}>{v.name}</Text>}
          {!!meta && <Text style={[st.metaText, { color: p.txtSec }]} numberOfLines={1}>{meta}</Text>}
          <View style={st.statusRow}>
            <Ionicons name="time-outline" size={13} color={v.isOpen ? p.openInk : p.closedInk} />
            <Text style={[st.statusText, { color: v.isOpen ? p.openInk : p.closedInk, flexShrink: 1 }]} numberOfLines={1}>{statusLine(v)}</Text>
            {v.rating ? (
              <>
                <Text style={[st.statusText, { color: p.txtSec }]}>·</Text>
                <Ionicons name="star" size={11} color={p.txtSec} />
                <Text style={[st.statusText, { color: p.txt }]}>{v.rating.toFixed(1)} ({v.ratingCount})</Text>
              </>
            ) : null}
          </View>
        </View>
      </View>

      {dishes.length ? (
        <View style={[st.dishList, { borderTopColor: p.border }, !v.isOpen && { opacity: 0.55 }]}>
          {dishes.map((m) => (
            <View key={m.id} style={st.dishRow}>
              {NON_FOOD_CATEGORY.test(String(m.category || '')) ? <View style={{ width: 12 }} /> : <VegBox veg={m.isVeg} />}
              <Text style={[st.dishName, { color: p.txt }]} numberOfLines={1}>{m.name}</Text>
              <Text style={[st.dishPrice, { color: p.txt }]}>{inr(m.price)}</Text>
              {sample ? (
                <CbSampleTag
                  onPress={() => onSample?.({ name: m.name, art: sampleItemArt(v.id, m.id), price: m.price, meta: v.name })}
                  label={`${m.name} is a sample. Opens a note`}
                />
              ) : v.isOpen ? (
                <AddControl
                  qty={cbCart.qty(v.id, m.id)}
                  onAdd={() => cbCart.change(v.id, { menuItemId: m.id, name: m.name, price: m.price, isVeg: m.isVeg, category: m.category }, 1)}
                  onRemove={() => cbCart.change(v.id, { menuItemId: m.id, name: m.name, price: m.price, isVeg: m.isVeg, category: m.category }, -1)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : <Text style={[st.emptyDishes, { color: p.txtSec }]}>{v.itemCount === 0 ? 'Menu coming soon.' : 'Everything is sold out right now.'}</Text>}

      <View style={[st.footer, { borderTopColor: p.border }]}>
        <Text style={[st.footText, { color: p.txtSec }]} numberOfLines={1}>{foot}</Text>
        <TouchableOpacity style={st.viewMenu} onPress={onOpen} hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }} accessibilityLabel={`See the full menu of ${v.name}`}>
          <Text style={[st.viewMenuText, { color: p.accent }]}>View menu</Text>
          <Ionicons name="chevron-forward" size={16} color={p.accent} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function ActiveRow({ b, onPress }: { b: CbBooking; onPress: () => void }) {
  const p = useCbTheme();
  const line = b.status === 'READY' ? 'Ready at the counter. Show your pickup code.'
    : b.status === 'PAYMENT_PENDING' ? 'Pay the stall by UPI and send the proof.'
      : b.status === 'REJECTED' ? 'Payment not verified. Send the proof again.'
        : b.status === 'PAYMENT_REVIEW' ? 'The stall is checking your payment.'
          : b.estimatedReadyAt ? `Ready by about ${timeIST(b.estimatedReadyAt)}` : b.statusLabel;
  return (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={[st.card, st.activeCard, { backgroundColor: p.card, borderColor: b.status === 'READY' ? p.gold : p.border }, surfaceLift(p.isDark)]} accessibilityLabel={`Booking ${b.ref} at ${b.stall?.name || 'the stall'}, ${b.statusLabel}`}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[st.nameText, { color: p.txt, flexShrink: 1 }]} numberOfLines={1}>{b.stall?.name || 'Campus stall'}</Text>
          <StatusTag status={b.status} label={b.statusLabel} />
        </View>
        <Text style={[st.metaText, { color: p.txtSec }]} numberOfLines={2}>{line}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
        <Text style={[TYPE.price, { color: p.txt }]}>{inr(b.amount)}</Text>
        <Ionicons name="chevron-forward" size={16} color={p.txtSec} style={{ marginTop: 4 }} />
      </View>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  headerIcon: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 0.1, marginBottom: 10 },
  sectionSub: { fontSize: 12, fontWeight: '500', letterSpacing: 0.2, marginBottom: 8, lineHeight: 17 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '500' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 44, borderRadius: 12, borderWidth: 1, gap: 8, marginBottom: 12, marginTop: 4 },
  searchInput: { flex: 1, ...TYPE.body, fontSize: 14, paddingVertical: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, marginRight: 8, maxWidth: 200 },
  chipLabel: { ...TYPE.chip },
  card: { borderRadius: 16, borderWidth: 1, marginBottom: 12, padding: 16, overflow: 'hidden' },
  activeCard: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 68, height: 68, borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  photoImg: { width: 68, height: 68 },
  noImg: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, gap: 3 },
  nameText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  metaText: { fontSize: 13, fontWeight: '400' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 12, fontWeight: '500' },
  dishList: { marginTop: 12, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  dishRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  dishName: { flex: 1, fontSize: 14, fontWeight: '500' },
  dishPrice: { fontSize: 14, fontWeight: '600' },
  emptyDishes: { ...TYPE.body, marginTop: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  footText: { flex: 1, fontSize: 12, fontWeight: '400' },
  viewMenu: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewMenuText: { fontSize: 14, fontWeight: '600' },
  disclaimer: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 8, lineHeight: 16 },
  cartWrap: { position: 'absolute', left: 16, right: 16, zIndex: 100 },
  cartBar: { height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, backgroundColor: '#EF4F5F', shadowColor: '#EF4F5F', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8, width: '100%' },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  cartText: { fontSize: 13, fontWeight: '900', letterSpacing: 0.2, color: '#FFF' },
  cartSub: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.86)' },
});
