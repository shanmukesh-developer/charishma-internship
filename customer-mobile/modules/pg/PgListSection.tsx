/**
 * Others > PG stays: search, filters (residents, budget, distance) and the list of PG cards, with
 * matching skeletons, a calm empty state and an error state with retry. Data and refresh stay in the
 * Others tab (GET /api/pg, live-synced); this component only presents and filters it.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { genderKey, type PgListItem } from './pgApi';
import { PgListCard, PgListSkeleton } from './PgListCard';
import { usePgPalette, Press, StateMessage, IconAlert, IconBuilding, IconX, ICON, s as ui } from './ui';
import IconSearch from 'lucide-react-native/icons/search';

type Opt = { key: string; label: string };
const GENDER: Opt[] = [{ key: 'All', label: 'All' }, { key: 'Boys', label: 'Boys' }, { key: 'Girls', label: 'Girls' }, { key: 'Co-ed', label: 'Co-living' }];
const BUDGET: Opt[] = [{ key: 'All', label: 'Any budget' }, { key: '6000', label: 'Up to ₹6,000' }, { key: '8000', label: 'Up to ₹8,000' }, { key: '10000', label: 'Up to ₹10,000' }, { key: '15000', label: 'Up to ₹15,000' }];
const DISTANCE: Opt[] = [{ key: 'All', label: 'Any distance' }, { key: '1', label: 'Within 1 km' }, { key: '3', label: 'Within 3 km' }, { key: '5', label: 'Within 5 km' }];

function ChipRow({ options, value, onChange, label }: { options: Opt[]; value: string; onChange: (v: string) => void; label: string }) {
  const p = usePgPalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} accessibilityLabel={label} style={{ marginHorizontal: -16 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Press key={o.key} hitSlop={4} onPress={() => onChange(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${label}: ${o.label}`}
            style={[st.chip, { borderColor: on ? p.text : p.line, backgroundColor: on ? p.text : 'transparent' }]}>
            <Text style={[st.chipText, { color: on ? p.bg : p.sub }]}>{o.label}</Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

export function PgListSection({ pgs, loading, error, onRetry }: { pgs: PgListItem[]; loading: boolean; error: string | null; onRetry: () => void }) {
  const p = usePgPalette();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('All');
  const [budget, setBudget] = useState('All');
  const [distance, setDistance] = useState('All');

  const list = useMemo(() => pgs.filter((x) => {
    const q = query.trim().toLowerCase();
    if (q && ![x.name, x.address, x.area].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    if (gender !== 'All' && genderKey(x.genderType) !== gender) return false;
    if (budget !== 'All' && Number(x.rentFrom ?? x.baseRent) > Number(budget)) return false;
    if (distance !== 'All' && Number(x.distanceFromCollege) > Number(distance)) return false;
    return true;
  }), [pgs, query, gender, budget, distance]);
  const filtered = query.trim() !== '' || gender !== 'All' || budget !== 'All' || distance !== 'All';
  const reset = () => { setQuery(''); setGender('All'); setBudget('All'); setDistance('All'); };

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      <Text style={[st.title, { color: p.text }]} accessibilityRole="header">PG stays</Text>
      <Text style={[ui.body, { color: p.sub, marginTop: 2 }]}>Rooms near campus listed by the Zenvy housing team. Send a request and they'll call you to confirm.</Text>

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

      <View style={{ gap: 8, marginTop: 12 }}>
        <ChipRow options={GENDER} value={gender} onChange={setGender} label="Residents" />
        <ChipRow options={BUDGET} value={budget} onChange={setBudget} label="Budget" />
        <ChipRow options={DISTANCE} value={distance} onChange={setDistance} label="Distance" />
      </View>

      <View style={st.countRow}>
        <Text style={[ui.small, { color: p.muted }]} accessibilityLiveRegion="polite">
          {loading && !pgs.length ? 'Loading…' : error && !pgs.length ? '' : `${list.length} ${list.length === 1 ? 'PG' : 'PGs'}`}
        </Text>
        {filtered ? (
          <Press onPress={reset} accessibilityLabel="Clear filters" style={st.textBtn}>
            <Text style={[ui.small, { color: p.text, fontWeight: '600' }]}>Clear filters</Text>
          </Press>
        ) : null}
      </View>

      {loading && !pgs.length ? (
        <PgListSkeleton />
      ) : error && !pgs.length ? (
        <StateMessage icon={<IconAlert size={28} color={p.muted} strokeWidth={ICON.stroke} />} title="Couldn't load PGs" body={error} actionLabel="Try again" onAction={onRetry} />
      ) : !pgs.length ? (
        <StateMessage icon={<IconBuilding size={28} color={p.muted} strokeWidth={ICON.stroke} />} title="No PGs listed yet" body="The housing team is adding stays near campus. Pull down to check again." />
      ) : !list.length ? (
        <StateMessage title="No PGs match these filters" body="Try a higher budget or a longer distance." actionLabel="Clear filters" onAction={reset} />
      ) : (
        list.map((pg) => <PgListCard key={pg.id} pg={pg} onPress={() => router.push(`/pg/${pg.id}` as any)} />)
      )}
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingLeft: 12, marginTop: 16, minHeight: 44 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  clear: { alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8, minHeight: 44 },
  textBtn: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
