"use client";
import { useConfirm, usePrompt, useToast } from '@/components/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import { useLiveSync, type LiveEvent } from '@/lib/useLiveSync';

/**
 * Zenvy Friends > Spaces admin (friends_plan §6, Phase 5): live monitor and force end.
 *  Live now   rooms that are live right now, with who is on stage and how many are listening
 *             backend: GET /api/campus/spaces/admin/spaces?status=live (refreshed every 15 s)
 *  All        every Space with status / moderation / campus / text filters
 *             backend: GET /api/campus/spaces/admin/spaces
 *  Detail     members with roles, removals, the in-memory room, reports count, audit trail
 *             backend: GET /api/campus/spaces/admin/spaces/:id
 *  Force end  live -> ended, scheduled -> cancelled, reason required (audited as space_end)
 *             backend: POST /api/campus/spaces/admin/spaces/:id/end
 *  Overview   counts, caps, TURN status, manual run of reminders / expiry / abandoned-room jobs
 *             backend: GET /api/campus/spaces/admin/stats, POST /api/campus/spaces/admin/jobs/run
 *
 * Reports on Spaces are handled in /moderation (subTab "spaces"). Spaces are never recorded.
 * All of it works while the spaces flag is off.
 */

// ── Contract (mirrors backend/modules/friends/models/spaces/enums.js) ────────
const SPACE_STATUS = ['scheduled', 'live', 'ended', 'cancelled', 'expired'] as const;
const MOD_STATUS = ['visible', 'pending_review', 'hidden', 'removed'] as const;

interface Campus { id: string; name: string; code: string }
interface Ident { userId: string | null; name: string | null; avatarUrl?: string | null; verified?: boolean; entity?: { name?: string | null } | null }
interface AdminSpace {
  id: string; title: string; topic: string | null; description: string | null; participation: string; visibility: string;
  status: string; scheduledFor: string | null; startedAt: string | null; endedAt: string | null; endReason: string | null;
  host: Ident; interestedCount: number; participantCount: number; speakerCount: number; listenerCount: number;
  speakers: Array<{ userId: string; name?: string | null; role?: string }>;
  limits: { maxSpeakers: number; maxListeners: number }; full: { speakers: boolean; listeners: boolean };
  recording: false; createdAt: string;
  modStatus: string; underReview: boolean; campusId: string; peakListeners: number | null; removedReason: string | null;
  memberTotals: { members: number; removed: number }; lastActiveAt: string | null;
}
interface Participant { userId: string; name: string | null; avatarUrl: string | null; verified: boolean; role: string; hand: boolean; invited: boolean; muted: boolean; mutedByHost: boolean; connected: boolean }
interface Detail {
  space: AdminSpace;
  members: Array<{ user: Ident; role: string; present: boolean; handRaisedAt: string | null; mutedByHost: boolean; removedAt: string | null; joinedAt: string | null; leftAt: string | null }>;
  live: { spaceId: string; status: string; participants: Participant[]; speakerCount: number; listenerCount: number; limits: { maxSpeakers: number; maxListeners: number } } | null;
  reports: number;
  actions: Array<{ id: string; actorId: string; actorRole: string; action: string; subjectUserId: string | null; reason: string | null; meta: Record<string, unknown>; createdAt: string }>;
}
interface Stats {
  byStatus: Record<string, number>; created24h: number; pendingReview: number; liveRooms: number; liveParticipants: number;
  caps: { maxSpeakers: number; maxListeners: number }; turnConfigured: boolean; recording: false;
}
interface JobStats { reminders: number; missed: number; expired: number; abandoned: number; orphaned: number }

type Tab = 'live' | 'all' | 'overview';
type Notice = { kind: 'ok' | 'error'; text: string } | null;

// ── Shared styles (same tokens as /friends, /friends/connect and /moderation) ─
const input = 'w-full rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-accent';
const label = 'block text-xs font-semibold text-fg-muted mb-1';
const btn = 'rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40 transition-colors';
const btnGhost = `${btn} border border-line bg-surface-2/60 text-fg-muted hover:text-fg`;
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
const since = (d?: string | null) => {
  if (!d) return '-';
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const hostName = (h: Ident) => h.entity?.name ? `${h.entity.name} (by ${h.name || 'student'})` : (h.name || 'Former student');

const TONE: Record<string, string> = {
  live: 'text-success-text border-success/30 bg-success-soft',
  visible: 'text-success-text border-success/30 bg-success-soft',
  scheduled: 'text-info-text border-info/30 bg-info-soft',
  pending_review: 'text-warning-text border-warning/30 bg-warning-soft',
  ended: 'text-fg-muted border-line bg-surface-2/60',
  hidden: 'text-fg-muted border-line bg-surface-2/60',
  expired: 'text-fg-muted border-line bg-surface-2/60',
  cancelled: 'text-danger-text border-danger/30 bg-danger-soft',
  removed: 'text-danger-text border-danger/30 bg-danger-soft',
  host: 'text-accent-text border-accent/30 bg-accent-soft',
  cohost: 'text-accent-text border-accent/30 bg-accent-soft',
  speaker: 'text-info-text border-info/30 bg-info-soft',
  listener: 'text-fg-muted border-line bg-surface-2/60',
};
function Chip({ s }: { s: string }) {
  return <span className={`${chip} ${TONE[s] || 'text-fg-muted border-line bg-surface-2/60'}`}>{s.replace('_', ' ')}</span>;
}

function Stat({ k, v, tone }: { k: string; v: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-4">
      <p className="text-xs font-semibold text-fg-muted">{k}</p>
      <p className={`text-2xl font-semibold mt-1 ${tone || 'text-fg'}`}>{v}</p>
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
          <h2 className="text-sm font-semibold text-fg truncate">{title}</h2>
          <button onClick={onClose} className={btnGhost}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════

export default function SpacesAdminPage() {
  const notifyError = useToast().error;
  const ask = usePrompt();
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('live');
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campusId, setCampusId] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed) return;
    adminRequest<Campus[]>('/api/campus/campuses')
      .then((list) => setCampuses(Array.isArray(list) ? list : []))
      .catch(() => { /* the campus filter is optional */ });
  }, [isAuthed]);
  const campusName = (id: string) => campuses.find((c) => c.id === id)?.code || shortId(id);

  // ── Stats ──
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsErr, setStatsErr] = useState<string | undefined>();
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const loadStats = useCallback(async () => {
    try {
      setStats(await adminRequest<Stats>(`/api/campus/spaces/admin/stats${qs({ campusId })}`));
      setStatsErr(undefined);
    } catch (e) {
      setStatsErr(errText(e, 'Could not load Spaces stats.'));
    }
  }, [campusId]);

  // ── Live now ──
  const [live, setLive] = useState<AdminSpace[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveErr, setLiveErr] = useState<string | undefined>();
  const [liveAt, setLiveAt] = useState<Date | null>(null);
  const loadLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const d = await adminRequest<{ items: AdminSpace[] }>(`/api/campus/spaces/admin/spaces${qs({ status: 'live', campusId, limit: '100' })}`);
      setLive(d.items || []);
      setLiveErr(undefined);
      setLiveAt(new Date());
    } catch (e) {
      setLiveErr(errText(e, 'Could not load live Spaces.'));
    } finally {
      setLiveLoading(false);
    }
  }, [campusId]);

  // ── All ──
  const [all, setAll] = useState<AdminSpace[]>([]);
  const [allCursor, setAllCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [modStatus, setModStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [allLoading, setAllLoading] = useState(false);
  const [allErr, setAllErr] = useState<string | undefined>();
  const loadAll = useCallback(async (more = false, cur: string | null = null) => {
    setAllLoading(true);
    try {
      const d = await adminRequest<{ items: AdminSpace[]; nextCursor: string | null }>(
        `/api/campus/spaces/admin/spaces${qs({ status, modStatus, campusId, q: query, cursor: more ? cur : null })}`,
      );
      setAll((prev) => {
        if (!more) return d.items || [];
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...(d.items || []).filter((s) => !seen.has(s.id))];
      });
      setAllCursor(d.nextCursor || null);
      setAllErr(undefined);
    } catch (e) {
      setAllErr(errText(e, 'Could not load Spaces.'));
    } finally {
      setAllLoading(false);
    }
  }, [status, modStatus, campusId, query]);

  // ── Detail ──
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailErr, setDetailErr] = useState<string | undefined>();
  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await adminRequest<Detail>(`/api/campus/spaces/admin/spaces/${encodeURIComponent(id)}`));
      setDetailErr(undefined);
    } catch (e) {
      setDetailErr(errText(e, 'Could not load this Space.'));
    }
  }, []);
  useEffect(() => {
    setDetail(null);
    setDetailErr(undefined);
    if (openId) loadDetail(openId);
  }, [openId, loadDetail]);

  useEffect(() => { if (isAuthed) loadStats(); }, [isAuthed, loadStats]);
  useEffect(() => { if (isAuthed && tab === 'live') loadLive(); }, [isAuthed, tab, loadLive]);
  useEffect(() => { if (isAuthed && tab === 'all') loadAll(false); }, [isAuthed, tab, loadAll]);

  // Rooms change by the second, and the backend does not push Space lifecycle events to admins,
  // so the live monitor (and an open live room's detail) refresh every 15 s while the tab is visible.
  const tick = useRef<() => void>(() => {});
  tick.current = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (tab === 'live') loadLive();
    loadStats();
    if (openId && detail?.space.status === 'live') loadDetail(openId);
  };
  useEffect(() => {
    if (!isAuthed) return;
    const t = setInterval(() => tick.current(), 15000);
    return () => clearInterval(t);
  }, [isAuthed]);

  // A new Space report (scope "spaces") may hold a room for review: refresh what is on screen.
  useLiveSync(['friends_report'], (events: LiveEvent[], meta) => {
    if (!meta.reconnect && !events.some((e) => e.scope === 'spaces')) return;
    loadStats();
    if (tab === 'live') loadLive();
    if (tab === 'all') loadAll(false);
    if (openId) loadDetail(openId);
  }, { enabled: isAuthed });

  const forceEnd = async (s: AdminSpace) => {
    const what = s.status === 'live' ? 'End this live Space for everyone' : 'Cancel this scheduled Space';
    const reason = (await ask({ title: `${what}: "${s.title}"\n\nReason for the audit log (at least 5 characters):`, label: 'Reason', defaultValue: '', minLength: 5 }));
    if (reason === null) return;
    if (reason.trim().length < 5) { notifyError('Please give a reason of at least 5 characters.'); return; }
    setBusy(true);
    try {
      await adminRequest(`/api/campus/spaces/admin/spaces/${encodeURIComponent(s.id)}/end`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      setNotice({ kind: 'ok', text: s.status === 'live' ? 'Space ended. Everyone in the room was disconnected.' : 'Space cancelled. People who asked for a reminder were told.' });
      loadStats();
      if (tab === 'live') loadLive();
      if (tab === 'all') loadAll(false);
      if (openId === s.id) loadDetail(s.id);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not end this Space.') });
      if (openId === s.id) loadDetail(s.id);
    } finally {
      setBusy(false);
    }
  };

  const runJobs = async () => {
    if (!(await confirm({ title: 'Run the Spaces jobs now? This sends due reminders, expires scheduled Spaces nobody started, and ends abandoned rooms. They also run on their own every 15 seconds.' }))) return;
    setBusy(true);
    try {
      const r = await adminRequest<{ stats: JobStats }>('/api/campus/spaces/admin/jobs/run', { method: 'POST' });
      setJobStats(r.stats);
      setNotice({ kind: 'ok', text: 'Jobs finished.' });
      loadStats();
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not run the jobs.') });
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'live', label: 'Live now', count: stats?.byStatus?.live },
    { id: 'all', label: 'All Spaces' },
    { id: 'overview', label: 'Overview and jobs' },
  ];

  const Row = ({ s }: { s: AdminSpace }) => (
    <div className="rounded-lg border border-line bg-surface-2/60 p-4 flex flex-wrap items-start justify-between gap-4">
      <button onClick={() => setOpenId(s.id)} className="text-left min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip s={s.status} />
          {s.modStatus !== 'visible' && <Chip s={s.modStatus} />}
          <span className="text-xs font-semibold text-fg-muted">{campusName(s.campusId)}</span>
          <span className="text-xs font-semibold text-fg-muted">{s.participation === 'open' ? 'open stage' : 'request to speak'}</span>
        </div>
        <p className="text-sm font-semibold text-fg truncate">{s.title}</p>
        <p className="text-xs text-fg-muted truncate">Host: {hostName(s.host)}{s.topic ? ` · ${s.topic}` : ''}</p>
        <p className="text-xs text-fg-muted">
          {s.status === 'live'
            ? `Live for ${since(s.startedAt)} · ${s.speakerCount}/${s.limits.maxSpeakers} on stage · ${s.listenerCount}/${s.limits.maxListeners} listening`
            : s.status === 'scheduled'
              ? `Starts ${fmt(s.scheduledFor)} · ${s.interestedCount} interested`
              : `${s.endReason ? `${s.endReason.replace(/_/g, ' ')} · ` : ''}${fmt(s.endedAt || s.createdAt)} · peak ${s.peakListeners ?? 0} listening · ${s.memberTotals.members} joined`}
        </p>
      </button>
      {(s.status === 'live' || s.status === 'scheduled') && (
        <button disabled={busy} onClick={() => forceEnd(s)} className={btnWarn}>{s.status === 'live' ? 'Force end' : 'Cancel'}</button>
      )}
    </div>
  );

  const CampusSelect = (
    <div className="min-w-[160px]">
      <label className={label} htmlFor="sp-campus">Campus</label>
      <select id="sp-campus" value={campusId} onChange={(e) => setCampusId(e.target.value)} className={input}>
        <option value="" className="bg-surface">All campuses</option>
        {campuses.map((c) => <option key={c.id} value={c.id} className="bg-surface">{c.code} · {c.name}</option>)}
      </select>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in relative pb-16">
      <div className="flex flex-wrap gap-4 items-end justify-between">
        <div>
          <Link href="/friends" className="text-xs font-semibold text-fg-muted hover:text-fg">← Friends config</Link>
          <h1 className="text-3xl font-semibold text-fg mt-1">Spaces admin</h1>
          <p className="text-xs font-semibold text-fg-muted mt-1">Live audio rooms: monitor, inspect, force end</p>
        </div>
        <Link href="/moderation" className={btnGhost}>Reports queue</Link>
      </div>

      <div className="rounded-lg border border-line bg-surface-2/60 px-4 py-3 text-xs text-fg-muted">
        Spaces are never recorded. Audio goes directly between students (WebRTC) and never passes through the server, so admins can see who is in a room but cannot listen. Force end is logged with your reason.
      </div>

      {notice && (
        <div role="status" className={`rounded-lg border px-4 py-3 text-xs font-semibold flex items-center justify-between gap-4 ${notice.kind === 'ok' ? 'border-success/30 bg-success-soft text-success-text' : 'border-danger/30 bg-danger-soft text-danger-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`${btn} border ${tab === t.id ? 'border-info/30 bg-info-soft text-info-text' : 'border-line bg-surface-2/60 text-fg-muted hover:text-fg'}`}>
              {t.label}
              {!!t.count && <span className="ml-2 rounded-md bg-success-soft px-1.5 py-0.5 text-success-text">{t.count}</span>}
            </button>
          ))}
        </div>
        {CampusSelect}
      </div>

      {tab === 'live' && (
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-fg">Live now</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-fg-muted">{liveAt ? `Updated ${liveAt.toLocaleTimeString('en-IN')} · refreshes every 15 s` : ''}</span>
              <button onClick={loadLive} disabled={liveLoading} className={btnBlue}>Refresh</button>
            </div>
          </div>
          <LoadState loading={liveLoading} error={liveErr} empty={!live.length} reload={loadLive} emptyText="No Space is live right now." />
          <div className="space-y-3">{live.map((s) => <Row key={s.id} s={s} />)}</div>
        </section>
      )}

      {tab === 'all' && (
        <section className={card}>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <div className="min-w-[140px]">
              <label className={label} htmlFor="sp-status">Status</label>
              <select id="sp-status" value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
                <option value="" className="bg-surface">Any</option>
                {SPACE_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s}</option>)}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className={label} htmlFor="sp-mod">Moderation</label>
              <select id="sp-mod" value={modStatus} onChange={(e) => setModStatus(e.target.value)} className={input}>
                <option value="" className="bg-surface">Any</option>
                {MOD_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className={label} htmlFor="sp-q">Title or topic</label>
              <input id="sp-q" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} className={input} placeholder="Search" />
            </div>
            <button type="submit" className={btnBlue}>Search</button>
          </form>
          <LoadState loading={allLoading} error={allErr} empty={!all.length} reload={() => loadAll(false)} emptyText="No Spaces match these filters." />
          <div className="space-y-3">{all.map((s) => <Row key={s.id} s={s} />)}</div>
          {allCursor && (
            <div className="text-center">
              <button onClick={() => loadAll(true, allCursor)} disabled={allLoading} className={btnGhost}>{allLoading ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </section>
      )}

      {tab === 'overview' && (
        <section className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-fg">Overview</h2>
            <button onClick={loadStats} className={btnBlue}>Refresh</button>
          </div>
          {statsErr && !stats && <LoadState loading={false} error={statsErr} empty reload={loadStats} emptyText="" />}
          {stats && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat k="Live rooms" v={stats.byStatus.live ?? 0} tone="text-success-text" />
                <Stat k="People in rooms" v={stats.liveParticipants} />
                <Stat k="Scheduled" v={stats.byStatus.scheduled ?? 0} tone="text-info-text" />
                <Stat k="Under review" v={stats.pendingReview} tone={stats.pendingReview ? 'text-warning-text' : undefined} />
                <Stat k="Created (24 h)" v={stats.created24h} />
                <Stat k="Ended" v={stats.byStatus.ended ?? 0} />
                <Stat k="Cancelled" v={stats.byStatus.cancelled ?? 0} />
                <Stat k="Expired" v={stats.byStatus.expired ?? 0} />
              </div>
              <div className="grid md:grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg border border-line bg-surface-2/60 p-4">
                  <p className={label}>Room caps</p>
                  <p className="text-fg font-semibold">{stats.caps.maxSpeakers} on stage (host included) · {stats.caps.maxListeners} listeners</p>
                  <p className="text-fg-muted mt-1">Set with SPACES_MAX_SPEAKERS and SPACES_MAX_LISTENERS on the server.</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2/60 p-4">
                  <p className={label}>Relay (TURN)</p>
                  <p className={stats.turnConfigured ? 'text-success-text font-semibold' : 'text-warning-text font-semibold'}>{stats.turnConfigured ? 'Configured' : 'Not configured (public STUN only)'}</p>
                  <p className="text-fg-muted mt-1">Without TURN, students on strict networks may not hear each other.</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2/60 p-4">
                  <p className={label}>Recording</p>
                  <p className="text-fg font-semibold">Off. Spaces are never recorded.</p>
                </div>
              </div>
            </>
          )}
          <div className="border-t border-line pt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-fg">Background jobs</p>
              <p className="text-xs text-fg-muted">Reminders, expiry of unstarted Spaces, ending abandoned rooms.</p>
              {jobStats && (
                <p className="text-xs text-fg-muted mt-1">
                  Last run: {jobStats.reminders} reminders sent, {jobStats.missed} skipped (missed start), {jobStats.expired} expired, {jobStats.abandoned} abandoned rooms ended, {jobStats.orphaned} lost rooms closed.
                </p>
              )}
            </div>
            <button onClick={runJobs} disabled={busy} className={btnGhost}>Run now</button>
          </div>
        </section>
      )}

      {openId && (
        <Drawer title={detail?.space.title || 'Space'} onClose={() => setOpenId(null)}>
          {!detail ? (
            <LoadState loading={!detailErr} error={detailErr} empty reload={() => loadDetail(openId)} emptyText="" />
          ) : (
            <SpaceDetail d={detail} campusName={campusName} busy={busy} forceEnd={forceEnd} />
          )}
        </Drawer>
      )}
    </div>
  );
}

function SpaceDetail({ d, campusName, busy, forceEnd }: { d: Detail; campusName: (id: string) => string; busy: boolean; forceEnd: (s: AdminSpace) => void }) {
  const s = d.space;
  const open = s.status === 'live' || s.status === 'scheduled';
  return (
    <div className="space-y-5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Chip s={s.status} />
        <Chip s={s.modStatus} />
        <span className="text-xs font-semibold text-fg-muted">{campusName(s.campusId)}</span>
        {d.reports > 0 && <Link href="/moderation" className={`${chip} text-warning-text border-warning/30 bg-warning-soft`}>{d.reports} report{d.reports === 1 ? '' : 's'}</Link>}
      </div>
      <div className="space-y-1">
        <p className="text-fg-muted">Host: <span className="text-fg font-semibold">{hostName(s.host)}</span></p>
        {s.topic && <p className="text-fg-muted">Topic: {s.topic}</p>}
        {s.description && <p className="text-fg-muted whitespace-pre-wrap">{s.description}</p>}
        {s.removedReason && <p className="text-danger-text">Moderation: {s.removedReason}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-fg-muted">
        <p>Created: <span className="text-fg">{fmt(s.createdAt)}</span></p>
        <p>Scheduled: <span className="text-fg">{fmt(s.scheduledFor)}</span></p>
        <p>Started: <span className="text-fg">{fmt(s.startedAt)}</span></p>
        <p>Ended: <span className="text-fg">{fmt(s.endedAt)}</span></p>
        <p>End reason: <span className="text-fg">{s.endReason ? s.endReason.replace(/_/g, ' ') : '-'}</span></p>
        <p>Peak listeners: <span className="text-fg">{s.peakListeners ?? 0}</span></p>
        <p>Interested: <span className="text-fg">{s.interestedCount}</span></p>
        <p>Joined / removed: <span className="text-fg">{s.memberTotals.members} / {s.memberTotals.removed}</span></p>
      </div>
      {open && (
        <button disabled={busy} onClick={() => forceEnd(s)} className={`${btnWarn} w-full`}>
          {s.status === 'live' ? 'Force end this Space' : 'Cancel this Space'}
        </button>
      )}

      {d.live && (
        <div className="space-y-2">
          <p className={label}>In the room now · {d.live.speakerCount}/{d.live.limits.maxSpeakers} on stage · {d.live.listenerCount}/{d.live.limits.maxListeners} listening</p>
          {!d.live.participants.length && <p className="text-fg-muted">Nobody is connected.</p>}
          {d.live.participants.map((p) => (
            <div key={p.userId} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
              <span className="text-fg truncate">{p.name || 'Student'}{p.verified ? ' ✓' : ''}</span>
              <span className="flex flex-wrap items-center gap-1.5 shrink-0">
                <Chip s={p.role} />
                {p.hand && <span className={`${chip} text-warning-text border-warning/30 bg-warning-soft`}>hand up</span>}
                {p.invited && <span className={`${chip} text-info-text border-info/30 bg-info-soft`}>invited</span>}
                {p.mutedByHost ? <span className={`${chip} text-danger-text border-danger/30 bg-danger-soft`}>muted by host</span> : p.muted && <span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>muted</span>}
                {!p.connected && <span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>reconnecting</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className={label}>Everyone who joined ({d.members.length})</p>
        {!d.members.length && <p className="text-fg-muted">Nobody joined.</p>}
        {d.members.map((m, i) => (
          <div key={`${m.user.userId || 'x'}-${i}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
            <span className="min-w-0">
              <span className="text-fg block truncate">{m.user.name || 'Former student'}</span>
              <span className="text-xs text-fg-muted">Joined {fmt(m.joinedAt)}{m.leftAt ? ` · left ${fmt(m.leftAt)}` : ''}</span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5 shrink-0">
              <Chip s={m.role} />
              {m.present && <span className={`${chip} text-success-text border-success/30 bg-success-soft`}>here</span>}
              {m.removedAt && <span className={`${chip} text-danger-text border-danger/30 bg-danger-soft`}>removed</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className={label}>Audit trail</p>
        {!d.actions.length && <p className="text-fg-muted">No actions recorded.</p>}
        {d.actions.map((a) => (
          <div key={a.id} className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
            <p className="text-fg font-semibold">{a.action.replace(/_/g, ' ')} <span className="text-fg-muted font-normal">by {a.actorRole} {shortId(a.actorId)}</span></p>
            {a.reason && <p className="text-fg-muted">{a.reason}</p>}
            <p className="text-xs text-fg-muted">{fmt(a.createdAt)}{a.subjectUserId ? ` · subject ${shortId(a.subjectUserId)}` : ''}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
