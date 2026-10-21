import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { WifiOff } from '../../../../components/lucide';
import { FriendsColors, FS, FT } from '../friendsTheme';
import { FriendsButton, FadeIn } from './FriendsUi';

/**
 * Empty state for dark Friends surfaces: a soft gradient medallion (icon or emoji), a title,
 * one line of help and one clear action (plus an optional quieter secondary one).
 */
export const FriendsEmpty: React.FC<{
  icon?: React.ReactNode;
  /** Friendly emoji illustration (used when no icon is given). */
  emoji?: string;
  /** Tint for the medallion (defaults to the brand accent). */
  tint?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  compact?: boolean;
}> = ({ icon, emoji, tint = FriendsColors.accent, title, subtitle, actionLabel, onAction, secondaryLabel, onSecondary, compact }) => (
  <FadeIn style={[styles.wrap, compact && { paddingVertical: FS.xl }]}>
    {icon || emoji ? (
      <View style={styles.medallionWrap}>
        <LinearGradient colors={[hexA(tint, 0.14), hexA(tint, 0.14)]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[styles.medallion, { borderColor: hexA(tint, 0.28) }]}>
          {icon || <Text style={styles.emoji}>{emoji}</Text>}
        </LinearGradient>
      </View>
    ) : null}
    <Text style={[FT.h2, { textAlign: 'center' }]} accessibilityRole="header">
      {title}
    </Text>
    {subtitle ? <Text style={[FT.muted, { textAlign: 'center', marginTop: 6, maxWidth: 320 }]}>{subtitle}</Text> : null}
    {actionLabel && onAction ? <FriendsButton label={actionLabel} onPress={onAction} style={{ marginTop: FS.xl, alignSelf: 'stretch' }} /> : null}
    {secondaryLabel && onSecondary ? <FriendsButton label={secondaryLabel} onPress={onSecondary} variant="ghost" style={{ marginTop: FS.sm, alignSelf: 'stretch' }} /> : null}
  </FadeIn>
);

/** Error state with Retry for dark Friends surfaces. */
export const FriendsError: React.FC<{ message: string; onRetry?: () => void; compact?: boolean }> = ({ message, onRetry, compact }) => (
  <FriendsEmpty
    compact={compact}
    tint={FriendsColors.warn}
    icon={<WifiOff size={24} color={FriendsColors.warn} />}
    title="Something went wrong"
    subtitle={message}
    actionLabel={onRetry ? 'Try again' : undefined}
    onAction={onRetry}
  />
);

/** '#RRGGBB' + alpha → rgba(); passes other colour strings through. */
const hexA = (c: string, a: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: FS.xl },
  medallionWrap: { marginBottom: FS.lg },
  medallion: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 32 },
});
