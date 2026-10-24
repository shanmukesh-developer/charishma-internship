import { Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Top padding for a screen header under the edge-to-edge status bar.
 *
 * Screens used a fixed 40 (Android) / 50 (iOS, web). That stays the minimum, so normal phones look
 * exactly the same; a taller status bar (punch-hole, notch, large display size) pushes the header
 * down by the real inset instead of letting it sit under the clock.
 *
 * On Android the status-bar height (StatusBar.currentHeight) is the floor for the inset: the safe-area
 * inset can read 0 (first frames before the provider has measured, some OEM edge-to-edge builds), and
 * a header must never start under the clock because of that.
 */
export function useTopInset(androidBase = 40, otherBase = 50): number {
  const insets = useSafeAreaInsets();
  const base = Platform.OS === 'android' ? androidBase : otherBase;
  const top = Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0);
  return Math.max(base, Math.round(top) + 8);
}
