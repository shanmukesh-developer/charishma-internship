/**
 * "Pure Veg" splash (owner, 10 Nov 2026: "while changing to veg, full screen green like Swiggy with sound", then
 * "something perfect and luxurious like Swiggy and Zomato"). Switching Home to Veg:
 *  1. a deep emerald wash spreads over the whole screen from the Veg tab (top right), soft light from the top;
 *  2. a photoreal cluster of fresh vegetables (Gemini art, cut out) rises into the centre and settles;
 *  3. "SWITCHING TO" / "Pure Veg" (serif) with the veg mark, "Only vegetarian dishes from here", and a slim line that
 *     fills while it switches;
 *  4. it fades into the green Home. About 1.9 s, covers the bottom bar, plays the app's transition sound (silent on a
 *     silenced phone). Reduce motion: everything appears at once and fades.
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Modal, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { playMoment } from '../../utils/sounds';

const CLUSTER = require('../../assets/home-redesign-2026-11-09/veg-splash-cluster-gemini-2026-11-10.webp');
const SERIF = Platform.select({ android: 'serif', ios: 'Georgia', default: 'Georgia' });

export default function VegModeSplash({ visible, originY = 120, onDone }: { visible: boolean; originY?: number; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const grow = useRef(new Animated.Value(0)).current;
  const art = useRef(new Animated.Value(0)).current;
  const words = useRef(new Animated.Value(0)).current;
  const line = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    [grow, art, words, line].forEach((v) => v.setValue(0));
    fade.setValue(1);
    playMoment('vegMode');
    AccessibilityInfo.announceForAccessibility?.('Switching to pure veg. Only vegetarian dishes from here.');
    let anim: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        [grow, art, words, line].forEach((v) => v.setValue(1));
        anim = Animated.sequence([Animated.delay(1000), Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true })]);
      } else {
        anim = Animated.sequence([
          Animated.parallel([
            Animated.timing(grow, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.sequence([Animated.delay(220), Animated.spring(art, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true })]),
            Animated.sequence([Animated.delay(420), Animated.timing(words, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true })]),
            Animated.sequence([Animated.delay(480), Animated.timing(line, { toValue: 1, duration: 950, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]),
          ]),
          Animated.delay(120),
          Animated.timing(fade, { toValue: 0, duration: 360, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]);
      }
      anim.start(({ finished }) => { if (finished && !cancelled) doneRef.current(); });
    });
    return () => { cancelled = true; anim?.stop(); };
  }, [visible, grow, art, words, line, fade]);

  if (!visible) return null;
  const ox = width * 0.75;
  const R = Math.ceil(Math.hypot(Math.max(ox, width - ox), Math.max(originY, height - originY))) + 40;
  const artW = Math.min(300, width * 0.74);
  const artH = artW * 0.86;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="auto">
        {/* emerald wash from the Veg tab */}
        <Animated.View style={{ position: 'absolute', left: ox - R, top: originY - R, width: R * 2, height: R * 2, borderRadius: R, overflow: 'hidden', transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] }) }] }}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0B4428' }]} />
        </Animated.View>
        {/* depth once the wash has covered the screen: soft light from the top, a darker edge at the bottom */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: grow.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, 1] }) }]}>
          <LinearGradient colors={['#13603A', '#0B4428', '#062A18']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: height * 0.45 }} />
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.35 }} />
        </Animated.View>

        <View style={st.center} pointerEvents="none">
          {/* the vegetables rise and settle, with a soft shadow under them */}
          <Animated.View style={{ width: artW, height: artH, alignItems: 'center', justifyContent: 'flex-end', opacity: art, transform: [{ translateY: art.interpolate({ inputRange: [0, 1], outputRange: [46, 0] }) }, { scale: art.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] }}>
            <View style={[st.shadow, { width: artW * 0.7 }]} />
            <Image source={CLUSTER} style={{ position: 'absolute', top: 0, width: artW, height: artH }} resizeMode="contain" accessibilityIgnoresInvertColors />
          </Animated.View>

          <Animated.View style={{ alignItems: 'center', marginTop: 26, opacity: words, transform: [{ translateY: words.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
            <Text style={st.kicker} maxFontSizeMultiplier={1.2}>SWITCHING TO</Text>
            <View style={st.titleRow}>
              <View style={st.vegBox}><View style={st.vegDot} /></View>
              <Text style={st.title} maxFontSizeMultiplier={1.2}>Pure Veg</Text>
            </View>
            <Text style={st.sub} maxFontSizeMultiplier={1.3}>Only vegetarian dishes from here</Text>
            <View style={st.track}>
              <Animated.View style={[st.fill, { transform: [{ scaleX: line }] }]} />
            </View>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 30 },
  shadow: { height: 18, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.32)', marginBottom: -4, transform: [{ scaleY: 0.6 }] },
  kicker: { color: 'rgba(255,255,255,0.72)', fontSize: 11.5, fontWeight: '800', letterSpacing: 3.2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  vegBox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2.5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  vegDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#7CE3A0' },
  title: { color: '#FFFFFF', fontFamily: SERIF, fontSize: 40, fontWeight: '700', letterSpacing: 0.3 },
  sub: { color: 'rgba(255,255,255,0.82)', fontSize: 14, fontWeight: '500', marginTop: 8 },
  track: { width: 120, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 20, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 120, backgroundColor: '#9BEDB8', transformOrigin: '0% 50%' as any },
});
