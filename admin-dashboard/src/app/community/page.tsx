"use client";

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface CommunityPost {
  id: string;
  content: string;
  category: string;
  isAnonymous: boolean;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
  expiresAt?: string;
  user?: { name: string; phone: string };
}

const categoryColors: Record<string, string> = {
  General: 'text-blue-400 border-blue-500/20 bg-blue-500/10',
  Food: 'text-orange-400 border-orange-500/20 bg-orange-500/10',
  Event: 'text-purple-400 border-purple-500/20 bg-purple-500/10',
  Alert: 'text-red-400 border-red-500/20 bg-red-500/10',
  Meme: 'text-yellow-400 border-yellow-500/20 bg-yellow-500/10',
};

export default function CommunityAdmin() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/community/posts?limit=50`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // Handle both { posts: [] } and direct [] responses
        setPosts(Array.isArray(data) ? data : (data.posts || []));
      }
    } catch (err) {
      console.error('[COMMUNITY_ADMIN_FETCH_ERROR]', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API_URL}/api/community/posts/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setPosts(prev => prev.filter(p => p.id !== id));
      }
    } catch (err) {
      console.error('[COMMUNITY_DELETE_ERROR]', err);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
  };

  const isExpired = (expiresAt?: string) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white">Community <span className="text-purple-400">Posts</span></h1>
          <p className="text-[11px] text-gray-500 uppercase tracking-widest mt-1">{posts.length} posts · Content moderation</p>
        </div>
        <button onClick={fetchPosts} className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-wider text-gray-400 hover:bg-white/10 transition-all">
          ↻ Refresh
        </button>
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="py-16 text-center text-gray-600 text-xs italic">No community posts found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map(post => (
            <div
              key={post.id}
              className={`glass-card p-5 space-y-3 ${isExpired(post.expiresAt) ? 'opacity-50' : ''}`}
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${categoryColors[post.category] || 'text-gray-400 border-white/10'}`}>
                    {post.category || 'General'}
                  </span>
                  {post.isAnonymous && (
                    <span className="text-[8px] font-black text-gray-500 border border-white/10 px-2 py-0.5 rounded-full uppercase">
                      Anonymous
                    </span>
                  )}
                  {isExpired(post.expiresAt) && (
                    <span className="text-[8px] font-black text-red-400 border border-red-500/20 bg-red-500/10 px-2 py-0.5 rounded-full uppercase">
                      Expired
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(post.id)}
                  disabled={deletingId === post.id}
                  className="shrink-0 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-all"
                >
                  {deletingId === post.id ? '...' : '🗑 Delete'}
                </button>
              </div>

              <p className="text-sm text-white leading-relaxed line-clamp-4">{post.content}</p>

              <div className="border-t border-white/5 pt-3 flex justify-between items-center">
                <div className="text-[10px] text-gray-500">
                  {!post.isAnonymous && post.user ? (
                    <span className="font-bold text-gray-400">{post.user.name}</span>
                  ) : (
                    <span className="italic">Anonymous</span>
                  )}
                  <span className="ml-2">{formatDate(post.createdAt)}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-gray-500">
                  <span>❤️ {post.likesCount || 0}</span>
                  <span>💬 {post.commentsCount || 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
