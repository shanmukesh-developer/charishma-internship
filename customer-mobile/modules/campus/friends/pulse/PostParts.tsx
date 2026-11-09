import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Linking, Alert, ScrollView, useWindowDimensions, StyleProp, TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link2, X, ExternalLink } from '../../../../components/lucide';
import { FriendsColors, FS, FR, FT } from '../friendsTheme';
import { parsePulseText } from './pulseShared';

import { themedSheet } from '../../../../utils/themeNow';
const openExternal = (url: string) => {
  if (!/^https?:\/\//i.test(url)) return;
  Linking.openURL(url).catch(() => Alert.alert("Couldn't open link", 'Please try again.'));
};

/** Post text with tappable #hashtags and links, and highlighted @friend codes. */
export const RichText: React.FC<{
  text: string;
  onTag?: (tag: string) => void;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}> = ({ text, onTag, style, numberOfLines }) => {
  const parts = useMemo(() => parsePulseText(text), [text]);
  if (!text) return null;
  return (
    <Text style={[styles.text, style]} numberOfLines={numberOfLines} selectable={!numberOfLines}>
      {parts.map((p, i) => {
        if (p.type === 'tag') {
          return (
            <Text
              key={i}
              style={styles.tag}
              onPress={onTag ? () => onTag(p.tag) : undefined}
              accessibilityRole="link"
              accessibilityLabel={`Hashtag ${p.tag}`}
            >
              {p.text}
            </Text>
          );
        }
        if (p.type === 'link') {
          return (
            <Text key={i} style={styles.link} onPress={() => openExternal(p.url)} accessibilityRole="link">
              {p.text}
            </Text>
          );
        }
        if (p.type === 'mention') {
          return (
            <Text key={i} style={styles.mention}>
              {p.text}
            </Text>
          );
        }
        return <Text key={i}>{p.text}</Text>;
      })}
    </Text>
  );
};

/** Link preview chip (host + url). */
export const LinkChip: React.FC<{ link: { url: string; host: string } }> = ({ link }) => (
  <TouchableOpacity
    style={styles.linkChip}
    onPress={() => openExternal(link.url)}
    activeOpacity={0.8}
    accessibilityRole="link"
    accessibilityLabel={`Open link to ${link.host}`}
  >
    <View style={styles.linkIcon}>
      <Link2 size={16} color={FriendsColors.accent} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={FT.h3} numberOfLines={1}>
        {link.host}
      </Text>
      <Text style={FT.small} numberOfLines={1}>
        {link.url}
      </Text>
    </View>
    <ExternalLink size={16} color={FriendsColors.muted} />
  </TouchableOpacity>
);

/** 1–4 photos in a grid; tap opens a full-screen viewer. */
export const MediaGrid: React.FC<{ media: { mediaId: string; url: string }[]; compact?: boolean }> = ({ media, compact }) => {
  const [open, setOpen] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  if (!media || !media.length) return null;
  const h = compact ? 150 : 210;
  const n = Math.min(media.length, 4);

  const cell = (i: number, style: any) => (
    <TouchableOpacity
      key={media[i].mediaId || i}
      style={[styles.cell, style]}
      onPress={() => setOpen(i)}
      activeOpacity={0.9}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Photo ${i + 1} of ${n}. Open full screen`}
    >
      <Image source={{ uri: media[i].url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
    </TouchableOpacity>
  );

  let grid: React.ReactNode;
  if (n === 1) grid = cell(0, { height: h + 40 });
  else if (n === 2)
    grid = (
      <View style={styles.row}>
        {cell(0, { flex: 1, height: h })}
        {cell(1, { flex: 1, height: h })}
      </View>
    );
  else if (n === 3)
    grid = (
      <View style={styles.row}>
        {cell(0, { flex: 1, height: h })}
        <View style={{ flex: 1, gap: 3 }}>
          {cell(1, { flex: 1 })}
          {cell(2, { flex: 1 })}
        </View>
      </View>
    );
  else
    grid = (
      <View style={{ gap: 3 }}>
        <View style={styles.row}>
          {cell(0, { flex: 1, height: h / 2 })}
          {cell(1, { flex: 1, height: h / 2 })}
        </View>
        <View style={styles.row}>
          {cell(2, { flex: 1, height: h / 2 })}
          {cell(3, { flex: 1, height: h / 2 })}
        </View>
      </View>
    );

  return (
    <View style={styles.grid}>
      {grid}
      <Modal visible={open !== null} animationType="fade" onRequestClose={() => setOpen(null)} statusBarTranslucent>
        <SafeAreaView style={styles.viewer} edges={['top', 'bottom']}>
          <View style={styles.viewerBar}>
            <Text style={[FT.small, { color: '#FFFFFF' }]}>
              {(open ?? 0) + 1} / {n}
            </Text>
            <TouchableOpacity onPress={() => setOpen(null)} style={styles.close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close photo">
              <X size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: (open ?? 0) * width, y: 0 }}
            onMomentumScrollEnd={(e) => setOpen(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}
          >
            {media.slice(0, n).map((m, i) => (
              <View key={m.mediaId || i} style={{ width, flex: 1, justifyContent: 'center' }}>
                <Image source={{ uri: m.url }} style={{ width, height: '100%' }} contentFit="contain" accessibilityLabel={`Photo ${i + 1}`} />
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = themedSheet(() => ({
  text: { fontSize: 15, lineHeight: 22, color: FriendsColors.ink },
  tag: { color: FriendsColors.accent, fontWeight: '700' },
  link: { color: FriendsColors.accent, textDecorationLine: 'underline' },
  mention: { color: FriendsColors.gold, fontWeight: '700' },
  grid: { marginTop: FS.sm, borderRadius: FR.md, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 3 },
  cell: { backgroundColor: FriendsColors.cardHi, overflow: 'hidden' },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    marginTop: FS.sm,
    padding: FS.sm,
    minHeight: 52,
    borderRadius: FR.md,
    borderWidth: 1,
    borderColor: FriendsColors.line,
    backgroundColor: FriendsColors.cardHi,
  },
  linkIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: FriendsColors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: FS.lg, minHeight: 48 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
}));
