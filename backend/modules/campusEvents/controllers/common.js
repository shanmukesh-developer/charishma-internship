// Shared lookups for the Campus Events controllers.
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, isUuid } = require('../services/util');

const M = () => ({
  Event: getModel('CeEvent'), Slot: getModel('CeSlot'), Reg: getModel('CeRegistration'), Team: getModel('CeTeam'), Member: getModel('CeTeamMember'),
  Ticket: getModel('CeTicket'), CheckIn: getModel('CeCheckIn'), Payment: getModel('CePayment'), Webhook: getModel('CeWebhookEvent'),
  Staff: getModel('CeEventStaff'), Announcement: getModel('CeAnnouncement'), Audit: getModel('CeAuditLog'), Organizer: getModel('CeOrganizer'),
});

const User = () => require('../../../models/User').getUserModel();
const Entity = () => getModel('FriendsEntity') || (require('../index').getSequelize() && require('../index').getSequelize().models.FriendsEntity) || null;

const byIds = async (Model, ids, attributes) => {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!Model || !list.length) return new Map();
  const rows = await Model.findAll({ where: { id: { [Op.in]: list } }, ...(attributes ? { attributes } : {}) });
  return new Map(rows.map((r) => [String(r.id), r]));
};
const usersById = (ids) => byIds(User(), ids, ['id', 'name', 'profileImage']);

const loadEvent = async (id) => {
  if (!isUuid(String(id || ''))) throw fail(404, 'NOT_FOUND', 'This event was not found.');
  const ev = await M().Event.findByPk(id);
  if (!ev) throw fail(404, 'NOT_FOUND', 'This event was not found.');
  return ev;
};

/** Organizer rows + verified entities for a list of events (card organizer block). */
const organizerContext = async (events) => {
  const { Organizer } = M();
  const orgs = await byIds(Organizer, events.map((e) => e.organizerId));
  const ent = Entity();
  const ents = ent ? await byIds(ent, events.map((e) => e.entityId), ['id', 'name', 'type', 'verified']) : new Map();
  return (ev) => ({ org: orgs.get(String(ev.organizerId)) || null, entity: ents.get(String(ev.entityId)) || null });
};

/** Free-slot counts for SLOT events (number of open future slots with a place left). */
const slotsLeftFor = async (events) => {
  const ids = events.filter((e) => e.format === E.FORMAT.SLOT).map((e) => e.id);
  const out = new Map();
  if (!ids.length) return out;
  const { Slot } = M();
  const now = require('../services/clock').now();
  const slots = await Slot.findAll({ where: { eventId: { [Op.in]: ids }, status: 'OPEN', startAt: { [Op.gt]: now } }, attributes: ['eventId', 'capacity', 'unitsLive'] });
  for (const id of ids) out.set(String(id), 0);
  for (const s of slots) if ((Number(s.capacity) || 0) > (Number(s.unitsLive) || 0)) out.set(String(s.eventId), out.get(String(s.eventId)) + 1);
  return out;
};

/** S1: does this user hold ACTIVE organizer access (CeOrganizer row)? */
const activeOrganizer = async (userId) => {
  const o = await M().Organizer.findOne({ where: { userId }, attributes: ['id', 'status'] });
  return !!o && o.status === E.ORGANIZER_STATUS.ACTIVE;
};

/** Is this user the organizer of the event, an admin, or active staff for it? */
const staffRole = async (user, event) => {
  if (!user) return null;
  if (String(user.role || '').toLowerCase() === 'admin') return 'admin';
  // S1: the event's organizer counts only while their CeOrganizer access is ACTIVE (a suspended / revoked
  // organizer keeps no gate rights; an explicit staff grant for the event still applies below).
  if (String(event.organizerUserId) === String(user.id) && await activeOrganizer(user.id)) return 'organizer';
  const s =await M().Staff.findOne({ where: { eventId: event.id, userId: user.id, status: E.STAFF_STATUS.ACTIVE }, attributes: ['id'] });
  return s ? 'staff' : null;
};

module.exports = { M, User, Entity, byIds, usersById, loadEvent, organizerContext, slotsLeftFor, staffRole, activeOrganizer };
