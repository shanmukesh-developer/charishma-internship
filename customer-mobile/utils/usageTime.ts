// ============================================================================================================
//  CLOSED-TEST ONLY: app usage time (owner, 6 Nov 2026). Temporary: switched off from Admin > Active testers and the
//  data deleted when ZenWe reaches production. To remove it later: delete this file and its one line in
//  app/_layout.tsx (plus getUsageTrackingFlag in utils/forceUpdate.ts). Server side: backend/utils/usageTime.js.
// ============================================================================================================
//
// While the app is in the foreground and a customer is signed in, POST /api/users/usage-heartbeat { seconds } about
// every 60 s with the foreground seconds since the last beat, and once more ({ final: true }) when the app goes to the
// background with the last partial minute.
//   - Only when the server's switch is on: the usageTracking flag of GET /api/config/app-version (already called on
//     launch and every resume by utils/UpdateGate). Unknown (no answer yet) or off = nothing is sent. A beat answered
//     { enabled: false } also stops beats until the next version check says on.
//   - Never when signed out (no token), never on web.
//   - Offline / failed beats: the unsent seconds are carried into the next beat, capped at 75 s (the server credits at
//     most 75 s per beat and never more than real time since its last beat, so longer gaps are not claimable anyway).
//   - Fire-and-forget: never awaited by UI, every error swallowed, no retries through a server cold start.
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { apiFetch, getToken } from './auth';
import { getUsageTrackingFlag } from './forceUpdate';

const BEAT_MS = 60 * 1000;
const MAX_CARRY_S = 75;
const MIN_FINAL_S = 2;

let started = false;
let activeSince: number | null = null; // ms when the current foreground stretch (since the last beat) began
let carry = 0; // seconds not delivered yet
let timer: ReturnType<typeof setInterval> | null = null;
let serverSaysOff = false;
let lastFlag: boolean | null = null;
let sending = false;

const enabled = (): boolean => {
  const flag = getUsageTrackingFlag();
  if (flag !== lastFlag) { lastFlag = flag; if (flag === true) serverSaysOff = false; }
  return flag === true && !serverSaysOff;
};

/** Moves the foreground time since `activeSince` into `carry` (capped). */
const collect = (now: number) => {
  if (activeSince !== null) {
    const s = Math.max(0, Math.round((now - activeSince) / 1000));
    carry = Math.min(MAX_CARRY_S, carry + s);
    activeSince = now;
  }
};

const send = async (final: boolean) => {
  if (sending) return;
  if (!enabled()) { carry = 0; return; }
  const seconds = Math.min(MAX_CARRY_S, carry);
  if (seconds <= 0 || (final && seconds < MIN_FINAL_S)) return;
  sending = true;
  try {
    const token = await getToken();
    if (!token) { carry = 0; return; } // signed out: nothing is recorded or kept
    const res = await apiFetch('/api/users/usage-heartbeat', {
      method: 'POST',
      body: JSON.stringify(final ? { seconds, final: true } : { seconds }),
      noWakeRetry: true,
    });
    if (res.ok) {
      carry = Math.max(0, carry - seconds);
      try {
        const body = await res.json();
        if (body && body.enabled === false) { serverSaysOff = true; carry = 0; }
      } catch { /* not JSON: fine */ }
    } else if (res.status === 400 || res.status === 401 || res.status === 403) {
      carry = 0; // not for this account / app: drop it
    }
    // 429 / 5xx: keep the carry for the next beat
  } catch {
    // offline: keep the carry (capped) for the next beat
  } finally {
    sending = false;
  }
};

const tick = () => {
  collect(Date.now());
  send(false).catch(() => {});
};

const onActive = () => {
  activeSince = Date.now();
  if (!timer) timer = setInterval(tick, BEAT_MS);
};

const onBackground = () => {
  if (timer) { clearInterval(timer); timer = null; }
  collect(Date.now());
  activeSince = null;
  send(true).catch(() => {});
};

const onChange = (next: AppStateStatus) => {
  try {
    if (next === 'active') onActive();
    else if (next === 'background') onBackground();
    // 'inactive' (iOS app switcher / notification shade) keeps counting until 'background'.
  } catch { /* never crash the app */ }
};

/** Starts the usage-time heartbeats once per app process (native only). Safe to call more than once. */
export function startUsageTime(): void {
  if (started || Platform.OS === 'web') return;
  started = true;
  try {
    AppState.addEventListener('change', onChange);
    if ((AppState.currentState || 'active') === 'active') onActive();
  } catch { /* never crash the app */ }
}
