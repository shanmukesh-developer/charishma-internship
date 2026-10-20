"use client";

// Reports: GET /reports?from&to (default: last 30 days → next 365 days, by event start). Per event: registrations,
// confirmed, checked in, money collected by mode, still due at the venue, refunded. Real counts only.
import { useState } from 'react';
import { campusEventsApi, type Reports } from '@/lib/campusEventsApi';
import { Btn, Empty, ErrorBox, Field, Loading, Msg, Pill, StatCard, Toolbar, catLabel, inputCls, inr, useLoader, when, type Notice } from './shared';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsTab({ tick }: { tick: number }) {
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => ymd(new Date(Date.now() + 365 * 86400000)));
  const [query, setQuery] = useState({ from, to });
  const [msg, setMsg] = useState<Notice>(null);
  const { data, loading, error, reload } = useLoader(`rep:${query.from}:${query.to}`, tick, () => campusEventsApi.reports(`${query.from}T00:00:00+05:30`, `${query.to}T23:59:59+05:30`));
  const rows = data?.events || [];
  const t = data?.totals;

  const apply = () => {
    if (!from || !to || from > to) { setMsg({ ok: false, text: 'Pick a start date on or before the end date.' }); return; }
    setMsg(null);
    setQuery({ from, to });
  };

  return (
    <section className="space-y-4" aria-label="Reports">
      <Toolbar>
        <Field name="Events starting from"><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field name="to"><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Btn onClick={apply}>Apply</Btn>
        {data && <Btn onClick={() => downloadCsv(data)}>Download CSV</Btn>}
        <Msg msg={msg} />
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading && !data ? <Loading text="Loading reports…" /> : !t ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatCard name="Registrations" value={t.registrations} />
            <StatCard name="Confirmed" value={t.confirmed} tone="good" />
            <StatCard name="Checked in" value={t.checkedIn} />
            <StatCard name="Collected at venue" value={inr(t.collected.VENUE)} />
            <StatCard name="Wallet + online" value={inr(t.collected.WALLET + t.collected.ONLINE)} hint={`wallet ${inr(t.collected.WALLET)} · online ${inr(t.collected.ONLINE)}`} />
            <StatCard name="Still due at venue" value={inr(t.dueAtVenue)} tone={t.dueAtVenue ? 'warn' : 'plain'} hint={`refunded ${inr(t.refunded)}`} />
          </div>
          {rows.length === 0 ? <Empty text="No approved / published / finished events start in this period." /> : (
            <div className="overflow-x-auto border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">Event</th><th className="p-3">Starts</th><th className="p-3">Status</th><th className="p-3 text-right">Registrations</th><th className="p-3 text-right">Confirmed</th><th className="p-3 text-right">Checked in</th><th className="p-3 text-right">Venue ₹</th><th className="p-3 text-right">Wallet ₹</th><th className="p-3 text-right">Online ₹</th><th className="p-3 text-right">Due ₹</th><th className="p-3 text-right">Refunded ₹</th></tr></thead>
                <tbody className="divide-y divide-white/10">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="p-3"><span className="font-semibold">{r.title}</span><span className="block text-xs text-fg-muted">{catLabel(r.category)} · {r.format.toLowerCase()}{r.teams !== undefined ? ` · ${r.teams} team(s)` : ''}</span></td>
                      <td className="whitespace-nowrap p-3 text-xs">{when(r.startAt)}</td>
                      <td className="p-3"><Pill s={r.status} /></td>
                      <td className="p-3 text-right tabular-nums">{r.total}</td>
                      <td className="p-3 text-right tabular-nums">{r.confirmed}</td>
                      <td className="p-3 text-right tabular-nums">{r.checkedIn}{r.confirmed ? <span className="block text-xs text-fg-muted">{Math.round((r.checkedIn / r.confirmed) * 100)}%</span> : null}</td>
                      <td className="p-3 text-right tabular-nums">{inr(r.collected.VENUE)}</td>
                      <td className="p-3 text-right tabular-nums">{inr(r.collected.WALLET)}</td>
                      <td className="p-3 text-right tabular-nums">{inr(r.collected.ONLINE)}</td>
                      <td className="p-3 text-right tabular-nums">{inr(r.dueAtVenue)}</td>
                      <td className="p-3 text-right tabular-nums">{inr(r.refunded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-fg-muted">Period {when(data?.from)} → {when(data?.to)}. Collected = marked paid at the venue, or wallet / online payments that succeeded.</p>
        </>
      )}
    </section>
  );
}

function downloadCsv(r: Reports) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Event', 'Starts', 'Status', 'Category', 'Format', 'Registrations', 'Confirmed', 'Checked in', 'Venue', 'Wallet', 'Online', 'Due at venue', 'Refunded'];
  const lines = r.events.map((e) => [e.title, e.startAt, e.status, e.category, e.format, e.total, e.confirmed, e.checkedIn, e.collected.VENUE, e.collected.WALLET, e.collected.ONLINE, e.dueAtVenue, e.refunded].map(esc).join(','));
  const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `campus-events-report-${r.from.slice(0, 10)}-${r.to.slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
