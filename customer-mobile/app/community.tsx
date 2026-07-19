import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, Dimensions, Platform, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Animated, Easing } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, SHADOWS } from '../constants/theme';
import { ENDPOINTS, API_URL } from '../constants/api';
import { apiFetch } from '../utils/auth';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { StaggeredSection, FloatingPulse, BounceIn, PulseGlow } from '../components/AnimatedSection';
import DopaminePressable, { CardPressable, ActionPressable } from '../components/DopaminePressable';
import ZenvyAfterDarkLounge from '../components/ZenvyAfterDarkLounge';

const { width: SW, height: SH } = Dimensions.get('window');

const getImageUrl = (url: string | null) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

// ── Confetti Particle (Pure Native Drivers, Zero-Lag) ──
const ConfettiParticle = ({ delay }: { delay: number }) => {
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 3500 + Math.random() * 2500,
          delay: delay,
          useNativeDriver: true,
          easing: Easing.linear,
        })
      ])
    ).start();
  }, []);

  const translateY = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-60, SH + 60]
  });

  const translateX = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [
      Math.random() * SW,
      Math.random() * SW,
      Math.random() * SW
    ]
  });

  const rotate = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${Math.random() * 360}deg`]
  });

  const colors = ['#FF69B4', '#FFD700', '#FF4500', '#00FFFF', '#ADFF2F', '#FF00FF'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: 8 + Math.random() * 8,
        height: 8 + Math.random() * 8,
        backgroundColor: color,
        borderRadius: Math.random() > 0.5 ? 4 : 0,
        transform: [{ translateY }, { translateX }, { rotate }],
        opacity: 0.8,
        zIndex: 999
      }}
    />
  );
};

const ConfettiCannon = () => {
  const particles = Array.from({ length: 45 });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((_, i) => (
        <ConfettiParticle key={i} delay={i * 100} />
      ))}
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
  likedBy: string[];
  replyCount: number;
  createdAt: string;
  expiresAt?: string | null;
  replies?: PostType[];
  postType?: 'post' | 'review';
  starRating?: number;
  restaurantName?: string;
  productName?: string;
}

export default function CommunityScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDark } = useTheme();
  
  const txt = isDark ? '#FFF' : '#3e2723';
  const txtSec = isDark ? '#AAA' : '#666';
  const bg = isDark ? '#0A0A0C' : '#f4f1ea';
  const cardBg = isDark ? '#141416' : '#fdfcf0';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(139,90,43,0.1)';

  const [posts, setPosts] = useState<PostType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'reviews'>('all');
  const [search, setSearch] = useState('');
  const [onlineCount] = useState(Math.floor(Math.random() * 20) + 8);
  
  // Composer states
  const [showComposer, setShowComposer] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [customAuthorName, setCustomAuthorName] = useState(user?.name || '');
  const [isReviewDraft, setIsReviewDraft] = useState(false);
  const [starRating, setStarRating] = useState(5);
  const [restaurantName, setRestaurantName] = useState('');
  const [productName, setProductName] = useState('');
  
  const [replyingTo, setReplyingTo] = useState<PostType | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false, // Disabled crop engine to prevent Android intent crashes
      aspect: [1, 1],
      quality: 0.1, // Drastically reduced to prevent OOM kills on Android
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets[0].base64) {
      const b64 = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setDraftImage(b64);
    }
  };

  // ── BIRTHDAY CELEBRATIONS STATE ──
  interface BirthdayType {
    id: string;
    userId: string;
    candidateName: string;
    candidatePhotoUrl: string | null;
    birthdayDate: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    wishCount: number;
    approvedAt?: string;
    expiresAt?: string;
  }
  
  interface WishType {
    id: string;
    celebrationId: string;
    userId: string;
    userName: string;
    message: string;
    createdAt: string;
  }

  const [birthdays, setBirthdays] = useState<BirthdayType[]>([]);
  const [pendingBirthdays, setPendingBirthdays] = useState<BirthdayType[]>([]);
  const [selectedBirthday, setSelectedBirthday] = useState<BirthdayType | null>(null);
  const [selectedBirthdayWishes, setSelectedBirthdayWishes] = useState<WishType[]>([]);
  const [birthdayWishMessage, setBirthdayWishMessage] = useState('');
  
  // Modals
  const [showBirthdayWishModal, setShowBirthdayWishModal] = useState(false);
  const [showRegisterBirthdayModal, setShowRegisterBirthdayModal] = useState(false);
  const [showAdminPanelModal, setShowAdminPanelModal] = useState(false);
  const [submittingWish, setSubmittingWish] = useState(false);

  // New Birthday Nomination
  const [newBirthdayName, setNewBirthdayName] = useState('');
  const [newBirthdayDate, setNewBirthdayDate] = useState(new Date().toISOString().split('T')[0]);
  const [newBirthdayPhoto, setNewBirthdayPhoto] = useState<string | null>(null);
  const [submittingBirthday, setSubmittingBirthday] = useState(false);

  const fetchBirthdays = async () => {
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysActive);
      if (res.ok) {
        const data = await res.json();
        setBirthdays(data);
      }
      if (user?.role === 'admin') {
        const resPending = await apiFetch((ENDPOINTS as any).birthdaysPending);
        if (resPending.ok) {
          const dataPending = await resPending.json();
          setPendingBirthdays(dataPending);
        }
      }
    } catch (e) {
      console.error('[FETCH_BIRTHDAYS_ERROR]', e);
    }
  };

  const submitBirthday = async () => {
    if (!newBirthdayName.trim()) {
      Alert.alert('Validation Error', 'Please enter the birthday candidate\'s name.');
      return;
    }
    setSubmittingBirthday(true);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysSubmit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateName: newBirthdayName,
          birthdayDate: newBirthdayDate,
          candidatePhoto: newBirthdayPhoto
        })
      });

      if (res.ok) {
        Alert.alert('Nominated! 🎉', 'Nomination submitted to admin queue for approval.');
        setNewBirthdayName('');
        setNewBirthdayPhoto(null);
        setShowRegisterBirthdayModal(false);
        fetchBirthdays();
      } else {
        const err = await res.json();
        Alert.alert('Submission Failed', err.message || 'Something went wrong.');
      }
    } catch (e) {
      Alert.alert('Error', 'Network connection error.');
    } finally {
      setSubmittingBirthday(false);
    }
  };

  const pickBirthdayPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      aspect: [1, 1],
      quality: 0.1,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets[0].base64) {
      const b64 = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setNewBirthdayPhoto(b64);
    }
  };

  const approveBirthday = async (id: string) => {
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysApprove(id), { method: 'PUT' });
      if (res.ok) {
        Alert.alert('Approved! 🎂', 'Birthday is now live and a notification has been sent.');
        fetchBirthdays();
      } else {
        Alert.alert('Error', 'Failed to approve request.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const rejectBirthday = async (id: string) => {
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysReject(id), { method: 'PUT' });
      if (res.ok) {
        Alert.alert('Rejected', 'Nomination rejected successfully.');
        fetchBirthdays();
      } else {
        Alert.alert('Error', 'Failed to reject request.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openBirthdayDetail = async (birthday: BirthdayType) => {
    setSelectedBirthday(birthday);
    setBirthdayWishMessage('');
    setShowBirthdayWishModal(true);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysWishes(birthday.id));
      if (res.ok) {
        const data = await res.json();
        setSelectedBirthdayWishes(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const submitWish = async (presetText?: string) => {
    if (!selectedBirthday) return;
    const msg = presetText || birthdayWishMessage;
    if (!msg.trim()) return;

    setSubmittingWish(true);
    try {
      const res = await apiFetch((ENDPOINTS as any).birthdaysWish(selectedBirthday.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });

      if (res.ok) {
        const data = await res.json();
        setSelectedBirthday(prev => prev ? { ...prev, wishCount: data.wishCount } : null);
        setBirthdayWishMessage('');
        const wishesRes = await apiFetch((ENDPOINTS as any).birthdaysWishes(selectedBirthday.id));
        if (wishesRes.ok) {
          const wishesData = await wishesRes.json();
          setSelectedBirthdayWishes(wishesData);
        }
        fetchBirthdays();
        fetchPosts();
      } else {
        const err = await res.json();
        Alert.alert('Wish Failed', err.message || 'Failed to submit wish.');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error sending wish.');
    } finally {
      setSubmittingWish(false);
    }
  };

  useEffect(() => {
    fetchPosts();
    fetchBirthdays();
    const interval = setInterval(() => {
      fetchPosts();
      fetchBirthdays();
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTab]);

  const fetchPosts = async () => {
    try {
      const url = activeTab === 'reviews' ? ENDPOINTS.communityReviews : ENDPOINTS.communityPosts;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        // Filter out system errors or validation errors
        const ERROR_PATTERNS = [
          /^INVALID\s/i, /^PAYMENT\s/i, /^ERROR:/i, /^FAILED:/i,
          /^DB\s/i, /^SQL/i, /^SEQUELIZE/i, /SequelizeValidation/i,
          /^TypeError/i, /^ReferenceError/i, /^UnhandledPromise/i
        ];
        const clean = data.filter((p: any) => {
          if (!p.content) return true;
          return !ERROR_PATTERNS.some(rx => rx.test(p.content.trim()));
        });
        setPosts(clean);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const checkAuthAndRun = (action: () => void) => {
    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Sign in to your premium Zenvy account to post, reply, or like memories on the community wall.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/login' as any) }
        ]
      );
      return;
    }
    action();
  };

  const handlePost = async () => {
    if (!user) {
      Alert.alert('Authentication Required', 'Please sign in to post.');
      return;
    }
    if (!draft.trim() && !draftImage) return;
    setPosting(true);
    try {
      const body: Record<string, any> = { content: draft };
      if (draftImage) body.imageUrl = draftImage;
      if (replyingTo) body.parentId = replyingTo.id;
      if (customAuthorName) body.authorName = customAuthorName;
      
      if (isReviewDraft && !replyingTo) {
        body.postType = 'review';
        body.starRating = starRating.toString();
        body.restaurantName = restaurantName;
        body.productName = productName;
      }

      const res = await apiFetch(ENDPOINTS.communityPosts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (res.ok) {
        setDraft('');
        setDraftImage(null);
        setReplyingTo(null);
        setIsReviewDraft(false);
        setRestaurantName('');
        setProductName('');
        setShowComposer(false);
        fetchPosts();
      } else {
        const data = await res.json();
        Alert.alert('Post Failed', data.message || 'Something went wrong.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network error posting memory.');
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (id: string) => {
    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Sign in to your premium Zenvy account to post, reply, or like memories on the community wall.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/login' as any) }
        ]
      );
      return;
    }
    const userId = user ? (user.id || user._id || '') : '';
    if (!userId) return;
    
    // Optimistic update
    setPosts(prev => prev.map(p => {
      if (p.id === id) {
        const isLiked = p.likedBy.includes(userId);
        return {
          ...p,
          likes: isLiked ? Math.max(0, p.likes - 1) : p.likes + 1,
          likedBy: isLiked 
            ? p.likedBy.filter(u => u !== userId) 
            : [...p.likedBy, userId]
        };
      }
      return p;
    }));

    try {
      await apiFetch(ENDPOINTS.communityLike(id), { method: 'PUT' });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    Alert.alert('Delete Post', 'Are you sure you want to remove this memory?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(ENDPOINTS.communityDelete(id), { method: 'DELETE' });
            if (res.ok) {
              setPosts(prev => prev.filter(p => p.id !== id));
            }
          } catch (e) {
            console.error(e);
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

  const getTimeLeft = (expiresAt?: string | null) => {
    if (!expiresAt) return '48h';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'Expired';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h === 0) return `${m}m left`;
    return `${h}h left`;
  };

  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const filtered = posts.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.content || '').toLowerCase().includes(q) || (p.userName || '').toLowerCase().includes(q);
  });

  const trending = [...posts]
    .sort((a, b) => (b.likes + b.replyCount * 2) - (a.likes + a.replyCount * 2))
    .slice(0, 3);

  const getBgHash = (id: string) => {
    const colors = [
      ['#FBBF24', '#F59E0B'], // amber-400 to orange-500
      ['#38BDF8', '#6366F1'], // sky-400 to indigo-500
      ['#34D399', '#0D9488'], // emerald-400 to teal-500
      ['#FB7185', '#EC4899'], // rose-400 to pink-500
    ];
    const code = id.charCodeAt(id.length - 1) || 0;
    return colors[code % colors.length];
  };

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* ── HEADER ── */}
      <View style={[s.header, { borderBottomColor: border }]}>
        <View style={s.headerRow}>
          <TouchableOpacity 
            style={s.backBtn} 
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              }
              // Force back to home just in case
              router.push('/' as any);
            }}
          >
            <Text style={[s.backText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>◀ HOME</Text>
          </TouchableOpacity>
          <View style={s.onlineBadge}>
            <View style={s.onlineDot} />
            <Text style={s.onlineText}>{onlineCount} LIVE</Text>
          </View>
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
            style={[s.tabBtn, activeTab === 'reviews' && [s.tabBtnActive, { backgroundColor: isDark ? COLORS.gold : '#3e2723' }], { flex: 1 }]} 
            onPress={() => setActiveTab('reviews')}
            sound="tabSwitch"
            activeScale={0.96}
          >
            <Text style={[s.tabLabel, activeTab === 'reviews' && [s.tabLabelActive, { color: isDark ? '#000' : '#fff' }], { paddingVertical: 8 }]}>FOOD REVIEWS</Text>
          </DopaminePressable>
        </View>

        {/* Search */}
        <TextInput 
          style={[s.searchBar, { backgroundColor: cardBg, borderColor: border, color: txt }]} 
          placeholder="Search stories..." 
          placeholderTextColor="#888" 
          value={search} 
          onChangeText={setSearch} 
        />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* 🌙 ZENVY AFTER DARK */}
        <ZenvyAfterDarkLounge />

        {/* ── BIRTHDAY CELEBRATIONS STORY ROW ── */}
        <View style={s.birthdaySection}>
          <View style={s.birthdaySectionHeader}>
            <Text style={[s.birthdaySectionTitle, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>🎂 TODAY'S CELEBRATIONS</Text>
            {user?.role === 'admin' && pendingBirthdays.length > 0 && (
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

            {/* Birthday Stories */}
            {birthdays.map(b => (
              <TouchableOpacity 
                key={b.id} 
                style={s.birthdayStoryCard} 
                onPress={() => openBirthdayDetail(b)}
              >
                <PulseGlow size={66} color="#FF69B4">
                  <View style={s.birthdayStoryCircle}>
                    {b.candidatePhotoUrl ? (
                      <Image source={{ uri: getImageUrl(b.candidatePhotoUrl) }} style={s.birthdayStoryImg} />
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
        {!search && trending.length > 0 && posts.length > 3 && (
          <View style={s.trendingSection}>
            <Text style={[s.trendingTitle, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>🔥 TRENDING NOW</Text>
            <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={s.trendingScroll}>
              {trending.map(tp => (
                <View key={tp.id} style={[s.trendingCard, { backgroundColor: cardBg, borderColor: border }]}>
                  <View style={s.trendingUserRow}>
                    <View style={s.trendingAvatar}><Text style={s.avatarText}>{(tp.userName||'A').charAt(0)}</Text></View>
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

        {/* Hanging Rope String Indicator */}
        <View style={[s.stringLine, { backgroundColor: isDark ? 'rgba(212,175,122,0.3)' : 'rgba(139,90,43,0.15)' }]} />

        {/* ── POLAROID GALLERY ── */}
        {loading ? (
          <ActivityIndicator size="large" color={isDark ? COLORS.gold : '#8b5a2b'} style={{ marginVertical: 48 }} />
        ) : filtered.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>🖼️</Text>
            <Text style={[s.emptyTitle, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>BLANK CANVAS</Text>
            <Text style={[s.emptySubtitle, { color: txtSec }]}>Hang the first photo on the wall.</Text>
          </View>
        ) : (
          <View style={s.galleryGrid}>
            {filtered.map((post, idx) => {
              const bgGrad = getBgHash(post.id);
              const userId = user ? (user.id || user._id || '') : '';
              const isLiked = userId ? post.likedBy.includes(userId) : false;
              const rotation = (idx % 2 === 0 ? '-1.5deg' : '1.5deg');

              return (
                <StaggeredSection 
                  key={post.id} 
                  delay={50 + (idx % 6) * 50} 
                  direction="up"
                  style={[s.polaroidWrapper, { transform: [{ rotate: rotation }] }]}
                >
                  {/* Peg Wooden Clip */}
                  <View style={s.pegClip} />

                  {/* Polaroid Frame */}
                  <CardPressable 
                    style={[s.polaroidFrame, { backgroundColor: cardBg, borderColor: border }]} 
                    onPress={() => post.imageUrl ? setSelectedImage(post.imageUrl) : null} 
                    tilt={false} // Disabled 3D tilt to eliminate JS thread lag
                  >
                    {post.imageUrl ? (
                      <Image source={{ uri: post.imageUrl }} style={s.polaroidImg} />
                    ) : (
                      <View style={[s.textPostBg, { backgroundColor: bgGrad[0] }]}>
                        <Text style={s.textPostContent} numberOfLines={8}>{post.content}</Text>
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
                          <Text style={s.reviewStars}>{'★'.repeat(post.starRating || 5)}</Text>
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
                          <Text style={[s.authorName, { color: txt }]} numberOfLines={1}>{post.userName.toUpperCase()}</Text>
                          <Text style={s.postTime}>{formatTime(post.createdAt)}</Text>
                        </View>
                        <View style={s.expiryBadge}>
                          <Text style={s.expiryText}>{getTimeLeft(post.expiresAt)}</Text>
                        </View>
                      </View>

                      {/* Actions */}
                      <View style={s.actionsRow}>
                        <DopaminePressable style={s.actionBtn} onPress={() => handleLike(post.id)} sound="click" activeScale={0.88}>
                          <Text style={[s.actionText, isLiked && { color: COLORS.red }]}>
                            {isLiked ? '❤️' : '🤍'} {post.likes}
                          </Text>
                        </DopaminePressable>

                        <DopaminePressable style={s.actionBtn} onPress={() => {
                          checkAuthAndRun(() => {
                            setReplyingTo(post);
                            setShowComposer(true);
                          });
                        }} sound="click" activeScale={0.88}>
                          <Text style={s.actionText}>💬 {post.replyCount}</Text>
                        </DopaminePressable>

                        {user && post.userId === (user.id || user._id || '') ? (
                          <DopaminePressable style={s.actionBtn} onPress={() => handleDelete(post.id)} sound="click" activeScale={0.88}>
                            <Text style={[s.actionText, { color: COLORS.red }]}>🗑️</Text>
                          </DopaminePressable>
                        ) : null}
                      </View>

                      {/* Replies */}
                      {post.replies && post.replies.length > 0 ? (
                        <TouchableOpacity 
                          style={s.repliesTrigger} 
                          onPress={() => toggleThread(post.id)}
                        >
                          <Text style={[s.repliesTriggerText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>
                            {expandedThreads.has(post.id) ? 'HIDE REPLIES ▲' : `SHOW REPLIES (${post.replies.length}) ▼`}
                          </Text>
                        </TouchableOpacity>
                      ) : null}

                      {expandedThreads.has(post.id) && post.replies && (
                        <View style={[s.repliesBox, { borderTopColor: border }]}>
                          {post.replies.map(r => (
                            <View key={r.id} style={s.replyItem}>
                              <Text style={[s.replyUser, { color: txt }]}>{r.userName.toUpperCase()}:</Text>
                              <Text style={[s.replyText, { color: txtSec }]}>{r.content}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                    </View>
                  </CardPressable>
                </StaggeredSection>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Floating Compose Button */}
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
      <Modal visible={showComposer} animationType="slide" transparent={true}>
        <KeyboardAvoidingView 
          style={{ flex: 1 }} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setShowComposer(false); }}>
            <View style={s.composerOverlay}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={[s.composerContent, { backgroundColor: cardBg, maxHeight: '85%' }]}>
                  <View style={s.dragHandle} />

                  <ScrollView 
                    showsVerticalScrollIndicator={false} 
                    keyboardShouldPersistTaps="handled"
                    bounces={false}
                  >
                    {replyingTo && (
                      <View style={[s.replyBanner, { backgroundColor: isDark ? '#1C1B1F' : 'rgba(139,90,43,0.05)', borderColor: border }]}>
                        <Text style={[s.replyBannerText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>REPLYING TO {replyingTo.userName.toUpperCase()}</Text>
                        <Text style={[s.replyBannerSub, { color: txtSec }]} numberOfLines={1}>{replyingTo.content}</Text>
                      </View>
                    )}

                    <Text style={[s.composerTitle, { color: txt }]}>{replyingTo ? 'REPLY TO THREAD' : 'PIN NEW MEMORY'}</Text>
                    
                    <TextInput 
                      style={[s.composerInputName, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border, color: txt }]} 
                      placeholder="Display Name..." 
                      placeholderTextColor="#888" 
                      value={customAuthorName} 
                      onChangeText={setCustomAuthorName} 
                    />

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
                        <TextInput style={[s.reviewInputField, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border, color: txt }]} placeholder="Restaurant Name" placeholderTextColor="#999" value={restaurantName} onChangeText={setRestaurantName} />
                        <TextInput style={[s.reviewInputField, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border, color: txt }]} placeholder="Dish Name" placeholderTextColor="#999" value={productName} onChangeText={setProductName} />
                      </View>
                    )}

                    <TextInput 
                      style={[s.composerTextArea, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border, color: txt }]} 
                      placeholder={replyingTo ? 'Write a reply...' : 'Write something beautiful...'} 
                      placeholderTextColor="#888" 
                      multiline 
                      numberOfLines={4} 
                      value={draft} 
                      onChangeText={setDraft} 
                    />

                    <TouchableOpacity 
                      style={[s.composerInputName, { backgroundColor: isDark ? '#222' : '#fff', borderColor: border, justifyContent: 'center', alignItems: 'center' }]} 
                      onPress={pickImage}
                    >
                      <Text style={{ color: txt, fontSize: 11, fontWeight: '700' }}>
                        {draftImage ? '🖼️ Image Selected (Tap to change)' : '📸 Upload Photo from Gallery'}
                      </Text>
                    </TouchableOpacity>

                    {draftImage ? (
                      <Image source={{ uri: draftImage }} style={s.composerImgPreview} />
                    ) : null}

                    <View style={s.composerActions}>
                      <DopaminePressable style={[s.composerCancel, { flex: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }]} onPress={() => setShowComposer(false)} sound="click">
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
      <Modal visible={!!selectedImage} transparent={true} animationType="fade">
        <TouchableOpacity 
          style={s.lightboxOverlay} 
          activeOpacity={1} 
          onPress={() => setSelectedImage(null)}
        >
          {selectedImage && (
            <Image source={{ uri: selectedImage }} style={s.lightboxImg} />
          )}
        </TouchableOpacity>
      </Modal>

      {/* ── BIRTHDAY WISHING MODAL ── */}
      <Modal visible={showBirthdayWishModal} transparent={true} animationType="slide">
        <View style={s.bdayOverlay}>
          {/* Confetti cannon! */}
          <ConfettiCannon />

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
                        {selectedBirthday.candidatePhotoUrl ? (
                          <Image source={{ uri: getImageUrl(selectedBirthday.candidatePhotoUrl) }} style={s.bdayLargeAvatarImg} />
                        ) : (
                          <Text style={{ fontSize: 44 }}>🎂</Text>
                        )}
                      </View>
                    </PulseGlow>

                    {/* Name and count */}
                    <Text style={[s.bdayCandidateName, { color: txt }]}>{selectedBirthday.candidateName}</Text>
                    <Text style={[s.bdayWishCountText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>
                      ❤️ {selectedBirthday.wishCount || 0} peer wishes received today!
                    </Text>

                    {/* Wishes Scroll View */}
                    <View style={[s.bdayWishesContainer, { borderColor: border }]}>
                      <ScrollView 
                        showsVerticalScrollIndicator={false}
                        nestedScrollEnabled
                        style={{ flex: 1 }}
                      >
                        {selectedBirthdayWishes.length === 0 ? (
                          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                            <Text style={{ color: txtSec, fontSize: 10, fontWeight: '700' }}>No wishes yet. Be the first! 👇</Text>
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
                          style={[s.quickReactionBadge, { borderColor: border }]}
                          onPress={() => submitWish(react)}
                        >
                          <Text style={s.quickReactionText}>{react}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* Custom wish composer */}
                    <View style={s.bdayComposeRow}>
                      <TextInput 
                        style={[s.bdayWishInput, { backgroundColor: isDark ? '#222' : '#fff', color: txt, borderColor: border }]}
                        placeholder="Write a custom blessing..."
                        placeholderTextColor="#888"
                        value={birthdayWishMessage}
                        onChangeText={setBirthdayWishMessage}
                      />
                      <TouchableOpacity 
                        style={[s.bdayWishSendBtn, { backgroundColor: isDark ? COLORS.gold : '#FF69B4' }]}
                        onPress={() => submitWish()}
                        disabled={submittingWish}
                      >
                        {submittingWish ? (
                          <ActivityIndicator size="small" color="#000" />
                        ) : (
                          <Text style={s.bdayWishSendText}>SEND</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── REGISTER / NOMINATE BIRTHDAY MODAL ── */}
      <Modal visible={showRegisterBirthdayModal} transparent={true} animationType="slide">
        <View style={s.bdayOverlay}>
          <TouchableWithoutFeedback onPress={() => setShowRegisterBirthdayModal(false)}>
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
                <Text style={[s.modalSubtitle, { color: txtSec }]}>Nominate a classmate. Approved birthdays appear on the community feed for 24h.</Text>

                {/* Form Input fields */}
                <TextInput 
                  style={[s.bdayWishInput, { backgroundColor: isDark ? '#222' : '#fff', color: txt, borderColor: border, width: '100%', marginBottom: 12 }]}
                  placeholder="Candidate Full Name"
                  placeholderTextColor="#888"
                  value={newBirthdayName}
                  onChangeText={setNewBirthdayName}
                />

                <TextInput 
                  style={[s.bdayWishInput, { backgroundColor: isDark ? '#222' : '#fff', color: txt, borderColor: border, width: '100%', marginBottom: 12 }]}
                  placeholder="Birthday Date (YYYY-MM-DD)"
                  placeholderTextColor="#888"
                  value={newBirthdayDate}
                  onChangeText={setNewBirthdayDate}
                />

                {/* Photo selector */}
                <TouchableOpacity 
                  style={[s.bdayPhotoSelector, { borderColor: border }]}
                  onPress={pickBirthdayPhoto}
                >
                  {newBirthdayPhoto ? (
                    <Image source={{ uri: newBirthdayPhoto }} style={s.bdayPhotoPreview} />
                  ) : (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontSize: 24, marginBottom: 4 }}>📸</Text>
                      <Text style={{ color: txtSec, fontSize: 9, fontWeight: '700' }}>ADD PEER PORTRAIT</Text>
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
      <Modal visible={showAdminPanelModal} transparent={true} animationType="slide">
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
                  <Text style={{ color: txtSec, fontSize: 11, fontWeight: '700' }}>No pending nominations in queue. 🌟</Text>
                </View>
              ) : (
                pendingBirthdays.map((p) => (
                  <View key={p.id} style={[s.adminQueueCard, { borderColor: border, backgroundColor: isDark ? '#1C1B1F' : '#fcfcfc' }]}>
                    <View style={s.adminQueueRow}>
                      {p.candidatePhotoUrl ? (
                        <Image source={{ uri: getImageUrl(p.candidatePhotoUrl) }} style={s.adminQueueImg} />
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
                        <Text style={{ color: COLORS.red, fontSize: 10, fontWeight: '900' }}>REJECT ❌</Text>
                      </TouchableOpacity>

                      <TouchableOpacity 
                        style={[s.adminApproveBtn, { backgroundColor: COLORS.emerald + '22' }]} 
                        onPress={() => approveBirthday(p.id)}
                      >
                        <Text style={{ color: COLORS.emerald, fontSize: 10, fontWeight: '900' }}>APPROVE ✅</Text>
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

    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f1ea', paddingTop: Platform.OS === 'android' ? 40 : 50 },
  header: { paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(139,90,43,0.1)', paddingBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  backBtn: { paddingVertical: 6 },
  backText: { fontSize: 10, fontWeight: '900', color: '#8b5a2b', letterSpacing: 1.5 },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(16,185,129,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.emerald },
  onlineText: { fontSize: 8, fontWeight: '900', color: COLORS.emerald, letterSpacing: 1 },
  
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  titleIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3 },
  title: { fontSize: 20, fontWeight: '900', color: '#3e2723', letterSpacing: -0.5 },
  subtitle: { fontSize: 7, fontWeight: '900', color: 'rgba(0,0,0,0.3)', letterSpacing: 2 },
  
  tabContainer: { flexDirection: 'row', backgroundColor: '#fff', padding: 3, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', marginBottom: 12 },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: '#3e2723' },
  tabLabel: { fontSize: 8, fontWeight: '900', color: '#888', letterSpacing: 1 },
  tabLabelActive: { color: '#fff' },
  
  searchBar: { height: 38, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', paddingHorizontal: 12, fontSize: 11, fontWeight: '600', color: '#3e2723', marginBottom: 6 },
  
  trendingSection: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(139,90,43,0.05)', backgroundColor: 'rgba(251,191,36,0.03)' },
  trendingTitle: { fontSize: 8, fontWeight: '900', color: '#8b5a2b', letterSpacing: 1.5, paddingHorizontal: 16, marginBottom: 8 },
  trendingScroll: { paddingHorizontal: 16 },
  trendingCard: { width: 200, backgroundColor: '#fff', borderRadius: 16, borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(0,0,0,0.05)', padding: 12, marginRight: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
  trendingUserRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  trendingAvatar: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#8b5a2b', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 8, fontWeight: '900', color: '#fff' },
  trendingUser: { fontSize: 8, fontWeight: '800', color: '#3e2723', flex: 1 },
  trendingContent: { fontSize: 9, fontWeight: '600', color: '#666', lineHeight: 12, marginBottom: 6 },
  trendingStats: { flexDirection: 'row', gap: 8 },
  trendingStat: { fontSize: 8, fontWeight: '800', color: '#999' },

  stringLine: { height: 1.5, backgroundColor: 'rgba(139,90,43,0.15)', marginHorizontal: 16, marginTop: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 1 },
  
  emptyState: { padding: 48, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '900', color: '#8b5a2b', letterSpacing: 2, marginBottom: 4 },
  emptySubtitle: { fontSize: 9, fontWeight: '700', color: '#aaa', letterSpacing: 1 },

  galleryGrid: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  polaroidWrapper: { width: (SW - 44) / 2, marginBottom: 24, alignItems: 'center', position: 'relative' },
  pegClip: { position: 'absolute', top: -8, width: 10, height: 20, backgroundColor: '#8b5a2b', borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#5c3a21', borderRadius: 2, zIndex: 10 },
  polaroidFrame: { width: '100%', backgroundColor: '#fdfcf0', padding: 8, paddingBottom: 12, borderRadius: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)' },
  polaroidImg: { width: '100%', aspectRatio: 1, borderRadius: 2, backgroundColor: '#111' },
  textPostBg: { width: '100%', aspectRatio: 1, borderRadius: 2, padding: 8, alignItems: 'center', justifyContent: 'center' },
  textPostContent: { fontSize: 12, fontWeight: '900', color: '#3e2723', textAlign: 'center', fontStyle: 'italic' },
  
  polaroidDetails: { marginTop: 8 },
  polaroidDesc: { fontSize: 9, fontWeight: '600', color: '#555', fontStyle: 'italic', marginBottom: 6 },
  
  reviewMeta: { marginBottom: 6, padding: 6, backgroundColor: 'rgba(139,90,43,0.04)', borderRadius: 8, borderWidth: 0.5, borderColor: 'rgba(139,90,43,0.08)' },
  reviewStars: { fontSize: 8, color: '#F59E0B', marginBottom: 2 },
  reviewRestaurant: { fontSize: 7, fontWeight: '900', color: '#8b5a2b' },
  reviewProduct: { fontSize: 7, fontWeight: '700', color: '#666', marginTop: 1 },

  polaroidUserRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.05)', paddingBottom: 6 },
  authorAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#38BDF8', alignItems: 'center', justifyContent: 'center' },
  authorAvatarText: { fontSize: 8, fontWeight: '900', color: '#fff' },
  authorName: { fontSize: 8, fontWeight: '900', color: '#222' },
  postTime: { fontSize: 6, fontWeight: '800', color: '#aaa' },
  expiryBadge: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.04)' },
  expiryText: { fontSize: 6, fontWeight: '800', color: '#777' },

  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  actionBtn: { paddingVertical: 2 },
  actionText: { fontSize: 8, fontWeight: '800', color: '#777' },
  
  repliesTrigger: { alignSelf: 'center', marginTop: 8, paddingVertical: 4 },
  repliesTriggerText: { fontSize: 7, fontWeight: '900', color: '#8b5a2b', letterSpacing: 0.5 },
  repliesBox: { marginTop: 6, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 6, gap: 4 },
  replyItem: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  replyUser: { fontSize: 7, fontWeight: '900', color: '#3e2723' },
  replyText: { fontSize: 7, fontWeight: '600', color: '#666' },

  composeFabWrap: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, zIndex: 100 },
  composeFab: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', ...SHADOWS.goldGlow },
  
  composerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  composerContent: { backgroundColor: '#fdfcf0', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  dragHandle: { width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  replyBanner: { backgroundColor: 'rgba(139,90,43,0.05)', padding: 10, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(139,90,43,0.15)' },
  replyBannerText: { fontSize: 8, fontWeight: '900', color: '#8b5a2b' },
  replyBannerSub: { fontSize: 10, color: '#555' },
  composerTitle: { fontSize: 12, fontWeight: '900', color: '#3e2723', letterSpacing: 1.5, marginBottom: 12, textAlign: 'center' },
  composerInputName: { height: 38, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', paddingHorizontal: 12, fontSize: 11, fontWeight: '700', color: '#3e2723', marginBottom: 10 },
  reviewToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', marginBottom: 10 },
  reviewToggleLabel: { fontSize: 9, fontWeight: '900', color: '#3e2723' },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  toggleBtnActive: { backgroundColor: '#8b5a2b', borderColor: '#8b5a2b' },
  toggleBtnText: { fontSize: 8, fontWeight: '900', color: '#888' },
  reviewFields: { backgroundColor: 'rgba(139,90,43,0.04)', padding: 10, borderRadius: 12, marginBottom: 10, gap: 8, borderWidth: 1, borderColor: 'rgba(139,90,43,0.1)' },
  ratingStarsRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  starIcon: { fontSize: 22, color: 'rgba(0,0,0,0.1)' },
  reviewInputField: { height: 32, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, fontSize: 10, fontWeight: '600', color: '#3e2723', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  composerTextArea: { backgroundColor: '#fff', borderRadius: 12, padding: 12, fontSize: 11, fontWeight: '600', color: '#3e2723', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', height: 80, textAlignVertical: 'top', marginBottom: 10 },
  composerImgPreview: { width: 100, height: 100, borderRadius: 12, alignSelf: 'center', marginBottom: 12 },
  
  composerActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  composerCancel: { flex: 1, paddingVertical: 12, alignItems: 'center', marginRight: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.04)' },
  cancelText: { fontSize: 10, fontWeight: '900', color: '#666', letterSpacing: 1 },
  composerSubmit: { flex: 2, paddingVertical: 12, alignItems: 'center', borderRadius: 12, backgroundColor: '#8b5a2b' },
  submitText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 1 },

  lightboxOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  lightboxImg: { width: SW - 20, height: SW - 20, resizeMode: 'contain', borderRadius: 8 },

  // ── BIRTHDAY STYLING ──
  birthdaySection: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(139,90,43,0.05)' },
  birthdaySectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  birthdaySectionTitle: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
  adminBadgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  birthdayScroll: { minHeight: 90 },
  birthdayStoryCard: { alignItems: 'center', width: 66, gap: 4 },
  addBirthdayStoryCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.02)' },
  birthdayStoryCircle: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', borderWidth: 2, borderColor: '#FF69B4', alignItems: 'center', justifyContent: 'center' },
  birthdayStoryImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  birthdayStoryTextImg: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  birthdayStoryName: { fontSize: 8, fontWeight: '900', textAlign: 'center', width: '100%' },

  // Overlay
  bdayOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  bdayCardWrapper: { width: '100%', maxWidth: 360 },
  bdayCard: { width: '100%', borderRadius: 28, padding: 24, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10, position: 'relative' },
  bdayHeaderDecor: { marginBottom: 12 },
  bdayCloseBtn: { position: 'absolute', top: 16, right: 16, padding: 6, zIndex: 10 },
  bdayLargeAvatarRing: { width: 100, height: 100, borderRadius: 50, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  bdayLargeAvatarImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  bdayCandidateName: { fontSize: 18, fontWeight: '900', marginTop: 12, textAlign: 'center', letterSpacing: 0.5 },
  bdayWishCountText: { fontSize: 10, fontWeight: '900', marginTop: 4, letterSpacing: 0.5 },

  // Wishes List
  bdayWishesContainer: { width: '100%', height: 140, borderWidth: 1, borderRadius: 16, marginVertical: 16, padding: 12, backgroundColor: 'rgba(0,0,0,0.01)' },
  wishBubble: { padding: 10, borderRadius: 12, marginBottom: 8, gap: 2 },
  wishBubbleUser: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  wishBubbleText: { fontSize: 9, fontWeight: '600' },

  // Quick reactions
  quickReactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 12 },
  quickReactionBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(255,105,180,0.05)' },
  quickReactionText: { fontSize: 8, fontWeight: '900', color: '#FF69B4' },

  // Composer
  bdayComposeRow: { flexDirection: 'row', gap: 8, width: '100%', alignItems: 'center' },
  bdayWishInput: { flex: 1, height: 38, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 11, fontWeight: '700' },
  bdayWishSendBtn: { height: 38, paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  bdayWishSendText: { color: '#000', fontSize: 10, fontWeight: '900' },

  // Nomination
  modalTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 1.5, marginBottom: 4, textAlign: 'center' },
  modalSubtitle: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginBottom: 16, textAlign: 'center', lineHeight: 12 },
  bdayPhotoSelector: { width: '100%', height: 120, borderStyle: 'dashed', borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 18, overflow: 'hidden' },
  bdayPhotoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  modalActionsRow: { flexDirection: 'row', gap: 10, width: '100%' },
  modalCancelBtn: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  modalSubmitBtn: { flex: 2, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalSubmitText: { color: '#000', fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  // Admin Queue
  adminQueueCard: { width: '100%', borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 10 },
  adminQueueRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  adminQueueImg: { width: 44, height: 44, borderRadius: 22, resizeMode: 'cover' },
  adminQueueTextImg: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center' },
  adminQueueName: { fontSize: 12, fontWeight: '900' },
  adminQueueDate: { fontSize: 9, fontWeight: '700' },
  adminQueueActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  adminRejectBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  adminApproveBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
});
