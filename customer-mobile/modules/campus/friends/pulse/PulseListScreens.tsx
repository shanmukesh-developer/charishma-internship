import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Hash, VolumeX, Volume2, TrendingUp, Bookmark, PenLine, UserPlus, UserCheck, Flag, Plus } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { FriendsSkeleton, SkeletonBlock } from '../shared/FriendsSkeleton';
import { FriendsSheet } from '../shared/FriendsSheet';
import { IdentityChip, identityLabel } from '../shared/IdentityChip';
import { ActionMenu } from '../shared/ActionMenu';
import { FriendsUserCard, fetchFriendsUser, followTarget, muteTarget, unfollowTarget, unmuteTarget } from '../api/core';
import {
  PulseHashtagInfo,
  PulsePost,
  PulseTrend,
  fetchMyPulsePosts,
  fetchPulseBookmarks,
  fetchPulseHashtag,
  fetchPulseTrends,
  fetchPulseUserPosts,
} from '../api/pulseApi';
import { PulseFeedList, PulseHeader } from './PulseUi';
import { usePulsePaged } from './usePulsePaged';
import { compactCount, pulseBus, pulseErrorMessage } from './pulseShared';
import { usePulseNav } from './pulseNav';

import { themedSheet } from '../../../../utils/themeNow';
const postKey = (p: PulsePost) => `${p.kind}:${p.id}`;

// ── Hashtag ──────────────────────────────────────────────────────────────────
export const HashtagScreen: React.FC<{ tag: string }> = ({ tag }) => {
  const nav = usePulseNav();
  const clean = tag.replace(/^#/, '').toLowerCase();
  const paged = usePulsePaged<PulsePost, PulseHashtagInfo>(
    `tag:${clean}`,
    async (cursor) => {
      const r = await fetchPulseHashtag(clean, cursor);
      return { items: r.items, nextCursor: r.nextCursor, extra: r.hashtag };
    },
    postKey,
    { onError: nav.onGateError }
  );
  const info = paged.extra;
  const [busy, setBusy] = useState(false);

  const toggleMute = async () => {
    if (!info?.id || busy) return;
    setBusy(true);
    try {
      if (info.muted) await unmuteTarget('hashtag', info.id);
      else await muteTarget('hashtag', info.id);
      paged.setExtra({ ...info, muted: !info.muted });
      Haptics.selectionAsync().catch(() => {});
    } catch (e: any) {
      nav.onGateError(e);
      Alert.alert("Couldn't update", pulseErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={fui.screen}>
      <PulseHeader
        title={`#${clean}`}
        subtitle={info ? `${compactCount(info.postCount)} post${info.postCount === 1 ? '' : 's'} on your campus${info.muted ? ' · muted' : ''}` : null}
        onBack={nav.back}
        right={
          info?.id ? (
            <TouchableOpacity
              style={styles.round}
              onPress={toggleMute}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={info.muted ? `Unmute #${clean}` : `Mute #${clean}`}
              accessibilityHint={info.muted ? 'Posts with this hashtag show in your feeds again' : 'Hides posts with this hashtag from your feeds and trends'}
            >
              {busy ? <ActivityIndicator size="small" color={FriendsColors.muted} /> : info.muted ? <Volume2 size={18} color={FriendsColors.accent} /> : <VolumeX size={18} color={FriendsColors.ink} />}
            </TouchableOpacity>
          ) : null
        }
      />
      <PulseFeedList
        paged={paged}
        header={
          <View style={{ paddingTop: FS.md, paddingBottom: FS.md }}>
            {info?.muted ? (
              <View style={styles.note}>
                <VolumeX size={14} color={FriendsColors.warn} />
                <Text style={[FT.small, { color: FriendsColors.warn, flex: 1 }]}>You muted this hashtag. Its posts are hidden from your feeds and trends.</Text>
              </View>
            ) : null}
            <TouchableOpacity style={[fui.ghostBtn, { alignSelf: 'flex-start' }]} onPress={() => nav.openComposer({ prefill: `#${clean} ` })} accessibilityRole="button" accessibilityLabel={`Post with #${clean}`}>
              <Plus size={14} color={FriendsColors.ink} />
              <Text style={fui.ghostBtnText}>Post with #{clean}</Text>
            </TouchableOpacity>
          </View>
        }
        empty={<FriendsEmpty icon={<Hash size={22} color={FriendsColors.accent} />} title={`No posts with #${clean} yet`} subtitle="Be the first to use it on your campus." />}
      />
    </View>
  );
};

// ── Trends ───────────────────────────────────────────────────────────────────
/** Horizontal trending hashtags (Campus feed header). */
export const TrendsRow: React.FC<{ trends: PulseTrend[]; onSeeAll: () => void }> = ({ trends, onSeeAll }) => {
  const nav = usePulseNav();
  if (!trends.length) return null;
  return (
    <View style={{ marginBottom: FS.md }}>
      <View style={styles.sectionRow}>
        <TrendingUp size={14} color={FriendsColors.accent} />
        <Text style={[FT.kicker, { flex: 1 }]}>Trending on campus</Text>
        <TouchableOpacity onPress={onSeeAll} hitSlop={8} style={styles.seeAll} accessibilityRole="button" accessibilityLabel="See all trends">
          <Text style={styles.seeAllText}>See all</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
        {trends.map((t) => (
          <TouchableOpacity
            key={t.hashtagId}
            style={styles.trendChip}
            onPress={() => nav.push({ name: 'hashtag', tag: t.tag })}
            accessibilityRole="button"
            accessibilityLabel={`Trending number ${t.rank}: #${t.tag}, ${t.people} people posting`}
          >
            <Text style={styles.trendRank}>{t.rank}</Text>
            <View>
              <Text style={styles.trendTag} numberOfLines={1}>
                #{t.tag}
              </Text>
              <Text style={FT.small}>{t.people} people</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

export const TrendsScreen: React.FC = () => {
  const nav = usePulseNav();
  const [items, setItems] = useState<PulseTrend[] | null>(null);
  const [meta, setMeta] = useState<{ windowHours: number; minPeople: number }>({ windowHours: 24, minPeople: 2 });
  const [error, setError] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetchPulseTrends();
      setItems(r.items);
      setMeta({ windowHours: r.windowHours, minPeople: r.minPeople });
      setError(null);
    } catch (e: any) {
      nav.onGateError(e);
      setError(e);
    } finally {
      setRefreshing(false);
    }
  }, [nav]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={fui.screen}>
      <PulseHeader title="Trending" subtitle={`Last ${meta.windowHours} hours on your campus`} onBack={nav.back} />
      <ScrollView
        contentContainerStyle={{ padding: FS.lg, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={FriendsColors.accent}
            colors={[FriendsColors.accent]}
            progressBackgroundColor={FriendsColors.card}
          />
        }
      >
        {items === null && !error ? (
          <FriendsSkeleton rows={5} variant="row" />
        ) : error && !items ? (
          <FriendsError message={pulseErrorMessage(error, "Couldn't load trends.")} onRetry={load} />
        ) : !items || !items.length ? (
          <FriendsEmpty
            icon={<TrendingUp size={22} color={FriendsColors.accent} />}
            title="Nothing trending yet"
            subtitle={`A hashtag trends when at least ${meta.minPeople} different people use it. Start one with # in your post.`}
          />
        ) : (
          <View style={fui.card}>
            {items.map((t, i) => (
              <TouchableOpacity
                key={t.hashtagId}
                style={[fui.row, i === items.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => nav.push({ name: 'hashtag', tag: t.tag })}
                accessibilityRole="button"
                accessibilityLabel={`Number ${t.rank}: #${t.tag}. ${t.people} people, ${t.posts} posts`}
              >
                <Text style={[styles.trendRank, { width: 24 }]}>{t.rank}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.trendTag}>#{t.tag}</Text>
                  <Text style={FT.small}>
                    {t.people} people · {t.posts} posts
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={[FT.small, { marginTop: FS.lg, textAlign: 'center' }]}>Ranked by how many different people post, so one account can't push a tag.</Text>
      </ScrollView>
    </View>
  );
};

// ── Saved / My posts ─────────────────────────────────────────────────────────
export const PulseLibraryScreen: React.FC<{ tab: 'saved' | 'mine' }> = ({ tab: initialTab }) => {
  const nav = usePulseNav();
  const [tab, setTab] = useState(initialTab);
  const paged = usePulsePaged<PulsePost>(`lib:${tab}`, (cursor) => (tab === 'saved' ? fetchPulseBookmarks(cursor) : fetchMyPulsePosts(cursor)), postKey, {
    onError: nav.onGateError,
  });
  const { update } = paged;

  // Unbookmarking elsewhere removes it from Saved.
  useEffect(() => {
    if (tab !== 'saved') return;
    return pulseBus.onPost((p) => {
      if (!p.bookmarked) update((prev) => prev.filter((x) => x.id !== p.id));
    });
  }, [tab, update]);

  // My new posts show at the top of My posts.
  useEffect(() => {
    if (tab !== 'mine') return;
    return pulseBus.onCreated((p) => update((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev])));
  }, [tab, update]);

  return (
    <View style={fui.screen}>
      <PulseHeader title={tab === 'saved' ? 'Bookmarks' : 'My posts'} subtitle={tab === 'saved' ? 'Only you can see your bookmarks' : 'Including anonymous ones (only you see they are yours)'} onBack={nav.back} />
      <View style={styles.segment} accessibilityRole="tablist">
        {(['saved', 'mine'] as const).map((k) => {
          const on = k === tab;
          return (
            <TouchableOpacity key={k} style={[fui.pill, { flex: 1 }, on && fui.pillActive]} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              {k === 'saved' ? <Bookmark size={14} color={on ? FriendsColors.accentInk : FriendsColors.muted} /> : <PenLine size={14} color={on ? FriendsColors.accentInk : FriendsColors.muted} />}
              <Text style={[fui.pillText, on && fui.pillTextActive]}>{k === 'saved' ? 'Bookmarks' : 'My posts'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <PulseFeedList
        key={tab}
        paged={paged}
        empty={
          tab === 'saved' ? (
            <FriendsEmpty icon={<Bookmark size={22} color={FriendsColors.accent} />} title="No bookmarks yet" subtitle="Tap the bookmark on any post to keep it here." />
          ) : (
            <FriendsEmpty
              icon={<PenLine size={22} color={FriendsColors.accent} />}
              title="You haven't posted yet"
              subtitle="Share what's happening on campus."
              actionLabel="Write a post"
              onAction={() => nav.openComposer({})}
            />
          )
        }
      />
    </View>
  );
};

// ── A student's posts ────────────────────────────────────────────────────────
export const UserPostsScreen: React.FC<{ userId: string; name?: string | null }> = ({ userId, name }) => {
  const nav = usePulseNav();
  const paged = usePulsePaged<PulsePost>(`user:${userId}`, (cursor) => fetchPulseUserPosts(userId, cursor), postKey, { onError: nav.onGateError });
  return (
    <View style={fui.screen}>
      <PulseHeader title={name || 'Posts'} subtitle="Posts and replies with their name" onBack={nav.back} />
      <PulseFeedList
        paged={paged}
        header={<View style={{ height: FS.md }} />}
        empty={<FriendsEmpty title="No posts yet" subtitle={`${name || 'This student'} hasn't posted in Pulse yet.`} />}
      />
    </View>
  );
};

/** Profile sheet from a named author: follow, see posts, mute, report or block. */
export const PulseUserSheet: React.FC<{ userId: string | null; onClose: () => void }> = ({ userId, onClose }) => {
  const nav = usePulseNav();
  const [card, setCard] = useState<FriendsUserCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      setCard(await fetchFriendsUser(userId));
    } catch (e: any) {
      nav.onGateError(e);
      setError(pulseErrorMessage(e, "Couldn't load this profile."));
    } finally {
      setLoading(false);
    }
  }, [userId, nav]);

  useEffect(() => {
    setCard(null);
    load();
  }, [load]);

  const name = card ? identityLabel(card.user) : 'Student';

  const toggle = async (key: 'follow' | 'mute') => {
    if (!card || !userId || busy) return;
    setBusy(key);
    try {
      if (key === 'follow') {
        if (card.isFollowing) await unfollowTarget('user', userId);
        else await followTarget('user', userId);
        setCard({ ...card, isFollowing: !card.isFollowing, followerCount: Math.max(0, card.followerCount + (card.isFollowing ? -1 : 1)) });
      } else {
        if (card.isMuted) await unmuteTarget('user', userId);
        else await muteTarget('user', userId);
        setCard({ ...card, isMuted: !card.isMuted });
      }
      Haptics.selectionAsync().catch(() => {});
    } catch (e: any) {
      nav.onGateError(e);
      Alert.alert("Couldn't update", pulseErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <FriendsSheet visible={!!userId} onClose={onClose} title="Profile">
        {loading && !card ? (
          <View style={{ gap: FS.sm, paddingVertical: FS.md }} accessibilityLabel="Loading profile">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: FS.md }}>
              <SkeletonBlock width={48} height={48} radius={24} />
              <View style={{ flex: 1, gap: 8 }}>
                <SkeletonBlock width="50%" height={14} />
                <SkeletonBlock width="30%" height={10} />
              </View>
            </View>
            <SkeletonBlock width="100%" height={44} radius={22} />
          </View>
        ) : error ? (
          <View style={{ paddingVertical: FS.lg }}>
            <Text style={[FT.muted, { textAlign: 'center' }]}>{error}</Text>
            <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md }]} onPress={load} accessibilityRole="button">
              <Text style={fui.ghostBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : card && userId ? (
          <View>
            <IdentityChip identity={card.user} />
            <View style={styles.stats}>
              <View style={styles.stat} accessible accessibilityLabel={`${card.followerCount} followers`}>
                <Text style={FT.h2}>{compactCount(card.followerCount)}</Text>
                <Text style={FT.small}>Followers</Text>
              </View>
              <View style={styles.stat} accessible accessibilityLabel={`Following ${card.followingCount}`}>
                <Text style={FT.h2}>{compactCount(card.followingCount)}</Text>
                <Text style={FT.small}>Following</Text>
              </View>
            </View>
            {!card.isMe ? (
              <TouchableOpacity
                style={[card.isFollowing ? fui.ghostBtn : fui.primaryBtn, { marginTop: FS.lg }]}
                onPress={() => toggle('follow')}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityState={{ selected: card.isFollowing, busy: busy === 'follow' }}
                accessibilityLabel={card.isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
              >
                {busy === 'follow' ? (
                  <ActivityIndicator color={card.isFollowing ? FriendsColors.ink : FriendsColors.accentInk} />
                ) : (
                  <>
                    {card.isFollowing ? <UserCheck size={17} color={FriendsColors.ink} /> : <UserPlus size={17} color={FriendsColors.accentInk} />}
                    <Text style={card.isFollowing ? fui.ghostBtnText : fui.primaryBtnText}>{card.isFollowing ? 'Following' : 'Follow'}</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[fui.ghostBtn, { marginTop: FS.sm }]}
              onPress={() => {
                onClose();
                nav.push({ name: 'user', userId, displayName: name });
              }}
              accessibilityRole="button"
              accessibilityLabel={`See posts by ${name}`}
            >
              <Text style={fui.ghostBtnText}>See posts</Text>
            </TouchableOpacity>
            {!card.isMe ? (
              <View style={{ flexDirection: 'row', gap: FS.sm, marginTop: FS.sm }}>
                <TouchableOpacity
                  style={[fui.ghostBtn, { flex: 1 }]}
                  onPress={() => toggle('mute')}
                  disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityLabel={card.isMuted ? `Unmute ${name}` : `Mute ${name}`}
                >
                  {card.isMuted ? <Volume2 size={16} color={FriendsColors.ink} /> : <VolumeX size={16} color={FriendsColors.ink} />}
                  <Text style={fui.ghostBtnText}>{card.isMuted ? 'Unmute' : 'Mute'}</Text>
                </TouchableOpacity>
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
            nav.onBlocked(id);
            onClose();
          }}
        />
      ) : null}
    </>
  );
};

const styles = themedSheet(() => ({
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.warnSoft, marginBottom: FS.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: FS.sm },
  seeAll: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  seeAllText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accent },
  trendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    minHeight: 52,
    paddingHorizontal: FS.md,
    borderRadius: FR.md,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
    maxWidth: 220,
  },
  trendRank: { fontSize: 18, fontWeight: '900', color: FriendsColors.faint },
  trendTag: { fontSize: 14, fontWeight: '800', color: FriendsColors.ink },
  segment: { flexDirection: 'row', gap: FS.sm, paddingHorizontal: FS.lg, paddingVertical: FS.md },
  stats: { flexDirection: 'row', gap: FS.sm, marginTop: FS.lg },
  stat: { flex: 1, alignItems: 'center', paddingVertical: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi },
}));
