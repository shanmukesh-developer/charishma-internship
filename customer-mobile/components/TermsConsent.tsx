// C4: "By continuing you agree to the Terms and Privacy Policy" with tappable links. With `onToggle`
// it also shows the required checkbox (first account creation only).
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/theme';
import { openLegal } from '../utils/legal';
import SymbolIcon from './SymbolIcon';

interface Props {
  isDark?: boolean;
  checked?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
}

export default function TermsConsent({ isDark, checked, onToggle, disabled }: Props) {
  const muted = isDark ? COLORS.textSecondary : '#617088';
  const text = (
    <Text style={[s.text, { color: muted }]}>
      {onToggle ? 'I agree to the ' : 'By continuing you agree to the '}
      <Text style={s.link} onPress={() => openLegal('terms')} accessibilityRole="link">Terms of Service</Text>
      {' and '}
      <Text style={s.link} onPress={() => openLegal('privacy')} accessibilityRole="link">Privacy Policy</Text>
      {onToggle ? ' (I am 18+ or have a parent / guardian\'s consent).' : '.'}
    </Text>
  );
  if (!onToggle) return <View style={s.row}>{text}</View>;
  return (
    <View style={s.row}>
      <TouchableOpacity
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: !!checked, disabled: !!disabled }}
        accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={[s.box, { borderColor: checked ? COLORS.gold : muted, backgroundColor: checked ? COLORS.gold : 'transparent' }]}
      >
        {checked ? <SymbolIcon name="checkmark" style={s.tick} /> : null}
      </TouchableOpacity>
      <View style={{ flex: 1 }}>{text}</View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  text: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  link: { color: COLORS.gold, fontWeight: '800', textDecorationLine: 'underline' },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tick: { color: '#000', fontSize: 13, fontWeight: '900', lineHeight: 15 },
});
