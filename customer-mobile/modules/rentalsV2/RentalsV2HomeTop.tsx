/**
 * Rentals v2 home, top (owner board, 25 Oct): the dusk-city hero under the status bar with the ZCS brand row
 * (gold Z emblem, "Rent. Ride. Live. Explore.", bell with a dot, avatar), the three-line headline with the violet
 * "Possibilities." and its swash, the handwritten "Your Campus · Your City · Your ZCS", the search pill with a
 * violet go-button, the location line, and the Others section pills (the app needs them to switch sections).
 */
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTopInset } from '../../utils/useTopInset';
import { useUnreadDot } from '../foodV2/FoodV2HomeTop';
import { FloatY, ShineSweep } from '../foodV2/FoodV2Motion';
import { HERO_DUSK, ZCS_EMBLEM } from './rentalsV2Art';
import { NIGHT, W } from './rentalsV2Theme';
import { Press, usePageW } from './RentalsV2Kit';
import { IArrowRight, IBell, IChevronDown, IPin, ISearch } from './RentalsV2Icons';
import { useNav } from './rentalsV2Nav';
import { useRentalsV2 } from './rentalsV2Data';

/** Handwritten face from the platform (no font download): Android's Dancing Script, iOS Snell Roundhand, web Segoe Print. */
export const SCRIPT = Platform.select({ android: 'cursive', ios: 'SnellRoundhand', default: '"Segoe Print", "Snell Roundhand", "Bradley Hand", cursive' });

export function Swash({ width, height = 10, colors = NIGHT.swash, style }: { width: number; height?: number; colors?: readonly [string, string]; style?: any }) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={style}>
      <Defs>
        <SvgGrad id={`g${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors[0]} stopOpacity="0.95" />
          <Stop offset="1" stopColor={colors[1]} stopOpacity="0.2" />
        </SvgGrad>
      </Defs>
      <Path d={`M2 ${height * 0.75} Q ${width * 0.45} ${height * 0.05} ${width - 2} ${height * 0.45}`} stroke={`url(#g${id})`} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function HomeTop({ sections, active = 'rentals' }: { sections?: { key: string; label: string }[]; active?: string }) {
  const router = useRouter();
  const nav = useNav();
  const top = useTopInset(36, 44);
  const w = usePageW();
  const { user } = useAuth();
  const unread = useUnreadDot();
  const { campusLine } = useRentalsV2();
  const avatar = (user as any)?.profileImage || (user as any)?.avatar || null;
  const initial = String(user?.name || 'Z').trim().charAt(0).toUpperCase();
  const compact = w < 380;
  const head = compact ? 17.5 : 19.5;
  return (
    <View style={{ paddingTop: top, paddingBottom: 14 }}>
      <Image source={HERO_DUSK} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="right" />
      <LinearGradient colors={['rgba(18,19,63,0.45)', 'rgba(18,19,63,0)', 'rgba(20,20,56,0)']} locations={[0, 0.3, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(24,20,70,0.55)', 'rgba(24,20,70,0.08)', 'rgba(24,20,70,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(20,20,56,0)', NIGHT.page]} style={[StyleSheet.absoluteFill, { top: '72%' }]} />

      {/* Brand row */}
      <View style={s.brandRow}>
        <View style={s.emblemRing}><Image source={ZCS_EMBLEM} style={{ width: '100%', height: '100%', borderRadius: 17 }} contentFit="cover" accessibilityLabel="ZCS" /></View>
        <View style={{ flex: 1, marginLeft: 9 }}>
          <Text style={s.brand}>ZCS</Text>
          <Text style={s.tagline} numberOfLines={1}>Rent. Ride. Live. Explore.</Text>
        </View>
        <Press onPress={() => router.push('/notifications' as any)} label={unread ? 'Notifications, unread' : 'Notifications'} style={s.bell}>
          <IBell size={17} color="#FFFFFF" strokeWidth={1.7} />
          {unread ? <View style={s.bellDot} /> : null}
        </Press>
        <Press onPress={() => router.push('/(tabs)/profile' as any)} label="Your profile" style={s.avatarRing}>
          {avatar ? <Image source={{ uri: avatar }} style={s.avatar} contentFit="cover" /> : (
            <LinearGradient colors={['#C4B5FD', '#7C5CF0']} style={[s.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: W.title }}>{initial}</Text>
            </LinearGradient>
          )}
          <View style={s.avatarDot} />
        </Press>
      </View>

      {/* Headline + script tagline */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 16, minHeight: 92 }}>
        <View style={{ flex: 1 }} accessibilityRole="header" accessibilityLabel="More rides. More rooms. More possibilities.">
          <Text style={[s.h1, { fontSize: head, lineHeight: head + 3.5 }]}>More Rides.</Text>
          <Text style={[s.h1, { fontSize: head, lineHeight: head + 3.5 }]}>More Rooms.</Text>
          <Text style={[s.h1, { fontSize: head, lineHeight: head + 3.5 }]}>More <Text style={{ color: NIGHT.possibilities }}>Possibilities.</Text></Text>
          <Swash width={compact ? 108 : 122} height={9} style={{ marginLeft: compact ? 46 : 52, marginTop: 1 }} />
        </View>
        <FloatY distance={2} period={4200} style={{ width: compact ? 104 : 118, paddingTop: 22, alignItems: 'flex-end' }}>
          <View style={{ transform: [{ rotate: '-8deg' }] }} accessibilityLabel="Your campus, your city, your ZCS">
            <Text style={s.script}>Your Campus</Text>
            <Text style={[s.script, { marginLeft: 6 }]}>Your City</Text>
            <Text style={[s.script, { marginLeft: 12 }]}>Your ZCS</Text>
            <Swash width={74} height={8} colors={['#FFFFFF', '#F5D0FE']} style={{ marginLeft: 16 }} />
          </View>
        </FloatY>
      </View>

      {/* Search */}
      <View style={[s.search, { marginTop: 12 }]}>
        <Press onPress={() => nav.push({ name: 'explore', focus: true })} label="Search bikes, cars, rooms or flats" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, height: '100%' }} scaleTo={0.99}>
          <ISearch size={17} color="#6B6B8F" strokeWidth={1.8} />
          <Text style={s.searchText} numberOfLines={1}>Search bikes, cars, rooms or flats…</Text>
        </Press>
        <Press onPress={() => nav.push({ name: 'explore', focus: true })} label="Search" style={s.go} scaleTo={0.9}>
          <LinearGradient colors={[NIGHT.go[0], NIGHT.go[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <ShineSweep width={34} every={4200} />
          <View><IArrowRight size={16} color="#FFFFFF" strokeWidth={2} /></View>
        </Press>
      </View>

      {/* Location */}
      <Press onPress={() => nav.push({ name: 'explore' })} label={`Location: ${campusLine}`} style={s.loc} scaleTo={0.98}>
        <IPin size={15} color={NIGHT.pin} fill="rgba(245,163,215,0.25)" strokeWidth={1.8} />
        <Text style={s.locText} numberOfLines={1}>{campusLine}</Text>
        <IChevronDown size={14} color={NIGHT.sub} strokeWidth={1.8} />
      </Press>

      {/* Others sections */}
      {sections && sections.length > 1 && nav.onSection ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 7, marginTop: 12 }}>
          {sections.map((t) => {
            const on = t.key === active;
            return (
              <Press key={t.key} onPress={() => nav.onSection?.(t.key)} label={t.label} style={[s.pill, on ? s.pillOn : null]}>
                <Text style={[s.pillText, on ? { color: '#24135F' } : null]}>{t.label}</Text>
              </Press>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  emblemRing: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#C9A24A', padding: 1, backgroundColor: '#1A1240' },
  brand: { color: '#FFFFFF', fontSize: 21, fontWeight: W.title, letterSpacing: 0.4, lineHeight: 24 },
  tagline: { color: 'rgba(235,232,255,0.82)', fontSize: 10.5, marginTop: 1, letterSpacing: 0.2 },
  bell: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  bellDot: { position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: NIGHT.bellDot, borderWidth: 1, borderColor: '#FFFFFF' },
  avatarRing: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', padding: 1.5 },
  avatar: { width: '100%', height: '100%', borderRadius: 17 },
  avatarDot: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#7C5CF0', borderWidth: 1.5, borderColor: '#FFFFFF' },
  h1: { color: '#FFFFFF', fontWeight: W.hero, letterSpacing: -0.3 },
  script: { fontFamily: SCRIPT, color: '#FFFFFF', fontSize: 13.5, lineHeight: 18, textShadowColor: 'rgba(60,20,90,0.5)', textShadowRadius: 6 },
  search: { marginHorizontal: 14, height: 42, borderRadius: 21, backgroundColor: 'rgba(250,249,255,0.94)', flexDirection: 'row', alignItems: 'center', paddingLeft: 15, paddingRight: 5 },
  searchText: { color: '#6B6B8F', fontSize: 13, flex: 1 },
  go: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, marginTop: 12, alignSelf: 'flex-start', minHeight: 24 },
  locText: { color: '#FFFFFF', fontSize: 12, fontWeight: W.label, maxWidth: 260 },
  pill: { height: 30, paddingHorizontal: 13, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)', justifyContent: 'center' },
  pillOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  pillText: { color: 'rgba(240,238,255,0.92)', fontSize: 12, fontWeight: W.label },
});
