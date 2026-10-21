"use client";
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Notice, SectionTitle, SegmentedControl, StatusPill, Switch, useConfirm,
  type Column, IconRefresh,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminRequest } from '@/lib/api';

/**
 * C2: campus surfaces outside the Friends tab (Google Play UGC policy).
 *  - Kill switches: Campus Whispers and Zenvy After Dark (GET/PUT /api/campus/mod/switches,
 *    GlobalConfig CAMPUS_WHISPERS_ENABLED / AFTER_DARK_ENABLED). Off = the API answers FEATURE_OFF and
 *    the app hides the entry point. Every change is audited (config_update).
 *  - Whisper board: recent anonymous whispers with their moderation state and open reporters, and a
 *    direct Remove / Hide / Restore (POST /api/campus/mod/content/whisper/:id). The author is never
 *    listed here: open the report in the moderation queue and use "Reveal author" (audited) if needed.
 */

type Switches = { whispers: boolean; afterDark: boolean };
interface WhisperRow {
  id: string;
  alias: string;
  topic: string;
  text: string;
  hearts: number;
  createdAt: string;
  status: 'visible' | 'pending_review' | 'hidden' | 'removed';
  openReporters: number;
}

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const SWITCH_INFO: Record<keyof Switches, { label: string; blurb: string }> = {
  whispers: { label: 'Campus Whispers', blurb: 'Anonymous campus board (Pulse > Campus Whispers). Off: list, post and react answer "paused"; the card disappears from the app.' },
  afterDark: { label: 'Zenvy After Dark', blurb: 'Legacy late-night lounge chats and rooms (/api/chat, /api/rooms, after-dark sockets).' },
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  visible: 'success',
  pending_review: 'warning',
  hidden: 'warning',
  removed: 'danger',
};

export default function CampusSafetyPanel() {
  const confirm = useConfirm();
  const [switches, setSwitches] = useState<Switches | null>(null);
  const [rows, setRows] = useState<WhisperRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [sw, list] = await Promise.all([
        adminRequest<{ switches: Switches }>('/api/campus/mod/switches'),
        adminRequest<{ items: WhisperRow[] }>(`/api/campus/mod/whispers?limit=50${filter === 'all' ? '' : `&status=${filter}`}`),
      ]);
      setSwitches(sw.switches);
      setRows(Array.isArray(list.items) ? list.items : []);
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not load campus safety settings.') });
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const flip = async (name: keyof Switches) => {
    if (!switches) return;
    const next = !switches[name];
    if (!next && !(await confirm({ title: `Turn off ${SWITCH_INFO[name].label} for every student?`, description: SWITCH_INFO[name].blurb, confirmLabel: 'Turn off', tone: 'danger' }))) return;
    setBusy(`sw:${name}`);
    try {
      const res = await adminRequest<{ switches: Switches }>('/api/campus/mod/switches', { method: 'PUT', body: JSON.stringify({ [name]: next }) });
      setSwitches(res.switches);
      setNotice({ kind: 'ok', text: `${SWITCH_INFO[name].label} is now ${next ? 'on' : 'off'}. Every server picks it up within about 30 seconds.` });
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not change the switch.') });
    } finally {
      setBusy(null);
    }
  };

  const act = async (row: WhisperRow, action: 'remove' | 'hide' | 'restore') => {
    if (action !== 'restore' && !(await confirm({ title: `${action === 'remove' ? 'Delete' : 'Hide'} this whisper for everyone?`, description: action === 'remove' ? 'It is removed from the board. You can restore it later from this list.' : 'It stays hidden until you restore it.', confirmLabel: action === 'remove' ? 'Delete whisper' : 'Hide whisper', tone: action === 'remove' ? 'danger' : 'default' }))) return;
    setBusy(`w:${row.id}`);
    try {
      const res = await adminRequest<{ status: WhisperRow['status'] }>(`/api/campus/mod/content/whisper/${row.id}`, {
        method: 'POST',
        body: JSON.stringify({ action, reason: 'Admin whisper board' }),
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: res.status } : r)));
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e, 'Could not update the whisper.') });
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<WhisperRow>[] = [
    {
      key: 'text',
      header: 'Whisper',
      cell: r => (
        <div className="max-w-[480px]">
          <p className="text-xs text-fg-muted"><span className="font-medium text-accent-text">{r.alias}</span> · {r.topic}</p>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-fg">{r.text}</p>
        </div>
      ),
    },
    { key: 'hearts', header: 'Hearts', align: 'right', hideBelow: 'lg', sortValue: r => r.hearts, cell: r => <span className="tabular-nums">{r.hearts}</span> },
    { key: 'reports', header: 'Open reports', align: 'right', sortValue: r => r.openReporters, cell: r => (r.openReporters > 0 ? <Badge tone="warning">{r.openReporters}</Badge> : <span className="text-fg-subtle">0</span>) },
    { key: 'status', header: 'Status', sortValue: r => r.status, cell: r => <StatusPill status={r.status} tone={STATUS_TONE[r.status] || 'neutral'} label={humanize(r.status)} /> },
    { key: 'created', header: 'Posted', hideBelow: 'xl', sortValue: r => new Date(r.createdAt), cell: r => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(r.createdAt, { short: true })}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: r => (
        <div className="flex justify-end gap-1">
          {r.status === 'visible' ? (
            <>
              <Button size="sm" variant="ghost" disabled={busy === `w:${r.id}`} onClick={() => act(r, 'hide')}>Hide</Button>
              <Button size="sm" variant="ghost" className="text-danger-text" disabled={busy === `w:${r.id}`} onClick={() => act(r, 'remove')}>Delete</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy === `w:${r.id}`} onClick={() => act(r, 'restore')}>Restore</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Campus safety (outside Friends)"
        description={(
          <>
            Whispers, community posts, lost and found, campus spots, groups, polls and chat are reported into the same{' '}
            <Link href="/moderation" className="text-accent-text hover:underline">moderation queue</Link> (“campus”; chat messages under “chat”).
            They are hidden pending review after 3 different reports; dismissing the reports brings them back.
          </>
        )}
        actions={<Button size="sm" leftIcon={<IconRefresh size={14} />} onClick={load}>Reload</Button>}
      />
      {notice && <div className="border-b border-line px-4 py-3"><Notice tone={notice.kind === 'ok' ? 'success' : 'danger'} onClose={() => setNotice(null)}>{notice.text}</Notice></div>}
      <ul className="divide-y divide-line border-b border-line">
        {(Object.keys(SWITCH_INFO) as (keyof Switches)[]).map((k) => (
          <li key={k} className="px-4 py-3">
            <Switch
              checked={!!switches?.[k]}
              disabled={!switches || busy === `sw:${k}`}
              onChange={() => flip(k)}
              label={SWITCH_INFO[k].label}
              description={SWITCH_INFO[k].blurb}
            />
          </li>
        ))}
      </ul>
      <CardBody>
        <SectionTitle
          title="Recent whispers"
          description="The author is never shown here. Open the report in the moderation queue and use Reveal author (logged) if needed."
          actions={(
            <SegmentedControl
              size="sm"
              ariaLabel="Whisper status"
              value={filter}
              onChange={setFilter}
              options={[{ value: 'all', label: 'All' }, { value: 'visible', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }]}
            />
          )}
        />
        <DataTable
          caption="Recent whispers"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          maxHeight="480px"
          pageSize={0}
          noun="whispers"
          empty={{ title: 'No whispers to show' }}
        />
      </CardBody>
    </Card>
  );
}
