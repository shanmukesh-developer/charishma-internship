import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../../constants/theme';
import { useCart } from '../../context/CartContext';
import { useTheme } from '../../context/ThemeContext';
import { summarizeCustomizations } from '../../components/CustomizeDrawer';
import AmbientBackground from '../../components/AmbientBackground';
import { StaggeredSection, FloatingPulse, BounceIn } from '../../components/AnimatedSection';

export default function BasketScreen() {
  const { isDark } = useTheme();
  const { cart, removeFromCart, updateQuantity, totalPrice, totalItems, roomCode, isHosting, isJoined, handleHostRoom, handleJoinRoom, handleDisconnect } = useCart();
  const [isJoinOpen, setIsJoinOpen] = React.useState(false);
  const [inputCode, setInputCode] = React.useState('');
  const router = useRouter();
  const bg = isDark ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDark ? COLORS.bgCard : COLORS.bgLightCard;
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const border = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  const goldColor = isDark ? COLORS.gold : COLORS.red;

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <AmbientBackground />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={[s.pageTitle, { color: txt }]}>MY BASKET</Text>

        {/* Group Cart */}
        <StaggeredSection delay={50} direction="up">
          <View style={[s.groupCard, { backgroundColor: cardBg, borderColor: border }]}>
            {!roomCode ? (
              <View>
                <Text style={{ fontSize: 11, fontWeight: '900', color: goldColor, letterSpacing: 2, marginBottom: 2 }}>ROOMMATE GROUP CART</Text>
                <Text style={[s.groupDesc, { color: txt }]}>ORDER TOGETHER WITH YOUR ROOMMATES AND SPLIT THE BILL</Text>
                <View style={s.groupBtns}>
                  <TouchableOpacity style={[s.hostBtn, { borderColor: txtSec }]} onPress={handleHostRoom}>
                    <Text style={[s.hostBtnText, { color: txtSec }]}>📡 HOST CART</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.joinBtn, { backgroundColor: goldColor }]} onPress={() => setIsJoinOpen(!isJoinOpen)}>
                    <Text style={s.joinBtnText}>👥 JOIN CART</Text>
                  </TouchableOpacity>
                </View>
                {isJoinOpen && (
                  <View style={s.joinInputRow}>
                    <TextInput
                      style={[s.joinInput, { color: txt, borderColor: border }]}
                      placeholder="ENTER ROOM CODE (e.g. ZN-8B2A)"
                      placeholderTextColor={txtSec}
                      value={inputCode}
                      onChangeText={setInputCode}
                      autoCapitalize="characters"
                    />
                    <TouchableOpacity style={[s.joinSubmit, { backgroundColor: goldColor }]} onPress={() => { handleJoinRoom(inputCode); setIsJoinOpen(false); }}>
                      <Text style={s.joinSubmitText}>CONNECT</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <View style={s.activeRoomCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <View style={s.liveDot} />
                  <Text style={{ fontSize: 10, fontWeight: '900', color: '#10B981', letterSpacing: 2 }}>LIVE ROOM ACTIVE ({isHosting ? 'HOST' : 'JOINED'})</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontSize: 9, color: txtSec, fontWeight: '700', letterSpacing: 1, marginBottom: 2 }}>ROOM CODE</Text>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: goldColor }}>{roomCode}</Text>
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
          <View style={s.empty}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🛒</Text>
            <Text style={[s.emptyText, { color: txtSec }]}>Your basket is empty</Text>
          </View>
        ) : (
          <>
            {cart.map((item: any, i: number) => (
              <StaggeredSection key={item.cartKey || item.id || i} delay={(i + 1) * 80} direction="up">
                <View style={[s.itemCard, { backgroundColor: cardBg, borderColor: border }]}>
                  {item.image && <Image source={{ uri: item.image }} style={s.itemImg} />}
                  <View style={s.itemInfo}>
                    <Text style={[s.itemName, { color: txt }]}>{item.name}</Text>
                    <Text style={{ fontSize: 9, color: txtSec }}>from {item.restaurantName || 'Restaurant'}</Text>
                    {item.customizations && Object.keys(item.customizations).length > 0 && (
                      <Text style={{ fontSize: 9, color: isDark ? COLORS.gold : COLORS.red, marginTop: 2, fontStyle: 'italic', fontWeight: '600' }}>
                        {summarizeCustomizations(item.customizations)}
                      </Text>
                    )}
                    <Text style={{ fontSize: 16, fontWeight: '900', color: goldColor, marginTop: 4 }}>₹{item.price}</Text>
                  </View>
                  <View style={[s.qtyWrap, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6' }]}>
                    <TouchableOpacity 
                      style={[s.qtyBtn, { backgroundColor: isDark ? '#2C2C2E' : '#fff' }]} 
                      onPress={() => updateQuantity(item.cartKey || item.id, Math.max(0, item.quantity - 1))}
                    >
                      <Text style={[s.qtyText, { color: txt }]}>-</Text>
                    </TouchableOpacity>
                    <Text style={[s.qtyNum, { color: txt }]}>{item.quantity}</Text>
                    <TouchableOpacity 
                      style={[s.qtyBtn, { backgroundColor: isDark ? '#2C2C2E' : '#fff' }]} 
                      onPress={() => updateQuantity(item.cartKey || item.id, item.quantity + 1)}
                    >
                      <Text style={[s.qtyText, { color: txt }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </StaggeredSection>
            ))}

            <StaggeredSection delay={(cart.length + 1) * 80} direction="up">
              <View style={[s.billCard, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}>
                <View style={s.billRow}>
                  <Text style={[s.billLabel, { color: txt }]}>ITEMS SUBTOTAL</Text>
                  <Text style={[s.billVal, { color: txt }]}>₹{totalPrice}</Text>
                </View>
                <View style={s.billRow}>
                  <Text style={[s.billLabel, { color: txt }]}>DELIVERY FEE</Text>
                  <Text style={[s.billVal, { color: txt }]}>₹30</Text>
                </View>
                <View style={[s.billRow, { borderTopWidth: 1, borderTopColor: border, paddingTop: 12 }]}>
                  <Text style={[s.billLabel, { color: txt, fontSize: 14, fontWeight: '900' }]}>GRAND TOTAL</Text>
                  <Text style={{ fontSize: 22, fontWeight: '900', color: goldColor }}>₹{totalPrice + 30}</Text>
                </View>
              </View>
            </StaggeredSection>
          </>
        )}

        <View style={{ height: 200 }} />
      </ScrollView>

      {totalItems > 0 && (
        <FloatingPulse color={goldColor} style={s.checkoutBtnContainer}>
          <TouchableOpacity style={[s.checkoutBtn, { backgroundColor: goldColor, width: '100%' }]} onPress={() => router.push('/checkout' as any)}>
            <Text style={s.checkoutText}>PROCEED TO CHECKOUT</Text>
          </TouchableOpacity>
        </FloatingPulse>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  pageTitle: { fontSize: 20, fontWeight: '900', letterSpacing: 4, paddingHorizontal: 16, marginBottom: 16, textAlign: 'center' },
  groupCard: { marginHorizontal: 16, padding: 16, borderRadius: 20, marginBottom: 16, borderWidth: 1 },
  groupDesc: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  groupBtns: { flexDirection: 'row', gap: 10 },
  hostBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  hostBtnText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  joinBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  joinBtnText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  empty: { padding: 60, alignItems: 'center' },
  emptyText: { fontSize: 13, fontWeight: '600' },
  itemCard: { flexDirection: 'row', marginHorizontal: 16, padding: 12, borderRadius: 16, marginBottom: 10, borderWidth: 1, alignItems: 'center' },
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
});
