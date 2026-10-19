// PG v2: listing sections (highlights, house rules by category, policies, safety & staff, move-in,
// location guide, FAQ), the hidden-when-empty contract, stay reviews (eligibility, one per booking,
// report, admin hide), list-page promotions (validation, date windows, admin only) and GET /api/pg/home.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let admin; let student; let other;
test.before(async () => {
  await H.setup();
  admin = await H.mkUser({ role: 'admin' });
  student = await H.mkUser();
  other = await H.mkUser();
});
test.after(H.teardown);

const C = () => H.r('utils/pgContent');
const throwsField = (fn, field) => assert.throws(fn, (e) => e instanceof C().PgInputError && (!field || String(e.field).startsWith(field)), `expected a ${field || ''} error`);

// ── Unit: section validators ────────────────────────────────────────────────────────────────────
test('unit: highlights - up to 6 short unique lines, emoji dropped, phone numbers refused', () => {
  const { validateHighlights } = C();
  assert.deepStrictEqual(validateHighlights(['  5 min walk to Gate 1 ', 'Food included 🍛', '', '24×7 security']), ['5 min walk to Gate 1', 'Food included', '24×7 security']);
  assert.deepStrictEqual(validateHighlights(null), []);
  throwsField(() => validateHighlights(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'highlights');
  throwsField(() => validateHighlights(['x'.repeat(41)]), 'highlights');
  throwsField(() => validateHighlights(['Food included', 'food included']), 'highlights');
  throwsField(() => validateHighlights(['Call 98765 43210']), 'highlights');
  throwsField(() => validateHighlights('Food included'), 'highlights');
});

test('unit: house rules - known categories once each, canonical order, empty groups dropped; legacy rules readable', () => {
  const { validateHouseRules, houseRulesForRead } = C();
  const out = validateHouseRules([
    { category: 'smoking', rules: ['No smoking inside rooms'] },
    { category: 'visitors', rules: ['Visitors in the lobby only', ''] },
    { category: 'pets', rules: [] },
  ]);
  assert.deepStrictEqual(out, [{ category: 'visitors', rules: ['Visitors in the lobby only'] }, { category: 'smoking', rules: ['No smoking inside rooms'] }]);
  throwsField(() => validateHouseRules([{ category: 'parties', rules: ['x'] }]), 'houseRules[0]');
  throwsField(() => validateHouseRules([{ category: 'gate', rules: ['a'] }, { category: 'gate', rules: ['b'] }]), 'houseRules[1]');
  throwsField(() => validateHouseRules([{ category: 'gate', rules: Array.from({ length: 11 }, (_, i) => `Rule ${i}`) }]));
  assert.deepStrictEqual(houseRulesForRead({ rules: ['No ragging ✅'] }), [{ category: 'other', label: 'General', rules: ['No ragging'] }]);
  assert.deepStrictEqual(houseRulesForRead({ houseRules: out, rules: ['old'] }).map((g) => g.label), ['Visitors & guests', 'Smoking & alcohol']);
  assert.deepStrictEqual(houseRulesForRead({}), []);
});

test('unit: policies - numbers in range, late fee needs a unit, known methods / inclusions, charges complete; empty is null', () => {
  const { validatePolicies } = C();
  const p = validatePolicies({
    booking: { steps: 'Visit, pick a bed, pay the token at the PG.', tokenAmount: '2000' },
    rent: { dueDay: 5, lateFee: 100, lateFeeUnit: 'day', methods: ['upi', 'cash', 'upi'] },
    deposit: { amount: 10000, refundDays: 15, deductions: 'Damage beyond normal wear.' },
    stay: { noticeMonths: 1, lockInMonths: 3 },
    cancellation: { freeCancelDays: 7, refundPercent: 50 },
    included: ['wifi', 'food'],
    extraCharges: [{ item: 'Electricity', amount: 10, unit: 'unit' }, { item: '', amount: '' }],
    maintenance: { responseHours: 24 },
  });
  assert.deepStrictEqual(p.rent, { dueDay: 5, lateFee: 100, lateFeeUnit: 'day', methods: ['cash', 'upi'] });
  assert.deepStrictEqual(p.included, ['food', 'wifi']);
  assert.deepStrictEqual(p.extraCharges, [{ item: 'Electricity', amount: 10, unit: 'unit' }]);
  assert.strictEqual(p.booking.tokenAmount, 2000);
  assert.strictEqual(validatePolicies({}), null);
  assert.strictEqual(validatePolicies({ rent: { methods: [] }, extraCharges: [] }), null);
  assert.strictEqual(validatePolicies(null), null);
  for (const bad of [
    { rent: { dueDay: 0 } }, { rent: { dueDay: 29 } }, { rent: { dueDay: 5.5 } },
    { rent: { lateFee: 100 } }, { rent: { methods: ['card'] } },
    { deposit: { amount: -1 } }, { deposit: { refundDays: 400 } },
    { stay: { noticeMonths: 7 } }, { stay: { lockInMonths: 25 } },
    { cancellation: { refundPercent: 101 } }, { included: ['gym'] },
    { extraCharges: [{ item: 'Electricity', amount: 10 }] }, { extraCharges: [{ amount: 10, unit: 'unit' }] },
    { maintenance: { responseHours: 0 } }, { rent: 'monthly' },
    { rent: { notes: 'Pay the owner on 9876543210' } },
  ]) throwsField(() => validatePolicies(bad));
});

test('unit: safety - enums, guard hours need both times, booleans, no phone numbers anywhere', () => {
  const { validateSafety } = C();
  assert.deepStrictEqual(validateSafety({ cctv: true, entry: 'biometric', guard: 'hours', guardFrom: '8:00 PM', guardTo: '06:00', firstAid: false, wardenName: 'Mrs. Lakshmi', wardenAvailability: 'On site, 8 am to 10 pm' }),
    { cctv: true, entry: 'biometric', guard: 'hours', guardFrom: '20:00', guardTo: '06:00', firstAid: false, wardenName: 'Mrs. Lakshmi', wardenAvailability: 'On site, 8 am to 10 pm' });
  assert.deepStrictEqual(validateSafety({ guard: '24x7', guardFrom: '01:00' }), { guard: '24x7' }, 'times only kept for custom hours');
  assert.strictEqual(validateSafety({ cctv: null, wardenName: '' }), null);
  throwsField(() => validateSafety({ guard: 'hours', guardFrom: '20:00' }), 'safety.guardTo');
  throwsField(() => validateSafety({ entry: 'retina' }));
  throwsField(() => validateSafety({ cctv: 'yes' }));
  throwsField(() => validateSafety({ wardenName: 'Ravi 9876543210' }));
  throwsField(() => validateSafety({ emergency: 'Call +91 98765-43210 at night.' }));
});

test('unit: move-in, location guide (sorted by distance), FAQ limits', () => {
  const { validateMoveIn, validateLocationGuide, validateFaq } = C();
  assert.deepStrictEqual(validateMoveIn({ documents: ['College ID', 'Government ID copy'], bring: [], steps: ['Pay the token', 'Collect keys'] }),
    { documents: ['College ID', 'Government ID copy'], steps: ['Pay the token', 'Collect keys'] });
  assert.strictEqual(validateMoveIn({ documents: [''] }), null);
  throwsField(() => validateMoveIn({ documents: Array.from({ length: 13 }, (_, i) => `Doc ${i}`) }));

  const g = validateLocationGuide({ howToReach: 'Take the campus road.', nearby: [
    { name: 'Apollo Pharmacy', category: 'pharmacy', distanceM: 900 },
    { name: 'SRM AP Gate 1', category: 'college', distanceM: 350, walkMinutes: 5 },
    { name: '', category: 'atm', distanceM: 10 },
  ] });
  assert.deepStrictEqual(g.nearby.map((n) => n.name), ['SRM AP Gate 1', 'Apollo Pharmacy']);
  assert.strictEqual(g.nearby[0].walkMinutes, 5);
  throwsField(() => validateLocationGuide({ nearby: [{ name: 'Gym', category: 'spa', distanceM: 10 }] }));
  throwsField(() => validateLocationGuide({ nearby: [{ name: 'Gym', category: 'gym' }] }));
  throwsField(() => validateLocationGuide({ nearby: [{ name: 'Gym', category: 'gym', distanceM: 60000 }] }));
  throwsField(() => validateLocationGuide({ nearby: [{ name: 'Gym', distanceM: 10 }, { name: 'gym', distanceM: 20 }] }));
  assert.strictEqual(validateLocationGuide({ nearby: [] }), null);

  const faq = validateFaq([{ q: 'Is food included?', a: 'Yes, three meals a day.' }, { q: '', a: '' }]);
  assert.strictEqual(faq.length, 1);
  assert.match(faq[0].id, /^[a-z0-9]{6,24}$/);
  throwsField(() => validateFaq(Array.from({ length: 21 }, (_, i) => ({ q: `Q${i}?`, a: 'A' }))), 'faq');
  throwsField(() => validateFaq([{ q: 'Is food included?' }]), 'faq[0]');
  throwsField(() => validateFaq([{ q: 'Same?', a: 'a' }, { q: 'same?', a: 'b' }]), 'faq[1]');
});

test('unit: promotions - headline length, CTA vs type, YouTube id, date window', () => {
  const { validatePromotion } = C();
  const now = new Date('2026-10-19T06:00:00Z');
  const base = { type: 'VIDEO', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', headline: 'Tour the new block', hostelId: '7d1d2d4e-1111-4222-8333-944455556666', cta: 'WATCH_TOUR', startsAt: '2026-10-19', endsAt: '2026-11-19' };
  const ok = validatePromotion(base, { now }).values;
  assert.strictEqual(ok.youtubeId, 'dQw4w9WgXcQ');
  assert.strictEqual(ok.label, 'FEATURED');
  assert.strictEqual(ok.startsAt.toISOString(), '2026-10-18T18:30:00.000Z', 'a plain start date begins at IST midnight');
  assert.strictEqual(ok.endsAt.toISOString(), '2026-11-19T18:29:59.999Z', 'a plain end date is inclusive: the end of that IST day');
  const oneDay = validatePromotion({ ...base, endsAt: '2026-10-19' }, { now }).values;
  assert.strictEqual(oneDay.endsAt - oneDay.startsAt, 86400000 - 1, 'start and end on the same day: a one-day promotion');
  for (const bad of [
    { headline: 'x'.repeat(41) }, { headline: '' }, { subline: 'y'.repeat(61) },
    { type: 'GIF' }, { youtubeUrl: 'https://vimeo.com/1' }, { cta: 'CALL_NOW' }, { label: 'HOT' },
    { type: 'IMAGE', imageUrl: 'https://cdn.example.com/a.jpg' }, // Watch tour needs a video
    { type: 'IMAGE', cta: 'VIEW_PG' }, // no image
    { endsAt: '2026-10-18' }, { endsAt: '2028-01-01' }, { startsAt: 'soon' },
    { startsAt: '2026-01-01', endsAt: '2026-02-01' }, // already ended
    { hostelId: 'not-a-pg' }, { priority: 1000 },
  ]) throwsField(() => validatePromotion({ ...base, ...bad }, { now }));
});

test('unit: error fields are request-body paths, the same style in every section', () => {
  const c = C();
  const fieldOf = (fn) => { try { fn(); } catch (e) { return e.field; } return null; };
  assert.strictEqual(fieldOf(() => c.validateHighlights(['ok one', 'Call 9876543210'])), 'highlights[1]');
  assert.strictEqual(fieldOf(() => c.validateHouseRules([{ category: 'gate', rules: ['ok', 'x'.repeat(161)] }])), 'houseRules[0].rules[1]');
  assert.strictEqual(fieldOf(() => c.validatePolicies({ rent: { lateFee: 'abc' } })), 'policies.rent.lateFee');
  assert.strictEqual(fieldOf(() => c.validatePolicies({ booking: { tokenAmount: -5 } })), 'policies.booking.tokenAmount');
  assert.strictEqual(fieldOf(() => c.validatePolicies({ included: ['wifi', 'gym'] })), 'policies.included[1]');
  assert.strictEqual(fieldOf(() => c.validatePolicies({ extraCharges: [{ item: 'Electricity', amount: 10, unit: 'litre' }] })), 'policies.extraCharges[0].unit');
  assert.strictEqual(fieldOf(() => c.validateSafety({ cctv: 'yes' })), 'safety.cctv');
  assert.strictEqual(fieldOf(() => c.validateSafety({ guard: 'hours', guardFrom: '25:00', guardTo: '06:00' })), 'safety.guardFrom');
  assert.strictEqual(fieldOf(() => c.validateMoveIn({ documents: ['College ID', 'college id'] })), 'moveIn.documents[1]');
  assert.strictEqual(fieldOf(() => c.validateLocationGuide({ nearby: [{ name: 'Gate 1', distanceM: 0 }] })), 'locationGuide.nearby[0].distanceM');
  assert.strictEqual(fieldOf(() => c.validateLocationGuide({ howToReach: 'x'.repeat(601) })), 'locationGuide.howToReach');
  assert.strictEqual(fieldOf(() => c.validateFaq([{ q: 'Q?', a: 'A' }, { q: 'Second?' }])), 'faq[1].a');
});

// ── API: sections ───────────────────────────────────────────────────────────────────────────────
const fullSections = {
  highlights: { highlights: ['5 min walk to Gate 1', 'Food included'] },
  'house-rules': { houseRules: [{ category: 'gate', rules: ['Gate closes at 10:30 pm'] }] },
  policies: { policies: { rent: { dueDay: 5, methods: ['upi'] }, included: ['wifi'] } },
  safety: { safety: { cctv: true, wardenName: 'Mrs. Lakshmi' } },
  'move-in': { moveIn: { documents: ['College ID'] } },
  'location-guide': { locationGuide: { nearby: [{ name: 'SRM AP Gate 1', category: 'college', distanceM: 350 }] } },
  faq: { faq: [{ q: 'Is food included?', a: 'Yes.' }] },
};

test('sections: admin only (students and guests refused), saved, audited, cleared with null', async () => {
  const pg = await H.mkPg(admin);
  for (const [path, body] of Object.entries(fullSections)) {
    assert.strictEqual((await H.api('PUT', `/api/pg/${pg.id}/${path}`, null, body)).status, 401, path);
    assert.strictEqual((await H.api('PUT', `/api/pg/${pg.id}/${path}`, student.token, body)).status, 403, path);
    const ok = await H.api('PUT', `/api/pg/${pg.id}/${path}`, admin.token, body);
    assert.strictEqual(ok.status, 200, `${path} ${JSON.stringify(ok.body)}`);
  }
  const d = (await H.api('GET', `/api/pg/${pg.id}`)).body;
  assert.deepStrictEqual(d.highlights, ['5 min walk to Gate 1', 'Food included']);
  assert.deepStrictEqual(d.houseRules, [{ category: 'gate', label: 'Gate & curfew', rules: ['Gate closes at 10:30 pm'] }]);
  assert.deepStrictEqual(d.faq.map((f) => f.q), ['Is food included?']);
  for (const a of ['PG_HIGHLIGHTS_UPDATED', 'PG_RULES_UPDATED', 'PG_POLICIES_UPDATED', 'PG_SAFETY_UPDATED', 'PG_MOVEIN_UPDATED', 'PG_LOCATION_UPDATED', 'PG_FAQ_UPDATED']) {
    assert.strictEqual((await H.auditRows(a, pg.id)).length, 1, a);
  }
  const bad = await H.api('PUT', `/api/pg/${pg.id}/policies`, admin.token, { policies: { rent: { dueDay: 31 } } });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.code, 'INVALID_PG_CONTENT');
  assert.strictEqual(bad.body.field, 'policies.rent.dueDay');
  for (const [path, body] of Object.entries(fullSections)) {
    const field = Object.keys(body)[0];
    const res = await H.api('PUT', `/api/pg/${pg.id}/${path}`, admin.token, { [field]: null });
    assert.strictEqual(res.status, 200, path);
  }
  const cleared = (await H.api('GET', `/api/pg/${pg.id}`)).body;
  assert.deepStrictEqual([cleared.highlights, cleared.houseRules, cleared.policies, cleared.safety, cleared.moveIn, cleared.locationGuide, cleared.faq], [[], [], null, null, null, null, []]);
  assert.strictEqual((await H.api('PUT', `/api/pg/00000000-0000-4000-8000-000000000000/faq`, admin.token, { faq: [] })).status, 404);
});

test('section saves answer with the section exactly as stored; public reads keep their fallbacks', async () => {
  const pg = await H.mkPg(admin, { rules: ['No ragging'], contactInfo: { wardenName: 'Ravi' } });
  let res = await H.api('PUT', '/api/pg/' + pg.id + '/house-rules', admin.token, { houseRules: [] });
  assert.deepStrictEqual(res.body.houseRules, [], 'raw: nothing saved (not the legacy rules)');
  res = await H.api('PUT', '/api/pg/' + pg.id + '/safety', admin.token, { safety: { cctv: true } });
  assert.deepStrictEqual(res.body.safety, { cctv: true }, 'raw: no warden name from the contact fields');
  res = await H.api('PUT', '/api/pg/' + pg.id + '/policies', admin.token, { policies: {} });
  assert.strictEqual(res.body.policies, null);
  const d = (await H.api('GET', '/api/pg/' + pg.id)).body;
  assert.deepStrictEqual(d.houseRules, [{ category: 'other', label: 'General', rules: ['No ragging'] }]);
  assert.deepStrictEqual(d.safety, { cctv: true, wardenName: 'Ravi' });
});

test('public shape: no phone numbers or emails; hidden-when-empty section list in screen order', async () => {
  const pg = await H.mkPg(admin, { contactInfo: { ownerName: 'Owner', phone: '9000000001', email: 'owner@example.com', wardenName: 'Ravi', emergencyContact: '9000000002', lat: 16.46, lng: 80.5 } });
  let d = (await H.api('GET', `/api/pg/${pg.id}`)).body;
  const json = JSON.stringify(d);
  for (const secret of ['9000000001', '9000000002', 'owner@example.com']) assert.ok(!json.includes(secret), secret);
  assert.deepStrictEqual(Object.keys(d.contactInfo).sort(), ['lat', 'lng', 'ownerName', 'wardenName']);
  assert.deepStrictEqual(d.safety, { wardenName: 'Ravi' }, 'warden name only, from the contact fields');
  assert.deepStrictEqual(d.sections, ['overview', 'safety', 'location']);
  assert.deepStrictEqual(d.reviewSummary, { average: null, count: 0 });

  const bare = await H.mkPg(admin, { contactInfo: {} });
  d = (await H.api('GET', `/api/pg/${bare.id}`)).body;
  assert.deepStrictEqual(d.sections, ['overview'], 'nothing filled: only the overview');
  assert.deepStrictEqual([d.highlights, d.houseRules, d.policies, d.safety, d.moveIn, d.locationGuide, d.faq], [[], [], null, null, null, null, []]);

  await H.mkRoom(admin, bare.id);
  for (const [path, body] of Object.entries(fullSections)) await H.api('PUT', `/api/pg/${bare.id}/${path}`, admin.token, body);
  await H.api('PUT', `/api/pg/${bare.id}/mess`, admin.token, { messTimetable: { meals: [{ label: 'Lunch', start: '12:30', end: '14:00' }] } });
  d = (await H.api('GET', `/api/pg/${bare.id}`)).body;
  assert.deepStrictEqual(d.sections, ['overview', 'rooms', 'mess', 'rules', 'policies', 'safety', 'location', 'faq']);
  const item = (await H.api('GET', '/api/pg')).body.find((x) => x.id === bare.id);
  assert.strictEqual(item.hasAC, true);
  assert.strictEqual(item.foodIncluded, false);
  assert.deepStrictEqual(item.highlights, ['5 min walk to Gate 1', 'Food included']);
  assert.ok(!('safety' in item) && !('policies' in item));
});

// ── API: reviews ────────────────────────────────────────────────────────────────────────────────
const istYmd = (days = 0) => new Date(Date.now() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);
const bookAndConfirm = async (user, roomId, checkInDate = istYmd(0)) => {
  const b = await H.api('POST', `/api/pg/${roomId}/book`, user.token, { checkInDate });
  assert.strictEqual(b.status, 201, JSON.stringify(b.body));
  const c = await H.api('PUT', `/api/pg/admin/bookings/${b.body.booking.id}/status`, admin.token, { status: 'Confirmed' });
  assert.strictEqual(c.status, 200);
  return b.body.booking;
};

test('reviews: only students with a confirmed stay that has started; one per booking; public shape', async () => {
  const pg = await H.mkPg(admin);
  const room = await H.mkRoom(admin, pg.id, { totalBeds: 4, availableBeds: 4 });
  const body = { rating: 5, text: 'Clean rooms and the food is good.' };
  assert.strictEqual((await H.api('POST', `/api/pg/${pg.id}/reviews`, null, body)).status, 401);
  let r = await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, body);
  assert.strictEqual(r.status, 403, 'no booking');
  assert.strictEqual(r.body.code, 'REVIEW_NOT_ALLOWED');

  const pending = await H.api('POST', `/api/pg/${room.id}/book`, student.token, { checkInDate: istYmd(0) });
  assert.strictEqual(pending.status, 201);
  assert.strictEqual((await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, body)).status, 403, 'pending booking');
  await H.api('PUT', `/api/pg/bookings/${pending.body.booking.id}/cancel`, student.token);

  const future = await bookAndConfirm(other, room.id, istYmd(5));
  assert.strictEqual((await H.api('POST', `/api/pg/${pg.id}/reviews`, other.token, body)).status, 403, 'check-in not reached yet');
  let el = await H.api('GET', `/api/pg/${pg.id}/reviews/eligibility`, other.token);
  assert.strictEqual(el.body.canReview, false);
  await H.api('PUT', `/api/pg/admin/bookings/${future.id}/status`, admin.token, { status: 'Cancelled' });

  const stay = await bookAndConfirm(student, room.id);
  el = await H.api('GET', `/api/pg/${pg.id}/reviews/eligibility`, student.token);
  assert.strictEqual(el.body.canReview, true);
  assert.strictEqual((await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, { rating: 6, text: body.text })).status, 400);
  assert.strictEqual((await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, { rating: 4, text: 'ok' })).status, 400);
  assert.strictEqual((await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, { rating: 4, text: 'Warden number 9876543210' })).status, 400);
  r = await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, body);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.deepStrictEqual(Object.keys(r.body.review).sort(), ['createdAt', 'firstName', 'id', 'rating', 'text']);
  r = await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, body);
  assert.strictEqual(r.status, 409, 'one review per booking');
  r = await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, { ...body, bookingId: stay.id });
  assert.strictEqual(r.status, 409);
  r = await H.api('POST', `/api/pg/${pg.id}/reviews`, other.token, { ...body, bookingId: stay.id });
  assert.strictEqual(r.status, 403, "someone else's booking");

  // A second, earlier stay at the same PG (an older confirmed booking) may be reviewed once too.
  const older = await H.ctx.M('PGBooking').create({ userId: student.id, hostelId: pg.id, roomId: room.id, checkInDate: new Date(Date.now() - 400 * 86400000), status: 'Confirmed' });
  r = await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, { rating: 3, text: 'Last year the water supply was patchy.' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await H.ctx.M('PGReview').findOne({ where: { id: r.body.review.id } })).bookingId, older.id);
  assert.strictEqual((await H.api('POST', `/api/pg/${pg.id}/reviews`, student.token, body)).status, 409);

  const list = await H.api('GET', `/api/pg/${pg.id}/reviews?limit=1`);
  assert.strictEqual(list.status, 200);
  assert.deepStrictEqual(list.body.summary, { average: 4, count: 2, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 } });
  assert.strictEqual(list.body.items.length, 1);
  assert.strictEqual(list.body.hasMore, true);
  const json = JSON.stringify(list.body);
  for (const secret of [student.id, stay.id, older.id, student.phone]) assert.ok(!json.includes(secret), 'no account / booking ids or phone');
  assert.match(list.body.items[0].firstName, /^PG$/, 'first name only');
  const d = (await H.api('GET', `/api/pg/${pg.id}`)).body;
  assert.deepStrictEqual(d.reviewSummary, { average: 4, count: 2 });
  assert.ok(d.sections.includes('reviews'));
});

test('reviews: report (not your own, once each) and admin hide (reason, audited, removed from public)', async () => {
  const pg = await H.mkPg(admin);
  const room = await H.mkRoom(admin, pg.id, { totalBeds: 4, availableBeds: 4 });
  const reviewer = await H.mkUser();
  await bookAndConfirm(reviewer, room.id);
  const created = await H.api('POST', `/api/pg/${pg.id}/reviews`, reviewer.token, { rating: 1, text: 'Spam spam spam spam spam.' });
  const id = created.body.review.id;
  assert.strictEqual((await H.api('POST', `/api/pg/reviews/${id}/report`, reviewer.token, { reason: 'spam' })).status, 400, 'own review');
  assert.strictEqual((await H.api('POST', `/api/pg/reviews/${id}/report`, other.token, { reason: 'boring' })).status, 400);
  assert.strictEqual((await H.api('POST', `/api/pg/reviews/${id}/report`, other.token, { reason: 'spam' })).status, 200);
  const again = await H.api('POST', `/api/pg/reviews/${id}/report`, other.token, { reason: 'spam' });
  assert.strictEqual(again.body.alreadyReported, true);
  const queue = await H.api('GET', `/api/pg/admin/reviews?filter=reported&hostelId=${pg.id}`, admin.token);
  assert.strictEqual(queue.status, 200);
  assert.strictEqual(queue.body[0].reportCount, 1);
  assert.strictEqual((await H.api('GET', '/api/pg/admin/reviews', student.token)).status, 403);

  assert.strictEqual((await H.api('PUT', `/api/pg/admin/reviews/${id}`, student.token, { hidden: true, reason: 'x' })).status, 403);
  assert.strictEqual((await H.api('PUT', `/api/pg/admin/reviews/${id}`, admin.token, { hidden: true })).status, 400, 'reason required');
  assert.strictEqual((await H.api('PUT', `/api/pg/admin/reviews/${id}`, admin.token, { hidden: true, reason: 'Spam' })).status, 200);
  assert.strictEqual((await H.auditRows('PG_REVIEW_HIDDEN', pg.id)).length, 1);
  const pub = (await H.api('GET', `/api/pg/${pg.id}/reviews`)).body;
  assert.deepStrictEqual([pub.items.length, pub.summary.count], [0, 0]);
  const d = (await H.api('GET', `/api/pg/${pg.id}`)).body;
  assert.ok(!d.sections.includes('reviews'), 'no visible reviews: section hidden');
  assert.strictEqual((await H.api('POST', `/api/pg/reviews/${id}/report`, student.token, { reason: 'spam' })).status, 404, 'hidden reviews cannot be reported');
  await H.api('PUT', `/api/pg/admin/reviews/${id}`, admin.token, { hidden: false });
  assert.strictEqual((await H.api('GET', `/api/pg/${pg.id}/reviews`)).body.summary.count, 1);
});

// ── API: promotions + home ──────────────────────────────────────────────────────────────────────
const day = (n) => new Date(Date.now() + n * 86400000).toISOString();
const videoPromo = (hostelId, extra = {}) => ({ type: 'VIDEO', youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', headline: 'Walk through the rooms', subline: 'Two-sharing AC rooms', hostelId, cta: 'WATCH_TOUR', startsAt: day(-1), endsAt: day(10), ...extra });

test('promotions: admin only, linked PG must be listed, audited; image stored as public media', async () => {
  const pg = await H.mkPg(admin);
  assert.strictEqual((await H.api('POST', '/api/pg/admin/promotions', null, videoPromo(pg.id))).status, 401);
  assert.strictEqual((await H.api('POST', '/api/pg/admin/promotions', student.token, videoPromo(pg.id))).status, 403);
  assert.strictEqual((await H.api('GET', '/api/pg/admin/promotions', student.token)).status, 403);
  const missing = await H.api('POST', '/api/pg/admin/promotions', admin.token, videoPromo('00000000-0000-4000-8000-000000000000'));
  assert.strictEqual(missing.status, 400);
  const hiddenPg = await H.mkPg(admin, { isActive: false });
  assert.strictEqual((await H.api('POST', '/api/pg/admin/promotions', admin.token, videoPromo(hiddenPg.id))).status, 400);
  const bad = await H.api('POST', '/api/pg/admin/promotions', admin.token, videoPromo(pg.id, { endsAt: day(-0.5) }));
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.field, 'endsAt');

  const v = await H.api('POST', '/api/pg/admin/promotions', admin.token, videoPromo(pg.id));
  assert.strictEqual(v.status, 201, JSON.stringify(v.body));
  assert.strictEqual(v.body.youtubeId, 'dQw4w9WgXcQ');
  assert.strictEqual(v.body.state, 'live');
  const img = await H.api('POST', '/api/pg/admin/promotions', admin.token, { type: 'IMAGE', imageUrl: H.png(77), headline: 'Rooms from ₹6,500', hostelId: pg.id, cta: 'VIEW_PG', label: 'SPONSORED', startsAt: day(-1), endsAt: day(5) });
  assert.strictEqual(img.status, 201, JSON.stringify(img.body));
  assert.ok(!/^data:/.test(img.body.imageUrl), 'stored as media, not inline');
  assert.strictEqual((await H.auditRows('PG_PROMOTION_CREATED')).length >= 2, true);

  const upd = await H.api('PUT', `/api/pg/admin/promotions/${v.body.id}`, admin.token, { headline: 'Room tour, block B' });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual(upd.body.youtubeId, 'dQw4w9WgXcQ', 'partial update keeps the video');
  assert.strictEqual((await H.api('PUT', `/api/pg/admin/promotions/${v.body.id}`, student.token, { headline: 'x' })).status, 403);
  const order = await H.api('PUT', '/api/pg/admin/promotions/order', admin.token, { ids: [img.body.id, v.body.id] });
  assert.strictEqual(order.status, 200);
  assert.deepStrictEqual(order.body.filter((x) => [img.body.id, v.body.id].includes(x.id)).map((x) => x.id), [img.body.id, v.body.id]);
  // The PG is hidden later: the promotion can still be paused, edited and deleted, not switched back on.
  await H.api('PUT', `/api/pg/${pg.id}`, admin.token, { isActive: false });
  let later = await H.api('PUT', `/api/pg/admin/promotions/${v.body.id}`, admin.token, { isActive: false });
  assert.strictEqual(later.status, 200, JSON.stringify(later.body));
  later = await H.api('PUT', `/api/pg/admin/promotions/${v.body.id}`, admin.token, { headline: 'Paused tour' });
  assert.strictEqual(later.status, 200);
  later = await H.api('PUT', `/api/pg/admin/promotions/${v.body.id}`, admin.token, { isActive: true });
  assert.strictEqual(later.status, 400, 're-activating needs a listed PG');
  assert.strictEqual(later.body.field, 'hostelId');
  assert.ok(!(await H.api('GET', '/api/pg/home')).body.promotions.some((x) => x.id === img.body.id), 'promotions of a hidden PG are not public');
  await H.api('PUT', `/api/pg/${pg.id}`, admin.token, { isActive: true });
  assert.strictEqual((await H.api('PUT', `/api/pg/admin/promotions/${v.body.id}`, admin.token, { isActive: true })).status, 200);
  assert.strictEqual((await H.api('DELETE', `/api/pg/admin/promotions/${img.body.id}`, student.token)).status, 403);
  assert.strictEqual((await H.api('DELETE', `/api/pg/admin/promotions/${img.body.id}`, admin.token)).status, 200);
  assert.strictEqual((await H.api('DELETE', '/api/pg/admin/promotions/not-a-uuid', admin.token)).status, 404);
});

test('home: live promotions only (date window, paused, hidden PG), rails of listed PGs only, cache cleared on writes', async () => {
  const a = await H.mkPg(admin, { genderType: 'Girls', isVerified: true, distanceFromCollege: 0.5 });
  const b = await H.mkPg(admin, { genderType: 'Girls', isVerified: true, distanceFromCollege: 0.8 });
  await H.mkRoom(admin, a.id, { pricePerBed: 5500 });
  await H.mkRoom(admin, b.id, { pricePerBed: 5800 });
  await H.api('PUT', `/api/pg/${a.id}/videos`, admin.token, { videos: [{ youtubeUrl: 'https://youtu.be/aaaaaaaaaaa', title: 'Room tour' }] });
  const mk = async (extra) => (await H.api('POST', '/api/pg/admin/promotions', admin.token, videoPromo(a.id, extra))).body;
  const live = await mk({ headline: 'Live now' });
  const scheduled = await mk({ headline: 'Next week', startsAt: day(7), endsAt: day(14) });
  const paused = await mk({ headline: 'Paused', isActive: false });
  const onB = (await H.api('POST', '/api/pg/admin/promotions', admin.token, videoPromo(b.id, { headline: 'On B' }))).body;
  // An ended promotion (written directly: the API refuses end dates in the past).
  await H.ctx.M('PgPromotion').create({ type: 'VIDEO', youtubeId: 'dQw4w9WgXcQ', headline: 'Ended', hostelId: a.id, cta: 'VIEW_PG', label: 'FEATURED', startsAt: new Date(Date.now() - 9 * 86400000), endsAt: new Date(Date.now() - 86400000), priority: 0, isActive: true });

  let home = await H.api('GET', '/api/pg/home');
  assert.strictEqual(home.status, 200);
  let heads = home.body.promotions.map((p) => p.headline);
  assert.ok(heads.includes('Live now') && heads.includes('On B'));
  for (const h of ['Next week', 'Paused', 'Ended']) assert.ok(!heads.includes(h), h);
  const p = home.body.promotions.find((x) => x.id === live.id);
  assert.deepStrictEqual(Object.keys(p).sort(), ['cta', 'ctaLabel', 'headline', 'id', 'imageUrl', 'label', 'labelText', 'pg', 'subline', 'type', 'video']);
  assert.deepStrictEqual([p.labelText, p.ctaLabel, p.pg.id], ['Featured', 'Watch tour', a.id]);
  assert.ok(!JSON.stringify(home.body).includes(admin.id), 'no admin ids');
  assert.ok(home.body.tours.some((t) => t.pgId === a.id && t.video.youtubeId === 'aaaaaaaaaaa'));
  const rail = (key) => (home.body.rails.find((r) => r.key === key) || { ids: [] }).ids;
  assert.ok(rail('girls').includes(a.id) && rail('girls').includes(b.id));
  assert.ok(rail('verified').includes(a.id));
  assert.ok(rail('budget').includes(a.id));
  assert.ok(home.body.rails.every((r) => r.ids.length >= 2), 'rails need 2+ PGs');
  assert.ok(home.body.pgs.some((x) => x.id === a.id));

  // Hiding B: gone from pgs, rails and promotions at once (cache cleared by the write).
  assert.strictEqual((await H.api('PUT', `/api/pg/${b.id}`, admin.token, { isActive: false })).status, 200);
  home = await H.api('GET', '/api/pg/home');
  heads = home.body.promotions.map((x) => x.headline);
  assert.ok(!heads.includes('On B'));
  assert.ok(!home.body.pgs.some((x) => x.id === b.id));
  assert.ok(home.body.rails.every((r) => !r.ids.includes(b.id)));
  assert.ok(home.body.rails.every((r) => r.ids.every((id) => home.body.pgs.some((x) => x.id === id))), 'rails only point at listed PGs');
  // Pausing a promotion takes it off the page (cache cleared by the promotion write).
  await H.api('PUT', `/api/pg/admin/promotions/${live.id}`, admin.token, { isActive: false });
  home = await H.api('GET', '/api/pg/home');
  assert.ok(!home.body.promotions.some((x) => x.id === live.id));
  assert.ok(scheduled.id && paused.id && onB.id);
});
