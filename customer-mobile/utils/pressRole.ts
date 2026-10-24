import { Platform } from 'react-native';

/**
 * accessibilityRole for tappable cards and buttons.
 * On web, react-native-web renders role "button" as a real <button>, and a card that is a button with a heart or
 * "+" button inside it becomes an invalid <button> inside <button> (React warns, and the browser can split the
 * DOM). Phones keep the role for screen readers; web drops it (the element stays clickable and focusable).
 */
export const BUTTON_ROLE = Platform.OS === 'web' ? undefined : ('button' as const);

export function pressRole<T extends string>(role: T): T | undefined {
  return Platform.OS === 'web' && role === 'button' ? undefined : role;
}
