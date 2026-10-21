/**
 * Friends > Pulse: error copy, a small in-memory cache (instant re-open / offline fallback), an update
 * bus so a like or edit on one screen shows on every list holding the same post, and text parsing
 * (hashtags, @friend codes, links) that follows the server's rules.
 */
import { errorCode } from '../api/core';
import type { PulseFeedItem, PulsePost } from '../api/pulseApi';

// ── Errors ───────────────────────────────────────────────────────────────────
export const pulseErrorMessage = (e: any, fallback = 'Please try again.'): string => {
  const code = errorCode(e);
  const d = e?.data || {};
  switch (code) {
    case 'RATE_LIMITED':
      return "You're doing that a lot. Please wait a bit and try again.";
    case 'GUIDELINES_REQUIRED':
      return 'Please accept the community guidelines first.';
    case 'FEATURE_OFF':
      return 'Pulse is switched off right now.';
    case 'VERIFICATION_REQUIRED':
      return 'Verify your college email to use Pulse.';
    case 'FRIENDS_SANCTIONED':
      return 'Posting in Friends is restricted for your account. See Me › Friends privacy & safety.';
    case 'TOO_LONG':
      return `Posts can be up to ${d.max || 280} characters.`;
    case 'EMPTY_POST':
      return 'Write something or add a photo.';
    case 'TOO_MANY_MEDIA':
      return 'You can add up to 4 photos.';
    case 'INVALID_MEDIA':
      return 'One of the photos could not be used. Remove it and add it again.';
    case 'TOO_MANY_LINKS':
      return 'Only one link per post.';
    case 'INVALID_POLL':
      return 'Polls need 2 to 4 different options of up to 40 characters.';
    case 'POLL_NOT_ALLOWED':
      return 'Replies cannot have polls.';
    case 'ANON_POLICY':
      return 'Anonymous posts cannot limit replies to people you follow.';
    case 'ENTITY_NOT_ANONYMOUS':
      return 'Club and official posts cannot be anonymous.';
    case 'NOT_ENTITY_MANAGER':
      return "You don't manage that club or account.";
    case 'REPLIES_RESTRICTED':
      return d.replyPolicy === 'none' ? 'The author turned off replies.' : 'Only people the author follows can reply.';
    case 'POST_NOT_OPEN':
      return 'This conversation is closed.';
    case 'POST_NOT_FOUND':
      return 'This post is no longer available.';
    case 'ANONYMOUS_NO_REPOST':
      return 'Anonymous posts cannot be reposted.';
    case 'ALREADY_VOTED':
      return 'You already voted in this poll.';
    case 'POLL_CLOSED':
      return 'This poll has ended.';
    case 'NOT_AUTHOR':
      return 'You can only change your own posts.';
    case 'REMOVED':
      return 'A moderator removed this post, so it can no longer be edited.';
    case 'NOT_INTERACTIVE':
      return 'Open the Space to join in.';
    case 'USER_NOT_FOUND':
      return 'This student is not available.';
    case 'CONTENT_BLOCKED': {
      const details: string[] = Array.isArray(d.details) ? d.details.filter((x: any) => typeof x === 'string') : [];
      return details.length ? details.join(' ') : (e && typeof e.message === 'string' && e.message) || "This can't be posted. Please check our guidelines.";
    }
    default:
      return (e && typeof e.message === 'string' && e.message) || fallback;
  }
};

// ── Cache (per app session) ──────────────────────────────────────────────────
const cache = new Map<string, any>();
export const pulseCache = {
  get: <T>(key: string): T | undefined => cache.get(key),
  set: (key: string, value: any) => {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  },
  clear: () => cache.clear(),
};

// ── Update bus ───────────────────────────────────────────────────────────────
type PostListener = (post: PulsePost) => void;
type IdListener = (id: string) => void;
const postL = new Set<PostListener>();
const removeL = new Set<IdListener>();
const blockL = new Set<IdListener>();
const createdL = new Set<PostListener>();

const sub = <L>(set: Set<L>, l: L) => {
  set.add(l);
  return () => {
    set.delete(l);
  };
};

export const pulseBus = {
  /** A post changed (like, repost, bookmark, vote, edit). */
  emitPost: (p: PulsePost) => postL.forEach((l) => l(p)),
  /** A post is gone for this viewer (deleted, blocked author). */
  emitRemoved: (id: string) => removeL.forEach((l) => l(id)),
  /** The viewer blocked someone: drop their named posts everywhere. */
  emitBlocked: (userId: string) => blockL.forEach((l) => l(userId)),
  /** The viewer published a post or reply. */
  emitCreated: (p: PulsePost) => createdL.forEach((l) => l(p)),
  onPost: (l: PostListener) => sub(postL, l),
  onRemoved: (l: IdListener) => sub(removeL, l),
  onBlocked: (l: IdListener) => sub(blockL, l),
  onCreated: (l: PostListener) => sub(createdL, l),
};

/** Stable list key: reposts carry the reaction id, so keys are namespaced by kind. */
export const itemKey = (i: PulseFeedItem) => `${i.kind}:${i.id}`;

/** Apply a fresh post to a feed list (plain posts and reposts of it). */
export const patchFeed = <T extends PulseFeedItem>(list: T[], post: PulsePost): T[] => {
  let hit = false;
  const next = list.map((i) => {
    if ((i.kind === 'post' || i.kind === 'reply') && i.id === post.id) {
      hit = true;
      return post as T;
    }
    if (i.kind === 'repost' && i.post.id === post.id) {
      hit = true;
      return { ...i, post } as T;
    }
    return i;
  });
  return hit ? next : list;
};

export const dropFromFeed = <T extends PulseFeedItem>(list: T[], postId: string): T[] =>
  list.filter((i) => !((i.kind === 'post' || i.kind === 'reply') && i.id === postId) && !(i.kind === 'repost' && i.post.id === postId));

const authorIdOf = (p: PulsePost): string | null => {
  const a: any = p.author;
  return a && !a.anonymous && a.userId ? String(a.userId) : null;
};

/** Named content by a blocked user disappears; anonymous content is never filtered by its author. */
export const dropBlocked = <T extends PulseFeedItem>(list: T[], userId: string): T[] =>
  list.filter((i) => {
    if (i.kind === 'post' || i.kind === 'reply') return authorIdOf(i) !== userId;
    if (i.kind === 'repost') return authorIdOf(i.post) !== userId && (i.repostedBy as any)?.userId !== userId;
    return true;
  });

// ── Links and counts ─────────────────────────────────────────────────────────
/** Share link that opens this post inside Campus > Friends > Pulse. */
export const pulsePostLink = (postId: string) => `zenvy://friends?tab=friends&sub=pulse&id=${encodeURIComponent(postId)}`;

export const compactCount = (n: number) => {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1000) return String(v);
  if (Math.abs(v) < 100000) return `${(v / 1000).toFixed(v % 1000 >= 100 ? 1 : 0)}k`;
  return `${Math.round(v / 1000)}k`;
};

// ── Text parsing ─────────────────────────────────────────────────────────────
export type TextPart =
  | { type: 'text'; text: string }
  | { type: 'tag'; text: string; tag: string }
  | { type: 'mention'; text: string; code: string }
  | { type: 'link'; text: string; url: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const MENTION_RE = /@ZNV-[A-Z0-9]{5}(?![A-Za-z0-9])/gi;
// '#' + 2..40 letters/digits/_ with at least one letter; not after a letter, digit, & or /.
const TAG_RE = /#([\p{L}\p{N}_]{2,40})(?![\p{L}\p{N}_])/gu;
const HEX_COLOR = /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Hashtag rules matching the server: letter required, colour codes (#ff00aa) and URL fragments ignored. */
export const isValidTag = (raw: string) => /\p{L}/u.test(raw) && !(HEX_COLOR.test(raw) && /\d/.test(raw));

/** Split post text into plain text, #hashtags, @ZNV-XXXXX mentions and links. */
export const parsePulseText = (text: string): TextPart[] => {
  const s = text || '';
  type Hit = { start: number; end: number; part: TextPart };
  const hits: Hit[] = [];
  for (const m of s.matchAll(URL_RE)) {
    let url = m[0];
    // Trailing punctuation belongs to the sentence, not the link.
    while (/[.,!?;:)\]]$/.test(url)) url = url.slice(0, -1);
    hits.push({ start: m.index!, end: m.index! + url.length, part: { type: 'link', text: url, url } });
  }
  const inLink = (i: number) => hits.some((h) => h.part.type === 'link' && i >= h.start && i < h.end);
  for (const m of s.matchAll(MENTION_RE)) {
    if (inLink(m.index!)) continue;
    const prev = m.index! > 0 ? s[m.index! - 1] : '';
    if (prev && /[A-Za-z0-9_-]/.test(prev)) continue;
    hits.push({ start: m.index!, end: m.index! + m[0].length, part: { type: 'mention', text: m[0], code: m[0].slice(1).toUpperCase() } });
  }
  for (const m of s.matchAll(TAG_RE)) {
    if (inLink(m.index!)) continue;
    const prev = m.index! > 0 ? s[m.index! - 1] : '';
    if (prev && /[\p{L}\p{N}_&/]/u.test(prev)) continue;
    if (!isValidTag(m[1])) continue;
    hits.push({ start: m.index!, end: m.index! + m[0].length, part: { type: 'tag', text: m[0], tag: m[1].normalize('NFKC').toLowerCase() } });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: TextPart[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue; // overlap
    if (h.start > at) out.push({ type: 'text', text: s.slice(at, h.start) });
    out.push(h.part);
    at = h.end;
  }
  if (at < s.length) out.push({ type: 'text', text: s.slice(at) });
  return out;
};

/** Links found in a draft (the server allows one per post, counting the link field). */
export const linksIn = (text: string) => parsePulseText(text).filter((p) => p.type === 'link').map((p) => (p as any).url as string);

/** Hashtags in a draft (for the composer hint). */
export const tagsIn = (text: string) => [...new Set(parsePulseText(text).filter((p) => p.type === 'tag').map((p) => (p as any).tag as string))];

/** A human line for a time in the future ("in 2h", "Tomorrow 6:30 PM"). */
export const formatStartsAt = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMin = Math.round((d.getTime() - now.getTime()) / 60000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diffMin <= 0) return `Started ${time}`;
  if (diffMin < 60) return `In ${diffMin} min`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

/** "Ends in 3h" / "Ended" for polls. */
export const pollTimeLeft = (closesAt: string, closed: boolean): string => {
  if (closed) return 'Final results';
  const ms = new Date(closesAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Final results';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} min left`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h left`;
  return `${Math.round(h / 24)} days left`;
};
