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
export const ZCS_EMBLEM: ImageSourcePropType = require('../foodV2/assets/food-v2-brand-gold-z-emblem-2026-10-23.webp');

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

/** Sample listings: product cut-out for rows and cards + gallery photos for the detail page. */
export const DEMO_ART: Record<string, { cut: ImageSourcePropType | null; gallery: ImageSourcePropType[] }> = {
  activa: { cut: require('./assets/rv2-demo-bike-activa-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-activa-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-activa-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-activa-3-hd-2026-10-26.webp')] },
  jupiter: { cut: require('./assets/rv2-demo-bike-jupiter-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-jupiter-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-jupiter-2-hd-2026-10-26.webp')] },
  ntorq: { cut: require('./assets/rv2-demo-bike-ntorq-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-ntorq-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-ntorq-2-hd-2026-10-26.webp')] },
  dio: { cut: require('./assets/rv2-demo-bike-dio-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-dio-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-dio-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-dio-3-hd-2026-10-26.webp')] },
  ather: { cut: require('./assets/rv2-demo-bike-ather-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-ather-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-ather-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-ather-3-hd-2026-10-26.webp')] },
  splendor: { cut: require('./assets/rv2-demo-bike-splendor-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-splendor-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-splendor-2-hd-2026-10-26.webp')] },
  fz: { cut: require('./assets/rv2-demo-bike-fz-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-fz-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-fz-2-hd-2026-10-26.webp')] },
  pulsar: { cut: require('./assets/rv2-demo-bike-pulsar-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-pulsar-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-pulsar-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-pulsar-3-hd-2026-10-26.webp')] },
  classic350: { cut: require('./assets/rv2-demo-bike-classic350-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-classic350-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-classic350-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-bike-classic350-3-hd-2026-10-26.webp')] },
  swift: { cut: require('./assets/rv2-demo-car-swift-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-swift-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-swift-2-hd-2026-10-26.webp')] },
  i20: { cut: require('./assets/rv2-demo-car-i20-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-i20-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-i20-2-hd-2026-10-26.webp')] },
  baleno: { cut: require('./assets/rv2-demo-car-baleno-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-baleno-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-baleno-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-baleno-3-hd-2026-10-26.webp')] },
  city: { cut: require('./assets/rv2-demo-car-city-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-city-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-city-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-city-3-hd-2026-10-26.webp')] },
  nexon: { cut: require('./assets/rv2-demo-car-nexon-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-nexon-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-nexon-2-hd-2026-10-26.webp')] },
  creta: { cut: require('./assets/rv2-demo-car-creta-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-creta-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-creta-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-creta-3-hd-2026-10-26.webp')] },
  innova: { cut: require('./assets/rv2-demo-car-innova-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-innova-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-car-innova-2-hd-2026-10-26.webp')] },
  'flat-1bhk-neerukonda': { cut: require('./assets/rv2-demo-flat-1bhk-neerukonda-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-1bhk-neerukonda-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-1bhk-neerukonda-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-1bhk-neerukonda-3-hd-2026-10-26.webp')] },
  'flat-1bhk-tadepalli': { cut: require('./assets/rv2-demo-flat-1bhk-tadepalli-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-1bhk-tadepalli-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-1bhk-tadepalli-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-1bhk-tadepalli-3-hd-2026-10-26.webp')] },
  'flat-2bhk-mangalagiri': { cut: null, gallery: [require('./assets/rv2-demo-flat-2bhk-mangalagiri-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-2bhk-mangalagiri-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-2bhk-mangalagiri-3-hd-2026-10-26.webp')] },
  'flat-2bhk-kaza': { cut: require('./assets/rv2-demo-flat-2bhk-kaza-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-2bhk-kaza-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-2bhk-kaza-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-2bhk-kaza-3-hd-2026-10-26.webp')] },
  'flat-house-nidamarru': { cut: require('./assets/rv2-demo-flat-house-nidamarru-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-house-nidamarru-1-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-house-nidamarru-2-hd-2026-10-26.webp'), require('./assets/rv2-demo-flat-house-nidamarru-3-hd-2026-10-26.webp')] },
};
