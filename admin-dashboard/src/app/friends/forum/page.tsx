"use client";
import { useConfirm, usePrompt, useToast } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import { useLiveSync, useFreshIds, FRESH_ROW_CLASS, type LiveEvent } from '@/lib/useLiveSync';

/**
 * Zenvy Friends > Forum admin (backend: /api/campus/forum/admin/*, admins only; works while the
 * forum flag is off so communities can be prepared before launch).
 *
 *  Communities   default + custom communities per campus, student requests, moderators, mod log
 *  Freshers      the pinned Freshers Guide of each community (Official label by default)
 *  Targets       review targets (courses, professors, hostels, ...): approvals, create, edit
 *  Reviews       reviews held for a human (allegations on faculty reviews etc.), right of reply
 *
 * Reports on forum content are handled in /moderation (subTab "forum"). Reviewers and anonymous
 * authors are never shown here; "Reveal author" lives only in /moderation and is logged.
 */

// ── Contract (mirrors backend/modules/friends/models/forum/enums.js) ─────────
const POST_TYPES = ['question', 'discussion', 'review', 'resource', 'guidance', 'campus_info'] as const;
const COMMUNITY_STATUS = ['active', 'pending', 'archived'] as const;
const REVIEW_KINDS = ['course', 'professor', 'hostel', 'mess', 'club', 'placement'] as const;
const TARGET_STATUS = ['active', 'pending', 'hidden'] as const;
const REVIEW_STATUS = ['pending_review', 'published', 'hidden', 'removed'] as const;
type PostType = typeof POST_TYPES[number];
type ReviewKind = typeof REVIEW_KINDS[number];

const TYPE_LABEL: Record<PostType, string> = {
  question: 'Question', discussion: 'Discussion', review: 'Review', resource: 'Resource', guidance: 'Guidance', campus_info: 'Campus info',
};
const KIND_LABEL: Record<ReviewKind, string> = {
  course: 'Course', professor: 'Professor', hostel: 'Hostel', mess: 'Mess', club: 'Club', placement: 'Placement',
};

interface Campus { id: string; name: string; code: string }
interface MiniIdentity { userId?: string | null; name?: string | null; avatarUrl?: string | null; verified?: boolean }
interface ModeratorRow { userId: string; role: 'owner' | 'moderator'; user: MiniIdentity | null }
interface Community {
  id: string; slug: string; name: string; description: string | null; rules: string[]; kind: 'default' | 'custom';
  allowAnonymous: boolean; allowedTypes: PostType[]; status: typeof COMMUNITY_STATUS[number]; memberCount: number;
  postCount: number; campusId: string; sortOrder: number; createdAt: string; moderators: ModeratorRow[];
}
interface Guide { postId: string; communityId: string; campusId: string; title: string; body: string; isOfficial: boolean; label: 'official' | 'student'; status: string; updatedAt: string }
interface TargetMeta { department?: string | null; code?: string | null; block?: string | null; facultyUserId?: string | null; entityId?: string | null }
interface ReviewTarget {
  id: string; kind: ReviewKind; name: string; status: typeof TARGET_STATUS[number]; reviewCount: number; average: number | null;
  campusId: string; adminMeta: TargetMeta; createdBy: string | null; createdAt: string;
}
interface ReviewPost {
  id: string; communityId: string; community: { id: string; slug: string; name: string } | null; title: string; body: string;
  status: string; createdAt: string; editedAt: string | null; author: { anonymous?: boolean; alias?: string; name?: string };
  review?: {
    id: string; targetId: string; target: { id: string; kind: ReviewKind; name: string } | null; rating: number; pros: string | null;
    cons: string | null; periodLabel: string | null; context: Record<string, unknown>; status: string;
    response: { id: string; body: string; responderRole: string; responder: { name?: string } ; createdAt: string } | null;
  };
}
interface ModLogItem { id: string; action: string; actorRole: string; moderator: MiniIdentity | null; targetType: string; targetId: string; reason: string | null; createdAt: string }
interface UserHit { id: string; name: string | null; phone?: string | null; email?: string | null }

type Tab = 'communities' | 'guides' | 'targets' | 'reviews';
type Notice = { kind: 'ok' | 'error'; text: string } | null;

// ── Shared styles (same tokens as /friends and /moderation) ──────────────────
const input = 'w-full rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-accent';
const label = 'block text-xs font-semibold text-fg-muted mb-1';
const btn = 'rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40 transition-colors';
const btnGhost = `${btn} border border-line bg-surface-2/60 text-fg-muted hover:text-fg`;
const btnGo = `${btn} bg-success-soft text-success-text border border-success/30 hover:bg-success-soft`;
const btnWarn = `${btn} bg-danger-soft text-danger-text border border-danger/30 hover:bg-danger-soft`;
const btnBlue = `${btn} bg-info-soft text-info-text border border-info/30`;
const card = 'rounded-lg border border-line bg-surface shadow-xs p-6 space-y-4';
const chip = 'text-xs px-2 py-0.5 rounded-md border font-semibold';

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const qs = (o: Record<string, string | undefined | null>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const shortId = (id?: string | null) => (id ? `${id.slice(0, 8)}…` : '-');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

const STATUS_TONE: Record<string, string> = {
  active: 'text-success-text border-success/30 bg-success-soft',
  published: 'text-success-text border-success/30 bg-success-soft',
  visible: 'text-success-text border-success/30 bg-success-soft',
  pending: 'text-warning-text border-warning/30 bg-warning-soft',
  pending_review: 'text-warning-text border-warning/30 bg-warning-soft',
  hidden: 'text-fg-muted border-line bg-surface-2/60',
  archived: 'text-fg-muted border-line bg-surface-2/60',
  removed: 'text-danger-text border-danger/30 bg-danger-soft',
};
function StatusChip({ s }: { s: string }) {
  return <span className={`${chip} ${STATUS_TONE[s] || 'text-fg-muted border-line bg-surface-2/60'}`}>{s.replace('_', ' ')}</span>;
}

function Toggle({ checked, onChange, labelText }: { checked: boolean; onChange: (v: boolean) => void; labelText: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={labelText} onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? 'bg-success-soft border-success/30' : 'bg-surface-2 border-line'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-surface-2" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-line bg-surface p-6 space-y-5 shadow-pop">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className={btnGhost}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Finds a user by name, phone or email (GET /api/admin/users?search=) and returns their id. */
function UserPicker({ onPick, placeholder }: { onPick: (u: UserHit) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    const term = q.trim();
    if (term.length < 2) { setErr('Type at least 2 characters.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const data = await adminRequest<{ users?: UserHit[] }>(`/api/admin/users?limit=10&search=${encodeURIComponent(term)}`);
      setHits(data.users || []);
      if (!data.users?.length) setErr('No users match.');
    } catch (e) {
      setErr(errText(e, 'Search failed.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || 'Name, phone or email'} maxLength={64} />
        <button type="submit" disabled={busy} className={btnGhost}>{busy ? '…' : 'Find'}</button>
      </form>
      {err && <p className="text-xs text-warning-text">{err}</p>}
      {hits.length > 0 && (
        <ul className="rounded-xl border border-line divide-y divide-line">
          {hits.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => { onPick(u); setHits([]); setQ(''); }} className="w-full text-left px-3 py-2 hover:bg-surface-2/60">
                <span className="text-xs font-semibold text-fg">{u.name || 'Unnamed'}</span>
                <span className="ml-2 text-xs text-fg-muted">{u.email || u.phone || ''}</span>
                <span className="ml-2 text-xs font-mono text-fg-subtle">{shortId(u.id)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════

export default function ForumAdminPage() {
  const { isAuthed } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('communities');
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campusId, setCampusId] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const { mark, isFresh } = useFreshIds();

  // Data
  const [communities, setCommunities] = useState<Community[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [targets, setTargets] = useState<ReviewTarget[]>([]);
  const [reviews, setReviews] = useState<ReviewPost[]>([]);
  const [loading, setLoading] = useState<Record<Tab, boolean>>({ communities: false, guides: false, targets: false, reviews: false });
  const [loadErr, setLoadErr] = useState<Partial<Record<Tab, string>>>({});

  // Filters
  const [communityStatus, setCommunityStatus] = useState('');
  const [targetStatus, setTargetStatus] = useState('pending');
  const [targetKind, setTargetKind] = useState('');
  const [reviewStatus, setReviewStatus] = useState<string>('pending_review');

  const ok = (text: string) => setNotice({ kind: 'ok', text });
  const bad = (e: unknown, fallback: string) => setNotice({ kind: 'error', text: errText(e, fallback) });

  // Campuses (public list of active campuses)
  useEffect(() => {
    if (!isAuthed) return;
    adminRequest<Campus[]>('/api/campus/campuses')
      .then((list) => {
        const arr = Array.isArray(list) ? list : [];
        setCampuses(arr);
        setCampusId((cur) => cur || (arr[0]?.id ?? ''));
      })
      .catch((e) => bad(e, 'Could not load campuses.'));
  }, [isAuthed]);

  const campusName = useCallback((id: string) => campuses.find((c) => c.id === id)?.name || shortId(id), [campuses]);

  const guarded = useCallback(async <T,>(key: Tab, fn: () => Promise<T>, apply: (v: T) => void) => {
    setLoading((p) => ({ ...p, [key]: true }));
    try {
      apply(await fn());
      setLoadErr((p) => ({ ...p, [key]: undefined }));
    } catch (e) {
      setLoadErr((p) => ({ ...p, [key]: errText(e, 'Could not load.') }));
    } finally {
      setLoading((p) => ({ ...p, [key]: false }));
    }
  }, []);

  const loadCommunities = useCallback(() => guarded('communities',
    () => adminRequest<{ items: Community[] }>(`/api/campus/forum/admin/communities${qs({ campusId, status: communityStatus })}`),
    (d) => setCommunities(d.items || [])), [guarded, campusId, communityStatus]);
  const loadGuides = useCallback(() => guarded('guides',
    () => adminRequest<{ items: Guide[] }>(`/api/campus/forum/admin/freshers-guides${qs({ campusId })}`),
    (d) => setGuides(d.items || [])), [guarded, campusId]);
  const loadTargets = useCallback(() => guarded('targets',
    () => adminRequest<{ items: ReviewTarget[] }>(`/api/campus/forum/admin/review-targets${qs({ campusId, status: targetStatus, kind: targetKind })}`),
    (d) => setTargets(d.items || [])), [guarded, campusId, targetStatus, targetKind]);
  const loadReviews = useCallback(() => guarded('reviews',
    () => adminRequest<{ items: ReviewPost[] }>(`/api/campus/forum/admin/reviews${qs({ campusId, status: reviewStatus })}`),
    (d) => setReviews(d.items || [])), [guarded, campusId, reviewStatus]);

  // Counts shown on tabs (pending work) come from unfiltered pending queries.
  const [pending, setPending] = useState({ communities: 0, targets: 0, reviews: 0 });
  const loadPending = useCallback(async () => {
    if (!campusId) return;
    try {
      const [c, t, r] = await Promise.all([
        adminRequest<{ items: unknown[] }>(`/api/campus/forum/admin/communities${qs({ campusId, status: 'pending' })}`),
        adminRequest<{ items: unknown[] }>(`/api/campus/forum/admin/review-targets${qs({ campusId, status: 'pending' })}`),
        adminRequest<{ items: unknown[] }>(`/api/campus/forum/admin/reviews${qs({ campusId, status: 'pending_review' })}`),
      ]);
      setPending({ communities: c.items?.length || 0, targets: t.items?.length || 0, reviews: r.items?.length || 0 });
    } catch { /* counts are a hint only */ }
  }, [campusId]);

  useEffect(() => { if (isAuthed && campusId) { loadCommunities(); loadGuides(); } }, [isAuthed, campusId, loadCommunities, loadGuides]);
  useEffect(() => { if (isAuthed && campusId) loadTargets(); }, [isAuthed, campusId, loadTargets]);
  useEffect(() => { if (isAuthed && campusId) loadReviews(); }, [isAuthed, campusId, loadReviews]);
  useEffect(() => { if (isAuthed) loadPending(); }, [isAuthed, loadPending]);

  // Live: community requests, review-target requests and flagged reviews all emit friends_review.
  useLiveSync(['friends_review'], (events: LiveEvent[], meta) => {
    const scopes = new Set(events.map((e) => e.scope));
    if (meta.reconnect || scopes.has('community')) loadCommunities();
    if (meta.reconnect || scopes.has('review_target')) loadTargets();
    if (meta.reconnect || scopes.has('forum')) loadReviews();
    loadPending();
    mark(events.filter((e) => e.action === 'created' && e.id != null).map((e) => String(e.id)));
  }, { enabled: isAuthed });

  /** Runs an admin write, shows the result and reloads what it touched. */
  const act = async (fn: () => Promise<unknown>, success: string, reload: Array<() => unknown>) => {
    setBusy(true);
    try {
      await fn();
      ok(success);
      reload.forEach((r) => r());
      loadPending();
      return true;
    } catch (e) {
      bad(e, 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const post = (path: string, body?: unknown, method = 'POST') =>
    adminRequest(`/api/campus/forum/admin${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'communities', label: 'Communities', count: pending.communities },
    { id: 'guides', label: 'Freshers Guides' },
    { id: 'targets', label: 'Review targets', count: pending.targets },
    { id: 'reviews', label: 'Held reviews', count: pending.reviews },
  ];

  return (
    <div className="space-y-8 animate-fade-in relative pb-16">
      <div className="flex flex-wrap gap-4 items-end justify-between">
        <div>
          <Link href="/friends" className="text-xs font-semibold text-fg-muted hover:text-fg">← Friends config</Link>
          <h1 className="text-3xl font-semibold text-fg mt-1">Forum admin</h1>
          <p className="text-xs font-semibold text-fg-muted mt-1">Communities, moderators, Freshers Guides, review targets and held reviews</p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <span className={label}>Campus</span>
            <select className={`${input} min-w-[200px]`} value={campusId} onChange={(e) => setCampusId(e.target.value)} aria-label="Campus">
              {campuses.length === 0 && <option value="">No active campuses</option>}
              {campuses.map((c) => <option key={c.id} value={c.id} className="bg-surface">{c.name} ({c.code})</option>)}
            </select>
          </div>
          <Link href="/moderation" className={btnGhost}>Reports queue</Link>
        </div>
      </div>

      {notice && (
        <div role="status" className={`rounded-lg border px-4 py-3 text-xs font-semibold flex items-center justify-between gap-4 ${notice.kind === 'ok' ? 'border-success/30 bg-success-soft text-success-text' : 'border-danger/30 bg-danger-soft text-danger-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`${btn} border ${tab === t.id ? 'border-info/30 bg-info-soft text-info-text' : 'border-line bg-surface-2/60 text-fg-muted hover:text-fg'}`}>
            {t.label}
            {!!t.count && <span className="ml-2 rounded-md bg-warning-soft px-1.5 py-0.5 text-warning-text">{t.count}</span>}
          </button>
        ))}
      </div>

      {!campusId ? (
        <p className="text-xs text-fg-muted text-center py-16">Pick a campus to manage its forum.</p>
      ) : tab === 'communities' ? (
        <CommunitiesTab
          campusId={campusId} campusName={campusName(campusId)} items={communities} loading={loading.communities} error={loadErr.communities}
          status={communityStatus} setStatus={setCommunityStatus} reload={loadCommunities} busy={busy} act={act} post={post} isFresh={isFresh}
        />
      ) : tab === 'guides' ? (
        <GuidesTab communities={communities.filter((c) => c.status === 'active')} guides={guides} loading={loading.guides || loading.communities}
          error={loadErr.guides} busy={busy} act={act} post={post} reload={() => { loadGuides(); loadCommunities(); }} />
      ) : tab === 'targets' ? (
        <TargetsTab campusId={campusId} items={targets} loading={loading.targets} error={loadErr.targets} status={targetStatus} setStatus={setTargetStatus}
          kind={targetKind} setKind={setTargetKind} reload={loadTargets} busy={busy} act={act} post={post} isFresh={isFresh} />
      ) : (
        <ReviewsTab items={reviews} loading={loading.reviews} error={loadErr.reviews} status={reviewStatus} setStatus={setReviewStatus}
          reload={loadReviews} busy={busy} act={act} post={post} isFresh={isFresh} />
      )}
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, success: string, reload: Array<() => unknown>) => Promise<boolean>;
type Post = (path: string, body?: unknown, method?: string) => Promise<unknown>;

function LoadState({ loading, error, empty, reload, emptyText }: { loading: boolean; error?: string; empty: boolean; reload: () => void; emptyText: string }) {
  if (loading && empty) return <p className="text-xs text-fg-muted animate-pulse text-center py-12">Loading…</p>;
  if (error && empty) {
    return (
      <div className="text-center py-12">
        <p className="text-xs text-danger-text font-semibold">{error}</p>
        <button onClick={reload} className={`mt-3 ${btnGhost}`}>Try again</button>
      </div>
    );
  }
  if (empty) return <p className="text-xs text-fg-muted text-center py-12">{emptyText}</p>;
  return null;
}

// ── Communities ──────────────────────────────────────────────────────────────

interface CommunityDraft { name: string; slug: string; description: string; rules: string; allowAnonymous: boolean; allowedTypes: PostType[]; sortOrder: string }
const emptyDraft = (): CommunityDraft => ({ name: '', slug: '', description: '', rules: '', allowAnonymous: true, allowedTypes: POST_TYPES.filter((t) => t !== 'review'), sortOrder: '100' });
const draftOf = (c: Community): CommunityDraft => ({
  name: c.name, slug: c.slug, description: c.description || '', rules: (c.rules || []).join('\n'), allowAnonymous: c.allowAnonymous,
  allowedTypes: [...c.allowedTypes], sortOrder: String(c.sortOrder ?? 0),
});
const draftErrors = (d: CommunityDraft) => {
  const e: string[] = [];
  if (d.name.trim().length < 3 || d.name.trim().length > 60) e.push('Name must be 3-60 characters.');
  if (d.description.length > 300) e.push('Description: at most 300 characters.');
  const r = lines(d.rules);
  if (r.length > 10) e.push('At most 10 rules.');
  if (r.some((x) => x.length < 3 || x.length > 200)) e.push('Each rule must be 3-200 characters.');
  if (!d.allowedTypes.length) e.push('Allow at least one post type.');
  const s = Number(d.sortOrder);
  if (!Number.isInteger(s) || s < 0 || s > 10000) e.push('Sort order must be 0-10000.');
  return e;
};
const draftBody = (d: CommunityDraft) => ({
  name: d.name.trim(), description: d.description.trim(), rules: lines(d.rules), allowAnonymous: d.allowAnonymous,
  allowedTypes: d.allowedTypes, sortOrder: Number(d.sortOrder),
});

function CommunityForm({ draft, setDraft, isNew, isDefault }: { draft: CommunityDraft; setDraft: (d: CommunityDraft) => void; isNew: boolean; isDefault: boolean }) {
  const set = <K extends keyof CommunityDraft>(k: K, v: CommunityDraft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className={label}>Name ({draft.name.length}/60)</span>
          <input className={input} maxLength={60} value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        {isNew ? (
          <div>
            <span className={label}>Slug (optional)</span>
            <input className={input} maxLength={40} value={draft.slug} onChange={(e) => set('slug', e.target.value)} placeholder="made from the name" />
          </div>
        ) : (
          <div>
            <span className={label}>Slug</span>
            <p className="text-xs font-mono text-fg-muted py-2">{draft.slug}{isDefault ? ' · default community' : ''}</p>
          </div>
        )}
      </div>
      <div>
        <span className={label}>Description ({draft.description.length}/300)</span>
        <textarea className={`${input} min-h-[70px]`} maxLength={300} value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div>
        <span className={label}>Rules, one per line ({lines(draft.rules).length}/10)</span>
        <textarea className={`${input} min-h-[110px] text-xs`} value={draft.rules} onChange={(e) => set('rules', e.target.value)} />
      </div>
      <div>
        <span className={label}>Allowed post types</span>
        <div className="flex flex-wrap gap-2">
          {POST_TYPES.map((t) => {
            const on = draft.allowedTypes.includes(t);
            return (
              <button key={t} type="button" aria-pressed={on}
                onClick={() => set('allowedTypes', on ? draft.allowedTypes.filter((x) => x !== t) : [...draft.allowedTypes, t])}
                className={`${chip} ${on ? 'text-info-text border-info/30 bg-info-soft' : 'text-fg-muted border-line bg-surface-2/60'}`}>
                {TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>
        {draft.allowedTypes.includes('review') && <p className="text-xs text-fg-muted mt-1">Reviews are always anonymous and need a review target.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <Toggle checked={draft.allowAnonymous} onChange={(v) => set('allowAnonymous', v)} labelText="Allow anonymous posts" />
          <span className="text-xs text-fg-muted">Allow anonymous posts and comments</span>
        </div>
        <div>
          <span className={label}>Sort order</span>
          <input type="number" min={0} max={10000} className={`${input} w-28`} value={draft.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function CommunitiesTab(props: {
  campusId: string; campusName: string; items: Community[]; loading: boolean; error?: string; status: string; setStatus: (s: string) => void;
  reload: () => void; busy: boolean; act: Act; post: Post; isFresh: (id: string) => boolean;
}) {
  const confirm = useConfirm();
  const { campusId, campusName, items, loading, error, status, setStatus, reload, busy, act, post, isFresh } = props;
  const [creating, setCreating] = useState<CommunityDraft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((c) => c.id === openId) || null;
  const pendingReqs = items.filter((c) => c.status === 'pending');

  const seed = () => act(() => post('/seed', { campusId }), `Default communities checked for ${campusName}.`, [reload]);
  const decide = async (c: Community, approve: boolean) => {
    if (!approve && !(await confirm({ title: `Reject the request "${c.name}"? It will be archived.` }))) return;
    act(() => post(`/communities/${c.id}`, { status: approve ? 'active' : 'archived' }, 'PUT'),
      approve ? `"${c.name}" approved. The requester is now its owner.` : `"${c.name}" rejected.`, [reload]);
  };

  return (
    <div className="space-y-6">
      {pendingReqs.length > 0 && status !== 'pending' && (
        <section className={`${card} border border-warning/30`}>
          <h2 className="text-sm font-semibold text-warning-text">Community requests ({pendingReqs.length})</h2>
          <div className="space-y-2">
            {pendingReqs.map((c) => (
              <div key={c.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/60 p-4 ${isFresh(c.id) ? FRESH_ROW_CLASS : ''}`}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-fg">{c.name} <span className="text-xs font-mono text-fg-muted">/{c.slug}</span></p>
                  {c.description && <p className="text-xs text-fg-muted">{c.description}</p>}
                  {c.rules.length > 0 && <p className="text-xs text-fg-muted mt-1">Rules: {c.rules.join(' · ')}</p>}
                  <p className="text-xs text-fg-subtle mt-1">Requested {fmt(c.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => decide(c, true)} className={btnGo}>Approve</button>
                  <button disabled={busy} onClick={() => decide(c, false)} className={btnWarn}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={card}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">Communities · {campusName}</h2>
            <p className="text-xs text-fg-muted">The 8 default communities are created automatically and cannot be archived. Custom ones come from admins or approved student requests.</p>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <select aria-label="Status filter" className={`${input} w-36`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="" className="bg-surface">All statuses</option>
              {COMMUNITY_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s}</option>)}
            </select>
            <button disabled={busy} onClick={seed} className={btnGhost} title="Creates any missing default community; never changes existing ones">Re-check defaults</button>
            <button onClick={() => setCreating(emptyDraft())} className={btnGo}>+ New community</button>
            <button onClick={reload} disabled={loading} className={btnBlue}>↻</button>
          </div>
        </div>

        <LoadState loading={loading} error={error} empty={!items.length} reload={reload} emptyText="No communities match. Use “Re-check defaults” to create the default set." />
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="zv-table">
              <thead>
                <tr className="text-xs font-semibold text-fg-muted border-b border-line">
                  <th className="px-3 py-2">Community</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Members</th>
                  <th className="px-3 py-2">Posts</th><th className="px-3 py-2">Moderators</th><th className="px-3 py-2">Anon</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {items.map((c) => (
                  <tr key={c.id} className={`hover:bg-surface-2/60 ${isFresh(c.id) ? FRESH_ROW_CLASS : ''}`}>
                    <td className="px-3 py-3">
                      <p className="text-xs font-semibold text-fg">{c.name} {c.kind === 'default' && <span className={`${chip} ml-1 text-info-text border-info/30 bg-info-soft`}>default</span>}</p>
                      <p className="text-xs font-mono text-fg-muted">/{c.slug}</p>
                    </td>
                    <td className="px-3 py-3"><StatusChip s={c.status} /></td>
                    <td className="px-3 py-3 text-xs text-fg-muted">{c.memberCount}</td>
                    <td className="px-3 py-3 text-xs text-fg-muted">{c.postCount}</td>
                    <td className="px-3 py-3 text-xs text-fg-muted">
                      {c.moderators.length ? c.moderators.map((m) => `${m.user?.name || shortId(m.userId)}${m.role === 'owner' ? ' (owner)' : ''}`).join(', ') : <span className="text-fg-subtle">None</span>}
                    </td>
                    <td className="px-3 py-3 text-xs text-fg-muted">{c.allowAnonymous ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-3 text-right"><button onClick={() => setOpenId(c.id)} className={btnGhost}>Manage</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <Drawer title={`New community · ${campusName}`} onClose={() => setCreating(null)}>
          <CommunityForm draft={creating} setDraft={setCreating} isNew isDefault={false} />
          {draftErrors(creating).length > 0 && <ul className="text-xs text-danger-text font-semibold space-y-0.5">{draftErrors(creating).map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(null)} className={btnGhost}>Cancel</button>
            <button disabled={busy || draftErrors(creating).length > 0} className={btnGo}
              onClick={async () => {
                const body = { ...draftBody(creating), campusId, ...(creating.slug.trim() ? { slug: creating.slug.trim() } : {}) };
                if (await act(() => post('/communities', body), `"${body.name}" created and live.`, [reload])) setCreating(null);
              }}>
              {busy ? 'Saving…' : 'Create (active)'}
            </button>
          </div>
        </Drawer>
      )}

      {open && <CommunityDrawer key={open.id} c={open} onClose={() => setOpenId(null)} busy={busy} act={act} post={post} reload={reload} />}
    </div>
  );
}

function CommunityDrawer({ c, onClose, busy, act, post, reload }: { c: Community; onClose: () => void; busy: boolean; act: Act; post: Post; reload: () => void }) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState<CommunityDraft>(() => draftOf(c));
  const [pick, setPick] = useState<UserHit | null>(null);
  const [role, setRole] = useState<'moderator' | 'owner'>('moderator');
  const [log, setLog] = useState<ModLogItem[] | null>(null);
  const [logCursor, setLogCursor] = useState<string | null>(null);
  const [logErr, setLogErr] = useState<string | null>(null);
  const errs = draftErrors(draft);

  const loadLog = useCallback(async (cursor: string | null) => {
    try {
      const d = await adminRequest<{ items: ModLogItem[]; nextCursor: string | null }>(`/api/campus/forum/admin/communities/${c.id}/modlog${qs({ cursor })}`);
      setLog((p) => (cursor && p ? [...p, ...d.items] : d.items));
      setLogCursor(d.nextCursor || null);
      setLogErr(null);
    } catch (e) {
      setLogErr(errText(e, 'Could not load the mod log.'));
    }
  }, [c.id]);
  useEffect(() => { loadLog(null); }, [loadLog]);

  const save = () => {
    const body: Record<string, unknown> = draftBody(draft);
    act(() => post(`/communities/${c.id}`, body, 'PUT'), 'Community saved.', [reload]);
  };
  const setStatus = async (s: string) => {
    const msg = s === 'archived' ? `Archive "${c.name}"? Students will no longer see it.` : `Make "${c.name}" ${s}?`;
    if (!(await confirm({ title: msg }))) return;
    act(() => post(`/communities/${c.id}`, { status: s }, 'PUT'), `Status set to ${s}.`, [reload]);
  };
  const addMod = () => {
    if (!pick) return;
    act(() => post(`/communities/${c.id}/moderators`, { userId: pick.id, role }), `${pick.name || 'User'} is now ${role === 'owner' ? 'the owner' : 'a moderator'}.`, [reload, () => loadLog(null)])
      .then((okay) => { if (okay) setPick(null); });
  };
  const removeMod = async (m: ModeratorRow) => {
    if (!(await confirm({ title: `Remove ${m.user?.name || 'this user'} as ${m.role}?` }))) return;
    act(() => post(`/communities/${c.id}/moderators/${m.userId}`, undefined, 'DELETE'), 'Moderator removed.', [reload, () => loadLog(null)]);
  };

  return (
    <Drawer title={c.name} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip s={c.status} />
        <span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>{c.kind}</span>
        <span className="text-xs text-fg-muted">{c.memberCount} members · {c.postCount} posts</span>
      </div>

      <section className="space-y-3">
        <CommunityForm draft={draft} setDraft={setDraft} isNew={false} isDefault={c.kind === 'default'} />
        {errs.length > 0 && <ul className="text-xs text-danger-text font-semibold space-y-0.5">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="flex flex-wrap justify-end gap-2">
          {c.status === 'pending' && <button disabled={busy} onClick={() => setStatus('active')} className={btnGo}>Approve request</button>}
          {c.status === 'archived' && <button disabled={busy} onClick={() => setStatus('active')} className={btnGhost}>Reactivate</button>}
          {c.kind !== 'default' && c.status !== 'archived' && <button disabled={busy} onClick={() => setStatus('archived')} className={btnWarn}>{c.status === 'pending' ? 'Reject' : 'Archive'}</button>}
          <button disabled={busy || errs.length > 0} onClick={save} className={btnGo}>Save changes</button>
        </div>
      </section>

      <section className="space-y-3 border-t border-line pt-5">
        <h3 className="text-xs font-semibold text-fg">Moderators</h3>
        <p className="text-xs text-fg-muted">Moderators can pin, lock, remove and restore posts and comments in this community only. They cannot act on their own content, and only admins approve faculty reviews. Karma never grants this role.</p>
        {c.moderators.length === 0 ? <p className="text-xs text-fg-subtle">No moderators yet.</p> : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {c.moderators.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-xs text-fg">{m.user?.name || 'Unknown'} <span className="text-xs font-mono text-fg-muted">{shortId(m.userId)}</span>
                  <span className={`${chip} ml-2 ${m.role === 'owner' ? 'text-warning-text border-warning/30 bg-warning-soft' : 'text-info-text border-info/30 bg-info-soft'}`}>{m.role}</span></span>
                <button disabled={busy} onClick={() => removeMod(m)} className="text-xs font-semibold text-danger-text hover:text-danger-text disabled:opacity-40">Remove</button>
              </li>
            ))}
          </ul>
        )}
        {c.status === 'active' && (
          <div className="rounded-xl border border-line p-3 space-y-2">
            <span className={label}>Add a moderator (must be a verified student of this campus)</span>
            {pick ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-fg font-semibold">{pick.name || 'Unnamed'}</span>
                <span className="text-xs font-mono text-fg-muted">{shortId(pick.id)}</span>
                <select aria-label="Role" className={`${input} w-36`} value={role} onChange={(e) => setRole(e.target.value as 'moderator' | 'owner')}>
                  <option value="moderator" className="bg-surface">Moderator</option>
                  <option value="owner" className="bg-surface">Owner</option>
                </select>
                <button disabled={busy} onClick={addMod} className={btnGo}>Grant</button>
                <button onClick={() => setPick(null)} className={btnGhost}>Change</button>
              </div>
            ) : <UserPicker onPick={setPick} />}
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-line pt-5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-fg">Mod log</h3>
          <button onClick={() => loadLog(null)} className="text-xs font-semibold text-info-text">↻</button>
        </div>
        {logErr && <p className="text-xs text-danger-text">{logErr}</p>}
        {log === null ? <p className="text-xs text-fg-muted animate-pulse">Loading…</p> : log.length === 0 ? <p className="text-xs text-fg-subtle">No moderator actions yet.</p> : (
          <ul className="space-y-1.5">
            {log.map((a) => (
              <li key={a.id} className="rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-fg-muted">
                <span className="font-semibold text-fg">{a.action.replace(/_/g, ' ')}</span>
                <span className="text-fg-muted"> · {a.targetType} {shortId(a.targetId)} · {a.moderator?.name || a.actorRole}</span>
                {a.reason && <span className="block text-fg-muted">“{a.reason}”</span>}
                <span className="block text-xs text-fg-subtle">{fmt(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {logCursor && <button onClick={() => loadLog(logCursor)} className={btnGhost}>Load more</button>}
      </section>
    </Drawer>
  );
}

// ── Freshers Guides ──────────────────────────────────────────────────────────

function GuidesTab({ communities, guides, loading, error, busy, act, post, reload }: {
  communities: Community[]; guides: Guide[]; loading: boolean; error?: string; busy: boolean; act: Act; post: Post; reload: () => void;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const guideOf = useMemo(() => new Map(guides.map((g) => [g.communityId, g])), [guides]);
  const editing = communities.find((c) => c.id === editId) || null;

  return (
    <section className={card}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">Freshers Guides</h2>
          <p className="text-xs text-fg-muted">One pinned guide per community. Guides written here carry the Official label unless you switch it off. Community moderators can also write one, labelled Student advice.</p>
        </div>
        <button onClick={reload} disabled={loading} className={btnBlue}>↻ Reload</button>
      </div>
      <LoadState loading={loading} error={error} empty={!communities.length} reload={reload} emptyText="No active communities on this campus yet." />
      <div className="grid md:grid-cols-2 gap-3">
        {communities.map((c) => {
          const g = guideOf.get(c.id);
          return (
            <div key={c.id} className="rounded-lg border border-line bg-surface-2/60 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-fg">{c.name}</p>
                {g ? <span className={`${chip} ${g.isOfficial ? 'text-info-text border-info/30 bg-info-soft' : 'text-fg-muted border-line bg-surface-2/60'}`}>{g.isOfficial ? 'Official' : 'Student advice'}</span>
                  : <span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>No guide</span>}
              </div>
              {g ? (
                <>
                  <p className="text-xs font-semibold text-fg">{g.title}</p>
                  <p className="text-xs text-fg-muted line-clamp-3 whitespace-pre-line">{g.body}</p>
                  <p className="text-xs text-fg-subtle">Updated {fmt(g.updatedAt)}{g.status !== 'visible' ? ` · ${g.status.replace('_', ' ')}` : ''}</p>
                </>
              ) : <p className="text-xs text-fg-subtle">Nothing pinned yet. Students see no guide until one is written.</p>}
              <button onClick={() => setEditId(c.id)} className={btnGhost}>{g ? 'Edit guide' : 'Write guide'}</button>
            </div>
          );
        })}
      </div>
      {editing && (
        <GuideDrawer key={editing.id} c={editing} guide={guideOf.get(editing.id) || null} onClose={() => setEditId(null)} busy={busy} act={act} post={post} reload={reload} />
      )}
    </section>
  );
}

function GuideDrawer({ c, guide, onClose, busy, act, post, reload }: { c: Community; guide: Guide | null; onClose: () => void; busy: boolean; act: Act; post: Post; reload: () => void }) {
  const [title, setTitle] = useState(guide?.title || '');
  const [body, setBody] = useState(guide?.body || '');
  const [official, setOfficial] = useState(guide ? guide.isOfficial : true);
  const errs: string[] = [];
  if (title.trim().length < 5 || title.trim().length > 150) errs.push('Title must be 5-150 characters.');
  if (body.trim().length < 20 || body.trim().length > 5000) errs.push('Guide text must be 20-5000 characters.');
  const save = async () => {
    if (await act(() => post(`/communities/${c.id}/freshers-guide`, { title: title.trim(), body: body.trim(), official }, 'PUT'),
      guide ? 'Guide updated.' : 'Guide published and pinned.', [reload])) onClose();
  };
  return (
    <Drawer title={`Freshers Guide · ${c.name}`} onClose={onClose}>
      <p className="text-xs text-fg-muted">Write only what the campus has actually confirmed. Students rely on this as the first thing they read.</p>
      <div>
        <span className={label}>Title ({title.length}/150)</span>
        <input className={input} maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <span className={label}>Guide ({body.length}/5000)</span>
        <textarea className={`${input} min-h-[320px] text-xs leading-relaxed`} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <Toggle checked={official} onChange={setOfficial} labelText="Official label" />
        <span className="text-xs text-fg-muted">{official ? 'Labelled Official (from the ZCS team / campus)' : 'Labelled Student advice'}</span>
      </div>
      {errs.length > 0 && <ul className="text-xs text-danger-text font-semibold space-y-0.5">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnGhost}>Cancel</button>
        <button disabled={busy || errs.length > 0} onClick={save} className={btnGo}>{busy ? 'Saving…' : guide ? 'Save guide' : 'Publish guide'}</button>
      </div>
    </Drawer>
  );
}

// ── Review targets ───────────────────────────────────────────────────────────

interface TargetDraft { kind: ReviewKind; name: string; department: string; code: string; block: string; facultyUserId: string; facultyName: string; entityId: string; status: string }
const targetDraftOf = (t?: ReviewTarget): TargetDraft => ({
  kind: t?.kind || 'course', name: t?.name || '', department: t?.adminMeta?.department || '', code: t?.adminMeta?.code || '',
  block: t?.adminMeta?.block || '', facultyUserId: t?.adminMeta?.facultyUserId || '', facultyName: '', entityId: t?.adminMeta?.entityId || '',
  status: t?.status || 'active',
});
const targetErrors = (d: TargetDraft) => {
  const e: string[] = [];
  if (d.name.trim().length < 2 || d.name.trim().length > 120) e.push('Name must be 2-120 characters.');
  for (const [k, v] of [['Department', d.department], ['Code', d.code], ['Block', d.block]] as const) if (v.length > 60) e.push(`${k}: at most 60 characters.`);
  if (d.facultyUserId && !UUID_RE.test(d.facultyUserId)) e.push('Faculty user id is not a valid id.');
  if (d.entityId && !UUID_RE.test(d.entityId)) e.push('Entity id is not a valid id.');
  return e;
};
const targetMeta = (d: TargetDraft) => {
  const m: Record<string, string> = {};
  if (d.department.trim()) m.department = d.department.trim();
  if (d.code.trim()) m.code = d.code.trim();
  if (d.block.trim()) m.block = d.block.trim();
  if (d.facultyUserId.trim()) m.facultyUserId = d.facultyUserId.trim();
  if (d.entityId.trim()) m.entityId = d.entityId.trim();
  return m;
};

function TargetForm({ d, set, isNew }: { d: TargetDraft; set: (d: TargetDraft) => void; isNew: boolean }) {
  const up = <K extends keyof TargetDraft>(k: K, v: TargetDraft[K]) => set({ ...d, [k]: v });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className={label}>Kind</span>
          {isNew ? (
            <select className={input} value={d.kind} onChange={(e) => up('kind', e.target.value as ReviewKind)}>
              {REVIEW_KINDS.map((k) => <option key={k} value={k} className="bg-surface">{KIND_LABEL[k]}</option>)}
            </select>
          ) : <p className="text-xs text-fg-muted py-2">{KIND_LABEL[d.kind]}</p>}
        </div>
        <div>
          <span className={label}>Name ({d.name.length}/120)</span>
          <input className={input} maxLength={120} value={d.name} onChange={(e) => up('name', e.target.value)} placeholder={d.kind === 'professor' ? 'Dr. Full Name' : d.kind === 'course' ? 'Course title' : ''} />
        </div>
        <div>
          <span className={label}>Department</span>
          <input className={input} maxLength={60} value={d.department} onChange={(e) => up('department', e.target.value)} />
        </div>
        <div>
          <span className={label}>{d.kind === 'course' ? 'Course code' : 'Code'}</span>
          <input className={input} maxLength={60} value={d.code} onChange={(e) => up('code', e.target.value)} />
        </div>
        {(d.kind === 'hostel' || d.kind === 'mess') && (
          <div>
            <span className={label}>Block</span>
            <input className={input} maxLength={60} value={d.block} onChange={(e) => up('block', e.target.value)} />
          </div>
        )}
        {!isNew && (
          <div>
            <span className={label}>Status</span>
            <select className={input} value={d.status} onChange={(e) => up('status', e.target.value)}>
              {TARGET_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s}</option>)}
            </select>
          </div>
        )}
      </div>

      {d.kind === 'professor' && (
        <div className="rounded-xl border border-line p-3 space-y-2">
          <span className={label}>Linked faculty account (right of reply)</span>
          <p className="text-xs text-fg-muted">The professor can reply to reviews only if linked here and their campus profile has the faculty role. Reviewers are never shown to them.</p>
          {d.facultyUserId ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-fg">{d.facultyName || 'Linked user'}</span>
              <span className="text-xs font-mono text-fg-muted">{d.facultyUserId}</span>
              <button type="button" onClick={() => set({ ...d, facultyUserId: '', facultyName: '' })} className="text-xs font-semibold text-danger-text">{isNew ? 'Unlink' : 'Change'}</button>
            </div>
          ) : <UserPicker onPick={(u) => set({ ...d, facultyUserId: u.id, facultyName: u.name || '' })} placeholder="Find the professor's account" />}
          {!isNew && !d.facultyUserId && <p className="text-xs text-fg-subtle">Any current link stays until you pick another account.</p>}
        </div>
      )}
      {d.kind === 'club' && (
        <div>
          <span className={label}>Club entity id (its managers may reply)</span>
          <input className={`${input} font-mono text-xs`} value={d.entityId} onChange={(e) => up('entityId', e.target.value.trim())} placeholder="Verified entity id" />
        </div>
      )}
    </div>
  );
}

function TargetsTab(props: {
  campusId: string; items: ReviewTarget[]; loading: boolean; error?: string; status: string; setStatus: (s: string) => void; kind: string; setKind: (s: string) => void;
  reload: () => void; busy: boolean; act: Act; post: Post; isFresh: (id: string) => boolean;
}) {
  const ask = usePrompt();
  const { campusId, items, loading, error, status, setStatus, kind, setKind, reload, busy, act, post, isFresh } = props;
  const [creating, setCreating] = useState<TargetDraft | null>(null);
  const [edit, setEdit] = useState<{ t: ReviewTarget; d: TargetDraft } | null>(null);

  const decide = async (t: ReviewTarget, approve: boolean) => {
    let reason: string | null = '';
    if (!approve) {
      reason = (await ask({ title: `Reject "${t.name}"? Optional reason (kept in the audit log):`, label: 'Reason', defaultValue: '' }));
      if (reason === null) return;
    }
    act(() => post(`/review-targets/${t.id}/${approve ? 'approve' : 'reject'}`, reason ? { reason: reason.slice(0, 300) } : {}),
      approve ? `"${t.name}" is now open for reviews.` : `"${t.name}" rejected.`, [reload]);
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">Review targets</h2>
          <p className="text-xs text-fg-muted">Students can request courses, hostels, messes, clubs and placements; they wait here. Professor pages are created by admins only. Check that a requested name is real and not a duplicate before approving.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <select aria-label="Status filter" className={`${input} w-32`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="" className="bg-surface">All statuses</option>
            {TARGET_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s}</option>)}
          </select>
          <select aria-label="Kind filter" className={`${input} w-32`} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="" className="bg-surface">All kinds</option>
            {REVIEW_KINDS.map((k) => <option key={k} value={k} className="bg-surface">{KIND_LABEL[k]}</option>)}
          </select>
          <button onClick={() => setCreating(targetDraftOf())} className={btnGo}>+ New target</button>
          <button onClick={reload} disabled={loading} className={btnBlue}>↻</button>
        </div>
      </div>

      <LoadState loading={loading} error={error} empty={!items.length} reload={reload}
        emptyText={status === 'pending' ? 'No requests waiting.' : 'No review targets match.'} />
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="zv-table">
            <thead>
              <tr className="text-xs font-semibold text-fg-muted border-b border-line">
                <th className="px-3 py-2">Target</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reviews</th><th className="px-3 py-2">Avg</th><th className="px-3 py-2">Added</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {items.map((t) => (
                <tr key={t.id} className={`hover:bg-surface-2/60 ${isFresh(t.id) ? FRESH_ROW_CLASS : ''}`}>
                  <td className="px-3 py-3">
                    <p className="text-xs font-semibold text-fg">{t.name}</p>
                    <p className="text-xs text-fg-muted">{[t.adminMeta.department, t.adminMeta.code, t.adminMeta.block].filter(Boolean).join(' · ') || '-'}
                      {t.kind === 'professor' && (t.adminMeta.facultyUserId ? <span className="ml-2 text-success-text">faculty linked</span> : <span className="ml-2 text-fg-subtle">no faculty link</span>)}</p>
                  </td>
                  <td className="px-3 py-3 text-xs text-fg-muted">{KIND_LABEL[t.kind]}</td>
                  <td className="px-3 py-3"><StatusChip s={t.status} /></td>
                  <td className="px-3 py-3 text-xs text-fg-muted">{t.reviewCount}</td>
                  <td className="px-3 py-3 text-xs text-fg-muted">{t.average ?? '-'}</td>
                  <td className="px-3 py-3 text-xs text-fg-muted">{fmt(t.createdAt)}</td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      {t.status === 'pending' && <>
                        <button disabled={busy} onClick={() => decide(t, true)} className={btnGo}>Approve</button>
                        <button disabled={busy} onClick={() => decide(t, false)} className={btnWarn}>Reject</button>
                      </>}
                      <button onClick={() => setEdit({ t, d: targetDraftOf(t) })} className={btnGhost}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Drawer title="New review target" onClose={() => setCreating(null)}>
          <TargetForm d={creating} set={setCreating} isNew />
          {targetErrors(creating).length > 0 && <ul className="text-xs text-danger-text font-semibold space-y-0.5">{targetErrors(creating).map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(null)} className={btnGhost}>Cancel</button>
            <button disabled={busy || targetErrors(creating).length > 0} className={btnGo}
              onClick={async () => {
                const body = { campusId, kind: creating.kind, name: creating.name.trim(), meta: targetMeta(creating) };
                if (await act(() => post('/review-targets', body), `"${body.name}" created and open for reviews.`, [reload])) setCreating(null);
              }}>Create (active)</button>
          </div>
        </Drawer>
      )}

      {edit && (
        <Drawer title={`Edit · ${edit.t.name}`} onClose={() => setEdit(null)}>
          <TargetForm d={edit.d} set={(d) => setEdit({ ...edit, d })} isNew={false} />
          {targetErrors(edit.d).length > 0 && <ul className="text-xs text-danger-text font-semibold space-y-0.5">{targetErrors(edit.d).map((e) => <li key={e}>{e}</li>)}</ul>}
          {edit.d.status === 'hidden' && edit.t.status !== 'hidden' && <p className="text-xs text-warning-text">Hiding removes this page from search and the review list. Existing reviews stay stored.</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEdit(null)} className={btnGhost}>Cancel</button>
            <button disabled={busy || targetErrors(edit.d).length > 0} className={btnGo}
              onClick={async () => {
                const body: Record<string, unknown> = { meta: targetMeta(edit.d) };
                if (edit.d.name.trim() !== edit.t.name) body.name = edit.d.name.trim();
                if (edit.d.status !== edit.t.status) body.status = edit.d.status;
                if (await act(() => post(`/review-targets/${edit.t.id}`, body, 'PUT'), 'Review target saved.', [reload])) setEdit(null);
              }}>Save</button>
          </div>
        </Drawer>
      )}
    </section>
  );
}

// ── Held reviews ─────────────────────────────────────────────────────────────

const CONTEXT_LABEL: Record<string, string> = {
  course: 'Course', section: 'Section', semester: 'Semester', year: 'Year', role: 'Role', company: 'Company', roomType: 'Room', attendance: 'Attendance', grade: 'Grade',
};

function ReviewsTab({ items, loading, error, status, setStatus, reload, busy, act, post, isFresh }: {
  items: ReviewPost[]; loading: boolean; error?: string; status: string; setStatus: (s: string) => void; reload: () => void;
  busy: boolean; act: Act; post: Post; isFresh: (id: string) => boolean;
}) {
  const notifyError = useToast().error;
  const ask = usePrompt();
  const confirm = useConfirm();
  const [replyFor, setReplyFor] = useState<ReviewPost | null>(null);
  const [reply, setReply] = useState('');

  const moderate = async (p: ReviewPost, action: 'approve' | 'remove' | 'restore') => {
    let reason: string | null = '';
    if (action === 'remove') {
      reason = (await ask({ title: 'Reason for removal (the reviewer sees it and can appeal):', label: 'Reason', defaultValue: '' }));
      if (reason === null) return;
      if (reason.trim().length < 3) { notifyError('Give a reason of at least 3 characters.'); return; }
    } else if (action === 'approve' && !(await confirm({ title: 'Publish this review? It will count towards the rating.' }))) return;
    act(() => post(`/posts/${p.id}/${action}`, reason ? { reason: reason.trim().slice(0, 300) } : {}),
      action === 'approve' ? 'Review published.' : action === 'remove' ? 'Review removed. The reviewer was notified.' : 'Review restored.', [reload]);
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">Held reviews</h2>
          <p className="text-xs text-fg-muted">Reviews with allegations (bribery, harassment, …) or address hints wait here for a human. A low rating alone is never a reason to remove a review. The reviewer is never shown; use “Reveal author” in the reports queue only when legally required (logged).</p>
        </div>
        <div className="flex gap-2 items-end">
          <select aria-label="Review status" className={`${input} w-40`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {REVIEW_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s.replace('_', ' ')}</option>)}
          </select>
          <button onClick={reload} disabled={loading} className={btnBlue}>↻</button>
        </div>
      </div>

      <LoadState loading={loading} error={error} empty={!items.length} reload={reload}
        emptyText={status === 'pending_review' ? 'No reviews waiting. Nice.' : 'No reviews with this status.'} />
      <div className="space-y-3">
        {items.map((p) => {
          const rv = p.review;
          const ctx = rv ? Object.entries(rv.context || {}).filter(([, v]) => v !== null && v !== undefined && v !== '') : [];
          return (
            <article key={p.id} className={`rounded-lg border border-line bg-surface-2/60 p-4 space-y-3 ${rv && isFresh(rv.id) ? FRESH_ROW_CLASS : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {rv?.target && <span className="text-xs font-semibold text-fg">{rv.target.name}</span>}
                  {rv?.target && <span className={`${chip} text-info-text border-info/30 bg-info-soft`}>{KIND_LABEL[rv.target.kind] || rv.target.kind}</span>}
                  {rv && <span className="text-xs text-warning-text font-semibold" aria-label={`${rv.rating} of 5`}>{'★'.repeat(rv.rating)}<span className="text-fg-subtle">{'★'.repeat(5 - rv.rating)}</span></span>}
                  <StatusChip s={rv?.status || p.status} />
                </div>
                <span className="text-xs text-fg-muted">{p.community?.name} · {p.author?.alias || 'Anonymous'} · {fmt(p.createdAt)}{p.editedAt ? ' (edited)' : ''}</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-fg">{p.title}</p>
                {p.body && <p className="text-xs text-fg-muted whitespace-pre-line mt-1">{p.body}</p>}
              </div>
              {rv && (rv.pros || rv.cons) && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {rv.pros && <div className="rounded-xl bg-success-soft border border-success/30 p-3"><span className={label}>Pros</span><p className="text-xs text-fg-muted whitespace-pre-line">{rv.pros}</p></div>}
                  {rv.cons && <div className="rounded-xl bg-danger-soft border border-danger/30 p-3"><span className={label}>Cons</span><p className="text-xs text-fg-muted whitespace-pre-line">{rv.cons}</p></div>}
                </div>
              )}
              {(rv?.periodLabel || ctx.length > 0) && (
                <p className="text-xs text-fg-muted">
                  {rv?.periodLabel && <span className="mr-3">Period: {rv.periodLabel}</span>}
                  {ctx.map(([k, v]) => <span key={k} className="mr-3">{CONTEXT_LABEL[k] || k}: {String(v)}</span>)}
                </p>
              )}
              {rv?.response && (
                <div className="rounded-xl border border-info/30 bg-info-soft p-3">
                  <span className={label}>Reply · {rv.response.responder?.name || rv.response.responderRole}</span>
                  <p className="text-xs text-fg-muted whitespace-pre-line">{rv.response.body}</p>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {p.status === 'pending_review' && <button disabled={busy} onClick={() => moderate(p, 'approve')} className={btnGo}>Publish</button>}
                {(p.status === 'removed' || p.status === 'hidden') && <button disabled={busy} onClick={() => moderate(p, 'restore')} className={btnGo}>Restore</button>}
                {p.status !== 'removed' && <button disabled={busy} onClick={() => moderate(p, 'remove')} className={btnWarn}>Remove</button>}
                {rv && !rv.response && p.status === 'visible' && <button onClick={() => { setReplyFor(p); setReply(''); }} className={btnGhost}>Team reply</button>}
              </div>
            </article>
          );
        })}
      </div>

      {replyFor?.review && (
        <Drawer title="Reply as the ZCS Friends team" onClose={() => setReplyFor(null)}>
          <p className="text-xs text-fg-muted">Shown under the review, labelled “ZCS Friends team”. One reply per review. Faculty can reply themselves if their account is linked to the review page.</p>
          <blockquote className="rounded-xl border border-line bg-surface-2/60 p-3 text-xs text-fg-muted whitespace-pre-line">{replyFor.title}{replyFor.body ? `\n${replyFor.body}` : ''}</blockquote>
          <div>
            <span className={label}>Reply ({reply.length}/1500)</span>
            <textarea className={`${input} min-h-[160px]`} maxLength={1500} value={reply} onChange={(e) => setReply(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setReplyFor(null)} className={btnGhost}>Cancel</button>
            <button disabled={busy || reply.trim().length < 10} className={btnGo}
              onClick={async () => {
                const id = replyFor.review!.id;
                if (await act(() => post(`/reviews/${id}/response`, { body: reply.trim() }), 'Reply posted.', [reload])) setReplyFor(null);
              }}>Post reply</button>
          </div>
        </Drawer>
      )}
    </section>
  );
}
