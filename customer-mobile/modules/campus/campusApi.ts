import { API_URL } from '../../constants/api';
import { getToken } from '../../utils/auth';
import { prepareAndUploadImage, MediaPurpose } from '../../utils/imageUpload';
import { withWakeRetry } from '../../utils/serverWake';
import {
  CampusItem,
  CampusProfileData,
  CampusUserData,
  CampusChatListItem,
  CampusChatMessagesResponse,
} from '../../types/campus';

export interface CampusProfileResponse {
  profile: CampusProfileData;
  user: CampusUserData;
  /** Latest ID-card request (pending / rejected with the reviewer's note). */
  lastVerification?: CampusLastVerification | null;
  verificationMethods?: { email: boolean; idCard: boolean };
}

export const CAMPUS_NO_SESSION_ERROR =
  'You are not signed in. Log in to your ZCS account to use Campus.';

/** JSON + Bearer headers for the signed-in user (throws CAMPUS_NO_SESSION_ERROR when signed out). */
export const getAuthHeaders = async () => {
  const token = await getToken();
  if (!token) throw new Error(CAMPUS_NO_SESSION_ERROR);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
};

export const CAMPUS_NETWORK_ERROR =
  "Couldn't reach Campus right now. Check your connection and try again.";
export const CAMPUS_SESSION_EXPIRED_ERROR = 'Your session has expired. Please sign in again.';

/** True when an error means the user must sign in (no token / expired token). */
export const isCampusAuthError = (err: any) => {
  const msg = String(err?.message || '');
  return msg === CAMPUS_NO_SESSION_ERROR || msg === CAMPUS_SESSION_EXPIRED_ERROR;
};

/** Error with the server's machine-readable code (e.g. EMAIL_NOT_CONFIGURED) and extra fields. */
export class CampusApiError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(message: string, status = 0, code = '', data: any = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/**
 * Parse a fetch Response and throw a short, friendly Error on failure.
 * Never surfaces raw HTML / "JSON Parse error" text (e.g. a Render 502 page during a cold start).
 */
export const jsonOrThrow = async (res: Response, fallback: string) => {
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json && typeof json.code === 'string' ? json.code : '';
    if (res.status === 401) throw new CampusApiError(CAMPUS_SESSION_EXPIRED_ERROR, 401, code || 'AUTH', json);
    // A structured JSON error from our own API (e.g. 502 EMAIL_SEND_FAILED) keeps its own message;
    // only a bare gateway error (Render cold start / HTML page) is reported as "waking up".
    if (res.status >= 502 && res.status <= 504 && !(json && typeof json.message === 'string' && code)) {
      throw new CampusApiError('Campus is waking up. Please try again in a few seconds.', res.status, code || 'SERVER_BUSY', json);
    }
    const serverMsg = json && typeof json.message === 'string' ? json.message : '';
    throw new CampusApiError(serverMsg && serverMsg.length < 160 ? serverMsg : fallback, res.status, code, json);
  }
  if (json === null) throw new CampusApiError(fallback, res.status);
  return json;
};

export const CAMPUS_TIMEOUT_MS = 30000;

/** fetch() with a timeout; network failures (offline, DNS, timeout) become a friendly message. */
const campusFetchOnce = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAMPUS_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** GETs ride out a backend cold start (utils/serverWake.ts); other methods are sent once. */
export const campusFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const method = String(init?.method || 'GET').toUpperCase();
  try {
    if (method === 'GET') return await withWakeRetry(() => campusFetchOnce(url, init));
    return await campusFetchOnce(url, init);
  } catch {
    throw new CampusApiError(CAMPUS_NETWORK_ERROR, 0, 'NETWORK');
  }
};

export const fetchCampuses = async (): Promise<CampusItem[]> => {
  const res = await campusFetch(`${API_URL}/api/campus/campuses`);
  const json = await jsonOrThrow(res, "Couldn't load campuses. Please try again.");
  return Array.isArray(json) ? json : [];
};

/**
 * Loads the signed-in user's campus profile. Throws a friendly error (network / session)
 * so the UI can show Retry or Sign in instead of invented defaults.
 */
export const fetchCampusProfile = async (): Promise<CampusProfileResponse> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/profile`, { headers });
  return jsonOrThrow(res, "Couldn't load your campus profile.");
};

export const updateCampusProfile = async (data: Partial<CampusProfileData>): Promise<CampusProfileData | null> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/profile`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  });
  const json = await jsonOrThrow(res, "Couldn't save your profile. Please try again.");
  return json.profile;
};

export const requestCollegeEmailOtp = async (email: string, campusId?: string) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/verify/email-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, campusId }),
  });
  return jsonOrThrow(res, "Couldn't send the code. Please try again.");
};

export const confirmCollegeEmailOtp = async (email: string, otp: string) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/verify/confirm-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, otp }),
  });
  return jsonOrThrow(res, 'That code is invalid or has expired.');
};

export const uploadIdCardForVerification = async (idCardImageUrl: string, campusId?: string, collegeId?: string) => {
  // Device-local photos are compressed and uploaded first (private id_card media); the request
  // carries only the short media link.
  let imageUrl = idCardImageUrl;
  if (!/^(https?:|\/api\/)/i.test(imageUrl)) {
    const uploaded = await prepareAndUploadImage({ uri: imageUrl }, 'id_card', { maxEdge: 1600, quality: 0.75 });
    imageUrl = uploaded.url;
  }
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/verify/upload-id`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ idCardImageUrl: imageUrl, campusId, collegeId }),
  });
  return jsonOrThrow(res, "Couldn't submit your ID card. Please try again.");
};

export interface CampusVerificationMethods {
  email: boolean;
  idCard: boolean;
  emailDomains?: string[];
  otpTtlSeconds?: number;
  resendCooldownSeconds?: number;
}

export interface CampusLastVerification {
  id: string;
  type?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewNotes?: string | null;
  idCardImageUrl?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
}

export interface CampusVerificationStatus {
  verificationStatus: CampusProfileData['verificationStatus'];
  collegeEmail?: string | null;
  verifiedAt?: string | null;
  lastVerification: CampusLastVerification | null;
  methods?: CampusVerificationMethods;
}

export const fetchVerificationMethods = async (): Promise<CampusVerificationMethods> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/verify/methods`, { headers });
  const json = await jsonOrThrow(res, "Couldn't load verification options.");
  return { ...json, email: !!json.email, idCard: json.idCard !== false };
};

export const fetchVerificationStatus = async (): Promise<CampusVerificationStatus> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/verify/status`, { headers });
  return jsonOrThrow(res, "Couldn't load your verification status.");
};

// ── People search + 1:1 chats ────────────────────────────────────────────────
export type CampusFriendshipStatus = 'none' | 'accepted' | 'pending_out' | 'pending_in' | 'blocked';

export interface CampusPerson {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  branch?: string | null;
  year?: number | null;
  verified?: boolean;
  friendshipStatus: CampusFriendshipStatus;
  friendshipId?: string | null;
}

export interface CampusClub {
  id: string;
  name: string;
  description?: string | null;
  type?: string;
  avatarUrl?: string | null;
  memberCount?: number;
  isMember?: boolean;
}

export const searchCampus = async (
  q: string,
  type: 'all' | 'people' | 'clubs' = 'all'
): Promise<{ people: CampusPerson[]; clubs: CampusClub[]; needsCampus?: boolean; needsVerification?: boolean }> => {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ q, type });
  const res = await campusFetch(`${API_URL}/api/campus/search?${params.toString()}`, { headers });
  const json = await jsonOrThrow(res, "Couldn't search right now.");
  return {
    people: json.people || [],
    clubs: json.clubs || [],
    needsCampus: !!json.needsCampus,
    needsVerification: !!json.needsVerification,
  };
};

export const openCampusDm = async (userId: string): Promise<{ chatId: string; name: string }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/dm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ userId }),
  });
  const json = await jsonOrThrow(res, "Couldn't open the chat. Please try again.");
  return { chatId: json.chatId || json.chat?.id, name: json.chat?.name || 'Chat' };
};

export const setGroupDiscoverable = async (groupId: string, discoverable: boolean) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/groups/${encodeURIComponent(groupId)}/discoverable`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ discoverable }),
  });
  return jsonOrThrow(res, "Couldn't update the group.");
};

export const joinOpenGroup = async (groupId: string): Promise<CampusGroup & { alreadyMember?: boolean }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/groups/${encodeURIComponent(groupId)}/join-open`, {
    method: 'POST',
    headers,
  });
  const json = await jsonOrThrow(res, "Couldn't join the club. Please try again.");
  const message: string = json.message || '';
  return { ...(json.group || { id: groupId }), alreadyMember: /already/i.test(message) };
};

// ── Friends (/api/friends) ───────────────────────────────────────────────────
export interface FriendRequestItem {
  friendshipId: string;
  vibe?: string;
  icebreaker?: string | null;
  createdAt?: string;
  user: { id: string; name: string; friendCode?: string | null; avatarUrl?: string | null } | null;
}

export interface FriendItem {
  friendshipId: string;
  friendId: string;
  name: string;
  friendCode?: string | null;
  avatarUrl?: string | null;
  profileImage?: string | null;
  vibe?: string;
  streakCount?: number;
  conversationId?: string | null;
}

export interface BlockedItem {
  friendshipId: string;
  // id is null for people blocked through Connect (they are shown by their Connect name only).
  user: { id: string | null; name: string };
}

export const fetchFriendRequests = async (): Promise<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/requests`, { headers });
  const json = await jsonOrThrow(res, "Couldn't load friend requests.");
  return {
    incoming: (json.incoming || []).filter((r: FriendRequestItem) => r && r.user),
    outgoing: (json.outgoing || []).filter((r: FriendRequestItem) => r && r.user),
  };
};

export const fetchFriends = async (): Promise<FriendItem[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends`, { headers });
  const json = await jsonOrThrow(res, "Couldn't load your friends.");
  return Array.isArray(json) ? json : [];
};

export const sendFriendRequest = async (data: { friendCode?: string; recipientId?: string; icebreaker?: string }) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/request`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  return jsonOrThrow(res, "Couldn't send the request. Please try again.");
};

export const acceptFriendRequest = async (friendshipId: string): Promise<{ conversationId?: string }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/requests/${encodeURIComponent(friendshipId)}/accept`, {
    method: 'POST',
    headers,
  });
  return jsonOrThrow(res, "Couldn't accept the request. Please try again.");
};

export const declineFriendRequest = async (friendshipId: string) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/requests/${encodeURIComponent(friendshipId)}/decline`, {
    method: 'POST',
    headers,
  });
  return jsonOrThrow(res, "Couldn't decline the request. Please try again.");
};

export const cancelFriendRequest = async (friendshipId: string) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/requests/${encodeURIComponent(friendshipId)}`, {
    method: 'DELETE',
    headers,
  });
  return jsonOrThrow(res, "Couldn't withdraw the request. Please try again.");
};

export const removeFriend = async (friendshipId: string) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/${encodeURIComponent(friendshipId)}`, {
    method: 'DELETE',
    headers,
  });
  return jsonOrThrow(res, "Couldn't remove this friend. Please try again.");
};

export const blockCampusUser = async (userId: string) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/block`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ userId }),
  });
  return jsonOrThrow(res, "Couldn't block this person. Please try again.");
};

export const unblockCampusUser = async (userId: string | null, friendshipId?: string) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/unblock`, {
    method: 'POST',
    headers,
    body: JSON.stringify(userId ? { userId } : { friendshipId }),
  });
  return jsonOrThrow(res, "Couldn't unblock. Please try again.");
};

export const fetchBlockedUsers = async (): Promise<BlockedItem[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/friends/blocked`, { headers });
  const json = await jsonOrThrow(res, "Couldn't load blocked people.");
  return (Array.isArray(json) ? json : [])
    .filter((b: any) => b && b.user)
    .map((b: any) => ({ friendshipId: b.friendshipId, user: { id: b.user.id || null, name: b.user.name || 'Blocked person' } }));
};

// Chats (Phase 2). Messaging itself is socket-driven; these load list + history.
export const fetchChats = async (): Promise<CampusChatListItem[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/chats`, { headers });
  const json = await jsonOrThrow(res, "Couldn't load your chats.");
  return json.chats || [];
};

export const fetchChatMessages = async (
  chatId: string,
  cursor?: string | null,
  limit = 30
): Promise<CampusChatMessagesResponse> => {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', String(cursor));
  const res = await campusFetch(
    `${API_URL}/api/campus/chats/${encodeURIComponent(chatId)}/messages?${params.toString()}`,
    { headers }
  );
  return jsonOrThrow(res, "Couldn't load messages.");
};

// ── Phase 3: Groups & Classroom ──────────────────────────────────────────────
export interface CampusGroup {
  id: string;
  name: string;
  description?: string;
  type?: string;
  groupAvatar?: string | null;
  joinCode?: string;
  isAdmin?: boolean;
  memberCount?: number;
  /** Public on campus (admins only see this flag). */
  discoverable?: boolean;
}

export const fetchMyGroups = async (): Promise<CampusGroup[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/groups/mine`, { headers });
  const json = await jsonOrThrow(res, "Couldn't load your groups.");
  return json.groups || [];
};

export const createCampusGroup = async (data: {
  name: string;
  description?: string;
  type?: string;
  onlyAdminsCanSend?: boolean;
  discoverable?: boolean;
}): Promise<CampusGroup> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/groups`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const json = await jsonOrThrow(res, "Couldn't create the group. Please try again.");
  return json.group;
};

export const previewCampusGroup = async (code: string) => {
  const res = await campusFetch(`${API_URL}/api/campus/groups/preview/${encodeURIComponent(code)}`);
  return jsonOrThrow(res, 'Code not found');
};

export const joinCampusGroup = async (
  code: string
): Promise<CampusGroup & { alreadyMember?: boolean; message?: string }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/groups/join`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code }),
  });
  const json = await jsonOrThrow(res, "Couldn't join the group. Please try again.");
  const message: string = json.message || '';
  return { ...(json.group || {}), alreadyMember: /already a member/i.test(message), message };
};

export const resetCampusGroupCode = async (groupId: string): Promise<string> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/groups/${groupId}/code/reset`, {
    method: 'POST',
    headers,
  });
  const json = await jsonOrThrow(res, "Couldn't reset the code.");
  return json.joinCode;
};

export interface CampusAssignment {
  id: string;
  conversationId: string;
  facultyId: string;
  facultyName: string;
  title: string;
  instructions?: string;
  topic?: string;
  points?: number;
  dueDate: string;
  attachments?: any[];
  submissions?: any[];
}

export interface CampusAnnouncement {
  id: string;
  conversationId: string;
  facultyId: string;
  facultyName: string;
  title: string;
  body: string;
  priority?: string;
  acks?: string[];
  seenBy?: string[];
}

export const fetchAssignments = async (conversationId: string): Promise<CampusAssignment[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/assignments/${conversationId}`, { headers });
  const json = await jsonOrThrow(res, 'Failed to load assignments');
  return Array.isArray(json) ? json : json.assignments || [];
};

export interface CampusMyAssignment extends CampusAssignment {
  groupName?: string | null;
  mySubmission?: {
    status?: string;
    turnedInAt?: string | null;
    grade?: number | string | null;
  } | null;
}

/**
 * All assignments across the groups the user belongs to, with the user's own submission.
 * Uses GET /api/campus/assignments when the server exposes it, otherwise aggregates the
 * per-group endpoint (same real data, more requests).
 */
export const fetchMyAssignments = async (userId?: string | null): Promise<CampusMyAssignment[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/assignments`, { headers });
  if (res.status !== 404) {
    const json = await jsonOrThrow(res, "Couldn't load your assignments.");
    return Array.isArray(json) ? json : json.assignments || [];
  }

  const groups = await fetchMyGroups();
  const settled = await Promise.allSettled(
    groups.map(async (g) => {
      const list = await fetchAssignments(g.id);
      return list.map((a): CampusMyAssignment => {
        const mine = (a.submissions || []).find((s: any) => s && s.studentId === userId) || null;
        const { submissions, ...rest } = a;
        return {
          ...rest,
          groupName: g.name,
          mySubmission: mine
            ? { status: mine.status, turnedInAt: mine.turnedInAt, grade: mine.grade }
            : null,
        };
      });
    })
  );
  // One unreachable group must not blank the whole list; only fail if every group failed.
  if (groups.length > 0 && settled.every((r) => r.status === 'rejected')) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  return settled
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
};

export const submitCampusAssignment = async (
  assignmentId: string,
  data: { submissionText?: string; fileUrl?: string }
) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/assignments/${assignmentId}/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  return jsonOrThrow(res, 'Failed to submit');
};

export const fetchAnnouncements = async (conversationId: string): Promise<CampusAnnouncement[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/announcements/${conversationId}`, { headers });
  const json = await jsonOrThrow(res, 'Failed to load announcements');
  return json.announcements || [];
};

export const ackCampusAnnouncement = async (announcementId: string) => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/announcements/${announcementId}/ack`, {
    method: 'POST',
    headers,
  });
  return jsonOrThrow(res, 'Failed to acknowledge');
};

// ── Phase 4: Polls (smart tray) ──────────────────────────────────────────────
export interface CampusPoll {
  id: string;
  conversationId: string;
  creatorId: string;
  question: string;
  options: string[];
  votes: Record<string, string[]>;
  /** Per-option vote totals from the server (anonymous polls hide other voters' ids). */
  voteCounts?: Record<string, number>;
  isMulti?: boolean;
  isAnonymous?: boolean;
  closed?: boolean;
}

export const createCampusPoll = async (data: {
  conversationId: string;
  question: string;
  options: string[];
  isMulti?: boolean;
}): Promise<CampusPoll> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/polls`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const json = await jsonOrThrow(res, 'Failed to create poll');
  return json.poll;
};

export const fetchCampusPolls = async (conversationId: string): Promise<CampusPoll[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/polls/${conversationId}`, { headers });
  const json = await jsonOrThrow(res, 'Failed to load polls');
  return json.polls || [];
};

export const voteCampusPoll = async (pollId: string, optionIndexes: number[]): Promise<CampusPoll> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/polls/${pollId}/vote`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ optionIndexes }),
  });
  const json = await jsonOrThrow(res, 'Failed to vote');
  return json.poll;
};

// ── Phase 4: Lost & Found (smart tray) ───────────────────────────────────────
export interface CampusLostFoundItem {
  id: string;
  userId: string;
  userName: string;
  type: 'lost' | 'found';
  title: string;
  description?: string | null;
  location: string;
  imageUrl?: string | null;
  status: 'open' | 'claimed' | 'resolved';
  claimContact?: string | null;
  createdAt: string;
}

export const fetchLostFound = async (type?: 'lost' | 'found'): Promise<CampusLostFoundItem[]> => {
  const headers = await getAuthHeaders();
  const params = type ? `?type=${type}` : '';
  const res = await campusFetch(`${API_URL}/api/campus/lost-found${params}`, { headers });
  const json = await jsonOrThrow(res, 'Failed to load board');
  return json.items || [];
};

/**
 * Compress + upload a local photo (file:// URI or data URL) to campus media storage and
 * return the short /api/campus/media/<id> link. Already-hosted links are returned as is.
 */
export const uploadCampusImage = async (localUri: string, purpose: MediaPurpose = 'other'): Promise<string> => {
  if (/^(https?:|\/api\/)/i.test(localUri)) return localUri;
  const uploaded = await prepareAndUploadImage({ uri: localUri }, purpose);
  return uploaded.url;
};

export const createLostFoundItem = async (data: {
  type: 'lost' | 'found';
  title: string;
  description?: string;
  location: string;
  claimContact?: string;
  imageUrl?: string;
}): Promise<CampusLostFoundItem> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/lost-found`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const json = await jsonOrThrow(res, 'Failed to post item');
  return json.item;
};

export const resolveLostFoundItem = async (
  itemId: string,
  status: 'claimed' | 'resolved' = 'resolved'
): Promise<CampusLostFoundItem> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/lost-found/${itemId}/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status }),
  });
  const json = await jsonOrThrow(res, 'Failed to update item');
  return json.item;
};

// ── Phase 4: Ride Pool (smart tray) ──────────────────────────────────────────
export interface CampusRidePassenger {
  id: string;
  name: string;
}

export interface CampusRidePool {
  id: string;
  creatorId: string;
  creatorName: string;
  origin: string;
  destination: string;
  departureTime: string;
  availableSeats: number;
  totalSeats: number;
  farePerSeat: number;
  vehicleType: 'Car' | 'Auto' | 'Bike';
  status: 'open' | 'full' | 'departed' | 'cancelled';
  passengers: CampusRidePassenger[];
}

/** Open Lost & Found items and open rides, counted on the server (no board photos downloaded). */
export const fetchPulseCounts = async (): Promise<{ openLostFound: number; openRides: number }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/pulse/counts`, { headers });
  const json = await jsonOrThrow(res, 'Failed to load counts');
  return { openLostFound: Number(json.openLostFound) || 0, openRides: Number(json.openRides) || 0 };
};

export const fetchRidePools = async (): Promise<CampusRidePool[]> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/ride-pool`, { headers });
  const json = await jsonOrThrow(res, 'Failed to load rides');
  return json.rides || [];
};

export const createRidePool = async (data: {
  destination: string;
  departureTime: string;
  origin?: string;
  totalSeats?: number;
  farePerSeat?: number;
  vehicleType?: 'Car' | 'Auto' | 'Bike';
}): Promise<CampusRidePool> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/ride-pool`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const json = await jsonOrThrow(res, 'Failed to post ride');
  return json.ride;
};

export const joinRidePool = async (rideId: string): Promise<CampusRidePool> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/ride-pool/${rideId}/join`, {
    method: 'POST',
    headers,
  });
  const json = await jsonOrThrow(res, 'Failed to book seat');
  return json.ride;
};

export const leaveRidePool = async (rideId: string): Promise<CampusRidePool> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/ride-pool/${rideId}/leave`, {
    method: 'POST',
    headers,
  });
  const json = await jsonOrThrow(res, 'Failed to release seat');
  return json.ride;
};

// ── Phase 5: Proximity Rooms (location-bound live chat) ──────────────────────
export interface ProximityRoomItem {
  id: string;
  name: string;
  slug: string;
  subtitle: string;
  icon: string;
  /** Admin-set emoji for the spot card (null = show the icon). */
  emoji?: string | null;
  category: string;
  sortOrder?: number;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  activeUserCount: number;
  isNearby: boolean;
  distance: number | null;
}

export interface ProximityMessageItem {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type: string;
  createdAt: string | Date;
}

export interface ProximityRoomDetail {
  room: {
    id: string;
    name: string;
    slug: string;
    subtitle: string;
    icon: string;
    emoji?: string | null;
    category: string;
    activeUserCount: number;
  };
  messages: ProximityMessageItem[];
}

export const fetchProximityRooms = async (
  lat?: number,
  lng?: number
): Promise<ProximityRoomItem[]> => {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams();
  if (lat != null && lng != null) {
    params.set('lat', String(lat));
    params.set('lng', String(lng));
  }
  const res = await campusFetch(`${API_URL}/api/campus/proximity/rooms?${params.toString()}`, { headers });
  const json = await jsonOrThrow(res, "Couldn't load live zones.");
  return json.rooms || [];
};

export const fetchProximityRoomMessages = async (
  roomSlug: string,
  limit = 50
): Promise<ProximityRoomDetail> => {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await campusFetch(
    `${API_URL}/api/campus/proximity/rooms/${encodeURIComponent(roomSlug)}/messages?${params.toString()}`,
    { headers }
  );
  return jsonOrThrow(res, 'Failed to load room messages');
};

export const postProximityMessage = async (
  roomSlug: string,
  text: string
): Promise<ProximityMessageItem> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(
    `${API_URL}/api/campus/proximity/rooms/${encodeURIComponent(roomSlug)}/messages`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
    }
  );
  const json = await jsonOrThrow(res, 'Failed to send');
  return json.message;
};

// ── Pulse: Today on Campus, 9 PM Question, Whispers, Branch Wars ─────────────
export interface PulseToday {
  date: string;
  mess: Partial<Record<'breakfast' | 'lunch' | 'snacks' | 'dinner', string>>;
  events: {
    id: string;
    title: string;
    location?: string | null;
    category: string;
    description?: string | null;
    startsAt: string;
    endsAt?: string | null;
  }[];
}

export interface PulseAnswer {
  id: string;
  alias: string;
  answer: string;
  upvotes: number;
  iUpvoted: boolean;
  createdAt: string;
}

export interface PulseQuestion {
  question: {
    id: string;
    question: string;
    promptDate: string;
    opensAt?: string | null;
    closesAt?: string | null;
    isToday?: boolean;
    isOpen?: boolean;
  } | null;
  answers: PulseAnswer[];
  answerCount: number;
  iAnswered: boolean;
}

export interface PulseWhisper {
  id: string;
  alias: string;
  topic: string;
  text: string;
  hearts: number;
  iHearted: boolean;
  createdAt: string;
}

export interface PulseBranchStanding {
  rank: number;
  code: string;
  members: number;
  activeMembers: number;
  messagesThisWeek: number;
  points: number;
}

export const fetchPulseToday = async (): Promise<PulseToday> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/pulse/today`, { headers });
  return jsonOrThrow(res, 'Failed to load today on campus');
};

export const fetchDailyQuestion = async (): Promise<PulseQuestion> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/pulse/question`, { headers });
  return jsonOrThrow(res, 'Failed to load the daily question');
};

export const submitDailyAnswer = async (answer: string): Promise<PulseQuestion['answers'][number] & { answerCount: number }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/pulse/question/answer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ answer }),
  });
  const json = await jsonOrThrow(res, 'Failed to submit answer');
  return { ...json.answer, answerCount: json.answerCount };
};

export const upvoteDailyAnswer = async (answerId: string): Promise<{ id: string; upvotes: number; iUpvoted: boolean }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/pulse/question/answer/${answerId}/upvote`, {
    method: 'POST',
    headers,
  });
  return jsonOrThrow(res, 'Failed to upvote');
};

export const fetchWhispers = async (topic?: string): Promise<{ whispers: PulseWhisper[]; topics: string[] }> => {
  const headers = await getAuthHeaders();
  const params = topic && topic !== 'All' ? `?topic=${encodeURIComponent(topic)}` : '';
  const res = await campusFetch(`${API_URL}/api/campus/pulse/whispers${params}`, { headers });
  return jsonOrThrow(res, 'Failed to load whispers');
};

export const createWhisper = async (text: string, topic: string): Promise<PulseWhisper> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/pulse/whispers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, topic }),
  });
  const json = await jsonOrThrow(res, 'Failed to post whisper');
  return json.whisper;
};

export const reactWhisper = async (whisperId: string): Promise<{ id: string; hearts: number; iHearted: boolean }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/pulse/whispers/${whisperId}/react`, {
    method: 'POST',
    headers,
  });
  return jsonOrThrow(res, 'Failed to react');
};

export const fetchBranchWars = async (): Promise<{ standings: PulseBranchStanding[]; userBranch: string | null }> => {
  const headers = await getAuthHeaders();
  const res = await campusFetch(`${API_URL}/api/campus/pulse/branch-wars`, { headers });
  return jsonOrThrow(res, 'Failed to load branch standings');
};

