import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing, AccessibilityInfo } from 'react-native';
import { Radio, Mic, MicOff, ShieldCheck, Minus, Plus, Crown, Shield, Hand, BadgeCheck, ChevronLeft, RotateCcw } from '../../../../components/lucide';
import { FriendsColors, FS, FR, FT, SectionTints } from '../friendsTheme';
import { FriendsHeader } from '../shared/FriendsUi';
import { FriendsAvatar } from '../shared/FriendsAvatar';
import { Space, SpaceRole, spaceErrorMessage } from '../api/spacesApi';
import { statusLabel } from './spacesShared';

import { themedSheet } from '../../../../utils/themeNow';
/** Small pulsing dot for live states (still when the user prefers reduced motion). */
export const LiveDot: React.FC<{ size?: number; color?: string }> = ({ size = 8, color = FriendsColors.danger }) => {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (!alive || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(v, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ])
        );
        loop.start();
      })
      .catch(() => {});
    return () => {
      alive = false;
      loop?.stop();
    };
  }, [v]);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: v }} />;
};

export const SpaceStatusBadge: React.FC<{ space: Space }> = ({ space }) => {
  const live = space.status === 'live';
  const review = !!space.underReview;
  const done = space.status === 'ended' || space.status === 'cancelled' || space.status === 'expired';
  const color = live ? FriendsColors.danger : review ? FriendsColors.warn : done ? FriendsColors.faint : FriendsColors.accent;
  const bg = live ? FriendsColors.dangerSoft : review ? FriendsColors.warnSoft : done ? FriendsColors.cardHi : FriendsColors.accentSoft;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {live ? <LiveDot size={7} /> : null}
      <Text style={[styles.badgeText, { color }]}>{statusLabel(space).toUpperCase()}</Text>
    </View>
  );
};

/** "Not recorded" promise, shown on every Space surface. */
export const NotRecorded: React.FC<{ text?: string; compact?: boolean }> = ({ text, compact }) => (
  <View style={[styles.notRec, compact && { paddingVertical: 4, paddingHorizontal: 8 }]} accessible accessibilityLabel={text || 'Not recorded. Spaces are live only.'}>
    <ShieldCheck size={compact ? 12 : 14} color={FriendsColors.success} />
    <Text style={[styles.notRecText, compact && { fontSize: 12 }]} numberOfLines={compact ? 1 : 2}>
      {text || 'Not recorded'}
    </Text>
  </View>
);

const ROLE_ICON: Partial<Record<SpaceRole, React.ComponentType<any>>> = { host: Crown, cohost: Shield };

/**
 * A person on stage: avatar with a glowing ring while they talk, a mic badge and a role badge.
 * Tappable for host controls, report and block.
 */
export const StageSeat: React.FC<{
  name: string;
  avatarUrl?: string | null;
  verified?: boolean;
  role: SpaceRole;
  muted: boolean;
  mutedByHost?: boolean;
  talking: boolean;
  connected: boolean;
  isMe: boolean;
  size?: number;
  onPress?: () => void;
}> = ({ name, avatarUrl, verified, role, muted, mutedByHost, talking, connected, isMe, size = 64, onPress }) => {
  const RoleIcon = ROLE_ICON[role];
  const label = `${isMe ? 'You' : name}, ${role === 'cohost' ? 'co-host' : role}${verified ? ', verified' : ''}. ${
    muted ? (mutedByHost ? 'Muted by the host' : 'Muted') : talking ? 'Talking' : 'Mic on'
  }${connected ? '' : '. Reconnecting'}.`;
  return (
    <TouchableOpacity style={styles.seat} onPress={onPress} disabled={!onPress} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={onPress ? 'Opens options for this person' : undefined}>
      <View style={[styles.ring, { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2 }, talking && !muted && styles.ringOn, !connected && { opacity: 0.45 }]}>
        <FriendsAvatar name={name} uri={avatarUrl} size={size} />
        <View style={[styles.mic, muted && styles.micOff]}>
          {muted ? <MicOff size={12} color={FriendsColors.ink} /> : <Mic size={12} color={FriendsColors.accentInk} />}
        </View>
      </View>
      <View style={styles.seatName}>
        <Text style={styles.seatNameText} numberOfLines={1}>
          {isMe ? 'You' : name.split(' ')[0]}
        </Text>
        {verified ? <BadgeCheck size={12} color={FriendsColors.gold} /> : null}
      </View>
      <View style={styles.seatRole}>
        {RoleIcon ? <RoleIcon size={10} color={role === 'host' ? FriendsColors.gold : FriendsColors.accent} /> : null}
        <Text style={[styles.seatRoleText, role === 'host' && { color: FriendsColors.gold }]}>{role === 'cohost' ? 'Co-host' : role === 'host' ? 'Host' : 'Speaker'}</Text>
      </View>
    </TouchableOpacity>
  );
};

/** A listener in the audience grid (smaller, hand badge when raised). */
export const AudienceSeat: React.FC<{
  name: string;
  avatarUrl?: string | null;
  verified?: boolean;
  hand: boolean;
  invited: boolean;
  connected: boolean;
  isMe: boolean;
  onPress?: () => void;
}> = ({ name, avatarUrl, verified, hand, invited, connected, isMe, onPress }) => (
  <TouchableOpacity
    style={styles.aud}
    onPress={onPress}
    disabled={!onPress}
    activeOpacity={0.8}
    accessibilityRole="button"
    accessibilityLabel={`${isMe ? 'You' : name}, listener${verified ? ', verified' : ''}${hand ? ', hand raised' : ''}${invited ? ', invited to speak' : ''}${connected ? '' : ', reconnecting'}.`}
  >
    <View style={!connected ? { opacity: 0.45 } : null}>
      <FriendsAvatar name={name} uri={avatarUrl} size={44} />
      {hand || invited ? (
        <View style={[styles.hand, invited && { backgroundColor: FriendsColors.accent }]}>
          <Hand size={11} color={FriendsColors.accentInk} />
        </View>
      ) : null}
    </View>
    <Text style={styles.audName} numberOfLines={1}>
      {isMe ? 'You' : name.split(' ')[0]}
    </Text>
  </TouchableOpacity>
);

export const Stepper: React.FC<{ label: string; sub?: string; onMinus: () => void; onPlus: () => void }> = ({ label, sub, onMinus, onPlus }) => (
  <View style={styles.stepper}>
    <TouchableOpacity style={styles.stepBtn} onPress={onMinus} accessibilityRole="button" accessibilityLabel={`${label} earlier`}>
      <Minus size={16} color={FriendsColors.ink} />
    </TouchableOpacity>
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={FT.h3}>{label}</Text>
      {sub ? <Text style={FT.small}>{sub}</Text> : null}
    </View>
    <TouchableOpacity style={styles.stepBtn} onPress={onPlus} accessibilityRole="button" accessibilityLabel={`${label} later`}>
      <Plus size={16} color={FriendsColors.ink} />
    </TouchableOpacity>
  </View>
);

export const SpacesKicker: React.FC<{ children: string; live?: boolean }> = ({ children, live }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    {live ? <Radio size={13} color={FriendsColors.danger} /> : null}
    <Text style={[FT.kicker, live && { color: FriendsColors.danger }]}>{children}</Text>
  </View>
);

/** Header for screens inside the Spaces stack. */
export const SpaceHeader: React.FC<{ title: string; subtitle?: string | null; onBack: () => void; backLabel?: string; right?: React.ReactNode }> = (props) => (
  <FriendsHeader {...props} section="spaces" />
);

/** Inline "couldn't refresh" row with Retry (what was loaded stays on screen). */
export const SpaceSoftError: React.FC<{ error: any; onRetry: () => void }> = ({ error, onRetry }) => (
  <TouchableOpacity style={styles.soft} onPress={onRetry} accessibilityRole="button" accessibilityLabel={`${spaceErrorMessage(error, "Couldn't refresh.")} Retry`}>
    <RotateCcw size={14} color={FriendsColors.warn} />
    <Text style={styles.softText} numberOfLines={2}>
      {spaceErrorMessage(error, "Couldn't refresh.")} Tap to retry.
    </Text>
  </TouchableOpacity>
);

const styles = themedSheet(() => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    paddingHorizontal: FS.sm,
    paddingVertical: FS.sm,
    borderBottomWidth: 1,
    borderBottomColor: FriendsColors.line,
    backgroundColor: FriendsColors.bg,
  },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  soft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: FS.lg,
    marginVertical: FS.sm,
    padding: FS.md,
    minHeight: 44,
    borderRadius: FR.md,
    backgroundColor: FriendsColors.warnSoft,
  },
  softText: { flex: 1, fontSize: 12, fontWeight: '600', color: FriendsColors.warn },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: FR.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  notRec: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: FR.pill,
    backgroundColor: FriendsColors.successSoft,
    borderWidth: 1,
    borderColor: 'rgba(143,220,166,0.24)',
  },
  notRecText: { fontSize: 12, fontWeight: '700', color: FriendsColors.success },
  seat: { width: '33.33%', alignItems: 'center', paddingVertical: FS.sm },
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: SectionTints.spaces.fg, shadowColor: SectionTints.spaces.fg, shadowOpacity: 0.7, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  mic: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: FriendsColors.accent,
    borderWidth: 2,
    borderColor: FriendsColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOff: { backgroundColor: FriendsColors.cardHi },
  seatName: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6, maxWidth: '92%' },
  seatNameText: { fontSize: 13, fontWeight: '700', color: FriendsColors.ink, flexShrink: 1 },
  seatRole: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  seatRoleText: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  aud: { width: '25%', alignItems: 'center', paddingVertical: FS.sm },
  audName: { fontSize: 12, fontWeight: '600', color: FriendsColors.muted, marginTop: 4, maxWidth: '90%' },
  hand: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: FriendsColors.gold,
    borderWidth: 2,
    borderColor: FriendsColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: FR.pill,
    backgroundColor: FriendsColors.cardHi,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: FriendsColors.card },
}));
