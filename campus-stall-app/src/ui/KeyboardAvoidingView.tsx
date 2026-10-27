/**
 * App-wide keyboard handling (Android edge-to-edge + iOS), same approach as the customer app.
 *
 * Android 15 / RN 0.86 runs edge-to-edge, so `adjustResize` no longer shrinks the window and React Native's
 * own KeyboardAvoidingView does nothing useful there. These wrappers use react-native-keyboard-controller
 * (needs <KeyboardProvider> in App.tsx), which reads the real keyboard insets on both platforms;
 * `automaticOffset` makes it work below headers and inside Modals / bottom sheets without hand-tuned offsets.
 *
 * KeyboardAvoidingView: drop-in for the React Native one (platform-specific `behavior` /
 * `keyboardVerticalOffset` values written for it are ignored).
 * KeyboardAwareScrollView: a ScrollView that also scrolls the focused input above the keyboard.
 * Web: the browser handles the keyboard, so plain View / ScrollView.
 */
import React from 'react';
import { Platform, ScrollView, View, type ScrollViewProps, type ViewProps } from 'react-native';
import {
  KeyboardAvoidingView as KCKeyboardAvoidingView,
  KeyboardAwareScrollView as KCKeyboardAwareScrollView,
} from 'react-native-keyboard-controller';
import { space } from '../theme';

type Props = ViewProps & {
  behavior?: 'height' | 'position' | 'padding' | 'translate-with-padding';
  keyboardVerticalOffset?: number;
  enabled?: boolean;
  contentContainerStyle?: ViewProps['style'];
  children?: React.ReactNode;
};

export function KeyboardAvoidingView({ behavior, keyboardVerticalOffset: _ignored, enabled = true, ...rest }: Props) {
  if (Platform.OS === 'web') {
    const { contentContainerStyle: _c, ...viewProps } = rest;
    return <View {...viewProps} />;
  }
  return (
    <KCKeyboardAvoidingView
      {...rest}
      enabled={enabled}
      behavior={behavior === 'position' || behavior === 'translate-with-padding' ? behavior : 'padding'}
      automaticOffset
    />
  );
}

/** Scrolls the focused input (e.g. a reject reason under the order details) into view above the keyboard. */
export function KeyboardAwareScrollView({ children, ...rest }: ScrollViewProps & { children?: React.ReactNode }) {
  if (Platform.OS === 'web') return <ScrollView {...rest}>{children}</ScrollView>;
  return (
    <KCKeyboardAwareScrollView bottomOffset={space.lg} keyboardShouldPersistTaps="handled" {...rest}>
      {children}
    </KCKeyboardAwareScrollView>
  );
}

export default KeyboardAvoidingView;
