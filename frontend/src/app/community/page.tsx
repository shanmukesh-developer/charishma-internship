"use client";
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Magnetic from '@/components/Magnetic';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/utils/api';



interface PostType {
  id: string;
  parentId: string | null;
  userId: string;
  userName: string;
  userAvatar: string | null;
  content: string;
  imageUrl: string | null;
  likes: number;
  likedBy: string[];
  replyCount: number;
  createdAt: string;
  expiresAt?: string | null;
  replies?: PostType[];
}



export default function CommunityPage() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [posts, setPosts] = useState<PostType[]>([]);
  const [draft, setDraft] = useState('');
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'reviews'>('all');
  
  // Review specific fields
  const [isReviewDraft, setIsReviewDraft] = useState(false);
  const [starRating, setStarRating] = useState(5);
  const [restaurantName, setRestaurantName] = useState('');
  const [productName, setProductName] = useState('');


  const [isPosting, setIsPosting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [replyingTo, setReplyingTo] = useState<PostType | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [customAuthorName, setCustomAuthorName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    setOnlineCount(Math.floor(Math.random() * 20) + 8);
    const stored = localStorage.getItem('user');
    if (stored) {
      const pUser = JSON.parse(stored);
      setUser(pUser);
      if (pUser.name) setCustomAuthorName(pUser.name);
    }
    else router.push('/login');

    fetchPosts();
    const interval = setInterval(fetchPosts, 10000);

    // Purge expired posts from local state every minute
    const expiryInterval = setInterval(() => {
      setPosts(prev => prev.filter(p => !p.expiresAt || new Date(p.expiresAt) > new Date()));
    }, 60 * 1000);

    return () => { clearInterval(interval); clearInterval(expiryInterval); };
  }, [router]);

  const fetchPosts = async () => {
    try {
      const endpoint = activeTab === 'reviews' ? `${API_URL}/api/community/reviews` : `${API_URL}/api/community`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        const ERROR_PATTERNS = [
          /^INVALID\s/i, /^PAYMENT\s/i, /^ERROR:/i, /^FAILED:/i,
          /^DB\s/i, /^SQL/i, /^SEQUELIZE/i, /SequelizeValidation/i,
          /^TypeError/i, /^ReferenceError/i, /^UnhandledPromise/i
        ];
        const cleanPosts = data.filter((p: any) => {
          if (!p.content) return true;
          return !ERROR_PATTERNS.some(rx => rx.test(p.content.trim()));
        });
        setPosts(cleanPosts);
      }
    } catch (e) { console.error('Fetch error:', e); }
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    setIsLoading(true);
    fetchPosts();
  }, [activeTab]);

  const handleImageUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const token = 'cookie-managed';
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setDraftImage(data.imageUrl);
    } catch (e) { console.error('Image upload error:', e); }
    finally { setIsUploading(false); }
  };

  const handleDeletePost = async (id: string, parentId: string | null) => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/community/${id}`, {
        method: 'DELETE',
        });
      if (res.ok) {
        const removePost = (postsList: PostType[]): PostType[] => {
          return postsList.filter(p => p.id !== id).map(p => ({
            ...p,
            replies: p.replies ? removePost(p.replies) : []
          }));
        };
        setPosts(prev => removePost(prev));
      } else {
        console.error('Failed to delete post');
      }
    } catch (e) { console.error('Delete error:', e); }
  };

  const handlePost = async () => {
    if (!draft.trim() && !draftImage) return;
    setIsPosting(true);
    try {
      const token = 'cookie-managed';
      const body: Record<string, string> = { content: draft };
      if (draftImage) body.imageUrl = draftImage;
      if (replyingTo) body.parentId = replyingTo.id;
      if (draftCategory) body.category = draftCategory;
      if (customAuthorName) body.authorName = customAuthorName;
      if (isReviewDraft) {
        body.postType = 'review';
        body.starRating = starRating.toString();
        body.restaurantName = restaurantName;
        body.productName = productName;
      }

      const res = await fetch(`${API_URL}/api/community`, {

        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const newPost = await res.json();
        if (replyingTo) {
          // Insert into the correct thread
          setPosts(prev => prev.map(p => {
            if (p.id === replyingTo.id) {
              return { ...p, replyCount: (p.replyCount || 0) + 1, replies: [...(p.replies || []), newPost] };
            }
            return p;
          }));
          // Auto-expand the thread
          setExpandedThreads(prev => new Set([...prev, replyingTo.id]));
        } else {
          setPosts(prev => [{ ...newPost, replies: [] }, ...prev]);
        }
        setDraft('');
        setDraftImage(null);
        setDraftCategory('');
        setReplyingTo(null);
        setIsReviewDraft(false);
        setRestaurantName('');
        setProductName('');
        setShowComposer(false);
        fetchPosts(); // Refresh active tab
      } else if (res.status === 401) {

        router.push('/login');
      }
    } catch (error) { console.error('Post error:', error); }
    finally { setIsPosting(false); }
  };

  const handleLike = async (id: string, currentLikedBy: string[]) => {
    if (!user) return;
    const isLiked = currentLikedBy.includes(user.id);
    const updateLike = (p: PostType): PostType => {
      if (p.id === id) {
        return { ...p, likes: isLiked ? Math.max(0, p.likes - 1) : p.likes + 1, likedBy: isLiked ? p.likedBy.filter(u => u !== user.id) : [...p.likedBy, user.id] };
      }
      if (p.replies) {
        return { ...p, replies: p.replies.map(updateLike) };
      }
      return p;
    };
    setPosts(prev => prev.map(updateLike));

    try {
      const token = 'cookie-managed';
      await fetch(`${API_URL}/api/community/${id}/like`, { method: 'PUT', });
    } catch (e) { console.error('Like error:', e); }
  };

  // Returns a human-readable countdown like "46h 23m left" or "Expiring soon!"
  const getTimeLeft = (expiresAt?: string | null): { label: string; urgent: boolean } => {
    if (!expiresAt) return { label: '48h', urgent: false };
    const msLeft = new Date(expiresAt).getTime() - Date.now();
    if (msLeft <= 0) return { label: 'Expired', urgent: true };
    const h = Math.floor(msLeft / 3600000);
    const m = Math.floor((msLeft % 3600000) / 60000);
    if (h === 0) return { label: `${m}m left`, urgent: true };
    return { label: `${h}h ${m}m left`, urgent: h < 4 };
  };

  const toggleThread = (postId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const openReply = (post: PostType) => {
    setReplyingTo(post);
    setDraft('');
    setDraftImage(null);
    setShowComposer(true);
  };

  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  // Filtered posts by search
  const filteredPosts = posts.filter(p => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (p.content || '').toLowerCase().includes(q) || (p.userName || '').toLowerCase().includes(q);
    }
    return true;
  });

  const trendingPosts = [...posts].sort((a, b) => (b.likes + b.replyCount * 2) - (a.likes + a.replyCount * 2)).slice(0, 3);

  /* ═══════════════════════════════════════════════════════════ */
  /*  RENDER A SINGLE POLAROID POST                             */
  /* ═══════════════════════════════════════════════════════════ */
  const renderPost = (post: PostType, isReply = false, depth = 0, index = 0) => {
    const isLiked = user && (post.likedBy || []).includes(user.id);
    const hasReplies = (post.replies && post.replies.length > 0) || (post.replyCount > 0);
    const isExpanded = expandedThreads.has(post.id);
    
    // Generate organic variations
    const rotation = isReply ? 0 : (index % 2 === 0 ? -1.5 : 1.5) + (index % 3 === 0 ? -1 : 1);
    const stringGradient = "bg-gradient-to-b from-white/20 via-white/10 to-transparent";
    
    // Hash string for consistent text-post background
    const bgHash = post.id.charCodeAt(post.id.length - 1) % 4;
    const bgGradients = [
      'from-amber-400 to-orange-500',
      'from-sky-400 to-indigo-500',
      'from-emerald-400 to-teal-500',
      'from-rose-400 to-pink-500'
    ];

    return (
      <div className={`relative ${isReply ? 'ml-6 mt-4' : 'mb-8 pt-4 max-w-[280px] sm:max-w-[260px] md:max-w-[300px] mx-auto'} animate-in fade-in slide-in-from-bottom-4 flex flex-col items-center`}
        style={{ animationDelay: '0.05s', animationFillMode: 'both' }}
      >
        {/* The Hanging String Line (Connects posts vertically) */}
        {!isReply && (
          <div className="absolute top-[-40px] bottom-[-24px] w-[2px] bg-[#8b5a2b]/30 z-0 drop-shadow-sm" style={{ left: '50%', transform: 'translateX(-50%)' }} />
        )}
        {/* Reply connector */}
        {isReply && (
          <div className="absolute left-[-20px] top-4 w-[20px] h-[2px] bg-[#8b5a2b]/30 z-0" />
        )}

        <div 
          className={`relative z-10 w-full group transition-all duration-500`}
          style={{ transform: !isReply ? `rotate(${rotation}deg)` : 'none' }}
        >
          {/* Wooden Clip / Peg (Pinned to the string) */}
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-3 h-6 bg-[#8b5a2b] border border-[#5c3a21] rounded-sm shadow-xl z-20 overflow-hidden">
             <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_20%,rgba(255,255,255,0.1)_50%,transparent_80%)]" />
             <div className="w-full h-px bg-black/40 mt-3" />
          </div>

          {/* Polaroid Frame */}
          <div className={`bg-[#fdfcf0] p-3 pb-5 shadow-2xl ${isReply ? 'rounded-xl' : 'rounded-[2px]'} hover:-translate-y-1 hover:shadow-[0_20px_40px_rgba(0,0,0,0.15)] transition-all duration-300 border border-black/5 relative overflow-hidden`}>
             {/* Glossy overlay */}
             <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/40 to-white/80 pointer-events-none mix-blend-overlay" />

            {/* Photo Section */}
            <div 
              className={`relative w-full aspect-square ${post.imageUrl ? 'bg-[#060608] cursor-pointer' : 'bg-transparent'} rounded overflow-hidden shadow-inner flex flex-col`}
              onClick={() => { if (post.imageUrl) setSelectedImage(post.imageUrl); }}
            >
              {post.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.imageUrl} alt="Shared" className="w-full h-full object-cover transition-transform duration-500 hover:scale-105" />
              ) : (
                <div className="p-4 flex-1 flex flex-col justify-center text-center">
                   <p className="text-[#3e2723] font-black text-lg md:text-xl leading-snug line-clamp-6 drop-shadow-sm font-serif italic">
                     {post.content}
                   </p>
                </div>
              )}
            </div>

            {/* Polaroid Bottom Text Area */}
            <div className="pt-4 flex flex-col">
              {/* If there was an image, show text here */}
              {post.imageUrl && post.content && (
                <p className="text-black/80 font-medium text-xs mb-3 italic font-serif leading-relaxed line-clamp-3">
                  "{post.content}"
                </p>
              )}

              {/* F5: Review Metadata */}
              {(post as any).postType === 'review' && (
                <div className="mb-3 p-2 bg-[#8b5a2b]/5 rounded-xl border border-[#8b5a2b]/10">
                  <div className="flex items-center gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map(star => (
                      <span key={star} className={`text-xs ${(post as any).starRating >= star ? 'text-amber-500' : 'text-black/10'}`}>★</span>
                    ))}
                  </div>
                  {(post as any).restaurantName && (
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#8b5a2b] truncate">📍 {(post as any).restaurantName}</p>
                  )}
                  {(post as any).productName && (
                    <p className="text-[10px] font-bold text-black/60 truncate capitalize mt-0.5">🍽️ {(post as any).productName}</p>
                  )}
                </div>
              )}

              <div className="flex items-end justify-between mt-auto pt-2 gap-2">

                {/* Author Info */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-6 h-6 rounded-full overflow-hidden border border-black/10 bg-gray-200 shrink-0 shadow-sm">
                    {post.userAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.userAvatar} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#38BDF8] to-[#C9A84C]">
                        <span className="text-[8px] font-black text-white">{(post.userName || 'A').charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[10px] font-black text-black/90 uppercase tracking-tight truncate">{post.userName}</span>
                    <span className="text-[7px] font-bold text-black/40 uppercase tracking-widest truncate">{formatTime(post.createdAt)}</span>
                  </div>
                </div>

                {/* Expiry Countdown */}
                {!isReply && (() => {
                  const { label, urgent } = getTimeLeft(post.expiresAt);
                  return (
                    <div className={`shrink-0 whitespace-nowrap flex items-center gap-1 px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${urgent ? 'text-orange-500 border-orange-300 bg-orange-50' : 'text-black/30 border-black/10 bg-white/60'}`}>
                      <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {label}
                    </div>
                  );
                })()}

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleLike(post.id, post.likedBy || []); }}
                    className={`flex items-center gap-1 active:scale-90 transition-transform ${isLiked ? 'text-red-500' : 'text-black/30 hover:text-red-400'}`}
                  >
                    <svg className={`w-4 h-4 ${isLiked ? 'fill-current' : 'fill-none'}`} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    <span className="text-[9px] font-black">{post.likes || 0}</span>
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); openReply(isReply && post.parentId ? posts.find(p => p.id === post.parentId) || post : post); }}
                    className="flex items-center gap-1 text-black/30 hover:text-[#8b5a2b] active:scale-90 transition-transform"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </button>

                  {/* Delete / Report */}
                  {user?.id === post.userId ? (
                    <button onClick={(e) => { e.stopPropagation(); handleDeletePost(post.id, post.parentId); }} className="text-black/20 hover:text-red-500 active:scale-90 transition-transform ml-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); const btn = e.currentTarget; const orig = btn.innerHTML; btn.innerHTML = '<span class="text-[8px] font-black">Reported</span>'; setTimeout(() => btn.innerHTML = orig, 2000); }} className="text-black/20 hover:text-orange-500 active:scale-90 transition-transform ml-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2v3z" /></svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Thread expand */}
              {!isReply && hasReplies && (
                <div className="mt-3 pt-3 border-t border-black/5 flex justify-center">
                  <button
                    onClick={() => toggleThread(post.id)}
                    className="text-[8px] font-black text-black/40 hover:text-black/80 uppercase tracking-widest flex items-center gap-1 transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" />
                    </svg>
                    {isExpanded ? 'Hide' : `Show ${(post.replyCount || post.replies?.length || 0)}`} Replies
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── NESTED REPLIES ── */}
        {!isReply && isExpanded && post.replies && post.replies.length > 0 && (
          <div className="relative mt-2 w-full pl-8 pr-2">
            {post.replies.map((reply, idx) => <div key={reply.id}>{renderPost(reply, true, depth + 1, idx)}</div>)}
          </div>
        )}
      </div>
    );
  };


  /* ═══════════════════════════════════════════════ */
  /*  MAIN RENDER                                    */
  /* ═══════════════════════════════════════════════ */
  return (
    <main className="min-h-screen bg-[#f4f1ea] text-[#3e2723] relative overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
         <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("https://www.transparenttextures.com/patterns/cream-paper.png")' }} />
         <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.8)_0%,transparent_80%)]" />
      </div>

      {/* Header */}
      <div className="relative z-10 px-5 pt-6 pb-2">
        <div className="flex items-center justify-between mb-5">
          <Magnetic>
            <Link href="/" className="w-11 h-11 bg-white shadow-sm rounded-2xl flex items-center justify-center border border-black/5 hover:bg-black/5 transition-all active:scale-90">
              <svg className="w-4 h-4 text-black/60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
            </Link>
          </Magnetic>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-black/5 shadow-sm rounded-full">
            <div className="relative flex items-center justify-center">
              <div className="w-2 h-2 bg-emerald-500 rounded-full" />
              <div className="absolute w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">{onlineCount} Live</span>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-12 h-12 rounded-2xl bg-white border border-black/10 flex items-center justify-center shadow-sm">
              <span className="text-2xl">📸</span>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-[#3e2723]">Gallery Wall</h1>
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-black/30">Community Memories</p>
            </div>
          </div>

          {/* F5: Tabs */}
          <div className="flex bg-white border border-black/10 p-1 rounded-2xl shadow-sm mt-4">
            <button
              onClick={() => setActiveTab('all')}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'all' ? 'bg-[#3e2723] text-white shadow-md' : 'text-black/40 hover:bg-black/5'}`}
            >
              All Posts
            </button>
            <button
              onClick={() => setActiveTab('reviews')}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'reviews' ? 'bg-[#8b5a2b] text-white shadow-md' : 'text-black/40 hover:bg-black/5'}`}
            >
              Food Reviews
            </button>
          </div>
        </div>

        {/* Search Bar */}

        <div className="relative mb-4">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search stories..."
            className="w-full bg-white border border-black/10 rounded-2xl pl-10 pr-4 py-3 text-[12px] placeholder:text-black/30 outline-none focus:border-[#8b5a2b]/40 transition-all font-medium text-[#3e2723] shadow-sm"
          />
        </div>

      </div>

      {/* ═══════ TRENDING (only without search) ═══════ */}
      {!searchQuery && trendingPosts.length > 0 && posts.length > 3 && (
        <div className="relative z-10 px-5 mb-4">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#C9A84C]/60 mb-3 flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.56 21a1 1 0 01-.46-.11L12 18.22l-5.1 2.67a1 1 0 01-1.45-1.06l1-5.63-4.12-4a1 1 0 01.56-1.71l5.7-.83 2.51-5.13a1 1 0 011.8 0l2.54 5.12 5.7.83a1 1 0 01.56 1.71l-4.12 4 1 5.63a1 1 0 01-1 1.18z" /></svg>
            Trending Now
          </p>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-5 px-5 pb-2">
            {trendingPosts.map(tp => (
              <div key={tp.id} className="min-w-[220px] max-w-[220px] bg-white border border-black/10 shadow-sm rounded-2xl p-3.5 shrink-0 hover:bg-black/5 transition-all cursor-pointer" onClick={() => { const el = document.getElementById(`post-${tp.id}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 border border-black/10 flex items-center justify-center">
                    <span className="text-[10px] font-black text-black/60">{(tp.userName || 'A').charAt(0).toUpperCase()}</span>
                  </div>
                  <span className="text-[10px] font-bold text-black/60 truncate">{tp.userName}</span>
                </div>
                <p className="text-[11px] text-black/70 line-clamp-2 leading-relaxed mb-2">{tp.content}</p>
                <div className="flex items-center gap-3 text-[9px] font-black text-black/30">
                  <span>♥ {tp.likes}</span>
                  <span>💬 {tp.replyCount}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════ FEED (POLAROID HANGING GALLERY) ═══════ */}
      <div className="relative z-10 px-5 pb-40 columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-6 space-y-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 col-span-full">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-black/10" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#8b5a2b] animate-spin" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#8b5a2b]/60 animate-pulse">Developing Film...</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-20 col-span-full">
            <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-white border border-black/10 shadow-sm flex items-center justify-center"><span className="text-5xl">📷</span></div>
            <p className="text-base font-black uppercase tracking-widest text-black/40 mb-2">Blank Canvas</p>
            <p className="text-[10px] font-bold tracking-widest text-black/30">Hang the first photo on the wall.</p>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="text-center py-16 col-span-full">
            <p className="text-[11px] font-black uppercase tracking-widest text-black/30">No polaroids match your filter</p>
          </div>
        ) : (
          filteredPosts.map((post, i) => <div key={post.id} id={`post-${post.id}`} className="break-inside-avoid">{renderPost(post, false, 0, i)}</div>)
        )}
      </div>

      {/* ═══════ FLOATING COMPOSE FAB ═══════ */}
      {!showComposer && (
        <button onClick={() => { setReplyingTo(null); setShowComposer(true); }}
          className="fixed bottom-[88px] right-5 z-[90] w-14 h-14 bg-[#8b5a2b] rounded-2xl flex items-center justify-center shadow-[0_8px_30px_rgba(139,90,43,0.4)] hover:shadow-[0_8px_40px_rgba(139,90,43,0.6)] transition-all active:scale-90 hover:scale-105 border border-[#5c3a21]"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
        </button>
      )}

      {/* ═══════ COMPOSER MODAL (Bottom Sheet) ═══════ */}
      {showComposer && (
        <div className="fixed inset-0 z-[200] flex flex-col justify-end animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setShowComposer(false); setReplyingTo(null); }} />

          <div className="relative bg-[#fdfcf0] border-t border-black/10 rounded-t-[32px] p-6 pb-8 animate-in slide-in-from-bottom-8 duration-300 max-h-[80vh] overflow-y-auto shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
            <div className="w-10 h-1 bg-black/10 rounded-full mx-auto mb-5" />

            {/* Reply banner */}
            {replyingTo && (
              <div className="flex items-center gap-3 mb-4 px-3 py-2.5 bg-[#8b5a2b]/5 border border-[#8b5a2b]/20 rounded-2xl">
                <svg className="w-4 h-4 text-[#8b5a2b] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#8b5a2b]">Replying to {replyingTo.userName}</p>
                  <p className="text-[11px] text-black/60 truncate">{replyingTo.content}</p>
                </div>
                <button onClick={() => setReplyingTo(null)} className="text-black/40 hover:text-black p-1">✕</button>
              </div>
            )}

            {/* Author preview */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-white border border-black/10 flex items-center justify-center shadow-sm">
                <span className="text-sm font-black text-[#8b5a2b]">
                  {(user?.name || 'A').charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-sm font-black text-[#3e2723]">{user?.name || 'Anonymous'}</p>
                <p className="text-[8px] font-black uppercase tracking-widest text-[#8b5a2b]/60">
                  {replyingTo ? 'Thread Reply' : 'Pinning to the wall'}
                </p>
              </div>
            </div>

            {/* Author Name Input */}
            <div className="mb-4">
              <input
                type="text"
                value={customAuthorName}
                onChange={(e) => setCustomAuthorName(e.target.value)}
                placeholder="Post as (Display Name)..."
                className="w-full bg-white border border-black/10 rounded-xl px-4 py-2.5 text-xs text-[#3e2723] placeholder:text-black/30 outline-none focus:border-[#8b5a2b]/40 transition-all font-bold shadow-sm"
              />
            </div>

            {/* F5: Review Toggle */}
            {!replyingTo && (
              <div className="mb-4 flex items-center justify-between p-3 bg-white border border-black/10 rounded-2xl shadow-sm">
                <span className="text-xs font-black uppercase tracking-widest text-[#3e2723]">Post as Food Review?</span>
                <input
                  type="checkbox"
                  checked={isReviewDraft}
                  onChange={e => setIsReviewDraft(e.target.checked)}
                  className="w-5 h-5 accent-[#8b5a2b]"
                />
              </div>
            )}

            {isReviewDraft && !replyingTo && (
              <div className="mb-4 space-y-3 bg-[#8b5a2b]/5 p-3 rounded-2xl border border-[#8b5a2b]/20">
                <div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#8b5a2b] mb-1 block">Star Rating</span>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button key={star} onClick={() => setStarRating(star)} className={`text-2xl transition-all hover:scale-110 ${starRating >= star ? 'text-amber-500' : 'text-black/10'}`}>★</button>
                    ))}
                  </div>
                </div>
                <input type="text" placeholder="Restaurant Name" value={restaurantName} onChange={e => setRestaurantName(e.target.value)} className="w-full bg-white border border-black/10 rounded-xl px-4 py-2 text-xs text-[#3e2723] outline-none focus:border-[#8b5a2b]/40 shadow-sm" />
                <input type="text" placeholder="Dish Name" value={productName} onChange={e => setProductName(e.target.value)} className="w-full bg-white border border-black/10 rounded-xl px-4 py-2 text-xs text-[#3e2723] outline-none focus:border-[#8b5a2b]/40 shadow-sm" />
              </div>
            )}

            {/* Textarea */}

            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value.slice(0, 500))}
              placeholder={replyingTo ? `Reply to ${replyingTo.userName}...` : "Write something beautiful..."}
              className="w-full bg-white border border-black/10 rounded-2xl px-4 py-4 text-sm text-[#3e2723] placeholder:text-black/30 outline-none focus:border-[#8b5a2b]/40 transition-all resize-none shadow-sm font-medium"
              rows={3}
              autoFocus
            />

            {/* Image preview */}
            {draftImage && (
              <div className="relative mt-3 rounded-2xl overflow-hidden border border-black/10 shadow-sm max-w-[200px] bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={draftImage} alt="Attachment" className="w-full h-auto max-h-[160px] object-cover rounded" />
                <button onClick={() => setDraftImage(null)} className="absolute top-3 right-3 w-7 h-7 bg-white/90 backdrop-blur rounded-full flex items-center justify-center text-red-500 text-xs hover:bg-red-500 hover:text-white shadow-sm transition-all">✕</button>
              </div>
            )}

            {/* Bottom actions */}
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-3">
                {/* Image upload */}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }}
                />
                <button onClick={() => fileInputRef.current?.click()} disabled={isUploading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-black/10 text-black/50 hover:text-black hover:bg-black/5 shadow-sm transition-all active:scale-95 text-[10px] font-black uppercase tracking-widest disabled:opacity-30"
                >
                  {isUploading ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-black/20 border-t-[#8b5a2b] animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                  Photo
                </button>
                <span className={`text-[10px] font-black tracking-widest ${draft.length > 450 ? 'text-red-400' : 'text-black/30'}`}>{draft.length}/500</span>
              </div>

              <button onClick={handlePost} disabled={(!draft.trim() && !draftImage) || isPosting}
                className="bg-[#8b5a2b] text-white px-7 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest disabled:opacity-30 transition-all active:scale-95 shadow-md hover:shadow-lg border border-[#5c3a21]"
              >
                {isPosting ? (
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />Pinning</div>
                ) : (
                  <span className="flex items-center gap-2">
                    {replyingTo ? 'Reply' : 'Pin Post'}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Nav */}
      <footer className="fixed bottom-0 left-0 right-0 h-16 bg-[#f4f1ea] border-t-2 border-[#8b5a2b]/10 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] flex items-center justify-around sm:hidden z-[100] pb-safe">
        <Magnetic><Link href="/" className="flex flex-col items-center gap-1.5 text-[#3e2723]/40 hover:text-[#3e2723] transition-colors"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg><span className="text-[9px] font-black uppercase tracking-widest">Home</span></Link></Magnetic>
        <Magnetic><Link href="/orders" className="flex flex-col items-center gap-1.5 text-[#3e2723]/40 hover:text-[#3e2723] transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg><span className="text-[9px] font-bold">Orders</span></Link></Magnetic>
        <Magnetic><Link href="/basket" className="flex flex-col items-center gap-1.5 text-[#3e2723]/40 hover:text-[#3e2723] transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg><span className="text-[9px] font-bold">Basket</span></Link></Magnetic>
        <Magnetic><Link href="/community" className="flex flex-col items-center gap-1.5"><div className="relative"><svg className="w-5 h-5 text-[#8b5a2b]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg><div className="absolute -top-1 -right-1.5 w-2 h-2 bg-[#8b5a2b] rounded-full animate-pulse" /></div><span className="text-[9px] font-black text-[#8b5a2b]">Gallery</span></Link></Magnetic>
        <Magnetic><Link href="/profile" className="flex flex-col items-center gap-1.5 text-[#3e2723]/40 hover:text-[#3e2723] transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg><span className="text-[9px] font-bold">Profile</span></Link></Magnetic>
      </footer>

      {/* ═══════ FULL-SCREEN LIGHTBOX ═══════ */}
      {selectedImage && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setSelectedImage(null)}>
          <button onClick={() => setSelectedImage(null)} className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-all active:scale-90">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selectedImage} alt="Fullscreen" className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </main>
  );
}
