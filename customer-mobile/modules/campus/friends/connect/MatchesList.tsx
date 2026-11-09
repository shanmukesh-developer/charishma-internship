import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { ChevronRight, HeartHandshake } from '../../../../components/lucide';
import { FriendsColors, FS, FT, SectionTints } from '../friendsTheme';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { formatRelative } from '../shared/RelativeTime';
import { isGateError } from '../api/core';
import { ConnectMatch, fetchConnectMatches, isUnavailableCard } from '../api/connectApi';
import { ConnectPhotoView } from './ConnectUi';
import { SparkCard } from './SparkCard';
import { connectBus, connectErrorMessage, isConnectGateError, matchName } from './connectShared';

import { themedSheet } from '../../../../utils/themeNow';
let matchesCache: { items: ConnectMatch[]; cursor: string | null } | null = null;
export const clearConnectMatchesCache = () => {
  matchesCache = null;
};

/** Active matches, newest first. Ended matches drop out (live via the socket and the bus). */
export const MatchesList: React.FC<{
  onOpenMatch: (m: ConnectMatch) => void;
  onGate: (e: any) => void;
  onDiscover: () => void;
  onCount?: (n: number) => void;
}> = ({ onOpenMatch, onGate, onDiscover, onCount }) => {
  const [items, setItems] = useState<ConnectMatch[]>(() => matchesCache?.items || []);
  const [cursor, setCursor] = useState<string | null>(() => matchesCache?.cursor || null);
  const [loading, setLoading] = useState(!matchesCache);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  const load = useCallback(
    async (mode: 'reset' | 'refresh' | 'more') => {
      if (mode === 'more' && (!cursor || more)) return;
      const my = ++req.current;
      if (mode === 'refresh') setRefreshing(true);
      if (mode === 'more') setMore(true);
      setError(null);
      try {
        const r = await fetchConnectMatches(mode === 'more' ? cursor : null);
        if (my !== req.current) return;
        setItems((prev) => {
          if (mode !== 'more') return r.items;
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...r.items.filter((m) => !seen.has(m.id))];
        });
        setCursor(r.nextCursor);
      } catch (e: any) {
        if (my !== req.current) return;
        if (isGateError(e) || isConnectGateError(e)) onGate(e);
        setError(connectErrorMessage(e, "Couldn't load your matches."));
      } finally {
        if (my === req.current) {
          setLoading(false);
          setRefreshing(false);
          setMore(false);
        }
      }
    },
    [cursor, more, onGate]
  );

  useEffect(() => {
    load(matchesCache ? 'refresh' : 'reset');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    matchesCache = { items, cursor };
    onCount?.(items.length);
  }, [items, cursor, onCount]);

  useEffect(
    () =>
      connectBus.on((e) => {
        if (e.type === 'ended' && e.matchId) setItems((prev) => prev.filter((m) => m.id !== e.matchId));
        if (e.type === 'match' || e.type === 'status') load('refresh');
      }),
    [load]
  );

  if (loading && !items.length) return <FriendsSkeleton rows={4} variant="row" />;

  return (
    <FlatList
      data={items}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ paddingBottom: 100, flexGrow: 1 }}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={FT.h2} accessibilityRole="header">
            Matches
          </Text>
          <Text style={FT.small}>People who liked you back. Only matches can message you.</Text>
        </View>
      }
      renderItem={({ item }) => <MatchRow match={item} onPress={() => onOpenMatch(item)} />}
      onEndReached={() => load('more')}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />
      }
      ListEmptyComponent={
        error ? (
          <FriendsError message={error} onRetry={() => load('reset')} />
        ) : (
          <FriendsEmpty
            tint={SectionTints.connect.fg}
          icon={<HeartHandshake size={26} color={SectionTints.connect.fg} />}
            title="No matches yet"
            subtitle="When someone you liked likes you back, they show up here and you can start chatting."
            actionLabel="Discover people"
            onAction={onDiscover}
          />
        )
      }
      ListFooterComponent={more ? <ActivityIndicator color={FriendsColors.accent} style={{ margin: FS.lg }} /> : null}
    />
  );
};

const MatchRow: React.FC<{ match: ConnectMatch; onPress: () => void }> = ({ match, onPress }) => {
  const name = matchName(match);
  const unavailable = isUnavailableCard(match.profile);
  const photo = match.profile.photos[0] || null;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${name}${unavailable ? ', profile unavailable' : ''}. Matched ${formatRelative(match.matchedAt)}. Open match.`}
    >
      <ConnectPhotoView photo={photo} name={name} style={styles.avatar} radius={28} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={FT.h3} numberOfLines={1}>
            {name}
            {!unavailable && (match.profile as any).age ? <Text style={{ fontWeight: '500', color: FriendsColors.muted }}>{`, ${(match.profile as any).age}`}</Text> : null}
          </Text>
          <Text style={[FT.small, { color: FriendsColors.faint }]}>{formatRelative(match.matchedAt)}</Text>
        </View>
        {unavailable ? <Text style={FT.small}>This profile isn't available right now.</Text> : <SparkCard spark={match.spark} compact />}
      </View>
      <ChevronRight size={18} color={FriendsColors.muted} />
    </TouchableOpacity>
  );
};

const styles = themedSheet(() => ({
  header: { paddingHorizontal: FS.lg, paddingTop: FS.md, paddingBottom: FS.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: FS.md, paddingHorizontal: FS.lg, paddingVertical: FS.md, minHeight: 76, borderBottomWidth: 1, borderBottomColor: FriendsColors.lineSoft },
  avatar: { width: 56, height: 56 },
}));
