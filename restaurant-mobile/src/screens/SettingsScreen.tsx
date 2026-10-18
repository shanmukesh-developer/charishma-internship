// Settings: voice announcements (on/off, language, test), store info, licences & tax, support, log out.
import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config';
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
  const { restaurant, store, setOpen, openToggleSupported } = useStore();
  const { signOut } = useSession();
  const voice = useVoice();
  const [confirmOut, setConfirmOut] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  // Logging out stops the ringing but not the store: offer to close it first, or orders keep coming in
  // with nobody to accept them (each one auto-cancels after the accept window).
  const canCloseOnLogout = !!store?.isOpenNow && store?.isActive !== false && openToggleSupported;
  const closeOut = () => { setConfirmOut(false); setCloseErr(null); };
  const closeAndSignOut = async () => {
    if (closing) return;
    setClosing(true);
    setCloseErr(null);
    const res = await setOpen(false);
    setClosing(false);
    if (!res.ok) { setCloseErr(res.error || 'Could not close the store. Try again.'); return; }
    setConfirmOut(false);
    signOut();
  };
  const hours = store?.operatingHours || restaurant.operatingHours || null;
  const name = store?.name || restaurant.name;
  const location = store?.location || restaurant.location;
  const { enabled, lang } = voice.settings;
  const fellBack = voice.effectiveLang !== lang;

  const wa = () => {
    const text = encodeURIComponent(`Restaurant ${name} needs help`);
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
              {enabled ? 'Speaks new orders, cancels, rider arrival' : 'OFF — new orders only vibrate'}
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

      <Text style={[font.label, { color: color.textMuted }]}>STORE</Text>
      <Card style={{ gap: 4 }}>
        <Text style={[font.h2, { color: color.text }]}>{name}</Text>
        {location ? <Text style={[font.body, { color: color.textSecondary }]}>{location}</Text> : null}
        <Text style={[font.body, { color: color.textSecondary }]}>
          Hours: {hours?.start && hours?.end && hours.start !== hours.end ? `${formatHHMM(hours.start)} – ${formatHHMM(hours.end)}` : 'Open all day'}
        </Text>
        <Text style={[font.small, { color: color.textMuted }]} selectable>ID: {restaurant.id}</Text>
      </Card>

      <CompliancePanel />

      <Text style={[font.label, { color: color.textMuted }]}>HELP</Text>
      <Card style={{ paddingVertical: 0 }}>
        <LinkRow icon="call" label="Call Zenvy support" sub={SUPPORT_PHONE_DISPLAY} onPress={() => Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {})} />
        <View style={{ height: 1, backgroundColor: color.surfaceAlt }} />
        <LinkRow icon="logo-whatsapp" label="WhatsApp support" sub="Menu, hours, payouts, anything else" onPress={wa} />
      </Card>

      <Text style={[font.label, { color: color.textMuted }]}>LEGAL</Text>
      <Card style={{ paddingVertical: 0 }}>
        {SETTINGS_PAGES.map((p, i) => (
          <View key={p}>
            {i > 0 ? <View style={{ height: 1, backgroundColor: color.surfaceAlt }} /> : null}
            <LinkRow icon="document-text-outline" label={LEGAL_LABELS[p]} onPress={() => openLegal(p)} />
          </View>
        ))}
      </Card>

      <Button label="Log out" icon="log-out-outline" variant="rejectOutline" size="secondary" onPress={() => { setCloseErr(null); setConfirmOut(true); }} />

      <Sheet visible={confirmOut} onClose={closeOut} title="Log out?">
        <Text style={[font.body, { color: color.textSecondary, marginBottom: space.md }]}>
          {canCloseOnLogout
            ? 'Your store is OPEN. After you log out, new orders will not ring on this phone and will be cancelled if nobody accepts them.'
            : 'New orders will not ring on this phone after you log out.'}
        </Text>
        {closeErr ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700', marginBottom: space.sm }]}>{closeErr}</Text> : null}
        <View style={{ gap: space.xs }}>
          {canCloseOnLogout ? (
            <>
              <Button label="CLOSE STORE & LOG OUT" variant="reject" onPress={closeAndSignOut} loading={closing} />
              <Button label="Log out, keep store open" variant="rejectOutline" size="secondary" onPress={() => { closeOut(); signOut(); }} disabled={closing} />
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
