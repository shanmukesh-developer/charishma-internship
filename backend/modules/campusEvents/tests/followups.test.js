// Follow-up batch (18 Oct): status isStaff / isOrganizer, deadline sort, clubs list, join-link preview,
// organizer PATCH only real changes, answer labels from a question snapshot, admin events / registrations /
// audit filters + search, minParticipants / waitlistOfferMinutes in payloads, check-in for approved-but-
// scheduled events, TICKET_SECRET_MISSING, admin user search, categories, admin approve / reject registrations.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(async () => { await H.setup({ label: 'ce-followups' }); await H.setFlag(true); });
test.after(async () => { await H.teardown(); });

const status = async (u) => (await H.api('GET', '/api/campus-events/status', u.token)).body;
const mkClub = async (managers, { verified = true, name = 'Robotics Club', campusRow } = {}) => H.ctx.M('FriendsEntity').create({
  campusId: (campusRow || await H.campus()).id, type: 'club', name, handle: `club${Date.now()}${Math.random().toString(36).slice(2, 6)}`, verified, managerIds: managers.map((m) => m.id), status: 'active',
});

test('1) /status: isOrganizer (ACTIVE organizer) + isStaff (staff grant, organizer of an event, admin)', async () => {
  const s = await H.mkStudent();
  let st = await status(s);
  assert.equal(st.isOrganizer, false);
  assert.equal(st.isStaff, false);
  const org = await H.mkOrganizer();
  st = await status(org);
  assert.equal(st.isOrganizer, true);
  assert.equal(st.isStaff, false, 'organizer without an approved event has nothing to check in');
  const { event: draft } = await H.mkEvent({ organizer: org, approve: false });
  assert.equal((await status(org)).isStaff, false, 'a draft is not enough');
  await H.mkEvent({ organizer: org });
  assert.equal((await status(org)).isStaff, true);
  const helper = await H.mkStudent();
  const g = await H.api('POST', `/api/campus-events/organizer/events/${draft.id}/staff`, org.token, { userId: helper.id });
  assert.equal(g.status, 201);
  st = await status(helper);
  assert.equal(st.isStaff, true, 'an ACTIVE staff grant');
  assert.equal(st.isOrganizer, false);
  await H.api('POST', `/api/campus-events/organizer/events/${draft.id}/staff/${g.body.staff.id}/revoke`, org.token);
  assert.equal((await status(helper)).isStaff, false, 'revoked grant');
  assert.equal((await status(await H.admin())).isStaff, true);
  // Suspended organizer: isOrganizer false.
  await H.ctx.M('CeOrganizer').update({ status: 'SUSPENDED' }, { where: { userId: org.id } });
  assert.equal((await status(org)).isOrganizer, false);
});

test('2) browse sort=deadline: open registrations only, closing soonest first (no close time = start time)', async () => {
  const s = await H.mkStudent();
  const now = H.now();
  const iso = (h) => new Date(now + h * H.HOUR).toISOString();
  const { event: a } = await H.mkEvent({ title: 'Deadline Alpha', startInH: 72, regClosesAt: iso(30) });
  const { event: b } = await H.mkEvent({ title: 'Deadline Bravo', startInH: 72, regClosesAt: iso(10) });
  const { event: c } = await H.mkEvent({ title: 'Deadline Charlie', startInH: 20 });
  const { event: d } = await H.mkEvent({ title: 'Deadline Delta', startInH: 72, regOpensAt: iso(5), regClosesAt: iso(8) });
  const ids = async (qs) => (await H.api('GET', `/api/campus-events?q=Deadline&${qs}`, s.token)).body.events.map((e) => e.id);
  assert.deepEqual(await ids('sort=deadline'), [b.id, c.id, a.id]);
  assert.ok(!(await ids('sort=deadline')).includes(d.id), 'not yet open -> no deadline to beat');
  const byDate = await ids('sort=date');
  assert.equal(byDate.length, 4, 'date sort keeps not-yet-open events');
  assert.equal(byDate[0], c.id);
  // Paging keeps the order.
  const p1 = await H.api('GET', '/api/campus-events?q=Deadline&sort=deadline&limit=2', s.token);
  assert.deepEqual(p1.body.events.map((e) => e.id), [b.id, c.id]);
  const p2 = await H.api('GET', `/api/campus-events?q=Deadline&sort=deadline&limit=2&cursor=${p1.body.nextCursor}`, s.token);
  assert.deepEqual(p2.body.events.map((e) => e.id), [a.id]);
  // After B closes it drops out.
  H.advance(11 * H.HOUR);
  assert.deepEqual(await ids('sort=deadline'), [c.id, a.id]);
  H.setNow(now);
});

test('3) GET /clubs: verified clubs of my campus with published events (+ eventCount); filter works with it', async () => {
  const org = await H.mkOrganizer();
  const s = await H.mkStudent();
  const club = await mkClub([org], { name: 'Drone Club' });
  const quiet = await mkClub([org], { name: 'Quiet Club' });
  await H.mkEvent({ organizer: org, entityId: club.id, title: 'Drone soccer' });
  await H.mkEvent({ organizer: org, entityId: club.id, title: 'Drone race' });
  await H.mkEvent({ organizer: org, entityId: quiet.id, title: 'Quiet draft', approve: false });
  const other = await H.mkCampus('Other Campus');
  const outsider = await H.mkOrganizer({ campusRow: other });
  const farClub = await mkClub([outsider], { name: 'Far Club', campusRow: other });
  await H.mkEvent({ organizer: outsider, entityId: farClub.id, title: 'Far event' });
  const r = await H.api('GET', '/api/campus-events/clubs', s.token);
  assert.equal(r.status, 200);
  const names = r.body.clubs.map((x) => x.name);
  assert.ok(names.includes('Drone Club'));
  assert.ok(!names.includes('Quiet Club'), 'draft-only club not listed');
  assert.ok(!names.includes('Far Club'), 'other campus not listed');
  const drone = r.body.clubs.find((x) => x.name === 'Drone Club');
  assert.equal(drone.eventCount, 2);
  assert.deepEqual(Object.keys(drone).sort(), ['eventCount', 'id', 'name', 'type', 'verified']);
  const f = await H.api('GET', `/api/campus-events?entityId=${drone.id}`, s.token);
  assert.equal(f.body.events.length, 2);
  await club.update({ verified: false });
  assert.ok(!(await H.api('GET', '/api/campus-events/clubs', s.token)).body.clubs.some((x) => x.name === 'Drone Club'), 'unverified club dropped');
  await H.setFlag(false);
  assert.equal((await H.api('GET', '/api/campus-events/clubs', s.token)).status, 403, 'feature gate');
  await H.setFlag(true);
});

test('4) join-link preview: team, event, roster count, captain first name; no PII; invalid 404; rate-limited', async () => {
  const { event } = await H.mkEvent({ format: 'TEAM', maxTeams: 3, teamMin: 2, teamMax: 3, title: 'Preview Cup' });
  const cap = await H.mkStudent({ name: 'Ravi Kumar Captain' });
  const { body: { team } } = await H.api('POST', `/api/campus-events/${event.id}/teams`, cap.token, { name: 'Preview XI' });
  const link = await H.api('POST', `/api/campus-events/teams/${team.id}/join-link`, cap.token);
  const s = await H.mkStudent();
  const p = await H.api('GET', `/api/campus-events/team-join/preview?t=${link.body.token}`, s.token);
  assert.equal(p.status, 200);
  const pv = p.body.preview;
  assert.equal(pv.team.name, 'Preview XI');
  assert.equal(pv.team.rosterCount, 1);
  assert.equal(pv.team.teamMax, 3);
  assert.equal(pv.team.captainFirstName, 'Ravi');
  assert.equal(pv.event.title, 'Preview Cup');
  assert.equal(pv.canJoin, true);
  assert.equal(pv.alreadyMember, false);
  const raw = JSON.stringify(p.body);
  for (const leak of [cap.id, cap.phone, cap.email, 'Captain', team.id]) assert.equal(raw.includes(leak), false, `no ${leak}`);
  assert.equal((await H.ctx.M('CeTeamMember').count({ where: { teamId: team.id } })), 1, 'preview adds nobody');
  assert.equal((await H.api('GET', `/api/campus-events/team-join/preview?t=${'x'.repeat(43)}`, s.token)).status, 404);
  assert.equal((await H.api('GET', '/api/campus-events/team-join/preview', s.token)).status, 404);
  // Join, then preview says already a member.
  assert.equal((await H.api('POST', '/api/campus-events/team-join', s.token, { token: link.body.token })).status, 200);
  const after = (await H.api('GET', `/api/campus-events/team-join/preview?t=${link.body.token}`, s.token)).body.preview;
  assert.equal(after.alreadyMember, true);
  assert.equal(after.canJoin, false);
  assert.equal(after.team.rosterCount, 2);
  // Revoked link -> 404.
  await H.api('POST', `/api/campus-events/teams/${team.id}/join-link/revoke`, cap.token);
  assert.equal((await H.api('GET', `/api/campus-events/team-join/preview?t=${link.body.token}`, s.token)).status, 404);
  // Rate limit (30 / 10 min per account).
  const spammer = await H.mkStudent();
  let last;
  for (let i = 0; i < 31; i++) last = await H.api('GET', `/api/campus-events/team-join/preview?t=${'y'.repeat(43)}`, spammer.token);
  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'RATE_LIMITED');
});

test('5) organizer PATCH on a live event: unchanged fields ignored; only real material changes go to pendingChanges', async () => {
  const { event, organizer: org } = await H.mkEvent({ capacity: 20, title: 'Patch Talk', venue: 'Hall A' });
  const full = (await H.api('GET', `/api/campus-events/organizer/events/${event.id}`, org.token)).body.event;
  const same = {
    title: full.title, venue: full.venue, category: full.category, startAt: full.startAt, endAt: full.endAt, capacity: full.capacityRaw,
    priceType: full.price.priceType, price: full.rawPrice, eligibility: { years: [], branches: [], adultOnly: false }, rules: full.rules,
    questions: full.questions, waitlistEnabled: full.waitlistEnabled, cancellationPolicy: { userCancelUntilHours: null, refundPct: null, text: '' },
  };
  let r = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}`, org.token, { ...same, description: 'A brand new description.' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.pendingReview, [], 'nothing material changed');
  assert.equal(r.body.event.pendingChanges, null);
  assert.equal(r.body.event.description, 'A brand new description.', 'cosmetic applied');
  r = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}`, org.token, { ...same, capacity: 30 });
  assert.deepEqual(r.body.pendingReview, ['capacity']);
  assert.deepEqual(Object.keys(r.body.event.pendingChanges.fields), ['capacity']);
  r = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}`, org.token, { ...same, venue: 'Hall B' });
  assert.deepEqual(r.body.pendingReview, ['venue']);
  assert.deepEqual(Object.keys(r.body.event.pendingChanges.fields).sort(), ['venue'], 'capacity sent back at its live value drops out');
  r = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}`, org.token, { venue: 'Hall A' });
  assert.deepEqual(r.body.pendingReview, []);
  assert.equal(r.body.event.pendingChanges, null, 'reverting the last pending field clears the request');
  const v0 = (await H.ctx.M('CeEvent').findByPk(event.id)).version;
  r = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}`, org.token, same);
  assert.equal((await H.ctx.M('CeEvent').findByPk(event.id)).version, v0, 'a no-op PATCH changes nothing');
});

test('6) registration answers carry their labels from a snapshot taken at registration', async () => {
  const QUESTIONS = [{ id: 'tshirt', label: 'T-shirt size', type: 'CHOICE', options: ['S', 'M', 'L'] }, { id: 'diet', label: 'Food preference', type: 'TEXT', required: false }];
  const { event, organizer: org } = await H.mkEvent({ capacity: 5, questions: QUESTIONS, title: 'Labels Fest' });
  const s = await H.mkStudent({ name: 'Asha Rao' });
  const reg = await H.register(event.id, s, { answers: { tshirt: 'M', diet: 'Veg' } });
  assert.equal(reg.status, 201);
  assert.deepEqual(reg.body.registration.answerDetails, [{ id: 'tshirt', label: 'T-shirt size', type: 'CHOICE', value: 'M' }, { id: 'diet', label: 'Food preference', type: 'TEXT', value: 'Veg' }]);
  assert.deepEqual(reg.body.registration.answers, { tshirt: 'M', diet: 'Veg' }, 'old map kept');
  const row = await H.ctx.M('CeRegistration').findByPk(reg.body.registration.id);
  assert.equal(row.questionsSnapshot.length, 2);
  // Organizer renames the question (material -> admin approves). The registration keeps the label it answered.
  const e = await H.api('PATCH', `/api/campus-events/organizer/events/${event.id}`, org.token, { questions: [{ id: 'tshirt', label: 'Jersey size', type: 'CHOICE', options: ['S', 'M', 'L'] }] });
  assert.deepEqual(e.body.pendingReview, ['questions']);
  assert.equal((await H.api('POST', `/api/admin/campus-events/events/${event.id}/changes/approve`, (await H.admin()).token)).status, 200);
  const mine = (await H.api('GET', `/api/campus-events/registrations/${row.id}`, s.token)).body.registration;
  assert.equal(mine.answerDetails[0].label, 'T-shirt size');
  const list = (await H.api('GET', `/api/campus-events/organizer/events/${event.id}/registrations`, org.token)).body;
  const p = list.registrations.find((x) => x.id === row.id);
  assert.equal(p.answerDetails.find((a) => a.id === 'tshirt').label, 'T-shirt size');
  assert.equal(list.questions[0].label, 'Jersey size');
  // A newer registrant answers the new label.
  const s2 = await H.mkStudent();
  const r2 = await H.register(event.id, s2, { answers: { tshirt: 'L' } });
  assert.equal(r2.body.registration.answerDetails[0].label, 'Jersey size');
  // Pre-snapshot rows fall back to the event's current questions.
  await row.update({ questionsSnapshot: null });
  assert.equal((await H.api('GET', `/api/campus-events/registrations/${row.id}`, s.token)).body.registration.answerDetails[0].label, 'Jersey size');
  // Slot hold -> confirm also snapshots.
  const { event: se, slots } = await H.mkEvent({ format: 'SLOT', capacity: 2, questions: [{ id: 'team', label: 'Club name', type: 'TEXT' }] });
  const s3 = await H.mkStudent();
  const h = await H.api('POST', `/api/campus-events/${se.id}/slots/${slots[0].id}/hold`, s3.token, {});
  assert.equal(h.status, 201);
  const c = await H.api('POST', `/api/campus-events/registrations/${h.body.registration.id}/confirm`, s3.token, { answers: { team: 'Robotics' }, acceptRules: true, rulesVersion: 1 });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.registration.answerDetails, [{ id: 'team', label: 'Club name', type: 'TEXT', value: 'Robotics' }]);
});

test('7) admin events list filters category + entityId (club) on the server', async () => {
  const adm = await H.admin();
  const org = await H.mkOrganizer();
  const club = await mkClub([org], { name: 'Filter Club' });
  const { event: a } = await H.mkEvent({ organizer: org, entityId: club.id, category: 'HACKATHON', title: 'Filter hack' });
  const { event: b } = await H.mkEvent({ organizer: org, category: 'HACKATHON', title: 'Filter hack 2' });
  const { event: c } = await H.mkEvent({ organizer: org, entityId: club.id, category: 'SPORTS', title: 'Filter sport' });
  const ids = async (qs) => (await H.api('GET', `/api/admin/campus-events/events?${qs}&limit=200`, adm.token)).body.events.map((e) => e.id);
  const hack = await ids('category=HACKATHON');
  assert.ok(hack.includes(a.id) && hack.includes(b.id) && !hack.includes(c.id));
  assert.deepEqual((await ids(`entityId=${club.id}`)).sort(), [a.id, c.id].sort());
  assert.deepEqual(await ids(`entityId=${club.id}&category=hackathon`), [a.id]);
  assert.deepEqual((await ids(`entityId=${club.id}&category=HACKATHON,SPORTS&bucket=published`)).sort(), [a.id, c.id].sort());
  assert.equal((await H.api('GET', '/api/admin/campus-events/events?category=NOPE', adm.token)).status, 400);
});

test('8) admin registrations: search by code / name / phone last 4; ticket summary + masked phone per row', async () => {
  const adm = await H.admin();
  const { event } = await H.mkEvent({ capacity: 5, title: 'Search Meetup' });
  const s = await H.mkStudent({ name: 'Zubin Searchable' });
  const t = await H.mkStudent({ name: 'Other Person' });
  const rs = (await H.register(event.id, s)).body.registration;
  await H.register(event.id, t);
  const q = async (text) => (await H.api('GET', `/api/admin/campus-events/registrations?eventId=${event.id}&q=${encodeURIComponent(text)}`, adm.token)).body.registrations;
  assert.deepEqual((await q(rs.code)).map((r) => r.id), [rs.id]);
  assert.deepEqual((await q(rs.code.slice(3))).map((r) => r.id), [rs.id], 'without EV-');
  assert.deepEqual((await q('searchable')).map((r) => r.id), [rs.id]);
  assert.deepEqual((await q(s.phone.slice(-4))).map((r) => r.id), [rs.id]);
  assert.equal((await q('zzqqxx-nothing')).length, 0);
  const row = (await q(rs.code))[0];
  assert.equal(row.ticket.code, rs.tickets[0].ticketCode);
  assert.equal(row.ticket.id, rs.tickets[0].id);
  assert.equal(row.ticket.status, 'ACTIVE');
  assert.equal(row.phoneMasked, `******${s.phone.slice(-4)}`);
  assert.equal(JSON.stringify(row).includes(s.phone), false, 'never the full phone');
  const all = (await H.api('GET', `/api/admin/campus-events/registrations?eventId=${event.id}`, adm.token)).body.registrations;
  assert.equal(all.length, 2);
});

test('9) admin audit: actor first name + filters action (exact / family) and actorRole', async () => {
  const adm = await H.admin();
  const { event } = await H.mkEvent({ capacity: 3, title: 'Audit Night' });
  const a = await H.api('GET', `/api/admin/campus-events/audit?eventId=${event.id}`, adm.token);
  const approve = a.body.audit.find((x) => x.action === 'event.approve');
  assert.equal(approve.actorRole, 'admin');
  assert.equal(approve.actorName, 'Test');
  const create = a.body.audit.find((x) => x.action === 'event.create');
  assert.equal(create.actorName, 'Club');
  const only = (await H.api('GET', `/api/admin/campus-events/audit?eventId=${event.id}&action=event.approve`, adm.token)).body.audit;
  assert.ok(only.length >= 1 && only.every((x) => x.action === 'event.approve'));
  const fam = (await H.api('GET', `/api/admin/campus-events/audit?eventId=${event.id}&action=event`, adm.token)).body.audit.map((x) => x.action);
  assert.ok(fam.includes('event.create') && fam.includes('event.submit') && fam.includes('event.approve'));
  const byRole = (await H.api('GET', `/api/admin/campus-events/audit?eventId=${event.id}&actorRole=organizer`, adm.token)).body.audit;
  assert.ok(byRole.length >= 2 && byRole.every((x) => x.actorRole === 'organizer'));
  assert.equal((await H.api('GET', '/api/admin/campus-events/audit?action=nothing.like.this', adm.token)).body.audit.length, 0);
});

test('10) event payloads include minParticipants + waitlistOfferMinutes', async () => {
  const { event, organizer: org } = await H.mkEvent({ capacity: 8, minParticipants: 4, waitlistOfferMinutes: 45, title: 'Min Fields' });
  assert.equal(event.minParticipants, 4, 'admin approve payload');
  assert.equal(event.waitlistOfferMinutes, 45);
  const adm = (await H.api('GET', `/api/admin/campus-events/events/${event.id}`, (await H.admin()).token)).body.event;
  assert.equal(adm.minParticipants, 4);
  assert.equal(adm.waitlistOfferMinutes, 45);
  const o = (await H.api('GET', `/api/campus-events/organizer/events/${event.id}`, org.token)).body.event;
  assert.equal(o.minParticipants, 4);
  const pub = (await H.api('GET', `/api/campus-events/${event.id}`, (await H.mkStudent()).token)).body.event;
  assert.equal(pub.waitlistOfferMinutes, 45);
  const { event: plain } = await H.mkEvent({ capacity: 2 });
  assert.equal(plain.minParticipants, null);
  assert.equal(plain.waitlistOfferMinutes, null);
});

test('11) check-in staff for approved-but-scheduled events (APPROVED, future publishAt): grant + listed', async () => {
  const adm = await H.admin();
  const org = await H.mkOrganizer();
  const { event } = await H.mkEvent({ organizer: org, approve: false, title: 'Scheduled Gala', capacity: 5 });
  assert.equal((await H.api('POST', `/api/campus-events/organizer/events/${event.id}/submit`, org.token)).status, 200);
  const ap = await H.api('POST', `/api/admin/campus-events/events/${event.id}/approve`, adm.token, { publishAt: new Date(H.now() + 6 * H.HOUR).toISOString() });
  assert.equal(ap.body.event.status, 'APPROVED');
  const staff = await H.mkStudent();
  const g = await H.api('POST', `/api/campus-events/organizer/events/${event.id}/staff`, org.token, { userId: staff.id });
  assert.equal(g.status, 201);
  const staff2 = await H.mkStudent();
  assert.equal((await H.api('POST', `/api/admin/campus-events/events/${event.id}/staff`, adm.token, { userId: staff2.id })).status, 201);
  for (const u of [staff, staff2, org]) {
    const list = (await H.api('GET', '/api/campus-events/check-in/events', u.token)).body.events;
    const row = list.find((x) => x.id === event.id);
    assert.ok(row, 'approved event in the check-in list');
    assert.equal(row.status, 'APPROVED');
    assert.ok(row.publishAt);
  }
  assert.equal((await status(staff)).isStaff, true);
  // Validate works (no tickets yet -> INVALID, not 403).
  const v = await H.api('POST', '/api/campus-events/check-in/validate', staff.token, { eventId: event.id, code: 'ZZZZZZZZZZ' });
  assert.equal(v.status, 200);
  assert.equal(v.body.result, 'INVALID');
  // Organizer of an approved event shows the shortcut too.
  assert.equal((await status(org)).isStaff, true);
});

test('12) enabling CAMPUS_EVENTS_ENABLED without the ticket secret in production -> 409 TICKET_SECRET_MISSING', async () => {
  const adm = await H.admin();
  const prevRender = process.env.RENDER;
  process.env.RENDER = 'true';
  const prevErr = console.error;
  console.error = () => {};
  try {
    const r = await H.api('PUT', '/api/admin/campus-events/settings', adm.token, { enabled: true });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'TICKET_SECRET_MISSING');
    const off = await H.api('PUT', '/api/admin/campus-events/settings', adm.token, { enabled: false });
    assert.equal(off.status, 200, 'turning it off is always allowed');
    assert.equal(off.body.enabled, false);
    const other = await H.api('PUT', '/api/admin/campus-events/settings', adm.token, { settings: { holdMinutes: 12 } });
    assert.equal(other.status, 200, 'other settings still save');
    process.env.CAMPUS_EVENTS_TICKET_SECRET = 'a-real-looking-ticket-secret-123456';
    const ok = await H.api('PUT', '/api/admin/campus-events/settings', adm.token, { enabled: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.enabled, true);
  } finally {
    if (prevRender === undefined) delete process.env.RENDER; else process.env.RENDER = prevRender;
    delete process.env.CAMPUS_EVENTS_TICKET_SECRET;
    console.error = prevErr;
    await H.api('PUT', '/api/admin/campus-events/settings', adm.token, { enabled: true, settings: { holdMinutes: 10 } });
  }
  assert.equal((await H.api('GET', '/api/admin/campus-events/settings', adm.token)).body.enabled, true);
});

test('13) admin user search for grants: id, name, masked phone / e-mail, campus, verified; no partners; admin only', async () => {
  const adm = await H.admin();
  const s = await H.mkStudent({ name: 'Grantable Gaurav' });
  const u = await H.mkStudent({ name: 'Grantable Unverified', verified: false });
  await H.mkStudent({ name: 'Grantable Rider', role: 'rider', noProfile: true });
  const r = await H.api('GET', '/api/admin/campus-events/users?q=grantable', adm.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.users.map((x) => x.name).sort(), ['Grantable Gaurav', 'Grantable Unverified']);
  const g = r.body.users.find((x) => x.id === s.id);
  assert.equal(g.verified, true);
  assert.equal(g.campus.name, 'SRM University-AP');
  assert.equal(g.phoneMasked, `******${s.phone.slice(-4)}`);
  assert.match(g.emailMasked, /^\d\*\*\*@test\.local$/);
  assert.equal(r.body.users.find((x) => x.id === u.id).verified, false);
  assert.equal(JSON.stringify(r.body).includes(s.phone), false);
  assert.equal(JSON.stringify(r.body).includes(s.email), false);
  assert.deepEqual((await H.api('GET', `/api/admin/campus-events/users?q=${s.phone.slice(-6)}`, adm.token)).body.users.map((x) => x.id), [s.id]);
  assert.equal((await H.api('GET', '/api/admin/campus-events/users?q=g', adm.token)).status, 400);
  assert.equal((await H.api('GET', '/api/admin/campus-events/users?q=grantable', s.token)).status, 403);
  // The search result plugs straight into the grant.
  const grant = await H.api('POST', '/api/admin/campus-events/organizers', adm.token, { userId: g.id });
  assert.equal(grant.status, 201);
  assert.equal((await H.api('GET', '/api/admin/campus-events/users?q=gaurav', adm.token)).body.users[0].organizerStatus, 'ACTIVE');
});

test('14) categories endpoint + admin approve / reject of PENDING_APPROVAL registrations (audited)', async () => {
  const adm = await H.admin();
  const s0 = await H.mkStudent();
  for (const [u, url] of [[s0, '/api/campus-events/categories'], [adm, '/api/admin/campus-events/categories']]) {
    const c = await H.api('GET', url, u.token);
    assert.equal(c.status, 200);
    assert.equal(c.body.categories.length, 11);
    assert.deepEqual(c.body.categories[0], { key: 'SPORTS', label: 'Sports', icon: '⚽', section: 'sports' });
    assert.ok(c.body.categories.every((x) => x.label && x.icon));
  }
  const { event } = await H.mkEvent({ capacity: 3, approvalRequired: true, title: 'Approval Jam' });
  const a = await H.mkStudent();
  const b = await H.mkStudent();
  const ra = (await H.register(event.id, a)).body.registration;
  const rb = (await H.register(event.id, b)).body.registration;
  assert.equal(ra.status, 'PENDING_APPROVAL');
  const pend = (await H.api('GET', `/api/admin/campus-events/registrations?eventId=${event.id}&status=PENDING_APPROVAL`, adm.token)).body.registrations;
  assert.equal(pend.length, 2);
  const ok = await H.api('POST', `/api/admin/campus-events/registrations/${ra.id}/approve`, adm.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.registration.status, 'CONFIRMED');
  assert.equal(await H.ctx.M('CeTicket').count({ where: { registrationId: ra.id, status: 'ACTIVE' } }), 1, 'ticket issued');
  assert.equal((await H.api('POST', `/api/admin/campus-events/registrations/${ra.id}/approve`, adm.token)).status, 409, 'not pending any more');
  assert.equal((await H.api('POST', `/api/admin/campus-events/registrations/${rb.id}/reject`, adm.token, {})).status, 400, 'reason required');
  const no = await H.api('POST', `/api/admin/campus-events/registrations/${rb.id}/reject`, adm.token, { reason: 'Seats are for final years' });
  assert.equal(no.status, 200);
  assert.equal(no.body.registration.status, 'REJECTED');
  assert.equal((await H.ctx.M('CeEvent').findByPk(event.id)).unitsLive, 1, 'rejected unit released');
  const audit = await H.ctx.M('CeAuditLog').findAll({ where: { eventId: event.id } });
  assert.ok(audit.some((x) => x.action === 'registration.approve' && x.actorRole === 'admin'));
  assert.ok(audit.some((x) => x.action === 'registration.reject' && x.actorRole === 'admin'));
  const vlog = await H.ctx.M('VerificationLog').findAll({ where: { targetId: String(ra.id) } });
  assert.ok(vlog.some((x) => x.action === 'campus_events.registration.approve'));
  const notes = await H.notificationsFor(b.id);
  assert.ok(notes.length >= 1, 'the student is told');
  assert.equal((await H.api('POST', `/api/admin/campus-events/registrations/${ra.id}/approve`, s0.token)).status, 403, 'admins only');
  const inv = await H.checkInvariants(event.id);
  assert.deepEqual(inv.problems, []);
});
