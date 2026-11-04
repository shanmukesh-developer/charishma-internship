import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform, Easing, TouchableOpacity, StatusBar, useWindowDimensions, InteractionManager } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image } from 'expo-image';
import ZenvBadge, { ZENV_YELLOW } from './ZenvBadge';
import { createIntroSound, type IntroSound } from './intro/introSound';
import { useReduceMotion } from '../utils/reduceMotion';
import { markIntroDone } from '../utils/introGate';

// ZENV cold-start intro (owner, 4 Nov 2026: "THIS IS MY INTRO BUDDY FOR THIS APPLICATION"): the owner's own 3.35 s
// clip, assets/zenv-intro-delivery-rider-2026-11-04.mp4 (1920x1080, 24 fps, white background). The rider rides in
// from the left edge into the yellow disc and ZENV appears under him (about 1.5 s), then the logo holds.
//   - Whole clip, centred (contain): the rider crosses the frame, so cover would cut his entry off on a portrait phone.
//   - White stage: every edge pixel of the clip is pure white, so the clip on a white stage reads as full screen. The
//     stage fades in from the splash's dark colour once the first frame is on screen (never a black frame).
//   - Always muted, never takes audio focus. Its own soundtrack (the same audio, copied out of the clip) plays through
//     components/intro/introSound with the existing rules: silent ringer, Profile > App sounds, the admins' switch.
//   - The video has 1.5 s after the app is ready for it. If it errors or has not started by then, the ZENV badge pops
//     in on the dark background instead (soft spring, a faint glow), holds, then hands over to Home the same way.
//   - Reduce motion: no clip, the still badge and a short fade.
// Skip, the hand-over to Home (wait for the app, settle two frames, push-in and fade) and the caps are as before.

const ND = Platform.OS !== 'web'; // native driver on phones; the web preview animates in JS

const INTRO_VIDEO = require('../assets/zenv-intro-delivery-rider-2026-11-04.mp4');
const INTRO_LAST_FRAME = require('../assets/zenv-intro-last-frame-2026-11-04.png');

// Splash backgroundColor in app.json: now #FFFFFF (white), matching the video stage — zero visual jump at any point.
// The launch screen is plain white, so every mode of the intro (clip, fallback badge, reduce motion) is on white too:
// the fallback used to cut from white to near-black, a hard flash seen on the emulator, 4 Nov.
const BG = '#FFFFFF';
// The clip's own background: the stage behind it is the same white, so its edges never show.
const STAGE = '#FFFFFF';

// ── Timeline (ms) ── the clock starts with the clip's first frame and plays the same on every phone.
const SEQ_END = 3330;   // the clip is 3.33 s (80 frames @ 24fps) and holds its last frame (the logo)
const EXIT_MS = 500;    // smooth dissolve into the app
const START_CAP = 2200; // from mount: the clip is started by now even if the app never reports it has settled
const HOLD_CAP = 5200;  // from the start: exit starts by now whatever happens (app not ready, slow start)
const SKIP_EXIT_MS = 260; // Skip: a quick fade, once Home has drawn behind the still logo
const SKIP_PAINT_CAP = 600; // Skip: wait for Home's first full draw at most this long (the logo is still meanwhile)
const RM_HOLD = 250;    // reduce motion: still badge…
const RM_FADE = 350;    // …then a plain fade (≈ 600 ms total)
const STAGE_IN_MS = 300;  // dark splash colour → white stage, from the first frame
const START_GRACE = 1500; // the clip must have started this long after the app is ready for it, else the badge
const FRAME_GRACE = 250;  // playing but no first-frame callback yet: show the stage anyway after this
const PAINT_CAP = 900;    // hand-over: wait for Home to finish drawing behind the still logo, at most this long
const BADGE_HOLD = 1000;  // the fallback badge: from its pop to the hand-over

interface IntroOverlayProps {
  onComplete: () => void;
  /** The app underneath has rendered (fonts + saved theme). The intro waits for it after the sequence, up to HOLD_CAP. */
  ready?: boolean;
  /**
   * The app tree behind the intro has finished its first mount. Measured on a Vivo V2439: mounting the app froze the
   * UI thread for up to 0.6 s at a time during the first ~2 s, so motion started then stuttered. The clip now starts
   * only once this is true (or after START_CAP); until then the intro holds its first frame (the splash colour).
   */
  start?: boolean;
}

// ── Keyframe helpers ── Native-driver interpolations are piecewise linear (no easing), so curves are
// sampled into a few keyframes once at mount. Nothing runs per frame on the JS thread.
type Ease = (x: number) => number;
const outCubic: Ease = (x) => 1 - Math.pow(1 - x, 3);
const inOutCubic: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
type Pt = [ms: number, value: number, ease?: Ease];

function curve(v: Animated.Value, pts: Pt[], steps = 5) {
  const inR = [pts[0][0]];
  const outR = [pts[0][1]];
  for (let i = 1; i < pts.length; i++) {
    const [a, va] = pts[i - 1];
    const [b, vb, e = outCubic] = pts[i];
    for (let s = 1; s <= steps; s++) {
      const p = s / steps;
      inR.push(a + (b - a) * p);
      outR.push(va + (vb - va) * e(p));
    }
  }
  return v.interpolate({ inputRange: inR, outputRange: outR, extrapolate: 'clamp' });
}

function buildTimeline(t: Animated.Value, exit: Animated.Value, pop: Animated.Value) {
  const stageOpacity = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return {
    // The white stage with the clip comes up from the splash colour as the first frame shows.
    stageIn: curve(t, [[0, 0], [STAGE_IN_MS, 1, inOutCubic]]),
    // A white veil over the clip until it is really playing, then it lifts: the launch screen is plain white (app.json
    // splash), so launch screen -> intro is one continuous white, and the rider and disc fade up out of it.
    veil: curve(t, [[0, 1], [STAGE_IN_MS, 0, inOutCubic]]),
    // Skip button fades in early and leaves smoothly with exit.
    skipFade: Animated.multiply(curve(t, [[600, 0], [900, 1]]), exit.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0, 0] })),
    // Fallback badge: a soft spring (pop overshoots 1 a little and settles), fading in on its first half.
    badgeOpacity: pop.interpolate({ inputRange: [0, 0.55], outputRange: [0, 1], extrapolate: 'clamp' }),
    badgeScale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }),
    badgeGlow: pop.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    badgeSkip: Animated.multiply(pop.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), exit.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0, 0] })),
    // Exit (its own value; the timing easing applies): a gentle push-in, the backdrop lingers a beat and dissolves.
    videoScale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }),
    badgeExitScale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }),
    stageOpacity,
    // Root container fade: clean, continuous dissolve directly onto the app screen (no black dip).
    fade: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  };
}

// Dev web preview only: `?introAt=1200` freezes the intro at that moment of the clip (tap to dismiss), for screenshots.
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

// Dev web preview only: `?introSound=tap` holds the intro on its first frame until a tap, then plays it with its sound
// (browsers block sound until the page is tapped; the app itself starts on its own).
function devTapToStart(): boolean {
  if (!__DEV__ || Platform.OS !== 'web') return false;
  try {
    return new URLSearchParams(window.location.search).get('introSound') === 'tap';
  } catch {
    return false;
  }
}

// Dev web preview only: `?introFallback=1` shows the fallback (the badge), as when the clip cannot play.
function devFallback(): boolean {
  if (!__DEV__ || Platform.OS !== 'web') return false;
  try {
    return new URLSearchParams(window.location.search).get('introFallback') === '1';
  } catch {
    return false;
  }
}

function Glow({ id, size, color, strength }: { id: string; size: number; color: string; strength: number }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={strength} />
          <Stop offset="0.5" stopColor={color} stopOpacity={strength * 0.28} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={size} height={size} fill={`url(#${id})`} />
    </Svg>
  );
}

type Phase = 'intro' | 'badge' | 'hold' | 'skip' | 'still' | 'frozen' | 'exit';
type Mode = 'video' | 'badge' | 'still';

export default function IntroOverlay({ onComplete, ready = true, start = true }: IntroOverlayProps) {
  // From the first exit frame the overlay stops catching touches (the app underneath is usable).
  const [exiting, setExiting] = useState(false);
  const [frozenAt] = useState(devFreezeAt);
  const [mode, setMode] = useState<Mode>(() => (devFallback() ? 'badge' : 'video'));
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const phase = useRef<Phase>('intro');
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const [startNow, setStartNow] = useState(true); // play immediately — video decoder is a hardware thread, won't stutter
  useEffect(() => { if (start) setStartNow(true); }, [start]);
  useEffect(() => {
    if (startNow) return;
    const t0 = setTimeout(() => setStartNow(true), START_CAP);
    return () => clearTimeout(t0);
  }, [startNow]);
  // Dev web preview with sound: wait for the tap that unlocks the browser's audio.
  const [tapToStart] = useState(devTapToStart);
  const [tapped, setTapped] = useState(false);
  const go = startNow && (!tapToStart || tapped);

  // The intro sound (components/intro/introSound): prepared now, started with the clip's first frame, faded on skip,
  // freed at the end.
  const sound = useRef<IntroSound | null>(null);
  useEffect(() => {
    // Phones only (a browser blocks sound until a tap), except the dev web preview with sound (?introSound=tap).
    if (devFreezeAt() !== null || devFallback() || (Platform.OS === 'web' && !devTapToStart())) return undefined;
    const s = createIntroSound();
    sound.current = s;
    return () => { s.stop(0); sound.current = null; };
  }, []);


  // onComplete runs once, whichever path ends the intro.
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    markIntroDone();
    onCompleteRef.current();
  }, []);

  const { width: winW } = useWindowDimensions();
  // The fallback badge: about 40% of the window width, 120 to 168 dp, a whole number of pixels.
  const badgeSize = Math.round(Math.max(120, Math.min(168, winW * 0.4)));
  const glowSize = Math.round(badgeSize * 1.9);

  const t = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(devFallback() ? 1 : 0)).current;
  const tl = useRef<ReturnType<typeof buildTimeline> | null>(null);
  if (!tl.current) tl.current = buildTimeline(t, exit, pop);
  const a = tl.current;

  // The player is created on the first render and starts loading the bundled clip at once (preloaded before it shows).
  const player = useVideoPlayer(INTRO_VIDEO, (p) => {
    p.loop = false;
    p.muted = true; // the soundtrack plays through introSound, which respects the silent ringer and the switches
    p.audioMixingMode = 'mixWithOthers'; // never takes audio focus from music
    p.keepScreenOnWhilePlaying = false;
  });

  const exitAnim = useRef<Animated.CompositeAnimation | null>(null);
  const seqAnim = useRef<Animated.CompositeAnimation | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafs = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  const frame = (fn: () => void) => { rafs.current.push(requestAnimationFrame(fn)); };

  // Android draws the video surface (TextureView) as a BLACK box while it is faded out (measured on the emulator,
  // 4 Nov: frames of a black rectangle where the clip was during the dissolve). So the clip never takes part in the
  // fade: at the end it is swapped for its identical last frame (already decoded underneath, so the swap is
  // invisible), and on Skip it is removed and the white stage fades on its own.
  const [videoOff, setVideoOff] = useState<'no' | 'still' | 'blank'>('no');
  const videoOffRef = useRef<'no' | 'still' | 'blank'>('no');
  const retireVideo = useCallback((how: 'still' | 'blank') => {
    if (videoOffRef.current !== 'no') return;
    videoOffRef.current = how;
    setVideoOff(how);
    try { player.pause(); } catch { /* released */ }
  }, [player]);

  const beginExit = useCallback((ms: number) => {
    if (phase.current === 'exit') return;
    phase.current = 'exit';
    setExiting(true);
    const run = () => {
      exitAnim.current = Animated.timing(exit, {
        toValue: 1,
        duration: ms,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: ND,
      });
      exitAnim.current.start(() => finish());
      // Backup in case the completion callback never arrives (e.g. a backgrounded web tab).
      safety.current = setTimeout(finish, ms + 150);
    };
    if (modeRef.current === 'video' && videoOffRef.current === 'no') {
      // Skip (or the cap) mid-clip: take the clip off first, start the fade once that has been drawn.
      retireVideo('blank');
      frame(() => frame(run));
    } else {
      run();
    }
  }, [exit, finish, retireVideo]);

  // The clip (or the fallback badge) has finished: hand over to Home.
  const handOver = useCallback(() => {
    if (phase.current !== 'intro' && phase.current !== 'badge') return;
    if (modeRef.current === 'video') retireVideo('still'); // the identical still logo from here on
    if (readyRef.current) {
      // Let Home draw its full content now, behind the finished (still) logo, then fade out once it has painted
      // (after the JS render and two frames). A stall on a still frame is invisible; a stall during motion is not.
      // Home's first full render can block the phone for a few hundred ms; waiting for it (the logo is still, so the
      // wait is invisible) keeps the fade itself smooth instead of stuttering through Home's mount.
      markIntroDone();
      let gone = false;
      const go = () => { if (gone) return; gone = true; frame(() => frame(() => beginExit(EXIT_MS))); };
      later(() => InteractionManager.runAfterInteractions(go), 60);
      later(go, PAINT_CAP);
      return;
    }
    // Slow phone: the app is still rendering. The logo stays on screen until it is (or until the cap).
    phase.current = 'hold';
  }, [beginExit, retireVideo]);

  // ── The clip ──
  const begun = useRef(false);
  const frameShown = useRef(false);
  const playingNow = useRef(false);

  // First frame on screen and playing: the clock, the stage fade and the sound start together.
  const begin = useCallback(() => {
    if (begun.current || phase.current !== 'intro' || modeRef.current !== 'video') return;
    begun.current = true;
    seqAnim.current = Animated.timing(t, { toValue: SEQ_END, duration: SEQ_END, easing: Easing.linear, useNativeDriver: ND });
    seqAnim.current.start(({ finished }) => { if (finished) handOver(); });
    sound.current?.start();
  }, [t, handOver]);

  // The fallback: the ZENV badge on the dark background, a soft spring and a faint glow, then the same hand-over.
  const showBadge = useCallback(() => {
    if (begun.current || phase.current !== 'intro') return;
    phase.current = 'badge';
    setMode('badge');
    try { player.pause(); } catch { /* released */ }
    sound.current?.stop(0); // the soundtrack belongs to the clip
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 46, useNativeDriver: ND }).start();
    later(handOver, BADGE_HOLD);
  }, [player, pop, handOver]);

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!isPlaying || begun.current || frozenAt !== null) return;
    playingNow.current = true;
    if (frameShown.current) begin();
    else later(begin, FRAME_GRACE); // some players report the first frame late: never wait on it for long
  });
  useEventListener(player, 'playToEnd', () => {
    handOver();
  });
  // Dev freeze: show that moment of the clip, still.
  const freezeFrame = useCallback(() => {
    if (frozenAt === null) return;
    try { player.pause(); player.currentTime = Math.min(frozenAt, 3340) / 1000; } catch { /* not ready yet */ }
  }, [player, frozenAt]);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (frozenAt !== null) { if (status === 'readyToPlay') freezeFrame(); return; }
    if (status === 'error') showBadge();
  });
  const onFirstFrame = useCallback(() => {
    frameShown.current = true;
    if (frozenAt !== null) { freezeFrame(); return; }
    if (playingNow.current) begin();
  }, [frozenAt, freezeFrame, begin]);

  // Main sequence: once the app behind has mounted, play the clip; the badge if it has not started in time.
  useEffect(() => {
    if (frozenAt !== null) {
      phase.current = 'frozen';
      t.setValue(Math.min(Math.max(frozenAt, STAGE_IN_MS), SEQ_END));
      if (frozenAt > SEQ_END) exit.setValue(inOutCubic(Math.min(1, (frozenAt - SEQ_END) / EXIT_MS)));
      return;
    }
    if (!go) return; // hold the first frame (the splash colour) until the app behind has mounted
    if (modeRef.current === 'badge') {
      // ?introFallback=1 (dev): the badge from the start.
      phase.current = 'badge';
      later(handOver, BADGE_HOLD);
    } else if (phase.current === 'intro') {
      try { player.play(); } catch { showBadge(); }
      later(() => { if (!begun.current) showBadge(); }, START_GRACE);
    }
    const cap = setTimeout(() => beginExit(EXIT_MS), HOLD_CAP);
    return () => { clearTimeout(cap); };
  }, [go, t, exit, player, frozenAt, handOver, showBadge, beginExit]);

  // Everything still pending is dropped when the intro leaves.
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    rafs.current.forEach(cancelAnimationFrame);
    if (safety.current) clearTimeout(safety.current);
    seqAnim.current?.stop();
    exitAnim.current?.stop();
  }, []);

  // The app became ready during the hold: leave now.
  useEffect(() => {
    if (ready && phase.current === 'hold') beginExit(EXIT_MS);
  }, [ready, beginExit]);

  // Reduce motion (OS setting): no clip, just the still badge and a short fade.
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (!reduceMotion || phase.current === 'exit' || phase.current === 'frozen') return;
    seqAnim.current?.stop();
    try { player.pause(); } catch { /* released */ }
    sound.current?.stop(0); // the sound follows the clip: none for the still badge
    phase.current = 'still';
    pop.setValue(1);
    setMode('still');
    const h = setTimeout(() => beginExit(RM_FADE), RM_HOLD);
    return () => clearTimeout(h);
  }, [reduceMotion, player, pop, beginExit]);

  // Skip: Home only draws its full content once the intro is done (utils/introGate), so fading straight away showed
  // Home's empty dark page (the owner's "black screen", 4 Nov). Now Skip ends the clip on its still logo, lets Home draw
  // behind it, then fades: the same clean hand-over as the natural end, just sooner.
  const skip = useCallback(() => {
    if (phase.current === 'exit' || phase.current === 'skip') return;
    phase.current = 'skip';
    sound.current?.stop(220);
    seqAnim.current?.stop();
    if (modeRef.current === 'video') {
      retireVideo('still');
      t.setValue(SEQ_END); // lifts the veil if the clip had barely started; Skip stays visible until the fade
    }
    markIntroDone();
    let gone = false;
    const go = () => { if (gone) return; gone = true; frame(() => frame(() => beginExit(SKIP_EXIT_MS))); };
    later(() => InteractionManager.runAfterInteractions(go), 40);
    later(go, SKIP_PAINT_CAP);
  }, [beginExit, retireVideo, t]);

  const still = mode === 'still';
  const onLight = true; // every mode is on the white stage

  return (
    <Animated.View
      style={[
        styles.container,
        {
          // Container stays dark (#0A0A0B) — matches the native splash. The white stage inside is always
          // visible from first render so there is zero dark gap before the video plays.
          opacity: a.fade,
          pointerEvents: exiting ? 'none' : 'auto',
        },
      ]}
      // Fade the intro as ONE flat picture: without these Android fades each layer (white stage, still logo) on its
      // own, and where they overlap the logo's strip showed lighter than the rest during the dissolve.
      // Only during the fade: kept on all the time it froze the video's TextureView (the clip never started).
      needsOffscreenAlphaCompositing={exiting}
      renderToHardwareTextureAndroid={exiting}
      onStartShouldSetResponder={() => true}
      // A tap on the picture does nothing (a stray touch used to cut the intro); only the Skip pill skips. The
      // responder still swallows touches so nothing underneath reacts during the intro.
      onResponderRelease={tapToStart && !tapped ? () => setTapped(true) : undefined}
      // No button role here: the Skip pill inside is the accessible button (a role here nests buttons on web).
      accessibilityLabel="ZENV intro"
    >
      {tapToStart && !tapped && (
        <View style={styles.tapHint} pointerEvents="none">
          <Text style={styles.tapHintText}>Tap to play the intro with sound</Text>
        </View>
      )}

      {/* ── The clip on its white stage ── always visible from first render so no dark gap before the video */}
      {mode === 'video' && (
        <View style={[StyleSheet.absoluteFill, styles.stage]} pointerEvents="none">
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: a.videoScale }] }]}>
            {/* The clip's last frame, decoded from the start and kept UNDER the clip: if a phone clears the video
                surface at the end, the identical logo is already there (no swap, no blink at the hand-over). */}
            <Image
              source={INTRO_LAST_FRAME}
              style={[styles.video, videoOff === 'blank' && styles.hidden]}
              contentFit="contain"
              transition={0}
              accessible={false}
            />
            {videoOff === 'no' && (
              <VideoView
                player={player}
                // Explicit 100% size: on web the <video> would otherwise keep its intrinsic 1920 x 1080 box.
                style={styles.video}
                contentFit="contain"
                nativeControls={false}
                fullscreenOptions={{ enable: false }}
                allowsPictureInPicture={false}
                playsInline
                // A TextureView takes part in the fade and the push-in (a SurfaceView would ignore them).
                surfaceType="textureView"
                onFirstFrameRender={onFirstFrame}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              />
            )}
            {/* White veil: hides the video surface (black or the still logo underneath) until the clip is playing. */}
            <Animated.View style={[StyleSheet.absoluteFill, styles.stage, { opacity: a.veil }]} />
          </Animated.View>
        </View>
      )}

      {/* ── Fallback (and reduce motion): the ZENV badge on the dark background ── */}
      {mode !== 'video' && (
        <Animated.View
          style={[styles.badgeStage, { opacity: a.stageOpacity, transform: still ? [] : [{ scale: a.badgeExitScale }] }]}
          pointerEvents="none"
        >
          <View style={[styles.centreLayer, { width: glowSize, height: glowSize }]}>
            <Animated.View style={{ opacity: still ? 1 : a.badgeGlow }}>
              <Glow id="zenvIntroGlow" size={glowSize} color={ZENV_YELLOW} strength={0.3} />
            </Animated.View>
          </View>
          <Animated.View style={{ opacity: still ? 1 : a.badgeOpacity, transform: still ? [] : [{ scale: a.badgeScale }] }}>
            <ZenvBadge size={badgeSize} />
          </Animated.View>
        </Animated.View>
      )}

      {/* ── Skip ── */}
      <Animated.View style={[styles.skipWrap, { opacity: still ? a.stageOpacity : mode === 'video' ? a.skipFade : a.badgeSkip }]}>
        <TouchableOpacity
          style={[styles.skipBtn, onLight ? styles.skipBtnLight : styles.skipBtnDark]}
          onPress={skip}
          activeOpacity={0.75}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Skip intro"
        >
          <Text style={[styles.skipText, onLight ? styles.skipTextLight : styles.skipTextDark]}>Skip</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tapHint: { position: 'absolute', left: 0, right: 0, bottom: '16%', alignItems: 'center', zIndex: 5 },
  tapHintText: { color: 'rgba(255,255,255,0.72)', fontSize: 14, letterSpacing: 0.6 },
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
  stage: {
    backgroundColor: STAGE,
  },
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  hidden: { opacity: 0 },
  badgeStage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The glow is centred on the badge by flexbox (no offsets from a stale width).
  centreLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
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
    borderWidth: 1,
  },
  // On the white stage: the badge's navy.
  skipBtnLight: { backgroundColor: 'rgba(15,57,96,0.05)', borderColor: 'rgba(15,57,96,0.22)' },
  // On the dark background (fallback badge, reduce motion).
  skipBtnDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(250,224,75,0.35)' },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  skipTextLight: { color: '#0F3960' },
  skipTextDark: { color: '#F4E48E' },
});
