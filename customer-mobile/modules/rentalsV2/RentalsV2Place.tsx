/**
 * Rentals v2 room and flat detail (inner board 4): photo, name, "₹4,500/month", distance from SRM University,
 * "Verified" only when the PG is verified, amenity icon row, "About the Property", owner details (phone stays
 * private: the ZCS housing team confirms requests first), and "Book Now".
 * Rooms are real PG room types (modules/pgV2 data); Book Now opens the PG v2 request screen for that room type.
 * Flats are samples while no flat data exists: Book Now opens the sample sheet.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DAY, W } from './rentalsV2Theme';
import { CTA, DayHeader, FadeInUp, Rating, SampleTag, SpecChip, StateBlock, usePageW } from './RentalsV2Kit';
import { DetailSheet, FeatureRow, Gallery, InfoRow, OwnerCard, Safeguards, SectionTitle } from './RentalsV2DetailParts';
import { IBadge, IBuilding, IPin } from './RentalsV2Icons';
import { inr, kmText, useRentalsV2 } from './rentalsV2Data';
import { useNav } from './rentalsV2Nav';

export default function RentalsV2Place() {
  const nav = useNav();
  const router = useRouter();
  const pw = usePageW();
  const insets = useSafeAreaInsets();
  const { find, rState, reload } = useRentalsV2();
  const id = nav.route.name === 'room' || nav.route.name === 'flat' ? nav.route.id : '';
  const item = find(id);

  if (!item) {
    const loading = nav.route.name === 'room' && rState === 'loading';
    return (
      <View style={{ flex: 1, backgroundColor: DAY.page }}>
        <DayHeader title={nav.route.name === 'flat' ? 'Flat' : 'Room'} />
        <View style={{ height: 16 }} />
        {loading ? <StateBlock kind="loading" /> : <StateBlock kind={rState === 'error' ? 'error' : 'empty'} title={rState === 'error' ? undefined : 'This place is no longer listed'} action={rState === 'error' ? 'Try again' : 'Go back'} onAction={rState === 'error' ? reload : nav.back} />}
      </View>
    );
  }
  const room = item.category === 'room';
  const km = kmText(item.distanceKm);
  const book = () => {
    if (item.isDemoContent) return nav.openSheet({ kind: 'sample', item });
    if (room && item.pgId) router.push(`/pg/book?pg=${encodeURIComponent(item.pgId)}&type=${encodeURIComponent(item.roomKey || '')}` as any);
  };
  const safeguards = room
    ? ['Your request goes to the ZENV housing team, who confirm the room with the PG before you pay.', item.deposit ? `Security deposit ${inr(item.deposit)}, paid to the PG at move-in.` : 'Rent is paid to the PG at move-in. Nothing is charged in the app.', 'Visit the PG before moving in; you can withdraw a request any time before it is confirmed.']
    : ['Visit the flat with the owner before paying anything.', item.deposit ? `Typical deposit ${inr(item.deposit)}, agreed with the owner in a written rental agreement.` : 'Agree the deposit in a written rental agreement.', 'Never pay token money online to someone you have not met.'];

  return (
    <View style={{ flex: 1, backgroundColor: DAY.page }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <Gallery item={item} height={Math.round(pw * 0.78)} />
        <DetailSheet>
          <FadeInUp>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={p.name} accessibilityRole="header">{item.title}</Text>
                {item.place ? <Text style={p.place} numberOfLines={1}>{item.place}</Text> : null}
              </View>
              {item.verified ? (
                <View style={p.verified}><IBadge size={14} color="#2F86E6" strokeWidth={1.9} /><Text style={p.verifiedText}>Verified</Text></View>
              ) : item.isDemoContent ? <SampleTag /> : null}
            </View>
            <Text style={p.price}>{inr(item.price)}<Text style={p.unit}>/month</Text></Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <IPin size={14} color={DAY.accent} strokeWidth={1.8} />
              <Text style={p.km}>{km ? `${km} from SRM University` : item.area}</Text>
            </View>
            {item.rating ? <View style={{ marginTop: 8 }}><Rating value={item.rating} count={item.reviews} /></View> : null}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>{item.specs.map((s) => <SpecChip key={s} label={s} />)}</View>
          </FadeInUp>
          <FadeInUp index={1}><FeatureRow features={item.features} category={item.category} /></FadeInUp>

          {item.about ? (<><SectionTitle>About the Property</SectionTitle><Text style={p.about}>{item.about}</Text></>) : null}

          {room && item.pgId ? (
            <View style={{ marginTop: 14 }}>
              <InfoRow Icon={IBuilding} title={`See ${item.place || 'the PG'}`} sub="Rooms, mess menu, rules, photos and reviews" onPress={() => router.push(`/pg/${encodeURIComponent(item.pgId!)}` as any)} />
            </View>
          ) : null}

          {item.owner ? (<>
            <SectionTitle>Owner Details</SectionTitle>
            <OwnerCard item={item} note={item.isDemoContent ? 'Sample owner for illustration' : 'Contact is shared once the housing team confirms'} />
          </>) : null}

          <SectionTitle>Good to know</SectionTitle>
          <Safeguards lines={safeguards} />
        </DetailSheet>
      </ScrollView>
      <View style={[p.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <CTA label="Book Now" sub={item.isDemoContent ? 'Sample listing' : room ? 'Send a request · no payment now' : undefined} onPress={book} />
      </View>
    </View>
  );
}

const p = StyleSheet.create({
  name: { fontSize: 21, fontWeight: W.title, color: DAY.ink, letterSpacing: -0.3 },
  place: { fontSize: 13, color: DAY.muted, marginTop: 3 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, height: 26, borderRadius: 13, backgroundColor: '#EAF3FE' },
  verifiedText: { fontSize: 12, color: '#2F86E6', fontWeight: W.label },
  price: { fontSize: 22, fontWeight: W.title, color: DAY.accent, marginTop: 10 },
  unit: { fontSize: 13, color: DAY.muted, fontWeight: W.body },
  km: { fontSize: 13, color: DAY.ink2 },
  about: { fontSize: 13.5, color: DAY.ink2, lineHeight: 20 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, backgroundColor: 'rgba(255,255,255,0.97)', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
});
