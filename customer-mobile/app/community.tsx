import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Old Community screen (posts, The Wall, Whispers & 9 PM). It was folded into Campus > Friends > Pulse,
 * so Campus is the one entry for the social side of the app. Kept as a redirect so old links,
 * notifications and announcements still land in the right place:
 *   /community                 -> /friends?tab=friends&sub=pulse
 *   /community?segment=wall    -> The Wall (Campus moments)
 *   /community?segment=posts   -> Birthdays and stories
 *   /community?screen=whispers|nightQuestion|branchWars -> that sheet inside Campus
 */
export default function CommunityRedirect() {
  const params = useLocalSearchParams<{ segment?: string; screen?: string }>();
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : typeof v === 'string' ? v : undefined);
  const segment = one(params.segment);
  const screen = one(params.screen);
  const parts = ['tab=friends', 'sub=pulse'];
  if (segment === 'wall' || segment === 'posts' || segment === 'pulse') parts.push(`segment=${segment}`);
  if (screen === 'whispers' || screen === 'nightQuestion' || screen === 'branchWars') parts.push(`screen=${screen}`);
  return <Redirect href={`/friends?${parts.join('&')}` as any} />;
}
