/**
 * Tech & repairs v2 home (Others → Tech & repairs; board "Tech & Repairs" + "Explore"): the navy header (back, ZCS
 * emblem, bell, search for every shelf, the shared section pills), the "Laptop and phone repairs" hero with three
 * trust points, Quick categories (photo tiles with the real "From ₹" of each shelf), "Book a service" and
 * "From the campus store" (real catalogue items only, in stock, with a photo), and My bookings.
 * Pull to refresh reloads every shelf.
 */
import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import SectionPillRail from '../others/SectionPillRail';
import { useUnreadDot } from '../foodV2/FoodV2HomeTop';
import { useTopInset } from '../../utils/useTopInset';
import { formatINR } from '../../utils/format';
import { TV, RADIUS, W, shadow } from './servicesV2Theme';
import { BookPill, FadeIn, HeroCard, Press, SectionHead, Stepper, usePageW } from './ServicesV2Kit';
import { ItemPhoto } from './ServicesV2Rows';
import { IArrowLeft, IBell, IChevronRight, IReceipt, ISearch } from './ServicesV2Icons';
import { HOME_HERO, SHELF_TILE } from './servicesV2Art';
import { ALL_SHELVES, SHELF_META, SHELF_TRUST, detailPath, priceLine, shelfPath, useMinPrices, useShelf, type ShelfId, type ShelfItem } from './servicesV2Data';
import { useStoreBasket } from './useStoreBasket';
import { openMyBookings } from './ServicesV2List';
import { goHome } from '../../utils/goHome';
import { themedSheet } from '../../utils/themeNow';

type Sections = { key: string; label: string }[];

function HomeTop({ sections, onSection }: { sections?: Sections; onSection?: (k: string) => void }) {
  const router = useRouter();
  const top = useTopInset(36, 44);
  const unread = useUnreadDot();
  return (
    // Owner, 10 Nov 2026: same Services look everywhere - flat diet band, section name as the title (no ZenWe badge)
    // and Home-style folder tabs flowing into the page.
    <View style={{ paddingTop: top, backgroundColor: TV.header[0] }}>
      <View style={h.brandRow}>
        <Press onPress={() => goHome(router)} label="Back to Home" style={h.iconBtn} scaleTo={0.9}>
          <IArrowLeft size={22} color={TV.onBand} strokeWidth={1.6} />
        </Press>
        <View style={{ flex: 1, marginLeft: 6, minWidth: 0 }}>
          <Text style={[h.brand, { fontSize: 22, fontWeight: '900' }]} numberOfLines={1} accessibilityRole="header">Tech & repairs</Text>
        </View>
        <Press onPress={() => openMyBookings(router)} label="My service bookings" hint="Opens Orders, Services: track and manage your repair and service bookings" style={h.iconBtn} scaleTo={0.9}>
          <IReceipt size={21} color={TV.onBand} strokeWidth={1.6} />
        </Press>
        <Press onPress={() => router.push('/notifications' as any)} label={unread ? 'Notifications, unread' : 'Notifications'} style={[h.iconBtn, { marginRight: -8 }]} scaleTo={0.9}>
          <IBell size={21} color={TV.onBand} strokeWidth={1.6} />
          {unread ? <View style={h.dot} /> : null}
        </Press>
      </View>

      <Press onPress={() => router.push('/services/search' as any)} label="Search repairs, tailoring, laundry and gadgets" style={h.search} scaleTo={0.99}>
        <ISearch size={18} color={TV.ink2} strokeWidth={1.7} />
        <Text style={h.searchText} numberOfLines={1}>Search repairs, tailoring, laundry, gadgets</Text>
      </Press>

      {sections && sections.length > 1 && onSection ? (
        <SectionPillRail sections={sections} active="services" onSection={onSection} side={16} accent={TV.accent} folder={{ band: TV.header[0], page: TV.page, ink: TV.onBand }} style={{ paddingTop: 2 }} />
      ) : <View style={{ height: 16 }} />}
    </View>
  );
}

function CategoryTile({ s, i, wide, tileW, price }: { s: ShelfId; i: number; wide?: boolean; tileW: number; price: string | null }) {
  const router = useRouter();
  const m = SHELF_META[s];
  return (
    <FadeIn index={i} style={wide ? { width: '100%' } : { width: tileW }}>
      <Press onPress={() => router.push(shelfPath(s) as any)} label={`${m.tile}, ${m.tileSub}${price ? `, ${price}` : ''}`} style={[q.tile, wide ? q.tileWide : { flex: 1 }, shadow(1)]} scaleTo={0.97}>
        <View style={wide ? q.photoWide : q.photo}>
          <Image source={SHELF_TILE[s]} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
        </View>
        <View style={wide ? { flex: 1, minWidth: 0, paddingVertical: 12, paddingRight: 4 } : { flex: 1, padding: 10, paddingTop: 9 }}>
          <Text style={q.title} numberOfLines={2}>{m.tile}</Text>
          <Text style={q.sub} numberOfLines={1}>{m.tileSub}</Text>
          {price ? <Text style={[q.price, wide ? null : { marginTop: 'auto', paddingTop: 6 }]} numberOfLines={1}>{price}</Text> : null}
        </View>
        {wide ? <View style={{ paddingRight: 12 }}><IChevronRight size={18} color={TV.faint} strokeWidth={1.8} /></View> : null}
      </Press>
    </FadeIn>
  );
}

function QuickCategories({ prices }: { prices: Record<string, number> }) {
  const w = usePageW();
  const tileW = Math.floor((w - 32 - 10) / 2);
  const from = (s: ShelfId) => {
    const v = prices[SHELF_META[s].minKey];
    if (!v) return null;
    // The ₹99 on repairs is the doorstep inspection (the partner's quote replaces it), so it is not a "from" price.
    return s === 'repairs' ? `${formatINR(v)} inspection` : `From ${formatINR(v)}`;
  };
  return (
    <View style={{ marginTop: 24 }}>
      <SectionHead title="Quick categories" />
      <View style={q.grid}>
        {ALL_SHELVES.slice(0, 4).map((s, i) => <CategoryTile key={s} s={s} i={i} tileW={tileW} price={from(s)} />)}
        <CategoryTile s={ALL_SHELVES[4]} i={4} wide tileW={tileW} price={from(ALL_SHELVES[4])} />
      </View>
    </View>
  );
}

/** Alternate the shelves so the row shows a mix, keeping each shelf's own order. */
function interleave(lists: ShelfItem[][], max: number) {
  const out: ShelfItem[] = [];
  for (let i = 0; out.length < max && lists.some((l) => l.length > i); i++) {
    for (const l of lists) if (l[i] && out.length < max) out.push(l[i]);
  }
  return out;
}

function ServiceCard({ shelf, item }: { shelf: 'repairs' | 'tailoring' | 'laundry'; item: ShelfItem }) {
  const router = useRouter();
  const pl = priceLine(shelf, item);
  return (
    <Press onPress={() => router.push(detailPath(shelf, item.id) as any)} label={`${item.name}, ${pl.main}${pl.note ? ` ${pl.note}` : ''}. Opens details.`} style={[c.card, shadow(1)]} scaleTo={0.97}>
      <View style={c.photo}>
        <ItemPhoto shelf={shelf} item={item} maxWidth={168} />
      </View>
      <View style={{ padding: 10, flex: 1 }}>
        <Text style={c.kind} numberOfLines={1}>{SHELF_META[shelf].tile}</Text>
        <Text style={c.name} numberOfLines={2}>{item.name}</Text>
        <Text style={c.price} numberOfLines={1}>{pl.main}{pl.note ? <Text style={c.note}> {pl.note}</Text> : null}</Text>
      </View>
    </Press>
  );
}

function ProductCard({ shelf, item, store }: { shelf: 'mattresses' | 'electronics'; item: ShelfItem; store: any }) {
  const router = useRouter();
  const basket = useStoreBasket();
  const line = basket.lineFor(item.id);
  return (
    <Press onPress={() => router.push(`/products/${item.id}` as any)} label={`${item.name}, ${formatINR(item.price)}. Opens the product.`} style={[c.card, shadow(1)]} scaleTo={0.97}>
      <View style={c.photo}>
        <ItemPhoto shelf={shelf} item={item} maxWidth={168} />
      </View>
      <View style={{ padding: 10, flex: 1 }}>
        <Text style={c.kind} numberOfLines={1}>{SHELF_META[shelf].tile}</Text>
        <Text style={c.name} numberOfLines={2}>{item.name}</Text>
        <View style={c.foot}>
          <Text style={[c.price, { marginTop: 0, flex: 1 }]} numberOfLines={1}>{formatINR(item.price)}</Text>
          {line ? (
            <Stepper qty={line.quantity} name={item.name} onMinus={() => basket.setQty(line.cartKey, line.quantity - 1)} onPlus={() => basket.setQty(line.cartKey, line.quantity + 1)} />
          ) : (
            <BookPill label="Add" onPress={() => basket.add(item, store, SHELF_META[shelf].title)} a11y={`Add ${item.name} to the Groceries basket`} />
          )}
        </View>
      </View>
    </Press>
  );
}

export function ServicesV2HomeBody({ sections, onSection }: { sections?: Sections; onSection?: (k: string) => void }) {
  const router = useRouter();
  const prices = useMinPrices();
  const repairs = useShelf('repairs');
  const tailoring = useShelf('tailoring');
  const laundry = useShelf('laundry');
  const room = useShelf('mattresses');
  const gadgets = useShelf('electronics');
  const [refreshing, setRefreshing] = useState(false);

  const bookable = (l: ShelfItem[]) => l.filter((i) => i.inStock);
  const services = useMemo(() => {
    const tag = (shelf: 'repairs' | 'tailoring' | 'laundry', l: ShelfItem[]) => bookable(l).map((item) => ({ shelf, item }));
    const lists = [tag('repairs', repairs.items), tag('tailoring', tailoring.items), tag('laundry', laundry.items)];
    const out: { shelf: 'repairs' | 'tailoring' | 'laundry'; item: ShelfItem }[] = [];
    for (let i = 0; out.length < 8 && lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i] && out.length < 8) out.push(l[i]);
    return out;
  }, [repairs.items, tailoring.items, laundry.items]);
  const products = useMemo(() => {
    const r = interleave([bookable(room.items.filter((i) => i.orderable)), bookable(gadgets.items.filter((i) => i.orderable))], 8);
    return r.map((item) => (room.items.includes(item) ? { shelf: 'mattresses' as const, item, store: room.stores[item.storeId] } : { shelf: 'electronics' as const, item, store: gadgets.stores[item.storeId] }));
  }, [room.items, gadgets.items, room.stores, gadgets.stores]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await Promise.all([repairs, tailoring, laundry, room, gadgets].map((s) => s.reload('refresh'))); } finally { setRefreshing(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: TV.page }} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C7CAFF" colors={[TV.accent]} progressViewOffset={60} />}>
      <HomeTop sections={sections} onSection={onSection} />

      <FadeIn style={{ marginTop: 16 }}>
        <HeroCard photo={HOME_HERO} title={SHELF_META.repairs.heroTitle} line="A technician checks your device in your hostel and confirms the price before any work." trust={SHELF_TRUST.repairs}
          /* No repair partner live yet -> no "Book a repair" button (it opened an empty Coming soon page). */
          cta={repairs.status === 'ready' && !bookable(repairs.items).length ? undefined : 'Book a repair'}
          onCta={() => router.push(shelfPath('repairs') as any)} />
      </FadeIn>

      <QuickCategories prices={prices} />

      {services.length ? (
        <View style={{ marginTop: 26 }}>
          <SectionHead title="Book a service" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={c.rail}>
            {services.map(({ shelf, item }) => <ServiceCard key={`${shelf}-${item.id}`} shelf={shelf} item={item} />)}
          </ScrollView>
        </View>
      ) : null}

      {products.length ? (
        <View style={{ marginTop: 26 }}>
          <SectionHead title="From the campus store" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={c.rail}>
            {products.map(({ shelf, item, store }) => <ProductCard key={`${shelf}-${item.id}`} shelf={shelf} item={item} store={store} />)}
          </ScrollView>
        </View>
      ) : null}

      <Press onPress={() => openMyBookings(router)} label="My service bookings, track and manage" style={[h.mine, shadow(1)]} scaleTo={0.985}>
        <View style={h.mineIcon}><IReceipt size={19} color={TV.accent} strokeWidth={1.7} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={h.mineTitle}>My bookings</Text>
          <Text style={h.mineSub} numberOfLines={1}>Track repairs, tailoring and laundry</Text>
        </View>
        <IChevronRight size={18} color={TV.faint} strokeWidth={1.8} />
      </Press>
    </ScrollView>
  );
}

/** Others → Tech & repairs. */
function ServicesV2Home({ sections, onSection }: { sections?: Sections; onSection?: (key: string) => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: TV.page }}>
      <ServicesV2HomeBody sections={sections} onSection={onSection} />
    </View>
  );
}
export default React.memo(ServicesV2Home);

const h = themedSheet(() => ({
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 16, paddingTop: 12 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  brand: { color: TV.onBand, fontSize: 21, fontWeight: W.title, letterSpacing: 0.2, lineHeight: 25 },
  brandSub: { color: TV.onBandSub, fontSize: 12.5, marginTop: 1, letterSpacing: 0.2 },
  dot: { position: 'absolute', top: 10, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: TV.bellDot, borderWidth: 1.5, borderColor: TV.header[1] },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, marginHorizontal: 16, marginTop: 14, borderRadius: 24, backgroundColor: TV.card, paddingHorizontal: 16, borderWidth: 1, borderColor: TV.line },
  searchText: { flex: 1, fontSize: 14, color: TV.sub },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 26, padding: 12, borderRadius: RADIUS.lg, backgroundColor: TV.card },
  mineIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: TV.accentSoft, alignItems: 'center', justifyContent: 'center' },
  mineTitle: { fontSize: 14.5, color: TV.ink, fontWeight: W.title },
  mineSub: { fontSize: 12, color: TV.sub, marginTop: 2 },
}));

const q = themedSheet(() => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  tile: { borderRadius: RADIUS.lg, backgroundColor: TV.card, overflow: 'hidden' },
  tileWide: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { height: 96, backgroundColor: TV.plate },
  photoWide: { width: 118, alignSelf: 'stretch', minHeight: 84, backgroundColor: TV.plate },
  title: { fontSize: 14, lineHeight: 18, color: TV.ink, fontWeight: W.title },
  sub: { fontSize: 12, color: TV.sub, marginTop: 2 },
  price: { fontSize: 12.5, color: TV.accentDeep, fontWeight: W.label, marginTop: 6 },
}));

const c = themedSheet(() => ({
  rail: { paddingHorizontal: 16, gap: 10, paddingBottom: 6 },
  card: { width: 168, borderRadius: RADIUS.lg, backgroundColor: TV.card, overflow: 'hidden' },
  photo: { height: 104, backgroundColor: TV.plate },
  kind: { fontSize: 11, color: TV.accentDeep, fontWeight: W.label },
  name: { fontSize: 13.5, lineHeight: 18, color: TV.ink, fontWeight: W.title, marginTop: 3, minHeight: 36 },
  price: { fontSize: 13.5, color: TV.ink, fontWeight: W.title, marginTop: 6 },
  note: { fontSize: 11.5, color: TV.sub, fontWeight: W.body },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
}));
