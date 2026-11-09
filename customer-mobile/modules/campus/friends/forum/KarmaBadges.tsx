import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Award, Trophy, BookOpen, HandHelping, Flag } from '../../../../components/lucide';
import { fetchFriendsUser, FriendsUserCard } from '../api/core';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { SkeletonBlock } from '../shared/FriendsSkeleton';
import { FriendsSheet } from '../shared/FriendsSheet';
import { IdentityChip, identityLabel } from '../shared/IdentityChip';
import { ActionMenu } from '../shared/ActionMenu';
import { BADGE_META, forumBadges, forumErrorMessage } from './forumShared';

import { themedSheet } from '../../../../utils/themeNow';
const BADGE_ICON: Record<string, typeof Award> = {
  helpful_answer: Award,
  community_helper: HandHelping,
  resource_sharer: BookOpen,
  top_contributor: Trophy,
};

/** Small badge pills (Forum badges only; earned automatically, never self-granted). */
export const BadgePills: React.FC<{ codes: string[] | null | undefined; max?: number }> = ({ codes, max = 4 }) => {
  const list = forumBadges(codes).slice(0, max);
  if (!list.length) return null;
  return (
    <View style={styles.pills}>
      {list.map((c) => {
        const Icon = BADGE_ICON[c] || Award;
        return (
          <View key={c} style={styles.pill} accessible accessibilityLabel={`Badge: ${BADGE_META[c].label}`}>
            <Icon size={11} color={FriendsColors.gold} />
            <Text style={styles.pillText}>{BADGE_META[c].label}</Text>
          </View>
        );
      })}
    </View>
  );
};

/** Karma, helpful answers, resources and badges from GET /friends/users/:id. */
export const KarmaStats: React.FC<{ card: FriendsUserCard }> = ({ card }) => {
  const s = card.stats;
  const badges = card.user && !(card.user as any).anonymous ? forumBadges((card.user as any).badges) : [];
  return (
    <View>
      {s ? (
        <View style={styles.statsRow}>
          <Stat label="Karma" value={s.karma} />
          <Stat label="Best answers" value={s.helpfulAnswers} />
          <Stat label="Resources" value={s.resourcesShared} />
        </View>
      ) : (
        <Text style={FT.muted}>This student keeps their stats private.</Text>
      )}
      <Text style={[FT.kicker, { marginTop: FS.lg, marginBottom: FS.sm }]}>Badges</Text>
      {badges.length ? (
        <View style={{ gap: FS.sm }}>
          {badges.map((c) => {
            const Icon = BADGE_ICON[c] || Award;
            return (
              <View key={c} style={styles.badgeRow} accessible accessibilityLabel={`${BADGE_META[c].label}. ${BADGE_META[c].hint}`}>
                <View style={styles.badgeIcon}>
                  <Icon size={16} color={FriendsColors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={FT.h3}>{BADGE_META[c].label}</Text>
                  <Text style={FT.small}>{BADGE_META[c].hint}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={FT.muted}>No badges yet. Helpful answers and shared resources earn them.</Text>
      )}
      <Text style={[FT.small, { marginTop: FS.md }]}>
        Karma comes from upvotes by other verified students (anonymous posts earn none). It never grants moderator powers.
      </Text>
    </View>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={FT.small}>{label}</Text>
  </View>
);

/** Profile card for a named Forum author: identity, karma, badges, report / block. */
export const ForumUserSheet: React.FC<{
  userId: string | null;
  onClose: () => void;
  onBlocked?: (userId: string) => void;
}> = ({ userId, onClose, onBlocked }) => {
  const [card, setCard] = useState<FriendsUserCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      setCard(await fetchFriendsUser(userId));
    } catch (e: any) {
      setError(forumErrorMessage(e, "Couldn't load this profile."));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setCard(null);
    load();
  }, [load]);

  const name = card ? identityLabel(card.user) : 'Student';

  return (
    <>
      <FriendsSheet visible={!!userId} onClose={onClose} title="Profile">
        {loading && !card ? (
          <View style={{ gap: FS.sm, paddingVertical: FS.md }} accessibilityLabel="Loading profile">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: FS.md }}>
              <SkeletonBlock width={40} height={40} radius={20} />
              <SkeletonBlock width="45%" height={14} />
            </View>
            <SkeletonBlock width="100%" height={64} radius={FR.md} />
          </View>
        ) : error ? (
          <View style={{ paddingVertical: FS.lg }}>
            <Text style={[FT.muted, { textAlign: 'center' }]}>{error}</Text>
            <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md }]} onPress={load} accessibilityRole="button">
              <Text style={fui.ghostBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : card ? (
          <View>
            <IdentityChip identity={card.user} />
            <View style={{ height: FS.lg }} />
            <KarmaStats card={card} />
            {!card.isMe ? (
              <View style={{ flexDirection: 'row', gap: FS.sm, marginTop: FS.lg }}>
                <TouchableOpacity style={[fui.ghostBtn, { flex: 1 }]} onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel={`Report or block ${name}`}>
                  <Flag size={16} color={FriendsColors.danger} />
                  <Text style={[fui.ghostBtnText, { color: FriendsColors.danger }]}>Report or block</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}
      </FriendsSheet>
      {card && userId ? (
        <ActionMenu
          visible={menu}
          onClose={() => setMenu(false)}
          title={name}
          report={{ type: 'profile', id: userId, label: name }}
          block={{ userId, name }}
          onBlocked={(id) => {
            onBlocked?.(id);
            onClose();
          }}
        />
      ) : null}
    </>
  );
};

/** "Your Forum standing" card on the Forum home. */
export const MyStandingCard: React.FC<{ userId: string | null | undefined; refreshKey?: number }> = ({ userId, refreshKey }) => {
  const [card, setCard] = useState<FriendsUserCard | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!userId) return;
    fetchFriendsUser(userId)
      .then((c) => alive && setCard(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, refreshKey]);

  if (!userId || !card || !card.stats) return null;
  const badges = forumBadges((card.user as any).badges);
  return (
    <>
      <TouchableOpacity
        style={styles.standing}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Your Forum standing: ${card.stats.karma} karma, ${card.stats.helpfulAnswers} best answers, ${badges.length} badges. Open details.`}
      >
        <View style={styles.standingIcon}>
          <Trophy size={18} color={FriendsColors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={FT.h3}>{card.stats.karma} karma</Text>
          <Text style={FT.small} numberOfLines={1}>
            {card.stats.helpfulAnswers} best answers · {card.stats.resourcesShared} resources · {badges.length} badges
          </Text>
        </View>
      </TouchableOpacity>
      <FriendsSheet visible={open} onClose={() => setOpen(false)} title="Your Forum standing">
        <KarmaStats card={card} />
      </FriendsSheet>
    </>
  );
};

const styles = themedSheet(() => ({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: FR.pill, backgroundColor: FriendsColors.goldSoft },
  pillText: { fontSize: 12, fontWeight: '800', color: FriendsColors.gold },
  statsRow: { flexDirection: 'row', gap: FS.sm },
  stat: { flex: 1, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: FriendsColors.ink },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: FS.md },
  badgeIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: FriendsColors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  standing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    padding: FS.md,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  standingIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: FriendsColors.goldSoft, borderWidth: 1, borderColor: 'rgba(232,196,127,0.3)', alignItems: 'center', justifyContent: 'center' },
}));

