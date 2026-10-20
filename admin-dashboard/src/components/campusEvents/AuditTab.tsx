"use client";

// Audit: GET /audit?eventId&action&actorRole&page&limit (CeAuditLog: approvals, edits, cancellations, refunds,
// overrides, roster, payment marks, staff grants). Every filter is server-side; action = a family ("event") or exact.

import { useEffect, useMemo, useState } from 'react';
import { AUDIT_FAMILIES, AUDIT_ROLES, campusEventsApi } from '@/lib/campusEventsApi';
import { Btn, Empty, ErrorBox, Loading, PageNav, Select, Toolbar, label, short, useLoader, when } from './shared';

export default function AuditTab({ tick }: { tick: number }) {
  const events = useLoader('audit-events', tick, () => campusEventsApi.events({ limit: 200 }));
  const [eventId, setEventId] = useState('');
  const [action, setAction] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [eventId, action, role]);
  const { data, loading, error, reload } = useLoader(`audit:${eventId}:${action}:${role}:${page}`, tick, () => campusEventsApi.audit(eventId || undefined, { page, limit: 100, action: action || undefined, actorRole: role || undefined }));
  const all = useMemo(() => data?.audit || [], [data]);
  // Families always offered; exact actions seen on this page are added below them.
  const actions = useMemo(() => [...new Set([...AUDIT_FAMILIES, ...all.map((a) => a.action)])], [all]);
  const rows = all;
  const titles = useMemo(() => new Map((events.data?.events || []).map((e) => [e.id, e.title])), [events.data]);

  return (
    <section className="space-y-4" aria-label="Audit log">
      <Toolbar>
        <Select name="Event" value={eventId} onChange={setEventId} options={[{ value: '', label: 'All events' }, ...(events.data?.events || []).map((e) => ({ value: e.id, label: e.title.slice(0, 40) }))]} />
        <Select name="Action" value={action} onChange={setAction} options={[{ value: '', label: 'Any' }, ...actions.map((a) => ({ value: a, label: a.includes('.') ? a : `${a}.* (all)` }))]} />
        <Select name="By" value={role} onChange={setRole} options={[{ value: '', label: 'Anyone' }, ...AUDIT_ROLES.map((r) => ({ value: r, label: r }))]} />
        {(action || role) && <Btn onClick={() => { setAction(''); setRole(''); }}>Clear</Btn>}
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading && !data ? <Loading text="Loading audit log…" /> : rows.length === 0 ? <Empty text={action || role || eventId ? 'No entries match the filters.' : 'No Campus Events actions recorded yet.'} /> : (
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">When</th><th className="p-3">Action</th><th className="p-3">Event</th><th className="p-3">Registration / team</th><th className="p-3">By</th><th className="p-3">Details</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="whitespace-nowrap p-3 text-xs">{when(a.at)}</td>
                  <td className="p-3 text-xs font-semibold">{label(a.action.replace(/\./g, ' '))}</td>
                  <td className="p-3 text-xs">{a.eventId ? <button type="button" className="text-left text-info-text underline" title="Filter by this event" onClick={() => setEventId(a.eventId as string)}>{titles.get(a.eventId) || `#${short(a.eventId)}`}</button> : '—'}</td>
                  <td className="p-3 font-mono text-xs text-fg-muted">{a.registrationId ? `reg #${short(a.registrationId)}` : ''}{a.teamId ? ` team #${short(a.teamId)}` : ''}</td>
                  <td className="p-3 text-xs text-fg-muted">{a.actorName ? <span className="font-semibold text-fg">{a.actorName} </span> : null}{a.actorRole || 'system'}{a.actorUserId ? <span className="font-mono"> #{short(a.actorUserId)}</span> : null}</td>
                  <td className="p-3"><code className="block max-w-xl whitespace-pre-wrap break-all text-xs text-fg-muted">{a.details === null || a.details === undefined ? '' : typeof a.details === 'string' ? a.details : JSON.stringify(a.details)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <PageNav page={data.pagination.page} hasMore={data.pagination.hasMore} onPage={setPage} count={all.length} noun="entries" />}
    </section>
  );
}
