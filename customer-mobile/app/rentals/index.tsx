// Student vehicles: browse with filters (type, max price, free for given dates).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, Dimensions, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { readCache, writeCache } from '../../utils/swrCache';
import { rentalsApi, type Listing, type VehicleType, istDate, istInstant, fmtDateTime } from '../../modules/rentals/rentalsApi';
import { RHeader, usePalette, Chips, StateView, Btn, DateTimeSelect, Field, useRentalLive } from '../../modules/rentals/ui';
import { MiniCard } from '../../modules/rentals/RentalsSection';

const { width: SW } = Dimensions.get('window');
const CARD_W = (SW - 16 * 2 - 10) / 2;

type Filters = { type: VehicleType | 'ALL'; maxHour: string; maxDay: string; when: null | { start: string; end: string }; sort: 'recent' | 'price_low' | 'rating' };

export default function RentalsBrowse() {
  const router = useRouter();
  const p = usePalette();
  const { user } = useAuth();
  const uid = String((user as any)?._id || (user as any)?.id || '');
  const [filters, setFilters] = useState<Filters>({ type: 'ALL', maxHour: '', maxDay: '', when: null, sort: 'recent' });
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showDates, setShowDates] = useState(false);
  // Typed price limits are applied once typing pauses (not one request per keystroke).
  const [applied, setApplied] = useState<Filters>(filters);
  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), 450);
    return () => clearTimeout(t);
  }, [filters]);
  const isDefault = applied.type === 'ALL' && !applied.maxDay && !applied.maxHour && !applied.when && applied.sort === 'recent';
  const cacheKey = uid ? `rentals:browse:${uid}` : '';

  // Only the latest filter's answer may land (a slow older request must not overwrite it).
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    const my = ++reqIdRef.current;
    try {
      const res = await rentalsApi.browse({
        type: applied.type === 'ALL' ? null : applied.type,
        maxPricePerHour: applied.maxHour ? Number(applied.maxHour) : null,
        maxPricePerDay: applied.maxDay ? Number(applied.maxDay) : null,
        startAt: applied.when?.start || null,
        endAt: applied.when?.end || null,
        sort: applied.sort,
      });
      if (my !== reqIdRef.current) return;
      setListings(res.listings);
      setError(null);
      if (isDefault && cacheKey) writeCache(cacheKey, res.listings);
    } catch (e: any) {
      if (my !== reqIdRef.current) return;
      setError({ message: e?.message || 'Could not load vehicles.', code: e?.code || 'ERROR' });
    }
  }, [applied, isDefault, cacheKey]);

  useEffect(() => {
    let cancelled = false;
    if (isDefault && cacheKey && listings === null) readCache<Listing[]>(cacheKey).then((c) => { if (!cancelled && c && Array.isArray(c.data)) setListings((cur) => cur || c.data); });
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useRentalLive(() => load(), !!uid);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const header = (
    <View style={{ paddingTop: 12 }}>
      <Chips<VehicleType | 'ALL'>
        wrap={false}
        options={[{ key: 'ALL', label: 'All' }, { key: 'BIKE', label: '🏍️ Bikes' }, { key: 'SCOOTER', label: '🛵 Scooters' }, { key: 'CAR', label: '🚗 Cars' }]}
        value={filters.type}
        onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
      />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TouchableOpacity onPress={() => setShowDates(true)} accessibilityRole="button" style={{ flex: 1, borderRadius: 12, borderWidth: 1, borderColor: filters.when ? p.accent : p.border, backgroundColor: filters.when ? p.accentSoft : p.card, padding: 10 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: p.sub }}>AVAILABLE FOR</Text>
          <Text style={{ fontSize: 12, fontWeight: '800', color: p.text, marginTop: 2 }} numberOfLines={1}>{filters.when ? `${fmtDateTime(filters.when.start)} → ${fmtDateTime(filters.when.end).split(' · ')[1]}` : 'Any time · tap to pick dates'}</Text>
        </TouchableOpacity>
        {filters.when ? <Btn label="✕" kind="secondary" small onPress={() => setFilters((f) => ({ ...f, when: null }))} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Field label="Max ₹ / hour" value={filters.maxHour} onChangeText={(t) => setFilters((f) => ({ ...f, maxHour: t.replace(/\D/g, '').slice(0, 5) }))} keyboardType="number-pad" placeholder="Any" style={{ flex: 1, marginBottom: 6 }} />
        <Field label="Max ₹ / day" value={filters.maxDay} onChangeText={(t) => setFilters((f) => ({ ...f, maxDay: t.replace(/\D/g, '').slice(0, 6) }))} keyboardType="number-pad" placeholder="Any" style={{ flex: 1, marginBottom: 6 }} />
      </View>
      <Chips<'recent' | 'price_low' | 'rating'>
        wrap={false}
        options={[{ key: 'recent', label: 'Newest' }, { key: 'price_low', label: 'Lowest price' }, { key: 'rating', label: 'Top rated' }]}
        value={filters.sort}
        onChange={(v) => setFilters((f) => ({ ...f, sort: v }))}
      />
      <View style={{ height: 12 }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <RHeader
        title="Student vehicles"
        subtitle="From college-verified students · cash at pickup"
        right={<Btn label="+ List" small onPress={() => router.push('/rentals/new' as any)} />}
      />
      <FlatList
        data={error && !listings ? [] : listings || []}
        keyExtractor={(l) => l.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 10 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 10 }}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={p.accent} />}
        renderItem={({ item }) => (
          <View>
            <MiniCard l={item} width={CARD_W} onPress={() => router.push(`/rentals/${item.id}` as any)} />
            {item.quote ? <Text style={{ fontSize: 11, color: p.sub, marginTop: 4, marginLeft: 4 }}>For your dates: <Text style={{ color: p.text, fontWeight: '900' }}>₹{item.quote.rent}</Text> + ₹{item.quote.deposit} deposit</Text> : null}
          </View>
        )}
        ListEmptyComponent={
          listings === null && !error ? <StateView kind="loading" message="Finding vehicles…" />
            : error ? (error.code === 'FEATURE_OFF'
              ? <StateView kind="empty" icon="⏸️" title="Rentals are paused" message={error.message} />
              : <StateView kind="error" title="Could not load vehicles" message={error.message} actionLabel="Retry" onAction={load} />)
              : <StateView kind="empty" title={isDefault ? 'No student vehicles yet' : 'Nothing matches'} message={isDefault ? 'List yours and be the first on campus.' : 'Try other dates or remove a filter.'} actionLabel={isDefault ? 'Rent out or lend your vehicle' : 'Clear filters'} onAction={() => (isDefault ? router.push('/rentals/new' as any) : setFilters({ type: 'ALL', maxHour: '', maxDay: '', when: null, sort: 'recent' }))} />
        }
      />
      <DatesSheet visible={showDates} onClose={() => setShowDates(false)} onApply={(when) => { setFilters((f) => ({ ...f, when })); setShowDates(false); }} />
    </View>
  );
}

function DatesSheet({ visible, onClose, onApply }: { visible: boolean; onClose: () => void; onApply: (w: { start: string; end: string }) => void }) {
  const p = usePalette();
  const [start, setStart] = useState({ date: istDate(1), time: '10:00' });
  const [end, setEnd] = useState({ date: istDate(1), time: '18:00' });
  const startIso = useMemo(() => istInstant(start.date, start.time), [start]);
  const endIso = useMemo(() => istInstant(end.date, end.time), [end]);
  const valid = new Date(endIso).getTime() > new Date(startIso).getTime();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <View style={{ backgroundColor: p.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 30, maxHeight: '85%' }}>
          <ScrollView>
            <Text style={{ fontSize: 17, fontWeight: '900', color: p.text, marginBottom: 12 }}>When do you need it?</Text>
            <DateTimeSelect label="Pickup" date={start.date} time={start.time} onChange={(v) => { setStart(v); if (v.date > end.date) setEnd({ ...end, date: v.date }); }} />
            <DateTimeSelect label="Return" date={end.date} time={end.time} minDate={start.date} onChange={setEnd} />
            {!valid ? <Text style={{ color: p.danger, fontSize: 12, marginBottom: 8 }}>Return must be after pickup.</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn label="Cancel" kind="secondary" onPress={onClose} style={{ flex: 1 }} />
              <Btn label="Show free vehicles" disabled={!valid} onPress={() => onApply({ start: startIso, end: endIso })} style={{ flex: 2 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
