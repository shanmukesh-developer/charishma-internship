/**
 * Zenvy Friends > Tasks (/api/campus/tasks). Contract: backend_contract.md "Friends (tasks)".
 * Commission-free peer help board. Zenvy never collects, holds or escrows money: no payment field is
 * ever sent to the server, and the optional UPI link is built on the phone (see `buildUpiLink`).
 * Every call goes through `friendsRequest`, so errors arrive as CampusApiError with the server `code`.
 */
import { friendsRequest, newClientId, FriendsIdentity } from './core';

// ── Enums ─────────────────────────────────────────────────────────────────────
export type TaskCategory = 'tutoring' | 'notes_printouts' | 'project_help' | 'design_media' | 'coding_help' | 'errands' | 'other';
export type TaskFulfillment = 'online' | 'on_campus' | 'either';
export type TaskStatus = 'open' | 'assigned' | 'in_progress' | 'submitted' | 'completed' | 'cancelled' | 'expired' | 'disputed';
/** Display stage: the lifecycle plus "applications received" (open with applicants) and "reviewed" (both reviews in). */
export type TaskStage = TaskStatus | 'applications_received' | 'reviewed';
export type TaskModStatus = 'visible' | 'pending_review' | 'hidden' | 'removed' | 'rejected';
export type TaskApplicationStatus = 'pending' | 'selected' | 'accepted' | 'rejected' | 'withdrawn' | 'declined';
export type TaskRole = 'poster' | 'helper' | 'applicant' | null;
export type TaskSort = 'new' | 'deadline' | 'reward';
export type MyTasksTab = 'posted' | 'helping' | 'applied' | 'completed';
/** What the server says I may do with this task right now (the only source of truth for buttons). */
export type TaskAction =
  | 'edit'
  | 'cancel'
  | 'unselect'
  | 'dispute'
  | 'confirm'
  | 'reject_submission'
  | 'accept'
  | 'decline'
  | 'submit'
  | 'withdraw'
  | 'apply'
  | 'review'
  | 'chat';

export const TASK_CATEGORIES: TaskCategory[] = ['tutoring', 'notes_printouts', 'project_help', 'design_media', 'coding_help', 'errands', 'other'];
export const TASK_FULFILLMENT: TaskFulfillment[] = ['online', 'on_campus', 'either'];

/** Same limits the server enforces (used for counters; the server re-checks everything). */
export const TASK_LIMITS = {
  titleMin: 5,
  titleMax: 100,
  descriptionMin: 20,
  descriptionMax: 2000,
  rewardMin: 0,
  rewardMax: 50000,
  maxSkills: 8,
  skillMax: 30,
  areaHintMax: 60,
  maxMedia: 4,
  noteMax: 500,
  reasonMax: 500,
  reviewTextMax: 500,
  deadlineMinMinutes: 30,
  deadlineMaxDays: 90,
  maxSubmissionRejections: 3,
  disputeMin: 10,
  reasonMin: 3,
} as const;

/** Exact text from the owner's spec. The server sends it on every task; this copy is the offline fallback. */
export const PAYMENT_NOTICE =
  'ZenWe does not collect, hold, escrow, or guarantee payments between students. Any payment is arranged directly between the participating users. Verify the recipient and amount before making a payment.';

// ── DTOs ──────────────────────────────────────────────────────────────────────
export interface TaskMedia {
  mediaId: string;
  url: string;
}

export interface TaskReview {
  rating: number;
  text: string;
  createdAt: string | null;
}

export interface TaskMyApplication {
  id: string;
  status: TaskApplicationStatus;
  note: string;
  createdAt: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  categoryLabel: string;
  rewardInr: number;
  deadlineAt: string | null;
  skills: string[];
  fulfillment: TaskFulfillment;
  areaHint: string | null;
  media: TaskMedia[];
  status: TaskStatus;
  stage: TaskStage;
  applicationCount: number;
  poster: FriendsIdentity;
  createdAt: string | null;
  editedAt: string | null;
  myRole: TaskRole;
  myApplication: TaskMyApplication | null;
  actions: TaskAction[];
  paymentNotice: string;

  // Poster and helper only.
  helper?: FriendsIdentity | null;
  conversationId?: string | null;
  chat?: { conversationId: string; canSend: boolean; closesAt: string | null } | null;
  assignedAt?: string | null;
  startedAt?: string | null;
  submittedAt?: string | null;
  submissionNote?: string | null;
  submissionRejections?: number;
  lastRejectionNote?: string | null;
  completedAt?: string | null;
  autoConfirmed?: boolean;
  autoConfirmAt?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: 'poster' | 'helper' | 'moderator' | null;
  cancelReason?: string | null;
  expiredAt?: string | null;
  disputedAt?: string | null;
  disputedBy?: 'poster' | 'helper' | null;
  disputeReason?: string | null;
  disputeResolution?: string | null;
  reviews?: { mine: TaskReview | null; theirs: TaskReview | null; canReview: boolean };

  // Poster only.
  modStatus?: TaskModStatus;
  underReview?: boolean;
  removedReason?: string | null;
  integrity?: { reasons: string[]; details: string[] };
}

export interface TaskReputation {
  tasksCompleted: number;
  ratingAvg: number | null;
  ratingCount: number;
}

export interface TaskApplication {
  id: string;
  applicant: FriendsIdentity;
  reputation: TaskReputation | null;
  note: string;
  status: TaskApplicationStatus;
  createdAt: string | null;
  canSelect: boolean;
}

export interface TaskMeta {
  categories: { key: TaskCategory; label: string }[];
  fulfillment: TaskFulfillment[];
  reward: { min: number; max: number; currency: 'INR' };
  deadline: { minMinutes: number; maxDays: number };
  text: {
    titleMin: number;
    titleMax: number;
    descriptionMin: number;
    descriptionMax: number;
    noteMax: number;
    areaHintMax: number;
    maxSkills: number;
    skillMax: number;
    maxMedia: number;
  };
  autoConfirmDays: number;
  chatOpenDaysAfterCompletion: number;
  reviewWindowDays: number;
  integrity: { allowed: string[]; notAllowed: string[] };
  paymentNotice: string;
  upi: { clientOnly: true; note: string };
  limits: Record<string, { max: number; windowSec: number }>;
}

export interface UserTaskReputation extends TaskReputation {
  userId: string;
  tasksPostedCompleted: number;
  asHelper: { ratingCount: number; ratingAvg: number | null };
  asPoster: { ratingCount: number; ratingAvg: number | null };
  recent: { rating: number; text: string; role: 'poster' | 'helper'; createdAt: string | null }[];
}

export interface TaskInput {
  title: string;
  description: string;
  category: TaskCategory;
  rewardInr: number;
  deadlineAt: string;
  skills: string[];
  fulfillment: TaskFulfillment;
  areaHint?: string | null;
  mediaIds: string[];
}

// ── Reads ─────────────────────────────────────────────────────────────────────
export const fetchTaskMeta = () => friendsRequest<TaskMeta>('/tasks/meta', { fallback: "Couldn't load Tasks right now." });

export const fetchTaskBoard = (opts: { category?: TaskCategory | null; sort?: TaskSort; q?: string | null; cursor?: string | null } = {}) =>
  friendsRequest<{ items: Task[]; nextCursor: string | null; sort: TaskSort; paymentNotice: string }>('/tasks', {
    query: { category: opts.category || undefined, sort: opts.sort || 'new', q: opts.q && opts.q.trim().length >= 2 ? opts.q.trim() : undefined, cursor: opts.cursor },
    fallback: "Couldn't load tasks.",
  });

export const fetchMyTasks = (tab: MyTasksTab, cursor?: string | null) =>
  friendsRequest<{ tab: MyTasksTab; items: Task[]; nextCursor: string | null; counts: Record<MyTasksTab, number> }>('/tasks/mine', {
    query: { tab, cursor },
    fallback: "Couldn't load your tasks.",
  });

export const fetchTask = async (id: string): Promise<Task> =>
  (await friendsRequest<{ task: Task }>(`/tasks/${encodeURIComponent(id)}`, { fallback: "Couldn't load this task." })).task;

export const fetchTaskApplications = (id: string, cursor?: string | null) =>
  friendsRequest<{ items: TaskApplication[]; nextCursor: string | null; taskStatus: TaskStatus }>(`/tasks/${encodeURIComponent(id)}/applications`, {
    query: { cursor },
    fallback: "Couldn't load the applications.",
  });

export const fetchTaskReviews = (id: string) =>
  friendsRequest<{ mine: TaskReview | null; theirs: TaskReview | null; canReview: boolean }>(`/tasks/${encodeURIComponent(id)}/reviews`, {
    fallback: "Couldn't load the reviews.",
  });

export const fetchTaskReputation = (userId: string) =>
  friendsRequest<UserTaskReputation>(`/tasks/users/${encodeURIComponent(userId)}/reputation`, { fallback: "Couldn't load this student's task history." });

// ── Create / edit ─────────────────────────────────────────────────────────────
export const createTask = (input: TaskInput, clientId: string = newClientId()) =>
  friendsRequest<{ task: Task; duplicate: boolean; underReview: boolean }>('/tasks', {
    method: 'POST',
    body: { ...input, clientId },
    fallback: "Couldn't post your task. Please try again.",
  });

export const updateTask = (id: string, patch: Partial<TaskInput>) =>
  friendsRequest<{ task: Task; underReview: boolean }>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    fallback: "Couldn't save your changes. Please try again.",
  });

// ── Applications ──────────────────────────────────────────────────────────────
export const applyToTask = (id: string, note: string) =>
  friendsRequest<{ application: TaskMyApplication; duplicate: boolean }>(`/tasks/${encodeURIComponent(id)}/applications`, {
    method: 'POST',
    body: { note },
    fallback: "Couldn't send your application. Please try again.",
  });

export const withdrawApplication = (id: string) =>
  friendsRequest<{ withdrawn: boolean; duplicate: boolean }>(`/tasks/${encodeURIComponent(id)}/applications/mine`, {
    method: 'DELETE',
    fallback: "Couldn't withdraw your application.",
  });

// ── Transitions (server-only; the app never sends a status) ───────────────────
type TaskResult = { task: Task; duplicate?: boolean };
const transition = (id: string, path: string, body?: any, fallback = "Couldn't update the task. Please try again.") =>
  friendsRequest<TaskResult & { reportId?: string | null }>(`/tasks/${encodeURIComponent(id)}/${path}`, { method: 'POST', body: body || {}, fallback });

export const selectApplicant = (id: string, applicationId: string) => transition(id, 'select', { applicationId });
export const unselectHelper = (id: string) => transition(id, 'unselect');
export const acceptTask = (id: string) => transition(id, 'accept');
export const declineTask = (id: string) => transition(id, 'decline');
export const submitTask = (id: string, note?: string) => transition(id, 'submit', { note: note || undefined });
export const confirmTask = (id: string) => transition(id, 'confirm');
export const rejectSubmission = (id: string, reason: string) => transition(id, 'reject-submission', { reason });
export const cancelTask = (id: string, reason?: string) => transition(id, 'cancel', { reason: reason || undefined });
export const disputeTask = (id: string, reason: string, category?: string) => transition(id, 'dispute', { reason, category });

export const reviewTask = (id: string, rating: number, text?: string) =>
  friendsRequest<{ review: TaskReview; task: Task }>(`/tasks/${encodeURIComponent(id)}/reviews`, {
    method: 'POST',
    body: { rating, text: text || undefined },
    fallback: "Couldn't save your review. Please try again.",
  });

// ── UPI (client only) ─────────────────────────────────────────────────────────
/** A UPI id looks like name@bank. Checked on the phone only; it is never sent to Zenvy. */
export const isValidUpiId = (v: string) => /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/i.test(v.trim());

/**
 * upi://pay link opened only when the user taps "Open UPI app". Built here from what the user typed,
 * never stored, never sent to the server, and opening it never marks anything as paid.
 */
export const buildUpiLink = (opts: { upiId: string; name?: string | null; amountInr?: number | null; note?: string | null }) => {
  const parts = [`pa=${encodeURIComponent(opts.upiId.trim())}`];
  if (opts.name) parts.push(`pn=${encodeURIComponent(opts.name.slice(0, 40))}`);
  if (opts.amountInr && opts.amountInr > 0) parts.push(`am=${encodeURIComponent(String(Math.round(opts.amountInr)))}`, 'cu=INR');
  if (opts.note) parts.push(`tn=${encodeURIComponent(opts.note.slice(0, 40))}`);
  return `upi://pay?${parts.join('&')}`;
};
