/**
 * Food & groceries v2: product thumbnail. One plate size per use; the photo fills it:
 * landscape photos (shot with a background) are cover-cropped, square / portrait pack shots are
 * contained on white with a little padding (never cropped). 1 px hairline in light mode, and a
 * soft tinted placeholder with a category icon when the image cannot load.
 * Others → Food & groceries (modules/foodV2).
 */
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { FOOD } from './foodV2Theme';
import { Icon, GROUP_ICON } from './FoodV2Icons';

export default function Thumb({ uri, size, isDark, group, dim = false, radius = 12 }: {
  uri: string | null; size: number | string; isDark: boolean; group: string; dim?: boolean; radius?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState<'cover' | 'contain'>('contain');
  const box = { width: size as any, height: typeof size === 'number' ? size : undefined, aspectRatio: typeof size === 'number' ? undefined : 1, borderRadius: radius };
  if (!uri || failed) {
    return (
      <View style={[st.plate, box, { backgroundColor: isDark ? 'rgba(76,193,122,0.12)' : '#EEF7F1', borderColor: isDark ? 'transparent' : '#E3EEE7' }]} accessibilityElementsHidden>
        <Icon name={GROUP_ICON[group] || 'basket-outline'} size={typeof size === 'number' ? Math.round(size * 0.36) : 28} color={isDark ? '#7FDCA3' : FOOD.primary} />
      </View>
    );
  }
  return (
    <View style={[st.plate, box, { backgroundColor: isDark ? '#FFFFFF' : '#FFFFFF', borderColor: isDark ? 'transparent' : '#E7EDEA' }]}>
      <Image
        source={{ uri }}
        style={[fit === 'cover' ? StyleSheet.absoluteFill : st.contain, dim && { opacity: 0.4 }]}
        contentFit={fit}
        transition={150}
        onLoad={(e: any) => { const w = e?.source?.width; const h = e?.source?.height; if (w && h && w / h > 1.08) setFit('cover'); }}
        onError={() => setFailed(true)}
        accessibilityElementsHidden
      />
    </View>
  );
}

const st = StyleSheet.create({
  plate: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  contain: { width: '88%', height: '88%' },
});
