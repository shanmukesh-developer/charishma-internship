/**
 * Rentals v2 home: "Popular This Week" (real first, then samples) and the shared night styles `g`.
 * The category cards and "Near Your Campus" live in RentalsV2CategoryCards.tsx.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { NIGHT, W } from './rentalsV2Theme';
import { FadeInUp, Press, usePageW } from './RentalsV2Kit';
import { IArrowRight } from './RentalsV2Icons';
import { PopularCard } from './RentalsV2Rows';
import { popularItems, useRentalsV2 } from './rentalsV2Data';
import { useNav } from './rentalsV2Nav';

export function PopularWeek() {
  const nav = useNav();
  const { items } = useRentalsV2();
  const pw = usePageW();
  const list = popularItems(items, 8);
  const cw = Math.round((pw - 20 - 18) / 4.15);
  return (
    <View style={{ marginTop: 22 }}>
      <View style={[g.secRow, { justifyContent: 'space-between' }]}>
        <Text style={g.secTitle}>Popular This Week</Text>
        <Press onPress={() => nav.push({ name: 'explore' })} label="View all" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 }}>
          <Text style={g.viewAll}>View all</Text>
          <IArrowRight size={13} color="#FFFFFF" strokeWidth={1.8} />
        </Press>
      </View>
      {list.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, gap: 6 }}>
          {list.map((it, i) => <FadeInUp key={it.id} index={i}><PopularCard item={it} w={Math.max(84, cw)} /></FadeInUp>)}
        </ScrollView>
      ) : (
        <View style={[g.campus, { marginHorizontal: 10, padding: 14 }]}><Text style={g.campusKm}>Popular rentals will show here as students book them.</Text></View>
      )}
    </View>
  );
}

export const g = StyleSheet.create({
  glow: { position: 'absolute', opacity: 0.6 },
  pin: { position: 'absolute', right: 10, top: 10 },
  title: { color: '#FFFFFF', fontSize: 16.5, fontWeight: W.title, lineHeight: 20, letterSpacing: -0.2, textShadowColor: 'rgba(30,20,80,0.22)', textShadowRadius: 6 },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 10, marginTop: 5 },
  arrow: { position: 'absolute', right: 9, bottom: 9, width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  section: { color: '#FFFFFF', fontSize: 15, fontWeight: W.title, letterSpacing: -0.1 },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, marginBottom: 11 },
  secTitle: { color: '#FFFFFF', fontSize: 14.5, fontWeight: W.title },
  viewAll: { color: '#FFFFFF', fontSize: 12, fontWeight: W.label },
  campus: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 46, paddingHorizontal: 7, borderRadius: 12, backgroundColor: NIGHT.chip, borderWidth: 1, borderColor: NIGHT.chipLine },
  mono: { width: 28, height: 28, borderRadius: 14, padding: 2 },
  monoRing: { flex: 1, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)', alignItems: 'center', justifyContent: 'center' },
  monoText: { fontWeight: W.title, letterSpacing: 0.2 },
  campusName: { color: '#FFFFFF', fontSize: 10.5, fontWeight: W.label },
  campusKm: { color: NIGHT.sub, fontSize: 10.5, marginTop: 2 },
});
