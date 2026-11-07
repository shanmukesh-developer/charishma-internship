"use client";
// Promoters (owner, 5 Nov 2026): people who share a ZENV promo link or code and are paid Rs 100 for every 200
// verified downloads. A verified download = a NEW customer account created with a verified phone number on a
// phone that installed from the promoter's Play link, or that typed the promoter's code at sign-up (one credit per
// account / device / number, never both). Backend: routes/promoRoutes.js (/api/admin/promoters), rules in
// utils/promoAttribution.js.
import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '@/lib/api';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { formatDateTime, formatYmd } from '@/lib/format';
import {
  Badge, Button, DataTable, Field, Input, Modal, Notice, PageHeader, Switch,
  type Column, IconPlus, IconRefresh,
} from '@/components/ui';

interface Promoter {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  upiId: string | null;
  active: boolean;
  clicks: number;
  createdAt: string;
  link: string;
  shortLink: string;
  installs: number;
  viaLink: number;
  viaCode: number;
  verified: number;
  payableCount: number;
  earned: number;
  paid: number;
  due: number;
}
interface Payout { id: string; amount: number; paidAt: string; note: string | null }

const CODE_RE = /^[A-Z0-9]{4,16}$/;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const rupees = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
// Today in IST (the browser's own time zone gave the wrong day for an admin outside India).
const todayInput = () => formatYmd(new Date());

function AddPromoterModal({ onClose, onSaved }: { onClose: () => void; onSaved: (p: Promoter) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [upiId, setUpiId] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const codeClean = code.trim().toUpperCase();
  const codeError = codeClean && !CODE_RE.test(codeClean) ? '4-16 letters or digits (A-Z, 0-9), no spaces.' : '';

  const save = async () => {
    if (name.trim().length < 2) { setError('Enter the promoter\'s name.'); return; }
    if (codeError) { setError(codeError); return; }
    setSaving(true);
    setError('');
    try {
      const p = await adminRequest<Promoter>('/api/admin/promoters', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), upiId: upiId.trim(), ...(codeClean ? { code: codeClean } : {}) }),
      });
      onSaved(p);
    } catch (e) {
      setError(errText(e, 'Could not add the promoter.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add promoter"
      description="They get a Play Store link and a code. Every 200 verified downloads earn them ₹100."
      footer={(
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>Add promoter</Button>
        </>
      )}
    >
      <div className="grid gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Name" required>
          <Input maxLength={80} placeholder="Ravi Kumar" value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Phone" optional>
            <Input inputMode="tel" maxLength={16} placeholder="98765 43210" value={phone} onChange={e => setPhone(e.target.value)} />
          </Field>
          <Field label="UPI ID" optional hint="Where you send the money.">
            <Input maxLength={80} placeholder="ravi@okaxis" value={upiId} onChange={e => setUpiId(e.target.value)} />
          </Field>
        </div>
        <Field label="Code" optional error={codeError || undefined} hint="Leave empty for an automatic 6-character code, or type one like RAVI10. It cannot be changed later.">
          <Input maxLength={16} className="font-mono uppercase" placeholder="Automatic" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} />
        </Field>
      </div>
    </Modal>
  );
}

function PayModal({ promoter, onClose, onPaid }: { promoter: Promoter; onClose: () => void; onPaid: (p: Promoter) => void }) {
  const [amount, setAmount] = useState(String(promoter.due));
  const [paidAt, setPaidAt] = useState(todayInput());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Payout[] | null>(null);

  useEffect(() => {
    adminRequest<{ payouts: Payout[] }>(`/api/admin/promoters/${promoter.id}/payouts`)
      .then(r => setHistory(Array.isArray(r?.payouts) ? r.payouts : []))
      .catch(() => setHistory([]));
  }, [promoter.id]);

  const save = async () => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) { setError('Enter the amount paid in whole rupees.'); return; }
    if (n > promoter.due) { setError(`Only ${rupees(promoter.due)} is due.`); return; }
    setSaving(true);
    setError('');
    try {
      const r = await adminRequest<{ promoter: Promoter }>(`/api/admin/promoters/${promoter.id}/payouts`, {
        method: 'POST',
        body: JSON.stringify({ amount: n, paidAt: paidAt ? new Date(`${paidAt}T12:00:00+05:30`).toISOString() : undefined, note: note.trim() }),
      });
      onPaid(r.promoter);
    } catch (e) {
      setError(errText(e, 'Could not record the payment.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Mark paid: ${promoter.name}`}
      description={`Earned ${rupees(promoter.earned)} for ${promoter.verified} verified downloads, paid ${rupees(promoter.paid)}, due ${rupees(promoter.due)}. Send the money first (UPI ${promoter.upiId || 'not given'}), then record it here.`}
      footer={(
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={promoter.due <= 0} onClick={save}>Record payment</Button>
        </>
      )}
    >
      <div className="grid gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {promoter.due <= 0 && <Notice tone="info">Nothing is due right now.</Notice>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Amount (₹)" required>
            <Input type="number" min={1} max={promoter.due} step={1} value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
          <Field label="Paid on" required>
            <Input type="date" max={todayInput()} value={paidAt} onChange={e => setPaidAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" optional hint="For example the UPI reference number.">
          <Input maxLength={200} placeholder="UPI ref 123456789012" value={note} onChange={e => setNote(e.target.value)} />
        </Field>
        <div>
          <p className="mb-1 text-xs font-semibold text-fg-muted">Earlier payments</p>
          {history === null ? <p className="text-xs text-fg-subtle">Loading…</p> : history.length === 0 ? <p className="text-xs text-fg-subtle">None yet.</p> : (
            <ul className="divide-y divide-line rounded-md border border-line text-sm">
              {history.map(h => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="tabular-nums font-medium text-fg">{rupees(h.amount)}</span>
                  <span className="truncate text-xs text-fg-muted">{h.note || ''}</span>
                  <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(h.paidAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function PromotersPage() {
  const { isAuthed } = useAdminAuth();
  const [rows, setRows] = useState<Promoter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Promoter | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminRequest<{ promoters: Promoter[] }>('/api/admin/promoters');
      setRows(Array.isArray(data?.promoters) ? data.promoters : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e, 'Could not load promoters.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (isAuthed) load(); }, [isAuthed, load]);

  const replace = (p: Promoter) => setRows(prev => prev.map(x => (x.id === p.id ? p : x)));
  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => setNotice({ kind: 'success', text: `${what} copied.` }))
      .catch(() => setNotice({ kind: 'error', text: 'Could not copy. Select the text and copy it by hand.' }));
  };
  const toggle = async (p: Promoter, active: boolean) => {
    if (busyId) return;
    setBusyId(p.id);
    setNotice(null);
    try {
      replace(await adminRequest<Promoter>(`/api/admin/promoters/${p.id}`, { method: 'PATCH', body: JSON.stringify({ active }) }));
      setNotice({ kind: 'success', text: active ? `${p.name}'s link and code count again.` : `${p.name} deactivated: new downloads from the link or code no longer count.` });
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not update the promoter.') });
    } finally {
      setBusyId(null);
    }
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const totals = rows.reduce((t, p) => ({ verified: t.verified + p.verified, earned: t.earned + p.earned, paid: t.paid + p.paid, due: t.due + p.due }), { verified: 0, earned: 0, paid: 0, due: 0 });

  const columns: Column<Promoter>[] = [
    {
      key: 'name', header: 'Promoter', sortValue: p => p.name,
      cell: p => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{p.name}</p>
          <p className="truncate text-xs text-fg-muted">{[p.phone, p.upiId].filter(Boolean).join(' · ') || 'No phone or UPI'}</p>
        </div>
      ),
    },
    {
      key: 'code', header: 'Code and links', sortValue: p => p.code,
      cell: p => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge>{p.code}</Badge>
          <Button size="sm" variant="ghost" onClick={() => copy(p.link, 'Play Store link')}>Copy link</Button>
          <Button size="sm" variant="ghost" onClick={() => copy(p.shortLink, 'Short link')}>Copy short link</Button>
        </div>
      ),
    },
    { key: 'clicks', header: 'Clicks', align: 'right', hideBelow: 'lg', sortValue: p => p.clicks, cell: p => <span className="tabular-nums text-fg-muted">{p.clicks}</span> },
    {
      key: 'verified', header: 'Verified downloads', align: 'right', sortValue: p => p.verified,
      cell: p => (
        <div className="text-right">
          <p className="tabular-nums font-semibold text-fg">{p.verified}</p>
          <p className="whitespace-nowrap text-xs text-fg-muted">{p.viaLink} link · {p.viaCode} code</p>
        </div>
      ),
    },
    { key: 'earned', header: 'Earned', align: 'right', sortValue: p => p.earned, cell: p => <span className="tabular-nums text-fg">{rupees(p.earned)}</span> },
    { key: 'paid', header: 'Paid', align: 'right', sortValue: p => p.paid, cell: p => <span className="tabular-nums text-fg-muted">{rupees(p.paid)}</span> },
    { key: 'due', header: 'Due', align: 'right', sortValue: p => p.due, cell: p => <span className={`tabular-nums font-semibold ${p.due > 0 ? 'text-warning-text' : 'text-fg-muted'}`}>{rupees(p.due)}</span> },
    {
      key: 'active', header: 'Active', sortValue: p => p.active,
      cell: p => <Switch size="sm" checked={p.active} disabled={busyId !== null} onChange={v => toggle(p, v)} label={<span className="sr-only">{p.active ? 'Deactivate' : 'Activate'}</span>} />,
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: p => <Button size="sm" variant={p.due > 0 ? 'primary' : 'ghost'} disabled={p.due <= 0 || busyId !== null} onClick={() => { setNotice(null); setPaying(p); }}>Mark paid</Button>,
    },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Promoters"
        description="People who share a ZENV link or code. ₹100 for every 200 verified downloads (a new account created with a verified number on the phone that installed from their link, or that typed their code at sign-up)."
        actions={(
          <>
            <Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={load}>Refresh</Button>
            <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={() => { setNotice(null); setAdding(true); }}>Add promoter</Button>
          </>
        )}
      />

      <section className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Totals">
        {[['Verified downloads', String(totals.verified)], ['Earned', rupees(totals.earned)], ['Paid', rupees(totals.paid)], ['Due', rupees(totals.due)]].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-surface p-3">
            <p className="text-xs text-fg-muted">{label}</p>
            <p className="text-lg font-semibold tabular-nums text-fg">{value}</p>
          </div>
        ))}
      </section>

      {notice && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-3" onClose={() => setNotice(null)}>{notice.text}</Notice>}

      <DataTable
        caption="Promoters"
        columns={columns}
        rows={rows}
        rowKey={p => p.id}
        loading={loading && rows.length === 0}
        error={loadError}
        onRetry={load}
        pageSize={50}
        noun="promoters"
        initialSort={{ key: 'due', dir: 'desc' }}
        empty={{ title: 'No promoters yet', description: 'Add one to get their Play Store link and code.', action: <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={() => setAdding(true)}>Add promoter</Button> }}
      />

      <p className="mt-3 text-xs text-fg-subtle">
        Links only count installs from the Play Store on Android, and only once the app is public on Play (closed-test installs work for testers only). Codes typed at sign-up work everywhere.
      </p>

      {adding && (
        <AddPromoterModal
          onClose={() => setAdding(false)}
          onSaved={p => { setAdding(false); setRows(prev => [p, ...prev]); setNotice({ kind: 'success', text: `${p.name} added with code ${p.code}.` }); }}
        />
      )}
      {paying && (
        <PayModal
          promoter={paying}
          onClose={() => setPaying(null)}
          onPaid={p => { setPaying(null); replace(p); setNotice({ kind: 'success', text: `Payment recorded. ${p.name}: due ${rupees(p.due)}.` }); }}
        />
      )}
    </div>
  );
}
