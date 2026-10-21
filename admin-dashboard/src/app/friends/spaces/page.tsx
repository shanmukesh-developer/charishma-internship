"use client";
import {
  Badge, Button, ButtonLink, Card, CardBody, CardHeader, DataTable, DescriptionList, Drawer, ErrorState, LoadingState, Notice as NoticeBox,
  PageHeader, SearchInput, SectionTitle, Select, StatTile, StatusPill, Tabs, Toolbar, useConfirm, usePrompt, useToast,
  type Column, IconCheckCircle, IconRefresh,
} from '@/components/ui';
import { formatDateTime, formatTime, humanize, plural } from '@/lib/format';
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

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const qs = (o: Record<string, string | undefined | null>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
const fmt = (d?: string | null) => (d ? formatDateTime(d, { short: true }) : '–');
const shortId = (id?: string | null) => (id ? `${id.slice(0, 8)}…` : '-');
const since = (d?: string | null) => {
  if (!d) return '-';
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const hostName = (h: Ident) => h.entity?.name ? `${h.entity.name} (by ${h.name || 'student'})` : (h.name || 'Former student');

type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
const TONE: Record<string, ChipTone> = {
  live: 'success',
  visible: 'success',
  scheduled: 'info',
  pending_review: 'warning',
  ended: 'neutral',
  hidden: 'neutral',
  expired: 'neutral',
  cancelled: 'danger',
  removed: 'danger',
  host: 'accent',
  cohost: 'accent',
  speaker: 'info',
  listener: 'neutral',
};
function Chip({ s }: { s: string }) {
  return <Badge tone={TONE[s] || 'neutral'}>{humanize(s)}</Badge>;
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
    const reason = (await ask({ title: `${what}?`, label: 'Reason for the audit log', hint: `“${s.title}”. At least 5 characters.`, defaultValue: '', minLength: 5 }));
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
    if (!(await confirm({ title: 'Run the Spaces jobs now?', description: 'This sends due reminders, expires scheduled Spaces nobody started, and ends abandoned rooms. They also run on their own every 15 seconds.', confirmLabel: 'Run jobs' }))) return;
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

  if (!isAuthed) return null; // AppShell shows the session check

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'live', label: 'Live now', count: stats?.byStatus?.live },
    { id: 'all', label: 'All Spaces' },
    { id: 'overview', label: 'Overview and jobs' },
  ];

  const CampusSelect = (
    <Select className="w-auto min-w-[180px]" value={campusId} onChange={(e) => setCampusId(e.target.value)} aria-label="Campus">
      <option value="">All campuses</option>
      {campuses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
    </Select>
  );


  const summary = (s: AdminSpace) => (s.status === 'live'
    ? `Live for ${since(s.startedAt)}`
    : s.status === 'scheduled'
      ? `Starts ${fmt(s.scheduledFor)}`
      : `${s.endReason ? `${humanize(s.endReason)} · ` : ''}${fmt(s.endedAt || s.createdAt)}`);

  const columns: Column<AdminSpace>[] = [
    {
      key: 'title',
      header: 'Space',
      sortValue: s => s.title,
      cell: s => (
        <div className="min-w-0 max-w-[340px]">
          <p className="truncate font-medium text-fg">{s.title}</p>
          <p className="truncate text-xs text-fg-muted">{hostName(s.host)}{s.topic ? ` · ${s.topic}` : ''}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: s => s.status,
      cell: s => (
        <div className="flex flex-wrap gap-1">
          <Chip s={s.status} />
          {s.modStatus !== 'visible' && <Chip s={s.modStatus} />}
        </div>
      ),
    },
    { key: 'when', header: 'When', sortValue: s => new Date(s.startedAt || s.scheduledFor || s.createdAt), cell: s => <span className="whitespace-nowrap text-xs text-fg-muted">{summary(s)}</span> },
    {
      key: 'people',
      header: 'People',
      align: 'right',
      sortValue: s => (s.status === 'live' ? s.speakerCount + s.listenerCount : s.status === 'scheduled' ? s.interestedCount : s.memberTotals.members),
      cell: s => (
        <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">
          {s.status === 'live'
            ? `${s.speakerCount}/${s.limits.maxSpeakers} stage · ${s.listenerCount}/${s.limits.maxListeners} listening`
            : s.status === 'scheduled'
              ? `${s.interestedCount} interested`
              : `${s.memberTotals.members} joined · peak ${s.peakListeners ?? 0}`}
        </span>
      ),
    },
    { key: 'campus', header: 'Campus', hideBelow: 'lg', cell: s => <span className="text-xs text-fg-muted">{campusName(s.campusId)}</span> },
    { key: 'stage', header: 'Stage', hideBelow: 'xl', cell: s => <span className="text-xs text-fg-muted">{s.participation === 'open' ? 'Open stage' : 'Request to speak'}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: s => ((s.status === 'live' || s.status === 'scheduled')
        ? <Button size="sm" variant="ghost" className="text-danger-text" disabled={busy} onClick={() => forceEnd(s)}>{s.status === 'live' ? 'Force end' : 'Cancel'}</Button>
        : null),
    },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Spaces"
        description="Live audio rooms: monitor who is on stage, inspect a room and force end it. Reports on Spaces are handled in the moderation queue."
        breadcrumbs={[{ label: 'Friends app', href: '/friends' }, { label: 'Spaces' }]}
        actions={<ButtonLink href="/moderation?tab=queue">Reports queue</ButtonLink>}
      />

      <NoticeBox tone="info" className="mb-4">
        Spaces are never recorded. Audio goes directly between students (WebRTC) and never passes through the server, so admins can see who is in a room but cannot listen. Force end is logged with your reason.
      </NoticeBox>

      {notice && <NoticeBox tone={notice.kind === 'ok' ? 'success' : 'danger'} className="mb-4" onClose={() => setNotice(null)}>{notice.text}</NoticeBox>}

      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={TABS.map(t => ({ id: t.id, label: t.label, count: t.count || null }))}
      />

      {tab !== 'overview' && (
        <Toolbar end={tab === 'live'
          ? <span className="text-xs text-fg-muted">{liveAt ? `Updated ${formatTime(liveAt)} · refreshes every 15 seconds` : ''}</span>
          : undefined}
        >
          {CampusSelect}
          {tab === 'live' && <Button size="sm" leftIcon={<IconRefresh size={14} />} loading={liveLoading} onClick={loadLive}>Refresh</Button>}
          {tab === 'all' && (
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
              <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                <option value="">Any status</option>
                {SPACE_STATUS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
              <Select className="w-auto" value={modStatus} onChange={(e) => setModStatus(e.target.value)} aria-label="Moderation">
                <option value="">Any moderation</option>
                {MOD_STATUS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
              <SearchInput value={q} onChange={setQ} onEnter={() => setQuery(q.trim())} placeholder="Title or topic" className="w-56" />
              <Button type="submit">Search</Button>
            </form>
          )}
        </Toolbar>
      )}

      {tab === 'live' && (
        <DataTable
          caption="Live Spaces"
          columns={columns}
          rows={live}
          rowKey={s => s.id}
          loading={liveLoading && !live.length}
          error={!live.length ? liveErr || null : null}
          onRetry={loadLive}
          onRowClick={s => setOpenId(s.id)}
          pageSize={0}
          noun="Spaces"
          empty={{ title: 'No Space is live right now' }}
        />
      )}

      {tab === 'all' && (
        <>
          <DataTable
            caption="All Spaces"
            columns={columns}
            rows={all}
            rowKey={s => s.id}
            loading={allLoading && !all.length}
            error={!all.length ? allErr || null : null}
            onRetry={() => loadAll(false)}
            onRowClick={s => setOpenId(s.id)}
            pageSize={0}
            noun="Spaces"
            empty={{ title: 'No Spaces match these filters' }}
          />
          {allCursor && (
            <div className="mt-3 flex justify-center">
              <Button size="sm" loading={allLoading} onClick={() => loadAll(true, allCursor)}>Load more</Button>
            </div>
          )}
        </>
      )}

      {tab === 'overview' && (
        <div className="space-y-5">
          <Toolbar end={<Button size="sm" leftIcon={<IconRefresh size={14} />} onClick={loadStats}>Refresh</Button>}>{CampusSelect}</Toolbar>
          {statsErr && !stats && <ErrorState message={statsErr} onRetry={loadStats} />}
          {stats && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile label="Live rooms" value={stats.byStatus.live ?? 0} />
                <StatTile label="People in rooms" value={stats.liveParticipants} />
                <StatTile label="Scheduled" value={stats.byStatus.scheduled ?? 0} />
                <StatTile label="Under review" value={stats.pendingReview} tone={stats.pendingReview ? 'warning' : 'neutral'} />
                <StatTile label="Created (24 hours)" value={stats.created24h} />
                <StatTile label="Ended" value={stats.byStatus.ended ?? 0} />
                <StatTile label="Cancelled" value={stats.byStatus.cancelled ?? 0} />
                <StatTile label="Expired" value={stats.byStatus.expired ?? 0} />
              </div>
              <Card>
                <CardHeader title="Room setup" />
                <CardBody>
                  <DescriptionList
                    columns={3}
                    items={[
                      { label: 'Room caps', value: <>{stats.caps.maxSpeakers} on stage (host included) · {stats.caps.maxListeners} listeners<span className="mt-0.5 block text-xs text-fg-muted">Set with SPACES_MAX_SPEAKERS and SPACES_MAX_LISTENERS on the server.</span></> },
                      { label: 'Relay (TURN)', value: <><StatusPill status={stats.turnConfigured ? 'ok' : 'missing'} tone={stats.turnConfigured ? 'success' : 'warning'} label={stats.turnConfigured ? 'Configured' : 'Not configured (public STUN only)'} /><span className="mt-1 block text-xs text-fg-muted">Without TURN, students on strict networks may not hear each other.</span></> },
                      { label: 'Recording', value: 'Off. Spaces are never recorded.' },
                    ]}
                  />
                </CardBody>
              </Card>
            </>
          )}
          <Card>
            <CardHeader
              title="Background jobs"
              description="Reminders, expiry of unstarted Spaces and ending abandoned rooms. They also run on their own every 15 seconds."
              actions={<Button size="sm" loading={busy} onClick={runJobs}>Run now</Button>}
            />
            {jobStats && (
              <CardBody>
                <p className="text-sm text-fg-muted">
                  Last run: {jobStats.reminders} reminders sent, {jobStats.missed} skipped (missed start), {jobStats.expired} expired, {jobStats.abandoned} abandoned rooms ended, {jobStats.orphaned} lost rooms closed.
                </p>
              </CardBody>
            )}
          </Card>
        </div>
      )}

      <Drawer
        open={!!openId}
        onClose={() => setOpenId(null)}
        size="md"
        title={detail?.space.title || 'Space'}
        description={detail ? `Host: ${hostName(detail.space.host)}` : undefined}
        footer={detail && (detail.space.status === 'live' || detail.space.status === 'scheduled') ? (
          <Button variant="destructive" loading={busy} onClick={() => forceEnd(detail.space)}>
            {detail.space.status === 'live' ? 'Force end this Space' : 'Cancel this Space'}
          </Button>
        ) : undefined}
      >
        {openId && (!detail ? (
          detailErr ? <ErrorState message={detailErr} onRetry={() => loadDetail(openId)} /> : <LoadingState label="Loading Space…" />
        ) : (
          <SpaceDetail d={detail} campusName={campusName} />
        ))}
      </Drawer>
    </div>
  );
}

function SpaceDetail({ d, campusName }: { d: Detail; campusName: (id: string) => string }) {
  const s = d.space;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip s={s.status} />
        <Chip s={s.modStatus} />
        <Badge>{campusName(s.campusId)}</Badge>
        {d.reports > 0 && <Link href="/moderation?tab=queue"><Badge tone="warning">{plural(d.reports, 'report')}</Badge></Link>}
      </div>
      {(s.topic || s.description || s.removedReason) && (
        <div className="space-y-1 text-sm">
          {s.topic && <p className="text-fg-muted">Topic: <span className="text-fg">{s.topic}</span></p>}
          {s.description && <p className="whitespace-pre-wrap text-fg-muted">{s.description}</p>}
          {s.removedReason && <p className="text-danger-text">Moderation: {s.removedReason}</p>}
        </div>
      )}
      <DescriptionList
        columns={2}
        items={[
          { label: 'Created', value: fmt(s.createdAt) },
          { label: 'Scheduled', value: fmt(s.scheduledFor) },
          { label: 'Started', value: fmt(s.startedAt) },
          { label: 'Ended', value: fmt(s.endedAt) },
          { label: 'End reason', value: s.endReason ? humanize(s.endReason) : '–' },
          { label: 'Peak listeners', value: s.peakListeners ?? 0 },
          { label: 'Interested', value: s.interestedCount },
          { label: 'Joined / removed', value: `${s.memberTotals.members} / ${s.memberTotals.removed}` },
        ]}
      />

      {d.live && (
        <section>
          <SectionTitle title="In the room now" description={`${d.live.speakerCount}/${d.live.limits.maxSpeakers} on stage · ${d.live.listenerCount}/${d.live.limits.maxListeners} listening`} />
          {!d.live.participants.length ? <p className="text-sm text-fg-muted">Nobody is connected.</p> : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {d.live.participants.map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate text-sm text-fg">{p.name || 'Student'}{p.verified && <IconCheckCircle size={13} className="ml-1 inline text-accent-text" aria-label="verified" />}</span>
                  <span className="flex shrink-0 flex-wrap items-center gap-1">
                    <Chip s={p.role} />
                    {p.hand && <Badge tone="warning">Hand up</Badge>}
                    {p.invited && <Badge tone="info">Invited</Badge>}
                    {p.mutedByHost ? <Badge tone="danger">Muted by host</Badge> : p.muted && <Badge>Muted</Badge>}
                    {!p.connected && <Badge>Reconnecting</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <SectionTitle title={`Everyone who joined (${d.members.length})`} />
        {!d.members.length ? <p className="text-sm text-fg-muted">Nobody joined.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {d.members.map((m, i) => (
              <li key={`${m.user.userId || 'x'}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{m.user.name || 'Former student'}</span>
                  <span className="text-xs text-fg-muted">Joined {fmt(m.joinedAt)}{m.leftAt ? ` · left ${fmt(m.leftAt)}` : ''}</span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1">
                  <Chip s={m.role} />
                  {m.present && <Badge tone="success">Here</Badge>}
                  {m.removedAt && <Badge tone="danger">Removed</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle title="Audit trail" />
        {!d.actions.length ? <p className="text-sm text-fg-muted">No actions recorded.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {d.actions.map((a) => (
              <li key={a.id} className="px-3 py-2">
                <p className="text-sm font-medium text-fg">{humanize(a.action)} <span className="font-normal text-fg-muted">by {a.actorRole} {shortId(a.actorId)}</span></p>
                {a.reason && <p className="text-sm text-fg-muted">{a.reason}</p>}
                <p className="text-xs text-fg-muted">{fmt(a.createdAt)}{a.subjectUserId ? ` · subject ${shortId(a.subjectUserId)}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
