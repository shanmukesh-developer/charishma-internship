// Shared access checks for campus group features (classwork, announcements, polls).
const { getConversationModel } = require('../../models/Conversation');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEACHING_ROLES = ['faculty', 'cr', 'club_admin'];

class AccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isPlatformAdmin = (user) => String(user?.role || '').toLowerCase() === 'admin';

/**
 * Loads the conversation and checks that the user is a participant (platform admins pass).
 * @returns {Promise<{ conversation, isGroupAdmin: boolean }>}
 * @throws {AccessError} 404 when the chat does not exist, 403 when the user is not a member.
 */
const requireMember = async (conversationId, user) => {
  if (!UUID_PATTERN.test(String(conversationId || ''))) throw new AccessError(404, 'Class or group not found');
  const conversation = await getConversationModel().findByPk(conversationId);
  if (!conversation) throw new AccessError(404, 'Class or group not found');
  const isMember = (conversation.participants || []).includes(user.id);
  if (!isMember && !isPlatformAdmin(user)) throw new AccessError(403, 'You are not a member of this class or group');
  // Linked chats (Connect match / Friends task) follow the same rules as chat:join: an ended match or a
  // replaced helper loses access here too. Plain classes and groups are unaffected.
  if (conversation.refType && !isPlatformAdmin(user)) {
    const { conversationGuard } = require('../friends/guards');
    const guard = await conversationGuard(conversation, user.id, 'join');
    if (!guard.ok) throw new AccessError(403, guard.error || 'This chat is not available');
  }
  const isGroupAdmin = (conversation.adminIds || []).includes(user.id) || isPlatformAdmin(user);
  return { conversation, isGroupAdmin };
};

/**
 * Members who may post classwork / announcements: group admins, platform admins, or students
 * whose campus profile carries a faculty / CR / club-admin role.
 */
const requireTeachingMember = async (conversationId, user) => {
  const access = await requireMember(conversationId, user);
  if (access.isGroupAdmin) return access;
  try {
    const { getCampusProfileModel } = require('./models/CampusProfile');
    const profile = await getCampusProfileModel().findOne({ where: { userId: user.id } });
    const roles = Array.isArray(profile?.roles) ? profile.roles : [];
    if (roles.some((r) => TEACHING_ROLES.includes(String(r).toLowerCase()))) return access;
  } catch { /* fall through to the refusal */ }
  throw new AccessError(403, 'Only the class admin, faculty or CR can post here');
};

/** Sends an AccessError as JSON; returns false for any other error so the caller can handle it. */
const sendAccessError = (res, err) => {
  if (!(err instanceof AccessError)) return false;
  res.status(err.status).json({ message: err.message });
  return true;
};

module.exports = { requireMember, requireTeachingMember, sendAccessError, AccessError };
