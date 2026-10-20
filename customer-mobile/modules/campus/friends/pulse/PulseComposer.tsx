import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { KeyboardAvoidingView } from '../../../../components/KeyboardAvoidingView';
import { VenetianMask, BarChart3, Link2, X, Plus, Globe, Users, Lock, BadgeCheck, Send, Hash, CornerDownRight } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import type { UploadedImage } from '../../../../utils/imageUpload';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsScreenModal } from '../shared/FriendsSheet';
import { ImagePickerRow } from '../shared/ImagePickerRow';
import { IdentityChip } from '../shared/IdentityChip';
import { fetchFriendsSettings, isGateError, newClientId } from '../api/core';
import {
  PULSE_LIMITS,
  PULSE_POLL_DURATIONS,
  PulseEntityOption,
  PulsePost,
  PulseReplyPolicy,
  createPulsePost,
  fetchManagedEntities,
  pulseLength,
  updatePulsePost,
} from '../api/pulseApi';
import { linksIn, pulseBus, pulseErrorMessage, tagsIn } from './pulseShared';
import type { PulseComposerRequest } from './pulseNav';
import { useRetentionPolicy, daysLabel } from '../../useRetentionPolicy';

interface Draft {
  text: string;
  images: UploadedImage[];
  link: string;
  showLink: boolean;
  pollOn: boolean;
  pollOptions: string[];
  pollHours: number;
  anonymous: boolean;
  replyPolicy: PulseReplyPolicy;
  entityId: string | null;
  /** Kept until the post is created, so a retry after a timeout returns the same post. */
  clientId: string;
}

const blankDraft = (anonymous: boolean): Draft => ({
  text: '',
  images: [],
  link: '',
  showLink: false,
  pollOn: false,
  pollOptions: ['', ''],
  pollHours: PULSE_LIMITS.pollHours.default,
  anonymous,
  replyPolicy: 'everyone',
  entityId: null,
  clientId: newClientId(),
});

// Unsent drafts survive closing the composer (new post, and one per reply target).
const drafts = new Map<string, Draft>();
let defaultAnon: boolean | null = null;

const mediaIdOf = (img: UploadedImage): string | null => {
  if (img.id) return img.id;
  const m = /\/api\/campus\/media\/([0-9a-f-]{36})/i.exec(img.url || img.absoluteUrl || '');
  return m ? m[1] : null;
};

const POLICIES: { key: PulseReplyPolicy; label: string; hint: string; icon: typeof Globe }[] = [
  { key: 'everyone', label: 'Everyone', hint: 'Any verified student on your campus can reply', icon: Globe },
  { key: 'following', label: 'People I follow', hint: 'Only people you follow can reply', icon: Users },
  { key: 'none', label: 'No one', hint: 'Replies are off', icon: Lock },
];

/**
 * Pulse composer: new post (280 characters, up to 4 photos, one link, an optional poll, reply
 * setting, anonymous or as a verified club), reply (text, photos, link, anonymous) or edit (text).
 * The server re-checks everything; its reasons are shown as they come.
 */
export const PulseComposer: React.FC<{
  request: PulseComposerRequest | null;
  onClose: () => void;
  onPublished: (post: PulsePost, info: { edited: boolean; underReview: boolean; reply: boolean }) => void;
  onGateError: (e: any) => void;
}> = ({ request, onClose, onPublished, onGateError }) => {
  const visible = !!request;
  const edit = request?.edit || null;
  const replyTo = request?.replyTo || null;
  const draftKey = edit ? null : replyTo ? `reply:${replyTo.id}` : 'post';

  const [d, setD] = useState<Draft>(() => blankDraft(false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<PulseEntityOption[]>([]);
  const inputRef = useRef<TextInput>(null);
  const retention = useRetentionPolicy();

  // Fresh state for every request (restore a saved draft, or prefill / edit text).
  useEffect(() => {
    if (!request) return;
    setError(null);
    setBusy(false);
    if (edit) {
      setD({ ...blankDraft(false), text: edit.text || '' });
    } else {
      const saved = draftKey ? drafts.get(draftKey) : undefined;
      const base = saved || blankDraft(defaultAnon ?? false);
      setD(request.prefill && !saved?.text ? { ...base, text: request.prefill } : base);
      if (defaultAnon === null) {
        fetchFriendsSettings()
          .then((s) => {
            defaultAnon = !!s.defaultAnonymous;
            if (!saved) setD((prev) => (prev.text || prev.images.length ? prev : { ...prev, anonymous: defaultAnon! }));
          })
          .catch(() => {});
      }
      if (!replyTo) {
        fetchManagedEntities()
          .then((list) => setEntities(list.filter((e) => e.verified !== false)))
          .catch(() => setEntities([]));
      }
    }
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember unsent drafts.
  useEffect(() => {
    if (!visible || !draftKey) return;
    if (d.text || d.images.length || d.link || d.pollOn) drafts.set(draftKey, d);
    else drafts.delete(draftKey);
  }, [d, visible, draftKey]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setError(null);
    setD((prev) => ({ ...prev, [k]: v }));
  };

  const len = pulseLength(d.text);
  const over = len > PULSE_LIMITS.text;
  const textLinks = useMemo(() => linksIn(d.text), [d.text]);
  const tags = useMemo(() => tagsIn(d.text), [d.text]);
  const linkCount = textLinks.length + (d.showLink && d.link.trim() ? 1 : 0);
  const pollOpts = d.pollOptions.map((o) => o.trim());
  const pollValid =
    !d.pollOn ||
    (pollOpts.filter(Boolean).length === pollOpts.length &&
      pollOpts.length >= PULSE_LIMITS.pollOptions.min &&
      new Set(pollOpts.map((o) => o.toLowerCase())).size === pollOpts.length &&
      pollOpts.every((o) => Array.from(o).length <= PULSE_LIMITS.pollLabel));
  const hasBody = !!d.text.trim() || (!edit && d.images.length > 0);
  const valid = !busy && hasBody && !over && pollValid && (!d.pollOn || !!d.text.trim()) && linkCount <= 1 && (edit ? d.text.trim() !== (edit.text || '').trim() : true);

  const hint = (() => {
    if (over) return `Keep it to ${PULSE_LIMITS.text} characters.`;
    if (!hasBody) return edit ? 'Write something.' : 'Write something or add a photo.';
    if (d.pollOn && !d.text.trim()) return 'A poll needs a question.';
    if (!pollValid) return 'Poll options must be filled in, different, and up to 40 characters.';
    if (linkCount > 1) return 'Only one link per post.';
    if (tags.length > PULSE_LIMITS.hashtagsPerPost) return `Only the first ${PULSE_LIMITS.hashtagsPerPost} hashtags count.`;
    return null;
  })();

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      if (edit) {
        const r = await updatePulsePost(edit.id, d.text.trim());
        pulseBus.emitPost(r.post);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onPublished(r.post, { edited: true, underReview: r.underReview, reply: r.post.kind === 'reply' });
        onClose();
        return;
      }
      const mediaIds = d.images.map(mediaIdOf).filter((x): x is string => !!x);
      if (mediaIds.length !== d.images.length) {
        setError('A photo is still uploading or failed. Remove it and add it again.');
        return;
      }
      const r = await createPulsePost({
        text: d.text.trim(),
        mediaIds,
        link: d.showLink && d.link.trim() ? d.link.trim() : null,
        poll: !replyTo && d.pollOn ? { options: pollOpts, durationHours: d.pollHours } : null,
        replyPolicy: replyTo ? undefined : d.replyPolicy,
        anonymous: d.entityId ? false : d.anonymous,
        parentId: replyTo?.id || null,
        entityId: replyTo ? null : d.entityId,
        clientId: d.clientId,
      });
      if (draftKey) drafts.delete(draftKey);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      pulseBus.emitCreated(r.post);
      onPublished(r.post, { edited: false, underReview: r.underReview, reply: !!replyTo });
      onClose();
      if (r.underReview) {
        Alert.alert(
          'Posted for review',
          'Our safety check asked a person to look at this before others can see it. You can see it under My posts. If you or someone you know is struggling, Me › Friends privacy & safety lists helplines.'
        );
      }
    } catch (e: any) {
      if (isGateError(e)) onGateError(e);
      setError(pulseErrorMessage(e, "Couldn't post that. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const title = edit ? 'Edit post' : replyTo ? 'Reply' : 'New post';
  const counterColor = over ? FriendsColors.danger : len > PULSE_LIMITS.text - 20 ? FriendsColors.warn : FriendsColors.faint;
  const asEntity = entities.find((e) => e.id === d.entityId) || null;

  return (
    <FriendsScreenModal
      avoidKeyboard={false}
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={replyTo ? 'Replies follow the post’s reply setting' : 'Friends › Pulse'}
      right={
        <TouchableOpacity
          style={[styles.publish, !valid && { opacity: 0.45 }]}
          onPress={submit}
          disabled={!valid}
          accessibilityRole="button"
          accessibilityLabel={edit ? 'Save' : replyTo ? 'Send reply' : 'Post'}
          accessibilityState={{ disabled: !valid, busy }}
        >
          {busy ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <Text style={styles.publishText}>{edit ? 'Save' : replyTo ? 'Reply' : 'Post'}</Text>}
        </TouchableOpacity>
      }
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: FS.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          {replyTo ? (
            <View style={styles.parent}>
              <IdentityChip identity={replyTo.author} time={replyTo.createdAt} size="sm" />
              {replyTo.text ? (
                <Text style={[FT.muted, { marginTop: 4 }]} numberOfLines={3}>
                  {replyTo.text}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                <CornerDownRight size={12} color={FriendsColors.faint} />
                <Text style={FT.small}>Your reply</Text>
              </View>
            </View>
          ) : null}

          <TextInput
            ref={inputRef}
            style={styles.input}
            value={d.text}
            onChangeText={(t) => set('text', t)}
            multiline
            placeholder={replyTo ? 'Write your reply' : edit ? 'Edit your post' : "What's happening on campus?"}
            placeholderTextColor={FriendsColors.faint}
            accessibilityLabel={replyTo ? 'Reply text' : 'Post text'}
            accessibilityHint={`Up to ${PULSE_LIMITS.text} characters. Use # for hashtags.`}
          />
          <View style={styles.counterRow}>
            {tags.length ? (
              <View style={styles.tagHint}>
                <Hash size={12} color={FriendsColors.accent} />
                <Text style={[FT.small, { color: FriendsColors.accent }]} numberOfLines={1}>
                  {tags.slice(0, PULSE_LIMITS.hashtagsPerPost).join(', ')}
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Text style={[styles.counter, { color: counterColor }]} accessibilityLabel={`${len} of ${PULSE_LIMITS.text} characters`}>
              {PULSE_LIMITS.text - len}
            </Text>
          </View>
          <Text style={[FT.small, { marginTop: 4 }]}>
            {replyTo
              ? `Replies are removed with the thread, ${daysLabel(retention.pulseDays)} after the first post.`
              : `Posts are removed after ${daysLabel(retention.pulseDays)}.`}
          </Text>

          {!edit ? (
            <>
              <Text style={styles.label}>Photos (up to {PULSE_LIMITS.media})</Text>
              <ImagePickerRow value={d.images} onChange={(v) => set('images', v)} purpose="post" max={PULSE_LIMITS.media} />

              <View style={styles.toolRow}>
                <TouchableOpacity
                  style={[fui.pill, d.showLink && fui.pillActive]}
                  onPress={() => set('showLink', !d.showLink)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: d.showLink }}
                  accessibilityLabel="Add a link"
                >
                  <Link2 size={14} color={d.showLink ? FriendsColors.accentInk : FriendsColors.muted} />
                  <Text style={[fui.pillText, d.showLink && fui.pillTextActive]}>Link</Text>
                </TouchableOpacity>
                {!replyTo ? (
                  <TouchableOpacity
                    style={[fui.pill, d.pollOn && fui.pillActive]}
                    onPress={() => set('pollOn', !d.pollOn)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: d.pollOn }}
                    accessibilityLabel="Add a poll"
                  >
                    <BarChart3 size={14} color={d.pollOn ? FriendsColors.accentInk : FriendsColors.muted} />
                    <Text style={[fui.pillText, d.pollOn && fui.pillTextActive]}>Poll</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {d.showLink ? (
                <View style={{ marginTop: FS.sm }}>
                  <TextInput
                    style={fui.input}
                    value={d.link}
                    onChangeText={(t) => set('link', t)}
                    placeholder="https://"
                    placeholderTextColor={FriendsColors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    accessibilityLabel="Link"
                  />
                  <Text style={[FT.small, { marginTop: 4 }]}>One link per post (a link typed in the text counts too).</Text>
                </View>
              ) : null}

              {!replyTo && d.pollOn ? (
                <View style={styles.pollBox}>
                  <Text style={[FT.h3, { marginBottom: FS.sm }]}>Poll</Text>
                  {d.pollOptions.map((o, i) => (
                    <View key={i} style={styles.pollRow}>
                      <TextInput
                        style={[fui.input, { flex: 1 }]}
                        value={o}
                        onChangeText={(t) => set('pollOptions', d.pollOptions.map((x, j) => (j === i ? t : x)))}
                        placeholder={`Option ${i + 1}`}
                        placeholderTextColor={FriendsColors.faint}
                        maxLength={PULSE_LIMITS.pollLabel}
                        accessibilityLabel={`Poll option ${i + 1}`}
                      />
                      {d.pollOptions.length > PULSE_LIMITS.pollOptions.min ? (
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => set('pollOptions', d.pollOptions.filter((_, j) => j !== i))}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove option ${i + 1}`}
                        >
                          <X size={16} color={FriendsColors.muted} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))}
                  {d.pollOptions.length < PULSE_LIMITS.pollOptions.max ? (
                    <TouchableOpacity style={[fui.ghostBtn, { alignSelf: 'flex-start' }]} onPress={() => set('pollOptions', [...d.pollOptions, ''])} accessibilityRole="button">
                      <Plus size={14} color={FriendsColors.ink} />
                      <Text style={fui.ghostBtnText}>Add option</Text>
                    </TouchableOpacity>
                  ) : null}
                  <Text style={[styles.label, { marginTop: FS.md }]}>Poll length</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
                    {PULSE_POLL_DURATIONS.map((o) => {
                      const on = o.hours === d.pollHours;
                      return (
                        <TouchableOpacity
                          key={o.hours}
                          style={[fui.pill, on && fui.pillActive]}
                          onPress={() => set('pollHours', o.hours)}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={`Poll length ${o.label}`}
                        >
                          <Text style={[fui.pillText, on && fui.pillTextActive]}>{o.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {!replyTo && entities.length ? (
                <>
                  <Text style={styles.label}>Post as</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
                    <TouchableOpacity
                      style={[fui.pill, !d.entityId && fui.pillActive]}
                      onPress={() => set('entityId', null)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: !d.entityId }}
                      accessibilityLabel="Post as yourself"
                    >
                      <Text style={[fui.pillText, !d.entityId && fui.pillTextActive]}>Me</Text>
                    </TouchableOpacity>
                    {entities.map((e) => {
                      const on = d.entityId === e.id;
                      return (
                        <TouchableOpacity
                          key={e.id}
                          style={[fui.pill, on && fui.pillActive]}
                          onPress={() => setD((prev) => ({ ...prev, entityId: e.id, anonymous: false }))}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={`Post as ${e.name}`}
                        >
                          <BadgeCheck size={13} color={on ? FriendsColors.accentInk : FriendsColors.gold} />
                          <Text style={[fui.pillText, on && fui.pillTextActive]}>{e.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              ) : null}

              {!replyTo ? (
                <>
                  <Text style={styles.label}>Who can reply</Text>
                  <View style={{ gap: FS.sm }}>
                    {POLICIES.map((p) => {
                      const on = d.replyPolicy === p.key;
                      const disabled = p.key === 'following' && d.anonymous && !d.entityId;
                      const Icon = p.icon;
                      return (
                        <TouchableOpacity
                          key={p.key}
                          style={[styles.policy, on && styles.policyOn, disabled && { opacity: 0.4 }]}
                          onPress={() => set('replyPolicy', p.key)}
                          disabled={disabled}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on, disabled }}
                          accessibilityLabel={`${p.label}. ${disabled ? 'Not available for anonymous posts' : p.hint}`}
                        >
                          <Icon size={16} color={on ? FriendsColors.accent : FriendsColors.muted} />
                          <View style={{ flex: 1 }}>
                            <Text style={[FT.h3, { fontSize: 14 }]}>{p.label}</Text>
                            <Text style={FT.small}>{disabled ? 'Not available when posting anonymously' : p.hint}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              ) : null}

              {!d.entityId ? (
                <View style={styles.anonRow}>
                  <VenetianMask size={18} color={d.anonymous ? FriendsColors.accent : FriendsColors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={FT.h3}>{replyTo ? 'Reply anonymously' : 'Post anonymously'}</Text>
                    <Text style={FT.small}>
                      Others see an alias that stays the same in this conversation and changes in others. Anonymous posts don't show in Following and can't be reposted. Rules,
                      limits and reports still apply.
                    </Text>
                  </View>
                  <Switch
                    value={d.anonymous}
                    onValueChange={(v) => setD((prev) => ({ ...prev, anonymous: v, replyPolicy: v && prev.replyPolicy === 'following' ? 'everyone' : prev.replyPolicy }))}
                    trackColor={{ true: FriendsColors.accent, false: FriendsColors.line }}
                    thumbColor={FriendsColors.ink}
                    accessibilityLabel={replyTo ? 'Reply anonymously' : 'Post anonymously'}
                  />
                </View>
              ) : (
                <View style={styles.anonRow}>
                  <BadgeCheck size={18} color={FriendsColors.gold} />
                  <Text style={[FT.small, { flex: 1 }]}>Posting as {asEntity?.name}. Club and official posts always show their name.</Text>
                </View>
              )}
            </>
          ) : (
            <Text style={[FT.small, { marginTop: FS.md }]}>Only the text can be edited. Edits are recorded and the post shows “Edited”.</Text>
          )}

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[fui.primaryBtn, { marginTop: FS.xl }, !valid && { opacity: 0.45 }]}
            onPress={submit}
            disabled={!valid}
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid, busy }}
          >
            {busy ? (
              <ActivityIndicator color={FriendsColors.accentInk} />
            ) : (
              <>
                <Send size={17} color={FriendsColors.accentInk} />
                <Text style={fui.primaryBtnText}>{edit ? 'Save changes' : replyTo ? 'Send reply' : 'Post to Pulse'}</Text>
              </>
            )}
          </TouchableOpacity>
          {hint && !busy ? <Text style={[FT.small, { textAlign: 'center', marginTop: FS.sm }]}>{hint}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </FriendsScreenModal>
  );
};

const styles = StyleSheet.create({
  publish: { minHeight: 38, paddingHorizontal: 18, borderRadius: FR.pill, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center', marginRight: FS.sm },
  publishText: { fontSize: 14, fontWeight: '800', color: FriendsColors.accentInk },
  parent: { padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.lineSoft, marginBottom: FS.md },
  input: { minHeight: 120, fontSize: 17, lineHeight: 24, color: FriendsColors.ink, textAlignVertical: 'top', paddingVertical: 4 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, paddingBottom: FS.sm, borderBottomWidth: 1, borderBottomColor: FriendsColors.lineSoft },
  tagHint: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  counter: { fontSize: 13, fontWeight: '800', minWidth: 36, textAlign: 'right' },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: FriendsColors.muted, textTransform: 'uppercase', marginTop: FS.lg, marginBottom: 6 },
  toolRow: { flexDirection: 'row', gap: FS.sm, marginTop: FS.md },
  pollBox: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, borderWidth: 1, borderColor: FriendsColors.line, backgroundColor: FriendsColors.card },
  pollRow: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginBottom: FS.sm },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  policy: { flexDirection: 'row', alignItems: 'center', gap: FS.md, minHeight: 52, padding: FS.md, borderRadius: FR.md, borderWidth: 1, borderColor: FriendsColors.line, backgroundColor: FriendsColors.card },
  policyOn: { borderColor: FriendsColors.accent, backgroundColor: FriendsColors.accentSoft },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: FS.md, marginTop: FS.xl, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line },
  error: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft, color: FriendsColors.danger, fontSize: 13, fontWeight: '600' },
});
