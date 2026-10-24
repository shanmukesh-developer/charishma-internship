/**
 * Art for Co-Ride v2: OWNER-SUPPLIED illustrations (24 Oct 2026), no licence note needed.
 *   hero   owner-hero-scooter-car-campus (two students on a blue scooter, a blue car with students, trees and
 *          a campus block on black): black keyed out locally, rembg for the riders and vehicles, glow rim removed
 *   Every picture appears once in the section (owner rule): the pool card, quick actions and empty states
 *   use thin line-icon compositions instead of repeating the hero art.
 *   auto   owner-auto-rickshaw-green-yellow (on white, rembg); small source, shown at most ~180 px wide
 * Soft ground shadows are baked in (scratchpad/coride-art/compose_owner.py).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
export const ART = {
  hero: require('./assets/coride-v2-owner-hero-students-scooter-car-campus-2026-10-24.webp'),
  auto: require('./assets/coride-v2-owner-tile-auto-rickshaw-2026-10-24.webp'),
  /** The ZCS emblem (navy disc, gold Z) shared with the Food v2 header. */
  emblem: require('../../modules/foodV2/assets/food-v2-brand-gold-z-emblem-2026-10-23.webp'),
} as const;

/** Pixel aspect (w / h) of each piece, so boxes keep the art's shape at every width. */
export const ART_RATIO = {
  hero: 1200 / 572,
  auto: 291 / 256,
} as const;
/** Largest width the small owner auto-rickshaw is shown at (its source is 402 px wide). */
export const AUTO_MAX_W = 180;
