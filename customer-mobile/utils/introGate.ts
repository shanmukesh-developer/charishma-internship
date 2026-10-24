import { useEffect, useState } from 'react';

// The launch intro and the first screen behind it used to compete for the UI thread: measured on a Vivo V2439,
// Home's first render (lists, cards, image decodes) froze the intro for up to 0.6 s at a time. Heavy screens read
// useIntroDone() and draw their full content only after the intro has finished; their data still loads meanwhile.

let done = false;
const listeners = new Set<() => void>();

/** Called by IntroOverlay when it has fully left the screen (also on skip and on reduce motion). */
export function markIntroDone() {
  if (done) return;
  done = true;
  listeners.forEach((fn) => { try { fn(); } catch { /* listener gone */ } });
  listeners.clear();
}

export function isIntroDone() {
  return done;
}

/** True once the launch intro has finished (always true after the first launch of this JS session). */
export function useIntroDone(): boolean {
  const [isDone, setIsDone] = useState(done);
  useEffect(() => {
    if (done) { setIsDone(true); return; }
    const fn = () => setIsDone(true);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return isDone;
}
