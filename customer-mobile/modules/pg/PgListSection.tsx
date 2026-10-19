/**
 * Others > PG stays. Top to bottom: title and search, the featured carousel (admin promotions), rails
 * shown only when they have PGs (Room tours, Near campus, Verified, New on Zenvy, Under ₹6,000, For girls,
 * For boys), then "All PGs" with one Filters button and a sort (a bottom sheet: residents, budget,
 * distance, AC, food included; nearest / lowest rent / newest) and the result count.
 * While searching, the carousel and rails step aside and only matching PGs are listed.
 * Data and refresh stay in the Others tab (GET /api/pg/home, live-synced); this component presents it.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Modal, Linking, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ZENVY_SUPPORT_WHATSAPP } from '../../constants/api';
import { genderKey, plural, type PgHome, type PgListItem, type PgPromotion } from './pgApi';
import { PgListCard, PgListSkeleton } from './PgListCard';
import { FeaturedCarousel, ToursRail, PgRail } from './PgHomeParts';
import { VideoModal } from './PgVideos';
import { usePgPalette, Press, StateMessage, IconAlert, IconBuilding, IconX, IconSliders, IconSearch, ICON, TYPE, s as ui } from './ui';

type Opt = { key: string; label: string };
const GENDER: Opt[] = [{ key: 'All', label: 'All' }, { key: 'Boys', label: 'Boys' }, { key: 'Girls', label: 'Girls' }, { key: 'Co-ed', label: 'Co-living' }];
const BUDGET: Opt[] = [{ key: 'All', label: 'Any' }, { key: '6000', label: 'Up to ₹6,000' }, { key: '8000', label: 'Up to ₹8,000' }, { key: '10000', label: 'Up to ₹10,000' }, { key: '15000', label: 'Up to ₹15,000' }];
const DISTANCE: Opt[] = [{ key: 'All', label: 'Any' }, { key: '1', label: 'Within 1 km' }, { key: '3', label: 'Within 3 km' }, { key: '5', label: 'Within 5 km' }];
type SortKey = 'near' | 'price' | 'new';
const SORT: { key: SortKey; label: string }[] = [{ key: 'near', label: 'Nearest to campus' }, { key: 'price', label: 'Lowest rent' }, { key: 'new', label: 'Newest' }];

interface Filters { gender: string; budget: string; distance: string; ac: boolean; food: boolean; sort: SortKey }
const NO_FILTERS: Filters = { gender: 'All', budget: 'All', distance: 'All', ac: false, food: false, sort: 'near' };
const filterCount = (f: Filters) => [f.gender !== 'All', f.budget !== 'All', f.distance !== 'All', f.ac, f.food].filter(Boolean).length;

const rentOf = (x: PgListItem) => Number(x.rentFrom ?? x.baseRent) || Infinity;
const applyFilters = (pgs: PgListItem[], f: Filters, query: string) => {
  const q = query.trim().toLowerCase();
  const list = pgs.filter((x) => {
    if (q && ![x.name, x.address, x.area].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    if (f.gender !== 'All' && genderKey(x.genderType) !== f.gender) return false;
    if (f.budget !== 'All' && rentOf(x) > Number(f.budget)) return false;
    if (f.distance !== 'All' && Number(x.distanceFromCollege) > Number(f.distance)) return false;
    if (f.ac && !x.hasAC) return false;
    if (f.food && !x.foodIncluded) return false;
    return true;
  });
  const t = (x: PgListItem) => (x.createdAt ? new Date(x.createdAt).getTime() : 0);
  if (f.sort === 'price') list.sort((a, b) => rentOf(a) - rentOf(b));
  else if (f.sort === 'new') list.sort((a, b) => t(b) - t(a));
  else list.sort((a, b) => Number(a.distanceFromCollege) - Number(b.distanceFromCollege));
  return list;
};

export function PgListSection({ pgs, home, loading, error, onRetry }: { pgs: PgListItem[]; home?: PgHome | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const p = usePgPalette();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sheet, setSheet] = useState(false);
  const [playing, setPlaying] = useState<{ video: { youtubeId: string; embedUrl: string; watchUrl: string }; title: string; subtitle?: string } | null>(null);

  const list = useMemo(() => applyFilters(pgs, filters, query), [pgs, filters, query]);
  const byId = useMemo(() => new Map(pgs.map((x) => [x.id, x])), [pgs]);
  const searching = query.trim() !== '';
  const nFilters = filterCount(filters);
  const reset = () => { setQuery(''); setFilters(NO_FILTERS); };
  const open = (id: string) => router.push(`/pg/${id}` as any);
  const bookVisit = (x: PgPromotion) => {
    const name = x.pg?.name || 'this PG';
    Linking.openURL(`https://wa.me/${ZENVY_SUPPORT_WHATSAPP.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, I'd like to visit ${name}. When can I come?`)}`)
      .catch(() => Alert.alert('WhatsApp is not available', 'Please try again later.'));
  };

  const showDiscovery = !searching && !!home && pgs.length > 0;
  const rails = showDiscovery ? home!.rails.map((r) => ({ ...r, items: r.ids.map((id) => byId.get(id)).filter(Boolean) as PgListItem[] })).filter((r) => r.items.length) : [];

  return (
    <View style={{ paddingTop: 8 }}>
      <View style={st.pad}>
        <Text style={[st.title, { color: p.text }]} accessibilityRole="header">PG stays</Text>
        <View style={[st.search, { backgroundColor: p.sunken }]}>
          <IconSearch size={ICON.size} color={p.muted} strokeWidth={ICON.stroke} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or area"
            placeholderTextColor={p.muted}
            style={[st.input, { color: p.text }]}
            returnKeyType="search"
            accessibilityLabel="Search PGs by name or area"
          />
          {query ? (
            <Press onPress={() => setQuery('')} accessibilityLabel="Clear search" style={st.clear}>
              <IconX size={16} color={p.muted} strokeWidth={ICON.stroke} />
            </Press>
          ) : null}
        </View>
      </View>

      {showDiscovery && home!.promotions.length ? (
        <View style={{ marginTop: 24 }}>
          <FeaturedCarousel
            promos={home!.promotions}
            onOpenPg={open}
            onPlay={(x) => x.video && setPlaying({ video: x.video, title: x.headline, subtitle: x.pg?.name })}
            onBookVisit={bookVisit}
          />
        </View>
      ) : null}
      {showDiscovery ? <ToursRail tours={home!.tours} onPlay={(t) => setPlaying({ video: t.video, title: t.video.title || 'Room tour', subtitle: t.pgName })} /> : null}
      {rails.map((r) => <PgRail key={r.key} title={r.title} items={r.items} onOpen={open} />)}

      <View style={[st.pad, { marginTop: showDiscovery && (rails.length || home!.promotions.length || home!.tours.length) ? 32 : 16 }]}>
        <View style={st.listHead}>
          <View style={{ flex: 1 }}>
            <Text style={[st.heading, { color: p.text }]} accessibilityRole="header">{searching ? 'Results' : 'All PGs'}</Text>
            <Text style={[ui.small, { color: p.muted, marginTop: 2 }]} accessibilityLiveRegion="polite">
              {loading && !pgs.length ? 'Loading' : error && !pgs.length ? ' ' : `${plural(list.length, 'PG')} · ${SORT.find((s) => s.key === filters.sort)!.label.toLowerCase()}`}
            </Text>
          </View>
          <Press onPress={() => setSheet(true)} disabled={!pgs.length} accessibilityLabel={`Filters and sort${nFilters ? `, ${nFilters} applied` : ''}`} style={[st.filterBtn, { borderColor: nFilters ? p.text : p.line }]}>
            <IconSliders size={16} color={p.text} strokeWidth={ICON.stroke} />
            <Text style={[ui.btnLabel, { color: p.text }]}>{nFilters ? `Filters · ${nFilters}` : 'Filters'}</Text>
          </Press>
        </View>

        {loading && !pgs.length ? (
          <PgListSkeleton />
        ) : error && !pgs.length ? (
          <StateMessage icon={<IconAlert size={28} color={p.muted} strokeWidth={ICON.stroke} />} title="Couldn't load PGs" body={error} actionLabel="Try again" onAction={onRetry} />
        ) : !pgs.length ? (
          <StateMessage icon={<IconBuilding size={28} color={p.muted} strokeWidth={ICON.stroke} />} title="No PGs listed yet" body="The housing team is adding stays near campus. Pull down to check again." />
        ) : !list.length ? (
          <StateMessage title={searching ? 'No PGs match your search' : 'No PGs match these filters'} body={searching ? 'Try another name or area.' : 'Try a higher budget or a longer distance.'} actionLabel="Clear all" onAction={reset} />
        ) : (
          list.map((pg) => <PgListCard key={pg.id} pg={pg} onPress={() => open(pg.id)} />)
        )}
      </View>

      {sheet ? <FilterSheet value={filters} pgs={pgs} query={query} onClose={() => setSheet(false)} onApply={(f) => { setFilters(f); setSheet(false); }} /> : null}
      {playing ? <VideoModal video={playing.video} title={playing.title} subtitle={playing.subtitle} onClose={() => setPlaying(null)} /> : null}
    </View>
  );
}

// ── Filters + sort (bottom sheet; Android back closes it) ─────────────────────────────────────
function FilterSheet({ value, pgs, query, onClose, onApply }: { value: Filters; pgs: PgListItem[]; query: string; onClose: () => void; onApply: (f: Filters) => void }) {
  const p = usePgPalette();
  const insets = useSafeAreaInsets();
  const [f, setF] = useState<Filters>(value);
  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));
  const count = applyFilters(pgs, f, query).length;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={st.backdrop}>
        <Press onPress={onClose} accessibilityLabel="Close filters" style={{ flex: 1 }}><View /></Press>
        <View style={[st.sheet, { backgroundColor: p.bg, paddingBottom: insets.bottom + 16 }]}>
          <View style={[st.grabber, { backgroundColor: p.line }]} />
          <View style={st.sheetHead}>
            <Text style={[st.heading, { color: p.text, flex: 1 }]} accessibilityRole="header">Filters and sort</Text>
            <Press onPress={() => setF({ ...NO_FILTERS, sort: f.sort })} disabled={!filterCount(f)} accessibilityLabel="Clear filters" style={st.textBtn}>
              <Text style={[ui.body, { color: p.text, fontWeight: '600' }]}>Clear</Text>
            </Press>
          </View>
          <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
            <Group label="Sort by"><Options options={SORT} value={f.sort} onChange={(k) => set({ sort: k as SortKey })} /></Group>
            <Group label="Residents"><Options options={GENDER} value={f.gender} onChange={(k) => set({ gender: k })} /></Group>
            <Group label="Rent per month"><Options options={BUDGET} value={f.budget} onChange={(k) => set({ budget: k })} /></Group>
            <Group label="Distance from campus"><Options options={DISTANCE} value={f.distance} onChange={(k) => set({ distance: k })} /></Group>
            <Group label="Must have">
              <Options
                options={[{ key: 'ac', label: 'AC rooms' }, { key: 'food', label: 'Food included in rent' }]}
                multi={{ ac: f.ac, food: f.food }}
                onChange={(k) => set(k === 'ac' ? { ac: !f.ac } : { food: !f.food })}
              />
            </Group>
          </ScrollView>
          <Press onPress={() => onApply(f)} accessibilityLabel={`Show ${plural(count, 'PG')}`} style={[st.primary, { backgroundColor: p.accentFill }]}>
            <Text style={[ui.btnLabel, { color: '#fff' }]}>{count ? `Show ${plural(count, 'PG')}` : 'No PGs match'}</Text>
          </Press>
        </View>
      </View>
    </Modal>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const p = usePgPalette();
  return (
    <View style={{ marginTop: 24 }}>
      <Text style={[ui.small, { color: p.muted, marginBottom: 8 }]}>{label}</Text>
      {children}
    </View>
  );
}

function Options({ options, value, multi, onChange }: { options: { key: string; label: string }[]; value?: string; multi?: Record<string, boolean>; onChange: (k: string) => void }) {
  const p = usePgPalette();
  return (
    <View style={st.options}>
      {options.map((o) => {
        const on = multi ? !!multi[o.key] : o.key === value;
        return (
          <Press key={o.key} onPress={() => onChange(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            style={[st.chip, { borderColor: on ? p.text : p.line, backgroundColor: on ? p.text : 'transparent' }]}>
            <Text style={[ui.body, { color: on ? p.bg : p.text, fontWeight: on ? '600' : '400' }]}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  pad: { paddingHorizontal: 16 },
  title: { fontSize: TYPE.title, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: TYPE.heading, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingLeft: 12, marginTop: 12, minHeight: 44 },
  input: { flex: 1, fontSize: TYPE.body, paddingVertical: 10 },
  clear: { alignItems: 'center', justifyContent: 'center' },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  textBtn: { justifyContent: 'center', paddingHorizontal: 4 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
});
