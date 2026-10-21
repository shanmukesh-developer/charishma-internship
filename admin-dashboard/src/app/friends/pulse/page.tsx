"use client";
import { useConfirm, usePrompt, useToast } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest, uploadImage } from '@/lib/api';
import { useLiveSync, useFreshIds, FRESH_ROW_CLASS, type LiveEvent } from '@/lib/useLiveSync';

/**
 * Zenvy Friends > Pulse admin.
 *  Overview   24 h stats, live trends, re-run of the whisper import (decision D3)
 *             backend: /api/campus/pulse/admin/{stats,trends,backfill-whispers}
 *  Posts      browse Pulse posts and replies; approve / hide / remove / restore (audited, appealable)
 *             backend: /api/campus/pulse/admin/posts
 *  Entities   verified clubs, departments and official accounts that students can post as
 *             backend: /api/campus/mod/entities (F0)
 *  Badges     grant / revoke admin badges (backend: /api/campus/mod/badges, F0)
 *
 * All of it works while the pulse flag is off. Reports on Pulse content are handled in /moderation
 * (subTab "pulse"). Anonymous authors are never shown here; "Reveal author" lives only in
 * /moderation and is logged.
 */

// ── Contract (mirrors backend/modules/friends/models/{pulse,foundation}/enums.js) ─
const POST_STATUS = ['visible', 'pending_review', 'hidden', 'removed', 'deleted'] as const;
const ENTITY_TYPES = ['club', 'department', 'vendor', 'official'] as const;
type EntityType = typeof ENTITY_TYPES[number];
const ENTITY_TYPE_LABEL: Record<EntityType, string> = { club: 'Club', department: 'Department', vendor: 'Vendor', official: 'Official' };
const KNOWN_BADGES = ['helpful_answer', 'community_helper', 'resource_sharer', 'top_contributor'];

interface Campus { id: string; name: string; code: string }
interface UserHit { id: string; name: string | null; phone?: string | null; email?: string | null }
interface EntityRef { id: string; type: string; name: string; handle: string; avatarUrl: string | null; verified: boolean }
type Author =
  | { anonymous: true; alias: string }
  | { anonymous?: false; userId?: string | null; name?: string | null; avatarUrl?: string | null; verified?: boolean; badges?: string[]; entity?: EntityRef | null };
interface PollOpt { idx: number; label: string; votes?: number }
interface AdminPost {
  kind: 'post' | 'reply'; id: string; rootId: string | null; parentId: string | null; text: string; hashtags: string[];
  media: Array<{ mediaId: string; url: string | null }>; link: { url: string; host: string } | null;
  poll: { id: string; options: PollOpt[]; totalVotes?: number; closesAt: string; closed: boolean } | null;
  author: Author; replyPolicy: string; status: string; removedReason?: string | null; likeCount: number; replyCount: number;
  repostCount: number; imported?: boolean; createdAt: string; editedAt: string | null; campusId: string | null; openReports: number;
}
interface Stats { posts24h: number; replies24h: number; anonymous24h: number; activeAuthors24h: number; pendingReview: number; removedOrHidden: number; importedWhispers: number }
interface Trend { rank: number; hashtagId: string; tag: string; people: number; posts: number }
interface BackfillStats { scanned: number; imported: number; existing: number; skippedNoCampus: number; skippedNoUser: number; skippedEmpty: number; likes: number; failed: number }
interface Entity {
  id: string; campusId: string; type: EntityType; name: string; handle: string; description: string | null; avatarUrl: string | null;
  verified: boolean; managerIds: string[]; status: 'active' | 'disabled'; createdAt: string;
}
interface GrantedBadge { id: string; userId: string; code: string; userName: string; duplicate: boolean; revoked?: boolean }

type Tab = 'overview' | 'posts' | 'entities' | 'badges';
type Notice = { kind: 'ok' | 'error'; text: string } | null;
type Act = (fn: () => Promise<unknown>, success: string, reload: Array<() => unknown>) => Promise<boolean>;

// ── Shared styles (same tokens as /friends, /friends/forum and /moderation) ───
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
const HANDLE_RE = /^[a-z0-9_]{3,40}$/;
const BADGE_RE = /^[a-z_]{3,40}$/;

const STATUS_TONE: Record<string, string> = {
  active: 'text-success-text border-success/30 bg-success-soft',
  visible: 'text-success-text border-success/30 bg-success-soft',
  pending_review: 'text-warning-text border-warning/30 bg-warning-soft',
  hidden: 'text-fg-muted border-line bg-surface-2/60',
  disabled: 'text-fg-muted border-line bg-surface-2/60',
  deleted: 'text-fg-muted border-line bg-surface-2/60',
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

/** Finds a user by name, phone or email (GET /api/admin/users?search=). */
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

export default function PulseAdminPage() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campusId, setCampusId] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const { mark, isFresh } = useFreshIds();

  const ok = (text: string) => setNotice({ kind: 'ok', text });
  const bad = (e: unknown, fallback: string) => setNotice({ kind: 'error', text: errText(e, fallback) });

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

  // ── Overview ──
  const [stats, setStats] = useState<Stats | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [ovLoading, setOvLoading] = useState(false);
  const [ovErr, setOvErr] = useState<string | undefined>();
  const [backfill, setBackfill] = useState<BackfillStats | null>(null);
  const loadOverview = useCallback(async () => {
    if (!campusId) return;
    setOvLoading(true);
    try {
      const [s, t] = await Promise.all([
        adminRequest<Stats>(`/api/campus/pulse/admin/stats${qs({ campusId })}`),
        adminRequest<{ items: Trend[] }>(`/api/campus/pulse/admin/trends${qs({ campusId })}`),
      ]);
      setStats(s);
      setTrends(t.items || []);
      setOvErr(undefined);
    } catch (e) {
      setOvErr(errText(e, 'Could not load Pulse stats.'));
    } finally {
      setOvLoading(false);
    }
  }, [campusId]);

  // ── Posts ──
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [postsCursor, setPostsCursor] = useState<string | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsErr, setPostsErr] = useState<string | undefined>();
  const [pStatus, setPStatus] = useState('pending_review');
  const [pKind, setPKind] = useState('');
  const [pAnon, setPAnon] = useState('');
  const [pQ, setPQ] = useState('');
  const [pQApplied, setPQApplied] = useState('');
  const loadPosts = useCallback(async (more = false, cur: string | null = null) => {
    if (!campusId) return;
    setPostsLoading(true);
    try {
      const d = await adminRequest<{ items: AdminPost[]; nextCursor: string | null }>(
        `/api/campus/pulse/admin/posts${qs({ campusId, status: pStatus, kind: pKind, anonymous: pAnon, q: pQApplied, cursor: more ? cur : null })}`,
      );
      setPosts((prev) => {
        if (!more) return d.items || [];
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(d.items || []).filter((p) => !seen.has(p.id))];
      });
      setPostsCursor(d.nextCursor || null);
      setPostsErr(undefined);
    } catch (e) {
      setPostsErr(errText(e, 'Could not load posts.'));
    } finally {
      setPostsLoading(false);
    }
  }, [campusId, pStatus, pKind, pAnon, pQApplied]);

  // ── Entities ──
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entLoading, setEntLoading] = useState(false);
  const [entErr, setEntErr] = useState<string | undefined>();
  const [entQ, setEntQ] = useState('');
  const loadEntities = useCallback(async () => {
    if (!campusId) return;
    setEntLoading(true);
    try {
      const d = await adminRequest<{ items: Entity[] }>(`/api/campus/mod/entities${qs({ campusId, q: entQ.trim() })}`);
      setEntities(d.items || []);
      setEntErr(undefined);
    } catch (e) {
      setEntErr(errText(e, 'Could not load entities.'));
    } finally {
      setEntLoading(false);
    }
  }, [campusId, entQ]);

  useEffect(() => { if (isAuthed && campusId) loadOverview(); }, [isAuthed, campusId, loadOverview]);
  useEffect(() => { if (isAuthed && campusId) loadPosts(false); }, [isAuthed, campusId, loadPosts]);
  useEffect(() => { if (isAuthed && campusId) loadEntities(); }, [isAuthed, campusId, loadEntities]);

  // Live: Pulse reports and held posts emit friends_report with scope "pulse".
  useLiveSync(['friends_report'], (events: LiveEvent[], meta) => {
    const pulse = events.filter((e) => e.scope === 'pulse');
    if (!meta.reconnect && !pulse.length) return;
    loadOverview();
    loadPosts(false);
    mark(pulse.filter((e) => e.id != null).map((e) => String(e.id)));
  }, { enabled: isAuthed });

  const act: Act = async (fn, success, reload) => {
    setBusy(true);
    try {
      await fn();
      ok(success);
      reload.forEach((r) => r());
      return true;
    } catch (e) {
      bad(e, 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runBackfill = async () => {
    if (!(await confirm({ title: 'Re-run the whisper import? It is safe to repeat: whispers already imported, or deleted by their author, are skipped.' }))) return;
    act(async () => {
      const r = await adminRequest<{ ok: boolean; stats: BackfillStats }>('/api/campus/pulse/admin/backfill-whispers', { method: 'POST' });
      setBackfill(r.stats);
    }, 'Whisper import finished.', [loadOverview]);
  };

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'posts', label: 'Posts', count: stats?.pendingReview },
    { id: 'entities', label: 'Verified entities' },
    { id: 'badges', label: 'Badges' },
  ];

  return (
    <div className="space-y-8 animate-fade-in relative pb-16">
      <div className="flex flex-wrap gap-4 items-end justify-between">
        <div>
          <Link href="/friends" className="text-xs font-semibold text-fg-muted hover:text-fg">← Friends config</Link>
          <h1 className="text-3xl font-semibold text-fg mt-1">Pulse admin</h1>
          <p className="text-xs font-semibold text-fg-muted mt-1">Activity, held posts, verified entities and badges</p>
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

      {tab === 'badges' ? (
        <BadgesTab busy={busy} act={act} />
      ) : !campusId ? (
        <p className="text-xs text-fg-muted text-center py-16">Pick a campus to manage Pulse.</p>
      ) : tab === 'overview' ? (
        <OverviewTab stats={stats} trends={trends} loading={ovLoading} error={ovErr} reload={loadOverview}
          busy={busy} runBackfill={runBackfill} backfill={backfill} openHeld={() => { setPStatus('pending_review'); setTab('posts'); }} />
      ) : tab === 'posts' ? (
        <PostsTab items={posts} loading={postsLoading} error={postsErr} reload={() => loadPosts(false)}
          more={postsCursor ? () => loadPosts(true, postsCursor) : null}
          status={pStatus} setStatus={setPStatus} kind={pKind} setKind={setPKind} anon={pAnon} setAnon={setPAnon}
          q={pQ} setQ={setPQ} applyQ={() => setPQApplied(pQ.trim())}
          busy={busy} act={act} afterAction={() => { loadPosts(false); loadOverview(); }} isFresh={isFresh} />
      ) : (
        <EntitiesTab campusId={campusId} items={entities} loading={entLoading} error={entErr} reload={loadEntities}
          q={entQ} setQ={setEntQ} busy={busy} act={act} />
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function Stat({ k, v, tone }: { k: string; v: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-4">
      <p className="text-xs font-semibold text-fg-muted">{k}</p>
      <p className={`text-2xl font-semibold mt-1 ${tone || 'text-fg'}`}>{v}</p>
    </div>
  );
}

function OverviewTab({ stats, trends, loading, error, reload, busy, runBackfill, backfill, openHeld }: {
  stats: Stats | null; trends: Trend[]; loading: boolean; error?: string; reload: () => void; busy: boolean;
  runBackfill: () => void; backfill: BackfillStats | null; openHeld: () => void;
}) {
  return (
    <div className="space-y-6">
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">Last 24 hours</h2>
          <button onClick={reload} disabled={loading} className={btnGhost}>{loading ? '…' : 'Refresh'}</button>
        </div>
        {!stats ? (
          <LoadState loading={loading} error={error} empty reload={reload} emptyText="No stats yet." />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat k="Posts" v={stats.posts24h} />
              <Stat k="Replies" v={stats.replies24h} />
              <Stat k="Anonymous" v={stats.anonymous24h} />
              <Stat k="Active people" v={stats.activeAuthors24h} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <button onClick={openHeld} className="text-left rounded-lg border border-warning/30 bg-warning-soft p-4 hover:border-warning/30">
                <p className="text-xs font-semibold text-warning-text">Held for review (open)</p>
                <p className="text-2xl font-semibold mt-1 text-warning-text">{stats.pendingReview}</p>
              </button>
              <Stat k="Removed or hidden (all time)" v={stats.removedOrHidden} tone="text-danger-text" />
              <Stat k="Imported whispers" v={stats.importedWhispers} tone="text-info-text" />
            </div>
            {error && <p className="text-xs text-danger-text">{error}</p>}
          </>
        )}
      </section>

      <section className={card}>
        <div>
          <h2 className="text-sm font-semibold text-fg">Trending now</h2>
          <p className="text-xs text-fg-muted mt-1">Ranked by how many different people used the tag in the last 24 h (at least 2). Sanctioned authors and hidden posts are left out. Fresh, not cached.</p>
        </div>
        {trends.length === 0 ? (
          <p className="text-xs text-fg-muted py-6 text-center">{loading ? 'Loading…' : 'Nothing is trending on this campus yet.'}</p>
        ) : (
          <ol className="divide-y divide-line rounded-lg border border-line">
            {trends.map((t) => (
              <li key={t.hashtagId} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-semibold text-fg"><span className="text-fg-muted font-mono mr-3">{t.rank}</span>#{t.tag}</span>
                <span className="text-xs font-semibold text-fg-muted">{t.people} people · {t.posts} posts</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={card}>
        <div>
          <h2 className="text-sm font-semibold text-fg">Whisper import</h2>
          <p className="text-xs text-fg-muted mt-1">
            Old whispers become anonymous Pulse posts with their original date and text, a fresh alias, hearts as likes and the topic as a hashtag.
            It runs on every server start; run it here to pick up whispers posted from old app versions since then. Safe to repeat, and covers all campuses.
          </p>
        </div>
        <button onClick={runBackfill} disabled={busy} className={btnBlue}>{busy ? 'Working…' : 'Run whisper import'}</button>
        {backfill && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {([
              ['Scanned', backfill.scanned], ['Imported', backfill.imported], ['Already there', backfill.existing], ['Likes added', backfill.likes],
              ['No campus', backfill.skippedNoCampus], ['Author gone', backfill.skippedNoUser], ['Empty', backfill.skippedEmpty], ['Failed', backfill.failed],
            ] as Array<[string, number]>).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
                <span className="text-fg-muted font-semibold text-xs">{k}</span>
                <p className={`font-semibold ${k === 'Failed' && v > 0 ? 'text-danger-text' : 'text-fg'}`}>{v ?? 0}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Posts ────────────────────────────────────────────────────────────────────

function authorLine(a: Author) {
  if (a.anonymous) return <span className="text-fg-muted">{a.alias} <span className={`${chip} ml-1 text-accent-text border-accent/30 bg-accent-soft`}>anonymous</span></span>;
  if (a.entity) return <span className="text-fg">{a.entity.name} <span className="text-fg-muted">@{a.entity.handle}</span>{a.entity.verified && <span className={`${chip} ml-1 text-info-text border-info/30 bg-info-soft`}>verified</span>}</span>;
  return <span className="text-fg">{a.name || 'Former student'}{a.userId && <span className="ml-1 font-mono text-xs text-fg-subtle">{shortId(a.userId)}</span>}</span>;
}

function PostsTab({ items, loading, error, reload, more, status, setStatus, kind, setKind, anon, setAnon, q, setQ, applyQ, busy, act, afterAction, isFresh }: {
  items: AdminPost[]; loading: boolean; error?: string; reload: () => void; more: (() => void) | null;
  status: string; setStatus: (v: string) => void; kind: string; setKind: (v: string) => void; anon: string; setAnon: (v: string) => void;
  q: string; setQ: (v: string) => void; applyQ: () => void; busy: boolean; act: Act; afterAction: () => void; isFresh: (id: string) => boolean;
}) {
  const notifyError = useToast().error;
  const ask = usePrompt();
  const moderate = async (p: AdminPost, action: 'approve' | 'hide' | 'remove' | 'restore') => {
    let reason: string | null = '';
    if (action === 'hide' || action === 'remove') {
      reason = (await ask({ title: `Reason to ${action} this ${p.kind} (the author sees it and can appeal; at least 3 characters):`, label: 'Reason', defaultValue: '', minLength: 3 }));
      if (reason === null) return;
      if (reason.trim().length < 3) { notifyError('Please give a reason of at least 3 characters.'); return; }
    } else if (action === 'restore') {
      reason = (await ask({ title: 'Restore this post? Optional note for the audit log:', label: 'Reason', defaultValue: '' }));
      if (reason === null) return;
    }
    const done: Record<typeof action, string> = { approve: 'Approved. The post is now visible.', hide: 'Hidden.', remove: 'Removed.', restore: 'Restored.' };
    act(() => adminRequest(`/api/campus/pulse/admin/posts/${p.id}/${action}`, { method: 'POST', body: JSON.stringify(reason ? { reason: reason.trim() } : {}) }), done[action], [afterAction]);
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <span className={label}>Status</span>
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="" className="bg-surface">All but deleted</option>
            {POST_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <span className={label}>Kind</span>
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="" className="bg-surface">Posts and replies</option>
            <option value="post" className="bg-surface">Posts</option>
            <option value="reply" className="bg-surface">Replies</option>
          </select>
        </div>
        <div>
          <span className={label}>Author</span>
          <select className={input} value={anon} onChange={(e) => setAnon(e.target.value)} aria-label="Anonymous filter">
            <option value="" className="bg-surface">Anyone</option>
            <option value="true" className="bg-surface">Anonymous only</option>
            <option value="false" className="bg-surface">Named only</option>
          </select>
        </div>
        <form className="flex gap-2 flex-1 min-w-[220px]" onSubmit={(e) => { e.preventDefault(); applyQ(); }}>
          <div className="flex-1">
            <span className={label}>Text contains</span>
            <input className={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} placeholder="At least 2 characters" />
          </div>
          <button type="submit" className={`${btnGhost} self-end`}>Search</button>
        </form>
        <button onClick={reload} disabled={loading} className={`${btnGhost} self-end`}>{loading ? '…' : 'Refresh'}</button>
      </div>
      <p className="text-xs text-fg-muted">Anonymous authors stay hidden here. To reveal one, open the report in the moderation queue (needs a reason, logged).</p>

      <LoadState loading={loading} error={error} empty={items.length === 0} reload={reload} emptyText="No posts match these filters." />

      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.id} className={`rounded-lg border border-line bg-surface-2/60 p-4 space-y-3 ${isFresh(p.id) ? FRESH_ROW_CLASS : ''}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusChip s={p.status} />
              <span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>{p.kind}</span>
              {p.imported && <span className={`${chip} text-info-text border-info/30 bg-info-soft`}>whisper</span>}
              {p.openReports > 0 && <span className={`${chip} text-danger-text border-danger/30 bg-danger-soft`}>{p.openReports} open report{p.openReports > 1 ? 's' : ''}</span>}
              <span className="ml-auto text-xs text-fg-muted">{fmt(p.createdAt)}{p.editedAt ? ' · edited' : ''}</span>
            </div>
            <p className="text-xs">{authorLine(p.author)}</p>
            <p className="text-sm text-fg whitespace-pre-wrap break-words">{p.text || <span className="text-fg-muted">(no text)</span>}</p>
            {p.media.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {p.media.map((m) => m.url ? (
                  <a key={m.mediaId} href={m.url} target="_blank" rel="noreferrer noopener">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt="Post image" className="h-20 w-20 rounded-xl object-cover border border-line" />
                  </a>
                ) : <span key={m.mediaId} className="text-xs text-fg-muted">image unavailable</span>)}
              </div>
            )}
            {p.link && <p className="text-xs text-info-text break-all">Link: {p.link.host} <span className="text-fg-muted">({p.link.url})</span></p>}
            {p.poll && (
              <div className="text-xs text-fg-muted space-y-1">
                <p className="text-xs font-semibold text-fg-muted">Poll · {p.poll.closed ? 'closed' : `closes ${fmt(p.poll.closesAt)}`}</p>
                {p.poll.options.map((o) => <p key={o.idx}>{o.label}{o.votes != null ? ` · ${o.votes}` : ''}</p>)}
              </div>
            )}
            {p.removedReason && <p className="text-xs text-danger-text">Reason: {p.removedReason}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-fg-muted mr-auto">
                {p.likeCount} likes · {p.replyCount} replies · {p.repostCount} reposts{p.hashtags.length ? ` · ${p.hashtags.map((h) => `#${h}`).join(' ')}` : ''}
              </span>
              {p.status === 'pending_review' && <button disabled={busy} onClick={() => moderate(p, 'approve')} className={btnGo}>Approve</button>}
              {(p.status === 'visible' || p.status === 'pending_review') && <button disabled={busy} onClick={() => moderate(p, 'hide')} className={btnGhost}>Hide</button>}
              {p.status !== 'removed' && p.status !== 'deleted' && <button disabled={busy} onClick={() => moderate(p, 'remove')} className={btnWarn}>Remove</button>}
              {(p.status === 'hidden' || p.status === 'removed') && <button disabled={busy} onClick={() => moderate(p, 'restore')} className={btnGo}>Restore</button>}
            </div>
          </li>
        ))}
      </ul>
      {more && <div className="text-center"><button onClick={more} disabled={loading} className={btnGhost}>{loading ? '…' : 'Load more'}</button></div>}
    </section>
  );
}

// ── Verified entities ────────────────────────────────────────────────────────

interface EntityDraft {
  type: EntityType; name: string; handle: string; description: string; avatarUrl: string; verified: boolean; status: 'active' | 'disabled';
  managers: Array<{ id: string; name: string }>;
}
const emptyEntity = (): EntityDraft => ({ type: 'club', name: '', handle: '', description: '', avatarUrl: '', verified: true, status: 'active', managers: [] });
const entityDraftOf = (e: Entity): EntityDraft => ({
  type: e.type, name: e.name, handle: e.handle, description: e.description || '', avatarUrl: e.avatarUrl || '', verified: e.verified, status: e.status,
  managers: (e.managerIds || []).map((id) => ({ id, name: '' })),
});
const entityErrors = (d: EntityDraft) => {
  const e: string[] = [];
  const n = d.name.trim();
  if (n.length < 2 || n.length > 80) e.push('Name must be 2-80 characters.');
  if (!HANDLE_RE.test(d.handle.trim().toLowerCase())) e.push('Handle must be 3-40 lower-case letters, digits or _.');
  if (d.description.length > 300) e.push('Description: at most 300 characters.');
  if (d.managers.length > 20) e.push('At most 20 managers.');
  if (d.avatarUrl && !/^https:\/\//i.test(d.avatarUrl.trim())) e.push('Avatar must be an uploaded image or an https URL.');
  return e;
};

function EntitiesTab({ campusId, items, loading, error, reload, q, setQ, busy, act }: {
  campusId: string; items: Entity[]; loading: boolean; error?: string; reload: () => void; q: string; setQ: (v: string) => void; busy: boolean; act: Act;
}) {
  const [editing, setEditing] = useState<Entity | 'new' | null>(null);
  const [draft, setDraft] = useState<EntityDraft>(emptyEntity());
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [qDraft, setQDraft] = useState(q);
  const errors = entityErrors(draft);
  const set = <K extends keyof EntityDraft>(k: K, v: EntityDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const open = (e: Entity | 'new') => { setEditing(e); setDraft(e === 'new' ? emptyEntity() : entityDraftOf(e)); setUploadErr(null); };
  const close = useCallback(() => setEditing(null), []);

  const save = async () => {
    if (errors.length) return;
    const body: Record<string, unknown> = {
      type: draft.type, name: draft.name.trim(), handle: draft.handle.trim().toLowerCase(), description: draft.description.trim(),
      avatarUrl: draft.avatarUrl.trim() || null, verified: draft.verified, status: draft.status, managerIds: draft.managers.map((m) => m.id),
    };
    const isNew = editing === 'new';
    const okd = await act(
      () => (isNew
        ? adminRequest('/api/campus/mod/entities', { method: 'POST', body: JSON.stringify({ ...body, campusId }) })
        : adminRequest(`/api/campus/mod/entities/${(editing as Entity).id}`, { method: 'PUT', body: JSON.stringify(body) })),
      isNew ? 'Entity created.' : 'Entity saved.', [reload],
    );
    if (okd) setEditing(null);
  };

  const quick = (e: Entity, patch: Partial<Pick<Entity, 'verified' | 'status'>>, msg: string) =>
    act(() => adminRequest(`/api/campus/mod/entities/${e.id}`, { method: 'PUT', body: JSON.stringify(patch) }), msg, [reload]);

  const onAvatar = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    setUploadErr(null);
    try { set('avatarUrl', await uploadImage(f)); } catch (e) { setUploadErr(errText(e, 'Upload failed.')); } finally { setUploading(false); }
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">Verified entities</h2>
          <p className="text-xs text-fg-muted mt-1 max-w-2xl">Clubs, departments, vendors and official accounts. Their managers can post as them in Pulse once the entity is active and verified. Anonymous posts can never be posted as an entity.</p>
        </div>
        <div className="flex gap-2 items-end">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQ(qDraft); }}>
            <input className={`${input} w-48`} value={qDraft} onChange={(e) => setQDraft(e.target.value)} maxLength={60} placeholder="Name or handle" aria-label="Search entities" />
            <button type="submit" className={btnGhost}>Search</button>
          </form>
          <button onClick={() => open('new')} className={btnGo}>New entity</button>
        </div>
      </div>

      <LoadState loading={loading} error={error} empty={items.length === 0} reload={reload} emptyText="No entities on this campus yet." />

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="zv-table zv-table-dense">
            <thead>
              <tr className="text-xs text-fg-muted">
                <th className="py-2 pr-3">Entity</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Managers</th><th className="py-2 pr-3">State</th><th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-3">
                      {e.avatarUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={e.avatarUrl} alt="" className="h-9 w-9 rounded-xl object-cover border border-line" />
                        : <div className="h-9 w-9 rounded-xl bg-surface-2/60 border border-line flex items-center justify-center text-fg-muted font-semibold">{e.name.slice(0, 1)}</div>}
                      <div>
                        <p className="font-semibold text-fg">{e.name}</p>
                        <p className="text-xs text-fg-muted">@{e.handle}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-fg-muted">{ENTITY_TYPE_LABEL[e.type] || e.type}</td>
                  <td className="py-3 pr-3 text-fg-muted">{e.managerIds.length}</td>
                  <td className="py-3 pr-3 space-x-1">
                    <StatusChip s={e.status} />
                    {e.verified
                      ? <span className={`${chip} text-info-text border-info/30 bg-info-soft`}>verified</span>
                      : <span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>unverified</span>}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap space-x-2">
                    <button disabled={busy} onClick={() => quick(e, { verified: !e.verified }, e.verified ? 'Verification removed.' : 'Verified.')} className={btnGhost}>
                      {e.verified ? 'Unverify' : 'Verify'}
                    </button>
                    <button disabled={busy} onClick={() => quick(e, { status: e.status === 'active' ? 'disabled' : 'active' }, e.status === 'active' ? 'Disabled.' : 'Enabled.')}
                      className={e.status === 'active' ? btnWarn : btnGo}>
                      {e.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => open(e)} className={btnBlue}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Drawer title={editing === 'new' ? 'New entity' : `Edit ${editing.name}`} onClose={close}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className={label}>Type</span>
              <select className={input} value={draft.type} onChange={(e) => set('type', e.target.value as EntityType)} aria-label="Type">
                {ENTITY_TYPES.map((t) => <option key={t} value={t} className="bg-surface">{ENTITY_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>Handle</span>
              <input className={input} maxLength={40} value={draft.handle} onChange={(e) => set('handle', e.target.value.toLowerCase())} placeholder="coding_club" />
            </div>
          </div>
          <div>
            <span className={label}>Name ({draft.name.length}/80)</span>
            <input className={input} maxLength={80} value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <span className={label}>Description ({draft.description.length}/300)</span>
            <textarea className={`${input} min-h-[90px]`} maxLength={300} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="space-y-2">
            <span className={label}>Avatar</span>
            <div className="flex items-center gap-3">
              {draft.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={draft.avatarUrl} alt="" className="h-14 w-14 rounded-lg object-cover border border-line" />
                : <div className="h-14 w-14 rounded-lg bg-surface-2/60 border border-line" />}
              <label className={`${btnGhost} cursor-pointer`}>
                {uploading ? 'Uploading…' : 'Upload'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={(e) => { onAvatar(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {draft.avatarUrl && <button type="button" onClick={() => set('avatarUrl', '')} className={btnGhost}>Clear</button>}
            </div>
            {uploadErr && <p className="text-xs text-danger-text">{uploadErr}</p>}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line p-3">
            <div>
              <p className="text-xs font-semibold text-fg">Verified</p>
              <p className="text-xs text-fg-muted">Only verified, active entities can be posted as and show the badge.</p>
            </div>
            <Toggle checked={draft.verified} onChange={(v) => set('verified', v)} labelText="Verified" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line p-3">
            <div>
              <p className="text-xs font-semibold text-fg">Active</p>
              <p className="text-xs text-fg-muted">A disabled entity cannot post and is hidden from pickers.</p>
            </div>
            <Toggle checked={draft.status === 'active'} onChange={(v) => set('status', v ? 'active' : 'disabled')} labelText="Active" />
          </div>
          <div className="space-y-2">
            <span className={label}>Managers ({draft.managers.length}/20) · verified students of this campus</span>
            {draft.managers.length > 0 && (
              <ul className="rounded-xl border border-line divide-y divide-line">
                {draft.managers.map((m) => (
                  <li key={m.id} className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs text-fg">{m.name || 'Manager'} <span className="ml-1 font-mono text-xs text-fg-muted">{shortId(m.id)}</span></span>
                    <button type="button" onClick={() => set('managers', draft.managers.filter((x) => x.id !== m.id))} className="text-xs font-semibold text-danger-text hover:text-danger-text">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {draft.managers.length < 20 && (
              <UserPicker placeholder="Add a manager: name, phone or email" onPick={(u) => {
                if (draft.managers.some((m) => m.id === u.id)) return;
                set('managers', [...draft.managers, { id: u.id, name: u.name || '' }]);
              }} />
            )}
            <p className="text-xs text-fg-muted">The server refuses anyone who is not a verified student of this campus.</p>
          </div>
          {errors.length > 0 && <ul className="text-xs text-warning-text list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex justify-end gap-2">
            <button onClick={close} className={btnGhost}>Cancel</button>
            <button onClick={save} disabled={busy || uploading || errors.length > 0} className={btnGo}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </Drawer>
      )}
    </section>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────

function BadgesTab({ busy, act }: { busy: boolean; act: Act }) {
  const confirm = useConfirm();
  const [user, setUser] = useState<UserHit | null>(null);
  const [code, setCode] = useState('');
  const [granted, setGranted] = useState<GrantedBadge[]>([]);
  const codeOk = BADGE_RE.test(code.trim());

  const grant = () => {
    if (!user || !codeOk) return;
    const c = code.trim();
    act(async () => {
      const r = await adminRequest<{ badge: { id: string; userId: string; code: string }; duplicate?: boolean }>('/api/campus/mod/badges', {
        method: 'POST', body: JSON.stringify({ userId: user.id, code: c }),
      });
      setGranted((g) => [{ id: r.badge.id, userId: r.badge.userId, code: r.badge.code, userName: user.name || 'Unnamed', duplicate: !!r.duplicate }, ...g.filter((x) => x.id !== r.badge.id)]);
    }, `Badge "${c}" granted to ${user.name || 'the user'}.`, []);
  };

  const revoke = async (id: string, what: string) => {
    if (!UUID_RE.test(id)) return;
    if (!(await confirm({ title: `Revoke ${what}? This is logged.` }))) return;
    act(async () => {
      await adminRequest(`/api/campus/mod/badges/${id}`, { method: 'DELETE' });
      setGranted((g) => g.map((x) => (x.id === id ? { ...x, revoked: true } : x)));
    }, 'Badge revoked.', []);
  };

  return (
    <div className="space-y-6">
      <section className={card}>
        <div>
          <h2 className="text-sm font-semibold text-fg">Grant a badge</h2>
          <p className="text-xs text-fg-muted mt-1">Badges show on a student&apos;s identity across Friends. Forum badges are also earned automatically from karma; granting one that the student already has changes nothing. Every grant and revoke is logged.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <span className={label}>Student</span>
            {user ? (
              <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                <span className="text-xs text-fg">{user.name || 'Unnamed'} <span className="ml-1 text-xs text-fg-muted">{user.email || user.phone || ''}</span></span>
                <button onClick={() => setUser(null)} className="text-xs font-semibold text-fg-muted hover:text-fg">Change</button>
              </div>
            ) : <UserPicker onPick={setUser} />}
          </div>
          <div className="space-y-2">
            <span className={label}>Badge code</span>
            <input className={input} list="pulse-badge-codes" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} maxLength={40} placeholder="e.g. top_contributor" />
            <datalist id="pulse-badge-codes">{KNOWN_BADGES.map((b) => <option key={b} value={b} />)}</datalist>
            <p className="text-xs text-fg-muted">3-40 lower-case letters or _. The app shows labels for: {KNOWN_BADGES.join(', ')}.</p>
            {code && !codeOk && <p className="text-xs text-warning-text">Use only lower-case letters and _ (3-40).</p>}
          </div>
        </div>
        <button onClick={grant} disabled={busy || !user || !codeOk} className={btnGo}>Grant badge</button>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-fg">Granted in this session</h2>
        {granted.length === 0 ? (
          <p className="text-xs text-fg-muted">Nothing yet.</p>
        ) : (
          <ul className="rounded-xl border border-line divide-y divide-line">
            {granted.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-3 py-2 gap-3">
                <span className="text-xs text-fg">
                  {b.userName} · <span className="font-mono">{b.code}</span>
                  {b.duplicate && <span className="ml-2 text-xs text-fg-muted">(already had it)</span>}
                  <span className="ml-2 font-mono text-xs text-fg-subtle">{shortId(b.id)}</span>
                </span>
                {b.revoked
                  ? <span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>revoked</span>
                  : <button disabled={busy} onClick={() => revoke(b.id, `"${b.code}" from ${b.userName}`)} className={btnWarn}>Revoke</button>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-fg-muted">
          To take away a badge granted earlier, grant the same code to that student again: it shows up here as &quot;already had it&quot; and can be revoked.
        </p>
      </section>
    </div>
  );
}
