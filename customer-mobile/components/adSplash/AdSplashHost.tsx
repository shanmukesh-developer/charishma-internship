// Mounts the sponsored splash right after the intro (app/_layout.tsx). The ad and its photo are fetched
// while the intro plays; if they are not ready within 1.5 s of the intro ending the ad is skipped for this
// open (an ad must never pop up over a Home the person is already using). Never on the very first launch
// (onboarding comes first). The Skia parts load lazily (runtime.ts) once ensureSkia() says the engine is
// ready (web downloads CanvasKit first; skiaReady.web.ts).
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import type { SkImage } from '@shopify/react-native-skia';
import { artUrl, forgetArt, isRemote, loadSplashAd, localArt, prefetchNextArt, returnToBag, type SplashAd } from './adSplashApi';
import { ensureSkia } from './skiaReady';

// How long after the intro an ad may still appear. Development builds compile the ad code on first use, so
// they wait longer; release builds have it bundled and keep the strict 1.5 s.
const READY_GRACE_MS = __DEV__ ? 30000 : 1500;
type Runtime = typeof import('./runtime');
let runtime: Promise<Runtime | null> | null = null;

export const loadRuntime = (): Promise<Runtime | null> => {
  if (!runtime) runtime = ensureSkia().then((ok) => (ok ? import('./runtime') : null)).catch(() => null);
  return runtime;
};

// Admin "Preview on phone" links (app/ad-preview.tsx) play one ad on demand, outside the normal rotation.
type Prepared = { ad: SplashAd; art: SkImage };
let previewListener: ((p: Prepared) => void) | null = null;
let pendingPreview: Prepared | null = null;
export function showAdPreview(p: Prepared) {
  if (previewListener) previewListener(p); else pendingPreview = p;
}

async function onboarded(): Promise<boolean> {
  try {
    const [a, b, u] = await Promise.all([AsyncStorage.getItem('zenvy_onboarded'), AsyncStorage.getItem('has_seen_onboarding'), AsyncStorage.getItem('zenvy_user')]);
    return !!(a || b || u);
  } catch { return false; }
}

export default function AdSplashHost({ introDone }: { introDone: boolean }) {
  const [rt, setRt] = useState<Runtime | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [state, setState] = useState<'loading' | 'show' | 'gone'>('loading');
  const introAt = useRef<number | null>(null);
  const shownRef = useRef(false);
  const goneRef = useRef(false);
  const [preview, setPreview] = useState<(Prepared & { key: number }) | null>(null);

  useEffect(() => {
    previewListener = (p) => { loadRuntime().then((r) => { if (r) { setRt(r); setPreview({ ...p, key: Date.now() }); } }); };
    if (pendingPreview) { previewListener(pendingPreview); pendingPreview = null; }
    return () => { previewListener = null; };
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    let alive = true;
    (async () => {
      if (!(await onboarded())) { if (alive) setState('gone'); return; }
      const r = await loadRuntime();
      if (!r) { if (alive) setState('gone'); return; }
      // 12 s for the request itself (not counted from app start: a slow first launch must not lose the ad).
      const t = setTimeout(() => ctl.abort(), 12000);
      // An ad whose photo will not load (a deleted Unsplash photo, a broken upload) gives way to the next ad of
      // the rotation, up to 3 tries, instead of leaving this open with no ad.
      let ad: SplashAd | null = null;
      let art: SkImage | null = null;
      for (let i = 0; i < 3 && !art && !ctl.signal.aborted; i++) {
        ad = await loadSplashAd(ctl.signal);
        if (!ad) break;
        const url = artUrl(ad.imageUrl) as string;
        const local = await localArt(url);
        // On the phone a photo that would not download is not tried again over the network this open (that cost
        // another few seconds); the web build has no file cache and always decodes from the URL.
        art = Platform.OS !== 'web' && isRemote(local) ? null : await r.loadArt(local);
        if (!art) await forgetArt(url);
      }
      clearTimeout(t);
      if (!alive) return;
      setRt(r);
      if (ad && art) {
        if (goneRef.current) returnToBag(ad.id); // ready only after the moment passed: its turn is next open
        else setPrepared({ ad, art });
      } else setState('gone');
    })();
    return () => { alive = false; ctl.abort(); };
  }, []);

  // Picked but never shown (not ready in time): it keeps its turn for the next open. Once this open's ad is
  // over, the next ad's photo is fetched into the phone's cache so that one shows the moment the intro ends.
  useEffect(() => {
    if (state !== 'gone') return;
    goneRef.current = true;
    if (prepared && !shownRef.current) returnToBag(prepared.ad.id);
    const t = setTimeout(() => { prefetchNextArt(); }, 4000);
    return () => clearTimeout(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state === 'show') shownRef.current = true; }, [state]);

  useEffect(() => {
    if (!introDone || state !== 'loading') return;
    if (introAt.current === null) introAt.current = Date.now();
    if (prepared) { setState('show'); return; }
    const t = setTimeout(() => setState((s) => (s === 'loading' ? 'gone' : s)), Math.max(0, READY_GRACE_MS - (Date.now() - introAt.current)));
    return () => clearTimeout(t);
  }, [introDone, prepared, state]);

  const go = (storeId?: string) => {
    if (storeId) setTimeout(() => { try { router.push(`/restaurant/${storeId}` as any); } catch { /* navigation not ready */ } }, 0);
  };
  if (!rt) return null;
  const { AdSplash } = rt;
  if (preview) return <AdSplash key={preview.key} ad={preview.ad} art={preview.art} onClose={(id) => { setPreview(null); go(id); }} />;
  // Ready before the intro ends: built hidden under the intro (fonts, photo, Skia surfaces all done there), then
  // revealed the moment the intro finishes, so the intro fades straight into a finished ad.
  if (state === 'gone' || !prepared) return null;
  return <AdSplash ad={prepared.ad} art={prepared.art} visible={state === 'show'} onClose={(storeId) => { setState('gone'); go(storeId); }} />;
}
