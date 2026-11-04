/**
 * Tech & repairs v2 art. Every photo is a free Unsplash photo under the Unsplash License (free commercial use,
 * modification allowed; images.unsplash.com/photo-*, not Unsplash+), cover-cropped locally and exported as WebP at
 * three times its drawn size (heroes 1050 x 510, tiles 540 x 330). One picture per place, never repeated.
 * Catalogue rows use the server's own item photos (via SafeImage), not these files.
 *
 * Credits (file, photographer, page):
 *   sv2-home-hero-laptop-repair-hands       Samsung Memory    unsplash.com/photos/a-person-working-on-a-laptop-with-a-screwdriver-6RcDLyy0s1I
 *   sv2-repairs-hero-laptop-tools           Revendo           unsplash.com/photos/a-man-working-on-a-laptop-with-a-pair-of-scissors-KhnRiIAgvsI
 *   sv2-tile-repairs-laptop-board           Andrey Matveev    unsplash.com/photos/the-motherboard-of-a-laptop-is-being-dismantled-V_ESJ2MM2Us
 *   sv2-tailoring-hero-blue-machine         Roman Spiridonov  unsplash.com/photos/person-sewing-using-sewing-machine-qI9H5nyhrV8
 *   sv2-tile-tailoring-fabric-stitch        Phil Hearing      unsplash.com/photos/hands-operating-a-sewing-machine-on-fabric-9m6eykr9_vU
 *   sv2-laundry-hero-washers-row            Oli Woodman       unsplash.com/photos/white-front-load-washing-machines-f4jsI88K7ds
 *   sv2-tile-laundry-folded-shirts          Dan LeFebvre      unsplash.com/photos/a-stack-of-folded-shirts-sitting-on-top-of-a-blue-table-APUvZYCjPJ0
 *   sv2-room-hero-white-bed-orange-throw    Spacejoy          unsplash.com/photos/white-bed-with-orange-blanket-9xoQJ-3-HGs
 *   sv2-tile-room-bed-desk                  Spacejoy          unsplash.com/photos/a-bedroom-with-a-bed-and-a-desk-808a4AWu8jE
 *   sv2-gadgets-hero-headphones-indigo-lift YearOne (shadows lifted toward indigo locally) unsplash.com/photos/a-pair-of-headphones-on-a-black-surface-FgXBVIhr5Ik
 *   sv2-tile-gadgets-headphones-desk        Sam Grozyan       unsplash.com/photos/black-wireless-headphones-on-white-desk-P7KF3cTRKcE
 *   Type photos (rows and details of catalogue items that have no photo of their own; 1080 x 600):
 *   sv2-type-laundry-dryclean-suit-jackets  Waldemar Brandt   unsplash.com/photos/assorted-color-formal-suit-jackets-Db4d6MRIXJc
 *   sv2-type-laundry-ironing-shirt          Anton Savinov     unsplash.com/photos/a-close-up-of-a-person-ironing-a-shirt-gemRf7XA7hs
 *   sv2-type-laundry-wash-basket            Annie Spratt      unsplash.com/photos/white-textile-in-blue-plastic-container-i-FLUApz3Ts
 *   sv2-type-laundry-bedding-pillows        Priscilla Du Preez unsplash.com/photos/white-pillows-and-bed-comforter--R2uNyGmeM4
 *   sv2-type-laundry-shoes-brush            Ervan M Wirawan   unsplash.com/photos/a-pair-of-white-shoes-next-to-a-white-shoe-brush-Z0KXvonqYZc
 *   sv2-type-repairs-laptop-hands           Revendo           unsplash.com/photos/a-person-holding-a-laptop-7x0dGJqbfgk
 *   sv2-type-repairs-phone-open             Fotografia Lui Vlad unsplash.com/photos/a-disassembled-iphone-and-repair-tools-on-a-mat-A-EtdVkNSCA
 *   sv2-type-repairs-checkup-bench          Albert Vinas      unsplash.com/photos/a-person-using-a-cell-phone-to-repair-a-laptop-F3t-AzyTbyU
 *   sv2-type-tailoring-tape-scissors        pina messina      unsplash.com/photos/white-tape-measure-and-gray-scissors-qQKv7r1BaRw
 *   sv2-type-tailoring-thread-spools        Darling Arias     unsplash.com/photos/threads-with-spools-beside-scissors-tX62O5F3AfU
 *   sv2-type-tailoring-zippers-red-blue     Tomas Sobek       unsplash.com/photos/photo-of-red-and-blue-zippers-nVqNmnAWz3A
 *   sv2-type-room-white-bed                 Liz Vo            unsplash.com/photos/a-bed-with-white-sheets-and-white-pillows-pl3sj3DigxM
 *   sv2-type-gadgets-power-adapter          Rebecca Aldama    unsplash.com/photos/white-power-adapter-G_GaeDNyMe8
 */
import type { ImageSourcePropType } from 'react-native';
import type { ShelfId } from './servicesV2Data';
import { resolveServiceForm } from '../services/serviceForms';

/* eslint-disable @typescript-eslint/no-require-imports */
export const ZCS_EMBLEM: ImageSourcePropType = require('../../assets/zenwe-brand-badge-2026-11-04.webp');

/** The home hero (Laptop and phone repairs). */
export const HOME_HERO: ImageSourcePropType = require('./assets/sv2-home-hero-laptop-repair-hands-2026-10-26.webp');

/** Hero photo of each list screen. */
export const SHELF_HERO: Record<ShelfId, ImageSourcePropType> = {
  repairs: require('./assets/sv2-repairs-hero-laptop-tools-2026-10-26.webp'),
  tailoring: require('./assets/sv2-tailoring-hero-blue-machine-2026-10-26.webp'),
  laundry: require('./assets/sv2-laundry-hero-washers-row-2026-10-26.webp'),
  mattresses: require('./assets/sv2-room-hero-white-bed-orange-throw-2026-10-26.webp'),
  electronics: require('./assets/sv2-gadgets-hero-headphones-indigo-lift-2026-10-26.webp'),
};

/** Quick-category tile photo on the home. */
export const SHELF_TILE: Record<ShelfId, ImageSourcePropType> = {
  repairs: require('./assets/sv2-tile-repairs-laptop-board-2026-10-26.webp'),
  tailoring: require('./assets/sv2-tile-tailoring-fabric-stitch-2026-10-26.webp'),
  laundry: require('./assets/sv2-tile-laundry-folded-shirts-2026-10-26.webp'),
  mattresses: require('./assets/sv2-tile-room-bed-desk-2026-10-26.webp'),
  electronics: require('./assets/sv2-tile-gadgets-headphones-desk-2026-10-26.webp'),
};

/** Type photos for catalogue items that have no photo of their own (or whose photo fails to load). */
const TYPE = {
  dryclean: require('./assets/sv2-type-laundry-dryclean-suit-jackets-2026-10-26.webp'),
  ironing: require('./assets/sv2-type-laundry-ironing-shirt-2026-10-26.webp'),
  wash: require('./assets/sv2-type-laundry-wash-basket-2026-10-26.webp'),
  bedding: require('./assets/sv2-type-laundry-bedding-pillows-2026-10-26.webp'),
  shoes: require('./assets/sv2-type-laundry-shoes-brush-2026-10-26.webp'),
  laptop: require('./assets/sv2-type-repairs-laptop-hands-2026-10-26.webp'),
  phone: require('./assets/sv2-type-repairs-phone-open-2026-10-26.webp'),
  checkup: require('./assets/sv2-type-repairs-checkup-bench-2026-10-26.webp'),
  alter: require('./assets/sv2-type-tailoring-tape-scissors-2026-10-26.webp'),
  stitch: require('./assets/sv2-type-tailoring-thread-spools-2026-10-26.webp'),
  zip: require('./assets/sv2-type-tailoring-zippers-red-blue-2026-10-26.webp'),
  room: require('./assets/sv2-type-room-white-bed-2026-10-26.webp'),
  gadget: require('./assets/sv2-type-gadgets-power-adapter-2026-10-26.webp'),
} satisfies Record<string, ImageSourcePropType>;

/** The type photo for an item, from its booking form (services) or its name (products). */
export function typePhoto(shelf: ShelfId, name: string): ImageSourcePropType {
  if (shelf === 'repairs') {
    const id = resolveServiceForm('repairs', name).id;
    return id === 'repairs.phoneScreen' ? TYPE.phone : id === 'repairs.diagnosis' ? TYPE.checkup : TYPE.laptop;
  }
  if (shelf === 'tailoring') {
    const id = resolveServiceForm('tailoring', name).id;
    return id === 'tailoring.zipper' ? TYPE.zip : id === 'tailoring.stitchNew' || id === 'tailoring.repair' || id === 'tailoring.labCoat' ? TYPE.stitch : TYPE.alter;
  }
  if (shelf === 'laundry') {
    const id = resolveServiceForm('laundry', name).id;
    if (id === 'laundry.dryClean') return TYPE.dryclean;
    if (id === 'laundry.shoes' || /shoe|sneaker/i.test(name)) return TYPE.shoes;
    if (id === 'laundry.blanket' || /bedsheet|blanket|quilt/i.test(name)) return TYPE.bedding;
    if (/iron|press/i.test(name) && !/wash/i.test(name)) return TYPE.ironing;
    return TYPE.wash;
  }
  return shelf === 'mattresses' ? TYPE.room : TYPE.gadget;
}
