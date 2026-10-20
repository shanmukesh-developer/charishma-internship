/**
 * PG cards for the list page.
 *  - PgListCard: full-width card (All PGs). Cover in a fixed 16:9 frame with the residents badge and
 *    photo count, name with the verified mark, rating when real reviews exist, area and distance,
 *    two or three key amenities, "From ₹7,500/month" and beds available.
 *  - PgRailCard: the compact card used in the horizontal rails (fixed width, 4:3 cover).
 * Plus the matching skeletons so loading does not shift the layout.
 */
import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { distanceLabel, genderLabel, inr, plural, ratingText, type PgListItem } from './pgApi';
import { usePgPalette, PgImage, Press, Skeleton, IconBadgeCheck, IconImages, IconStar, amenityLabel, TYPE, s as ui } from './ui';

const RATIO = 9 / 16;
export const RAIL_CARD_W = 220;
const RAIL_RATIO = 3 / 4;

const coverOf = (pg: PgListItem) => pg.coverPhoto || (Array.isArray(pg.images) ? pg.images[0] : null) || null;
const placeOf = (pg: PgListItem) => [pg.area || pg.address, distanceLabel(pg.distanceFromCollege)].filter(Boolean).join(' · ');
const bedsOf = (pg: PgListItem) => (typeof pg.bedsAvailable === 'number' && pg.hasRooms ? pg.bedsAvailable : null);

function Rating({ pg }: { pg: PgListItem }) {
  const p = usePgPalette();
  const r = pg.reviewSummary;
  if (!r || !r.count) return null;
  return (
    <View style={st.rating} accessible accessibilityLabel={`Rated ${ratingText(r.average)} from ${plural(r.count, 'review')}`}>
      <IconStar size={12} color={p.text} fill={p.text} strokeWidth={1.5} />
      <Text style={[ui.small, { color: p.text, fontWeight: '600' }]}>{ratingText(r.average)}</Text>
      <Text style={[ui.small, { color: p.muted }]}>({r.count})</Text>
    </View>
  );
}

function Price({ pg }: { pg: PgListItem }) {
  const p = usePgPalette();
  const rent = pg.rentFrom ?? pg.baseRent;
  return (
    <Text style={[st.price, { color: p.text }]} numberOfLines={1}>
      <Text style={[ui.small, { color: p.sub, fontWeight: '400' }]}>From </Text>{inr(rent)}<Text style={[ui.small, { color: p.sub, fontWeight: '400' }]}>/month</Text>
    </Text>
  );
}

const a11yOf = (pg: PgListItem) => {
  const beds = bedsOf(pg);
  const r = pg.reviewSummary;
  return `${pg.name}${pg.isVerified ? ', verified' : ''}. ${genderLabel(pg.genderType)}. ${placeOf(pg)}. Rent from ${inr(pg.rentFrom ?? pg.baseRent)} a month.`
    + `${r && r.count ? ` Rated ${ratingText(r.average)} from ${plural(r.count, 'review')}.` : ''}`
    + `${beds !== null ? ` ${beds === 0 ? 'No beds available' : `${plural(beds, 'bed')} available`}.` : ''}`;
};

export function PgListCard({ pg, onPress }: { pg: PgListItem; onPress: () => void }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const w = width - 32;
  const h = Math.round(w * RATIO);
  const place = placeOf(pg);
  const amenities = (pg.amenities || []).map(amenityLabel).filter(Boolean).slice(0, 3);
  const beds = bedsOf(pg);

  return (
    <Press onPress={onPress} accessibilityLabel={a11yOf(pg)} accessibilityHint="Opens the PG" style={[st.card, { backgroundColor: p.card, borderColor: p.line }]}>
      <View>
        <PgImage uri={coverOf(pg)} style={{ width: w, height: h }} recyclingKey={`pg-${pg.id}`} />
        <View style={[st.badge, { backgroundColor: p.overlay }]}>
          <Text style={st.badgeText}>{genderLabel(pg.genderType)}</Text>
        </View>
        {(pg.photoCount || 0) > 1 ? (
          <View style={[st.badge, st.badgeRight, { backgroundColor: p.overlay }]}>
            <IconImages size={12} color="#fff" strokeWidth={2} />
            <Text style={st.badgeText}>{pg.photoCount}</Text>
          </View>
        ) : null}
      </View>
      <View style={st.body}>
        <View style={st.nameRow}>
          <Text style={[st.name, { color: p.text }]} numberOfLines={1}>{pg.name}</Text>
          {pg.isVerified ? <IconBadgeCheck size={16} color={p.success} strokeWidth={2} accessibilityLabel="Verified" /> : null}
          <View style={{ flex: 1 }} />
          <Rating pg={pg} />
        </View>
        {place ? <Text style={[ui.small, { color: p.sub, marginTop: 4 }]} numberOfLines={1}>{place}</Text> : null}
        {amenities.length ? <Text style={[ui.small, { color: p.muted, marginTop: 4 }]} numberOfLines={1}>{amenities.join(' · ')}</Text> : null}
        <View style={st.priceRow}>
          <Price pg={pg} />
          {beds !== null ? (
            <Text style={[ui.small, { color: beds > 0 ? p.success : p.muted, fontWeight: '600' }]}>{beds > 0 ? `${plural(beds, 'bed')} available` : 'Full'}</Text>
          ) : null}
        </View>
      </View>
    </Press>
  );
}

export function PgRailCard({ pg, onPress }: { pg: PgListItem; onPress: () => void }) {
  const p = usePgPalette();
  const h = Math.round(RAIL_CARD_W * RAIL_RATIO);
  return (
    <Press onPress={onPress} accessibilityLabel={a11yOf(pg)} accessibilityHint="Opens the PG" style={{ width: RAIL_CARD_W }}>
      <View>
        <PgImage uri={coverOf(pg)} style={{ width: RAIL_CARD_W, height: h, borderRadius: 12 }} recyclingKey={`rail-${pg.id}`} priority="low" />
        <View style={[st.badge, { backgroundColor: p.overlay, left: 8, top: 8 }]}>
          <Text style={st.badgeText}>{genderLabel(pg.genderType)}</Text>
        </View>
      </View>
      <View style={[st.nameRow, { marginTop: 8 }]}>
        <Text style={[ui.body, { color: p.text, fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>{pg.name}</Text>
        {pg.isVerified ? <IconBadgeCheck size={14} color={p.success} strokeWidth={2} /> : null}
      </View>
      <Text style={[ui.small, { color: p.sub, marginTop: 2 }]} numberOfLines={1}>{placeOf(pg)}</Text>
      <View style={[st.priceRow, { marginTop: 4 }]}>
        <Price pg={pg} />
        <Rating pg={pg} />
      </View>
    </Press>
  );
}

export function PgListSkeleton({ count = 3 }: { count?: number }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const w = width - 32;
  const h = Math.round(w * RATIO);
  return (
    <View accessibilityLabel="Loading PG stays" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[st.card, { backgroundColor: p.card, borderColor: p.line }]}>
          <Skeleton style={{ width: w, height: h, borderRadius: 0 }} />
          <View style={st.body}>
            <Skeleton style={{ width: '60%', height: 16 }} />
            <Skeleton style={{ width: '45%', height: 12, marginTop: 8 }} />
            <Skeleton style={{ width: '70%', height: 12, marginTop: 8 }} />
            <Skeleton style={{ width: 120, height: 16, marginTop: 16 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginBottom: 16 },
  badge: { position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeRight: { left: undefined, right: 12 },
  badgeText: { color: '#fff', fontSize: TYPE.small, fontWeight: '500' },
  body: { padding: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: TYPE.heading, fontWeight: '700', flexShrink: 1 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12 },
  price: { fontSize: TYPE.heading, fontWeight: '700' },
});
