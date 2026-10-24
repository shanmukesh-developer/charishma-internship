/**
 * Food & groceries v2: small delights. All respect the system "reduce motion" setting.
 *  FloatY       gentle up-down float (hero basket, ~3 s loop, 3 px)
 *  ShineSweep   soft light sweep across a pill every few seconds ("Shop now")
 *  PulseBlock   skeleton block that breathes (never fully transparent, so it always shows)
 *  SlideChips   chip row with a green indicator that slides to the selected chip
 *  AddedToast   "Added to basket" toast with a green check that pops in
 * Others → Food & groceries (modules/foodV2).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { PressScale, useReducedMotion } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { Icon } from './FoodV2Icons';
import { BUTTON_ROLE } from '../../utils/pressRole';

export function FloatY({ children, distance = 3, period = 3000, style }: { children: React.ReactNode; distance?: number; period?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, period, v]);
  return (
    <Animated.View style={[style, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export function ShineSweep({ width, every = 3600 }: { width: number; every?: number }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(every - 900),
      Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, every, v]);
  if (reduce) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-60, width + 20] }) }, { skewX: '-20deg' }] }]}>
      <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ width: 44, height: '100%' }} />
    </Animated.View>
  );
}

export function PulseBlock({ width, height, borderRadius, color }: { width: number | string; height: number; borderRadius: number; color: string }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return <Animated.View style={{ width: width as any, height, borderRadius, backgroundColor: color, opacity: v }} />;
}

/** Chips on white with one sliding green indicator (falls back to a plain fill before layout). */
export function SlideChips({ items, active, onSelect, chipBg, textColor, moreKey, onMore }: {
  items: { key: string; label: string }[]; active: string; onSelect: (k: string) => void;
  chipBg: string; textColor: string; moreKey?: string; onMore?: () => void;
}) {
  const reduce = useReducedMotion();
  const layouts = useRef<Record<string, { x: number; w: number }>>({});
  const [ready, setReady] = useState(false);
  const x = useRef(new Animated.Value(0)).current;
  const w = useRef(new Animated.Value(0)).current;
  const move = (animated: boolean) => {
    const l = layouts.current[active];
    if (!l) return;
    if (!animated || reduce) { x.setValue(l.x); w.setValue(l.w); return; }
    Animated.parallel([
      Animated.spring(x, { toValue: l.x, useNativeDriver: false, speed: 18, bounciness: 4 }),
      Animated.spring(w, { toValue: l.w, useNativeDriver: false, speed: 18, bounciness: 4 }),
    ]).start();
  };
  useEffect(() => { move(ready); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active, ready]);
  const onLayout = (k: string) => (e: LayoutChangeEvent) => {
    layouts.current[k] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
    if (!ready && items.every(it => layouts.current[it.key])) setReady(true);
  };
  return (
    <ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={st.rail}>
      <View style={st.row}>
        {ready && <Animated.View pointerEvents="none" style={[st.indicator, { left: x, width: w, backgroundColor: FOOD.primary }]} />}
        {items.map(it => {
          const on = it.key === active;
          return (
            <PressScale key={it.key} onLayout={onLayout(it.key)} onPress={() => onSelect(it.key)} scaleTo={0.95}
              accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={it.label}
              style={[st.chip, { backgroundColor: on ? (ready ? 'transparent' : FOOD.primary) : chipBg }]}>
              <Text style={[st.chipText, { color: on ? '#FFFFFF' : textColor, fontWeight: on ? '500' : '400' }]}>{it.label}</Text>
            </PressScale>
          );
        })}
        {!!moreKey && !!onMore && (
          <PressScale onPress={onMore} scaleTo={0.95} accessibilityRole={BUTTON_ROLE} accessibilityLabel="More categories" style={[st.chip, { backgroundColor: chipBg }]}>
            <Text style={[st.chipText, { color: textColor }]}>More</Text>
            <Icon name="chevron-forward" size={13} color={textColor} />
          </PressScale>
        )}
      </View>
    </ScrollView>
  );
}

/** "Added to basket" toast; `stamp` changes on every add, `label` is the product name. */
export function AddedToast({ stamp, label, bottom }: { stamp: number; label: string; bottom: number }) {
  const reduce = useReducedMotion();
  const o = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0.4)).current;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!stamp) return;
    setShown(true);
    o.setValue(0); pop.setValue(reduce ? 1 : 0.4);
    Animated.timing(o, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    if (!reduce) Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }).start();
    const t = setTimeout(() => Animated.timing(o, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setShown(false)), 1700);
    return () => clearTimeout(t);
  }, [stamp, reduce, o, pop]);
  if (!shown) return null;
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" style={[st.toast, { bottom, opacity: o }]}>
      <Animated.View style={[st.toastCheck, { transform: [{ scale: pop }] }]}>
        <Icon name="checkmark" size={16} color="#FFFFFF" />
      </Animated.View>
      <Text style={st.toastText} numberOfLines={1}>Added to basket{label ? ` · ${label}` : ''}</Text>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  rail: { paddingHorizontal: 16, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  indicator: { position: 'absolute', top: 0, height: 36, borderRadius: 18 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 16, borderRadius: 18 },
  chipText: { fontSize: 13 },
  toast: { position: 'absolute', alignSelf: 'center', left: 24, right: 24, flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 24, backgroundColor: 'rgba(1,34,24,0.94)', borderWidth: 1, borderColor: 'rgba(95,208,138,0.45)' },
  toastCheck: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#22A447', alignItems: 'center', justifyContent: 'center' },
  toastText: { flex: 1, color: '#FFFFFF', fontSize: 13.5, fontWeight: '500' },
});
