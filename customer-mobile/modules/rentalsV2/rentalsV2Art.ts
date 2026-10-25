/**
 * Rentals v2 art. Every image is a free photo under the Unsplash License or the Pexels License (free commercial
 * use, modification allowed), cut out locally with rembg (isnet) where it is a cut-out, resized to WebP.
 * Sources: scratchpad rentals-v2-work/art/credits.json (photo id, page, photographer per file).
 * One picture per place, never repeated.
 */
import type { ImageSourcePropType } from 'react-native';
import type { Category } from './rentalsV2Theme';

/* eslint-disable @typescript-eslint/no-require-imports */
export const HERO_DUSK: ImageSourcePropType = require('./assets/rv2-home-hero-city-dusk-2026-10-25.webp');
export const ZCS_EMBLEM: ImageSourcePropType = require('../foodV2/assets/food-v2-brand-gold-z-emblem-2026-10-23.webp');

/** Home (night) category cards. */
export const HOME_ART: Record<Category, ImageSourcePropType> = {
  bike: require('./assets/rv2-home-bike-purple-scooter-2026-10-25.webp'),
  car: require('./assets/rv2-home-car-white-suv-2026-10-25.webp'),
  room: require('./assets/rv2-home-room-bed-lamp-plant-2026-10-25.webp'),
  flat: require('./assets/rv2-home-flat-modern-building-trees-2026-10-25.webp'),
};

/** Explore (day) category cards. */
export const EXPLORE_ART: Record<Category, ImageSourcePropType> = {
  bike: require('./assets/rv2-explore-bike-blue-scooter-2026-10-25.webp'),
  car: require('./assets/rv2-explore-car-white-hatchback-2026-10-25.webp'),
  room: require('./assets/rv2-explore-room-bed-2026-10-25.webp'),
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
export const DEMO_ART: Record<string, { cut: ImageSourcePropType; gallery: ImageSourcePropType[] }> = {
  activa: { cut: require('./assets/rv2-demo-bike-activa-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-activa-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-activa-2-2026-10-25.webp'), require('./assets/rv2-demo-bike-activa-3-2026-10-25.webp')] },
  jupiter: { cut: require('./assets/rv2-demo-bike-jupiter-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-jupiter-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-jupiter-2-2026-10-25.webp')] },
  ntorq: { cut: require('./assets/rv2-demo-bike-ntorq-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-ntorq-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-ntorq-2-2026-10-25.webp')] },
  dio: { cut: require('./assets/rv2-demo-bike-dio-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-dio-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-dio-2-2026-10-25.webp'), require('./assets/rv2-demo-bike-dio-3-2026-10-25.webp')] },
  ather: { cut: require('./assets/rv2-demo-bike-ather-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-ather-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-ather-2-2026-10-25.webp'), require('./assets/rv2-demo-bike-ather-3-2026-10-25.webp')] },
  splendor: { cut: require('./assets/rv2-demo-bike-splendor-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-splendor-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-splendor-2-2026-10-25.webp')] },
  fz: { cut: require('./assets/rv2-demo-bike-fz-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-fz-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-fz-2-2026-10-25.webp')] },
  pulsar: { cut: require('./assets/rv2-demo-bike-pulsar-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-pulsar-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-pulsar-2-2026-10-25.webp'), require('./assets/rv2-demo-bike-pulsar-3-2026-10-25.webp')] },
  classic350: { cut: require('./assets/rv2-demo-bike-classic350-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-bike-classic350-1-2026-10-25.webp'), require('./assets/rv2-demo-bike-classic350-2-2026-10-25.webp'), require('./assets/rv2-demo-bike-classic350-3-2026-10-25.webp')] },
  swift: { cut: require('./assets/rv2-demo-car-swift-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-swift-1-2026-10-25.webp'), require('./assets/rv2-demo-car-swift-2-2026-10-25.webp')] },
  i20: { cut: require('./assets/rv2-demo-car-i20-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-i20-1-2026-10-25.webp'), require('./assets/rv2-demo-car-i20-2-2026-10-25.webp')] },
  baleno: { cut: require('./assets/rv2-demo-car-baleno-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-baleno-1-2026-10-25.webp'), require('./assets/rv2-demo-car-baleno-2-2026-10-25.webp'), require('./assets/rv2-demo-car-baleno-3-2026-10-25.webp')] },
  city: { cut: require('./assets/rv2-demo-car-city-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-city-1-2026-10-25.webp'), require('./assets/rv2-demo-car-city-2-2026-10-25.webp'), require('./assets/rv2-demo-car-city-3-2026-10-25.webp')] },
  nexon: { cut: require('./assets/rv2-demo-car-nexon-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-nexon-1-2026-10-25.webp'), require('./assets/rv2-demo-car-nexon-2-2026-10-25.webp')] },
  creta: { cut: require('./assets/rv2-demo-car-creta-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-creta-1-2026-10-25.webp'), require('./assets/rv2-demo-car-creta-2-2026-10-25.webp'), require('./assets/rv2-demo-car-creta-3-2026-10-25.webp')] },
  innova: { cut: require('./assets/rv2-demo-car-innova-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-car-innova-1-2026-10-25.webp'), require('./assets/rv2-demo-car-innova-2-2026-10-25.webp')] },
  'flat-1bhk-neerukonda': { cut: require('./assets/rv2-demo-flat-1bhk-neerukonda-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-1bhk-neerukonda-1-2026-10-25.webp'), require('./assets/rv2-demo-flat-1bhk-neerukonda-2-2026-10-25.webp'), require('./assets/rv2-demo-flat-1bhk-neerukonda-3-2026-10-25.webp')] },
  'flat-1bhk-tadepalli': { cut: require('./assets/rv2-demo-flat-1bhk-tadepalli-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-1bhk-tadepalli-1-2026-10-25.webp'), require('./assets/rv2-demo-flat-1bhk-tadepalli-2-2026-10-25.webp'), require('./assets/rv2-demo-flat-1bhk-tadepalli-3-2026-10-25.webp')] },
  'flat-2bhk-mangalagiri': { cut: require('./assets/rv2-demo-flat-2bhk-mangalagiri-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-2bhk-mangalagiri-1-2026-10-25.webp'), require('./assets/rv2-demo-flat-2bhk-mangalagiri-2-2026-10-25.webp'), require('./assets/rv2-demo-flat-2bhk-mangalagiri-3-2026-10-25.webp')] },
  'flat-2bhk-kaza': { cut: require('./assets/rv2-demo-flat-2bhk-kaza-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-2bhk-kaza-1-2026-10-25.webp'), require('./assets/rv2-demo-flat-2bhk-kaza-2-2026-10-25.webp'), require('./assets/rv2-demo-flat-2bhk-kaza-3-2026-10-25.webp')] },
  'flat-house-nidamarru': { cut: require('./assets/rv2-demo-flat-house-nidamarru-cut-2026-10-25.webp'), gallery: [require('./assets/rv2-demo-flat-house-nidamarru-1-2026-10-25.webp'), require('./assets/rv2-demo-flat-house-nidamarru-2-2026-10-25.webp'), require('./assets/rv2-demo-flat-house-nidamarru-3-2026-10-25.webp')] },
};
