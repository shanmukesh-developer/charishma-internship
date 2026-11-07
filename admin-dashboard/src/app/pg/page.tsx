"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { PGHostel, normalizeGender, pgRequest } from './pgApi';
import { useLiveSync, useFreshIds, liveLabel, FRESH_ROW_CLASS } from '@/lib/useLiveSync';
import { PgForm } from './PgForm';
import { RoomsPanel } from './RoomsPanel';
import { BookingsPanel } from './BookingsPanel';
import { PhotosPanel } from './PhotosPanel';
import { VideosPanel } from './VideosPanel';
import { MessPanel } from './MessPanel';
import { TimingsPanel } from './TimingsPanel';
import { OverviewPanel } from './OverviewPanel';
import { RulesPanel } from './RulesPanel';
import { PoliciesPanel } from './PoliciesPanel';
import { SafetyPanel } from './SafetyPanel';
import { MoveInPanel } from './MoveInPanel';
import { LocationPanel } from './LocationPanel';
import { FaqPanel } from './FaqPanel';
import { ReviewsPanel } from './ReviewsPanel';
import { PromotionsPanel } from './PromotionsPanel';
import { OwnersPanel } from './OwnersPanel';
import {
  Badge, Button, DataTable, Drawer, Menu, Notice as NoticeBox, PageHeader, Tabs, Toolbar, useConfirm, type Column,
  IconImage, IconMore, IconPlus, IconRefresh,
} from '@/components/ui';
import { formatINR } from '@/lib/format';

type ManageTab = 'details' | 'rooms' | 'photos' | 'videos' | 'mess' | 'timings'
  | 'overview' | 'houseRules' | 'policies' | 'safety' | 'moveIn' | 'location' | 'faq' | 'reviews';
const MANAGE_TABS: [ManageTab, string][] = [
  ['details', 'Details'], ['rooms', 'Rooms'], ['photos', 'Photos'], ['videos', 'Videos'], ['mess', 'Mess timetable'], ['timings', 'Timings'],
  ['overview', 'Overview'], ['houseRules', 'House rules'], ['policies', 'Policies'], ['safety', 'Safety'], ['moveIn', 'Move-in'],
  ['location', 'Location & nearby'], ['faq', 'FAQ'], ['reviews', 'Reviews'],
];

type View = 'listings' | 'bookings' | 'promotions' | 'owners';

export default function PGAdminPage() {
  const { isAuthed } = useAdminAuth();
  const confirm = useConfirm();
  const [view, setView] = useState<View>('listings');
  // ?tab=bookings | promotions (the overview's Needs attention list links straight to booking requests).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'bookings' || t === 'promotions' || t === 'listings' || t === 'owners') setView(t);
  }, []);
  const [pgs, setPgs] = useState<PGHostel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<PGHostel | null>(null);
  const [manageTab, setManageTab] = useState<ManageTab>('details');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const loadPgs = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setLoadError('');
    }
    try {
      const data = await pgRequest<PGHostel[]>('/api/pg/admin/admin-all');
      const list = Array.isArray(data) ? data : [];
      setPgs(list);
      if (quiet) setLoadError('');
      // Keep an open "manage" dialog pointing at the latest row (the details form keeps its own draft).
      setManaging(cur => (cur ? list.find(p => p.id === cur.id) || cur : cur));
    } catch (e) {
      if (!quiet) setLoadError(e instanceof Error ? e.message : 'Could not load PG listings.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadPendingCount = useCallback(async () => {
    try {
      const data = await pgRequest<unknown[]>('/api/pg/admin/bookings?status=Pending');
      setPendingCount(Array.isArray(data) ? data.length : null);
    } catch {
      setPendingCount(null); // the Bookings tab shows the error itself
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    loadPgs();
    loadPendingCount();
  }, [isAuthed, loadPgs, loadPendingCount]);

  const { socket, notifyLive } = useAdminSocket();
  const { mark: markFresh, isFresh } = useFreshIds();
  const [roomsTick, setRoomsTick] = useState(0);
  const [bookingsTick, setBookingsTick] = useState(0);
  const [promotionsTick, setPromotionsTick] = useState(0);
  const [ownersTick, setOwnersTick] = useState(0);
  const managingIdRef = useRef<string | null>(null);
  managingIdRef.current = managing?.id ?? null;

  // Realtime sync: listings / rooms edited in another tab, and booking requests from the app.
  // pg_owner (owner account created / suspended / linked) and pg_complaint (a student's complaint or the owner's
  // reply) reload the PG Owners panel; they were sent by the server but not subscribed, so it stayed stale.
  useLiveSync(['pg', 'pg_booking', 'pg_owner', 'pg_complaint'], (events, { reconnect }) => {
    if (reconnect || events.some(e => e.type === 'pg_owner' || e.type === 'pg_complaint')) setOwnersTick(t => t + 1);
    const pgEvents = events.filter(e => e.type === 'pg');
    const bookingEvents = events.filter(e => e.type === 'pg_booking');
    if (reconnect || pgEvents.length) {
      loadPgs(true);
      // Promotion writes arrive as { type: 'pg', id: null, scope: 'promotions' }; the Promotions view reloads on any pg event.
      setPromotionsTick(t => t + 1);
      const openId = managingIdRef.current;
      if (reconnect || pgEvents.some(e => e.id === null || String(e.id) === openId)) setRoomsTick(t => t + 1);
    }
    if (reconnect || bookingEvents.length || pgEvents.some(e => e.scope === 'availability')) {
      loadPendingCount();
      setBookingsTick(t => t + 1);
    }
    if (reconnect) return;
    markFresh(pgEvents.filter(e => e.action !== 'deleted' && e.scope !== 'availability').map(e => e.id));
    markFresh(bookingEvents.map(e => e.id));
    const label = liveLabel(bookingEvents.filter(e => e.action === 'created'), 'PG booking request');
    if (label) notifyLive(label);
  }, { enabled: isAuthed });

  // A new PG booking request updates the pending badge.
  useEffect(() => {
    if (!socket || !isAuthed) return;
    const onBooking = () => { loadPendingCount(); };
    socket.on('admin_pg_booking', onBooking);
    return () => { socket.off('admin_pg_booking', onBooking); };
  }, [socket, isAuthed, loadPendingCount]);

  const createPg = async (payload: Record<string, unknown>) => {
    const pg = await pgRequest<PGHostel>('/api/pg', { method: 'POST', body: JSON.stringify(payload) });
    setPgs(prev => [...prev, pg]);
    setCreating(false);
    setNotice({ kind: 'ok', text: `${pg.name} created. Add rooms so students can book it.` });
    setManaging(pg);
    setManageTab('rooms');
  };

  const updatePg = async (payload: Record<string, unknown>) => {
    if (!managing) return;
    const pg = await pgRequest<PGHostel>(`/api/pg/${managing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    setPgs(prev => prev.map(p => (p.id === pg.id ? pg : p)));
    setManaging(pg);
    setNotice({ kind: 'ok', text: `${pg.name} saved.` });
  };

  // A content tab saved: keep the list card and the open dialog in step.
  const onContentSaved = useCallback((id: string, patch: Partial<PGHostel>) => {
    setPgs(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
    setManaging(cur => (cur && cur.id === id ? { ...cur, ...patch } : cur));
  }, []);

  const toggleActive = async (pg: PGHostel) => {
    if (busy[pg.id]) return;
    if (pg.isActive && !(await confirm({ title: `Hide ${pg.name} from the app?`, description: 'Students can no longer see or book it. You can list it again at any time.', confirmLabel: 'Hide listing', tone: 'danger' }))) return;
    setBusy(prev => ({ ...prev, [pg.id]: true }));
    try {
      // PUT /api/pg/:id writes every field it receives, so send the full listing with the new flag.
      const { id, ...rest } = pg;
      const saved = await pgRequest<PGHostel>(`/api/pg/${id}`, { method: 'PUT', body: JSON.stringify({ ...rest, isActive: !pg.isActive }) });
      setPgs(prev => prev.map(p => (p.id === saved.id ? saved : p)));
      setNotice({ kind: 'ok', text: saved.isActive ? `${saved.name} is listed.` : `${saved.name} is hidden.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not update the listing.' });
    } finally {
      setBusy(prev => ({ ...prev, [pg.id]: false }));
    }
  };

  const deletePg = async (pg: PGHostel) => {
    // Typed confirmation: the delete button stays disabled until the PG name matches.
    if (!(await confirm({
      title: `Delete ${pg.name} permanently?`,
      description: 'Students lose access to it and its booking history loses the PG name. Hiding it is usually better.',
      confirmLabel: 'Delete permanently',
      tone: 'danger',
      requireText: pg.name,
    }))) return;
    setBusy(prev => ({ ...prev, [pg.id]: true }));
    try {
      await pgRequest(`/api/pg/${pg.id}`, { method: 'DELETE' });
      setPgs(prev => prev.filter(p => p.id !== pg.id));
      if (managing?.id === pg.id) setManaging(null);
      setNotice({ kind: 'ok', text: `${pg.name} deleted.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not delete the listing.' });
      setBusy(prev => ({ ...prev, [pg.id]: false }));
    }
  };

  const onPendingCount = useCallback((n: number) => setPendingCount(n), []);

  if (!isAuthed) return null; // AppShell shows the session check

  const coverOf = (pg: PGHostel) => {
    const photos = (pg.photos || []) as { url?: string; isCover?: boolean }[];
    return photos.find(ph => ph.isCover)?.url || photos[0]?.url || (pg.images || [])[0] || '';
  };
  const contentSummary = (pg: PGHostel) => [
    pg.photos?.length ? `${pg.photos.length} ${pg.photos.length === 1 ? 'photo' : 'photos'}` : pg.images?.length ? `${pg.images.length} ${pg.images.length === 1 ? 'photo' : 'photos'} (no categories)` : '',
    pg.videos?.length ? `${pg.videos.length} ${pg.videos.length === 1 ? 'video' : 'videos'}` : '',
    pg.messTimetable?.meals?.length ? 'Mess timetable' : '',
  ].filter(Boolean).join(' · ');
  const openManage = (pg: PGHostel, tab: ManageTab) => { setManaging(pg); setManageTab(tab); };

  const columns: Column<PGHostel>[] = [
    {
      key: 'name',
      header: 'PG',
      sortValue: pg => pg.name,
      cell: pg => {
        const cover = coverOf(pg);
        return (
          <button type="button" onClick={() => openManage(pg, 'details')} className="flex min-w-[240px] max-w-[440px] items-center gap-3 rounded-md text-left">
            <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-2 text-fg-subtle">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {cover ? <img src={cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <IconImage size={16} />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-fg hover:underline">{pg.name}</span>
                {pg.isVerified && <Badge tone="info">Verified</Badge>}
              </span>
              <span className="block truncate text-xs text-fg-muted">{pg.address}</span>
            </span>
          </button>
        );
      },
    },
    { key: 'for', header: 'For', sortValue: pg => normalizeGender(pg.genderType), cell: pg => <span className="text-fg">{normalizeGender(pg.genderType)}</span> },
    { key: 'distance', header: 'Distance', align: 'right', hideBelow: 'lg', sortValue: pg => Number(pg.distanceFromCollege) || 0, cell: pg => <span className="tabular-nums">{pg.distanceFromCollege} km</span> },
    { key: 'rent', header: 'From', align: 'right', sortValue: pg => Number(pg.baseRent) || 0, cell: pg => <span className="tabular-nums">{formatINR(pg.baseRent)}<span className="text-fg-muted">/mo</span></span> },
    {
      key: 'content',
      header: 'Content',
      hideBelow: 'xl',
      cell: pg => (!pg.photos?.length && !pg.images?.length
        ? <Badge tone="warning">No photos yet</Badge>
        : <span className="text-xs text-fg-muted">{contentSummary(pg)}</span>),
    },
    { key: 'status', header: 'Status', sortValue: pg => (pg.isActive ? 0 : 1), cell: pg => (pg.isActive ? <Badge tone="success" dot>Listed</Badge> : <Badge dot>Hidden</Badge>) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '150px',
      cell: pg => (
        <div className="flex items-center justify-end gap-1.5">
          <Button size="sm" onClick={() => openManage(pg, 'details')}>Manage</Button>
          <Menu
            label={`More actions for ${pg.name}`}
            trigger={props => <Button {...props} size="sm" variant="ghost" aria-label={`More actions for ${pg.name}`} className="w-7 px-0"><IconMore size={16} /></Button>}
            items={[
              { label: 'Rooms', onSelect: () => openManage(pg, 'rooms') },
              { label: 'Photos', onSelect: () => openManage(pg, 'photos') },
              { label: 'Reviews', onSelect: () => openManage(pg, 'reviews') },
              'separator',
              { label: pg.isActive ? 'Hide from the app' : 'List in the app', onSelect: () => toggleActive(pg), disabled: !!busy[pg.id] },
              { label: 'Delete…', onSelect: () => deletePg(pg), danger: true, disabled: !!busy[pg.id] },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="PG and hostels"
        description="PG listings and their rooms, photos and rules; promotions; students’ booking requests; and PG owner accounts for the ZenWe PG Partner app."
        actions={view === 'listings' ? (
          <>
            <Button leftIcon={<IconRefresh size={14} />} loading={loading} onClick={() => loadPgs()}>Refresh</Button>
            <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={() => setCreating(true)}>Add PG</Button>
          </>
        ) : undefined}
      >
        <Tabs
          ariaLabel="PG sections"
          value={view}
          onChange={setView}
          tabs={[
            { id: 'listings', label: 'Listings', count: pgs.length || null },
            { id: 'bookings', label: 'Booking requests', count: pendingCount || null, attention: true },
            { id: 'promotions', label: 'Promotions' },
            { id: 'owners', label: 'Owner accounts' },
          ]}
        />
      </PageHeader>

      {notice && (
        <NoticeBox tone={notice.kind === 'error' ? 'danger' : 'success'} className="mb-4" onClose={() => setNotice(null)}>
          <span className="text-fg">{notice.text}</span>
        </NoticeBox>
      )}

      {view === 'bookings' ? (
        <BookingsPanel onPendingCount={onPendingCount} liveTick={bookingsTick} isFresh={isFresh} />
      ) : view === 'promotions' ? (
        <PromotionsPanel pgs={pgs} liveTick={promotionsTick} />
      ) : view === 'owners' ? (
        <OwnersPanel pgs={pgs} liveTick={ownersTick} />
      ) : (
        <>
          <Toolbar end={<span className="text-sm text-fg-muted">{pgs.filter(p => p.isActive).length} listed, {pgs.filter(p => !p.isActive).length} hidden</span>} />
          <DataTable
            caption="PG listings"
            columns={columns}
            rows={pgs}
            rowKey={pg => pg.id}
            loading={loading}
            error={loadError || null}
            onRetry={() => loadPgs()}
            rowClassName={pg => (isFresh(pg.id) ? FRESH_ROW_CLASS : !pg.isActive ? 'bg-surface-2/40' : undefined)}
            noun="listings"
            empty={{ title: 'No PG listings yet', description: 'Add a PG and its rooms to show it in the app.', action: <Button variant="primary" onClick={() => setCreating(true)}>Add PG</Button> }}
          />
        </>
      )}

      <Drawer
        open={creating || !!managing}
        onClose={() => { setCreating(false); setManaging(null); }}
        size="xl"
        title={creating ? 'Add PG' : managing?.name || 'PG'}
        description={!creating && managing ? managing.address : 'Basic details first; rooms, photos and rules come next.'}
        headerActions={!creating && managing ? (managing.isActive ? <Badge tone="success" dot>Listed</Badge> : <Badge dot>Hidden</Badge>) : undefined}
      >
        {managing && !creating && (
          <Tabs className="mb-5" ariaLabel="PG content" value={manageTab} onChange={setManageTab} tabs={MANAGE_TABS.map(([id, label]) => ({ id, label }))} />
        )}
        {creating ? (
          <PgForm initial={null} onCancel={() => setCreating(false)} onSave={createPg} />
        ) : managing && manageTab === 'details' ? (
          <PgForm key={managing.id} initial={managing} onCancel={() => setManaging(null)} onSave={updatePg} />
        ) : managing && manageTab === 'photos' ? (
          <PhotosPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'videos' ? (
          <VideosPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'mess' ? (
          <MessPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'timings' ? (
          <TimingsPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'overview' ? (
          <OverviewPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'houseRules' ? (
          <RulesPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'policies' ? (
          <PoliciesPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'safety' ? (
          <SafetyPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'moveIn' ? (
          <MoveInPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'location' ? (
          <LocationPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'faq' ? (
          <FaqPanel key={managing.id} pg={managing} onSaved={patch => onContentSaved(managing.id, patch)} />
        ) : managing && manageTab === 'reviews' ? (
          <ReviewsPanel key={managing.id} pg={managing} liveTick={roomsTick} />
        ) : managing ? (
          <RoomsPanel pgId={managing.id} liveTick={roomsTick} />
        ) : null}
      </Drawer>
    </div>
  );
}
