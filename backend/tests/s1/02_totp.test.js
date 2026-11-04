// S1 item 2 (unit): RFC 4226 / RFC 6238 test vectors, base32, ±1 step window, replay guard, secret
// encryption at rest (TOTP_ENC_KEY, JWT-derived fallback, rotation), recovery codes.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

const T = H.r('utils/totp');
const RFC_KEY = Buffer.from('12345678901234567890'); // RFC 4226 / 6238 SHA-1 seed

test('RFC 4226 HOTP vectors (counter 0..9)', () => {
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  want.forEach((w, i) => assert.strictEqual(T.hotp(RFC_KEY, i), w, `counter ${i}`));
});

test('RFC 6238 TOTP vectors (SHA-1, 8 digits) + 6-digit truncation', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, code] of vectors) {
    assert.strictEqual(T.totp(RFC_KEY, t * 1000, { digits: 8 }), code, `T=${t}`);
    assert.strictEqual(T.totp(RFC_KEY, t * 1000), code.slice(-6), `T=${t} (6 digits)`);
  }
});

test('base32 (RFC 4648) round trip + the RFC seed', () => {
  assert.strictEqual(T.base32Encode(RFC_KEY), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepStrictEqual(T.base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), RFC_KEY);
  for (let i = 0; i < 20; i++) {
    const b = T.newSecret();
    assert.strictEqual(b.length, 20);
    assert.deepStrictEqual(T.base32Decode(T.base32Encode(b)), b);
  }
  assert.throws(() => T.base32Decode('not*base32'));
});

test('verify: ±1 step window, wrong / malformed codes, replay of a used step refused', () => {
  const now = 1_700_000_000_000;
  const step = T.stepAt(now);
  const at = (s) => T.hotp(RFC_KEY, s);
  assert.strictEqual(T.verify(RFC_KEY, at(step), { ms: now }), step);
  assert.strictEqual(T.verify(RFC_KEY, at(step - 1), { ms: now }), step - 1, 'previous step ok');
  assert.strictEqual(T.verify(RFC_KEY, at(step + 1), { ms: now }), step + 1, 'next step ok');
  assert.strictEqual(T.verify(RFC_KEY, at(step - 2), { ms: now }), null, 'two steps back refused');
  assert.strictEqual(T.verify(RFC_KEY, at(step + 2), { ms: now }), null, 'two steps ahead refused');
  assert.strictEqual(T.verify(RFC_KEY, '12345', { ms: now }), null);
  assert.strictEqual(T.verify(RFC_KEY, 'abcdef', { ms: now }), null);
  assert.strictEqual(T.verify(RFC_KEY, ` ${at(step).slice(0, 3)} ${at(step).slice(3)} `, { ms: now }), step, 'spaces ignored');
  assert.strictEqual(T.verify(RFC_KEY, at(step), { ms: now, lastUsedStep: step }), null, 'same step twice refused');
  assert.strictEqual(T.verify(RFC_KEY, at(step - 1), { ms: now, lastUsedStep: step }), null, 'older step refused');
});

test('otpauth URI for authenticator apps', () => {
  const u = new URL(T.otpauthUri({ secretB32: 'JBSWY3DPEHPK3PXP', account: 'Admin (1234)' }));
  assert.strictEqual(u.protocol, 'otpauth:');
  assert.strictEqual(u.host, 'totp');
  assert.strictEqual(decodeURIComponent(u.pathname), '/ZenWe Admin:Admin (1234)');
  assert.strictEqual(u.searchParams.get('secret'), 'JBSWY3DPEHPK3PXP');
  assert.strictEqual(u.searchParams.get('issuer'), 'ZenWe Admin');
  assert.strictEqual(u.searchParams.get('digits'), '6');
  assert.strictEqual(u.searchParams.get('period'), '30');
});

test('secret encryption: AES-GCM, JWT-derived key without TOTP_ENC_KEY, env key wins, old secrets still readable', () => {
  const secret = T.newSecret();
  const envJ = { JWT_SECRET: 'jwt-a' };
  const encJ = T.encryptSecret(secret, envJ);
  assert.match(encJ, /^v1\.j\./);
  assert.ok(!encJ.includes(T.base32Encode(secret)) && !encJ.includes(secret.toString('hex')), 'no plaintext');
  assert.deepStrictEqual(T.decryptSecret(encJ, envJ).secret, secret);
  assert.throws(() => T.decryptSecret(encJ, { JWT_SECRET: 'jwt-b' }), 'other JWT secret cannot read it');
  // tampering detected
  const parts = encJ.split('.');
  parts[4] = Buffer.from(Buffer.from(parts[4], 'base64url').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64url');
  assert.throws(() => T.decryptSecret(parts.join('.'), envJ));
  // TOTP_ENC_KEY set later: new secrets use it, the JWT-derived one still decrypts (stale -> re-encrypted on use)
  const envE = { JWT_SECRET: 'jwt-a', TOTP_ENC_KEY: 'a'.repeat(64) };
  const encE = T.encryptSecret(secret, envE);
  assert.match(encE, /^v1\.e\./);
  const old = T.decryptSecret(encJ, envE);
  assert.deepStrictEqual(old.secret, secret);
  assert.strictEqual(old.stale, true);
  assert.strictEqual(T.decryptSecret(encE, envE).stale, false);
  // rotation: TOTP_ENC_KEY_OLD keeps old env-key secrets readable
  const envR = { JWT_SECRET: 'jwt-a', TOTP_ENC_KEY: Buffer.alloc(32, 7).toString('base64'), TOTP_ENC_KEY_OLD: 'a'.repeat(64) };
  assert.deepStrictEqual(T.decryptSecret(encE, envR).secret, secret);
  assert.throws(() => T.decryptSecret(encE, { JWT_SECRET: 'jwt-a', TOTP_ENC_KEY: Buffer.alloc(32, 7).toString('base64') }));
  // a passphrase-style TOTP_ENC_KEY is accepted (HKDF)
  const envP = { JWT_SECRET: 'x', TOTP_ENC_KEY: 'correct horse battery staple' };
  assert.deepStrictEqual(T.decryptSecret(T.encryptSecret(secret, envP), envP).secret, secret);
});

test('recovery codes: 10 chars from an unambiguous alphabet, normalised before hashing', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const c = T.newRecoveryCode();
    assert.match(c, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
    seen.add(c);
  }
  assert.strictEqual(seen.size, 50);
  const c = T.newRecoveryCode();
  assert.strictEqual(T.hashRecoveryCode(c), T.hashRecoveryCode(c.toUpperCase().replace('-', ' ')));
  assert.match(T.hashRecoveryCode(c), /^[0-9a-f]{64}$/);
});
