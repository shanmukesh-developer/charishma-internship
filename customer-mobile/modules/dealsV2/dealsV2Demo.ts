/**
 * Deals & spin v2: no sample deals (owner, 3 Nov 2026: "remove mock data from everywhere in the entire project";
 * the 25 Oct sample layer is gone). Only the admin's real deals show. The exports stay so the screens' imports are
 * unchanged.
 */
import type { ImageSourcePropType } from 'react-native';

export const DEALS_V2_DEMO_CONTENT = false;

export interface SampleDeal {
  id: string;
  isSample: true;
  name: string;
  store: string;
  tag: string;
  minOrder: number;
  left: number;
  streak?: number;
  art: ImageSourcePropType;
}

export const sampleDeals = (): SampleDeal[] => [];
export const isSampleDeal = (d: any): d is SampleDeal => !!d && d.isSample === true;
