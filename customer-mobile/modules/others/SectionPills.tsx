/**
 * Others section bar: pills with one animated active indicator that slides (native driver) to the
 * selected section and takes that section's accent. The active pill is scrolled into view.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { playSound } from '../../utils/sounds';
import { PressScale, useReducedMotion } from './motion';
import { ACCENTS, PILL_ACCENT, accentGlow, ICON, RADIUS, SPACE, useOthersTheme } from './othersTheme';

type IonName = React.ComponentProps<typeof Ionicons>['name'];

export default function SectionPills({ tabs, active, onSelect, fallbackAccent, fallbackOnAccent }: {
  tabs: { key: string; label: string; icon: IonName }[];
  active: string;
  onSelect: (key: string) => void;
  /** Accent for sections without their own (Rentals, Events). */
  fallbackAccent: string;
  fallbackOnAccent: string;
}) {
  const t = useOthersTheme('neutral');
  const reduce = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const layouts = useRef<Record<string, { x: number; w: number }>>({});
  const [ready, setReady] = useState(false);
  const x = useRef(new Animated.Value(0)).current;
  // Position slides on the native driver; the width eases on a separate inner view (JS driver).
  const wv = useRef(new Animated.Value(0)).current;

  const accentKey = PILL_ACCENT[active];
  const fill = accentKey ? ACCENTS[accentKey].solid : fallbackAccent;
  const onFill = accentKey ? '#FFFFFF' : fallbackOnAccent;

  const moveTo = (key: string, animated: boolean) => {
    const l = layouts.current[key];
    if (!l) return;
    if (!animated || reduce) {
      x.setValue(l.x); wv.setValue(l.w);
      // First layout (e.g. opened on Deals from a link): bring the active pill into view at once.
      scrollRef.current?.scrollTo({ x: Math.max(0, l.x - SPACE.gutter * 2), animated: false });
      return;
    }
    Animated.parallel([
      Animated.spring(x, { toValue: l.x, useNativeDriver: true, speed: 16, bounciness: 5 }),
      Animated.timing(wv, { toValue: l.w, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
    scrollRef.current?.scrollTo({ x: Math.max(0, l.x - SPACE.gutter * 2), animated: true });
  };

  useEffect(() => { moveTo(active, ready); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active, ready]);

  const onPillLayout = (key: string) => (e: LayoutChangeEvent) => {
    const { x: lx, width } = e.nativeEvent.layout;
    const prev = layouts.current[key];
    layouts.current[key] = { x: lx, w: width };
    if (key === active && (!prev || prev.x !== lx || prev.w !== width)) moveTo(key, false);
    if (!ready && tabs.every((tb) => layouts.current[tb.key])) setReady(true);
  };

  return (
    <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.rail} accessibilityRole="tablist">
      <View style={st.row}>
        {/* Sliding indicator behind the active pill */}
        {layouts.current[active] ? (
          <Animated.View pointerEvents="none" style={[st.indicator, { transform: [{ translateX: x }] }]}>
            <Animated.View style={[st.indicatorFill, { width: wv, backgroundColor: fill }, accentGlow(fill, t.isDark)]} />
          </Animated.View>
        ) : null}
        {tabs.map((tb) => {
          const on = tb.key === active;
          return (
            <PressScale
              key={tb.key}
              onLayout={onPillLayout(tb.key)}
              onPress={() => { if (!on) { playSound('tabSwitch'); onSelect(tb.key); } }}
              haptic={!on}
              scaleTo={0.95}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={tb.label}
              style={[st.pill, !on && [{ backgroundColor: t.card }, t.isDark ? { borderWidth: 1, borderColor: t.line } : t.shadow]]}
            >
              <Ionicons name={tb.icon} size={ICON.sm} color={on ? onFill : t.sub} />
              <Text style={[st.label, { color: on ? onFill : t.text, fontWeight: on ? '700' : '600' }]} numberOfLines={1}>{tb.label}</Text>
            </PressScale>
          );
        })}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  rail: { paddingHorizontal: SPACE.gutter, paddingTop: SPACE.xxs, paddingBottom: SPACE.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  indicator: { position: 'absolute', left: 0, top: 0, height: 40 },
  indicatorFill: { height: 40, borderRadius: RADIUS.chip },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: RADIUS.chip },
  label: { fontSize: 13 },
});
