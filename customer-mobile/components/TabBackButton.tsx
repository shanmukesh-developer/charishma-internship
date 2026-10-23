import React from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { LIGHT_SURFACE_SM } from '../constants/theme';

/**
 * Round back button for the tab screens (Basket, Orders, Profile), matching the one on Others.
 * Goes back to the previous screen when there is one, otherwise to Home.
 */
export default function TabBackButton({ style }: { style?: any }) {
  const router = useRouter();
  const { isDark } = useTheme() as any;
  return (
    <TouchableOpacity
      style={[{
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
        borderWidth: isDark ? 1 : 0, borderColor: 'rgba(255,255,255,0.12)',
        alignItems: 'center', justifyContent: 'center', marginRight: 10,
      }, !isDark && LIGHT_SURFACE_SM, style]}
      onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)' as any); }}
      activeOpacity={0.7}
      accessibilityLabel="Go back"
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <Ionicons name="arrow-back" size={19} color={isDark ? '#FFFFFF' : '#111827'} />
    </TouchableOpacity>
  );
}
