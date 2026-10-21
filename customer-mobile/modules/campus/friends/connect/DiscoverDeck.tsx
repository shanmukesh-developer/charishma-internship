import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Animated,
  PanResponder,
  AccessibilityInfo,
  Alert,
  Modal,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, X, SlidersHorizontal, MessageCircle, Compass, PauseCircle } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSheet } from '../shared/FriendsSheet';
import { FriendsSkeleton, SkeletonBlock } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { errorCode, isGateError } from '../api/core';
import { ConnectCard, ConnectDiscoverFilters, ConnectLookingFor, ConnectStatus, CONNECT_LOOKING_FOR, fetchDiscover, swipeConnect } from '../api/connectApi';
import { ConnectCardView } from './ConnectCardView';
import { ConnectPersonMenu } from './ConnectActions';
import { ConnectChip, ConnectHeart, ConnectPhotoView, GhostButton, PrimaryButton } from './ConnectUi';
import { LOOKING_FOR_META, YEARS, connectBus, connectErrorMessage, isConnectGateError, lookingForLabel, yearLabel } from './connectShared';

const SWIPE_X = 110;

// Last deck (per filter set) so switching tabs doesn't refetch and reshuffle.
let deckCache: { key: string; items: ConnectCard[]; cursor: string | null; done: boolean } | null = null;
export const clearConnectDeckCache = () => {
  deckCache = null;
};

const filterKey = (f: ConnectDiscoverFilters) => JSON.stringify([f.interests || [], f.year || null, f.branch || null, f.lookingFor || []]);
const filterCount = (f: ConnectDiscoverFilters) => (f.interests?.length ? 1 : 0) + (f.year ? 1 : 0) + (f.branch ? 1 : 0) + (f.lookingFor?.length ? 1 : 0);

/**
 * Discover: one verified same-campus student at a time. Like / Pass are real buttons (accessible);
 * dragging the photo left or right does the same. A mutual like opens the match moment.
 */
export const DiscoverDeck: React.FC<{
  status: ConnectStatus;
  paused: boolean;
  onResume: () => void;
  onGate: (e: any) => void;
  onOpenChat: (conversationId: string, name: string) => void;
  onOpenMatch: (matchId: string) => void;
}> = ({ status, paused, onResume, onGate, onOpenChat, onOpenMatch }) => {
  const { width } = useWindowDimensions();
  const [filters, setFilters] = useState<ConnectDiscoverFilters>({});
  const key = filterKey(filters);
  const cached = deckCache && deckCache.key === key ? deckCache : null;
  const [items, setItems] = useState<ConnectCard[]>(() => cached?.items || []);
  const [cursor, setCursor] = useState<string | null>(() => cached?.cursor || null);
  const [done, setDone] = useState(() => cached?.done || false);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [match, setMatch] = useState<{ card: ConnectCard; matchId?: string; conversationId?: string } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fetching = useRef(false);
  const swiping = useRef(false);
  const pan = useRef(new Animated.ValueXY()).current;
  const reqId = useRef(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    deckCache = { key, items, cursor, done };
  }, [key, items, cursor, done]);

  const load = useCallback(
    async (mode: 'reset' | 'more' | 'refresh') => {
      if (paused) return;
      if (mode === 'more' && (fetching.current || done)) return;
      fetching.current = true;
      const my = ++reqId.current;
      if (mode === 'reset') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      setError(null);
      try {
        const r = await fetchDiscover(filters, mode === 'more' ? cursor : null);
        if (my !== reqId.current) return;
        setItems((prev) => {
          if (mode !== 'more') return r.items;
          const seen = new Set(prev.map((c) => c.profileId));
          return [...prev, ...r.items.filter((c) => !seen.has(c.profileId))];
        });
        setCursor(r.nextCursor);
        setDone(!r.nextCursor);
      } catch (e: any) {
        if (my !== reqId.current) return;
        if (isGateError(e) || isConnectGateError(e)) onGate(e);
        setError(connectErrorMessage(e, "Couldn't load people right now."));
      } finally {
        if (my === reqId.current) {
          fetching.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [filters, cursor, done, paused, onGate]
  );

  // New filters → fresh deck (unless we already have one for them).
  useEffect(() => {
    if (paused) return;
    if (deckCache && deckCache.key === key && deckCache.items.length) return;
    setItems([]);
    setCursor(null);
    setDone(false);
    load('reset');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, paused]);

  // Keep a few cards ahead.
  useEffect(() => {
    if (!loading && !error && items.length < 4 && !done && cursor) load('more');
  }, [items.length, loading, error, done, cursor, load]);

  // A block / unmatch / delete elsewhere may change who is in the deck.
  useEffect(
    () =>
      connectBus.on((e) => {
        if (e.type === 'status') {
          deckCache = null;
        }
      }),
    []
  );

  const top = items[0] || null;
  useEffect(() => {
    setPhotoIdx(0);
    pan.setValue({ x: 0, y: 0 });
  }, [top?.profileId, pan]);

  const swipe = useCallback(
    async (action: 'like' | 'pass') => {
      const card = items[0];
      if (!card || swiping.current) return;
      swiping.current = true;
      Haptics.impactAsync(action === 'like' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const fling = () =>
        new Promise<void>((resolve) => {
          if (reduceMotion) return resolve();
          Animated.timing(pan, { toValue: { x: (action === 'like' ? 1 : -1) * width * 1.3, y: 0 }, duration: 220, useNativeDriver: false }).start(() => resolve());
        });
      await fling();
      setItems((prev) => prev.filter((c) => c.profileId !== card.profileId));
      pan.setValue({ x: 0, y: 0 });
      swiping.current = false;
      try {
        const r = await swipeConnect(card.profileId, action);
        if (r.matched) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setMatch({ card, matchId: r.matchId, conversationId: r.conversationId });
          connectBus.emit({ type: 'match', matchId: r.matchId });
        }
      } catch (e: any) {
        const code = errorCode(e);
        if (code === 'PROFILE_NOT_FOUND' || code === 'CANNOT_SWIPE_SELF') return; // no longer available: stays gone
        // Put the card back so nothing is lost.
        setItems((prev) => (prev.some((c) => c.profileId === card.profileId) ? prev : [card, ...prev]));
        if (isGateError(e) || isConnectGateError(e)) {
          onGate(e);
          return;
        }
        if (code === 'RATE_LIMITED') {
          Alert.alert(
            action === 'like' ? "That's a lot of likes" : 'Take a short break',
            action === 'like'
              ? `You can like up to ${status.limits.likesPerDay} people a day, and not too many in a minute. You can still pass, or come back a little later.`
              : `You've seen a lot of people today (up to ${status.limits.swipesPerDay} a day). Come back tomorrow for more.`
          );
        } else Alert.alert("Couldn't save that", connectErrorMessage(e));
      }
    },
    [items, pan, reduceMotion, width, onGate, status.limits]
  );

  const swipeRef = useRef(swipe);
  swipeRef.current = swipe;
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        if (g.dx > SWIPE_X) swipeRef.current('like');
        else if (g.dx < -SWIPE_X) swipeRef.current('pass');
        else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6 }).start();
      },
      onPanResponderTerminate: () => Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(),
    })
  ).current;
  const rotate = pan.x.interpolate({ inputRange: [-width, 0, width], outputRange: ['-10deg', '0deg', '10deg'] });
  const likeOpacity = pan.x.interpolate({ inputRange: [0, SWIPE_X], outputRange: [0, 1], extrapolate: 'clamp' });
  const passOpacity = pan.x.interpolate({ inputRange: [-SWIPE_X, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  const nFilters = filterCount(filters);

  const header = (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={FT.h2} accessibilityRole="header">
          Discover
        </Text>
        <Text style={FT.small}>Verified students on your campus</Text>
      </View>
      <TouchableOpacity style={[styles.round, nFilters > 0 && { borderColor: FriendsColors.accent }]} onPress={() => setFiltersOpen(true)} accessibilityRole="button" accessibilityLabel={nFilters ? `Filters, ${nFilters} on` : 'Filters'}>
        <SlidersHorizontal size={18} color={nFilters ? FriendsColors.accent : FriendsColors.ink} />
        {nFilters ? (
          <View style={styles.dot}>
            <Text style={styles.dotText}>{nFilters}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );

  let body: React.ReactNode;
  if (paused) {
    body = (
      <FriendsEmpty
        icon={<PauseCircle size={22} color={FriendsColors.accent} />}
        title="Connect is paused"
        subtitle="You're hidden from discovery. Your matches and chats are still here. Resume to see people again."
        actionLabel="Resume Connect"
        onAction={onResume}
      />
    );
  } else if (loading && !top) {
    body = (
      <View style={{ paddingHorizontal: FS.lg, gap: FS.md }}>
        <SkeletonBlock width="100%" height={Math.min(Math.round((width - FS.lg * 2) * 1.2), 520)} radius={FR.hero} />
        <FriendsSkeleton rows={1} variant="row" />
      </View>
    );
  } else if (error && !top) {
    body = <FriendsError message={error} onRetry={() => load('reset')} />;
  } else if (!top) {
    body = (
      <FriendsEmpty
        icon={<Compass size={22} color={FriendsColors.accent} />}
        title={nFilters ? 'Nobody matches these filters' : "You're all caught up"}
        subtitle={nFilters ? 'Try fewer filters. Year and branch filters only find people who show them.' : 'No new people on your campus right now. New students join every day, so check back soon.'}
        actionLabel={nFilters ? 'Clear filters' : 'Check again'}
        onAction={() => (nFilters ? setFilters({}) : load('refresh'))}
      />
    );
  } else {
    body = (
      <View style={{ paddingHorizontal: FS.lg }}>
        <Animated.View
          {...responder.panHandlers}
          style={{ transform: reduceMotion ? [] : [{ translateX: pan.x }, { rotate }] }}
          accessibilityHint="Use the Like and Pass buttons below. You can also drag the card right to like or left to pass."
        >
          <ConnectCardView card={top} status={status} onMore={() => setMenuOpen(true)} onPhotoIndex={setPhotoIdx} />
          {!reduceMotion ? (
            <>
              <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLike, { opacity: likeOpacity }]}>
                <Text style={[styles.stampText, { color: FriendsColors.accent }]}>LIKE</Text>
              </Animated.View>
              <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampPass, { opacity: passOpacity }]}>
                <Text style={[styles.stampText, { color: FriendsColors.muted }]}>PASS</Text>
              </Animated.View>
            </>
          ) : null}
        </Animated.View>
        {items.length > 1 ? <Text style={[FT.small, { textAlign: 'center', marginTop: FS.lg }]}>{items.length - 1 > 15 ? 'Plenty more' : `${items.length - 1} more`} after this</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={fui.screen}
        contentContainerStyle={{ paddingBottom: top && !paused ? 130 : 60 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />
        }
      >
        {header}
        {body}
      </ScrollView>

      {top && !paused ? (
        <View style={styles.actions} pointerEvents="box-none">
          <TouchableOpacity style={[styles.actionBtn, styles.passBtn]} onPress={() => swipe('pass')} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`Pass on ${top.displayName}`}>
            <X size={28} color={FriendsColors.ink} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.likeBtn]} onPress={() => swipe('like')} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`Like ${top.displayName}`}>
            <Heart size={30} color={FriendsColors.accentInk} fill={FriendsColors.accentInk} />
          </TouchableOpacity>
        </View>
      ) : null}

      <FiltersSheet visible={filtersOpen} value={filters} status={status} onClose={() => setFiltersOpen(false)} onApply={(f) => { setFiltersOpen(false); setFilters(f); }} />

      {top ? (
        <ConnectPersonMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          name={top.displayName}
          profileId={top.profileId}
          photoId={top.photos[photoIdx]?.id || null}
          onBlocked={() => {
            setItems((prev) => prev.filter((c) => c.profileId !== top.profileId));
            connectBus.emit({ type: 'status' });
          }}
        />
      ) : null}

      <MatchMoment
        match={match}
        onClose={() => setMatch(null)}
        onMessage={() => {
          const m = match;
          setMatch(null);
          if (m?.conversationId) onOpenChat(m.conversationId, m.card.displayName);
          else if (m?.matchId) onOpenMatch(m.matchId);
        }}
        onView={() => {
          const m = match;
          setMatch(null);
          if (m?.matchId) onOpenMatch(m.matchId);
        }}
      />
    </View>
  );
};

// ── Filters ───────────────────────────────────────────────────────────────────

const FiltersSheet: React.FC<{
  visible: boolean;
  value: ConnectDiscoverFilters;
  status: ConnectStatus;
  onClose: () => void;
  onApply: (f: ConnectDiscoverFilters) => void;
}> = ({ visible, value, status, onClose, onApply }) => {
  const [lookingFor, setLookingFor] = useState<ConnectLookingFor[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [branch, setBranch] = useState('');
  const [interests, setInterests] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLookingFor(value.lookingFor || []);
    setYear(value.year || null);
    setBranch(value.branch || '');
    setInterests((value.interests || []).join(', '));
  }, [visible, value]);

  const apply = () => {
    const list = interests
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 5);
    onApply({ lookingFor, year, branch: branch.trim().toUpperCase() || null, interests: list });
  };

  return (
    <FriendsSheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      subtitle="Year and branch only match people who choose to show them."
      footer={
        <View style={{ flexDirection: 'row', gap: FS.sm, paddingTop: FS.md }}>
          <GhostButton label="Clear" onPress={() => onApply({})} style={{ flex: 1 }} />
          <PrimaryButton label="Show people" onPress={apply} style={{ flex: 2 }} />
        </View>
      }
    >
      <Text style={[FT.kicker, { marginBottom: FS.sm }]}>Looking for</Text>
      <View style={styles.wrap}>
        {CONNECT_LOOKING_FOR.map((k) => {
          const on = lookingFor.includes(k);
          const Icon = LOOKING_FOR_META[k].icon;
          return (
            <ConnectChip
              key={k}
              label={lookingForLabel(k, status)}
              selected={on}
              icon={<Icon size={13} color={FriendsColors.muted} />}
              onPress={() => setLookingFor(on ? lookingFor.filter((x) => x !== k) : [...lookingFor, k])}
            />
          );
        })}
      </View>
      <Text style={[FT.kicker, { marginTop: FS.lg, marginBottom: FS.sm }]}>Year</Text>
      <View style={styles.wrap}>
        <ConnectChip label="Any" selected={!year} onPress={() => setYear(null)} />
        {YEARS.map((y) => (
          <ConnectChip key={y} label={yearLabel(y)} selected={year === y} onPress={() => setYear(year === y ? null : y)} />
        ))}
      </View>
      <Text style={[FT.kicker, { marginTop: FS.lg, marginBottom: FS.sm }]}>Branch</Text>
      <TextInput
        style={fui.input}
        value={branch}
        onChangeText={(t) => setBranch(t.slice(0, 50))}
        placeholder="Any branch, or type one like ECE"
        placeholderTextColor={FriendsColors.faint}
        autoCapitalize="characters"
        accessibilityLabel="Branch filter"
      />
      <Text style={[FT.kicker, { marginTop: FS.lg, marginBottom: FS.sm }]}>Interests</Text>
      <TextInput
        style={fui.input}
        value={interests}
        onChangeText={(t) => setInterests(t.slice(0, 160))}
        placeholder="Up to 5, separated by commas"
        placeholderTextColor={FriendsColors.faint}
        accessibilityLabel="Interest filters, separated by commas"
      />
      <Text style={[FT.small, { marginTop: FS.md }]}>Connect never uses your location. Everyone you see is on your campus.</Text>
    </FriendsSheet>
  );
};

// ── It's a match ──────────────────────────────────────────────────────────────

const MatchMoment: React.FC<{
  match: { card: ConnectCard; matchId?: string; conversationId?: string } | null;
  onClose: () => void;
  onMessage: () => void;
  onView: () => void;
}> = ({ match, onClose, onMessage, onView }) => (
  <Modal visible={!!match} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.matchOverlay}>
      <LinearGradient colors={['#18181B', '#18181B']} style={styles.matchCard}>
        {match ? (
          <>
            <ConnectHeart size={30} />
            <Text style={styles.matchTitle} accessibilityRole="header">
              It's a match
            </Text>
            <Text style={[FT.muted, { textAlign: 'center' }]}>You and {match.card.displayName} liked each other.</Text>
            <ConnectPhotoView photo={match.card.photos[0] || null} name={match.card.displayName} style={styles.matchPhoto} radius={60} />
            <PrimaryButton label={`Message ${match.card.displayName}`} onPress={onMessage} icon={<MessageCircle size={18} color={FriendsColors.accentInk} />} style={{ alignSelf: 'stretch' }} />
            {match.matchId ? <GhostButton label="See today's Spark" onPress={onView} style={{ alignSelf: 'stretch' }} /> : null}
            <TouchableOpacity onPress={onClose} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Keep exploring">
              <Text style={[FT.h3, { color: FriendsColors.muted }]}>Keep exploring</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </LinearGradient>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: FS.md, paddingHorizontal: FS.lg, paddingTop: FS.md, paddingBottom: FS.md },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dotText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accentInk },
  actions: { position: 'absolute', left: 0, right: 0, bottom: FS.lg, flexDirection: 'row', justifyContent: 'center', gap: FS.xxl },
  actionBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  passBtn: { backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.line },
  likeBtn: { backgroundColor: FriendsColors.accent, shadowColor: '#000', shadowOpacity: 0.3 },
  stamp: { position: 'absolute', top: 36, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 2 },
  stampLike: { left: 20, borderColor: FriendsColors.accent, transform: [{ rotate: '-12deg' }] },
  stampPass: { right: 20, borderColor: FriendsColors.muted, transform: [{ rotate: '12deg' }] },
  stampText: { fontSize: 22, fontWeight: '900', letterSpacing: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: FS.sm },
  matchOverlay: { flex: 1, backgroundColor: FriendsColors.overlay, justifyContent: 'center', padding: FS.xl },
  matchCard: { borderRadius: FR.hero, padding: FS.xl, alignItems: 'center', gap: FS.md, borderWidth: 1, borderColor: 'rgba(212,175,122,0.3)', backgroundColor: FriendsColors.card },
  matchTitle: { fontSize: 30, fontWeight: '800', color: FriendsColors.ink, letterSpacing: -0.5 },
  matchPhoto: { width: 120, height: 120, marginVertical: FS.sm, borderWidth: 2, borderColor: FriendsColors.accent },
});
