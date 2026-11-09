import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Pin, PinOff, Lock, LockOpen, Trash2, RotateCcw, CircleCheck, Gavel } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsSheet } from '../shared/FriendsSheet';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { modPost, modComment, ForumPost, ForumComment, ForumPostModAction, ForumCommentModAction, FORUM_LIMITS } from '../api/forumApi';
import { forumErrorMessage } from './forumShared';

import { themedSheet } from '../../../../utils/themeNow';
type Target = { kind: 'post'; post: ForumPost } | { kind: 'comment'; comment: ForumComment };

type Row = { action: ForumPostModAction | ForumCommentModAction; label: string; hint: string; icon: React.ReactNode; destructive?: boolean; needsReason?: boolean };

const rowsFor = (t: Target): Row[] => {
  const rows: Row[] = [];
  const status = t.kind === 'post' ? t.post.status : t.comment.status;
  if (status === 'pending_review') {
    rows.push({ action: 'approve', label: 'Approve', hint: 'Make it visible; closes open reports as dismissed', icon: <CircleCheck size={18} color={FriendsColors.success} /> });
  }
  if (t.kind === 'post' && status === 'visible') {
    rows.push(
      t.post.isPinned
        ? { action: 'unpin', label: 'Unpin', hint: 'Remove from the top of the community', icon: <PinOff size={18} color={FriendsColors.ink} /> }
        : { action: 'pin', label: 'Pin to top', hint: 'Up to 5 pinned posts per community', icon: <Pin size={18} color={FriendsColors.ink} /> }
    );
    rows.push(
      t.post.isLocked
        ? { action: 'unlock', label: 'Unlock comments', hint: 'Allow new comments again', icon: <LockOpen size={18} color={FriendsColors.ink} /> }
        : { action: 'lock', label: 'Lock comments', hint: 'No new comments; existing ones stay', icon: <Lock size={18} color={FriendsColors.ink} /> }
    );
  }
  if (status === 'removed' || status === 'hidden') {
    rows.push({ action: 'restore', label: 'Restore', hint: 'Undo the removal', icon: <RotateCcw size={18} color={FriendsColors.ink} /> });
  }
  if (status === 'visible' || status === 'pending_review') {
    rows.push({
      action: 'remove',
      label: 'Remove',
      hint: 'The author sees your reason and can appeal',
      icon: <Trash2 size={18} color={FriendsColors.danger} />,
      destructive: true,
      needsReason: true,
    });
  }
  return rows;
};

/**
 * Scoped community-moderator tools for one post or comment. The server checks the moderator's
 * community and conflict-of-interest rules; every action lands in the community mod log.
 */
export const ModToolsSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  target: Target | null;
  onDone: (action: string) => void;
}> = ({ visible, onClose, target, onDone }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPending(null);
    setReason('');
    setError(null);
    setBusy(null);
  }, [visible, target]);

  if (!target) return null;
  const rows = rowsFor(target);

  const run = async (row: Row, why?: string) => {
    if (busy) return;
    setBusy(row.action);
    setError(null);
    try {
      if (target.kind === 'post') await modPost(target.post.id, row.action as ForumPostModAction, why);
      else await modComment(target.comment.id, row.action as ForumCommentModAction, why);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onDone(row.action);
      onClose();
    } catch (e: any) {
      setError(forumErrorMessage(e, "Couldn't do that."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <FriendsSheet
      visible={visible}
      onClose={onClose}
      title="Moderator tools"
      subtitle={target.kind === 'post' ? 'This post' : 'This comment'}
      icon={<Gavel size={18} color={FriendsColors.accent} />}
    >
      {pending ? (
        <View>
          <Text style={FT.h3}>Why are you removing this?</Text>
          <Text style={[FT.small, { marginTop: 4 }]}>The author sees this reason and can appeal. Keep it factual.</Text>
          <TextInput
            style={[fui.input, { marginTop: FS.md, minHeight: 80, textAlignVertical: 'top' }]}
            value={reason}
            onChangeText={(t) => setReason(t.slice(0, FORUM_LIMITS.modReason))}
            placeholder="e.g. Shares a phone number (rule 2)"
            placeholderTextColor={FriendsColors.faint}
            multiline
            maxLength={FORUM_LIMITS.modReason}
            accessibilityLabel="Removal reason"
            autoFocus
          />
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <TouchableOpacity
            style={[fui.primaryBtn, { marginTop: FS.md, backgroundColor: FriendsColors.danger }, (reason.trim().length < 3 || !!busy) && { opacity: 0.5 }]}
            onPress={() => run(pending, reason.trim())}
            disabled={reason.trim().length < 3 || !!busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: reason.trim().length < 3 || !!busy }}
          >
            {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Remove</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.sm }]} onPress={() => setPending(null)} accessibilityRole="button">
            <Text style={fui.ghostBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <View style={fui.card}>
            {rows.map((r, i) => (
              <TouchableOpacity
                key={r.action}
                style={[fui.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => (r.needsReason ? setPending(r) : run(r))}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}. ${r.hint}`}
              >
                {busy === r.action ? <ActivityIndicator size="small" color={FriendsColors.muted} /> : r.icon}
                <View style={{ flex: 1 }}>
                  <Text style={[FT.h3, r.destructive && { color: FriendsColors.danger }]}>{r.label}</Text>
                  <Text style={FT.small}>{r.hint}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {!rows.length ? (
              <View style={[fui.row, { borderBottomWidth: 0 }]}>
                <Text style={FT.muted}>Nothing to do here right now.</Text>
              </View>
            ) : null}
          </View>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <Text style={[FT.small, { marginTop: FS.md }]}>
            Every action is recorded in this community's mod log. You can't act on your own posts or on reviews you replied to.
          </Text>
        </View>
      )}
    </FriendsSheet>
  );
};

const styles = themedSheet(() => ({
  error: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft, color: FriendsColors.danger, fontSize: 13, fontWeight: '600' },
}));
