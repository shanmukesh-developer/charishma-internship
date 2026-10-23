import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Top padding for a screen header under the edge-to-edge status bar.
 *
 * Screens used a fixed 40 (Android) / 50 (iOS, web). That stays the minimum, so normal phones look
 * exactly the same; a taller status bar (punch-hole, notch, large display size) pushes the header
 * down by the real inset instead of letting it sit under the clock.
 */
export function useTopInset(androidBase = 40, otherBase = 50): number {
  const insets = useSafeAreaInsets();
  const base = Platform.OS === 'android' ? androidBase : otherBase;
  return Math.max(base, Math.round(insets.top) + 8);
}
