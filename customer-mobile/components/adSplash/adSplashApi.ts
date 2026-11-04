// Sponsored splash ads (owner design "Zenvy Ad Splash", 28 Oct 2026): one ad, full screen, right after the
// intro, once per app open. Ads are created by an admin from a real live store (GET /api/ads/splash returns
// every eligible ad, at most one per style). Each phone keeps its own shuffled order ("bag"): every ad is
// shown once before any repeats, and two phones opening at the same moment usually see different ads.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { API_URL } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import { onCollegeChange } from '../../utils/college';

export type SplashStyle = 'tear' | 'scratch' | 'envelope' | 'gift' | 'glass' | 'coupon' | 'portal' | 'peel';
export const SPLASH_STYLES: SplashStyle[] = ['tear', 'scratch', 'envelope', 'gift', 'glass', 'coupon', 'portal', 'peel'];

export type SplashProduct = { id: string; name: string; price: number; originalPrice: number | null; imageUrl: string | null };
export type SplashAd = {
  id: string;
  style: SplashStyle;
  offerText: string;
  headline: string; // may hold one line break
  subline: string;
  bannerText: string;
  imageUrl: string;
  colorA: string;
  colorB: string;
  store: { id: string; name: string; imageUrl?: string | null; cuisine?: string | null; rating?: number | null; isOpen?: boolean };
  products: SplashProduct[];
};

const BAG_KEY = 'zcs_adsplash_bag_v1';
const LAST_KEY = 'zcs_adsplash_last_v1';
const LIST_KEY = 'zcs_adsplash_list_v1';
// The ads list is per college (only stores serving it): the student changed college, so it is asked again.
onCollegeChange(() => { AsyncStorage.removeItem(LIST_KEY).catch(() => {}); });
// Photos that would not download / decode lately ({ url: when }): those ads are skipped for BAD_ART_MS instead of
// costing ~5 s each open (a deleted Unsplash photo answered slowly, the ad missed its moment and the open had none).
const BAD_ART_KEY = 'zcs_adsplash_badart_v1';
const BAD_ART_MS = 2 * 60 * 60 * 1000;
// The live ads list is kept on the phone so an app open does not wait on the server (the ad has only a moment
// after the intro): a non-empty list younger than this is used at once and refreshed in the background for the
// next open; an empty or older one is fetched fresh.
const LIST_FRESH_MS = 30 * 60 * 1000;

/** Absolute URL for an image path the backend returns (store photos may be /api/media/... paths). */
export function absoluteImage(u?: string | null): string | null {
  if (!u || typeof u !== 'string') return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return `${API_URL}${u}`;
  return null;
}

/**
 * The photo URL to decode for the ad. Store photos on Unsplash are originals (up to ~6000 px, 80+ MB once
 * decoded), which froze the web preview and wastes phone memory: ask Unsplash for a 1200 px JPEG instead
 * (the ad draws the photo at most ~1000 px wide on a large phone). Admin uploads are already capped at
 * 1600 px by the admin dashboard.
 */
export function artUrl(u?: string | null): string | null {
  const abs = absoluteImage(u);
  if (!abs) return null;
  try {
    const url = new URL(abs);
    if (/(^|\.)unsplash\.com$/i.test(url.hostname)) {
      url.searchParams.set('w', '1200');
      url.searchParams.set('q', '80');
      url.searchParams.set('fm', 'jpg');
      url.searchParams.delete('auto'); // auto=format could answer AVIF, which Skia cannot decode
      return url.toString();
    }
  } catch { /* not a URL: use it as is */ }
  return abs;
}

const isAd = (a: any): a is SplashAd =>
  !!a && typeof a.id === 'string' && SPLASH_STYLES.includes(a.style) && typeof a.offerText === 'string'
  && typeof a.headline === 'string' && !!absoluteImage(a.imageUrl) && !!a.store && typeof a.store.id === 'string';

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Picks the ad for this app open from the phone's shuffled bag of the ads that are live now. A new bag is
 * shuffled when the old one is empty (never starting with the ad shown last time, when there is a choice).
 */
async function pickFromBag(ads: SplashAd[]): Promise<SplashAd | null> {
  if (!ads.length) return null;
  const live = new Map(ads.map((a) => [a.id, a]));
  let bag: string[] = [];
  let last: string | null = null;
  try {
    const [b, l] = await Promise.all([AsyncStorage.getItem(BAG_KEY), AsyncStorage.getItem(LAST_KEY)]);
    bag = (JSON.parse(b || '[]') as string[]).filter((id) => live.has(id));
    last = l;
  } catch { bag = []; }
  if (!bag.length) {
    bag = shuffle([...live.keys()]);
    if (bag.length > 1 && bag[0] === last) bag.push(bag.shift() as string);
  }
  const id = bag.shift() as string;
  AsyncStorage.multiSet([[BAG_KEY, JSON.stringify(bag)], [LAST_KEY, id]]).catch(() => {});
  return live.get(id) || null;
}

async function fetchList(signal?: AbortSignal): Promise<SplashAd[] | null> {
  const res = await apiFetch(`${API_URL}/api/ads/splash`, signal ? { signal } : undefined);
  if (!res || !res.ok) return null;
  const data = await res.json();
  const ads = (Array.isArray(data?.ads) ? data.ads : []).filter(isAd) as SplashAd[];
  AsyncStorage.setItem(LIST_KEY, JSON.stringify({ at: Date.now(), ads })).catch(() => {});
  return ads;
}

async function cachedList(): Promise<{ at: number; ads: SplashAd[] } | null> {
  try {
    const c = JSON.parse((await AsyncStorage.getItem(LIST_KEY)) || 'null');
    if (!c || typeof c.at !== 'number' || !Array.isArray(c.ads)) return null;
    return { at: c.at, ads: c.ads.filter(isAd) };
  } catch { return null; }
}

let refreshed = false;

/** The ad to show on this app open (null = none live, offline, or any error: the app goes straight to Home). */
export async function loadSplashAd(signal?: AbortSignal): Promise<SplashAd | null> {
  try {
    const c = await cachedList();
    let ads: SplashAd[] | null;
    // An empty remembered list is never trusted: an ad published since must show on this very open (it used to
    // wait one more open because the phone remembered "no ads").
    if (c && c.ads.length && Date.now() - c.at < LIST_FRESH_MS) {
      ads = c.ads;
      // An ad switched off since is shown at most once more: the next open reads this refresh.
      if (!refreshed) { refreshed = true; fetchList().catch(() => {}); }
    } else {
      ads = await fetchList(signal);
      refreshed = true;
    }
    if (!ads) return null;
    // The photo itself is downloaded by AdSplashHost before the ad shows (a splash that paints in pieces
    // looks broken); an ad whose photo failed lately is left out of the rotation for now.
    const bad = await badArt();
    const usable = ads.filter((a) => !bad[artUrl(a.imageUrl) || '']);
    return await pickFromBag(usable);
  } catch {
    return null;
  }
}

/** An ad that was picked but never reached the screen (the intro ended before it was ready) is shown next time. */
export async function returnToBag(id: string): Promise<void> {
  try {
    const bag = JSON.parse((await AsyncStorage.getItem(BAG_KEY)) || '[]') as string[];
    await AsyncStorage.setItem(BAG_KEY, JSON.stringify([id, ...bag.filter((x) => x !== id)]));
  } catch { /* ignore */ }
}

function artFile(url: string): File | null {
  if (Platform.OS === 'web') return null;
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h * 33) ^ url.charCodeAt(i)) >>> 0;
  return new File(Paths.cache, 'adsplash', `${h.toString(36)}-${url.length}.jpg`);
}

/**
 * A URI for the ad photo that decodes without the network when possible: the phone's cached copy, else the
 * photo is downloaded into the cache first (so the next open of the same ad is instant). Web: the URL itself.
 */
export async function localArt(url: string): Promise<string> {
  const f = artFile(url);
  if (!f) return url;
  try {
    if (f.exists && f.size > 0) return f.uri;
    new Directory(Paths.cache, 'adsplash').create({ idempotent: true, intermediates: true });
    const out = await File.downloadFileAsync(url, f, { idempotent: true });
    return out.uri;
  } catch {
    return url;
  }
}

async function badArt(): Promise<Record<string, number>> {
  try {
    const all = JSON.parse((await AsyncStorage.getItem(BAD_ART_KEY)) || '{}') as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, at]) => now - Number(at) < BAD_ART_MS));
  } catch { return {}; }
}

/**
 * A photo that would not download or decode: its cached copy (a saved error page) is dropped, so a fixed photo is
 * fetched again, and its ad sits out of the rotation for BAD_ART_MS.
 */
export async function forgetArt(url: string): Promise<void> {
  try { const f = artFile(url); if (f && f.exists) f.delete(); } catch { /* ignore */ }
  try {
    const bad = await badArt();
    bad[url] = Date.now();
    await AsyncStorage.setItem(BAD_ART_KEY, JSON.stringify(bad));
  } catch { /* ignore */ }
}

/** True when the photo could not be saved on the phone (download failed): decoding it from the network is skipped. */
export const isRemote = (uri: string) => /^https?:/i.test(uri);

/** After an ad closes: download the photo of the next ad in this phone's rotation, so that open shows at once. */
export async function prefetchNextArt(): Promise<void> {
  try {
    const [c, b] = await Promise.all([cachedList(), AsyncStorage.getItem(BAG_KEY)]);
    if (!c) return;
    const next = (JSON.parse(b || '[]') as string[])[0];
    const ad = c.ads.find((a) => a.id === next);
    // the bag is empty (a new shuffle comes next): fetch every live ad's photo, one at a time
    for (const a of ad ? [ad] : c.ads) { const u = artUrl(a.imageUrl); if (u) await localArt(u); }
  } catch { /* ignore */ }
}
