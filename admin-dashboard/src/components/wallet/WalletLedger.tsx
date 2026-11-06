"use client";
// C5 wallet ledger views: per-owner history (modal) and the read-only reconciliation check.
// Data: GET /api/admin/wallet/:ownerType/:ownerId/transactions and GET /api/admin/wallet/reconcile.
import React, { useCallback, useEffect, useState } from 'react';
import { API_URL } from '@/lib/config';
import { Badge, Button, Card, CardHeader, DataTable, LoadingState, Modal, Notice, type Column } from '@/components/ui';
import { formatDateTime, formatINR, humanize } from '@/lib/format';

export type WalletOwnerType = 'user' | 'rider';

interface LedgerRow {
  id: string;
  type: string;
  label: string;
  amount: number;
  amountPaise: number;
  balanceAfter: number;
  ref: { type: string; id: string; label: string | null; orderCode?: string | null } | null;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

interface LedgerResponse {
  owner: { id: string; name: string | null; phone: string | null; walletBalance: number; balancePaise: number };
  ledgerPaise: number;
  inSync: boolean;
  transactions: LedgerRow[];
  page: number;
  hasMore: boolean;
  total: number;
}

interface ReconcileRow {
  ownerType: WalletOwnerType;
  ownerId: string;
  name: string | null;
  phone: string | null;
  balancePaise: number;
  ledgerPaise: number;
  differencePaise: number;
  rows: number;
  ownerMissing?: boolean;
}

interface ReconcileResponse {
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  ownersChecked: number;
  mismatchCount: number;
  withoutHistoryCount: number;
  mismatches: ReconcileRow[];
  withoutHistory: ReconcileRow[];
}

const rupees = (paise: number) => formatINR(paise / 100, { paise: true });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatINR(Math.abs(n), { paise: true })}`;

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
  if (res.status === 403) throw new Error('You do not have permission to do that.');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data && typeof data.message === 'string' && data.message.length < 200 ? data.message : fallback);
  return data as T;
}

const ledgerColumns: Column<LedgerRow>[] = [
  { key: 'when', header: 'When', cell: r => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(r.createdAt)}</span> },
  {
    key: 'what',
    header: 'What',
    cell: r => (
      <div>
        <p className="text-fg">{r.label}</p>
        <p className="text-xs text-fg-muted">{humanize(r.type)}{r.ref ? ` · ${r.ref.label || humanize(r.ref.type)} ${r.ref.id && !r.ref.orderCode ? r.ref.id.slice(0, 8) : ''}` : ''}</p>
      </div>
    ),
  },
  { key: 'amount', header: 'Amount', align: 'right', cell: r => <span className={`whitespace-nowrap font-medium tabular-nums ${r.amount < 0 ? 'text-danger-text' : 'text-success-text'}`}>{signed(r.amount)}</span> },
  { key: 'after', header: 'Balance after', align: 'right', cell: r => <span className="whitespace-nowrap tabular-nums text-fg-muted">{rupees(Math.round(r.balanceAfter * 100))}</span> },
  {
    key: 'by',
    header: 'By and reason',
    cell: r => (
      <div className="text-xs">
        <p className="text-fg-muted">{humanize(r.actorType)}</p>
        {r.reason && <p className="break-words text-fg">{r.reason}</p>}
      </div>
    ),
  },
];

export function WalletLedgerModal({ ownerType, ownerId, title, onClose }: { ownerType: WalletOwnerType; ownerId: string; title?: string; onClose: () => void }) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/wallet/${ownerType}/${ownerId}/transactions?page=${p}&limit=50`, { cache: 'no-store' });
      const d = await readJson<LedgerResponse>(res, 'Could not load the wallet history.');
      setData(d);
      setRows((prev) => (p === 1 ? d.transactions : [...prev, ...d.transactions]));
      setPage(p);
    } catch (err) {
      setError(err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ownerType, ownerId]);

  useEffect(() => { load(1); }, [load]);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Wallet history"
      description={`${title || data?.owner.name || 'Account'} · ${ownerType === 'rider' ? 'Rider' : 'Customer'}${data?.owner.phone ? ` · ${data.owner.phone}` : ''}`}
      footer={
        <>
          {data?.hasMore && <Button onClick={() => load(page + 1)} loading={loading}>Load older</Button>}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-4">
        {data && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-fg-muted">Balance <span className="font-medium text-fg tabular-nums">{rupees(data.owner.balancePaise)}</span></span>
            <span className="text-fg-muted">History total <span className="font-medium text-fg tabular-nums">{rupees(data.ledgerPaise)}</span></span>
            <span className="text-fg-muted">{data.total} entries</span>
            {data.inSync ? <Badge tone="success">In sync</Badge> : <Badge tone="danger">{rupees(data.owner.balancePaise - data.ledgerPaise)} unexplained</Badge>}
          </div>
        )}
        <DataTable
          caption="Wallet history"
          columns={ledgerColumns}
          rows={rows}
          rowKey={r => r.id}
          loading={loading && rows.length === 0}
          error={error}
          onRetry={() => load(1)}
          pageSize={0}
          maxHeight="55vh"
          empty={{ title: 'No wallet changes recorded yet' }}
        />
      </div>
    </Modal>
  );
}

/** Read-only check: every wallet's history total vs its balance. Never fixes anything. */
export function WalletReconcileCard() {
  const [data, setData] = useState<ReconcileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ ownerType: WalletOwnerType; ownerId: string; name: string | null } | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/wallet/reconcile?limit=100`, { cache: 'no-store' });
      setData(await readJson<ReconcileResponse>(res, 'Could not run the wallet check.'));
    } catch (err) {
      setError(err instanceof TypeError ? 'Could not reach the server. Check your connection.' : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  const columns: Column<ReconcileRow>[] = [
    {
      key: 'account',
      header: 'Account',
      cell: m => (
        <div>
          <p className="font-medium text-fg">{m.name || (m.ownerMissing ? 'Deleted account' : 'Unnamed')}</p>
          <p className="text-xs text-fg-muted">{m.ownerType === 'rider' ? 'Rider' : 'Customer'}{m.phone ? ` · ${m.phone}` : ''}</p>
        </div>
      ),
    },
    { key: 'balance', header: 'Balance', align: 'right', cell: m => <span className="tabular-nums">{rupees(m.balancePaise)}</span> },
    { key: 'history', header: 'History total', align: 'right', cell: m => <span className="tabular-nums text-fg-muted">{rupees(m.ledgerPaise)}</span> },
    { key: 'diff', header: 'Difference', align: 'right', cell: m => <span className="tabular-nums text-danger-text">{rupees(m.differencePaise)}</span> },
    { key: 'action', header: <span className="sr-only">Action</span>, align: 'right', cell: m => (!m.ownerMissing ? <Button size="sm" onClick={() => setOpen({ ownerType: m.ownerType, ownerId: m.ownerId, name: m.name })}>History</Button> : null) },
  ];

  const list = (title: string, items: ReconcileRow[], hint: string) => (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="text-xs text-fg-muted">{hint}</p>
      </div>
      <DataTable caption={title} columns={columns} rows={items} rowKey={m => `${m.ownerType}:${m.ownerId}`} pageSize={25} maxHeight="none" />
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Wallet check"
        description="Compares every wallet’s balance with the total of its history. It runs by itself every day at 4:30 am IST and alerts admins when something is off. It only reports and never changes anything: fix a real error with a wallet adjustment (with a reason) after checking the history."
        actions={<Button variant="primary" onClick={run} loading={loading}>{loading ? 'Checking…' : 'Run check now'}</Button>}
      />
      <div className="space-y-5 p-4">
        {error && <Notice tone="danger"><span className="text-fg">{error}</span></Notice>}
        {!data && loading && <LoadingState label="Checking every wallet…" />}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-fg-muted">Checked <span className="text-fg">{formatDateTime(data.checkedAt)}</span></span>
              <span className="text-fg-muted">Wallets with history <span className="text-fg tabular-nums">{data.ownersChecked}</span></span>
              <Badge tone={data.mismatchCount ? 'danger' : 'success'}>{data.mismatchCount} {data.mismatchCount === 1 ? 'mismatch' : 'mismatches'}</Badge>
              <Badge tone={data.withoutHistoryCount ? 'warning' : 'success'}>{data.withoutHistoryCount} without history</Badge>
            </div>
            {data.ok && <Notice tone="success"><span className="text-fg">All wallets match their history.</span></Notice>}
            {data.mismatches.length > 0 && list('Balance differs from history', data.mismatches, 'The balance was changed outside the wallet history (for example a direct database edit). Open the history to see the last recorded balance.')}
            {data.withoutHistory.length > 0 && list('Balance without any history', data.withoutHistory, 'These accounts have money but no history rows. Normally recorded automatically at the next server start or the next wallet change.')}
          </>
        )}
      </div>
      {open && <WalletLedgerModal ownerType={open.ownerType} ownerId={open.ownerId} title={open.name || undefined} onClose={() => setOpen(null)} />}
    </Card>
  );
}
