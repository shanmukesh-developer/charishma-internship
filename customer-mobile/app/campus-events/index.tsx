// Zenvy Campus Events: full list. Search, filter sheet (category, date, free / paid, format, available places,
// club / organizer from GET /clubs, registration status) and sort (date, recently published, registration
// deadline: all server-side), with cursor paging from GET /api/campus-events. Opened from Others > Campus Events (see all / search / filters).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Modal, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { campusEventsApi, CampusEventsError, CATEGORIES, CATEGORY_META, istDate, type BrowseFilter, type Category, type EventCard as EventCardT } from '../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, EventCard, CardSkeleton, ErrorState, StateView, Chips, Toggle, Btn, Notice, CE_HOME } from '../../modules/campusEvents/ui';
import { useCampusEventsLive } from '../../modules/campusEvents/useCampusEventsLive';

type DateKey = 'any' | 'today' | 'tomorrow' | 'week' | 'month';
type SortKey = 'date' | 'recent' | 'deadline';
interface Filters {
  categories: Category[];
  date: DateKey;
  price: 'any' | 'free' | 'paid';
  format: 'any' | 'INDIVIDUAL' | 'SLOT' | 'TEAM';
  available: boolean;
  status: 'any' | 'open' | 'upcoming' | 'closed';
  entityId: string | null;
  sort: SortKey;
}
const DEFAULTS: Filters = { categories: [], date: 'any', price: 'any', format: 'any', available: false, status: 'any', entityId: null, sort: 'date' };

const SECTION_CATS: Record<string, Category[]> = {
  sports: ['SPORTS', 'TOURNAMENT'], clubs: ['CLUB', 'CULTURAL'], workshops: ['WORKSHOP', 'SEMINAR', 'TALK'], competitions: ['COMPETITION', 'HACKATHON'], recreational: ['RECREATION', 'OTHER'],
};

/** IST day window -> ISO range. */
const range = (d: DateKey): { from?: string; to?: string } => {
  if (d === 'any') return {};
  const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`).toISOString();
  const endOf = (ymd: string) => new Date(`${ymd}T23:59:59+05:30`).toISOString();
  if (d === 'today') return { from: startOf(istDate(0)), to: endOf(istDate(0)) };
  if (d === 'tomorrow') return { from: startOf(istDate(1)), to: endOf(istDate(1)) };
  if (d === 'week') return { from: startOf(istDate(0)), to: endOf(istDate(6)) };
  return { from: startOf(istDate(0)), to: endOf(istDate(30)) };
};

const activeCount = (f: Filters) => [f.categories.length > 0, f.date !== 'any', f.price !== 'any', f.format !== 'any', f.available, f.status !== 'any', !!f.entityId].filter(Boolean).length;

export default function CampusEventsList() {
  const params = useLocalSearchParams<{ q?: string; section?: string; featured?: string; filters?: string }>();
  const router = useRouter();
  const p = usePalette();
  const [q, setQ] = useState(String(params.q || ''));
  const [query, setQuery] = useState(String(params.q || ''));
  const [filters, setFilters] = useState<Filters>(() => ({ ...DEFAULTS, categories: params.section && SECTION_CATS[String(params.section)] ? SECTION_CATS[String(params.section)] : [] }));
  const [featured, setFeatured] = useState(params.featured === '1');
  const [sheet, setSheet] = useState(params.filters === '1');
  const [draft, setDraft] = useState<Filters>(filters);
  const [events, setEvents] = useState<EventCardT[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const reqId = useRef(0);

  const filterArgs = useCallback((f: Filters): BrowseFilter => ({
    q: query.trim() || null,
    category: f.categories.length ? f.categories.join(',') : null,
    ...range(f.date),
    price: f.price === 'any' ? null : f.price,
    format: f.format === 'any' ? null : f.format,
    available: f.available || null,
    // sort=deadline lists open registrations only (server-side); other sorts keep the status filter.
    status: f.sort === 'deadline' ? null : f.status === 'any' ? null : f.status,
    entityId: f.entityId,
    featured: featured || null,
    sort: f.sort,
    limit: 20,
  }), [query, featured]);

  // Club filter options: verified clubs of this campus with published events (server list). If that call
  // fails (older server), clubs seen on loaded cards still fill the filter.
  const clubsFromServer = useRef(false);
  useEffect(() => {
    let alive = true;
    campusEventsApi.clubs().then((r) => {
      if (!alive) return;
      clubsFromServer.current = true;
      setClubs(r.clubs.map((c) => ({ id: c.id, name: c.name })));
    }).catch(() => { /* fallback below */ });
    return () => { alive = false; };
  }, []);
  const remember = (list: EventCardT[]) => {
    if (clubsFromServer.current) return;
    setClubs((cur) => {
      const map = new Map(cur.map((c) => [c.id, c]));
      for (const e of list) if (e.organizer?.club?.id) map.set(e.organizer.club.id, { id: e.organizer.club.id, name: e.organizer.club.name });
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const load = useCallback(async () => {
    const my = ++reqId.current;
    try {
      const r = await campusEventsApi.browse(filterArgs(filters));
      if (my !== reqId.current) return;
      setEvents(r.events);
      setCursor(r.nextCursor);
      setNotice(r.reason === 'CAMPUS_REQUIRED' ? r.message || 'Verify your college to see events on your campus.' : null);
      setError(null);
      remember(r.events);
    } catch (e: any) {
      if (my !== reqId.current) return;
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load events.'));
    }
  }, [filterArgs, filters]);

  useEffect(() => { setEvents(null); load(); }, [load]);
  useCampusEventsLive((e) => { if (e.kind === 'event' || e.kind === 'reconnect') load(); });

  const more = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const my = reqId.current;
    try {
      const r = await campusEventsApi.browse({ ...filterArgs(filters), cursor });
      if (my !== reqId.current) return;
      setEvents((cur) => {
        const seen = new Set((cur || []).map((x) => x.id));
        return [...(cur || []), ...r.events.filter((x) => !seen.has(x.id))];
      });
      setCursor(r.nextCursor);
      remember(r.events);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load more.'));
    } finally {
      setLoadingMore(false);
    }
  };

  // Every sort (incl. registration deadline) comes from the server, so paging keeps the order.
  const shown = events;

  const n = activeCount(filters) + (featured ? 1 : 0);
  const applySheet = () => { setFilters(draft); setSheet(false); };

  const header = (
    <View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.card2 }}>
          <Text style={{ fontSize: 14 }}>🔍</Text>
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => setQuery(q)} returnKeyType="search" placeholder="Search events, venues" placeholderTextColor={p.muted}
            accessibilityLabel="Search campus events" style={{ flex: 1, color: p.text, fontSize: 14, paddingVertical: 8 }} maxLength={60} />
          {q ? (
            <TouchableOpacity onPress={() => { setQ(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: p.muted, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity onPress={() => { setDraft(filters); setSheet(true); }} accessibilityRole="button" accessibilityLabel={`Filter and sort${n ? `, ${n} active` : ''}`}
          style={{ minWidth: 46, height: 46, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: n ? p.accent : p.border, backgroundColor: n ? p.accentSoft : p.card2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 }}>
          <Text style={{ fontSize: 15 }}>⚙️</Text>
          {n ? <Text style={{ color: p.accent, fontWeight: '900', fontSize: 12 }}>{n}</Text> : null}
        </TouchableOpacity>
      </View>
      <Chips<SortKey> wrap={false} accessibilityLabel="Sort" value={filters.sort} onChange={(v: SortKey) => setFilters((f) => ({ ...f, sort: v }))}
        options={[{ key: 'date', label: '📅 Soonest' }, { key: 'recent', label: '🆕 Recently published' }, { key: 'deadline', label: '⏳ Deadline' }]} />
      {featured || n ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {featured ? <Text style={{ color: p.sub, fontSize: 12 }}>★ Featured only · </Text> : null}
          <TouchableOpacity onPress={() => { setFilters({ ...DEFAULTS, sort: filters.sort }); setFeatured(false); }} accessibilityRole="button" hitSlop={10}>
            <Text style={{ color: p.accent, fontWeight: '900', fontSize: 12 }}>Clear filters</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {filters.sort === 'deadline' ? <Text style={{ color: p.muted, fontSize: 11, marginTop: 8 }}>Open registrations, closing soonest first.</Text> : null}
      {notice ? <View style={{ marginTop: 10 }}><Notice tone="warn" icon="🎓">{notice}</Notice></View> : null}
      <View style={{ height: 12 }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="Campus events" subtitle="All upcoming events on your campus" onBack={() => (router.canGoBack() ? router.back() : router.replace(CE_HOME as any))} />
      {error && !events ? (
        <ErrorState error={error} onRetry={load} onNotFound={() => router.replace(CE_HOME as any)} />
      ) : (
        <FlatList
          data={shown || []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          ListHeaderComponent={header}
          renderItem={({ item }) => <EventCard e={item} onPress={() => router.push(`/campus-events/${item.id}` as any)} />}
          onEndReached={more}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}
          ListEmptyComponent={shown === null ? <View>{[0, 1].map((i) => <CardSkeleton key={i} height={300} />)}</View> : (
            <StateView kind="empty" icon="🗓️" title={n || query || featured ? 'No events match' : 'No upcoming events yet'}
              message={n || query || featured ? 'Try fewer filters or another search.' : 'When clubs and organizers publish events on your campus, they appear here.'}
              actionLabel={n || query || featured ? 'Clear filters' : undefined} onAction={() => { setFilters(DEFAULTS); setFeatured(false); setQ(''); setQuery(''); }} />
          )}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={p.accent} style={{ marginVertical: 16 }} /> : error && events ? (
            <TouchableOpacity onPress={more} accessibilityRole="button" style={{ padding: 14, alignItems: 'center', minHeight: 48 }}><Text style={{ color: p.accent, fontWeight: '900' }}>⚠️ {error.message} · Retry</Text></TouchableOpacity>
          ) : null}
        />
      )}

      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ maxHeight: '88%', backgroundColor: p.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 }}>
            <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: p.border, marginBottom: 8 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 6 }}>
              <Text style={{ flex: 1, fontSize: 18, fontWeight: '900', color: p.text }} accessibilityRole="header">Filter & sort</Text>
              <TouchableOpacity onPress={() => setDraft({ ...DEFAULTS })} accessibilityRole="button" hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: p.accent, fontWeight: '900' }}>Reset</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 16 }}>
              <Group label="Category">
                <Chips<Category> multi value={draft.categories} onChange={(v: Category[]) => setDraft((d) => ({ ...d, categories: v }))}
                  options={CATEGORIES.map((c) => ({ key: c, label: `${CATEGORY_META[c].icon} ${CATEGORY_META[c].label}` }))} />
              </Group>
              <Group label="Date">
                <Chips<DateKey> value={draft.date} onChange={(v: DateKey) => setDraft((d) => ({ ...d, date: v }))}
                  options={[{ key: 'any', label: 'Any time' }, { key: 'today', label: 'Today' }, { key: 'tomorrow', label: 'Tomorrow' }, { key: 'week', label: 'Next 7 days' }, { key: 'month', label: 'Next 30 days' }]} />
              </Group>
              <Group label="Price">
                <Chips value={draft.price} onChange={(v: Filters['price']) => setDraft((d) => ({ ...d, price: v }))}
                  options={[{ key: 'any', label: 'Any' }, { key: 'free', label: 'Free' }, { key: 'paid', label: 'Paid' }]} />
              </Group>
              <Group label="Format">
                <Chips value={draft.format} onChange={(v: Filters['format']) => setDraft((d) => ({ ...d, format: v }))}
                  options={[{ key: 'any', label: 'Any' }, { key: 'INDIVIDUAL', label: '🙋 Individual' }, { key: 'SLOT', label: '🗓️ Slot booking' }, { key: 'TEAM', label: '👥 Team' }]} />
              </Group>
              <Group label="Registration">
                <Chips value={draft.status} onChange={(v: Filters['status']) => setDraft((d) => ({ ...d, status: v }))}
                  options={[{ key: 'any', label: 'Any' }, { key: 'open', label: 'Open now' }, { key: 'upcoming', label: 'Opens later' }, { key: 'closed', label: 'Closed' }]} />
              </Group>
              <Toggle label="Places available" hint="Hide full events and slots" value={draft.available} onChange={(v) => setDraft((d) => ({ ...d, available: v }))} />
              {clubs.length ? (
                <Group label="Club / organizer">
                  <Chips value={draft.entityId || 'any'} onChange={(v: string) => setDraft((d) => ({ ...d, entityId: v === 'any' ? null : v }))}
                    options={[{ key: 'any', label: 'All clubs' }, ...clubs.map((c) => ({ key: c.id, label: c.name }))]} />
                </Group>
              ) : null}
              <Group label="Sort by">
                <Chips<SortKey> value={draft.sort} onChange={(v: SortKey) => setDraft((d) => ({ ...d, sort: v }))}
                  options={[{ key: 'date', label: 'Upcoming date' }, { key: 'recent', label: 'Recently published' }, { key: 'deadline', label: 'Registration deadline' }]} />
              </Group>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: p.border }}>
              <Btn label="Cancel" kind="secondary" onPress={() => setSheet(false)} style={{ flex: 1 }} />
              <Btn label="Show events" onPress={applySheet} style={{ flex: 2 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const p = usePalette();
  return (
    <View>
      <Text style={{ fontSize: 11, fontWeight: '900', color: p.sub, letterSpacing: 0.8, marginBottom: 8 }}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}
