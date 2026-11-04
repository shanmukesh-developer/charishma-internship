/**
 * "Pay the stall by UPI" (the new step), in checkout's look: the stall's own UPI ID and QR (the stall's uploaded QR,
 * else a QR made from its UPI ID with the exact amount) in a bill card, then the payment proof: a screenshot
 * (private upload, max 5 MB), the UPI reference, or both. Submit sends it to the stall to check. ZCS never takes
 * the money.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import SafeImage from '../../components/SafeImage';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { alertUploadError, pickImageAsset, prepareAndUploadImage, resolveMediaUrl, type UploadedImage } from '../../utils/imageUpload';
import { cbApi, type CbBooking } from './cbApi';
import { COLORS, inr, useCbTheme } from './cbTheme';
import { CbHeader, EmptyCard, OutlineButton, PlaceButton, StaggeredSection, useCbLive } from './cbKit';

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const minutesLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000)) : null);

export default function CbPay({ id }: { id: string }) {
  const p = useCbTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [b, setB] = useState<CbBooking | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [shot, setShot] = useState<UploadedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState<'submit' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which proof the stall side refused as already used for another booking (red outline on that field).
  const [badField, setBadField] = useState<'ref' | 'shot' | null>(null);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await cbApi.booking(id);
      setB(r.booking);
      setLoadErr(null);
      // Proof already sent, accepted or finished: this step is done, show the tracking screen.
      if (!r.booking.canSubmitProof && r.booking.status !== 'REJECTED') router.replace(`/campus-booking/order/${id}` as any);
    } catch (e: any) {
      setLoadErr(e?.message || 'Could not load the booking.');
    }
  }, [id, router]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useCbLive((e) => { if (!e.id || e.id === id) void load(); });
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const pickShot = async () => {
    if (uploading) return;
    const asset = await pickImageAsset({ source: 'library' });
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > MAX_PROOF_BYTES * 4) { setError('That picture is too large. Pick the payment screenshot (up to 5 MB).'); return; }
    setUploading(true);
    setError(null);
    try {
      // Screenshots keep their text sharp at 1600 px on the long edge.
      setShot(await prepareAndUploadImage(asset, 'campus_payment', { maxEdge: 1600, quality: 0.8 }));
      if (badField === 'shot') { setBadField(null); setError(null); }
    } catch (e) {
      alertUploadError(e, pickShot, 'Screenshot did not upload');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!b || busy) return;
    const upiRef = ref.replace(/[\s-]/g, '');
    if (!shot) { setBadField('shot'); setError('Upload the payment screenshot. The stall checks it with the transaction ID.'); return; }
    if (!upiRef) { setBadField('ref'); setError('Enter the transaction ID from your UPI app (UTR / UPI Ref No.).'); return; }
    if (upiRef && !/^[A-Za-z0-9]{6,35}$/.test(upiRef)) { setError('Enter the UPI reference exactly as your UPI app shows it (6 to 35 letters or digits).'); return; }
    setBusy('submit');
    setError(null);
    setBadField(null);
    try {
      await cbApi.submitProof(b.id, { imageUrl: shot ? shot.url : null, upiRef: upiRef || null });
      router.replace(`/campus-booking/order/${b.id}` as any);
    } catch (e: any) {
      if (e?.code === 'PROOF_REQUIRED') {
        setBadField(e?.data?.field === 'ref' ? 'ref' : 'shot');
        setError(e?.message || 'Send the payment screenshot and the transaction ID.');
      } else if (e?.code === 'REF_ALREADY_USED') {
        setBadField('ref');
        setError(e?.message || 'This UPI reference was already used for another booking. Check the number in your UPI app.');
      } else if (e?.code === 'SCREENSHOT_ALREADY_USED') {
        // The same picture cannot be sent twice: drop it so the card asks for this payment's screenshot.
        setShot(null);
        setBadField('shot');
        setError(e?.message || 'This screenshot was already sent for another booking. Upload the screenshot of this payment.');
      } else {
        setError(e?.message || 'Could not send the payment proof. Please try again.');
      }
      if (e?.code === 'BAD_TRANSITION' || e?.code === 'CHANGED') void load();
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!b || busy) return;
    setBusy('cancel');
    try {
      await cbApi.cancel(b.id);
      router.replace(`/campus-booking/order/${b.id}` as any);
    } catch (e: any) {
      setError(e?.message || 'Could not cancel. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (!b) {
    return (
      <View style={{ flex: 1, backgroundColor: p.page }}>
        <CbHeader title="Pay the stall" />
        <View style={{ padding: 16 }}>
          {loadErr ? <EmptyCard icon="cloud-offline-outline" title="Couldn't load the booking" sub={loadErr} actionLabel="Try again" onAction={load} /> : <EmptyCard loading title="Loading the payment details" />}
        </View>
      </View>
    );
  }

  const upi = b.payee.upiId || '';
  const qr = resolveMediaUrl(b.payee.qrUrl);
  const left = minutesLeft(b.paymentDeadline);
  const stallName = b.stall?.name || 'the stall';
  const openUpiApp = async () => {
    if (!b.payee.upiLink) return;
    try { await Linking.openURL(b.payee.upiLink); } catch { setError('No UPI app opened. Scan the QR or pay to the UPI ID from your UPI app.'); }
  };
  const copy = () => { Clipboard.setString(upi); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.page }}>
      <CbHeader title="Pay the stall" sub={`Booking ${b.ref} · ${stallName}`} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {b.status === 'REJECTED' && b.rejection ? (
          <View style={[s.noticeCard, { backgroundColor: p.redSoft, borderColor: 'rgba(239,79,95,0.25)' }]}>
            <Ionicons name="alert-circle-outline" size={20} color={COLORS.red} />
            <View style={{ flex: 1 }}>
              <Text style={[s.noticeTitle, { color: p.txt }]}>{stallName} could not verify your payment</Text>
              <Text style={[s.noticeSub, { color: p.txtSec }]}>{b.rejection.reason}. Check your UPI app and send the proof again, or cancel this booking.</Text>
            </View>
          </View>
        ) : null}

        <StaggeredSection delay={0} direction="up">
          <Text style={[s.sectionTitle, { color: p.txt }]}>Pay to the stall</Text>
          <View style={[s.billCard, { backgroundColor: p.card, borderColor: p.border, borderWidth: 1 }]}>
            <View style={s.billRow}>
              <Text style={[s.billLabel, { color: p.txt }]}>Pay to</Text>
              <Text style={[s.billVal, { color: p.txt, flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>{b.payee.name || stallName}</Text>
            </View>
            <View style={[s.billRow, { borderTopWidth: 1, borderTopColor: p.border, paddingTop: 12, marginTop: 8 }]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: p.txt }}>Amount to pay</Text>
              <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.red }}>{inr(b.amount)}</Text>
            </View>

            <View style={{ alignItems: 'center', marginTop: 14 }}>
              <View style={[s.qrBox, { borderColor: p.border }]}>
                {qr ? (
                  <SafeImage source={{ uri: qr }} style={{ width: 200, height: 200 }} contentFit="contain" placeholderIcon="qr-code-outline" accessibilityLabel="The stall's UPI QR code" />
                ) : b.payee.upiLink ? (
                  <View accessibilityLabel={`UPI QR code for ${upi}`}><QRCode value={b.payee.upiLink} size={200} color="#000000" backgroundColor="#FFFFFF" ecl="M" quietZone={6} /></View>
                ) : null}
              </View>
              <Text style={[s.helperText, { color: p.txtSec, textAlign: 'center', marginTop: 10 }]}>
                {qr ? 'Scan the stall QR and pay exactly the amount above, or pay to the UPI ID.' : 'Scan this QR (the amount is already in it), or pay to the UPI ID.'}
              </Text>
            </View>

            <TouchableOpacity onPress={copy} style={[s.upiRow, { borderColor: p.border, backgroundColor: p.isDark ? 'rgba(255,255,255,0.03)' : '#F9FAFB' }]} accessibilityRole="button" accessibilityLabel={`Copy UPI ID ${upi}`}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: p.txtSec }}>UPI ID</Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: p.txt, flex: 1, marginLeft: 10 }} numberOfLines={1} selectable>{upi}</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: p.accent }}>{copied ? 'Copied' : 'Copy'}</Text>
            </TouchableOpacity>
            {b.payee.upiLink ? <OutlineButton label="Pay with a UPI app" icon="open-outline" onPress={openUpiApp} style={{ marginTop: 10 }} /> : null}
            {b.status === 'PAYMENT_PENDING' && left !== null ? (
              <Text style={[s.helperText, { color: left <= 5 ? COLORS.red : p.txtSec, marginTop: 10, textAlign: 'center' }]}>
                {left > 0 ? `Pay and send the proof within ${left} minute${left === 1 ? '' : 's'}, or the booking is cancelled.` : 'Time is up. This booking will be cancelled.'}
              </Text>
            ) : null}
          </View>
        </StaggeredSection>

        <StaggeredSection delay={80} direction="up">
          <Text style={[s.sectionTitle, { color: p.txt, marginTop: 24 }]}>After paying, send both</Text>
          <TouchableOpacity onPress={pickShot} activeOpacity={0.9} style={[s.payCardNew, { backgroundColor: p.card, borderColor: shot || badField === 'shot' ? COLORS.red : p.border, borderStyle: shot ? 'solid' : 'dashed' }]} accessibilityRole="button" accessibilityLabel={shot ? 'Change the payment screenshot' : 'Upload payment screenshot'}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {shot ? <SafeImage source={{ uri: shot.localUri || shot.previewUrl || '' }} style={s.shotThumb} contentFit="cover" placeholderIcon="image-outline" /> : (
                <Ionicons name={uploading ? 'hourglass-outline' : 'cloud-upload-outline'} size={22} color={COLORS.red} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[s.payCardTitle, { color: shot ? COLORS.red : p.txt }]}>{uploading ? 'Uploading…' : shot ? 'Screenshot added' : 'Upload payment screenshot'}</Text>
                <Text style={[s.payCardDesc, { color: p.txtSec }]}>{shot ? 'Tap to change it' : 'JPG or PNG, max 5 MB. Only the stall and ZenWe support see it.'}</Text>
              </View>
              {shot ? <Ionicons name="checkmark-circle" size={20} color={COLORS.emerald} /> : null}
            </View>
          </TouchableOpacity>

          <Text style={[s.sectionTitle, { color: p.txt, marginTop: 20 }]}>Transaction ID (UPI reference)</Text>
          <TextInput
            value={ref}
            onChangeText={(t) => { setRef(t.toUpperCase().replace(/[^A-Z0-9 -]/g, '')); setError(null); if (badField === 'ref') setBadField(null); }}
            placeholder="For example 412345678901"
            placeholderTextColor={p.txtSec}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={40}
            style={[s.input, { color: p.txt, backgroundColor: p.card, borderColor: badField === 'ref' ? COLORS.red : p.border }]}
            accessibilityLabel="UPI reference number"
          />
          <Text style={[s.helperText, { color: p.txtSec }]}>Your UPI app shows it as the UTR, UPI Ref No. or Transaction ID.</Text>
        </StaggeredSection>

        {error ? <Text style={[s.errorText, { color: COLORS.red }]} accessibilityLiveRegion="polite">{error}</Text> : null}
        <View style={{ marginTop: 24 }}>
          <PlaceButton label="Submit payment" busyLabel="Sending…" onPress={submit} busy={busy === 'submit'} disabled={uploading || !b.canSubmitProof || !shot || !ref.trim()} />
        </View>
        {b.canCancel ? <OutlineButton label="Cancel booking" tone="danger" onPress={cancel} busy={busy === 'cancel'} style={{ marginTop: 12 }} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, width: '100%', maxWidth: 600, alignSelf: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2, marginBottom: 12 },
  billCard: { padding: 16, borderRadius: 20 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  billLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  billVal: { fontSize: 12, fontWeight: '600' },
  helperText: { fontSize: 12, fontWeight: '600', lineHeight: 15, marginBottom: 6 },
  qrBox: { padding: 10, borderRadius: 16, borderWidth: 1, backgroundColor: '#FFFFFF' },
  upiRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, minHeight: 48, marginTop: 6 },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  noticeTitle: { fontSize: 12, fontWeight: '700' },
  noticeSub: { fontSize: 12, fontWeight: '600', marginTop: 2, lineHeight: 15 },
  payCardNew: { padding: 14, borderRadius: 16, borderWidth: 1.5 },
  payCardTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  payCardDesc: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  shotThumb: { width: 44, height: 44, borderRadius: 10 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 13, marginBottom: 8, fontWeight: '600', letterSpacing: 0.5 },
  errorText: { fontSize: 13, fontWeight: '600', marginTop: 16, textAlign: 'center' },
});
