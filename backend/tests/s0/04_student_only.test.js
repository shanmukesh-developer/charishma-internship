// S0 item 4: rider / store / Auto-Ride driver tokens get 403 on the student social routes (legacy Friends,
// After Dark chat + rooms, campus Whispers / 9 PM / spot posts / profile create / ID verification / groups).
// Students and admins keep working.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers');

let student; let admin; let rider; let store; let driverToken;
test.before(async () => {
  await H.setup();
  student = await H.mkUser();
  admin = await H.mkUser({ role: 'admin' });
  rider = await H.mkRider();
  store = await H.mkStore();
  driverToken = H.tokenFor(student.id, 'auto_driver'); // driver token class (never a User row role)
});
test.after(() => H.teardown());

const ROUTES = [
  ['POST', '/api/friends/contacts', { query: 'abcd' }],
  ['GET', '/api/friends/', undefined],
  ['POST', '/api/friends/message', { conversationId: '00000000-0000-4000-8000-000000000000', text: 'x' }],
  ['GET', '/api/chat/conversations', undefined],
  ['POST', '/api/chat/groups', { name: 'x', participants: [] }],
  ['POST', '/api/rooms/create', { name: 'x' }],
  ['POST', '/api/rooms/join', { joinCode: 'ABCDEF12' }],
  ['GET', '/api/rooms/my-rooms', undefined],
  ['POST', '/api/rooms/kick', {}],
  ['GET', '/api/campus/pulse/whispers', undefined],
  ['POST', '/api/campus/pulse/whispers', { text: 'hello campus' }],
  ['POST', '/api/campus/pulse/question/answer', { text: 'answer' }],
  ['POST', '/api/campus/proximity/rooms/library/messages', { text: 'hi' }],
  ['PUT', '/api/campus/profile', { year: 2 }],
  ['POST', '/api/campus/verify/email-otp', { email: 'x@srmap.edu.in' }],
  ['POST', '/api/campus/verify/upload-id', { idCardImageUrl: 'data:image/png;base64,AAAA' }],
  ['POST', '/api/campus/groups', { name: 'x' }],
  ['POST', '/api/campus/groups/join', { code: 'ABCDEF' }],
  ['POST', '/api/campus/dm', { userId: '00000000-0000-4000-8000-000000000000' }],
];

test('rider, store and driver tokens are refused (403 STUDENTS_ONLY) on every social route', async () => {
  for (const [method, url, body] of ROUTES) {
    for (const [who, tok] of [['rider', rider.token], ['store', store.token]]) {
      const r = await H.api(method, url, tok, body);
      assert.strictEqual(r.status, 403, `${who} ${method} ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.code, 'STUDENTS_ONLY', `${who} ${method} ${url}`);
    }
    const d = await H.api(method, url, driverToken, body);
    assert.strictEqual(d.status, 401, `driver ${method} ${url} -> ${d.status}`);
  }
});

test('students and admins still reach the same routes (not 403 STUDENTS_ONLY)', async () => {
  for (const [method, url, body] of ROUTES) {
    for (const u of [student, admin]) {
      const r = await H.api(method, url, u.token, body);
      assert.ok(!(r.status === 403 && r.body && r.body.code === 'STUDENTS_ONLY'), `${u.role} ${method} ${url} blocked`);
      assert.notStrictEqual(r.status, 401, `${u.role} ${method} ${url} unauthenticated?`);
    }
  }
  const r = await H.api('GET', '/api/chat/conversations', student.token);
  assert.strictEqual(r.status, 200);
});

test('studentOnly middleware unit: role allow-list', () => {
  const { studentOnly } = H.r('middleware/authMiddleware');
  const run = (role) => { let code = 200; const res = { status: (c) => { code = c; return { json: () => {} }; } }; let nexted = false; studentOnly({ user: role === null ? null : { role } }, res, () => { nexted = true; }); return nexted ? 'next' : code; };
  assert.strictEqual(run('student'), 'next');
  assert.strictEqual(run('admin'), 'next');
  assert.strictEqual(run('rider'), 403);
  assert.strictEqual(run('restaurant'), 403);
  assert.strictEqual(run('auto_driver'), 403);
  assert.strictEqual(run(null), 403);
});
