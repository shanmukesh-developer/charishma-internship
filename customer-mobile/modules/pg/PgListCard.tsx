/**
 * PG cards for the list page.
 *  - PgListCard: the listing card (clean white card, soft shadow). Photo on the left with the residents
 *    badge; on the right the name with a "Verified" tag (only when the PG is verified), rating (only
 *    when real reviews exist) and distance, area, "₹7,500 /month" with "(incl. food)" when food is in
 *    the rent, beds left, and up to three amenity chips.
 *  - PgRailCard: the compact card used in the horizontal rails (fixed width, 4:3 cover).
 * Plus the matching skeletons so loading does not shift the layout.
 */
import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { distanceLabel, genderLabel, inr, plural, ratingText, type PgListItem } from './pgApi';
import { SlowLoadHint } from '../others/motion';
import { usePgPalette, PgImage, Press, Skeleton, IconBadgeCheck, IconStar, IconMapPin, amenityLabel, TYPE, s as ui } from './ui';

export const RAIL_CARD_W = 220;
const RAIL_RATIO = 3 / 4;

const coverOf = (pg: PgListItem) => pg.coverPhoto || (Array.isArray(pg.images) ? pg.images[0] : null) || null;
const placeOf = (pg: PgListItem) => [pg.area || pg.address, distanceLabel(pg.distanceFromCollege)].filter(Boolean).join(' · ');
const bedsOf = (pg: PgListItem) => (typeof pg.bedsAvailable === 'number' && pg.hasRooms ? pg.bedsAvailable : null);
/** "1.2 km" / "800 m" without "from campus" (the card says it with the pin row). */
const shortDistance = (km?: number | null) => distanceLabel(km).replace(' from campus', '');

/** Photo size for the list card: about a quarter of the window, within 96–128 px. */
export const listPhotoSize = (width: number) => Math.round(Math.max(96, Math.min(128, width * 0.28)));

function Rating({ pg, compact }: { pg: PgListItem; compact?: boolean }) {
  const p = usePgPalette();
  const r = pg.reviewSummary;
  if (!r || !r.count) return null;
  return (
    <View style={st.rating} accessible accessibilityLabel={`Rated ${ratingText(r.average)} from ${plural(r.count, 'review')}`}>
      <IconStar size={12} color={p.star} fill={p.star} strokeWidth={1.5} />
      <Text style={[ui.small, { color: p.text, fontWeight: '600' }]}>{ratingText(r.average)}</Text>
      {!compact ? <Text style={[ui.small, { color: p.muted }]}>({r.count})</Text> : null}
    </View>
  );
}

const a11yOf = (pg: PgListItem) => {
  const beds = bedsOf(pg);
  const r = pg.reviewSummary;
  return `${pg.name}${pg.isVerified ? ', verified' : ''}. ${genderLabel(pg.genderType)}. ${placeOf(pg)}. Rent from ${inr(pg.rentFrom ?? pg.baseRent)} a month${pg.foodIncluded ? ', food included' : ''}.`
    + `${r && r.count ? ` Rated ${ratingText(r.average)} from ${plural(r.count, 'review')}.` : ''}`
    + `${beds !== null ? ` ${beds === 0 ? 'No beds available' : `${plural(beds, 'bed')} available`}.` : ''}`;
};

export function VerifiedTag({ small }: { small?: boolean }) {
  const p = usePgPalette();
  return (
    <View style={[st.verified, { backgroundColor: p.successSoft }, small && { paddingHorizontal: 6 }]} accessibilityLabel="Verified by the Zenvy housing team">
      <IconBadgeCheck size={small ? 11 : 12} color={p.success} strokeWidth={2} />
      <Text style={[st.verifiedText, { color: p.success }]}>Verified</Text>
    </View>
  );
}

export function PgListCard({ pg, onPress }: { pg: PgListItem; onPress: () => void }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const size = listPhotoSize(width);
  const amenities = (pg.amenities || []).map(amenityLabel).filter(Boolean).slice(0, 3);
  const beds = bedsOf(pg);
  const rent = pg.rentFrom ?? pg.baseRent;
  const dist = shortDistance(pg.distanceFromCollege);

  return (
    <Press onPress={onPress} accessibilityLabel={a11yOf(pg)} accessibilityHint="Opens the PG" style={[st.card, { backgroundColor: p.card }, p.shadow]}>
      <View>
        <PgImage uri={coverOf(pg)} style={{ width: size, height: size + 16, borderRadius: 12 }} recyclingKey={`pg-${pg.id}`} />
        <View style={[st.badge, { backgroundColor: p.overlay }]}>
          <Text style={st.badgeText}>{genderLabel(pg.genderType)}</Text>
        </View>
      </View>

      <View style={st.body}>
        <View style={st.nameRow}>
          <Text style={[st.name, { color: p.text }]} numberOfLines={1}>{pg.name}</Text>
          {pg.isVerified ? <VerifiedTag small /> : null}
        </View>

        {(pg.reviewSummary?.count || dist) ? (
          <View style={[st.metaRow, { marginTop: 4 }]}>
            <Rating pg={pg} />
            {pg.reviewSummary?.count && dist ? <Text style={[ui.small, { color: p.muted }]}>·</Text> : null}
            {dist ? <Text style={[ui.small, { color: p.sub }]} numberOfLines={1}>{dist} from campus</Text> : null}
          </View>
        ) : null}

        {pg.area || pg.address ? (
          <View style={[st.metaRow, { marginTop: 4 }]}>
            <IconMapPin size={12} color={p.muted} strokeWidth={2} />
            <Text style={[ui.small, { color: p.sub, flex: 1 }]} numberOfLines={1}>{pg.area || pg.address}</Text>
          </View>
        ) : null}

        <View style={st.priceRow}>
          <Text style={[st.price, { color: p.text }]} numberOfLines={1}>
            {inr(rent)}<Text style={[ui.small, { color: p.sub, fontWeight: '400' }]}> /month</Text>
          </Text>
          {beds !== null ? (
            <Text style={[ui.small, { color: beds > 0 ? p.success : p.muted, fontWeight: '600' }]} numberOfLines={1}>{beds > 0 ? `${plural(beds, 'bed')} left` : 'Full'}</Text>
          ) : null}
        </View>
        {pg.foodIncluded ? <Text style={[ui.small, { color: p.muted }]}>(incl. food)</Text> : null}

        {amenities.length ? (
          <View style={st.chips}>
            {amenities.map((a) => (
              <View key={a} style={[st.chip, { backgroundColor: p.sunken }]}>
                <Text style={[st.chipText, { color: p.sub }]} numberOfLines={1}>{a}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Press>
  );
}

export function PgRailCard({ pg, onPress }: { pg: PgListItem; onPress: () => void }) {
  const p = usePgPalette();
  const h = Math.round(RAIL_CARD_W * RAIL_RATIO);
  return (
    <Press onPress={onPress} accessibilityLabel={a11yOf(pg)} accessibilityHint="Opens the PG" style={[st.railCard, { width: RAIL_CARD_W, backgroundColor: p.card }, p.shadow]}>
      <View>
        <PgImage uri={coverOf(pg)} style={{ width: RAIL_CARD_W, height: h }} recyclingKey={`rail-${pg.id}`} priority="low" />
        <View style={[st.badge, { backgroundColor: p.overlay }]}>
          <Text style={st.badgeText}>{genderLabel(pg.genderType)}</Text>
        </View>
      </View>
      <View style={{ padding: 12 }}>
        <View style={st.nameRow}>
          <Text style={[ui.body, { color: p.text, fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>{pg.name}</Text>
          {pg.isVerified ? <IconBadgeCheck size={14} color={p.success} strokeWidth={2} accessibilityLabel="Verified" /> : null}
        </View>
        <Text style={[ui.small, { color: p.sub, marginTop: 2 }]} numberOfLines={1}>{placeOf(pg)}</Text>
        <View style={[st.priceRow, { marginTop: 8 }]}>
          <Text style={[ui.body, { color: p.text, fontWeight: '700' }]} numberOfLines={1}>
            {inr(pg.rentFrom ?? pg.baseRent)}<Text style={[ui.small, { color: p.sub, fontWeight: '400' }]}> /month</Text>
          </Text>
          <Rating pg={pg} compact />
        </View>
      </View>
    </Press>
  );
}

export function PgListSkeleton({ count = 3 }: { count?: number }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const size = listPhotoSize(width);
  return (
    <View accessibilityLabel="Loading PG stays" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[st.card, { backgroundColor: p.card }, p.shadow]}>
          <Skeleton style={{ width: size, height: size + 16, borderRadius: 12 }} />
          <View style={st.body}>
            <Skeleton style={{ width: '70%', height: 16 }} />
            <Skeleton style={{ width: '50%', height: 12, marginTop: 10 }} />
            <Skeleton style={{ width: '60%', height: 12, marginTop: 8 }} />
            <Skeleton style={{ width: 96, height: 16, marginTop: 14 }} />
            <Skeleton style={{ width: '80%', height: 20, marginTop: 10, borderRadius: 6 }} />
          </View>
        </View>
      ))}
      <SlowLoadHint />
    </View>
  );
}

const st = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16, marginBottom: 12 },
  railCard: { borderRadius: 16, overflow: 'hidden' },
  badge: { position: 'absolute', left: 8, top: 8, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  body: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: TYPE.heading, fontWeight: '700', flexShrink: 1 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  verifiedText: { fontSize: 11, fontWeight: '600' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  price: { fontSize: TYPE.heading, fontWeight: '700', flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 120 },
  chipText: { fontSize: 11, fontWeight: '500' },
});
