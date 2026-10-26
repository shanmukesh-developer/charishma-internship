import React, { useEffect, useState } from 'react';
import { View, StyleSheet, StyleProp, ImageStyle, ImageSourcePropType, PixelRatio, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image, ImageProps } from 'expo-image';

// Stand-in photos for food / product / place images only. People (a user's avatar, a rider) never get
// a stock photo of a stranger: they fall back to a neutral person icon (or the caller's `fallback`).
const LUXURY_FALLBACKS: Record<string, string> = {
  food: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&q=70',
  biryani: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=400&q=70',
  burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&q=70',
  pizza: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&q=70',
  grocery: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&q=70',
  fruits: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=400&q=70',
  electronics: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=400&q=70',
  stationery: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=400&q=70',
  laundry: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=400&q=70',
  rides: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=400&q=70',
};

const DEFAULT_FALLBACK_URI = LUXURY_FALLBACKS.food;

// Stock photos the server (and older app builds) put in place of a missing store / dish photo. They made
// many stores share the same picture (one of them now 404s), so they count as "no photo" here.
const STOCK_PLACEHOLDER_IDS = ['photo-1546069901-ba9599a7e63c', 'photo-1601050690'];
export const isStockPlaceholder = (uri?: string | null): boolean =>
  !!uri && typeof uri === 'string' && uri.includes('images.unsplash.com') && STOCK_PLACEHOLDER_IDS.some((id) => uri.includes(id));

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Neutral placeholder: an icon on a soft tint, the same size as the image it stands in for. */
export function ImagePlaceholder({ style, icon = 'image-outline' }: { style?: StyleProp<ImageStyle>; icon?: IconName }) {
  const flat: any = StyleSheet.flatten(style as any) || {};
  const base = typeof flat.width === 'number' ? flat.width : typeof flat.height === 'number' ? flat.height : 80;
  const size = Math.max(16, Math.min(40, Math.round(base * 0.32)));
  return (
    <View style={[style as any, styles.container, styles.placeholder, styles.tint]} accessibilityRole="image" accessibilityLabel="No photo yet">
      <Ionicons name={icon} size={size} color="rgba(128, 128, 128, 0.7)" />
    </View>
  );
}

/**
 * Pixel width to ask a CDN for, for an image shown `dp` points wide: the points times the screen density
 * (capped at 3x), rounded up to 100 px so nearby sizes share one cached file. Asking for a fixed 400 px made
 * every photo wider than ~145 pt look soft on a 2.75x phone (owner, 26 Oct: "quality of the images has to be great").
 */
export function cdnWidthFor(dp: number): number {
  const px = Math.max(1, dp) * Math.min(PixelRatio.get() || 2, 3);
  return Math.min(2000, Math.max(100, Math.ceil(px / 100) * 100));
}

const isResizableCdn = (u: string) => u.includes('images.unsplash.com') || u.includes('images.pexels.com');

/**
 * Ask image CDNs for a rendition `width` pixels wide (a raw Unsplash/Pexels URL is a multi-MB original).
 * Other hosts are returned unchanged.
 */
export function optimizeImageUri(uriString?: string | null, width = 400): string {
  if (!uriString || typeof uriString !== 'string') return '';
  if (uriString.startsWith('data:')) return uriString;
  const w = Math.max(64, Math.round(width));
  if (uriString.includes('images.unsplash.com')) {
    const base = uriString.split('?')[0];
    return `${base}?auto=format&fit=crop&w=${w}&q=80`;
  }
  if (uriString.includes('images.pexels.com')) {
    const base = uriString.split('?')[0];
    return `${base}?auto=compress&cs=tinysrgb&w=${w}`;
  }
  return uriString;
}

/** Stock fallback photo for a URI, or null when the image is of a person (no stock face is shown). */
function getSmartFallback(uriString?: string | null): string | null {
  if (!uriString) return DEFAULT_FALLBACK_URI;
  // Inline data images are user uploads (usually a profile photo).
  if (uriString.startsWith('data:image')) return null;
  const lower = uriString.toLowerCase();
  if (lower.includes('avatar') || lower.includes('profile') || lower.includes('user')) return null;
  if (lower.includes('rider') || lower.includes('driver') || lower.includes('captain')) return null;
  for (const [key, fallback] of Object.entries(LUXURY_FALLBACKS)) {
    if (lower.includes(key)) return fallback;
  }
  return DEFAULT_FALLBACK_URI;
}

interface SafeImageProps extends Omit<ImageProps, 'source' | 'style' | 'onError'> {
  source?: ImageSourcePropType | { uri?: string | null } | null;
  style?: StyleProp<ImageStyle>;
  fallbackUri?: string;
  /** Shown instead of any fallback photo when the image is missing or fails (e.g. initials for an avatar). */
  fallback?: React.ReactNode;
  /** Fade-in on load, ms. */
  fadeInDuration?: number;
  /** Display width in points when the style has no numeric width and the image should not wait for layout. */
  maxWidth?: number;
  onError?: (e: any) => void;
  /** Icon of the neutral placeholder shown when there is no photo (stores, dishes, places). */
  placeholderIcon?: IconName;
}

/**
 * Image with a fallback, backed by expo-image: memory + disk cache (no re-download when a list
 * re-renders or a screen re-opens), downsampled CDN URLs and a cheap native fade-in.
 */
export default function SafeImage({
  source,
  fallbackUri,
  fallback,
  style,
  onError,
  fadeInDuration = 200,
  maxWidth = 400,
  placeholderIcon,
  ...props
}: SafeImageProps) {
  const givenUri = typeof source === 'object' && source && 'uri' in source ? (source.uri || '') : '';
  const rawUri = isStockPlaceholder(givenUri) ? '' : givenUri;
  const personImage = !!givenUri && getSmartFallback(givenUri) === null;
  const [hasError, setHasError] = useState(false);
  // The CDN rendition is sized to the width the image is drawn at (numeric style width, else its layout).
  const flatStyle: any = StyleSheet.flatten(style as any) || {};
  const styleW = typeof flatStyle.width === 'number' ? flatStyle.width : 0;
  const [layoutW, setLayoutW] = useState(0);
  const onLayout = styleW ? undefined : (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    // Only grow: a list re-layout must never swap a sharp image for a smaller one.
    if (w > layoutW) setLayoutW(w);
  };
  const drawW = styleW || layoutW;

  useEffect(() => { setHasError(false); }, [rawUri]);

  const failed = typeof source !== 'number' && (hasError || !rawUri.trim());
  // No photo (missing, broken or a shared stock photo): the caller's own fallback photo if it passed one,
  // else a neutral placeholder; never a stock photo that makes many stores look the same.
  if (failed && fallback === undefined && !personImage && !fallbackUri) {
    return <ImagePlaceholder style={style} icon={placeholderIcon} />;
  }
  const resolvedFallback = fallbackUri || null;
  // A person's photo that is missing / broken: the caller's placeholder, or a neutral person icon.
  if (failed && (fallback !== undefined || !resolvedFallback)) {
    const flat: any = StyleSheet.flatten(style as any) || {};
    const iconSize = typeof flat.width === 'number' ? Math.max(12, Math.round(flat.width * 0.5)) : 20;
    return (
      <View style={[style as any, styles.container, styles.placeholder]}>
        {fallback !== undefined ? fallback : <Ionicons name="person" size={iconSize} color="rgba(128, 128, 128, 0.65)" />}
      </View>
    );
  }

  let imgSource: any;
  if (typeof source === 'number') imgSource = source;
  else if (failed) imgSource = { uri: resolvedFallback };
  // A CDN photo whose drawn width is not known yet waits one layout pass (no low-res request first).
  else if (isResizableCdn(rawUri) && !drawW) imgSource = null;
  else imgSource = { uri: optimizeImageUri(rawUri, cdnWidthFor(drawW || maxWidth)) };

  if (!imgSource) return <View style={[style as any, styles.container]} onLayout={onLayout} />;

  return (
    <View style={[style as any, styles.container]} onLayout={onLayout}>
      <Image
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={fadeInDuration}
        recyclingKey={typeof imgSource === 'number' ? String(imgSource) : imgSource.uri}
        {...props}
        source={imgSource}
        style={[style as any, StyleSheet.absoluteFill]}
        onError={(e) => {
          if (!hasError) setHasError(true);
          onError?.(e);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(128, 128, 128, 0.08)',
    overflow: 'hidden',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tint: {
    backgroundColor: 'rgba(128, 128, 128, 0.12)',
  },
});

type CachedImageProps = Omit<ImageProps, 'source' | 'style'> & {
  source?: ImageSourcePropType | { uri?: string | null } | null;
  style?: StyleProp<ImageStyle>;
  /** Display width in points for a non-CDN-resizable case with no measured width (default: a full phone width). */
  maxWidth?: number;
  /** Icon of the neutral placeholder shown when the photo is missing or fails to load. */
  placeholderIcon?: IconName;
};

/**
 * Drop-in for react-native's <Image> in lists: expo-image with memory + disk cache and
 * downsampled CDN URLs. Honors resizeMode given as a prop or inside style.
 */
export function CachedImage({ source, style, maxWidth = 360, resizeMode, contentFit, placeholderIcon, onError, ...props }: CachedImageProps) {
  const uri = source && typeof source === 'object' && !Array.isArray(source) && 'uri' in source ? String(source.uri || '') : null;
  const [failed, setFailed] = useState(false);
  // Sized like SafeImage: numeric style width, else the drawn width (one layout pass before a CDN request).
  const [layoutW, setLayoutW] = useState(0);
  useEffect(() => { setFailed(false); }, [uri]);
  // A missing / broken / shared stock photo: a neutral placeholder instead of an empty or repeated picture.
  if (uri !== null && (failed || !uri.trim() || isStockPlaceholder(uri))) {
    return <ImagePlaceholder style={style} icon={placeholderIcon} />;
  }
  const flat: any = StyleSheet.flatten(style) || {};
  const mode = resizeMode || flat.resizeMode;
  const fit = contentFit || (mode === 'contain' ? 'contain' : mode === 'stretch' ? 'fill' : mode === 'center' ? 'none' : 'cover');
  const styleW = typeof flat.width === 'number' ? flat.width : 0;
  const drawW = styleW || layoutW;
  let src: any = source;
  if (uri !== null) {
    src = isResizableCdn(uri) && !drawW ? null : { uri: optimizeImageUri(uri, cdnWidthFor(drawW || maxWidth)) || undefined };
  }
  const onLayout = styleW ? (props as any).onLayout : (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > layoutW) setLayoutW(w);
    (props as any).onLayout?.(e);
  };
  return <Image cachePolicy="memory-disk" transition={150} {...props} onLayout={onLayout} contentFit={fit} source={src} style={style as any} onError={(e) => { setFailed(true); onError?.(e); }} />;
}
