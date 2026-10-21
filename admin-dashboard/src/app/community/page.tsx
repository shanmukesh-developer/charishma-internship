"use client";

import {
  Badge, Button, DataTable, Drawer, Notice, PageHeader, SectionTitle, StatusPill, Tabs, useConfirm,
  type Column, IconRefresh,
} from '@/components/ui';
import { formatDateTime, formatNumber, plural } from '@/lib/format';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { API_URL } from '@/lib/config';
import { adminRequest as apiRequest } from '@/lib/api';

const getImageUrl = (url: string | null | undefined) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

/** fetch against the one backend; throws an Error carrying the server's friendly `message`. */
// Shape returned by GET /api/community (backend/models/CommunityPost.js)
interface CommunityPost {
  id: string;
  parentId: string | null;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  content: string;
  imageUrl?: string | null;
  likes: number;
  replyCount: number;
  postType: 'post' | 'review';
  starRating?: number | null;
  restaurantName?: string | null;
  productName?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  replies?: CommunityPost[];
}

interface BirthdayCelebration {
  id: string;
  candidateName: string;
  candidatePhotoUrl: string | null;
  birthdayDate: string; // YYYY-MM-DD
  status: string;
  wishCount: number;
  createdAt: string;
}

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  if (!dateStr || Number.isNaN(d.getTime())) return dateStr || '—';
  return formatDateTime(d, { short: true });
};

// birthdayDate is a plain calendar date; format without shifting time zones.
const formatDay = (ymd: string) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return ymd || '—';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export default function CommunityAdmin() {
  const confirm = useConfirm();
  const { isAuthed } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<'posts' | 'birthdays'>('posts');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [birthdays, setBirthdays] = useState<BirthdayCelebration[]>([]);
  const [activeBirthdays, setActiveBirthdays] = useState<BirthdayCelebration[]>([]);
  const [loadingBirthdays, setLoadingBirthdays] = useState(true);
  const [birthdaysError, setBirthdaysError] = useState<string | null>(null);
  const [actioningBdayId, setActioningBdayId] = useState<string | null>(null);
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoadingPosts(true);
    setPostsError(null);
    try {
      const data = await apiRequest<CommunityPost[] | { posts: CommunityPost[] }>('/api/community');
      setPosts(Array.isArray(data) ? data : (data?.posts || []));
    } catch (err) {
      setPostsError(err instanceof Error ? err.message : 'Could not load posts.');
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  const fetchBirthdays = useCallback(async () => {
    setLoadingBirthdays(true);
    setBirthdaysError(null);
    try {
      const [pending, active] = await Promise.all([
        apiRequest<BirthdayCelebration[]>('/api/birthdays/pending'),
        apiRequest<BirthdayCelebration[]>('/api/birthdays/active'),
      ]);
      setBirthdays(Array.isArray(pending) ? pending : []);
      setActiveBirthdays(Array.isArray(active) ? active : []);
    } catch (err) {
      setBirthdaysError(err instanceof Error ? err.message : 'Could not load birthdays.');
    } finally {
      setLoadingBirthdays(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    fetchPosts();
    fetchBirthdays();
  }, [isAuthed, fetchPosts, fetchBirthdays]);

  const flash = (msg: string) => { setNotice(msg); setError(null); };

  const handleDelete = async (post: CommunityPost, parent?: CommunityPost) => {
    if (deletingId) return;
    const what = parent ? 'reply' : 'post';
    const extra = !parent && post.replyCount > 0 ? ` Its ${post.replyCount} repl${post.replyCount === 1 ? 'y' : 'ies'} will be deleted too.` : '';
    if (!(await confirm({ title: `Delete this ${what} by ${post.userName || 'this student'}?`, description: `${extra.trim()} This cannot be undone.`.trim(), confirmLabel: `Delete ${what}`, tone: 'danger' }))) return;
    setDeletingId(post.id);
    setNotice(null);
    setError(null);
    try {
      await apiRequest(`/api/community/${post.id}`, { method: 'DELETE' });
      if (parent) {
        setPosts(prev => prev.map(p => p.id === parent.id
          ? { ...p, replies: (p.replies || []).filter(r => r.id !== post.id), replyCount: Math.max((p.replyCount || 1) - 1, 0) }
          : p));
      } else {
        setPosts(prev => prev.filter(p => p.id !== post.id));
      }
      flash(`The ${what} was deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete it.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleApproveBday = async (b: BirthdayCelebration) => {
    if (actioningBdayId) return;
    const isToday = b.birthdayDate === istToday();
    if (!(await confirm(isToday
      ? { title: `Approve ${b.candidateName}’s birthday?`, description: 'It goes live now and every active student gets a push notification.', confirmLabel: 'Approve and notify' }
      : { title: `Approve ${b.candidateName}’s birthday for ${formatDay(b.birthdayDate)}?`, description: 'It shows in the app on that day.', confirmLabel: 'Approve' }))) return;
    setActioningBdayId(b.id);
    setNotice(null);
    setError(null);
    try {
      const res = await apiRequest<{ message?: string }>(`/api/birthdays/${b.id}/approve`, { method: 'PUT' });
      flash(res?.message || 'Birthday approved.');
      await fetchBirthdays();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve the birthday.');
    } finally {
      setActioningBdayId(null);
    }
  };

  const handleRejectBday = async (b: BirthdayCelebration) => {
    if (actioningBdayId) return;
    if (!(await confirm({ title: `Reject ${b.candidateName}’s birthday request?`, confirmLabel: 'Reject', tone: 'danger' }))) return;
    setActioningBdayId(b.id);
    setNotice(null);
    setError(null);
    try {
      const res = await apiRequest<{ message?: string }>(`/api/birthdays/${b.id}/reject`, { method: 'PUT' });
      flash(res?.message || 'Birthday request rejected.');
      await fetchBirthdays();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject the birthday.');
    } finally {
      setActioningBdayId(null);
    }
  };

  const renderPostBody = (post: CommunityPost) => (
    <>
      {post.postType === 'review' && (
        <p className="text-sm text-warning-text">
          {'★'.repeat(Math.max(0, Math.min(5, Math.round(Number(post.starRating) || 0))))}
          <span className="text-fg-muted">
            {' '}{[post.restaurantName, post.productName].filter(Boolean).join(' · ')}
          </span>
        </p>
      )}
      {post.content && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{post.content}</p>}
      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={getImageUrl(post.imageUrl)} loading="lazy" decoding="async" alt="Post attachment" className="max-h-72 w-full rounded-lg border border-line bg-surface-2 object-cover" />
      )}
    </>
  );

  const openPost = openPostId ? posts.find(p => p.id === openPostId) || null : null;

  const postColumns: Column<CommunityPost>[] = [
    { key: 'type', header: 'Type', width: '90px', sortValue: p => p.postType, cell: p => <Badge tone={p.postType === 'review' ? 'warning' : 'info'}>{p.postType === 'review' ? 'Review' : 'Post'}</Badge> },
    { key: 'author', header: 'Author', sortValue: p => p.userName || '', cell: p => <span className="whitespace-nowrap text-fg">{p.userName || 'Unknown'}</span> },
    {
      key: 'content',
      header: 'Content',
      cell: p => (
        <div className="max-w-[460px]">
          <p className="line-clamp-2 break-words text-sm text-fg">
            {p.postType === 'review' && <span className="text-warning-text">{'★'.repeat(Math.max(0, Math.min(5, Math.round(Number(p.starRating) || 0))))} </span>}
            {p.content || (p.imageUrl ? 'Photo' : '–')}
          </p>
          {p.postType === 'review' && (p.restaurantName || p.productName) && <p className="truncate text-xs text-fg-muted">{[p.restaurantName, p.productName].filter(Boolean).join(' · ')}</p>}
        </div>
      ),
    },
    { key: 'likes', header: 'Likes', align: 'right', hideBelow: 'lg', sortValue: p => p.likes || 0, cell: p => <span className="tabular-nums">{formatNumber(p.likes || 0)}</span> },
    { key: 'replies', header: 'Replies', align: 'right', hideBelow: 'lg', sortValue: p => p.replyCount || 0, cell: p => <span className="tabular-nums">{formatNumber(p.replyCount || 0)}</span> },
    { key: 'created', header: 'Posted', align: 'right', sortValue: p => new Date(p.createdAt), cell: p => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(p.createdAt)}</span> },
    { key: 'expires', header: 'Expires', align: 'right', hideBelow: 'xl', sortValue: p => (p.expiresAt ? new Date(p.expiresAt) : null), cell: p => <span className="whitespace-nowrap text-xs text-fg-muted">{p.expiresAt ? formatDate(p.expiresAt) : 'Never'}</span> },
  ];

  const personCell = (b: BirthdayCelebration) => (
    <div className="flex min-w-0 items-center gap-3">
      {b.candidatePhotoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={getImageUrl(b.candidatePhotoUrl)} loading="lazy" decoding="async" alt="" className="h-9 w-9 shrink-0 rounded-full border border-line bg-surface-2 object-cover" />
      ) : <div aria-hidden className="h-9 w-9 shrink-0 rounded-full border border-line bg-surface-2" />}
      <span className="truncate font-medium text-fg">{b.candidateName}</span>
    </div>
  );

  const pendingColumns: Column<BirthdayCelebration>[] = [
    { key: 'name', header: 'Student', sortValue: b => b.candidateName, cell: personCell },
    {
      key: 'date',
      header: 'Birthday',
      sortValue: b => b.birthdayDate,
      cell: b => {
        const isToday = b.birthdayDate === istToday();
        const isPast = b.birthdayDate < istToday();
        return (
          <div>
            <p className="whitespace-nowrap text-fg">{formatDay(b.birthdayDate)}{isToday && <Badge tone="info" className="ml-2">Today</Badge>}</p>
            {isPast && <p className="text-xs text-warning-text">Date has passed; it can only be rejected.</p>}
          </div>
        );
      },
    },
    { key: 'requested', header: 'Requested', hideBelow: 'lg', sortValue: b => new Date(b.createdAt), cell: b => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDate(b.createdAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: b => {
        const isToday = b.birthdayDate === istToday();
        const isPast = b.birthdayDate < istToday();
        return (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="text-danger-text" disabled={actioningBdayId === b.id} onClick={() => handleRejectBday(b)}>Reject</Button>
            <Button size="sm" variant="primary" disabled={isPast || (!!actioningBdayId && actioningBdayId !== b.id)} loading={actioningBdayId === b.id} onClick={() => handleApproveBday(b)}>{isToday ? 'Approve and notify' : 'Approve'}</Button>
          </div>
        );
      },
    },
  ];

  const liveColumns: Column<BirthdayCelebration>[] = [
    { key: 'name', header: 'Student', sortValue: b => b.candidateName, cell: personCell },
    { key: 'wishes', header: 'Wishes received', align: 'right', sortValue: b => b.wishCount || 0, cell: b => <span className="tabular-nums">{formatNumber(b.wishCount || 0)}</span> },
    { key: 'status', header: 'Status', align: 'right', cell: () => <StatusPill status="Live" tone="success" label="Live" /> },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Community posts"
        description="Posts, reviews and birthday wishes shown in the community feed. Delete anything that breaks the rules."
        actions={(
          <Button
            leftIcon={<IconRefresh size={14} />}
            loading={activeTab === 'posts' ? loadingPosts : loadingBirthdays}
            onClick={() => (activeTab === 'posts' ? fetchPosts() : fetchBirthdays())}
          >
            Refresh
          </Button>
        )}
      />

      <Tabs<'posts' | 'birthdays'>
        className="mb-4"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'posts', label: 'Posts', count: loadingPosts ? null : posts.length },
          { id: 'birthdays', label: 'Birthday queue', count: loadingBirthdays ? null : birthdays.length, attention: birthdays.length > 0 },
        ]}
      />

      <div className="space-y-3">
        {error && <Notice tone="danger" className="mb-3" onClose={() => setError(null)}>{error}</Notice>}
        {notice && <Notice tone="success" className="mb-3" onClose={() => setNotice(null)}>{notice}</Notice>}
      </div>

      {activeTab === 'posts' ? (
        <>
          <p className="mb-3 text-sm text-fg-muted">
            Live posts from the last 48 hours plus reviews (newest 50). Click a post to read it in full and manage replies. To message students, use{' '}
            <Link href="/notifications" className="text-accent-text hover:underline">Push notifications</Link>.
          </p>
          <DataTable
            caption="Community posts"
            columns={postColumns}
            rows={posts}
            rowKey={p => p.id}
            loading={loadingPosts && posts.length === 0}
            error={postsError}
            onRetry={fetchPosts}
            onRowClick={p => setOpenPostId(p.id)}
            initialSort={{ key: 'created', dir: 'desc' }}
            noun="posts"
            empty={{ title: 'No live community posts', description: 'Posts expire after 48 hours; reviews stay.' }}
          />
        </>
      ) : (
        <div className="space-y-6">
          <section>
            <SectionTitle title="Pending requests" description="Approve a birthday to show it on that day. Approving today’s birthday sends a push to every active student." />
            <DataTable
              caption="Pending birthday requests"
              columns={pendingColumns}
              rows={birthdays}
              rowKey={b => b.id}
              loading={loadingBirthdays && birthdays.length === 0}
              error={birthdaysError}
              onRetry={fetchBirthdays}
              initialSort={{ key: 'date', dir: 'asc' }}
              noun="requests"
              empty={{ title: 'No pending birthday requests' }}
            />
          </section>
          <section>
            <SectionTitle title="Live today" />
            <DataTable
              caption="Birthdays live today"
              columns={liveColumns}
              rows={activeBirthdays}
              rowKey={b => b.id}
              loading={loadingBirthdays && activeBirthdays.length === 0}
              noun="birthdays"
              empty={{ title: 'No birthdays live today' }}
            />
          </section>
        </div>
      )}

      <Drawer
        open={!!openPost}
        onClose={() => setOpenPostId(null)}
        size="md"
        title={openPost ? `${openPost.postType === 'review' ? 'Review' : 'Post'} by ${openPost.userName || 'Unknown'}` : 'Post'}
        description={openPost ? `Posted ${formatDate(openPost.createdAt)}${openPost.expiresAt ? ` · expires ${formatDate(openPost.expiresAt)}` : ''}` : undefined}
        footer={openPost ? (
          <Button variant="destructive" disabled={!!deletingId} loading={deletingId === openPost.id} onClick={() => handleDelete(openPost)}>Delete {openPost.postType === 'review' ? 'review' : 'post'}</Button>
        ) : undefined}
      >
        {openPost && (
          <div className="space-y-4">
            <div className="space-y-3">{renderPostBody(openPost)}</div>
            <p className="text-xs text-fg-muted">{plural(openPost.likes || 0, 'like')} · {plural(openPost.replyCount || 0, 'reply', 'replies')}</p>
            <div>
              <p className="mb-2 text-xs text-fg-muted">Replies</p>
              {(openPost.replies || []).length === 0 ? (
                <p className="rounded-lg border border-line p-3 text-sm text-fg-muted">No replies.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {(openPost.replies || []).map(reply => (
                    <li key={reply.id} className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="text-xs text-fg-muted"><span className="font-medium text-fg">{reply.userName || 'Unknown'}</span> · {formatDate(reply.createdAt)}</p>
                        <p className="mt-0.5 break-words text-sm text-fg">{reply.content}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="shrink-0 text-danger-text" disabled={!!deletingId} loading={deletingId === reply.id} onClick={() => handleDelete(reply, openPost)}>Delete</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
