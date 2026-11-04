/**
 * PG home hero slider: three building cut-outs that cross-fade with a slight scale (hold 2.6 s, 0.9 s
 * ease-in-out fade). All slides stay mounted so nothing flashes. Touching the hero pauses it; with
 * reduce-motion on, the first slide shows on its own. The dots live with the hero text (see `HeroDots`).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, AccessibilityInfo, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import type { V2Photo } from './pgV2Photos';
import { themedSheet } from '../../utils/themeNow';

const HOLD_MS = 2600;
const FADE_MS = 900;

export function useHeroSlider(count: number, paused: boolean) {
  const [index, setIndex] = useState(0);
  const [reduce, setReduce] = useState(false);
  const fades = useRef(Array.from({ length: count }, (_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live.current) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(!!v));
    return () => { live.current = false; sub.remove(); };
  }, []);
  useEffect(() => {
    if (reduce || paused || count < 2) return undefined;
    const t = setTimeout(() => {
      const next = (index + 1) % count;
      Animated.parallel([
        Animated.timing(fades[index], { toValue: 0, duration: FADE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(fades[next], { toValue: 1, duration: FADE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished && live.current) setIndex(next); });
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [index, paused, reduce, count, fades]);
  return { index, fades, reduce };
}

export function HeroSlides({ slides, fades, style }: { slides: V2Photo[]; fades: Animated.Value[]; style: StyleProp<ViewStyle> }) {
  return (
    <View style={style} pointerEvents="none">
      {slides.map((s, i) => (
        <Animated.View key={s.key} style={[StyleSheet.absoluteFill, {
          opacity: fades[i],
          transform: [{ scale: fades[i].interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }) }],
        }]}>
          <Image source={s.source as any} style={StyleSheet.absoluteFill} contentFit="contain" contentPosition="bottom right" transition={0} priority="high" accessibilityLabel={i === 0 ? s.caption : undefined} />
        </Animated.View>
      ))}
    </View>
  );
}

export function HeroDots({ count, index }: { count: number; index: number }) {
  return (
    <View style={st.dots} accessibilityLabel={`Photo ${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => <View key={i} style={[st.dot, i === index && st.dotOn]} />)}
    </View>
  );
}

const st = themedSheet(() => ({
  dots: { flexDirection: 'row', gap: 6, marginTop: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { width: 18, backgroundColor: '#FFFFFF' },
}));
