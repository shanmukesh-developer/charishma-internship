/**
 * Rentals v2 home, top: the dusk-city hero photo under the status bar with the ZCS brand row (gold Z emblem,
 * "Rentals", bell with an unread dot, avatar), a plain headline and one factual line, the search pill with a violet
 * go-button, the location line, and the shared Others section rail (the active "Rentals" pill is scrolled into view).
 * Owner, 26 Oct: official and still. No script, swashes or looping motion.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import SectionPillRail from '../others/SectionPillRail';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTopInset } from '../../utils/useTopInset';
import { useUnreadDot } from '../foodV2/FoodV2HomeTop';
import { HERO_DUSK, ZCS_EMBLEM } from './rentalsV2Art';
import { NIGHT, W } from './rentalsV2Theme';
import { Press, usePageW } from './RentalsV2Kit';
import { IArrowRight, IBell, IChevronDown, IPin, ISearch } from './RentalsV2Icons';
import { useNav } from './rentalsV2Nav';
import { useRentalsV2 } from './rentalsV2Data';

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
  const head = compact ? 22 : 24;
  return (
    <View style={{ paddingTop: top, paddingBottom: 14 }}>
      <Image source={HERO_DUSK} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="right" />
      <LinearGradient colors={['rgba(18,19,63,0.35)', 'rgba(18,19,63,0)', 'rgba(20,20,56,0)']} locations={[0, 0.25, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(24,20,70,0.42)', 'rgba(24,20,70,0.04)', 'rgba(24,20,70,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(20,20,56,0)', NIGHT.page]} style={[StyleSheet.absoluteFill, { top: '78%' }]} />

      {/* Brand row */}
      <View style={s.brandRow}>
        <View style={s.emblemRing}><Image source={ZCS_EMBLEM} style={{ width: '100%', height: '100%', borderRadius: 17 }} contentFit="cover" accessibilityLabel="ZCS" /></View>
        <View style={{ flex: 1, marginLeft: 9 }}>
          <Text style={s.brand}>ZCS</Text>
          <Text style={s.tagline} numberOfLines={1}>Rentals</Text>
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

      {/* Headline */}
      <View style={{ paddingHorizontal: 16, marginTop: 18, maxWidth: compact ? 300 : 330 }}>
        <Text style={[s.h1, { fontSize: head, lineHeight: head + 5 }]} accessibilityRole="header">Rent bikes, cars, rooms and flats near campus</Text>
        <Text style={s.lede}>Student vehicles, PG rooms and flats around SRM AP. Pay at pickup or move-in.</Text>
      </View>

      {/* Search */}
      <View style={[s.search, { marginTop: 12 }]}>
        <Press onPress={() => nav.push({ name: 'explore', focus: true })} label="Search bikes, cars, rooms or flats" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, height: '100%' }} scaleTo={0.99}>
          <ISearch size={17} color="#6B6B8F" strokeWidth={1.8} />
          <Text style={s.searchText} numberOfLines={1}>Search bikes, cars, rooms or flats…</Text>
        </Press>
        <Press onPress={() => nav.push({ name: 'explore', focus: true })} label="Search" style={s.go} scaleTo={0.9}>
          <LinearGradient colors={[NIGHT.go[0], NIGHT.go[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
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
        <SectionPillRail sections={sections} active={active} onSection={nav.onSection} side={16} tone="dark" style={{ marginTop: 12 }} />
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
  h1: { color: '#FFFFFF', fontWeight: W.hero, letterSpacing: -0.4, textShadowColor: 'rgba(10,6,40,0.35)', textShadowRadius: 10 },
  lede: { color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 18, marginTop: 8, textShadowColor: 'rgba(10,6,40,0.4)', textShadowRadius: 8 },
  search: { marginHorizontal: 14, height: 42, borderRadius: 21, backgroundColor: 'rgba(250,249,255,0.94)', flexDirection: 'row', alignItems: 'center', paddingLeft: 15, paddingRight: 5 },
  searchText: { color: '#6B6B8F', fontSize: 13, flex: 1 },
  go: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, marginTop: 12, alignSelf: 'flex-start', minHeight: 24 },
  locText: { color: '#FFFFFF', fontSize: 12, fontWeight: W.label, maxWidth: 260 },
});
