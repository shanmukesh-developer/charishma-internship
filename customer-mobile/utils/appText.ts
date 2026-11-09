/**
 * App font and text size (owner, 10 Nov 2026: "in settings add font types: according to the user preference the app
 * font changes, and size of text; 15+ international fonts, size max according to the device").
 *
 * How it reaches every text: a small patch to React Native's Text and TextInput (patches/react-native+*.patch) calls
 * globalThis.__zenweTextStyle(style) on each render. This file sets that function from the saved choice:
 *  - font: the family is swapped for the chosen one at the nearest weight that was loaded (each weight is its own
 *    file on Android, so bold stays bold). Texts that already name a font of their own (icon fonts, the serif
 *    "Pure Veg" title, DM Sans / Bricolage headings) keep it.
 *  - size: fontSize and lineHeight are multiplied by the chosen step, capped by the screen width.
 * Fonts are downloaded only when picked (@expo-google-fonts files on jsDelivr, pinned versions), so the app does not
 * grow for everyone. A change re-mounts the app tree (useAppTextEpoch) because Text does not re-render on its own.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Platform, StyleSheet } from 'react-native';
import * as Font from 'expo-font';
import { useSyncExternalStore } from 'react';

type W = 400 | 500 | 600 | 700 | 800 | 900;
export interface AppFont { key: string; label: string; pkg: string; name: string; version: string; weights: W[]; note?: string }

/** Every font checked on 10 Nov 2026 (npm @expo-google-fonts, files present at these versions). */
export const APP_FONTS: AppFont[] = [
  { key: 'inter', label: 'Inter', pkg: 'inter', name: 'Inter', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'roboto', label: 'Roboto', pkg: 'roboto', name: 'Roboto', version: '0.4.3', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'poppins', label: 'Poppins', pkg: 'poppins', name: 'Poppins', version: '0.4.1', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'open-sans', label: 'Open Sans', pkg: 'open-sans', name: 'OpenSans', version: '0.4.2', weights: [400, 500, 600, 700, 800] },
  { key: 'lato', label: 'Lato', pkg: 'lato', name: 'Lato', version: '0.4.1', weights: [400, 700, 900] },
  { key: 'montserrat', label: 'Montserrat', pkg: 'montserrat', name: 'Montserrat', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'nunito', label: 'Nunito', pkg: 'nunito', name: 'Nunito', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'noto-sans', label: 'Noto Sans', pkg: 'noto-sans', name: 'NotoSans', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'source-sans-3', label: 'Source Sans 3', pkg: 'source-sans-3', name: 'SourceSans3', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'work-sans', label: 'Work Sans', pkg: 'work-sans', name: 'WorkSans', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'rubik', label: 'Rubik', pkg: 'rubik', name: 'Rubik', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'dm-sans', label: 'DM Sans', pkg: 'dm-sans', name: 'DMSans', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'manrope', label: 'Manrope', pkg: 'manrope', name: 'Manrope', version: '0.4.3', weights: [400, 500, 600, 700, 800] },
  { key: 'plus-jakarta-sans', label: 'Plus Jakarta Sans', pkg: 'plus-jakarta-sans', name: 'PlusJakartaSans', version: '0.4.2', weights: [400, 500, 600, 700, 800] },
  { key: 'mulish', label: 'Mulish', pkg: 'mulish', name: 'Mulish', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'raleway', label: 'Raleway', pkg: 'raleway', name: 'Raleway', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'ubuntu', label: 'Ubuntu', pkg: 'ubuntu', name: 'Ubuntu', version: '0.4.1', weights: [400, 500, 700] },
  { key: 'outfit', label: 'Outfit', pkg: 'outfit', name: 'Outfit', version: '0.4.3', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'lexend', label: 'Lexend', pkg: 'lexend', name: 'Lexend', version: '0.4.1', weights: [400, 500, 600, 700, 800, 900], note: 'Made for easy reading' },
  { key: 'noto-sans-telugu', label: 'Noto Sans Telugu', pkg: 'noto-sans-telugu', name: 'NotoSansTelugu', version: '0.4.2', weights: [400, 500, 600, 700, 800, 900], note: 'English + తెలుగు' },
];

const WEIGHT_FILE: Record<W, string> = { 400: '400Regular', 500: '500Medium', 600: '600SemiBold', 700: '700Bold', 800: '800ExtraBold', 900: '900Black' };

/** Text size steps. The largest steps show only on screens wide enough for them (see maxSizeScale). */
export const TEXT_SIZES = [
  { key: 'small', label: 'Small', scale: 0.92 },
  { key: 'default', label: 'Default', scale: 1 },
  { key: 'large', label: 'Large', scale: 1.08 },
  { key: 'larger', label: 'Larger', scale: 1.16 },
  { key: 'largest', label: 'Largest', scale: 1.25 },
] as const;

/** "Max according to the device": narrow phones stop earlier so screens never overflow. */
export function maxSizeScale(): number {
  const w = Math.min(Dimensions.get('window').width, Dimensions.get('window').height);
  if (w < 360) return 1.08;
  if (w < 400) return 1.16;
  return 1.25;
}

export interface AppTextPrefs { font: string | null; size: number }
const KEY = 'zenwe_app_text_v1';
const DEFAULT_PREFS: AppTextPrefs = { font: null, size: 1 };

let current: AppTextPrefs = DEFAULT_PREFS;
let epoch = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Bumps when the font or size is applied: the app tree is keyed on it. */
export function useAppTextEpoch(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => epoch, () => epoch);
}
export function getAppTextPrefs(): AppTextPrefs { return current; }

/** The weights downloaded for a font: regular, a middle weight, bold and a heavy weight (4 files at most). */
function weightsToLoad(f: AppFont): W[] {
  const has = (w: W) => f.weights.includes(w);
  const mid: W | null = has(600) ? 600 : has(500) ? 500 : null;
  const heavy: W | null = has(800) ? 800 : has(900) ? 900 : null;
  const order: (W | null)[] = [400, mid, 700, heavy];
  return order.filter((w): w is W => !!w && has(w));
}
const familyName = (f: AppFont, w: W) => `${f.name}_${WEIGHT_FILE[w]}`;
const fontUrl = (f: AppFont, w: W) =>
  `https://cdn.jsdelivr.net/npm/@expo-google-fonts/${f.pkg}@${f.version}/${WEIGHT_FILE[w]}/${familyName(f, w)}.ttf`;

/** Downloads (once, then from the cache) the weights of a font. Throws when offline. */
export async function loadAppFont(key: string): Promise<AppFont> {
  const f = APP_FONTS.find((x) => x.key === key);
  if (!f) throw new Error('Unknown font');
  const map: Record<string, string> = {};
  weightsToLoad(f).forEach((w) => { if (!Font.isLoaded(familyName(f, w))) map[familyName(f, w)] = fontUrl(f, w); });
  if (Object.keys(map).length) await Font.loadAsync(map);
  return f;
}

// Fonts a text keeps even with a chosen app font (designer picks and icon fonts).
const SYSTEM_FAMILIES = new Set(['', 'system', 'sans-serif', 'roboto', 'normal', 'system-ui']);
const numericWeight = (fw: any): number => {
  if (fw === 'bold') return 700;
  if (fw === 'normal' || fw == null) return 400;
  const n = Number(fw);
  return Number.isFinite(n) ? n : 400;
};
function nearestLoaded(f: AppFont, want: number): W {
  const loaded = weightsToLoad(f);
  let best = loaded[0];
  for (const w of loaded) if (Math.abs(w - want) < Math.abs(best - want)) best = w;
  return best;
}

function install(prefs: AppTextPrefs, font: AppFont | null) {
  const scale = prefs.size || 1;
  if (!font && scale === 1) { (globalThis as any).__zenweTextStyle = undefined; return; }
  (globalThis as any).__zenweTextStyle = (style: any) => {
    const flat: any = StyleSheet.flatten(style) || {};
    const over: any = {};
    if (font) {
      const fam = String(flat.fontFamily || '').toLowerCase();
      if (SYSTEM_FAMILIES.has(fam)) {
        over.fontFamily = familyName(font, nearestLoaded(font, numericWeight(flat.fontWeight)));
        // Android picks the weight from the family file; a fontWeight next to it can make it fall back.
        if (Platform.OS === 'android') over.fontWeight = 'normal';
      }
    }
    if (scale !== 1) {
      over.fontSize = Math.round((typeof flat.fontSize === 'number' ? flat.fontSize : 14) * scale * 10) / 10;
      if (typeof flat.lineHeight === 'number') over.lineHeight = Math.round(flat.lineHeight * scale * 10) / 10;
    }
    return Object.keys(over).length ? [style, over] : style;
  };
}

/**
 * Launch: reads the saved choice and loads its font before the first screen (gives up after 4 s, then the app
 * starts with the phone font and tries again next launch). Never throws.
 */
export async function bootAppText(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const prefs: AppTextPrefs = {
      font: typeof saved?.font === 'string' ? saved.font : null,
      size: Math.min(maxSizeScale(), Math.max(0.92, Number(saved?.size) || 1)),
    };
    let font: AppFont | null = null;
    if (prefs.font) {
      font = await Promise.race([
        loadAppFont(prefs.font),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]).catch(() => null);
    }
    current = { font: font ? prefs.font : null, size: prefs.size };
    install(current, font);
  } catch { /* phone font, default size */ }
}

/** Settings: saves and applies (the app tree re-mounts). Loads the font first; throws if it cannot be downloaded. */
export async function applyAppText(next: AppTextPrefs): Promise<void> {
  const size = Math.min(maxSizeScale(), Math.max(0.92, next.size || 1));
  const font = next.font ? await loadAppFont(next.font) : null;
  current = { font: font ? next.font : null, size };
  await AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
  install(current, font);
  (globalThis as any).__zenweReopenAfterText = '/text-and-font';
  epoch += 1;
  emit();
}

/** For the preview cards: the family of a loaded font at a weight (undefined = phone font). */
export function previewFamily(key: string | null, weight: number = 400): string | undefined {
  const f = key ? APP_FONTS.find((x) => x.key === key) : null;
  if (!f) return undefined;
  const w = nearestLoaded(f, weight);
  return Font.isLoaded(familyName(f, w)) ? familyName(f, w) : undefined;
}
