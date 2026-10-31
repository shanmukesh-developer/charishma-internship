"use client";
// Colleges ZCS serves (owner, 31 Oct 2026): each is Open (students order), Paused (they see their college, ordering
// is paused) or Coming soon (shown as "Soon", nobody can pick it yet). Stores choose their colleges in the store
// form ("Visible to colleges"); a store with none ticked serves every college. backend/utils/campuses.js;
// GET /api/admin/campuses, PUT /api/admin/campuses/:key (audited).
import {
  Badge, Card, CardBody, CardHeader, LoadingState, Notice, SegmentedControl, useConfirm,
} from '@/components/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { adminRequest as apiRequest } from '@/lib/api';

type Status = 'open' | 'paused' | 'soon';
interface College { key: string; label: string; name: string; status: Status; stores: number }

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'paused', label: 'Paused' },
  { value: 'soon', label: 'Coming soon' },
];
const STATUS_WORDS: Record<Status, string> = {
  open: 'Students of this college can order.',
  paused: 'Students see their college, but ordering is paused until you open it again.',
  soon: 'Shown as "Soon" in the app; nobody can pick it or order for it yet.',
};

export default function CollegesCard() {
  const confirm = useConfirm();
  const [colleges, setColleges] = useState<College[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await apiRequest<{ campuses: College[] }>('/api/admin/campuses');
      setColleges(d.campuses);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the colleges.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const change = async (c: College, status: Status) => {
    if (savingKey || status === c.status) return;
    setMsg(null);
    const ok = await confirm({
      title: status === 'open' ? `Open ordering at ${c.label}?` : status === 'paused' ? `Pause ordering at ${c.label}?` : `Mark ${c.label} as coming soon?`,
      description: STATUS_WORDS[status],
      confirmLabel: status === 'open' ? 'Open ordering' : status === 'paused' ? 'Pause ordering' : 'Mark coming soon',
      tone: status === 'open' ? undefined : 'danger',
    });
    if (!ok) return;
    setSavingKey(c.key);
    try {
      await apiRequest(`/api/admin/campuses/${encodeURIComponent(c.key)}`, { method: 'PUT', body: JSON.stringify({ status }) });
      setMsg({ kind: 'ok', text: `${c.label}: ${STATUS_OPTIONS.find(o => o.value === status)?.label}. Phones pick it up within a minute.` });
      await load();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Could not save the college setting.' });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Colleges"
        description="Which colleges can order. Each store picks its colleges in its store form (Visible to colleges); a store with none ticked serves every college."
      />
      <CardBody className="space-y-4">
        {loadError && <Notice tone="danger">{loadError}</Notice>}
        {!colleges && !loadError && <LoadingState label="Loading colleges…" />}
        {colleges && (
          <ul className="divide-y divide-line">
            {colleges.map(c => (
              <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    {c.label} <span className="ml-1 text-xs font-normal text-fg-muted">{c.name}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    <Badge tone={c.status === 'open' ? 'success' : c.status === 'paused' ? 'warning' : 'neutral'}>{STATUS_OPTIONS.find(o => o.value === c.status)?.label}</Badge>
                    <span className="ml-2">{c.stores} store{c.stores === 1 ? '' : 's'} serve this college</span>
                  </p>
                </div>
                <SegmentedControl<Status>
                  ariaLabel={`${c.label} ordering`}
                  size="sm"
                  options={STATUS_OPTIONS}
                  value={c.status}
                  onChange={(v) => change(c, v)}
                />
              </li>
            ))}
          </ul>
        )}
        {msg && <p className={msg.kind === 'ok' ? 'text-sm text-success-text' : 'text-sm text-danger-text'}>{msg.text}</p>}
        {savingKey && <p className="text-xs text-fg-muted">Saving…</p>}
      </CardBody>
    </Card>
  );
}
