import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform, Share } from 'react-native';
import {
  MessageCircle,
  Repeat2,
  Heart,
  Bookmark,
  BookmarkCheck,
  Ellipsis,
  Hourglass,
  EyeOff,
  Pencil,
  Share2,
  UserPlus,
  UserCheck,
  CornerDownRight,
  Lock,
  Users,
  History,
} from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR } from '../friendsTheme';
import { CardGlow } from '../shared/FriendsUi';
import { IdentityChip, identityLabel } from '../shared/IdentityChip';
import { ActionMenu, ActionMenuExtra } from '../shared/ActionMenu';
import { RelativeTime } from '../shared/RelativeTime';
import { followTarget, unfollowTarget } from '../api/core';
import { PulsePost, PulseRepost, deletePulsePost, setPulseBookmark, setPulseLike, setPulseRepost } from '../api/pulseApi';
import { RichText, MediaGrid, LinkChip } from './PostParts';
import { PollView } from './PollView';
import { compactCount, pulseBus, pulseErrorMessage, pulsePostLink } from './pulseShared';
import { usePulseNav } from './pulseNav';

import { themedSheet } from '../../../../utils/themeNow';
const isAnon = (a: any) => !!a && a.anonymous === true;

/** Small status chips: under review, removed, imported whisper, reply limits. */
export const PostFlags: React.FC<{ post: PulsePost }> = ({ post }) => {
  const chips: { key: string; label: string; icon: React.ReactNode; color: string; bg: string }[] = [];
  if (post.underReview)
    chips.push({ key: 'review', label: 'Under review', icon: <Hourglass size={11} color={FriendsColors.warn} />, color: FriendsColors.warn, bg: FriendsColors.warnSoft });
  if (post.status === 'removed' || post.status === 'hidden')
    chips.push({ key: 'removed', label: 'Removed', icon: <EyeOff size={11} color={FriendsColors.danger} />, color: FriendsColors.danger, bg: FriendsColors.dangerSoft });
  if (post.imported) chips.push({ key: 'imported', label: 'From Whispers', icon: <History size={11} color={FriendsColors.muted} />, color: FriendsColors.muted, bg: FriendsColors.cardHi });
  if (post.kind === 'post' && post.replyPolicy === 'none')
    chips.push({ key: 'noreply', label: 'Replies off', icon: <Lock size={11} color={FriendsColors.muted} />, color: FriendsColors.muted, bg: FriendsColors.cardHi });
  if (post.kind === 'post' && post.replyPolicy === 'following')
    chips.push({ key: 'following', label: 'Replies: people they follow', icon: <Users size={11} color={FriendsColors.muted} />, color: FriendsColors.muted, bg: FriendsColors.cardHi });
  if (!chips.length) return null;
  return (
    <View style={styles.flags}>
      {chips.map((c) => (
        <View key={c.key} style={[styles.flag, { backgroundColor: c.bg }]}>
          {c.icon}
          <Text style={[styles.flagText, { color: c.color }]}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
};

/**
 * "…" menu for a Pulse post: copy link, share, edit / delete (author), follow or mute a club,
 * mute or block a named author, report. Anonymous authors are never blockable or mutable by name
 * (the app is never told who they are); reporting still works.
 */
export const PostMenu: React.FC<{
  post: PulsePost;
  visible: boolean;
  onClose: () => void;
  onChanged?: (p: PulsePost) => void;
  onRemoved?: (id: string) => void;
}> = ({ post, visible, onClose, onChanged, onRemoved }) => {
  const nav = usePulseNav();
  const a: any = post.author;
  const anon = isAnon(a);
  const mine = !!post.mine || (anon ? !!a.isMine : !!a?.userId && a.userId === nav.me);
  const entity = !anon && a?.entity ? a.entity : null;
  const named = !anon && a?.userId && !entity;
  const later = (fn: () => void) => setTimeout(fn, Platform.OS === 'ios' ? 450 : 0);

  const extra: ActionMenuExtra[] = [
    {
      key: 'share',
      label: 'Share',
      icon: <Share2 size={18} color={FriendsColors.ink} />,
      onPress: async () => {
        onClose();
        later(() => {
          Share.share({ message: `${post.text ? `${post.text.slice(0, 120)}\n` : ''}${pulsePostLink(post.id)}` }).catch(() => {});
        });
      },
    },
  ];
  if (post.canEdit) {
    extra.push({
      key: 'edit',
      label: 'Edit post',
      icon: <Pencil size={18} color={FriendsColors.ink} />,
      onPress: async () => {
        onClose();
        later(() => nav.openComposer({ edit: post }));
      },
    });
  }
  if (entity && !mine) {
    const following = nav.followedEntities.has(String(entity.id));
    extra.push({
      key: 'follow-entity',
      label: following ? `Unfollow ${entity.name}` : `Follow ${entity.name}`,
      icon: following ? <UserCheck size={18} color={FriendsColors.accent} /> : <UserPlus size={18} color={FriendsColors.ink} />,
      onPress: async () => {
        try {
          if (following) await unfollowTarget('entity', entity.id);
          else await followTarget('entity', entity.id);
        } catch (e: any) {
          nav.onGateError(e);
          throw new Error(pulseErrorMessage(e));
        }
        nav.setEntityFollowed(String(entity.id), !following);
        Haptics.selectionAsync().catch(() => {});
        onClose();
      },
    });
  }

  return (
    <ActionMenu
      visible={visible}
      onClose={onClose}
      title={post.kind === 'reply' ? 'Reply' : 'Post'}
      copyLink={pulsePostLink(post.id)}
      extra={extra}
      report={mine ? null : { type: post.kind === 'reply' ? 'reply' : 'post', id: post.id, label: `${post.kind} by ${identityLabel(post.author)}` }}
      mute={
        mine
          ? null
          : entity
          ? { targetType: 'entity', targetId: entity.id, label: entity.name }
          : named
          ? { targetType: 'user', targetId: a.userId, label: identityLabel(post.author) }
          : null
      }
      onMuteChanged={(muted) => {
        if (muted) {
          pulseBus.emitRemoved(post.id);
          onRemoved?.(post.id);
        }
      }}
      block={named && !mine ? { userId: a.userId, name: identityLabel(post.author) } : null}
      onBlocked={(id) => {
        nav.onBlocked(id);
        onRemoved?.(post.id);
      }}
      onDelete={
        post.canDelete
          ? async () => {
              try {
                await deletePulsePost(post.id);
              } catch (e: any) {
                throw new Error(pulseErrorMessage(e, "Couldn't delete it."));
              }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              pulseBus.emitRemoved(post.id);
              onRemoved?.(post.id);
              onChanged?.({ ...post, status: 'deleted' });
            }
          : null
      }
      deleteLabel={post.kind === 'reply' ? 'Delete reply' : 'Delete post'}
    />
  );
};

/** Like / reply / repost / bookmark row. Optimistic, then the server's counts win. */
export const PostActions: React.FC<{ post: PulsePost; onChanged: (p: PulsePost) => void; onReply: () => void; onMore: () => void; large?: boolean }> = ({
  post,
  onChanged,
  onReply,
  onMore,
  large,
}) => {
  const nav = usePulseNav();
  const [busy, setBusy] = useState<string | null>(null);
  const live = post.status === 'visible';

  const run = async (key: 'like' | 'repost' | 'bookmark') => {
    if (busy || !live) return;
    setBusy(key);
    const prev = post;
    let optimistic: PulsePost = post;
    if (key === 'like') optimistic = { ...post, liked: !post.liked, likeCount: Math.max(0, post.likeCount + (post.liked ? -1 : 1)) };
    if (key === 'repost') optimistic = { ...post, reposted: !post.reposted, repostCount: Math.max(0, post.repostCount + (post.reposted ? -1 : 1)) };
    if (key === 'bookmark') optimistic = { ...post, bookmarked: !post.bookmarked };
    onChanged(optimistic);
    Haptics.selectionAsync().catch(() => {});
    try {
      let next = optimistic;
      if (key === 'like') {
        const r = await setPulseLike(post.id, optimistic.liked);
        next = { ...optimistic, liked: r.liked, likeCount: r.likeCount, replyCount: r.replyCount, repostCount: r.repostCount };
      } else if (key === 'repost') {
        const r = await setPulseRepost(post.id, optimistic.reposted);
        next = { ...optimistic, reposted: r.reposted, likeCount: r.likeCount, replyCount: r.replyCount, repostCount: r.repostCount };
      } else {
        const r = await setPulseBookmark(post.id, optimistic.bookmarked);
        next = { ...optimistic, bookmarked: r.bookmarked };
      }
      onChanged(next);
      pulseBus.emitPost(next);
    } catch (e: any) {
      onChanged(prev);
      nav.onGateError(e);
      Alert.alert("Couldn't do that", pulseErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const size = large ? 20 : 18;
  const replyDisabled = !post.canReply;
  return (
    <View style={styles.actions}>
      <TouchableOpacity
        style={styles.action}
        onPress={onReply}
        accessibilityRole="button"
        accessibilityLabel={`${post.replyCount} replies. ${replyDisabled ? 'Open conversation' : 'Reply'}`}
      >
        <MessageCircle size={size} color={FriendsColors.muted} />
        <Text style={styles.count}>{post.replyCount ? compactCount(post.replyCount) : ''}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.action, !post.canRepost && { opacity: 0.35 }]}
        onPress={() => (post.canRepost ? run('repost') : Alert.alert('Repost', (post.author as any)?.anonymous ? 'Anonymous posts cannot be reposted.' : 'This post cannot be reposted.'))}
        accessibilityRole="button"
        accessibilityState={{ selected: post.reposted, disabled: !post.canRepost }}
        accessibilityLabel={`${post.reposted ? 'Undo repost' : 'Repost'}, ${post.repostCount} reposts`}
      >
        <Repeat2 size={size} color={post.reposted ? FriendsColors.success : FriendsColors.muted} />
        <Text style={[styles.count, post.reposted && { color: FriendsColors.success }]}>{post.repostCount ? compactCount(post.repostCount) : ''}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.action, !live && { opacity: 0.35 }]}
        onPress={() => run('like')}
        disabled={!live}
        accessibilityRole="button"
        accessibilityState={{ selected: post.liked, disabled: !live }}
        accessibilityLabel={`${post.liked ? 'Unlike' : 'Like'}, ${post.likeCount} likes`}
      >
        <Heart size={size} color={post.liked ? FriendsColors.danger : FriendsColors.muted} fill={post.liked ? FriendsColors.danger : 'transparent'} />
        <Text style={[styles.count, post.liked && { color: FriendsColors.danger }]}>{post.likeCount ? compactCount(post.likeCount) : ''}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.action, !live && { opacity: 0.35 }]}
        onPress={() => run('bookmark')}
        disabled={!live}
        accessibilityRole="button"
        accessibilityState={{ selected: post.bookmarked }}
        accessibilityLabel={post.bookmarked ? 'Remove bookmark' : 'Bookmark'}
      >
        {post.bookmarked ? <BookmarkCheck size={size} color={FriendsColors.accent} /> : <Bookmark size={size} color={FriendsColors.muted} />}
      </TouchableOpacity>
      <TouchableOpacity style={styles.action} onPress={onMore} accessibilityRole="button" accessibilityLabel="More options">
        <Ellipsis size={size} color={FriendsColors.muted} />
      </TouchableOpacity>
    </View>
  );
};

/** One post (or a repost of one) in a Pulse list. */
export const PostCard: React.FC<{
  post: PulsePost;
  repost?: Pick<PulseRepost, 'repostedBy' | 'repostedAt'> | null;
  onChanged: (p: PulsePost) => void;
  onRemoved?: (id: string) => void;
  /** Show the "Replying to …" line (hashtag / profile / my posts lists). */
  showReplyContext?: boolean;
  /** Inside a thread: tapping the body does nothing (already open). */
  disableOpen?: boolean;
}> = ({ post, repost, onChanged, onRemoved, showReplyContext = true, disableOpen }) => {
  const nav = usePulseNav();
  const [menu, setMenu] = useState(false);
  const a: any = post.author;
  const entity = !isAnon(a) ? a?.entity : null;
  const removed = post.status === 'removed' || post.status === 'hidden';

  const open = () => {
    if (!disableOpen) nav.push({ name: 'thread', id: post.id, post });
  };
  const reply = () => {
    if (post.canReply) nav.openComposer({ replyTo: post });
    else open();
  };

  const a11y = [
    repost?.repostedBy ? `Reposted by ${identityLabel(repost.repostedBy)}` : null,
    post.kind === 'reply' ? 'Reply' : 'Post',
    `by ${identityLabel(post.author)}`,
    post.text ? post.text.slice(0, 200) : null,
    post.media.length ? `${post.media.length} photo${post.media.length === 1 ? '' : 's'}` : null,
    post.poll ? 'Poll' : null,
    post.underReview ? 'Under review' : null,
    `${post.likeCount} likes, ${post.replyCount} replies`,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View style={styles.card}>
      <CardGlow />
      {repost?.repostedBy ? (
        <View style={styles.repostLine}>
          <Repeat2 size={13} color={FriendsColors.success} />
          <Text style={[FT.small, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>
            {identityLabel(repost.repostedBy)} reposted
          </Text>
          <Text style={FT.small}> · </Text>
          <RelativeTime value={repost.repostedAt} />
        </View>
      ) : null}

      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <IdentityChip identity={post.author} time={post.createdAt} size="sm" onPress={!isAnon(a) && !entity && a?.userId ? (id) => nav.openUser(id) : undefined} />
        </View>
      </View>

      <TouchableOpacity onPress={open} activeOpacity={disableOpen ? 1 : 0.85} accessibilityRole={disableOpen ? undefined : 'button'} accessibilityLabel={a11y} accessibilityHint={disableOpen ? undefined : 'Opens the conversation'}>
        {showReplyContext && post.replyTo ? (
          <View style={styles.replyTo}>
            <CornerDownRight size={12} color={FriendsColors.faint} />
            <Text style={FT.small} numberOfLines={1}>
              {post.replyTo.unavailable ? 'Replying to a post that is no longer available' : `Replying to ${identityLabel(post.replyTo.author)}`}
            </Text>
          </View>
        ) : null}
        <PostFlags post={post} />
        {post.text ? <RichText text={post.text} onTag={(tag) => nav.push({ name: 'hashtag', tag })} style={{ marginTop: 6 }} /> : null}
        {removed && post.removedReason ? <Text style={[FT.small, { color: FriendsColors.danger, marginTop: 6 }]}>Removed by moderators: {post.removedReason}</Text> : null}
        {post.editedAt ? <Text style={[FT.small, { color: FriendsColors.faint, marginTop: 4 }]}>Edited</Text> : null}
      </TouchableOpacity>
      <MediaGrid media={post.media} compact />
      {post.link ? <LinkChip link={post.link} /> : null}
      {post.poll ? (
        <PollView
          poll={post.poll}
          canVote={post.status === 'visible'}
          onGateError={nav.onGateError}
          onChange={(poll) => {
            const next = { ...post, poll };
            onChanged(next);
            pulseBus.emitPost(next);
          }}
        />
      ) : null}

      <PostActions post={post} onChanged={onChanged} onReply={reply} onMore={() => setMenu(true)} />
      <PostMenu post={post} visible={menu} onClose={() => setMenu(false)} onChanged={onChanged} onRemoved={onRemoved} />
    </View>
  );
};

const styles = themedSheet(() => ({
  card: {
    backgroundColor: FriendsColors.card,
    borderRadius: FR.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: FriendsColors.line,
    paddingHorizontal: FS.lg,
    paddingTop: FS.md,
    paddingBottom: 2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: FS.sm },
  repostLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, paddingLeft: 2 },
  replyTo: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: FR.pill },
  flagText: { fontSize: 12, fontWeight: '800' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginHorizontal: -8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, minWidth: 48, paddingHorizontal: 8 },
  count: { fontSize: 13, fontWeight: '700', color: FriendsColors.muted, minWidth: 10 },
}));
