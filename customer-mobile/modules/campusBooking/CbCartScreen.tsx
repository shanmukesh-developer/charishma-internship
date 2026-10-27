/**
 * In-Campus Booking cart, in checkout's look (app/checkout): the header, section titles, item lines with the
 * stepper, the pickup notice card, the payment method card (one option: pay the stall by UPI), the bill card and
 * the red "Proceed to pay" button. The server prices the booking again and checks the stall is open now; one
 * Idempotency-Key per cart content, so a dropped connection never books twice.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FssaiLine from '../../components/FssaiLine';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { cbApi, newIdempotencyKey, type CbStall } from './cbApi';
import { cbCart, isNonFood, useCbCart } from './cbCart';
import { COLORS, inr, useCbTheme } from './cbTheme';
import { AddControl, CbHeader, EmptyCard, PlaceButton, StaggeredSection, VegBox } from './cbKit';

export default function CbCartScreen({ stallId }: { stallId: string }) {
  const p = useCbTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cart = useCbCart(stallId);
  const [stall, setStall] = useState<CbStall | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const sig = JSON.stringify(cart.lines.map((l) => [l.menuItemId, l.quantity]));

  const refresh = useCallback(async () => {
    try {
      const d = await cbApi.stall(stallId);
      setStall(d.stall);
      const removed = cbCart.refresh(stallId, d.menu);
      const sold = d.menu.filter((m) => !m.isAvailable && cbCart.qty(stallId, m.id) > 0).map((m) => m.name);
      setNotice([removed.length ? `${removed.join(', ')} left the menu and ${removed.length === 1 ? 'was' : 'were'} removed.` : '', sold.length ? `${sold.join(', ')} ${sold.length === 1 ? 'is' : 'are'} sold out right now. Remove ${sold.length === 1 ? 'it' : 'them'} to book.` : ''].filter(Boolean).join(' ') || null);
    } catch (e: any) {
      if (e?.status === 404) setError('This stall is not taking bookings right now.');
    }
  }, [stallId]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const proceed = async () => {
    if (busy || !cart.lines.length) return;
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };
    setBusy(true);
    setError(null);
    try {
      const { booking } = await cbApi.book(stallId, cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })), keyRef.current.key, note.trim() || undefined);
      cbCart.clear(stallId);
      keyRef.current = null;
      router.replace(`/campus-booking/pay/${booking.id}` as any);
    } catch (e: any) {
      setError(e?.message || 'Could not book. Please try again.');
      if (['ITEM_UNAVAILABLE', 'ITEM_GONE', 'STALL_CLOSED', 'NOT_TAKING_BOOKINGS'].includes(e?.code)) void refresh();
    } finally {
      setBusy(false);
    }
  };

  const stallName = stall?.name || 'the stall';
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.page }}>
      <CbHeader title="Your cart" sub={stall ? `from ${stall.name}` : undefined} />
      {!cart.loaded ? <View style={{ padding: 16 }}><EmptyCard loading title="Loading your cart" /></View> : !cart.lines.length ? (
        <View style={{ padding: 16 }}>
          <EmptyCard icon="bag-handle-outline" title="Your cart is empty" sub="Add items from the stall menu to book them for pickup." actionLabel="Back to the menu" onAction={() => (router.canGoBack() ? router.back() : router.replace(`/campus-booking/stall/${stallId}` as any))} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 + insets.bottom }]} keyboardShouldPersistTaps="handled">
          {notice ? (
            <View style={[s.noticeCard, { backgroundColor: p.amberSoft, borderColor: 'rgba(245,158,11,0.3)' }]}>
              <Ionicons name="alert-circle-outline" size={20} color={p.amber} />
              <Text style={[s.noticeSub, { color: p.txt, flex: 1, marginTop: 0 }]}>{notice}</Text>
            </View>
          ) : null}

          <StaggeredSection delay={0} direction="up">
            <Text style={[s.sectionTitle, { color: p.txt }]}>Items</Text>
            <View style={[s.billCard, { backgroundColor: p.card, borderColor: p.border, borderWidth: 1 }]}>
              {cart.lines.map((l, i) => (
                <View key={l.menuItemId} style={[s.line, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border }]}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {isNonFood(l.category) ? null : <VegBox veg={l.isVeg} />}
                      <Text style={{ fontSize: 13, fontWeight: '600', color: p.txt, flex: 1 }} numberOfLines={2}>{l.name}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: p.txtSec, marginTop: 3, marginLeft: isNonFood(l.category) ? 0 : 20 }}>{inr(l.price)} each</Text>
                  </View>
                  <AddControl qty={l.quantity} onAdd={() => cbCart.change(stallId, l, 1)} onRemove={() => cbCart.change(stallId, l, -1)} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: p.txt, width: 64, textAlign: 'right' }}>{inr(Math.round(l.price * l.quantity * 100) / 100)}</Text>
                </View>
              ))}
            </View>
          </StaggeredSection>

          <StaggeredSection delay={80} direction="up">
            <View style={[s.noticeCard, { backgroundColor: p.card, borderColor: p.border, marginTop: 16 }]}>
              <Ionicons name="storefront-outline" size={20} color={p.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[s.noticeTitle, { color: p.txt }]}>Pickup at {stallName}</Text>
                <Text style={[s.noticeSub, { color: p.txtSec }]}>
                  {stall ? `Usually ready in about ${stall.prepMinutes} minutes after the stall accepts. Collect at the counter with your pickup code.` : 'Collect at the counter with your pickup code.'}
                </Text>
              </View>
            </View>

            <Text style={[s.sectionTitle, { color: p.txt, marginTop: 8 }]}>Payment method</Text>
            <View style={[s.payCardNew, { backgroundColor: p.card, borderColor: COLORS.red }, { backgroundColor: p.isDark ? 'rgba(239,79,95,0.06)' : 'rgba(239,79,95,0.03)' }]} accessibilityRole="radio" accessibilityState={{ selected: true, checked: true }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name="qr-code-outline" size={22} color={COLORS.red} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.payCardTitle, { color: COLORS.red }]}>Pay the stall by UPI</Text>
                  <Text style={[s.payCardDesc, { color: p.txtSec }]}>You will pay to {stallName}'s own UPI ID on the next screen. ZCS does not take or hold your money.</Text>
                </View>
                <View style={[s.radioOuter, { borderColor: COLORS.red }]}><View style={[s.radioInner, { backgroundColor: COLORS.red }]} /></View>
              </View>
            </View>

            <Text style={[s.sectionTitle, { color: p.txt, marginTop: 20 }]}>Note for the stall</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Optional, for example less sugar"
              placeholderTextColor={p.txtSec}
              maxLength={200}
              style={[s.input, { color: p.txt, backgroundColor: p.card, borderColor: p.border }]}
              accessibilityLabel="Note for the stall"
            />
          </StaggeredSection>

          <StaggeredSection delay={160} direction="up">
            <View style={[s.billCard, { backgroundColor: p.card, borderColor: p.border, borderWidth: 1, marginTop: 16 }]}>
              <View style={s.billRow}>
                <Text style={[s.billLabel, { color: p.txt }]}>Item total</Text>
                <Text style={[s.billVal, { color: p.txt }]}>{inr(cart.total)}</Text>
              </View>
              <View style={s.billRow}>
                <Text style={[s.billLabel, { color: p.txt }]}>Pickup at the stall</Text>
                <Text style={[s.billVal, { color: COLORS.emerald }]}>No fee</Text>
              </View>
              <View style={[s.billRow, { borderTopWidth: 1, borderTopColor: p.border, paddingTop: 12, marginTop: 8 }]}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: p.txt }}>Pay the stall</Text>
                <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.red }}>{inr(cart.total)}</Text>
              </View>
              <Text style={[s.helperText, { color: p.txtSec, marginTop: 6 }]}>You pay {stallName} directly by UPI. The stall confirms the payment before it prepares your order.</Text>
              <FssaiLine number={stall?.fssaiLicenseNumber} storeName={stall?.name || undefined} color={p.txtSec} />
            </View>
          </StaggeredSection>

          {stall && !stall.isOpen ? (
            <View style={[s.noticeCard, { backgroundColor: p.redSoft, borderColor: 'rgba(239,79,95,0.25)', marginTop: 16, marginBottom: 0 }]}>
              <Ionicons name="moon-outline" size={20} color={COLORS.red} />
              <Text style={[s.noticeSub, { color: p.txt, flex: 1, marginTop: 0 }]}>{stall.closedReason || 'The stall is closed right now. You can book when it opens.'}</Text>
            </View>
          ) : null}
          {error ? <Text style={[s.errorText, { color: COLORS.red }]} accessibilityLiveRegion="polite">{error}</Text> : null}

          <View style={s.placeBtnContainer}>
            <PlaceButton label={`Proceed to pay · ${inr(cart.total)}`} busyLabel="Booking…" onPress={proceed} busy={busy} disabled={!!stall && !stall.isOpen} />
          </View>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, width: '100%', maxWidth: 600, alignSelf: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2, marginBottom: 12 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
  billCard: { padding: 16, borderRadius: 20 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  billLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  billVal: { fontSize: 12, fontWeight: '600' },
  helperText: { fontSize: 12, fontWeight: '600', lineHeight: 15, marginBottom: 6 },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  noticeTitle: { fontSize: 12, fontWeight: '700' },
  noticeSub: { fontSize: 12, fontWeight: '600', marginTop: 2, lineHeight: 15 },
  payCardNew: { padding: 14, borderRadius: 16, borderWidth: 1.5 },
  payCardTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  payCardDesc: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  radioOuter: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 8, height: 8, borderRadius: 4 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 13, fontWeight: '600' },
  errorText: { fontSize: 13, fontWeight: '600', marginTop: 16, textAlign: 'center' },
  placeBtnContainer: { marginTop: 24 },
});
