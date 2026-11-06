// Full-screen red NEW ORDER alert. Shows while any Pending order is waiting (oldest first) and keeps
// ringing (driven by the Announcer) until the vendor accepts, rejects or puts it off with "Later" (stops the
// ringing and hides this screen; the order stays in New). Accept / Reject run inline.
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
import { AddressBlock, CollectLine, Elapsed, ItemLines, NoteCallout, ReasonPicker } from './orderParts';

export function NewOrderAlert() {
  const { alertOrders, busy, accept, actionErrors, silence } = useStore();
  const voice = useVoice();
  const insets = useSafeAreaInsets();
  const order = alertOrders[0] || null;
  const [mode, setMode] = useState<'view' | 'reject'>('view');

  useEffect(() => { setMode('view'); }, [order?.id]);

  if (!order) return null;
  const more = alertOrders.length - 1;
  const b = busy[order.id];
  const err = !b && mode === 'view' ? actionErrors[order.id] : undefined;

  return (
    // Hardware back only steps out of the reject picker. It never silences the order: an accidental press in
    // a busy shop must not stop the ringing (only the explicit Later button does).
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
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[font.h2, { color: color.text }]} numberOfLines={1}>{order.customerName || 'Customer'}</Text>
                <View style={styles.row}>
                  <Text style={[font.body, mono, { color: color.textSecondary, fontWeight: '800' }]}>{order.orderCode}</Text>
                  <Elapsed order={order} />
                </View>
              </View>
              <Text style={[font.money, { color: color.text }]}>{rupees(order.finalPrice)}</Text>
            </View>
            <ItemLines order={order} />
            <NoteCallout order={order} />
            <AddressBlock order={order} />
            <CollectLine order={order} />
          </View>

          {mode === 'reject' ? (
            <ReasonPicker order={order} kind="reject" onRed onDone={() => setMode('view')} onBack={() => setMode('view')} />
          ) : (
            <View style={{ gap: space.sm }}>
              {err ? (
                <View style={styles.err} accessibilityLiveRegion="assertive">
                  <Text style={[font.body, { color: color.alertDark, fontWeight: '800' }]}>{err}</Text>
                </View>
              ) : null}
              <Button
                label="ACCEPT"
                variant="accept"
                size="huge"
                icon="checkmark-circle"
                onPress={() => accept(order)}
                loading={b === 'accept'}
                disabled={!!b}
              />
              <View style={styles.row}>
                <Button label="Reject" variant="onRed" onPress={() => setMode('reject')} disabled={!!b} style={{ flex: 1 }} />
                <Button
                  label="Later"
                  variant="outlineOnRed"
                  icon="volume-mute"
                  onPress={() => silence([order.id])}
                  disabled={!!b}
                  style={{ flex: 1 }}
                  a11y="Stop ringing for this order. It stays in New"
                />
              </View>
              <Text style={[font.small, { color: color.textInverse, textAlign: 'center' }]}>
                You deliver this order yourself. Later = stop ringing, the order stays in New. Not accepted in time = auto-cancelled.
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
  err: { backgroundColor: color.surface, borderRadius: radius.md, padding: space.sm },
});
