// Team registration.
// Owner scenarios: #10 captain creates team, #11 invitations accept / reject, #12 team size limits,
// #13 no duplicate members (+ multi-team rule, no adding without consent, roster history).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(async () => { await H.setup({ label: 'ce-teams' }); await H.setFlag(true); });
test.after(async () => { await H.teardown(); });

const teamEvent = (extra = {}) => H.mkEvent({ format: 'TEAM', maxTeams: 3, teamMin: 2, teamMax: 3, title: 'Cricket Cup', ...extra });
const invite = (team, captain, user) => H.api('POST', `/api/campus-events/teams/${team.id}/invitations`, captain.token, { userId: user.id });
const respond = (inv, user, accept) => H.api('POST', `/api/campus-events/team-invitations/${inv.id}/respond`, user.token, { accept });

test('#10 captain creates a team (name unique per event, captain counted, no slot reserved yet)', async () => {
  const { event } = await teamEvent();
  const cap = await H.mkStudent({ name: 'Ravi Captain' });
  const r = await H.api('POST', `/api/campus-events/${event.id}/teams`, cap.token, { name: 'Thunder XI' });
  assert.equal(r.status, 201);
  assert.equal(r.body.team.isCaptain, true);
  assert.equal(r.body.team.status, 'FORMING');
  assert.equal(r.body.team.acceptedCount, 1);
  assert.equal((await H.ctx.M('CeEvent').findByPk(event.id)).unitsLive, 0, 'forming team takes no place');
  const other = await H.mkStudent();
  const clash = await H.api('POST', `/api/campus-events/${event.id}/teams`, other.token, { name: 'thunder xi' });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, 'TEAM_NAME_TAKEN');
  const second = await H.api('POST', `/api/campus-events/${event.id}/teams`, cap.token, { name: 'Second Team' });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'ALREADY_IN_TEAM');
  const { event: solo } = await H.mkEvent({ capacity: 4 });
  assert.equal((await H.api('POST', `/api/campus-events/${solo.id}/teams`, cap.token, { name: 'X' })).body.code, 'NOT_TEAM_EVENT');
  assert.equal((await H.register(event.id, cap)).body.code, 'TEAM_EVENT', 'cricket = team registration, not per-player tickets');
  const d = await H.api('GET', `/api/campus-events/${event.id}`, cap.token);
  assert.equal(d.body.event.cta.action, 'MANAGE_TEAM');
});

test('#11 invitations: invite verified same-campus students, accept / decline, expiry; unaccepted invite is not a player', async () => {
  const { event } = await teamEvent();
  const cap = await H.mkStudent();
  const { body: { team } } = await H.api('POST', `/api/campus-events/${event.id}/teams`, cap.token, { name: 'Lions' });
  const a = await H.mkStudent({ name: 'Anil Kumar' });
  const b = await H.mkStudent();
  const unverified = await H.mkStudent({ verified: false });
  const outsider = await H.mkStudent({ campusRow: await H.mkCampus('Far Away') });
  assert.equal((await invite(team, cap, unverified)).body.code, 'INVITEE_NOT_ELIGIBLE');
  assert.equal((await invite(team, cap, outsider)).body.code, 'INVITEE_NOT_ELIGIBLE');
  const notCaptain = await H.api('POST', `/api/campus-events/teams/${team.id}/invitations`, a.token, { userId: b.id });
  assert.equal(notCaptain.status, 403);
  const ia = await invite(team, cap, a);
  assert.equal(ia.status, 201);
  const ib = await invite(team, cap, b);
  assert.equal(ib.status, 201);
  // Invitee sees only the invitation view (no roster); a stranger sees nothing.
  const view = await H.api('GET', `/api/campus-events/teams/${team.id}`, a.token);
  assert.ok(view.body.invitation);
  assert.equal(view.body.team, undefined);
  const stranger = await H.mkStudent();
  assert.equal((await H.api('GET', `/api/campus-events/teams/${team.id}`, stranger.token)).status, 404);
  const mine = await H.api('GET', '/api/campus-events/team-invitations', a.token);
  assert.equal(mine.body.invitations.length, 1);
  assert.equal(mine.body.invitations[0].team.name, 'Lions');
  assert.ok((await H.notificationsFor(a.id)).some((n) => n.type === 'CE_TEAM_INVITATION'));
  // Unaccepted invite does not count as a player: submit with captain only is too small.
  const early = await H.api('POST', `/api/campus-events/teams/${team.id}/submit`, cap.token, { acceptRules: true, rulesVersion: 1 });
  assert.equal(early.body.code, 'TEAM_TOO_SMALL');
  // Someone else cannot answer my invitation.
  assert.equal((await respond(ia.body.invitation, b, true)).status, 404);
  const acc = await respond(ia.body.invitation, a, true);
  assert.equal(acc.status, 200);
  assert.equal(acc.body.team.acceptedCount, 2);
  assert.ok((await H.notificationsFor(cap.id)).some((n) => n.type === 'CE_TEAM_INVITE_ACCEPTED'));
  const dec = await respond(ib.body.invitation, b, false);
  assert.equal(dec.body.invitation.status, 'DECLINED');
  assert.equal((await respond(ib.body.invitation, b, true)).body.code, 'INVITATION_CLOSED');
  // Expiry: invite c, wait past 72 h.
  const c = await H.mkStudent();
  const ic = await invite(team, cap, c);
  H.advance(73 * H.HOUR);
  const exp = await respond(ic.body.invitation, c, true);
  assert.equal(exp.status, 410);
  // Roster (members only): accepted players listed with names, no phones.
  const roster = await H.api('GET', `/api/campus-events/teams/${team.id}`, a.token);
  assert.equal(roster.body.team.members.length, 2);
  assert.equal(JSON.stringify(roster.body).includes(a.phone), false);
});

test('#12 team size limits: min to submit, max on invites / accepts / join link', async () => {
  const { event } = await teamEvent({ teamMin: 2, teamMax: 3 });
  const cap = await H.mkStudent();
  const { body: { team } } = await H.api('POST', `/api/campus-events/${event.id}/teams`, cap.token, { name: 'Max Three' });
  const [a, b, c] = [await H.mkStudent(), await H.mkStudent(), await H.mkStudent()];
  assert.equal((await invite(team, cap, a)).status, 201);
  assert.equal((await invite(team, cap, b)).status, 201);
  const over = await invite(team, cap, c);
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'TEAM_FULL', 'pending invitations count toward the maximum');
  // Join link: c can join only while there is room.
  const link = await H.api('POST', `/api/campus-events/teams/${team.id}/join-link`, cap.token);
  assert.equal(link.status, 200);
  assert.match(link.body.url, /^zenvy:\/\/campus-events\/join\?t=/);
  const row = await H.ctx.M('CeTeam').findByPk(team.id);
  assert.notEqual(row.joinTokenHash, link.body.token, 'only the hash is stored');
  const inv = await H.ctx.M('CeTeamMember').findAll({ where: { teamId: team.id, status: 'INVITED' } });
  for (const m of inv) await respond(m, m.userId === a.id ? a : b, true);
  const j = await H.api('POST', '/api/campus-events/team-join', c.token, { token: link.body.token });
  assert.equal(j.status, 409);
  assert.equal(j.body.code, 'TEAM_FULL');
  assert.equal((await H.api('POST', '/api/campus-events/team-join', c.token, { token: 'x'.repeat(43) })).status, 404);
  // Rotating the link kills the old one.
  const remove = await H.ctx.M('CeTeamMember').findOne({ where: { teamId: team.id, userId: b.id } });
  assert.equal((await H.api('POST', `/api/campus-events/teams/${team.id}/members/${remove.id}/remove`, cap.token)).status, 200);
  const link2 = await H.api('POST', `/api/campus-events/teams/${team.id}/join-link`, cap.token);
  assert.equal((await H.api('POST', '/api/campus-events/team-join', c.token, { token: link.body.token })).status, 404, 'old link dead');
  const j2 = await H.api('POST', '/api/campus-events/team-join', c.token, { token: link2.body.token });
  assert.equal(j2.status, 200);
  assert.equal(j2.body.team.acceptedCount, 3);
  // Submit within limits.
  const sub = await H.api('POST', `/api/campus-events/teams/${team.id}/submit`, cap.token, { acceptRules: true, rulesVersion: 1 });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.registration.status, 'CONFIRMED');
  assert.equal(sub.body.registration.type, 'TEAM');
});

test('#13 no duplicate members, one team per event unless multi-team allowed, nobody added without consent', async () => {
  const { event } = await teamEvent({ teamMax: 5 });
  const c1 = await H.mkStudent();
  const c2 = await H.mkStudent();
  const p = await H.mkStudent();
  const t1 = (await H.api('POST', `/api/campus-events/${event.id}/teams`, c1.token, { name: 'Alpha' })).body.team;
  const t2 = (await H.api('POST', `/api/campus-events/${event.id}/teams`, c2.token, { name: 'Beta' })).body.team;
  const i1 = await invite(t1, c1, p);
  assert.equal((await invite(t1, c1, p)).body.code, 'ALREADY_INVITED');
  const i2 = await invite(t2, c2, p);
  assert.equal(i2.status, 201, 'two invitations are fine');
  assert.equal(await H.ctx.M('CeTeamMember').count({ where: { teamId: t1.id, userId: p.id, status: 'ACCEPTED' } }), 0, 'invite alone adds nobody');
  assert.equal((await respond(i1.body.invitation, p, true)).status, 200);
  assert.equal((await invite(t1, c1, p)).body.code, 'ALREADY_MEMBER');
  const second = await respond(i2.body.invitation, p, true);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'ALREADY_IN_TEAM');
  // Race: two accepts of the same player into two teams at once -> exactly one.
  const q = await H.mkStudent();
  const ja = await invite(t1, c1, q);
  const jb = await invite(t2, c2, q);
  const [ra, rb] = await Promise.all([respond(ja.body.invitation, q, true), respond(jb.body.invitation, q, true)]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
  assert.equal(await H.ctx.M('CeTeamMember').count({ where: { eventId: event.id, userId: q.id, status: 'ACCEPTED' } }), 1);
  // Multi-team allowed event: same player in two teams.
  const { event: open } = await teamEvent({ multiTeamAllowed: true, teamMax: 4, title: 'Open League' });
  const d1 = await H.mkStudent();
  const d2 = await H.mkStudent();
  const u1 = (await H.api('POST', `/api/campus-events/${open.id}/teams`, d1.token, { name: 'One' })).body.team;
  const u2 = (await H.api('POST', `/api/campus-events/${open.id}/teams`, d2.token, { name: 'Two' })).body.team;
  assert.equal((await respond((await invite(u1, d1, p)).body.invitation, p, true)).status, 200);
  assert.equal((await respond((await invite(u2, d2, p)).body.invitation, p, true)).status, 200);
});

test('substitutions + roster history + captain transfer + MEMBER tickets; locked roster when substitutions are off', async () => {
  const { event, organizer } = await teamEvent({ allowSubstitutions: true, attendancePerMember: true, teamMin: 2, teamMax: 3 });
  const cap = await H.mkStudent();
  const team = (await H.api('POST', `/api/campus-events/${event.id}/teams`, cap.token, { name: 'Subs FC' })).body.team;
  const [a, b] = [await H.mkStudent(), await H.mkStudent()];
  await respond((await invite(team, cap, a)).body.invitation, a, true);
  const sub = await H.api('POST', `/api/campus-events/teams/${team.id}/submit`, cap.token, { acceptRules: true, rulesVersion: 1 });
  assert.equal(sub.status, 201);
  const regId = sub.body.registration.id;
  const tks = await H.ctx.M('CeTicket').findAll({ where: { registrationId: regId, status: 'ACTIVE' } });
  assert.deepEqual(tks.map((t) => t.kind).sort(), ['MEMBER', 'MEMBER', 'TEAM']);
  // Substitute a out, b in.
  const ma = await H.ctx.M('CeTeamMember').findOne({ where: { teamId: team.id, userId: a.id, status: 'ACCEPTED' } });
  assert.equal((await H.api('POST', `/api/campus-events/teams/${team.id}/members/${ma.id}/remove`, cap.token)).status, 200);
  assert.equal(await H.ctx.M('CeTicket').count({ where: { registrationId: regId, holderKey: a.id, status: 'ACTIVE' } }), 0, "removed player's ticket voided");
  await respond((await invite(team, cap, b)).body.invitation, b, true);
  assert.equal(await H.ctx.M('CeTicket').count({ where: { registrationId: regId, holderKey: b.id, status: 'ACTIVE' } }), 1, 'substitute gets a ticket');
  const fresh = await H.ctx.M('CeTeam').findByPk(team.id);
  assert.equal(fresh.rosterVersion, 3);
  const hist = await H.api('GET', `/api/campus-events/teams/${team.id}/history`, cap.token);
  assert.ok(hist.body.history.some((h) => h.action === 'team.member.substitute_out'));
  assert.ok(hist.body.history.some((h) => h.action === 'team.member.substitute_in'));
  // Captain must hand over before leaving.
  assert.equal((await H.api('POST', `/api/campus-events/teams/${team.id}/leave`, cap.token)).body.code, 'CAPTAIN_MUST_TRANSFER');
  const mb = await H.ctx.M('CeTeamMember').findOne({ where: { teamId: team.id, userId: b.id, status: 'ACCEPTED' } });
  const tr = await H.api('POST', `/api/campus-events/teams/${team.id}/captain`, cap.token, { memberId: mb.id });
  assert.equal(tr.status, 200);
  assert.equal((await H.ctx.M('CeTeam').findByPk(team.id)).captainUserId, b.id);
  assert.equal((await H.api('POST', `/api/campus-events/teams/${team.id}/leave`, cap.token)).status, 200);
  // Organizer roster view (names only).
  const ro = await H.api('GET', `/api/campus-events/organizer/events/${event.id}/teams`, organizer.token);
  assert.equal(ro.body.teams[0].members.length, 1);
  // Roster locked when substitutions are off.
  const { event: locked } = await teamEvent({ allowSubstitutions: false, title: 'Locked Cup' });
  const c2 = await H.mkStudent();
  const t2 = (await H.api('POST', `/api/campus-events/${locked.id}/teams`, c2.token, { name: 'Locked' })).body.team;
  const p2 = await H.mkStudent();
  await respond((await invite(t2, c2, p2)).body.invitation, p2, true);
  await H.api('POST', `/api/campus-events/teams/${t2.id}/submit`, c2.token, { acceptRules: true, rulesVersion: 1 });
  const m2 = await H.ctx.M('CeTeamMember').findOne({ where: { teamId: t2.id, userId: p2.id } });
  assert.equal((await H.api('POST', `/api/campus-events/teams/${t2.id}/members/${m2.id}/remove`, c2.token)).body.code, 'SUBSTITUTIONS_OFF');
  assert.equal((await invite(t2, c2, await H.mkStudent())).body.code, 'SUBSTITUTIONS_OFF');
  // Team withdraw frees the team place and the members.
  const w = await H.api('POST', `/api/campus-events/teams/${t2.id}/cancel`, c2.token);
  assert.equal(w.status, 200);
  assert.equal(await H.ctx.M('CeTeamMember').count({ where: { teamId: t2.id, exclusiveKey: { [H.Op.ne]: null } } }), 0);
  assert.equal((await H.api('POST', `/api/campus-events/${locked.id}/teams`, p2.token, { name: 'Fresh Start' })).status, 201, 'freed player can form a new team');
});

test('captain transfer moves the registration + TEAM ticket to the new captain; old captain loses cancel / gate QR; wallet refund back to the payer', async () => {
  await H.setWallet(true);
  try {
    const { event } = await teamEvent({ priceType: 'PAID', price: 100, allowSubstitutions: true, paymentModes: ['WALLET'], cancellationPolicy: { userCancelUntilHours: 1, refundPct: 100 }, title: 'Handover Cup' });
    const a = await H.mkStudent({ wallet: 300 });
    const b = await H.mkStudent({ wallet: 0 });
    const team = (await H.api('POST', `/api/campus-events/${event.id}/teams`, a.token, { name: 'Handover XI' })).body.team;
    await respond((await invite(team, a, b)).body.invitation, b, true);
    const sub = await H.api('POST', `/api/campus-events/teams/${team.id}/submit`, a.token, { acceptRules: true, rulesVersion: 1, paymentMode: 'WALLET' });
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    const regId = sub.body.registration.id;
    assert.equal(Number((await H.ctx.M('User').findByPk(a.id)).walletBalance), 200);
    const teamTicket = await H.ctx.M('CeTicket').findOne({ where: { registrationId: regId, kind: 'TEAM' } });
    assert.equal(teamTicket.userId, a.id);

    const mb = await H.ctx.M('CeTeamMember').findOne({ where: { teamId: team.id, userId: b.id, status: 'ACCEPTED' } });
    assert.equal((await H.api('POST', `/api/campus-events/teams/${team.id}/captain`, a.token, { memberId: mb.id })).status, 200);
    assert.equal((await H.ctx.M('CeRegistration').findByPk(regId)).userId, b.id, 'registration moved to the new captain');
    assert.equal((await H.ctx.M('CeTicket').findByPk(teamTicket.id)).userId, b.id, 'TEAM ticket holder moved');
    const hist = await H.ctx.M('CeAuditLog').findOne({ where: { teamId: team.id, action: 'team.captain.transfer' } });
    assert.equal(hist.details.registrationMoved, true);
    assert.equal(hist.details.teamTicketsMoved, 1);

    // The old captain leaves: no cancel, no team ticket, no registration detail any more.
    assert.equal((await H.api('POST', `/api/campus-events/teams/${team.id}/leave`, a.token)).status, 200);
    assert.equal((await H.api('POST', `/api/campus-events/registrations/${regId}/cancel`, a.token, {})).status, 404);
    assert.equal((await H.api('GET', `/api/campus-events/tickets/${teamTicket.id}`, a.token)).status, 404);
    assert.equal((await H.api('GET', `/api/campus-events/registrations/${regId}`, a.token)).status, 404);
    assert.equal((await H.ctx.M('CeRegistration').findByPk(regId)).status, 'CONFIRMED');

    // The new captain manages it; the wallet refund goes back to whoever paid (the old captain).
    assert.equal((await H.api('GET', `/api/campus-events/tickets/${teamTicket.id}`, b.token)).status, 200);
    const c = await H.api('POST', `/api/campus-events/registrations/${regId}/cancel`, b.token, {});
    assert.equal(c.status, 200, JSON.stringify(c.body));
    await H.idle();
    assert.equal((await H.ctx.M('CeRegistration').findByPk(regId)).paymentStatus, 'REFUNDED');
    assert.equal(Number((await H.ctx.M('User').findByPk(a.id)).walletBalance), 300, 'payer refunded');
    assert.equal(Number((await H.ctx.M('User').findByPk(b.id)).walletBalance), 0, 'new captain not paid for money they never spent');
  } finally {
    await H.setWallet(false);
  }
});
