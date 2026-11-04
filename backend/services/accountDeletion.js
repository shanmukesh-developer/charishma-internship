/**
 * Self-service account deletion (Google Play "account deletion" requirement).
 *
 * What happens:
 *   1. The User row is ANONYMISED, not dropped: orders, wallet / coin ledgers, bookings and
 *      moderation records keep a valid userId for accounting, fraud and safety, but that id no
 *      longer points at a name, phone, email, Google id, hostel / room, photo or push token.
 *      isActive=false + tokenVersion bump signs out every session at once.
 *   2. Personal and user-generated data is DELETED from every table that references the user
 *      (chat messages, direct conversations, friendships, Pulse / forum posts, comments, votes,
 *      reactions, Campus profile, verifications, lost & found, media, notifications, reviews,
 *      Connect profile / photos / swipes / matches, spaces, tasks, tickets, streaks, OTP codes...).
 *      Models are discovered at run time from the Sequelize instance, so a new table with a
 *      standard user column (userId, authorId, senderId...) is covered without editing this file.
 *   3. Kept rows that hold personal snapshots (orders, bookings) are scrubbed: delivery address,
 *      instructions, drop pin, review text and payment screenshots are cleared.
 *   4. Best effort: the Firebase Auth user for the phone number is deleted too.
 *
 * Every table is handled on its own statement (no single transaction) so one missing / legacy
 * table cannot abort the rest; the user row is anonymised FIRST so access is revoked even if a
 * later clean-up step fails. Failures are reported in the summary and logged without PII.
 */
const crypto = require('crypto');
const { Op } = require('sequelize');

// Columns that identify the account owner of a row.
const USER_COLUMNS = [
  'userId', 'senderId', 'authorId', 'ownerId', 'creatorId', 'requesterId', 'recipientId',
  'reporterId', 'renterId', 'hostId', 'passengerId', 'posterId', 'helperId', 'responderId',
  'reviewerId', 'revieweeId', 'fromUserId', 'toUserId', 'userLowId', 'userHighId', 'studentId',
  'adminId', 'actorId', 'subjectUserId', 'targetOwnerId', 'targetAuthorId', 'againstUserId',
  'winnerUserId',
];

// Columns that only LINK someone else's row to this user: cleared (if nullable), row kept.
const LINK_ONLY_COLUMNS = new Set(['helperId', 'targetAuthorId', 'targetOwnerId', 'actorId']);

// Personal snapshot fields cleared on kept rows.
const PII_FIELDS = [
  'name', 'userName', 'customerName', 'fullName', 'phone', 'customerPhone', 'contactPhone',
  'email', 'address', 'deliveryAddress', 'deliveryInstructions', 'instructions', 'note', 'notes',
  'message', 'comment', 'review', 'dropLat', 'dropLng', 'lat', 'lng', 'latitude', 'longitude',
  'upiScreenshot', 'idProof', 'photo', 'photoUrl', 'userBlock', 'hostelBlock', 'roomNumber',
];

/**
 * Rows that are KEPT (accounting, fraud prevention, safety / moderation evidence, other people's
 * bookings). `scrub: true` clears PII_FIELDS on them; `set` applies extra fixed values.
 */
const RETAIN = {
  Order: { scrub: true },
  CoinLedger: {},
  Coupon: {},
  PGBooking: { scrub: true },
  PGHostel: {},
  // ZCS PG Partner rent ledger (a record of rent the PG owner received): kept for the owner's accounts.
  PgRentRecord: { scrub: true },
  ServiceBooking: { scrub: true },
  MegaBasket: { scrub: true },
  RentalBooking: { scrub: true },
  RentalListing: { set: { status: 'DELETED' } },
  RentalReport: {},
  FriendsReport: {},
  FriendsModAction: {},
  FriendsSanction: {},
  FriendsAppeal: {},
  FriendsConsent: {},
  VerificationLog: {},
  WallEvent: {},
  Room: {}, // group rooms other people still use
};

// Handled separately (or never touched).
const SKIP = new Set(['User', 'OtpCode', 'Conversation']);

const TERMINAL_ORDER_STATUSES = ['Delivered', 'Cancelled'];
const OPEN_RENTAL_STATUSES = ['REQUESTED', 'ACCEPTED', 'ACTIVE', 'RETURNED'];
const PROTECTED_ROLES = ['admin', 'superadmin', 'restaurant', 'rider', 'delivery'];

const safeLog = (msg, err) => console.warn(`[ACCOUNT_DELETE] ${msg}:`, err && (err.parent?.code || err.name || err.message));

/** Reasons the account cannot be deleted right now (empty array = OK). */
const precheck = async (sequelize, user) => {
  const blockers = [];
  if (PROTECTED_ROLES.includes(String(user.role || '').toLowerCase())) {
    blockers.push({ code: 'STAFF_ACCOUNT', message: 'Staff and partner accounts are closed by the ZenWe team. Please contact support.' });
  }
  const { Order, RentalBooking } = sequelize.models;
  if (Order) {
    const active = await Order.count({ where: { userId: user.id, status: { [Op.notIn]: TERMINAL_ORDER_STATUSES } } }).catch(() => 0);
    if (active > 0) blockers.push({ code: 'ACTIVE_ORDERS', message: `You have ${active} order${active === 1 ? '' : 's'} in progress. Please wait until ${active === 1 ? 'it is' : 'they are'} delivered or cancelled.` });
  }
  if (RentalBooking) {
    const open = await RentalBooking.count({
      where: { status: OPEN_RENTAL_STATUSES, [Op.or]: [{ renterId: user.id }, { ownerId: user.id }] }
    }).catch(() => 0);
    if (open > 0) blockers.push({ code: 'ACTIVE_RENTALS', message: 'You have a vehicle rental or borrowing in progress. Please finish or cancel it first.' });
  }
  return blockers;
};

const scrubValues = (Model, extra = {}) => {
  const values = { ...extra };
  for (const f of PII_FIELDS) {
    const attr = Model.rawAttributes[f];
    if (!attr) continue;
    if (attr.allowNull !== false) values[f] = null;
    else if (/STRING|TEXT|CHAR/i.test(String(attr.type && attr.type.key))) values[f] = 'deleted';
  }
  return values;
};

/** Removes the user from conversations: direct chats are deleted (with their messages), groups just drop them. */
const purgeConversations = async (sequelize, userId, summary) => {
  const { Conversation, Message } = sequelize.models;
  if (!Conversation) return;
  try {
    const convs = await Conversation.findAll({ where: { participants: { [Op.like]: `%${userId}%` } } });
    for (const c of convs) {
      const parts = Array.isArray(c.participants) ? c.participants.map(String) : [];
      if (!parts.includes(String(userId))) continue;
      const remaining = parts.filter((p) => p !== String(userId));
      if (!c.isGroup || remaining.length < 2) {
        if (Message) await Message.destroy({ where: { conversationId: c.id } });
        await c.destroy();
        summary.deleted.Conversation = (summary.deleted.Conversation || 0) + 1;
      } else {
        c.participants = remaining;
        await c.save();
        summary.updated.Conversation = (summary.updated.Conversation || 0) + 1;
      }
    }
  } catch (err) {
    safeLog('conversations failed', err);
    summary.failed.push('Conversation');
  }
};

const purgeTables = async (sequelize, userId, summary) => {
  let pending = [];
  for (const Model of Object.values(sequelize.models)) {
    if (SKIP.has(Model.name)) continue;
    const cols = USER_COLUMNS.filter((c) => Model.rawAttributes[c]);
    if (!cols.length) continue;
    pending.push({ Model, cols });
  }

  // Up to 3 passes: a child table with a foreign key may need its parent removed first (or after).
  for (let pass = 0; pass < 3 && pending.length; pass += 1) {
    const retry = [];
    for (const job of pending) {
      const { Model, cols } = job;
      const name = Model.name;
      try {
        const retain = RETAIN[name];
        if (retain) {
          if (retain.scrub || retain.set) {
            const values = retain.scrub ? scrubValues(Model, retain.set) : { ...retain.set };
            const ownerCols = cols.filter((c) => !LINK_ONLY_COLUMNS.has(c));
            if (Object.keys(values).length && ownerCols.length) {
              const [n] = await Model.update(values, { where: { [Op.or]: ownerCols.map((c) => ({ [c]: userId })) }, hooks: false, validate: false });
              if (n) summary.updated[name] = (summary.updated[name] || 0) + n;
            }
          }
          continue;
        }
        const destroyCols = cols.filter((c) => !LINK_ONLY_COLUMNS.has(c));
        const linkCols = cols.filter((c) => LINK_ONLY_COLUMNS.has(c) && Model.rawAttributes[c].allowNull !== false);
        if (destroyCols.length) {
          const n = await Model.destroy({ where: { [Op.or]: destroyCols.map((c) => ({ [c]: userId })) }, force: true, hooks: false });
          if (n) summary.deleted[name] = (summary.deleted[name] || 0) + n;
        }
        for (const c of linkCols) {
          const [n] = await Model.update({ [c]: null }, { where: { [c]: userId }, hooks: false, validate: false });
          if (n) summary.updated[name] = (summary.updated[name] || 0) + n;
        }
      } catch (err) {
        // A table that was never created on this database is not an error.
        const missing = /no such table|does not exist|undefined_table|42P01/i.test(String(err && (err.message || '') + (err.parent?.code || '')));
        if (!missing) retry.push({ ...job, err });
      }
    }
    pending = retry;
  }
  for (const job of pending) {
    safeLog(`table ${job.Model.name} failed`, job.err);
    summary.failed.push(job.Model.name);
  }
};

/**
 * Deletes / anonymises an account. `user` is a User model instance.
 * Resolves { ok: true, summary } or { ok: false, status, body } for blockers.
 */
const deleteAccount = async ({ sequelize, user, reason = null }) => {
  const blockers = await precheck(sequelize, user);
  if (blockers.length) {
    return { ok: false, status: 409, body: { code: blockers[0].code, message: blockers[0].message, blockers } };
  }

  const userId = user.id;
  const phone = user.phone;
  const summary = { deleted: {}, updated: {}, failed: [] };

  // 1. Anonymise the account row FIRST (revokes access even if a later step fails).
  const tag = String(userId).replace(/-/g, '').slice(0, 16);
  const User = user.constructor;
  const anon = {
    name: 'Deleted user',
    email: null,
    googleId: null,
    phone: `deleted_${tag}`,
    password: crypto.randomBytes(32).toString('base64url'),
    hostelBlock: null,
    roomNumber: null,
    address: null,
    profileImage: null,
    fcmTokens: [],
    referralCode: null,
    referredBy: null,
    friendCode: null,
    statusText: null,
    statusEmoji: null,
    about: null,
    statusSeenBy: [],
    gender: 'Prefer not to say',
    role: 'deleted', // people search / lists filter on role 'student', so the row drops out of them
    isActive: false,
    tokenVersion: (Number(user.tokenVersion) || 0) + 1,
  };
  for (const key of Object.keys(anon)) {
    if (!User.rawAttributes[key]) delete anon[key];
  }
  // Individual hooks run so the password is hashed (an unknown random secret).
  await user.update(anon);

  // Sessions / sockets / auth cache drop immediately.
  try { require('../middleware/authMiddleware').clearCachedUser(userId); } catch { /* optional */ }
  try { require('../utils/realtime').disconnectRevokedSockets(userId, null); } catch { /* optional */ }

  // 2. Conversations, then every table with a user column.
  await purgeConversations(sequelize, userId, summary);
  await purgeTables(sequelize, userId, summary);

  // 3. Login codes for the old number.
  const { OtpCode } = sequelize.models;
  if (OtpCode && phone) {
    try { await OtpCode.destroy({ where: { phone } }); } catch (err) { safeLog('otp codes failed', err); }
  }

  // 4. Firebase Auth user for the phone (best effort; the account is already closed).
  if (phone && /^\d{10}$/.test(String(phone)) && process.env.ACCOUNT_DELETE_SKIP_FIREBASE !== '1') {
    try {
      const { getAuth } = require('firebase-admin/auth');
      const fbUser = await getAuth().getUserByPhoneNumber(`+91${phone}`);
      if (fbUser) await getAuth().deleteUser(fbUser.uid);
      summary.firebase = 'deleted';
    } catch (err) {
      summary.firebase = err && err.code === 'auth/user-not-found' ? 'none' : 'skipped';
    }
  }

  console.log(`[ACCOUNT_DELETE] account ${tag} closed${reason ? ' (reason given)' : ''}; tables cleaned: ${Object.keys(summary.deleted).length}; failed: ${summary.failed.join(',') || 'none'}`);
  return { ok: true, summary };
};

module.exports = { deleteAccount, precheck, USER_COLUMNS, RETAIN };
