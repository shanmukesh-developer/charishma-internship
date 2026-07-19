import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, Dimensions, Platform, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { ENDPOINTS, API_URL } from '../constants/api';
import { apiFetch } from '../utils/auth';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { io, Socket } from 'socket.io-client';
import { StaggeredSection, FloatingPulse, BounceIn } from '../components/AnimatedSection';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SW } = Dimensions.get('window');

interface BasketItem {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  priceEstimated: number;
  priceActual?: number;
  status: 'Pending' | 'Approved' | 'Unavailable';
}

interface MegaBasket {
  id: string;
  status: 'Created' | 'PaidEstimate' | 'PartnerAssigned' | 'Shopping' | 'PriceApprovalPending' | 'Approved' | 'Purchased' | 'Delivering' | 'Delivered';
  estimatedTotal: number;
  actualTotal?: number;
  shoppingFee: number;
  deliveryFee: number;
  deliveryAddress: string;
  deliveryPin: string;
  paymentMethod: 'COD' | 'UPI';
  paymentStatus: 'Pending' | 'Completed';
  upiUTR?: string;
  items: BasketItem[];
  deliveryPartner?: {
    name: string;
    phone: string;
    photoUrl?: string;
  };
  createdAt: string;
}

const QUICK_ITEMS = [
  { name: 'Fresh Lemon', unit: '3 pcs', priceEstimated: 10, category: '🍋 Fruits' },
  { name: 'Fresh Garlic', unit: '250 g', priceEstimated: 65, category: '🧄 Veggies' },
  { name: '24 MANTRA Organic Honey', unit: '500 g', priceEstimated: 380, category: '🍯 Wellness' },
  { name: 'Fresh Ginger', unit: '100 g', priceEstimated: 35, category: '🧄 Veggies' },
  { name: 'Organic Toor Dal', unit: '1 kg', priceEstimated: 159, category: '🌾 Staples' },
  { name: 'Cardamom Green', unit: '20 g', priceEstimated: 95, category: '🌶️ Masalas' },
  { name: 'Pure Ghee Jar', unit: '500 ml', priceEstimated: 340, category: '🥛 Dairy' },
  { name: 'Fortune Sunflower Oil', unit: '1 L', priceEstimated: 120, category: '🌻 Oils' }
];

export default function MegaBasketScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDark } = useTheme();
  
  const [activeTab, setActiveTab] = useState<'new' | 'list'>('new');
  
  // Form States
  const [items, setItems] = useState<BasketItem[]>([]);
  const [customName, setCustomName] = useState('');
  const [customQty, setCustomQty] = useState(1);
  const [customUnit, setCustomUnit] = useState('pcs');
  const [customPrice, setCustomPrice] = useState(20);
  const [deliveryAddress, setDeliveryAddress] = useState(
    user?.defaultAddress || ((user as any)?.hostelBlock && (user as any)?.roomNumber ? `Block ${(user as any).hostelBlock}, Room ${(user as any).roomNumber}` : '')
  );
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'UPI'>('COD');
  const [upiUTR, setUpiUTR] = useState('');
  const [placing, setPlacing] = useState(false);
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [createdBasketId, setCreatedBasketId] = useState<string | null>(null);

  // Lists & Live updates
  const [baskets, setBaskets] = useState<MegaBasket[]>([]);
  const [selectedBasket, setSelectedBasket] = useState<MegaBasket | null>(null);
  const [loadingBaskets, setLoadingBaskets] = useState(false);
  const [approvingPrice, setApprovingPrice] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Please sign in to order or manage daily essentials.',
        [
          { text: 'Cancel', onPress: () => router.replace('/(tabs)' as any), style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/login' as any) }
        ],
        { cancelable: false }
      );
      return;
    }
    fetchBaskets();
  }, [user]);

  // Socket Connection for selected basket
  useEffect(() => {
    if (!selectedBasket) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const basketIdStr = selectedBasket.id.toString();
    const socket = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinRoom', basketIdStr);
      console.log('[SOCKET] Mobile joined basket room:', basketIdStr);
    });

    socket.on('statusUpdated', (data: { id: string; status: MegaBasket['status']; actualTotal?: number }) => {
      if (data.id === selectedBasket.id) {
        Alert.alert('Status Updated', `Basket status is now: ${data.status}!`);
        setSelectedBasket(prev => prev ? { ...prev, status: data.status, actualTotal: data.actualTotal ?? prev.actualTotal } : null);
        fetchBaskets();
      }
    });

    socket.on('basket_item_updated', (item: BasketItem) => {
      Alert.alert('Item Updated', `Rider updated item: ${item.name}!`);
      setSelectedBasket(prev => {
        if (!prev) return null;
        const updatedItems = prev.items.map(i => i.name === item.name ? { ...i, ...item } : i);
        return { ...prev, items: updatedItems };
      });
      fetchBaskets();
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedBasket]);

  const fetchBaskets = async () => {
    setLoadingBaskets(true);
    try {
      const res = await apiFetch(ENDPOINTS.megaBasketList);
      if (res.ok) {
        const data = await res.json();
        setBaskets(data);
        if (selectedBasket) {
          const fresh = data.find((b: MegaBasket) => b.id === selectedBasket.id);
          if (fresh) setSelectedBasket(fresh);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBaskets(false);
    }
  };

  const handleQuickAdd = (item: typeof QUICK_ITEMS[0]) => {
    const exists = items.find(i => i.name === item.name);
    if (exists) {
      setItems(prev => prev.map(i => i.name === item.name ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setItems(prev => [...prev, {
        name: item.name,
        quantity: 1,
        unit: item.unit,
        priceEstimated: item.priceEstimated,
        status: 'Pending'
      }]);
    }
  };

  const handleAddCustom = () => {
    if (!customName.trim()) {
      Alert.alert('Error', 'Please enter an item name');
      return;
    }
    const exists = items.find(i => i.name.toLowerCase() === customName.trim().toLowerCase());
    if (exists) {
      Alert.alert('Warning', 'Item already in list.');
      return;
    }
    setItems(prev => [...prev, {
      name: customName.trim(),
      quantity: customQty,
      unit: customUnit,
      priceEstimated: customPrice,
      status: 'Pending'
    }]);
    setCustomName('');
    setCustomQty(1);
    setCustomPrice(20);
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const subtotal = useMemo(() => {
    return items.reduce((acc, curr) => acc + (curr.priceEstimated * curr.quantity), 0);
  }, [items]);

  const shoppingFee = 30;
  const deliveryFee = 20;
  const grandTotal = subtotal + shoppingFee + deliveryFee;

  const handlePlaceOrder = async () => {
    if (items.length === 0) {
      Alert.alert('Error', 'Your basket is empty!');
      return;
    }
    if (!deliveryAddress.trim()) {
      Alert.alert('Error', 'Delivery address is required!');
      return;
    }

    setPlacing(true);
    try {
      const res = await apiFetch(ENDPOINTS.megaBasketCreate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          deliveryAddress,
          paymentMethod
        })
      });

      if (res.ok) {
        const basket = await res.json();
        setCreatedBasketId(basket.id);
        if (paymentMethod === 'UPI') {
          setShowUpiModal(true);
        } else {
          Alert.alert('Success', 'Essentials basket order placed!');
          setItems([]);
          fetchBaskets();
          setSelectedBasket(basket);
          setActiveTab('list');
        }
      } else {
        const err = await res.json();
        Alert.alert('Error', err.message || 'Failed to place order');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error placing order');
    } finally {
      setPlacing(false);
    }
  };

  const handleUpiSubmit = async () => {
    if (!upiUTR.trim() || upiUTR.trim().length < 6) {
      Alert.alert('Error', 'Enter a valid UPI Reference / UTR Number');
      return;
    }
    if (!createdBasketId) return;

    try {
      const res = await apiFetch(ENDPOINTS.megaBasketPay(createdBasketId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upiUTR })
      });

      if (res.ok) {
        const data = await res.json();
        Alert.alert('Verified', 'Payment submitted! Awaiting dispatch.');
        setShowUpiModal(false);
        setUpiUTR('');
        setItems([]);
        fetchBaskets();
        setSelectedBasket(data.basket);
        setActiveTab('list');
      } else {
        Alert.alert('Error', 'Submission failed');
      }
    } catch (err) {
      Alert.alert('Error', 'Server error during payment submission');
    }
  };

  const handleApproveBill = async () => {
    if (!selectedBasket) return;
    setApprovingPrice(true);
    try {
      const res = await apiFetch(ENDPOINTS.megaBasketApprove(selectedBasket.id), {
        method: 'POST'
      });
      if (res.ok) {
        Alert.alert('Success', 'Prices approved! Rider is purchasing now.');
        fetchBaskets();
      } else {
        Alert.alert('Error', 'Approval failed');
      }
    } catch (err) {
      Alert.alert('Error', 'Network error');
    } finally {
      setApprovingPrice(false);
    }
  };

  const getStatusStep = (status: MegaBasket['status']) => {
    const steps = ['Created', 'PaidEstimate', 'PartnerAssigned', 'Shopping', 'PriceApprovalPending', 'Approved', 'Purchased', 'Delivering', 'Delivered'];
    return steps.indexOf(status);
  };

  const getStatusLabel = (status: MegaBasket['status']) => {
    const labels: Record<MegaBasket['status'], string> = {
      Created: 'Created (Awaiting Payment)',
      PaidEstimate: 'Payment Verified (Finding Rider)',
      PartnerAssigned: 'Rider Claimed Job',
      Shopping: 'Rider is in the Shop 🛒',
      PriceApprovalPending: 'Price Approval Required 🚨',
      Approved: 'Prices Approved by You',
      Purchased: 'Items Purchased, Packing',
      Delivering: 'Rider is en route 🚀',
      Delivered: 'Completed & Delivered 🎉'
    };
    return labels[status] || status;
  };

  const txt = isDark ? '#FFF' : '#111';
  const txtSec = isDark ? '#AAA' : '#666';
  const bg = isDark ? '#0A0A0C' : '#FAFAFA';
  const cardBg = isDark ? '#141416' : '#FFF';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity 
          style={s.backBtn} 
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }}
        >
          <Text style={[s.backIcon, { color: txt }]}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.subText}>MEGA BASKET</Text>
          <Text style={[s.title, { color: txt }]}>Essentials Delivery</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={[s.tabRow, { backgroundColor: cardBg, borderColor: border }]}>
        <TouchableOpacity 
          style={[s.tabBtn, activeTab === 'new' && s.tabBtnActive]} 
          onPress={() => { setActiveTab('new'); setSelectedBasket(null); }}
        >
          {activeTab === 'new' ? (
            <LinearGradient
              colors={['#10B981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Text style={[s.tabLabel, activeTab === 'new' && s.tabLabelActive]}>CREATE BASKET</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[s.tabBtn, activeTab === 'list' && s.tabBtnActive]} 
          onPress={() => { setActiveTab('list'); fetchBaskets(); }}
        >
          {activeTab === 'list' ? (
            <LinearGradient
              colors={['#10B981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Text style={[s.tabLabel, activeTab === 'list' && s.tabLabelActive]}>
            ACTIVE BASKETS ({baskets.filter(b => b.status !== 'Delivered').length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {activeTab === 'new' ? (
          <View style={s.scrollContent}>
            {/* Quick Add */}
            <StaggeredSection delay={50} direction="up">
              <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={s.cardTitle}>QUICK ADD ESSENTIALS</Text>
                <View style={s.quickGrid}>
                  {QUICK_ITEMS.map((item, idx) => (
                    <TouchableOpacity key={idx} style={[s.quickItem, { borderColor: border }]} onPress={() => handleQuickAdd(item)}>
                      <Text style={s.quickCat}>{item.category}</Text>
                      <Text style={[s.quickName, { color: txt }]} numberOfLines={1}>{item.name}</Text>
                      <Text style={s.quickPrice}>Est. ₹{item.priceEstimated}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Custom Input */}
                <View style={s.customSection}>
                  <Text style={s.customTitle}>ADD CUSTOM SPECIAL REQUEST</Text>
                  <TextInput 
                    style={[s.input, { color: txt, borderColor: border }]}
                    placeholder="Enter item name (e.g. Tomato Sauce, Blue Pen)"
                    placeholderTextColor={txtSec}
                    value={customName}
                    onChangeText={setCustomName}
                  />
                  <View style={s.customRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>Qty</Text>
                      <TextInput 
                        style={[s.input, { color: txt, borderColor: border, textAlign: 'center' }]}
                        keyboardType="numeric"
                        value={customQty.toString()}
                        onChangeText={(val) => setCustomQty(Math.max(1, parseInt(val) || 1))}
                      />
                    </View>
                    <View style={{ flex: 1.5, marginHorizontal: 8 }}>
                      <Text style={s.inputLabel}>Unit</Text>
                      <TextInput 
                        style={[s.input, { color: txt, borderColor: border, textAlign: 'center' }]}
                        value={customUnit}
                        onChangeText={setCustomUnit}
                        placeholder="pcs / kg / packet"
                        placeholderTextColor={txtSec}
                      />
                    </View>
                    <View style={{ flex: 1.5 }}>
                      <Text style={s.inputLabel}>Est Price</Text>
                      <TextInput 
                        style={[s.input, { color: txt, borderColor: border, textAlign: 'center' }]}
                        keyboardType="numeric"
                        value={customPrice.toString()}
                        onChangeText={(val) => setCustomPrice(Math.max(0, parseFloat(val) || 0))}
                      />
                    </View>
                  </View>
                  <TouchableOpacity style={s.addCustomBtn} onPress={handleAddCustom}>
                    <Text style={s.addCustomText}>+ ADD TO SHOPPING LIST</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </StaggeredSection>

            {/* Shopping List Items */}
            {items.length > 0 && (
              <StaggeredSection delay={130} direction="up">
                <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                  <Text style={s.cardTitle}>YOUR SHOPPING LIST ({items.length})</Text>
                  <View style={{ gap: 8, marginBottom: 12 }}>
                    {items.map((item, idx) => (
                      <View key={idx} style={[s.listItem, { borderColor: border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.listItemName, { color: txt }]}>{item.name}</Text>
                          <Text style={s.listItemSub}>{item.quantity} {item.unit} • Est. ₹{item.priceEstimated}/unit</Text>
                        </View>
                        <Text style={s.listItemPrice}>₹{item.priceEstimated * item.quantity}</Text>
                        <TouchableOpacity style={s.removeBtn} onPress={() => handleRemoveItem(idx)}>
                          <Text style={s.removeText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>

                  {/* Subtotals */}
                  <View style={[s.summaryContainer, { borderTopColor: border }]}>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 10 }}>Items Subtotal</Text>
                      <Text style={{ color: txt, fontSize: 10 }}>₹{subtotal}</Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 10 }}>Personal Shopper Fee</Text>
                      <Text style={{ color: txt, fontSize: 10 }}>₹{shoppingFee}</Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 10 }}>Hostel Delivery Fee</Text>
                      <Text style={{ color: txt, fontSize: 10 }}>₹{deliveryFee}</Text>
                    </View>
                    <View style={[s.summaryRow, s.grandTotalRow, { borderTopColor: border }]}>
                      <Text style={{ color: txt, fontSize: 12, fontWeight: '900' }}>Estimated Total Bill</Text>
                      <Text style={{ color: COLORS.red, fontSize: 14, fontWeight: '900' }}>₹{grandTotal}</Text>
                    </View>
                  </View>
                </View>
              </StaggeredSection>
            )}

            {/* Delivery address & Payment */}
            <StaggeredSection delay={210} direction="up">
              <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={s.cardTitle}>DELIVERY & PAYMENT SETUP</Text>
                <Text style={s.inputLabel}>Delivery Address (Hostel & Room)</Text>
                <TextInput 
                  style={[s.input, { color: txt, borderColor: border }]}
                  placeholder="e.g. Block B, Room 202"
                  placeholderTextColor={txtSec}
                  value={deliveryAddress}
                  onChangeText={setDeliveryAddress}
                />

                <Text style={[s.inputLabel, { marginTop: 12 }]}>Payment Method</Text>
                <View style={s.paymentRow}>
                  <TouchableOpacity 
                    style={[s.paymentBtn, paymentMethod === 'COD' && s.paymentBtnActive, { borderColor: border }]} 
                    onPress={() => setPaymentMethod('COD')}
                  >
                    <Text style={[s.paymentBtnText, paymentMethod === 'COD' && { color: '#FFF' }]}>CASH / COD</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[s.paymentBtn, paymentMethod === 'UPI' && s.paymentBtnActive, { borderColor: border }]} 
                    onPress={() => setPaymentMethod('UPI')}
                  >
                    <Text style={[s.paymentBtnText, paymentMethod === 'UPI' && { color: '#FFF' }]}>PAY UPI ADVANCE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </StaggeredSection>

            {/* Submit button */}
            <FloatingPulse color={COLORS.red} style={s.placeOrderBtnContainer}>
              <TouchableOpacity style={[s.placeOrderBtn, { width: '100%' }]} onPress={handlePlaceOrder} disabled={placing}>
                {placing ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={s.placeOrderText}>PLACE SHOPPING ORDER (EST. ₹{grandTotal})</Text>
                )}
              </TouchableOpacity>
            </FloatingPulse>
          </View>
        ) : (
          <View style={s.scrollContent}>
            {selectedBasket ? (
              <View>
                <TouchableOpacity style={s.backToListBtn} onPress={() => setSelectedBasket(null)}>
                  <Text style={s.backToListText}>← BACK TO BASKETS LIST</Text>
                </TouchableOpacity>

                <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                  <View style={s.cardHeaderRow}>
                    <View>
                      <Text style={s.inputLabel}>BASKET CODE</Text>
                      <Text style={s.basketCode}>#{selectedBasket.id.slice(-6).toUpperCase()}</Text>
                    </View>
                    <View style={s.statusBadge}>
                      <Text style={s.statusBadgeText}>{selectedBasket.status.toUpperCase()}</Text>
                    </View>
                  </View>

                  {/* Operational details */}
                  <View style={s.statusDetailBox}>
                    <Text style={s.statusDetailLabel}>OPERATIONAL STATE</Text>
                    <Text style={[s.statusDetailText, { color: txt }]}>{getStatusLabel(selectedBasket.status)}</Text>

                    {selectedBasket.deliveryPartner && (
                      <View style={s.partnerBox}>
                        <Text style={{ fontSize: 16 }}>👤</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={s.partnerLabel}>PERSONAL SHOPPER</Text>
                          <Text style={[s.partnerName, { color: txt }]}>{selectedBasket.deliveryPartner.name}</Text>
                          <Text style={s.partnerPhone}>Call: {selectedBasket.deliveryPartner.phone}</Text>
                        </View>
                      </View>
                    )}
                  </View>

                  {/* Delivery PIN Code */}
                  {getStatusStep(selectedBasket.status) >= getStatusStep('Approved') && (
                    <View style={s.pinBox}>
                      <Text style={s.pinLabel}>SECURE DELIVERY PIN</Text>
                      <Text style={s.pinVal}>{selectedBasket.deliveryPin}</Text>
                      <Text style={s.pinSub}>Provide this to the rider upon delivery</Text>
                    </View>
                  )}

                  {/* Price Approval pending alerts */}
                  {selectedBasket.status === 'PriceApprovalPending' && (
                    <View style={s.approvalAlertBox}>
                      <Text style={s.approvalAlertTitle}>🚨 Price Approval Required</Text>
                      <Text style={s.approvalAlertDesc}>
                        The shopper has uploaded actual prices. The actual total is ₹{selectedBasket.actualTotal}. Please approve the pricing below.
                      </Text>
                      <TouchableOpacity style={s.approveBtn} onPress={handleApproveBill} disabled={approvingPrice}>
                        {approvingPrice ? (
                          <ActivityIndicator size="small" color="#000" />
                        ) : (
                          <Text style={s.approveBtnText}>APPROVE ACTUAL PRICES & PROCEED</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Items list */}
                  <Text style={s.cardTitle}>SHOP PRICE CHECKLIST</Text>
                  <View style={{ gap: 8, marginBottom: 16 }}>
                    {selectedBasket.items.map((item, idx) => {
                      const isShopping = getStatusStep(selectedBasket.status) >= getStatusStep('Shopping');
                      const actualPrice = item.priceActual !== undefined ? item.priceActual : null;
                      
                      return (
                        <View key={idx} style={[s.listItem, { borderColor: border }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.listItemName, item.status === 'Unavailable' && { textDecorationLine: 'line-through', color: '#ff6b6b' }, { color: txt }]}>
                              {item.name}
                            </Text>
                            <Text style={s.listItemSub}>
                              Qty: {item.quantity} {item.unit} • Est: ₹{item.priceEstimated}/unit
                            </Text>
                          </View>

                          <View style={{ alignItems: 'flex-end' }}>
                            {item.status === 'Unavailable' ? (
                              <View style={s.unavailableBadge}><Text style={s.unavailableText}>Unavailable</Text></View>
                            ) : isShopping && actualPrice !== null ? (
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={s.actualItemPrice}>Actual: ₹{actualPrice * item.quantity}</Text>
                                {actualPrice !== item.priceEstimated && (
                                  <Text style={[s.priceDiffText, { color: actualPrice > item.priceEstimated ? '#ff6b6b' : '#22c55e' }]}>
                                    {actualPrice > item.priceEstimated ? '↑ Higher' : '↓ Lower'}
                                  </Text>
                                )}
                              </View>
                            ) : (
                              <Text style={[s.listItemPrice, { color: txtSec }]}>Est: ₹{item.priceEstimated * item.quantity}</Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  {/* Summaries */}
                  <View style={[s.summaryContainer, { borderTopColor: border }]}>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 10 }}>Shopping & Checkout Fee</Text>
                      <Text style={{ color: txt, fontSize: 10 }}>₹{selectedBasket.shoppingFee}</Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={{ color: txtSec, fontSize: 10 }}>Hostel Delivery Fee</Text>
                      <Text style={{ color: txt, fontSize: 10 }}>₹{selectedBasket.deliveryFee}</Text>
                    </View>
                    <View style={[s.summaryRow, s.grandTotalRow, { borderTopColor: border }]}>
                      <Text style={{ color: txt, fontSize: 12, fontWeight: '900' }}>Grand Total Bill</Text>
                      <Text style={{ color: COLORS.red, fontSize: 14, fontWeight: '900' }}>
                        ₹{(selectedBasket.actualTotal || selectedBasket.estimatedTotal) + selectedBasket.shoppingFee + selectedBasket.deliveryFee}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <View>
                {loadingBaskets && baskets.length === 0 ? (
                  <ActivityIndicator size="large" color={COLORS.red} style={{ marginTop: 40 }} />
                ) : baskets.length === 0 ? (
                  <View style={s.emptyState}>
                    <Text style={{ fontSize: 48, marginBottom: 12 }}>🛒</Text>
                    <Text style={[s.emptyTitle, { color: txt }]}>NO ACTIVE BASKETS</Text>
                    <Text style={s.emptySub}>You don't have any daily essentials baskets active right now.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 12 }}>
                    {baskets.map((basket) => (
                      <TouchableOpacity 
                        key={basket.id} 
                        style={[s.card, { backgroundColor: cardBg, borderColor: border }]}
                        onPress={() => setSelectedBasket(basket)}
                      >
                        <View style={s.cardHeaderRow}>
                          <Text style={s.basketCode}>BASKET #{basket.id.slice(-6).toUpperCase()}</Text>
                          <View style={s.statusBadge}>
                            <Text style={s.statusBadgeText}>{basket.status.toUpperCase()}</Text>
                          </View>
                        </View>
                        <Text style={[s.basketItemsText, { color: txtSec }]} numberOfLines={1}>
                          {basket.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                        </Text>
                        <View style={s.basketFooterRow}>
                          <Text style={{ fontSize: 8, color: '#888' }}>{new Date(basket.createdAt).toLocaleDateString()}</Text>
                          <Text style={s.basketPrice}>₹{(basket.actualTotal || basket.estimatedTotal) + basket.shoppingFee + basket.deliveryFee}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* UPI QR verification modal */}
      <Modal visible={showUpiModal} transparent={true} animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>SUBMIT UPI ADVANCE PAYMENT</Text>
            <Text style={s.modalDesc}>
              Scan the campus UPI QR to transfer the estimated advance amount of ₹{grandTotal}.
            </Text>

            {/* Gorgeous visual QR mockup */}
            <View style={s.qrMockBox}>
              <View style={s.qrBorderSquare}>
                <Text style={{ fontSize: 32 }}>📲</Text>
                <Text style={s.qrScanText}>CAMPUS UPI MERCHANT</Text>
                <Text style={s.qrUpiId}>zenvy@ybl</Text>
              </View>
            </View>

            <Text style={s.inputLabel}>12-Digit Transaction Reference (UTR)</Text>
            <TextInput 
              style={s.utrInput}
              placeholder="e.g. 340590112345"
              placeholderTextColor="#888"
              keyboardType="numeric"
              value={upiUTR}
              onChangeText={setUpiUTR}
            />

            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => { setShowUpiModal(false); setUpiUTR(''); }}>
                <Text style={s.modalCancelText}>PAY COD</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalSubmitBtn} onPress={handleUpiSubmit}>
                <Text style={s.modalSubmitText}>VERIFY PAYMENT</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backIcon: { fontSize: 32, fontWeight: '300' },
  subText: { fontSize: 8, fontWeight: '900', color: COLORS.red, letterSpacing: 2 },
  title: { fontSize: 18, fontWeight: '900' },

  tabRow: { flexDirection: 'row', padding: 4, borderRadius: 16, borderWidth: 1, marginHorizontal: 16, marginVertical: 12 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 12, overflow: 'hidden' },
  tabBtnActive: { backgroundColor: 'transparent' },
  tabLabel: { fontSize: 9, fontWeight: '900', color: '#888', letterSpacing: 1 },
  tabLabelActive: { color: '#FFF' },

  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  card: { padding: 16, borderRadius: 24, borderWidth: 1, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  cardTitle: { fontSize: 10, fontWeight: '900', color: COLORS.red, letterSpacing: 1.5, marginBottom: 12 },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  quickItem: { width: (SW - 48 - 8) / 2, padding: 10, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.02)' },
  quickCat: { fontSize: 7, fontWeight: '900', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  quickName: { fontSize: 10, fontWeight: '900' },
  quickPrice: { fontSize: 9, fontWeight: '900', color: '#22c55e', marginTop: 6 },

  customSection: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 16 },
  customTitle: { fontSize: 8, fontWeight: '900', color: '#888', letterSpacing: 1, marginBottom: 8 },
  input: { height: 40, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 11, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.02)', marginBottom: 8 },
  inputLabel: { fontSize: 8, fontWeight: '900', color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  customRow: { flexDirection: 'row', marginBottom: 12 },
  addCustomBtn: { height: 40, backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)' },
  addCustomText: { fontSize: 9, fontWeight: '900', color: '#22c55e', letterSpacing: 1 },

  listItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.02)', marginBottom: 6 },
  listItemName: { fontSize: 11, fontWeight: '900' },
  listItemSub: { fontSize: 8, color: '#888', fontWeight: '600', marginTop: 1 },
  listItemPrice: { fontSize: 11, fontWeight: '900', color: '#22c55e', marginRight: 10 },
  removeBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 8, color: '#ef4444', fontWeight: '900' },

  summaryContainer: { borderTopWidth: 1, paddingTop: 12, gap: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandTotalRow: { borderTopWidth: 1, paddingTop: 8, marginTop: 4 },

  paymentRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  paymentBtn: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.02)' },
  paymentBtnActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
  paymentBtnText: { fontSize: 9, fontWeight: '900', color: '#888', letterSpacing: 1 },

  placeOrderBtnContainer: {
    height: 50,
  },
  placeOrderBtn: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeOrderText: { fontSize: 10, fontWeight: '900', color: '#FFF', letterSpacing: 1.5 },

  backToListBtn: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 8 },
  backToListText: { fontSize: 9, fontWeight: '900', color: COLORS.red, letterSpacing: 1 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  basketCode: { fontSize: 14, fontWeight: '900', color: COLORS.red },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)' },
  statusBadgeText: { fontSize: 8, fontWeight: '900', color: '#22c55e', letterSpacing: 0.5 },

  statusDetailBox: { padding: 12, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.02)', borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.05)', marginBottom: 16 },
  statusDetailLabel: { fontSize: 7, fontWeight: '900', color: '#888', letterSpacing: 1, marginBottom: 2 },
  statusDetailText: { fontSize: 11, fontWeight: '900' },
  partnerBox: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)' },
  partnerLabel: { fontSize: 7, fontWeight: '900', color: '#888' },
  partnerName: { fontSize: 11, fontWeight: '900' },
  partnerPhone: { fontSize: 8, fontWeight: '900', color: '#22c55e', marginTop: 2 },

  pinBox: { padding: 16, borderRadius: 16, backgroundColor: 'rgba(34,197,94,0.03)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.15)', alignItems: 'center', marginBottom: 16 },
  pinLabel: { fontSize: 8, fontWeight: '900', color: '#22c55e', letterSpacing: 1 },
  pinVal: { fontSize: 24, fontWeight: '900', color: '#22c55e', letterSpacing: 6, marginVertical: 6 },
  pinSub: { fontSize: 7, fontWeight: '800', color: '#888' },

  approvalAlertBox: { padding: 14, borderRadius: 16, backgroundColor: 'rgba(245,158,11,0.05)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)', marginBottom: 16 },
  approvalAlertTitle: { fontSize: 11, fontWeight: '900', color: '#f59e0b', marginBottom: 4 },
  approvalAlertDesc: { fontSize: 8, fontWeight: '600', color: '#888', lineHeight: 12, marginBottom: 12 },
  approveBtn: { height: 38, backgroundColor: '#f59e0b', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  approveBtnText: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 1 },

  unavailableBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.1)' },
  unavailableText: { fontSize: 8, fontWeight: '900', color: '#ef4444' },
  actualItemPrice: { fontSize: 11, fontWeight: '900', color: '#22c55e' },
  priceDiffText: { fontSize: 7, fontWeight: '900', marginTop: 1 },

  basketItemsText: { fontSize: 10, fontWeight: '600', marginBottom: 8 },
  basketFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 8, marginTop: 4 },
  basketPrice: { fontSize: 12, fontWeight: '900', color: '#22c55e' },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 4 },
  emptySub: { fontSize: 8, fontWeight: '600', color: '#888', textAlign: 'center', paddingHorizontal: 24, lineHeight: 12 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 340, backgroundColor: '#141416', borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 20 },
  modalTitle: { fontSize: 11, fontWeight: '900', color: COLORS.red, letterSpacing: 1.5, textAlign: 'center', marginBottom: 8 },
  modalDesc: { fontSize: 8, fontWeight: '700', color: '#888', textAlign: 'center', lineHeight: 12, marginBottom: 16 },
  qrMockBox: { alignItems: 'center', marginBottom: 20 },
  qrBorderSquare: { width: 160, height: 160, borderRadius: 16, borderWidth: 2, borderColor: '#22c55e', backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', gap: 6 },
  qrScanText: { fontSize: 8, fontWeight: '900', color: '#000' },
  qrUpiId: { fontSize: 8, fontWeight: '900', color: '#888' },
  utrInput: { height: 40, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.3)', color: '#FFF', textAlign: 'center', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 8 },
  modalCancelBtn: { flex: 1, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 9, fontWeight: '900', color: '#aaa', letterSpacing: 1 },
  modalSubmitBtn: { flex: 1.2, height: 38, borderRadius: 10, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center' },
  modalSubmitText: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 1 }
});
