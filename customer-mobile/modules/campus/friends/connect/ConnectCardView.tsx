import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MoreHorizontal, GraduationCap } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR } from '../friendsTheme';
import type { ConnectCard, ConnectStatus } from '../api/connectApi';
import { ConnectPhotoView, ConnectTag } from './ConnectUi';
import { lookingForLabel, yearLabel } from './connectShared';

import { themedSheet } from '../../../../utils/themeNow';
/** Photo carousel: tap the left / right half to move between photos (bars show where you are). */
export const PhotoCarousel: React.FC<{
  card: ConnectCard;
  height: number;
  onIndex?: (i: number) => void;
  overlay?: React.ReactNode;
}> = ({ card, height, onIndex, overlay }) => {
  const [i, setI] = useState(0);
  const n = card.photos.length;
  useEffect(() => {
    setI(0);
  }, [card.profileId]);
  useEffect(() => {
    onIndex?.(i);
  }, [i, onIndex]);
  const go = (d: number) => setI((x) => Math.min(Math.max(0, x + d), Math.max(0, n - 1)));
  const photo = n ? card.photos[Math.min(i, n - 1)] : null;
  return (
    <View style={{ height, borderRadius: FR.hero, overflow: 'hidden', backgroundColor: FriendsColors.cardHi }}>
      <ConnectPhotoView photo={photo} name={card.displayName} style={StyleSheet.absoluteFill} radius={0} label={n ? `Photo ${i + 1} of ${n} of ${card.displayName}` : `${card.displayName} has no approved photos yet`} />
      {n > 1 ? (
        <>
          <View style={styles.bars} pointerEvents="none">
            {card.photos.map((p, j) => (
              <View key={p.id} style={[styles.bar, j === i && { backgroundColor: FriendsColors.ink }]} />
            ))}
          </View>
          <TouchableOpacity style={[styles.half, { left: 0 }]} onPress={() => go(-1)} disabled={i === 0} accessibilityRole="button" accessibilityLabel="Previous photo" accessibilityState={{ disabled: i === 0 }} />
          <TouchableOpacity style={[styles.half, { right: 0 }]} onPress={() => go(1)} disabled={i >= n - 1} accessibilityRole="button" accessibilityLabel="Next photo" accessibilityState={{ disabled: i >= n - 1 }} />
        </>
      ) : null}
      <LinearGradient colors={['transparent', 'rgba(8,7,12,0.92)']} style={styles.fade} pointerEvents="none" />
      {overlay}
    </View>
  );
};

/** Another student's Connect card: photos, name, age, (year / branch if shown), looking for, bio, interests. */
export const ConnectCardView: React.FC<{
  card: ConnectCard;
  status?: ConnectStatus | null;
  photoHeight?: number;
  onMore?: () => void;
  onPhotoIndex?: (i: number) => void;
}> = ({ card, status, photoHeight, onMore, onPhotoIndex }) => {
  const { width } = useWindowDimensions();
  const h = photoHeight || Math.min(Math.round((width - FS.lg * 2) * 1.2), 520);
  const meta = [card.year ? yearLabel(card.year) : null, card.branch || null].filter(Boolean).join(' · ');
  return (
    <View>
      <PhotoCarousel
        card={card}
        height={h}
        onIndex={onPhotoIndex}
        overlay={
          <View style={styles.nameBlock} pointerEvents="box-none">
            <View style={{ flex: 1 }} accessible accessibilityRole="header" accessibilityLabel={`${card.displayName}${card.age ? `, ${card.age}` : ''}${meta ? `, ${meta}` : ''}`}>
              <Text style={styles.name} numberOfLines={1}>
                {card.displayName}
                {card.age ? <Text style={styles.age}>{`  ${card.age}`}</Text> : null}
              </Text>
              {meta ? (
                <View style={styles.metaRow}>
                  <GraduationCap size={13} color={FriendsColors.muted} />
                  <Text style={[FT.small, { color: '#D9D4E4' }]}>{meta}</Text>
                </View>
              ) : null}
            </View>
            {onMore ? (
              <TouchableOpacity style={styles.more} onPress={onMore} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More options for ${card.displayName}: report or block`}>
                <MoreHorizontal size={20} color={FriendsColors.ink} />
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />
      <View style={{ paddingTop: FS.md, gap: FS.md }}>
        {card.lookingFor.length ? (
          <View style={styles.wrap} accessible accessibilityLabel={`Looking for ${card.lookingFor.map((k) => lookingForLabel(k, status)).join(', ')}`}>
            {card.lookingFor.map((k) => (
              <ConnectTag key={k} label={lookingForLabel(k, status)} tone="accent" />
            ))}
          </View>
        ) : null}
        {card.bio ? <Text style={[FT.body, { lineHeight: 21 }]}>{card.bio}</Text> : null}
        {card.interests.length ? (
          <View style={styles.wrap} accessible accessibilityLabel={`Interests: ${card.interests.join(', ')}`}>
            {card.interests.map((x) => (
              <ConnectTag key={x} label={x} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = themedSheet(() => ({
  bars: { position: 'absolute', top: 10, left: 12, right: 12, flexDirection: 'row', gap: 4, zIndex: 2 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  half: { position: 'absolute', top: 0, bottom: 90, width: '50%', zIndex: 1 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 150 },
  nameBlock: { position: 'absolute', left: FS.lg, right: FS.md, bottom: FS.lg, flexDirection: 'row', alignItems: 'flex-end', gap: FS.sm, zIndex: 3 },
  name: { fontSize: 28, fontWeight: '800', color: FriendsColors.ink, letterSpacing: -0.5 },
  age: { fontSize: 24, fontWeight: '500', color: '#D9D4E4' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  more: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
}));
