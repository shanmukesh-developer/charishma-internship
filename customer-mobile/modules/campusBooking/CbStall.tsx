/**
 * Stall menu for In-Campus Booking, in the store page's look (app/restaurant/[id]): photo hero with the round back
 * button, the floating info card (Open now / real rating, name, description, time and place line, FSSAI), notice
 * bars, in-store search and category pills, Menu / About, item cards with the image and the Add control, and the
 * red "View cart" bar. The cart is this stall's own pickup cart (cbCart), never a delivery basket.
 * A sample stall (campusBookingDemo.ts, id `sample-cb-...`) is drawn from that file only, in the same look, with a
 * "Sample" banner and "Sample" tags where Add would be (they open CbSampleSheet). It never calls a campus-booking
 * endpoint, never listens for live updates, never touches the pickup cart and has no bookings / cart / pay buttons.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SafeImage from '../../components/SafeImage';
import FssaiLine from '../../components/FssaiLine';
import { resolveMediaUrl } from '../../utils/imageUpload';
import { useTopInset } from '../../utils/useTopInset';
import { cbApi, type CbMenuItem, type CbStall as Stall } from './cbApi';
import { cbCart, useCbCart, MAX_QTY_STATIONERY } from './cbCart';
import { COLORS, SHADOWS, hhmm12, inr, surfaceLift, useCbTheme } from './cbTheme';
import { AddControl, DopaminePressable, EmptyCard, NoticeBar, StaggeredSection, useCbBack, useCbLive, useCbSignIn } from './cbKit';
import { isSampleId, sampleStallById, type CbSampleMenuItem } from './campusBookingDemo';
import CbSampleSheet, { CbSampleTag, type CbSampleNote } from './CbSampleSheet';
import { BUTTON_ROLE } from '../../utils/pressRole';
import SymbolIcon from '../../components/SymbolIcon';

const memo = new Map<string, { stall: Stall; menu: CbMenuItem[] }>();
const NON_FOOD_CATEGORY = /stationery|xerox|print|toiletr|laundry|household|electronic/i;

export default function CbStall({ id }: { id: string }) {
  const p = useCbTheme();
  const router = useRouter();
  const back = useCbBack();
  const topPad = useTopInset();
  const insets = useSafeAreaInsets();
  // A sample id never reaches the server: its stall comes from campusBookingDemo.ts, or "not taking bookings".
  const sampleId = isSampleId(id);
  const sample = useMemo(() => sampleStallById(id), [id]);
  const [data, setData] = useState<{ stall: Stall; menu: CbMenuItem[] } | null>(sample || memo.get(id) || null);
  const [error, setError] = useState<{ msg: string; gone: boolean } | null>(sampleId && !sample ? { msg: 'This sample stall is no longer shown.', gone: true } : null);
  const [sampleNote, setSampleNote] = useState<CbSampleNote | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'menu' | 'about'>('menu');
  const [descOpen, setDescOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  const [menuSearch, setMenuSearch] = useState('');
  const cart = useCbCart(id);
  // Guests read the menu and prices; Add and "Your bookings" ask them to sign in (QA Q23).
  const { requireSignIn } = useCbSignIn();

  const load = useCallback(async (pull = false) => {
    if (sampleId) return;
    if (pull) setRefreshing(true);
    try {
      const d = await cbApi.stall(id);
      memo.set(id, d);
      setData(d);
      setError(null);
      cbCart.refresh(id, d.menu);
      cbCart.nameStall(id, d.stall?.name);
    } catch (e: any) {
      setError({ msg: e?.message || 'Could not load this stall.', gone: e?.status === 404 });
    } finally {
      setRefreshing(false);
    }
  }, [id, sampleId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useCbLive((e) => { if (e.kind !== 'booking') void load(); }, !sampleId);

  const menu = data?.menu || [];
  const categories = useMemo(() => {
    const out: string[] = ['All'];
    for (const m of menu) {
      const c = String(m.category || '').trim();
      if (c && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
    }
    return out;
  }, [menu]);
  const menuQ = menuSearch.trim().toLowerCase();
  const filtered = menu.filter((m) => {
    if (menuQ) return `${m.name} ${m.category || ''} ${m.description || ''}`.toLowerCase().includes(menuQ);
    return activeCategory === 'All' || String(m.category || '').trim().toLowerCase() === activeCategory.toLowerCase();
  });

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: p.page }}>
        <View style={[st.hero, { backgroundColor: p.isDark ? '#1A1A1F' : '#FDE8EA' }]}>
          <TouchableOpacity style={[st.backBtn, { top: topPad }]} onPress={back} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={{ padding: 16 }}>
          {error ? (
            <EmptyCard icon={error.gone ? 'storefront-outline' : 'cloud-offline-outline'} title={error.gone ? 'Not taking bookings' : "Couldn't load the stall"} sub={error.msg} actionLabel={error.gone ? 'See other stalls' : 'Try again'} onAction={error.gone ? () => router.replace('/campus-booking' as any) : () => load()} />
          ) : <EmptyCard loading title="Loading the menu" />}
        </View>
      </View>
    );
  }

  const { stall } = data;
  const sampleArt = sample ? sample.stall.art : null;
  const heroImg = sampleArt ? null : resolveMediaUrl(stall.imageUrl) || resolveMediaUrl(stall.logoUrl);
  const openSample = (m: CbMenuItem) => setSampleNote({ name: m.name, art: (m as CbSampleMenuItem).art || null, price: m.price, meta: stall.name });
  const closes = hhmm12(stall.closesAt);
  const opens = hhmm12(stall.opensAt);

  return (
    <View style={[st.container, { backgroundColor: p.page }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={sample ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={p.accent} colors={[p.accent]} />}
      >
        {/* Hero */}
        <View style={st.hero}>
          {sampleArt ? (
            <SafeImage source={sampleArt} style={st.heroImg} maxWidth={800} placeholderIcon="storefront-outline" />
          ) : heroImg ? (
            <SafeImage source={{ uri: heroImg }} style={st.heroImg} maxWidth={800} placeholderIcon="storefront-outline" />
          ) : (
            <View style={[st.heroImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: p.isDark ? '#1A1A1F' : '#FDE8EA' }]}>
              <Ionicons name="storefront-outline" size={64} color={p.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'} />
            </View>
          )}
          <View style={st.heroGrad} />
          <TouchableOpacity style={[st.backBtn, { top: topPad }]} onPress={back} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          {sample ? null : (
            <TouchableOpacity style={[st.sideBtn, { top: topPad }]} onPress={() => { if (requireSignIn('Sign in to see your bookings')) router.push('/campus-booking/bookings' as any); }} accessibilityRole="button" accessibilityLabel="Your bookings">
              <Ionicons name="receipt-outline" size={18} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>

        {/* Info card (owner, 10 Nov 2026, from the approved replica): name, type · place, one status line, three
            facts, the description folded to two lines; FSSAI moved to About; one quiet pickup line. */}
        <View style={[st.floatingInfoCard, { backgroundColor: p.card, borderColor: p.border }]}>
          {sample ? <View style={{ marginBottom: 6 }}><CbSampleTag /></View> : null}
          <Text style={[st.infoCardName, { color: p.txt }]}>{stall.name}</Text>
          <Text style={{ fontSize: 13, color: p.txtSec, fontWeight: '500' }} numberOfLines={1}>{[stall.tags?.[0] || stall.categoryLabel, stall.location].filter(Boolean).join(' · ')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stall.isOpen ? p.accent : '#9CA3AF' }} />
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: stall.isOpen ? p.accent : '#6B7280' }}>
              {stall.isOpen ? (closes ? `Open now · closes ${closes}` : 'Open now') : opens ? `Closed now · opens at ${opens}` : 'Closed now'}
            </Text>
            {stall.rating ? <Text style={{ color: p.txt, fontSize: 12, fontWeight: '700', marginLeft: 6 }}>{`★ ${stall.rating.toFixed(1)}`}</Text> : null}
          </View>
          <View style={[st.facts, { borderColor: p.border }]}>
            {[
              [`${stall.prepMinutes}–${stall.prepMinutes + 15} min`, 'Ready in'],
              ['Pickup', 'At the counter'],
              ['UPI', 'Pay the stall'],
            ].map(([v, l], i) => (
              <View key={l} style={[st.fact, i > 0 && { borderLeftWidth: 1, borderLeftColor: p.border }]}>
                <Text style={{ fontSize: 13.5, fontWeight: '800', color: p.txt }} numberOfLines={1}>{v}</Text>
                <Text style={{ fontSize: 11, color: p.txtSec, marginTop: 2 }} numberOfLines={1}>{l}</Text>
              </View>
            ))}
          </View>
          {stall.description ? (
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontSize: 13, lineHeight: 19, color: p.txtSec }} numberOfLines={descOpen ? undefined : 2}>{stall.description}</Text>
              <TouchableOpacity onPress={() => setDescOpen((v) => !v)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityRole="button">
                <Text style={{ fontSize: 12.5, fontWeight: '800', color: p.accent, marginTop: 3 }}>{descOpen ? 'Show less' : 'Read more'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {sample ? (
          <NoticeBar icon="information-circle-outline" text="Sample stall. This shows what's coming to In-Campus Booking. You can't book it yet." style={{ marginHorizontal: 16, marginTop: 12 }} />
        ) : (
          <NoticeBar icon="qr-code-outline" text="Show your pickup code at the counter" style={{ marginHorizontal: 16, marginTop: 12 }} />
        )}

        {/* Menu / About */}
        <View style={[st.tabs, { borderBottomColor: p.border }]} accessibilityRole="tablist">
          {(['menu', 'about'] as const).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text style={[st.tabText, { color: tab === t ? p.accent : p.txtSec }]}>{t === 'menu' ? 'Menu' : 'About'}</Text>
              <View style={[st.tabBar, { backgroundColor: tab === t ? p.accent : 'transparent' }]} />
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'menu' ? (
          <>
            {menu.length > 6 ? (
              <View style={[st.menuSearch, { backgroundColor: p.card, borderColor: p.border }, surfaceLift(p.isDark)]}>
                <Ionicons name="search-outline" size={16} color={p.txtSec} />
                <TextInput value={menuSearch} onChangeText={setMenuSearch} placeholder={`Search in ${stall.name}`} placeholderTextColor={p.txtSec} style={[st.menuSearchInput, { color: p.txt }]} returnKeyType="search" autoCorrect={false} accessibilityLabel="Search this menu" />
                {!!menuSearch && (
                  <TouchableOpacity onPress={() => setMenuSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={17} color={p.txtSec} />
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
            {categories.length > 2 && !menuQ ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.categoryScroll} contentContainerStyle={{ paddingHorizontal: 16 }}>
                {categories.map((cat) => {
                  const on = activeCategory === cat;
                  return (
                    <DopaminePressable key={cat} style={[st.categoryPill, { backgroundColor: p.card, borderColor: p.border }, on && { backgroundColor: p.accent, borderColor: p.accent }]} onPress={() => setActiveCategory(cat)} sound="tabSwitch" activeScale={0.94}>
                      <Text style={[st.categoryText, { color: on ? '#FFF' : p.txt }]} maxFontSizeMultiplier={1.3}>{cat}</Text>
                    </DopaminePressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <View style={{ padding: 16, paddingBottom: 110 + insets.bottom }}>
              <Text style={[st.menuTitle, { color: p.txt }]}>Menu</Text>
              <Text style={[st.menuSub, { color: p.txtSec }]}>{menuQ ? `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'} for "${menuSearch.trim()}"` : `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`}</Text>
              {!filtered.length ? <EmptyCard icon={menuQ ? 'search-outline' : 'file-tray-outline'} title={menuQ ? 'No matching items' : 'No items here yet'} sub={menuQ ? 'Try another word.' : 'This stall is still adding items. Check back later.'} /> : null}
              {filtered.map((m, i) => {
                const art = sample ? (m as CbSampleMenuItem).art : null;
                const img = art ? null : resolveMediaUrl(m.imageUrl);
                const food = !NON_FOOD_CATEGORY.test(String(m.category || ''));
                const qty = cart.lines.find((l) => l.menuItemId === m.id)?.quantity || 0;
                return (
                  <StaggeredSection key={m.id} delay={Math.min(i, 10) * 60} direction="up">
                    <TouchableOpacity
                      activeOpacity={sample ? 0.92 : 1}
                      disabled={!sample}
                      onPress={() => openSample(m)}
                      accessible={!!sample}
                      accessibilityRole={sample ? BUTTON_ROLE : undefined}
                      accessibilityLabel={sample ? `${m.name}, ${inr(m.price)}, sample. Opens a note` : undefined}
                      style={[st.menuCard, { backgroundColor: p.card, borderColor: p.border }, !m.isAvailable && { opacity: 0.6 }]}
                    >
                      <View style={st.menuInfo}>
                        {food ? (
                          <View style={[st.vegDot, { borderColor: m.isVeg ? '#22C55E' : '#AF3F3F' }]}>
                            {m.isVeg ? <View style={[st.vegDotInner, { backgroundColor: '#22C55E' }]} /> : <View style={st.nonVegTriangle} />}
                          </View>
                        ) : null}
                        <Text style={[st.menuItemName, { color: p.txt }]} numberOfLines={2}>{m.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 2 }}>
                          <Text style={[st.menuItemPrice, { color: p.txt }]}>{inr(m.price)}</Text>
                          {m.originalPrice ? <Text style={{ fontSize: 12, color: p.txtSec, textDecorationLine: 'line-through' }}>{inr(m.originalPrice)}</Text> : null}
                        </View>
                        {m.description ? <Text style={{ fontSize: 12, color: p.txtSec, marginTop: 2 }} numberOfLines={2}>{m.description}</Text> : null}
                      </View>
                      <View style={st.imgBtnContainer} pointerEvents="box-none">
                        {art ? <SafeImage source={art} style={st.menuItemImg} placeholderIcon={food ? 'fast-food-outline' : 'cube-outline'} /> : img ? <SafeImage source={{ uri: img }} style={st.menuItemImg} placeholderIcon={food ? 'fast-food-outline' : 'cube-outline'} /> : (
                          <View style={[st.menuItemImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: p.isDark ? '#1F1F23' : '#F3F4F6' }]}>
                            <Ionicons name={food ? 'restaurant-outline' : 'cube-outline'} size={28} color={p.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'} />
                          </View>
                        )}
                        <View style={st.floatingAddWrap} pointerEvents="box-none">
                          {sample ? (
                            <View style={[st.sampleAddSlot, { backgroundColor: p.card, borderColor: p.border }]}>
                              <CbSampleTag onPress={() => openSample(m)} label={`${m.name} is a sample. Opens a note`} />
                            </View>
                          ) : (
                          <AddControl
                            qty={qty}
                            soldOut={!m.isAvailable}
                            closed={!stall.isOpen}
                            max={stall.category === 'stationery' ? MAX_QTY_STATIONERY : undefined}
                            onAdd={() => { if (stall.isOpen && requireSignIn('Sign in to book')) cbCart.change(id, { menuItemId: m.id, name: m.name, price: m.price, isVeg: m.isVeg, category: m.category }, 1, stall.category === 'stationery' ? MAX_QTY_STATIONERY : undefined, stall.name); }}
                            onRemove={() => cbCart.change(id, { menuItemId: m.id, name: m.name, price: m.price, isVeg: m.isVeg, category: m.category }, -1)}
                          />
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  </StaggeredSection>
                );
              })}
            </View>
          </>
        ) : (
          <View style={{ padding: 16, paddingBottom: 110 + insets.bottom }}>
            <View style={[st.aboutCard, { backgroundColor: p.card, borderColor: p.border }, surfaceLift(p.isDark)]}>
              {[
                ...(sample ? [['information-circle-outline', 'Sample stall. It shows what is coming and cannot be booked yet.']] : []),
                ['time-outline', stall.hoursToday ? `Today: ${stall.hoursToday}` : 'Hours not listed'],
                ...(stall.location ? [['location-outline', stall.location]] : []),
                ['hourglass-outline', `Usually ready in about ${stall.prepMinutes} minutes after the stall accepts`],
                ['storefront-outline', 'Pickup only. Collect at the counter with your pickup code.'],
                ...(sample ? [] : [['qr-code-outline', 'You pay the stall directly by UPI. ZenWe does not take or hold the money.']]),
                ['pricetag-outline', `${stall.categoryLabel}${stall.itemCount ? ` · ${stall.itemCount} items` : ''}`],
              ].map(([icon, text]) => (
                <View key={text} style={st.aboutRow}>
                  <Ionicons name={icon as any} size={16} color={p.txtSec} />
                  <Text style={[st.aboutText, { color: p.txt }]}>{text}</Text>
                </View>
              ))}
              {sample ? null : <FssaiLine number={stall.fssaiLicenseNumber} storeName={stall.legalName || undefined} color={p.txtSec} />}
            </View>
          </View>
        )}
      </ScrollView>
      <CbSampleSheet note={sampleNote} onClose={() => setSampleNote(null)} />

      {!sample && cart.count ? (
        <View style={[st.floatingCartContainer, { bottom: 24 + insets.bottom }]}>
          <DopaminePressable
            style={[st.floatingCart, { backgroundColor: p.accent, shadowColor: p.accent }]}
            onPress={() => router.push(`/campus-booking/cart/${id}` as any)}
            accessibilityRole="button"
            accessibilityLabel={`View cart, ${cart.count} items, item total ${inr(cart.total)}`}
            sound="success"
            activeScale={0.95}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={st.badgeContainer}><Text style={st.badgeText}>{cart.count}</Text></View>
              <Text style={[st.floatingCartText, { color: p.onAccent }]}>Item total {inr(cart.total)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Text style={st.proceedText}>View cart</Text><SymbolIcon name="chevron-forward" style={st.proceedText} scale={1} /></View>
          </DopaminePressable>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  hero: { width: '100%', height: 200, position: 'relative' },
  heroImg: { width: '100%', height: 200 },
  heroGrad: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  backBtn: { position: 'absolute', left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  sideBtn: { position: 'absolute', right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', zIndex: 2, ...SHADOWS.card },
  facts: { flexDirection: 'row', marginTop: 14, borderWidth: 1, borderRadius: 16 },
  fact: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  floatingInfoCard: { marginHorizontal: 16, marginTop: -32, borderRadius: 24, padding: 16, borderWidth: 1, ...SHADOWS.card, shadowOpacity: 0.15 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  statusBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  infoCardName: { fontSize: 20, fontWeight: '900', letterSpacing: 0.5, marginBottom: 4 },
  infoCardDesc: { fontSize: 12, fontWeight: '500', lineHeight: 16, marginBottom: 8 },
  localBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(249,115,22,0.1)', borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginVertical: 4 },
  localBadgeText: { fontSize: 12, fontWeight: '800', color: '#F97316', letterSpacing: 0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 12, fontWeight: '800' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10 },
  tabText: { fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
  tabBar: { height: 3, borderRadius: 2, width: 48, marginTop: 9 },
  menuSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, height: 42, borderRadius: 14, borderWidth: 1 },
  menuSearchInput: { flex: 1, fontSize: 13, fontWeight: '600', paddingVertical: 0 },
  categoryScroll: { marginVertical: 12 },
  categoryPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8, borderWidth: 1 },
  categoryText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  menuTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 0.2, marginBottom: 2 },
  menuSub: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2, marginBottom: 16 },
  menuCard: { flexDirection: 'row', padding: 12, borderRadius: 24, marginBottom: 12, borderWidth: 1, alignItems: 'center' },
  menuInfo: { flex: 1, paddingRight: 12 },
  vegDot: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  vegDotInner: { width: 5, height: 5, borderRadius: 2.5 },
  nonVegTriangle: { width: 0, height: 0, backgroundColor: 'transparent', borderStyle: 'solid', borderLeftWidth: 3.5, borderRightWidth: 3.5, borderBottomWidth: 6.5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#AF3F3F' },
  menuItemName: { fontSize: 13, fontWeight: '900', marginBottom: 2 },
  menuItemPrice: { fontSize: 14, fontWeight: '900', marginBottom: 4 },
  imgBtnContainer: { width: 90, height: 90, position: 'relative', alignItems: 'center', justifyContent: 'flex-end' },
  menuItemImg: { width: 90, height: 90, borderRadius: 16 },
  floatingAddWrap: { position: 'absolute', bottom: -8, zIndex: 10, width: '100%', alignItems: 'center' },
  sampleAddSlot: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4, ...SHADOWS.card },
  aboutCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  aboutRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  aboutText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18 },
  floatingCartContainer: { position: 'absolute', left: 16, right: 16, zIndex: 100 },
  floatingCart: { height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, backgroundColor: '#EF4F5F', shadowColor: '#EF4F5F', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8, width: '100%' },
  badgeContainer: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  floatingCartText: { fontSize: 13, fontWeight: '900', letterSpacing: 0.2, color: '#fff' },
  proceedText: { fontSize: 12, fontWeight: '900', color: '#fff' },
});
