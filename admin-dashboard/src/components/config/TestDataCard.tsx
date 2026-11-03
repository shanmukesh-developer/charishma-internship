"use client";
// Owner-only test data (owner, 3 Nov 2026: test data on the live server that only the owner's accounts see):
// restaurants, campus stalls, grocery and service stores and deals marked as test data (backend utils/testView,
// scripts/test_data_v2_seed.js). Only the accounts with the phone numbers saved here see them; everyone else, the
// Play reviewer included, never does. GET /api/admin/test-data, POST /api/admin/config (TEST_VIEWER_PHONES),
// POST /api/admin/test-data/remove | /add.
import {
  Badge, Button, Card, CardBody, CardFooter, CardHeader, Field, Input, LoadingState, Notice, useConfirm,
} from '@/components/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { adminRequest as apiRequest } from '@/lib/api';

interface Status {
  phones: string[];
  matched: { customers: number; riders: number };
  removed: { at?: string } | null;
  counts: { stores: number; items: number; deals: number; orders: number; pgs: number; rides: number; vehicles: number; events: number };
}
interface SaveResult { value: string[]; matched: { customers: number; riders: number } }

const KEY = 'TEST_VIEWER_PHONES';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function TestDataCard() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | null>(null);
  const [phones, setPhones] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | 'add' | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await apiRequest<Status>('/api/admin/test-data');
      setStatus(s);
      setPhones(s.phones.join(', '));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the test data.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (kind: 'save' | 'remove' | 'add', fn: () => Promise<string>) => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(kind);
    try {
      setNotice(await fn());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const save = () => run('save', async () => {
    const d = await apiRequest<SaveResult>('/api/admin/config', { method: 'POST', body: JSON.stringify({ key: KEY, value: phones }) });
    if (!d.value.length) return 'Saved with no numbers: nobody sees the test data now.';
    return `Saved ${plural(d.value.length, 'number')}. ${plural(d.matched.customers, 'customer account')} and ${plural(d.matched.riders, 'rider account')} see the test data now.`;
  });

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove all test data?',
      description: 'Open test orders are cancelled and refunded first, then every test store, item, deal and test order is deleted. It stays removed until you add it again.',
      confirmLabel: 'Remove test data',
      tone: 'danger',
    });
    if (!ok) return;
    await run('remove', async () => {
      await apiRequest('/api/admin/test-data/remove', { method: 'POST' });
      return 'Test data removed.';
    });
  };

  const add = () => run('add', async () => {
    await apiRequest('/api/admin/test-data/add', { method: 'POST' });
    return 'Test data added again.';
  });

  const c = status?.counts;
  const total = c ? c.stores + c.items + c.deals + c.pgs + c.rides + c.vehicles + c.events : 0;

  return (
    <Card>
      <CardHeader
        title="Test data"
        description="Restaurants, campus stalls, grocery and service stores and deals for testing on the live app. Only the accounts with the phone numbers below see them; every other customer, rider and the Play reviewer never does."
        actions={status ? <Badge tone={status.removed ? 'neutral' : 'success'}>{status.removed ? 'Removed' : `${plural(c?.stores || 0, 'test store')}`}</Badge> : undefined}
      />
      <CardBody className="space-y-4">
        {loadError && <Notice tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{loadError}</Notice>}
        {!status && !loadError && <LoadingState label="Loading test data…" />}

        {status && c && (
          <>
            <Field
              label="Phone numbers that see the test data"
              hint={`Comma separated, 10 digits each (up to 20). Matched now: ${plural(status.matched.customers, 'customer account')}, ${plural(status.matched.riders, 'rider account')}. An account signs up with the same number to match.`}
            >
              <Input inputMode="tel" autoComplete="off" spellCheck={false} placeholder="98765 43210, 91234 56789" value={phones} onChange={(e) => { setPhones(e.target.value); setNotice(null); }} />
            </Field>

            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {([['Stores', c.stores], ['Items', c.items], ['Deals', c.deals], ['Test orders', c.orders]] as const).map(([label, n]) => (
                <div key={label} className="rounded-lg border border-line px-3 py-2">
                  <dt className="text-xs text-fg-muted">{label}</dt>
                  <dd className="text-base font-semibold text-fg">{n}</dd>
                </div>
              ))}
            </dl>

            {status.removed && (
              <Notice tone="info">Removed{status.removed.at ? ` on ${new Date(status.removed.at).toLocaleString('en-IN')}` : ''}. It is not added again until you choose Add again.</Notice>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            {notice && <Notice tone="success">{notice}</Notice>}
          </>
        )}
      </CardBody>
      {status && (
        <CardFooter>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === 'save'} disabled={!!busy && busy !== 'save'} onClick={save}>Save numbers</Button>
            {status.removed || total === 0
              ? <Button loading={busy === 'add'} disabled={!!busy && busy !== 'add'} onClick={add}>Add again</Button>
              : <Button variant="destructive" loading={busy === 'remove'} disabled={!!busy && busy !== 'remove'} onClick={remove}>Remove test data</Button>}
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
