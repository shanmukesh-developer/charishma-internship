/**
 * Rentals v2 category listing (inner board 2): "← Bike Rentals" with the area and a pin, a filter button, the violet
 * promo hero with a floating cut-out, the category chips, and list rows (real first, samples after).
 * Filters: duration (Daily / Weekly / Monthly) for vehicles, price band, fuel and gear for vehicles, sort.
 * Rooms come from the real PG stays (room types); flats show samples while the switch is on, else "Coming soon".
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { DAY, W, shadow, CATEGORY_TITLE, type Category } from './rentalsV2Theme';
import { PROMO_ART } from './rentalsV2Art';
import { ChipRow, CTA, DayHeader, FadeInUp, GroundShadow, HeaderIcon, StateBlock, usePageW } from './RentalsV2Kit';
import { FloatY } from '../foodV2/FoodV2Motion';
import { IFilter, ISparkles } from './RentalsV2Icons';
import { ItemRow } from './RentalsV2Rows';
import { Options, Sheet, SheetLabel } from './RentalsV2Sheet';
import { useRentalsV2, type RItem } from './rentalsV2Data';
import { useNav, type Duration } from './rentalsV2Nav';

const HERO: Record<Category, { h: string; sub: string }> = {
  bike: { h: 'Ride More,\nWorry Less', sub: 'Scooters and bikes from verified students near campus' },
  car: { h: 'Drive Comfort,\nExplore More', sub: 'Hatchbacks to SUVs for trips, airport runs and weekends' },
  room: { h: 'Your Space,\nYour Peace', sub: 'Single and shared rooms in PG stays near SRM AP' },
  flat: { h: 'Modern Homes,\nBetter Living', sub: '1BHK, 2BHK and independent houses around campus' },
};
export const CHIPS: Record<Category, { key: string; label: string }[]> = {
  bike: [{ key: 'all', label: 'All' }, { key: 'scooter', label: 'Scooter' }, { key: 'sports', label: 'Sports' }, { key: 'premium', label: 'Premium' }],
  car: [{ key: 'all', label: 'All' }, { key: 'hatchback', label: 'Hatchback' }, { key: 'sedan', label: 'Sedan' }, { key: 'suv', label: 'SUV' }, { key: 'luxury', label: 'Luxury' }],
  room: [{ key: 'all', label: 'All' }, { key: 'single', label: 'Single' }, { key: 'shared', label: 'Shared' }, { key: 'pg', label: 'PG' }],
  flat: [{ key: 'all', label: 'All' }, { key: '1bhk', label: '1BHK' }, { key: '2bhk', label: '2BHK' }, { key: 'independent', label: 'Independent' }],
};
type Band = 'any' | 'low' | 'mid' | 'high';
const BANDS: Record<Category, [number, number]> = { bike: [400, 700], car: [1800, 2500], room: [6000, 10000], flat: [10000, 15000] };
const bandLabel = (c: Category, b: Band) => {
  const [lo, hi] = BANDS[c];
  const f = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  return b === 'any' ? 'Any' : b === 'low' ? `Under ${f(lo)}` : b === 'mid' ? `${f(lo)}–${f(hi).slice(1)}` : `${f(hi)}+`;
};
type Sort = 'rec' | 'low' | 'rating';
export interface Filters { duration: Duration; band: Band; fuel: string; gear: string; sort: Sort }
const NO_FILTERS: Filters = { duration: 'day', band: 'any', fuel: 'any', gear: 'any', sort: 'rec' };

export default function RentalsV2List() {
  const nav = useNav();
  const pw = usePageW();
  const { byCategory, vState, rState, vError, reload, campusLine } = useRentalsV2();
  const route = nav.route.name === 'list' ? nav.route : { name: 'list' as const, category: 'bike' as Category, chip: undefined };
  const cat = route.category;
  const [chip, setChip] = useState(route.chip && CHIPS[cat].some((c) => c.key === route.chip) ? route.chip : 'all');
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [open, setOpen] = useState(false);
  const vehicle = cat === 'bike' || cat === 'car';
  const state = cat === 'room' ? rState : cat === 'flat' ? 'ready' : vState;
  const all = byCategory(cat);

  const list = useMemo(() => {
    const [lo, hi] = BANDS[cat];
    let out = all.filter((i) => chip === 'all' || i.tags.includes(chip));
    if (f.band !== 'any') out = out.filter((i) => { const p = i.price || 0; return f.band === 'low' ? p < lo : f.band === 'mid' ? p >= lo && p <= hi : p > hi; });
    if (vehicle && f.fuel !== 'any') out = out.filter((i) => (i.fuel || '').toLowerCase() === f.fuel);
    if (vehicle && f.gear !== 'any') out = out.filter((i) => (i.gear || '').toLowerCase() === f.gear);
    if (vehicle && f.duration !== 'day') out = out.filter((i) => (f.duration === 'week' ? i.priceWeek : i.priceMonth) || !i.isDemoContent);
    const real = out.filter((i) => !i.isDemoContent);
    const demo = out.filter((i) => i.isDemoContent);
    const sorter = (a: RItem, b: RItem) => (f.sort === 'low' ? (a.price || 0) - (b.price || 0) : f.sort === 'rating' ? (b.rating || 0) - (a.rating || 0) : 0);
    return [...real.sort(sorter), ...demo.sort(sorter)].map((i) => {
      if (f.duration === 'week' && i.priceWeek) return { ...i, price: i.priceWeek, unit: 'week' as const };
      if (f.duration === 'month' && i.priceMonth) return { ...i, price: i.priceMonth, unit: 'month' as const };
      return i;
    });
  }, [all, chip, f, cat, vehicle]);
  const active = (f.band !== 'any' ? 1 : 0) + (f.fuel !== 'any' ? 1 : 0) + (f.gear !== 'any' ? 1 : 0) + (f.duration !== 'day' ? 1 : 0) + (f.sort !== 'rec' ? 1 : 0);
  const area = campusLine.split(',').slice(-1)[0].trim() === 'Amaravati' ? 'Mangalagiri' : campusLine.split(',').slice(-1)[0].trim();
  const heroH = Math.round(Math.min(168, pw * 0.4));

  return (
    <View style={{ flex: 1, backgroundColor: DAY.page }}>
      <DayHeader title={CATEGORY_TITLE[cat]} sub={area || 'Mangalagiri'} right={
        <HeaderIcon onPress={() => { setDraft(f); setOpen(true); }} label={active ? `Filters, ${active} on` : 'Filters'}>
          <IFilter size={19} color={DAY.ink} strokeWidth={1.7} />
          {active ? <View style={l.dot}><Text style={l.dotText}>{active}</Text></View> : null}
        </HeaderIcon>
      } />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <FadeInUp>
          <View style={[l.hero, { height: heroH }, shadow(3, DAY.accent)]}>
            <View style={[StyleSheet.absoluteFill, { borderRadius: 24, overflow: 'hidden' }]}>
              <LinearGradient colors={[DAY.hero[0], DAY.hero[1], DAY.hero[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <View style={[l.ring, { width: heroH * 1.5, height: heroH * 1.5, borderRadius: heroH, right: -heroH * 0.45, top: -heroH * 0.3 }]} />
              <View style={[l.ring, { width: heroH * 0.9, height: heroH * 0.9, borderRadius: heroH, right: heroH * 0.2, top: heroH * 0.35, backgroundColor: 'rgba(255,255,255,0.08)' }]} />
              <LinearGradient colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
            </View>
            <View style={{ flex: 1, paddingLeft: 18, paddingVertical: 16, justifyContent: 'center', zIndex: 2 }}>
              <View style={l.kicker}><ISparkles size={12} color="#FFFFFF" strokeWidth={1.8} /><Text style={l.kickerText}>Near campus</Text></View>
              <Text style={l.heroH}>{HERO[cat].h}</Text>
              <Text style={l.heroSub} numberOfLines={2}>{HERO[cat].sub}</Text>
            </View>
            <GroundShadow width={heroH * 1.1} height={16} opacity={0.4} color="#12053F" style={{ position: 'absolute', bottom: 10, right: heroH * 0.15 }} />
            <FloatY distance={3} period={4000} style={{ width: pw * 0.44, height: heroH * 0.9, marginRight: 4, marginTop: -16 }}>
              <Image source={PROMO_ART[cat]} style={{ width: '100%', height: '100%' }} contentFit="contain" contentPosition="bottom" accessibilityIgnoresInvertColors />
            </FloatY>
          </View>
        </FadeInUp>

        <ChipRow items={CHIPS[cat]} active={chip} onSelect={setChip} style={{ paddingVertical: 16 }} />

        {state === 'loading' && !list.length ? <StateBlock kind="loading" /> : null}
        {state === 'error' && !list.length ? <StateBlock kind={vError === 'offline' ? 'offline' : 'error'} action="Try again" onAction={reload} /> : null}
        {state !== 'loading' && !list.length && state !== 'error' ? (
          cat === 'flat'
            ? <StateBlock kind="soon" title="Flats are coming soon" body="We are adding 1BHK, 2BHK and independent houses around campus. Check back soon." />
            : <StateBlock kind="empty" title={chip === 'all' && !active ? 'Nothing listed yet' : 'No matches'} body={chip === 'all' && !active ? 'New listings appear here as soon as they are approved.' : 'Try another type or clear the filters.'} action={active ? 'Clear filters' : undefined} onAction={() => setF(NO_FILTERS)} />
        ) : null}
        <View style={{ gap: 12 }}>
          {list.map((it, i) => <FadeInUp key={it.id} index={i}><ItemRow item={it} /></FadeInUp>)}
        </View>
        {state === 'error' && list.length ? <Text style={l.foot}>Showing what we have. Live listings could not load right now.</Text> : null}
      </ScrollView>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Filters"
        footer={<View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><CTA label="Show results" onPress={() => { setF(draft); setOpen(false); }} /></View>
        </View>}>
        {vehicle ? (<>
          <SheetLabel>Rental duration</SheetLabel>
          <Options items={[{ key: 'day', label: 'Daily' }, { key: 'week', label: 'Weekly' }, { key: 'month', label: 'Monthly' }]} value={draft.duration} onChange={(d) => setDraft({ ...draft, duration: d as Duration })} />
        </>) : null}
        <SheetLabel>{vehicle ? 'Price per day' : 'Rent per month'}</SheetLabel>
        <Options items={(['any', 'low', 'mid', 'high'] as Band[]).map((b) => ({ key: b, label: bandLabel(cat, b) }))} value={draft.band} onChange={(b) => setDraft({ ...draft, band: b as Band })} />
        {vehicle ? (<>
          <SheetLabel>Fuel</SheetLabel>
          <Options items={[{ key: 'any', label: 'Any' }, { key: 'petrol', label: 'Petrol' }, { key: 'diesel', label: 'Diesel' }, { key: 'electric', label: 'Electric' }]} value={draft.fuel} onChange={(v) => setDraft({ ...draft, fuel: v })} />
          <SheetLabel>Gear</SheetLabel>
          <Options items={[{ key: 'any', label: 'Any' }, { key: 'automatic', label: 'Automatic' }, { key: 'manual', label: 'Manual' }]} value={draft.gear} onChange={(v) => setDraft({ ...draft, gear: v })} />
        </>) : null}
        <SheetLabel>Sort by</SheetLabel>
        <Options items={[{ key: 'rec', label: 'Recommended' }, { key: 'low', label: 'Price: low to high' }, { key: 'rating', label: 'Rating' }]} value={draft.sort} onChange={(v) => setDraft({ ...draft, sort: v as Sort })} />
        {active || draft !== NO_FILTERS ? (
          <Text onPress={() => setDraft(NO_FILTERS)} style={l.reset} accessibilityRole="link">Reset filters</Text>
        ) : null}
      </Sheet>
    </View>
  );
}

const l = StyleSheet.create({
  hero: { marginHorizontal: 16, marginTop: 6, borderRadius: 24, flexDirection: 'row', alignItems: 'center' },
  ring: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.10)' },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 8 },
  kickerText: { color: '#FFFFFF', fontSize: 11, fontWeight: W.label },
  heroH: { color: '#FFFFFF', fontSize: 20, lineHeight: 24, fontWeight: W.title, letterSpacing: -0.3 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 6, lineHeight: 16 },
  dot: { position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: DAY.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dotText: { color: '#FFFFFF', fontSize: 10, fontWeight: W.title },
  foot: { textAlign: 'center', color: DAY.muted, fontSize: 12, marginTop: 14 },
  reset: { color: DAY.accent, fontSize: 13.5, fontWeight: W.label, textAlign: 'center', marginTop: 20 },
});
