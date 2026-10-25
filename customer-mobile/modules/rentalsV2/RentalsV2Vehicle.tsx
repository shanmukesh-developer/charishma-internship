/**
 * Rentals v2 vehicle detail (inner board 3): gallery with back / share / heart, name, rating (real only), price,
 * fuel and gear chips, spec icon row, "Choose Rental Duration" (Daily / Weekly / Monthly), pickup location,
 * owner card, the safeguards of the real rentals flow, reviews, and a full-width violet "Book Now".
 * Real listings load GET /api/rentals/listings/:id (terms, reviews); samples open the sample sheet.
 * The board's car "Additional Services" (driver, GPS) are left out: the rentals backend has no such add-ons.
 */
import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rentalsApi, modeOf, wordsOf, type Review, type SafetyInfo } from '../rentals/rentalsApi';
import { DAY, W, shadow } from './rentalsV2Theme';
import { CTA, DayHeader, FadeInUp, Rating, SampleTag, Segmented, SpecChip, StateBlock, usePageW } from './RentalsV2Kit';
import { DetailSheet, FeatureRow, Gallery, InfoRow, OwnerCard, Safeguards, SectionTitle } from './RentalsV2DetailParts';
import { IPin, IClock, IStar } from './RentalsV2Icons';
import { fromListing, inr, isSampleId, useRentalsV2, type RItem } from './rentalsV2Data';
import { useNav, type Duration } from './rentalsV2Nav';

const DUR: { key: Duration; label: string }[] = [{ key: 'day', label: 'Daily' }, { key: 'week', label: 'Weekly' }, { key: 'month', label: 'Monthly' }];

export function useItem(id: string) {
  const { find, vState } = useRentalsV2();
  const local = find(id);
  const [fetched, setFetched] = useState<RItem | null>(null);
  const [safety, setSafety] = useState<SafetyInfo | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!id || isSampleId(id) || id.includes('~')) return undefined;
    let live = true;
    rentalsApi.listing(id).then((r) => {
      if (!live) return;
      setFetched(fromListing(r.listing));
      setSafety(r.safety || null);
      setReviews(r.reviews || []);
    }).catch((e: any) => { if (live) setErr(e?.code === 'NETWORK' ? 'offline' : e?.status === 404 ? 'gone' : 'error'); });
    return () => { live = false; };
  }, [id]);
  const item = local || fetched;
  const state: 'loading' | 'ready' | 'offline' | 'error' | 'gone' = item ? 'ready' : err ? (err as any) : vState === 'error' ? 'error' : 'loading';
  return { item, safety, reviews, state };
}

export function priceForDuration(item: RItem, d: Duration): { price: number | null; unit: string; note: string } {
  if (d === 'week') return item.priceWeek ? { price: item.priceWeek, unit: '/week', note: '' } : { price: item.price, unit: item.unit === 'hour' ? '/hr' : '/day', note: 'Weekly price comes from the quote for your dates' };
  if (d === 'month') return item.priceMonth ? { price: item.priceMonth, unit: '/month', note: '' } : { price: item.price, unit: item.unit === 'hour' ? '/hr' : '/day', note: 'Monthly price comes from the quote for your dates' };
  return { price: item.price, unit: item.unit === 'hour' ? '/hr' : '/day', note: '' };
}

export function vehicleSafeguards(item: RItem, safety: SafetyInfo | null): string[] {
  const car = item.category === 'car';
  const lines = [
    `Your driving licence (${car ? 'LMV' : 'MCWOG or MCWG'}) is checked by the ZCS team before your first booking.`,
    item.deposit ? `Refundable deposit of ${inr(item.deposit)}, paid in cash at pickup and returned at drop-off.` : 'Rent is paid at pickup. Nothing is charged online.',
    'Pickup and return are confirmed with a one-time PIN, with condition photos on both sides.',
  ];
  if (item.listing && modeOf(item.listing) === 'BORROW') lines.push('Private-plate vehicle: borrowed from a classmate at a cost share, never rented commercially.');
  else lines.push('Private-plate vehicles can only be borrowed at a cost share; commercial plates are rented.');
  (safety?.terms || []).slice(0, 3).forEach((t) => { if (!lines.includes(t)) lines.push(t); });
  return lines;
}

export default function RentalsV2Vehicle() {
  const nav = useNav();
  const pw = usePageW();
  const insets = useSafeAreaInsets();
  const id = nav.route.name === 'vehicle' ? nav.route.id : '';
  const { item, safety, reviews, state } = useItem(id);
  const [dur, setDur] = useState<Duration>('day');

  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: DAY.page }}>
        <DayHeader title="Vehicle" />
        <View style={{ height: 16 }} />
        {state === 'loading' ? <StateBlock kind="loading" /> : (
          <StateBlock kind={state === 'offline' ? 'offline' : 'empty'} title={state === 'gone' ? 'This vehicle is no longer listed' : undefined} action="Go back" onAction={nav.back} />
        )}
      </View>
    );
  }
  const p = priceForDuration(item, dur);
  const words = item.listing ? wordsOf(item.listing) : null;
  const pickup = item.listing?.pickupLat && item.listing?.pickupLon ? () => Linking.openURL(`https://maps.google.com/?q=${item.listing!.pickupLat},${item.listing!.pickupLon}`).catch(() => {}) : undefined;
  const book = () => nav.openSheet(item.isDemoContent ? { kind: 'sample', item } : { kind: 'book', item, duration: dur });

  return (
    <View style={{ flex: 1, backgroundColor: DAY.page }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <Gallery item={item} height={Math.round(pw * 0.78)} />
        <DetailSheet>
          <FadeInUp>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={v.name} accessibilityRole="header">{item.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {item.rating ? <Rating value={item.rating} count={item.reviews} /> : <Text style={v.muted}>New listing</Text>}
                  {item.isDemoContent ? <SampleTag /> : null}
                  {words ? <View style={[v.mode, { backgroundColor: words.color + '1F' }]}><Text style={[v.modeText, { color: words.color }]}>{words.badge}</Text></View> : null}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={v.price}>{inr(p.price)}<Text style={v.unit}>{p.unit}</Text></Text>
                {item.deposit ? <Text style={v.muted}>Deposit {inr(item.deposit)}</Text> : null}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>{item.specs.map((s) => <SpecChip key={s} label={s} />)}</View>
          </FadeInUp>
          <FadeInUp index={1}><FeatureRow features={item.features} category={item.category} /></FadeInUp>

          <SectionTitle>Choose Rental Duration</SectionTitle>
          <Segmented items={DUR} value={dur} onChange={setDur} />
          {p.note ? <Text style={[v.muted, { marginTop: 8 }]}>{p.note}</Text> : null}

          <SectionTitle>Pickup Location</SectionTitle>
          <InfoRow Icon={IPin} title={item.area === 'On campus' || !item.area ? 'Near SRM University' : item.area} sub={item.listing?.pickupLocation ? 'Exact spot shared once your request is accepted' : item.isDemoContent ? 'Sample listing · area shown for reference' : undefined} onPress={pickup} />
          {item.listing?.minHours ? <View style={{ marginTop: 10 }}><InfoRow Icon={IClock} title={`Minimum ${item.listing.minHours} hour${item.listing.minHours === 1 ? '' : 's'}`} sub={item.listing.kmLimitPerDay ? `${item.listing.kmLimitPerDay} km a day included${item.listing.extraPerKm ? ` · ${inr(item.listing.extraPerKm)} per extra km` : ''}` : undefined} /></View> : null}

          {item.about ? (<><SectionTitle>About this {item.category === 'car' ? 'car' : 'ride'}</SectionTitle><Text style={v.about}>{item.about}</Text></>) : null}

          <SectionTitle>{words ? words.Giver : 'Owner'}</SectionTitle>
          <OwnerCard item={item} role={words ? words.Giver : 'Owner'} note={item.isDemoContent ? 'Sample owner for illustration' : 'Phone number is shared after your request is accepted'} />

          <SectionTitle>Safe and simple</SectionTitle>
          <Safeguards lines={vehicleSafeguards(item, safety)} />
          {safety?.disclaimer ? <Text style={[v.muted, { marginTop: 10, lineHeight: 17 }]}>{safety.disclaimer.replace(/Zenvy/g, 'ZCS')}</Text> : null}

          {reviews.length ? (
            <>
              <SectionTitle>Reviews</SectionTitle>
              <View style={{ gap: 10 }}>
                {reviews.slice(0, 3).map((r) => (
                  <View key={r.id} style={[v.review, shadow(1)]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <IStar size={13} color={DAY.star} fill={DAY.star} strokeWidth={1.4} />
                      <Text style={v.reviewHead}>{r.rating.toFixed(1)} · {r.reviewer?.name || 'Student'}</Text>
                    </View>
                    {r.text ? <Text style={v.about}>{r.text}</Text> : null}
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </DetailSheet>
      </ScrollView>
      <View style={[v.footer, { paddingBottom: Math.max(insets.bottom, 12) }, shadow(2)]}>
        <CTA label="Book Now" sub={item.isDemoContent ? 'Sample listing' : words ? `${words.verb} · pay at pickup` : undefined} onPress={book} />
      </View>
    </View>
  );
}

const v = StyleSheet.create({
  name: { fontSize: 21, fontWeight: W.title, color: DAY.ink, letterSpacing: -0.3 },
  muted: { fontSize: 12, color: DAY.muted },
  price: { fontSize: 21, fontWeight: W.title, color: DAY.accent },
  unit: { fontSize: 13, color: DAY.muted, fontWeight: W.body },
  mode: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  modeText: { fontSize: 11, fontWeight: W.label },
  about: { fontSize: 13.5, color: DAY.ink2, lineHeight: 20 },
  review: { padding: 12, borderRadius: 14, backgroundColor: '#FFFFFF', gap: 6 },
  reviewHead: { fontSize: 12.5, color: DAY.ink, fontWeight: W.label },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, backgroundColor: 'rgba(255,255,255,0.97)', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
});
