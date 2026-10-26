import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Rewards now live in Others → Deals & spin (owner reference, 22 Oct): spin wheel, coupons, daily
 * deals, ZenPoints, wallet and referral in one place. Every old entry point (Profile, checkout,
 * notifications, banners) still opens /rewards and lands there; /rewards?spin=1 opens the spin page
 * (Deals & spin v2, app/deals/spin).
 */
export default function RewardsScreen() {
  const { spin } = useLocalSearchParams<{ spin?: string }>();
  const href = spin ? '/deals/spin' : '/(tabs)/others?tab=promos';
  return <Redirect href={href as any} />;
}
