import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Modal,
  Platform
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useSWRJson } from '../utils/swrCache';

const { width: SW } = Dimensions.get('window');

interface ServicePillar {
  id: string;
  icon: string;
  title: string;
  category: string;
  tagline: string;
  howToAccess: string;
  keyFeatures: string[];
  image: string;
  accentColor: string;
}

// Factual copy only: every line describes something the app really does today.
const CAMPUS_SERVICES_MAP: ServicePillar[] = [
  {
    id: 'food',
    icon: '🍔',
    title: 'Canteen & Food Delivery',
    category: 'FOOD & DINING',
    tagline: 'Campus kitchens delivered to your hostel',
    howToAccess: 'Home tab ➔ pick a restaurant or a cuisine under Popular dishes.',
    keyFeatures: [
      'Real menus and prices from campus kitchens',
      'Ordering open 6 AM – 9 PM, Cash on Delivery or ZCS Wallet',
      'Live order status and a Delivery PIN only you can share'
    ],
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80',
    accentColor: '#EF4444',
  },
  {
    id: 'grocery',
    icon: '🛒',
    title: 'Kirana & shopping list',
    category: 'GROCERIES & DAILY NEEDS',
    tagline: 'Snacks, staples and hostel essentials',
    howToAccess: 'Others tab ➔ "Food & groceries", or Home ➔ Shopping list for a custom list.',
    keyFeatures: [
      'Noodles, snacks, drinks and daily essentials',
      'Shopping list: a rider shops your list and sends the real bill',
      'You approve the bill before you pay'
    ],
    image: 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=600&q=80',
    accentColor: '#10B981',
  },
  {
    id: 'laundry',
    icon: '🧺',
    title: 'Laundry & Ironing',
    category: 'HOUSEKEEPING',
    tagline: 'Book a wash, dry clean or ironing pickup',
    howToAccess: 'Others tab ➔ "Tech & Repairs" ➔ "Wash, Dry Clean & Ironing".',
    keyFeatures: [
      'Pick a service and see its price before booking',
      'Doorstep pickup from your hostel',
      'The partner calls you before pickup'
    ],
    image: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?w=600&q=80',
    accentColor: '#3B82F6',
  },
  {
    id: 'pharmacy',
    icon: '💊',
    title: 'Pharmacy Essentials',
    category: 'HEALTHCARE',
    tagline: 'Basic over-the-counter care, delivered',
    howToAccess: 'Others tab ➔ "Food & groceries" ➔ search for medicine & first-aid.',
    keyFeatures: [
      'First-aid and everyday health items',
      'Same Cash on Delivery or Wallet checkout',
      'For emergencies, contact campus medical staff first'
    ],
    image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600&q=80',
    accentColor: '#EC4899',
  },
  {
    id: 'pg',
    icon: '🏢',
    title: 'PG & Student Stays',
    category: 'ACCOMMODATION',
    tagline: 'Browse PGs and rooms near campus',
    howToAccess: 'Others tab ➔ "PG Stays".',
    keyFeatures: [
      'Rooms, rent and amenities listed by each PG',
      'Book a room right in the app'
    ],
    image: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80',
    accentColor: '#06B6D4',
  },
  {
    id: 'coride',
    icon: '🏍️',
    title: 'Co-Ride for Students',
    category: 'CAMPUS TRANSIT',
    tagline: 'Share a ride with students going your way',
    howToAccess: 'Others tab ➔ "Co-Ride" ➔ post or join a ride.',
    keyFeatures: [
      'Post a trip or join one',
      'The rider approves who hops on',
      'Share the fuel cost with your co-riders'
    ],
    image: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=600&q=80',
    accentColor: '#EAB308',
  },
  {
    id: 'rewards',
    icon: '🎁',
    title: 'Rewards & Daily Deals',
    category: 'PERKS & LOYALTY',
    tagline: 'ZCS Points, spins and daily deals',
    howToAccess: 'Others tab ➔ "Deals & Spin", or Home ➔ Daily Deals.',
    keyFeatures: [
      'Every 2 delivered orders earn a spin',
      'Daily deals give a coupon valid until midnight',
      '200+ ZCS Points unlock free delivery'
    ],
    image: 'https://images.unsplash.com/photo-1596451190630-186aff535bf2?w=600&q=80',
    accentColor: '#EC4899',
  }
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function CampusServicesMapModal({ visible, onClose }: Props) {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const [selectedPillar, setSelectedPillar] = useState<string>('food');

  const bg = isDark ? '#141416' : '#FFFFFF';
  const cardBg = isDark ? '#1E1E22' : '#F8FAFC';
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';

  // Only sections that are switched on (GET /api/config/sections): Co-Ride shows once it is confirmed
  // live; PG unless the server says it is off.
  const sectionsSWR = useSWRJson<{ sections?: Record<string, { live?: boolean }> }>('/api/config/sections', { freshMs: 60 * 1000 });
  const sec = sectionsSWR.data?.sections;
  const pillars = CAMPUS_SERVICES_MAP.filter((p) => (p.id !== 'coride' || sec?.coride?.live === true) && (p.id !== 'pg' || sec?.pg?.live !== false));
  const activePillar = pillars.find(p => p.id === selectedPillar) || pillars[0];

  const handleGoToSignup = () => {
    onClose();
    router.push('/register' as any);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={[s.sheetContainer, { backgroundColor: bg, borderColor: border }]}>
          {/* Header Handle */}
          <View style={s.handle} />

          {/* Top Header */}
          <View style={[s.topHeader, { borderBottomColor: border }]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: txt }}>
                  Campus Services Guide 🗺️
                </Text>
                <View style={s.liveBadge}>
                  <Text style={s.liveBadgeText}>8 SERVICES</Text>
                </View>
              </View>
              <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', marginTop: 2 }}>
                Everything you need for effortless campus life
              </Text>
            </View>
            <TouchableOpacity style={[s.closeBtn, { backgroundColor: isDark ? '#2A2A2E' : '#F1F5F9' }]} onPress={onClose}>
              <Ionicons name="close" size={20} color={txt} />
            </TouchableOpacity>
          </View>

          {/* Service Pillar Category Chips */}
          <View style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {pillars.map((item) => {
                const active = selectedPillar === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      s.chip,
                      {
                        backgroundColor: active ? item.accentColor : (isDark ? '#222226' : '#F1F5F9'),
                        borderColor: active ? item.accentColor : border,
                      }
                    ]}
                    onPress={() => setSelectedPillar(item.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 13, marginRight: 5 }}>{item.icon}</Text>
                    <Text style={[s.chipText, { color: active ? '#FFF' : txtSec }]}>
                      {item.title.split(' ')[0]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Main Detail Content */}
          <ScrollView style={{ flex: 1, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
            {/* Active Service Showcase Card */}
            <View style={[s.detailCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Image source={{ uri: activePillar.image }} style={s.pillarImage} />
              
              <View style={s.pillarCardContent}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={[s.pillarCategory, { color: activePillar.accentColor }]}>
                    {activePillar.category}
                  </Text>
                  <View style={{ backgroundColor: `${activePillar.accentColor}20`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ color: activePillar.accentColor, fontSize: 12, fontWeight: '900' }}>
                      On ZCS
                    </Text>
                  </View>
                </View>

                <Text style={[s.pillarTitle, { color: txt }]}>
                  {activePillar.icon} {activePillar.title}
                </Text>
                <Text style={[s.pillarTagline, { color: txtSec }]}>
                  {activePillar.tagline}
                </Text>

                {/* How to Access Box */}
                <View style={[s.howToBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#EFF6FF', borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#BFDBFE' }]}>
                  <Text style={[s.howToLabel, { color: activePillar.accentColor }]}>
                    📍 HOW TO ACCESS IN THE APP:
                  </Text>
                  <Text style={[s.howToText, { color: txt }]}>
                    {activePillar.howToAccess}
                  </Text>
                </View>

                {/* Key Features List */}
                <Text style={[s.featuresLabel, { color: txtSec }]}>
                  WHAT'S INCLUDED:
                </Text>
                {activePillar.keyFeatures.map((feat, idx) => (
                  <View key={idx} style={s.featureRow}>
                    <Ionicons name="checkmark-circle" size={15} color={activePillar.accentColor} />
                    <Text style={[s.featureText, { color: txt }]}>{feat}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Quick Summary Grid */}
            <View style={s.allServicesSummary}>
              <Text style={[s.summaryHeader, { color: txtSec }]}>
                COMPLETE PLATFORM MAP AT A GLANCE
              </Text>
              <View style={s.gridContainer}>
                {pillars.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      s.gridItem,
                      {
                        backgroundColor: cardBg,
                        borderColor: selectedPillar === item.id ? item.accentColor : border,
                        borderWidth: selectedPillar === item.id ? 1.5 : 1
                      }
                    ]}
                    onPress={() => setSelectedPillar(item.id)}
                  >
                    <Text style={{ fontSize: 20 }}>{item.icon}</Text>
                    <Text style={[s.gridItemTitle, { color: txt }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[s.gridItemCat, { color: item.accentColor }]} numberOfLines={1}>
                      {item.category.split(' ')[0]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Bottom Action Footer (Takes to Signup Page) */}
          <View style={[s.footer, { backgroundColor: bg, borderTopColor: border }]}>
            <TouchableOpacity
              style={s.signupCtaBtn}
              onPress={handleGoToSignup}
              activeOpacity={0.88}
            >
              <LinearGradient
                colors={['#EF4444', '#DC2626']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.signupBtnGradient}
              >
                <Text style={s.signupBtnText}>CREATE ACCOUNT & GET STARTED 🚀</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    height: '92%',
    borderWidth: 1,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.4)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  liveBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  liveBadgeText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '900',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  detailCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 6,
    marginBottom: 16,
    ...SHADOWS.card,
  },
  pillarImage: {
    width: '100%',
    height: 150,
    resizeMode: 'cover',
  },
  pillarCardContent: {
    padding: 16,
  },
  pillarCategory: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  pillarTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  pillarTagline: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 12,
  },
  howToBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  howToLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  howToText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  featuresLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  featureText: {
    fontSize: 12,
    fontWeight: '600',
  },
  allServicesSummary: {
    marginBottom: 20,
  },
  summaryHeader: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridItem: {
    width: (SW - 48) / 2,
    padding: 12,
    borderRadius: 14,
    alignItems: 'center',
    gap: 4,
  },
  gridItemTitle: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  gridItemCat: {
    fontSize: 12,
    fontWeight: '900',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: 1,
  },
  signupCtaBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    ...SHADOWS.redGlow,
  },
  signupBtnGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signupBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
