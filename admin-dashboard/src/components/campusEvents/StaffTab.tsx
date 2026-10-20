"use client";

// Check-in staff per event (CeEventStaff): GET /staff?eventId, POST /events/:id/staff { userId },
// POST /events/:id/staff/:staffId/revoke. Staff must be verified students of the event's campus; they see only
// first name + initial, team, ticket code and slot when scanning.
import { useEffect, useMemo, useState } from 'react';
import { campusEventsApi, type UserHit } from '@/lib/campusEventsApi';
import {
  Btn, ConfirmDialog, Empty, ErrorBox, Field, Loading, Msg, Section, Select, Toolbar, UserPicker, errText, useLoader, when, type Notice,
} from './shared';

export default function StaffTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const events = useLoader('staff-events', tick, () => campusEventsApi.checkInEvents());
  const [eventId, setEventId] = useState('');
  const list = useMemo(() => events.data?.events || [], [events.data]);
  useEffect(() => { if (!eventId && list.length) setEventId(list[0].id); }, [list, eventId]);
  const staff = useLoader(`staff:${eventId}`, tick, () => (eventId ? campusEventsApi.staff(eventId) : Promise.resolve({ staff: [] })));
  const [user, setUser] = useState<UserHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  const ev = list.find((e) => e.id === eventId);

  const grant = async () => {
    if (!user || !eventId) return;
    setBusy(true); setMsg(null);
    try {
      await campusEventsApi.addStaff(eventId, user.id);
      setMsg({ ok: true, text: `${user.name || 'Student'} can now check in attendees for ${ev?.title || 'this event'}.` });
      setUser(null); onChanged(); staff.reload();
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not grant check-in access.') }); } finally { setBusy(false); }
  };

  if (events.error && !events.data) return <ErrorBox text={events.error} retry={events.reload} />;
  if (events.loading && !events.data) return <Loading text="Loading events…" />;
  if (!list.length) return <Empty text="No published events that are upcoming or running. Staff can be granted once an event is live." />;
  const rows = staff.data?.staff || [];

  return (
    <section className="space-y-4" aria-label="Check-in staff">
      <Toolbar>
        <Select name="Event" value={eventId} onChange={(v) => { setEventId(v); setMsg(null); }} options={list.map((e) => ({ value: e.id, label: `${e.title.slice(0, 40)} · ${when(e.startAt)}` }))} />
        {ev && <span className="text-sm text-fg-muted">{ev.checkedIn} / {ev.confirmed} checked in</span>}
      </Toolbar>
      <Msg msg={msg} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Grant check-in access">
          <div className="space-y-3">
            <Field name="Student" hint="Verified students of this campus only."><UserPicker onPick={setUser} picked={user} clear={() => setUser(null)} /></Field>
            <Btn tone="primary" disabled={!user || busy} onClick={grant}>{busy ? 'Granting…' : 'Grant access'}</Btn>
            <p className="text-xs text-fg-muted">The organizer and every admin can always check in. Staff use the in-app check-in screen.</p>
          </div>
        </Section>
        <Section title={`Current staff (${rows.length})`}>
          {staff.error && <ErrorBox text={staff.error} retry={staff.reload} />}
          {staff.loading && !staff.data ? <Loading text="Loading staff…" /> : rows.length === 0 ? <p className="text-sm text-fg-muted">No staff granted for this event.</p> : (
            <ul className="divide-y divide-white/10">
              {rows.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span><b>{s.name}</b> <span className="text-xs text-fg-muted">· {s.role.toLowerCase()} · since {when(s.createdAt)}</span></span>
                  <Btn tone="bad" onClick={() => setRevoke({ id: s.id, name: s.name })}>Revoke</Btn>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {revoke && (
        <ConfirmDialog open title={`Revoke ${revoke.name}'s check-in access?`} confirmLabel="Revoke" body={<p>They can no longer validate or admit tickets for this event.</p>}
          onCancel={() => setRevoke(null)}
          onConfirm={async () => { await campusEventsApi.revokeStaff(eventId, revoke.id); setRevoke(null); setMsg({ ok: true, text: `${revoke.name}'s access was revoked.` }); onChanged(); staff.reload(); }} />
      )}
    </section>
  );
}
