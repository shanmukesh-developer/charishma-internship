// /api/admin/me tells the dashboard when the signed-in admin's own password is still one the old seed scripts
// published (scripts/admin_seed_reset only warns in the server log while ADMIN_RESET_PASSWORD is unset); a
// changed password clears it at once (new password version); a strong password never shows it.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

test.before(() => H.setup());
test.after(() => H.teardown());

test('weakPassword: true for a published seed password, false for a strong one, cleared after a change', async () => {
  const weak = await H.mkUser({ role: 'admin', password: 'admin123' });
  let me = await H.api('GET', '/api/admin/me', weak.token);
  assert.strictEqual(me.status, 200, JSON.stringify(me.body));
  assert.strictEqual(me.body.weakPassword, true);
  // Asked again (cached per password version): same answer.
  assert.strictEqual((await H.api('GET', '/api/admin/me', weak.token)).body.weakPassword, true);

  const strong = await H.mkUser({ role: 'admin', password: 'a-strong-owner-chosen-pass' });
  me = await H.api('GET', '/api/admin/me', strong.token);
  assert.strictEqual(me.body.weakPassword, false);

  // The owner changes the password (the model hook hashes it and bumps tokenVersion): a new session sees no warning.
  const row = await H.ctx.M.User.findByPk(weak.id);
  row.password = 'now-a-long-private-password';
  await row.save();
  H.clearAuthCache(weak.id);
  const fresh = await H.ctx.M.User.findByPk(weak.id);
  const token = H.tokenFor(weak.id, 'admin', { tv: Number(fresh.tokenVersion) || 0 });
  me = await H.api('GET', '/api/admin/me', token);
  assert.strictEqual(me.status, 200, JSON.stringify(me.body));
  assert.strictEqual(me.body.weakPassword, false);
});
