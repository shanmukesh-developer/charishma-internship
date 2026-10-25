/**
 * Campus Events v2 home, top (owner reference): the twilight campus hero blended into the indigo page, the ZCS
 * brand row (gold Z emblem, "Campus. Beyond Class.", bell with a dot, avatar), the outlined "SRM University" pill,
 * "Campus Events," with "Your Way" in the violet -> pink italic display and a swash arrow, the subtext, the
 * handwritten "Good Vibes / Great People / Amazing Events" with a heart, the search with a violet go-button, and
 * the Others section pills (the app needs them to switch sections).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTopInset } from '../../utils/useTopInset';
import { useUnreadDot } from '../foodV2/FoodV2HomeTop';
import { FloatY, ShineSweep } from '../foodV2/FoodV2Motion';
import { HERO_CAMPUS_DUSK, ZCS_EMBLEM } from './eventsV2Art';
import { NIGHT, SCRIPT, W } from './eventsV2Theme';
import { Press, usePageW } from './EventsV2Kit';
import { GradientText, ScriptHeart, Sparkle, Swash, SwashArrow } from './EventsV2Decor';
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
  const compact = w < 380;
  const h1 = compact ? 25 : w >= 420 ? 30.5 : 28;
  const search = () => nav.push({ name: 'explore', focus: true });
  return (
    <View style={{ paddingTop: top, paddingBottom: 16 }}>
      <Image source={HERO_CAMPUS_DUSK} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
      <LinearGradient colors={['rgba(16,15,51,0.5)', 'rgba(16,15,51,0)']} locations={[0, 0.28]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(19,18,58,0.62)', 'rgba(19,18,58,0.18)', 'rgba(19,18,58,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(19,18,58,0)', NIGHT.page]} style={[StyleSheet.absoluteFill, { top: '62%' }]} />

      {/* Brand row */}
      <View style={s.brandRow}>
        <View style={s.emblemRing}><Image source={ZCS_EMBLEM} style={{ width: '100%', height: '100%', borderRadius: 17 }} contentFit="cover" accessibilityLabel="ZCS" /></View>
        <View style={{ flex: 1, marginLeft: 9 }}>
          <Text style={s.brand}>ZCS</Text>
          <Text style={s.tagline} numberOfLines={1}>Campus. Beyond Class.</Text>
        </View>
        <Press onPress={() => router.push('/notifications' as any)} label={unread ? 'Notifications, unread' : 'Notifications'} style={s.bell} scaleTo={0.9}>
          <IBell size={17} color="#FFFFFF" strokeWidth={1.7} />
          {unread ? <View style={s.bellDot} /> : null}
        </Press>
        <Press onPress={() => router.push('/(tabs)/profile' as any)} label="Your profile" style={s.avatarRing} scaleTo={0.9}>
          {avatar ? <Image source={{ uri: avatar }} style={s.avatar} contentFit="cover" /> : (
            <LinearGradient colors={['#C4B5FD', '#7C5CF0']} style={[s.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: W.title }}>{initial}</Text>
            </LinearGradient>
          )}
          <View style={s.avatarDot} />
        </Press>
      </View>

      {/* Headline + script */}
      <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
        <View style={s.uniPill}><Text style={s.uniText}>SRM University</Text></View>
        <FloatY distance={3} period={4400} style={[s.scriptBox, { width: compact ? 140 : 156 }]}>
          <View style={{ transform: [{ rotate: '-7deg' }] }} accessibilityLabel="Good vibes, great people, amazing events, memories created">
            <Text style={s.script} numberOfLines={1}>Good Vibes</Text>
            <Text style={[s.script, { marginLeft: 8 }]} numberOfLines={1}>Great People</Text>
            <Text style={[s.script, { marginLeft: 2 }]} numberOfLines={1}>Amazing Events</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4, gap: 3 }}>
              <Text style={[s.script, { fontSize: 12 }]} numberOfLines={1}>Memories Created</Text>
              <ScriptHeart size={13} />
            </View>
          </View>
          <Sparkle size={10} style={{ position: 'absolute', right: 2, top: -8 }} />
          <Sparkle size={7} color="#F0ABFC" style={{ position: 'absolute', left: -6, top: 30 }} />
        </FloatY>
        <View style={{ marginTop: 12 }} accessibilityRole="header" accessibilityLabel="Campus Events, your way">
          <Text style={[s.h1, { fontSize: h1, lineHeight: h1 + 5 }]}>Campus Events,</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <GradientText text="Your Way" size={h1 + 2} width={Math.round((h1 + 2) * 4.7)} />
            <SwashArrow size={30} style={{ marginLeft: 2, marginTop: 6 }} />
          </View>
          <Swash width={Math.round(h1 * 3.6)} height={9} style={{ marginLeft: 6, marginTop: -2 }} />
        </View>
        <Text style={[s.subtext, { maxWidth: compact ? 290 : 320 }]}>Workshops, Fests, Sports, Cultural Events and more — all in one place!</Text>
      </View>

      {/* Search */}
      <View style={s.search}>
        <Press onPress={search} label="Search for events, venues, or clubs" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, height: '100%' }} scaleTo={0.99}>
          <ISearch size={17} color="#6B6B8F" strokeWidth={1.8} />
          <Text style={s.searchText} numberOfLines={1}>Search for events, venues, or clubs…</Text>
        </Press>
        <Press onPress={search} label="Search" style={s.go} scaleTo={0.88}>
          <LinearGradient colors={[NIGHT.go[0], NIGHT.go[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <ShineSweep width={36} every={4200} />
          <View><IArrowRight size={16} color="#FFFFFF" strokeWidth={2} /></View>
        </Press>
      </View>

      {/* Others sections */}
      {sections && sections.length > 1 && nav.onSection ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 7, marginTop: 14 }}>
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
  tagline: { color: 'rgba(235,232,255,0.84)', fontSize: 10.5, marginTop: 1, letterSpacing: 0.2 },
  bell: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  bellDot: { position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: NIGHT.bellDot, borderWidth: 1, borderColor: '#FFFFFF' },
  avatarRing: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', padding: 1.5 },
  avatar: { width: '100%', height: '100%', borderRadius: 17 },
  avatarDot: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#7C5CF0', borderWidth: 1.5, borderColor: '#FFFFFF' },
  uniPill: { alignSelf: 'flex-start', paddingHorizontal: 12, height: 26, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center' },
  uniText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: W.label, letterSpacing: 0.2 },
  scriptBox: { position: 'absolute', right: 8, top: -6, alignItems: 'flex-end' },
  script: { fontFamily: SCRIPT, color: '#FFFFFF', fontSize: 13, lineHeight: 18, textShadowColor: 'rgba(60,20,90,0.6)', textShadowRadius: 6 },
  h1: { color: '#FFFFFF', fontWeight: W.display, letterSpacing: -0.4, textShadowColor: 'rgba(16,10,50,0.35)', textShadowRadius: 10 },
  subtext: { color: 'rgba(238,236,255,0.88)', fontSize: 13, lineHeight: 19, marginTop: 8 },
  search: { marginHorizontal: 14, marginTop: 16, height: 46, borderRadius: 23, backgroundColor: 'rgba(250,249,255,0.95)', flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6 },
  searchText: { color: '#6B6B8F', fontSize: 13, flex: 1 },
  go: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  pill: { height: 30, paddingHorizontal: 13, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)', justifyContent: 'center' },
  pillOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  pillText: { color: 'rgba(240,238,255,0.92)', fontSize: 12, fontWeight: W.label },
});
