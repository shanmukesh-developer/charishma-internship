/**
 * Deals & spin v2 home, top (owner reference): the deep indigo / violet Others header with a soft light and a
 * gold glow behind the Z emblem over a violet gift-box photo (Unsplash, free licence); back arrow, "ZCS" over
 * "Deals & Spin", heart and bell (with a dot); a plain line on what the section holds; and the shared Others pills
 * (modules/others/SectionPillRail: the active pill stays highlighted and scrolled into view).
 * No search bar (owner, 26 Oct): it only opened the grocery search, which is not what Deals is for.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTopInset } from '../../utils/useTopInset';
import { useUnreadDot } from '../foodV2/FoodV2HomeTop';
import SectionPillRail from '../others/SectionPillRail';
import { DV, W } from './dealsV2Theme';
import { Press, usePageW } from './DealsV2Kit';
import { ZCS_EMBLEM } from './DealsV2Wheel';
import { IArrowLeft, IBell, IHeart } from './DealsV2Icons';
import { useNav } from './dealsV2Nav';

// Chocolates in a violet gift box on violet (Unsplash photo-1629610306962-a8aa73153d0e, free licence), 1290 px wide
// for a 2.75x phone; the section's own colours, no brand on it.
const HEADER_PHOTO = require('./assets/dv2-header-purple-chocolate-box-2026-10-26.webp');

export function HomeTop({ sections, onSaved }: { sections?: { key: string; label: string }[]; onSaved?: () => void }) {
  const router = useRouter();
  const nav = useNav();
  const top = useTopInset(36, 44);
  const w = usePageW();
  const unread = useUnreadDot();
  return (
    <View style={{ paddingTop: top, overflow: 'hidden', backgroundColor: DV.header[1] }}>
      <Image source={HEADER_PHOTO} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="center" accessible={false} />
      {/* The section's indigo over the photo: the bags show through, white text stays readable. */}
      <LinearGradient colors={['rgba(26,12,74,0.92)', 'rgba(40,20,110,0.62)', 'rgba(40,20,110,0.18)']} locations={[0, 0.5, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      {/* Top and bottom shade, so the brand row and the pills stay readable on the photo. */}
      <LinearGradient colors={['rgba(20,10,60,0.55)', 'rgba(20,10,60,0)', 'rgba(20,10,60,0)', 'rgba(20,10,60,0.6)']} locations={[0, 0.3, 0.65, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <Svg width={w} height={top + 200} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="dv2hdrlight" cx="88%" cy="0%" rx="80%" ry="90%">
            <Stop offset="0" stopColor="#B79CFF" stopOpacity={0.32} />
            <Stop offset="1" stopColor="#B79CFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={w} height={top + 200} fill="url(#dv2hdrlight)" />
      </Svg>

      <View style={s.brandRow}>
        <Press onPress={() => router.replace('/(tabs)' as any)} label="Back to Home" style={s.iconBtn} scaleTo={0.9}>
          <IArrowLeft size={22} color="#FFFFFF" strokeWidth={1.6} />
        </Press>
        <View style={s.emblemGlow}>
          <View style={s.emblemRing}><Image source={ZCS_EMBLEM} style={{ width: '100%', height: '100%', borderRadius: 17 }} contentFit="cover" accessibilityLabel="ZCS emblem" /></View>
        </View>
        <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
          <Text style={s.brand} accessibilityRole="header">ZCS</Text>
          <Text style={s.brandSub} numberOfLines={1}>Deals & Spin</Text>
        </View>
        <Press onPress={onSaved || (() => nav.onSection?.('food'))} label="Saved items in Food & groceries" style={s.iconBtn} scaleTo={0.9}>
          <IHeart size={22} color="rgba(255,255,255,0.95)" strokeWidth={1.6} />
        </Press>
        <Press onPress={() => router.push('/notifications' as any)} label={unread ? 'Notifications, unread' : 'Notifications'} style={[s.iconBtn, { marginRight: -8 }]} scaleTo={0.9}>
          <IBell size={22} color="rgba(255,255,255,0.95)" strokeWidth={1.6} />
          {unread ? <View style={s.dot} /> : null}
        </Press>
      </View>

      <Text style={s.lead}>Spin the wheel, claim today's deals and use your coupons at checkout.</Text>

      {sections && sections.length > 1 && nav.onSection ? (
        <SectionPillRail sections={sections} active="promos" onSection={nav.onSection} side={16} tone="dark" style={{ paddingTop: 14, paddingBottom: 16 }} />
      ) : <View style={{ height: 16 }} />}
    </View>
  );
}


const s = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 16, paddingTop: 12 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  emblemGlow: Platform.select<any>({
    web: { borderRadius: 18, boxShadow: '0 0 14px rgba(246,196,83,0.35)' },
    default: { borderRadius: 18, shadowColor: '#F6C453', shadowOpacity: 0.35, shadowRadius: 9, shadowOffset: { width: 0, height: 0 } },
  }),
  emblemRing: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#C9A24A', padding: 1, backgroundColor: '#140A3A' },
  brand: { color: '#FFFFFF', fontSize: 21, fontWeight: W.title, letterSpacing: 1.6, lineHeight: 25 },
  brandSub: { color: 'rgba(235,230,255,0.8)', fontSize: 12.5, marginTop: 1, letterSpacing: 0.2 },
  dot: { position: 'absolute', top: 10, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: DV.bellDot, borderWidth: 1.5, borderColor: DV.header[1] },
  lead: { color: '#FFFFFF', fontSize: 14, lineHeight: 20, marginTop: 14, marginBottom: 58, marginHorizontal: 16, maxWidth: 300 },
});
