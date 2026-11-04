import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appSoundsTurnedOff } from '../../utils/sounds';

// The intro's sound: the soundtrack of the owner's intro clip (4 Nov 2026), the same AAC audio copied out of
// assets/zenv-intro-delivery-rider-2026-11-04.mp4 without re-encoding (3.35 s, 48 kHz stereo). The clip itself always
// plays muted; this player gives it its sound, started in the same frame as the clip's first frame, so every rule
// below still applies. It starts with the clip on a cold start and stays silent when:
//   - the phone's ringer is on silent or vibrate (expo-audio playsInSilentMode: false checks the ringer mode),
//   - the student switched Profile > App sounds off themselves (the switch's untouched default does not count),
//   - the admins switched it off (Admin > Settings > Switches > Intro sound): kept from the last
//     GET /api/config/sections answer, because the intro plays before the network answers.
// It never takes audio focus from music. The player is released as soon as the sound ends, the intro is skipped or the
// app leaves the foreground: on Android every expo-audio player owns a MediaSession, and one left alive shows an
// "Unknown song" card (utils/sounds.ts).
const FILE = require('../../assets/sounds/intro/zenv-intro-delivery-rider-sound-2026-11-04.aac');
const LENGTH_MS = 3350;
const VOLUME = 0.8;
const LATE_LIMIT_S = 1; // ready later than this after the clip started: stay silent rather than play out of step
const REMOTE_KEY = 'zcs_intro_sound_remote_v1';

/** Home calls this with the admins' switch (GET /api/config/sections introSound.on); used from the next start. */
export function rememberIntroSoundSetting(on: boolean): void {
  AsyncStorage.setItem(REMOTE_KEY, on ? '1' : '0').catch(() => {});
}

async function allowed(): Promise<boolean> {
  try {
    const [off, remote] = await Promise.all([appSoundsTurnedOff(), AsyncStorage.getItem(REMOTE_KEY)]);
    return !off && remote !== '0';
  } catch {
    return true;
  }
}

export type IntroSound = {
  /** The choreography started now (call once, in the same frame). */
  start: () => void;
  /** Stop now, or fade out over fadeMs (skip), and free the player. Safe to call more than once. */
  stop: (fadeMs?: number) => void;
};

/** Prepares the player at once (so it is loaded when the clip starts); plays only after start(). */
export function createIntroSound(): IntroSound {
  let player: any = null;
  let done = false;
  let playing = false;
  let startedAt = 0;
  let sub: any = null;
  let appSub: any = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeTimer: ReturnType<typeof setInterval> | null = null;

  const release = () => {
    if (done) return;
    done = true;
    if (endTimer) clearTimeout(endTimer);
    if (fadeTimer) clearInterval(fadeTimer);
    try { sub?.remove?.(); } catch { /* gone */ }
    try { appSub?.remove?.(); } catch { /* gone */ }
    try { player?.pause?.(); } catch { /* stopped */ }
    try { player?.remove?.(); } catch { /* removed */ }
    try { player?.release?.(); } catch { /* released */ }
    player = null;
  };

  const begin = () => {
    if (done || !player || playing || !startedAt) return;
    // The app left the foreground before the player was ready: no sound (the background listener was not set yet).
    if (AppState.currentState && AppState.currentState !== 'active') { release(); return; }
    const late = (Date.now() - startedAt) / 1000;
    if (late > LATE_LIMIT_S) { release(); return; }
    try {
      if (late > 0.05) player.seekTo?.(late);
      player.play();
      playing = true;
      endTimer = setTimeout(release, LENGTH_MS - late * 1000 + 600);
    } catch {
      release();
    }
  };

  (async () => {
    if (!(await allowed()) || done) return;
    try {
      const audio = require('expo-audio');
      if (Platform.OS !== 'web') {
        // Respect silent / vibrate and never take audio focus (the same mode as every app sound).
        await audio.setAudioModeAsync?.({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
      }
      if (done || !audio.createAudioPlayer) return;
      player = audio.createAudioPlayer(FILE);
      player.volume = VOLUME;
      sub = player.addListener?.('playbackStatusUpdate', (s: any) => { if (s?.didJustFinish) release(); });
      appSub = AppState.addEventListener('change', (st) => { if (st !== 'active') release(); });
      begin();
    } catch {
      release();
    }
  })();

  return {
    start() {
      if (startedAt || done) return;
      startedAt = Date.now();
      begin();
    },
    stop(fadeMs = 0) {
      if (done) return;
      if (!playing || !player || fadeMs <= 0) { release(); return; }
      if (fadeTimer) return; // already fading (a second tap on Skip)
      const steps = 6;
      const v0 = typeof player.volume === 'number' ? player.volume : VOLUME;
      let i = 0;
      fadeTimer = setInterval(() => {
        i += 1;
        try { if (player) player.volume = v0 * Math.max(0, 1 - i / steps); } catch { /* ignore */ }
        if (i >= steps) release();
      }, Math.max(16, Math.round(fadeMs / steps)));
    },
  };
}
