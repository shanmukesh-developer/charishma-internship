import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from './SafeImage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useFocusEffect } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

const { width: SW } = Dimensions.get('window');
const CARD_SIZE = 130;

const STORAGE_KEY = 'zenvy_recently_viewed';

export interface ViewedItem {
  id: string;
  name: string;
  restaurantName?: string;
  price?: number;
  image: string;
  type: 'product' | 'restaurant';
}

export async function saveRecentlyViewed(item: ViewedItem) {
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY);
    let items: ViewedItem[] = existing ? JSON.parse(existing) : [];
    if (!Array.isArray(items)) items = [];

    // Remove if already exists and push to front
    items = items.filter(i => i.id !== item.id);
    items.unshift(item);

    // Keep only last 10
    items = items.slice(0, 10);

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Error saving recently viewed:', e);
  }
}

export default function RecentlyViewed() {
  const router = useRouter();
  const { isDark } = useTheme();
  const [items, setItems] = useState<ViewedItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      const load = async () => {
        try {
          const existing = await AsyncStorage.getItem(STORAGE_KEY);
          if (!isMounted) return;
          const parsed = existing ? JSON.parse(existing) : [];
          setItems(Array.isArray(parsed) ? parsed.filter((i: any) => i && i.id && i.name) : []);
        } catch (e) {
          console.error(e);
        }
      };
      load();
      return () => { isMounted = false; };
    }, [])
  );

  if (items.length === 0) return null;

  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const cardBg = isDark ? COLORS.bgCard : COLORS.bgLightCard;
  const border = isDark ? COLORS.borderDark : COLORS.borderLight;

  const handleClear = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setItems([]);
  };

  return (
    <View style={s.container}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.sectionLabel}>Recently viewed</Text>
          <Text style={[s.sectionTitle, { color: txt }]}>Pick up where you left off</Text>
        </View>
        <TouchableOpacity onPress={handleClear} style={s.clearBtn}>
          <Text style={[s.clearText, { color: txtSec }]}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {items.map((item, idx) => (
          <TouchableOpacity
            key={item.id + idx}
            style={[s.card, { backgroundColor: cardBg, borderColor: border }]}
            activeOpacity={0.85}
            onPress={() => {
              const { playSound } = require('../utils/sounds');
              playSound(item.type === 'restaurant' ? 'premiumRestaurantTransition' : 'click');
              if (item.type === 'product') {
                router.push(`/products/${item.id}` as any);
              } else {
                router.push(`/restaurant/${item.id}` as any);
              }
            }}
          >
            <Image
              source={{ uri: item.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200' }}
              style={s.cardImg}
            />
            {/* Gradient overlay */}
            <View style={s.cardOverlay} />
            <View style={s.cardContent}>
              <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.red,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  clearBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearText: {
    fontSize: 12,
    fontWeight: '800',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    ...SHADOWS.card,
  },
  cardImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  cardContent: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
  },
  cardName: {
    fontSize: 12,
    fontWeight: '900',
    color: '#fff',
  },
});
