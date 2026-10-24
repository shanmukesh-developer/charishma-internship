/**
 * Screen 8 · Room details: photo, room type and rent, beds and bath, the room's amenity row (from the
 * room type: beds, bath, AC, balcony, furnishing, plus the building's Wi-Fi), Room Photos and
 * "Request to Book". Room size is not stored yet, so it is not shown.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from 'lucide-react-native';
import { PG2, GUTTER, W, shadow } from './pgV2Theme';
import { Tap, FloatBtn, Photo, SectionTitle, PrimaryButton, EmptyState, Loading, Pill, k } from './PgV2Kit';
import { AmenityRows } from './PgV2Amenities';
import { IArrowLeft, IBed, IBath, ISnow, ISofa, IWifi, IDoor, IBedSingle } from './PgV2Icons';
import { roomPhotos } from './pgV2Photos';
import { usePgDetail, roomTypeName, bedsText, bathText } from './pgV2Data';
import { useNav, usePgIdFor } from './pgV2Nav';
import { rentText } from '../../modules/pg/PgRooms';
import type { PgDetail, PgRoomType } from '../../modules/pg/pgApi';

const titleOf = (t: PgRoomType) => {
  const n = roomTypeName(t.sharingType);
  return /room|dormitory/i.test(n) ? n : `${n} Room`;
};

const roomAmenities = (pg: PgDetail, t: PgRoomType): { icon: LucideIcon; label: string }[] => [
  { icon: t.sharingType <= 1 ? IBedSingle : IBed, label: bedsText(t.sharingType) },
  { icon: IBath, label: bathText(t) },
  t.hasAC ? { icon: ISnow, label: 'AC' } : null,
  t.hasBalcony ? { icon: IDoor, label: 'Balcony' } : null,
  t.furnishing ? { icon: ISofa, label: t.furnishing.replace(/\b\w/g, (c) => c.toUpperCase()) } : null,
  pg.amenities.some((a) => /wi-?fi|internet/i.test(a)) ? { icon: IWifi, label: 'Wi-Fi' } : null,
].filter(Boolean) as { icon: LucideIcon; label: string }[];

export default function PgV2RoomDetail() {
  const nav = useNav();
  const id = usePgIdFor();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { pg, state } = usePgDetail(id);
  const [index, setIndex] = useState(0);

  if (state === 'loading') return <View style={st.page}><Loading /></View>;
  const t = pg ? pg.roomTypes.find((x) => x.key === nav.route.roomKey) || pg.roomTypes[0] : null;
  if (!pg || !t) {
    return (
      <View style={[st.page, { paddingTop: insets.top + 40 }]}>
        <EmptyState icon={IBed} title="No room types yet" body="This PG hasn't listed its rooms." action="Back" onAction={nav.back} />
      </View>
    );
  }
  const photos = roomPhotos(pg, t);
  const facts = [bedsText(t.sharingType), bathText(t), t.hasAC ? 'AC' : 'Non-AC'].join(' • ');
  const amen = roomAmenities(pg, t);
  const cellW = Math.floor((width - GUTTER * 2) / Math.min(5, Math.max(4, amen.length)));
  const full = t.availableBeds <= 0 || !t.bookRoomId;
  const rent = rentText(t);
  const thumbW = Math.round((width - GUTTER * 2 - 30) / 3.6);

  return (
    <View style={st.page}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        <View>
          <Photo photo={photos[index]} style={{ width, height: Math.round(width * 0.66) + insets.top }} radius={0} priority="high" />
          <View style={[st.float, { top: insets.top + 12 }]}>
            <FloatBtn icon={IArrowLeft} label="Back" onPress={nav.back} />
            <View style={st.floatTitle}><Text style={st.floatTitleText}>Room Details</Text></View>
          </View>
          <View style={st.tag}><Text style={st.tagText}>{roomTypeName(t.sharingType)}</Text></View>
        </View>
        <View style={st.sheet}>
          <Text style={st.title}>{titleOf(t)}</Text>
          {rent ? <Text style={st.rent}>{rent}<Text style={st.unit}>/month</Text></Text> : null}
          <View style={[k.row, { marginTop: 6, gap: 10, flexWrap: 'wrap' }]}>
            <Text style={st.facts}>{facts}</Text>
            {full ? <Pill text="Full" ink={PG2.red} soft={PG2.redSoft} /> : <Pill text={`${t.availableBeds} of ${t.totalBeds} beds free`} ink={PG2.green} soft={PG2.greenSoft} />}
          </View>
          <Text style={[k.small, { marginTop: 6 }]}>{pg.name}</Text>

          <View style={{ marginTop: 20 }}>
            <AmenityRows items={amen.map((a) => ({ key: a.label, label: a.label, icon: a.icon, group: 'Comfort' as const }))} />
          </View>

          <SectionTitle title="Room Photos" style={{ marginTop: 26 }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {photos.map((p, i) => (
              <Tap key={p.key} onPress={() => setIndex(i)} label={`Photo ${i + 1}${p.caption ? `, ${p.caption}` : ''}`} selected={i === index}
                style={[st.thumb, { width: thumbW, height: Math.round(thumbW * 0.7) }, i === index && { borderColor: PG2.primary }]}>
                <Photo photo={p} style={StyleSheet.absoluteFill} radius={10} />
              </Tap>
            ))}
          </ScrollView>
          {t.deposit ? <Text style={[k.small, { marginTop: 18 }]}>Security deposit {`₹${Math.round(t.deposit).toLocaleString('en-IN')}`}</Text> : null}
        </View>
      </ScrollView>
      <View style={[st.bar, { paddingBottom: insets.bottom + 14 }]}>
        <PrimaryButton label={full ? 'Room full' : 'Request to Book'} disabled={full} onPress={() => nav.push({ name: 'booking', pgId: pg.id, roomKey: t.key })} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  float: { position: 'absolute', left: GUTTER, right: GUTTER, flexDirection: 'row', alignItems: 'center', gap: 12 },
  floatTitle: { backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 999, paddingHorizontal: 14, height: 34, justifyContent: 'center' },
  floatTitleText: { fontSize: 14.5, fontWeight: W.title, color: PG2.ink },
  tag: { position: 'absolute', left: GUTTER, bottom: 36, backgroundColor: 'rgba(241,239,254,0.92)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  tagText: { fontSize: 12, fontWeight: W.label, color: PG2.lavenderInk },
  sheet: { marginTop: -22, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#FFFFFF', paddingHorizontal: GUTTER, paddingTop: 20 },
  title: { fontSize: 19, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.2 },
  rent: { marginTop: 6, fontSize: 17, fontWeight: W.title, color: PG2.ink },
  unit: { fontSize: 14, fontWeight: W.body, color: PG2.ink2 },
  facts: { fontSize: 13, color: PG2.muted },
  thumb: { borderRadius: 12, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: 12, backgroundColor: 'rgba(255,255,255,0.97)', ...shadow(2) },
});
