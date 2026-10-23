import React, { useState, useMemo, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useCartActions } from '../context/CartContext';
import { useDietary } from '../context/DietaryContext';
import DopaminePressable, { CardPressable, ActionPressable } from './DopaminePressable';
import SafeImage from './SafeImage';
import { storeEtaMins } from '../utils/storeEta';

const { width: SW } = Dimensions.get('window');

interface NexusExplorerProps {
  restaurants: any[];
  activeCategory: string;
  onSelectItem: (restaurantId: string) => void;
}

// Owner: tapping a Popular dishes category shows only its top 4 dishes.
const TOP_N = 4;

export default function NexusExplorer({ restaurants, activeCategory, onSelectItem }: NexusExplorerProps) {
  const router = useRouter();
  const { isDark } = useTheme();
  const { addToCart } = useCartActions();
  const { dietMode, isItemAllowed } = useDietary();
  const [activeFilter, setActiveFilter] = useState<'all' | 'veg'>('all');
  const [activeSort, setActiveSort] = useState<'recommended' | 'rating' | 'fastest'>('recommended');
  const [sortValue, setSortValue] = useState<'default' | 'low' | 'high'>('default');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});

  // Sync local filter with global dietary mode
  useEffect(() => {
    if (dietMode === 'veg' || dietMode === 'eggarian') {
      setActiveFilter('veg');
    } else {
      setActiveFilter('all');
    }
  }, [dietMode]);

  // Dish hearts persist under their own key ('zenvy_favorites' holds restaurant favourites)
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem('zenvy_fav_dishes').then(v => {
      if (!alive || !v) return;
      try { const arr = JSON.parse(v); if (Array.isArray(arr)) setFavorites(arr); } catch {}
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // A new Classic starts collapsed again
  useEffect(() => { setShowAll(false); }, [activeCategory]);

  // Track "ADDED ✓" reset timers so none fire after unmount
  const addedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { addedTimers.current.forEach(clearTimeout); addedTimers.current = []; }, []);

  const toggleFavorite = (id: string) => {
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id];
      AsyncStorage.setItem('zenvy_fav_dishes', JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const handleAddToCart = async (item: any, e?: any) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const itemId = item.id || item._id;
    if (!item.storeOpen) {
      Alert.alert('Kitchen closed', `${item.restaurantName || 'This kitchen'} isn't taking orders right now. Please check back later.`);
      return;
    }
    try {
      const added = await addToCart({
        id: itemId,
        // Full menu name, so the basket line keeps the variant (e.g. "Chicken Biryani (Half)")
        name: item.name || item.cleanName,
        price: Number(item.price) || 0,
        image: item.image || item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300',
        restaurantId: item.restaurantId,
        restaurantName: item.restaurantName,
      });
      // The cart may ask "Replace basket?" or hit the per-item limit; only confirm a real add
      if (added === false) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAddedIds(prev => ({ ...prev, [itemId]: true }));
      addedTimers.current.push(setTimeout(() => {
        setAddedIds(prev => ({ ...prev, [itemId]: false }));
      }, 1800));
    } catch (err: any) {
      Alert.alert("Couldn't add item", err?.message && err.message !== 'MULTIPLE_RESTAURANTS'
        ? err.message
        : 'Please try again in a moment.');
    }
  };

  const filteredItems = useMemo(() => {
    const catKey = (activeCategory || 'biryani').toLowerCase();
    
    // 1. Filter out non-food establishments (laundry, pharmacy, rentals)
    const foodRestaurants = (restaurants || []).filter(r => {
      const name = (r.name || '').toLowerCase();
      const vt = (r.vendorType || '').toUpperCase();
      if (name.includes('laundry') || name.includes('pharmacy') || name.includes('rental') || name.includes('fleet') || name.includes('clean')) return false;
      if (vt === 'LAUNDRY' || vt === 'PHARMACY' || vt === 'RENTAL' || vt === 'SERVICES') return false;
      return true;
    });

    // 2. Collect matching dishes
    const collectedFromRestaurants = foodRestaurants.flatMap(res => 
      (res.menu || []).filter((item: any) => item && item.isAvailable !== false && (item._id || item.id)).map((item: any, idx: number) => {
        const isVeg = item.isVegetarian === true || 
                      String(item.isVegetarian).toLowerCase() === 'true' || 
                      Number(item.isVegetarian) === 1 || 
                      (Array.isArray(item.tags) && (item.tags.includes('veg') || item.tags.includes('fruits')));

        const cleanName = (item.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        const safeId = item._id || item.id || `${res._id || res.id || 'res'}-${idx}-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

        return {
          ...item,
          id: safeId,
          _id: safeId,
          name: (item.name || '').trim() || cleanName,
          cleanName,
          isVegetarian: isVeg,
          restaurantName: res.name,
          restaurantId: res._id || res.id,
          rating: Number(res.rating) || 0,
          deliveryTime: storeEtaMins(res),
          storeOpen: res.isOpen !== false,
        };
      })
    ).filter(item => {
      const itemCat = (item.category || '').toLowerCase();
      const itemName = (item.cleanName || item.name || '').toLowerCase();
      const itemTags = (Array.isArray(item.tags) ? item.tags : []).map((t: any) => String(t || '').toLowerCase());

      // Strict category matching
      if (catKey === 'biryani') return itemCat.includes('biryani') || itemName.includes('biryani') || itemTags.includes('biryani');
      if (catKey === 'pizza') return itemCat.includes('pizza') || itemName.includes('pizza') || itemTags.includes('pizza');
      if (catKey === 'burgers') return itemCat.includes('burger') || itemName.includes('burger') || itemTags.includes('burgers');
      if (catKey === 'south indian') return itemCat.includes('south') || itemName.includes('dosa') || itemName.includes('idli') || itemName.includes('vada') || itemTags.includes('south-indian');
      if (catKey === 'drinks') return itemCat.includes('drink') || itemCat.includes('juice') || itemName.includes('cooler') || itemName.includes('brew') || itemName.includes('mojito') || itemName.includes('shake');
      if (catKey === 'chinese') return itemCat.includes('chinese') || itemName.includes('noodles') || itemName.includes('rice') || itemName.includes('momos') || itemName.includes('manchurian');
      const matchAny = (kws: string[]) => kws.some(k => itemCat.includes(k) || itemName.includes(k) || itemTags.includes(k));
      if (catKey === 'momos & rolls') return matchAny(['momo', 'roll', 'frankie', 'wrap']);
      if (catKey === 'shakes') return matchAny(['shake', 'milkshake', 'smoothie', 'frappe']);
      if (catKey === 'bakery') return matchAny(['bakery', 'cake', 'pastry', 'bread', 'puff', 'cookie', 'muffin', 'brownie']);
      if (catKey === 'gym fuel') return matchAny(['protein', 'oats', 'salad', 'sprout', 'healthy', 'egg white', 'gym']);

      return itemCat.includes(catKey) || itemName.includes(catKey);
    });

    // Only real dishes from real restaurants — an empty result shows the empty state
    const itemsSource = collectedFromRestaurants;

    // Deduplicate repeated dishes within one kitchen only: the same dish from two kitchens is two real choices
    const uniqueByName = new Map<string, any>();
    itemsSource.forEach(item => {
      // Full name (not cleanName): Half / Full variants of one dish are separate choices.
      const dishName = (item.name || item.cleanName || '').toLowerCase().trim();
      if (!dishName) return;
      const key = `${item.restaurantId}|${dishName}`;
      if (!uniqueByName.has(key)) {
        uniqueByName.set(key, item);
      } else {
        const existing = uniqueByName.get(key);
        if ((item.rating || 0) > (existing.rating || 0)) {
          uniqueByName.set(key, item);
        }
      }
    });
    const dedupedItems = Array.from(uniqueByName.values());

    return dedupedItems.filter(item => {
      const matchesFilter = activeFilter === 'all' || (activeFilter === 'veg' && item.isVegetarian);
      const matchesDiet = isItemAllowed(item);
      return matchesFilter && matchesDiet;
    }).sort((a, b) => {
      if (sortValue === 'low') return (Number(a.price) || 0) - (Number(b.price) || 0);
      if (sortValue === 'high') return (Number(b.price) || 0) - (Number(a.price) || 0);
      
      if (activeSort === 'rating') {
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      if (activeSort === 'fastest') {
        return (Number(a.deliveryTime) || 999) - (Number(b.deliveryTime) || 999);
      }
      // Recommended: the best-rated dishes first, so the top 4 are the ones worth showing.
      return (Number(b.rating) || 0) - (Number(a.rating) || 0);
    });
  }, [restaurants, activeCategory, activeFilter, activeSort, sortValue, isItemAllowed]);

  const cardBg = isDark ? '#18181B' : '#FFFFFF';
  const cardBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const txt = isDark ? '#FFFFFF' : '#111827';
  const txtSec = isDark ? '#A1A1AA' : '#6B7280';

  // Signature Black & Pink (Coral) Color Tokens
  const PINK_ACTIVE = '#EF4F5F'; // Signature vibrant coral-pink
  const BLACK_PILL = '#18181B';  // Signature obsidian black

  return (
    <View style={s.container}>
      {/* HUD Controller */}
      <View style={s.hud}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hudScroll}>
          {/* ALL Filter */}
          <DopaminePressable 
            style={[
              s.hudBtn,
              {
                backgroundColor: activeFilter === 'all' ? PINK_ACTIVE : BLACK_PILL,
                borderColor: activeFilter === 'all' ? '#F43F5E' : 'transparent',
              }
            ]} 
            onPress={() => setActiveFilter('all')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={{ fontSize: 12 }}>✨</Text>
            <Text style={[s.hudLabel, { color: '#FFFFFF' }]}>
              ALL
            </Text>
          </DopaminePressable>

          {/* Pure Veg Filter */}
          <DopaminePressable 
            style={[
              s.hudBtn,
              {
                backgroundColor: activeFilter === 'veg' ? '#10B981' : BLACK_PILL,
                borderColor: activeFilter === 'veg' ? '#059669' : 'transparent',
              }
            ]} 
            onPress={() => setActiveFilter('veg')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={{ fontSize: 12 }}>🥗</Text>
            <Text style={[s.hudLabel, { color: '#FFFFFF' }]}>
              PURE VEG
            </Text>
          </DopaminePressable>

          <View style={[s.divider, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />

          {/* Sort: REC / TOP / FAST */}
          <DopaminePressable 
            style={[
              s.hudBtn,
              {
                backgroundColor: activeSort === 'recommended' ? PINK_ACTIVE : BLACK_PILL,
                borderColor: activeSort === 'recommended' ? '#F43F5E' : 'transparent',
              }
            ]} 
            onPress={() => setActiveSort('recommended')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, { color: '#FFFFFF' }]}>
              REC
            </Text>
          </DopaminePressable>

          <DopaminePressable 
            style={[
              s.hudBtn,
              {
                backgroundColor: activeSort === 'rating' ? PINK_ACTIVE : BLACK_PILL,
                borderColor: activeSort === 'rating' ? '#F43F5E' : 'transparent',
              }
            ]} 
            onPress={() => setActiveSort('rating')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, { color: '#FFFFFF' }]}>
              TOP
            </Text>
          </DopaminePressable>

          <DopaminePressable 
            style={[
              s.hudBtn,
              {
                backgroundColor: activeSort === 'fastest' ? PINK_ACTIVE : BLACK_PILL,
                borderColor: activeSort === 'fastest' ? '#F43F5E' : 'transparent',
              }
            ]} 
            onPress={() => setActiveSort('fastest')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, { color: '#FFFFFF' }]}>
              FAST
            </Text>
          </DopaminePressable>

          <View style={[s.divider, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />

          {/* Price Filters */}
          <DopaminePressable 
            style={[
              s.hudBtn,
              {
                backgroundColor: sortValue === 'low' ? PINK_ACTIVE : BLACK_PILL,
                borderColor: sortValue === 'low' ? '#F43F5E' : 'transparent',
              }
            ]} 
            onPress={() => setSortValue(sortValue === 'low' ? 'default' : 'low')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, { color: '#FFFFFF' }]}>
              PRICE: LOW
            </Text>
          </DopaminePressable>

          <DopaminePressable 
            style={[
              s.hudBtn,
              {
                backgroundColor: sortValue === 'high' ? PINK_ACTIVE : BLACK_PILL,
                borderColor: sortValue === 'high' ? '#F43F5E' : 'transparent',
              }
            ]} 
            onPress={() => setSortValue(sortValue === 'high' ? 'default' : 'high')}
            sound="tabSwitch"
            activeScale={0.93}
          >
            <Text style={[s.hudLabel, { color: '#FFFFFF' }]}>
              PRICE: HIGH
            </Text>
          </DopaminePressable>
        </ScrollView>
      </View>

      {/* Grid */}
      {filteredItems.length === 0 ? (
        <View style={s.empty}>
          <Text style={[s.emptyText, { color: txtSec }]}>No {activeCategory ? activeCategory.toLowerCase() : 'matching'} dishes on campus menus right now. Browse all restaurants below.</Text>
        </View>
      ) : (
        <>
          <View style={s.grid}>
            {filteredItems.slice(0, TOP_N).map((item, idx) => {
              const itemId = item._id || item.id || idx.toString();
              const isFav = favorites.includes(itemId);
              const isAdded = !!addedIds[itemId];
              const img = item.image || item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300';
              return (
                <CardPressable 
                  key={itemId} 
                  style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}
                  onPress={() => router.push(`/products/${itemId}` as any)}
                  sound="click"
                >
                  <View style={s.imgContainer} pointerEvents="box-none">
                    <SafeImage source={{ uri: img }} style={s.img} />
                    <DopaminePressable 
                      style={s.heartBtn} 
                      onPress={() => toggleFavorite(itemId)}
                      sound="click"
                      activeScale={0.8}
                    >
                      <Text style={{ fontSize: 12 }}>{isFav ? '❤️' : '🤍'}</Text>
                    </DopaminePressable>

                    <View style={s.vegIndicator}>
                      <View style={[s.vegOuter, { borderColor: item.isVegetarian ? '#22C55E' : '#EF4444' }]}>
                        <View style={[s.vegInner, { backgroundColor: item.isVegetarian ? '#22C55E' : '#EF4444' }]} />
                      </View>
                    </View>
                  </View>

                  <View style={s.info}>
                    <View style={s.titleRow}>
                      <Text style={[s.name, { color: txt }]} numberOfLines={1}>{item.name || item.cleanName}</Text>
                      <Text style={s.price}>₹{item.price}</Text>
                    </View>
                    <TouchableOpacity 
                      activeOpacity={0.7}
                      onPress={() => {
                        if (item.restaurantId && onSelectItem) {
                          onSelectItem(item.restaurantId);
                        }
                      }}
                    >
                      <Text style={[s.restaurantName, { color: txtSec }]} numberOfLines={1}>{item.restaurantName}</Text>
                    </TouchableOpacity>
                    
                    <ActionPressable 
                      style={[
                        s.addBtn, 
                        { backgroundColor: isAdded ? '#10B981' : (item.storeOpen ? '#C8A265' : (isDark ? '#3F3F46' : '#E5E7EB')) }
                      ]}
                      onPress={() => handleAddToCart(item)}
                      sound="tabSwitch"
                    >
                      <Text style={[s.addBtnText, { color: isAdded ? '#FFFFFF' : (item.storeOpen ? '#000000' : txtSec), fontWeight: '900' }]}>
                        {isAdded ? 'ADDED ✓' : (item.storeOpen ? 'ADD +' : 'CLOSED')}
                      </Text>
                    </ActionPressable>
                  </View>
                </CardPressable>
              );
            })}
          </View>

          {false && (
            <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
              <TouchableOpacity
                style={{
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
                  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F9FAFB',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={() => setShowAll(!showAll)}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 12, fontWeight: '900', color: isDark ? '#F59E0B' : '#B45309', letterSpacing: 1 }}>
                  {showAll ? 'COLLAPSE CATEGORY ▲' : `VIEW ALL ${filteredItems.length} DISHES ▼`}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
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
    borderWidth: 0, 
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderRadius: 22,
    gap: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  hudLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  divider: { width: 1, height: 16, marginHorizontal: 4 },
  grid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    paddingHorizontal: 16, 
    justifyContent: 'space-between',
  },
  card: { 
    width: '48.5%', 
    borderRadius: 18, 
    overflow: 'hidden', 
    borderWidth: 1, 
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  imgContainer: { 
    width: '100%', 
    height: 120, 
    backgroundColor: '#F3F4F6', 
    position: 'relative' 
  },
  img: { width: '100%', height: '100%', resizeMode: 'cover' },
  heartBtn: { 
    position: 'absolute', 
    top: 8, 
    right: 8, 
    width: 28, 
    height: 28, 
    borderRadius: 14, 
    backgroundColor: 'rgba(255,255,255,0.9)', 
    alignItems: 'center', 
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  vegIndicator: { position: 'absolute', bottom: 8, left: 8 },
  vegOuter: { width: 14, height: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 3 },
  vegInner: { width: 6, height: 6, borderRadius: 3 },
  info: { padding: 10 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  name: { fontSize: 12, fontWeight: '800', flex: 1, marginRight: 4 },
  price: { fontSize: 13, fontWeight: '900', color: COLORS.red },
  restaurantName: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  addBtn: { 
    paddingVertical: 7, 
    borderRadius: 10, 
    alignItems: 'center', 
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  addBtnText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
});
