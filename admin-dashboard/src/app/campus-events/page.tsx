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
import { Badge, Button, ButtonLink, LoadingState, Notice as NoticeBox, PageHeader, SectionTitle, Tabs, IconChevronRight, IconScan } from '@/components/ui';
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

  if (!isAuthed) return null; // AppShell shows the session check

  const b = summary?.buckets;
  const reviewCount = b ? b.pending_approval + b.changes_pending : undefined;
  const tabs: { key: Tab; label: string; count?: number; alert?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'review', label: 'Review queue', count: reviewCount, alert: true },
    { key: 'events', label: 'Events' },
    { key: 'registrations', label: 'Registrations and payments', count: b?.refunds_pending, alert: true },
    { key: 'organizers', label: 'Organisers', count: b?.organizers_pending, alert: true },
    { key: 'staff', label: 'Check-in staff' },
    { key: 'reports', label: 'Reports' },
    { key: 'settings', label: 'Settings' },
    { key: 'audit', label: 'Audit' },
  ];
  const sw = summary?.switches;

  return (
    <div className="text-fg">
      <PageHeader
        title="Events"
        description="Review club and organiser events before students see them, manage registrations, payments and refunds, grant organiser and check-in access, and verify tickets at the gate."
        meta={sw ? <Badge tone={sw.enabled ? 'success' : 'neutral'} dot>{sw.enabled ? 'On for students' : 'Off for students'}</Badge> : undefined}
        actions={
          <>
            {sw && <Button onClick={() => setTab('settings')}>Settings</Button>}
            <ButtonLink href="/campus-events/scan" variant="primary" leftIcon={<IconScan size={14} />}>Check-in scanner</ButtonLink>
          </>
        }
      >
        <Tabs ariaLabel="Events sections" value={tab} onChange={setTab} tabs={tabs.map(t => ({ id: t.key, label: t.label, count: t.count || null, attention: !!t.alert }))} />
      </PageHeader>

      <div className="space-y-4">
        {summaryError && !summary && <NoticeBox tone="danger"><span className="text-fg">{summaryError} Counts are unavailable until it loads.</span></NoticeBox>}
        {toast && <NoticeBox tone="info" action={<Button size="sm" onClick={() => setTab('review')}>Open review queue</Button>}><span className="text-fg">{toast}</span></NoticeBox>}

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
    </div>
  );
}

function Overview({ summary: s, error, retry, go, openBucket }: { summary: Summary | null; error: string; retry: () => void; go: (t: Tab) => void; openBucket: (b: BucketKey) => void }) {
  if (!s) return error ? <ErrorBox text={error} retry={retry} /> : <LoadingState label="Loading live counts…" />;
  const b = s.buckets;
  const actions = [
    { n: b.pending_approval, t: 'Events waiting for approval', tab: 'review' as Tab },
    { n: b.changes_pending, t: 'Live events with changes to review', tab: 'review' as Tab },
    { n: b.organizers_pending, t: 'Organiser applications', tab: 'organizers' as Tab },
    { n: b.refunds_pending, t: 'Refunds pending', tab: 'registrations' as Tab },
    { n: b.venue_due, t: 'Confirmed registrations with a fee due at the venue', tab: 'registrations' as Tab },
  ];
  return (
    <section className="space-y-6" aria-label="Overview">
      {!s.switches.enabled && (
        <NoticeBox tone="warning" title="Events are off for students" action={<Button size="sm" onClick={() => go('settings')}>Open settings</Button>}>
          Browsing, registration, teams and organiser submissions are closed. Admin tools, check-in and students’ own tickets keep working.
        </NoticeBox>
      )}
      {!s.switches.ticketsReady && (
        <NoticeBox tone="danger" title="Tickets are not configured">
          CAMPUS_EVENTS_TICKET_SECRET is not set on the server, so no tickets can be issued or checked. Set it on Render (32 or more random characters) before turning events on.
        </NoticeBox>
      )}
      <div>
        <SectionTitle title="Needs action" />
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-xs">
          {actions.map((x) => (
            <li key={x.t}>
              <button type="button" onClick={() => go(x.tab)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/70">
                <span className={`h-2 w-2 rounded-full ${x.n ? 'bg-warning' : 'bg-line-strong'}`} aria-hidden />
                <span className="flex-1 text-sm text-fg">{x.t}</span>
                <span className={`text-base font-semibold tabular-nums ${x.n ? 'text-fg' : 'text-fg-subtle'}`}>{x.n}</span>
                <IconChevronRight size={14} className="text-fg-subtle" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SectionTitle title="Events by stage" description="Select a stage to see its events. Counted live from the database." />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {BUCKETS.map((x) => (
            <button key={x.key} type="button" onClick={() => openBucket(x.key)} className="rounded-lg text-left transition-colors [&>*]:hover:border-line-strong" title={`Open ${x.label}`}>
              <StatCard name={x.label} value={b[x.key]} hint={x.hint} tone={x.key === 'pending_approval' && b[x.key] ? 'warn' : x.key === 'cancelled' && b[x.key] ? 'bad' : 'plain'} />
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-fg-muted">
        Payments: wallet {s.switches.walletEnabled ? 'on' : 'off'} · online {s.switches.onlinePayEnabled ? (s.switches.razorpayKeysPresent ? 'on' : 'on, but Razorpay keys are missing') : 'off'} · pay at the venue is always available to organisers.
      </p>
    </section>
  );
}
