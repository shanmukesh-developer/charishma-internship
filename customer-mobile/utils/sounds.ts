import { Platform } from 'react-native';

// ── Zenvy Sound Engine ─────────────────────────────────────────────────────
// Generates synthetic sounds using Web Audio API (web) and expo-av (native).
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
  | 'click';

// ── Native Sound Engine (expo-av with URL caching) ──
const NATIVE_SOUND_URLS: Record<SoundType, string> = {
  click: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav',
  addToCart: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-84.wav',
  tabSwitch: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-84.wav',
  success: 'https://assets.mixkit.co/active_storage/sfx/2017/2017-84.wav',
  error: 'https://assets.mixkit.co/active_storage/sfx/2573/2573-84.wav',
  worldTransition: 'https://assets.mixkit.co/active_storage/sfx/2018/2018-84.wav',
  pgTransition: 'https://assets.mixkit.co/active_storage/sfx/1917/1917-84.wav', // Deep homelike chord
  rideTransition: 'https://assets.mixkit.co/active_storage/sfx/2813/2813-84.wav', // Energetic motorcycle rev-like swish
  premiumRestaurantTransition: 'https://assets.mixkit.co/active_storage/sfx/2013/2013-84.wav', // High luxury bell/chime
  brandSplash: 'https://assets.mixkit.co/active_storage/sfx/2017/2017-84.wav',
};

const soundCache: Record<string, any> = {};

async function playNativeSound(type: SoundType) {
  // Disabled native audio temporarily to prevent crashes on Android devices
  return;
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
};

// ── Public API ──
export function playSound(type: SoundType): void {
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

// Resume AudioContext after user interaction (browser requirement)
export function resumeAudio(): void {
  if (Platform.OS === 'web') {
    const ctx = getAudioContext();
    if (ctx?.state === 'suspended') {
      ctx.resume();
    }
  }
}
