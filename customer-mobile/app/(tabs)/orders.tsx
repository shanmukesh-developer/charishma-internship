import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, RefreshControl, Animated, LayoutAnimation, UIManager, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../../constants/theme';
import { ENDPOINTS } from '../../constants/api';
import { useTheme } from '../../context/ThemeContext';
import { useCart } from '../../context/CartContext';
import { apiFetch } from '../../utils/auth';
import AmbientBackground from '../../components/AmbientBackground';
import { StaggeredSection, BounceIn, FloatingPulse, PulseGlow } from '../../components/AnimatedSection';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ScalePressable = ({ children, onPress, style, activeOpacity = 0.85 }: any) => {
  const scale = useRef(new Animated.Value(1)).current;
  
  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={activeOpacity}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      style={style}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
};

export default function OrdersScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const { addToCart, clearCart, cart } = useCart();
  const [orders, setOrders] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleReorder = (order: any) => {
    try {
      const items = order.items || [];
      if (items.length === 0) return;

      const targetRestaurantId = order.restaurantId;
      const targetRestaurantName = order.restaurant || 'Zenvy Partner';
      const hasConflict = cart.length > 0 && cart[0].restaurantId !== targetRestaurantId;

      const performReorder = () => {
        if (hasConflict) {
          clearCart();
        }
        items.forEach((item: any) => {
          addToCart({
            id: item.itemId || item.id || String(Math.random()),
            name: item.name,
            price: item.price,
            basePrice: item.basePrice || item.price,
            image: item.image || item.imageUrl || '',
            restaurantId: targetRestaurantId,
            restaurantName: targetRestaurantName,
            quantity: item.quantity || 1,
            customizations: item.customizations || {},
          });
        });
        router.push('/(tabs)/basket' as any);
      };

      if (hasConflict) {
        Alert.alert(
          'Replace Basket?',
          `Your basket contains items from another restaurant. Replace them with items from ${targetRestaurantName}?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace & Reorder', onPress: performReorder }
          ]
        );
      } else {
        performReorder();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchOrders = async () => {
    try {
      const res = await apiFetch(ENDPOINTS.myOrders);
      const data = await res.json();
      if (Array.isArray(data)) setOrders(data);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  const bgColors: [string, string] = isDark ? ['#0B0B0D', '#161618'] : [COLORS.bgLight, '#EFEFEF'];
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.08)' : COLORS.bgLightCard;
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? 'rgba(255, 255, 255, 0.08)' : COLORS.borderLight;

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(expanded === id ? null : id);
  };

  const statusColor = (s: string) => {
    if (s === 'Delivered') return COLORS.emerald;
    if (s === 'Cancelled') return '#EF4444';
    return '#D4AF7A';
  };

  return (
    <View style={st.container}>
      <AmbientBackground />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? '#D4AF7A' : COLORS.gold} colors={['#D4AF7A']} />
        }
      >
        <Text style={[st.pageTitle, { color: txt }]}>MY ORDERS</Text>
        <Text style={[st.pageSub, { color: txtSec }]}>← SWIPE TO REORDER • TAP TO EXPAND</Text>

        {orders.length === 0 && (
          <View style={st.empty}><Text style={[st.emptyText, { color: txtSec }]}>No orders yet. Start exploring!</Text></View>
        )}

        {orders.map((o, idx) => {
          const id = (o._id || o.id || '').slice(-6).toUpperCase();
          const isExpanded = expanded === (o._id || o.id);
          return (
            <StaggeredSection key={o._id || o.id} delay={idx * 100} direction="up">
            <ScalePressable 
              style={[st.card, { backgroundColor: cardBg, borderColor: border }]} 
              onPress={() => toggleExpand(o._id || o.id)}
            >
              <View style={st.cardHeader}>
                <View>
                  <Text style={{ fontSize: 10, color: txtSec, fontWeight: '700', letterSpacing: 1.5 }}>
                    {o.status === 'Cancelled' ? '✕' : o.status === 'Delivered' ? '✓' : '◉'}{' '}
                    <Text style={{ color: '#D4AF7A', fontWeight: '800' }}>ORDER #{id}</Text>
                  </Text>
                  <Text style={[st.restaurantName, { color: txt }]}>{o.restaurant || 'Zenvy Partner'}</Text>
                  <Text style={{ fontSize: 9, color: txtSec, fontWeight: '600' }}>{(o.items || []).length} item{(o.items||[]).length !== 1 ? 's' : ''} • {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[st.statusBadge, { color: statusColor(o.status) }]}>{(o.status || 'PENDING').toUpperCase()}</Text>
                  <Text style={[st.price, { color: isDark ? '#D4AF7A' : '#000' }]}>₹{o.totalPrice || 0}</Text>
                </View>
              </View>

              {isExpanded && (
                <View style={[st.details, { borderTopColor: border }]}>
                  {o.deliveryOTP && (
                    <View style={[st.otpSection, { borderColor: 'rgba(212,175,122,0.3)', backgroundColor: 'rgba(212,175,122,0.08)' }]}>
                      <Text style={{ fontSize: 8, fontWeight: '900', color: '#D4AF7A', letterSpacing: 2, marginBottom: 4 }}>DELIVERY OTP PIN</Text>
                      <View style={st.otpBox}>
                        <Text style={st.otpText}>{o.deliveryOTP}</Text>
                        <Text style={{ fontSize: 8, color: txtSec, fontWeight: '700', lineHeight: 12 }}>VERIFICATION PIN{'\n'}Show to Delivery Partner</Text>
                      </View>
                    </View>
                  )}
                  {(o.items || []).map((item: any, i: number) => (
                    <View key={i} style={st.itemRow}>
                      <Text style={{ fontSize: 10, color: txt, fontWeight: '600' }}>{item.quantity}x  {item.name}</Text>
                      <Text style={{ fontSize: 10, color: txt, fontWeight: '800' }}>₹{(item.price || 0) * (item.quantity || 1)}</Text>
                    </View>
                  ))}
                  {o.status !== 'Delivered' && o.status !== 'Cancelled' ? (
                    <TouchableOpacity style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12 }} onPress={() => router.push(`/tracking/${o._id || o.id}` as any)}>
                      <LinearGradient
                        colors={['#D4AF7A', '#F0D9A8']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={st.trackBtnGradient}
                      >
                        <Text style={st.trackBtnText}>TRACK LIVE LOCATION →</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12 }} onPress={() => handleReorder(o)}>
                      <LinearGradient
                        colors={['#EF4F5F', '#FF6B7B']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={st.trackBtnGradient}
                      >
                        <Text style={[st.trackBtnText, { color: '#fff' }]}>REORDER THIS MEAL 🔁</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </ScalePressable>
            </StaggeredSection>
          );
        })}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  pageTitle: { fontSize: 24, fontWeight: '900', letterSpacing: 4, paddingHorizontal: 16, marginBottom: 4 },
  pageSub: { fontSize: 9, fontWeight: '700', letterSpacing: 2, paddingHorizontal: 16, marginBottom: 20 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 12, fontWeight: '600' },
  card: { marginHorizontal: 16, marginBottom: 12, borderRadius: 20, padding: 16, borderWidth: 1, ...SHADOWS.card },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  restaurantName: { fontSize: 15, fontWeight: '900', marginVertical: 3, letterSpacing: -0.2 },
  statusBadge: { fontSize: 9, fontWeight: '900', letterSpacing: 2 },
  price: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  details: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  otpSection: { marginBottom: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  otpBox: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  otpText: { fontSize: 28, fontWeight: '900', color: '#D4AF7A', fontVariant: ['tabular-nums'], letterSpacing: 6 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  trackBtnGradient: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  trackBtnText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 3 },
});
