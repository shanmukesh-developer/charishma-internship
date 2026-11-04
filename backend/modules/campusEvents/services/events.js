// Event lifecycle shared by organizers and admins:
//   DRAFT -> SUBMITTED -> (admin) PUBLISHED | APPROVED (waits for publishAt) | REJECTED | CHANGES_REQUESTED
//   PUBLISHED <-> UNPUBLISHED (admin), -> CANCELLED (organizer / admin: tickets cancelled, refunds, notices),
//   -> COMPLETED (lifecycle job after endAt).
// Edits: drafts change freely; on a live event cosmetic fields apply at once and material fields wait in
// pendingChanges for an admin (applyMaterial). Capacity can never go below the places already taken.
const { Op } = require('sequelize');
const { getModel } = require('../index');
const E = require('../enums');
const { fail, money, sameValue } = require('./util');
const clock = require('./clock');
const cap = require('./capacity');
const media = require('./media');
const V = require('./validate');
const flag = require('./flag');
const audit = require('./audit');
const notify = require('./notify');
const outcomes = require('./outcomes');

const ES = E.EVENT_STATUS;
const N = E.NOTIFY;
const M = () => ({ Event: getModel('CeEvent'), Slot: getModel('CeSlot'), Reg: getModel('CeRegistration'), Team: getModel('CeTeam'), Member: getModel('CeTeamMember') });

const slugify = (title) => `${String(title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'event'}-${Math.random().toString(36).slice(2, 8)}`;

/** Cleaned fields from a create / edit body incl. checked poster + gallery paths. */
const cleanFields = async (userId, body, current, { isAdmin = false } = {}) => {
  const s = await flag.readSettings();
  const fields = V.cleanEventInput(body, s);
  const b = body || {};
  const keep = current ? [current.posterPath, ...(Array.isArray(current.gallery) ? current.gallery : [])].filter(Boolean) : [];
  if (Object.prototype.hasOwnProperty.call(b, 'posterUrl') || Object.prototype.hasOwnProperty.call(b, 'posterPath')) {
    const ref = b.posterPath !== undefined ? b.posterPath : b.posterUrl;
    const [p] = ref ? (isAdmin ? [media.toPath(ref)] : await media.checkPosters(userId, [ref], { field: 'posterUrl', max: 1, keep })) : [null];
    fields.posterPath = p || null;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'gallery')) {
    fields.gallery = isAdmin ? (Array.isArray(b.gallery) ? b.gallery.map(media.toPath).filter(Boolean).slice(0, E.LIMITS.GALLERY) : []) : await media.checkPosters(userId, b.gallery, { field: 'gallery', max: E.LIMITS.GALLERY, keep });
  }
  return fields;
};

const merged = (ev, fields) => ({ ...(ev.get ? ev.get({ plain: true }) : ev), ...fields });

/** Capacity / team-size changes can never cut below what is already taken (inside t). */
const assertCapacityChange = async (ev, fields, t) => {
  if (fields.capacity !== undefined && ev.format !== E.FORMAT.TEAM && ev.format !== E.FORMAT.SLOT && fields.capacity !== null && fields.capacity < (Number(ev.unitsLive) || 0)) {
    throw fail(409, 'CAPACITY_BELOW_TAKEN', `Capacity cannot be less than the ${ev.unitsLive} places already taken.`, { field: 'capacity', taken: ev.unitsLive });
  }
  if (fields.maxTeams !== undefined && ev.format === E.FORMAT.TEAM && fields.maxTeams < (Number(ev.unitsLive) || 0)) {
    throw fail(409, 'CAPACITY_BELOW_TAKEN', `Team places cannot be less than the ${ev.unitsLive} teams already registered.`, { field: 'maxTeams', taken: ev.unitsLive });
  }
  if (fields.teamMax !== undefined && ev.format === E.FORMAT.TEAM) {
    const teams = await M().Team.findAll({ where: { eventId: ev.id, status: { [Op.ne]: E.TEAM_STATUS.CANCELLED } }, attributes: ['id'], transaction: t });
    for (const tm of teams) {
      const n = await M().Member.count({ where: { teamId: tm.id, status: E.MEMBER_STATUS.ACCEPTED }, transaction: t });
      if (n > fields.teamMax) throw fail(409, 'TEAM_SIZE_BELOW_ROSTER', `A team already has ${n} players; the maximum cannot be lower.`, { field: 'teamMax' });
    }
  }
  if (fields.format !== undefined && fields.format !== ev.format && (Number(ev.unitsLive) || 0) + (Number(ev.waitlistCount) || 0) > 0) {
    throw fail(409, 'HAS_REGISTRATIONS', 'The format cannot change once people registered.', { field: 'format' });
  }
};

/**
 * Applies material fields to a live event inside its lock (admin edit / approved pendingChanges):
 * capacity checks, rulesVersion bump, waitlist promotion on more capacity, notices for venue / schedule.
 */
const applyMaterial = async (req, eventId, fields, { action = 'event.edit' } = {}) => {
  const before = {};
  const out = await cap.inLock(eventId, async (t, ev) => {
    await assertCapacityChange(ev, fields, t);
    const next = merged(ev, fields);
    V.checkEventShape(next);
    for (const k of Object.keys(fields)) before[k] = ev[k];
    const changes = { ...fields, version: (Number(ev.version) || 1) + 1 };
    if (fields.rules !== undefined && String(fields.rules || '') !== String(ev.rules || '')) changes.rulesVersion = (Number(ev.rulesVersion) || 1) + 1;
    await ev.update(changes, { transaction: t });
    const promoted = ev.format !== E.FORMAT.SLOT ? await cap.promote(ev, ev.id, t) : [];
    await audit.fromReq(req, { eventId: ev.id, action, details: { fields: Object.keys(fields) } }, t);
    return { promoted };
  });
  outcomes.promoted(out.promoted, out.event);
  const ev = out.event;
  const venueChanged = fields.venue !== undefined && String(fields.venue || '') !== String(before.venue || '');
  const timeChanged = ['startAt', 'endAt'].some((k) => fields[k] !== undefined && new Date(fields[k]).getTime() !== new Date(before[k]).getTime());
  if (venueChanged) notify.eventBroadcast(ev, { title: 'Venue changed 📍', body: `${ev.title} is now at ${ev.venue}.`, type: N.VENUE_CHANGED, dedupe: `v${ev.version}` });
  if (timeChanged) notify.eventBroadcast(ev, { title: 'Schedule changed 🕒', body: `${ev.title} has a new time. Open the event for details.`, type: N.SCHEDULE_CHANGED, dedupe: `s${ev.version}` });
  if (!venueChanged && !timeChanged) notify.eventChanged(ev.id);
  return ev;
};

/** Organizer edit (status rules above). Returns { event, pending: [fields] }. */
const organizerEdit = async (req, ev0, body) => {
  const fields = await cleanFields(req.user.id, body, ev0);
  if (!Object.keys(fields).length) return { event: ev0, pending: [] };
  if (E.EDITABLE_EVENT_STATUSES.includes(ev0.status)) {
    const next = merged(ev0, fields);
    V.checkEventShape(next);
    const changes = { ...fields, version: (Number(ev0.version) || 1) + 1 };
    if (fields.rules !== undefined && String(fields.rules || '') !== String(ev0.rules || '')) changes.rulesVersion = (Number(ev0.rulesVersion) || 1) + 1;
    if (fields.title) changes.slug = slugify(fields.title);
    await ev0.update(changes);
    await audit.fromReq(req, { eventId: ev0.id, action: 'event.edit_draft', details: { fields: Object.keys(fields) } }, null, 'organizer');
    return { event: ev0, pending: [] };
  }
  if (ev0.status === ES.SUBMITTED) throw fail(409, 'EVENT_UNDER_REVIEW', 'This event is with the ZenWe team for review. Withdraw it to edit.');
  if (![ES.APPROVED, ES.PUBLISHED, ES.UNPUBLISHED].includes(ev0.status)) throw fail(409, 'EVENT_CLOSED', 'This event can no longer be edited.');
  const cosmetic = {};
  const material = {};
  // Only real changes count: a form that re-sends every field must not queue unchanged ones for review.
  // A material field set back to its live value drops out of any earlier pending request.
  const reverted = [];
  for (const [k, v] of Object.entries(fields)) {
    if (sameValue(v, ev0[k])) { if (!E.COSMETIC_FIELDS.includes(k)) reverted.push(k); continue; }
    (E.COSMETIC_FIELDS.includes(k) ? cosmetic : material)[k] = v;
  }
  const prevFields = ev0.pendingChanges && ev0.pendingChanges.fields ? ev0.pendingChanges.fields : null;
  const dropped = prevFields ? reverted.filter((k) => Object.prototype.hasOwnProperty.call(prevFields, k)) : [];
  if (dropped.length && !Object.keys(material).length) {
    const rest = { ...prevFields };
    for (const k of dropped) delete rest[k];
    await ev0.update({ pendingChanges: Object.keys(rest).length ? { ...ev0.pendingChanges, fields: rest } : null });
    await audit.fromReq(req, { eventId: ev0.id, action: 'event.request_changes_revert', details: { fields: dropped } }, null, 'organizer');
    notify.admin('updated', ev0.id);
  }
  if (Object.keys(cosmetic).length) {
    await ev0.update({ ...cosmetic, version: (Number(ev0.version) || 1) + 1 });
    await audit.fromReq(req, { eventId: ev0.id, action: 'event.edit_live', details: { fields: Object.keys(cosmetic) } }, null, 'organizer');
    notify.eventChanged(ev0.id);
  }
  if (Object.keys(material).length) {
    if (material.format !== undefined && material.format !== ev0.format) throw fail(409, 'HAS_REGISTRATIONS', 'The format of a published event cannot change.', { field: 'format' });
    await cap.inLock(ev0.id, async (t, ev) => { await assertCapacityChange(ev, material, t); return {}; });
    V.checkEventShape(merged(ev0, material));
    const prev = { ...(prevFields || {}) };
    for (const k of dropped) delete prev[k];
    const pendingChanges = { fields: { ...prev, ...serializable(material) }, requestedAt: clock.now().toISOString(), requestedBy: String(req.user.id) };
    await ev0.update({ pendingChanges });
    await audit.fromReq(req, { eventId: ev0.id, action: 'event.request_changes', details: { fields: Object.keys(material) } }, null, 'organizer');
    notify.admin('updated', ev0.id);
  }
  return { event: ev0, pending: Object.keys(material) };
};

const serializable = (o) => JSON.parse(JSON.stringify(o));
/** pendingChanges.fields (JSON) back to model values. */
const revive = (fields) => {
  const out = { ...(fields || {}) };
  for (const k of ['startAt', 'endAt', 'regOpensAt', 'regClosesAt', 'publishAt']) if (out[k]) out[k] = new Date(out[k]);
  return out;
};

const submit = async (req, ev) => {
  await flag.assertOn();
  if (!E.EDITABLE_EVENT_STATUSES.includes(ev.status)) {
    if (ev.status === ES.SUBMITTED) return ev;
    throw fail(409, 'NOT_SUBMITTABLE', 'Only drafts can be submitted for review.', { status: ev.status });
  }
  V.checkEventShape(ev.get({ plain: true }), { forSubmit: true });
  if (new Date(ev.startAt).getTime() <= clock.nowMs()) throw fail(400, 'INVALID_INPUT', 'The event must start in the future.', { field: 'startAt' });
  const s = await flag.readSettings();
  if (money(ev.price) > s.maxPrice) throw fail(400, 'INVALID_INPUT', `The price can be at most ₹${s.maxPrice}.`, { field: 'price' });
  if (ev.format === E.FORMAT.SLOT) {
    const n = await M().Slot.count({ where: { eventId: ev.id, status: 'OPEN' } });
    if (!n) throw fail(400, 'INCOMPLETE', 'Add at least one slot before submitting.', { field: 'slots' });
  }
  await ev.update({ status: ES.SUBMITTED, submittedAt: clock.now(), reviewNote: null, rejectionReason: null });
  await audit.fromReq(req, { eventId: ev.id, action: 'event.submit', details: {} }, null, 'organizer');
  notify.admin('created', ev.id);
  return ev;
};

/** Cancels an event: every open registration ended (100 % refund), tickets cancelled, teams closed, notices. */
const cancelEvent = async (req, eventId, { by, reason }) => {
  if (!reason || String(reason).trim().length < 3) throw fail(400, 'INVALID_INPUT', 'Give a reason for the cancellation (students see it).', { field: 'reason' });
  const why = String(reason).trim().slice(0, 500);
  let recipients = [];
  const out = await cap.inLock(eventId, async (t, ev) => {
    if ([ES.CANCELLED, ES.COMPLETED].includes(ev.status)) throw fail(409, 'EVENT_CLOSED', 'This event is already closed.', { status: ev.status });
    const wasPublic = [ES.PUBLISHED, ES.UNPUBLISHED, ES.APPROVED].includes(ev.status);
    recipients = wasPublic ? await notify.registrantIds(ev.id) : [];
    await ev.update({ status: ES.CANCELLED, cancelledAt: clock.now(), cancelledBy: req && req.user ? req.user.id : null, cancelReason: why }, { transaction: t });
    const open = await M().Reg.findAll({ where: { eventId: ev.id, status: { [Op.in]: E.OPEN_REG_STATUSES } }, transaction: t });
    const ended = [];
    for (const reg of open) ended.push((await cap.endRegistration(t, ev, reg, { by, reason: `Event cancelled: ${why}`, pct: 100 })).reg);
    const teams = await M().Team.findAll({ where: { eventId: ev.id, status: { [Op.ne]: E.TEAM_STATUS.CANCELLED } }, attributes: ['id'], transaction: t });
    if (teams.length) {
      const ids = teams.map((x) => x.id);
      await M().Team.update({ status: E.TEAM_STATUS.CANCELLED, cancelledAt: clock.now(), joinTokenHash: null }, { where: { id: { [Op.in]: ids } }, transaction: t });
      await M().Member.update({ exclusiveKey: null }, { where: { teamId: { [Op.in]: ids } }, transaction: t });
      await M().Member.update({ status: E.MEMBER_STATUS.REVOKED }, { where: { teamId: { [Op.in]: ids }, status: E.MEMBER_STATUS.INVITED }, transaction: t });
    }
    await audit.fromReq(req, { eventId: ev.id, action: 'event.cancel', details: { by, reason: why, registrations: ended.length } }, t, by);
    return { ended };
  });
  for (const reg of out.ended) if (reg.paymentStatus === E.PAYMENT_STATUS.REFUND_PENDING) outcomes.refundNow(reg);
  if (recipients.length) notify.toUsers(recipients, 'Event cancelled', `${out.event.title} was cancelled: ${why.slice(0, 120)}`, { type: N.EVENT_CANCELLED, eventId: out.event.id });
  if (by !== 'organizer') notify.toOrganizer(out.event, 'Your event was cancelled', `${out.event.title} was cancelled by ZenWe: ${why.slice(0, 120)}`, N.EVENT_CANCELLED);
  notify.eventChanged(out.event.id);
  return out.event;
};

/** Cancels one slot (organizer / admin): its open registrations end with a full refund. */
const cancelSlot = async (req, eventId, slotId, { by, reason }) => {
  let recipients = [];
  const out = await cap.inLock(eventId, async (t, ev) => {
    const slot = await M().Slot.findByPk(slotId, { transaction: t });
    if (!slot || String(slot.eventId) !== String(ev.id)) throw fail(404, 'NOT_FOUND', 'This slot was not found.');
    if (slot.status === 'CANCELLED') return { ended: [], slot };
    recipients = await notify.registrantIds(ev.id, { slotId: slot.id });
    await slot.update({ status: 'CANCELLED' }, { transaction: t });
    const open = await M().Reg.findAll({ where: { capacityKey: slot.id, status: { [Op.in]: E.OPEN_REG_STATUSES } }, transaction: t });
    const ended = [];
    for (const reg of open) ended.push((await cap.endRegistration(t, ev, reg, { by, reason: reason || 'Slot cancelled', pct: 100 })).reg);
    await audit.fromReq(req, { eventId: ev.id, action: 'slot.cancel', details: { slotId: slot.id, registrations: ended.length } }, t, by);
    return { ended, slot };
  });
  for (const reg of out.ended) if (reg.paymentStatus === E.PAYMENT_STATUS.REFUND_PENDING) outcomes.refundNow(reg);
  if (recipients.length) notify.toUsers(recipients, 'Slot cancelled', `A slot of ${out.event.title} was cancelled${reason ? `: ${String(reason).slice(0, 100)}` : '.'} Your booking was cancelled and any payment refunded.`, { type: N.SLOT_CHANGED, eventId: out.event.id, slotId: out.slot.id });
  return out.slot;
};

// ── S1: slot changes on a live event (APPROVED / PUBLISHED / UNPUBLISHED) wait for an admin ──────────────
// New slots are stored as status PENDING (not bookable) and listed, with time / capacity / price edits of
// OPEN slots, in pendingChanges.fields.slotChanges, so they show in the admin Review queue next to the event
// fields. Approve -> applySlotChanges (re-checked in the event lock); reject -> pending slots REJECTED.
const SLOT_MATERIAL = ['startAt', 'endAt', 'capacity', 'price'];

/** Appends one slot change to the event's pendingChanges (edits of the same slot replace each other). */
const queueSlotChange = async (req, eventId, entry) => cap.inLock(eventId, async (t, ev) => {
  const pc = ev.pendingChanges && typeof ev.pendingChanges === 'object' ? ev.pendingChanges : null;
  const fields = { ...((pc && pc.fields) || {}) };
  let list = Array.isArray(fields.slotChanges) ? fields.slotChanges.slice() : [];
  if (entry.op === 'edit') {
    const add = list.find((c) => c.op === 'add' && c.slotId === entry.slotId);
    if (add) Object.assign(add, entry.changes);
    else list = [...list.filter((c) => !(c.op === 'edit' && c.slotId === entry.slotId)), entry];
  } else list.push(entry);
  fields.slotChanges = serializable(list.slice(-200));
  await ev.update({ pendingChanges: { ...(pc || {}), fields, requestedAt: clock.now().toISOString(), requestedBy: String(req.user.id) } }, { transaction: t });
  await audit.fromReq(req, { eventId: ev.id, action: 'slot.request_changes', details: { op: entry.op, slotId: entry.slotId } }, t, 'organizer');
  return {};
});

/** Applies approved slot changes inside the event lock (capacity / bookings / maxPrice re-checked). */
const applySlotChanges = async (req, eventId, list) => {
  const s = await flag.readSettings();
  const timeChanged = [];
  const out = await cap.inLock(eventId, async (t, ev) => {
    const promoted = [];
    let applied = 0;
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || !c.slotId) continue;
      const slot = await M().Slot.findByPk(String(c.slotId), { transaction: t });
      if (!slot || String(slot.eventId) !== String(ev.id)) continue;
      if (c.op === 'add') {
        if (slot.status !== 'PENDING') continue;
        if (slot.price !== null && slot.price !== undefined && money(slot.price) > s.maxPrice) throw fail(400, 'INVALID_INPUT', `A slot price can be at most ₹${s.maxPrice}.`, { field: 'price' });
        await slot.update({ status: 'OPEN' }, { transaction: t });
        applied++;
      } else if (c.op === 'edit') {
        if (slot.status !== 'OPEN') continue;
        const changes = {};
        for (const k of SLOT_MATERIAL) if (c.changes && Object.prototype.hasOwnProperty.call(c.changes, k)) changes[k] = ['startAt', 'endAt'].includes(k) ? new Date(c.changes[k]) : c.changes[k];
        const taken = Number(slot.unitsLive) || 0;
        if (changes.capacity !== undefined && changes.capacity < taken) throw fail(409, 'CAPACITY_BELOW_TAKEN', `A slot already has ${taken} bookings.`, { field: 'capacity' });
        if (changes.price !== undefined && taken + (Number(slot.waitlistCount) || 0) > 0) throw fail(409, 'HAS_REGISTRATIONS', 'The price of a slot with bookings cannot change.', { field: 'price' });
        if (changes.price !== undefined && changes.price !== null && money(changes.price) > s.maxPrice) throw fail(400, 'INVALID_INPUT', `A slot price can be at most ₹${s.maxPrice}.`, { field: 'price' });
        const start = changes.startAt || slot.startAt;
        const end = changes.endAt || slot.endAt;
        if (new Date(end).getTime() <= new Date(start).getTime()) throw fail(400, 'INVALID_INPUT', 'A slot must end after it starts.', { field: 'endAt' });
        if (['startAt', 'endAt'].some((k) => changes[k] && changes[k].getTime() !== new Date(slot[k]).getTime())) timeChanged.push(slot.id);
        await slot.update(changes, { transaction: t });
        promoted.push(...(await cap.promote(ev, slot.id, t)));
        applied++;
      }
    }
    await audit.fromReq(req, { eventId: ev.id, action: 'slot.changes_apply', details: { applied } }, t);
    return { promoted, applied };
  });
  outcomes.promoted(out.promoted, out.event);
  for (const id of timeChanged) notify.eventBroadcast(out.event, { title: 'Slot time changed 🕒', body: `Your slot for ${out.event.title} has a new time. Open your booking for details.`, type: N.SLOT_CHANGED, slotId: id, dedupe: `a${clock.nowMs()}` });
  if (out.applied && !timeChanged.length) notify.eventChanged(out.event.id);
  return out;
};

/** Rejected changes: slots that were waiting are closed (never bookable). */
const rejectPendingSlots = async (eventId) => M().Slot.update({ status: 'REJECTED' }, { where: { eventId, status: 'PENDING' } });

module.exports = { cleanFields, organizerEdit, applyMaterial, submit, cancelEvent, cancelSlot, revive, slugify, assertCapacityChange, merged, queueSlotChange, applySlotChanges, rejectPendingSlots, SLOT_MATERIAL };
