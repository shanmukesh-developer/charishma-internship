"use client";
// Active testers (owner, 6 Nov 2026): is each Play closed tester installed and using the customer app?
// The customer app sends X-App-Name / X-App-Version / X-App-Build on every call; the backend records the last use on
// the account (at most every 10 minutes, utils/appPresence). This page reads it: who opened the app today / this
// week / not for 2+ days / never, on which version, and the owner's closed-tester phone list with each one's status.
// Backend: GET /api/admin/active-users, GET + PUT /api/admin/active-users/testers (routes/activeUsersRoutes.js).
// 'Notify users on older versions': GET + POST /api/admin/app-update/notify (routes/appUpdateRoutes.js).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminRequest, ApiError } from '@/lib/api';
import { useAdminAuth } from '@/utils/useAdminAuth';
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Notice, PageHeader, SearchInput, Select, StatTile, Tabs,
  Textarea, Toolbar, useToast, useConfirm, Input, type Column, type Tone, IconRefresh, IconEdit, IconBell,
} from '@/components/ui';
import { formatDate, formatDateTime, formatPhone, formatRelative } from '@/lib/format';

type Filter = 'all' | 'today' | 'week' | 'inactive2d' | 'never';
type Sort = 'lastSeen_desc' | 'lastSeen_asc' | 'signedUp_desc' | 'signedUp_asc';

interface ActiveUser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastAppVersion: string | null;
  lastAppBuild: string | null;
  lastPlatform: string | null;
  orders: number;
  ownerTestAccount: boolean;
  olderThanLatest: boolean;
}

interface VersionCount { version: string; count: number; isLatest: boolean; olderThanLatest: boolean }

interface ActiveReport {
  now: string;
  trackingStartedAt: string | null;
  latestVersion: string | null;
  latestVersionSource: 'policy' | 'seen' | null;
  summary: { signedUp: number; seenToday: number; seenWeek: number; inactive2d: number; neverSeen: number; seenEver: number };
  versions: VersionCount[];
  filter: Filter;
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  users: ActiveUser[];
}

type TesterStatus = 'today' | 'recent' | 'inactive' | 'never_opened' | 'not_signed_up';
interface TesterRow { phone: string; status: TesterStatus; user: ActiveUser | null }
interface TesterReport {
  phones: string[];
  updatedAt: string | null;
  testers: TesterRow[];
  counts: { total: number; signedUp: number; notSignedUp: number; neverOpened: number; openedToday: number; openedWeek: number; inactive2d: number };
  changed?: boolean;
}

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const SORTS: { value: Sort; label: string }[] = [
  { value: 'lastSeen_desc', label: 'Last opened: newest first' },
  { value: 'lastSeen_asc', label: 'Last opened: oldest first' },
  { value: 'signedUp_desc', label: 'Signed up: newest first' },
  { value: 'signedUp_asc', label: 'Signed up: oldest first' },
];
const TESTER_STATUS: Record<TesterStatus, { label: string; tone: Tone }> = {
  today: { label: 'Opened today', tone: 'success' },
  recent: { label: 'Opened in last 2 days', tone: 'info' },
  inactive: { label: 'Not seen 2+ days', tone: 'warning' },
  never_opened: { label: 'Signed up, not seen yet', tone: 'neutral' },
  not_signed_up: { label: 'Not signed up yet', tone: 'danger' },
};
const TESTER_ORDER: TesterStatus[] = ['not_signed_up', 'never_opened', 'inactive', 'recent', 'today'];

/** Same rules as the server (utils/activeUsers parseTesterPhones): Indian 10-digit mobiles, +91 / 91 / 0 allowed. */
function parsePhones(text: string): { phones: string[]; invalid: string[] } {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\n\r,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    let d = t.replace(/[\s().-]/g, '');
    if (/^\+91\d{10}$/.test(d)) d = d.slice(3);
    else if (/^91\d{10}$/.test(d)) d = d.slice(2);
    else if (/^0\d{10}$/.test(d)) d = d.slice(1);
    if (!/^[6-9]\d{9}$/.test(d)) { invalid.push(t); continue; }
    if (!phones.includes(d)) phones.push(d);
  }
  return { phones, invalid };
}

interface NotifyPreview {
  version: string;
  versionSource: 'policy' | 'given';
  behind: number;
  withDevice: number;
  versions: { version: string; count: number }[];
  lastSent: { sentAt: string; targeted: number | null; sent: number | null } | null;
  title: string;
  body: string;
}
interface NotifyResult { version: string; targeted: number; withDevice: number; devices: number; sent: number; failed: number; resend: boolean }

const STRICT_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/**
 * "Notify users on older versions": one push ("ZenWe update available") to every customer whose last recorded app
 * version is older than the latest (Settings and fees > App versions) or a version typed here. Sent once per version;
 * sending again needs a second, explicit confirmation. Opening it shows the in-app update banner (Play).
 */
function UpdateNotifyCard({ onSent }: { onSent: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [custom, setCustom] = useState('');
  const [preview, setPreview] = useState<NotifyPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const req = useRef(0);

  const typed = custom.trim();
  const typedInvalid = !!typed && !STRICT_VERSION.test(typed);

  const loadPreview = useCallback(async () => {
    if (typedInvalid) return;
    const id = ++req.current;
    setLoading(true);
    try {
      const q = typed ? `?${new URLSearchParams({ version: typed })}` : '';
      const r = await adminRequest<NotifyPreview>(`/api/admin/app-update/notify${q}`);
      if (id !== req.current) return;
      setPreview(r);
      setError(null);
    } catch (e) {
      if (id !== req.current) return;
      setPreview(null);
      setError(errText(e, 'Could not count users on older versions.'));
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, [typed, typedInvalid]);

  useEffect(() => {
    const t = setTimeout(loadPreview, typed ? 400 : 0);
    return () => clearTimeout(t);
  }, [loadPreview, typed]);

  const send = async () => {
    if (!preview) return;
    const n = preview.withDevice;
    const ok = await confirm({
      title: `Notify ${n} user${n === 1 ? '' : 's'} about version ${preview.version}?`,
      description: (
        <span className="block space-y-2">
          <span className="block">Everyone on a version older than {preview.version} with notifications on gets this push once:</span>
          <span className="block rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"><b>{preview.title}</b><br />{preview.body}</span>
          {preview.behind > n && <span className="block text-fg-muted">{preview.behind - n} more on an older version have no device registered for notifications.</span>}
          <span className="block text-fg-muted">Publish {preview.version} on Google Play first: the update only appears in the app once Play offers it.</span>
        </span>
      ),
      confirmLabel: 'Send notification',
    });
    if (!ok) return;
    setSending(true);
    const body = (confirmResend: boolean) => JSON.stringify({ ...(typed ? { minVersion: typed } : {}), ...(confirmResend ? { confirmResend: true } : {}) });
    try {
      let r: NotifyResult;
      try {
        r = await adminRequest<NotifyResult>('/api/admin/app-update/notify', { method: 'POST', body: body(false) });
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'ALREADY_SENT')) throw e;
        const again = await confirm({
          title: `Users were already notified about ${preview.version}`,
          description: preview.lastSent
            ? `Sent ${formatDateTime(preview.lastSent.sentAt)} IST${preview.lastSent.sent !== null ? ` to ${preview.lastSent.sent} device${preview.lastSent.sent === 1 ? '' : 's'}` : ''}. Send the same notification again?`
            : 'Send the same notification again?',
          confirmLabel: 'Send again',
          tone: 'danger',
        });
        if (!again) return;
        r = await adminRequest<NotifyResult>('/api/admin/app-update/notify', { method: 'POST', body: body(true) });
      }
      toast.success(`Version ${r.version}: ${r.targeted} user${r.targeted === 1 ? '' : 's'} on older versions, sent to ${r.sent} of ${r.devices} device${r.devices === 1 ? '' : 's'}.`);
      loadPreview();
      onSent();
    } catch (e) {
      toast.error(errText(e, 'Could not send the notification.'));
    } finally {
      setSending(false);
    }
  };

  const p = preview;
  return (
    <Card className="mb-4">
      <CardHeader
        title="Notify users on older versions"
        description="Sends “ZenWe update available” to customers on an older app version. Tapping it opens ZenWe, which offers the update inside the app (Google Play in-app update)."
      />
      <CardBody>
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            {error && !typedInvalid && <Notice tone="danger" className="mb-3" action={<Button size="sm" onClick={loadPreview}>Try again</Button>}>{error}</Notice>}
            {p && !typedInvalid && (
              <div className="space-y-2">
                <p className="text-sm text-fg">
                  <span className="text-2xl font-semibold tabular-nums">{p.behind}</span>{' '}
                  user{p.behind === 1 ? ' is' : 's are'} on a version older than <span className="font-mono">{p.version}</span>
                  {p.versionSource === 'policy' ? ' (latest in Settings and fees > App versions)' : ''}
                  {p.behind > 0 ? ` · ${p.withDevice} can get notifications` : ''}
                </p>
                {p.versions.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Users behind, per version">
                    {p.versions.map(v => <li key={v.version}><Badge tone="warning"><span className="font-mono">{v.version}</span> · {v.count}</Badge></li>)}
                  </ul>
                )}
                {p.lastSent && (
                  <p className="text-xs text-fg-muted">Already sent for {p.version} on {formatDateTime(p.lastSent.sentAt)} IST{p.lastSent.sent !== null ? ` (${p.lastSent.sent} device${p.lastSent.sent === 1 ? '' : 's'})` : ''}. Sending again asks for confirmation.</p>
                )}
              </div>
            )}
            {loading && !p && <p className="text-sm text-fg-muted">Counting users on older versions…</p>}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Version" optional hint="Empty = latest version" error={typedInvalid ? 'Use x.y.z, for example 1.0.68' : undefined}>
              <Input value={custom} onChange={e => setCustom(e.target.value)} placeholder={p && p.versionSource === 'policy' ? p.version : '1.0.68'} invalid={typedInvalid} className="w-32 font-mono" inputMode="decimal" aria-label="Version to compare against" />
            </Field>
            <Button
              variant="primary"
              leftIcon={<IconBell size={14} />}
              loading={sending}
              disabled={!p || typedInvalid || loading || p.withDevice === 0}
              onClick={send}
            >
              Notify users
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/** "2 h ago" with the exact IST time on hover; "Not seen yet" when empty. */
function When({ at, empty = 'Not seen yet' }: { at: string | null; empty?: string }) {
  if (!at) return <span className="text-fg-subtle">{empty}</span>;
  return <time dateTime={at} title={`${formatDateTime(at)} IST`} className="whitespace-nowrap">{formatRelative(at)}</time>;
}

function VersionCell({ u }: { u: ActiveUser }) {
  if (!u.lastAppVersion) return <span className="text-fg-subtle">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`font-mono text-xs tabular-nums ${u.olderThanLatest ? 'text-warning-text' : 'text-fg'}`}>
        {u.lastAppVersion}{u.lastAppBuild ? ` (${u.lastAppBuild})` : ''}
      </span>
      {u.olderThanLatest && <Badge tone="warning" title="Older than the latest customer app version">old</Badge>}
    </span>
  );
}

function PersonCell({ u }: { u: ActiveUser }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 truncate font-medium text-fg">
        <span className="truncate">{u.name}</span>
        {u.ownerTestAccount && <Badge tone="accent" title="On the owner's test-data viewer list (Config > Test data)">owner test</Badge>}
        {!u.isActive && <Badge tone="danger">suspended</Badge>}
      </p>
      <p className="truncate text-xs text-fg-muted tabular-nums">{formatPhone(u.phone)}{u.email ? ` · ${u.email}` : ''}</p>
    </div>
  );
}

export default function ActiveTestersPage() {
  const { isAuthed } = useAdminAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('lastSeen_desc');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<ActiveReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const [testers, setTesters] = useState<TesterReport | null>(null);
  const [testersError, setTestersError] = useState<string | null>(null);
  const [testersLoading, setTestersLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Search waits for a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ filter, sort, page: String(page), ...(query ? { search: query } : {}) });
      const r = await adminRequest<ActiveReport>(`/api/admin/active-users?${q}`);
      if (id !== reqId.current) return;
      setReport(r);
      setError(null);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(errText(e, 'Could not load active users.'));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [filter, sort, page, query]);

  const loadTesters = useCallback(async () => {
    setTestersLoading(true);
    try {
      const r = await adminRequest<TesterReport>('/api/admin/active-users/testers');
      setTesters(r);
      setTestersError(null);
      if (!r.phones.length) setEditing(true);
    } catch (e) {
      setTestersError(errText(e, 'Could not load the tester list.'));
    } finally {
      setTestersLoading(false);
    }
  }, []);

  useEffect(() => { if (isAuthed) load(); }, [isAuthed, load]);
  useEffect(() => { if (isAuthed) loadTesters(); }, [isAuthed, loadTesters]);

  const refreshAll = () => { load(); loadTesters(); };

  const draftCheck = useMemo(() => parsePhones(draft), [draft]);

  const startEdit = () => {
    setDraft((testers?.phones || []).join('\n'));
    setSaveError(null);
    setEditing(true);
  };

  const saveTesters = async () => {
    if (draftCheck.invalid.length) { setSaveError(`Not a 10-digit Indian mobile number: ${draftCheck.invalid.slice(0, 10).join(', ')}`); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await adminRequest<TesterReport>('/api/admin/active-users/testers', {
        method: 'PUT',
        body: JSON.stringify({ phones: draftCheck.phones, ...(testers?.updatedAt ? { ifUpdatedAt: testers.updatedAt } : {}) }),
      });
      setTesters(r);
      setEditing(false);
      toast.success(r.changed === false ? 'No change to the tester list.' : `Saved ${r.phones.length} tester number${r.phones.length === 1 ? '' : 's'}.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFIG_CONFLICT') loadTesters();
      setSaveError(errText(e, 'Could not save the tester list.'));
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const s = report?.summary;
  const latest = report?.latestVersion;
  const olderCount = (report?.versions || []).filter(v => v.olderThanLatest).reduce((n, v) => n + v.count, 0);

  const tabs = [
    { id: 'all' as Filter, label: 'Everyone', count: s ? s.signedUp : null },
    { id: 'today' as Filter, label: 'Opened today', count: s ? s.seenToday : null },
    { id: 'week' as Filter, label: 'This week', count: s ? s.seenWeek : null },
    { id: 'inactive2d' as Filter, label: 'Not seen 2+ days', count: s ? s.inactive2d : null, attention: !!s && s.inactive2d > 0 },
    { id: 'never' as Filter, label: 'Not seen yet', count: s ? s.neverSeen : null },
  ];

  const columns: Column<ActiveUser>[] = [
    { key: 'person', header: 'Customer', cell: u => <PersonCell u={u} /> },
    { key: 'lastSeen', header: 'Last opened', cell: u => <When at={u.lastSeenAt} /> },
    { key: 'version', header: 'Version', cell: u => <VersionCell u={u} /> },
    { key: 'signedUp', header: 'Signed up', hideBelow: 'md', cell: u => <span className="whitespace-nowrap" title={`${formatDateTime(u.createdAt)} IST`}>{formatDate(u.createdAt)}</span> },
    { key: 'firstSeen', header: 'First opened', hideBelow: 'lg', cell: u => <When at={u.firstSeenAt} empty="–" /> },
    { key: 'orders', header: 'Orders', align: 'right', cell: u => <span className="tabular-nums">{u.orders}</span> },
  ];

  const testerRows = [...(testers?.testers || [])].sort((a, b) => TESTER_ORDER.indexOf(a.status) - TESTER_ORDER.indexOf(b.status));
  const testerColumns: Column<TesterRow>[] = [
    {
      key: 'phone', header: 'Tester',
      cell: t => (
        <div className="min-w-0">
          <p className="font-medium tabular-nums text-fg">{formatPhone(t.phone)}</p>
          {t.user && <p className="truncate text-xs text-fg-muted">{t.user.name}</p>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: t => <Badge tone={TESTER_STATUS[t.status].tone} dot>{TESTER_STATUS[t.status].label}</Badge> },
    { key: 'signedUp', header: 'Signed up?', hideBelow: 'md', cell: t => (t.user ? <span className="whitespace-nowrap" title={`${formatDateTime(t.user.createdAt)} IST`}>Yes, {formatDate(t.user.createdAt)}</span> : <span className="text-fg-subtle">No</span>) },
    { key: 'lastSeen', header: 'Last opened', cell: t => (t.user ? <When at={t.user.lastSeenAt} /> : <span className="text-fg-subtle">–</span>) },
    { key: 'version', header: 'Version', cell: t => (t.user ? <VersionCell u={t.user} /> : <span className="text-fg-subtle">–</span>) },
    { key: 'orders', header: 'Orders', align: 'right', hideBelow: 'lg', cell: t => <span className="tabular-nums">{t.user ? t.user.orders : '–'}</span> },
  ];
  const tc = testers?.counts;

  return (
    <div className="text-fg">
      <PageHeader
        title="Active testers"
        description="Who is using the customer app: when each signed-in account last opened it, on which version, and how your Play closed testers are doing."
        actions={<Button leftIcon={<IconRefresh size={14} />} loading={loading || testersLoading} onClick={refreshAll}>Refresh</Button>}
      />

      <Notice tone="info" className="mb-4">
        {report?.trackingStartedAt
          ? <>Tracking started {formatDateTime(report.trackingStartedAt)} IST. </>
          : <>Tracking starts with the first signed-in app use after this update. </>}
        People who haven&apos;t opened the app since this update show as &lsquo;not seen yet&rsquo;. Only signed-in use of the Android customer app is counted, at most once every 10 minutes.
      </Notice>

      {error && <Notice tone="danger" className="mb-4" action={<Button size="sm" onClick={load}>Try again</Button>}>{error}</Notice>}

      {/* Summary */}
      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
        <StatTile label="Signed up" loading={loading && !s} value={s ? s.signedUp : null} hint={s ? `${s.seenEver} opened the app since tracking started` : undefined} />
        <StatTile label="Opened today" loading={loading && !s} tone="success" value={s ? s.seenToday : null} hint="since midnight IST" />
        <StatTile label="This week" loading={loading && !s} value={s ? s.seenWeek : null} hint="opened in the last 7 days" />
        <StatTile label="Not seen 2+ days" loading={loading && !s} tone={s && s.inactive2d > 0 ? 'warning' : 'neutral'} value={s ? s.inactive2d : null} hint={s ? `${s.neverSeen} not seen yet` : undefined} />
      </section>

      {/* Versions */}
      {report && (
        <Card className="mb-4">
          <CardHeader
            title="App versions in use"
            description={latest
              ? `Latest: ${latest}${report.latestVersionSource === 'policy' ? ' (from Settings and fees > App versions)' : ' (highest version seen)'}${olderCount ? ` · ${olderCount} on an older version` : ''}`
              : 'No app version seen yet.'}
          />
          <CardBody>
            {report.versions.length === 0 ? (
              <p className="text-sm text-fg-muted">Versions appear here once people open the updated app.</p>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label="Accounts per app version">
                {report.versions.map(v => (
                  <li
                    key={v.version}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${v.olderThanLatest
                      ? 'border-warning-text/40 bg-warning-text/10 text-warning-text'
                      : v.isLatest ? 'border-success-text/40 bg-success-text/10 text-success-text' : 'border-line bg-surface-2 text-fg'}`}
                    title={v.olderThanLatest ? 'Older than the latest version' : v.isLatest ? 'Latest version' : undefined}
                  >
                    <span className="font-mono">{v.version}</span>
                    <span className="font-semibold tabular-nums">{v.count}</span>
                    {v.olderThanLatest && <span className="text-xs">older</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {/* 'ZenWe update available' push */}
      <UpdateNotifyCard onSent={load} />

      {/* Closed testers */}
      <Card className="mb-4">
        <CardHeader
          title="Play closed testers"
          description="Play Console lists testers by email only, so paste the phone numbers they sign in with. Each number shows whether that tester signed up and when they last opened the app."
          actions={!editing && testers ? <Button size="sm" leftIcon={<IconEdit size={14} />} onClick={startEdit}>{testers.phones.length ? 'Edit numbers' : 'Add numbers'}</Button> : undefined}
        />
        <CardBody>
          {testersError && <Notice tone="danger" className="mb-3" action={<Button size="sm" onClick={loadTesters}>Try again</Button>}>{testersError}</Notice>}

          {editing && (
            <div className="mb-4 space-y-3">
              <Field
                label="Tester phone numbers"
                hint={`One per line or comma separated. 10-digit Indian mobiles; +91 is fine. ${draftCheck.phones.length} valid${draftCheck.invalid.length ? `, ${draftCheck.invalid.length} not valid` : ''}.`}
                error={saveError || (draftCheck.invalid.length ? `Not a 10-digit Indian mobile number: ${draftCheck.invalid.slice(0, 10).join(', ')}${draftCheck.invalid.length > 10 ? ' …' : ''}` : undefined)}
              >
                <Textarea rows={6} value={draft} onChange={e => setDraft(e.target.value)} placeholder={'98765 43210\n+91 91234 56789'} invalid={draftCheck.invalid.length > 0} className="font-mono" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={saving} disabled={draftCheck.invalid.length > 0} onClick={saveTesters}>Save list</Button>
                {testers && testers.phones.length > 0 && <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>}
              </div>
            </div>
          )}

          {tc && tc.total > 0 && (
            <div className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Tester summary">
              <Badge tone="neutral">{tc.total} testers</Badge>
              <Badge tone="success">{tc.signedUp} signed up</Badge>
              {tc.notSignedUp > 0 && <Badge tone="danger">{tc.notSignedUp} not signed up yet</Badge>}
              <Badge tone="success">{tc.openedToday} opened today</Badge>
              <Badge tone="info">{tc.openedWeek} this week</Badge>
              {tc.inactive2d > 0 && <Badge tone="warning">{tc.inactive2d} not seen 2+ days</Badge>}
              {tc.neverOpened > 0 && <Badge tone="neutral">{tc.neverOpened} signed up, not seen yet</Badge>}
            </div>
          )}

          {(testersLoading || (testers && testers.phones.length > 0)) && (
            <DataTable
              caption="Play closed testers"
              columns={testerColumns}
              rows={testerRows}
              rowKey={t => t.phone}
              loading={testersLoading && !testers}
              pageSize={50}
              noun="testers"
              maxHeight="none"
              dense
              empty={{ title: 'No tester numbers yet' }}
            />
          )}
          {!testersLoading && testers && testers.phones.length === 0 && !editing && (
            <p className="text-sm text-fg-muted">No tester numbers saved yet.</p>
          )}
        </CardBody>
      </Card>

      {/* Everyone */}
      <section className="mb-6" aria-label="Customers">
        <h2 className="mb-2 text-base font-semibold text-fg">Customers</h2>
        <Tabs ariaLabel="Filter customers" value={filter} onChange={f => { setFilter(f); setPage(1); }} tabs={tabs} className="mb-3" />
        <Toolbar end={(
          <Select aria-label="Sort" className="w-60" value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(1); }}>
            {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        )}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone or email" className="sm:w-80" />
        </Toolbar>
        <DataTable
          caption="Customers by last app use"
          columns={columns}
          rows={report?.users || []}
          rowKey={u => u.id}
          loading={loading && !report}
          error={!report ? error : null}
          onRetry={load}
          noun="customers"
          maxHeight="none"
          resetPageKey={`${filter}|${sort}|${query}`}
          pagination={report ? { page: report.page, pages: report.pages, total: report.total, pageSize: report.pageSize, onPage: setPage } : undefined}
          rowClassName={u => (u.olderThanLatest ? 'bg-warning-text/5' : undefined)}
          empty={{
            title: query ? 'No one matches that search' : filter === 'today' ? 'No one has opened the app today yet' : filter === 'never' ? 'Everyone has opened the app since tracking started' : 'No customers here',
            description: filter === 'all' && !query ? 'Accounts appear here as people sign up.' : undefined,
          }}
        />
      </section>
    </div>
  );
}
