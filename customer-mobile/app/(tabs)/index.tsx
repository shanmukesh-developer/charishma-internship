import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl, Image, FlatList, Dimensions, Platform, Modal, ActivityIndicator, Alert, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS, RADIUS } from '../../constants/theme';
import { API_URL, ENDPOINTS } from '../../constants/api';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useTheme } from '../../context/ThemeContext';
import { apiFetch } from '../../utils/auth';
import NexusExplorer from '../../components/NexusExplorer';
import SearchOverlay from '../../components/SearchOverlay';
import PromoCarousel from '../../components/PromoCarousel';
import CampusBitesSection from '../../components/CampusBitesSection';
import RecentlyViewed from '../../components/RecentlyViewed';
import { useWorldTransition } from '../../context/WorldTransitionContext';
import AmbientBackground from '../../components/AmbientBackground';
import DopaminePressable, { CardPressable, ActionPressable } from '../../components/DopaminePressable';
import { StaggeredSection, RestaurantCardSkeleton, PulseGlow, BounceIn, FloatingPulse } from '../../components/AnimatedSection';
import ServerWakeupOverlay from '../../components/ServerWakeupOverlay';

const VaultTimerBadge = ({ pulseAnim }: { pulseAnim: any }) => {
  const [vaultTimer, setVaultTimer] = useState('00:00:00');
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const d = end.getTime() - now.getTime();
      if (d < 0) return;
      const h = Math.floor(d / 3600000);
      const m = Math.floor((d % 3600000) / 60000);
      const s = Math.floor((d % 60000) / 1000);
      setVaultTimer(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  
  return (
    <View style={StyleSheet.create({ vaultTimerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 } }).vaultTimerWrap}>
      <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', shadowColor: '#10B981', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8 }, { opacity: pulseAnim }]} />
      <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] }}>{vaultTimer}</Text>
    </View>
  );
};

const { width: SW } = Dimensions.get('window');
const CARD_W = (SW - 48) / 2;

const FILTERS = [
  { key: 'all', label: '✨ ALL' },
  { key: 'veg', label: '🥗 VEG' },
  { key: 'premium', label: '👑 PREMIUM' },
  { key: 'budget', label: '💰 BUDGET' },
  { key: 'jain', label: '🙏 JAIN' },
  { key: 'eggless', label: '🥚 EGGLESS' },
];

const CLASSICS = [
  { name: 'Biryani', img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=200' },
  { name: 'Pizza', img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=200' },
  { name: 'Burgers', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=200' },
  { name: 'South Indian', img: 'https://images.unsplash.com/photo-1541832676-9b763b0239ab?q=80&w=200' },
  { name: 'Drinks', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=200' },
  { name: 'Chinese', img: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?q=80&w=200' },
];

const PROMOS = [
  { id: 'kfc', tagline: 'KFC TAKEOVER LIVE', title: 'CRISPY JUICY', subtitle: 'CRUNCHY BUCKET', desc: 'Premium takeover is now live. Tap to order.', btn: 'ORDER KFC', img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=600' },
  { id: 'ride', tagline: 'ZENVY CO-RIDE', title: 'SPLIT THE', subtitle: 'RIDE', desc: 'Connect with campus peers for instant bike pooling.', btn: 'FIND A RIDE', img: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=600' },
  { id: 'stays', tagline: 'PREMIUM STAYS', title: 'YOUR NEXT', subtitle: 'CAMPUS HOME', desc: 'Discover verified hostels and PG accommodations.', btn: 'EXPLORE HOSTELS', img: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?q=80&w=600' },
  { id: 'elite', tagline: 'NEXUS OFFERS', title: 'UNLIMITED', subtitle: 'FREE DELIVERY', desc: 'Join Zenvy Elite today. Zero delivery charges.', btn: 'CLAIM ELITE', img: 'https://images.unsplash.com/photo-1618331835717-801e976710b2?q=80&w=600' },
];

const CATEGORIES = [
  { key: 'food', label: 'Food', emoji: '🍔' },
  { key: 'basket', label: 'Basket', emoji: '🧺' },
  { key: 'hostels', label: 'Hostels', emoji: '🏨' },
  { key: 'coride', label: 'Co-Ride', emoji: '🏍️' },
];

const CATEGORY_IMAGES = {
  food: { uri: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&q=80' },
  basket: { uri: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&q=80' },
  hostels: { uri: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=200&q=80' },
  coride: { uri: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=200&q=80' },
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { totalItems } = useCart();
  const { isDark, toggleTheme } = useTheme();
  const { triggerTransition } = useWorldTransition();
  const scrollRef = useRef<ScrollView>(null);
  const nexusY = useRef(0);
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [classicFilter, setClassicFilter] = useState('Biryani');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [classics, setClassics] = useState<any[]>(CLASSICS);
  const [promos, setPromos] = useState<any[]>(PROMOS);
  const [showWakeup, setShowWakeup] = useState(false);

  // Search Overlay State
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Vault and Block challenges Modal States
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [loadingVault, setLoadingVault] = useState(false);
  const [claimingItemId, setClaimingItemId] = useState<string | null>(null);

  const [showBlockModal, setShowBlockModal] = useState(false);
  const [activeChallenge, setActiveChallenge] = useState<any>(null);
  const [blockLeaderboard, setBlockLeaderboard] = useState<any[]>([]);
  const [loadingBlock, setLoadingBlock] = useState(false);

  // Zomato-range luxury animations
  const classicAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // Favorites state and logic
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1200,
          useNativeDriver: false,
        })
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (classicFilter !== '') {
      classicAnim.setValue(0);
      Animated.spring(classicAnim, {
        toValue: 1,
        tension: 60,
        friction: 8,
        useNativeDriver: false,
      }).start();
    }
  }, [classicFilter]);

  useEffect(() => {
    (async () => {
      try {
        const favs = await AsyncStorage.getItem('zenvy_favorites');
        if (favs) setFavorites(JSON.parse(favs));
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const toggleFavorite = async (id: string) => {
    try {
      const favsStr = await AsyncStorage.getItem('zenvy_favorites');
      let favs = favsStr ? JSON.parse(favsStr) : [];
      if (favs.includes(id)) {
        favs = favs.filter((f: string) => f !== id);
      } else {
        favs.push(id);
      }
      setFavorites(favs);
      await AsyncStorage.setItem('zenvy_favorites', JSON.stringify(favs));
    } catch (e) {
      console.error(e);
    }
  };

  const fetchVaultItems = async () => {
    setLoadingVault(true);
    try {
      const res = await apiFetch(ENDPOINTS.vaultList);
      if (res.ok) {
        const data = await res.json();
        setVaultItems(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingVault(false);
    }
  };

  const handleClaimVault = async (itemId: string) => {
    setClaimingItemId(itemId);
    try {
      const res = await apiFetch(ENDPOINTS.vaultClaim(itemId), { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Access Granted', data.message || 'Secured in your vault!');
        fetchVaultItems();
        if (refreshUser) refreshUser();
      } else {
        Alert.alert('Access Denied', data.message || 'Claim failed.');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error claiming vault item.');
    } finally {
      setClaimingItemId(null);
    }
  };

  const fetchBlockChallenges = async () => {
    setLoadingBlock(true);
    try {
      // Fetch active challenge
      const resChallenge = await apiFetch(ENDPOINTS.activeChallenge);
      if (resChallenge.ok) {
        const data = await resChallenge.json();
        setActiveChallenge(data.challenge);
        setBlockLeaderboard(data.leaderboard || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBlock(false);
    }
  };




  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINTS.restaurants);
      const data = await res.json();
      if (Array.isArray(data)) setRestaurants(data);
    } catch (e: any) { 
      if (e.message && (e.message.includes('Network') || e.message.includes('Failed to fetch') || e.message.includes('JSON'))) {
        setShowWakeup(true);
      } else {
        Alert.alert('Data Fetch Error', e.message || 'Could not fetch restaurants');
      }
      console.error(e); 
    }

    try {
      const confRes = await fetch(`${API_URL}/api/config`);
      const confData = await confRes.json();
      if (confData.success && confData.config) {
        if (confData.config.banners) {
          setPromos(confData.config.banners.filter((b: any) => b.isActive).map((b: any) => ({
            id: b._id || Math.random().toString(),
            tagline: b.tagline || '',
            title: b.title1 || '',
            subtitle: b.title2 || '',
            desc: b.description || '',
            btn: b.buttonText || '',
            img: b.imageUrl,
            redirectUrl: b.redirectUrl
          })));
        }
        if (confData.config.categories) {
          setClassics(confData.config.categories.filter((c: any) => c.isActive).sort((a: any, b: any) => a.order - b.order).map((c: any) => ({
            name: c.name,
            img: c.img
          })));
        }
      }
    } catch (err) { console.error('Config fetch error:', err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = restaurants
    .filter(r => { const t = (r.vendorType||'').toUpperCase(); return t === 'FOOD' || t === 'RESTAURANT'; })
    .filter(r => {
      if (filter === 'veg') return (r.menu||[]).some((i:any) => i.isVegetarian);
      if (filter === 'budget') return (r.menu||[]).some((i:any) => i.price < 150);
      if (filter === 'premium') return r.subscriptionTier === 'premium' || r.isFeatured;
      if (filter === 'jain') return (r.cuisine||'').toLowerCase().includes('jain');
      if (filter === 'eggless') return (r.cuisine||'').toLowerCase().includes('eggless');
      return true;
    })
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (r.name||'').toLowerCase().includes(q) || (r.cuisine||'').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aFeat = a.isFeatured ? 1 : 0;
      const bFeat = b.isFeatured ? 1 : 0;
      if (bFeat !== aFeat) return bFeat - aFeat;
      if (!classicFilter) return 0;
      const q = classicFilter.toLowerCase();
      const aMatch = (a.cuisine||'').toLowerCase().includes(q) || (a.name||'').toLowerCase().includes(q) || (a.menu||[]).some((m:any) => (m.name||'').toLowerCase().includes(q));
      const bMatch = (b.cuisine||'').toLowerCase().includes(q) || (b.name||'').toLowerCase().includes(q) || (b.menu||[]).some((m:any) => (m.name||'').toLowerCase().includes(q));
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });

  const carouselOffers = promos.map(p => ({
    id: p.id,
    imageUrl: p.img,
    tagline: p.tagline,
    title1: p.title,
    title2: p.subtitle,
    description: p.desc,
    buttonText: p.btn,
    redirectAction: () => {
      if (p.redirectUrl) {
        if (p.redirectUrl.startsWith('/')) {
           router.push(p.redirectUrl as any);
        } else {
           // External URL not currently supported in mobile webview directly without Linking, but safely handled.
        }
      } else if (p.id === 'kfc') {
        router.push('/restaurant/kfc' as any);
      } else if (p.id === 'ride') {
        router.push({ pathname: '/(tabs)/others', params: { tab: 'coride' } } as any);
      } else if (p.id === 'stays') {
        router.push({ pathname: '/(tabs)/others', params: { tab: 'pg' } } as any);
      } else if (p.id === 'elite') {
        router.push('/(tabs)/profile' as any);
      }
    }
  }));
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.08)' : COLORS.bgLightCard;
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? 'rgba(201, 168, 76, 0.25)' : COLORS.borderLight;
  const bgColors: [string, string] = isDark ? ['#1A1512', '#0A0806'] : [COLORS.bgLight, '#EFEFEF'];

  const goldColor = isDark ? COLORS.gold : COLORS.red;
  const goldBorderColor = isDark ? COLORS.goldBorder : 'rgba(239, 79, 95, 0.4)';
  const goldMutedColor = isDark ? COLORS.goldMuted : 'rgba(239, 79, 95, 0.15)';
  const goldGlowShadow = isDark ? SHADOWS.goldGlow : SHADOWS.redGlow;

  return (
    <View style={s.container}>
      <ServerWakeupOverlay 
        visible={showWakeup} 
        onWakeupComplete={() => {
          setShowWakeup(false);
          setRefreshing(true);
          fetchData();
        }} 
      />
      <AmbientBackground />
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={goldColor} />}>

        {/* ── NAVBAR ── */}
        <StaggeredSection delay={0} direction="down">
        <View style={s.nav}>
          <View style={s.navLeft}>
            <View style={[s.avatar, { backgroundColor: cardBg, borderColor: goldBorderColor }, user?.isElite && [s.avatarElite, { borderColor: goldColor }, goldGlowShadow]]}>
              <Text style={[s.avatarText, { color: goldColor }]}>{(user?.name||'Z').substring(0,2).toUpperCase()}</Text>
            </View>
            <View>
              <Text style={[s.greeting, { color: txtSec }]}>{getGreeting().toUpperCase()}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.userName, { color: txt }]}>{(user?.name || 'Zenvy').split(' ')[0].toUpperCase()}</Text>
                {user?.isElite && <BounceIn delay={400}><View style={[s.eliteBadge, { backgroundColor: goldColor }]}><Text style={s.eliteBadgeText}>ELITE</Text></View></BounceIn>}
              </View>
            </View>
          </View>
          <View style={s.navRight}>
            <DopaminePressable 
              style={[s.navBtn, { backgroundColor: cardBg, borderColor: goldBorderColor }]} 
              onPress={toggleTheme}
              sound="click"
              activeScale={0.9}
            >
              <Text style={{ fontSize: 18 }}>{isDark ? '☀️' : '🌙'}</Text>
            </DopaminePressable>
            <DopaminePressable 
              style={[s.navBtn, { backgroundColor: cardBg, borderColor: goldBorderColor }, s.profileBtn, { borderColor: goldColor }, goldGlowShadow]} 
              onPress={() => router.push('/(tabs)/profile')}
              sound="click"
              activeScale={0.9}
            >
              <Text style={{ fontSize: 18 }}>👤</Text>
              {totalItems > 0 && <BounceIn><View style={s.badge}><Text style={s.badgeText}>{totalItems}</Text></View></BounceIn>}
            </DopaminePressable>
          </View>
        </View>
        </StaggeredSection>

        {/* ── HERO CAROUSEL CARD ── */}
        <StaggeredSection delay={100} direction="up">
        <View style={[s.heroCarouselCard, { borderColor: border }]}>
          <PromoCarousel 
            offers={carouselOffers} 
            containerStyle={s.heroCarousel} 
          />
        </View>
        </StaggeredSection>

        {/* ── CATEGORIES GRID CONTAINER (EXACT FIT) ── */}
        <StaggeredSection delay={200} direction="up">
        <View style={s.premiumCatGrid}>
          {CATEGORIES.map((c, catIdx) => (
            <BounceIn key={c.key} delay={300 + catIdx * 80} style={{ flex: 1 }}>
            <DopaminePressable 
              style={[
                s.premiumCatBtn, 
                { 
                  backgroundColor: cardBg, 
                  borderColor: border,
                }
              ]} 
              onPress={() => {
                if (c.key === 'food') {
                  if (scrollRef.current) scrollRef.current.scrollTo({ y: 485, animated: true });
                } else if (c.key === 'basket') {
                  triggerTransition('/(tabs)/others?tab=food', 'mega-basket');
                } else if (c.key === 'hostels') {
                  triggerTransition('/(tabs)/others?tab=pg', 'pg');
                } else if (c.key === 'coride') {
                  triggerTransition('/(tabs)/others?tab=coride', 'bikepool');
                }
              }}
              sound="tabSwitch"
              activeScale={0.95}
            >
              <Image 
                source={CATEGORY_IMAGES[c.key as keyof typeof CATEGORY_IMAGES]} 
                style={{ width: '100%', height: 60 }} 
                resizeMode="cover" 
              />
              <Text style={[s.premiumCatLabel, { color: txt, marginTop: 8, marginBottom: 8 }]} numberOfLines={1}>
                {c.label.toUpperCase()}
              </Text>
            </DopaminePressable>
            </BounceIn>
          ))}
        </View>
        </StaggeredSection>


        {/* ── SEARCH ── */}
        <StaggeredSection delay={350} direction="left">
        <TouchableOpacity 
          activeOpacity={0.9}
          onPress={() => setIsSearchOpen(true)}
          style={[s.searchWrap, { backgroundColor: cardBg, borderColor: isDark ? goldBorderColor : COLORS.borderLight }]}
        >
          <Text style={{ fontSize: 16 }}>🔍</Text>
          <TextInput 
            style={[s.searchInput, { color: txt }]} 
            placeholder="Search for dishes or restaurants..." 
            placeholderTextColor={txtSec} 
            value={search} 
            editable={false}
            pointerEvents="none"
          />
        </TouchableOpacity>
        </StaggeredSection>

        {/* ── BLOCKWARS ARENA TRIGGER ── */}
        <StaggeredSection delay={450} direction="right">
        <CardPressable 
          style={[s.blockwarsBanner, { backgroundColor: cardBg, borderColor: goldBorderColor }]} 
          onPress={() => {
            fetchBlockChallenges();
            setShowBlockModal(true);
          }}
          sound="click"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <PulseGlow size={44} color={goldColor}>
                <View style={[s.blockwarsIcon, { backgroundColor: goldMutedColor, borderColor: goldBorderColor }]}><Text style={{ fontSize: 22 }}>🏆</Text></View>
              </PulseGlow>
              <View>
                <Text style={[s.blockwarsTitle, { color: txt }]}>ENTER BLOCKWARS ARENA</Text>
                <Text style={[s.blockwarsSub, { color: txtSec }]}>ACTIVE WEEKLY CAMPUS CHALLENGES</Text>
              </View>
            </View>
            <Text style={{ color: goldColor, fontSize: 16 }}>›</Text>
          </View>
        </CardPressable>
        </StaggeredSection>

        {/* ── CLASSICS ── */}
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: txt }]}>THE CLASSICS</Text>
          <DopaminePressable 
            style={s.manageBtn} 
            sound="click"
            onPress={() => Alert.alert('Preferences', 'Category preference management coming soon.')}
          >
            <Text style={s.manageBtnText}>MANAGE CATEGORIES ⚙️</Text>
          </DopaminePressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16, marginBottom: 20 }}>
          {classics.map((c, i) => {
            const isActive = classicFilter === c.name;
            return (
              <DopaminePressable 
                key={i} 
                style={s.classicItem} 
                onPress={() => {
                  setClassicFilter(isActive ? '' : c.name);
                  if (!isActive && scrollRef.current) {
                    scrollRef.current.scrollTo({ y: nexusY.current, animated: true });
                  }
                }}
                sound="tabSwitch"
                activeScale={0.92}
              >
                <View style={[s.classicImgWrap, isActive && { borderColor: COLORS.red, ...SHADOWS.redGlow }]}>
                  <Image source={{ uri: c.img }} style={s.classicImg} />
                </View>
                <Text style={[s.classicName, { color: isActive ? COLORS.red : txt }]}>{c.name.toUpperCase()}</Text>
              </DopaminePressable>
            );
          })}
        </ScrollView>

        {/* ── NEXUS EXPLORER: Dish Discovery ── */}
        {classicFilter !== '' && (
          <Animated.View 
            onLayout={(e) => { nexusY.current = e.nativeEvent.layout.y; }}
            style={{
              opacity: classicAnim,
              transform: [
                {
                  translateY: classicAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [25, 0],
                  })
                },
                {
                  scale: classicAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  })
                }
              ]
            }}
          >
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: txt }]}>{classicFilter.toUpperCase()}</Text>
              <TouchableOpacity onPress={() => setClassicFilter('')}>
                <Text style={{ fontSize: 9, fontWeight: '800', color: COLORS.red, letterSpacing: 1 }}>CLEAR ✕</Text>
              </TouchableOpacity>
            </View>
            <NexusExplorer
              restaurants={restaurants.filter(r => { const t = (r.vendorType||'').toUpperCase(); return t === 'FOOD' || t === 'RESTAURANT'; })}
              activeCategory={classicFilter}
              onSelectItem={(restaurantId) => router.push(`/restaurant/${restaurantId}` as any)}
            />
          </Animated.View>
        )}

        {/* ── ZENVY VAULT ── */}
        <StaggeredSection delay={600} direction="up">
        <CardPressable 
          style={[s.vaultCard, { backgroundColor: cardBg }]} 
          onPress={() => {
            fetchVaultItems();
            setShowVaultModal(true);
          }}
          sound="click"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
            <View style={s.vaultLeft}>
              <PulseGlow size={44} color="#C9A84C">
                <View style={s.vaultIcon}><Text style={{ fontSize: 24 }}>✨</Text></View>
              </PulseGlow>
              <View>
                <Text style={[s.vaultTitle, { color: txt }]}>THE ZENVY VAULT</Text>
                <Text style={[s.vaultSub, { color: txtSec }]}>3 ULTRA-PREMIUM DROPS</Text>
              </View>
            </View>
            <View style={s.vaultRight}>
              <VaultTimerBadge pulseAnim={pulseAnim} />
              <Text style={[s.vaultUntil, { color: txtSec }]}>UNTIL SEALED</Text>
            </View>
          </View>
        </CardPressable>
        </StaggeredSection>

        {/* Recently Visited Memory Cache */}
        <RecentlyViewed />

        {/* ── FILTERS ── */}
        <View style={s.sectionHeader}><Text style={[s.sectionTitle, { color: txt }]}>All Restaurants</Text></View>
        <Text style={[s.sectionSub, { color: txtSec }]}>DISCOVER YOUR CAMPUS FAVORITES</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16, marginBottom: 16 }}>
          {FILTERS.map(f => {
            const isChipActive = filter === f.key;
            return (
              <DopaminePressable 
                key={f.key} 
                onPress={() => setFilter(f.key)} 
                style={[
                  s.filterChip, 
                  isChipActive ? s.filterActive : {}, 
                  { borderColor: isChipActive ? COLORS.red : (isDark ? COLORS.borderDark : COLORS.borderLight) }
                ]}
                sound="tabSwitch"
                activeScale={0.93}
              >
                <Text style={[s.filterText, isChipActive ? s.filterTextActive : {}]}>{f.label}</Text>
              </DopaminePressable>
            );
          })}
        </ScrollView>

        {/* ── RESTAURANT GRID ── */}
        <View style={s.grid}>
          {filtered.map((r, i) => {
            const id = r._id || r.id;
            const rating = Number(r.rating) || 4.0;
            const time = `${30 + Math.floor(Math.random()*30)}-${50 + Math.floor(Math.random()*20)} min`;
            const img = r.imageUrl || r.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
            
            // Stable pseudo-random offers & pricing to match web portal behaviour
            const nameSeed = (r.name || '').length + (id || '').charCodeAt(0);
            const priceForTwo = 150 + (nameSeed * 7) % 201;
            const offers = ["50% OFF up to ₹100", "Flat ₹75 OFF", "Free Delivery", "60% OFF up to ₹120", "Buy 1 Get 1 Free"];
            const offer = offers[nameSeed % offers.length];
            const hasOffer = (nameSeed % 10) < 7;
            const isFav = favorites.includes(id);
            const isPremium = r.subscriptionTier === 'premium' || r.isFeatured;

            return (
              <StaggeredSection 
                key={id || i} 
                delay={50 + (i % 6) * 60} 
                direction="up"
                style={{ width: CARD_W }}
              >
              <CardPressable 
                style={[s.rCard, { backgroundColor: cardBg, borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', borderWidth: 1.5, width: '100%', marginHorizontal: 0 }]} 
                onPress={() => router.push(`/restaurant/${id}` as any)}
                sound={isPremium ? 'premiumRestaurantTransition' : 'click'}
              >
                <View style={s.rImgWrap} pointerEvents="box-none">
                  <Image source={{ uri: img }} style={s.rImg} />
                  
                  {/* Favorite Toggle Button */}
                  <DopaminePressable 
                    style={s.heartBtn}
                    onPress={() => toggleFavorite(id)}
                    sound="click"
                    activeScale={0.8}
                  >
                    <Text style={{ fontSize: 13 }}>{isFav ? '❤️' : '🤍'}</Text>
                  </DopaminePressable>
 
                  {/* Promoted badge */}
                  {r.isFeatured && (
                    <View style={s.promotedBadge}>
                      <Text style={s.promotedText}>PROMOTED</Text>
                    </View>
                  )}
 
                  <View style={s.timeChip}><Text style={s.timeText}>{time}</Text></View>
                  {hasOffer && (
                    <View style={s.offerRibbon}>
                      <Text style={s.offerText}>
                        {offer.includes('%') ? offer.split(' ')[0] : (offer.includes('Flat') ? 'FLAT OFF' : 'BOGO')}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={s.rInfo}>
                  <View style={s.rTitleRow}>
                    <Text style={[s.rName, { color: txt }]} numberOfLines={1}>{r.name}</Text>
                    <View style={s.ratingBadge}>
                      <Text style={s.ratingText}>{rating.toFixed(1)}</Text>
                      <Text style={{ fontSize: 8, color: '#fff', fontWeight: '900' }}>★</Text>
                    </View>
                  </View>
                  
                  {/* Cuisine and Price */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <Text style={[s.rCuisine, { color: txtSec, flex: 1, marginRight: 4 }]} numberOfLines={1}>
                      {r.cuisine || 'North Indian, Fast Food'}
                    </Text>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: txt }}>
                      ₹{priceForTwo}
                    </Text>
                  </View>
 
                  {/* Zomato style dashed offer line */}
                  {hasOffer && (
                    <View style={{ 
                      paddingTop: 6, 
                      borderTopWidth: 1, 
                      borderStyle: 'dashed', 
                      borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)', 
                      flexDirection: 'row', 
                      alignItems: 'center', 
                      gap: 4, 
                      marginTop: 4 
                    }}>
                      <Text style={{ fontSize: 10 }}>🏷️</Text>
                      <Text style={{ fontSize: 9.5, color: txtSec, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                        {offer}
                      </Text>
                    </View>
                  )}
                </View>
              </CardPressable>
              </StaggeredSection>
            );
          })}
        </View>

        {/* ── CAMPUSBITES: LOCAL VENDORS ── */}
        <CampusBitesSection restaurants={restaurants} />

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── ZENVY VAULT MODAL ── */}
      <Modal visible={showVaultModal} animationType="slide" transparent={true}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContentBox, { backgroundColor: cardBg }]}>
            <Text style={[s.modalTitle, { color: txt }]}>THE ZENVY VAULT DROPS</Text>
            <Text style={[s.modalSubtitle, { color: txtSec }]}>VERIFIED PREMIUM CAMPUS DISCOUNTS & EXCLUSIVES</Text>

            {loadingVault ? (
              <ActivityIndicator size="large" color={goldColor} style={{ marginVertical: 32 }} />
            ) : vaultItems.length > 0 ? (
              <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
                {vaultItems.map(item => {
                  const hasStreak = (user?.streakCount || 0) >= item.streakRequirement;
                  const itemImg = item.imageUrl || 'https://images.unsplash.com/photo-1618331835717-801e976710b2?w=400';
                  return (
                    <View key={item.id} style={[s.vaultItemCard, { borderColor: border }]}>
                      <Image source={{ uri: itemImg }} style={s.vaultItemImg} />
                      <View style={s.vaultItemInfo}>
                        <Text style={[s.vaultItemName, { color: txt }]}>{item.name}</Text>
                        <Text style={[s.vaultItemDesc, { color: txtSec }]}>{item.description || 'Exclusive premium campus drop.'}</Text>
                        <Text style={[s.vaultItemStock, { color: COLORS.red }]}>{item.remainingCount} items left</Text>
                        
                        <View style={s.vaultItemReqRow}>
                          <View style={[s.reqBadge, { backgroundColor: hasStreak ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }]}>
                            <Text style={[s.reqBadgeText, { color: hasStreak ? COLORS.emerald : '#EF4444' }]}>
                              🔥 {item.streakRequirement}d Streak
                            </Text>
                          </View>
                        </View>

                        {hasStreak ? (
                          <TouchableOpacity 
                            style={[s.claimBtn, { backgroundColor: goldColor }]}
                            onPress={() => handleClaimVault(item.id)}
                            disabled={claimingItemId === item.id}
                          >
                            {claimingItemId === item.id ? (
                              <ActivityIndicator size="small" color={isDark ? "#000" : "#fff"} />
                            ) : (
                              <Text style={[s.claimBtnText, { color: isDark ? '#000' : '#fff' }]}>SECURE ACCESS 🔑</Text>
                            )}
                          </TouchableOpacity>
                        ) : (
                          <View style={s.lockedBtn}>
                            <Text style={s.lockedBtnText}>STREAK LOCKED 🔒</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Text style={{ fontSize: 32, marginBottom: 12 }}>📭</Text>
                <Text style={{ color: txtSec, fontSize: 11, fontWeight: '700' }}>No active vault drops right now.</Text>
              </View>
            )}

            <DopaminePressable 
              style={s.modalCloseBtn} 
              onPress={() => setShowVaultModal(false)}
              sound="click"
            >
              <Text style={s.modalCloseText}>CLOSE VAULT</Text>
            </DopaminePressable>
          </View>
        </View>
      </Modal>

      {/* ── BLOCKWARS ARENA MODAL ── */}
      <Modal visible={showBlockModal} animationType="slide" transparent={true}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContentBox, { backgroundColor: cardBg }]}>
            <Text style={[s.modalTitle, { color: txt }]}>🏆 BLOCKWARS ARENA</Text>
            <Text style={[s.modalSubtitle, { color: txtSec }]}>CAMPUS HOSTEL BLOCK COMPETITION</Text>

            {loadingBlock ? (
              <ActivityIndicator size="large" color={goldColor} style={{ marginVertical: 32 }} />
            ) : (
              <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
                {activeChallenge && (
                  <View style={[s.challengeCardLayout, { borderColor: border }]}>
                    <Text style={s.challengeEmoji}>{activeChallenge.emoji || '🏆'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.challengeTitle, { color: txt }]}>{activeChallenge.title.toUpperCase()}</Text>
                      <Text style={[s.challengeDesc, { color: txtSec }]}>{activeChallenge.description}</Text>
                      <Text style={[s.challengeReward, { color: goldColor }]}>🎁 REWARD: +50 ZENPOINTS PER USER IN WINNING BLOCK</Text>
                    </View>
                  </View>
                )}

                <Text style={[s.leaderboardTitle, { color: txt }]}>LIVE LEADERBOARD STANDINGS</Text>
                {blockLeaderboard.length > 0 ? (
                  blockLeaderboard.map((item, idx) => {
                    const isUserBlock = user?.hostelBlock === item.block;
                    return (
                      <View key={item.block} style={[s.leaderboardRow, { borderColor: border }, isUserBlock && { borderColor: goldColor, backgroundColor: isDark ? 'rgba(201,168,76,0.06)' : 'rgba(239,79,95,0.06)' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Text style={[s.rankText, { color: idx === 0 ? goldColor : idx === 1 ? '#9CA3AF' : idx === 2 ? '#B45309' : txtSec }]}>
                            #{idx + 1}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.blockName, { color: txt }]}>
                              BLOCK {item.block?.toUpperCase()} {isUserBlock && ' (MY BLOCK)'}
                            </Text>
                            <Text style={{ fontSize: 8, color: txtSec }}>
                              {item.participants || 0} ORDERERS • ₹{item.spend || 0} TOTAL VALUE
                            </Text>
                          </View>
                        </View>
                        <Text style={[s.scoreVal, { color: idx === 0 ? goldColor : txt }]}>
                          {item.orders || item.score || 0} ORDERS
                        </Text>
                      </View>
                    );
                  })
                ) : (
                  <View style={{ padding: 24, alignItems: 'center' }}>
                    <Text style={{ color: txtSec, fontSize: 10, fontWeight: '700' }}>No active standings yet this week.</Text>
                  </View>
                )}
              </ScrollView>
            )}

            <DopaminePressable 
              style={s.modalCloseBtn} 
              onPress={() => setShowBlockModal(false)}
              sound="click"
            >
              <Text style={s.modalCloseText}>DISMISS ARENA</Text>
            </DopaminePressable>
          </View>
        </View>
      </Modal>

      {/* ── SEARCH OVERLAY DRAWER ── */}
      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      {/* ── FLOATING COMMUNITY FAB ── */}
      <FloatingPulse color={COLORS.red} style={s.fabBtnWrap}>
        <DopaminePressable 
          style={s.fabBtn} 
          onPress={() => router.push('/community' as any)}
          sound="click"
          activeScale={0.88}
        >
          <Text style={{ fontSize: 22 }}>💬</Text>
          <View style={s.fabBadge} />
        </DopaminePressable>
      </FloatingPulse>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  // Nav
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },
  navLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: COLORS.bgCard, borderWidth: 1.5, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' },
  avatarElite: { borderColor: COLORS.gold, ...SHADOWS.goldGlow },
  avatarText: { fontSize: 13, fontWeight: '900', color: COLORS.gold },
  greeting: { fontSize: 9, fontWeight: '800', letterSpacing: 3 },
  userName: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  eliteBadge: { backgroundColor: COLORS.gold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  eliteBadgeText: { fontSize: 8, fontWeight: '900', color: '#000', letterSpacing: 2 },
  navRight: { flexDirection: 'row', gap: 8 },
  navBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.goldBorder },
  profileBtn: { borderColor: COLORS.gold, ...SHADOWS.goldGlow },
  badge: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 8, fontWeight: '900', color: '#fff' },
  // Hero
  heroWrap: { marginHorizontal: 16, borderRadius: RADIUS.hero, overflow: 'hidden', height: 220, marginBottom: 16 },
  heroImg: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  heroContent: { flex: 1, justifyContent: 'center', padding: 24, zIndex: 2 },
  heroTag: { fontSize: 9, fontWeight: '900', color: COLORS.gold, letterSpacing: 5, marginBottom: 8 },
  heroTitle: { fontSize: 28, fontWeight: '900', color: '#fff', fontStyle: 'italic', lineHeight: 30 },
  heroSub: { fontSize: 28, fontWeight: '900', color: COLORS.gold, fontStyle: 'italic', lineHeight: 30, marginBottom: 8 },
  heroDesc: { fontSize: 8, fontWeight: '700', color: '#aaa', letterSpacing: 3, marginBottom: 16, maxWidth: 260 },
  heroCta: { backgroundColor: COLORS.gold, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 30, alignSelf: 'flex-start', ...SHADOWS.goldGlow },
  heroCtaText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 4 },
  heroDots: { position: 'absolute', bottom: 14, left: 24, flexDirection: 'row', gap: 4, zIndex: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 22, backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  // Categories
  catRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  catBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: COLORS.borderDark },
  catIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.goldMuted, borderWidth: 1, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  // Search
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5, gap: 10, marginBottom: 20 },
  searchInput: { flex: 1, fontSize: 12, fontWeight: '600', padding: 0 },
  // Classics
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  sectionSub: { fontSize: 9, fontWeight: '700', letterSpacing: 3, paddingHorizontal: 16, marginBottom: 12, marginTop: -4 },
  manageBtn: { backgroundColor: COLORS.bgCard, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: COLORS.borderDark },
  manageBtnText: { fontSize: 8, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 1 },
  classicItem: { alignItems: 'center', marginRight: 16, width: 70 },
  classicImgWrap: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: COLORS.gold, overflow: 'hidden', marginBottom: 6, ...SHADOWS.goldGlow },
  classicImg: { width: '100%', height: '100%' },
  classicName: { fontSize: 8, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  // Vault
  vaultCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, padding: 16, borderRadius: 28, borderWidth: 1, borderColor: COLORS.goldBorder, marginBottom: 24 },
  vaultLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vaultIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#000', borderWidth: 1, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' },
  vaultTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 3 },
  vaultSub: { fontSize: 8, fontWeight: '700', letterSpacing: 2, marginTop: 2 },
  vaultRight: { alignItems: 'flex-end' },
  vaultTimerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.goldMuted, borderWidth: 1, borderColor: COLORS.goldBorder, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  vaultDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.gold },
  vaultTimer: { fontSize: 11, fontWeight: '900', color: COLORS.gold, fontVariant: ['tabular-nums'] },
  vaultUntil: { fontSize: 7, fontWeight: '900', letterSpacing: 3, marginTop: 4 },
  // Filters
  filterChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, marginRight: 8 },
  filterActive: { backgroundColor: COLORS.red },
  filterText: { fontSize: 10, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 1 },
  filterTextActive: { color: '#fff' },
  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12 },
  rCard: { width: CARD_W, borderRadius: 16, overflow: 'hidden', ...SHADOWS.card },
  rImgWrap: { width: '100%', aspectRatio: 4/3, position: 'relative' },
  rImg: { width: '100%', height: '100%' },
  heartBtn: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  promotedBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  promotedText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 1.2 },
  timeChip: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 7, paddingVertical: 3.5, borderRadius: 6 },
  timeText: { fontSize: 9, fontWeight: '900', color: '#fff' },
  offerRibbon: { position: 'absolute', bottom: 8, left: 0, backgroundColor: COLORS.blueOffer, paddingHorizontal: 8, paddingVertical: 4, borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  offerText: { fontSize: 9, fontWeight: '900', color: '#fff' },
  rInfo: { padding: 10 },
  rTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  rName: { fontSize: 13, fontWeight: '900', color: '#111', flex: 1, marginRight: 4 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: COLORS.greenRating, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  ratingText: { fontSize: 10, fontWeight: '900', color: '#fff' },
  rCuisine: { fontSize: 10, color: '#888', fontWeight: '600' },
  // BlockWars & Modals styles
  blockwarsBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 20 },
  blockwarsIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: COLORS.goldMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.goldBorder },
  blockwarsTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  blockwarsSub: { fontSize: 7, fontWeight: '800', letterSpacing: 1.5, marginTop: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContentBox: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, height: '80%', alignItems: 'center' },
  modalTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 3, marginBottom: 6 },
  modalSubtitle: { fontSize: 8, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.5, marginBottom: 20, textAlign: 'center' },
  modalCloseBtn: { width: '100%', paddingVertical: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  modalCloseText: { fontSize: 9, fontWeight: '900', color: COLORS.textSecondary, letterSpacing: 2 },

  vaultItemCard: { flexDirection: 'row', padding: 12, borderRadius: 20, borderWidth: 1, marginBottom: 12 },
  vaultItemImg: { width: 80, height: 80, borderRadius: 12, marginRight: 12 },
  vaultItemInfo: { flex: 1, justifyContent: 'space-between' },
  vaultItemName: { fontSize: 12, fontWeight: '900' },
  vaultItemDesc: { fontSize: 9, fontWeight: '600', marginVertical: 2 },
  vaultItemStock: { fontSize: 8, fontWeight: '800', marginBottom: 6 },
  vaultItemReqRow: { flexDirection: 'row', marginBottom: 8 },
  reqBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  reqBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  claimBtn: { paddingVertical: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  claimBtnText: { fontSize: 8, fontWeight: '900', color: '#000', letterSpacing: 1 },
  lockedBtn: { paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  lockedBtnText: { fontSize: 8, fontWeight: '800', color: COLORS.textMuted },

  challengeCardLayout: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, marginBottom: 20, alignItems: 'center' },
  challengeEmoji: { fontSize: 32 },
  challengeTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  challengeDesc: { fontSize: 8, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  challengeReward: { fontSize: 8, fontWeight: '900', color: COLORS.gold, letterSpacing: 1 },

  leaderboardTitle: { fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  leaderboardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
  rankText: { fontSize: 12, fontWeight: '900', width: 24 },
  blockName: { fontSize: 11, fontWeight: '900' },
  scoreVal: { fontSize: 11, fontWeight: '900' },

  // Floating Community FAB
  fabBtnWrap: { position: 'absolute', bottom: 20, right: 20, width: 54, height: 54, zIndex: 999 },
  fabBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', ...SHADOWS.redGlow },
  fabBadge: { position: 'absolute', top: 3, right: 3, width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.gold, borderWidth: 1.5, borderColor: '#fff' },

  // Separate Hero Card & Premium Categories Grid
  heroCarouselCard: {
    marginHorizontal: 16,
    borderRadius: 28,
    overflow: 'hidden',
    marginBottom: 16,
    ...SHADOWS.card,
  },
  heroCarousel: {
    height: 200,
  },
  premiumCatGrid: {
    marginHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 8,
  },
  premiumCatBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    paddingBottom: 8,
  },
  premiumCatIconOuter: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumCatIconImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  premiumCatLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
});
