// Company renamed ZCS -> ZENV (owner, 4 Nov 2026): the once-only boot migration scripts/legal_business_name_zenv_v1.js.
// Saved legal settings named exactly 'ZCS' become 'ZENV' and nothing else in them changes; any other name stays; it
// runs once; two instances at once both finish with one marker; afterwards every /legal page reads ZENV, never the
// old name or its long form.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

const PAGES = ['/legal', '/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/grievance', '/legal/community-guidelines', '/legal/delete-account', '/legal/photo-credits'];
// The old brand in any form. Package ids (com.srm.zenvyvendor ...) are technical and stay, so they are cut first.
const OLD_BRAND = /\bZCS\b|zenvy|Community and Services/i;
const SAVED = Object.freeze({
  businessName: 'ZCS', operatorName: 'Shanmukesh Kunjam', contactEmail: 'projectshanmukh@gmail.com',
  registeredAddress: 'SRM University AP, Neerukonda', jurisdictionCity: 'Guntur',
  grievanceOfficer: { name: 'Test Officer', designation: 'Grievance Officer', email: 'grievance@example.test', phone: '', address: '' },
  effectiveDate: '2026-10-18', policyVersion: '1.0',
});

let mig;
const GC = () => H.r('config/db').getSequelize().models.GlobalConfig;
const saved = async () => {
  const row = await GC().findOne({ where: { key: 'LEGAL_SETTINGS' } });
  const v = row ? row.value : null;
  return typeof v === 'string' ? JSON.parse(v) : v;
};
const markers = () => GC().count({ where: { key: mig.MARKER } });

test.before(async () => {
  await H.setup();
  mig = H.r('scripts/legal_business_name_zenv_v1');
});
test.after(async () => { await H.teardown(); });
test.beforeEach(async () => {
  await H.setLegal(null);
  await GC().destroy({ where: { key: mig.MARKER } });
});

test('a saved name of exactly ZCS becomes ZENV, nothing else changes, and every legal page reads ZENV', async () => {
  await H.setLegal(SAVED);
  assert.deepStrictEqual(await mig.runLegalBusinessNameZenv(), { businessName: 'ZCS -> ZENV' });
  assert.deepStrictEqual(await saved(), { ...SAVED, businessName: 'ZENV' });
  assert.strictEqual(await markers(), 1);
  assert.strictEqual(H.r('utils/legalSettings').defaults().businessName, 'ZENV', 'the code default too');
  for (const p of PAGES) {
    const res = await H.api('GET', p);
    assert.strictEqual(res.status, 200, p);
    assert.ok(res.text.includes('ZENV'), `${p} names ZENV`);
    const old = OLD_BRAND.exec(res.text.replace(/\bcom\.[a-z0-9.]+/gi, ''));
    assert.strictEqual(old, null, `${p} still says "${old && old[0]}"`);
  }
  const pub = await H.api('GET', '/api/config/legal');
  assert.strictEqual(pub.body.businessName, 'ZENV', 'the apps get ZENV at once (caches cleared)');
});

test('runs once: a name set afterwards is never touched again', async () => {
  await H.setLegal(SAVED);
  await mig.runLegalBusinessNameZenv();
  await H.setLegal(SAVED); // an admin deliberately types ZCS again later
  assert.deepStrictEqual(await mig.runLegalBusinessNameZenv(), { skipped: 'already done' });
  assert.strictEqual((await saved()).businessName, 'ZCS');
  assert.strictEqual(await markers(), 1);
});

test('any other saved name is kept as typed; unsaved settings stay unsaved', async () => {
  const other = { ...SAVED, businessName: 'ZCS (Zenvy Community and Services)' };
  await H.setLegal(other);
  assert.deepStrictEqual(await mig.runLegalBusinessNameZenv(), { businessName: 'kept', current: other.businessName });
  assert.deepStrictEqual(await saved(), other);
  assert.strictEqual(await markers(), 1);

  await H.setLegal(null);
  await GC().destroy({ where: { key: mig.MARKER } });
  assert.deepStrictEqual(await mig.runLegalBusinessNameZenv(), { businessName: 'not saved (the default is ZENV)' });
  assert.strictEqual(await saved(), null, 'no LEGAL_SETTINGS row is created');
  assert.strictEqual(await markers(), 1);
});

test('two instances at once: both finish, one marker, the name renamed once', async () => {
  await H.setLegal(SAVED);
  const results = await Promise.all([mig.runLegalBusinessNameZenv(), mig.runLegalBusinessNameZenv()]);
  assert.ok(results.some((r) => r.businessName === 'ZCS -> ZENV'), JSON.stringify(results));
  assert.deepStrictEqual(await saved(), { ...SAVED, businessName: 'ZENV' });
  assert.strictEqual(await markers(), 1);
});

test('under the advisory lock: an instance that waited while another finished changes nothing', async () => {
  await H.setLegal(SAVED);
  const pgLock = H.r('utils/pgLock');
  const orig = pgLock.withAdvisoryXactLock;
  let lockKey = null;
  pgLock.withAdvisoryXactLock = async (sequelize, key, fn) => {
    lockKey = key;
    await GC().create({ key: mig.MARKER, value: { at: 'the other instance' } }); // it finished during the wait
    return fn(null);
  };
  try {
    assert.deepStrictEqual(await mig.runLegalBusinessNameZenv(), { skipped: 'already done' });
  } finally {
    pgLock.withAdvisoryXactLock = orig;
  }
  assert.strictEqual(lockKey, mig.MARKER, 'the work runs under the advisory lock');
  assert.strictEqual((await saved()).businessName, 'ZCS');
  assert.strictEqual(await markers(), 1);
});
