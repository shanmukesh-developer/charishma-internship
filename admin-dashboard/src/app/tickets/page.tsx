"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { useLiveSync, useFreshIds, liveLabel, FRESH_ROW_CLASS } from '@/lib/useLiveSync';
import { ListPager, usePagedRows } from '@/components/ListPager';

type TicketStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed';

interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: string;
  slaBreachAt: string | null;
  createdAt: string;
  orderId?: string | null;
  adminResponse?: string | null;
  user?: { name: string | null; phone: string | null } | null;
}

const STATUSES: TicketStatus[] = ['Open', 'In Progress', 'Resolved', 'Closed'];
type Filter = 'active' | 'all' | TicketStatus;

// Quick replies reflect how Zenvy works today: COD + Wallet only, and the delivery PIN lives in the customer's app.
const QUICK_REPLIES = [
  { label: 'Expedited', text: 'Sorry for the delay. We have flagged your order as urgent with our campus delivery team.' },
  { label: 'Wallet refund', text: 'We have reviewed your order and refunded the amount to your Zenvy Wallet. You can see it in the Wallet section of the app.' },
  { label: 'Rider at gate', text: 'Your delivery partner is waiting at the hostel gate. Please share the delivery PIN shown on your order tracking screen to receive the order.' },
  { label: 'Need details', text: 'Thanks for reaching out. Could you share a few more details (order time, item names, a photo if relevant) so we can sort this out?' },
];

async function readError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return 'Your session has expired. Please sign in again.';
  if (res.status === 403) return 'You do not have permission to do that.';
  if (res.status >= 500) return 'The server had a problem. Please try again in a moment.';
  const data = await res.json().catch(() => null);
  return data && typeof data.message === 'string' && data.message.length < 200 ? data.message : fallback;
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error)?.message || fallback;

export default function SupportTickets() {
  const { isAuthed } = useAdminAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('active');
  const [, setNow] = useState(0);

  const { notifyLive } = useAdminSocket();
  const { mark: markFresh, isFresh } = useFreshIds();

  const fetchTickets = useCallback(async (quiet = false) => {
    if (!quiet) setLoadError(null);
    try {
      const res = await fetch(`${API_URL}/api/tickets/admin`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await readError(res, 'Could not load support tickets.'));
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
      if (quiet) setLoadError(null);
    } catch (err) {
      // A background (live) refresh keeps the last good list.
      if (!quiet) setLoadError(errorText(err, 'Could not load support tickets.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    fetchTickets();
  }, [isAuthed, fetchTickets]);

  // Realtime sync: new / updated tickets (customer, rider, or another admin tab) appear without a reload.
  useLiveSync(['ticket'], (events, { reconnect }) => {
    fetchTickets(true);
    if (reconnect) return;
    markFresh(events.map(e => e.id));
    const label = liveLabel(events.filter(e => e.action === 'created'), 'ticket');
    if (label) notifyLive(label);
  }, { enabled: isAuthed });

  // Re-render every minute so SLA countdowns stay accurate.
  useEffect(() => {
    const t = setInterval(() => setNow(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const saveTicket = async (ticket: Ticket, body: { status?: TicketStatus; adminResponse?: string }) => {
    if (savingId) return false;
    setSavingId(ticket.id);
    setRowError(prev => ({ ...prev, [ticket.id]: '' }));
    try {
      const res = await fetch(`${API_URL}/api/tickets/${ticket.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not update this ticket.'));
      const updated = await res.json().catch(() => null);
      // Update only this ticket so unsent drafts on other tickets are kept.
      setTickets(prev => prev.map(t => (t.id === ticket.id
        ? { ...t, status: updated?.status ?? body.status ?? t.status, adminResponse: updated?.adminResponse ?? body.adminResponse ?? t.adminResponse }
        : t)));
      return true;
    } catch (err) {
      setRowError(prev => ({ ...prev, [ticket.id]: errorText(err, 'Could not update this ticket.') }));
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const updateStatus = (ticket: Ticket, status: TicketStatus) => {
    if (status === 'Closed' && !confirm(`Close "${ticket.subject}"? The customer will be notified.`)) return;
    if (status === 'Resolved' && !confirm(`Mark "${ticket.subject}" as resolved? The customer will be notified.`)) return;
    saveTicket(ticket, { status });
  };

  const sendReply = async (ticket: Ticket) => {
    const reply = replies[ticket.id]?.trim();
    if (!reply) return;
    const nextStatus: TicketStatus | undefined = ticket.status === 'Open' ? 'In Progress' : undefined;
    const ok = await saveTicket(ticket, { adminResponse: reply, ...(nextStatus ? { status: nextStatus } : {}) });
    if (ok) setReplies(prev => { const next = { ...prev }; delete next[ticket.id]; return next; });
  };

  const getSlaStatus = (breachAt: string | null) => {
    if (!breachAt) return { text: 'No SLA', color: 'text-fg-muted' };
    const diffMs = new Date(breachAt).getTime() - Date.now();
    if (diffMs < 0) return { text: 'BREACHED', color: 'text-danger-text font-semibold bg-danger-soft px-2 py-1 rounded border border-danger/30' };
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return { text: `${hours}h ${mins}m left`, color: hours < 2 ? 'text-warning-text' : 'text-success-text' };
  };

  const priorityColors: Record<string, string> = {
    Critical: 'text-danger-text',
    High: 'text-warning-text',
    Medium: 'text-warning-text',
    Low: 'text-success-text',
  };

  const isActive = (t: Ticket) => t.status === 'Open' || t.status === 'In Progress';
  const activeCount = useMemo(() => tickets.filter(isActive).length, [tickets]);
  const visible = useMemo(
    () => tickets.filter(t => (filter === 'all' ? true : filter === 'active' ? isActive(t) : t.status === filter)),
    [tickets, filter],
  );
  // 30 ticket cards per page: typing a reply re-renders the list, so keep it short.
  const pager = usePagedRows(visible, 30, filter);

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Support tickets</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            {activeCount} Active &middot; {tickets.length} Total
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['active', 'all', ...STATUSES] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filter === f ? 'bg-accent text-on-solid' : 'bg-surface-2 text-fg-muted hover:text-fg'}`}
            >
              {f === 'active' ? 'Active' : f === 'all' ? 'All' : f}
            </button>
          ))}
          <button onClick={() => { setLoading(true); fetchTickets(); }} disabled={loading} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 text-fg-muted hover:text-fg disabled:opacity-40">Refresh</button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-danger/30 bg-danger-soft px-6 py-4 text-sm font-semibold text-danger-text">
          <span>{loadError}</span>
          <button onClick={() => { setLoading(true); fetchTickets(); }} className="text-xs text-fg hover:underline">Retry</button>
        </div>
      )}

      <div className="grid gap-4">
        {loading && tickets.length === 0 ? (
          <div className="p-12 text-center text-fg-muted animate-pulse font-semibold">Loading tickets…</div>
        ) : pager.visible.map(ticket => {
          const sla = getSlaStatus(ticket.slaBreachAt);
          const saving = savingId === ticket.id;
          const draft = replies[ticket.id] ?? '';
          return (
            <div key={ticket.id} className={`bg-surface-2 border border-line p-6 rounded-lg flex flex-col gap-4 hover:border-line transition-colors ${isFresh(ticket.id) ? FRESH_ROW_CLASS : ''}`}>
              <div className="flex flex-wrap gap-3 justify-between items-start">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-fg break-words">{ticket.subject}</h3>
                  <p className="text-sm text-fg-muted mt-0.5">
                    <span className="font-semibold">{ticket.user?.name || 'Customer'}</span>
                    {ticket.user?.phone && (
                      <a href={`tel:${ticket.user.phone}`} className="text-info-text hover:text-info-text ml-2 font-mono text-xs">
                        {ticket.user.phone}
                      </a>
                    )}
                    <span className="text-fg-subtle font-mono ml-2 text-xs">#{ticket.id.slice(0, 8)}</span>
                    {ticket.orderId && <span className="text-fg-muted font-mono ml-2 text-xs">Order #{ticket.orderId.slice(-6).toUpperCase()}</span>}
                  </p>
                  <p className="text-xs text-fg-subtle mt-1">Opened {new Date(ticket.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-xs font-semibold ${priorityColors[ticket.priority] || 'text-info-text'}`}>
                    {ticket.priority} Priority
                  </span>
                  {isActive(ticket) && (
                    <span className={`text-xs ${sla.color}`}>SLA: {sla.text}</span>
                  )}
                </div>
              </div>

              <div className="bg-surface-2 p-4 rounded-xl border border-line">
                <p className="text-sm text-fg-muted whitespace-pre-wrap break-words">{ticket.description}</p>
              </div>

              {ticket.adminResponse && (
                <div className="bg-info-soft p-4 rounded-xl border border-info/30">
                  <p className="text-xs font-semibold text-info-text mb-1">Last reply sent to customer</p>
                  <p className="text-sm text-fg-muted whitespace-pre-wrap break-words">{ticket.adminResponse}</p>
                </div>
              )}

              <div className="bg-surface-2 border border-info/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-xs font-semibold text-info-text">Reply (customer gets a push notification)</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-fg-muted">Quick insert:</span>
                    {QUICK_REPLIES.map(tpl => (
                      <button
                        key={tpl.label}
                        type="button"
                        onClick={() => setReplies(prev => ({ ...prev, [ticket.id]: tpl.text }))}
                        className="text-xs font-semibold px-2 py-0.5 bg-surface-2/60 hover:bg-surface-2 text-fg-muted rounded border border-line transition-colors"
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={draft}
                  onChange={e => setReplies(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                  placeholder="Type your response to the customer or pick a quick insert above…"
                  className="w-full bg-surface-2 border border-line rounded-xl px-4 py-3 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent resize-none transition-all"
                />
                <button
                  onClick={() => sendReply(ticket)}
                  disabled={!!savingId || !draft.trim()}
                  className="px-5 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-on-solid text-xs font-semibold rounded-lg transition-all"
                >
                  {saving ? 'Sending…' : 'Send reply'}
                </button>
              </div>

              {rowError[ticket.id] && <p role="alert" className="text-sm font-semibold text-danger-text">{rowError[ticket.id]}</p>}

              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-xs font-semibold text-fg-muted">Status:</span>
                {STATUSES.map(status => (
                  <button
                    key={status}
                    onClick={() => updateStatus(ticket, status)}
                    disabled={ticket.status === status || !!savingId}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:cursor-not-allowed ${
                      ticket.status === status
                        ? 'bg-accent text-on-solid'
                        : 'bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-2 disabled:opacity-50'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <ListPager page={pager.page} pages={pager.pages} total={pager.total} pageSize={pager.pageSize} onPage={pager.setPage} noun="tickets" />
        {!loading && !loadError && visible.length === 0 && (
          <div className="p-12 text-center text-fg-muted bg-surface-2 rounded-lg border border-line">
            {tickets.length === 0 ? 'No support tickets yet.' : 'No tickets match this filter.'}
          </div>
        )}
      </div>
    </div>
  );
}
