// C8: FSSAI licence line shown on store pages, checkout and the order screen (FSSAI e-commerce
// display rule). Same wording as the backend's fssaiDisplayText (utils/storeCompliance.js) and the
// printed receipt. Never invent a number: only what the server sent is shown.
import React from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

/** Customer-facing text for a store's FSSAI licence number (string from the API, or null). */
export const fssaiDisplayText = (number?: string | null): string => {
  const n = typeof number === 'string' ? number.trim() : '';
  return n ? `FSSAI Lic. No. ${n}` : 'FSSAI licence not provided';
};

type Props = {
  /** `fssaiLicenseNumber` from the API. `undefined` = not loaded yet (renders nothing). */
  number: string | null | undefined;
  /** Prefix with the store name (screens that list items from more than one store). */
  storeName?: string;
  color?: string;
  style?: StyleProp<TextStyle>;
};

export default function FssaiLine({ number, storeName, color, style }: Props) {
  const { colors } = useTheme();
  if (number === undefined) return null;
  const text = storeName ? `${storeName} · ${fssaiDisplayText(number)}` : fssaiDisplayText(number);
  return (
    <Text
      style={[{ fontSize: 12, fontWeight: '600', color: color || colors.textMuted, marginTop: 6 }, style]}
      accessibilityLabel={text}
    >
      {text}
    </Text>
  );
}
