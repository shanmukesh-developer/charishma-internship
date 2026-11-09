import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator, StyleSheet, ListRenderItem } from 'react-native';
import { ChevronLeft, RotateCcw } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR } from '../friendsTheme';
import { FriendsHeader } from '../shared/FriendsUi';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsError } from '../shared/FriendsEmpty';
import type { PulseFeedItem, PulsePost, PulseSpaceCard } from '../api/pulseApi';
import { PostCard } from './PostCard';
import { SpaceCard } from './SpaceCard';
import { dropBlocked, dropFromFeed, itemKey, patchFeed, pulseBus, pulseErrorMessage } from './pulseShared';

import { themedSheet } from '../../../../utils/themeNow';
/** Header for screens inside the Pulse stack (back arrow, title, optional right slot). */
export const PulseHeader: React.FC<{ title: string; subtitle?: string | null; onBack: () => void; right?: React.ReactNode }> = (props) => (
  <FriendsHeader {...props} section="pulse" />
);

/** Inline "couldn't load more / refresh" row with Retry (the list stays on screen). */
export const PulseSoftError: React.FC<{ error: any; onRetry: () => void }> = ({ error, onRetry }) => (
  <TouchableOpacity style={styles.soft} onPress={onRetry} accessibilityRole="button" accessibilityLabel={`${pulseErrorMessage(error)} Retry`}>
    <RotateCcw size={14} color={FriendsColors.warn} />
    <Text style={styles.softText} numberOfLines={2}>
      {pulseErrorMessage(error, "Couldn't refresh.")} Tap to retry.
    </Text>
  </TouchableOpacity>
);

export interface FeedPaged<T extends PulseFeedItem> {
  items: T[];
  update: (fn: (prev: T[]) => T[]) => void;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: any;
  softError: any;
  hasMore: boolean;
  refresh: () => void;
  reload: () => void;
  loadMore: () => void;
}

/**
 * Feed of posts, reposts and Space cards with every state: skeleton, error + retry, empty,
 * pull to refresh, load-more spinner and inline error. Listens to the Pulse bus so a like, edit,
 * delete or block anywhere shows up here.
 */
export function PulseFeedList<T extends PulseFeedItem>({
  paged,
  header,
  empty,
  keepRemoved,
  showReplyContext = true,
  listRef,
}: {
  paged: FeedPaged<T>;
  header?: React.ReactElement | null;
  empty: React.ReactElement;
  /** Keep posts that are no longer visible (My posts shows removed ones with the reason). */
  keepRemoved?: boolean;
  showReplyContext?: boolean;
  listRef?: React.RefObject<FlatList<T> | null>;
}) {
  const { update } = paged;

  useEffect(() => {
    const a = pulseBus.onPost((p) => update((prev) => patchFeed(prev, p)));
    const b = pulseBus.onRemoved((id) => update((prev) => (keepRemoved ? prev : dropFromFeed(prev, id))));
    const c = pulseBus.onBlocked((uid) => update((prev) => dropBlocked(prev, uid)));
    return () => {
      a();
      b();
      c();
    };
  }, [update, keepRemoved]);

  const onChanged = (p: PulsePost) => update((prev) => patchFeed(prev, p));
  const onRemoved = (id: string) => update((prev) => (keepRemoved ? prev : dropFromFeed(prev, id)));

  const renderItem: ListRenderItem<T> = ({ item }) => {
    if (item.kind === 'space_card') {
      return (
        <SpaceCard
          card={item as PulseSpaceCard}
          onChanged={(c) => update((prev) => prev.map((x) => (x.kind === 'space_card' && x.id === c.id ? (c as T) : x)))}
        />
      );
    }
    if (item.kind === 'repost') {
      return <PostCard post={item.post} repost={item} onChanged={onChanged} onRemoved={onRemoved} showReplyContext={showReplyContext} />;
    }
    return <PostCard post={item as PulsePost} onChanged={onChanged} onRemoved={onRemoved} showReplyContext={showReplyContext} />;
  };

  return (
    <FlatList
      ref={listRef as any}
      data={paged.loading || paged.error ? [] : paged.items}
      keyExtractor={itemKey}
      renderItem={renderItem}
      ItemSeparatorComponent={Separator}
      contentContainerStyle={{ paddingHorizontal: FS.lg, paddingBottom: 140 }}
      ListHeaderComponent={header || null}
      ListEmptyComponent={
        paged.loading ? (
          <FriendsSkeleton rows={3} flush />
        ) : paged.error ? (
          <FriendsError message={pulseErrorMessage(paged.error, "Couldn't load posts.")} onRetry={paged.reload} />
        ) : (
          empty
        )
      }
      ListFooterComponent={
        paged.softError ? (
          <PulseSoftError error={paged.softError} onRetry={paged.hasMore ? paged.loadMore : paged.refresh} />
        ) : paged.loadingMore ? (
          <ActivityIndicator color={FriendsColors.accent} style={{ marginVertical: FS.lg }} accessibilityLabel="Loading more" />
        ) : !paged.hasMore && paged.items.length > 4 ? (
          <Text style={[FT.small, { textAlign: 'center', marginTop: FS.lg }]}>You're all caught up.</Text>
        ) : null
      }
      onEndReached={paged.loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={paged.refreshing}
          onRefresh={paged.refresh}
          tintColor={FriendsColors.accent}
          colors={[FriendsColors.accent]}
          progressBackgroundColor={FriendsColors.card}
        />
      }
      keyboardShouldPersistTaps="handled"
      initialNumToRender={6}
      windowSize={9}
    />
  );
}

const Separator = () => <View style={{ height: FS.md }} />;

const styles = themedSheet(() => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.xs,
    paddingHorizontal: FS.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: FriendsColors.line,
    backgroundColor: FriendsColors.bg,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  soft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: FS.md,
    padding: FS.md,
    borderRadius: FR.md,
    backgroundColor: FriendsColors.warnSoft,
    minHeight: 44,
  },
  softText: { flex: 1, fontSize: 12, fontWeight: '600', color: FriendsColors.warn },
}));
