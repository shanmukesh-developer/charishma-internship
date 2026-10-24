// Rooms & availability: room types (rent, beds, bathroom, AC) with the free beds of every room. The owner sets
// free beds with − / + and saves once (PUT /listings/:id/availability). These numbers are exactly what students
// see ("Available N" / "Full") and what the dashboard's Total / Occupied / Vacant come from. Rent, beds and
// room setup are changed by the ZCS housing team.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorStrip, SkeletonCard, Stepper } from '../ui/kit';
import { Banner, MenuGroup, MenuRow, Screen } from '../ui/Screen';
import { ListingSwitcher } from '../ui/ListingSwitcher';
import { useListing } from '../state/ListingProvider';
import { useHome } from '../state/HomeProvider';
import { useToast } from '../ui/Toast';
import { ownerApi } from '../api/ownerApi';
import { errorMessage } from '../lib/http';
import { rupees } from '../lib/format';
import type { Room, RoomType } from '../types';
import type { TabProps } from './Home';

const typeFacts = (t: RoomType) => [
  `${t.sharingType}-sharing`,
  t.hasAC ? 'AC' : 'Non-AC',
  t.hasAttachedBathroom ? 'Attached bath' : 'Common bath',
].join(' · ');

export default function RoomsTab({ open }: TabProps) {
  const { detail, loading, error, reload, setDetail, current } = useListing();
  const { refresh: refreshHome } = useHome();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A fresh detail (another phone, a booking accepted) resets the draft.
  useEffect(() => { setDraft({}); setSaveError(null); }, [detail]);

  const rooms = useMemo(() => (detail?.rooms || []).filter((r) => r.isActive), [detail]);
  const byType = useMemo(() => {
    const m = new Map<string, Room[]>();
    for (const r of rooms) {
      if (!m.has(r.roomTypeKey)) m.set(r.roomTypeKey, []);
      m.get(r.roomTypeKey)!.push(r);
    }
    return m;
  }, [rooms]);
  const freeOf = (r: Room) => (draft[r.id] !== undefined ? draft[r.id] : r.availableBeds);
  const changed = rooms.filter((r) => draft[r.id] !== undefined && draft[r.id] !== r.availableBeds);

  const save = async () => {
    if (!detail || !changed.length || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await ownerApi.saveAvailability(detail.id, changed.map((x) => ({ id: x.id, availableBeds: draft[x.id] })));
      setDetail(r.listing);
      toast.show('Availability saved. Students see it now.', 'success');
      refreshHome();
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const totalFree = rooms.reduce((a, r) => a + freeOf(r), 0);
  const totalBeds = rooms.reduce((a, r) => a + r.totalBeds, 0);

  return (
    <Screen
      title="Rooms & availability"
      subtitle={current?.name}
      right={<ListingSwitcher />}
      refreshing={loading && !!detail}
      onRefresh={reload}
      tabBarSpace
      footer={changed.length ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Undo" variant="secondary" onPress={() => setDraft({})} style={{ flex: 1 }} disabled={saving} />
          <Button label={`Save ${changed.length} change${changed.length === 1 ? '' : 's'}`} icon="checkmark" onPress={save} loading={saving} style={{ flex: 2 }} />
        </View>
      ) : undefined}
    >
      <MenuGroup>
        <MenuRow icon="people-outline" title="Tenants" sub="Students staying with you, move-in dates, move-outs" onPress={() => open('Tenants')} last />
      </MenuGroup>

      {error && !detail ? <ErrorStrip text={error} onRetry={reload} busy={loading} /> : null}
      {!detail && !error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {saveError ? <Banner tone="error" text={saveError} /> : null}

      {detail && !rooms.length ? (
        <EmptyState icon="bed-outline" title="No rooms listed yet" body="The ZCS housing team adds your rooms and rents. Call support to set them up." />
      ) : null}

      {detail && rooms.length ? (
        <Card style={st.summary}>
          <Ionicons name="information-circle-outline" size={18} color={color.primaryDark} />
          <Text style={[font.small, { color: color.primaryDark, flex: 1, fontWeight: '600' }]}>
            {totalFree} of {totalBeds} beds free. Set free beds when someone moves in or out outside the app. Accepting a request takes a bed automatically.
          </Text>
        </Card>
      ) : null}

      {detail?.roomTypes.map((t) => {
        const list = byType.get(t.key) || [];
        const free = list.reduce((a, r) => a + freeOf(r), 0);
        return (
          <Card key={t.key} style={{ gap: space.sm }}>
            <View style={st.typeHead}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[font.h3, { color: color.text }]}>{t.label}</Text>
                <Text style={[font.small, { color: color.textMuted }]}>{typeFacts(t)}</Text>
              </View>
              {free > 0 ? <Badge text={`Available ${free}`} fg={color.ok} bg={color.okTint} /> : <Badge text="Full" fg={color.alertDark} bg={color.alertTint} />}
            </View>
            <View style={st.facts}>
              <Text style={[font.h3, { color: color.primaryDark }]}>{t.rentFrom === t.rentTo || t.rentTo === null ? rupees(t.rentFrom) : `${rupees(t.rentFrom)} – ${rupees(t.rentTo)}`}<Text style={[font.small, { color: color.textMuted }]}> /bed /month</Text></Text>
              <Text style={[font.small, { color: color.textMuted }]}>{t.roomCount} room{t.roomCount === 1 ? '' : 's'} · {t.totalBeds} beds</Text>
            </View>
            {list.map((r) => {
              const v = freeOf(r);
              const dirty = draft[r.id] !== undefined && draft[r.id] !== r.availableBeds;
              return (
                <View key={r.id} style={[st.room, dirty && { borderColor: color.primary, backgroundColor: color.primaryTint }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>Room {r.roomNumber}</Text>
                    <Text style={[font.small, { color: color.textMuted }]}>{r.totalBeds} beds{r.floorNumber !== null && r.floorNumber !== undefined ? ` · Floor ${r.floorNumber}` : ''}{r.hasBalcony ? ' · Balcony' : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Stepper value={v} max={r.totalBeds} label="free beds" onChange={(n) => setDraft((d) => ({ ...d, [r.id]: n }))} />
                    <Text style={[font.label, { color: color.textMuted }]}>FREE BEDS</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        );
      })}
      {detail && rooms.length ? (
        <Text style={[font.small, { color: color.textMuted, textAlign: 'center' }]}>To change rents, beds or add rooms, ask the ZCS housing team.</Text>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  summary: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start', backgroundColor: color.primaryTint, borderColor: color.primarySoft },
  typeHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  facts: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  room: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: space.xs },
});
