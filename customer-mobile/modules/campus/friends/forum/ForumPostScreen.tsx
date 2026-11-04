import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Linking,
  Platform,
  ListRenderItem,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../../components/KeyboardAvoidingView';
import { Image } from 'expo-image';
import { Ellipsis, Send, X, Lock, Link2, Bookmark, BookmarkCheck, MessageCircle, VenetianMask, Hourglass, EyeOff, Share2 } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { Share } from 'react-native';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { IdentityChip } from '../shared/IdentityChip';
import { FriendsError } from '../shared/FriendsEmpty';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsSheet } from '../shared/FriendsSheet';
import { newClientId } from '../api/core';
import {
  ForumPost,
  ForumComment,
  ForumCommentSort,
  FORUM_LIMITS,
  bookmarkForumPost,
  clearBestAnswer,
  createForumComment,
  fetchForumComments,
  fetchForumPost,
  setBestAnswer,
  updateForumComment,
} from '../api/forumApi';
import { useForumNav } from './forumNav';
import { Chips, ForumHeader, SoftError } from './ForumUi';
import { PostFlags, PostMenu } from './ForumPostCard';
import { VoteControl } from './VoteControl';
import { BadgePills } from './KarmaBadges';
import { CommentItem } from './CommentItem';
import { ReviewBlock } from './ReviewParts';
import { blockedDetails, compactCount, forumBus, forumCache, forumErrorMessage, forumPostLink } from './forumShared';
import { useCampusOffline } from '../shared/OfflineBanner';

const COMMENT_SORTS: { key: ForumCommentSort; label: string }[] = [
  { key: 'best', label: 'Best' },
  { key: 'new', label: 'Newest' },
  { key: 'old', label: 'Oldest' },
];

type Node = { comment: ForumComment; replyCount: number };

/** Flatten top-level comments + their replies into display order, skipping collapsed subtrees. */
const buildTree = (top: ForumComment[], replies: ForumComment[], collapsed: Set<string>): Node[] => {
  const children = new Map<string, ForumComment[]>();
  replies.forEach((r) => {
    if (!r.parentId) return;
    const list = children.get(r.parentId) || [];
    list.push(r);
    children.set(r.parentId, list);
  });
  const count = (id: string): number => (children.get(id) || []).reduce((n, c) => n + 1 + count(c.id), 0);
  const out: Node[] = [];
  const walk = (c: ForumComment) => {
    out.push({ comment: c, replyCount: count(c.id) });
    if (collapsed.has(c.id)) return;
    (children.get(c.id) || []).forEach(walk);
  };
  top.forEach(walk);
  return out;
};

export const ForumPostScreen: React.FC<{ id: string; initial?: ForumPost | null }> = ({ id, initial }) => {
  const nav = useForumNav();
  const offline = useCampusOffline();
  const [post, setPost] = useState<ForumPost | null>(forumCache.get<ForumPost>(`post:${id}`) || initial || null);
  const [postError, setPostError] = useState<any>(null);
  const [sort, setSort] = useState<ForumCommentSort>('best');
  const [top, setTop] = useState<ForumComment[]>([]);
  const [replies, setReplies] = useState<ForumComment[]>([]);
  const [bestId, setBestId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cLoading, setCLoading] = useState(true);
  const [cError, setCError] = useState<any>(null);
  const [cSoft, setCSoft] = useState<any>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [gone, setGone] = useState(false);

  // Composer
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ForumComment | null>(null);
  const [anon, setAnon] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const draftId = useRef<string>(newClientId());
  const inputRef = useRef<TextInput>(null);

  // Edit comment
  const [editing, setEditing] = useState<ForumComment | null>(null);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const gen = useRef(0);
  const topRef = useRef<ForumComment[]>([]);
  topRef.current = top;
  const community = nav.communities.find((c) => c.id === post?.communityId) || null;
  const allowAnon = community ? community.allowAnonymous : true;

  const loadPost = useCallback(async () => {
    try {
      const p = await fetchForumPost(id);
      setPost(p);
      setBestId(p.bestCommentId);
      setPostError(null);
      forumCache.set(`post:${id}`, p);
      forumBus.emitPost(p);
    } catch (e: any) {
      nav.onGateError(e);
      if (e?.status === 404) {
        setGone(true);
        forumBus.emitRemoved(id);
      }
      setPostError(e);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadComments = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      const my = ++gen.current;
      if (mode === 'initial') setCLoading(true);
      setCSoft(null);
      try {
        const r = await fetchForumComments(id, { sort });
        if (my !== gen.current) return;
        setTop(r.items);
        setReplies(r.replies);
        setBestId(r.bestCommentId);
        setCursor(r.nextCursor);
        setCError(null);
      } catch (e: any) {
        if (my !== gen.current) return;
        nav.onGateError(e);
        if (topRef.current.length) setCSoft(e);
        else setCError(e);
      } finally {
        if (my === gen.current) setCLoading(false);
      }
    },
    [id, sort] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    loadPost();
  }, [loadPost]);
  useEffect(() => {
    loadComments('initial');
  }, [loadComments]);

  // Votes / bookmarks / moderation on this post from elsewhere.
  useEffect(() => forumBus.onPost((p) => p.id === id && setPost((prev) => (prev ? { ...prev, ...p, body: p.bodyTruncated ? prev.body : p.body, bodyTruncated: false } : p))), [id]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const my = gen.current;
    setLoadingMore(true);
    try {
      const r = await fetchForumComments(id, { sort, cursor });
      if (my !== gen.current) return;
      setTop((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...r.items.filter((c) => !seen.has(c.id))];
      });
      setReplies((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...r.replies.filter((c) => !seen.has(c.id))];
      });
      setCursor(r.nextCursor);
      setCSoft(null);
    } catch (e: any) {
      setCSoft(e);
    } finally {
      setLoadingMore(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadPost(), loadComments('refresh')]);
    setRefreshing(false);
  };

  const nodes = useMemo(() => buildTree(top, replies, collapsed), [top, replies, collapsed]);

  const author: any = post?.author;
  const postMine = !!(post && (post.canEdit || (author && (author.isMine || (!author.anonymous && author.userId === nav.me)))));
  const canPickBest = !!post && post.type === 'question' && post.status === 'visible' && (postMine || post.canModerate);
  const open = !!post && post.status === 'visible' && !post.isLocked;

  const patchComment = (c: ForumComment) => {
    setTop((prev) => prev.map((x) => (x.id === c.id ? c : x)));
    setReplies((prev) => prev.map((x) => (x.id === c.id ? c : x)));
  };

  const pickBest = async (c: ForumComment, on: boolean) => {
    if (!post) return;
    const prev = bestId;
    setBestId(on ? c.id : null);
    try {
      if (on) await setBestAnswer(post.id, c.id);
      else await clearBestAnswer(post.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const next = { ...post, bestCommentId: on ? c.id : null };
      setPost(next);
      forumBus.emitPost(next);
      nav.bumpStanding();
      loadComments('refresh');
    } catch (e: any) {
      setBestId(prev);
      nav.onGateError(e);
      Alert.alert("Couldn't update the best answer", forumErrorMessage(e));
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!post || !body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await createForumComment(post.id, { body, parentId: replyTo?.id || null, anonymous: allowAnon ? anon : false, clientId: draftId.current });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      draftId.current = newClientId();
      setText('');
      setReplyTo(null);
      if (r.comment.parentId) {
        setReplies((prev) => (prev.some((x) => x.id === r.comment.id) ? prev : [...prev, r.comment]));
        setCollapsed((prev) => {
          const n = new Set(prev);
          n.delete(r.comment.parentId as string);
          return n;
        });
      } else {
        setTop((prev) => (prev.some((x) => x.id === r.comment.id) ? prev : sort === 'old' ? [...prev, r.comment] : [r.comment, ...prev]));
      }
      const next = { ...post, commentCount: post.commentCount + (r.duplicate ? 0 : 1) };
      setPost(next);
      forumBus.emitPost(next);
      if (r.underReview) Alert.alert('Sent for review', 'Your comment will appear once a moderator has checked it.');
    } catch (e: any) {
      nav.onGateError(e);
      setSendError(blockedDetails(e) || forumErrorMessage(e, "Couldn't post your comment."));
      if (e?.status === 423) setPost((p) => (p ? { ...p, isLocked: true } : p));
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || editBusy) return;
    const body = editText.trim();
    if (!body) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const r = await updateForumComment(editing.id, body);
      patchComment(r.comment);
      setEditing(null);
      if (r.underReview) Alert.alert('Sent for review', 'Your edit will be visible once a moderator has checked it.');
    } catch (e: any) {
      setEditError(blockedDetails(e) || forumErrorMessage(e, "Couldn't save."));
    } finally {
      setEditBusy(false);
    }
  };

  const toggleSave = async () => {
    if (!post) return;
    const next = { ...post, bookmarked: !post.bookmarked };
    setPost(next);
    try {
      await bookmarkForumPost(post.id, next.bookmarked);
      forumBus.emitPost(next);
      Haptics.selectionAsync().catch(() => {});
    } catch (e: any) {
      setPost(post);
      Alert.alert("Couldn't save", forumErrorMessage(e));
    }
  };

  const openLink = (url: string, host: string) =>
    Alert.alert('Open link?', `This opens ${host} outside ZENV.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open', onPress: () => Linking.openURL(url).catch(() => Alert.alert("Couldn't open the link")) },
    ]);

  if (gone || (!post && postError)) {
    return (
      <View style={fui.screen}>
        <ForumHeader title="Post" onBack={nav.back} />
        {gone ? (
          <FriendsError message="This post was deleted, removed, or is no longer available to you." />
        ) : (
          <FriendsError message={forumErrorMessage(postError, "Couldn't load this post.")} onRetry={loadPost} />
        )}
      </View>
    );
  }

  if (!post) {
    return (
      <View style={fui.screen}>
        <ForumHeader title="Post" onBack={nav.back} />
        <FriendsSkeleton rows={2} />
      </View>
    );
  }

  const removed = post.status === 'removed' || post.status === 'hidden';

  const header = (
    <View>
      <View style={styles.postCard}>
        <IdentityChip identity={post.author} time={post.createdAt} onPress={nav.openUser} />
        {author && !author.anonymous ? <BadgePills codes={author.badges} /> : null}
        <View style={{ marginTop: FS.md }}>
          <PostFlags post={post} />
        </View>
        <Text style={[FT.h1, { marginTop: FS.sm }]} accessibilityRole="header" selectable>
          {post.title}
        </Text>
        {post.editedAt ? <Text style={[FT.small, { marginTop: 2 }]}>Edited</Text> : null}

        {post.underReview ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Hourglass size={14} color={FriendsColors.warn} />
            <Text style={[FT.small, { color: FriendsColors.warn, flex: 1 }]}>
              Under review. Only you{post.canModerate ? ' and the moderators' : ''} can see this until it is checked.
            </Text>
          </View>
        ) : null}
        {removed ? (
          <View style={[styles.notice, { backgroundColor: FriendsColors.dangerSoft }]} accessibilityRole="alert">
            <EyeOff size={14} color={FriendsColors.danger} />
            <Text style={[FT.small, { color: FriendsColors.danger, flex: 1 }]}>
              Removed by a moderator{post.removedReason ? `: ${post.removedReason}` : '.'}
              {postMine ? ' You can appeal in Me › Friends privacy & safety.' : ''}
            </Text>
          </View>
        ) : null}

        {post.review ? (
          <ReviewBlock
            review={post.review}
            onOpenTarget={() => nav.push({ name: 'target', id: post.review!.targetId })}
            onChanged={(rv) => {
              const next = { ...post, review: rv };
              setPost(next);
              forumBus.emitPost(next);
            }}
          />
        ) : null}

        {post.body ? (
          <Text style={[FT.body, { marginTop: FS.md, fontSize: 15, lineHeight: 22 }]} selectable>
            {post.body}
          </Text>
        ) : null}

        {post.media.map((m, i) => (
          <Image key={m.mediaId} source={{ uri: m.url }} style={styles.image} contentFit="cover" accessibilityLabel={`Photo ${i + 1} of ${post.media.length}`} />
        ))}

        {post.links.length ? (
          <View style={{ gap: FS.sm, marginTop: FS.md }}>
            {post.links.map((l) => (
              <TouchableOpacity key={l.url} style={styles.link} onPress={() => openLink(l.url, l.host)} accessibilityRole="link" accessibilityLabel={`Link to ${l.host}`}>
                <Link2 size={14} color={FriendsColors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={[FT.h3, { fontSize: 13 }]} numberOfLines={1}>
                    {l.host}
                  </Text>
                  <Text style={FT.small} numberOfLines={1}>
                    {l.url}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          <VoteControl
            targetType="forum_post"
            targetId={post.id}
            value={{ up: post.up, down: post.down, score: post.score, myVote: post.myVote }}
            disabled={postMine || post.status !== 'visible'}
            disabledReason={postMine ? "You can't vote on your own post" : 'Voting is closed on this post'}
            onGateError={nav.onGateError}
            onChange={(v) => {
              const next = { ...post, ...v };
              setPost(next);
              forumBus.emitPost(next);
            }}
          />
          <View style={styles.actionBtn} accessible accessibilityLabel={`${post.commentCount} comments`}>
            <MessageCircle size={18} color={FriendsColors.muted} />
            <Text style={styles.actionText}>{compactCount(post.commentCount)}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => Share.share({ message: `${post.title}\n${forumPostLink(post.id)}` }).catch(() => {})}
            accessibilityRole="button"
            accessibilityLabel="Share post"
          >
            <Share2 size={18} color={FriendsColors.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={toggleSave}
            accessibilityRole="button"
            accessibilityLabel={post.bookmarked ? 'Remove from saved' : 'Save post'}
            accessibilityState={{ selected: post.bookmarked }}
          >
            {post.bookmarked ? <BookmarkCheck size={19} color={FriendsColors.accent} /> : <Bookmark size={19} color={FriendsColors.muted} />}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.commentsHead}>
        <Text style={FT.kicker}>{post.type === 'question' ? 'Answers' : 'Comments'}</Text>
        <Chips label="Sort comments" options={COMMENT_SORTS} value={sort} onChange={setSort} />
      </View>
      {post.isLocked ? (
        <View style={styles.notice}>
          <Lock size={14} color={FriendsColors.muted} />
          <Text style={[FT.small, { flex: 1 }]}>Comments are locked by a moderator.</Text>
        </View>
      ) : null}
    </View>
  );

  const renderItem: ListRenderItem<Node> = ({ item }) => (
    <CommentItem
      comment={item.comment}
      isBest={item.comment.id === bestId}
      replyCount={item.replyCount}
      collapsed={collapsed.has(item.comment.id)}
      onToggleCollapse={() =>
        setCollapsed((prev) => {
          const n = new Set(prev);
          if (n.has(item.comment.id)) n.delete(item.comment.id);
          else n.add(item.comment.id);
          return n;
        })
      }
      canPickBest={canPickBest}
      onPickBest={pickBest}
      canReply={open}
      onReply={(c) => {
        setReplyTo(c);
        setTimeout(() => inputRef.current?.focus(), 50);
      }}
      onEdit={(c) => {
        setEditing(c);
        setEditText(c.body || '');
        setEditError(null);
      }}
      onChanged={patchComment}
      onReload={() => loadComments('refresh')}
      canModerate={post.canModerate}
    />
  );

  return (
    <KeyboardAvoidingView style={fui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}>
      <ForumHeader
        title={post.community?.name || 'Post'}
        subtitle={post.type === 'question' ? 'Question' : undefined}
        onBack={nav.back}
        right={
          <TouchableOpacity onPress={() => setMenu(true)} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Post options">
            <Ellipsis size={20} color={FriendsColors.ink} />
          </TouchableOpacity>
        }
      />
      <FlatList
        data={cLoading || cError ? [] : nodes}
        keyExtractor={(n) => n.comment.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: FS.sm }} />}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: FS.lg, paddingBottom: FS.xxxl }}
        ListEmptyComponent={
          cLoading ? (
            <FriendsSkeleton rows={2} variant="row" />
          ) : cError ? (
            <FriendsError compact message={forumErrorMessage(cError, "Couldn't load comments.")} onRetry={() => loadComments('initial')} />
          ) : (
            <View style={styles.emptyComments}>
              <Text style={FT.h3}>{post.type === 'question' ? 'No answers yet' : 'No comments yet'}</Text>
              <Text style={[FT.small, { marginTop: 4, textAlign: 'center' }]}>
                {open ? (post.type === 'question' ? 'Know the answer? Help a fellow student out.' : 'Be the first to reply.') : 'Comments are closed.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          cSoft ? (
            <SoftError error={cSoft} onRetry={cursor ? loadMore : () => loadComments('refresh')} />
          ) : loadingMore ? (
            <ActivityIndicator color={FriendsColors.accent} style={{ marginVertical: FS.lg }} />
          ) : cursor ? (
            <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md }]} onPress={loadMore} accessibilityRole="button">
              <Text style={fui.ghostBtnText}>Load more comments</Text>
            </TouchableOpacity>
          ) : null
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />}
        keyboardShouldPersistTaps="handled"
      />

      {open ? (
        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replying}>
              <Text style={[FT.small, { flex: 1 }]} numberOfLines={1}>
                Replying to {replyTo.author && (replyTo.author as any).anonymous ? (replyTo.author as any).alias : (replyTo.author as any)?.name || 'comment'}
              </Text>
              <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
                <X size={16} color={FriendsColors.muted} />
              </TouchableOpacity>
            </View>
          ) : null}
          {sendError ? (
            <Text style={styles.sendError} accessibilityRole="alert">
              {sendError}
            </Text>
          ) : null}
          <View style={styles.inputRow}>
            {allowAnon ? (
              <TouchableOpacity
                onPress={() => setAnon((v) => !v)}
                style={[styles.anonBtn, anon && { backgroundColor: FriendsColors.accentSoft, borderColor: FriendsColors.accent }]}
                accessibilityRole="switch"
                accessibilityState={{ checked: anon }}
                accessibilityLabel="Comment anonymously"
                accessibilityHint="Shows a thread alias instead of your name"
              >
                <VenetianMask size={18} color={anon ? FriendsColors.accent : FriendsColors.muted} />
              </TouchableOpacity>
            ) : null}
            <TextInput
              ref={inputRef}
              style={[fui.input, styles.input]}
              value={text}
              onChangeText={(t) => {
                setText(t.slice(0, FORUM_LIMITS.comment));
                if (sendError) setSendError(null);
              }}
              placeholder={anon ? 'Comment anonymously' : post.type === 'question' ? 'Write an answer' : 'Add a comment'}
              placeholderTextColor={FriendsColors.faint}
              multiline
              maxLength={FORUM_LIMITS.comment}
              accessibilityLabel={replyTo ? 'Reply text' : 'Comment text'}
            />
            <TouchableOpacity
              onPress={send}
              disabled={!text.trim() || sending || offline}
              style={[styles.sendBtn, (!text.trim() || sending || offline) && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel="Send comment"
              accessibilityState={{ disabled: !text.trim() || sending || offline, busy: sending }}
            >
              {sending ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <Send size={18} color={FriendsColors.accentInk} />}
            </TouchableOpacity>
          </View>
          {anon ? <Text style={[FT.small, { marginTop: 4 }]}>You'll appear as your alias for this thread. Rules and reports still apply.</Text> : null}
          {text.length > FORUM_LIMITS.comment - 200 ? (
            <Text style={[FT.small, { textAlign: 'right' }]}>
              {text.length}/{FORUM_LIMITS.comment}
            </Text>
          ) : null}
        </View>
      ) : null}

      <PostMenu
        post={post}
        visible={menu}
        onClose={() => setMenu(false)}
        onChanged={(p) => setPost(p)}
        onRemoved={() => nav.back()}
      />

      <FriendsSheet visible={!!editing} onClose={() => setEditing(null)} title="Edit comment">
        <TextInput
          style={[fui.input, { minHeight: 120, textAlignVertical: 'top' }]}
          value={editText}
          onChangeText={(t) => setEditText(t.slice(0, FORUM_LIMITS.comment))}
          multiline
          maxLength={FORUM_LIMITS.comment}
          accessibilityLabel="Comment text"
          autoFocus
        />
        {editError ? <Text style={[styles.sendError, { marginTop: FS.sm }]}>{editError}</Text> : null}
        <TouchableOpacity
          style={[fui.primaryBtn, { marginTop: FS.md }, (!editText.trim() || editBusy) && { opacity: 0.5 }]}
          onPress={saveEdit}
          disabled={!editText.trim() || editBusy}
          accessibilityRole="button"
        >
          {editBusy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Save</Text>}
        </TouchableOpacity>
      </FriendsSheet>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  postCard: { backgroundColor: FriendsColors.card, borderRadius: FR.card, borderWidth: 1, borderColor: FriendsColors.line, padding: FS.lg },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: FS.md, padding: FS.sm, borderRadius: FR.sm, backgroundColor: FriendsColors.warnSoft },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: FR.md, marginTop: FS.md, backgroundColor: FriendsColors.cardHi },
  link: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi, minHeight: 48 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginTop: FS.lg },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, minWidth: 44, justifyContent: 'center' },
  actionText: { fontSize: 13, fontWeight: '700', color: FriendsColors.muted },
  commentsHead: { marginTop: FS.xl, marginBottom: FS.md, gap: FS.sm },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  emptyComments: { alignItems: 'center', paddingVertical: FS.xl },
  composer: { borderTopWidth: 1, borderTopColor: FriendsColors.line, backgroundColor: FriendsColors.bg, paddingHorizontal: FS.md, paddingTop: FS.sm, paddingBottom: FS.md },
  replying: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, paddingHorizontal: 4, paddingBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: FS.sm },
  input: { flex: 1, maxHeight: 120, minHeight: 44 },
  anonBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  sendError: { fontSize: 12, fontWeight: '600', color: FriendsColors.danger, paddingHorizontal: 4, paddingBottom: 6 },
});

