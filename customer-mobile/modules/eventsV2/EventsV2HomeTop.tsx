/**
 * Campus Events v2 home, top: the campus photo hero blended into the indigo page, the ZCS brand row (gold Z
 * emblem, bell with a dot, avatar), the campus pill, a clean bold headline with a plain subtitle, the search with
 * the violet go-button, and the Others section rail (shared SectionPillRail: the active "Campus events" pill is
 * highlighted and scrolled into view). Owner, 26 Oct: no script lines, swashes, sparkles or looping motion.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTopInset } from '../../utils/useTopInset';
import { useUnreadDot } from '../foodV2/FoodV2HomeTop';
import SectionPillRail from '../others/SectionPillRail';
import { HERO_CAMPUS_DUSK, ZCS_EMBLEM } from './eventsV2Art';
import { NIGHT, W } from './eventsV2Theme';
import { Press, usePageW } from './EventsV2Kit';
import { IArrowRight, IBell, ISearch } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';

export function HomeTop({ sections, active = 'events' }: { sections?: { key: string; label: string }[]; active?: string }) {
  const router = useRouter();
  const nav = useNav();
  const top = useTopInset(36, 44);
  const w = usePageW();
  const { user } = useAuth();
  const unread = useUnreadDot();
  const avatar = (user as any)?.profileImage || (user as any)?.avatar || null;
  const initial = String(user?.name || 'Z').trim().charAt(0).toUpperCase();
  const h1 = w < 380 ? 27 : w >= 420 ? 32 : 30;
  const search = () => nav.push({ name: 'explore', focus: true });
  return (
    <View style={{ paddingTop: top, paddingBottom: 16 }}>
      <Image source={HERO_CAMPUS_DUSK} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
      <LinearGradient colors={['rgba(16,15,51,0.5)', 'rgba(16,15,51,0)']} locations={[0, 0.28]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(19,18,58,0.66)', 'rgba(19,18,58,0.2)', 'rgba(19,18,58,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(19,18,58,0)', NIGHT.page]} style={[StyleSheet.absoluteFill, { top: '58%' }]} />

      {/* Brand row */}
      <View style={s.brandRow}>
        <View style={s.emblemRing}><Image source={ZCS_EMBLEM} style={{ width: '100%', height: '100%', borderRadius: 17 }} contentFit="cover" accessibilityLabel="ZCS" /></View>
        <View style={{ flex: 1, marginLeft: 9 }}>
          <Text style={s.brand}>ZCS</Text>
          <Text style={s.tagline} numberOfLines={1}>Community and Services</Text>
        </View>
        <Press onPress={() => router.push('/notifications' as any)} label={unread ? 'Notifications, unread' : 'Notifications'} style={s.bell} scaleTo={0.9}>
          <IBell size={17} color="#FFFFFF" strokeWidth={1.7} />
          {unread ? <View style={s.bellDot} /> : null}
        </Press>
        <Press onPress={() => router.push('/(tabs)/profile' as any)} label="Your profile" style={s.avatarRing} scaleTo={0.9}>
          {avatar ? <Image source={{ uri: avatar }} style={s.avatar} contentFit="cover" /> : (
            <LinearGradient colors={['#A083E2', '#5B37AE']} style={[s.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: W.title }}>{initial}</Text>
            </LinearGradient>
          )}
        </Press>
      </View>

      {/* Headline */}
      <View style={{ paddingHorizontal: 16, marginTop: 22 }}>
        <View style={s.uniPill}><Text style={s.uniText}>SRM University AP</Text></View>
        <Text style={[s.h1, { fontSize: h1, lineHeight: h1 + 6 }]} accessibilityRole="header">Campus events</Text>
        <Text style={s.subtext}>Workshops, fests, sports and club events at SRM AP</Text>
      </View>

      {/* Search */}
      <View style={s.search}>
        <Press onPress={search} label="Search events, venues or clubs" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, height: '100%' }} scaleTo={0.99}>
          <ISearch size={17} color="#6B6B8F" strokeWidth={1.8} />
          <Text style={s.searchText} numberOfLines={1}>Search events, venues or clubs</Text>
        </Press>
        <Press onPress={search} label="Search" style={s.go} scaleTo={0.9}>
          <LinearGradient colors={['#8C6CDA', '#5B37AE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View><IArrowRight size={16} color="#FFFFFF" strokeWidth={2} /></View>
        </Press>
      </View>

      {/* Others sections */}
      {sections && sections.length > 1 && nav.onSection ? (
        <SectionPillRail sections={sections} active={active} onSection={nav.onSection} side={16} tone="dark" style={{ marginTop: 14 }} />
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
  uniPill: { alignSelf: 'flex-start', paddingHorizontal: 12, height: 26, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center' },
  uniText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: W.label, letterSpacing: 0.2 },
  h1: { color: '#FFFFFF', fontWeight: W.hero, letterSpacing: -0.4, marginTop: 14, textShadowColor: 'rgba(16,10,50,0.35)', textShadowRadius: 10 },
  subtext: { color: 'rgba(238,236,255,0.88)', fontSize: 13.5, lineHeight: 19, marginTop: 6 },
  search: { marginHorizontal: 14, marginTop: 20, height: 46, borderRadius: 23, backgroundColor: 'rgba(250,249,255,0.95)', flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6 },
  searchText: { color: '#6B6B8F', fontSize: 13, flex: 1 },
  go: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
