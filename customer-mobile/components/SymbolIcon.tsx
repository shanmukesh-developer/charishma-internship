import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * A centred icon in place of a text symbol (+ − ✕ ✓ ‹ ›) inside a button (owner, 4 Nov 2026: "symbols inside buttons
 * are misaligned"). A text glyph sits on its font's baseline, so in a round or square button it looked pushed up or
 * sideways; an icon is drawn in the middle of its box.
 *
 * It takes the same `style` the old <Text> had and reads its font size, colour and opacity from it, so each button
 * keeps its size and colour. Layout props of the old text (margins) are dropped on purpose: they were nudges for the
 * glyph's baseline.
 */
export type SymbolName = 'add' | 'remove' | 'close' | 'checkmark' | 'chevron-back' | 'chevron-forward';

export default function SymbolIcon({ name, style, scale = 1.15 }: { name: SymbolName; style?: StyleProp<TextStyle>; scale?: number }) {
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  const fontSize = typeof flat.fontSize === 'number' ? flat.fontSize : 14;
  const size = Math.round(fontSize * scale);
  const color = typeof flat.color === 'string' ? flat.color : '#000';
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      style={flat.opacity != null ? { opacity: flat.opacity } : undefined}
      accessible={false}
    />
  );
}
