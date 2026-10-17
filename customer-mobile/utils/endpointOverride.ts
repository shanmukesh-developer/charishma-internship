// Remote API address override: lets the backend move to its own domain (api.<domain>) without a store update.
// Same file in all five Zenvy apps (docs/INFRA_SWITCHOVER.md). Rules:
//   • The app starts on its built-in address (or the saved override from an earlier launch).
//   • A few seconds after start it asks GET <current>/api/config/endpoints. The backend answers
//     { apiBaseUrl, socketUrl } only when PUBLIC_API_URL is set (else nulls: nothing changes).
//   • A new address is accepted only if it is https, host-only, and its host is on the trusted list baked
//     into the app (built-in host + app.json extra.trustedApiHosts + EXPO_PUBLIC_TRUSTED_API_HOSTS; a
//     "*.example.com" entry trusts subdomains). It must answer /livez AND advertise itself from its own
//     /api/config/endpoints. Only then is it saved — and used from the NEXT launch (never mid-session).
//   • Self-heal: if a saved address stops answering /livez while the built-in one answers, the override is
//     deleted (next launch = built-in). If neither answers the phone is offline: nothing is changed.
//     The backend advertising nothing / the built-in address also deletes the override (owner rollback).
//   • A developer build pointed elsewhere (EXPO_PUBLIC_API_URL) never uses or changes the override.
// No React Native imports at the top: storage / config modules are loaded lazily and every failure is
// swallowed, so this file also runs under plain Node.

export type EndpointSource = 'dev' | 'built-in' | 'remote';
export type ActiveEndpoint = { api: string; socket: string; source: EndpointSource };
export type EndpointStore = { get(): string | null; set(value: string): void; remove(): void };
export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export type RefreshAction =
  | 'skip-dev' | 'none' | 'saved' | 'reverted' | 'cleared' | 'offline' | 'no-answer' | 'untrusted' | 'candidate-down' | 'candidate-mismatch';
export type RefreshResult = { action: RefreshAction; api?: string };

export const ENDPOINT_STORE_KEY = 'zenvy_api_endpoint_v1';

const stripSlash = (s: string) => s.trim().replace(/\/+$/, '');

/** Exact host match, or "*.example.com" = any subdomain of example.com (not the apex itself). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = String(host || '').toLowerCase();
  const p = String(pattern || '').trim().toLowerCase();
  if (!h || !p) return false;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return !!base && h.length > base.length + 1 && h.endsWith(`.${base}`);
  }
  return h === p;
}

/** 'https://host' for an https, host-only URL (no port, path, query or credentials), else null. */
export function parseHttpsBase(raw: unknown): { base: string; host: string } | null {
  if (typeof raw !== 'string') return null;
  const v = stripSlash(raw);
  const m = /^https:\/\/([a-z0-9.-]+)$/i.exec(v);
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('..') || host.startsWith('-')) return null;
  return { base: `https://${host}`, host };
}

/** The base when it is https, host-only and trusted; else null. */
export function trustedBase(raw: unknown, trusted: string[]): string | null {
  const p = parseHttpsBase(raw);
  if (!p) return null;
  return trusted.some((t) => hostMatches(p.host, t)) ? p.base : null;
}

/** Built-in host + every list given (arrays or comma strings), lower-cased, de-duplicated. */
export function trustedHostsFrom(builtIn: string, ...lists: Array<string | string[] | null | undefined>): string[] {
  const out: string[] = [];
  const add = (h: string) => {
    const v = String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (v && !out.includes(v)) out.push(v);
  };
  const b = /^https?:\/\/([^/:]+)/i.exec(String(builtIn || ''));
  if (b) add(b[1]);
  for (const l of lists) {
    if (!l) continue;
    (Array.isArray(l) ? l : String(l).split(',')).forEach((x) => add(String(x)));
  }
  return out;
}

/** app.json "extra": { "trustedApiHosts": [...] } (expo-constants), [] when unavailable. */
export function readExtraTrustedHosts(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-constants');
    const C = (mod && (mod.default || mod)) || {};
    const list = C.expoConfig && C.expoConfig.extra && C.expoConfig.extra.trustedApiHosts;
    return Array.isArray(list) ? list.filter((x: unknown) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** expo-secure-store (synchronous reads, so the address is known before any module builds a URL). */
export function secureEndpointStore(key: string = ENDPOINT_STORE_KEY): EndpointStore {
  const ss = (): any => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('expo-secure-store');
    } catch {
      return null;
    }
  };
  return {
    get() {
      try { const s = ss(); return s && typeof s.getItem === 'function' ? s.getItem(key) : null; } catch { return null; }
    },
    set(value: string) {
      try { const s = ss(); if (s && typeof s.setItem === 'function') s.setItem(key, value); } catch { /* ignore */ }
    },
    remove() {
      try { const s = ss(); if (s && typeof s.deleteItemAsync === 'function') s.deleteItemAsync(key).catch(() => {}); } catch { /* ignore */ }
    },
  };
}

/** Saved override → { api, socket } when it is still valid and trusted, else null. */
export function parseSaved(raw: string | null, trusted: string[]): { api: string; socket: string } | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    const api = trustedBase(j && j.api, trusted);
    if (!api) return null;
    const socket = trustedBase(j && j.socket, trusted) || api;
    return { api, socket };
  } catch {
    return null;
  }
}

/** Synchronous: which address this launch uses. */
export function resolveEndpoint(opts: { builtIn: string; devOverride?: string | null; trusted: string[]; store?: EndpointStore }): ActiveEndpoint {
  const builtIn = stripSlash(opts.builtIn);
  const dev = stripSlash(String(opts.devOverride || ''));
  if (dev) return { api: dev, socket: dev, source: 'dev' };
  let saved: { api: string; socket: string } | null = null;
  try { saved = parseSaved((opts.store || secureEndpointStore()).get(), opts.trusted); } catch { saved = null; }
  if (saved && saved.api !== builtIn) return { api: saved.api, socket: saved.socket, source: 'remote' };
  return { api: builtIn, socket: builtIn, source: 'built-in' };
}

const defaultFetch = (): FetchLike | null => (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : null);

async function getJson(f: FetchLike, url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: any } | null> {
  let timer: any = null;
  let controller: any = null;
  try {
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => { try { if (controller) controller.abort(); } catch { /* ignore */ } resolve(null); }, timeoutMs);
    });
    const req = (async () => {
      const res = await f(url, { method: 'GET', headers: { Accept: 'application/json' }, ...(controller ? { signal: controller.signal } : {}) });
      let body: any = null;
      try { body = await res.json(); } catch { body = null; }
      return { ok: !!res.ok, status: Number(res.status) || 0, body };
    })();
    return await Promise.race([req, timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function alive(f: FetchLike, base: string, timeoutMs: number): Promise<boolean> {
  const r = await getJson(f, `${base}/livez`, timeoutMs);
  return !!(r && r.ok && r.body && r.body.status === 'alive');
}

/**
 * Asks the backend where the API lives and saves a verified, trusted new address for the next launch
 * (or removes a broken / withdrawn one). Never throws; never changes the address of the running session.
 */
export async function refreshEndpointOverride(opts: {
  builtIn: string;
  active: ActiveEndpoint;
  trusted: string[];
  store?: EndpointStore;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<RefreshResult> {
  try {
    if (opts.active.source === 'dev') return { action: 'skip-dev' };
    const f = opts.fetchImpl || defaultFetch();
    if (!f) return { action: 'no-answer' };
    const store = opts.store || secureEndpointStore();
    const t = opts.timeoutMs || 8000;
    const builtIn = stripSlash(opts.builtIn);
    const saved = parseSaved(store.get(), opts.trusted);

    // 1. Self-heal: the saved address no longer answers but the built-in one does → forget it.
    let base = opts.active.api;
    if (opts.active.source === 'remote' && !(await alive(f, base, t))) {
      if (await alive(f, builtIn, t)) {
        store.remove();
        return { action: 'reverted' };
      }
      return { action: 'offline' };
    }

    // 2. Where does the backend say the API lives?
    const r = await getJson(f, `${base}/api/config/endpoints`, t);
    if (!r || !r.ok || !r.body || typeof r.body !== 'object') return { action: 'no-answer' };
    const advertised = r.body.apiBaseUrl;
    if (advertised === null || advertised === undefined || advertised === '' || stripSlash(String(advertised)) === builtIn) {
      if (saved) { store.remove(); return { action: 'cleared' }; }
      return { action: 'none' };
    }
    const candidate = trustedBase(advertised, opts.trusted);
    if (!candidate) return { action: 'untrusted' };
    const socket = trustedBase(r.body.socketUrl, opts.trusted) || candidate;
    if (saved && saved.api === candidate && saved.socket === socket) return { action: 'none' };

    // 3. Verify the new address really is this backend before saving it.
    if (!(await alive(f, candidate, t))) return { action: 'candidate-down' };
    const r2 = await getJson(f, `${candidate}/api/config/endpoints`, t);
    if (!r2 || !r2.ok || !r2.body || stripSlash(String(r2.body.apiBaseUrl || '')) !== candidate) return { action: 'candidate-mismatch' };
    store.set(JSON.stringify({ api: candidate, socket, savedAt: Date.now() }));
    return { action: 'saved', api: candidate };
  } catch {
    return { action: 'no-answer' };
  }
}
