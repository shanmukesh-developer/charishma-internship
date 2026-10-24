/**
 * Photos for PG v2.
 *
 * Real listing photos are used when a PG has them. Today the live listings carry only a few generic
 * stock interiors (category OTHER, shared by many PGs) and no building exteriors, so the screens fall
 * back to same-type, free Unsplash / Pexels photos (free licences, commercial use allowed) stored in
 * ./assets. Every stock image is flagged `isRepresentativePhoto: true` so it can be found and replaced
 * once PG owners upload their own. Owner decision (24 Oct): no "Representative photo" label is shown.
 */
import type { ImageSourcePropType } from 'react-native';
import type { PgDetail, PgListItem, PgPhoto, PgRoomType } from '../../modules/pg/pgApi';

export interface V2Photo {
  key: string;
  source: ImageSourcePropType | { uri: string };
  caption: string;
  isRepresentativePhoto: boolean;
}

/* eslint-disable @typescript-eslint/no-require-imports */
/** Hero slider: modern blocks with the sky removed locally (magic-wand flood fill), violet glow and ground
 *  shadow baked in. Sources: Unsplash 1748534262365, 1586381084141, 1564471925181 (Unsplash License). */
const HERO_SLIDES = [
  require('./assets/pg-v2-hero-slide-cream-balconies-dusk-2026-10-24.webp'),
  require('./assets/pg-v2-hero-slide-white-wood-blocks-2026-10-24.webp'),
  require('./assets/pg-v2-hero-slide-white-wood-glass-2026-10-24.webp'),
];
/** Daylight mid-rise blocks with balconies and greenery (reference style). */
const BUILDINGS = [
  require('./assets/pg-v2-building-white-balconies-plants-day-2026-10-24.webp'),
  require('./assets/pg-v2-building-pink-trees-day-wide-2026-10-24.webp'),
  require('./assets/pg-v2-building-modern-midrise-greenery-2026-10-24.webp'),
  require('./assets/pg-v2-building-hostel-block-trees-2026-10-24.webp'),
  require('./assets/pg-v2-building-classic-balconies-trees-2026-10-24.webp'),
  require('./assets/pg-v2-building-balconies-courtyard-2026-10-24.webp'),
];
const ROOM_SINGLE = require('./assets/pg-v2-room-single-desk-window-2026-10-24.webp');
const ROOM_SINGLE_2 = require('./assets/pg-v2-room-single-bright-chair-2026-10-24.webp');
const ROOM_DOUBLE = require('./assets/pg-v2-room-double-two-beds-2026-10-24.webp');
const ROOM_DOUBLE_2 = require('./assets/pg-v2-room-double-wood-wardrobe-2026-10-24.webp');
const ROOM_TRIPLE = require('./assets/pg-v2-room-triple-three-beds-2026-10-24.webp');
const ROOM_DORM = require('./assets/pg-v2-room-dorm-white-bunks-2026-10-24.webp');
const WASHROOM = require('./assets/pg-v2-washroom-clean-2026-10-24.webp');
const MESS = require('./assets/pg-v2-mess-dining-bright-2026-10-24.webp');
const LOUNGE = require('./assets/pg-v2-common-lounge-warm-2026-10-24.webp');
/* eslint-enable @typescript-eslint/no-require-imports */

const stock = (key: string, source: ImageSourcePropType, caption: string): V2Photo => ({ key, source, caption, isRepresentativePhoto: true });
const real = (p: { id?: string; url: string; caption?: string }): V2Photo => ({ key: p.id || p.url, source: { uri: p.url }, caption: p.caption || '', isRepresentativePhoto: false });

/** Stable small hash so one PG always gets the same stock building. */
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const heroSlides = (): V2Photo[] => HERO_SLIDES.map((src, i) => stock(`hero-${i}`, src, 'Modern apartment building'));

/** A PG's building photo: its own BUILDING photo when uploaded, else a same-type stock exterior. */
export const buildingPhoto = (pg: Pick<PgListItem, 'id'> & { photos?: PgPhoto[] }, offset = 0): V2Photo => {
  const own = (pg.photos || []).find((p) => p.category === 'BUILDING');
  if (own) return real(own);
  return stock(`b-${pg.id}-${offset}`, BUILDINGS[(hash(pg.id) + offset) % BUILDINGS.length], 'Building');
};

/** Stock room interior by sharing (1 single, 2 double, 3 triple, 4+ dormitory). */
const stockRoom = (sharing: number, alt = false) => {
  if (sharing <= 1) return alt ? ROOM_SINGLE_2 : ROOM_SINGLE;
  if (sharing === 2) return alt ? ROOM_DOUBLE_2 : ROOM_DOUBLE;
  if (sharing === 3) return ROOM_TRIPLE;
  return ROOM_DORM;
};

/** Photos for one room type: the PG's photos tagged with that type first, else stock of the same type. */
export const roomPhotos = (pg: Pick<PgDetail, 'id' | 'photos'> | null, t: Pick<PgRoomType, 'key' | 'sharingType'>): V2Photo[] => {
  const own = (pg?.photos || []).filter((p) => p.roomType === t.key || (p.category === 'ROOM' && !p.roomType));
  if (own.length) return own.map(real);
  // Alternate the two variants per PG so neighbouring cards don't repeat one photo.
  const flip = hash(`${pg?.id || ""}:${t.key}:${(pg?.id || "").slice(-3)}`) % 2 === 1;
  const list = [
    stock(`r-${t.key}-a`, stockRoom(t.sharingType, flip), 'Room'),
    stock(`r-${t.key}-b`, stockRoom(t.sharingType, !flip), 'Room'),
    stock(`r-${t.key}-w`, WASHROOM, 'Washroom'),
    stock(`r-${t.key}-c`, LOUNGE, 'Common area'),
    stock(`r-${t.key}-m`, MESS, 'Mess and dining'),
  ];
  return list.filter((p, i) => list.findIndex((q) => q.source === p.source) === i);
};

export const roomCover = (pg: Pick<PgDetail, 'id' | 'photos'> | null, t: Pick<PgRoomType, 'key' | 'sharingType'>) => roomPhotos(pg, t)[0];

/** Gallery for a PG: its own categorised photos when it has them, else building, room, washroom, common, mess. */
export const galleryPhotos = (pg: PgDetail): V2Photo[] => {
  const own = (pg.photos || []).filter((p) => p.category !== 'OTHER');
  if (own.length >= 3) return own.map(real);
  const firstSharing = pg.roomTypes[0]?.sharingType ?? 2;
  return [
    buildingPhoto(pg),
    stock(`g-${pg.id}-room`, stockRoom(firstSharing), 'Room'),
    stock(`g-${pg.id}-wash`, WASHROOM, 'Washroom'),
    stock(`g-${pg.id}-common`, LOUNGE, 'Common area'),
    stock(`g-${pg.id}-mess`, MESS, 'Mess and dining'),
    buildingPhoto(pg, 1),
  ];
};

export const messPhoto = (): V2Photo => stock('mess', MESS, 'Mess and dining');

