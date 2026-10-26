/**
 * Deals & spin v2 sample layer (owner decision, 25 Oct 2026: "mock data with great images, to show users").
 *
 * One switch: DEALS_V2_DEMO_CONTENT. While it is on, sample "today's deals" cards follow the real deals so the row
 * looks alive while the admin has few deals live. Each sample carries `isSample: true`: the card shows a small
 * "Sample" tag and a tap opens a polite "sample deal" sheet. Samples never reach the claim endpoint.
 * NEVER samples for coupons, prizes, spins, ZenPoints or wallet balances: those are money-like and always real.
 *
 * Photos: free Unsplash License photos (images.unsplash.com/photo-*, not Unsplash+), cropped to 4:3 and saved as
 * WebP. One photo per card, used nowhere else in the app. Credits: unsplash.com/photos/<photo id>
 *   samosa 1601050690597-df0568f70950 · donuts 1551024601-bec78aea704b · coffee 1495474472287-4d71bcdd2085
 *   penne 1621996346565-e3dbc646d9a9 · brownie 1606313564200-e75d5e30476c · salad 1512621776951-a57141f2eefd
 */
import type { ImageSourcePropType } from 'react-native';

export const DEALS_V2_DEMO_CONTENT = true;

export interface SampleDeal {
  id: string;
  isSample: true;
  name: string;
  store: string;
  tag: string;
  minOrder: number;
  left: number;
  streak?: number;
  art: ImageSourcePropType;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const SAMPLES: SampleDeal[] = [
  { id: 'sample-samosa', isSample: true, name: 'Samosa and chai for two', store: 'Campus canteen', tag: '₹30 off', minOrder: 149, left: 18, art: require('./assets/dv2-sample-deal-samosa-chai-hd-2026-10-26.webp') },
  { id: 'sample-penne', isSample: true, name: 'Penne arrabbiata bowl', store: 'Night kitchen', tag: '₹50 off', minOrder: 299, left: 9, art: require('./assets/dv2-sample-deal-penne-arrabbiata-hd-2026-10-26.webp') },
  { id: 'sample-coffee', isSample: true, name: 'Two cold coffees', store: 'Library café', tag: 'Free delivery', minOrder: 199, left: 24, art: require('./assets/dv2-sample-deal-coffee-cheers-hd-2026-10-26.webp') },
  { id: 'sample-donuts', isSample: true, name: 'Box of four glazed donuts', store: 'Campus bakery', tag: '₹40 off', minOrder: 249, left: 6, streak: 3, art: require('./assets/dv2-sample-deal-donut-stack-hd-2026-10-26.webp') },
  { id: 'sample-brownie', isSample: true, name: 'Fudge brownie box', store: 'Campus bakery', tag: '₹60 off', minOrder: 349, left: 12, art: require('./assets/dv2-sample-deal-brownie-drizzle-hd-2026-10-26.webp') },
  { id: 'sample-salad', isSample: true, name: 'Rainbow salad bowl', store: 'Fresh bowls', tag: '₹35 off', minOrder: 199, left: 15, art: require('./assets/dv2-sample-deal-salad-bowl-hd-2026-10-26.webp') },
];

export const sampleDeals = (): SampleDeal[] => (DEALS_V2_DEMO_CONTENT ? SAMPLES : []);
export const isSampleDeal = (d: any): d is SampleDeal => !!d && d.isSample === true;
