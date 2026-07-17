import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image, Dimensions, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, RADIUS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../constants/api';
import { useCart } from '../context/CartContext';

const GROCERY_ITEMS = [
  { id: 'cat-atta-1', name: 'Aashirvaad Shudh Chakki Atta', price: 260, originalPrice: 290, weight: '5 kg', image: 'https://images.unsplash.com/photo-1574316071802-0d684efa7bf5?w=200&q=80', isVeg: true, discount: '10% OFF' },
  { id: 'cat-atta-2', name: 'Organic Ragi Flour', price: 75, originalPrice: 90, weight: '1 kg', image: 'https://images.unsplash.com/photo-1574316071802-0d684efa7bf5?w=200&q=80', isVeg: true, discount: '16% OFF' },
  { id: 'cat-atta-3', name: 'Fortune Premium Besan', price: 85, originalPrice: 95, weight: '1 kg', image: 'https://images.unsplash.com/photo-1574316071802-0d684efa7bf5?w=200&q=80', isVeg: true },
  { id: 'cat-dal-1', name: 'Tata Sampann Toor Dal', price: 159, originalPrice: 180, weight: '1 kg', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&q=80', isVeg: true, discount: '11% OFF' },
  { id: 'cat-dal-2', name: 'Organic Kabuli Chana', price: 120, originalPrice: 145, weight: '1 kg', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&q=80', isVeg: true, discount: '17% OFF' },
  { id: 'cat-dal-3', name: 'Premium Moong Dal Split', price: 140, originalPrice: 160, weight: '1 kg', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&q=80', isVeg: true },
  { id: 'cat-oil-1', name: 'Saffola Gold Blended Oil', price: 165, originalPrice: 195, weight: '1 L', image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=200&q=80', isVeg: true, discount: '15% OFF' },
  { id: 'cat-oil-2', name: 'Amul Pure Cow Ghee Tin', price: 680, originalPrice: 720, weight: '1 L', image: 'https://images.unsplash.com/photo-1589733901241-5e391270dd96?w=200&q=80', isVeg: true, discount: '5% OFF' },
  { id: 'cat-oil-3', name: 'Fortune Kachi Ghani Mustard Oil', price: 190, originalPrice: 210, weight: '1 L', image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=200&q=80', isVeg: true },
  { id: 'cat-rice-1', name: 'India Gate Basmati Rice Feast', price: 499, originalPrice: 550, weight: '5 kg', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&q=80', isVeg: true, discount: '9% OFF' },
  { id: 'cat-rice-2', name: 'Double Horse Poha Thick', price: 45, originalPrice: 55, weight: '500 g', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&q=80', isVeg: true },
  { id: 'bb-cardamom', name: 'Fresh Cardamom Green', price: 95, originalPrice: 120, weight: '20 g', image: 'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=200&q=80', isVeg: true, discount: '20% OFF' },
  { id: 'cat-spice-1', name: 'Everest Turmeric Powder', price: 28, originalPrice: 35, weight: '100 g', image: 'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=200&q=80', isVeg: true },
  { id: 'bb-honey', name: '24 MANTRA ORGANIC Wild Honey', price: 380, originalPrice: 380, weight: '500 g', image: 'https://images.unsplash.com/photo-1587049352846-4a222e784d3e?w=200&q=80', isVeg: true },
  { id: 'bb-lemon', name: 'Fresh Lemon', price: 10, originalPrice: 27, weight: '3 pcs', image: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=200&q=80', isVeg: true, discount: '63% OFF' },
  { id: 'bb-garlic', name: 'Fresh Garlic/Velluli', price: 65, originalPrice: 114, weight: '250 g', image: 'https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=200&q=80', isVeg: true, discount: '43% OFF' },
  { id: 'bb-ginger', name: 'Fresh Ginger', price: 35, originalPrice: 50, weight: '100 g', image: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=200&q=80', isVeg: true, discount: '30% OFF' }
];

const { width: SW } = Dimensions.get('window');

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  searchMode?: 'food' | 'grocery';
}

export default function SearchOverlay({ isOpen, onClose, searchMode = 'food' }: SearchOverlayProps) {
  const router = useRouter();
  const { isDark } = useTheme();
  const { cart, addToCart, updateQuantity } = useCart();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ restaurants: any[]; items: any[]; isTrending?: boolean }>({
    restaurants: [],
    items: [],
  });

  const inputRef = useRef<TextInput>(null);

  // Debounced search fetch
  useEffect(() => {
    if (!isOpen) return;

    if (searchMode === 'grocery') {
      if (query.trim().length <= 1) {
        setResults({ restaurants: [], items: [] });
        return;
      }
      setLoading(true);
      const delayDebounceFn = setTimeout(() => {
        const filtered = GROCERY_ITEMS.filter(item => 
          item.name.toLowerCase().includes(query.toLowerCase())
        );
        setResults({ restaurants: [], items: filtered });
        setLoading(false);
      }, 200);
      return () => clearTimeout(delayDebounceFn);
    }

    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (err) {
        console.error('[SEARCH_ERROR]', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query, isOpen, searchMode]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else {
      setQuery('');
      setResults({ restaurants: [], items: [] });
    }
  }, [isOpen]);

  const handleSelectRestaurant = (id: string) => {
    const restaurant = results.restaurants.find(r => (r._id || r.id) === id);
    const isPremium = restaurant?.subscriptionTier === 'premium' || restaurant?.isFeatured;
    const { playSound } = require('../utils/sounds');
    playSound(isPremium ? 'premiumRestaurantTransition' : 'click');
    onClose();
    router.push(`/restaurant/${id}` as any);
  };

  const handleSelectItem = (itemId: string) => {
    const { playSound } = require('../utils/sounds');
    playSound('click');
    onClose();
    router.push(`/products/${itemId}` as any);
  };

  const cardBg = isDark ? COLORS.bgCard : '#FFF';
  const txtColor = isDark ? '#FFF' : COLORS.textDark;
  const txtMuted = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? COLORS.borderDark : COLORS.borderLight;

  return (
    <Modal visible={isOpen} animationType="fade" transparent={false} onRequestClose={onClose}>
      <View style={[s.container, { backgroundColor: isDark ? COLORS.bgDark : COLORS.bgLight }]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={[s.closeBtn, { borderColor: border }]}>
            <Text style={[s.closeText, { color: txtColor }]}>✕</Text>
          </TouchableOpacity>
          <View style={[s.inputWrap, { borderColor: searchMode === 'grocery' ? '#22C55E' : COLORS.gold }]}>
            <TextInput
              ref={inputRef}
              style={[s.input, { color: txtColor }]}
              placeholder={searchMode === 'grocery' ? "Search 10,000+ grocery items..." : "Search food or restaurants..."}
              placeholderTextColor={txtMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
            {loading && <ActivityIndicator size="small" color={searchMode === 'grocery' ? '#22C55E' : COLORS.gold} style={s.spinner} />}
          </View>
        </View>

        {/* Results Area */}
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {/* City Pulse Trending Banner */}
          {results.isTrending && (
            <View style={s.trendingBanner}>
              <Text style={s.trendingTag}>CITY PULSE</Text>
              <Text style={s.trendingTitle}>Trending in Amaravathi Central 🔥</Text>
            </View>
          )}

          {/* Empty state */}
          {results.restaurants.length === 0 && results.items.length === 0 && query.length > 1 && !loading && (
            <View style={s.emptyState}>
              <Text style={s.emptyText}>No results found for "{query}" 😕</Text>
            </View>
          )}

          {/* Restaurants section */}
          {results.restaurants.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>RESTAURANTS</Text>
              <View style={s.gridContainer}>
                {results.restaurants.map((res) => {
                  const img = res.imageUrl || res.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
                  return (
                    <TouchableOpacity
                      key={res._id || res.id}
                      style={[s.gridCard, { backgroundColor: cardBg, borderColor: border }]}
                      onPress={() => handleSelectRestaurant(res._id || res.id)}
                    >
                      <Image source={{ uri: img }} style={s.gridCardImg} />
                      <View style={s.gridCardInfo}>
                        <Text style={[s.gridCardName, { color: txtColor }]} numberOfLines={1}>{res.name}</Text>
                        <Text style={s.gridCardMeta}>⭐ {res.rating || '4.0'} • {res.location || 'SRM'}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Items / Dishes section */}
          {results.items.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{searchMode === 'grocery' ? 'GROCERY ITEMS' : 'DISHES'}</Text>
              <View style={s.gridContainer}>
                {results.items.map((item) => {
                  const img = item.image || item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
                  
                  if (searchMode === 'grocery') {
                    const inCart = cart.find(i => i.id === item.id);
                    const quantity = inCart ? inCart.quantity : 0;
                    return (
                      <View
                        key={item.id}
                        style={[s.gridCard, { backgroundColor: cardBg, borderColor: border }]}
                      >
                        <View style={{ position: 'relative' }}>
                          <Image source={{ uri: img }} style={s.gridCardImg} />
                          {item.discount && (
                            <View style={s.discountBadge}>
                              <Text style={s.discountText}>{item.discount}</Text>
                            </View>
                          )}
                        </View>
                        <View style={s.gridCardInfo}>
                          <Text style={{ fontSize: 8, fontWeight: '700', color: '#666', marginBottom: 2 }}>{item.weight || '1 unit'}</Text>
                          <Text style={[s.gridCardName, { color: txtColor, height: 32 }]} numberOfLines={2}>
                            {item.name}
                          </Text>
                          
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                            <View>
                              <Text style={s.gridCardPrice}>₹{item.price}</Text>
                              {item.originalPrice > item.price && (
                                <Text style={{ fontSize: 8, color: '#999', textDecorationLine: 'line-through' }}>₹{item.originalPrice}</Text>
                              )}
                            </View>
                            
                            {/* ADD / Stepper */}
                            {quantity > 0 ? (
                              <View style={s.stepperWrap}>
                                <TouchableOpacity
                                  style={s.stepperBtn}
                                  onPress={() => {
                                    const cartKey = cart.find(i => i.id === item.id)?.cartKey || item.id;
                                    updateQuantity(cartKey, quantity - 1);
                                  }}
                                >
                                  <Text style={s.stepperBtnText}>-</Text>
                                </TouchableOpacity>
                                <Text style={[s.stepperQty, { color: txtColor }]}>{quantity}</Text>
                                <TouchableOpacity
                                  style={s.stepperBtn}
                                  onPress={() => {
                                    addToCart({
                                      id: item.id,
                                      name: item.name,
                                      price: item.price,
                                      image: item.image,
                                      restaurantId: 'mega-basket-vendor',
                                      restaurantName: 'Mega Basket Grocery'
                                    });
                                  }}
                                >
                                  <Text style={s.stepperBtnText}>+</Text>
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <TouchableOpacity
                                style={s.addBtn}
                                onPress={() => {
                                  addToCart({
                                    id: item.id,
                                    name: item.name,
                                    price: item.price,
                                    image: item.image,
                                    restaurantId: 'mega-basket-vendor',
                                    restaurantName: 'Mega Basket Grocery'
                                  });
                                }}
                              >
                                <Text style={s.addBtnText}>ADD +</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      </View>
                    );
                  }

                  return (
                    <TouchableOpacity
                      key={item._id || item.id}
                      style={[s.gridCard, { backgroundColor: cardBg, borderColor: border }]}
                      onPress={() => handleSelectItem(item._id || item.id)}
                    >
                      <Image source={{ uri: img }} style={s.gridCardImg} />
                      <View style={s.gridCardInfo}>
                        <Text style={[s.gridCardName, { color: txtColor }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                          <Text style={s.gridCardPrice}>₹{item.price}</Text>
                          <Text style={s.gridCardRestName} numberOfLines={1}>{item.restaurantId?.name || 'Partner'}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Popular searches when query is empty */}
          {query.length <= 1 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>POPULAR SEARCHES</Text>
              <View style={s.tagsRow}>
                {(searchMode === 'grocery'
                  ? ['Ghee', 'Atta', 'Lemon', 'Toor Dal', 'Rice', 'Spices']
                  : ['Biryani', 'Burger', 'Pizza', 'Milkshake', 'Domino', 'Chinese']
                ).map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[s.tagBtn, { backgroundColor: cardBg, borderColor: border }]}
                    onPress={() => setQuery(tag)}
                  >
                    <Text style={[s.tagText, { color: txtColor }]}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '800',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 16,
    height: 48,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    height: '100%',
    borderWidth: 0,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      }
    } as any),
  } as any,
  spinner: {
    marginLeft: 8,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 80,
  },
  trendingBanner: {
    backgroundColor: 'rgba(201,168,76,0.08)',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.gold,
    padding: 14,
    borderRadius: 16,
    marginBottom: 20,
  },
  trendingTag: {
    fontSize: 8,
    fontWeight: '900',
    color: COLORS.gold,
    letterSpacing: 2,
  },
  trendingTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFF',
    marginTop: 2,
  },
  emptyState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.textSecondary,
    letterSpacing: 2,
    marginBottom: 12,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: (SW - 44) / 2,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 6,
  },
  gridCardImg: {
    width: '100%',
    aspectRatio: 4/3,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  gridCardInfo: {
    padding: 10,
  },
  gridCardName: {
    fontSize: 12,
    fontWeight: '800',
  },
  gridCardMeta: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  gridCardPrice: {
    fontSize: 11,
    fontWeight: '900',
    color: COLORS.gold,
  },
  gridCardRestName: {
    fontSize: 8,
    fontWeight: '700',
    color: COLORS.textSecondary,
    maxWidth: 70,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepperWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#22C55E', borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' },
  stepperBtn: { paddingHorizontal: 6, paddingVertical: 4, backgroundColor: '#DCFCE7' },
  stepperBtnText: { fontSize: 10, fontWeight: '900', color: '#22C55E' },
  stepperQty: { fontSize: 9, fontWeight: '900', paddingHorizontal: 6, textAlign: 'center', minWidth: 16 },
  addBtn: { backgroundColor: '#fff', borderColor: '#22C55E', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  addBtnText: { fontSize: 9, fontWeight: '900', color: '#22C55E' },
  discountBadge: { position: 'absolute', bottom: 8, left: 8, backgroundColor: '#F59E0B', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  discountText: { fontSize: 7, fontWeight: '900', color: '#fff' },
});
