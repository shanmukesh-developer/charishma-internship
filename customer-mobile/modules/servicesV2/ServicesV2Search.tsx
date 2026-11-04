/**
 * Tech & repairs v2 · search (the home header's search): one box over every shelf of the section (repairs,
 * tailoring, laundry, room essentials, chargers & gadgets), results grouped by shelf. Services open their details
 * ("Book" opens the booking flow), products open the product page or go into the campus store basket.
 * Route: app/services/search.tsx.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TV, W } from './servicesV2Theme';
import { BasketBar, FadeIn, Press, SearchField, SectionHead, StateBlock, TopBar } from './ServicesV2Kit';
import { ProductRow, ServiceRow } from './ServicesV2Rows';
import { IChevronRight } from './ServicesV2Icons';
import { SHELF_META, detailPath, matchesQuery, shelfPath, storeTakesOrders, useShelf, type ProductShelf, type ServiceShelf } from './servicesV2Data';
import { useServicesV2Booking } from './useServicesV2Booking';
import { useStoreBasket } from './useStoreBasket';


type Shelf = ReturnType<typeof useShelf>;

function ServiceGroup({ shelf, data, q }: { shelf: ServiceShelf; data: Shelf; q: string }) {
  const router = useRouter();
  const { book, sheet } = useServicesV2Booking(shelf, data.items, () => data.reload('silent'));
  const hits = useMemo(() => (q.trim() ? data.items.filter((i) => matchesQuery(i, q)) : []), [data.items, q]);
  const multi = new Set(data.items.map((i) => i.storeName)).size > 1;
  return (
    <>
      {hits.length ? (
        <View style={{ marginTop: 20 }}>
          <SectionHead title={SHELF_META[shelf].title} link="Open" onLink={() => router.push(shelfPath(shelf) as any)} />
          <View style={{ gap: 10 }}>
            {hits.map((it, i) => (
              <FadeIn key={it.id} index={i}><ServiceRow shelf={shelf} item={it} showStore={multi} onOpen={() => router.push(detailPath(shelf, it.id) as any)} onBook={() => book(it)} /></FadeIn>
            ))}
          </View>
        </View>
      ) : null}
      {sheet}
    </>
  );
}

function ProductGroup({ shelf, data, q }: { shelf: ProductShelf; data: Shelf; q: string }) {
  const router = useRouter();
  const basket = useStoreBasket();
  const hits = useMemo(() => (q.trim() ? data.items.filter((i) => matchesQuery(i, q)) : []), [data.items, q]);
  if (!hits.length) return null;
  return (
    <View style={{ marginTop: 20 }}>
      <SectionHead title={SHELF_META[shelf].title} link="Open" onLink={() => router.push(shelfPath(shelf) as any)} />
      <View style={{ gap: 10 }}>
        {hits.map((it, i) => {
          const line = basket.lineFor(it.id);
          const store = data.stores[it.storeId];
          return (
            <FadeIn key={it.id} index={i}>
              <ProductRow shelf={shelf} item={it} qty={line?.quantity || 0} storeClosed={!storeTakesOrders(store)}
                onOpen={() => router.push(`/products/${it.id}` as any)} onAdd={() => basket.add(it, store, SHELF_META[shelf].title)}
                onMinus={() => line && basket.setQty(line.cartKey, line.quantity - 1)} onPlus={() => line && basket.setQty(line.cartKey, line.quantity + 1)} />
            </FadeIn>
          );
        })}
      </View>
    </View>
  );
}

export default function ServicesV2Search() {
  const insets = useSafeAreaInsets();
  const basket = useStoreBasket();
  const router = useRouter();
  const [q, setQ] = useState('');
  const repairs = useShelf('repairs');
  const tailoring = useShelf('tailoring');
  const laundry = useShelf('laundry');
  const room = useShelf('mattresses');
  const gadgets = useShelf('electronics');
  const all = [repairs, tailoring, laundry, room, gadgets];
  const loading = all.some((d) => d.status === 'loading');
  // "Try" chips from what is really listed (the fixed Screen / Jeans / Mattress... found nothing with no partners
  // yet): a few short item names; no chips at all while nothing is listed.
  const suggest = (() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const d of all) for (const i of d.items) {
      const n = String(i.name || '').trim();
      if (!n || n.length > 18 || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      out.push(n);
      if (out.length >= 6) return out;
    }
    return out;
  })();
  const nothingListed = !loading && all.every((d) => d.items.length === 0);
  const any = !!q.trim() && all.some((d) => d.items.some((i) => matchesQuery(i, q)));
  return (
    <View style={{ flex: 1, backgroundColor: TV.page }}>
      <TopBar title="Search Tech & repairs">
        <SearchField value={q} onChange={setQ} placeholder="Repairs, tailoring, laundry, gadgets" autoFocus style={{ marginTop: 6 }} />
      </TopBar>
      <ScrollView contentContainerStyle={{ paddingBottom: (basket.count > 0 ? 110 : 40) + insets.bottom }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!q.trim() && nothingListed ? (
          <StateBlock kind="empty" title="Coming soon to ZENV" body="Repairs, tailoring, laundry and gadgets will be bookable here as partners join." style={{ marginTop: 18 }} />
        ) : !q.trim() && suggest.length > 0 ? (
          <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
            <Text style={s.hint}>Try</Text>
            <View style={s.suggest}>
              {suggest.map((t) => (
                <Press key={t} onPress={() => setQ(t)} label={`Search ${t}`} style={s.sChip} scaleTo={0.95}>
                  <Text style={s.sChipText}>{t}</Text>
                  <IChevronRight size={13} color={TV.faint} strokeWidth={1.8} />
                </Press>
              ))}
            </View>
          </View>
        ) : null}
        <ServiceGroup shelf="repairs" data={repairs} q={q} />
        <ServiceGroup shelf="tailoring" data={tailoring} q={q} />
        <ServiceGroup shelf="laundry" data={laundry} q={q} />
        <ProductGroup shelf="mattresses" data={room} q={q} />
        <ProductGroup shelf="electronics" data={gadgets} q={q} />
        {q.trim() && !any && !loading ? (
          <StateBlock kind="search" title={`No results for “${q.trim()}”`} body="Check the spelling or try a shorter word." action="Clear search" onAction={() => setQ('')} style={{ marginTop: 18 }} />
        ) : null}
      </ScrollView>
      <BasketBar count={basket.count} total={basket.total} onPress={() => router.push('/(tabs)/basket?basket=store' as any)} />
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 13, color: TV.sub, marginBottom: 10 },
  suggest: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: TV.card, borderWidth: 1, borderColor: TV.line },
  sChipText: { fontSize: 13, color: TV.ink2, fontWeight: W.label },
});
