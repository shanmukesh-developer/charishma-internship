"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest } from '@/lib/api';
import { useLiveSync, useFreshIds, FRESH_ROW_CLASS, liveLabel, type LiveEvent } from '@/lib/useLiveSync';

/**
 * Zenvy Friends moderation (backend: /api/campus/mod, admins only).
 * One queue for every reportable target (profiles, chat messages now; Forum, Pulse, Tasks, Connect
 * and Spaces content as those phases ship). Reports are grouped by target; resolving a report closes
 * every open report on the same target and writes an audited FriendsModAction.
 *
 * Anonymous authors are never shown here. "Reveal author" needs a written reason and is logged.
 */

// ── Contract (mirrors backend/modules/friends/models/foundation/enums.js) ──────
// 'campus' (C2): whispers, community posts, lost & found, campus spots, groups and polls.
const SUB_TABS = ['pulse', 'forum', 'tasks', 'connect', 'spaces', 'chat', 'campus'] as const;
const CATEGORIES = [
  'spam', 'impersonation', 'harassment', 'threat', 'privacy', 'sexual', 'hate',
  'academic_integrity', 'defamation', 'self_harm', 'other',
] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const REPORT_STATUSES = ['open', 'in_review', 'actioned', 'dismissed', 'escalated'] as const;
const SANCTION_SCOPES = ['friends', 'pulse', 'forum', 'tasks', 'connect', 'spaces'] as const;
const MOD_ACTIONS = [
  'remove', 'restore', 'hide', 'hide_pending', 'warn', 'sanction', 'lift_sanction', 'pin', 'unpin', 'lock', 'unlock',
  'best_answer', 'assign', 'resolve', 'dismiss', 'escalate', 'reveal_author', 'view_connect', 'view_private_chat',
  'role_grant', 'role_revoke', 'edit_self', 'delete_self', 'space_mute', 'space_remove', 'space_end',
  'approve', 'reject', 'appeal_upheld', 'appeal_reversed', 'config_update', 'entity_create', 'entity_update',
  'badge_grant', 'badge_revoke',
] as const;
type Decision = 'dismiss' | 'remove' | 'hide' | 'warn' | 'sanction' | 'escalate';

interface Snapshot {
  excerpt?: string;
  mediaIds?: string[];
  anonymous?: boolean;
  alias?: string | null;
  createdAt?: string;
  reportedAt?: string;
  [k: string]: unknown;
}

interface QueueItem {
  targetType: string;
  targetId: string;
  latestReportId: string;
  reportIds: string[];
  reporterCount: number;
  categories: string[];
  severity: string;
  status: string;
  subTab: string;
  assignedTo: string | null;
  slaDueAt: string | null;
  overdue: boolean;
  snapshot: Snapshot | null;
  lastReportedAt: string;
}

interface ReportRow {
  id: string;
  reporterId?: string | null;
  isSystem: boolean;
  targetType: string;
  targetId: string;
  subTab: string;
  category: string;
  note: string | null;
  severity: string;
  status: string;
  assignedTo: string | null;
  slaDueAt: string | null;
  overdue: boolean;
  decision: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  actionId: string | null;
  createdAt: string;
  snapshot?: Snapshot | null;
}

interface ModAction {
  id: string;
  actorId: string | null;
  actorRole: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  subjectUserId: string | null;
  communityId: string | null;
  reportId: string | null;
  reason: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface ReportDetail {
  report: ReportRow;
  reports: ReportRow[];
  reporterCount: number;
  currentState: Record<string, unknown> | null;
  actions: ModAction[];
  authorHistory:
    | null
    | { anonymous: true; sanctionCount: number; priorActionCount: number }
    | {
      anonymous: false;
      userId: string;
      name?: string;
      priorActionCount: number;
      sanctions: Array<{ id: string; scope: string; until: string | null; liftedAt: string | null; reason: string | null; createdAt: string }>;
    };
  moderation: { statuses: string[]; canReveal: boolean };
}

interface Appeal {
  id: string;
  userId: string;
  actionId: string;
  text: string;
  status: string;
  note: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  action: ModAction | null;
}

interface Sanction {
  id: string;
  userId: string;
  scope: string;
  until: string | null;
  reason: string | null;
  actionId: string | null;
  createdBy: string | null;
  liftedAt: string | null;
  liftedBy: string | null;
  createdAt: string;
  active: boolean;
}

type Paged<T> = { items: T[]; nextCursor: string | null };
type Notice = { kind: 'ok' | 'error'; text: string } | null;
type Tab = 'queue' | 'appeals' | 'sanctions' | 'audit';

// ── Helpers ─────────────────────────────────────────────────────────────────
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const words = (v: string) => v.replace(/_/g, ' ');
const shortId = (v?: string | null) => (v ? (v.length > 12 ? `${v.slice(0, 8)}…` : v) : '—');
const fmt = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};
const relDue = (iso: string | null) => {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '—';
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const span = h >= 48 ? `${Math.floor(h / 24)}d` : h ? `${h}h ${m}m` : `${m}m`;
  return ms < 0 ? `${span} overdue` : `in ${span}`;
};
const qs = (params: Record<string, string | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

const SEVERITY_TONE: Record<string, string> = {
  critical: 'text-danger-text bg-danger-soft border-danger/30',
  high: 'text-warning-text bg-warning-soft border-warning/30',
  medium: 'text-warning-text bg-warning-soft border-warning/30',
  low: 'text-fg-muted bg-surface-2/60 border-line',
};
const STATUS_TONE: Record<string, string> = {
  open: 'text-info-text bg-info-soft border-info/30',
  in_review: 'text-accent-text bg-accent-soft border-accent/30',
  escalated: 'text-danger-text bg-danger-soft border-danger/30',
  actioned: 'text-success-text bg-success-soft border-success/30',
  dismissed: 'text-fg-muted bg-surface-2/60 border-line',
  upheld: 'text-fg-muted bg-surface-2/60 border-line',
  reversed: 'text-success-text bg-success-soft border-success/30',
};
const pill = 'inline-block text-xs font-semibold px-2 py-1 rounded-md border whitespace-nowrap';
const input = 'w-full rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-fg outline-none focus:border-accent';
const select = 'rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg outline-none focus:border-accent';
const label = 'block text-xs font-semibold text-fg-muted mb-1';
const btn = 'rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40 transition-colors';
const btnGhost = `${btn} border border-line bg-surface-2/60 text-fg-muted hover:text-fg`;
const th = 'px-4 py-3 text-xs font-semibold text-fg-muted whitespace-nowrap';

function Badge({ value, tones }: { value: string; tones: Record<string, string> }) {
  return <span className={`${pill} ${tones[value] || tones.low || 'text-fg-muted bg-surface-2/60 border-line'}`}>{words(value)}</span>;
}

function LoggedNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-warning-text flex items-center gap-2">
      <span aria-hidden>●</span> {children || 'This access is logged'}
    </p>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function FriendsModerationPage() {
  const { isAuthed, user } = useAdminAuth();
  const myId = user?.id ? String(user.id) : '';
  const [tab, setTab] = useState<Tab>('queue');
  // ?tab=<id>: links from the overview's Needs attention list and the global search open the right tab.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (['queue', 'appeals', 'sanctions', 'audit'] as readonly string[]).includes(t)) setTab(t as Tab);
  }, []);
  const [notice, setNotice] = useState<Notice>(null);
  const [liveToast, setLiveToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { mark, isFresh } = useFreshIds();

  const who = useCallback((id?: string | null) => (id && myId && id === myId ? 'You' : shortId(id)), [myId]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const flash = useCallback((text: string | null) => {
    if (!text) return;
    setLiveToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setLiveToast(null), 4000);
  }, []);

  // ── Queue ──
  const [statusF, setStatusF] = useState('');
  const [severityF, setSeverityF] = useState('');
  const [subTabF, setSubTabF] = useState('');
  const [categoryF, setCategoryF] = useState('');
  const [assigneeF, setAssigneeF] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueCursor, setQueueCursor] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  const queueQuery = useCallback((cursor?: string | null) => qs({
    status: statusF || undefined,
    severity: severityF || undefined,
    subTab: subTabF || undefined,
    category: categoryF || undefined,
    assignee: assigneeF || undefined,
    q: search || undefined,
    cursor: cursor || undefined,
  }), [statusF, severityF, subTabF, categoryF, assigneeF, search]);

  const loadQueue = useCallback(async (append = false, cursor: string | null = null) => {
    setQueueLoading(true);
    try {
      const data = await adminRequest<Paged<QueueItem>>(`/api/campus/mod/queue${queueQuery(append ? cursor : null)}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setQueue((prev) => {
        if (!append) return items;
        // Pages are grouped per page, so the same target can appear on two pages: merge them.
        const map = new Map(prev.map((q) => [`${q.targetType}:${q.targetId}`, q]));
        for (const it of items) {
          const key = `${it.targetType}:${it.targetId}`;
          const old = map.get(key);
          map.set(key, old ? { ...old, reportIds: [...new Set([...old.reportIds, ...it.reportIds])], categories: [...new Set([...old.categories, ...it.categories])] } : it);
        }
        return [...map.values()];
      });
      setQueueCursor(data?.nextCursor || null);
      setQueueError(null);
    } catch (e) {
      setQueueError(errText(e, 'Could not load the moderation queue.'));
    } finally {
      setQueueLoading(false);
    }
  }, [queueQuery]);

  useEffect(() => {
    if (isAuthed) loadQueue(false);
  }, [isAuthed, loadQueue]);

  // ── Detail drawer ──
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>('dismiss');
  const [note, setNote] = useState('');
  const [notifyReporter, setNotifyReporter] = useState(true);
  const [sanctionScope, setSanctionScope] = useState<string>('friends');
  const [sanctionDays, setSanctionDays] = useState('7');
  const [sanctionPermanent, setSanctionPermanent] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [revealed, setRevealed] = useState<{ userId: string; name: string | null } | null>(null);

  const loadDetail = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setDetailLoading(true);
    try {
      const data = await adminRequest<ReportDetail>(`/api/campus/mod/reports/${encodeURIComponent(id)}`);
      setDetail(data);
      setDetailError(null);
    } catch (e) {
      setDetailError(errText(e, 'Could not load this report.'));
    } finally {
      if (!quiet) setDetailLoading(false);
    }
  }, []);

  const openReport = useCallback((id: string) => {
    setOpenId(id);
    setDetail(null);
    setDetailError(null);
    setDecision('dismiss');
    setNote('');
    setNotifyReporter(true);
    setSanctionScope('friends');
    setSanctionDays('7');
    setSanctionPermanent(false);
    setRevealOpen(false);
    setRevealReason('');
    setRevealed(null);
    loadDetail(id);
  }, [loadDetail]);

  const closeDrawer = useCallback(() => {
    setOpenId(null);
    setDetail(null);
    setRevealed(null);
    setRevealReason('');
  }, []);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, closeDrawer]);

  const assignToMe = async () => {
    if (!openId) return;
    setBusy('assign');
    try {
      await adminRequest(`/api/campus/mod/reports/${encodeURIComponent(openId)}/assign`, { method: 'POST', body: JSON.stringify({ userId: 'me' }) });
      setNotice({ kind: 'ok', text: 'Assigned to you.' });
      await Promise.all([loadDetail(openId, true), loadQueue(false)]);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not assign this report.') });
    } finally {
      setBusy(null);
    }
  };

  const resolve = async () => {
    if (!openId || !detail) return;
    const body: Record<string, unknown> = { decision, note: note.trim() || undefined, notifyReporter };
    if (decision === 'sanction') {
      const days = Number(sanctionDays);
      if (!sanctionPermanent && (!Number.isInteger(days) || days < 1 || days > 365)) {
        setNotice({ kind: 'error', text: 'Sanction length must be 1-365 days, or permanent.' });
        return;
      }
      body.sanction = sanctionPermanent ? { scope: sanctionScope, permanent: true } : { scope: sanctionScope, days };
    }
    const n = detail.reports.filter((r) => ['open', 'in_review', 'escalated'].includes(r.status)).length;
    const confirmText: Record<Decision, string> = {
      dismiss: `Dismiss ${n} open report(s) on this ${words(detail.report.targetType)}?`,
      remove: `Remove this ${words(detail.report.targetType)} and close ${n} open report(s)?`,
      hide: `Hide this ${words(detail.report.targetType)} and close ${n} open report(s)?`,
      warn: 'Send a warning to the author and close the open reports?',
      sanction: sanctionPermanent
        ? `Permanently restrict the author from ${sanctionScope}?`
        : `Restrict the author from ${sanctionScope} for ${sanctionDays} day(s)?`,
      escalate: 'Escalate this target? Open reports move to Escalated.',
    };
    if (!window.confirm(confirmText[decision])) return;
    setBusy('resolve');
    try {
      const res = await adminRequest<{ reportsClosed?: number }>(`/api/campus/mod/reports/${encodeURIComponent(openId)}/resolve`, { method: 'POST', body: JSON.stringify(body) });
      setNotice({ kind: 'ok', text: decision === 'escalate' ? 'Escalated.' : `Done: ${words(decision)} (${res?.reportsClosed ?? 0} report(s) closed).` });
      await Promise.all([loadDetail(openId, true), loadQueue(false)]);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not resolve this report.') });
    } finally {
      setBusy(null);
    }
  };

  const reveal = async () => {
    if (!detail) return;
    const reason = revealReason.trim();
    if (reason.length < 20) {
      setNotice({ kind: 'error', text: 'Write a reason of at least 20 characters.' });
      return;
    }
    setBusy('reveal');
    try {
      const res = await adminRequest<{ userId: string; name: string | null }>('/api/campus/mod/reveal-author', {
        method: 'POST',
        body: JSON.stringify({ targetType: detail.report.targetType, targetId: detail.report.targetId, reason }),
      });
      setRevealed({ userId: res.userId, name: res.name ?? null });
      setRevealOpen(false);
      if (openId) loadDetail(openId, true);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not reveal the author.') });
    } finally {
      setBusy(null);
    }
  };

  // ── Appeals ──
  const [appealStatus, setAppealStatus] = useState('open');
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [appealCursor, setAppealCursor] = useState<string | null>(null);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [appealsError, setAppealsError] = useState<string | null>(null);
  const [appealNotes, setAppealNotes] = useState<Record<string, string>>({});

  const loadAppeals = useCallback(async (append = false, cursor: string | null = null) => {
    setAppealsLoading(true);
    try {
      const data = await adminRequest<Paged<Appeal>>(`/api/campus/mod/appeals${qs({ status: appealStatus, cursor: append ? cursor : null })}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setAppeals((prev) => (append ? [...prev, ...items.filter((a) => !prev.some((p) => p.id === a.id))] : items));
      setAppealCursor(data?.nextCursor || null);
      setAppealsError(null);
    } catch (e) {
      setAppealsError(errText(e, 'Could not load appeals.'));
    } finally {
      setAppealsLoading(false);
    }
  }, [appealStatus]);

  useEffect(() => {
    if (isAuthed && tab === 'appeals') loadAppeals(false);
  }, [isAuthed, tab, loadAppeals]);

  const decideAppeal = async (a: Appeal, decisionValue: 'upheld' | 'reversed') => {
    const msg = decisionValue === 'reversed'
      ? 'Reverse this decision? Sanctions are lifted and removed or hidden content is restored where possible.'
      : 'Uphold the original decision?';
    if (!window.confirm(msg)) return;
    setBusy(`appeal:${a.id}`);
    try {
      const res = await adminRequest<{ effects?: string[] }>(`/api/campus/mod/appeals/${encodeURIComponent(a.id)}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision: decisionValue, note: (appealNotes[a.id] || '').trim() || undefined }),
      });
      const effects = res?.effects?.length ? ` (${res.effects.map(words).join(', ')})` : '';
      setNotice({ kind: 'ok', text: `Appeal ${decisionValue}${effects}.` });
      await loadAppeals(false);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not decide this appeal.') });
    } finally {
      setBusy(null);
    }
  };

  // ── Sanctions ──
  const [sanctionActive, setSanctionActive] = useState(true);
  const [sanctionUser, setSanctionUser] = useState('');
  const [sanctions, setSanctions] = useState<Sanction[]>([]);
  const [sanctionCursor, setSanctionCursor] = useState<string | null>(null);
  const [sanctionsLoading, setSanctionsLoading] = useState(false);
  const [sanctionsError, setSanctionsError] = useState<string | null>(null);

  const loadSanctions = useCallback(async (append = false, cursor: string | null = null) => {
    setSanctionsLoading(true);
    try {
      const data = await adminRequest<Paged<Sanction>>(`/api/campus/mod/sanctions${qs({
        active: sanctionActive ? 'true' : undefined,
        userId: sanctionUser.trim() || undefined,
        cursor: append ? cursor : null,
      })}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setSanctions((prev) => (append ? [...prev, ...items.filter((s) => !prev.some((p) => p.id === s.id))] : items));
      setSanctionCursor(data?.nextCursor || null);
      setSanctionsError(null);
    } catch (e) {
      setSanctionsError(errText(e, 'Could not load sanctions.'));
    } finally {
      setSanctionsLoading(false);
    }
  }, [sanctionActive, sanctionUser]);

  useEffect(() => {
    if (isAuthed && tab === 'sanctions') loadSanctions(false);
    // userId filter is applied with the Apply button, not on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, tab, sanctionActive]);

  const liftSanction = async (s: Sanction) => {
    const reason = window.prompt('Reason for lifting this sanction (logged):', '');
    if (reason === null) return;
    setBusy(`lift:${s.id}`);
    try {
      await adminRequest(`/api/campus/mod/sanctions/${encodeURIComponent(s.id)}/lift`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() || undefined }) });
      setNotice({ kind: 'ok', text: 'Sanction lifted.' });
      await loadSanctions(false);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not lift this sanction.') });
    } finally {
      setBusy(null);
    }
  };

  // ── Audit ──
  const [auditAction, setAuditAction] = useState('');
  const [auditActor, setAuditActor] = useState('');
  const [auditTarget, setAuditTarget] = useState('');
  const [auditSubject, setAuditSubject] = useState('');
  const [audit, setAudit] = useState<ModAction[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadAudit = useCallback(async (append = false, cursor: string | null = null) => {
    setAuditLoading(true);
    try {
      const data = await adminRequest<Paged<ModAction>>(`/api/campus/mod/actions${qs({
        action: auditAction || undefined,
        actorId: auditActor.trim() || undefined,
        targetId: auditTarget.trim() || undefined,
        subjectUserId: auditSubject.trim() || undefined,
        cursor: append ? cursor : null,
      })}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setAudit((prev) => (append ? [...prev, ...items.filter((a) => !prev.some((p) => p.id === a.id))] : items));
      setAuditCursor(data?.nextCursor || null);
      setAuditError(null);
    } catch (e) {
      setAuditError(errText(e, 'Could not load the moderation log.'));
    } finally {
      setAuditLoading(false);
    }
  }, [auditAction, auditActor, auditTarget, auditSubject]);

  useEffect(() => {
    if (isAuthed && tab === 'audit') loadAudit(false);
    // id filters are applied with the Apply button
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, tab, auditAction]);

  // ── Live updates ──
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const detailRef = useRef(detail);
  detailRef.current = detail;

  useLiveSync(['friends_report', 'friends_appeal'], (events: LiveEvent[], meta) => {
    const reports = events.filter((e) => e.type === 'friends_report');
    const appealEvents = events.filter((e) => e.type === 'friends_appeal');
    if (meta.reconnect || reports.length) {
      loadQueue(false);
      mark(reports.filter((e) => e.action === 'created').map((e) => e.id));
      flash(liveLabel(reports, 'report'));
      const open = openIdRef.current;
      const siblings = detailRef.current ? detailRef.current.reports.map((r) => r.id) : [];
      if (open && (meta.reconnect || reports.some((e) => e.id !== null && (String(e.id) === open || siblings.includes(String(e.id)))))) {
        loadDetail(open, true);
      }
      if (tabRef.current === 'audit') loadAudit(false);
    }
    if (meta.reconnect || appealEvents.length) {
      if (tabRef.current === 'appeals') loadAppeals(false);
      flash(liveLabel(appealEvents, 'appeal'));
    }
  }, { enabled: isAuthed });

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  const d = detail;
  const canRemove = !!d && d.moderation.statuses.includes('removed');
  const canHide = !!d && d.moderation.statuses.includes('hidden');
  const hasSubject = !!d && !!d.authorHistory;
  const isOpen = !!d && ['open', 'in_review', 'escalated'].includes(d.report.status);
  const decisionDisabled: Record<Decision, string | null> = {
    dismiss: null,
    remove: canRemove ? null : 'This kind of content cannot be removed from here.',
    hide: canHide ? null : 'This kind of content cannot be hidden from here.',
    warn: hasSubject ? null : 'There is no account to warn.',
    sanction: hasSubject ? null : 'There is no account to restrict.',
    escalate: d && d.report.status === 'escalated' ? 'Already escalated.' : null,
  };

  const filtersActive = !!(statusF || severityF || subTabF || categoryF || assigneeF || search);

  return (
    <div className="space-y-8 animate-fade-in relative">
      <div className="flex flex-wrap gap-4 items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Reports and moderation</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            Reports from Pulse, Forum, Tasks, Connect, Spaces and chats · live
          </p>
        </div>
        <div className="flex gap-2" role="tablist">
          {(['queue', 'appeals', 'sanctions', 'audit'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`${btn} border ${tab === t ? 'bg-info-soft border-info/30 text-info-text' : 'border-line bg-surface-2/60 text-fg-muted hover:text-fg'}`}
            >
              {t === 'audit' ? 'Audit log' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div role="status" className={`rounded-lg border px-4 py-3 text-xs font-semibold flex items-center justify-between gap-4 ${notice.kind === 'ok' ? 'border-success/30 bg-success-soft text-success-text' : 'border-danger/30 bg-danger-soft text-danger-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}
      {liveToast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-info/30 bg-surface px-4 py-3 text-xs font-semibold text-info-text" role="status" aria-live="polite">
          {liveToast}
        </div>
      )}

      {/* ── Queue ── */}
      {tab === 'queue' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface shadow-xs p-4 flex flex-wrap gap-3 items-end">
            <div>
              <span className={label}>Status</span>
              <select className={select} value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="Status">
                <option value="">Needs action</option>
                <option value="all">All</option>
                {REPORT_STATUSES.map((s) => <option key={s} value={s}>{words(s)}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>Severity</span>
              <select className={select} value={severityF} onChange={(e) => setSeverityF(e.target.value)} aria-label="Severity">
                <option value="">Any</option>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>Sub-tab</span>
              <select className={select} value={subTabF} onChange={(e) => setSubTabF(e.target.value)} aria-label="Sub-tab">
                <option value="">Any</option>
                {SUB_TABS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>Category</span>
              <select className={select} value={categoryF} onChange={(e) => setCategoryF(e.target.value)} aria-label="Category">
                <option value="">Any</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>Assignee</span>
              <select className={select} value={assigneeF} onChange={(e) => setAssigneeF(e.target.value)} aria-label="Assignee">
                <option value="">Anyone</option>
                <option value="me">Me</option>
                <option value="none">Unassigned</option>
              </select>
            </div>
            <form
              className="flex gap-2 items-end flex-1 min-w-[220px]"
              onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); }}
            >
              <div className="flex-1">
                <span className={label}>Search notes and content</span>
                <input className={input} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Words from the report or the content" maxLength={80} />
              </div>
              <button type="submit" className={btnGhost}>Search</button>
            </form>
            {filtersActive && (
              <button
                onClick={() => { setStatusF(''); setSeverityF(''); setSubTabF(''); setCategoryF(''); setAssigneeF(''); setSearch(''); setSearchInput(''); }}
                className={btnGhost}
              >
                Clear
              </button>
            )}
            <button onClick={() => loadQueue(false)} disabled={queueLoading} className={`${btn} bg-info-soft text-info-text border border-info/30`}>↻ Refresh</button>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="zv-table">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60">
                    {['Severity', 'Target', 'Content', 'Reasons', 'Reporters', 'Status', 'Assignee', 'SLA', 'Last report'].map((h) => <th key={h} className={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {queueLoading && !queue.length ? (
                    <tr><td colSpan={9} className="px-6 py-12 text-center text-xs text-fg-muted animate-pulse">Loading the queue…</td></tr>
                  ) : queueError && !queue.length ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center">
                        <p className="text-xs text-danger-text font-semibold">{queueError}</p>
                        <button onClick={() => loadQueue(false)} className={`mt-3 ${btnGhost}`}>Try again</button>
                      </td>
                    </tr>
                  ) : !queue.length ? (
                    <tr><td colSpan={9} className="px-6 py-12 text-center text-xs text-fg-muted">{filtersActive ? 'No reports match these filters.' : 'Nothing to review. New reports appear here live.'}</td></tr>
                  ) : (
                    queue.map((q) => {
                      const fresh = q.reportIds.some((id) => isFresh(id));
                      const selected = openId && q.reportIds.includes(openId);
                      return (
                        <tr
                          key={`${q.targetType}:${q.targetId}`}
                          onClick={() => openReport(q.latestReportId)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openReport(q.latestReportId); } }}
                          tabIndex={0}
                          className={`cursor-pointer align-top hover:bg-surface-2/60 transition-colors outline-none focus:bg-surface-2/60 ${fresh ? FRESH_ROW_CLASS : ''} ${selected ? 'bg-info-soft' : ''}`}
                        >
                          <td className="px-4 py-3"><Badge value={q.severity} tones={SEVERITY_TONE} /></td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-semibold text-fg">{words(q.targetType)}</p>
                            <p className="text-xs text-fg-muted">{q.subTab}</p>
                          </td>
                          <td className="px-4 py-3 max-w-sm">
                            {q.snapshot?.anonymous && <span className="text-xs font-semibold text-accent-text mr-2">Anon{q.snapshot.alias ? ` · ${q.snapshot.alias}` : ''}</span>}
                            <span className="text-xs text-fg-muted break-words line-clamp-2">{q.snapshot?.excerpt || <em className="text-fg-subtle">No text</em>}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-fg-muted">{q.categories.map(words).join(', ')}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-fg">{q.reporterCount}</td>
                          <td className="px-4 py-3"><Badge value={q.status} tones={STATUS_TONE} /></td>
                          <td className="px-4 py-3 text-xs font-mono text-fg-muted">{q.assignedTo ? who(q.assignedTo) : '—'}</td>
                          <td className={`px-4 py-3 text-xs font-semibold whitespace-nowrap ${q.overdue ? 'text-danger-text' : 'text-fg-muted'}`}>{relDue(q.slaDueAt)}</td>
                          <td className="px-4 py-3 text-xs text-fg-muted whitespace-nowrap">{fmt(q.lastReportedAt)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {queueError && queue.length > 0 && <p className="px-6 py-3 text-xs text-danger-text border-t border-line">{queueError}</p>}
            {queueCursor && (
              <div className="border-t border-line px-6 py-4 text-center">
                <button disabled={queueLoading} onClick={() => loadQueue(true, queueCursor)} className={btnGhost}>{queueLoading ? 'Loading…' : 'Load older reports'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Appeals ── */}
      {tab === 'appeals' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface shadow-xs p-4 flex flex-wrap gap-3 items-end">
            <div>
              <span className={label}>Status</span>
              <select className={select} value={appealStatus} onChange={(e) => setAppealStatus(e.target.value)} aria-label="Appeal status">
                <option value="open">Open</option>
                <option value="upheld">Upheld</option>
                <option value="reversed">Reversed</option>
                <option value="open,upheld,reversed">All</option>
              </select>
            </div>
            <button onClick={() => loadAppeals(false)} disabled={appealsLoading} className={`${btn} bg-info-soft text-info-text border border-info/30`}>↻ Refresh</button>
          </div>
          {appealsLoading && !appeals.length ? (
            <p className="text-xs text-fg-muted animate-pulse text-center py-12">Loading appeals…</p>
          ) : appealsError && !appeals.length ? (
            <div className="text-center py-12">
              <p className="text-xs text-danger-text font-semibold">{appealsError}</p>
              <button onClick={() => loadAppeals(false)} className={`mt-3 ${btnGhost}`}>Try again</button>
            </div>
          ) : !appeals.length ? (
            <p className="text-xs text-fg-muted text-center py-12">No appeals here.</p>
          ) : (
            <div className="grid gap-4">
              {appeals.map((a) => (
                <div key={a.id} className="rounded-lg border border-line bg-surface shadow-xs p-5 space-y-3">
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="flex items-center gap-3">
                      <Badge value={a.status} tones={STATUS_TONE} />
                      <span className="text-xs text-fg-muted">Filed {fmt(a.createdAt)} by user <span className="font-mono" title={a.userId}>{shortId(a.userId)}</span></span>
                    </div>
                    {a.action && (
                      <span className="text-xs text-fg-muted">
                        Appealing <b className="text-fg">{words(a.action.action)}</b>
                        {a.action.targetType ? <> on {words(a.action.targetType)} <span className="font-mono" title={a.action.targetId || ''}>{shortId(a.action.targetId)}</span></> : null}
                        {' · '}{fmt(a.action.createdAt)}
                      </span>
                    )}
                  </div>
                  {a.action?.reason && <p className="text-xs text-fg-muted"><span className="font-semibold text-fg-muted text-xs mr-2">Moderator note</span>{a.action.reason}</p>}
                  {a.action?.meta && typeof a.action.meta.scope === 'string' && (
                    <p className="text-xs text-fg-muted">
                      <span className="font-semibold text-fg-muted text-xs mr-2">Sanction</span>
                      {String(a.action.meta.scope)} {a.action.meta.until ? `until ${fmt(String(a.action.meta.until))}` : '(permanent)'}
                    </p>
                  )}
                  <p className="text-sm text-fg whitespace-pre-wrap break-words border-l-2 border-line pl-3">{a.text}</p>
                  {a.status === 'open' ? (
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="flex-1 min-w-[240px]">
                        <span className={label}>Note to the student (optional)</span>
                        <input className={input} maxLength={500} value={appealNotes[a.id] || ''} onChange={(e) => setAppealNotes((p) => ({ ...p, [a.id]: e.target.value }))} />
                      </div>
                      <button disabled={busy === `appeal:${a.id}`} onClick={() => decideAppeal(a, 'upheld')} className={btnGhost}>Uphold</button>
                      <button disabled={busy === `appeal:${a.id}`} onClick={() => decideAppeal(a, 'reversed')} className={`${btn} bg-success-soft text-success-text border border-success/30`}>Reverse</button>
                    </div>
                  ) : (
                    <p className="text-xs text-fg-muted">Decided {fmt(a.reviewedAt)} by {who(a.reviewedBy)}{a.note ? ` · ${a.note}` : ''}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {appealCursor && (
            <div className="text-center">
              <button disabled={appealsLoading} onClick={() => loadAppeals(true, appealCursor)} className={btnGhost}>{appealsLoading ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </div>
      )}

      {/* ── Sanctions ── */}
      {tab === 'sanctions' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface shadow-xs p-4 flex flex-wrap gap-3 items-end">
            <label className="flex items-center gap-2 text-xs text-fg-muted font-semibold">
              <input type="checkbox" checked={sanctionActive} onChange={(e) => setSanctionActive(e.target.checked)} /> Active only
            </label>
            <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); loadSanctions(false); }}>
              <div>
                <span className={label}>User id</span>
                <input className={`${input} w-80`} value={sanctionUser} onChange={(e) => setSanctionUser(e.target.value)} placeholder="Optional" />
              </div>
              <button type="submit" className={btnGhost}>Apply</button>
            </form>
            <button onClick={() => loadSanctions(false)} disabled={sanctionsLoading} className={`${btn} bg-info-soft text-info-text border border-info/30`}>↻ Refresh</button>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="zv-table">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60">
                    {['User', 'Scope', 'Until', 'Reason', 'By', 'Created', ''].map((h) => <th key={h} className={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {sanctionsLoading && !sanctions.length ? (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-xs text-fg-muted animate-pulse">Loading sanctions…</td></tr>
                  ) : sanctionsError && !sanctions.length ? (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-xs text-danger-text font-semibold">{sanctionsError}</td></tr>
                  ) : !sanctions.length ? (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-xs text-fg-muted">No sanctions.</td></tr>
                  ) : sanctions.map((s) => (
                    <tr key={s.id} className="align-top">
                      <td className="px-4 py-3 text-xs font-mono text-fg-muted" title={s.userId}>{shortId(s.userId)}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-fg">{s.scope}</td>
                      <td className="px-4 py-3 text-xs text-fg-muted whitespace-nowrap">
                        {s.liftedAt ? <span className="text-fg-muted">Lifted {fmt(s.liftedAt)}</span> : s.until ? fmt(s.until) : 'Permanent'}
                        {!s.active && !s.liftedAt && <span className="ml-2 text-xs text-fg-muted">expired</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted max-w-sm break-words">{s.reason || '—'}</td>
                      <td className="px-4 py-3 text-xs font-mono text-fg-muted">{who(s.createdBy)}</td>
                      <td className="px-4 py-3 text-xs text-fg-muted whitespace-nowrap">{fmt(s.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {s.active && <button disabled={busy === `lift:${s.id}`} onClick={() => liftSanction(s)} className={btnGhost}>Lift</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sanctionCursor && (
              <div className="border-t border-line px-6 py-4 text-center">
                <button disabled={sanctionsLoading} onClick={() => loadSanctions(true, sanctionCursor)} className={btnGhost}>Load more</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface shadow-xs p-4 flex flex-wrap gap-3 items-end">
            <div>
              <span className={label}>Action</span>
              <select className={select} value={auditAction} onChange={(e) => setAuditAction(e.target.value)} aria-label="Action">
                <option value="">Any</option>
                {MOD_ACTIONS.map((a) => <option key={a} value={a}>{words(a)}</option>)}
              </select>
            </div>
            <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); loadAudit(false); }}>
              <div>
                <span className={label}>Moderator id</span>
                <input className={`${input} w-56`} value={auditActor} onChange={(e) => setAuditActor(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <span className={label}>Target id</span>
                <input className={`${input} w-56`} value={auditTarget} onChange={(e) => setAuditTarget(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <span className={label}>Affected user id</span>
                <input className={`${input} w-56`} value={auditSubject} onChange={(e) => setAuditSubject(e.target.value)} placeholder="Optional" />
              </div>
              <button type="submit" className={btnGhost}>Apply</button>
            </form>
            <button onClick={() => loadAudit(false)} disabled={auditLoading} className={`${btn} bg-info-soft text-info-text border border-info/30`}>↻ Refresh</button>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="zv-table">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60">
                    {['Time', 'Action', 'By', 'Target', 'Affected user', 'Reason / details'].map((h) => <th key={h} className={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {auditLoading && !audit.length ? (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-xs text-fg-muted animate-pulse">Loading the log…</td></tr>
                  ) : auditError && !audit.length ? (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-xs text-danger-text font-semibold">{auditError}</td></tr>
                  ) : !audit.length ? (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-xs text-fg-muted">No moderation actions recorded.</td></tr>
                  ) : audit.map((a) => <ActionRow key={a.id} a={a} who={who} />)}
                </tbody>
              </table>
            </div>
            {auditCursor && (
              <div className="border-t border-line px-6 py-4 text-center">
                <button disabled={auditLoading} onClick={() => loadAudit(true, auditCursor)} className={btnGhost}>Load older</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detail drawer ── */}
      {openId && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Report details">
          <button className="absolute inset-0 bg-surface-2" aria-label="Close" onClick={closeDrawer} />
          <div className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-surface p-8 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-fg-muted">Report</p>
                <h2 className="text-xl font-semibold text-fg">
                  {d ? `${words(d.report.targetType)} · ${d.report.subTab}` : 'Loading…'}
                </h2>
                {d && <p className="text-xs font-mono text-fg-muted mt-1" title={d.report.targetId}>Target {d.report.targetId}</p>}
              </div>
              <button onClick={closeDrawer} className={btnGhost}>Close</button>
            </div>

            {detailLoading && !d ? (
              <p className="text-xs text-fg-muted animate-pulse">Loading report…</p>
            ) : detailError && !d ? (
              <div>
                <p className="text-xs text-danger-text font-semibold">{detailError}</p>
                <button onClick={() => loadDetail(openId)} className={`mt-3 ${btnGhost}`}>Try again</button>
              </div>
            ) : d ? (
              <>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge value={d.report.severity} tones={SEVERITY_TONE} />
                  <Badge value={d.report.status} tones={STATUS_TONE} />
                  <span className="text-xs text-fg-muted font-semibold">{d.reporterCount} open reporter(s)</span>
                  <span className={`text-xs font-semibold ${d.report.overdue ? 'text-danger-text' : 'text-fg-muted'}`}>SLA {relDue(d.report.slaDueAt)}</span>
                  <span className="text-xs text-fg-muted">Assigned: {d.report.assignedTo ? who(d.report.assignedTo) : 'nobody'}</span>
                </div>

                {/* Evidence snapshot */}
                <section className="rounded-lg border border-line bg-surface shadow-xs p-5 space-y-2">
                  <p className={label}>Evidence (snapshot at report time)</p>
                  {d.report.snapshot?.anonymous && (
                    <p className="text-xs font-semibold text-accent-text">Anonymous post{d.report.snapshot.alias ? ` · shown as "${d.report.snapshot.alias}"` : ''}</p>
                  )}
                  <p className="text-sm text-fg whitespace-pre-wrap break-words">{d.report.snapshot?.excerpt || <em className="text-fg-muted">No text</em>}</p>
                  {!!d.report.snapshot?.mediaIds?.length && (
                    <p className="text-xs text-fg-muted">Media: {d.report.snapshot.mediaIds.map((m) => <span key={m} className="font-mono mr-2" title={m}>{shortId(m)}</span>)}</p>
                  )}
                  <p className="text-xs text-fg-muted">Created {fmt(d.report.snapshot?.createdAt)} · first reported {fmt(d.report.snapshot?.reportedAt || d.report.createdAt)}</p>
                </section>

                {/* Current state */}
                <section className="rounded-lg border border-line bg-surface shadow-xs p-5 space-y-2">
                  <p className={label}>Current state</p>
                  {d.currentState ? (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                      {Object.entries(d.currentState).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-fg-muted font-semibold">{words(k)}</dt>
                          <dd className="text-fg break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : <p className="text-xs text-fg-muted">Not available for this target type.</p>}
                </section>

                {/* Author */}
                <section className="rounded-lg border border-line bg-surface shadow-xs p-5 space-y-3">
                  <p className={label}>Author</p>
                  {!d.authorHistory ? (
                    <p className="text-xs text-fg-muted">No account linked to this target.</p>
                  ) : d.authorHistory.anonymous ? (
                    <p className="text-xs text-fg-muted">
                      Anonymous author · {d.authorHistory.priorActionCount} prior action(s) · {d.authorHistory.sanctionCount} sanction(s) on record
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-fg">
                        <b>{d.authorHistory.name || 'Unknown'}</b> <span className="font-mono text-fg-muted" title={d.authorHistory.userId}>{shortId(d.authorHistory.userId)}</span>
                        {' · '}{d.authorHistory.priorActionCount} prior action(s)
                      </p>
                      {d.authorHistory.sanctions.length > 0 && (
                        <ul className="text-xs text-fg-muted space-y-0.5">
                          {d.authorHistory.sanctions.map((s) => (
                            <li key={s.id}>
                              {s.scope} · {s.until ? `until ${fmt(s.until)}` : 'permanent'}{s.liftedAt ? ` · lifted ${fmt(s.liftedAt)}` : ''}{s.reason ? ` · ${s.reason}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {d.moderation.canReveal && (
                    <div className="border-t border-line pt-3 space-y-2">
                      {revealed ? (
                        <div className="rounded-xl border border-warning/30 bg-warning-soft p-3">
                          <p className="text-xs text-warning-text">Author: <b>{revealed.name || 'Unknown'}</b> <span className="font-mono">{revealed.userId}</span></p>
                          <LoggedNote>This reveal was logged with your reason</LoggedNote>
                        </div>
                      ) : revealOpen ? (
                        <div className="space-y-2">
                          <span className={label}>Why do you need the real author? (at least 20 characters)</span>
                          <textarea className={`${input} min-h-[80px]`} maxLength={500} value={revealReason} onChange={(e) => setRevealReason(e.target.value)} />
                          <div className="flex items-center justify-between gap-2">
                            <LoggedNote />
                            <div className="flex gap-2">
                              <button onClick={() => { setRevealOpen(false); setRevealReason(''); }} className={btnGhost}>Cancel</button>
                              <button disabled={busy === 'reveal' || revealReason.trim().length < 20} onClick={reveal} className={`${btn} bg-warning-soft text-warning-text border border-warning/30`}>
                                {busy === 'reveal' ? 'Revealing…' : 'Reveal author'}
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-fg-muted">{revealReason.trim().length}/20 characters minimum</p>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <LoggedNote>Revealing an anonymous author is logged</LoggedNote>
                          <button onClick={() => setRevealOpen(true)} className={`${btn} border border-warning/30 text-warning-text bg-warning-soft`}>Reveal author…</button>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* Actions */}
                {isOpen ? (
                  <section className="rounded-lg border border-line bg-surface shadow-xs p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className={label}>Decision</p>
                      {d.report.assignedTo !== myId && (
                        <button disabled={busy === 'assign'} onClick={assignToMe} className={btnGhost}>{busy === 'assign' ? 'Assigning…' : 'Assign to me'}</button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
                      {(['dismiss', 'remove', 'hide', 'warn', 'sanction', 'escalate'] as Decision[]).map((k) => {
                        const why = decisionDisabled[k];
                        return (
                          <button
                            key={k}
                            role="radio"
                            aria-checked={decision === k}
                            disabled={!!why}
                            title={why || undefined}
                            onClick={() => setDecision(k)}
                            className={`${btn} border ${decision === k ? 'bg-info-soft border-info/30 text-info-text' : 'border-line bg-surface-2/60 text-fg-muted hover:text-fg'}`}
                          >
                            {k}
                          </button>
                        );
                      })}
                    </div>
                    {decision === 'sanction' && (
                      <div className="flex flex-wrap gap-3 items-end">
                        <div>
                          <span className={label}>Scope</span>
                          <select className={select} value={sanctionScope} onChange={(e) => setSanctionScope(e.target.value)} aria-label="Sanction scope">
                            {SANCTION_SCOPES.map((s) => <option key={s} value={s}>{s === 'friends' ? 'all of Friends' : s}</option>)}
                          </select>
                        </div>
                        <div>
                          <span className={label}>Days (1-365)</span>
                          <input type="number" min={1} max={365} disabled={sanctionPermanent} className={`${input} w-28`} value={sanctionDays} onChange={(e) => setSanctionDays(e.target.value)} />
                        </div>
                        <label className="flex items-center gap-2 text-xs text-fg-muted font-semibold pb-2">
                          <input type="checkbox" checked={sanctionPermanent} onChange={(e) => setSanctionPermanent(e.target.checked)} /> Permanent
                        </label>
                      </div>
                    )}
                    <div>
                      <span className={label}>Note (sent with the outcome; also the audit reason)</span>
                      <textarea className={`${input} min-h-[70px]`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-xs text-fg-muted font-semibold">
                        <input type="checkbox" checked={notifyReporter} onChange={(e) => setNotifyReporter(e.target.checked)} /> Tell reporters the outcome
                      </label>
                      <button
                        disabled={busy === 'resolve' || !!decisionDisabled[decision]}
                        onClick={resolve}
                        className={`${btn} ${['remove', 'sanction'].includes(decision) ? 'bg-danger-soft text-danger-text border border-danger/30' : 'bg-info-soft text-info-text border border-info/30'}`}
                      >
                        {busy === 'resolve' ? 'Saving…' : `Apply: ${decision}`}
                      </button>
                    </div>
                  </section>
                ) : (
                  <section className="rounded-lg border border-line bg-surface shadow-xs p-5">
                    <p className="text-xs text-fg-muted">
                      Closed: <b className="text-fg">{words(d.report.decision || d.report.status)}</b> by {who(d.report.resolvedBy)} · {fmt(d.report.resolvedAt)}
                      {d.report.resolution ? ` · ${d.report.resolution}` : ''}
                    </p>
                  </section>
                )}

                {/* All reports on the target */}
                <section className="space-y-2">
                  <p className={label}>Reports on this target ({d.reports.length})</p>
                  <div className="glass-card divide-y divide-white/[0.04]">
                    {d.reports.map((r) => (
                      <div key={r.id} className={`p-4 space-y-1 ${r.id === d.report.id ? 'bg-surface-2/60' : ''}`}>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-xs font-semibold text-fg">{words(r.category)}</span>
                          <Badge value={r.severity} tones={SEVERITY_TONE} />
                          <Badge value={r.status} tones={STATUS_TONE} />
                          <span className="text-xs text-fg-muted">{r.isSystem ? 'System (auto-flag)' : <>reporter <span className="font-mono" title={r.reporterId || ''}>{shortId(r.reporterId)}</span></>}</span>
                          <span className="text-xs text-fg-subtle ml-auto">{fmt(r.createdAt)}</span>
                        </div>
                        {r.note && <p className="text-xs text-fg-muted whitespace-pre-wrap break-words">{r.note}</p>}
                      </div>
                    ))}
                  </div>
                </section>

                {/* History */}
                <section className="space-y-2">
                  <p className={label}>Moderation history</p>
                  {d.actions.length ? (
                    <div className="glass-card overflow-x-auto">
                      <table className="zv-table">
                        <tbody className="divide-y divide-white/[0.03]">
                          {d.actions.map((a) => <ActionRow key={a.id} a={a} who={who} compact />)}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="text-xs text-fg-muted">No actions yet.</p>}
                </section>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

const ACTION_TONE = (action: string) => {
  if (/remove|sanction|reject|space_end|space_remove|reveal|view_/.test(action)) return 'text-danger-text bg-danger-soft border-danger/30';
  if (/restore|lift|approve|reversed|badge_grant/.test(action)) return 'text-success-text bg-success-soft border-success/30';
  if (/hide|warn|escalate/.test(action)) return 'text-warning-text bg-warning-soft border-warning/30';
  return 'text-info-text bg-info-soft border-info/30';
};

const metaText = (meta: Record<string, unknown>) => {
  const parts = Object.entries(meta || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 6)
    .map(([k, v]) => `${words(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  const s = parts.join(' · ');
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
};

function ActionRow({ a, who, compact = false }: { a: ModAction; who: (id?: string | null) => string; compact?: boolean }) {
  const details = [a.reason, metaText(a.meta)].filter(Boolean).join(' — ');
  return (
    <tr className="align-top">
      <td className="px-4 py-3 text-xs text-fg-muted whitespace-nowrap">{fmt(a.createdAt)}</td>
      <td className="px-4 py-3"><span className={`${pill} ${ACTION_TONE(a.action)}`}>{words(a.action)}</span></td>
      <td className="px-4 py-3 text-xs font-mono text-fg-muted whitespace-nowrap" title={a.actorId || ''}>{a.actorRole === 'system' ? 'system' : who(a.actorId)}</td>
      {!compact && (
        <td className="px-4 py-3 text-xs text-fg-muted whitespace-nowrap">
          {a.targetType ? words(a.targetType) : '—'} <span className="font-mono text-fg-muted" title={a.targetId || ''}>{a.targetId ? shortId(a.targetId) : ''}</span>
        </td>
      )}
      {!compact && <td className="px-4 py-3 text-xs font-mono text-fg-muted" title={a.subjectUserId || ''}>{shortId(a.subjectUserId)}</td>}
      <td className="px-4 py-3 text-xs text-fg-muted max-w-md break-words">{details || '—'}</td>
    </tr>
  );
}
