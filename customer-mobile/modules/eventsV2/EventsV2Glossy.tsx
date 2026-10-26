/**
 * Category mark for Campus Events v2 (event fallbacks, the listing banner, the sample sheet). Owner, 26 Oct 2026:
 * the Fluent 3D emoji art looked unofficial, so this is one consistent line-icon set (lucide, the icon set used
 * everywhere else in Events) inside a soft glass circle. The home category tiles use photos (eventsV2Art).
 * `tilt` and `shadow` are kept for older call sites and are ignored.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import ICalendar from 'lucide-react-native/icons/calendar-days';
import IDrama from 'lucide-react-native/icons/drama';
import ITrophy from 'lucide-react-native/icons/trophy';
import IPresentation from 'lucide-react-native/icons/presentation';
import IUsersRound from 'lucide-react-native/icons/users-round';
import type { TileKey } from './eventsV2Theme';

export const CATEGORY_ICON: Record<TileKey, typeof ICalendar> = {
  all: ICalendar,
  cultural: IDrama,
  sports: ITrophy,
  workshops: IPresentation,
  clubs: IUsersRound,
};

export default function GlossyIcon({ kind, size = 52 }: { kind: TileKey; size?: number; tilt?: number; shadow?: boolean }) {
  const Icon = CATEGORY_ICON[kind] || ICalendar;
  return (
    <View
      style={[s.ring, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Icon size={Math.round(size * 0.44)} color="#FFFFFF" strokeWidth={1.6} />
    </View>
  );
}

const s = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.34)' },
});
