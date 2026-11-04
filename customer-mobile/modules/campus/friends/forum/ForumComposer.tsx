import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Alert, Switch, Platform } from 'react-native';
import { KeyboardAvoidingView } from '../../../../components/KeyboardAvoidingView';
import { VenetianMask, Plus, X, Link2, Search, Check, ShieldAlert, Info } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsScreenModal } from '../shared/FriendsSheet';
import { ImagePickerRow } from '../shared/ImagePickerRow';
import { newClientId, errorCode } from '../api/core';
import type { UploadedImage } from '../../../../utils/imageUpload';
import {
  ForumCommunity,
  ForumPost,
  ForumPostType,
  ReviewKind,
  ReviewTarget,
  ReviewContext,
  REVIEW_KINDS,
  FORUM_LIMITS,
  createForumPost,
  updateForumPost,
  updateReview,
  fetchReviewTargets,
  requestReviewTarget,
} from '../api/forumApi';
import { StarPicker } from './Stars';
import { POST_TYPE_META, REVIEW_KIND_META, REVIEW_CONTEXT_FIELDS, blockedDetails, forumBus, forumErrorMessage, communityIcon } from './forumShared';
import type { ComposerRequest } from './forumNav';

type Draft = {
  communityId: string | null;
  type: ForumPostType;
  title: string;
  body: string;
  images: UploadedImage[];
  links: string[];
  anonymous: boolean;
  target: ReviewTarget | null;
  rating: number;
  pros: string;
  cons: string;
  period: string;
  context: ReviewContext;
  clientId: string;
};

/** Unsent drafts survive closing the composer (per app session). */
let savedDraft: Draft | null = null;

const emptyDraft = (communityId: string | null, type: ForumPostType): Draft => ({
  communityId,
  type,
  title: '',
  body: '',
  images: [],
  links: [],
  anonymous: false,
  target: null,
  rating: 0,
  pros: '',
  cons: '',
  period: '',
  context: {},
  clientId: newClientId(),
});

const mediaIdOf = (img: UploadedImage): string | null => {
  if (img.id) return img.id;
  const m = /\/api\/campus\/media\/([0-9a-f-]{36})/i.exec(img.url || img.absoluteUrl || '');
  return m ? m[1] : null;
};

const REVIEW_HOME: Record<ReviewKind, string> = {
  professor: 'faculty-reviews',
  course: 'academics',
  hostel: 'hostel-food',
  mess: 'hostel-food',
  club: 'clubs',
  placement: 'placements',
};

/** Where a review of this kind is posted: its default community, else any community that takes reviews. */
const reviewCommunityFor = (kind: ReviewKind, list: ForumCommunity[]) =>
  list.find((c) => c.slug === REVIEW_HOME[kind] && c.allowedTypes.includes('review')) || list.find((c) => c.allowedTypes.includes('review')) || null;

const isHttpUrl =(s: string) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s.trim());

/**
 * Create or edit a Forum post. Types follow the community's allowed list; Review adds the structured
 * fields (target search, rating, pros / cons, period, context) and is always anonymous. Freshers
 * Guides (moderators) are guidance posts pinned with a "Student advice" label.
 */
export const ForumComposer: React.FC<{
  request: ComposerRequest | null;
  communities: ForumCommunity[];
  onClose: () => void;
  onPublished: (post: ForumPost, opts: { edited: boolean }) => void;
  onGateError: (e: any) => void;
  onOpenPost: (postId: string) => void;
  onOpenTarget: (targetId: string) => void;
}> = ({ request, communities, onClose, onPublished, onGateError, onOpenPost, onOpenTarget }) => {
  const edit = request?.edit || null;
  const isGuide = !!request?.freshersGuide;
  const postable = useMemo(() => communities.filter((c) => c.status === 'active'), [communities]);
  const [d, setD] = useState<Draft>(() => emptyDraft(null, 'discussion'));
  const [linkInput, setLinkInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Target search
  const [kind, setKind] = useState<ReviewKind>('course');
  const [q, setQ] = useState('');
  const [targets, setTargets] = useState<ReviewTarget[]>([]);
  const [tLoading, setTLoading] = useState(false);
  const [tError, setTError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  // Initialise for each request.
  useEffect(() => {
    if (!request) return;
    setError(null);
    setLinkInput('');
    if (request.edit) {
      const p = request.edit;
      const rv = p.review;
      setD({
        communityId: p.communityId,
        type: p.type,
        title: p.title,
        body: p.body || '',
        images: p.media.map((m) => ({ url: m.url, absoluteUrl: m.url, localUri: '', id: m.mediaId })),
        links: p.links.map((l) => l.url),
        anonymous: !!(p.author as any)?.anonymous,
        target: rv?.target ? ({ id: rv.target.id, kind: rv.target.kind, name: rv.target.name, meta: {}, status: 'active', reviewCount: 0, average: null } as ReviewTarget) : null,
        rating: rv?.rating || 0,
        pros: rv?.pros || '',
        cons: rv?.cons || '',
        period: rv?.periodLabel || '',
        context: rv?.context || {},
        clientId: newClientId(),
      });
      return;
    }
    const reviewHome = request.reviewTarget
      ? reviewCommunityFor(request.reviewTarget.kind, postable)
      : request.type === 'review' && !request.community
      ? reviewCommunityFor('course', postable)
      : null;
    const communityId = request.community?.id || reviewHome?.id || (savedDraft?.communityId ?? null) || postable[0]?.id || null;
    const type: ForumPostType = request.freshersGuide ? 'guidance' : request.reviewTarget ? 'review' : request.type || 'question';
    const reuse = !!savedDraft && !request.freshersGuide && !request.type && !request.reviewTarget && (!request.community || savedDraft.communityId === request.community.id);
    const base = reuse ? (savedDraft as Draft) : emptyDraft(communityId, type);
    setD({
      ...base,
      communityId: base.communityId || communityId,
      type: reuse ? base.type : type,
      target: request.reviewTarget || base.target,
    });
    if (request.reviewTarget) setKind(request.reviewTarget.kind);
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  const community = communities.find((c) => c.id === d.communityId) || request?.community || null;
  const allowed = community ? community.allowedTypes : [];
  const isReview = d.type === 'review';
  const anonAllowed = !!community?.allowAnonymous && !isGuide;
  const anonymous = isReview ? true : anonAllowed && d.anonymous;

  // A type the community doesn't take (switching communities): fall back to the first allowed one.
  useEffect(() => {
    if (!request || edit || !community || isGuide) return;
    if (!allowed.includes(d.type)) setD((x) => ({ ...x, type: allowed.includes('question') ? 'question' : allowed[0] || 'discussion' }));
  }, [community?.id, request]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep an unsent new-post draft.
  useEffect(() => {
    if (!request || edit || isGuide) return;
    savedDraft = d;
  }, [d, request, edit, isGuide]);

  // Target search (debounced).
  useEffect(() => {
    if (!request || !isReview || edit) return;
    let alive = true;
    setTLoading(true);
    setTError(null);
    const t = setTimeout(() => {
      fetchReviewTargets({ kind, q: q.trim() || undefined })
        .then((r) => alive && setTargets(r.items))
        .catch((e) => alive && setTError(forumErrorMessage(e, "Couldn't search.")))
        .finally(() => alive && setTLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [kind, q, isReview, request, edit]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const addLink = () => {
    const url = linkInput.trim();
    if (!url) return;
    if (!isHttpUrl(url)) {
      setError('Links must start with http:// or https://');
      return;
    }
    if (d.links.length >= FORUM_LIMITS.links) return;
    if (!d.links.includes(url)) set('links', [...d.links, url]);
    setLinkInput('');
    setError(null);
  };

  const askForTarget = async () => {
    const name = q.trim();
    if (name.length < 2 || requesting) return;
    setRequesting(true);
    try {
      const r = await requestReviewTarget({ kind, name });
      Alert.alert(
        r.duplicate ? 'Already requested' : 'Request sent',
        kind === 'professor'
          ? 'Professor pages are added by the ZENV team after a check. You can review once it is approved.'
          : 'The ZENV team will review it shortly. You can post your review once it is approved.'
      );
    } catch (e: any) {
      if (errorCode(e) === 'TARGET_EXISTS' && e?.data?.targetId) {
        setTError('That page already exists. Search for it above.');
      } else {
        setTError(blockedDetails(e) || forumErrorMessage(e, "Couldn't send the request."));
      }
    } finally {
      setRequesting(false);
    }
  };

  const titleLen = d.title.trim().length;
  const reviewReady = !isReview || (!!d.target && d.rating >= 1);
  const typeOk = !!edit || allowed.includes(d.type);
  const valid = !!community && typeOk && titleLen >= FORUM_LIMITS.title.min && titleLen <= FORUM_LIMITS.title.max && reviewReady && !busy;

  const submit = async () => {
    if (!valid || !community) return;
    setBusy(true);
    setError(null);
    const mediaIds = d.images.map(mediaIdOf).filter((x): x is string => !!x);
    const context = Object.fromEntries(Object.entries(d.context).filter(([, v]) => !!v && String(v).trim())) as ReviewContext;
    try {
      if (edit) {
        let res: { post: ForumPost; underReview: boolean };
        if (edit.review) {
          res = await updateReview(edit.review.id, {
            rating: d.rating,
            pros: d.pros.trim(),
            cons: d.cons.trim(),
            periodLabel: d.period.trim(),
            context,
            title: d.title.trim(),
            body: d.body.trim(),
          });
        } else {
          res = await updateForumPost(edit.id, { title: d.title.trim(), body: d.body.trim(), links: d.links, mediaIds });
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        forumBus.emitPost(res.post);
        onPublished(res.post, { edited: true });
        if (res.underReview) Alert.alert('Sent for review', 'Your changes will be visible once they are checked.');
        onClose();
        return;
      }
      const r = await createForumPost(community.id, {
        type: d.type,
        title: d.title.trim(),
        body: d.body.trim() || undefined,
        mediaIds: mediaIds.length ? mediaIds : undefined,
        links: d.links.length ? d.links : undefined,
        anonymous,
        freshersGuide: isGuide || undefined,
        clientId: d.clientId,
        review: isReview && d.target
          ? { targetId: d.target.id, rating: d.rating, pros: d.pros.trim() || undefined, cons: d.cons.trim() || undefined, periodLabel: d.period.trim() || undefined, context }
          : undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (!isGuide) savedDraft = null;
      onPublished(r.post, { edited: false });
      if (r.underReview) {
        Alert.alert(
          'Sent for review',
          isReview
            ? 'Reviews that mention serious allegations are checked by a person before they are published. Your rating is never removed just for being low.'
            : 'A moderator will check your post before it appears to others.'
        );
      }
      onClose();
    } catch (e: any) {
      onGateError(e);
      const code = errorCode(e);
      if (code === 'REVIEW_EXISTS' && d.target) {
        Alert.alert('You already reviewed this', 'You can edit your existing review instead.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open reviews', onPress: () => { onClose(); onOpenTarget(d.target!.id); } },
        ]);
      } else if (code === 'GUIDE_EXISTS' && e?.data?.postId) {
        Alert.alert('Guide already exists', 'This community already has a Freshers Guide. Open it to edit.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open guide', onPress: () => { onClose(); onOpenPost(e.data.postId); } },
        ]);
      } else {
        setError(blockedDetails(e) || forumErrorMessage(e, "Couldn't publish. Please try again."));
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
      }
    } finally {
      setBusy(false);
    }
  };

  const typeMeta = POST_TYPE_META[d.type];
  const title = edit ? (edit.review ? 'Edit review' : 'Edit post') : isGuide ? 'Freshers Guide' : 'New post';

  return (
    <FriendsScreenModal
      avoidKeyboard={false}
      visible={!!request}
      onClose={onClose}
      title={title}
      subtitle={community ? community.name : undefined}
      right={
        <TouchableOpacity
          style={[styles.publish, !valid && { opacity: 0.45 }]}
          onPress={submit}
          disabled={!valid}
          accessibilityRole="button"
          accessibilityLabel={edit ? 'Save changes' : 'Publish post'}
          accessibilityState={{ disabled: !valid, busy }}
        >
          {busy ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>{edit ? 'Save' : 'Post'}</Text>}
        </TouchableOpacity>
      }
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: FS.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          {/* Community */}
          {!edit && !request?.community && !isGuide ? (
            <>
              <Text style={styles.label}>Community</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
                {postable.map((c) => {
                  const on = c.id === d.communityId;
                  const Icon = communityIcon(c);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[fui.pill, on && fui.pillActive]}
                      onPress={() => set('communityId', c.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={c.name}
                    >
                      <Icon size={13} color={on ? FriendsColors.accentInk : FriendsColors.muted} />
                      <Text style={[fui.pillText, on && fui.pillTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {/* Type */}
          {!edit && !isGuide && community ? (
            <>
              <Text style={styles.label}>Kind of post</Text>
              <View style={styles.typeGrid} accessibilityRole="radiogroup">
                {allowed.map((t) => {
                  const m = POST_TYPE_META[t];
                  const Icon = m.icon;
                  const on = d.type === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.typeCell, on && styles.typeOn]}
                      onPress={() => set('type', t)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${m.label}. ${m.hint}`}
                    >
                      <Icon size={16} color={on ? FriendsColors.accent : FriendsColors.muted} />
                      <Text style={[styles.typeText, on && { color: FriendsColors.ink }]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[FT.small, { marginTop: 6 }]}>{typeMeta.hint}</Text>
            </>
          ) : null}

          {isGuide ? (
            <View style={styles.infoBox}>
              <Info size={14} color={FriendsColors.accent} />
              <Text style={[FT.small, { flex: 1 }]}>
                The guide is pinned at the top of {community?.name || 'the community'} and labelled Student advice. Share what you know from experience; don't state
                rules or policies the college hasn't published.
              </Text>
            </View>
          ) : null}

          {/* Review fields */}
          {isReview ? (
            <View style={{ marginTop: FS.md }}>
              <View style={styles.infoBox}>
                <ShieldAlert size={14} color={FriendsColors.accent} />
                <Text style={[FT.small, { flex: 1 }]}>
                  Reviews are always anonymous. Describe your own experience. No phone numbers, room numbers or personal attacks; serious allegations are checked by a person
                  first.
                </Text>
              </View>

              <Text style={styles.label}>What are you reviewing?</Text>
              {d.target ? (
                <View style={styles.targetPicked}>
                  <View style={{ flex: 1 }}>
                    <Text style={FT.h3}>{d.target.name}</Text>
                    <Text style={FT.small}>{REVIEW_KIND_META[d.target.kind]?.label}</Text>
                  </View>
                  {!edit ? (
                    <TouchableOpacity onPress={() => set('target', null)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Change what you are reviewing">
                      <X size={18} color={FriendsColors.muted} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
                    {REVIEW_KINDS.map((k) => {
                      const on = k === kind;
                      return (
                        <TouchableOpacity key={k} style={[fui.pill, on && fui.pillActive]} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                          <Text style={[fui.pillText, on && fui.pillTextActive]}>{REVIEW_KIND_META[k].label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <View style={[fui.input, styles.searchBox]}>
                    <Search size={16} color={FriendsColors.faint} />
                    <TextInput
                      style={styles.searchInput}
                      value={q}
                      onChangeText={setQ}
                      placeholder={`Search ${REVIEW_KIND_META[kind].plural.toLowerCase()}`}
                      placeholderTextColor={FriendsColors.faint}
                      accessibilityLabel={`Search ${REVIEW_KIND_META[kind].plural}`}
                    />
                  </View>
                  {tLoading ? <ActivityIndicator color={FriendsColors.accent} style={{ marginTop: FS.md }} /> : null}
                  {tError ? <Text style={[FT.small, { color: FriendsColors.danger, marginTop: FS.sm }]}>{tError}</Text> : null}
                  {!tLoading && targets.length ? (
                    <View style={[fui.card, { marginTop: FS.sm }]}>
                      {targets.slice(0, 8).map((t, i) => (
                        <TouchableOpacity
                          key={t.id}
                          style={[fui.row, i === Math.min(targets.length, 8) - 1 && { borderBottomWidth: 0 }]}
                          onPress={() => set('target', t)}
                          accessibilityRole="button"
                          accessibilityLabel={`Review ${t.name}`}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={FT.h3}>{t.name}</Text>
                            <Text style={FT.small}>
                              {[t.meta?.code, t.meta?.department, t.meta?.block].filter(Boolean).join(' · ') || REVIEW_KIND_META[t.kind].label}
                              {t.reviewCount ? ` · ${t.reviewCount} reviews` : ''}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                  {!tLoading && !targets.length && !tError ? (
                    <Text style={[FT.small, { marginTop: FS.sm }]}>{q.trim() ? 'No match.' : `No ${REVIEW_KIND_META[kind].plural.toLowerCase()} listed yet.`}</Text>
                  ) : null}
                  {q.trim().length >= 2 ? (
                    <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.sm, alignSelf: 'flex-start' }]} onPress={askForTarget} disabled={requesting} accessibilityRole="button">
                      {requesting ? <ActivityIndicator size="small" color={FriendsColors.ink} /> : <Plus size={14} color={FriendsColors.ink} />}
                      <Text style={fui.ghostBtnText} numberOfLines={1}>
                        Request a page for "{q.trim().slice(0, 30)}"
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}

              <Text style={styles.label}>Your rating</Text>
              <StarPicker value={d.rating} onChange={(v) => set('rating', v)} />

              <Text style={styles.label}>What was good (optional)</Text>
              <TextInput
                style={[fui.input, styles.multi]}
                value={d.pros}
                onChangeText={(t) => set('pros', t.slice(0, FORUM_LIMITS.pros))}
                multiline
                maxLength={FORUM_LIMITS.pros}
                placeholder="Clear explanations, fair grading…"
                placeholderTextColor={FriendsColors.faint}
                accessibilityLabel="Pros"
              />
              <Text style={styles.label}>What could be better (optional)</Text>
              <TextInput
                style={[fui.input, styles.multi]}
                value={d.cons}
                onChangeText={(t) => set('cons', t.slice(0, FORUM_LIMITS.cons))}
                multiline
                maxLength={FORUM_LIMITS.cons}
                placeholder="Fast pace, few office hours…"
                placeholderTextColor={FriendsColors.faint}
                accessibilityLabel="Cons"
              />
              <Text style={styles.label}>When (optional)</Text>
              <TextInput
                style={fui.input}
                value={d.period}
                onChangeText={(t) => set('period', t.slice(0, FORUM_LIMITS.period))}
                maxLength={FORUM_LIMITS.period}
                placeholder="e.g. Odd sem 2025"
                placeholderTextColor={FriendsColors.faint}
                accessibilityLabel="Period"
              />
              {d.target
                ? REVIEW_CONTEXT_FIELDS[d.target.kind].map((f) => (
                    <View key={f.key}>
                      <Text style={styles.label}>{f.label}</Text>
                      <TextInput
                        style={fui.input}
                        value={d.context[f.key] || ''}
                        onChangeText={(t) => set('context', { ...d.context, [f.key]: t.slice(0, 60) })}
                        maxLength={60}
                        placeholder={f.placeholder}
                        placeholderTextColor={FriendsColors.faint}
                        accessibilityLabel={f.label}
                      />
                    </View>
                  ))
                : null}
            </View>
          ) : null}

          {/* Title and body */}
          <Text style={styles.label}>{isReview ? 'Headline' : d.type === 'question' ? 'Your question' : 'Title'}</Text>
          <TextInput
            style={[fui.input, { fontSize: 16, fontWeight: '700' }]}
            value={d.title}
            onChangeText={(t) => set('title', t.slice(0, FORUM_LIMITS.title.max))}
            maxLength={FORUM_LIMITS.title.max}
            placeholder={d.type === 'question' ? 'e.g. How tough is the DBMS end-sem?' : isReview ? 'Sum it up in a line' : 'Give it a clear title'}
            placeholderTextColor={FriendsColors.faint}
            accessibilityLabel="Title"
            multiline
          />
          <Text style={styles.counter}>
            {titleLen < FORUM_LIMITS.title.min ? `At least ${FORUM_LIMITS.title.min} characters · ` : ''}
            {d.title.length}/{FORUM_LIMITS.title.max}
          </Text>

          <Text style={styles.label}>{isReview ? 'More detail (optional)' : 'Details (optional)'}</Text>
          <TextInput
            style={[fui.input, { minHeight: 140, textAlignVertical: 'top' }]}
            value={d.body}
            onChangeText={(t) => set('body', t.slice(0, FORUM_LIMITS.body))}
            maxLength={FORUM_LIMITS.body}
            multiline
            placeholder={d.type === 'resource' ? 'What is it, which course, and is it OK to share?' : 'Add context so people can help'}
            placeholderTextColor={FriendsColors.faint}
            accessibilityLabel="Details"
          />
          <Text style={styles.counter}>
            {d.body.length}/{FORUM_LIMITS.body}
          </Text>

          {/* Photos and links (reviews keep to text) */}
          {!isReview ? (
            <>
              <Text style={styles.label}>Photos (up to {FORUM_LIMITS.media})</Text>
              <ImagePickerRow value={d.images} onChange={(v) => set('images', v)} purpose="forum" max={FORUM_LIMITS.media} />

              <Text style={styles.label}>Links (up to {FORUM_LIMITS.links})</Text>
              {d.links.map((l) => (
                <View key={l} style={styles.linkRow}>
                  <Link2 size={14} color={FriendsColors.accent} />
                  <Text style={[FT.small, { flex: 1, color: FriendsColors.ink }]} numberOfLines={1}>
                    {l}
                  </Text>
                  <TouchableOpacity onPress={() => set('links', d.links.filter((x) => x !== l))} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Remove link ${l}`}>
                    <X size={16} color={FriendsColors.muted} />
                  </TouchableOpacity>
                </View>
              ))}
              {d.links.length < FORUM_LIMITS.links ? (
                <View style={{ flexDirection: 'row', gap: FS.sm }}>
                  <TextInput
                    style={[fui.input, { flex: 1 }]}
                    value={linkInput}
                    onChangeText={setLinkInput}
                    placeholder="https://"
                    placeholderTextColor={FriendsColors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    onSubmitEditing={addLink}
                    accessibilityLabel="Add a link"
                  />
                  <TouchableOpacity style={[fui.ghostBtn, { minWidth: 64 }]} onPress={addLink} disabled={!linkInput.trim()} accessibilityRole="button" accessibilityLabel="Add link">
                    <Text style={fui.ghostBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : null}

          {/* Anonymous */}
          {!edit && !isGuide ? (
            <View style={[styles.anonRow, (isReview || !anonAllowed) && { opacity: 0.8 }]}>
              <VenetianMask size={18} color={anonymous ? FriendsColors.accent : FriendsColors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={FT.h3}>Post anonymously</Text>
                <Text style={FT.small}>
                  {isReview
                    ? 'Reviews are always anonymous.'
                    : anonAllowed
                    ? 'Others see a thread alias instead of your name. Rules, limits and reports still apply.'
                    : 'This community asks for verified names.'}
                </Text>
              </View>
              <Switch
                value={anonymous}
                onValueChange={(v) => set('anonymous', v)}
                disabled={isReview || !anonAllowed}
                trackColor={{ true: FriendsColors.accent, false: FriendsColors.line }}
                thumbColor={FriendsColors.ink}
                accessibilityLabel="Post anonymously"
              />
            </View>
          ) : null}

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
                <Check size={18} color={FriendsColors.accentInk} />
                <Text style={fui.primaryBtnText}>{edit ? 'Save changes' : isReview ? 'Publish review' : 'Publish'}</Text>
              </>
            )}
          </TouchableOpacity>
          {!valid && !busy ? (
            <Text style={[FT.small, { textAlign: 'center', marginTop: FS.sm }]}>
              {!community
                ? 'Pick a community.'
                : !typeOk
                ? `${community.name} doesn't take ${POST_TYPE_META[d.type].label.toLowerCase()} posts.`
                : isReview && !d.target
                ? 'Pick what you are reviewing.'
                : isReview && d.rating < 1
                ? 'Add a star rating.'
                : `Add a title of at least ${FORUM_LIMITS.title.min} characters.`}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </FriendsScreenModal>
  );
};

const styles = StyleSheet.create({
  publish: { minHeight: 38, paddingHorizontal: 16, borderRadius: FR.pill, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center', marginRight: FS.sm },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: FriendsColors.muted, textTransform: 'uppercase', marginTop: FS.lg, marginBottom: 6 },
  counter: { fontSize: 12, color: FriendsColors.faint, textAlign: 'right', marginTop: 4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: FS.sm },
  typeCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: FR.md,
    borderWidth: 1,
    borderColor: FriendsColors.line,
    backgroundColor: FriendsColors.card,
  },
  typeOn: { borderColor: FriendsColors.accent, backgroundColor: FriendsColors.accentSoft },
  typeText: { fontSize: 13, fontWeight: '700', color: FriendsColors.muted },
  infoBox: { flexDirection: 'row', gap: 8, marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.accentSoft },
  targetPicked: { flexDirection: 'row', alignItems: 'center', padding: FS.md, borderRadius: FR.md, borderWidth: 1, borderColor: FriendsColors.accent, backgroundColor: FriendsColors.card },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: FS.sm, paddingVertical: 0 },
  searchInput: { flex: 1, color: FriendsColors.ink, fontSize: 15, minHeight: 44 },
  multi: { minHeight: 72, textAlignVertical: 'top' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi, marginBottom: FS.sm },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: FS.md, marginTop: FS.xl, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line },
  error: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft, color: FriendsColors.danger, fontSize: 13, fontWeight: '600' },
});
