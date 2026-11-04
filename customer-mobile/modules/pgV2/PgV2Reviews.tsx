/**
 * PG v2 reviews: real reviews first (GET /api/pg/:id/reviews, five at a time) with the rating summary
 * and breakdown, "Review your stay" for students who stayed here (eligibility from the server,
 * POST /api/pg/:id/reviews), and Report on each real review (POST /api/pg/reviews/:id/report).
 * While demo content is on, sample reviews follow, each captioned "Sample review".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import IStar from 'lucide-react-native/icons/star';
import { API_URL } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';
import { useAuth } from '../../context/AuthContext';
import { PG2, R, GUTTER, W } from './pgV2Theme';
import { Tap, PrimaryButton, OutlineButton } from './PgV2Kit';
import { demoReviews, demoSummary, type DemoReview } from './pgV2Demo';
import { monthYear, plural, ratingText, type PgDetail, type PgReview, type PgReviewPage, type PgReviewEligibility } from '../pg/pgApi';

const PAGE = 5;
const REPORT_REASONS: { value: 'spam' | 'offensive' | 'fake'; label: string; hint: string }[] = [
  { value: 'spam', label: 'Spam or advertising', hint: 'Promotes something or is not about this PG' },
  { value: 'offensive', label: 'Offensive', hint: 'Abusive, hateful or harassing' },
  { value: 'fake', label: 'Not a real stay', hint: 'The writer did not live here' },
];
const RATING_WORD = ['', 'Poor', 'Below average', 'Average', 'Good', 'Excellent'];

export function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessibilityLabel={`${ratingText(value)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <IStar key={n} size={size} color={n <= Math.round(value) ? PG2.star : '#D9D6EA'} fill={n <= Math.round(value) ? PG2.star : 'transparent'} strokeWidth={1.4} />)}
    </View>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[st.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={st.sheetTitle}>{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

function ReviewRow({ r, onReport }: { r: PgReview | DemoReview; onReport?: () => void }) {
  const sample = 'isDemoContent' in r;
  return (
    <View style={st.row}>
      <View style={st.rowHead}>
        <Text style={st.name}>{r.firstName}</Text>
        <Text style={st.small}>{monthYear(r.createdAt)}</Text>
      </View>
      <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Stars value={r.rating} size={12} />
        {sample ? <Text style={st.sampleTag}>Sample review</Text> : null}
      </View>
      <Text style={st.text}>{r.text}</Text>
      {!sample && onReport ? (
        <Tap onPress={onReport} label={`Report the review by ${r.firstName}`} style={st.reportBtn}><Text style={st.small}>Report</Text></Tap>
      ) : null}
    </View>
  );
}

function WriteReview({ pgId, onClose, onDone }: { pgId: string; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = rating >= 1 && text.trim().length >= 10;
  const send = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(`${API_URL}/api/pg/${pgId}/reviews`, { method: 'POST', body: JSON.stringify({ rating, text: text.trim() }) });
      const body = await readJson(res);
      if (res.ok) onDone(); else setError(body?.message || 'Please try again.');
    } catch { setError('Check your internet and try again.'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Review your stay" onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Tap key={n} onPress={() => setRating(n)} label={`${n} star${n > 1 ? 's' : ''}`} selected={rating === n} style={{ padding: 4 }}>
            <IStar size={28} color={n <= rating ? PG2.star : '#D9D6EA'} fill={n <= rating ? PG2.star : 'transparent'} strokeWidth={1.4} />
          </Tap>
        ))}
        <Text style={[st.small, { marginLeft: 6 }]}>{RATING_WORD[rating]}</Text>
      </View>
      <TextInput value={text} onChangeText={setText} multiline maxLength={600} placeholder="What was it like to live here? Food, rooms, staff, safety." placeholderTextColor={PG2.faint} style={st.input} accessibilityLabel="Your review" />
      {error ? <Text style={[st.small, { color: PG2.red, marginTop: 8 }]}>{error}</Text> : null}
      <PrimaryButton label="Post review" onPress={send} busy={busy} disabled={!valid} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

function ReportSheet({ review, onClose }: { review: PgReview; onClose: () => void }) {
  const [sending, setSending] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = async (reason: string) => {
    setSending(reason);
    try {
      const res = await apiFetch(`${API_URL}/api/pg/reviews/${review.id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
      const body = await readJson(res);
      setDone(res.ok ? 'Thanks. The ZENV team will review it.' : String(body?.message || 'Could not report. Please try again.').replace(/\bZenvy\b|\bZCS\b/g, 'ZENV'));
    } catch { setDone('Check your internet and try again.'); } finally { setSending(null); }
  };
  return (
    <Sheet title="Report this review" onClose={onClose}>
      {done ? (
        <><Text style={st.text}>{done}</Text><OutlineButton label="Done" onPress={onClose} style={{ marginTop: 14 }} /></>
      ) : REPORT_REASONS.map((r, i) => (
        <Tap key={r.value} onPress={() => send(r.value)} disabled={!!sending} label={`${r.label}. ${r.hint}`} style={[st.reason, i > 0 && st.hair]}>
          <View style={{ flex: 1 }}><Text style={st.name}>{r.label}</Text><Text style={st.small}>{r.hint}</Text></View>
          {sending === r.value ? <ActivityIndicator color={PG2.primary} /> : null}
        </Tap>
      ))}
    </Sheet>
  );
}

export function ReviewsBlock({ pg }: { pg: PgDetail }) {
  const router = useRouter();
  const { user } = useAuth() as any;
  const [page, setPage] = useState<PgReviewPage | null>(null);
  const [items, setItems] = useState<PgReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [elig, setElig] = useState<PgReviewEligibility | null>(null);
  const [writing, setWriting] = useState(false);
  const [reporting, setReporting] = useState<PgReview | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const realCount = pg.reviewSummary?.count || 0;

  const load = useCallback(async (n: number) => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/api/pg/${pg.id}/reviews?page=${n}&limit=${PAGE}`);
      const body = await readJson(res);
      if (live.current && res.ok && body && Array.isArray(body.items)) {
        setPage(body);
        setItems((cur) => (n === 1 ? body.items : [...cur, ...body.items.filter((x: PgReview) => !cur.some((c) => c.id === x.id))]));
      }
    } catch { /* the summary still shows */ } finally { if (live.current) setLoading(false); }
  }, [pg.id]);
  useEffect(() => { if (realCount > 0) load(1); }, [realCount, load]);
  useEffect(() => {
    if (!user) { setElig(null); return; }
    apiFetch(`${API_URL}/api/pg/${pg.id}/reviews/eligibility`).then(async (res) => {
      const body = res.ok ? await readJson(res) : null;
      if (live.current) setElig(body && typeof body.canReview === 'boolean' ? body : null);
    }).catch(() => {});
  }, [user, pg.id]);

  const samples = demoReviews(pg);
  const real = page?.summary || (realCount ? pg.reviewSummary : null);
  const sum = real && real.count ? real : demoSummary(samples);
  const dist = page?.summary.distribution;

  return (
    <View>
      {sum.count ? (
        <View style={st.summary}>
          <View style={{ minWidth: 92 }}>
            <Text style={st.avg}>{ratingText(sum.average)}</Text>
            <Stars value={sum.average || 0} />
            <Text style={[st.small, { marginTop: 4 }]}>{real && real.count ? plural(real.count, 'review') : `${plural(samples.length, 'sample review')}`}</Text>
          </View>
          {dist ? (
            <View style={{ flex: 1, gap: 5 }}>
              {[5, 4, 3, 2, 1].map((n) => {
                const c = Number(dist[String(n)] || 0);
                return (
                  <View key={n} style={st.distRow} accessible accessibilityLabel={`${n} stars: ${c}`}>
                    <Text style={[st.small, { width: 10 }]}>{n}</Text>
                    <View style={st.track}><View style={[st.fill, { width: `${sum.count ? (c / sum.count) * 100 : 0}%` }]} /></View>
                    <Text style={[st.small, { width: 22, textAlign: 'right' }]}>{c}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
      {items.map((r) => <ReviewRow key={r.id} r={r} onReport={() => (user ? setReporting(r) : router.push('/login' as any))} />)}
      {page?.hasMore ? <OutlineButton label={loading ? 'Loading…' : 'Show more reviews'} onPress={() => load((page?.page || 1) + 1)} style={{ marginTop: 12 }} /> : null}
      {samples.map((r) => <ReviewRow key={r.id} r={r} />)}
      {elig?.canReview ? <OutlineButton label="Review your stay" onPress={() => setWriting(true)} style={{ marginTop: 16 }} /> : null}
      {writing ? <WriteReview pgId={pg.id} onClose={() => setWriting(false)} onDone={() => { setWriting(false); load(1); }} /> : null}
      {reporting ? <ReportSheet review={reporting} onClose={() => setReporting(null)} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  summary: { flexDirection: 'row', gap: 18, alignItems: 'center', paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6E3F5' },
  avg: { fontSize: 30, fontWeight: W.title, color: PG2.ink, marginBottom: 2 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#EEECF7', overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: PG2.primary },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6E3F5' },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontSize: 14, fontWeight: W.label, color: PG2.ink },
  text: { marginTop: 8, fontSize: 13.5, color: PG2.ink2, lineHeight: 20 },
  small: { fontSize: 12, color: PG2.muted },
  sampleTag: { fontSize: 11, color: PG2.muted, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D9D6EA', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  reportBtn: { alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,16,60,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: GUTTER + 4 },
  sheetTitle: { fontSize: 17, fontWeight: W.title, color: PG2.ink, marginBottom: 12 },
  input: { marginTop: 12, minHeight: 110, borderRadius: R.md, borderWidth: 1, borderColor: '#E6E3F5', padding: 12, fontSize: 14, color: PG2.ink, textAlignVertical: 'top' },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 10 },
  hair: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ECEAF5' },
});
