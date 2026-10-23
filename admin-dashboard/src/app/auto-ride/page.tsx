"use client";

// Zenvy Auto-Ride admin (shared autos, seat booking, separate Zenvy Auto Driver app).
// Backend: /api/admin/auto-ride/* (backend/modules/autoRide, protect + admin). Live via admin:changed
// (auto_driver, auto_vehicle, auto_route, auto_booking, auto_private_request, auto_incident, auto_trip)
// and the public data:changed auto_trip event.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useLiveSync } from '@/lib/useLiveSync';
import { autoRideApi, type Summary } from '@/lib/autoRideApi';
import { useLookups } from '@/components/autoRide/hooks';
import { ErrorBox, StatCard, errText } from '@/components/autoRide/ui';
import { Badge, Button, LoadingState, Notice as NoticeBox, PageHeader, SectionTitle, Tabs, IconChevronRight } from '@/components/ui';
import DriversTab from '@/components/autoRide/DriversTab';
import VehiclesTab from '@/components/autoRide/VehiclesTab';
import RoutesTab from '@/components/autoRide/RoutesTab';
import LinesTab from '@/components/autoRide/LinesTab';
import TripsTab from '@/components/autoRide/TripsTab';
import BookingsTab from '@/components/autoRide/BookingsTab';
import SettingsTab from '@/components/autoRide/SettingsTab';
import { AuditTab, FaresTab, IncidentsTab, PrivateTab } from '@/components/autoRide/MiscTabs';

type Tab = 'overview' | 'lines' | 'drivers' | 'vehicles' | 'routes' | 'trips' | 'bookings' | 'private' | 'incidents' | 'fares' | 'settings' | 'audit';
const LIVE_TYPES = ['auto_driver', 'auto_vehicle', 'auto_route', 'auto_booking', 'auto_private_request', 'auto_incident', 'auto_trip'];
const TAB_KEYS: Tab[] = ['overview', 'lines', 'drivers', 'vehicles', 'routes', 'trips', 'bookings', 'private', 'incidents', 'fares', 'settings', 'audit'];

export default function AutoRideAdminPage() {
  const { isAuthed } = useAdminAuth();
  const [tab, setTabState] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [vehicleFocus, setVehicleFocus] = useState<string | null>(null);
  const lookups = useLookups(tick, isAuthed);

  // Remember the tab in the URL hash (#drivers) so a refresh / shared link lands on the same section.
  useEffect(() => {
    // ?tab=<id> (links from the overview and search) or the #hash this page writes.
    const h = (new URLSearchParams(window.location.search).get('tab') || window.location.hash.replace('#', '')) as Tab;
    if (TAB_KEYS.includes(h)) setTabState(h);
  }, []);
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try { window.history.replaceState(null, '', `#${t}`); } catch { /* ignore */ }
  }, []);

  // Live: any Auto-Ride change reloads quietly (coalesced).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; setTick((t) => t + 1); }, 600);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLiveSync(LIVE_TYPES, (events) => {
    if (events.some((e) => e.type === 'auto_incident' && e.action === 'created')) setToast('New Auto-Ride incident report');
    bump();
  }, { enabled: isAuthed });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    autoRideApi.summary()
      .then((s) => { if (alive) { setSummary(s); setSummaryError(''); } })
      .catch((e) => { if (alive) setSummaryError(errText(e, 'Could not load the Auto-Ride summary.')); });
    return () => { alive = false; };
  }, [isAuthed, tick]);

  const openVehicle = useCallback((id: string) => { setVehicleFocus(id); setTab('vehicles'); }, [setTab]);
  const clearFocus = useCallback(() => setVehicleFocus(null), []);

  if (!isAuthed) return null; // AppShell shows the session check

  const tabs: { key: Tab; label: string; count?: number; alert?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'lines', label: 'Live lines' },
    { key: 'drivers', label: 'Drivers', count: summary?.pendingDrivers, alert: true },
    { key: 'vehicles', label: 'Vehicles', count: summary?.pendingVehicles, alert: true },
    { key: 'routes', label: 'Routes and pickup points' },
    { key: 'trips', label: 'Trips and queues', count: summary?.openTrips },
    { key: 'bookings', label: 'Bookings', count: summary?.refundPending, alert: true },
    { key: 'private', label: 'Private requests', count: summary?.privateAwaiting, alert: true },
    { key: 'incidents', label: 'Incidents', count: summary?.openIncidents, alert: true },
    { key: 'fares', label: 'Fares' },
    { key: 'settings', label: 'Settings' },
    { key: 'audit', label: 'Audit' },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Auto-ride"
        description="Shared autos with seat booking: verify drivers and their autos, manage routes and pickup points, watch trips, and handle bookings, refunds and safety reports."
        meta={summary ? <Badge tone={summary.enabled ? 'success' : 'neutral'} dot>{summary.enabled ? 'On for passengers' : 'Off for passengers'}{summary.walletEnabled ? ', wallet on' : ', cash only'}</Badge> : undefined}
        actions={summary ? <Button onClick={() => setTab('settings')}>Settings</Button> : undefined}
      >
        <Tabs ariaLabel="Auto-ride sections" value={tab} onChange={setTab} tabs={tabs.map(t => ({ id: t.key, label: t.label, count: t.count || null, attention: !!t.alert }))} />
      </PageHeader>

      <div className="space-y-4">
        {summaryError && !summary && <NoticeBox tone="danger"><span className="text-fg">{summaryError} Counts are unavailable until it loads.</span></NoticeBox>}
        {toast && <NoticeBox tone="danger" action={<Button size="sm" onClick={() => setTab('incidents')}>Open incidents</Button>}><span className="text-fg">{toast}</span></NoticeBox>}

        {tab === 'overview' && <Overview summary={summary} error={summaryError} retry={bump} go={setTab} />}
        {tab === 'lines' && <LinesTab tick={tick} go={() => setTab('routes')} />}
        {tab === 'drivers' && <DriversTab tick={tick} onChanged={bump} openVehicle={openVehicle} />}
        {tab === 'vehicles' && <VehiclesTab tick={tick} onChanged={bump} lookups={lookups} focusId={vehicleFocus} clearFocus={clearFocus} />}
        {tab === 'routes' && <RoutesTab tick={tick} onChanged={bump} />}
        {tab === 'trips' && <TripsTab tick={tick} onChanged={bump} lookups={lookups} />}
        {tab === 'bookings' && <BookingsTab tick={tick} onChanged={bump} lookups={lookups} />}
        {tab === 'private' && <PrivateTab tick={tick} lookups={lookups} />}
        {tab === 'incidents' && <IncidentsTab tick={tick} onChanged={bump} />}
        {tab === 'fares' && <FaresTab tick={tick} lookups={lookups} />}
        {tab === 'settings' && <SettingsTab tick={tick} onChanged={bump} />}
        {tab === 'audit' && <AuditTab tick={tick} />}
      </div>
    </div>
  );
}

function Overview({ summary: s, error, retry, go }: { summary: Summary | null; error: string; retry: () => void; go: (t: Tab) => void }) {
  if (!s) return error ? <ErrorBox text={error} retry={retry} /> : <LoadingState label="Loading live counts…" />;
  const actions = [
    { n: s.pendingDrivers, t: 'Drivers waiting for verification', tab: 'drivers' as Tab },
    { n: s.pendingVehicles, t: 'Autos waiting for approval', tab: 'vehicles' as Tab },
    { n: s.refundPending, t: 'Refunds pending (retry in Bookings)', tab: 'bookings' as Tab },
  ];
  return (
    <section className="space-y-6" aria-label="Overview">
      {!s.enabled && (
        <NoticeBox tone="warning" title="Auto-ride is off for passengers" action={<Button size="sm" onClick={() => go('settings')}>Open settings</Button>}>
          Turn it on only after the legal checks: permits, insurance and driver documents.
        </NoticeBox>
      )}
      <div>
        <SectionTitle title="Needs action" />
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-xs">
          {actions.map((x) => (
            <li key={x.tab}>
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
        <SectionTitle title="Right now" description="Counted live from the database; refreshes when anything changes." />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard name="Online verified autos" value={s.onlineVerifiedDrivers} tone={s.onlineVerifiedDrivers ? 'good' : 'plain'} hint="Verified drivers currently online" />
          <StatCard name="Open trips" value={s.openTrips} hint="Accepting seat bookings" />
          <StatCard name="Booked seats" value={s.bookedSeats} hint="Confirmed and boarded on active trips" />
          <StatCard name="Autos at full capacity" value={s.fullTrips} hint="Full, waiting to depart" />
          <StatCard name="Private requests waiting" value={s.privateAwaiting} tone={s.privateAwaiting ? 'warn' : 'plain'} hint="Full-auto requests a driver has not answered" />
          <StatCard name="Trips in progress" value={s.tripsInProgress} />
          <StatCard name="Cancelled today" value={s.cancelledToday} tone={s.cancelledToday ? 'bad' : 'plain'} hint="Cancelled, no-show or unavailable since midnight IST" />
          <StatCard name="Open incidents" value={s.openIncidents} tone={s.openIncidents ? 'bad' : 'plain'} hint="Open and being reviewed" />
        </div>
      </div>
    </section>
  );
}
