import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Image, Dimensions, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useCart } from '../context/CartContext';
import DopaminePressable, { CardPressable, ActionPressable } from './DopaminePressable';

const { width: SW } = Dimensions.get('window');
const CARD_WIDTH = (SW - 44) / 2;

interface NexusExplorerProps {
  restaurants: any[];
  activeCategory: string;
  onSelectItem: (restaurantId: string) => void;
}

export default function NexusExplorer({ restaurants, activeCategory, onSelectItem }: NexusExplorerProps) {
  const router = useRouter();
  const { isDark } = useTheme();
  const { addToCart } = useCart();
  const [activeFilter, setActiveFilter] = useState<'all' | 'veg'>('all');
  const [activeSort, setActiveSort] = useState<'recommended' | 'rating' | 'fastest'>('recommended');
  const [sortValue, setSortValue] = useState<'default' | 'low' | 'high'>('default');
  const [favorites, setFavorites] = useState<string[]>([]);

  const toggleFavorite = (id: string) => {
    setFavorites(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const filteredItems = useMemo(() => {
    // Collect all items from all restaurants
    const allItems = restaurants.flatMap(res => 
      (res.menu || []).map((item: any) => {
        const isVeg = item.isVegetarian === true || 
                      String(item.isVegetarian).toLowerCase() === 'true' || 
                      Number(item.isVegetarian) === 1 || 
                      (item.tags || []).includes('veg') || 
                      (item.tags || []).includes('fruits');

        return {
          ...item,
          isVegetarian: isVeg,
          restaurantName: res.name,
          restaurantId: res._id || res.id,
          rating: Number(res.rating) || 4.2,
        };
      })
    );

    return allItems.filter(item => {
      const matchesCategory = (item.category || '').toLowerCase().includes(activeCategory.toLowerCase()) || 
                             (item.tags || []).some((t: string) => t.toLowerCase().includes(activeCategory.toLowerCase())) ||
                             (item.name || '').toLowerCase().includes(activeCategory.toLowerCase());
      
      const matchesFilter = activeFilter === 'all' || (activeFilter === 'veg' && item.isVegetarian);

      return matchesCategory && matchesFilter;
    }).sort((a, b) => {
      if (sortValue === 'low') return (Number(a.price) || 0) - (Number(b.price) || 0);
      if (sortValue === 'high') return (Number(b.price) || 0) - (Number(a.price) || 0);
      
      if (activeSort === 'rating') {
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      return 0;
    });
  }, [restaurants, activeCategory, activeFilter, activeSort, sortValue]);

  const bg = isDark ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDark ? COLORS.bgCard : COLORS.bgLightCard;
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;

  return (
    <View style={s.container}>
      {/* HUD Controller */}
      <View style={s.hud}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hudScroll}>
          {/* Pure Veg / All */}
          <DopaminePressable 
            style={[s.hudBtn, activeFilter === 'all' ? s.hudBtnActive : {}]} 
            onPress={() => setActiveFilter('all')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudEmoji, activeFilter === 'all' ? s.hudTextActive : {}]}>✨</Text>
            <Text style={[s.hudLabel, activeFilter === 'all' ? s.hudTextActive : {}]}>ALL</Text>
          </DopaminePressable>
          <DopaminePressable 
            style={[s.hudBtn, activeFilter === 'veg' ? s.hudBtnActive : {}]} 
            onPress={() => setActiveFilter('veg')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudEmoji, activeFilter === 'veg' ? s.hudTextActive : {}]}>🥗</Text>
            <Text style={[s.hudLabel, activeFilter === 'veg' ? s.hudTextActive : {}]}>PURE VEG</Text>
          </DopaminePressable>

          <View style={s.divider} />

          {/* Sort: REC / TOP / FAST */}
          <DopaminePressable 
            style={[s.hudBtn, activeSort === 'recommended' ? s.hudBtnActive : {}]} 
            onPress={() => setActiveSort('recommended')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, activeSort === 'recommended' ? s.hudTextActive : {}]}>REC</Text>
          </DopaminePressable>
          <DopaminePressable 
            style={[s.hudBtn, activeSort === 'rating' ? s.hudBtnActive : {}]} 
            onPress={() => setActiveSort('rating')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, activeSort === 'rating' ? s.hudTextActive : {}]}>TOP</Text>
          </DopaminePressable>
          <DopaminePressable 
            style={[s.hudBtn, activeSort === 'fastest' ? s.hudBtnActive : {}]} 
            onPress={() => setActiveSort('fastest')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, activeSort === 'fastest' ? s.hudTextActive : {}]}>FAST</Text>
          </DopaminePressable>

          <View style={s.divider} />

          {/* Price Filters */}
          <DopaminePressable 
            style={[s.hudBtn, sortValue === 'low' ? s.hudBtnActive : {}]} 
            onPress={() => setSortValue(sortValue === 'low' ? 'default' : 'low')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, sortValue === 'low' ? s.hudTextActive : {}]}>PRICE: LOW</Text>
          </DopaminePressable>
          <DopaminePressable 
            style={[s.hudBtn, sortValue === 'high' ? s.hudBtnActive : {}]} 
            onPress={() => setSortValue(sortValue === 'high' ? 'default' : 'high')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, sortValue === 'high' ? s.hudTextActive : {}]}>PRICE: HIGH</Text>
          </DopaminePressable>
        </ScrollView>
      </View>

      {/* Grid */}
      {filteredItems.length === 0 ? (
        <View style={s.empty}>
          <Text style={[s.emptyText, { color: txtSec }]}>No items found in this category.</Text>
        </View>
      ) : (
        <View style={s.grid}>
          {filteredItems.slice(0, 4).map((item, idx) => {
            const itemId = item._id || item.id || idx.toString();
            const isFav = favorites.includes(itemId);
            const img = item.image || item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300';
            return (
              <CardPressable 
                key={itemId} 
                style={[s.card, { backgroundColor: cardBg }]}
                onPress={() => router.push(`/products/${itemId}` as any)}
                sound="click"
              >
                <View style={s.imgContainer} pointerEvents="box-none">
                  <Image source={{ uri: img }} style={s.img} />
                  <DopaminePressable 
                    style={s.heartBtn} 
                    onPress={() => toggleFavorite(itemId)}
                    sound="click"
                    activeScale={0.8}
                  >
                    <Text style={{ fontSize: 12 }}>{isFav ? '❤️' : '🖤'}</Text>
                  </DopaminePressable>

                  <View style={s.vegIndicator}>
                    <View style={[s.vegOuter, { borderColor: item.isVegetarian ? '#22C55E' : '#EF4444' }]}>
                      <View style={[s.vegInner, { backgroundColor: item.isVegetarian ? '#22C55E' : '#EF4444' }]} />
                    </View>
                  </View>
                </View>

                <View style={s.info}>
                  <View style={s.titleRow}>
                    <Text style={[s.name, { color: txt }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.price}>₹{item.price}</Text>
                  </View>
                  <Text style={[s.restaurantName, { color: txtSec }]} numberOfLines={1}>{item.restaurantName}</Text>
                  
                  <ActionPressable 
                    style={s.addBtn}
                    onPress={() => router.push(`/products/${itemId}` as any)}
                    sound="click"
                  >
                    <Text style={s.addBtnText}>ADD +</Text>
                  </ActionPressable>
                </View>
              </CardPressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { paddingBottom: 16 },
  hud: { marginBottom: 16 },
  hudScroll: { paddingHorizontal: 16, alignItems: 'center', gap: 8 },
  hudBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#1A1A1C', 
    borderWidth: 1, 
    borderColor: 'rgba(201,168,76,0.3)', 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: 20,
    gap: 4
  },
  hudBtnActive: { 
    backgroundColor: COLORS.red, 
    borderColor: COLORS.gold 
  },
  hudEmoji: { fontSize: 10, color: COLORS.textSecondary },
  hudLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1, color: COLORS.textSecondary },
  hudTextActive: { color: '#fff' },
  divider: { width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 4 },
  grid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    paddingHorizontal: 16, 
    justifyContent: 'space-between',
  },
  card: { 
    width: '48.5%', 
    borderRadius: 20, 
    overflow: 'hidden', 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 12,
  },
  imgContainer: { 
    width: '100%', 
    aspectRatio: 1, 
    position: 'relative' 
  },
  img: { 
    width: '100%', 
    height: '100%', 
    resizeMode: 'cover' 
  },
  heartBtn: { 
    position: 'absolute', 
    top: 8, 
    right: 8, 
    width: 24, 
    height: 24, 
    borderRadius: 12, 
    backgroundColor: 'rgba(255,255,255,0.9)', 
    alignItems: 'center', 
    justifyContent: 'center',
    ...SHADOWS.card
  },
  vegIndicator: { 
    position: 'absolute', 
    bottom: 8, 
    left: 8, 
    backgroundColor: 'rgba(255,255,255,0.9)', 
    padding: 3, 
    borderRadius: 4 
  },
  vegOuter: { 
    width: 10, 
    height: 10, 
    borderWidth: 1, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  vegInner: { 
    width: 5, 
    height: 5, 
    borderRadius: 2.5 
  },
  info: { padding: 10 },
  titleRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    gap: 4 
  },
  name: { 
    flex: 1, 
    fontSize: 11, 
    fontWeight: '800' 
  },
  price: { 
    fontSize: 11, 
    fontWeight: '900', 
    color: COLORS.red 
  },
  restaurantName: { 
    fontSize: 8, 
    fontWeight: '700', 
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  addBtn: {
    backgroundColor: COLORS.gold,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8
  },
  addBtnText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1
  },
  empty: { padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 10, fontWeight: '700' }
});
