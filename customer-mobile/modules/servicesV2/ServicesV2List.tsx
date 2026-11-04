/**
 * Tech & repairs v2 · service list (board "Tech & Repairs" / "Tailoring & Stitching"): navy bar with back, search
 * and My bookings; the hero with three trust points; filter chips worked out from the real items; one row per
 * catalogue service with its real price and a "Book" pill. Repairs adds "Not sure what is wrong?", which opens
 * the existing device -> issue steps. Route: app/category/[id].tsx for repairs, tailoring and laundry.
 */
import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TV, RADIUS, W, shadow } from './servicesV2Theme';
import { BarIcon, ChipRow, FadeIn, HeroCard, Press, SearchField, SkeletonRows, StateBlock, TopBar } from './ServicesV2Kit';
import { ServiceRow } from './ServicesV2Rows';
import { IChevronRight, IReceipt, ISearch, IWrench } from './ServicesV2Icons';
import { SHELF_HERO } from './servicesV2Art';
import { SHELF_META, SHELF_TRUST, chipsFor, detailPath, matchesQuery, useShelf, type ServiceShelf } from './servicesV2Data';
import { useServicesV2Booking } from './useServicesV2Booking';
import { diagnosisItem } from '../services/serviceFlow';
import { plural } from '../../utils/format';
import { themedSheet } from '../../utils/themeNow';

export const openMyBookings = (router: ReturnType<typeof useRouter>) =>
  router.push({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any);

export default function ServicesV2List({ shelf }: { shelf: ServiceShelf }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const meta = SHELF_META[shelf];
  const { items, status, refreshing, reload, retry } = useShelf(shelf);
  const { book, startDevice, sheet } = useServicesV2Booking(shelf, items, () => reload('silent'));
  const [chip, setChip] = useState('all');
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');

  const chips = useMemo(() => chipsFor(shelf, items), [shelf, items]);
  const active = chips.find((c) => c.key === chip) || chips[0];
  const shown = useMemo(() => items.filter((i) => active.test(i) && matchesQuery(i, q)), [items, active, q]);
  const multiStore = useMemo(() => new Set(items.map((i) => i.storeName)).size > 1, [items]);
  const canDiagnose = shelf === 'repairs' && !!diagnosisItem(items);

  return (
    <View style={{ flex: 1, backgroundColor: TV.page }}>
      <TopBar
        title={meta.title}
        right={(
          <>
            <BarIcon onPress={() => { setSearching((v) => !v); if (searching) setQ(''); }} label={searching ? 'Close search' : `Search ${meta.title}`}><ISearch size={21} color="#FFFFFF" strokeWidth={1.7} /></BarIcon>
            <BarIcon onPress={() => openMyBookings(router)} label="My service bookings"><IReceipt size={21} color="#FFFFFF" strokeWidth={1.7} /></BarIcon>
          </>
        )}
      >
        {searching ? <SearchField value={q} onChange={setQ} placeholder={`Search ${meta.tile.toLowerCase()}`} autoFocus onClose={() => setSearching(false)} style={{ marginTop: 6 }} /> : null}
      </TopBar>

      <ScrollView
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 40 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => reload('refresh')} tintColor={TV.accent} colors={[TV.accent]} />}
      >
        <FadeIn><HeroCard photo={SHELF_HERO[shelf]} title={meta.heroTitle} line={meta.heroLine} trust={SHELF_TRUST[shelf]} /></FadeIn>

        {canDiagnose ? (
          <Press onPress={startDevice} label="Not sure what is wrong? Pick your device and the problem." style={[l.diag, shadow(1)]} scaleTo={0.985}>
            <View style={l.diagIcon}><IWrench size={19} color={TV.accent} strokeWidth={1.7} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={l.diagTitle} numberOfLines={1}>Not sure what is wrong?</Text>
              <Text style={l.diagSub} numberOfLines={2}>Pick your device and the problem. We match it to the right service.</Text>
            </View>
            <IChevronRight size={18} color={TV.faint} strokeWidth={1.8} />
          </Press>
        ) : null}

        <ChipRow items={chips} active={active.key} onSelect={setChip} style={{ marginTop: 16 }} />

        {status === 'loading' && !items.length ? (
          <View style={{ marginTop: 16 }}><SkeletonRows /></View>
        ) : status !== 'ready' && !items.length ? (
          <StateBlock kind={status === 'offline' ? 'offline' : status === 'waking' ? 'waking' : 'error'} action="Try again" onAction={retry} style={{ marginTop: 16 }} />
        ) : !items.length ? (
          <StateBlock kind="empty" title="Coming soon to ZenWe" body="Partners add their services here as they join. Pull down to refresh." style={{ marginTop: 16 }} />
        ) : !shown.length ? (
          <StateBlock kind="search" title={q ? `No results for “${q.trim()}”` : 'Nothing in this filter'} body={q ? 'Check the spelling or try a shorter word.' : 'Pick another filter to see more.'} action={q ? 'Clear search' : 'Show all'} onAction={() => (q ? setQ('') : setChip('all'))} style={{ marginTop: 16 }} />
        ) : (
          <>
            <Text style={l.count}>{plural(shown.length, 'service')}</Text>
            <View style={{ gap: 10 }}>
              {shown.map((it, i) => (
                <FadeIn key={it.id} index={i}>
                  <ServiceRow shelf={shelf} item={it} showStore={multiStore} onOpen={() => router.push(detailPath(shelf, it.id) as any)} onBook={() => book(it)} />
                </FadeIn>
              ))}
            </View>
          </>
        )}

        <Press onPress={() => openMyBookings(router)} label="My service bookings, track and manage" style={[l.mine, shadow(1)]} scaleTo={0.985}>
          <View style={l.diagIcon}><IReceipt size={19} color={TV.accent} strokeWidth={1.7} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={l.diagTitle}>My bookings</Text>
            <Text style={l.diagSub} numberOfLines={1}>Track and manage your service bookings</Text>
          </View>
          <IChevronRight size={18} color={TV.faint} strokeWidth={1.8} />
        </Press>
      </ScrollView>
      {sheet}
    </View>
  );
}

const l = themedSheet(() => ({
  diag: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: RADIUS.lg, backgroundColor: TV.card, borderWidth: 1, borderColor: TV.accentLine },
  diagIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: TV.accentSoft, alignItems: 'center', justifyContent: 'center' },
  diagTitle: { fontSize: 14.5, color: TV.ink, fontWeight: W.title },
  diagSub: { fontSize: 12, color: TV.sub, marginTop: 2, lineHeight: 16 },
  count: { fontSize: 12.5, color: TV.sub, paddingHorizontal: 18, marginTop: 14, marginBottom: 8 },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 22, padding: 12, borderRadius: RADIUS.lg, backgroundColor: TV.card },
}));
