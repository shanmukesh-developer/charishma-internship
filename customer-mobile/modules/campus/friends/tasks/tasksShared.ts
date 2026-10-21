import { GraduationCap, Printer, FolderKanban, Palette, Code2, Bike, Shapes, LucideIcon } from '../../../../components/lucide';
import { errorCode } from '../api/core';
import type { Task, TaskCategory, TaskFulfillment, TaskStage, TaskApplicationStatus } from '../api/tasksApi';
import { FriendsColors } from '../friendsTheme';

// ── Labels ───────────────────────────────────────────────────────────────────
export const CATEGORY_META: Record<TaskCategory, { label: string; short: string; icon: LucideIcon }> = {
  tutoring: { label: 'Tutoring & doubts', short: 'Tutoring', icon: GraduationCap },
  notes_printouts: { label: 'Notes & printouts', short: 'Notes', icon: Printer },
  project_help: { label: 'Project help', short: 'Projects', icon: FolderKanban },
  design_media: { label: 'Design, presentations & video', short: 'Design', icon: Palette },
  coding_help: { label: 'Coding help', short: 'Coding', icon: Code2 },
  errands: { label: 'Errands & deliveries', short: 'Errands', icon: Bike },
  other: { label: 'Other', short: 'Other', icon: Shapes },
};

export const FULFILLMENT_LABEL: Record<TaskFulfillment, string> = {
  online: 'Online',
  on_campus: 'On campus',
  either: 'Online or on campus',
};

type Tone = 'accent' | 'gold' | 'success' | 'warn' | 'danger' | 'muted';
export const toneColor = (t: Tone) =>
  t === 'accent'
    ? FriendsColors.accent
    : t === 'gold'
      ? FriendsColors.gold
      : t === 'success'
        ? FriendsColors.success
        : t === 'warn'
          ? FriendsColors.warn
          : t === 'danger'
            ? FriendsColors.danger
            : FriendsColors.muted;
export const toneSoft = (t: Tone) =>
  t === 'accent'
    ? FriendsColors.accentSoft
    : t === 'gold'
      ? FriendsColors.goldSoft
      : t === 'success'
        ? 'rgba(120,200,150,0.12)'
        : t === 'warn'
          ? 'rgba(242,178,126,0.12)'
          : t === 'danger'
            ? FriendsColors.dangerSoft
            : FriendsColors.cardHi;

export const STAGE_META: Record<TaskStage, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'accent' },
  applications_received: { label: 'Applications received', tone: 'accent' },
  assigned: { label: 'Helper selected', tone: 'gold' },
  in_progress: { label: 'In progress', tone: 'gold' },
  submitted: { label: 'Awaiting confirmation', tone: 'warn' },
  completed: { label: 'Completed', tone: 'success' },
  reviewed: { label: 'Completed · reviewed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
  disputed: { label: 'In dispute', tone: 'danger' },
};

export const APPLICATION_META: Record<TaskApplicationStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Applied', tone: 'accent' },
  selected: { label: 'You were selected', tone: 'gold' },
  accepted: { label: "You're the helper", tone: 'success' },
  rejected: { label: 'Not selected', tone: 'muted' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
  declined: { label: 'You declined', tone: 'muted' },
};

/** Badge for the card: poster sees moderation state first, applicants see their application. */
export const taskBadge = (t: Task): { label: string; tone: Tone } => {
  if (t.modStatus === 'rejected') return { label: 'Refused', tone: 'danger' };
  if (t.modStatus === 'removed') return { label: 'Removed', tone: 'danger' };
  if (t.modStatus === 'hidden') return { label: 'Hidden', tone: 'warn' };
  if (t.modStatus === 'pending_review') return { label: 'Under review', tone: 'warn' };
  if (t.myRole !== 'poster' && t.myRole !== 'helper' && t.myApplication && t.myApplication.status !== 'withdrawn') {
    return APPLICATION_META[t.myApplication.status];
  }
  return STAGE_META[t.stage] || STAGE_META[t.status] || { label: t.status, tone: 'muted' };
};

// ── Formatting ───────────────────────────────────────────────────────────────
export const formatInr = (n: number | null | undefined) => {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v === 0) return 'Unpaid';
  try {
    return `₹${v.toLocaleString('en-IN')}`;
  } catch {
    return `₹${v}`;
  }
};

/** "in 3h", "in 2d", "2h left", "overdue" — for deadlines. */
export const deadlineLabel = (iso: string | null | undefined, now = Date.now()): { text: string; urgent: boolean; past: boolean } => {
  if (!iso) return { text: 'No deadline', urgent: false, past: false };
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return { text: '', urgent: false, past: false };
  if (ms <= 0) return { text: 'Deadline passed', urgent: true, past: true };
  const min = Math.round(ms / 60000);
  if (min < 60) return { text: `${min}m left`, urgent: true, past: false };
  const h = Math.floor(min / 60);
  if (h < 24) return { text: `${h}h left`, urgent: h < 6, past: false };
  const d = Math.floor(h / 24);
  return { text: `${d}d left`, urgent: false, past: false };
};

export const formatDeadline = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export const nameOf = (identity: any): string => {
  if (!identity) return 'Student';
  if (identity.anonymous) return identity.alias || 'Student';
  return identity.name || 'Student';
};

// ── Errors ───────────────────────────────────────────────────────────────────
/** Friendly copy for a failed Tasks call (server text is already friendly; some codes get better copy). */
export const taskErrorMessage = (e: any, fallback = 'Please try again.'): string => {
  const code = errorCode(e);
  switch (code) {
    case 'RATE_LIMITED':
      return "You're doing that a lot. Please wait a bit and try again.";
    case 'GUIDELINES_REQUIRED':
      return 'Please accept the community guidelines first.';
    case 'FEATURE_OFF':
      return 'Tasks is switched off right now.';
    case 'VERIFICATION_REQUIRED':
      return 'Verify your college email to use Tasks.';
    case 'FRIENDS_SANCTIONED':
      return 'Tasks is restricted for your account. See Me › Friends privacy & safety.';
    case 'STATE_CHANGED':
      return 'This task just changed. We refreshed it for you.';
    case 'TASK_NOT_FOUND':
      return 'This task is no longer available.';
    case 'BLOCKED':
      return "You can't work with someone you blocked or who blocked you.";
    case 'OWN_TASK':
      return "You can't apply to your own task.";
    case 'TASK_NOT_OPEN':
      return 'This task is no longer taking applications.';
    case 'APPLICATION_CLOSED':
      return "You can't apply to this task again.";
    case 'APPLICATION_NOT_AVAILABLE':
      return 'That application is no longer available. Pick someone else.';
    case 'TOO_MANY_REJECTIONS':
      return "You've sent this back 3 times. Confirm it, or open a dispute.";
    case 'ALREADY_REVIEWED':
      return 'You already reviewed this task.';
    case 'REVIEW_WINDOW_CLOSED':
      return 'The review window for this task has closed.';
    case 'CONTENT_BLOCKED': {
      const reasons: string[] = Array.isArray(e?.data?.reasons) ? e.data.reasons : [];
      if (reasons.includes('PAYMENT_DETAILS')) return "Don't put UPI ids, card numbers or PINs in a task. Agree on payment privately in the task chat.";
      const details: string[] = Array.isArray(e?.data?.details) ? e.data.details.filter((x: any) => typeof x === 'string') : [];
      return details.length ? details.join(' ') : (e?.message as string) || "Some of this text isn't allowed. Please edit it.";
    }
    default:
      return (e && typeof e.message === 'string' && e.message) || fallback;
  }
};

// ── Cache (per app session) ──────────────────────────────────────────────────
const cache = new Map<string, any>();
export const taskCache = {
  get: <T>(key: string): T | undefined => cache.get(key),
  set: (key: string, value: any) => {
    cache.set(key, value);
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  },
  clear: () => cache.clear(),
};

// ── Update bus ───────────────────────────────────────────────────────────────
type TaskListener = (task: Task) => void;
const taskListeners = new Set<TaskListener>();
const staleListeners = new Set<(taskId: string | null) => void>();
const blockListeners = new Set<(userId: string) => void>();

export const taskBus = {
  /** A task changed here (transition, edit, apply): lists merge the fresh copy. */
  emitTask: (task: Task) => taskListeners.forEach((l) => l(task)),
  onTask: (l: TaskListener) => {
    taskListeners.add(l);
    return () => {
      taskListeners.delete(l);
    };
  },
  /** Something changed elsewhere (socket event, new task): lists refetch. null = everything. */
  emitStale: (taskId: string | null) => staleListeners.forEach((l) => l(taskId)),
  onStale: (l: (taskId: string | null) => void) => {
    staleListeners.add(l);
    return () => {
      staleListeners.delete(l);
    };
  },
  /** The viewer blocked someone: drop that person's tasks from the board. */
  emitBlocked: (userId: string) => blockListeners.forEach((l) => l(userId)),
  onBlocked: (l: (userId: string) => void) => {
    blockListeners.add(l);
    return () => {
      blockListeners.delete(l);
    };
  },
};

/** Share link that opens this task inside Campus > Friends > Tasks. */
export const taskLink = (taskId: string) => `zenvy://friends?tab=friends&sub=tasks&id=${encodeURIComponent(taskId)}`;
