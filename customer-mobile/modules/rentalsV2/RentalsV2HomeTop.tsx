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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTopInset } from '../../utils/useTopInset';
import { useUnreadDot } from '../foodV2/FoodV2HomeTop';
import { NIGHT, W, hexA } from './rentalsV2Theme';
import { Press, usePageW } from './RentalsV2Kit';
import { IArrowRight, IBell, IChevronDown, IPin, ISearch } from './RentalsV2Icons';
import { useNav } from './rentalsV2Nav';
import { useRentalsV2 } from './rentalsV2Data';
import { themedSheet } from '../../utils/themeNow';
import { useDietLight } from '../../components/local/dietLightTheme';

export function HomeTop({ sections, active = 'rentals' }: { sections?: { key: string; label: string }[]; active?: string }) {
  const router = useRouter();
  const nav = useNav();
  const top = useTopInset(36, 44);
  const w = usePageW();
  const { user } = useAuth();
  const unread = useUnreadDot();
  const { campusLine } = useRentalsV2();
  const avatar = (user as any)?.profileImage || (user as any)?.avatar || null;
  // A guest (or a name not set yet) gets a person, like Home's header avatar, never the "Z" brand letter.
  const initial = String(user?.name || '').trim().charAt(0).toUpperCase();
  const compact = w < 380;
  const d = useDietLight();
  const head = compact ? 22 : 24;
  // Owner, 10 Nov 2026 ("rentals remove bg images"): no dusk-city photo; the header is the diet band like every other
  // Services section, with dark ink (HERO_DUSK stays in rentalsV2Art, unused).
  const ink = d.dk;
  return (
    <View style={{ paddingTop: top, paddingBottom: 0, backgroundColor: d.top }}>

      {/* Brand row */}
      <View style={s.brandRow}>
        {/* Owner, 10 Nov 2026: no ZenWe badge in Services; the section name is the title. */}
        <View style={{ flex: 1 }}>
          <Text style={[s.brand, { color: ink, fontSize: 22, fontWeight: '900' }]} accessibilityRole="header">Rentals</Text>
        </View>
        <Press onPress={() => router.push('/notifications' as any)} label={unread ? 'Notifications, unread' : 'Notifications'} style={s.bell}>
          <IBell size={17} color={ink} strokeWidth={1.7} />
          {unread ? <View style={s.bellDot} /> : null}
        </Press>
        <Press onPress={() => router.push('/(tabs)/profile' as any)} label={user ? 'Your profile' : 'Guest, open profile'} style={s.avatarRing}>
          {user && avatar ? <Image source={{ uri: avatar }} style={s.avatar} contentFit="cover" /> : (
            <LinearGradient colors={[NIGHT.ring[1], NIGHT.ring[2]]} style={[s.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
              {user && initial
                ? <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: W.title }}>{initial}</Text>
                : <Ionicons name="person" size={17} color="#FFFFFF" />}
            </LinearGradient>
          )}
          {user ? <View style={s.avatarDot} /> : null}
        </Press>
      </View>

      {/* Headline */}
      <View style={{ paddingHorizontal: 16, marginTop: 18, maxWidth: compact ? 300 : 330 }}>
        {/* Readability scrim behind the headline and the white subtitle: the dusk photo is busy (city lights). A soft
            full-width band, faded at its top and bottom edges, keeps the text at 4.5:1 or better without moving it. */}
        <Text style={[s.h1, { fontSize: head, lineHeight: head + 5, color: ink }]} accessibilityRole="header">Rent bikes, cars, rooms and flats near campus</Text>
        <Text style={[s.lede, { color: ink }]}>Student vehicles, rooms and flats around SRM AP. Pay at pickup or move-in.</Text>
      </View>

      {/* Search */}
      <View style={[s.search, { marginTop: 12 }]}>
        <Press onPress={() => nav.push({ name: 'explore', focus: true })} label="Search bikes, cars, rooms or flats" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, height: '100%' }} scaleTo={0.99}>
          <ISearch size={17} color="#6B6B8F" strokeWidth={1.8} />
          <Text style={s.searchText} numberOfLines={1}>Search bikes, cars, rooms or flats…</Text>
        </Press>
        <Press onPress={() => nav.push({ name: 'explore', focus: true })} label="Search" style={s.go} scaleTo={0.9}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: d.acc }]} />
          <View><IArrowRight size={16} color="#FFFFFF" strokeWidth={2} /></View>
        </Press>
      </View>

      {/* Location */}
      <Press onPress={() => nav.push({ name: 'explore' })} label={`Location: ${campusLine}`} style={s.loc} scaleTo={0.98}>
        <IPin size={15} color={d.acc} fill={hexA(d.acc, 0.2)} strokeWidth={1.8} />
        <Text style={[s.locText, { color: ink }]} numberOfLines={1}>{campusLine}</Text>
        <IChevronDown size={14} color={ink} strokeWidth={1.8} />
      </Press>

      {/* Others sections */}
      {sections && sections.length > 1 && nav.onSection ? (
        <SectionPillRail sections={sections} active={active} onSection={nav.onSection} side={16} accent={d.acc} folder={{ band: d.top, page: NIGHT.page, ink }} style={{ marginTop: 2 }} />
      ) : null}
    </View>
  );
}

const s = themedSheet(() => ({
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  brand: { color: '#FFFFFF', fontSize: 21, fontWeight: W.title, letterSpacing: 0.2, lineHeight: 24 },
  tagline: { color: 'rgba(235,232,255,0.82)', fontSize: 10.5, marginTop: 1, letterSpacing: 0.2 },
  bell: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,17,26,0.08)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  bellDot: { position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: NIGHT.bellDot, borderWidth: 1, borderColor: '#FFFFFF' },
  avatarRing: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', padding: 1.5 },
  avatar: { width: '100%', height: '100%', borderRadius: 17 },
  avatarDot: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, backgroundColor: NIGHT.violet, borderWidth: 1.5, borderColor: '#FFFFFF' },
  h1: { color: '#FFFFFF', fontWeight: W.hero, letterSpacing: -0.4 },
  lede: { color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 18, marginTop: 8, opacity: 0.78 },
  ledeScrim: { position: 'absolute', top: -22, bottom: -18, left: -16 },
  search: { marginHorizontal: 14, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,17,26,0.1)', flexDirection: 'row', alignItems: 'center', paddingLeft: 15, paddingRight: 5 },
  searchText: { color: '#6B6B8F', fontSize: 13, flex: 1 },
  go: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, marginTop: 12, alignSelf: 'flex-start', minHeight: 24 },
  locText: { color: '#FFFFFF', fontSize: 12, fontWeight: W.label, maxWidth: 260 },
}));
