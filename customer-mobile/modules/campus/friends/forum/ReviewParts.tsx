import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { ThumbsUp, ThumbsDown, ShieldCheck, MessageSquareReply, Hourglass, Pencil, Trash2 } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSheet } from '../shared/FriendsSheet';
import { RelativeTime } from '../shared/RelativeTime';
import { ForumReview, ForumReviewResponse, FORUM_LIMITS, respondToReview, deleteReviewResponse } from '../api/forumApi';
import { Stars } from './Stars';
import { CONTEXT_LABELS, REVIEW_KIND_META, blockedDetails, forumErrorMessage } from './forumShared';
import { useForumNav } from './forumNav';

/** Who may try to reply: the server decides (linked faculty, official account managers, admins). */
export const mayOfferRightOfReply = (roles: string[], review: ForumReview) =>
  !review.response && !review.isMine && review.status === 'published' && (roles.includes('faculty') || roles.includes('campus_admin'));

/**
 * Structured review body: rating, target, period, context, pros / cons and the right-of-reply block.
 * The reviewer is never shown; reviews are always anonymous.
 */
export const ReviewBlock: React.FC<{ review: ForumReview; onChanged: (r: ForumReview) => void; onOpenTarget?: () => void }> = ({ review, onChanged, onOpenTarget }) => {
  const nav = useForumNav();
  const [replyOpen, setReplyOpen] = useState(false);
  const kind = review.target ? REVIEW_KIND_META[review.target.kind] : null;
  const ctx = Object.entries(review.context || {}).filter(([, v]) => !!v);
  const response = review.response;
  const responseMine = !!response && !!(response.responder as any)?.userId && (response.responder as any).userId === nav.me;

  const removeResponse = () =>
    Alert.alert('Delete your reply?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReviewResponse(review.id);
            onChanged({ ...review, response: null });
          } catch (e: any) {
            Alert.alert("Couldn't delete", forumErrorMessage(e));
          }
        },
      },
    ]);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.top}
        onPress={onOpenTarget}
        disabled={!onOpenTarget}
        accessibilityRole={onOpenTarget ? 'button' : undefined}
        accessibilityLabel={`${review.rating} out of 5 stars for ${review.target?.name || 'this'}${onOpenTarget ? '. Open all reviews' : ''}`}
      >
        <Stars value={review.rating} size={18} />
        <View style={{ flex: 1 }}>
          <Text style={FT.h3} numberOfLines={1}>
            {review.target?.name || 'Review'}
          </Text>
          <Text style={FT.small}>
            {kind?.label || 'Review'}
            {review.periodLabel ? ` · ${review.periodLabel}` : ''}
          </Text>
        </View>
      </TouchableOpacity>

      {ctx.length ? (
        <View style={styles.ctxRow}>
          {ctx.map(([k, v]) => (
            <View key={k} style={styles.ctx}>
              <Text style={styles.ctxText}>
                {CONTEXT_LABELS[k] || k}: {String(v)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {review.pros ? (
        <View style={styles.pc}>
          <ThumbsUp size={14} color={FriendsColors.success} />
          <Text style={[FT.body, { flex: 1 }]} selectable>
            {review.pros}
          </Text>
        </View>
      ) : null}
      {review.cons ? (
        <View style={styles.pc}>
          <ThumbsDown size={14} color={FriendsColors.danger} />
          <Text style={[FT.body, { flex: 1 }]} selectable>
            {review.cons}
          </Text>
        </View>
      ) : null}

      {review.underReview ? (
        <View style={styles.pending} accessibilityRole="alert">
          <Hourglass size={14} color={FriendsColors.warn} />
          <Text style={[FT.small, { color: FriendsColors.warn, flex: 1 }]}>
            Under review. A person checks reviews that mention serious allegations before they are published. A low rating alone is never removed.
          </Text>
        </View>
      ) : null}

      {response ? (
        <ResponseView response={response} mine={responseMine} onEdit={() => setReplyOpen(true)} onDelete={removeResponse} />
      ) : mayOfferRightOfReply(nav.roles, review) ? (
        <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md, alignSelf: 'flex-start' }]} onPress={() => setReplyOpen(true)} accessibilityRole="button" accessibilityLabel="Reply to this review">
          <MessageSquareReply size={16} color={FriendsColors.ink} />
          <Text style={fui.ghostBtnText}>Reply to this review</Text>
        </TouchableOpacity>
      ) : null}

      <ResponseSheet
        visible={replyOpen}
        onClose={() => setReplyOpen(false)}
        review={review}
        existing={responseMine ? response : null}
        onSaved={(r) => onChanged({ ...review, response: r })}
      />
    </View>
  );
};

const ResponseView: React.FC<{ response: ForumReviewResponse; mine: boolean; onEdit: () => void; onDelete: () => void }> = ({ response, mine, onEdit, onDelete }) => {
  const role = response.responderRole === 'faculty' ? 'Faculty reply' : response.responderRole === 'official' ? 'Official reply' : 'ZENV team reply';
  return (
    <View style={styles.response} accessible={!mine} accessibilityLabel={`${role} from ${response.responder?.name}: ${response.body}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <ShieldCheck size={14} color={FriendsColors.gold} />
        <Text style={[styles.respRole]}>{role}</Text>
        <Text style={FT.small} numberOfLines={1}>
          · {response.responder?.name}
        </Text>
        <View style={{ flex: 1 }} />
        <RelativeTime value={response.createdAt} />
      </View>
      <Text style={[FT.body, { marginTop: 6 }]} selectable>
        {response.body}
      </Text>
      {mine ? (
        <View style={{ flexDirection: 'row', gap: FS.sm, marginTop: FS.sm }}>
          <TouchableOpacity style={styles.respBtn} onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit your reply">
            <Pencil size={14} color={FriendsColors.ink} />
            <Text style={FT.small}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.respBtn} onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete your reply">
            <Trash2 size={14} color={FriendsColors.danger} />
            <Text style={[FT.small, { color: FriendsColors.danger }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

/** Right of reply composer (one reply per review; the server checks who may reply). */
const ResponseSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  review: ForumReview;
  existing: ForumReviewResponse | null;
  onSaved: (r: ForumReviewResponse) => void;
}> = ({ visible, onClose, review, existing, onSaved }) => {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setBody(existing?.body || '');
    setError(null);
  }, [visible, existing]);

  const len = body.trim().length;
  const valid = len >= FORUM_LIMITS.response.min && len <= FORUM_LIMITS.response.max;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await respondToReview(review.id, body.trim(), !!existing);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved(r.response);
      onClose();
    } catch (e: any) {
      setError(blockedDetails(e) || forumErrorMessage(e, "Couldn't post your reply."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FriendsSheet
      visible={visible}
      onClose={onClose}
      title={existing ? 'Edit your reply' : 'Right of reply'}
      subtitle="Shown under the review with an official label. Keep it factual and respectful."
      icon={<MessageSquareReply size={18} color={FriendsColors.gold} />}
    >
      <TextInput
        style={[fui.input, { minHeight: 140, textAlignVertical: 'top' }]}
        value={body}
        onChangeText={(t) => setBody(t.slice(0, FORUM_LIMITS.response.max))}
        placeholder="Your response to this review"
        placeholderTextColor={FriendsColors.faint}
        multiline
        maxLength={FORUM_LIMITS.response.max}
        accessibilityLabel="Reply text"
        autoFocus
      />
      <Text style={[FT.small, { textAlign: 'right', marginTop: 4 }]}>
        {len}/{FORUM_LIMITS.response.max}
      </Text>
      <Text style={FT.small}>You will not be shown who wrote the review. Please don't try to identify or contact the reviewer.</Text>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <TouchableOpacity
        style={[fui.primaryBtn, { marginTop: FS.md }, (!valid || busy) && { opacity: 0.5 }]}
        onPress={submit}
        disabled={!valid || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy }}
      >
        {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>{existing ? 'Save reply' : 'Post reply'}</Text>}
      </TouchableOpacity>
    </FriendsSheet>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.lineSoft },
  top: { flexDirection: 'row', alignItems: 'center', gap: FS.md, minHeight: 44 },
  ctxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: FS.sm },
  ctx: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: FR.pill, backgroundColor: FriendsColors.card },
  ctxText: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  pc: { flexDirection: 'row', gap: FS.sm, marginTop: FS.sm, alignItems: 'flex-start' },
  pending: { flexDirection: 'row', gap: 6, marginTop: FS.md, padding: FS.sm, borderRadius: FR.sm, backgroundColor: FriendsColors.warnSoft },
  response: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: 'rgba(232,196,127,0.06)', borderWidth: 1, borderColor: 'rgba(232,196,127,0.3)' },
  respRole: { fontSize: 12, fontWeight: '800', color: FriendsColors.gold },
  respBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 10, borderRadius: FR.pill, backgroundColor: FriendsColors.card },
  error: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft, color: FriendsColors.danger, fontSize: 13, fontWeight: '600' },
});
