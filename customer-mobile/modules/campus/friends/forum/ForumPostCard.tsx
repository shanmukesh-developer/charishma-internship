import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import {
  MessageCircle,
  Bookmark,
  Ellipsis,
  Pin,
  Lock,
  CircleCheck,
  Hourglass,
  ShieldCheck,
  Link2,
  Images,
  Pencil,
  Gavel,
  BookmarkCheck,
  EyeOff,
} from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { Alert } from 'react-native';
import { FriendsColors, FS, FT, FR, SectionTints } from '../friendsTheme';
import { CardGlow } from '../shared/FriendsUi';
import { IdentityChip, identityLabel } from '../shared/IdentityChip';
import { ActionMenu } from '../shared/ActionMenu';
import { ForumPost, bookmarkForumPost, deleteForumPost, deleteReview, fetchForumPost } from '../api/forumApi';
import { VoteControl } from './VoteControl';
import { Stars } from './Stars';
import { BadgePills } from './KarmaBadges';
import { ModToolsSheet } from './ModToolsSheet';
import { POST_TYPE_META, REVIEW_KIND_META, compactCount, forumBus, forumErrorMessage, forumPostLink } from './forumShared';
import { useForumNav } from './forumNav';

/** Small status / label chips shared by the card and the post screen. */
export const PostFlags: React.FC<{ post: ForumPost; showType?: boolean }> = ({ post, showType = true }) => {
  const meta = POST_TYPE_META[post.type];
  const TypeIcon = meta.icon;
  const chips: { key: string; label: string; icon?: React.ReactNode; tone: 'accent' | 'gold' | 'muted' | 'warn' | 'danger' | 'success' }[] = [];
  if (showType) chips.push({ key: 'type', label: meta.short, icon: <TypeIcon size={11} color={FriendsColors.muted} />, tone: 'muted' });
  if (post.isFreshersGuide) chips.push({ key: 'guide', label: post.isOfficial ? 'Official guide' : 'Student guide', tone: post.isOfficial ? 'gold' : 'accent' });
  else if (post.isOfficial) chips.push({ key: 'official', label: 'Official', icon: <ShieldCheck size={11} color={FriendsColors.gold} />, tone: 'gold' });
  if (post.isPinned && !post.isFreshersGuide) chips.push({ key: 'pin', label: 'Pinned', icon: <Pin size={11} color={FriendsColors.accent} />, tone: 'accent' });
  if (post.isLocked) chips.push({ key: 'lock', label: 'Locked', icon: <Lock size={11} color={FriendsColors.muted} />, tone: 'muted' });
  if (post.type === 'question' && post.bestCommentId) chips.push({ key: 'answered', label: 'Answered', icon: <CircleCheck size={11} color={FriendsColors.success} />, tone: 'success' });
  if (post.underReview) chips.push({ key: 'review', label: 'Under review', icon: <Hourglass size={11} color={FriendsColors.warn} />, tone: 'warn' });
  if (post.status === 'removed' || post.status === 'hidden') chips.push({ key: 'removed', label: 'Removed', icon: <EyeOff size={11} color={FriendsColors.danger} />, tone: 'danger' });
  if (!chips.length) return null;
  const color = { accent: FriendsColors.accent, gold: FriendsColors.gold, muted: FriendsColors.muted, warn: FriendsColors.warn, danger: FriendsColors.danger, success: FriendsColors.success };
  const bg = {
    accent: FriendsColors.accentSoft,
    gold: FriendsColors.goldSoft,
    muted: FriendsColors.cardHi,
    warn: FriendsColors.warnSoft,
    danger: FriendsColors.dangerSoft,
    success: 'rgba(120,200,150,0.12)',
  };
  return (
    <View style={styles.flags}>
      {chips.map((c) => (
        <View key={c.key} style={[styles.flag, { backgroundColor: bg[c.tone] }]}>
          {c.icon}
          <Text style={[styles.flagText, { color: color[c.tone] }]}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
};

/**
 * "…" menu for a post: copy link, save, edit (author), mod tools (community moderators),
 * report, block a named author, delete (author). Anonymous authors are never blockable by name.
 */
export const PostMenu: React.FC<{
  post: ForumPost;
  visible: boolean;
  onClose: () => void;
  onChanged?: (post: ForumPost) => void;
  onRemoved?: (postId: string) => void;
}> = ({ post, visible, onClose, onChanged, onRemoved }) => {
  const nav = useForumNav();
  const [modOpen, setModOpen] = useState(false);
  const author: any = post.author;
  const named = author && !author.anonymous && author.userId;
  const mine = post.canEdit || (author && (author.isMine || (named && author.userId === nav.me)));
  const reportTarget = post.review
    ? { type: 'review' as const, id: post.review.id, label: `review of ${post.review.target?.name || 'this'}` }
    : { type: 'forum_post' as const, id: post.id, label: `post "${post.title.slice(0, 40)}"` };

  const later = (fn: () => void) => setTimeout(fn, Platform.OS === 'ios' ? 450 : 0);

  const extra = [
    {
      key: 'save',
      label: post.bookmarked ? 'Remove from saved' : 'Save',
      icon: post.bookmarked ? <BookmarkCheck size={18} color={FriendsColors.accent} /> : <Bookmark size={18} color={FriendsColors.ink} />,
      onPress: async () => {
        await bookmarkForumPost(post.id, !post.bookmarked);
        const next = { ...post, bookmarked: !post.bookmarked };
        onChanged?.(next);
        forumBus.emitPost(next);
        onClose();
      },
    },
  ];
  if (post.canEdit) {
    extra.push({
      key: 'edit',
      label: post.review ? 'Edit review' : 'Edit post',
      icon: <Pencil size={18} color={FriendsColors.ink} />,
      onPress: async () => {
        onClose();
        // List cards carry a 300-character excerpt: editing that would overwrite the full body.
        let full: ForumPost = post;
        if (post.bodyTruncated) {
          try {
            full = await fetchForumPost(post.id);
          } catch (e: any) {
            Alert.alert("Couldn't open the editor", e?.message || 'Please try again.');
            return;
          }
        }
        later(() => nav.openComposer({ edit: full }));
      },
    });
  }
  if (post.canModerate && !mine) {
    extra.push({
      key: 'mod',
      label: 'Moderator tools',
      icon: <Gavel size={18} color={FriendsColors.accent} />,
      onPress: async () => {
        onClose();
        later(() => setModOpen(true));
      },
    });
  }

  return (
    <>
      <ActionMenu
        visible={visible}
        onClose={onClose}
        title={post.title}
        copyLink={forumPostLink(post.id)}
        extra={extra}
        report={mine ? null : reportTarget}
        block={named && !mine ? { userId: author.userId, name: identityLabel(post.author) } : null}
        onBlocked={(id) => {
          nav.onBlocked(id);
          onRemoved?.(post.id);
        }}
        onDelete={
          mine
            ? async () => {
                try {
                  if (post.review) await deleteReview(post.review.id);
                  else await deleteForumPost(post.id);
                } catch (e: any) {
                  throw new Error(forumErrorMessage(e, "Couldn't delete it."));
                }
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                forumBus.emitRemoved(post.id);
                onRemoved?.(post.id);
              }
            : null
        }
        deleteLabel={post.review ? 'Delete review' : 'Delete post'}
      />
      <ModToolsSheet
        visible={modOpen}
        onClose={() => setModOpen(false)}
        target={{ kind: 'post', post }}
        onDone={async (action) => {
          try {
            const fresh = await fetchForumPost(post.id);
            onChanged?.(fresh);
            forumBus.emitPost(fresh);
            if (fresh.status !== 'visible' && action === 'remove') forumBus.emitRemoved(post.id);
          } catch {
            if (action === 'remove') {
              forumBus.emitRemoved(post.id);
              onRemoved?.(post.id);
            }
          }
        }}
      />
    </>
  );
};

/** One post in a community / search / saved list. */
export const ForumPostCard: React.FC<{
  post: ForumPost;
  showCommunity?: boolean;
  onChanged?: (post: ForumPost) => void;
  onRemoved?: (postId: string) => void;
}> = ({ post, showCommunity, onChanged, onRemoved }) => {
  const nav = useForumNav();
  const [menu, setMenu] = useState(false);
  const author: any = post.author;
  const mine = !!(author && (author.isMine || (!author.anonymous && author.userId === nav.me)));
  const review = post.review;
  const firstImage = post.media?.[0]?.url;
  const removed = post.status === 'removed' || post.status === 'hidden';

  const toggleSave = async () => {
    const next = { ...post, bookmarked: !post.bookmarked };
    onChanged?.(next);
    Haptics.selectionAsync().catch(() => {});
    try {
      await bookmarkForumPost(post.id, next.bookmarked);
      forumBus.emitPost(next);
    } catch (e: any) {
      onChanged?.(post);
      nav.onGateError(e);
      Alert.alert("Couldn't save", forumErrorMessage(e));
    }
  };

  const a11y = [
    POST_TYPE_META[post.type].label,
    post.title,
    `by ${identityLabel(post.author)}`,
    review ? `${review.rating} stars for ${review.target?.name || 'review'}` : null,
    `${post.score} points`,
    `${post.commentCount} comments`,
    post.underReview ? 'under review' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={[styles.card, post.isFreshersGuide && styles.guideCard]}>
      <CardGlow tint={post.isFreshersGuide ? 'rgba(232,196,127,0.10)' : undefined} />
      <TouchableOpacity
        onPress={() => nav.push({ name: 'post', id: post.id, post })}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="Opens the post"
      >
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <IdentityChip identity={post.author} time={post.createdAt} size="sm" onPress={(id) => nav.openUser(id)} />
          </View>
          <TouchableOpacity onPress={() => setMenu(true)} hitSlop={10} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Post options">
            <Ellipsis size={18} color={FriendsColors.muted} />
          </TouchableOpacity>
        </View>
        {!author?.anonymous ? <BadgePills codes={author?.badges} max={2} /> : null}

        <View style={{ marginTop: FS.sm }}>
          {showCommunity && post.community ? <Text style={styles.community}>{post.community.name}</Text> : null}
          <PostFlags post={post} />
          <Text style={[FT.h3, { marginTop: 6 }]} numberOfLines={3}>
            {post.title}
          </Text>

          {review ? (
            <TouchableOpacity
              style={styles.reviewRow}
              onPress={() => review.targetId && nav.push({ name: 'target', id: review.targetId })}
              accessibilityRole="button"
              accessibilityLabel={`${review.rating} out of 5 for ${review.target?.name}. Open all reviews.`}
            >
              <Stars value={review.rating} size={13} />
              <Text style={[FT.small, { flex: 1 }]} numberOfLines={1}>
                {review.target ? `${REVIEW_KIND_META[review.target.kind]?.label || 'Review'} · ${review.target.name}` : 'Review'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {post.body ? (
            <Text style={[FT.muted, { marginTop: 6 }]} numberOfLines={4}>
              {post.body}
            </Text>
          ) : null}
          {removed && post.removedReason ? (
            <Text style={[FT.small, { color: FriendsColors.danger, marginTop: 6 }]}>Removed: {post.removedReason}</Text>
          ) : null}
          {firstImage ? <Image source={{ uri: firstImage }} style={styles.image} contentFit="cover" accessibilityLabel="Attached photo" /> : null}
          {post.media.length > 1 || post.links.length ? (
            <View style={styles.attachRow}>
              {post.media.length > 1 ? (
                <View style={styles.attach}>
                  <Images size={12} color={FriendsColors.muted} />
                  <Text style={FT.small}>{post.media.length} photos</Text>
                </View>
              ) : null}
              {post.links.length ? (
                <View style={styles.attach}>
                  <Link2 size={12} color={FriendsColors.muted} />
                  <Text style={FT.small} numberOfLines={1}>
                    {post.links[0].host}
                    {post.links.length > 1 ? ` +${post.links.length - 1}` : ''}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </TouchableOpacity>

      <View style={styles.foot}>
        <VoteControl
          targetType="forum_post"
          targetId={post.id}
          value={{ up: post.up, down: post.down, score: post.score, myVote: post.myVote }}
          disabled={mine || post.status !== 'visible'}
          disabledReason={mine ? "You can't vote on your own post" : 'Voting is closed on this post'}
          size="sm"
          onGateError={nav.onGateError}
          onChange={(v) => {
            const next = { ...post, ...v };
            onChanged?.(next);
            forumBus.emitPost(next);
          }}
        />
        <TouchableOpacity
          style={styles.footBtn}
          onPress={() => nav.push({ name: 'post', id: post.id, post })}
          accessibilityRole="button"
          accessibilityLabel={`${post.commentCount} comments. Open`}
        >
          <MessageCircle size={16} color={FriendsColors.muted} />
          <Text style={styles.footText}>{compactCount(post.commentCount)}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={styles.footBtn}
          onPress={toggleSave}
          accessibilityRole="button"
          accessibilityLabel={post.bookmarked ? 'Remove from saved' : 'Save post'}
          accessibilityState={{ selected: post.bookmarked }}
        >
          {post.bookmarked ? <BookmarkCheck size={17} color={FriendsColors.accent} /> : <Bookmark size={17} color={FriendsColors.muted} />}
        </TouchableOpacity>
      </View>

      <PostMenu post={post} visible={menu} onClose={() => setMenu(false)} onChanged={onChanged} onRemoved={onRemoved} />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: FriendsColors.card,
    borderRadius: FR.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: FriendsColors.line,
    paddingHorizontal: FS.lg,
    paddingTop: FS.md,
    paddingBottom: FS.sm,
  },
  guideCard: { borderColor: 'rgba(232,196,127,0.35)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: FS.sm },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  community: { fontSize: 12, fontWeight: '800', color: SectionTints.forum.fg, letterSpacing: 0.4, marginBottom: 4, textTransform: 'uppercase' },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: FR.pill },
  flagText: { fontSize: 12, fontWeight: '800' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginTop: 6, minHeight: 32 },
  image: { width: '100%', height: 180, borderRadius: FR.md, marginTop: FS.sm, backgroundColor: FriendsColors.cardHi },
  attachRow: { flexDirection: 'row', gap: FS.sm, marginTop: FS.sm, flexWrap: 'wrap' },
  attach: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.cardHi, maxWidth: 220 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginTop: FS.sm },
  footBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 6 },
  footText: { fontSize: 13, fontWeight: '700', color: FriendsColors.muted },
});
