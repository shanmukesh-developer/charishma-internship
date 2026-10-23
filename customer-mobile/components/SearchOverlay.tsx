import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Dimensions, Platform } from 'react-native';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from './SafeImage';
import { useRouter } from 'expo-router';
import { COLORS, RADIUS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../constants/api';
import { useCart } from '../context/CartContext';
import { apiFetch } from '../utils/auth';
import { isLocalVendorType } from '../utils/localVendor';
import { isCustomizable } from './CustomizeDrawer';

// Grocery search runs against the DB catalogue (GET /api/catalogue/items?type=grocery&q=…)
const toGroceryResult = (it: any) => ({
  id: it.id || it._id || it.menuItemId,
  name: it.name,
  price: Number(it.price) || 0,
  originalPrice: Number(it.originalPrice) || null,
  weight: it.weight || null,
  image: it.image || it.imageUrl || null,
  discount: Number(it.discountPercent) > 0 ? `${Number(it.discountPercent)}% OFF` : null,
  restaurantId: it.storeId || it.restaurantId,
  restaurantName: it.storeName || 'Kirana & Late-Night Mart',
  orderable: it.orderable !== false && it.isAvailable !== false,
});

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
  const [searchError, setSearchError] = useState(false);
  // Bumped by the Retry button to re-run the same search.
  const [retryTick, setRetryTick] = useState(0);
  const requestIdRef = useRef(0);

  const inputRef = useRef<TextInput>(null);

  // Debounced search fetch (stale responses are ignored; failures show a friendly message)
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();
    if (searchMode === 'grocery' && trimmed.length <= 1) {
      requestIdRef.current++;
      setSearchError(false);
      setLoading(false);
      setResults({ restaurants: [], items: [] });
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      setSearchError(false);
      // apiFetch skips its own timeout when a signal is passed, so cap a stalled request here.
      timeoutTimer = setTimeout(() => controller.abort(), 15000);
      try {
        const url = searchMode === 'grocery'
          ? `${API_URL}/api/catalogue/items?type=grocery&q=${encodeURIComponent(trimmed)}&limit=40`
          : `${API_URL}/api/users/search?q=${encodeURIComponent(query)}`;
        const res = await apiFetch(url, { signal: controller.signal });
        if (requestId !== requestIdRef.current) return;
        if (!res.ok) {
          setResults({ restaurants: [], items: [] });
          setSearchError(true);
          return;
        }
        const data = await res.json();
        if (requestId !== requestIdRef.current) return;
        if (searchMode === 'grocery') {
          const items = (Array.isArray(data?.items) ? data.items : []).map(toGroceryResult).filter((i: any) => i.id && i.restaurantId);
          setResults({ restaurants: [], items });
        } else {
          setResults({
            restaurants: Array.isArray(data?.restaurants) ? data.restaurants : [],
            items: Array.isArray(data?.items) ? data.items : [],
            isTrending: !!data?.isTrending,
          });
        }
      } catch (err: any) {
        // A cleanup abort (query changed / overlay closed) bumps requestIdRef, so only a stale request
        // returns here; a timeout abort keeps the same id and is shown as an error with Retry.
        if (requestId !== requestIdRef.current) return;
        if (err?.name !== 'AbortError') console.error('[SEARCH_ERROR]', err);
        setResults({ restaurants: [], items: [] });
        setSearchError(true);
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, searchMode === 'grocery' ? 250 : 300);

    return () => {
      clearTimeout(delayDebounceFn);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      requestIdRef.current++;
      controller.abort();
      setLoading(false);
    };
  }, [query, isOpen, searchMode, retryTick]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(t);
    } else {
      setQuery('');
      setResults({ restaurants: [], items: [] });
      setSearchError(false);
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

  // Dishes open their kitchen's menu (like Swiggy/Zomato); store products open the product page.
  const FOOD_VENDOR_TYPES = ['FOOD', 'RESTAURANT', 'CAFE', 'BAKERY', 'SWEETS', 'DESSERT', 'DESSERTS', 'DRINKS', 'MESS'];
  const handleSelectItem = (item: any) => {
    const { playSound } = require('../utils/sounds');
    playSound('click');
    onClose();
    const rest = item?.restaurantId && typeof item.restaurantId === 'object' ? item.restaurantId : null;
    const restId = rest?._id || rest?.id || (typeof item?.restaurantId === 'string' ? item.restaurantId : null);
    const vType = String(rest?.vendorType || '').toUpperCase();
    // Dishes (CampusBites stall dishes too) open their kitchen / stall page
    if (restId && (!vType || FOOD_VENDOR_TYPES.includes(vType) || isLocalVendorType(vType))) {
      router.push(`/restaurant/${restId}` as any);
      return;
    }
    router.push(`/products/${item._id || item.id}` as any);
  };

  /** CampusBites stall dish from the food search: ADD straight to the basket (the stall delivers, COD). */
  const stallOf = (item: any) => {
    const rest = item?.restaurantId && typeof item.restaurantId === 'object' ? item.restaurantId : null;
    if (!rest || !isLocalVendorType(rest.vendorType)) return null;
    const id = String(rest._id || rest.id || '');
    return id ? { id, name: String(rest.name || '') } : null;
  };
  const addStallDish = (item: any) => {
    const stall = stallOf(item);
    const itemId = String(item?._id || item?.id || '');
    if (!stall || !itemId) return;
    if (isCustomizable(item)) {
      onClose();
      router.push(`/products/${itemId}` as any);
      return;
    }
    addToCart({
      id: itemId,
      name: String(item.name || ''),
      price: Number(item.price) || 0,
      basePrice: Number(item.price) || 0,
      image: item.imageUrl || item.image || '',
      restaurantId: stall.id,
      restaurantName: stall.name,
      isStall: true,
    });
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
          <TouchableOpacity onPress={onClose} style={[s.closeBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F1F5F9' }]}>
            <Text style={[s.closeText, { color: txtColor }]}>✕</Text>
          </TouchableOpacity>
          <View style={[s.inputWrap, { borderColor: searchMode === 'grocery' ? '#22C55E' : (isDark ? COLORS.gold : '#D97706'), backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8FAFC' }]}>
            <TextInput
              ref={inputRef}
              style={[s.input, { color: txtColor }]}
              placeholder={searchMode === 'grocery' ? "Search groceries & essentials..." : "Search food or restaurants..."}
              placeholderTextColor={txtMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
            {loading && <ActivityIndicator size="small" color={searchMode === 'grocery' ? '#22C55E' : (isDark ? COLORS.gold : '#D97706')} style={s.spinner} />}
          </View>
        </View>

        {/* Results Area */}
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {/* City Pulse Trending Banner */}
          {results.isTrending && (
            <View style={[s.trendingBanner, { backgroundColor: isDark ? 'rgba(201,168,76,0.12)' : '#FEF3C7', borderLeftColor: isDark ? COLORS.gold : '#D97706' }]}>
              <Text style={[s.trendingTag, { color: isDark ? COLORS.gold : '#B45309' }]}>TOP PICKS</Text>
              <Text style={[s.trendingTitle, { color: isDark ? '#FFF' : '#1E293B' }]}>Campus spots & dishes to try 🍽️</Text>
            </View>
          )}

          {/* Empty state */}
          {results.restaurants.length === 0 && results.items.length === 0 && query.length > 1 && !loading && (
            <View style={s.emptyState}>
              <Text style={s.emptyText}>{searchError ? "Couldn't search right now. Check your connection and try again." : `No results found for "${query}" 😕`}</Text>
              {searchError && (
                <TouchableOpacity
                  onPress={() => setRetryTick((t) => t + 1)}
                  accessibilityRole="button"
                  style={{ marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: border }}
                >
                  <Text style={{ color: isDark ? '#FFF' : '#1E293B', fontWeight: '700' }}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Restaurants section */}
          {results.restaurants.length > 0 && (
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: isDark ? '#A1A1AA' : '#334155' }]}>RESTAURANTS</Text>
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
                        <Text style={[s.gridCardMeta, { color: isDark ? COLORS.textSecondary : '#617088' }]}>{Number(res.rating) > 0 ? `⭐ ${Number(res.rating).toFixed(1)}` : '✨ New'} • {res.location || 'Campus'}</Text>
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
              <Text style={[s.sectionTitle, { color: isDark ? '#A1A1AA' : '#334155' }]}>{searchMode === 'grocery' ? 'GROCERY ITEMS' : 'DISHES'}</Text>
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
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#666', marginBottom: 2 }}>{item.weight || ''}</Text>
                          <Text style={[s.gridCardName, { color: txtColor, height: 32 }]} numberOfLines={2}>
                            {item.name}
                          </Text>
                          
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                            <View>
                              <Text style={s.gridCardPrice}>₹{item.price}</Text>
                              {item.originalPrice > item.price && (
                                <Text style={{ fontSize: 12, color: '#999', textDecorationLine: 'line-through' }}>₹{item.originalPrice}</Text>
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
                                      restaurantId: item.restaurantId,
                                      restaurantName: item.restaurantName,
                                      vendorType: item.vendorType || undefined,
                                      ...(searchMode === 'grocery' ? { basket: 'store' as const } : {}),
                                    });
                                  }}
                                >
                                  <Text style={s.stepperBtnText}>+</Text>
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <TouchableOpacity
                                style={[s.addBtn, !item.orderable && { opacity: 0.5 }]}
                                disabled={!item.orderable}
                                onPress={() => {
                                  addToCart({
                                    id: item.id,
                                    name: item.name,
                                    price: item.price,
                                    image: item.image,
                                    restaurantId: item.restaurantId,
                                    restaurantName: item.restaurantName,
                                    vendorType: item.vendorType || undefined,
                                    ...(searchMode === 'grocery' ? { basket: 'store' as const } : {}),
                                  });
                                }}
                              >
                                <Text style={s.addBtnText}>{item.orderable ? 'ADD +' : 'SOLD OUT'}</Text>
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
                      onPress={() => handleSelectItem(item)}
                    >
                      <Image source={{ uri: img }} style={s.gridCardImg} />
                      <View style={s.gridCardInfo}>
                        <Text style={[s.gridCardName, { color: txtColor }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                          <Text style={s.gridCardPrice}>₹{item.price}</Text>
                          <Text style={s.gridCardRestName} numberOfLines={1}>{item.restaurantId?.name || ''}</Text>
                        </View>
                        {!!stallOf(item) && (() => {
                          const itemId = String(item._id || item.id);
                          const stallQty = cart.reduce((a, c) => (String(c.id) === itemId ? a + c.quantity : a), 0);
                          const soldOut = item.isAvailable === false;
                          return (
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: '#F97316' }}>🏪 STALL · CASH</Text>
                              <TouchableOpacity
                                style={[s.addBtn, soldOut && { opacity: 0.5 }]}
                                disabled={soldOut}
                                accessibilityLabel={`Add ${item.name} to your basket`}
                                onPress={() => addStallDish(item)}
                              >
                                <Text style={s.addBtnText}>{soldOut ? 'SOLD OUT' : stallQty > 0 ? `ADD + (${stallQty})` : 'ADD +'}</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })()}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Search suggestions when query is empty */}
          {query.length <= 1 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>TRY SEARCHING</Text>
              <View style={s.tagsRow}>
                {(searchMode === 'grocery'
                  ? ['Ghee', 'Atta', 'Lemon', 'Toor Dal', 'Rice', 'Spices']
                  : ['Biryani', 'Burger', 'Pizza', 'Milkshake', 'Dosa', 'Noodles']
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
    fontSize: 12,
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
    fontSize: 12,
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
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  gridCardPrice: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.gold,
  },
  gridCardRestName: {
    fontSize: 12,
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
  stepperBtnText: { fontSize: 12, fontWeight: '900', color: '#22C55E' },
  stepperQty: { fontSize: 12, fontWeight: '900', paddingHorizontal: 6, textAlign: 'center', minWidth: 16 },
  addBtn: { backgroundColor: '#fff', borderColor: '#22C55E', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  addBtnText: { fontSize: 12, fontWeight: '900', color: '#22C55E' },
  discountBadge: { position: 'absolute', bottom: 8, left: 8, backgroundColor: '#F59E0B', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  discountText: { fontSize: 12, fontWeight: '900', color: '#fff' },
});
