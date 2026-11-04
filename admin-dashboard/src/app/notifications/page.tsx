"use client";
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { adminRequest as apiRequest } from '@/lib/api';
import {
  Badge, Button, Card, CardHeader, DataTable, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, useConfirm,
  type Column, IconRefresh, IconUsers,
} from '@/components/ui';
import { formatDateTime, formatNumber, humanize } from '@/lib/format';

const CATEGORIES = [
  { value: 'announcement', label: 'Announcement' },
  { value: 'service_update', label: 'Service update' },
  { value: 'offer', label: 'Offer' },
  { value: 'safety', label: 'Safety alert' },
];

const TITLE_MAX = 65;
const BODY_MAX = 240;

interface Audience { students: number; devices: number; campusWide: boolean }
interface Broadcast {
  id: string; sentAt: string; sentBy: string | null; title: string; body: string;
  targetBlock: string | null; category: string | null; students: number | null; devices: number | null;
}

export default function NotificationsPage() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetBlock, setTargetBlock] = useState('');
  const [category, setCategory] = useState('announcement');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // Recipients for the current audience (GET /api/admin/broadcast-push/preview: counted, nothing sent).
  const [audience, setAudience] = useState<Audience | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Known hostel block names come from the server (same list the block leaderboard uses).
  useEffect(() => {
    if (!isAuthed) return;
    apiRequest<{ name: string }[]>('/api/blocks/activity')
      .then(rows => setBlocks(Array.isArray(rows) ? rows.map(r => r.name).filter(Boolean) : []))
      .catch(() => setBlocks([]));
  }, [isAuthed]);

  const trimmedBlock = targetBlock.trim();
  const audienceLabel = trimmedBlock ? `students in ${trimmedBlock}` : 'all active users';

  useEffect(() => {
    if (!isAuthed) return;
    setAudienceLoading(true);
    const t = setTimeout(() => {
      apiRequest<Audience>(`/api/admin/broadcast-push/preview${trimmedBlock ? `?targetBlock=${encodeURIComponent(trimmedBlock)}` : ''}`)
        .then(setAudience)
        .catch(() => setAudience(null)) // older server: the count is simply not shown
        .finally(() => setAudienceLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [isAuthed, trimmedBlock]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const d = await apiRequest<{ broadcasts?: Broadcast[] }>('/api/admin/broadcast-push/history?limit=100');
      setHistory(Array.isArray(d?.broadcasts) ? d.broadcasts : []);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Could not load the history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);
  useEffect(() => { if (isAuthed) loadHistory(); }, [isAuthed, loadHistory]);

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setStatus({ type: 'error', message: 'Title and message are both required.' });
      return;
    }
    if (t.length > TITLE_MAX || b.length > BODY_MAX) {
      setStatus({ type: 'error', message: `Keep the title under ${TITLE_MAX} and the message under ${BODY_MAX} characters.` });
      return;
    }
    const reach = audience ? ` It reaches ${formatNumber(audience.students)} ${audience.students === 1 ? 'student' : 'students'} on ${formatNumber(audience.devices)} ${audience.devices === 1 ? 'device' : 'devices'}${audience.campusWide ? ', plus phones subscribed to campus-wide alerts' : ''}.` : '';
    if (!(await confirm({ title: `Send this push notification to ${audienceLabel}?`, description: `It cannot be recalled once sent.${reach}`, confirmLabel: 'Send notification' }))) return;

    setSending(true);
    setStatus(null);
    try {
      const res = await apiRequest<{ message?: string }>('/api/admin/broadcast-push', {
        method: 'POST',
        body: JSON.stringify({
          title: t,
          body: b,
          targetBlock: trimmedBlock || undefined,
          category,
        }),
      });
      setStatus({ type: 'success', message: res?.message || 'Broadcast sent.' });
      setTitle('');
      setBody('');
      loadHistory();
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Could not send the broadcast.' });
    } finally {
      setSending(false);
    }
  };

  const columns: Column<Broadcast>[] = [
    { key: 'sent', header: 'Sent', width: '170px', sortValue: b => new Date(b.sentAt), cell: b => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(b.sentAt, { short: true })}</span> },
    {
      key: 'message',
      header: 'Notification',
      cell: b => (
        <div className="min-w-0 max-w-[460px]">
          <p className="truncate font-medium text-fg">{b.title || '–'}</p>
          <p className="line-clamp-2 text-xs text-fg-muted">{b.body}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', hideBelow: 'xl', cell: b => <span className="text-fg-muted">{b.category ? (CATEGORIES.find(c => c.value === b.category)?.label || humanize(b.category)) : '–'}</span> },
    { key: 'to', header: 'To', sortValue: b => b.targetBlock || '', cell: b => <span className="text-fg">{b.targetBlock || 'Everyone'}</span> },
    { key: 'reach', header: 'Reached', align: 'right', hideBelow: 'lg', sortValue: b => b.students ?? -1, cell: b => (b.students === null ? <span className="text-fg-subtle">–</span> : <span className="tabular-nums">{formatNumber(b.students)} students{b.devices !== null ? `, ${formatNumber(b.devices)} devices` : ''}</span>) },
    { key: 'by', header: 'Sent by', hideBelow: 'xl', cell: b => <span className="text-fg-muted">{b.sentBy || '–'}</span> },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Push notifications"
        description="Send a push notification to students. It is also saved in each recipient’s in-app notification list."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form onSubmit={handleSendNotification} className="space-y-5 p-5" noValidate>
            {status && <Notice tone={status.type === 'success' ? 'success' : 'danger'} onClose={() => setStatus(null)}><span className="text-fg">{status.message}</span></Notice>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Hostel block" optional hint="Matches the hostel block on the student’s profile exactly. Leave empty for everyone.">
                <Input id="target-block" list="known-blocks" placeholder="Everyone" value={targetBlock} onChange={(e) => setTargetBlock(e.target.value)} />
              </Field>
              <datalist id="known-blocks">{blocks.map(b => <option key={b} value={b} />)}</datalist>
              <Field label="Category">
                <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Title" labelAction={<span className={`text-xs tabular-nums ${title.length > TITLE_MAX ? 'text-danger-text' : 'text-fg-subtle'}`}>{title.length}/{TITLE_MAX}</span>} error={title.length > TITLE_MAX ? `Keep it under ${TITLE_MAX} characters.` : undefined}>
              <Input id="title" placeholder="For example, Mess delivery delayed tonight" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Message" labelAction={<span className={`text-xs tabular-nums ${body.length > BODY_MAX ? 'text-danger-text' : 'text-fg-subtle'}`}>{body.length}/{BODY_MAX}</span>} error={body.length > BODY_MAX ? `Keep it under ${BODY_MAX} characters.` : undefined}>
              <Textarea id="body" rows={4} placeholder="Say what happened and what students should do." value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div className="flex items-center gap-2 text-sm text-fg-muted" aria-live="polite">
                <IconUsers size={16} className="text-fg-subtle" />
                {audienceLoading && !audience ? <Skeleton className="h-4 w-40" /> : audience ? (
                  <span>
                    Reaches <span className="font-medium text-fg tabular-nums">{formatNumber(audience.students)}</span> {audience.students === 1 ? 'student' : 'students'} on <span className="font-medium text-fg tabular-nums">{formatNumber(audience.devices)}</span> {audience.devices === 1 ? 'device' : 'devices'}
                    {audience.campusWide ? ', plus campus-wide subscribers' : ''}
                  </span>
                ) : <span>Recipient count unavailable</span>}
                {audience && !audience.campusWide && audience.students === 0 && <Badge tone="warning">No students in this block</Badge>}
              </div>
              <Button type="submit" variant="primary" loading={sending} disabled={!title.trim() || !body.trim() || (!!audience && !audience.campusWide && audience.students === 0)}>
                {sending ? 'Sending…' : 'Send notification'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Preview" />
            <div className="p-4">
              <div className="rounded-lg border border-line bg-surface-2/50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-medium text-fg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/zenwe-favicon-2026-11-04.png" alt="" width={20} height={20} className="h-5 w-5 rounded-full" aria-hidden />ZenWe
                  </span>
                  <span className="text-xs text-fg-subtle">now</span>
                </div>
                <p className="break-words text-sm font-medium text-fg">{title || 'Notification title'}</p>
                <p className="line-clamp-3 break-words text-sm text-fg-muted">{body || 'Your message appears here.'}</p>
              </div>
              <p className="mt-2 text-xs text-fg-muted">To: {trimmedBlock || 'Everyone'}</p>
            </div>
          </Card>
          <Notice tone="info" title="What sending does">
            A push to the devices of every matching active student, an entry in their in-app notification list, and a live banner for those who have the app open.
            {trimmedBlock ? ' A block-targeted message goes only to students in that block.' : ' Campus-wide messages also reach phones subscribed to campus-wide alerts.'}
          </Notice>
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">Sent notifications</h2>
            <p className="mt-0.5 text-sm text-fg-muted">Every broadcast sent from this page, newest first.</p>
          </div>
          <Button leftIcon={<IconRefresh size={14} />} loading={historyLoading} onClick={loadHistory}>Refresh</Button>
        </div>
        <DataTable
          caption="Sent notifications"
          columns={columns}
          rows={history}
          rowKey={b => b.id}
          loading={historyLoading}
          error={historyError}
          onRetry={loadHistory}
          noun="notifications"
          initialSort={{ key: 'sent', dir: 'desc' }}
          empty={{ title: 'Nothing sent yet', description: 'Broadcasts appear here after they are sent.' }}
        />
      </section>
    </div>
  );
}

