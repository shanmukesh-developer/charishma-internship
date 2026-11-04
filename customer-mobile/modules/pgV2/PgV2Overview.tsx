/**
 * PG Overview, fully loaded: photo gallery (full-screen viewer), name, rating and rent, then sticky
 * section tabs that jump to and follow the sections: Overview, Rooms, Amenities, Mess, Rules &
 * policies, Location, Reviews. Long content sits in collapsible groups. Call (ZCS housing desk) /
 * Book Now stay at the bottom. Real data first; pgV2Demo fills the gaps while its switch is on.
 */
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Share, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PG2, GUTTER, W, genderTone, shadow } from './pgV2Theme';
import { Header, Tap, Photo, Verified, Rating, PrimaryButton, OutlineButton, EmptyState, Loading, k } from './PgV2Kit';
import { IShare, IPhone, ICalendarCheck, IBuilding, ICheck, INavigation, STROKE } from './PgV2Icons';
import { galleryPhotos } from './pgV2Photos';
import { usePgDetail, gKey, rentRange, placeText, kmText } from './pgV2Data';
import { useNav, usePgIdFor } from './pgV2Nav';
import { AmenityGroups, normaliseAmenities } from './PgV2Amenities';
import { MessTimingRows, FoodNote } from './PgV2Facilities';
import { RoomCard } from './PgV2Rooms';
import { MapFrame, leafletHtml, openDirections } from './PgV2Map';
import { RulesBlock, PoliciesBlock, SafetyBlock, MoveInBlock, NearbyBlock, FaqBlock, Collapsible } from './PgV2Sections';
import { ReviewsBlock } from './PgV2Reviews';
import { PhotoViewer, ToursRow } from './PgV2Media';
import { ZENVY_SUPPORT_WHATSAPP } from '../../constants/api';
import { inr, pgLink, INCLUDED_LABEL, chargeText, type PgDetail } from '../pg/pgApi';
import { dial } from '../../utils/dial';

type Tab = 'overview' | 'rooms' | 'amenities' | 'mess' | 'rules' | 'location' | 'reviews';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'rooms', label: 'Rooms' }, { key: 'amenities', label: 'Amenities' }, { key: 'mess', label: 'Mess' },
  { key: 'rules', label: 'Rules & policies' }, { key: 'location', label: 'Location' }, { key: 'reviews', label: 'Reviews' },
];
const TAB_H = 52;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.fact}>
      <Text style={k.small}>{label}</Text>
      <Text style={st.factValue}>{value}</Text>
    </View>
  );
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={st.h2} accessibilityRole="header">{title}</Text>
      {sub ? <Text style={[k.small, { marginTop: 2 }]}>{sub}</Text> : null}
    </View>
  );
}

function OverviewSection({ pg }: { pg: PgDetail }) {
  const km = kmText(pg.distanceFromCollege);
  const facts = [
    km ? { label: 'From campus', value: km } : null,
    pg.securityDeposit > 0 ? { label: 'Deposit', value: inr(pg.securityDeposit) } : null,
    pg.roomTypes.length ? { label: 'Beds free', value: String(pg.bedsAvailable) } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  return (
    <View style={{ gap: 16 }}>
      {facts.length ? <View style={{ flexDirection: 'row', gap: 10 }}>{facts.map((f) => <Fact key={f.label} {...f} />)}</View> : null}
      {pg.description ? <Text style={k.body}>{pg.description}</Text> : null}
      {(pg.highlights || []).length ? (
        <View style={{ gap: 8 }}>
          {(pg.highlights || []).map((h) => (
            <View key={h} style={[k.row, { gap: 10, alignItems: 'flex-start' }]}>
              <ICheck size={16} color={PG2.green} strokeWidth={2} />
              <Text style={[k.body, { flex: 1 }]}>{h}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {pg.videos?.length ? <View><Text style={st.h3}>Room tours</Text><ToursRow videos={pg.videos} /></View> : null}
    </View>
  );
}

function RoomsSection({ pg }: { pg: PgDetail }) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const photoW = Math.round(Math.min(118, (width - GUTTER * 2) * 0.3));
  const inc = pg.policies?.included || [];
  const extra = pg.policies?.extraCharges || [];
  if (!pg.roomTypes.length) return <Text style={k.small}>Room types haven't been added yet.</Text>;
  return (
    <View style={{ gap: 12 }}>
      {pg.roomTypes.map((t) => <RoomCard key={t.key} pg={pg} t={t} photoW={photoW} onPress={() => nav.push({ name: 'room', pgId: pg.id, roomKey: t.key })} />)}
      {inc.length || extra.length ? (
        <View style={st.box}>
          {inc.length ? <Text style={k.body}><Text style={st.boxLabel}>Included in rent  </Text>{inc.map((x) => INCLUDED_LABEL[x]).join(', ')}</Text> : null}
          {extra.length ? <Text style={[k.body, { marginTop: 6 }]}><Text style={st.boxLabel}>Extra  </Text>{extra.map((e) => `${e.item} ${chargeText(e)}`).join(', ')}</Text> : null}
          {pg.securityDeposit > 0 ? <Text style={[k.body, { marginTop: 6 }]}><Text style={st.boxLabel}>Deposit  </Text>{inr(pg.securityDeposit)}, refundable</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function MessSection({ pg }: { pg: PgDetail }) {
  const nav = useNav();
  const t = pg.messTimetable && pg.messTimetable.meals.length ? pg.messTimetable : null;
  if (!t) return <Text style={k.small}>The mess timetable hasn't been added yet.</Text>;
  return (
    <View>
      <MessTimingRows t={t} />
      <FoodNote t={t} />
      <OutlineButton label="Timetable and weekly menu" onPress={() => nav.push({ name: 'mess', pgId: pg.id })} style={{ marginTop: 14 }} />
    </View>
  );
}

function LocationSection({ pg }: { pg: PgDetail }) {
  const nav = useNav();
  return (
    <View style={{ gap: 14 }}>
      {pg.location ? (
        <Tap onPress={() => nav.push({ name: 'map', pgId: pg.id })} label="Open the map" style={st.mapBox}>
          <View pointerEvents="none" style={{ flex: 1 }}><MapFrame html={leafletHtml(pg.location.lat, pg.location.lng, pg.name, 14)} /></View>
        </Tap>
      ) : null}
      <Text style={k.body}>{pg.address}</Text>
      <OutlineButton label="Get Directions" icon={INavigation} onPress={() => openDirections(pg)} textStyle={{ color: PG2.ink }} border={PG2.line} />
      {pg.locationGuide ? <NearbyBlock guide={pg.locationGuide} /> : null}
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
  const [viewer, setViewer] = useState<number | null>(null);
  const [active, setActive] = useState<Tab>('overview');
  const [stuck, setStuck] = useState(false);
  const barY = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const tabsRef = useRef<ScrollView>(null);
  const anchors = useRef<Partial<Record<Tab, number>>>({});
  const bodyY = useRef(0);
  const lockUntil = useRef(0);
  const tabX = useRef<Partial<Record<Tab, number>>>({});
  const viewH = useRef(0);
  const contentH = useRef(0);

  const share = () => { if (pg) Share.share({ message: `${pg.name}, ${pg.address}\n${pgLink(pg.id)}` }).catch(() => {}); };
  const right = <Tap onPress={share} label="Share" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><IShare size={19} color={PG2.ink} strokeWidth={STROKE} /></Tap>;
  if (state === 'loading') return <View style={st.page}><Header title="PG Details" onBack={nav.back} /><Loading /></View>;
  if (!pg) return <View style={st.page}><Header title="PG Details" onBack={nav.back} /><EmptyState icon={IBuilding} title="This PG isn't available" action="Back" onAction={nav.back} /></View>;

  const photos = galleryPhotos(pg);
  const thumbs = photos.slice(0, 5);
  const thumbW = Math.floor((width - GUTTER * 2 - 8 * 4) / 5);
  const g = gKey(pg.genderType);
  const rent = rentRange(pg);
  const at = (key: Tab) => (e: LayoutChangeEvent) => { anchors.current[key] = e.nativeEvent.layout.y; };
  /** Keep the active tab in view in the scrolling tab row. */
  const revealTab = (key: Tab) => { const x = tabX.current[key]; if (x !== undefined) tabsRef.current?.scrollTo({ x: Math.max(0, x - 40), animated: true }); };
  const goTo = (key: Tab) => {
    const y = anchors.current[key];
    if (y === undefined) return;
    setActive(key);
    lockUntil.current = Date.now() + 700;
    scroll.current?.scrollTo({ y: Math.max(0, bodyY.current + y - TAB_H - 30), animated: true });
    revealTab(key);
  };
  const onScroll = (y: number) => {
    const isStuck = barY.current > 0 && y >= barY.current - 1;
    if (isStuck !== stuck) setStuck(isStuck);
    if (Date.now() < lockUntil.current) return;
    // At the very bottom the last section is the one being read, even if it is short.
    if (viewH.current && contentH.current && y + viewH.current >= contentH.current - 8) { if (active !== 'reviews') { setActive('reviews'); revealTab('reviews'); } return; }
    let cur: Tab = 'overview';
    TABS.forEach((t) => { const a = anchors.current[t.key]; if (a !== undefined && bodyY.current + a - TAB_H - 40 <= y) cur = t.key; });
    if (cur !== active) { setActive(cur); revealTab(cur); }
  };

  return (
    <View style={st.page}>
      <Header title="PG Details" onBack={nav.back} right={right} />
      <ScrollView ref={scroll} onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }} onContentSizeChange={(_, h) => { contentH.current = h; }} stickyHeaderIndices={[1]} scrollEventThrottle={32} onScroll={(e) => onScroll(e.nativeEvent.contentOffset.y)} contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        <View style={{ paddingHorizontal: GUTTER, paddingBottom: 16 }}>
          <Tap onPress={() => setViewer(index)} label="Open photos">
            <Photo photo={photos[index]} style={{ height: Math.round((width - GUTTER * 2) * 0.56) }} radius={16} priority="high" />
          </Tap>
          <View style={st.thumbs}>
            {thumbs.map((p, i) => (
              <Tap key={p.key} onPress={() => (i === 4 && photos.length > 5 ? setViewer(4) : setIndex(i))} label={`Photo ${i + 1}`} selected={i === index}
                style={[st.thumb, { width: thumbW, height: Math.round(thumbW * 0.8) }, i === index && { borderColor: PG2.primary }]}>
                <Photo photo={p} style={StyleSheet.absoluteFill} radius={8} />
                {i === 4 && photos.length > 5 ? <View style={st.more}><Text style={st.moreText}>+{photos.length - 5}</Text></View> : null}
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

        <View style={[st.tabBar, stuck && st.tabBarStuck]} onLayout={(e) => { barY.current = e.nativeEvent.layout.y; }}>
          <ScrollView ref={tabsRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs}>
            {TABS.map((t) => {
              const on = t.key === active;
              return (
                <View key={t.key} onLayout={(e) => { tabX.current[t.key] = e.nativeEvent.layout.x; }}><Tap onPress={() => goTo(t.key)} role="tab" selected={on} label={t.label} style={st.tab}>
                  <Text style={[st.tabText, on && st.tabTextOn]}>{t.label}</Text>
                  {on ? <View style={st.tabLine} /> : null}
                </Tap></View>
              );
            })}
          </ScrollView>
        </View>

        <View onLayout={(e) => { bodyY.current = e.nativeEvent.layout.y; }} style={{ paddingHorizontal: GUTTER, paddingTop: 18, gap: 30 }}>
          <View onLayout={at('overview')}><Heading title="About this PG" /><OverviewSection pg={pg} /></View>
          <View onLayout={at('rooms')}><Heading title="Rooms and rent" sub="Rent per bed, per month" /><RoomsSection pg={pg} /></View>
          <View onLayout={at('amenities')}><Heading title="Amenities" /><AmenityGroups items={normaliseAmenities(pg.amenities)} /></View>
          <View onLayout={at('mess')}><Heading title="Mess" sub="Times in IST" /><MessSection pg={pg} /></View>
          <View onLayout={at('rules')}>
            <Heading title="Rules and policies" />
            {(pg.houseRules || []).length || pg.timings ? <RulesBlock groups={pg.houseRules || []} timings={pg.timings} /> : null}
            {pg.policies ? <PoliciesBlock policies={pg.policies} deposit={pg.securityDeposit} /> : null}
            {pg.safety ? <SafetyBlock safety={pg.safety} /> : null}
            {pg.moveIn ? <Collapsible title="Moving in" sub="Documents, checklist and steps"><MoveInBlock moveIn={pg.moveIn} /></Collapsible> : null}
            {(pg.faq || []).length ? <View style={{ marginTop: 22 }}><Text style={st.h3}>Questions</Text><FaqBlock items={pg.faq || []} /></View> : null}
          </View>
          <View onLayout={at('location')}><Heading title="Location" sub={kmText(pg.distanceFromCollege) ? `${kmText(pg.distanceFromCollege)} from campus` : undefined} /><LocationSection pg={pg} /></View>
          <View onLayout={at('reviews')}><Heading title="Reviews" /><ReviewsBlock pg={pg} /></View>
        </View>
      </ScrollView>
      <View style={[st.bar, { paddingBottom: insets.bottom + 14 }]}>
        <OutlineButton label="Call ZENV" icon={IPhone} onPress={() => dial(`+${ZENVY_SUPPORT_WHATSAPP}`, 'ZENV support')} style={{ flex: 1, height: 54 }} />
        <PrimaryButton label="Book Now" icon={ICalendarCheck} onPress={() => nav.push({ name: 'booking', pgId: pg.id })} style={{ flex: 1.15 }} disabled={!pg.roomTypes.some((t) => t.bookRoomId)} />
      </View>
      {viewer !== null ? <PhotoViewer photos={photos} index={viewer} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  thumbs: { flexDirection: 'row', gap: 8, marginTop: 10 },
  thumb: { borderRadius: 10, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  more: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20,16,60,0.5)', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#FFFFFF', fontSize: 14, fontWeight: W.label },
  name: { fontSize: 20, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.3, flexShrink: 1 },
  type: { fontSize: 13, fontWeight: W.label },
  place: { flex: 1, fontSize: 13, color: PG2.muted },
  rent: { marginTop: 10, fontSize: 21, fontWeight: W.title, color: PG2.price, letterSpacing: -0.3 },
  unit: { fontSize: 14, fontWeight: W.label, color: PG2.ink },
  // Pinned flush under the header: same opaque background, hairline, soft shadow once stuck.
  tabBar: { backgroundColor: PG2.page, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6E3F5', zIndex: 2 },
  tabBarStuck: shadow(1),
  tabs: { paddingHorizontal: GUTTER - 6, height: TAB_H, alignItems: 'stretch' },
  tab: { paddingHorizontal: 10, justifyContent: 'center', minHeight: TAB_H },
  tabText: { fontSize: 14, color: PG2.muted },
  tabTextOn: { color: PG2.primary, fontWeight: W.label },
  tabLine: { position: 'absolute', left: 10, right: 10, bottom: 0, height: 2, borderRadius: 1, backgroundColor: PG2.primary },
  h2: { fontSize: 17, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.2 },
  h3: { fontSize: 14.5, fontWeight: W.title, color: PG2.ink, marginBottom: 10 },
  fact: { flex: 1, borderRadius: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E6E3F5' },
  factValue: { marginTop: 4, fontSize: 15, fontWeight: W.title, color: PG2.ink },
  box: { borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E6E3F5' },
  boxLabel: { fontWeight: W.label, color: PG2.ink },
  mapBox: { height: 190, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E6E3F5' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, paddingHorizontal: GUTTER, paddingTop: 12, backgroundColor: 'rgba(255,255,255,0.97)', ...shadow(2) },
});
