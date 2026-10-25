/**
 * Rentals v2 listing pieces:
 *   ItemThumb   cut-out on a soft tinted plate with a glow and a ground shadow, or the photo when there is no cut-out
 *   ItemRow     the board's list row: picture left, name, rating (only when real), violet price, spec chips, heart
 *   PopularCard the night home's "Popular This Week" photo card (category badge + heart)
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { DAY, NIGHT, PLATE, W, shadow } from './rentalsV2Theme';
import { GroundShadow, Press, Heart, SampleTag, Rating, SpecChip } from './RentalsV2Kit';
import { CATEGORY_ICON, IPin } from './RentalsV2Icons';
import { inr, kmText, unitText, type RItem } from './rentalsV2Data';
import { itemRoute, useNav } from './rentalsV2Nav';

export function ItemThumb({ item, w, h, radius = 16, style }: { item: RItem; w: number; h: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const plate = PLATE[item.category];
  if (item.cut) {
    return (
      <LinearGradient colors={[plate.bg[0], plate.bg[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ width: w, height: h, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
        <View style={{ position: 'absolute', width: w * 0.86, height: w * 0.86, borderRadius: w, backgroundColor: plate.blob, opacity: 0.55, top: -w * 0.18, right: -w * 0.22 }} />
        <GroundShadow width={w * 0.78} height={12} opacity={0.22} color="#2A1F6A" style={{ position: 'absolute', bottom: h * 0.06 }} />
        <Image source={item.cut as any} style={{ width: w * 0.88, height: h * 0.8, marginTop: h * 0.02 }} contentFit="contain" contentPosition="bottom" accessibilityIgnoresInvertColors />
      </LinearGradient>
    );
  }
  if (item.photo) {
    return <Image source={item.photo as any} style={[{ width: w, height: h, borderRadius: radius, backgroundColor: plate.bg[1] }, style as any]} contentFit="cover" transition={150} />;
  }
  const Icon = CATEGORY_ICON[item.category];
  return (
    <LinearGradient colors={[plate.bg[0], plate.bg[1]]} style={[{ width: w, height: h, borderRadius: radius, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Icon size={Math.round(h * 0.38)} color={plate.ink} strokeWidth={1.3} />
    </LinearGradient>
  );
}

export function PriceLine({ item, size = 16 }: { item: RItem; size?: number }) {
  if (!item.price) return <Text style={{ fontSize: 13, color: DAY.muted }}>Price on request</Text>;
  return (
    <Text style={{ fontSize: size, color: DAY.accent, fontWeight: W.title }}>
      {inr(item.price)}<Text style={{ fontSize: size - 4, color: DAY.muted, fontWeight: W.body }}>{unitText(item.unit)}</Text>
    </Text>
  );
}

export function ItemRow({ item }: { item: RItem }) {
  const nav = useNav();
  const km = kmText(item.distanceKm);
  return (
    <Press onPress={() => nav.push(itemRoute(item))} label={`${item.title}, ${item.price ? inr(item.price) + unitText(item.unit) : ''}`} style={[r.row, shadow(1)]}>
      <ItemThumb item={item} w={108} h={96} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={r.title} numberOfLines={1}>{item.title}</Text>
            {item.place ? <Text style={r.place} numberOfLines={1}>{item.place}</Text> : null}
          </View>
          <Heart id={item.id} size={30} />
        </View>
        <View style={{ marginTop: 4, minHeight: 16 }}>
          {item.rating ? <Rating value={item.rating} count={item.reviews} size={12} /> : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <IPin size={12} color={DAY.muted} strokeWidth={1.7} />
              <Text style={r.place} numberOfLines={1}>{item.area}{km ? ` · ${km}` : ''}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6 }}>
          <PriceLine item={item} />
          {item.isDemoContent ? <SampleTag /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
          {item.specs.slice(0, 3).map((s) => <SpecChip key={s} label={s} />)}
        </View>
      </View>
    </Press>
  );
}

export function PopularCard({ item, w }: { item: RItem; w: number }) {
  const nav = useNav();
  const Icon = CATEGORY_ICON[item.category];
  const photo = item.gallery[0] || item.photo;
  const h = Math.round(w * 0.74);
  return (
    <Press onPress={() => nav.push(itemRoute(item))} label={item.title} style={[r.pop, { width: w }]}>
      <View style={{ width: w, height: h, borderRadius: 12, overflow: 'hidden', backgroundColor: NIGHT.chip }}>
        {photo ? <Image source={photo as any} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
        <LinearGradient colors={['rgba(12,10,40,0.35)', 'rgba(12,10,40,0)', 'rgba(12,10,40,0)']} style={StyleSheet.absoluteFill} />
        <View style={r.popBadge}><Icon size={13} color="#FFFFFF" strokeWidth={1.7} /></View>
        <View style={{ position: 'absolute', top: 5, right: 5 }}><Heart id={item.id} tone="glass" size={24} /></View>
        {item.isDemoContent ? <View style={{ position: 'absolute', left: 5, bottom: 5, transform: [{ scale: 0.86 }] }}><SampleTag dark /></View> : null}
      </View>
      <Text style={r.popTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={r.popPrice} numberOfLines={1}>{item.price ? `${inr(item.price)}${unitText(item.unit)}` : item.area}</Text>
    </Press>
  );
}

const r = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, padding: 10, borderRadius: 20, backgroundColor: DAY.card, marginHorizontal: 16 },
  title: { fontSize: 15, fontWeight: W.title, color: DAY.ink, letterSpacing: -0.1 },
  place: { fontSize: 12, color: DAY.muted, marginTop: 1, flexShrink: 1 },
  pop: { gap: 0 },
  popBadge: { position: 'absolute', top: 5, left: 5, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(20,18,50,0.38)', alignItems: 'center', justifyContent: 'center' },
  popTitle: { color: NIGHT.ink, fontSize: 12.5, fontWeight: W.label, marginTop: 7 },
  popPrice: { color: NIGHT.violet, fontSize: 12, marginTop: 2 },
});
