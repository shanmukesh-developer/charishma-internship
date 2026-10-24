/**
 * Food & groceries v2: auto-sliding cut-out art for listing banners (hero style).
 * Every 3.5 s the next picture cross-fades in with a slight scale-up; swipe by hand to change,
 * touching pauses the auto-slide; small dots at the banner's bottom-right. All pictures are
 * mounted from the start (preloaded, no flash). Reduce motion: the first picture only.
 * Others → Food & groceries (modules/foodV2).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useReducedMotion } from '../../modules/others/motion';
import { useScreenActive } from '../../utils/useAppActive';

export default function BannerSlider({ slides, style, dotsStyle, every = 3500 /* 2.6 s hold + 0.9 s transition */ }: {
  slides: any[]; style: StyleProp<ViewStyle>; dotsStyle: StyleProp<ViewStyle>; every?: number;
}) {
  const reduce = useReducedMotion();
  const list = reduce ? slides.slice(0, 1) : slides;
  const [index, setIndex] = useState(0);
  const paused = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-slide only while the screen is on view and the app is in the foreground.
  const on = useScreenActive();
  const vals = useMemo(() => list.map((_, i) => new Animated.Value(i === 0 ? 1 : 0)), [list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next: number) => {
    const n = (next + list.length) % list.length;
    if (n === index) return;
    Animated.parallel([
      Animated.timing(vals[index], { toValue: 0, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(vals[n], { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]).start();
    setIndex(n);
  };

  useEffect(() => {
    if (list.length < 2 || !on) return;
    const t = setInterval(() => { if (!paused.current) go(index + 1); }, every);
    return () => clearInterval(t);
  }); // re-armed each render so it always advances from the current index

  useEffect(() => () => { if (resumeTimer.current) clearTimeout(resumeTimer.current); }, []);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => list.length > 1,
    onMoveShouldSetPanResponder: (_, g) => list.length > 1 && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: () => { paused.current = true; if (resumeTimer.current) clearTimeout(resumeTimer.current); },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -30) go(index + 1);
      else if (g.dx > 30) go(index - 1);
      resumeTimer.current = setTimeout(() => { paused.current = false; }, 5000);
    },
    onPanResponderTerminate: () => { resumeTimer.current = setTimeout(() => { paused.current = false; }, 5000); },
  }), [index, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* overflow hidden: the incoming slide starts 24 px to the right; unclipped it widened the page and shifted it sideways on web */}
      <View style={[style, { overflow: 'hidden' }]} {...pan.panHandlers} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {list.map((src, i) => (
          <Animated.View key={i} style={[StyleSheet.absoluteFill, { opacity: vals[i], transform: [{ translateX: vals[i].interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: vals[i].interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}>
            <Image source={src} style={StyleSheet.absoluteFill} contentFit="contain" />
          </Animated.View>
        ))}
      </View>
      {list.length > 1 && (
        <View style={[st.dots, dotsStyle]} pointerEvents="none">
          {list.map((_, i) => <View key={i} style={[st.dot, i === index && st.dotOn]} />)}
        </View>
      )}
    </>
  );
}

const st = StyleSheet.create({
  dots: { position: 'absolute', flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn: { width: 16, backgroundColor: 'rgba(255,255,255,0.9)' },
});
