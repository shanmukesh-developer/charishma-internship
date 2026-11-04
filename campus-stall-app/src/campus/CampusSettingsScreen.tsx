// In-Campus Booking settings for the stall: the UPI ID students pay to, the name on that UPI account, the stall's
// own UPI QR photo (optional; without it students get a QR made from the UPI ID) and the usual prep time. The
// on / off switch is set by ZCS (admin) and shown here read-only.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NetImage } from '../components/NetImage';
import { campusApi, type CbSettings } from '../lib/campusApi';
import { uploadPhoto } from '../lib/api';
import { errorMessage } from '../lib/http';
import { pickPhoto } from '../lib/photo';
import { color, font, radius, space, touch } from '../theme';
import { Badge, Button, Card, Chip, EmptyState } from '../ui/kit';
import { useToast } from '../ui/Toast';
import { ScreenHeader } from './CampusParts';

const PREP = [5, 10, 15, 20, 30];

export default function CampusSettingsScreen({ onBack, title = 'UPI and pickup', footer }: { onBack?: () => void; title?: string; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [s, setS] = useState<CbSettings | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [upi, setUpi] = useState('');
  const [name, setName] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [prep, setPrep] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const savingRef = useRef(false);

  const apply = (x: CbSettings) => {
    setS(x);
    setUpi(x.upiId || '');
    setName(x.upiName || '');
    setQr(x.qrUrl);
    setPrep(x.prepMinutes);
  };
  const load = () => campusApi.settings().then((r) => { apply(r.settings); setLoadErr(null); }).catch((e) => setLoadErr(errorMessage(e, "Couldn't load the settings.")));
  useEffect(() => { void load(); }, []);

  const pickQr = async (source: 'camera' | 'gallery') => {
    const r = await pickPhoto(source);
    if (!r.ok) { if (r.reason !== 'cancelled') setErr(r.message); return; }
    setUploading(true);
    setErr(null);
    try {
      setQr(await uploadPhoto(r.uri, r.mimeType));
    } catch (e) {
      setErr(errorMessage(e, "The QR photo didn't upload. Please try again."));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (savingRef.current || !s) return;
    const id = upi.trim().toLowerCase();
    if (id && !/^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/.test(id)) { setErr('Enter the UPI ID like stallname@okaxis.'); return; }
    savingRef.current = true;
    setSaving(true);
    setErr(null);
    try {
      const r = await campusApi.saveSettings({ upiId: id || null, upiName: name.trim() || null, qrUrl: qr, prepMinutes: prep });
      apply(r.settings);
      toast.show('Saved.', 'success');
    } catch (e) {
      setErr(errorMessage(e, "Couldn't save. Please try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!s) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <ScreenHeader title={title} onBack={onBack} />
        <EmptyState icon="qr-code-outline" title={loadErr ? "Couldn't load" : 'Loading…'} body={loadErr || undefined} action={loadErr ? { label: 'Try again', onPress: load } : undefined} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <ScreenHeader title={title} sub="In-Campus Booking" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xxl * 2 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Text style={[font.h3, { color: color.text, flex: 1 }]}>In-Campus Booking</Text>
            <Badge text={s.takingBookings ? 'Taking bookings' : s.enabled ? 'Needs UPI ID' : 'Off'} fg={s.takingBookings ? color.openDark : color.warning} bg={s.takingBookings ? color.openTint : color.warningTint} />
          </View>
          <Text style={[font.body, { color: color.textSecondary }]}>
            Students pay you directly on this UPI ID. ZenWe never holds the money. ZenWe records a {s.commissionPct}% commission on each paid booking. ZenWe support switches bookings on or off for your stall.
          </Text>
        </Card>

        <View style={{ gap: 4 }}>
          <Text style={[font.label, { color: color.textMuted }]}>YOUR UPI ID</Text>
          <TextInput value={upi} onChangeText={(t) => { setUpi(t.replace(/\s/g, '')); setErr(null); }} placeholder="stallname@okaxis" placeholderTextColor={color.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={styles.input} accessibilityLabel="UPI ID" />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={[font.label, { color: color.textMuted }]}>NAME ON THE UPI ACCOUNT (OPTIONAL)</Text>
          <TextInput value={name} onChangeText={setName} placeholder="As your UPI app shows it" placeholderTextColor={color.textMuted} maxLength={120} style={styles.input} accessibilityLabel="Name on the UPI account" />
        </View>

        <Card style={{ gap: space.sm }}>
          <Text style={[font.h3, { color: color.text }]}>Your UPI QR (optional)</Text>
          {qr ? <NetImage uri={qr} style={styles.qr} resizeMode="contain" accessibilityLabel="Your UPI QR" /> : (
            <Text style={[font.body, { color: color.textSecondary }]}>Without a photo, students see a QR made from your UPI ID with the exact amount.</Text>
          )}
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Button label="Camera" variant="secondary" size="secondary" icon="camera-outline" onPress={() => pickQr('camera')} loading={uploading} style={{ flex: 1 }} />
            <Button label="Gallery" variant="secondary" size="secondary" icon="images-outline" onPress={() => pickQr('gallery')} disabled={uploading} style={{ flex: 1 }} />
          </View>
          {qr ? <Button label="Remove QR photo" variant="ghost" size="secondary" onPress={() => setQr(null)} /> : null}
        </Card>

        <View style={{ gap: space.xs }}>
          <Text style={[font.label, { color: color.textMuted }]}>USUAL PREP TIME</Text>
          <View style={styles.chips}>
            {PREP.map((m) => <Chip key={m} label={`${m} min`} selected={(prep ?? s.defaultPrepMinutes) === m} onPress={() => setPrep(m)} tone="green" style={{ minWidth: 72 }} />)}
          </View>
          <Text style={[font.small, { color: color.textMuted }]}>Students see when their order should be ready. Default {s.defaultPrepMinutes} min.</Text>
        </View>

        {err ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700' }]} accessibilityLiveRegion="polite">{err}</Text> : null}
        <Button label="SAVE" onPress={save} loading={saving} disabled={uploading} />
        {footer}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { ...font.h3, color: color.text, backgroundColor: color.surface, borderWidth: 2, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: touch.secondary + 4 },
  qr: { width: '100%', height: 240, borderRadius: radius.md, backgroundColor: color.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
