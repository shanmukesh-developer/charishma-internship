import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, TextInput, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import { useRouter, useIsFocused } from 'expo-router';
import { COLORS, SHADOWS } from '../../constants/theme';
import { useCart, useBasketQuote, useServiceability, isCustomRequest, DELIVERY_INSTRUCTIONS, DELIVERY_INSTRUCTIONS_KEY } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { summarizeCustomizations } from '../../components/CustomizeDrawer';
import AmbientBackground from '../../components/AmbientBackground';
import { StaggeredSection, FloatingPulse, BounceIn } from '../../components/AnimatedSection';
import DopaminePressable, { ActionPressable } from '../../components/DopaminePressable';
import SafeImage from '../../components/SafeImage';
import { stallPayCopy } from '../../utils/localVendor';

export default function BasketScreen() {
  const basketFocused = useIsFocused();
  const { isDark, colors } = useTheme();
  const { user } = useAuth();
  const { cart, removeFromCart, updateQuantity, clearCart, removeItems, totalPrice, totalItems, roomCode, isHosting, roomStatus, roomMessage, handleHostRoom, handleJoinRoom, handleDisconnect } = useCart();
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [selectedInstructions, setSelectedInstructions] = useState<string[]>([]);
  const router = useRouter();

  // The bill comes from the server (POST /api/orders/quote); guests see an item estimate only.
  const { quote, loading: quoteLoading, error: quoteError, refresh: refreshQuote, hasOrderLines } = useBasketQuote(null, !!user, basketFocused);
  const { serviceability } = useServiceability();
  const isClosed = quote?.serviceability?.open === false || serviceability?.open === false;
  const closedMessage = quote?.serviceability?.message || serviceability?.message ||
    `Campus kitchens are closed for the night. Ordering opens again at ${serviceability?.reopensAt || '6:00 AM'}.`;
  const customCount = cart.filter((i) => isCustomRequest(i)).length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(DELIVERY_INSTRUCTIONS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (!cancelled && Array.isArray(parsed)) setSelectedInstructions(parsed.filter((x) => typeof x === 'string'));
        }
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleInstruction = (id: string) => {
    setSelectedInstructions((prev) => {
      const updated = prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id];
      AsyncStorage.setItem(DELIVERY_INSTRUCTIONS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  };

  const unavailable: { id?: string; name?: string }[] = quoteError?.code === 'ITEMS_UNAVAILABLE' && Array.isArray(quoteError.body?.unavailableItems)
    ? quoteError.body.unavailableItems
    : quoteError?.code === 'BOOKING_ONLY_ITEMS' && Array.isArray(quoteError.body?.bookingOnlyItems)
      ? quoteError.body.bookingOnlyItems.map((n: any) => ({ name: String(n || '') }))
      : [];
  // CampusBites stall basket: the stall delivers it, cash to the stall
  const stallLine = cart.find((i) => i.isStall && !isCustomRequest(i));
  const isStallBasket = quote ? quote.fulfilment === 'VENDOR' : !!stallLine;
  const stallName = quote?.store?.name || stallLine?.restaurantName || 'the stall';
  const checkoutLabel = quote && !quoteLoading
    ? `PROCEED TO CHECKOUT • ₹${quote.finalPrice}`
    : `PROCEED TO CHECKOUT • ${totalItems} ITEM${totalItems === 1 ? '' : 'S'}`;

  const bg = colors.bg;
  const cardBg = colors.card;
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;
  const actionBtnBg = COLORS.red;

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: bg }]} enabled={basketFocused}>
      <AmbientBackground />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={user && hasOrderLines ? <RefreshControl refreshing={false} onRefresh={refreshQuote} tintColor={goldColor} colors={[COLORS.red]} /> : undefined}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
          <Text style={[s.pageTitle, { color: txt, marginBottom: 0, paddingHorizontal: 0 }]}>MY BASKET</Text>
          {cart.length > 0 && (
            <TouchableOpacity
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)' }}
              onPress= {() => {
                Alert.alert(
                  'Clear Basket?',
                  'Are you sure you want to remove all items from your basket?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear All',
                      style: 'destructive',
                      onPress: () => clearCart(),
                    }
                  ]
                );
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#EF4444', letterSpacing: 1 }}>EMPTY BASKET</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Group Cart */}
        <StaggeredSection delay={50} direction="up">
          <View style={[s.groupCard, { backgroundColor: cardBg, borderColor: border }]}>
            {!roomCode ? (
              <View>
                <Text style={{ fontSize: 11, fontWeight: '900', color: goldColor, letterSpacing: 2, marginBottom: 2 }}>ROOMMATE GROUP CART</Text>
                <Text style={[s.groupDesc, { color: txtSec }]}>BUILD ONE BASKET TOGETHER WITH YOUR ROOMMATES — ONE PERSON CHECKS OUT AND PAYS</Text>
                <View style={s.groupBtns}>
                  <TouchableOpacity style={[s.hostBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]} onPress={handleHostRoom}>
                    <Text style={[s.hostBtnText, { color: txt }]}>📡 HOST CART</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.joinBtn, { backgroundColor: goldColor }]} onPress={() => setIsJoinOpen(!isJoinOpen)}>
                    <Text style={s.joinBtnText}>👥 JOIN CART</Text>
                  </TouchableOpacity>
                </View>
                {isJoinOpen && (
                  <View style={s.joinInputRow}>
                    <TextInput
                      style={[s.joinInput, { color: txt, borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F1F4F8' }]}
                      placeholder="ENTER ROOM CODE (e.g. ZN-8B2A4KQ7XM)"
                      placeholderTextColor={txtSec}
                      value={inputCode}
                      onChangeText={setInputCode}
                      autoCapitalize="characters"
                    />
                    <TouchableOpacity 
                      style={[s.joinSubmit, { backgroundColor: goldColor }]} 
                      onPress={() => { 
                        if (!inputCode || inputCode.trim().length < 3) {
                          Alert.alert('Invalid Code', 'Please enter a valid room code.');
                          return;
                        }
                        handleJoinRoom(inputCode.trim().toUpperCase()); 
                        setIsJoinOpen(false); 
                      }}
                    >
                      <Text style={s.joinSubmitText}>CONNECT</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <View style={s.activeRoomCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: roomMessage ? 6 : 12 }}>
                  {roomStatus === 'connecting' ? (
                    <ActivityIndicator size="small" color={goldColor} />
                  ) : (
                    <View style={[s.liveDot, roomStatus !== 'live' && { backgroundColor: roomStatus === 'error' ? '#EF4444' : '#F59E0B' }]} />
                  )}
                  <Text style={{ fontSize: 10, fontWeight: '900', color: roomStatus === 'live' ? '#10B981' : roomStatus === 'error' ? '#EF4444' : txtSec, letterSpacing: 2 }}>
                    {roomStatus === 'live'
                      ? `LIVE ROOM ACTIVE (${isHosting ? 'HOST' : 'JOINED'})`
                      : roomStatus === 'connecting'
                        ? 'CONNECTING…'
                        : roomStatus === 'waiting'
                          ? 'WAITING FOR HOST'
                          : roomStatus === 'error'
                            ? 'CONNECTION PROBLEM'
                            : `ROOM ${isHosting ? 'HOST' : 'JOINED'}`}
                  </Text>
                </View>
                {!!roomMessage && (
                  <Text style={{ fontSize: 10, color: txtSec, fontWeight: '600', marginBottom: 10, lineHeight: 15 }}>{roomMessage}</Text>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontSize: 9, color: txtSec, fontWeight: '700', letterSpacing: 1, marginBottom: 2 }}>ROOM CODE</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 18, fontWeight: '900', color: goldColor }}>{roomCode}</Text>
                      <TouchableOpacity 
                        style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB' }}
                        onPress={() => {
                          Clipboard.setString(roomCode);
                          Alert.alert('Copied!', `Room code ${roomCode} copied to clipboard. Share with your roommates!`);
                        }}
                      >
                        <Text style={{ fontSize: 10, fontWeight: '800', color: txt }}>📋 COPY</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <TouchableOpacity style={s.disconnectBtn} onPress={handleDisconnect}>
                    <Text style={s.disconnectText}>🚫 DISCONNECT</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </StaggeredSection>

        {cart.length === 0 ? (
          <StaggeredSection delay={100} direction="up">
            <View style={[s.emptyBox, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>🛒</Text>
              <Text style={[s.emptyTitle, { color: txt }]}>Your Basket Is Empty</Text>
              <Text style={[s.emptyDesc, { color: txtSec }]}>
                Add delicious dishes from campus restaurants, snacks from night canteens, or groceries for your hostel room.
              </Text>
              <TouchableOpacity 
                style={[s.exploreBtn, { backgroundColor: COLORS.red }]}
                activeOpacity={0.85}
                onPress={() => router.push('/(tabs)' as any)}
              >
                <Text style={s.exploreBtnText}>BROWSE DELICIOUS BITES →</Text>
              </TouchableOpacity>
            </View>
          </StaggeredSection>
        ) : (
          <>
            {isClosed && (
              <StaggeredSection delay={60} direction="up">
                <View style={[s.multiRestBanner, { backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }]}>
                  <Text style={{ fontSize: 16 }}>🌙</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.multiRestTitle, { color: txt }]}>CLOSED FOR THE NIGHT</Text>
                    <Text style={[s.multiRestSub, { color: txtSec }]}>{closedMessage} Your basket is saved.</Text>
                  </View>
                </View>
              </StaggeredSection>
            )}

            {unavailable.length > 0 && (
              <StaggeredSection delay={70} direction="up">
                <View style={[s.multiRestBanner, { backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.3)' }]}>
                  <Text style={{ fontSize: 16 }}>⚠️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.multiRestTitle, { color: '#EF4444' }]}>SOME ITEMS ARE UNAVAILABLE</Text>
                    <Text style={[s.multiRestSub, { color: txtSec }]}>{unavailable.map((u) => u.name).filter(Boolean).join(', ') || quoteError?.message}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.bannerBtn}
                    onPress={() => removeItems({
                      ids: unavailable.map((u) => String(u.id || '')).filter(Boolean),
                      names: unavailable.map((u) => String(u.name || '')).filter(Boolean),
                    })}
                  >
                    <Text style={s.bannerBtnText}>REMOVE</Text>
                  </TouchableOpacity>
                </View>
              </StaggeredSection>
            )}
            {cart.map((item: any, i: number) => (
              <StaggeredSection key={item.cartKey || item.id || i} delay={(i + 1) * 80} direction="up">
                <View style={[s.itemCard, { backgroundColor: cardBg, borderColor: border }]}>
                  {item.image ? (
                    <SafeImage source={{ uri: item.image }} style={s.itemImg} />
                  ) : (
                    <View style={[s.itemImg, { backgroundColor: isDark ? '#222' : '#E5E7EB', alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 22 }}>🍽️</Text>
                    </View>
                  )}
                  <View style={s.itemInfo}>
                    <Text style={[s.itemName, { color: txt }]}>{item.name}</Text>
                    <Text style={{ fontSize: 10, color: txtSec }}>from {item.restaurantName || 'Restaurant'}</Text>
                    {item.customizations && Object.keys(item.customizations).length > 0 && (
                      <Text style={{ fontSize: 10, color: goldColor, marginTop: 2, fontStyle: 'italic', fontWeight: '600' }}>
                        {summarizeCustomizations(item.customizations)}
                      </Text>
                    )}
                    {item.addedBy && (
                      <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)', alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4 }}>
                        <Text style={{ fontSize: 8, fontWeight: '800', color: txtSec, textTransform: 'uppercase' }}>👤 ADDED BY {item.addedBy}</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: txt }}>₹{Math.round(item.price * item.quantity * 100) / 100}</Text>
                      {item.quantity > 1 && (
                        <Text style={{ fontSize: 10, fontWeight: '700', color: txtSec }}>₹{item.price} each</Text>
                      )}
                      {isCustomRequest(item) && (
                        <Text style={{ fontSize: 9, fontWeight: '700', color: txtSec }}>est.</Text>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 8 }}>
                    <TouchableOpacity
                      style={{ padding: 4, borderRadius: 8, backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)' }}
                      onPress={() =>
                        Alert.alert('Remove Item', `Remove "${item.name}" from basket?`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => removeFromCart(item.cartKey || item.id) }
                        ])
                      }
                    >
                      <Text style={{ fontSize: 14 }}>🗑️</Text>
                    </TouchableOpacity>
                    <View style={[s.qtyWrap, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F4F8' }]}>
                      <DopaminePressable 
                        style={[s.qtyBtn, { backgroundColor: isDark ? '#27272A' : '#FFFFFF' }]} 
                        onPress={() => updateQuantity(item.cartKey || item.id, Math.max(0, item.quantity - 1))}
                        sound="click"
                        activeScale={0.88}
                      >
                        <Text style={[s.qtyText, { color: txt }]}>-</Text>
                      </DopaminePressable>
                      <Text style={[s.qtyNum, { color: txt }]}>{item.quantity}</Text>
                      <DopaminePressable 
                        style={[s.qtyBtn, { backgroundColor: isDark ? '#27272A' : '#FFFFFF' }]} 
                        onPress={() => updateQuantity(item.cartKey || item.id, item.quantity + 1)}
                        sound="click"
                        activeScale={0.88}
                      >
                        <Text style={[s.qtyText, { color: txt }]}>+</Text>
                      </DopaminePressable>
                    </View>
                  </View>
                </View>
              </StaggeredSection>
            ))}

            <StaggeredSection delay={(cart.length + 1) * 80} direction="up">
              <View style={[s.billCard, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}>
                {!user ? (
                  <>
                    <View style={s.billRow}>
                      <Text style={[s.billLabel, { color: txtSec }]}>ITEM TOTAL</Text>
                      <Text style={[s.billVal, { color: txt }]}>₹{totalPrice}</Text>
                    </View>
                    <Text style={{ fontSize: 10, color: txtSec, fontWeight: '600' }}>Sign in to see delivery fee, offers and your final bill.</Text>
                  </>
                ) : !hasOrderLines ? (
                  <>
                    <View style={s.billRow}>
                      <Text style={[s.billLabel, { color: txtSec }]}>SHOPPING LIST (EST.)</Text>
                      <Text style={[s.billVal, { color: txt }]}>₹{totalPrice}</Text>
                    </View>
                    <Text style={{ fontSize: 10, color: txtSec, fontWeight: '600' }}>A rider shops your list. You pay the actual shop bill plus fees in cash on delivery.</Text>
                  </>
                ) : quote ? (
                  <View style={{ opacity: quoteLoading ? 0.5 : 1 }}>
                    <View style={s.billRow}>
                      <Text style={[s.billLabel, { color: txtSec }]}>ITEM TOTAL</Text>
                      <Text style={[s.billVal, { color: txt }]}>₹{quote.subtotal}</Text>
                    </View>
                    <View style={s.billRow}>
                      <Text style={[s.billLabel, { color: txtSec }]}>DELIVERY FEE</Text>
                      <Text style={[s.billVal, { color: quote.deliveryFee === 0 ? '#10B981' : txt, fontWeight: '900' }]}>
                        {quote.deliveryFee === 0 ? 'FREE' : `₹${quote.deliveryFee}`}
                      </Text>
                    </View>
                    {quote.packagingFee > 0 && (
                      <View style={s.billRow}>
                        <Text style={[s.billLabel, { color: txtSec }]}>PACKAGING</Text>
                        <Text style={[s.billVal, { color: txt }]}>₹{quote.packagingFee}</Text>
                      </View>
                    )}
                    {quote.taxes > 0 && (
                      <View style={s.billRow}>
                        <Text style={[s.billLabel, { color: txtSec }]}>TAXES</Text>
                        <Text style={[s.billVal, { color: txt }]}>₹{quote.taxes}</Text>
                      </View>
                    )}
                    {(quote.discounts || []).filter((d) => d && d.amount > 0).map((d, idx) => (
                      <View style={s.billRow} key={`${d.type}-${idx}`}>
                        <Text style={[s.billLabel, { color: '#10B981', flex: 1 }]} numberOfLines={1}>{String(d.label || 'Discount').toUpperCase()}</Text>
                        <Text style={[s.billVal, { color: '#10B981' }]}>-₹{d.amount}</Text>
                      </View>
                    ))}
                    <View style={[s.billRow, { borderTopWidth: 1, borderTopColor: border, paddingTop: 12, marginTop: 4 }]}>
                      <Text style={[s.billLabel, { color: txt, fontSize: 13, fontWeight: '900' }]}>TO PAY</Text>
                      <Text style={{ fontSize: 22, fontWeight: '900', color: goldColor }}>₹{quote.finalPrice}</Text>
                    </View>
                    {isStallBasket && (
                      <Text style={{ fontSize: 10, color: txtSec, fontWeight: '600' }}>🏪 {stallPayCopy(stallName)}. {stallName} delivers it — no Zenvy rider.</Text>
                    )}
                    {customCount > 0 && (
                      <Text style={{ fontSize: 10, color: txtSec, fontWeight: '600' }}>+ your Mega Basket shopping list, paid in cash on delivery.</Text>
                    )}
                  </View>
                ) : quoteLoading ? (
                  <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                    <ActivityIndicator color={goldColor} />
                    <Text style={{ fontSize: 10, color: txtSec, fontWeight: '600', marginTop: 8 }}>Calculating your bill…</Text>
                  </View>
                ) : quoteError ? (
                  <View>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: txt, marginBottom: 4 }}>We couldn't calculate your bill</Text>
                    <Text style={{ fontSize: 11, color: txtSec, fontWeight: '600', lineHeight: 16, marginBottom: 10 }}>{quoteError.message}</Text>
                    {unavailable.length === 0 && (
                      <TouchableOpacity style={[s.bannerBtn, { alignSelf: 'flex-start' }]} onPress={refreshQuote}>
                        <Text style={s.bannerBtnText}>TRY AGAIN</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </View>
            </StaggeredSection>

            {/* Campus Delivery Instructions */}
            <StaggeredSection delay={(cart.length + 2) * 80} direction="up">
              <View style={[s.instructionsCard, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: goldColor, letterSpacing: 1.5, marginBottom: 2 }}>
                  CAMPUS DELIVERY INSTRUCTIONS
                </Text>
                <Text style={{ fontSize: 9, color: txtSec, fontWeight: '600', marginBottom: 8 }}>
                  {isStallBasket ? `Sent to ${stallName} with the delivery address.` : 'Sent to your rider with the delivery address.'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {DELIVERY_INSTRUCTIONS.map(pref => {
                    const isSelected = selectedInstructions.includes(pref.id);
                    return (
                      <TouchableOpacity
                        key={pref.id}
                        style={[
                          s.instructionChip,
                          {
                            backgroundColor: isSelected ? (isDark ? goldColor : COLORS.red) : (isDark ? 'rgba(255,255,255,0.04)' : '#F1F5F9'),
                            borderColor: isSelected ? 'transparent' : border,
                          }
                        ]}
                        onPress={() => toggleInstruction(pref.id)}
                        activeOpacity={0.8}
                      >
                        <Text style={{ fontSize: 9.5, fontWeight: '800', color: isSelected ? (isDark ? '#000' : '#FFF') : txt }}>
                          {pref.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </StaggeredSection>
          </>
        )}

        <View style={{ height: 200 }} />
      </ScrollView>

      {totalItems > 0 && (
        <FloatingPulse color={COLORS.red} style={s.checkoutBtnContainer}>
          <ActionPressable 
            style={[s.checkoutBtn, { backgroundColor: actionBtnBg, width: '100%' }]} 
            onPress={() => {
              if (!user) {
                Alert.alert(
                  'Sign In Required',
                  'Please sign in to proceed with checkout and live order tracking.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign In', onPress: () => router.push('/login' as any) }
                  ]
                );
                return;
              }
              router.push('/checkout' as any);
            }}
            sound="click"
          >
            <Text style={s.checkoutText}>{checkoutLabel}</Text>
          </ActionPressable>
        </FloatingPulse>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50, width: '100%', maxWidth: 600, alignSelf: 'center', position: 'relative' },
  pageTitle: { fontSize: 20, fontWeight: '900', letterSpacing: 4, paddingHorizontal: 16, marginBottom: 16, textAlign: 'center' },
  groupCard: { marginHorizontal: 16, padding: 16, borderRadius: 20, marginBottom: 16, borderWidth: 1 },
  groupDesc: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  groupBtns: { flexDirection: 'row', gap: 10 },
  hostBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  hostBtnText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  joinBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  joinBtnText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 1 },
  empty: { padding: 60, alignItems: 'center' },
  emptyText: { fontSize: 13, fontWeight: '600' },
  emptyBox: { marginHorizontal: 16, marginTop: 24, padding: 32, borderRadius: 24, alignItems: 'center', borderWidth: 1, ...SHADOWS.card },
  emptyTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 12 },
  exploreBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16, ...SHADOWS.redGlow },
  exploreBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  itemCard: { flexDirection: 'row', marginHorizontal: 16, padding: 12, borderRadius: 16, marginBottom: 10, borderWidth: 1, alignItems: 'flex-start' },
  itemImg: { width: 60, height: 60, borderRadius: 12, marginRight: 12 },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 13, fontWeight: '700' },
  qtyWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 4 },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  qtyText: { fontSize: 16, fontWeight: '700' },
  qtyNum: { fontSize: 14, fontWeight: '800', minWidth: 20, textAlign: 'center' },
  billCard: { marginHorizontal: 16, padding: 16, borderRadius: 20, marginTop: 8 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  billLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  billVal: { fontSize: 13, fontWeight: '800' },
  joinInputRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  joinInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 10, fontWeight: '900' },
  joinSubmit: { paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  joinSubmitText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 1 },
  activeRoomCard: { width: '100%' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  disconnectBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)' },
  disconnectText: { fontSize: 9, fontWeight: '900', color: '#EF4444', letterSpacing: 1 },
  checkoutBtnContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 100 : 80,
    left: 16,
    right: 16,
    zIndex: 100,
  },
  checkoutBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    ...SHADOWS.redGlow,
  },
  checkoutText: { fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  multiRestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  multiRestTitle: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 2,
  },
  multiRestSub: {
    fontSize: 8.5,
    fontWeight: '600',
    lineHeight: 12,
  },
  bannerBtn: { backgroundColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  bannerBtnText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  deliveryTrackerCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    ...SHADOWS.card,
  },
  progressBarOuter: {
    height: 6,
    borderRadius: 3,
    width: '100%',
    overflow: 'hidden',
    marginTop: 2,
  },
  progressBarInner: {
    height: '100%',
    borderRadius: 3,
  },
  instructionsCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    ...SHADOWS.card,
  },
  instructionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
});
