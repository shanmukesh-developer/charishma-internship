/**
 * Rentals v2 art. Every image is a free photo under the Unsplash License or the Pexels License (free commercial
 * use, modification allowed), cut out locally with rembg (isnet) where it is a cut-out, resized to WebP.
 * Sources: scratchpad rentals-v2-work/art/credits.json (photo id, page, photographer per file).
 * One picture per place, never repeated.
 */
import type { ImageSourcePropType } from 'react-native';
import type { Category } from './rentalsV2Theme';

/* eslint-disable @typescript-eslint/no-require-imports */
/** Dusk skyline, brightened and warmed locally (brightness, saturation, pink horizon glow) for the owner's "bright, colourful" note. */
export const HERO_DUSK: ImageSourcePropType = require('./assets/rv2-home-hero-city-dusk-vivid-hd-2026-10-26.webp');
export const ZCS_EMBLEM: ImageSourcePropType = require('../../assets/zenv-brand-badge-2026-11-04.webp');

/** Home (night) category cards, round 3 (owner, 26 Oct): a premium scooter with its full handlebar and mirrors,
 * the white SUV, a real cosy bedroom photo framed in the card, and a bright mid-rise block with balconies
 * (the 2BHK Mangalagiri sample's cut-out; that sample's list row shows its photo instead). Sources in credits.json. */
export const HOME_ART: Record<Category, ImageSourcePropType> = {
  bike: require('./assets/rv2-home-bike-premium-scooter-v3-2026-10-26.webp'),
  car: require('./assets/rv2-home-car-white-suv-2026-10-25.webp'),
  room: require('./assets/rv2-home-room-cosy-photo-v3-2026-10-26.webp'),
  flat: require('./assets/rv2-demo-flat-2bhk-mangalagiri-cut-2026-10-25.webp'),
};

/** Home cards whose art is a framed photo rather than a cut-out. */
export const HOME_ART_IS_PHOTO: Record<Category, boolean> = { bike: false, car: false, room: true, flat: false };

/** Explore (day) category cards. */
export const EXPLORE_ART: Record<Category, ImageSourcePropType> = {
  bike: require('./assets/rv2-explore-bike-blue-scooter-2026-10-25.webp'),
  car: require('./assets/rv2-explore-car-white-hatchback-2026-10-25.webp'),
  room: require('./assets/rv2-home-room-bed-lamp-plant-2026-10-25.webp'),
  flat: require('./assets/rv2-explore-flat-building-2026-10-25.webp'),
};

/** Category listing promo heroes. */
export const PROMO_ART: Record<Category, ImageSourcePropType> = {
  bike: require('./assets/rv2-promo-bike-sports-2026-10-25.webp'),
  car: require('./assets/rv2-promo-car-sedan-2026-10-25.webp'),
  room: require('./assets/rv2-promo-room-desk-2026-10-25.webp'),
  flat: require('./assets/rv2-promo-flat-house-2026-10-25.webp'),
};
