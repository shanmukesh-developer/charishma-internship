/**
 * Friends > Forum: labels, error copy, a tiny in-memory cache (instant re-open / offline) and an
 * update bus so a vote or edit on one screen shows up on every list that holds the same post.
 */
import {
  HelpCircle,
  MessagesSquare,
  Star,
  BookOpen,
  Lightbulb,
  Info,
  GraduationCap,
  Briefcase,
  Utensils,
  Users,
  School,
  Building2,
  Sparkles,
  House,
  type LucideIcon,
} from '../../../../components/lucide';
import { errorCode } from '../api/core';
import type { ForumPost, ForumPostType, ReviewKind, ForumCommunity } from '../api/forumApi';

export const POST_TYPE_META: Record<ForumPostType, { label: string; short: string; icon: LucideIcon; hint: string }> = {
  question: { label: 'Question', short: 'Q&A', icon: HelpCircle, hint: 'Ask something. The best answer can be marked.' },
  discussion: { label: 'Discussion', short: 'Discussion', icon: MessagesSquare, hint: 'Start a conversation.' },
  review: { label: 'Review', short: 'Review', icon: Star, hint: 'Rate a course, professor, hostel, mess, club or placement. Always anonymous.' },
  resource: { label: 'Resource', short: 'Resource', icon: BookOpen, hint: 'Share notes, links or study material you are allowed to share.' },
  guidance: { label: 'Study guidance', short: 'Guidance', icon: Lightbulb, hint: 'Advice from experience: how to prepare, what worked.' },
  campus_info: { label: 'Campus info', short: 'Campus info', icon: Info, hint: 'Timings, places, how things work on campus.' },
};

export const REVIEW_KIND_META: Record<ReviewKind, { label: string; plural: string; icon: LucideIcon }> = {
  course: { label: 'Course', plural: 'Courses', icon: BookOpen },
  professor: { label: 'Professor', plural: 'Professors', icon: GraduationCap },
  hostel: { label: 'Hostel', plural: 'Hostels', icon: House },
  mess: { label: 'Mess', plural: 'Mess', icon: Utensils },
  club: { label: 'Club', plural: 'Clubs', icon: Users },
  placement: { label: 'Placement', plural: 'Placements', icon: Briefcase },
};

/** Context fields offered per review kind (all optional; the server whitelists the keys). */
export const REVIEW_CONTEXT_FIELDS: Record<ReviewKind, { key: 'course' | 'section' | 'semester' | 'year' | 'role' | 'company' | 'roomType' | 'attendance' | 'grade'; label: string; placeholder: string }[]> = {
  course: [
    { key: 'semester', label: 'Semester', placeholder: 'e.g. Sem 3' },
    { key: 'section', label: 'Section', placeholder: 'e.g. B' },
    { key: 'grade', label: 'Grade (optional)', placeholder: 'e.g. A' },
  ],
  professor: [
    { key: 'course', label: 'Course taken', placeholder: 'e.g. Data Structures' },
    { key: 'semester', label: 'Semester', placeholder: 'e.g. Sem 4' },
    { key: 'attendance', label: 'Attendance policy', placeholder: 'e.g. Strict 75%' },
  ],
  hostel: [
    { key: 'roomType', label: 'Room type', placeholder: 'e.g. 2-sharing AC' },
    { key: 'year', label: 'Year stayed', placeholder: 'e.g. 2025' },
  ],
  mess: [{ key: 'year', label: 'Year', placeholder: 'e.g. 2025' }],
  club: [
    { key: 'role', label: 'Your role', placeholder: 'e.g. Member' },
    { key: 'year', label: 'Year', placeholder: 'e.g. 2025' },
  ],
  placement: [
    { key: 'company', label: 'Company', placeholder: 'e.g. Company name' },
    { key: 'role', label: 'Role', placeholder: 'e.g. SDE intern' },
    { key: 'year', label: 'Year', placeholder: 'e.g. 2025' },
  ],
};

export const CONTEXT_LABELS: Record<string, string> = {
  course: 'Course',
  section: 'Section',
  semester: 'Semester',
  year: 'Year',
  role: 'Role',
  company: 'Company',
  roomType: 'Room',
  attendance: 'Attendance',
  grade: 'Grade',
};

const COMMUNITY_ICONS: Record<string, LucideIcon> = {
  academics: School,
  placements: Briefcase,
  'hostel-food': Utensils,
  clubs: Users,
  admissions: Building2,
  'faculty-reviews': GraduationCap,
  'off-campus': House,
  'freshers-help': Sparkles,
};

export const communityIcon = (c: Pick<ForumCommunity, 'slug'> | null | undefined): LucideIcon =>
  (c && COMMUNITY_ICONS[c.slug]) || MessagesSquare;

export const BADGE_META: Record<string, { label: string; hint: string }> = {
  helpful_answer: { label: 'Helpful Answer', hint: 'Had an answer picked as the best answer' },
  community_helper: { label: 'Community Helper', hint: '5 best answers' },
  resource_sharer: { label: 'Resource Sharer', hint: 'Shared resources others found useful' },
  top_contributor: { label: 'Top Contributor', hint: '50 karma from upvotes' },
};

export const forumBadges = (codes: string[] | undefined | null) => (codes || []).filter((c) => !!BADGE_META[c]);

/** Friendly message for a failed Forum call (server text is already friendly; a few codes get better copy). */
export const forumErrorMessage = (e: any, fallback = 'Please try again.'): string => {
  const code = errorCode(e);
  switch (code) {
    case 'RATE_LIMITED':
      return "You're doing that a lot. Please wait a bit and try again.";
    case 'GUIDELINES_REQUIRED':
      return 'Please accept the community guidelines first.';
    case 'FEATURE_OFF':
      return 'Forum is switched off right now.';
    case 'VERIFICATION_REQUIRED':
      return 'Verify your college email to use the Forum.';
    case 'FRIENDS_SANCTIONED':
      return 'Posting in Friends is restricted for your account. See Me › Friends privacy & safety.';
    case 'LOCKED':
      return 'This post is locked by a moderator.';
    case 'SELF_VOTE':
      return "You can't vote on your own post or comment.";
    default:
      return (e && typeof e.message === 'string' && e.message) || fallback;
  }
};

/** CONTENT_BLOCKED carries readable reasons in `data.details` / `data.reasons`; fold them into one line. */
export const blockedDetails = (e: any): string | null => {
  if (errorCode(e) !== 'CONTENT_BLOCKED') return null;
  const d = e?.data || {};
  const details: string[] = Array.isArray(d.details) ? d.details.filter((x: any) => typeof x === 'string') : [];
  return details.length ? details.join(' ') : null;
};

// ── Cache (per app session) ──────────────────────────────────────────────────
const cache = new Map<string, any>();
export const forumCache = {
  get: <T>(key: string): T | undefined => cache.get(key),
  set: (key: string, value: any) => {
    cache.set(key, value);
    if (cache.size > 80) cache.delete(cache.keys().next().value as string);
  },
  clear: () => cache.clear(),
};

// ── Update bus ───────────────────────────────────────────────────────────────
type PostListener = (post: ForumPost) => void;
type RemoveListener = (postId: string) => void;
const postListeners = new Set<PostListener>();
const removeListeners = new Set<RemoveListener>();
const blockListeners = new Set<(userId: string) => void>();

export const forumBus = {
  /** A post changed (vote, bookmark, edit, moderation). */
  emitPost: (post: ForumPost) => postListeners.forEach((l) => l(post)),
  /** A post is gone for this viewer (deleted, removed, blocked author). */
  emitRemoved: (postId: string) => removeListeners.forEach((l) => l(postId)),
  /** The viewer blocked someone: drop that person's named posts from every list. */
  emitBlocked: (userId: string) => blockListeners.forEach((l) => l(userId)),
  onBlocked: (l: (userId: string) => void) => {
    blockListeners.add(l);
    return () => {
      blockListeners.delete(l);
    };
  },
  onPost: (l: PostListener) => {
    postListeners.add(l);
    return () => {
      postListeners.delete(l);
    };
  },
  onRemoved: (l: RemoveListener) => {
    removeListeners.add(l);
    return () => {
      removeListeners.delete(l);
    };
  },
};

/** Merge a fresh post into a list (keeps the list's order). */
export const patchPostList = (list: ForumPost[], post: ForumPost) => {
  let hit = false;
  const next = list.map((p) => {
    if (p.id !== post.id) return p;
    hit = true;
    // List items carry an excerpt; keep it unless the fresh copy is also an excerpt.
    return { ...post, body: p.bodyTruncated && !post.bodyTruncated ? excerpt(post.body) : post.body, bodyTruncated: p.bodyTruncated || post.bodyTruncated };
  });
  return hit ? next : list;
};

export const excerpt = (body: string, n = 300) => (body && body.length > n ? `${body.slice(0, n)}...` : body || '');

/** Share link that opens this post inside Campus > Friends > Forum. */
export const forumPostLink = (postId: string) => `zenvy://friends?tab=friends&sub=forum&id=${encodeURIComponent(postId)}`;

export const compactCount = (n: number) => {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1000) return String(v);
  if (Math.abs(v) < 100000) return `${(v / 1000).toFixed(v % 1000 >= 100 ? 1 : 0)}k`;
  return `${Math.round(v / 1000)}k`;
};
