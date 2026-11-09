import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ellipsis, Reply, CircleCheck, ShieldCheck, Hourglass, ChevronDown, ChevronRight, Pencil, Gavel, Award } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR } from '../friendsTheme';
import { IdentityChip, identityLabel } from '../shared/IdentityChip';
import { ActionMenu, ActionMenuExtra } from '../shared/ActionMenu';
import { ForumComment, deleteForumComment, FORUM_MAX_DEPTH } from '../api/forumApi';
import { VoteControl } from './VoteControl';
import { BadgePills } from './KarmaBadges';
import { ModToolsSheet } from './ModToolsSheet';
import { forumErrorMessage } from './forumShared';
import { useForumNav } from './forumNav';

import { themedSheet } from '../../../../utils/themeNow';
/** Visual indent per depth, capped so deep threads stay readable on narrow phones. */
const INDENT = 14;
const MAX_VISUAL_DEPTH = 4;

export const CommentItem: React.FC<{
  comment: ForumComment;
  isBest: boolean;
  replyCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Question posts: the asker or a community moderator can pick the best answer. */
  canPickBest: boolean;
  onPickBest: (c: ForumComment, on: boolean) => void;
  canReply: boolean;
  onReply: (c: ForumComment) => void;
  onEdit: (c: ForumComment) => void;
  onChanged: (c: ForumComment) => void;
  /** Reload the thread (after delete / moderation). */
  onReload: () => void;
  canModerate: boolean;
}> = ({ comment: c, isBest, replyCount, collapsed, onToggleCollapse, canPickBest, onPickBest, canReply, onReply, onEdit, onChanged, onReload, canModerate }) => {
  const nav = useForumNav();
  const [menu, setMenu] = useState(false);
  const [mod, setMod] = useState(false);
  const indent = Math.min(c.depth, MAX_VISUAL_DEPTH) * INDENT;
  const author: any = c.author;
  const mine = !!(c.canEdit || (author && (author.isMine || (!author.anonymous && author.userId === nav.me))));
  const tombstone = c.body === null || !c.author;

  if (tombstone) {
    const label = c.status === 'deleted' ? 'Comment deleted' : c.status === 'blocked' ? 'Comment from someone you blocked' : 'Comment removed';
    return (
      <View style={[styles.wrap, { marginLeft: indent }]}>
        {c.depth > 0 ? <View style={styles.thread} /> : null}
        <View style={styles.tomb} accessible accessibilityLabel={label}>
          <Text style={[FT.small, { fontStyle: 'italic' }]}>{label}</Text>
          {replyCount ? (
            <TouchableOpacity onPress={onToggleCollapse} hitSlop={8} accessibilityRole="button" accessibilityLabel={collapsed ? `Show ${replyCount} replies` : 'Hide replies'}>
              <Text style={styles.link}>{collapsed ? `Show ${replyCount} replies` : 'Hide replies'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  const later = (fn: () => void) => setTimeout(fn, Platform.OS === 'ios' ? 450 : 0);
  const extra: ActionMenuExtra[] = [];
  if (c.canEdit) extra.push({ key: 'edit', label: 'Edit comment', icon: <Pencil size={18} color={FriendsColors.ink} />, onPress: () => { setMenu(false); later(() => onEdit(c)); } });
  if (canPickBest && c.status === 'visible') {
    extra.push({
      key: 'best',
      label: isBest ? 'Unmark best answer' : 'Mark as best answer',
      icon: <Award size={18} color={FriendsColors.success} />,
      onPress: () => {
        setMenu(false);
        onPickBest(c, !isBest);
      },
    });
  }
  if (canModerate && !mine) extra.push({ key: 'mod', label: 'Moderator tools', icon: <Gavel size={18} color={FriendsColors.accent} />, onPress: () => { setMenu(false); later(() => setMod(true)); } });

  const a11y = `${identityLabel(c.author)}${isBest ? ', best answer' : ''}${c.isOfficialReply ? ', official reply' : ''}: ${c.body}. ${c.score ?? 0} points.`;

  return (
    <View style={[styles.wrap, { marginLeft: indent }]}>
      {c.depth > 0 ? <View style={styles.thread} /> : null}
      <View style={[styles.box, isBest && styles.best, c.isOfficialReply && styles.official]}>
        {isBest ? (
          <View style={styles.bestTag}>
            <CircleCheck size={12} color={FriendsColors.success} />
            <Text style={[styles.tagText, { color: FriendsColors.success }]}>Best answer</Text>
          </View>
        ) : null}
        {c.isOfficialReply ? (
          <View style={styles.bestTag}>
            <ShieldCheck size={12} color={FriendsColors.gold} />
            <Text style={[styles.tagText, { color: FriendsColors.gold }]}>Official reply</Text>
          </View>
        ) : null}
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <IdentityChip identity={c.author} time={c.createdAt} size="sm" onPress={nav.openUser} />
          </View>
          <TouchableOpacity onPress={() => setMenu(true)} style={styles.iconBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Comment options">
            <Ellipsis size={16} color={FriendsColors.muted} />
          </TouchableOpacity>
        </View>
        {author && !author.anonymous ? <BadgePills codes={author.badges} max={2} /> : null}
        <Text style={[FT.body, { marginTop: 6 }]} accessibilityLabel={a11y} selectable>
          {c.body}
        </Text>
        {c.editedAt ? <Text style={[FT.small, { marginTop: 2 }]}>Edited</Text> : null}
        {c.underReview ? (
          <View style={styles.note}>
            <Hourglass size={12} color={FriendsColors.warn} />
            <Text style={[FT.small, { color: FriendsColors.warn, flex: 1 }]}>Under review. Only you{canModerate ? ' and moderators' : ''} can see this for now.</Text>
          </View>
        ) : null}
        {(c.status === 'removed' || c.status === 'hidden') && c.removedReason ? (
          <Text style={[FT.small, { color: FriendsColors.danger, marginTop: 4 }]}>Removed: {c.removedReason}</Text>
        ) : null}
        <View style={styles.foot}>
          <VoteControl
            targetType="forum_comment"
            targetId={c.id}
            value={{ up: c.up || 0, down: c.down || 0, score: c.score || 0, myVote: c.myVote || 0 }}
            disabled={mine || c.status !== 'visible'}
            disabledReason={mine ? "You can't vote on your own comment" : undefined}
            size="sm"
            onGateError={nav.onGateError}
            onChange={(v) => onChanged({ ...c, ...v })}
          />
          {canReply && c.depth < FORUM_MAX_DEPTH && c.status === 'visible' ? (
            <TouchableOpacity style={styles.action} onPress={() => onReply(c)} accessibilityRole="button" accessibilityLabel={`Reply to ${identityLabel(c.author)}`}>
              <Reply size={15} color={FriendsColors.muted} />
              <Text style={styles.actionText}>Reply</Text>
            </TouchableOpacity>
          ) : null}
          {canPickBest && c.status === 'visible' && !isBest ? (
            <TouchableOpacity style={styles.action} onPress={() => onPickBest(c, true)} accessibilityRole="button" accessibilityLabel="Mark as best answer">
              <CircleCheck size={15} color={FriendsColors.muted} />
              <Text style={styles.actionText}>Best</Text>
            </TouchableOpacity>
          ) : null}
          <View style={{ flex: 1 }} />
          {replyCount ? (
            <TouchableOpacity style={styles.action} onPress={onToggleCollapse} accessibilityRole="button" accessibilityLabel={collapsed ? `Show ${replyCount} replies` : 'Hide replies'}>
              {collapsed ? <ChevronRight size={15} color={FriendsColors.accent} /> : <ChevronDown size={15} color={FriendsColors.muted} />}
              <Text style={[styles.actionText, collapsed && { color: FriendsColors.accent }]}>{collapsed ? `${replyCount}` : 'Hide'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ActionMenu
        visible={menu}
        onClose={() => setMenu(false)}
        title="Comment"
        extra={extra}
        report={mine ? null : { type: 'forum_comment', id: c.id, label: `comment by ${identityLabel(c.author)}` }}
        block={author && !author.anonymous && author.userId && !mine ? { userId: author.userId, name: identityLabel(c.author) } : null}
        onBlocked={(id) => {
          nav.onBlocked(id);
          onReload();
        }}
        onDelete={
          mine
            ? async () => {
                try {
                  await deleteForumComment(c.id);
                } catch (e: any) {
                  throw new Error(forumErrorMessage(e, "Couldn't delete it."));
                }
                onReload();
              }
            : null
        }
        deleteLabel="Delete comment"
      />
      <ModToolsSheet visible={mod} onClose={() => setMod(false)} target={{ kind: 'comment', comment: c }} onDone={() => onReload()} />
    </View>
  );
};

const styles = themedSheet(() => ({
  wrap: { flexDirection: 'row' },
  thread: { width: 2, borderRadius: 1, backgroundColor: FriendsColors.line, marginRight: FS.sm },
  box: { flex: 1, paddingVertical: FS.sm, paddingHorizontal: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.lineSoft },
  best: { borderColor: 'rgba(120,200,150,0.45)', backgroundColor: 'rgba(120,200,150,0.06)' },
  official: { borderColor: 'rgba(232,196,127,0.4)' },
  bestTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  tagText: { fontSize: 12, fontWeight: '800' },
  head: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: FS.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, minWidth: 40, paddingHorizontal: 8, justifyContent: 'center' },
  actionText: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  tomb: { flex: 1, paddingVertical: FS.sm, paddingHorizontal: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.lineSoft, minHeight: 40, justifyContent: 'center', gap: 4 },
  link: { fontSize: 12, fontWeight: '700', color: FriendsColors.accent },
}));
