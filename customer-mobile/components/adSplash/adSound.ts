// Ad splash sounds + haptics. Paper, foil and glass each have their own rustle (three takes, picked at
// random), plus the reveal chime and the closing whoosh (assets/sounds/ad, synthesized from the design's
// Web Audio recipes). Like every app sound they follow Profile > App sounds and the phone's silent mode.
// Players live only while the ad is on screen and are released when it closes: on Android every
// expo-audio player owns a MediaSession, and one left alive shows an "Unknown song" card (utils/sounds.ts).
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { getSoundsEnabled } from '../../utils/sounds';

export type RustleKind = 'paper' | 'foil' | 'glass';

const FILES = {
  paper: [require('../../assets/sounds/ad/rustle_paper_1.wav'), require('../../assets/sounds/ad/rustle_paper_2.wav'), require('../../assets/sounds/ad/rustle_paper_3.wav')],
  foil: [require('../../assets/sounds/ad/rustle_foil_1.wav'), require('../../assets/sounds/ad/rustle_foil_2.wav'), require('../../assets/sounds/ad/rustle_foil_3.wav')],
  glass: [require('../../assets/sounds/ad/rustle_glass_1.wav'), require('../../assets/sounds/ad/rustle_glass_2.wav'), require('../../assets/sounds/ad/rustle_glass_3.wav')],
  chime: require('../../assets/sounds/ad/chime.wav'),
  whoosh: require('../../assets/sounds/ad/whoosh.wav'),
};

export type AdSound = {
  rustle: (kind: RustleKind, power?: number) => void;
  chime: () => void;
  whoosh: () => void;
  tick: () => void; // the design's navigator.vibrate(14)
  release: () => void;
};

const noop = () => {};

/** One sound set per ad on screen. Silent (but haptics still on) when App sounds are off or on web. */
export function createAdSound(): AdSound {
  const tick = () => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(noop); };
  if (Platform.OS === 'web' || !getSoundsEnabled()) return { rustle: noop, chime: noop, whoosh: noop, tick, release: noop };

  let createAudioPlayer: any = null;
  try { ({ createAudioPlayer } = require('expo-audio')); } catch { /* audio unavailable */ }
  const players = new Map<any, any>();
  let released = false;
  let lastRustle = 0;
  const play = (src: any, volume: number) => {
    if (released || !createAudioPlayer) return;
    try {
      let p = players.get(src);
      if (!p) { p = createAudioPlayer(src); players.set(src, p); }
      p.volume = volume;
      p.seekTo?.(0);
      p.play();
    } catch { /* never break the ad for a sound */ }
  };
  return {
    rustle(kind, power = 1) {
      const now = Date.now();
      if (now - lastRustle < 55) return; // the design's 55 ms gap between rustles
      lastRustle = now;
      const takes = FILES[kind];
      play(takes[Math.floor(Math.random() * takes.length)], Math.min(1, 0.3 + 0.25 * Math.max(0.4, power)));
    },
    chime() { play(FILES.chime, 0.9); },
    whoosh() { play(FILES.whoosh, 0.9); },
    tick,
    release() {
      if (released) return;
      released = true;
      for (const p of players.values()) {
        try { p.pause?.(); } catch { /* stopped */ }
        try { p.remove?.(); } catch { /* removed */ }
        try { p.release?.(); } catch { /* released */ }
      }
      players.clear();
    },
  };
}
