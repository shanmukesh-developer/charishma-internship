/**
 * Services category page (app/category/[id].tsx for repairs / tailoring / print / laundry):
 * hero card, the shelf's real catalogue services, and an "Other services" grid. Tapping a service
 * opens the step booking flow (ServiceBookingSheet). Prices come from the catalogue.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TextInput, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import { useLiveSync } from '../../utils/useLiveSync';
import { readCache, writeCache } from '../../utils/swrCache';
import SafeImage from '../../components/SafeImage';
import { PressScale, FadeInUp, StateCard, SkeletonList } from '../others/motion';
import type { StateKind } from '../others/motion';
import ServiceBookingSheet, { Tile, type BookableItem, type FlowStart } from './ServiceBookingSheet';
import { PRINT_RATE_RES, resolveServiceForm, type PrintRates } from './serviceForms';
import { TAILOR_GROUPS, groupItems, itemIcon, servicePriceLabel, type IconName } from './serviceFlow';
import { SERVICE_FAMILY_META, familyOf, hexAlpha, useServicePalette } from './serviceTheme';

type Family = 'repairs' | 'tailoring' | 'print' | 'laundry';

const HERO: Record<Family, { kicker: string; title: string; sub: string; cta: string; image: string; icon: IconName }> = {
  repairs: { kicker: 'Campus tech care', title: 'Laptop & phone repair', sub: 'Doorstep pickup. You approve the quote before any work.', cta: 'Book a repair', image: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=900&q=80', icon: 'laptop-outline' },
  tailoring: { kicker: 'Campus tailoring', title: 'Tailoring & alterations', sub: 'Alterations, fittings and stitching, collected from your hostel.', cta: 'Book a tailor', image: 'https://images.unsplash.com/photo-1630930678172-63343537a00a?w=900&q=80', icon: 'cut-outline' },
  print: { kicker: 'Document hub', title: 'Print & binding', sub: 'Assignments, A3 drawings and thesis binding, delivered to your hostel gate.', cta: 'Send a print job', image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=900&q=80', icon: 'print-outline' },
  laundry: { kicker: 'Pickup & drop', title: 'Laundry & dry cleaning', sub: 'Washed, ironed and folded. Collected from your hostel.', cta: 'Schedule a pickup', image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=900&q=80', icon: 'shirt-outline' },
};

const TRUST: Record<Family, { icon: IconName; text: string }[]> = {
  repairs: [{ icon: 'home-outline', text: 'Doorstep pickup' }, { icon: 'pricetag-outline', text: 'Quote before work' }, { icon: 'cash-outline', text: 'Pay after repair' }],
  tailoring: [{ icon: 'body-outline', text: 'Measured at hostel' }, { icon: 'pricetag-outline', text: 'Price confirmed first' }, { icon: 'cash-outline', text: 'Cash on delivery' }],
  print: [{ icon: 'document-attach-outline', text: 'PDF or pen drive' }, { icon: 'bed-outline', text: 'Delivered to room' }, { icon: 'cash-outline', text: 'Pay on delivery' }],
  laundry: [{ icon: 'home-outline', text: 'Room pickup' }, { icon: 'scale-outline', text: 'Weighed at pickup' }, { icon: 'cash-outline', text: 'Pay on delivery' }],
};

const LIST_TITLE: Record<Family, string> = { repairs: 'Popular repairs', tailoring: 'All tailoring services', print: 'Prints and binding', laundry: 'Laundry services' };

const SHELF_TITLE: Record<Family, string> = { repairs: 'Laptop & phone repair', tailoring: 'Tailoring', print: 'Print & binding', laundry: 'Laundry' };

interface Row extends BookableItem { storeId: string }

export default function ServicesHome({ categoryId }: { categoryId: Family }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  // The hero photo gives up width on narrow phones so the hero button keeps its label on one line.
  const heroArtW = Math.round(Math.min(112, Math.max(88, (Math.min(winW, 720) - 32) * 0.3)));
  const family = familyOf(categoryId) as Family;
  const p = useServicePalette(family);
  const hero = HERO[family];

  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrKind, setLoadErrKind] = useState<StateKind>('error');
  const [query, setQuery] = useState('');
  const [flow, setFlow] = useState<{ item: BookableItem | null; start?: FlowStart } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const apply = useCallback((data: any) => {
    setItems((Array.isArray(data.items) ? data.items : []).map((it: any) => ({
      id: String(it.id || it._id),
      name: String(it.name || ''),
      price: Number(it.price) || 0,
      desc: String(it.description || ''),
      image: it.imageUrl || it.image || null,
      inStock: it.isAvailable !== false,
      storeName: String(it.storeName || ''),
      storeId: String(it.storeId || it.restaurantId || ''),
    })));
  }, []);

  // 'silent' = live-sync refresh: keep what is on screen, no spinner, no error screen
  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    const cacheKey = `catalogue:${categoryId}:all`;
    if (mode === 'initial') {
      const cached = await readCache<any>(cacheKey);
      if (cached?.data && Array.isArray(cached.data.items) && mountedRef.current) {
        apply(cached.data);
        setLoading(false);
        mode = 'silent';
      } else setLoading(true);
    }
    try {
      const res = await apiFetch(`${API_URL}/api/catalogue/items?type=${encodeURIComponent(categoryId)}&includeUnavailable=true`);
      const data = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (!res.ok || !data || !Array.isArray(data.items)) {
        if (mode !== 'silent') setLoadErrKind(res.status >= 502 && res.status <= 504 ? 'waking' : 'error');
        if (mode !== 'silent') setLoadError((data && typeof data.message === 'string' && data.message) || 'We could not load these services right now. Try again in a moment.');
        return;
      }
      apply(data);
      writeCache(cacheKey, data);
      setLoadError(null);
    } catch {
      if (mountedRef.current && mode !== 'silent') { setLoadErrKind('offline'); setLoadError('Check your internet connection and try again.'); }
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [categoryId, apply]);

  useEffect(() => { load('initial'); }, [load]);
  useLiveSync({ types: ['store', 'product'], onChange: () => { load('silent'); } });

  // Print rates come from the same catalogue rows the print list shows (one print shop).
  const rates: PrintRates = useMemo(() => {
    const find = (re: RegExp) => items.find((i) => re.test(i.name))?.price ?? null;
    return { bw: find(PRINT_RATE_RES[0]), color: find(PRINT_RATE_RES[1]), spiral: find(PRINT_RATE_RES[2]), hardbound: find(PRINT_RATE_RES[3]) };
  }, [items]);

  const openItem = (it: Row) => {
    if (it.inStock === false) {
      Alert.alert('Not taking bookings right now', `${it.name} is paused. Pick another service or check back later.`);
      return;
    }
    setFlow({ item: it });
  };
  const openList = (title: string, list: Row[], subtitle?: string) => {
    if (list.length === 1) { openItem(list[0]); return; }
    setFlow({ item: null, start: { kind: 'list', title, subtitle, itemIds: list.map((i) => i.id) } });
  };
  const openHero = () => {
    if (family === 'repairs') {
        setFlow({ item: null, start: { kind: 'device' } });
    } else if (family === 'print') {
      const main = items.find((i) => i.inStock !== false && resolveServiceForm('print', i.name).id === 'print.document' && PRINT_RATE_RES[0].test(i.name))
        || items.find((i) => i.inStock !== false);
      if (main) openItem(main);
    } else {
      openList(family === 'tailoring' ? 'Choose a tailoring service' : 'Choose a laundry service', items, family === 'laundry' ? 'Prices are set by each laundry partner.' : 'The tailor confirms the price before starting.');
    }
  };

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)) : items;
  const stores = Array.from(new Set(shown.map((i) => i.storeName || '')));
  const sections = family === 'laundry' && stores.length > 1
    ? stores.map((s) => ({ title: s, rows: shown.filter((i) => (i.storeName || '') === s) }))
    : [{ title: '', rows: shown }];

  const tailorGroups = family === 'tailoring'
    ? TAILOR_GROUPS.map((g) => ({ g, rows: groupItems(g, 'tailoring', items) })).filter((x) => x.rows.length > 0)
    : [];

  const others = (Object.keys(SERVICE_FAMILY_META) as Family[]).filter((k) => k !== family);

  // ── Pieces ────────────────────────────────────────────────────────────────────────────────
  const renderRow = (it: Row, i: number) => {
    const ic = itemIcon(categoryId, it.name);
    const price = servicePriceLabel(categoryId, it);
    const paused = it.inStock === false;
    return (
      <PressScale key={it.id} scaleTo={0.98} onPress={() => openItem(it)}
        accessibilityRole="button" accessibilityState={{ disabled: paused }}
        accessibilityLabel={`${it.name}, ${price.main}${price.note ? ` ${price.note}` : ''}${paused ? ', paused' : ''}`}
        style={[s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
        <View style={paused ? { opacity: 0.45 } : undefined}><Tile p={p} icon={ic.icon} size={48} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowTitle, { color: paused ? p.muted : p.text }]} numberOfLines={2}>{it.name}</Text>
          {it.desc ? <Text style={[s.rowSub, { color: p.sub }]} numberOfLines={2} ellipsizeMode="tail">{it.desc}</Text> : null}
          {paused ? (
            <Text style={[s.rowMeta, { color: p.muted }]}>Paused for now</Text>
          ) : (
            <Text style={[s.rowMeta, { color: p.text }]}>
              {price.main}{price.note ? <Text style={{ color: p.sub, fontWeight: '600' }}> {price.note}</Text> : null}
            </Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={p.muted} />
      </PressScale>
    );
  };

  const fromPrice = (rows: Row[]) => {
    const live = rows.filter((r) => r.inStock !== false);
    if (!live.length) return 'Paused';
    const min = live.reduce((m, r) => (r.price < m.price ? r : m), live[0]);
    const label = servicePriceLabel(categoryId, min);
    return label.main.startsWith('From') ? label.main : `From ${label.main}`;
  };

  return (
    <View style={[s.screen, { backgroundColor: p.page }]}>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
        <PressScale style={s.iconBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as any))} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={p.text} />
        </PressScale>
        <Text style={[s.headerTitle, { color: p.text }]} numberOfLines={1} accessibilityRole="header">{SERVICE_FAMILY_META[family].title}</Text>
        <PressScale style={s.iconBtn} onPress={() => router.push({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any)} accessibilityRole="button" accessibilityLabel="My service bookings">
          <Ionicons name="receipt-outline" size={22} color={p.text} />
        </PressScale>
      </View>

      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: 32 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load('refresh'); }} tintColor={p.accent} colors={[p.button]} />}
      >
        {/* Hero */}
        <LinearGradient colors={[p.heroFrom, p.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={s.heroKicker}>{hero.kicker}</Text>
            <Text style={s.heroTitle}>{hero.title}</Text>
            <Text style={s.heroSub}>{hero.sub}</Text>
            <PressScale onPress={openHero} haptic disabled={loading && !items.length} accessibilityRole="button" accessibilityLabel={hero.cta} style={s.heroBtn}>
              <Text style={[s.heroBtnText, { color: p.button }]} numberOfLines={1}>{hero.cta}</Text>
              <Ionicons name="arrow-forward" size={16} color={p.button} />
            </PressScale>
          </View>
          <View style={[s.heroArt, { width: heroArtW }]}>
            <SafeImage source={{ uri: hero.image }} fallbackUri={items.find((i) => i.image)?.image || undefined} style={s.heroImg} maxWidth={500} placeholderIcon={hero.icon} />
          </View>
        </LinearGradient>

        {/* Trust strip */}
        <View style={[s.trust, { backgroundColor: p.card }, p.shadow]}>
          {TRUST[family].map((t, i) => (
            <View key={t.text} style={[s.trustItem, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: p.line }]}>
              <Ionicons name={t.icon} size={18} color={p.accent} />
              <Text style={[s.trustText, { color: p.text }]} numberOfLines={2}>{t.text}</Text>
            </View>
          ))}
        </View>

        {loading && !items.length ? (
          <SkeletonList count={4} height={76} style={{ marginTop: 8 }} />
        ) : loadError && !items.length ? (
          <StateCard
            kind={loadErrKind}
            section={family}
            title={loadErrKind === 'offline' ? 'You are offline' : loadErrKind === 'waking' ? 'Waking the server up' : 'Could not load these services'}
            message={loadErrKind === 'waking' ? 'This takes a few seconds the first time. Try again in a moment.' : loadError}
            actionLabel="Try again"
            onAction={() => { setLoadError(null); load('initial'); }}
            style={{ marginTop: 14 }}
          />
        ) : !items.length ? (
          <StateCard
            kind="empty"
            section={family}
            icon={hero.icon}
            title="No services listed yet"
            message="Partners add their services here as they join. Pull down to refresh."
            style={{ marginTop: 14 }}
          />
        ) : (
          <>
            {/* Tailoring: category tiles */}
            {family === 'tailoring' && tailorGroups.length > 1 ? (
              <>
                <Text style={[s.sectionTitle, { color: p.text }]}>Choose a category</Text>
                <View style={s.grid}>
                  {tailorGroups.map(({ g, rows }, gi) => {
                    const img = rows.find((r) => r.image)?.image;
                    return (
                      <FadeInUp key={g.id} index={gi} style={{ width: '48.4%' }}>
                      <PressScale onPress={() => openList(g.label, rows)} haptic
                        accessibilityRole="button" accessibilityLabel={`${g.label}, ${g.sub}, ${fromPrice(rows)}`}
                        style={[s.catTile, { width: '100%', backgroundColor: p.card }, p.shadow]}>
                        <View style={[s.catArt, { backgroundColor: p.tint }]}>
                          {img ? <SafeImage source={{ uri: img }} style={s.catImg} maxWidth={400} placeholderIcon={g.icon} /> : <Ionicons name={g.icon} size={34} color={p.accent} />}
                        </View>
                        <Text style={[s.catTitle, { color: p.text }]} numberOfLines={1}>{g.label}</Text>
                        <Text style={[s.catSub, { color: p.sub }]} numberOfLines={1}>{g.sub}</Text>
                        <Text style={[s.catPrice, { color: p.accent }]}>{fromPrice(rows)}</Text>
                      </PressScale>
                      </FadeInUp>
                    );
                  })}
                </View>
              </>
            ) : null}

            {/* Services list */}
            <View style={s.sectionHead}>
              <Text style={[s.sectionTitle, { color: p.text, marginTop: 0, marginBottom: 0 }]}>{LIST_TITLE[family]}</Text>
              <Text style={[s.sectionCount, { color: p.sub }]}>{shown.length} {shown.length === 1 ? 'service' : 'services'}</Text>
            </View>
            {items.length > 8 ? (
              <View style={[s.search, { backgroundColor: p.card }, p.shadow]}>
                <Ionicons name="search" size={16} color={p.sub} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search services" placeholderTextColor={p.muted} maxLength={60}
                  style={[s.searchInput, { color: p.text }]} accessibilityLabel="Search services" returnKeyType="search" />
                {query ? (
                  <PressScale onPress={() => setQuery('')} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={18} color={p.sub} />
                  </PressScale>
                ) : null}
              </View>
            ) : null}
            {shown.length === 0 ? (
              <Text style={[s.stateBody, { color: p.sub, marginVertical: 16 }]}>No services match “{query.trim()}”.</Text>
            ) : sections.map((sec, si) => (
              <FadeInUp key={sec.title || 'all'} index={si + 1} style={{ marginBottom: 12 }}>
                {sec.title ? <Text style={[s.groupLabel, { color: p.sub }]}>{sec.title}</Text> : null}
                <View style={[s.listCard, { backgroundColor: p.card }, p.shadow]}>{sec.rows.map(renderRow)}</View>
              </FadeInUp>
            ))}
          </>
        )}

        {/* Other services */}
        <Text style={[s.sectionTitle, { color: p.text }]}>Other services</Text>
        <View style={s.grid}>
          {others.map((k) => {
            const m = SERVICE_FAMILY_META[k];
            return (
              // replace, not push: hopping between service pages never piles them up behind the back button
              <OtherTile key={k} family={k} title={m.short} sub={m.sub} icon={m.icon as IconName} onPress={() => router.replace(`/category/${k}` as any)} />
            );
          })}
          <PressScale onPress={() => router.push({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any)}
            accessibilityRole="button" accessibilityLabel="My service bookings, track and manage"
            style={[s.otherTile, { backgroundColor: p.card }, p.shadow]}>
            <View style={[s.otherIcon, { backgroundColor: p.raised }]}><Ionicons name="receipt-outline" size={22} color={p.sub} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[s.otherTitle, { color: p.text }]} numberOfLines={1}>My bookings</Text>
              <Text style={[s.otherSub, { color: p.sub }]} numberOfLines={1}>Track and manage</Text>
            </View>
          </PressScale>
        </View>
      </ScrollView>

      <ServiceBookingSheet
        visible={!!flow}
        item={flow?.item || null}
        start={flow?.start}
        catalogue={items}
        shelfId={categoryId}
        shelfTitle={SHELF_TITLE[family]}
        rates={rates}
        onClose={() => setFlow(null)}
        onServiceUnavailable={() => load('silent')}
      />
    </View>
  );
}

function OtherTile({ family, title, sub, icon, onPress }: { family: Family; title: string; sub: string; icon: IconName; onPress: () => void }) {
  const p = useServicePalette(family);
  return (
    <PressScale onPress={onPress} haptic accessibilityRole="button" accessibilityLabel={`${title}, ${sub}`}
      style={[s.otherTile, { backgroundColor: p.card }, p.shadow]}>
      <View style={[s.otherIcon, { backgroundColor: p.tint }]}><Ionicons name={icon} size={22} color={p.accent} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[s.otherTitle, { color: p.text }]} numberOfLines={1}>{title}</Text>
        <Text style={[s.otherSub, { color: p.sub }]} numberOfLines={1}>{sub}</Text>
      </View>
    </PressScale>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 6, width: '100%', maxWidth: 720, alignSelf: 'center' },
  hero: { borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', minHeight: 176, overflow: 'hidden' },
  heroKicker: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', lineHeight: 27, marginTop: 4 },
  heroSub: { color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 18, marginTop: 6 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 16, minHeight: 40, marginTop: 14 },
  heroBtnText: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  heroArt: { width: 112, height: 136, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  heroImg: { width: '100%', height: '100%' },
  trust: { flexDirection: 'row', borderRadius: 16, paddingVertical: 12, marginTop: 12 },
  trustItem: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  trustText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginTop: 22, marginBottom: 10 },
  sectionCount: { fontSize: 13, fontWeight: '600' },
  groupLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
  listCard: { borderRadius: 18, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 76 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 13, lineHeight: 18, marginTop: 1 },
  rowMeta: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  catTile: { width: '48.4%', borderRadius: 18, padding: 10, paddingBottom: 12 },
  catArt: { height: 96, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  catImg: { width: '100%', height: '100%' },
  catTitle: { fontSize: 15, fontWeight: '800', paddingHorizontal: 2 },
  catSub: { fontSize: 12, marginTop: 2, paddingHorizontal: 2 },
  catPrice: { fontSize: 13, fontWeight: '800', marginTop: 6, paddingHorizontal: 2 },
  otherTile: { width: '48.4%', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 12, minHeight: 68 },
  otherIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  otherTitle: { fontSize: 14, fontWeight: '700' },
  otherSub: { fontSize: 12, marginTop: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingLeft: 12, minHeight: 46, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  state: { alignItems: 'center', borderRadius: 18, padding: 24, marginTop: 14, gap: 6 },
  stateTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  stateBody: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  stateBtn: { marginTop: 10, minHeight: 44, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
