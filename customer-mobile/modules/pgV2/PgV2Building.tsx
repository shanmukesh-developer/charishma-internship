/**
 * Screen 3 · Building details: hero photo with back / share / save, name and Verified badge, type and
 * place, rating, rent range, amenity icon grid, building figures and "View Rooms".
 * Building figures come from the listing: total rooms (admin field), and beds occupied / vacant across
 * the rooms listed for booking. A figure without data is left out.
 */
import React, { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Share, useWindowDimensions, Animated, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StatusBarScrim from '../../components/StatusBarScrim';
import type { LucideIcon } from 'lucide-react-native';
import { PG2, R, GUTTER, W, genderTone, shadow } from './pgV2Theme';
import { Tap, FloatBtn, Photo, Verified, Rating, SectionTitle, PrimaryButton, EmptyState, Loading, k } from './PgV2Kit';
import { AmenityRows, normaliseAmenities } from './PgV2Amenities';
import { IArrowLeft, IShare, IHeart, IArrowRight, IBed, IUsers, IDoor, IMapPin, IUtensils, IChevronRight, IBuilding, IPlus, STROKE } from './PgV2Icons';
import { buildingPhoto } from './pgV2Photos';
import { usePgDetail, usePgV2, gKey, rentRange, placeText, kmText } from './pgV2Data';
import { useNav, usePgIdFor } from './pgV2Nav';
import { pgLink, type PgDetail } from '../../modules/pg/pgApi';
import { themedSheet } from '../../utils/themeNow';

export const buildingFigures = (pg: PgDetail) => {
  // One unit throughout (beds), all from the rooms listed for booking, so the three always add up.
  const total = pg.rooms.reduce((a, r) => a + (Number(r.totalBeds) || 0), 0);
  const free = Math.min(total, pg.rooms.reduce((a, r) => a + (Number(r.availableBeds) || 0), 0));
  if (total <= 0) return [] as { icon: LucideIcon; label: string; value: string }[];
  return [
    { icon: IBed, label: 'Total Beds', value: String(total) },
    { icon: IUsers, label: 'Occupied', value: String(total - free) },
    { icon: IDoor, label: 'Vacant', value: String(free) },
  ];
};

/** First amenities as listing-style rows, with "View all facilities" when there are more. */
export function AmenityPreview({ names, onMore, max = 6 }: { names: string[]; onMore?: () => void; max?: number }) {
  const items = normaliseAmenities(names);
  return (
    <View>
      <AmenityRows items={items.slice(0, max)} />
      {items.length > max && onMore ? (
        <Tap onPress={onMore} label="View all facilities" role="link" style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 13.5, fontWeight: W.label, color: PG2.primary }}>View all {items.length} facilities</Text>
        </Tap>
      ) : null}
    </View>
  );
}

function LinkRow({ icon: Icon, title, sub, onPress }: { icon: LucideIcon; title: string; sub: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} label={title} style={st.link}>
      <View style={st.linkIcon}><Icon size={20} color="#475569" strokeWidth={1.6} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.linkTitle}>{title}</Text>
        <Text style={k.small} numberOfLines={1}>{sub}</Text>
      </View>
      <IChevronRight size={18} color={PG2.faint} strokeWidth={STROKE} />
    </Tap>
  );
}

export default function PgV2Building() {
  const nav = useNav();
  const id = usePgIdFor();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { saved, toggleSaved } = usePgV2();
  const { pg, state } = usePgDetail(id);
  // The photo sits under the status bar; once the sheet scrolls up to it, white goes behind the clock.
  const scrollY = useRef(new Animated.Value(0)).current;
  const photoH = Math.round(width * 0.64) + insets.top;

  if (state === 'loading') return <View style={st.page}><Loading /></View>;
  if (!pg) return <View style={[st.page, { paddingTop: insets.top + 40 }]}><EmptyState icon={IBuilding} title="This PG isn't available" body="It may have been removed. Pick another building." action="Back" onAction={nav.back} /></View>;

  const g = gKey(pg.genderType);
  const rent = rentRange(pg);
  const figures = buildingFigures(pg);
  const isSaved = saved.has(pg.id);
  const km = kmText(pg.distanceFromCollege);
  const share = () => { Share.share({ message: `${pg.name}, ${pg.address}\n${pgLink(pg.id)}` }).catch(() => {}); };
  const hasMess = !!pg.messTimetable?.meals?.length;

  return (
    <View style={st.page}>
      <Animated.ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }} scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== 'web' })}>
        <Photo photo={buildingPhoto(pg)} style={{ width, height: photoH }} radius={0} priority="high" />
        <View style={[st.floatRow, { top: insets.top + 12 }]}>
          <FloatBtn icon={IArrowLeft} label="Back" onPress={nav.back} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <FloatBtn icon={IShare} label="Share" onPress={share} />
            <FloatBtn icon={IHeart} label={isSaved ? 'Remove from saved' : 'Save'} onPress={() => toggleSaved(pg.id)} color={isSaved ? PG2.red : PG2.ink} fill={isSaved ? PG2.red : undefined} />
          </View>
        </View>

        <View style={st.sheet}>
          <View style={st.nameRow}>
            <Text style={st.name}>{pg.name}</Text>
            {pg.isVerified ? <Verified /> : null}
          </View>
          <View style={[k.row, { marginTop: 8, gap: 8 }]}>
            <Text style={[st.type, { color: genderTone(g).ink, backgroundColor: genderTone(g).soft }]}>{g} PG</Text>
            <Text style={st.sep}>|</Text>
            <Text style={st.place} numberOfLines={1}>{placeText(pg)}</Text>
          </View>
          {pg.reviewSummary?.count ? <View style={{ marginTop: 12 }}><Rating summary={pg.reviewSummary} size={14} /></View> : null}
          {rent ? <Text style={st.rent}>{rent}<Text style={st.rentUnit}>/month</Text></Text> : null}

          {pg.amenities.length ? (
            <View style={{ marginTop: 22 }}>
              <AmenityPreview names={pg.amenities} onMore={() => nav.push({ name: 'facilities', pgId: pg.id })} />
            </View>
          ) : null}

          {figures.length ? (
            <View style={{ marginTop: 26 }}>
              <SectionTitle title="Building Details" />
              <View style={st.figRow}>
                {figures.map((f) => (
                  <View key={f.label} style={[st.fig, width < 400 && st.figCol]}>
                    <View style={st.figIcon}><f.icon size={20} color="#475569" strokeWidth={1.6} /></View>
                    <View style={{ flexShrink: 1, minWidth: 0 }}>
                      <Text style={st.figLabel} numberOfLines={1}>{f.label}</Text>
                      <Text style={st.figValue}>{f.value}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ marginTop: 24, gap: 10 }}>
            <LinkRow icon={IMapPin} title="Location" sub={km ? `${km} from campus · ${pg.address}` : pg.address} onPress={() => nav.push({ name: 'map', pgId: pg.id })} />
            <LinkRow icon={IUtensils} title="Facilities & Mess" sub={hasMess ? 'Facilities, mess timings and menu' : 'Building facilities'} onPress={() => nav.push({ name: 'facilities', pgId: pg.id })} />
            <LinkRow icon={IBuilding} title="PG Overview" sub="Photos, rooms, amenities and mess" onPress={() => nav.push({ name: 'overview', pgId: pg.id })} />
          </View>
        </View>
      </Animated.ScrollView>
      <StatusBarScrim color="#FFFFFF" scrollY={scrollY} from={photoH - insets.top - 64} to={photoH - insets.top - 24} />
      <View style={[st.bar, { paddingBottom: insets.bottom + 14 }]}>
        <PrimaryButton label="View Rooms" trailing={IArrowRight} onPress={() => nav.push({ name: 'rooms', pgId: pg.id })} />
      </View>
    </View>
  );
}

const st = themedSheet(() => ({
  page: { flex: 1, backgroundColor: PG2.card },
  floatRow: { position: 'absolute', left: GUTTER, right: GUTTER, flexDirection: 'row', justifyContent: 'space-between' },
  sheet: { marginTop: -24, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: PG2.card, paddingHorizontal: GUTTER, paddingTop: 22 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  name: { fontSize: 22, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.3, flexShrink: 1 },
  type: { fontSize: 13, fontWeight: W.label, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  sep: { color: PG2.line, fontSize: 14 },
  place: { flex: 1, fontSize: 13.5, color: PG2.muted },
  rent: { marginTop: 14, fontSize: 23, fontWeight: W.title, color: PG2.price, letterSpacing: -0.3 },
  rentUnit: { fontSize: 15, fontWeight: W.label, color: PG2.ink },
  figRow: { flexDirection: 'row', gap: 10 },
  fig: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PG2.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: PG2.line, paddingVertical: 10, paddingHorizontal: 12 },
  figCol: { flexDirection: 'column', alignItems: 'flex-start' },
  figIcon: { width: 24, height: 24, justifyContent: 'center' },
  figLabel: { fontSize: 11.5, color: PG2.muted },
  figValue: { fontSize: 15, fontWeight: W.title, color: PG2.ink, marginTop: 1 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: PG2.card, borderWidth: StyleSheet.hairlineWidth, borderColor: PG2.line },
  linkIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontSize: 14, fontWeight: W.label, color: PG2.ink, marginBottom: 2 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: 12, backgroundColor: PG2.card, ...shadow(2) },
}));
