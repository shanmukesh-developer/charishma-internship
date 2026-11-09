import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Users, CalendarClock, Ellipsis, ChevronRight, Headphones } from '../../../../components/lucide';
import { FriendsColors, FS, FR, FT, SectionTints } from '../friendsTheme';
import { CardGlow, BrandFill } from '../shared/FriendsUi';
import { IdentityChip } from '../shared/IdentityChip';
import { FriendsAvatar } from '../shared/FriendsAvatar';
import type { Space } from '../api/spacesApi';
import { SpaceStatusBadge } from './SpacesUi';
import { ReminderButton } from './ReminderButton';
import { endReasonText, formatCountdown, formatLiveFor, formatSpaceTime, plural, useSpacesNav } from './spacesShared';

import { themedSheet } from '../../../../utils/themeNow';
/** One Space in Live now / Upcoming / Mine. */
export const SpaceListCard: React.FC<{ space: Space; onPress: (s: Space) => void; onMore?: (s: Space) => void; onChanged?: (s: Space) => void }> = ({
  space,
  onPress,
  onMore,
  onChanged,
}) => {
  const nav = useSpacesNav();
  const live = space.status === 'live';
  const scheduled = space.status === 'scheduled';
  const inRoom = nav.roomSpaceId === space.id;
  const when = live
    ? `Live for ${formatLiveFor(space.startedAt)}`
    : scheduled
      ? `${formatSpaceTime(space.scheduledFor)} · ${formatCountdown(space.scheduledFor)}`
      : space.status === 'ended'
        ? endReasonText(space.endReason)
        : space.status === 'cancelled'
          ? 'Cancelled'
          : 'Expired';
  const label = `${live ? 'Live Space' : scheduled ? 'Scheduled Space' : 'Past Space'}: ${space.title}. ${space.topic ? `Topic ${space.topic}. ` : ''}${when}. ${
    live ? `${space.participantCount} in the room.` : scheduled ? `${space.interestedCount} interested.` : ''
  }`;

  return (
    <View style={[styles.card, live && styles.liveCard]}>
      <CardGlow tint={live ? 'rgba(243,139,128,0.10)' : 'rgba(127,222,196,0.07)'} />
      <TouchableOpacity onPress={() => onPress(space)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the Space">
        <View style={styles.top}>
          <SpaceStatusBadge space={space} />
          {space.topic ? (
            <Text style={styles.topic} numberOfLines={1}>
              {space.topic}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {onMore ? (
            <TouchableOpacity onPress={() => onMore(space)} hitSlop={10} style={styles.more} accessibilityRole="button" accessibilityLabel={`More options for ${space.title}`}>
              <Ellipsis size={18} color={FriendsColors.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={[FT.h2, { marginTop: FS.sm }]} numberOfLines={2}>
          {space.title}
        </Text>
        <View style={styles.whenRow}>
          {live ? <Headphones size={13} color={FriendsColors.muted} /> : <CalendarClock size={13} color={FriendsColors.muted} />}
          <Text style={[FT.small, { flex: 1 }]} numberOfLines={1}>
            {when}
          </Text>
        </View>
        <View style={{ marginTop: FS.md }}>
          <IdentityChip identity={space.host} size="sm" />
        </View>
      </TouchableOpacity>

      <View style={styles.foot}>
        {live && space.speakers.length ? (
          <View style={styles.stack} accessible accessibilityLabel={`On stage: ${space.speakers.map((s) => s.name).join(', ')}`}>
            {space.speakers.slice(0, 4).map((s, i) => (
              <View key={s.userId} style={[styles.stackItem, { marginLeft: i ? -10 : 0, zIndex: 10 - i }]}>
                <FriendsAvatar name={s.name} uri={s.avatarUrl} size={26} />
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.stat}>
          <Users size={14} color={FriendsColors.muted} />
          <Text style={FT.small}>
            {live ? plural(space.participantCount, 'listening', 'listening') : scheduled ? `${space.interestedCount} interested` : space.isHost ? 'Hosted by you' : ''}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        {live ? (
          <TouchableOpacity
            style={[styles.join, space.removed && { opacity: 0.5 }]}
            onPress={() => (inRoom || space.removed ? onPress(space) : nav.openRoom(space))}
            accessibilityRole="button"
            accessibilityLabel={inRoom ? 'Return to the room' : space.removed ? 'You were removed from this Space' : `Join ${space.title}`}
          >
            <BrandFill />
            <Text style={styles.joinText}>{inRoom ? 'Return' : space.isHost ? 'Open' : 'Join'}</Text>
            <ChevronRight size={15} color={FriendsColors.accentInk} />
          </TouchableOpacity>
        ) : scheduled && !space.isHost ? (
          <ReminderButton space={space} onChanged={onChanged} />
        ) : null}
      </View>
    </View>
  );
};

const styles = themedSheet(() => ({
  card: { backgroundColor: FriendsColors.card, borderRadius: FR.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: FriendsColors.line, padding: FS.lg },
  liveCard: { borderColor: 'rgba(243,139,128,0.45)' },
  top: { flexDirection: 'row', alignItems: 'center', gap: FS.sm },
  topic: { flex: 1, fontSize: 12, fontWeight: '700', color: SectionTints.spaces.fg, textAlign: 'right' },
  more: { width: 44, height: 44, margin: -6, alignItems: 'center', justifyContent: 'center' },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  foot: { flexDirection: 'row', alignItems: 'center', marginTop: FS.md, gap: FS.sm, minHeight: 40 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderRadius: 15, borderWidth: 2, borderColor: FriendsColors.card },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  join: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 16, borderRadius: FR.pill, backgroundColor: FriendsColors.accent },
  joinText: { fontSize: 13, fontWeight: '800', color: FriendsColors.accentInk },
}));
