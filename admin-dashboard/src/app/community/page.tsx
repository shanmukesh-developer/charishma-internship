"use client";

import { useConfirm } from '@/components/ui';
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
  if (Number.isNaN(d.getTime())) return dateStr || '—';
  return d.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    if (!(await confirm({ title: `Delete this ${what} by ${post.userName || 'this student'}?${extra} This cannot be undone.` }))) return;
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
    const question = isToday
      ? `Approve ${b.candidateName}'s birthday? It goes live now and every active student gets a push notification.`
      : `Approve ${b.candidateName}'s birthday for ${formatDay(b.birthdayDate)}? It shows on the app on that day.`;
    if (!(await confirm({ title: question }))) return;
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
    if (!(await confirm({ title: `Reject ${b.candidateName}'s birthday request?` }))) return;
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
        <p className="text-xs text-warning-text font-semibold">
          {'★'.repeat(Math.max(0, Math.min(5, Math.round(Number(post.starRating) || 0))))}
          <span className="text-fg-muted font-normal">
            {' '}{[post.restaurantName, post.productName].filter(Boolean).join(' · ')}
          </span>
        </p>
      )}
      {post.content && <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap break-words line-clamp-6">{post.content}</p>}
      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={getImageUrl(post.imageUrl)} loading="lazy" decoding="async" alt="Post attachment" className="w-full max-h-56 object-cover rounded-xl border border-line bg-surface-2" />
      )}
    </>
  );

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Community posts</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Posts and birthday wishes shown in the community feed.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('posts')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${activeTab === 'posts' ? 'bg-accent border-accent/30 text-on-solid' : 'bg-surface-2/60 border-line text-fg-muted hover:bg-surface-2'}`}
          >
            Posts
          </button>
          <button
            onClick={() => setActiveTab('birthdays')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all border ${activeTab === 'birthdays' ? 'bg-accent border-accent/30 text-on-solid' : 'bg-surface-2/60 border-line text-fg-muted hover:bg-surface-2'}`}
          >
            Birthday Queue {birthdays.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs bg-danger text-on-solid rounded-full">{birthdays.length}</span>}
          </button>
        </div>
      </header>

      {error && <div className="p-4 rounded-xl border border-danger/30 bg-danger-soft text-sm font-semibold text-danger-text">{error}</div>}
      {notice && <div className="p-4 rounded-xl border border-success/30 bg-success-soft text-sm font-semibold text-success-text">{notice}</div>}

      {activeTab === 'posts' ? (
        <>
          <div className="flex justify-between items-center flex-wrap gap-3">
            <p className="text-xs text-fg-muted">
              Live posts from the last 48 hours plus reviews (newest 50). To message students, use{' '}
              <Link href="/notifications" className="text-accent-text underline">Push Notifications</Link>.
            </p>
            <button onClick={fetchPosts} disabled={loadingPosts} className="px-4 py-2 bg-surface-2/60 border border-line rounded-xl text-xs font-semibold text-fg-muted hover:bg-surface-2 disabled:opacity-50">
              ↻ Refresh
            </button>
          </div>

          {loadingPosts ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-2 border-accent/30 border-t-accent/30 rounded-full animate-spin" />
            </div>
          ) : postsError ? (
            <div className="py-12 text-center rounded-lg border border-line bg-surface shadow-xs border border-line space-y-3">
              <p className="text-sm font-semibold text-danger-text">{postsError}</p>
              <button onClick={fetchPosts} className="text-xs font-semibold text-fg-muted underline">Retry</button>
            </div>
          ) : posts.length === 0 ? (
            <div className="py-16 text-center text-fg-subtle text-xs">No live community posts.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {posts.map(post => (
                <div key={post.id} className="rounded-lg border border-line bg-surface shadow-xs p-5 space-y-3">
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${post.postType === 'review' ? 'text-warning-text border-warning/30 bg-warning-soft' : 'text-info-text border-info/30 bg-info-soft'}`}>
                        {post.postType === 'review' ? 'Review' : 'Post'}
                      </span>
                      <span className="text-xs font-semibold text-fg-muted">{post.userName || 'Unknown'}</span>
                      <span className="text-xs text-fg-muted">{formatDate(post.createdAt)}</span>
                    </div>
                    <button
                      onClick={() => handleDelete(post)}
                      disabled={deletingId === post.id}
                      className="shrink-0 px-3 py-1.5 bg-danger-soft border border-danger/30 text-danger-text text-xs font-semibold rounded-lg hover:bg-danger-soft disabled:opacity-50 transition-all"
                    >
                      {deletingId === post.id ? '...' : 'Delete'}
                    </button>
                  </div>

                  {renderPostBody(post)}

                  <div className="border-t border-line pt-3 flex items-center gap-3 text-xs text-fg-muted">
                    <span>{post.likes || 0}</span>
                    <span>{post.replyCount || 0}</span>
                    {post.expiresAt && <span className="ml-auto">Expires {formatDate(post.expiresAt)}</span>}
                  </div>

                  {(post.replies || []).length > 0 && (
                    <div className="space-y-2 pl-3 border-l border-line">
                      {(post.replies || []).map(reply => (
                        <div key={reply.id} className="flex justify-between items-start gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-fg-muted"><span className="font-semibold text-fg-muted">{reply.userName || 'Unknown'}</span> · {formatDate(reply.createdAt)}</p>
                            <p className="text-xs text-fg break-words">{reply.content}</p>
                          </div>
                          <button
                            onClick={() => handleDelete(reply, post)}
                            disabled={deletingId === reply.id}
                            className="shrink-0 text-xs font-semibold text-danger-text hover:underline disabled:opacity-50"
                          >
                            {deletingId === reply.id ? '...' : 'Delete'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-6">
          {birthdaysError && (
            <div className="p-4 rounded-xl border border-danger/30 bg-danger-soft text-sm font-semibold text-danger-text flex justify-between gap-4">
              <span>{birthdaysError}</span>
              <button onClick={fetchBirthdays} className="text-xs font-semibold underline">Retry</button>
            </div>
          )}

          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
              <span></span> Pending Requests ({birthdays.length})
            </h3>
            {loadingBirthdays ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-accent/30 border-t-accent/30 rounded-full animate-spin" />
              </div>
            ) : birthdays.length === 0 ? (
              <div className="py-10 text-center text-fg-subtle text-xs rounded-lg border border-line bg-surface shadow-xs border border-line">No pending birthday requests.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {birthdays.map(b => {
                  const isToday = b.birthdayDate === istToday();
                  const isPast = b.birthdayDate < istToday();
                  return (
                    <div key={b.id} className="rounded-lg border border-line bg-surface shadow-xs p-4 border border-line flex flex-col justify-between gap-4">
                      <div className="flex gap-4">
                        {b.candidatePhotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={getImageUrl(b.candidatePhotoUrl)} loading="lazy" decoding="async" alt={b.candidateName} className="w-16 h-16 rounded-xl object-cover border border-line bg-surface-2" />
                        ) : (
                          <div className="w-16 h-16 rounded-xl bg-accent-soft border border-accent/30 flex items-center justify-center text-lg"></div>
                        )}
                        <div>
                          <h4 className="font-semibold text-fg text-sm">{b.candidateName}</h4>
                          <p className="text-xs text-accent-text font-semibold mt-0.5">
                            Birthday: {formatDay(b.birthdayDate)}{isToday ? ' (today)' : ''}
                          </p>
                          <p className="text-xs text-fg-muted mt-1">Requested {formatDate(b.createdAt)}</p>
                          {isPast && <p className="text-xs text-warning-text mt-1">This date has passed. It can only be rejected.</p>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRejectBday(b)}
                          disabled={actioningBdayId === b.id}
                          className="flex-1 py-2 bg-danger-soft border border-danger/30 text-danger-text text-xs font-semibold rounded-xl hover:bg-danger-soft transition-all disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleApproveBday(b)}
                          disabled={actioningBdayId === b.id || isPast}
                          className="flex-[2] py-2 bg-accent hover:bg-accent-hover text-on-solid text-xs font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actioningBdayId === b.id ? '...' : isToday ? 'Approve & Notify' : 'Approve'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-4 pt-4 border-t border-line">
            <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
              <span></span> Live Today ({activeBirthdays.length})
            </h3>
            {loadingBirthdays ? null : activeBirthdays.length === 0 ? (
              <div className="py-10 text-center text-fg-subtle text-xs rounded-lg border border-line bg-surface shadow-xs border border-line">No birthdays live today.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeBirthdays.map(b => (
                  <div key={b.id} className="rounded-lg border border-line bg-surface shadow-xs p-4 border border-accent/30 bg-accent-soft flex items-center justify-between gap-4">
                    <div className="flex gap-3 items-center">
                      {b.candidatePhotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getImageUrl(b.candidatePhotoUrl)} loading="lazy" decoding="async" alt={b.candidateName} className="w-12 h-12 rounded-full object-cover border-2 border-accent/30" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-accent-soft flex items-center justify-center text-md"></div>
                      )}
                      <div>
                        <h4 className="font-semibold text-fg text-xs">{b.candidateName}</h4>
                        <p className="text-xs text-fg-muted">Wishes received: {b.wishCount || 0}</p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 bg-success-soft border border-success/30 text-success-text text-xs font-semibold rounded-full">
                      Live
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
