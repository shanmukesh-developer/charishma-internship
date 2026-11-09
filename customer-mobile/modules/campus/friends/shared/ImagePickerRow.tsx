import React, { useState } from 'react';
import { View, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { Image } from 'expo-image';
import { ImagePlus, X } from '../../../../components/lucide';
import { pickAndUploadImage, alertUploadError, MediaPurpose, UploadedImage, resolveMediaUrl } from '../../../../utils/imageUpload';
import { FriendsColors, FS, FR } from '../friendsTheme';

import { themedSheet } from '../../../../utils/themeNow';
/**
 * Attach up to `max` photos to a Friends composer. Photos are compressed and uploaded right away
 * (POST /api/campus/media with the given purpose); the composer sends only the returned links / ids.
 */
export const ImagePickerRow: React.FC<{
  value: UploadedImage[];
  onChange: (next: UploadedImage[]) => void;
  purpose: MediaPurpose;
  max?: number;
  size?: number;
}> = ({ value, onChange, purpose, max = 4, size = 72 }) => {
  const [uploading, setUploading] = useState(false);

  const add = async () => {
    if (uploading || value.length >= max) return;
    setUploading(true);
    try {
      const img = await pickAndUploadImage(purpose);
      if (img) onChange([...value, img].slice(0, max));
    } catch (e) {
      alertUploadError(e, add);
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm, paddingVertical: 4 }}>
      {value.map((img, i) => {
        const src = img.localUri || img.previewUrl || resolveMediaUrl(img.url) || img.absoluteUrl;
        return (
          <View key={`${img.url}-${i}`} style={[styles.thumb, { width: size, height: size }]}>
            <Image source={{ uri: src }} style={{ width: size, height: size }} contentFit="cover" />
            <TouchableOpacity
              style={styles.remove}
              onPress={() => onChange(value.filter((_, j) => j !== i))}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
            >
              <X size={12} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        );
      })}
      {value.length < max ? (
        <TouchableOpacity
          style={[styles.add, { width: size, height: size }]}
          onPress={add}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={`Add photo, ${value.length} of ${max}`}
        >
          {uploading ? (
            <ActivityIndicator color={FriendsColors.muted} />
          ) : (
            <>
              <ImagePlus size={20} color={FriendsColors.muted} />
              <Text style={styles.count}>
                {value.length}/{max}
              </Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
};

const styles = themedSheet(() => ({
  thumb: { borderRadius: FR.md, overflow: 'hidden', backgroundColor: FriendsColors.cardHi },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    borderRadius: FR.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: FriendsColors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  count: { fontSize: 12, color: FriendsColors.faint, fontWeight: '600' },
}));
