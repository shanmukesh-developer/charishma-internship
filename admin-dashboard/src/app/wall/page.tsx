"use client";

import {
  Badge, Button, Card, DataTable, DescriptionList, Drawer, EmptyState, Field, FormSection, Input, LoadingState, Modal, Notice, PageHeader,
  SegmentedControl, StatTile, StatusPill, Tabs, Textarea, Toolbar, useConfirm,
  type Column, IconPlus, IconRefresh,
} from '@/components/ui';
import { formatDateTime, formatINR, formatNumber, humanize } from '@/lib/format';
import React, { useState, useEffect } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { adminRequest as apiRequest } from '@/lib/api';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { useLiveSync, useFreshIds, liveLabel, FRESH_ROW_CLASS } from '@/lib/useLiveSync';
import ListImage from '@/components/ListImage';

/** fetch against the one backend; throws an Error carrying the server's friendly `message`. */
const errMsg = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** Date -> value for <input type="datetime-local"> in the admin's local time (toISOString would be UTC). */
const toLocalInput = (d: Date) => {
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const MAX_COUPON_VALUE = 1000;


const getImageUrl = (url: string | null) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

interface WallEvent {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  status: string;
  couponCode: string | null;
  couponValue: number;
  bannerText: string;
  bannerGradient: string;
  winnerUserId: string | null;
  createdAt: string;
  totalSubmissions?: number;
  approvedSubmissions?: number;
  pendingSubmissions?: number;
}

interface WallSubmission {
  id: string;
  eventId: string;
  userId: string;
  imageUrl: string;
  likeCount: number;
  isApproved: boolean;
  createdAt: string;
  user?: { id: string; name: string; profileImage: string | null };
  event?: { id: string; title: string; status: string };
}

interface HistoryEntry {
  event: WallEvent | null;
  winningSubmission: WallSubmission | null;
  winner: { id: string; name: string; profileImage: string | null } | null;
}

const GRADIENT_OPTIONS = [
  { value: 'fire', label: 'Fire', css: 'from-orange-500 via-red-500 to-yellow-500' },
  { value: 'ocean', label: 'Ocean', css: 'from-cyan-500 via-blue-500 to-indigo-500' },
  { value: 'aurora', label: 'Aurora', css: 'from-green-400 via-teal-500 to-purple-500' },
  { value: 'sunset', label: 'Sunset', css: 'from-pink-500 via-orange-400 to-yellow-400' },
  { value: 'neon', label: 'Neon', css: 'from-purple-500 via-pink-500 to-blue-500' },
  { value: 'gold', label: 'Gold', css: 'from-amber-400 via-yellow-500 to-orange-400' },
];

export default function WallAdmin() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<'events' | 'moderation' | 'fame'>('events');

  // Events state
  const [events, setEvents] = useState<WallEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<WallEvent | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create form
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formBannerText, setFormBannerText] = useState(' LIVE PHOTO CONTEST: Vote for your favourite photos & win instant discount coupons! ');
  const [formGradient, setFormGradient] = useState('fire');
  const [formCouponValue, setFormCouponValue] = useState<number>(100);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Moderation state
  const [pendingSubmissions, setPendingSubmissions] = useState<WallSubmission[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [moderatingId, setModeratingId] = useState<string | null>(null);

  // Hall of Fame state
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthed) {
      fetchEvents();
      fetchPending();
      fetchHistory();
    }
  }, [isAuthed]);

  // quiet = background refresh from a realtime event: no spinner, keep the last good list on errors.
  const fetchEvents = async (quiet = false) => {
    if (!quiet) setLoadingEvents(true);
    try {
      const data = await apiRequest<WallEvent[]>('/api/wall/admin/events');
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!quiet) setPageError(errMsg(err, 'Could not load Wall events.'));
    } finally {
      if (!quiet) setLoadingEvents(false);
    }
  };

  // quiet = background refresh from a realtime event: no spinner, keep the last good list on errors.
  const fetchPending = async (quiet = false) => {
    if (!quiet) setLoadingPending(true);
    try {
      const data = await apiRequest<WallSubmission[]>('/api/wall/admin/pending');
      setPendingSubmissions(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!quiet) setPageError(errMsg(err, 'Could not load the moderation queue.'));
    } finally {
      if (!quiet) setLoadingPending(false);
    }
  };

  // quiet = background refresh from a realtime event: no spinner, keep the last good list on errors.
  const fetchHistory = async (quiet = false) => {
    if (!quiet) setLoadingHistory(true);
    try {
      const data = await apiRequest<HistoryEntry[]>('/api/wall/events/history');
      setHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!quiet) setPageError(errMsg(err, 'Could not load the Hall of Fame.'));
    } finally {
      if (!quiet) setLoadingHistory(false);
    }
  };

  // Realtime sync: new photo submissions and event changes (another admin tab, the wall cron) show up live.
  const { notifyLive } = useAdminSocket();
  const { mark: markFresh, isFresh } = useFreshIds();
  useLiveSync(['wall', 'wall_submission'], (evts, { reconnect }) => {
    const wallEvents = evts.filter(e => e.type === 'wall');
    const submissionEvents = evts.filter(e => e.type === 'wall_submission');
    if (reconnect || wallEvents.length) {
      fetchEvents(true);
      // Ending an event (or a moderation decision) changes the Hall of Fame / submission counts.
      fetchHistory(true);
    }
    if (reconnect || submissionEvents.length || wallEvents.some(e => e.scope === 'submissions')) fetchPending(true);
    if (reconnect) return;
    markFresh(wallEvents.filter(e => e.scope !== 'submissions').map(e => e.id));
    markFresh(submissionEvents.filter(e => e.action !== 'deleted').map(e => e.id));
    const label = liveLabel(submissionEvents.filter(e => e.action === 'created'), 'photo submission');
    if (label) notifyLive(label);
  }, { enabled: isAuthed });

  // ── Create Event ──
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formTitle.trim()) { setFormError('Title is required.'); return; }
    if (!formStart || !formEnd) { setFormError('Start and End times are required.'); return; }
    const start = new Date(formStart);
    const end = new Date(formEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { setFormError('Enter valid start and end times.'); return; }
    if (end <= start) { setFormError('The end time must be after the start time.'); return; }
    if (end <= new Date()) { setFormError('The end time must be in the future.'); return; }
    if (!Number.isInteger(formCouponValue) || formCouponValue < 1 || formCouponValue > MAX_COUPON_VALUE) {
      setFormError(`Prize value must be a whole number from ₹1 to ₹${MAX_COUPON_VALUE}.`); return;
    }
    if (formSubmitting) return;
    if (!(await confirm({ title: `Launch “${formTitle.trim()}”?`, description: 'Every student gets a push notification that the contest is live.', confirmLabel: 'Launch contest' }))) return;

    setFormSubmitting(true);
    try {
      await apiRequest('/api/wall/events', {
        method: 'POST',
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDesc.trim(),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          bannerText: formBannerText.trim(),
          bannerGradient: formGradient,
          couponValue: formCouponValue
        })
      });

      setShowCreateModal(false);
      resetForm();
      setNotice('Event launched.');
      fetchEvents();
    } catch (err) {
      setFormError(errMsg(err, 'Failed to create event.'));
    } finally {
      setFormSubmitting(false);
    }
  };

  // ── Edit Event ──
  const handleEditEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEvent || formSubmitting) return;
    setFormError('');
    if (!formTitle.trim()) { setFormError('Title is required.'); return; }
    // Only send the end time when the admin changed it (an unchanged, already-passed end must not block other edits).
    const endChanged = !!formEnd && formEnd !== toLocalInput(new Date(editingEvent.endTime));
    const end = endChanged ? new Date(formEnd) : null;
    if (end && Number.isNaN(end.getTime())) { setFormError('Enter a valid end time.'); return; }
    if (end && end <= new Date(editingEvent.startTime)) { setFormError('The end time must be after the start time.'); return; }
    if (end && end <= new Date()) { setFormError('The end time must be in the future. Use End to finish the contest now.'); return; }
    if (!Number.isInteger(formCouponValue) || formCouponValue < 1 || formCouponValue > MAX_COUPON_VALUE) {
      setFormError(`Prize value must be a whole number from ₹1 to ₹${MAX_COUPON_VALUE}.`); return;
    }
    setFormSubmitting(true);

    try {
      await apiRequest(`/api/wall/events/${editingEvent.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDesc.trim(),
          bannerText: formBannerText.trim(),
          bannerGradient: formGradient,
          couponValue: formCouponValue,
          endTime: end ? end.toISOString() : undefined
        })
      });

      setShowEditModal(false);
      setEditingEvent(null);
      resetForm();
      setNotice('Event updated.');
      fetchEvents();
    } catch (err) {
      setFormError(errMsg(err, 'Failed to update event.'));
    } finally {
      setFormSubmitting(false);
    }
  };

  // ── End Event ──
  const handleEndEvent = async (eventId: string) => {
    if (actionLoading) return;
    if (!(await confirm({ title: 'End this contest now?', description: 'The approved photo with the most votes wins and its owner gets the prize coupon. This cannot be undone.', confirmLabel: 'End contest', tone: 'danger' }))) return;
    setActionLoading(eventId);
    setPageError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ winner?: { name?: string } | null }>(`/api/wall/events/${eventId}/end`, { method: 'PUT' });
      setNotice(res?.winner?.name ? `Contest ended. Winner: ${res.winner.name}.` : 'Contest ended. There was no eligible winner.');
      fetchEvents();
      fetchHistory();
    } catch (err) {
      setPageError(errMsg(err, 'Failed to end event.'));
    } finally {
      setActionLoading(null);
    }
  };

  // ── Moderate Submissions ──
  const handleApprove = async (submissionId: string) => {
    if (moderatingId) return;
    setModeratingId(submissionId);
    setPageError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/wall/admin/submissions/${submissionId}/approve`, { method: 'PUT' });
      setPendingSubmissions(prev => prev.filter(s => s.id !== submissionId));
      setNotice('Photo approved. It is now visible on The Wall.');
      fetchEvents();
    } catch (err) {
      setPageError(errMsg(err, 'Could not approve the photo.'));
    } finally {
      setModeratingId(null);
    }
  };

  const handleReject = async (submissionId: string) => {
    if (moderatingId) return;
    if (!(await confirm({ title: 'Reject this photo?', description: 'It is permanently deleted. The student can submit a new one while the contest is open.', confirmLabel: 'Reject photo', tone: 'danger' }))) return;
    setModeratingId(submissionId);
    setPageError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/wall/admin/submissions/${submissionId}/reject`, { method: 'PUT' });
      setPendingSubmissions(prev => prev.filter(s => s.id !== submissionId));
      setNotice('Photo rejected and removed.');
      fetchEvents();
    } catch (err) {
      setPageError(errMsg(err, 'Could not reject the photo.'));
    } finally {
      setModeratingId(null);
    }
  };

  const resetForm = () => {
    setFormTitle(''); setFormDesc(''); setFormStart(''); setFormEnd('');
    setFormBannerText('🔥 LIVE PHOTO CONTEST: Vote for your favourite photos & win instant discount coupons! 📸✨');
    setFormGradient('fire'); setFormCouponValue(100); setFormError('');
  };

  const openEditModal = (evt: WallEvent) => {
    setEditingEvent(evt);
    setFormTitle(evt.title);
    setFormDesc(evt.description);
    setFormEnd(toLocalInput(new Date(evt.endTime)));
    setFormBannerText(evt.bannerText || '');
    setFormGradient(evt.bannerGradient || 'fire');
    setFormCouponValue(evt.couponValue || 100);
    setFormError('');
    setShowEditModal(true);
  };

  const formatDate = (d?: string | null) => {
    if (!d) return '—';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return formatDateTime(date, { short: true });
  };

  const getGradientCss = (value: string) => GRADIENT_OPTIONS.find(g => g.value === value)?.css || GRADIENT_OPTIONS[0].css;

  if (!isAuthed) return null; // NexusLayoutClient shows the auth loader / redirect

  const phaseOf = (evt: WallEvent) => {
    const isActive = evt.status === 'ACTIVE';
    if (evt.status === 'ENDED') return 'Ended';
    if (isActive && new Date(evt.startTime) > new Date()) return 'Scheduled';
    if (isActive && new Date(evt.endTime) > new Date()) return 'Live';
    if (isActive) return 'Finalising';
    return humanize(evt.status);
  };
  const phaseTone = (p: string) => (p === 'Live' ? 'success' : p === 'Scheduled' ? 'info' : p === 'Finalising' ? 'warning' : 'neutral') as 'success' | 'info' | 'warning' | 'neutral';

  const openCreate = () => {
    resetForm();
    const now = new Date();
    setFormStart(toLocalInput(now));
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    setFormEnd(toLocalInput(end));
    setShowCreateModal(true);
  };
  const closeForm = () => {
    if (formSubmitting) return;
    setShowCreateModal(false);
    setShowEditModal(false);
    setEditingEvent(null);
    resetForm();
  };

  const bannerPreview = (text: string, gradient: string) => (
    <div className={`relative h-9 overflow-hidden rounded-md bg-gradient-to-r ${getGradientCss(gradient)}`} aria-label="Banner preview">
      <div className="absolute inset-0 flex items-center whitespace-nowrap animate-marquee">
        <span className="px-4 text-xs font-semibold text-white">
          {text} &nbsp;&nbsp;&nbsp; {text}
        </span>
      </div>
    </div>
  );

  const openEvent = openEventId ? events.find(e => e.id === openEventId) || null : null;

  const eventColumns: Column<WallEvent>[] = [
    {
      key: 'title',
      header: 'Contest',
      sortValue: e => e.title,
      cell: e => (
        <div className="min-w-0 max-w-[360px]">
          <p className="truncate font-medium text-fg">{e.title}</p>
          {e.description && <p className="truncate text-xs text-fg-muted">{e.description}</p>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortValue: e => phaseOf(e), cell: e => { const p = phaseOf(e); return <StatusPill status={p} tone={phaseTone(p)} label={p} />; } },
    {
      key: 'window',
      header: 'Runs',
      sortValue: e => new Date(e.startTime),
      cell: e => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(e.startTime)} → {formatDate(e.endTime)}</span>,
    },
    { key: 'photos', header: 'Photos', align: 'right', hideBelow: 'lg', sortValue: e => e.totalSubmissions ?? 0, cell: e => <span className="tabular-nums">{formatNumber(e.totalSubmissions ?? 0)}</span> },
    {
      key: 'pending',
      header: 'To review',
      align: 'right',
      sortValue: e => e.pendingSubmissions ?? 0,
      cell: e => ((e.pendingSubmissions ?? 0) > 0 ? <Badge tone="warning">{formatNumber(e.pendingSubmissions ?? 0)}</Badge> : <span className="text-fg-subtle">0</span>),
    },
    { key: 'prize', header: 'Prize', align: 'right', sortValue: e => e.couponValue ?? 0, cell: e => <span className="tabular-nums">{formatINR(e.couponValue ?? 0)}</span> },
  ];

  const fameColumns: Column<HistoryEntry>[] = [
    {
      key: 'event',
      header: 'Contest',
      sortValue: h => h.event?.title || '',
      cell: h => (
        <div className="flex min-w-0 items-center gap-3">
          {h.winningSubmission?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getImageUrl(h.winningSubmission.imageUrl)} loading="lazy" decoding="async" alt="" className="h-10 w-10 shrink-0 rounded-md border border-line bg-surface-2 object-cover" />
          ) : <div aria-hidden className="h-10 w-10 shrink-0 rounded-md border border-line bg-surface-2" />}
          <span className="truncate font-medium text-fg">{h.event?.title || 'Untitled contest'}</span>
        </div>
      ),
    },
    { key: 'winner', header: 'Winner', sortValue: h => h.winner?.name || '', cell: h => (h.winningSubmission ? <span className="text-fg">{h.winner?.name || 'Unknown'}</span> : <span className="text-xs text-fg-muted">No approved photos, no winner</span>) },
    { key: 'votes', header: 'Votes', align: 'right', sortValue: h => h.winningSubmission?.likeCount || 0, cell: h => <span className="tabular-nums">{h.winningSubmission ? formatNumber(h.winningSubmission.likeCount || 0) : '–'}</span> },
    { key: 'ended', header: 'Ran', hideBelow: 'lg', sortValue: h => (h.event?.endTime ? new Date(h.event.endTime) : null), cell: h => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(h.event?.startTime)} → {formatDate(h.event?.endTime)}</span> },
    { key: 'coupon', header: 'Prize coupon', align: 'right', cell: h => (h.event?.couponCode ? <span className="font-mono text-xs text-fg">{h.event.couponCode} <span className="font-sans text-fg-muted">({formatINR(h.event.couponValue)})</span></span> : <span className="text-fg-subtle">–</span>) },
  ];

  const editing = showEditModal && !!editingEvent;
  const formOpen = showCreateModal || editing;

  return (
    <div className="text-fg">
      <PageHeader
        title="The Wall"
        description="Photo contests on the student Wall: launch a contest, review submitted photos and see past winners."
        actions={<Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openCreate}>Launch contest</Button>}
      />

      <Tabs<'events' | 'moderation' | 'fame'>
        className="mb-4"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'events', label: 'Contests', count: loadingEvents ? null : events.length },
          { id: 'moderation', label: 'Photo review', count: loadingPending ? null : pendingSubmissions.length, attention: pendingSubmissions.length > 0 },
          { id: 'fame', label: 'Hall of fame', count: loadingHistory ? null : history.length },
        ]}
      />

      {pageError && (
        <Notice tone="danger" className="mb-3" onClose={() => setPageError(null)} action={<Button size="sm" onClick={() => { setPageError(null); fetchEvents(); fetchPending(); fetchHistory(); }}>Retry</Button>}>
          {pageError}
        </Notice>
      )}
      {notice && <Notice tone="success" className="mb-3" onClose={() => setNotice(null)}>{notice}</Notice>}

      {activeTab === 'events' && (
        <DataTable
          caption="Wall contests"
          columns={eventColumns}
          rows={events}
          rowKey={e => e.id}
          loading={loadingEvents && events.length === 0}
          onRowClick={e => setOpenEventId(e.id)}
          rowClassName={e => (isFresh(e.id) ? FRESH_ROW_CLASS : '')}
          initialSort={{ key: 'window', dir: 'desc' }}
          noun="contests"
          empty={{
            title: 'No contests yet',
            description: 'Launch a photo contest; every student gets a push when it goes live.',
            action: <Button variant="primary" leftIcon={<IconPlus size={14} />} onClick={openCreate}>Launch contest</Button>,
          }}
        />
      )}

      {activeTab === 'moderation' && (
        <>
          <Toolbar end={<Button size="sm" leftIcon={<IconRefresh size={14} />} loading={loadingPending} onClick={() => fetchPending()}>Refresh</Button>}>
            <p className="text-sm text-fg-muted">Approved photos appear on the Wall and can win votes. Rejected photos are deleted.</p>
          </Toolbar>
          {loadingPending && pendingSubmissions.length === 0 ? (
            <LoadingState label="Loading photos…" />
          ) : pendingSubmissions.length === 0 ? (
            <Card><EmptyState title="Nothing to review" description="All submitted photos have been reviewed." /></Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pendingSubmissions.map(sub => (
                <Card key={sub.id} className={`overflow-hidden ${isFresh(sub.id) ? FRESH_ROW_CLASS : ''}`}>
                  <div className="aspect-square bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getImageUrl(sub.imageUrl)}
                      loading="lazy"
                      decoding="async"
                      alt={`Photo by ${sub.user?.name || 'a student'}`}
                      className="h-full w-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                  </div>
                  <div className="space-y-3 p-3">
                    <div className="flex items-center gap-2">
                      <ListImage
                        thumb
                        src={getImageUrl(sub.user?.profileImage ?? null)}
                        className="h-7 w-7 rounded-full border border-line object-cover"
                        fallback={<div aria-hidden className="h-7 w-7 rounded-full border border-line bg-surface-2" />}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{sub.user?.name || 'Unknown'}</p>
                        <p className="truncate text-xs text-fg-muted">{sub.event ? `${sub.event.title}${sub.event.status === 'ENDED' ? ' (ended)' : ''}` : 'No contest'} · {formatDate(sub.createdAt)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" className="flex-1 text-danger-text" disabled={!!moderatingId} onClick={() => handleReject(sub.id)}>Reject</Button>
                      <Button size="sm" variant="primary" className="flex-1" disabled={!!moderatingId && moderatingId !== sub.id} loading={moderatingId === sub.id} onClick={() => handleApprove(sub.id)}>Approve</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'fame' && (
        <DataTable
          caption="Past contests and winners"
          columns={fameColumns}
          rows={history}
          rowKey={(h, i) => h.event?.id || String(i)}
          loading={loadingHistory && history.length === 0}
          initialSort={{ key: 'ended', dir: 'desc' }}
          noun="contests"
          empty={{ title: 'No finished contests yet', description: 'Winners appear here once a contest ends.' }}
        />
      )}

      <Drawer
        open={!!openEvent}
        onClose={() => setOpenEventId(null)}
        size="md"
        title={openEvent?.title || 'Contest'}
        description={openEvent ? `${formatDate(openEvent.startTime)} → ${formatDate(openEvent.endTime)}` : undefined}
        headerActions={openEvent ? <StatusPill status={phaseOf(openEvent)} tone={phaseTone(phaseOf(openEvent))} label={phaseOf(openEvent)} /> : undefined}
        footer={openEvent && openEvent.status !== 'ENDED' ? (
          <div className="flex w-full justify-between gap-2">
            <Button variant="destructive" disabled={!!actionLoading} loading={actionLoading === openEvent.id} onClick={() => handleEndEvent(openEvent.id)}>End contest now</Button>
            <Button onClick={() => { const evt = openEvent; setOpenEventId(null); openEditModal(evt); }}>Edit contest</Button>
          </div>
        ) : undefined}
      >
        {openEvent && (
          <div className="space-y-5">
            {openEvent.description && <p className="text-sm text-fg">{openEvent.description}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Photos" value={formatNumber(openEvent.totalSubmissions ?? 0)} />
              <StatTile label="Approved" value={formatNumber(openEvent.approvedSubmissions ?? 0)} />
              <StatTile label="To review" value={formatNumber(openEvent.pendingSubmissions ?? 0)} tone={(openEvent.pendingSubmissions ?? 0) > 0 ? 'warning' : 'neutral'} />
              <StatTile label="Prize" value={formatINR(openEvent.couponValue ?? 0)} />
            </div>
            {openEvent.bannerText && (
              <div>
                <p className="mb-1 text-xs text-fg-muted">Moving banner</p>
                {bannerPreview(openEvent.bannerText, openEvent.bannerGradient)}
              </div>
            )}
            <DescriptionList
              columns={2}
              items={[
                { label: 'Starts', value: formatDate(openEvent.startTime) },
                { label: 'Ends', value: formatDate(openEvent.endTime) },
                { label: 'Created', value: formatDate(openEvent.createdAt) },
                { label: 'Winner’s coupon', value: openEvent.couponCode ? <span className="font-mono">{openEvent.couponCode}</span> : 'Created when the contest ends' },
              ]}
            />
          </div>
        )}
      </Drawer>

      <Modal
        open={formOpen}
        onClose={closeForm}
        dismissible={!formSubmitting}
        size="lg"
        title={editing ? 'Edit contest' : 'Launch a photo contest'}
        description={editing ? 'Changes show in the app straight away.' : 'Every student gets a push notification when the contest goes live.'}
        footer={(
          <>
            <Button onClick={closeForm} disabled={formSubmitting}>Cancel</Button>
            <Button variant="primary" type="submit" form="wall-event-form" loading={formSubmitting}>{editing ? 'Save changes' : 'Launch contest'}</Button>
          </>
        )}
      >
        <form id="wall-event-form" onSubmit={editing ? handleEditEvent : handleCreateEvent} className="space-y-4">
          {formError && <Notice tone="danger">{formError}</Notice>}

          <Field label="Contest title" required>
            <Input placeholder="e.g. Campus food aesthetics" value={formTitle} onChange={e => setFormTitle(e.target.value)} />
          </Field>

          {!editing && (
            <Field label="Description" optional>
              <Textarea rows={2} placeholder="Share your most aesthetic food photo…" value={formDesc} onChange={e => setFormDesc(e.target.value)} />
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {!editing && (
              <Field label="Starts" required>
                <Input type="datetime-local" value={formStart} onChange={e => setFormStart(e.target.value)} />
              </Field>
            )}
            <Field
              label="Ends"
              required
              labelAction={editing && editingEvent ? (
                <div className="flex gap-1">
                  {[
                    { label: '+6h', hours: 6 },
                    { label: '+12h', hours: 12 },
                    { label: '+1d', hours: 24 },
                    { label: '+3d', hours: 72 },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => {
                        const d = new Date(editingEvent.endTime);
                        d.setHours(d.getHours() + opt.hours);
                        setFormEnd(toLocalInput(d));
                      }}
                      className="rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
                    >{opt.label}</button>
                  ))}
                </div>
              ) : undefined}
            >
              <Input type="datetime-local" value={formEnd} onChange={e => setFormEnd(e.target.value)} />
            </Field>
          </div>

          <FormSection title="Moving banner" description="Scrolls across the top of the Wall while the contest runs.">
            <div className="space-y-3">
              <Field label="Banner text">
                <Textarea rows={2} value={formBannerText} onChange={e => setFormBannerText(e.target.value)} />
              </Field>
              <Field label="Colour">
                <SegmentedControl
                  size="sm"
                  ariaLabel="Banner colour"
                  value={formGradient}
                  onChange={setFormGradient}
                  options={GRADIENT_OPTIONS.map(g => ({ value: g.value, label: <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-3 w-3 rounded-full bg-gradient-to-r ${g.css}`} />{g.label}</span> }))}
                />
              </Field>
              {formBannerText && (
                <div>
                  <p className="mb-1 text-xs text-fg-muted">Preview</p>
                  {bannerPreview(formBannerText, formGradient)}
                </div>
              )}
            </div>
          </FormSection>

          <FormSection title="Winner prize" description="When the contest ends, the server creates a one-time coupon of this value for the winner and sends them the code.">
            <Field
              label="Coupon value"
              hint={`Whole rupees, ₹1 to ₹${MAX_COUPON_VALUE}.`}
              labelAction={(
                <div className="flex gap-1">
                  {[50, 100, 150, 200].map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFormCouponValue(v)}
                      className={`rounded px-1.5 py-0.5 text-xs ${formCouponValue === v ? 'bg-accent-soft text-accent-text' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
                    >
                      ₹{v}
                    </button>
                  ))}
                </div>
              )}
            >
              <Input type="number" prefix="₹" className="sm:w-48" value={formCouponValue} onChange={e => setFormCouponValue(Number(e.target.value) || 0)} />
            </Field>
          </FormSection>
        </form>
      </Modal>

      {/* Marquee animation for the banner previews */}
      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 12s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-marquee { animation: none; }
        }
      `}</style>
    </div>
  );
}
