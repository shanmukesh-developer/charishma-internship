/**
 * Rentals v2 explore (inner board 1, light): the page title, a search near campus, four wide tinted category cards
 * with cut-outs and real "From ₹X" prices, and "How it works" with only what is true today (vehicle listings are
 * reviewed, PIN handover, pay at pickup, support). No promo banner: there is no real student offer.
 * Typing searches real rentals and PG rooms (samples after them).
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { DAY, PLATE, W, shadow, CATEGORY_TITLE, type Category } from './rentalsV2Theme';
import { EXPLORE_ART } from './rentalsV2Art';
import { FadeInUp, GroundShadow, Press, StateBlock, usePageW } from './RentalsV2Kit';
import { IArrowLeft, IArrowRight, IBadge, IChat, IKey, IReceipt, ISearch, IX, IPin } from './RentalsV2Icons';
import { ItemRow } from './RentalsV2Rows';
import { CAMPUSES, fromPrice, searchItems, useRentalsV2 } from './rentalsV2Data';
import { useNav } from './rentalsV2Nav';
import { useTopInset } from '../../utils/useTopInset';

const SUB: Record<Category, string> = {
  bike: 'Scooters and motorcycles', car: 'Hatchbacks, sedans and SUVs', room: 'Single and shared rooms', flat: '1BHK, 2BHK and houses',
};
const WHY = [
  { Icon: IBadge, label: 'Reviewed listings', note: 'Each vehicle is checked' },
  { Icon: IKey, label: 'PIN handover', note: 'Pickup and return' },
  { Icon: IReceipt, label: 'Pay at pickup', note: 'Nothing paid online' },
  { Icon: IChat, label: 'Support', note: 'Help from ZENV' },
];

function WideCard({ kind, index }: { kind: Category; index: number }) {
  const nav = useNav();
  const { items, vState, rState } = useRentalsV2();
  const plate = PLATE[kind];
  const pw = usePageW();
  const from = fromPrice(items, kind);
  const loading = (kind === 'room' ? rState : vState) === 'loading' && !from;
  const h = Math.round(Math.min(132, pw * 0.33));
  return (
    <FadeInUp index={index}>
      <Press onPress={() => nav.push({ name: 'list', category: kind })} label={`${CATEGORY_TITLE[kind]}. ${SUB[kind]}. ${from}`} style={[x.card, { height: h }, shadow(2, plate.ink)]}>
        <LinearGradient colors={[plate.bg[0], plate.bg[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 22 }]} />
        <View style={[x.blob, { backgroundColor: plate.blob, width: h * 1.5, height: h * 1.5, borderRadius: h, right: -h * 0.3, top: -h * 0.35 }]} />
        <LinearGradient colors={['rgba(255,255,255,0.7)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '45%', borderRadius: 22 }]} />
        <View style={{ flex: 1, paddingLeft: 18, justifyContent: 'center', zIndex: 2 }}>
          <Text style={[x.title, { color: DAY.ink }]}>{CATEGORY_TITLE[kind]}</Text>
          <Text style={x.sub} numberOfLines={1}>{SUB[kind]}</Text>
          <View style={x.fromRow}>
            <Text style={[x.from, { color: plate.ink }]}>{loading ? ' ' : from || 'Coming soon'}</Text>
            <View style={[x.go, { backgroundColor: plate.ink }]}><IArrowRight size={13} color="#FFFFFF" strokeWidth={2.1} /></View>
          </View>
        </View>
        <GroundShadow width={h * 1.1} height={14} opacity={0.24} color="#2A1F6A" style={{ position: 'absolute', bottom: 8, right: h * 0.22 }} />
        <View style={{ width: h * 1.25, height: h * 0.92, marginRight: 8, marginTop: -6 }} pointerEvents="none">
          <Image source={EXPLORE_ART[kind]} style={{ width: '100%', height: '100%' }} contentFit="contain" contentPosition="bottom" transition={240} accessibilityIgnoresInvertColors />
        </View>
      </Press>
    </FadeInUp>
  );
}

export default function RentalsV2Explore() {
  const nav = useNav();
  const top = useTopInset(36, 44);
  const { items, vState, rState, recent, addRecent } = useRentalsV2();
  const route = nav.route.name === 'explore' ? nav.route : { name: 'explore' as const };
  const [q, setQ] = useState(route.q || '');
  const [searching, setSearching] = useState(!!route.focus || !!route.q);
  const near = CAMPUSES.find((c) => c.key === route.near);
  const results = useMemo(() => searchItems(items, q), [items, q]);
  const nearList = useMemo(() => (near ? [...items].sort((a, b) => (a.distanceKm ?? 0.8) - (b.distanceKm ?? 0.8)) : []), [items, near]);

  return (
    <View style={{ flex: 1, backgroundColor: DAY.page }}>
      <ScrollView contentContainerStyle={{ paddingTop: top, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={x.head}>
          <Press onPress={nav.back} label="Back" style={x.back}><IArrowLeft size={20} color={DAY.ink} strokeWidth={1.7} /></Press>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={x.h1} accessibilityRole="header">Rentals</Text>
            <Text style={x.hey}>Bikes, cars, rooms and flats near campus</Text>
          </View>
        </View>

        <View style={[x.search, shadow(1)]}>
          <ISearch size={18} color={DAY.muted} strokeWidth={1.7} />
          <TextInput value={q} onChangeText={(t) => { setQ(t); setSearching(true); }} onFocus={() => setSearching(true)} autoFocus={!!route.focus}
            onSubmitEditing={() => addRecent(q)} returnKeyType="search" placeholder="Search near SRM University…" placeholderTextColor={DAY.muted}
            style={x.input} accessibilityLabel="Search rentals" />
          {q ? <Press onPress={() => setQ('')} label="Clear search" style={x.clear}><IX size={16} color={DAY.muted} strokeWidth={1.8} /></Press> : null}
        </View>

        {searching && q.trim() ? (
          <View style={{ marginTop: 16, gap: 12 }}>
            <Text style={x.count}>{results.length} result{results.length === 1 ? '' : 's'} for “{q.trim()}”</Text>
            {results.length ? results.slice(0, 40).map((it) => <ItemRow key={it.id} item={it} />) : (
              <StateBlock kind="empty" title="No matches" body="Try a vehicle name like Activa or Swift, a place like Neerukonda, or a room type like single." />
            )}
          </View>
        ) : searching && recent.length ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {recent.map((r) => <Press key={r} onPress={() => setQ(r)} label={`Search ${r}`} style={x.recent}><Text style={x.recentText}>{r}</Text></Press>)}
          </View>
        ) : null}

        {!q.trim() && near ? (
          <View style={{ marginTop: 16, gap: 12 }}>
            <View style={[x.note, shadow(1)]}>
              <IPin size={16} color={DAY.accent} strokeWidth={1.7} />
              <Text style={x.noteText}>{near.key === 'srm' ? 'Rentals around SRM University AP, closest first.' : `Listings are around SRM AP, ${near.km.toFixed(1)} km from ${near.name}. Closest first.`}</Text>
            </View>
            {vState === 'loading' && rState === 'loading' ? <StateBlock kind="loading" /> : nearList.slice(0, 30).map((it) => <ItemRow key={it.id} item={it} />)}
          </View>
        ) : null}

        {!q.trim() && !near ? (
          <>
            <View style={{ gap: 14, marginTop: 18 }}>
              {(['bike', 'car', 'room', 'flat'] as Category[]).map((k, i) => <WideCard key={k} kind={k} index={i} />)}
            </View>
            <Text style={[x.whyTitle]}>How it works</Text>
            <View style={[x.why, shadow(1)]}>
              {WHY.map((w) => (
                <View key={w.label} style={x.whyItem} accessibilityLabel={`${w.label}. ${w.note}`}>
                  <LinearGradient colors={['#F3EFFF', '#E6DEFF']} style={x.whyIcon}><w.Icon size={20} color={DAY.accent} strokeWidth={1.6} /></LinearGradient>
                  <Text style={x.whyLabel} numberOfLines={2}>{w.label}</Text>
                  <Text style={x.whyNote} numberOfLines={2}>{w.note}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const x = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', ...shadow(1) },
  hey: { fontSize: 13, color: DAY.muted, marginTop: 2 },
  h1: { fontSize: 21, color: DAY.ink, fontWeight: W.title, letterSpacing: -0.3 },
  search: { marginHorizontal: 16, marginTop: 18, height: 52, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, gap: 10 },
  input: { flex: 1, fontSize: 14.5, color: DAY.ink, height: '100%', outlineStyle: 'none' } as any,
  clear: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: DAY.lineSoft },
  count: { fontSize: 13, color: DAY.muted, paddingHorizontal: 18 },
  recent: { paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: DAY.line, justifyContent: 'center' },
  recentText: { fontSize: 12.5, color: DAY.ink2 },
  card: { marginHorizontal: 16, borderRadius: 22, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  blob: { position: 'absolute', opacity: 0.55 },
  title: { fontSize: 18, fontWeight: W.title, letterSpacing: -0.2 },
  sub: { fontSize: 12.5, color: DAY.ink2, marginTop: 3 },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  from: { fontSize: 13.5, fontWeight: W.title },
  go: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  note: { marginHorizontal: 16, flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: '#FFFFFF' },
  noteText: { flex: 1, fontSize: 12.5, color: DAY.ink2, lineHeight: 17 },
  whyTitle: { fontSize: 16, fontWeight: W.title, color: DAY.ink, marginTop: 24, marginBottom: 12, paddingHorizontal: 18 },
  why: { marginHorizontal: 16, padding: 14, borderRadius: 20, backgroundColor: '#FFFFFF', flexDirection: 'row', gap: 6 },
  whyItem: { flex: 1, alignItems: 'center' },
  whyIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  whyLabel: { fontSize: 12, color: DAY.ink, fontWeight: W.label, textAlign: 'center' },
  whyNote: { fontSize: 10.5, color: DAY.muted, textAlign: 'center', marginTop: 2 },
});
