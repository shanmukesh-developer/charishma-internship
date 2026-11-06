// In-app updates (Google Play In-App Updates API) on top of the force-update policy (utils/forceUpdate.ts).
//
//   • Server says this version is below the minimum ('blocked'): Play's IMMEDIATE full-screen update flow is
//     started inside the app. If the student cancels it, the existing "Update required" screen (UpdateGate)
//     stays, and its Update button opens the Play listing as before.
//   • Otherwise, when Play reports a newer version: a small banner "A new version of ZenWe is ready"
//     [Update] [Later]. Update = FLEXIBLE download in the background (progress in the banner), then
//     "Update downloaded · Restart" -> completeUpdate() (Play installs it and reopens the app).
//     Later hides it until the next check window.
//   • Play is asked at most once every 6 hours (on start and on return to the foreground; the time is
//     persisted). Exceptions: a download that was started is always re-checked (to offer Restart), the
//     blocked case always asks, and when the server announces a newer version than this one (e.g. after the
//     "update available" push) a stale "no update" answer is re-checked after 15 minutes.
//   • No Play API (sideloaded APK, emulator without Play, iOS, web): nothing here shows; UpdateGate keeps
//     today's behaviour (soft banner / blocked screen that open the Play listing). Every native failure is
//     swallowed.
//   • While Play works, UpdateGate's own soft banner (which only opens the listing) is marked dismissed for
//     that version so the student never sees two banners (UpdateGate.tsx/forceUpdate.ts are shared by all
//     five apps and stay unchanged).
import { AppState, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import {
  compareVersions,
  dismissSoftPrompt,
  getClientInfo,
  getUpdateState,
  storeLinks,
  subscribeUpdateState,
  type UpdateState,
} from './forceUpdate';
import { getInAppUpdateNative, type PlayInstallState, type PlayUpdateInfo } from '../modules/zenwe-in-app-update';

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STALE_RECHECK_MS = 15 * 60 * 1000;
const IMMEDIATE_RETRY_MS = 60 * 1000;
const STORE_KEY = 'zenwe_in_app_update_v2';

export type InAppPhase = 'idle' | 'available' | 'starting' | 'downloading' | 'downloaded' | 'installing' | 'failed';

export type InAppUpdateState = {
  /** null = not known yet, false = no Play API on this install (fallback to the store listing). */
  supported: boolean | null;
  phase: InAppPhase;
  /** versionCode Play offers (0 when unknown). */
  versionCode: number;
  /** 0..1 while downloading, null when Play gives no size yet. */
  progress: number | null;
  /** "Later" pressed: hidden until the next check window. */
  hidden: boolean;
};

type Persisted = {
  lastCheckAt: number;
  apiOk: boolean | null;
  available: boolean;
  versionCode: number;
  /** A flexible download was accepted: re-check on every start until it is installed. */
  flexStarted: boolean;
  /** "Later" pressed at this time. */
  laterAt: number;
};

const EMPTY: Persisted = { lastCheckAt: 0, apiOk: null, available: false, versionCode: 0, flexStarted: false, laterAt: 0 };

let persisted: Persisted = { ...EMPTY };
let state: InAppUpdateState = { supported: null, phase: 'idle', versionCode: 0, progress: null, hidden: false };
const listeners = new Set<() => void>();
let initialised = false;
let loaded: Promise<void> | null = null;
let checking: Promise<void> | null = null;
let immediateRunning = false;
let lastImmediateAt = 0;

/** Read through a function: TypeScript would otherwise keep the narrowed phase across awaits. */
const phaseNow = (): InAppPhase => state.phase;
const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

function setState(patch: Partial<InAppUpdateState>) {
  const next = { ...state, ...patch };
  if (
    next.supported === state.supported && next.phase === state.phase && next.versionCode === state.versionCode &&
    next.progress === state.progress && next.hidden === state.hidden
  ) return;
  state = next;
  emit();
}

const isHidden = (p: Persisted) => p.laterAt > 0 && Date.now() - p.laterAt < CHECK_INTERVAL_MS;

async function save(patch: Partial<Persisted>) {
  persisted = { ...persisted, ...patch };
  try { await AsyncStorage.setItem(STORE_KEY, JSON.stringify(persisted)); } catch { /* storage unavailable */ }
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        const p = raw ? JSON.parse(raw) : null;
        if (p && typeof p === 'object') {
          persisted = {
            lastCheckAt: Number(p.lastCheckAt) || 0,
            apiOk: typeof p.apiOk === 'boolean' ? p.apiOk : null,
            available: p.available === true,
            versionCode: Number(p.versionCode) || 0,
            flexStarted: p.flexStarted === true,
            laterAt: Number(p.laterAt) || 0,
          };
        }
      } catch { /* keep defaults */ }
    })();
  }
  return loaded;
}

/** Play works here: UpdateGate's listing-only soft banner is redundant for this version. */
function suppressStoreSoftBanner(s: UpdateState = getUpdateState()) {
  if (persisted.apiOk !== true) return;
  if (s.status === 'soft' && s.policy && s.policy.latestVersion) dismissSoftPrompt(s.policy.latestVersion).catch(() => {});
}

function applyInfo(info: PlayUpdateInfo) {
  const progress = info.totalBytes > 0 ? Math.min(1, info.bytesDownloaded / info.totalBytes) : null;
  let phase: InAppPhase = 'idle';
  if (info.installStatus === 'downloaded') phase = 'downloaded';
  else if (info.installStatus === 'installing') phase = 'installing';
  else if (info.installStatus === 'downloading' || info.installStatus === 'pending') phase = 'downloading';
  else if (info.available && info.flexibleAllowed) phase = 'available';
  // A phase the student is in the middle of (Play's consent dialog) is not overwritten by a check.
  if (state.phase === 'starting' && phase === 'available') phase = 'starting';
  setState({ supported: true, phase, versionCode: info.versionCode || 0, progress, hidden: isHidden(persisted) });
}

async function askPlay(): Promise<PlayUpdateInfo | null> {
  const native = getInAppUpdateNative();
  if (!native) return null;
  try {
    const info = await native.checkForUpdate();
    if (!info || typeof info !== 'object') throw new Error('no info');
    // A sideloaded / emulator APK: Play answers "no update" instead of failing, so it is treated as no Play API
    // (UpdateGate's store-link banner keeps working there).
    if (info.installedFromPlay !== true) throw new Error('not installed from Play');
    const stillDownloading = info.installStatus === 'downloading' || info.installStatus === 'pending' || info.installStatus === 'downloaded' || info.installStatus === 'installing';
    await save({
      lastCheckAt: Date.now(),
      apiOk: true,
      available: !!info.available && !!info.flexibleAllowed,
      versionCode: info.versionCode || 0,
      flexStarted: persisted.flexStarted && stillDownloading,
      // A new check window: "Later" no longer applies.
      laterAt: isHidden(persisted) ? persisted.laterAt : 0,
    });
    applyInfo(info);
    suppressStoreSoftBanner();
    return info;
  } catch {
    // Not installed from Play / no Play Store / Play error: fall back to UpdateGate's store link.
    await save({ lastCheckAt: Date.now(), apiOk: false, available: false, versionCode: 0, flexStarted: false });
    setState({ supported: false, phase: 'idle', progress: null });
    return null;
  }
}

/** Server announces a version newer than this install. */
function serverHasNewer(s: UpdateState = getUpdateState()): boolean {
  const client = getClientInfo();
  const latest = s.policy ? s.policy.latestVersion : null;
  return !!client && !!client.version && !!latest && (compareVersions(client.version, latest) ?? 0) < 0;
}

/** Throttled check (6 h), see the header for the exceptions. */
export function checkInAppUpdate(force = false): Promise<void> {
  if (!getInAppUpdateNative()) {
    setState({ supported: false });
    return Promise.resolve();
  }
  if (checking) return checking;
  checking = (async () => {
    try {
      await load();
      const age = Date.now() - persisted.lastCheckAt;
      const due =
        force ||
        age >= CHECK_INTERVAL_MS ||
        persisted.flexStarted ||
        (persisted.apiOk === true && !persisted.available && serverHasNewer() && age >= STALE_RECHECK_MS);
      if (due) {
        await askPlay();
      } else if (persisted.apiOk === false) {
        setState({ supported: false, phase: 'idle' });
      } else if (persisted.apiOk === true) {
        // Inside the window: show what Play said last time (the download state comes from the events).
        if (state.phase === 'idle' || state.phase === 'available') {
          setState({
            supported: true,
            phase: persisted.available ? 'available' : 'idle',
            versionCode: persisted.versionCode,
            hidden: isHidden(persisted),
          });
        }
        suppressStoreSoftBanner();
      }
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** Below the server minimum: Play's full-screen immediate flow (UpdateGate's screen stays behind it). */
async function runImmediate(fromResume: boolean) {
  const native = getInAppUpdateNative();
  if (!native || immediateRunning) return;
  immediateRunning = true;
  try {
    await load();
    const info = await askPlay();
    if (!info || !info.immediateAllowed || !(info.available || info.inProgress)) return;
    // After a cancel, don't throw the student straight back into Play on every resume (they could not
    // leave): a resume re-opens it only for an interrupted download, or after a minute.
    if (fromResume && !info.inProgress && Date.now() - lastImmediateAt < IMMEDIATE_RETRY_MS) return;
    lastImmediateAt = Date.now();
    await native.startImmediate();
  } catch {
    /* the blocked screen stays: its Update button opens the Play listing */
  } finally {
    immediateRunning = false;
  }
}

function onInstallState(s: PlayInstallState) {
  if (!s || typeof s !== 'object') return;
  const progress = s.totalBytes > 0 ? Math.min(1, s.bytesDownloaded / s.totalBytes) : null;
  switch (s.status) {
    case 'pending':
    case 'downloading':
      // "Hide" during the download is respected; "Update downloaded" shows again below.
      setState({ supported: true, phase: 'downloading', progress });
      break;
    case 'downloaded':
      setState({ supported: true, phase: 'downloaded', progress: 1, hidden: false });
      break;
    case 'installing':
      setState({ phase: 'installing' });
      break;
    case 'installed':
      save({ flexStarted: false, available: false }).catch(() => {});
      setState({ phase: 'idle', progress: null });
      break;
    case 'failed':
      save({ flexStarted: false }).catch(() => {});
      setState({ phase: 'failed', progress: null, hidden: false });
      break;
    case 'canceled':
      save({ flexStarted: false }).catch(() => {});
      setState({ phase: persisted.available ? 'available' : 'idle', progress: null });
      break;
    default:
      break;
  }
}

/** Opens the Play listing (the pre-in-app behaviour). */
export async function openStoreListing(): Promise<boolean> {
  const client = getClientInfo();
  const s = getUpdateState();
  const links = storeLinks(s.policy ? s.policy.storeUrl : null, client ? client.packageId : 'com.srm.hostelbites', true);
  for (const url of links) {
    try {
      await Linking.openURL(url);
      return true;
    } catch { /* next link */ }
  }
  return false;
}

/** Banner "Update": FLEXIBLE download in the background. */
export async function startFlexibleUpdate(): Promise<void> {
  const native = getInAppUpdateNative();
  if (!native) { await openStoreListing(); return; }
  if (state.phase === 'starting' || state.phase === 'downloading') return;
  setState({ phase: 'starting', hidden: false });
  try {
    const result = await native.startFlexible();
    if (result === 'accepted') {
      await save({ flexStarted: true });
      if (phaseNow() === 'starting') setState({ phase: 'downloading', progress: null });
    } else if (result === 'canceled') {
      if (phaseNow() === 'starting') setState({ phase: 'available' });
    } else {
      // Play could not start it (no longer allowed, no activity): use the listing instead.
      if (phaseNow() === 'starting') setState({ phase: 'available' });
      await openStoreListing();
    }
  } catch {
    if (phaseNow() === 'starting') setState({ phase: 'available' });
    await openStoreListing();
  }
}

/** Banner "Restart": installs the downloaded update (Play restarts ZenWe). */
export async function completeInAppUpdate(): Promise<void> {
  const native = getInAppUpdateNative();
  if (!native) return;
  setState({ phase: 'installing' });
  try {
    await native.completeUpdate();
  } catch {
    setState({ phase: 'failed' });
  }
}

/** Banner "Later": hidden until the next check window. */
export function hideInAppUpdateBanner() {
  save({ laterAt: Date.now() }).catch(() => {});
  setState({ hidden: true });
}

/** The "ZenWe update available" push was tapped: ask Play now and show the banner even after "Later". */
export function onUpdatePushOpened() {
  if (!getInAppUpdateNative()) return;
  save({ laterAt: 0 }).catch(() => {});
  setState({ hidden: false });
  if (getUpdateState().status === 'blocked') runImmediate(false);
  else checkInAppUpdate(true);
}

/** Call once at startup. Android with the native module only; elsewhere it marks itself unsupported. */
export function initInAppUpdates(): void {
  if (initialised) return;
  initialised = true;
  const native = getInAppUpdateNative();
  if (!native) {
    state = { ...state, supported: false };
    return;
  }
  try {
    native.addListener('onInstallState', onInstallState);
  } catch { /* events unavailable: the next check still reports the state */ }
  load().then(() => {
    if (persisted.apiOk === false) setState({ supported: false });
    checkInAppUpdate(false);
  });
  let lastStatus = getUpdateState().status;
  subscribeUpdateState((s) => {
    const was = lastStatus;
    lastStatus = s.status;
    if (s.status === 'blocked' && was !== 'blocked') { runImmediate(false); return; }
    suppressStoreSoftBanner(s);
    // A newer server version than Play reported last: re-check (throttled to 15 min).
    if (s.status !== 'blocked' && serverHasNewer(s)) checkInAppUpdate(false);
  });
  if (getUpdateState().status === 'blocked') runImmediate(false);
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    if (getUpdateState().status === 'blocked') runImmediate(true);
    else checkInAppUpdate(false);
  });
}

export function getInAppUpdateState(): InAppUpdateState {
  return state;
}

export function subscribeInAppUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useInAppUpdate(): InAppUpdateState {
  return useSyncExternalStore(subscribeInAppUpdate, getInAppUpdateState, getInAppUpdateState);
}
