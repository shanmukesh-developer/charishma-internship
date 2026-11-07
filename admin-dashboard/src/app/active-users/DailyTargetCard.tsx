"use client";
// "Today's target: 12+ testers" (owner, 6 Nov 2026): Google Play's closed test wants 12+ testers using the app for
// 14 days. Shows how many testers opened ZenWe today (IST), who has / hasn't yet, Day N of 14, the current streak and
// one cell per day. Refreshes every 60 s. Backend: GET + PUT /api/admin/active-users/daily-target
// (routes/activeUsersRoutes.js, utils/testerDailyTarget.js). Minutes / sessions are closed-test only (utils/usageTime).
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRequest, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Notice, Skeleton, useConfirm, useToast, IconEdit } from '@/components/ui';
import { formatDateTime, formatTime } from '@/lib/format';

interface ActiveTester {
  userId: string;
  name: string | null;
  phoneLast4: string;
  firstAt: string | null;
  lastAt: string | null;
  appVersion: string | null;
  minutesToday: number;
  sessionsToday: number;
}
interface NotYet { name: string | null; phoneLast4: string; status: 'not_opened_today' | 'never_opened' | 'not_signed_up'; lastSeenAt: string | null }
interface DayCount { date: string; activeCount: number; met: boolean; isToday: boolean }
interface PlanCell { date: string; dayNumber: number; activeCount: number | null; state: 'met' | 'missed' | 'today' | 'future' }
export interface DailyTarget {
  now: string;
  target: number;
  streakStart: string;
  goalDays: number;
  settingsUpdatedAt: string | null;
  basis: 'testers' | 'all customers';
  testerCount: number | null;
  today: {
    date: string;
    activeCount: number;
    met: boolean;
    remainingToTarget: number;
    activeTesters: ActiveTester[];
    notYet: NotYet[];
    usage: { totalMinutes: number; avgMinutesPerActiveUser: number; usersWithTime: number };
  };
  days: DayCount[];
  plan: PlanCell[];
  dayNumber: number;
  daysMet: number;
  daysCompleted: number;
  currentStreak: number;
  bestStreak: number;
  usageTracking: { enabled: boolean; updatedAt: string | null };
  changed?: boolean;
}

const REFRESH_MS = 60 * 1000;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
/** 'YYYY-MM-DD' (an IST day) -> "Fri 6 Nov". */
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => {
  const t = new Date(`${d}T12:00:00+05:30`);
  return Number.isNaN(t.getTime()) ? d : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(t);
};
const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`);
const NOT_YET_LABEL: Record<NotYet['status'], string> = {
  not_opened_today: 'not today yet',
  never_opened: 'never opened',
  not_signed_up: 'not signed up',
};

function Cell({ c, target }: { c: PlanCell; target: number }) {
  const look = {
    met: { mark: '✅', cls: 'border-success/40 bg-success-soft text-success-text', word: 'target met' },
    missed: { mark: '❌', cls: 'border-danger/40 bg-danger-soft text-danger-text', word: 'target missed' },
    today: { mark: '•', cls: 'border-accent bg-accent-soft text-accent-text ring-2 ring-accent/30', word: 'today, not met yet' },
    future: { mark: '•', cls: 'border-line bg-surface-2 text-fg-subtle', word: 'to come' },
  }[c.state];
  const count = c.activeCount === null ? '' : `: ${c.activeCount} opened (target ${target})`;
  const title = `Day ${c.dayNumber} · ${dayLabel(c.date)}${count} · ${look.word}`;
  return (
    <li className={`flex min-w-0 flex-col items-center rounded-lg border px-1 py-1.5 ${look.cls}`} title={title} aria-label={title}>
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">D{c.dayNumber}</span>
      <span className="text-base leading-tight" aria-hidden>{look.mark}</span>
      <span className="text-[10px] tabular-nums opacity-80">{c.activeCount === null ? dayLabel(c.date, { day: 'numeric', month: 'short' }) : c.activeCount}</span>
    </li>
  );
}

export default function DailyTargetCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<DailyTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTarget, setDraftTarget] = useState('');
  const [draftStart, setDraftStart] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const req = useRef(0);

  const load = useCallback(async () => {
    const id = ++req.current;
    setLoading(true);
    try {
      const r = await adminRequest<DailyTarget>('/api/admin/active-users/daily-target?days=14');
      if (id !== req.current) return;
      setData(r);
      setError(null);
    } catch (e) {
      if (id !== req.current) return;
      setError(errText(e, 'Could not load today’s target.'));
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, []);

  // Every 60 s while the tab is visible, at once when it becomes visible again, and on the page's Refresh.
  useEffect(() => {
    load();
    const t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') load(); }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [load, refreshKey]);

  const startEdit = () => {
    if (!data) return;
    setDraftTarget(String(data.target));
    setDraftStart(data.streakStart);
    setSaveError(null);
    setEditing(true);
  };

  const targetNum = Number(draftTarget);
  const targetBad = !/^\d{1,3}$/.test(draftTarget.trim()) || targetNum < 1 || targetNum > 500;
  const startBad = !/^\d{4}-\d{2}-\d{2}$/.test(draftStart);

  const save = async () => {
    if (!data || targetBad || startBad) return;
    const changes: string[] = [];
    if (targetNum !== data.target) changes.push(`daily target ${data.target} → ${targetNum}`);
    if (draftStart !== data.streakStart) changes.push(`streak start ${dayLabel(data.streakStart)} → ${dayLabel(draftStart)}`);
    if (!changes.length) { setEditing(false); return; }
    const ok = await confirm({
      title: 'Change the closed-test target?',
      description: `This changes the ${changes.join(' and the ')}. Past days are re-counted against the new values. The change is logged.`,
      confirmLabel: 'Save',
    });
    if (!ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await adminRequest<DailyTarget>('/api/admin/active-users/daily-target?days=14', {
        method: 'PUT',
        body: JSON.stringify({ target: targetNum, streakStart: draftStart, ...(data.settingsUpdatedAt ? { ifUpdatedAt: data.settingsUpdatedAt } : {}) }),
      });
      setData(r);
      setEditing(false);
      toast.success(r.changed === false ? 'No change.' : 'Target saved.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFIG_CONFLICT') load();
      setSaveError(errText(e, 'Could not save the target.'));
    } finally {
      setSaving(false);
    }
  };

  const d = data;
  const t = d?.today;
  const pct = d && t ? Math.min(100, Math.round((t.activeCount / Math.max(1, d.target)) * 100)) : 0;
  const who = d?.basis === 'testers' ? 'testers' : 'customers';

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        title={d ? `Today’s target: ${d.target}+ ${who}` : 'Today’s target'}
        description={d
          ? <>Google Play closed test: {d.target}+ {who} opening ZenWe every day for {d.goalDays} days. {d.basis === 'testers'
            ? <>Counting the {d.testerCount} numbers in Play closed testers below.</>
            : <>No tester numbers saved yet, so every customer counts (admins and owner test accounts left out). Add the tester numbers below to count only them.</>}
            {' '}Days are IST (midnight to midnight). Updates every minute.</>
          : 'Did enough testers use ZenWe today?'}
        actions={d && !editing ? <Button size="sm" leftIcon={<IconEdit size={14} />} onClick={startEdit}>Edit target</Button> : undefined}
      />
      <CardBody>
        {error && <Notice tone="danger" className="mb-3" action={<Button size="sm" onClick={load}>Try again</Button>}>{error}</Notice>}

        {editing && d && (
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface-2 p-3">
            <Field label="Daily target" hint="1 to 500 people a day" error={targetBad ? 'A whole number from 1 to 500' : undefined}>
              <Input value={draftTarget} onChange={e => setDraftTarget(e.target.value)} inputMode="numeric" className="w-28 tabular-nums" invalid={targetBad} aria-label="Daily target" />
            </Field>
            <Field label="Streak starts (IST)" hint="Day 1 of the closed test" error={startBad ? 'Pick a date' : saveError || undefined}>
              <Input type="date" value={draftStart} onChange={e => setDraftStart(e.target.value)} className="w-44" invalid={startBad} aria-label="Streak start date" />
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" loading={saving} disabled={targetBad || startBad} onClick={save}>Save</Button>
              <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {!d && loading && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {d && t && (
          <div className="space-y-5">
            {/* Headline */}
            <div className={`rounded-xl border p-4 ${t.met ? 'border-success/40 bg-success-soft' : 'border-line bg-surface-2'}`}>
              {t.met ? (
                <p className="text-2xl font-semibold text-success-text sm:text-3xl">
                  Target met ✅ <span className="text-fg">— {t.activeCount} opened today</span>
                </p>
              ) : (
                <p className="text-2xl font-semibold text-fg sm:text-3xl">
                  <span className="tabular-nums">{t.activeCount} / {d.target}</span> opened today
                  <span className="text-warning-text"> — {t.remainingToTarget} more needed</span>
                </p>
              )}
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={d.target} aria-valuenow={Math.min(t.activeCount, d.target)} aria-label="Testers today">
                <div className={`h-full rounded-full transition-all ${t.met ? 'bg-success' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-muted">
                <span>{dayLabel(t.date, { weekday: 'long', day: 'numeric', month: 'long' })} IST</span>
                {d.dayNumber > 0
                  ? <span className="font-medium text-fg">Day {Math.min(d.dayNumber, d.goalDays)} of {d.goalDays}{d.dayNumber > d.goalDays ? ` (+${d.dayNumber - d.goalDays})` : ''}</span>
                  : <span>Starts {dayLabel(d.streakStart)}</span>}
                <span>Streak: <b className="text-fg tabular-nums">{d.currentStreak}</b> day{d.currentStreak === 1 ? '' : 's'}{!t.met && d.currentStreak > 0 ? ' (today still open)' : ''}</span>
                <span>Best: <span className="tabular-nums">{d.bestStreak}</span></span>
                <span>Met: <span className="tabular-nums">{d.daysCompleted}</span> of {d.goalDays} days</span>
              </div>
            </div>

            {/* One cell per day */}
            <div>
              <ol className="grid grid-cols-7 gap-1.5 sm:grid-cols-[repeat(14,minmax(0,1fr))]" aria-label={`Days 1 to ${d.goalDays}`}>
                {d.plan.map(c => <Cell key={c.date} c={c} target={d.target} />)}
              </ol>
              <p className="mt-1.5 text-xs text-fg-muted">✅ target met · ❌ missed · • today / to come. Hover a day for its count. Started {dayLabel(d.streakStart)}.</p>
            </div>

            {/* Who */}
            <div className="grid gap-4 md:grid-cols-2">
              <section aria-label="Opened today">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">Opened today <Badge tone="success">{t.activeTesters.length}</Badge></h3>
                {t.activeTesters.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nobody yet today.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {t.activeTesters.map(a => (
                      <li key={a.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-fg">{a.name || 'No name'}</span>
                          <span className="ml-1.5 text-fg-muted tabular-nums">••{a.phoneLast4}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs text-fg-muted tabular-nums">
                          {a.firstAt ? <span title={`First opened ${formatDateTime(a.firstAt)} IST`}>from {formatTime(a.firstAt)}</span> : null}
                          {d.usageTracking.enabled || a.minutesToday > 0 ? <span className="block">{mins(a.minutesToday)} · {a.sessionsToday} session{a.sessionsToday === 1 ? '' : 's'}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-label="Not yet today">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">Not yet today <Badge tone={t.notYet.length ? 'warning' : 'neutral'}>{t.notYet.length}</Badge></h3>
                {d.basis !== 'testers' ? (
                  <p className="text-sm text-fg-muted">Save the tester numbers below to see who hasn&apos;t opened the app yet.</p>
                ) : t.notYet.length === 0 ? (
                  <p className="text-sm text-fg-muted">Every tester has opened ZenWe today.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {t.notYet.map(n => (
                      <li key={`${n.phoneLast4}-${n.status}-${n.name || ''}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-fg">{n.name || 'Not signed up'}</span>
                          <span className="ml-1.5 text-fg-muted tabular-nums">••{n.phoneLast4}</span>
                        </span>
                        <span className="shrink-0 text-xs text-fg-muted" title={n.lastSeenAt ? `Last opened ${formatDateTime(n.lastSeenAt)} IST` : undefined}>
                          {NOT_YET_LABEL[n.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {(d.usageTracking.enabled || t.usage.totalMinutes > 0) && (
              <p className="text-sm text-fg-muted">
                App time today: <b className="text-fg tabular-nums">{mins(t.usage.totalMinutes)}</b> in total
                {t.usage.usersWithTime > 0 ? <> · <b className="text-fg tabular-nums">{mins(t.usage.avgMinutesPerActiveUser)}</b> per person ({t.usage.usersWithTime} with time recorded)</> : null}
                {' '}<Badge tone="neutral" title="Recorded only during the closed test">closed test only</Badge>
              </p>
            )}
            <p className="text-xs text-fg-subtle">Updated {formatTime(d.now)} IST{loading ? ' · refreshing…' : ''}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
