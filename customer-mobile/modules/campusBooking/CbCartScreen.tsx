/**
 * In-Campus Booking cart, in checkout's look (app/checkout): the header, section titles, item lines with the
 * stepper, the pickup notice card, the payment method card (one option: pay the stall by UPI), the bill card and
 * the red "Proceed to pay" button. The server prices the booking again and checks the stall is open now; one
 * Idempotency-Key per cart content, so a dropped connection never books twice.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FssaiLine from '../../components/FssaiLine';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { cbApi, newIdempotencyKey, type CbStall } from './cbApi';
import { cbCart, isNonFood, useCbCart, MAX_QTY_STATIONERY } from './cbCart';
import { uploadServicePdf } from '../services/uploadServicePdf';
import { COLORS, inr, useCbTheme } from './cbTheme';
import { AddControl, CbHeader, EmptyCard, PlaceButton, StaggeredSection, VegBox, useCbSignIn } from './cbKit';

// Stationery / print stalls (owner, 29 Oct): the PDFs to print travel with the booking. Each is uploaded on its own
// first (POST /api/services/documents, progress + retry), the booking then carries only the file ids.
const MAX_DOCS = 5;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
type DocDraft = { key: string; uri: string; name: string; size: number; status: 'uploading' | 'done' | 'failed'; progress: number; id?: string; error?: string };
const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Stationery lines: type the count (pages) instead of tapping + many times. */
function CountField({ qty, max, onSet, color, border, bg }: { qty: number; max: number; onSet: (n: number) => void; color: string; border: string; bg: string }) {
  const [text, setText] = useState(String(qty));
  useEffect(() => { setText(String(qty)); }, [qty]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n < 1) { setText(String(qty)); return; }
    onSet(Math.min(max, n));
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color }}>Count</Text>
      <TextInput
        value={text}
        onChangeText={(t) => setText(t.replace(/\D/g, '').slice(0, 3))}
        onEndEditing={commit}
        onSubmitEditing={commit}
        keyboardType="number-pad"
        returnKeyType="done"
        maxLength={3}
        selectTextOnFocus
        style={{ minWidth: 54, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: border, backgroundColor: bg, color, fontSize: 13, fontWeight: '700', textAlign: 'center' }}
        accessibilityLabel={`Type the number, up to ${max}`}
      />
    </View>
  );
}

export default function CbCartScreen({ stallId }: { stallId: string }) {
  const p = useCbTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cart = useCbCart(stallId);
  // Booking (and the print-PDF upload) needs a signed-in student: guests get the basket's sign-in prompt (QA Q23).
  const { requireSignIn } = useCbSignIn();
  const [stall, setStall] = useState<CbStall | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [docs, setDocs] = useState<DocDraft[]>([]);
  const stationery = stall?.category === 'stationery';
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const sig = JSON.stringify([cart.lines.map((l) => [l.menuItemId, l.quantity]), docs.map((d) => d.id || d.key)]);

  const patchDoc = (key: string, patch: Partial<DocDraft>) => setDocs((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const uploadDoc = async (d: DocDraft) => {
    patchDoc(d.key, { status: 'uploading', progress: 0, error: undefined });
    try {
      const r = await uploadServicePdf({ uri: d.uri, name: d.name }, (f) => patchDoc(d.key, { progress: f }));
      patchDoc(d.key, { status: 'done', id: r.id, name: r.name || d.name, size: r.size || d.size, progress: 1 });
    } catch (e: any) {
      patchDoc(d.key, { status: 'failed', error: e?.message || 'The file did not upload. Tap Retry.' });
    }
  };
  const pickDoc = async () => {
    if (docs.length >= MAX_DOCS) return;
    if (!requireSignIn()) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const a = res.assets[0];
      if (a.mimeType && a.mimeType !== 'application/pdf') { Alert.alert('Pick a PDF file', 'Only PDF files can be sent to the stall. Save other files as PDF first.'); return; }
      if (a.size && a.size > MAX_PDF_BYTES) { Alert.alert('That PDF is too large', 'Pick a PDF under 5 MB, or split it into parts.'); return; }
      const d: DocDraft = { key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, uri: a.uri, name: a.name || 'Document.pdf', size: a.size || 0, status: 'uploading', progress: 0 };
      setDocs((prev) => [...prev, d]);
      void uploadDoc(d);
    } catch {
      Alert.alert('Could not open your files', 'Please try again.');
    }
  };

  const refresh = useCallback(async () => {
    try {
      const d = await cbApi.stall(stallId);
      setStall(d.stall);
      cbCart.nameStall(stallId, d.stall?.name);
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
    if (!requireSignIn()) return;
    if (docs.some((d) => d.status === 'uploading')) { setError('Wait for the files to finish uploading.'); return; }
    if (docs.some((d) => d.status === 'failed')) { setError('One file did not upload. Tap Retry or remove it.'); return; }
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };
    setBusy(true);
    setError(null);
    try {
      const files = docs.filter((d) => d.status === 'done' && d.id).map((d) => ({ id: d.id as string, name: d.name }));
      const { booking } = await cbApi.book(stallId, cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })), keyRef.current.key, note.trim() || undefined, files);
      cbCart.clear(stallId);
      setDocs([]);
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
                  {stationery ? (
                    <View style={{ alignItems: 'flex-end' }}>
                      <AddControl qty={l.quantity} max={MAX_QTY_STATIONERY} onAdd={() => cbCart.change(stallId, l, 1, MAX_QTY_STATIONERY)} onRemove={() => cbCart.change(stallId, l, -1)} />
                      <CountField qty={l.quantity} max={MAX_QTY_STATIONERY} onSet={(n) => cbCart.setQty(stallId, l, n, MAX_QTY_STATIONERY)} color={p.txt} border={p.border} bg={p.card} />
                    </View>
                  ) : (
                    <AddControl qty={l.quantity} onAdd={() => cbCart.change(stallId, l, 1)} onRemove={() => cbCart.change(stallId, l, -1)} />
                  )}
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
                  <Text style={[s.payCardDesc, { color: p.txtSec }]}>You will pay to {stallName}'s own UPI ID on the next screen. ZenWe does not take or hold your money.</Text>
                </View>
                <View style={[s.radioOuter, { borderColor: COLORS.red }]}><View style={[s.radioInner, { backgroundColor: COLORS.red }]} /></View>
              </View>
            </View>

            {stationery ? (
              <>
                <Text style={[s.sectionTitle, { color: p.txt, marginTop: 20 }]}>Files to print (PDF)</Text>
                <View style={[s.payCardNew, { backgroundColor: p.card, borderColor: p.border, gap: 12 }]}>
                  {docs.map((d) => (
                    <View key={d.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name={d.status === 'failed' ? 'alert-circle-outline' : 'document-text-outline'} size={20} color={d.status === 'failed' ? COLORS.red : p.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.payCardTitle, { color: p.txt }]} numberOfLines={1}>{d.name}</Text>
                        <Text style={[s.payCardDesc, { color: d.status === 'failed' ? COLORS.red : p.txtSec }]} numberOfLines={2}>
                          {d.status === 'uploading' ? `Uploading ${Math.round(d.progress * 100)}%` : d.status === 'failed' ? (d.error || 'Did not upload') : `${sizeText(d.size)} · ready`}
                        </Text>
                      </View>
                      {d.status === 'failed' ? (
                        <TouchableOpacity onPress={() => void uploadDoc(d)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`Retry ${d.name}`}>
                          <Text style={{ color: COLORS.red, fontSize: 12, fontWeight: '800' }}>Retry</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity onPress={() => setDocs((prev) => prev.filter((x) => x.key !== d.key))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`Remove ${d.name}`}>
                        <Ionicons name="close-circle" size={20} color={p.txtSec} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {docs.length < MAX_DOCS ? (
                    <TouchableOpacity onPress={pickDoc} activeOpacity={0.85} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="button" accessibilityLabel="Add a PDF to print">
                      <Ionicons name="cloud-upload-outline" size={20} color={COLORS.red} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.payCardTitle, { color: COLORS.red }]}>{docs.length ? 'Add another PDF' : 'Add a PDF'}</Text>
                        <Text style={[s.payCardDesc, { color: p.txtSec }]}>Up to {MAX_DOCS} files, 5 MB each. Only the stall and ZenWe support can open them.</Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            ) : null}

            <Text style={[s.sectionTitle, { color: p.txt, marginTop: 20 }]}>{stationery ? 'Print instructions' : 'Note for the stall'}</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={stationery ? 'For example 2 copies, double-sided, black and white' : 'Optional, for example less sugar'}
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
