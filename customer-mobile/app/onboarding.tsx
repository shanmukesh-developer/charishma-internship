import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Image,
  FlatList,
  Animated,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS } from '../constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Slide Data Model ──
export interface SlideData {
  id: string;
  tag: string;
  tagColor: string;
  headline: string;
  subheadline: string;
  punchline: string;
  howToUsePointers: {
    /** Ionicons name shown before the pointer. */
    arrow: string;
    pointerText: string;
    targetLocation: string;
  }[];
  heroImage: string;
  studentPerk: string;
}

export const ONBOARDING_SLIDES: SlideData[] = [
  {
    id: 'food',
    tag: 'Food delivery',
    tagColor: '#EF4444',
    headline: 'Hot meals to your room',
    subheadline: 'Order from campus canteens and nearby restaurants between 6 am and 9 pm, delivered to your hostel block.',
    punchline: 'Pay with cash on delivery or your Zenvy Wallet',
    heroImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&q=85',
    howToUsePointers: [
      { arrow: 'restaurant-outline', pointerText: 'Browse stores, dishes and today’s offers', targetLocation: 'Home' },
      { arrow: 'basket-outline', pointerText: 'Check your items and place the order', targetLocation: 'Basket' },
    ],
    studentPerk: 'Share your delivery PIN with the rider only when you have your order',
  },
  {
    id: 'essentials',
    tag: 'Groceries and essentials',
    tagColor: '#10B981',
    headline: 'Daily essentials, delivered',
    subheadline: 'Snacks, groceries and daily needs from the campus store, or send a quick list and a Zenvy shopper buys it for you.',
    punchline: 'Your shopping list, delivered',
    heroImage: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&q=85',
    howToUsePointers: [
      { arrow: 'storefront-outline', pointerText: 'Shop the campus store by category', targetLocation: 'Others, Food and groceries' },
      { arrow: 'list-outline', pointerText: 'Send a quick list like “2 maggi, 1 atta” with Mega basket', targetLocation: 'Others, Food and groceries' },
    ],
    studentPerk: 'Pay by cash on delivery when it arrives',
  },
  {
    id: 'services',
    tag: 'Services, stays and rides',
    tagColor: '#8B5CF6',
    headline: 'Repairs, PG stays and rides',
    subheadline: 'Book repairs and prints, explore student PGs, share rides, rent a vehicle and find campus events.',
    punchline: 'Everything campus life needs, in one app',
    heroImage: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=85',
    howToUsePointers: [
      { arrow: 'construct-outline', pointerText: 'Book repairs, prints and other services', targetLocation: 'Others, Tech and repairs' },
      { arrow: 'business-outline', pointerText: 'Explore PGs and request a booking', targetLocation: 'Others, PG stays' },
      { arrow: 'bicycle-outline', pointerText: 'Share a ride, rent a vehicle or get event passes', targetLocation: 'Others, Co-Ride, Rentals, Campus events' },
    ],
    studentPerk: 'Pick a section at the top of the Others tab',
  },
  {
    id: 'campus',
    tag: 'Campus',
    tagColor: '#D4AF7A',
    headline: 'Your campus in one place',
    subheadline: 'Chat with classmates, follow Pulse, join Spaces, ask in the Forum and get help through Tasks.',
    punchline: 'For verified students of your campus',
    heroImage: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=1200&q=85',
    howToUsePointers: [
      { arrow: 'people-outline', pointerText: 'Chats, Friends, Around campus and Me', targetLocation: 'Home, Campus button' },
      { arrow: 'shield-checkmark-outline', pointerText: 'Verify your college once to unlock Campus', targetLocation: 'Campus, Me' },
    ],
    studentPerk: 'Lost something? Post it in Around campus, Lost and found',
  },
  {
    id: 'orders-profile',
    tag: 'Orders and profile',
    tagColor: '#F59E0B',
    headline: 'Track orders and get help',
    subheadline: 'Follow every order live, see past orders and service bookings, and manage your Wallet and notifications.',
    punchline: 'Help is one tap away',
    heroImage: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=1200&q=85',
    howToUsePointers: [
      { arrow: 'receipt-outline', pointerText: 'Track live orders and see your history', targetLocation: 'Orders' },
      { arrow: 'person-circle-outline', pointerText: 'Wallet, notifications, Help and FAQ, and support', targetLocation: 'Profile' },
    ],
    studentPerk: 'Choose which notifications you get in Profile',
  },
];

// ── Reusable OnboardingSlide Subcomponent ──
export function OnboardingSlide({ item }: { item: SlideData }) {
  return (
    // Scrolls vertically on short phones so the copy never hides behind the bottom buttons.
    <ScrollView style={s.slideContainer} contentContainerStyle={{ paddingBottom: 10 }} showsVerticalScrollIndicator={false} bounces={false}>
      {/* Visual Hero Card with Dynamic Gradient & Pointer Overlays */}
      <View style={s.heroCardWrapper}>
        <Image source={{ uri: item.heroImage }} style={s.heroImage} />
        <LinearGradient
          colors={['rgba(10,10,12,0.15)', 'rgba(10,10,12,0.6)', 'rgba(10,10,12,0.98)']}
          locations={[0.2, 0.65, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Floating Youth Tag Badge */}
        <View style={[s.badgeTag, { backgroundColor: `${item.tagColor}22`, borderColor: `${item.tagColor}70` }]}>
          <Text style={[s.badgeTagText, { color: item.tagColor }]}>{item.tag}</Text>
        </View>

        {/* Punchline Micro-Pill Overlay */}
        <View style={s.punchlinePill}>
          <Text style={s.punchlineText}>{item.punchline}</Text>
        </View>
      </View>

      {/* Copy Content Area */}
      <View style={s.copySection}>
        <Text style={s.headline}>{item.headline}</Text>
        <Text style={s.subheadline}>{item.subheadline}</Text>

        {/* Actionable "How-To-Use" Pointer Guidance Cards */}
        <View style={s.pointersContainer}>
          {item.howToUsePointers.map((p, idx) => (
            <View key={idx} style={[s.pointerCard, { borderColor: `${item.tagColor}35` }]}>
              <Ionicons name={p.arrow as any} size={17} color={item.tagColor} style={s.pointerArrow} />
              <View style={{ flex: 1 }}>
                <Text style={s.pointerDesc}>{p.pointerText}</Text>
                <View style={s.locationBadgeRow}>
                  <Text style={s.locationLabel}>Find it in </Text>
                  <Text style={[s.locationValue, { color: item.tagColor }]}>{p.targetLocation}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Student Perk Micro-Callout */}
        <View style={s.perkRow}>
          <Text style={s.perkText}>{item.studentPerk}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

// ── Main OnboardingScreen Component ──
export default function OnboardingScreen() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const isLastSlide = currentIndex === ONBOARDING_SLIDES.length - 1;

  const finishingRef = useRef(false);
  const handleFinishOnboarding = async (destination: '/register' | '/login') => {
    // A quick double tap (Skip + CTA) must not stack two auth screens.
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      await AsyncStorage.setItem('has_seen_onboarding', 'true');
      await AsyncStorage.setItem('zenvy_onboarded', 'true');
    } catch (e) {
      console.warn('Failed to persist onboarding state', e);
    }
    router.replace(destination as any);
  };

  const handleNext = () => {
    if (currentIndex < ONBOARDING_SLIDES.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setCurrentIndex(nextIndex);
    } else {
      handleFinishOnboarding('/register');
    }
  };

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { useNativeDriver: false }
  );

  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index || 0);
    }
  }, []);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  return (
    <View style={s.screen}>
      <SafeAreaView style={s.safeContainer}>
        {/* Top Header: Campus Brand & Skip Button */}
        <View style={s.topHeader}>
          <View style={s.brandGroup}>
            <View style={s.brandIconBox}>
              <Text style={s.brandIconText}>Z</Text>
            </View>
            <View>
              <Text style={s.brandName}>ZENVY</Text>
              <Text style={s.brandSubtitle}>Campus app</Text>
            </View>
          </View>

          {/* Step Pill & Skip Action */}
          <View style={s.topRightGroup}>
            <View style={s.stepCounterPill}>
              <Text style={s.stepCounterText}>
                {currentIndex + 1} / {ONBOARDING_SLIDES.length}
              </Text>
            </View>

            <TouchableOpacity
              style={s.skipButton}
              onPress={() => handleFinishOnboarding('/register')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Skip the introduction"
            >
              <Text style={s.skipButtonText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Swipeable Carousel */}
        <FlatList
          ref={flatListRef}
          data={ONBOARDING_SLIDES}
          style={{ flex: 1 }}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          onScroll={handleScroll}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          renderItem={({ item }) => <OnboardingSlide item={item} />}
        />

        {/* Bottom Bar: Animated Dots + Action CTAs */}
        <View style={s.bottomSection}>
          {/* Animated Progress Indicators */}
          <View style={s.dotsContainer}>
            {ONBOARDING_SLIDES.map((slide, index) => {
              const inputRange = [
                (index - 1) * SCREEN_WIDTH,
                index * SCREEN_WIDTH,
                (index + 1) * SCREEN_WIDTH,
              ];

              const dotWidth = scrollX.interpolate({
                inputRange,
                outputRange: [6, 26, 6],
                extrapolate: 'clamp',
              });

              const opacity = scrollX.interpolate({
                inputRange,
                outputRange: [0.3, 1, 0.3],
                extrapolate: 'clamp',
              });

              return (
                <Animated.View
                  key={slide.id}
                  style={[
                    s.animatedDot,
                    {
                      width: dotWidth,
                      opacity,
                      backgroundColor: slide.tagColor,
                    },
                  ]}
                />
              );
            })}
          </View>

          {/* Primary Action Button (Next or Final Get Started) */}
          <TouchableOpacity
            style={s.primaryButton}
            onPress={handleNext}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={isLastSlide ? ['#EF4444', '#DC2626'] : ['#2563EB', '#1D4ED8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.buttonGradient}
            >
              <Text style={s.buttonText}>
                {isLastSlide ? 'Create your account' : 'Next'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Existing Account Footer Link */}
          <View style={s.footerSignInRow}>
            <Text style={s.footerPromptText}>Already registered on campus?</Text>
            <TouchableOpacity onPress={() => handleFinishOnboarding('/login')} activeOpacity={0.7}>
              <Text style={s.footerSignInLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#090A0E',
  },
  safeContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14, // SafeAreaView (safe-area-context) already adds the status-bar inset
    paddingBottom: 8,
    zIndex: 10,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.redGlow,
  },
  brandIconText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '900',
  },
  brandName: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  brandSubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  topRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepCounterPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  stepCounterText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  skipButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  skipButtonText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // Slide Layout
  slideContainer: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 20,
  },
  heroCardWrapper: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.28,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    position: 'relative',
    marginTop: 4,
  },
  heroImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  badgeTag: {
    position: 'absolute',
    top: 14,
    left: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: 1,
  },
  badgeTagText: {
    fontSize: 12,
    fontWeight: '800',
  },
  punchlinePill: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  punchlineText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '800',
  },

  // Copy Area
  copySection: {
    marginTop: 12,
    paddingHorizontal: 2,
  },
  headline: {
    color: '#FFF',
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 0.2,
    lineHeight: 27,
    marginBottom: 4,
  },
  subheadline: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    marginBottom: 10,
  },

  // Pointers / How to use
  pointersContainer: {
    gap: 6,
    marginBottom: 10,
  },
  pointerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    borderWidth: 1,
  },
  pointerArrow: {
    marginTop: 1,
  },
  pointerDesc: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  locationBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 2,
  },
  locationLabel: {
    color: '#8B93A3',
    fontSize: 12,
    fontWeight: '600',
  },
  locationValue: {
    fontSize: 12,
    fontWeight: '800',
  },

  perkRow: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  perkText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },

  // Bottom Section
  bottomSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  animatedDot: {
    height: 6,
    borderRadius: 3,
  },
  primaryButton: {
    borderRadius: 16,
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  buttonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  footerSignInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerPromptText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '600',
  },
  footerSignInLink: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '800',
  },
});
