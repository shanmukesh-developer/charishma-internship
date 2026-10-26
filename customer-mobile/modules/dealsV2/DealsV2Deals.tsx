/**
 * Today's deals in the Deals v2 look: real deals from GET /api/vault first, then labelled samples (dealsV2Demo).
 *   DealCard  rail card (photo with a glossy tag, name, streak / stock line, "Get deal")
 *   DealRow   full-width row for /deals/today
 * A tap on a real deal opens its detail sheet (how to avail + the real claim); a sample opens the sample sheet.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { DV, W, shadow } from './dealsV2Theme';
import { Press, SampleTag } from './DealsV2Kit';
import { IconPlate } from './DealsV2Decor';
import { IClock, IFlame, ILock, ITicketPercent } from './DealsV2Icons';
import { dealTag } from './dealsV2Data';
import { isSampleDeal, type SampleDeal } from './dealsV2Demo';
import { useNav } from './dealsV2Nav';

export type AnyDeal = SampleDeal | any;

export function dealInfo(d: AnyDeal, myStreak: number, signedIn: boolean) {
  const sample = isSampleDeal(d);
  const tag = sample ? d.tag : dealTag(d);
  const streak = Number(sample ? d.streak : d.streakRequirement) || 0;
  const left = Number(sample ? d.left : d.remainingCount) || 0;
  const need = signedIn && !sample && streak > myStreak ? streak - myStreak : 0;
  const line = streak > 0 ? `${streak}-day streak needed` : `${left} left today`;
  const img = sample ? d.art : (d.imageUrl ? { uri: String(d.imageUrl) } : null);
  return { sample, tag, streak, left, need, line, img, name: String(d.name || 'Deal'), store: sample ? d.store : (d.restaurantName || d.storeName || '') };
}

function Art({ img, tag, height, radius }: { img: any; tag: string | null; height: number; radius: number }) {
  return (
    <View style={{ height, borderTopLeftRadius: radius, borderTopRightRadius: radius, overflow: 'hidden', backgroundColor: DV.violetSoft }}>
      {img ? <Image source={img} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <LinearGradient colors={['#F1ECFF', '#DCCEFF']} style={StyleSheet.absoluteFill} />
          <IconPlate size={Math.round(height * 0.42)}><ITicketPercent size={Math.round(height * 0.2)} color="#FFFFFF" strokeWidth={1.5} /></IconPlate>
        </View>
      )}
      <LinearGradient colors={['rgba(20,8,60,0)', 'rgba(20,8,60,0.35)']} style={[StyleSheet.absoluteFill, { top: '55%' }]} />
      {tag ? (
        <View style={[s.tag, shadow(1, '#3A1A9E')]}>
          <LinearGradient colors={[DV.go[0], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Text style={s.tagText}>{tag}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function DealCard({ deal, width, myStreak, signedIn }: { deal: AnyDeal; width: number; myStreak: number; signedIn: boolean }) {
  const nav = useNav();
  const i = dealInfo(deal, myStreak, signedIn);
  const open = () => nav.openSheet(i.sample ? { kind: 'sample', deal } : { kind: 'deal', item: deal });
  return (
    <Press onPress={open} label={`${i.name}${i.sample ? ', sample' : ''}. ${i.tag || ''}. How to avail`} style={[s.card, shadow(2), { width }]}>
      <Art img={i.img} tag={i.tag} height={Math.round(width * 0.62)} radius={20} />
      <View style={{ padding: 11 }}>
        {i.sample ? <SampleTag style={{ marginBottom: 5 }} /> : null}
        <Text style={s.name} numberOfLines={2}>{i.name}</Text>
        <View style={s.meta}>
          {i.streak > 0 ? <IFlame size={12} color={DV.sub} strokeWidth={1.8} /> : <IClock size={12} color={DV.sub} strokeWidth={1.8} />}
          <Text style={s.metaText} numberOfLines={1}>{i.line}</Text>
        </View>
        <View style={[s.btn, i.need ? s.btnLocked : null]}>
          {!i.need ? <LinearGradient colors={[DV.go[0], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
          {i.need ? <ILock size={13} color={DV.violetDeep} strokeWidth={1.8} /> : null}
          <Text style={[s.btnText, i.need ? { color: DV.violetDeep } : null]} numberOfLines={1}>{i.need ? `${i.need} more day${i.need === 1 ? '' : 's'}` : 'Get deal'}</Text>
        </View>
      </View>
    </Press>
  );
}

export function DealRow({ deal, myStreak, signedIn }: { deal: AnyDeal; myStreak: number; signedIn: boolean }) {
  const nav = useNav();
  const i = dealInfo(deal, myStreak, signedIn);
  const open = () => nav.openSheet(i.sample ? { kind: 'sample', deal } : { kind: 'deal', item: deal });
  return (
    <Press onPress={open} label={`${i.name}${i.sample ? ', sample' : ''}. ${i.tag || ''}`} style={[s.row, shadow(2)]}>
      <View style={s.rowArt}>
        {i.img ? <Image source={i.img} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: DV.violetSoft }]}><IconPlate size={46}><ITicketPercent size={22} color="#FFFFFF" strokeWidth={1.6} /></IconPlate></View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {i.tag ? <Text style={s.rowTag}>{i.tag}</Text> : null}
          {i.sample ? <SampleTag /> : null}
        </View>
        <Text style={[s.name, { marginTop: 4 }]} numberOfLines={2}>{i.name}</Text>
        {i.store ? <Text style={s.metaText} numberOfLines={1}>{i.store}</Text> : null}
        <View style={s.meta}>
          {i.need ? <ILock size={12} color={DV.violetDeep} strokeWidth={1.8} /> : i.streak > 0 ? <IFlame size={12} color={DV.sub} strokeWidth={1.8} /> : <IClock size={12} color={DV.sub} strokeWidth={1.8} />}
          <Text style={[s.metaText, i.need ? { color: DV.violetDeep } : null]} numberOfLines={1}>{i.need ? `Unlocks after ${i.need} more day${i.need === 1 ? '' : 's'} of orders` : i.line}</Text>
        </View>
      </View>
    </Press>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  tag: { position: 'absolute', left: 9, top: 9, paddingHorizontal: 9, height: 24, borderRadius: 12, overflow: 'hidden', justifyContent: 'center' },
  tagText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: W.title },
  name: { fontSize: 14, fontWeight: W.label, color: DV.ink, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  metaText: { fontSize: 12, color: DV.sub, flexShrink: 1 },
  btn: { flexDirection: 'row', gap: 5, marginTop: 10, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  btnLocked: { backgroundColor: DV.violetSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: DV.violetLine },
  btnText: { color: '#FFFFFF', fontSize: 13, fontWeight: W.title },
  row: { flexDirection: 'row', gap: 12, padding: 10, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  rowArt: { width: 96, height: 96, borderRadius: 16, overflow: 'hidden' },
  rowTag: { fontSize: 13, fontWeight: W.title, color: DV.violet },
});
