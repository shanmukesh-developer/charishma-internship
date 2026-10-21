"use client";

import {
  Badge, Button, DataTable, Field, Input, Modal, Notice as NoticeBox, PageHeader, SearchInput, SegmentedControl, Select, StatusPill, Toolbar, useConfirm,
  type Column, IconPlus,
} from '@/components/ui';
import { formatDateTime, formatINR, formatPhone, humanize } from '@/lib/format';
import React, { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { useLiveSync } from '@/lib/useLiveSync';

interface User {
  id: string;
  _id: string;
  name: string;
  phone: string;
  role?: string;
}

interface Coupon {
  id: string;
  _id: string;
  code: string;
  type: 'FREEDEL' | 'DISCOUNT';
  value: number;
  userId: string;
  isUsed: boolean;
  expiryDate: string | null;
  createdAt: string;
  user?: { id: string; name: string; phone: string } | null;
}

type Filter = 'all' | 'active' | 'used' | 'expired';
type Notice = { kind: 'success' | 'error'; text: string } | null;

const CODE_PATTERN = /^[A-Z0-9-]{4,20}$/;
const MAX_DISCOUNT = 5000;
const USER_FETCH_LIMIT = 500;

/** fetch + JSON with friendly errors (never shows raw server internals). */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = res.status < 500 && body && typeof body.message === 'string' ? body.message : null;
    throw new Error(msg || (res.status >= 500 ? 'The server ran into a problem. Please try again.' : `Request failed (${res.status}).`));
  }
  return body as T;
}

/** YYYY-MM-DD in the browser's local time zone (toISOString would give the UTC date). */
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFromToday = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return localDate(d); };

const couponState = (c: Coupon): Exclude<Filter, 'all'> => {
  if (c.isUsed) return 'used';
  if (c.expiryDate && new Date(c.expiryDate) < new Date()) return 'expired';
  return 'active';
};

const randomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  return `ZV-${Array.from(bytes, b => chars[b % chars.length]).join('')}`;
};

export default function CouponManagement() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // ?new=1 (header New > Coupon) opens the create form.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setShowCreateModal(true);
  }, []);
  const showCreateModalRef = useRef(false);
  showCreateModalRef.current = showCreateModal;
  const [filter, setFilter] = useState<Filter>('all');
  const [listSearch, setListSearch] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  // Form state
  const [code, setCode] = useState('');
  const [type, setType] = useState<'FREEDEL' | 'DISCOUNT'>('FREEDEL');
  const [value, setValue] = useState<number | ''>('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    try {
      const data = await requestJson<Coupon[]>(`${API_URL}/api/admin/coupons`);
      setCoupons(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load coupons.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await requestJson<{ users?: User[] }>(`${API_URL}/api/admin/users?limit=${USER_FETCH_LIMIT}`);
      setUsers(Array.isArray(data.users) ? data.users : []);
      setUsersError(null);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Could not load customers.');
    }
  }, []);

  useEffect(() => {
    if (isAuthed) fetchCoupons();
  }, [isAuthed, fetchCoupons]);

  // The customer list (up to 500 users) is only needed by the "New coupon" form: load it when the
  // form opens instead of on every visit to this page.
  const usersLoaded = useRef(false);
  useEffect(() => {
    if (isAuthed && showCreateModal && !usersLoaded.current) {
      usersLoaded.current = true;
      fetchUsers();
    }
  }, [isAuthed, showCreateModal, fetchUsers]);

  // Realtime sync: coupon changes (Vault coupons have their own page). User changes only matter
  // while the form's customer list is loaded and open (each user event used to refetch 500 users).
  useLiveSync(['coupon', 'user'], (events, { reconnect }) => {
    if (reconnect || events.some(e => e.type === 'coupon' && e.scope !== 'vault')) fetchCoupons();
    if (showCreateModalRef.current && (reconnect || events.some(e => e.type === 'user'))) fetchUsers();
    else if (events.some(e => e.type === 'user')) usersLoaded.current = false; // reload next time the form opens
  }, { enabled: isAuthed, debounceMs: 1000 });

  // Older accounts are found with a server-side search (name, phone or email) and merged in.
  useEffect(() => {
    const q = userSearch.trim();
    if (!isAuthed || selectedUserId || q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await requestJson<{ users?: User[] }>(`${API_URL}/api/admin/users?limit=20&search=${encodeURIComponent(q)}`);
        if (cancelled || !Array.isArray(data.users)) return;
        setUsers(prev => {
          const known = new Set(prev.map(u => u._id || u.id));
          const extra = data.users!.filter(u => !known.has(u._id || u.id));
          return extra.length ? [...prev, ...extra] : prev;
        });
      } catch {
        /* the local list still works */
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isAuthed, userSearch, selectedUserId]);

  const resetForm = () => {
    setCode('');
    setType('FREEDEL');
    setValue('');
    setSelectedUserId('');
    setExpiryDate('');
    setUserSearch('');
    setErrorMsg('');
  };

  const openCreate = () => {
    resetForm();
    setCode(randomCode());
    setExpiryDate(daysFromToday(7));
    setShowCreateModal(true);
  };

  const closeCreate = () => {
    if (submitLoading) return;
    setShowCreateModal(false);
    setErrorMsg('');
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    setErrorMsg('');

    const cleanCode = code.toUpperCase().trim();
    if (!CODE_PATTERN.test(cleanCode)) {
      setErrorMsg('Code must be 4–20 characters: letters, numbers or hyphens.');
      return;
    }
    if (!selectedUserId) {
      setErrorMsg('Pick the customer this coupon is for.');
      return;
    }
    if (type === 'DISCOUNT') {
      const v = Number(value);
      if (!Number.isInteger(v) || v < 1 || v > MAX_DISCOUNT) {
        setErrorMsg(`Discount must be a whole number of rupees between 1 and ${MAX_DISCOUNT}.`);
        return;
      }
    }
    if (!expiryDate) {
      setErrorMsg('Pick an expiry date.');
      return;
    }
    // Valid until the end of the chosen day (local time).
    const expiry = new Date(`${expiryDate}T23:59:59`);
    if (Number.isNaN(expiry.getTime()) || expiry < new Date()) {
      setErrorMsg('Expiry date must be today or later.');
      return;
    }

    inFlight.current = true;
    setSubmitLoading(true);
    try {
      const created = await requestJson<Coupon>(`${API_URL}/api/admin/coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: cleanCode,
          type,
          value: type === 'DISCOUNT' ? Number(value) : 0,
          userId: selectedUserId,
          expiryDate: expiry.toISOString(),
        }),
      });
      setNotice({ kind: 'success', text: `Coupon ${created?.code || cleanCode} created for ${userSearch}.` });
      setShowCreateModal(false);
      resetForm();
      fetchCoupons();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not create the coupon.');
    } finally {
      inFlight.current = false;
      setSubmitLoading(false);
    }
  };

  const handleDeleteCoupon = async (coupon: Coupon) => {
    if (inFlight.current) return;
    const owner = coupon.user?.name ? ` from ${coupon.user.name}` : '';
    if (!(await confirm({ title: `Revoke coupon ${coupon.code}${owner}?`, description: 'The customer will no longer be able to use it. This cannot be undone.', confirmLabel: 'Revoke coupon', tone: 'danger' }))) return;
    const id = coupon.id || coupon._id;
    inFlight.current = true;
    setRevokingId(id);
    try {
      await requestJson(`${API_URL}/api/admin/coupons/${id}`, { method: 'DELETE' });
      setCoupons(prev => prev.filter(c => (c.id || c._id) !== id));
      setNotice({ kind: 'success', text: `Coupon ${coupon.code} revoked.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not revoke the coupon.' });
    } finally {
      inFlight.current = false;
      setRevokingId(null);
    }
  };

  const term = userSearch.trim().toLowerCase();
  const filteredUsers = useMemo(() => (term
    ? users.filter(u => u.name?.toLowerCase().includes(term) || u.phone?.toLowerCase().includes(term))
    : []), [users, term]);

  // Deferred so typing stays responsive while the (possibly long) table filters behind it.
  const listTerm = useDeferredValue(listSearch.trim().toLowerCase());
  const visibleCouponsAll = useMemo(() => coupons.filter(c =>
    (filter === 'all' || couponState(c) === filter) &&
    (!listTerm || c.code.toLowerCase().includes(listTerm) || c.user?.name?.toLowerCase().includes(listTerm) || c.user?.phone?.includes(listTerm))
  ), [coupons, filter, listTerm]);
  const counts = useMemo(
    () => coupons.reduce((acc, c) => { acc[couponState(c)]++; return acc; }, { active: 0, used: 0, expired: 0 }),
    [coupons],
  );

  if (!isAuthed) return null; // AppShell shows the session check

  const stateTone = { active: 'success', used: 'neutral', expired: 'danger' } as const;
  const columns: Column<Coupon>[] = [
    { key: 'code', header: 'Code', sortValue: c => c.code, cell: c => <span className="font-mono text-sm font-medium text-fg">{c.code}</span> },
    { key: 'type', header: 'Benefit', sortValue: c => (c.type === 'FREEDEL' ? 0 : Number(c.value) || 0), cell: c => <Badge tone={c.type === 'FREEDEL' ? 'info' : 'success'}>{c.type === 'FREEDEL' ? 'Free delivery' : `${formatINR(c.value)} off`}</Badge> },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: c => c.user?.name || '',
      cell: c => (c.user ? (
        <div className="min-w-0">
          <p className="truncate text-fg">{c.user.name}</p>
          <p className="truncate text-xs text-fg-muted">{formatPhone(c.user.phone)}</p>
        </div>
      ) : <span className="text-xs text-fg-muted">Deleted account</span>),
    },
    { key: 'expiry', header: 'Expires', sortValue: c => (c.expiryDate ? new Date(c.expiryDate) : null), cell: c => <span className="whitespace-nowrap text-fg-muted">{c.expiryDate ? formatDateTime(c.expiryDate, { short: true }) : 'No expiry'}</span> },
    { key: 'created', header: 'Created', hideBelow: 'xl', sortValue: c => new Date(c.createdAt), cell: c => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(c.createdAt, { short: true })}</span> },
    { key: 'status', header: 'Status', sortValue: c => couponState(c), cell: c => { const s = couponState(c); return <StatusPill status={s} tone={stateTone[s]} label={humanize(s)} />; } },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: c => (couponState(c) !== 'used' ? (
        <Button size="sm" variant="ghost" className="text-danger-text" disabled={revokingId !== null} loading={revokingId === (c.id || c._id)} onClick={() => handleDeleteCoupon(c)}>Revoke</Button>
      ) : null),
    },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Coupons"
        description="One-off codes given to a single customer: free delivery or a flat rupee discount. Daily deals have their own page."
        actions={<Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openCreate}>New coupon</Button>}
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{visibleCouponsAll.length} of {coupons.length} coupons</span>}>
        <SearchInput value={listSearch} onChange={setListSearch} placeholder="Code, customer or phone" className="sm:w-72" />
        <SegmentedControl<Filter>
          ariaLabel="Coupon status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: coupons.length },
            { value: 'active', label: 'Active', count: counts.active },
            { value: 'used', label: 'Used', count: counts.used },
            { value: 'expired', label: 'Expired', count: counts.expired },
          ]}
        />
      </Toolbar>

      {notice && <NoticeBox tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-3" onClose={() => setNotice(null)}>{notice.text}</NoticeBox>}

      <DataTable
        caption="Coupons"
        columns={columns}
        rows={visibleCouponsAll}
        rowKey={c => c.id || c._id}
        loading={loading && coupons.length === 0}
        error={loadError}
        onRetry={fetchCoupons}
        pageSize={50}
        noun="coupons"
        resetPageKey={`${filter}|${listTerm}`}
        initialSort={{ key: 'created', dir: 'desc' }}
        empty={coupons.length === 0
          ? { title: 'No coupons yet', description: 'Create one with New coupon.', action: <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openCreate}>New coupon</Button> }
          : { title: 'No coupons match', description: 'Try a different filter or search.' }}
      />

      <Modal
        open={showCreateModal}
        onClose={closeCreate}
        dismissible={!submitLoading}
        size="md"
        title="New coupon"
        description="The code works only for the customer you pick, once, until the end of the expiry day."
        footer={(
          <>
            <Button onClick={closeCreate} disabled={submitLoading}>Cancel</Button>
            <Button variant="primary" type="submit" form="new-coupon-form" loading={submitLoading}>Create coupon</Button>
          </>
        )}
      >
        <form id="new-coupon-form" onSubmit={handleCreateCoupon} className="space-y-4">
          {errorMsg && <NoticeBox tone="danger">{errorMsg}</NoticeBox>}

          <Field
            label="Customer"
            error={usersError ? <>{usersError} <button type="button" onClick={fetchUsers} className="underline">Retry</button></> : undefined}
            hint={selectedUserId ? <span className="text-success-text">Selected: {userSearch}</span> : 'Search by name or phone.'}
          >
            <div className="relative">
              <Input
                type="text"
                placeholder="Search by name or phone"
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  setSelectedUserId('');
                }}
              />
              {term && !selectedUserId && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
                  {filteredUsers.length === 0 ? (
                    <div className="p-3 text-center text-sm text-fg-muted">No customers match.</div>
                  ) : (
                    filteredUsers.slice(0, 8).map((u) => (
                      <button
                        key={u.id || u._id}
                        type="button"
                        onClick={() => {
                          setSelectedUserId(u.id || u._id);
                          setUserSearch(`${u.name} (${u.phone})`);
                        }}
                        className="flex w-full items-center justify-between border-b border-line px-3 py-2 text-left text-sm text-fg last:border-0 hover:bg-surface-2"
                      >
                        <span className="font-medium">{u.name}</span>
                        <span className="text-xs text-fg-muted">{formatPhone(u.phone)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </Field>

          <Field label="Code" hint="4–20 letters, numbers or hyphens.">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="e.g. FLAT100"
                maxLength={20}
                className="flex-1 font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
              />
              <Button onClick={() => setCode(randomCode())}>Generate</Button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" className={type === 'FREEDEL' ? 'col-span-2' : ''}>
              <Select value={type} onChange={(e) => setType(e.target.value as 'FREEDEL' | 'DISCOUNT')}>
                <option value="FREEDEL">Free delivery</option>
                <option value="DISCOUNT">Flat ₹ off</option>
              </Select>
            </Field>
            {type === 'DISCOUNT' && (
              <Field label="Discount" hint="Capped at the order’s item total.">
                <Input
                  type="number"
                  prefix="₹"
                  min={1}
                  max={MAX_DISCOUNT}
                  step={1}
                  placeholder="50"
                  value={value}
                  onChange={(e) => setValue(e.target.value ? Number(e.target.value) : '')}
                />
              </Field>
            )}
          </div>

          <Field
            label="Valid until (end of day)"
            labelAction={(
              <div className="flex gap-1">
                {[1, 3, 7, 30].map(days => (
                  <button key={days} type="button" onClick={() => setExpiryDate(daysFromToday(days))} className="rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">
                    +{days}d
                  </button>
                ))}
              </div>
            )}
          >
            <Input type="date" min={daysFromToday(0)} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
