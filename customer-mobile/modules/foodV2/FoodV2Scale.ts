/**
 * Food & groceries v2: one responsive scale for every screen.
 *   compact  < 360 px (iPhone SE 1st gen, small Android)
 *   regular  360–399 px (iPhone SE / mini / 14)
 *   large    >= 400 px (Pro Max, big Android)
 * Font sizes, paddings, the hero art and tile columns come from here; safe-area insets (notch and
 * home indicator) too, so the floating basket bar never covers content.
 * Others → Food & groceries (modules/foodV2).
 */
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type FoodSize = 'compact' | 'regular' | 'large';

/** Floating basket bar: height and the gap above the safe area (see FoodV2BasketBar). */
export const BAR_H = 60;
export const BAR_GAP = 12;

export function useFoodScale() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const w = Math.min(width, 600);
  const size: FoodSize = w < 360 ? 'compact' : w < 400 ? 'regular' : 'large';
  const pick = <T,>(compact: T, regular: T, large: T) => (size === 'compact' ? compact : size === 'regular' ? regular : large);
  /** Scale a regular-size font / spacing value for this width. */
  const f = (n: number) => Math.round(n * pick(0.9, 1, 1.06) * 2) / 2;
  return {
    w,
    size,
    compact: size === 'compact',
    pick,
    f,
    gutter: pick(12, 16, 16),
    insets,
    /** Bottom padding for any scroll view that sits under the floating basket bar. */
    barSpace: BAR_H + BAR_GAP + Math.max(insets.bottom, 8) + 12,
    hero: {
      title: pick(19, 21, 23),
      sub: pick(11.5, 12, 13),
      artRatio: pick(0.46, 0.54, 0.54),
      artMax: pick(180, 230, 250),
      textRatio: pick(0.56, 0.53, 0.53),
      minH: pick(176, 184, 196),
    },
    tileCols: w < 340 ? 2 : 3,
  };
}
export type FoodScale = ReturnType<typeof useFoodScale>;
