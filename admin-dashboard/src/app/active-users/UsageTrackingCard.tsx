"use client";
// ============================================================================================================
// CLOSED-TEST ONLY: app usage time (owner, 6 Nov 2026). Temporary: switched off and deleted at production.
// Remove this file (and its use on page.tsx) together with backend/utils/usageTime.js when usage time goes.
// ============================================================================================================
// The ON / OFF switch (the customer app reads it on launch and resume, so turning it off needs no app update) and
// "Delete all usage-time data". Backend: GET + PUT /api/admin/active-users/usage-tracking,
// POST /api/admin/active-users/usage-data/delete (routes/activeUsersRoutes.js); both audited.
import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '@/lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Notice, Skeleton, Switch, useConfirm, useToast, IconTrash } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

interface UsageState { enabled: boolean; updatedAt: string | null; rowsWithUsage: number; dailyRows: number; changed?: boolean }
interface DeleteResult extends UsageState { rowsDeleted: number; rowsCleared: number; includeDailyHistory: boolean }

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function UsageTrackingCard({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<UsageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [alsoHistory, setAlsoHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await adminRequest<UsageState>('/api/admin/active-users/usage-tracking'));
      setError(null);
    } catch (e) {
      setError(errText(e, 'Could not load the usage-tracking switch.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (next: boolean) => {
    const ok = await confirm({
      title: next ? 'Turn usage tracking on?' : 'Turn usage tracking off?',
      description: next
        ? 'The customer app starts sending how long each signed-in customer uses it (about once a minute while open). Check the Play Data safety form and the privacy policy mention this before turning it on.'
        : 'The customer app stops sending usage time within a minute or two (no app update needed). Time already recorded stays until you delete it below. Daily "opened today" counts and the streak keep working.',
      confirmLabel: next ? 'Turn on' : 'Turn off',
      tone: next ? 'default' : 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await adminRequest<UsageState>('/api/admin/active-users/usage-tracking', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
      setState(r);
      toast.success(r.enabled ? 'Usage tracking is on.' : 'Usage tracking is off.');
      onChanged();
    } catch (e) {
      toast.error(errText(e, 'Could not change usage tracking.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: alsoHistory ? 'Delete all usage time AND the daily streak history?' : 'Delete all usage-time data?',
      description: alsoHistory
        ? 'Every minute and session recorded, and every "opened on this day" record, is deleted for every customer. The daily target streak starts again from nothing (today is re-counted from each account’s last open after the next restart). This cannot be undone.'
        : 'Every minute and session recorded is deleted for every customer. The "opened on this day" records and the streak are kept. This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
      requireText: 'DELETE',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await adminRequest<DeleteResult>('/api/admin/active-users/usage-data/delete', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'DELETE', includeDailyHistory: alsoHistory }),
      });
      setState(s => (s ? { ...s, rowsWithUsage: r.rowsWithUsage, dailyRows: r.dailyRows } : s));
      toast.success(r.includeDailyHistory ? `Deleted ${r.rowsDeleted} daily records with their usage time.` : `Usage time cleared from ${r.rowsCleared} daily records.`);
      setAlsoHistory(false);
      onChanged();
    } catch (e) {
      toast.error(errText(e, 'Could not delete the usage data.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title={<span className="inline-flex items-center gap-2">Usage tracking {state && <Badge tone={state.enabled ? 'success' : 'neutral'} dot>{state.enabled ? 'ON' : 'OFF'}</Badge>} <Badge tone="warning">closed test only</Badge></span>}
        description="How long each signed-in customer uses the app (minutes and sessions per day). For the closed test only: turn it off and delete the data when ZenWe goes to production."
      />
      <CardBody>
        {error && <Notice tone="danger" className="mb-3" action={<Button size="sm" onClick={load}>Try again</Button>}>{error}</Notice>}
        {!state && loading && <Skeleton className="h-16 w-full" />}
        {state && (
          <div className="space-y-4">
            <Switch
              checked={state.enabled}
              onChange={toggle}
              disabled={busy}
              label={state.enabled ? 'Recording app time' : 'Not recording app time'}
              description={state.updatedAt ? `Last changed ${formatDateTime(state.updatedAt)} IST` : 'On by default'}
            />
            <div className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger-soft/40 p-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 space-y-2">
                <p className="text-sm text-fg">
                  <b className="tabular-nums">{state.rowsWithUsage}</b> daily record{state.rowsWithUsage === 1 ? '' : 's'} hold usage time
                  <span className="text-fg-muted"> · {state.dailyRows} &ldquo;opened on this day&rdquo; record{state.dailyRows === 1 ? '' : 's'} in total</span>
                </p>
                <Checkbox
                  checked={alsoHistory}
                  onChange={e => setAlsoHistory(e.target.checked)}
                  disabled={busy}
                  label="Also delete the daily streak history"
                  description="Off: only minutes and sessions are deleted; the daily target and streak stay."
                />
              </div>
              <Button variant="destructive" leftIcon={<IconTrash size={14} />} loading={busy} disabled={state.rowsWithUsage === 0 && !(alsoHistory && state.dailyRows > 0)} onClick={remove}>
                Delete all usage-time data
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
