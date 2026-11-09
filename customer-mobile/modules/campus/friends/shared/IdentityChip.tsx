import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BadgeCheck, VenetianMask } from '../../../../components/lucide';
import { FriendsIdentity } from '../api/core';
import { FriendsColors, FS, FT } from '../friendsTheme';
import { RelativeTime } from './RelativeTime';
import { FriendsAvatar } from './FriendsAvatar';

import { themedSheet } from '../../../../utils/themeNow';
const isAnon = (i: FriendsIdentity | null | undefined): i is Extract<FriendsIdentity, { anonymous: true }> =>
  !!i && (i as any).anonymous === true;

/** One-line description used for screen readers and menus. */
export const identityLabel = (identity: FriendsIdentity | null | undefined): string => {
  if (!identity) return 'Unknown student';
  if (isAnon(identity)) return identity.isMine ? `${identity.alias} (you, anonymous)` : `${identity.alias} (anonymous)`;
  if (identity.entity?.name) return identity.entity.name;
  return identity.name || 'Student';
};

/**
 * Author line for any Friends content: avatar + name + verified badge (+ entity badge),
 * or an alias with a mask icon for anonymous content. Never shows anything the server didn't send.
 */
export const IdentityChip: React.FC<{
  identity: FriendsIdentity | null | undefined;
  /** Time shown after the meta line (local time zone). */
  time?: string | Date | null;
  size?: 'sm' | 'md';
  /** Open the profile card (named identities only; anonymous identities are never tappable). */
  onPress?: (userId: string) => void;
  right?: React.ReactNode;
}> = ({ identity, time, size = 'md', onPress, right }) => {
  const avatarSize = size === 'sm' ? 28 : 40;

  if (!identity || isAnon(identity)) {
    const alias = identity && isAnon(identity) ? identity.alias : 'Unknown';
    const mine = identity && isAnon(identity) && identity.isMine;
    return (
      <View style={styles.row} accessible accessibilityLabel={identityLabel(identity)}>
        <View style={[styles.mask, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
          <VenetianMask size={avatarSize * 0.5} color={FriendsColors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[size === 'sm' ? styles.nameSm : styles.name]} numberOfLines={1}>
              {alias}
            </Text>
            {mine ? (
              <View style={styles.youPill}>
                <Text style={styles.youText}>You</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <Text style={FT.small}>Anonymous</Text>
            {time ? <Text style={FT.small}> · </Text> : null}
            {time ? <RelativeTime value={time} /> : null}
          </View>
        </View>
        {right}
      </View>
    );
  }

  const entity = identity.entity || null;
  const meta = [identity.campusCode, identity.branch, identity.year ? `Year ${identity.year}` : null].filter(Boolean).join(' · ');
  const content = (
    <View style={styles.row}>
      <FriendsAvatar name={entity?.name || identity.name} uri={identity.avatarUrl || null} size={avatarSize} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={[size === 'sm' ? styles.nameSm : styles.name, { flexShrink: 1 }]} numberOfLines={1}>
            {entity?.name || identity.name || 'Student'}
          </Text>
          {(entity ? entity.verified : identity.verified) ? (
            <BadgeCheck size={size === 'sm' ? 13 : 15} color={FriendsColors.gold} accessibilityLabel="Verified" />
          ) : null}
          {entity ? (
            <View style={styles.entityPill}>
              <Text style={styles.entityText}>{entity.type === 'official' ? 'Official' : 'Club'}</Text>
            </View>
          ) : null}
        </View>
        {meta || time ? (
          <View style={styles.metaRow}>
            {meta ? (
              <Text style={[FT.small, { flexShrink: 1 }]} numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
            {meta && time ? <Text style={FT.small}> · </Text> : null}
            {time ? <RelativeTime value={time} /> : null}
          </View>
        ) : null}
      </View>
      {right}
    </View>
  );

  return onPress ? (
    <TouchableOpacity
      onPress={() => onPress(identity.userId)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${identityLabel(identity)}, open profile`}
    >
      {content}
    </TouchableOpacity>
  ) : (
    <View accessible accessibilityLabel={identityLabel(identity)}>
      {content}
    </View>
  );
};

const styles = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, minHeight: 44 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
  name: { fontSize: 15, fontWeight: '700', color: FriendsColors.ink },
  nameSm: { fontSize: 13, fontWeight: '700', color: FriendsColors.ink },
  mask: { backgroundColor: FriendsColors.mask, alignItems: 'center', justifyContent: 'center' },
  youPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: FriendsColors.accentSoft },
  youText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accent },
  entityPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: FriendsColors.goldSoft },
  entityText: { fontSize: 12, fontWeight: '800', color: FriendsColors.gold },
}));
