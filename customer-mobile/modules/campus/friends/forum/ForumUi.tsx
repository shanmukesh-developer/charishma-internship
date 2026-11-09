import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList, RefreshControl, ActivityIndicator, StyleSheet, ListRenderItem } from 'react-native';
import { ChevronLeft, RotateCcw } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui, SectionTints } from '../friendsTheme';
import { FriendsHeader } from '../shared/FriendsUi';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsError } from '../shared/FriendsEmpty';
import type { ForumPost } from '../api/forumApi';
import { ForumPostCard } from './ForumPostCard';
import { forumBus, forumErrorMessage, patchPostList } from './forumShared';

import { themedSheet } from '../../../../utils/themeNow';
/** Header for screens inside the Forum stack (back arrow, title, optional right slot). */
export const ForumHeader: React.FC<{ title: string; subtitle?: string | null; onBack: () => void; right?: React.ReactNode }> = (props) => (
  <FriendsHeader {...props} section="forum" />
);

/** Horizontal single-select chips (sort, type, kind filters). */
export function Chips<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: K; label: string; icon?: React.ReactNode }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[fui.pill, on && { backgroundColor: SectionTints.forum.soft, borderColor: SectionTints.forum.line }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label}: ${o.label}`}
          >
            {o.icon}
            <Text style={[fui.pillText, on && { color: SectionTints.forum.fg }]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/** Inline "couldn't load more / refresh" row with Retry (list stays on screen). */
export const SoftError: React.FC<{ error: any; onRetry: () => void }> = ({ error, onRetry }) => (
  <TouchableOpacity style={styles.soft} onPress={onRetry} accessibilityRole="button" accessibilityLabel={`${forumErrorMessage(error)} Retry`}>
    <RotateCcw size={14} color={FriendsColors.warn} />
    <Text style={styles.softText} numberOfLines={2}>
      {forumErrorMessage(error, "Couldn't refresh.")} Tap to retry.
    </Text>
  </TouchableOpacity>
);

/**
 * List of post cards with every state: skeleton, error + retry, empty, pull-to-refresh,
 * load-more spinner, inline error. Listens to the Forum bus so edits elsewhere show up here.
 */
export const PostList: React.FC<{
  paged: {
    items: ForumPost[];
    update: (fn: (prev: ForumPost[]) => ForumPost[]) => void;
    loading: boolean;
    refreshing: boolean;
    loadingMore: boolean;
    error: any;
    softError: any;
    hasMore: boolean;
    refresh: () => void;
    reload: () => void;
    loadMore: () => void;
  };
  header?: React.ReactElement | null;
  empty: React.ReactElement;
  showCommunity?: boolean;
  /** Keep items that are no longer visible (e.g. "My posts" shows removed ones). */
  keepRemoved?: boolean;
}> = ({ paged, header, empty, showCommunity, keepRemoved }) => {
  const { update } = paged;

  useEffect(() => {
    const a = forumBus.onPost((p) => update((prev) => patchPostList(prev, p)));
    const b = forumBus.onRemoved((id) => {
      if (!keepRemoved) update((prev) => prev.filter((p) => p.id !== id));
    });
    const c = forumBus.onBlocked((uid) => update((prev) => prev.filter((p) => (p.author as any)?.anonymous || (p.author as any)?.userId !== uid)));
    return () => {
      a();
      b();
      c();
    };
  }, [update, keepRemoved]);

  const renderItem: ListRenderItem<ForumPost> = ({ item }) => (
    <ForumPostCard
      post={item}
      showCommunity={showCommunity}
      onChanged={(p) => update((prev) => patchPostList(prev, p))}
      onRemoved={(id) => update((prev) => prev.filter((x) => x.id !== id))}
    />
  );

  return (
    <FlatList
      data={paged.loading || paged.error ? [] : paged.items}
      keyExtractor={(p) => p.id}
      renderItem={renderItem}
      ItemSeparatorComponent={() => <View style={{ height: FS.md }} />}
      contentContainerStyle={{ padding: FS.lg, paddingBottom: 120 }}
      ListHeaderComponent={header || null}
      ListEmptyComponent={
        paged.loading ? (
          <FriendsSkeleton rows={3} flush />
        ) : paged.error ? (
          <FriendsError message={forumErrorMessage(paged.error, "Couldn't load posts.")} onRetry={paged.reload} />
        ) : (
          empty
        )
      }
      ListFooterComponent={
        paged.softError ? (
          <SoftError error={paged.softError} onRetry={paged.hasMore ? paged.loadMore : paged.refresh} />
        ) : paged.loadingMore ? (
          <ActivityIndicator color={FriendsColors.accent} style={{ marginVertical: FS.lg }} />
        ) : !paged.hasMore && paged.items.length > 4 ? (
          <Text style={[FT.small, { textAlign: 'center', marginTop: FS.lg }]}>You're all caught up.</Text>
        ) : null
      }
      onEndReached={paged.loadMore}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={paged.refreshing} onRefresh={paged.refresh} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews
      initialNumToRender={6}
      windowSize={9}
    />
  );
};

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
  chips: { gap: FS.sm, paddingVertical: 2 },
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
