// Full-screen red NEW ORDER alert. Shows while any Pending order is not accepted / rejected / silenced
// (oldest first). Sound + vibration are driven by the Announcer. Accept / Reject run inline here.
import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rupees } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { useVoice } from '../voice/useVoice';
import { color, font, mono, radius, space } from '../theme';
import { Button } from '../ui/kit';
import { KeyboardAwareScrollView } from '../ui/KeyboardAvoidingView';
import { PrepPicker, RejectPicker } from './AcceptReject';
import { CampusTag, Elapsed, ItemLines, NoteCallout, PaymentBadge, SlotLine } from './orderParts';

export function NewOrderAlert() {
  const { alertOrders, silence, busy, isGhostTap } = useStore();
  const voice = useVoice();
  const insets = useSafeAreaInsets();
  const order = alertOrders[0] || null;
  const [mode, setMode] = useState<'view' | 'accept' | 'reject'>('view');

  useEffect(() => { setMode('view'); }, [order?.id]);

  if (!order) return null;
  const more = alertOrders.length - 1;
  const b = busy[order.id];
  // A double tap on the previous order's button must not open / silence this (next) order.
  const guarded = (fn: () => void) => () => { if (!isGhostTap(order.id)) fn(); };

  return (
    // Hardware back only steps out of the accept / reject picker. It never silences the order: an
    // accidental press in a busy kitchen must not stop the ringing (only the explicit Later button does).
    <Modal visible animationType="fade" onRequestClose={() => { if (mode !== 'view') setMode('view'); }} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.sm }]}>
        <KeyboardAwareScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.head}>
            <Ionicons name={voice.settings.enabled ? 'notifications' : 'notifications-off'} size={30} color={color.textInverse} />
            <Text style={[font.h1, { color: color.textInverse, fontSize: 30, lineHeight: 36 }]}>NEW ORDER</Text>
          </View>
          {more > 0 ? (
            <View style={styles.more}>
              <Text style={[font.body, { color: color.alertDark, fontWeight: '800' }]}>+{more} more waiting</Text>
            </View>
          ) : null}

          <View style={styles.panel}>
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.row}>
                  <Text style={[font.orderId, mono, { color: color.text, fontSize: 26, lineHeight: 32 }]}>#{order.shortId}</Text>
                  <CampusTag order={order} />
                </View>
                <Elapsed order={order} />
              </View>
              <PaymentBadge order={order} />
            </View>
            <SlotLine order={order} />
            <ItemLines order={order} />
            <NoteCallout order={order} />
            <View style={[styles.row, styles.total]}>
              <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>{order.itemCount} item{order.itemCount === 1 ? '' : 's'} · item total</Text>
              <Text style={[font.money, { color: color.text }]}>{rupees(order.totalPrice)}</Text>
            </View>
          </View>

          {mode === 'accept' ? (
            <PrepPicker order={order} onRed onDone={() => setMode('view')} onBack={() => setMode('view')} />
          ) : mode === 'reject' ? (
            <RejectPicker order={order} onRed onDone={() => setMode('view')} onBack={() => setMode('view')} />
          ) : (
            <View style={{ gap: space.sm }}>
              <Button label="ACCEPT" variant="accept" size="huge" icon="checkmark-circle" onPress={guarded(() => setMode('accept'))} disabled={!!b} />
              <View style={styles.row}>
                <Button label="Reject" variant="onRed" onPress={guarded(() => setMode('reject'))} disabled={!!b} style={{ flex: 1 }} />
                <Button
                  label="Later"
                  variant="outlineOnRed"
                  icon="volume-mute"
                  onPress={guarded(() => silence([order.id]))}
                  disabled={!!b}
                  style={{ flex: 1 }}
                  a11y="Stop ringing for this order. It stays in New"
                />
              </View>
              <Text style={[font.small, { color: color.textInverse, textAlign: 'center' }]}>
                Later = stop ringing. The order stays in New. Not accepted in time = auto-cancelled.
              </Text>
            </View>
          )}
        </KeyboardAwareScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.alert },
  scroll: { gap: space.md, paddingHorizontal: space.md, paddingBottom: space.md, maxWidth: 640, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center' },
  more: { alignSelf: 'center', backgroundColor: color.surface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xxs },
  panel: { backgroundColor: color.surface, borderRadius: radius.xl, padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  total: { borderTopWidth: 1, borderTopColor: color.surfaceAlt, paddingTop: space.sm },
});
