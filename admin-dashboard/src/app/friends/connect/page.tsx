"use client";
import { useConfirm, usePrompt } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import { useLiveSync, useFreshIds, FRESH_ROW_CLASS, type LiveEvent } from '@/lib/useLiveSync';

/**
 * Zenvy Friends > Connect admin (friends_plan §6, Phase 4).
 *  Overview   counts, selfie-check provider, retention, manual run of the purge jobs
 *             backend: /api/campus/connect/admin/{stats,jobs/run}
 *  Photos     approve / reject Connect photos (D5: nobody else sees a photo until it is approved)
 *             backend: /api/campus/connect/admin/photos
 *  Selfies    manual selfie check: compare the gesture selfie with the profile photos, pass or fail
 *             backend: /api/campus/connect/admin/liveness
 *  Profiles   browse profiles, open one (audited), hide / remove / restore / delete
 *             backend: /api/campus/connect/admin/profiles
 *  Settings   privacy notice, helplines, safety guidance, Spark prompts, consent version
 *             backend: /api/campus/connect/admin/settings
 *
 * Every read of Connect data is logged on the server before it is returned (view_connect), and
 * refused if the log cannot be written. Reports on Connect profiles and photos are handled in
 * /moderation (subTab "connect"). All of it works while the connect flag is off.
 */

// ── Contract (mirrors backend/modules/friends/models/connect/enums.js) ───────
const PHOTO_STATUS = ['pending', 'approved', 'rejected'] as const;
const LIVENESS_STATUS = ['pending', 'passed', 'failed', 'none'] as const;
const PROFILE_STATUS = ['setup', 'active', 'paused'] as const;
const MOD_STATUS = ['visible', 'pending_review', 'hidden', 'removed'] as const;

interface Campus { id: string; name: string; code: string }
interface AdminUser { userId: string; name: string | null; avatarUrl: string | null; isActive: boolean }
interface LivenessInfo { required: boolean; provider: string | null; configured: boolean; mode: 'manual' | 'provider' | null }
interface Stats {
  profiles: number; active: number; paused: number; photosPending: number; livenessPending: number; activeMatches: number; swipes: number;
  liveness: LivenessInfo; retentionDays: number;
}
interface JobStats { chatsPurged: number; messagesDeleted: number; selfiesExpired: number }
interface AdminPhoto {
  id: string; status: string; position: number; url: string | null; rejectReason: string | null; createdAt: string; reviewedAt: string | null;
  user: AdminUser | null; profile: { profileId: string; displayName: string | null; status: string } | null;
}
interface LivenessItem {
  userId: string; profileId: string; displayName: string | null; user: AdminUser | null; status: string; challenge: string | null;
  selfieUrl: string | null; submittedAt: string | null; checkedAt: string | null; note: string | null;
  photos: Array<{ id: string; status: string; url: string | null }>;
}
interface ProfileRow {
  profileId: string; user: AdminUser | null; campusId: string; status: string; modStatus: string; displayName: string | null;
  livenessStatus: string; consentVersion: number | null; createdAt: string; lastActiveAt: string | null;
}
interface ProfileDetail {
  profile: ProfileRow & {
    modReason: string | null; bio: string | null; interests: string[] | null; lookingFor: string[] | null; showYear: boolean; showBranch: boolean;
    hiddenBranches: string[] | null; hiddenYears: number[] | null; consentAt: string | null; ageDeclaredAt: string | null;
    livenessCheckedAt: string | null; activatedAt: string | null;
  };
  photos: Array<{ id: string; position: number; status: string; rejectReason: string | null; url: string | null }>;
  activeMatches: number;
  reports: Array<{ id: string; targetType: string; category: string; status: string; severity: string; createdAt: string }>;
  actions: Array<{ id: string; action: string; reason?: string | null; createdAt: string; actorRole?: string }>;
}
interface Helpline { name: string; phone?: string; url?: string; note?: string }
interface Settings {
  policy: { version: number; text: string; updatedAt: string | null };
  helplines: Helpline[];
  campusHelplines: Record<string, Helpline[]>;
  sparkPrompts: string[];
  guidance: string[];
  defaults: { helplines: Helpline[]; sparkPrompts: string[]; guidance: string[] };
  connectConsentVersion: number;
  policyUrl: string | null;
  liveness: LivenessInfo;
}

type Tab = 'overview' | 'photos' | 'liveness' | 'profiles' | 'settings';
type Notice = { kind: 'ok' | 'error'; text: string } | null;
type Act = (fn: () => Promise<unknown>, success: string, reload: Array<() => unknown>) => Promise<boolean>;

// ── Shared styles (same tokens as /friends, /friends/pulse and /moderation) ──
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

const STATUS_TONE: Record<string, string> = {
  active: 'text-success-text border-success/30 bg-success-soft',
  approved: 'text-success-text border-success/30 bg-success-soft',
  passed: 'text-success-text border-success/30 bg-success-soft',
  visible: 'text-success-text border-success/30 bg-success-soft',
  pending: 'text-warning-text border-warning/30 bg-warning-soft',
  pending_review: 'text-warning-text border-warning/30 bg-warning-soft',
  setup: 'text-info-text border-info/30 bg-info-soft',
  paused: 'text-fg-muted border-line bg-surface-2/60',
  hidden: 'text-fg-muted border-line bg-surface-2/60',
  none: 'text-fg-muted border-line bg-surface-2/60',
  rejected: 'text-danger-text border-danger/30 bg-danger-soft',
  failed: 'text-danger-text border-danger/30 bg-danger-soft',
  removed: 'text-danger-text border-danger/30 bg-danger-soft',
};
function StatusChip({ s }: { s: string }) {
  return <span className={`${chip} ${STATUS_TONE[s] || 'text-fg-muted border-line bg-surface-2/60'}`}>{s.replace('_', ' ')}</span>;
}

function LoggedNote() {
  return <p className="text-xs font-semibold text-warning-text">This access is logged.</p>;
}

function Photo({ url, alt, size = 'h-28 w-28' }: { url: string | null; alt: string; size?: string }) {
  if (!url) return <div className={`${size} rounded-xl border border-line bg-surface-2/60 flex items-center justify-center text-xs text-fg-muted text-center px-1`}>deleted</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} referrerPolicy="no-referrer" className={`${size} rounded-xl object-cover border border-line`} />
    </a>
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

function Stat({ k, v, tone, onClick }: { k: string; v: number | string; tone?: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-xs font-semibold text-fg-muted">{k}</p>
      <p className={`text-2xl font-semibold mt-1 ${tone || 'text-fg'}`}>{v}</p>
    </>
  );
  if (onClick) return <button onClick={onClick} className="text-left rounded-lg border border-warning/30 bg-warning-soft p-4 hover:border-warning/30">{body}</button>;
  return <div className="rounded-lg border border-line bg-surface-2/60 p-4">{body}</div>;
}

// Reason form (was a browser prompt): required reasons need at least 3 characters.
const useAskReason = () => {
  const ask = usePrompt();
  return async (what: string, required = true): Promise<string | null> => {
    const r = await ask({
      title: what,
      label: required ? 'Reason (the student sees it)' : 'Note for the audit log',
      hint: required ? 'At least 3 characters.' : 'Optional.',
      minLength: required ? 3 : 0,
      defaultValue: '',
    });
    return r === null ? null : r.trim();
  };
};

// ═════════════════════════════════════════════════════════════════════════════

export default function ConnectAdminPage() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const { mark, isFresh } = useFreshIds();

  const ok = (text: string) => setNotice({ kind: 'ok', text });
  const bad = (e: unknown, fallback: string) => setNotice({ kind: 'error', text: errText(e, fallback) });

  useEffect(() => {
    if (!isAuthed) return;
    adminRequest<Campus[]>('/api/campus/campuses')
      .then((list) => setCampuses(Array.isArray(list) ? list : []))
      .catch(() => { /* the campus filter is optional */ });
  }, [isAuthed]);

  // ── Overview ──
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsErr, setStatsErr] = useState<string | undefined>();
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await adminRequest<Stats>('/api/campus/connect/admin/stats'));
      setStatsErr(undefined);
    } catch (e) {
      setStatsErr(errText(e, 'Could not load Connect stats.'));
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Photos ──
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [photoCursor, setPhotoCursor] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<string>('pending');
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosErr, setPhotosErr] = useState<string | undefined>();
  const loadPhotos = useCallback(async (more = false, cur: string | null = null) => {
    setPhotosLoading(true);
    try {
      const d = await adminRequest<{ items: AdminPhoto[]; nextCursor: string | null }>(
        `/api/campus/connect/admin/photos${qs({ status: photoStatus, cursor: more ? cur : null })}`,
      );
      setPhotos((prev) => {
        if (!more) return d.items || [];
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(d.items || []).filter((p) => !seen.has(p.id))];
      });
      setPhotoCursor(d.nextCursor || null);
      setPhotosErr(undefined);
    } catch (e) {
      setPhotosErr(errText(e, 'Could not load photos.'));
    } finally {
      setPhotosLoading(false);
    }
  }, [photoStatus]);

  // ── Selfie checks ──
  const [liveItems, setLiveItems] = useState<LivenessItem[]>([]);
  const [liveInfo, setLiveInfo] = useState<LivenessInfo | null>(null);
  const [liveStatus, setLiveStatus] = useState<string>('pending');
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveErr, setLiveErr] = useState<string | undefined>();
  const loadLiveness = useCallback(async () => {
    setLiveLoading(true);
    try {
      const d = await adminRequest<{ provider: LivenessInfo; items: LivenessItem[] }>(`/api/campus/connect/admin/liveness${qs({ status: liveStatus })}`);
      setLiveItems(d.items || []);
      setLiveInfo(d.provider || null);
      setLiveErr(undefined);
    } catch (e) {
      setLiveErr(errText(e, 'Could not load selfie checks.'));
    } finally {
      setLiveLoading(false);
    }
  }, [liveStatus]);

  // Lists are audited reads, so they load only when their tab is open.
  useEffect(() => { if (isAuthed) loadStats(); }, [isAuthed, loadStats]);
  useEffect(() => { if (isAuthed && tab === 'photos') loadPhotos(false); }, [isAuthed, tab, loadPhotos]);
  useEffect(() => { if (isAuthed && tab === 'liveness') loadLiveness(); }, [isAuthed, tab, loadLiveness]);

  // Live: new photos and selfies emit friends_review (scope connect_photo / connect_liveness);
  // Connect reports emit friends_report.
  useLiveSync(['friends_review', 'friends_report'], (events: LiveEvent[], meta) => {
    const mine = events.filter((e) => String(e.scope || '').startsWith('connect'));
    if (!meta.reconnect && !mine.length) return;
    loadStats();
    if (tab === 'photos' && (meta.reconnect || mine.some((e) => e.scope === 'connect_photo'))) loadPhotos(false);
    if (tab === 'liveness' && (meta.reconnect || mine.some((e) => e.scope === 'connect_liveness'))) loadLiveness();
    mark(mine.filter((e) => e.id != null).map((e) => String(e.id)));
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

  const runJobs = async () => {
    if (!(await confirm({ title: 'Run the Connect clean-up now? It deletes chats of matches that ended more than the retention period ago, and selfies that were never reviewed. It also runs every hour on its own.' }))) return;
    act(async () => {
      const r = await adminRequest<{ stats: JobStats }>('/api/campus/connect/admin/jobs/run', { method: 'POST' });
      setJobStats(r.stats);
    }, 'Clean-up finished.', [loadStats]);
  };

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'photos', label: 'Photo approvals', count: stats?.photosPending },
    { id: 'liveness', label: 'Selfie checks', count: stats?.livenessPending },
    { id: 'profiles', label: 'Profiles' },
    { id: 'settings', label: 'Policy and consent' },
  ];

  return (
    <div className="space-y-8 animate-fade-in relative pb-16">
      <div className="flex flex-wrap gap-4 items-end justify-between">
        <div>
          <Link href="/friends" className="text-xs font-semibold text-fg-muted hover:text-fg">← Friends config</Link>
          <h1 className="text-3xl font-semibold text-fg mt-1">Connect admin</h1>
          <p className="text-xs font-semibold text-fg-muted mt-1">Photo approvals, selfie checks, profiles, policy and consent</p>
        </div>
        <Link href="/moderation" className={btnGhost}>Reports queue</Link>
      </div>

      <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning-text">
        Connect data is sensitive. Every list and profile you open here is written to the audit log first, and the server refuses the read if the log cannot be written. Open only what you need to review.
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

      {tab === 'overview' ? (
        <OverviewTab stats={stats} loading={statsLoading} error={statsErr} reload={loadStats} busy={busy} runJobs={runJobs} jobStats={jobStats}
          openPhotos={() => { setPhotoStatus('pending'); setTab('photos'); }} openLiveness={() => { setLiveStatus('pending'); setTab('liveness'); }} />
      ) : tab === 'photos' ? (
        <PhotosTab items={photos} loading={photosLoading} error={photosErr} reload={() => loadPhotos(false)}
          more={photoCursor ? () => loadPhotos(true, photoCursor) : null} status={photoStatus} setStatus={setPhotoStatus}
          busy={busy} act={act} afterAction={() => { loadPhotos(false); loadStats(); }} isFresh={isFresh} />
      ) : tab === 'liveness' ? (
        <LivenessTab items={liveItems} info={liveInfo} loading={liveLoading} error={liveErr} reload={loadLiveness}
          status={liveStatus} setStatus={setLiveStatus} busy={busy} act={act} afterAction={() => { loadLiveness(); loadStats(); }} isFresh={isFresh} />
      ) : tab === 'profiles' ? (
        <ProfilesTab campuses={campuses} busy={busy} act={act} afterAction={loadStats} />
      ) : (
        <SettingsTab campuses={campuses} busy={busy} act={act} />
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function providerText(l?: LivenessInfo | null) {
  if (!l) return '-';
  if (!l.required) return 'Off (CONNECT_REQUIRE_LIVENESS=false): Connect opens on date of birth and the 18+ declaration only.';
  if (!l.configured) return `Not configured (provider "${l.provider || 'none'}" has no adapter). Students cannot activate Connect until this is fixed.`;
  return l.mode === 'manual' ? 'Manual review (free): students upload a gesture selfie and an admin decides here.' : `Provider: ${l.provider}`;
}

function OverviewTab({ stats, loading, error, reload, busy, runJobs, jobStats, openPhotos, openLiveness }: {
  stats: Stats | null; loading: boolean; error?: string; reload: () => void; busy: boolean; runJobs: () => void; jobStats: JobStats | null;
  openPhotos: () => void; openLiveness: () => void;
}) {
  return (
    <div className="space-y-6">
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">Connect at a glance</h2>
          <button onClick={reload} disabled={loading} className={btnGhost}>{loading ? '…' : 'Refresh'}</button>
        </div>
        {!stats ? (
          <LoadState loading={loading} error={error} empty reload={reload} emptyText="No stats yet." />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat k="Profiles" v={stats.profiles} />
              <Stat k="Active" v={stats.active} tone="text-success-text" />
              <Stat k="Paused" v={stats.paused} tone="text-fg-muted" />
              <Stat k="Active matches" v={stats.activeMatches} tone="text-info-text" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Stat k="Photos waiting" v={stats.photosPending} tone="text-warning-text" onClick={openPhotos} />
              <Stat k="Selfies waiting" v={stats.livenessPending} tone="text-warning-text" onClick={openLiveness} />
              <Stat k="Swipes (all time)" v={stats.swipes} />
            </div>
            {error && <p className="text-xs text-danger-text">{error}</p>}
          </>
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-fg">Selfie check</h2>
        <p className="text-xs text-fg-muted">{providerText(stats?.liveness)}</p>
        <p className="text-xs text-fg-muted">Set by the server environment (LIVENESS_PROVIDER, CONNECT_REQUIRE_LIVENESS). Selfies are deleted as soon as a decision is made.</p>
      </section>

      <section className={card}>
        <div>
          <h2 className="text-sm font-semibold text-fg">Retention clean-up</h2>
          <p className="text-xs text-fg-muted mt-1">
            Chats from matches that ended more than {stats?.retentionDays ?? 30} days ago are deleted, and so are selfies nobody reviewed within 30 days.
            This runs every hour on the server; run it here to do it now. Safe to repeat.
          </p>
        </div>
        <button onClick={runJobs} disabled={busy} className={btnBlue}>{busy ? 'Working…' : 'Run clean-up now'}</button>
        {jobStats && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            {([['Chats purged', jobStats.chatsPurged], ['Messages deleted', jobStats.messagesDeleted], ['Selfies expired', jobStats.selfiesExpired]] as Array<[string, number]>).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
                <span className="text-fg-muted font-semibold text-xs">{k}</span>
                <p className="font-semibold text-fg">{v ?? 0}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Photos ───────────────────────────────────────────────────────────────────

function PhotosTab({ items, loading, error, reload, more, status, setStatus, busy, act, afterAction, isFresh }: {
  items: AdminPhoto[]; loading: boolean; error?: string; reload: () => void; more: (() => void) | null;
  status: string; setStatus: (v: string) => void; busy: boolean; act: Act; afterAction: () => void; isFresh: (id: string) => boolean;
}) {
  const askReason = useAskReason();
  const decide = async (p: AdminPhoto, decision: 'approve' | 'reject') => {
    let reason = '';
    if (decision === 'reject') {
      const r = await askReason('Why is this photo rejected? It is deleted at once');
      if (r === null) return;
      reason = r;
    }
    act(() => adminRequest(`/api/campus/connect/admin/photos/${p.id}/${decision}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
      decision === 'approve' ? 'Approved. Others can see this photo now.' : 'Rejected and deleted.', [afterAction]);
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">Photo approvals</h2>
          <p className="text-xs text-fg-muted mt-1 max-w-2xl">Nobody else sees a Connect photo until it is approved. Reject anything that is not a clear photo of the student, shows someone else, or breaks the guidelines. A rejected photo is deleted immediately.</p>
          <LoggedNote />
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <span className={label}>Status</span>
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Photo status">
              {PHOTO_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s}</option>)}
            </select>
          </div>
          <button onClick={reload} disabled={loading} className={btnGhost}>{loading ? '…' : 'Refresh'}</button>
        </div>
      </div>

      <LoadState loading={loading} error={error} empty={items.length === 0} reload={reload}
        emptyText={status === 'pending' ? 'No photos waiting. All caught up.' : 'No photos with this status.'} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((p) => (
          <div key={p.id} className={`rounded-lg border border-line bg-surface-2/60 p-4 space-y-3 ${isFresh(p.id) ? FRESH_ROW_CLASS : ''}`}>
            <div className="flex gap-3">
              <Photo url={p.url} alt={`Connect photo ${p.position + 1}`} />
              <div className="min-w-0 space-y-1 text-xs">
                <div className="flex flex-wrap gap-1"><StatusChip s={p.status} /><span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>#{p.position + 1}</span></div>
                <p className="font-semibold text-fg truncate">{p.profile?.displayName || 'No profile name'}</p>
                <p className="text-fg-muted truncate">{p.user?.name || 'Unknown account'} <span className="font-mono text-fg-subtle">{shortId(p.user?.userId)}</span></p>
                <p className="text-fg-muted">Uploaded {fmt(p.createdAt)}</p>
                {p.reviewedAt && <p className="text-fg-muted">Reviewed {fmt(p.reviewedAt)}</p>}
                {p.rejectReason && <p className="text-danger-text">Reason: {p.rejectReason}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              {p.status !== 'approved' && p.url && <button disabled={busy} onClick={() => decide(p, 'approve')} className={btnGo}>Approve</button>}
              {p.status !== 'rejected' && <button disabled={busy} onClick={() => decide(p, 'reject')} className={btnWarn}>Reject</button>}
            </div>
          </div>
        ))}
      </div>
      {more && <div className="text-center"><button onClick={more} disabled={loading} className={btnGhost}>{loading ? '…' : 'Load more'}</button></div>}
    </section>
  );
}

// ── Selfie checks ────────────────────────────────────────────────────────────

function LivenessTab({ items, info, loading, error, reload, status, setStatus, busy, act, afterAction, isFresh }: {
  items: LivenessItem[]; info: LivenessInfo | null; loading: boolean; error?: string; reload: () => void;
  status: string; setStatus: (v: string) => void; busy: boolean; act: Act; afterAction: () => void; isFresh: (id: string) => boolean;
}) {
  const confirm = useConfirm();
  const askReason = useAskReason();
  const decide = async (it: LivenessItem, pass: boolean) => {
    let reason = '';
    if (pass) {
      if (!(await confirm({ title: `Pass the selfie check for ${it.displayName || 'this student'}? The selfie is deleted after the decision.` }))) return;
    } else {
      const r = await askReason('Why does the selfie check fail? The student can try again');
      if (r === null) return;
      reason = r;
    }
    act(() => adminRequest(`/api/campus/connect/admin/liveness/${it.userId}/${pass ? 'pass' : 'fail'}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
      pass ? 'Passed. The selfie was deleted.' : 'Failed. The selfie was deleted and the student was told why.', [afterAction]);
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">Selfie checks</h2>
          <p className="text-xs text-fg-muted mt-1 max-w-2xl">
            Pass only when the selfie is a live photo of the same person as the profile photos, doing the gesture shown. Fail screenshots, photos of a screen,
            a different person, or the wrong gesture. The selfie is deleted as soon as you decide.
          </p>
          <p className="text-xs text-fg-muted mt-1">{providerText(info)}</p>
          <LoggedNote />
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <span className={label}>Status</span>
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Selfie status">
              {LIVENESS_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s}</option>)}
            </select>
          </div>
          <button onClick={reload} disabled={loading} className={btnGhost}>{loading ? '…' : 'Refresh'}</button>
        </div>
      </div>

      <LoadState loading={loading} error={error} empty={items.length === 0} reload={reload}
        emptyText={status === 'pending' ? 'No selfies waiting. All caught up.' : 'Nobody with this status.'} />

      <ul className="space-y-4">
        {items.map((it) => (
          <li key={it.profileId} className={`rounded-lg border border-line bg-surface-2/60 p-4 space-y-3 ${isFresh(it.profileId) ? FRESH_ROW_CLASS : ''}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusChip s={it.status} />
              <span className="font-semibold text-fg">{it.displayName || 'No profile name'}</span>
              <span className="text-fg-muted">{it.user?.name || 'Unknown account'} <span className="font-mono text-xs text-fg-subtle">{shortId(it.userId)}</span></span>
              <span className="ml-auto text-xs text-fg-muted">{it.submittedAt ? `Submitted ${fmt(it.submittedAt)}` : it.checkedAt ? `Decided ${fmt(it.checkedAt)}` : ''}</span>
            </div>
            {it.challenge && (
              <p className="text-xs text-info-text rounded-xl border border-info/30 bg-info-soft px-3 py-2">Gesture asked: <span className="font-semibold">{it.challenge}</span></p>
            )}
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <span className={label}>Selfie</span>
                <Photo url={it.selfieUrl} alt="Selfie for review" size="h-40 w-40" />
              </div>
              <div className="space-y-1 min-w-0">
                <span className={label}>Profile photos ({it.photos.length})</span>
                <div className="flex flex-wrap gap-2">
                  {it.photos.length === 0 && <p className="text-xs text-fg-muted">No photos uploaded.</p>}
                  {it.photos.map((ph) => (
                    <div key={ph.id} className="space-y-1">
                      <Photo url={ph.url} alt="Profile photo" size="h-24 w-24" />
                      <StatusChip s={ph.status} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {it.note && <p className="text-xs text-danger-text">Note: {it.note}</p>}
            {it.status === 'pending' && (
              <div className="flex flex-wrap gap-2 justify-end">
                <button disabled={busy} onClick={() => decide(it, false)} className={btnWarn}>Fail</button>
                <button disabled={busy || !it.selfieUrl} onClick={() => decide(it, true)} className={btnGo}>Pass</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Profiles ─────────────────────────────────────────────────────────────────

function ProfilesTab({ campuses, busy, act, afterAction }: { campuses: Campus[]; busy: boolean; act: Act; afterAction: () => void }) {
  const confirm = useConfirm();
  const askReason = useAskReason();
  const [items, setItems] = useState<ProfileRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState('');
  const [modStatus, setModStatus] = useState('');
  const [campusId, setCampusId] = useState('');
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const load = useCallback(async (more = false, cur: string | null = null) => {
    setLoading(true);
    try {
      const d = await adminRequest<{ items: ProfileRow[]; nextCursor: string | null }>(
        `/api/campus/connect/admin/profiles${qs({ status, modStatus, campusId, q: qApplied, cursor: more ? cur : null })}`,
      );
      setItems((prev) => {
        if (!more) return d.items || [];
        const seen = new Set(prev.map((p) => p.profileId));
        return [...prev, ...(d.items || []).filter((p) => !seen.has(p.profileId))];
      });
      setCursor(d.nextCursor || null);
      setError(undefined);
    } catch (e) {
      setError(errText(e, 'Could not load profiles.'));
    } finally {
      setLoading(false);
    }
  }, [status, modStatus, campusId, qApplied]);

  useEffect(() => { load(false); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    if (!UUID_RE.test(id)) return;
    setDetail(null);
    setDetailErr(null);
    try {
      setDetail(await adminRequest<ProfileDetail>(`/api/campus/connect/admin/profiles/${id}`));
    } catch (e) {
      setDetailErr(errText(e, 'Could not open this profile.'));
    }
  }, []);

  const openProfile = (id: string) => { setOpen(id); loadDetail(id); };
  const close = useCallback(() => { setOpen(null); setDetail(null); }, []);

  const moderate = async (id: string, action: 'hide' | 'remove' | 'restore' | 'delete') => {
    let reason = '';
    if (action === 'delete') {
      if (!(await confirm({ title: 'Delete this Connect profile? It removes the profile, all photos and selfies, swipes, matches and their chats. Report evidence is kept. This cannot be undone.' }))) return;
      const r = await askReason('Reason for deleting');
      if (r === null) return;
      reason = r;
    } else if (action === 'restore') {
      const r = await askReason('Restore this profile', false);
      if (r === null) return;
      reason = r;
    } else {
      const r = await askReason(action === 'remove' ? 'Why is this profile removed? Its active matches end' : 'Why is this profile hidden?');
      if (r === null) return;
      reason = r;
    }
    const done = { hide: 'Hidden from discovery.', remove: 'Removed. Its active matches were ended.', restore: 'Restored.', delete: 'Connect data deleted.' }[action];
    const okd = await act(() => adminRequest(`/api/campus/connect/admin/profiles/${id}/${action}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
      done, [() => load(false), afterAction]);
    if (!okd) return;
    if (action === 'delete') close(); else loadDetail(id);
  };

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.code || shortId(id);

  return (
    <section className={card}>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <span className={label}>Campus</span>
          <select className={input} value={campusId} onChange={(e) => setCampusId(e.target.value)} aria-label="Campus">
            <option value="" className="bg-surface">All campuses</option>
            {campuses.map((c) => <option key={c.id} value={c.id} className="bg-surface">{c.name} ({c.code})</option>)}
          </select>
        </div>
        <div>
          <span className={label}>Profile</span>
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Profile status">
            <option value="" className="bg-surface">Any</option>
            {PROFILE_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s}</option>)}
          </select>
        </div>
        <div>
          <span className={label}>Moderation</span>
          <select className={input} value={modStatus} onChange={(e) => setModStatus(e.target.value)} aria-label="Moderation status">
            <option value="" className="bg-surface">Any</option>
            {MOD_STATUS.map((s) => <option key={s} value={s} className="bg-surface">{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <form className="flex gap-2 flex-1 min-w-[220px]" onSubmit={(e) => { e.preventDefault(); setQApplied(q.trim()); }}>
          <div className="flex-1">
            <span className={label}>Display name</span>
            <input className={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={40} placeholder="Search" />
          </div>
          <button type="submit" className={`${btnGhost} self-end`}>Search</button>
        </form>
        <button onClick={() => load(false)} disabled={loading} className={`${btnGhost} self-end`}>{loading ? '…' : 'Refresh'}</button>
      </div>
      <LoggedNote />

      <LoadState loading={loading} error={error} empty={items.length === 0} reload={() => load(false)} emptyText="No Connect profiles match these filters." />

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="zv-table zv-table-dense">
            <thead>
              <tr className="text-xs text-fg-muted">
                <th className="py-2 pr-3">Profile</th><th className="py-2 pr-3">Campus</th><th className="py-2 pr-3">State</th><th className="py-2 pr-3">Selfie</th><th className="py-2 pr-3">Last active</th><th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((p) => (
                <tr key={p.profileId}>
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-fg">{p.displayName || 'Not set up'}</p>
                    <p className="text-xs text-fg-muted">{p.user?.name || 'Unknown account'} <span className="font-mono text-fg-subtle">{shortId(p.user?.userId)}</span></p>
                  </td>
                  <td className="py-3 pr-3 text-fg-muted">{campusName(p.campusId)}</td>
                  <td className="py-3 pr-3 space-x-1"><StatusChip s={p.status} />{p.modStatus !== 'visible' && <StatusChip s={p.modStatus} />}</td>
                  <td className="py-3 pr-3"><StatusChip s={p.livenessStatus} /></td>
                  <td className="py-3 pr-3 text-fg-muted">{fmt(p.lastActiveAt)}</td>
                  <td className="py-3 text-right"><button onClick={() => openProfile(p.profileId)} className={btnBlue}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && <div className="text-center"><button onClick={() => load(true, cursor)} disabled={loading} className={btnGhost}>{loading ? '…' : 'Load more'}</button></div>}

      {open && (
        <Drawer title={detail?.profile.displayName || 'Connect profile'} onClose={close}>
          <LoggedNote />
          {!detail ? (
            detailErr
              ? <div className="space-y-3"><p className="text-xs text-danger-text font-semibold">{detailErr}</p><button onClick={() => loadDetail(open)} className={btnGhost}>Try again</button></div>
              : <p className="text-xs text-fg-muted animate-pulse">Loading…</p>
          ) : (
            <ProfileDetailView d={detail} busy={busy} onAction={(a) => moderate(detail.profile.profileId, a)} />
          )}
        </Drawer>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-xs">
      <span className="text-fg-muted font-semibold text-xs pt-0.5">{k}</span>
      <span className="text-fg text-right break-words">{v}</span>
    </div>
  );
}

function ProfileDetailView({ d, busy, onAction }: { d: ProfileDetail; busy: boolean; onAction: (a: 'hide' | 'remove' | 'restore' | 'delete') => void }) {
  const p = d.profile;
  const list = (x?: Array<string | number> | null) => (x && x.length ? x.join(', ') : '-');
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1">
        <StatusChip s={p.status} /><StatusChip s={p.modStatus} /><span className={`${chip} text-fg-muted border-line bg-surface-2/60`}>selfie {p.livenessStatus}</span>
      </div>
      {p.modReason && <p className="text-xs text-danger-text">Moderation reason: {p.modReason}</p>}

      <div>
        <span className={label}>Photos</span>
        <div className="flex flex-wrap gap-2">
          {d.photos.length === 0 && <p className="text-xs text-fg-muted">No photos.</p>}
          {d.photos.map((ph) => (
            <div key={ph.id} className="space-y-1">
              <Photo url={ph.url} alt={`Photo ${ph.position + 1}`} size="h-24 w-24" />
              <StatusChip s={ph.status} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-line px-4 py-2 divide-y divide-line">
        <Row k="Account" v={<>{p.user?.name || 'Unknown'} <span className="font-mono text-fg-muted">{shortId(p.user?.userId)}</span>{p.user && !p.user.isActive && <span className="ml-1 text-danger-text">(suspended)</span>}</>} />
        <Row k="Bio" v={p.bio || '-'} />
        <Row k="Interests" v={list(p.interests)} />
        <Row k="Looking for" v={list(p.lookingFor)} />
        <Row k="Shows year / branch" v={`${p.showYear ? 'yes' : 'no'} / ${p.showBranch ? 'yes' : 'no'}`} />
        <Row k="Hidden from branches" v={list(p.hiddenBranches)} />
        <Row k="Hidden from years" v={list(p.hiddenYears)} />
        <Row k="Consent" v={p.consentVersion ? `v${p.consentVersion} · ${fmt(p.consentAt)}` : '-'} />
        <Row k="18+ declared" v={fmt(p.ageDeclaredAt)} />
        <Row k="Selfie decided" v={fmt(p.livenessCheckedAt)} />
        <Row k="Activated" v={fmt(p.activatedAt)} />
        <Row k="Last active" v={fmt(p.lastActiveAt)} />
        <Row k="Active matches" v={d.activeMatches} />
      </div>

      <div>
        <span className={label}>Reports ({d.reports.length})</span>
        {d.reports.length === 0 ? <p className="text-xs text-fg-muted">None.</p> : (
          <ul className="rounded-xl border border-line divide-y divide-line">
            {d.reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <StatusChip s={r.status} /><span className="text-fg">{r.category}</span><span className="text-fg-muted">{r.targetType.replace('_', ' ')} · {r.severity}</span>
                <span className="ml-auto text-xs text-fg-muted">{fmt(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {d.reports.length > 0 && <Link href="/moderation" className="inline-block mt-2 text-xs font-semibold text-info-text hover:text-info-text">Handle in the reports queue →</Link>}
      </div>

      <div>
        <span className={label}>Moderation history ({d.actions.length})</span>
        {d.actions.length === 0 ? <p className="text-xs text-fg-muted">None.</p> : (
          <ul className="rounded-xl border border-line divide-y divide-line">
            {d.actions.map((a) => (
              <li key={a.id} className="px-3 py-2 text-xs">
                <span className="font-semibold text-fg">{a.action}</span>{a.reason && <span className="text-fg-muted"> · {a.reason}</span>}
                <span className="float-right text-xs text-fg-muted">{fmt(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2 justify-end border-t border-line pt-4">
        {p.modStatus !== 'visible' && <button disabled={busy} onClick={() => onAction('restore')} className={btnGo}>Restore</button>}
        {p.modStatus !== 'hidden' && p.modStatus !== 'removed' && <button disabled={busy} onClick={() => onAction('hide')} className={btnGhost}>Hide</button>}
        {p.modStatus !== 'removed' && <button disabled={busy} onClick={() => onAction('remove')} className={btnWarn}>Remove</button>}
        <button disabled={busy} onClick={() => onAction('delete')} className={btnWarn}>Delete Connect data</button>
      </div>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

const HELPLINE_PHONE = /^[0-9+\- ]{3,20}$/;
const helplineErrors = (list: Helpline[], where: string) => {
  const e: string[] = [];
  list.forEach((h, i) => {
    const n = `${where} ${i + 1}`;
    if (!h.name || h.name.trim().length < 2 || h.name.length > 80) e.push(`${n}: name must be 2-80 characters.`);
    if (!h.phone && !h.url) e.push(`${n}: give a phone number or a link.`);
    if (h.phone && !HELPLINE_PHONE.test(h.phone)) e.push(`${n}: phone may only have digits, +, - and spaces (3-20).`);
    if (h.url && !/^https:\/\/\S{4,300}$/i.test(h.url)) e.push(`${n}: link must start with https://.`);
    if (h.note && h.note.length > 160) e.push(`${n}: note is at most 160 characters.`);
  });
  return e;
};
const linesErrors = (text: string, what: string) => {
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return [`${what}: add at least one line.`];
  if (lines.length > 100) return [`${what}: at most 100 lines.`];
  const badLine = lines.find((x) => x.length < 5 || x.length > 240);
  return badLine ? [`${what}: every line must be 5-240 characters ("${badLine.slice(0, 30)}…").`] : [];
};
const cleanHelplines = (list: Helpline[]) => list.map((h) => ({
  name: h.name.trim(), ...(h.phone?.trim() ? { phone: h.phone.trim() } : {}), ...(h.url?.trim() ? { url: h.url.trim() } : {}), ...(h.note?.trim() ? { note: h.note.trim() } : {}),
}));

function HelplineEditor({ list, onChange }: { list: Helpline[]; onChange: (l: Helpline[]) => void }) {
  const set = (i: number, k: keyof Helpline, v: string) => onChange(list.map((h, j) => (j === i ? { ...h, [k]: v } : h)));
  return (
    <div className="space-y-2">
      {list.map((h, i) => (
        <div key={i} className="grid grid-cols-1 md:grid-cols-[1.4fr_0.8fr_1.2fr_1.4fr_auto] gap-2 items-center">
          <input className={input} value={h.name} maxLength={80} onChange={(e) => set(i, 'name', e.target.value)} placeholder="Name" aria-label="Helpline name" />
          <input className={input} value={h.phone || ''} maxLength={20} onChange={(e) => set(i, 'phone', e.target.value)} placeholder="Phone" aria-label="Helpline phone" />
          <input className={input} value={h.url || ''} maxLength={300} onChange={(e) => set(i, 'url', e.target.value)} placeholder="https://" aria-label="Helpline link" />
          <input className={input} value={h.note || ''} maxLength={160} onChange={(e) => set(i, 'note', e.target.value)} placeholder="Note" aria-label="Helpline note" />
          <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} className="text-xs font-semibold text-danger-text hover:text-danger-text px-2">Remove</button>
        </div>
      ))}
      {list.length < 20 && <button type="button" onClick={() => onChange([...list, { name: '', phone: '' }])} className={btnGhost}>Add helpline</button>}
    </div>
  );
}

function SettingsTab({ campuses, busy, act }: { campuses: Campus[]; busy: boolean; act: Act }) {
  const confirm = useConfirm();
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [policyText, setPolicyText] = useState('');
  const [helplines, setHelplines] = useState<Helpline[]>([]);
  const [campusHelplines, setCampusHelplines] = useState<Record<string, Helpline[]>>({});
  const [chCampus, setChCampus] = useState('');
  const [guidance, setGuidance] = useState('');
  const [sparks, setSparks] = useState('');
  const [consentVersion, setConsentVersion] = useState(1);

  const apply = (d: Settings) => {
    setS(d);
    setPolicyText(d.policy.text);
    setHelplines(d.helplines || []);
    setCampusHelplines(d.campusHelplines || {});
    setGuidance((d.guidance || []).join('\n'));
    setSparks((d.sparkPrompts || []).join('\n'));
    setConsentVersion(d.connectConsentVersion || 1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      apply(await adminRequest<Settings>('/api/campus/connect/admin/settings'));
      setError(undefined);
    } catch (e) {
      setError(errText(e, 'Could not load Connect settings.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (!chCampus && campuses[0]) setChCampus(campuses[0].id); }, [campuses, chCampus]);

  if (!s) return <section className={card}><LoadState loading={loading} error={error} empty reload={load} emptyText="No settings." /></section>;

  const chList = (chCampus && campusHelplines[chCampus]) || [];
  const errors = [
    ...(policyText.trim().length < 50 || policyText.length > 20000 ? ['Privacy notice must be 50-20000 characters.'] : []),
    ...helplineErrors(helplines, 'Helpline'),
    ...Object.entries(campusHelplines).flatMap(([cid, l]) => helplineErrors(l, `${campuses.find((c) => c.id === cid)?.code || 'Campus'} helpline`)),
    ...linesErrors(guidance, 'Safety guidance'),
    ...linesErrors(sparks, 'Spark prompts'),
    ...(!Number.isInteger(consentVersion) || consentVersion < s.connectConsentVersion ? [`Consent version cannot go below ${s.connectConsentVersion}.`] : []),
  ];
  const consentBump = consentVersion > s.connectConsentVersion;

  const save = async () => {
    if (errors.length) return;
    if (consentBump && !(await confirm({ title: `Raise the Connect consent version to ${consentVersion}? Every student on Connect must accept the notice again before using it.` }))) return;
    const body: Record<string, unknown> = {
      policyText,
      helplines: cleanHelplines(helplines),
      campusHelplines: Object.fromEntries(Object.entries(campusHelplines).filter(([, l]) => l.length).map(([k, l]) => [k, cleanHelplines(l)])),
      guidance: guidance.split('\n').map((x) => x.trim()).filter(Boolean),
      sparkPrompts: sparks.split('\n').map((x) => x.trim()).filter(Boolean),
      ...(consentBump ? { connectConsentVersion: consentVersion } : {}),
    };
    act(async () => apply(await adminRequest<Settings>('/api/campus/connect/admin/settings', { method: 'PUT', body: JSON.stringify(body) })),
      policyText !== s.policy.text ? 'Saved. The privacy notice got a new version.' : 'Saved.', []);
  };

  return (
    <div className="space-y-6">
      <section className={card}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">Consent</h2>
            <p className="text-xs text-fg-muted mt-1 max-w-2xl">Students accept this version (with the 18+ declaration) before Connect opens. Raise it when the notice changes in a way people must agree to again. It can only go up.</p>
          </div>
          <button onClick={load} disabled={loading} className={btnGhost}>{loading ? '…' : 'Reload'}</button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <span className={label}>Consent version</span>
            <input type="number" className={input} min={s.connectConsentVersion} step={1} value={consentVersion} onChange={(e) => setConsentVersion(Number(e.target.value))} />
          </div>
          <p className="text-xs text-fg-muted pb-2">Current: v{s.connectConsentVersion}{consentBump && <span className="text-warning-text"> · will ask everyone again</span>}</p>
        </div>
        <p className="text-xs text-fg-muted">Public policy link: {s.policyUrl ? <a href={s.policyUrl} target="_blank" rel="noreferrer noopener" className="text-info-text break-all">{s.policyUrl}</a> : 'not set (FRIENDS_POLICY_URL). The app shows the notice below in-app.'}</p>
      </section>

      <section className={card}>
        <div>
          <h2 className="text-sm font-semibold text-fg">Privacy notice</h2>
          <p className="text-xs text-fg-muted mt-1">Shown on the in-app policy screen. Notice v{s.policy.version}{s.policy.updatedAt ? `, updated ${fmt(s.policy.updatedAt)}` : ' (built-in default)'}. Saving a change creates a new notice version.</p>
        </div>
        <textarea className={`${input} min-h-[260px] font-mono text-xs`} maxLength={20000} value={policyText} onChange={(e) => setPolicyText(e.target.value)} aria-label="Privacy notice" />
        <p className="text-xs text-fg-muted">{policyText.length}/20000</p>
      </section>

      <section className={card}>
        <div>
          <h2 className="text-sm font-semibold text-fg">Helplines</h2>
          <p className="text-xs text-fg-muted mt-1">Shown on the safety screen and after a report. Each needs a phone number or an https link.</p>
        </div>
        <HelplineEditor list={helplines} onChange={setHelplines} />
        <button type="button" onClick={() => setHelplines(s.defaults.helplines)} className="text-xs font-semibold text-fg-muted hover:text-fg">Reset to defaults</button>

        <div className="border-t border-line pt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className={label}>Campus helplines (shown first)</span>
              <select className={`${input} min-w-[200px]`} value={chCampus} onChange={(e) => setChCampus(e.target.value)} aria-label="Campus for helplines">
                {campuses.length === 0 && <option value="">No active campuses</option>}
                {campuses.map((c) => <option key={c.id} value={c.id} className="bg-surface">{c.name} ({c.code}){campusHelplines[c.id]?.length ? ` · ${campusHelplines[c.id].length}` : ''}</option>)}
              </select>
            </div>
            <p className="text-xs text-fg-muted pb-2">Campus security, counselling cell, women&apos;s cell. Up to 10 per campus.</p>
          </div>
          {chCampus && (
            <HelplineEditor list={chList} onChange={(l) => setCampusHelplines((m) => ({ ...m, [chCampus]: l.slice(0, 10) }))} />
          )}
        </div>
      </section>

      <section className={card}>
        <div>
          <h2 className="text-sm font-semibold text-fg">Safety guidance</h2>
          <p className="text-xs text-fg-muted mt-1">One tip per line, shown before activation and on the safety screen.</p>
        </div>
        <textarea className={`${input} min-h-[160px] text-xs`} value={guidance} onChange={(e) => setGuidance(e.target.value)} aria-label="Safety guidance" />
        <button type="button" onClick={() => setGuidance(s.defaults.guidance.join('\n'))} className="text-xs font-semibold text-fg-muted hover:text-fg">Reset to defaults</button>
      </section>

      <section className={card}>
        <div>
          <h2 className="text-sm font-semibold text-fg">Spark prompts</h2>
          <p className="text-xs text-fg-muted mt-1">Daily conversation starters shown in a new match chat. One per line, rotated by day.</p>
        </div>
        <textarea className={`${input} min-h-[200px] text-xs`} value={sparks} onChange={(e) => setSparks(e.target.value)} aria-label="Spark prompts" />
        <button type="button" onClick={() => setSparks(s.defaults.sparkPrompts.join('\n'))} className="text-xs font-semibold text-fg-muted hover:text-fg">Reset to defaults</button>
      </section>

      <div className="rounded-lg border border-line bg-surface shadow-xs p-4 flex flex-wrap items-center justify-between gap-3 sticky bottom-4">
        {errors.length > 0
          ? <ul className="text-xs text-warning-text list-disc pl-4">{errors.slice(0, 4).map((e) => <li key={e}>{e}</li>)}{errors.length > 4 && <li>…and {errors.length - 4} more</li>}</ul>
          : <p className="text-xs text-fg-muted">Changes are logged. The app picks them up within a minute.</p>}
        <div className="flex gap-2">
          <button onClick={() => apply(s)} disabled={busy} className={btnGhost}>Discard changes</button>
          <button onClick={save} disabled={busy || errors.length > 0} className={btnGo}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      </div>
    </div>
  );
}
