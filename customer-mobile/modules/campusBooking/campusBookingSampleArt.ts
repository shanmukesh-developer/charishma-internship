/**
 * In-Campus Booking sample photos (campusBookingDemo.ts). Every photo is a free photo under the Unsplash License
 * (images.unsplash.com/photo-*, found with the "free" licence filter, not Unsplash+): free commercial use,
 * modification allowed, no attribution required (credited here anyway). Credits:
 * https://unsplash.com/photos/<photo id> (id after each file). Each photo is used once in the app.
 *
 * Stall photos: centre-cropped to the 200 pt stall hero shape and saved 1260 x 672 (the bakery 1125 x 600, to stay
 * near 120 KB), so the hero is about 3x on a phone and the 68 pt list photo is far above 3x.
 * Item photos: centre-cropped square (two tightened on the subject), 540 x 540, more than 3x the 168 pt sample
 * sheet photo and the 90 pt menu photo. Light sharpening, WebP quality 82 to 88, every file under ~120 KB.
 *
 *   stall chai-counter                1769598248612-8cdb150725dd   stall juice-bar                   1780409903230-5d7c9d13f745
 *   stall dosa-counter                1787024231387-edccb8c44700   stall bakery-corner               1568254183919-78a4f43a2877
 *   stall stationery-xerox            1774878520736-6cacbcce1b7b   stall fruit-bowl                  1762474453560-5cf30f20bc8e
 *   stall sandwich-grill              1540713434306-58505cf1b6fc   stall ice-cream                   1567206563064-6f60f40a2b57
 *   item masala-chai                  1630748662359-40a2105640c7   item filter-coffee                1758387941825-a6ecaec9c14d
 *   item samosa                       1601050690597-df0568f70950   item onion-pakoda                 1765360024331-25b63e85272e
 *   item watermelon-juice             1680954464671-6191ab264214   item mosambi-juice                1613478223719-2ab802602423
 *   item pineapple-juice              1705246535138-953e01125cb0   item banana-milkshake             1707219811295-0f283760668b
 *   item lemon-soda                   1621330716555-5cad596c4562   item plain-dosa                   1743615467363-250466982515
 *   item masala-dosa                  1668236543090-82eba5ee5976   item ghee-roast-dosa              1791209135209-5fe1e8295b47
 *   item idli                         1632104667384-06f58cb7ad44   item medu-vada                    1730191843435-073792ba22bc
 *   item veg-puff                     1682263167429-0dbcf2c1e127   item chocolate-muffin             1685100979994-b6f8384c345c
 *   item plum-cake                    1537029415773-e79d5d8e68d3   item osmania-biscuits             1600625649542-f668edc636dc
 *   item cream-puff                   1786918467116-045c0f772b1f   item a4-paper                     1516409590654-e8d51fc2d25c
 *   item spiral-notebook              1531346878377-a5be20888e57
 *   item long-notebook                1787640619073-3dcb10c316c4   item highlighters                 1567855354833-ac2c4f967b0c
 *   item mixed-fruit-bowl             1641642400143-6be68f1a0918   item papaya-bowl                  1552427085-45d07c9e950d
 *   item fruit-chaat                  1774041877283-a3aaad1f2ad2   item sprouts-salad                1622732777601-e744c3401d44
 *   item pomegranate-cup              1764570208520-9c3dae3e467d   item veg-sandwich                 1539252554453-80ab65ce3586
 *   item grilled-cheese-sandwich      1528736235302-52922df5c122   item corn-cheese-sandwich         1528735602780-2552fd46c7af
 *   item chicken-sandwich             1785960072741-a049c641f795   item french-fries                 1630384060421-cb20d0e0649d
 *   item vanilla-scoop                1560008581-09826d1de69e      item chocolate-cone               1562790879-dfde82829db0
 *   item strawberry-cone              1497034825429-c343d7c6a68f   item mango-scoop                  1570197788417-0e82375c9371
 *   item falooda                      1630823184409-1c6014968038
 *
 * Files: assets/cb-sample-<stall|item>-<name>-2026-10-27.webp.
 */
import type { ImageSourcePropType } from 'react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
export const CB_SAMPLE_ART = {
  stallChaiCounter: require('./assets/cb-sample-stall-chai-counter-2026-10-27.webp'),
  stallJuiceBar: require('./assets/cb-sample-stall-juice-bar-2026-10-27.webp'),
  stallDosaCounter: require('./assets/cb-sample-stall-dosa-counter-2026-10-27.webp'),
  stallBakeryCorner: require('./assets/cb-sample-stall-bakery-corner-2026-10-27.webp'),
  stallStationeryXerox: require('./assets/cb-sample-stall-stationery-xerox-2026-10-27.webp'),
  stallFruitBowl: require('./assets/cb-sample-stall-fruit-bowl-2026-10-27.webp'),
  stallSandwichGrill: require('./assets/cb-sample-stall-sandwich-grill-2026-10-27.webp'),
  stallIceCream: require('./assets/cb-sample-stall-ice-cream-2026-10-27.webp'),
  masalaChai: require('./assets/cb-sample-item-masala-chai-2026-10-27.webp'),
  filterCoffee: require('./assets/cb-sample-item-filter-coffee-2026-10-27.webp'),
  samosa: require('./assets/cb-sample-item-samosa-2026-10-27.webp'),
  onionPakoda: require('./assets/cb-sample-item-onion-pakoda-2026-10-27.webp'),
  watermelonJuice: require('./assets/cb-sample-item-watermelon-juice-2026-10-27.webp'),
  mosambiJuice: require('./assets/cb-sample-item-mosambi-juice-2026-10-27.webp'),
  pineappleJuice: require('./assets/cb-sample-item-pineapple-juice-2026-10-27.webp'),
  bananaMilkshake: require('./assets/cb-sample-item-banana-milkshake-2026-10-27.webp'),
  lemonSoda: require('./assets/cb-sample-item-lemon-soda-2026-10-27.webp'),
  plainDosa: require('./assets/cb-sample-item-plain-dosa-2026-10-27.webp'),
  masalaDosa: require('./assets/cb-sample-item-masala-dosa-2026-10-27.webp'),
  gheeRoastDosa: require('./assets/cb-sample-item-ghee-roast-dosa-2026-10-27.webp'),
  idli: require('./assets/cb-sample-item-idli-2026-10-27.webp'),
  meduVada: require('./assets/cb-sample-item-medu-vada-2026-10-27.webp'),
  vegPuff: require('./assets/cb-sample-item-veg-puff-2026-10-27.webp'),
  chocolateMuffin: require('./assets/cb-sample-item-chocolate-muffin-2026-10-27.webp'),
  plumCake: require('./assets/cb-sample-item-plum-cake-2026-10-27.webp'),
  osmaniaBiscuits: require('./assets/cb-sample-item-osmania-biscuits-2026-10-27.webp'),
  creamPuff: require('./assets/cb-sample-item-cream-puff-2026-10-27.webp'),
  xeroxPaper: require('./assets/cb-sample-item-xerox-paper-2026-10-27.webp'),
  spiralBinding: require('./assets/cb-sample-item-spiral-binding-2026-10-27.webp'),
  longNotebook: require('./assets/cb-sample-item-long-notebook-2026-10-27.webp'),
  highlighters: require('./assets/cb-sample-item-highlighters-2026-10-27.webp'),
  mixedFruitBowl: require('./assets/cb-sample-item-mixed-fruit-bowl-2026-10-27.webp'),
  papayaBowl: require('./assets/cb-sample-item-papaya-bowl-2026-10-27.webp'),
  fruitChaat: require('./assets/cb-sample-item-fruit-chaat-2026-10-27.webp'),
  sproutsSalad: require('./assets/cb-sample-item-sprouts-salad-2026-10-27.webp'),
  pomegranateCup: require('./assets/cb-sample-item-pomegranate-cup-2026-10-27.webp'),
  vegSandwich: require('./assets/cb-sample-item-veg-sandwich-2026-10-27.webp'),
  grilledCheeseSandwich: require('./assets/cb-sample-item-grilled-cheese-sandwich-2026-10-27.webp'),
  cornCheeseSandwich: require('./assets/cb-sample-item-corn-cheese-sandwich-2026-10-27.webp'),
  chickenSandwich: require('./assets/cb-sample-item-chicken-sandwich-2026-10-27.webp'),
  frenchFries: require('./assets/cb-sample-item-french-fries-2026-10-27.webp'),
  vanillaScoop: require('./assets/cb-sample-item-vanilla-scoop-2026-10-27.webp'),
  chocolateCone: require('./assets/cb-sample-item-chocolate-cone-2026-10-27.webp'),
  strawberryCone: require('./assets/cb-sample-item-strawberry-cone-2026-10-27.webp'),
  mangoScoop: require('./assets/cb-sample-item-mango-scoop-2026-10-27.webp'),
  falooda: require('./assets/cb-sample-item-falooda-2026-10-27.webp'),
} satisfies Record<string, ImageSourcePropType>;

export type CbSampleArtKey = keyof typeof CB_SAMPLE_ART;
