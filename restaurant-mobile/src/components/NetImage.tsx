// Remote photo (menu item, store cover) with the fixes every list needs:
//  - relative backend paths ('/api/campus/media/..') get the API address in front;
//  - a descriptive User-Agent. React Native's default ('okhttp/x') is refused with 403 by
//    upload.wikimedia.org (its robot policy), which is where many seeded menu photos live;
//  - list thumbnails ask photo hosts for a small size (Wikimedia / Unsplash) instead of 800-960 px;
//  - a failed load is retried twice (slow backend start, Wikimedia 429), the retries with the photo's
//    original size, then the fallback is shown instead of an empty grey box.
import React, { memo, useEffect, useRef, useState } from 'react';
import { Image, type ImageResizeMode, type ImageStyle, type StyleProp } from 'react-native';
import { API_URL } from '../config';

const USER_AGENT = 'ZenvyPartner/1.0 (Android; Zenvy restaurant app; projectshanmukh@gmail.com)';
const RETRY_DELAYS_MS = [1500, 5000];
const WIKI_STEPS = [120, 250, 330, 500, 960];

/** Smaller copy from hosts that resize on the fly; anything else is returned unchanged. */
// Plain string work on purpose: React Native's URL class does not implement every getter / setter.
function sized(uri: string, px: number): string {
  const WIKI = 'https://upload.wikimedia.org';
  if (uri.startsWith(`${WIKI}/`) && !uri.includes('?')) {
    const step = WIKI_STEPS.find((s) => s >= px) || 960;
    const path = uri.slice(WIKI.length);
    const thumb = /^(\/wikipedia\/[^/]+\/thumb\/.+\/)(\d+)px-([^/]+)$/.exec(path);
    if (thumb) return Number(thumb[2]) > step ? `${WIKI}${thumb[1]}${step}px-${thumb[3]}` : uri;
    const orig = /^\/wikipedia\/([^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+\.(?:jpe?g|png|webp))$/i.exec(path);
    if (orig) return `${WIKI}/wikipedia/${orig[1]}/thumb/${orig[2]}/${orig[3]}/${step}px-${orig[3]}`;
    return uri;
  }
  if (uri.startsWith('https://images.unsplash.com/')) {
    const [base, query = ''] = uri.split('?');
    const keep = query.split('&').filter((p) => p && !/^(w|h|q|auto)=/.test(p));
    return `${base}?${[...keep, `w=${px}`, 'q=70', 'auto=format'].join('&')}`;
  }
  return uri;
}

/** Absolute, loadable address for a stored photo value, or null when there is none. */
export function photoUri(raw: string | null | undefined, thumbPx?: number): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return null;
  if (/^data:image\//i.test(v) || /^(file|content):/i.test(v)) return v;
  if (v.startsWith('/')) return `${API_URL.replace(/\/+$/, '')}${v}`;
  if (!/^https?:\/\//i.test(v)) return null;
  return thumbPx ? sized(v, thumbPx) : v;
}

type Props = {
  uri: string | null | undefined;
  style: StyleProp<ImageStyle>;
  /** Ask for a small copy about this many pixels wide (list thumbnails). */
  thumbPx?: number;
  resizeMode?: ImageResizeMode;
  /** Shown when there is no photo or it could not be loaded. */
  fallback?: React.ReactNode;
  accessibilityLabel?: string;
};

function NetImageBase({ uri, style, thumbPx, resizeMode = 'cover', fallback = null, accessibilityLabel }: Props) {
  const full = photoUri(uri);
  const sizedSrc = photoUri(uri, thumbPx);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [full, sizedSrc]);

  if (!full || failed) return <>{fallback}</>;
  const src = attempt === 0 && sizedSrc ? sizedSrc : full;
  const isRemote = /^https?:/i.test(src);
  return (
    <Image
      key={`${src}#${attempt}`}
      source={isRemote ? { uri: src, headers: { 'User-Agent': USER_AGENT } } : { uri: src }}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onError={() => {
        if (attempt < RETRY_DELAYS_MS.length) {
          timer.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS_MS[attempt]);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

export const NetImage = memo(NetImageBase);
