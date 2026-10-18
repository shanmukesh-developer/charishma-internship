/**
 * PG list card (Others > PG stays): cover photo in a fixed 16:9 frame, name with the verified mark,
 * locality and distance, residents (Boys / Girls / Co-living), a few key amenities and the rent
 * "From ₹7,500/month". Plus the matching skeleton so loading does not shift the layout.
 */
import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { distanceLabel, genderLabel, inr, type PgListItem } from './pgApi';
import { usePgPalette, PgImage, Press, Skeleton, IconBadgeCheck, IconImages, amenityLabel, s as ui } from './ui';

const RATIO = 9 / 16;

export function PgListCard({ pg, onPress }: { pg: PgListItem; onPress: () => void }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const w = width - 32;
  const h = Math.round(w * RATIO);
  const cover = pg.coverPhoto || (Array.isArray(pg.images) ? pg.images[0] : null) || null;
  const rent = pg.rentFrom ?? pg.baseRent;
  const place = [pg.area || pg.address, distanceLabel(pg.distanceFromCollege)].filter(Boolean).join(' · ');
  const amenities = (pg.amenities || []).map(amenityLabel).filter(Boolean).slice(0, 3);
  const beds = typeof pg.bedsAvailable === 'number' && pg.hasRooms ? pg.bedsAvailable : null;
  const a11y = `${pg.name}${pg.isVerified ? ', verified' : ''}. ${genderLabel(pg.genderType)}. ${place}. Rent from ${inr(rent)} a month.${beds !== null ? ` ${beds === 0 ? 'No beds free' : `${beds} bed${beds === 1 ? '' : 's'} free`}.` : ''}`;

  return (
    <Press onPress={onPress} accessibilityLabel={a11y} accessibilityHint="Opens the PG" style={[st.card, { backgroundColor: p.card, borderColor: p.line }]}>
      <View>
        <PgImage uri={cover} style={{ width: w, height: h }} recyclingKey={`pg-${pg.id}`} />
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
        </View>
        {place ? <Text style={[ui.small, { color: p.sub, marginTop: 2 }]} numberOfLines={1}>{place}</Text> : null}
        {amenities.length ? <Text style={[ui.small, { color: p.muted, marginTop: 6 }]} numberOfLines={1}>{amenities.join(' · ')}</Text> : null}
        <View style={st.priceRow}>
          <Text style={[st.price, { color: p.text }]}>
            <Text style={[ui.small, { color: p.sub }]}>From </Text>{inr(rent)}<Text style={[ui.small, { color: p.sub }]}>/month</Text>
          </Text>
          {beds !== null ? (
            <Text style={[ui.small, { color: beds > 0 ? p.success : p.muted, fontWeight: '600' }]}>{beds > 0 ? `${beds} bed${beds === 1 ? '' : 's'} free` : 'Full'}</Text>
          ) : null}
        </View>
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
            <Skeleton style={{ width: '60%', height: 18 }} />
            <Skeleton style={{ width: '45%', height: 12, marginTop: 8 }} />
            <Skeleton style={{ width: '70%', height: 12, marginTop: 8 }} />
            <Skeleton style={{ width: 120, height: 18, marginTop: 14 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginBottom: 16 },
  badge: { position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeRight: { left: undefined, right: 12 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  body: { padding: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, flexShrink: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12 },
  price: { fontSize: 17, fontWeight: '700' },
});
