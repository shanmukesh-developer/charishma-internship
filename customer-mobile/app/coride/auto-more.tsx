/**
 * Co-Ride v2 · more ZCS Auto: My auto bookings, Scheduled / Full auto and Pickup points, served by the existing
 * modules/autoRide section (reused as it is). Also where old links land: others?tab=coride&sub=auto&seg=...
 */
import React from 'react';
import { View, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AutoRideSection from '../../modules/autoRide/AutoRideSection';
import { ScreenHeader } from '../../modules/corideV2/CoRideV2Kit';
import { CR, GUTTER } from '../../modules/corideV2/coRideV2Theme';

const TITLES: Record<string, string> = { bookings: 'My auto bookings', shared: 'Scheduled autos', full: 'Full auto', pickups: 'Pickup points', charge: 'ZCS Auto' };

export default function CoRideAutoMoreRoute() {
  const router = useRouter();
  const { seg } = useLocalSearchParams<{ seg?: string }>();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/coride/auto' as any));
  return (
    <View style={{ flex: 1, backgroundColor: CR.page }}>
      <ScreenHeader title={TITLES[String(seg || '')] || 'ZCS Auto'} sub="ZCS Auto" onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <AutoRideSection />
      </ScrollView>
    </View>
  );
}
