/**
 * Zenvy Sensory Engine
 * Provides premium micro-interactions (Audio & Haptics) to elevate UX.
 */

// Global AudioContext cache to avoid creating multiple instances
let audioCtx: AudioContext | null = null;

const initAudio = () => {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  return audioCtx;
};

/**
 * Triggers a subtle, premium 'pop' sound using the Web Audio API.
 * This requires zero external audio files and loads instantly.
 */
export const playPopSound = () => {
  try {
    const ctx = initAudio();
    if (!ctx) return;
    
    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Premium 'Pop' synthesis parameters
    osc.type = 'sine';
    
    // Start at high frequency, drop rapidly
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.05);

    // Very fast attack and decay for the volume envelope
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.06);
  } catch (e) {
    console.warn('SensoryEngine: Audio failed', e);
  }
};

/**
 * Triggers a light haptic vibration on supported mobile devices.
 */
export const triggerLightHaptic = () => {
  try {
    if (typeof window !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10); // 10ms micro-vibration
    }
  } catch (e) {
    // Ignore, device doesn't support vibration
  }
};

/**
 * Triggers both a sound and a vibration. Ideal for "Add to Cart" or primary actions.
 */
export const playSensoryFeedback = () => {
  triggerLightHaptic();
  playPopSound();
};

/**
 * Synthesizes a deep cinematic, luxury sub-bass swell and ascending golden chime chord.
 */
export const playKfcTakeoverSound = () => {
  try {
    const ctx = initAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // 1. Deep sub-bass swell
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(55, now); // A1
    subOsc.frequency.exponentialRampToValueAtTime(82.4, now + 1.2); // E2
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(0.45, now + 0.35);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 1.8);

    // 2. Ascending luxury chord (C Major / Golden ratio timing)
    const chordFreqs = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
    chordFreqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      
      const startTime = now + idx * 0.12;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.12); // gentle swell
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 1.5 - idx * 0.15); // long ring out
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 1.6);
    });

    // 3. Shimmer layer (High chime ring)
    const shimOsc = ctx.createOscillator();
    const shimGain = ctx.createGain();
    shimOsc.type = 'sine';
    shimOsc.frequency.setValueAtTime(1046.50, now + 0.48); // C6
    shimGain.gain.setValueAtTime(0, now);
    shimGain.gain.setValueAtTime(0, now + 0.48);
    shimGain.gain.linearRampToValueAtTime(0.08, now + 0.48 + 0.05);
    shimGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48 + 0.8);
    shimOsc.connect(shimGain);
    shimGain.connect(ctx.destination);
    shimOsc.start(now + 0.48);
    shimOsc.stop(now + 1.3);

  } catch (e) {
    console.warn('SensoryEngine: KFC audio failed', e);
  }
};

/**
 * Synthesizes a high-energy, card-flipping digital double chime.
 */
export const playDominosTakeoverSound = () => {
  try {
    const ctx = initAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // Rhythmic double flip sound
    const tones = [
      { delay: 0, fStart: 250, fEnd: 500, dur: 0.15 },
      { delay: 0.12, fStart: 375, fEnd: 750, dur: 0.15 },
      { delay: 0.24, fStart: 500, fEnd: 1000, dur: 0.25 }
    ];

    tones.forEach((tone) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(tone.fStart, now + tone.delay);
      osc.frequency.exponentialRampToValueAtTime(tone.fEnd, now + tone.delay + tone.dur);
      
      const startTime = now + tone.delay;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + tone.dur);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + tone.dur + 0.05);
    });
  } catch (e) {
    console.warn('SensoryEngine: Dominos audio failed', e);
  }
};

/**
 * Synthesizes a glowing neon buzz hum and McDonalds five-note chime.
 */
export const playMcdonaldsTakeoverSound = () => {
  try {
    const ctx = initAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // 1. Neon warm hum
    const humOsc = ctx.createOscillator();
    const humGain = ctx.createGain();
    humOsc.type = 'sawtooth';
    humOsc.frequency.setValueAtTime(110, now);
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 1.6);

    humGain.gain.setValueAtTime(0, now);
    humGain.gain.linearRampToValueAtTime(0.15, now + 0.2);
    humGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

    humOsc.connect(filter);
    filter.connect(humGain);
    humGain.connect(ctx.destination);
    humOsc.start(now);
    humOsc.stop(now + 1.8);

    // 2. Chime sequence (ba-da-ba-ba-ba)
    const notes = [
      { delay: 0.2, freq: 587.33, dur: 0.12 },  // D5
      { delay: 0.35, freq: 659.25, dur: 0.12 }, // E5
      { delay: 0.5, freq: 783.99, dur: 0.12 },  // G5
      { delay: 0.65, freq: 880.00, dur: 0.12 }, // A5
      { delay: 0.8, freq: 1174.66, dur: 0.4 }   // D6
    ];

    notes.forEach((note) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.delay);
      
      const startTime = now + note.delay;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + note.dur);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + note.dur + 0.05);
    });
  } catch (e) {
    console.warn('SensoryEngine: McDonalds audio failed', e);
  }
};

/**
 * Triggers the appropriate takeover transition audio based on the brand animation type.
 */
export const playTakeoverSound = (type: 'kfc-bucket-drop' | 'dominos-flip' | 'mcd-glow') => {
  if (type === 'kfc-bucket-drop') {
    playKfcTakeoverSound();
  } else if (type === 'dominos-flip') {
    playDominosTakeoverSound();
  } else if (type === 'mcd-glow') {
    playMcdonaldsTakeoverSound();
  } else {
    playSensoryFeedback();
  }
};