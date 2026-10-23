import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

// First launch after install: the onboarding (once). It sets `zenvy_onboarded`; a user who is already
// signed in (an update, not a fresh install) never sees it. Storage errors fall through to Home.
export default function Index() {
  const [target, setTarget] = useState<'/(tabs)' | '/onboarding' | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      let next: '/(tabs)' | '/onboarding' = '/(tabs)';
      try {
        const [seen, legacySeen, user] = await Promise.all([
          AsyncStorage.getItem('zenvy_onboarded'),
          AsyncStorage.getItem('has_seen_onboarding'),
          AsyncStorage.getItem('zenvy_user'),
        ]);
        if (!seen && !legacySeen) {
          if (user) AsyncStorage.setItem('zenvy_onboarded', 'true').catch(() => {});
          else next = '/onboarding';
        }
      } catch { /* storage unavailable: go straight to Home */ }
      if (alive) setTarget(next);
    })();
    return () => { alive = false; };
  }, []);
  if (!target) return <View style={{ flex: 1 }} />;
  return <Redirect href={target as any} />;
}
