"use client";
import {
  Badge, Button, ButtonLink, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input, LoadingState, Notice, PageHeader, StatusPill, Tabs, useConfirm,
  IconRefresh,
} from '@/components/ui';
import { formatDateTime, formatINR } from '@/lib/format';
import { readableText } from '@/components/ui/Readable';
import React, { useState, useEffect, useCallback } from 'react';
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

/** Plain-language summary of the feature switches (the switches themselves live on each page). */
const FEATURE_SWITCHES = [
  { key: 'AUTO_RIDE_ENABLED', label: 'Auto-ride', href: '/auto-ride?tab=settings', where: 'Open Auto-ride settings', what: 'On: students can browse shared autos, hold and book seats and request a full auto. Off: no new bookings; existing ones stay visible and can be cancelled. Turn on only after permits, insurance and driver documents are checked.' },
  { key: 'CAMPUS_EVENTS_ENABLED', label: 'Campus events', href: '/campus-events?tab=settings', where: 'Open Events settings', what: 'On: students can browse events, register and get tickets, and organisers can submit events. Off: browsing, registration and submissions close; existing tickets stay readable and check-in keeps working.' },
  { key: 'VEHICLE_RENTALS_ENABLED', label: 'Vehicle rentals', href: '/rentals', where: 'Open Rentals', what: 'On: students can list their vehicles and book other students’ vehicles. Off: the rentals section is closed in the app.' },
  { key: 'CAMPUS_WHISPERS_ENABLED', label: 'Campus Whispers', href: '/friends', where: 'Open Friends app', what: 'On: students can post and read anonymous campus whispers. Off: whispers are hidden and new posts are refused.' },
  { key: 'AFTER_DARK_ENABLED', label: 'Zenvy After Dark', href: '/friends', where: 'Open Friends app', what: 'On: the late-night lounge chats and rooms open in the app. Off: they are closed.' },
] as const;


const formatValue = (value: unknown) => {
  // Lists of objects used to print "[object Object], [object Object]".
  if (Array.isArray(value) && value.every(v => v === null || ['string', 'number', 'boolean'].includes(typeof v))) return value.join(', ');
  if (Array.isArray(value)) { const text = readableText(value); return text.length > 240 ? `${text.slice(0, 240)}… (${value.length} items)` : text; }
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'object') { const text = readableText(value); return text.length > 240 ? `${text.slice(0, 240)}…` : text; }
  return String(value);
};

type SettingsTab = 'fees' | 'switches' | 'retention' | 'versions' | 'legal' | 'receipts' | 'other';
const SETTINGS_TABS: SettingsTab[] = ['fees', 'switches', 'retention', 'versions', 'legal', 'receipts', 'other'];

export default function ConfigTerminal() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [serviceability, setServiceability] = useState<Serviceability | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // ?tab= opens a section directly (links from other pages and the command palette).
  const [tab, setTab] = useState<SettingsTab>('fees');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as SettingsTab | null;
    if (t && SETTINGS_TABS.includes(t)) setTab(t);
  }, []);
  const selectTab = (t: SettingsTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  };

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
    if (!currentValid && !(await confirm({ title: `Set ${label.toLowerCase()} retention to ${days} day(s)?`, description: 'The saved value is not a valid number. Older items are permanently deleted on the next hourly run.', confirmLabel: 'Save retention', tone: 'danger' }))) return;
    if (currentValid && days < current && !(await confirm({ title: `Shorten ${label.toLowerCase()} retention from ${current} to ${days} day(s)?`, description: 'Older items are permanently deleted on the next hourly run. This cannot be undone.', confirmLabel: 'Shorten retention', tone: 'danger' }))) return;
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
    if (!(await confirm({ title: `Change the delivery fee from ₹${currentFee} to ₹${fee}?`, description: 'It applies to every new order quote immediately.', confirmLabel: 'Change fee' }))) return;
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
    if (n > 0 && !(await confirm({ title: `Set the rider cash limit to ₹${n}?`, description: `Riders holding ₹${n} or more of COD cash will not be able to take new COD orders until they deposit.`, confirmLabel: 'Set limit' }))) return;
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

  const header = (
    <PageHeader
      title="Settings and fees"
      description="Delivery fee, rider cash limit, feature switches, data retention, app versions, legal pages and receipts."
      actions={<Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={fetchAll}>Refresh</Button>}
    />
  );

  if (loading && configs.length === 0) return <div className="text-fg">{header}<LoadingState label="Loading settings…" /></div>;

  if (loadError) {
    return (
      <div className="text-fg">
        {header}
        <ErrorState title="Could not load the settings" message={loadError} onRetry={fetchAll} />
      </div>
    );
  }

  const saveRow = (input: React.ReactNode, button: React.ReactNode) => (
    <div className="flex items-start gap-2">
      <div className="w-40">{input}</div>
      {button}
    </div>
  );

  return (
    <div className="text-fg">
      {header}

      <Tabs<SettingsTab>
        className="mb-5"
        value={tab}
        onChange={selectTab}
        tabs={[
          { id: 'fees', label: 'Fees and ordering' },
          { id: 'switches', label: 'Feature switches' },
          { id: 'retention', label: 'Data retention' },
          { id: 'versions', label: 'App versions' },
          { id: 'legal', label: 'Legal' },
          { id: 'receipts', label: 'Receipts' },
          { id: 'other', label: 'Other stored', count: otherRows.length + elsewhereRows.length },
        ]}
      />

      {tab === 'fees' && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Delivery fee" description="Used by the server for every new order quote. Member perks may discount it per order." />
              <CardBody className="space-y-3">
                <Field
                  label="Fee per order"
                  hint={<>Current: {formatINR(currentFee)}{!feeRow && ' (server default, not set in the database yet)'}. Whole rupees, 0 to {MAX_DELIVERY_FEE}.</>}
                  error={feeError || undefined}
                >
                  {saveRow(
                    <Input
                      type="number"
                      prefix="₹"
                      min={0}
                      max={MAX_DELIVERY_FEE}
                      step={1}
                      value={feeInput}
                      onChange={(e) => { setFeeInput(e.target.value); setFeeError(null); setFeeNotice(null); }}
                    />,
                    <Button variant="primary" loading={savingFee} onClick={handleSaveFee}>Save</Button>,
                  )}
                </Field>
                {feeNotice && <p className="text-sm text-success-text">{feeNotice}</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Ordering status" description="Live from the server. Night hours are set on the server (store hours)." />
              <CardBody>
                {serviceability ? (
                  <div className="space-y-3">
                    <StatusPill
                      status={serviceability.open ? 'open' : 'closed'}
                      tone={serviceability.open ? 'success' : 'danger'}
                      label={serviceability.open ? 'Campus ordering is open' : 'Campus ordering is closed'}
                    />
                    {!serviceability.open && (
                      <p className="text-sm text-fg-muted">
                        {serviceability.message}{serviceability.reopensAt ? ` Reopens at ${serviceability.reopensAt} IST.` : ''}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-fg-muted">Payment methods</span>
                      {(serviceability.paymentMethods || ['COD', 'Wallet']).map(m => <Badge key={m}>{m === 'COD' ? 'Cash on delivery' : m}</Badge>)}
                    </div>
                    <p className="text-xs text-fg-muted">Online UPI and card payments are off: new orders are cash on delivery or wallet only.</p>
                  </div>
                ) : (
                  <p className="text-sm text-fg-muted">Could not read the live ordering status.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Rider cash limit" description="Cash-on-delivery money a rider may hold before new COD orders are blocked. 0 turns the limit off." />
            <CardBody className="space-y-3">
              <Field
                label="Limit"
                hint={<>Current: {currentLimit > 0 ? formatINR(currentLimit) : 'Off (riders are never blocked; the rider app only shows the cash they hold)'}. Cash held and deposits are on <Link href="/finance" className="text-accent-text hover:underline">Payments and payouts</Link>.</>}
                error={limitMsg?.kind === 'err' ? limitMsg.text : undefined}
              >
                {saveRow(
                  <Input
                    type="number"
                    prefix="₹"
                    min={0}
                    max={MAX_CASH_LIMIT}
                    step={1}
                    value={limitInput}
                    onChange={(e) => { setLimitInput(e.target.value); setLimitMsg(null); }}
                  />,
                  <Button variant="primary" loading={savingLimit} onClick={handleSaveLimit}>Save</Button>,
                )}
              </Field>
              {limitMsg?.kind === 'ok' && <p className="text-sm text-success-text">{limitMsg.text}</p>}
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'switches' && (
        <Card>
          <CardHeader title="Feature switches" description="Big features are switched on and off on their own pages. Each switch asks you to confirm before it changes anything." />
          <ul className="divide-y divide-line">
            {FEATURE_SWITCHES.map(f => (
              <li key={f.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 max-w-3xl">
                  <p className="text-sm font-medium text-fg">{f.label} <span className="ml-1 font-mono text-xs font-normal text-fg-subtle">{f.key}</span></p>
                  <p className="mt-0.5 text-sm text-fg-muted">{f.what}</p>
                </div>
                <ButtonLink href={f.href} size="sm">{f.where}</ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'retention' && (
        <Card>
          <CardHeader title="Data retention" description="An hourly cleanup permanently deletes items older than this. Minimum 1 day." />
          <CardBody className="space-y-4">
            <div className="grid gap-5 md:grid-cols-2">
              {RETENTION.map(r => (
                <Field
                  key={r.key}
                  label={`${r.label} (days)`}
                  hint={<>{r.hint} {!configs.some(c => c.key === r.key) && `(Server default ${r.def} days, not set in the database yet.)`}</>}
                >
                  {saveRow(
                    <Input
                      type="number"
                      min={1}
                      max={MAX_RETENTION_DAYS}
                      step={1}
                      value={retInputs[r.key] ?? ''}
                      onChange={(e) => { setRetInputs(prev => ({ ...prev, [r.key]: e.target.value })); setRetError(null); setRetNotice(null); }}
                    />,
                    <Button variant="primary" disabled={!!savingRet && savingRet !== r.key} loading={savingRet === r.key} onClick={() => handleSaveRetention(r.key, r.label, r.def)}>Save</Button>,
                  )}
                </Field>
              ))}
            </div>
            {retError && <Notice tone="danger">{retError}</Notice>}
            {retNotice && <Notice tone="success">{retNotice}</Notice>}
          </CardBody>
        </Card>
      )}

      {tab === 'versions' && <AppVersionsCard />}
      {tab === 'legal' && <LegalCard />}
      {tab === 'receipts' && <ReceiptsCard />}

      {tab === 'other' && (
        <Card>
          <CardHeader
            title="Other stored settings"
            description="These keys exist in the database but neither the backend nor the apps read them today, so changing them would have no effect. They are shown read-only."
          />
          {elsewhereRows.length > 0 && (
            <div className="border-b border-line px-4 py-3">
              <p className="mb-2 text-xs text-fg-muted">Read by the server, changed on their own page</p>
              <ul className="space-y-1 text-sm">
                {elsewhereRows.map(row => (
                  <li key={row.key} className="flex flex-wrap items-center gap-x-2">
                    <span className="text-fg">{MANAGED_ELSEWHERE[row.key].label}</span>
                    <span className="font-mono text-xs text-fg-subtle">{row.key}</span>
                    <span className="text-fg-muted">= {formatValue(row.value)}</span>
                    <Link href={MANAGED_ELSEWHERE[row.key].href} className="text-accent-text hover:underline">Open</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {otherRows.length === 0 ? (
            <EmptyState title="No other settings stored" />
          ) : (
            <div className="overflow-x-auto">
              <table className="zv-table zv-table-dense">
                <thead>
                  <tr><th>Key</th><th>Value</th><th>Description</th><th className="text-right">Updated</th></tr>
                </thead>
                <tbody>
                  {otherRows.map(row => (
                    <tr key={row._id || row.key}>
                      <td className="font-mono text-xs text-fg-muted">{row.key}</td>
                      <td className="max-w-[420px] break-words text-fg">{formatValue(row.value)}</td>
                      <td className="text-fg-muted">{row.description || '–'}</td>
                      <td className="whitespace-nowrap text-right text-xs text-fg-muted">{row.updatedAt ? formatDateTime(row.updatedAt, { short: true }) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
