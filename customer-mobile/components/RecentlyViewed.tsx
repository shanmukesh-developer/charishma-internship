import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
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

  useEffect(() => {
    const load = async () => {
      try {
        const existing = await AsyncStorage.getItem(STORAGE_KEY);
        if (existing) {
          setItems(JSON.parse(existing));
        }
      } catch (e) {
        console.error(e);
      }
    };
    load();
  }, []);

  // Re-load whenever the component is focused (e.g. navigating back)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const existing = await AsyncStorage.getItem(STORAGE_KEY);
        if (existing) {
          const parsed = JSON.parse(existing);
          if (parsed.length !== items.length) {
            setItems(parsed);
          }
        }
      } catch (err) {
        console.error('[RECENTLY_VIEWED_LOAD_ERROR]', err);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [items.length]);

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
          <Text style={s.sectionLabel}>MEMORY CACHE</Text>
          <Text style={[s.sectionTitle, { color: txt }]}>Recently Visited</Text>
        </View>
        <TouchableOpacity onPress={handleClear} style={s.clearBtn}>
          <Text style={[s.clearText, { color: txtSec }]}>CLEAR HISTORY</Text>
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
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.red,
    letterSpacing: 3,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  clearBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
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
    fontSize: 9,
    fontWeight: '900',
    color: '#fff',
    textTransform: 'uppercase',
  },
});
