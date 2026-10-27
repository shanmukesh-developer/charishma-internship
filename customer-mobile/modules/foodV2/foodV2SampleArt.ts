/**
 * Food & groceries v2 sample photos (foodV2Demo.ts). Every photo is a free photo under the Unsplash License
 * (images.unsplash.com/photo-*, not Unsplash+): free commercial use, modification allowed, no attribution required
 * (credited here anyway). Each was centre-cropped to a square, resized to 720 x 720 (more than 3x the 168 pt sample
 * sheet photo and the 76 pt list plate) with light sharpening, and saved as WebP quality 86. Each photo is used once
 * in the app. Credits: https://unsplash.com/photos/<photo id> (id after each file).
 *
 *   seeds-coriander          1588879460618-9249e7d947d1   seeds-palak              1576045057995-568f588f82fb
 *   seeds-tulsi              1630081015294-05e6a3044eeb   seeds-marigold           1761847516314-8119e020be98
 *   seeds-microgreens-kit    1536630596251-b12ba0d9f7d4   organic-jaggery          1788238025855-55581a2ed354
 *   organic-toor-dal         1701166175567-2f55dd40e662   organic-raw-honey        1587049352851-8d4e89133924
 *   organic-foxtail-millet   1792130910504-a5226d9a98ab   wellness-tulsi-green-tea 1627435601361-ec25f5b1d0e5
 *   wellness-turmeric-milk   1669219695489-9163d12a2611   wellness-kadha-mix       1643067077447-78239a403a18
 *   wellness-ginger-lemon-tea 1682530016814-6a1c1311cd6e  fitness-hex-dumbbells    1638536532686-d610adfc8e5c
 *   fitness-shaker-bottle    1642539088032-41a1fb000bc5   fitness-gym-gloves       1557127972-1c446ea89ea5
 *   fitness-foam-roller      1653617748437-895c016e88b1   toys-pull-back-cars      1532330393533-443990a51d10
 *   toys-school-bus          1581277868137-9dc9f38abc2c   toys-alphabet-blocks     1558907353-ceb54f3882ed
 *   toys-science-kit         1613271752699-ede48a285196   sports-volleyball        1497939902741-848a16f92f9e
 *   sports-table-tennis      1611251135345-18c56206b863   sports-flying-disc       1649772317307-988009f89c2f
 *   games-ludo-board         1642056448488-906d3511fe96   games-carrom-board       1617300067484-314ed2cfd9a6
 */
import type { ImageSourcePropType } from 'react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
export const SAMPLE_ART = {
  coriander: require('./assets/food-v2-sample-seeds-coriander-2026-10-27.webp'),
  spinach: require('./assets/food-v2-sample-seeds-palak-2026-10-27.webp'),
  basil: require('./assets/food-v2-sample-seeds-tulsi-2026-10-27.webp'),
  marigold: require('./assets/food-v2-sample-seeds-marigold-2026-10-27.webp'),
  microgreens: require('./assets/food-v2-sample-seeds-microgreens-kit-2026-10-27.webp'),
  jaggery: require('./assets/food-v2-sample-organic-jaggery-2026-10-27.webp'),
  toorDal: require('./assets/food-v2-sample-organic-toor-dal-2026-10-27.webp'),
  honey: require('./assets/food-v2-sample-organic-raw-honey-2026-10-27.webp'),
  millet: require('./assets/food-v2-sample-organic-foxtail-millet-2026-10-27.webp'),
  greenTea: require('./assets/food-v2-sample-wellness-tulsi-green-tea-2026-10-27.webp'),
  turmericMilk: require('./assets/food-v2-sample-wellness-turmeric-milk-2026-10-27.webp'),
  kadha: require('./assets/food-v2-sample-wellness-kadha-mix-2026-10-27.webp'),
  gingerTea: require('./assets/food-v2-sample-wellness-ginger-lemon-tea-2026-10-27.webp'),
  dumbbells: require('./assets/food-v2-sample-fitness-hex-dumbbells-2026-10-27.webp'),
  shaker: require('./assets/food-v2-sample-fitness-shaker-bottle-2026-10-27.webp'),
  gymGloves: require('./assets/food-v2-sample-fitness-gym-gloves-2026-10-27.webp'),
  foamRoller: require('./assets/food-v2-sample-fitness-foam-roller-2026-10-27.webp'),
  toyCars: require('./assets/food-v2-sample-toys-pull-back-cars-2026-10-27.webp'),
  toyBus: require('./assets/food-v2-sample-toys-school-bus-2026-10-27.webp'),
  alphabetBlocks: require('./assets/food-v2-sample-toys-alphabet-blocks-2026-10-27.webp'),
  scienceKit: require('./assets/food-v2-sample-toys-science-kit-2026-10-27.webp'),
  volleyball: require('./assets/food-v2-sample-sports-volleyball-2026-10-27.webp'),
  tableTennis: require('./assets/food-v2-sample-sports-table-tennis-2026-10-27.webp'),
  frisbee: require('./assets/food-v2-sample-sports-flying-disc-2026-10-27.webp'),
  ludo: require('./assets/food-v2-sample-games-ludo-board-2026-10-27.webp'),
  carrom: require('./assets/food-v2-sample-games-carrom-board-2026-10-27.webp'),
} satisfies Record<string, ImageSourcePropType>;

export type SampleArtKey = keyof typeof SAMPLE_ART;
