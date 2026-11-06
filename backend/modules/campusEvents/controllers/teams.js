// Team registration (/api/campus-events): captain creates a team, invites verified students of the same
// campus (or shares a hashed join link), members accept / decline, the captain submits under the event
// lock (size + eligibility re-checked, one team place taken: two captains racing for the last place ->
// one 201, the other 409 / waitlist). Substitutions after submit only when the organizer allows them;
// every roster change bumps rosterVersion and writes CeAuditLog. Nobody is added without consent.
const crypto = require('crypto');
const { Op } = require('sequelize');
const E = require('../enums');
const { fail, assertUuid, cleanText, hit, sha256, iso, isUniqueError } = require('../services/util');
const { readIdempotencyKey } = require('../../../utils/idempotency');
const S = require('../services/serialize');
const clock = require('../services/clock');
const cap = require('../services/capacity');
const tickets = require('../services/tickets');
const payments = require('../services/payments');
const elig = require('../services/eligibility');
const V = require('../services/validate');
const flag = require('../services/flag');
const notify = require('../services/notify');
const outcomes = require('../services/outcomes');
const audit = require('../services/audit');
const { M, loadEvent, usersById, byIds } = require('./common');

const MS = E.MEMBER_STATUS;
const TS = E.TEAM_STATUS;
const N = E.NOTIFY;

const assertTeamEvent = (ev) => { if (ev.format !== E.FORMAT.TEAM) throw fail(400, 'NOT_TEAM_EVENT', 'This event takes individual registrations.'); };

const loadTeam = async (id) => {
  assertUuid(id, 'team');
  const team = await M().Team.findByPk(id);
  if (!team) throw fail(404, 'NOT_FOUND', 'This team was not found.');
  return team;
};
const assertCaptain = (team, userId) => { if (String(team.captainUserId) !== String(userId)) throw fail(403, 'NOT_CAPTAIN', 'Only the team captain can do this.'); };

const acceptedCount = (teamId, t) => M().Member.count({ where: { teamId, status: MS.ACCEPTED }, transaction: t });
const openCount = (teamId, t) => M().Member.count({
  where: { teamId, [Op.or]: [{ status: MS.ACCEPTED }, { status: MS.INVITED, expiresAt: { [Op.gt]: clock.now() } }] }, transaction: t,
});

/** Another accepted membership for this event (exclusive events). */
const inOtherTeam = async (event, userId, exceptTeamId, t) => {
  if (event.multiTeamAllowed) return null;
  // exclusiveKey is cleared when a team is withdrawn / cancelled, so only live teams count.
  return M().Member.findOne({ where: { eventId: event.id, userId, status: MS.ACCEPTED, exclusiveKey: { [Op.ne]: null }, teamId: { [Op.ne]: exceptTeamId } }, transaction: t });
};

const rosterChanged = async (req, t, team, action, details) => {
  await M().Team.update({ rosterVersion: (Number(team.rosterVersion) || 1) + 1 }, { where: { id: team.id }, transaction: t });
  team.rosterVersion = (Number(team.rosterVersion) || 1) + 1;
  await audit.fromReq(req, { eventId: team.eventId, teamId: team.id, action, details: { ...details, rosterVersion: team.rosterVersion } }, t, 'user');
};

const teamPayload = async (team, viewerId) => {
  const { Member, Event, Reg } = M();
  const [members, event, registration] = await Promise.all([
    Member.findAll({ where: { teamId: team.id }, order: [['createdAt', 'ASC']] }),
    Event.findByPk(team.eventId),
    team.registrationId ? Reg.findByPk(team.registrationId) : null,
  ]);
  const users = await usersById(members.map((m) => m.userId));
  return S.teamForMember(team, { members, users, viewerId, event, registration });
};

/** Membership row of the viewer that allows reading the roster. */
const viewerMembership = (team, userId) => M().Member.findOne({ where: { teamId: team.id, userId, status: { [Op.in]: [MS.ACCEPTED, MS.INVITED] } } });

// POST /:id/teams   { name }
const createTeam = async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertTeamEvent(event);
  cap.assertOpen(event, null);
  const ctx = await elig.loadContext(req.user.id);
  elig.assertEventEligible(ctx, event);
  const name = cleanText(req.body && req.body.name, E.LIMITS.TEAM_NAME);
  if (name.length < 2) throw fail(400, 'INVALID_INPUT', 'Give your team a name (2+ characters).', { field: 'name' });
  const out = await cap.inLock(event.id, async (t, ev) => {
    cap.assertOpen(ev, null);
    if (await inOtherTeam(ev, req.user.id, '00000000-0000-0000-0000-000000000000', t)) throw fail(409, 'ALREADY_IN_TEAM', 'You are already in a team for this event.');
    try {
      const team = await M().Team.create({ eventId: ev.id, campusId: ev.campusId, captainUserId: req.user.id, name, nameKey: name.toLowerCase(), status: TS.FORMING, rosterVersion: 1 }, { transaction: t });
      await M().Member.create({ teamId: team.id, eventId: ev.id, userId: req.user.id, role: E.MEMBER_ROLE.CAPTAIN, status: MS.ACCEPTED, via: 'CREATE', invitedBy: req.user.id, invitedAt: clock.now(), respondedAt: clock.now(), exclusiveKey: ev.multiTeamAllowed ? null : ev.id }, { transaction: t });
      await audit.fromReq(req, { eventId: ev.id, teamId: team.id, action: 'team.create', details: { name } }, t, 'user');
      return { team };
    } catch (err) {
      if (isUniqueError(err)) {
        const clash = await M().Team.findOne({ where: { eventId: ev.id, nameKey: name.toLowerCase(), status: { [Op.ne]: TS.CANCELLED } }, transaction: t });
        if (clash) throw fail(409, 'TEAM_NAME_TAKEN', 'Another team already uses that name. Pick another.', { field: 'name' });
        throw fail(409, 'ALREADY_IN_TEAM', 'You are already in a team for this event.');
      }
      throw err;
    }
  });
  res.status(201).json({ team: await teamPayload(out.team, req.user.id) });
};

// GET /my/teams
const myTeams = async (req, res) => {
  const ms = await M().Member.findAll({ where: { userId: req.user.id, status: MS.ACCEPTED }, order: [['createdAt', 'DESC']], limit: 100 });
  const teams = await byIds(M().Team, ms.map((m) => m.teamId));
  const out = [];
  for (const m of ms) {
    const tm = teams.get(String(m.teamId));
    if (tm && tm.status !== TS.CANCELLED) out.push(await teamPayload(tm, req.user.id));
  }
  res.json({ teams: out });
};

// GET /teams/:teamId   (accepted members: roster; invitee: invitation view; anyone else: 404)
const getTeam = async (req, res) => {
  const team = await loadTeam(req.params.teamId);
  const m = await viewerMembership(team, req.user.id);
  if (!m) throw fail(404, 'NOT_FOUND', 'This team was not found.');
  if (m.status === MS.INVITED) {
    const [event, captain] = await Promise.all([M().Event.findByPk(team.eventId), usersById([team.captainUserId])]);
    return res.json({ invitation: S.invitationView(m, { team, event, captain: captain.get(String(team.captainUserId)) }) });
  }
  res.json({ team: await teamPayload(team, req.user.id) });
};

// GET /teams/:teamId/history   (roster history for members)
const history = async (req, res) => {
  const team = await loadTeam(req.params.teamId);
  const m = await M().Member.findOne({ where: { teamId: team.id, userId: req.user.id, status: MS.ACCEPTED } });
  if (!m) throw fail(404, 'NOT_FOUND', 'This team was not found.');
  const rows = await M().Audit.findAll({ where: { teamId: team.id }, order: [['at', 'ASC']], limit: 200 });
  res.json({ rosterVersion: team.rosterVersion, history: rows.map((r) => ({ action: r.action, at: iso(r.at), details: { rosterVersion: r.details && r.details.rosterVersion, role: r.details && r.details.role } })) });
};

/** Common invitee checks (inside the lock). */
const checkInvitee = async (ev, team, userId, t) => {
  const { reasons } = await elig.checkUserForEvent(userId, ev);
  if (reasons.length) throw fail(409, 'INVITEE_NOT_ELIGIBLE', 'This student cannot join this event (they must be a verified student of this campus who meets the event rules).', { reason: reasons[0] });
  const open = await M().Member.findOne({ where: { teamId: team.id, userId, status: { [Op.in]: E.OPEN_MEMBER_STATUSES } }, transaction: t });
  if (open && open.status === MS.ACCEPTED) throw fail(409, 'ALREADY_MEMBER', 'This student is already in your team.');
  if (open && open.status === MS.INVITED && new Date(open.expiresAt).getTime() > clock.nowMs()) throw fail(409, 'ALREADY_INVITED', 'This student already has an invitation from your team.');
  if (open) await open.update({ status: MS.EXPIRED }, { transaction: t });
  if (await inOtherTeam(ev, userId, team.id, t)) throw fail(409, 'ALREADY_IN_TEAM', 'This student is already in another team for this event.');
};

const assertRosterEditable = (ev, team) => {
  if (team.status === TS.CANCELLED) throw fail(409, 'TEAM_CANCELLED', 'This team was cancelled.');
  if (team.status === TS.SUBMITTED && !ev.allowSubstitutions) throw fail(409, 'SUBSTITUTIONS_OFF', 'The roster is locked: this event does not allow substitutions after registration.');
};

// POST /teams/:teamId/invitations   { userId }  (pick from GET /api/campus/search?type=people)
const invite = async (req, res) => {
  hit('invite', req.user.id);
  const team0 = await loadTeam(req.params.teamId);
  assertCaptain(team0, req.user.id);
  const inviteeId = assertUuid(req.body && req.body.userId, 'student');
  if (String(inviteeId) === String(req.user.id)) throw fail(400, 'INVALID_INPUT', 'You are already the captain.');
  const { isBlockedBetween } = require('../../campus/campusHelpers');
  if (await isBlockedBetween(req.user.id, inviteeId)) throw fail(403, 'CANNOT_INVITE', 'You cannot invite this student.');
  const s = await flag.readSettings();
  const out = await cap.inLock(team0.eventId, async (t, ev) => {
    const team = await M().Team.findByPk(team0.id, { transaction: t });
    assertRosterEditable(ev, team);
    if (ev.status !== E.EVENT_STATUS.PUBLISHED) throw fail(409, 'REGISTRATION_CLOSED', 'This event is not open.');
    await checkInvitee(ev, team, inviteeId, t);
    if (await openCount(team.id, t) >= (Number(ev.teamMax) || 0)) throw fail(409, 'TEAM_FULL', `A team can have at most ${ev.teamMax} players (pending invitations count).`, { teamMax: ev.teamMax });
    const m = await M().Member.create({
      teamId: team.id, eventId: ev.id, userId: inviteeId, role: E.MEMBER_ROLE.PLAYER, status: MS.INVITED, via: 'INVITE', invitedBy: req.user.id,
      invitedAt: clock.now(), expiresAt: new Date(clock.nowMs() + s.inviteExpiryHours * 60 * 60 * 1000),
    }, { transaction: t });
    await audit.fromReq(req, { eventId: ev.id, teamId: team.id, action: 'team.invite', details: { memberId: m.id } }, t, 'user');
    return { member: m, team };
  });
  notify.toUsers([inviteeId], 'Team invitation 🏆', `You were invited to join team ${out.team.name} for ${String(out.event.title || '').slice(0, 60)}.`, { type: N.TEAM_INVITATION, teamId: out.team.id, eventId: out.event.id, invitationId: out.member.id });
  notify.nudge([inviteeId], 'invitation', out.member.id, MS.INVITED);
  res.status(201).json({ invitation: { id: out.member.id, status: out.member.status, expiresAt: iso(out.member.expiresAt) }, team: await teamPayload(out.team, req.user.id) });
};

// GET /team-invitations   (my pending invitations)
const myInvitations = async (req, res) => {
  const rows = await M().Member.findAll({ where: { userId: req.user.id, status: MS.INVITED, expiresAt: { [Op.gt]: clock.now() } }, order: [['createdAt', 'DESC']], limit: 50 });
  const teams = await byIds(M().Team, rows.map((r) => r.teamId));
  const events = await byIds(M().Event, rows.map((r) => r.eventId));
  const caps = await usersById([...teams.values()].map((tm) => tm.captainUserId));
  res.json({
    invitations: rows.filter((r) => teams.get(String(r.teamId)) && teams.get(String(r.teamId)).status !== TS.CANCELLED).map((r) => {
      const team = teams.get(String(r.teamId));
      return S.invitationView(r, { team, event: events.get(String(r.eventId)), captain: caps.get(String(team.captainUserId)) });
    }),
  });
};

/** Accept inside the lock: size, exclusivity, eligibility, substitution rules. */
const acceptInLock = async (req, t, ev, team, member) => {
  assertRosterEditable(ev, team);
  const { reasons } = await elig.checkUserForEvent(member.userId, ev);
  if (reasons.length) throw fail(403, 'NOT_ELIGIBLE', elig.REASON_MESSAGES[reasons[0]] || 'You are not eligible for this event.', { reason: reasons[0] });
  if (await inOtherTeam(ev, member.userId, team.id, t)) throw fail(409, 'ALREADY_IN_TEAM', 'You are already in another team for this event.');
  if (await acceptedCount(team.id, t) >= (Number(ev.teamMax) || 0)) throw fail(409, 'TEAM_FULL', 'This team is already full.');
  try {
    await member.update({ status: MS.ACCEPTED, respondedAt: clock.now(), exclusiveKey: ev.multiTeamAllowed ? null : ev.id }, { transaction: t });
  } catch (err) {
    if (isUniqueError(err)) throw fail(409, 'ALREADY_IN_TEAM', 'You are already in another team for this event.');
    throw err;
  }
  if (team.status === TS.SUBMITTED) {
    await rosterChanged(req, t, team, 'team.member.substitute_in', { memberId: member.id });
    const reg = team.registrationId ? await M().Reg.findByPk(team.registrationId, { transaction: t }) : null;
    if (reg && reg.status === E.REG_STATUS.CONFIRMED && ev.attendancePerMember) await tickets.issueFor(reg, ev, t);
  } else {
    await audit.fromReq(req, { eventId: ev.id, teamId: team.id, action: 'team.member.accept', details: { memberId: member.id, via: member.via } }, t, 'user');
  }
};

// POST /team-invitations/:id/respond   { accept: true|false }
const respond = async (req, res) => {
  const id = assertUuid(req.params.id, 'invitation');
  const m0 = await M().Member.findByPk(id);
  if (!m0 || String(m0.userId) !== String(req.user.id)) throw fail(404, 'NOT_FOUND', 'This invitation was not found.');
  const accept = req.body && (req.body.accept === true || req.body.accept === 'true' || req.body.action === 'accept');
  if (!accept && !(req.body && (req.body.accept === false || req.body.accept === 'false' || req.body.action === 'decline'))) throw fail(400, 'INVALID_INPUT', 'Send accept: true or false.', { field: 'accept' });
  const out = await cap.inLock(m0.eventId, async (t, ev) => {
    const member = await M().Member.findByPk(id, { transaction: t });
    const team = await M().Team.findByPk(member.teamId, { transaction: t });
    if (member.status !== MS.INVITED) throw fail(409, 'INVITATION_CLOSED', 'This invitation is no longer open.', { status: member.status });
    if (new Date(member.expiresAt).getTime() <= clock.nowMs()) {
      await member.update({ status: MS.EXPIRED }, { transaction: t });
      return { expired: true, team, member };
    }
    if (!accept) {
      await member.update({ status: MS.DECLINED, respondedAt: clock.now() }, { transaction: t });
      await audit.fromReq(req, { eventId: ev.id, teamId: team.id, action: 'team.member.decline', details: { memberId: member.id } }, t, 'user');
      return { team, member };
    }
    if (ev.status !== E.EVENT_STATUS.PUBLISHED) throw fail(409, 'REGISTRATION_CLOSED', 'This event is not open.');
    await acceptInLock(req, t, ev, team, member);
    return { team, member };
  });
  if (out.expired) throw fail(410, 'INVITATION_EXPIRED', 'This invitation expired. Ask the captain to invite you again.');
  const who = (await usersById([req.user.id])).get(String(req.user.id));
  notify.toUsers([out.team.captainUserId], accept ? 'Invitation accepted ✅' : 'Invitation declined', `${S.shortName(who && who.name)} ${accept ? 'joined' : 'declined to join'} ${out.team.name}.`, { type: accept ? N.TEAM_INVITE_ACCEPTED : N.TEAM_INVITE_DECLINED, teamId: out.team.id, eventId: out.team.eventId });
  notify.nudge([out.team.captainUserId], 'team', out.team.id, out.team.status);
  if (accept) return res.json({ team: await teamPayload(out.team, req.user.id) });
  return res.json({ invitation: { id: out.member.id, status: out.member.status } });
};

// POST /teams/:teamId/join-link   (captain; a new link replaces the old one)
const joinLink = async (req, res) => {
  const team = await loadTeam(req.params.teamId);
  assertCaptain(team, req.user.id);
  if (team.status === TS.CANCELLED) throw fail(409, 'TEAM_CANCELLED', 'This team was cancelled.');
  const s = await flag.readSettings();
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(clock.nowMs() + s.joinLinkDays * 24 * 60 * 60 * 1000);
  await team.update({ joinTokenHash: sha256(token), joinTokenExpiresAt: expiresAt });
  await audit.fromReq(req, { eventId: team.eventId, teamId: team.id, action: 'team.join_link.rotate', details: {} }, null, 'user');
  res.json({ token, url: `zenvy://campus-events/join?t=${token}`, expiresAt: iso(expiresAt), note: 'Anyone with this link can ask to join. You can rotate it any time.' });
};

// DELETE-like: POST /teams/:teamId/join-link/revoke
const revokeJoinLink = async (req, res) => {
  const team = await loadTeam(req.params.teamId);
  assertCaptain(team, req.user.id);
  await team.update({ joinTokenHash: null, joinTokenExpiresAt: null });
  res.json({ ok: true });
};

// GET /team-join/preview?t=<token>   what the link joins, before the student consents. No PII: team name,
// event title / time / venue, accepted roster count + size limits, the captain's first name only. Same
// 404 INVALID_LINK as joining for a bad / expired / revoked link or a blocked captain. Rate-limited.
const joinPreview = async (req, res) => {
  hit('join_preview', req.user.id);
  const token = String((req.query && (req.query.t || req.query.token)) || '').trim();
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) throw fail(404, 'INVALID_LINK', 'This join link is not valid.');
  const team = await M().Team.findOne({ where: { joinTokenHash: sha256(token) } });
  if (!team || team.status === TS.CANCELLED || !team.joinTokenExpiresAt || new Date(team.joinTokenExpiresAt).getTime() <= clock.nowMs()) throw fail(404, 'INVALID_LINK', 'This join link is not valid or has expired.');
  const { isBlockedBetween } = require('../../campus/campusHelpers');
  if (await isBlockedBetween(team.captainUserId, req.user.id)) throw fail(404, 'INVALID_LINK', 'This join link is not valid.');
  const ev = await M().Event.findByPk(team.eventId);
  const ctx = await elig.loadContext(req.user.id);
  if (!ev || (ev.campusId && String(ev.campusId) !== String(ctx.campusId))) throw fail(404, 'INVALID_LINK', 'This join link is not valid.');
  const [rosterCount, mine, captain] = await Promise.all([
    acceptedCount(team.id),
    M().Member.findOne({ where: { teamId: team.id, userId: req.user.id, status: MS.ACCEPTED }, attributes: ['id'] }),
    usersById([team.captainUserId]),
  ]);
  const reasons = elig.eventReasons(ctx, ev);
  let blocker = null;
  if (mine) blocker = 'ALREADY_MEMBER';
  else if (ev.status !== E.EVENT_STATUS.PUBLISHED) blocker = 'REGISTRATION_CLOSED';
  else if (reasons.length) blocker = reasons[0];
  else if (ev.teamMax && rosterCount >= Number(ev.teamMax)) blocker = 'TEAM_FULL';
  res.json({
    preview: {
      team: { name: team.name, status: team.status, rosterCount, teamMin: ev.teamMin || null, teamMax: ev.teamMax || null, captainFirstName: S.firstName((captain.get(String(team.captainUserId)) || {}).name) },
      event: { id: ev.id, title: ev.title, startAt: iso(ev.startAt), venue: ev.venue, category: ev.category },
      expiresAt: iso(team.joinTokenExpiresAt),
      alreadyMember: !!mine,
      canJoin: !blocker,
      reason: blocker,
      message: blocker ? ({ ALREADY_MEMBER: 'You are already in this team.', REGISTRATION_CLOSED: 'This event is not open.', TEAM_FULL: 'This team is full.' }[blocker] || elig.REASON_MESSAGES[blocker] || 'You cannot join this team.') : null,
    },
  });
};

// POST /team-join   { token }   (the joiner's own action = consent)
const joinByLink = async (req, res) => {
  hit('join', req.user.id);
  const token = String((req.body && req.body.token) || '').trim();
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) throw fail(404, 'INVALID_LINK', 'This join link is not valid.');
  const team0 = await M().Team.findOne({ where: { joinTokenHash: sha256(token) } });
  if (!team0 || !team0.joinTokenExpiresAt || new Date(team0.joinTokenExpiresAt).getTime() <= clock.nowMs()) throw fail(404, 'INVALID_LINK', 'This join link is not valid or has expired.');
  const { isBlockedBetween } = require('../../campus/campusHelpers');
  if (await isBlockedBetween(team0.captainUserId, req.user.id)) throw fail(404, 'INVALID_LINK', 'This join link is not valid.');
  const out = await cap.inLock(team0.eventId, async (t, ev) => {
    const team = await M().Team.findByPk(team0.id, { transaction: t });
    if (team.joinTokenHash !== sha256(token)) throw fail(404, 'INVALID_LINK', 'This join link is not valid.');
    if (ev.status !== E.EVENT_STATUS.PUBLISHED) throw fail(409, 'REGISTRATION_CLOSED', 'This event is not open.');
    const existing = await M().Member.findOne({ where: { teamId: team.id, userId: req.user.id, status: { [Op.in]: E.OPEN_MEMBER_STATUSES } }, transaction: t });
    if (existing && existing.status === MS.ACCEPTED) return { team, already: true };
    const member = existing || await M().Member.create({ teamId: team.id, eventId: ev.id, userId: req.user.id, role: E.MEMBER_ROLE.PLAYER, status: MS.INVITED, via: 'LINK', invitedBy: team.captainUserId, invitedAt: clock.now(), expiresAt: new Date(clock.nowMs() + 60 * 1000) }, { transaction: t });
    if (!existing) member.via = 'LINK';
    await acceptInLock(req, t, ev, team, member);
    return { team };
  });
  if (!out.already) {
    const who = (await usersById([req.user.id])).get(String(req.user.id));
    notify.toUsers([out.team.captainUserId], 'New team member', `${S.shortName(who && who.name)} joined ${out.team.name} with your link.`, { type: N.TEAM_INVITE_ACCEPTED, teamId: out.team.id, eventId: out.team.eventId });
  }
  res.json({ team: await teamPayload(out.team, req.user.id), already: !!out.already });
};

/** Removes / lets go of a member (captain removal or self leave) inside the lock. */
const dropMember = async (req, t, ev, team, member, status) => {
  if (member.role === E.MEMBER_ROLE.CAPTAIN) throw fail(409, 'CAPTAIN_MUST_TRANSFER', 'The captain must hand over the captaincy before leaving.');
  if (member.status === MS.INVITED) {
    await member.update({ status: MS.REVOKED, respondedAt: clock.now() }, { transaction: t });
    await audit.fromReq(req, { eventId: ev.id, teamId: team.id, action: 'team.invite.revoke', details: { memberId: member.id } }, t, 'user');
    return;
  }
  if (member.status !== MS.ACCEPTED) throw fail(409, 'NOT_A_MEMBER', 'This person is not in the team.');
  assertRosterEditable(ev, team);
  await member.update({ status, respondedAt: clock.now(), exclusiveKey: null }, { transaction: t });
  if (team.registrationId) await tickets.cancelFor(team.registrationId, t, { status: E.TICKET_STATUS.VOID, reason: 'Left the team', holderKey: member.userId });
  if (team.status === TS.SUBMITTED) await rosterChanged(req, t, team, status === MS.LEFT ? 'team.member.left' : 'team.member.substitute_out', { memberId: member.id });
  else await audit.fromReq(req, { eventId: ev.id, teamId: team.id, action: status === MS.LEFT ? 'team.member.left' : 'team.member.remove', details: { memberId: member.id } }, t, 'user');
};

// POST /teams/:teamId/members/:memberId/remove   (captain)
const removeMember = async (req, res) => {
  const team0 = await loadTeam(req.params.teamId);
  assertCaptain(team0, req.user.id);
  const memberId = assertUuid(req.params.memberId, 'member');
  const out = await cap.inLock(team0.eventId, async (t, ev) => {
    const team = await M().Team.findByPk(team0.id, { transaction: t });
    const member = await M().Member.findByPk(memberId, { transaction: t });
    if (!member || String(member.teamId) !== String(team.id)) throw fail(404, 'NOT_FOUND', 'This member was not found.');
    await dropMember(req, t, ev, team, member, MS.REMOVED);
    return { team, member, below: (await acceptedCount(team.id, t)) < (Number(ev.teamMin) || 0) };
  });
  notify.nudge([out.member.userId], 'team', out.team.id, out.member.status);
  if (out.member.status === MS.REMOVED) notify.toUsers([out.member.userId], 'Removed from team', `You are no longer in ${out.team.name}.`, { type: N.TEAM_ROSTER_CHANGED, teamId: out.team.id, eventId: out.team.eventId });
  res.json({ team: await teamPayload(out.team, req.user.id), belowMinimum: out.below });
};

// POST /teams/:teamId/leave
const leave = async (req, res) => {
  const team0 = await loadTeam(req.params.teamId);
  const out = await cap.inLock(team0.eventId, async (t, ev) => {
    const team = await M().Team.findByPk(team0.id, { transaction: t });
    const member = await M().Member.findOne({ where: { teamId: team.id, userId: req.user.id, status: MS.ACCEPTED }, transaction: t });
    if (!member) throw fail(404, 'NOT_FOUND', 'You are not in this team.');
    await dropMember(req, t, ev, team, member, MS.LEFT);
    return { team };
  });
  notify.toUsers([out.team.captainUserId], 'A player left', `A player left ${out.team.name}.`, { type: N.TEAM_ROSTER_CHANGED, teamId: out.team.id, eventId: out.team.eventId, dedupe: req.user.id });
  res.json({ ok: true });
};

// POST /teams/:teamId/captain   { memberId }   (hand over captaincy)
const transferCaptain = async (req, res) => {
  const team0 = await loadTeam(req.params.teamId);
  assertCaptain(team0, req.user.id);
  const memberId = assertUuid(req.body && req.body.memberId, 'member');
  const out = await cap.inLock(team0.eventId, async (t) => {
    const team = await M().Team.findByPk(team0.id, { transaction: t });
    assertCaptain(team, req.user.id);
    const target = await M().Member.findByPk(memberId, { transaction: t });
    if (!target || String(target.teamId) !== String(team.id) || target.status !== MS.ACCEPTED) throw fail(404, 'NOT_FOUND', 'Pick a player who has joined the team.');
    if (String(target.userId) === String(req.user.id)) return { team };
    await M().Member.update({ role: E.MEMBER_ROLE.PLAYER }, { where: { teamId: team.id, userId: req.user.id, status: MS.ACCEPTED }, transaction: t });
    await target.update({ role: E.MEMBER_ROLE.CAPTAIN }, { transaction: t });
    await team.update({ captainUserId: target.userId }, { transaction: t });
    // The team's registration and its TEAM ticket belong to the captain: they move with the captaincy (same
    // transaction), so the old captain can no longer cancel / refund the registration or hold the team gate
    // QR, and the new captain manages both. MEMBER tickets stay with each player. A wallet refund still goes
    // back to whoever paid (payments.processRefund reads the payer from the wallet ledger).
    let movedRegistration = false;
    let movedTickets = 0;
    if (team.registrationId) {
      const [n] = await M().Reg.update({ userId: target.userId }, { where: { id: team.registrationId, teamId: team.id }, transaction: t });
      movedRegistration = n > 0;
      [movedTickets] = await M().Ticket.update({ userId: target.userId }, { where: { registrationId: team.registrationId, kind: E.TICKET_KIND.TEAM }, transaction: t });
    }
    await rosterChanged(req, t, team, 'team.captain.transfer', { toMemberId: target.id, role: 'CAPTAIN', registrationMoved: movedRegistration, teamTicketsMoved: movedTickets });
    return { team, target };
  });
  if (out.target) notify.toUsers([out.target.userId], 'You are the captain now', `You now lead ${out.team.name}.`, { type: N.TEAM_ROSTER_CHANGED, teamId: out.team.id, eventId: out.team.eventId, dedupe: 'captain' });
  res.json({ team: await teamPayload(out.team, req.user.id) });
};

// POST /teams/:teamId/submit   { answers, acceptRules, rulesVersion, paymentMode?, joinWaitlist?, idempotencyKey? }
const submit = async (req, res) => {
  hit('register', req.user.id);
  tickets.assertConfigured();
  const team0 = await loadTeam(req.params.teamId);
  assertCaptain(team0, req.user.id);
  const event = await loadEvent(team0.eventId);
  cap.assertOpen(event, null);
  const body = req.body || {};
  const ctx = await elig.loadContext(req.user.id);
  elig.assertEventEligible(ctx, event);
  const answers = V.cleanAnswers(event.questions, body.answers);
  const rulesVersion = V.checkRules(event, body);
  const price = payments.priceFor(event, null);
  const paymentMode = await payments.pickMode(event, body.paymentMode, price.total);
  const key = readIdempotencyKey(req, body.idempotencyKey);
  const members0 = await M().Member.findAll({ where: { teamId: team0.id, status: MS.ACCEPTED } });
  for (const m of members0) {
    const { reasons } = await elig.checkUserForEvent(m.userId, event);
    if (reasons.length) throw fail(409, 'MEMBER_NOT_ELIGIBLE', 'A player in your team is no longer eligible (verification or event rules). Remove them or ask them to verify.', { memberId: m.id, reason: reasons[0] });
  }
  const out = await cap.inLock(event.id, async (t, ev) => {
    cap.assertOpen(ev, null);
    const team = await M().Team.findByPk(team0.id, { transaction: t });
    assertCaptain(team, req.user.id);
    if (team.status === TS.CANCELLED) throw fail(409, 'TEAM_CANCELLED', 'This team was cancelled.');
    if (team.status === TS.SUBMITTED && team.registrationId) {
      const reg = await M().Reg.findByPk(team.registrationId, { transaction: t });
      if (reg && E.OPEN_REG_STATUSES.includes(reg.status)) return { reg, replay: true, team };
    }
    const n = await acceptedCount(team.id, t);
    if (n < (Number(ev.teamMin) || 1)) throw fail(409, 'TEAM_TOO_SMALL', `Your team needs at least ${ev.teamMin} players who accepted (now ${n}).`, { teamMin: ev.teamMin, accepted: n });
    if (n > (Number(ev.teamMax) || 0)) throw fail(409, 'TEAM_TOO_BIG', `A team can have at most ${ev.teamMax} players.`, { teamMax: ev.teamMax, accepted: n });
    if (paymentMode === E.PAYMENT_MODE.VENUE) await payments.assertVenueQuota(req.user.id, t);
    const r = await cap.allocate(t, {
      event: ev, slot: null, userId: req.user.id, teamId: team.id, type: E.REG_TYPE.TEAM, answers, rulesVersion, paymentMode, price,
      idempotencyKey: key || null, joinWaitlist: body.joinWaitlist,
    });
    await team.update({ status: TS.SUBMITTED, registrationId: r.reg.id, submittedAt: clock.now() }, { transaction: t });
    await audit.fromReq(req, { eventId: ev.id, teamId: team.id, registrationId: r.reg.id, action: 'team.submit', details: { players: n, status: r.reg.status, rosterVersion: team.rosterVersion } }, t, 'user');
    return { ...r, team };
  });
  outcomes.swept(out.swept, out.event);
  if (!out.replay) outcomes.registered(out.reg, out.event);
  const regPayload = await require('./register').regPayload(req, out.reg);
  res.status(out.replay ? 200 : 201).json({ registration: regPayload, team: await teamPayload(out.team, req.user.id), waitlisted: !!out.waitlisted, ...(out.replay ? { replay: true } : {}) });
};

// POST /teams/:teamId/cancel   (captain: withdraws the team; refunds per policy)
const cancelTeam = async (req, res) => {
  const team0 = await loadTeam(req.params.teamId);
  assertCaptain(team0, req.user.id);
  if (team0.status === TS.CANCELLED) return res.json({ team: { id: team0.id, status: team0.status } });
  const event = await loadEvent(team0.eventId);
  const reg0 = team0.registrationId ? await M().Reg.findByPk(team0.registrationId) : null;
  if (reg0 && E.OPEN_REG_STATUSES.includes(reg0.status)) {
    await cap.assertUserCanCancel(event, reg0, null);
    const used = await M().Ticket.findOne({ where: { registrationId: reg0.id, status: E.TICKET_STATUS.USED }, attributes: ['id'] });
    if (used) throw fail(409, 'ALREADY_CHECKED_IN', 'Your team already checked in.');
  }
  const pct = await payments.refundPct(event, 'user');
  const out = await cap.inLock(event.id, async (t, ev) => {
    const team = await M().Team.findByPk(team0.id, { transaction: t });
    let ended = null;
    let promoted = [];
    if (team.registrationId) {
      const reg = await M().Reg.findByPk(team.registrationId, { transaction: t });
      if (reg && E.OPEN_REG_STATUSES.includes(reg.status)) ({ reg: ended, promoted } = await cap.endRegistration(t, ev, reg, { by: 'user', reason: 'Team withdrawn', pct }));
    }
    await M().Team.update({ status: TS.CANCELLED, cancelledAt: clock.now(), joinTokenHash: null }, { where: { id: team.id }, transaction: t });
    await M().Member.update({ exclusiveKey: null }, { where: { teamId: team.id }, transaction: t });
    await M().Member.update({ status: MS.REVOKED }, { where: { teamId: team.id, status: MS.INVITED }, transaction: t });
    await audit.fromReq(req, { eventId: ev.id, teamId: team.id, registrationId: ended ? ended.id : null, action: 'team.cancel', details: { pct } }, t, 'user');
    return { team, ended, promoted };
  });
  if (out.ended) outcomes.ended(out.ended, out.event, { by: 'user' });
  outcomes.promoted(out.promoted, out.event);
  const members = await notify.teamUserIds(team0.id);
  notify.toUsers(members.filter((id) => String(id) !== String(req.user.id)), 'Team withdrawn', `${team0.name} was withdrawn by the captain.`, { type: N.TEAM_ROSTER_CHANGED, teamId: team0.id, eventId: team0.eventId, dedupe: 'cancel' });
  res.json({ team: { id: team0.id, status: TS.CANCELLED } });
};

module.exports = { createTeam, myTeams, getTeam, history, invite, myInvitations, respond, joinLink, revokeJoinLink, joinPreview, joinByLink, removeMember, leave, transferCaptain, submit, cancelTeam };
