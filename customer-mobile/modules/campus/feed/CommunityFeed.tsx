import * as Haptics from 'expo-haptics';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, Dimensions, Platform, TouchableWithoutFeedback, Keyboard, Animated, Easing, AppState, RefreshControl, FlatList } from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { Image } from 'expo-image';
import { useRouter, useIsFocused } from 'expo-router';
import { pickImageAsset, prepareAndUploadImage, alertUploadError } from '../../../utils/imageUpload';
import { CampusColors } from '../../../constants/campusTheme';
import { COLORS, SHADOWS } from '../../../constants/theme';
import { ENDPOINTS, API_URL } from '../../../constants/api';
import { apiFetch } from '../../../utils/auth';
import { useAuth } from '../../../context/AuthContext';
import { useTheme } from '../../../context/ThemeContext';
import { StaggeredSection, FloatingPulse, BounceIn, PulseGlow } from '../../../components/AnimatedSection';
import DopaminePressable, { CardPressable, ActionPressable } from '../../../components/DopaminePressable';
import { LinearGradient } from 'expo-linear-gradient';
import { connectSocket } from '../../../utils/socket';
import { useLiveSync } from '../../../utils/useLiveSync';
import ShimmerLoader from '../../../components/ShimmerLoader';
import { ActionMenu } from '../friends/shared/ActionMenu';

const { width: SW, height: SH } = Dimensions.get('window');

const getImageUrl = (url: string | null) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

// ── Confetti Particle (Pure Native Drivers, Zero-Lag) ──
// Random params are computed once per particle (not on every parent re-render),
// and the loop is stopped on unmount.
const CONFETTI_COLORS = ['#FF69B4', '#FFD700', '#FF4500', '#00FFFF', '#ADFF2F', '#FF00FF'];
const ConfettiParticle = ({ delay }: { delay: number }) => {
  const animatedValue = React.useRef(new Animated.Value(0)).current;
  const params = React.useRef({
    duration: 3500 + Math.random() * 2500,
    x: [Math.random() * SW, Math.random() * SW, Math.random() * SW],
    rot: `${Math.random() * 360}deg`,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    w: 8 + Math.random() * 8,
    h: 8 + Math.random() * 8,
    round: Math.random() > 0.5,
  }).current;

  React.useEffect(() => {
    const anim = Animated.timing(animatedValue, {
      toValue: 1,
      duration: params.duration,
      delay: delay,
      useNativeDriver: true,
      easing: Easing.linear,
    });
    // One celebratory burst (not an endless loop) to keep low-end phones smooth.
    anim.start();
    return () => anim.stop();
  }, []);

  const translateY = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-60, SH + 60]
  });

  const translateX = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: params.x
  });

  const rotate = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', params.rot]
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: params.w,
        height: params.h,
        backgroundColor: params.color,
        borderRadius: params.round ? 4 : 0,
        transform: [{ translateY }, { translateX }, { rotate }],
        opacity: 0.8,
        zIndex: 999
      }}
    />
  );
};

const ConfettiCannon = React.memo(() => {
  const particles = React.useMemo(() => Array.from({ length: 45 }), []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((_, i) => (
        <ConfettiParticle key={i} delay={i * 60} />
      ))}
    </View>
  );
});

// ── Crazy Animated Moving Ticker Banner ──
const GRADIENT_THEMES: Record<string, string[]> = {
  fire: ['#FF4500', '#FF8C00', '#FFD700', '#FF1493'],
  neon: ['#00F5D4', '#7B2CBF', '#F72585', '#4CC9F0'],
  gold: ['#B8860B', '#FFD700', '#DAA520', '#FFF8DC'],
  cyberpunk: ['#F72585', '#7209B7', '#3A0CA3', '#4361EE'],
  emerald: ['#059669', '#10B981', '#34D399', '#6EE7B7']
};

const CrazyMovingBanner = ({ text, theme = 'fire' }: { text: string; theme?: string }) => {
  const scrollX = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    scrollX.setValue(0);
    const anim = Animated.loop(
      Animated.timing(scrollX, {
        toValue: -1,
        duration: 16000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [text]);

  const translateX = scrollX.interpolate({
    inputRange: [-1, 0],
    outputRange: [-600, 0]
  });

  const colors = GRADIENT_THEMES[theme] || GRADIENT_THEMES.fire;

  return (
    <View style={{ height: 40, borderRadius: 14, overflow: 'hidden', marginVertical: 10, borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)', shadowColor: colors[0], shadowOpacity: 0.4, shadowRadius: 8, elevation: 4 }}>
      <LinearGradient colors={colors as unknown as readonly [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ backgroundColor: '#0D0D15', paddingHorizontal: 12, height: '100%', justifyContent: 'center', zIndex: 20, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.2)' }}>
          <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFD700', letterSpacing: 0.8 }}>📢 LIVE EVENT</Text>
        </View>
        <View style={{ flex: 1, overflow: 'hidden', height: '100%', justifyContent: 'center', paddingHorizontal: 6 }}>
          <Animated.View style={{ flexDirection: 'row', alignItems: 'center', transform: [{ translateX }] }}>
            <Text 
              numberOfLines={1}
              style={{ 
                fontSize: 12, 
                fontWeight: '900', 
                color: '#FFF', 
                paddingRight: 60,
                ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' as any } : {})
              }}
            >
              {text} &nbsp;&nbsp;•&nbsp;&nbsp; {text} &nbsp;&nbsp;•&nbsp;&nbsp; {text}
            </Text>
          </Animated.View>
        </View>
      </View>
    </View>
  );
};

interface PostType {
  id: string;
  parentId: string | null;
  userId: string;
  userName: string;
  userAvatar: string | null;
  content: string;
  imageUrl: string | null;
  likes: number;
  /** Legacy: older servers sent the full liker list. */
  likedBy: string[];
  /** The server now answers only whether the signed-in viewer liked it (never who else did). */
  likedByMe?: boolean;
  replyCount: number;
  createdAt: string;
  expiresAt?: string | null;
  replies?: PostType[];
  postType?: 'post' | 'review';
  starRating?: number;
  restaurantName?: string;
  productName?: string;
}

const isLikedByMe = (post: Pick<PostType, 'likedBy' | 'likedByMe'>, myUserId: string): boolean => {
  if (!myUserId) return false;
  if (typeof post.likedByMe === 'boolean') return post.likedByMe;
  return (post.likedBy || []).map(String).includes(myUserId);
};

const postTimeLeft = (expiresAt?: string | null) => {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h === 0) return `${m}m left`;
  return `${h}h left`;
};

const postTime = (isoString: string) => {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
};

const postBgHash = (id: string) => {
  const colors = [
    ['#FBBF24', '#F59E0B'], // amber-400 to orange-500
    ['#38BDF8', '#6366F1'], // sky-400 to indigo-500
    ['#34D399', '#0D9488'], // emerald-400 to teal-500
    ['#FB7185', '#EC4899'], // rose-400 to pink-500
  ];
  const code = String(id || '').charCodeAt(String(id || '').length - 1) || 0;
  return colors[code % colors.length];
};

const postKey = (p: PostType) => String(p.id);

type PostCardActions = {
  openImage: (url: string) => void;
  imageError: (postId: string) => void;
  like: (postId: string) => void;
  reply: (post: PostType) => void;
  remove: (id: string, parentId: string | null) => void;
  toggleThread: (postId: string) => void;
  /** C2: Report / Block menu on someone else's post or reply. */
  more: (post: PostType, parentId: string | null) => void;
};

/** One polaroid in the posts grid. Memoized: a like / reply / new post re-renders only the cards it changes. */
const PostCard = React.memo(function PostCard({ post, idx, myUserId, signedIn, imageFailed, expanded, cardBg, border, txt, txtSec, isDark, actions }: {
  post: PostType; idx: number; myUserId: string; signedIn: boolean; imageFailed: boolean; expanded: boolean;
  cardBg: string; border: string; txt: string; txtSec: string; isDark: boolean; actions: PostCardActions;
}) {
  const bgGrad = postBgHash(post.id);
  const isLiked = isLikedByMe(post, myUserId);
  const rotation = (idx % 2 === 0 ? '-1.5deg' : '1.5deg');

  return (
    <StaggeredSection 
      delay={50 + (idx % 6) * 50} 
      direction="up"
      style={[s.polaroidWrapper, { transform: [{ rotate: rotation }] }]}
    >
      {/* Peg Wooden Clip */}
      <View style={s.pegClip} />

      {/* Polaroid Frame */}
      <CardPressable 
        style={[s.polaroidFrame, { backgroundColor: cardBg, borderColor: border }]} 
        onPress={() => post.imageUrl ? actions.openImage(post.imageUrl) : null} 
        tilt={false} // Disabled 3D tilt to eliminate JS thread lag
      >
        {post.imageUrl && !imageFailed ? (
          <Image 
            source={{ uri: getImageUrl(post.imageUrl) }}
            style={s.polaroidImg} 
            onError={() => {
              actions.imageError(post.id);
            }}
          />
        ) : (
          <View style={[s.textPostBg, { backgroundColor: bgGrad[0] }]}>
            <Text style={s.textPostContent} numberOfLines={8}>{post.content || '📷 Photo unavailable'}</Text>
          </View>
        )}

        {/* Footer Details */}
        <View style={s.polaroidDetails}>
          {post.imageUrl && post.content ? (
            <Text style={[s.polaroidDesc, { color: txt }]} numberOfLines={3}>"{post.content}"</Text>
          ) : null}

          {/* Review details */}
          {post.postType === 'review' && (
            <View style={[s.reviewMeta, { backgroundColor: isDark ? '#1C1B1F' : 'rgba(139,90,43,0.04)', borderColor: border }]}>
              {Number(post.starRating) > 0 ? (
                <Text style={s.reviewStars}>{'★'.repeat(Math.min(5, Math.round(Number(post.starRating))))}{'☆'.repeat(Math.max(0, 5 - Math.min(5, Math.round(Number(post.starRating)))))}</Text>
              ) : null}
              {post.restaurantName ? (
                <Text style={[s.reviewRestaurant, { color: isDark ? COLORS.gold : '#8b5a2b' }]} numberOfLines={1}>📍 {post.restaurantName.toUpperCase()}</Text>
              ) : null}
              {post.productName ? (
                <Text style={[s.reviewProduct, { color: txtSec }]} numberOfLines={1}>🍽️ {post.productName}</Text>
              ) : null}
            </View>
          )}

          {/* User Row */}
          <View style={[s.polaroidUserRow, { borderBottomColor: border }]}>
            <View style={s.authorAvatar}>
              <Text style={s.authorAvatarText}>{(post.userName||'A').charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.authorName, { color: txt }]} numberOfLines={1}>{(post.userName || 'Student').toUpperCase()}</Text>
              <Text style={s.postTime}>{postTime(post.createdAt)}</Text>
            </View>
            {post.postType !== 'review' && !!postTimeLeft(post.expiresAt) && (
              <View style={s.expiryBadge}>
                <Text style={s.expiryText}>{postTimeLeft(post.expiresAt)}</Text>
              </View>
            )}
          </View>

          {/* Actions */}
          <View style={s.actionsRow}>
            <DopaminePressable style={s.actionBtn} onPress={() => actions.like(post.id)} sound="click" activeScale={0.88}>
              <Text style={[s.actionText, isLiked && { color: COLORS.red }]}>
                {isLiked ? '❤️' : '🤍'} {post.likes}
              </Text>
            </DopaminePressable>

            <DopaminePressable style={s.actionBtn} onPress={() => actions.reply(post)} sound="click" activeScale={0.88}>
              <Text style={s.actionText}>💬 {post.replyCount}</Text>
            </DopaminePressable>

            {signedIn && String(post.userId) === myUserId ? (
              <DopaminePressable style={s.actionBtn} onPress={() => actions.remove(post.id, null)}sound="click" activeScale={0.88}>
                <Text style={[s.actionText, { color: COLORS.red }]}>🗑️</Text>
              </DopaminePressable>
            ) : signedIn ? (
              <DopaminePressable style={s.actionBtn} onPress={() => actions.more(post, null)} sound="click" activeScale={0.88} accessibilityLabel="Post options">
                <Text style={s.actionText}>⋯</Text>
              </DopaminePressable>
            ) : null}
          </View>

          {/* Replies */}
          {post.replies && post.replies.length > 0 ? (
            <TouchableOpacity 
              style={s.repliesTrigger} 
              onPress={() => actions.toggleThread(post.id)}
            >
              <Text style={[s.repliesTriggerText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>
                {expanded ? 'HIDE REPLIES ▲' : `SHOW REPLIES (${post.replies.length}) ▼`}
              </Text>
            </TouchableOpacity>
          ) : null}

          {expanded && post.replies && (
            <View style={[s.repliesBox, { borderTopColor: border }]}>
              {post.replies.map(r => (
                <View key={r.id} style={s.replyItem}>
                  <Text style={[s.replyUser, { color: txt }]}>{(r.userName || 'Student').toUpperCase()}:</Text>
                  <Text style={[s.replyText, { color: txtSec, flexShrink: 1 }]}>{r.content}</Text>
                  {signedIn && String(r.userId) === myUserId ? (
                    <TouchableOpacity onPress={() => actions.remove(r.id, post.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Text style={{ fontSize: 12, color: COLORS.red }}>🗑️</Text>
                    </TouchableOpacity>
                  ) : signedIn ? (
                    <TouchableOpacity onPress={() => actions.more(r, post.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Reply options">
                      <Text style={{ fontSize: 12, color: txtSec }}>⋯</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>
          )}

        </View>
      </CardPressable>
    </StaggeredSection>
  );
});

/** "⏱️ COUNTDOWN CLASH" value. Ticks every second only while the Wall tab is showing and the screen is focused. */
function formatWallLeft(endTime: any): string {
  const ms = new Date(endTime).getTime() - Date.now();
  if (isNaN(ms)) return '';
  if (ms <= 0) return 'CONTEST ENDED';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const hms = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

function WallCountdown({ endTime, active }: { endTime: any; active: boolean }) {
  const focused = useIsFocused();
  const [left, setLeft] = useState(() => (endTime ? formatWallLeft(endTime) : ''));
  useEffect(() => {
    if (!endTime) { setLeft(''); return; }
    setLeft(formatWallLeft(endTime));
    if (!active || !focused) return;
    const t = setInterval(() => setLeft(formatWallLeft(endTime)), 1000);
    return () => clearInterval(t);
  }, [endTime, active, focused]);
  return <Text style={{ fontSize: 13, fontWeight: '900', color: '#FF5A00' }}>{left || '—'}</Text>;
}

/** true once the contest's endTime has passed (one timer to the end moment, not a 1 s tick). */
function useWallEnded(endTime: any): boolean {
  const compute = () => {
    if (!endTime) return false;
    const ms = new Date(endTime).getTime() - Date.now();
    return !isNaN(ms) && ms <= 0;
  };
  const [ended, setEnded] = useState(compute);
  useEffect(() => {
    setEnded(compute());
    if (!endTime) return;
    const ms = new Date(endTime).getTime() - Date.now();
    if (isNaN(ms) || ms <= 0) return;
    // setTimeout caps at ~24.8 days; re-check then if the contest runs longer.
    const t = setTimeout(() => setEnded(compute()), Math.min(ms + 50, 2147483000));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endTime]);
  return ended;
}

/**
 * Community posts, reviews, birthdays and The Wall. Lives inside the Campus hub's Feed tab
 * (embedded: no own header / tab bar, Campus colours). /community redirects there.
 */
export function CommunityFeed({ embedded = false, tab }: { embedded?: boolean; tab?: 'all' | 'wall' } = {}) {
  const router = useRouter();
  const { user } = useAuth();
  const { isDark: themeDark } = useTheme();
  // The Campus hub is light-only; keep the feed consistent with it when embedded.
  const isDark = embedded ? false : themeDark;

  const txt = embedded ? CampusColors.ink : isDark ? '#FFF' : '#3e2723';
  const txtSec = embedded ? CampusColors.muted : isDark ? '#AAA' : '#666';
  const bg = embedded ? CampusColors.paper : isDark ? '#0A0A0C' : '#f4f1ea';
  const cardBg = embedded ? CampusColors.card : isDark ? '#141416' : '#fdfcf0';
  const border = embedded ? CampusColors.line : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(139,90,43,0.1)';
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [posts, setPosts] = useState<PostType[]>([]);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [postsError, setPostsError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'wall'>(tab || 'all');
  useEffect(() => {
    if (tab) setActiveTab(tab);
  }, [tab]);
  const [feedCategory, setFeedCategory] = useState<'all' | 'memories' | 'reviews'>('all');
  const [search, setSearch] = useState('');
  const likePendingRef = React.useRef<Set<string>>(new Set());
  const wallVotePendingRef = React.useRef<Set<string>>(new Set());

  const promptSignIn = () => {
    Alert.alert(
      'Sign in to join in',
      'Sign in to your ZENV account to post, reply, vote or send wishes.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.push('/login' as any) }
      ]
    );
  };

  // Turns a failed response into a short, friendly message (never raw codes/JSON).
  const friendlyError = async (res: Response, fallback: string): Promise<string> => {
    if (res.status === 401) return 'Please sign in again to continue.';
    if (res.status === 413) return 'That photo is too large. Please pick a smaller one.';
    // 4xx bodies carry a friendly server message (e.g. 403 REVIEW_NEEDS_ORDER, 429 nudge limit,
    // 400 CONTEST_CLOSED): show it as-is instead of a generic "sign in again".
    if (res.status >= 400 && res.status < 500) {
      try {
        const data = await res.json();
        if (data?.message && typeof data.message === 'string' && data.message.length < 120) return data.message;
      } catch { /* ignore */ }
      if (res.status === 429) return 'Whoa, slow down a little and try again in a minute.';
    }
    return fallback;
  };

  // ── THE WALL STATE ──
  const [wallSubTab, setWallSubTab] = useState<'live' | 'hof'>('live');
  const [activeWallEvent, setActiveWallEvent] = useState<any | null>(null);
  const [wallSubmissions, setWallSubmissions] = useState<any[]>([]);
  const [userLikedWallSubmissionIds, setUserLikedWallSubmissionIds] = useState<string[]>([]);
  const [userWallSubmission, setUserWallSubmission] = useState<any | null>(null);
  const [wallHistory, setWallHistory] = useState<any[]>([]);
  const [selectedHofWinner, setSelectedHofWinner] = useState<any | null>(null);
  const [loadingWall, setLoadingWall] = useState(true);
  const [wallError, setWallError] = useState(false);
  const [wallHistoryError, setWallHistoryError] = useState(false);

  // Modals & Form
  const [showWallSubmitModal, setShowWallSubmitModal] = useState(false);
  const [wallSubmitImage, setWallSubmitImage] = useState<string | null>(null);
  const [submittingWallPhoto, setSubmittingWallPhoto] = useState(false);
  
  // Composer states
  const [showComposer, setShowComposer] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [isReviewDraft, setIsReviewDraft] = useState(false);
  const [starRating, setStarRating] = useState(5);
  const [restaurantName, setRestaurantName] = useState('');
  // Reviews are about a real store the user got a delivered order from (server: REVIEW_NEEDS_STORE /
  // REVIEW_NEEDS_ORDER), so the place is picked from the user's delivered orders, not typed.
  const [reviewStoreId, setReviewStoreId] = useState<string | null>(null);
  const [reviewStores, setReviewStores] = useState<{ id: string; name: string }[] | null>(null);
  const [productName, setProductName] = useState('');
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  
  const [replyingTo, setReplyingTo] = useState<PostType | null>(null);

  useEffect(() => {
    if (!isReviewDraft || !user || reviewStores) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.myOrders);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const seen = new Map<string, string>();
        (res.ok && Array.isArray(data) ? data : []).forEach((o: any) => {
          const id = String(o?.restaurantId || o?.restaurant?.id || '');
          if (o?.status !== 'Delivered' || !id || seen.has(id)) return;
          seen.set(id, String(o.restaurantName || o.restaurant?.name || 'Store'));
        });
        setReviewStores([...seen].map(([id, name]) => ({ id, name })));
      } catch {
        if (!cancelled) setReviewStores([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewDraft, user, reviewStores]);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  // C2: Report / Block on other people's posts and replies.
  const [ugcMenu, setUgcMenu] = useState<{ post: PostType; parentId: string | null } | null>(null);
  const [ugcMenuOpen, setUgcMenuOpen] = useState(false);
  /** Drops a post or reply locally (after a report) — the server hides it too once reviewed. */
  const dropLocal = (id: string, parentId: string | null) => {
    if (parentId) {
      setPosts(prev => prev.map(p => p.id === parentId ? { ...p, replies: (p.replies || []).filter(r => r.id !== id) } : p));
    } else {
      setPosts(prev => prev.filter(p => p.id !== id));
    }
  };
  /** Hides everything by a person I just blocked (the server leaves them out from now on). */
  const dropAuthor = (userId: string) => {
    setPosts(prev => prev
      .filter(p => String(p.userId) !== String(userId))
      .map(p => ({ ...p, replies: (p.replies || []).filter(r => String(r.userId) !== String(userId)) })));
  };

  // Photos are compressed and uploaded to Zenvy media storage; posts only carry the short https link.
  const [photoUploading, setPhotoUploading] = useState<null | 'post' | 'birthday' | 'wall'>(null);
  const pickAndUploadTo = async (kind: 'post' | 'birthday' | 'wall', setter: (url: string) => void) => {
    if (!user) { promptSignIn(); return; }
    if (photoUploading) return;
    const asset = await pickImageAsset({ allowsEditing: kind !== 'post', aspect: kind === 'post' ? undefined : [1, 1] });
    if (!asset) return;
    const run = async () => {
      setPhotoUploading(kind);
      try {
        const up = await prepareAndUploadImage(asset, 'post');
        if (mountedRef.current) setter(up.absoluteUrl);
      } catch (e) {
        alertUploadError(e, run);
      } finally {
        if (mountedRef.current) setPhotoUploading(null);
      }
    };
    await run();
  };
  const photoStillUploading = () => {
    if (!photoUploading) return false;
    Alert.alert('Photo still uploading', 'Please wait a moment for your photo to finish uploading.');
    return true;
  };

  const pickImage = () => pickAndUploadTo('post', setDraftImage);

  // ── BIRTHDAY CELEBRATIONS STATE ──
  interface BirthdayType {
    id: string;
    userId: string;
    candidateName: string;
    candidatePhotoUrl: string | null;
    birthdayDate: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    wishCount: number;
    wishedByMe?: boolean;
    approvedAt?: string;
    expiresAt?: string;
  }
  
  interface WishType {
    id: string;
    celebrationId: string;
    userId?: string;
    wishedByMe?: boolean;
    userName: string;
    message: string;
    createdAt: string;
  }

  const [birthdays, setBirthdays] = useState<BirthdayType[]>([]);
  const [pendingBirthdays, setPendingBirthdays] = useState<BirthdayType[]>([]);
  const [selectedBirthday, setSelectedBirthday] = useState<BirthdayType | null>(null);
  const [selectedBirthdayWishes, setSelectedBirthdayWishes] = useState<WishType[]>([]);
  const [loadingWishes, setLoadingWishes] = useState(false);
  const [birthdayWishMessage, setBirthdayWishMessage] = useState('');

  // Modals
  const [showBirthdayWishModal, setShowBirthdayWishModal] = useState(false);
  const [showRegisterBirthdayModal, setShowRegisterBirthdayModal] = useState(false);
  const [showAdminPanelModal, setShowAdminPanelModal] = useState(false);
  const [submittingWish, setSubmittingWish] = useState(false);

  // New Birthday Nomination
  const [newBirthdayName, setNewBirthdayName] = useState('');
  // Device-local date (UTC would be "yesterday" before 05:30 IST and the server would reject it).
  const todayLocalYmd = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [newBirthdayDate, setNewBirthdayDate] = useState(todayLocalYmd);
  const [newBirthdayPhoto, setNewBirthdayPhoto] = useState<string | null>(null);
  const [submittingBirthday, setSubmittingBirthday] = useState(false);

  const myUserId = user ? String(user.id || user._id || '') : '';
  const isAdmin = user?.role?.toLowerCase() === 'admin';
  // Read through a ref so listeners registered at mount (AppState) see the current role.
  const isAdminRef = React.useRef(isAdmin);
  isAdminRef.current = isAdmin;

  // The signed-in user can be restored after the first render; load the
  // admin nomination queue once we know the viewer is an admin.
  useEffect(() => {
    if (isAdmin) fetchBirthdays();
  }, [isAdmin]);

  const fetchBirthdays = async () => {
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysActive);
      if (res.ok) {
        const data = await res.json();
        if (mountedRef.current && Array.isArray(data)) setBirthdays(data);
      }
      // On failure keep whatever we last loaded (no fake fallback).
      if (isAdminRef.current) {
        const resPending = await apiFetch((ENDPOINTS as any).birthdaysPending);
        if (resPending.ok) {
          const dataPending = await resPending.json();
          if (mountedRef.current && Array.isArray(dataPending)) setPendingBirthdays(dataPending);
        }
      }
    } catch (e) {
      console.log('[FETCH_BIRTHDAYS_ERROR]', e);
    }
  };

  const isValidBirthdayDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };

  const submitBirthday = async () => {
    if (submittingBirthday) return;
    if (photoStillUploading()) return;
    if (!user) { promptSignIn(); return; }
    if (!newBirthdayName.trim()) {
      Alert.alert('Name needed', 'Please enter your friend\'s name.');
      return;
    }
    if (!isValidBirthdayDate(newBirthdayDate.trim())) {
      Alert.alert('Check the date', 'Please enter the birthday as YYYY-MM-DD, for example 2026-10-21.');
      return;
    }
    setSubmittingBirthday(true);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysSubmit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateName: newBirthdayName.trim(),
          birthdayDate: newBirthdayDate.trim(),
          candidatePhoto: newBirthdayPhoto
        })
      });

      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Nominated! 🎉', 'Thanks! Your nomination is with our team and will go live once approved.');
        setNewBirthdayName('');
        setNewBirthdayDate(todayLocalYmd());
        setNewBirthdayPhoto(null);
        setShowRegisterBirthdayModal(false);
        fetchBirthdays();
      } else {
        Alert.alert('Couldn\'t nominate', await friendlyError(res, 'Something went wrong. Please try again.'));
      }
    } catch (e) {
      Alert.alert('No connection', 'Please check your internet and try again.');
    } finally {
      if (mountedRef.current) setSubmittingBirthday(false);
    }
  };

  const pickBirthdayPhoto = () => pickAndUploadTo('birthday', setNewBirthdayPhoto);

  const approveBirthday = async (id: string) => {
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysApprove(id), { method: 'PUT' });
      if (res.ok) {
        Alert.alert('Approved! 🎂', 'Birthday is now live and a notification has been sent.');
        fetchBirthdays();
      } else {
        Alert.alert('Couldn\'t approve', await friendlyError(res, 'Please try again.'));
      }
    } catch (e) {
      Alert.alert('No connection', 'Please check your internet and try again.');
    }
  };

  const rejectBirthday = async (id: string) => {
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysReject(id), { method: 'PUT' });
      if (res.ok) {
        Alert.alert('Rejected', 'Nomination rejected.');
        fetchBirthdays();
      } else {
        Alert.alert('Couldn\'t reject', await friendlyError(res, 'Please try again.'));
      }
    } catch (e) {
      Alert.alert('No connection', 'Please check your internet and try again.');
    }
  };

  const openBirthdayDetail = async (birthday: BirthdayType) => {
    setSelectedBirthday(birthday);
    setBirthdayWishMessage('');
    setSelectedBirthdayWishes([]);
    setLoadingWishes(true);
    setShowBirthdayWishModal(true);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysWishes(birthday.id));
      if (res.ok) {
        const data = await res.json();
        if (mountedRef.current && Array.isArray(data)) setSelectedBirthdayWishes(data);
      }
    } catch (e) {
      console.log('[FETCH_WISHES_ERROR]', e);
    } finally {
      if (mountedRef.current) setLoadingWishes(false);
    }
  };

  // The server flags the viewer's own wish (wishedByMe); account ids are no longer in the list.
  const alreadyWished = !!user && (!!selectedBirthday?.wishedByMe || selectedBirthdayWishes.some(w => w.wishedByMe || (!!myUserId && String(w.userId) === myUserId)));

  const submitWish = async (presetText?: string) => {
    if (!selectedBirthday || submittingWish) return;
    if (!user) { promptSignIn(); return; }
    if (alreadyWished) {
      Alert.alert('Already wished ❤️', 'You have already sent your wishes to this friend.');
      return;
    }
    const msg = (presetText || birthdayWishMessage || '').trim();
    if (!msg) return;

    const celebrationId = selectedBirthday.id;
    setSubmittingWish(true);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysWish(celebrationId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      if (!res.ok) {
        const errData = await res.clone().json().catch(() => null);
        if (errData?.code === 'ALREADY_WISHED' && mountedRef.current) {
          setSelectedBirthday(prev => prev && prev.id === celebrationId ? { ...prev, wishedByMe: true } : prev);
          setBirthdays(prev => prev.map(b => b.id === celebrationId ? { ...b, wishedByMe: true } : b));
        }
        Alert.alert('Couldn\'t send wish', await friendlyError(res, 'Please try again in a moment.'));
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      const newWishItem: WishType = {
        id: `wish-${Date.now()}`,
        celebrationId,
        wishedByMe: true,
        userName: user?.name || 'You',
        message: msg,
        createdAt: new Date().toISOString()
      };
      const serverCount = typeof data?.wishCount === 'number' ? data.wishCount : null;
      setSelectedBirthdayWishes(prev => [newWishItem, ...prev]);
      setSelectedBirthday(prev => prev && prev.id === celebrationId ? { ...prev, wishedByMe: true, wishCount: serverCount ?? (prev.wishCount || 0) + 1 } : prev);
      setBirthdays(prev => prev.map(b => b.id === celebrationId ? { ...b, wishedByMe: true, wishCount: serverCount ?? (b.wishCount || 0) + 1 } : b));
      setBirthdayWishMessage('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert('No connection', 'Please check your internet and try again.');
    } finally {
      if (mountedRef.current) setSubmittingWish(false);
    }
  };

  // silent = live-sync background refresh: keep the wall on screen, no spinner, no error card
  const fetchWallActive = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    try {
      if (!silent) setLoadingWall(true);
      const res = await apiFetch((ENDPOINTS as any).wallActive);
      if (!mountedRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (!mountedRef.current) return;
        setActiveWallEvent(data.activeEvent || null);
        setWallSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
        setUserLikedWallSubmissionIds(Array.isArray(data.userLikedSubmissionIds) ? data.userLikedSubmissionIds : []);
        setUserWallSubmission(data.userSubmission || null);
        setWallError(false);
      } else if (!silent) {
        setWallError(true);
      }
    } catch (e) {
      console.log('[FETCH_WALL_ERR]', e);
      if (mountedRef.current && !silent) setWallError(true);
    } finally {
      if (mountedRef.current && !silent) setLoadingWall(false);
    }
  };

  // Live sync: wall events started / ended and submissions approved by admin appear in place
  useLiveSync({
    types: ['wall'],
    onChange: () => { fetchWallActive({ silent: true }); fetchWallHistory(); },
  });

  const fetchWallHistory = async () => {
    try {
      const res = await apiFetch((ENDPOINTS as any).wallHistory);
      if (!mountedRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (!mountedRef.current) return;
        const list = (Array.isArray(data) ? data : []).filter((item: any) => item?.event?.id);
        setWallHistory(list);
        setWallHistoryError(false);
      } else {
        setWallHistoryError(true);
      }
    } catch (e) {
      console.log('[FETCH_WALL_HISTORY_ERR]', e);
      if (mountedRef.current) setWallHistoryError(true);
    }
  };

  const handleWallLike = async (submissionId: string) => {
    if (!user) { promptSignIn(); return; }
    if (wallVotePendingRef.current.has(submissionId)) return;
    wallVotePendingRef.current.add(submissionId);

    const isAlreadyLiked = userLikedWallSubmissionIds.includes(submissionId);
    const applyVote = (liked: boolean, likeCount?: number) => {
      setUserLikedWallSubmissionIds(prev => {
        const without = prev.filter(id => id !== submissionId);
        return liked ? [...without, submissionId] : without;
      });
      setWallSubmissions(prev => prev.map(sub => {
        if (sub.id !== submissionId) return sub;
        const base = sub.likeCount || 0;
        const next = typeof likeCount === 'number' ? likeCount : (liked ? base + 1 : Math.max(0, base - 1));
        return { ...sub, likeCount: next };
      }));
    };

    // Optimistic toggle; reconciled with the server below.
    applyVote(!isAlreadyLiked);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    try {
      const res = await apiFetch((ENDPOINTS as any).wallLike(submissionId), { method: 'POST' });
      if (!mountedRef.current) return;
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.liked === 'boolean') applyVote(data.liked, typeof data.likeCount === 'number' ? data.likeCount : undefined);
      } else {
        applyVote(isAlreadyLiked);
        Alert.alert('Vote not counted', await friendlyError(res, 'Please try again in a moment.'));
      }
    } catch (e) {
      if (mountedRef.current) applyVote(isAlreadyLiked);
      Alert.alert('No connection', 'Your vote was not counted. Please check your internet and try again.');
    } finally {
      wallVotePendingRef.current.delete(submissionId);
    }
  };

  const pickWallPhoto = () => pickAndUploadTo('wall', setWallSubmitImage);

  const submitWallPhoto = async () => {
    if (submittingWallPhoto) return;
    if (photoStillUploading()) return;
    if (!user) { promptSignIn(); return; }
    if (!wallSubmitImage) {
      Alert.alert('Pick a photo', 'Please select a photo to upload.');
      return;
    }

    setSubmittingWallPhoto(true);
    const targetEventId = activeWallEvent?.id || 'active';

    try {
      const res = await apiFetch((ENDPOINTS as any).wallSubmit(targetEventId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: wallSubmitImage })
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (!mountedRef.current) return;
        setWallSubmitImage(null);
        setShowWallSubmitModal(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Photo submitted 📸', data.message || 'It will appear on The Wall once our team approves it.');
        await fetchWallActive();
      } else {
        Alert.alert('Couldn\'t upload', await friendlyError(res, 'We couldn\'t upload your photo right now. Please try again.'));
      }
    } catch (e: any) {
      Alert.alert('No connection', 'Please check your internet and try again.');
    } finally {
      if (mountedRef.current) setSubmittingWallPhoto(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'wall') {
      fetchWallActive();
      fetchWallHistory();
    }
  }, [activeTab]);

  // Has the live Wall contest ended? Flips once at endTime (no per-second re-render of the whole feed;
  // the visible countdown ticks inside <WallCountdown/>).
  const wallEnded = useWallEnded(activeWallEvent?.endTime);

  // Merge a post (from the POST response or the realtime socket) without duplicates.
  const upsertPost = (newPost: any) => {
    if (!newPost || !newPost.id) return;
    if (newPost.parentId) {
      setPosts(prev => prev.map(p => {
        if (p.id !== newPost.parentId) return p;
        const currentReplies = p.replies || [];
        if (currentReplies.some(r => r.id === newPost.id)) return p;
        return {
          ...p,
          replyCount: Math.max((p.replyCount || 0), currentReplies.length) + 1,
          replies: [...currentReplies, { ...newPost, likedBy: (newPost.likedBy || []).map(String) }]
        };
      }));
    } else {
      setPosts(prev => {
        if (prev.some(p => p.id === newPost.id)) return prev;
        return [{ ...newPost, likes: newPost.likes || 0, replyCount: newPost.replyCount || 0, likedBy: (newPost.likedBy || []).map(String), replies: newPost.replies || [] }, ...prev];
      });
    }
  };

  useEffect(() => {
    fetchPosts();
    fetchBirthdays();

    const socket = connectSocket();

    const onNewPost = (newPost: any) => {
      if (mountedRef.current) upsertPost(newPost);
    };

    const onPostLiked = (data: { id: string; likes: number; likedBy?: string[] }) => {
      if (!mountedRef.current || !data?.id) return;
      setPosts(prev => prev.map(p => {
        if (p.id === data.id) {
          return { ...p, likes: data.likes, ...(Array.isArray(data.likedBy) ? { likedBy: data.likedBy.map(String) } : {}) };
        }
        if (p.replies && p.replies.some(r => r.id === data.id)) {
          return {
            ...p,
            replies: p.replies.map(r => r.id === data.id ? { ...r, likes: data.likes, ...(Array.isArray(data.likedBy) ? { likedBy: data.likedBy.map(String) } : {}) } : r)
          };
        }
        return p;
      }));
    };

    const onPostDeleted = (data: { id: string; parentId: string | null }) => {
      if (!mountedRef.current || !data?.id) return;
      if (data.parentId) {
        setPosts(prev => prev.map(p => {
          if (p.id === data.parentId && (p.replies || []).some(r => r.id === data.id)) {
            return {
              ...p,
              replyCount: Math.max((p.replyCount || 1) - 1, 0),
              replies: (p.replies || []).filter(r => r.id !== data.id)
            };
          }
          return p;
        }));
      } else {
        setPosts(prev => prev.filter(p => p.id !== data.id));
      }
    };

    socket.on('community_new_post', onNewPost);
    socket.on('community_post_liked', onPostLiked);
    socket.on('community_post_deleted', onPostDeleted);

    // Catch up on anything missed while the app was in the background
    // (the realtime socket handles live updates; no polling).
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        fetchPosts();
        fetchBirthdays();
      }
    });

    return () => {
      appStateSub.remove();
      socket.off('community_new_post', onNewPost);
      socket.off('community_post_liked', onPostLiked);
      socket.off('community_post_deleted', onPostDeleted);
    };
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await apiFetch(ENDPOINTS.communityPosts);
      if (!mountedRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (!mountedRef.current) return;
        const list: PostType[] = (Array.isArray(data) ? data : []).map((p: any) => ({
          ...p,
          likes: p.likes || 0,
          replyCount: p.replyCount || 0,
          likedBy: Array.isArray(p.likedBy) ? p.likedBy.map(String) : [],
          replies: Array.isArray(p.replies) ? p.replies : [],
        }));
        setPosts(list);
        setPostsError(false);
      } else {
        // Keep the last good feed; a retry state is shown only if we have nothing.
        setPostsError(true);
      }
    } catch (e) {
      console.log('[FETCH_POSTS_ERR]', e);
      if (mountedRef.current) setPostsError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (activeTab === 'wall') {
        await Promise.all([fetchWallActive(), fetchWallHistory()]);
      } else {
        await Promise.all([fetchPosts(), fetchBirthdays()]);
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  };

  const retryPosts = () => {
    setLoading(true);
    setPostsError(false);
    fetchPosts();
  };

  const checkAuthAndRun = (action: () => void) => {
    if (!user) {
      promptSignIn();
      return;
    }
    action();
  };

  const handlePost = async () => {
    if (posting) return;
    if (!user) { promptSignIn(); return; }
    if (photoStillUploading()) return;
    if (!draft.trim() && !draftImage) {
      Alert.alert('Nothing to post yet', 'Write something or add a photo first.');
      return;
    }
    if (isReviewDraft && !replyingTo && !reviewStoreId) {
      Alert.alert('Which place?', reviewStores && reviewStores.length === 0
        ? 'You can review a place once an order from it has been delivered to you.'
        : 'Pick the place you are reviewing.');
      return;
    }
    setPosting(true);

    const submittedReplyingTo = replyingTo;
    const submittedReview = isReviewDraft && !submittedReplyingTo;

    try {
      const body: Record<string, any> = { content: draft.trim() };
      if (draftImage) body.imageUrl = draftImage;
      if (submittedReplyingTo) body.parentId = submittedReplyingTo.id;

      if (submittedReview) {
        body.postType = 'review';
        body.starRating = starRating.toString();
        body.restaurantId = reviewStoreId;
        body.restaurantName = restaurantName.trim();
        body.productName = productName.trim();
      }

      const res = await apiFetch(ENDPOINTS.communityPosts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        // Keep the draft so the user can retry.
        Alert.alert('Couldn\'t post', await friendlyError(res, 'Your post wasn\'t shared. Please try again.'));
        return;
      }

      const saved = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (saved) upsertPost(saved);
      if (submittedReplyingTo) {
        setExpandedThreads(prev => new Set(prev).add(submittedReplyingTo.id));
      }

      setDraft('');
      setDraftImage(null);
      setReplyingTo(null);
      setIsReviewDraft(false);
      setRestaurantName('');
      setReviewStoreId(null);
      setReviewStores(null); // a delivered order is used up by this review: reload next time
      setProductName('');
      setSelectedMood(null);
      setStarRating(5);
      setShowComposer(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      Alert.alert('No connection', 'Your post wasn\'t shared. Please check your internet and try again.');
    } finally {
      if (mountedRef.current) setPosting(false);
    }
  };

  const handleLike = async (id: string) => {
    if (!user) { promptSignIn(); return; }
    const userId = myUserId;
    if (!userId) return;
    if (likePendingRef.current.has(id)) return;
    const target = posts.find(p => p.id === id);
    if (!target) return;
    likePendingRef.current.add(id);

    const previous = { likes: target.likes, likedBy: target.likedBy, likedByMe: target.likedByMe };
    const isLiked = isLikedByMe(target, userId);
    const setLikeState = (likes: number, likedBy: string[], likedByMe: boolean | undefined) => {
      setPosts(prev => prev.map(p => p.id === id ? { ...p, likes, likedBy, likedByMe } : p));
    };

    // Optimistic update
    setLikeState(
      isLiked ? Math.max(0, target.likes - 1) : target.likes + 1,
      isLiked ? target.likedBy.filter(u => u !== userId) : [...target.likedBy, userId],
      !isLiked
    );

    try {
      const res = await apiFetch(ENDPOINTS.communityLike(id), { method: 'PUT' });
      if (!mountedRef.current) return;
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.likes === 'number') {
          const mine = typeof data.likedByMe === 'boolean' ? data.likedByMe : !isLiked;
          setLikeState(
            data.likes,
            Array.isArray(data.likedBy) ? data.likedBy.map(String) : (mine ? [userId] : []),
            mine
          );
        }
      } else {
        setLikeState(previous.likes, previous.likedBy, previous.likedByMe);
        Alert.alert("Couldn't like", await friendlyError(res, 'Please try again in a moment.'));
      }
    } catch (e) {
      if (mountedRef.current) setLikeState(previous.likes, previous.likedBy, previous.likedByMe);
      Alert.alert('No connection', 'Your like was not saved. Please check your internet and try again.');
    } finally {
      likePendingRef.current.delete(id);
    }
  };

  const handleDelete = async (id: string, parentId?: string | null) => {
    Alert.alert('Delete post?', 'This will remove it for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(ENDPOINTS.communityDelete(id), { method: 'DELETE' });
            if (!mountedRef.current) return;
            if (res.ok) {
              if (parentId) {
                setPosts(prev => prev.map(p => p.id === parentId && (p.replies || []).some(r => r.id === id)
                  ? { ...p, replyCount: Math.max((p.replyCount || 1) - 1, 0), replies: (p.replies || []).filter(r => r.id !== id) }
                  : p));
              } else {
                setPosts(prev => prev.filter(p => p.id !== id));
              }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            } else {
              Alert.alert('Couldn\'t delete', await friendlyError(res, 'Please try again in a moment.'));
            }
          } catch (e) {
            Alert.alert('No connection', 'Please check your internet and try again.');
          }
        }
      }
    ]);
  };

  const toggleThread = (id: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Post-card handlers with stable identities (they call the latest screen functions through a ref),
  // so memoized cards don't re-render just because the feed re-rendered.
  const cardFnsRef = useRef({ handleLike, handleDelete, toggleThread, checkAuthAndRun });
  cardFnsRef.current = { handleLike, handleDelete, toggleThread, checkAuthAndRun };
  const cardActions = useMemo<PostCardActions>(() => ({
    openImage: (url) => setSelectedImage(getImageUrl(url)),
    imageError: (postId) => setImageErrors(prev => ({ ...prev, [postId]: true })),
    like: (postId) => cardFnsRef.current.handleLike(postId),
    reply: (post) => cardFnsRef.current.checkAuthAndRun(() => {
      setReplyingTo(post);
      setShowComposer(true);
    }),
    remove: (id, parentId) => cardFnsRef.current.handleDelete(id, parentId),
    toggleThread: (postId) => cardFnsRef.current.toggleThread(postId),
    more: (post, parentId) => {
      setUgcMenu({ post, parentId });
      setUgcMenuOpen(true);
    },
  }), []);
  const signedIn = !!user;
  const renderPost = useCallback(({ item, index }: { item: PostType; index: number }) => (
    <PostCard
      post={item}
      idx={index}
      myUserId={myUserId}
      signedIn={signedIn}
      imageFailed={!!imageErrors[item.id]}
      expanded={expandedThreads.has(item.id)}
      cardBg={cardBg}
      border={border}
      txt={txt}
      txtSec={txtSec}
      isDark={isDark}
      actions={cardActions}
    />
  ), [myUserId, signedIn, imageErrors, expandedThreads, cardBg, border, txt, txtSec, isDark, cardActions]);
  const postExtra = useMemo(() => ({ imageErrors, expandedThreads }), [imageErrors, expandedThreads]);

  const filtered = posts.filter(p => {
    if (search) {
      const q = search.toLowerCase();
      const match = (p.content || '').toLowerCase().includes(q) || (p.userName || '').toLowerCase().includes(q) || (p.restaurantName || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    if (feedCategory === 'reviews') return p.postType === 'review';
    if (feedCategory === 'memories') return p.postType !== 'review';
    return true;
  });

  const trending = [...posts]
    .sort((a, b) => (b.likes + b.replyCount * 2) - (a.likes + a.replyCount * 2))
    .slice(0, 3);
  return (
    <View style={[s.container, { backgroundColor: bg }, embedded && { paddingTop: 0 }]}>
      {/* ── HEADER ── */}
      <View style={[s.header, { borderBottomColor: border }, embedded && { paddingTop: 12 }]}>
        {!embedded && (<>
        <View style={s.headerRow}>
          <TouchableOpacity 
            style={s.backBtn} 
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/' as any);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[s.backText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>◀ BACK</Text>
          </TouchableOpacity>
        </View>

        <View style={s.titleRow}>
          <View style={[s.titleIcon, { backgroundColor: cardBg }]}><Text style={{ fontSize: 24 }}>📸</Text></View>
          <View>
            <Text style={[s.title, { color: txt }]}>Gallery Wall</Text>
            <Text style={[s.subtitle, { color: txtSec }]}>COMMUNITY MEMORIES</Text>
          </View>
        </View>

        {/* Tab Controls */}
        <View style={[s.tabContainer, { backgroundColor: cardBg, borderColor: border }]}>
          <DopaminePressable 
            style={[s.tabBtn, activeTab === 'all' && [s.tabBtnActive, { backgroundColor: isDark ? COLORS.gold : '#3e2723' }], { flex: 1 }]} 
            onPress={() => setActiveTab('all')}
            sound="tabSwitch"
            activeScale={0.96}
          >
            <Text style={[s.tabLabel, activeTab === 'all' && [s.tabLabelActive, { color: isDark ? '#000' : '#fff' }], { paddingVertical: 8 }]}>ALL POSTS</Text>
          </DopaminePressable>
          <DopaminePressable 
            style={[s.tabBtn, activeTab === 'wall' && [s.tabBtnActive, { backgroundColor: isDark ? COLORS.gold : '#3e2723' }], { flex: 1 }]} 
            onPress={() => setActiveTab('wall')}
            sound="tabSwitch"
            activeScale={0.96}
          >
            <Text style={[s.tabLabel, activeTab === 'wall' && [s.tabLabelActive, { color: isDark ? '#000' : '#fff' }], { paddingVertical: 8 }]}>📸 THE WALL</Text>
          </DopaminePressable>
        </View>
        </>)}

        {/* Search */}
        {activeTab === 'all' && (
          <TextInput 
            style={[s.searchBar, { backgroundColor: cardBg, borderColor: border, color: txt }]} 
            placeholder="Search stories..."
            placeholderTextColor={txtSec}
            value={search}
            onChangeText={setSearch}
            maxLength={60}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        )}
      </View>

      {activeTab === 'wall' ? (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? COLORS.gold : '#8b5a2b'} colors={[COLORS.gold]} />}
        >
          {/* Wall Sub-Tab Selector */}
          <View style={{ flexDirection: 'row', backgroundColor: cardBg, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 4, marginBottom: 14 }}>
            <TouchableOpacity
              style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: wallSubTab === 'live' ? (isDark ? COLORS.gold : '#3e2723') : 'transparent' }}
              onPress={() => setWallSubTab('live')}
            >
              <Text style={{ fontSize: 12, fontWeight: '900', color: wallSubTab === 'live' ? (isDark ? '#000' : '#fff') : txtSec, letterSpacing: 1 }}>📸 LIVE CONTEST</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: wallSubTab === 'hof' ? (isDark ? COLORS.gold : '#3e2723') : 'transparent' }}
              onPress={() => setWallSubTab('hof')}
            >
              <Text style={{ fontSize: 12, fontWeight: '900', color: wallSubTab === 'hof' ? (isDark ? '#000' : '#fff') : txtSec, letterSpacing: 1 }}>🏆 HALL OF FAME</Text>
            </TouchableOpacity>
          </View>

          {wallSubTab === 'live' ? (
            <View style={{ flex: 1 }}>
              {!activeWallEvent && wallError && !loadingWall && (
                <View style={s.emptyState}>
                  <Text style={{ fontSize: 40, marginBottom: 8 }}>📡</Text>
                  <Text style={[s.emptyTitle, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>COULDN'T LOAD THE WALL</Text>
                  <Text style={[s.emptySubtitle, { color: txtSec, textAlign: 'center' }]}>Check your connection and try again.</Text>
                  <TouchableOpacity onPress={() => fetchWallActive()} style={[s.retryBtn, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]}>
                    <Text style={[s.retryText, { color: isDark ? '#000' : '#fff' }]}>RETRY</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!activeWallEvent && !wallError && !loadingWall && (
                <View style={s.emptyState}>
                  <Text style={{ fontSize: 40, marginBottom: 8 }}>📸</Text>
                  <Text style={[s.emptyTitle, { color: isDark ? COLORS.gold : '#8b5a2b', textAlign: 'center' }]}>NO CONTEST RIGHT NOW</Text>
                  <Text style={[s.emptySubtitle, { color: txtSec, textAlign: 'center' }]}>The next photo contest will show up here. Check out past winners in the Hall of Fame!</Text>
                  <TouchableOpacity onPress={() => setWallSubTab('hof')} style={[s.retryBtn, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]}>
                    <Text style={[s.retryText, { color: isDark ? '#000' : '#fff' }]}>SEE HALL OF FAME</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Live ticker with the admin-set banner text */}
              {activeWallEvent?.bannerText ? (
                <CrazyMovingBanner text={activeWallEvent.bannerText} theme={activeWallEvent.bannerGradient || 'fire'} />
              ) : null}

              {/* 🌟 HERO EVENT SPOTLIGHT CARD 🌟 */}
              {activeWallEvent && (
                <View style={{
                  borderRadius: 24,
                  overflow: 'hidden',
                  marginBottom: 16,
                  borderWidth: 1.5,
                  borderColor: isDark ? 'rgba(255, 215, 0, 0.4)' : 'rgba(139, 90, 43, 0.3)',
                  backgroundColor: isDark ? '#121215' : '#FFFDF6',
                  shadowColor: isDark ? '#FFD700' : '#8b5a2b',
                  shadowOpacity: 0.35,
                  shadowRadius: 16,
                  elevation: 8,
                }}>
                  <LinearGradient
                    colors={isDark ? ['rgba(255, 69, 0, 0.25)', 'rgba(255, 215, 0, 0.1)', 'rgba(0,0,0,0)'] : ['rgba(255, 140, 0, 0.15)', 'rgba(255, 215, 0, 0.05)', 'rgba(255,255,255,0)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={{ padding: 18 }}>
                    {/* Top Tag Row */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FF8C00', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}>
                        <Text style={{ fontSize: 12 }}>🔥</Text>
                        <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFF', letterSpacing: 1 }}>LIVE CONTEST</Text>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(16, 185, 129, 0.15)', borderWidth: 1, borderColor: '#10B981', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' }} />
                        <Text style={{ fontSize: 12, fontWeight: '900', color: '#10B981', letterSpacing: 0.5 }}>
                          {wallSubmissions.reduce((acc, curr) => acc + (curr.likeCount || 0), 0)} TOTAL VOTES
                        </Text>
                      </View>
                    </View>

                    {/* Main Title & Description */}
                    <Text style={{ fontSize: 19, fontWeight: '900', color: txt, letterSpacing: 0.5, marginBottom: 4 }}>
                      {activeWallEvent.title || 'Photo Contest'}
                    </Text>
                    <Text style={{ fontSize: 12, color: txtSec, lineHeight: 16, marginBottom: 14 }}>
                      {activeWallEvent.description || 'Post your best photo and vote for your favourites. The top-voted photo wins.'}
                    </Text>

                    {/* Countdown & Reward Pills */}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1, backgroundColor: isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.85)', padding: 10, borderRadius: 14, borderWidth: 1, borderColor: border, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 18 }}>⏱️</Text>
                        <View>
                          <Text style={{ fontSize: 12, fontWeight: '900', color: txtSec, letterSpacing: 0.8 }}>COUNTDOWN CLASH</Text>
                          <WallCountdown endTime={activeWallEvent.endTime} active={activeTab === 'wall'} />
                        </View>
                      </View>

                      <View style={{ flex: 1, backgroundColor: isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.85)', padding: 10, borderRadius: 14, borderWidth: 1, borderColor: border, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 18 }}>🎁</Text>
                        <View>
                          <Text style={{ fontSize: 12, fontWeight: '900', color: txtSec, letterSpacing: 0.8 }}>WINNER GETS</Text>
                          <Text style={{ fontSize: 13, fontWeight: '900', color: '#10B981' }}>
                            {activeWallEvent.couponValue ? `₹${activeWallEvent.couponValue} OFF` : '—'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {activeWallEvent.couponValue ? (
                      <View style={{ marginTop: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14, backgroundColor: isDark ? 'rgba(255,140,0,0.12)' : 'rgba(255,140,0,0.08)', borderWidth: 1, borderColor: 'rgba(255,140,0,0.5)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 13 }}>🏆</Text>
                        <Text style={{ fontSize: 12, fontWeight: '900', color: '#FF8C00', letterSpacing: 0.6, flexShrink: 1, textAlign: 'center' }}>
                          TOP-VOTED PHOTO WINS A ₹{activeWallEvent.couponValue} COUPON
                        </Text>
                      </View>
                    ) : null}

                    {userWallSubmission && (
                      <View style={{ marginTop: 12, padding: 8, borderRadius: 10, backgroundColor: userWallSubmission.isApproved ? 'rgba(74,222,128,0.1)' : 'rgba(250,204,21,0.1)', borderWidth: 1, borderColor: userWallSubmission.isApproved ? '#4ADE80' : '#FACC15', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, fontWeight: '900', color: userWallSubmission.isApproved ? '#4ADE80' : '#FACC15' }}>
                          {userWallSubmission.isApproved ? '✅ YOUR PHOTO IS LIVE ON THE WALL!' : '⏳ YOUR PHOTO IS BEING REVIEWED'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Dynamic Masonry Mosaic Grid */}
              {loadingWall && wallSubmissions.length === 0 ? (
                <View style={{ gap: 12, marginTop: 4 }}>
                  <ShimmerLoader width="100%" height={240} borderRadius={24} />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <ShimmerLoader width="48%" height={160} borderRadius={18} />
                    <ShimmerLoader width="48%" height={160} borderRadius={18} />
                  </View>
                </View>
              ) : !activeWallEvent ? null : wallSubmissions.length === 0 ? (
                <View style={s.emptyState}>
                  <Text style={{ fontSize: 40, marginBottom: 8 }}>🖼️</Text>
                  <Text style={[s.emptyTitle, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>THE WALL IS EMPTY</Text>
                  <Text style={[s.emptySubtitle, { color: txtSec, textAlign: 'center' }]}>Be the first to post a photo for this contest!</Text>
                </View>
              ) : (
                <View style={{ paddingBottom: 80, marginTop: 4 }}>
                  {/* #1 HERO LEADER CARD */}
                  {wallSubmissions.length > 0 && (() => {
                    const topSub = wallSubmissions[0];
                    const isLiked = userLikedWallSubmissionIds.includes(topSub.id);
                    return (
                      <View
                        key={topSub.id}
                        style={{
                          width: '100%',
                          height: 280,
                          borderRadius: 24,
                          backgroundColor: cardBg,
                          borderColor: '#FFD700',
                          borderWidth: 2,
                          shadowColor: '#FFD700',
                          shadowOpacity: 0.5,
                          shadowRadius: 16,
                          elevation: 10,
                          position: 'relative',
                          marginBottom: 14,
                          overflow: 'hidden'
                        }}
                      >
                        <TouchableOpacity activeOpacity={0.9} style={{ flex: 1 }} onPress={() => setSelectedImage(getImageUrl(topSub.imageUrl))}>
                          <Image 
                            source={{ uri: getImageUrl(topSub.imageUrl) }} 
                            style={{ width: '100%', height: '100%' }} 
                            contentFit="cover"
                          />

                          {/* Leader Crown Badge Top-Left */}
                          <View style={{ position: 'absolute', top: 14, left: 14, backgroundColor: '#FF8C00', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, zIndex: 10 }}>
                            <Text style={{ fontSize: 14 }}>👑</Text>
                            <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFF', letterSpacing: 1 }}>CURRENT #1 LEADER</Text>
                          </View>

                          {/* Heart Vote Button Top-Right */}
                          <TouchableOpacity
                            style={{ position: 'absolute', top: 14, right: 14, backgroundColor: isLiked ? 'rgba(239,79,95,0.95)' : 'rgba(0,0,0,0.65)', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', zIndex: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}
                            onPress={() => handleWallLike(topSub.id)}
                          >
                            <Text style={{ fontSize: 18 }}>{isLiked ? '❤️' : '🤍'}</Text>
                          </TouchableOpacity>

                          {/* Bottom Glassmorphic Overlay */}
                          <LinearGradient
                            colors={['transparent', 'rgba(0,0,0,0.92)']}
                            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}
                          >
                            <View style={{ flex: 1, paddingRight: 10 }}>
                              <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFD700', letterSpacing: 1, marginBottom: 2 }}>SPOTLIGHT ENTRY</Text>
                              <Text style={{ fontSize: 15, fontWeight: '900', color: '#FFF' }} numberOfLines={1}>
                                {topSub.user?.name || 'Student'}
                              </Text>
                            </View>
                            <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)' }}>
                              <Text style={{ fontSize: 13, fontWeight: '900', color: '#FFD700' }}>❤️ {topSub.likeCount || 0} {topSub.likeCount === 1 ? 'Vote' : 'Votes'}</Text>
                            </View>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}

                  {/* RUNNER-UP 2-COLUMN GRID (#2, #3, #4, ...) */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
                    {wallSubmissions.slice(1).map((sub, index) => {
                      const rank = index + 2;
                      const isLiked = userLikedWallSubmissionIds.includes(sub.id);

                      return (
                        <View
                          key={sub.id}
                          style={{
                            width: '48%',
                            height: 180,
                            backgroundColor: cardBg,
                            borderColor: border,
                            borderWidth: 1,
                            borderRadius: 18,
                            overflow: 'hidden',
                            position: 'relative',
                            marginBottom: 4
                          }}
                        >
                          <TouchableOpacity activeOpacity={0.9} style={{ flex: 1 }} onPress={() => setSelectedImage(getImageUrl(sub.imageUrl))}>
                            <Image 
                              source={{ uri: getImageUrl(sub.imageUrl) }} 
                              style={{ width: '100%', height: '100%' }} 
                              contentFit="cover"
                            />

                            {/* Rank Badge */}
                            <View style={{ position: 'absolute', top: 10, right: 48, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFF' }}>#{rank}</Text>
                            </View>

                            {/* Heart Vote Button */}
                            <TouchableOpacity
                              style={{ position: 'absolute', top: 10, right: 10, backgroundColor: isLiked ? 'rgba(239,79,95,0.95)' : 'rgba(0,0,0,0.6)', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
                              onPress={() => handleWallLike(sub.id)}
                            >
                              <Text style={{ fontSize: 14 }}>{isLiked ? '❤️' : '🤍'}</Text>
                            </TouchableOpacity>

                            {/* Bottom User & Vote Count Gradient Overlay */}
                            <LinearGradient
                              colors={['transparent', 'rgba(0,0,0,0.88)']}
                              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 10, paddingVertical: 10, borderBottomLeftRadius: 18, borderBottomRightRadius: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}
                            >
                              <View style={{ flex: 1, paddingRight: 6 }}>
                                <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFF' }} numberOfLines={1}>
                                  {sub.user?.name || 'Student'}
                                </Text>
                              </View>
                              <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFD700' }}>❤️ {sub.likeCount || 0}</Text>
                              </View>
                            </LinearGradient>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

            </View>
          ) : (
            /* HALL OF FAME TIMELINE VIEW (Matching Mockup 2) */
            <View style={{ flex: 1, backgroundColor: '#080c1d', borderRadius: 24, padding: 16, paddingBottom: 40 }}>
              {/* Header Title */}
              <View style={{ alignItems: 'center', marginBottom: 24 }}>
                <Text style={{ fontSize: 22, fontWeight: '900', color: '#FFD700', letterSpacing: 1 }}>HALL OF FAME ⭐</Text>
                <Text style={{ fontSize: 12, fontWeight: '900', color: COLORS.textMuted, letterSpacing: 2, marginTop: 2 }}>PAST CHAMPIONS OF THE WALL</Text>
              </View>

              {wallHistory.length === 0 ? (
                <View style={s.emptyState}>
                  <Text style={{ fontSize: 40, marginBottom: 8 }}>{wallHistoryError ? '📡' : '🏛️'}</Text>
                  <Text style={[s.emptyTitle, { color: '#FFD700', textAlign: 'center' }]}>{wallHistoryError ? "COULDN'T LOAD WINNERS" : 'NO CHAMPIONS YET'}</Text>
                  <Text style={[s.emptySubtitle, { color: COLORS.textMuted, textAlign: 'center' }]}>
                    {wallHistoryError ? 'Pull down to try again.' : 'Winners of finished contests will appear here.'}
                  </Text>
                </View>
              ) : (
                <View style={{ position: 'relative', width: '100%', paddingVertical: 10 }}>
                  {/* Central Vertical Gold Timeline Bar (Mockup 2) */}
                  <View style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, backgroundColor: 'rgba(255,215,0,0.5)', transform: [{ translateX: -1 }] }} />

                  <View style={{ gap: 28 }}>
                    {wallHistory.map((item, index) => {
                      const isEven = index % 2 === 0;
                      return (
                        <View
                          key={item.event.id}
                          style={{
                            width: '100%',
                            flexDirection: 'row',
                            justifyContent: isEven ? 'flex-start' : 'flex-end',
                            alignItems: 'center',
                            position: 'relative'
                          }}
                        >
                          {/* Timeline Node Avatar (Matching Laurel Wreath Gold Frame in Mockup 2) */}
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => setSelectedHofWinner(item)}
                            style={{
                              width: '45%',
                              alignItems: 'center',
                              padding: 10,
                              backgroundColor: 'rgba(15,23,42,0.85)',
                              borderRadius: 18,
                              borderWidth: 1.5,
                              borderColor: '#FFD700',
                              shadowColor: '#FFD700',
                              shadowOpacity: 0.4,
                              shadowRadius: 8
                            }}
                          >
                            {/* Crown on top of Avatar Circle */}
                            <View style={{ position: 'absolute', top: -10, zIndex: 10 }}>
                              <Text style={{ fontSize: 16 }}>👑</Text>
                            </View>

                            <View style={{ width: 60, height: 60, borderRadius: 30, overflow: 'hidden', borderWidth: 2, borderColor: '#FFD700', marginVertical: 4, backgroundColor: '#000' }}>
                              {item.winningSubmission?.imageUrl ? (
                                <Image source={{ uri: getImageUrl(item.winningSubmission.imageUrl) }} style={{ width: '100%', height: '100%' }} />
                              ) : (
                                <Text style={{ fontSize: 24, alignSelf: 'center', marginTop: 10 }}>🏆</Text>
                              )}
                            </View>

                            <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFD700', letterSpacing: 1, marginTop: 2 }}>
                              {item.event.endTime ? new Date(item.event.endTime).toLocaleString('default', { month: 'short', year: 'numeric' }).toUpperCase() : ''}
                            </Text>

                            <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFF', textAlign: 'center', marginTop: 2 }} numberOfLines={1}>
                              {item.winningSubmission?.user?.name || item.winner?.name || 'Champion'}
                            </Text>

                            <Text style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
                              ❤️ {item.winningSubmission?.likeCount || 0} Votes
                            </Text>

                            {item.event.couponValue ? (
                              <View style={{ marginTop: 4, backgroundColor: 'rgba(74,222,128,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#4ADE80' }}>
                                <Text style={{ fontSize: 12, fontWeight: '900', color: '#4ADE80' }}>WON ₹{item.event.couponValue}</Text>
                              </View>
                            ) : null}
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={postKey}
          renderItem={renderPost}
          extraData={postExtra}
          numColumns={2}
          columnWrapperStyle={s.galleryRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={9}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? COLORS.gold : '#8b5a2b'} colors={[COLORS.gold]} />}
          ListHeaderComponent={
            <>
        {!embedded && (
        <DopaminePressable
          style={[
            s.friendsCard,
            {
              backgroundColor: cardBg,
              borderColor: isDark ? 'rgba(212, 175, 55, 0.2)' : 'rgba(139, 90, 43, 0.15)',
              shadowColor: isDark ? '#D4AF37' : '#8b5a2b',
            }
          ]}
          onPress={() => router.push('/friends' as any)}
          sound="click"
          activeScale={0.97}
        >
          <LinearGradient
            colors={isDark ? ['rgba(212, 175, 55, 0.08)', 'rgba(0, 0, 0, 0)'] : ['rgba(139, 90, 43, 0.04)', 'rgba(0, 0, 0, 0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.friendsGradient}
          />
          <View style={s.friendsCardHeader}>
            <View style={s.friendsIconContainer}>
              <Text style={{ fontSize: 20 }}>👥</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.friendsCardTitle, { color: txt }]}>Campus</Text>
              <Text style={[s.friendsCardSub, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>Chats, groups and Pulse</Text>
            </View>
            <View style={s.streakPulseContainer}>
              <FloatingPulse color="#FF5A00">
                <Text style={{ fontSize: 12 }}>🔥</Text>
              </FloatingPulse>
            </View>
          </View>
          <Text style={[s.friendsCardBody, { color: txtSec }]}>
            Chat with classmates, join class and club groups, and catch up on what's happening on campus.
          </Text>
          <View style={s.friendsFooter}>
            <Text style={[s.friendsFooterText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>OPEN CAMPUS BUDDY →</Text>
          </View>
        </DopaminePressable>
        )}

        {/* ── BIRTHDAY CELEBRATIONS STORY ROW ── */}
        <View style={s.birthdaySection}>
          <View style={s.birthdaySectionHeader}>
            <Text style={[s.birthdaySectionTitle, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>🎂 CELEBRATIONS</Text>
            {user?.role?.toLowerCase() === 'admin' && pendingBirthdays.length > 0 && (
              <TouchableOpacity onPress={() => setShowAdminPanelModal(true)}>
                <Text style={[s.adminBadgeText, { color: COLORS.red }]}>ADMIN QUEUE ({pendingBirthdays.length})</Text>
              </TouchableOpacity>
            )}
          </View>
          
          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={s.birthdayScroll} contentContainerStyle={{ paddingHorizontal: 16, gap: 14, alignItems: 'center' }}>
            {/* Nominate / Add Story */}
            <TouchableOpacity 
              style={s.birthdayStoryCard} 
              onPress={() => checkAuthAndRun(() => setShowRegisterBirthdayModal(true))}
            >
              <View style={[s.addBirthdayStoryCircle, { borderColor: border }]}>
                <Text style={{ fontSize: 22, color: txtSec }}>➕</Text>
              </View>
              <Text style={[s.birthdayStoryName, { color: txtSec }]} numberOfLines={1}>Nominate</Text>
            </TouchableOpacity>

            {birthdays.length === 0 && (
              <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec, maxWidth: 220 }}>
                No birthdays today. Know someone celebrating? Tap Nominate 🎈
              </Text>
            )}

            {/* Birthday Stories */}
            {birthdays.map(b => (
              <TouchableOpacity 
                key={b.id} 
                style={s.birthdayStoryCard} 
                onPress={() => openBirthdayDetail(b)}
              >
                <PulseGlow size={66} color="#FF69B4">
                  <View style={s.birthdayStoryCircle}>
                    {b.candidatePhotoUrl && !imageErrors[b.id] ? (
                      <Image 
                        source={{ uri: getImageUrl(b.candidatePhotoUrl) }} 
                        style={s.birthdayStoryImg} 
                        onError={() => {
                          setImageErrors(prev => ({ ...prev, [b.id]: true }));
                        }}
                      />
                    ) : (
                      <View style={[s.birthdayStoryTextImg, { backgroundColor: isDark ? '#1C161D' : '#FFF0F5' }]}>
                        <Text style={{ fontSize: 24 }}>🎂</Text>
                      </View>
                    )}
                  </View>
                </PulseGlow>
                <Text style={[s.birthdayStoryName, { color: txt }]} numberOfLines={1}>{b.candidateName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── TRENDING ── */}
        {!search && posts.length > 3 && trending.some(t => (t.likes || 0) + (t.replyCount || 0) > 0) &&(
          <View style={s.trendingSection}>
            <Text style={[s.trendingTitle, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>🔥 TRENDING NOW</Text>
            <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={s.trendingScroll}>
              {trending.map(tp => (
                <View key={tp.id} style={[s.trendingCard, { backgroundColor: cardBg, borderColor: border }]}>
                  <View style={s.trendingUserRow}>
                    <View style={s.trendingAvatar}><Text style={s.avatarText}>{(tp.userName||'A').charAt(0).toUpperCase()}</Text></View>
                    <Text style={[s.trendingUser, { color: txt }]} numberOfLines={1}>{tp.userName}</Text>
                  </View>
                  <Text style={[s.trendingContent, { color: txtSec }]} numberOfLines={2}>{tp.content}</Text>
                  <View style={s.trendingStats}>
                    <Text style={s.trendingStat}>♥ {tp.likes}</Text>
                    <Text style={s.trendingStat}>💬 {tp.replyCount}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── 🏷️ CATEGORY FILTER CHIPS ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
          {[
            { id: 'all', label: '✨ All Stories', count: posts.length },
            { id: 'memories', label: '📸 Campus Life', count: posts.filter(p => p.postType !== 'review').length },
            { id: 'reviews', label: '⭐ Food Reviews', count: posts.filter(p => p.postType === 'review').length },
          ].map(cat => {
            const isActive = feedCategory === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: isActive ? (isDark ? COLORS.gold : '#3e2723') : cardBg,
                  borderColor: isActive ? (isDark ? COLORS.gold : '#3e2723') : border,
                  borderWidth: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 20
                }}
                onPress={() => setFeedCategory(cat.id as any)}
              >
                <Text style={{ fontSize: 12, fontWeight: '900', color: isActive ? (isDark ? '#000' : '#fff') : txtSec }}>
                  {cat.label}
                </Text>
                <View style={{ backgroundColor: isActive ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 }}>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: isActive ? (isDark ? '#000' : '#fff') : txtSec }}>{cat.count}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Hanging Rope String Indicator */}
        <View style={[s.stringLine, { backgroundColor: isDark ? 'rgba(212,175,122,0.3)' : 'rgba(139,90,43,0.15)' }]} />
              {/* galleryGrid's top padding (the empty / loading states carry their own) */}
              {filtered.length > 0 && <View style={{ height: 12 }} />}
            </>
          }
          ListFooterComponent={filtered.length > 0 ? <View style={{ height: 12 }} /> : null}
          ListEmptyComponent={
            loading && posts.length === 0 ? (
          <View style={s.galleryGrid}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[s.polaroidWrapper, { padding: 0 }]}>
                <ShimmerLoader width="100%" height={(SW - 44) / 2 + 70} borderRadius={4} />
              </View>
            ))}
          </View>
        ) : postsError && posts.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={{ fontSize: 44, marginBottom: 12 }}>📡</Text>
            <Text style={[s.emptyTitle, { color: isDark ? COLORS.gold : '#8b5a2b', textAlign: 'center' }]}>COULDN'T LOAD POSTS</Text>
            <Text style={[s.emptySubtitle, { color: txtSec, textAlign: 'center' }]}>Check your connection and try again.</Text>
            <TouchableOpacity onPress={retryPosts} style={[s.retryBtn, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]}>
              <Text style={[s.retryText, { color: isDark ? '#000' : '#fff' }]}>RETRY</Text>
            </TouchableOpacity>
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>{search ? '🔍' : '🖼️'}</Text>
            <Text style={[s.emptyTitle, { color: isDark ? COLORS.gold : '#8b5a2b', textAlign: 'center' }]}>
              {search ? 'NO MATCHES' : feedCategory === 'reviews' ? 'NO REVIEWS YET' : 'BLANK CANVAS'}
            </Text>
            <Text style={[s.emptySubtitle, { color: txtSec, textAlign: 'center' }]}>
              {search ? `Nothing found for "${search}".` : 'Be the first to post on the wall.'}
            </Text>
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')} style={[s.retryBtn, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]}>
                <Text style={[s.retryText, { color: isDark ? '#000' : '#fff' }]}>CLEAR SEARCH</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => checkAuthAndRun(() => { setReplyingTo(null); setIsReviewDraft(feedCategory === 'reviews'); setShowComposer(true); })}
                style={[s.retryBtn, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]}
              >
                <Text style={[s.retryText, { color: isDark ? '#000' : '#fff' }]}>{feedCategory === 'reviews' ? 'WRITE A REVIEW' : 'CREATE A POST'}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null
          }
        />
    )}

      {/* Floating Wall submit button (outside the ScrollView so it never scrolls away) */}
      {activeTab === 'wall' && wallSubTab === 'live' && activeWallEvent && !wallEnded && !userWallSubmission && (
        <TouchableOpacity
          style={s.wallSubmitFab}
          onPress={() => checkAuthAndRun(() => setShowWallSubmitModal(true))}
          activeOpacity={0.85}
        >
          <Text style={{ fontSize: 18, color: '#FFF' }}>📸</Text>
          <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFF', letterSpacing: 1 }}>SUBMIT PHOTO</Text>
        </TouchableOpacity>
      )}

      {/* Floating Compose Button (Only on ALL POSTS tab) */}
      {activeTab === 'all' && (
        <FloatingPulse color={isDark ? COLORS.gold : '#8b5a2b'} style={s.composeFabWrap}>
          <ActionPressable 
            style={[s.composeFab, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]} 
            onPress={() => {
              checkAuthAndRun(() => {
                setReplyingTo(null);
                setShowComposer(true);
              });
            }}
            sound="click"
          >
            <Text style={{ fontSize: 24, color: '#fff' }}>+</Text>
          </ActionPressable>
        </FloatingPulse>
      )}
      <Modal visible={showComposer} animationType="slide" transparent={true} onRequestClose={() => { if (!posting) setShowComposer(false); }}>
        <KeyboardAvoidingView 
          style={{ flex: 1 }} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); if (!posting) setShowComposer(false); }}>
            <View style={s.composerOverlay}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={[s.composerContent, { backgroundColor: cardBg, maxHeight: '85%' }]}>
                  <View style={s.dragHandle} />

                  <ScrollView 
                    showsVerticalScrollIndicator={false} 
                    keyboardShouldPersistTaps="handled"
                    bounces={false}
                    contentContainerStyle={{ paddingBottom: 240 }}
                  >
                    {replyingTo && (
                      <View style={[s.replyBanner, { backgroundColor: isDark ? '#1C1B1F' : 'rgba(139,90,43,0.05)', borderColor: border }]}>
                        <Text style={[s.replyBannerText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>REPLYING TO {(replyingTo.userName || 'Student').toUpperCase()}</Text>
                        <Text style={[s.replyBannerSub, { color: txtSec }]} numberOfLines={1}>{replyingTo.content}</Text>
                      </View>
                    )}

                    <Text style={[s.composerTitle, { color: txt }]}>{replyingTo ? 'REPLY TO THREAD' : 'PIN NEW MEMORY'}</Text>
                    
                    {/* The server always posts as the signed-in account, so the name is shown, not edited. */}
                    {user?.name ? (
                      <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec, marginBottom: 10 }}>
                        Posting as {user.name}
                      </Text>
                    ) : null}

                    {!replyingTo && (
                      <View style={[s.reviewToggleRow, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border }]}>
                        <Text style={[s.reviewToggleLabel, { color: txt }]}>POST AS FOOD REVIEW?</Text>
                        <TouchableOpacity 
                          style={[s.toggleBtn, isReviewDraft && [s.toggleBtnActive, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b', borderColor: isDark ? COLORS.gold : '#8b5a2b' }]] as any}
                          onPress={() => setIsReviewDraft(!isReviewDraft)}
                        >
                          <Text style={[s.toggleBtnText, isReviewDraft && { color: isDark ? '#000' : '#fff' }]}>
                            {isReviewDraft ? 'YES' : 'NO'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {isReviewDraft && !replyingTo && (
                      <View style={[s.reviewFields, { backgroundColor: isDark ? '#1C1B1F' : 'rgba(139,90,43,0.04)', borderColor: border }]}>
                        <View style={s.ratingStarsRow}>
                          {[1, 2, 3, 4, 5].map(star => (
                            <DopaminePressable key={star} onPress={() => setStarRating(star)} sound="click" activeScale={0.88}>
                              <Text style={[s.starIcon, starRating >= star && { color: '#F59E0B' }]}>★</Text>
                            </DopaminePressable>
                          ))}
                        </View>
                        {reviewStores === null ? (
                          <ActivityIndicator size="small" color={isDark ? COLORS.gold : '#8b5a2b'} />
                        ) : reviewStores.length === 0 ? (
                          <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec }}>
                            You can review a place once an order from it has been delivered to you.
                          </Text>
                        ) : (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
                            {reviewStores.map(st => {
                              const sel = reviewStoreId === st.id;
                              return (
                                <TouchableOpacity
                                  key={st.id}
                                  onPress={() => { setReviewStoreId(sel ? null : st.id); setRestaurantName(sel ? '' : st.name); }}
                                  accessibilityRole="radio"
                                  accessibilityState={{ selected: sel }}
                                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: sel ? (isDark ? COLORS.gold : '#8b5a2b') : border, backgroundColor: sel ? (isDark ? COLORS.gold : '#8b5a2b') : (isDark ? '#222' : '#fff') }}
                                >
                                  <Text style={{ fontSize: 12, fontWeight: '800', color: sel ? (isDark ? '#000' : '#fff') : txt }} numberOfLines={1}>📍 {st.name}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        )}
                        <TextInput style={[s.reviewInputField, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border, color: txt }]} placeholder="Dish Name" placeholderTextColor={txtSec} value={productName} onChangeText={setProductName} maxLength={60} />
                      </View>
                    )}

                    {/* Mood Selector Chips */}
                    <View style={{ marginBottom: 12 }}>
                      <Text style={{ fontSize: 12, fontWeight: '900', color: txtSec, letterSpacing: 1, marginBottom: 6 }}>SELECT CAMPUS MOOD / TAG</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {['🌶️ Spicy Cravings', '🧀 Cheesy Pull', '💻 3 AM Hackathon', '🎸 Fest Vibes', '⚽ Sports Win', '📚 Exam Grind', '🎉 Room Party'].map(mood => {
                          const isSel = selectedMood === mood;
                          return (
                            <TouchableOpacity
                              key={mood}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 14,
                                backgroundColor: isSel ? (isDark ? COLORS.gold : '#3e2723') : (isDark ? '#222' : '#F5F5F0'),
                                borderWidth: 1,
                                borderColor: isSel ? (isDark ? COLORS.gold : '#3e2723') : border
                              }}
                              onPress={() => {
                                // One mood tag at a time: drop the previous [tag] prefix before adding the new one.
                                const stripTag = (t: string) => (selectedMood && t.startsWith(`[${selectedMood}]`) ? t.slice(selectedMood.length + 2).replace(/^ /, '') : t);
                                if (selectedMood === mood) {
                                  setSelectedMood(null);
                                  setDraft(prev => stripTag(prev));
                                } else {
                                  setSelectedMood(mood);
                                  setDraft(prev => {
                                    const rest = stripTag(prev);
                                    return `[${mood}] ${rest}`.slice(0, 500);
                                  });
                                }
                              }}
                            >
                              <Text style={{ fontSize: 12, fontWeight: '800', color: isSel ? (isDark ? '#000' : '#fff') : txt }}>{mood}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>

                    <TextInput 
                      style={[s.composerTextArea, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border, color: txt }]} 
                      placeholder={replyingTo ? 'Write a reply...' : 'Write something beautiful...'} 
                      placeholderTextColor={txtSec} 
                      multiline 
                      numberOfLines={4} 
                      value={draft}
                      onChangeText={setDraft}
                      maxLength={500}
                    />
                    <Text style={{ alignSelf: 'flex-end', fontSize: 12, fontWeight: '700', color: draft.length > 450 ? COLORS.red : txtSec, marginTop: -6, marginBottom: 8 }}>
                      {draft.length}/500
                    </Text>

                    <TouchableOpacity 
                      style={[s.composerInputName, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border, justifyContent: 'center', alignItems: 'center' }]} 
                      onPress={pickImage}
                    >
                      <Text style={{ color: txt, fontSize: 12, fontWeight: '700' }}>
                        {photoUploading === 'post' ? '⏳ Uploading photo…' : draftImage ? '🖼️ Photo added (tap to change)' : '📸 Add a photo from gallery'}
                      </Text>
                    </TouchableOpacity>

                    {draftImage ? (
                      <View style={{ alignSelf: 'center', marginBottom: 12 }}>
                        <Image source={{ uri: draftImage }} style={[s.composerImgPreview, { marginBottom: 0 }]} />
                        <TouchableOpacity
                          onPress={() => setDraftImage(null)}
                          style={{ position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    <View style={s.composerActions}>
                      <DopaminePressable style={[s.composerCancel, { flex: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }]} onPress={() => { if (!posting) setShowComposer(false); }} sound="click">
                        <Text style={[s.cancelText, { color: txtSec }]}>CANCEL</Text>
                      </DopaminePressable>

                      <ActionPressable 
                        style={[s.composerSubmit, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }, posting && { opacity: 0.5 }, { flex: 2 }] as any} 
                        onPress={handlePost} 
                        disabled={posting}
                        sound="success"
                      >
                        {posting ? (
                          <ActivityIndicator size="small" color={isDark ? '#000' : '#fff'} />
                        ) : (
                          <Text style={[s.submitText, { color: isDark ? '#000' : '#fff' }]}>{replyingTo ? 'REPLY 💬' : 'PIN POST 📌'}</Text>
                        )}
                      </ActionPressable>
                    </View>

                    {/* Extra padding so content is visible above keyboard */}
                    <View style={{ height: 20 }} />
                  </ScrollView>

                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── LIGHTBOX MODAL ── */}
      <ActionMenu
        visible={ugcMenuOpen}
        onClose={() => setUgcMenuOpen(false)}
        title={ugcMenu?.parentId ? 'Reply' : 'Post'}
        report={ugcMenu ? { type: 'community_post', id: String(ugcMenu.post.id), label: `${ugcMenu.parentId ? 'a reply' : 'a post'} by ${ugcMenu.post.userName || 'a student'}` } : null}
        block={ugcMenu && ugcMenu.post.userId ? { userId: String(ugcMenu.post.userId), name: ugcMenu.post.userName || 'this student' } : null}
        onReported={() => { if (ugcMenu) dropLocal(String(ugcMenu.post.id), ugcMenu.parentId); }}
        onBlocked={(uid) => dropAuthor(uid)}
      />
      <Modal visible={!!selectedImage} transparent={true} animationType="fade" onRequestClose={() => setSelectedImage(null)}>
        <TouchableOpacity 
          style={s.lightboxOverlay} 
          activeOpacity={1} 
          onPress={() => setSelectedImage(null)}
        >
          {selectedImage && (
            <Image source={{ uri: selectedImage }} style={s.lightboxImg} contentFit="contain" />
          )}
        </TouchableOpacity>
      </Modal>

      {/* ── BIRTHDAY WISHING MODAL ── */}
      <Modal visible={showBirthdayWishModal} transparent={true} animationType="slide" onRequestClose={() => setShowBirthdayWishModal(false)}>
        <View style={s.bdayOverlay}>
          {/* Confetti cannon! (one burst per opening) */}
          {showBirthdayWishModal && <ConfettiCannon key={selectedBirthday?.id || 'confetti'} />}

          <TouchableWithoutFeedback onPress={() => setShowBirthdayWishModal(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'padding'} 
            style={s.bdayCardWrapper}
          >
            <View style={[s.bdayCard, { backgroundColor: isDark ? '#141416' : '#fff', maxHeight: SH * 0.85 }]}>
              <ScrollView 
                style={{ width: '100%' }}
                contentContainerStyle={{ alignItems: 'center' }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* Card Header decoration */}
                <View style={s.bdayHeaderDecor}>
                  <Text style={{ fontSize: 24 }}>✨🎉🥳🎉✨</Text>
                </View>

                {/* Close Button */}
                <TouchableOpacity style={s.bdayCloseBtn} onPress={() => setShowBirthdayWishModal(false)}>
                  <Text style={{ fontSize: 18, color: txtSec }}>✕</Text>
                </TouchableOpacity>

                {selectedBirthday && (
                  <>
                    {/* Large Avatar container */}
                    <PulseGlow size={110} color="#FF69B4">
                      <View style={s.bdayLargeAvatarRing}>
                        {selectedBirthday.candidatePhotoUrl && !imageErrors[selectedBirthday.id] ? (
                          <Image 
                            source={{ uri: getImageUrl(selectedBirthday.candidatePhotoUrl) }} 
                            style={s.bdayLargeAvatarImg} 
                            onError={() => {
                              setImageErrors(prev => ({ ...prev, [selectedBirthday.id]: true }));
                            }}
                          />
                        ) : (
                          <Text style={{ fontSize: 44 }}>🎂</Text>
                        )}
                      </View>
                    </PulseGlow>

                    {/* Name and count */}
                    <Text style={[s.bdayCandidateName, { color: txt }]}>{selectedBirthday.candidateName}</Text>
                    <Text style={[s.bdayWishCountText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>
                      ❤️ {selectedBirthday.wishCount || 0} {selectedBirthday.wishCount === 1 ? 'wish' : 'wishes'} so far
                    </Text>

                    {/* Wishes Scroll View */}
                    <View style={[s.bdayWishesContainer, { borderColor: border }]}>
                      <ScrollView 
                        showsVerticalScrollIndicator={false}
                        nestedScrollEnabled
                        style={{ flex: 1 }}
                      >
                        {loadingWishes && selectedBirthdayWishes.length === 0 ? (
                          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                            <ActivityIndicator size="small" color={isDark ? COLORS.gold : '#FF69B4'} />
                          </View>
                        ) : selectedBirthdayWishes.length === 0 ? (
                          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                            <Text style={{ color: txtSec, fontSize: 12, fontWeight: '700' }}>No wishes yet. Be the first! 👇</Text>
                          </View>
                        ) : (
                          selectedBirthdayWishes.map((w, idx) => (
                            <View key={w.id || idx} style={[s.wishBubble, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]}>
                              <Text style={[s.wishBubbleUser, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>{w.userName}</Text>
                              <Text style={[s.wishBubbleText, { color: txt }]}>{w.message || 'Happy Birthday! 🎉'}</Text>
                            </View>
                          ))
                        )}
                      </ScrollView>
                    </View>

                    {/* Quick Reaction Row */}
                    <View style={s.quickReactionsRow}>
                      {['🎉 Congrats!', '🎂 HBD!', '💖 Stay Blessed!', '👑 Superstar!', '🥳 Cheers!'].map((react) => (
                        <TouchableOpacity 
                          key={react} 
                          style={[s.quickReactionBadge, { borderColor: border }, (alreadyWished || submittingWish) && { opacity: 0.4 }]}
                          onPress={() => submitWish(react)}
                          disabled={alreadyWished || submittingWish}
                        >
                          <Text style={s.quickReactionText}>{react}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {alreadyWished && (
                      <Text style={{ fontSize: 12, fontWeight: '800', color: isDark ? COLORS.gold : '#FF69B4', marginBottom: 10 }}>
                        ✅ Your wish has been sent!
                      </Text>
                    )}

                    {/* Custom wish composer */}
                    {!alreadyWished && (
                    <View style={s.bdayComposeRow}>
                      <TextInput 
                        style={[s.bdayWishInput, { backgroundColor: isDark ? '#222' : '#fff', color: txt, borderColor: border }]}
                        placeholder="Write a custom blessing..."
                        placeholderTextColor={txtSec}
                        value={birthdayWishMessage}
                        onChangeText={setBirthdayWishMessage}
                        maxLength={140}
                        returnKeyType="send"
                        onSubmitEditing={() => submitWish()}
                      />
                      <TouchableOpacity
                        style={[s.bdayWishSendBtn, { backgroundColor: isDark ? COLORS.gold : '#FF69B4' }, (!birthdayWishMessage.trim() || submittingWish) && { opacity: 0.5 }]}
                        onPress={() => submitWish()}
                        disabled={submittingWish || !birthdayWishMessage.trim()}
                      >
                        {submittingWish ? (
                          <ActivityIndicator size="small" color="#000" />
                        ) : (
                          <Text style={s.bdayWishSendText}>SEND</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── REGISTER / NOMINATE BIRTHDAY MODAL ── */}
      <Modal visible={showRegisterBirthdayModal} transparent={true} animationType="slide" onRequestClose={() => setShowRegisterBirthdayModal(false)}>
        <View style={s.bdayOverlay}>
          <TouchableWithoutFeedback onPress={() => { if (!submittingBirthday) setShowRegisterBirthdayModal(false); }}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'padding'} 
            style={s.bdayCardWrapper}
          >
            <View style={[s.bdayCard, { backgroundColor: isDark ? '#141416' : '#fff', maxHeight: SH * 0.85 }]}>
              <ScrollView 
                style={{ width: '100%' }}
                contentContainerStyle={{ alignItems: 'center' }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[s.modalTitle, { color: txt }]}>NOMINATE BIRTHDAY PEER</Text>
                <Text style={[s.modalSubtitle, { color: txtSec }]}>Nominate a classmate. Once approved, their birthday shows up here for everyone to wish.</Text>

                {/* Form Input fields */}
                <TextInput 
                  style={[s.bdayWishInput, { backgroundColor: isDark ? '#222' : '#fff', color: txt, borderColor: border, width: '100%', marginBottom: 12 }]}
                  placeholder="Candidate Full Name"
                  placeholderTextColor={txtSec}
                  value={newBirthdayName}
                  onChangeText={setNewBirthdayName}
                  maxLength={60}
                  autoCapitalize="words"
                />

                <TextInput 
                  style={[s.bdayWishInput, { backgroundColor: isDark ? '#222' : '#fff', color: txt, borderColor: border, width: '100%', marginBottom: 12 }]}
                  placeholder="Birthday Date (YYYY-MM-DD)"
                  placeholderTextColor={txtSec}
                  value={newBirthdayDate}
                  onChangeText={(t) => setNewBirthdayDate(t.replace(/[^0-9-]/g, ''))}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />

                {/* Photo selector */}
                <TouchableOpacity 
                  style={[s.bdayPhotoSelector, { borderColor: border }]}
                  onPress={pickBirthdayPhoto}
                >
                  {photoUploading === 'birthday' ? (
                    <ActivityIndicator color={txtSec} />
                  ) : newBirthdayPhoto ? (
                    <Image source={{ uri: newBirthdayPhoto }} style={s.bdayPhotoPreview} />
                  ) : (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 24, marginBottom: 4 }}>📸</Text>
                      <Text style={{ color: txtSec, fontSize: 12, fontWeight: '700' }}>ADD PEER PORTRAIT</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* Action Buttons */}
                <View style={s.modalActionsRow}>
                  <TouchableOpacity 
                    style={[s.modalCancelBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} 
                    onPress={() => setShowRegisterBirthdayModal(false)}
                  >
                    <Text style={[s.modalCancelText, { color: txtSec }]}>CANCEL</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[s.modalSubmitBtn, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]} 
                    onPress={submitBirthday}
                    disabled={submittingBirthday}
                  >
                    {submittingBirthday ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <Text style={s.modalSubmitText}>NOMINATE 🎁</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── ADMIN PANEL QUEUE MODAL ── */}
      <Modal visible={showAdminPanelModal} transparent={true} animationType="slide" onRequestClose={() => setShowAdminPanelModal(false)}>
        <View style={s.bdayOverlay}>
          <TouchableWithoutFeedback onPress={() => setShowAdminPanelModal(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <View style={[s.bdayCard, { backgroundColor: isDark ? '#141416' : '#fff', maxHeight: '80%' }]}>
            <Text style={[s.modalTitle, { color: txt }]}>ADMIN APPROVAL QUEUE</Text>
            <Text style={[s.modalSubtitle, { color: txtSec }]}>Approve celebrations to notify users and set them live for 24h.</Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%', marginVertical: 12 }}>
              {pendingBirthdays.length === 0 ? (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: txtSec, fontSize: 12, fontWeight: '700' }}>No pending nominations in queue. 🌟</Text>
                </View>
              ) : (
                pendingBirthdays.map((p) => (
                  <View key={p.id} style={[s.adminQueueCard, { borderColor: border, backgroundColor: isDark ? '#1C1B1F' : '#fcfcfc' }]}>
                    <View style={s.adminQueueRow}>
                      {p.candidatePhotoUrl && !imageErrors[p.id] ? (
                        <Image 
                          source={{ uri: getImageUrl(p.candidatePhotoUrl) }} 
                          style={s.adminQueueImg} 
                          onError={() => {
                            setImageErrors(prev => ({ ...prev, [p.id]: true }));
                          }}
                        />
                      ) : (
                        <View style={s.adminQueueTextImg}><Text>🎂</Text></View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[s.adminQueueName, { color: txt }]}>{p.candidateName}</Text>
                        <Text style={[s.adminQueueDate, { color: txtSec }]}>Date: {p.birthdayDate}</Text>
                      </View>
                    </View>

                    <View style={s.adminQueueActions}>
                      <TouchableOpacity 
                        style={[s.adminRejectBtn, { backgroundColor: COLORS.red + '22' }]} 
                        onPress={() => rejectBirthday(p.id)}
                      >
                        <Text style={{ color: COLORS.red, fontSize: 12, fontWeight: '900' }}>REJECT ❌</Text>
                      </TouchableOpacity>

                      <TouchableOpacity 
                        style={[s.adminApproveBtn, { backgroundColor: COLORS.emerald + '22' }]} 
                        onPress={() => approveBirthday(p.id)}
                      >
                        <Text style={{ color: COLORS.emerald, fontSize: 12, fontWeight: '900' }}>APPROVE ✅</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity 
              style={[s.modalCancelBtn, { width: '100%', backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} 
              onPress={() => setShowAdminPanelModal(false)}
            >
              <Text style={[s.modalCancelText, { color: txtSec }]}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── WALL SUBMIT PHOTO MODAL ── */}
      <Modal visible={showWallSubmitModal} transparent={true} animationType="slide" onRequestClose={() => { if (!submittingWallPhoto) setShowWallSubmitModal(false); }}>
        <View style={s.bdayOverlay}>
          <TouchableWithoutFeedback onPress={() => { if (!submittingWallPhoto) setShowWallSubmitModal(false); }}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'padding'} style={s.bdayCardWrapper}>
            <View style={[s.bdayCard, { backgroundColor: isDark ? '#141416' : '#fff' }]}>
              <Text style={[s.modalTitle, { color: txt }]}>SUBMIT CONTEST PHOTO 📸</Text>
              <Text style={[s.modalSubtitle, { color: txtSec }]}>Upload your photo for "{activeWallEvent?.title || 'The Wall'}".{activeWallEvent?.couponValue ? ` The top-voted photo wins a ₹${activeWallEvent.couponValue} coupon!` : ''}</Text>

              <TouchableOpacity style={[s.bdayPhotoSelector, { borderColor: border }]} onPress={pickWallPhoto}>
                {photoUploading === 'wall' ? (
                  <ActivityIndicator color={txtSec} />
                ) : wallSubmitImage ? (
                  <Image source={{ uri: wallSubmitImage }} style={s.bdayPhotoPreview} />
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 32 }}>📷</Text>
                    <Text style={{ color: isDark ? COLORS.gold : '#8b5a2b', fontSize: 12, fontWeight: '700', marginTop: 4 }}>Select Photo from Gallery</Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={s.modalActionsRow}>
                <TouchableOpacity style={[s.modalCancelBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} onPress={() => { if (!submittingWallPhoto) setShowWallSubmitModal(false); }}>
                  <Text style={[s.modalCancelText, { color: txtSec }]}>CANCEL</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[s.modalSubmitBtn, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]} onPress={submitWallPhoto} disabled={submittingWallPhoto}>
                  {submittingWallPhoto ? (
                    <ActivityIndicator size="small" color={isDark ? '#000' : '#fff'} />
                  ) : (
                    <Text style={[s.modalSubmitText, { color: isDark ? '#000' : '#fff' }]}>UPLOAD ENTRY 🚀</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── 🏆 CHAMPION SPOTLIGHT DETAIL MODAL ── */}
      <Modal visible={!!selectedHofWinner} transparent animationType="fade" onRequestClose={() => setSelectedHofWinner(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{
            width: '100%',
            maxWidth: 380,
            backgroundColor: '#0F172A',
            borderRadius: 28,
            borderWidth: 2,
            borderColor: '#FFD700',
            padding: 20,
            alignItems: 'center',
            shadowColor: '#FFD700',
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 10
          }}>
            {/* Close Button */}
            <TouchableOpacity
              style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => setSelectedHofWinner(null)}
            >
              <Text style={{ fontSize: 16, color: '#FFF', fontWeight: '900' }}>✕</Text>
            </TouchableOpacity>

            {/* Crown & Tag */}
            <Text style={{ fontSize: 32, marginBottom: 4 }}>👑</Text>
            <View style={{ backgroundColor: 'rgba(255,215,0,0.15)', borderWidth: 1, borderColor: '#FFD700', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFD700', letterSpacing: 1.5 }}>HALL OF FAME CHAMPION</Text>
            </View>

            {/* Large High-Res Winning Image */}
            <View style={{ width: '100%', height: 220, borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: '#FFD700', marginBottom: 14, backgroundColor: '#000' }}>
              {selectedHofWinner?.winningSubmission?.imageUrl ? (
                <Image
                  source={{ uri: getImageUrl(selectedHofWinner.winningSubmission.imageUrl) }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 48 }}>🏆</Text>
                </View>
              )}
            </View>

            {/* Contest Title */}
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#FFF', textAlign: 'center', marginBottom: 4 }}>
              {selectedHofWinner?.event?.title || 'Campus Contest Champion'}
            </Text>

            {/* Winner Name */}
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFD700', textAlign: 'center', marginBottom: 6 }}>
              {selectedHofWinner?.winningSubmission?.user?.name || selectedHofWinner?.winner?.name || ''}
            </Text>

            {/* Victory Date & Votes */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 }}>
                <Text style={{ fontSize: 12, color: '#E2E8F0', fontWeight: '800' }}>
                  📅 {selectedHofWinner?.event?.endTime ? new Date(selectedHofWinner.event.endTime).toLocaleDateString('default', { month: 'short', year: 'numeric', day: 'numeric' }) : '—'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 }}>
                <Text style={{ fontSize: 12, color: '#F87171', fontWeight: '900' }}>
                  ❤️ {selectedHofWinner?.winningSubmission?.likeCount || 0} Votes
                </Text>
              </View>
            </View>

            {/* Prize (the coupon itself is issued privately to the winner) */}
            {selectedHofWinner?.event?.couponValue ? (
              <View style={{ width: '100%', backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 1.5, borderColor: '#10B981', borderRadius: 16, padding: 12, alignItems: 'center', marginBottom: 14 }}>
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#A7F3D0', letterSpacing: 1, marginBottom: 2 }}>CHAMPION'S PRIZE</Text>
                <Text style={{ fontSize: 16, fontWeight: '900', color: '#10B981', letterSpacing: 1 }}>
                  ₹{selectedHofWinner.event.couponValue} OFF COUPON
                </Text>
              </View>
            ) : null}

            {/* Action Buttons */}
            <View style={{ width: '100%', flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  paddingVertical: 12,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onPress={() => setSelectedHofWinner(null)}
              >
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#CBD5E1', letterSpacing: 0.5 }}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f1ea', paddingTop: Platform.OS === 'android' ? 40 : 50 },
  header: { paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(139,90,43,0.1)', paddingBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  backBtn: { paddingVertical: 6 },
  backText: { fontSize: 12, fontWeight: '900', color: '#8b5a2b', letterSpacing: 1.5 },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(16,185,129,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.emerald },
  onlineText: { fontSize: 12, fontWeight: '900', color: COLORS.emerald, letterSpacing: 1 },
  
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  titleIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3 },
  title: { fontSize: 20, fontWeight: '900', color: '#3e2723', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, fontWeight: '900', color: 'rgba(0,0,0,0.3)', letterSpacing: 2 },
  
  tabContainer: { flexDirection: 'row', backgroundColor: '#fff', padding: 3, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', marginBottom: 12 },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: '#3e2723' },
  tabLabel: { fontSize: 12, fontWeight: '900', color: '#888', letterSpacing: 1 },
  tabLabelActive: { color: '#fff' },
  
  searchBar: { height: 38, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', paddingHorizontal: 12, fontSize: 12, fontWeight: '600', color: '#3e2723', marginBottom: 6 },
  
  trendingSection: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(139,90,43,0.05)', backgroundColor: 'rgba(251,191,36,0.03)' },
  trendingTitle: { fontSize: 12, fontWeight: '900', color: '#8b5a2b', letterSpacing: 1.5, paddingHorizontal: 16, marginBottom: 8 },
  trendingScroll: { paddingHorizontal: 16 },
  trendingCard: { width: 200, backgroundColor: '#fff', borderRadius: 16, borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(0,0,0,0.05)', padding: 12, marginRight: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
  trendingUserRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  trendingAvatar: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#8b5a2b', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '900', color: '#fff' },
  trendingUser: { fontSize: 12, fontWeight: '800', color: '#3e2723', flex: 1 },
  trendingContent: { fontSize: 12, fontWeight: '600', color: '#666', lineHeight: 12, marginBottom: 6 },
  trendingStats: { flexDirection: 'row', gap: 8 },
  trendingStat: { fontSize: 12, fontWeight: '800', color: '#999' },

  stringLine: { height: 1.5, backgroundColor: 'rgba(139,90,43,0.15)', marginHorizontal: 16, marginTop: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 1 },
  
  emptyState: { padding: 48, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '900', color: '#8b5a2b', letterSpacing: 2, marginBottom: 4 },
  emptySubtitle: { fontSize: 12, fontWeight: '700', color: '#aaa', letterSpacing: 1 },
  retryBtn: { marginTop: 14, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  retryText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  wallSubmitFab: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    backgroundColor: '#FF8C00',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#FF8C00',
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 99
  },

  galleryGrid: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  galleryRow: { paddingHorizontal: 16, justifyContent: 'space-between' },
  polaroidWrapper: { width: (SW - 44) / 2, marginBottom: 24, alignItems: 'center', position: 'relative' },
  pegClip: { position: 'absolute', top: -8, width: 10, height: 20, backgroundColor: '#8b5a2b', borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#5c3a21', borderRadius: 2, zIndex: 10 },
  polaroidFrame: { width: '100%', backgroundColor: '#fdfcf0', padding: 8, paddingBottom: 12, borderRadius: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)' },
  polaroidImg: { width: '100%', aspectRatio: 1, borderRadius: 2, backgroundColor: '#111' },
  textPostBg: { width: '100%', aspectRatio: 1, borderRadius: 2, padding: 8, alignItems: 'center', justifyContent: 'center' },
  textPostContent: { fontSize: 12, fontWeight: '900', color: '#3e2723', textAlign: 'center', fontStyle: 'italic' },
  
  polaroidDetails: { marginTop: 8 },
  polaroidDesc: { fontSize: 12, fontWeight: '600', color: '#555', fontStyle: 'italic', marginBottom: 6 },
  
  reviewMeta: { marginBottom: 6, padding: 6, backgroundColor: 'rgba(139,90,43,0.04)', borderRadius: 8, borderWidth: 0.5, borderColor: 'rgba(139,90,43,0.08)' },
  reviewStars: { fontSize: 12, color: '#F59E0B', marginBottom: 2 },
  reviewRestaurant: { fontSize: 12, fontWeight: '900', color: '#8b5a2b' },
  reviewProduct: { fontSize: 12, fontWeight: '700', color: '#666', marginTop: 1 },

  polaroidUserRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.05)', paddingBottom: 6 },
  authorAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#38BDF8', alignItems: 'center', justifyContent: 'center' },
  authorAvatarText: { fontSize: 12, fontWeight: '900', color: '#fff' },
  authorName: { fontSize: 12, fontWeight: '900', color: '#222' },
  postTime: { fontSize: 12, fontWeight: '800', color: '#aaa' },
  expiryBadge: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.04)' },
  expiryText: { fontSize: 12, fontWeight: '800', color: '#777' },

  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  actionBtn: { paddingVertical: 2 },
  actionText: { fontSize: 12, fontWeight: '800', color: '#777' },
  
  repliesTrigger: { alignSelf: 'center', marginTop: 8, paddingVertical: 4 },
  repliesTriggerText: { fontSize: 12, fontWeight: '900', color: '#8b5a2b', letterSpacing: 0.5 },
  repliesBox: { marginTop: 6, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 6, gap: 4 },
  replyItem: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  replyUser: { fontSize: 12, fontWeight: '900', color: '#3e2723' },
  replyText: { fontSize: 12, fontWeight: '600', color: '#666' },

  composeFabWrap: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, zIndex: 100 },
  composeFab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', ...SHADOWS.goldGlow },
  
  composerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  composerContent: { backgroundColor: '#fdfcf0', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  dragHandle: { width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  replyBanner: { backgroundColor: 'rgba(139,90,43,0.05)', padding: 10, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(139,90,43,0.15)' },
  replyBannerText: { fontSize: 12, fontWeight: '900', color: '#8b5a2b' },
  replyBannerSub: { fontSize: 12, color: '#555' },
  composerTitle: { fontSize: 12, fontWeight: '900', color: '#3e2723', letterSpacing: 1.5, marginBottom: 12, textAlign: 'center' },
  composerInputName: { height: 38, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', paddingHorizontal: 12, fontSize: 12, fontWeight: '700', color: '#3e2723', marginBottom: 10 },
  reviewToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', marginBottom: 10 },
  reviewToggleLabel: { fontSize: 12, fontWeight: '900', color: '#3e2723' },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  toggleBtnActive: { backgroundColor: '#8b5a2b', borderColor: '#8b5a2b' },
  toggleBtnText: { fontSize: 12, fontWeight: '900', color: '#888' },
  reviewFields: { backgroundColor: 'rgba(139,90,43,0.04)', padding: 10, borderRadius: 12, marginBottom: 10, gap: 8, borderWidth: 1, borderColor: 'rgba(139,90,43,0.1)' },
  ratingStarsRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  starIcon: { fontSize: 22, color: 'rgba(0,0,0,0.1)' },
  reviewInputField: { height: 32, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, fontSize: 12, fontWeight: '600', color: '#3e2723', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  composerTextArea: { backgroundColor: '#fff', borderRadius: 12, padding: 12, fontSize: 12, fontWeight: '600', color: '#3e2723', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', height: 80, textAlignVertical: 'top', marginBottom: 10 },
  composerImgPreview: { width: 100, height: 100, borderRadius: 12, alignSelf: 'center', marginBottom: 12 },
  
  composerActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  composerCancel: { flex: 1, paddingVertical: 12, alignItems: 'center', marginRight: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.04)' },
  cancelText: { fontSize: 12, fontWeight: '900', color: '#666', letterSpacing: 1 },
  composerSubmit: { flex: 2, paddingVertical: 12, alignItems: 'center', borderRadius: 12, backgroundColor: '#8b5a2b' },
  submitText: { fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 1 },

  lightboxOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  lightboxImg: { width: SW - 20, height: SH * 0.7, borderRadius: 8 },

  // ── BIRTHDAY STYLING ──
  birthdaySection: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(139,90,43,0.05)' },
  birthdaySectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  birthdaySectionTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  adminBadgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  birthdayScroll: { minHeight: 90 },
  birthdayStoryCard: { alignItems: 'center', width: 66, gap: 4 },
  addBirthdayStoryCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.02)' },
  birthdayStoryCircle: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', borderWidth: 2, borderColor: '#FF69B4', alignItems: 'center', justifyContent: 'center' },
  birthdayStoryImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  birthdayStoryTextImg: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  birthdayStoryName: { fontSize: 12, fontWeight: '900', textAlign: 'center', width: '100%' },

  // Overlay
  bdayOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  bdayCardWrapper: { width: '100%', maxWidth: 360 },
  bdayCard: { width: '100%', borderRadius: 28, padding: 24, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10, position: 'relative' },
  bdayHeaderDecor: { marginBottom: 12 },
  bdayCloseBtn: { position: 'absolute', top: 16, right: 16, padding: 6, zIndex: 10 },
  bdayLargeAvatarRing: { width: 100, height: 100, borderRadius: 50, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  bdayLargeAvatarImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  bdayCandidateName: { fontSize: 18, fontWeight: '900', marginTop: 12, textAlign: 'center', letterSpacing: 0.5 },
  bdayWishCountText: { fontSize: 12, fontWeight: '900', marginTop: 4, letterSpacing: 0.5 },

  // Wishes List
  bdayWishesContainer: { width: '100%', height: 140, borderWidth: 1, borderRadius: 16, marginVertical: 16, padding: 12, backgroundColor: 'rgba(0,0,0,0.01)' },
  wishBubble: { padding: 10, borderRadius: 12, marginBottom: 8, gap: 2 },
  wishBubbleUser: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  wishBubbleText: { fontSize: 12, fontWeight: '600' },

  // Quick reactions
  quickReactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 12 },
  quickReactionBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(255,105,180,0.05)' },
  quickReactionText: { fontSize: 12, fontWeight: '900', color: '#FF69B4' },

  // Composer
  bdayComposeRow: { flexDirection: 'row', gap: 8, width: '100%', alignItems: 'center' },
  bdayWishInput: { flex: 1, height: 38, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 12, fontWeight: '700' },
  bdayWishSendBtn: { height: 38, paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  bdayWishSendText: { color: '#000', fontSize: 12, fontWeight: '900' },

  // Nomination
  modalTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 1.5, marginBottom: 4, textAlign: 'center' },
  modalSubtitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 16, textAlign: 'center', lineHeight: 12 },
  bdayPhotoSelector: { width: '100%', height: 120, borderStyle: 'dashed', borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 18, overflow: 'hidden' },
  bdayPhotoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  modalActionsRow: { flexDirection: 'row', gap: 10, width: '100%' },
  modalCancelBtn: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  modalSubmitBtn: { flex: 2, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalSubmitText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 1 },

  // Admin Queue
  adminQueueCard: { width: '100%', borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 10 },
  adminQueueRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  adminQueueImg: { width: 44, height: 44, borderRadius: 22, resizeMode: 'cover' },
  adminQueueTextImg: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center' },
  adminQueueName: { fontSize: 12, fontWeight: '900' },
  adminQueueDate: { fontSize: 12, fontWeight: '700' },
  adminQueueActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  adminRejectBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  adminApproveBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  
  // Friends Secure Uplink Card
  friendsCard: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
    elevation: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  friendsGradient: {
    ...StyleSheet.absoluteFill,
  },
  friendsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  friendsIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendsCardTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  friendsCardSub: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 1,
  },
  streakPulseContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  friendsCardBody: {
    fontSize: 12,
    lineHeight: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  friendsFooter: {
    alignSelf: 'flex-start',
  },
  friendsFooterText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },

  // ── THE WALL STYLING ──
  wallEventCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  mosaicTile: {
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  wallFabBtn: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: '#FFD700',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 999,
  },
  wallFabText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
  },
  hofCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
});
