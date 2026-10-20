"use client";

// Events: filter by bucket / status / title / category / club (all server-side), detail with
// stats + audit history, audited edit, unpublish / republish, cancel (shows the refund / ticket effect), feature.
import { useEffect, useMemo, useState } from 'react';
import {
  BUCKETS, CATEGORIES, EVENT_STATUSES, EXTRA_BUCKETS, campusEventsApi,
  type AdminEvent, type BucketKey, type EventDetail, type EventEdit,
} from '@/lib/campusEventsApi';
import {
  Btn, ConfirmDialog, Empty, ErrorBox, EventPreview, Field, KV, Loading, Msg, PageNav, Pill, Section, Select, StatCard, Toolbar,
  catLabel, errText, fromLocalInput, inputCls, inr, label, short, toLocalInput, useLoader, when, type Notice,
} from './shared';

const PAGE = 50;

export default function EventsTab({ tick, onChanged, bucket, setBucket }: { tick: number; onChanged: () => void; bucket: BucketKey | ''; setBucket: (b: BucketKey | '') => void }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [club, setClub] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const key = `${bucket}|${status}|${query}|${category}|${club}|${page}`;
  useEffect(() => { setPage(1); }, [bucket, status, query, category, club]);
  const { data, loading, error, reload } = useLoader(key, tick, () => campusEventsApi.events({ bucket: bucket || undefined, status: status || undefined, q: query || undefined, category: category || undefined, entityId: club || undefined, page, limit: PAGE }));
  const clubList = useLoader('events-clubs', tick, () => campusEventsApi.clubs());
  const clubs = useMemo(() => (clubList.data?.items || []).filter((c) => c.verified && c.type !== 'vendor').map((c) => ({ value: c.id, label: c.name })).sort((a, b) => a.label.localeCompare(b.label)), [clubList.data]);
  const rows = useMemo(() => data?.events || [], [data]);

  if (openId) return <EventDetailPanel id={openId} tick={tick} onChanged={() => { onChanged(); reload(); }} back={() => setOpenId(null)} />;

  return (
    <section className="space-y-4" aria-label="Events">
      <Toolbar>
        <Select name="Bucket" value={bucket} onChange={(v) => setBucket(v as BucketKey | '')} options={[{ value: '', label: 'All events' }, ...BUCKETS.map((b) => ({ value: b.key, label: b.label })), ...EXTRA_BUCKETS.map((b) => ({ value: b.key, label: b.label }))]} />
        <Select name="Status" value={status} onChange={setStatus} options={['', ...EVENT_STATUSES]} allLabel="Any" />
        <Select name="Category" value={category} onChange={setCategory} options={[{ value: '', label: 'Any' }, ...CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))]} />
        <Select name="Club" value={club} onChange={setClub} options={[{ value: '', label: 'Any' }, ...clubs]} />
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title" maxLength={60} className="w-48 border border-line bg-surface p-2 text-sm text-fg" aria-label="Search title" />
          <Btn type="submit">Search</Btn>
          {query && <Btn onClick={() => { setQ(''); setQuery(''); }}>Clear</Btn>}
        </form>
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading && !data ? <Loading text="Loading events…" /> : rows.length === 0 ? <Empty text={category || club || query ? 'No events match these filters.' : 'No events in this view yet.'} /> : (
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">Event</th><th className="p-3">Organizer</th><th className="p-3">When</th><th className="p-3">Price</th><th className="p-3">Places</th><th className="p-3">Registration</th><th className="p-3">Status</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((ev) => (
                <tr key={ev.id} className="cursor-pointer align-top hover:bg-surface-2/60" onClick={() => setOpenId(ev.id)}>
                  <td className="p-3"><button type="button" className="text-left font-semibold text-info-text underline-offset-2 hover:underline" onClick={() => setOpenId(ev.id)}>{ev.featured ? '★ ' : ''}{ev.title}</button><span className="block text-xs text-fg-muted">{catLabel(ev.category)} · {label(ev.format)}</span></td>
                  <td className="p-3 text-xs">{ev.organizer?.name || ev.organizerName || '—'}{ev.organizer?.club && <span className="block text-fg-muted">{ev.organizer.club.name}{ev.organizer.club.verified ? ' ✓' : ''}</span>}</td>
                  <td className="whitespace-nowrap p-3 text-xs">{when(ev.startAt)}</td>
                  <td className="p-3 text-xs">{ev.price.label}</td>
                  <td className="p-3 text-xs tabular-nums">{ev.format === 'SLOT' ? `${ev.slotsAvailable ?? '—'} slot(s) open` : `${ev.counters.confirmed} / ${ev.capacity.capacity ?? '—'}${ev.counters.waitlist ? ` · ${ev.counters.waitlist} waiting` : ''}`}</td>
                  <td className="p-3"><Pill s={ev.registrationState} /></td>
                  <td className="p-3"><Pill s={ev.status} />{ev.pendingChanges && <span className="mt-1 block text-xs text-warning-text">changes waiting</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <PageNav page={data.pagination.page} hasMore={data.pagination.hasMore} onPage={setPage} count={rows.length} noun="events" />}
    </section>
  );
}

type Act = 'unpublish' | 'republish' | 'cancel' | 'feature' | 'unfeature';

export function EventDetailPanel({ id, tick, onChanged, back }: { id: string; tick: number; onChanged: () => void; back: () => void }) {
  const { data, loading, error, reload } = useLoader(`ev:${id}`, tick, () => campusEventsApi.event(id));
  const audit = useLoader(`evaudit:${id}`, tick, () => campusEventsApi.audit(id, { limit: 100 }));
  const [act, setAct] = useState<Act | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);
  const refresh = () => { onChanged(); reload(); audit.reload(); };

  if (error && !data) return <div className="space-y-3"><Btn onClick={back}>← Back to events</Btn><ErrorBox text={error} retry={reload} /></div>;
  if (loading || !data) return <div className="space-y-3"><Btn onClick={back}>← Back to events</Btn><Loading text="Loading event…" /></div>;
  const { event: ev, stats, slots, staff } = data;
  const closed = ['CANCELLED', 'COMPLETED'].includes(ev.status);
  const live = ['APPROVED', 'PUBLISHED', 'UNPUBLISHED'].includes(ev.status);

  const run = async (reason: string) => {
    if (act === 'unpublish') { await campusEventsApi.unpublish(ev.id, reason); setMsg({ ok: true, text: 'Event hidden from students.' }); }
    if (act === 'republish') { await campusEventsApi.republish(ev.id); setMsg({ ok: true, text: 'Event is visible again.' }); }
    if (act === 'cancel') { await campusEventsApi.cancelEvent(ev.id, reason); setMsg({ ok: true, text: 'Event cancelled. Registrants are notified; refunds started.' }); }
    if (act === 'feature' || act === 'unfeature') { await campusEventsApi.feature(ev.id, act === 'feature'); setMsg({ ok: true, text: act === 'feature' ? 'Featured on the landing page.' : 'No longer featured.' }); }
    setAct(null);
    refresh();
  };

  return (
    <section className="space-y-4" aria-label={`Event ${ev.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={back}>← Back to events</Btn>
        <span className="font-mono text-xs text-fg-muted">#{short(ev.id)} · v{ev.version}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {!closed && <Btn onClick={() => setEditing((x) => !x)}>{editing ? 'Close editor' : 'Edit (audited)'}</Btn>}
          {!closed && <Btn onClick={() => setAct(ev.featured ? 'unfeature' : 'feature')}>{ev.featured ? 'Unfeature' : '★ Feature'}</Btn>}
          {['PUBLISHED', 'APPROVED'].includes(ev.status) && <Btn tone="bad" onClick={() => setAct('unpublish')}>Unpublish</Btn>}
          {ev.status === 'UNPUBLISHED' && <Btn tone="good" onClick={() => setAct('republish')}>Republish</Btn>}
          {!closed && <Btn tone="bad" onClick={() => setAct('cancel')}>Cancel event</Btn>}
        </div>
      </div>
      <Msg msg={msg} />
      {ev.status === 'SUBMITTED' && <p className="border border-warning/30 bg-warning-soft p-3 text-sm text-warning-text">Waiting for review: approve, reject or send back from the Review queue tab.</p>}
      {ev.pendingChanges && <p className="border border-warning/30 bg-warning-soft p-3 text-sm text-warning-text">The organizer asked for changes; review them in the Review queue tab.</p>}
      {ev.cancelReason && <p className="border border-danger/30 bg-danger-soft p-3 text-sm text-danger-text">Cancelled {when(ev.cancelledAt)}: {ev.cancelReason}</p>}
      {ev.reviewNote && <KV k="Last review note" v={ev.reviewNote} />}
      {ev.rejectionReason && <KV k="Rejection reason" v={ev.rejectionReason} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <StatCard name="Registrations" value={stats.total} />
        <StatCard name="Confirmed" value={stats.confirmed} tone="good" />
        <StatCard name="Checked in" value={stats.checkedIn} />
        <StatCard name="Waitlist" value={ev.counters.waitlist} />
        <StatCard name="Collected" value={inr(stats.collected.VENUE + stats.collected.WALLET + stats.collected.ONLINE)} hint={`venue ${inr(stats.collected.VENUE)} · wallet ${inr(stats.collected.WALLET)} · online ${inr(stats.collected.ONLINE)}`} />
        <StatCard name="Due at venue" value={inr(stats.dueAtVenue)} tone={stats.dueAtVenue ? 'warn' : 'plain'} hint={`refunded ${inr(stats.refunded)}`} />
      </div>

      {editing && <EditForm ev={ev} done={(text) => { setEditing(false); setMsg({ ok: true, text }); refresh(); }} />}

      <Section title="Event (student view)"><EventPreview ev={ev} slots={slots} /></Section>

      <Section title={`Check-in staff (${staff.length})`}>
        {staff.length ? <ul className="space-y-1 text-sm">{staff.map((s) => <li key={s.id}>{s.name} <span className="text-xs text-fg-muted">· since {when(s.createdAt)}</span></li>)}</ul> : <p className="text-sm text-fg-muted">Only the organizer and admins can check in. Grant staff in the Check-in staff tab.</p>}
      </Section>

      <Section title="Status breakdown">
        <div className="flex flex-wrap gap-2 text-xs">{Object.entries(stats.byStatus).length ? Object.entries(stats.byStatus).map(([k, n]) => <span key={k} className="border border-line px-2 py-1"><Pill s={k} /> <b className="ml-1">{n}</b></span>) : <span className="text-fg-muted">No registrations yet.</span>}</div>
        {live && <p className="mt-2 text-xs text-fg-muted">Live counters: {ev.counters.unitsLive} place(s) taken, {ev.counters.confirmed} confirmed.</p>}
      </Section>

      <Section title="Audit history">
        {audit.error && <ErrorBox text={audit.error} retry={audit.reload} />}
        {audit.loading && !audit.data ? <Loading text="Loading history…" /> : !(audit.data?.audit.length) ? <p className="text-sm text-fg-muted">No history recorded.</p> : (
          <ul className="space-y-1 text-sm">
            {audit.data.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3"><span className="w-44 shrink-0 text-xs text-fg-muted">{when(a.at)}</span><span className="font-semibold">{label(a.action.replace(/\./g, ' '))}</span><span className="text-xs text-fg-muted">{a.actorRole || 'system'}{a.actorUserId ? ` #${short(a.actorUserId)}` : ''}</span>{a.details ? <code className="break-all text-xs text-fg-muted">{JSON.stringify(a.details)}</code> : null}</li>
            ))}
          </ul>
        )}
      </Section>

      {act && (
        <ConfirmDialog open tone={act === 'republish' || act === 'feature' ? 'good' : act === 'unfeature' ? 'primary' : 'bad'}
          title={{ unpublish: 'Hide this event from students?', republish: 'Make this event visible again?', cancel: 'Cancel this event?', feature: 'Feature this event?', unfeature: 'Stop featuring this event?' }[act]}
          confirmLabel={{ unpublish: 'Unpublish', republish: 'Republish', cancel: 'Cancel event', feature: 'Feature', unfeature: 'Unfeature' }[act]}
          reason={act === 'unpublish' ? { label: 'Reason (the organizer sees it)', min: 3 } : act === 'cancel' ? { label: 'Reason (registrants and the organizer see it)', min: 3 } : undefined}
          body={act === 'cancel' ? <CancelEffect ev={ev} stats={stats} /> : act === 'unpublish' ? <p>Students can no longer find or register. Existing registrations and tickets stay valid; nothing is refunded.</p> : undefined}
          onCancel={() => setAct(null)} onConfirm={run} />
      )}
    </section>
  );
}

function CancelEffect({ ev, stats }: { ev: AdminEvent; stats: EventDetail['stats'] }) {
  const draft = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED', 'SUBMITTED'].includes(ev.status);
  if (draft) return <p>This event never went live: it is simply closed. No registrations exist.</p>;
  const open = ['HELD', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLISTED', 'OFFERED'].reduce((n, k) => n + (stats.byStatus[k] || 0), 0);
  return (
    <>
      <p className="font-semibold text-danger-text">This cannot be undone.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li><b>{open}</b> open registration(s) end (incl. waitlist); every ticket is cancelled and stops working at the gate.</li>
        <li>Refunds are 100%: wallet {inr(stats.collected.WALLET)} back to wallets at once, online {inr(stats.collected.ONLINE)} via Razorpay refunds.</li>
        <li>Pay-at-venue money already collected ({inr(stats.collected.VENUE)}) must be handed back in cash, then marked refunded in Registrations.</li>
        <li>Teams are closed; registrants and the organizer get a notice with your reason.</li>
      </ul>
    </>
  );
}

/** Admin edit: only changed fields are sent (PATCH /events/:id, applied at once, audited). */
function EditForm({ ev, done }: { ev: AdminEvent; done: (text: string) => void }) {
  const init = () => ({
    title: ev.title, category: ev.category, venue: ev.venue || '', venueDirections: ev.venueDirections || '', description: ev.description || '',
    startAt: toLocalInput(ev.startAt), endAt: toLocalInput(ev.endAt), regOpensAt: toLocalInput(ev.regOpensAt), regClosesAt: toLocalInput(ev.regClosesAt),
    capacity: ev.capacityRaw === null || ev.capacityRaw === undefined ? '' : String(ev.capacityRaw), maxTeams: String(ev.team?.maxTeams ?? ''), teamMin: String(ev.team?.min ?? ''), teamMax: String(ev.team?.max ?? ''),
    maxBookingsPerStudent: String(ev.maxBookingsPerStudent ?? 1), priceType: ev.price.priceType, price: String(ev.rawPrice ?? 0),
    rules: ev.rules || '', instructions: ev.instructions || '', equipment: ev.equipment || '', contactText: ev.contactText || '',
    entryOpensBeforeMin: String(ev.entryOpensBeforeMin ?? 60), approvalRequired: ev.approvalRequired, waitlistEnabled: ev.waitlistEnabled,
  });
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);
  const [base] = useState(init);
  const set = (k: keyof ReturnType<typeof init>, v: string | boolean) => setF((cur) => ({ ...cur, [k]: v }));

  const save = async () => {
    const patch: Record<string, unknown> = {};
    const text = ['title', 'category', 'venue', 'venueDirections', 'description', 'rules', 'instructions', 'equipment', 'contactText'] as const;
    for (const k of text) if (f[k] !== base[k]) patch[k] = f[k];
    for (const k of ['startAt', 'endAt', 'regOpensAt', 'regClosesAt'] as const) {
      if (f[k] === base[k]) continue;
      if ((k === 'startAt' || k === 'endAt') && !f[k]) { setMsg({ ok: false, text: `${label(k)} cannot be empty.` }); return; }
      patch[k] = fromLocalInput(f[k]);
    }
    const ints: [keyof typeof f, string, number, number][] = [['entryOpensBeforeMin', 'Entry opens before', 0, 1440], ['maxBookingsPerStudent', 'Bookings per student', 1, 20]];
    if (ev.format === 'INDIVIDUAL') ints.push(['capacity', 'Capacity', 1, 100000]);
    if (ev.format === 'TEAM') ints.push(['maxTeams', 'Max teams', 1, 1000], ['teamMin', 'Min team size', 1, 50], ['teamMax', 'Max team size', 1, 50]);
    for (const [k, name, min, max] of ints) {
      if (f[k] === base[k]) continue;
      const n = Number(f[k]);
      if (!Number.isInteger(n) || n < min || n > max) { setMsg({ ok: false, text: `${name} must be a whole number from ${min} to ${max}.` }); return; }
      patch[k] = n;
    }
    if (f.priceType !== base.priceType) patch.priceType = f.priceType;
    if (f.price !== base.price) {
      const n = Number(f.price);
      if (!Number.isFinite(n) || n < 0) { setMsg({ ok: false, text: 'Price must be ₹0 or more.' }); return; }
      patch.price = n;
    }
    if (f.approvalRequired !== base.approvalRequired) patch.approvalRequired = f.approvalRequired;
    if (f.waitlistEnabled !== base.waitlistEnabled) patch.waitlistEnabled = f.waitlistEnabled;
    if (!Object.keys(patch).length) { setMsg({ ok: true, text: 'Nothing changed.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await campusEventsApi.editEvent(ev.id, patch as EventEdit);
      done(`Saved ${Object.keys(patch).length} field(s). The change is in the audit log${patch.venue !== undefined || patch.startAt !== undefined || patch.endAt !== undefined ? '; registrants are notified of the venue / time change' : ''}.`);
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not save.') }); } finally { setBusy(false); }
  };

  const txt = (k: keyof typeof f, name: string, max: number, hint?: string) => <Field name={name} hint={hint}><input className={inputCls} value={String(f[k])} maxLength={max} onChange={(e) => set(k, e.target.value)} /></Field>;
  const area = (k: keyof typeof f, name: string, max: number) => <Field name={name}><textarea className={inputCls} rows={3} value={String(f[k])} maxLength={max} onChange={(e) => set(k, e.target.value)} /></Field>;
  const dt = (k: keyof typeof f, name: string) => <Field name={name} hint="Your local time"><input type="datetime-local" className={inputCls} value={String(f[k])} onChange={(e) => set(k, e.target.value)} /></Field>;
  const numF = (k: keyof typeof f, name: string, hint?: string) => <Field name={name} hint={hint}><input type="number" className={inputCls} value={String(f[k])} onChange={(e) => set(k, e.target.value)} /></Field>;

  return (
    <Section title="Edit event (applied at once, audited)">
      <p className="mb-3 text-xs text-fg-muted">Capacity can never go below places already taken. Venue / time changes notify registrants. Changing the rules bumps the rules version.</p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {txt('title', 'Title', 120)}
        <Field name="Category"><select className={inputCls} value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}</select></Field>
        {txt('venue', 'Venue', 160)}
        {dt('startAt', 'Starts')}{dt('endAt', 'Ends')}{txt('venueDirections', 'Directions', 500)}
        {dt('regOpensAt', 'Registration opens')}{dt('regClosesAt', 'Registration closes')}
        {numF('entryOpensBeforeMin', 'Entry opens (min before start)', '0–1440')}
        {ev.format === 'INDIVIDUAL' && numF('capacity', 'Capacity (places)')}
        {ev.format === 'TEAM' && <>{numF('maxTeams', 'Max teams')}{numF('teamMin', 'Min team size')}{numF('teamMax', 'Max team size')}</>}
        {numF('maxBookingsPerStudent', 'Bookings per student', '1–20')}
        <Field name="Price type"><select className={inputCls} value={f.priceType} onChange={(e) => set('priceType', e.target.value)}><option value="FREE">Free</option><option value="PAID">Paid</option></select></Field>
        {numF('price', 'Price (₹)', 'Up to the max price setting')}
        {txt('contactText', 'Contact', 300)}
        <Field name="Options">
          <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={f.approvalRequired} onChange={(e) => set('approvalRequired', e.target.checked)} /> Organizer approves registrations</label>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={f.waitlistEnabled} onChange={(e) => set('waitlistEnabled', e.target.checked)} /> Waitlist</label>
        </Field>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {area('description', 'Description', 5000)}{area('rules', 'Rules', 5000)}{area('instructions', 'Instructions', 1000)}{area('equipment', 'Equipment', 1000)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Btn tone="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</Btn>
        <Btn disabled={busy} onClick={() => { setF(init()); setMsg(null); }}>Reset</Btn>
        <Msg msg={msg} />
      </div>
    </Section>
  );
}
