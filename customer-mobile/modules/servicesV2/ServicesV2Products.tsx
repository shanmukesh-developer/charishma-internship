/**
 * Tech & repairs v2 · product list (board "Hostel Essentials" / "Electronics & Accessories"): navy bar with back and
 * search, the hero, filter chips worked out from the real products, one row per catalogue product with its price
 * (and the server's struck-through price when it sends one) and "Add" / a stepper for the campus store basket, and
 * the basket bar. Route: app/category/[id].tsx for mattresses (Room essentials) and electronics (Chargers & gadgets).
 */
import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NightClosureBanner from '../../components/NightClosureBanner';
import FssaiLine from '../../components/FssaiLine';
import { formatClock, plural } from '../../utils/format';
import { TV, RADIUS, W } from './servicesV2Theme';
import { BarIcon, BasketBar, ChipRow, FadeIn, HeroCard, SearchField, SkeletonRows, StateBlock, TopBar } from './ServicesV2Kit';
import { ProductRow } from './ServicesV2Rows';
import { IClock, ISearch, IBag } from './ServicesV2Icons';
import { SHELF_HERO } from './servicesV2Art';
import { SHELF_META, chipsFor, matchesQuery, storeTakesOrders, useShelf, type ProductShelf } from './servicesV2Data';
import { useStoreBasket } from './useStoreBasket';
import { themedSheet } from '../../utils/themeNow';

export default function ServicesV2Products({ shelf }: { shelf: ProductShelf }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const meta = SHELF_META[shelf];
  const { items, stores, status, refreshing, reload, retry } = useShelf(shelf);
  const basket = useStoreBasket();
  const [chip, setChip] = useState('all');
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');

  const chips = useMemo(() => chipsFor(shelf, items), [shelf, items]);
  const active = chips.find((c) => c.key === chip) || chips[0];
  const shown = useMemo(() => items.filter((i) => active.test(i) && matchesQuery(i, q)), [items, active, q]);
  const closedStore = useMemo(() => Object.values(stores).find((s) => !storeTakesOrders(s) && !s.campusClosed) || null, [stores]);
  const opens = closedStore?.opensAt && /^\d{1,2}:\d{2}$/.test(closedStore.opensAt) ? formatClock(closedStore.opensAt) : null;

  return (
    <View style={{ flex: 1, backgroundColor: TV.page }}>
      <TopBar
        title={meta.title}
        right={(
          <>
            <BarIcon onPress={() => { setSearching((v) => !v); if (searching) setQ(''); }} label={searching ? 'Close search' : `Search ${meta.title}`}><ISearch size={21} color={TV.onBand} strokeWidth={1.7} /></BarIcon>
            <BarIcon onPress={() => router.push('/(tabs)/basket?basket=store' as any)} label="Groceries basket"><IBag size={21} color={TV.onBand} strokeWidth={1.7} /></BarIcon>
          </>
        )}
      >
        {searching ? <SearchField value={q} onChange={setQ} placeholder={`Search ${meta.tile.toLowerCase()}`} autoFocus onClose={() => setSearching(false)} style={{ marginTop: 6 }} /> : null}
      </TopBar>

      <ScrollView
        contentContainerStyle={{ paddingTop: 14, paddingBottom: (basket.count > 0 ? 110 : 40) + insets.bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => reload('refresh')} tintColor={TV.accent} colors={[TV.accent]} />}
      >
        <FadeIn><HeroCard photo={SHELF_HERO[shelf]} title={meta.heroTitle} line={meta.heroLine} /></FadeIn>

        <NightClosureBanner style={{ marginTop: 12, marginBottom: 0 }} />
        {closedStore ? (
          <View style={p.closed}>
            <IClock size={17} color={TV.amber} strokeWidth={1.8} />
            <Text style={p.closedText}>{closedStore.closedReason || `${closedStore.name || 'This store'} is closed${opens ? ` and opens at ${opens}` : ''}. You can browse now and order when it opens.`}</Text>
          </View>
        ) : null}

        <ChipRow items={chips} active={active.key} onSelect={setChip} style={{ marginTop: 16 }} />

        {status === 'loading' && !items.length ? (
          <View style={{ marginTop: 16 }}><SkeletonRows /></View>
        ) : status !== 'ready' && !items.length ? (
          <StateBlock kind={status === 'offline' ? 'offline' : status === 'waking' ? 'waking' : 'error'} action="Try again" onAction={retry} style={{ marginTop: 16 }} />
        ) : !items.length ? (
          <StateBlock kind="empty" title="Nothing on this shelf yet" body="New items are added often." style={{ marginTop: 16 }} />
        ) : !shown.length ? (
          <StateBlock kind="search" title={q ? `No results for “${q.trim()}”` : 'Nothing in this filter'} body={q ? 'Check the spelling or try a shorter word.' : 'Pick another filter to see more.'} action={q ? 'Clear search' : 'Show all'} onAction={() => (q ? setQ('') : setChip('all'))} style={{ marginTop: 16 }} />
        ) : (
          <>
            <Text style={p.count}>{plural(shown.length, 'item')}</Text>
            <View style={{ gap: 10 }}>
              {shown.map((it, i) => {
                const line = basket.lineFor(it.id);
                const store = stores[it.storeId];
                return (
                  <FadeIn key={it.id} index={i}>
                    <ProductRow
                      shelf={shelf}
                      item={it}
                      qty={line?.quantity || 0}
                      storeClosed={!storeTakesOrders(store)}
                      onOpen={() => router.push(`/products/${it.id}` as any)}
                      onAdd={() => basket.add(it, store, meta.title)}
                      onMinus={() => line && basket.setQty(line.cartKey, line.quantity - 1)}
                      onPlus={() => line && basket.setQty(line.cartKey, line.quantity + 1)}
                    />
                  </FadeIn>
                );
              })}
            </View>
            <View style={{ paddingTop: 14 }}>
              {/* FSSAI line only when the server sends a licence number (these shelves are not food). */}
              {Object.values(stores).filter((st) => st.fssaiLicenseNumber).map((st) => (
                <FssaiLine key={st.id} number={st.fssaiLicenseNumber} storeName={Object.keys(stores).length > 1 ? st.name || undefined : undefined} color={TV.faint} style={{ textAlign: 'center', marginTop: 2 }} />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <BasketBar count={basket.count} total={basket.total} onPress={() => router.push('/(tabs)/basket?basket=store' as any)} />
    </View>
  );
}

const p = themedSheet(() => ({
  closed: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: TV.amberSoft },
  closedText: { flex: 1, fontSize: 13, lineHeight: 18, color: TV.ink2, fontWeight: W.body },
  count: { fontSize: 12.5, color: TV.sub, paddingHorizontal: 18, marginTop: 14, marginBottom: 8 },
}));
