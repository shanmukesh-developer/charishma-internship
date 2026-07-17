import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
  Modal,
  TextInput,
  Switch,
  Alert,
  Clipboard,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, SHADOWS } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import AmbientBackground from '../../components/AmbientBackground';
import { StaggeredSection, BounceIn } from '../../components/AnimatedSection';
import DopaminePressable from '../../components/DopaminePressable';
import { apiFetch } from '../../utils/auth';
import { API_URL, ENDPOINTS } from '../../constants/api';

// Pre-selected high-quality gaming & food avatars
const PREMIUM_AVATARS = [
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
  'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=150',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
];

interface SavedAddress {
  label: string;
  address: string;
  city: string;
}

interface DietPrefs {
  mode: 'all' | 'veg' | 'non-veg' | 'egg';
  nuts: boolean;
  dairy: boolean;
  gluten: boolean;
  custom: string[];
}

interface NotifPrefs {
  orders: boolean;
  surge: boolean;
  promos: boolean;
}

export default function ProfileScreen() {
  const { user, setUser, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();

  // Color Palette mappings
  const bg = isDark ? '#0A0A0C' : '#FAFAFA';
  const cardBg = isDark ? '#141416' : '#FFF';
  const txt = isDark ? '#FFF' : '#111';
  const txtSec = isDark ? '#AAA' : '#666';
  const border = isDark ? 'rgba(212, 175, 122, 0.25)' : 'rgba(0, 0, 0, 0.06)';
  const goldColor = '#D4AF37';

  // Feature states
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  // Edit fields
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('Amaravathi');
  const [editProfileImage, setEditProfileImage] = useState<string | null>(null);

  // Location suggestions
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestTimeout = useRef<any>(null);

  // Saved addresses
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [newAddr, setNewAddr] = useState<SavedAddress>({ label: '', address: '', city: 'Amaravathi' });

  // Dietary
  const [dietPrefs, setDietPrefs] = useState<DietPrefs>({ mode: 'all', nuts: false, dairy: false, gluten: false, custom: [] });
  const [customAllergy, setCustomAllergy] = useState('');

  // Notifications
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({ orders: true, surge: true, promos: false });

  // Dashboard & stats
  const [spendStats, setSpendStats] = useState<any>(null);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [giftPhone, setGiftPhone] = useState('');

  const initials = (user?.name || 'ZU').substring(0, 2).toUpperCase();

  // Load preferences and server data
  useEffect(() => {
    loadLocalPreferences();
    fetchData();
  }, []);

  const loadLocalPreferences = async () => {
    try {
      const savedAddrRaw = await AsyncStorage.getItem('zenvy_saved_addresses');
      if (savedAddrRaw) setSavedAddresses(JSON.parse(savedAddrRaw));

      const dietPrefsRaw = await AsyncStorage.getItem('zenvy_diet_prefs');
      if (dietPrefsRaw) setDietPrefs(JSON.parse(dietPrefsRaw));

      const notifPrefsRaw = await AsyncStorage.getItem('zenvy_notif_prefs');
      if (notifPrefsRaw) setNotifPrefs(JSON.parse(notifPrefsRaw));
    } catch (e) {
      console.log('Error loading local preferences:', e);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Sync latest profile details
      const profileRes = await apiFetch(ENDPOINTS.profile);
      if (profileRes.ok) {
        const data = await profileRes.json();
        setUser({ ...user, ...data });
        setEditName(data.name || '');
        setEditAddress(data.address || '');
        setEditCity(data.city || 'Amaravathi');
        setEditProfileImage(data.profileImage || null);
      }

      // 2. Spending Stats
      const statsRes = await apiFetch(`${API_URL}/api/orders/stats`);
      if (statsRes.ok) {
        const data = await statsRes.json();
        setSpendStats(data);
      }

      // 3. Coupons / Gourmet Vault
      const couponsRes = await apiFetch(`${API_URL}/api/rewards/coupons`);
      if (couponsRes.ok) {
        const data = await couponsRes.json();
        setCoupons(data);
      }
    } catch (err) {
      console.log('Data fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Saved address helpers
  const saveSavedAddressesList = async (list: SavedAddress[]) => {
    setSavedAddresses(list);
    await AsyncStorage.setItem('zenvy_saved_addresses', JSON.stringify(list));
  };

  const handleAddAddress = () => {
    if (!newAddr.label || !newAddr.address) {
      Alert.alert('Required Fields', 'Please fill in the Label and Address fields.');
      return;
    }
    const updated = [...savedAddresses, newAddr];
    saveSavedAddressesList(updated);
    setNewAddr({ label: '', address: '', city: 'Amaravathi' });
    setAddingAddress(false);
  };

  const handleDeleteAddress = (idx: number) => {
    const updated = savedAddresses.filter((_, i) => i !== idx);
    saveSavedAddressesList(updated);
  };

  // Dietary helpers
  const saveDietPreferences = async (updated: DietPrefs) => {
    setDietPrefs(updated);
    await AsyncStorage.setItem('zenvy_diet_prefs', JSON.stringify(updated));
  };

  const handleAddAllergy = () => {
    if (!customAllergy.trim()) return;
    const updatedCustom = [...(dietPrefs.custom || []), customAllergy.trim()];
    saveDietPreferences({ ...dietPrefs, custom: updatedCustom });
    setCustomAllergy('');
  };

  const handleRemoveAllergy = (idx: number) => {
    const updatedCustom = dietPrefs.custom.filter((_, i) => i !== idx);
    saveDietPreferences({ ...dietPrefs, custom: updatedCustom });
  };

  // Notification helpers
  const saveNotifPreferences = async (updated: NotifPrefs) => {
    setNotifPrefs(updated);
    await AsyncStorage.setItem('zenvy_notif_prefs', JSON.stringify(updated));
  };

  const handleEnablePush = () => {
    Alert.alert('Push Notifications', 'Live delivery updates have been activated for this device!');
  };

  // Profile Edit helpers
  const fetchAddressSuggestions = (query: string) => {
    if (suggestTimeout.current) clearTimeout(suggestTimeout.current);
    if (query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    suggestTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&addressdetails=1&limit=5`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'ZenvyNexusStudentApp/2.4.0 (contact@zenvy.app)' } }
        );
        const results = await res.json();
        setSuggestions(results || []);
        setShowSuggestions(true);
      } catch (err) {
        setSuggestions([]);
      }
    }, 400);
  };

  const handleSelectSuggestion = (item: any) => {
    const addr = item.address || {};
    const parts = [item.name, addr.road || addr.neighbourhood, addr.suburb || addr.village, addr.state_district].filter(Boolean);
    const city = addr.city || addr.town || addr.county || addr.state_district || 'Amaravathi';
    setEditAddress(parts.join(', ') || item.display_name);
    setEditCity(city);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleUpdateProfile = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/users/profile`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName,
          address: editAddress,
          city: editCity,
          profileImage: editProfileImage,
        }),
      });

      if (response.ok) {
        const updated = await response.json();
        setUser({ ...user, ...updated });
        setIsEditing(false);
        Alert.alert('Profile Updated', 'Your profile details and location have been synced successfully.');
        fetchData();
      } else {
        Alert.alert('Error', 'Unable to sync updates with Zenvy servers.');
      }
    } catch (e) {
      Alert.alert('Error', 'Unable to sync updates with Zenvy servers.');
    }
  };

  // Gifting helper
  const handleSendGift = async (amt: number) => {
    if (!giftPhone) {
      Alert.alert('Error', "Please enter your friend's phone number.");
      return;
    }
    try {
      const res = await apiFetch(`${API_URL}/api/features/gift`, {
        method: 'POST',
        body: JSON.stringify({ recipientPhone: giftPhone, amount: amt }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', data.message || `₹${amt} gift sent successfully! 🎁`);
        setGiftPhone('');
        fetchData();
      } else {
        Alert.alert('Error', data.message || 'Gift transaction failed.');
      }
    } catch {
      Alert.alert('Error', 'Network error during transaction.');
    }
  };

  const qrValue = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${user?.name || 'Zenvy User'}`,
    `TEL;TYPE=CELL:+91${user?.phone || ''}`,
    `ADR;TYPE=HOME:;;${user?.address || ''};${user?.city || 'Amaravathi'};;;India`,
    `NOTE:Zenvy ${user?.isElite ? 'Elite' : 'Standard'} Member — ${user?.city || 'Amaravathi'}`,
    'END:VCARD',
  ].join('\n');

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <AmbientBackground />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        
        {/* Profile Card & Identity Code */}
        <StaggeredSection delay={100} direction="down">
          <View style={[s.profileCard, { backgroundColor: cardBg, borderColor: border }]}>
            
            {/* Top row: Avatar + Zenvy Badge / Streak */}
            <View style={s.profileCardHeader}>
              <TouchableOpacity onPress={() => setIsEditing(true)}>
                <View style={s.avatarOuterRing}>
                  <LinearGradient
                    colors={isDark ? [goldColor, '#FFF', '#C9962C'] : ['#EF4F5F', '#FF7E8B', '#E03546']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.avatarRingGradient}
                  >
                    <View style={[s.avatar, { backgroundColor: isDark ? '#141416' : '#FFF' }]}>
                      {user?.profileImage ? (
                        <Image source={{ uri: user.profileImage }} style={s.avatarImg} />
                      ) : (
                        <Text style={[s.avatarText, { color: isDark ? goldColor : '#EF4F5F' }]}>{initials}</Text>
                      )}
                    </View>
                  </LinearGradient>
                  {user?.streakCount && user.streakCount > 0 && (
                    <View style={[s.streakBadge, { borderColor: isDark ? goldColor : '#FFF', backgroundColor: isDark ? '#000' : '#EF4F5F' }]}>
                      <Text style={s.streakBadgeText}>🔥 {user.streakCount}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <View style={s.headerBadges}>
                <View style={[s.zenvyBadge, { backgroundColor: goldColor }]}>
                  <Text style={s.zenvyBadgeText}>ZENVY</Text>
                  <View style={s.zenvyDots}>
                    <View style={s.zenvyDot} />
                    <View style={s.zenvyDot} />
                  </View>
                </View>
                
                <TouchableOpacity style={s.streakCapsule} onPress={() => router.push('/rewards')}>
                  <Text style={s.streakCapsuleText}>🔥 {user?.streakCount || 0} Day Streak</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Name, Tier & ZV code */}
            <Text style={[s.name, { color: txt }]}>{(user?.name || 'ZENVY MEMBER').toUpperCase()}</Text>
            <Text style={[s.tierText, { color: goldColor }]}>
              {user?.isElite ? 'ELITE MEMBER' : 'EXPLORER TIER'} • SINCE 2024
            </Text>

            <TouchableOpacity style={[s.barcodeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]} onPress={() => setShowQR(true)}>
              <View style={s.barcodeLines}>
                <View style={[s.barcodeLine, { backgroundColor: txt, width: 2 }]} />
                <View style={[s.barcodeLine, { backgroundColor: txt, width: 1 }]} />
                <View style={[s.barcodeLine, { backgroundColor: txt, width: 3 }]} />
                <View style={[s.barcodeLine, { backgroundColor: txt, width: 1 }]} />
                <View style={[s.barcodeLine, { backgroundColor: txt, width: 2 }]} />
              </View>
              <Text style={[s.barcodeText, { color: txtSec }]}>
                ZV-{(user?._id || user?.id || '0000').slice(-6).toUpperCase()}
              </Text>
            </TouchableOpacity>

            {/* Primary Address Pinpoint widget */}
            <TouchableOpacity
              style={[s.primaryAddressBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6', borderColor: border }]}
              onPress={() => setIsEditing(true)}
            >
              <Text style={{ fontSize: 14 }}>📍</Text>
              <Text style={[s.primaryAddressText, { color: txt }]} numberOfLines={1}>
                {user?.address || 'Set your primary hostel room & block'}
              </Text>
              <Text style={[s.editAddrText, { color: goldColor }]}>EDIT</Text>
            </TouchableOpacity>

            {/* Identity Telemetry Grid */}
            <View style={[s.telemetryContainer, { backgroundColor: isDark ? '#1C1B1F' : '#FAFAFA', borderColor: border }]}>
              <View style={s.telemetryGrid}>
                <View style={s.telemetryItem}>
                  <Text style={s.telemetryLabel}>TOTAL ORDERS</Text>
                  <Text style={[s.telemetryVal, { color: txt }]}>{user?.totalOrders || 0}</Text>
                </View>
                <View style={[s.telemetryItem, s.telemetryBorder]}>
                  <Text style={s.telemetryLabel}>ZEN POINTS</Text>
                  <Text style={[s.telemetryVal, { color: goldColor }]}>{user?.zenPoints || 0}</Text>
                </View>
                <View style={s.telemetryItem}>
                  <Text style={s.telemetryLabel}>TIER STATUS</Text>
                  <Text style={[s.telemetryVal, { color: goldColor, fontSize: 13 }]}>
                    {user?.isElite ? 'ELITE' : 'EXPLORER'}
                  </Text>
                </View>
              </View>

              <View style={s.progressContainer}>
                <View style={s.progressLabels}>
                  <Text style={s.progressTitle}>DISTANCE TO ELITE TIER</Text>
                  <Text style={[s.progressVal, { color: goldColor }]}>
                    {Math.min(user?.totalOrders || 0, 500)} / 500 Orders
                  </Text>
                </View>
                <View style={[s.progressBarBg, { backgroundColor: isDark ? '#000' : '#E0E0E0' }]}>
                  <View
                    style={[
                      s.progressBarFill,
                      {
                        backgroundColor: goldColor,
                        width: `${Math.min(((user?.totalOrders || 0) / 500) * 100, 100)}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>

          </View>
        </StaggeredSection>

        {/* 🏠 Saved Addresses */}
        <StaggeredSection delay={150} direction="up">
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>SAVED ADDRESSES</Text>
            <TouchableOpacity onPress={() => setAddingAddress(true)}>
              <Text style={[s.sectionAddBtn, { color: goldColor }]}>+ ADD NEW</Text>
            </TouchableOpacity>
          </View>

          {savedAddresses.length === 0 ? (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[s.emptyText, { color: txtSec }]}>No saved addresses yet</Text>
              <Text style={[s.emptySubText, { color: txtSec }]}>Save Hostel Room, Class Block, Gate-2...</Text>
            </View>
          ) : (
            savedAddresses.map((sa, i) => (
              <View key={i} style={[s.savedAddressCard, { backgroundColor: cardBg, borderColor: border }]}>
                <View style={s.savedAddressLeft}>
                  <View style={s.savedAddressIconBox}>
                    <Text style={{ fontSize: 15 }}>📍</Text>
                  </View>
                  <View>
                    <Text style={[s.savedAddressLabel, { color: goldColor }]}>{sa.label}</Text>
                    <Text style={[s.savedAddressVal, { color: txt }]}>{sa.address}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => handleDeleteAddress(i)}>
                  <Text style={s.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </StaggeredSection>

        {/* 🥗 Dietary Preferences */}
        <StaggeredSection delay={180} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>DIETARY PREFERENCES</Text>
          <View style={[s.dietCard, { backgroundColor: cardBg, borderColor: border }]}>
            
            <Text style={[s.dietLabel, { color: txtSec }]}>CULINARY ACCESS FILTER</Text>
            <View style={s.dietModeGrid}>
              {[
                { id: 'all', label: 'ALL ACCESS', icon: '🍽️' },
                { id: 'veg', label: 'VEG ONLY', icon: '🥦' },
                { id: 'egg', label: 'EGGARIAN', icon: '🍳' },
                { id: 'non-veg', label: 'NON-VEG', icon: '🍗' },
              ].map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    s.dietModeBtn,
                    {
                      backgroundColor: dietPrefs.mode === opt.id ? goldColor : 'rgba(255,255,255,0.05)',
                      borderColor: dietPrefs.mode === opt.id ? goldColor : border,
                    },
                  ]}
                  onPress={() => saveDietPreferences({ ...dietPrefs, mode: opt.id as any })}
                >
                  <Text style={[s.dietModeBtnText, { color: dietPrefs.mode === opt.id ? '#000' : txt }]}>
                    {opt.icon} {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.divider} />

            <Text style={[s.dietLabel, { color: txtSec }]}>ALLERGY FLAGS</Text>
            <View style={s.allergyRow}>
              {([
                { key: 'nuts', label: '🥜 Nuts' },
                { key: 'dairy', label: '🥛 Dairy' },
                { key: 'gluten', label: '🌾 Gluten' },
              ] as const).map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    s.allergyBadge,
                    {
                      backgroundColor: dietPrefs[key] ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.05)',
                      borderColor: dietPrefs[key] ? '#EF4444' : border,
                    },
                  ]}
                  onPress={() => saveDietPreferences({ ...dietPrefs, [key]: !dietPrefs[key] })}
                >
                  <Text style={[s.allergyBadgeText, { color: dietPrefs[key] ? '#EF4444' : txt }]}>{label}</Text>
                </TouchableOpacity>
              ))}

              {dietPrefs.custom?.map((a, i) => (
                <View key={i} style={[s.allergyBadge, { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: '#EF4444' }]}>
                  <Text style={[s.allergyBadgeText, { color: '#EF4444' }]}>🚫 {a}</Text>
                  <TouchableOpacity onPress={() => handleRemoveAllergy(i)} style={{ marginLeft: 6 }}>
                    <Text style={{ color: '#EF4444', fontWeight: 'bold', fontSize: 10 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={s.allergyInputRow}>
              <TextInput
                value={customAllergy}
                onChangeText={setCustomAllergy}
                placeholder="Add other allergy (Soy, Shellfish...)"
                placeholderTextColor={isDark ? '#666' : '#999'}
                style={[s.allergyInput, { color: txt, borderColor: border, backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : '#FFF' }]}
              />
              <TouchableOpacity style={[s.allergyAddBtn, { backgroundColor: goldColor }]} onPress={handleAddAllergy}>
                <Text style={s.allergyAddBtnText}>ADD</Text>
              </TouchableOpacity>
            </View>

          </View>
        </StaggeredSection>

        {/* 🔔 Notifications */}
        <StaggeredSection delay={200} direction="up">
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>NOTIFICATIONS</Text>
            <TouchableOpacity style={[s.pushBtn, { borderColor: goldColor }]} onPress={handleEnablePush}>
              <Text style={[s.pushBtnText, { color: goldColor }]}>ENABLE PUSH</Text>
            </TouchableOpacity>
          </View>

          <View style={[s.notifCard, { backgroundColor: cardBg, borderColor: border }]}>
            {([
              { key: 'orders', emoji: '🛵', label: 'Order Updates', desc: 'Placed, accepted, delivered' },
              { key: 'surge', emoji: '⚡', label: 'Surge Alerts', desc: 'High demand zone notifications' },
              { key: 'promos', emoji: '🎁', label: 'Promotions', desc: 'Deals, rewards, Vault drops' },
            ] as const).map(({ key, emoji, label, desc }) => (
              <View key={key} style={s.notifRow}>
                <View style={s.notifLeft}>
                  <View style={[s.notifIconOuter, { backgroundColor: isDark ? '#1C1B1F' : '#F3F4F6' }]}>
                    <Text style={{ fontSize: 16 }}>{emoji}</Text>
                  </View>
                  <View>
                    <Text style={[s.notifLabel, { color: txt }]}>{label}</Text>
                    <Text style={[s.notifDesc, { color: txtSec }]}>{desc}</Text>
                  </View>
                </View>
                <Switch
                  value={notifPrefs[key]}
                  onValueChange={(val) => saveNotifPreferences({ ...notifPrefs, [key]: val })}
                  trackColor={{ false: '#767577', true: goldColor }}
                  thumbColor={notifPrefs[key] ? '#FFF' : '#f4f3f4'}
                />
              </View>
            ))}
          </View>
        </StaggeredSection>

        {/* 🏆 Nexus Achievements */}
        <StaggeredSection delay={220} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>NEXUS ACHIEVEMENTS</Text>
          <View style={[s.achievementsCard, { backgroundColor: cardBg, borderColor: border }]}>
            {user?.badges && user.badges.length > 0 ? (
              <View style={s.badgeGrid}>
                {user.badges.includes('Nexus Legend') && (
                  <View style={[s.badgeCard, { borderColor: '#F59E0B' }]}>
                    <Text style={s.badgeEmoji}>👑</Text>
                    <Text style={s.badgeTitle}>Nexus Legend</Text>
                    <Text style={s.badgeDesc}>50+ Orders Completed</Text>
                  </View>
                )}
                {user.badges.includes('Night Owl') && (
                  <View style={[s.badgeCard, { borderColor: '#6366F1' }]}>
                    <Text style={s.badgeEmoji}>🦉</Text>
                    <Text style={s.badgeTitle}>Night Owl</Text>
                    <Text style={s.badgeDesc}>Late Night Expert</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={s.emptyAchievements}>
                <Text style={[s.emptyAchievementsText, { color: txtSec }]}>No Achievements Unlocked Yet</Text>
                <View style={s.grayEmojis}>
                  <Text style={s.grayEmoji}>👑</Text>
                  <Text style={s.grayEmoji}>🦉</Text>
                  <Text style={s.grayEmoji}>🔥</Text>
                </View>
                <Text style={s.graySubText}>Keep ordering to unlock premium badges</Text>
              </View>
            )}

            <View style={s.achievementsFooter}>
              <View style={s.footerLeft}>
                <Text style={[s.footerLabel, { color: txtSec }]}>REWARDS EARNED</Text>
                <Text style={[s.footerVal, { color: goldColor }]}>{user?.zenPoints || 0} ZP</Text>
              </View>
              <View style={s.verticalDivider} />
              <View style={s.footerRight}>
                <Text style={[s.footerLabel, { color: txtSec }]}>MILESTONE PROGRESS</Text>
                <Text style={[s.footerVal, { color: txt }]}>{user?.totalOrders || 0} / 50 Orders</Text>
              </View>
            </View>
          </View>
        </StaggeredSection>

        {/* 🎟️ Gourmet Vault (Active Coupons) */}
        <StaggeredSection delay={240} direction="up">
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>GOURMET VAULT</Text>
            <TouchableOpacity onPress={() => router.push('/rewards')}>
              <Text style={[s.sectionAddBtn, { color: goldColor }]}>🎯 SPIN & WIN</Text>
            </TouchableOpacity>
          </View>
          {coupons.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.couponsScroll}>
              {coupons.map((cpn, i) => (
                <View key={i} style={[s.couponCard, { backgroundColor: isDark ? '#1C1917' : '#FFFDF5', borderColor: goldColor }]}>
                  <Text style={[s.couponType, { color: goldColor }]}>{cpn.type === 'FREEDEL' ? 'LOGISTICS' : 'GOURMET'}</Text>
                  <Text style={[s.couponHeader, { color: txt }]}>{cpn.type === 'FREEDEL' ? 'FREE DELIVERY' : 'DISCOUNT'}</Text>
                  <View style={s.couponCodeRow}>
                    <Text style={[s.couponCodeText, { color: goldColor }]}>{cpn.code}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        Clipboard.setString(cpn.code);
                        Alert.alert('Copied!', 'Coupon code copied to clipboard!');
                      }}
                      style={s.couponCopyBtn}
                    >
                      <Text style={s.couponCopyBtnText}>COPY</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={{ fontSize: 24, marginBottom: 8 }}>🎫</Text>
              <Text style={[s.emptyText, { color: txtSec }]}>Vault is Empty</Text>
              <Text style={[s.emptySubText, { color: txtSec, marginBottom: 12 }]}>Spin the wheel to earn exclusive rewards</Text>
              <TouchableOpacity
                style={{
                  backgroundColor: goldColor,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 12,
                }}
                onPress={() => router.push('/rewards')}
              >
                <Text style={{ color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>SPIN THE WHEEL</Text>
              </TouchableOpacity>
            </View>
          )}
        </StaggeredSection>

        {/* 🔗 Invite Friends */}
        <StaggeredSection delay={260} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>INVITE FRIENDS</Text>
          <View style={[s.referralCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[s.referralLabel, { color: txtSec }]}>YOUR REFERRAL CODE</Text>
            <View style={s.referralRow}>
              <Text style={[s.referralCode, { color: goldColor }]}>
                {user?.referralCode || `ZV-${(user?._id || user?.id || 'NEW50').slice(-5).toUpperCase()}`}
              </Text>
              <TouchableOpacity
                style={[s.referralCopyBtn, { backgroundColor: goldColor }]}
                onPress={() => {
                  const code = user?.referralCode || `ZV-${(user?._id || user?.id || 'NEW50').slice(-5).toUpperCase()}`;
                  Clipboard.setString(code);
                  Alert.alert('Referral Copied', 'Your referral code has been copied.');
                }}
              >
                <Text style={s.referralCopyText}>COPY</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.referralDesc, { color: txtSec }]}>
              Share this code — both of you earn <Text style={{ color: goldColor }}>50 ZenPoints</Text> when they place their first order.
            </Text>
          </View>
        </StaggeredSection>

        {/* 🎁 Send a Gift (Elite Perk) */}
        {user?.isElite && (
          <StaggeredSection delay={280} direction="up">
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>SEND A GIFT</Text>
            <View style={[s.giftCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[s.giftLabel, { color: txtSec }]}>GIFT A MEAL TO A FRIEND (ELITE PERK)</Text>
              <TextInput
                value={giftPhone}
                onChangeText={setGiftPhone}
                placeholder="Friend's phone number"
                placeholderTextColor={isDark ? '#666' : '#999'}
                keyboardType="phone-pad"
                style={[s.giftInput, { color: txt, borderColor: border }]}
              />
              <View style={s.giftButtonsRow}>
                {[50, 100, 200].map((amt) => (
                  <TouchableOpacity
                    key={amt}
                    style={[s.giftAmtBtn, { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: border }]}
                    onPress={() => handleSendGift(amt)}
                  >
                    <Text style={[s.giftAmtText, { color: goldColor }]}>₹{amt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.giftSubText}>3 gifts per month • Deducted from your wallet</Text>
            </View>
          </StaggeredSection>
        )}

        {/* 📊 Spending Dashboard */}
        <StaggeredSection delay={300} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>MY SPENDING</Text>
          {spendStats ? (
            <View style={s.spendingWrapper}>
              
              {/* Monthly Bar Chart */}
              <View style={[s.chartCard, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={[s.chartTitle, { color: txtSec }]}>LAST 6 MONTHS</Text>
                <View style={s.chartRow}>
                  {(() => {
                    const max = Math.max(...spendStats.monthlySpend.map((m: any) => m.total), 1);
                    return spendStats.monthlySpend.map((m: any, i: number) => {
                      const barHeight = Math.max(8, (m.total / max) * 70);
                      return (
                        <View key={i} style={s.chartBarContainer}>
                          <View
                            style={[
                              s.chartBar,
                              {
                                height: barHeight,
                                backgroundColor: i === spendStats.monthlySpend.length - 1 ? goldColor : 'rgba(255,255,255,0.1)',
                              },
                            ]}
                          />
                          <Text style={[s.chartBarMonth, { color: txtSec }]}>{m.month.split(' ')[0]}</Text>
                          {m.total > 0 && <Text style={[s.chartBarTotal, { color: txt }]}>₹{m.total}</Text>}
                        </View>
                      );
                    });
                  })()}
                </View>
              </View>

              {/* Top Items */}
              {spendStats.topItems && spendStats.topItems.length > 0 && (
                <View style={[s.topItemsCard, { backgroundColor: cardBg, borderColor: border }]}>
                  <Text style={[s.chartTitle, { color: txtSec }]}>MOST ORDERED</Text>
                  {spendStats.topItems.map((item: any, i: number) => (
                    <View key={i} style={s.topItemRow}>
                      <View style={s.topItemLeft}>
                        <Text style={{ fontSize: 14 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</Text>
                        <View style={{ marginLeft: 10 }}>
                          <Text style={[s.topItemName, { color: txt }]}>{item.name}</Text>
                          <Text style={[s.topItemCount, { color: txtSec }]}>{item.count}x ordered</Text>
                        </View>
                      </View>
                      <Text style={[s.topItemSpend, { color: goldColor }]}>₹{item.spend}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Stats Grid */}
              <View style={s.statsGridRow}>
                {[
                  { label: 'AVG ORDER', value: `₹${spendStats.avgOrderValue}`, emoji: '📦' },
                  { label: 'TOTAL ORDERS', value: spendStats.totalOrders, emoji: '🧾' },
                  { label: 'STREAK', value: `🔥 ${spendStats.currentStreak}d`, emoji: '⚡' },
                  { label: 'FAV RESTAURANT', value: spendStats.favoriteRestaurant?.split(' ')[0] || 'None', emoji: '🍽️' },
                ].map((stat, i) => (
                  <View key={i} style={[s.smallStatCard, { backgroundColor: cardBg, borderColor: border }]}>
                    <Text style={{ fontSize: 18, marginBottom: 4 }}>{stat.emoji}</Text>
                    <Text style={[s.smallStatVal, { color: txt }]} numberOfLines={1}>
                      {stat.value}
                    </Text>
                    <Text style={[s.smallStatLabel, { color: txtSec }]}>{stat.label}</Text>
                  </View>
                ))}
              </View>

            </View>
          ) : (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[s.emptyText, { color: txtSec }]}>Place your first order to see stats</Text>
            </View>
          )}
        </StaggeredSection>

        {/* 💬 Help & Support & About */}
        <StaggeredSection delay={320} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>HELP & SUPPORT</Text>
          <View style={s.supportGrid}>
            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={() => router.push('/support' as any)}>
              <Text style={{ fontSize: 20 }}>🎫</Text>
              <Text style={[s.supportBtnTitle, { color: goldColor }]}>SUPPORT TICKETS</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>File issues & track</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={() => setShowAbout(true)}>
              <Text style={{ fontSize: 20 }}>✨</Text>
              <Text style={[s.supportBtnTitle, { color: txt }]}>ABOUT ZENVY</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>Project Vision & info</Text>
            </TouchableOpacity>
          </View>
        </StaggeredSection>

        {/* Theme switch button */}
        <StaggeredSection delay={340} direction="up">
          <TouchableOpacity style={[s.themeBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={toggleTheme}>
            <View style={[s.notifIconOuter, { backgroundColor: isDark ? '#1C1B1F' : '#F3F4F6' }]}>
              <Text style={{ fontSize: 16 }}>{isDark ? '☀️' : '🌙'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.notifLabel, { color: txt }]}>{isDark ? 'LIGHT DISPLAY MODE' : 'DARK DISPLAY MODE'}</Text>
              <Text style={[s.notifDesc, { color: txtSec }]}>
                {isDark ? 'Toggle back to clean light visual modes' : 'Activate cinema gaming interfaces'}
              </Text>
            </View>
          </TouchableOpacity>
        </StaggeredSection>

        {/* Logout */}
        <StaggeredSection delay={360} direction="up">
          <TouchableOpacity style={[s.logoutBtn, { borderColor: '#EF4444' }]} onPress={async () => {
            await logout();
            router.replace('/login');
          }}>
            <Text style={s.logoutText}>SIGN OUT PROTOCOL</Text>
          </TouchableOpacity>
          <Text style={s.logoutSubText}>Sign out of your campus account safely</Text>
        </StaggeredSection>

      </ScrollView>

      {/* ─── MODAL: QR IDENTITY ─── */}
      <Modal visible={showQR} animationType="slide" transparent={true} onRequestClose={() => setShowQR(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: '#141416', borderColor: border }]}>
            <Text style={s.modalTitle}>ZENVY ID</Text>
            
            <View style={s.qrWrapper}>
              <View style={s.qrAvatarBox}>
                {user?.profileImage ? (
                  <Image source={{ uri: user.profileImage }} style={s.qrAvatarImg} />
                ) : (
                  <Text style={s.qrAvatarText}>{initials}</Text>
                )}
              </View>
              <View style={s.qrContainer}>
                <QRCode value={qrValue} size={160} backgroundColor="#ffffff" color="#0A0A0B" />
              </View>
            </View>

            <Text style={s.qrName}>{user?.name}</Text>
            <Text style={[s.qrCity, { color: goldColor }]}>ZENVY • {user?.city || 'AMARAVATHI'}</Text>
            <Text style={s.qrSubText}>Show this QR at campus events</Text>

            <TouchableOpacity style={[s.modalCloseBtn, { backgroundColor: goldColor }]} onPress={() => setShowQR(false)}>
              <Text style={s.modalCloseBtnText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── MODAL: EDIT PROFILE ─── */}
      <Modal visible={isEditing} animationType="slide" transparent={true} onRequestClose={() => setIsEditing(false)}>
        <View style={s.modalOverlay}>
          <ScrollView contentContainerStyle={s.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={[s.modalContent, { backgroundColor: '#141416', borderColor: border }]}>
              <Text style={s.modalTitle}>UPDATE PROFILE</Text>

              {/* Avatar pre-selectors */}
              <Text style={s.inputLabel}>CHOOSE PREMIUM AVATAR</Text>
              <View style={s.avatarSelectRow}>
                {PREMIUM_AVATARS.map((url, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => setEditProfileImage(url)}
                    style={[
                      s.avatarSelectBtn,
                      { borderColor: editProfileImage === url ? goldColor : 'transparent' },
                    ]}
                  >
                    <Image source={{ uri: url }} style={s.avatarSelectImg} />
                  </TouchableOpacity>
                ))}
              </View>

              {/* Custom Image URL */}
              <Text style={s.inputLabel}>OR PASTE AVATAR IMAGE URL</Text>
              <TextInput
                value={editProfileImage || ''}
                onChangeText={setEditProfileImage}
                placeholder="Paste direct HTTPS image link"
                placeholderTextColor="#555"
                style={s.modalInput}
              />

              {/* Name */}
              <Text style={s.inputLabel}>FULL NAME</Text>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                placeholder="Name"
                placeholderTextColor="#555"
                style={s.modalInput}
              />

              {/* Delivery Address Auto-complete */}
              <Text style={s.inputLabel}>DELIVERY ADDRESS</Text>
              <View style={{ zIndex: 99 }}>
                <TextInput
                  value={editAddress}
                  onChangeText={(text) => {
                    setEditAddress(text);
                    fetchAddressSuggestions(text);
                  }}
                  placeholder="SRM Hostel room, block name..."
                  placeholderTextColor="#555"
                  style={s.modalInput}
                />
                
                {showSuggestions && suggestions.length > 0 && (
                  <View style={s.suggestionsBox}>
                    {suggestions.map((item, i) => (
                      <TouchableOpacity
                        key={i}
                        onPress={() => handleSelectSuggestion(item)}
                        style={s.suggestionItem}
                      >
                        <Text style={s.suggestionText} numberOfLines={2}>
                          📍 {item.name ? `${item.name}, ` : ''}{item.display_name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* City */}
              <Text style={s.inputLabel}>CITY</Text>
              <TextInput
                value={editCity}
                onChangeText={setEditCity}
                placeholder="Amaravathi"
                placeholderTextColor="#555"
                style={s.modalInput}
              />

              <View style={s.modalActionsRow}>
                <TouchableOpacity style={s.modalCancelBtn} onPress={() => setIsEditing(false)}>
                  <Text style={s.modalCancelBtnText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.modalSaveBtn, { backgroundColor: goldColor }]} onPress={handleUpdateProfile}>
                  <Text style={s.modalSaveBtnText}>SAVE</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ─── MODAL: ADD ADDRESS ─── */}
      <Modal visible={addingAddress} animationType="slide" transparent={true} onRequestClose={() => setAddingAddress(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: '#141416', borderColor: border }]}>
            <Text style={s.modalTitle}>ADD NEW ADDRESS</Text>

            <Text style={s.inputLabel}>LABEL (E.G. HOSTEL ROOM, GATE 2)</Text>
            <TextInput
              value={newAddr.label}
              onChangeText={(text) => setNewAddr({ ...newAddr, label: text })}
              placeholder="Hostel Room A-204"
              placeholderTextColor="#555"
              style={s.modalInput}
            />

            <Text style={s.inputLabel}>FULL ADDRESS</Text>
            <TextInput
              value={newAddr.address}
              onChangeText={(text) => setNewAddr({ ...newAddr, address: text })}
              placeholder="SRM AP Campus Block, room details..."
              placeholderTextColor="#555"
              style={s.modalInput}
            />

            <Text style={s.inputLabel}>CITY</Text>
            <TextInput
              value={newAddr.city}
              onChangeText={(text) => setNewAddr({ ...newAddr, city: text })}
              placeholder="Amaravathi"
              placeholderTextColor="#555"
              style={s.modalInput}
            />

            <View style={s.modalActionsRow}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setAddingAddress(false)}>
                <Text style={s.modalCancelBtnText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalSaveBtn, { backgroundColor: goldColor }]} onPress={handleAddAddress}>
                <Text style={s.modalSaveBtnText}>SAVE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── MODAL: ABOUT US ─── */}
      <Modal visible={showAbout} animationType="slide" transparent={true} onRequestClose={() => setShowAbout(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: '#141416', borderColor: border }]}>
            <View style={s.aboutHeader}>
              <View style={[s.aboutLogo, { backgroundColor: goldColor }]}>
                <Text style={{ fontSize: 24 }}>⚡</Text>
              </View>
              <View>
                <Text style={[s.aboutTitle, { color: goldColor }]}>Project Zenvy</Text>
                <Text style={s.aboutSub}>Nexus Mobile Portal</Text>
              </View>
            </View>

            <Text style={s.aboutQuote}>
              &quot;Redefining campus logistics through cinematic design and surgical precision. Zenvy Nexus isn&apos;t just a delivery platform; it&apos;s the heartbeat of university commerce.&quot;
            </Text>

            <View style={s.aboutStatsRow}>
              <View style={s.aboutStatCol}>
                <Text style={s.aboutStatLabel}>VERSION</Text>
                <Text style={s.aboutStatVal}>2.4.0-STABLE</Text>
              </View>
              <View style={s.aboutStatCol}>
                <Text style={s.aboutStatLabel}>ARCHITECTURE</Text>
                <Text style={s.aboutStatVal}>NEXUS_V2</Text>
              </View>
            </View>

            <Text style={s.aboutFooter}>
              Designed & Developed by {'\n'}
              <Text style={{ color: goldColor }}>Shanmukesh Kunjam</Text>
            </Text>

            <TouchableOpacity style={s.aboutCloseBtn} onPress={() => setShowAbout(false)}>
              <Text style={s.aboutCloseText}>CLOSE INFO</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? 40 : 50,
  },
  profileCard: {
    marginHorizontal: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 28,
    borderWidth: 1.5,
    marginBottom: 20,
    ...SHADOWS.card,
  },
  profileCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  avatarOuterRing: {
    position: 'relative',
  },
  avatarRingGradient: {
    width: 88,
    height: 88,
    borderRadius: 44,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '900',
  },
  streakBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  streakBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
  },
  headerBadges: {
    alignItems: 'flex-end',
    gap: 8,
  },
  zenvyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...SHADOWS.goldGlow,
  },
  zenvyBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 2,
  },
  zenvyDots: {
    flexDirection: 'row',
    gap: 2,
  },
  zenvyDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  streakCapsule: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  streakCapsuleText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
  },
  name: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 4,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  tierText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.5,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  barcodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  barcodeLines: {
    flexDirection: 'row',
    gap: 2,
    height: 12,
    opacity: 0.6,
  },
  barcodeLine: {
    height: '100%',
  },
  barcodeText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  primaryAddressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    width: '100%',
    gap: 8,
    marginBottom: 16,
  },
  primaryAddressText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
  },
  editAddrText: {
    fontSize: 9,
    fontWeight: '900',
  },
  telemetryContainer: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginTop: 8,
  },
  telemetryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  telemetryItem: {
    flex: 1,
    alignItems: 'center',
  },
  telemetryBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  telemetryLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: '#888',
    marginBottom: 4,
  },
  telemetryVal: {
    fontSize: 18,
    fontWeight: '900',
  },
  progressContainer: {
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingTop: 12,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressTitle: {
    fontSize: 8,
    fontWeight: '900',
    color: '#888',
  },
  progressVal: {
    fontSize: 8,
    fontWeight: '900',
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionTitleText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2.5,
    borderLeftWidth: 3,
    borderLeftColor: '#C9A84C',
    paddingLeft: 12,
    marginVertical: 12,
    marginLeft: 16,
  },
  sectionAddBtn: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '800',
  },
  emptySubText: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 4,
  },
  savedAddressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  savedAddressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  savedAddressIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(201,168,76,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedAddressLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  savedAddressVal: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    flexShrink: 1,
  },
  deleteBtnText: {
    fontSize: 14,
    color: '#EF4444',
    paddingHorizontal: 8,
    fontWeight: '800',
  },
  dietCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  dietLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 10,
  },
  dietModeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  dietModeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  dietModeBtnText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 14,
  },
  allergyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  allergyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  allergyBadgeText: {
    fontSize: 9,
    fontWeight: '900',
  },
  allergyInputRow: {
    flexDirection: 'row',
    gap: 8,
    height: 40,
    marginTop: 8,
  },
  allergyInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 10,
    fontWeight: '600',
  },
  allergyAddBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allergyAddBtnText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
  },
  pushBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pushBtnText: {
    fontSize: 8,
    fontWeight: '900',
  },
  notifCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    gap: 16,
  },
  notifRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notifLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  notifIconOuter: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifLabel: {
    fontSize: 12,
    fontWeight: '900',
  },
  notifDesc: {
    fontSize: 8,
    fontWeight: '600',
    marginTop: 2,
  },
  achievementsCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  badgeGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  badgeCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
    padding: 14,
  },
  badgeEmoji: {
    fontSize: 22,
    marginBottom: 6,
  },
  badgeTitle: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  badgeDesc: {
    fontSize: 7,
    fontWeight: '700',
    color: '#888',
    marginTop: 2,
  },
  emptyAchievements: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  emptyAchievementsText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  grayEmojis: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 10,
    opacity: 0.15,
  },
  grayEmoji: {
    fontSize: 24,
  },
  graySubText: {
    fontSize: 8,
    color: '#666',
    fontWeight: '600',
  },
  achievementsFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginTop: 14,
    paddingTop: 12,
  },
  footerLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  footerRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  verticalDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  footerLabel: {
    fontSize: 7,
    fontWeight: '900',
    marginBottom: 2,
  },
  footerVal: {
    fontSize: 13,
    fontWeight: '900',
  },
  couponsScroll: {
    paddingLeft: 16,
    marginBottom: 20,
  },
  couponCard: {
    width: 220,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginRight: 12,
  },
  couponType: {
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 2,
  },
  couponHeader: {
    fontSize: 15,
    fontWeight: '900',
    marginVertical: 6,
  },
  couponCodeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 6,
  },
  couponCodeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  couponCopyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  couponCopyBtnText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#FFF',
  },
  referralCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  referralLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  referralRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  referralCode: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  referralCopyBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  referralCopyText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
  },
  referralDesc: {
    fontSize: 8,
    fontWeight: '600',
    lineHeight: 11,
  },
  giftCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  giftLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  giftInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  giftButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  giftAmtBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  giftAmtText: {
    fontSize: 12,
    fontWeight: '900',
  },
  giftSubText: {
    fontSize: 7,
    color: '#666',
    fontWeight: '800',
    textAlign: 'center',
  },
  spendingWrapper: {
    marginHorizontal: 16,
    gap: 12,
    marginBottom: 20,
  },
  chartCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  chartTitle: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 14,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 100,
    paddingTop: 10,
  },
  chartBarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  chartBar: {
    width: 14,
    borderRadius: 4,
  },
  chartBarMonth: {
    fontSize: 7,
    fontWeight: '900',
    marginTop: 6,
  },
  chartBarTotal: {
    fontSize: 6,
    fontWeight: '900',
    marginTop: 2,
  },
  topItemsCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  topItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  topItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topItemName: {
    fontSize: 11,
    fontWeight: '900',
  },
  topItemCount: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 1,
  },
  topItemSpend: {
    fontSize: 11,
    fontWeight: '900',
  },
  statsGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallStatCard: {
    width: '48%',
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  smallStatVal: {
    fontSize: 12,
    fontWeight: '900',
  },
  smallStatLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: '#888',
    marginTop: 2,
  },
  supportGrid: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  supportBtn: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    padding: 16,
  },
  supportBtnTitle: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 8,
  },
  supportBtnDesc: {
    fontSize: 7,
    fontWeight: '600',
    marginTop: 2,
  },
  themeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    marginBottom: 20,
  },
  logoutBtn: {
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  logoutText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#EF4444',
    letterSpacing: 3,
    textAlign: 'center',
  },
  logoutSubText: {
    fontSize: 8,
    color: '#666',
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 40,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    width: '100%',
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 30,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 2,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: '#888',
    letterSpacing: 1.5,
    alignSelf: 'flex-start',
    marginTop: 12,
    marginBottom: 6,
  },
  modalInput: {
    width: '100%',
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 12,
    color: '#FFF',
    fontWeight: '600',
    marginBottom: 8,
  },
  suggestionsBox: {
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    width: '100%',
    maxHeight: 150,
    position: 'absolute',
    top: 52,
    zIndex: 9999,
    overflow: 'scroll',
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  suggestionText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    width: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFF',
  },
  modalSaveBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveBtnText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
  },

  // QR Modal specifically
  qrWrapper: {
    alignItems: 'center',
    marginVertical: 20,
    position: 'relative',
  },
  qrAvatarBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#C9A84C',
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
    top: -24,
    zIndex: 10,
  },
  qrAvatarImg: {
    width: '100%',
    height: '100%',
  },
  qrAvatarText: {
    fontSize: 16,
    fontWeight: '900',
  },
  qrContainer: {
    padding: 16,
    backgroundColor: '#FFF',
    borderRadius: 20,
    marginTop: 20,
  },
  qrName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFF',
    marginTop: 10,
  },
  qrCity: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.5,
    marginTop: 4,
  },
  qrSubText: {
    fontSize: 8,
    color: '#888',
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 20,
  },
  modalCloseBtn: {
    width: '100%',
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtnText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
  },

  // Avatar select
  avatarSelectRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  avatarSelectBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    overflow: 'hidden',
  },
  avatarSelectImg: {
    width: '100%',
    height: '100%',
  },

  // About Modal specifically
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  aboutLogo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  aboutSub: {
    fontSize: 8,
    fontWeight: '800',
    color: '#888',
    letterSpacing: 2,
  },
  aboutQuote: {
    fontSize: 11,
    fontWeight: '600',
    fontStyle: 'italic',
    color: '#CCC',
    lineHeight: 16,
    marginVertical: 12,
    textAlign: 'left',
  },
  aboutStatsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginVertical: 14,
  },
  aboutStatCol: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  aboutStatLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: '#888',
    marginBottom: 4,
  },
  aboutStatVal: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFF',
  },
  aboutFooter: {
    fontSize: 9,
    color: '#888',
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 14,
    marginVertical: 16,
  },
  aboutCloseBtn: {
    width: '100%',
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutCloseText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFF',
  },
});
