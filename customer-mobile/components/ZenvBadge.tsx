import React from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

/**
 * The ZENV badge (owner, 4 Nov 2026): a yellow disc (#FAE04B) with the scooter rider holding a box and "ZENV" in
 * navy (#0F3960) under him. One 512 px source whose disc fills the whole square (transparent corners only).
 *
 * One treatment everywhere (headers, onboarding, sign-in, About, the world transition, the intro fallback): the disc
 * fills its own circle edge to edge, no ring, no padding, no gap; its yellow edge reads as a coin. The box behind it
 * is the same yellow, so the round edge never shows a dark fringe. `lift` adds a soft shadow on light backgrounds.
 * Keep `size` a whole number so the disc lands on whole pixels.
 */
export const ZENV_BADGE = require('../assets/zenv-brand-badge-2026-11-04.webp');
export const ZENV_YELLOW = '#FAE04B';
export const ZENV_NAVY = '#0F3960';

export default function ZenvBadge({ size, lift, label, style }: {
  size: number;
  /** Soft drop shadow, for light backgrounds where yellow on white needs a little depth. */
  lift?: boolean;
  /** Spoken label. Leave it out where the word "ZENV" is already next to the badge (it is then decorative). */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const d = Math.round(size);
  const disc = { width: d, height: d, borderRadius: d / 2 };
  const image = (
    <View style={[disc, { overflow: 'hidden', backgroundColor: ZENV_YELLOW }]}>
      <Image source={ZENV_BADGE} style={{ width: d, height: d }} contentFit="cover" transition={0} cachePolicy="memory-disk" accessible={false} />
    </View>
  );
  return (
    <View
      style={[disc, { backgroundColor: ZENV_YELLOW }, lift ? LIFT : null, style]}
      accessible={!!label}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    >
      {image}
    </View>
  );
}

const LIFT: ViewStyle = Platform.select<ViewStyle>({
  web: { boxShadow: '0px 3px 10px rgba(15,57,96,0.18)' } as ViewStyle,
  default: { shadowColor: ZENV_NAVY, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 4 },
}) as ViewStyle;
