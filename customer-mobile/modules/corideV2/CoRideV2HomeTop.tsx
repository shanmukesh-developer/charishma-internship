/**
 * Co-Ride v2 home, top half (reference): the Others shell draws the header (ZCS emblem, "ZCS", "Co-Ride · Lifts
 * and autos", icons); this file is the hero ("Better Rides Together" beside the owner's art of two students on a scooter, a
 * car and a campus block), and the route card (Pickup / Destination with pins, clear, swap).
 * "Use current location" is hidden: expo-location is not installed in the customer app (owner decision).
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { CR, R, GUTTER, W, shadow } from './coRideV2Theme';
import { Tap, PrimaryButton } from './CoRideV2Kit';
import { IMapPin, IX, ISwap, ISearch, STROKE } from './CoRideV2Icons';
import { ART, ART_RATIO } from './coRideV2Art';

export function Hero() {
  const { width } = useWindowDimensions();
  const pageW = Math.min(width, 520);
  const artW = Math.round(pageW * 0.64);
  const artH = Math.round(artW / ART_RATIO.hero);
  return (
    <View style={[st.hero, { height: Math.max(148, artH + 30) }]}>
      <View style={[st.heroText, { maxWidth: Math.max(158, Math.round(pageW * 0.4)) }]}>
        <Text style={[st.h1, pageW < 380 && { fontSize: 24, lineHeight: 30 }]} numberOfLines={2} accessibilityRole="header">Better Rides{'\n'}<Text style={{ color: CR.primary }}>Together</Text></Text>
        <Text style={st.tagline} numberOfLines={2}>Share rides · Save fuel ·{'\n'}Make friends</Text>
      </View>
      <Image source={ART.hero} style={[st.heroArt, { width: artW, height: artH }]} contentFit="contain" accessibilityLabel="Two students on a scooter beside a car, campus behind" />
    </View>
  );
}

function Field({ label, value, onChange, onFocus, onSubmit, inputRef }: {
  label: string; value: string; onChange: (v: string) => void; onFocus: () => void; onSubmit: () => void; inputRef: React.RefObject<TextInput | null>;
}) {
  return (
    <Tap onPress={() => inputRef.current?.focus()} label={label} style={st.field}>
      <IMapPin size={20} color={CR.primary} strokeWidth={STROKE} />
      <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
        <Text style={st.fieldLabel}>{label}</Text>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          onFocus={onFocus}
          onSubmitEditing={onSubmit}
          placeholder={label === 'Pickup location' ? 'Where from?' : 'Where to?'}
          placeholderTextColor={CR.faint}
          style={st.fieldInput}
          maxLength={80}
          returnKeyType="search"
          accessibilityLabel={label}
        />
      </View>
      {value ? <Tap onPress={() => onChange('')} label={`Clear ${label.toLowerCase()}`} style={st.clear}><IX size={17} color={CR.muted} strokeWidth={STROKE} /></Tap> : null}
    </Tap>
  );
}

export function RouteCard({ from, to, setFrom, setTo, places, onSearch }: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; places: string[]; onSearch: () => void;
}) {
  const fromRef = useRef<TextInput>(null);
  const toRef = useRef<TextInput>(null);
  const [focus, setFocus] = useState<'from' | 'to' | null>(null);
  const current = focus === 'from' ? from : focus === 'to' ? to : '';
  const picks = focus ? places.filter((p) => !current || p.toLowerCase().includes(current.trim().toLowerCase())).slice(0, 8) : [];
  const pick = (p: string) => {
    if (focus === 'from') { setFrom(p); toRef.current?.focus(); setFocus('to'); }
    else { setTo(p); toRef.current?.blur(); setFocus(null); }
  };
  return (
    <View style={st.routeCard}>
      <View style={st.row}>
        <View style={{ flex: 1, gap: 10 }}>
          <Field label="Pickup location" value={from} onChange={setFrom} onFocus={() => setFocus('from')} onSubmit={() => toRef.current?.focus()} inputRef={fromRef} />
          <Field label="Destination" value={to} onChange={setTo} onFocus={() => setFocus('to')} onSubmit={onSearch} inputRef={toRef} />
        </View>
        <Tap onPress={() => { setFrom(to); setTo(from); }} label="Swap pickup and destination" style={st.swap}>
          <ISwap size={20} color={CR.primary} strokeWidth={STROKE} />
        </Tap>
      </View>
      {picks.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={st.picks}>
          {picks.map((p) => (
            <Tap key={p} onPress={() => pick(p)} label={p} style={st.pick}><Text style={st.pickText}>{p}</Text></Tap>
          ))}
        </ScrollView>
      ) : null}
      {from.trim() || to.trim() ? <PrimaryButton label="Find rides" icon={ISearch} onPress={onSearch} small style={{ marginTop: 12 }} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  hero: { flexDirection: 'row', paddingHorizontal: GUTTER, overflow: 'visible' },
  heroText: { flex: 1, paddingTop: 14, zIndex: 2 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: W.title, color: CR.ink, letterSpacing: -0.6 },
  tagline: { marginTop: 8, fontSize: 11.5, color: CR.ink2, lineHeight: 17 },
  heroArt: { position: 'absolute', right: 0, bottom: -18 },
  routeCard: { marginHorizontal: GUTTER, backgroundColor: CR.card, borderRadius: R.xl, padding: 12, zIndex: 3, ...shadow(2) },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: CR.field, borderRadius: R.md, paddingLeft: 12, minHeight: 56 },
  fieldLabel: { fontSize: 11.5, color: CR.muted },
  fieldInput: { fontSize: 14.5, color: CR.ink, fontWeight: W.label, paddingVertical: 2, paddingRight: 4, outlineStyle: 'none' } as any,
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  swap: { width: 44, height: 44, borderRadius: 22, backgroundColor: CR.tint, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  picks: { gap: 8, paddingTop: 12, paddingRight: 4 },
  pick: { height: 34, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: CR.tint, justifyContent: 'center' },
  pickText: { fontSize: 13, color: CR.tintInk, fontWeight: W.label },
});
