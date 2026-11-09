import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, BackHandler, StyleSheet, AppState, FlatList, ScrollView, RefreshControl } from 'react-native';
import { PenLine, Plus, Bookmark, TrendingUp, UserRound, Sparkles, Users } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import type { CampusProfileData, CampusUserData } from '../../../../types/campus';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { BrandFill } from '../shared/FriendsUi';
import { FriendsEmpty } from '../shared/FriendsEmpty';
import { OfflineBanner } from '../shared/OfflineBanner';
import { EligibilityGate } from '../shared/gates';
import { FriendsEligibility, fetchFollowing, fetchFriendsUser, isGateError } from '../api/core';
import { PulseFeedItem, PulseFeedTab, PulsePost, PulseTrend, fetchPulseFeed, fetchPulsePost } from '../api/pulseApi';
import { LegacyPulse, LegacyPulseProps } from './LegacyPulse';
import { CampusMomentsStrip } from './CampusMomentsStrip';
import { PulseComposer } from './PulseComposer';
import { PulseFeedList } from './PulseUi';
import { ThreadScreen } from './ThreadScreen';
import { HashtagScreen, PulseLibraryScreen, PulseUserSheet, TrendsRow, TrendsScreen, UserPostsScreen } from './PulseListScreens';
import { PulseNav, PulseNavContext, PulseRoute, PulseComposerRequest } from './pulseNav';
import { itemKey, pulseBus, pulseCache } from './pulseShared';
import { usePulsePaged } from './usePulsePaged';

import { themedSheet } from '../../../../utils/themeNow';
export interface PulseHomeProps extends LegacyPulseProps {
  /** Pulse is on for this student (/friends/eligibility features.pulse). */
  enabled: boolean;
  /** Last eligibility answer (shows the verify / restricted gate when Pulse is on for the campus). */
  eligibility?: FriendsEligibility | null;
  /** Post id from a deep link / notification (/friends?tab=friends&sub=pulse&id=...). */
  focusId?: string | null;
  /** Changes once per deep link into Pulse (applies ?segment=wall|posts once). */
  linkKey?: string | null;
  /** True while Pulse is the visible sub-tab (Android back, refetch on focus). */
  active?: boolean;
  /** Open a Space in Friends > Spaces (from a Space card). */
  onOpenSpace?: (spaceId: string) => void;
  /** Ask the Friends shell to refetch eligibility (flag, guidelines or restriction changed). */
  onGateError?: () => void;
  onOpenVerify?: () => void;
  onOpenSafety?: () => void;
}

let lastTab: PulseFeedTab = 'campus';

/**
 * Campus > Friends > Pulse.
 * - On (flag + verified): the real campus feed — Campus / Following, posts, replies, polls,
 *   hashtags, trends, reposts, bookmarks, Space cards — with Campus Moments (9 PM question,
 *   Branch Wars, Today, Birthdays, The Wall) on top. Posting anonymously happens here (the old
 *   Whispers board was imported as anonymous posts).
 * - On for the campus but not for this student (unverified / restricted): Campus Moments plus the
 *   gate explaining why.
 * - Off (flag off, older server): the previous campus feed, unchanged, so nothing is lost before launch.
 */
export const PulseHome: React.FC<PulseHomeProps> = (props) => {
  const { enabled, eligibility } = props;
  if (enabled) return <PulseFeedHome {...props} />;
  if (eligibility && !eligibility.eligible && eligibility.available?.pulse) return <PulseLocked {...props} />;
  return (
    <LegacyPulse
      profile={props.profile}
      user={props.user}
      segment={props.segment}
      onChangeSegment={props.onChangeSegment}
      onOpenWhispers={props.onOpenWhispers}
      onOpenNightQuestion={props.onOpenNightQuestion}
      onOpenBranchWars={props.onOpenBranchWars}
    />
  );
};

/** Moment link from a notification: ?segment=wall → The Wall, ?segment=posts → Birthdays. */
const useMomentLink = (linkKey: string | null | undefined, focusId: string | null | undefined, segment: string) =>
  useMemo(() => {
    if (!linkKey || focusId) return null;
    if (segment === 'wall') return { key: linkKey, target: 'wall' as const };
    if (segment === 'posts') return { key: linkKey, target: 'birthdays' as const };
    return null;
  }, [linkKey, focusId]); // eslint-disable-line react-hooks/exhaustive-deps

const userIdOf = (profile: CampusProfileData | null, user: CampusUserData | null) => String((user as any)?.id || (profile as any)?.userId || '') || null;

const PulseLocked: React.FC<PulseHomeProps> = ({ eligibility, profile, user, onOpenNightQuestion, onOpenBranchWars, onOpenVerify, onOpenSafety, linkKey, focusId, segment }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const moment = useMomentLink(linkKey, focusId, segment);
  return (
    <ScrollView
      style={fui.screen}
      contentContainerStyle={{ padding: FS.lg, paddingBottom: 120 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => setRefreshKey((k) => k + 1)} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />
      }
    >
      <Text style={[FT.h1, { marginBottom: FS.md }]} accessibilityRole="header">
        Pulse
      </Text>
      <CampusMomentsStrip refreshKey={refreshKey} onOpenNightQuestion={onOpenNightQuestion} onOpenBranchWars={onOpenBranchWars} openRequest={moment} me={userIdOf(profile, user)} />
      <View style={[fui.cardPad, { marginTop: FS.md }]}>
        <EligibilityGate eligibility={eligibility || null} onVerify={onOpenVerify} onOpenSafety={onOpenSafety} compact />
      </View>
    </ScrollView>
  );
};

const PulseFeedHome: React.FC<PulseHomeProps> = ({
  focusId,
  profile,
  user,
  segment,
  onChangeSegment,
  onOpenNightQuestion,
  onOpenBranchWars,
  linkKey,
  active = true,
  onOpenSpace,
  onGateError,
}) => {
  const me = userIdOf(profile, user);
  const [tab, setTab] = useState<PulseFeedTab>(lastTab);
  const [followingVisited, setFollowingVisited] = useState(lastTab === 'following');
  const [stack, setStack] = useState<{ key: number; route: PulseRoute }[]>([]);
  const [composer, setComposer] = useState<PulseComposerRequest | null>(null);
  const [userSheet, setUserSheet] = useState<string | null>(null);
  const [momentsKey, setMomentsKey] = useState(0);
  const [followedEntities, setFollowedEntities] = useState<Set<string>>(() => pulseCache.get<Set<string>>('followedEntities') || new Set());
  const keySeq = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const campusRef = useRef<FlatList<PulseFeedItem>>(null);
  const followingRef = useRef<FlatList<PulseFeedItem>>(null);

  const gate = useCallback(
    (e: any) => {
      if (isGateError(e)) onGateError?.();
    },
    [onGateError]
  );

  const campus = usePulsePaged<PulseFeedItem, PulseTrend[]>(
    'feed:campus',
    async (cursor) => {
      const r = await fetchPulseFeed('campus', cursor);
      return { items: r.items, nextCursor: r.nextCursor, extra: r.trends };
    },
    itemKey,
    { onError: gate }
  );
  const following = usePulsePaged<PulseFeedItem>(followingVisited ? 'feed:following' : null, (cursor) => fetchPulseFeed('following', cursor), itemKey, { onError: gate });

  // Entities I follow (menu state for club / official posts).
  useEffect(() => {
    let alive = true;
    fetchFollowing({ type: 'entity' })
      .then((r) => {
        if (!alive) return;
        const ids = new Set(r.items.filter((x) => x.type === 'entity').map((x: any) => String(x.entity?.id)));
        setFollowedEntities(ids);
        pulseCache.set('followedEntities', ids);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const selectTab = (t: PulseFeedTab) => {
    if (t === tab) {
      // Tapping the active tab scrolls to the top.
      (t === 'campus' ? campusRef : followingRef).current?.scrollToOffset({ offset: 0, animated: true });
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    lastTab = t;
    setTab(t);
    if (t === 'following') setFollowingVisited(true);
  };

  // My new root posts appear at the top right away (anonymous ones never go to Following).
  const campusUpdate = campus.update;
  const followingUpdate = following.update;
  useEffect(
    () =>
      pulseBus.onCreated((p: PulsePost) => {
        if (p.kind !== 'post') return;
        campusUpdate((prev) => (prev.some((x) => x.kind === 'post' && x.id === p.id) ? prev : [p, ...prev]));
        if (!(p.author as any)?.anonymous) followingUpdate((prev) => (prev.some((x) => x.kind === 'post' && x.id === p.id) ? prev : [p, ...prev]));
      }),
    [campusUpdate, followingUpdate]
  );

  // Refetch on focus (sub-tab shown again, app back from background) when older than a minute.
  const refreshIfStaleCampus = campus.refreshIfStale;
  const refreshIfStaleFollowing = following.refreshIfStale;
  useEffect(() => {
    if (!active) return;
    if (tab === 'campus') refreshIfStaleCampus(60000);
    else refreshIfStaleFollowing(60000);
  }, [active, tab, refreshIfStaleCampus, refreshIfStaleFollowing]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !active) return;
      if (tab === 'campus') refreshIfStaleCampus(60000);
      else refreshIfStaleFollowing(60000);
    });
    return () => sub.remove();
  }, [active, tab, refreshIfStaleCampus, refreshIfStaleFollowing]);

  const push = useCallback((route: PulseRoute) => {
    setStack((prev) => {
      const top = prev[prev.length - 1]?.route;
      // Re-opening the screen that is already on top (double tap) is a no-op.
      const sig = (r: PulseRoute) => `${r.name}:${(r as any).id || (r as any).tag || (r as any).userId || (r as any).tab || ''}`;
      if (top && sig(top) === sig(route)) return prev;
      return [...prev.slice(-11), { key: ++keySeq.current, route }];
    });
  }, []);
  const back = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);

  // Android back pops the Pulse stack while Pulse is the visible sub-tab.
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
    // Reply / mention links carry a post id; follow notifications carry the follower's user id.
    fetchPulsePost(focusId)
      .then((r) => mountedRef.current && push({ name: 'thread', id: focusId, post: r.post }))
      .catch(async (e: any) => {
        if (!mountedRef.current) return;
        if (e?.status === 404) {
          try {
            await fetchFriendsUser(focusId);
            if (mountedRef.current) setUserSheet(focusId);
            return;
          } catch {
            // Not a student either: the thread screen explains it isn't available.
          }
        }
        if (mountedRef.current) push({ name: 'thread', id: focusId });
      });
  }, [focusId, push]);

  // ?segment=wall|posts links (Wall events, birthday alerts) open the matching moment once.
  const moment = useMomentLink(linkKey, focusId, segment);
  useEffect(() => {
    if (moment && segment !== 'pulse') onChangeSegment('pulse');
  }, [moment]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav: PulseNav = useMemo(
    () => ({
      push,
      back,
      openComposer: (req) => setComposer(req),
      openUser: (id) => setUserSheet(id),
      openSpace: (spaceId) => onOpenSpace?.(spaceId),
      onGateError: gate,
      onBlocked: (id) => {
        pulseBus.emitBlocked(id);
        // Cached pages may still hold their named posts.
        const keep = pulseCache.get<Set<string>>('followedEntities');
        pulseCache.clear();
        if (keep) pulseCache.set('followedEntities', keep);
      },
      me,
      followedEntities,
      setEntityFollowed: (entityId, on) =>
        setFollowedEntities((prev) => {
          const next = new Set(prev);
          if (on) next.add(entityId);
          else next.delete(entityId);
          pulseCache.set('followedEntities', next);
          return next;
        }),
    }),
    [push, back, gate, me, followedEntities, onOpenSpace]
  );

  const renderRoute = (r: PulseRoute) => {
    switch (r.name) {
      case 'thread':
        return <ThreadScreen id={r.id} initial={r.post} />;
      case 'hashtag':
        return <HashtagScreen tag={r.tag} />;
      case 'trends':
        return <TrendsScreen />;
      case 'library':
        return <PulseLibraryScreen tab={r.tab} />;
      case 'user':
        return <UserPostsScreen userId={r.userId} name={r.displayName} />;
      default:
        return null;
    }
  };

  const trends = campus.extra || [];

  // Each list has its own header; only the visible one mounts Campus Moments (one set of sheets).
  const header = (forTab: PulseFeedTab) => (
    <View style={{ paddingTop: FS.md }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={FT.h1} accessibilityRole="header">
            Pulse
          </Text>
          <Text style={FT.small}>What's happening on your campus</Text>
        </View>
        <TouchableOpacity style={styles.round} onPress={() => push({ name: 'trends' })} accessibilityRole="button" accessibilityLabel="Trending hashtags">
          <TrendingUp size={19} color={FriendsColors.ink} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.round} onPress={() => push({ name: 'library', tab: 'saved' })} accessibilityRole="button" accessibilityLabel="Bookmarks">
          <Bookmark size={19} color={FriendsColors.ink} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.round} onPress={() => push({ name: 'library', tab: 'mine' })} accessibilityRole="button" accessibilityLabel="My posts">
          <UserRound size={19} color={FriendsColors.ink} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.askBar} onPress={() => setComposer({})} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Write a post">
        <PenLine size={18} color={FriendsColors.muted} />
        <Text style={[FT.muted, { flex: 1 }]}>What's happening on campus?</Text>
        <View style={styles.askPlus}>
          <BrandFill radius={20} />
          <Plus size={16} color={FriendsColors.accentInk} />
        </View>
      </TouchableOpacity>

      {forTab === tab ? (
        <CampusMomentsStrip refreshKey={momentsKey} onOpenNightQuestion={onOpenNightQuestion} onOpenBranchWars={onOpenBranchWars} openRequest={moment} me={me} />
      ) : null}

      <View style={styles.toggle} accessibilityRole="tablist">
        {(['campus', 'following'] as const).map((t) => {
          const on = t === tab;
          return (
            <TouchableOpacity
              key={t}
              style={[styles.toggleBtn, on && styles.toggleOn]}
              onPress={() => selectTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t === 'campus' ? 'Campus feed' : 'Following feed'}
            >
              {on ? <BrandFill /> : null}
              {t === 'campus' ? <Sparkles size={14} color={on ? FriendsColors.accentInk : FriendsColors.muted} /> : <Users size={14} color={on ? FriendsColors.accentInk : FriendsColors.muted} />}
              <Text style={[styles.toggleText, on && { color: FriendsColors.accentInk }]}>{t === 'campus' ? 'Campus' : 'Following'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {forTab === 'campus' ? <TrendsRow trends={trends} onSeeAll={() => push({ name: 'trends' })} /> : null}
    </View>
  );

  // Pull to refresh also reloads the Campus Moments cards.
  const withMoments = <T extends { refresh: () => void }>(paged: T): T => ({
    ...paged,
    refresh: () => {
      setMomentsKey((k) => k + 1);
      paged.refresh();
    },
  });

  return (
    <PulseNavContext.Provider value={nav}>
      <View style={styles.root}>
        <View style={[styles.layer, stack.length ? styles.hidden : null]} importantForAccessibility={stack.length ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!stack.length}>
          <OfflineBanner message="You're offline. Showing posts loaded earlier." />
          <View style={[{ flex: 1 }, tab !== 'campus' && styles.hidden]}>
            <PulseFeedList
              listRef={campusRef}
              paged={withMoments(campus)}
              header={header('campus')}
              empty={
                <FriendsEmpty
                  icon={<Sparkles size={22} color={FriendsColors.accent} />}
                  title="Pulse is quiet"
                  subtitle="Be the first to post something for your campus. You can post with your name or anonymously."
                  actionLabel="Write a post"
                  onAction={() => setComposer({})}
                />
              }
            />
          </View>
          {followingVisited ? (
            <View style={[{ flex: 1 }, tab !== 'following' && styles.hidden]}>
              <PulseFeedList
                listRef={followingRef}
                paged={withMoments(following)}
                header={header('following')}
                empty={
                  <FriendsEmpty
                    icon={<Users size={22} color={FriendsColors.accent} />}
                    title="Nothing from people you follow yet"
                    subtitle="Tap a name on any post to follow them. Clubs and official accounts can be followed from their posts. Anonymous posts only show in Campus."
                    actionLabel="Browse Campus"
                    onAction={() => selectTab('campus')}
                  />
                }
              />
            </View>
          ) : null}
          <TouchableOpacity style={styles.fab} onPress={() => setComposer({})} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel="Write a post">
            <BrandFill radius={29} />
            <PenLine size={22} color={FriendsColors.accentInk} />
          </TouchableOpacity>
        </View>
        {stack.map((s, i) => {
          const top = i === stack.length - 1;
          return (
            <View key={s.key} style={[styles.layer, !top && styles.hidden]} importantForAccessibility={top ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!top}>
              {renderRoute(s.route)}
            </View>
          );
        })}
      </View>

      <PulseComposer
        request={composer}
        onClose={() => setComposer(null)}
        onGateError={gate}
        onPublished={(post, info) => {
          if (!info.edited && !info.reply) {
            if (tab !== 'campus' && (post.author as any)?.anonymous) selectTab('campus');
            setTimeout(() => (tab === 'campus' || (post.author as any)?.anonymous ? campusRef : followingRef).current?.scrollToOffset({ offset: 0, animated: true }), 250);
          }
        }}
      />
      <PulseUserSheet userId={userSheet} onClose={() => setUserSheet(null)} />
    </PulseNavContext.Provider>
  );
};

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: FriendsColors.bg },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FriendsColors.bg },
  hidden: { display: 'none' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginBottom: FS.md },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: FriendsColors.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: FriendsColors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    minHeight: 52,
    paddingLeft: FS.lg,
    paddingRight: 6,
    marginBottom: FS.lg,
    borderRadius: FR.pill,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  askPlus: { width: 40, height: 40, borderRadius: 20, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line, marginBottom: FS.md },
  toggleBtn: { flex: 1, minHeight: 44, borderRadius: FR.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  toggleOn: { backgroundColor: FriendsColors.accent },
  toggleText: { fontSize: 14, fontWeight: '800', color: FriendsColors.muted },
  fab: {
    position: 'absolute',
    right: FS.lg,
    bottom: FS.xl,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: FriendsColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
}));
