import { useIsFocused } from 'expo-router';
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COLORS, surfaceLift, LIGHT_HAIRLINE } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

interface TickerItem {
  id: string;
  icon: string;
  tag: string;
  tagColor: string;
  text: string;
  timeAgo?: string;
}

// Evergreen, factual tips only (no invented live stats or counts)
const DEFAULT_TICKER_ITEMS: TickerItem[] = [
  { id: '1', icon: '🍛', tag: 'TOP PICK', tagColor: '#F59E0B', text: 'Tap a cuisine below to see campus dishes' },
  { id: '2', icon: '🛵', tag: 'TRACKING', tagColor: '#10B981', text: 'Track your rider live from the Orders tab' },
  { id: '3', icon: '⏰', tag: 'HOURS', tagColor: '#8B5CF6', text: 'Delivered daily at 12:30 PM, 4:30 PM and 8:30 PM' },
  { id: '4', icon: '💵', tag: 'PAYMENTS', tagColor: '#3B82F6', text: 'Pay with Cash on Delivery or your ZenWe Wallet' },
  { id: '5', icon: '🎉', tag: 'SAVER', tagColor: '#EF4444', text: 'Free delivery with 200+ ZenWe Points or a Platinum+ badge' },
];

export default function CampusLiveTicker() {
  const { isDark } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // Paused while the Home tab is hidden (tabs stay mounted)
  const focused = useIsFocused();

  // Pulse animation for the live indicator
  useEffect(() => {
    if (!focused) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [focused]);

  // Auto-cycle ticker items with smooth animation
  useEffect(() => {
    if (!focused) return;
    let alive = true;
    const interval = setInterval(() => {
      // Animate out
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: -8,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (!alive) return;
        setCurrentIndex((prev) => (prev + 1) % DEFAULT_TICKER_ITEMS.length);
        slideAnim.setValue(8);
        // Animate in
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }, 4000);

    return () => { alive = false; clearInterval(interval); };
  }, [focused]);

  const currentItem = DEFAULT_TICKER_ITEMS[currentIndex];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.98)',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : LIGHT_HAIRLINE,
        },
        surfaceLift(isDark, true),
      ]}
    >
      {/* Live Badge */}
      <View style={styles.liveBadge}>
        <Animated.View
          style={[
            styles.liveDot,
            {
              backgroundColor: currentItem.tagColor,
              opacity: pulseAnim,
            },
          ]}
        />
        <Text style={[styles.tagText, { color: currentItem.tagColor }]}>
          {currentItem.tag}
        </Text>
      </View>

      {/* Animated Text Content */}
      <Animated.View
        style={[
          styles.textWrapper,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <Text style={styles.icon}>{currentItem.icon}</Text>
        <Text
          numberOfLines={1}
          style={[
            styles.tickerText,
            { color: isDark ? COLORS.textPrimary : COLORS.textDark },
          ]}
        >
          {currentItem.text}
        </Text>
      </Animated.View>

      {/* Time indicator */}
      {currentItem.timeAgo && (
        <View style={styles.timeBadge}>
          <Text style={[styles.timeText, { color: isDark ? COLORS.textMuted : '#9CA3AF' }]}>
            {currentItem.timeAgo}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    borderRightWidth: 1,
    borderRightColor: 'rgba(150, 150, 150, 0.2)',
    marginRight: 8,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 13,
    marginRight: 6,
  },
  tickerText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  timeBadge: {
    marginLeft: 6,
    paddingLeft: 6,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
