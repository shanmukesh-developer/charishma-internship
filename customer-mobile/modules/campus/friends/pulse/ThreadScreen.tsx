import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { MessageCircle, Lock, ArrowUp } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR } from '../friendsTheme';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { identityLabel } from '../shared/IdentityChip';
import { errorCode, isGateError } from '../api/core';
import { PulsePost, fetchPulsePost, fetchPulseReplies } from '../api/pulseApi';
import { PostCard } from './PostCard';
import { PulseHeader, PulseSoftError } from './PulseUi';
import { usePulsePaged } from './usePulsePaged';
import { pulseBus, pulseCache, pulseErrorMessage } from './pulseShared';
import { usePulseNav } from './pulseNav';

import { themedSheet } from '../../../../utils/themeNow';
/**
 * One conversation: the thread it belongs to (root, parent), the post itself, then its direct
 * replies oldest first. Replying follows the root's reply setting (the server decides).
 */
export const ThreadScreen: React.FC<{ id: string; initial?: PulsePost | null }> = ({ id, initial }) => {
  const nav = usePulseNav();
  const cacheKey = `thread:${id}`;
  const cachedHead = pulseCache.get<{ post: PulsePost; parent: PulsePost | null; root: PulsePost | null }>(cacheKey);
  const [post, setPost] = useState<PulsePost | null>(cachedHead?.post || initial || null);
  const [parent, setParent] = useState<PulsePost | null>(cachedHead?.parent || null);
  const [root, setRoot] = useState<PulsePost | null>(cachedHead?.root || null);
  const [loading, setLoading] = useState(!post);
  const [error, setError] = useState<any>(null);
  const [gone, setGone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const listRef = useRef<FlatList<PulsePost>>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadHead = useCallback(async () => {
    try {
      const r = await fetchPulsePost(id);
      if (!mounted.current) return;
      if (!r.post) {
        setGone(true);
        return;
      }
      setPost(r.post);
      setParent(r.parent);
      setRoot(r.root);
      setError(null);
      pulseCache.set(cacheKey, r);
    } catch (e: any) {
      if (!mounted.current) return;
      if (isGateError(e)) nav.onGateError(e);
      if (errorCode(e) === 'POST_NOT_FOUND' || e?.status === 404) setGone(true);
      else setError(e);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [id, cacheKey, nav]);

  const replies = usePulsePaged<PulsePost>(
    gone ? null : `replies:${id}`,
    (cursor) => fetchPulseReplies(id, cursor),
    (p) => p.id,
    { onError: nav.onGateError }
  );
  const { update } = replies;
  const replyItems = useRef<PulsePost[]>(replies.items);
  replyItems.current = replies.items;

  useEffect(() => {
    loadHead();
  }, [loadHead]);

  // Live: edits / likes elsewhere, my new replies here, deletions and blocks.
  useEffect(() => {
    const patch = (p: PulsePost) => {
      setPost((cur) => (cur && cur.id === p.id ? p : cur));
      setParent((cur) => (cur && cur.id === p.id ? p : cur));
      setRoot((cur) => (cur && cur.id === p.id ? p : cur));
      update((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : prev));
    };
    const a = pulseBus.onPost(patch);
    const b = pulseBus.onCreated((p) => {
      if (p.parentId !== id) return;
      update((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
      setPost((cur) => (cur ? { ...cur, replyCount: cur.replyCount + (p.status === 'visible' ? 1 : 0) } : cur));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 300);
    });
    const c = pulseBus.onRemoved((rid) => {
      if (rid === id) {
        setGone(true);
        return;
      }
      if (!replyItems.current.some((x) => x.id === rid)) return;
      update((prev) => prev.filter((x) => x.id !== rid));
      setPost((cur) => (cur ? { ...cur, replyCount: Math.max(0, cur.replyCount - 1) } : cur));
    });
    const d = pulseBus.onBlocked((uid) => {
      update((prev) => prev.filter((x) => (x.author as any)?.anonymous || (x.author as any)?.userId !== uid));
      if (post && !(post.author as any)?.anonymous && (post.author as any)?.userId === uid) setGone(true);
    });
    return () => {
      a();
      b();
      c();
      d();
    };
  }, [id, update, nav, post]);

  const refresh = async () => {
    setRefreshing(true);
    await loadHead();
    replies.refresh();
    if (mounted.current) setRefreshing(false);
  };

  const header = post ? (
    <View style={{ gap: FS.md, paddingTop: FS.md }}>
      {root && root.id !== parent?.id ? (
        <TouchableOpacity onPress={() => nav.push({ name: 'thread', id: root.id, post: root })} style={styles.context} accessibilityRole="button" accessibilityLabel={`Open the original post by ${identityLabel(root.author)}`}>
          <ArrowUp size={14} color={FriendsColors.muted} />
          <Text style={[FT.small, { flex: 1 }]} numberOfLines={2}>
            Original post by {identityLabel(root.author)}: {root.text || 'Photo'}
          </Text>
        </TouchableOpacity>
      ) : null}
      {post.replyTo && !parent ? (
        <View style={styles.context}>
          <ArrowUp size={14} color={FriendsColors.faint} />
          <Text style={[FT.small, { flex: 1 }]}>Replying to a post that is no longer available.</Text>
        </View>
      ) : null}
      {parent ? (
        <View style={styles.parentWrap}>
          <PostCard post={parent} onChanged={(p) => setParent(p)} onRemoved={() => setParent(null)} showReplyContext={false} />
          <View style={styles.connector} />
        </View>
      ) : null}
      <View style={styles.focus}>
        {/* Deleted / blocked from this screen: go back. From elsewhere, the bus marks it gone instead. */}
        <PostCard post={post} onChanged={setPost} onRemoved={() => nav.back()} showReplyContext={!parent} disableOpen />
      </View>
      <View style={styles.repliesHead}>
        <MessageCircle size={14} color={FriendsColors.muted} />
        <Text style={FT.kicker}>
          {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
        </Text>
      </View>
    </View>
  ) : null;

  if (gone) {
    return (
      <View style={styles.root}>
        <PulseHeader title="Post" onBack={nav.back} />
        <FriendsEmpty title="This post isn't available" subtitle="It was deleted, removed by moderators, or you can't see it." actionLabel="Go back" onAction={nav.back} />
      </View>
    );
  }

  const canReply = !!post?.canReply;
  const replyBlockedText =
    post && !canReply
      ? post.status !== 'visible'
        ? 'Replies are closed on this post.'
        : post.replyPolicy === 'none'
        ? 'The author turned off replies.'
        : post.replyPolicy === 'following'
        ? 'Only people the author follows can reply.'
        : 'Replies are closed.'
      : null;

  return (
    <View style={styles.root}>
      <PulseHeader title={post?.kind === 'reply' ? 'Reply' : 'Post'} subtitle={post ? `by ${identityLabel(post.author)}` : null} onBack={nav.back} />
      {loading && !post ? (
        <FriendsSkeleton rows={2} />
      ) : error && !post ? (
        <FriendsError message={pulseErrorMessage(error, "Couldn't load this post.")} onRetry={() => {
          setLoading(true);
          loadHead();
        }} />
      ) : (
        <FlatList
          ref={listRef}
          data={replies.loading || replies.error ? [] : replies.items}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onChanged={(p) => update((prev) => prev.map((x) => (x.id === p.id ? p : x)))}
              onRemoved={(rid) => update((prev) => prev.filter((x) => x.id !== rid))}
              showReplyContext={false}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: FS.sm }} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: FS.lg, paddingBottom: 120 }}
          ListEmptyComponent={
            replies.loading ? (
              <FriendsSkeleton rows={2} variant="row" flush />
            ) : replies.error ? (
              <FriendsError compact message={pulseErrorMessage(replies.error, "Couldn't load replies.")} onRetry={replies.reload} />
            ) : (
              <Text style={[FT.muted, { textAlign: 'center', marginVertical: FS.xl }]}>{canReply ? 'No replies yet. Start the conversation.' : 'No replies yet.'}</Text>
            )
          }
          ListFooterComponent={
            replies.softError ? (
              <PulseSoftError error={replies.softError} onRetry={replies.hasMore ? replies.loadMore : replies.refresh} />
            ) : replies.loadingMore ? (
              <ActivityIndicator color={FriendsColors.accent} style={{ marginVertical: FS.lg }} />
            ) : null
          }
          onEndReached={replies.loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />}
          keyboardShouldPersistTaps="handled"
        />
      )}
      {post ? (
        <View style={styles.replyBar}>
          {canReply ? (
            <TouchableOpacity style={styles.replyInput} onPress={() => nav.openComposer({ replyTo: post })} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`Reply to ${identityLabel(post.author)}`}>
              <MessageCircle size={16} color={FriendsColors.muted} />
              <Text style={[FT.muted, { flex: 1 }]}>Reply to {identityLabel(post.author)}…</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.replyInput} accessible accessibilityLabel={replyBlockedText || ''}>
              <Lock size={14} color={FriendsColors.faint} />
              <Text style={[FT.small, { flex: 1 }]}>{replyBlockedText}</Text>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
};

const styles = themedSheet(() => ({
  root: { flex: 1, backgroundColor: FriendsColors.bg },
  context: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.card, minHeight: 44 },
  parentWrap: { opacity: 0.92 },
  connector: { width: 2, height: FS.md, backgroundColor: FriendsColors.line, marginLeft: 30, marginBottom: -FS.md },
  focus: { borderRadius: FR.card + 2, borderWidth: 1, borderColor: 'rgba(212,175,122,0.35)' },
  repliesHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: FS.sm, marginBottom: FS.sm },
  replyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: FS.lg,
    paddingTop: FS.sm,
    paddingBottom: FS.md,
    backgroundColor: FriendsColors.bg,
    borderTopWidth: 1,
    borderTopColor: FriendsColors.line,
  },
  replyInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    minHeight: 48,
    paddingHorizontal: FS.lg,
    borderRadius: FR.pill,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
}));
