"use client";

// Registrations & payments: GET /registrations (event / status / payment filters + server search by code, name or
// phone last 4; each row carries its ticket summary), approve / reject PENDING_APPROVAL (audited), cancel (full
// refund), refund (idempotent: retry wallet / online, or record a cash venue refund), mark paid at venue, ticket
// void / reissue. Online payment rows: GET /payments. Only a masked phone (last 4) is ever shown.
import { useEffect, useMemo, useState } from 'react';
import {
  OPEN_REG_STATUSES, PAYMENT_MODES, PAYMENT_STATUSES, PAY_ROW_STATUSES, REG_STATUSES, campusEventsApi,
  type Registration, type TicketBrief,
} from '@/lib/campusEventsApi';
import {
  Btn, ConfirmDialog, Empty, ErrorBox, Loading, Msg, PageNav, Pill, Section, Select, Toolbar, inr, short, useLoader, when, type Notice,
} from './shared';

const PAGE = 100;
type Act = { kind: 'cancel' | 'refund' | 'paid' | 'approve' | 'reject'; reg: Registration } | { kind: 'void' | 'reissue'; reg: Registration; ticket: TicketBrief };

export default function RegistrationsTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [eventId, setEventId] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [act, setAct] = useState<Act | null>(null);
  const [msg, setMsg] = useState<Notice>(null);
  const [showPayments, setShowPayments] = useState(false);
  useEffect(() => { setPage(1); }, [eventId, status, paymentStatus, paymentMode, query]);

  const events = useLoader('reg-events', tick, () => campusEventsApi.events({ limit: 200 }));
  const key = `${eventId}|${status}|${paymentStatus}|${paymentMode}|${query}|${page}`;
  const { data, loading, error, reload } = useLoader(key, tick, () => campusEventsApi.registrations({ eventId: eventId || undefined, status: status || undefined, paymentStatus: paymentStatus || undefined, paymentMode: paymentMode || undefined, q: query || undefined, page, limit: PAGE }));
  const all = useMemo(() => data?.registrations || [], [data]);
  // Rows carry their ticket summary. An older server leaves it out: then the per-event participant list fills it.
  const needTickets = !!eventId && all.some((r) => r.ticket === undefined);
  const tickets = useLoader(`reg-tk:${eventId}:${needTickets}`, tick, () => (needTickets ? campusEventsApi.eventRegistrations(eventId) : Promise.resolve({ registrations: [] as Registration[] })));
  const ticketByReg = useMemo(() => new Map((tickets.data?.registrations || []).map((r) => [r.id, r.ticket])), [tickets.data]);
  const rows = all;

  const run = async (reason: string) => {
    if (!act) return;
    const r = act.reg;
    if (act.kind === 'cancel') { const out = await campusEventsApi.cancelRegistration(r.id, reason); setMsg({ ok: true, text: `${r.code} cancelled (${out.registration.paymentStatus === 'REFUND_PENDING' ? 'refund pending' : out.registration.paymentStatus.toLowerCase().replaceAll('_', ' ')}).` }); }
    if (act.kind === 'refund') { const out = await campusEventsApi.refund(r.id); setMsg({ ok: true, text: out.registration.paymentStatus === 'REFUNDED' ? `${r.code}: ${inr(out.registration.refundAmount)} refunded.` : `${r.code}: refund still pending (${out.registration.paymentStatus}). It is retried automatically.` }); }
    if (act.kind === 'approve') { await campusEventsApi.approveRegistration(r.id); setMsg({ ok: true, text: `${r.code} approved: confirmed, ticket issued, student notified.` }); }
    if (act.kind === 'reject') { await campusEventsApi.rejectRegistration(r.id, reason); setMsg({ ok: true, text: `${r.code} rejected; the place is released.` }); }
    if (act.kind === 'paid') { await campusEventsApi.markPaid(r.id); setMsg({ ok: true, text: `${r.code}: fee marked as collected at the venue.` }); }
    if (act.kind === 'void') { await campusEventsApi.voidTicket(act.ticket.id, reason); setMsg({ ok: true, text: `Ticket ${act.ticket.ticketCode} voided. It is refused at the gate.` }); }
    if (act.kind === 'reissue') { const out = await campusEventsApi.reissueTicket(act.ticket.id); setMsg({ ok: true, text: `New ticket ${out.ticket.ticketCode} issued; the old QR / code no longer works.` }); }
    setAct(null);
    onChanged(); reload(); tickets.reload();
  };

  return (
    <section className="space-y-4" aria-label="Registrations and payments">
      <Toolbar>
        <Select name="Event" value={eventId} onChange={setEventId} options={[{ value: '', label: 'All events' }, ...(events.data?.events || []).map((e) => ({ value: e.id, label: e.title.slice(0, 40) }))]} />
        <Select name="Status" value={status} onChange={setStatus} options={['', ...REG_STATUSES]} allLabel="Any" />
        <Select name="Payment" value={paymentStatus} onChange={setPaymentStatus} options={['', ...PAYMENT_STATUSES]} allLabel="Any" />
        <Select name="Mode" value={paymentMode} onChange={setPaymentMode} options={['', ...PAYMENT_MODES]} allLabel="Any" />
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, name or phone last 4" maxLength={60} className="w-60 border border-line bg-surface p-2 text-sm text-fg" aria-label="Search registrations" />
          <Btn type="submit">Search</Btn>
          {query && <Btn onClick={() => { setSearch(''); setQuery(''); }}>Clear</Btn>}
        </form>
        <Btn onClick={() => setShowPayments((x) => !x)}>{showPayments ? 'Hide online payments' : 'Online payment records'}</Btn>
      </Toolbar>
      {events.error && <ErrorBox text={`Event list: ${events.error}`} retry={events.reload} />}
      {tickets.error && eventId && <ErrorBox text={`Tickets: ${tickets.error}`} retry={tickets.reload} />}
      <Msg msg={msg} />
      {showPayments && <PaymentsPanel tick={tick} />}
      {error && <ErrorBox text={error} retry={reload} />}
      {loading && !data ? <Loading text="Loading registrations…" /> : rows.length === 0 ? <Empty text={query ? `No registration matches "${query}".` : 'No registrations match these filters.'} /> : (
        <div className="zv-table-wrap">
          <table className="zv-table">
            <thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">Code</th><th className="p-3">Student / team</th><th className="p-3">Event</th><th className="p-3">Status</th><th className="p-3">Payment</th><th className="p-3">Ticket</th><th className="p-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((r) => {
                const tk = r.ticket || ticketByReg.get(r.id) || null;
                const tkCode = tk ? tk.code || tk.ticketCode : '';
                return (
                  <tr key={r.id} className="align-top">
                    <td className="p-3 font-mono text-xs">{r.code}<span className="block text-fg-muted">{when(r.createdAt)}</span></td>
                    <td className="p-3 text-xs">{r.name}{r.team && <span className="block text-fg-muted">Team {r.team.name}</span>}<span className="block font-mono text-fg-subtle">user #{short(r.userId)}{r.phoneMasked ? ` · ${r.phoneMasked}` : ''}</span></td>
                    <td className="p-3 text-xs">{r.eventTitle || '—'}<span className="block text-fg-muted">{r.type.toLowerCase()}{r.unitNo ? ` · place ${r.unitNo}` : ''}</span></td>
                    <td className="p-3"><Pill s={r.status} /></td>
                    <td className="p-3 text-xs">{r.paymentMode === 'NONE' ? 'Free' : <>{r.paymentMode.toLowerCase()} · {inr(r.total)}</>}<span className="mt-1 block"><Pill s={r.paymentStatus} /></span>{r.payment?.refundAmount ? <span className="block text-fg-muted">refund {inr(r.payment.refundAmount)}{r.payment.refundedAt ? ` · ${when(r.payment.refundedAt)}` : ''}</span> : null}{r.refundAttempts ? <span className="block text-warning-text">{r.refundAttempts} refund attempt(s)</span> : null}</td>
                    <td className="p-3 text-xs">{tk ? <><span className="font-mono">{tkCode}</span><span className="mt-1 block"><Pill s={tk.status} /></span></> : <span className="text-fg-muted">none</span>}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {r.status === 'PENDING_APPROVAL' && <Btn tone="good" onClick={() => setAct({ kind: 'approve', reg: r })}>Approve</Btn>}
                        {r.status === 'PENDING_APPROVAL' && <Btn tone="bad" onClick={() => setAct({ kind: 'reject', reg: r })}>Reject</Btn>}
                        {OPEN_REG_STATUSES.includes(r.status) && <Btn tone="bad" onClick={() => setAct({ kind: 'cancel', reg: r })}>Cancel</Btn>}
                        {r.paymentStatus === 'REFUND_PENDING' && <Btn tone="primary" onClick={() => setAct({ kind: 'refund', reg: r })}>{r.paymentMode === 'VENUE' ? 'Mark cash refunded' : 'Refund now'}</Btn>}
                        {r.paymentStatus === 'DUE_AT_VENUE' && <Btn onClick={() => setAct({ kind: 'paid', reg: r })}>Mark paid</Btn>}
                        {tk && tk.status === 'ACTIVE' && <Btn tone="bad" onClick={() => setAct({ kind: 'void', reg: r, ticket: tk })}>Void ticket</Btn>}
                        {tk && r.status === 'CONFIRMED' && ['ACTIVE', 'VOID'].includes(tk.status) && <Btn onClick={() => setAct({ kind: 'reissue', reg: r, ticket: tk })}>Reissue</Btn>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <PageNav page={data.pagination.page} hasMore={data.pagination.hasMore} onPage={setPage} count={all.length} noun="registrations" />}

      {act && (
        <ConfirmDialog open tone={act.kind === 'cancel' || act.kind === 'void' || act.kind === 'reject' ? 'bad' : act.kind === 'refund' ? 'primary' : 'good'}
          title={{ approve: `Approve ${act.reg.code}?`, reject: `Reject ${act.reg.code}?`, cancel: `Cancel ${act.reg.code}?`, refund: act.reg.paymentMode === 'VENUE' ? `Record the cash refund for ${act.reg.code}?` : `Refund ${act.reg.code} now?`, paid: `Mark ${act.reg.code} as paid at the venue?`, void: 'Void this ticket?', reissue: 'Reissue this ticket?' }[act.kind]}
          confirmLabel={{ approve: 'Approve', reject: 'Reject', cancel: 'Cancel registration', refund: act.reg.paymentMode === 'VENUE' ? 'Cash handed back' : 'Refund', paid: 'Mark paid', void: 'Void ticket', reissue: 'Reissue' }[act.kind]}
          reason={act.kind === 'cancel' || act.kind === 'reject' ? { label: 'Reason (the student sees it)', min: 3 } : act.kind === 'void' ? { label: 'Reason (kept in the audit log)', min: 3 } : undefined}
          body={{
            approve: <p>Confirms the registration and issues the ticket (same service as the organizer approval; audited).</p>,
            reject: <p>Ends the registration{act.reg.total ? ` (full refund of ${inr(act.reg.total)} if anything was paid)` : ''} and releases the place to the waitlist. Audited.</p>,
            cancel: <p>Admin cancellation refunds 100% ({inr(act.reg.total)} {act.reg.paymentMode.toLowerCase()}), cancels the ticket and frees the place for the waitlist.</p>,
            refund: act.reg.paymentMode === 'VENUE' ? <p>Only confirm after the {inr(act.reg.payment?.refundAmount ?? act.reg.total)} cash was handed back to the student.</p> : <p>Retries the {act.reg.paymentMode.toLowerCase()} refund now. Safe to repeat: a refund is never paid twice.</p>,
            paid: <p>Records that {inr(act.reg.total)} was collected in person (audited).</p>,
            void: <p>The QR and code stop working at once. The registration itself stays as it is; reissue later if needed.</p>,
            reissue: <p>A new QR and code are issued; the old ones stop working. The student is notified.</p>,
          }[act.kind]}
          onCancel={() => setAct(null)} onConfirm={run} />
      )}
    </section>
  );
}

function PaymentsPanel({ tick }: { tick: number }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [status]);
  const { data, loading, error, reload } = useLoader(`pay:${status}:${page}`, tick, () => campusEventsApi.payments(status || undefined, { page, limit: 50 }));
  const rows = data?.payments || [];
  return (
    <Section title="Online payment records (Razorpay / wallet rows; no card data is stored)" right={<Select name="Status" value={status} onChange={setStatus} options={['', ...PAY_ROW_STATUSES]} allLabel="Any" />}>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading && !data ? <Loading text="Loading payments…" /> : rows.length === 0 ? <Empty text="No payment records." /> : (
        <div className="overflow-x-auto">
          <table className="zv-table zv-table-dense">
            <thead className="text-fg-muted"><tr><th className="p-2">When</th><th className="p-2">Provider</th><th className="p-2">Amount</th><th className="p-2">Status</th><th className="p-2">Order / payment</th><th className="p-2">Registration</th><th className="p-2">Failure</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((p) => <tr key={p.id}><td className="p-2">{when(p.createdAt)}</td><td className="p-2">{p.provider}</td><td className="p-2">{inr(p.amount)}</td><td className="p-2"><Pill s={p.status} /></td><td className="p-2 font-mono">{p.providerOrderId || '—'}<span className="block">{p.providerPaymentId || ''}</span></td><td className="p-2 font-mono">#{short(p.registrationId)}</td><td className="p-2 text-danger-text">{p.failureReason || ''}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {data && <div className="mt-2"><PageNav page={data.pagination.page} hasMore={data.pagination.hasMore} onPage={setPage} count={rows.length} noun="payments" /></div>}
    </Section>
  );
}
