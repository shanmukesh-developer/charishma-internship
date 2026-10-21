"use client";

import { useConfirm } from '@/components/ui';
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
    if (!(await confirm({ title: `Launch "${formTitle.trim()}"? Every student gets a push notification that the contest is live.` }))) return;

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
    if (!(await confirm({ title: 'End this contest now? The approved photo with the most votes wins and its owner gets the prize coupon. This cannot be undone.' }))) return;
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
    if (!(await confirm({ title: 'Reject this photo? It is permanently deleted and the student can submit a new one while the contest is open.' }))) return;
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
    return date.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getGradientCss = (value: string) => GRADIENT_OPTIONS.find(g => g.value === value)?.css || GRADIENT_OPTIONS[0].css;

  if (!isAuthed) return null; // NexusLayoutClient shows the auth loader / redirect

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <header className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg">The Wall</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Student photo wall: submissions to approve and events.</p>
        </div>
        <div className="flex gap-2">
          {(['events', 'moderation', 'fame'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 rounded-lg text-xs font-semibold transition-all border ${
                activeTab === tab
                  ? 'bg-accent border-warning/30 text-on-solid'
                  : 'bg-surface-2/60 border-line text-fg-muted hover:bg-surface-2'
              }`}
            >
              {tab === 'events' && 'Events & Banners'}
              {tab === 'moderation' && <>Moderation {pendingSubmissions.length > 0 && <span className="ml-1.5 px-2 py-0.5 text-xs bg-danger text-on-solid rounded-full font-semibold">{pendingSubmissions.length}</span>}</>}
              {tab === 'fame' && 'Hall of Fame'}
            </button>
          ))}
        </div>
      </header>

      {pageError && (
        <div className="p-4 rounded-xl border border-danger/30 bg-danger-soft text-sm font-semibold text-danger-text flex justify-between items-center gap-4">
          <span>{pageError}</span>
          <button onClick={() => { setPageError(null); fetchEvents(); fetchPending(); fetchHistory(); }} className="text-xs font-semibold underline">Retry</button>
        </div>
      )}
      {notice && (
        <div className="p-4 rounded-xl border border-success/30 bg-success-soft text-sm font-semibold text-success-text">{notice}</div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: Events & Banners */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'events' && (
        <div className="space-y-6">
          {/* Create Event Button */}
          <div className="flex justify-end">
            <button
              onClick={() => {
                resetForm();
                const now = new Date();
                setFormStart(toLocalInput(now));
                const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                setFormEnd(toLocalInput(end));
                setShowCreateModal(true);
              }}
              className="px-6 py-3.5 bg-accent hover:bg-accent-hover text-on-solid rounded-lg text-xs font-semibold transition-all flex items-center gap-2"
            >
              <span></span> Launch New Event
            </button>
          </div>

          {/* Events Grid */}
          {loadingEvents ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-2 border-warning/30 border-t-warning/30 rounded-full animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <div className="py-16 text-center rounded-lg border border-line bg-surface shadow-xs border border-line">
              <p className="text-fg-muted text-sm font-semibold">No Wall events created yet.</p>
              <p className="text-fg-subtle text-xs mt-1">Launch your first photo contest above!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {events.map(evt => {
                const isActive = evt.status === 'ACTIVE';
                const isEnded = evt.status === 'ENDED';
                const isScheduled = isActive && new Date(evt.startTime) > new Date();
                const isLive = isActive && !isScheduled && new Date(evt.endTime) > new Date();
                return (
                  <div
                    key={evt.id}
                    className={`rounded-lg border border-line bg-surface shadow-xs p-6 space-y-4 border ${isFresh(evt.id) ? FRESH_ROW_CLASS : ''} ${
                      isLive ? 'border-warning/30 bg-warning-soft' : isEnded ? 'border-line opacity-70' : 'border-line'
                    }`}
                  >
                    {/* Status + Title */}
                    <div className="flex justify-between items-start gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {isLive && (
                            <span className="px-2 py-0.5 bg-success-soft border border-success/30 text-success-text text-xs font-semibold rounded-full flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" /> LIVE
                            </span>
                          )}
                          {isEnded && (
                            <span className="px-2 py-0.5 bg-surface-3 border border-line-strong text-fg-muted text-xs font-semibold rounded-full">Ended</span>
                          )}
                          {isScheduled && (
                            <span className="px-2 py-0.5 bg-info-soft border border-info/30 text-info-text text-xs font-semibold rounded-full">Scheduled</span>
                          )}
                          {isActive && !isLive && !isScheduled && (
                            <span className="px-2 py-0.5 bg-danger-soft border border-danger/30 text-danger-text text-xs font-semibold rounded-full">Finalising</span>
                          )}
                        </div>
                        <h3 className="text-lg font-semibold text-fg">{evt.title}</h3>
                        {evt.description && <p className="text-xs text-fg-muted line-clamp-2">{evt.description}</p>}
                      </div>
                    </div>

                    {/* Moving Banner Preview */}
                    {evt.bannerText && (
                      <div className={`relative overflow-hidden rounded-xl h-8 bg-surface-2 ${getGradientCss(evt.bannerGradient)}`}>
                        <div className="absolute inset-0 flex items-center whitespace-nowrap animate-marquee">
                          <span className="text-xs font-semibold text-fg px-4">
                            {evt.bannerText} &nbsp;&nbsp;&nbsp; {evt.bannerText}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Stats Row */}
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Total', value: evt.totalSubmissions ?? 0, color: 'text-info-text' },
                        { label: 'Approved', value: evt.approvedSubmissions ?? 0, color: 'text-success-text' },
                        { label: 'Pending', value: evt.pendingSubmissions ?? 0, color: 'text-warning-text' },
                        { label: 'Prize', value: `₹${evt.couponValue ?? 0}`, color: 'text-accent-text' },
                      ].map(stat => (
                        <div key={stat.label} className="bg-surface-2/60 rounded-xl p-2.5 text-center border border-line">
                          <p className={`text-sm font-semibold ${stat.color}`}>{stat.value}</p>
                          <p className="text-xs text-fg-muted font-semibold">{stat.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Meta */}
                    <div className="flex justify-between items-center text-xs text-fg-muted border-t border-line pt-3">
                      <div>
                        <span className="font-semibold text-fg-muted"></span> {formatDate(evt.startTime)} → {formatDate(evt.endTime)}
                      </div>
                      {isEnded && evt.couponCode && (
                        <span title="Winner's coupon code" className="font-mono text-warning-text bg-warning-soft px-2 py-0.5 rounded border border-warning/30 text-xs font-semibold">
                          {evt.couponCode}
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    {!isEnded && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditModal(evt)}
                          className="flex-1 py-2.5 bg-surface-2/60 hover:bg-surface-2 border border-line text-fg text-xs font-semibold rounded-xl transition-all"
                        >
                          Edit Event
                        </button>
                        <button
                          onClick={() => handleEndEvent(evt.id)}
                          disabled={actionLoading === evt.id}
                          className="py-2.5 px-4 bg-danger-soft hover:bg-danger/90 border border-danger/30 text-danger-text hover:text-fg text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
                        >
                          {actionLoading === evt.id ? '...' : 'End'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: Moderation Queue */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'moderation' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
              <span></span> Pending Photo Submissions ({pendingSubmissions.length})
            </h3>
            <button
              onClick={() => fetchPending()}
              className="px-4 py-2 bg-surface-2/60 hover:bg-surface-2 border border-line text-fg-muted text-xs font-semibold rounded-xl transition-all"
            >
              Refresh
            </button>
          </div>

          {loadingPending ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-2 border-warning/30 border-t-warning/30 rounded-full animate-spin" />
            </div>
          ) : pendingSubmissions.length === 0 ? (
            <div className="py-16 text-center rounded-lg border border-line bg-surface shadow-xs border border-line">
              <p className="text-4xl mb-3"></p>
              <p className="text-fg-muted text-sm font-semibold">Moderation queue is clear!</p>
              <p className="text-fg-subtle text-xs mt-1">All submissions have been reviewed.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {pendingSubmissions.map(sub => (
                <div key={sub.id} className={`rounded-lg border border-line bg-surface shadow-xs border border-warning/30 overflow-hidden ${isFresh(sub.id) ? FRESH_ROW_CLASS : ''}`}>
                  {/* Photo Preview */}
                  <div className="relative aspect-square bg-surface-2">
                    <img
                      src={getImageUrl(sub.imageUrl)}
                      loading="lazy"
                      decoding="async"
                      alt="Submission"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect fill="%23111" width="200" height="200"/><text fill="%23333" x="50%" y="50%" text-anchor="middle" dy=".3em" font-size="40"></text></svg>'; }}
                    />
                    {/* Event Badge */}
                    {sub.event && (
                      <div className="absolute top-3 left-3 px-2 py-1 bg-surface-2 rounded-lg border border-line">
                        <span className="text-xs font-semibold text-fg">
                          {sub.event.title}{sub.event.status === 'ENDED' ? ' · ended' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <ListImage
                          thumb
                          src={getImageUrl(sub.user?.profileImage ?? null)}
                          className="w-7 h-7 rounded-full object-cover border border-line"
                          fallback={<div className="w-7 h-7 rounded-full bg-warning-soft flex items-center justify-center text-xs"></div>}
                        />
                        <span className="text-xs font-semibold text-fg">{sub.user?.name || 'Unknown'}</span>
                      </div>
                      <span className="text-xs text-fg-muted">{formatDate(sub.createdAt)}</span>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReject(sub.id)}
                        disabled={moderatingId === sub.id}
                        className="flex-1 py-2.5 bg-danger-soft border border-danger/30 text-danger-text text-xs font-semibold rounded-xl hover:bg-danger-soft transition-all disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleApprove(sub.id)}
                        disabled={moderatingId === sub.id}
                        className="flex-[2] py-2.5 bg-success hover:bg-success/90 text-on-solid text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
                      >
                        {moderatingId === sub.id ? '...' : '✓ Approve'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB 3: Hall of Fame */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'fame' && (
        <div className="space-y-6">
          <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
            <span></span> Hall of Fame — Past Events & Winners
          </h3>

          {loadingHistory ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-2 border-warning/30 border-t-warning/30 rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="py-16 text-center rounded-lg border border-line bg-surface shadow-xs border border-line">
              <p className="text-4xl mb-3"></p>
              <p className="text-fg-muted text-sm font-semibold">No completed events yet.</p>
              <p className="text-fg-subtle text-xs mt-1">Winners will appear here once an event ends.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {history.map((entry: any, i: number) => (
                <div key={entry.event?.id || i} className="rounded-lg border border-line bg-surface shadow-xs border border-warning/30 overflow-hidden">
                  {/* Winner Photo */}
                  {entry.winningSubmission?.imageUrl && (
                    <div className="h-48 bg-surface-2 relative">
                      <img
                        src={getImageUrl(entry.winningSubmission.imageUrl)}
                        loading="lazy"
                        decoding="async"
                        alt="Winner"
                        className="w-full h-full object-cover opacity-80"
                      />
                      <div className="absolute inset-0 bg-surface-2" />
                      <div className="absolute bottom-3 left-4 flex items-center gap-2">
                        <span className="text-2xl"></span>
                        <div>
                          <p className="text-xs font-semibold text-warning-text">Winner</p>
                          <p className="text-sm font-semibold text-fg">{entry.winner?.name || 'No winner'}</p>
                        </div>
                      </div>
                      <div className="absolute bottom-3 right-4 px-2 py-1 bg-surface-2 rounded-lg">
                        <span className="text-xs font-semibold text-danger-text">{entry.winningSubmission?.likeCount || 0} votes</span>
                      </div>
                    </div>
                  )}

                  <div className="p-5 space-y-3">
                    <h4 className="text-md font-semibold text-fg">{entry.event?.title || 'Untitled Event'}</h4>
                    <div className="flex gap-3 text-xs text-fg-muted">
                      <span>{formatDate(entry.event?.startTime)} → {formatDate(entry.event?.endTime)}</span>
                    </div>
                    {!entry.winningSubmission && (
                      <p className="text-xs text-fg-muted">No approved photos, so nobody won this contest.</p>
                    )}
                    {entry.event?.couponCode && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-fg-muted font-semibold">Winner&apos;s coupon:</span>
                        <span className="font-mono text-warning-text bg-warning-soft px-2 py-0.5 rounded border border-warning/30 text-xs font-semibold">
                          {entry.event.couponCode} (₹{entry.event.couponValue})
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* Create Event Modal */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4">
          <div className="bg-surface border border-line rounded-lg w-full max-w-2xl overflow-hidden bg-surface border border-line max-h-[90vh] overflow-y-auto">
            <header className="px-8 py-6 border-b border-line flex justify-between items-center bg-surface-2/60 sticky top-0 z-10">
              <h3 className="text-xl font-semibold text-fg">Launch Wall Event</h3>
              <button
                onClick={() => { setShowCreateModal(false); resetForm(); }}
                className="w-8 h-8 rounded-full bg-surface-2/60 hover:bg-surface-2 text-fg flex items-center justify-center text-lg transition-all"
               aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
            </header>

            <form onSubmit={handleCreateEvent} className="p-8 space-y-6">
              {formError && (
                <div className="p-4 bg-danger-soft border border-danger/30 rounded-lg text-xs font-semibold text-danger-text">{formError}</div>
              )}

              {/* Title */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg-muted">Event Title</label>
                <input
                  type="text"
                  placeholder="e.g. Campus Food Aesthetics "
                  className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent transition-all"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg-muted">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Share your most aesthetic food photo..."
                  className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent transition-all resize-none"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                />
              </div>

              {/* Date Range */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-fg-muted">Start Time</label>
                  <input
                    type="datetime-local"
                    className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg outline-none focus:border-accent transition-all"
                    value={formStart}
                    onChange={e => setFormStart(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-fg-muted">End Time</label>
                  <input
                    type="datetime-local"
                    className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg outline-none focus:border-accent transition-all"
                    value={formEnd}
                    onChange={e => setFormEnd(e.target.value)}
                  />
                </div>
              </div>

              {/* Banner Section */}
              <div className="space-y-4 p-5 bg-surface-2/60 rounded-lg border border-line">
                <h4 className="text-xs font-semibold text-warning-text">Moving Banner Configuration</h4>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-fg-muted">Banner Text</label>
                  <textarea
                    rows={2}
                    className="w-full bg-surface-2/60 border border-line rounded-lg py-3 px-5 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent transition-all resize-none"
                    value={formBannerText}
                    onChange={e => setFormBannerText(e.target.value)}
                  />
                </div>

                {/* Gradient Selector */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-fg-muted">Banner Gradient Style</label>
                  <div className="grid grid-cols-3 gap-2">
                    {GRADIENT_OPTIONS.map(g => (
                      <button
                        key={g.value}
                        type="button"
                        onClick={() => setFormGradient(g.value)}
                        className={`py-2.5 rounded-xl text-xs font-semibold text-on-solid transition-all bg-accent ${g.css} ${
                          formGradient === g.value ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0D0D15] scale-105' : 'opacity-60 hover:opacity-90'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Preview */}
                {formBannerText && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-fg-muted">Live Preview</label>
                    <div className={`relative overflow-hidden rounded-xl h-9 bg-surface-2 ${getGradientCss(formGradient)}`}>
                      <div className="absolute inset-0 flex items-center whitespace-nowrap animate-marquee">
                        <span className="text-xs font-semibold text-fg px-4">
                          {formBannerText} &nbsp;&nbsp;&nbsp; {formBannerText}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Coupon Section */}
              <div className="space-y-4 p-5 bg-surface-2/60 rounded-lg border border-line">
                <h4 className="text-xs font-semibold text-accent-text">Winner Prize</h4>
                <p className="text-xs text-fg-muted">When the contest ends, the server creates a one-time coupon of this value for the winner and sends them the code.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-fg-muted">Coupon Value (₹)</label>
                    <input
                      type="number"
                      className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg outline-none focus:border-accent transition-all"
                      value={formCouponValue}
                      onChange={e => setFormCouponValue(Number(e.target.value) || 0)}
                    />
                    <div className="flex gap-1.5">
                      {[50, 100, 150, 200].map(v => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setFormCouponValue(v)}
                          className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
                            formCouponValue === v ? 'bg-accent-soft text-accent-text border border-accent/30' : 'bg-surface-2/60 text-fg-muted hover:text-fg'
                          }`}
                        >
                          ₹{v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-4 pt-4 border-t border-line">
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); resetForm(); }}
                  className="flex-1 py-3.5 bg-surface-2/60 hover:bg-surface-2 text-fg rounded-lg text-xs font-semibold transition-all"
                >Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="flex-1 py-3.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-solid rounded-lg text-xs font-semibold transition-all"
                >{formSubmitting ? 'Launching...' : 'Launch Event'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* Edit Event Modal */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {showEditModal && editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4">
          <div className="bg-surface border border-line rounded-lg w-full max-w-2xl overflow-hidden bg-surface border border-line max-h-[90vh] overflow-y-auto">
            <header className="px-8 py-6 border-b border-line flex justify-between items-center bg-surface-2/60 sticky top-0 z-10">
              <h3 className="text-xl font-semibold text-fg">Edit Event & Banner</h3>
              <button
                onClick={() => { setShowEditModal(false); setEditingEvent(null); resetForm(); }}
                className="w-8 h-8 rounded-full bg-surface-2/60 hover:bg-surface-2 text-fg flex items-center justify-center text-lg transition-all"
               aria-label="Dismiss"><span aria-hidden="true" className="text-base leading-none">×</span></button>
            </header>

            <form onSubmit={handleEditEvent} className="p-8 space-y-6">
              {formError && (
                <div className="p-4 bg-danger-soft border border-danger/30 rounded-lg text-xs font-semibold text-danger-text">{formError}</div>
              )}

              {/* Title */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg-muted">Event Title</label>
                <input
                  type="text"
                  className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg outline-none focus:border-accent transition-all"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                />
              </div>

              {/* Extend End Time */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg-muted">End Time</label>
                <input
                  type="datetime-local"
                  className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg outline-none focus:border-accent transition-all"
                  value={formEnd}
                  onChange={e => setFormEnd(e.target.value)}
                />
                <div className="flex gap-1.5">
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
                      className="px-2.5 py-1 bg-surface-2/60 hover:bg-surface-2 text-fg-muted hover:text-fg rounded text-xs font-semibold transition-all"
                    >{opt.label}</button>
                  ))}
                </div>
              </div>

              {/* Banner Config */}
              <div className="space-y-4 p-5 bg-surface-2/60 rounded-lg border border-line">
                <h4 className="text-xs font-semibold text-warning-text">Moving Banner</h4>
                <textarea
                  rows={2}
                  className="w-full bg-surface-2/60 border border-line rounded-lg py-3 px-5 text-sm text-fg outline-none focus:border-accent transition-all resize-none"
                  value={formBannerText}
                  onChange={e => setFormBannerText(e.target.value)}
                />
                <div className="grid grid-cols-3 gap-2">
                  {GRADIENT_OPTIONS.map(g => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => setFormGradient(g.value)}
                      className={`py-2 rounded-xl text-xs font-semibold text-on-solid transition-all bg-accent ${g.css} ${
                        formGradient === g.value ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0D0D15] scale-105' : 'opacity-60 hover:opacity-90'
                      }`}
                    >{g.label}</button>
                  ))}
                </div>
                {formBannerText && (
                  <div className={`relative overflow-hidden rounded-xl h-9 bg-surface-2 ${getGradientCss(formGradient)}`}>
                    <div className="absolute inset-0 flex items-center whitespace-nowrap animate-marquee">
                      <span className="text-xs font-semibold text-fg px-4">
                        {formBannerText} &nbsp;&nbsp;&nbsp; {formBannerText}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Coupon Config */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-fg-muted">Winner Prize (₹)</label>
                  <input
                    type="number"
                    className="w-full bg-surface-2/60 border border-line rounded-lg py-3.5 px-5 text-sm text-fg outline-none focus:border-accent transition-all"
                    value={formCouponValue}
                    onChange={e => setFormCouponValue(Number(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-4 pt-4 border-t border-line">
                <button
                  type="button"
                  onClick={() => { setShowEditModal(false); setEditingEvent(null); resetForm(); }}
                  className="flex-1 py-3.5 bg-surface-2/60 hover:bg-surface-2 text-fg rounded-lg text-xs font-semibold transition-all"
                >Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="flex-1 py-3.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-solid rounded-lg text-xs font-semibold transition-all"
                >{formSubmitting ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Marquee Animation Style */}
      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 12s linear infinite;
        }
      `}</style>
    </div>
  );
}
