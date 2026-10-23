import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform, Easing, TouchableOpacity, StatusBar, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { useReduceMotion } from '../utils/reduceMotion';

// ZCS (Zenvy Community and Services) cold-start intro: a film-studio style logo reveal.

// Every size-based value follows the live window (useWindowDimensions): split screen, rotation and
// the resizable web preview never leave gaps or cut the title.
const ND = Platform.OS !== 'web'; // native driver on phones; the web preview animates in JS

// Splash backgroundColor in app.json: the first intro frame matches it exactly (no flash).
const BG = '#0A0A0B';
const GOLD = '#D4AF37';

// ── Timeline (ms) ── one native clock drives the whole sequence, so it plays the same on every phone
// and never depends on JS timers firing on time.
// Paced like a film title card: the full title is complete at TITLE_DONE and holds ~750 ms.
const TITLE_DONE = 2600;
const SEQ_END = 3350;   // choreography finished; exit starts here if the app is ready
const EXIT_MS = 600;    // push-in and fade into the app  →  minimum on screen ≈ 3.95 s
const HOLD_CAP = 3900;  // from mount: exit starts by now whatever happens (app not ready, delayed start)  →  ≤ ≈ 4.5 s
const SKIP_EXIT_MS = 180; // tap / Skip: near-instant fade (the app is usable from the tap)
const RM_HOLD = 250;    // reduce motion: static logo…
const RM_FADE = 350;    // …then a plain fade (≈ 600 ms total)

const LETTERS = ['Z', 'C', 'S'];
const MAX_CELL = 80;     // equal letter cells (even cinematic tracking, no width jitter), shrunk on narrow windows
const SIDE_PAD = 24;
const LETTER_START = 1000;
const LETTER_STAGGER = 220;
const LETTER_RISE = 600;
const SHIMMER = [2050, 2550] as const;
const SOFT_BAND = 72;
const CORE_BAND = 26;
const NAME = 'Zenvy Community and Services';

/** Title geometry for the current window width: three equal cells that always fit with side padding. */
function titleGeometry(winW: number) {
  const cell = Math.max(48, Math.min(MAX_CELL, Math.floor((winW - SIDE_PAD * 2) / LETTERS.length)));
  return { cell, rowW: cell * LETTERS.length, rowH: Math.round(cell * 1.1), font: Math.round(cell * 0.8) };
}
type Geometry = ReturnType<typeof titleGeometry>;

interface IntroOverlayProps {
  onComplete: () => void;
  /** The app underneath has rendered (fonts + saved theme). The intro waits for it after the sequence, up to HOLD_CAP. */
  ready?: boolean;
}

// ── Keyframe helpers ── Native-driver interpolations are piecewise linear (no easing), so curves are
// sampled into a few keyframes once at mount. Nothing runs per frame on the JS thread.
type Ease = (x: number) => number;
const linear: Ease = (x) => x;
const outCubic: Ease = (x) => 1 - Math.pow(1 - x, 3);
const inOutCubic: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
type Pt = [ms: number, value: number, ease?: Ease];

function curve(v: Animated.Value, pts: Pt[], steps = 5) {
  const inR = [pts[0][0]];
  const outR = [pts[0][1]];
  for (let i = 1; i < pts.length; i++) {
    const [a, va] = pts[i - 1];
    const [b, vb, e = outCubic] = pts[i];
    const n = e === linear ? 1 : steps;
    for (let s = 1; s <= n; s++) {
      const p = s / n;
      inR.push(a + (b - a) * p);
      outR.push(va + (vb - va) * e(p));
    }
  }
  return v.interpolate({ inputRange: inR, outputRange: outR, extrapolate: 'clamp' });
}

// `flareHalf` (flare travel, from the window width) and `bandSpan` (sweep travel, from the title width)
// are Animated values updated on resize, so the timeline is built once and never re-attached.
function buildTimeline(t: Animated.Value, exit: Animated.Value, flareHalf: Animated.Value, bandSpan: Animated.Value) {
  // Light-sweep band centre travels across the letters; each clip window moves with it while its
  // copy of the letters moves the opposite way, so the light stays locked to the glyphs.
  const sweep = curve(t, [[SHIMMER[0], 0], [SHIMMER[1], 1, inOutCubic]]);
  const band = (w: number) => {
    const x = Animated.add(Animated.multiply(sweep, bandSpan), -SOFT_BAND - w / 2);
    return { x, inner: Animated.multiply(x, -1) };
  };
  const soft = band(SOFT_BAND);
  const core = band(CORE_BAND);

  const stageOpacity = exit.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0, 0] });

  return {
    // Beat 1: black, then a soft vignette.
    backdrop: curve(t, [[0, 0], [600, 1]]),
    // Skip fades in early and leaves together with the stage.
    skipFade: Animated.multiply(curve(t, [[600, 0], [900, 1]]), stageOpacity),

    // Beat 2: a thin gold light line opens from the centre while a lens flare sweeps across it (~1 s).
    streakOpacity: curve(t, [[300, 0], [550, 0.9], [1150, 0.6, linear], [1550, 0]]),
    streakScale: curve(t, [[300, 0.05], [1150, 1]]),
    flareX: Animated.multiply(curve(t, [[300, -1], [1300, 1, inOutCubic]], 8), flareHalf),
    flareOpacity: curve(t, [[300, 0], [450, 1], [1150, 1, linear], [1350, 0]]),

    // Beat 3: Z, C, S rise into place one by one in the flare's wake (opacity + translateY only).
    letters: LETTERS.map((_, i) => {
      const s = LETTER_START + i * LETTER_STAGGER;
      return {
        opacity: curve(t, [[s, 0], [s + 360, 1]]),
        y: curve(t, [[s, 14], [s + LETTER_RISE, 0]]),
      };
    }),
    softX: soft.x,
    softInner: soft.inner,
    coreX: core.x,
    coreInner: core.inner,

    // Beat 4: hairline and the full name.
    hairline: curve(t, [[1900, 0], [2350, 1]]),
    hairlineOpacity: curve(t, [[1900, 0], [2050, 1]]),
    nameOpacity: curve(t, [[2150, 0], [TITLE_DONE, 1]]),
    nameY: curve(t, [[2150, 6], [TITLE_DONE, 0]]),

    // Beat 5: glow pulse behind the monogram.
    glow: curve(t, [[1600, 0], [2250, 0.9, inOutCubic], [SEQ_END, 0.55, inOutCubic]]),
    glowScale: curve(t, [[1600, 0.8], [2250, 1.08], [SEQ_END, 1, inOutCubic]]),

    // Four faint dust motes, all on the same clock (no loops), gone before the sequence ends.
    motes: Array.from({ length: 4 }).map((_, i) => {
      const d = 300 + i * 300;
      const peak = 0.25 + Math.random() * 0.3;
      return {
        left: `${Math.round(15 + Math.random() * 70)}%` as const,
        size: 2 + Math.random() * 1.5,
        y: curve(t, [[d, 0], [d + 1600, -(130 + Math.random() * 80), linear]]),
        opacity: curve(t, [[d, 0], [d + 400, peak], [d + 1200, peak * 0.8, linear], [d + 1600, 0]]),
      };
    }),

    // Exit (its own value; the timing easing applies): the camera pushes in through the monogram,
    // the backdrop lingers a beat and then dissolves into the app.
    stageScale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }),
    stageOpacity,
    fade: exit.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0.9, 0] }),
  };
}

// Dev web preview only: `?introAt=1200` freezes the intro at that moment (tap to dismiss), for screenshots.
function devFreezeAt(): number | null {
  if (!__DEV__ || Platform.OS !== 'web') return null;
  try {
    const v = new URLSearchParams(window.location.search).get('introAt');
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function GoldGlow({ id, w, h, strength, color = GOLD }: { id: string; w: number; h: number; strength: number; color?: string }) {
  return (
    <Svg width={w} height={h}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={strength} />
          <Stop offset="0.45" stopColor={color} stopOpacity={strength * 0.3} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={w} height={h} fill={`url(#${id})`} />
    </Svg>
  );
}

// Refined system faces (no font download, nothing to wait for): Roboto Medium / Light on Android,
// Avenir Next on iOS. Medium weight, never black.
const LETTER_FONT = Platform.select({
  android: { fontFamily: 'sans-serif-medium', fontWeight: '500' as const },
  ios: { fontFamily: 'Avenir Next', fontWeight: '500' as const },
  default: { fontFamily: '"Avenir Next", Montserrat, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontWeight: '500' as const },
});
const NAME_FONT = Platform.select({
  android: { fontFamily: 'sans-serif-light', fontWeight: '300' as const },
  ios: { fontFamily: 'Avenir Next', fontWeight: '400' as const },
  default: { fontFamily: '"Avenir Next", Montserrat, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontWeight: '300' as const },
});

/** One letter in its fixed cell: champagne gold with a slightly lighter upper half (a soft metallic sheen). */
function GoldLetter({ ch, g }: { ch: string; g: Geometry }) {
  const box = { width: g.cell, height: g.rowH };
  const type = [styles.letter, box, { lineHeight: g.rowH, fontSize: g.font }];
  return (
    <View style={box}>
      <Text allowFontScaling={false} style={[type, styles.letterBase]}>{ch}</Text>
      <View style={[styles.sheenClip, { width: g.cell, height: g.rowH * 0.5 }]}>
        <Text allowFontScaling={false} style={[type, styles.letterSheen]}>{ch}</Text>
      </View>
    </View>
  );
}

type Phase = 'intro' | 'hold' | 'still' | 'frozen' | 'exit';

export default function IntroOverlay({ onComplete, ready = true }: IntroOverlayProps) {
  // From the first exit frame the overlay stops catching touches (the app underneath is usable).
  const [exiting, setExiting] = useState(false);
  const [still, setStill] = useState(false);
  const phase = useRef<Phase>('intro');
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // onComplete runs once, whichever path ends the intro.
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCompleteRef.current();
  }, []);

  const { width: winW } = useWindowDimensions();
  const g = titleGeometry(winW);

  const t = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(1)).current;
  const flareHalf = useRef(new Animated.Value(winW * 0.65)).current;
  const bandSpan = useRef(new Animated.Value(g.rowW + SOFT_BAND * 2)).current;
  const tl = useRef<ReturnType<typeof buildTimeline> | null>(null);
  if (!tl.current) tl.current = buildTimeline(t, exit, flareHalf, bandSpan);
  const a = tl.current;

  // Window resized (split screen, rotation, web preview): retarget the size-based travel.
  useEffect(() => {
    flareHalf.setValue(winW * 0.65);
    bandSpan.setValue(g.rowW + SOFT_BAND * 2);
  }, [winW, g.rowW, flareHalf, bandSpan]);

  const breathLoop = useRef<Animated.CompositeAnimation | null>(null);
  const exitAnim = useRef<Animated.CompositeAnimation | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginExit = useCallback((ms: number) => {
    if (phase.current === 'exit') return;
    phase.current = 'exit';
    setExiting(true);
    breathLoop.current?.stop();
    exitAnim.current = Animated.timing(exit, {
      toValue: 1,
      duration: ms,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: ND,
    });
    exitAnim.current.start(() => finish());
    // Backup in case the completion callback never arrives (e.g. a backgrounded web tab).
    safety.current = setTimeout(finish, ms + 150);
  }, [exit, finish]);

  // Main sequence.
  useEffect(() => {
    const frozen = devFreezeAt();
    if (frozen !== null) {
      phase.current = 'frozen';
      t.setValue(Math.min(frozen, SEQ_END));
      if (frozen > SEQ_END) exit.setValue(inOutCubic(Math.min(1, (frozen - SEQ_END) / EXIT_MS)));
      return;
    }

    const seq = Animated.timing(t, { toValue: SEQ_END, duration: SEQ_END, easing: Easing.linear, useNativeDriver: ND });
    // Start after the first two frames: the overlay (and the app behind it) mounts first, so no frames drop at t=0.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => seq.start(onSeqEnd)); });
    function onSeqEnd({ finished }: { finished: boolean }) {
      if (!finished || phase.current !== 'intro') return;
      if (readyRef.current) { beginExit(EXIT_MS); return; }
      // Slow phone: the app is still rendering. The glow breathes gently until it is (or until the cap).
      phase.current = 'hold';
      breathLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(breath, { toValue: 0.65, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
        Animated.timing(breath, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      ]));
      breathLoop.current.start();
    }
    const cap = setTimeout(() => beginExit(EXIT_MS), HOLD_CAP);

    return () => {
      clearTimeout(cap);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (safety.current) clearTimeout(safety.current);
      seq.stop();
      breathLoop.current?.stop();
      exitAnim.current?.stop();
    };
  }, [t, exit, breath, beginExit]);

  // The app became ready during the hold: leave now.
  useEffect(() => {
    if (ready && phase.current === 'hold') beginExit(EXIT_MS);
  }, [ready, beginExit]);

  // Reduce motion (OS setting): no choreography, just the finished logo and a short fade.
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (!reduceMotion || phase.current === 'exit' || phase.current === 'frozen') return;
    t.stopAnimation();
    t.setValue(SEQ_END);
    phase.current = 'still';
    setStill(true);
    const h = setTimeout(() => beginExit(RM_FADE), RM_HOLD);
    return () => clearTimeout(h);
  }, [reduceMotion, t, beginExit]);

  const skip = useCallback(() => beginExit(SKIP_EXIT_MS), [beginExit]);

  const rowBox = { width: g.rowW, height: g.rowH };
  const shineRow = (color: string) => (
    <View style={[styles.lettersRow, rowBox]}>
      {LETTERS.map((ch) => (
        <Text
          key={ch}
          allowFontScaling={false}
          style={[styles.letter, { width: g.cell, height: g.rowH, lineHeight: g.rowH, fontSize: g.font, color }]}
        >
          {ch}
        </Text>
      ))}
    </View>
  );

  return (
    <Animated.View
      style={[styles.container, { opacity: a.fade, pointerEvents: exiting ? 'none' : 'auto' }]}
      onStartShouldSetResponder={() => true}
      onResponderRelease={skip}
      // No button role here: the Skip pill inside is the accessible button (a role here nests buttons on web).
      accessibilityLabel="ZCS, Zenvy Community and Services. Tap to skip"
    >
      {/* ── Beat 1: black with a soft cinematic vignette ── */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: a.backdrop }]} renderToHardwareTextureAndroid shouldRasterizeIOS>
        <LinearGradient colors={[BG, '#110E0A', BG]} locations={[0, 0.48, 1]} style={StyleSheet.absoluteFill} />
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="zcsIntroVignette" cx="50%" cy="46%" r="70%">
              <Stop offset="0" stopColor="#000" stopOpacity={0} />
              <Stop offset="0.45" stopColor="#000" stopOpacity={0.12} />
              <Stop offset="1" stopColor="#000" stopOpacity={0.9} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill="url(#zcsIntroVignette)" />
        </Svg>
      </Animated.View>

      {!still && a.motes.map((m, i) => (
        <Animated.View
          key={i}
          style={[
            styles.mote,
            {
              left: m.left,
              top: '62%',
              width: m.size,
              height: m.size,
              borderRadius: m.size / 2,
              opacity: m.opacity,
              transform: [{ translateY: m.y }],
            },
          ]}
        />
      ))}

      {/* ── Stage (pushes in on exit) ── */}
      <Animated.View
        style={[styles.stage, { opacity: a.stageOpacity, transform: still ? [] : [{ scale: a.stageScale }] }]}
        renderToHardwareTextureAndroid={exiting}
        shouldRasterizeIOS={exiting}
      >
        <View style={[styles.wordmark, { height: g.rowH }]}>
          {/* Beat 5 glow sits behind everything in the monogram */}
          <View style={[styles.centreLayer, { top: (g.rowH - GLOW_H) / 2, height: GLOW_H }]}>
            <Animated.View style={{ opacity: breath }}>
              <Animated.View style={{ opacity: a.glow, transform: [{ scale: a.glowScale }] }} renderToHardwareTextureAndroid shouldRasterizeIOS>
                <GoldGlow id="zcsIntroGlow" w={GLOW_W} h={GLOW_H} strength={0.3} />
              </Animated.View>
            </Animated.View>
          </View>

          {/* Beat 2: light line (full window width) + lens flare through the letters' centre line */}
          {!still && (
            <>
              <Animated.View style={[styles.streak, { top: g.rowH / 2 - 0.75, opacity: a.streakOpacity, transform: [{ scaleX: a.streakScale }] }]} renderToHardwareTextureAndroid shouldRasterizeIOS>
                <LinearGradient
                  colors={['rgba(212,175,55,0)', 'rgba(212,175,55,0.55)', 'rgba(255,240,200,0.95)', 'rgba(212,175,55,0.55)', 'rgba(212,175,55,0)']}
                  locations={[0, 0.3, 0.5, 0.7, 1]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <View style={[styles.centreLayer, { top: (g.rowH - FLARE_H) / 2, height: FLARE_H }]}>
                <Animated.View style={[styles.flare, { opacity: a.flareOpacity, transform: [{ translateX: a.flareX }] }]} renderToHardwareTextureAndroid shouldRasterizeIOS>
                  <GoldGlow id="zcsIntroFlareHalo" w={FLARE_W} h={FLARE_H} strength={0.55} />
                  <View style={styles.flareCore}>
                    <GoldGlow id="zcsIntroFlareCore" w={56} h={56} strength={0.95} color="#FFF4D6" />
                  </View>
                </Animated.View>
              </View>
            </>
          )}

          {/* Beat 3: the monogram, centred by flexbox */}
          <View style={rowBox}>
            <View style={[styles.lettersRow, rowBox]}>
              {LETTERS.map((ch, i) => (
                <Animated.View
                  key={ch}
                  style={{ opacity: a.letters[i].opacity, transform: [{ translateY: a.letters[i].y }] }}
                  renderToHardwareTextureAndroid
                  shouldRasterizeIOS
                >
                  <GoldLetter ch={ch} g={g} />
                </Animated.View>
              ))}
            </View>

            {!still && (
              <>
                <Animated.View style={[styles.band, { width: SOFT_BAND, height: g.rowH, opacity: 0.55, transform: [{ translateX: a.softX }] }]}>
                  <Animated.View style={[styles.bandInner, rowBox, { transform: [{ translateX: a.softInner }] }]} renderToHardwareTextureAndroid shouldRasterizeIOS>
                    {shineRow('#F3DFA6')}
                  </Animated.View>
                </Animated.View>
                <Animated.View style={[styles.band, { width: CORE_BAND, height: g.rowH, transform: [{ translateX: a.coreX }] }]}>
                  <Animated.View style={[styles.bandInner, rowBox, { transform: [{ translateX: a.coreInner }] }]} renderToHardwareTextureAndroid shouldRasterizeIOS>
                    {shineRow('#FFF7E2')}
                  </Animated.View>
                </Animated.View>
              </>
            )}
          </View>
        </View>

        {/* Beat 4: hairline + the full name */}
        <Animated.View style={{ opacity: a.hairlineOpacity, transform: [{ scaleX: a.hairline }] }} renderToHardwareTextureAndroid shouldRasterizeIOS>
          <LinearGradient
            colors={['rgba(212,175,55,0)', 'rgba(212,175,55,0.8)', 'rgba(212,175,55,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.hairline}
          />
        </Animated.View>
        <Animated.View style={{ opacity: a.nameOpacity, transform: [{ translateY: a.nameY }] }} renderToHardwareTextureAndroid shouldRasterizeIOS>
          <Text allowFontScaling={false} style={[styles.name, { maxWidth: winW - SIDE_PAD * 2 }]}>{NAME}</Text>
        </Animated.View>
      </Animated.View>

      {/* ── Skip ── */}
      <Animated.View style={[styles.skipWrap, { opacity: still ? a.stageOpacity : a.skipFade }]}>
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={skip}
          activeOpacity={0.75}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Skip intro"
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const GLOW_W = 360;
const GLOW_H = 190;
const FLARE_W = 240;
const FLARE_H = 70;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG,
    zIndex: 999999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mote: {
    position: 'absolute',
    backgroundColor: GOLD,
  },

  stage: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginBottom: 40,
  },
  wordmark: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full-width absolute layer whose child is centred by flexbox (no x offsets from a stale width).
  centreLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streak: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1.5,
  },
  flare: {
    width: FLARE_W,
    height: FLARE_H,
  },
  flareCore: {
    position: 'absolute',
    left: (FLARE_W - 56) / 2,
    top: (FLARE_H - 56) / 2,
  },
  lettersRow: {
    flexDirection: 'row',
  },
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
  bandInner: {
    position: 'absolute',
    top: 0,
    left: 0,
  },

  hairline: {
    width: 170,
    height: 1,
    marginTop: 4,
    marginBottom: 14,
  },
  letter: {
    ...LETTER_FONT,
    textAlign: 'center',
    includeFontPadding: false,
  },
  letterBase: {
    color: '#CFA94E',
    textShadowColor: 'rgba(212,175,55,0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  sheenClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
  letterSheen: {
    color: '#E9CF86',
  },
  name: {
    ...NAME_FONT,
    color: '#D9C795',
    opacity: 0.82,
    fontSize: 11.5,
    letterSpacing: 3,
    textAlign: 'center',
  },

  skipWrap: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : (StatusBar.currentHeight ?? 24) + 12,
    right: 20,
  },
  skipBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E9D28F',
    letterSpacing: 0.3,
  },
});
