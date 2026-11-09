import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator, BackHandler, Alert, StyleSheet } from 'react-native';
import { Plus, Radio, CalendarClock, Mic, ChevronUp, ShieldCheck } from '../../../../components/lucide';
import { FriendsColors, FS, FR, FT, fui, SectionTints } from '../friendsTheme';
import { BrandFill } from '../shared/FriendsUi';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { ActionMenu } from '../shared/ActionMenu';
import { isGateError } from '../api/core';
import { Space, SpaceListStatus, SpacesMeta, fetchSpacesMeta, spaceErrorMessage } from '../api/spacesApi';
import { SpacesNav, SpacesNavContext, SpacesRoute, hostName, hostUserId, spaceBus, spaceCache, spaceLink } from './spacesShared';
import { useSpacesPaged } from './useSpacesPaged';
import { SpaceListCard } from './SpaceListCard';
import { SpaceDetail } from './SpaceDetail';
import { SpaceComposer } from './SpaceComposer';
import { SpaceRoomScreen } from './SpaceRoomScreen';
import { LiveDot, NotRecorded, SpaceSoftError } from './SpacesUi';

import { themedSheet } from '../../../../utils/themeNow';
export interface SpacesHomeProps {
  /** Space id from a deep link / notification (/friends?tab=friends&sub=spaces&id=...). */
  focusId?: string | null;
  /** Open a campus chat (unused by Spaces; kept for the shared sub-tab props). */
  onOpenChat?: (chatId: string, name: string) => void;
  /** Signed-in user id. */
  userId?: string | null;
  /** True while Spaces is the visible sub-tab (Android back pops the Spaces stack only then). */
  active?: boolean;
  /** Ask the Friends shell to refetch eligibility (guidelines / flag / restriction changed). */
  onGateError?: () => void;
}

const META_KEY = 'meta';
const LIVE_POLL_MS = 20000;
const TABS: { key: SpaceListStatus; label: string }[] = [
  { key: 'live', label: 'Live now' },
  { key: 'scheduled', label: 'Upcoming' },
  { key: 'mine', label: 'Hosted by me' },
];

/**
 * Campus > Friends > Spaces: live audio rooms for verified students on one campus.
 * Live now / Upcoming / Hosted by me lists, a composer (start now or schedule, local time),
 * Space details with reminders and host controls, and the live room. The room keeps running
 * (audio included) while minimized or while another Friends sub-tab is open.
 * Spaces are never recorded or transcribed.
 */
export const SpacesHome: React.FC<SpacesHomeProps> = ({ focusId, userId, active = true, onGateError }) => {
  const [meta, setMeta] = useState<SpacesMeta | null>(() => spaceCache.get<SpacesMeta>(META_KEY) || null);
  const [tab, setTab] = useState<SpaceListStatus>('live');
  const [visitedTabs, setVisitedTabs] = useState<Set<SpaceListStatus>>(() => new Set<SpaceListStatus>(['live']));
  const [stack, setStack] = useState<{ key: number; route: SpacesRoute }[]>([]);
  const [composer, setComposer] = useState<{ edit: Space | null } | null>(null);
  const [room, setRoom] = useState<{ space: Space; key: number } | null>(null);
  const [roomVisible, setRoomVisible] = useState(false);
  const [menuSpace, setMenuSpace] = useState<Space | null>(null);
  const keySeq = useRef(0);

  const gate = useCallback(
    (e: any) => {
      if (isGateError(e)) onGateError?.();
    },
    [onGateError]
  );

  const loadMeta = useCallback(async () => {
    try {
      const m = await fetchSpacesMeta();
      setMeta(m);
      spaceCache.set(META_KEY, m);
    } catch (e: any) {
      gate(e);
    }
  }, [gate]);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const live = useSpacesPaged('live', { enabled: visitedTabs.has('live'), onError: gate });
  const upcoming = useSpacesPaged('scheduled', { enabled: visitedTabs.has('scheduled'), onError: gate });
  const mine = useSpacesPaged('mine', { enabled: visitedTabs.has('mine'), onError: gate });
  const lists = { live, scheduled: upcoming, mine };
  const current = lists[tab];

  // Live rooms come and go: refresh the visible list quietly while Spaces is on screen.
  const liveSilent = live.silent;
  const upSilent = upcoming.silent;
  useEffect(() => {
    if (!active || stack.length || (room && roomVisible)) return;
    const t = setInterval(() => {
      if (tab === 'live') liveSilent();
      else if (tab === 'scheduled') upSilent();
    }, LIVE_POLL_MS);
    return () => clearInterval(t);
  }, [active, tab, stack.length, room, roomVisible, liveSilent, upSilent]);

  const selectTab = (t: SpaceListStatus) => {
    setTab(t);
    setVisitedTabs((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
  };

  const push = useCallback((route: SpacesRoute) => {
    setStack((prev) => {
      const top = prev[prev.length - 1]?.route;
      if (top && top.id === route.id) return prev;
      return [...prev.slice(-5), { key: ++keySeq.current, route }];
    });
  }, []);
  const back = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);

  const openRoom = useCallback(
    (space: Space) => {
      if (room && room.space.id !== space.id) {
        Alert.alert('Leave the current Space?', `You're in "${room.space.title}". Joining another Space leaves it.`, [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Switch',
            onPress: () => {
              setRoom({ space, key: ++keySeq.current });
              setRoomVisible(true);
            },
          },
        ]);
        return;
      }
      if (room) {
        setRoomVisible(true);
        return;
      }
      if (space.removed) {
        Alert.alert('You were removed', "The host removed you from this Space, so you can't rejoin it.");
        return;
      }
      setRoom({ space, key: ++keySeq.current });
      setRoomVisible(true);
    },
    [room]
  );

  const exitRoom = useCallback(() => {
    setRoom(null);
    setRoomVisible(false);
    spaceBus.emitStale();
  }, []);

  // Android back pops the in-tab stack (the room handles its own back).
  useEffect(() => {
    if (!active || !stack.length || (room && roomVisible)) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [active, stack.length, back, room, roomVisible]);

  // Deep link / notification: open the Space once per id.
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || lastFocus.current === focusId) return;
    lastFocus.current = focusId;
    if (room && room.space.id === focusId) {
      setRoomVisible(true);
      return;
    }
    push({ name: 'space', id: focusId });
  }, [focusId, push, room]);

  const nav: SpacesNav = useMemo(
    () => ({
      push,
      back,
      openComposer: (edit) => setComposer({ edit: edit || null }),
      openRoom,
      roomSpaceId: room?.space.id || null,
      onGateError: gate,
      onBlocked: () => {
        spaceCache.clear();
        if (meta) spaceCache.set(META_KEY, meta);
        spaceBus.emitStale();
      },
      meta,
      me: userId || null,
    }),
    [push, back, openRoom, room, gate, meta, userId]
  );

  const onComposed = (space: Space, info: { edited: boolean; underReview: boolean; rescheduled: boolean }) => {
    setComposer(null);
    spaceBus.emit(space);
    spaceBus.emitStale();
    if (info.edited) {
      if (info.rescheduled) setTimeout(() => Alert.alert('Rescheduled', 'Everyone with a reminder will be told the new time.'), 350);
      return;
    }
    if (space.status === 'live') {
      selectTab('live');
      openRoom(space);
    } else {
      selectTab('mine');
      push({ name: 'space', id: space.id, space });
    }
    if (info.underReview) {
      setTimeout(
        () => Alert.alert('Waiting for a quick check', "Part of your Space needs a moderator's look before others can see it. You'll get a notification."),
        400
      );
    }
  };

  const MicIcon = Mic;
  const empty = (() => {
    if (tab === 'live')
      return (
        <FriendsEmpty
          tint={SectionTints.spaces.fg}
          icon={<Radio size={26} color={SectionTints.spaces.fg} />}
          title="Nobody is live right now"
          subtitle="Start a Space to talk with your campus: placement prep, fest plans, exam doubts, late-night chats."
          actionLabel="Start a Space"
          onAction={() => setComposer({ edit: null })}
          secondaryLabel="See upcoming Spaces"
          onSecondary={() => selectTab('scheduled')}
        />
      );
    if (tab === 'scheduled')
      return (
        <FriendsEmpty
          tint={SectionTints.spaces.fg}
          icon={<CalendarClock size={26} color={SectionTints.spaces.fg} />}
          title="Nothing scheduled yet"
          subtitle="Schedule a Space so people can set a reminder and show up on time."
          actionLabel="Schedule a Space"
          onAction={() => setComposer({ edit: null })}
        />
      );
    return (
      <FriendsEmpty
        tint={SectionTints.spaces.fg}
          icon={<MicIcon size={26} color={SectionTints.spaces.fg} />}
        title="You haven't hosted a Space"
        subtitle="Host as yourself, or as a verified club you manage. Up to 6 people on stage and 40 listening."
        actionLabel="Start a Space"
        onAction={() => setComposer({ edit: null })}
      />
    );
  })();

  const header = (
    <View>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={FT.h1} accessibilityRole="header">
            Spaces
          </Text>
          <Text style={FT.small}>Live audio with your campus. Never recorded.</Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => setComposer({ edit: null })} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Start or schedule a Space">
          <BrandFill />
          <Plus size={18} color={FriendsColors.accentInk} />
          <Text style={styles.newText}>New</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.key === tab;
          const count = t.key === 'live' && live.items.length ? live.items.length : 0;
          return (
            <TouchableOpacity key={t.key} onPress={() => selectTab(t.key)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={count ? `${t.label}, ${count} live` : t.label}>
              {t.key === 'live' && count ? <LiveDot size={6} /> : null}
              <Text style={[styles.tabText, on && { color: FriendsColors.ink }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {current.softError ? <SpaceSoftError error={current.softError} onRetry={current.refresh} /> : null}
    </View>
  );

  const menuHostId = menuSpace ? hostUserId(menuSpace.host) : null;

  const renderList = (key: SpaceListStatus) => {
    const l = lists[key];
    return (
      <FlatList
        key={key}
        style={[fui.screen, key !== tab && styles.hidden]}
        data={l.items}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: FS.lg }}>
            <SpaceListCard
              space={item}
              onPress={(s) => push({ name: 'space', id: s.id, space: s })}
              onMore={item.isHost ? undefined : setMenuSpace}
              onChanged={(s) => spaceBus.emit(s)}
            />
          </View>
        )}
        ItemSeparatorComponent={Sep}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: FS.md }}
        onEndReached={l.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={l.refreshing}
            onRefresh={() => {
              l.refresh();
              loadMeta();
            }}
            tintColor={FriendsColors.accent}
            colors={[FriendsColors.accent]}
            progressBackgroundColor={FriendsColors.card}
          />
        }
        ListEmptyComponent={l.loading ? <FriendsSkeleton rows={3} /> : l.error ? <FriendsError message={spaceErrorMessage(l.error, "Couldn't load Spaces.")} onRetry={l.reload} /> : empty}
        ListFooterComponent={
          <View style={{ padding: FS.lg, paddingBottom: room ? 180 : 120, gap: FS.md, alignItems: 'center' }}>
            {l.loadingMore ? <ActivityIndicator color={FriendsColors.accent} /> : null}
            {l.items.length ? (
              <View style={styles.trust}>
                <ShieldCheck size={14} color={FriendsColors.faint} />
                <Text style={[FT.small, { color: FriendsColors.faint, flex: 1 }]}>
                  Only verified students on your campus can join. Spaces are live only: no recordings, no transcripts.
                </Text>
              </View>
            ) : null}
          </View>
        }
      />
    );
  };

  return (
    <SpacesNavContext.Provider value={nav}>
      <View style={styles.root}>
        <View style={[styles.layer, stack.length ? styles.hidden : null]} importantForAccessibility={stack.length ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!stack.length}>
          {TABS.filter((t) => visitedTabs.has(t.key)).map((t) => (
            <View key={t.key} style={[{ flex: 1 }, t.key !== tab && styles.hidden]}>
              {renderList(t.key)}
            </View>
          ))}
        </View>
        {stack.map((s, i) => {
          const top = i === stack.length - 1;
          return (
            <View key={s.key} style={[styles.layer, !top && styles.hidden]} importantForAccessibility={top ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!top}>
              <SpaceDetail id={s.route.id} initial={s.route.space} active={active && top && !(room && roomVisible)} />
            </View>
          );
        })}

        {room && !roomVisible ? (
          <TouchableOpacity style={styles.mini} onPress={() => setRoomVisible(true)} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={`You're in ${room.space.title}. Tap to return to the room`}>
            <LiveDot size={8} />
            <View style={{ flex: 1 }}>
              <Text style={FT.h3} numberOfLines={1}>
                {room.space.title}
              </Text>
              <Text style={FT.small} numberOfLines={1}>
                You're in this Space · tap to return
              </Text>
            </View>
            <NotRecorded compact />
            <ChevronUp size={20} color={FriendsColors.ink} />
          </TouchableOpacity>
        ) : null}

        {room ? (
          <SpaceRoomScreen
            key={room.key}
            space={room.space}
            visible={roomVisible}
            active={active}
            onMinimize={() => setRoomVisible(false)}
            onExit={exitRoom}
          />
        ) : null}
      </View>

      <SpaceComposer visible={!!composer} edit={composer?.edit || null} onClose={() => setComposer(null)} onDone={onComposed} />
      <ActionMenu
        visible={!!menuSpace}
        onClose={() => setMenuSpace(null)}
        title={menuSpace ? menuSpace.title : 'Space'}
        copyLink={menuSpace ? spaceLink(menuSpace.id) : null}
        report={menuSpace ? { type: 'space', id: menuSpace.id, label: `the Space "${menuSpace.title.slice(0, 40)}"` } : null}
        block={menuSpace && menuHostId ? { userId: menuHostId, name: hostName(menuSpace.host) } : null}
        onBlocked={nav.onBlocked}
      />
    </SpacesNavContext.Provider>
  );
};

const Sep = () => <View style={{ height: FS.md }} />;

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: FriendsColors.bg },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FriendsColors.bg },
  hidden: { display: 'none' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: FS.md, paddingHorizontal: FS.lg, paddingTop: FS.lg },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: FR.pill, backgroundColor: FriendsColors.accent },
  newText: { fontSize: 14, fontWeight: '800', color: FriendsColors.accentInk },
  tabs: { flexDirection: 'row', gap: 4, marginHorizontal: FS.lg, marginTop: FS.lg, padding: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.lineSoft },
  tab: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 38, borderRadius: FR.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: FriendsColors.cardHi },
  tabText: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mini: {
    position: 'absolute',
    left: FS.md,
    right: FS.md,
    bottom: FS.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    padding: FS.md,
    minHeight: 64,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.cardHi,
    borderWidth: 1,
    borderColor: 'rgba(243,139,128,0.45)',
    zIndex: 15,
    elevation: 8,
  },
}));
