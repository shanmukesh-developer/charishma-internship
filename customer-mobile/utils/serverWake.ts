// Cold-start tolerance for the shared fetch layer (utils/auth.ts apiFetch).
//
// After a backend restart Render answers 502 (its own HTML page) and then our server answers
// 503 SERVER_STARTING for 2 to 3 minutes. Safe requests (GETs, and calls marked idempotent) are
// retried with backoff for up to WAKE_WINDOW_MS while a calm "Zenvy is waking up" banner is shown
// (components/ServerWakeBanner.tsx). Non-idempotent POSTs are never retried here.
import { useSyncExternalStore } from 'react';

export const WAKE_WINDOW_MS = 180000;
const BACKOFF_MS = [2000, 4000, 6000, 8000, 10000];
const MAX_WAIT_MS = 15000;

// ── Global "server is waking up" state ─────────────────────────────────────────
let wakingCount = 0;
let lastOkAt = 0;
let lastNetworkFailAt = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => { try { cb(); } catch {} });

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const getWaking = () => wakingCount > 0;

export const isServerWaking = getWaking;
/** True while at least one request is waiting for the server to finish starting. */
export const useServerWaking = (): boolean => useSyncExternalStore(subscribe, getWaking, getWaking);

const beginWaiting = () => { wakingCount += 1; if (wakingCount === 1) emit(); };
const endWaiting = () => { wakingCount = Math.max(0, wakingCount - 1); if (wakingCount === 0) emit(); };

/** Any response from the server (even an error) proves the device is online. */
export const noteServerResponse = () => { lastOkAt = Date.now(); };
/** A request that got no response at all (offline, DNS, timeout). */
export const noteNetworkFailure = () => { lastNetworkFailAt = Date.now(); };
export const lastServerResponseAt = () => lastOkAt;
export const lastNetworkFailureAt = () => lastNetworkFailAt;

// ── Retry decision ─────────────────────────────────────────────────────────────
/**
 * Whether a response means "the server is still starting": 503 SERVER_STARTING, or a 502/503/504
 * whose body is not our JSON (Render's proxy page). App-level 5xx JSON errors are real answers.
 * Returns the server's suggested wait in ms (or 0 when none), or null when it is not a cold start.
 */
export const coldStartWait = async (res: Response): Promise<number | null> => {
  if (res.status !== 502 && res.status !== 503 && res.status !== 504) return null;
  let body: any = null;
  try { body = await res.clone().json(); } catch { body = null; }
  if (body && typeof body === 'object') {
    const code = String(body.code || '');
    if (code !== 'SERVER_STARTING' && code !== 'STARTING') return null;
    const after = Number(body.retryAfter);
    return Number.isFinite(after) && after > 0 ? after * 1000 : 0;
  }
  const header = Number(res.headers?.get?.('retry-after'));
  return Number.isFinite(header) && header > 0 ? header * 1000 : 0;
};

const isCallerAbort = (signal?: AbortSignal | null) => !!signal?.aborted;
// With no response at all (and no cold-start answer seen yet) the device may simply be offline:
// give up sooner so the screen can show its offline / cached state.
const NETWORK_ONLY_WINDOW_MS = 45000;

const sleep = (ms: number, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); return; }
  const t = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); };
  signal?.addEventListener?.('abort', onAbort, { once: true } as any);
});

/**
 * Runs `attempt` and, while the server is cold-starting (or unreachable), retries it with backoff
 * for up to WAKE_WINDOW_MS. The last response (or error) is returned (or thrown) when the window ends.
 */
export const withWakeRetry = async (
  attempt: () => Promise<Response>,
  signal?: AbortSignal | null,
  windowMs: number = WAKE_WINDOW_MS,
): Promise<Response> => {
  const started = Date.now();
  let tries = 0;
  let waiting = false;
  let sawColdStart = false;
  try {
    for (;;) {
      let res: Response | null = null;
      let error: any = null;
      try {
        res = await attempt();
      } catch (e: any) {
        if (isCallerAbort(signal)) throw e;
        error = e;
      }
      let wait: number | null;
      if (res) {
        noteServerResponse();
        wait = await coldStartWait(res);
        if (wait === null) return res;
        sawColdStart = true;
      } else {
        noteNetworkFailure();
        wait = 0;
      }
      const elapsed = Date.now() - started;
      const backoff = BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)];
      const delay = Math.min(MAX_WAIT_MS, Math.max(backoff, wait || 0));
      const limit = sawColdStart ? windowMs : Math.min(windowMs, NETWORK_ONLY_WINDOW_MS);
      if (elapsed + delay > limit) {
        if (res) return res;
        throw error;
      }
      // The banner says "waking up" only once the server (or Render) actually answered so; plain
      // no-answer retries (maybe offline) stay quiet.
      if (!waiting && sawColdStart) { waiting = true; beginWaiting(); }
      tries += 1;
      await sleep(delay, signal);
    }
  } finally {
    if (waiting) endWaiting();
  }
};
