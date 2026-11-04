import type { SplashStyle } from '../adSplashApi';
import type { StyleDef } from './types';
import { tear } from './Tear';
import { scratch } from './Scratch';
import { envelope } from './Envelope';
import { gift } from './Gift';
import { glass } from './Glass';
import { coupon } from './Coupon';
import { portal } from './Portal';
import { peel } from './Peel';

export const STYLES: Record<SplashStyle, StyleDef> = { tear, scratch, envelope, gift, glass, coupon, portal, peel };
