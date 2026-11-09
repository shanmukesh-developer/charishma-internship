import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── App sounds switch ─────────────────────────────────────────────────────
// Every UI sound (taps, tab switches, add to basket, sign-in success, transitions) goes through
// playSound(), which stays silent unless the user turned "App sounds" on in Profile (off by default).
// On a phone with the ringer on silent or vibrate, native sounds are suppressed as well
// (expo-audio playsInSilentMode: false checks the Android ringer mode / the iOS silent switch).
const SOUNDS_KEY = 'zenvy_app_sounds_v1';
let soundsEnabled = false;
let settingLoaded = false;
const soundListeners = new Set<(on: boolean) => void>();

export function getSoundsEnabled(): boolean {
  return soundsEnabled;
}

/** Reads the saved switch (call once at startup). Off when nothing was saved or storage fails. */
export async function loadSoundSetting(): Promise<boolean> {
  try {
    soundsEnabled = (await AsyncStorage.getItem(SOUNDS_KEY)) === '1';
  } catch {
    soundsEnabled = false;
  }
  settingLoaded = true;
  soundListeners.forEach((cb) => { try { cb(soundsEnabled); } catch {} });
  return soundsEnabled;
}

export async function setSoundsEnabled(on: boolean): Promise<void> {
  soundsEnabled = on;
  settingLoaded = true;
  soundListeners.forEach((cb) => { try { cb(on); } catch {} });
  try { await AsyncStorage.setItem(SOUNDS_KEY, on ? '1' : '0'); } catch { /* kept in memory for this run */ }
  if (on) preloadSounds();
}

/**
 * True only when the student switched App sounds off themselves. The intro sound (components/intro/introSound) plays
 * by default, so the switch's untouched default (nothing saved) does not silence it; an explicit "off" does.
 */
export async function appSoundsTurnedOff(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SOUNDS_KEY)) === '0';
  } catch {
    return false;
  }
}

export function onSoundSettingChange(cb: (on: boolean) => void): () => void {
  soundListeners.add(cb);
  return () => { soundListeners.delete(cb); };
}

let audioModeSet = false;
function ensureQuietAudioMode(): void {
  if (audioModeSet || Platform.OS === 'web') return;
  audioModeSet = true;
  try {
    const { setAudioModeAsync } = require('expo-audio');
    // Respect silent / vibrate, and never take audio focus from music the user is playing.
    setAudioModeAsync?.({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })?.catch?.(() => {});
  } catch { /* audio unavailable: playSound stays a no-op */ }
}

// ── Zenvy Sound Engine ─────────────────────────────────────────────────────
// Generates synthetic sounds using Web Audio API (web); native plays bundled WAVs via expo-audio.
// Supports distinct custom transition chimes for PG, Co-Ride, and Premium Restaurants.

export type SoundType = 
  | 'worldTransition' 
  | 'pgTransition' 
  | 'rideTransition' 
  | 'premiumRestaurantTransition'
  | 'brandSplash' 
  | 'tabSwitch' 
  | 'addToCart' 
  | 'success' 
  | 'error' 
  | 'click'
  | 'vegMode';

// ── Native Sound Engine (expo-audio, bundled local files: no network) ──
// Tiny WAVs synthesized from the same tone recipes as the web sounds below
// (scratch script: node gen_sounds.js assets/sounds). They ship inside the app bundle.
const NATIVE_SOUND_FILES: Record<SoundType, number> = {
  click: require('../assets/sounds/click.wav'),
  addToCart: require('../assets/sounds/addToCart.wav'),
  tabSwitch: require('../assets/sounds/tabSwitch.wav'),
  success: require('../assets/sounds/success.wav'),
  error: require('../assets/sounds/error.wav'),
  worldTransition: require('../assets/sounds/worldTransition.wav'),
  pgTransition: require('../assets/sounds/pgTransition.wav'),
  rideTransition: require('../assets/sounds/rideTransition.wav'),
  premiumRestaurantTransition: require('../assets/sounds/premiumRestaurantTransition.wav'),
  brandSplash: require('../assets/sounds/success.wav'),
  vegMode: require('../assets/sounds/vegMode.wav'),
};

const lastPlayTime: Record<string, number> = {};
const SOUND_THROTTLE_MS = 100;
// A player is released this long after play() even if no "finished" event arrives (every bundled
// sound is under 2 s).
const PLAYER_MAX_LIFE_MS = 2500;

// One short-lived player per sound. expo-audio's Android player opens a MediaSession for every player,
// and while that session lives Android 13+ shows an "Unknown song / Unknown artist" media card in the
// notification shade. On Android player.remove() only drops the player from the module's list: the
// native player and its MediaSession are freed by release() (SharedObject; AudioPlayer.releasePlayer
// -> mediaSession.release()). So each player is paused, removed AND released as soon as the sound
// finishes, on any error, or after PLAYER_MAX_LIFE_MS. (28 Oct 2026: `dumpsys media_session` on the
// owner's phone showed com.srm.hostelbites holding an active session left over from a 0.7 s sound.)
function playOnce(type: SoundType): void {
  const { createAudioPlayer } = require('expo-audio');
  if (!createAudioPlayer) return;
  let player: any = null;
  let sub: any = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (timer) clearTimeout(timer);
    try { sub?.remove?.(); } catch { /* already gone */ }
    try { player?.pause?.(); } catch { /* already stopped */ }
    try { player?.remove?.(); } catch { /* already removed */ }
    try { player?.release?.(); } catch { /* already released */ }
    player = null;
  };
  try {
    player = createAudioPlayer(NATIVE_SOUND_FILES[type]);
    if (!player) return;
    player.volume = type === 'click' ? 0.3 : 0.8;
    sub = player.addListener?.('playbackStatusUpdate', (status: any) => {
      if (status?.didJustFinish) release();
    });
    timer = setTimeout(release, PLAYER_MAX_LIFE_MS);
    player.play();
  } catch {
    release();
  }
}

/**
 * Sets the quiet audio mode (respect silent / vibrate, never take audio focus) once sounds are on.
 * Players are no longer created ahead of time (see playOnce). Safe to call more than once.
 */
export function preloadSounds(): void {
  if (Platform.OS === 'web' || !soundsEnabled) return;
  ensureQuietAudioMode();
}

async function playNativeSound(type: SoundType) {
  try {
    // Throttle rapid-fire sounds to prevent audio driver overload
    const now = Date.now();
    if (lastPlayTime[type] && now - lastPlayTime[type] < SOUND_THROTTLE_MS) return;
    lastPlayTime[type] = now;

    ensureQuietAudioMode();
    playOnce(type);
  } catch (err) {
    // Fail silently in background to prevent native crashes
    console.warn('[SOUND_ERROR] Failed to play native sound safely:', err);
  }
}

// ── Web Audio Context (singleton) ──
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (Platform.OS !== 'web') return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

// ── Oscillator Tone Generator (Web only) ──
function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.15,
  delay: number = 0,
  fadeOut: number = 0.1
) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const startTime = ctx.currentTime + delay;
  const endTime = startTime + duration;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, endTime);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.onended = () => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      // Intentionally suppressed: safe to ignore if audio nodes were already disconnected
    }
  };

  osc.start(startTime);
  osc.stop(endTime + fadeOut);
}

// ── Chord (multiple tones, Web only) ──
function playChord(
  frequencies: number[],
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.08,
  delay: number = 0
) {
  frequencies.forEach(f => playTone(f, duration, type, volume, delay));
}

// ── Web Sound Definitions ──
const WEB_SOUNDS: Record<SoundType, () => void> = {
  worldTransition: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.35;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(2500, now + 0.2);
    filter.Q.value = 2.5;

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.4);

    playTone(523.25, 0.25, 'sine', 0.1, 0.05);   // C5
    playTone(659.25, 0.2, 'sine', 0.08, 0.12);    // E5
    playTone(783.99, 0.3, 'sine', 0.06, 0.2);     // G5
  },

  pgTransition: () => {
    // Ambient cozy chord transition
    playChord([196.00, 246.94, 293.66, 392.00], 0.6, 'sine', 0.08); // G Major Chord
    playTone(493.88, 0.5, 'sine', 0.05, 0.2); // B4
  },

  rideTransition: () => {
    // motorcycle-like rising pitch synthesizer swoosh
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(350, now + 0.4);
    
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  },

  premiumRestaurantTransition: () => {
    // luxury bell chimes
    playTone(987.77, 0.4, 'sine', 0.08, 0);       // B5
    playTone(1174.66, 0.3, 'sine', 0.06, 0.08);   // D6
    playTone(1318.51, 0.5, 'sine', 0.05, 0.16);   // E6
  },

  brandSplash: () => {
    playChord([261.63, 329.63, 392.0], 0.8, 'sine', 0.06);
    playChord([523.25, 659.25, 783.99], 0.6, 'sine', 0.04, 0.3);
    playTone(1046.5, 0.5, 'sine', 0.03, 0.6);
  },

  tabSwitch: () => {
    playTone(880, 0.06, 'sine', 0.08);
    playTone(1100, 0.04, 'sine', 0.05, 0.03);
  },

  addToCart: () => {
    playTone(440, 0.08, 'sine', 0.1);
    playTone(660, 0.06, 'triangle', 0.08, 0.05);
    playTone(880, 0.1, 'sine', 0.06, 0.08);
  },

  success: () => {
    playTone(523.25, 0.15, 'sine', 0.1);
    playTone(659.25, 0.15, 'sine', 0.08, 0.1);
    playTone(783.99, 0.15, 'sine', 0.08, 0.2);
    playTone(1046.5, 0.3, 'sine', 0.06, 0.3);
  },

  error: () => {
    playTone(220, 0.15, 'square', 0.06);
    playTone(185, 0.2, 'square', 0.05, 0.12);
  },

  click: () => {
    playTone(1200, 0.03, 'sine', 0.06);
  },

  // "Pure Veg" jingle (same notes as assets/sounds/vegMode.wav): soft pad + rising bell arpeggio.
  vegMode: () => {
    [261.63, 329.63, 392.0].forEach((f) => playTone(f, 1.1, 'sine', 0.035, 0, 0.6));
    [[523.25, 0], [659.25, 0.11], [783.99, 0.22], [1174.66, 0.33], [1046.5, 0.46]].forEach(([f, d]) => playTone(f, 0.9, 'sine', 0.09, d, 0.75));
    playTone(2093.0, 0.6, 'sine', 0.025, 0.52, 0.5);
  },
};

// ── Public API ──
export function playSound(type: SoundType): void {
  if (!soundsEnabled || !settingLoaded) return;
  try {
    if (Platform.OS === 'web') {
      resumeAudio();
      WEB_SOUNDS[type]?.();
    } else {
      playNativeSound(type);
    }
  } catch {
    // Silently fail if audio isn't available
  }
}

/**
 * Owner, 10 Nov 2026 ("while shifting to veg, add music"): a moment's own music plays even with App sounds off (the
 * default). The phone's silent mode still mutes it (audio mode never plays in silent mode).
 */
export function playMoment(type: SoundType): void {
  try {
    if (Platform.OS === 'web') {
      const ctx = getAudioContext();
      if (ctx?.state === 'suspended') ctx.resume();
      WEB_SOUNDS[type]?.();
    } else {
      playNativeSound(type);
    }
  } catch {
    // audio unavailable
  }
}

// Resume AudioContext after user interaction (browser requirement)
export function resumeAudio(): void {
  if (Platform.OS === 'web' && soundsEnabled) {
    const ctx = getAudioContext();
    if (ctx?.state === 'suspended') {
      ctx.resume();
    }
  }
}
