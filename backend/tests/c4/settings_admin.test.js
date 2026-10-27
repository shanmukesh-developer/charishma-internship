// C4: admin legal settings API (validation, audit, conflict, generic config refusal) + public /api/config/legal.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let adminU;
let student;
test.before(async () => {
  await H.setup();
  adminU = await H.mkUser('admin');
  student = await H.mkUser('student');
});
test.after(async () => { await H.teardown(); });
test.beforeEach(async () => { await H.setLegal(null); });

const put = (body, token = adminU.token) => H.api('PUT', '/api/admin/legal-settings', { token, body });

test('admin only', async () => {
  assert.strictEqual((await H.api('GET', '/api/admin/legal-settings')).status, 401);
  assert.strictEqual((await H.api('GET', '/api/admin/legal-settings', { token: student.token })).status, 403);
  assert.strictEqual((await put({ businessName: 'X' }, student.token)).status, 403);
});

test('GET returns defaults (existing operator + contact, empty officer) with a missing-officer warning', async () => {
  const res = await H.api('GET', '/api/admin/legal-settings', { token: adminU.token });
  assert.strictEqual(res.status, 200);
  const s = res.body.settings;
  assert.strictEqual(s.businessName, 'ZCS');
  assert.strictEqual(s.operatorName, 'Shanmukesh Kunjam');
  assert.strictEqual(s.contactEmail, 'projectshanmukh@gmail.com');
  assert.deepStrictEqual(s.grievanceOfficer, { name: '', designation: '', email: '', phone: '', address: '' });
  assert.strictEqual(s.registeredAddress, '');
  assert.strictEqual(s.jurisdictionCity, '');
  assert.strictEqual(res.body.grievanceComplete, false);
  assert.ok(res.body.missing.includes('grievanceOfficer.name'));
  assert.ok(res.body.pages.terms.endsWith('/legal/terms'));
});

test('validation rejects bad input', async () => {
  const bad = [
    { contactEmail: 'nope' },
    { businessName: '' },
    { businessName: 'x'.repeat(121) },
    { grievanceOfficer: { email: 'bad@' } },
    { grievanceOfficer: { phone: 'call me' } },
    { grievanceOfficer: { name: '<script>' } },
    { grievanceOfficer: { nickname: 'x' } },
    { grievanceOfficer: 'Jane' },
    { effectiveDate: '2026-02-30' },
    { effectiveDate: 'tomorrow' },
    { policyVersion: '' },
    { policyVersion: 'v 2' },
    { policyVersion: 'x'.repeat(21) },
    { jurisdictionCity: 'A\nB' },
    { somethingElse: 1 },
  ];
  for (const b of bad) {
    const res = await put(b);
    assert.strictEqual(res.status, 400, JSON.stringify(b));
    assert.strictEqual(res.body.code, 'INVALID_LEGAL_SETTINGS');
  }
});

test('valid update saves, is audited with a diff, clears the warning, and shows on the pages', async () => {
  const res = await put({
    grievanceOfficer: { name: 'Jane Doe', designation: 'Grievance Officer', email: 'g@example.test' },
    jurisdictionCity: 'Guntur', registeredAddress: 'Somewhere\nAP',
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.changed, true);
  assert.strictEqual(res.body.grievanceComplete, true);
  assert.deepStrictEqual(res.body.changes['grievanceOfficer.name'], ['', 'Jane Doe']);
  const log = await H.r('models/VerificationLog').getVerificationLogModel().findOne({ where: { action: 'LEGAL_SETTINGS_UPDATED' }, order: [['timestamp', 'DESC']] });
  assert.ok(log, 'audit row');
  assert.strictEqual(log.adminId, String(adminU.id));
  assert.ok(JSON.parse(log.details).changes.jurisdictionCity);
  const page = H.text((await H.api('GET', '/legal/grievance')).text);
  assert.ok(page.includes('Jane Doe, Grievance Officer'));
  // Same values again: no change, no new audit row.
  const count = await H.r('models/VerificationLog').getVerificationLogModel().count({ where: { action: 'LEGAL_SETTINGS_UPDATED' } });
  const again = await put({ jurisdictionCity: 'Guntur' });
  assert.strictEqual(again.body.changed, false);
  assert.strictEqual(await H.r('models/VerificationLog').getVerificationLogModel().count({ where: { action: 'LEGAL_SETTINGS_UPDATED' } }), count);
});

test('stale edit -> 409 CONFIG_CONFLICT', async () => {
  const first = await put({ jurisdictionCity: 'A' });
  const stamp = first.body.updatedAt;
  await new Promise((r) => setTimeout(r, 15));
  await put({ jurisdictionCity: 'B' });
  const res = await put({ jurisdictionCity: 'C', ifUpdatedAt: stamp });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.code, 'CONFIG_CONFLICT');
});

test('generic POST /api/admin/config refuses LEGAL_SETTINGS', async () => {
  const res = await H.api('POST', '/api/admin/config', { token: adminU.token, body: { key: 'LEGAL_SETTINGS', value: { businessName: 'x' } } });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.message, /Config → Legal/);
});

test('public /api/config/legal: version, date and absolute page links', async () => {
  await put({ policyVersion: '1.5', effectiveDate: '2026-12-01' });
  H.r('utils/responseCache').invalidate('config');
  const res = await H.api('GET', '/api/config/legal');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.policyVersion, '1.5');
  assert.strictEqual(res.body.effectiveDate, '2026-12-01');
  assert.match(res.body.urls.terms, /^http:\/\/127\.0\.0\.1:\d+\/legal\/terms$/);
  assert.match(res.body.urls.privacy, /\/legal\/privacy$/);
  assert.match(res.body.urls.communityGuidelines, /\/legal\/community-guidelines$/);
});

test('a junk stored value falls back to safe defaults (never breaks pages)', async () => {
  await H.setLegal({ businessName: 42, contactEmail: 'bad', policyVersion: '<x>', effectiveDate: 'no', grievanceOfficer: 'x' });
  const s = await H.r('utils/legalSettings').getSettings({ fresh: true });
  assert.strictEqual(s.businessName, 'ZCS');
  assert.strictEqual(s.contactEmail, 'projectshanmukh@gmail.com');
  assert.strictEqual(s.policyVersion, '1.0');
  assert.strictEqual(s.effectiveDate, '2026-10-18');
  assert.strictEqual((await H.api('GET', '/legal/terms')).status, 200);
});
