import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  Linking,
  Image,
  Alert,
  Clipboard
} from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { API_URL, ENDPOINTS } from '../constants/api';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/auth';
import { StaggeredSection, FloatingPulse, BounceIn } from '../components/AnimatedSection';
import * as ImagePicker from 'expo-image-picker';

interface ExtraItem {
  id: string;
  name: string;
  price: number;
  emoji: string;
}

// Detect product type from name (same logic as web checkout)
function detectType(name: string): string {
  const n = name.toLowerCase();
  if (/cake|pastry|brownie|cupcake|cheesecake|gateau|truffle/.test(n)) return 'cake';
  if (/pizza|calzone/.test(n)) return 'pizza';
  if (/biryani|biriyani|pulao|rice bowl/.test(n)) return 'biryani';
  if (/juice|shake|coffee|tea|chai|lassi|smoothie|lemonade|mojito|frappe|milkshake/.test(n)) return 'beverage';
  if (/sweet|laddu|ladoo|barfi|halwa|jalebi|kaju|peda|mysore pak|mithai/.test(n)) return 'sweets';
  if (/burger|sandwich|wrap|sub|roll|frank|hotdog/.test(n)) return 'burger';
  if (/ice cream|kulfi|falooda|sundae|gelato/.test(n)) return 'dessert';
  if (/chicken|tandoori|kebab|tikka|grilled/.test(n)) return 'chicken';
  if (/noodle|chowmein|fried rice|manchurian|momos/.test(n)) return 'chinese';
  if (/dosa|idli|uttapam|vada|sambar|upma/.test(n)) return 'south';
  return 'meal';
}

const TYPE_EXTRAS: Record<string, ExtraItem[]> = {
  cake: [
    { id: 'candles', name: 'Birthday Candles (10)', price: 15, emoji: '🕯️' },
    { id: 'knife', name: 'Cake Cutting Knife', price: 10, emoji: '🔪' },
    { id: 'gift-wrap', name: 'Gift Wrapping', price: 30, emoji: '🎁' },
    { id: 'plates', name: 'Paper Plates (6 pcs)', price: 15, emoji: '🍽️' },
    { id: 'icecream', name: 'Vanilla Ice Cream Cup', price: 30, emoji: '🍦' },
    { id: 'forks', name: 'Dessert Forks (6 pcs)', price: 10, emoji: '🍴' },
  ],
  pizza: [
    { id: 'garlic-bread', name: 'Garlic Bread (4 pcs)', price: 60, emoji: '🍞' },
    { id: 'coke', name: 'Coca Cola (300ml)', price: 40, emoji: '🥤' },
    { id: 'dip-cheese', name: 'Cheesy Dip Sauce', price: 20, emoji: '🧀' },
    { id: 'fries', name: 'French Fries', price: 50, emoji: '🍟' },
    { id: 'chili-flakes', name: 'Chili Flakes & Oregano', price: 5, emoji: '🌶️' },
    { id: 'napkins', name: 'Extra Napkins (10 pcs)', price: 10, emoji: '🧻' },
  ],
  biryani: [
    { id: 'raita', name: 'Raita (Cup)', price: 25, emoji: '🥣' },
    { id: 'salan', name: 'Mirchi Ka Salan', price: 30, emoji: '🌶️' },
    { id: 'boiled-egg', name: 'Boiled Egg (2 pcs)', price: 20, emoji: '🥚' },
    { id: 'buttermilk', name: 'Buttermilk (Chaas)', price: 25, emoji: '🥛' },
    { id: 'thumbsup', name: 'Thums Up (300ml)', price: 40, emoji: '🥤' },
    { id: 'onion-salad', name: 'Onion Salad', price: 15, emoji: '🧅' },
  ],
  beverage: [
    { id: 'cookie', name: 'Chocolate Cookie', price: 20, emoji: '🍪' },
    { id: 'muffin', name: 'Blueberry Muffin', price: 40, emoji: '🧁' },
    { id: 'sandwich', name: 'Club Sandwich', price: 60, emoji: '🥪' },
    { id: 'straw', name: 'Paper Straw (2 pcs)', price: 5, emoji: '🥤' },
  ],
  sweets: [
    { id: 'gift-box', name: 'Premium Gift Box', price: 50, emoji: '🎁' },
    { id: 'dry-fruits', name: 'Mixed Dry Fruits (100g)', price: 80, emoji: '🥜' },
    { id: 'saffron-milk', name: 'Kesar Milk', price: 35, emoji: '🥛' },
    { id: 'plates', name: 'Paper Plates (6 pcs)', price: 15, emoji: '🍽️' },
  ],
  burger: [
    { id: 'fries', name: 'French Fries', price: 50, emoji: '🍟' },
    { id: 'coke', name: 'Coca Cola (300ml)', price: 40, emoji: '🥤' },
    { id: 'coleslaw', name: 'Coleslaw', price: 25, emoji: '🥗' },
    { id: 'ketchup', name: 'Extra Ketchup & Mayo', price: 10, emoji: '🍅' },
    { id: 'onion-rings', name: 'Onion Rings', price: 45, emoji: '🧅' },
    { id: 'napkins', name: 'Extra Napkins', price: 10, emoji: '🧻' },
  ],
  dessert: [
    { id: 'chocolate-sauce', name: 'Chocolate Sauce', price: 15, emoji: '🍫' },
    { id: 'wafer', name: 'Wafer Sticks', price: 20, emoji: '🍘' },
    { id: 'nuts', name: 'Crushed Nuts Topping', price: 20, emoji: '🥜' },
    { id: 'coffee', name: 'Hot Coffee', price: 30, emoji: '☕' },
  ],
  chicken: [
    { id: 'naan', name: 'Butter Naan (2 pcs)', price: 40, emoji: '🫓' },
    { id: 'coke', name: 'Coca Cola (300ml)', price: 40, emoji: '🥤' },
    { id: 'salad', name: 'Green Salad', price: 20, emoji: '🥗' },
    { id: 'raita', name: 'Onion Raita', price: 25, emoji: '🥣' },
    { id: 'lemon', name: 'Lemon Wedges', price: 5, emoji: '🍋' },
  ],
  chinese: [
    { id: 'spring-roll', name: 'Veg Spring Rolls (4)', price: 50, emoji: '🥟' },
    { id: 'sweet-corn', name: 'Sweet Corn Soup', price: 35, emoji: '🍜' },
    { id: 'chili-sauce', name: 'Schezwan Sauce', price: 10, emoji: '🌶️' },
    { id: 'coke', name: 'Coca Cola (300ml)', price: 40, emoji: '🥤' },
  ],
  south: [
    { id: 'sambar', name: 'Extra Sambar', price: 15, emoji: '🥘' },
    { id: 'chutney', name: 'Coconut Chutney', price: 10, emoji: '🥥' },
    { id: 'filter-coffee', name: 'Filter Coffee', price: 25, emoji: '☕' },
    { id: 'curd', name: 'Fresh Curd', price: 15, emoji: '🥛' },
  ],
  meal: [
    { id: 'coke', name: 'Coca Cola (300ml)', price: 40, emoji: '🥤' },
    { id: 'water', name: 'Water Bottle (500ml)', price: 20, emoji: '💧' },
    { id: 'lassi', name: 'Sweet Lassi', price: 35, emoji: '🥛' },
    { id: 'salad', name: 'Fresh Salad', price: 25, emoji: '🥗' },
  ],
};

export default function CheckoutScreen() {
  const router = useRouter();
  const { cart, totalPrice, clearCart, addToCart, uniqueRestaurants, deliveryFee: cartDeliveryFee, isRoomOrder } = useCart();
  const { user } = useAuth();
  const { isDark } = useTheme();

  const [locationType, setLocationType] = useState<'srmap' | 'vitap' | 'amrita' | 'other'>('srmap');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  
  // Delivery Time
  const [deliveryType, setDeliveryType] = useState<'asap' | 'scheduled'>('asap');
  const [scheduledTime, setScheduledTime] = useState('');

  // Payment Method
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'UPI' | 'Card'>('COD');
  const [upiUTR, setUpiUTR] = useState('');
  const [upiScreenshot, setUpiScreenshot] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Rewards & Coupons
  const [zenPoints, setZenPoints] = useState(0);
  const [coupons, setCoupons] = useState<{ id: string; code: string; type: string }[]>([]);
  const [selectedCoupon, setSelectedCoupon] = useState<{ id: string; code: string; type: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [addedExtras, setAddedExtras] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Please sign in to complete your order mission.',
        [
          { text: 'Cancel', onPress: () => router.replace('/(tabs)' as any), style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/login' as any) }
        ],
        { cancelable: false }
      );
      return;
    }
    if (user?.address) setAddress(user.address);
    if (user?.zenPoints) setZenPoints(user.zenPoints);

    // Fetch user coupons
    const fetchCoupons = async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/rewards/coupons`);
        if (res.ok) {
          const data = await res.json();
          setCoupons(data);
        }
      } catch (err) {
        console.error('Coupons fetch failed', err);
      }
    };
    fetchCoupons();
  }, [user]);

  // Suggested extras selector
  const suggestions = useMemo(() => {
    const types = new Set(cart.map(i => detectType(i.name)));
    const seen = new Set<string>();
    const result: ExtraItem[] = [];

    types.forEach(type => {
      const extras = TYPE_EXTRAS[type] || TYPE_EXTRAS['meal'];
      extras.forEach(e => {
        if (!seen.has(e.id) && !addedExtras.has(e.id)) {
          seen.add(e.id);
          result.push(e);
        }
      });
    });

    return result.slice(0, 8);
  }, [cart, addedExtras]);

  // Delivery fee calculation
  const baseDeliveryFee = cartDeliveryFee || 30;
  const isElite = user?.isElite || false;
  const deliveryFee = isElite || zenPoints >= 200 ? 0 : baseDeliveryFee;
  const couponDiscount = selectedCoupon?.type === 'FREEDEL' ? deliveryFee : 0;
  const finalTotal = Math.max(0, totalPrice + deliveryFee - couponDiscount);

  const handlePlaceOrder = async () => {
    if (paymentMethod === 'UPI' && (!upiUTR || !upiScreenshot)) {
      Alert.alert('Payment Details Required', 'Please enter your UPI transaction UTR code and attach the screenshot receipt.');
      return;
    }

    setLoading(true);
    try {
      const isMegaBasket = cart.some(item => item.restaurantId === 'mega-basket-vendor');
      let res;

      const deliveryAddress = `${locationType === 'srmap' ? 'SRM AP' : locationType === 'vitap' ? 'VIT AP' : locationType === 'amrita' ? 'AMRITA' : 'OTHERS'} - ${address} (Landmark: ${landmark})`;

      if (isMegaBasket) {
        const bodyPayload = {
          items: cart.map(item => ({
            name: item.name,
            quantity: item.quantity,
            unit: 'pcs',
            priceEstimated: item.price
          })),
          deliveryAddress,
          paymentMethod,
          upiUTR: paymentMethod === 'UPI' ? upiUTR : undefined
        };

        res = await apiFetch(`${API_URL}/api/mega-basket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload),
        });
      } else {
        const orderData = {
          restaurantId: cart[0]?.restaurantId,
          restaurantIds: [...new Set(cart.map(i => i.restaurantId))],
          items: cart.map(item => ({
            menuItemId: item.id,
            name: item.name,
            quantity: item.quantity,
            priceAtOrder: item.price,
            basePrice: item.basePrice || item.price,
            customizations: item.customizations || null,
            restaurantId: item.restaurantId,
          })),
          totalPrice,
          deliveryFee,
          isRoomOrder,
          paymentMethod,
          upiUTR: paymentMethod === 'UPI' ? upiUTR : undefined,
          upiScreenshot: paymentMethod === 'UPI' ? upiScreenshot : undefined,
          deliverySlot: deliveryType === 'asap' ? 'ASAP' : scheduledTime,
          deliveryAddress,
          couponCode: selectedCoupon?.code
        };

        res = await apiFetch(ENDPOINTS.placeOrder, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderData),
        });
      }

      if (res.ok) {
        const data = await res.json();
        clearCart();
        if (isMegaBasket) {
          router.replace('/mega-basket' as any);
        } else {
          router.replace(`/tracking/${data._id || data.id}` as any);
        }
      } else {
        const err = await res.json();
        Alert.alert('Order Failed', err.message || 'Payment Rejected. Please try again.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Network Error', 'Order failed to place. Check connection.');
    } finally {
      setLoading(false);
    }
  };

  const simulateSuccess = () => {
    setUpiUTR('SIM-' + Math.random().toString(36).substring(7).toUpperCase());
    setUpiScreenshot('https://picsum.photos/seed/payment/400/800');
    Alert.alert('Dev Mode Payment Simulated', 'UTR Code and Screenshot attachment set.');
  };

  const attachMockScreenshot = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.granted === false) {
        Alert.alert("Permission Required", "You need to allow camera roll access to upload screenshots.");
        return;
      }

      setIsUploading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const base64Image = `data:image/jpeg;base64,${asset.base64}`;
        setUpiScreenshot(base64Image);
        Alert.alert('Screenshot Attached', 'Your payment receipt has been successfully attached.');
      }
    } catch (err) {
      console.warn('Screenshot upload error:', err);
      Alert.alert('Upload Failed', 'Could not select or process screenshot.');
    } finally {
      setIsUploading(false);
    }
  };

  const copyUpiId = () => {
    Clipboard.setString('kesavakesava764@ybl');
    Alert.alert('Copied!', 'UPI ID: kesavakesava764@ybl copied to clipboard.');
  };

  const openUpiApp = () => {
    const url = `upi://pay?pa=kesavakesava764@ybl&pn=ZenvyNexus&am=${finalTotal.toFixed(2)}&cu=INR`;
    Linking.openURL(url).catch(() => {
      Alert.alert('UPI App Not Found', 'Please scan the QR code below or copy the ID to pay.');
    });
  };

  const bg = isDark ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDark ? COLORS.bgCard : COLORS.bgLightCard;
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? COLORS.borderDark : COLORS.borderLight;
  const goldColor = isDark ? COLORS.gold : COLORS.red;

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <View style={[s.header, { backgroundColor: bg, borderBottomColor: border }]}>
        <TouchableOpacity 
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }} 
          style={[s.backBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}
        >
          <Text style={{ color: txt, fontSize: 18 }}>‹</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: goldColor }]}>STRATEGIC CHECKOUT</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Campus Selection */}
        <StaggeredSection delay={50} direction="up">
          <Text style={[s.sectionTitle, { color: txt }]}>DELIVERY CAMPUS LOCATION</Text>
          <View style={s.campusRow}>
            {[
              { key: 'srmap', label: 'SRM AP', sub: 'SRM University', icon: '🏢' },
              { key: 'vitap', label: 'VIT AP', sub: 'VIT Campus', icon: '🏫' },
              { key: 'amrita', label: 'AMRITA', sub: 'Amrita Campus', icon: '🏥' },
              { key: 'other', label: 'OTHERS', sub: 'Custom Place', icon: '📍' },
            ].map(item => {
              const isActive = locationType === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    s.campusBtnNew,
                    { backgroundColor: cardBg, borderColor: border },
                    isActive && { borderColor: goldColor, backgroundColor: isDark ? 'rgba(201,168,76,0.08)' : 'rgba(239,79,95,0.05)' }
                  ]}
                  onPress={() => setLocationType(item.key as any)}
                >
                  <Text style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</Text>
                  <Text style={[s.campusLabelNew, isActive && { color: goldColor }]}>{item.label}</Text>
                  <Text style={s.campusSubLabelNew} numberOfLines={1}>{item.sub}</Text>
                  {isActive && (
                    <View style={[s.activeCheckBadge, { backgroundColor: goldColor }]}>
                      <Text style={s.activeCheckText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            style={[s.input, { backgroundColor: cardBg, color: txt }]}
            placeholder="Hostel Block, Room No. or Street Name"
            placeholderTextColor={txtSec}
            value={address}
            onChangeText={setAddress}
          />
          <TextInput
            style={[s.input, { backgroundColor: cardBg, color: txt }]}
            placeholder="Landmark (Optional)"
            placeholderTextColor={txtSec}
            value={landmark}
            onChangeText={setLandmark}
          />
        </StaggeredSection>

        {/* Delivery Time Selection */}
        <StaggeredSection delay={130} direction="up">
          <Text style={[s.sectionTitle, { color: txt, marginTop: 18 }]}>DELIVERY SCHEDULE</Text>
          <View style={s.timeRow}>
            <TouchableOpacity
              style={[s.timeTypeBtn, deliveryType === 'asap' && s.timeTypeBtnActive, { backgroundColor: cardBg }]}
              onPress={() => setDeliveryType('asap')}
            >
              <Text style={{ fontSize: 18 }}>⚡</Text>
              <Text style={[s.timeTypeLabel, deliveryType === 'asap' && s.timeTypeLabelActive]}>ASAP</Text>
              <Text style={s.timeTypeSub}>30-50 Mins</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.timeTypeBtn, deliveryType === 'scheduled' && s.timeTypeBtnActive, { backgroundColor: cardBg }]}
              onPress={() => setDeliveryType('scheduled')}
            >
              <Text style={{ fontSize: 18 }}>🗓️</Text>
              <Text style={[s.timeTypeLabel, deliveryType === 'scheduled' && s.timeTypeLabelActive]}>SCHEDULE</Text>
              <Text style={s.timeTypeSub}>Pre-order Slots</Text>
            </TouchableOpacity>
          </View>

          {deliveryType === 'scheduled' && (
            <View style={s.scheduleSlotsContainer}>
              <Text style={s.scheduleHelperText}>SELECT TOMORROW'S PRE-ORDER MISSION SLOT:</Text>
              <View style={s.slotsGrid}>
                {[
                  { label: '🌅 Breakfast', time: 'Tomorrow 08:00 AM' },
                  { label: '☀️ Lunch', time: 'Tomorrow 12:00 PM' },
                  { label: '🌙 Dinner', time: 'Tomorrow 07:00 PM' },
                ].map(slot => (
                  <TouchableOpacity
                    key={slot.label}
                    style={[s.slotBtn, scheduledTime === slot.time && s.slotBtnActive, { backgroundColor: cardBg }]}
                    onPress={() => setScheduledTime(slot.time)}
                  >
                    <Text style={[s.slotEmojiLabel, { color: txt }]}>{slot.label}</Text>
                    <Text style={s.slotTimeLabel}>{slot.time.split(' ')[1] + ' ' + slot.time.split(' ')[2]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </StaggeredSection>

        {/* Pairs Well With Your Order (Suggested Extras) */}
        {suggestions.length > 0 && (
          <StaggeredSection delay={210} direction="up">
            <View style={{ marginTop: 20 }}>
              <Text style={[s.sectionTitle, { color: txt, marginBottom: 8 }]}>PAIRS WELL WITH YOUR ORDER</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.extrasScroll}>
                {suggestions.map(extra => (
                  <TouchableOpacity
                    key={extra.id}
                    style={[s.extraCard, { backgroundColor: cardBg }]}
                    onPress={() => {
                      addToCart({
                        id: `extra-${extra.id}`,
                        name: extra.name,
                        price: extra.price,
                        image: '',
                        restaurantId: cart[0]?.restaurantId || 'extras',
                        restaurantName: cart[0]?.restaurantName || 'Zenvy Extras',
                      });
                      setAddedExtras(prev => new Set([...prev, extra.id]));
                      Alert.alert('Added Extra', `${extra.name} added to your basket.`);
                    }}
                  >
                    <Text style={{ fontSize: 24, marginBottom: 4 }}>{extra.emoji}</Text>
                    <Text style={[s.extraName, { color: txt }]} numberOfLines={1}>{extra.name}</Text>
                    <Text style={s.extraPrice}>₹{extra.price}</Text>
                    <Text style={s.extraAddBtn}>+ ADD</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </StaggeredSection>
        )}

        {/* Gourmet Rewards & Coupons */}
        <StaggeredSection delay={290} direction="up">
          <View style={{ marginTop: 20 }}>
            <View style={s.rewardsHeader}>
              <Text style={[s.sectionTitle, { color: txt, marginBottom: 0 }]}>GOURMET REWARDS</Text>
              <View style={s.pointsBadge}>
                <Text style={s.pointsText}>{zenPoints} ZEN</Text>
              </View>
            </View>

            {coupons.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.couponsScroll}>
                {coupons.map(cpn => {
                  const isActive = selectedCoupon?.id === cpn.id;
                  return (
                    <TouchableOpacity
                      key={cpn.id}
                      style={[s.couponCard, isActive && s.couponCardActive, { backgroundColor: cardBg }]}
                      onPress={() => setSelectedCoupon(isActive ? null : cpn)}
                    >
                      <Text style={{ fontSize: 20, marginBottom: 4 }}>{cpn.type === 'FREEDEL' ? '🚚' : '🏷️'}</Text>
                      <Text style={[s.couponCode, { color: txt }]}>{cpn.code}</Text>
                      <Text style={s.couponType}>{cpn.type === 'FREEDEL' ? 'FREE DELIVERY' : 'DISCOUNT'}</Text>
                      {isActive && <Text style={s.activeIndicator}>ACTIVE</Text>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={[s.emptyCoupons, { backgroundColor: cardBg }]}>
                <Text style={{ fontSize: 20, marginBottom: 4 }}>🎡</Text>
                <Text style={s.emptyCouponsText}>NO ACTIVE COUPONS AVAILABLE</Text>
                <Text style={s.emptyCouponsSub}>SPIN THE WHEEL TO WIN UNIQUE CODES</Text>
              </View>
            )}
          </View>
        </StaggeredSection>

        {/* Payment */}
        <StaggeredSection delay={370} direction="up">
          <Text style={[s.sectionTitle, { color: txt, marginTop: 24 }]}>PAYMENT METHOD</Text>
          <View style={s.payRowNew}>
            {[
              { key: 'UPI', title: 'UPI INSTANT PAY', desc: 'Google Pay, PhonePe, Paytm', icon: '⚡' },
              { key: 'Card', title: 'CARD ON DELIVERY', desc: 'Delivery partner brings swipe POS', icon: '💳' },
              { key: 'COD', title: 'CASH ON DELIVERY', desc: 'Pay with physical cash on arrival', icon: '💵' },
            ].map(item => {
              const isActive = paymentMethod === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    s.payCardNew,
                    { backgroundColor: cardBg, borderColor: border },
                    isActive && { borderColor: COLORS.red, backgroundColor: isDark ? 'rgba(239,79,95,0.06)' : 'rgba(239,79,95,0.03)' }
                  ]}
                  onPress={() => setPaymentMethod(item.key as any)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                      <Text style={{ fontSize: 22 }}>{item.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.payCardTitle, isActive && { color: COLORS.red }]}>{item.title}</Text>
                        <Text style={s.payCardDesc}>{item.desc}</Text>
                      </View>
                    </View>
                    <View style={[s.radioOuter, { borderColor: isActive ? COLORS.red : border }]}>
                      {isActive && <View style={[s.radioInner, { backgroundColor: COLORS.red }]} />}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {paymentMethod === 'Card' && (
            <View style={[s.infoCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={{ fontSize: 22, marginRight: 12 }}>💳</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.infoTitle, { color: txt }]}>Card on Delivery</Text>
                <Text style={[s.infoDesc, { color: txtSec }]}>Our delivery partner carries a swipe POS machine. Pay securely when food arrives.</Text>
              </View>
            </View>
          )}

          {paymentMethod === 'UPI' && (
            <View style={[s.upiBox, { backgroundColor: cardBg }]}>
              <Text style={{ fontSize: 10, fontWeight: '900', color: COLORS.gold, letterSpacing: 2, marginBottom: 8 }}>SCAN & PAY INSTANTLY</Text>

              {/* UPI Intent Apps */}
              <View style={s.intentRow}>
                <TouchableOpacity style={s.intentBtn} onPress={openUpiApp}>
                  <Text style={{ fontSize: 20 }}>📲</Text>
                  <Text style={s.intentText}>PAY VIA INSTANT APP</Text>
                </TouchableOpacity>
              </View>

              {/* QR Code image display */}
              <View style={s.qrWrapper}>
                <Image
                  source={{ uri: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=kesavakesava764@ybl&pn=ZenvyNexus&am=${finalTotal.toFixed(2)}&cu=INR` }}
                  style={s.qrImage}
                />
                <TouchableOpacity style={s.copyUpiBtn} onPress={copyUpiId}>
                  <Text style={s.copyUpiText}>ID: kesavakesava764@ybl (TAP TO COPY)</Text>
                </TouchableOpacity>
              </View>

              {/* Dev Mode Simulator — only visible in development builds */}
              {__DEV__ && (
              <TouchableOpacity style={s.devSimBtn} onPress={simulateSuccess}>
                <Text style={s.devSimText}>⚡ SIMULATE PAYMENT (DEV MODE)</Text>
              </TouchableOpacity>
              )}

              <TextInput
                style={[s.input, { backgroundColor: bg, color: txt, marginTop: 12 }]}
                placeholder="Enter 12-Digit Transaction UTR No."
                placeholderTextColor={txtSec}
                value={upiUTR}
                onChangeText={setUpiUTR}
                keyboardType="numeric"
              />

              {/* Simulated Screenshot Upload */}
              <TouchableOpacity style={s.uploadBtn} onPress={attachMockScreenshot} disabled={isUploading}>
                {isUploading ? (
                  <ActivityIndicator color={COLORS.gold} />
                ) : (
                  <Text style={s.uploadBtnText}>
                    {upiScreenshot ? '✓ SCREENSHOT RECEIPT ATTACHED' : '📸 UPLOAD TRANSACTION SCREENSHOT'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </StaggeredSection>

        {/* Summary */}
        <StaggeredSection delay={450} direction="up">
          <View style={[s.billCard, { backgroundColor: cardBg, borderColor: border, borderWidth: 1, marginTop: 24 }]}>
            <View style={s.billRow}>
              <Text style={[s.billLabel, { color: txt }]}>ITEMS SUBTOTAL</Text>
              <Text style={[s.billVal, { color: txt }]}>₹{totalPrice}</Text>
            </View>
            <View style={s.billRow}>
              <Text style={[s.billLabel, { color: txt }]}>LOGISTICS FEE</Text>
              {isElite || zenPoints >= 200 ? (
                <Text style={[s.billVal, { color: COLORS.gold }]}>FREE BYPASS</Text>
              ) : (
                <Text style={[s.billVal, { color: txt }]}>₹{deliveryFee}</Text>
              )}
            </View>

            {selectedCoupon && (
              <View style={s.billRow}>
                <Text style={[s.billLabel, { color: COLORS.emerald }]}>COUPON DISCOUNT ({selectedCoupon.code})</Text>
                <Text style={[s.billVal, { color: COLORS.emerald }]}>-₹{couponDiscount}</Text>
              </View>
            )}

            <View style={[s.billRow, { borderTopWidth: 1, borderTopColor: border, paddingTop: 12, marginTop: 8 }]}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: txt }}>GRAND TOTAL</Text>
              <Text style={{ fontSize: 22, fontWeight: '900', color: COLORS.red }}>₹{finalTotal}</Text>
            </View>
          </View>
        </StaggeredSection>

        <FloatingPulse color={COLORS.red} style={s.placeBtnContainer}>
          <TouchableOpacity style={[s.placeBtn, { width: '100%' }]} onPress={handlePlaceOrder} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.placeText}>PLACE ORDER</Text>}
          </TouchableOpacity>
        </FloatingPulse>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 40 : 50, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  title: { fontSize: 13, fontWeight: '900', letterSpacing: 4 },
  scroll: { padding: 16 },
  sectionTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 3, marginBottom: 12 },
  campusRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  campusBtnNew: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, alignItems: 'center', borderWidth: 1.5, position: 'relative', overflow: 'hidden' },
  campusLabelNew: { fontSize: 10, fontWeight: '900', color: COLORS.textSecondary, letterSpacing: 0.5 },
  campusSubLabelNew: { fontSize: 7, fontWeight: '600', color: COLORS.textMuted, marginTop: 2 },
  activeCheckBadge: { position: 'absolute', top: 0, right: 0, borderBottomLeftRadius: 8, width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  activeCheckText: { color: '#000', fontSize: 8, fontWeight: '900' },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 13, marginBottom: 10, fontWeight: '600' },
  payRowNew: { gap: 10, marginBottom: 12 },
  payCardNew: { padding: 14, borderRadius: 16, borderWidth: 1.5 },
  payCardTitle: { fontSize: 11, fontWeight: '900', color: '#fff', letterSpacing: 1.5 },
  payCardDesc: { fontSize: 8, color: COLORS.textSecondary, fontWeight: '600', marginTop: 2 },
  radioOuter: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 8, height: 8, borderRadius: 4 },
  upiBox: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: COLORS.goldBorder },
  billCard: { padding: 16, borderRadius: 20 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  billLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  billVal: { fontSize: 12, fontWeight: '800' },
  placeBtnContainer: {
    marginTop: 24,
    marginBottom: Platform.OS === 'android' ? 80 : 40,
  },
  placeBtn: {
    backgroundColor: COLORS.red,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    ...SHADOWS.redGlow,
  },
  placeText: { fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 3 },

  // Delivery Time Scheduling
  timeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  timeTypeBtn: { flex: 1, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: COLORS.borderDark, alignItems: 'center' },
  timeTypeBtnActive: { borderColor: COLORS.gold },
  timeTypeLabel: { fontSize: 12, fontWeight: '900', marginTop: 6 },
  timeTypeLabelActive: { color: COLORS.gold },
  timeTypeSub: { fontSize: 9, color: COLORS.textSecondary, marginTop: 2 },
  scheduleSlotsContainer: { marginBottom: 16, padding: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: COLORS.borderDark },
  scheduleHelperText: { fontSize: 8, fontWeight: '900', color: COLORS.textSecondary, letterSpacing: 2, marginBottom: 10 },
  slotsGrid: { flexDirection: 'row', gap: 8 },
  slotBtn: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.borderDark, alignItems: 'center' },
  slotBtnActive: { borderColor: COLORS.gold, backgroundColor: 'rgba(201,168,76,0.1)' },
  slotEmojiLabel: { fontSize: 10, fontWeight: '800' },
  slotTimeLabel: { fontSize: 9, color: COLORS.gold, fontWeight: '800', marginTop: 4 },

  // Suggested Extras
  extrasScroll: { gap: 10, paddingRight: 16 },
  extraCard: { width: 120, padding: 12, borderRadius: 20, borderWidth: 1, borderColor: COLORS.borderDark, alignItems: 'center' },
  extraName: { fontSize: 9, fontWeight: '800', marginTop: 4, width: '100%', textAlign: 'center' },
  extraPrice: { fontSize: 10, fontWeight: '900', color: COLORS.gold, marginTop: 2 },
  extraAddBtn: { fontSize: 8, fontWeight: '900', color: '#000', backgroundColor: COLORS.gold, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 8 },

  // Gourmet Rewards
  rewardsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  pointsBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(201,168,76,0.1)' },
  pointsText: { fontSize: 9, fontWeight: '900', color: COLORS.gold },
  couponsScroll: { gap: 10, paddingRight: 16 },
  couponCard: { width: 130, padding: 12, borderRadius: 20, borderWidth: 1, borderColor: COLORS.borderDark, alignItems: 'center', position: 'relative' },
  couponCardActive: { borderColor: COLORS.gold, borderWidth: 1.5 },
  couponCode: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  couponType: { fontSize: 7, fontWeight: '800', color: COLORS.textSecondary, marginTop: 2 },
  activeIndicator: { fontSize: 8, fontWeight: '900', color: COLORS.gold, marginTop: 6 },
  emptyCoupons: { padding: 20, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.borderDark, alignItems: 'center' },
  emptyCouponsText: { fontSize: 9, fontWeight: '900', color: COLORS.textSecondary },
  emptyCouponsSub: { fontSize: 8, color: COLORS.textSecondary, marginTop: 2 },

  // Info Card
  infoCard: { flexDirection: 'row', padding: 16, borderRadius: 20, borderWidth: 1, alignItems: 'center', marginBottom: 16 },
  infoTitle: { fontSize: 12, fontWeight: '900' },
  infoDesc: { fontSize: 9, marginTop: 2 },

  // UPI Box QR
  intentRow: { marginBottom: 16 },
  intentBtn: { paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: COLORS.borderDark, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  intentText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  qrWrapper: { alignItems: 'center', marginVertical: 16 },
  qrImage: { width: 180, height: 180, borderRadius: 16, backgroundColor: '#fff' },
  copyUpiBtn: { marginTop: 10, padding: 6 },
  copyUpiText: { fontSize: 8, fontWeight: '900', color: COLORS.gold, letterSpacing: 1 },
  devSimBtn: { paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)', alignItems: 'center', marginVertical: 10 },
  devSimText: { fontSize: 8, fontWeight: '900', color: '#10b981', letterSpacing: 1 },
  uploadBtn: { paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.borderDark, alignItems: 'center', marginTop: 12, backgroundColor: 'rgba(255,255,255,0.01)' },
  uploadBtnText: { fontSize: 8, fontWeight: '900', color: COLORS.textSecondary, letterSpacing: 1 }
});
