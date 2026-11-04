/**
 * In-Campus Booking: no sample stalls (owner, 3 Nov 2026: "remove mock data from everywhere in the entire project";
 * the 27 Oct sample layer is gone). The stall list shows the real stalls only, and with none the screen shows its own
 * empty state. The exports stay so the screens' imports are unchanged; an old "sample-cb-..." link opens as not found.
 */
import type { ImageSourcePropType } from 'react-native';
import type { CbMenuItem, CbStall } from './cbApi';

export const CAMPUS_BOOKING_DEMO_CONTENT = false;

/** Kept for the screens that read it; no samples are shown at any count. */
export const ENOUGH_REAL_STALLS = 4;

/** Old sample ids started with this (real ids are numbers). */
export const SAMPLE_ID_PREFIX = 'sample-cb-';

export type CbSampleStall = CbStall & { isDemoContent: true; art: ImageSourcePropType };
export type CbSampleMenuItem = CbMenuItem & { isDemoContent: true; art: ImageSourcePropType };

export const isSampleId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith(SAMPLE_ID_PREFIX);
export const isSampleStall = (v: CbStall | null | undefined): v is CbSampleStall => !!v && (v as any).isDemoContent === true;

/** No samples: the list is the real stalls. */
export function sampleStallsFor(_real: CbStall[]): CbSampleStall[] {
  return [];
}

export function sampleStallById(_id: string): { stall: CbSampleStall; menu: CbSampleMenuItem[] } | null {
  return null;
}

export const sampleItemArt = (_stallId: string, _itemId: string): ImageSourcePropType | null => null;
