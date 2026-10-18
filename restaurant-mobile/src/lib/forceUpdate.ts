// Force update (C3): lets the owner retire broken / insecure app versions after a store release.
// Same file in all five Zenvy apps (backend/tests/c3 checks they stay identical). How it works:
//   • Every API call carries X-App-Name / X-App-Version / X-App-Build (versionHeaders(), plus a fetch hook
//     for calls that bypass the app's HTTP client) and the socket handshake carries appName / appVersion /
//     appBuild (socketVersionAuth()). Web builds and builds whose version is unknown send nothing.
//   • On launch and on every resume the app asks GET /api/config/app-version?app=<key>:
//       below minSupportedVersion (or a build below minSupportedBuild) -> 'blocked' (full-screen Update screen)
//       below latestVersion with softPromptEnabled                    -> 'soft' (dismissible banner, once per version)
//   • Any API answer 426 { code: 'UPGRADE_REQUIRED' } (or a socket refusal with that code) also -> 'blocked'.
//   • Version compare is numeric per part (1.0.10 > 1.0.9); "-beta" / "+build" suffixes are ignored.
// No React Native imports at the top: native modules are loaded lazily and every failure is swallowed, so
// this file also runs under plain Node (tests).

export type AppKey = 'customer' | 'rider' | 'restaurant' | 'vendor' | 'autodriver';
export type ClientInfo = { app: AppKey; version: string | null; build: number | null; packageId: string | null };
export type VersionPolicy = {
  app: AppKey;
  appName: string;
  minSupportedVersion: string | null;
  latestVersion: string | null;
  minSupportedBuild: number | null;
  storeUrl: string | null;
  message: string;
  softPromptEnabled: boolean;
};
export type UpdateStatus = 'ok' | 'soft' | 'blocked';
export type UpdateState = { status: UpdateStatus; policy: VersionPolicy | null; checkedAt: number | null };
export type FetchFn = (input: any, init?: any) => Promise<any>;

export const APP_KEYS: AppKey[] = ['customer', 'rider', 'restaurant', 'vendor', 'autodriver'];
export const DEFAULT_UPDATE_MESSAGE = 'This version of the app is no longer supported. Please update to keep using Zenvy.';
const DISMISS_KEY_PREFIX = 'zenvy_update_prompt_dismissed_';
const CHECK_TIMEOUT_MS = 10000;

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** "1.2.3" / "v1.2" / "1.2.3-beta.1+45" -> [1, 2, 3]; anything else -> null. */
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  const m = /^\s*v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:[-+][0-9A-Za-z.+-]*)?\s*$/.exec(v.slice(0, 64));
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/** -1 / 0 / 1 (numeric per part), or null when either side is not a version. */
export function compareVersions(a: unknown, b: unknown): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

const toBuild = (b: unknown): number | null => {
  const n = typeof b === 'number' ? b : typeof b === 'string' && /^\d{1,10}$/.test(b.trim()) ? Number(b.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 2100000000 ? n : null;
};

/** Same decision as the server (backend/utils/appVersionPolicy.js evaluate). Unknown version = never blocked. */
export function evaluatePolicy(policy: VersionPolicy | null, client: ClientInfo | null): UpdateStatus {
  if (!policy || !client || !client.version || !parseVersion(client.version)) return 'ok';
  if (policy.minSupportedVersion && (compareVersions(client.version, policy.minSupportedVersion) ?? 0) < 0) return 'blocked';
  if (policy.minSupportedBuild && client.build !== null && client.build < policy.minSupportedBuild) return 'blocked';
  if (policy.softPromptEnabled && policy.latestVersion && (compareVersions(client.version, policy.latestVersion) ?? 0) < 0) return 'soft';
  return 'ok';
}

/** Reads GET /api/config/app-version answers and 426 UPGRADE_REQUIRED bodies alike. */
export function policyFromBody(body: any, fallbackApp: AppKey | null = null): VersionPolicy | null {
  if (!body || typeof body !== 'object') return null;
  const app = APP_KEYS.includes(body.app) ? (body.app as AppKey) : fallbackApp;
  if (!app) return null;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  return {
    app,
    appName: str(body.appName) || 'Zenvy',
    minSupportedVersion: parseVersion(body.minSupportedVersion) ? String(body.minSupportedVersion) : null,
    latestVersion: parseVersion(body.latestVersion) ? String(body.latestVersion) : null,
    minSupportedBuild: toBuild(body.minSupportedBuild),
    storeUrl: str(body.storeUrl),
    message: str(body.message) || DEFAULT_UPDATE_MESSAGE,
    softPromptEnabled: body.softPromptEnabled === true,
  };
}

export function isUpgradeRequiredBody(body: any): boolean {
  return !!body && typeof body === 'object' && body.code === 'UPGRADE_REQUIRED';
}

/**
 * Where the Update button goes: on Android a Play Store web link becomes market://details?id=… first
 * (opens the Play Store app), with the https link as the fallback.
 */
export function storeLinks(storeUrl: string | null, packageId: string | null, isAndroid: boolean): string[] {
  const out: string[] = [];
  let id: string | null = null;
  const url = storeUrl && /^(https:\/\/|market:\/\/)/i.test(storeUrl) ? storeUrl : null;
  if (url) {
    const m = /[?&]id=([A-Za-z0-9_.]+)/.exec(url);
    if (m && (/^market:/i.test(url) || /play\.google\.com/i.test(url))) id = m[1];
  }
  if (!url && packageId && /^[A-Za-z0-9_.]+$/.test(packageId)) id = packageId;
  if (isAndroid && id) out.push(`market://details?id=${id}`);
  if (url && !/^market:/i.test(url)) out.push(url);
  else if (id) out.push(`https://play.google.com/store/apps/details?id=${id}`);
  return Array.from(new Set(out));
}

export function versionHeadersFor(client: ClientInfo | null): Record<string, string> {
  if (!client || !client.version) return {};
  const h: Record<string, string> = { 'X-App-Name': client.app, 'X-App-Version': client.version };
  if (client.build !== null) h['X-App-Build'] = String(client.build);
  return h;
}

export function socketAuthFor(client: ClientInfo | null): Record<string, string> {
  if (!client || !client.version) return {};
  const a: Record<string, string> = { appName: client.app, appVersion: client.version };
  if (client.build !== null) a.appBuild = String(client.build);
  return a;
}

const originOf = (base: string): string | null => {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(String(base || '').trim());
  return m ? m[1].toLowerCase() : null;
};

// ─── Runtime state ───────────────────────────────────────────────────────────

let client: ClientInfo | null = null;
let apiOrigin: string | null = null;
let state: UpdateState = { status: 'ok', policy: null, checkedAt: null };
const listeners = new Set<(s: UpdateState) => void>();
let checking: Promise<UpdateState> | null = null;
let baseFetch: FetchFn | null = null;

const setState = (next: UpdateState) => {
  const changed = next.status !== state.status || JSON.stringify(next.policy) !== JSON.stringify(state.policy);
  state = next;
  if (changed) listeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });
};

export const getClientInfo = (): ClientInfo | null => client;
export const getUpdateState = (): UpdateState => state;
export function subscribeUpdateState(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
/** Headers for this app's API calls ({} on web / unknown version). */
export const versionHeaders = (): Record<string, string> => versionHeadersFor(client);
/** Fields to merge into the socket.io handshake `auth` ({} on web / unknown version). */
export const socketVersionAuth = (): Record<string, string> => socketAuthFor(client);
export const getApiOrigin = (): string | null => apiOrigin;

/** A 426 body (or socket refusal data) -> blocked screen. Returns true when it was an upgrade refusal. */
export function reportUpgradeRequired(body: any): boolean {
  if (!isUpgradeRequiredBody(body) || !client) return false;
  const policy = policyFromBody(body, client.app) || policyFromBody({ app: client.app }, client.app);
  setState({ status: 'blocked', policy, checkedAt: state.checkedAt });
  return true;
}

/** A socket.io connect_error: true when the server refused this version. */
export function reportSocketError(err: any): boolean {
  const data = err && typeof err === 'object' ? err.data : null;
  return reportUpgradeRequired(data);
}

/**
 * Wraps fetch: calls to the Zenvy API get the version headers (unless already set), and a 426
 * UPGRADE_REQUIRED answer flips the app to the blocked screen. Other URLs pass through untouched.
 */
export function wrapFetch(fetchFn: FetchFn): FetchFn {
  const wrapped: any = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input && typeof input.href === 'string' ? input.href : null;
    const isApi = !!url && !!apiOrigin && url.toLowerCase().startsWith(`${apiOrigin}/`);
    let nextInit = init;
    if (isApi) {
      const extra = versionHeaders();
      if (Object.keys(extra).length) {
        const given = init && init.headers;
        if (given && typeof given.set === 'function' && typeof given.has === 'function') {
          for (const [k, v] of Object.entries(extra)) if (!given.has(k)) given.set(k, v);
        } else if (Array.isArray(given)) {
          const have = new Set(given.map((p: any) => String(p[0]).toLowerCase()));
          nextInit = { ...init, headers: [...given, ...Object.entries(extra).filter(([k]) => !have.has(k.toLowerCase()))] };
        } else {
          const obj = (given && typeof given === 'object' ? given : {}) as Record<string, string>;
          const have = new Set(Object.keys(obj).map((k) => k.toLowerCase()));
          const add = Object.fromEntries(Object.entries(extra).filter(([k]) => !have.has(k.toLowerCase())));
          nextInit = { ...(init || {}), headers: { ...obj, ...add } };
        }
      }
    }
    const res = await fetchFn(input, nextInit);
    if (isApi && res && res.status === 426 && typeof res.clone === 'function') {
      try { reportUpgradeRequired(await res.clone().json()); } catch { /* not JSON */ }
    }
    return res;
  };
  wrapped.__zenvyForceUpdate = true;
  return wrapped as FetchFn;
}

/** Installs wrapFetch on the global fetch once (no-op when already installed or there is no fetch). */
export function installFetchHook(target: any = globalThis): boolean {
  if (!target || typeof target.fetch !== 'function' || target.fetch.__zenvyForceUpdate) return false;
  const original = target.fetch.bind(target);
  baseFetch = original;
  target.fetch = wrapFetch(original);
  return true;
}

/** Version / build / package of the installed binary (expo-application, else expo-constants). null on web. */
export function readNativeClientInfo(app: AppKey): ClientInfo | null {
  let os: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    os = require('react-native').Platform.OS;
  } catch { os = null; }
  if (!os || os === 'web') return null;
  let version: string | null = null;
  let build: number | null = null;
  let packageId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const A = require('expo-application');
    version = parseVersion(A.nativeApplicationVersion) ? String(A.nativeApplicationVersion) : null;
    build = toBuild(A.nativeBuildVersion);
    packageId = typeof A.applicationId === 'string' ? A.applicationId : null;
  } catch { /* native module missing: use the embedded app config */ }
  if (!version || build === null || !packageId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('expo-constants');
      const C = (mod && (mod.default || mod)) || {};
      const cfg = C.expoConfig || {};
      if (!version && parseVersion(cfg.version)) version = String(cfg.version);
      if (build === null) build = toBuild(os === 'ios' ? cfg.ios && cfg.ios.buildNumber : cfg.android && cfg.android.versionCode);
      if (!packageId) packageId = (os === 'ios' ? cfg.ios && cfg.ios.bundleIdentifier : cfg.android && cfg.android.package) || null;
    } catch { /* unknown */ }
  }
  return { app, version, build, packageId };
}

/**
 * Called once at startup (config module). `info` overrides what is read from the native app (tests).
 * Web / unknown version: nothing is sent and nothing is ever blocked.
 */
export function configureForceUpdate(opts: { app: AppKey; apiBase: string; info?: ClientInfo | null; hookFetch?: boolean }): ClientInfo | null {
  apiOrigin = originOf(opts.apiBase);
  client = opts.info !== undefined ? opts.info : readNativeClientInfo(opts.app);
  if (client && client.version && opts.hookFetch !== false) installFetchHook();
  return client;
}

/**
 * GET /api/config/app-version?app=<key> -> new state. Network / server trouble keeps the current state
 * (a phone that is offline is never blocked by this check). Concurrent calls share one request.
 */
export function checkForUpdate(opts: { fetchImpl?: FetchFn } = {}): Promise<UpdateState> {
  if (!client || !client.version || !apiOrigin) return Promise.resolve(state);
  if (checking) return checking;
  const f: FetchFn | null = opts.fetchImpl || baseFetch || (typeof fetch === 'function' ? fetch : null);
  if (!f) return Promise.resolve(state);
  const c = client;
  const url = `${apiOrigin}/api/config/app-version?app=${encodeURIComponent(c.app)}`;
  checking = (async () => {
    let timer: any = null;
    try {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      if (ctrl) timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
      const res = await f(url, { method: 'GET', headers: { Accept: 'application/json', ...versionHeadersFor(c) }, signal: ctrl ? ctrl.signal : undefined });
      if (!res || !res.ok) return state;
      const body = await res.json();
      const policy = policyFromBody(body, c.app);
      if (!policy) return state;
      setState({ status: evaluatePolicy(policy, c), policy, checkedAt: Date.now() });
      return state;
    } catch {
      return state;
    } finally {
      if (timer) clearTimeout(timer);
      checking = null;
    }
  })();
  return checking;
}

// ─── Soft prompt: dismissed once per latest version ──────────────────────────

const storage = (): any => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    return (mod && (mod.default || mod)) || null;
  } catch {
    return null;
  }
};

export async function isSoftPromptDismissed(latestVersion: string | null): Promise<boolean> {
  if (!client || !latestVersion) return false;
  try {
    const s = storage();
    return !!s && (await s.getItem(`${DISMISS_KEY_PREFIX}${client.app}`)) === latestVersion;
  } catch {
    return false;
  }
}

export async function dismissSoftPrompt(latestVersion: string | null): Promise<void> {
  if (!client || !latestVersion) return;
  try {
    const s = storage();
    if (s) await s.setItem(`${DISMISS_KEY_PREFIX}${client.app}`, latestVersion);
  } catch { /* ignore */ }
}

/** Tests only. */
export function resetForceUpdateForTests(): void {
  client = null;
  apiOrigin = null;
  state = { status: 'ok', policy: null, checkedAt: null };
  listeners.clear();
  checking = null;
  baseFetch = null;
}
