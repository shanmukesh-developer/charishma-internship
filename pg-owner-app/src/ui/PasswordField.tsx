// Password input with a show / hide eye (sign-in, change password, delete account).
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';

export function PasswordField({ label, value, onChange, onSubmit, error, hint, placeholder = 'Password', autoComplete = 'password' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  error?: string | null;
  hint?: string;
  placeholder?: string;
  autoComplete?: 'password' | 'new-password';
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: space.xxs }}>
      <Text style={[font.label, { color: color.textSecondary }]}>{label.toUpperCase()}</Text>
      <View style={[st.row, error ? { borderColor: color.alert } : null]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
          placeholder={placeholder}
          placeholderTextColor={color.textMuted}
          style={[font.body, { flex: 1, color: color.text, minHeight: 48 }]}
          accessibilityLabel={label}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow((s) => !s)} hitSlop={12}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={22} color={color.textMuted} />
        </Pressable>
      </View>
      {error ? <Text style={[font.small, { color: color.alertDark, fontWeight: '700' }]}>{error}</Text> : hint ? <Text style={[font.small, { color: color.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 50, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surface, paddingHorizontal: space.sm },
});
