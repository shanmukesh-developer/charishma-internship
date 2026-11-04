"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { useLiveSync, useFreshIds, liveLabel, FRESH_ROW_CLASS } from '@/lib/useLiveSync';
import {
  Badge, Button, DataTable, DescriptionList, Drawer, Field, IconButton, Input, Modal, Notice as NoticeBox, PageHeader, SearchInput,
  SegmentedControl, Select, StatusPill, Textarea, Toolbar, useConfirm, useToast, type Column, IconPlus, IconRefresh, IconTrash,
} from '@/components/ui';
import { formatDateTime, formatPhone, formatRelative } from '@/lib/format';

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
  assigneeId?: string | null;
  assigneeName?: string | null;
}
interface CannedReply { title: string; text: string }

const STATUSES: TicketStatus[] = ['Open', 'In Progress', 'Resolved', 'Closed'];
type Filter = 'active' | 'all' | TicketStatus;

// Quick replies reflect how Zenvy works today: COD + Wallet only, and the delivery PIN lives in the customer's app.
const QUICK_REPLIES_FALLBACK = [
  { label: 'Expedited', text: 'Sorry for the delay. We have flagged your order as urgent with our campus delivery team.' },
  { label: 'Wallet refund', text: 'We have reviewed your order and refunded the amount to your ZENV Wallet. You can see it in the Wallet section of the app.' },
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
  const { isAuthed, user: me } = useAdminAuth();
  const confirm = useConfirm();
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // ?search=<phone or text> (from Customers → a customer → Support tickets).
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const s0 = qs.get('search');
    if (s0) { setSearch(s0); setFilter('all'); }
  }, []);
  const [owner, setOwner] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [canned, setCanned] = useState<CannedReply[]>(QUICK_REPLIES_FALLBACK.map(r => ({ title: r.label, text: r.text })));
  const [cannedOpen, setCannedOpen] = useState(false);
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
    // Admins a ticket can be assigned to, and the shared canned replies (older servers: keep the fallbacks).
    fetch(`${API_URL}/api/tickets/admin/assignees`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : [])).then(d => setAssignees(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API_URL}/api/tickets/admin/canned-replies`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => { if (Array.isArray(d?.replies)) setCanned(d.replies); }).catch(() => {});
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

  const saveTicket = async (ticket: Ticket, body: { status?: TicketStatus; adminResponse?: string; assigneeId?: string | null }) => {
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
        ? { ...t, status: updated?.status ?? body.status ?? t.status, adminResponse: updated?.adminResponse ?? body.adminResponse ?? t.adminResponse, assigneeId: updated ? updated.assigneeId ?? null : t.assigneeId, assigneeName: updated ? updated.assigneeName ?? null : t.assigneeName }
        : t)));
      return true;
    } catch (err) {
      setRowError(prev => ({ ...prev, [ticket.id]: errorText(err, 'Could not update this ticket.') }));
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const updateStatus = async (ticket: Ticket, status: TicketStatus) => {
    if (status === 'Closed' && !(await confirm({ title: 'Close this ticket?', description: `“${ticket.subject}”. The customer is notified.`, confirmLabel: 'Close ticket' }))) return;
    if (status === 'Resolved' && !(await confirm({ title: 'Mark this ticket as resolved?', description: `“${ticket.subject}”. The customer is notified.`, confirmLabel: 'Mark resolved' }))) return;
    saveTicket(ticket, { status });
  };
  const assignTicket = (ticket: Ticket, assigneeId: string | null) => { saveTicket(ticket, { assigneeId }); };

  const sendReply = async (ticket: Ticket) => {
    const reply = replies[ticket.id]?.trim();
    if (!reply) return;
    const nextStatus: TicketStatus | undefined = ticket.status === 'Open' ? 'In Progress' : undefined;
    const ok = await saveTicket(ticket, { adminResponse: reply, ...(nextStatus ? { status: nextStatus } : {}) });
    if (ok) setReplies(prev => { const next = { ...prev }; delete next[ticket.id]; return next; });
  };

  const isActive = (t: Ticket) => t.status === 'Open' || t.status === 'In Progress';
  const activeCount = useMemo(() => tickets.filter(isActive).length, [tickets]);
  const visible = useMemo(
    () => tickets.filter(t => (filter === 'all' ? true : filter === 'active' ? isActive(t) : t.status === filter)),
    [tickets, filter],
  );

  if (!isAuthed) return null; // AppShell shows the session check

  const selected = openId ? tickets.find(t => t.id === openId) || null : null;
  const priorityTone = (p: string): 'danger' | 'warning' | 'neutral' => (p === 'Critical' ? 'danger' : p === 'High' ? 'warning' : 'neutral');
  const statusToneOf = (s: TicketStatus) => (s === 'Open' ? 'warning' : s === 'In Progress' ? 'info' : s === 'Resolved' ? 'success' : 'neutral') as 'warning' | 'info' | 'success' | 'neutral';
  const q = search.trim().toLowerCase();
  const shown = visible.filter(t =>
    (owner === 'all' || (owner === 'mine' ? t.assigneeId === me?.id : !t.assigneeId)) &&
    (!q || `${t.subject} ${t.user?.name || ''} ${t.user?.phone || ''} ${t.id} ${t.orderId || ''}`.toLowerCase().includes(q)));

  const slaCell = (t: Ticket) => {
    if (!isActive(t)) return <span className="text-xs text-fg-subtle">–</span>;
    if (!t.slaBreachAt) return <span className="text-xs text-fg-muted">No SLA</span>;
    const diffMs = new Date(t.slaBreachAt).getTime() - Date.now();
    if (diffMs < 0) return <Badge tone="danger">Overdue</Badge>;
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return <span className={`text-xs tabular-nums ${hours < 2 ? 'text-warning-text' : 'text-fg-muted'}`}>{hours} h {mins} min left</span>;
  };

  const columns: Column<Ticket>[] = [
    {
      key: 'subject',
      header: 'Ticket',
      sortValue: t => t.subject,
      cell: t => (
        <div className="min-w-0 max-w-[420px]">
          <p className="truncate font-medium text-fg">{t.subject}</p>
          <p className="truncate text-xs text-fg-muted">{t.user?.name || 'Customer'}{t.user?.phone ? ` · ${formatPhone(t.user.phone)}` : ''}{t.orderId ? ` · order #${t.orderId.slice(-6).toUpperCase()}` : ''}</p>
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', sortValue: t => ['Critical', 'High', 'Medium', 'Low'].indexOf(t.priority), cell: t => <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge> },
    { key: 'sla', header: 'Reply due', hideBelow: 'lg', sortValue: t => (t.slaBreachAt && isActive(t) ? new Date(t.slaBreachAt) : null), cell: slaCell },
    { key: 'assignee', header: 'Assigned to', hideBelow: 'lg', sortValue: t => t.assigneeName || '', cell: t => (t.assigneeName ? <span className="text-fg">{t.assigneeId === me?.id ? 'You' : t.assigneeName}</span> : <span className="text-fg-subtle">Nobody</span>) },
    { key: 'status', header: 'Status', sortValue: t => STATUSES.indexOf(t.status), cell: t => <StatusPill status={t.status} tone={statusToneOf(t.status)} label={t.status} /> },
    { key: 'opened', header: 'Opened', align: 'right', sortValue: t => new Date(t.createdAt), cell: t => <span className="whitespace-nowrap text-xs text-fg-muted">{formatRelative(t.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Support tickets"
        description="Help requests from customers and riders: reply, assign an owner and move them to resolved."
        meta={<Badge tone={activeCount ? 'warning' : 'success'}>{activeCount} active</Badge>}
        actions={
          <>
            <Button onClick={() => setCannedOpen(true)}>Canned replies</Button>
            <Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={() => { setLoading(true); fetchTickets(); }}>Refresh</Button>
          </>
        }
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{shown.length} of {tickets.length} tickets</span>}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search subject, name, phone or order" />
        <SegmentedControl
          ariaLabel="Status"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'active', label: 'Active', count: activeCount }, { value: 'all', label: 'All' }, ...STATUSES.map(s => ({ value: s as Filter, label: s }))]}
        />
        <Select aria-label="Owner" value={owner} onChange={e => setOwner(e.target.value as typeof owner)} className="w-auto">
          <option value="all">Any owner</option>
          <option value="mine">Assigned to me</option>
          <option value="unassigned">Not assigned</option>
        </Select>
      </Toolbar>

      <DataTable
        caption="Support tickets"
        columns={columns}
        rows={shown}
        rowKey={t => t.id}
        loading={loading}
        error={loadError}
        onRetry={() => { setLoading(true); fetchTickets(); }}
        onRowClick={t => setOpenId(t.id)}
        rowClassName={t => (isFresh(t.id) ? FRESH_ROW_CLASS : undefined)}
        initialSort={{ key: 'opened', dir: 'desc' }}
        noun="tickets"
        resetPageKey={`${filter}|${owner}|${search}`}
        empty={{ title: tickets.length === 0 ? 'No support tickets yet' : 'No tickets match', description: tickets.length === 0 ? undefined : 'Change the filters or search.' }}
      />

      <Drawer
        open={!!selected}
        onClose={() => setOpenId(null)}
        size="lg"
        title={selected?.subject || 'Ticket'}
        description={selected ? `#${selected.id.slice(0, 8)} · opened ${formatDateTime(selected.createdAt)}` : undefined}
        headerActions={selected ? <StatusPill status={selected.status} tone={statusToneOf(selected.status)} label={selected.status} /> : undefined}
      >
        {selected && (
          <div className="space-y-6">
            {rowError[selected.id] && <NoticeBox tone="danger"><span className="text-fg">{rowError[selected.id]}</span></NoticeBox>}
            <DescriptionList
              columns={2}
              items={[
                {
                  label: 'From',
                  value: (
                    <>
                      <span className="font-medium">{selected.user?.name || 'Customer'}</span>
                      {selected.user?.phone && <a href={`tel:${selected.user.phone}`} className="block text-accent-text hover:underline">{formatPhone(selected.user.phone)}</a>}
                      {selected.user?.phone && (
                        <span className="mt-1 flex flex-wrap gap-3 text-xs">
                          <a href={`/users?search=${encodeURIComponent(String(selected.user.phone).replace(/\D/g, '').slice(-10))}`} className="text-accent-text hover:underline">Customer record</a>
                        </span>
                      )}
                    </>
                  ),
                },
                { label: 'Priority', value: <Badge tone={priorityTone(selected.priority)}>{selected.priority}</Badge> },
                { label: 'Order', value: selected.orderId ? <a href={`/orders?order=${encodeURIComponent(selected.orderId)}`} className="text-accent-text hover:underline">#{selected.orderId.slice(-6).toUpperCase()}</a> : 'None' },
                { label: 'Reply due', value: slaCell(selected) },
              ]}
            />

            <Field label="Assigned to" hint="The admin who owns this ticket. Every change is in the audit log.">
              <Select value={selected.assigneeId || ''} disabled={!!savingId} onChange={e => assignTicket(selected, e.target.value || null)}>
                <option value="">Nobody</option>
                {me?.id && !assignees.some(a => a.id === me.id) && <option value={me.id}>Me</option>}
                {assignees.map(a => <option key={a.id} value={a.id}>{a.id === me?.id ? `${a.name} (you)` : a.name}</option>)}
              </Select>
            </Field>

            <div>
              <p className="mb-1 text-xs text-fg-muted">Message</p>
              <div className="whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2/50 p-3 text-sm text-fg">{selected.description}</div>
            </div>
            {selected.adminResponse && (
              <div>
                <p className="mb-1 text-xs text-fg-muted">Replies sent to the customer</p>
                <div className="whitespace-pre-wrap break-words rounded-lg border border-accent/20 bg-accent-soft/50 p-3 text-sm text-fg">{selected.adminResponse}</div>
              </div>
            )}

            <section className="space-y-3 rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg">Reply</h3>
                <Select aria-label="Insert a canned reply" value="" onChange={e => { const r = canned[Number(e.target.value)]; if (r) setReplies(prev => ({ ...prev, [selected.id]: r.text })); }} className="w-auto">
                  <option value="">Insert a canned reply</option>
                  {canned.map((r, i) => <option key={`${r.title}-${i}`} value={i}>{r.title}</option>)}
                </Select>
              </div>
              <Textarea rows={4} maxLength={1000} value={replies[selected.id] ?? ''} onChange={e => setReplies(prev => ({ ...prev, [selected.id]: e.target.value }))} placeholder="Type your reply. The customer gets a push notification." />
              <div className="flex justify-end">
                <Button variant="primary" disabled={!!savingId || !(replies[selected.id] ?? '').trim()} loading={savingId === selected.id} onClick={() => sendReply(selected)}>Send reply</Button>
              </div>
            </section>

            <div>
              <p className="mb-2 text-xs text-fg-muted">Status</p>
              <SegmentedControl ariaLabel="Ticket status" value={selected.status} onChange={s => { if (s !== selected.status && !savingId) updateStatus(selected, s); }} options={STATUSES.map(s => ({ value: s, label: s }))} />
            </div>
          </div>
        )}
      </Drawer>

      <CannedRepliesModal open={cannedOpen} onClose={() => setCannedOpen(false)} replies={canned} onSaved={setCanned} />
    </div>
  );
}

/** Edit the canned replies support can insert (GET / PUT /api/tickets/admin/canned-replies). */
function CannedRepliesModal({ open, onClose, replies, onSaved }: { open: boolean; onClose: () => void; replies: CannedReply[]; onSaved: (r: CannedReply[]) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<CannedReply[]>(replies);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setDraft(replies); setError(null); } }, [open, replies]);
  const set = (i: number, patch: Partial<CannedReply>) => setDraft(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/tickets/admin/canned-replies`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replies: draft }) });
      if (!res.ok) throw new Error(await readError(res, 'Could not save the canned replies.'));
      const data = await res.json();
      onSaved(Array.isArray(data?.replies) ? data.replies : draft);
      toast.success('Canned replies saved.');
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not save the canned replies.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!saving}
      size="lg"
      title="Canned replies"
      description="Ready-made answers support can insert into a reply. Shared by every admin."
      footer={<><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save replies</Button></>}
    >
      <div className="space-y-3">
        {error && <NoticeBox tone="danger"><span className="text-fg">{error}</span></NoticeBox>}
        {draft.length === 0 && <p className="text-sm text-fg-muted">No canned replies yet.</p>}
        {draft.map((r, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-line p-3">
            <div className="flex items-end gap-2">
              <Field label="Title" className="flex-1"><Input value={r.title} maxLength={60} onChange={e => set(i, { title: e.target.value })} /></Field>
              <IconButton label={`Remove ${r.title || 'reply'}`} onClick={() => setDraft(prev => prev.filter((_, j) => j !== i))} className="mb-0.5 hover:text-danger-text"><IconTrash size={14} /></IconButton>
            </div>
            <Field label="Text"><Textarea rows={2} maxLength={1000} value={r.text} onChange={e => set(i, { text: e.target.value })} /></Field>
          </div>
        ))}
        <Button leftIcon={<IconPlus size={14} />} disabled={draft.length >= 30} onClick={() => setDraft(prev => [...prev, { title: '', text: '' }])}>Add reply</Button>
      </div>
    </Modal>
  );
}
