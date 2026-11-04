/**
 * Rentals v2: no sample listings (owner, 3 Nov 2026: "remove mock data from everywhere in the entire project";
 * the 25 Oct sample bikes, cars and flats are gone). Only real listings show; with none, the screens show their own
 * empty state. The Feature types stay here because real listings use them; the other exports stay so the screens'
 * imports are unchanged.
 */
import type { ImageSourcePropType } from 'react-native';
import type { Category } from './rentalsV2Theme';

export const RENTALS_V2_DEMO_CONTENT = false;

export interface Feature { icon: FeatureIcon; label: string }
export type FeatureIcon = 'engine' | 'helmet' | 'doc' | 'wrench' | 'seats' | 'snow' | 'bluetooth' | 'shield' | 'fuel' | 'gauge'
  | 'wifi' | 'bath' | 'desk' | 'bed' | 'sofa' | 'kitchen' | 'parking' | 'power' | 'water' | 'home';

export interface DemoItem {
  slug: string;
  category: Category;
  tags: string[];
  title: string;
  /** Per day for vehicles, per month for flats. */
  price: number;
  priceWeek?: number;
  priceMonth?: number;
  deposit: number;
  rating: number;
  reviews: number;
  specs: string[];
  features: Feature[];
  area: string;
  distanceKm: number;
  owner: string;
  about: string;
  fuel?: 'Petrol' | 'Diesel' | 'Electric' | 'CNG';
  gear?: 'Manual' | 'Automatic';
  helmet?: boolean;
  kmPerDay?: number;
  createdAt: string;
  isDemoContent: true;
}

export const DEMO_ITEMS: DemoItem[] = [];

export const demoArt = (_slug: string): { cut: ImageSourcePropType | null; gallery: ImageSourcePropType[] } => ({ cut: null, gallery: [] });
