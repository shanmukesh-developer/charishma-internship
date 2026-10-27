// Cold-start tolerance for GET requests (the same rule as the customer app's utils/serverWake.ts).
//
// After a backend restart Render answers 502 (its own HTML page) and then the server answers
// 503 SERVER_STARTING for 2 to 3 minutes. GETs are retried with backoff for up to WAKE_WINDOW_MS while
// a calm "Zenvy is waking up" banner shows (WakeBanner). Writes (POST / PUT / DELETE) are never retried.
import { useSyncExternalStore } from 'react';

export const WAKE_WINDOW_MS = 180000;
/** With no answer at all (and no cold-start answer seen) the phone may just be offline: stop sooner. */
const NETWORK_ONLY_WINDOW_MS = 45000;
const BACKOFF_MS = [2000, 4000, 6000, 8000, 10000];
const MAX_WAIT_MS = 15000;

let wakingCount = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => { try { cb(); } catch { /* listener error */ } });
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getWaking = () => wakingCount > 0;

export const isServerWaking = getWaking;
/** True while at least one GET is waiting for the server to finish starting. */
export const useServerWaking = (): boolean => useSyncExternalStore(subscribe, getWaking, getWaking);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The verdict on one failed attempt: `{ wait }` (ms, 0 = use the backoff) when it is a cold start or
 * no answer at all, `{ wait, network: true }` for no answer, or null for a real error (thrown at once).
 */
export type WakeVerdict = { wait: number; network?: boolean } | null;

/** Runs `attempt`, retrying while `classify` says the server is still starting (up to ~3 minutes). */
export async function withWakeRetry<T>(attempt: () => Promise<T>, classify: (err: unknown) => WakeVerdict): Promise<T> {
  const started = Date.now();
  let tries = 0;
  let waiting = false;
  let sawColdStart = false;
  try {
    for (;;) {
      try {
        return await attempt();
      } catch (err) {
        const verdict = classify(err);
        if (!verdict) throw err;
        if (!verdict.network) sawColdStart = true;
        const backoff = BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)];
        const delay = Math.min(MAX_WAIT_MS, Math.max(backoff, verdict.wait || 0));
        const limit = sawColdStart ? WAKE_WINDOW_MS : NETWORK_ONLY_WINDOW_MS;
        if (Date.now() - started + delay > limit) throw err;
        // "Waking up" only once the server said so; no-answer retries (maybe offline) stay quiet.
        if (!waiting && sawColdStart) { waiting = true; wakingCount += 1; if (wakingCount === 1) emit(); }
        tries += 1;
        await sleep(delay);
      }
    }
  } finally {
    if (waiting) { wakingCount = Math.max(0, wakingCount - 1); if (wakingCount === 0) emit(); }
  }
}

/** Cold-start test for an HTTP answer: 503 SERVER_STARTING, or 502/503/504 that is not our JSON. */
export function coldStartWait(status: number, data: any): number | null {
  if (status !== 502 && status !== 503 && status !== 504) return null;
  if (data && typeof data === 'object') {
    const code = String(data.code || '');
    if (code !== 'SERVER_STARTING' && code !== 'STARTING') return null;
    const after = Number(data.retryAfter);
    return Number.isFinite(after) && after > 0 ? after * 1000 : 0;
  }
  return 0;
}
