// Settings: voice announcements (on/off, language, test), shop info, licences & tax, support, log out.
import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config';
import { formatHHMM } from '../lib/model';
import { useSession } from '../state/SessionProvider';
import { useStore } from '../state/StoreProvider';
import { LANG_LABEL, LANG_NAME_EN, VoiceLang } from '../voice/phrases';
import { useVoice } from '../voice/useVoice';
import { testVoice, updateVoiceSettings } from '../voice/voice';
import { hasKitchenService } from '../voice/kitchenService';
import { color, font, radius, space, touch } from '../theme';
import { Button, Card, IconName, Sheet } from '../ui/kit';
import { LEGAL_LABELS, SETTINGS_PAGES, openLegal } from '../lib/legal';
import CompliancePanel from '../components/CompliancePanel';
import type { RootStack } from './MainScreen';

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

const LANGS: VoiceLang[] = ['te', 'hi', 'en'];

export default function SettingsScreen() {
  const { restaurant, store, setOpen, orders } = useStore();
  // Accepted / on-the-way orders are never auto-cancelled for a stall: the customer keeps waiting for them.
  const running = orders.filter((o) => o.stage === 'accepted' || o.stage === 'outForDelivery').length;
  const { signOut } = useSession();
  const voice = useVoice();
  const [confirmOut, setConfirmOut] = useState(false);
  const [deleteInfo, setDeleteInfo] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [closing, setClosing] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  // Logging out stops the ringing but not the shop: offer to close it first, or orders keep coming in
  // with nobody to accept them (each one auto-cancels after the accept window).
  const canCloseOnLogout = !!store?.isOpenNow && store?.isActive !== false;
  const closeOut = () => { setConfirmOut(false); setCloseErr(null); };
  const closeAndSignOut = async () => {
    if (closing) return;
    setClosing(true);
    setCloseErr(null);
    const res = await setOpen(false);
    setClosing(false);
    if (!res.ok) { setCloseErr(res.error || 'Could not close the shop. Try again.'); return; }
    setConfirmOut(false);
    signOut();
  };
  const hours = store?.operatingHours || restaurant.operatingHours || null;
  const name = store?.name || restaurant.name;
  const location = store?.location || restaurant.location;
  const { enabled, lang } = voice.settings;
  const fellBack = voice.effectiveLang !== lang;

  const wa = () => {
    const text = encodeURIComponent(`Vendor ${name} needs help`);
    Linking.openURL(`https://wa.me/${SUPPORT_PHONE}?text=${text}`).catch(() => {});
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xxl * 2 }}>
      <Text style={[font.label, { color: color.textMuted }]}>VOICE ANNOUNCEMENTS</Text>
      <Card style={{ gap: space.md }}>
        <View style={styles.row}>
          <Ionicons name={enabled ? 'volume-high' : 'volume-mute'} size={26} color={enabled ? color.openDark : color.alert} />
          <View style={{ flex: 1 }}>
            <Text style={[font.h3, { color: color.text }]}>Voice</Text>
            <Text style={[font.small, { color: enabled ? color.textMuted : color.alertDark, fontWeight: enabled ? '500' : '800' }]}>
              {enabled ? 'Speaks new orders (Telugu first) and cancels' : 'OFF — new orders only vibrate'}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => updateVoiceSettings({ enabled: v })}
            accessibilityLabel="Voice announcements"
            trackColor={{ true: color.open, false: color.border }}
            thumbColor={color.surface}
            style={{ transform: [{ scale: 1.25 }] }}
          />
        </View>

        <View style={{ gap: space.xs }}>
          <Text style={[font.label, { color: color.textSecondary }]}>LANGUAGE</Text>
          <View style={styles.segment}>
            {LANGS.map((l) => {
              const sel = l === lang;
              const missing = voice.available[l] === false;
              return (
                <Pressable
                  key={l}
                  onPress={() => updateVoiceSettings({ lang: l })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={`${LANG_NAME_EN[l]}${missing ? ', voice not installed' : ''}`}
                  style={[styles.seg, sel && styles.segSel]}
                >
                  <Text style={[font.h3, { color: sel ? color.textInverse : color.text }]}>{LANG_LABEL[l]}</Text>
                  {missing ? <Text style={[font.label, { color: sel ? color.textInverse : color.warning, fontSize: 10 }]}>NOT INSTALLED</Text> : null}
                </Pressable>
              );
            })}
          </View>
          {fellBack ? (
            <View style={styles.warn}>
              <Ionicons name="information-circle" size={20} color={color.warning} />
              <Text style={[font.small, { color: color.warning, flex: 1, fontWeight: '700' }]}>
                {LANG_NAME_EN[lang]} voice is not installed on this phone, so it speaks {LANG_NAME_EN[voice.effectiveLang]}.
                To add it: phone Settings → Text-to-speech → Google → Install voice data → {LANG_NAME_EN[lang]}.
              </Text>
            </View>
          ) : null}
        </View>

        <Button label="TEST VOICE" icon="megaphone" variant="secondary" onPress={testVoice} />
        <Text style={[font.small, { color: color.textMuted }]}>
          Keep the volume up and the phone charging. New orders ring every 20 seconds until you accept or reject.
          {hasKitchenService() ? ' Alerts keep working with the screen locked.' : ' Keep this app open on the screen.'}
        </Text>
      </Card>

      <Text style={[font.label, { color: color.textMuted }]}>SHOP</Text>
      <Card style={{ gap: 4 }}>
        <Text style={[font.h2, { color: color.text }]}>{name}</Text>
        {location ? <Text style={[font.body, { color: color.textSecondary }]}>{location}</Text> : null}
        <Text style={[font.body, { color: color.textSecondary }]}>
          Hours: {hours?.start && hours?.end && hours.start !== hours.end ? `${formatHHMM(hours.start)} – ${formatHHMM(hours.end)}` : 'Open all day'}
        </Text>
        {restaurant.phone || restaurant.whatsappNumber ? (
          <Text style={[font.body, { color: color.textSecondary }]}>Phone: {restaurant.phone || restaurant.whatsappNumber}</Text>
        ) : null}
        <Text style={[font.small, { color: color.textMuted }]} selectable>Stall ID: {restaurant.id}</Text>
      </Card>

      <CompliancePanel />

      <Text style={[font.label, { color: color.textMuted }]}>PAYOUTS</Text>
      <Card style={{ paddingVertical: 0 }}>
        <LinkRow icon="wallet-outline" label="Payout statements" sub="Amounts, status, UTR and paid dates" onPress={() => navigation.navigate('Payouts')} />
      </Card>

      <Text style={[font.label, { color: color.textMuted }]}>HELP</Text>
      <Card style={{ paddingVertical: 0 }}>
        <LinkRow icon="call" label="Call ZENV support" sub={SUPPORT_PHONE_DISPLAY} onPress={() => Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {})} />
        <View style={{ height: 1, backgroundColor: color.surfaceAlt }} />
        <LinkRow icon="logo-whatsapp" label="WhatsApp support" sub="Menu, hours, password, anything else" onPress={wa} />
      </Card>

      <Text style={[font.label, { color: color.textMuted }]}>LEGAL</Text>
      <Card style={{ paddingVertical: 0 }}>
        {SETTINGS_PAGES.map((p, i) => (
          <View key={p}>
            {i > 0 ? <View style={{ height: 1, backgroundColor: color.surfaceAlt }} /> : null}
            <LinkRow icon="document-text-outline" label={LEGAL_LABELS[p]} onPress={() => openLegal(p)} />
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: color.surfaceAlt }} />
        <LinkRow icon="trash-outline" label="Delete account" sub="Close this shop account" onPress={() => setDeleteInfo(true)} />
      </Card>

      <Button label="Log out" icon="log-out-outline" variant="rejectOutline" size="secondary" onPress={() => { setCloseErr(null); setConfirmOut(true); }} />

      {/* C9: store accounts are created by Zenvy, so the Zenvy team closes them (Play account-deletion policy). */}
      <Sheet visible={deleteInfo} onClose={() => setDeleteInfo(false)} title="Delete account">
        <Text style={[font.body, { color: color.textSecondary, marginBottom: space.sm }]}>
          Shop accounts are set up by ZENV, so the ZENV team closes them for you. Email us from the owner's registered email or
          mobile number, or call support. We confirm the request with the owner, settle any payouts and close the account within
          7 days. Order, payout and tax records are kept as the law requires.
        </Text>
        <View style={{ gap: space.xs }}>
          <Button
            label="Email ZENV"
            icon="mail-outline"
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Close my ZENV shop account (${name})`)}`).catch(() => {})}
          />
          <Button label="Call ZENV support" icon="call-outline" variant="secondary" size="secondary" onPress={() => Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {})} />
          <Button label="How account deletion works" variant="secondary" size="secondary" onPress={() => openLegal('deleteAccount')} />
          <Button label="Cancel" variant="secondary" size="secondary" onPress={() => setDeleteInfo(false)} />
        </View>
      </Sheet>

      <Sheet visible={confirmOut} onClose={closeOut} title="Log out?">
        <Text style={[font.body, { color: color.textSecondary, marginBottom: space.md }]}>
          {canCloseOnLogout
            ? 'Your shop is OPEN. After you log out, new orders will not ring on this phone and will be cancelled if nobody accepts them.'
            : 'New orders will not ring on this phone after you log out.'}
        </Text>
        {running ? (
          <Text style={[font.body, { color: color.alertDark, fontWeight: '800', marginBottom: space.md }]}>
            You still have {running} order{running === 1 ? '' : 's'} to deliver. The customer{running === 1 ? ' is' : 's are'} waiting: deliver or cancel {running === 1 ? 'it' : 'them'} first.
          </Text>
        ) : null}
        {closeErr ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700', marginBottom: space.sm }]}>{closeErr}</Text> : null}
        <View style={{ gap: space.xs }}>
          {canCloseOnLogout ? (
            <>
              <Button label="CLOSE SHOP & LOG OUT" variant="reject" onPress={closeAndSignOut} loading={closing} />
              <Button label="Log out, keep shop open" variant="rejectOutline" size="secondary" onPress={() => { closeOut(); signOut(); }} disabled={closing} />
            </>
          ) : (
            <Button label="LOG OUT" variant="reject" onPress={() => { closeOut(); signOut(); }} />
          )}
          <Button label="Cancel" variant="secondary" size="secondary" onPress={closeOut} disabled={closing} />
        </View>
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.secondary + 8 },
  segment: { flexDirection: 'row', gap: space.xs },
  seg: {
    flex: 1, minHeight: touch.primary, borderRadius: radius.md, borderWidth: 2, borderColor: color.border, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  segSel: { backgroundColor: color.text, borderColor: color.text },
  warn: { flexDirection: 'row', gap: space.xs, backgroundColor: color.warningTint, borderRadius: radius.md, padding: space.sm },
});
