"use client";

// Zenvy Campus Events admin (Others → Campus Events in the customer app).
// Backend: /api/admin/campus-events/* (backend/modules/campusEvents, protect + admin; works while the feature is
// off). Live via admin:changed 'campus_event_admin' and the public data:changed 'campus_event'.
// The gate scanner lives at /campus-events/scan.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useLiveSync } from '@/lib/useLiveSync';
import { BUCKETS, campusEventsApi, type BucketKey, type Summary } from '@/lib/campusEventsApi';
import { ErrorBox, StatCard, errText } from '@/components/campusEvents/shared';
import ReviewTab from '@/components/campusEvents/ReviewTab';
import EventsTab from '@/components/campusEvents/EventsTab';
import RegistrationsTab from '@/components/campusEvents/RegistrationsTab';
import OrganizersTab from '@/components/campusEvents/OrganizersTab';
import StaffTab from '@/components/campusEvents/StaffTab';
import ReportsTab from '@/components/campusEvents/ReportsTab';
import SettingsTab from '@/components/campusEvents/SettingsTab';
import AuditTab from '@/components/campusEvents/AuditTab';

type Tab = 'overview' | 'review' | 'events' | 'registrations' | 'organizers' | 'staff' | 'reports' | 'settings' | 'audit';
const TAB_KEYS: Tab[] = ['overview', 'review', 'events', 'registrations', 'organizers', 'staff', 'reports', 'settings', 'audit'];
const LIVE_TYPES = ['campus_event_admin', 'campus_event'];

export default function CampusEventsAdminPage() {
  const { isAuthed } = useAdminAuth();
  const [tab, setTabState] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [tick, setTick] = useState(0);
  const [bucket, setBucket] = useState<BucketKey | ''>('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // ?tab=<id> (links from the overview and search) or the #hash this page writes.
    const h = (new URLSearchParams(window.location.search).get('tab') || window.location.hash.replace('#', '')) as Tab;
    if (TAB_KEYS.includes(h)) setTabState(h);
  }, []);
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try { window.history.replaceState(null, '', `#${t}`); } catch { /* ignore */ }
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; setTick((t) => t + 1); }, 600);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLiveSync(LIVE_TYPES, (events) => {
    if (events.some((e) => e.type === 'campus_event_admin' && e.action === 'created')) setToast('An event was submitted for review');
    bump();
  }, { enabled: isAuthed });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    campusEventsApi.summary()
      .then((s) => { if (alive) { setSummary(s); setSummaryError(''); } })
      .catch((e) => { if (alive) setSummaryError(errText(e, 'Could not load the Campus Events summary.')); });
    return () => { alive = false; };
  }, [isAuthed, tick]);

  const openBucket = useCallback((b: BucketKey) => { setBucket(b); setTab('events'); }, [setTab]);

  if (!isAuthed) return <div className="p-10 text-center text-sm text-fg-muted" role="status">Checking your admin session…</div>;

  const b = summary?.buckets;
  const reviewCount = b ? b.pending_approval + b.changes_pending : undefined;
  const tabs: { key: Tab; label: string; count?: number; alert?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'review', label: 'Review queue', count: reviewCount, alert: true },
    { key: 'events', label: 'Events' },
    { key: 'registrations', label: 'Registrations & payments', count: b?.refunds_pending, alert: true },
    { key: 'organizers', label: 'Organizers', count: b?.organizers_pending },
    { key: 'staff', label: 'Check-in staff' },
    { key: 'reports', label: 'Reports' },
    { key: 'settings', label: 'Settings' },
    { key: 'audit', label: 'Audit' },
  ];
  const sw = summary?.switches;

  return (
    <div className="mx-auto max-w-7xl space-y-6 text-fg">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Events</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Review club and organizer events before students see them, manage registrations, payments and refunds, grant organizer and check-in access, and verify tickets at the gate.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/campus-events/scan" className="bg-accent px-4 py-2 text-sm font-semibold text-on-solid hover:bg-accent-hover">Check-in scanner</Link>
          {sw && (
            <button type="button" onClick={() => setTab('settings')} className={`border px-4 py-2 text-sm font-semibold ${sw.enabled ? 'border-success/30 text-success-text' : 'border-danger/30 text-danger-text'}`}>
              {sw.enabled ? 'Campus Events ON' : 'Campus Events OFF'} · {sw.ticketsReady ? 'tickets ready' : 'tickets NOT configured'}
            </button>
          )}
        </div>
      </header>

      {summaryError && !summary && <div role="alert" className="border border-danger/30 bg-danger-soft p-3 text-sm text-danger-text">{summaryError} Counts are unavailable until it loads.</div>}
      {toast && <div role="status" className="border border-info/30 bg-info-soft p-3 text-sm text-info-text">{toast} · <button type="button" className="font-semibold underline" onClick={() => setTab('review')}>Open review queue</button></div>}

      <nav className="flex flex-wrap gap-2" aria-label="Campus Events sections">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
            className={`border px-4 py-2 text-sm font-semibold ${tab === t.key ? 'border-info/30 bg-info-soft text-fg' : 'border-line text-fg-muted hover:text-fg'}`}>
            {t.label}{t.count ? <span className={`ml-2 px-1.5 text-xs text-fg ${t.alert ? 'bg-danger' : 'bg-accent'}`}>{t.count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <Overview summary={summary} error={summaryError} retry={bump} go={setTab} openBucket={openBucket} />}
      {tab === 'review' && <ReviewTab tick={tick} onChanged={bump} />}
      {tab === 'events' && <EventsTab tick={tick} onChanged={bump} bucket={bucket} setBucket={setBucket} />}
      {tab === 'registrations' && <RegistrationsTab tick={tick} onChanged={bump} />}
      {tab === 'organizers' && <OrganizersTab tick={tick} onChanged={bump} />}
      {tab === 'staff' && <StaffTab tick={tick} onChanged={bump} />}
      {tab === 'reports' && <ReportsTab tick={tick} />}
      {tab === 'settings' && <SettingsTab tick={tick} onChanged={bump} />}
      {tab === 'audit' && <AuditTab tick={tick} />}
    </div>
  );
}

function Overview({ summary: s, error, retry, go, openBucket }: { summary: Summary | null; error: string; retry: () => void; go: (t: Tab) => void; openBucket: (b: BucketKey) => void }) {
  if (!s) return error ? <ErrorBox text={error} retry={retry} /> : <div role="status" className="border border-line p-8 text-sm text-fg-muted">Loading live counts…</div>;
  const b = s.buckets;
  return (
    <section className="space-y-6" aria-label="Overview">
      {!s.switches.enabled && (
        <div className="border border-warning/30 bg-warning-soft p-4 text-sm text-warning-text">
          Campus Events is OFF for students (browse, register, teams and organizer submit are closed). Admin tools, check-in and students&apos; own tickets keep working. <button type="button" className="font-semibold underline" onClick={() => go('settings')}>Settings</button>
        </div>
      )}
      {!s.switches.ticketsReady && (
        <div role="alert" className="border border-danger/30 bg-danger-soft p-4 text-sm text-danger-text">
          CAMPUS_EVENTS_TICKET_SECRET is not set on the server: no tickets can be issued or checked. Set it on Render (32+ random characters) before turning the feature on.
        </div>
      )}
      <div>
        <h2 className="mb-3 text-xs font-semibold text-fg-muted">Events by stage</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {BUCKETS.map((x) => (
            <button key={x.key} type="button" onClick={() => openBucket(x.key)} className="text-left hover:opacity-90" title={`Open ${x.label}`}>
              <StatCard name={x.label} value={b[x.key]} hint={x.hint} tone={x.key === 'pending_approval' && b[x.key] ? 'warn' : x.key === 'cancelled' && b[x.key] ? 'bad' : 'plain'} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-xs font-semibold text-fg-muted">Needs action</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { n: b.pending_approval, t: 'events waiting for approval', tab: 'review' as Tab },
            { n: b.changes_pending, t: 'live events with changes to review', tab: 'review' as Tab },
            { n: b.organizers_pending, t: 'organizer applications', tab: 'organizers' as Tab },
            { n: b.refunds_pending, t: 'refunds pending', tab: 'registrations' as Tab },
            { n: b.venue_due, t: 'confirmed registrations with a fee due at the venue', tab: 'registrations' as Tab },
          ].map((x) => (
            <button key={x.t} type="button" onClick={() => go(x.tab)} className={`border p-4 text-left hover:bg-surface-2/60 ${x.n ? 'border-warning/30' : 'border-line'}`}>
              <span className={`text-2xl font-semibold tabular-nums ${x.n ? 'text-warning-text' : 'text-fg-muted'}`}>{x.n}</span>
              <span className="ml-2 text-sm text-fg-muted">{x.t}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
        <span>Payments: wallet {s.switches.walletEnabled ? 'ON' : 'off'} · online {s.switches.onlinePayEnabled ? (s.switches.razorpayKeysPresent ? 'ON' : 'on but Razorpay keys missing') : 'off'} · pay at venue always available to organizers</span>
      </div>
      <p className="text-xs text-fg-muted">All numbers are counted live from the database and refresh when anything changes.</p>
    </section>
  );
}
