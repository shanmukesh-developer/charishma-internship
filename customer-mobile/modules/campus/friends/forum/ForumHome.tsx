import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, BackHandler, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Search, HelpCircle, Star, Bookmark, PenLine, Gavel, Plus, ChevronRight, ShieldCheck, Sparkles, Hourglass } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import type { CampusRole } from '../../../../types/campus';
import { FriendsColors, FS, FT, FR, fui, SectionTints } from '../friendsTheme';
import { BrandFill } from '../shared/FriendsUi';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { SUB_TAB_META } from '../shared/SubTabBar';
import { isGateError } from '../api/core';
import { ForumCommunity, ForumPost, fetchCommunities, joinCommunity, leaveCommunity } from '../api/forumApi';
import { ForumNav, ForumNavContext, ForumRoute, ComposerRequest } from './forumNav';
import { forumBus, forumCache, forumErrorMessage, communityIcon, compactCount } from './forumShared';
import { CommunityScreen } from './CommunityScreen';
import { ForumPostScreen } from './ForumPostScreen';
import { ReviewTargetScreen, ReviewsBrowseScreen } from './ReviewScreens';
import { ForumSearchScreen, ForumLibraryScreen, ModQueueScreen } from './ForumListScreens';
import { ForumComposer } from './ForumComposer';
import { ForumUserSheet, MyStandingCard } from './KarmaBadges';
import { RequestCommunitySheet } from './CommunitySheets';

import { themedSheet } from '../../../../utils/themeNow';
export interface ForumHomeProps {
  /** Post id from a deep link / notification (/friends?tab=friends&sub=forum&id=...). */
  focusId?: string | null;
  /** Open a campus chat (unused by Forum; kept for the shared sub-tab contract). */
  onOpenChat?: (chatId: string, name: string) => void;
  /** Signed-in user id (karma card, own-content checks). */
  userId?: string | null;
  /** Campus roles from the profile (faculty can offer a right of reply; the server decides). */
  roles?: CampusRole[];
  /** True while Forum is the visible sub-tab (Android back pops the Forum stack only then). */
  active?: boolean;
  /** Ask the Friends shell to refetch eligibility (guidelines / flag / restriction changed). */
  onGateError?: () => void;
}

const COMMUNITIES_KEY = 'communities';

/**
 * Campus > Friends > Forum.
 * Home lists the campus communities (joined first), quick actions and the student's Forum standing.
 * Communities, posts, reviews, search, saved posts and moderator tools open in an in-tab stack, so
 * the Friends sub-tab bar stays put and each screen keeps its scroll position.
 */
export const ForumHome: React.FC<ForumHomeProps> = ({ focusId, userId, roles, active = true, onGateError }) => {
  const [communities, setCommunities] = useState<ForumCommunity[]>(() => forumCache.get<ForumCommunity[]>(COMMUNITIES_KEY) || []);
  const [loading, setLoading] = useState(!forumCache.get(COMMUNITIES_KEY));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<any>(null);
  const [stack, setStack] = useState<{ key: number; route: ForumRoute }[]>([]);
  const [composer, setComposer] = useState<ComposerRequest | null>(null);
  const [userSheet, setUserSheet] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [standingKey, setStandingKey] = useState(0);
  const [joining, setJoining] = useState<string | null>(null);
  const keySeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const gate = useCallback(
    (e: any) => {
      if (isGateError(e)) onGateError?.();
    },
    [onGateError]
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        const list = await fetchCommunities();
        if (!mounted.current) return;
        setCommunities(list);
        forumCache.set(COMMUNITIES_KEY, list);
        setError(null);
      } catch (e: any) {
        if (!mounted.current) return;
        gate(e);
        setError(e);
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [gate]
  );

  useEffect(() => {
    load();
  }, [load]);

  const push = useCallback((route: ForumRoute) => {
    setStack((prev) => {
      // Re-opening the screen that is already on top (double tap) is a no-op.
      const top = prev[prev.length - 1]?.route;
      if (top && top.name === route.name && (top as any).id === (route as any).id && (route as any).id) return prev;
      return [...prev.slice(-9), { key: ++keySeq.current, route }];
    });
  }, []);
  const back = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);

  // Android back pops the Forum stack while Forum is the visible sub-tab.
  useEffect(() => {
    if (!active || !stack.length) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [active, stack.length, back]);

  // Deep link: open the post once per id.
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || lastFocus.current === focusId) return;
    lastFocus.current = focusId;
    push({ name: 'post', id: focusId });
  }, [focusId, push]);

  const patchCommunity = useCallback((c: ForumCommunity) => {
    setCommunities((prev) => {
      const next = prev.map((x) => (x.id === c.id ? { ...x, ...c } : x));
      forumCache.set(COMMUNITIES_KEY, next);
      return next;
    });
  }, []);

  const nav: ForumNav = useMemo(
    () => ({
      push,
      back,
      openComposer: (req) => setComposer(req),
      openUser: (id) => setUserSheet(id),
      onGateError: gate,
      onBlocked: (id) => {
        forumBus.emitBlocked(id);
        forumCache.clear();
      },
      me: userId || null,
      roles: roles || [],
      communities,
      bumpStanding: () => setStandingKey((k) => k + 1),
    }),
    [push, back, gate, userId, roles, communities]
  );

  const toggleJoin = async (c: ForumCommunity) => {
    if (joining) return;
    setJoining(c.id);
    patchCommunity({ ...c, isMember: !c.isMember });
    try {
      const r = c.isMember ? await leaveCommunity(c.id) : await joinCommunity(c.id);
      Haptics.selectionAsync().catch(() => {});
      patchCommunity({ ...c, isMember: r.isMember, memberCount: r.memberCount });
    } catch (e: any) {
      patchCommunity(c);
      gate(e);
      Alert.alert("Couldn't update", forumErrorMessage(e));
    } finally {
      setJoining(null);
    }
  };

  const onPublished = (post: ForumPost, { edited }: { edited: boolean }) => {
    forumCache.clear();
    if (!edited) {
      forumCache.set(COMMUNITIES_KEY, communities);
      // Open the new post (replace a composer-launched duplicate if the post is already on top).
      push({ name: 'post', id: post.id, post });
    }
    load('refresh');
  };

  const joined = communities.filter((c) => c.isMember && c.status === 'active');
  const others = communities.filter((c) => !c.isMember && c.status === 'active');
  const pending = communities.filter((c) => c.status === 'pending');
  const moderates = communities.some((c) => !!c.myRole);
  const guides = communities.filter((c) => c.freshersGuide);

  const renderRoute = (r: ForumRoute) => {
    switch (r.name) {
      case 'community':
        return <CommunityScreen id={r.id} initial={r.community} onCommunityChanged={patchCommunity} />;
      case 'post':
        return <ForumPostScreen id={r.id} initial={r.post} />;
      case 'target':
        return <ReviewTargetScreen id={r.id} initial={r.target} />;
      case 'reviews':
        return <ReviewsBrowseScreen />;
      case 'search':
        return <ForumSearchScreen communityId={r.communityId} communityName={r.communityName} />;
      case 'library':
        return <ForumLibraryScreen tab={r.tab} />;
      case 'modqueue':
        return <ModQueueScreen communityId={r.communityId} />;
      default:
        return null;
    }
  };

  const ForumIcon = SUB_TAB_META.forum.icon;

  const CommunityRow = ({ c }: { c: ForumCommunity }) => {
    const Icon = communityIcon(c);
    return (
      <TouchableOpacity
        style={styles.community}
        onPress={() => push({ name: 'community', id: c.id, community: c })}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${c.name}. ${c.description || ''} ${c.memberCount} members, ${c.postCount} posts.${c.isMember ? ' Joined.' : ''}${c.myRole ? ` You are ${c.myRole}.` : ''}`}
      >
        <View style={styles.cIcon}>
          <Icon size={20} color={SectionTints.forum.fg} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[FT.h3, { flexShrink: 1 }]} numberOfLines={1}>
              {c.name}
            </Text>
            {c.myRole ? (
              <View style={styles.roleTag}>
                <ShieldCheck size={10} color={FriendsColors.accent} />
                <Text style={styles.roleText}>{c.myRole === 'owner' ? 'Owner' : 'Mod'}</Text>
              </View>
            ) : null}
            {c.status === 'pending' ? (
              <View style={[styles.roleTag, { backgroundColor: FriendsColors.warnSoft }]}>
                <Hourglass size={10} color={FriendsColors.warn} />
                <Text style={[styles.roleText, { color: FriendsColors.warn }]}>Pending</Text>
              </View>
            ) : null}
          </View>
          {c.description ? (
            <Text style={FT.small} numberOfLines={1}>
              {c.description}
            </Text>
          ) : null}
          <Text style={[FT.small, { color: FriendsColors.faint, marginTop: 2 }]}>
            {compactCount(c.memberCount)} members · {compactCount(c.postCount)} posts{c.freshersGuide ? ' · Freshers Guide' : ''}
          </Text>
        </View>
        {c.status === 'active' && !c.isMember ? (
          <TouchableOpacity
            style={styles.joinBtn}
            onPress={() => toggleJoin(c)}
            disabled={joining === c.id}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Join ${c.name}`}
          >
            {joining === c.id ? <ActivityIndicator size="small" color={FriendsColors.accent} /> : <Text style={styles.joinText}>Join</Text>}
          </TouchableOpacity>
        ) : (
          <ChevronRight size={18} color={FriendsColors.muted} />
        )}
      </TouchableOpacity>
    );
  };

  const quick: { key: string; label: string; icon: React.ReactNode; onPress: () => void }[] = [
    { key: 'ask', label: 'Ask', icon: <HelpCircle size={18} color={FriendsColors.accent} />, onPress: () => setComposer({ type: 'question' }) },
    { key: 'review', label: 'Reviews', icon: <Star size={18} color={FriendsColors.gold} />, onPress: () => push({ name: 'reviews' }) },
    { key: 'saved', label: 'Saved', icon: <Bookmark size={18} color={FriendsColors.accent} />, onPress: () => push({ name: 'library', tab: 'saved' }) },
    { key: 'mine', label: 'My posts', icon: <PenLine size={18} color={FriendsColors.accent} />, onPress: () => push({ name: 'library', tab: 'mine' }) },
  ];
  if (moderates) quick.push({ key: 'mod', label: 'Moderate', icon: <Gavel size={18} color={FriendsColors.accent} />, onPress: () => push({ name: 'modqueue' }) });

  const home = (
    <ScrollView
      style={fui.screen}
      contentContainerStyle={{ padding: FS.lg, paddingBottom: 120, gap: FS.lg }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setStandingKey((k) => k + 1);
            load('refresh');
          }}
          tintColor={FriendsColors.accent}
          colors={[FriendsColors.accent]}
          progressBackgroundColor={FriendsColors.card}
        />
      }
    >
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={FT.h1} accessibilityRole="header">
            Forum
          </Text>
          <Text style={FT.small}>Questions, guides and honest reviews from your campus</Text>
        </View>
        <TouchableOpacity style={styles.round} onPress={() => push({ name: 'search' })} accessibilityRole="button" accessibilityLabel="Search the Forum">
          <Search size={20} color={FriendsColors.ink} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.askBar} onPress={() => setComposer({})} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Start a new post">
        <PenLine size={18} color={FriendsColors.muted} />
        <Text style={[FT.muted, { flex: 1 }]}>Ask a question or share what you know…</Text>
        <View style={styles.askPlus}>
          <BrandFill radius={20} />
          <Plus size={16} color={FriendsColors.accentInk} />
        </View>
      </TouchableOpacity>

      <View style={styles.quickRow}>
        {quick.map((q) => (
          <TouchableOpacity key={q.key} style={styles.quick} onPress={q.onPress} accessibilityRole="button" accessibilityLabel={q.label}>
            {q.icon}
            <Text style={styles.quickText} numberOfLines={1}>
              {q.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <MyStandingCard userId={userId} refreshKey={standingKey} />

      {loading && !communities.length ? (
        <FriendsSkeleton rows={4} variant="row" />
      ) : error && !communities.length ? (
        <FriendsError message={forumErrorMessage(error, "Couldn't load communities.")} onRetry={() => load()} />
      ) : !communities.length ? (
        <FriendsEmpty
          tint={SectionTints.forum.fg}
          icon={<ForumIcon size={26} color={SectionTints.forum.fg} />}
          title="No communities yet"
          subtitle="Your campus Forum is being set up. Pull to refresh in a moment."
          actionLabel="Refresh"
          onAction={() => load('refresh')}
        />
      ) : (
        <>
          {error ? (
            <TouchableOpacity style={styles.stale} onPress={() => load('refresh')} accessibilityRole="button">
              <Text style={[FT.small, { color: FriendsColors.warn, flex: 1 }]}>Showing what was loaded earlier. Tap to retry.</Text>
            </TouchableOpacity>
          ) : null}

          {guides.length ? (
            <View>
              <Text style={styles.section}>Freshers Guides</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
                {guides.map((c) => {
                  const g = c.freshersGuide!;
                  const official = g.label === 'official';
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.guide, official ? styles.guideOfficial : styles.guideStudent]}
                      onPress={() => push({ name: 'post', id: g.postId })}
                      accessibilityRole="button"
                      accessibilityLabel={`${c.name} Freshers Guide, ${official ? 'official' : 'student advice'}: ${g.title}`}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        {official ? <ShieldCheck size={12} color={FriendsColors.gold} /> : <Sparkles size={12} color={FriendsColors.accent} />}
                        <Text style={[styles.guideLabel, { color: official ? FriendsColors.gold : FriendsColors.accent }]}>{official ? 'Official' : 'Student advice'}</Text>
                      </View>
                      <Text style={[FT.h3, { marginTop: 6 }]} numberOfLines={2}>
                        {g.title}
                      </Text>
                      <Text style={[FT.small, { marginTop: 4 }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {joined.length ? (
            <View>
              <Text style={styles.section}>Your communities</Text>
              <View style={{ gap: FS.sm }}>
                {joined.map((c) => (
                  <CommunityRow key={c.id} c={c} />
                ))}
              </View>
            </View>
          ) : null}

          {others.length ? (
            <View>
              <Text style={styles.section}>{joined.length ? 'More communities' : 'Communities'}</Text>
              <View style={{ gap: FS.sm }}>
                {others.map((c) => (
                  <CommunityRow key={c.id} c={c} />
                ))}
              </View>
            </View>
          ) : null}

          {pending.length ? (
            <View>
              <Text style={styles.section}>Your requests</Text>
              <View style={{ gap: FS.sm }}>
                {pending.map((c) => (
                  <CommunityRow key={c.id} c={c} />
                ))}
              </View>
            </View>
          ) : null}

          <TouchableOpacity style={[fui.ghostBtn, { alignSelf: 'center' }]} onPress={() => setRequestOpen(true)} accessibilityRole="button" accessibilityLabel="Request a new community">
            <Plus size={16} color={FriendsColors.ink} />
            <Text style={fui.ghostBtnText}>Request a community</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );

  return (
    <ForumNavContext.Provider value={nav}>
      <View style={styles.root}>
        <View style={[styles.layer, stack.length ? styles.hidden : null]} importantForAccessibility={stack.length ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!stack.length}>
          {home}
        </View>
        {stack.map((s, i) => {
          const top = i === stack.length - 1;
          return (
            <View
              key={s.key}
              style={[styles.layer, !top && styles.hidden]}
              importantForAccessibility={top ? 'auto' : 'no-hide-descendants'}
              accessibilityElementsHidden={!top}
            >
              {renderRoute(s.route)}
            </View>
          );
        })}
      </View>

      <ForumComposer
        request={composer}
        communities={communities}
        onClose={() => setComposer(null)}
        onPublished={onPublished}
        onGateError={gate}
        onOpenPost={(id) => push({ name: 'post', id })}
        onOpenTarget={(id) => push({ name: 'target', id })}
      />
      <ForumUserSheet userId={userSheet} onClose={() => setUserSheet(null)} onBlocked={nav.onBlocked} />
      <RequestCommunitySheet
        visible={requestOpen}
        onClose={() => setRequestOpen(false)}
        onRequested={(c) => {
          setCommunities((prev) => [...prev.filter((x) => x.id !== c.id), c]);
          load('refresh');
        }}
      />
    </ForumNavContext.Provider>
  );
};

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: FriendsColors.bg },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FriendsColors.bg },
  hidden: { display: 'none' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: FS.md },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    minHeight: 52,
    paddingLeft: FS.lg,
    paddingRight: 6,
    borderRadius: FR.pill,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  askPlus: { width: 40, height: 40, borderRadius: 20, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  quickRow: { flexDirection: 'row', gap: FS.sm },
  quick: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 68,
    paddingHorizontal: 4,
    borderRadius: FR.md,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.lineSoft,
  },
  quickText: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  section: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: FriendsColors.muted, textTransform: 'uppercase', marginBottom: FS.sm },
  community: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    padding: FS.md,
    minHeight: 72,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  cIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: SectionTints.forum.soft, alignItems: 'center', justifyContent: 'center' },
  roleTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: FR.pill, backgroundColor: FriendsColors.accentSoft },
  roleText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accent },
  joinBtn: { minWidth: 64, minHeight: 36, paddingHorizontal: 14, borderRadius: FR.pill, borderWidth: 1, borderColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  joinText: { fontSize: 13, fontWeight: '800', color: FriendsColors.accent },
  guide: { width: 200, padding: FS.md, borderRadius: FR.card, borderWidth: 1, minHeight: 104 },
  guideOfficial: { backgroundColor: 'rgba(232,196,127,0.06)', borderColor: 'rgba(232,196,127,0.35)' },
  guideStudent: { backgroundColor: 'rgba(212,175,122,0.06)', borderColor: 'rgba(212,175,122,0.3)' },
  guideLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  stale: { padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.warnSoft, minHeight: 44, flexDirection: 'row', alignItems: 'center' },
}));
