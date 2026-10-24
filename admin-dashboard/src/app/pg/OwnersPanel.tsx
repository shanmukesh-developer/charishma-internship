"use client";
// PG owner accounts for the ZCS PG Partner app ("Plan B", no SMS): the admin creates the account with a
// temporary password and links it to the owner's PG listing(s). The owner signs in with phone + password and
// must set an own password first. Backend: /api/admin/pg-owners (every write audited).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Checkbox, DataTable, Field, Input, Menu, Modal, Notice, SearchInput, Select, Toolbar, useConfirm, usePrompt, type Column,
  IconMore, IconPlus, IconRefresh,
} from '@/components/ui';
import { PGHostel, pgRequest, formatDate } from './pgApi';

export interface PgOwnerListing { id: string; name: string; area?: string | null; isActive: boolean }
export interface PgOwnerRow {
  id: string;
  name: string;
  phone: string | null;
  phoneLast4: string;
  email: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedReason: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  deletionRequestedAt: string | null;
  deletionReason: string | null;
  createdAt: string | null;
  listings: PgOwnerListing[];
}
interface LinkRow { hostelId: string; ownerId: string; ownerName: string | null }

const PHONE_RE = /^[6-9]\d{9}$/;
const passwordOk = (p: string) => p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** 10 characters, letters + digits, no look-alikes (0/O, 1/l/I). */
function makeTempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  const out = Array.from(buf, (n) => all[n % all.length]);
  out[0] = letters[buf[0] % letters.length];
  out[9] = digits[buf[9] % digits.length];
  return out.join('');
}

/** Checkbox list of PG listings; ones linked to another owner are disabled. */
function ListingPicker({ pgs, links, selected, onChange, ownerId }: {
  pgs: PGHostel[]; links: LinkRow[]; selected: string[]; onChange: (ids: string[]) => void; ownerId?: string;
}) {
  const [q, setQ] = useState('');
  const takenBy = useMemo(() => new Map(links.map((l) => [l.hostelId, l])), [links]);
  const shown = pgs.filter((p) => !q.trim() || `${p.name} ${p.area || ''} ${p.address}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-2">
      <SearchInput value={q} onChange={setQ} placeholder="Search PG listings" ariaLabel="Search PG listings" />
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
        {shown.length === 0 && <p className="p-2 text-sm text-fg-muted">No PG listings match.</p>}
        {shown.map((p) => {
          const link = takenBy.get(p.id);
          const mine = !!link && link.ownerId === ownerId;
          const other = !!link && !mine;
          return (
            <div key={p.id} className="rounded-md px-2 py-1.5 hover:bg-surface-2">
              <Checkbox
                checked={mine || selected.includes(p.id)}
                disabled={other || mine}
                onChange={(e) => onChange(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))}
                label={<span className="text-sm text-fg">{p.name}{!p.isActive && <span className="ml-1 text-xs text-fg-subtle">(hidden)</span>}</span>}
                description={other ? `Linked to ${link?.ownerName || 'another owner'}` : mine ? 'Already linked to this owner' : p.address}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" spellCheck={false} className="font-mono" />
      <Button onClick={() => onChange(makeTempPassword())}>Generate</Button>
    </div>
  );
}

export function OwnersPanel({ pgs }: { pgs: PGHostel[] }) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [owners, setOwners] = useState<PgOwnerRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Create
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '' });
  const [formPgs, setFormPgs] = useState<string[]>([]);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  // Link / reset
  const [linking, setLinking] = useState<PgOwnerRow | null>(null);
  const [linkPgs, setLinkPgs] = useState<string[]>([]);
  const [resetting, setResetting] = useState<PgOwnerRow | null>(null);
  const [resetPw, setResetPw] = useState('');
  // Shown once after create / reset so the admin can share it with the owner.
  const [shared, setShared] = useState<{ name: string; phone: string; password: string } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (status) qs.set('status', status);
      const [list, l] = await Promise.all([
        pgRequest<{ owners: PgOwnerRow[] }>(`/api/admin/pg-owners${qs.toString() ? `?${qs}` : ''}`),
        pgRequest<{ links: LinkRow[] }>('/api/admin/pg-owners/links'),
      ]);
      setOwners(Array.isArray(list?.owners) ? list.owners : []);
      setLinks(Array.isArray(l?.links) ? l.links : []);
      setError('');
    } catch (e) {
      if (!quiet) setError(errText(e, 'Could not load PG owner accounts.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [q, status]);
  useEffect(() => { const t = setTimeout(() => load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const openCreate = () => {
    setForm({ name: '', phone: '', email: '', password: makeTempPassword() });
    setFormPgs([]);
    setFormErr('');
    setCreating(true);
  };
  const digits = form.phone.replace(/\D/g, '').slice(-10);
  const createOk = form.name.trim().length >= 2 && PHONE_RE.test(digits) && passwordOk(form.password);
  const submitCreate = async () => {
    if (!createOk || saving) return;
    setSaving(true);
    setFormErr('');
    try {
      const res = await pgRequest<{ owner: PgOwnerRow; message: string }>('/api/admin/pg-owners', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.trim(), phone: digits, email: form.email.trim() || undefined, password: form.password, hostelIds: formPgs }),
      });
      setCreating(false);
      setShared({ name: res.owner.name, phone: digits, password: form.password });
      setNotice({ kind: 'ok', text: res.message });
      await load(true);
    } catch (e) {
      setFormErr(errText(e, 'Could not create the account.'));
    } finally {
      setSaving(false);
    }
  };

  const act = async (o: PgOwnerRow, fn: () => Promise<{ message?: string } | unknown>, ok: string) => {
    setBusy((b) => ({ ...b, [o.id]: true }));
    setNotice(null);
    try {
      const res = (await fn()) as { message?: string } | undefined;
      setNotice({ kind: 'ok', text: (res && res.message) || ok });
      await load(true);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'That did not work. Please try again.') });
    } finally {
      setBusy((b) => ({ ...b, [o.id]: false }));
    }
  };

  const submitLink = async () => {
    if (!linking || !linkPgs.length) return;
    const o = linking;
    setLinking(null);
    await act(o, () => pgRequest(`/api/admin/pg-owners/${o.id}/listings`, { method: 'POST', body: JSON.stringify({ hostelIds: linkPgs }) }), 'PG linked.');
  };
  const unlink = async (o: PgOwnerRow, l: PgOwnerListing) => {
    if (!(await confirm({ title: `Unlink ${l.name}?`, description: `${o.name} will no longer see its booking requests, tenants or settings in the app.`, confirmLabel: 'Unlink', tone: 'danger' }))) return;
    setLinking(null);
    await act(o, () => pgRequest(`/api/admin/pg-owners/${o.id}/listings/${l.id}`, { method: 'DELETE' }), `${l.name} unlinked.`);
  };
  const submitReset = async () => {
    if (!resetting || !passwordOk(resetPw)) return;
    const o = resetting;
    const pw = resetPw;
    setResetting(null);
    await act(o, async () => {
      const res = await pgRequest<{ message: string }>(`/api/admin/pg-owners/${o.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: pw }) });
      setShared({ name: o.name, phone: o.phone || `•••• ${o.phoneLast4}`, password: pw });
      return res;
    }, 'Temporary password set.');
  };
  const suspend = async (o: PgOwnerRow) => {
    const reason = await prompt({ title: `Suspend ${o.name}?`, description: 'They are signed out at once and cannot sign in until you reactivate the account. The PG listing stays as it is.', label: 'Reason the owner will see', minLength: 5, maxLength: 300, confirmLabel: 'Suspend', tone: 'danger' });
    if (reason === null) return;
    await act(o, () => pgRequest(`/api/admin/pg-owners/${o.id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) }), 'Suspended.');
  };
  const unsuspend = (o: PgOwnerRow) => act(o, () => pgRequest(`/api/admin/pg-owners/${o.id}/unsuspend`, { method: 'POST', body: '{}' }), 'Reactivated.');

  const columns: Column<PgOwnerRow>[] = [
    {
      key: 'name',
      header: 'Owner',
      sortValue: (o) => o.name,
      cell: (o) => (
        <div className="min-w-[180px]">
          <p className="font-medium text-fg">{o.name}</p>
          <p className="text-xs text-fg-muted">{o.phone || `•••• ${o.phoneLast4}`}{o.email ? ` · ${o.email}` : ''}</p>
        </div>
      ),
    },
    {
      key: 'pgs',
      header: 'PG listings',
      cell: (o) => (o.listings.length ? (
        <div className="flex max-w-[320px] flex-wrap gap-1">{o.listings.map((l) => <Badge key={l.id} tone={l.isActive ? 'accent' : 'neutral'}>{l.name}</Badge>)}</div>
      ) : <Badge tone="warning">No PG linked</Badge>),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (o) => (o.status === 'SUSPENDED' ? 1 : 0),
      cell: (o) => (
        <div className="flex flex-wrap gap-1">
          {o.status === 'SUSPENDED' ? <Badge tone="danger" dot title={o.suspendedReason || undefined}>Suspended</Badge> : <Badge tone="success" dot>Active</Badge>}
          {o.mustChangePassword && <Badge tone="warning">Temporary password</Badge>}
          {o.deletionRequestedAt && <Badge tone="danger" title={o.deletionReason || undefined}>Deletion requested</Badge>}
        </div>
      ),
    },
    { key: 'login', header: 'Last sign-in', hideBelow: 'lg', sortValue: (o) => o.lastLoginAt || '', cell: (o) => <span className="text-fg-muted">{o.lastLoginAt ? formatDate(o.lastLoginAt, true) : 'Never'}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '120px',
      cell: (o) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button size="sm" disabled={!!busy[o.id]} onClick={() => { setLinkPgs([]); setLinking(o); }}>PGs</Button>
          <Menu
            label={`More actions for ${o.name}`}
            trigger={(props) => <Button {...props} size="sm" variant="ghost" aria-label={`More actions for ${o.name}`} className="w-7 px-0"><IconMore size={16} /></Button>}
            items={[
              { label: 'Reset password…', onSelect: () => { setResetPw(makeTempPassword()); setResetting(o); }, disabled: !!busy[o.id] },
              'separator',
              o.status === 'SUSPENDED'
                ? { label: 'Reactivate', onSelect: () => unsuspend(o), disabled: !!busy[o.id] }
                : { label: 'Suspend…', onSelect: () => suspend(o), danger: true, disabled: !!busy[o.id] },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <section className="space-y-4" aria-label="PG owner accounts">
      <Toolbar
        end={(
          <div className="flex items-center gap-2">
            <Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={() => load()}>Refresh</Button>
            <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openCreate}>Add owner</Button>
          </div>
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64"><SearchInput value={q} onChange={setQ} placeholder="Name or phone" ariaLabel="Search owners" /></div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="w-auto">
            <option value="">All accounts</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DELETION">Deletion requested</option>
          </Select>
        </div>
      </Toolbar>
      <p className="text-xs text-fg-muted">
        Owners use the ZCS PG Partner app to accept or decline booking requests, update free beds, the mess menu, rent records and
        complaints for their linked PGs only. They never see students&apos; phone numbers. Verification and listing details stay with you.
      </p>

      {notice && <Notice tone={notice.kind === 'error' ? 'danger' : 'success'} onClose={() => setNotice(null)}><span className="text-fg">{notice.text}</span></Notice>}
      {shared && (
        <Notice tone="info" onClose={() => setShared(null)}>
          <div className="space-y-1 text-fg">
            <p className="font-medium">Share these sign-in details with {shared.name} (shown once):</p>
            <p className="font-mono text-sm">Phone {shared.phone} · Temporary password {shared.password}</p>
            <p className="text-xs text-fg-muted">They must choose their own password the first time they sign in.</p>
          </div>
        </Notice>
      )}

      <DataTable
        caption="PG owner accounts"
        columns={columns}
        rows={owners}
        rowKey={(o) => o.id}
        loading={loading}
        error={error || null}
        onRetry={() => load()}
        noun="owners"
        empty={{ title: 'No PG owner accounts yet', description: 'Create one for each PG owner and link their listing. They sign in to ZCS PG Partner with the phone number and temporary password.', action: <Button variant="primary" onClick={openCreate}>Add owner</Button> }}
      />

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        dismissible={!saving}
        size="lg"
        title="Add PG owner"
        description="Creates the account with a temporary password. No SMS is needed."
        footer={(
          <>
            <Button onClick={() => setCreating(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={submitCreate} loading={saving} disabled={!createOk}>Create account</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></Field>
            <Field label="Mobile number" required hint={form.phone && !PHONE_RE.test(digits) ? 'Enter a 10-digit Indian mobile number.' : '10 digits, without +91'}>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="numeric" maxLength={14} />
            </Field>
          </div>
          <Field label="Email" optional><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" maxLength={120} /></Field>
          <Field label="Temporary password" required hint={form.password && !passwordOk(form.password) ? 'Use 8 to 72 characters with letters and numbers.' : 'The owner must change it at the first sign-in.'}>
            <PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
          </Field>
          <Field label="PG listings" optional hint="You can link more later."><ListingPicker pgs={pgs} links={links} selected={formPgs} onChange={setFormPgs} /></Field>
          {formErr && <Notice tone="danger"><span className="text-fg">{formErr}</span></Notice>}
        </div>
      </Modal>

      <Modal
        open={!!linking}
        onClose={() => setLinking(null)}
        size="lg"
        title={linking ? `PG listings of ${linking.name}` : 'PG listings'}
        description="One owner account per listing. The owner sees only the PGs linked here."
        footer={(
          <>
            <Button onClick={() => setLinking(null)}>Close</Button>
            <Button variant="primary" onClick={submitLink} disabled={!linkPgs.length}>Link {linkPgs.length || ''} selected</Button>
          </>
        )}
      >
        {linking && (
          <div className="space-y-4">
            {linking.listings.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {linking.listings.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm text-fg">{l.name}{!l.isActive && <span className="ml-1 text-xs text-fg-subtle">(hidden)</span>}</span>
                    <Button size="sm" variant="ghost" onClick={() => unlink(linking, l)}>Unlink</Button>
                  </li>
                ))}
              </ul>
            )}
            <ListingPicker pgs={pgs} links={links} selected={linkPgs} onChange={setLinkPgs} ownerId={linking.id} />
          </div>
        )}
      </Modal>

      <Modal
        open={!!resetting}
        onClose={() => setResetting(null)}
        title={resetting ? `Reset password for ${resetting.name}` : 'Reset password'}
        description="Sets a new temporary password and signs the owner out on every phone."
        footer={(
          <>
            <Button onClick={() => setResetting(null)}>Cancel</Button>
            <Button variant="primary" onClick={submitReset} disabled={!passwordOk(resetPw)}>Set temporary password</Button>
          </>
        )}
      >
        <Field label="Temporary password" hint={resetPw && !passwordOk(resetPw) ? 'Use 8 to 72 characters with letters and numbers.' : 'Share it with the owner; they must change it at the next sign-in.'}>
          <PasswordInput value={resetPw} onChange={setResetPw} />
        </Field>
      </Modal>
    </section>
  );
}
