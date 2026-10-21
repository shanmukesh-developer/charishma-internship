"use client";
import {
  Badge as UiBadge, Button, Card, CardBody, Checkbox, DataTable, DescriptionList, Drawer, EmptyState, ErrorState, Field, Input, LoadingState,
  Notice as NoticeBox, PageHeader, SearchInput, SectionTitle, SegmentedControl, Select, Switch, Tabs, Textarea, Toolbar, useConfirm, usePrompt,
  type Column, IconRefresh, IconShield,
} from '@/components/ui';
import { formatDateTime, humanize, plural } from '@/lib/format';
import { ReadableValue, readableText } from '@/components/ui/Readable';
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
  return Number.isNaN(d.getTime()) ? '—' : formatDateTime(d, { short: true });
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

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
const SEVERITY_TONE: Record<string, BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'warning',
  low: 'neutral',
};
const STATUS_TONE: Record<string, BadgeTone> = {
  open: 'info',
  in_review: 'accent',
  escalated: 'danger',
  actioned: 'success',
  dismissed: 'neutral',
  upheld: 'neutral',
  reversed: 'success',
};

function Badge({ value, tones }: { value: string; tones: Record<string, BadgeTone> }) {
  return <UiBadge tone={tones[value] || 'neutral'}>{humanize(value)}</UiBadge>;
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function FriendsModerationPage() {
  const ask = usePrompt();
  const confirm = useConfirm();
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
    if (!(await confirm({ title: confirmText[decision] }))) return;
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
    if (!(await confirm({ title: msg }))) return;
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
    const reason = (await ask({ title: 'Reason for lifting this sanction (logged):', label: 'Reason', defaultValue: '' }));
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

  const resetFilters = () => { setStatusF(''); setSeverityF(''); setSubTabF(''); setCategoryF(''); setAssigneeF(''); setSearch(''); setSearchInput(''); };
  const loadMore = (loading: boolean, onClick: () => void, label: string) => (
    <div className="mt-3 flex justify-center">
      <Button size="sm" loading={loading} onClick={onClick}>{label}</Button>
    </div>
  );

  const queueColumns: Column<QueueItem>[] = [
    { key: 'severity', header: 'Severity', width: '96px', sortValue: q => SEVERITIES.indexOf(q.severity as typeof SEVERITIES[number]), cell: q => <Badge value={q.severity} tones={SEVERITY_TONE} /> },
    {
      key: 'target',
      header: 'Target',
      sortValue: q => q.targetType,
      cell: q => (
        <div>
          <p className="text-sm text-fg">{humanize(q.targetType)}</p>
          <p className="text-xs text-fg-muted">{humanize(q.subTab)}</p>
        </div>
      ),
    },
    {
      key: 'content',
      header: 'Content',
      cell: q => (
        <div className="max-w-[360px]">
          {q.snapshot?.anonymous && <UiBadge tone="accent" className="mb-1">Anonymous{q.snapshot.alias ? ` · ${q.snapshot.alias}` : ''}</UiBadge>}
          <p className="line-clamp-2 break-words text-sm text-fg-muted">{q.snapshot?.excerpt || <em className="text-fg-subtle">No text</em>}</p>
        </div>
      ),
    },
    { key: 'reasons', header: 'Reasons', hideBelow: 'xl', cell: q => <span className="text-xs text-fg-muted">{q.categories.map(humanize).join(', ')}</span> },
    { key: 'reporters', header: 'Reporters', align: 'right', sortValue: q => q.reporterCount, cell: q => <span className="font-medium tabular-nums">{q.reporterCount}</span> },
    { key: 'status', header: 'Status', sortValue: q => q.status, cell: q => <Badge value={q.status} tones={STATUS_TONE} /> },
    { key: 'assignee', header: 'Assignee', hideBelow: 'lg', cell: q => <span className="text-xs text-fg-muted">{q.assignedTo ? who(q.assignedTo) : 'Nobody'}</span> },
    { key: 'sla', header: 'Due', sortValue: q => (q.slaDueAt ? new Date(q.slaDueAt) : null), cell: q => <span className={`whitespace-nowrap text-xs ${q.overdue ? 'font-medium text-danger-text' : 'text-fg-muted'}`}>{relDue(q.slaDueAt)}</span> },
    { key: 'last', header: 'Last report', align: 'right', hideBelow: 'lg', sortValue: q => new Date(q.lastReportedAt), cell: q => <span className="whitespace-nowrap text-xs text-fg-muted">{fmt(q.lastReportedAt)}</span> },
  ];

  const sanctionColumns: Column<Sanction>[] = [
    { key: 'user', header: 'User', cell: s => <span className="font-mono text-xs text-fg-muted" title={s.userId}>{shortId(s.userId)}</span> },
    { key: 'scope', header: 'Scope', sortValue: s => s.scope, cell: s => <span className="text-fg">{s.scope === 'friends' ? 'All of Friends' : humanize(s.scope)}</span> },
    {
      key: 'until',
      header: 'Until',
      sortValue: s => (s.until ? new Date(s.until) : null),
      cell: s => (
        <span className="whitespace-nowrap text-xs text-fg-muted">
          {s.liftedAt ? `Lifted ${fmt(s.liftedAt)}` : s.until ? fmt(s.until) : 'Permanent'}
          {!s.active && !s.liftedAt && <UiBadge className="ml-2">Expired</UiBadge>}
        </span>
      ),
    },
    { key: 'reason', header: 'Reason', cell: s => <p className="max-w-[360px] break-words text-sm text-fg-muted">{s.reason || '–'}</p> },
    { key: 'by', header: 'By', hideBelow: 'lg', cell: s => <span className="text-xs text-fg-muted">{who(s.createdBy)}</span> },
    { key: 'created', header: 'Created', hideBelow: 'lg', sortValue: s => new Date(s.createdAt), cell: s => <span className="whitespace-nowrap text-xs text-fg-muted">{fmt(s.createdAt)}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: s => (s.active ? <Button size="sm" variant="ghost" loading={busy === `lift:${s.id}`} onClick={() => liftSanction(s)}>Lift</Button> : null) },
  ];

  const auditColumns = actionColumns(who, false);

  return (
    <div className="text-fg">
      <PageHeader
        title="Reports and moderation"
        description="Reports from Pulse, Forum, Tasks, Connect, Spaces and chats. New reports appear live. Click a report to review the evidence and decide."
        actions={(
          <Button
            leftIcon={<IconRefresh size={14} />}
            loading={tab === 'queue' ? queueLoading : tab === 'appeals' ? appealsLoading : tab === 'sanctions' ? sanctionsLoading : auditLoading}
            onClick={() => (tab === 'queue' ? loadQueue(false) : tab === 'appeals' ? loadAppeals(false) : tab === 'sanctions' ? loadSanctions(false) : loadAudit(false))}
          >
            Refresh
          </Button>
        )}
      />

      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'queue', label: 'Queue', count: tab === 'queue' && !queueLoading ? queue.length : null },
          { id: 'appeals', label: 'Appeals' },
          { id: 'sanctions', label: 'Sanctions' },
          { id: 'audit', label: 'Moderation log' },
        ]}
      />

      {notice && <NoticeBox tone={notice.kind === 'ok' ? 'success' : 'danger'} className="mb-3" onClose={() => setNotice(null)}>{notice.text}</NoticeBox>}
      {liveToast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-line bg-surface px-4 py-3 text-sm text-fg shadow-pop" role="status" aria-live="polite">
          {liveToast}
        </div>
      )}

      {tab === 'queue' && (
        <>
          <Toolbar end={filtersActive ? <Button size="sm" variant="ghost" onClick={resetFilters}>Clear filters</Button> : undefined}>
            <form className="flex min-w-[240px] flex-1 gap-2 sm:max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); }}>
              <SearchInput value={searchInput} onChange={setSearchInput} onEnter={() => setSearch(searchInput.trim())} placeholder="Words from the report or the content" className="flex-1" ariaLabel="Search notes and content" />
            </form>
            <Select className="w-auto" value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="Status">
              <option value="">Needs action</option>
              <option value="all">All statuses</option>
              {REPORT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
            <Select className="w-auto" value={severityF} onChange={(e) => setSeverityF(e.target.value)} aria-label="Severity">
              <option value="">Any severity</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
            <Select className="w-auto" value={subTabF} onChange={(e) => setSubTabF(e.target.value)} aria-label="Where">
              <option value="">Anywhere</option>
              {SUB_TABS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
            <Select className="w-auto" value={categoryF} onChange={(e) => setCategoryF(e.target.value)} aria-label="Reason">
              <option value="">Any reason</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
            </Select>
            <Select className="w-auto" value={assigneeF} onChange={(e) => setAssigneeF(e.target.value)} aria-label="Assignee">
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="none">Unassigned</option>
            </Select>
          </Toolbar>

          {queueError && queue.length > 0 && <NoticeBox tone="danger" className="mb-3">{queueError}</NoticeBox>}
          <DataTable
            caption="Moderation queue"
            columns={queueColumns}
            rows={queue}
            rowKey={q => `${q.targetType}:${q.targetId}`}
            loading={queueLoading && !queue.length}
            error={!queue.length ? queueError || null : null}
            onRetry={() => loadQueue(false)}
            onRowClick={q => openReport(q.latestReportId)}
            rowClassName={q => [q.reportIds.some(id => isFresh(id)) ? FRESH_ROW_CLASS : '', openId && q.reportIds.includes(openId) ? 'bg-accent-soft/40' : ''].join(' ')}
            pageSize={0}
            noun="reports"
            empty={{ title: filtersActive ? 'No reports match these filters' : 'Nothing to review', description: filtersActive ? undefined : 'New reports appear here live.' }}
          />
          {queueCursor && loadMore(queueLoading, () => loadQueue(true, queueCursor), 'Load older reports')}
        </>
      )}

      {tab === 'appeals' && (
        <>
          <Toolbar>
            <SegmentedControl
              ariaLabel="Appeal status"
              value={appealStatus}
              onChange={setAppealStatus}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'upheld', label: 'Upheld' },
                { value: 'reversed', label: 'Reversed' },
                { value: 'open,upheld,reversed', label: 'All' },
              ]}
            />
          </Toolbar>
          {appealsLoading && !appeals.length ? (
            <LoadingState label="Loading appeals…" />
          ) : appealsError && !appeals.length ? (
            <ErrorState message={appealsError} onRetry={() => loadAppeals(false)} />
          ) : !appeals.length ? (
            <Card><EmptyState title="No appeals here" /></Card>
          ) : (
            <div className="space-y-3">
              {appeals.map((a) => (
                <Card key={a.id}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge value={a.status} tones={STATUS_TONE} />
                        <span className="text-xs text-fg-muted">Filed {fmt(a.createdAt)} by user <span className="font-mono" title={a.userId}>{shortId(a.userId)}</span></span>
                      </div>
                      {a.action && (
                        <span className="text-xs text-fg-muted">
                          Appealing <span className="font-medium text-fg">{humanize(a.action.action)}</span>
                          {a.action.targetType ? <> on {humanize(a.action.targetType)} <span className="font-mono" title={a.action.targetId || ''}>{shortId(a.action.targetId)}</span></> : null}
                          {' · '}{fmt(a.action.createdAt)}
                        </span>
                      )}
                    </div>
                    {a.action?.reason && <p className="text-sm text-fg-muted"><span className="mr-2 text-xs text-fg-subtle">Moderator note</span>{a.action.reason}</p>}
                    {a.action?.meta && typeof a.action.meta.scope === 'string' && (
                      <p className="text-sm text-fg-muted">
                        <span className="mr-2 text-xs text-fg-subtle">Sanction</span>
                        {String(a.action.meta.scope)} {a.action.meta.until ? `until ${fmt(String(a.action.meta.until))}` : '(permanent)'}
                      </p>
                    )}
                    <blockquote className="whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-sm text-fg">{a.text}</blockquote>
                    {a.status === 'open' ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="Note to the student" optional className="min-w-[240px] flex-1">
                          <Input maxLength={500} value={appealNotes[a.id] || ''} onChange={(e) => setAppealNotes((p) => ({ ...p, [a.id]: e.target.value }))} />
                        </Field>
                        <Button disabled={busy === `appeal:${a.id}`} onClick={() => decideAppeal(a, 'upheld')}>Uphold</Button>
                        <Button variant="primary" disabled={busy === `appeal:${a.id}`} onClick={() => decideAppeal(a, 'reversed')}>Reverse</Button>
                      </div>
                    ) : (
                      <p className="text-xs text-fg-muted">Decided {fmt(a.reviewedAt)} by {who(a.reviewedBy)}{a.note ? ` · ${a.note}` : ''}</p>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
          {appealCursor && loadMore(appealsLoading, () => loadAppeals(true, appealCursor), 'Load more')}
        </>
      )}

      {tab === 'sanctions' && (
        <>
          <Toolbar>
            <Switch size="sm" checked={sanctionActive} onChange={setSanctionActive} label="Active only" />
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); loadSanctions(false); }}>
              <Input className="w-72" value={sanctionUser} onChange={(e) => setSanctionUser(e.target.value)} placeholder="User ID (optional)" aria-label="User ID" />
              <Button type="submit">Apply</Button>
            </form>
          </Toolbar>
          <DataTable
            caption="Sanctions"
            columns={sanctionColumns}
            rows={sanctions}
            rowKey={s => s.id}
            loading={sanctionsLoading && !sanctions.length}
            error={!sanctions.length ? sanctionsError || null : null}
            onRetry={() => loadSanctions(false)}
            pageSize={0}
            noun="sanctions"
            empty={{ title: 'No sanctions' }}
          />
          {sanctionCursor && loadMore(sanctionsLoading, () => loadSanctions(true, sanctionCursor), 'Load more')}
        </>
      )}

      {tab === 'audit' && (
        <>
          <Toolbar>
            <Select className="w-auto" value={auditAction} onChange={(e) => setAuditAction(e.target.value)} aria-label="Action">
              <option value="">Any action</option>
              {MOD_ACTIONS.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
            </Select>
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); loadAudit(false); }}>
              <Input className="w-52" value={auditActor} onChange={(e) => setAuditActor(e.target.value)} placeholder="Moderator ID" aria-label="Moderator ID" />
              <Input className="w-52" value={auditTarget} onChange={(e) => setAuditTarget(e.target.value)} placeholder="Target ID" aria-label="Target ID" />
              <Input className="w-52" value={auditSubject} onChange={(e) => setAuditSubject(e.target.value)} placeholder="Affected user ID" aria-label="Affected user ID" />
              <Button type="submit">Apply</Button>
            </form>
          </Toolbar>
          <DataTable
            caption="Moderation log"
            columns={auditColumns}
            rows={audit}
            rowKey={a => a.id}
            loading={auditLoading && !audit.length}
            error={!audit.length ? auditError || null : null}
            onRetry={() => loadAudit(false)}
            pageSize={0}
            noun="actions"
            empty={{ title: 'No moderation actions recorded' }}
          />
          {auditCursor && loadMore(auditLoading, () => loadAudit(true, auditCursor), 'Load older')}
        </>
      )}

      <Drawer
        open={!!openId}
        onClose={closeDrawer}
        size="lg"
        title={d ? `${humanize(d.report.targetType)} in ${humanize(d.report.subTab)}` : 'Report'}
        description={d ? <span className="font-mono" title={d.report.targetId}>Target {d.report.targetId}</span> : undefined}
        headerActions={d ? <div className="flex gap-1.5"><Badge value={d.report.severity} tones={SEVERITY_TONE} /><Badge value={d.report.status} tones={STATUS_TONE} /></div> : undefined}
        footer={d && isOpen ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Switch size="sm" checked={notifyReporter} onChange={setNotifyReporter} label="Tell reporters the outcome" />
            <Button
              variant={['remove', 'sanction'].includes(decision) ? 'destructive' : 'primary'}
              disabled={!!decisionDisabled[decision]}
              loading={busy === 'resolve'}
              onClick={resolve}
            >
              Apply: {humanize(decision)}
            </Button>
          </div>
        ) : undefined}
      >
        {detailLoading && !d ? (
          <LoadingState label="Loading report…" />
        ) : detailError && !d ? (
          <ErrorState message={detailError} onRetry={() => openId && loadDetail(openId)} />
        ) : d ? (
          <div className="space-y-5">
            <DescriptionList
              columns={3}
              items={[
                { label: 'Open reporters', value: d.reporterCount },
                { label: 'Due', value: <span className={d.report.overdue ? 'text-danger-text' : ''}>{relDue(d.report.slaDueAt)}</span> },
                {
                  label: 'Assigned to',
                  value: (
                    <span className="inline-flex items-center gap-2">
                      {d.report.assignedTo ? who(d.report.assignedTo) : 'Nobody'}
                      {isOpen && d.report.assignedTo !== myId && <Button size="sm" variant="link" loading={busy === 'assign'} onClick={assignToMe}>Assign to me</Button>}
                    </span>
                  ),
                },
              ]}
            />

            <section>
              <SectionTitle title="Evidence" description="Snapshot taken when the content was reported." />
              <div className="space-y-2 rounded-lg border border-line p-3">
                {d.report.snapshot?.anonymous && (
                  <UiBadge tone="accent">Anonymous post{d.report.snapshot.alias ? ` · shown as “${d.report.snapshot.alias}”` : ''}</UiBadge>
                )}
                <p className="whitespace-pre-wrap break-words text-sm text-fg">{d.report.snapshot?.excerpt || <em className="text-fg-muted">No text</em>}</p>
                {!!d.report.snapshot?.mediaIds?.length && (
                  <p className="text-xs text-fg-muted">Media: {d.report.snapshot.mediaIds.map((m) => <span key={m} className="mr-2 font-mono" title={m}>{shortId(m)}</span>)}</p>
                )}
                <p className="text-xs text-fg-muted">Created {fmt(d.report.snapshot?.createdAt)} · first reported {fmt(d.report.snapshot?.reportedAt || d.report.createdAt)}</p>
              </div>
            </section>

            <section>
              <SectionTitle title="Current state" />
              <div className="rounded-lg border border-line p-3">
                {d.currentState ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    {Object.entries(d.currentState).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-fg-muted">{humanize(k)}</dt>
                        <dd className="break-words text-fg"><ReadableValue value={v} /></dd>
                      </div>
                    ))}
                  </dl>
                ) : <p className="text-sm text-fg-muted">Not available for this target type.</p>}
              </div>
            </section>

            <section>
              <SectionTitle title="Author" />
              <div className="space-y-3 rounded-lg border border-line p-3">
                {!d.authorHistory ? (
                  <p className="text-sm text-fg-muted">No account linked to this target.</p>
                ) : d.authorHistory.anonymous ? (
                  <p className="text-sm text-fg-muted">
                    Anonymous author · {plural(d.authorHistory.priorActionCount, 'prior action')} · {plural(d.authorHistory.sanctionCount, 'sanction')} on record
                  </p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm text-fg">
                      <span className="font-medium">{d.authorHistory.name || 'Unknown'}</span> <span className="font-mono text-xs text-fg-muted" title={d.authorHistory.userId}>{shortId(d.authorHistory.userId)}</span>
                      <span className="text-fg-muted"> · {plural(d.authorHistory.priorActionCount, 'prior action')}</span>
                    </p>
                    {d.authorHistory.sanctions.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-fg-muted">
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
                  <div className="space-y-2 border-t border-line pt-3">
                    {revealed ? (
                      <NoticeBox tone="warning" title="Author revealed">
                        <span className="font-medium">{revealed.name || 'Unknown'}</span> <span className="font-mono text-xs">{revealed.userId}</span>
                        <span className="mt-1 block text-xs">This reveal was logged with your reason.</span>
                      </NoticeBox>
                    ) : revealOpen ? (
                      <div className="space-y-2">
                        <Field label="Why do you need the real author?" hint={`${revealReason.trim().length}/20 characters minimum. This access is logged.`}>
                          <Textarea rows={3} maxLength={500} value={revealReason} onChange={(e) => setRevealReason(e.target.value)} />
                        </Field>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => { setRevealOpen(false); setRevealReason(''); }}>Cancel</Button>
                          <Button variant="destructive" disabled={revealReason.trim().length < 20} loading={busy === 'reveal'} onClick={reveal}>Reveal author</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs text-warning-text"><IconShield size={13} /> Revealing an anonymous author is logged</span>
                        <Button size="sm" onClick={() => setRevealOpen(true)}>Reveal author…</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {isOpen ? (
              <section>
                <SectionTitle title="Decision" description="The note is sent with the outcome and is also the audit reason." />
                <div className="space-y-3 rounded-lg border border-line p-3">
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Decision">
                    {(['dismiss', 'remove', 'hide', 'warn', 'sanction', 'escalate'] as Decision[]).map((k) => {
                      const why = decisionDisabled[k];
                      return (
                        <button
                          key={k}
                          type="button"
                          role="radio"
                          aria-checked={decision === k}
                          disabled={!!why}
                          title={why || undefined}
                          onClick={() => setDecision(k)}
                          className={`rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${decision === k ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
                        >
                          {humanize(k)}
                        </button>
                      );
                    })}
                  </div>
                  {decision === 'sanction' && (
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Scope">
                        <Select className="w-auto" value={sanctionScope} onChange={(e) => setSanctionScope(e.target.value)}>
                          {SANCTION_SCOPES.map((s) => <option key={s} value={s}>{s === 'friends' ? 'All of Friends' : humanize(s)}</option>)}
                        </Select>
                      </Field>
                      <Field label="Days" hint="1 to 365.">
                        <Input type="number" min={1} max={365} disabled={sanctionPermanent} className="w-28" value={sanctionDays} onChange={(e) => setSanctionDays(e.target.value)} />
                      </Field>
                      <div className="pb-6"><Checkbox checked={sanctionPermanent} onChange={(e) => setSanctionPermanent(e.target.checked)} label="Permanent" /></div>
                    </div>
                  )}
                  <Field label="Note">
                    <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </div>
              </section>
            ) : (
              <NoticeBox tone="neutral" title={`Closed: ${humanize(d.report.decision || d.report.status)}`}>
                By {who(d.report.resolvedBy)} · {fmt(d.report.resolvedAt)}{d.report.resolution ? ` · ${d.report.resolution}` : ''}
              </NoticeBox>
            )}

            <section>
              <SectionTitle title={`Reports on this target (${d.reports.length})`} />
              <ul className="divide-y divide-line rounded-lg border border-line">
                {d.reports.map((r) => (
                  <li key={r.id} className={`space-y-1 p-3 ${r.id === d.report.id ? 'bg-surface-2' : ''}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">{humanize(r.category)}</span>
                      <Badge value={r.severity} tones={SEVERITY_TONE} />
                      <Badge value={r.status} tones={STATUS_TONE} />
                      <span className="text-xs text-fg-muted">{r.isSystem ? 'System (auto-flag)' : <>reporter <span className="font-mono" title={r.reporterId || ''}>{shortId(r.reporterId)}</span></>}</span>
                      <span className="ml-auto text-xs text-fg-subtle">{fmt(r.createdAt)}</span>
                    </div>
                    {r.note && <p className="whitespace-pre-wrap break-words text-sm text-fg-muted">{r.note}</p>}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <SectionTitle title="Moderation history" />
              <DataTable
                caption="Moderation history"
                columns={actionColumns(who, true)}
                rows={d.actions}
                rowKey={a => a.id}
                pageSize={0}
                dense
                noun="actions"
                empty={{ title: 'No actions yet' }}
              />
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

const ACTION_TONE = (action: string): 'danger' | 'success' | 'warning' | 'info' => {
  if (/remove|sanction|reject|space_end|space_remove|reveal|view_/.test(action)) return 'danger';
  if (/restore|lift|approve|reversed|badge_grant/.test(action)) return 'success';
  if (/hide|warn|escalate/.test(action)) return 'warning';
  return 'info';
};

const metaText = (meta: Record<string, unknown>) => {
  const parts = Object.entries(meta || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 6)
    .map(([k, v]) => `${words(k)}: ${readableText(v, 1)}`);
  const s = parts.join(' · ');
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
};

/** Columns for moderation actions (the log tab and the history inside a report). */
function actionColumns(who: (id?: string | null) => string, compact: boolean): Column<ModAction>[] {
  const cols: Column<ModAction>[] = [
    { key: 'time', header: 'Time', sortValue: a => new Date(a.createdAt), cell: a => <span className="whitespace-nowrap text-xs text-fg-muted">{fmt(a.createdAt)}</span> },
    { key: 'action', header: 'Action', sortValue: a => a.action, cell: a => <UiBadge tone={ACTION_TONE(a.action)}>{humanize(a.action)}</UiBadge> },
    { key: 'by', header: 'By', cell: a => <span className="whitespace-nowrap text-xs text-fg-muted" title={a.actorId || ''}>{a.actorRole === 'system' ? 'System' : who(a.actorId)}</span> },
  ];
  if (!compact) {
    cols.push(
      { key: 'target', header: 'Target', hideBelow: 'lg', cell: a => <span className="whitespace-nowrap text-xs text-fg-muted">{a.targetType ? humanize(a.targetType) : '–'} <span className="font-mono" title={a.targetId || ''}>{a.targetId ? shortId(a.targetId) : ''}</span></span> },
      { key: 'subject', header: 'Affected user', hideBelow: 'xl', cell: a => <span className="font-mono text-xs text-fg-muted" title={a.subjectUserId || ''}>{shortId(a.subjectUserId)}</span> },
    );
  }
  cols.push({ key: 'details', header: 'Reason and details', cell: a => { const details = [a.reason, metaText(a.meta)].filter(Boolean).join(' — '); return <p className="max-w-[420px] break-words text-xs text-fg-muted">{details || '–'}</p>; } });
  return cols;
}
