/**
 * Reviews of a PG. Only real reviews: written by students whose confirmed stay has started (the server
 * checks; one per booking). Shows the average, the spread of ratings and the reviews (first name, rating,
 * month, text), five at a time. Anyone signed in can report a review (a small bottom sheet with the
 * reasons, since an Android alert shows at most three buttons); the Zenvy team moderates.
 * A student who may review sees "Review your stay"; the form is a Modal (Android back closes it).
 * API: GET/POST /api/pg/:id/reviews, POST /api/pg/reviews/:id/report.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';
import { monthYear, plural, ratingText, type PgReview, type PgReviewEligibility, type PgReviewPage, type ReviewSummary } from './pgApi';
import { usePgPalette, Press, SectionHeading, ICON, TYPE, IconStar, IconChevronRight, s as ui } from './ui';
import { Card } from './blocks';

const PAGE = 5;

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const p = usePgPalette();
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessible accessibilityLabel={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar key={i} size={size} color={i <= Math.round(value) ? p.text : p.line} fill={i <= Math.round(value) ? p.text : 'transparent'} strokeWidth={1.5} />
      ))}
    </View>
  );
}

export function ReviewsSection({ pgId, summary, eligibility, signedIn, onLoginNeeded, onReviewed }: {
  pgId: string; summary: ReviewSummary; eligibility: PgReviewEligibility | null; signedIn: boolean;
  onLoginNeeded: () => void; onReviewed: () => void;
}) {
  const p = usePgPalette();
  const [data, setData] = useState<PgReviewPage | null>(null);
  const [items, setItems] = useState<PgReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [writing, setWriting] = useState(false);
  const [reporting, setReporting] = useState<PgReview | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (page: number) => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiFetch(`${API_URL}/api/pg/${pgId}/reviews?page=${page}&limit=${PAGE}`);
      const body = await readJson(res);
      if (!mounted.current) return;
      if (res.ok && body && Array.isArray(body.items)) {
        setData(body);
        setItems((cur) => (page === 1 ? body.items : [...cur, ...body.items.filter((x: PgReview) => !cur.some((c) => c.id === x.id))]));
      } else setError(true);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [pgId]);

  useEffect(() => { if (summary.count > 0) load(1); else { setItems([]); setData(null); } }, [summary.count, summary.average, load]);

  const report = (r: PgReview) => {
    if (!signedIn) { onLoginNeeded(); return; }
    setReporting(r);
  };

  const canReview = !!eligibility?.canReview;
  const dist = data?.summary.distribution;
  const count = data?.summary.count ?? summary.count;
  const average = data?.summary.average ?? summary.average;

  return (
    <View>
      <SectionHeading title="Reviews" detail={count ? 'From students who stayed here' : undefined} />
      {count > 0 ? (
        <View style={st.summary}>
          <View style={{ minWidth: 96 }}>
            <Text style={[st.avg, { color: p.text }]}>{ratingText(average)}</Text>
            <Stars value={average || 0} />
            <Text style={[ui.small, { color: p.sub, marginTop: 4 }]}>{plural(count, 'review')}</Text>
          </View>
          {dist ? (
            <View style={{ flex: 1, gap: 4 }} accessibilityLabel="Ratings breakdown">
              {[5, 4, 3, 2, 1].map((n) => {
                const c = Number(dist[String(n)] || 0);
                return (
                  <View key={n} style={st.distRow} accessible accessibilityLabel={`${n} stars: ${c}`}>
                    <Text style={[ui.small, { color: p.sub, width: 12 }]}>{n}</Text>
                    <View style={[st.track, { backgroundColor: p.sunken }]}>
                      <View style={[st.fill, { backgroundColor: p.text, width: `${count ? (c / count) * 100 : 0}%` }]} />
                    </View>
                    <Text style={[ui.small, { color: p.muted, width: 24, textAlign: 'right' }]}>{c}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : canReview ? (
        <Text style={[ui.body, { color: p.sub }]}>No reviews yet. You stayed here, so yours can be the first.</Text>
      ) : null}

      {items.map((r) => <ReviewRow key={r.id} review={r} onReport={() => report(r)} />)}

      {error && !items.length && count > 0 ? (
        <Press onPress={() => load(1)} accessibilityLabel="Retry loading reviews" style={[ui.secondaryBtn, { borderColor: p.line, marginTop: 12 }]}>
          <Text style={[ui.btnLabel, { color: p.text }]}>Couldn't load reviews. Tap to try again.</Text>
        </Press>
      ) : null}
      {data?.hasMore ? (
        <Press onPress={() => load((data?.page || 1) + 1)} disabled={loading} accessibilityLabel="Show more reviews" style={[ui.secondaryBtn, { borderColor: p.line, marginTop: 12 }]}>
          {loading ? <ActivityIndicator color={p.text} /> : <Text style={[ui.btnLabel, { color: p.text }]}>Show more reviews</Text>}
        </Press>
      ) : null}
      {canReview ? (
        <Press onPress={() => setWriting(true)} accessibilityLabel="Review your stay" style={[ui.secondaryBtn, { borderColor: p.text, marginTop: 16 }]}>
          <Text style={[ui.btnLabel, { color: p.text }]}>Review your stay</Text>
        </Press>
      ) : null}
      {writing ? (
        <WriteReview pgId={pgId} onClose={() => setWriting(false)} onDone={() => { setWriting(false); onReviewed(); load(1); }} />
      ) : null}
      {reporting ? <ReportSheet review={reporting} onClose={() => setReporting(null)} /> : null}
    </View>
  );
}

const CLAMP = 4;
function ReviewRow({ review, onReport }: { review: PgReview; onReport: () => void }) {
  const p = usePgPalette();
  const [open, setOpen] = useState(false);
  const long = review.text.length > 220;
  return (
    <View style={[st.review, { borderTopColor: p.line }]}>
      <View style={st.reviewHead}>
        <Text style={[ui.body, { color: p.text, fontWeight: '600', flex: 1 }]} numberOfLines={1}>{review.firstName}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{monthYear(review.createdAt)}</Text>
      </View>
      <View style={{ marginTop: 4 }}><Stars value={review.rating} size={12} /></View>
      <Text style={[ui.body, { color: p.text, marginTop: 8 }]} numberOfLines={open || !long ? undefined : CLAMP}>{review.text}</Text>
      <View style={st.reviewFoot}>
        {long ? (
          <Press onPress={() => setOpen((v) => !v)} accessibilityLabel={open ? 'Show less' : 'Read the full review'} style={st.textBtn}>
            <Text style={[ui.small, { color: p.text, fontWeight: '600' }]}>{open ? 'Show less' : 'Read more'}</Text>
          </Press>
        ) : <View />}
        <Press onPress={onReport} accessibilityLabel={`Report the review by ${review.firstName}`} style={st.textBtn}>
          <Text style={[ui.small, { color: p.muted }]}>Report</Text>
        </Press>
      </View>
    </View>
  );
}

/** Reasons the server accepts (pgContent REVIEW_REPORT_REASONS); the values are sent as they are. */
const REPORT_REASONS: { value: 'spam' | 'offensive' | 'fake'; label: string; hint: string }[] = [
  { value: 'spam', label: 'Spam or advertising', hint: 'Promotes something or is not about this PG' },
  { value: 'offensive', label: 'Offensive', hint: 'Abusive, hateful or harassing' },
  { value: 'fake', label: 'Not a real stay', hint: 'The writer did not live here' },
];
function ReportSheet({ review, onClose }: { review: PgReview; onClose: () => void }) {
  const p = usePgPalette();
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState<string | null>(null);

  const send = async (reason: string) => {
    if (sending) return;
    setSending(reason);
    try {
      const res = await apiFetch(`${API_URL}/api/pg/reviews/${review.id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
      const body = await readJson(res);
      onClose();
      Alert.alert(res.ok ? 'Report sent' : 'Could not report', body?.message || (res.ok ? 'The Zenvy team will review it.' : 'Please try again.'));
    } catch {
      setSending(null);
      Alert.alert('No connection', 'Check your internet and try again.');
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !sending && onClose()} statusBarTranslucent>
      <View style={st.backdrop}>
        <Press onPress={() => !sending && onClose()} accessibilityLabel="Close" style={{ flex: 1 }}><View /></Press>
        <View style={[st.sheet, { backgroundColor: p.bg, paddingBottom: insets.bottom + 16 }]}>
          <View style={[st.grabber, { backgroundColor: p.line }]} />
          <Text style={[st.sheetTitle, { color: p.text }]} accessibilityRole="header">Report this review</Text>
          <Text style={[ui.small, { color: p.sub, marginTop: 4 }]}>Why should the Zenvy team look at the review by {review.firstName}?</Text>
          <View style={{ marginTop: 12 }}>
            {REPORT_REASONS.map((r, i) => (
              <Press key={r.value} onPress={() => send(r.value)} disabled={!!sending} accessibilityLabel={`${r.label}. ${r.hint}`} accessibilityState={{ busy: sending === r.value, disabled: !!sending }}
                style={[st.reasonRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[ui.body, { color: p.text, fontWeight: '600' }]}>{r.label}</Text>
                  <Text style={[ui.small, { color: p.muted, marginTop: 2 }]}>{r.hint}</Text>
                </View>
                {sending === r.value ? <ActivityIndicator color={p.sub} /> : <IconChevronRight size={18} color={p.muted} strokeWidth={ICON.stroke} />}
              </Press>
            ))}
          </View>
          <Press onPress={onClose} disabled={!!sending} accessibilityLabel="Cancel" style={[ui.secondaryBtn, { borderColor: p.line, marginTop: 12 }]}>
            <Text style={[ui.btnLabel, { color: p.text }]}>Cancel</Text>
          </Press>
        </View>
      </View>
    </Modal>
  );
}

const RATING_WORD = ['', 'Poor', 'Below average', 'Average', 'Good', 'Excellent'];
function WriteReview({ pgId, onClose, onDone }: { pgId: string; onClose: () => void; onDone: () => void }) {
  const p = usePgPalette();
  const insets = useSafeAreaInsets();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const valid = rating >= 1 && text.trim().length >= 10;

  const submit = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/pg/${pgId}/reviews`, { method: 'POST', body: JSON.stringify({ rating, text: text.trim() }) });
      const body = await readJson(res);
      if (res.ok) { onDone(); Alert.alert('Review posted', 'Thanks for reviewing your stay.'); return; }
      setError(body?.message || 'Could not post your review. Please try again.');
    } catch {
      setError('No connection. Check your internet and try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !sending && onClose()} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.backdrop}>
        <Press onPress={() => !sending && onClose()} accessibilityLabel="Close" style={{ flex: 1 }}><View /></Press>
        <View style={[st.sheet, { backgroundColor: p.bg, paddingBottom: insets.bottom + 16 }]}>
          <View style={[st.grabber, { backgroundColor: p.line }]} />
          <Text style={[st.sheetTitle, { color: p.text }]} accessibilityRole="header">Review your stay</Text>
          <Text style={[ui.small, { color: p.sub, marginTop: 4 }]}>Your first name, rating and review are shown to other students.</Text>
          <View style={st.picker} accessibilityRole="radiogroup" accessibilityLabel="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <Press key={n} onPress={() => setRating(n)} accessibilityRole="button" accessibilityState={{ selected: rating === n }} accessibilityLabel={`${n} star${n === 1 ? '' : 's'}, ${RATING_WORD[n]}`} style={st.starBtn}>
                <IconStar size={28} color={n <= rating ? p.text : p.line} fill={n <= rating ? p.text : 'transparent'} strokeWidth={1.5} />
              </Press>
            ))}
          </View>
          <Text style={[ui.small, { color: p.sub, minHeight: 16 }]}>{RATING_WORD[rating] || 'Tap a star to rate'}</Text>
          <Card style={{ marginTop: 12 }}>
            <TextInput
              value={text}
              onChangeText={(v) => { setText(v); setError(''); }}
              placeholder="What was it like to live here: rooms, food, staff, safety?"
              placeholderTextColor={p.muted}
              multiline
              maxLength={1000}
              textAlignVertical="top"
              style={[st.input, { color: p.text }]}
              accessibilityLabel="Your review"
            />
          </Card>
          <View style={st.metaRow}>
            <Text style={[ui.small, { color: error ? p.accent : p.muted, flex: 1 }]} accessibilityLiveRegion="polite">{error || (text.trim().length < 10 ? 'At least 10 characters' : ' ')}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{text.length}/1000</Text>
          </View>
          <Press onPress={submit} disabled={!valid || sending} accessibilityLabel="Post review" accessibilityState={{ busy: sending, disabled: !valid }} style={[st.primary, { backgroundColor: p.accentFill }]}>
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={[ui.btnLabel, { color: '#fff' }]}>Post review</Text>}
          </Press>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  summary: { flexDirection: 'row', gap: 24, alignItems: 'center', marginBottom: 8 },
  avg: { fontSize: TYPE.title, fontWeight: '700', marginBottom: 4 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  review: { paddingTop: 16, marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  reviewHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  reviewFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  textBtn: { justifyContent: 'center', paddingHorizontal: 0 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  sheetTitle: { fontSize: TYPE.heading, fontWeight: '700' },
  picker: { flexDirection: 'row', gap: 4, marginTop: 16 },
  starBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 },
  input: { minHeight: 120, maxHeight: 220, fontSize: TYPE.body, lineHeight: 20, padding: 12 },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  primary: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
});
