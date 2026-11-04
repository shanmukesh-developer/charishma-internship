// Sponsored splash shell (design render() + finish()): the chosen style full screen, Skip top right, the
// 10 s idle bar, the hint and the ghost finger until the first touch, stardust over everything, and the
// close: whoosh + fade onto Home (or straight into the store from the Explore button).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFonts } from 'expo-font';
import type { SkImage } from '@shopify/react-native-skia';
import { runOnUI } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { SplashAd } from './adSplashApi';
import { createAdSound, type RustleKind } from './adSound';
import {
  AdCtx, Ghost, Hint, IdleBar, MagicCanvas, RN_FONT_FILES, SkipButton, WaveRing, useAdFontMgr, useMagicLayer, useStage, type AdApi,
} from './kit';
import { STYLES } from './styles';

/**
 * `visible` false = built and drawn behind the intro while it plays (fonts loaded, photo decoded, Skia surfaces
 * painted), so the intro fades straight into a finished ad with no blank frame or hitch (owner, 28 Oct 2026: "the
 * transition to the advertisement must be very smooth"). Timers, ghost finger and hint start only once visible.
 */
export default function AdSplash({ ad, art, onClose, visible = true }: { ad: SplashAd; art: SkImage | null; onClose: (storeId?: string) => void; visible?: boolean }) {
  const stage = useStage();
  const [rnFonts] = useFonts(RN_FONT_FILES);
  const fm = useAdFontMgr();
  const def = STYLES[ad.style];
  const sound = useMemo(() => createAdSound(), []);
  const engaged = useSharedValue(0);
  const active = useSharedValue(visible ? 1 : 0);
  // Built under the intro (visible=false): fully drawn there, so the intro's own fade-out reveals a finished ad.
  // Arriving after the intro (visible from the start): a short fade-in instead of a pop over Home.
  const fade = useSharedValue(visible ? 0 : 1);
  const lastRustle = useSharedValue(0);
  const doneRef = useRef(false);
  const autoRef = useRef<null | (() => void)>(null);
  const [waves, setWaves] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const { picture, magic } = useMagicLayer(stage, active);
  const close = useCallback((storeId?: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    sound.whoosh();
    fade.value = withTiming(0, { duration: 450, easing: Easing.out(Easing.quad) }, (f) => { if (f) runOnJS(onClose)(storeId); });
    setTimeout(() => { active.value = 0; sound.release(); }, 700);
  }, [onClose, sound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shown: fade in (a cross-fade with the intro fading out above it) and start the stardust.
  useEffect(() => {
    if (!visible || doneRef.current) return;
    active.value = 1;
    fade.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) });
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  // Safety: whatever happens, the ad never stays on screen longer than 25 s.
  useEffect(() => { if (!visible) return undefined; const t = setTimeout(() => close(), 25000); return () => clearTimeout(t); }, [close, visible]);
  useEffect(() => () => { sound.release(); }, [sound]);

  const api: AdApi = useMemo(() => {
    const engageW = () => { 'worklet'; engaged.value = 1; };
    return {
      ad, stage, art, fm, sound, magic,
      burstJS: (x, y, n, cols, spd, g, sz, kind) => { runOnUI(magic.burst)(x, y, n, cols, spd, g, sz, kind); },
      wave: (x, y) => setWaves((w) => [...w, { id: Date.now() + Math.random(), x, y }]),
      engaged,
      engage: () => { engaged.value = 1; },
      engageW,
      finish: () => close(),
      explore: () => close(ad.store.id),
      setAuto: (fn) => { autoRef.current = fn; },
      rustleW: (kind: RustleKind, power: number) => {
        'worklet';
        const now = Date.now();
        if (now - lastRustle.value < 55) return;
        lastRustle.value = now;
        runOnJS(sound.rustle)(kind, power);
      },
      feedbackW: () => { 'worklet'; runOnJS(sound.tick)(); runOnJS(sound.chime)(); },
    };
  }, [ad, stage, art, fm, sound, magic, close]); // eslint-disable-line react-hooks/exhaustive-deps

  const wrap = useAnimatedStyle(() => ({ opacity: fade.value }));
  const ready = !!rnFonts && !!fm && !!def;
  // Fonts come from the app bundle; if they ever fail to load the ad is skipped rather than shown half-built.
  useEffect(() => { if (ready || !visible) return undefined; const t = setTimeout(() => { if (!doneRef.current) { doneRef.current = true; onClose(); } }, 3000); return () => clearTimeout(t); }, [ready, visible, onClose]);
  useEffect(() => { if (ready && visible) AccessibilityInfo.announceForAccessibility?.(`Sponsored. ${ad.store.name}. ${ad.offerText}.`); }, [ready, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  // Not ready yet: nothing on screen (never a blank sheet over Home); behind the intro this is invisible anyway.
  if (!ready) return null;
  const Comp = def.Comp;

  return (
    <AdCtx.Provider value={api}>
      {/* The ad sits beside the app's screens (app/_layout.tsx), outside their gesture root: on Android a gesture
          only fires under a GestureHandlerRootView, so the ad brings its own (without it no swipe ever tore). */}
      <GestureHandlerRootView pointerEvents={visible ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, styles.root]}>
      <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { backgroundColor: def.transparent ? 'transparent' : '#06140e' }, wrap]}>
        <Comp />
        {visible ? <Hint text={def.hint} /> : null}
        {visible ? <Ghost path={def.ghost} /> : null}
        <MagicCanvas picture={picture} />
        {waves.map((w) => <WaveRing key={w.id} x={w.x} y={w.y} onEnd={() => setWaves((ws) => ws.filter((q) => q.id !== w.id))} />)}
        {visible ? <IdleBar onTimeout={() => { if (!engaged.value) close(); }} /> : null}
        <SkipButton onPress={() => close()} />
        {/* Screen readers: one control that plays the reveal by itself (the design's Enter key). */}
        <Pressable accessibilityRole="button" accessibilityLabel={`Sponsored ad from ${ad.store.name}. Double tap to reveal the offer.`}
          onPress={() => { engaged.value = 1; autoRef.current?.(); }} style={styles.a11y} />
      </Animated.View>
      </GestureHandlerRootView>
    </AdCtx.Provider>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 100000, elevation: 100000 },
  a11y: { position: 'absolute', width: 1, height: 1, left: 0, top: 0, opacity: 0 },
});
