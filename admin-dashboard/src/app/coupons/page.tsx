"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { useLiveSync } from '@/lib/useLiveSync';
import { ListPager, usePagedRows } from '@/components/ListPager';

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
    if (!confirm(`Revoke coupon ${coupon.code}${owner}? The customer will no longer be able to use it. This cannot be undone.`)) return;
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
  // Only 50 rows are rendered at a time.
  const couponPager = usePagedRows(visibleCouponsAll, 50, `${filter}|${listTerm}`);
  const visibleCoupons = couponPager.visible;

  if (!isAuthed) return <div className="p-20 text-center font-semibold text-fg animate-pulse">Checking access…</div>;

  return (
    <div className="space-y-10 animate-fade-in relative">
      <header className="flex flex-wrap gap-6 justify-between items-center bg-surface-2/60 p-8 rounded-lg border border-line bg-surface border border-line">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Coupons</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Discount codes and their usage.</p>
        </div>
        <button
          onClick={openCreate}
          className="px-6 py-3 bg-accent hover:bg-accent-hover text-on-solid rounded-lg text-xs font-semibold transition-all"
        >
          + New coupon
        </button>
      </header>

      {notice && (
        <div className={`p-4 rounded-lg border text-xs font-semibold flex justify-between items-start gap-4 ${notice.kind === 'error' ? 'bg-danger-soft border-danger/30 text-danger-text' : 'bg-success-soft border-success/30 text-success-text'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-fg-muted hover:text-fg" aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2">
          {([
            ['all', `All (${coupons.length})`],
            ['active', `Active (${counts.active})`],
            ['used', `Used (${counts.used})`],
            ['expired', `Expired (${counts.expired})`],
          ] as [Filter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-xl text-xs font-semibold border transition-all ${filter === f ? 'bg-accent text-on-solid border-info/30' : 'bg-surface-2/60 text-fg-muted border-line hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search code or customer…"
          value={listSearch}
          onChange={e => setListSearch(e.target.value)}
          className="bg-surface-2/60 border border-line rounded-xl px-4 py-2 text-xs text-fg outline-none focus:border-accent w-64"
        />
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="py-20 text-center animate-pulse text-fg-muted font-semibold text-xs">Loading coupons…</div>
        ) : loadError ? (
          <div className="py-20 text-center">
            <p className="text-xs text-danger-text font-semibold">{loadError}</p>
            <button onClick={fetchCoupons} className="mt-3 px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:text-fg">Try again</button>
          </div>
        ) : visibleCouponsAll.length === 0 ? (
          <div className="py-20 text-center text-fg-muted text-xs">
            {coupons.length === 0 ? 'No coupons yet. Create one with "New coupon".' : 'No coupons match this filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-2/60 border-b border-line">
                  {['Code', 'Type', 'Customer', 'Expires', 'Status', ''].map(h => (
                    <th key={h} className="px-8 py-5 text-xs font-semibold text-fg-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-fg">
                {visibleCoupons.map((coupon) => {
                  const state = couponState(coupon);
                  const id = coupon.id || coupon._id;
                  return (
                    <tr key={id} className="hover:bg-surface-2/60 transition-all">
                      <td className="px-8 py-5 font-mono text-sm font-semibold text-info-text">{coupon.code}</td>
                      <td className="px-8 py-5">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-md ${coupon.type === 'FREEDEL' ? 'bg-accent-soft text-accent-text border border-accent/30' : 'bg-success-soft text-success-text border border-success/30'}`}>
                          {coupon.type === 'FREEDEL' ? 'Free delivery' : `₹${coupon.value} off`}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        {coupon.user ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-fg">{coupon.user.name}</span>
                            <span className="text-xs text-fg-muted font-mono mt-0.5">{coupon.user.phone}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-fg-muted">Deleted account</span>
                        )}
                      </td>
                      <td className="px-8 py-5 text-xs font-semibold text-fg-muted">
                        {coupon.expiryDate ? new Date(coupon.expiryDate).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'No expiry'}
                      </td>
                      <td className="px-8 py-5">
                        {state === 'used' ? (
                          <span className="px-2 py-0.5 rounded bg-surface-3 text-fg-muted text-xs font-semibold border border-line-strong">Used</span>
                        ) : state === 'expired' ? (
                          <span className="px-2 py-0.5 rounded bg-danger-soft text-danger-text text-xs font-semibold border border-danger/30">Expired</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-success-soft text-success-text text-xs font-semibold border border-success/30">Active</span>
                        )}
                      </td>
                      <td className="px-8 py-5 text-right">
                        {state !== 'used' && (
                          <button
                            onClick={() => handleDeleteCoupon(coupon)}
                            disabled={revokingId !== null}
                            className="px-3 py-1.5 bg-danger-soft hover:bg-danger/90 text-danger-text hover:text-fg rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                          >
                            {revokingId === id ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ListPager page={couponPager.page} pages={couponPager.pages} total={couponPager.total} pageSize={couponPager.pageSize} onPage={couponPager.setPage} noun="coupons" />
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4" onClick={closeCreate}>
          <div className="bg-surface border border-line rounded-lg w-full max-w-xl overflow-hidden bg-surface border border-line" onClick={e => e.stopPropagation()}>
            <header className="px-8 py-6 border-b border-line flex justify-between items-center bg-surface-2/60">
              <h3 className="text-xl font-semibold text-fg">New coupon</h3>
              <button onClick={closeCreate} disabled={submitLoading} className="w-8 h-8 rounded-full bg-surface-2/60 hover:bg-surface-2 text-fg flex items-center justify-center text-lg transition-all disabled:opacity-40" aria-label="Close"><span aria-hidden="true" className="text-base leading-none">×</span></button>
            </header>

            <form onSubmit={handleCreateCoupon} className="p-8 space-y-6">
              {errorMsg && (
                <div className="p-4 bg-danger-soft border border-danger/30 rounded-lg text-xs font-semibold text-danger-text">{errorMsg}</div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg-muted">Customer</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name or phone…"
                    className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent transition-all"
                    value={userSearch}
                    onChange={(e) => {
                      setUserSearch(e.target.value);
                      setSelectedUserId('');
                    }}
                  />
                  {term && !selectedUserId && (
                    <div className="absolute left-0 right-0 mt-2 bg-surface border border-line rounded-lg max-h-56 overflow-y-auto z-50 bg-surface border border-line">
                      {filteredUsers.length === 0 ? (
                        <div className="p-4 text-xs text-fg-muted text-center font-semibold">No customers match.</div>
                      ) : (
                        filteredUsers.slice(0, 8).map((u) => (
                          <button
                            key={u.id || u._id}
                            type="button"
                            onClick={() => {
                              setSelectedUserId(u.id || u._id);
                              setUserSearch(`${u.name} (${u.phone})`);
                            }}
                            className="w-full text-left px-5 py-3 hover:bg-surface-2/60 text-sm text-fg flex justify-between items-center transition-all border-b border-line last:border-0"
                          >
                            <span className="font-semibold">{u.name}</span>
                            <span className="text-xs text-fg-muted font-mono">{u.phone}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {usersError ? (
                  <p className="text-xs text-danger-text font-semibold">{usersError} <button type="button" onClick={fetchUsers} className="underline">Retry</button></p>
                ) : null}
                {selectedUserId && (
                  <p className="text-xs text-success-text font-semibold">✓ {userSearch}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg-muted">Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. FLAT100"
                    maxLength={20}
                    className="flex-1 bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm font-mono text-fg placeholder:text-fg-subtle outline-none focus:border-accent transition-all"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                  />
                  <button type="button" onClick={() => setCode(randomCode())} className="px-5 bg-surface-2/60 border border-line hover:bg-surface-2 text-fg rounded-lg text-xs font-semibold transition-all">
                    Generate
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className={`space-y-2 ${type === 'FREEDEL' ? 'col-span-2' : ''}`}>
                  <label className="text-xs font-semibold text-fg-muted">Type</label>
                  <select
                    className="w-full bg-surface border border-line rounded-lg py-3.5 px-5 text-sm text-fg outline-none focus:border-accent transition-all cursor-pointer"
                    value={type}
                    onChange={(e) => setType(e.target.value as 'FREEDEL' | 'DISCOUNT')}
                  >
                    <option value="FREEDEL">Free delivery</option>
                    <option value="DISCOUNT">Flat ₹ off</option>
                  </select>
                </div>

                {type === 'DISCOUNT' && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-fg-muted">Discount (₹)</label>
                    <input
                      type="number"
                      min={1}
                      max={MAX_DISCOUNT}
                      step={1}
                      placeholder="e.g. 50"
                      className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent transition-all"
                      value={value}
                      onChange={(e) => setValue(e.target.value ? Number(e.target.value) : '')}
                    />
                  </div>
                )}
              </div>
              {type === 'DISCOUNT' && (
                <p className="text-xs text-fg-muted -mt-3">The discount is capped at the item total of the order.</p>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-fg-muted">Valid until (end of day)</label>
                  <div className="flex gap-2">
                    {[1, 3, 7, 30].map(days => (
                      <button key={days} type="button" onClick={() => setExpiryDate(daysFromToday(days))} className="px-2 py-1 bg-surface-2/60 hover:bg-surface-2 text-fg-muted hover:text-fg rounded text-xs font-semibold transition-all">
                        +{days}d
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="date"
                  min={daysFromToday(0)}
                  className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg outline-none focus:border-accent transition-all"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>

              <div className="flex gap-4 pt-4 border-t border-line">
                <button type="button" onClick={closeCreate} disabled={submitLoading} className="flex-1 py-3.5 bg-surface-2/60 hover:bg-surface-2 text-fg rounded-lg text-xs font-semibold transition-all disabled:opacity-40">
                  Cancel
                </button>
                <button type="submit" disabled={submitLoading} className="flex-1 py-3.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-solid rounded-lg text-xs font-semibold transition-all">
                  {submitLoading ? 'Creating…' : 'Create coupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
