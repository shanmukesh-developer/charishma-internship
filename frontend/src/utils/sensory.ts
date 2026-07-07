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