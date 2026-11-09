import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Search, Ellipsis, Plus, ScrollText, Settings2, Gavel, Flame, Clock, TrendingUp, PenLine } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { BrandFill } from '../shared/FriendsUi';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { ActionMenu } from '../shared/ActionMenu';
import {
  ForumCommunity,
  ForumPost,
  ForumPostType,
  ForumSort,
  ForumTopWindow,
  fetchCommunity,
  fetchCommunityPosts,
  joinCommunity,
  leaveCommunity,
} from '../api/forumApi';
import { useForumNav } from './forumNav';
import { usePaged } from './usePaged';
import { Chips, ForumHeader, PostList } from './ForumUi';
import { ForumPostCard } from './ForumPostCard';
import { FreshersGuideCard } from './FreshersGuideCard';
import { RulesSheet, EditCommunitySheet } from './CommunitySheets';
import { POST_TYPE_META, communityIcon, compactCount, forumCache, forumErrorMessage, patchPostList } from './forumShared';

import { themedSheet } from '../../../../utils/themeNow';
const SORTS: { key: ForumSort; label: string; icon: React.ReactNode }[] = [
  { key: 'hot', label: 'Hot', icon: <Flame size={13} color={FriendsColors.muted} /> },
  { key: 'new', label: 'New', icon: <Clock size={13} color={FriendsColors.muted} /> },
  { key: 'top', label: 'Top', icon: <TrendingUp size={13} color={FriendsColors.muted} /> },
];
const WINDOWS: { key: ForumTopWindow; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
  { key: 'day', label: 'Today' },
];

/** One community: Hot / New / Top, type filter, pinned posts and Freshers Guide, join, rules, mod entry. */
export const CommunityScreen: React.FC<{ id: string; initial?: ForumCommunity | null; onCommunityChanged?: (c: ForumCommunity) => void }> = ({
  id,
  initial,
  onCommunityChanged,
}) => {
  const nav = useForumNav();
  const [community, setCommunity] = useState<ForumCommunity | null>(initial || forumCache.get<ForumCommunity>(`community:${id}`) || null);
  const [communityError, setCommunityError] = useState<any>(null);
  const [sort, setSort] = useState<ForumSort>('hot');
  const [win, setWin] = useState<ForumTopWindow>('week');
  const [type, setType] = useState<ForumPostType | 'all'>('all');
  const [joining, setJoining] = useState(false);
  const [menu, setMenu] = useState(false);
  const [rules, setRules] = useState(false);
  const [edit, setEdit] = useState(false);

  const loadCommunity = useCallback(async () => {
    try {
      const c = await fetchCommunity(id);
      setCommunity(c);
      setCommunityError(null);
      forumCache.set(`community:${id}`, c);
      onCommunityChanged?.(c);
    } catch (e: any) {
      nav.onGateError(e);
      setCommunityError(e);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCommunity();
  }, [loadCommunity]);

  const key = `posts:${id}:${sort}:${sort === 'top' ? win : ''}:${type}`;
  const paged = usePaged<ForumPost, ForumPost[]>(
    key,
    async (cursor) => {
      const r = await fetchCommunityPosts(id, { sort, t: win, type: type === 'all' ? null : type, cursor });
      return { items: r.items, nextCursor: r.nextCursor, extra: cursor ? undefined : r.pinned };
    },
    { onError: nav.onGateError }
  );
  const pinned = paged.extra || [];

  const toggleJoin = async () => {
    if (!community || joining) return;
    setJoining(true);
    const was = community.isMember;
    setCommunity({ ...community, isMember: !was });
    try {
      const r = was ? await leaveCommunity(community.id) : await joinCommunity(community.id);
      Haptics.selectionAsync().catch(() => {});
      const next = { ...community, isMember: r.isMember, memberCount: r.memberCount };
      setCommunity(next);
      onCommunityChanged?.(next);
    } catch (e: any) {
      setCommunity({ ...community, isMember: was });
      nav.onGateError(e);
      Alert.alert("Couldn't update", forumErrorMessage(e));
    } finally {
      setJoining(false);
    }
  };

  const typeOptions = useMemo(
    () => [
      { key: 'all' as const, label: 'All' },
      ...(community?.allowedTypes || []).map((t) => ({ key: t, label: POST_TYPE_META[t]?.short || t })),
    ],
    [community?.allowedTypes]
  );

  if (!community) {
    return (
      <View style={fui.screen}>
        <ForumHeader title="Community" onBack={nav.back} />
        {communityError ? <FriendsError message={forumErrorMessage(communityError, "Couldn't load this community.")} onRetry={loadCommunity} /> : <FriendsSkeleton rows={3} />}
      </View>
    );
  }

  const Icon = communityIcon(community);
  const pending = community.status === 'pending';
  const canPost = !pending;

  const header = (
    <View style={{ gap: FS.md, marginBottom: FS.md }}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon size={22} color={FriendsColors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={FT.h1} numberOfLines={2} accessibilityRole="header">
            {community.name}
          </Text>
          <Text style={FT.small}>
            {compactCount(community.memberCount)} members · {compactCount(community.postCount)} posts
            {community.myRole ? ` · You are ${community.myRole === 'owner' ? 'the owner' : 'a moderator'}` : ''}
          </Text>
        </View>
        {!pending ? (
          <TouchableOpacity
            style={[community.isMember ? fui.ghostBtn : fui.primaryBtn, styles.joinBtn]}
            onPress={toggleJoin}
            disabled={joining}
            accessibilityRole="button"
            accessibilityLabel={community.isMember ? `Leave ${community.name}` : `Join ${community.name}`}
            accessibilityState={{ selected: community.isMember, busy: joining }}
          >
            {joining ? (
              <ActivityIndicator size="small" color={community.isMember ? FriendsColors.ink : FriendsColors.accentInk} />
            ) : (
              <Text style={community.isMember ? fui.ghostBtnText : fui.primaryBtnText}>{community.isMember ? 'Joined' : 'Join'}</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      {pending ? (
        <View style={styles.pending} accessibilityRole="alert">
          <Text style={[FT.h3, { color: FriendsColors.warn }]}>Waiting for approval</Text>
          <Text style={FT.small}>The ZenWe team reviews new communities. You can post once it is approved.</Text>
        </View>
      ) : null}
      {community.description ? <Text style={FT.muted}>{community.description}</Text> : null}
      <FreshersGuideCard community={community} />
      {!pending ? (
        <>
          <Chips label="Sort" options={SORTS} value={sort} onChange={setSort} />
          {sort === 'top' ? <Chips label="Time range" options={WINDOWS} value={win} onChange={setWin} /> : null}
          {typeOptions.length > 2 ? <Chips label="Post type" options={typeOptions} value={type} onChange={(k) => setType(k as any)} /> : null}
        </>
      ) : null}
      {pinned.filter((p) => !p.isFreshersGuide).length ? (
        <View style={{ gap: FS.md }}>
          <Text style={FT.kicker}>Pinned</Text>
          {pinned
            .filter((p) => !p.isFreshersGuide)
            .map((p) => (
              <ForumPostCard
                key={p.id}
                post={p}
                onChanged={(np) => paged.setExtra((prev) => patchPostList(prev || [], np))}
                onRemoved={(pid) => paged.setExtra((prev) => (prev || []).filter((x) => x.id !== pid))}
              />
            ))}
          <Text style={[FT.kicker, { marginTop: FS.sm }]}>Posts</Text>
        </View>
      ) : null}
    </View>
  );

  const menuExtra = [
    { key: 'rules', label: 'Rules and moderators', icon: <ScrollText size={18} color={FriendsColors.ink} />, onPress: () => { setMenu(false); setTimeout(() => setRules(true), 450); } },
    { key: 'search', label: 'Search this community', icon: <Search size={18} color={FriendsColors.ink} />, onPress: () => { setMenu(false); nav.push({ name: 'search', communityId: community.id, communityName: community.name }); } },
  ];
  if (community.myRole) {
    menuExtra.push({ key: 'mod', label: 'Reports and mod log', icon: <Gavel size={18} color={FriendsColors.accent} />, onPress: () => { setMenu(false); nav.push({ name: 'modqueue', communityId: community.id }); } });
  }
  if (community.myRole === 'owner') {
    menuExtra.push({ key: 'edit', label: 'Community settings', icon: <Settings2 size={18} color={FriendsColors.ink} />, onPress: () => { setMenu(false); setTimeout(() => setEdit(true), 450); } });
  }

  return (
    <View style={fui.screen}>
      <ForumHeader
        title={community.name}
        onBack={nav.back}
        right={
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity
              onPress={() => nav.push({ name: 'search', communityId: community.id, communityName: community.name })}
              style={styles.headerBtn}
              accessibilityRole="button"
              accessibilityLabel={`Search ${community.name}`}
            >
              <Search size={20} color={FriendsColors.ink} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMenu(true)} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Community options">
              <Ellipsis size={20} color={FriendsColors.ink} />
            </TouchableOpacity>
          </View>
        }
      />
      {pending ? (
        <View style={{ padding: FS.lg }}>{header}</View>
      ) : (
        <PostList
          paged={paged}
          header={header}
          empty={
            <FriendsEmpty
              compact
              icon={<PenLine size={22} color={FriendsColors.accent} />}
              title={type === 'all' ? 'No posts yet' : `No ${POST_TYPE_META[type as ForumPostType]?.label.toLowerCase()} posts yet`}
              subtitle="Start the conversation. Questions and honest experiences help the next batch."
              actionLabel={canPost ? 'Write the first post' : undefined}
              onAction={canPost ? () => nav.openComposer({ community, type: type === 'all' ? undefined : (type as ForumPostType) }) : undefined}
            />
          }
        />
      )}
      {canPost ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => nav.openComposer({ community, type: type === 'all' ? undefined : (type as ForumPostType) })}
          accessibilityRole="button"
          accessibilityLabel={`New post in ${community.name}`}
          activeOpacity={0.85}
        >
          <BrandFill radius={29} />
          <Plus size={24} color={FriendsColors.accentInk} />
        </TouchableOpacity>
      ) : null}

      <ActionMenu
        visible={menu}
        onClose={() => setMenu(false)}
        title={community.name}
        extra={menuExtra}
        report={community.kind === 'custom' && !community.myRole ? { type: 'community', id: community.id, label: `community ${community.name}` } : null}
      />
      <RulesSheet community={community} visible={rules} onClose={() => setRules(false)} />
      <EditCommunitySheet
        community={community}
        visible={edit}
        onClose={() => setEdit(false)}
        onSaved={(c) => {
          setCommunity(c);
          onCommunityChanged?.(c);
          paged.reload();
        }}
      />
    </View>
  );
};

const styles = themedSheet(() => ({
  hero: { flexDirection: 'row', alignItems: 'center', gap: FS.md },
  heroIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: FriendsColors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  joinBtn: { minHeight: 40, paddingHorizontal: 16 },
  pending: { padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.warnSoft, borderWidth: 1, borderColor: FriendsColors.warnLine },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: FS.xl,
    bottom: FS.xl,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: FriendsColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
}));
