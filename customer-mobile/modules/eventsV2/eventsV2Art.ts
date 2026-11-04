/**
 * Campus Events v2 art. Every photo is a free photo under the Unsplash License (images.unsplash.com/photo-*,
 * not Unsplash+): free commercial use, modification allowed. Cropped, lightly polished and saved as WebP; the
 * hero is graded toward violet and blended into the indigo page. One picture per place, never repeated.
 * Credits: unsplash.com/photos/<id>   hero BnOB8dwgcFI
 * (The sample-event photos went with the sample events, 3 Nov 2026.)
 */
import type { ImageSourcePropType } from 'react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
export const HERO_CAMPUS_DUSK: ImageSourcePropType = require('./assets/ev2-home-hero-campus-dusk-hd-2026-10-26.webp');
export const ZCS_EMBLEM: ImageSourcePropType = require('../../assets/zenv-brand-badge-2026-11-04.webp');

/**
 * Category tiles (owner, 26 Oct 2026: photo tiles instead of the 3D emoji icons). Free photos under the Unsplash
 * License, cropped to 4:5 and saved as WebP. Credits: unsplash.com/photos/<id>
 *   all NYrVisodQ2M · cultural uv4h7wIQcHQ · sports HgoKvtKpyHA · workshops kp7qkHTgSKc · clubs sr4xtO90tUM
 */
export const CATEGORY_PHOTO = {
  all: require('./assets/ev2-cat-all-events-stage-audience-2026-10-26.webp'),
  cultural: require('./assets/ev2-cat-cultural-classical-dancers-2026-10-26.webp'),
  sports: require('./assets/ev2-cat-sports-track-race-2026-10-26.webp'),
  workshops: require('./assets/ev2-cat-workshops-students-laptop-2026-10-26.webp'),
  clubs: require('./assets/ev2-cat-clubs-student-group-2026-10-26.webp'),
} satisfies Record<string, ImageSourcePropType>;
