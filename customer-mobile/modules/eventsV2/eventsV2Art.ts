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
export const HERO_CAMPUS_DUSK: ImageSourcePropType = require('./assets/ev2-home-hero-campus-dusk-2026-10-25.webp');
export const ZCS_EMBLEM: ImageSourcePropType = require('../foodV2/assets/food-v2-brand-gold-z-emblem-2026-10-23.webp');

export const SAMPLE_ART = {
  cricket: require('./assets/ev2-sample-cricket-2026-10-25.webp'),
  concert: require('./assets/ev2-sample-concert-crowd-2026-10-25.webp'),
  design: require('./assets/ev2-sample-design-workshop-2026-10-25.webp'),
  hackathon: require('./assets/ev2-sample-hackathon-2026-10-25.webp'),
  dance: require('./assets/ev2-sample-dance-night-2026-10-25.webp'),
  quiz: require('./assets/ev2-sample-quiz-2026-10-25.webp'),
  talk: require('./assets/ev2-sample-startup-talk-2026-10-25.webp'),
  football: require('./assets/ev2-sample-football-2026-10-25.webp'),
  photo: require('./assets/ev2-sample-photo-walk-2026-10-25.webp'),
  jam: require('./assets/ev2-sample-music-jam-2026-10-25.webp'),
  mic: require('./assets/ev2-sample-open-mic-2026-10-25.webp'),
} satisfies Record<string, ImageSourcePropType>;
export type SampleArtKey = keyof typeof SAMPLE_ART;
