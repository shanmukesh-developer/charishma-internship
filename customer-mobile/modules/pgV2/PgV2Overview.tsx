/**
 * Screen 7 · PG Overview (room theme): photo gallery with thumbnails, name and badge, rating, rent,
 * Overview / Rooms / Amenities / Mess tabs, and Call (the ZCS housing desk) / Book Now.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Share, Linking, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PG2, R, GUTTER, W, genderTone, shadow } from './pgV2Theme';
import { Header, Tap, Photo, Verified, Rating, PrimaryButton, OutlineButton, EmptyState, Loading, k } from './PgV2Kit';
import { IShare, IPhone, ICalendarCheck, IBuilding, ICheck, STROKE } from './PgV2Icons';
import { galleryPhotos } from './pgV2Photos';
import { usePgDetail, gKey, rentRange, placeText, kmText } from './pgV2Data';
import { useNav, usePgIdFor } from './pgV2Nav';
import { AmenityGroups, normaliseAmenities } from './PgV2Amenities';
import { MessTimingRows, FoodNote } from './PgV2Facilities';
import { RoomCard } from './PgV2Rooms';
import { ZENVY_SUPPORT_WHATSAPP } from '../../constants/api';
import { inr, pgLink, type PgDetail } from '../../modules/pg/pgApi';

type Tab = 'overview' | 'rooms' | 'amenities' | 'mess';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'rooms', label: 'Rooms' }, { key: 'amenities', label: 'Amenities' }, { key: 'mess', label: 'Mess' },
];

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.fact}>
      <Text style={k.small}>{label}</Text>
      <Text style={st.factValue}>{value}</Text>
    </View>
  );
}

function TabBody({ tab, pg }: { tab: Tab; pg: PgDetail }) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  if (tab === 'overview') {
    const km = kmText(pg.distanceFromCollege);
    const facts = [
      km ? { label: 'From campus', value: km } : null,
      pg.securityDeposit > 0 ? { label: 'Security deposit', value: inr(pg.securityDeposit) } : null,
      pg.roomTypes.length ? { label: 'Beds free now', value: String(pg.bedsAvailable) } : null,
    ].filter(Boolean) as { label: string; value: string }[];
    return (
      <View style={{ gap: 16 }}>
        {facts.length ? <View style={{ flexDirection: 'row', gap: 10 }}>{facts.map((f) => <Fact key={f.label} {...f} />)}</View> : null}
        {pg.description ? <Text style={k.body}>{pg.description}</Text> : null}
        {(pg.highlights || []).length ? (
          <View style={{ gap: 8 }}>
            {(pg.highlights || []).map((h) => (
              <View key={h} style={[k.row, { gap: 10, alignItems: 'flex-start' }]}>
                <View style={st.tick}><ICheck size={12} color={PG2.primary} strokeWidth={2.25} /></View>
                <Text style={[k.body, { flex: 1 }]}>{h}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text style={k.small}>{pg.address}</Text>
      </View>
    );
  }
  if (tab === 'rooms') {
    if (!pg.roomTypes.length) return <Text style={k.small}>Room types haven't been added yet.</Text>;
    const photoW = Math.round(Math.min(118, (width - GUTTER * 2) * 0.3));
    return <View style={{ gap: 12 }}>{pg.roomTypes.map((t) => <RoomCard key={t.key} pg={pg} t={t} photoW={photoW} onPress={() => nav.push({ name: 'room', pgId: pg.id, roomKey: t.key })} />)}</View>;
  }
  if (tab === 'amenities') {
    return pg.amenities.length ? <AmenityGroups items={normaliseAmenities(pg.amenities)} /> : <Text style={k.small}>Amenities haven't been added yet.</Text>;
  }
  const mess = pg.messTimetable && pg.messTimetable.meals.length ? pg.messTimetable : null;
  if (!mess) return <Text style={k.small}>The mess timetable hasn't been added yet.</Text>;
  return (
    <View>
      <MessTimingRows t={mess} />
      <FoodNote t={mess} />
      <OutlineButton label="Timetable and weekly menu" onPress={() => nav.push({ name: 'mess', pgId: pg.id })} style={{ marginTop: 14 }} />
    </View>
  );
}

export default function PgV2Overview() {
  const nav = useNav();
  const id = usePgIdFor();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { pg, state } = usePgDetail(id);
  const [index, setIndex] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');

  const share = () => { if (pg) Share.share({ message: `${pg.name}, ${pg.address}\n${pgLink(pg.id)}` }).catch(() => {}); };
  const right = <Tap onPress={share} label="Share" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><IShare size={19} color={PG2.ink} strokeWidth={STROKE} /></Tap>;
  if (state === 'loading') return <View style={st.page}><Header title="PG Details" onBack={nav.back} /><Loading /></View>;
  if (!pg) return <View style={st.page}><Header title="PG Details" onBack={nav.back} /><EmptyState icon={IBuilding} title="This PG isn't available" action="Back" onAction={nav.back} /></View>;

  const photos = galleryPhotos(pg);
  const thumbs = photos.slice(0, 5);
  const thumbW = Math.floor((width - GUTTER * 2 - 8 * 4) / 5);
  const g = gKey(pg.genderType);
  const rent = rentRange(pg);

  return (
    <View style={st.page}>
      <Header title="PG Details" onBack={nav.back} right={right} />
      <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        <View style={{ paddingHorizontal: GUTTER }}>
          <Photo photo={photos[index]} style={{ height: Math.round((width - GUTTER * 2) * 0.56) }} radius={R.lg} priority="high" />
          <View style={st.thumbs}>
            {thumbs.map((p, i) => (
              <Tap key={p.key} onPress={() => setIndex(i)} label={`Photo ${i + 1}${p.caption ? `, ${p.caption}` : ''}`} selected={i === index}
                style={[st.thumb, { width: thumbW, height: Math.round(thumbW * 0.8) }, i === index && { borderColor: PG2.primary }]}>
                <Photo photo={p} style={StyleSheet.absoluteFill} radius={8} />
              </Tap>
            ))}
          </View>
          <View style={[k.row, { gap: 10, marginTop: 18, flexWrap: 'wrap' }]}>
            <Text style={st.name}>{pg.name}</Text>
            {pg.isVerified ? <Verified /> : null}
          </View>
          <View style={[k.row, { marginTop: 6, gap: 8 }]}>
            <Text style={[st.type, { color: genderTone(g).ink }]}>{g} PG</Text>
            <Text style={{ color: PG2.line }}>|</Text>
            <Text style={st.place} numberOfLines={1}>{placeText(pg)}</Text>
          </View>
          {pg.reviewSummary?.count ? <View style={{ marginTop: 10 }}><Rating summary={pg.reviewSummary} size={13} /></View> : null}
          {rent ? <Text style={st.rent}>{rent}<Text style={st.unit}>/month</Text></Text> : null}
        </View>

        <View style={st.tabs} accessibilityRole="tablist">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <Tap key={t.key} onPress={() => setTab(t.key)} role="tab" selected={on} label={t.label} style={[st.tab, on && st.tabOn]}>
                <Text style={[st.tabText, on && { color: PG2.primary, fontWeight: W.label }]}>{t.label}</Text>
              </Tap>
            );
          })}
        </View>
        <View style={{ paddingHorizontal: GUTTER }}><TabBody tab={tab} pg={pg} /></View>
      </ScrollView>
      <View style={[st.bar, { paddingBottom: insets.bottom + 14 }]}>
        <OutlineButton label="Call" icon={IPhone} onPress={() => Linking.openURL(`tel:+${ZENVY_SUPPORT_WHATSAPP}`).catch(() => {})} style={{ flex: 1, height: 54 }} />
        <PrimaryButton label="Book Now" icon={ICalendarCheck} onPress={() => nav.push({ name: 'booking', pgId: pg.id })} style={{ flex: 1.15 }} disabled={!pg.roomTypes.some((t) => t.bookRoomId)} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  thumbs: { flexDirection: 'row', gap: 8, marginTop: 10 },
  thumb: { borderRadius: 10, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  name: { fontSize: 20, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.3, flexShrink: 1 },
  type: { fontSize: 13, fontWeight: W.label },
  place: { flex: 1, fontSize: 13, color: PG2.muted },
  rent: { marginTop: 10, fontSize: 21, fontWeight: W.title, color: PG2.price, letterSpacing: -0.3 },
  unit: { fontSize: 14, fontWeight: W.label, color: PG2.ink },
  tabs: { flexDirection: 'row', paddingHorizontal: GUTTER, gap: 8, paddingVertical: 18 },
  tab: { flex: 1, height: 40, paddingHorizontal: 4, borderRadius: R.pill, borderWidth: 1, borderColor: PG2.line, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  tabOn: { borderColor: PG2.primary, borderWidth: 1.25 },
  tabText: { fontSize: 13.5, color: PG2.ink2 },
  fact: { flex: 1, backgroundColor: PG2.page, borderRadius: R.md, padding: 12, borderWidth: 1, borderColor: PG2.lineSoft },
  factValue: { marginTop: 4, fontSize: 15, fontWeight: W.title, color: PG2.ink },
  tick: { width: 20, height: 20, borderRadius: 10, backgroundColor: PG2.lavender, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, paddingHorizontal: GUTTER, paddingTop: 12, backgroundColor: 'rgba(255,255,255,0.97)', ...shadow(2) },
});
