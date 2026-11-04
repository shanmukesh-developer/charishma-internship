/**
 * Food & groceries v2: no sample products (owner, 3 Nov 2026: "remove mock data from everywhere in the entire
 * project"; the 27 Oct sample layer is gone). Shelves show the store's real products only, and an empty shelf shows
 * the screen's own empty state. The exports stay so the screens' imports are unchanged.
 */
import type { Item } from './FoodV2Data';

export const FOOD_V2_DEMO_CONTENT = false;

/** Kept for the screens that read it; nothing is topped up any more. */
export const THIN_SHELF = 6;

export const isSampleItem = (p: Item | null | undefined): boolean => !!p && p.isDemoContent === true;

/** No samples: every shelf is the real catalogue. */
export function samplesFor(_shelf: string, _real: Item[]): Item[] {
  return [];
}
