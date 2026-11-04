// Settings tab: In-Campus Booking UPI ID / QR / prep time (CampusSettingsScreen), then this phone's alerts,
// ZCS support, legal pages and log out.
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CampusSettingsScreen from '../campus/CampusSettingsScreen';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config';
import { LEGAL_LABELS, SETTINGS_PAGES, openLegal } from '../lib/legal';
import type { PushState } from '../lib/push';
import { useSession } from '../state/SessionProvider';
import { color, font, space } from '../theme';
import { Button, Card, IconName, Sheet } from '../ui/kit';

function LinkRow({ icon, label, sub, onPress }: { icon: IconName; label: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={24} color={color.text} />
      <View style={{ flex: 1 }}>
        <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{label}</Text>
        {sub ? <Text style={[font.small, { color: color.textMuted }]}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={color.textMuted} />
    </Pressable>
  );
}

const PUSH_TEXT: Record<PushState, string> = {
  ok: 'On. New bookings reach this phone even when the app is closed.',
  blocked: 'Notifications are off for this app. Turn them on in the phone settings to hear about new bookings.',
  unavailable: 'Closed-app alerts are not set up on this build yet. Keep the app open during service: bookings arrive live.',
  unknown: 'Checking…',
};

export default function StallSettingsScreen({ pushState }: { pushState: PushState }) {
  const { restaurant, signOut } = useSession();
  const [confirmOut, setConfirmOut] = useState(false);
  const wa = () => Linking.openURL(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(`Hi ZenWe, ${restaurant?.name || 'my stall'} needs help with In-Campus Booking.`)}`).catch(() => {});

  const footer = (
    <View style={{ gap: space.md, marginTop: space.md }}>
      <Text style={[font.label, { color: color.textMuted }]}>ALERTS ON THIS PHONE</Text>
      <Card style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Ionicons name={pushState === 'ok' ? 'notifications' : 'notifications-off-outline'} size={24} color={pushState === 'ok' ? color.openDark : color.warning} />
        <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>{PUSH_TEXT[pushState]}</Text>
      </Card>

      <Text style={[font.label, { color: color.textMuted }]}>SUPPORT</Text>
      <Card style={{ paddingVertical: 0 }}>
        <LinkRow icon="call" label="Call ZenWe support" sub={SUPPORT_PHONE_DISPLAY} onPress={() => Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {})} />
        <LinkRow icon="logo-whatsapp" label="WhatsApp support" sub="Bookings, UPI, menu, anything else" onPress={wa} />
      </Card>

      <Text style={[font.label, { color: color.textMuted }]}>LEGAL</Text>
      <Card style={{ paddingVertical: 0 }}>
        {SETTINGS_PAGES.map((p) => <LinkRow key={p} icon="document-text-outline" label={LEGAL_LABELS[p]} onPress={() => openLegal(p)} />)}
      </Card>

      <Text style={[font.small, { color: color.textMuted, textAlign: 'center' }]}>{restaurant?.name || ''} · ZenWe Campus Stall 1.0.0</Text>
      <Button label="Log out" variant="rejectOutline" icon="log-out-outline" onPress={() => setConfirmOut(true)} />
      {confirmOut ? (
        <Sheet visible onClose={() => setConfirmOut(false)} title="Log out of ZenWe Campus Stall?">
          <View style={{ gap: space.sm }}>
            <Text style={[font.body, { color: color.textSecondary }]}>New bookings will not reach this phone until you log in again. Students can still book while your stall is open.</Text>
            <Button label="Log out" variant="reject" onPress={() => { setConfirmOut(false); signOut(); }} />
            <Button label="Stay logged in" variant="secondary" onPress={() => setConfirmOut(false)} />
          </View>
        </Sheet>
      ) : null}
    </View>
  );

  return <CampusSettingsScreen title="Settings" footer={footer} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 64, borderBottomWidth: 1, borderBottomColor: color.surfaceAlt },
});
