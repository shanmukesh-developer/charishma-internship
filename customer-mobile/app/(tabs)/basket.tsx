import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, TextInput, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import { useRouter, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import TabBackButton from '../../components/TabBackButton';
import { COLORS, SHADOWS, BUTTON } from '../../constants/theme';
import { plainDiscountLabel } from '../../utils/billLabel';
import { useTopInset } from '../../utils/useTopInset';
import { useCart, useBasketQuote, useServiceability, isCustomRequest, isBasketKind, BASKET_KINDS, BASKET_LABELS, BasketKind, DELIVERY_INSTRUCTIONS, DELIVERY_INSTRUCTIONS_KEY } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { summarizeCustomizations } from '../../components/CustomizeDrawer';
import AmbientBackground from '../../components/AmbientBackground';
import { StaggeredSection, FloatingPulse, BounceIn } from '../../components/AnimatedSection';
import DopaminePressable, { ActionPressable } from '../../components/DopaminePressable';
import SafeImage from '../../components/SafeImage';
import { stallPayCopy } from '../../utils/localVendor';
import { formatINR, formatClock, plural } from '../../utils/format';
import SymbolIcon from '../../components/SymbolIcon';

// Clean chip labels for the stored instruction ids (the ids and notes sent with the order stay the same).
const INSTRUCTION_LABELS: Record<string, string> = {
  no_cutlery: 'No plastic cutlery',
  call_arrival: 'Call when you arrive',
  guard_desk: 'Leave with the hostel guard',
};
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\uFE0F?/gu;
const stripEmoji = (t: string) => t.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();

export default function BasketScreen() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  const basketFocused = useIsFocused();
  const { isDark, colors } = useTheme();
  const { user } = useAuth();
  const { baskets, basketCounts, basketTotals, activeBasket, setActiveBasket, lastAddedBasket, lastAddedAt, cartLoaded, removeFromCart, updateQuantity, clearBasket, removeItems: removeAnyItems, roomCode, isHosting, roomStatus, roomMessage, handleHostRoom, handleJoinRoom, handleDisconnect } = useCart();
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [selectedInstructions, setSelectedInstructions] = useState<string[]>([]);
  const router = useRouter();
  // Group basket: starting, joining or leaving always lands on a clean card (no half-open join row).
  const resetGroupCard = () => { setIsJoinOpen(false); setInputCode(''); };
  const onHostRoom = () => { resetGroupCard(); handleHostRoom(); };
  const onLeaveGroup = () => { resetGroupCard(); handleDisconnect(); };

  // Three baskets (restaurants, campus store, local stalls), each with its own checkout.
  // The screen below shows the selected basket exactly as a single basket.
  const basketKind: BasketKind = activeBasket;
  const cart = baskets[basketKind];
  const totalItems = basketCounts[basketKind];
  const totalPrice = basketTotals[basketKind];
  const removeItems = (m: { ids?: string[]; names?: string[] }) => removeAnyItems({ ...m, basket: basketKind });

  // Opens on ?basket=… (deep links, after an order), else on the basket that just got a new item,
  // else on a basket that has items when the selected one is empty. Waits for the saved baskets to
  // load: on a cold start every basket reads 0 until then, which used to leave an empty basket open.
  const { basket: basketParamRaw } = useLocalSearchParams<{ basket?: string | string[] }>();
  const basketParam = Array.isArray(basketParamRaw) ? basketParamRaw[0] : basketParamRaw;
  const seenAddedAtRef = useRef(0);
  const skipAutoPickRef = useRef(false);
  useEffect(() => {
    if (!basketFocused || !cartLoaded) return;
    if (isBasketKind(basketParam)) {
      setActiveBasket(basketParam);
      seenAddedAtRef.current = lastAddedAt;
      skipAutoPickRef.current = true;
      try { router.setParams({ basket: undefined } as any); } catch {}
      return;
    }
    if (skipAutoPickRef.current) {
      skipAutoPickRef.current = false;
      return;
    }
    if (lastAddedBasket && lastAddedAt > seenAddedAtRef.current) {
      setActiveBasket(lastAddedBasket);
    } else if (basketCounts[activeBasket] === 0) {
      const withItems = (lastAddedBasket && basketCounts[lastAddedBasket] > 0) ? lastAddedBasket : BASKET_KINDS.find((k) => basketCounts[k] > 0);
      if (withItems) setActiveBasket(withItems);
    }
    seenAddedAtRef.current = lastAddedAt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketFocused, basketParam, cartLoaded]);

  // The bill comes from the server (POST /api/orders/quote); guests see an item estimate only.
  const { quote, loading: quoteLoading, error: quoteError, refresh: refreshQuote, hasOrderLines } = useBasketQuote(null, !!user, basketFocused, basketKind);
  const { serviceability } = useServiceability();
  const isClosed = quote?.serviceability?.open === false || serviceability?.open === false;
  const closedMessage = stripEmoji(String(quote?.serviceability?.message || serviceability?.message ||
    `Campus stores are closed for the night. Ordering opens again at ${serviceability?.reopensAt ? formatClock(serviceability.reopensAt) : '6:00 AM'}.`));
  const customCount = cart.filter((i) => isCustomRequest(i)).length;
  // Send a list: the price is optional, so a list can be "price after shopping" (total 0).
  const customTotal = cart.filter((i) => isCustomRequest(i)).reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);

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
  // This store / stall is closed (its own hours), told by the quote: a calm notice, not a bill error.
  const storeClosed = quoteError?.code === 'STORE_CLOSED';
  const storeOpensAt = storeClosed && typeof quoteError?.body?.opensAt === 'string' ? formatClock(quoteError.body.opensAt) : '';
  const storeClosedTitle = basketKind === 'stall' ? 'This stall is closed now' : `${stallLine?.restaurantName || cart[0]?.restaurantName || 'This store'} is closed now`;
  const storeClosedText = storeOpensAt ? `Opens at ${storeOpensAt}. Your basket is saved.` : 'Your basket is saved. Check back when it opens.';
  // A weight / flavour pick is missing or no longer offered (OPTION_INVALID): checkout would refuse it too.
  const optionInvalid = quoteError?.code === 'OPTION_INVALID';
  // College rules (backend utils/campuses): a store of another college or a coming-soon college; a retry gives the
  // same answer (a paused college may reopen, so Try again stays for it).
  const collegeRefusal = ['STORE_NOT_AT_CAMPUS', 'CAMPUS_PAUSED', 'CAMPUS_SOON'].includes(String(quoteError?.code || ''));
  const collegeFinal = quoteError?.code === 'STORE_NOT_AT_CAMPUS' || quoteError?.code === 'CAMPUS_SOON';
  const optionItemId: string | null = optionInvalid && quoteError?.body?.menuItemId ? String(quoteError.body.menuItemId) : null;
  const chooseAgain = () => {
    if (optionItemId) {
      removeItems({ ids: [optionItemId] });
      router.push(`/products/${optionItemId}` as any);
    }
  };
  // Don't send people to checkout just to be refused there.
  const checkoutBlocked = !!user && (isClosed || storeClosed || unavailable.length > 0 || optionInvalid);
  const checkoutLabel = !user
    ? `Go to checkout · ${plural(totalItems, 'item')}`
    : isClosed || storeClosed
      ? 'Ordering closed'
      : unavailable.length > 0
        ? 'Remove unavailable items first'
        : optionInvalid
          ? 'Choose the item options first'
          : `Go to checkout · ${plural(totalItems, 'item')}`;

  const bg = colors.bg;
  const cardBg = colors.card;
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;
  const actionBtnBg = COLORS.red;

  // The checkout button floats over the page. The list stops above it (its measured height plus its
  // offset), so no card can ever sit under it, at rest or scrolled to the end.
  const [checkoutH, setCheckoutH] = useState(CHECKOUT_EST_HEIGHT);
  const listBottom = totalItems > 0 ? CHECKOUT_BOTTOM + checkoutH + 12 : 0;

  return (
    <KeyboardAvoidingView style={[s.container, { paddingTop: topPad, backgroundColor: bg }]} enabled={basketFocused}>
      <AmbientBackground />
      <View style={{ flex: 1, marginBottom: listBottom }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={user && hasOrderLines ? <RefreshControl refreshing={!!quoteLoading} onRefresh={refreshQuote} tintColor={goldColor} colors={[COLORS.red]} /> : undefined}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <TabBackButton />
            <Text style={[s.pageTitle, { color: txt, marginBottom: 0, paddingHorizontal: 0 }]}>Your basket</Text>
          </View>
          {cart.length > 0 && (
            <TouchableOpacity
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)' }}
              accessibilityRole="button"
              accessibilityLabel={`Clear your ${BASKET_LABELS[basketKind]} basket`}
              onPress= {() => {
                Alert.alert(
                  `Clear your ${BASKET_LABELS[basketKind]} basket?`,
                  `This removes the ${plural(totalItems, 'item')} in your ${BASKET_LABELS[basketKind]} basket. Your other baskets stay as they are.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear this basket',
                      style: 'destructive',
                      onPress: () => clearBasket(basketKind),
                    }
                  ]
                );
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#EF4444', letterSpacing: 0.2 }}>Clear this basket</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Basket switch: Restaurants · Campus store · Local stalls */}
        <View style={[s.segWrap, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F1F5F9', borderColor: border }]} accessibilityRole="tablist">
          {BASKET_KINDS.map((k) => {
            const selected = k === basketKind;
            const n = basketCounts[k];
            const onColor = isDark ? '#000' : '#FFF';
            return (
              <TouchableOpacity
                key={k}
                style={[s.seg, selected && { backgroundColor: isDark ? goldColor : COLORS.red }]}
                onPress={() => setActiveBasket(k)}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${BASKET_LABELS[k]} basket, ${plural(n, 'item')}`}
              >
                <Text style={[s.segText, { color: selected ? onColor : txt }]} numberOfLines={1}>{BASKET_LABELS[k]}</Text>
                <Text style={[s.segCount, { color: selected ? onColor : n === 0 ? txtSec : txt }]}>{n}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Group basket (restaurant orders only) */}
        {basketKind === 'restaurant' && (
        <StaggeredSection delay={50} direction="up">
          <View style={[s.groupCard, { backgroundColor: cardBg, borderColor: border }]}>
            {!roomCode ? (
              <View>
                <Text style={{ fontSize: 12, fontWeight: '900', color: goldColor, letterSpacing: 0.3, marginBottom: 2 }}>Group basket</Text>
                <Text style={[s.groupDesc, { color: txtSec }]}>Build one basket with your roommates. One person checks out and pays.</Text>
                <View style={s.groupBtns}>
                  <TouchableOpacity style={[s.hostBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]} onPress={onHostRoom} accessibilityRole="button">
                    <Text style={[s.hostBtnText, { color: txt }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Start a group basket</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.joinBtn, { backgroundColor: goldColor }]} onPress={() => setIsJoinOpen(!isJoinOpen)} accessibilityRole="button" accessibilityState={{ expanded: isJoinOpen }}>
                    <Text style={s.joinBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Join a group basket</Text>
                  </TouchableOpacity>
                </View>
                {isJoinOpen && (
                  <View style={s.joinInputRow}>
                    <TextInput
                      style={[s.joinInput, { color: txt, borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F1F4F8' }]}
                      placeholder="Room code, e.g. ZN-8B2A4KQ7XM"
                      placeholderTextColor={txtSec}
                      value={inputCode}
                      onChangeText={setInputCode}
                      autoCapitalize="characters"
                    />
                    <TouchableOpacity 
                      style={[s.joinSubmit, { backgroundColor: goldColor }]} 
                      onPress={() => { 
                        if (!inputCode || inputCode.trim().length < 3) {
                          Alert.alert('Check the room code', 'Enter the room code your roommate shared.');
                          return;
                        }
                        handleJoinRoom(inputCode.trim().toUpperCase()); 
                        setIsJoinOpen(false); 
                      }}
                    >
                      <Text style={s.joinSubmitText}>Join</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <View style={s.activeRoomCard}>
                <View style={[s.roomStatusRow, { marginBottom: 6 }]}>
                  {roomStatus === 'connecting' ? (
                    <ActivityIndicator size="small" color={goldColor} />
                  ) : (
                    <View style={[s.liveDot, roomStatus !== 'live' && { backgroundColor: roomStatus === 'error' ? '#EF4444' : '#F59E0B' }]} />
                  )}
                  <Text style={{ fontSize: 12, fontWeight: '900', color: roomStatus === 'live' ? '#10B981' : roomStatus === 'error' ? '#EF4444' : txtSec, letterSpacing: 0.2 }}>
                    {roomStatus === 'live'
                      ? `Group basket live (${isHosting ? "you're the host" : 'joined'})`
                      : roomStatus === 'connecting'
                        ? 'Connecting…'
                        : roomStatus === 'waiting'
                          ? 'Waiting for the host'
                          : roomStatus === 'error'
                            ? 'Connection problem'
                            : `Group basket (${isHosting ? "you're the host" : 'joined'})`}
                  </Text>
                </View>
                {/* Always the same height (idle message or none), so the card never jumps between states. */}
                <Text style={s.roomMessage} numberOfLines={2}>
                  <Text style={{ color: txtSec }}>{roomMessage || ''}</Text>
                </Text>
                <View style={s.roomCodeRow}>
                  <View>
                    <Text style={{ fontSize: 12, color: txtSec, fontWeight: '700', letterSpacing: 0.2, marginBottom: 2 }}>Room code</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 18, fontWeight: '900', color: goldColor }}>{roomCode}</Text>
                      <TouchableOpacity 
                        style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB' }}
                        onPress={() => {
                          Clipboard.setString(roomCode);
                          Alert.alert('Room code copied', `Share ${roomCode} with your roommates so they can join.`);
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '800', color: txt }}>Copy</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <TouchableOpacity style={s.disconnectBtn} onPress={onLeaveGroup} accessibilityRole="button">
                    <Text style={s.disconnectText} numberOfLines={1}>Leave group</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </StaggeredSection>
        )}

        {cart.length === 0 ? (
          <StaggeredSection delay={100} direction="up">
            <View style={[s.emptyBox, { backgroundColor: cardBg, borderColor: border }]}>
              <Ionicons name="cart-outline" size={48} color={txtSec} style={{ marginBottom: 16 }} />
              <Text style={[s.emptyTitle, { color: txt }]}>Your basket is empty</Text>
              <Text style={[s.emptyDesc, { color: txtSec }]}>
                {basketKind === 'store'
                  ? 'Add groceries, snacks and room essentials from the campus store.'
                  : basketKind === 'stall'
                    ? 'Add snacks and meals from local stalls near campus. You pay the stall in cash.'
                    : 'Add meals from campus restaurants. Groceries and stall food have their own baskets.'}
              </Text>
              <TouchableOpacity 
                style={[s.exploreBtn, { backgroundColor: COLORS.red }]}
                activeOpacity={0.85}
                onPress={() => router.push((basketKind === 'store' ? '/(tabs)/others' : '/(tabs)') as any)}
              >
                <Text style={s.exploreBtnText}>{basketKind === 'store' ? 'Browse campus store' : basketKind === 'stall' ? 'Browse stalls' : 'Browse restaurants'}</Text>
              </TouchableOpacity>
            </View>
          </StaggeredSection>
        ) : (
          <>
            {isClosed && (
              <StaggeredSection delay={60} direction="up">
                <View style={[s.multiRestBanner, { backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }]}>
                  <Ionicons name="moon-outline" size={16} color={txtSec} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.multiRestTitle, { color: txt }]}>Ordering is closed</Text>
                    <Text style={[s.multiRestSub, { color: txtSec }]}>{closedMessage} Your basket is saved.</Text>
                  </View>
                </View>
              </StaggeredSection>
            )}

            {!isClosed && storeClosed && (
              <StaggeredSection delay={60} direction="up">
                <View style={[s.multiRestBanner, { backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }]}>
                  <Ionicons name="time-outline" size={16} color={txtSec} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.multiRestTitle, { color: txt }]}>{storeClosedTitle}</Text>
                    <Text style={[s.multiRestSub, { color: txtSec }]}>{storeClosedText}</Text>
                  </View>
                </View>
              </StaggeredSection>
            )}

            {unavailable.length > 0 && (
              <StaggeredSection delay={70} direction="up">
                <View style={[s.multiRestBanner, { backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.3)' }]}>
                  <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.multiRestTitle, { color: '#EF4444' }]}>Some items are unavailable</Text>
                    <Text style={[s.multiRestSub, { color: txtSec }]}>{unavailable.map((u) => u.name).filter(Boolean).join(', ') || quoteError?.message}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.bannerBtn}
                    onPress={() => removeItems({
                      ids: unavailable.map((u) => String(u.id || '')).filter(Boolean),
                      names: unavailable.map((u) => String(u.name || '')).filter(Boolean),
                    })}
                  >
                    <Text style={s.bannerBtnText}>Remove</Text>
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
                      <Ionicons name="restaurant-outline" size={22} color={txtSec} />
                    </View>
                  )}
                  <View style={s.itemInfo}>
                    <Text style={[s.itemName, { color: txt }]} numberOfLines={2}>{item.name}</Text>
                    {!!item.restaurantName && (
                      <Text style={{ fontSize: 12, color: txtSec }}>from {item.restaurantName}</Text>
                    )}
                    {item.customizations && Object.keys(item.customizations).length > 0 && (
                      <Text style={{ fontSize: 12, color: goldColor, marginTop: 2, fontStyle: 'italic', fontWeight: '600' }}>
                        {summarizeCustomizations(item.customizations)}
                      </Text>
                    )}
                    {!!item.addedBy && !!roomCode && (
                      <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)', alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: txtSec }}>Added by {item.addedBy}</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                      {isCustomRequest(item) && !(Number(item.price) > 0) ? (
                        <Text style={{ fontSize: 13, fontWeight: '800', color: txtSec }}>Price after shopping</Text>
                      ) : (
                        <>
                          <Text style={{ fontSize: 16, fontWeight: '900', color: txt }}>{formatINR(Number(item.price) * Number(item.quantity))}</Text>
                          {item.quantity > 1 && (
                            <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec }}>{formatINR(item.price)} each</Text>
                          )}
                          {isCustomRequest(item) && (
                            <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec }}>est.</Text>
                          )}
                        </>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 8 }}>
                    <TouchableOpacity
                      style={{ padding: 4, borderRadius: 8, backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)' }}
                      onPress={() =>
                        Alert.alert('Remove item?', `Remove "${item.name}" from your basket?`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => removeFromCart(item.cartKey || item.id) }
                        ])
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.name}`}
                    >
                      <Text style={{ fontSize: 14 }}>🗑️</Text>
                    </TouchableOpacity>
                    <View style={[s.qtyWrap, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F4F8' }]}>
                      <DopaminePressable 
                        style={[s.qtyBtn, { backgroundColor: isDark ? '#27272A' : '#FFFFFF' }]} 
                        onPress={() => updateQuantity(item.cartKey || item.id, Math.max(0, item.quantity - 1))}
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease quantity of ${item.name}`}
                        sound="click"
                        activeScale={0.88}
                      >
                        <SymbolIcon name="remove" style={[s.qtyText, { color: txt }]} />
                      </DopaminePressable>
                      <Text style={[s.qtyNum, { color: txt }]}>{item.quantity}</Text>
                      <DopaminePressable 
                        style={[s.qtyBtn, { backgroundColor: isDark ? '#27272A' : '#FFFFFF' }]} 
                        onPress={() => updateQuantity(item.cartKey || item.id, item.quantity + 1)}
                        accessibilityRole="button"
                        accessibilityLabel={`Increase quantity of ${item.name}`}
                        sound="click"
                        activeScale={0.88}
                      >
                        <SymbolIcon name="add" style={[s.qtyText, { color: txt }]} />
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
                      <Text style={[s.billLabel, { color: txtSec }]}>Item total</Text>
                      <Text style={[s.billVal, { color: txt }]}>{formatINR(totalPrice)}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>Sign in to see delivery fee, offers and your final bill.</Text>
                  </>
                ) : !hasOrderLines ? (
                  <>
                    <View style={s.billRow}>
                      <Text style={[s.billLabel, { color: txtSec }]}>Shopping list (est.)</Text>
                      <Text style={[s.billVal, { color: customTotal > 0 ? txt : txtSec }]}>{customTotal > 0 ? formatINR(customTotal) : 'After shopping'}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>A rider shops your list. You pay the actual shop bill plus fees in cash on delivery.</Text>
                  </>
                ) : quote ? (
                  <View style={{ opacity: quoteLoading ? 0.5 : 1 }}>
                    <View style={s.billRow}>
                      <Text style={[s.billLabel, { color: txtSec }]}>Item total</Text>
                      <Text style={[s.billVal, { color: txt }]}>{formatINR(quote.subtotal)}</Text>
                    </View>
                    <View style={s.billRow}>
                      <Text style={[s.billLabel, { color: txtSec }]}>Delivery fee</Text>
                      <Text style={[s.billVal, { color: quote.deliveryFee === 0 ? '#10B981' : txt, fontWeight: '900' }]}>
                        {quote.deliveryFee === 0 ? 'Free' : formatINR(quote.deliveryFee)}
                      </Text>
                    </View>
                    {quote.packagingFee > 0 && (
                      <View style={s.billRow}>
                        <Text style={[s.billLabel, { color: txtSec }]}>Packaging</Text>
                        <Text style={[s.billVal, { color: txt }]}>{formatINR(quote.packagingFee)}</Text>
                      </View>
                    )}
                    {quote.taxes > 0 && (
                      <View style={s.billRow}>
                        <Text style={[s.billLabel, { color: txtSec }]}>Taxes</Text>
                        <Text style={[s.billVal, { color: txt }]}>{formatINR(quote.taxes)}</Text>
                      </View>
                    )}
                    {(quote.discounts || []).filter((d) => d && d.amount > 0).map((d, idx) => (
                      <View style={s.billRow} key={`${d.type}-${idx}`}>
                        <Text style={[s.billLabel, { color: '#10B981', flex: 1 }]} numberOfLines={1}>{plainDiscountLabel(d.label)}</Text>
                        <Text style={[s.billVal, { color: '#10B981' }]}>{formatINR(-Math.abs(Number(d.amount)))}</Text>
                      </View>
                    ))}
                    <View style={[s.billRow, { borderTopWidth: 1, borderTopColor: border, paddingTop: 12, marginTop: 4 }]}>
                      <Text style={[s.billLabel, { color: txt, fontSize: 13, fontWeight: '900' }]}>To pay</Text>
                      <Text style={{ fontSize: 22, fontWeight: '900', color: goldColor }}>{formatINR(quote.finalPrice)}</Text>
                    </View>
                    {isStallBasket && (
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>{stallPayCopy(stallName)}. {stallName} delivers this order itself.</Text>
                    )}
                    {customCount > 0 && (
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>Plus your shopping list, paid in cash on delivery.</Text>
                    )}
                  </View>
                ) : quoteLoading ? (
                  // Skeleton until this basket's own bill arrives (never the other basket's bill).
                  <View accessibilityLabel="Calculating your bill">
                    {[0.42, 0.34, 0.5].map((w, idx) => (
                      <View style={s.billRow} key={idx}>
                        <View style={[s.skelBar, { width: `${w * 100}%` as any, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#ECEEF2' }]} />
                        <View style={[s.skelBar, { width: 56, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#ECEEF2' }]} />
                      </View>
                    ))}
                    <View style={[s.billRow, { borderTopWidth: 1, borderTopColor: border, paddingTop: 12, marginTop: 4, marginBottom: 0 }]}>
                      <View style={[s.skelBar, { width: 60, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#ECEEF2' }]} />
                      <View style={[s.skelBar, { width: 80, height: 18, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#ECEEF2' }]} />
                    </View>
                  </View>
                ) : storeClosed ? (
                  <>
                    <View style={s.billRow}>
                      <Text style={[s.billLabel, { color: txtSec }]}>Item total</Text>
                      <Text style={[s.billVal, { color: txt }]}>{formatINR(totalPrice)}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>Your full bill shows here once {basketKind === 'stall' ? 'the stall' : 'the store'} opens.</Text>
                  </>
                ) : quoteError ? (
                  <View>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: txt, marginBottom: 4 }}>{collegeRefusal ? 'Not available at your college' : "We couldn't calculate your bill"}</Text>
                    <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', lineHeight: 16, marginBottom: 10 }}>{quoteError.message}</Text>
                    {optionInvalid && optionItemId ? (
                      <TouchableOpacity style={[s.bannerBtn, { alignSelf: 'flex-start' }]} onPress={chooseAgain}>
                        <Text style={s.bannerBtnText}>Choose again</Text>
                      </TouchableOpacity>
                    ) : unavailable.length === 0 && !collegeFinal && (
                      <TouchableOpacity style={[s.bannerBtn, { alignSelf: 'flex-start' }]} onPress={refreshQuote}>
                        <Text style={s.bannerBtnText}>Try again</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </View>
            </StaggeredSection>

            {/* Delivery instructions */}
            <StaggeredSection delay={(cart.length + 2) * 80} direction="up">
              <View style={[s.instructionsCard, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}>
                <Text style={{ fontSize: 12, fontWeight: '900', color: goldColor, letterSpacing: 0.3, marginBottom: 2 }}>
                  Delivery instructions
                </Text>
                <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', marginBottom: 8 }}>
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
                        <Text style={{ fontSize: 12, fontWeight: '800', color: isSelected ? (isDark ? '#000' : '#FFF') : txt }}>
                          {INSTRUCTION_LABELS[pref.id] || stripEmoji(pref.label)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </StaggeredSection>
          </>
        )}

        {/* Breathing room under the last card (the list already ends above the checkout button). */}
        <View style={{ height: totalItems > 0 ? 8 : 120 }} />
      </ScrollView>
      </View>

      {totalItems > 0 && (
        <FloatingPulse color={COLORS.red} style={s.checkoutBtnContainer} onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0 && h !== checkoutH) setCheckoutH(h); }}>
          <ActionPressable 
            style={[s.checkoutBtn, { backgroundColor: actionBtnBg, width: '100%' }, checkoutBlocked && { opacity: 0.55 }]}
            disabled={checkoutBlocked}
            accessibilityRole="button"
            accessibilityLabel={checkoutLabel}
            onPress={() => {
              if (!user) {
                Alert.alert(
                  'Sign in to check out',
                  'Sign in to place your order and track it.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign in', onPress: () => router.push('/login' as any) }
                  ]
                );
                return;
              }
              router.push(`/checkout?basket=${basketKind}` as any);
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

// Floating checkout button: its offset from the bottom of the screen and a first guess at its height
// (measured on first layout).
const CHECKOUT_BOTTOM = Platform.OS === 'ios' ? 100 : 80;
const CHECKOUT_EST_HEIGHT = 52;

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50, width: '100%', maxWidth: 600, alignSelf: 'center', position: 'relative' },
  pageTitle: { fontSize: 20, fontWeight: '900', letterSpacing: 0.3, paddingHorizontal: 16, marginBottom: 16, textAlign: 'center' },
  segWrap: { flexDirection: 'row', marginHorizontal: 16, marginTop: -4, marginBottom: 16, padding: 3, gap: 3, borderRadius: 12, borderWidth: 1 },
  seg: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 36, paddingHorizontal: 4, borderRadius: 9 },
  segText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.1, flexShrink: 1 },
  segCount: { fontSize: 12, fontWeight: '900' },
  groupCard: { marginHorizontal: 16, padding: 16, borderRadius: 20, marginBottom: 16, borderWidth: 1 },
  groupDesc: { fontSize: 12, fontWeight: '600', letterSpacing: 0.1, lineHeight: 16, marginBottom: 12 },
  groupBtns: { flexDirection: 'row', gap: 10 },
  // Fixed-height, equal-width buttons: one line at 360 px and 390 px (the label shrinks a little before it wraps).
  hostBtn: { flex: 1, height: BUTTON.height, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  hostBtnText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2, textAlign: 'center' },
  joinBtn: { flex: 1, height: BUTTON.height, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  joinBtnText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.2, textAlign: 'center' },
  roomStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 },
  roomMessage: { fontSize: 12, fontWeight: '600', lineHeight: 15, height: 30, marginBottom: 8 },
  roomCodeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: BUTTON.height + 4 },
  empty: { padding: 60, alignItems: 'center' },
  emptyText: { fontSize: 13, fontWeight: '600' },
  emptyBox: { marginHorizontal: 16, marginTop: 24, padding: 32, borderRadius: 24, alignItems: 'center', borderWidth: 1, ...SHADOWS.card },
  emptyTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 12 },
  exploreBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16, ...SHADOWS.redGlow },
  exploreBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  itemCard: { flexDirection: 'row', marginHorizontal: 16, padding: 12, borderRadius: 16, marginBottom: 10, borderWidth: 1, alignItems: 'flex-start' },
  itemImg: { width: 60, height: 60, borderRadius: 12, marginRight: 12 },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 13, fontWeight: '700' },
  skelBar: { height: 12, borderRadius: 6 },
  qtyWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 4 },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  qtyText: { fontSize: 16, fontWeight: '700' },
  qtyNum: { fontSize: 14, fontWeight: '800', minWidth: 20, textAlign: 'center' },
  billCard: { marginHorizontal: 16, padding: 16, borderRadius: 20, marginTop: 8 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  billLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  billVal: { fontSize: 13, fontWeight: '800' },
  joinInputRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  joinInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, fontWeight: '800' },
  joinSubmit: { paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  joinSubmitText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.2 },
  activeRoomCard: { width: '100%' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  disconnectBtn: { paddingHorizontal: 12, height: 36, justifyContent: 'center', borderRadius: 8, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)' },
  disconnectText: { fontSize: 12, fontWeight: '900', color: '#EF4444', letterSpacing: 0.2 },
  checkoutBtnContainer: {
    position: 'absolute',
    bottom: CHECKOUT_BOTTOM,
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
  checkoutText: { fontSize: 14, fontWeight: '900', color: '#fff', letterSpacing: 0.3 },
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
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  multiRestSub: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 12,
  },
  bannerBtn: { backgroundColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  bannerBtnText: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 0.2 },
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
