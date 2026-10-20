"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { PGHostel, PgReview, REVIEW_REPORT_LABEL, formatDate, pgRequest } from './pgApi';
import { PanelMessage, errorText } from './contentShared';

type Filter = 'all' | 'reported' | 'hidden';
const FILTERS: [Filter, string][] = [['all', 'All'], ['reported', 'Reported'], ['hidden', 'Hidden']];

/** Review moderation for one PG. Hiding needs a reason (kept in the audit log). */
export function ReviewsPanel({ pg, liveTick = 0 }: { pg: PGHostel; liveTick?: number }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [reviews, setReviews] = useState<PgReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<PanelMessage>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setLoadError(''); }
    try {
      const data = await pgRequest<PgReview[]>(`/api/pg/admin/reviews?hostelId=${encodeURIComponent(pg.id)}&filter=${filter}`);
      setReviews(Array.isArray(data) ? data : []);
      setLoadError('');
    } catch (e) {
      if (!quiet) setLoadError(errorText(e, 'Could not load the reviews.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [pg.id, filter]);

  useEffect(() => { load(); }, [load]);
  // Live sync: reload quietly when the tick moves after mount (the first load above covers the rest).
  const mountTick = useRef(liveTick);
  useEffect(() => { if (liveTick !== mountTick.current) load(true); }, [liveTick, load]);

  const setHidden = async (r: PgReview, hidden: boolean) => {
    if (busy[r.id]) return;
    let reason: string | undefined;
    if (hidden) {
      const typed = window.prompt(`Hide this review by ${r.firstName}?\n\nGive a reason (kept in the audit log, up to 200 characters):`);
      if (typed === null) return;
      reason = typed.replace(/\s+/g, ' ').trim();
      if (!reason) { setMessage({ kind: 'error', text: 'Give a reason for hiding this review (kept in the audit log).' }); return; }
      if (reason.length > 200) { setMessage({ kind: 'error', text: 'The reason must be at most 200 characters.' }); return; }
    }
    setBusy(prev => ({ ...prev, [r.id]: true }));
    setMessage(null);
    try {
      const saved = await pgRequest<PgReview>(`/api/pg/admin/reviews/${r.id}`, { method: 'PUT', body: JSON.stringify(hidden ? { hidden, reason } : { hidden }) });
      setReviews(prev => prev
        .map(x => (x.id === r.id ? { ...x, ...saved, hostelName: x.hostelName } : x))
        .filter(x => filter !== 'hidden' || x.status === 'hidden'));
      setMessage({ kind: 'ok', text: hidden ? 'Review hidden. Students no longer see it.' : 'Review shown again.' });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e, 'Could not update the review.') });
    } finally {
      setBusy(prev => ({ ...prev, [r.id]: false }));
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-muted">Only students with a confirmed stay can review. Hide reviews that break the rules; the reason is kept in the audit log.</p>

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter reviews">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => { setFilter(key); setMessage(null); }} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === key ? 'border-line-strong bg-accent text-accent-fg' : 'border-line text-fg-muted hover:text-fg'}`}>{label}</button>
        ))}
        <button type="button" disabled={loading} onClick={() => load()} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-danger-text' : 'text-success-text'}`}>{message.text}</p>}
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger-text">
          {loadError}<button type="button" onClick={() => load()} className="font-semibold underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div role="status" className="rounded-xl border border-line p-8 text-sm text-fg-muted">Loading reviews…</div>
      ) : !loadError && reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-muted">
          {filter === 'all' ? 'No reviews yet.' : filter === 'reported' ? 'No reported reviews.' : 'No hidden reviews.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {reviews.map(r => {
            const reasons = Array.from(new Set((r.reports || []).map(x => REVIEW_REPORT_LABEL[x.reason] || x.reason)));
            const hidden = r.status === 'hidden';
            return (
              <li key={r.id} className={`space-y-2 rounded-xl border p-4 ${hidden ? 'border-line bg-surface-2/60' : r.reportCount > 0 ? 'border-warning/30' : 'border-line'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-sm"><span className="font-semibold text-fg">{r.rating} of 5</span><span className="text-fg-muted"> · {r.firstName || 'Resident'} · {formatDate(r.createdAt)}</span></p>
                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${hidden ? 'border-line text-fg-muted' : 'border-success/30 text-success-text'}`}>{hidden ? 'Hidden' : 'Visible'}</span>
                </div>
                <p className="whitespace-pre-line text-sm text-fg">{r.text}</p>
                {r.reportCount > 0 && (
                  <p className="text-xs text-warning-text">Reported {r.reportCount} time{r.reportCount === 1 ? '' : 's'}{reasons.length ? `: ${reasons.join(', ')}` : ''}</p>
                )}
                {hidden && r.hiddenReason && <p className="text-xs text-fg-muted">Hidden because: {r.hiddenReason}</p>}
                <div className="flex justify-end">
                  {hidden ? (
                    <button type="button" disabled={!!busy[r.id]} onClick={() => setHidden(r, false)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2/60 disabled:opacity-50">Show again</button>
                  ) : (
                    <button type="button" disabled={!!busy[r.id]} onClick={() => setHidden(r, true)} className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger-text hover:bg-danger-soft disabled:opacity-50">Hide</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
