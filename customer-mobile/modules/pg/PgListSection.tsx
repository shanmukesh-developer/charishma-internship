/**
 * Others > PG stays, search-led (clean white cards, blue accent):
 *  Home     title, the search card (area or name, residents Boys / Girls / Both / Co-living, monthly
 *           budget, "Search PGs"), your open booking requests (GET /api/pg/bookings/mine), "Popular near
 *           you" tiles that map to real filters (near campus, budget friendly, food included; a tile
 *           with no PGs is left out), the featured carousel, room tours, rails, "Browse all PGs" and a
 *           card for PG owners (the Zenvy housing desk on WhatsApp lists PGs; there is no self-listing).
 *  Listing  back to home, Sort and Filters (bottom sheets), removable chips for what is applied, the
 *           result count and the listing cards. Android back returns to Home.
 * Data and refresh stay in the Others tab (GET /api/pg/home, live-synced); this component presents it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FadeInUp } from '../others/motion';
import { View, Text, TextInput, ScrollView, StyleSheet, Modal, Linking, Alert, BackHandler, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from 'lucide-react-native';
import { API_URL, ZENVY_SUPPORT_WHATSAPP } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';
import { useAuth } from '../../context/AuthContext';
import { formatISTDate } from '../../utils/format';
import { genderKey, inr, plural, type MyPgBooking, type PgHome, type PgListItem, type PgPromotion } from './pgApi';
import { PgListCard, PgListSkeleton } from './PgListCard';
import { FeaturedCarousel, ToursRail, PgRail } from './PgHomeParts';
import { VideoModal } from './PgVideos';
import {
  usePgPalette, Press, StateMessage, IconAlert, IconBuilding, IconX, IconSliders, IconSearch, IconMapPin, IconChevronDown,
  IconChevronRight, IconArrowLeft, IconSort, IconGraduation, IconWallet, IconUtensils, IconSnowflake, IconHousePlus, IconCheck,
  ICON, TYPE, s as ui,
} from './ui';

type Opt = { key: string; label: string };
// Residents as in the search card. "Both" means any PG (boys, girls or co-living).
const GENDER_SEG: Opt[] = [{ key: 'Boys', label: 'Boys' }, { key: 'Girls', label: 'Girls' }, { key: 'All', label: 'Both' }, { key: 'Co-ed', label: 'Co-living' }];
const GENDER: Opt[] = [{ key: 'All', label: 'Any' }, { key: 'Boys', label: 'Boys' }, { key: 'Girls', label: 'Girls' }, { key: 'Co-ed', label: 'Co-living' }];
const BUDGET: Opt[] = [{ key: 'All', label: 'Any budget' }, { key: '6000', label: 'Up to ₹6,000' }, { key: '8000', label: 'Up to ₹8,000' }, { key: '10000', label: 'Up to ₹10,000' }, { key: '15000', label: 'Up to ₹15,000' }];
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

const desk = (text: string) => `https://wa.me/${ZENVY_SUPPORT_WHATSAPP.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
const openDesk = (text: string) => Linking.openURL(desk(text)).catch(() => Alert.alert('WhatsApp is not available', 'Please try again later.'));

type Tile = { key: string; icon: LucideIcon; title: string; detail: string; filters: Partial<Filters> };

export function PgListSection({ pgs, home, loading, error, onRetry, onRequestTop, focusSearchTick = 0 }: {
  pgs: PgListItem[]; home?: PgHome | null; loading: boolean; error: string | null; onRetry: () => void;
  /** Called after switching between the PG home and the listing, so the parent can scroll the section's top into view. */
  onRequestTop?: () => void;
  /** Bumped by the Others header search: open the PG home and focus "Area or PG name". */
  focusSearchTick?: number;
}) {
  const p = usePgPalette();
  const router = useRouter();
  const { user } = useAuth();
  const [view, setView] = useState<'home' | 'list'>('home');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sheet, setSheet] = useState<'filters' | 'sort' | 'budget' | null>(null);
  const [mine, setMine] = useState<MyPgBooking[]>([]);
  // Waiting requests first, then the latest move-in; two shown until the student taps See all.
  const [mineOpen, setMineOpen] = useState(false);
  const mineSorted = useMemo(() => [...mine].sort((a, b) => {
    const pa = a.status === 'Confirmed' ? 1 : 0;
    const pb = b.status === 'Confirmed' ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return (new Date(b.checkInDate || 0).getTime() || 0) - (new Date(a.checkInDate || 0).getTime() || 0);
  }), [mine]);
  const [playing, setPlaying] = useState<{ video: { youtubeId: string; embedUrl: string; watchUrl: string }; title: string; subtitle?: string } | null>(null);

  const list = useMemo(() => applyFilters(pgs, filters, query), [pgs, filters, query]);
  const byId = useMemo(() => new Map(pgs.map((x) => [x.id, x])), [pgs]);
  const nFilters = filterCount(filters);
  const set = (patch: Partial<Filters>) => setFilters((cur) => ({ ...cur, ...patch }));
  const reset = () => { setQuery(''); setFilters(NO_FILTERS); };
  const open = (id: string) => router.push(`/pg/${id}` as any);
  const showList = () => setView('list');

  const searchRef = useRef<TextInput>(null);
  // Only a press after this screen mounted counts (a remount keeps the last value and must not focus).
  const seenTickRef = useRef(focusSearchTick);
  useEffect(() => {
    if (focusSearchTick === seenTickRef.current) return;
    seenTickRef.current = focusSearchTick;
    setView('home');
    const t = setTimeout(() => searchRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [focusSearchTick]);

  // Home <-> listing: ask the parent (Others scroll view) to bring the section's top back into view.
  const firstViewRef = useRef(true);
  const requestTopRef = useRef(onRequestTop);
  requestTopRef.current = onRequestTop;
  useEffect(() => {
    if (firstViewRef.current) { firstViewRef.current = false; return; }
    requestTopRef.current?.();
  }, [view]);

  // Android back: Listing -> Home.
  useEffect(() => {
    if (view !== 'list' || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setView('home'); return true; });
    return () => sub.remove();
  }, [view]);

  // Your open booking requests (signed in only).
  const userKey = (user as any)?.id || (user as any)?._id || null;
  const loadMine = useCallback(async () => {
    if (!userKey) { setMine([]); return; }
    try {
      const res = await apiFetch(`${API_URL}/api/pg/bookings/mine`);
      const data = res.ok ? await readJson(res) : null;
      if (Array.isArray(data)) setMine(data.filter((b: MyPgBooking) => b.status === 'Pending' || b.status === 'Confirmed'));
    } catch { /* non-critical */ }
  }, [userKey]);
  useEffect(() => { loadMine(); }, [loadMine, pgs]);

  const bookVisit = (x: PgPromotion) => openDesk(`Hi, I'd like to visit ${x.pg?.name || 'this PG'}. When can I come?`);

  // "Popular near you": real filters with real counts; a tile with no PGs is left out.
  const tiles = useMemo<Tile[]>(() => {
    const count = (f: Partial<Filters>) => applyFilters(pgs, { ...NO_FILTERS, ...f }, '').length;
    const out: Tile[] = [];
    const nearKm = count({ distance: '1' }) ? '1' : '3';
    const near = count({ distance: nearKm });
    // Named by its distance: the "Near campus" rail below is a different list (within 2 km).
    if (near) out.push({ key: 'near', icon: IconGraduation, title: `Within ${nearKm} km`, detail: plural(near, 'PG'), filters: { distance: nearKm, sort: 'near' } });
    const budgetKey = count({ budget: '6000' }) ? '6000' : '8000';
    const cheap = count({ budget: budgetKey });
    if (cheap) out.push({ key: 'budget', icon: IconWallet, title: 'Budget friendly', detail: `Up to ${inr(Number(budgetKey))}`, filters: { budget: budgetKey, sort: 'price' } });
    const food = count({ food: true });
    if (food) out.push({ key: 'food', icon: IconUtensils, title: 'Food included', detail: plural(food, 'PG'), filters: { food: true } });
    else {
      const ac = count({ ac: true });
      if (ac) out.push({ key: 'ac', icon: IconSnowflake, title: 'AC rooms', detail: plural(ac, 'PG'), filters: { ac: true } });
    }
    return out;
  }, [pgs]);

  const hasData = pgs.length > 0;
  const discovery = view === 'home' && !!home && hasData;
  const rails = discovery ? home!.rails.map((r) => ({ ...r, items: r.ids.map((id) => byId.get(id)).filter(Boolean) as PgListItem[] })).filter((r) => r.items.length) : [];

  const states = loading && !hasData ? <PgListSkeleton /> : error && !hasData ? (
    <StateMessage icon={<IconAlert size={26} color={p.accent} strokeWidth={ICON.stroke} />} title="Could not load PG stays" body={error} actionLabel="Try again" onAction={onRetry} />
  ) : !hasData ? (
    <StateMessage icon={<IconBuilding size={26} color={p.accent} strokeWidth={ICON.stroke} />} title="No PGs listed yet" body="The housing team is adding stays near campus. Pull down to check again." />
  ) : null;

  // ── Listing ─────────────────────────────────────────────────────────────────────────────────────
  if (view === 'list') {
    const chips: { key: string; label: string; clear: () => void }[] = [
      query.trim() ? { key: 'q', label: `“${query.trim()}”`, clear: () => setQuery('') } : null,
      filters.gender !== 'All' ? { key: 'g', label: GENDER.find((o) => o.key === filters.gender)!.label, clear: () => set({ gender: 'All' }) } : null,
      filters.budget !== 'All' ? { key: 'b', label: BUDGET.find((o) => o.key === filters.budget)!.label, clear: () => set({ budget: 'All' }) } : null,
      filters.distance !== 'All' ? { key: 'd', label: DISTANCE.find((o) => o.key === filters.distance)!.label, clear: () => set({ distance: 'All' }) } : null,
      filters.ac ? { key: 'ac', label: 'AC rooms', clear: () => set({ ac: false }) } : null,
      filters.food ? { key: 'f', label: 'Food included', clear: () => set({ food: false }) } : null,
    ].filter(Boolean) as any;
    return (
      <View style={st.wrap}>
        <View style={st.listTop}>
          <Press onPress={() => setView('home')} accessibilityLabel="Back to PG search" style={[st.round, { backgroundColor: p.card }, p.shadow]}>
            <IconArrowLeft size={20} color={p.text} strokeWidth={ICON.stroke} />
          </Press>
          <View style={{ flex: 1 }}>
            <Text style={[st.title, { color: p.text }]} accessibilityRole="header">PG listings</Text>
            <Text style={[ui.small, { color: p.sub }]} accessibilityLiveRegion="polite">
              {loading && !hasData ? 'Loading…' : `${plural(list.length, 'PG')} · ${SORT.find((x) => x.key === filters.sort)!.label.toLowerCase()}`}
            </Text>
          </View>
        </View>

        <View style={st.toolRow}>
          <Press onPress={() => setSheet('sort')} disabled={!hasData} accessibilityLabel={`Sort, ${SORT.find((x) => x.key === filters.sort)!.label}`} style={[st.tool, { backgroundColor: p.card }, p.shadow]}>
            <IconSort size={16} color={p.accent} strokeWidth={ICON.stroke} />
            <Text style={[ui.btnLabel, { color: p.text }]}>Sort</Text>
          </Press>
          <Press onPress={() => setSheet('filters')} disabled={!hasData} accessibilityLabel={`Filters${nFilters ? `, ${nFilters} applied` : ''}`} style={[st.tool, { backgroundColor: p.card }, p.shadow, nFilters ? { borderWidth: 1, borderColor: p.accentLine } : null]}>
            <IconSliders size={16} color={p.accent} strokeWidth={ICON.stroke} />
            <Text style={[ui.btnLabel, { color: p.text }]}>{nFilters ? `Filters · ${nFilters}` : 'Filters'}</Text>
          </Press>
        </View>

        {chips.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipRow}>
            {chips.map((c) => (
              <Press key={c.key} onPress={c.clear} accessibilityLabel={`Remove ${c.label}`} style={[st.activeChip, { backgroundColor: p.accentSoft }]}>
                <Text style={[ui.small, { color: p.accent, fontWeight: '600' }]} numberOfLines={1}>{c.label}</Text>
                <IconX size={14} color={p.accent} strokeWidth={2} />
              </Press>
            ))}
            <Press onPress={reset} accessibilityLabel="Clear all" style={st.clearAll}>
              <Text style={[ui.small, { color: p.sub, fontWeight: '600' }]}>Clear all</Text>
            </Press>
          </ScrollView>
        ) : null}

        <View style={[st.pad, { marginTop: 16 }]}>
          {states || (!list.length ? (
            <StateMessage icon={<IconSearch size={26} color={p.accent} strokeWidth={ICON.stroke} />} title="No PGs match" body="Try a higher budget, a longer distance or another area." actionLabel="Clear all" onAction={reset} />
          ) : list.map((pg, i) => <FadeInUp key={pg.id} index={i}><PgListCard pg={pg} onPress={() => open(pg.id)} /></FadeInUp>))}
        </View>

        {sheet === 'filters' ? <FilterSheet value={filters} pgs={pgs} query={query} onClose={() => setSheet(null)} onApply={(f) => { setFilters(f); setSheet(null); }} /> : null}
        {sheet === 'sort' ? <PickSheet title="Sort by" options={SORT} value={filters.sort} onClose={() => setSheet(null)} onPick={(k) => { set({ sort: k as SortKey }); setSheet(null); }} /> : null}
      </View>
    );
  }

  // ── Home ────────────────────────────────────────────────────────────────────────────────────────
  return (
    <View style={st.wrap}>
      <View style={st.pad}>
        <Text style={[st.title, { color: p.text }]} accessibilityRole="header">PG accommodation</Text>
        <Text style={[ui.body, { color: p.sub, marginTop: 2 }]}>Find a safe, comfortable place to stay near campus</Text>

        {/* Search card */}
        <View style={[st.searchCard, { backgroundColor: p.card }, p.shadow]}>
          <View style={[st.field, { backgroundColor: p.sunken }]}>
            <IconMapPin size={ICON.size} color={p.accent} strokeWidth={ICON.stroke} />
            <TextInput
              ref={searchRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Area or PG name"
              placeholderTextColor={p.muted}
              style={[st.input, { color: p.text }]}
              returnKeyType="search"
              onSubmitEditing={showList}
              accessibilityLabel="Search PGs by area or name"
            />
            {query ? (
              <Press onPress={() => setQuery('')} accessibilityLabel="Clear search" style={st.clear}>
                <IconX size={16} color={p.muted} strokeWidth={ICON.stroke} />
              </Press>
            ) : <IconSearch size={ICON.size} color={p.muted} strokeWidth={ICON.stroke} style={{ marginRight: 12 }} />}
          </View>

          <View style={[st.segment, { backgroundColor: p.sunken }]} accessibilityRole="radiogroup" accessibilityLabel="Residents">
            {GENDER_SEG.map((o) => {
              const on = filters.gender === o.key;
              return (
                <Press key={o.key} onPress={() => set({ gender: o.key })} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${o.label} PGs`}
                  style={[st.segBtn, on && { backgroundColor: p.accentFill }]}>
                  <Text style={[st.segText, { color: on ? '#fff' : p.sub }]} numberOfLines={1}>{o.label}</Text>
                </Press>
              );
            })}
          </View>

          <Press onPress={() => setSheet('budget')} accessibilityLabel={`Monthly budget, ${BUDGET.find((o) => o.key === filters.budget)!.label}. Change`} style={[st.field, st.budget, { backgroundColor: p.sunken }]}>
            <View style={{ flex: 1 }}>
              <Text style={[ui.small, { color: p.muted }]}>Monthly budget</Text>
              <Text style={[ui.body, { color: p.text, fontWeight: '600', marginTop: 1 }]}>{BUDGET.find((o) => o.key === filters.budget)!.label}</Text>
            </View>
            <IconChevronDown size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} style={{ marginRight: 12 }} />
          </Press>

          <Press onPress={showList} disabled={!hasData} accessibilityLabel={hasData ? `Search PGs, ${plural(list.length, 'match', 'matches')}` : 'Search PGs'} style={[st.primary, { backgroundColor: p.accentFill }]}>
            <Text style={[ui.btnLabel, { color: '#fff' }]}>{hasData ? `Search PGs · ${list.length}` : 'Search PGs'}</Text>
          </Press>
        </View>

        {/* Your open requests */}
        {mine.length ? (
          <View style={{ marginTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={[st.heading, { color: p.text }]} accessibilityRole="header">Your booking requests</Text>
              {mine.length > 2 ? (
                <Press onPress={() => setMineOpen((v) => !v)} accessibilityLabel={mineOpen ? 'Show fewer booking requests' : `Show all ${mine.length} booking requests`} style={{ minHeight: 32, justifyContent: 'center' }}>
                  <Text style={[ui.small, { color: p.accent, fontWeight: '700' }]}>{mineOpen ? 'Show less' : `See all ${mine.length}`}</Text>
                </Press>
              ) : null}
            </View>
            <View style={[st.groupCard, { backgroundColor: p.card }, p.shadow]}>
              {(mineOpen ? mineSorted : mineSorted.slice(0, 2)).map((b, i) => {
                const pgId = b.hostel?.id || b.hostelId;
                const ok = b.status === 'Confirmed';
                return (
                  <Press key={b.id} onPress={() => pgId && open(pgId)} disabled={!pgId} accessibilityLabel={`${b.hostel?.name || 'PG'}, ${ok ? 'confirmed' : 'waiting for confirmation'}`}
                    style={[st.mineRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[ui.body, { color: p.text, fontWeight: '600' }]} numberOfLines={1}>{b.hostel?.name || 'PG'}</Text>
                      <Text style={[ui.small, { color: p.sub, marginTop: 2 }]} numberOfLines={1}>
                        {[b.room?.roomNumber ? `Room ${b.room.roomNumber}` : '', b.checkInDate && formatISTDate(b.checkInDate) ? `Move-in ${formatISTDate(b.checkInDate)}` : ''].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <View style={[st.status, { backgroundColor: ok ? p.successSoft : p.accentSoft }]}>
                      <Text style={[st.statusText, { color: ok ? p.success : p.accent }]}>{ok ? 'Confirmed' : 'Pending'}</Text>
                    </View>
                    <IconChevronRight size={16} color={p.muted} strokeWidth={ICON.stroke} />
                  </Press>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Popular near you */}
        {tiles.length ? (
          <View style={{ marginTop: 24 }}>
            <Text style={[st.heading, { color: p.text, marginBottom: 12 }]} accessibilityRole="header">Popular near you</Text>
            <View style={st.tiles}>
              {tiles.map((t) => (
                <Press key={t.key} onPress={() => { setQuery(''); setFilters({ ...NO_FILTERS, ...t.filters }); showList(); }} accessibilityLabel={`${t.title}, ${t.detail}`}
                  style={[st.tile, { backgroundColor: p.card }, p.shadow]}>
                  <View style={[st.tileIcon, { backgroundColor: p.accentSoft }]}>
                    <t.icon size={20} color={p.accent} strokeWidth={ICON.stroke} />
                  </View>
                  <Text style={[st.tileTitle, { color: p.text }]} numberOfLines={2}>{t.title}</Text>
                  <Text style={[ui.small, { color: p.muted, textAlign: 'center' }]} numberOfLines={1}>{t.detail}</Text>
                </Press>
              ))}
            </View>
          </View>
        ) : null}

        {states ? <View style={{ marginTop: 24 }}>{states}</View> : null}
      </View>

      {discovery && home!.promotions.length ? (
        <View style={{ marginTop: 32 }}>
          <FeaturedCarousel
            promos={home!.promotions}
            onOpenPg={open}
            onPlay={(x) => x.video && setPlaying({ video: x.video, title: x.headline, subtitle: x.pg?.name })}
            onBookVisit={bookVisit}
          />
        </View>
      ) : null}
      {discovery ? <ToursRail tours={home!.tours} onPlay={(t) => setPlaying({ video: t.video, title: t.video.title || 'Room tour', subtitle: t.pgName })} /> : null}
      {rails.map((r) => <PgRail key={r.key} title={r.title} items={r.items} onOpen={open} />)}

      <View style={[st.pad, { marginTop: 32 }]}>
        {hasData ? (
          <Press onPress={() => { reset(); showList(); }} accessibilityLabel={`Browse all ${plural(pgs.length, 'PG')}`} style={[st.browse, { backgroundColor: p.card }, p.shadow]}>
            <IconBuilding size={20} color={p.accent} strokeWidth={ICON.stroke} />
            <Text style={[ui.body, { color: p.text, fontWeight: '600', flex: 1 }]}>Browse all {plural(pgs.length, 'PG')}</Text>
            <IconChevronRight size={18} color={p.muted} strokeWidth={ICON.stroke} />
          </Press>
        ) : null}

        <View style={[st.owner, { backgroundColor: p.accentSoft, borderColor: p.accentLine }]}>
          <View style={{ flex: 1 }}>
            <Text style={[st.heading, { color: p.text }]}>Own a PG near campus?</Text>
            <Text style={[ui.small, { color: p.sub, marginTop: 4 }]}>The Zenvy housing team lists PGs for students. Message us to add yours.</Text>
            <Press onPress={() => openDesk('Hi, I own a PG near campus and would like to list it on Zenvy.')} accessibilityLabel="Message the housing team on WhatsApp" style={[st.ownerBtn, { backgroundColor: p.accentFill }]}>
              <Text style={[ui.small, { color: '#fff', fontWeight: '600' }]}>Message the housing team</Text>
            </Press>
          </View>
          <IconHousePlus size={44} color={p.accent} strokeWidth={1.5} />
        </View>
      </View>

      {sheet === 'budget' ? <PickSheet title="Monthly budget" options={BUDGET} value={filters.budget} onClose={() => setSheet(null)} onPick={(k) => { set({ budget: k }); setSheet(null); }} /> : null}
      {playing ? <VideoModal video={playing.video} title={playing.title} subtitle={playing.subtitle} onClose={() => setPlaying(null)} /> : null}
    </View>
  );
}

// ── Sheets (Android back closes them) ──────────────────────────────────────────────────────────────
function SheetFrame({ title, onClose, right, children }: { title: string; onClose: () => void; right?: React.ReactNode; children: React.ReactNode }) {
  const p = usePgPalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={st.backdrop}>
        <Press onPress={onClose} accessibilityLabel="Close" style={{ flex: 1 }}><View /></Press>
        <View style={[st.sheet, { backgroundColor: p.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[st.grabber, { backgroundColor: p.line }]} />
          <View style={st.sheetHead}>
            <Text style={[st.heading, { color: p.text, flex: 1 }]} accessibilityRole="header">{title}</Text>
            {right}
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function PickSheet({ title, options, value, onClose, onPick }: { title: string; options: Opt[]; value: string; onClose: () => void; onPick: (k: string) => void }) {
  const p = usePgPalette();
  return (
    <SheetFrame title={title} onClose={onClose}>
      <View style={{ marginTop: 8 }}>
        {options.map((o, i) => {
          const on = o.key === value;
          return (
            <Press key={o.key} onPress={() => onPick(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
              style={[st.pickRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
              <Text style={[ui.body, { color: on ? p.accent : p.text, fontWeight: on ? '600' : '400', flex: 1 }]}>{o.label}</Text>
              {on ? <IconCheck size={18} color={p.accent} strokeWidth={2} /> : null}
            </Press>
          );
        })}
      </View>
    </SheetFrame>
  );
}

function FilterSheet({ value, pgs, query, onClose, onApply }: { value: Filters; pgs: PgListItem[]; query: string; onClose: () => void; onApply: (f: Filters) => void }) {
  const p = usePgPalette();
  const [f, setF] = useState<Filters>(value);
  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));
  const count = applyFilters(pgs, f, query).length;
  return (
    <SheetFrame
      title="Filters"
      onClose={onClose}
      right={(
        <Press onPress={() => setF({ ...NO_FILTERS, sort: f.sort })} disabled={!filterCount(f)} accessibilityLabel="Clear filters" style={st.textBtn}>
          <Text style={[ui.body, { color: p.accent, fontWeight: '600' }]}>Clear</Text>
        </Press>
      )}
    >
      <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
        <Group label="Residents"><Options options={GENDER} value={f.gender} onChange={(k) => set({ gender: k })} /></Group>
        <Group label="Rent per month"><Options options={BUDGET.map((o) => (o.key === 'All' ? { ...o, label: 'Any' } : o))} value={f.budget} onChange={(k) => set({ budget: k })} /></Group>
        <Group label="Distance from campus"><Options options={DISTANCE} value={f.distance} onChange={(k) => set({ distance: k })} /></Group>
        <Group label="Must have">
          <Options
            options={[{ key: 'ac', label: 'AC rooms' }, { key: 'food', label: 'Food included in rent' }]}
            multi={{ ac: f.ac, food: f.food }}
            onChange={(k) => set(k === 'ac' ? { ac: !f.ac } : { food: !f.food })}
          />
        </Group>
      </ScrollView>
      <Press onPress={() => onApply(f)} accessibilityLabel={`Show ${plural(count, 'PG')}`} style={[st.primary, { backgroundColor: p.accentFill, marginTop: 24 }]}>
        <Text style={[ui.btnLabel, { color: '#fff' }]}>{count ? `Show ${plural(count, 'PG')}` : 'No PGs match'}</Text>
      </Press>
    </SheetFrame>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const p = usePgPalette();
  return (
    <View style={{ marginTop: 20 }}>
      <Text style={[ui.small, { color: p.muted, marginBottom: 8, fontWeight: '600' }]}>{label}</Text>
      {children}
    </View>
  );
}

function Options({ options, value, multi, onChange }: { options: Opt[]; value?: string; multi?: Record<string, boolean>; onChange: (k: string) => void }) {
  const p = usePgPalette();
  return (
    <View style={st.options}>
      {options.map((o) => {
        const on = multi ? !!multi[o.key] : o.key === value;
        return (
          <Press key={o.key} onPress={() => onChange(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            style={[st.chip, { borderColor: on ? p.accentFill : p.line, backgroundColor: on ? p.accentFill : 'transparent' }]}>
            <Text style={[ui.body, { color: on ? '#fff' : p.text, fontWeight: on ? '600' : '400' }]}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingTop: 8, paddingBottom: 8 },
  pad: { paddingHorizontal: 16 },
  title: { fontSize: TYPE.title, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: TYPE.heading, fontWeight: '700' },

  searchCard: { borderRadius: 16, padding: 12, marginTop: 16, gap: 10 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingLeft: 12, minHeight: 48 },
  input: { flex: 1, fontSize: TYPE.body, paddingVertical: 10 },
  clear: { alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 4 },
  segBtn: { flex: 1, minHeight: 40, minWidth: 0, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segText: { fontSize: 13, fontWeight: '600' },
  budget: { paddingVertical: 6 },
  primary: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  groupCard: { borderRadius: 16, overflow: 'hidden' },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  status: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },

  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minWidth: 0, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' },
  tileIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileTitle: { fontSize: 13, fontWeight: '600', textAlign: 'center' },

  browse: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 16, minHeight: 56 },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 16 },
  ownerBtn: { alignSelf: 'flex-start', minHeight: 36, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center', marginTop: 12 },

  listTop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  toolRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 16 },
  tool: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, borderRadius: 12 },
  chipRow: { paddingHorizontal: 16, gap: 8, paddingTop: 12, alignItems: 'center' },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, borderRadius: 16, paddingHorizontal: 12 },
  clearAll: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  textBtn: { justifyContent: 'center', paddingHorizontal: 4 },
  pickRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
