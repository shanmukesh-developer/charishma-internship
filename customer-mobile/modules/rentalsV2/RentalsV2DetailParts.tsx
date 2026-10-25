/**
 * Rentals v2 detail pieces shared by the vehicle, room and flat pages (inner boards 3 and 4):
 *   Gallery      big swipeable photo with back / share / heart glass buttons and page dots
 *   FeatureRow   the spec / amenity icon row on tinted plates
 *   InfoRow      a tappable row (pickup location) with an icon plate and a chevron
 *   OwnerCard    avatar, name, "Verified" only when real, contact note (phone stays private until accepted)
 *   Safeguards   the checks that exist in the rentals flow (licence, deposit, private plate rule, PIN, photos)
 *   DetailSheet  the white body that overlaps the gallery with a rounded top
 */
import React, { useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { DAY, PLATE, W, shadow, type Category } from './rentalsV2Theme';
import { Press, Heart, usePageW } from './RentalsV2Kit';
import { FeatureGlyph, IArrowLeft, IShare, IChevronRight, IBadge, IShield, ILock } from './RentalsV2Icons';
import { useTopInset } from '../../utils/useTopInset';
import { useNav } from './rentalsV2Nav';
import type { RItem } from './rentalsV2Data';
import type { Feature } from './rentalsV2Demo';

export function Gallery({ item, height }: { item: RItem; height: number }) {
  const nav = useNav();
  const w = usePageW();
  const top = useTopInset(36, 44);
  const [page, setPage] = useState(0);
  const photos = item.gallery.length ? item.gallery : item.photo ? [item.photo] : [];
  const plate = PLATE[item.category];
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, w)));
  const share = () => Share.share({ message: `${item.title} on ZCS Rentals${item.price ? ` · ₹${item.price.toLocaleString('en-IN')}` : ''}` }).catch(() => {});
  return (
    <View style={{ height, width: w, backgroundColor: plate.bg[1] }}>
      {photos.length ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} onScroll={onScroll} scrollEventThrottle={64}>
          {photos.map((p, i) => <Image key={i} source={p as any} style={{ width: w, height }} contentFit="cover" transition={160} accessibilityLabel={`${item.title}, photo ${i + 1} of ${photos.length}`} />)}
        </ScrollView>
      ) : (
        <LinearGradient colors={[plate.bg[0], plate.bg[1]]} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient pointerEvents="none" colors={['rgba(14,10,40,0.38)', 'rgba(14,10,40,0)']} style={[StyleSheet.absoluteFill, { height: top + 60 }]} />
      <View style={[d.topBar, { top }]} pointerEvents="box-none">
        <Press onPress={nav.back} label="Back" style={d.glass}><IArrowLeft size={20} color={DAY.ink} strokeWidth={1.8} /></Press>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Press onPress={share} label="Share" style={d.glass}><IShare size={18} color={DAY.ink} strokeWidth={1.8} /></Press>
          <Heart id={item.id} size={40} />
        </View>
      </View>
      {photos.length > 1 ? (
        <View style={d.dots} pointerEvents="none">
          {photos.map((_, i) => <View key={i} style={[d.dot, i === page ? d.dotOn : null]} />)}
        </View>
      ) : null}
    </View>
  );
}

export function DetailSheet({ children }: { children: React.ReactNode }) {
  return <View style={d.sheet}>{children}</View>;
}

export function FeatureRow({ features, category }: { features: Feature[]; category: Category }) {
  const plate = PLATE[category];
  if (!features.length) return null;
  return (
    <View style={d.features}>
      {features.slice(0, 4).map((f) => (
        <View key={f.label} style={d.feature} accessibilityLabel={f.label}>
          <LinearGradient colors={[plate.bg[0], plate.bg[1]]} style={d.featureIcon}><FeatureGlyph name={f.icon} size={21} color={plate.ink} /></LinearGradient>
          <Text style={d.featureText} numberOfLines={2}>{f.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 }}>
      <Text style={d.secTitle} accessibilityRole="header">{children}</Text>
      {right}
    </View>
  );
}

export function InfoRow({ Icon, title, sub, onPress }: { Icon: React.ComponentType<any>; title: string; sub?: string; onPress?: () => void }) {
  const body = (
    <>
      <View style={d.infoIcon}><Icon size={19} color={DAY.accent} strokeWidth={1.7} /></View>
      <View style={{ flex: 1 }}>
        <Text style={d.infoTitle} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={d.infoSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {onPress ? <IChevronRight size={18} color={DAY.muted} strokeWidth={1.7} /> : null}
    </>
  );
  return onPress ? <Press onPress={onPress} label={title} style={d.info}>{body}</Press> : <View style={d.info}>{body}</View>;
}

export function OwnerCard({ item, role = 'Owner', note }: { item: RItem; role?: string; note: string }) {
  const o = item.owner;
  if (!o) return null;
  return (
    <View style={[d.owner, shadow(1)]}>
      {o.avatar ? <Image source={{ uri: o.avatar }} style={d.avatar} contentFit="cover" /> : (
        <LinearGradient colors={['#C4B5FD', '#7C5CF0']} style={[d.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: W.title }}>{o.name.charAt(0).toUpperCase()}</Text>
        </LinearGradient>
      )}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={d.ownerName} numberOfLines={1}>{o.name}</Text>
          {o.verified ? <IBadge size={16} color="#2F86E6" strokeWidth={1.8} /> : null}
        </View>
        <Text style={d.ownerRole}>{o.verified ? `Verified ${role.toLowerCase()}` : role}</Text>
        <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center', marginTop: 6 }}>
          <ILock size={12} color={DAY.muted} strokeWidth={1.8} />
          <Text style={d.ownerNote}>{note}</Text>
        </View>
      </View>
    </View>
  );
}

export function Safeguards({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <View style={[d.safe, shadow(1)]}>
      {lines.map((t, i) => (
        <View key={i} style={d.safeRow}>
          <View style={d.safeIcon}><IShield size={14} color={DAY.green} strokeWidth={1.8} /></View>
          <Text style={d.safeText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

export const d = StyleSheet.create({
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  glass: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center', ...shadow(1) },
  dots: { position: 'absolute', bottom: 40, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotOn: { width: 18, backgroundColor: '#FFFFFF' },
  sheet: { marginTop: -26, backgroundColor: DAY.page, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 20 },
  features: { flexDirection: 'row', gap: 8, marginTop: 18 },
  feature: { flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderRadius: 16, backgroundColor: '#FFFFFF', ...shadow(1) },
  featureIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  featureText: { fontSize: 11.5, color: DAY.ink2, textAlign: 'center', lineHeight: 15 },
  secTitle: { fontSize: 16, fontWeight: W.title, color: DAY.ink },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#FFFFFF', ...shadow(1) },
  infoIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: DAY.accentSoft, alignItems: 'center', justifyContent: 'center' },
  infoTitle: { fontSize: 14, color: DAY.ink, fontWeight: W.label },
  infoSub: { fontSize: 12, color: DAY.muted, marginTop: 2 },
  owner: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center' },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  ownerName: { fontSize: 15, fontWeight: W.title, color: DAY.ink, flexShrink: 1 },
  ownerRole: { fontSize: 12, color: DAY.muted, marginTop: 1 },
  ownerNote: { fontSize: 11.5, color: DAY.muted, flex: 1 },
  safe: { padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', gap: 10 },
  safeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  safeIcon: { width: 24, height: 24, borderRadius: 8, backgroundColor: DAY.greenSoft, alignItems: 'center', justifyContent: 'center' },
  safeText: { flex: 1, fontSize: 12.5, color: DAY.ink2, lineHeight: 18 },
});
