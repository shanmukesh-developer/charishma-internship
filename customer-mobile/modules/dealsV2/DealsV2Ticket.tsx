/**
 * Perforated ticket coupon (owner reference): a violet gradient stub with a glossy % ticket plate and a scalloped
 * left edge, two notches and a dashed tear line, then the real coupon: its title ("Flat ₹50 off" / "Free delivery"),
 * its real minimum order, a "Valid till" chip from its real expiry, and Apply. Used on the home and the coupons list.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DV, W, shadow, shortDate } from './dealsV2Theme';
import { Press } from './DealsV2Kit';
import { IClock, ITicketPercent, ITruck } from './DealsV2Icons';
import { couponMin, couponTitle, type Coupon } from './dealsV2Data';

const STUB = 86;
const NOTCH = 18;

export function couponCondition(c: Coupon) {
  const min = couponMin(c);
  if (min > 0) return `On orders above ₹${min}`;
  return c.type === 'FREEDEL' ? 'On your next delivery' : 'On your next order';
}
export function couponValidity(c: Coupon) {
  const days = c.expiresInDays;
  if (c.expiryDate) {
    if (days === 0) return 'Valid till today';
    return `Valid till ${shortDate(c.expiryDate)}`;
  }
  return 'No expiry';
}

/** `note` replaces the validity chip (the Used / Expired tabs: "Used on 24 Oct", "Expired on 20 Oct"). */
export function Ticket({ coupon, onApply, onPress, page = DV.page, muted, note, style }: { coupon: Coupon; onApply?: () => void; onPress?: () => void; page?: string; muted?: boolean; note?: string; style?: StyleProp<ViewStyle> }) {
  const free = coupon.type === 'FREEDEL';
  const Icon = free ? ITruck : ITicketPercent;
  const soon = !note && coupon.expiresInDays !== null && coupon.expiresInDays !== undefined && coupon.expiresInDays <= 1;
  return (
    <Press onPress={onPress} label={`${couponTitle(coupon)}. ${couponCondition(coupon)}. ${note || couponValidity(coupon)}.${onPress ? ' Open details' : ''}`} style={[s.wrap, shadow(2), muted ? { opacity: 0.6 } : null, style]} scaleTo={0.98}>
      <View style={s.ticket}>
        <View style={s.stub}>
          <LinearGradient colors={free ? ['#9C7BFF', '#5B34D8'] : [DV.go[0], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
          <View style={s.plate}>
            <LinearGradient colors={['rgba(255,255,255,0.38)', 'rgba(255,255,255,0.12)']} style={StyleSheet.absoluteFill} />
            <View><Icon size={24} color="#FFFFFF" strokeWidth={1.6} /></View>
          </View>
          {/* scalloped left edge */}
          <View style={s.scallops} pointerEvents="none">
            {Array.from({ length: 6 }).map((_, i) => <View key={i} style={[s.scallop, { backgroundColor: page }]} />)}
          </View>
        </View>
        <View style={s.tear} pointerEvents="none">
          <View style={[s.notch, { top: -NOTCH / 2, backgroundColor: page }]} />
          <View style={s.dash} />
          <View style={[s.notch, { bottom: -NOTCH / 2, backgroundColor: page }]} />
        </View>
        <LinearGradient colors={['#FFFFFF', '#FAF8FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.body}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title} numberOfLines={1}>{couponTitle(coupon)}</Text>
            <Text style={s.cond} numberOfLines={1}>{couponCondition(coupon)}</Text>
            <View style={[s.chip, soon ? { backgroundColor: DV.amberSoft, borderColor: 'rgba(183,121,31,0.3)' } : null]}>
              <IClock size={12} color={soon ? DV.amber : DV.violetDeep} strokeWidth={1.8} />
              <Text style={[s.chipText, soon ? { color: DV.amber } : null]} numberOfLines={1}>{note || couponValidity(coupon)}</Text>
            </View>
          </View>
          {onApply ? (
            <Press onPress={onApply} label={`Apply ${couponTitle(coupon)}`} style={s.apply} scaleTo={0.92}>
              <LinearGradient colors={[DV.go[0], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <LinearGradient colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
              <Text style={s.applyText}>Apply</Text>
            </Press>
          ) : null}
        </LinearGradient>
      </View>
    </Press>
  );
}

const s = StyleSheet.create({
  wrap: { borderRadius: 18 },
  ticket: { flexDirection: 'row', borderRadius: 18, overflow: 'hidden', minHeight: 104, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  stub: { width: STUB, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  plate: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' },
  scallops: { position: 'absolute', left: -6, top: 4, bottom: 4, justifyContent: 'space-between' },
  scallop: { width: 12, height: 12, borderRadius: 6 },
  tear: { width: 1, alignItems: 'center', zIndex: 3, elevation: 3 },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, left: -NOTCH / 2 + 0.5, zIndex: 2 },
  dash: { position: 'absolute', top: 12, bottom: 12, width: 0, borderLeftWidth: 1.4, borderStyle: 'dashed', borderColor: 'rgba(109,63,230,0.4)' },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 12, paddingVertical: 12, gap: 10 },
  title: { fontSize: 16.5, fontWeight: W.title, color: DV.ink, letterSpacing: -0.2 },
  cond: { fontSize: 12.5, color: DV.sub, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: DV.violetSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: DV.violetLine },
  chipText: { fontSize: 11.5, color: DV.violetDeep, fontWeight: W.label },
  apply: { height: 36, paddingHorizontal: 16, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: W.title },
});
