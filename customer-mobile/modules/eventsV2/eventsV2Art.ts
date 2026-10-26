/**
 * Campus Events v2 art. Every photo is a free photo under the Unsplash License (images.unsplash.com/photo-*,
 * not Unsplash+): free commercial use, modification allowed. Cropped, lightly polished and saved as WebP; the
 * hero is graded toward violet and blended into the indigo page. One picture per place, never repeated.
 * Credits: unsplash.com/photos/<id>
 *   hero BnOB8dwgcFI · cricket 7r6cX6FYNz0 · concert aTwWDb5Joj8 · design E7Tph3v7SIQ · hackathon rh4xapY-haI
 *   dance xJFbvG1edaM · quiz hImHC7Posuo · talk RfiBK6Y_upQ · football 7j5Ke96U30Q · photo walk DswQ6jBW3_0
 *   music jam 8K2hmmk0O3s · open mic NK02ShlfWDM
 */
import type { ImageSourcePropType } from 'react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
export const HERO_CAMPUS_DUSK: ImageSourcePropType = require('./assets/ev2-home-hero-campus-dusk-hd-2026-10-26.webp');
export const ZCS_EMBLEM: ImageSourcePropType = require('../foodV2/assets/food-v2-brand-gold-z-emblem-2026-10-23.webp');

export const SAMPLE_ART = {
  cricket: require('./assets/ev2-sample-cricket-hd-2026-10-26.webp'),
  concert: require('./assets/ev2-sample-concert-crowd-hd-2026-10-26.webp'),
  design: require('./assets/ev2-sample-design-workshop-hd-2026-10-26.webp'),
  hackathon: require('./assets/ev2-sample-hackathon-hd-2026-10-26.webp'),
  dance: require('./assets/ev2-sample-dance-night-hd-2026-10-26.webp'),
  quiz: require('./assets/ev2-sample-quiz-hd-2026-10-26.webp'),
  talk: require('./assets/ev2-sample-startup-talk-hd-2026-10-26.webp'),
  football: require('./assets/ev2-sample-football-hd-2026-10-26.webp'),
  photo: require('./assets/ev2-sample-photo-walk-hd-2026-10-26.webp'),
  jam: require('./assets/ev2-sample-music-jam-hd-2026-10-26.webp'),
  mic: require('./assets/ev2-sample-open-mic-hd-2026-10-26.webp'),
} satisfies Record<string, ImageSourcePropType>;
export type SampleArtKey = keyof typeof SAMPLE_ART;

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
