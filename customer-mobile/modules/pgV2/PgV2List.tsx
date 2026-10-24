/**
 * Screen 2 · PG Buildings list: location line with search, All / Boys / Girls / Co-ed chips and building
 * cards (photo, Verified when verified, name, type pill, rating when reviewed, rent, distance, save).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { PG2, R, GUTTER, W, genderTone, type GenderKey } from './pgV2Theme';
import { Header, Tap, Photo, Chip, GenderPill, Verified, Rating, EmptyState, Loading, k } from './PgV2Kit';
import { IMapPin, ISearch, IHeart, IX, IUser, IUsers, ILayers, IBuilding, STROKE } from './PgV2Icons';
import { buildingPhoto } from './pgV2Photos';
import { usePgV2, gKey, kmText, rentFromText, inBudget, BUDGETS } from './pgV2Data';
import { useNav } from './pgV2Nav';
import type { PgListItem } from '../../modules/pg/pgApi';

type Filter = 'All' | GenderKey;
const FILTERS: Filter[] = ['All', 'Boys', 'Girls', 'Co-ed'];

function ListCard({ pg, photoW, saved, onSave, onPress }: { pg: PgListItem; photoW: number; saved: boolean; onSave: () => void; onPress: () => void }) {
  const rent = rentFromText(pg);
  const km = kmText(pg.distanceFromCollege);
  return (
    <View style={k.card}>
      <Tap onPress={onPress} label={pg.name} style={st.card}>
        <Photo photo={buildingPhoto(pg)} style={{ width: photoW, height: photoW * 1.04 }} radius={12} />
        <View style={st.info}>
          {pg.isVerified ? <Verified small /> : null}
          <Text style={[st.name, pg.isVerified && { marginTop: 6 }]} numberOfLines={2}>{pg.name}</Text>
          <GenderPill g={gKey(pg.genderType)} style={{ marginTop: 6 }} />
          {pg.reviewSummary?.count ? <View style={{ marginTop: 8 }}><Rating summary={pg.reviewSummary} size={12} /></View> : null}
          {rent ? (
            <Text style={st.rent} numberOfLines={1}>
              <Text style={st.rentFrom}>From </Text>{rent}<Text style={st.rentUnit}>/month</Text>
            </Text>
          ) : null}
          {km ? (
            <View style={[k.row, { marginTop: 6 }]}>
              <IMapPin size={13} color={PG2.muted} strokeWidth={STROKE} />
              <Text style={st.km}>{km} from campus</Text>
            </View>
          ) : null}
        </View>
      </Tap>
      <Tap onPress={onSave} label={saved ? 'Remove from saved' : 'Save'} style={st.heart}>
        <IHeart size={19} color={saved ? PG2.red : PG2.muted} fill={saved ? PG2.red : 'transparent'} strokeWidth={STROKE} />
      </Tap>
    </View>
  );
}

export default function PgV2List() {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const { list, listState, reloadList, saved, toggleSaved } = usePgV2();
  const [filter, setFilter] = useState<Filter>(nav.route.gender || 'All');
  const [q, setQ] = useState(nav.route.q || '');
  const [searching, setSearching] = useState(!!nav.route.q || !!nav.route.searchFocus);
  const [budget, setBudget] = useState(nav.route.budget || 'any');
  const savedOnly = !!nav.route.savedOnly;
  const photoW = Math.round(Math.min(132, Math.max(104, (width - GUTTER * 2) * 0.34)));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((p) => (filter === 'All' || gKey(p.genderType) === filter) && inBudget(p, budget)
      && (!savedOnly || saved.has(p.id))
      && (!needle || `${p.name} ${p.address} ${p.area || ''}`.toLowerCase().includes(needle)));
  }, [list, filter, q, budget, savedOnly, saved]);
  const budgetLabel = BUDGETS.find((b) => b.key === budget && b.key !== 'any')?.label;

  const chipIcon = (f: Filter) => (f === 'All' ? ILayers : f === 'Co-ed' ? IUsers : IUser);

  return (
    <View style={{ flex: 1, backgroundColor: PG2.page }}>
      <Header title={savedOnly ? 'Saved PGs' : 'PG Buildings'} onBack={nav.back} />
      <View style={st.locRow}>
        {searching ? (
          <View style={st.searchBox}>
            <ISearch size={17} color={PG2.muted} strokeWidth={STROKE} />
            <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Search PG name or area" placeholderTextColor={PG2.faint} style={st.searchInput} accessibilityLabel="Search PGs" />
            <Tap onPress={() => { setQ(''); setSearching(false); }} label="Close search" style={st.iconBtn}><IX size={18} color={PG2.ink2} strokeWidth={STROKE} /></Tap>
          </View>
        ) : (
          <>
            <IMapPin size={17} color={PG2.ink} strokeWidth={STROKE} />
            <Text style={st.loc} numberOfLines={1}>Near SRM AP campus, Amaravati</Text>
            <Tap onPress={() => setSearching(true)} label="Search" style={st.iconBtn}><ISearch size={20} color={PG2.ink} strokeWidth={STROKE} /></Tap>
          </>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={st.chips}>
        {FILTERS.map((f) => (
          <Chip key={f} label={f} on={filter === f} onPress={() => setFilter(f)} icon={chipIcon(f)}
            />
        ))}
        {budgetLabel ? (
          <Tap onPress={() => setBudget('any')} label={`Clear budget ${budgetLabel}`} style={st.budgetChip}>
            <Text style={st.budgetChipText}>{budgetLabel}</Text>
            <IX size={14} color={PG2.primary} strokeWidth={2} />
          </Tap>
        ) : null}
      </ScrollView>
      <ScrollView contentContainerStyle={{ padding: GUTTER, paddingTop: 6, gap: 14, paddingBottom: 40 }}>
        {listState === 'loading' && !list.length ? <Loading /> : null}
        {listState === 'error' && !list.length ? <EmptyState icon={IBuilding} title="Couldn't load PGs" body="Check your internet and try again." action="Try again" onAction={reloadList} /> : null}
        {listState === 'ready' && !shown.length ? (
          <EmptyState icon={IBuilding} title={savedOnly ? 'No saved PGs yet' : list.length ? 'No PGs match' : 'No PGs listed yet'} body={savedOnly ? 'Tap the heart on a PG to keep it here.' : list.length ? 'Try another filter or search.' : 'New buildings near campus will show up here.'} />
        ) : null}
        {shown.map((pg) => (
          <ListCard key={pg.id} pg={pg} photoW={photoW} saved={saved.has(pg.id)} onSave={() => toggleSaved(pg.id)} onPress={() => nav.push({ name: 'building', pgId: pg.id })} />
        ))}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: GUTTER, minHeight: 48 },
  loc: { flex: 1, fontSize: 14, color: PG2.ink2, fontWeight: W.label },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderRadius: R.md, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: PG2.line, paddingLeft: 12 },
  searchInput: { flex: 1, height: 44, fontSize: 14, color: PG2.ink, outlineStyle: 'none' } as any,
  chips: { paddingHorizontal: GUTTER, gap: 10, paddingVertical: 10 },
  card: { flexDirection: 'row', padding: 12, gap: 14, alignItems: 'flex-start' },
  info: { flex: 1, minWidth: 0, paddingTop: 2, paddingRight: 26 },
  name: { fontSize: 15, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.1 },
  rent: { marginTop: 8, fontSize: 14.5, fontWeight: W.title, color: PG2.ink },
  rentFrom: { fontSize: 12.5, fontWeight: W.body, color: PG2.muted },
  rentUnit: { fontSize: 12.5, fontWeight: W.body, color: PG2.ink2 },
  km: { fontSize: 12, color: PG2.muted },
  budgetChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: 1.25, borderColor: PG2.primary, backgroundColor: '#FFFFFF' },
  budgetChipText: { fontSize: 13, fontWeight: W.label, color: PG2.primary },
  heart: { position: 'absolute', top: 4, right: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
