/**
 * Screen 6 · Room types & availability. Opened from a building it lists that building's room types;
 * opened on its own it lists room types across all buildings, with Boys / Girls / Co-ed tabs.
 * Chips: All Types, Single, Double, Triple (and Dormitory when one exists). Cards show the rent per bed
 * a month, beds and bath, and "Available N" or "Full" from the live bed count.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { PG2, GUTTER, W, type GenderKey } from './pgV2Theme';
import { Header, Tap, Photo, Chip, Pill, Segmented, EmptyState, Loading, k } from './PgV2Kit';
import { IBed, ICheck } from './PgV2Icons';
import { roomCover } from './pgV2Photos';
import { usePgV2, usePgDetail, usePgDetails, gKey, roomTypeName, sharingFilterKey, bedsText, bathText } from './pgV2Data';
import { useNav } from './pgV2Nav';
import { rentText } from './pgV2Data';
import type { PgDetail, PgRoomType } from '../../modules/pg/pgApi';
import { themedSheet } from '../../utils/themeNow';

type TypeFilter = 'all' | 'single' | 'double' | 'triple' | 'dorm';
const TYPE_LABEL: Record<TypeFilter, string> = { all: 'All Types', single: 'Single', double: 'Double', triple: 'Triple', dorm: 'Dormitory' };

export function RoomCard({ pg, t, showPg, photoW, onPress }: { pg: PgDetail; t: PgRoomType; showPg?: boolean; photoW: number; onPress: () => void }) {
  const full = t.availableBeds <= 0 || !t.bookRoomId;
  const facts = [bedsText(t.sharingType), bathText(t), t.hasAC ? 'AC' : ''].filter(Boolean).join(' • ');
  const rent = rentText(t);
  return (
    <Tap onPress={onPress} label={`${roomTypeName(t.sharingType)} at ${pg.name}`} style={[k.card, st.card]}>
      <Photo photo={roomCover(pg, t)} style={{ width: photoW, height: Math.round(photoW * 0.86) }} radius={12} />
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 2 }}>
        <Text style={st.title} numberOfLines={1}>{roomTypeName(t.sharingType)}</Text>
        {rent ? <Text style={st.rent}>{rent}<Text style={st.unit}>/month</Text></Text> : null}
        <Text style={st.facts} numberOfLines={1}>{facts}</Text>
        {showPg ? <Text style={st.pg} numberOfLines={1}>{pg.name}</Text> : null}
        {full ? null : (
          <Pill icon={ICheck} text={t.sharingType <= 1 && t.availableBeds === 1 ? 'Available' : `${t.availableBeds} Available`} ink={PG2.green} soft={PG2.greenSoft} style={{ marginTop: 9, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999 }} />
        )}
      </View>
      {full ? <Pill text="Full" ink={PG2.red} soft={PG2.redSoft} style={st.full} /> : null}
    </Tap>
  );
}

function RoomList({ rows, showPg }: { rows: { pg: PgDetail; t: PgRoomType }[]; showPg: boolean }) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const photoW = Math.round(Math.min(128, Math.max(100, (width - GUTTER * 2) * 0.32)));
  const [filter, setFilter] = useState<TypeFilter>('all');
  const kinds = useMemo(() => {
    const present = new Set(rows.map((r) => sharingFilterKey(r.t.sharingType)));
    return (['all', 'single', 'double', 'triple', 'dorm'] as TypeFilter[]).filter((f) => f === 'all' || f !== 'dorm' || present.has('dorm'));
  }, [rows]);
  const shown = rows.filter((r) => filter === 'all' || sharingFilterKey(r.t.sharingType) === filter);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 10, paddingVertical: 12 }}>
        {kinds.map((f) => <Chip key={f} label={TYPE_LABEL[f]} on={filter === f} onPress={() => setFilter(f)} outline />)}
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 40, gap: 14 }}>
        {!shown.length ? <EmptyState icon={IBed} title={rows.length ? `No ${TYPE_LABEL[filter].toLowerCase()} rooms` : 'No rooms listed yet'} body={rows.length ? 'Try another room type.' : 'Room types appear here once the PG adds them.'} /> : null}
        {shown.map(({ pg, t }) => (
          <RoomCard key={`${pg.id}-${t.key}`} pg={pg} t={t} showPg={showPg} photoW={photoW} onPress={() => nav.push({ name: 'room', pgId: pg.id, roomKey: t.key })} />
        ))}
      </ScrollView>
    </>
  );
}

function BuildingRooms({ pgId }: { pgId: string }) {
  const { pg, state } = usePgDetail(pgId);
  if (state === 'loading') return <Loading />;
  if (!pg) return <EmptyState icon={IBed} title="This PG isn't available" />;
  return (
    <>
      <Text style={st.scope} numberOfLines={1}>{pg.name}</Text>
      <RoomList rows={pg.roomTypes.map((t) => ({ pg, t }))} showPg={false} />
    </>
  );
}

function AllRooms() {
  const nav = useNav();
  const { list } = usePgV2();
  const [g, setG] = useState<GenderKey>(nav.route.gender || 'Boys');
  const ids = useMemo(() => list.filter((p) => gKey(p.genderType) === g).map((p) => p.id), [list, g]);
  const { map, loading } = usePgDetails(ids);
  const rows = useMemo(() => ids.flatMap((id) => (map[id] ? map[id].roomTypes.map((t) => ({ pg: map[id], t })) : [])), [ids, map]);
  return (
    <>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 4 }}>
        <Segmented variant="soft" value={g} onChange={setG} options={[{ key: 'Boys', label: 'Boys' }, { key: 'Girls', label: 'Girls' }, { key: 'Co-ed', label: 'Co-ed' }]} />
      </View>
      {loading && !rows.length ? <Loading /> : <RoomList key={g} rows={rows} showPg />}
    </>
  );
}

export default function PgV2Rooms() {
  const nav = useNav();
  return (
    <View style={{ flex: 1, backgroundColor: PG2.page }}>
      <Header title="All Rooms" onBack={nav.back} />
      {nav.route.pgId ? <BuildingRooms pgId={nav.route.pgId} /> : <AllRooms />}
    </View>
  );
}

const st = themedSheet(() => ({
  card: { flexDirection: 'row', gap: 14, padding: 12, alignItems: 'flex-start' },
  title: { fontSize: 15, fontWeight: W.title, color: PG2.ink },
  rent: { marginTop: 5, fontSize: 15, fontWeight: W.title, color: PG2.ink2 },
  unit: { fontSize: 13, fontWeight: W.body, color: PG2.ink2 },
  facts: { marginTop: 4, fontSize: 12.5, color: PG2.muted },
  pg: { marginTop: 3, fontSize: 12, color: PG2.lavenderInk },
  full: { position: 'absolute', right: 12, bottom: 14 },
  scope: { paddingHorizontal: GUTTER, fontSize: 13.5, color: PG2.muted, marginTop: -4 },
}));
