// Zenvy Campus Events tables (Ce* prefix; the old CampusEvent table belongs to "Today on Campus").
// Registered on the shared sequelize instance by config/db.js. Same schema rules as Auto-Ride:
// prod is Postgres created by sync() + addMissingColumns, so no column-level unique, every column
// nullable or defaulted, named indexes only (unique / partial unique race guards in migrations.js).
const { DataTypes } = require('sequelize');

const json = (dflt) => ({ type: DataTypes.JSON, allowNull: true, defaultValue: dflt });
const uuidPk = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
const uuid = (allowNull = true) => ({ type: DataTypes.UUID, allowNull });
const str = (n, dflt) => ({ type: DataTypes.STRING(n), allowNull: true, ...(dflt !== undefined && dflt !== null ? { defaultValue: dflt } : {}) });
const int = (dflt = null) => ({ type: DataTypes.INTEGER, allowNull: true, defaultValue: dflt });
const date = () => ({ type: DataTypes.DATE, allowNull: true });
const bool = (dflt = false) => ({ type: DataTypes.BOOLEAN, allowNull: true, defaultValue: dflt });
const text = () => ({ type: DataTypes.TEXT, allowNull: true });
const money = (dflt = 0) => ({ type: DataTypes.FLOAT, allowNull: true, defaultValue: dflt });

const initCampusEventsModels = (sequelize) => {
  if (!sequelize) return {};

  // Who may publish events: granted by an admin (students can apply). Optional link to a verified
  // FriendsEntity (club / department) the user manages. Never changes User.role.
  const CeOrganizer = sequelize.define('CeOrganizer', {
    id: uuidPk,
    userId: uuid(false),
    campusId: uuid(),
    entityId: uuid(),
    displayName: str(80, null),
    status: str(16, 'PENDING'),
    applicationNote: { type: DataTypes.STRING(1000), allowNull: true },
    proofText: { type: DataTypes.STRING(500), allowNull: true },
    reviewNote: { type: DataTypes.STRING(500), allowNull: true },
    grantedBy: uuid(),
    grantedAt: date(),
    reviewedBy: uuid(),
    reviewedAt: date(),
  }, { tableName: 'CeOrganizers', timestamps: true, indexes: [{ name: 'ce_organizer_status', fields: ['status'] }] });

  const CeEvent = sequelize.define('CeEvent', {
    id: uuidPk,
    campusId: uuid(),
    organizerUserId: uuid(false),
    organizerId: uuid(),
    entityId: uuid(),
    title: str(120, null),
    slug: str(140, null),
    category: str(20, 'OTHER'),
    tags: json([]),
    description: text(),
    posterPath: str(80, null),
    gallery: json([]),
    venue: str(160, null),
    venueDirections: str(500, null),
    venueLat: { type: DataTypes.DOUBLE, allowNull: true },
    venueLon: { type: DataTypes.DOUBLE, allowNull: true },
    startAt: date(),
    endAt: date(),
    format: str(12, 'INDIVIDUAL'),
    regOpensAt: date(),
    regClosesAt: date(),
    // INDIVIDUAL: seats; SLOT: unused (per slot); TEAM: unused (maxTeams).
    capacity: int(null),
    maxTeams: int(null),
    teamMin: int(null),
    teamMax: int(null),
    captainRequired: bool(true),
    allowSubstitutions: bool(false),
    multiTeamAllowed: bool(false),
    attendancePerMember: bool(false),
    approvalRequired: bool(false),
    maxBookingsPerStudent: int(1),
    minParticipants: int(null),
    priceType: str(8, 'FREE'),
    price: money(0),
    // [{ label, amount }] added to the price (server-computed total).
    extraCharges: json([]),
    // Modes the organizer accepts for a paid event: subset of VENUE | WALLET | ONLINE.
    paymentModes: json(['VENUE']),
    // { years: [1,2], branches: ['CSE'], adultOnly: false }
    eligibility: json({}),
    rules: text(),
    rulesVersion: int(1),
    // [{ id, label, type, required, options?, maxLength? }] max 10. Never ID numbers / phones.
    questions: json([]),
    equipment: str(1000, null),
    contactText: str(300, null),
    instructions: str(1000, null),
    // { userCancelUntilHours, refundPct, text }
    cancellationPolicy: json({}),
    entryOpensBeforeMin: int(60),
    waitlistEnabled: bool(true),
    waitlistOfferMinutes: int(null),
    status: str(20, 'DRAFT'),
    featured: bool(false),
    publishAt: date(),
    publishedAt: date(),
    submittedAt: date(),
    reviewedAt: date(),
    reviewedBy: uuid(),
    reviewNote: str(500, null),
    rejectionReason: str(500, null),
    // Material edits waiting for admin approval: { fields: {...}, requestedAt, requestedBy }
    pendingChanges: json(null),
    cancelledAt: date(),
    cancelledBy: uuid(),
    cancelReason: str(500, null),
    completedAt: date(),
    unitsLive: int(0),
    unitsConfirmed: int(0),
    waitlistCount: int(0),
    checkedInCount: int(0),
    reminder24SentAt: date(),
    reminder1SentAt: date(),
    deadlineNoticeSentAt: date(),
    retentionPurgedAt: date(),
    version: int(1),
  }, {
    tableName: 'CeEvents',
    timestamps: true,
    indexes: [
      { name: 'ce_event_campus_status_start', fields: ['campusId', 'status', 'startAt'] },
      { name: 'ce_event_organizer', fields: ['organizerUserId', 'status'] },
      { name: 'ce_event_status', fields: ['status'] },
    ],
  });

  const CeSlot = sequelize.define('CeSlot', {
    id: uuidPk,
    eventId: uuid(false),
    label: str(80, null),
    startAt: date(),
    endAt: date(),
    capacity: int(1),
    // null = the event price.
    price: { type: DataTypes.FLOAT, allowNull: true },
    status: str(12, 'OPEN'),
    unitsLive: int(0),
    unitsConfirmed: int(0),
    waitlistCount: int(0),
    reminder24SentAt: date(),
    reminder1SentAt: date(),
  }, { tableName: 'CeSlots', timestamps: true, indexes: [{ name: 'ce_slot_event_start', fields: ['eventId', 'startAt'] }] });

  const CeRegistration = sequelize.define('CeRegistration', {
    id: uuidPk,
    code: str(12, null),
    eventId: uuid(false),
    slotId: uuid(),
    teamId: uuid(),
    // slotId || eventId: the pool whose units this registration occupies.
    capacityKey: uuid(false),
    unitNo: int(null),
    type: str(12, 'INDIVIDUAL'),
    userId: uuid(false),
    status: str(20, 'HELD'),
    holdExpiresAt: date(),
    paymentExpiresAt: date(),
    offerExpiresAt: date(),
    waitlistAt: date(),
    confirmedAt: date(),
    approvedAt: date(),
    approvedBy: uuid(),
    rejectedReason: str(500, null),
    cancelledAt: date(),
    cancelledBy: str(16, null),
    cancelReason: str(500, null),
    expiredAt: date(),
    answers: json(null),
    // The event's questions as the student saw them when answering ([{ id, label, type }]), so answers keep
    // their labels after the organizer edits the form. Older rows: null (labels come from the event).
    questionsSnapshot: json(null),
    rulesAcceptedAt: date(),
    rulesVersion: int(null),
    // Price snapshot at registration (rupees): amount + extras = total. Never from the client.
    amount: money(0),
    extras: money(0),
    total: money(0),
    paymentMode: str(10, 'NONE'),
    paymentStatus: str(16, 'NONE'),
    paidAt: date(),
    paidMarkedBy: uuid(),
    walletDebited: money(0),
    refundAmount: money(0),
    refundedAt: date(),
    refundAttempts: int(0),
    idempotencyKey: str(100, null),
  }, {
    tableName: 'CeRegistrations',
    timestamps: true,
    indexes: [
      { name: 'ce_reg_event_status', fields: ['eventId', 'status'] },
      { name: 'ce_reg_user_status', fields: ['userId', 'status'] },
      { name: 'ce_reg_capacity_wait', fields: ['capacityKey', 'status', 'waitlistAt'] },
    ],
  });

  const CeTeam = sequelize.define('CeTeam', {
    id: uuidPk,
    eventId: uuid(false),
    campusId: uuid(),
    captainUserId: uuid(false),
    name: str(40, null),
    nameKey: str(40, null),
    status: str(12, 'FORMING'),
    registrationId: uuid(),
    joinTokenHash: str(64, null),
    joinTokenExpiresAt: date(),
    rosterVersion: int(1),
    submittedAt: date(),
    cancelledAt: date(),
  }, { tableName: 'CeTeams', timestamps: true, indexes: [{ name: 'ce_team_event', fields: ['eventId', 'status'] }, { name: 'ce_team_captain', fields: ['captainUserId'] }] });

  // Never deleted: the rows are the roster history (status changes + CeAuditLog).
  const CeTeamMember = sequelize.define('CeTeamMember', {
    id: uuidPk,
    teamId: uuid(false),
    eventId: uuid(false),
    userId: uuid(false),
    role: str(10, 'PLAYER'),
    status: str(10, 'INVITED'),
    via: str(8, 'INVITE'),
    invitedBy: uuid(),
    invitedAt: date(),
    respondedAt: date(),
    expiresAt: date(),
    // = eventId while ACCEPTED on an event that forbids multi-team membership, else null.
    exclusiveKey: uuid(),
  }, { tableName: 'CeTeamMembers', timestamps: true, indexes: [{ name: 'ce_member_team', fields: ['teamId', 'status'] }, { name: 'ce_member_user', fields: ['userId', 'status'] }] });

  const CeTicket = sequelize.define('CeTicket', {
    id: uuidPk,
    eventId: uuid(false),
    registrationId: uuid(false),
    slotId: uuid(),
    teamId: uuid(),
    memberId: uuid(),
    userId: uuid(),
    // 'TEAM' for the one team ticket, else the holder's user id.
    holderKey: str(40, null),
    kind: str(12, 'INDIVIDUAL'),
    ticketCode: str(12, null),
    tokenVersion: int(1),
    status: str(12, 'ACTIVE'),
    usedAt: date(),
    usedBy: uuid(),
    voidReason: str(300, null),
  }, { tableName: 'CeTickets', timestamps: true, indexes: [{ name: 'ce_ticket_event', fields: ['eventId', 'status'] }, { name: 'ce_ticket_user', fields: ['userId', 'status'] }, { name: 'ce_ticket_reg', fields: ['registrationId'] }] });

  // Every scan attempt (validate + confirm), including invalid ones.
  const CeCheckIn = sequelize.define('CeCheckIn', {
    id: uuidPk,
    eventId: uuid(),
    ticketId: uuid(),
    registrationId: uuid(),
    staffUserId: uuid(),
    action: str(10, 'VALIDATE'),
    method: str(6, 'QR'),
    result: str(16, null),
    collectedPayment: bool(false),
    at: date(),
  }, { tableName: 'CeCheckIns', timestamps: true, indexes: [{ name: 'ce_checkin_event_at', fields: ['eventId', 'at'] }, { name: 'ce_checkin_ticket', fields: ['ticketId'] }] });

  // Online payments (paise). No card data ever: only provider ids + amounts + status.
  const CePayment = sequelize.define('CePayment', {
    id: uuidPk,
    registrationId: uuid(false),
    eventId: uuid(),
    userId: uuid(),
    provider: str(10, 'RAZORPAY'),
    amountPaise: int(0),
    currency: str(3, 'INR'),
    status: str(16, 'CREATED'),
    providerOrderId: str(64, null),
    providerPaymentId: str(64, null),
    providerRefundId: str(64, null),
    refundAmountPaise: int(0),
    failureReason: str(300, null),
    capturedAt: date(),
    refundedAt: date(),
  }, { tableName: 'CePayments', timestamps: true, indexes: [{ name: 'ce_pay_reg', fields: ['registrationId'] }, { name: 'ce_pay_status', fields: ['status'] }] });

  const CeWebhookEvent = sequelize.define('CeWebhookEvent', {
    id: uuidPk,
    provider: str(10, 'RAZORPAY'),
    eventId: str(80, null),
    type: str(60, null),
    result: str(60, null),
    receivedAt: date(),
  }, { tableName: 'CeWebhookEvents', timestamps: true });

  const CeEventStaff = sequelize.define('CeEventStaff', {
    id: uuidPk,
    eventId: uuid(false),
    userId: uuid(false),
    role: str(12, 'CHECKIN'),
    status: str(10, 'ACTIVE'),
    grantedBy: uuid(),
    revokedAt: date(),
  }, { tableName: 'CeEventStaff', timestamps: true, indexes: [{ name: 'ce_staff_user', fields: ['userId', 'status'] }] });

  const CeAnnouncement = sequelize.define('CeAnnouncement', {
    id: uuidPk,
    eventId: uuid(false),
    authorUserId: uuid(),
    kind: str(16, 'UPDATE'),
    title: str(120, null),
    body: str(1500, null),
  }, { tableName: 'CeAnnouncements', timestamps: true, indexes: [{ name: 'ce_ann_event', fields: ['eventId', 'createdAt'] }] });

  // Who did what (organizer edits, approvals, cancellations, refunds, overrides, roster changes).
  const CeAuditLog = sequelize.define('CeAuditLog', {
    id: uuidPk,
    eventId: uuid(),
    teamId: uuid(),
    registrationId: uuid(),
    actorUserId: uuid(),
    actorRole: str(12, null),
    action: str(60, null),
    details: json({}),
    at: date(),
  }, { tableName: 'CeAuditLogs', timestamps: true, indexes: [{ name: 'ce_audit_event_at', fields: ['eventId', 'at'] }, { name: 'ce_audit_team', fields: ['teamId'] }] });

  return { CeOrganizer, CeEvent, CeSlot, CeRegistration, CeTeam, CeTeamMember, CeTicket, CeCheckIn, CePayment, CeWebhookEvent, CeEventStaff, CeAnnouncement, CeAuditLog };
};

module.exports = { initCampusEventsModels };
