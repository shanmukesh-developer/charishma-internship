"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest as apiRequest } from '@/lib/api';
import Link from 'next/link';
import AppVersionsCard from '@/components/config/AppVersionsCard';
import LegalCard from '@/components/config/LegalCard';
import ReceiptsCard from '@/components/config/ReceiptsCard';

interface ConfigRow {
  _id: string;
  key: string;
  value: unknown;
  description?: string | null;
  updatedAt?: string;
}

interface Serviceability {
  open: boolean;
  reopensAt?: string;
  message?: string;
  paymentMethods?: string[];
}

/** fetch against the one backend; throws an Error carrying the server's friendly `message`. */
// Keys the backend actually reads. Everything else in GlobalConfig is stored but not enforced.
const DELIVERY_FEE_KEY = 'delivery_fee';
const DEFAULT_DELIVERY_FEE = 30; // backend fallback in utils/orderPricing.js
const MAX_DELIVERY_FEE = 200;
// Retention windows read by backend/cron/retentionCron.js (whole days, minimum 1).
const RETENTION = [
  { key: 'CHAT_RETENTION_DAYS', label: 'Chat messages', def: 7, hint: 'DMs, groups, task / Connect chats and campus spot rooms. Shown in every chat.' },
  { key: 'PULSE_RETENTION_DAYS', label: 'Pulse posts', def: 30, hint: 'Whole threads (replies, likes, polls). Posts under an open report or appeal are kept until resolved.' },
] as const;
// Internal one-time markers the backend reads (not settings) are hidden from the list below too.
// APP_VERSION_POLICY is edited in the App Versions card below (PUT /api/admin/app-versions);
// LEGAL_SETTINGS in the Legal & Compliance card (PUT /api/admin/legal-settings).
// C6: RIDER_CASH_LIMIT is edited in the Rider cash limit card; the other two are server markers.
const CASH_LIMIT_KEY = 'RIDER_CASH_LIMIT';
const MAX_CASH_LIMIT = 100000;
const MANAGED_KEYS: string[] = [...RETENTION.map(r => r.key), 'CAMPUS_SPOTS_DEFAULTS_RETIRED', 'APP_VERSION_POLICY', 'LEGAL_SETTINGS', CASH_LIMIT_KEY, 'RIDER_CASH_LEDGER_START', 'C6_COMMISSION_BACKFILL'];
// Keys the backend DOES read, but that are edited on their own page (listing them under "not read"
// told admins the rentals on/off switch did nothing).
const MANAGED_ELSEWHERE: Record<string, { label: string; href: string }> = {
  VEHICLE_RENTALS_ENABLED: { label: 'Vehicle rentals on/off', href: '/rentals' },
  CAMPUS_WHISPERS_ENABLED: { label: 'Campus Whispers on/off', href: '/friends' },
  AFTER_DARK_ENABLED: { label: 'Zenvy After Dark on/off', href: '/friends' },
};
const MAX_RETENTION_DAYS = 3650;

const formatValue = (value: unknown) => {
  // Lists of objects used to print "[object Object], [object Object]".
  if (Array.isArray(value) && value.every(v => v === null || ['string', 'number', 'boolean'].includes(typeof v))) return value.join(', ');
  if (Array.isArray(value)) { const json = JSON.stringify(value); return json.length > 240 ? `${json.slice(0, 240)}… (${value.length} items)` : json; }
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export default function ConfigTerminal() {
  const { isAuthed } = useAdminAuth();
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [serviceability, setServiceability] = useState<Serviceability | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [feeInput, setFeeInput] = useState('');
  const [savingFee, setSavingFee] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feeNotice, setFeeNotice] = useState<string | null>(null);

  const [limitInput, setLimitInput] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);
  const [limitMsg, setLimitMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [retInputs, setRetInputs] = useState<Record<string, string>>({});
  const [savingRet, setSavingRet] = useState<string | null>(null);
  const [retError, setRetError] = useState<string | null>(null);
  const [retNotice, setRetNotice] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rows, svc] = await Promise.all([
        apiRequest<ConfigRow[]>('/api/admin/config'),
        apiRequest<Serviceability>('/api/orders/serviceability').catch(() => null),
      ]);
      const list = Array.isArray(rows) ? rows : [];
      setConfigs(list);
      setServiceability(svc);
      const fee = list.find(c => c.key === DELIVERY_FEE_KEY)?.value;
      setFeeInput(String(fee ?? DEFAULT_DELIVERY_FEE));
      setLimitInput(String(list.find(c => c.key === CASH_LIMIT_KEY)?.value ?? 0));
      const ret: Record<string, string> = {};
      for (const r of RETENTION) ret[r.key] = String(list.find(c => c.key === r.key)?.value ?? r.def);
      setRetInputs(ret);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) fetchAll();
  }, [isAuthed, fetchAll]);

  // Reload only the config rows after a retention save: fetchAll() also resets the fee and the other
  // retention input, which would wipe a value the admin typed but has not saved yet.
  const reloadConfigRows = useCallback(async (savedKey: string) => {
    const rows = await apiRequest<ConfigRow[]>('/api/admin/config', { cache: 'reload' });
    const list = Array.isArray(rows) ? rows : [];
    setConfigs(list);
    const r = RETENTION.find(x => x.key === savedKey);
    if (r) setRetInputs(prev => ({ ...prev, [savedKey]: String(list.find(c => c.key === savedKey)?.value ?? r.def) }));
  }, []);

  const feeRow = configs.find(c => c.key === DELIVERY_FEE_KEY);
  const currentFee = Number(feeRow?.value ?? DEFAULT_DELIVERY_FEE);
  const otherRows = configs.filter(c => c.key !== DELIVERY_FEE_KEY && !MANAGED_KEYS.includes(c.key) && !MANAGED_ELSEWHERE[c.key]);
  const elsewhereRows = configs.filter(c => MANAGED_ELSEWHERE[c.key]);

  const handleSaveRetention = async (key: string, label: string, def: number) => {
    if (savingRet) return;
    setRetError(null);
    setRetNotice(null);
    const raw = (retInputs[key] || '').trim();
    const days = raw === '' ? NaN : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) {
      setRetError(`${label}: enter a whole number of days from 1 to ${MAX_RETENTION_DAYS}.`);
      return;
    }
    const current = Number(configs.find(c => c.key === key)?.value ?? def);
    const currentValid = Number.isFinite(current);
    if (currentValid && days === current) {
      setRetNotice('No change to save.');
      return;
    }
    // A stored value that is not a number cannot be compared: always ask before saving.
    if (!currentValid && !confirm(`The saved ${label.toLowerCase()} retention is not a valid number. Set it to ${days} day(s)? Older items are permanently deleted on the next hourly run.`)) return;
    if (currentValid && days < current && !confirm(`Shorten ${label.toLowerCase()} retention from ${current} to ${days} day(s)? Older items are permanently deleted on the next hourly run.`)) return;
    setSavingRet(key);
    try {
      await apiRequest('/api/admin/config', { method: 'POST', body: JSON.stringify({ key, value: days }) });
      setRetNotice(`${label} are now kept for ${days} day(s).`);
      await reloadConfigRows(key).catch(() => { /* saved; the list refreshes on the next load */ });
    } catch (err) {
      setRetError(err instanceof Error ? err.message : 'Could not save the retention setting.');
    } finally {
      setSavingRet(null);
    }
  };

  const handleSaveFee = async () => {
    if (savingFee) return;
    setFeeError(null);
    setFeeNotice(null);
    // Number('') is 0: a cleared field must not save a free delivery fee.
    const fee = feeInput.trim() === '' ? NaN : Number(feeInput);
    if (!Number.isInteger(fee) || fee < 0 || fee > MAX_DELIVERY_FEE) {
      setFeeError(`Enter a whole number of rupees from 0 to ${MAX_DELIVERY_FEE}.`);
      return;
    }
    if (fee === currentFee) {
      setFeeNotice('No change to save.');
      return;
    }
    if (!confirm(`Change the delivery fee from ₹${currentFee} to ₹${fee}? It applies to every new order quote immediately.`)) return;
    setSavingFee(true);
    try {
      await apiRequest('/api/admin/config', {
        method: 'POST',
        body: JSON.stringify({
          key: DELIVERY_FEE_KEY,
          value: fee,
          description: feeRow?.description || 'Global delivery fee in INR',
        }),
      });
      setFeeNotice(`Delivery fee is now ₹${fee}.`);
      await fetchAll();
    } catch (err) {
      setFeeError(err instanceof Error ? err.message : 'Could not save the delivery fee.');
    } finally {
      setSavingFee(false);
    }
  };

  const currentLimit = Number(configs.find(c => c.key === CASH_LIMIT_KEY)?.value ?? 0) || 0;
  const handleSaveLimit = async () => {
    if (savingLimit) return;
    setLimitMsg(null);
    const n = limitInput.trim() === '' ? NaN : Number(limitInput);
    if (!Number.isInteger(n) || n < 0 || n > MAX_CASH_LIMIT) { setLimitMsg({ kind: 'err', text: `Enter a whole number of rupees from 0 to ${MAX_CASH_LIMIT} (0 = off).` }); return; }
    if (n === currentLimit) { setLimitMsg({ kind: 'ok', text: 'No change to save.' }); return; }
    if (n > 0 && !confirm(`Turn on a ₹${n} cash limit? Riders holding ₹${n} or more of COD cash will not be able to take new COD orders until they deposit.`)) return;
    setSavingLimit(true);
    try {
      await apiRequest('/api/admin/config', { method: 'POST', body: JSON.stringify({ key: CASH_LIMIT_KEY, value: n }) });
      setLimitMsg({ kind: 'ok', text: n === 0 ? 'Cash limit is off: riders are never blocked.' : `Cash limit is now ₹${n}.` });
      await fetchAll();
    } catch (err) {
      setLimitMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Could not save the cash limit.' });
    } finally {
      setSavingLimit(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-xl mx-auto mt-16 glass-card p-8 text-center space-y-4">
        <p className="text-sm font-bold text-red-400">{loadError}</p>
        <button onClick={fetchAll} className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-black uppercase tracking-widest text-white">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="bg-white/5 p-8 rounded-[40px] border border-white/5 glass flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">System <span className="text-blue-500">Config</span></h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Pricing and ordering parameters enforced by the backend</p>
        </div>
        <button onClick={fetchAll} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-wider text-gray-400 hover:bg-white/10">
          ↻ Refresh
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Delivery fee: read by the server's order pricing */}
        <div className="glass-card p-10 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-xl">🛵</div>
            <div>
              <h4 className="text-lg font-black text-white uppercase tracking-tight">Delivery Fee</h4>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Used by the server for every order quote</p>
            </div>
          </div>

          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <label htmlFor="delivery-fee" className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Fee per order (₹)</label>
              <input
                id="delivery-fee"
                type="number"
                min={0}
                max={MAX_DELIVERY_FEE}
                step={1}
                value={feeInput}
                onChange={(e) => { setFeeInput(e.target.value); setFeeError(null); setFeeNotice(null); }}
                className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white font-black"
              />
            </div>
            <button
              onClick={handleSaveFee}
              disabled={savingFee}
              className="px-6 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white"
            >
              {savingFee ? 'Saving...' : 'Save'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            Current: ₹{currentFee}{!feeRow && ' (server default, not set in the database yet)'}. Member perks may discount it per order.
          </p>
          {feeError && <p className="text-xs font-bold text-red-400">{feeError}</p>}
          {feeNotice && <p className="text-xs font-bold text-emerald-400">{feeNotice}</p>}
        </div>

        {/* Live ordering status (read-only) */}
        <div className="glass-card p-10 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-emerald-600/20 rounded-xl flex items-center justify-center text-xl">🕒</div>
            <div>
              <h4 className="text-lg font-black text-white uppercase tracking-tight">Ordering Status</h4>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Live from /api/orders/serviceability</p>
            </div>
          </div>

          {serviceability ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${serviceability.open ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-sm font-black text-white uppercase tracking-wider">
                  {serviceability.open ? 'Campus ordering is open' : 'Campus ordering is closed'}
                </span>
              </div>
              {!serviceability.open && (
                <p className="text-xs text-gray-400">
                  {serviceability.message}{serviceability.reopensAt ? ` Reopens at ${serviceability.reopensAt} IST.` : ''}
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Payment methods:</span>
                {(serviceability.paymentMethods || ['COD', 'Wallet']).map(m => (
                  <span key={m} className="px-2 py-0.5 text-[10px] font-black rounded-full border border-white/10 bg-white/5 text-white">{m}</span>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Night hours are set on the server (storeHours). Online UPI/card payments are off: new orders are Cash on Delivery or Wallet only.
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Could not read the live ordering status.</p>
          )}
        </div>
      </div>

      {/* C6 rider cash limit: read by the rider claim path (0 = off, the default) */}
      <div className="glass-card p-10 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-amber-600/20 rounded-xl flex items-center justify-center text-xl">💵</div>
          <div>
            <h4 className="text-lg font-black text-white uppercase tracking-tight">Rider cash limit</h4>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">COD cash a rider may hold before new COD orders are blocked · 0 = off</p>
          </div>
        </div>
        <div className="flex items-end gap-4 max-w-md">
          <div className="flex-1 space-y-2">
            <label htmlFor="cash-limit" className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Limit (₹)</label>
            <input id="cash-limit" type="number" min={0} max={MAX_CASH_LIMIT} step={1} value={limitInput}
              onChange={(e) => { setLimitInput(e.target.value); setLimitMsg(null); }}
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white font-black" />
          </div>
          <button onClick={handleSaveLimit} disabled={savingLimit} className="px-6 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white">
            {savingLimit ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="text-[11px] text-gray-500">
          Current: {currentLimit > 0 ? `₹${currentLimit}` : 'Off (riders are never blocked; the rider app only shows the cash they hold)'}. Cash held and deposits are on Finance → Rider cash.
        </p>
        {limitMsg && <p className={`text-xs font-bold ${limitMsg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>{limitMsg.text}</p>}
      </div>

      {/* Data retention: read by the backend's hourly cleanup job */}
      <div className="glass-card p-10 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-rose-600/20 rounded-xl flex items-center justify-center text-xl">🧹</div>
          <div>
            <h4 className="text-lg font-black text-white uppercase tracking-tight">Data Retention</h4>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Hourly cleanup permanently deletes older items · minimum 1 day</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {RETENTION.map(r => (
            <div key={r.key} className="space-y-2">
              <label htmlFor={`ret-${r.key}`} className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{r.label} (days)</label>
              <div className="flex items-end gap-3">
                <input
                  id={`ret-${r.key}`}
                  type="number"
                  min={1}
                  max={MAX_RETENTION_DAYS}
                  step={1}
                  value={retInputs[r.key] ?? ''}
                  onChange={(e) => { setRetInputs(prev => ({ ...prev, [r.key]: e.target.value })); setRetError(null); setRetNotice(null); }}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white font-black"
                />
                <button
                  onClick={() => handleSaveRetention(r.key, r.label, r.def)}
                  disabled={!!savingRet}
                  className="px-6 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white"
                >
                  {savingRet === r.key ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500">
                {r.hint} {!configs.some(c => c.key === r.key) && `(server default ${r.def} days, not set in the database yet)`}
              </p>
            </div>
          ))}
        </div>
        {retError && <p className="text-xs font-bold text-red-400">{retError}</p>}
        {retNotice && <p className="text-xs font-bold text-emerald-400">{retNotice}</p>}
      </div>

      {/* Force update: per-app minimum / latest versions */}
      <AppVersionsCard />

      <LegalCard />

      <ReceiptsCard />

      {/* Other stored keys: shown honestly as not enforced */}
      <div className="glass-card p-10 space-y-6">
        <div>
          <h4 className="text-lg font-black text-white uppercase tracking-tight">Other Stored Settings</h4>
          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
            These keys exist in the database but neither the backend nor the apps read them today, so changing them would have no effect.
            They are shown read-only to avoid a false sense of control.
          </p>
        </div>
        {elsewhereRows.length > 0 && (
          <ul className="space-y-1 text-xs text-gray-400">
            {elsewhereRows.map(row => (
              <li key={row.key}>
                <span className="font-mono text-gray-300">{row.key}</span> = <span className="font-bold text-white">{formatValue(row.value)}</span>
                {' · '}{MANAGED_ELSEWHERE[row.key].label} is read by the server; change it on <Link href={MANAGED_ELSEWHERE[row.key].href} className="text-blue-400 underline">its own page</Link>.
              </li>
            ))}
          </ul>
        )}
        {otherRows.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No other settings stored.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/5">
                  <th className="py-2 pr-4">Key</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {otherRows.map(row => (
                  <tr key={row._id || row.key} className="border-b border-white/[0.03]">
                    <td className="py-2 pr-4 font-mono text-gray-300">{row.key}</td>
                    <td className="py-2 pr-4 text-white font-bold">{formatValue(row.value)}</td>
                    <td className="py-2 text-gray-500">{row.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
