/**
 * Food & groceries v2: premium floating basket bar (one component for home, listings, search).
 * Deep emerald pill with a gold hairline, last items as small overlapping thumbnails, "2 items · ₹178",
 * "You save ₹24" (real MRP difference) or "Cash or Wallet", and a compact mint "View basket" pill.
 * Springs up on the first add, the count / total bump on each add (light haptic), hides while the
 * keyboard is open, no spring with reduce motion. Others → Food & groceries (modules/foodV2).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { PressScale, BounceOnChange, useReducedMotion } from '../../modules/others/motion';
import { fmt } from './FoodV2Data';
import { useFoodV2 } from './useFoodV2';
import { useFoodScale, BAR_H, BAR_GAP } from './FoodV2Scale';
import { Icon } from './FoodV2Icons';
import { BUTTON_ROLE } from '../../utils/pressRole';

export default function FoodV2BasketBar() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { shopLines, shopCount, shopTotal, catalogue } = useFoodV2();
  const sc = useFoodScale();
  const y = useRef(new Animated.Value(reduce ? 0 : 120)).current;
  const [kb, setKb] = useState(false);
  const prev = useRef(shopCount);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKb(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (reduce) { y.setValue(0); return; }
    Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 8 }).start();
  }, [reduce, y]);
  useEffect(() => {
    if (shopCount > prev.current) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    prev.current = shopCount;
  }, [shopCount]);

  if (shopCount <= 0 || kb) return null;
  // Saving: real MRP minus price for store items that have an MRP (shopping requests have none).
  const saving = shopLines.reduce((sum, l) => {
    const p = catalogue.find(i => i.id === l.id);
    return sum + (p?.originalPrice ? (p.originalPrice - p.price) * l.quantity : 0);
  }, 0);
  // newest first; the line's own photo, else the catalogue photo, else a letter bubble
  const imgOf = (l: any) => l.image || catalogue.find(i => i.id === l.id)?.image || '';
  const thumbs = shopLines.slice(-(sc.compact ? 2 : 3)).reverse();
  const more = Math.max(0, shopLines.length - thumbs.length);
  const total = fmt(Math.round(shopTotal * 100) / 100);
  const label = `${shopCount} item${shopCount === 1 ? '' : 's'} · ${total}`;

  return (
    <Animated.View style={[st.wrap, { left: sc.gutter, right: sc.gutter, bottom: BAR_GAP + Math.max(sc.insets.bottom, 0), transform: [{ translateY: y }] }]} pointerEvents="box-none">
      <PressScale onPress={() => router.push('/(tabs)/basket?basket=store' as any)} scaleTo={0.98} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`View basket: ${label}${saving > 0 ? `, you save ${fmt(saving)}` : ''}`} style={st.shadow}>
        <LinearGradient colors={['#0F5132', '#12643C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.bar}>
          {thumbs.length > 0 && (
            <View style={[st.thumbs, { width: 28 + (thumbs.length - 1) * 18 + (more ? 22 : 0) }]}>
              {thumbs.map((l, i) => (
                <View key={l.cartKey} style={[st.thumb, { left: i * 18, zIndex: 10 - i }]}>
                  {imgOf(l) ? <Image source={{ uri: imgOf(l) }} style={st.thumbImg} contentFit="cover" /> : <Text style={st.moreText}>{String(l.name || '?').replace(/^\[Custom Request\]\s*/, '').charAt(0).toUpperCase()}</Text>}
                </View>
              ))}
              {more > 0 && <View style={[st.thumb, st.more, { left: thumbs.length * 18 }]}><Text style={st.moreText}>+{more}</Text></View>}
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <BounceOnChange value={shopCount}>
              <Text style={[st.count, { fontSize: sc.f(15) }]} numberOfLines={1}>{label}</Text>
            </BounceOnChange>
            <Text style={[st.sub, { fontSize: sc.f(12) }]} numberOfLines={1}>{saving > 0 ? `You save ${fmt(Math.round(saving))}` : 'Cash or Wallet'}</Text>
          </View>
          <View style={[st.cta, sc.compact && { paddingHorizontal: 12 }]}>
            <Text style={[st.ctaText, { fontSize: sc.f(13) }]} numberOfLines={1}>{sc.compact ? 'View' : 'View basket'}</Text>
            <Icon name="chevron-forward" size={16} color="#0B4A2A" strokeWidth={2} />
          </View>
        </LinearGradient>
      </PressScale>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 20 },
  shadow: Platform.select<any>({
    web: { borderRadius: 20, boxShadow: '0px 10px 30px rgba(6,40,24,0.28), 0px 2px 6px rgba(6,40,24,0.18)' },
    default: { borderRadius: 20, shadowColor: '#062818', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 24, elevation: 10 },
  }),
  bar: { height: BAR_H, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(201,162,74,0.30)', flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 11 },
  thumbs: { height: 28 },
  thumb: { position: 'absolute', top: 0, width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: '#E3F5EB', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: '100%', height: '100%' },
  more: { backgroundColor: '#E3F5EB', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#0B4A2A', fontSize: 10, fontWeight: '600' },
  count: { color: '#FFFFFF', fontWeight: '600' },
  sub: { color: '#A7EBC0', fontWeight: '400', marginTop: 2 },
  cta: { height: 38, minWidth: 64, borderRadius: 19, paddingHorizontal: 14, backgroundColor: '#E3F5EB', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  ctaText: { color: '#0B4A2A', fontWeight: '600' },
});
