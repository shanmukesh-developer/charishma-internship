// The 24 h reminder goes out as soon as an event is less than a day away, so an event published the same morning
// gets it at once: its title says "Today" (was always "Tomorrow"), by the IST calendar date, with the start time.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(async () => { await H.setup({ label: 'ce-reminder-day' }); await H.setFlag(true); });
test.after(async () => { await H.teardown(); });

test('24 h reminder: "Today" for a start later the same IST day, "Tomorrow" for the next day, with the time', async () => {
  H.setNow(Date.parse('2026-11-03T09:00:00+05:30'));
  const { event: today } = await H.mkEvent({ capacity: 5, startInH: 8, title: 'Evening Talk' }); // 17:00 the same day
  const { event: tomorrow } = await H.mkEvent({ capacity: 5, startInH: 23, title: 'Morning Run' }); // 08:00 the next day
  const a = await H.mkStudent();
  const b = await H.mkStudent();
  assert.equal((await H.register(today.id, a)).status, 201);
  assert.equal((await H.register(tomorrow.id, b)).status, 201);
  const j = await H.runJobs();
  assert.equal(j.reminders24, 2);
  const na = (await H.notificationsFor(a.id)).find((n) => n.type === 'CE_REMINDER_24H');
  const nb = (await H.notificationsFor(b.id)).find((n) => n.type === 'CE_REMINDER_24H');
  assert.equal(na.title, 'Today: Evening Talk');
  assert.match(na.message || na.body, /^Starts today at 5:00 pm, Main Auditorium\./i);
  assert.equal(nb.title, 'Tomorrow: Morning Run');
  assert.match(nb.message || nb.body, /^Starts tomorrow at 8:00 am, Main Auditorium\./i);
});
