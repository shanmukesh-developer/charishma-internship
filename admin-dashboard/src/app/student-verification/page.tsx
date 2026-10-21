"use client";

import {
  Button, DataTable, DescriptionList, Drawer, Field, Notice as NoticeBox, PageHeader, SegmentedControl, StatusPill, Textarea, Toolbar,
  useConfirm, type Column, IconExternal, IconImage,
} from '@/components/ui';
import { formatDateTime, formatPhone, humanize } from '@/lib/format';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { API_URL } from '@/lib/config';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { useLiveSync, useFreshIds, liveLabel, FRESH_ROW_CLASS } from '@/lib/useLiveSync';

type VerificationStatus = 'pending' | 'approved' | 'rejected';

interface VerificationRequest {
  id: string;
  userId: string;
  userName: string;
  userPhone: string | null;
  type: string;
  collegeEmail: string | null;
  idCardImageUrl: string | null;
  status: VerificationStatus;
  reviewNotes: string | null;
  createdAt: string;
}

const FILTERS: { label: string; status: VerificationStatus }[] = [
  { label: 'Pending', status: 'pending' },
  { label: 'Approved', status: 'approved' },
  { label: 'Rejected', status: 'rejected' },
];

const imageUrl = (url: string | null) => {
  if (!url) return null;
  return url.startsWith('http') || url.startsWith('data:') ? url : `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

export default function StudentVerificationPage() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [status, setStatus] = useState<VerificationStatus>('pending');
  const [retryCount, setRetryCount] = useState(0);
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped by realtime events; such reloads keep the current list on screen (no spinner, no error banner).
  const [liveTick, setLiveTick] = useState(0);
  const quietReload = useRef(false);
  const { notifyLive } = useAdminSocket();
  const { mark: markFresh, isFresh } = useFreshIds();

  useLiveSync(['verification'], (events, { reconnect }) => {
    quietReload.current = true;
    setLiveTick(t => t + 1);
    if (reconnect) return;
    markFresh(events.map(e => e.id));
    const label = liveLabel(events.filter(e => e.action === 'created'), 'verification request');
    if (label) notifyLive(label);
  }, { enabled: isAuthed });

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    const quiet = quietReload.current;
    quietReload.current = false;
    const loadRequests = async () => {
      if (!quiet) {
        setLoading(true);
        setError('');
      }
      try {
        const response = await fetch(`${API_URL}/api/campus/verify/requests?status=${status}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(response.status === 401 ? 'Your session has expired. Please sign in again.'
            : response.status >= 500 ? 'The server had a problem loading requests. Please try again.'
            : data.message || 'Could not load verification requests.');
        }
        if (active) setRequests(Array.isArray(data.requests) ? data.requests : []);
      } catch (loadError) {
        if (active && !quiet) setError(loadError instanceof TypeError ? 'Could not reach the server. Check your connection.' : loadError instanceof Error ? loadError.message : 'Could not load verification requests.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRequests();
    return () => { active = false; };
  }, [status, retryCount, isAuthed, liveTick]);

  const reviewRequest = async (request: VerificationRequest, action: 'approve' | 'reject') => {
    if (action === 'approve' && !(await confirm({ title: `Approve ${request.userName || 'this student'} as a verified student?`, description: 'The student is marked as verified.', confirmLabel: 'Approve' }))) return;
    // Rejection already has its own explicit "Confirm rejection" step.
    if (actingId) return;

    setActingId(request.id);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/campus/verify/${request.id}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: action === 'reject' ? reviewNotes.trim() : undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(response.status >= 500 ? 'The server had a problem saving this review. Please try again.'
          : data.message || 'Could not review this request.');
      }
      setRequests(current => current.filter(item => item.id !== request.id));
      setOpenId(null);
      setRejectingId(null);
      setReviewNotes('');
    } catch (reviewError) {
      setError(reviewError instanceof TypeError ? 'Could not reach the server. Nothing was changed.' : reviewError instanceof Error ? reviewError.message : 'Could not review this request.');
    } finally {
      setActingId(null);
    }
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const open = openId ? requests.find(r => r.id === openId) || null : null;
  const tone = (s: VerificationStatus) => (s === 'pending' ? 'warning' : s === 'approved' ? 'success' : 'danger') as 'warning' | 'success' | 'danger';

  const columns: Column<VerificationRequest>[] = [
    {
      key: 'student',
      header: 'Student',
      sortValue: r => r.userName || '',
      cell: r => {
        const cardUrl = imageUrl(r.idCardImageUrl);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-2 text-fg-subtle">
              {cardUrl ? <Image src={cardUrl} alt="" width={56} height={40} unoptimized className="h-full w-full object-cover" /> : <IconImage size={16} />}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{r.userName || 'Unknown student'}</p>
              <p className="truncate text-xs text-fg-muted">{r.userPhone ? formatPhone(r.userPhone) : 'No phone'}</p>
            </div>
          </div>
        );
      },
    },
    { key: 'type', header: 'Submitted', cell: r => <span className="text-fg">{humanize(r.type)}</span> },
    { key: 'email', header: 'College email', hideBelow: 'lg', cell: r => <span className="break-all text-fg-muted">{r.collegeEmail || 'Not provided'}</span> },
    { key: 'status', header: 'Status', cell: r => <StatusPill status={r.status} tone={tone(r.status)} /> },
    { key: 'created', header: 'Received', align: 'right', sortValue: r => new Date(r.createdAt), cell: r => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(r.createdAt, { short: true })}</span> },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Student verification"
        description="Check college email and student ID submissions. Up to 100 requests per status, oldest first."
      />

      <Toolbar end={<span className="text-sm tabular-nums text-fg-muted">{requests.length} {status} {requests.length === 1 ? 'request' : 'requests'}</span>}>
        <SegmentedControl ariaLabel="Request status" value={status} onChange={v => { setStatus(v); setOpenId(null); }} options={FILTERS.map(f => ({ value: f.status, label: f.label }))} />
      </Toolbar>

      <DataTable
        caption="Verification requests"
        columns={columns}
        rows={requests}
        rowKey={r => r.id}
        loading={loading}
        error={error || null}
        onRetry={() => setRetryCount(count => count + 1)}
        onRowClick={r => { setOpenId(r.id); setRejectingId(null); setReviewNotes(''); }}
        rowClassName={r => (isFresh(r.id) ? FRESH_ROW_CLASS : undefined)}
        noun="requests"
        empty={{ title: `No ${status} requests`, description: 'New student submissions appear here.' }}
      />

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        size="lg"
        title={open?.userName || 'Student'}
        description={open ? `${humanize(open.type)} · received ${formatDateTime(open.createdAt)}` : undefined}
        headerActions={open ? <StatusPill status={open.status} tone={tone(open.status)} /> : undefined}
        footer={open && status === 'pending' ? (
          rejectingId === open.id ? (
            <>
              <Button onClick={() => setRejectingId(null)} disabled={actingId === open.id}>Keep pending</Button>
              <Button variant="destructive" loading={actingId === open.id} onClick={() => reviewRequest(open, 'reject')}>Confirm rejection</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="text-danger-text hover:text-danger-text" disabled={!!actingId} onClick={() => { setRejectingId(open.id); setReviewNotes(''); }}>Reject</Button>
              <Button variant="primary" loading={actingId === open.id} onClick={() => reviewRequest(open, 'approve')}>Approve</Button>
            </>
          )
        ) : undefined}
      >
        {open && (
          <div className="space-y-5">
            {error && <NoticeBox tone="danger"><span className="text-fg">{error}</span></NoticeBox>}
            {(() => {
              const cardUrl = imageUrl(open.idCardImageUrl);
              return cardUrl ? (
                <a href={cardUrl} target="_blank" rel="noreferrer" aria-label={`Open the ID card for ${open.userName}`} className="block overflow-hidden rounded-lg border border-line bg-surface-2">
                  <Image src={cardUrl} alt={`Student ID submitted by ${open.userName}`} width={640} height={400} unoptimized className="max-h-[360px] w-full object-contain" />
                  <span className="flex items-center justify-center gap-1 border-t border-line py-1.5 text-xs font-medium text-accent-text">Open the full image <IconExternal size={12} /></span>
                </a>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-line text-sm text-fg-muted">No ID image attached</div>
              );
            })()}
            <DescriptionList
              columns={2}
              items={[
                { label: 'College email', value: <span className="break-all">{open.collegeEmail || 'Not provided'}</span> },
                { label: 'Phone', value: open.userPhone ? formatPhone(open.userPhone) : 'Not provided' },
                ...(open.reviewNotes ? [{ label: 'Review notes', value: open.reviewNotes }] : []),
              ]}
            />
            {rejectingId === open.id && (
              <Field label="Rejection notes" optional hint="Explain what needs correcting. The student sees this.">
                <Textarea value={reviewNotes} onChange={event => setReviewNotes(event.target.value)} maxLength={500} rows={3} />
              </Field>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
