/** Deals & spin v2 · one coupon: code, terms and Apply (modules/dealsV2). */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import DealsV2Route from '../../../modules/dealsV2/DealsV2Route';
import { CouponDetail } from '../../../modules/dealsV2/DealsV2Coupons';

export default function DealsCouponRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <DealsV2Route><CouponDetail code={String(code || '')} /></DealsV2Route>;
}
